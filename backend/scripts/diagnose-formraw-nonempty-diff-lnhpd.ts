import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

import { supabase } from "../src/supabase.js";
import { extractErrorMeta, withRetry } from "../src/supabaseRetry.js";

type IngredientRow = {
  id: string | null;
  source_id: string | null;
  canonical_source_id: string | null;
  ingredient_id: string | null;
  name_raw: string | null;
  form_raw: string | null;
  name_key?: string | null;
};

type SnapshotRow = {
  id: string;
  sourceId: string;
  canonicalSourceId?: string | null;
  ingredientId: string;
  nameRaw: string | null;
  formRaw: string | null;
};

const args = process.argv.slice(2);
const getArg = (flag: string) => {
  const idx = args.indexOf(`--${flag}`);
  if (idx === -1) return null;
  return args[idx + 1] ?? null;
};

const SOURCE_IDS_FILE = getArg("source-ids-file");
const ID_COLUMN = (getArg("id-column") ?? "canonical_source_id").trim();
const OUTPUT = getArg("output") ?? "output/formraw/formraw_nonempty_diff_lnhpd.json";
const COMPARE_SNAPSHOT = getArg("compare-snapshot");
const SAMPLE_LIMIT = Math.max(1, Number(getArg("sample-limit") ?? "20"));
const CHUNK_SIZE = Math.max(1, Number(getArg("chunk-size") ?? "200"));

const ensureDir = async (filePath: string) => {
  const dir = path.dirname(filePath);
  if (!dir || dir === ".") return;
  await mkdir(dir, { recursive: true });
};

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
  throw new Error(`[formraw-nonempty-diff] invalid source ids file: ${filePath}`);
};

const chunkArray = <T>(items: T[], size: number): T[][] => {
  const chunks: T[][] = [];
  for (let i = 0; i < items.length; i += size) {
    chunks.push(items.slice(i, i + size));
  }
  return chunks;
};

const fetchNonEmptyRows = async (
  sourceIds: string[],
  idColumn: string,
): Promise<IngredientRow[]> => {
  const rows: IngredientRow[] = [];
  for (const chunk of chunkArray(sourceIds, CHUNK_SIZE)) {
    const { data, error } = await withRetry(() =>
      supabase
        .from("product_ingredients")
        .select("id,source_id,canonical_source_id,ingredient_id,name_raw,form_raw,name_key")
        .eq("source", "lnhpd")
        .eq("is_active", true)
        .not("ingredient_id", "is", null)
        .not("form_raw", "is", null)
        .neq("form_raw", "")
        .in(idColumn, chunk),
    );
    if (error) {
      const meta = extractErrorMeta(error);
      throw new Error(`[formraw-nonempty-diff] query failed: ${meta.message ?? error.message}`);
    }
    rows.push(...((data ?? []) as IngredientRow[]));
  }
  return rows;
};

const fetchRowsByIds = async (rowIds: string[]): Promise<IngredientRow[]> => {
  const rows: IngredientRow[] = [];
  for (const chunk of chunkArray(rowIds, CHUNK_SIZE)) {
    const { data, error } = await withRetry(() =>
      supabase
        .from("product_ingredients")
        .select("id,source_id,canonical_source_id,ingredient_id,name_raw,form_raw,name_key")
        .in("id", chunk),
    );
    if (error) {
      const meta = extractErrorMeta(error);
      throw new Error(`[formraw-nonempty-diff] id fetch failed: ${meta.message ?? error.message}`);
    }
    rows.push(...((data ?? []) as IngredientRow[]));
  }
  return rows;
};

const sortRows = (rows: IngredientRow[]): IngredientRow[] =>
  rows.sort((a, b) => {
    const sourceCompare = String(a.source_id ?? "").localeCompare(String(b.source_id ?? ""));
    if (sourceCompare !== 0) return sourceCompare;
    const nameCompare = String(a.name_key ?? "").localeCompare(String(b.name_key ?? ""));
    if (nameCompare !== 0) return nameCompare;
    return String(a.id ?? "").localeCompare(String(b.id ?? ""));
  });

const run = async () => {
  if (!SOURCE_IDS_FILE) {
    throw new Error("[formraw-nonempty-diff] --source-ids-file is required");
  }
  if (!["source_id", "canonical_source_id"].includes(ID_COLUMN)) {
    throw new Error(`[formraw-nonempty-diff] invalid --id-column: ${ID_COLUMN}`);
  }
  const sourceIds = await loadSourceIds(SOURCE_IDS_FILE);
  if (!sourceIds.length) {
    throw new Error(`[formraw-nonempty-diff] source ids file empty: ${SOURCE_IDS_FILE}`);
  }

  if (!COMPARE_SNAPSHOT) {
    const rows = sortRows(await fetchNonEmptyRows(sourceIds, ID_COLUMN));
    const sample = rows.slice(0, SAMPLE_LIMIT).map((row) => ({
      id: row.id as string,
      sourceId:
        (ID_COLUMN === "canonical_source_id" ? row.canonical_source_id : row.source_id) ?? "",
      canonicalSourceId: row.canonical_source_id ?? null,
      ingredientId: row.ingredient_id as string,
      nameRaw: row.name_raw ?? null,
      formRaw: row.form_raw ?? null,
    }));
    await ensureDir(OUTPUT);
    await writeFile(OUTPUT, JSON.stringify(sample, null, 2), "utf8");
    console.log(
      JSON.stringify(
        {
          output: OUTPUT,
          idColumn: ID_COLUMN,
          sourceIdsFile: SOURCE_IDS_FILE,
          sampleSize: sample.length,
          timestamp: new Date().toISOString(),
        },
        null,
        2,
      ),
    );
    return;
  }

  const raw = await readFile(COMPARE_SNAPSHOT, "utf8");
  const beforeRows = JSON.parse(raw) as SnapshotRow[];
  const rowIds = beforeRows.map((row) => row.id);
  const currentRows = await fetchRowsByIds(rowIds);
  const currentMap = new Map<string, IngredientRow>();
  currentRows.forEach((row) => {
    if (row.id) currentMap.set(row.id, row);
  });

  let unchanged = 0;
  let changed = 0;
  let changedToEmpty = 0;
  let missing = 0;
  const sampleChanged: Array<Record<string, unknown>> = [];

  beforeRows.forEach((before) => {
    const current = currentMap.get(before.id);
    if (!current) {
      missing += 1;
      return;
    }
    const beforeValue = before.formRaw ?? "";
    const afterValue = current.form_raw ?? "";
    if (beforeValue === afterValue) {
      unchanged += 1;
      return;
    }
    changed += 1;
    if (!afterValue.trim()) changedToEmpty += 1;
    if (sampleChanged.length < SAMPLE_LIMIT) {
      sampleChanged.push({
        id: before.id,
        sourceId: before.sourceId,
        ingredientId: before.ingredientId,
        nameRaw: current.name_raw ?? before.nameRaw,
        formRawBefore: before.formRaw,
        formRawAfter: current.form_raw ?? null,
      });
    }
  });

  const payload = {
    output: OUTPUT,
    idColumn: ID_COLUMN,
    sourceIdsFile: SOURCE_IDS_FILE,
    compareSnapshot: COMPARE_SNAPSHOT,
    totalCompared: beforeRows.length,
    missing,
    unchanged,
    changed,
    changedToEmpty,
    sampleChangedRows: sampleChanged,
    timestamp: new Date().toISOString(),
  };

  await ensureDir(OUTPUT);
  await writeFile(OUTPUT, JSON.stringify(payload, null, 2), "utf8");
  console.log(JSON.stringify(payload, null, 2));
};

run().catch((error) => {
  console.error("[formraw-nonempty-diff] failed:", error instanceof Error ? error.message : error);
  process.exit(1);
});
