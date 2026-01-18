import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

import { supabase } from "../src/supabase.js";
import { extractErrorMeta, withRetry } from "../src/supabaseRetry.js";

type YieldPreviewRow = {
  productIngredientId?: string | null;
  sourceId?: string | null;
  canonicalSourceId?: string | null;
  ingredientId?: string | null;
  nameKey?: string | null;
  formRawBefore?: string | null;
  recognizedTokens?: string[] | null;
  winnerTokens?: string[] | null;
  mappedTokens?: string[] | null;
  mapsToFormKey?: string | null;
  candidateWritableEmpty?: boolean | null;
};

type IngredientRow = {
  id: string;
  source_id: string | null;
  canonical_source_id: string | null;
  ingredient_id: string | null;
  name_key: string | null;
  form_raw: string | null;
};

type CandidateRow = {
  id: string;
  sourceId: string | null;
  canonicalSourceId: string | null;
  ingredientId: string | null;
  nameKey: string | null;
  formRawBefore: string | null;
  recognizedTokens: string[];
  winnerTokens: string[];
  mappedTokens: string[];
  mapsToFormKey: string | null;
};

const args = process.argv.slice(2);
const getArg = (flag: string) => {
  const idx = args.indexOf(`--${flag}`);
  if (idx === -1) return null;
  return args[idx + 1] ?? null;
};

const YIELD_INPUT = getArg("yield-input");
const OUTPUT =
  getArg("output") ?? "output/formraw/candidate_empty_rows.json";
const LIMIT = Math.max(1, Number(getArg("limit") ?? "1000"));
const REQUIRE_CANDIDATE_WRITABLE = args.includes("--require-candidate-writable");
const REQUIRE_RECOGNIZED = args.includes("--require-recognized");
const CHUNK_SIZE = Math.max(1, Number(getArg("chunk-size") ?? "200"));

const ensureDir = async (filePath: string) => {
  const dir = path.dirname(filePath);
  if (!dir || dir === ".") return;
  await mkdir(dir, { recursive: true });
};

const isEmpty = (value?: string | null) => !value || !value.trim();

const normalizeList = (value: unknown): string[] =>
  Array.isArray(value)
    ? value.filter((item) => typeof item === "string" && item.trim().length > 0)
    : [];

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
        .select("id,source_id,canonical_source_id,ingredient_id,name_key,form_raw")
        .in("id", chunk),
    );
    if (error) {
      const meta = extractErrorMeta(error, status, rayId ?? null);
      throw new Error(
        `[formraw-candidate-empty] fetch failed: ${meta.message ?? error.message}`,
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
  if (!YIELD_INPUT) {
    throw new Error("[formraw-candidate-empty] --yield-input is required");
  }

  const raw = await readFile(YIELD_INPUT, "utf8");
  const parsed = JSON.parse(raw) as { previewRows?: YieldPreviewRow[] };
  const previewRows = Array.isArray(parsed?.previewRows) ? parsed.previewRows : [];
  if (!previewRows.length) {
    throw new Error(`[formraw-candidate-empty] previewRows missing in ${YIELD_INPUT}`);
  }

  const candidateRows: YieldPreviewRow[] = [];
  let missingIdRows = 0;
  for (const row of previewRows) {
    if (REQUIRE_CANDIDATE_WRITABLE && !row.candidateWritableEmpty) continue;
    const winnerTokens = normalizeList(row.winnerTokens);
    const recognizedTokens = normalizeList(row.recognizedTokens);
    if (!winnerTokens.length) continue;
    if (REQUIRE_RECOGNIZED && !recognizedTokens.length) continue;
    if (!row.productIngredientId) {
      missingIdRows += 1;
      continue;
    }
    candidateRows.push(row);
    if (candidateRows.length >= LIMIT) break;
  }

  const candidateIds = candidateRows
    .map((row) => row.productIngredientId)
    .filter((value): value is string => typeof value === "string" && value.length > 0);

  const rowMap = await fetchRowsByIds(candidateIds);
  const outputRows: CandidateRow[] = [];
  let candidateAlreadyFilledRows = 0;
  let missingDbRows = 0;

  candidateRows.forEach((row) => {
    const id = row.productIngredientId as string;
    const dbRow = rowMap.get(id);
    if (!dbRow) {
      missingDbRows += 1;
      return;
    }
    if (!isEmpty(dbRow.form_raw)) {
      candidateAlreadyFilledRows += 1;
      return;
    }
    outputRows.push({
      id: dbRow.id,
      sourceId: dbRow.source_id ?? row.sourceId ?? null,
      canonicalSourceId: dbRow.canonical_source_id ?? row.canonicalSourceId ?? null,
      ingredientId: dbRow.ingredient_id ?? row.ingredientId ?? null,
      nameKey: dbRow.name_key ?? row.nameKey ?? null,
      formRawBefore: dbRow.form_raw ?? null,
      recognizedTokens: normalizeList(row.recognizedTokens),
      winnerTokens: normalizeList(row.winnerTokens),
      mappedTokens: normalizeList(row.mappedTokens),
      mapsToFormKey: row.mapsToFormKey ?? null,
    });
  });

  const payload = {
    source: "lnhpd",
    timestamp: new Date().toISOString(),
    yieldInput: YIELD_INPUT,
    candidateRowsCount: candidateRows.length,
    candidateEmptyRows: outputRows.length,
    candidateAlreadyFilledRows,
    missingIdRows,
    missingDbRows,
    requireCandidateWritable: REQUIRE_CANDIDATE_WRITABLE,
    requireRecognized: REQUIRE_RECOGNIZED,
    rows: outputRows,
  };

  await ensureDir(OUTPUT);
  await writeFile(OUTPUT, JSON.stringify(payload, null, 2), "utf8");
  console.log(JSON.stringify({ output: OUTPUT, ...payload }, null, 2));
};

run().catch((error) => {
  console.error(
    "[formraw-candidate-empty] failed:",
    error instanceof Error ? error.message : error,
  );
  process.exit(1);
});
