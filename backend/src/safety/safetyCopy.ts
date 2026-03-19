import type { DailyDoseBasis, DailyDoseBasisReason, DuplicateIngredientGroup, UlGuidanceEntry } from "./types.js";

export const buildDailyDoseBasisLabel = (basis: DailyDoseBasis): string =>
  basis === "label_daily_estimate" ? "estimated from label directions" : "estimated from 1 serving/day";

export const buildDailyDoseBasisReasonLabel = (reason: DailyDoseBasisReason): string => {
  if (reason === "parsed_label_directions") return "Label directions included a clear daily frequency.";
  if (reason === "missing_directions") return "No label directions were available for a daily estimate.";
  if (reason === "ambiguous_frequency") return "Label directions were present, but daily frequency was ambiguous.";
  if (reason === "snapshot_only_no_directions") return "Cached snapshot data did not include usable label directions.";
  return "Ingredient or dose data was not usable enough for a daily estimate.";
};

export const buildUlGuidanceDisplayLine = (entry: UlGuidanceEntry): string => {
  if (entry.comparisonStatus === "over") {
    return `${entry.ingredientDisplayName}: estimated daily amount ${entry.currentDoseText ?? "dose unavailable"}; adult UL ${entry.ulLimitText ?? "not listed"}; this may exceed the UL.${entry.scopeNote ? ` ${entry.scopeNote}` : ""}`;
  }
  if (entry.comparisonStatus === "near") {
    return `${entry.ingredientDisplayName}: estimated daily amount ${entry.currentDoseText ?? "dose unavailable"}; adult UL ${entry.ulLimitText ?? "not listed"}; this is close to the UL.${entry.scopeNote ? ` ${entry.scopeNote}` : ""}`;
  }
  if (entry.comparisonStatus === "below") {
    return `${entry.ingredientDisplayName}: estimated daily amount ${entry.currentDoseText ?? "dose unavailable"}; adult UL ${entry.ulLimitText ?? "not listed"}; this appears below the UL.${entry.scopeNote ? ` ${entry.scopeNote}` : ""}`;
  }
  if (entry.comparisonStatus === "not_comparable") {
    return `${entry.ingredientDisplayName}: a UL reference exists (${entry.ulLimitText ?? "not listed"}), but this product dose could not be safely compared.${entry.scopeNote ? ` ${entry.scopeNote}` : ""}`;
  }
  return `${entry.ingredientDisplayName}: no NIH ODS upper limit is established for this ingredient.`;
};

export const buildSavedStackHeadline = (group: DuplicateIngredientGroup): string =>
  `You have ${group.productCount} products with ${group.ingredientDisplayName.toLowerCase()}.`;

export const buildSavedStackDetailLines = (group: DuplicateIngredientGroup): string[] => [
  group.estimatedTotalDoseText
    ? `Estimated total: ${group.estimatedTotalDoseText}/day.`
    : "Estimated total dose is still uncertain.",
  group.ulValueText
    ? `Adult supplemental UL: ${group.ulValueText}/day.`
    : "Adult UL reference is not available yet.",
  group.scopeNote ?? "This UL applies to supplemental sources only when noted.",
];

export const buildEstimateBasisSummary = (counts: {
  labelDailyEstimate: number;
  oneServingFallback: number;
}): string | null => {
  if (counts.labelDailyEstimate > 0 && counts.oneServingFallback > 0) {
    return "Dose estimates use label directions when available and 1 serving/day when directions are missing or ambiguous.";
  }
  if (counts.labelDailyEstimate > 0) {
    return "Dose estimates come from parsed label directions.";
  }
  if (counts.oneServingFallback > 0) {
    return "Dose estimates use 1 serving/day when label directions are missing or ambiguous.";
  }
  return null;
};

export const buildHiddenGroupNote = (count: number): string | null =>
  count > 0 ? `${count} additional group${count === 1 ? "" : "s"} stayed out of the primary warning because confidence was lower or UL comparison was not ready.` : null;

export const buildSkippedSavedItemNote = (count: number): string | null =>
  count > 0
    ? `${count} saved item${count === 1 ? "" : "s"} were skipped because ingredient or dose data is incomplete.`
    : null;
