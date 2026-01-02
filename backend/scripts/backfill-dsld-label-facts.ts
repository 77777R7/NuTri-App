import { supabase } from '../src/supabase.js';

type MetaRow = {
  dsld_label_id: number | string | null;
  serving_size_raw: string | null;
  servings_per_container: number | string | null;
  active_ingredients_summary: string | null;
  inactive_ingredients: string | null;
  dsld_product_version_code: string | null;
  dsld_pdf: string | null;
  dsld_thumbnail: string | null;
};

type FactActive = {
  name: string;
  amount: number | null;
  unit: string | null;
};

type FactsJson = {
  servingSize: string | null;
  servingsPerContainer: number | null;
  actives: FactActive[];
  inactive: string[];
  proprietaryBlends: {
    name: string;
    totalAmount: number | null;
    unit: string | null;
    ingredients: string[] | null;
  }[];
  dsldPdf: string | null;
  dsldThumbnail: string | null;
  datasetVersion: string | null;
};

type FactsRow = {
  dsld_label_id: number;
  facts_json: FactsJson;
  dataset_version: string | null;
  extracted_at: string;
};

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

const normalizeUnitLabel = (unitRaw?: string | null): string | null => {
  if (!unitRaw) return null;
  const normalized = unitRaw.trim().toLowerCase();
  if (!normalized) return null;
  if (normalized.startsWith('mcg') || normalized.startsWith('ug') || normalized.startsWith('µg') || normalized.startsWith('μg')) {
    return 'mcg';
  }
  if (normalized.startsWith('mg')) return 'mg';
  if (normalized.startsWith('g')) return 'g';
  if (normalized.startsWith('iu') || normalized.startsWith('i.u')) return 'iu';
  if (normalized.startsWith('ml')) return 'ml';
  if (normalized.includes('cfu') || normalized.includes('ufc')) return 'cfu';
  if (normalized.startsWith('%')) return '%';
  if (normalized.startsWith('cal')) return 'cal';
  if (normalized.startsWith('kcal')) return 'kcal';
  return normalized;
};

const parseDelimitedList = (value: string | null | undefined): string[] => {
  if (!value) return [];
  return value
    .split(/;|•/g)
    .map((item) => item.trim())
    .filter(Boolean);
};

const parseActiveSummaryLine = (rawLine: string): FactActive => {
  const cleaned = rawLine.replace(/\{[^}]*\}/g, '').trim();
  if (!cleaned) {
    return { name: rawLine.trim(), amount: null, unit: null };
  }

  const npMatch = cleaned.match(/^(.*?)(?:\s+0+\s*(?:np|n\/p)|\s+(?:np|n\/p|not present))\s*$/i);
  if (npMatch) {
    const name = npMatch[1]?.trim() || cleaned;
    return { name, amount: null, unit: 'np' };
  }

  const amountUnitMatch = cleaned.match(
    /(.*?)(\d+(?:\.\d+)?)\s*(mcg|μg|µg|ug|mg|g|iu|ml|cfu|ufc|kcal|cal|calorie(?:s)?|%\s*dv|%dv|%)/i,
  );
  if (amountUnitMatch) {
    const [, name, amountRaw, unitRaw] = amountUnitMatch;
    const amount = Number(amountRaw);
    const unitNormalized = normalizeUnitLabel(unitRaw);
    return {
      name: name.trim(),
      amount: Number.isFinite(amount) ? amount : null,
      unit: unitNormalized,
    };
  }

  const numericMatch = cleaned.match(/(.*?)(\d+(?:\.\d+)?)$/);
  if (numericMatch) {
    const [, name, amountRaw] = numericMatch;
    const amount = Number(amountRaw);
    return {
      name: name.trim(),
      amount: Number.isFinite(amount) ? amount : null,
      unit: null,
    };
  }

  return { name: cleaned, amount: null, unit: null };
};

const buildFactsJson = (row: MetaRow): FactsJson => {
  const actives = parseDelimitedList(row.active_ingredients_summary).map(parseActiveSummaryLine);
  const inactive = parseDelimitedList(row.inactive_ingredients);
  const servingsPerContainer = parseNumber(row.servings_per_container);

  return {
    servingSize: row.serving_size_raw ?? null,
    servingsPerContainer,
    actives,
    inactive,
    proprietaryBlends: [],
    dsldPdf: row.dsld_pdf ?? null,
    dsldThumbnail: row.dsld_thumbnail ?? null,
    datasetVersion: row.dsld_product_version_code ?? null,
  };
};

const toLabelId = (value: MetaRow['dsld_label_id']): number | null => {
  const parsed = parseNumber(value);
  if (parsed == null) return null;
  return Math.trunc(parsed);
};

const batchSize = Math.max(1, Number(getArg('batch') ?? process.env.BACKFILL_BATCH_SIZE ?? '500'));
const limit = Math.max(0, Number(getArg('limit') ?? process.env.BACKFILL_LIMIT ?? '0'));
const startId = Math.max(0, Number(getArg('start-id') ?? '0'));
const dryRun = hasFlag('dry-run');

const main = async () => {
  let from = 0;
  let processed = 0;
  let batch = 0;

  while (true) {
    let query = supabase
      .from('dsld_labels_meta')
      .select(
        'dsld_label_id,serving_size_raw,servings_per_container,active_ingredients_summary,inactive_ingredients,dsld_product_version_code,dsld_pdf,dsld_thumbnail',
      )
      .order('dsld_label_id', { ascending: true });

    if (startId > 0) {
      query = query.gte('dsld_label_id', startId);
    }

    const { data, error } = await query.range(from, from + batchSize - 1);
    if (error) {
      throw new Error(`supabase read failed: ${error.message}`);
    }

    const rows = (data ?? []) as MetaRow[];
    if (rows.length === 0) break;

    const extractedAt = new Date().toISOString();
    const payload: FactsRow[] = rows
      .map((row) => {
        const labelId = toLabelId(row.dsld_label_id);
        if (!labelId) return null;
        return {
          dsld_label_id: labelId,
          facts_json: buildFactsJson(row),
          dataset_version: row.dsld_product_version_code ?? null,
          extracted_at: extractedAt,
        };
      })
      .filter((row): row is FactsRow => Boolean(row));

    if (!dryRun && payload.length > 0) {
      const { error: upsertError } = await supabase
        .from('dsld_label_facts')
        .upsert(payload, { onConflict: 'dsld_label_id' });
      if (upsertError) {
        throw new Error(`supabase upsert failed: ${upsertError.message}`);
      }
    }

    processed += payload.length;
    batch += 1;
    console.log(
      `[backfill] batch=${batch} fetched=${rows.length} inserted=${payload.length} total=${processed}`,
    );

    if (limit > 0 && processed >= limit) break;

    from += batchSize;
  }

  console.log(`[backfill] done total=${processed}`);
};

main().catch((error) => {
  console.error('[backfill] failed', error instanceof Error ? error.message : error);
  process.exit(1);
});
