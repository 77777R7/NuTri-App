import {
  buildUlScopeNote,
  classifyUlRisk,
  convertDoseToUlUnit,
  formatDoseText,
  getUlLimitByLifeStage,
  lookupUlByCanonicalKey,
} from "../ods/ulDataset.js";
import type { NormalizedDose, SafetyIngredientMatch, UlMatchResult } from "./types.js";

export const matchSafetyUl = (params: {
  ingredient: SafetyIngredientMatch;
  dose: NormalizedDose;
}): UlMatchResult => {
  const { ingredient, dose } = params;

  if (!ingredient.ingredientCanonicalKey) {
    return {
      ulMatched: false,
      ingredientCanonicalKey: null,
      ingredientDisplayName: ingredient.ingredientDisplayName,
      comparisonStatus: "no_ul_established",
      ulValue: null,
      ulUnit: null,
      ulValueText: null,
      currentDoseValue: dose.dailyEstimatedDoseValue,
      currentDoseUnit: dose.dailyEstimatedDoseUnit,
      currentDoseText: dose.dailyEstimatedDoseText,
      scope: null,
      scopeNote: null,
      lifeStage: "adult_19_plus",
      source: "UNKNOWN",
      sourceLabel: null,
      sourceUrl: null,
      comparisonRatio: null,
      reasonCode: "UNMATCHED_INGREDIENT",
      notes: [],
    };
  }

  const ulItem = lookupUlByCanonicalKey(ingredient.ingredientCanonicalKey, [
    ingredient.ingredientCanonicalKey,
    ingredient.rawIngredientText,
  ]);
  const adultLimit = ulItem ? getUlLimitByLifeStage(ulItem, "adult_19_plus") : null;
  if (!ulItem || !adultLimit) {
    return {
      ulMatched: false,
      ingredientCanonicalKey: ingredient.ingredientCanonicalKey,
      ingredientDisplayName: ingredient.ingredientDisplayName,
      comparisonStatus: "no_ul_established",
      ulValue: null,
      ulUnit: null,
      ulValueText: null,
      currentDoseValue: dose.dailyEstimatedDoseValue,
      currentDoseUnit: dose.dailyEstimatedDoseUnit,
      currentDoseText: dose.dailyEstimatedDoseText,
      scope: null,
      scopeNote: null,
      lifeStage: "adult_19_plus",
      source: "UNKNOWN",
      sourceLabel: null,
      sourceUrl: null,
      comparisonRatio: null,
      reasonCode: ingredient.launchEnabledForUlCompare ? "NO_UL_ESTABLISHED" : "UNLISTED_INGREDIENT",
      notes: [],
    };
  }

  const scopeNote = buildUlScopeNote({
    scope: ulItem.scope,
    canonicalKey: ulItem.ingredientCanonicalKey,
  });
  if (!dose.comparableToUl || dose.dailyEstimatedDoseValue == null || !dose.dailyEstimatedDoseUnit) {
    return {
      ulMatched: true,
      ingredientCanonicalKey: ingredient.ingredientCanonicalKey,
      ingredientDisplayName: ingredient.ingredientDisplayName,
      comparisonStatus: "not_comparable",
      ulValue: adultLimit.value,
      ulUnit: adultLimit.unit,
      ulValueText: formatDoseText(adultLimit.value, adultLimit.unit),
      currentDoseValue: dose.dailyEstimatedDoseValue,
      currentDoseUnit: dose.dailyEstimatedDoseUnit,
      currentDoseText: dose.dailyEstimatedDoseText,
      scope: ulItem.scope,
      scopeNote,
      lifeStage: "adult_19_plus",
      source: "NIH_ODS_UL",
      sourceLabel: "NIH ODS (Health Professional Fact Sheet)",
      sourceUrl: ulItem.sourceUrl,
      comparisonRatio: null,
      reasonCode: "DOSE_NOT_COMPARABLE",
      notes: ulItem.notes ?? [],
    };
  }

  const converted = convertDoseToUlUnit({
    amount: dose.dailyEstimatedDoseValue,
    fromUnit: dose.dailyEstimatedDoseUnit,
    targetUnit: adultLimit.unit,
    altUnits: ulItem.altUnits,
  });
  if (!converted.ok || converted.value == null || !converted.unit) {
    return {
      ulMatched: true,
      ingredientCanonicalKey: ingredient.ingredientCanonicalKey,
      ingredientDisplayName: ingredient.ingredientDisplayName,
      comparisonStatus: "not_comparable",
      ulValue: adultLimit.value,
      ulUnit: adultLimit.unit,
      ulValueText: formatDoseText(adultLimit.value, adultLimit.unit),
      currentDoseValue: dose.dailyEstimatedDoseValue,
      currentDoseUnit: dose.dailyEstimatedDoseUnit,
      currentDoseText: dose.dailyEstimatedDoseText,
      scope: ulItem.scope,
      scopeNote,
      lifeStage: "adult_19_plus",
      source: "NIH_ODS_UL",
      sourceLabel: "NIH ODS (Health Professional Fact Sheet)",
      sourceUrl: ulItem.sourceUrl,
      comparisonRatio: null,
      reasonCode: "DOSE_NOT_COMPARABLE",
      notes: ulItem.notes ?? [],
    };
  }

  const ratio = adultLimit.value > 0 ? converted.value / adultLimit.value : null;
  const riskBand = ratio == null ? "low" : classifyUlRisk(ratio);
  const comparisonStatus = riskBand === "high" || riskBand === "moderate"
    ? "over"
    : ratio != null && ratio >= 0.8
      ? "near"
      : "below";

  return {
    ulMatched: true,
    ingredientCanonicalKey: ingredient.ingredientCanonicalKey,
    ingredientDisplayName: ingredient.ingredientDisplayName,
    comparisonStatus,
    ulValue: adultLimit.value,
    ulUnit: adultLimit.unit,
    ulValueText: formatDoseText(adultLimit.value, adultLimit.unit),
    currentDoseValue: converted.value,
    currentDoseUnit: converted.unit,
    currentDoseText: formatDoseText(converted.value, converted.unit),
    scope: ulItem.scope,
    scopeNote,
    lifeStage: "adult_19_plus",
    source: "NIH_ODS_UL",
    sourceLabel: "NIH ODS (Health Professional Fact Sheet)",
    sourceUrl: ulItem.sourceUrl,
    comparisonRatio: ratio,
    reasonCode: "ODS_UL_MATCHED",
    notes: ulItem.notes ?? [],
  };
};
