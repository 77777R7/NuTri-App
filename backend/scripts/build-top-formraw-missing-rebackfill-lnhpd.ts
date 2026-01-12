import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

import { supabase } from "../src/supabase.js";
import { extractErrorMeta, withRetry } from "../src/supabaseRetry.js";

type IngredientMetaRow = {
  id: string;
  name: string | null;
  canonical_key: string | null;
};

type IngredientRow = {
  id: string | null;
  source_id: string | null;
  canonical_source_id: string | null;
  ingredient_id: string | null;
  form_raw: string | null;
};

type ScoreRow = {
  source_id: string | null;
  explain_json: Record<string, unknown> | null;
};

type RunlistEntry = {
  source: "lnhpd";
  sourceId: string;
  canonicalSourceId: string | null;
  stage: string;
  reason: string;
  ingredientId: string;
  count: number;
};

type PatternRule = {
  reason: string;
  pattern: RegExp;
};

const args = process.argv.slice(2);
const getArg = (flag: string) => {
  const idx = args.indexOf(`--${flag}`);
  if (idx === -1) return null;
  return args[idx + 1] ?? null;
};

const OUTPUT_PATH =
  getArg("output") ?? "output/formraw/topk_formraw_missing.jsonl";
const SUMMARY_JSON = getArg("summary-json");
const SOURCE_IDS_FILE = getArg("source-ids-file");
const SOURCE_IDS_OUTPUT = getArg("source-ids-output");
const TOP_K = Math.max(1, Number(getArg("top-k") ?? "20"));
const MIN_COUNT = Math.max(1, Number(getArg("min-count") ?? "10"));
const LIMIT = Math.max(1, Number(getArg("limit") ?? "20000"));
const PAGE_SIZE = Math.max(1, Number(getArg("page-size") ?? "2000"));
const SCAN_LIMIT = Math.max(1, Number(getArg("scan-limit") ?? "200000"));
const SCORE_SCAN_LIMIT = Math.max(1, Number(getArg("score-scan-limit") ?? "200000"));

const normalizeText = (value: string): string =>
  value.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();

const formatErrorMessage = (error: unknown): string => {
  if (error && typeof error === "object" && "message" in error) {
    const message = (error as { message?: unknown }).message;
    if (typeof message === "string" && message.trim()) return message;
  }
  return error ? String(error) : "unknown error";
};

const NON_SCORING_PATTERNS: PatternRule[] = [
  {
    reason: "non_scoring_solvent",
    pattern: /\b(ethyl alcohol|ethanol|aqua|water|purified water|glycerin|glycerine)\b/,
  },
  {
    reason: "non_scoring_animal_source",
    pattern: /\b(rabbit|porcine|sus scrofa|oryctolagus cuniculus)\b/,
  },
  {
    reason: "non_scoring_dosage_form",
    pattern: /\b(capsule|capsules|tablet|tablets|softgel|softgels)\b/,
  },
];

const SPECIAL_HANDLING_PATTERNS: PatternRule[] = [
  {
    reason: "special_handling_homeopathy",
    pattern:
      /\b(homeopathic|homeopathy|natrum muriaticum|kali muriaticum|apis mellifica|mercurius corrosivus|bryonia|belladonna|drosera|cantharis|pulsatilla|orchitinum|sarsaparilla|absinthium|aethusa|ruta|causticum|aesculus|caryophyllus|histaminum|pneumococcinum|bromum|colocynthis|graphites|arnica|ipecacuanha|cinnabaris|lupulinum|syphilinum|camphora)\b/,
  },
  {
    reason: "special_handling_homeopathy",
    pattern: /\b\d+(?:\.\d+)?[xXcCdD]\b/,
  },
  {
    reason: "special_handling_enzyme",
    pattern: /\b(lipase|amylase|protease|lactase|cellulase|galactosidase|bromelain|papain|enzyme|enzymes)\b/,
  },
];

const NON_SCORING_PREFIXES = [
  "calorie",
  "calories",
  "total fat",
  "saturated fat",
  "trans fat",
  "cholesterol",
  "total carbohydrate",
  "total carbohydrates",
  "dietary fiber",
  "total sugars",
  "added sugars",
  "sugars",
  "protein",
].map(normalizeText);

const isNonScoringNutrient = (nameKey: string): boolean =>
  NON_SCORING_PREFIXES.some((prefix) => nameKey === prefix || nameKey.startsWith(`${prefix} `));

const matchPattern = (values: string[], patterns: PatternRule[]): PatternRule | null => {
  for (const value of values) {
    if (!value) continue;
    for (const rule of patterns) {
      if (rule.pattern.test(value)) return rule;
    }
  }
  return null;
};

const chunkArray = <T>(items: T[], size: number): T[][] => {
  const chunks: T[][] = [];
  for (let i = 0; i < items.length; i += size) {
    chunks.push(items.slice(i, i + size));
  }
  return chunks;
};

const ensureDir = async (filePath: string) => {
  const dir = path.dirname(filePath);
  if (!dir || dir === ".") return;
  await mkdir(dir, { recursive: true });
};

const readSourceIdsFromFile = async (filePath: string): Promise<string[]> => {
  const raw = await readFile(filePath, "utf8");
  const parsed = JSON.parse(raw);
  if (Array.isArray(parsed)) {
    return parsed.filter((value) => typeof value === "string" && value.length > 0);
  }
  if (parsed && Array.isArray(parsed.sourceIds)) {
    return parsed.sourceIds.filter((value: unknown) => typeof value === "string" && value.length > 0);
  }
  return [];
};

const normalizeSourceIds = (ids: string[]): string[] =>
  Array.from(new Set(ids)).filter(Boolean).sort((a, b) => a.localeCompare(b));

const summaryPathFor = (filePath: string): string => {
  if (filePath.endsWith(".jsonl")) {
    return filePath.replace(/\.jsonl$/, "_summary.json");
  }
  return `${filePath}_summary.json`;
};

const fetchZeroCoverageSourceIds = async (sourceIds?: string[]): Promise<{
  sourceIds: Set<string>;
  scanned: number;
  truncated: boolean;
}> => {
  const result = new Set<string>();
  let scanned = 0;
  let cursor: string | null = null;

  if (sourceIds && sourceIds.length) {
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
        throw new Error(
          `[top-formraw] score scan failed: ${meta.message ?? formatErrorMessage(error)}`,
        );
      }
      const rows = (data ?? []) as ScoreRow[];
      scanned += rows.length;
      rows.forEach((row) => {
        const sourceId = row.source_id ?? null;
        if (!sourceId) return;
        const ratio = (row.explain_json as { evidence?: { formCoverageRatio?: unknown } })?.evidence
          ?.formCoverageRatio;
        if (typeof ratio === "number" && ratio <= 0) {
          result.add(sourceId);
        }
      });
    }
    return {
      sourceIds: result,
      scanned,
      truncated: false,
    };
  }

  while (scanned < SCORE_SCAN_LIMIT) {
    const { data, error, status } = await withRetry(() => {
      let query = supabase
        .from("product_scores")
        .select("source_id,explain_json")
        .eq("source", "lnhpd")
        .order("source_id", { ascending: true })
        .limit(PAGE_SIZE);
      if (cursor) query = query.gt("source_id", cursor);
      return query;
    });
    if (error) {
      const meta = extractErrorMeta(error, status ?? null);
      throw new Error(`[top-formraw] score scan failed: ${meta.message ?? formatErrorMessage(error)}`);
    }
    const rows = (data ?? []) as ScoreRow[];
    if (!rows.length) break;
    scanned += rows.length;
    rows.forEach((row) => {
      const sourceId = row.source_id ?? null;
      if (!sourceId) return;
      const ratio = (row.explain_json as { evidence?: { formCoverageRatio?: unknown } })?.evidence
        ?.formCoverageRatio;
      if (typeof ratio === "number" && ratio <= 0) {
        result.add(sourceId);
      }
    });
    cursor = rows[rows.length - 1]?.source_id ?? null;
    if (!cursor) break;
    if (scanned >= SCORE_SCAN_LIMIT) break;
  }

  return {
    sourceIds: result,
    scanned,
    truncated: scanned >= SCORE_SCAN_LIMIT,
  };
};

const collectFormRawMissingCounts = async (sourceIds?: string[]): Promise<{
  counts: Map<string, number>;
  scanned: number;
  truncated: boolean;
}> => {
  const counts = new Map<string, number>();
  let scanned = 0;
  let cursor: string | null = null;

  if (sourceIds && sourceIds.length) {
    for (const chunk of chunkArray(sourceIds, 200)) {
      const { data, error, status } = await withRetry(() =>
        supabase
          .from("product_ingredients")
          .select("id,source_id,ingredient_id,form_raw")
          .eq("source", "lnhpd")
          .eq("is_active", true)
          .not("ingredient_id", "is", null)
          .in("source_id", chunk)
          .or("form_raw.is.null,form_raw.eq."),
      );
      if (error) {
        const meta = extractErrorMeta(error, status ?? null);
        throw new Error(
          `[top-formraw] missing form_raw scan failed: ${meta.message ?? formatErrorMessage(error)}`,
        );
      }
      const rows = (data ?? []) as IngredientRow[];
      scanned += rows.length;
      rows.forEach((row) => {
        if (!row.ingredient_id) return;
        counts.set(row.ingredient_id, (counts.get(row.ingredient_id) ?? 0) + 1);
      });
    }
    return {
      counts,
      scanned,
      truncated: false,
    };
  }

  while (scanned < SCAN_LIMIT) {
    const { data, error, status } = await withRetry(() => {
      let query = supabase
        .from("product_ingredients")
        .select("id,source_id,ingredient_id,form_raw")
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
      const meta = extractErrorMeta(error, status ?? null);
      throw new Error(
        `[top-formraw] missing form_raw scan failed: ${meta.message ?? formatErrorMessage(error)}`,
      );
    }
    const rows = (data ?? []) as IngredientRow[];
    if (!rows.length) break;
    scanned += rows.length;
    rows.forEach((row) => {
      if (!row.ingredient_id) return;
      counts.set(row.ingredient_id, (counts.get(row.ingredient_id) ?? 0) + 1);
    });
    cursor = rows[rows.length - 1]?.source_id ?? null;
    if (!cursor) break;
    if (scanned >= SCAN_LIMIT) break;
  }

  return {
    counts,
    scanned,
    truncated: scanned >= SCAN_LIMIT,
  };
};

const addZeroCoverageCounts = async (
  counts: Map<string, number>,
  sourceIds: string[],
): Promise<number> => {
  let scanned = 0;
  for (const chunk of chunkArray(sourceIds, 200)) {
    const { data, error } = await withRetry(() =>
      supabase
        .from("product_ingredients")
        .select("id,ingredient_id,form_raw")
        .eq("source", "lnhpd")
        .eq("is_active", true)
        .not("ingredient_id", "is", null)
        .in("source_id", chunk),
    );
    if (error) {
      const meta = extractErrorMeta(error);
      throw new Error(
        `[top-formraw] zero coverage scan failed: ${meta.message ?? formatErrorMessage(error)}`,
      );
    }
    const rows = (data ?? []) as IngredientRow[];
    scanned += rows.length;
    rows.forEach((row) => {
      if (!row.ingredient_id) return;
      if (!row.form_raw || !row.form_raw.trim()) return;
      counts.set(row.ingredient_id, (counts.get(row.ingredient_id) ?? 0) + 1);
    });
  }
  return scanned;
};

const fetchIngredientMeta = async (ingredientIds: string[]): Promise<Map<string, IngredientMetaRow>> => {
  const map = new Map<string, IngredientMetaRow>();
  for (const chunk of chunkArray(ingredientIds, 200)) {
    const { data, error } = await withRetry(() =>
      supabase
        .from("ingredients")
        .select("id,name,canonical_key")
        .in("id", chunk),
    );
    if (error) {
      const meta = extractErrorMeta(error);
      throw new Error(
        `[top-formraw] ingredient meta failed: ${meta.message ?? formatErrorMessage(error)}`,
      );
    }
    (data ?? []).forEach((row) => {
      if (!row?.id) return;
      map.set(row.id, row as IngredientMetaRow);
    });
  }
  return map;
};

const shouldExcludeIngredient = (
  name: string | null,
  canonicalKey: string | null,
): { excluded: boolean; reason?: string } => {
  const normalizedValues = [
    normalizeText(name ?? ""),
    normalizeText(canonicalKey ?? ""),
  ].filter(Boolean);
  if (normalizedValues.some((value) => isNonScoringNutrient(value))) {
    return { excluded: true, reason: "non_scoring_nutrient" };
  }
  const nonScoring = matchPattern(normalizedValues, NON_SCORING_PATTERNS);
  if (nonScoring) return { excluded: true, reason: nonScoring.reason };
  const special = matchPattern(normalizedValues, SPECIAL_HANDLING_PATTERNS);
  if (special) return { excluded: true, reason: special.reason };
  return { excluded: false };
};

const buildRunlist = async (
  ingredientIds: string[],
  zeroCoverageSet: Set<string>,
  counts: Map<string, number>,
  allowedSourceIds?: Set<string>,
): Promise<Map<string, RunlistEntry>> => {
  const runlistMap = new Map<string, RunlistEntry>();

  const addRow = (row: IngredientRow, ingredientId: string) => {
    const sourceId = row.source_id ?? null;
    if (!sourceId) return;
    if (allowedSourceIds && !allowedSourceIds.has(sourceId)) return;
    const count = counts.get(ingredientId) ?? 0;
    const existing = runlistMap.get(sourceId);
    if (!existing || count > existing.count) {
      runlistMap.set(sourceId, {
        source: "lnhpd",
        sourceId,
        canonicalSourceId: row.canonical_source_id ?? sourceId,
        stage: "formraw_top_missing",
        reason: "top_formraw_missing",
        ingredientId,
        count,
      });
    }
  };

  if (allowedSourceIds && allowedSourceIds.size) {
    for (const chunk of chunkArray(Array.from(allowedSourceIds), 200)) {
      const { data, error } = await withRetry(() =>
        supabase
          .from("product_ingredients")
          .select("id,source_id,canonical_source_id,ingredient_id,form_raw")
          .eq("source", "lnhpd")
          .eq("is_active", true)
          .in("ingredient_id", ingredientIds)
          .in("source_id", chunk)
          .or("form_raw.is.null,form_raw.eq."),
      );
      if (error) {
        const meta = extractErrorMeta(error);
        throw new Error(
          `[top-formraw] runlist form_raw scan failed: ${meta.message ?? formatErrorMessage(error)}`,
        );
      }
      const rows = (data ?? []) as IngredientRow[];
      rows.forEach((row) => {
        if (!row.ingredient_id) return;
        addRow(row, row.ingredient_id);
      });
      if (runlistMap.size >= LIMIT) break;
    }
  } else {
    let cursor: string | null = null;
    while (runlistMap.size < LIMIT) {
      const { data, error } = await withRetry(() => {
        let query = supabase
          .from("product_ingredients")
          .select("id,source_id,canonical_source_id,ingredient_id,form_raw")
          .eq("source", "lnhpd")
          .eq("is_active", true)
          .in("ingredient_id", ingredientIds)
          .or("form_raw.is.null,form_raw.eq.")
          .order("source_id", { ascending: true })
          .limit(PAGE_SIZE);
        if (cursor) query = query.gt("source_id", cursor);
        return query;
      });
      if (error) {
        const meta = extractErrorMeta(error);
        throw new Error(
          `[top-formraw] runlist form_raw scan failed: ${meta.message ?? formatErrorMessage(error)}`,
        );
      }
      const rows = (data ?? []) as IngredientRow[];
      if (!rows.length) break;
      rows.forEach((row) => {
        if (!row.ingredient_id) return;
        addRow(row, row.ingredient_id);
      });
      cursor = rows[rows.length - 1]?.source_id ?? null;
      if (!cursor) break;
    }
  }

  if (zeroCoverageSet.size) {
    for (const chunk of chunkArray(Array.from(zeroCoverageSet), 200)) {
      if (runlistMap.size >= LIMIT) break;
      const { data, error } = await withRetry(() =>
        supabase
          .from("product_ingredients")
          .select("id,source_id,canonical_source_id,ingredient_id,form_raw")
          .eq("source", "lnhpd")
          .eq("is_active", true)
          .in("ingredient_id", ingredientIds)
          .in("source_id", chunk),
      );
      if (error) {
        const meta = extractErrorMeta(error);
        throw new Error(
          `[top-formraw] runlist zero coverage scan failed: ${meta.message ?? formatErrorMessage(error)}`,
        );
      }
      const rows = (data ?? []) as IngredientRow[];
      rows.forEach((row) => {
        if (!row.ingredient_id) return;
        if (!row.form_raw || !row.form_raw.trim()) return;
        addRow(row, row.ingredient_id);
      });
    }
  }

  return runlistMap;
};

const run = async () => {
  const restrictedSourceIds = SOURCE_IDS_FILE
    ? normalizeSourceIds(await readSourceIdsFromFile(SOURCE_IDS_FILE))
    : null;
  const restrictedSet = restrictedSourceIds ? new Set(restrictedSourceIds) : null;
  if (restrictedSourceIds && !restrictedSourceIds.length) {
    throw new Error(`[top-formraw] source ids file is empty: ${SOURCE_IDS_FILE}`);
  }

  const zeroCoverageStats = await fetchZeroCoverageSourceIds(restrictedSourceIds ?? undefined);
  const zeroCoverageSet = zeroCoverageStats.sourceIds;
  const { counts, scanned, truncated } = await collectFormRawMissingCounts(
    restrictedSourceIds ?? undefined,
  );
  const zeroCoverageScanned = await addZeroCoverageCounts(counts, Array.from(zeroCoverageSet));

  const ingredientIds = Array.from(counts.keys());
  const metaMap = await fetchIngredientMeta(ingredientIds);

  const candidates = ingredientIds
    .map((ingredientId) => {
      const count = counts.get(ingredientId) ?? 0;
      const meta = metaMap.get(ingredientId);
      const name = meta?.name ?? null;
      const canonicalKey = meta?.canonical_key ?? null;
      const exclude = shouldExcludeIngredient(name, canonicalKey);
      return {
        ingredientId,
        count,
        name,
        canonicalKey,
        excluded: exclude.excluded,
        excludedReason: exclude.reason ?? null,
      };
    })
    .filter((entry) => entry.count >= MIN_COUNT);

  const excluded = candidates.filter((entry) => entry.excluded);
  const allowed = candidates.filter((entry) => !entry.excluded);
  allowed.sort((a, b) => b.count - a.count);

  const selected = allowed.slice(0, TOP_K);
  const selectedIds = selected.map((entry) => entry.ingredientId);

  const runlistMap = await buildRunlist(selectedIds, zeroCoverageSet, counts, restrictedSet ?? undefined);
  const entries = Array.from(runlistMap.values())
    .sort((a, b) => a.sourceId.localeCompare(b.sourceId))
    .slice(0, LIMIT);

  if (restrictedSet) {
    const outOfScope = entries.find((entry) => !restrictedSet.has(entry.sourceId));
    if (outOfScope) {
      throw new Error(`[top-formraw] runlist contains out-of-scope sourceId: ${outOfScope.sourceId}`);
    }
  }

  const uniqueSourceIds = Array.from(
    new Set(entries.map((entry) => entry.sourceId)),
  ).sort((a, b) => a.localeCompare(b));
  if (SOURCE_IDS_OUTPUT) {
    await ensureDir(SOURCE_IDS_OUTPUT);
    await writeFile(SOURCE_IDS_OUTPUT, JSON.stringify(uniqueSourceIds, null, 2), "utf8");
  }

  await ensureDir(OUTPUT_PATH);
  await writeFile(OUTPUT_PATH, `${entries.map((entry) => JSON.stringify(entry)).join("\n")}\n`, "utf8");

  const summary = {
    mode: "topk_formraw_missing",
    output: OUTPUT_PATH,
    topK: TOP_K,
    minCount: MIN_COUNT,
    limit: LIMIT,
    restrictedToSourceIdsFile: SOURCE_IDS_FILE ?? null,
    scan: {
      formRawMissingScanned: scanned,
      formRawMissingTruncated: truncated,
      zeroCoverageScanned: zeroCoverageScanned,
      scoreScanRows: zeroCoverageStats.scanned,
      scoreScanTruncated: zeroCoverageStats.truncated,
    },
    selectedIngredientCount: selected.length,
    excludedIngredientCount: excluded.length,
    totalRunlistLines: entries.length,
    uniqueSourceIds: uniqueSourceIds.length,
    sourceIdsOutput: SOURCE_IDS_OUTPUT ?? null,
    timestamp: new Date().toISOString(),
    notes: ["filters: NON_SCORING / SPECIAL_HANDLING applied"],
    topIngredients: selected.map((entry) => ({
      ingredientId: entry.ingredientId,
      canonicalKey: entry.canonicalKey,
      name: entry.name,
      count: entry.count,
    })),
  };

  const summaryPath = SUMMARY_JSON ?? summaryPathFor(OUTPUT_PATH);
  await writeFile(summaryPath, JSON.stringify(summary, null, 2), "utf8");

  console.log(JSON.stringify(summary, null, 2));
};

run().catch((error) => {
  console.error("[top-formraw] failed:", error instanceof Error ? error.message : error);
  process.exit(1);
});
