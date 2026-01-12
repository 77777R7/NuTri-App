import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

import { supabase } from "../src/supabase.js";
import { extractErrorMeta, withRetry } from "../src/supabaseRetry.js";
import { V4_SCORE_VERSION } from "../src/scoring/v4ScoreEngine.js";

type RebackfillEntry = {
  timestamp: string;
  source: "lnhpd";
  sourceId: string;
  canonicalSourceId: string | null;
  stage: string;
  status: number | null;
  rayId: string | null;
  message: string | null;
};

type IngredientRow = {
  source_id: string | null;
  canonical_source_id: string | null;
  ingredient_id: string | null;
  name_raw: string | null;
  form_raw: string | null;
};

type IngredientFormRow = {
  ingredient_id: string;
  form_key: string;
  form_label: string;
};

type FormAliasRow = {
  alias_text: string;
  alias_norm: string | null;
  form_key: string;
  ingredient_id: string | null;
};

const args = process.argv.slice(2);
const getArg = (flag: string) => {
  const idx = args.indexOf(`--${flag}`);
  if (idx === -1) return null;
  return args[idx + 1] ?? null;
};

const OUTPUT_PATH =
  getArg("output") ??
  "output/formraw/formraw_rebackfill_lnhpd.jsonl";
const LIMIT = Math.max(1, Number(getArg("limit") ?? "5000"));
const PAGE_SIZE = Math.max(1, Number(getArg("page-size") ?? "2000"));
const START_AFTER = getArg("start-after");
const MODE = (getArg("mode") ?? "formraw-missing").toLowerCase();
const MISMATCH_EXAMPLES = getArg("mismatch-examples");

const ensureDir = async (filePath: string) => {
  const dir = path.dirname(filePath);
  if (!dir || dir === ".") return;
  await mkdir(dir, { recursive: true });
};

const normalizeText = (value: string): string =>
  value.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();

const aliasMatchesCandidate = (candidateNormalized: string, alias: FormAliasRow): boolean => {
  const aliasNorm = normalizeText(alias.alias_norm || alias.alias_text || "");
  if (!aliasNorm) return false;
  if (candidateNormalized === aliasNorm) return true;
  if (candidateNormalized.includes(aliasNorm)) return true;
  const candidateTokens = new Set(candidateNormalized.split(/\s+/).filter(Boolean));
  const aliasTokens = aliasNorm.split(/\s+/).filter(Boolean);
  if (aliasTokens.length && aliasTokens.every((token) => candidateTokens.has(token))) return true;
  return aliasTokens.some((token) => candidateTokens.has(token));
};

const formMatchesCandidate = (
  candidateNormalized: string,
  form: IngredientFormRow,
): boolean => {
  const keyNormalized = normalizeText(form.form_key);
  const labelNormalized = normalizeText(form.form_label);
  const candidateTokens = new Set(candidateNormalized.split(/\s+/).filter(Boolean));

  if (keyNormalized && candidateNormalized.includes(keyNormalized)) return true;
  const keyTokens = keyNormalized.split(/\s+/).filter(Boolean);
  if (keyTokens.length && keyTokens.every((token) => candidateTokens.has(token))) return true;
  const labelTokens = labelNormalized.split(/\s+/).filter(Boolean);
  if (labelTokens.length && labelTokens.every((token) => candidateTokens.has(token))) return true;
  return labelTokens.some((token) => candidateTokens.has(token));
};

const chunkArray = <T>(items: T[], size: number): T[][] => {
  const chunks: T[][] = [];
  for (let i = 0; i < items.length; i += size) {
    chunks.push(items.slice(i, i + size));
  }
  return chunks;
};

const fetchIngredientForms = async (
  ingredientIds: string[],
): Promise<IngredientFormRow[]> => {
  const rows: IngredientFormRow[] = [];
  for (const chunk of chunkArray(ingredientIds, 200)) {
    const { data, error } = await withRetry(() =>
      supabase
        .from("ingredient_forms")
        .select("ingredient_id,form_key,form_label")
        .in("ingredient_id", chunk),
    );
    if (error) {
      const meta = extractErrorMeta(error);
      throw new Error(`[formraw] forms fetch failed: ${meta.message ?? error.message}`);
    }
    rows.push(...((data ?? []) as IngredientFormRow[]));
  }
  return rows;
};

const fetchAliases = async (ingredientIds: string[]): Promise<FormAliasRow[]> => {
  const rows: FormAliasRow[] = [];
  const { data: globalAliases, error: globalError } = await withRetry(() =>
    supabase
      .from("ingredient_form_aliases")
      .select("alias_text,alias_norm,form_key,ingredient_id")
      .is("ingredient_id", null),
  );
  if (globalError) {
    const meta = extractErrorMeta(globalError);
    throw new Error(`[formraw] aliases fetch failed: ${meta.message ?? globalError.message}`);
  }
  rows.push(...((globalAliases ?? []) as FormAliasRow[]));

  for (const chunk of chunkArray(ingredientIds, 200)) {
    const { data, error } = await withRetry(() =>
      supabase
        .from("ingredient_form_aliases")
        .select("alias_text,alias_norm,form_key,ingredient_id")
        .in("ingredient_id", chunk),
    );
    if (error) {
      const meta = extractErrorMeta(error);
      throw new Error(`[formraw] aliases fetch failed: ${meta.message ?? error.message}`);
    }
    rows.push(...((data ?? []) as FormAliasRow[]));
  }
  return rows;
};

const loadMismatchExamples = async (filePath: string) => {
  const raw = await import("node:fs/promises").then((mod) => mod.readFile(filePath, "utf8"));
  return raw
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      try {
        return JSON.parse(line) as { sourceId?: string; canonicalSourceId?: string };
      } catch {
        return null;
      }
    })
    .filter((entry): entry is { sourceId: string; canonicalSourceId?: string } =>
      Boolean(entry?.sourceId),
    );
};

const collectFormRawMissing = async () => {
  const deduped = new Map<string, { sourceId: string; canonicalSourceId: string | null }>();
  let cursor = typeof START_AFTER === "string" && START_AFTER.trim() ? START_AFTER.trim() : null;
  let totalFetched = 0;

  while (deduped.size < LIMIT) {
    const { data, error, status } = await withRetry(() => {
      let query = supabase
        .from("product_ingredients")
        .select("source_id,canonical_source_id")
        .eq("source", "lnhpd")
        .eq("is_active", true)
        .not("ingredient_id", "is", null)
        .or("form_raw.is.null,form_raw.eq.")
        .order("source_id", { ascending: true })
        .limit(PAGE_SIZE);
      if (cursor) query = query.gt("source_id", cursor);
      return query;
    });

    if (error) {
      const meta = extractErrorMeta(error, status);
      throw new Error(`[formraw] query failed: ${meta.message ?? error.message}`);
    }

    const rows = (data ?? []) as Array<{
      source_id: string | null;
      canonical_source_id: string | null;
    }>;
    if (!rows.length) break;

    totalFetched += rows.length;
    rows.forEach((row) => {
      const sourceId = typeof row?.source_id === "string" ? row.source_id : null;
      if (!sourceId) return;
      const canonicalSourceId =
        typeof row?.canonical_source_id === "string" ? row.canonical_source_id : null;
      if (!deduped.has(sourceId)) {
        deduped.set(sourceId, { sourceId, canonicalSourceId });
      }
    });

    cursor = rows[rows.length - 1]?.source_id ?? cursor;
    if (rows.length < PAGE_SIZE) break;
  }

  return { deduped, totalFetched, cursor };
};

const collectTaxonomyMismatch = async () => {
  if (MISMATCH_EXAMPLES) {
    const entries = await loadMismatchExamples(MISMATCH_EXAMPLES);
    const deduped = new Map<string, { sourceId: string; canonicalSourceId: string | null }>();
    entries.forEach((entry) => {
      const sourceId = entry.sourceId;
      if (!deduped.has(sourceId)) {
        deduped.set(sourceId, {
          sourceId,
          canonicalSourceId: entry.canonicalSourceId ?? sourceId,
        });
      }
    });
    return { deduped, totalFetched: entries.length, cursor: null };
  }

  const deduped = new Map<string, { sourceId: string; canonicalSourceId: string | null }>();
  let cursor = typeof START_AFTER === "string" && START_AFTER.trim() ? START_AFTER.trim() : null;
  let totalFetched = 0;

  while (deduped.size < LIMIT) {
    const { data, error, status } = await withRetry(() => {
      let query = supabase
        .from("product_ingredients")
        .select("source_id,canonical_source_id,ingredient_id,name_raw,form_raw")
        .eq("source", "lnhpd")
        .eq("is_active", true)
        .not("ingredient_id", "is", null)
        .not("form_raw", "is", null)
        .neq("form_raw", "")
        .order("source_id", { ascending: true })
        .limit(PAGE_SIZE);
      if (cursor) query = query.gt("source_id", cursor);
      return query;
    });

    if (error) {
      const meta = extractErrorMeta(error, status);
      throw new Error(`[formraw] mismatch query failed: ${meta.message ?? error.message}`);
    }

    const rows = (data ?? []) as IngredientRow[];
    if (!rows.length) break;

    totalFetched += rows.length;

    const ingredientIds = Array.from(
      new Set(rows.map((row) => row.ingredient_id).filter((id): id is string => Boolean(id))),
    );
    const [forms, aliases] = await Promise.all([
      fetchIngredientForms(ingredientIds),
      fetchAliases(ingredientIds),
    ]);

    const formsByIngredient = new Map<string, IngredientFormRow[]>();
    forms.forEach((row) => {
      const bucket = formsByIngredient.get(row.ingredient_id) ?? [];
      bucket.push(row);
      formsByIngredient.set(row.ingredient_id, bucket);
    });

    const globalAliases = aliases.filter((alias) => !alias.ingredient_id);
    const aliasesByIngredient = new Map<string, FormAliasRow[]>();
    aliases.forEach((alias) => {
      if (!alias.ingredient_id) return;
      const bucket = aliasesByIngredient.get(alias.ingredient_id) ?? [];
      bucket.push(alias);
      aliasesByIngredient.set(alias.ingredient_id, bucket);
    });

    rows.forEach((row) => {
      if (!row.ingredient_id) return;
      const formRaw = row.form_raw?.trim();
      if (!formRaw) return;
      const candidateNormalized = normalizeText(formRaw);
      if (!candidateNormalized) return;

      const formsForIngredient = formsByIngredient.get(row.ingredient_id) ?? [];
      const matchedForms = formsForIngredient.some((form) =>
        formMatchesCandidate(candidateNormalized, form),
      );
      if (matchedForms) return;

      const aliasList = [
        ...globalAliases,
        ...(aliasesByIngredient.get(row.ingredient_id) ?? []),
      ];
      const aliasMatches = aliasList.filter((alias) =>
        aliasMatchesCandidate(candidateNormalized, alias),
      );
      if (!aliasMatches.length) return;

      const aliasMatchedFormKeys = aliasMatches.map((alias) => alias.form_key);
      const aliasMatchesForms = aliasMatchedFormKeys.some((key) =>
        formsForIngredient.some((form) => form.form_key === key),
      );
      if (aliasMatchesForms) return;

      const sourceId = typeof row.source_id === "string" ? row.source_id : null;
      if (!sourceId || deduped.has(sourceId)) return;
      const canonicalSourceId =
        typeof row.canonical_source_id === "string" ? row.canonical_source_id : null;
      deduped.set(sourceId, { sourceId, canonicalSourceId });
    });

    cursor = rows[rows.length - 1]?.source_id ?? cursor;
    if (rows.length < PAGE_SIZE) break;
  }

  return { deduped, totalFetched, cursor };
};

const collectZeroCoverage = async () => {
  const deduped = new Map<string, { sourceId: string; canonicalSourceId: string | null }>();
  let cursor = typeof START_AFTER === "string" && START_AFTER.trim() ? START_AFTER.trim() : null;
  let totalFetched = 0;

  while (deduped.size < LIMIT) {
    const { data, error, status } = await withRetry(() => {
      let query = supabase
        .from("product_scores")
        .select("source_id,canonical_source_id,explain_json")
        .eq("source", "lnhpd")
        .eq("score_version", V4_SCORE_VERSION)
        .order("source_id", { ascending: true })
        .limit(PAGE_SIZE);
      if (cursor) query = query.gt("source_id", cursor);
      return query;
    });

    if (error) {
      const meta = extractErrorMeta(error, status);
      throw new Error(`[formraw] zero coverage query failed: ${meta.message ?? error.message}`);
    }

    const rows =
      (data ?? []) as Array<{ source_id: string | null; canonical_source_id: string | null; explain_json?: any }>;
    if (!rows.length) break;

    totalFetched += rows.length;
    rows.forEach((row) => {
      const sourceId = typeof row?.source_id === "string" ? row.source_id : null;
      if (!sourceId) return;
      const ratio = row?.explain_json?.evidence?.formCoverageRatio;
      if (typeof ratio !== "number" || ratio > 0) return;
      if (deduped.has(sourceId)) return;
      const canonicalSourceId =
        typeof row?.canonical_source_id === "string" ? row.canonical_source_id : null;
      deduped.set(sourceId, { sourceId, canonicalSourceId });
    });

    cursor = rows[rows.length - 1]?.source_id ?? cursor;
    if (rows.length < PAGE_SIZE) break;
  }

  const candidateIds = Array.from(deduped.values());
  if (!candidateIds.length) return { deduped, totalFetched, cursor };

  const filterSet = new Set<string>();
  for (const chunk of chunkArray(candidateIds, 200)) {
    const sourceIds = chunk.map((row) => row.sourceId);
    const { data, error, status } = await withRetry(() =>
      supabase
        .from("product_ingredients")
        .select("source_id,canonical_source_id")
        .eq("source", "lnhpd")
        .in("source_id", sourceIds)
        .not("ingredient_id", "is", null)
        .or("form_raw.is.null,form_raw.eq."),
    );
    if (error) {
      const meta = extractErrorMeta(error, status);
      throw new Error(`[formraw] zero coverage filter failed: ${meta.message ?? error.message}`);
    }
    (data ?? []).forEach((row) => {
      const sourceId = typeof row?.source_id === "string" ? row.source_id : null;
      if (sourceId) filterSet.add(sourceId);
    });
  }

  if (!filterSet.size) return { deduped: new Map(), totalFetched, cursor };

  const filtered = new Map<string, { sourceId: string; canonicalSourceId: string | null }>();
  deduped.forEach((value, key) => {
    if (filterSet.has(key)) filtered.set(key, value);
  });

  return { deduped: filtered, totalFetched, cursor };
};

const run = async () => {
  if (!["formraw-missing", "taxonomy-mismatch", "zero-coverage"].includes(MODE)) {
    throw new Error(`[formraw] invalid mode: ${MODE}`);
  }

  const stage =
    MODE === "taxonomy-mismatch"
      ? "taxonomy_mismatch_retrofit"
      : MODE === "zero-coverage"
        ? "form_raw_zero_coverage"
        : "form_raw_retrofit";
  const collector =
    MODE === "taxonomy-mismatch"
      ? collectTaxonomyMismatch
      : MODE === "zero-coverage"
        ? collectZeroCoverage
        : collectFormRawMissing;
  const { deduped, totalFetched, cursor } = await collector();

  const entries: RebackfillEntry[] = Array.from(deduped.values()).map((row) => ({
    timestamp: new Date().toISOString(),
    source: "lnhpd",
    sourceId: row.sourceId,
    canonicalSourceId: row.canonicalSourceId ?? null,
    stage,
    status: null,
    rayId: null,
    message: null,
  }));

  await ensureDir(OUTPUT_PATH);
  const lines = entries.map((entry) => JSON.stringify(entry));
  await writeFile(OUTPUT_PATH, lines.length ? `${lines.join("\n")}\n` : "", "utf8");

  console.log(
    `[formraw] mode=${MODE} fetched=${totalFetched} uniqueSourceIds=${entries.length} output=${OUTPUT_PATH} lastCursor=${cursor ?? "none"}`,
  );
};

run().catch((error) => {
  console.error("[formraw] failed:", error instanceof Error ? error.message : error);
  process.exit(1);
});
