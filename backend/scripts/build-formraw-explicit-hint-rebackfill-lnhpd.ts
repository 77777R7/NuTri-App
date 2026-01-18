import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

import { supabase } from "../src/supabase.js";
import { extractErrorMeta, withRetry } from "../src/supabaseRetry.js";
import { collectExplicitFormTokens } from "../src/formTaxonomy/lnhpdFormTokenMap.js";

type IngredientRow = {
  source_id: string | null;
  canonical_source_id: string | null;
  ingredient_id: string | null;
  name_raw: string | null;
  name_key: string | null;
  form_raw: string | null;
};

type FactsRow = {
  lnhpd_id: string | number | null;
  facts_json: Record<string, unknown> | null;
};

type RebackfillEntry = {
  source: "lnhpd";
  sourceId: string;
  canonicalSourceId: string | null;
  stage: string;
  reason: string;
  ingredientId: string;
  hintTokens: string[];
};

const args = process.argv.slice(2);
const getArg = (flag: string) => {
  const idx = args.indexOf(`--${flag}`);
  if (idx === -1) return null;
  return args[idx + 1] ?? null;
};

const OUTPUT_PATH =
  getArg("output") ?? "output/formraw/formraw_explicit_hint_lnhpd.jsonl";
const SUMMARY_JSON = getArg("summary-json");
const SOURCE_IDS_FILE = getArg("source-ids-file");
const ID_COLUMN_ARG = (getArg("id-column") ?? "canonical_source_id").toLowerCase();
const ID_COLUMN =
  ID_COLUMN_ARG === "source_id" ? "source_id" : "canonical_source_id";
const LIMIT = Math.max(1, Number(getArg("limit") ?? "5000"));
const PAGE_SIZE = Math.max(1, Number(getArg("page-size") ?? "1000"));
const MAX_PAGE_SIZE = 1000;
const START_AFTER = getArg("start-after");

const ensureDir = async (filePath: string) => {
  const dir = path.dirname(filePath);
  if (!dir || dir === ".") return;
  await mkdir(dir, { recursive: true });
};

const normalizeText = (value: string): string =>
  value.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();

const LNHPD_MEDICINAL_NAME_KEYS = [
  "medicinal_ingredient_name",
  "ingredient_name",
  "medicinal_ingredient_name_en",
  "ingredient_name_en",
  "proper_name",
  "substance_name",
  "name",
];

const LNHPD_SOURCE_MATERIAL_KEYS = [
  "source_material",
  "source_material_desc",
  "source_material_name",
  "source_material_en",
];

const pickStringField = (record: Record<string, unknown>, keys: string[]): string[] => {
  const values: string[] = [];
  keys.forEach((key) => {
    const value = record[key];
    if (typeof value === "string") {
      const trimmed = value.trim();
      if (trimmed) values.push(trimmed);
    }
  });
  return values;
};

const extractNameKeys = (record: Record<string, unknown>): string[] => {
  const names = pickStringField(record, LNHPD_MEDICINAL_NAME_KEYS);
  const normalized = new Set<string>();
  names.forEach((name) => {
    const key = normalizeText(name);
    if (key) normalized.add(key);
  });
  return Array.from(normalized);
};

const extractFormSources = (record: Record<string, unknown>): string[] => {
  const sources = [
    ...pickStringField(record, LNHPD_MEDICINAL_NAME_KEYS),
    ...pickStringField(record, LNHPD_SOURCE_MATERIAL_KEYS),
    ...pickStringField(record, ["proper_name"]),
  ];
  return Array.from(new Set(sources));
};

const fetchFactsJsonByIds = async (
  sourceIds: string[],
): Promise<Map<string, Record<string, unknown>>> => {
  const factsMap = new Map<string, Record<string, unknown>>();
  for (const chunk of chunkArray(sourceIds, 200)) {
    const { data, error, status, rayId } = await withRetry(() =>
      supabase
        .from("lnhpd_facts_complete")
        .select("lnhpd_id,facts_json")
        .in("lnhpd_id", chunk),
    );
    if (error) {
      const meta = extractErrorMeta(error, status, rayId ?? null);
      throw new Error(`[formraw-explicit] facts_complete failed: ${meta.message ?? error.message}`);
    }
    (data ?? []).forEach((row) => {
      const entry = row as FactsRow;
      if (!entry?.lnhpd_id || !entry.facts_json) return;
      factsMap.set(String(entry.lnhpd_id), entry.facts_json);
    });
  }

  const missing = sourceIds.filter((id) => !factsMap.has(id));
  for (const chunk of chunkArray(missing, 200)) {
    const { data, error, status, rayId } = await withRetry(() =>
      supabase
        .from("lnhpd_facts")
        .select("lnhpd_id,facts_json")
        .eq("is_on_market", true)
        .in("lnhpd_id", chunk),
    );
    if (error) {
      const meta = extractErrorMeta(error, status, rayId ?? null);
      throw new Error(`[formraw-explicit] facts fallback failed: ${meta.message ?? error.message}`);
    }
    (data ?? []).forEach((row) => {
      const entry = row as FactsRow;
      if (!entry?.lnhpd_id || !entry.facts_json) return;
      factsMap.set(String(entry.lnhpd_id), entry.facts_json);
    });
  }

  return factsMap;
};

const buildTokenIndex = (factsJson: Record<string, unknown>): Map<string, string[]> => {
  const index = new Map<string, Set<string>>();
  const medicinalRaw = factsJson.medicinalIngredients;
  const medicinal = Array.isArray(medicinalRaw)
    ? medicinalRaw
    : medicinalRaw
      ? [medicinalRaw]
      : [];

  medicinal.forEach((item) => {
    if (!item || typeof item !== "object") return;
    const record = item as Record<string, unknown>;
    const nameKeys = extractNameKeys(record);
    if (!nameKeys.length) return;
    const sources = extractFormSources(record);
    const tokens = collectExplicitFormTokens(sources);
    if (!tokens.length) return;
    nameKeys.forEach((key) => {
      const bucket = index.get(key) ?? new Set<string>();
      tokens.forEach((token) => bucket.add(token));
      index.set(key, bucket);
    });
  });

  const normalized = new Map<string, string[]>();
  index.forEach((value, key) => {
    normalized.set(key, Array.from(value));
  });
  return normalized;
};

const RAW_HINT_RULES: Array<{ token: string; pattern: RegExp }> = [
  { token: "paren", pattern: /\(.*\)/ },
  { token: "as", pattern: /\bas\b/i },
];

const NORMALIZED_HINT_RULES: Array<{ token: string; pattern: RegExp }> = [
  { token: "extract", pattern: /\bextract\b/ },
  { token: "standardized", pattern: /\bstandardi[sz]ed\b/ },
  { token: "citrate", pattern: /\bcitrate\b/ },
  { token: "oxide", pattern: /\boxide\b/ },
  { token: "gluconate", pattern: /\bgluconate\b/ },
  { token: "sulfate", pattern: /\bsulphate\b|\bsulfate\b/ },
  { token: "picolinate", pattern: /\bpicolinate\b/ },
  { token: "bisglycinate", pattern: /\bbisglycinate\b/ },
  { token: "glycinate", pattern: /\bglycinate\b/ },
  { token: "chelate", pattern: /\bchelate\b|\bchelated\b/ },
  { token: "chloride", pattern: /\bchloride\b|\bhydrochloride\b/ },
  { token: "malate", pattern: /\bmalate\b/ },
  { token: "threonate", pattern: /\bthreonate\b/ },
  { token: "phosphate", pattern: /\bphosphate\b/ },
  { token: "methyl", pattern: /\bmethyl\b/ },
  { token: "hydroxy", pattern: /\bhydroxy\b/ },
  { token: "adenosyl", pattern: /\badenosyl\b/ },
  { token: "cyano", pattern: /\bcyano\b/ },
  { token: "liposomal", pattern: /\bliposomal\b/ },
  { token: "phytosome", pattern: /\bphytosome\b/ },
  { token: "enteric", pattern: /\benteric\b/ },
  { token: "ubiquinol", pattern: /\bubiquinol\b/ },
  { token: "ubiquinone", pattern: /\bubiquinone\b|\bubidecarenone\b/ },
  { token: "coq10", pattern: /\bcoq10\b|\bcoenzyme q10\b/ },
];

const loadSourceIds = async (filePath: string): Promise<string[]> => {
  const raw = await readFile(filePath, "utf8");
  const parsed = JSON.parse(raw);
  if (Array.isArray(parsed)) {
    return parsed
      .map((value) => {
        if (typeof value === "string") return value.trim();
        if (typeof value === "number") return String(value);
        return "";
      })
      .filter((value) => value.length > 0);
  }
  if (parsed && Array.isArray(parsed.sourceIds)) {
    return parsed.sourceIds
      .map((value: unknown) => {
        if (typeof value === "string") return value.trim();
        if (typeof value === "number") return String(value);
        return "";
      })
      .filter((value: string) => value.length > 0);
  }
  throw new Error(`[formraw-explicit] invalid source ids file: ${filePath}`);
};

const chunkArray = <T>(items: T[], size: number): T[][] => {
  const chunks: T[][] = [];
  for (let i = 0; i < items.length; i += size) {
    chunks.push(items.slice(i, i + size));
  }
  return chunks;
};

const matchExplicitHints = (nameRaw: string | null | undefined): string[] => {
  if (!nameRaw) return [];
  const hits: string[] = [];
  RAW_HINT_RULES.forEach((rule) => {
    if (rule.pattern.test(nameRaw)) hits.push(rule.token);
  });
  const normalized = normalizeText(nameRaw);
  if (!normalized) return Array.from(new Set(hits));
  NORMALIZED_HINT_RULES.forEach((rule) => {
    if (rule.pattern.test(normalized)) hits.push(rule.token);
  });
  return Array.from(new Set(hits));
};

const fetchRowsForSourceIds = async (
  sourceIds: string[],
  idColumn: "source_id" | "canonical_source_id",
): Promise<IngredientRow[]> => {
  const rows: IngredientRow[] = [];
  for (const chunk of chunkArray(sourceIds, 200)) {
    const { data, error } = await withRetry(() =>
      supabase
        .from("product_ingredients")
        .select("source_id,canonical_source_id,ingredient_id,name_raw,name_key,form_raw")
        .eq("source", "lnhpd")
        .eq("is_active", true)
        .in(idColumn, chunk)
        .not("ingredient_id", "is", null)
        .or("form_raw.is.null,form_raw.eq."),
    );
    if (error) {
      const meta = extractErrorMeta(error);
      throw new Error(`[formraw-explicit] query failed: ${meta.message ?? error.message}`);
    }
    rows.push(...((data ?? []) as IngredientRow[]));
  }
  return rows;
};

const scanMissingFormRaw = async () => {
  const runlistMap = new Map<string, RebackfillEntry>();
  const hintCounts = new Map<string, number>();
  const ingredientCounts = new Map<string, number>();
  let cursor = typeof START_AFTER === "string" && START_AFTER.trim() ? START_AFTER.trim() : null;
  let totalFetched = 0;

  const effectivePageSize = Math.min(PAGE_SIZE, MAX_PAGE_SIZE);
  while (runlistMap.size < LIMIT) {
    const { data, error, status } = await withRetry(() => {
      let query = supabase
        .from("product_ingredients")
        .select("source_id,canonical_source_id,ingredient_id,name_raw,name_key,form_raw")
        .eq("source", "lnhpd")
        .eq("is_active", true)
        .not("ingredient_id", "is", null)
        .or("form_raw.is.null,form_raw.eq.")
        .order(ID_COLUMN, { ascending: true })
        .limit(effectivePageSize);
      if (cursor) query = query.gt(ID_COLUMN, cursor);
      return query;
    });

    if (error) {
      const meta = extractErrorMeta(error, status);
      throw new Error(`[formraw-explicit] scan failed: ${meta.message ?? error.message}`);
    }
    const rows = (data ?? []) as IngredientRow[];
    if (!rows.length) break;

    totalFetched += rows.length;
    rows.forEach((row) => {
      const sourceId =
        ID_COLUMN === "canonical_source_id"
          ? row.canonical_source_id ?? null
          : row.source_id ?? null;
      const ingredientId = row.ingredient_id ?? null;
      if (!sourceId || !ingredientId) return;
      if (runlistMap.has(sourceId)) return;
      const hints = matchExplicitHints(row.name_raw);
      if (!hints.length) return;
      runlistMap.set(sourceId, {
        source: "lnhpd",
        sourceId,
        canonicalSourceId: row.canonical_source_id ?? null,
        stage: "formraw_explicit_hint",
        reason: "explicit_hint",
        ingredientId,
        hintTokens: hints,
      });
      ingredientCounts.set(ingredientId, (ingredientCounts.get(ingredientId) ?? 0) + 1);
      hints.forEach((token) => {
        hintCounts.set(token, (hintCounts.get(token) ?? 0) + 1);
      });
    });

    cursor =
      ID_COLUMN === "canonical_source_id"
        ? rows[rows.length - 1]?.canonical_source_id ?? cursor
        : rows[rows.length - 1]?.source_id ?? cursor;
    if (rows.length < effectivePageSize) break;
  }

  return {
    runlist: Array.from(runlistMap.values()).slice(0, LIMIT),
    totalFetched,
    cursor,
    hintCounts,
    ingredientCounts,
  };
};

const run = async () => {
  let runlist: RebackfillEntry[] = [];
  let totalFetched = 0;
  let cursor: string | null = null;
  const hintCounts = new Map<string, number>();
  const ingredientCounts = new Map<string, number>();
  let candidateFormRawRows = 0;

  if (SOURCE_IDS_FILE) {
    const sourceIds = await loadSourceIds(SOURCE_IDS_FILE);
    if (!sourceIds.length) {
      throw new Error(`[formraw-explicit] source ids file empty: ${SOURCE_IDS_FILE}`);
    }
    const rows = await fetchRowsForSourceIds(sourceIds, ID_COLUMN);
    const canonicalIds = Array.from(
      new Set(
        rows
          .map((row) => row.canonical_source_id)
          .filter((value): value is string => Boolean(value)),
      ),
    );
    const factsMap = await fetchFactsJsonByIds(canonicalIds);
    const tokenIndexBySourceId = new Map<string, Map<string, string[]>>();
    factsMap.forEach((factsJson, canonicalId) => {
      tokenIndexBySourceId.set(canonicalId, buildTokenIndex(factsJson));
    });

    rows.forEach((row) => {
      const sourceId =
        ID_COLUMN === "canonical_source_id"
          ? row.canonical_source_id ?? null
          : row.source_id ?? null;
      const ingredientId = row.ingredient_id ?? null;
      if (!sourceId || !ingredientId) return;
      const canonicalId = row.canonical_source_id ?? null;
      const tokenIndex = canonicalId ? tokenIndexBySourceId.get(canonicalId) : null;
      const nameKey = row.name_key ?? (row.name_raw ? normalizeText(row.name_raw) : "");
      const tokens = tokenIndex?.get(nameKey) ?? [];
      if (tokens.length) candidateFormRawRows += 1;
      if (runlist.find((entry) => entry.sourceId === sourceId)) return;
      const hints = tokens.length ? tokens : matchExplicitHints(row.name_raw);
      if (!hints.length) return;
      runlist.push({
        source: "lnhpd",
        sourceId,
        canonicalSourceId: row.canonical_source_id ?? null,
        stage: "formraw_explicit_hint",
        reason: "explicit_hint",
        ingredientId,
        hintTokens: hints,
      });
      ingredientCounts.set(ingredientId, (ingredientCounts.get(ingredientId) ?? 0) + 1);
      hints.forEach((token) => {
        hintCounts.set(token, (hintCounts.get(token) ?? 0) + 1);
      });
    });
    totalFetched = rows.length;
  } else {
    const scanned = await scanMissingFormRaw();
    runlist = scanned.runlist;
    totalFetched = scanned.totalFetched;
    cursor = scanned.cursor ?? null;
    scanned.hintCounts.forEach((count, token) => hintCounts.set(token, count));
    scanned.ingredientCounts.forEach((count, ingredientId) => ingredientCounts.set(ingredientId, count));
  }

  const uniqueSourceIds = Array.from(new Set(runlist.map((entry) => entry.sourceId)));
  const hintsTop = Array.from(hintCounts.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, 20)
    .map(([token, count]) => ({ token, count }));
  const ingredientTop = Array.from(ingredientCounts.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, 20)
    .map(([ingredientId, count]) => ({ ingredientId, count }));

  await ensureDir(OUTPUT_PATH);
  await writeFile(
    OUTPUT_PATH,
    `${runlist.map((entry) => JSON.stringify(entry)).join("\n")}\n`,
    "utf8",
  );

  const summary = {
    mode: "formraw_explicit_hint",
    output: OUTPUT_PATH,
    limit: LIMIT,
    totalFetched,
    cursor,
    sourceIdsFile: SOURCE_IDS_FILE ?? null,
    idColumn: ID_COLUMN,
    uniqueSourceIds: uniqueSourceIds.length,
    runlistLines: runlist.length,
    candidateFormRawRows,
    topHintTokens: hintsTop,
    topIngredients: ingredientTop,
    timestamp: new Date().toISOString(),
  };

  const summaryPath = SUMMARY_JSON ?? OUTPUT_PATH.replace(/\.jsonl$/, "_summary.json");
  await writeFile(summaryPath, JSON.stringify(summary, null, 2), "utf8");

  console.log(JSON.stringify(summary, null, 2));
};

run().catch((error) => {
  console.error("[formraw-explicit] failed:", error instanceof Error ? error.message : error);
  process.exit(1);
});
