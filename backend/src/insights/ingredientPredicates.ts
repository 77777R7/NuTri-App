const BLEND_PLACEHOLDER_RE = /\b(proprietary\s+blend|blend|matrix|complex)\b/i;
const FILLER_TOKENS = [
  "microcrystalline cellulose",
  "magnesium stearate",
  "silicon dioxide",
  "silica",
  "titanium dioxide",
  "stearic acid",
  "hypromellose",
  "gelatin",
  "rice flour",
  "maltodextrin",
  "cellulose",
];

const NORMALIZABLE_UNITS = new Set(["mg", "mcg", "ug", "g", "iu", "%dv", "% dv", "cfu", "ml"]);

const normalizeText = (value?: string | null): string =>
  (value ?? "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();

export type IngredientLike = {
  name: string;
  amount: number | null;
  unit: string | null;
  isBlendPlaceholder?: boolean | null;
};

export const isBlendPlaceholder = (ingredientName?: string | null): boolean => {
  const name = normalizeText(ingredientName);
  if (!name) return false;
  return BLEND_PLACEHOLDER_RE.test(name);
};

export const hasUsableDoseNormalization = (unit?: string | null): boolean => {
  const normalized = normalizeText(unit);
  if (!normalized) return false;
  return NORMALIZABLE_UNITS.has(normalized);
};

export const isFiller = (ingredientName?: string | null, unit?: string | null, amount?: number | null): boolean => {
  const name = normalizeText(ingredientName);
  if (!name) return false;
  const matched = FILLER_TOKENS.some((token) => name.includes(token));
  if (!matched) return false;
  if (typeof amount === "number" && amount > 0 && hasUsableDoseNormalization(unit)) {
    return false;
  }
  return true;
};

export const isActiveIngredient = (ingredient: IngredientLike): boolean => {
  if (!ingredient) return false;
  const blend = ingredient.isBlendPlaceholder ?? isBlendPlaceholder(ingredient.name);
  if (blend) return false;
  if (ingredient.amount == null) return false;
  if (!ingredient.unit) return false;
  return hasUsableDoseNormalization(ingredient.unit);
};

export const pickTopIngredients = (ingredients: IngredientLike[], maxCount = 3): string[] => {
  return ingredients
    .filter((item) => !isFiller(item.name, item.unit, item.amount))
    .sort((a, b) => {
      const aActive = isActiveIngredient(a) ? 1 : 0;
      const bActive = isActiveIngredient(b) ? 1 : 0;
      if (aActive !== bActive) return bActive - aActive;
      const aAmount = typeof a.amount === "number" ? a.amount : -1;
      const bAmount = typeof b.amount === "number" ? b.amount : -1;
      if (aAmount !== bAmount) return bAmount - aAmount;
      return a.name.localeCompare(b.name);
    })
    .slice(0, maxCount)
    .map((item) => item.name);
};
