import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

import { supabase } from "../src/supabase.js";
import { extractErrorMeta, withRetry } from "../src/supabaseRetry.js";

type IngredientRow = {
  source_id: string | null;
  canonical_source_id: string | null;
  ingredient_id: string | null;
  form_raw: string | null;
  updated_at: string | null;
};

type CanonicalStats = {
  canonicalSourceId: string;
  sampleSourceId: string | null;
  rows: number;
  formRawEmpty: number;
  formRawNonEmpty: number;
  lastUpdatedAt: string | null;
};

const args = process.argv.slice(2);
const getArg = (flag: string) => {
  const idx = args.indexOf(`--${flag}`);
  if (idx === -1) return null;
  return args[idx + 1] ?? null;
};

const SOURCE_IDS_FILE = getArg("source-ids-file");
const ID_COLUMN = (getArg("id-column") ?? "canonical_source_id").trim();
const OUTPUT =
  getArg("output") ?? "output/formraw/formraw_precheck_lnhpd.json";
const CHUNK_SIZE = Math.max(1, Number(getArg("chunk-size") ?? "200"));

const ensureDir = async (filePath: string) => {
  const dir = path.dirname(filePath);
  if (!dir || dir === ".") return;
  await mkdir(dir, { recursive: true });
};

const isEmptyFormRaw = (value: string | null | undefined): boolean =>
  !value || !value.trim();

const normalizeIdValue = (value: unknown): string | null => {
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  if (typeof value === "string") {
    const trimmed = value.trim();
    return trimmed.length > 0 ? trimmed : null;
  }
  return null;
};

const loadSourceIds = async (filePath: string): Promise<string[]> => {
  const raw = await readFile(filePath, "utf8");
  const parsed = JSON.parse(raw);
  if (Array.isArray(parsed)) {
    return parsed
      .map((value) => normalizeIdValue(value))
      .filter((value): value is string => Boolean(value));
  }
  if (parsed && Array.isArray(parsed.sourceIds)) {
    return parsed.sourceIds
      .map((value: unknown) => normalizeIdValue(value))
      .filter((value): value is string => Boolean(value));
  }
  throw new Error(`[formraw-precheck] invalid source ids file: ${filePath}`);
};

const chunkArray = <T>(items: T[], size: number): T[][] => {
  const chunks: T[][] = [];
  for (let i = 0; i < items.length; i += size) {
    chunks.push(items.slice(i, i + size));
  }
  return chunks;
};

const fetchRowsForSourceIds = async (
  sourceIds: string[],
  idColumn: string,
): Promise<IngredientRow[]> => {
  const rows: IngredientRow[] = [];
  for (const chunk of chunkArray(sourceIds, CHUNK_SIZE)) {
    const { data, error } = await withRetry(() =>
      supabase
        .from("product_ingredients")
        .select("source_id,canonical_source_id,ingredient_id,form_raw,updated_at")
        .eq("source", "lnhpd")
        .eq("is_active", true)
        .not("ingredient_id", "is", null)
        .in(idColumn, chunk),
    );
    if (error) {
      const meta = extractErrorMeta(error);
      throw new Error(`[formraw-precheck] query failed: ${meta.message ?? error.message}`);
    }
    rows.push(...((data ?? []) as IngredientRow[]));
  }
  return rows;
};

const newerTimestamp = (a: string | null, b: string | null): string | null => {
  if (!a) return b;
  if (!b) return a;
  return new Date(a).getTime() >= new Date(b).getTime() ? a : b;
};

const run = async () => {
  if (!SOURCE_IDS_FILE) {
    throw new Error("[formraw-precheck] --source-ids-file is required");
  }
  if (!["source_id", "canonical_source_id"].includes(ID_COLUMN)) {
    throw new Error(`[formraw-precheck] invalid --id-column: ${ID_COLUMN}`);
  }
  const sourceIds = await loadSourceIds(SOURCE_IDS_FILE);
  if (!sourceIds.length) {
    throw new Error(`[formraw-precheck] source ids file empty: ${SOURCE_IDS_FILE}`);
  }

  const rows = await fetchRowsForSourceIds(sourceIds, ID_COLUMN);
  const byCanonical = new Map<string, CanonicalStats>();
  let totalRows = 0;
  let formRawEmpty = 0;
  let formRawNonEmpty = 0;

  rows.forEach((row) => {
    const canonicalId = row.canonical_source_id ?? null;
    if (!canonicalId) return;
    totalRows += 1;
    const empty = isEmptyFormRaw(row.form_raw);
    if (empty) formRawEmpty += 1;
    else formRawNonEmpty += 1;

    const existing =
      byCanonical.get(canonicalId) ??
      ({
        canonicalSourceId: canonicalId,
        sampleSourceId: row.source_id ?? null,
        rows: 0,
        formRawEmpty: 0,
        formRawNonEmpty: 0,
        lastUpdatedAt: null,
      } as CanonicalStats);

    existing.rows += 1;
    if (empty) existing.formRawEmpty += 1;
    else existing.formRawNonEmpty += 1;
    existing.lastUpdatedAt = newerTimestamp(existing.lastUpdatedAt, row.updated_at ?? null);
    if (!existing.sampleSourceId && row.source_id) existing.sampleSourceId = row.source_id;
    byCanonical.set(canonicalId, existing);
  });

  const perCanonical = Array.from(byCanonical.values()).sort((a, b) => {
    if (b.formRawEmpty !== a.formRawEmpty) return b.formRawEmpty - a.formRawEmpty;
    return a.canonicalSourceId.localeCompare(b.canonicalSourceId);
  });

  const payload = {
    source: "lnhpd",
    idColumn: ID_COLUMN,
    timestamp: new Date().toISOString(),
    sourceIdsFile: SOURCE_IDS_FILE,
    sourceIdsCount: sourceIds.length,
    totalRows,
    formRawEmptyRows: formRawEmpty,
    formRawNonEmptyRows: formRawNonEmpty,
    formRawEmptyRatio: totalRows ? formRawEmpty / totalRows : null,
    uniqueCanonicalSourceIds: perCanonical.length,
    perCanonical,
  };

  await ensureDir(OUTPUT);
  await writeFile(OUTPUT, JSON.stringify(payload, null, 2), "utf8");
  console.log(JSON.stringify({ output: OUTPUT, ...payload }, null, 2));
};

run().catch((error) => {
  console.error("[formraw-precheck] failed:", error instanceof Error ? error.message : error);
  process.exit(1);
});
