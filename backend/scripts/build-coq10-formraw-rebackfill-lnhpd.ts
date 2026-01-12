import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

import { supabase } from "../src/supabase.js";
import { extractErrorMeta, withRetry } from "../src/supabaseRetry.js";

type RebackfillEntry = {
  source: "lnhpd";
  sourceId: string;
  canonicalSourceId: string | null;
  stage: string;
  status: number;
};

type Coq10IngredientRow = {
  ingredient_id: string;
};

type Coq10ProductRow = {
  source_id: string | null;
  canonical_source_id: string | null;
  form_raw: string | null;
};

type ScoreRow = {
  source_id: string | null;
  explain_json: Record<string, unknown> | null;
};

const args = process.argv.slice(2);
const getArg = (flag: string) => {
  const idx = args.indexOf(`--${flag}`);
  if (idx === -1) return null;
  return args[idx + 1] ?? null;
};

const OUTPUT_PATH =
  getArg("output") ?? "output/formraw/coq10_formraw_rebackfill.jsonl";
const LIMIT = Math.max(1, Number(getArg("limit") ?? "20000"));
const PAGE_SIZE = Math.max(1, Number(getArg("page-size") ?? "2000"));

const COQ10_FORM_KEYS = ["ubiquinone", "ubiquinol"];

const ensureDir = async (filePath: string) => {
  const dir = path.dirname(filePath);
  if (!dir || dir === ".") return;
  await mkdir(dir, { recursive: true });
};

const chunkArray = <T>(items: T[], size: number): T[][] => {
  const chunks: T[][] = [];
  for (let i = 0; i < items.length; i += size) {
    chunks.push(items.slice(i, i + size));
  }
  return chunks;
};

const fetchCoq10IngredientIds = async (): Promise<string[]> => {
  const { data, error } = await withRetry(() =>
    supabase
      .from("ingredient_forms")
      .select("ingredient_id")
      .in("form_key", COQ10_FORM_KEYS),
  );
  if (error) {
    const meta = extractErrorMeta(error);
    throw new Error(`[coq10] forms lookup failed: ${meta.message ?? error.message}`);
  }
  const rows = (data ?? []) as Coq10IngredientRow[];
  const ids = Array.from(
    new Set(rows.map((row) => row.ingredient_id).filter(Boolean)),
  );
  if (ids.length) return ids;

  const { data: ingredientRows, error: ingredientError } = await withRetry(() =>
    supabase
      .from("ingredients")
      .select("id")
      .or("canonical_key.eq.coenzyme_q10,name.ilike.%coenzyme q10%"),
  );
  if (ingredientError) {
    const meta = extractErrorMeta(ingredientError);
    throw new Error(`[coq10] ingredient lookup failed: ${meta.message ?? ingredientError.message}`);
  }
  return Array.from(
    new Set(
      (ingredientRows ?? [])
        .map((row) => (row as { id?: string }).id)
        .filter((id): id is string => Boolean(id)),
    ),
  );
};

const fetchCoq10Products = async (
  ingredientIds: string[],
): Promise<Map<string, { sourceId: string; canonicalSourceId: string | null; missingFormRaw: boolean }>> => {
  const bySource = new Map<
    string,
    { sourceId: string; canonicalSourceId: string | null; missingFormRaw: boolean }
  >();

  let cursor: string | null = null;
  while (bySource.size < LIMIT) {
    const { data, error, status } = await withRetry(() => {
      let query = supabase
        .from("product_ingredients")
        .select("source_id,canonical_source_id,form_raw")
        .eq("source", "lnhpd")
        .eq("is_active", true)
        .in("ingredient_id", ingredientIds)
        .order("source_id", { ascending: true })
        .limit(PAGE_SIZE);
      if (cursor) query = query.gt("source_id", cursor);
      return query;
    });

    if (error) {
      const meta = extractErrorMeta(error, status ?? null);
      throw new Error(`[coq10] product lookup failed: ${meta.message ?? error.message}`);
    }

    const rows = (data ?? []) as Coq10ProductRow[];
    if (!rows.length) break;

    rows.forEach((row) => {
      const sourceId = row.source_id ?? null;
      if (!sourceId) return;
      const missingFormRaw = !(row.form_raw ?? "").trim();
      const existing = bySource.get(sourceId);
      if (!existing) {
        bySource.set(sourceId, {
          sourceId,
          canonicalSourceId: row.canonical_source_id ?? null,
          missingFormRaw,
        });
        return;
      }
      if (missingFormRaw) existing.missingFormRaw = true;
      if (!existing.canonicalSourceId && row.canonical_source_id) {
        existing.canonicalSourceId = row.canonical_source_id;
      }
    });

    cursor = rows[rows.length - 1]?.source_id ?? null;
    if (!cursor) break;
  }

  return bySource;
};

const fetchFormCoverageZeroSet = async (
  sourceIds: string[],
): Promise<Set<string>> => {
  const zeroSet = new Set<string>();
  for (const chunk of chunkArray(sourceIds, 200)) {
    const { data, error } = await withRetry(() =>
      supabase
        .from("product_scores")
        .select("source_id,explain_json")
        .eq("source", "lnhpd")
        .in("source_id", chunk),
    );
    if (error) {
      const meta = extractErrorMeta(error);
      throw new Error(`[coq10] score lookup failed: ${meta.message ?? error.message}`);
    }
    const rows = (data ?? []) as ScoreRow[];
    rows.forEach((row) => {
      const sourceId = row.source_id ?? null;
      if (!sourceId) return;
      const ratio = (row.explain_json as { evidence?: { formCoverageRatio?: unknown } })?.evidence
        ?.formCoverageRatio;
      if (typeof ratio === "number" && ratio <= 0) {
        zeroSet.add(sourceId);
      }
    });
  }
  return zeroSet;
};

const run = async () => {
  const ingredientIds = await fetchCoq10IngredientIds();
  if (!ingredientIds.length) {
    throw new Error("[coq10] no CoQ10 ingredient ids found");
  }

  const bySource = await fetchCoq10Products(ingredientIds);
  const sourceIds = Array.from(bySource.keys());
  const zeroSet = await fetchFormCoverageZeroSet(sourceIds);

  const entries: RebackfillEntry[] = [];
  const sortedIds = sourceIds.sort((a, b) => a.localeCompare(b));
  sortedIds.forEach((sourceId) => {
    const entry = bySource.get(sourceId);
    if (!entry) return;
    if (!entry.missingFormRaw && !zeroSet.has(sourceId)) return;
    entries.push({
      source: "lnhpd",
      sourceId,
      canonicalSourceId: entry.canonicalSourceId ?? sourceId,
      stage: "formraw_fallback_coq10",
      status: 0,
    });
  });

  const limited = entries.slice(0, LIMIT);

  await ensureDir(OUTPUT_PATH);
  const lines = limited.map((entry) => JSON.stringify(entry));
  await writeFile(OUTPUT_PATH, `${lines.join("\n")}\n`, "utf8");

  console.log(
    JSON.stringify(
      {
        output: OUTPUT_PATH,
        coq10IngredientIds: ingredientIds,
        coq10Products: bySource.size,
        missingFormRawCount: Array.from(bySource.values()).filter((row) => row.missingFormRaw).length,
        formCoverageZeroCount: zeroSet.size,
        runlistCount: limited.length,
        limit: LIMIT,
      },
      null,
      2,
    ),
  );
};

run().catch((error) => {
  console.error("[coq10] failed:", error instanceof Error ? error.message : error);
  process.exit(1);
});
