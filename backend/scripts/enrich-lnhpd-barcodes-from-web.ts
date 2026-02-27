import fs from "node:fs";
import path from "node:path";

import { normalizeBarcodeInput } from "../src/barcode.js";
import { normalizeBarcodeKey } from "../src/barcodeKey.js";
import { upsertRegulatoryMapWithPolicy } from "../src/barcodeResolutionDbCache.js";
import { supabase } from "../src/supabase.js";

type LnhpdRow = {
  lnhpd_id: number;
  npn: string | null;
  brand_name: string | null;
  product_name: string | null;
  facts_json: Record<string, unknown> | null;
};

type Checkpoint = {
  lastLnhpdId: number | null;
  listIndex?: number;
  processed: number;
  queried: number;
  matched: number;
  upserted: number;
  conflicts: number;
  skippedExisting: number;
  failed: number;
  updatedFactsRows: number;
  consideredLinks: number;
  blockedDomainLinks: number;
  rejectedByAllowlistLinks: number;
  rejectedByContextLinks: number;
  startedAt: string;
  updatedAt: string;
};

type SearchItem = {
  title?: string;
  link?: string;
  snippet?: string;
};

type CandidateEvidence = {
  barcodeGtin14: string;
  raw: string;
  link: string;
  sourceType: "jsonld" | "keyword" | "snippet";
  npnMentioned: boolean;
};

type RowContext = {
  brandTokens: string[];
  productTokens: string[];
};

type TokenStrictness = "low" | "normal";

type QueueNpnHints = {
  brandName: string | null;
  productName: string | null;
  twoHopHint: string | null;
  upcHints: string[];
  reason: string | null;
  timeoutCount: number | null;
};

const args = process.argv.slice(2);
const hasFlag = (flag: string) => args.includes(`--${flag}`);
const getArg = (flag: string) => {
  const idx = args.indexOf(`--${flag}`);
  if (idx === -1) return null;
  return args[idx + 1] ?? null;
};

const asNumber = (value: string | null, fallback: number): number => {
  if (!value) return fallback;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
};

const pageSize = Math.min(1000, Math.max(20, asNumber(getArg("page-size"), 200)));
const queryNum = Math.min(10, Math.max(1, asNumber(getArg("query-num"), 5)));
const maxQueriesPerNpn = Math.min(3, Math.max(1, asNumber(getArg("max-queries-per-npn"), 3)));
const queryDelayMs = Math.max(0, asNumber(getArg("query-delay-ms"), 150));
const maxPages = Math.max(0, asNumber(getArg("max-pages"), 0));
const maxNpns = Math.max(0, asNumber(getArg("max-npns"), 0));
const maxBarcodesPerNpn = Math.min(10, Math.max(1, asNumber(getArg("max-barcodes-per-npn"), 3)));
const htmlTimeoutMs = Math.max(1500, asNumber(getArg("html-timeout-ms"), 8000));
const cseTimeoutMs = Math.max(1500, asNumber(getArg("cse-timeout-ms"), 7000));

const dryRun = hasFlag("dry-run");
const writeFacts = hasFlag("write-facts");
const skipExistingNpn = !hasFlag("include-existing-npn");
const onlyNpn = getArg("only-npn")?.replace(/\D/g, "").trim() ?? null;
const npnFile = getArg("npn-file");
const npnQueueFile = getArg("npn-queue-file");
const coverageReportJson =
  getArg("coverage-report-json") ?? path.resolve(process.cwd(), "output", "lnhpd_barcode_enrich_coverage.json");
const strictBrandTokenGate = hasFlag("strict-brand-token-gate");
const strictProductTokenGate = hasFlag("strict-product-token-gate");
const tokenStrictnessRaw = (getArg("token-strictness") ?? "normal").toLowerCase();
const tokenStrictness: TokenStrictness = tokenStrictnessRaw === "low" ? "low" : "normal";
const enableUpcFallbackQuery = hasFlag("enable-upc-fallback-query");

const checkpointFile =
  getArg("checkpoint-file") ??
  path.resolve(process.cwd(), "output", "lnhpd_barcode_enrich_checkpoint.json");
const summaryJson =
  getArg("summary-json") ?? path.resolve(process.cwd(), "output", "lnhpd_barcode_enrich_summary.json");
const matchesJsonl =
  getArg("matches-jsonl") ?? path.resolve(process.cwd(), "output", "lnhpd_barcode_enrich_matches.jsonl");
const failuresJsonl =
  getArg("failures-jsonl") ?? path.resolve(process.cwd(), "output", "lnhpd_barcode_enrich_failures.jsonl");
const maxAttemptsPerNpn = Math.max(1, asNumber(getArg("max-attempts-per-npn"), maxQueriesPerNpn));

const normalizeDomain = (value: string): string =>
  value.trim().toLowerCase().replace(/^www\./, "");

const DEFAULT_BLOCKED_DOMAINS = [
  "amazon.com",
  "amazon.ca",
  "amazon.co.uk",
  "amazon.de",
  "amazon.fr",
  "ebay.com",
  "ebay.ca",
  "etsy.com",
  "walmart.com",
  "walmart.ca",
  "target.com",
  "temu.com",
  "aliexpress.com",
  "alibaba.com",
  "mercari.com",
  "carousell.com",
  "wish.com",
];

const parseDomainSet = (raw: string | null, fallback: string[] = []): Set<string> => {
  const source = raw && raw.trim().length > 0 ? raw.split(",") : fallback;
  return new Set(source.map(normalizeDomain).filter(Boolean));
};

const blockedDomains = parseDomainSet(getArg("blocked-domains"), DEFAULT_BLOCKED_DOMAINS);
const allowedDomainsRaw = getArg("allowed-domains");
const allowedDomains = allowedDomainsRaw ? parseDomainSet(allowedDomainsRaw, []) : null;

const domainMatches = (domain: string, candidate: string): boolean =>
  domain === candidate || domain.endsWith(`.${candidate}`);

const isBlockedDomain = (domain: string): boolean => {
  for (const blocked of blockedDomains) {
    if (domainMatches(domain, blocked)) return true;
  }
  return false;
};

const isAllowedDomain = (domain: string): boolean => {
  if (!allowedDomains) return true;
  for (const allowed of allowedDomains) {
    if (domainMatches(domain, allowed)) return true;
  }
  return false;
};

const extractDomain = (value: string): string | null => {
  try {
    const url = new URL(value);
    return normalizeDomain(url.hostname);
  } catch {
    return null;
  }
};

const GOOGLE_CSE_ENDPOINT = "https://customsearch.googleapis.com/customsearch/v1";
const googleKey = process.env.GOOGLE_CSE_API_KEY?.trim() ?? "";
const googleCx = process.env.GOOGLE_CSE_CX?.trim() ?? "";
const searchHl = process.env.SEARCH_HL?.trim() ?? "en";
const searchGl = process.env.SEARCH_GL?.trim().toLowerCase() ?? "ca";

if (!googleKey || !googleCx) {
  console.error("[lnhpd-barcode-enrich] Missing GOOGLE_CSE_API_KEY or GOOGLE_CSE_CX");
  process.exit(1);
}

const ensureDir = async (filePath: string) => {
  await fs.promises.mkdir(path.dirname(filePath), { recursive: true });
};

const appendJsonl = async (filePath: string, payload: Record<string, unknown>) => {
  await ensureDir(filePath);
  await fs.promises.appendFile(filePath, `${JSON.stringify(payload)}\n`, "utf8");
};

const writeJson = async (filePath: string, payload: unknown) => {
  await ensureDir(filePath);
  await fs.promises.writeFile(filePath, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
};

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

const sanitize = (value: string | null | undefined): string =>
  String(value ?? "")
    .replace(/\s+/g, " ")
    .trim();

const normalizeLooseText = (value: string | null | undefined): string =>
  sanitize(value)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();

const PRODUCT_STOP_WORDS = new Set([
  "mg",
  "mcg",
  "g",
  "iu",
  "ml",
  "tablet",
  "tablets",
  "capsule",
  "capsules",
  "softgel",
  "softgels",
  "caplet",
  "caplets",
  "bonus",
  "size",
  "regular",
  "strength",
  "extra",
  "timed",
  "release",
  "and",
  "with",
]);

const BRAND_STOP_WORDS = new Set([
  "ltd",
  "limited",
  "inc",
  "company",
  "laboratories",
  "international",
  "nutricorp",
]);

const normalizeNpn = (value: string | null | undefined): string | null => {
  const digits = String(value ?? "").replace(/\D/g, "").trim();
  if (!digits) return null;
  if (!/^\d{8}$/.test(digits)) return null;
  if (/^(\d)\1{7}$/.test(digits)) return null;
  return digits;
};

const normalizeUpcHint = (value: unknown): string | null => {
  const text = String(value ?? "").replace(/\D/g, "");
  if (!/^\d{8,14}$/.test(text)) return null;
  return text;
};

const normalizeNpnArray = (values: unknown[]): string[] => {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const value of values) {
    const npn = normalizeNpn(typeof value === "string" || typeof value === "number" ? String(value) : null);
    if (!npn || seen.has(npn)) continue;
    seen.add(npn);
    out.push(npn);
  }
  return out;
};

const extractNpnsFromUnknown = (payload: unknown): string[] => {
  if (Array.isArray(payload)) return normalizeNpnArray(payload);
  if (payload && typeof payload === "object") {
    const obj = payload as Record<string, unknown>;
    const fields = ["npns", "sourceIds", "ids", "queue", "rows", "items"];
    const out: string[] = [];
    const seen = new Set<string>();
    const push = (value: string | null) => {
      if (!value || seen.has(value)) return;
      seen.add(value);
      out.push(value);
    };
    const extract = (entry: unknown): string | null => {
      if (typeof entry === "string" || typeof entry === "number") {
        return normalizeNpn(String(entry));
      }
      if (entry && typeof entry === "object") {
        const row = entry as Record<string, unknown>;
        return (
          normalizeNpn(typeof row.npn === "string" || typeof row.npn === "number" ? String(row.npn) : null) ??
          normalizeNpn(typeof row.sourceId === "string" || typeof row.sourceId === "number" ? String(row.sourceId) : null) ??
          normalizeNpn(typeof row.id === "string" || typeof row.id === "number" ? String(row.id) : null) ??
          null
        );
      }
      return null;
    };

    for (const field of fields) {
      const value = obj[field];
      if (!Array.isArray(value)) continue;
      for (const entry of value) push(extract(entry));
    }
    push(extract(obj.npn));
    return out;
  }
  if (typeof payload === "string" || typeof payload === "number") {
    const npn = normalizeNpn(String(payload));
    return npn ? [npn] : [];
  }
  return [];
};

type BarcodeCandidateMetaEntry = {
  barcode: string;
  source?: string | null;
  evidence?: string | null;
  matchMode?: string | null;
  confidence?: number | null;
  lastSeenAt?: string | null;
};

const normalizeBarcodeToGtin14 = (value: unknown): string | null => {
  const raw = sanitize(typeof value === "string" || typeof value === "number" ? String(value) : null);
  if (!raw) return null;
  const digits = raw.replace(/\D/g, "");
  if (!digits) return null;
  const inputs = digits.length === 11 ? [`0${digits}`, digits] : [digits];
  for (const input of inputs) {
    const normalized = normalizeBarcodeKey(input);
    if (normalized.isValidChecksum !== true) continue;
    if (normalized.gtin14) return normalized.gtin14;
  }
  return null;
};

const normalizeMetaText = (value: unknown): string | null => {
  const text = sanitize(typeof value === "string" || typeof value === "number" ? String(value) : null);
  return text ? text : null;
};

const normalizeMetaConfidence = (value: unknown): number | null => {
  const n = Number(value);
  if (!Number.isFinite(n)) return null;
  if (n < 0) return 0;
  if (n > 1) return 1;
  return Number(n.toFixed(4));
};

const hasMeaningfulMeta = (entry: BarcodeCandidateMetaEntry): boolean =>
  Boolean(entry.source || entry.evidence || entry.matchMode || entry.confidence != null || entry.lastSeenAt);

const mergeFactsBarcodeCandidates = (params: {
  facts: Record<string, unknown>;
  incomingBarcodes: string[];
  incomingMeta?: BarcodeCandidateMetaEntry[];
  maxCount: number;
}) => {
  const { facts, incomingBarcodes, incomingMeta = [], maxCount } = params;
  const metaByBarcode = new Map<string, BarcodeCandidateMetaEntry>();
  const existingOrder: string[] = [];
  const seenExisting = new Set<string>();

  const upsertMeta = (barcode: string, patch: Partial<BarcodeCandidateMetaEntry>) => {
    const current = metaByBarcode.get(barcode) ?? { barcode };
    metaByBarcode.set(barcode, {
      barcode,
      source: patch.source ?? current.source ?? null,
      evidence: patch.evidence ?? current.evidence ?? null,
      matchMode: patch.matchMode ?? current.matchMode ?? null,
      confidence: patch.confidence ?? current.confidence ?? null,
      lastSeenAt: patch.lastSeenAt ?? current.lastSeenAt ?? null,
    });
  };

  const rawCandidates = Array.isArray((facts as Record<string, unknown>).barcodeCandidates)
    ? ((facts as Record<string, unknown>).barcodeCandidates as unknown[])
    : [];
  for (const entry of rawCandidates) {
    let barcode: string | null = null;
    if (entry && typeof entry === "object" && !Array.isArray(entry)) {
      const obj = entry as Record<string, unknown>;
      barcode = normalizeBarcodeToGtin14(obj.barcode ?? obj.barcode_gtin14 ?? obj.gtin14 ?? obj.value);
      if (barcode) {
        upsertMeta(barcode, {
          source: normalizeMetaText(obj.source),
          evidence: normalizeMetaText(obj.evidence),
          matchMode: normalizeMetaText(obj.matchMode),
          confidence: normalizeMetaConfidence(obj.confidence),
          lastSeenAt: normalizeMetaText(obj.lastSeenAt ?? obj.last_seen_at),
        });
      }
    } else {
      barcode = normalizeBarcodeToGtin14(entry);
    }
    if (!barcode || seenExisting.has(barcode)) continue;
    seenExisting.add(barcode);
    existingOrder.push(barcode);
  }

  const rawMeta = Array.isArray((facts as Record<string, unknown>).barcodeCandidatesMeta)
    ? ((facts as Record<string, unknown>).barcodeCandidatesMeta as unknown[])
    : [];
  for (const entry of rawMeta) {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) continue;
    const obj = entry as Record<string, unknown>;
    const barcode = normalizeBarcodeToGtin14(obj.barcode ?? obj.barcode_gtin14 ?? obj.gtin14 ?? obj.value);
    if (!barcode) continue;
    upsertMeta(barcode, {
      source: normalizeMetaText(obj.source),
      evidence: normalizeMetaText(obj.evidence),
      matchMode: normalizeMetaText(obj.matchMode),
      confidence: normalizeMetaConfidence(obj.confidence),
      lastSeenAt: normalizeMetaText(obj.lastSeenAt ?? obj.last_seen_at),
    });
  }

  for (const entry of incomingMeta) {
    const barcode = normalizeBarcodeToGtin14(entry.barcode);
    if (!barcode) continue;
    upsertMeta(barcode, {
      source: normalizeMetaText(entry.source),
      evidence: normalizeMetaText(entry.evidence),
      matchMode: normalizeMetaText(entry.matchMode),
      confidence: normalizeMetaConfidence(entry.confidence),
      lastSeenAt: normalizeMetaText(entry.lastSeenAt),
    });
  }

  const incomingOrder = Array.from(
    new Set(incomingBarcodes.map((value) => normalizeBarcodeToGtin14(value)).filter((value): value is string => Boolean(value))),
  );
  const mergedOrder = [...existingOrder, ...incomingOrder];
  const finalOrder: string[] = [];
  const seenFinal = new Set<string>();
  for (const barcode of mergedOrder) {
    if (seenFinal.has(barcode)) continue;
    seenFinal.add(barcode);
    finalOrder.push(barcode);
    if (finalOrder.length >= maxCount) break;
  }

  const finalMeta = finalOrder
    .map((barcode) => metaByBarcode.get(barcode))
    .filter((entry): entry is BarcodeCandidateMetaEntry => Boolean(entry))
    .filter((entry) => hasMeaningfulMeta(entry))
    .map((entry) => ({
      barcode: entry.barcode,
      ...(entry.source ? { source: entry.source } : {}),
      ...(entry.evidence ? { evidence: entry.evidence } : {}),
      ...(entry.matchMode ? { matchMode: entry.matchMode } : {}),
      ...(entry.confidence != null ? { confidence: entry.confidence } : {}),
      ...(entry.lastSeenAt ? { lastSeenAt: entry.lastSeenAt } : {}),
    }));

  return { barcodes: finalOrder, meta: finalMeta };
};

const loadNpnListFromFile = async (filePath: string): Promise<string[]> => {
  const raw = await fs.promises.readFile(filePath, "utf8");
  const trimmed = raw.trim();
  if (!trimmed) return [];

  if (trimmed.startsWith("[") || trimmed.startsWith("{")) {
    try {
      const payload = JSON.parse(trimmed) as unknown;
      const extracted = extractNpnsFromUnknown(payload);
      if (extracted.length > 0) return extracted;
    } catch {
      // Fall through to line-by-line parsing (supports JSONL).
    }
  }

  {
    const lines = trimmed.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
    const out: string[] = [];
    const seen = new Set<string>();
    const push = (value: string | null) => {
      if (!value || seen.has(value)) return;
      seen.add(value);
      out.push(value);
    };
    for (const line of lines) {
      if (line.startsWith("{") || line.startsWith("[")) {
        try {
          const parsed = JSON.parse(line);
          const extracted = extractNpnsFromUnknown(parsed);
          for (const npn of extracted) push(npn);
          continue;
        } catch {
          // Fall through to plain NPN parsing.
        }
      }
      push(normalizeNpn(line));
    }
    if (out.length > 0) return out;
  }

  throw new Error("invalid_npn_file_format: expected json/jsonl with npn identifiers");
};

const asObject = (value: unknown): Record<string, unknown> | null =>
  value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : null;

const extractUpcHintsFromRow = (row: Record<string, unknown>): string[] => {
  const out: string[] = [];
  const seen = new Set<string>();
  const push = (value: unknown) => {
    const normalized = normalizeUpcHint(value);
    if (!normalized || seen.has(normalized)) return;
    seen.add(normalized);
    out.push(normalized);
  };

  const directKeys = ["upc", "upcHint", "gtin", "barcode", "barcode_gtin14"];
  for (const key of directKeys) push(row[key]);

  const arrayKeys = [
    "upcHints",
    "upc_hints",
    "upcCandidates",
    "gtinHints",
    "barcodeCandidates",
    "barcode_candidates",
  ];
  for (const key of arrayKeys) {
    const value = row[key];
    if (!Array.isArray(value)) continue;
    for (const entry of value) {
      if (typeof entry === "string" || typeof entry === "number") {
        push(entry);
        continue;
      }
      const obj = asObject(entry);
      if (!obj) continue;
      push(obj.value ?? obj.barcode ?? obj.barcode_gtin14 ?? obj.gtin14 ?? obj.upc);
    }
  }

  const twoHopHint = sanitize(
    typeof row.twoHopHint === "string" || typeof row.two_hop_hint === "string"
      ? String(row.twoHopHint ?? row.two_hop_hint)
      : "",
  );
  if (twoHopHint) {
    const matches = twoHopHint.match(/\d{8,14}/g) ?? [];
    for (const match of matches) push(match);
  }

  return out;
};

const buildQueueNpnHint = (row: Record<string, unknown>): { npn: string; hint: QueueNpnHints } | null => {
  const npn =
    normalizeNpn(typeof row.npn === "string" || typeof row.npn === "number" ? String(row.npn) : null) ??
    normalizeNpn(typeof row.sourceId === "string" || typeof row.sourceId === "number" ? String(row.sourceId) : null) ??
    normalizeNpn(typeof row.id === "string" || typeof row.id === "number" ? String(row.id) : null);
  if (!npn) return null;

  const timeoutRaw = Number(
    row.timeoutCount ??
      row.timeout_count ??
      row.persistent_timeout ??
      row.retryCount ??
      row.retry_count ??
      NaN,
  );
  const timeoutCount = Number.isFinite(timeoutRaw) ? timeoutRaw : null;
  const brandName = sanitize(
    typeof row.brandName === "string" || typeof row.brand_name === "string"
      ? String(row.brandName ?? row.brand_name)
      : "",
  );
  const productName = sanitize(
    typeof row.productName === "string" || typeof row.product_name === "string"
      ? String(row.productName ?? row.product_name)
      : "",
  );
  const twoHopHint = sanitize(
    typeof row.twoHopHint === "string" || typeof row.two_hop_hint === "string"
      ? String(row.twoHopHint ?? row.two_hop_hint)
      : "",
  );
  const reason = sanitize(typeof row.reason === "string" ? String(row.reason) : "");

  return {
    npn,
    hint: {
      brandName: brandName || null,
      productName: productName || null,
      twoHopHint: twoHopHint || null,
      upcHints: extractUpcHintsFromRow(row),
      reason: reason || null,
      timeoutCount,
    },
  };
};

const loadQueueNpnHints = async (filePath: string): Promise<Map<string, QueueNpnHints>> => {
  const raw = await fs.promises.readFile(filePath, "utf8");
  const trimmed = raw.trim();
  const hints = new Map<string, QueueNpnHints>();
  if (!trimmed) return hints;

  const rows: Record<string, unknown>[] = [];
  const pushRowsFromUnknown = (payload: unknown) => {
    if (Array.isArray(payload)) {
      for (const entry of payload) {
        const obj = asObject(entry);
        if (obj) rows.push(obj);
      }
      return;
    }
    const obj = asObject(payload);
    if (!obj) return;
    rows.push(obj);
    const nestedKeys = ["queue", "rows", "items", "npns"];
    for (const key of nestedKeys) {
      const nested = obj[key];
      if (!Array.isArray(nested)) continue;
      for (const entry of nested) {
        const nestedObj = asObject(entry);
        if (nestedObj) rows.push(nestedObj);
      }
    }
  };

  if (trimmed.startsWith("[") || trimmed.startsWith("{")) {
    try {
      pushRowsFromUnknown(JSON.parse(trimmed));
    } catch {
      // Fall through to line parser for JSONL.
    }
  }

  if (rows.length === 0) {
    const lines = trimmed.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
    for (const line of lines) {
      if (!line.startsWith("{")) continue;
      try {
        const parsed = JSON.parse(line);
        pushRowsFromUnknown(parsed);
      } catch {
        // Ignore malformed line.
      }
    }
  }

  for (const row of rows) {
    const parsed = buildQueueNpnHint(row);
    if (!parsed) continue;
    const current = hints.get(parsed.npn);
    if (!current) {
      hints.set(parsed.npn, parsed.hint);
      continue;
    }
    const mergedUpc = Array.from(new Set([...current.upcHints, ...parsed.hint.upcHints])).slice(0, 5);
    hints.set(parsed.npn, {
      brandName: parsed.hint.brandName ?? current.brandName ?? null,
      productName: parsed.hint.productName ?? current.productName ?? null,
      twoHopHint: parsed.hint.twoHopHint ?? current.twoHopHint ?? null,
      upcHints: mergedUpc,
      reason: parsed.hint.reason ?? current.reason ?? null,
      timeoutCount: parsed.hint.timeoutCount ?? current.timeoutCount ?? null,
    });
  }

  return hints;
};

const buildRowContext = (row: LnhpdRow, queueHint?: QueueNpnHints | null): RowContext => {
  const brandText = sanitize(row.brand_name) || queueHint?.brandName || "";
  const productText = sanitize(row.product_name) || queueHint?.productName || queueHint?.twoHopHint || "";
  const brandTokens = normalizeLooseText(brandText)
    .split(" ")
    .filter(Boolean)
    .filter((token) => token.length >= 4 && !BRAND_STOP_WORDS.has(token))
    .slice(0, 3);
  const productTokens = normalizeLooseText(productText)
    .split(" ")
    .filter(Boolean)
    .filter((token) => token.length >= 4 && !PRODUCT_STOP_WORDS.has(token) && !/^\d+$/.test(token))
    .slice(0, 6);
  return { brandTokens, productTokens };
};

type ContextSignalCheck = {
  pass: boolean;
  brandOverlap: number;
  productOverlap: number;
  requiredBrandOverlap: number;
  requiredProductOverlap: number;
};

const evaluateRowContextSignals = (text: string, ctx: RowContext): ContextSignalCheck => {
  const normalized = text.trim();
  if (!normalized) {
    return {
      pass: false,
      brandOverlap: 0,
      productOverlap: 0,
      requiredBrandOverlap: 0,
      requiredProductOverlap: 0,
    };
  }
  const tokenHit = (token: string) => {
    if (normalized.includes(token)) return true;
    if (tokenStrictness === "low") {
      if (token.length >= 6 && normalized.includes(token.slice(0, token.length - 1))) return true;
      if (token.length >= 7 && normalized.includes(token.slice(0, token.length - 2))) return true;
    }
    return false;
  };
  const brandOverlap = ctx.brandTokens.filter((token) => tokenHit(token)).length;
  const productOverlap = ctx.productTokens.filter((token) => tokenHit(token)).length;
  const requiredBrandOverlap = strictBrandTokenGate ? Math.min(1, ctx.brandTokens.length) : (ctx.brandTokens.length > 0 ? 1 : 0);
  const requiredProductOverlap = strictProductTokenGate
    ? (tokenStrictness === "low" ? Math.min(1, ctx.productTokens.length) : Math.min(2, ctx.productTokens.length))
    : (ctx.productTokens.length > 0 ? 1 : 0);
  const pass = brandOverlap >= requiredBrandOverlap && productOverlap >= requiredProductOverlap;
  return { pass, brandOverlap, productOverlap, requiredBrandOverlap, requiredProductOverlap };
};

const hasStrongNpnBinding = (text: string, npn: string): boolean => {
  if (!text) return false;
  const strict = new RegExp(`\\b(?:product\\s*)?npn\\s*[:#-]?\\s*${npn}\\b`, "i");
  if (strict.test(text)) return true;
  const near = new RegExp(`\\bnpn\\b[^\\d]{0,16}${npn}\\b|\\b${npn}\\b[^\\d]{0,16}\\bnpn\\b`, "i");
  return near.test(text);
};

const parseCheckpoint = async (): Promise<Checkpoint> => {
  const nowIso = new Date().toISOString();
  const base: Checkpoint = {
    lastLnhpdId: null,
    listIndex: 0,
    processed: 0,
    queried: 0,
    matched: 0,
    upserted: 0,
    conflicts: 0,
    skippedExisting: 0,
    failed: 0,
    updatedFactsRows: 0,
    consideredLinks: 0,
    blockedDomainLinks: 0,
    rejectedByAllowlistLinks: 0,
    rejectedByContextLinks: 0,
    startedAt: nowIso,
    updatedAt: nowIso,
  };
  try {
    const raw = await fs.promises.readFile(checkpointFile, "utf8");
    const parsed = JSON.parse(raw) as Partial<Checkpoint>;
    return {
      ...base,
      ...parsed,
      startedAt: parsed.startedAt ?? nowIso,
      updatedAt: parsed.updatedAt ?? nowIso,
    };
  } catch {
    return base;
  }
};

const saveCheckpoint = async (cp: Checkpoint) => {
  cp.updatedAt = new Date().toISOString();
  await writeJson(checkpointFile, cp);
};

const buildQueries = (
  row: LnhpdRow,
  queueHint?: QueueNpnHints | null,
): { primary: string[]; fallback: string[] } => {
  const npn = sanitize(row.npn);
  const brand = sanitize(row.brand_name) || queueHint?.brandName || "";
  const product = sanitize(row.product_name) || queueHint?.productName || "";
  const twoHopHint = sanitize(queueHint?.twoHopHint ?? "");
  const upcHints = Array.isArray(queueHint?.upcHints) ? queueHint!.upcHints : [];

  const primary = new Set<string>();
  if (npn) primary.add(`NPN ${npn}`);
  if (npn && brand && product) primary.add(`NPN ${npn} ${brand} ${product}`);
  if (npn && product) primary.add(`NPN ${npn} ${product} barcode`);
  if (npn && brand) primary.add(`NPN ${npn} ${brand} barcode`);
  if (npn && brand && product) primary.add(`site:.ca NPN ${npn} ${brand} ${product}`);
  if (npn && twoHopHint) primary.add(`NPN ${npn} ${twoHopHint}`);

  const fallback = new Set<string>();
  if (enableUpcFallbackQuery && npn && brand) {
    for (const upc of upcHints) {
      fallback.add(`${brand} NPN ${npn} UPC ${upc}`);
      fallback.add(`site:.ca ${brand} NPN ${npn} ${upc} barcode`);
    }
    fallback.add(`${brand} NPN ${npn} UPC barcode`);
    if (product) {
      fallback.add(`site:.ca ${brand} ${product} NPN ${npn} UPC`);
    }
  }

  return { primary: Array.from(primary), fallback: Array.from(fallback) };
};

const fetchGoogleCse = async (query: string): Promise<SearchItem[]> => {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), cseTimeoutMs);
  try {
    const url = new URL(GOOGLE_CSE_ENDPOINT);
    url.searchParams.set("key", googleKey);
    url.searchParams.set("cx", googleCx);
    url.searchParams.set("q", query);
    url.searchParams.set("num", String(queryNum));
    url.searchParams.set("hl", searchHl);
    url.searchParams.set("gl", searchGl);

    const response = await fetch(url.toString(), {
      signal: controller.signal,
      headers: { accept: "application/json" },
    });

    const json = (await response.json().catch(() => null)) as {
      items?: SearchItem[];
      error?: { message?: string };
    } | null;

    if (!response.ok) {
      const message = json?.error?.message ?? `HTTP ${response.status}`;
      throw new Error(`google_cse_error: ${message}`);
    }

    return Array.isArray(json?.items) ? json!.items! : [];
  } finally {
    clearTimeout(timeout);
  }
};

const extractHtmlCandidates = (
  html: string,
  npn: string,
  link: string,
  rowContext: RowContext,
): CandidateEvidence[] => {
  const out: CandidateEvidence[] = [];
  const normalizedText = normalizeLooseText(html);
  const npnMentioned = hasStrongNpnBinding(html, npn);
  if (!npnMentioned) return out;
  if (!evaluateRowContextSignals(normalizedText, rowContext).pass) return out;

  const add = (rawCode: string, sourceType: CandidateEvidence["sourceType"]) => {
    const normalized = normalizeBarcodeInput(rawCode);
    if (!normalized) return;
    if (normalized.code.length < 12) return;
    if (normalized.isValidChecksum !== true) return;
    const gtin14 = normalized.variants.find((value) => /^\d{14}$/.test(value)) ?? null;
    if (!gtin14) return;
    if (/^(\d)\1{13}$/.test(gtin14)) return;
    const trimmed = gtin14.replace(/^0+/, "");
    if (trimmed.length < 8) return;
    out.push({
      barcodeGtin14: gtin14,
      raw: normalized.code,
      link,
      sourceType,
      npnMentioned,
    });
  };

  const jsonLdRegex = /"(?:gtin\d*|gtin|barcode|upc|ean)"\s*:\s*"(\d{8,14})"/gi;
  let match: RegExpExecArray | null;
  while ((match = jsonLdRegex.exec(html))) {
    add(match[1], "jsonld");
  }

  const keywordRegex = /(?:upc|ean|gtin|barcode|sku)\D{0,24}((?:\d[\s-]?){8,14})/gi;
  while ((match = keywordRegex.exec(html))) {
    add(match[1], "keyword");
  }

  return out;
};

const extractSnippetCandidates = (
  snippetText: string,
  npn: string,
  link: string,
  rowContext: RowContext,
): CandidateEvidence[] => {
  const out: CandidateEvidence[] = [];
  const normalizedText = normalizeLooseText(snippetText);
  if (!hasStrongNpnBinding(snippetText, npn)) return out;
  if (!evaluateRowContextSignals(normalizedText, rowContext).pass) return out;
  const regex = /(?:upc|ean|gtin|barcode|sku)\D{0,24}((?:\d[\s-]?){8,14})/gi;
  let match: RegExpExecArray | null;
  while ((match = regex.exec(snippetText))) {
    const normalized = normalizeBarcodeInput(match[1]);
    if (!normalized) continue;
    if (normalized.code.length < 12) continue;
    if (normalized.isValidChecksum !== true) continue;
    const gtin14 = normalized.variants.find((value) => /^\d{14}$/.test(value)) ?? null;
    if (!gtin14) continue;
    if (/^(\d)\1{13}$/.test(gtin14)) continue;
    const trimmed = gtin14.replace(/^0+/, "");
    if (trimmed.length < 8) continue;
    out.push({
      barcodeGtin14: gtin14,
      raw: normalized.code,
      link,
      sourceType: "snippet",
      npnMentioned: true,
    });
  }
  return out;
};

const fetchHtml = async (url: string): Promise<string | null> => {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), htmlTimeoutMs);
  try {
    const response = await fetch(url, {
      signal: controller.signal,
      headers: {
        "user-agent":
          "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36",
        accept: "text/html,application/xhtml+xml",
      },
      redirect: "follow",
    });
    if (!response.ok) return null;
    const contentType = response.headers.get("content-type") ?? "";
    if (!/html|text/i.test(contentType)) return null;
    return await response.text();
  } catch {
    return null;
  } finally {
    clearTimeout(timeout);
  }
};

const dedupeByBarcode = (items: CandidateEvidence[]): CandidateEvidence[] => {
  const byCode = new Map<string, CandidateEvidence>();
  for (const item of items) {
    const prev = byCode.get(item.barcodeGtin14);
    if (!prev) {
      byCode.set(item.barcodeGtin14, item);
      continue;
    }
    const rank = (entry: CandidateEvidence) => {
      let score = 0;
      if (entry.npnMentioned) score += 5;
      if (entry.sourceType === "jsonld") score += 3;
      if (entry.sourceType === "keyword") score += 2;
      if (entry.sourceType === "snippet") score += 1;
      return score;
    };
    if (rank(item) > rank(prev)) {
      byCode.set(item.barcodeGtin14, item);
    }
  }
  return Array.from(byCode.values());
};

const rankEvidence = (entry: CandidateEvidence): number => {
  let score = 0;
  if (entry.npnMentioned) score += 5;
  if (entry.sourceType === "jsonld") score += 3;
  if (entry.sourceType === "keyword") score += 2;
  if (entry.sourceType === "snippet") score += 1;
  return score;
};

const loadBatch = async (afterLnhpdId: number | null): Promise<LnhpdRow[]> => {
  let query = supabase
    .from("lnhpd_facts")
    .select("lnhpd_id,npn,brand_name,product_name,facts_json")
    .order("lnhpd_id", { ascending: true })
    .limit(pageSize);
  if (afterLnhpdId != null) {
    query = query.gt("lnhpd_id", afterLnhpdId);
  }
  if (onlyNpn) {
    query = query.eq("npn", onlyNpn);
  }
  const { data, error } = await query;
  if (error) {
    throw new Error(`load_batch_failed: ${error.message}`);
  }
  return ((data ?? []) as LnhpdRow[]).filter((row) => normalizeNpn(row.npn));
};

const loadRowsByNpns = async (npns: string[]): Promise<LnhpdRow[]> => {
  if (!npns.length) return [];
  const out: LnhpdRow[] = [];
  const chunkSize = 200;
  for (let i = 0; i < npns.length; i += chunkSize) {
    const chunk = npns.slice(i, i + chunkSize);
    const { data, error } = await supabase
      .from("lnhpd_facts")
      .select("lnhpd_id,npn,brand_name,product_name,facts_json")
      .in("npn", chunk)
      .order("lnhpd_id", { ascending: true });
    if (error) {
      throw new Error(`load_rows_by_npns_failed: ${error.message}`);
    }
    out.push(...((data ?? []) as LnhpdRow[]));
  }

  // Keep first row per NPN to avoid duplicate aliases in LNHPD names.
  const firstByNpn = new Map<string, LnhpdRow>();
  for (const row of out) {
    const npn = normalizeNpn(row.npn);
    if (!npn || firstByNpn.has(npn)) continue;
    firstByNpn.set(npn, row);
  }

  const ordered: LnhpdRow[] = [];
  for (const npn of npns) {
    const row = firstByNpn.get(npn);
    if (row) ordered.push(row);
  }
  return ordered;
};

const loadExistingMapNpns = async (npns: string[]): Promise<Set<string>> => {
  if (!npns.length) return new Set();
  const existing = new Set<string>();
  const chunkSize = 200;
  for (let i = 0; i < npns.length; i += chunkSize) {
    const chunk = npns.slice(i, i + chunkSize);
    const { data, error } = await supabase
      .from("barcode_regulatory_map")
      .select("npn")
      .in("npn", chunk)
      .limit(1000);
    if (error) {
      throw new Error(`load_existing_map_failed: ${error.message}`);
    }
    (data ?? []).forEach((row: { npn?: string | null }) => {
      const npn = normalizeNpn(row.npn);
      if (npn) existing.add(npn);
    });
  }
  return existing;
};

const upsertMapping = async (params: {
  npn: string;
  barcodeGtin14: string;
  raw: string;
  confidence: number;
  source: string;
}): Promise<"upserted" | "conflict" | "skipped"> => {
  if (dryRun) return "skipped";

  const outcome = await upsertRegulatoryMapWithPolicy(
    {
      barcodeGtin14: params.barcodeGtin14,
      barcodeRaw: params.raw,
      npn: params.npn,
      confidence: params.confidence,
      source: params.source,
      expiresAt: null,
    },
    { timeoutMs: 1500, keyContractMode: "enforce", writeGuardMode: "enforce" },
  );
  if (outcome.status === "blocked") {
    const existing = outcome.existing;
    if (existing && normalizeNpn(existing.npn) && normalizeNpn(existing.npn) !== params.npn) {
      return "conflict";
    }
    return "skipped";
  }
  return "upserted";
};

const updateFactsJson = async (row: LnhpdRow, barcodes: string[], incomingMeta: BarcodeCandidateMetaEntry[]) => {
  if (!writeFacts || dryRun) return false;
  const now = new Date().toISOString();
  const facts = row.facts_json && typeof row.facts_json === "object" ? { ...row.facts_json } : {};
  const merged = mergeFactsBarcodeCandidates({
    facts: facts as Record<string, unknown>,
    incomingBarcodes: barcodes,
    incomingMeta,
    maxCount: maxBarcodesPerNpn,
  });
  facts.barcodeCandidates = merged.barcodes;
  if (merged.meta.length > 0) {
    (facts as Record<string, unknown>).barcodeCandidatesMeta = merged.meta;
  } else {
    delete (facts as Record<string, unknown>).barcodeCandidatesMeta;
  }
  facts.barcodeSource = "web_npn_enrich_v1";
  facts.barcodeUpdatedAt = now;

  const { error } = await supabase
    .from("lnhpd_facts")
    .update({ facts_json: facts })
    .eq("lnhpd_id", row.lnhpd_id);
  if (error) {
    throw new Error(`update_facts_failed: ${error.message}`);
  }
  return true;
};

const processRow = async (row: LnhpdRow, queueHint?: QueueNpnHints | null) => {
  const npn = normalizeNpn(row.npn);
  if (!npn) {
    return {
      status: "skip" as const,
      reason: "invalid_npn",
      barcodes: [] as string[],
      evidences: [] as CandidateEvidence[],
      queries: [] as string[],
      primaryQueries: [] as string[],
      fallbackQueries: [] as string[],
      fallbackUsed: false,
      npnWithoutValidGtinSeen: false,
      consideredLinks: 0,
      blockedDomainLinks: 0,
      rejectedByAllowlistLinks: 0,
      rejectedByContextLinks: 0,
    };
  }

  const effectiveAttempts = Math.max(1, Math.min(maxQueriesPerNpn, maxAttemptsPerNpn));
  const queryPlan = buildQueries(row, queueHint);
  const primaryQueries = queryPlan.primary.slice(0, effectiveAttempts);
  const rowContext = buildRowContext(row, queueHint);

  const runQuerySet = async (queriesToRun: string[]) => {
    const allItems: SearchItem[] = [];
    for (const query of queriesToRun) {
      const items = await fetchGoogleCse(query);
      allItems.push(...items);
      await sleep(queryDelayMs);
    }

    const dedupLinkMap = new Map<string, SearchItem>();
    for (const item of allItems) {
      const link = sanitize(item.link);
      if (!link) continue;
      if (!/^https?:\/\//i.test(link)) continue;
      if (!dedupLinkMap.has(link)) dedupLinkMap.set(link, item);
    }

    const links = Array.from(dedupLinkMap.keys()).slice(0, Math.max(4, effectiveAttempts * 3));
    const evidences: CandidateEvidence[] = [];
    let consideredLinks = 0;
    let blockedDomainLinks = 0;
    let rejectedByAllowlistLinks = 0;
    let rejectedByContextLinks = 0;
    let npnWithoutValidGtinSeen = false;

    for (const link of links) {
      const domain = extractDomain(link);
      if (!domain) continue;
      if (isBlockedDomain(domain)) {
        blockedDomainLinks += 1;
        continue;
      }
      if (!isAllowedDomain(domain)) {
        rejectedByAllowlistLinks += 1;
        continue;
      }
      consideredLinks += 1;

      const item = dedupLinkMap.get(link);
      const snippetText = `${item?.title ?? ""} ${item?.snippet ?? ""}`;
      const snippetHasNpn = hasStrongNpnBinding(snippetText, npn);
      const snippetContext = evaluateRowContextSignals(normalizeLooseText(snippetText), rowContext);
      if (snippetContext.pass) {
        const snippetEvidence = extractSnippetCandidates(snippetText, npn, link, rowContext);
        if (snippetHasNpn && snippetEvidence.length === 0) {
          npnWithoutValidGtinSeen = true;
        }
        evidences.push(...snippetEvidence);
      } else {
        rejectedByContextLinks += 1;
      }

      const html = await fetchHtml(link);
      if (!html) continue;
      const htmlHasNpn = hasStrongNpnBinding(html, npn);
      const htmlContext = evaluateRowContextSignals(normalizeLooseText(html), rowContext);
      if (!htmlContext.pass) {
        rejectedByContextLinks += 1;
        continue;
      }
      const htmlEvidence = extractHtmlCandidates(html, npn, link, rowContext);
      if (htmlHasNpn && htmlEvidence.length === 0) {
        npnWithoutValidGtinSeen = true;
      }
      evidences.push(...htmlEvidence);
    }

    return {
      evidences,
      consideredLinks,
      blockedDomainLinks,
      rejectedByAllowlistLinks,
      rejectedByContextLinks,
      npnWithoutValidGtinSeen,
    };
  };

  const primaryResult = await runQuerySet(primaryQueries);
  const fallbackQueries = queryPlan.fallback.slice(0, Math.max(1, Math.min(2, effectiveAttempts)));
  const shouldRunFallback =
    enableUpcFallbackQuery &&
    primaryResult.npnWithoutValidGtinSeen &&
    fallbackQueries.length > 0;
  const fallbackResult = shouldRunFallback ? await runQuerySet(fallbackQueries) : null;

  const allEvidences = [
    ...primaryResult.evidences,
    ...(fallbackResult ? fallbackResult.evidences : []),
  ];
  const picked = dedupeByBarcode(allEvidences)
    .filter((entry) => entry.npnMentioned)
    .sort((a, b) => rankEvidence(b) - rankEvidence(a))
    .slice(0, maxBarcodesPerNpn);
  const barcodes = picked.map((entry) => entry.barcodeGtin14);

  return {
    status: barcodes.length > 0 ? ("matched" as const) : ("no_match" as const),
    reason: barcodes.length > 0 ? null : "no_high_confidence_candidate",
    barcodes,
    evidences: picked,
    queries: [...primaryQueries, ...(shouldRunFallback ? fallbackQueries : [])],
    primaryQueries,
    fallbackQueries: shouldRunFallback ? fallbackQueries : [],
    fallbackUsed: shouldRunFallback,
    npnWithoutValidGtinSeen:
      primaryResult.npnWithoutValidGtinSeen || Boolean(fallbackResult?.npnWithoutValidGtinSeen),
    consideredLinks: primaryResult.consideredLinks + (fallbackResult?.consideredLinks ?? 0),
    blockedDomainLinks: primaryResult.blockedDomainLinks + (fallbackResult?.blockedDomainLinks ?? 0),
    rejectedByAllowlistLinks:
      primaryResult.rejectedByAllowlistLinks + (fallbackResult?.rejectedByAllowlistLinks ?? 0),
    rejectedByContextLinks:
      primaryResult.rejectedByContextLinks + (fallbackResult?.rejectedByContextLinks ?? 0),
  };
};

const loadTotalLnhpdRowsWithNpn = async (): Promise<number | null> => {
  const { count, error } = await supabase
    .from("lnhpd_facts")
    .select("lnhpd_id", { head: true, count: "exact" })
    .not("npn", "is", null);
  if (error) return null;
  return typeof count === "number" ? count : null;
};

const loadWebEnrichMappedBarcodeCount = async (): Promise<number | null> => {
  const { count, error } = await supabase
    .from("barcode_regulatory_map")
    .select("barcode_gtin14", { head: true, count: "exact" })
    .eq("source", "web_npn_enrich_v1");
  if (error) return null;
  return typeof count === "number" ? count : null;
};

const loadWebEnrichMappedFactsRowCount = async (): Promise<number | null> => {
  const { count, error } = await supabase
    .from("lnhpd_facts")
    .select("lnhpd_id", { head: true, count: "exact" })
    .eq("facts_json->>barcodeSource", "web_npn_enrich_v1");
  if (error) return null;
  return typeof count === "number" ? count : null;
};

const ratio = (numerator: number, denominator: number): number =>
  denominator > 0 ? Number((numerator / denominator).toFixed(6)) : 0;

const main = async () => {
  const checkpoint = await parseCheckpoint();
  const startedAt = new Date().toISOString();
  let lastId = checkpoint.lastLnhpdId;
  let pages = 0;
  const npnQueueList = npnQueueFile ? await loadNpnListFromFile(npnQueueFile) : [];
  const npnQueueHints = npnQueueFile ? await loadQueueNpnHints(npnQueueFile) : new Map<string, QueueNpnHints>();
  const npnFileList = npnFile ? await loadNpnListFromFile(npnFile) : [];
  const npnListCombined = [...npnQueueList, ...npnFileList];
  const npnList = npnListCombined.length > 0 ? Array.from(new Set(npnListCombined)) : null;
  if (npnList && (checkpoint.listIndex ?? 0) > npnList.length) {
    checkpoint.listIndex = npnList.length;
  }

  await ensureDir(matchesJsonl);
  await ensureDir(failuresJsonl);

  while (true) {
    if (maxPages > 0 && pages >= maxPages) break;
    if (maxNpns > 0 && checkpoint.processed >= maxNpns) break;

    let batch: LnhpdRow[] = [];
    let listSliceCount = 0;
    if (npnList) {
      const startIndex = checkpoint.listIndex ?? 0;
      const remainingLimit = maxNpns > 0 ? Math.max(0, maxNpns - checkpoint.processed) : 0;
      const npnSliceSize =
        maxNpns > 0 ? Math.min(pageSize, Math.max(1, remainingLimit)) : pageSize;
      const pendingNpns = npnList.slice(startIndex, startIndex + npnSliceSize);
      listSliceCount = pendingNpns.length;
      if (!pendingNpns.length) break;
      batch = await loadRowsByNpns(pendingNpns);
      if (!batch.length) {
        checkpoint.listIndex = startIndex + listSliceCount;
        await saveCheckpoint(checkpoint);
        continue;
      }
    } else {
      batch = await loadBatch(lastId);
      if (!batch.length) break;
    }
    pages += 1;

    const normalizedNpns = batch
      .map((row) => normalizeNpn(row.npn))
      .filter((value): value is string => Boolean(value));

    const existingMapNpns = skipExistingNpn ? await loadExistingMapNpns(normalizedNpns) : new Set<string>();

    for (const row of batch) {
      if (maxNpns > 0 && checkpoint.processed >= maxNpns) break;

      lastId = row.lnhpd_id;
      checkpoint.lastLnhpdId = lastId;
      checkpoint.processed += 1;

      const npn = normalizeNpn(row.npn);
      if (!npn) {
        await appendJsonl(failuresJsonl, {
          lnhpdId: row.lnhpd_id,
          npn: row.npn,
          failCode: "invalid_npn",
          at: new Date().toISOString(),
        });
        checkpoint.failed += 1;
        await saveCheckpoint(checkpoint);
        continue;
      }

      if (skipExistingNpn && existingMapNpns.has(npn)) {
        checkpoint.skippedExisting += 1;
        await appendJsonl(matchesJsonl, {
          lnhpdId: row.lnhpd_id,
          npn,
          status: "skip_existing_npn",
          at: new Date().toISOString(),
        });
        await saveCheckpoint(checkpoint);
        continue;
      }

      try {
        checkpoint.queried += 1;
        const result = await processRow(row, npnQueueHints.get(npn) ?? null);
        checkpoint.consideredLinks += result.consideredLinks ?? 0;
        checkpoint.blockedDomainLinks += result.blockedDomainLinks ?? 0;
        checkpoint.rejectedByAllowlistLinks += result.rejectedByAllowlistLinks ?? 0;
        checkpoint.rejectedByContextLinks += result.rejectedByContextLinks ?? 0;

        if (result.status !== "matched") {
          await appendJsonl(failuresJsonl, {
            lnhpdId: row.lnhpd_id,
            npn,
            brandName: row.brand_name,
            productName: row.product_name,
            failCode: result.reason,
            queries: result.queries,
            primaryQueries: result.primaryQueries,
            fallbackQueries: result.fallbackQueries,
            fallbackUsed: result.fallbackUsed,
            npnWithoutValidGtinSeen: result.npnWithoutValidGtinSeen,
            consideredLinks: result.consideredLinks,
            blockedDomainLinks: result.blockedDomainLinks,
            rejectedByAllowlistLinks: result.rejectedByAllowlistLinks,
            rejectedByContextLinks: result.rejectedByContextLinks,
            at: new Date().toISOString(),
          });
          await saveCheckpoint(checkpoint);
          continue;
        }

        checkpoint.matched += 1;
        const upserted: string[] = [];
        const conflicted: string[] = [];
        for (const evidence of result.evidences) {
          const action = await upsertMapping({
            npn,
            barcodeGtin14: evidence.barcodeGtin14,
            raw: evidence.raw,
            confidence: evidence.sourceType === "jsonld" ? 0.95 : 0.88,
            source: "web_npn_enrich_v1",
          });
          if (action === "upserted") {
            checkpoint.upserted += 1;
            upserted.push(evidence.barcodeGtin14);
          } else if (action === "conflict") {
            checkpoint.conflicts += 1;
            conflicted.push(evidence.barcodeGtin14);
          }
        }

        if (upserted.length > 0) {
          const incomingMeta = result.evidences
            .filter((evidence) => upserted.includes(evidence.barcodeGtin14))
            .map((evidence) => ({
              barcode: evidence.barcodeGtin14,
              source: "web_npn_enrich_v1",
              evidence: evidence.link,
              matchMode: evidence.sourceType,
              confidence: evidence.sourceType === "jsonld" ? 0.95 : 0.88,
              lastSeenAt: new Date().toISOString(),
            }));
          const factsUpdated = await updateFactsJson(row, upserted, incomingMeta);
          if (factsUpdated) checkpoint.updatedFactsRows += 1;
        }

        await appendJsonl(matchesJsonl, {
          lnhpdId: row.lnhpd_id,
          npn,
          brandName: row.brand_name,
          productName: row.product_name,
          barcodes: result.barcodes,
          upserted,
          conflicted,
          evidence: result.evidences.slice(0, 8),
          queries: result.queries,
          primaryQueries: result.primaryQueries,
          fallbackQueries: result.fallbackQueries,
          fallbackUsed: result.fallbackUsed,
          npnWithoutValidGtinSeen: result.npnWithoutValidGtinSeen,
          consideredLinks: result.consideredLinks,
          blockedDomainLinks: result.blockedDomainLinks,
          rejectedByAllowlistLinks: result.rejectedByAllowlistLinks,
          rejectedByContextLinks: result.rejectedByContextLinks,
          at: new Date().toISOString(),
        });
      } catch (error) {
        checkpoint.failed += 1;
        await appendJsonl(failuresJsonl, {
          lnhpdId: row.lnhpd_id,
          npn,
          brandName: row.brand_name,
          productName: row.product_name,
          failCode: "exception",
          message: error instanceof Error ? error.message : String(error),
          at: new Date().toISOString(),
        });
      }

      await saveCheckpoint(checkpoint);
    }

    if (npnList) {
      checkpoint.listIndex = (checkpoint.listIndex ?? 0) + listSliceCount;
      await saveCheckpoint(checkpoint);
    }

    if (batch.length < pageSize) break;
  }

  const [totalWithNpn, mappedBarcodeCount, mappedFactsCount] = await Promise.all([
    loadTotalLnhpdRowsWithNpn(),
    loadWebEnrichMappedBarcodeCount(),
    loadWebEnrichMappedFactsRowCount(),
  ]);

  const consideredLinks = checkpoint.consideredLinks;
  const blockedLinks = checkpoint.blockedDomainLinks;
  const allowlistRejectedLinks = checkpoint.rejectedByAllowlistLinks;
  const contextRejectedLinks = checkpoint.rejectedByContextLinks;
  const totalEvaluatedLinks = consideredLinks + blockedLinks + allowlistRejectedLinks;
  const totalWriteAttempts = checkpoint.upserted + checkpoint.conflicts;
  const coverage = {
    totalWithNpn,
    mappedBarcodeCount,
    mappedFactsCount,
    barcodeMapCoverageRate:
      typeof totalWithNpn === "number" && typeof mappedBarcodeCount === "number"
        ? ratio(mappedBarcodeCount, totalWithNpn)
        : null,
    factsCoverageRate:
      typeof totalWithNpn === "number" && typeof mappedFactsCount === "number"
        ? ratio(mappedFactsCount, totalWithNpn)
        : null,
  };

  const coverageReport = {
    generatedAt: new Date().toISOString(),
    source: "web_npn_enrich_v1",
    mode: dryRun ? "dry_run" : "write",
    qualityGate: {
      blockedDomains: Array.from(blockedDomains).sort(),
      allowedDomains: allowedDomains ? Array.from(allowedDomains).sort() : null,
      blockedDomainLinks: blockedLinks,
      rejectedByAllowlistLinks: allowlistRejectedLinks,
      rejectedByContextLinks: contextRejectedLinks,
      consideredLinks,
      totalEvaluatedLinks,
      blockedDomainRate: ratio(blockedLinks, totalEvaluatedLinks),
      allowlistRejectedRate: ratio(allowlistRejectedLinks, totalEvaluatedLinks),
      contextRejectedRate: Number(
        Math.min(1, ratio(contextRejectedLinks, Math.max(1, consideredLinks * 2))).toFixed(6),
      ),
      conflictCandidatesBlocked: checkpoint.conflicts,
      conflictBlockRate: ratio(checkpoint.conflicts, totalWriteAttempts),
    },
    run: {
      startedAt,
      finishedAt: new Date().toISOString(),
      processed: checkpoint.processed,
      queried: checkpoint.queried,
      matched: checkpoint.matched,
      upserted: checkpoint.upserted,
      conflicts: checkpoint.conflicts,
      skippedExisting: checkpoint.skippedExisting,
      failed: checkpoint.failed,
      updatedFactsRows: checkpoint.updatedFactsRows,
      onlyNpn,
      npnFile: npnFile ?? null,
      npnQueueFile: npnQueueFile ?? null,
      npnListSize: npnList?.length ?? null,
      listIndex: npnList ? checkpoint.listIndex ?? 0 : null,
      maxPages,
      maxNpns,
      maxBarcodesPerNpn,
      pageSize,
      queryNum,
      maxQueriesPerNpn,
      maxAttemptsPerNpn,
      queryDelayMs,
      cseTimeoutMs,
      htmlTimeoutMs,
      strictBrandTokenGate,
      strictProductTokenGate,
      tokenStrictness,
      enableUpcFallbackQuery,
      npnQueueHintsSize: npnQueueHints.size,
    },
    coverage,
    output: {
      checkpointFile,
      summaryJson,
      matchesJsonl,
      failuresJsonl,
      coverageReportJson,
    },
  };

  await writeJson(coverageReportJson, coverageReport);

  const summary = {
    startedAt,
    finishedAt: new Date().toISOString(),
    dryRun,
    writeFacts,
    skipExistingNpn,
    onlyNpn,
    npnFile: npnFile ?? null,
    npnQueueFile: npnQueueFile ?? null,
    npnListSize: npnList?.length ?? null,
    listIndex: npnList ? checkpoint.listIndex ?? 0 : null,
    pageSize,
    queryNum,
    maxQueriesPerNpn,
    maxAttemptsPerNpn,
    queryDelayMs,
    maxPages,
    maxNpns,
    maxBarcodesPerNpn,
    cseTimeoutMs,
    htmlTimeoutMs,
    strictBrandTokenGate,
    strictProductTokenGate,
    tokenStrictness,
    enableUpcFallbackQuery,
    npnQueueHintsSize: npnQueueHints.size,
    qualityGate: coverageReport.qualityGate,
    coverage,
    checkpoint,
    output: {
      checkpointFile,
      summaryJson,
      matchesJsonl,
      failuresJsonl,
      coverageReportJson,
    },
  };

  await writeJson(summaryJson, summary);
  console.log(JSON.stringify(summary, null, 2));
};

main().catch(async (error) => {
  const payload = {
    at: new Date().toISOString(),
    fatal: true,
    message: error instanceof Error ? error.message : String(error),
  };
  console.error("[lnhpd-barcode-enrich] fatal", payload.message);
  await appendJsonl(failuresJsonl, payload);
  process.exit(1);
});
