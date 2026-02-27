import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

import { supabase } from "../src/supabase.js";
import { extractErrorMeta, withRetry } from "../src/supabaseRetry.js";

type ScoreSource = "lnhpd" | "dsld";

type ProductIngredientRow = {
  id: string;
  source_id: string;
  canonical_source_id: string | null;
  ingredient_id: string | null;
  name_raw: string;
  name_key: string | null;
  is_active: boolean;
};

type IngredientLookupRpcRow = {
  ingredient_id: string | null;
  match_method?: string | null;
  match_confidence?: number | string | null;
};

type MappingDecision = {
  rowId: string;
  sourceId: string;
  canonicalSourceId: string | null;
  nameRaw: string;
  nameKey: string | null;
  selectedQuery: string | null;
  selectedIngredientId: string | null;
  selectedIngredientName: string | null;
  matchMethod: string | null;
  matchConfidence: number | null;
  baselineAccepted: boolean;
  relaxedAccepted: boolean;
};

const args = process.argv.slice(2);
const getArg = (flag: string): string | null => {
  const idx = args.indexOf(`--${flag}`);
  if (idx === -1) return null;
  return args[idx + 1] ?? null;
};

const sourceArg = (getArg("source") ?? "lnhpd").toLowerCase();
const source: ScoreSource = sourceArg === "dsld" ? "dsld" : "lnhpd";
const idColumnArg = (getArg("id-column") ?? "source_id").toLowerCase();
const idColumn = idColumnArg === "canonical_source_id" ? "canonical_source_id" : "source_id";
const sourceIdsFile = getArg("source-ids-file");
const pageSize = Math.max(1, Number(getArg("page-size") ?? "1000"));
const concurrency = Math.max(1, Number(getArg("concurrency") ?? "6"));
const baselineThreshold = Math.min(1, Math.max(0, Number(getArg("baseline-threshold") ?? "0.85")));
const relaxedThreshold = Math.min(1, Math.max(0, Number(getArg("relaxed-threshold") ?? "0.80")));
const outDir =
  getArg("out-dir") ??
  `output/p1d/ingredient-id-trgm-ab-${Date.now()}`;
const mappingOutputPath = path.resolve(outDir, "before_after_mapping.json");
const reviewOutputPath = path.resolve(outDir, "sample20_review.json");

const normalizeNameKey = (value: string): string =>
  value.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();

const STRIP_SUFFIX_TOKENS = new Set([
  "extract",
  "extracts",
  "powder",
  "liquid",
  "dried",
  "juice",
  "concentrate",
  "leaf",
  "root",
  "seed",
  "bark",
  "peel",
  "flower",
  "herb",
  "oil",
  "berry",
  "fruit",
  "capsule",
  "tablets",
  "tablet",
  "softgels",
  "softgel",
  "matrix",
  "formula",
]);

const STRIP_PREFIX_TOKENS = new Set([
  "organic",
  "natural",
  "pure",
  "wild",
  "wildcrafted",
  "certified",
  "fermented",
  "raw",
  "whole",
  "premium",
  "super",
  "advanced",
  "ultra",
  "micronized",
]);

const STRIP_ANYWHERE_TOKENS = new Set([
  "blend",
  "complex",
  "formula",
  "controller",
  "aid",
  "rapid",
  "rx",
  "pro",
  "ultra",
  "elite",
  "max",
  "plus",
  "advanced",
  "phase",
  "weight",
  "loss",
  "burn",
  "burner",
  "tm",
  "original",
  "consortium",
  "system",
  "maximizer",
  "acceleration",
  "accelerator",
  "soothing",
  "preload",
  "contains",
  "nutrients",
  "transport",
  "cellular",
  "hydration",
  "amplifier",
  "activator",
  "stack",
  "facts",
  "serving",
  "per",
  "legend",
  "support",
  "r",
]);

const COMMON_STOP_WORDS = new Set([
  "and",
  "of",
  "from",
  "the",
  "with",
  "for",
  "in",
  "to",
  "by",
  "as",
]);

const ensureDir = async (filePath: string) => {
  const dir = path.dirname(filePath);
  if (!dir || dir === ".") return;
  await mkdir(dir, { recursive: true });
};

const chunkArray = <T>(items: T[], size: number): T[][] => {
  const chunks: T[][] = [];
  for (let i = 0; i < items.length; i += size) chunks.push(items.slice(i, i + size));
  return chunks;
};

const readSourceIds = async (filePath: string): Promise<string[]> => {
  const raw = await readFile(filePath, "utf8");
  const parsed = JSON.parse(raw) as unknown;
  const items = Array.isArray(parsed)
    ? parsed
    : Array.isArray((parsed as { sourceIds?: unknown } | null | undefined)?.sourceIds)
      ? (parsed as { sourceIds: unknown[] }).sourceIds
      : [];
  return Array.from(
    new Set(
      items
        .map((item) => (typeof item === "string" ? item.trim() : typeof item === "number" ? String(item) : ""))
        .filter(Boolean),
    ),
  );
};

const stripNameKeyVariants = (value: string): string[] => {
  const normalized = normalizeNameKey(value);
  if (!normalized) return [];
  const variants = new Set<string>([normalized]);
  const sourceTokens = normalized.split(/\s+/).filter(Boolean);
  if (!sourceTokens.length) return Array.from(variants);

  const dropDoseToken = (token: string): boolean => {
    if (!token) return true;
    if (/^\d+(?:\.\d+)?(?:mg|mcg|g|kg|iu|cfu|ml|oz)?$/i.test(token)) return true;
    if (/^(mg|mcg|g|kg|iu|cfu|ml|oz)$/i.test(token)) return true;
    return false;
  };

  const removePrefix = [...sourceTokens];
  while (removePrefix.length && STRIP_PREFIX_TOKENS.has(removePrefix[0])) {
    removePrefix.shift();
  }
  if (removePrefix.length) variants.add(removePrefix.join(" "));

  const removeSuffix = [...removePrefix];
  while (removeSuffix.length && STRIP_SUFFIX_TOKENS.has(removeSuffix[removeSuffix.length - 1])) {
    removeSuffix.pop();
  }
  if (removeSuffix.length) variants.add(removeSuffix.join(" "));

  const removeAnywhere = removeSuffix.filter((token) => !STRIP_ANYWHERE_TOKENS.has(token));
  if (removeAnywhere.length) variants.add(removeAnywhere.join(" "));

  const removeDose = removeAnywhere.filter((token) => !dropDoseToken(token));
  if (removeDose.length) variants.add(removeDose.join(" "));

  const removeStops = removeDose.filter((token) => !COMMON_STOP_WORDS.has(token));
  if (removeStops.length) variants.add(removeStops.join(" "));

  return Array.from(variants)
    .map((item) => item.trim())
    .filter((item) => item.length >= 2);
};

const buildLookupQueries = (row: ProductIngredientRow): string[] => {
  const queries = new Set<string>();
  const pushVariants = (value: string | null | undefined) => {
    if (!value) return;
    const raw = value.trim();
    if (raw) queries.add(raw);
    stripNameKeyVariants(raw).forEach((variant) => queries.add(variant));
  };

  pushVariants(row.name_raw);
  pushVariants(row.name_key);

  return Array.from(queries)
    .map((value) => value.trim())
    .filter((value) => value.length >= 2)
    .slice(0, 8);
};

const parseMatchConfidence = (raw: number | string | null | undefined): number | null => {
  const parsed =
    typeof raw === "number" ? raw : typeof raw === "string" ? Number(raw) : null;
  if (parsed == null || !Number.isFinite(parsed)) return null;
  return parsed;
};

const methodRank = (method: string | null): number => {
  if (!method) return 0;
  if (method === "exact") return 60;
  if (method === "synonym") return 55;
  if (method === "canonical_key") return 52;
  if (method === "constrained") return 50;
  if (method === "ingredient_name") return 45;
  if (method === "trgm") return 30;
  return 20;
};

const fetchMissingRows = async (sourceIds: string[]): Promise<ProductIngredientRow[]> => {
  const rows: ProductIngredientRow[] = [];
  for (const chunk of chunkArray(sourceIds, 200)) {
    let offset = 0;
    while (true) {
      const { data, error } = await supabase
        .from("product_ingredients")
        .select("id,source_id,canonical_source_id,ingredient_id,name_raw,name_key,is_active")
        .eq("source", source)
        .eq("is_active", true)
        .is("ingredient_id", null)
        .in(idColumn, chunk)
        .order("id", { ascending: true })
        .range(offset, offset + pageSize - 1);
      if (error) {
        throw new Error(`[ingredient-id-trgm-ab] fetch failed: ${error.message}`);
      }
      const page = (data ?? []) as ProductIngredientRow[];
      rows.push(...page);
      if (page.length < pageSize) break;
      offset += pageSize;
    }
  }
  return rows;
};

const resolveLookup = async (
  query: string,
  cache: Map<string, IngredientLookupRpcRow | null>,
): Promise<IngredientLookupRpcRow | null> => {
  const key = query.trim().toLowerCase();
  if (!key) return null;
  if (cache.has(key)) return cache.get(key) ?? null;

  const { data, error } = await withRetry(() =>
    supabase.rpc("resolve_ingredient_lookup", { query_text: query }),
  );
  if (error) {
    console.warn("[ingredient-id-trgm-ab] lookup failed", {
      query,
      meta: extractErrorMeta(error),
    });
    cache.set(key, null);
    return null;
  }

  const row = (Array.isArray(data) ? data[0] : data) as IngredientLookupRpcRow | null;
  cache.set(key, row ?? null);
  return row ?? null;
};

const fetchIngredientNameMap = async (ingredientIds: string[]): Promise<Map<string, string>> => {
  const map = new Map<string, string>();
  for (const chunk of chunkArray(ingredientIds, 200)) {
    const { data, error } = await supabase
      .from("ingredients")
      .select("id,name")
      .in("id", chunk);
    if (error) {
      throw new Error(`[ingredient-id-trgm-ab] ingredient meta fetch failed: ${error.message}`);
    }
    (data ?? []).forEach((row) => {
      if (!row?.id || typeof row?.name !== "string") return;
      map.set(row.id as string, row.name as string);
    });
  }
  return map;
};

const runWithConcurrency = async <T>(
  items: T[],
  worker: (item: T) => Promise<void>,
): Promise<void> => {
  const queue = [...items];
  const workers = Array.from({ length: concurrency }, async () => {
    while (queue.length) {
      const item = queue.shift();
      if (!item) return;
      await worker(item);
    }
  });
  await Promise.all(workers);
};

const acceptedAtThreshold = (
  method: string | null,
  confidence: number | null,
  threshold: number,
): boolean => {
  if (!method) return false;
  if (method !== "trgm") return true;
  if (confidence == null) return false;
  return confidence >= threshold;
};

const run = async () => {
  if (!sourceIdsFile) {
    throw new Error("[ingredient-id-trgm-ab] --source-ids-file is required");
  }
  if (relaxedThreshold > baselineThreshold) {
    throw new Error("[ingredient-id-trgm-ab] relaxed-threshold must be <= baseline-threshold");
  }

  const sourceIds = await readSourceIds(sourceIdsFile);
  if (!sourceIds.length) {
    throw new Error("[ingredient-id-trgm-ab] source ids file resolved to empty list");
  }

  const missingRows = await fetchMissingRows(sourceIds);
  const lookupCache = new Map<string, IngredientLookupRpcRow | null>();
  const decisions: MappingDecision[] = [];

  await runWithConcurrency(missingRows, async (row) => {
    const lookupQueries = buildLookupQueries(row);
    if (!lookupQueries.length) {
      decisions.push({
        rowId: row.id,
        sourceId: row.source_id,
        canonicalSourceId: row.canonical_source_id,
        nameRaw: row.name_raw,
        nameKey: row.name_key,
        selectedQuery: null,
        selectedIngredientId: null,
        selectedIngredientName: null,
        matchMethod: null,
        matchConfidence: null,
        baselineAccepted: false,
        relaxedAccepted: false,
      });
      return;
    }

    let selected:
      | {
          query: string;
          ingredientId: string;
          matchMethod: string | null;
          matchConfidence: number | null;
          score: number;
        }
      | null = null;

    for (const query of lookupQueries) {
      const lookup = await resolveLookup(query, lookupCache);
      const ingredientId = lookup?.ingredient_id ?? null;
      if (!ingredientId) continue;

      const matchMethod = lookup?.match_method ?? null;
      const matchConfidence = parseMatchConfidence(lookup?.match_confidence);
      const score = methodRank(matchMethod) * 100 + (matchConfidence ?? 0);
      if (!selected || score > selected.score) {
        selected = {
          query,
          ingredientId,
          matchMethod,
          matchConfidence,
          score,
        };
      }
      if (matchMethod === "exact" || matchMethod === "synonym") break;
    }

    const matchMethod = selected?.matchMethod ?? null;
    const matchConfidence = selected?.matchConfidence ?? null;
    decisions.push({
      rowId: row.id,
      sourceId: row.source_id,
      canonicalSourceId: row.canonical_source_id,
      nameRaw: row.name_raw,
      nameKey: row.name_key,
      selectedQuery: selected?.query ?? null,
      selectedIngredientId: selected?.ingredientId ?? null,
      selectedIngredientName: null,
      matchMethod,
      matchConfidence,
      baselineAccepted: acceptedAtThreshold(matchMethod, matchConfidence, baselineThreshold),
      relaxedAccepted: acceptedAtThreshold(matchMethod, matchConfidence, relaxedThreshold),
    });
  });

  const ingredientIds = Array.from(
    new Set(
      decisions
        .map((decision) => decision.selectedIngredientId)
        .filter((value): value is string => typeof value === "string" && value.length > 0),
    ),
  );
  const ingredientNameMap = await fetchIngredientNameMap(ingredientIds);
  decisions.forEach((decision) => {
    if (!decision.selectedIngredientId) return;
    decision.selectedIngredientName =
      ingredientNameMap.get(decision.selectedIngredientId) ?? null;
  });

  const baselineAccepted = decisions.filter((item) => item.baselineAccepted);
  const relaxedAccepted = decisions.filter((item) => item.relaxedAccepted);
  const newlyAccepted = decisions.filter((item) => !item.baselineAccepted && item.relaxedAccepted);

  const newlyAcceptedByMethod: Record<string, number> = {};
  newlyAccepted.forEach((item) => {
    const method = item.matchMethod ?? "unknown";
    newlyAcceptedByMethod[method] = (newlyAcceptedByMethod[method] ?? 0) + 1;
  });

  const reviewSample = newlyAccepted
    .slice()
    .sort((a, b) => {
      const aConf = a.matchConfidence ?? -1;
      const bConf = b.matchConfidence ?? -1;
      if (aConf !== bConf) return aConf - bConf;
      return a.sourceId.localeCompare(b.sourceId);
    })
    .slice(0, 20);

  const outputPayload = {
    generatedAt: new Date().toISOString(),
    source,
    idColumn,
    sourceIdsFile: path.resolve(sourceIdsFile),
    thresholds: {
      baseline: baselineThreshold,
      relaxed: relaxedThreshold,
    },
    scope: {
      sourceIdsCount: sourceIds.length,
      fetchedMissingRows: missingRows.length,
      concurrency,
      pageSize,
    },
    summary: {
      resolvedCandidateRows: decisions.filter((item) => item.selectedIngredientId).length,
      baselineAcceptedRows: baselineAccepted.length,
      relaxedAcceptedRows: relaxedAccepted.length,
      newlyAcceptedRows: newlyAccepted.length,
      deltaAcceptedRows: relaxedAccepted.length - baselineAccepted.length,
      newlyAcceptedByMethod,
    },
    beforeAfterMapping: {
      baselineAccepted,
      relaxedAccepted,
      newlyAccepted,
    },
  };

  const reviewPayload = {
    generatedAt: new Date().toISOString(),
    source,
    thresholds: {
      baseline: baselineThreshold,
      relaxed: relaxedThreshold,
    },
    totalNewlyAccepted: newlyAccepted.length,
    sampleSize: reviewSample.length,
    sample: reviewSample,
    checklist: [
      "Check nameRaw vs selectedIngredientName semantic match.",
      "Reject if selected ingredient changes core nutrient class.",
      "Reject if selected match is generic but nameRaw is highly specific botanical/chemical.",
      "If any medical-grade mismatch appears, do not apply threshold relaxation.",
    ],
  };

  await ensureDir(mappingOutputPath);
  await writeFile(mappingOutputPath, JSON.stringify(outputPayload, null, 2), "utf8");
  await writeFile(reviewOutputPath, JSON.stringify(reviewPayload, null, 2), "utf8");

  console.log(
    JSON.stringify(
      {
        output: {
          mapping: mappingOutputPath,
          review: reviewOutputPath,
        },
        summary: outputPayload.summary,
      },
      null,
      2,
    ),
  );
};

run().catch((error) => {
  console.error("[ingredient-id-trgm-ab] failed:", error instanceof Error ? error.message : error);
  process.exit(1);
});
