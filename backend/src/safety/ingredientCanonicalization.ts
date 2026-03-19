import { lookupUlByCanonicalKey, normalizeOdsCanonicalKey } from "../ods/ulDataset.js";
import { normalizeHumanTextForMatch } from "../textNormalization.js";
import type { SafetyIngredientMatch } from "./types.js";
import { getWeek3WhitelistEntry, WEEK3_SAFETY_WHITELIST } from "./week3Whitelist.js";

const normalizeIngredientMatchText = (value: string | null | undefined): string =>
  normalizeHumanTextForMatch(String(value ?? ""))
    .replace(/\([^)]*\)/g, " ")
    .replace(/[^a-z0-9+\s-]/g, " ")
    .replace(/\s+/g, " ")
    .trim();

const buildDisplayName = (value: string | null | undefined, fallback: string | null): string => {
  const normalized = String(value ?? "").trim();
  if (normalized) return normalized;
  return fallback ?? "Unknown ingredient";
};

const matchWhitelistByText = (normalizedText: string) => {
  if (!normalizedText) return null;
  return WEEK3_SAFETY_WHITELIST.find((entry) =>
    entry.aliases.some((alias) => normalizedText.includes(normalizeIngredientMatchText(alias))),
  ) ?? null;
};

export const canonicalizeSafetyIngredient = (params: {
  rawIngredientText: string | null | undefined;
  nameKey?: string | null | undefined;
  formHints?: Array<string | null | undefined>;
}): SafetyIngredientMatch => {
  const rawIngredientText = String(params.rawIngredientText ?? "").trim();
  const normalizedText = normalizeIngredientMatchText(rawIngredientText);
  const normalizedNameKey = normalizeOdsCanonicalKey(params.nameKey);
  const chemicalFormText =
    (params.formHints ?? []).map((item) => String(item ?? "").trim()).find(Boolean) ?? null;

  const whitelistFromNameKey = getWeek3WhitelistEntry(normalizedNameKey);
  if (whitelistFromNameKey) {
    return {
      rawIngredientText,
      ingredientCanonicalKey: whitelistFromNameKey.canonicalKey,
      ingredientDisplayName: whitelistFromNameKey.displayName,
      canonicalParentKey: whitelistFromNameKey.canonicalKey,
      matchSource: "name_key",
      matchConfidence: 0.98,
      launchTier: whitelistFromNameKey.launchTier,
      launchEnabledForUlCompare: whitelistFromNameKey.launchEnabledForUlCompare,
      chemicalFormText,
    };
  }

  const whitelistFromText = matchWhitelistByText(normalizedText);
  if (whitelistFromText) {
    return {
      rawIngredientText,
      ingredientCanonicalKey: whitelistFromText.canonicalKey,
      ingredientDisplayName: whitelistFromText.displayName,
      canonicalParentKey: whitelistFromText.canonicalKey,
      matchSource: "week3_whitelist",
      matchConfidence: 0.95,
      launchTier: whitelistFromText.launchTier,
      launchEnabledForUlCompare: whitelistFromText.launchEnabledForUlCompare,
      chemicalFormText,
    };
  }

  const ulItem = lookupUlByCanonicalKey(normalizedNameKey ?? rawIngredientText, [rawIngredientText, normalizedNameKey]);
  if (ulItem) {
    const whitelistFromUl = getWeek3WhitelistEntry(ulItem.ingredientCanonicalKey);
    return {
      rawIngredientText,
      ingredientCanonicalKey: ulItem.ingredientCanonicalKey,
      ingredientDisplayName: whitelistFromUl?.displayName ?? buildDisplayName(ulItem.displayName, rawIngredientText || null),
      canonicalParentKey: ulItem.ingredientCanonicalKey,
      matchSource: "ods_alias",
      matchConfidence: 0.85,
      launchTier: whitelistFromUl?.launchTier ?? "unlisted",
      launchEnabledForUlCompare: whitelistFromUl?.launchEnabledForUlCompare ?? false,
      chemicalFormText,
    };
  }

  return {
    rawIngredientText,
    ingredientCanonicalKey: null,
    ingredientDisplayName: buildDisplayName(rawIngredientText, null),
    canonicalParentKey: null,
    matchSource: "none",
    matchConfidence: 0,
    launchTier: "unlisted",
    launchEnabledForUlCompare: false,
    chemicalFormText,
  };
};
