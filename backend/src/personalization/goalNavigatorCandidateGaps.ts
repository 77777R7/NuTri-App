import type { CatalogOverlayIngredientRow, CatalogPreparedProduct } from "../../../lib/personalization/core/catalogProductEvaluation.ts";

export type PersonalizationCandidateGapCode =
  | "missing_dose"
  | "missing_unit"
  | "unresolved_ingredient"
  | "low_disclosure"
  | "proprietary_blend"
  | "no_structured_ingredients";

export type GoalNavigatorCandidateGapRecord = {
  productId: string;
  sourceProductId: string | null;
  title: string | null;
  brandName: string | null;
  factsStatus: CatalogPreparedProduct["factsStatus"];
  gapCodes: PersonalizationCandidateGapCode[];
  details: Record<string, unknown>;
};

const DOSE_NUMBER_PATTERN = /-?\d[\d,]*(?:\.\d+)?/;
const DOSE_UNIT_PATTERN = /\b(mcg|mg|g)\b/i;
const BLEND_PATTERN = /\b(blend|complex|matrix|formula|proprietary|booster|support)\b/i;

const isDoseMissing = (dose: string | null | undefined) =>
  typeof dose !== "string" || dose.trim().length === 0;

const hasDoseNumberWithoutSupportedUnit = (dose: string | null | undefined) => {
  if (typeof dose !== "string") return false;
  const trimmed = dose.trim();
  if (!trimmed) return false;
  return DOSE_NUMBER_PATTERN.test(trimmed) && !DOSE_UNIT_PATTERN.test(trimmed);
};

const isPotentiallyUnresolvedIngredient = (ingredient: CatalogOverlayIngredientRow) =>
  BLEND_PATTERN.test(ingredient.name);

const getBlendLabels = (ingredients: CatalogOverlayIngredientRow[]) =>
  ingredients
    .map((ingredient) => ingredient.name?.trim())
    .filter((value): value is string => Boolean(value) && BLEND_PATTERN.test(value))
    .slice(0, 5);

export const buildGoalNavigatorCandidateGapRecord = (
  preparedProduct: CatalogPreparedProduct,
): GoalNavigatorCandidateGapRecord | null => {
  if (preparedProduct.factsStatus === "full") {
    return null;
  }

  const ingredients = preparedProduct.overlayIngredients ?? [];
  const gapCodes = new Set<PersonalizationCandidateGapCode>();

  if (ingredients.length === 0) {
    gapCodes.add("no_structured_ingredients");
    gapCodes.add("low_disclosure");
  }

  const missingDoseCount = ingredients.filter((ingredient) => isDoseMissing(ingredient.dose)).length;
  const missingUnitCount = ingredients.filter((ingredient) =>
    hasDoseNumberWithoutSupportedUnit(ingredient.dose),
  ).length;
  const unresolvedIngredientCount = ingredients.filter(isPotentiallyUnresolvedIngredient).length;

  if (missingDoseCount > 0) {
    gapCodes.add("missing_dose");
  }
  if (missingUnitCount > 0) {
    gapCodes.add("missing_unit");
  }
  if (unresolvedIngredientCount > 0) {
    gapCodes.add("unresolved_ingredient");
  }
  if (
    unresolvedIngredientCount > 0 &&
    ingredients.some((ingredient) => isDoseMissing(ingredient.dose))
  ) {
    gapCodes.add("proprietary_blend");
  }
  gapCodes.add("low_disclosure");

  return {
    productId: preparedProduct.productId,
    sourceProductId: preparedProduct.sourceProductId ?? null,
    title: preparedProduct.title ?? null,
    brandName: preparedProduct.brandName ?? null,
    factsStatus: preparedProduct.factsStatus,
    gapCodes: Array.from(gapCodes),
    details: {
      ingredientCount: ingredients.length,
      parsedIngredientCount: preparedProduct.ingredientInputs.length,
      missingDoseCount,
      missingUnitCount,
      unresolvedIngredientCount,
      blendLabels: getBlendLabels(ingredients),
      sampleIngredientLabels: ingredients
        .map((ingredient) => ingredient.name?.trim())
        .filter((value): value is string => Boolean(value))
        .slice(0, 5),
    },
  };
};

export const goalNavigatorCandidateGapInternals = {
  hasDoseNumberWithoutSupportedUnit,
  isDoseMissing,
  isPotentiallyUnresolvedIngredient,
};
