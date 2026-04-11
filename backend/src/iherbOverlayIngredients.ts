import type { FactsDigest } from "./factsDigest.js";
import { isNutritionLabelLikeIngredientName } from "./scoring/nutritionLabelLikeLexicon.js";

export type ScienceIngredientRow = {
  name: string;
  dose: string | null;
  proprietaryBlendSource?: boolean;
  aggregateFormula?: boolean;
};

type OverlayNutritionalFactRow = {
  substancy?: string | null;
  amountPerServing?: string | null;
  dailyValuePercent?: string | null;
};

type OverlayClaimsLike = {
  nutritionalFacts?: OverlayNutritionalFactRow[] | null;
} | null | undefined;

type TitleFallbackParams = {
  title?: string | null;
  brandName?: string | null;
  servingSize?: string | null;
  servingsPerContainer?: string | null;
  sourceZipPath?: string | null;
  descriptionText?: string | null;
};

type NormalizedScienceIngredientRow = ScienceIngredientRow & {
  primaryMatchKey: string;
  allMatchKeys: string[];
};

const normalizeWhitespace = (value: string | null | undefined): string =>
  String(value ?? "")
    .replace(/\u00a0/g, " ")
    .replace(/\s+/g, " ")
    .trim();

const stripTrailingSentencePunctuation = (value: string): string => value.replace(/[.!?]+$/g, "").trim();

const normalizeDisplayText = (value: string | null | undefined): string =>
  stripTrailingSentencePunctuation(normalizeWhitespace(value));

const hasAlphaNumericContent = (value: string | null | undefined): boolean => /[a-z0-9]/i.test(String(value ?? ""));

const HEADER_VALUE_PATTERN =
  /^(amount per (serving|tablet|capsule|softgel|packet)|% ?daily value|daily value|serving size|servings per container)$/i;

const EXPLANATORY_SEGMENT_PATTERN =
  /\b(providing|std\.?\s*to|standardized?|daily value|cfu\b|colony forming units?|heat treated|microencapsulation|daily amount)\b/i;

const BLEND_TAIL_SIGNAL_PATTERN =
  /^(\[|\(|[A-Z]\.|[A-Z0-9]{1,6}\b|lactobacillus|bifidobacterium|saccharomyces|streptococcus|bacillus|myoviridae|siphoviridae|podoviridae|b\.|l\.)/i;

const BLEND_LABEL_PATTERN = /\b(blend|complex|matrix|formula)\b/i;
const BLEND_PREFIX_PATTERN =
  /^(?:proprietary\s+)?(?:herbal\s+)?(?:blend|complex|matrix|formula)(?:\s+of\s+[^:]+)?\s*:\s*/i;
const MEMBER_DOSE_PREFIX_STRIP_PATTERN =
  /^(?:to\s+break\s+down\s+[a-z\s]+:\s*|[a-z-]+(?:\s+|-)digesting\s+enzymes?\s*)/i;
const OCR_AMOUNT_PREFIX_PATTERN = /^amount per(?:\s+%dv)?\s+serving\s+/i;
const OCR_LEADING_DOSE_NAME_PATTERN =
  /^\d+(?:\.\d+)?(?:\s*(?:million|billion|trillion))?\s*(?:mcg|μg|µg|ug|mg|g|gram|grams|iu|ui|ml|milliliters?)\b(?:\s*[*†‡%]+)?\s*/i;
const ALIAS_SEGMENT_EXCLUSION_PATTERN =
  /^(as|from|providing|std\.?\s*to|standardized?|daily value|cfu\b|colony forming units?)\b/i;
const ALIAS_KEY_REJECTION_LIST = new Set([
  "tg",
  "dv",
  "usp",
  "epa",
  "dha",
  "mk4",
  "mk7",
  "iu",
  "mg",
  "mcg",
  "g",
  "spu",
  "fcc",
]);
const UNMATCHED_OVERLAY_INDEX = Number.MAX_SAFE_INTEGER;
const GENERIC_OCR_INGREDIENT_RESIDUE = new Set([
  "dfe",
  "extract",
  "provides",
]);
const OCR_INSTRUCTIONAL_RESIDUE_PATTERN =
  /\b(suggested\s*u(?:se)?|serving\s*(?:size|per|container)|daily\s*value|%daily|take\s+with\s+food|healthcare\s+pro(?:fessional|vider)|planned\s+pregnan|capsules?\b|tablet\b|days?\b|per\s+serving)\b/i;

const isHeaderLike = (value: string | null | undefined): boolean => {
  const normalized = normalizeDisplayText(value).replace(/[%*†‡]+/g, "");
  return HEADER_VALUE_PATTERN.test(normalized);
};

const isNutritionLabelLike = (value: string | null | undefined): boolean => {
  const normalized = normalizeDisplayText(value);
  return isNutritionLabelLikeIngredientName(normalized);
};

const COMPOUND_INGREDIENT_EXEMPT_PATTERN =
  /\b(saccharomyces boulardii|sodium bicarbonate|sodium citrate)\b/i;

const SPECIAL_NUTRIENT_ROW_LABELS = new Map<string, string>([["dietary fiber", "Fiber"]]);

const normalizeDose = (value: string | null | undefined): string | null => {
  const normalized = normalizeDisplayText(value);
  if (!normalized || isHeaderLike(normalized)) return null;
  return normalized;
};

const ZERO_DOSE_PATTERN =
  /^0(?:\.0+)?\s*(mcg|μg|µg|ug|mg|g|iu|ui|cfu|spu|ml)\b/i;

const ZERO_OR_BLANK_DV_RESIDUE_NAMES = new Set([
  "vitamin a",
  "vitamin c",
  "vitamin d",
  "calcium",
  "iron",
  "potassium",
]);
const SINGLE_ROW_NUTRIENT_RESIDUE_MATCH_KEYS = new Set([
  "calcium",
  "iron",
  "potassium",
  "vitamina",
  "vitaminc",
  "vitamind",
]);

const ADDED_SUGARS_RESIDUE_PATTERN = /^includes\s+\d+(?:\.\d+)?\s*g\s+added sugars$/i;

const parseStructuredDoseText = (value: string | null | undefined): string | null => {
  const normalized = normalizeDose(value);
  if (!normalized) return null;

  const parentheticalMatch = normalized.match(TITLE_PARENTHETICAL_DOSE_PATTERN);
  if (parentheticalMatch?.[1]) {
    return normalizeDisplayText(parentheticalMatch[1]);
  }

  const doseMatch = normalized.match(TITLE_DOSE_PATTERN);
  if (!doseMatch) return null;

  const amount = normalizeWhitespace(doseMatch[1]);
  const scale = normalizeWhitespace(doseMatch[2]);
  const unit = normalizeWhitespace(doseMatch[3]);
  return normalizeDisplayText([amount, scale, unit].filter(Boolean).join(" "));
};

const hasPositiveStructuredDose = (value: string | null | undefined): boolean => {
  const doseText = parseStructuredDoseText(value);
  if (!doseText) return false;
  return !ZERO_DOSE_PATTERN.test(doseText);
};

const shouldSkipNutritionResidueRow = (row: OverlayNutritionalFactRow | null | undefined): boolean => {
  const cleanedName = cleanOverlayIngredientName(row?.substancy);
  if (!cleanedName) return false;

  const normalizedName = normalizeDisplayText(cleanedName).toLowerCase();
  const normalizedDose = normalizeDose(row?.amountPerServing);
  const normalizedDv = normalizeDisplayText(row?.dailyValuePercent);

  if (ADDED_SUGARS_RESIDUE_PATTERN.test(normalizedName)) {
    return true;
  }

  if (!normalizedDv) return false;
  if (!ZERO_OR_BLANK_DV_RESIDUE_NAMES.has(normalizedName)) return false;
  if (!normalizedDose) return true;

  return ZERO_DOSE_PATTERN.test(normalizedDose);
};

const normalizePunctuationSpacing = (value: string): string =>
  normalizeWhitespace(
    value
      .replace(/[®™]/g, "")
      .replace(/([)\]])(?=[A-Za-z0-9])/g, "$1 ")
      .replace(/([,;])(?=\S)/g, "$1 ")
      .replace(/\b(Blend|Complex|Matrix|Formula|Probiotic|Prebiotic|Synbiotic|Fermentate|Extract)(?=[A-Z0-9])/g, "$1 "),
  );

const shouldStripSegment = (value: string): boolean => {
  const normalized = normalizeWhitespace(value).replace(/[†‡*]/g, "");
  if (!normalized) return true;
  if (/^(as|from)\b/i.test(normalized)) return false;
  if (/^\d+(?:\.\d+)?\s*(million|billion|trillion)?\s*cfu\b/i.test(normalized)) return true;
  return EXPLANATORY_SEGMENT_PATTERN.test(normalized);
};

const stripExplanatorySegments = (value: string): string => {
  let current = value;
  let previous = "";
  while (current !== previous) {
    previous = current;
    current = current.replace(/(\(|\[)([^()[\]]+)(\)|\])/g, (_match, open: string, inner: string, close: string) => {
      if (shouldStripSegment(inner)) return "";
      return `${open}${normalizeWhitespace(inner)}${close}`;
    });
  }
  return normalizeWhitespace(current);
};

const truncateBlendLikeTail = (value: string): string => {
  const match = value.match(BLEND_LABEL_PATTERN);
  if (!match || match.index == null) return value;
  const head = normalizeWhitespace(value.slice(0, match.index + match[0].length));
  const tail = normalizeWhitespace(value.slice(match.index + match[0].length));
  if (!tail) return head;
  if (BLEND_TAIL_SIGNAL_PATTERN.test(tail)) return head;
  return value;
};

const stripDanglingEdgeParens = (value: string): string => {
  let current = value;
  while (current.startsWith(")") || current.startsWith("]")) current = current.slice(1).trim();
  while (current.endsWith("(") || current.endsWith("[")) current = current.slice(0, -1).trim();

  const openParenCount = (current.match(/\(/g) ?? []).length;
  const closeParenCount = (current.match(/\)/g) ?? []).length;
  if (closeParenCount > openParenCount) {
    current = current.replace(/\)+$/g, "").trim();
  }
  return current;
};

const looksLikeInstructionalOcrResidue = (value: string): boolean => {
  const normalized = normalizeDisplayText(value).toLowerCase();
  if (!normalized) return false;
  if (!OCR_INSTRUCTIONAL_RESIDUE_PATTERN.test(normalized)) return false;
  const tokenCount = normalized.split(/\s+/).filter(Boolean).length;
  return tokenCount >= 6 || normalized.length >= 40;
};

const cleanOverlayIngredientName = (value: string | null | undefined): string | null => {
  const normalized = normalizePunctuationSpacing(String(value ?? ""));
  if (!normalized || isHeaderLike(normalized)) return null;
  if (/^dietary fiber\b/i.test(normalized)) return "Fiber";
  const specialRowLabel = SPECIAL_NUTRIENT_ROW_LABELS.get(normalizeDisplayText(normalized).toLowerCase());
  if (specialRowLabel) return specialRowLabel;
  if (isNutritionLabelLike(normalized) && !COMPOUND_INGREDIENT_EXEMPT_PATTERN.test(normalized)) return null;

  const withoutExplanatorySegments = normalizePunctuationSpacing(stripExplanatorySegments(normalized));
  const truncated = truncateBlendLikeTail(withoutExplanatorySegments);
  const cleaned = normalizeDisplayText(
    stripDanglingEdgeParens(
      truncated
        .replace(OCR_AMOUNT_PREFIX_PATTERN, "")
        .replace(OCR_LEADING_DOSE_NAME_PATTERN, "")
        .replace(/\bVitamin B[,.\s]*2\b/gi, "Vitamin B12")
        .replace(/\bVitamin B\.\s*(?=\()/gi, "Vitamin B12 ")
    )
      .replace(/\s+([)\]])/g, "$1")
      .replace(/([(\[])\s+/g, "$1")
      .replace(/[:;,/-]+$/g, ""),
  );

  if (
    !cleaned ||
    looksLikeInstructionalOcrResidue(cleaned) ||
    GENERIC_OCR_INGREDIENT_RESIDUE.has(cleaned.toLowerCase()) ||
    (/^from\b/i.test(cleaned) && !cleaned.includes("(")) ||
    /^[a-z]\s*\d+\)?$/i.test(cleaned) ||
    (/^[a-z][a-z-]*\)/.test(cleaned) && !cleaned.includes("(")) ||
    !hasAlphaNumericContent(cleaned) ||
    isHeaderLike(cleaned) ||
    (isNutritionLabelLike(cleaned) && !COMPOUND_INGREDIENT_EXEMPT_PATTERN.test(cleaned))
  ) {
    return null;
  }
  return cleaned;
};

const stripTrailingOverlayMarkers = (value: string): string =>
  normalizeWhitespace(
    value
      .replace(/\s*[ⓞ®™†‡*]+$/g, "")
      .replace(/\s+\(([ow])\)$/i, "")
      .replace(/\s+([ow])$/i, ""),
  );

const STRUCTURED_MEMBER_DOSE_PATTERN =
  /([^,()]+?)\s*\((\d[\d,\s]*(?:\.\d+)?)\s*(trillion|billion|million)?\s*(mcg|μg|µg|ug|mg|g|iu|ui|cfu|spu|ml|pfu(?:'s|s)?|fu(?:'s|s)?|hut|fip|alu|cu|agu|dpp-iv|bgu|hcu|xu|su|galu|sapu|dp|pc|fcclu|endo-pgu)\)/gi;

const deriveEmbeddedDoseMemberRows = (
  name: string | null | undefined,
  dose: string | null,
): ScienceIngredientRow[] | null => {
  if (dose) return null;

  const normalized = normalizePunctuationSpacing(String(name ?? ""));
  if (!normalized) return null;

  const rows: ScienceIngredientRow[] = [];
  for (const match of normalized.matchAll(STRUCTURED_MEMBER_DOSE_PATTERN)) {
    const rawName = normalizeWhitespace(match[1]).replace(MEMBER_DOSE_PREFIX_STRIP_PATTERN, "");
    const cleanedName =
      cleanOverlayIngredientName(rawName) ??
      (/\bthera-blend\b/i.test(rawName) ? normalizeDisplayText(rawName) : null);
    if (!cleanedName) continue;

    const amount = normalizeWhitespace(match[2]).replace(/,\s+/g, ",");
    const scale = normalizeWhitespace(match[3]);
    const unit = normalizeWhitespace(match[4]);
    rows.push({
      name: cleanedName,
      dose: normalizeDisplayText([amount, scale, unit].filter(Boolean).join(" ")),
      proprietaryBlendSource: true,
    });
  }

  return rows.length > 0 ? rows : null;
};

const splitBlendTailIntoMembers = (value: string): string[] => {
  const normalized = normalizeWhitespace(value);
  if (!normalized) return [];

  return normalized
    .split(/\s*(?:[;,]|\s+&\s+|\s+and\s+)\s*/i)
    .map((segment) => segment.replace(/^(?:&|and)\s+/i, ""))
    .map((segment) => stripTrailingOverlayMarkers(segment))
    .map((segment) => cleanOverlayIngredientName(segment))
    .filter((segment): segment is string => Boolean(segment));
};

const expandBlendMemberRows = (
  name: string | null | undefined,
  dose: string | null,
): ScienceIngredientRow[] | null => {
  const normalized = normalizePunctuationSpacing(String(name ?? ""));
  const blendMatch = normalized.match(BLEND_LABEL_PATTERN);
  if (!blendMatch || blendMatch.index == null) return null;

  const buildMemberRows = (tail: string): ScienceIngredientRow[] | null => {
    const members = Array.from(new Set(splitBlendTailIntoMembers(tail)));
    if (members.length === 0) return null;

    if (members.length === 1) {
      return [{ name: members[0], dose }];
    }

    return members.map((member) => ({
      name: member,
      // The blend total does not belong to each member, so keep identity and intentionally withhold dose.
      dose: null,
      proprietaryBlendSource: true,
    }));
  };

  if (BLEND_PREFIX_PATTERN.test(normalized)) {
    const tail = normalizeWhitespace(normalized.replace(BLEND_PREFIX_PATTERN, ""));
    if (!tail) return null;
    return buildMemberRows(tail);
  }

  const tail = normalizeWhitespace(normalized.slice(blendMatch.index + blendMatch[0].length));
  if (!tail) return null;

  if (BLEND_TAIL_SIGNAL_PATTERN.test(tail)) return null;

  const memberRows = buildMemberRows(tail);
  if (memberRows) return memberRows;

  return null;
};

const normalizeMatchKey = (value: string): string =>
  normalizeDisplayText(value)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "")
    .trim();

const TITLE_PACKAGE_DESCRIPTOR_PATTERN =
  /(?:(?:vegetable|veggie|vegan|coated|chewable|chewy|delayed-release|delayed release|extended-release|extended release|quick-release|quick release|enteric-coated|enteric coated|liquid-filled|quick dissolve|quick-dissolve)\s+){0,3}/i;

const TITLE_COUNT_OR_PACKAGE_PATTERN = new RegExp(
  String.raw`\b\d+(?:\.\d+)?\s*${TITLE_PACKAGE_DESCRIPTOR_PATTERN.source}(?:capsules?|tablets?|softgels?|soft-gels?|gummies?|chews?|drops?|sprays?|packets?|sachets?|tea bags?|bags?|count|ct|servings?)\b`,
  "i",
);

const TITLE_SIZE_PATTERN =
  /\b\d+(?:\.\d+)?\s*(?:lb|lbs|oz|fl\s*oz|ml|l|g|kg)\b/i;

const TITLE_FLAVOR_PATTERN =
  /\b(chocolate|vanilla|raspberry|strawberry|berry|lemon|lime|orange|peppermint|natural\s+[a-z]+|unflavored|flavor|flavour)\b/i;

const TITLE_SUPPLEMENT_FORM_PATTERN =
  /\b(capsules?|caps\b|tablets?|softgels?|soft-gels?|vegicaps?\b|vegcaps?\b|veg(?:gie)?\s*caps?(?:ules?)?\b|gummies?|chews?|lozenges?|drops?|sprays?|packets?|sachets?)\b/i;

const TITLE_MARKETING_PATTERN =
  /^(kids|kid|women'?s|mens?|male performance|female support|innovations?|optimal wellness|once daily|daily|immune|control|advanced|premium|extra strength|original|complete)$/i;

const TITLE_INGREDIENT_SIGNAL_PATTERN =
  /\b(vitamin|mineral|biotin|probiotic|pro-bio|extract|root|leaf|seed|bark|herb|botanical|oil|acid|citrate|glycinate|orotate|taurate|malate|tribuytrin|tributyrin|konjac|grape seed|olive leaf|oregano|saw palmetto|pumpkin seed|elderberry|melatonin|magnesium|zinc|iron|calcium|d3|vitamin c|b12|nac|collagen|creatine|l-theanine|ashwagandha|rhodiola|garlic|turmeric|curcumin|fiber|protein|enzyme|cfu|ahcc|nattokinase|bacteriophage|phage|saccharomyces boulardii|sodium bicarbonate|sodium citrate|fenugreek|moringa|chitosan|nitric oxide|peppermint|postbiotic)\b/i;

const TITLE_DOSE_PATTERN =
  /(\d[\d,]*(?:\.\d+)?)\s*(trillion|billion|million)?\s*(mcg|μg|µg|ug|mg|g|gram|grams|iu|ui|cfu\d*|spu(?:'s|s)?|galu|units?|ml|milliliters?|pfu(?:'s|s)?|fu(?:'s|s)?|pc|fcclu|xu|su|hsu|bgu|dpp-?iv|endo-pgu)\b/i;

const TITLE_PARENTHETICAL_DOSE_PATTERN =
  /\(([^()]*(\d[\d,]*(?:\.\d+)?)\s*(trillion|billion|million)?\s*(mcg|μg|µg|ug|mg|g|gram|grams|iu|ui|cfu\d*|spu(?:'s|s)?|galu|units?|ml|milliliters?|pfu(?:'s|s)?|fu(?:'s|s)?|pc|fcclu|xu|su|hsu|bgu|dpp-?iv|endo-pgu)\b[^()]*)\)/i;
const TITLE_PROBIOTIC_COUNT_PATTERN = /(\d[\d,]*(?:\.\d+)?)\s*(trillion|billion|million)\b/i;
const PROBIOTIC_SIGNAL_PATTERN =
  /\b(probiotic|probiotics|pro-bio|flora|microbiome|live cultures?|cfu|lactobacillus|bifidobacterium|saccharomyces|bacillus coagulans)\b/i;
const DIGESTIVE_ENZYME_SIGNAL_PATTERN =
  /\b(digestive enzymes?|enzyme blend|enzyme complex|enzyme formula|papaya enzyme)\b/i;
const HERBAL_FORMULA_AGGREGATE_SOURCE_ZIPS = new Set([
  "ancient-nutrition.json",
  "banyan-botanicals.json",
  "california-gold-nutrition.json | iherb-brands.json",
  "christopher-s-original-formulas.json",
  "codeage.json",
  "crystal-star.json",
  "dragon-herbs.json",
  "enzymedica.json",
  "euromedica.json",
  "gaia-herbs.json",
  "herbs-etc.json",
  "himalaya.json",
  "hum-nutrition.json",
  "kroeger-herb-co.json",
  "life-extension.json",
  "metagenics.json",
  "metabolic-nutrition.json",
  "michaels-health.json",
  "nature-s-answer.json",
  "nature-s-way.json",
  "paradise-herbs.json",
  "planetary-herbals.json",
  "solaray.json",
  "terry-naturally.json",
]);
const GENERIC_AGGREGATE_FORMULA_SOURCE_ZIPS = new Set([
  "banyan-botanicals.json",
  "california-gold-nutrition.json | iherb-brands.json",
  "codeage.json",
  "dragon-herbs.json",
  "enzymedica.json",
  "euromedica.json",
  "himalaya.json",
  "hum-nutrition.json",
  "life-extension.json",
  "metagenics.json",
  "metabolic-nutrition.json",
  "michaels-health.json",
  "paradise-herbs.json",
]);
const DESCRIPTION_DOSE_FALLBACK_SOURCE_ZIPS = new Set([
  "eclectic-herb.json",
  "evlution-nutrition.json",
  "metagenics.json",
  "micro-ingredients.json",
  "natures-craft.json",
  "planetary-herbals.json",
]);
const STRUCTURED_AGGREGATE_DOSE_PATTERN =
  /(-?\d[\d,]*(?:\.\d+)?)\s*(mcg|μg|µg|ug|mg|g|ml)\b/i;
const BOTANICAL_AGGREGATE_SIGNAL_PATTERN =
  /\b(root|leaf|berry|bark|rhizome|flower|fruit|seed|stem|aerial|strobile|extract|herb|botanical|mushroom|fungi|reishi|cordyceps|astragalus|echinacea|goldenseal|ashwagandha|turmeric|curcumin|boswellia|oregano|olive leaf|magnolia|licorice|angelica|poria|jujube|alfalfa|barley|wheat\s*grass|grass|greens?)\b/i;

const cleanTitleSegment = (value: string): string =>
  normalizeDisplayText(value)
    .replace(/^[•*+\-–—]+/g, "")
    .replace(/[®™†‡*]+/g, "")
    .trim();

const hasStrongIngredientSignal = (value: string): boolean =>
  TITLE_INGREDIENT_SIGNAL_PATTERN.test(cleanTitleSegment(value));

const hasSupplementAggregateSurfaceSignal = (params: {
  title?: string | null;
  servingSize?: string | null;
  preferredTitleSegment?: string | null;
  blendLabel?: string | null;
}): boolean => {
  const title = normalizeWhitespace(params.title);
  const servingSize = normalizeWhitespace(params.servingSize);
  const preferredTitleSegment = normalizeWhitespace(params.preferredTitleSegment);
  const blendLabel = normalizeWhitespace(params.blendLabel);

  if (TITLE_SUPPLEMENT_FORM_PATTERN.test(title)) return true;
  if (/\b(capsule|tablet|softgel|lozenge|gummy|drop|spray)\b/i.test(servingSize)) return true;
  if (hasStrongIngredientSignal(preferredTitleSegment)) return true;
  if (PROBIOTIC_SIGNAL_PATTERN.test(title) || DIGESTIVE_ENZYME_SIGNAL_PATTERN.test(title)) return true;
  if (PROBIOTIC_SIGNAL_PATTERN.test(blendLabel) || DIGESTIVE_ENZYME_SIGNAL_PATTERN.test(blendLabel)) return true;
  if (BOTANICAL_AGGREGATE_SIGNAL_PATTERN.test(blendLabel)) return true;
  return false;
};

const isDescriptionDoseFallbackSource = (value: string | null | undefined): boolean =>
  DESCRIPTION_DOSE_FALLBACK_SOURCE_ZIPS.has(normalizeWhitespace(value).toLowerCase());

const DESCRIPTION_DOSE_PATTERN =
  /(\d[\d,]*(?:\.\d+)?)\s*(trillion|billion|million)?\s*(mcg|μg|µg|ug|mg|g|gram|grams|iu|ui|cfu\d*|spu(?:'s|s)?|galu|units?|ml|milliliters?|pfu(?:'s|s)?|fu(?:'s|s)?|pc|fcclu|xu|su|hsu|bgu|dpp-?iv|endo-pgu)(?=\b|[A-Z])/i;

const ECLECTIC_DRY_HERB_STRENGTH_PATTERN =
  /dry herb strength:\s*\d+\s*:\s*\d+\s*\((\d[\d,]*(?:\.\d+)?)\s*(mcg|μg|µg|ug|mg|g)\s*\/\s*ml\)/i;

const extractEclecticDryHerbStrengthDose = (value: string | null | undefined): string | null => {
  const normalized = normalizeWhitespace(value);
  if (!normalized) return null;
  if (!/\b(?:1|one)\s+(?:full\s+)?dropper(?:ful)?\b/i.test(normalized)) return null;

  const match = normalized.match(ECLECTIC_DRY_HERB_STRENGTH_PATTERN);
  if (!match) return null;

  const amount = normalizeWhitespace(match[1]);
  const unit = normalizeWhitespace(match[2]);
  return normalizeDisplayText([amount, unit].filter(Boolean).join(" "));
};

const parseNumericCount = (value: string | null | undefined): number | null => {
  const match = normalizeWhitespace(value).match(/(\d[\d,]*(?:\.\d+)?)/);
  if (!match) return null;
  const parsed = Number.parseFloat(match[1].replace(/,/g, ""));
  return Number.isFinite(parsed) ? parsed : null;
};

const parseVolumeMl = (value: string | null | undefined): number | null => {
  const normalized = normalizeWhitespace(value);
  if (!normalized) return null;

  const parentheticalMl = normalized.match(/\((?:approx\.?\s*)?(\d[\d,]*(?:\.\d+)?)\s*m[li]?\b/i);
  if (parentheticalMl) {
    const parsed = Number.parseFloat(parentheticalMl[1].replace(/,/g, ""));
    return Number.isFinite(parsed) ? parsed : null;
  }

  const mlMatch = normalized.match(/(\d[\d,]*(?:\.\d+)?)\s*m[li]?\b/i);
  if (mlMatch) {
    const parsed = Number.parseFloat(mlMatch[1].replace(/,/g, ""));
    return Number.isFinite(parsed) ? parsed : null;
  }

  const flOzMatch = normalized.match(/(\d[\d,]*(?:\.\d+)?)\s*fl\s*oz\b/i);
  if (flOzMatch) {
    const parsed = Number.parseFloat(flOzMatch[1].replace(/,/g, ""));
    return Number.isFinite(parsed) ? parsed * 29.5735 : null;
  }

  return null;
};

const parseWeightGrams = (value: string | null | undefined): number | null => {
  const normalized = normalizeWhitespace(value);
  if (!normalized) return null;
  if (/\bfl\s*oz\b/i.test(normalized)) return null;

  const match = normalized.match(/(\d[\d,]*(?:\.\d+)?)\s*(kg|g|grams?|lb|lbs|oz)\b/i);
  if (!match) return null;

  const amount = Number.parseFloat(match[1].replace(/,/g, ""));
  if (!Number.isFinite(amount) || amount <= 0) return null;

  const unit = normalizeWhitespace(match[2]).toLowerCase();
  if (unit === "kg") return amount * 1000;
  if (unit === "g" || unit === "gram" || unit === "grams") return amount;
  if (unit === "lb" || unit === "lbs") return amount * 453.59237;
  if (unit === "oz") return amount * 28.349523125;
  return null;
};

const formatMlDose = (value: number): string | null => {
  if (!Number.isFinite(value) || value <= 0) return null;
  const rounded = Math.round(value * 100) / 100;
  return normalizeDisplayText(`${Number(rounded.toFixed(2)).toString()} ml`);
};

const formatWeightDose = (grams: number): string | null => {
  if (!Number.isFinite(grams) || grams <= 0) return null;
  if (grams < 0.1) return null;

  if (grams < 1) {
    const mg = Math.round(grams * 1000);
    return mg > 0 ? normalizeDisplayText(`${mg} mg`) : null;
  }

  const rounded = Math.round(grams * 100) / 100;
  return normalizeDisplayText(`${Number(rounded.toFixed(2)).toString()} g`);
};

const hasStructuredAggregateDose = (value: string | null | undefined): boolean =>
  STRUCTURED_AGGREGATE_DOSE_PATTERN.test(normalizeWhitespace(value));

const isServingCountDose = (value: string | null | undefined): boolean =>
  /\b(drops?|droppers?|dropperfuls?|capsules?|tablets?|softgels?|soft-gels?|packets?|sachets?|servings?|teaspoons?|tsp|tablespoons?|tbsp|scoops?)\b/i.test(
    normalizeWhitespace(value),
  );

const isPowderServingMeasure = (value: string | null | undefined): boolean =>
  /\b(level\s+)?(scoops?|teaspoons?|tsp|tablespoons?|tbsp)\b/i.test(normalizeWhitespace(value));

const derivePerServingPowderDose = (params: TitleFallbackParams): string | null => {
  if (!isPowderServingMeasure(params.servingSize)) return null;

  const totalWeightGrams = parseWeightGrams(params.title);
  const servings = parseNumericCount(params.servingsPerContainer);
  if (!totalWeightGrams || !servings || servings <= 0) return null;

  return formatWeightDose(totalWeightGrams / servings);
};

const stripBrandPrefix = (title: string, brandName?: string | null): string => {
  const normalizedBrand = cleanTitleSegment(brandName ?? "");
  if (!normalizedBrand) return title;
  const escaped = normalizedBrand.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return title.replace(new RegExp(`^${escaped}\\s*,\\s*`, "i"), "");
};

const isLikelyPackageSegment = (segment: string): boolean =>
  TITLE_COUNT_OR_PACKAGE_PATTERN.test(segment) ||
  TITLE_SIZE_PATTERN.test(segment) ||
  TITLE_FLAVOR_PATTERN.test(segment);

const scoreTitleIngredientSegment = (segment: string): number => {
  const cleaned = cleanTitleSegment(segment);
  if (!cleaned) return -100;
  if (!hasAlphaNumericContent(cleaned)) return -100;
  if (TITLE_MARKETING_PATTERN.test(cleaned)) return -5;

  let score = 0;
  if (TITLE_INGREDIENT_SIGNAL_PATTERN.test(cleaned)) score += 6;
  if (/[&+\/]/.test(cleaned)) score += 1;
  if (/\b([A-Z]-[A-Z]|[A-Z][a-z]+(?:\s+[A-Z][a-z]+)+)\b/.test(cleaned)) score += 1;
  if (cleaned.split(/\s+/).length <= 5) score += 1;
  if (isLikelyPackageSegment(cleaned)) score -= 10;
  return score;
};

const pickTitleFallbackIngredientSegment = (params: TitleFallbackParams): string | null => {
  const title = cleanTitleSegment(stripBrandPrefix(String(params.title ?? ""), params.brandName));
  if (!title) return null;

  const segments = title
    .split(/\s*,\s*/)
    .map((segment) => cleanTitleSegment(segment))
    .filter(Boolean);
  if (segments.length === 0) return null;

  let best: { segment: string; score: number } | null = null;
  for (const segment of segments) {
    const score = scoreTitleIngredientSegment(segment);
    if (!best || score > best.score) {
      best = { segment, score };
    }
  }

  if (!best || best.score < 1) return null;
  return best.segment;
};

const pickFirstNonPackageTitleSegment = (params: TitleFallbackParams): string | null => {
  const title = cleanTitleSegment(stripBrandPrefix(String(params.title ?? ""), params.brandName));
  if (!title) return null;

  const segments = title
    .split(/\s*,\s*/)
    .map((segment) => cleanTitleSegment(segment))
    .filter(Boolean);

  return segments.find((segment) => !isLikelyPackageSegment(segment)) ?? null;
};

const SHORT_ACRONYM_TITLE_PATTERN = /^[A-Z0-9][A-Z0-9&+/\-]{1,9}$/;

const pickShortAcronymSegmentAfterBrand = (params: TitleFallbackParams): string | null => {
  const title = cleanTitleSegment(String(params.title ?? ""));
  const brand = cleanTitleSegment(String(params.brandName ?? ""));
  if (!title || !brand) return null;

  const segments = title
    .split(/\s*,\s*/)
    .map((segment) => cleanTitleSegment(segment))
    .filter(Boolean);
  if (segments.length < 2) return null;
  if (normalizeMatchKey(segments[0]) !== normalizeMatchKey(brand)) return null;

  const candidate = segments[1] ?? "";
  if (!candidate || isLikelyPackageSegment(candidate)) return null;
  return SHORT_ACRONYM_TITLE_PATTERN.test(candidate) ? candidate : null;
};

const pickTitleFallbackDose = (params: TitleFallbackParams): string | null => {
  const title = cleanTitleSegment(stripBrandPrefix(String(params.title ?? ""), params.brandName));
  if (!title) return null;

  const servingSizeDose = parseStructuredDoseText(params.servingSize);
  if (servingSizeDose) return servingSizeDose;

  if (normalizeWhitespace(params.sourceZipPath).toLowerCase() === "eclectic-herb.json") {
    const eclecticDose = extractEclecticDryHerbStrengthDose(params.descriptionText);
    if (eclecticDose) return eclecticDose;
  }

  if (isDescriptionDoseFallbackSource(params.sourceZipPath) && params.descriptionText) {
    const descriptionDoseMatch = normalizeWhitespace(params.descriptionText).match(DESCRIPTION_DOSE_PATTERN);
    if (descriptionDoseMatch) {
      const amount = normalizeWhitespace(descriptionDoseMatch[1]);
      const scale = normalizeWhitespace(descriptionDoseMatch[2]);
      const unit = normalizeWhitespace(descriptionDoseMatch[3]);
      return normalizeDisplayText([amount, scale, unit].filter(Boolean).join(" "));
    }
  }

  const parentheticalMatch = title.match(TITLE_PARENTHETICAL_DOSE_PATTERN);
  if (parentheticalMatch?.[1]) {
    return normalizeDisplayText(parentheticalMatch[1]);
  }

  const match = title.match(TITLE_DOSE_PATTERN);
  if (match) {
    const amount = normalizeWhitespace(match[1]);
    const scale = normalizeWhitespace(match[2]);
    const unit = normalizeWhitespace(match[3]);
    return normalizeDisplayText([amount, scale, unit].filter(Boolean).join(" "));
  }

  if (PROBIOTIC_SIGNAL_PATTERN.test(title)) {
    const probioticCountMatch = title.match(TITLE_PROBIOTIC_COUNT_PATTERN);
    if (probioticCountMatch) {
      const amount = normalizeWhitespace(probioticCountMatch[1]);
      const scale = normalizeWhitespace(probioticCountMatch[2]);
      return normalizeDisplayText([amount, scale, "CFU"].filter(Boolean).join(" "));
    }

    const descriptionDose = extractLiveCultureDose(params.descriptionText);
    if (descriptionDose) return descriptionDose;
  }

  return null;
};

const derivePerServingLiquidDose = (params: TitleFallbackParams): string | null => {
  const servingMl = parseVolumeMl(params.servingSize);
  if (servingMl) return formatMlDose(servingMl);

  const totalMl = parseVolumeMl(params.title);
  const servings = parseNumericCount(params.servingsPerContainer);
  if (!totalMl || !servings || servings <= 0) return null;
  return formatMlDose(totalMl / servings);
};

const deriveTitleFallbackRows = (params: TitleFallbackParams): ScienceIngredientRow[] => {
  const ingredient = pickTitleFallbackIngredientSegment(params);
  if (!ingredient) {
    const descriptionDose = extractLiveCultureDose(params.descriptionText);
    if (descriptionDose && PROBIOTIC_SIGNAL_PATTERN.test(normalizeWhitespace(params.descriptionText))) {
      return [{ name: "Probiotics", dose: descriptionDose }];
    }
    if (/\bpro[- ]?bio\b/i.test(cleanTitleSegment(stripBrandPrefix(String(params.title ?? ""), params.brandName)))) {
      const probioticDose = pickTitleFallbackDose(params);
      return probioticDose ? [{ name: "Probiotics", dose: probioticDose }] : [];
    }
    return [];
  }

  const cleanedIngredient = cleanOverlayIngredientName(ingredient);
  if (!cleanedIngredient) return [];
  if (
    PROBIOTIC_SIGNAL_PATTERN.test(normalizeWhitespace(params.descriptionText)) &&
    !PROBIOTIC_SIGNAL_PATTERN.test(cleanedIngredient) &&
    !hasStrongIngredientSignal(cleanedIngredient)
  ) {
    const probioticDose = extractLiveCultureDose(params.descriptionText) ?? pickTitleFallbackDose(params);
    if (probioticDose) {
      return [
        {
          name: "Probiotics",
          dose: probioticDose,
        },
      ];
    }
  }
  const probioticDose = /\bpro[- ]?bio\b/i.test(cleanedIngredient) ? pickTitleFallbackDose(params) : null;
  if (probioticDose) {
    return [
      {
        name: "Probiotics",
        dose: probioticDose,
      },
    ];
  }

  return [
    {
      name: cleanedIngredient,
      dose: pickTitleFallbackDose(params),
    },
  ];
};

const hasStructuredFallbackDose = (rows: ScienceIngredientRow[]): boolean =>
  rows.some((row) => hasPositiveStructuredDose(row.dose));

const extractBlendTail = (value: string): string | null => {
  if (BLEND_PREFIX_PATTERN.test(value)) {
    const tail = normalizeWhitespace(value.replace(BLEND_PREFIX_PATTERN, ""));
    return tail || null;
  }

  const blendMatch = value.match(BLEND_LABEL_PATTERN);
  if (!blendMatch || blendMatch.index == null) return null;
  const tail = normalizeWhitespace(value.slice(blendMatch.index + blendMatch[0].length));
  return tail || null;
};

const extractLiveCultureDose = (value: string): string | null => {
  const matches = Array.from(
    normalizeWhitespace(value).matchAll(
      /(\d[\d,]*(?:\.\d+)?)\s*(trillion|billion|million|tn|bn|mn)?\s*(?:probiotic\s+)?(?:cfus?\b|afu\b|live cultures?\b|live cells?\b|organisms?\b)/gi,
    ),
  );
  const match = matches.at(-1);
  if (!match) return null;
  const amount = normalizeWhitespace(match[1]);
  const scale = normalizeWhitespace(match[2]);
  return normalizeDisplayText([amount, scale, "CFU"].filter(Boolean).join(" "));
};

const deriveBlendAggregateLabel = (value: string): string | null => {
  const normalized = normalizeDisplayText(value);
  if (!normalized) return null;

  if (PROBIOTIC_SIGNAL_PATTERN.test(normalized)) {
    return "Probiotics";
  }

  const papayaMatch = normalized.match(/\b(papaya enzyme)\s+(?:blend|complex|matrix|formula)\b/i);
  if (papayaMatch?.[1]) {
    return normalizeDisplayText(papayaMatch[1]);
  }

  if (DIGESTIVE_ENZYME_SIGNAL_PATTERN.test(normalized)) {
    return "Digestive Enzymes";
  }

  return null;
};

const deriveSupplementalBlendRows = (
  name: string | null | undefined,
  dose: string | null,
): { name: string; dose: string | null; proprietaryBlendSource?: boolean; aggregateFormula?: boolean }[] => {
  const normalized = normalizePunctuationSpacing(String(name ?? ""));
  if (!normalized) return [];
  const liveCultureDose = extractLiveCultureDose(normalized) ?? extractLiveCultureDose(dose);
  const cleanedPrimaryLabel = cleanOverlayIngredientName(normalized);

  const tail = extractBlendTail(normalized);
  if (!tail) {
    return liveCultureDose
      ? [
          {
            name: "Probiotics",
            dose: liveCultureDose,
            proprietaryBlendSource: true,
            aggregateFormula: true,
          },
        ]
      : [];
  }

  const memberCount = Array.from(new Set(splitBlendTailIntoMembers(tail))).length;
  const hasLikelyCompositeMembers = memberCount > 1 || BLEND_TAIL_SIGNAL_PATTERN.test(tail);
  if (!hasLikelyCompositeMembers) {
    return liveCultureDose
      ? [
          {
            name: "Probiotics",
            dose: liveCultureDose,
            proprietaryBlendSource: true,
            aggregateFormula: true,
          },
        ]
      : [];
  }

  const next: { name: string; dose: string | null; proprietaryBlendSource?: boolean; aggregateFormula?: boolean }[] = [];
  const aggregateLabel = deriveBlendAggregateLabel(normalized);
  const shouldSuppressExplicitProbioticBlendAggregate =
    aggregateLabel === "Probiotics"
    && Boolean(cleanedPrimaryLabel)
    && /\bprobiotic(s)?\b/i.test(cleanedPrimaryLabel ?? "")
    && BLEND_LABEL_PATTERN.test(cleanedPrimaryLabel ?? "")
    && normalizeMatchKey(cleanedPrimaryLabel ?? "") !== "proprietaryblend"
    && !hasLikelyCompositeMembers;

  if (aggregateLabel) {
    if (!shouldSuppressExplicitProbioticBlendAggregate) {
      next.push({
        name: aggregateLabel,
        dose: aggregateLabel === "Probiotics" && liveCultureDose ? liveCultureDose : dose,
        proprietaryBlendSource: true,
        aggregateFormula: true,
      });
    }
  } else if (liveCultureDose) {
    next.push({
      name: "Probiotics",
      dose: liveCultureDose,
      proprietaryBlendSource: true,
      aggregateFormula: true,
    });
  }

  const deduped = new Map<string, { name: string; dose: string | null; proprietaryBlendSource?: boolean; aggregateFormula?: boolean }>();
  for (const row of next) {
    const cleanedName = cleanOverlayIngredientName(row.name);
    if (!cleanedName) continue;
    const key = normalizeMatchKey(cleanedName);
    if (!key) continue;
    const existing = deduped.get(key);
    if (!existing || (!existing.dose && row.dose)) {
      deduped.set(key, {
        name: cleanedName,
        dose: row.dose,
        ...(row.proprietaryBlendSource ? { proprietaryBlendSource: true } : {}),
        ...(row.aggregateFormula ? { aggregateFormula: true } : {}),
      });
      continue;
    }
    deduped.set(key, {
      ...existing,
      ...(row.proprietaryBlendSource ? { proprietaryBlendSource: true } : {}),
      ...(row.aggregateFormula ? { aggregateFormula: true } : {}),
    });
  }

  return Array.from(deduped.values());
};

const deriveSingleRowTitleRescue = (params: {
  normalizedRows: NormalizedScienceIngredientRow[];
  title?: string | null;
  brandName?: string | null;
  servingSize?: string | null;
  servingsPerContainer?: string | null;
  sourceZipPath?: string | null;
  descriptionText?: string | null;
}): ScienceIngredientRow[] | null => {
  if (params.normalizedRows.length !== 1) return null;

  const sourceRow = params.normalizedRows[0];
  if (!sourceRow?.dose) return null;

  const titleIngredient = pickTitleFallbackIngredientSegment({
    title: params.title,
    brandName: params.brandName,
    sourceZipPath: params.sourceZipPath,
  });
  if (!titleIngredient || !hasStrongIngredientSignal(titleIngredient)) return null;

  const fallbackRows = deriveTitleFallbackRows({
    title: params.title,
    brandName: params.brandName,
    servingSize: params.servingSize,
    servingsPerContainer: params.servingsPerContainer,
    sourceZipPath: params.sourceZipPath,
    descriptionText: params.descriptionText,
  });
  if (fallbackRows.length === 0) return null;

  const fallbackNormalized = buildNormalizedScienceIngredientRow(fallbackRows[0]);
  const isSingleNutritionResidueRow =
    isNutritionLabelLike(sourceRow.name)
    || SINGLE_ROW_NUTRIENT_RESIDUE_MATCH_KEYS.has(sourceRow.primaryMatchKey);

  const liquidDoseFallback = derivePerServingLiquidDose({
    title: params.title,
    brandName: params.brandName,
    servingSize: params.servingSize,
    servingsPerContainer: params.servingsPerContainer,
  });
  const prefersPerServingLiquidDose = Boolean(liquidDoseFallback) && isServingCountDose(sourceRow.dose);

  const canRescueSingleRow =
    isBlendLike(sourceRow.name)
    || prefersPerServingLiquidDose
    || (isSingleNutritionResidueRow
      && Boolean(fallbackNormalized?.dose)
      && fallbackNormalized.primaryMatchKey !== sourceRow.primaryMatchKey);
  if (!canRescueSingleRow) return null;

  const rescuedRow = buildNormalizedScienceIngredientRow({
    name: fallbackRows[0]?.name,
    dose: prefersPerServingLiquidDose
      ? liquidDoseFallback ?? fallbackRows[0]?.dose ?? sourceRow.dose
      : fallbackRows[0]?.dose ?? liquidDoseFallback ?? sourceRow.dose,
  });

  if (!rescuedRow || isBlendLike(rescuedRow.name)) return null;

  return [
    {
      name: rescuedRow.name,
      dose: rescuedRow.dose,
    },
  ];
};

const isAllowedHerbalFormulaAggregateSource = (value: string | null | undefined): boolean =>
  HERBAL_FORMULA_AGGREGATE_SOURCE_ZIPS.has(normalizeWhitespace(value).toLowerCase());

const isAllowedGenericAggregateFormulaSource = (value: string | null | undefined): boolean =>
  GENERIC_AGGREGATE_FORMULA_SOURCE_ZIPS.has(normalizeWhitespace(value).toLowerCase());

const looksLikeCompositeBlendTail = (value: string | null | undefined): boolean => {
  const normalized = normalizePunctuationSpacing(String(value ?? ""));
  const tail = extractBlendTail(normalized);
  if (!tail) return false;

  const memberCount = Array.from(new Set(splitBlendTailIntoMembers(tail))).length;
  return memberCount > 1 || BLEND_TAIL_SIGNAL_PATTERN.test(tail);
};

const looksLikeMemberDisclosureRow = (value: string | null | undefined): boolean => {
  const normalized = normalizePunctuationSpacing(String(value ?? ""));
  if (!normalized) return false;
  const commaCount = (normalized.match(/,/g) ?? []).length;
  if (commaCount < 2) return false;
  return BOTANICAL_AGGREGATE_SIGNAL_PATTERN.test(normalized) || /\bextract\b/i.test(normalized);
};

const looksLikeGenericSupplementDisclosureRow = (value: string | null | undefined): boolean => {
  const normalized = normalizePunctuationSpacing(String(value ?? ""));
  if (!normalized) return false;
  const commaCount = (normalized.match(/,/g) ?? []).length;
  const hasListSignal = commaCount >= 1 || /\band\b/i.test(normalized);
  if (!hasListSignal) return false;
  return TITLE_INGREDIENT_SIGNAL_PATTERN.test(normalized);
};

const countDoseLessNamedRows = (rows: NormalizedScienceIngredientRow[]): number =>
  rows.filter((row) => !row.dose && !isBlendLike(row.name)).length;

const deriveGenericAggregateFormulaName = (params: {
  title?: string | null;
  sourceZipPath?: string | null;
  blendLabel?: string | null;
}): string | null => {
  const hasGenericAggregateFallbackSignal =
    isAllowedGenericAggregateFormulaSource(params.sourceZipPath) ||
    hasSupplementAggregateSurfaceSignal({
      title: params.title,
      blendLabel: params.blendLabel,
    });
  if (!hasGenericAggregateFallbackSignal) return null;

  const haystack = normalizePunctuationSpacing(
    [params.title, params.blendLabel].filter((value): value is string => Boolean(value)).join(" "),
  );
  if (!haystack) return null;

  return BOTANICAL_AGGREGATE_SIGNAL_PATTERN.test(haystack)
    ? "Botanical Formula"
    : "Supplement Formula";
};

const deriveHerbalFormulaAggregateRows = (params: {
  rows: OverlayNutritionalFactRow[] | null | undefined;
  normalizedRows: NormalizedScienceIngredientRow[];
  title?: string | null;
  brandName?: string | null;
  sourceZipPath?: string | null;
  servingSize?: string | null;
  servingsPerContainer?: string | null;
}): ScienceIngredientRow[] => {
  const titleSegment = pickTitleFallbackIngredientSegment({
    title: params.title,
    brandName: params.brandName,
    sourceZipPath: params.sourceZipPath,
  });
  const shortAcronymTitleSegment = pickShortAcronymSegmentAfterBrand({
    title: params.title,
    brandName: params.brandName,
  });
  const preferredTitleSegment =
    shortAcronymTitleSegment ??
    (titleSegment && !isLikelyPackageSegment(titleSegment)
      ? titleSegment
      : pickFirstNonPackageTitleSegment({
          title: params.title,
          brandName: params.brandName,
        }));
  const supportingDoseLessMembers = countDoseLessNamedRows(params.normalizedRows);

  const rawRows = params.rows ?? [];
  for (const [index, row] of rawRows.entries()) {
    const blendLabel = normalizePunctuationSpacing(String(row?.substancy ?? ""));
    const normalizedDose = normalizeDose(row?.amountPerServing);
    const derivedServingSizeAggregateDose = isServingCountDose(normalizedDose)
      ? parseStructuredDoseText(params.servingSize)
      : null;
    const derivedLiquidAggregateDose = isServingCountDose(normalizedDose)
      ? derivePerServingLiquidDose({
          title: params.title,
          brandName: params.brandName,
          servingSize: params.servingSize,
          servingsPerContainer: params.servingsPerContainer,
        })
      : null;
    const derivedPowderAggregateDose = isServingCountDose(normalizedDose)
      ? derivePerServingPowderDose({
          title: params.title,
          brandName: params.brandName,
          servingSize: params.servingSize,
          servingsPerContainer: params.servingsPerContainer,
        })
      : null;
    const aggregateDose =
      normalizedDose && hasStructuredAggregateDose(normalizedDose)
        ? normalizedDose
        : derivedServingSizeAggregateDose
          ? derivedServingSizeAggregateDose
        : derivedLiquidAggregateDose
          ? derivedLiquidAggregateDose
        : derivedPowderAggregateDose;
    if (!blendLabel || !aggregateDose) continue;
    if (!BLEND_LABEL_PATTERN.test(blendLabel) && !/^proprietary\s+blend\b/i.test(blendLabel)) {
      continue;
    }

    const hasFollowOnMemberDisclosure =
      /^proprietary(?:\s+herbal)?\s+blend\b/i.test(blendLabel)
      && looksLikeMemberDisclosureRow(rawRows[index + 1]?.substancy)
      && !normalizeDose(rawRows[index + 1]?.amountPerServing);
    const hasGenericFollowOnDisclosure =
      /^proprietary(?:\s+herbal)?\s+blend\b/i.test(blendLabel)
      && isAllowedGenericAggregateFormulaSource(params.sourceZipPath)
      && looksLikeGenericSupplementDisclosureRow(rawRows[index + 1]?.substancy)
      && !normalizeDose(rawRows[index + 1]?.amountPerServing);
    const hasGenericAggregateSignal =
      isAllowedGenericAggregateFormulaSource(params.sourceZipPath) && Boolean(deriveBlendAggregateLabel(blendLabel));

    const blendLooksComposite = looksLikeCompositeBlendTail(blendLabel);
    const hasGenericSurfaceRecoverySignal = hasSupplementAggregateSurfaceSignal({
      title: params.title,
      servingSize: params.servingSize,
      preferredTitleSegment,
      blendLabel,
    });

    if (
      !blendLooksComposite &&
      supportingDoseLessMembers < 2 &&
      !hasFollowOnMemberDisclosure &&
      !hasGenericFollowOnDisclosure &&
      !hasGenericAggregateSignal &&
      !hasGenericSurfaceRecoverySignal
    ) {
      continue;
    }

    const cleanedPreferredTitleSegment = cleanOverlayIngredientName(preferredTitleSegment);
    const preferredAggregateName =
      cleanedPreferredTitleSegment &&
      (
        shortAcronymTitleSegment === cleanedPreferredTitleSegment ||
        hasStrongIngredientSignal(cleanedPreferredTitleSegment)
      )
        ? cleanedPreferredTitleSegment
        : null;
    const aggregateName =
      (normalizeWhitespace(params.sourceZipPath).toLowerCase() === "california-gold-nutrition.json | iherb-brands.json"
        ? cleanOverlayIngredientName(preferredAggregateName?.replace(/\s+with\s+.+$/i, "") ?? null)
        : preferredAggregateName) ??
      deriveGenericAggregateFormulaName({
        title: params.title,
        sourceZipPath: params.sourceZipPath,
        blendLabel,
      });
    if (!aggregateName) continue;

    const titleKey = normalizeMatchKey(aggregateName);
    const alreadyStructured = params.normalizedRows.some(
      (otherRow) => otherRow.primaryMatchKey === titleKey && Boolean(otherRow.dose),
    );
    if (alreadyStructured) continue;

    return [
      {
        name: aggregateName,
        dose: aggregateDose,
        proprietaryBlendSource: true,
        aggregateFormula: true,
      },
    ];
  }

  return [];
};

const derivePowderNetContentAggregateRows = (params: {
  rows: OverlayNutritionalFactRow[] | null | undefined;
  normalizedRows: NormalizedScienceIngredientRow[];
  title?: string | null;
  brandName?: string | null;
  sourceZipPath?: string | null;
  servingSize?: string | null;
  servingsPerContainer?: string | null;
}): ScienceIngredientRow[] => {
  const aggregateDose = derivePerServingPowderDose({
    title: params.title,
    brandName: params.brandName,
    servingSize: params.servingSize,
    servingsPerContainer: params.servingsPerContainer,
  });
  if (!aggregateDose) return [];
  if (params.normalizedRows.some((row) => hasPositiveStructuredDose(row.dose))) return [];

  const supportingDoseLessMembers = countDoseLessNamedRows(params.normalizedRows);
  const rawBlendLabel =
    (params.rows ?? [])
      .map((row) => normalizePunctuationSpacing(String(row?.substancy ?? "")))
      .find((value) => BLEND_LABEL_PATTERN.test(value) || looksLikeMemberDisclosureRow(value)) ?? null;
  if (!rawBlendLabel && supportingDoseLessMembers < 2) return [];

  const aggregateName = deriveGenericAggregateFormulaName({
    title: params.title,
    sourceZipPath: params.sourceZipPath,
    blendLabel: rawBlendLabel,
  });
  if (!aggregateName) return [];

  return [
    {
      name: aggregateName,
      dose: aggregateDose,
      proprietaryBlendSource: true,
      aggregateFormula: true,
    },
  ];
};

const toPrimaryMatchKey = (value: string): string => {
  const normalized = normalizeDisplayText(value)
    .replace(/(\(|\[)[^()[\]]+(\)|\])/g, " ")
    .replace(/\b(as|from)\s+[^,;]+$/i, "")
    .trim();
  const blendMatch = normalized.match(/^(.*?\b(?:blend|complex|matrix|formula)\b)/i);
  return normalizeMatchKey(blendMatch?.[1] ?? normalized);
};

const isBlendLike = (value: string): boolean => BLEND_LABEL_PATTERN.test(normalizeDisplayText(value));

const extractSupplementAliasKeys = (name: string): string[] => {
  const normalized = normalizeDisplayText(name);
  const seen = new Set<string>();
  const aliasKeys: string[] = [];

  for (const match of normalized.matchAll(/\(([^()]+)\)/g)) {
    const segment = normalizeDisplayText(match[1]).replace(/[®™]/g, "");
    if (!segment) continue;
    if (ALIAS_SEGMENT_EXCLUSION_PATTERN.test(segment)) continue;
    if (/\d/.test(segment)) continue;
    if (!/[a-z]/i.test(segment)) continue;

    const key = normalizeMatchKey(segment);
    if (!key || key.length < 6) continue;
    if (ALIAS_KEY_REJECTION_LIST.has(key)) continue;
    if (seen.has(key)) continue;
    seen.add(key);
    aliasKeys.push(key);
  }

  return aliasKeys;
};

const dedupeMatchKeys = (keys: string[]): string[] => {
  const seen = new Set<string>();
  const deduped: string[] = [];
  for (const key of keys) {
    if (!key || seen.has(key)) continue;
    seen.add(key);
    deduped.push(key);
  }
  return deduped;
};

const buildNormalizedScienceIngredientRow = (params: {
  name: string | null | undefined;
  dose: string | null;
  proprietaryBlendSource?: boolean;
  aggregateFormula?: boolean;
}): NormalizedScienceIngredientRow | null => {
  const name = normalizeDisplayText(params.name);
  if (!name) return null;

  const primaryMatchKey = toPrimaryMatchKey(name);
  if (!primaryMatchKey) return null;

  const allMatchKeys = dedupeMatchKeys([
    primaryMatchKey,
    ...extractSupplementAliasKeys(name).filter((key) => key !== primaryMatchKey),
  ]);

  return {
    name,
    dose: params.dose,
    primaryMatchKey,
    allMatchKeys,
    ...(params.proprietaryBlendSource ? { proprietaryBlendSource: true } : {}),
    ...(params.aggregateFormula ? { aggregateFormula: true } : {}),
  };
};

const toOfficialRows = (digest: FactsDigest): NormalizedScienceIngredientRow[] =>
  (digest.actives ?? [])
    .map((active) => {
      const dose =
        normalizeDose(active?.amountText) ??
        (active?.amount != null && normalizeWhitespace(active?.unit)
          ? normalizeDisplayText(`${active.amount} ${active.unit ?? ""}`)
          : null);
      return buildNormalizedScienceIngredientRow({
        name: active?.name,
        dose,
      });
    })
    .filter((row): row is NormalizedScienceIngredientRow => row !== null);

const mergeRowMatchKeys = (
  preferred: NormalizedScienceIngredientRow,
  alternate: NormalizedScienceIngredientRow,
): NormalizedScienceIngredientRow => ({
  ...preferred,
  allMatchKeys: dedupeMatchKeys([
    preferred.primaryMatchKey,
    ...preferred.allMatchKeys,
    ...alternate.allMatchKeys,
  ]),
  ...(preferred.proprietaryBlendSource || alternate.proprietaryBlendSource
    ? { proprietaryBlendSource: true }
    : {}),
  ...(preferred.aggregateFormula || alternate.aggregateFormula ? { aggregateFormula: true } : {}),
});

const pickPreferredRow = (
  current: NormalizedScienceIngredientRow,
  incoming: NormalizedScienceIngredientRow,
): NormalizedScienceIngredientRow => {
  if (incoming.dose && !current.dose) return mergeRowMatchKeys(incoming, current);
  if (!incoming.dose && current.dose) return mergeRowMatchKeys(current, incoming);
  if (incoming.name.length < current.name.length) return mergeRowMatchKeys(incoming, current);
  return mergeRowMatchKeys(current, incoming);
};

const GENERIC_DESCRIPTOR_MATCH_KEYS = new Set([
  "extract",
  "liposomal",
]);

const normalizeDoseKey = (value: string | null | undefined): string =>
  normalizeDisplayText(value)
    .toLowerCase()
    .replace(/,/g, ".")
    .replace(/(\d)\s+(?=[a-zμµ])/g, "$1");

const shouldPreferContainedSameDoseRow = (
  candidate: NormalizedScienceIngredientRow,
  other: NormalizedScienceIngredientRow,
): boolean => {
  const candidateDoseKey = normalizeDoseKey(candidate.dose);
  const otherDoseKey = normalizeDoseKey(other.dose);
  if (!candidateDoseKey || candidateDoseKey !== otherDoseKey) return false;
  if (candidate.primaryMatchKey === other.primaryMatchKey) return false;

  const candidateIsGenericDescriptor = GENERIC_DESCRIPTOR_MATCH_KEYS.has(candidate.primaryMatchKey);
  const otherIsGenericDescriptor = GENERIC_DESCRIPTOR_MATCH_KEYS.has(other.primaryMatchKey);
  if (candidateIsGenericDescriptor && !otherIsGenericDescriptor) return true;
  if (!candidateIsGenericDescriptor && otherIsGenericDescriptor) return false;

  const candidateContainsOther = candidate.primaryMatchKey.includes(other.primaryMatchKey);
  const otherContainsCandidate = other.primaryMatchKey.includes(candidate.primaryMatchKey);
  if (!candidateContainsOther || otherContainsCandidate) return false;
  if (other.primaryMatchKey.length < 6) return false;
  return true;
};

const pruneOverlappingDoseRows = (
  rows: NormalizedScienceIngredientRow[],
): NormalizedScienceIngredientRow[] => {
  const kept: NormalizedScienceIngredientRow[] = [];

  for (const row of rows) {
    const shouldDrop = rows.some((other) => other !== row && shouldPreferContainedSameDoseRow(row, other));
    if (!shouldDrop) kept.push(row);
  }

  return kept;
};

const normalizeIherbSupplementFactsRowsInternal = (
  rows: OverlayNutritionalFactRow[] | null | undefined,
): NormalizedScienceIngredientRow[] => {
  const order: string[] = [];
  const deduped = new Map<string, NormalizedScienceIngredientRow>();

  for (const row of rows ?? []) {
    if (shouldSkipNutritionResidueRow(row)) continue;
    const normalizedDose = normalizeDose(row?.amountPerServing);
    const expandedRows =
      expandBlendMemberRows(row?.substancy, normalizedDose) ??
      deriveEmbeddedDoseMemberRows(row?.substancy, normalizedDose) ??
      (() => {
        const cleaned = cleanOverlayIngredientName(row?.substancy);
        return cleaned ? [{ name: cleaned, dose: normalizedDose }] : [];
      })();
    const supplementalRows = deriveSupplementalBlendRows(row?.substancy, normalizedDose);

    for (const expandedRow of [...supplementalRows, ...expandedRows]) {
      const next = buildNormalizedScienceIngredientRow(expandedRow);
      if (!next) continue;
      const existing = deduped.get(next.primaryMatchKey);
      if (!existing) {
        order.push(next.primaryMatchKey);
        deduped.set(next.primaryMatchKey, next);
        continue;
      }
      deduped.set(next.primaryMatchKey, pickPreferredRow(existing, next));
    }
  }

  return pruneOverlappingDoseRows(
    order
    .map((key) => deduped.get(key))
    .filter((row): row is NormalizedScienceIngredientRow => Boolean(row)),
  );
};

export const normalizeIherbSupplementFactsRows = (
  rows: OverlayNutritionalFactRow[] | null | undefined,
): ScienceIngredientRow[] =>
  normalizeIherbSupplementFactsRowsInternal(rows).map((row) => ({
    name: row.name,
    dose: row.dose,
  }));

export const normalizeIherbSupplementFactsRowsWithTitleFallback = (params: {
  rows: OverlayNutritionalFactRow[] | null | undefined;
  title?: string | null;
  brandName?: string | null;
  servingSize?: string | null;
  servingsPerContainer?: string | null;
  sourceZipPath?: string | null;
  descriptionText?: string | null;
}): ScienceIngredientRow[] => {
  const normalizedRows = normalizeIherbSupplementFactsRowsInternal(params.rows);
  const singleRowRescue = deriveSingleRowTitleRescue({
    normalizedRows,
    title: params.title,
    brandName: params.brandName,
    servingSize: params.servingSize,
    servingsPerContainer: params.servingsPerContainer,
    sourceZipPath: params.sourceZipPath,
    descriptionText: params.descriptionText,
  });
  if (singleRowRescue) {
    return singleRowRescue;
  }
  const herbalFormulaAggregateRows = deriveHerbalFormulaAggregateRows({
    rows: params.rows,
    normalizedRows,
    title: params.title,
    brandName: params.brandName,
    sourceZipPath: params.sourceZipPath,
    servingSize: params.servingSize,
    servingsPerContainer: params.servingsPerContainer,
  });
  const powderNetContentAggregateRows = derivePowderNetContentAggregateRows({
    rows: params.rows,
    normalizedRows,
    title: params.title,
    brandName: params.brandName,
    sourceZipPath: params.sourceZipPath,
    servingSize: params.servingSize,
    servingsPerContainer: params.servingsPerContainer,
  });
  const titleFallbackRows = deriveTitleFallbackRows({
    title: params.title,
    brandName: params.brandName,
    servingSize: params.servingSize,
    servingsPerContainer: params.servingsPerContainer,
    sourceZipPath: params.sourceZipPath,
    descriptionText: params.descriptionText,
  });

  const mergeFallbackRows = (
    baseRows: NormalizedScienceIngredientRow[],
    fallbackRows: ScienceIngredientRow[],
  ): NormalizedScienceIngredientRow[] => {
    if (fallbackRows.length === 0) return baseRows;

    const order = baseRows.map((row) => row.primaryMatchKey);
    const deduped = new Map(baseRows.map((row) => [row.primaryMatchKey, row]));
    const normalizedFallbackRows = fallbackRows
      .map((row) => buildNormalizedScienceIngredientRow(row))
      .filter((row): row is NormalizedScienceIngredientRow => row !== null);

    for (const fallbackRow of normalizedFallbackRows) {
      const existingMatch = Array.from(deduped.values()).find((row) =>
        row.allMatchKeys.some((key) => fallbackRow.allMatchKeys.includes(key)),
      );

      if (existingMatch) {
        deduped.set(existingMatch.primaryMatchKey, pickPreferredRow(existingMatch, fallbackRow));
        continue;
      }

      if (!deduped.has(fallbackRow.primaryMatchKey)) {
        order.push(fallbackRow.primaryMatchKey);
      }
      deduped.set(fallbackRow.primaryMatchKey, fallbackRow);
    }

    return order
      .map((key) => deduped.get(key))
      .filter((row): row is NormalizedScienceIngredientRow => Boolean(row));
  };

  const pruneGenericBlendRowsWhenAggregatePresent = (
    rows: NormalizedScienceIngredientRow[],
  ): NormalizedScienceIngredientRow[] => {
    const hasAggregateFormula = rows.some((row) => row.aggregateFormula);
    if (!hasAggregateFormula) return rows;

    return rows.filter((row) => {
      if (row.aggregateFormula) return true;
      if (row.dose == null) return true;
      return normalizeDisplayText(row.name).toLowerCase() !== "proprietary blend";
    });
  };

  const rowsWithAggregate = pruneGenericBlendRowsWhenAggregatePresent(
    mergeFallbackRows(
      mergeFallbackRows(normalizedRows, herbalFormulaAggregateRows),
      powderNetContentAggregateRows,
    ),
  );

  if (rowsWithAggregate.length === 0) {
    return titleFallbackRows;
  }

  if (!hasStructuredFallbackDose(titleFallbackRows)) {
    return rowsWithAggregate.map((row) => ({
      name: row.name,
      dose: row.dose,
      ...(row.proprietaryBlendSource ? { proprietaryBlendSource: true } : {}),
      ...(row.aggregateFormula ? { aggregateFormula: true } : {}),
    }));
  }

  const hasCoverageEligibleDose = rowsWithAggregate.some(
    (row) =>
      hasPositiveStructuredDose(row.dose)
      && (row.aggregateFormula === true || (!row.proprietaryBlendSource && !isBlendLike(row.name))),
  );
  const finalRows =
    hasCoverageEligibleDose || titleFallbackRows.length === 0
      ? rowsWithAggregate
      : mergeFallbackRows(rowsWithAggregate, titleFallbackRows);

  return finalRows.map((row) => ({
    name: row.name,
    dose: row.dose,
    ...(row.proprietaryBlendSource ? { proprietaryBlendSource: true } : {}),
    ...(row.aggregateFormula ? { aggregateFormula: true } : {}),
  }));
};

export const normalizeIherbSupplementFactsRowsForGoalNavigatorCoverage = (params: {
  rows: OverlayNutritionalFactRow[] | null | undefined;
  title?: string | null;
  brandName?: string | null;
  servingSize?: string | null;
  servingsPerContainer?: string | null;
  sourceZipPath?: string | null;
  descriptionText?: string | null;
}): ScienceIngredientRow[] => {
  const normalizedRows = normalizeIherbSupplementFactsRowsInternal(params.rows);
  const rowsWithTitleFallback = normalizeIherbSupplementFactsRowsWithTitleFallback(params);

  // For goal-navigator coverage, do not let a header-only facts block invent a weak ingredient row
  // from the product title unless the title itself contributes a structured dose.
  if (normalizedRows.length === 0) {
    const hasStructuredTitleFallbackDose = rowsWithTitleFallback.some((row) =>
      hasPositiveStructuredDose(row.dose),
    );
    return hasStructuredTitleFallbackDose ? rowsWithTitleFallback : [];
  }

  return rowsWithTitleFallback;
};

const rowsMatchForCoverage = (
  officialRow: NormalizedScienceIngredientRow,
  overlayRow: NormalizedScienceIngredientRow,
): boolean => {
  if (officialRow.allMatchKeys.some((key) => overlayRow.allMatchKeys.includes(key))) return true;
  if (!isBlendLike(officialRow.name) || !isBlendLike(overlayRow.name)) return false;
  return (
    officialRow.primaryMatchKey.includes(overlayRow.primaryMatchKey) ||
    overlayRow.primaryMatchKey.includes(officialRow.primaryMatchKey)
  );
};

const selectOfficialCoverageRows = (
  officialRows: NormalizedScienceIngredientRow[],
): NormalizedScienceIngredientRow[] => officialRows.filter((row) => !isNutritionLabelLike(row.name)).slice(0, 3);

type CoverageAssignment = {
  matchedCount: number;
  matchedDoseCount: number;
  overlayIndexes: number[];
};

const isBetterCoverageAssignment = (
  candidate: CoverageAssignment,
  best: CoverageAssignment,
): boolean => {
  if (candidate.matchedCount !== best.matchedCount) {
    return candidate.matchedCount > best.matchedCount;
  }
  if (candidate.matchedDoseCount !== best.matchedDoseCount) {
    return candidate.matchedDoseCount > best.matchedDoseCount;
  }

  for (let index = 0; index < candidate.overlayIndexes.length; index += 1) {
    const candidateValue = candidate.overlayIndexes[index] ?? UNMATCHED_OVERLAY_INDEX;
    const bestValue = best.overlayIndexes[index] ?? UNMATCHED_OVERLAY_INDEX;
    if (candidateValue === bestValue) continue;
    return candidateValue < bestValue;
  }

  return false;
};

const findBestCoverageAssignment = (
  officialRows: NormalizedScienceIngredientRow[],
  overlayRows: NormalizedScienceIngredientRow[],
): CoverageAssignment => {
  const best: CoverageAssignment = {
    matchedCount: 0,
    matchedDoseCount: 0,
    overlayIndexes: Array.from({ length: officialRows.length }, () => UNMATCHED_OVERLAY_INDEX),
  };
  const currentIndexes = Array.from({ length: officialRows.length }, () => UNMATCHED_OVERLAY_INDEX);
  const usedOverlayIndexes = new Set<number>();

  // Coverage rows are capped at 3, so exhaustively evaluating legal one-to-one assignments stays tiny and stable.
  const search = (officialIndex: number, matchedCount: number, matchedDoseCount: number): void => {
    if (officialIndex >= officialRows.length) {
      const candidate: CoverageAssignment = {
        matchedCount,
        matchedDoseCount,
        overlayIndexes: [...currentIndexes],
      };
      if (isBetterCoverageAssignment(candidate, best)) {
        best.matchedCount = candidate.matchedCount;
        best.matchedDoseCount = candidate.matchedDoseCount;
        best.overlayIndexes = [...candidate.overlayIndexes];
      }
      return;
    }

    currentIndexes[officialIndex] = UNMATCHED_OVERLAY_INDEX;
    search(officialIndex + 1, matchedCount, matchedDoseCount);

    for (let overlayIndex = 0; overlayIndex < overlayRows.length; overlayIndex += 1) {
      if (usedOverlayIndexes.has(overlayIndex)) continue;
      if (!rowsMatchForCoverage(officialRows[officialIndex], overlayRows[overlayIndex])) continue;
      usedOverlayIndexes.add(overlayIndex);
      currentIndexes[officialIndex] = overlayIndex;
      search(
        officialIndex + 1,
        matchedCount + 1,
        matchedDoseCount + (overlayRows[overlayIndex]?.dose ? 1 : 0),
      );
      usedOverlayIndexes.delete(overlayIndex);
      currentIndexes[officialIndex] = UNMATCHED_OVERLAY_INDEX;
    }
  };

  search(0, 0, 0);
  return best;
};

const requiredCoverageMatches = (officialPrimaryCount: number): number => {
  if (officialPrimaryCount <= 1) return officialPrimaryCount;
  if (officialPrimaryCount === 2) return 2;
  return 2;
};

export const selectScienceIngredientRows = (params: {
  digest: FactsDigest;
  overlayClaims: OverlayClaimsLike;
}): {
  ingredientSourceTier: "overlay_iherb" | "official_record";
  ingredientRows: ScienceIngredientRow[];
} => {
  const officialRows = toOfficialRows(params.digest);
  const fallback = {
    ingredientSourceTier: "official_record" as const,
    ingredientRows: officialRows.map((row) => ({ name: row.name, dose: row.dose })),
  };

  if (params.digest.sourceType !== "dsld") return fallback;

  const overlayRows = normalizeIherbSupplementFactsRowsInternal(params.overlayClaims?.nutritionalFacts);
  if (overlayRows.length === 0) return fallback;

  const officialCoverageRows = selectOfficialCoverageRows(officialRows);
  if (officialCoverageRows.length === 0) return fallback;

  const bestCoverage = findBestCoverageAssignment(officialCoverageRows, overlayRows);
  if (
    bestCoverage.matchedCount < requiredCoverageMatches(officialCoverageRows.length) ||
    bestCoverage.matchedDoseCount < 1
  ) {
    return fallback;
  }

  return {
    ingredientSourceTier: "overlay_iherb",
    ingredientRows: overlayRows.map((row) => ({
      name: row.name,
      dose: row.dose,
    })),
  };
};

export const iherbOverlayIngredientInternals = {
  cleanOverlayIngredientName,
  deriveBlendAggregateLabel,
  derivePerServingLiquidDose,
  deriveSingleRowTitleRescue,
  deriveSupplementalBlendRows,
  expandBlendMemberRows,
  extractLiveCultureDose,
  formatMlDose,
  isServingCountDose,
  stripTrailingOverlayMarkers,
  deriveTitleFallbackRows,
  hasStrongIngredientSignal,
  normalizeIherbSupplementFactsRowsForGoalNavigatorCoverage,
  parseNumericCount,
  parseVolumeMl,
  pickTitleFallbackIngredientSegment,
  pickTitleFallbackDose,
};
