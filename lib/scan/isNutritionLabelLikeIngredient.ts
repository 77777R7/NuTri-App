const NON_ACTIVE_NUTRITION_NAME_PATTERNS: RegExp[] = [
  /^calories?\b/,
  /^total\s+fat\b/,
  /^saturated\s+fat\b/,
  /^trans\s+fat\b/,
  /^cholesterol\b/,
  /^sodium\b/,
  /^total\s+carbohydrate\b/,
  /^dietary\s+fib(?:er|re)\b/,
  /^total\s+sugars?\b/,
  /^added\s+sugars?\b/,
  /^protein\b/,
];

const normalizeIngredientNameKey = (value: string): string =>
  value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();

export const isNutritionLabelLikeIngredient = (name?: string | null): boolean => {
  if (typeof name !== 'string') return false;
  const normalized = normalizeIngredientNameKey(name);
  if (!normalized) return false;
  return NON_ACTIVE_NUTRITION_NAME_PATTERNS.some((pattern) => pattern.test(normalized));
};
