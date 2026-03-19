import type { DuplicateIngredientContribution, DuplicateIngredientGroup, SavedStackSummary } from "./types.js";
import {
  buildDailyDoseBasisLabel,
  buildEstimateBasisSummary,
  buildHiddenGroupNote,
  buildSavedStackDetailLines,
  buildSavedStackHeadline,
  buildSkippedSavedItemNote,
} from "./safetyCopy.js";
import { canonicalizeSafetyIngredient } from "./ingredientCanonicalization.js";
import { normalizeDoseForSafety } from "./doseNormalization.js";
import { matchSafetyUl } from "./ulMatching.js";

export type SavedStackSupplementInput = {
  supplementId: string;
  productName: string;
  ingredientRows: Array<{
    name: string;
    amount: number | null;
    unit: string | null;
    amountText?: string | null;
    chemicalForm?: string | null;
  }>;
  dailyMultiplier?: number | null;
  dailyDoseBasis?: "label_daily_estimate" | "one_serving_fallback";
  dailyDoseBasisReason?:
    | "parsed_label_directions"
    | "missing_directions"
    | "ambiguous_frequency"
    | "snapshot_only_no_directions"
    | "insufficient_active_dose";
};

const groupPriority = (group: DuplicateIngredientGroup): number => {
  if (group.status === "over") return 0;
  if (group.status === "near") return 1;
  if (group.status === "below") return 2;
  return 3;
};

export const buildSavedStackSummary = (params: {
  supplements: SavedStackSupplementInput[];
  skippedSupplements: number;
}): SavedStackSummary => {
  const contributionsByIngredient = new Map<string, DuplicateIngredientContribution[]>();
  const ulMetaByIngredient = new Map<
    string,
    Pick<DuplicateIngredientGroup, "ulValue" | "ulUnit" | "ulValueText" | "scope" | "scopeNote" | "launchTier">
  >();
  const dailyDoseBasisCounts = {
    labelDailyEstimate: 0,
    oneServingFallback: 0,
  };
  const dailyDoseBasisReasonCounts = new Map<
    NonNullable<SavedStackSupplementInput["dailyDoseBasisReason"]>,
    number
  >();

  for (const supplement of params.supplements) {
    if ((supplement.dailyDoseBasis ?? "one_serving_fallback") === "label_daily_estimate") {
      dailyDoseBasisCounts.labelDailyEstimate += 1;
    } else {
      dailyDoseBasisCounts.oneServingFallback += 1;
    }
    const basisReason = supplement.dailyDoseBasisReason ?? "missing_directions";
    dailyDoseBasisReasonCounts.set(basisReason, (dailyDoseBasisReasonCounts.get(basisReason) ?? 0) + 1);

    for (const row of supplement.ingredientRows) {
      const ingredient = canonicalizeSafetyIngredient({
        rawIngredientText: row.name,
        formHints: [row.chemicalForm],
      });
      if (!ingredient.ingredientCanonicalKey) continue;

      const dose = normalizeDoseForSafety({
        amount: row.amount,
        unit: row.unit,
        amountText: row.amountText ?? null,
        dailyMultiplier: supplement.dailyMultiplier ?? 1,
        dailyDoseBasis: supplement.dailyDoseBasis ?? "one_serving_fallback",
        dailyDoseBasisReason: supplement.dailyDoseBasisReason ?? "missing_directions",
      });
      const ulMatch = matchSafetyUl({ ingredient, dose });
      const contribution: DuplicateIngredientContribution = {
        supplementId: supplement.supplementId,
        productName: supplement.productName,
        ingredientCanonicalKey: ingredient.ingredientCanonicalKey,
        ingredientDisplayName: ingredient.ingredientDisplayName,
        rawDoseText: dose.rawDoseText,
        dailyEstimatedDoseText: ulMatch.currentDoseText ?? dose.dailyEstimatedDoseText,
        dailyEstimatedDoseValue: ulMatch.currentDoseValue ?? dose.dailyEstimatedDoseValue,
        dailyEstimatedDoseUnit: ulMatch.currentDoseUnit ?? dose.dailyEstimatedDoseUnit,
        dailyDoseBasis: dose.dailyDoseBasis,
        dailyDoseBasisReason: dose.dailyDoseBasisReason,
        dailyDoseBasisLabel: buildDailyDoseBasisLabel(dose.dailyDoseBasis),
        comparisonStatus: ulMatch.comparisonStatus,
        comparableToUl: ulMatch.comparisonStatus !== "not_comparable" && ulMatch.comparisonStatus !== "no_ul_established",
      };
      const existing = contributionsByIngredient.get(ingredient.ingredientCanonicalKey) ?? [];
      existing.push(contribution);
      contributionsByIngredient.set(ingredient.ingredientCanonicalKey, existing);

      if (!ulMetaByIngredient.has(ingredient.ingredientCanonicalKey)) {
        ulMetaByIngredient.set(ingredient.ingredientCanonicalKey, {
          ulValue: ulMatch.ulValue,
          ulUnit: ulMatch.ulUnit,
          ulValueText: ulMatch.ulValueText,
          scope: ulMatch.scope,
          scopeNote: ulMatch.scopeNote,
          launchTier: ingredient.launchTier,
        });
      }
    }
  }

  const groups = Array.from(contributionsByIngredient.entries())
    .filter(([, contributions]) => contributions.length >= 2)
    .map(([ingredientKey, contributions]) => {
      const first = contributions[0];
      const ulMeta = ulMetaByIngredient.get(ingredientKey);
      const comparableContributions = contributions.filter(
        (item) => item.comparableToUl && item.dailyEstimatedDoseValue != null && item.dailyEstimatedDoseUnit === ulMeta?.ulUnit,
      );
      const estimatedTotalDoseValue = comparableContributions.reduce(
        (sum, item) => sum + (item.dailyEstimatedDoseValue ?? 0),
        0,
      );
      const estimatedTotalDoseText =
        estimatedTotalDoseValue > 0 && ulMeta?.ulUnit ? `${Math.round(estimatedTotalDoseValue * 100) / 100} ${ulMeta.ulUnit}` : null;

      let status: DuplicateIngredientGroup["status"] = "not_comparable";
      if (ulMeta?.ulValue && estimatedTotalDoseValue > 0) {
        if (estimatedTotalDoseValue >= ulMeta.ulValue) status = "over";
        else if (estimatedTotalDoseValue >= ulMeta.ulValue * 0.8) status = "near";
        else status = "below";
      } else if (ulMeta?.ulValueText) {
        status = "not_comparable";
      } else {
        status = "no_ul_established";
      }

      const surfaced =
        (ulMeta?.launchTier ?? "unlisted") === "tier1" &&
        comparableContributions.length >= 2 &&
        Boolean(ulMeta?.ulValueText) &&
        status !== "not_comparable" &&
        status !== "no_ul_established";

      return {
        ingredientCanonicalKey: ingredientKey,
        ingredientDisplayName: first.ingredientDisplayName,
        productCount: contributions.length,
        products: contributions.sort((left, right) => left.productName.localeCompare(right.productName)),
        estimatedTotalDoseValue: estimatedTotalDoseValue || null,
        estimatedTotalDoseUnit: ulMeta?.ulUnit ?? null,
        estimatedTotalDoseText,
        ulValue: ulMeta?.ulValue ?? null,
        ulUnit: ulMeta?.ulUnit ?? null,
        ulValueText: ulMeta?.ulValueText ?? null,
        scope: ulMeta?.scope ?? null,
        scopeNote: ulMeta?.scopeNote ?? null,
        status,
        confidence: surfaced ? "high" : comparableContributions.length >= 2 ? "medium" : "low",
        surfaced,
        launchTier: ulMeta?.launchTier ?? "unlisted",
      } satisfies DuplicateIngredientGroup;
    })
    .sort(
      (left, right) =>
        groupPriority(left) - groupPriority(right) ||
        right.productCount - left.productCount ||
        left.ingredientDisplayName.localeCompare(right.ingredientDisplayName),
    );

  const surfacedGroups = groups.filter((group) => group.surfaced);
  const primary = surfacedGroups[0] ?? null;

  return {
    stackLevelSummary: primary
      ? {
          headline: buildSavedStackHeadline(primary),
          detailLines: buildSavedStackDetailLines(primary),
          status: primary.status,
        }
      : {
          headline: null,
          detailLines: [],
          status: null,
        },
    duplicateGroups: groups,
    meta: {
      processedSupplements: params.supplements.length,
      skippedSupplements: params.skippedSupplements,
      surfacedGroupCount: surfacedGroups.length,
      hiddenGroupCount: Math.max(0, groups.length - surfacedGroups.length),
      supportedLifeStage: "adult_19_plus",
      dailyDoseBasisCounts,
      dailyDoseBasisReasonCounts: Object.fromEntries(dailyDoseBasisReasonCounts),
      estimateBasisSummary: buildEstimateBasisSummary(dailyDoseBasisCounts),
      hiddenGroupNote: buildHiddenGroupNote(Math.max(0, groups.length - surfacedGroups.length)),
      skippedSupplementNote: buildSkippedSavedItemNote(params.skippedSupplements),
    },
  };
};
