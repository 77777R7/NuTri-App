import { normalizeHumanTextForMatch } from "./textNormalization.js";

type StackOverlapWhitelistKey =
  | "vitamin d"
  | "magnesium"
  | "zinc"
  | "omega-3"
  | "iron"
  | "vitamin c";

const STACK_OVERLAP_WHITELIST = new Set<StackOverlapWhitelistKey>([
  "vitamin d",
  "magnesium",
  "zinc",
  "omega-3",
  "iron",
  "vitamin c",
]);

const DISPLAY_LABELS: Record<StackOverlapWhitelistKey, string> = {
  "vitamin d": "Vitamin D",
  magnesium: "Magnesium",
  zinc: "Zinc",
  "omega-3": "Omega-3",
  iron: "Iron",
  "vitamin c": "Vitamin C",
};

const PRIORITY: Record<StackOverlapWhitelistKey, number> = {
  "omega-3": 0,
  "vitamin d": 1,
  magnesium: 2,
  zinc: 3,
  iron: 4,
  "vitamin c": 5,
};

const normalizeIngredientName = (value: string): string =>
  normalizeHumanTextForMatch(value)
    .replace(/\([^)]*\)/g, " ")
    .replace(/[^a-z0-9+\s-]/g, " ")
    .replace(/\s+/g, " ")
    .trim();

const canonicalizeStackIngredientKey = (rawName: string): StackOverlapWhitelistKey | null => {
  const normalized = normalizeIngredientName(rawName);
  if (!normalized) return null;

  if (
    /\b(epa|eicosapentaenoic|dha|docosahexaenoic|omega\s*[-\s]?3|fish[-\s]+oil|krill)\b/.test(normalized)
  ) {
    return "omega-3";
  }
  if (/\b(cholecalciferol|ergocalciferol|vitamin[-\s]*d3?|calcifediol)\b/.test(normalized)) {
    return "vitamin d";
  }
  if (/\b(ascorbic acid|vitamin[-\s]*c|ester[-\s]?c)\b/.test(normalized)) {
    return "vitamin c";
  }
  if (/\bmagnesium\b/.test(normalized)) return "magnesium";
  if (/\bzinc\b/.test(normalized)) return "zinc";
  if (/\biron\b/.test(normalized)) return "iron";
  return null;
};

export type StackOverlapSupplementInput = {
  supplementId: string;
  productName: string;
  ingredientNames: string[];
};

export type StackOverlapSupplementRef = {
  supplementId: string;
  productName: string;
};

export type StackOverlapItem = {
  ingredientKey: StackOverlapWhitelistKey;
  ingredientDisplay: string;
  count: number;
  supplements: StackOverlapSupplementRef[];
};

export type StackOverlapBuildResult = {
  overlaps: StackOverlapItem[];
  overlapCount: number;
  hiddenOverlapCount: number;
};

export const extractStackOverlapIngredientKeys = (
  ingredientNames: string[],
  maxPerSupplement = 6,
): StackOverlapWhitelistKey[] => {
  const unique = new Set<StackOverlapWhitelistKey>();

  for (const name of ingredientNames) {
    const key = canonicalizeStackIngredientKey(name);
    if (!key || !STACK_OVERLAP_WHITELIST.has(key)) continue;
    unique.add(key);
  }

  return Array.from(unique)
    .sort((a, b) => {
      const priorityDiff = PRIORITY[a] - PRIORITY[b];
      if (priorityDiff !== 0) return priorityDiff;
      return DISPLAY_LABELS[a].localeCompare(DISPLAY_LABELS[b], undefined, { sensitivity: "base" });
    })
    .slice(0, Math.max(1, maxPerSupplement));
};

export const buildStackOverlapResult = (
  supplements: StackOverlapSupplementInput[],
  options?: {
    maxPerSupplement?: number;
    maxOverlaps?: number;
  },
): StackOverlapBuildResult => {
  const maxPerSupplement = Math.max(1, options?.maxPerSupplement ?? 6);
  const maxOverlaps = Math.max(1, options?.maxOverlaps ?? 5);

  const byIngredient = new Map<StackOverlapWhitelistKey, Map<string, string>>();

  for (const supplement of supplements) {
    const supplementId = supplement.supplementId?.trim();
    if (!supplementId) continue;
    const productName = supplement.productName?.trim() || "Unknown supplement";
    const ingredientKeys = extractStackOverlapIngredientKeys(supplement.ingredientNames, maxPerSupplement);
    if (ingredientKeys.length === 0) continue;

    for (const key of ingredientKeys) {
      const existing = byIngredient.get(key) ?? new Map<string, string>();
      existing.set(supplementId, productName);
      byIngredient.set(key, existing);
    }
  }

  const all = Array.from(byIngredient.entries())
    .filter(([, refs]) => refs.size >= 2)
    .map(([key, refs]) => {
      const supplementsList = Array.from(refs.entries())
        .map(([supplementId, productName]) => ({ supplementId, productName }))
        .sort((a, b) => a.productName.localeCompare(b.productName, undefined, { sensitivity: "base" }));
      return {
        ingredientKey: key,
        ingredientDisplay: DISPLAY_LABELS[key],
        count: refs.size,
        supplements: supplementsList,
      } satisfies StackOverlapItem;
    })
    .sort((a, b) => {
      if (b.count !== a.count) return b.count - a.count;
      const priorityDiff = PRIORITY[a.ingredientKey] - PRIORITY[b.ingredientKey];
      if (priorityDiff !== 0) return priorityDiff;
      return a.ingredientDisplay.localeCompare(b.ingredientDisplay, undefined, { sensitivity: "base" });
    });

  const overlaps = all.slice(0, maxOverlaps);

  return {
    overlaps,
    overlapCount: all.length,
    hiddenOverlapCount: Math.max(0, all.length - overlaps.length),
  };
};
