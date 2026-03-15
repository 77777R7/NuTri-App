import type { FactsDigest } from "../factsDigest.js";
import { buildLabelDirectionsTextFromDigest, deriveDailyDoseBasis } from "./dailyDoseBasis.js";
import { buildUlGuidanceDisplayLine } from "./safetyCopy.js";
import type { ProductSafetySummary, UlGuidanceEntry } from "./types.js";
import { canonicalizeSafetyIngredient } from "./ingredientCanonicalization.js";
import { normalizeDoseForSafety } from "./doseNormalization.js";
import { matchSafetyUl } from "./ulMatching.js";

const rankEntry = (entry: UlGuidanceEntry): number => {
  const tierScore = entry.launchTier === "tier1" ? 0 : 10;
  const statusScore = entry.comparisonStatus === "over"
    ? 0
    : entry.comparisonStatus === "near"
      ? 1
      : entry.comparisonStatus === "below"
        ? 2
        : entry.comparisonStatus === "not_comparable"
          ? 3
          : 4;
  return tierScore + statusScore;
};

export const buildProductSafetySummary = (params: {
  digest: Pick<FactsDigest, "actives" | "labelDosing">;
  maxEntries?: number;
}): ProductSafetySummary => {
  const maxEntries = Math.max(1, params.maxEntries ?? 3);
  const entries: UlGuidanceEntry[] = [];
  const dailyDoseContext = deriveDailyDoseBasis({
    labelDirectionsRawText: buildLabelDirectionsTextFromDigest(params.digest),
    hasUsableActiveDose: (params.digest.actives ?? []).some((active) => active.amount != null && Boolean(active.unit)),
    sourceContext: "facts",
  });

  for (const active of params.digest.actives ?? []) {
    const ingredient = canonicalizeSafetyIngredient({
      rawIngredientText: active.name,
      formHints: [active.chemicalForm, active.chemicalFormEvidence],
    });
    if (!ingredient.ingredientCanonicalKey) continue;
    if (ingredient.launchEnabledForUlCompare === false) continue;

    const dose = normalizeDoseForSafety({
      amount: active.amount,
      unit: active.unit,
      amountText: active.amountText ?? null,
      dailyMultiplier: dailyDoseContext.dailyMultiplier,
      dailyDoseBasis: dailyDoseContext.dailyDoseBasis,
      dailyDoseBasisReason: dailyDoseContext.dailyDoseBasisReason,
    });
    const ulMatch = matchSafetyUl({ ingredient, dose });

    const includeAsSurfaceEntry =
      ingredient.launchTier === "tier1"
        ? true
        : ulMatch.comparisonStatus === "no_ul_established" || ulMatch.comparisonStatus === "not_comparable";
    if (!includeAsSurfaceEntry) continue;

    entries.push({
      ingredientCanonicalKey: ingredient.ingredientCanonicalKey,
      ingredientDisplayName: ulMatch.ingredientDisplayName,
      currentDoseText: ulMatch.currentDoseText,
      ulLimitText: ulMatch.ulValueText,
      comparisonStatus: ulMatch.comparisonStatus,
      scope: ulMatch.scope,
      scopeNote: ulMatch.scopeNote,
      sourceLabel: ulMatch.sourceLabel,
      sourceUrl: ulMatch.sourceUrl,
      reasonCode: ulMatch.reasonCode,
      displayLine: "",
      launchTier: ingredient.launchTier,
    });
  }

  const deduped = Array.from(
    new Map(entries.map((entry) => [entry.ingredientCanonicalKey, entry])).values(),
  )
    .sort((left, right) => rankEntry(left) - rankEntry(right))
    .slice(0, maxEntries)
    .map((entry) => ({ ...entry, displayLine: buildUlGuidanceDisplayLine(entry) }));

  let fallbackReason: ProductSafetySummary["fallbackReason"] = null;
  if (deduped.length === 0) {
    fallbackReason = (params.digest.actives ?? []).length === 0
      ? "INSUFFICIENT_PRODUCT_INGREDIENT_DATA"
      : "NO_WEEK3_WHITELIST_MATCH";
  } else if (deduped.every((entry) => entry.comparisonStatus === "not_comparable")) {
    fallbackReason = "ONLY_NOT_COMPARABLE_ENTRIES";
  } else if (deduped.every((entry) => entry.comparisonStatus === "no_ul_established")) {
    fallbackReason = "NO_UL_ESTABLISHED";
  }

  return {
    ulGuidanceEntries: deduped,
    fallbackReason,
    comparedIngredientCount: deduped.length,
  };
};
