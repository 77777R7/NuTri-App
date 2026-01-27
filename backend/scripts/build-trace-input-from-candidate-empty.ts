import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

import { supabase } from "../src/supabase.js";
import { extractErrorMeta, withRetry } from "../src/supabaseRetry.js";

type CandidateRow = {
  id?: string | null;
  sourceId?: string | null;
  canonicalSourceId?: string | null;
  ingredientId?: string | null;
  nameKey?: string | null;
  formRawBefore?: string | null;
  recognizedTokens?: string[] | null;
  winnerTokens?: string[] | null;
  mappedTokens?: string[] | null;
  mapsToFormKey?: string | null;
  emptyAfter?: boolean | null;
};

type IngredientRow = {
  id: string;
  source_id: string | null;
  canonical_source_id: string | null;
  ingredient_id: string | null;
  name_raw: string | null;
  name_key: string | null;
  basis: string | null;
  form_raw: string | null;
};

type PreviewRow = {
  sourceId: string | null;
  canonicalSourceId: string | null;
  productIngredientId: string | null;
  ingredientId: string | null;
  nameRaw: string | null;
  nameKey: string | null;
  formRawBefore: string | null;
  recognizedTokens: string[];
  winnerTokens: string[];
  mappedTokens: string[];
  mapsToFormKey: string | null;
  candidateWriteableEmpty: boolean;
  candidateMappableEmpty: boolean;
};

const args = process.argv.slice(2);
const getArg = (flag: string) => {
  const idx = args.indexOf(`--${flag}`);
  if (idx === -1) return null;
  return args[idx + 1] ?? null;
};

const CANDIDATE_INPUT = getArg("candidate-input");
const OUTPUT =
  getArg("output") ?? "output/formraw/formraw_trace_input.json";
const LIMIT = Math.max(1, Number(getArg("limit") ?? "200"));
const ONLY_EMPTY_AFTER = args.includes("--only-empty-after");
const CHUNK_SIZE = Math.max(1, Number(getArg("chunk-size") ?? "200"));

const ensureDir = async (filePath: string) => {
  const dir = path.dirname(filePath);
  if (!dir || dir === ".") return;
  await mkdir(dir, { recursive: true });
};

const normalizeList = (value: unknown): string[] =>
  Array.isArray(value)
    ? value.filter((item) => typeof item === "string" && item.trim().length > 0)
    : [];

const isEmpty = (value?: string | null) => !value || !value.trim();

const chunkArray = <T>(items: T[], size: number): T[][] => {
  const chunks: T[][] = [];
  for (let i = 0; i < items.length; i += size) {
    chunks.push(items.slice(i, i + size));
  }
  return chunks;
};

const fetchRowsByIds = async (ids: string[]): Promise<Map<string, IngredientRow>> => {
  const map = new Map<string, IngredientRow>();
  for (const chunk of chunkArray(ids, CHUNK_SIZE)) {
    const { data, error, status, rayId } = await withRetry(() =>
      supabase
        .from("product_ingredients")
        .select(
          "id,source_id,canonical_source_id,ingredient_id,name_raw,name_key,basis,form_raw",
        )
        .in("id", chunk),
    );
    if (error) {
      const meta = extractErrorMeta(error, status, rayId ?? null);
      throw new Error(
        `[formraw-trace-input] fetch failed: ${meta.message ?? error.message}`,
      );
    }
    (data ?? []).forEach((row) => {
      if (row?.id) {
        map.set(row.id as string, row as IngredientRow);
      }
    });
  }
  return map;
};

const run = async () => {
  if (!CANDIDATE_INPUT) {
    throw new Error("[formraw-trace-input] --candidate-input is required");
  }

  const raw = await readFile(CANDIDATE_INPUT, "utf8");
  const parsed = JSON.parse(raw) as { rows?: CandidateRow[] };
  const rows = Array.isArray(parsed?.rows) ? parsed.rows : [];
  if (!rows.length) {
    throw new Error(`[formraw-trace-input] rows missing in ${CANDIDATE_INPUT}`);
  }

  const selected: CandidateRow[] = [];
  for (const row of rows) {
    if (ONLY_EMPTY_AFTER && !row.emptyAfter) continue;
    selected.push(row);
    if (selected.length >= LIMIT) break;
  }

  const ids = selected
    .map((row) => row.id)
    .filter((value): value is string => typeof value === "string" && value.length > 0);

  const rowMap = await fetchRowsByIds(ids);

  const previewRows: PreviewRow[] = [];
  selected.forEach((row) => {
    const id = row.id ?? null;
    if (!id) return;
    const dbRow = rowMap.get(id);
    if (!dbRow) return;
    const recognizedTokens = normalizeList(row.recognizedTokens);
    const winnerTokens = normalizeList(row.winnerTokens);
    const mappedTokens = normalizeList(row.mappedTokens);
    const mapsToFormKey = row.mapsToFormKey ?? null;
    const emptyBefore = isEmpty(dbRow.form_raw);
    const candidateWriteableEmpty =
      emptyBefore && winnerTokens.length > 0 && Boolean(mapsToFormKey);
    const candidateMappableEmpty =
      emptyBefore && recognizedTokens.length > 0 && Boolean(mapsToFormKey);
    previewRows.push({
      sourceId: dbRow.source_id ?? row.sourceId ?? null,
      canonicalSourceId: dbRow.canonical_source_id ?? row.canonicalSourceId ?? null,
      productIngredientId: dbRow.id ?? null,
      ingredientId: dbRow.ingredient_id ?? row.ingredientId ?? null,
      nameRaw: dbRow.name_raw ?? null,
      nameKey: dbRow.name_key ?? row.nameKey ?? null,
      formRawBefore: dbRow.form_raw ?? row.formRawBefore ?? null,
      recognizedTokens,
      winnerTokens,
      mappedTokens,
      mapsToFormKey,
      candidateWriteableEmpty,
      candidateMappableEmpty,
    });
  });

  if (!previewRows.length) {
    throw new Error("[formraw-trace-input] no previewRows assembled");
  }

  const payload = {
    previewRows,
    candidateInput: CANDIDATE_INPUT,
    selectedRows: selected.length,
    previewRowsCount: previewRows.length,
  };

  await ensureDir(OUTPUT);
  await writeFile(OUTPUT, JSON.stringify(payload, null, 2), "utf8");
  console.log(JSON.stringify({ output: OUTPUT, previewRows: previewRows.length }, null, 2));
};

run().catch((error) => {
  console.error(
    "[formraw-trace-input] failed:",
    error instanceof Error ? error.message : error,
  );
  process.exit(1);
});
