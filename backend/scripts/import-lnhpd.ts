import { createHash } from 'node:crypto';
import { supabase } from '../src/supabase.js';

type PaginationMeta = {
  limit?: number;
  page?: number;
  total?: number;
  next?: string | null;
  previous?: string | null;
};

type PaginatedPayload = {
  metadata?: {
    pagination?: PaginationMeta;
    dateReceived?: string | null;
  };
  data?: unknown[];
  results?: unknown[];
};

type EndpointConfig = {
  name: string;
  path: string;
  paginated?: boolean;
};

const BASE_URL = 'https://health-products.canada.ca/api/natural-licences/';
const DEFAULT_ENDPOINTS: EndpointConfig[] = [
  { name: 'ProductLicence', path: 'ProductLicence/?lang=en&type=json', paginated: true },
  { name: 'MedicinalIngredient', path: 'MedicinalIngredient/?lang=en&type=json', paginated: true },
  { name: 'NonMedicinalIngredient', path: 'NonMedicinalIngredient/?lang=en&type=json', paginated: true },
  { name: 'ProductDose', path: 'ProductDose/?lang=en&type=json', paginated: true },
  { name: 'ProductPurpose', path: 'ProductPurpose/?lang=en&type=json', paginated: true },
  { name: 'ProductRoute', path: 'ProductRoute/?lang=en&type=json', paginated: false },
];

const args = process.argv.slice(2);
const hasFlag = (flag: string) => args.includes(`--${flag}`);
const getArg = (flag: string) => {
  const idx = args.indexOf(`--${flag}`);
  if (idx === -1) return null;
  return args[idx + 1] ?? null;
};

const parseNumber = (value: unknown): number | null => {
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  if (typeof value === 'string') {
    const trimmed = value.trim();
    if (!trimmed) return null;
    const parsed = Number(trimmed);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
};

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

const hashRecord = (record: unknown) => {
  const raw = JSON.stringify(record);
  return createHash('sha256').update(raw).digest('hex');
};

const buildUrl = (path: string, page: number | null) => {
  const url = new URL(path, BASE_URL);
  if (page && page > 1) {
    url.searchParams.set('page', String(page));
  }
  return url.toString();
};

const fetchJson = async (url: string, timeoutMs: number) => {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, {
      signal: controller.signal,
      headers: { accept: 'application/json' },
    });
    if (!response.ok) {
      const text = await response.text();
      throw new Error(`HTTP ${response.status} ${response.statusText}: ${text.slice(0, 200)}`);
    }
    return response.json();
  } finally {
    clearTimeout(timeout);
  }
};

const retryDelayMs = Math.max(250, Number(getArg('retry-delay-ms') ?? process.env.LNHPD_RETRY_DELAY_MS ?? '1000'));
const maxRetries = Math.max(0, Number(getArg('retries') ?? process.env.LNHPD_RETRIES ?? '3'));

const fetchJsonWithRetry = async (url: string, timeoutMs: number) => {
  let attempt = 0;
  let lastError: unknown = null;
  while (attempt <= maxRetries) {
    try {
      const payload = await fetchJson(url, timeoutMs);
      if (payload == null || (typeof payload !== 'object' && !Array.isArray(payload))) {
        throw new Error(`[lnhpd] invalid payload for ${url}`);
      }
      return payload;
    } catch (error) {
      lastError = error;
      if (attempt >= maxRetries) break;
      const waitMs = retryDelayMs * Math.pow(2, attempt);
      console.warn(`[lnhpd] fetch failed (attempt ${attempt + 1}/${maxRetries + 1}), retrying in ${waitMs}ms`);
      await sleep(waitMs);
    }
    attempt += 1;
  }
  throw lastError;
};

const isInvalidPayloadError = (error: unknown) => {
  if (!(error instanceof Error)) return false;
  return error.message.includes('invalid payload');
};

const extractPage = (payload: unknown) => {
  if (Array.isArray(payload)) {
    return {
      records: payload,
      nextUrl: null,
      datasetVersion: null,
    };
  }

  const typed = payload as PaginatedPayload;
  const records = Array.isArray(typed.data)
    ? typed.data
    : Array.isArray(typed.results)
      ? typed.results
      : [];
  const pagination = typed.metadata?.pagination;
  const nextValue = pagination?.next ?? null;
  const nextUrl = nextValue
    ? new URL(nextValue, BASE_URL).toString()
    : null;
  const datasetVersion = typed.metadata?.dateReceived ?? null;
  return {
    records,
    nextUrl,
    datasetVersion,
  };
};

const bumpPageUrl = (url: string) => {
  try {
    const parsed = new URL(url);
    const current = Number(parsed.searchParams.get('page') ?? '');
    if (!Number.isFinite(current) || current <= 0) return null;
    parsed.searchParams.set('page', String(current + 1));
    return parsed.toString();
  } catch {
    return null;
  }
};

const endpointFilter = getArg('endpoint');
const endpointNames = endpointFilter
  ? endpointFilter.split(',').map((value) => value.trim()).filter(Boolean)
  : [];
const endpoints = endpointNames.length
  ? DEFAULT_ENDPOINTS.filter((endpoint) => endpointNames.includes(endpoint.name))
  : DEFAULT_ENDPOINTS;

const batchSize = Math.max(1, Number(getArg('batch') ?? process.env.LNHPD_BATCH_SIZE ?? '250'));
const maxPages = Math.max(0, Number(getArg('max-pages') ?? process.env.LNHPD_MAX_PAGES ?? '0'));
const startPage = Math.max(1, Number(getArg('start-page') ?? process.env.LNHPD_START_PAGE ?? '1'));
const delayMs = Math.max(0, Number(getArg('delay-ms') ?? process.env.LNHPD_DELAY_MS ?? '350'));
const timeoutMs = Math.max(5_000, Number(getArg('timeout-ms') ?? process.env.LNHPD_TIMEOUT_MS ?? '30000'));
const activeOnly = !hasFlag('include-inactive');
const dryRun = hasFlag('dry-run');

const rowKey = (row: Record<string, unknown>) => {
  const endpoint = typeof row.endpoint === 'string' ? row.endpoint : '';
  const hash = typeof row.record_hash === 'string' ? row.record_hash : '';
  return `${endpoint}:${hash}`;
};

const activeIds = new Set<number>();
let activeIdsReady = false;

const isActiveProductLicence = (record: Record<string, unknown>): boolean => {
  const raw = record.flag_product_status;
  if (raw == null) return false;
  if (typeof raw === 'number') return raw === 1;
  if (typeof raw === 'string') {
    const normalized = raw.trim().toLowerCase();
    return normalized === '1' || normalized === 'active';
  }
  return false;
};

const dedupeRows = (rows: Record<string, unknown>[]) => {
  const map = new Map<string, Record<string, unknown>>();
  rows.forEach((row) => {
    map.set(rowKey(row), row);
  });
  return Array.from(map.values());
};

const mergePending = (pending: Record<string, unknown>[], incoming: Record<string, unknown>[]) => {
  const map = new Map<string, Record<string, unknown>>();
  pending.forEach((row) => map.set(rowKey(row), row));
  incoming.forEach((row) => map.set(rowKey(row), row));
  return Array.from(map.values());
};

const activeIdBatch = Math.max(
  500,
  Math.min(1000, Number(getArg('active-id-batch') ?? process.env.LNHPD_ACTIVE_ID_BATCH ?? '2000')),
);

const loadActiveIdsFromDb = async () => {
  console.log('[lnhpd] loading active ProductLicence ids from db...');
  let lastId: number | null = null;
  let rowsSeen = 0;
  while (true) {
    let query = supabase
      .from('lnhpd_raw_records')
      .select('lnhpd_id,payload')
      .eq('endpoint', 'ProductLicence')
      .order('lnhpd_id', { ascending: true })
      .limit(activeIdBatch);
    if (lastId != null) {
      query = query.gt('lnhpd_id', lastId);
    }
    const { data, error } = await query;
    if (error) {
      throw new Error(`active ProductLicence lookup failed: ${error.message}`);
    }
    const rows = (data ?? []) as { lnhpd_id?: unknown; payload?: unknown }[];
    if (rows.length === 0) break;
    rowsSeen += rows.length;
    let maxId: number | null = null;
    rows.forEach((row) => {
      const payload = row.payload;
      if (!payload || typeof payload !== 'object') return;
      if (!isActiveProductLicence(payload as Record<string, unknown>)) return;
      const lnhpdId = parseNumber(row.lnhpd_id);
      if (lnhpdId != null) {
        activeIds.add(lnhpdId);
        if (maxId == null || lnhpdId > maxId) {
          maxId = lnhpdId;
        }
      }
    });
    if (maxId == null || maxId === lastId) break;
    lastId = maxId;
  }
  activeIdsReady = true;
  console.log(`[lnhpd] active ids loaded: activeIds=${activeIds.size} rows=${rowsSeen}`);
};

const upsertBatch = async (rows: Record<string, unknown>[], endpoint: string) => {
  const uniqueRows = dedupeRows(rows);
  if (uniqueRows.length === 0) return;
  if (dryRun) {
    console.log(`[lnhpd] dry-run batch=${uniqueRows.length} endpoint=${endpoint}`);
    return;
  }
  const { error } = await supabase
    .from('lnhpd_raw_records')
    .upsert(uniqueRows, { onConflict: 'endpoint,record_hash' });
  if (error) {
    throw new Error(`supabase upsert failed: ${error.message}`);
  }
};

const importEndpoint = async (endpoint: EndpointConfig) => {
  console.log(`[lnhpd] start endpoint=${endpoint.name}`);
  const isProductLicence = endpoint.name === 'ProductLicence';
  if (activeOnly && !isProductLicence && !activeIdsReady) {
    console.warn(
      `[lnhpd] active-only enabled but no ProductLicence active list loaded; skipping endpoint=${endpoint.name}`,
    );
    return;
  }
  let nextUrl = buildUrl(endpoint.path, startPage);
  let pageCount = 0;
  let totalInserted = 0;
  let pending: Record<string, unknown>[] = [];

  while (nextUrl) {
    pageCount += 1;
    if (maxPages > 0 && pageCount > maxPages) break;

    let payload: unknown;
    try {
      payload = await fetchJsonWithRetry(nextUrl, timeoutMs);
    } catch (error) {
      if (isInvalidPayloadError(error)) {
        const bumped = bumpPageUrl(nextUrl);
        if (!bumped) throw error;
        console.warn(`[lnhpd] skipping invalid page, url=${nextUrl}`);
        nextUrl = bumped;
        continue;
      }
      throw error;
    }
    const page = extractPage(payload);
    const fetchedAt = new Date().toISOString();
    const recordList = page.records.filter((record) => record && typeof record === 'object') as Record<
      string,
      unknown
    >[];
    let filteredRecords = recordList;
    if (activeOnly) {
      if (isProductLicence) {
        filteredRecords = recordList.filter((record) => isActiveProductLicence(record));
        filteredRecords.forEach((record) => {
          const lnhpdId = parseNumber(record.lnhpd_id);
          if (lnhpdId != null) {
            activeIds.add(lnhpdId);
          }
        });
      } else {
        filteredRecords = recordList.filter((record) => {
          const lnhpdId = parseNumber(record.lnhpd_id);
          return lnhpdId != null && activeIds.has(lnhpdId);
        });
      }
    }

    const rows = filteredRecords.map((record) => {
      const lnhpdId = parseNumber((record as { lnhpd_id?: unknown }).lnhpd_id);
      return {
        endpoint: endpoint.name,
        record_hash: hashRecord(record),
        lnhpd_id: lnhpdId,
        payload: record,
        dataset_version: page.datasetVersion,
        fetched_at: fetchedAt,
      };
    });

    pending = mergePending(pending, dedupeRows(rows));
    while (pending.length >= batchSize) {
      const batch = pending.slice(0, batchSize);
      await upsertBatch(batch, endpoint.name);
      pending = pending.slice(batchSize);
      totalInserted += batch.length;
      console.log(`[lnhpd] endpoint=${endpoint.name} page=${pageCount} inserted=${totalInserted}`);
    }

    nextUrl = page.nextUrl;
    if (!endpoint.paginated) {
      nextUrl = null;
    }
    if (nextUrl && delayMs > 0) {
      await sleep(delayMs);
    }
  }

  if (pending.length > 0) {
    await upsertBatch(pending, endpoint.name);
    totalInserted += pending.length;
  }

  console.log(`[lnhpd] done endpoint=${endpoint.name} total=${totalInserted} pages=${pageCount}`);
  if (activeOnly && isProductLicence) {
    activeIdsReady = true;
    console.log(`[lnhpd] active-only ready: activeIds=${activeIds.size}`);
  }
};

const main = async () => {
  if (endpoints.length === 0) {
    console.log('[lnhpd] no endpoints matched --endpoint filter');
    return;
  }

  const hasProductLicence = endpoints.some((endpoint) => endpoint.name === 'ProductLicence');
  if (activeOnly && !hasProductLicence) {
    await loadActiveIdsFromDb();
    if (!activeIdsReady || activeIds.size === 0) {
      throw new Error('[lnhpd] active-only requires ProductLicence data; run ProductLicence import first');
    }
  }

  const orderedEndpoints = hasProductLicence
    ? [
        ...endpoints.filter((endpoint) => endpoint.name === 'ProductLicence'),
        ...endpoints.filter((endpoint) => endpoint.name !== 'ProductLicence'),
      ]
    : endpoints;

  for (const endpoint of orderedEndpoints) {
    await importEndpoint(endpoint);
  }
};

main().catch((error) => {
  console.error('[lnhpd] import failed', error instanceof Error ? error.message : error);
  process.exit(1);
});
