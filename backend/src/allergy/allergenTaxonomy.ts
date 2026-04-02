export const CANONICAL_ALLERGY_FLAGS = [
  "milk",
  "egg",
  "fish",
  "shellfish",
  "tree_nuts",
  "peanuts",
  "wheat",
  "soy",
  "sesame",
] as const;

export type CanonicalAllergyFlag = (typeof CANONICAL_ALLERGY_FLAGS)[number];

export const CANONICAL_INGREDIENT_RESTRICTIONS = [
  "gluten",
  "gelatin_animal_based",
] as const;

export type CanonicalIngredientRestriction =
  (typeof CANONICAL_INGREDIENT_RESTRICTIONS)[number];

export const ALLERGY_FLAG_SET = new Set<string>(CANONICAL_ALLERGY_FLAGS);
export const INGREDIENT_RESTRICTION_SET = new Set<string>(
  CANONICAL_INGREDIENT_RESTRICTIONS,
);
