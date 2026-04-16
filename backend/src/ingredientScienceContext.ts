import type { FactsDigest } from "./factsDigest.js";
import { selectScienceIngredientRows, type ScienceIngredientRow } from "./iherbOverlayIngredients.js";

type OverlayNutritionalFactRow = {
  substancy?: string | null;
  amountPerServing?: string | null;
  dailyValuePercent?: string | null;
};

type OverlayClaimsLike = {
  nutritionalFacts?: OverlayNutritionalFactRow[] | null;
  title?: string | null;
  brandName?: string | null;
  description?: string | null;
  suggestedUse?: string | null;
  servingSize?: string | null;
  servingsPerContainer?: string | null;
  sourceZipPath?: string | null;
} | null | undefined;

export type IngredientScienceSourceType = "dsld" | "iherb_overlay" | "other";
export type IngredientScienceFormulaMode = "single_ingredient" | "multi_ingredient" | "blend";
export type IngredientScienceProductArchetype = "standard_supplement" | "functional_food_like";
export type IngredientScienceIngredientFamily =
  | "astaxanthin_carotenoid"
  | "curcumin"
  | "ashwagandha"
  | "ginseng"
  | "green_tea_extract"
  | "7keto_dhea_metabolite"
  | "cla"
  | "carnitine"
  | "5htp"
  | "b3_niacinamide"
  | "glycine"
  | "taurine"
  | "inositol"
  | "vitamin_c"
  | "vitamin_d"
  | "b12"
  | "folate"
  | "b6"
  | "zinc"
  | "magnesium"
  | "calcium"
  | "iron"
  | "melatonin"
  | "omega_3"
  | "probiotic_or_blend"
  | "generic";

export type IngredientScienceLineRole =
  | "primary_active"
  | "source_line"
  | "aggregate_line"
  | "breakdown_line"
  | "blend_line"
  | "companion_nutrient"
  | "generic_line";

export type IngredientScienceRelationshipCandidate = {
  type: "shared_purpose_pairing" | "complementary_role" | "cofactor_helper" | "formula_composition";
  ingredients: string[];
  safeStatement: string;
};

export type IngredientScienceDescriptor = {
  key: string;
  name: string;
  dose: string | null;
  ingredientFamily: IngredientScienceIngredientFamily;
  lineRole: IngredientScienceLineRole;
  categoryHint: string | null;
  sourceContext: string | null;
  formContext: string | null;
  isBlendLike: boolean;
};

export type IngredientScienceContext = {
  productName: string;
  productArchetype: IngredientScienceProductArchetype;
  ingredientSourceTier: "overlay_iherb" | "official_record";
  sourceType: IngredientScienceSourceType;
  ingredientRows: ScienceIngredientRow[];
  ingredientSnapshotNames: string[];
  ingredientDescriptors: IngredientScienceDescriptor[];
  formulaMode: IngredientScienceFormulaMode;
  ingredientFamily: IngredientScienceIngredientFamily;
  anchorIngredient: {
    name: string;
    dose: string | null;
    ingredientFamily: IngredientScienceIngredientFamily;
    lineRole: IngredientScienceLineRole;
    categoryHint: string | null;
    sourceContext: string | null;
    formContext: string | null;
  } | null;
  coIngredients: Array<{
    name: string;
    dose: string | null;
    ingredientFamily: IngredientScienceIngredientFamily;
    lineRole: IngredientScienceLineRole;
    categoryHint: string | null;
    sourceContext: string | null;
    formContext: string | null;
  }>;
  relationshipCandidates: IngredientScienceRelationshipCandidate[];
  labelConstraints: {
    hasOpaqueBlend: boolean;
    ingredientDisclosureLimited: boolean;
  };
};

const HARD_BLEND_LIKE_PATTERN = /\b(proprietary|blend|matrix|formula)\b/i;
const SOFT_BLEND_LIKE_PATTERN = /\bcomplex\b/i;
const OMEGA3_TOTAL_PATTERN = /\btotal\b.*\bomega\s*-?\s*3\b|\bomega\s*-?\s*3\b.*\btotal\b/i;
const OMEGA3_SOURCE_PATTERN = /\bfish\s*oil\b|\bkrill\s*oil\b|\balgal\s*oil\b|\boil\s*concentrate\b/i;
const OMEGA3_BREAKDOWN_PATTERN = /\bepa\b|\bdha\b|eicosapentaenoic|docosahexaenoic/i;
const VITAMIN_D_PATTERN = /\bvitamin\s*d(?:2|3)?\b|\bcholecalciferol\b|\bergocalciferol\b/i;
const B12_PATTERN = /\bvitamin\s*b12\b|\bb12\b|\bmethylcobalamin\b|\bcyanocobalamin\b|\badenosylcobalamin\b|\bhydroxocobalamin\b/i;
const FOLATE_PATTERN = /\bfolate\b|\bfolic\s+acid\b|\bmethylfolate\b|\b5[\s-]*mthf\b/i;
const B6_PATTERN = /\bvitamin\s*b6\b|\bb6\b|\bpyridoxine\b|\bpyridoxal(?:\s|-)?5(?:\s|-)?phosphate\b|\bp-?5-?p\b/i;
const HTP5_PATTERN = /\b5[\s-]*htp\b|\b5[\s-]*hydroxytryptophan\b|\bgriffonia\b/i;
const B3_PATTERN = /\bvitamin\s*b3\b|\bb3\b|\bniacinamide\b|\bniacin\b|\bnicotinamide\b/i;
const GLYCINE_PATTERN = /\bglycine\b/i;
const TAURINE_PATTERN = /\btaurine\b/i;
const INOSITOL_PATTERN = /\b(?:myo[\s-]*)?inositol\b|\bd[\s-]*chiro[\s-]*inositol\b/i;
const SEVEN_KETO_PATTERN = /\b7[\s-]*keto\b|\bacetate[\s-]*7[\s-]*one\b|\bdhea[\s-]*acetate[\s-]*7[\s-]*one\b/i;
const CLA_PATTERN = /\bcla(?:\d+)?\b|\bconjugated\s+linoleic\s+acid\b/i;
const CARNITINE_PATTERN = /\bacetyl[\s-]*l[\s-]*carnitine\b|\bl[\s-]*carnitine\b|\bcarnitine\b|\balcar\b/i;
const CURCUMIN_PATTERN = /\bcurcumin\b|\bturmeric\s+extract\b|\bcurcuminoids?\b/i;
const ASHWAGANDHA_PATTERN = /\bashwagandha\b|\bwithania\s+somnifera\b|\bksm-?66\b|\bsensoril\b/i;
const GINSENG_PATTERN = /\bginseng\b|\bpanax\b|\bamerican\s+ginseng\b|\bred\s+ginseng\b/i;
const GREEN_TEA_EXTRACT_PATTERN = /\bgreen\s+tea(?:\s+extract)?\b|\begcg\b|\bcatechins?\b|\bcamellia\s+sinensis\b/i;
const ELDERBERRY_PATTERN = /\belderberry\b|\bsambucus\b/i;
const MAGNESIUM_PATTERN =
  /\bmagnesium\b|\bmagtein\b|\bmagnesium\s+(?:glycinate|citrate|oxide|malate|taurate|threonate|chloride|l-threonate)\b/i;
const MAGNESIUM_BRANDED_SOURCE_PATTERN = /\bmagtein\b/i;
const CALCIUM_PATTERN =
  /\bcalcium\b|\bcalcium\s+(?:carbonate|citrate|ascorbate|malate|lactate|hydroxyapatite)\b/i;
const IRON_PATTERN = /\biron\b|\bferrous\b|\bferric\b/i;
const MELATONIN_PATTERN = /\bmelatonin\b/i;
const FUNCTIONAL_FOOD_LIKE_TITLE_PATTERN =
  /\b(?:gum|gums|mints?|lozenge|lozenges|freeze\s+dried|juice\s+powder|fruit\s+powder|dragon\s+fruit|smoothie|drink\s+mix|tea\s+bags?|iced\s+tea|protein\s+(?:iced\s+)?tea|matcha(?:\s+green\s+tea)?\s+powder|herbal\s+slimming\s+tea|greens\b|super\s*greens?|green\s+superfood|superfood|vegetable\s+powder)\b/i;
const OUT_OF_SCOPE_FOOD_SNACK_TITLE_PATTERN =
  /\b(?:stroopwafels?|waffles?|crackers?|snackable|fruit\s+gummy\s+snacks?|fruit\s+snacks?|gummy\s+snacks?)\b/i;
const FUNCTIONAL_GUMMY_CONTEXT_TITLE_PATTERN =
  /\b(?:fiber\s+gumm(?:y|ies)|morning\s+sickness\s+relief\s+gumm(?:y|ies)|fruit\s+gumm(?:y|ies))\b/i;
const FUNCTIONAL_FOOD_LIKE_INGREDIENT_PATTERN =
  /\b(?:xylitol|erythritol|fiber|dragon\s+fruit|fruit\s+powder|juice\s+powder|spirulina|chlorella|barley\s+grass|wheat\s+grass|digestive\s+enzyme|enzyme\s+assimilation|greens\b|green\s+superfood|superfood)\b/i;
const FUNCTIONAL_FOOD_LIKE_FORM_PATTERN = /\b(?:gum|mint|lozenge|tea|powder|drink\s*mix)\b/i;
const PROBIOTIC_TITLE_PATTERN =
  /\b(?:probiotic|probiotics|pro-bio|biotic|flora|microbiome|live cultures?|cfu|digestive support)\b/i;
const PROBIOTIC_SPECIFIC_ROW_PATTERN =
  /\b(?:probiotic|probiotics|acidophilus|lactobacillus|bifidobacterium|saccharomyces|bacillus|cfu|live cultures?)\b/i;
const PROBIOTIC_BRAND_ONLY_ROW_PATTERN = /\b(?:protectis)\b/i;
const GREENS_TITLE_PATTERN =
  /\b(?:greens\b|super\s*greens?|green\s+superfood|superfood|vegetable\s+powder|daily\s+greens?|greens?\s+powder)\b/i;
const TEA_BAG_TITLE_PATTERN = /\b(?:tea\s+bags?|herbal\s+tea|slimming\s+tea)\b/i;
const FOOD_LIKE_POWDER_TITLE_PATTERN =
  /\b(?:juice\s+powder|fruit\s+powder|smoothie|drink\s+mix|iced\s+tea|protein\s+(?:iced\s+)?tea|matcha(?:\s+green\s+tea)?\s+powder|vegetable\s+powder|greens?\s+powder)\b/i;
const FOOD_LIKE_CONTEXT_ANCHOR_PATTERN =
  /^(?:greens?|green\s+superfood|food(?:\s|-)?based\s+(?:powder|product)|tea\s+blend|superfood\s+greens?|greens?\s+powder)$/i;
const FOOD_LIKE_MACRO_ANCHOR_PATTERN =
  /\b(?:calories|total\s+carbohydrates?|total\s+sugars?|added\s+sugars?|sugar\s+alcohols?|dietary\s+fiber|fiber|sodium|protein|potassium)\b/i;
const PROTEIN_PRODUCT_TITLE_PATTERN = /\bprotein\b/i;
const IMMUNE_BLEND_TITLE_PATTERN =
  /\b(?:immune|immunity|sambucus|elderberry|children'?s|chewable)\b/i;
const B_COMPLEX_TITLE_PATTERN =
  /\bb[\s-]*complex\b|\bb[\s-]*vitamins?\b|\bvitamin\s*b\s*complex\b/i;
const MULTIVITAMIN_TITLE_PATTERN =
  /\bmulti[\s-]*(?:vitamin|mineral)s?\b|\bmultivitamin\b|\bmultimineral\b/i;
const B_COMPLEX_FORMULA_ROW_PATTERN =
  /\bb[\s-]*complex\b|\bvitamin\s*b\s*complex\b/i;
const MULTIVITAMIN_FORMULA_ROW_PATTERN =
  /\bmulti[\s-]*(?:vitamin|mineral)s?\b|\bmultivitamin\b|\bmultimineral\b/i;
const GENERIC_FORMULA_LINE_PATTERN =
  /\b(?:supplement|nutritional|nutrition(?:al)?|proprietary)\s+formula\b|\bmatrix\b/i;
const ENZYME_SUPPORT_LINE_PATTERN =
  /\b(?:digestive\s+enzyme|enzyme\s+assimilation|cytozymes?|enzyme\s+blend)\b/i;
const NUTRITION_FACTS_MACRO_PATTERN =
  /\b(?:calories|total\s+carbohydrates?|total\s+sugars?|added\s+sugars?|sugar\s+alcohols?|dietary\s+fiber|fiber|sodium)\b/i;
const NON_INGREDIENT_AUDIENCE_ROW_PATTERN = /^(?:men|women|adults?|children|kids?|teens?)$/i;
const BRAND_PREFIX_SEGMENT_PATTERN = /^[a-z0-9][a-z0-9 '&.+-]{1,24}$/i;

const normalizeText = (value: string | null | undefined): string =>
  String(value ?? "")
    .replace(/\s+/g, " ")
    .trim();

const stripBrandPrefix = (
  productName: string,
  brandName: string | null | undefined,
): string => {
  const normalizedProductName = normalizeText(productName);
  const normalizedBrand = normalizeText(brandName);
  if (!normalizedBrand) return normalizedProductName;
  const escapedBrand = normalizedBrand.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return normalizeText(normalizedProductName.replace(new RegExp(`^${escapedBrand}\\s*,\\s*`, "i"), ""));
};

export const normalizeIngredientScienceKey = (value: string | null | undefined): string =>
  normalizeText(value)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "")
    .trim();

const dedupeIngredientRows = (rows: ScienceIngredientRow[]): ScienceIngredientRow[] => {
  const seen = new Set<string>();
  const deduped: ScienceIngredientRow[] = [];
  for (const row of rows) {
    const name = normalizeText(row?.name);
    if (!name) continue;
    const key = normalizeIngredientScienceKey(name);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    deduped.push({
      name,
      dose: normalizeText(row?.dose) || null,
    });
  }
  return deduped;
};

const inferFamilyFromText = (combined: string): IngredientScienceIngredientFamily => {
  if (/astaxanthin|carotenoid/.test(combined)) return "astaxanthin_carotenoid";
  if (CURCUMIN_PATTERN.test(combined)) return "curcumin";
  if (ASHWAGANDHA_PATTERN.test(combined)) return "ashwagandha";
  if (GINSENG_PATTERN.test(combined)) return "ginseng";
  if (GREEN_TEA_EXTRACT_PATTERN.test(combined)) return "green_tea_extract";
  if (SEVEN_KETO_PATTERN.test(combined)) return "7keto_dhea_metabolite";
  if (CLA_PATTERN.test(combined)) return "cla";
  if (CARNITINE_PATTERN.test(combined)) return "carnitine";
  if (HTP5_PATTERN.test(combined)) return "5htp";
  if (B3_PATTERN.test(combined)) return "b3_niacinamide";
  if (GLYCINE_PATTERN.test(combined)) return "glycine";
  if (TAURINE_PATTERN.test(combined)) return "taurine";
  if (INOSITOL_PATTERN.test(combined)) return "inositol";
  if (VITAMIN_D_PATTERN.test(combined)) return "vitamin_d";
  if (B12_PATTERN.test(combined)) return "b12";
  if (FOLATE_PATTERN.test(combined)) return "folate";
  if (B6_PATTERN.test(combined)) return "b6";
  if (/\bvitamin\s*c\b|\bascorbic\b|\bester\s*c\b/.test(combined)) return "vitamin_c";
  if (/\bzinc\b/.test(combined)) return "zinc";
  if (MAGNESIUM_PATTERN.test(combined)) return "magnesium";
  if (CALCIUM_PATTERN.test(combined)) return "calcium";
  if (IRON_PATTERN.test(combined)) return "iron";
  if (MELATONIN_PATTERN.test(combined)) return "melatonin";
  if (/\bfish\s*oil\b|\bomega\s*-?\s*3\b|\bepa\b|\bdha\b|\bkrill\b|\balgal\s*oil\b/.test(combined)) {
    return "omega_3";
  }
  if (
    /probiotic|lactobacillus|bifidobacterium|saccharomyces|microbiome|phage/.test(combined) ||
    HARD_BLEND_LIKE_PATTERN.test(combined) ||
    SOFT_BLEND_LIKE_PATTERN.test(combined)
  ) {
    return "probiotic_or_blend";
  }
  return "generic";
};

const inferRowIngredientFamily = (params: {
  rowName: string | null;
  productName?: string | null | undefined;
}): IngredientScienceIngredientFamily => {
  const rowText = normalizeText(params.rowName).toLowerCase();
  if (!rowText) return "generic";

  const rowFamily = inferFamilyFromText(rowText);
  if (rowFamily !== "generic") return rowFamily;

  const productText = normalizeText(params.productName).toLowerCase();
  if (!productText) return "generic";

  // Only use product-level hints when the selected row is too generic to classify on its own.
  if (HARD_BLEND_LIKE_PATTERN.test(rowText) || SOFT_BLEND_LIKE_PATTERN.test(rowText)) {
    return inferFamilyFromText(`${rowText} ${productText}`);
  }

  return "generic";
};

const inferContextIngredientFamily = (params: {
  seedText: string | null;
  productName: string | null | undefined;
  rows: ScienceIngredientRow[];
}): IngredientScienceIngredientFamily => {
  const anchorText = normalizeText(params.seedText).toLowerCase();
  const productText = normalizeText(params.productName).toLowerCase();
  const combined = [anchorText, productText, ...params.rows.map((row) => normalizeText(row.name).toLowerCase())]
    .join(" ")
    .trim();

  return inferFamilyFromText(combined);
};

const categoryHintForFamily = (
  family: IngredientScienceIngredientFamily,
  rowName: string | null,
): string | null => {
  if (rowName && isBlendLike(rowName, family)) return "blend";
  if (family === "astaxanthin_carotenoid") return "carotenoid";
  if (family === "curcumin") return "botanical extract";
  if (family === "ashwagandha") return "botanical extract";
  if (family === "ginseng") return "botanical extract";
  if (family === "green_tea_extract") return "botanical extract";
  if (family === "7keto_dhea_metabolite") return "metabolite";
  if (family === "cla") return "fatty acid";
  if (family === "carnitine") return "amino acid derivative";
  if (family === "5htp") return "amino acid derivative";
  if (family === "b3_niacinamide") return "vitamin";
  if (family === "glycine") return "amino acid";
  if (family === "taurine") return "amino sulfonic acid";
  if (family === "inositol") return "inositol compound";
  if (family === "vitamin_c") return "vitamin";
  if (family === "vitamin_d") return "vitamin";
  if (family === "b12") return "vitamin";
  if (family === "folate") return "vitamin";
  if (family === "b6") return "vitamin";
  if (family === "zinc") return "mineral";
  if (family === "magnesium") return "mineral";
  if (family === "calcium") return "mineral";
  if (family === "iron") return "mineral";
  if (family === "melatonin") return "sleep-related ingredient";
  if (family === "omega_3") return "omega-3 fatty acids";
  if (family === "probiotic_or_blend") return "probiotic blend";
  return null;
};

const isBotanicalExtractFamily = (family: IngredientScienceIngredientFamily | null | undefined): boolean =>
  family === "curcumin" ||
  family === "ashwagandha" ||
  family === "ginseng" ||
  family === "green_tea_extract";

const isBlendLike = (
  name: string | null | undefined,
  family?: IngredientScienceIngredientFamily | null,
): boolean => {
  const normalized = normalizeText(name);
  if (!normalized) return false;
  if (HARD_BLEND_LIKE_PATTERN.test(normalized)) return true;
  if (!SOFT_BLEND_LIKE_PATTERN.test(normalized)) return false;
  return !isBotanicalExtractFamily(family ?? null);
};

const inferFormContext = (
  name: string | null | undefined,
  family: IngredientScienceIngredientFamily,
  lineRole: IngredientScienceLineRole,
): string | null => {
  const normalized = normalizeText(name);
  if (!normalized) return null;

  const parenthetical = normalized.match(/\(([^)]+)\)/)?.[1]?.trim() ?? null;
  if (parenthetical) return parenthetical;

  if (lineRole === "source_line") return "source line";
  if (lineRole === "aggregate_line") return "total line";
  if (lineRole === "breakdown_line") return "breakdown line";
  if (lineRole === "blend_line") return "blend-style line";
  if (/\bextract\b/i.test(normalized)) return "extract line";
  if (/\boil\b/i.test(normalized)) return "oil line";
  if (/\bchelate\b|\bcitrate\b|\bglycinate\b|\bmalate\b|\boxide\b|\btaurate\b|\bthreonate\b/i.test(normalized)) {
    return "named form line";
  }
  if (family === "5htp") return "amino-acid derivative line";
  if (family === "b3_niacinamide" || family === "b6" || family === "b12" || family === "folate") {
    return "vitamin-form line";
  }
  return null;
};

const COMPANION_FAMILIES = new Set<IngredientScienceIngredientFamily>([
  "b3_niacinamide",
  "b6",
  "b12",
  "folate",
  "zinc",
  "magnesium",
  "calcium",
  "iron",
]);

const SUPPORTING_MICRONUTRIENT_FAMILIES = new Set<IngredientScienceIngredientFamily>([
  "vitamin_c",
  "vitamin_d",
  "b3_niacinamide",
  "b6",
  "b12",
  "folate",
  "zinc",
  "calcium",
  "iron",
]);

const MINERAL_STACK_FAMILIES = new Set<IngredientScienceIngredientFamily>([
  "magnesium",
  "calcium",
  "zinc",
  "iron",
]);

const STRONG_LEAD_ACTIVE_FAMILIES = new Set<IngredientScienceIngredientFamily>([
  "5htp",
  "curcumin",
  "ashwagandha",
  "ginseng",
  "green_tea_extract",
  "7keto_dhea_metabolite",
  "cla",
  "carnitine",
  "glycine",
  "taurine",
  "inositol",
  "melatonin",
  "omega_3",
]);

const PRIMARY_ACTIVE_FAMILIES = new Set<IngredientScienceIngredientFamily>([
  "5htp",
  "curcumin",
  "ashwagandha",
  "ginseng",
  "green_tea_extract",
  "7keto_dhea_metabolite",
  "cla",
  "carnitine",
  "glycine",
  "taurine",
  "inositol",
  "vitamin_c",
  "vitamin_d",
  "melatonin",
  "omega_3",
]);

const FAMILY_TITLE_HINTS: Array<{ family: IngredientScienceIngredientFamily; pattern: RegExp }> = [
  { family: "5htp", pattern: /\b5[\s-]*htp\b|\bgriffonia\b/i },
  { family: "cla", pattern: /\bcla(?:\d+)?\b|\bconjugated\s+linoleic\s+acid\b/i },
  { family: "carnitine", pattern: /\bcarnitine\b|\balcar\b/i },
  { family: "green_tea_extract", pattern: /\bgreen\s+tea\b|\begcg\b/i },
  { family: "omega_3", pattern: /\bomega\s*-?\s*3\b|\bfish\s*oil\b|\bepa\b|\bdha\b/i },
  { family: "7keto_dhea_metabolite", pattern: /\b7[\s-]*keto\b/i },
  { family: "curcumin", pattern: /\bcurcumin\b|\bturmeric\b/i },
  { family: "ashwagandha", pattern: /\bashwagandha\b/i },
  { family: "ginseng", pattern: /\bginseng\b/i },
  { family: "melatonin", pattern: /\bmelatonin\b/i },
  { family: "magnesium", pattern: /\bmagnesium\b/i },
  { family: "calcium", pattern: /\bcalcium\b/i },
  { family: "zinc", pattern: /\bzinc\b/i },
  { family: "iron", pattern: /\biron\b/i },
  { family: "vitamin_d", pattern: /\bvitamin\s*d\b|\bd3\b|\bd2\b/i },
  { family: "vitamin_c", pattern: /\bvitamin\s*c\b|\bascorbic\b/i },
  { family: "probiotic_or_blend", pattern: /\bprobiotic|flora|microbiome|live cultures?\b/i },
];

const parseDoseMagnitude = (value: string | null | undefined): number => {
  const normalized = normalizeText(value).toLowerCase().replace(/,/g, "");
  if (!normalized) return 0;
  const match = normalized.match(/(\d+(?:\.\d+)?)/);
  if (!match?.[1]) return 0;
  const amount = Number(match[1]);
  if (!Number.isFinite(amount) || amount <= 0) return 0;
  if (/\b(mcg|µg|μg)\b/.test(normalized)) return amount / 1000;
  if (/\b(g|gram|grams)\b/.test(normalized)) return amount * 1000;
  if (/\bmg\b/.test(normalized)) return amount;
  return amount / 10;
};

const matchesProductTitle = (rowName: string, productName: string): boolean => {
  const productKey = normalizeIngredientScienceKey(productName);
  if (!productKey) return false;
  const variants = [
    rowName,
    rowName.split(/\s+\(/)[0] ?? rowName,
    rowName.split(/\s+·\s+/)[0] ?? rowName,
  ]
    .map((value) => normalizeIngredientScienceKey(value))
    .filter((value) => value.length >= 3);
  return variants.some((value) => productKey.includes(value));
};

const isFoodLikeTitle = (productName: string): boolean =>
  FUNCTIONAL_FOOD_LIKE_TITLE_PATTERN.test(productName) ||
  OUT_OF_SCOPE_FOOD_SNACK_TITLE_PATTERN.test(productName) ||
  FUNCTIONAL_GUMMY_CONTEXT_TITLE_PATTERN.test(productName) ||
  GREENS_TITLE_PATTERN.test(productName) ||
  TEA_BAG_TITLE_PATTERN.test(productName) ||
  FOOD_LIKE_POWDER_TITLE_PATTERN.test(productName);

const shouldPreferSpecificFoodLikeIngredient = (productName: string): boolean =>
  ELDERBERRY_PATTERN.test(productName) ||
  hasTitleFamily("green_tea_extract", productName) ||
  PROBIOTIC_TITLE_PATTERN.test(productName);

const isFoodLikeContextAnchorRow = (rowName: string | null | undefined): boolean =>
  FOOD_LIKE_CONTEXT_ANCHOR_PATTERN.test(normalizeText(rowName));

const isFoodLikeMacroAnchorRow = (
  rowName: string | null | undefined,
  productName: string,
): boolean => {
  const normalizedRow = normalizeText(rowName);
  if (!normalizedRow || !isFoodLikeTitle(productName)) return false;
  if (PROTEIN_PRODUCT_TITLE_PATTERN.test(productName) && /\bprotein\b/i.test(normalizedRow)) {
    return false;
  }
  return FOOD_LIKE_MACRO_ANCHOR_PATTERN.test(normalizedRow);
};

const isDedicatedElderberryRow = (rowName: string | null | undefined): boolean => {
  const normalized = normalizeText(rowName);
  if (!ELDERBERRY_PATTERN.test(normalized)) return false;
  if (/\b(?:syrup|gumm(?:y|ies)|tea|children|kids?|lollipops?|softchew|immune|immunity|support)\b/i.test(normalized)) {
    return false;
  }
  const wordCount = normalized.split(/\s+/).filter(Boolean).length;
  if (wordCount <= 4) return true;
  return /^(?:black\s+)?elderberry\b|^sambucus\b/i.test(normalized);
};

const hasTitleFamily = (
  family: IngredientScienceIngredientFamily,
  productName: string,
): boolean => {
  const familyPattern = FAMILY_TITLE_HINTS.find((entry) => entry.family === family)?.pattern;
  return familyPattern ? familyPattern.test(productName) : false;
};

const extractTitleMatch = (productName: string, pattern: RegExp): string | null => {
  const match = productName.match(pattern)?.[0] ?? null;
  return normalizeText(match);
};

const countMineralFamiliesInText = (value: string): number =>
  [
    MAGNESIUM_PATTERN.test(value),
    CALCIUM_PATTERN.test(value),
    /\bzinc\b/i.test(value),
    IRON_PATTERN.test(value),
    VITAMIN_D_PATTERN.test(value),
  ].filter(Boolean).length;

const deriveScienceTitleRescueRows = (params: {
  productName: string;
  brandName: string | null;
  dosageForm: string | null | undefined;
  existingRows: ScienceIngredientRow[];
}): ScienceIngredientRow[] => {
  const productName = normalizeText(params.productName);
  if (!productName) return [];

  const titleWithoutBrand = stripBrandPrefix(productName, params.brandName);
  const titleWithBrandContext = normalizeText(`${titleWithoutBrand} ${productName}`);
  const existingFamilies = params.existingRows.map((row) =>
    inferRowIngredientFamily({
      rowName: row.name,
      productName: titleWithoutBrand,
    }),
  );
  const existingKeys = new Set(
    params.existingRows.map((row) => normalizeIngredientScienceKey(row.name)).filter(Boolean),
  );
  const rescueRows: ScienceIngredientRow[] = [];
  const pushRow = (name: string | null | undefined): void => {
    const normalizedName = normalizeText(name);
    if (!normalizedName) return;
    const key = normalizeIngredientScienceKey(normalizedName);
    if (!key || existingKeys.has(key)) return;
    existingKeys.add(key);
    rescueRows.push({
      name: normalizedName,
      dose: null,
    });
  };

  if (hasTitleFamily("5htp", titleWithoutBrand) && !existingFamilies.includes("5htp")) {
    pushRow(extractTitleMatch(titleWithoutBrand, /\b5[\s-]*htp\b|\b5[\s-]*hydroxytryptophan\b/i) ?? "5-HTP");
  }

  if (hasTitleFamily("carnitine", titleWithoutBrand) && !existingFamilies.includes("carnitine")) {
    pushRow(
      extractTitleMatch(
        titleWithoutBrand,
        /\b(?:acetyl[\s-]*)?l[\s-]*carnitine(?:\s*\+\s*tartrate)?\b/i,
      ) ?? "L-Carnitine",
    );
  }

  if (hasTitleFamily("cla", titleWithoutBrand) && !existingFamilies.includes("cla")) {
    pushRow("CLA");
  }

  if (hasTitleFamily("green_tea_extract", titleWithoutBrand) && !existingFamilies.includes("green_tea_extract")) {
    pushRow(
      extractTitleMatch(titleWithoutBrand, /\begcg\b|\bcatechins?\b|\bgreen tea(?:\s+extract)?\b/i) ??
        (/\bextract\b/i.test(titleWithoutBrand) ? "Green Tea Extract" : "Green Tea"),
    );
  }

  if (B_COMPLEX_TITLE_PATTERN.test(titleWithoutBrand)) {
    pushRow("B-Complex Formula");
  }

  if (MULTIVITAMIN_TITLE_PATTERN.test(titleWithoutBrand)) {
    pushRow("Multivitamin & Mineral Formula");
  }

  const hasDedicatedElderberryRow = params.existingRows.some((row) => isDedicatedElderberryRow(row.name));
  if (ELDERBERRY_PATTERN.test(titleWithBrandContext) && !hasDedicatedElderberryRow) {
    pushRow(/\belderberry\b/i.test(titleWithoutBrand) ? "Elderberry" : "Sambucus elderberry");
  }

  if (hasTitleFamily("omega_3", titleWithoutBrand) && !existingFamilies.includes("omega_3")) {
    pushRow(
      extractTitleMatch(titleWithoutBrand, /\bomega[\s-]*3\b|\bfish oil\b|\bepa\b|\bdha\b/i) ?? "Omega-3",
    );
  }

  const hasDedicatedProbioticRow = params.existingRows.some((row) =>
    PROBIOTIC_SPECIFIC_ROW_PATTERN.test(row.name),
  );
  if (PROBIOTIC_TITLE_PATTERN.test(titleWithBrandContext) && !hasDedicatedProbioticRow) {
    pushRow("Probiotics");
  }

  const hasDedicatedMineralRow = (family: IngredientScienceIngredientFamily): boolean =>
    params.existingRows.some((row) => {
      const rowFamily = inferRowIngredientFamily({
        rowName: row.name,
        productName: titleWithoutBrand,
      });
      if (rowFamily !== family) return false;
      return countMineralFamiliesInText(normalizeText(row.name).toLowerCase()) <= 1;
    });

  const titleMineralFamilies = [
    hasTitleFamily("magnesium", titleWithoutBrand) ? "magnesium" : null,
    hasTitleFamily("zinc", titleWithoutBrand) ? "zinc" : null,
    hasTitleFamily("calcium", titleWithoutBrand) ? "calcium" : null,
    hasTitleFamily("iron", titleWithoutBrand) ? "iron" : null,
    hasTitleFamily("vitamin_d", titleWithoutBrand) ? "vitamin_d" : null,
  ].filter((family): family is IngredientScienceIngredientFamily => Boolean(family));
  const coveredMineralFamilies = existingFamilies.filter(
    (family) => MINERAL_STACK_FAMILIES.has(family) || family === "vitamin_d",
  );
  const hasMeaningfulCoverage =
    params.existingRows.length > 0 &&
    existingFamilies.some((family) => family !== "generic");

  if (titleMineralFamilies.length >= 2 && coveredMineralFamilies.length < titleMineralFamilies.length) {
    if (titleMineralFamilies.includes("magnesium") && !hasDedicatedMineralRow("magnesium")) pushRow("Magnesium");
    if (titleMineralFamilies.includes("zinc") && !hasDedicatedMineralRow("zinc")) pushRow("Zinc");
    if (titleMineralFamilies.includes("calcium") && !hasDedicatedMineralRow("calcium")) pushRow("Calcium");
    if (titleMineralFamilies.includes("iron") && !hasDedicatedMineralRow("iron")) pushRow("Iron");
    if (titleMineralFamilies.includes("vitamin_d") && !hasDedicatedMineralRow("vitamin_d")) {
      pushRow(
        extractTitleMatch(titleWithoutBrand, /\bvitamin\s*d(?:2|3)?\b|\bd3\b|\bd2\b/i) ?? "Vitamin D3",
      );
    }
  }

  if (!hasMeaningfulCoverage && titleMineralFamilies.length === 1) {
    const [family] = titleMineralFamilies;
    if (family === "magnesium") pushRow("Magnesium");
    if (family === "zinc") pushRow("Zinc");
    if (family === "calcium") pushRow("Calcium");
    if (family === "iron") pushRow("Iron");
    if (family === "vitamin_d") {
      pushRow(
        extractTitleMatch(titleWithoutBrand, /\bvitamin\s*d(?:2|3)?\b|\bd3\b|\bd2\b/i) ?? "Vitamin D3",
      );
    }
  }

  if (
    hasTitleFamily("zinc", titleWithoutBrand) &&
    IMMUNE_BLEND_TITLE_PATTERN.test(titleWithoutBrand) &&
    !hasDedicatedMineralRow("zinc")
  ) {
    pushRow("Zinc");
  }

  if (
    hasTitleFamily("vitamin_c", titleWithoutBrand) &&
    IMMUNE_BLEND_TITLE_PATTERN.test(titleWithoutBrand) &&
    !params.existingRows.some((row) => inferRowIngredientFamily({ rowName: row.name, productName: titleWithoutBrand }) === "vitamin_c")
  ) {
    pushRow("Vitamin C");
  }

  const isFoodLikeTitle =
    GREENS_TITLE_PATTERN.test(titleWithoutBrand) ||
    TEA_BAG_TITLE_PATTERN.test(titleWithoutBrand) ||
    FOOD_LIKE_POWDER_TITLE_PATTERN.test(titleWithoutBrand) ||
    OUT_OF_SCOPE_FOOD_SNACK_TITLE_PATTERN.test(titleWithoutBrand) ||
    FUNCTIONAL_GUMMY_CONTEXT_TITLE_PATTERN.test(titleWithoutBrand) ||
    FUNCTIONAL_FOOD_LIKE_FORM_PATTERN.test(normalizeText(params.dosageForm));

  if (GREENS_TITLE_PATTERN.test(titleWithoutBrand)) {
    pushRow("Greens");
  } else if (TEA_BAG_TITLE_PATTERN.test(titleWithoutBrand)) {
    pushRow("Tea blend");
  } else if (!hasMeaningfulCoverage && isFoodLikeTitle) {
    pushRow(FOOD_LIKE_POWDER_TITLE_PATTERN.test(titleWithoutBrand) ? "Food-based powder" : "Food-based product");
  }

  if (
    rescueRows.length === 0 &&
    params.existingRows.length === 1 &&
    BRAND_PREFIX_SEGMENT_PATTERN.test(params.existingRows[0]?.name ?? "") &&
    !hasMeaningfulCoverage
  ) {
    if (hasTitleFamily("cla", titleWithoutBrand)) pushRow("CLA");
    else if (hasTitleFamily("carnitine", titleWithoutBrand)) pushRow("L-Carnitine");
    else if (hasTitleFamily("green_tea_extract", titleWithoutBrand)) pushRow("Green Tea");
    else if (PROBIOTIC_TITLE_PATTERN.test(titleWithBrandContext)) pushRow("Probiotics");
  }

  return rescueRows;
};

const getFamilyTitleBoost = (
  family: IngredientScienceIngredientFamily,
  rowName: string,
  productName: string,
): number => {
  const familyPattern = FAMILY_TITLE_HINTS.find((entry) => entry.family === family)?.pattern;
  if (!familyPattern) return matchesProductTitle(rowName, productName) ? 40 : 0;
  const titleBoost = familyPattern.test(productName) ? 150 : 0;
  const rowBoost = matchesProductTitle(rowName, productName) ? 40 : 0;
  return titleBoost + rowBoost;
};

const getFamilyTitlePositionBoost = (
  family: IngredientScienceIngredientFamily,
  productName: string,
): number => {
  const familyPattern = FAMILY_TITLE_HINTS.find((entry) => entry.family === family)?.pattern;
  if (!familyPattern) return 0;
  const match = productName.match(familyPattern);
  const index = match?.index;
  if (typeof index !== "number" || index < 0) return 0;
  if (index <= 2) return 175;
  if (index <= 18) return 90;
  if (index <= 44) return 65;
  if (index <= 88) return 36;
  return 18;
};

const titleStartsWithFamily = (
  family: IngredientScienceIngredientFamily,
  productName: string,
): boolean => {
  const familyPattern = FAMILY_TITLE_HINTS.find((entry) => entry.family === family)?.pattern;
  if (!familyPattern) return false;
  const normalizedProductName = normalizeText(productName);
  const leadingSegment = normalizeText(normalizedProductName.split(",")[0]);
  const titleWithoutBrand =
    leadingSegment && !familyPattern.test(leadingSegment)
      ? normalizeText(normalizedProductName.replace(/^[^,]{1,40},\s*/, ""))
      : normalizedProductName;
  const leadingTitle = titleWithoutBrand.slice(0, 64).replace(/^[^a-z0-9]+/i, "");
  const match = leadingTitle.match(familyPattern);
  return typeof match?.index === "number" && match.index <= 6;
};

const hasMineralStackLeadSignal = (
  rows: ScienceIngredientRow[],
  families: IngredientScienceIngredientFamily[],
  productName: string,
): boolean => {
  const mineralFamilyCount = families.filter((family) => MINERAL_STACK_FAMILIES.has(family)).length;
  if (mineralFamilyCount >= 2) return true;
  const mineralTitleHits = ["calcium", "magnesium", "zinc", "iron"].filter((token) =>
    new RegExp(`\\b${token}\\b`, "i").test(productName),
  ).length;
  if (mineralTitleHits >= 2) return true;
  return rows.some((row) => /\bcalcium\b/i.test(row.name)) && rows.some((row) => /\bmagnesium\b/i.test(row.name));
};

const hasCalciumMagnesiumZincStackTitle = (productName: string): boolean =>
  hasTitleFamily("calcium", productName)
  && hasTitleFamily("magnesium", productName)
  && hasTitleFamily("zinc", productName)
  && !titleStartsWithFamily("zinc", productName)
  && !IMMUNE_BLEND_TITLE_PATTERN.test(productName);

const hasExplicitFamilyRow = (
  rows: ScienceIngredientRow[],
  families: IngredientScienceIngredientFamily[],
  family: IngredientScienceIngredientFamily,
): boolean => {
  const familyPattern = FAMILY_TITLE_HINTS.find((entry) => entry.family === family)?.pattern;
  if (!familyPattern) return false;
  return rows.some((row, index) => (families[index] ?? "generic") === family && familyPattern.test(row.name));
};

const hasOmega3BreakdownOrAggregateRow = (rows: ScienceIngredientRow[]): boolean =>
  rows.some((row) => OMEGA3_BREAKDOWN_PATTERN.test(row.name) || OMEGA3_TOTAL_PATTERN.test(row.name));

const hasStrongLeadActiveSignal = (families: IngredientScienceIngredientFamily[]): boolean =>
  families.some((family) => STRONG_LEAD_ACTIVE_FAMILIES.has(family));

const pickPrimaryActiveRowIndex = (
  rows: ScienceIngredientRow[],
  families: IngredientScienceIngredientFamily[],
  productName: string,
): number => {
  if (rows.length === 0) return -1;
  const hasStrongLeadActive = hasStrongLeadActiveSignal(families);
  const hasMineralStackLead = hasMineralStackLeadSignal(rows, families, productName);
  const hasCalMagZincStackTitle = hasCalciumMagnesiumZincStackTitle(productName);
  const hasExplicitMagnesiumRow = hasExplicitFamilyRow(rows, families, "magnesium");
  const hasZincRow = families.some((family) => family === "zinc");
  const hasOmega3BreakdownOrAggregate = hasOmega3BreakdownOrAggregateRow(rows);
  if (titleStartsWithFamily("cla", productName)) {
    const claIndex = families.findIndex((family) => family === "cla");
    if (claIndex >= 0) return claIndex;
  }
  if (titleStartsWithFamily("carnitine", productName)) {
    const carnitineIndex = families.findIndex((family) => family === "carnitine");
    if (carnitineIndex >= 0) return carnitineIndex;
  }
  let bestIndex = 0;
  let bestScore = Number.NEGATIVE_INFINITY;

  rows.forEach((row, index) => {
    const family = families[index] ?? "generic";
    const familyTitleBoost = getFamilyTitleBoost(family, row.name, productName);
    const familyTitlePositionBoost = getFamilyTitlePositionBoost(family, productName);
    const productTitleEchoPenalty =
      normalizeIngredientScienceKey(row.name) === normalizeIngredientScienceKey(productName) ? 300 : 0;
    const macroPenalty = NUTRITION_FACTS_MACRO_PATTERN.test(row.name) ? 260 : 0;
    const foodLikeContextAnchorBoost =
      isFoodLikeTitle(productName)
      && isFoodLikeContextAnchorRow(row.name)
      && !shouldPreferSpecificFoodLikeIngredient(productName)
        ? 760
        : 0;
    const foodLikeMacroPenalty = isFoodLikeMacroAnchorRow(row.name, productName) ? 460 : 0;
    const audienceRowPenalty = NON_INGREDIENT_AUDIENCE_ROW_PATTERN.test(normalizeText(row.name)) ? 260 : 0;
    const magnesiumComboTitleBoost =
      family === "magnesium"
      && hasTitleFamily("magnesium", productName)
      && hasTitleFamily("calcium", productName)
      && !hasTitleFamily("zinc", productName)
      && !titleStartsWithFamily("vitamin_c", productName)
        ? 190
        : 0;
    const vitaminCInMagnesiumComboPenalty =
      family === "vitamin_c"
      && hasTitleFamily("magnesium", productName)
      && hasTitleFamily("calcium", productName)
      && !titleStartsWithFamily("vitamin_c", productName)
        ? 260
        : 0;
    const elderberryTitleBoost =
      ELDERBERRY_PATTERN.test(productName) && ELDERBERRY_PATTERN.test(row.name)
        ? 190
        : 0;
    const probioticLeadBoost =
      PROBIOTIC_TITLE_PATTERN.test(productName)
      && (family === "probiotic_or_blend" || PROBIOTIC_SPECIFIC_ROW_PATTERN.test(row.name))
        ? 180
        : 0;
    const probioticBrandOnlyPenalty =
      PROBIOTIC_TITLE_PATTERN.test(productName)
      && PROBIOTIC_BRAND_ONLY_ROW_PATTERN.test(row.name)
      && !PROBIOTIC_SPECIFIC_ROW_PATTERN.test(row.name)
        ? 210
        : 0;
    const opaqueProbioticBlendPenalty =
      PROBIOTIC_TITLE_PATTERN.test(productName)
      && isBlendLike(row.name, family)
      && !PROBIOTIC_SPECIFIC_ROW_PATTERN.test(row.name)
        ? 320
        : 0;
    const zincImmuneBlendBoost =
      family === "zinc"
      && hasZincRow
      && IMMUNE_BLEND_TITLE_PATTERN.test(productName)
        ? 360
        : 0;
    const magnesiumTitleLeadBoost =
      family === "magnesium"
      && titleStartsWithFamily("magnesium", productName)
        ? 260
        : 0;
    const calMagZincStackZincBoost =
      hasCalMagZincStackTitle && family === "zinc"
        ? 150
        : 0;
    const calMagZincStackCalciumPenalty =
      hasCalMagZincStackTitle && family === "calcium"
        ? 120
        : 0;
    const magnesiumTitleLeadCompanionPenalty =
      titleStartsWithFamily("magnesium", productName)
      && (family === "zinc" || family === "calcium" || family === "vitamin_d" || family === "vitamin_c")
        ? 150
        : 0;
    const zincTitleLeadBoost =
      family === "zinc"
      && titleStartsWithFamily("zinc", productName)
        ? 280
        : 0;
    const zincTitleLeadCompanionPenalty =
      titleStartsWithFamily("zinc", productName)
      && (family === "magnesium" || family === "calcium" || family === "vitamin_d" || family === "vitamin_c")
        ? 160
        : 0;
    const claTitleLeadBoost =
      family === "cla"
      && titleStartsWithFamily("cla", productName)
        ? 650
        : 0;
    const claTitleLeadCompanionPenalty =
      titleStartsWithFamily("cla", productName)
      && family === "carnitine"
        ? 280
        : 0;
    const zincNamedStackBoost =
      family === "zinc"
      && hasTitleFamily("zinc", productName)
      && !hasCalMagZincStackTitle
      && (
        hasMineralStackLead
        || /\bvitamin\s*c\b|\bvitamin\s*d(?:2|3)?\b|\bd3\b|\bd2\b/i.test(productName)
      )
        ? 240
        : 0;
    const zincNamedStackCompanionPenalty =
      hasTitleFamily("zinc", productName)
      && !hasCalMagZincStackTitle
      && (
        hasMineralStackLead
        || /\bvitamin\s*c\b|\bvitamin\s*d(?:2|3)?\b|\bd3\b|\bd2\b/i.test(productName)
      )
      && (family === "calcium" || family === "magnesium" || family === "vitamin_c" || family === "vitamin_d")
        ? 92
        : 0;
    const probioticComboZincPenalty =
      family === "zinc"
      && PROBIOTIC_TITLE_PATTERN.test(productName)
      && rows.some((candidate, candidateIndex) =>
        (families[candidateIndex] ?? "generic") === "probiotic_or_blend"
        || PROBIOTIC_SPECIFIC_ROW_PATTERN.test(candidate.name),
      )
        ? 210
        : 0;
    const vitaminCImmuneCompanionPenalty =
      family === "vitamin_c"
      && hasZincRow
      && IMMUNE_BLEND_TITLE_PATTERN.test(productName)
      && !titleStartsWithFamily("vitamin_c", productName)
        ? 320
        : 0;
    const carnitineClaMatrixBoost =
      family === "carnitine"
      && CARNITINE_PATTERN.test(productName)
      && CLA_PATTERN.test(productName)
      && !titleStartsWithFamily("cla", productName)
        ? 170
        : 0;
    const claMatrixPenalty =
      family === "cla" && CARNITINE_PATTERN.test(productName) && HARD_BLEND_LIKE_PATTERN.test(row.name)
        ? 180
        : 0;
    const magnesiumBrandedSourcePenalty =
      family === "magnesium" && hasExplicitMagnesiumRow && MAGNESIUM_BRANDED_SOURCE_PATTERN.test(row.name)
        ? 190
        : 0;
    const omega3SourcePenalty =
      family === "omega_3" && hasOmega3BreakdownOrAggregate && OMEGA3_SOURCE_PATTERN.test(row.name)
        ? 210
        : 0;
    const omega3BreakdownBoost =
      family === "omega_3" && (OMEGA3_TOTAL_PATTERN.test(row.name) || OMEGA3_BREAKDOWN_PATTERN.test(row.name))
        ? 140
        : 0;
    const supportingPenalty =
      hasStrongLeadActive && SUPPORTING_MICRONUTRIENT_FAMILIES.has(family) ? 96 : 0;
    const vitaminDInMineralStackPenalty =
      hasMineralStackLead && family === "vitamin_d" ? 145 : 0;
    const genericFormulaPenalty =
      GENERIC_FORMULA_LINE_PATTERN.test(row.name) ? 220 : 0;
    const enzymeSupportPenalty =
      ENZYME_SUPPORT_LINE_PATTERN.test(row.name) ? 190 : 0;
    const mineralStackPriorityBoost =
      hasMineralStackLead
        ? family === "magnesium"
          ? 145
          : family === "zinc"
            ? 120
            : family === "calcium"
              ? 36
              : 0
        : 0;
    const score =
      (matchesProductTitle(row.name, productName) ? 120 : 0) +
      familyTitleBoost +
      familyTitlePositionBoost +
      foodLikeContextAnchorBoost +
      mineralStackPriorityBoost +
      probioticLeadBoost +
      zincImmuneBlendBoost +
      magnesiumComboTitleBoost +
      magnesiumTitleLeadBoost +
      calMagZincStackZincBoost +
      zincTitleLeadBoost +
      claTitleLeadBoost +
      zincNamedStackBoost +
      elderberryTitleBoost +
      carnitineClaMatrixBoost +
      omega3BreakdownBoost +
      (STRONG_LEAD_ACTIVE_FAMILIES.has(family) ? 86 : 0) +
      (PRIMARY_ACTIVE_FAMILIES.has(family) ? 24 : 0) +
      Math.min(parseDoseMagnitude(row.dose), 1200) / 24 +
      (row.dose ? 18 : 0) -
      (COMPANION_FAMILIES.has(family) ? 48 : 0) -
      supportingPenalty -
      vitaminDInMineralStackPenalty -
      vitaminCImmuneCompanionPenalty -
      vitaminCInMagnesiumComboPenalty -
      magnesiumTitleLeadCompanionPenalty -
      calMagZincStackCalciumPenalty -
      zincTitleLeadCompanionPenalty -
      claTitleLeadCompanionPenalty -
      zincNamedStackCompanionPenalty -
      probioticComboZincPenalty -
      probioticBrandOnlyPenalty -
      opaqueProbioticBlendPenalty -
      productTitleEchoPenalty -
      macroPenalty -
      foodLikeMacroPenalty -
      audienceRowPenalty -
      claMatrixPenalty -
      magnesiumBrandedSourcePenalty -
      omega3SourcePenalty -
      genericFormulaPenalty -
      enzymeSupportPenalty -
      (isBlendLike(row.name, family) ? 120 : 0) -
      index * 0.5;

    if (score > bestScore) {
      bestScore = score;
      bestIndex = index;
    }
  });

  return bestIndex;
};

const scoreIngredientDescriptorForDisplay = (params: {
  rows: ScienceIngredientRow[];
  row: ScienceIngredientRow;
  descriptor: IngredientScienceDescriptor;
  index: number;
  productName: string;
  anchorKey: string | null;
  hasStrongLeadActive: boolean;
  hasMineralStackLead: boolean;
}): number => {
  const {
    rows,
    row,
    descriptor,
    index,
    productName,
    anchorKey,
    hasStrongLeadActive,
    hasMineralStackLead,
  } = params;
  const rowKey = normalizeIngredientScienceKey(row.name);
  const doseMagnitude = parseDoseMagnitude(row.dose);
  const titleMatch = matchesProductTitle(row.name, productName);
  const isAnchor = Boolean(anchorKey && rowKey === anchorKey);
  const familyTitleBoost = getFamilyTitleBoost(descriptor.ingredientFamily, row.name, productName);
  const familyTitlePositionBoost = getFamilyTitlePositionBoost(descriptor.ingredientFamily, productName);
  const hasExplicitMagnesiumRow = rows.some((candidate) => {
    const candidateFamily = inferRowIngredientFamily({
      rowName: candidate.name,
      productName,
    });
    return candidateFamily === "magnesium" && /\bmagnesium\b/i.test(candidate.name);
  });
  const hasCalMagZincStackTitle = hasCalciumMagnesiumZincStackTitle(productName);
  const hasZincRow = rows.some((candidate) => {
    const candidateFamily = inferRowIngredientFamily({
      rowName: candidate.name,
      productName,
    });
    return candidateFamily === "zinc";
  });
  const hasOmega3BreakdownOrAggregate = hasOmega3BreakdownOrAggregateRow(rows);
  const productTitleEchoPenalty =
    normalizeIngredientScienceKey(row.name) === normalizeIngredientScienceKey(productName) ? 280 : 0;
  const macroPenalty = NUTRITION_FACTS_MACRO_PATTERN.test(row.name) ? 240 : 0;
  const foodLikeContextAnchorBoost =
    isFoodLikeTitle(productName)
    && isFoodLikeContextAnchorRow(row.name)
    && !shouldPreferSpecificFoodLikeIngredient(productName)
      ? 820
      : 0;
  const foodLikeMacroPenalty = isFoodLikeMacroAnchorRow(row.name, productName) ? 500 : 0;
  const audienceRowPenalty = NON_INGREDIENT_AUDIENCE_ROW_PATTERN.test(normalizeText(row.name)) ? 240 : 0;
  const magnesiumComboTitleBoost =
    descriptor.ingredientFamily === "magnesium"
    && hasTitleFamily("magnesium", productName)
    && hasTitleFamily("calcium", productName)
    && !hasTitleFamily("zinc", productName)
    && !titleStartsWithFamily("vitamin_c", productName)
      ? 210
      : 0;
  const vitaminCInMagnesiumComboPenalty =
    descriptor.ingredientFamily === "vitamin_c"
    && hasTitleFamily("magnesium", productName)
    && hasTitleFamily("calcium", productName)
    && !titleStartsWithFamily("vitamin_c", productName)
      ? 240
      : 0;
  const elderberryTitleBoost =
    ELDERBERRY_PATTERN.test(productName) && ELDERBERRY_PATTERN.test(row.name)
      ? 180
      : 0;
  const probioticLeadBoost =
    PROBIOTIC_TITLE_PATTERN.test(productName)
    && (
      descriptor.ingredientFamily === "probiotic_or_blend"
      || PROBIOTIC_SPECIFIC_ROW_PATTERN.test(row.name)
    )
      ? 170
      : 0;
  const probioticBrandOnlyPenalty =
    PROBIOTIC_TITLE_PATTERN.test(productName)
    && PROBIOTIC_BRAND_ONLY_ROW_PATTERN.test(row.name)
    && !PROBIOTIC_SPECIFIC_ROW_PATTERN.test(row.name)
      ? 190
      : 0;
  const opaqueProbioticBlendPenalty =
    PROBIOTIC_TITLE_PATTERN.test(productName)
    && isBlendLike(row.name, descriptor.ingredientFamily)
    && !PROBIOTIC_SPECIFIC_ROW_PATTERN.test(row.name)
      ? 340
      : 0;
  const zincImmuneBlendBoost =
    descriptor.ingredientFamily === "zinc"
    && hasZincRow
    && IMMUNE_BLEND_TITLE_PATTERN.test(productName)
      ? 340
      : 0;
  const magnesiumTitleLeadBoost =
    descriptor.ingredientFamily === "magnesium"
    && titleStartsWithFamily("magnesium", productName)
      ? 240
      : 0;
  const calMagZincStackZincBoost =
    hasCalMagZincStackTitle && descriptor.ingredientFamily === "zinc"
      ? 140
      : 0;
  const calMagZincStackCalciumPenalty =
    hasCalMagZincStackTitle && descriptor.ingredientFamily === "calcium"
      ? 110
      : 0;
  const magnesiumTitleLeadCompanionPenalty =
    titleStartsWithFamily("magnesium", productName)
    && (
      descriptor.ingredientFamily === "zinc"
      || descriptor.ingredientFamily === "calcium"
      || descriptor.ingredientFamily === "vitamin_d"
      || descriptor.ingredientFamily === "vitamin_c"
    )
      ? 140
      : 0;
  const zincTitleLeadBoost =
    descriptor.ingredientFamily === "zinc"
    && titleStartsWithFamily("zinc", productName)
      ? 260
      : 0;
  const zincTitleLeadCompanionPenalty =
    titleStartsWithFamily("zinc", productName)
    && (
      descriptor.ingredientFamily === "magnesium"
      || descriptor.ingredientFamily === "calcium"
      || descriptor.ingredientFamily === "vitamin_d"
      || descriptor.ingredientFamily === "vitamin_c"
    )
      ? 145
      : 0;
  const claTitleLeadBoost =
    descriptor.ingredientFamily === "cla"
    && titleStartsWithFamily("cla", productName)
      ? 620
      : 0;
  const claTitleLeadCompanionPenalty =
    titleStartsWithFamily("cla", productName)
    && descriptor.ingredientFamily === "carnitine"
      ? 250
      : 0;
  const zincNamedStackBoost =
    descriptor.ingredientFamily === "zinc"
    && hasTitleFamily("zinc", productName)
    && !hasCalMagZincStackTitle
    && (
      hasMineralStackLead
      || /\bvitamin\s*c\b|\bvitamin\s*d(?:2|3)?\b|\bd3\b|\bd2\b/i.test(productName)
    )
      ? 220
      : 0;
  const zincNamedStackCompanionPenalty =
    hasTitleFamily("zinc", productName)
    && !hasCalMagZincStackTitle
    && (
      hasMineralStackLead
      || /\bvitamin\s*c\b|\bvitamin\s*d(?:2|3)?\b|\bd3\b|\bd2\b/i.test(productName)
    )
    && (
      descriptor.ingredientFamily === "calcium"
      || descriptor.ingredientFamily === "magnesium"
      || descriptor.ingredientFamily === "vitamin_c"
      || descriptor.ingredientFamily === "vitamin_d"
    )
      ? 86
      : 0;
  const probioticComboZincPenalty =
    descriptor.ingredientFamily === "zinc"
    && PROBIOTIC_TITLE_PATTERN.test(productName)
    && rows.some((candidate) => {
      const candidateFamily = inferRowIngredientFamily({
        rowName: candidate.name,
        productName,
      });
      return candidateFamily === "probiotic_or_blend" || PROBIOTIC_SPECIFIC_ROW_PATTERN.test(candidate.name);
    })
      ? 190
      : 0;
  const vitaminCImmuneCompanionPenalty =
    descriptor.ingredientFamily === "vitamin_c"
    && hasZincRow
    && IMMUNE_BLEND_TITLE_PATTERN.test(productName)
    && !titleStartsWithFamily("vitamin_c", productName)
      ? 300
      : 0;
  const carnitineClaMatrixBoost =
    descriptor.ingredientFamily === "carnitine"
    && CARNITINE_PATTERN.test(productName)
    && CLA_PATTERN.test(productName)
    && !titleStartsWithFamily("cla", productName)
      ? 160
      : 0;
  const claMatrixPenalty =
    descriptor.ingredientFamily === "cla" && CARNITINE_PATTERN.test(productName) && HARD_BLEND_LIKE_PATTERN.test(row.name)
      ? 160
      : 0;
  const magnesiumBrandedSourcePenalty =
    descriptor.ingredientFamily === "magnesium"
    && hasExplicitMagnesiumRow
    && MAGNESIUM_BRANDED_SOURCE_PATTERN.test(row.name)
      ? 175
      : 0;
  const omega3SourcePenalty =
    descriptor.ingredientFamily === "omega_3"
    && hasOmega3BreakdownOrAggregate
    && OMEGA3_SOURCE_PATTERN.test(row.name)
      ? 190
      : 0;
  const omega3BreakdownBoost =
    descriptor.ingredientFamily === "omega_3"
    && (OMEGA3_TOTAL_PATTERN.test(row.name) || OMEGA3_BREAKDOWN_PATTERN.test(row.name))
      ? 130
      : 0;
  const genericFormulaPenalty = GENERIC_FORMULA_LINE_PATTERN.test(row.name) ? 180 : 0;
  const enzymeSupportPenalty = ENZYME_SUPPORT_LINE_PATTERN.test(row.name) ? 170 : 0;
  const supportingPenalty =
    hasStrongLeadActive && SUPPORTING_MICRONUTRIENT_FAMILIES.has(descriptor.ingredientFamily) ? 96 : 0;
  const vitaminDInMineralStackPenalty =
    hasMineralStackLead && descriptor.ingredientFamily === "vitamin_d" ? 130 : 0;
  const mineralStackPriorityBoost =
    hasMineralStackLead
      ? descriptor.ingredientFamily === "magnesium"
        ? 145
        : descriptor.ingredientFamily === "zinc"
          ? 120
          : descriptor.ingredientFamily === "calcium"
            ? 36
            : 0
      : 0;
  const bComplexFormulaBoost =
    B_COMPLEX_TITLE_PATTERN.test(productName) && B_COMPLEX_FORMULA_ROW_PATTERN.test(row.name) ? 860 : 0;
  const multivitaminFormulaBoost =
    MULTIVITAMIN_TITLE_PATTERN.test(productName) && MULTIVITAMIN_FORMULA_ROW_PATTERN.test(row.name) ? 900 : 0;
  const multivitaminSingleActivePenalty =
    MULTIVITAMIN_TITLE_PATTERN.test(productName)
    && !MULTIVITAMIN_FORMULA_ROW_PATTERN.test(row.name)
    && descriptor.ingredientFamily !== "generic"
      ? 120
      : 0;

  return (
    (isAnchor ? 260 : 0) +
    (descriptor.lineRole === "primary_active" ? 180 : 0) +
    (descriptor.lineRole === "breakdown_line" ? 42 : 0) +
    (titleMatch ? 120 : 0) +
    familyTitleBoost +
    familyTitlePositionBoost +
    foodLikeContextAnchorBoost +
    mineralStackPriorityBoost +
    magnesiumComboTitleBoost +
    bComplexFormulaBoost +
    multivitaminFormulaBoost +
    probioticLeadBoost +
    zincImmuneBlendBoost +
    magnesiumTitleLeadBoost +
    calMagZincStackZincBoost +
    zincTitleLeadBoost +
    claTitleLeadBoost +
    zincNamedStackBoost +
    elderberryTitleBoost +
    carnitineClaMatrixBoost +
    omega3BreakdownBoost +
    (STRONG_LEAD_ACTIVE_FAMILIES.has(descriptor.ingredientFamily) ? 68 : 0) +
    (PRIMARY_ACTIVE_FAMILIES.has(descriptor.ingredientFamily) ? 34 : 0) +
    (row.dose ? 16 : 0) +
    Math.min(doseMagnitude, 1200) / 24 -
    (descriptor.lineRole === "companion_nutrient" ? 62 : 0) -
    supportingPenalty -
    vitaminDInMineralStackPenalty -
    multivitaminSingleActivePenalty -
    vitaminCImmuneCompanionPenalty -
    vitaminCInMagnesiumComboPenalty -
    magnesiumTitleLeadCompanionPenalty -
    calMagZincStackCalciumPenalty -
    zincTitleLeadCompanionPenalty -
    claTitleLeadCompanionPenalty -
    zincNamedStackCompanionPenalty -
    probioticComboZincPenalty -
    probioticBrandOnlyPenalty -
    opaqueProbioticBlendPenalty -
    productTitleEchoPenalty -
    macroPenalty -
    foodLikeMacroPenalty -
    audienceRowPenalty -
    claMatrixPenalty -
    magnesiumBrandedSourcePenalty -
    omega3SourcePenalty -
    (descriptor.lineRole === "aggregate_line" ? 90 : 0) -
    (descriptor.lineRole === "source_line" ? 120 : 0) -
    (descriptor.lineRole === "blend_line" ? 140 : 0) -
    genericFormulaPenalty -
    enzymeSupportPenalty -
    index * 0.5
  );
};

const buildLineRoles = (
  rows: ScienceIngredientRow[],
  families: IngredientScienceIngredientFamily[],
  primaryIndex: number,
  productName: string,
): IngredientScienceLineRole[] => {
  const deduped = dedupeIngredientRows(rows);
  const hasOmega3Breakdown = deduped.some((row) => OMEGA3_BREAKDOWN_PATTERN.test(row.name));
  const hasOmega3Aggregate = deduped.some((row) => OMEGA3_TOTAL_PATTERN.test(row.name));
  const hasStrongLeadActive = hasStrongLeadActiveSignal(families);
  const hasMineralStackLead = hasMineralStackLeadSignal(deduped, families, productName);

  return deduped.map((row, index) => {
    const family = families[index] ?? "generic";
    if (isBlendLike(row.name, family)) return "blend_line";
    if (OMEGA3_BREAKDOWN_PATTERN.test(row.name)) return "breakdown_line";
    if (OMEGA3_TOTAL_PATTERN.test(row.name)) return "aggregate_line";
    if (OMEGA3_SOURCE_PATTERN.test(row.name) && (hasOmega3Breakdown || hasOmega3Aggregate)) {
      return "source_line";
    }
    if (index === primaryIndex) return "primary_active";
    if (hasMineralStackLead && family === "vitamin_d") {
      return "companion_nutrient";
    }
    if (
      hasStrongLeadActive
      && (
        SUPPORTING_MICRONUTRIENT_FAMILIES.has(family)
        || /\bvitamin\b|\bb3\b|\bb6\b|\bniacin(?:amide)?\b|\bnicotinamide\b|\bpyridoxine\b|\bpyridoxal(?:\s|-)?5(?:\s|-)?phosphate\b|\bp-?5-?p\b|\bzinc\b|\bcalcium\b|\bselenium\b|\bcopper\b|\bchromium\b|\biodine\b/i.test(row.name)
      )
    ) {
      return "companion_nutrient";
    }
    return "generic_line";
  });
};

const determineFormulaMode = (
  rows: ScienceIngredientRow[],
  families: IngredientScienceIngredientFamily[],
): IngredientScienceFormulaMode => {
  const deduped = dedupeIngredientRows(rows);
  const hasOpaqueBlend = deduped.some((row, index) => isBlendLike(row.name, families[index] ?? "generic"));
  if (deduped.length <= 1 && !hasOpaqueBlend) return "single_ingredient";
  if (hasOpaqueBlend) return "blend";
  return "multi_ingredient";
};

const buildRelationshipCandidates = (
  rows: ScienceIngredientRow[],
  families: IngredientScienceIngredientFamily[],
): IngredientScienceRelationshipCandidate[] => {
  const deduped = dedupeIngredientRows(rows);
  const byKey = new Map(deduped.map((row) => [normalizeIngredientScienceKey(row.name), row]));
  const candidates: IngredientScienceRelationshipCandidate[] = [];

  const vitaminCRow = deduped.find((row) => /\bvitamin\s*c\b|\bascorbic\b|\bester\s*c\b/i.test(row.name));
  const zincRow = deduped.find((row) => /\bzinc\b/i.test(row.name));
  if (vitaminCRow && zincRow) {
    candidates.push({
      type: "shared_purpose_pairing",
      ingredients: [vitaminCRow.name, zincRow.name],
      safeStatement: "Vitamin C and zinc are commonly paired in immune-focused formulas.",
    });
  }

  const epaRow =
    deduped.find((row) => /\bepa\b|eicosapentaenoic/i.test(row.name)) ??
    byKey.get("epa") ??
    null;
  const dhaRow =
    deduped.find((row) => /\bdha\b|docosahexaenoic/i.test(row.name)) ??
    byKey.get("dha") ??
    null;
  if (epaRow && dhaRow) {
    candidates.push({
      type: "shared_purpose_pairing",
      ingredients: [epaRow.name, dhaRow.name],
      safeStatement: "EPA and DHA are often listed together in omega-3 products.",
    });
  }

  const blendRows = deduped.filter((row, index) => isBlendLike(row.name, families[index] ?? "generic"));
  if (blendRows.length >= 2) {
    candidates.push({
      type: "formula_composition",
      ingredients: [blendRows[0].name, blendRows[1].name],
      safeStatement: `The formula combines ${blendRows[0].name} with ${blendRows[1].name}.`,
    });
  }

  return candidates.slice(0, 2);
};

const classifyProductArchetype = (params: {
  productName: string;
  dosageForm: string | null | undefined;
  rows: ScienceIngredientRow[];
  families: IngredientScienceIngredientFamily[];
}): IngredientScienceProductArchetype => {
  const productName = normalizeText(params.productName);
  const dosageForm = normalizeText(params.dosageForm);
  const hasHardSupplementLead = params.families.some((family) =>
    family === "5htp" ||
    family === "omega_3" ||
    family === "curcumin" ||
    family === "ashwagandha" ||
    family === "ginseng" ||
    family === "7keto_dhea_metabolite" ||
    family === "cla" ||
    family === "carnitine" ||
    family === "melatonin" ||
    family === "magnesium" ||
    family === "calcium" ||
    family === "zinc" ||
    family === "iron" ||
    family === "vitamin_d" ||
    family === "vitamin_c",
  );
  const hasFoodLikeEligibleFamily = params.families.some((family) =>
    family === "generic" || family === "green_tea_extract" || family === "probiotic_or_blend",
  );
  const genericCount = params.families.filter((family) => family === "generic").length;
  const genericDominant =
    params.rows.length > 0 && genericCount / params.rows.length >= 0.6;
  const titleLooksFoodLike = FUNCTIONAL_FOOD_LIKE_TITLE_PATTERN.test(productName);
  const formLooksFoodLike = FUNCTIONAL_FOOD_LIKE_FORM_PATTERN.test(dosageForm);
  const rowLooksFoodLike = params.rows.some((row) =>
    FUNCTIONAL_FOOD_LIKE_INGREDIENT_PATTERN.test(normalizeText(row.name)),
  );
  const foodLikeTitleDominant =
    GREENS_TITLE_PATTERN.test(productName) ||
    TEA_BAG_TITLE_PATTERN.test(productName) ||
    FOOD_LIKE_POWDER_TITLE_PATTERN.test(productName);
  const snackTitleDominant = OUT_OF_SCOPE_FOOD_SNACK_TITLE_PATTERN.test(productName);
  const functionalGummyContext = FUNCTIONAL_GUMMY_CONTEXT_TITLE_PATTERN.test(productName);
  const strongFoodPresentation = titleLooksFoodLike || formLooksFoodLike || rowLooksFoodLike;
  const definitelyFoodLikeFromTitle =
    titleLooksFoodLike && (formLooksFoodLike || rowLooksFoodLike);

  if (foodLikeTitleDominant || snackTitleDominant || functionalGummyContext) {
    return "functional_food_like";
  }

  if (definitelyFoodLikeFromTitle) {
    return "functional_food_like";
  }

  if (
    strongFoodPresentation
    && (!hasHardSupplementLead || hasFoodLikeEligibleFamily)
    && (genericDominant || hasFoodLikeEligibleFamily || rowLooksFoodLike)
  ) {
    return "functional_food_like";
  }

  return "standard_supplement";
};

export const buildIngredientScienceContext = (params: {
  digest: FactsDigest;
  overlayClaims: OverlayClaimsLike;
}): IngredientScienceContext => {
  const selection = selectScienceIngredientRows({
    digest: params.digest,
    overlayClaims: params.overlayClaims,
  });
  const digestProductName = normalizeText(params.digest?.product?.name);
  const overlayProductTitle = normalizeText(params.overlayClaims?.title);
  const productName =
    Array.from(new Set([digestProductName, overlayProductTitle].filter(Boolean))).join(" ") ||
    "Supplement formula";
  const brandName =
    normalizeText(params.digest?.product?.brandDisplay) ||
    normalizeText(params.digest?.product?.brandLegal) ||
    normalizeText(params.overlayClaims?.brandName) ||
    null;
  const titleRescueRows = deriveScienceTitleRescueRows({
    productName,
    brandName,
    dosageForm: params.digest?.product?.dosageForm ?? null,
    existingRows: selection.ingredientRows,
  });
  const ingredientRows = dedupeIngredientRows([...selection.ingredientRows, ...titleRescueRows]);
  const sourceContext =
    selection.ingredientSourceTier === "overlay_iherb"
      ? "Supplemental product-page label data"
      : "Official record";
  const ingredientFamilies = ingredientRows.map((row) =>
    inferRowIngredientFamily({
      rowName: row.name,
      productName,
    }),
  );
  const productArchetype = classifyProductArchetype({
    productName,
    dosageForm: params.digest?.product?.dosageForm ?? null,
    rows: ingredientRows,
    families: ingredientFamilies,
  });
  const primaryIndex = pickPrimaryActiveRowIndex(ingredientRows, ingredientFamilies, productName);
  const lineRoles = buildLineRoles(ingredientRows, ingredientFamilies, primaryIndex, productName);
  const initialAnchorRow = primaryIndex >= 0 ? ingredientRows[primaryIndex] ?? null : ingredientRows[0] ?? null;
  const ingredientDescriptors = ingredientRows.map((row, index) => {
    const ingredientFamily = ingredientFamilies[index] ?? "generic";
    const lineRole = lineRoles[index] ?? (index === primaryIndex ? "primary_active" : "generic_line");
    return {
      key: normalizeIngredientScienceKey(row.name),
      name: row.name,
      dose: row.dose ?? null,
      ingredientFamily,
      lineRole,
      categoryHint: categoryHintForFamily(ingredientFamily, row.name),
      sourceContext,
      formContext: inferFormContext(row.name, ingredientFamily, lineRole),
      isBlendLike: isBlendLike(row.name, ingredientFamily),
    } satisfies IngredientScienceDescriptor;
  });
  const anchorKey = initialAnchorRow ? normalizeIngredientScienceKey(initialAnchorRow.name) : null;
  const hasStrongLeadActive = hasStrongLeadActiveSignal(ingredientFamilies);
  const hasMineralStackLead = hasMineralStackLeadSignal(ingredientRows, ingredientFamilies, productName);
  const orderedEntries = ingredientRows
    .map((row, index) => ({
      row,
      descriptor: ingredientDescriptors[index]!,
      index,
    }))
    .sort((left, right) => {
      const scoreDiff =
        scoreIngredientDescriptorForDisplay({
          rows: ingredientRows,
          row: right.row,
          descriptor: right.descriptor,
          index: right.index,
          productName,
          anchorKey,
          hasStrongLeadActive,
          hasMineralStackLead,
        }) -
        scoreIngredientDescriptorForDisplay({
          rows: ingredientRows,
          row: left.row,
          descriptor: left.descriptor,
          index: left.index,
          productName,
          anchorKey,
          hasStrongLeadActive,
          hasMineralStackLead,
        });
      if (scoreDiff !== 0) return scoreDiff;
      return left.index - right.index;
    });
  const anchorEntry = orderedEntries[0] ?? null;
  const anchorRow = anchorEntry?.row ?? null;
  const anchorDescriptor = anchorEntry?.descriptor ?? null;
  const finalAnchorKey = anchorRow ? normalizeIngredientScienceKey(anchorRow.name) : anchorKey;
  const orderedIngredientRows = orderedEntries.map((entry) => entry.row);
  const orderedIngredientDescriptors = orderedEntries.map((entry) => entry.descriptor);
  const ingredientSnapshotNames = orderedIngredientRows.map((row) => row.name);
  const formulaMode = determineFormulaMode(ingredientRows, ingredientFamilies);
  const ingredientFamily = inferContextIngredientFamily({
    seedText: anchorRow?.name ?? null,
    productName,
    rows: ingredientRows,
  });
  const hasOpaqueBlend = orderedIngredientDescriptors.some((descriptor) => descriptor.isBlendLike);
  const disclosedDoseCount = orderedIngredientRows.filter((row) => normalizeText(row.dose).length > 0).length;
  const ingredientDisclosureLimited =
    formulaMode === "blend" ||
    orderedIngredientRows.length === 0 ||
    disclosedDoseCount === 0 ||
    (hasOpaqueBlend && disclosedDoseCount < orderedIngredientRows.length);
  const sourceType: IngredientScienceSourceType =
    selection.ingredientSourceTier === "overlay_iherb"
      ? "iherb_overlay"
      : params.digest.sourceType === "dsld"
        ? "dsld"
        : "other";

  return {
    productName,
    productArchetype,
    ingredientSourceTier: selection.ingredientSourceTier,
    sourceType,
    ingredientRows: orderedIngredientRows,
    ingredientSnapshotNames,
    ingredientDescriptors: orderedIngredientDescriptors,
    formulaMode,
    ingredientFamily,
    anchorIngredient: anchorRow
      ? {
          name: anchorRow.name,
          dose: anchorRow.dose ?? null,
          ingredientFamily: anchorDescriptor?.ingredientFamily ?? ingredientFamily,
          lineRole: anchorDescriptor?.lineRole ?? "primary_active",
          categoryHint: anchorDescriptor?.categoryHint ?? categoryHintForFamily(ingredientFamily, anchorRow.name),
          sourceContext,
          formContext: anchorDescriptor?.formContext ?? inferFormContext(anchorRow.name, ingredientFamily, "primary_active"),
        }
      : null,
    coIngredients: orderedIngredientDescriptors
      .filter((row) => row.key !== finalAnchorKey)
      .map((row) => ({
      name: row.name,
      dose: row.dose ?? null,
      ingredientFamily: row.ingredientFamily,
      lineRole: row.lineRole,
      categoryHint: row.categoryHint,
      sourceContext: row.sourceContext,
      formContext: row.formContext,
    })),
    relationshipCandidates: buildRelationshipCandidates(
      orderedIngredientRows,
      orderedIngredientDescriptors.map((descriptor) => descriptor.ingredientFamily),
    ),
    labelConstraints: {
      hasOpaqueBlend,
      ingredientDisclosureLimited,
    },
  };
};
