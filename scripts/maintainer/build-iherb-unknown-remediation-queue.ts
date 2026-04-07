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
import type { GoalKey, ProductGoalMatch } from "../../types/personalization";

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

type RemediationLane =
  | "parser_partial_facts"
  | "dose_disclosure_for_supported_ingredient"
  | "broad_unknown_from_any_missing_amount"
  | "proprietary_blend_uncertainty"
  | "other_unknown";

type QueueRow = {
  remediationLane: RemediationLane;
  productId: string;
  brandName: string;
  title: string;
  barcode: string | null;
  sourceZipPath: string | null;
  factsStatus: string;
  ingredientCount: number;
  ingredientsMissingAmountCount: number;
  supportGoalKeys: GoalKey[];
  supportIngredientKeys: string[];
  reasonCodes: string[];
  suggestedFix: string;
};

type LaneSummary = {
  count: number;
  topBrands: { brandName: string; count: number }[];
  topSourceZipPaths: { sourceZipPath: string; count: number }[];
  topSupportIngredientKeys: { ingredientKey: string; count: number }[];
  suggestedFix: string;
};

type QueueReport = {
  generatedAt: string;
  projectRef: string;
  totals: {
    overlayProducts: number;
    gatedOutOfScopeNonSupplement: number;
    unknownProducts: number;
  };
  laneSummary: Record<RemediationLane, LaneSummary>;
  sampleRows: Record<RemediationLane, QueueRow[]>;
};

const PROJECT_REF = "dlwlobgmjzcmpirwvetq";
const SUPABASE_URL = `https://${PROJECT_REF}.supabase.co`;
const goalKeys = listActiveGoalCatalogEntries().map((goal) => goal.goalKey);
const SAMPLE_LIMIT = 15;

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
      `${new Date().toISOString().replace(/[:.]/g, "-")}_iherb_unknown_remediation_queue`,
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

const readNutritionRows = (supplementFacts: Record<string, unknown> | null): Record<string, unknown>[] => {
  if (!supplementFacts) return [];
  const rows =
    (Array.isArray(supplementFacts.nutritionalFacts) ? supplementFacts.nutritionalFacts : null) ??
    (Array.isArray(supplementFacts.nutritional_facts) ? supplementFacts.nutritional_facts : null) ??
    [];
  return Array.isArray(rows) ? (rows as Record<string, unknown>[]) : [];
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

const increment = (map: Map<string, number>, key: string, delta = 1) => {
  map.set(key, (map.get(key) ?? 0) + delta);
};

const pushSample = (bucket: QueueRow[], row: QueueRow) => {
  if (bucket.length >= SAMPLE_LIMIT) return;
  bucket.push(row);
};

const toTopEntries = (map: Map<string, number>, keyName: string, limitCount = 10) =>
  [...map.entries()]
    .sort((left, right) => right[1] - left[1])
    .slice(0, limitCount)
    .map(([key, count]) => ({ [keyName]: key, count }));

const supportPairsFromMatches = (matches: ProductGoalMatch[]) => {
  const pairs: { goalKey: GoalKey; ingredientKey: string }[] = [];
  for (const match of matches) {
    for (const reason of match.reasons) {
      if (reason.code !== "goal_supported_by_ingredient") continue;
      const ingredientKey = typeof reason.params?.ingredientKey === "string" ? reason.params.ingredientKey : null;
      if (!ingredientKey) continue;
      pairs.push({ goalKey: match.goalKey, ingredientKey });
    }
  }
  return pairs;
};

const classifyLane = (params: {
  factsStatus: string;
  reasonCodes: Set<string>;
  supportPairs: { goalKey: GoalKey; ingredientKey: string }[];
  ingredientsMissingAmountCount: number;
}): { lane: RemediationLane; suggestedFix: string } => {
  if (params.factsStatus !== "full") {
    return {
      lane: "parser_partial_facts",
      suggestedFix: "Improve overlay parsing / structured facts extraction until these labels reach full factsStatus.",
    };
  }

  if (params.reasonCodes.has("proprietary_blend_caps_goal_match")) {
    return {
      lane: "proprietary_blend_uncertainty",
      suggestedFix: "Handle proprietary blend labels more gracefully and avoid broad unknown spillover when actives are known but totals are pooled.",
    };
  }

  if (params.reasonCodes.has("dose_not_disclosed") && params.supportPairs.length > 0) {
    return {
      lane: "dose_disclosure_for_supported_ingredient",
      suggestedFix: "Improve amount extraction for matched ingredients so supported goals stop falling into unknown due to missing dose.",
    };
  }

  if (params.supportPairs.length === 0 && params.ingredientsMissingAmountCount > 0) {
    return {
      lane: "broad_unknown_from_any_missing_amount",
      suggestedFix: "Review scorer behavior: unmatched goals should not become unknown solely because any ingredient on the label is missing dose.",
    };
  }

  return {
    lane: "other_unknown",
    suggestedFix: "Manual review needed; this unknown pattern is not explained by the current primary buckets.",
  };
};

const LANE_KEYS: readonly RemediationLane[] = [
  "parser_partial_facts",
  "dose_disclosure_for_supported_ingredient",
  "broad_unknown_from_any_missing_amount",
  "proprietary_blend_uncertainty",
  "other_unknown",
] as const;

const run = async () => {
  await fs.mkdir(outputDir, { recursive: true });

  const overlayProducts = await fetchOverlayCount();
  const laneCounts = new Map<RemediationLane, number>();
  const laneBrandCounts = new Map<RemediationLane, Map<string, number>>();
  const laneZipCounts = new Map<RemediationLane, Map<string, number>>();
  const laneIngredientCounts = new Map<RemediationLane, Map<string, number>>();
  const laneSamples = Object.fromEntries(LANE_KEYS.map((lane) => [lane, []])) as Record<
    RemediationLane,
    QueueRow[]
  >;

  let scanned = 0;
  let unknownProducts = 0;
  let afterId = 0;
  const queueRows: QueueRow[] = [];
  let gatedOutOfScopeNonSupplement = 0;

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
      const allUnknown = fitLevels.every((level) => level === "unknown");
      if (!allUnknown) continue;

      unknownProducts += 1;
      const reasonCodes = new Set(matches.flatMap((match) => match.reasons.map((reason) => reason.code)));
      const supportPairs = supportPairsFromMatches(matches);
      const ingredientsMissingAmountCount = prepared.ingredientInputs.filter((ingredient) => ingredient.amount == null).length;
      const { lane, suggestedFix } = classifyLane({
        factsStatus: prepared.factsStatus,
        reasonCodes,
        supportPairs,
        ingredientsMissingAmountCount,
      });

      const queueRow: QueueRow = {
        remediationLane: lane,
        productId: row.product_id,
        brandName: row.brand_name,
        title: row.title,
        barcode: row.barcode_gtin14,
        sourceZipPath: row.source_zip_path,
        factsStatus: prepared.factsStatus,
        ingredientCount: prepared.overlayIngredients.length,
        ingredientsMissingAmountCount,
        supportGoalKeys: Array.from(new Set(supportPairs.map((pair) => pair.goalKey))),
        supportIngredientKeys: Array.from(new Set(supportPairs.map((pair) => pair.ingredientKey))),
        reasonCodes: Array.from(reasonCodes).sort(),
        suggestedFix,
      };

      queueRows.push(queueRow);
      laneCounts.set(lane, (laneCounts.get(lane) ?? 0) + 1);

      const brandBucket = laneBrandCounts.get(lane) ?? new Map<string, number>();
      increment(brandBucket, row.brand_name);
      laneBrandCounts.set(lane, brandBucket);

      const zipBucket = laneZipCounts.get(lane) ?? new Map<string, number>();
      increment(zipBucket, row.source_zip_path ?? "(missing)");
      laneZipCounts.set(lane, zipBucket);

      const ingredientBucket = laneIngredientCounts.get(lane) ?? new Map<string, number>();
      queueRow.supportIngredientKeys.forEach((ingredientKey) => increment(ingredientBucket, ingredientKey));
      laneIngredientCounts.set(lane, ingredientBucket);

      pushSample(laneSamples[lane], queueRow);
    }

    console.log(`[unknown-remediation-queue] scanned=${scanned} afterId=${afterId}`);
    if ((limit > 0 && scanned >= limit) || batch.length < batchSize) {
      break;
    }
  }

  const laneSummary = Object.fromEntries(
    LANE_KEYS.map((lane) => [
      lane,
      {
        count: laneCounts.get(lane) ?? 0,
        topBrands: toTopEntries(laneBrandCounts.get(lane) ?? new Map(), "brandName", 12),
        topSourceZipPaths: toTopEntries(laneZipCounts.get(lane) ?? new Map(), "sourceZipPath", 12),
        topSupportIngredientKeys: toTopEntries(laneIngredientCounts.get(lane) ?? new Map(), "ingredientKey", 12),
        suggestedFix:
          laneSamples[lane][0]?.suggestedFix ??
          "Manual follow-up needed.",
      } satisfies LaneSummary,
    ]),
  ) as Record<RemediationLane, LaneSummary>;

  const report: QueueReport = {
    generatedAt: new Date().toISOString(),
    projectRef: PROJECT_REF,
    totals: {
      overlayProducts,
      gatedOutOfScopeNonSupplement,
      unknownProducts,
    },
    laneSummary,
    sampleRows: laneSamples,
  };

  const jsonPath = path.join(outputDir, "iherb_unknown_remediation_queue.json");
  const mdPath = path.join(outputDir, "iherb_unknown_remediation_queue.md");
  const jsonlPath = path.join(outputDir, "iherb_unknown_remediation_queue.jsonl");
  await fs.writeFile(jsonPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
  await fs.writeFile(
    jsonlPath,
    `${queueRows.map((row) => JSON.stringify(row)).join("\n")}\n`,
    "utf8",
  );

  const mdLines = [
    "# iHerb Unknown Remediation Queue",
    "",
    `- Generated at: ${report.generatedAt}`,
    `- Overlay rows: ${overlayProducts}`,
    `- Gated out-of-scope non-supplement: ${gatedOutOfScopeNonSupplement}`,
    `- Unknown rows: ${unknownProducts}`,
    "",
    "## Lanes",
    ...LANE_KEYS.flatMap((lane) => [
      `- ${lane}: ${laneSummary[lane].count}`,
      `  fix: ${laneSummary[lane].suggestedFix}`,
    ]),
    "",
  ];
  await fs.writeFile(mdPath, `${mdLines.join("\n")}\n`, "utf8");

  console.log(
    JSON.stringify(
      {
        status: "ok",
        outputDir,
        jsonPath,
        jsonlPath,
        mdPath,
        gatedOutOfScopeNonSupplement,
        unknownProducts,
        laneCounts: Object.fromEntries(LANE_KEYS.map((lane) => [lane, laneSummary[lane].count])),
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
