import type {
  BlockerKey,
  EligibilityDecision,
  ExperienceLevel,
  GoalKey,
  GoalNavigatorCandidate,
  GoalFitCard,
  ProductGoalMatch,
  ProductGoalMatchTier,
  SavedProductEvaluation,
  SavedProductEvaluationInput,
  SavedProductFactsStatus,
  SupplementTypeKey,
} from "../../../types/personalization";

import * as eligibilityPolicyModule from "./eligibilityPolicy.ts";
import * as goalMatchScoringModule from "./goalMatchScoring.ts";
import type { ProductIngredientLikeInput } from "./goalMatchScoring.ts";
import * as goalFitCardBuilderModule from "./goalFitCardBuilder.ts";
import * as savedProductEvaluationModule from "./savedProductEvaluation.ts";

export type CatalogOverlayIngredientRow = {
  name: string;
  dose: string | null;
  form?: string | null;
};

export type CatalogProductEvaluationInput = {
  productId: string;
  goalKey: GoalKey;
  preferredTypes?: SupplementTypeKey[] | null;
  sourceProductId?: string | null;
  barcode?: string | null;
  externalUrl?: string | null;
  title?: string | null;
  brandName?: string | null;
  dosageText?: string | null;
  imageUrl?: string | null;
  description?: string | null;
  suggestedUse?: string | null;
  ingredients?: CatalogOverlayIngredientRow[] | null;
  duplicateRisk?: {
    level?: "none" | "medium" | "high" | null;
    ingredientKeys?: string[] | null;
  } | null;
  supplementExperience?: ExperienceLevel | null;
  ageRange?: string | null;
  adherenceBlocker?: BlockerKey | null;
};

export type CatalogPreparedProductInput = Omit<
  CatalogProductEvaluationInput,
  "goalKey" | "preferredTypes" | "duplicateRisk" | "supplementExperience" | "ageRange" | "adherenceBlocker"
>;

export type CatalogPreparedProduct = {
  productId: string;
  sourceProductId?: string | null;
  barcode?: string | null;
  externalUrl?: string | null;
  title?: string;
  brandName?: string;
  dosageText?: string;
  imageUrl?: string;
  description?: string | null;
  suggestedUse?: string | null;
  factsStatus: SavedProductFactsStatus;
  overlayIngredients: CatalogOverlayIngredientRow[];
  typeKeys: SupplementTypeKey[];
  ingredientInputs: ProductIngredientLikeInput[];
  savedProductSeed: SavedProductEvaluationInput;
};

export type CatalogPreparedProductEvaluationInput = {
  preparedProduct: CatalogPreparedProduct;
  goalKey: GoalKey;
  preferredTypes?: SupplementTypeKey[] | null;
  duplicateRisk?: CatalogProductEvaluationInput["duplicateRisk"];
  supplementExperience?: ExperienceLevel | null;
  ageRange?: string | null;
  adherenceBlocker?: BlockerKey | null;
};

export type CatalogProductEvaluationResult = {
  coverageStatus: "coverage_ready" | "not_enough_structured_data";
  savedProductEvaluation: SavedProductEvaluation;
  goalFitCard: GoalFitCard | null;
  candidate?: GoalNavigatorCandidate;
};

const evaluateEligibilityPolicy =
  eligibilityPolicyModule.evaluateEligibilityPolicy ??
  eligibilityPolicyModule.default?.evaluateEligibilityPolicy;
const scoreProductGoalMatches =
  goalMatchScoringModule.scoreProductGoalMatches ??
  goalMatchScoringModule.default?.scoreProductGoalMatches;
const buildGoalFitCard =
  goalFitCardBuilderModule.buildGoalFitCard ??
  goalFitCardBuilderModule.default?.buildGoalFitCard;
const evaluateSavedProducts =
  savedProductEvaluationModule.evaluateSavedProducts ??
  savedProductEvaluationModule.default?.evaluateSavedProducts;

if (typeof evaluateEligibilityPolicy !== "function") {
  throw new Error("[catalogProductEvaluation] Failed to load evaluateEligibilityPolicy");
}
if (typeof scoreProductGoalMatches !== "function") {
  throw new Error("[catalogProductEvaluation] Failed to load scoreProductGoalMatches");
}
if (typeof buildGoalFitCard !== "function") {
  throw new Error("[catalogProductEvaluation] Failed to load buildGoalFitCard");
}
if (typeof evaluateSavedProducts !== "function") {
  throw new Error("[catalogProductEvaluation] Failed to load evaluateSavedProducts");
}

const PROPRIETARY_BLEND_PATTERN = /\b(blend|complex|matrix|formula)\b/i;

const normalizeParsedUnit = (value: string): string | null => {
  const normalized = value.trim().toLowerCase();
  if (!normalized) return null;
  if (normalized === "μg" || normalized === "µg" || normalized === "ug") return "mcg";
  if (normalized === "iu" || normalized === "ui") return "iu";
  if (normalized === "cfu") return "cfu";
  if (normalized === "spu") return "spu";
  if (normalized === "ml" || normalized === "milliliter" || normalized === "milliliters") return "ml";
  if (normalized === "mg" || normalized === "g" || normalized === "mcg") return normalized;
  return null;
};

const parseAmountText = (value?: string | null): { amount: number | null; unit: string | null } => {
  const trimmed = value?.trim();
  if (!trimmed) return { amount: null, unit: null };

  const cfuScaledMatch = trimmed.match(/(-?\d[\d,]*(?:\.\d+)?)\s*(billion|million)\s*cfu\b/i);
  if (cfuScaledMatch) {
    const amount = Number.parseFloat(cfuScaledMatch[1].replace(/,/g, ""));
    if (!Number.isFinite(amount)) {
      return { amount: null, unit: null };
    }
    const scale = cfuScaledMatch[2]?.toLowerCase();
    return {
      amount: scale === "billion" ? amount * 1e9 : amount * 1e6,
      unit: "cfu",
    };
  }

  const match = trimmed.match(/(-?\d[\d,]*(?:\.\d+)?)\s*(mcg|μg|µg|ug|mg|g|iu|ui|cfu|spu|ml)\b/i);
  if (!match) return { amount: null, unit: null };

  const amount = Number.parseFloat(match[1].replace(/,/g, ""));
  const unit = normalizeParsedUnit(match[2]);
  if (!Number.isFinite(amount) || !unit) {
    return { amount: null, unit: null };
  }

  return { amount, unit };
};

const pickFirstText = (...values: (string | null | undefined)[]) => {
  for (const value of values) {
    if (typeof value === "string" && value.trim().length > 0) {
      return value.trim();
    }
  }

  return undefined;
};

const normalizeDisplayValue = (value?: string | null) => {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
};

const deriveTypeKeysFromContent = (input: {
  title?: string | null;
  brandName?: string | null;
  description?: string | null;
  suggestedUse?: string | null;
  ingredients: CatalogOverlayIngredientRow[];
}): SupplementTypeKey[] => {
  const haystack = [
    input.title,
    input.brandName,
    input.description,
    input.suggestedUse,
    ...input.ingredients.map((ingredient) => ingredient.name),
  ]
    .filter((value): value is string => typeof value === "string" && value.trim().length > 0)
    .join(" ")
    .toLowerCase();

  const next = new Set<SupplementTypeKey>();

  if (/\b(probiotic|lactobacillus|bifidobacter|saccharomyces|prebiotic|cfu)\b/.test(haystack)) {
    next.add("probiotic");
  }
  if (/\b(protein|whey|casein|isolate|collagen|amino acid|bcaa|eaa)\b/.test(haystack)) {
    next.add("protein");
  }
  if (
    /\b(vitamin|ascorbic|cholecalciferol|ergocalciferol|tocopherol|retinol|folate|folic acid|cobalamin|niacin|thiamin|riboflavin|biotin|pantothenic)\b/.test(
      haystack,
    )
  ) {
    next.add("vitamin");
  }
  if (
    /\b(magnesium|zinc|calcium|iron|selenium|copper|chromium|potassium|iodine|manganese|electrolyte)\b/.test(
      haystack,
    )
  ) {
    next.add("mineral");
  }
  if (
    /\b(ashwagandha|rhodiola|turmeric|elderberry|bacopa|ginseng|garlic|maca|valerian|mushroom|lion'?s mane|reishi|cordyceps|botanical|herbal?)\b/.test(
      haystack,
    )
  ) {
    next.add("herb");
  }

  return Array.from(next);
};

const buildIngredientInputs = (
  rows: CatalogOverlayIngredientRow[],
): ProductIngredientLikeInput[] => {
  const next: ProductIngredientLikeInput[] = [];

  for (const row of rows) {
    const name = row.name?.trim();
    if (!name) continue;
    const parsedDose = parseAmountText(row.dose);
    next.push({
      ingredientLabel: name,
      name,
      amount: parsedDose.amount,
      unit: parsedDose.unit,
      form: row.form ?? null,
      formLabel: row.form ?? null,
      disclosureQuality: parsedDose.amount != null ? "medium" : "low",
      proprietaryBlend: PROPRIETARY_BLEND_PATTERN.test(name),
    });
  }

  return next;
};

const deriveFactsStatus = (ingredients: ProductIngredientLikeInput[]): SavedProductFactsStatus => {
  if (ingredients.length === 0) return "none";
  const hasStructuredDose = ingredients.some(
    (ingredient) =>
      typeof ingredient.amount === "number" &&
      ingredient.amount > 0 &&
      typeof ingredient.unit === "string" &&
      ingredient.unit.length > 0 &&
      ingredient.proprietaryBlend !== true,
  );
  return hasStructuredDose ? "full" : "partial";
};

export const prepareCatalogProduct = (input: CatalogPreparedProductInput): CatalogPreparedProduct => {
  const overlayIngredients = (input.ingredients ?? []).filter(
    (ingredient): ingredient is CatalogOverlayIngredientRow =>
      typeof ingredient?.name === "string" && ingredient.name.trim().length > 0,
  );
  const ingredientInputs = buildIngredientInputs(overlayIngredients);
  const factsStatus = deriveFactsStatus(ingredientInputs);
  const typeKeys = deriveTypeKeysFromContent({
    title: input.title,
    brandName: input.brandName,
    description: input.description,
    suggestedUse: input.suggestedUse,
    ingredients: overlayIngredients,
  });

  const dosageText =
    pickFirstText(
      input.dosageText,
      overlayIngredients.find((ingredient) => ingredient.dose?.trim())?.dose,
    ) ?? "";

  return {
    productId: input.productId,
    sourceProductId: input.sourceProductId ?? null,
    barcode: input.barcode ?? null,
    externalUrl: input.externalUrl ?? null,
    title: normalizeDisplayValue(input.title),
    brandName: normalizeDisplayValue(input.brandName),
    dosageText: normalizeDisplayValue(dosageText),
    imageUrl: normalizeDisplayValue(input.imageUrl),
    description: input.description ?? null,
    suggestedUse: input.suggestedUse ?? null,
    factsStatus,
    overlayIngredients,
    typeKeys,
    ingredientInputs,
    savedProductSeed: {
      productId: input.productId,
      factsStatus,
      ...(typeKeys.length > 0 ? { typeKeys } : {}),
      display: {
        ...(normalizeDisplayValue(input.title) ? { title: normalizeDisplayValue(input.title) } : {}),
        ...(normalizeDisplayValue(input.brandName)
          ? { brandName: normalizeDisplayValue(input.brandName) }
          : {}),
        ...(normalizeDisplayValue(dosageText) ? { dosageText: normalizeDisplayValue(dosageText) } : {}),
        ...(normalizeDisplayValue(input.imageUrl) ? { imageUrl: normalizeDisplayValue(input.imageUrl) } : {}),
      },
    },
  };
};

const buildSavedProductInput = (input: {
  preparedProduct: CatalogPreparedProduct;
  goalKey: GoalKey;
  duplicateRisk?: CatalogProductEvaluationInput["duplicateRisk"];
  supplementExperience?: ExperienceLevel | null;
  ageRange?: string | null;
  adherenceBlocker?: BlockerKey | null;
}): {
  savedProduct: SavedProductEvaluationInput;
  factsStatus: SavedProductFactsStatus;
  typeKeys: SupplementTypeKey[];
  productGoalMatches: ProductGoalMatch[];
  eligibility?: EligibilityDecision;
} => {
  const { preparedProduct } = input;
  const ingredientInputs = preparedProduct.ingredientInputs;
  const factsStatus = preparedProduct.factsStatus;
  const typeKeys = preparedProduct.typeKeys;

  const productGoalMatches =
    factsStatus === "full"
      ? scoreProductGoalMatches({
          goals: [input.goalKey],
          ingredients: ingredientInputs,
          disclosureQuality: "high",
          proprietaryBlendWithoutClearActives: false,
        })
      : [];

  const requiresGenericSafetyPath = productGoalMatches.some((match) =>
    (match.caps ?? []).includes("generic_safety_path"),
  );

  const eligibility =
    factsStatus === "full"
      ? evaluateEligibilityPolicy({
          productGoalMatches,
          duplicateRisk: input.duplicateRisk,
          supplementExperience: input.supplementExperience ?? null,
          ageRange: input.ageRange ?? null,
          adherenceBlocker: input.adherenceBlocker ?? null,
          hasDietConstraintConflict: false,
          requiresGenericSafetyPath,
        })
      : undefined;

  return {
    savedProduct: {
      ...preparedProduct.savedProductSeed,
      ...(productGoalMatches.length > 0 ? { productGoalMatches } : {}),
      ...(eligibility ? { eligibility } : {}),
    },
    factsStatus,
    typeKeys,
    productGoalMatches,
    ...(eligibility ? { eligibility } : {}),
  };
};

const getGoalMatch = (evaluation: SavedProductEvaluation, goalKey: GoalKey): ProductGoalMatch | undefined =>
  evaluation.productGoalMatches.find((match) => match.goalKey === goalKey);

const toTierPriority = (tier: ProductGoalMatchTier) => {
  switch (tier) {
    case "strong_match":
      return 4;
    case "related":
      return 3;
    case "weak_match":
      return 2;
    default:
      return 1;
  }
};

export const evaluateCatalogProduct = (
  input: CatalogProductEvaluationInput,
): CatalogProductEvaluationResult => {
  const preparedProduct = prepareCatalogProduct(input);
  return evaluatePreparedCatalogProduct({
    preparedProduct,
    goalKey: input.goalKey,
    preferredTypes: input.preferredTypes,
    duplicateRisk: input.duplicateRisk,
    supplementExperience: input.supplementExperience ?? null,
    ageRange: input.ageRange ?? null,
    adherenceBlocker: input.adherenceBlocker ?? null,
  });
};

export const evaluatePreparedCatalogProduct = (
  input: CatalogPreparedProductEvaluationInput,
): CatalogProductEvaluationResult => {
  const { savedProduct, factsStatus, typeKeys } = buildSavedProductInput({
    preparedProduct: input.preparedProduct,
    goalKey: input.goalKey,
    duplicateRisk: input.duplicateRisk,
    supplementExperience: input.supplementExperience ?? null,
    ageRange: input.ageRange ?? null,
    adherenceBlocker: input.adherenceBlocker ?? null,
  });

  const evaluationSet = evaluateSavedProducts({
    prioritizedGoals: [input.goalKey],
    savedProducts: {
      [input.preparedProduct.productId]: savedProduct,
    },
  });

  const savedProductEvaluation = evaluationSet.savedProductEvaluations[input.preparedProduct.productId];
  const goalFitCard = buildGoalFitCard({
    evaluation: savedProductEvaluation,
    goalKey: input.goalKey,
  });

  const goalMatch = getGoalMatch(savedProductEvaluation, input.goalKey);
  const preferredTypeMatch =
    (input.preferredTypes ?? []).length > 0 &&
    typeKeys.some((typeKey) => (input.preferredTypes ?? []).includes(typeKey));

  const candidate =
    savedProductEvaluation.coverage.status === "coverage_ready" && goalFitCard
      ? ({
          productId: input.preparedProduct.productId,
          goalKey: input.goalKey,
          tier: goalFitCard.tier,
          score: goalMatch?.score ?? 0,
          typeKeys,
          preferredTypeMatch,
          ...(input.preparedProduct.sourceProductId
            ? { sourceProductId: input.preparedProduct.sourceProductId }
            : {}),
          ...(input.preparedProduct.barcode ? { barcode: input.preparedProduct.barcode } : {}),
          ...(input.preparedProduct.externalUrl ? { externalUrl: input.preparedProduct.externalUrl } : {}),
          evaluation: savedProductEvaluation,
          goalFitCard,
        } satisfies GoalNavigatorCandidate)
      : undefined;

  return {
    coverageStatus: factsStatus === "full" ? "coverage_ready" : "not_enough_structured_data",
    savedProductEvaluation,
    goalFitCard,
    ...(candidate ? { candidate } : {}),
  };
};

export const catalogProductEvaluationInternals = {
  buildIngredientInputs,
  buildSavedProductInput,
  deriveFactsStatus,
  deriveTypeKeysFromContent,
  evaluatePreparedCatalogProduct,
  normalizeParsedUnit,
  parseAmountText,
  prepareCatalogProduct,
  toTierPriority,
};
