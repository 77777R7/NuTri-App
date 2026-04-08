#!/usr/bin/env -S node --import tsx

import fs from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { execFileSync } from "node:child_process";

import { createClient } from "@supabase/supabase-js";

import { normalizeIherbSupplementFactsRowsWithTitleFallback } from "../../backend/src/iherbOverlayIngredients.ts";
import { extractFromIherbOverlay } from "../../backend/src/allergy/extractFromIherbOverlay.ts";
import { prepareCatalogProduct } from "../../lib/personalization/core/catalogProductEvaluation.ts";
import {
  mapNarrativeLabelCompleteness,
  normalizeGoalNarrativeFitLevel,
  scoreProductGoalMatches,
  type GoalNarrativeFitLevel,
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

type AllergenFlagRow = {
  source_id: string;
  allergy_flags: string[];
  ingredient_restrictions: string[];
  coverage_status: "resolved" | "partial" | "insufficient";
};

type SampleRow = {
  productId: string;
  title: string;
  brandName: string;
  barcode: string | null;
  sourceZipPath: string | null;
  factsStatus?: string;
  dominantGoal?: GoalKey | null;
  dominantLevel?: GoalNarrativeFitLevel | null;
  notes?: string[];
};

type GoalFitCounts = Record<GoalNarrativeFitLevel, number>;

type AuditReport = {
  generatedAt: string;
  projectRef: string;
  sourceTable: "iherb_overlay_products";
  totals: {
    overlayProducts: number;
    overlayProductsWithBarcode: number;
    overlayProductsWithSourceZipPath: number;
    distinctSourceZipPaths: number;
    allergenRows: number;
  };
  iherbCorpus: {
    likelyFullCorpusLoaded: boolean;
    rationale: string[];
    topSourceZipPaths: { sourceZipPath: string; count: number }[];
  };
  allergyAudit: {
    rowCoverageMatchRate: number;
    storedCoverageStatus: Record<string, number>;
    recomputedCoverageStatus: Record<string, number>;
    productsWithAnyAllergyFlag: number;
    productsWithAnyIngredientRestriction: number;
    storedVsComputed: {
      exactMatch: number;
      mismatch: number;
      missingStoredRow: number;
      extraStoredRow: number;
    };
    topAllergyFlags: { flag: string; count: number }[];
    topIngredientRestrictions: { flag: string; count: number }[];
    samples: {
      mismatch: SampleRow[];
      insufficientCoverage: SampleRow[];
    };
  };
  goalAudit: {
    factsStatus: Record<string, number>;
    gatedOutOfScopeNonSupplement: number;
    coverageReadyProducts: number;
    productsWithAnyPositiveLane: number;
    productsWithAnyStrongOrSome: number;
    productsLimitedOnly: number;
    productsAllNone: number;
    productsAllUnknown: number;
    dominantGoalCounts: Record<string, number>;
    byGoal: Record<string, GoalFitCounts>;
    samples: {
      gatedOutOfScopeNonSupplement: SampleRow[];
      strongExamples: SampleRow[];
      noPositiveLane: SampleRow[];
      unknownHeavy: SampleRow[];
    };
  };
};

const ROOT_DIR = process.cwd();
const OUTPUT_DIR = path.join(
  ROOT_DIR,
  "output",
  "maintainer-gates",
  `${new Date().toISOString().replace(/[:.]/g, "-")}_iherb_goal_allergy_audit`,
);

const getArg = (flag: string): string | null => {
  const args = process.argv.slice(2);
  const index = args.indexOf(`--${flag}`);
  if (index === -1) return null;
  return args[index + 1] ?? null;
};

const batchSize = Math.max(100, Number(getArg("batch") ?? "500"));
const limit = Math.max(0, Number(getArg("limit") ?? "0"));
const allergenFetchBatchSize = Math.max(500, batchSize);
const outputDir = getArg("out-dir")
  ? path.resolve(getArg("out-dir") as string)
  : OUTPUT_DIR;

const PROJECT_REF = "dlwlobgmjzcmpirwvetq";
const SUPABASE_URL = `https://${PROJECT_REF}.supabase.co`;
const SAMPLE_LIMIT = 20;

const goalKeys = listActiveGoalCatalogEntries().map((goal) => goal.goalKey);

const createEmptyGoalCounts = (): GoalFitCounts => ({
  strong: 0,
  some: 0,
  limited: 0,
  none: 0,
  unknown: 0,
});

const increment = (map: Map<string, number>, key: string, delta = 1) => {
  map.set(key, (map.get(key) ?? 0) + delta);
};

const pushSample = (bucket: SampleRow[], row: SampleRow) => {
  if (bucket.length >= SAMPLE_LIMIT) return;
  bucket.push(row);
};

const stableArray = (value: string[] | null | undefined): string[] =>
  Array.from(new Set((Array.isArray(value) ? value : []).map((entry) => String(entry).trim()).filter(Boolean))).sort();

const arraysEqual = (left: string[], right: string[]): boolean =>
  left.length === right.length && left.every((entry, index) => entry === right[index]);

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

const fetchOverlayBatch = async (afterId: number): Promise<OverlayRow[]> => {
  let query = supabase
    .from("iherb_overlay_products")
    .select(
      "id,product_id,barcode_gtin14,brand_name,title,source_zip_path,supplement_facts,description_sections",
    )
    .order("id", { ascending: true })
    .limit(batchSize);

  if (afterId > 0) {
    query = query.gt("id", afterId);
  }

  const { data, error } = await query;
  if (error) throw new Error(`Failed to read iherb_overlay_products: ${error.message}`);
  return (data ?? []) as OverlayRow[];
};

const fetchAllergenRowMap = async (): Promise<Map<string, AllergenFlagRow>> => {
  const result = new Map<string, AllergenFlagRow>();
  let from = 0;

  while (true) {
    const to = from + allergenFetchBatchSize - 1;
    const { data, error } = await supabase
      .from("product_allergen_flags")
      .select("source_id,allergy_flags,ingredient_restrictions,coverage_status")
      .eq("source", "iherb_overlay")
      .order("source_id", { ascending: true })
      .range(from, to);

    if (error) throw new Error(`Failed to read product_allergen_flags: ${error.message}`);
    const rows = (data ?? []) as AllergenFlagRow[];
    if (rows.length === 0) break;
    rows.forEach((row) => {
      result.set(String(row.source_id), row);
    });
    from += rows.length;
  }

  return result;
};

const fetchExactCount = async (
  table: string,
  filters?: (query: ReturnType<typeof supabase.from>) => ReturnType<typeof supabase.from>,
) => {
  let query = supabase.from(table).select("*", { head: true, count: "exact" });
  if (filters) {
    query = filters(query);
  }
  const { count, error } = await query;
  if (error) throw new Error(`Failed count for ${table}: ${error.message}`);
  return count ?? 0;
};

const pickDominantGoal = (
  matches: ProductGoalMatch[],
  fitLevels: Map<GoalKey, GoalNarrativeFitLevel>,
): { goalKey: GoalKey | null; fitLevel: GoalNarrativeFitLevel | null } => {
  const ranked = [...matches].sort((left, right) => right.score - left.score);
  for (const match of ranked) {
    const fitLevel = fitLevels.get(match.goalKey) ?? "none";
    if (fitLevel === "strong" || fitLevel === "some" || fitLevel === "limited") {
      return { goalKey: match.goalKey, fitLevel };
    }
  }
  return { goalKey: null, fitLevel: null };
};

const toPercent = (value: number, total: number): number =>
  total > 0 ? Number(((value / total) * 100).toFixed(2)) : 0;

const topEntries = (map: Map<string, number>, limitCount = 10, keyName = "key") =>
  [...map.entries()]
    .sort((left, right) => right[1] - left[1])
    .slice(0, limitCount)
    .map(([key, count]) => ({ [keyName]: key, count }));

const buildMarkdown = (report: AuditReport): string => {
  const lines: string[] = [];
  lines.push("# iHerb Goal + Allergy Audit");
  lines.push("");
  lines.push(`- Generated at: ${report.generatedAt}`);
  lines.push(`- Project ref: ${report.projectRef}`);
  lines.push(`- Overlay rows: ${report.totals.overlayProducts}`);
  lines.push(`- Distinct source zip paths: ${report.totals.distinctSourceZipPaths}`);
  lines.push(`- Allergy rows: ${report.totals.allergenRows}`);
  lines.push("");
  lines.push("## Corpus");
  lines.push(`- Likely full corpus loaded: ${report.iherbCorpus.likelyFullCorpusLoaded ? "yes" : "uncertain"}`);
  report.iherbCorpus.rationale.forEach((item) => lines.push(`- ${item}`));
  lines.push("");
  lines.push("## Allergy");
  lines.push(`- Stored vs computed exact match: ${report.allergyAudit.storedVsComputed.exactMatch}`);
  lines.push(`- Stored vs computed mismatch: ${report.allergyAudit.storedVsComputed.mismatch}`);
  lines.push(`- Products with any allergy flag: ${report.allergyAudit.productsWithAnyAllergyFlag}`);
  lines.push(`- Products with any ingredient restriction: ${report.allergyAudit.productsWithAnyIngredientRestriction}`);
  lines.push("");
  lines.push("## Goal");
  lines.push(`- Gated out-of-scope non-supplement: ${report.goalAudit.gatedOutOfScopeNonSupplement}`);
  lines.push(`- Coverage-ready products: ${report.goalAudit.coverageReadyProducts}`);
  lines.push(`- Products with any positive lane: ${report.goalAudit.productsWithAnyPositiveLane}`);
  lines.push(`- Products with any strong/some lane: ${report.goalAudit.productsWithAnyStrongOrSome}`);
  lines.push(`- Products limited-only: ${report.goalAudit.productsLimitedOnly}`);
  lines.push(`- Products all none: ${report.goalAudit.productsAllNone}`);
  lines.push(`- Products all unknown: ${report.goalAudit.productsAllUnknown}`);
  lines.push("");
  lines.push("## Top source zip paths");
  report.iherbCorpus.topSourceZipPaths.slice(0, 10).forEach((row) => {
    lines.push(`- ${row.sourceZipPath}: ${row.count}`);
  });
  return `${lines.join("\n")}\n`;
};

const run = async () => {
  await fs.mkdir(outputDir, { recursive: true });

  const allergenRowMap = await fetchAllergenRowMap();

  const totalOverlayProducts = await fetchExactCount("iherb_overlay_products");
  const overlayProductsWithBarcode = await fetchExactCount("iherb_overlay_products", (query) =>
    query.not("barcode_gtin14", "is", null),
  );
  const overlayProductsWithSourceZipPath = await fetchExactCount("iherb_overlay_products", (query) =>
    query.not("source_zip_path", "is", null),
  );

  const storedCoverageStatus = new Map<string, number>();
  const recomputedCoverageStatus = new Map<string, number>();
  const allergyFlagCounts = new Map<string, number>();
  const restrictionCounts = new Map<string, number>();
  const sourceZipCounts = new Map<string, number>();
  const dominantGoalCounts = new Map<string, number>();
  const goalCounts = Object.fromEntries(
    goalKeys.map((goalKey) => [goalKey, createEmptyGoalCounts()]),
  ) as Record<string, GoalFitCounts>;
  const factsStatusCounts = new Map<string, number>();

  const mismatchSamples: SampleRow[] = [];
  const allergyInsufficientSamples: SampleRow[] = [];
  const strongExamples: SampleRow[] = [];
  const noPositiveLaneSamples: SampleRow[] = [];
  const unknownHeavySamples: SampleRow[] = [];
  const gatedOutOfScopeSamples: SampleRow[] = [];

  let scannedProducts = 0;
  let afterId = 0;
  let exactAllergenMatches = 0;
  let allergenMismatches = 0;
  let missingStoredAllergenRows = 0;
  let productsWithAnyAllergyFlag = 0;
  let productsWithAnyIngredientRestriction = 0;
  let gatedOutOfScopeNonSupplement = 0;
  let coverageReadyProducts = 0;
  let productsWithAnyPositiveLane = 0;
  let productsWithAnyStrongOrSome = 0;
  let productsLimitedOnly = 0;
  let productsAllNone = 0;
  let productsAllUnknown = 0;

  while (true) {
    const batch = await fetchOverlayBatch(afterId);
    if (batch.length === 0) break;

    for (const row of batch) {
      if (limit > 0 && scannedProducts >= limit) break;

      scannedProducts += 1;
      afterId = row.id;
      increment(sourceZipCounts, row.source_zip_path ?? "(missing)");

      const storedAllergen = allergenRowMap.get(row.product_id) ?? null;
      if (storedAllergen) {
        increment(storedCoverageStatus, storedAllergen.coverage_status);
      } else {
        missingStoredAllergenRows += 1;
      }

      const recomputedAllergen = extractFromIherbOverlay({
        productId: row.product_id,
        canonicalSourceId: row.barcode_gtin14,
        supplementFacts: row.supplement_facts,
        descriptionSections: row.description_sections,
      });

      increment(recomputedCoverageStatus, recomputedAllergen.coverageStatus);

      const computedFlags = stableArray(recomputedAllergen.allergyFlags);
      const computedRestrictions = stableArray(recomputedAllergen.ingredientRestrictions);
      const storedFlags = stableArray(storedAllergen?.allergy_flags);
      const storedRestrictions = stableArray(storedAllergen?.ingredient_restrictions);
      const storedCoverage = storedAllergen?.coverage_status ?? null;

      if (computedFlags.length > 0) {
        productsWithAnyAllergyFlag += 1;
        computedFlags.forEach((flag) => increment(allergyFlagCounts, flag));
      }
      if (computedRestrictions.length > 0) {
        productsWithAnyIngredientRestriction += 1;
        computedRestrictions.forEach((flag) => increment(restrictionCounts, flag));
      }

      const allergenExact =
        Boolean(storedAllergen) &&
        arraysEqual(storedFlags, computedFlags) &&
        arraysEqual(storedRestrictions, computedRestrictions) &&
        storedCoverage === recomputedAllergen.coverageStatus;
      if (allergenExact) {
        exactAllergenMatches += 1;
      } else if (storedAllergen) {
        allergenMismatches += 1;
        pushSample(mismatchSamples, {
          productId: row.product_id,
          title: row.title,
          brandName: row.brand_name,
          barcode: row.barcode_gtin14,
          sourceZipPath: row.source_zip_path,
          notes: [
            `storedCoverage=${storedCoverage ?? "missing"} computedCoverage=${recomputedAllergen.coverageStatus}`,
            `storedFlags=${storedFlags.join(",") || "none"} computedFlags=${computedFlags.join(",") || "none"}`,
            `storedRestrictions=${storedRestrictions.join(",") || "none"} computedRestrictions=${computedRestrictions.join(",") || "none"}`,
          ],
        });
      }

      if (recomputedAllergen.coverageStatus !== "resolved") {
        pushSample(allergyInsufficientSamples, {
          productId: row.product_id,
          title: row.title,
          brandName: row.brand_name,
          barcode: row.barcode_gtin14,
          sourceZipPath: row.source_zip_path,
          notes: [`coverage=${recomputedAllergen.coverageStatus}`],
        });
      }

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

      const preparedProduct = prepareCatalogProduct({
        productId: row.product_id,
        sourceProductId: row.product_id,
        barcode: row.barcode_gtin14,
        title: row.title,
        brandName: row.brand_name,
        sourceZipPath: row.source_zip_path,
        ingredients,
      });

      increment(factsStatusCounts, preparedProduct.factsStatus);

      if (preparedProduct.goalScoringBlockedReason === "out_of_scope_non_supplement") {
        gatedOutOfScopeNonSupplement += 1;
        pushSample(gatedOutOfScopeSamples, {
          productId: row.product_id,
          title: row.title,
          brandName: row.brand_name,
          barcode: row.barcode_gtin14,
          sourceZipPath: row.source_zip_path,
          factsStatus: preparedProduct.factsStatus,
          notes: ["goal_scoring_blocked=out_of_scope_non_supplement"],
        });
        continue;
      }

      const coverageStatus =
        preparedProduct.factsStatus === "full" ? "coverage_ready" : "not_enough_structured_data";
      if (coverageStatus === "coverage_ready") {
        coverageReadyProducts += 1;
      }

      const matches = scoreProductGoalMatches({
        goals: goalKeys,
        ingredients: preparedProduct.ingredientInputs,
        disclosureQuality: "high",
        proprietaryBlendWithoutClearActives: false,
      });

      const fitLevels = new Map<GoalKey, GoalNarrativeFitLevel>();
      for (const match of matches) {
        const fitLevel = normalizeGoalNarrativeFitLevel({
          tier: match.tier,
          reasonCodes: match.reasons.map((reason) => reason.code),
          coverageStatus,
          labelCompleteness: mapNarrativeLabelCompleteness(match.confidence.disclosure),
        });
        fitLevels.set(match.goalKey, fitLevel);
        goalCounts[match.goalKey][fitLevel] += 1;
      }

      const levels = [...fitLevels.values()];
      const hasStrongOrSome = levels.some((level) => level === "strong" || level === "some");
      const hasLimited = levels.some((level) => level === "limited");
      const hasPositive = hasStrongOrSome || hasLimited;
      const allNone = levels.every((level) => level === "none");
      const allUnknown = levels.every((level) => level === "unknown");

      if (hasPositive) productsWithAnyPositiveLane += 1;
      if (hasStrongOrSome) productsWithAnyStrongOrSome += 1;
      if (!hasStrongOrSome && hasLimited) productsLimitedOnly += 1;
      if (allNone) productsAllNone += 1;
      if (allUnknown) productsAllUnknown += 1;

      const dominant = pickDominantGoal(matches, fitLevels);
      if (dominant.goalKey) {
        increment(dominantGoalCounts, dominant.goalKey);
      }

      if (dominant.fitLevel === "strong" || dominant.fitLevel === "some") {
        pushSample(strongExamples, {
          productId: row.product_id,
          title: row.title,
          brandName: row.brand_name,
          barcode: row.barcode_gtin14,
          sourceZipPath: row.source_zip_path,
          factsStatus: preparedProduct.factsStatus,
          dominantGoal: dominant.goalKey,
          dominantLevel: dominant.fitLevel,
        });
      }

      if (!hasPositive) {
        pushSample(noPositiveLaneSamples, {
          productId: row.product_id,
          title: row.title,
          brandName: row.brand_name,
          barcode: row.barcode_gtin14,
          sourceZipPath: row.source_zip_path,
          factsStatus: preparedProduct.factsStatus,
          dominantGoal: dominant.goalKey,
          dominantLevel: dominant.fitLevel,
        });
      }

      if (allUnknown) {
        pushSample(unknownHeavySamples, {
          productId: row.product_id,
          title: row.title,
          brandName: row.brand_name,
          barcode: row.barcode_gtin14,
          sourceZipPath: row.source_zip_path,
          factsStatus: preparedProduct.factsStatus,
          notes: [`ingredientCount=${preparedProduct.overlayIngredients.length}`],
        });
      }
    }

    console.log(
      `[iherb-audit] scanned=${scannedProducts} afterId=${afterId} sourceZipSeen=${sourceZipCounts.size}`,
    );

    if ((limit > 0 && scannedProducts >= limit) || batch.length < batchSize) {
      break;
    }
  }

  const distinctSourceZipPaths = sourceZipCounts.size - (sourceZipCounts.has("(missing)") ? 1 : 0);
  const report: AuditReport = {
    generatedAt: new Date().toISOString(),
    projectRef: PROJECT_REF,
    sourceTable: "iherb_overlay_products",
    totals: {
      overlayProducts: totalOverlayProducts,
      overlayProductsWithBarcode,
      overlayProductsWithSourceZipPath,
      distinctSourceZipPaths,
      allergenRows: allergenRowMap.size,
    },
    iherbCorpus: {
      likelyFullCorpusLoaded:
        totalOverlayProducts >= 30000 &&
        overlayProductsWithSourceZipPath >= totalOverlayProducts - 5 &&
        distinctSourceZipPaths >= 100,
      rationale: [
        `${totalOverlayProducts} iHerb overlay rows are present in live Supabase.`,
        `${overlayProductsWithSourceZipPath} rows have source_zip_path populated.`,
        `${distinctSourceZipPaths} distinct source_zip_path values were observed across the corpus.`,
      ],
      topSourceZipPaths: topEntries(sourceZipCounts, 15, "sourceZipPath"),
    },
    allergyAudit: {
      rowCoverageMatchRate: toPercent(exactAllergenMatches, totalOverlayProducts),
      storedCoverageStatus: Object.fromEntries([...storedCoverageStatus.entries()].sort()),
      recomputedCoverageStatus: Object.fromEntries([...recomputedCoverageStatus.entries()].sort()),
      productsWithAnyAllergyFlag,
      productsWithAnyIngredientRestriction,
      storedVsComputed: {
        exactMatch: exactAllergenMatches,
        mismatch: allergenMismatches,
        missingStoredRow: missingStoredAllergenRows,
        extraStoredRow: Math.max(0, allergenRowMap.size - totalOverlayProducts),
      },
      topAllergyFlags: topEntries(allergyFlagCounts, 10, "flag"),
      topIngredientRestrictions: topEntries(restrictionCounts, 10, "flag"),
      samples: {
        mismatch: mismatchSamples,
        insufficientCoverage: allergyInsufficientSamples,
      },
    },
    goalAudit: {
      factsStatus: Object.fromEntries([...factsStatusCounts.entries()].sort()),
      gatedOutOfScopeNonSupplement,
      coverageReadyProducts,
      productsWithAnyPositiveLane,
      productsWithAnyStrongOrSome,
      productsLimitedOnly,
      productsAllNone,
      productsAllUnknown,
      dominantGoalCounts: Object.fromEntries([...dominantGoalCounts.entries()].sort()),
      byGoal: goalCounts,
      samples: {
        gatedOutOfScopeNonSupplement: gatedOutOfScopeSamples,
        strongExamples,
        noPositiveLane: noPositiveLaneSamples,
        unknownHeavy: unknownHeavySamples,
      },
    },
  };

  const jsonPath = path.join(outputDir, "iherb_goal_allergy_audit.json");
  const mdPath = path.join(outputDir, "iherb_goal_allergy_audit.md");
  await fs.writeFile(jsonPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
  await fs.writeFile(mdPath, buildMarkdown(report), "utf8");

  console.log(
    JSON.stringify(
      {
        status: "ok",
        outputDir,
        jsonPath,
        mdPath,
        overlayProducts: report.totals.overlayProducts,
        allergenRows: report.totals.allergenRows,
        gatedOutOfScopeNonSupplement: report.goalAudit.gatedOutOfScopeNonSupplement,
        coverageReadyProducts: report.goalAudit.coverageReadyProducts,
        productsWithAnyPositiveLane: report.goalAudit.productsWithAnyPositiveLane,
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
