import { normalizeHumanTextForMatch } from "./textNormalization.js";
import { buildSavedStackSummary, type SavedStackSupplementInput } from "./safety/stackAggregation.js";
import type { SavedStackSummary } from "./safety/types.js";

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

export type StackOverlapSupplementIngredientRow = {
  name: string;
  amount: number | null;
  unit: string | null;
  amountText?: string | null;
  chemicalForm?: string | null;
};

export type StackOverlapSupplementInput = {
  supplementId: string;
  productName: string;
  ingredientNames?: string[];
  ingredientRows?: StackOverlapSupplementIngredientRow[];
  dailyMultiplier?: number | null;
  dailyDoseBasis?: "label_daily_estimate" | "one_serving_fallback";
  dailyDoseBasisReason?:
    | "parsed_label_directions"
    | "missing_directions"
    | "ambiguous_frequency"
    | "snapshot_only_no_directions"
    | "insufficient_active_dose";
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

export type StackOverlapBuildResult = SavedStackSummary & {
  overlaps: StackOverlapItem[];
  overlapCount: number;
  hiddenOverlapCount: number;
};

const collectIngredientNames = (supplement: StackOverlapSupplementInput): string[] => {
  const names = Array.isArray(supplement.ingredientNames) ? supplement.ingredientNames : [];
  if (names.length > 0) return names;
  return (supplement.ingredientRows ?? [])
    .map((row) => row.name)
    .filter((name): name is string => typeof name === "string" && name.trim().length > 0);
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
    skippedSupplements?: number;
  },
): StackOverlapBuildResult => {
  const maxPerSupplement = Math.max(1, options?.maxPerSupplement ?? 6);
  const maxOverlaps = Math.max(1, options?.maxOverlaps ?? 5);
  const byIngredient = new Map<StackOverlapWhitelistKey, Map<string, string>>();

  for (const supplement of supplements) {
    const supplementId = supplement.supplementId?.trim();
    if (!supplementId) continue;
    const productName = supplement.productName?.trim() || "Unknown supplement";
    const ingredientKeys = extractStackOverlapIngredientKeys(
      collectIngredientNames(supplement),
      maxPerSupplement,
    );
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
  const safetySupplements: SavedStackSupplementInput[] = supplements
    .filter((supplement) => Array.isArray(supplement.ingredientRows) && supplement.ingredientRows.length > 0)
    .map((supplement) => ({
      supplementId: supplement.supplementId,
      productName: supplement.productName,
      ingredientRows: supplement.ingredientRows ?? [],
      dailyMultiplier: supplement.dailyMultiplier ?? 1,
      dailyDoseBasis: supplement.dailyDoseBasis ?? "one_serving_fallback",
      dailyDoseBasisReason: supplement.dailyDoseBasisReason ?? "missing_directions",
    }));

  const safetySummary = buildSavedStackSummary({
    supplements: safetySupplements,
    skippedSupplements: Math.max(0, supplements.length - safetySupplements.length) + Math.max(0, options?.skippedSupplements ?? 0),
  });

  return {
    overlaps,
    overlapCount: all.length,
    hiddenOverlapCount: Math.max(0, all.length - overlaps.length),
    ...safetySummary,
  };
};
