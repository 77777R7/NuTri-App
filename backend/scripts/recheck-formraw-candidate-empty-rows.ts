import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

import { supabase } from "../src/supabase.js";
import { extractErrorMeta, withRetry } from "../src/supabaseRetry.js";

type CandidateRow = {
  id: string;
  sourceId?: string | null;
  canonicalSourceId?: string | null;
  ingredientId?: string | null;
  nameKey?: string | null;
  formRawBefore?: string | null;
  recognizedTokens?: string[];
  winnerTokens?: string[];
  mappedTokens?: string[];
  mapsToFormKey?: string | null;
};

type IngredientRow = {
  id: string;
  form_raw: string | null;
};

const args = process.argv.slice(2);
const getArg = (flag: string) => {
  const idx = args.indexOf(`--${flag}`);
  if (idx === -1) return null;
  return args[idx + 1] ?? null;
};

const INPUT = getArg("input");
const OUTPUT =
  getArg("output") ?? "output/formraw/candidate_empty_rows_after.json";
const CHUNK_SIZE = Math.max(1, Number(getArg("chunk-size") ?? "200"));

const ensureDir = async (filePath: string) => {
  const dir = path.dirname(filePath);
  if (!dir || dir === ".") return;
  await mkdir(dir, { recursive: true });
};

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
        .select("id,form_raw")
        .in("id", chunk),
    );
    if (error) {
      const meta = extractErrorMeta(error, status, rayId ?? null);
      throw new Error(
        `[formraw-candidate-empty-recheck] fetch failed: ${meta.message ?? error.message}`,
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
  if (!INPUT) {
    throw new Error("[formraw-candidate-empty-recheck] --input is required");
  }

  const raw = await readFile(INPUT, "utf8");
  const parsed = JSON.parse(raw) as { rows?: CandidateRow[] };
  const rows = Array.isArray(parsed?.rows) ? parsed.rows : [];
  if (!rows.length) {
    throw new Error(`[formraw-candidate-empty-recheck] rows missing in ${INPUT}`);
  }

  const ids = rows
    .map((row) => row.id)
    .filter((value): value is string => typeof value === "string" && value.length > 0);
  const rowMap = await fetchRowsByIds(ids);

  let emptyToNonEmpty = 0;
  let stillEmpty = 0;
  let missingRows = 0;
  const outputRows = rows.map((row) => {
    const dbRow = rowMap.get(row.id);
    if (!dbRow) {
      missingRows += 1;
      return {
        ...row,
        formRawAfter: null,
        emptyAfter: true,
        status: "missing",
      };
    }
    const emptyAfter = isEmpty(dbRow.form_raw);
    if (emptyAfter) {
      stillEmpty += 1;
    } else {
      emptyToNonEmpty += 1;
    }
    return {
      ...row,
      formRawAfter: dbRow.form_raw ?? null,
      emptyAfter,
      status: "ok",
    };
  });

  const payload = {
    source: "lnhpd",
    timestamp: new Date().toISOString(),
    input: INPUT,
    candidateEmptyRows: rows.length,
    emptyToNonEmpty,
    stillEmpty,
    missingRows,
    rows: outputRows,
  };

  await ensureDir(OUTPUT);
  await writeFile(OUTPUT, JSON.stringify(payload, null, 2), "utf8");
  console.log(JSON.stringify({ output: OUTPUT, ...payload }, null, 2));
};

run().catch((error) => {
  console.error(
    "[formraw-candidate-empty-recheck] failed:",
    error instanceof Error ? error.message : error,
  );
  process.exit(1);
});
