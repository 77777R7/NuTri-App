const NUTRITION_LABEL_LIKE_PREFIXES = [
  "calorie",
  "calories",
  "total fat",
  "saturated fat",
  "trans fat",
  "cholesterol",
  "sodium",
  "total carbohydrate",
  "dietary fiber",
  "dietary fibre",
  "total sugar",
  "total sugars",
  "added sugar",
  "added sugars",
  "protein",
];

const normalizeNutritionLabelLikeNameKey = (value: string): string =>
  value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();

const isNutritionLabelLikeNameKey = (nameKey?: string | null): boolean => {
  if (typeof nameKey !== "string") return false;
  const normalized = normalizeNutritionLabelLikeNameKey(nameKey);
  if (!normalized) return false;
  return NUTRITION_LABEL_LIKE_PREFIXES.some((prefix) =>
    normalized === prefix || normalized.startsWith(`${prefix} `),
  );
};

const isNutritionLabelLikeIngredientName = (name?: string | null): boolean =>
  isNutritionLabelLikeNameKey(name ?? "");

export {
  NUTRITION_LABEL_LIKE_PREFIXES,
  normalizeNutritionLabelLikeNameKey,
  isNutritionLabelLikeNameKey,
  isNutritionLabelLikeIngredientName,
};
