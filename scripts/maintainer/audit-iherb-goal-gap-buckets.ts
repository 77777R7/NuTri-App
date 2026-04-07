#!/usr/bin/env -S node --import tsx

import { execFileSync } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";
import process from "node:process";

import { createClient } from "@supabase/supabase-js";

import { normalizeIherbSupplementFactsRowsWithTitleFallback } from "../../backend/src/iherbOverlayIngredients.ts";
import { prepareCatalogProduct } from "../../lib/personalization/core/catalogProductEvaluation.ts";
import {
  mapNarrativeLabelCompleteness,
  normalizeGoalNarrativeFitLevel,
  scoreProductGoalMatches,
} from "../../lib/personalization/core/goalMatchScoring.ts";
import { listActiveGoalCatalogEntries } from "../../lib/personalization/core/goalCatalog.ts";
import { getIngredientGoalEdges } from "../../lib/personalization/core/goalMatchOntology.ts";
import type { DecisionReason, GoalKey, ProductGoalMatch } from "../../types/personalization";

type OverlayRow = {
  id: number;
  product_id: string;
  barcode_gtin14: string | null;
  brand_name: string;
  title: string;
  source_zip_path: string | null;
  supplement_facts: Record<string, unknown> | null;
  description_sections: Record<string, unknown> | null;
};

type UnknownBucket =
  | "not_full_facts_status"
  | "proprietary_blend_uncertainty"
  | "dose_not_disclosed"
  | "low_disclosure"
  | "no_goal_mapped_ingredients_with_missing_detail"
  | "other_unknown";

type NoneBucket =
  | "not_full_facts_and_no_signal"
  | "no_goal_mapped_ingredients"
  | "d_tier_or_near_zero_only"
  | "mapped_but_below_threshold";

type SampleRow = {
  productId: string;
  title: string;
  brandName: string;
  barcode: string | null;
  sourceZipPath: string | null;
  factsStatus: string;
  ingredientCount: number;
  notes: string[];
};

type BucketStats<TBucket extends string> = Record<TBucket, number>;

type GapBucketReport = {
  generatedAt: string;
  projectRef: string;
  totals: {
    overlayProducts: number;
    gatedOutOfScopeNonSupplement: number;
    allUnknown: number;
    allNone: number;
  };
  unknownBucketCounts: BucketStats<UnknownBucket>;
  noneBucketCounts: BucketStats<NoneBucket>;
  topUnknownReasonCodes: { code: string; count: number }[];
  topNoneReasonCodes: { code: string; count: number }[];
  topUnknownBrands: { brandName: string; count: number }[];
  topNoneBrands: { brandName: string; count: number }[];
  samples: {
    unknown: Record<UnknownBucket, SampleRow[]>;
    none: Record<NoneBucket, SampleRow[]>;
  };
};

const PROJECT_REF = "dlwlobgmjzcmpirwvetq";
const SUPABASE_URL = `https://${PROJECT_REF}.supabase.co`;
const goalKeys = listActiveGoalCatalogEntries().map((goal) => goal.goalKey);
const SAMPLE_LIMIT = 12;

const getArg = (flag: string): string | null => {
  const args = process.argv.slice(2);
  const index = args.indexOf(`--${flag}`);
  if (index === -1) return null;
  return args[index + 1] ?? null;
};

const batchSize = Math.max(100, Number(getArg("batch") ?? "500"));
const limit = Math.max(0, Number(getArg("limit") ?? "0"));
const outputDir = getArg("out-dir")
  ? path.resolve(getArg("out-dir") as string)
  : path.join(
      process.cwd(),
      "output",
      "maintainer-gates",
      `${new Date().toISOString().replace(/[:.]/g, "-")}_iherb_goal_gap_buckets`,
    );

const getServiceRoleKey = (): string => {
  if (process.env.SUPABASE_SERVICE_ROLE_KEY) {
    return process.env.SUPABASE_SERVICE_ROLE_KEY;
  }

  const raw = execFileSync(
    "supabase",
    ["projects", "api-keys", "--project-ref", PROJECT_REF, "-o", "json"],
    { encoding: "utf8" },
  );
  const apiKeys = JSON.parse(raw) as { id?: string; name?: string; api_key?: string }[];
  const serviceRoleKey =
    apiKeys.find((entry) => entry.id === "service_role" || entry.name === "service_role")?.api_key ?? "";
  if (!serviceRoleKey) {
    throw new Error("Unable to resolve Supabase service role key from Supabase CLI login.");
  }
  return serviceRoleKey;
};

const supabase = createClient(SUPABASE_URL, getServiceRoleKey(), {
  auth: { persistSession: false, autoRefreshToken: false },
});

const createBucketCounts = <TBucket extends string>(keys: readonly TBucket[]): BucketStats<TBucket> =>
  Object.fromEntries(keys.map((key) => [key, 0])) as BucketStats<TBucket>;

const increment = (map: Map<string, number>, key: string, delta = 1) => {
  map.set(key, (map.get(key) ?? 0) + delta);
};

const pushSample = (bucket: SampleRow[], row: SampleRow) => {
  if (bucket.length >= SAMPLE_LIMIT) return;
  bucket.push(row);
};

const readNutritionRows = (supplementFacts: Record<string, unknown> | null): Record<string, unknown>[] => {
  if (!supplementFacts) return [];
  const rows =
    (Array.isArray(supplementFacts.nutritionalFacts) ? supplementFacts.nutritionalFacts : null) ??
    (Array.isArray(supplementFacts.nutritional_facts) ? supplementFacts.nutritional_facts : null) ??
    [];
  return Array.isArray(rows) ? (rows as Record<string, unknown>[]) : [];
};

const fetchOverlayCount = async () => {
  const { count, error } = await supabase
    .from("iherb_overlay_products")
    .select("*", { head: true, count: "exact" });
  if (error) throw new Error(`Failed to count overlay rows: ${error.message}`);
  return count ?? 0;
};

const fetchOverlayBatch = async (afterId: number): Promise<OverlayRow[]> => {
  let query = supabase
    .from("iherb_overlay_products")
    .select("id,product_id,barcode_gtin14,brand_name,title,source_zip_path,supplement_facts,description_sections")
    .order("id", { ascending: true })
    .limit(batchSize);

  if (afterId > 0) {
    query = query.gt("id", afterId);
  }

  const { data, error } = await query;
  if (error) throw new Error(`Failed to read iherb_overlay_products: ${error.message}`);
  return (data ?? []) as OverlayRow[];
};

const collectSupportPairs = (matches: ProductGoalMatch[]) => {
  const pairs: { goalKey: GoalKey; ingredientKey: string }[] = [];

  for (const match of matches) {
    for (const reason of match.reasons) {
      if (reason.code !== "goal_supported_by_ingredient") continue;
      const goalKey = match.goalKey;
      const ingredientKey = typeof reason.params?.ingredientKey === "string" ? reason.params.ingredientKey : null;
      if (!ingredientKey) continue;
      pairs.push({ goalKey, ingredientKey });
    }
  }

  return pairs;
};

const readDescriptionText = (sections: Record<string, unknown> | null): string | null => {
  if (!sections) return null;
  for (const [key, value] of Object.entries(sections)) {
    if (!/description/i.test(key)) continue;
    if (typeof value !== "string") continue;
    const trimmed = value.trim();
    if (trimmed) return trimmed;
  }
  return null;
};

const resolveMatchedEdges = (pairs: { goalKey: GoalKey; ingredientKey: string }[]) =>
  pairs
    .map((pair) =>
      getIngredientGoalEdges(pair.goalKey).find((edge) => edge.ingredientKey === pair.ingredientKey) ?? null,
    )
    .filter((edge): edge is NonNullable<typeof edge> => Boolean(edge));

const classifyUnknownBucket = (params: {
  factsStatus: string;
  matches: ProductGoalMatch[];
  reasonCodes: Set<string>;
  supportPairCount: number;
}): UnknownBucket => {
  if (params.factsStatus !== "full") return "not_full_facts_status";
  if (params.reasonCodes.has("proprietary_blend_caps_goal_match")) return "proprietary_blend_uncertainty";
  if (params.reasonCodes.has("dose_not_disclosed")) return "dose_not_disclosed";
  if (params.reasonCodes.has("low_disclosure_caps_strong_match")) return "low_disclosure";
  if (params.supportPairCount === 0) return "no_goal_mapped_ingredients_with_missing_detail";
  return "other_unknown";
};

const classifyNoneBucket = (params: {
  factsStatus: string;
  supportPairCount: number;
  matchedEdges: ReturnType<typeof resolveMatchedEdges>;
}): NoneBucket => {
  if (params.factsStatus !== "full") return "not_full_facts_and_no_signal";
  if (params.supportPairCount === 0) return "no_goal_mapped_ingredients";
  const allLowSignal = params.matchedEdges.every(
    (edge) => edge.evidenceTier === "D" || edge.baseWeight < 0.18,
  );
  if (allLowSignal) return "d_tier_or_near_zero_only";
  return "mapped_but_below_threshold";
};

const toTopEntries = (map: Map<string, number>, keyName: string, limitCount = 10) =>
  [...map.entries()]
    .sort((left, right) => right[1] - left[1])
    .slice(0, limitCount)
    .map(([key, count]) => ({ [keyName]: key, count }));

const buildSample = (
  row: OverlayRow,
  factsStatus: string,
  ingredientCount: number,
  notes: string[],
): SampleRow => ({
  productId: row.product_id,
  title: row.title,
  brandName: row.brand_name,
  barcode: row.barcode_gtin14,
  sourceZipPath: row.source_zip_path,
  factsStatus,
  ingredientCount,
  notes,
});

const buildMarkdown = (report: GapBucketReport): string => {
  const lines: string[] = [];
  lines.push("# iHerb Goal Gap Buckets");
  lines.push("");
  lines.push(`- Generated at: ${report.generatedAt}`);
  lines.push(`- Overlay rows: ${report.totals.overlayProducts}`);
  lines.push(`- Gated out-of-scope non-supplement: ${report.totals.gatedOutOfScopeNonSupplement}`);
  lines.push(`- All unknown: ${report.totals.allUnknown}`);
  lines.push(`- All none: ${report.totals.allNone}`);
  lines.push("");
  lines.push("## Unknown buckets");
  for (const [bucket, count] of Object.entries(report.unknownBucketCounts)) {
    lines.push(`- ${bucket}: ${count}`);
  }
  lines.push("");
  lines.push("## None buckets");
  for (const [bucket, count] of Object.entries(report.noneBucketCounts)) {
    lines.push(`- ${bucket}: ${count}`);
  }
  lines.push("");
  lines.push("## Top unknown reason codes");
  report.topUnknownReasonCodes.forEach((row) => lines.push(`- ${row.code}: ${row.count}`));
  lines.push("");
  lines.push("## Top none reason codes");
  report.topNoneReasonCodes.forEach((row) => lines.push(`- ${row.code}: ${row.count}`));
  return `${lines.join("\n")}\n`;
};

const UNKNOWN_BUCKETS: readonly UnknownBucket[] = [
  "not_full_facts_status",
  "proprietary_blend_uncertainty",
  "dose_not_disclosed",
  "low_disclosure",
  "no_goal_mapped_ingredients_with_missing_detail",
  "other_unknown",
] as const;

const NONE_BUCKETS: readonly NoneBucket[] = [
  "not_full_facts_and_no_signal",
  "no_goal_mapped_ingredients",
  "d_tier_or_near_zero_only",
  "mapped_but_below_threshold",
] as const;

const run = async () => {
  await fs.mkdir(outputDir, { recursive: true });

  const overlayProducts = await fetchOverlayCount();
  const unknownBucketCounts = createBucketCounts(UNKNOWN_BUCKETS);
  const noneBucketCounts = createBucketCounts(NONE_BUCKETS);
  const unknownReasonCodes = new Map<string, number>();
  const noneReasonCodes = new Map<string, number>();
  const unknownBrands = new Map<string, number>();
  const noneBrands = new Map<string, number>();
  const unknownSamples = Object.fromEntries(UNKNOWN_BUCKETS.map((bucket) => [bucket, []])) as Record<
    UnknownBucket,
    SampleRow[]
  >;
  const noneSamples = Object.fromEntries(NONE_BUCKETS.map((bucket) => [bucket, []])) as Record<
    NoneBucket,
    SampleRow[]
  >;

  let allUnknown = 0;
  let allNone = 0;
  let gatedOutOfScopeNonSupplement = 0;
  let afterId = 0;
  let scanned = 0;

  while (true) {
    const batch = await fetchOverlayBatch(afterId);
    if (batch.length === 0) break;

    for (const row of batch) {
      if (limit > 0 && scanned >= limit) break;
      scanned += 1;
      afterId = row.id;

      const nutritionRows = readNutritionRows(row.supplement_facts);
      const ingredients = normalizeIherbSupplementFactsRowsWithTitleFallback({
        rows: nutritionRows.map((item) => ({
          substancy:
            typeof item.substancy === "string"
              ? item.substancy
              : typeof item.substance === "string"
                ? item.substance
                : typeof item.substance_name === "string"
                  ? item.substance_name
                  : typeof item.name === "string"
                    ? item.name
                    : "",
          amountPerServing:
            typeof item.amountPerServing === "string"
              ? item.amountPerServing
              : typeof item.amount_per_serving === "string"
                ? item.amount_per_serving
                : typeof item.amount === "string"
                  ? item.amount
                  : "",
          dailyValuePercent:
            typeof item.dailyValuePercent === "string"
              ? item.dailyValuePercent
              : typeof item.daily_value_percent === "string"
                ? item.daily_value_percent
                : typeof item.dailyValue === "string"
                  ? item.dailyValue
                  : null,
        })),
        title: row.title,
        brandName: row.brand_name,
        sourceZipPath: row.source_zip_path,
        servingSize:
          typeof row.supplement_facts?.servingSize === "string"
            ? row.supplement_facts.servingSize
            : typeof row.supplement_facts?.serving_size === "string"
              ? row.supplement_facts.serving_size
              : null,
        servingsPerContainer:
          typeof row.supplement_facts?.servingsPerContainer === "string"
            ? row.supplement_facts.servingsPerContainer
            : typeof row.supplement_facts?.servings_per_container === "string"
              ? row.supplement_facts.servings_per_container
              : null,
        descriptionText: readDescriptionText(row.description_sections),
      });

      const prepared = prepareCatalogProduct({
        productId: row.product_id,
        sourceProductId: row.product_id,
        barcode: row.barcode_gtin14,
        title: row.title,
        brandName: row.brand_name,
        sourceZipPath: row.source_zip_path,
        ingredients,
      });

      if (prepared.goalScoringBlockedReason === "out_of_scope_non_supplement") {
        gatedOutOfScopeNonSupplement += 1;
        continue;
      }

      const coverageStatus =
        prepared.factsStatus === "full" ? "coverage_ready" : "not_enough_structured_data";
      const matches = scoreProductGoalMatches({
        goals: goalKeys,
        ingredients: prepared.ingredientInputs,
        disclosureQuality: "high",
        proprietaryBlendWithoutClearActives: false,
      });

      const fitLevels = matches.map((match) =>
        normalizeGoalNarrativeFitLevel({
          tier: match.tier,
          reasonCodes: match.reasons.map((reason) => reason.code),
          coverageStatus,
          labelCompleteness: mapNarrativeLabelCompleteness(match.confidence.disclosure),
        }),
      );

      const allLevelsUnknown = fitLevels.every((level) => level === "unknown");
      const allLevelsNone = fitLevels.every((level) => level === "none");
      if (!allLevelsUnknown && !allLevelsNone) {
        continue;
      }

      const allReasons = matches.flatMap((match) => match.reasons);
      const reasonCodes = new Set(allReasons.map((reason) => reason.code));
      const supportPairs = collectSupportPairs(matches);
      const matchedEdges = resolveMatchedEdges(supportPairs);
      const ingredientCount = prepared.overlayIngredients.length;

      if (allLevelsUnknown) {
        allUnknown += 1;
        const bucket = classifyUnknownBucket({
          factsStatus: prepared.factsStatus,
          matches,
          reasonCodes,
          supportPairCount: supportPairs.length,
        });
        unknownBucketCounts[bucket] += 1;
        increment(unknownBrands, row.brand_name);
        allReasons.forEach((reason: DecisionReason) => increment(unknownReasonCodes, reason.code));
        pushSample(
          unknownSamples[bucket],
          buildSample(row, prepared.factsStatus, ingredientCount, [
            `supportPairs=${supportPairs.length}`,
            `reasonCodes=${[...reasonCodes].slice(0, 6).join(",") || "none"}`,
          ]),
        );
      }

      if (allLevelsNone) {
        allNone += 1;
        const bucket = classifyNoneBucket({
          factsStatus: prepared.factsStatus,
          supportPairCount: supportPairs.length,
          matchedEdges,
        });
        noneBucketCounts[bucket] += 1;
        increment(noneBrands, row.brand_name);
        allReasons.forEach((reason: DecisionReason) => increment(noneReasonCodes, reason.code));
        pushSample(
          noneSamples[bucket],
          buildSample(row, prepared.factsStatus, ingredientCount, [
            `supportPairs=${supportPairs.length}`,
            `matchedEdges=${matchedEdges.length}`,
            `reasonCodes=${[...reasonCodes].slice(0, 6).join(",") || "none"}`,
          ]),
        );
      }
    }

    console.log(`[goal-gap-buckets] scanned=${scanned} afterId=${afterId}`);
    if ((limit > 0 && scanned >= limit) || batch.length < batchSize) {
      break;
    }
  }

  const report: GapBucketReport = {
    generatedAt: new Date().toISOString(),
    projectRef: PROJECT_REF,
    totals: {
      overlayProducts,
      gatedOutOfScopeNonSupplement,
      allUnknown,
      allNone,
    },
    unknownBucketCounts,
    noneBucketCounts,
    topUnknownReasonCodes: toTopEntries(unknownReasonCodes, "code", 15),
    topNoneReasonCodes: toTopEntries(noneReasonCodes, "code", 15),
    topUnknownBrands: toTopEntries(unknownBrands, "brandName", 12),
    topNoneBrands: toTopEntries(noneBrands, "brandName", 12),
    samples: {
      unknown: unknownSamples,
      none: noneSamples,
    },
  };

  const jsonPath = path.join(outputDir, "iherb_goal_gap_buckets.json");
  const mdPath = path.join(outputDir, "iherb_goal_gap_buckets.md");
  await fs.writeFile(jsonPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
  await fs.writeFile(mdPath, buildMarkdown(report), "utf8");

  console.log(
    JSON.stringify(
      {
        status: "ok",
        outputDir,
        jsonPath,
        mdPath,
        gatedOutOfScopeNonSupplement,
        allUnknown,
        allNone,
      },
      null,
      2,
    ),
  );
};

run().catch((error) => {
  console.error(error instanceof Error ? error.stack : String(error));
  process.exitCode = 1;
});
