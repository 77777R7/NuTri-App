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

const SUMMARY_LABELS: Record<string, string> = {
  milk: "dairy",
  egg: "egg",
  fish: "fish",
  shellfish: "shellfish",
  tree_nuts: "tree nuts",
  peanuts: "peanuts",
  wheat: "wheat",
  soy: "soy",
  sesame: "sesame",
  gluten: "gluten",
  gelatin_animal_based: "animal-based gelatin",
};

const summarizePreferenceLabels = (flags: string[], restrictions: string[]): string => {
  const labels = Array.from(
    new Set(
      [...flags, ...restrictions]
        .map((value) => SUMMARY_LABELS[value] ?? value.replace(/_/g, " "))
        .filter(Boolean),
    ),
  );
  if (labels.length === 0) return "allergy";
  if (labels.length === 1) return labels[0] ?? "allergy";
  if (labels.length === 2) return `${labels[0]} and ${labels[1]}`;
  return `${labels.slice(0, 2).join(", ")}, and related restrictions`;
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
      status: "pending",
      reasonCode: "NORMALIZED_PRODUCT_ALLERGY_FLAGS_NOT_ATTACHED",
      summary:
        "Allergy-aware reasoning is reserved here, but normalized product allergen flags are not attached yet.",
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
  const requestedPreferenceSummary = summarizePreferenceLabels(userAllergyFlags, userIngredientRestrictions);
  const matchedPreferenceSummary = summarizePreferenceLabels(matchedAllergyFlags, matchedRestrictions);

  let summary = "No allergy-related flags detected.";
  if (matchedAllergyFlags.length > 0 || matchedRestrictions.length > 0) {
    summary = `May conflict with your ${matchedPreferenceSummary} setting.`;
  } else if ((input.productCoverageStatus ?? "insufficient") === "insufficient") {
    summary = `Needs more label detail to confirm your ${requestedPreferenceSummary} setting.`;
  } else if (userAllergyFlags.length > 0 || userIngredientRestrictions.length > 0) {
    summary = `No ${requestedPreferenceSummary}-related flags were detected from the current product data.`;
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
