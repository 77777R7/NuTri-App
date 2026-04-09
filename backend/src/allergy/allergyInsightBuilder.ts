import type { DecisionSupportPersonalizedAllergyInsight } from "../decisionSupport.js";
import type { ProductAllergenCoverageStatus } from "./allergenNormalization.js";

export type AllergyInsightDetail = {
  flag: string;
  source: "active_ingredient" | "inactive_ingredient" | "label_disclosure" | "warning";
  matchedText?: string | null;
  confidence: "high" | "medium" | "low";
};

export type AllergyInsightBuilderInput = {
  userAllergyFlags?: string[] | null;
  userIngredientRestrictions?: string[] | null;
  productAllergyFlags?: string[] | null;
  productIngredientRestrictions?: string[] | null;
  productCoverageStatus?: ProductAllergenCoverageStatus | null;
  productDetails?: AllergyInsightDetail[] | null;
};

const intersect = <T extends string>(left: T[], right: T[]): T[] => {
  const rightSet = new Set(right);
  return left.filter((value) => rightSet.has(value));
};

export const buildAllergyInsight = (
  input: AllergyInsightBuilderInput,
): DecisionSupportPersonalizedAllergyInsight => {
  const userAllergyFlags = input.userAllergyFlags ?? [];
  const userIngredientRestrictions = input.userIngredientRestrictions ?? [];

  if (userAllergyFlags.length === 0 && userIngredientRestrictions.length === 0) {
    return {
      status: "ready",
      reasonCode: null,
      summary: "No allergy or restriction settings saved yet.",
      matchedAllergyFlags: [],
      matchedRestrictions: [],
      details: [],
    };
  }

  if (
    !input.productAllergyFlags &&
    !input.productIngredientRestrictions &&
    !input.productCoverageStatus
  ) {
    return {
      status: "unavailable",
      reasonCode: "NORMALIZED_PRODUCT_ALLERGY_FLAGS_NOT_ATTACHED",
      summary:
        "Allergy check is unavailable for this scan because normalized product allergen flags are not attached.",
      matchedAllergyFlags: [],
      matchedRestrictions: [],
      details: [],
    };
  }

  const matchedAllergyFlags = intersect(
    userAllergyFlags,
    input.productAllergyFlags ?? [],
  );
  const matchedRestrictions = intersect(
    userIngredientRestrictions,
    input.productIngredientRestrictions ?? [],
  );
  const matchedFlags = new Set<string>([
    ...matchedAllergyFlags,
    ...matchedRestrictions,
  ]);
  const details = (input.productDetails ?? []).filter((detail) =>
    matchedFlags.has(detail.flag),
  );

  let summary = "No allergy-related flags detected.";
  if (matchedAllergyFlags.length > 0 || matchedRestrictions.length > 0) {
    summary = "May conflict with your allergy settings.";
  } else if ((input.productCoverageStatus ?? "insufficient") === "insufficient") {
    summary = "Needs more label detail to confirm.";
  }

  return {
    status: "ready",
    reasonCode: null,
    summary,
    matchedAllergyFlags,
    matchedRestrictions,
    details,
  };
};

export const allergyInsightBuilderInternals = {
  intersect,
};
