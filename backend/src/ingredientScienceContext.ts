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
} | null | undefined;

export type IngredientScienceSourceType = "dsld" | "iherb_overlay" | "other";
export type IngredientScienceFormulaMode = "single_ingredient" | "multi_ingredient" | "blend";
export type IngredientScienceProductArchetype = "standard_supplement" | "functional_food_like";
export type IngredientScienceIngredientFamily =
  | "astaxanthin_carotenoid"
  | "curcumin"
  | "turmeric"
  | "coq10"
  | "creatine"
  | "berberine"
  | "nac"
  | "collagen"
  | "protein"
  | "fiber"
  | "electrolyte_hydration"
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
const BIOTIN_TITLE_PATTERN = /\bbiotin\b/i;
const FOLATE_PATTERN = /\bfolate\b|\bfolic\s+acid\b|\bmethylfolate\b|\b5[\s-]*mthf\b/i;
const B6_PATTERN = /\bvitamin\s*b6\b|\bb6\b|\bpyridoxine\b|\bpyridoxal(?:\s|-)?5(?:\s|-)?phosphate\b|\bp-?5-?p\b/i;
const HTP5_PATTERN = /\b5[\s-]*htp\b|\b5[\s-]*hydroxytryptophan\b|\bgriffonia\b/i;
const BCAA_TITLE_PATTERN = /\bbcaas?\b|\bbranched[\s-]*chain\s+amino\s+acids?\b/i;
const RESVERATROL_TITLE_PATTERN = /\b(?:trans[\s-]*)?resveratrol\b/i;
const B3_PATTERN = /\bvitamin\s*b3\b|\bb3\b|\bniacinamide\b|\bniacin\b|\bnicotinamide\b/i;
const GLYCINE_PATTERN = /\bglycine\b/i;
const TAURINE_PATTERN = /\btaurine\b/i;
const INOSITOL_PATTERN = /\b(?:myo[\s-]*)?inositol\b|\bd[\s-]*chiro[\s-]*inositol\b/i;
const SEVEN_KETO_PATTERN = /\b7[\s-]*keto\b|\bacetate[\s-]*7[\s-]*one\b|\bdhea[\s-]*acetate[\s-]*7[\s-]*one\b/i;
const CLA_PATTERN = /\bcla(?:\d+)?\b|\bconjugated\s+linoleic\s+acid\b/i;
const CARNITINE_PATTERN = /\bacetyl[\s-]*l[\s-]*carnitine\b|\bl[\s-]*carnitine\b|\bcarnitine\b|\balcar\b/i;
const CURCUMIN_PATTERN = /\bcurcumin\b|\bcurcuminoids?\b/i;
const TURMERIC_PATTERN = /\bturmeric\b|\bcurcuma\s+longa\b/i;
const CREATINE_PATTERN = /\bcreatine(?:\s+monohydrate)?\b|\bcreapure\b|\bcreatine\s+hcl\b|\bcreatine\s+hydrochloride\b/i;
const BERBERINE_PATTERN = /\bberberine(?:\s+hcl)?\b|\bberberis\b|\bbarberry\b/i;
const NAC_PATTERN = /\bn[\s-]*acetyl[\s-]*cysteine\b|\bnac\b|\bacetylcysteine\b/i;
const COLLAGEN_PATTERN =
  /\bcollagen\b|\bcollagen\s+peptides?\b|\bverisol\b|\bhydroly[sz]ed\s+collagen\b|\btype\s+(?:i|ii|iii|iv|v|1|2|3|4|5)\s+collagen\b/i;
const PROTEIN_PATTERN =
  /\b(?:advanced\s+)?whey(?:\s+(?:isolate|protein))?\b|\bpure\s+whey\b|\bclean\s+whey\b|\b(?:pea|rice|soy|hemp|collagen)\s+protein\b|\bprotein\s+(?:isolate|concentrate|blend|powder)\b/i;
const FIBER_PATTERN = /\b(?:apple|psyllium|acacia|inulin|prebiotic)\s+fiber\b|\bsoluble\s+fiber\b/i;
const ELECTROLYTE_HYDRATION_PATTERN =
  /\bhydrationup\b|\belectrolytes?\+?\b|\belectrolyte\s+(?:drink\s+mix|formula|mix|blend|stack)\b|\bhydrate\s+coconut\s+water\b/i;
const ASHWAGANDHA_PATTERN = /\bashwagandha\b|\bwithania\s+somnifera\b|\bksm-?66\b|\bsensoril\b/i;
const GINSENG_PATTERN = /\bginseng\b|\bpanax\b|\bamerican\s+ginseng\b|\bred\s+ginseng\b/i;
const GREEN_TEA_EXTRACT_PATTERN = /\bgreen\s+tea(?:\s+extract)?\b|\begcg\b|\bcatechins?\b|\bcamellia\s+sinensis\b/i;
const EYE_HEALTH_TITLE_LED_ACTIVE_PATTERN = /\bbilberry\b|\bginkgo\b|\beyebright\b|\blutein\b/i;
const ELDERBERRY_PATTERN = /\belderberry\b|\bsambucus\b/i;
const MAGNESIUM_PATTERN =
  /\bmagnesium\b|\bmagnesium\s+(?:glycinate|citrate|oxide|malate|taurate|threonate|chloride|l-threonate)\b/i;
const CALCIUM_PATTERN =
  /\bcalcium\b|\bcalcium\s+(?:carbonate|citrate|ascorbate|malate|lactate|hydroxyapatite)\b/i;
const IRON_PATTERN = /\biron\b|\bferrous\b|\bferric\b/i;
const POTASSIUM_SUPPLEMENT_PATTERN = /\bpotassium\s+(?:gluconate|citrate|chloride|iodide|bicarbonate)\b/i;
const MELATONIN_PATTERN = /\bmelatonin\b/i;
const COQ10_TITLE_PATTERN = /\bco\s*Q\s*10\b|\bcoq10\b|\bcoenzyme\s+q10\b|\bubiquinol\b|\bubiquinone\b/i;
const BERBERINE_TITLE_PATTERN = /\bberberine\b/i;
const NAC_TITLE_PATTERN = /\bn[\s-]*acetyl[\s-]*cysteine\b|\bnac\b/i;
const CREATINE_TITLE_PATTERN = /\bcreatine(?:\s+monohydrate)?\b|\bcreapure\b/i;
const APPLE_CIDER_VINEGAR_TITLE_PATTERN = /\bapple\s+cider\s+vinegar\b|\bacv\b/i;
const COCONUT_AMINOS_TITLE_PATTERN = /\bcoconut\s+aminos\b|\bsoy\s+sauce\s+replacement\b/i;
const SOY_SAUCE_TITLE_PATTERN = /\btamari\b|\bsoy\s+sauce\b/i;
const FOOD_LIKE_LOZENGE_TITLE_PATTERN = /\bdry\s+mouth\s+lozenges?\b|\blozenges?\s+with\s+xylitol\b/i;
const MATCHA_LATTE_TITLE_PATTERN = /\bmatcha\s+latte\b/i;
const MULTIVITAMIN_DRINK_MIX_TITLE_PATTERN =
  /\b(?:bubbly\s+)?(?:multi[\s-]*vitamin|vitamin)\s+drink\s+mix\b/i;
const ANTIOXIDANT_DRINK_MIX_TITLE_PATTERN =
  /\b(?:daily\s+)?antioxidant(?:\s+\+\s+multi)?\s+drink\s+mix\b|\bphytoberry(?:\s+multi)?\b/i;
const CRISPY_FRUIT_TITLE_PATTERN = /\bcrispy\s+fruit\b|\ball\s+(?:apple|mango)\b/i;
const GUMMY_CANDY_TITLE_PATTERN =
  /\bgummy\s+squares\b|\bgummy\s+bears?\b|\b(?:organic\s+)?jelly\s+beans?\b|\bhealthy\s+sweets\b/i;
const CHOCOLATE_TRUFFLE_TITLE_PATTERN = /\bchocolate\b.*\btruffles?\b|\btruffles?\b/i;
const GREEN_CURRY_PASTE_TITLE_PATTERN = /\bgreen\s+curry\s+paste\b|\bcurry\s+paste\b/i;
const FOOD_LIKE_SALT_TITLE_PATTERN = /\b(?:sea|himalayan|crystal)\s+salt\b/i;
const SOY_MILK_POWDER_TITLE_PATTERN = /\bsoy\s+milk\s+powder\b/i;
const FLAVORED_MILK_DRINK_TITLE_PATTERN = /\bflavored\s+milk\s+drink\b|\bmilk\s+drink\b/i;
const PROTEIN_SNACK_TITLE_PATTERN = /\bprotein\s+(?:bites?|snack\s+mix)\b/i;
const CHOCOLATE_FOOD_TITLE_PATTERN =
  /\bchoco\s+latte\b|\b(?:milk|dark)\s+chocolate\b|\bchocolate\s+bars?\b|\bcandy\s+bars?\b/i;
const LIQUID_AMINOS_TITLE_PATTERN = /\bliquid\s+aminos\b|\bsoy\s+protein\s+seasoning\b/i;
const PROTEIN_BAR_TITLE_PATTERN = /\b(?:protein|collagen)\s+bars?\b|\b(?:crispy\s+)?snack\s+bars?\b/i;
const SOURCE_PROTEIN_TITLE_PATTERN = /\b(?:advanced\s+)?whey(?:\s+(?:isolate|protein))?\b|\bpure\s+whey\b|\bclean\s+whey\b|\bsoy\s+protein\b|\bpea\s+protein\b|\bcollagen\s+protein\b/i;
const COLLAGEN_SUPPLEMENT_TITLE_PATTERN = /\bcollagen(?:30)?\b|\bcollagen\s+peptides?\b|\bverisol\b/i;
const TRAIL_MIX_TITLE_PATTERN = /\btrail\s+mix\b/i;
const ENERGY_DRINK_MIX_TITLE_PATTERN = /\benergy\s+drink\s+mix\b|\benergy\s+mix\b/i;
const ENERGY_CHEWS_TITLE_PATTERN = /\benergy\s+chews?\b/i;
const SEA_MOSS_GEL_TITLE_PATTERN = /\bsea\s+moss\s+gel\b|\bliposomal\s+sea\s+moss\b/i;
const GEL_FUEL_TITLE_PATTERN = /\bgo\s+gel\b|\bendurance\s+gel\b|\benergy\s+gel\b/i;
const ELECTROLYTE_DRINK_MIX_TITLE_PATTERN =
  /\bhydrationup\b|\belectrolytes?\+?\b|\belectrolyte\s+drink\s+mix\b|\belectrolyte\s+(?:formula|mix|blend|stack|mineral\s+stack)\b|\bhydrate\s+coconut\s+water\b/i;
const REDS_SUPERFOOD_TITLE_PATTERN =
  /\breds?\s+pak\b|\bred\s+(?:fruits?|vegetables?)\b/i;
const SPIRULINA_TITLE_PATTERN = /\bspirulina\b/i;
const CHLORELLA_TITLE_PATTERN = /\bchlorella\b/i;
const TRACE_MINERALS_TITLE_PATTERN =
  /\b(?:ionized\s+)?trace\s+minerals?\b|\bcolloidal\s+minerals?\b/i;
const DIGESTIVE_ENZYME_TITLE_PATTERN =
  /\bdigestion\s+enhancement\s+enzymes?\b|\bdigestive\s+enzymes?\b|\benzyme\s+blend\b/i;
const OMEGA3_ALGAL_TITLE_PATTERN =
  /\balgal\s+oil\b|\balgae\s+oil\b|\bfrom\s+algae\b|\bplant\s+based\s+omega\s*-?\s*3\b|\bschizochytrium\b/i;
const FLOWER_ESSENCE_TITLE_PATTERN = /\bflower\s+essence\b/i;
const FUNCTIONAL_FOOD_LIKE_TITLE_PATTERN =
  /\b(?:ag1|athletic\s+greens|gum|gums|gumm(?:y|ies)|mints?|lozenge|lozenges|freeze\s+dried|crispy\s+fruit|juice\s+powder|fruit\s+powder|dragon\s+fruit|smoothie|drink\s+mix|matcha\s+latte|tea\s+bags?|herbal\s+slimming\s+tea|greens\b|green\s+superfood|superfood|vegetable\s+powder|whole\s+food\s+powder|soy\s+milk\s+powder|flavored\s+milk\s+drink|milk\s+drink|snacks?|snackable|crackers?|crisps?|trail\s+mix|energy\s+chews?|protein\s+bites?|protein\s+snack\s+mix|protein\s+bars?|collagen\s+bars?|snack\s+bars?|choco\s+latte|milk\s+chocolate|dark\s+chocolate|chocolate\s+bars?|candy\s+bars?|chocolate\s+truffles?|sea\s+moss\s+gel|coconut\s+aminos|soy\s+sauce\s+replacement|liquid\s+aminos|soy\s+protein\s+seasoning|tamari|soy\s+sauce|curry\s+paste|sea\s+salt|himalayan\s+(?:crystal\s+)?salt|crystal\s+salt|go\s+gel|endurance\s+gel|energy\s+gel)\b/i;
const FUNCTIONAL_FOOD_LIKE_INGREDIENT_PATTERN =
  /\b(?:xylitol|erythritol|fiber|dragon\s+fruit|fruit\s+powder|juice\s+powder|spirulina|chlorella|barley\s+grass|wheat\s+grass|digestive\s+enzyme|enzyme\s+assimilation|greens\b|green\s+superfood|superfood)\b/i;
const FUNCTIONAL_FOOD_LIKE_FORM_PATTERN = /\b(?:gum|gumm(?:y|ies)|mint|lozenge|tea|powder|drink\s*mix|gel)\b/i;
const PROBIOTIC_TITLE_PATTERN =
  /\b(?:probiotics?|pro-bio|probiology|oralbiotic|essential[\s-]*biotic|(?:gut|intestinal|digestive)[\s-]+flora|flora\s+support|live cultures?|cfu|protectis|floraphage|osfortis|cytoflora|acidophilus|bifidus?)\b/i;
const PROBIOTIC_SPECIFIC_ROW_PATTERN =
  /\b(?:probiotic|probiotics|acidophilus|lactobacillus|bifidobacterium|saccharomyces|bacillus|streptococcus|salivarius|limosilactobacillus|reuteri|cfu|live cultures?|protectis|floraphage|osfortis|cytoflora|bacteriophage|bacterial culture|probiotic lysate)\b/i;
const PROBIOTIC_FORMULA_TITLE_PATTERN =
  /\b(?:multi[\s-]*function\s+)?probiotic\s+formula\b|\bpolyflora\b/i;
const PROBIOTIC_FORMULA_FAMILY_ROW_PATTERN =
  /\bprobiotics?\b|\bprobiotic\s+(?:blend|formula)\b/i;
const PROBIOTIC_FORMULA_COMPANION_YEAST_PATTERN =
  /\b(?:brewer'?s|baker'?s)\s+yeast\b|\bsaccharomyces\b/i;
const GREENS_TITLE_PATTERN =
  /\b(?:ag1|athletic\s+greens|greens\b|supergreens?\b|green\s+superfood|green\s+guard|superfood|vegetable\s+powder|whole\s+food\s+powder|daily\s+greens?|greens?\s+(?:powder|blend|formula)|powdered\s+greens?|supergreens?\s+powder)\b/i;
const TEA_BAG_TITLE_PATTERN = /\b(?:tea\s+bags?|herbal\s+tea|slimming\s+tea)\b/i;
const FOOD_LIKE_POWDER_TITLE_PATTERN =
  /\b(?:juice\s+powder|fruit\s+powder|smoothie|drink\s+mix|vegetable\s+powder|greens?\s+powder)\b/i;
const FOOD_LIKE_CONTEXT_ANCHOR_PATTERN =
  /^(?:greens?|green\s+superfood|food(?:\s|-)?based\s+(?:powder|product)|tea\s+blend|superfood\s+greens?|greens?\s+powder)$/i;
const FOOD_LIKE_MACRO_ANCHOR_PATTERN =
  /\b(?:calories|total\s+carbs?|total\s+carbohydrates?|total\s+sugars?|added\s+sugars?|sugar\s+alcohols?|dietary\s+fiber|fiber|sodium|protein|potassium|potas)\b/i;
const FOOD_LIKE_PRODUCT_TITLE_PATTERN =
  /\b(?:ag1|athletic\s+greens|greens?\b|supergreens?\b|green\s+superfood|superfood|juice\s+powder|fruit\s+powder|crispy\s+fruit|vegetable\s+powder|whole\s+food\s+powder|soy\s+milk\s+powder|flavored\s+milk\s+drink|milk\s+drink|drink\s+mix|smoothie|matcha\s+latte|tea\s+bags?|snacks?|snackable|crackers?|crisps?|trail\s+mix|energy\s+chews?|gumm(?:y|ies)|protein\s+bites?|protein\s+snack\s+mix|protein\s+bars?|collagen\s+bars?|snack\s+bars?|choco\s+latte|milk\s+chocolate|dark\s+chocolate|chocolate\s+bars?|candy\s+bars?|chocolate\s+truffles?|sea\s+moss\s+gel|coconut\s+aminos|soy\s+sauce\s+replacement|liquid\s+aminos|soy\s+protein\s+seasoning|tamari|soy\s+sauce|curry\s+paste|sea\s+salt|himalayan\s+(?:crystal\s+)?salt|crystal\s+salt|go\s+gel|endurance\s+gel|energy\s+gel)\b/i;
const PROTEIN_PRODUCT_TITLE_PATTERN = /\bprotein\b|\b(?:advanced\s+)?whey(?:\s+(?:isolate|protein))?\b|\bpure\s+whey\b|\bclean\s+whey\b/i;
const FIBER_PRODUCT_TITLE_PATTERN = /\b(?:apple|psyllium|acacia|inulin|prebiotic)?\s*fiber\b/i;
const ALOE_VERA_TITLE_PATTERN = /\baloe\s+vera\b/i;
const IMMUNE_BLEND_TITLE_PATTERN =
  /\b(?:immune|immunity|sambucus|elderberry|children'?s|chewable)\b/i;
const B_COMPLEX_TITLE_PATTERN =
  /\bb[\s-]*complex\b|\bb[\s-]*vitamins?\b|\bvitamin\s*b\s*complex\b|\bvitamin\s*b\+(?=\s|,|$)/i;
const MULTIVITAMIN_TITLE_PATTERN =
  /\bmulti[\s-]*(?:vitamin|mineral)s?\b|\bmultivitamin\b|\bmultimineral\b|\bmultione\b|\bdaily\s+total\s+one\b|\bsingle\s+daily\s+multiple\b|\bmale\s+multiple\b|\bwhole\s+food\s+based\s+multiple\b|\bladies'?\s+choice\b|\bdaily\s+multi(?:\s+formula)?\b|\bmulti\s+for\s+men\b|\bmulti\s+vitamin\s+energy\b|\b(?:women'?s|men'?s)\s+(?:daily\s+)?multi\b|\bmulti\s+formula\b|\bjust\s+one\s+multi\b|\bmulti\s+with\s+iron\b/i;
const MINIMAL_ESSENTIAL_BROAD_NUTRIENT_TITLE_PATTERN = /\bminimal\s+and\s+essential\b/i;
const BROAD_VITAMIN_MINERAL_ROW_PATTERN =
  /\b(?:vitamin\s*[a-z0-9]*|thiamin|riboflavin|niacin|folate|biotin|pantothenic|calcium|magnesium|zinc|selenium|copper|manganese|chromium|molybdenum|iodine|iron)\b/i;
const JOINT_SUPPORT_TITLE_PATTERN = /\bjoint\s+(?:support|care)\b|\bnem\b|\bno\.?\s*7\b|\bh\.?\s*a\.?\b.*\bjoint\b|\bjoint\b.*\bskin\b/i;
const B_COMPLEX_FORMULA_ROW_PATTERN =
  /\bb[\s-]*complex\b|\bvitamin\s*b\s*complex\b/i;
const MULTIVITAMIN_FORMULA_ROW_PATTERN =
  /\bmulti[\s-]*(?:vitamin|mineral)s?\b|\bmultivitamin\b|\bmultimineral\b/i;
const GENERIC_FORMULA_LINE_PATTERN =
  /\b(?:supplement|nutritional|nutrition(?:al)?|proprietary)\s+formula\b|\bmatrix\b/i;
const ENZYME_SUPPORT_LINE_PATTERN =
  /\b(?:digestive\s+enzyme|enzyme\s+assimilation|cytozymes?|enzyme\s+blend)\b/i;
const NUTRITION_FACTS_MACRO_PATTERN =
  /\b(?:calories|total\s+carbs?|total\s+carbohydrates?|total\s+sugars?|added\s+sugars?|sugar\s+alcohols?|dietary\s+fiber|fiber|sodium)\b/i;
const NON_INGREDIENT_AUDIENCE_ROW_PATTERN = /^(?:men|women|adults?|children|kids?|teens?)$/i;
const BRAND_PREFIX_SEGMENT_PATTERN = /^[a-z0-9][a-z0-9 '&.+-]{1,24}$/i;
const PARAFIGHT_TITLE_PATTERN = /\bpara\s*fight\b/i;
const TART_CHERRY_TITLE_PATTERN = /\btart\s+cherr(?:y|ies)\b/i;
const CRANBERRY_TITLE_PATTERN = /\bcranberry\b|\bultracran\b|\bvaccinium\s+macrocarpon\b/i;
const QUERCETIN_TITLE_PATTERN = /\bquercetin\b/i;
const BROTH_TITLE_PATTERN = /\bbroth\b/i;

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

const normalizeContextualIngredientRow = (
  row: ScienceIngredientRow,
  productName: string,
): ScienceIngredientRow => {
  let name = normalizeText(row.name);
  const dose = normalizeText(row.dose) || null;

  if (/^chewable\s+(calcium|iron)\b/i.test(name)) {
    name = name.replace(/^chewable\s+/i, "");
  }

  if (TRACE_MINERALS_TITLE_PATTERN.test(productName) && /^colloidal\s+minerals?$/i.test(name)) {
    name = extractTitleMatch(productName, TRACE_MINERALS_TITLE_PATTERN) ?? "Trace Minerals";
  }

  if (POTASSIUM_SUPPLEMENT_PATTERN.test(productName) && /^potassium$/i.test(name)) {
    name = extractTitleMatch(productName, POTASSIUM_SUPPLEMENT_PATTERN) ?? "Potassium Gluconate";
  }

  if (hasTitleFamily("omega_3", productName) && /\bpure\s*algae\s*omega\s*3\b|\bpurealgaeomega3\b/i.test(name)) {
    name = name.replace(/\bpure\s*algae\s*omega\s*3\b|\bpurealgaeomega3\b/i, "Omega-3 Algal Oil");
  }

  if (
    OMEGA3_ALGAL_TITLE_PATTERN.test(productName) &&
    /\b(?:omega\s*-?\s*3\s+)?polyunsaturated\s+fat\b|\bomega\s*-?\s*3\s+fatty\s+acids?\b/i.test(name) &&
    !/\balgal\s+oil\b|\balgae\b|\bfish\s*oil\b|\bkrill\s*oil\b/i.test(name)
  ) {
    name = "Omega-3 Algal Oil";
  }

  if (hasTitleFamily("green_tea_extract", productName) && /\bmatcha\b|\bcamellia\s+sinensis\b/i.test(name) && !/\bgreen\s+tea\b/i.test(name)) {
    name = `Green Tea ${name}`;
  }

  if (/^affron\b/i.test(name) && /\bsaffron\b/i.test(name)) {
    name = name.replace(/^affron\s*(?:®|\(r\))?\s*/i, "");
  }

  if (
    /\bglutathione\b/i.test(productName) &&
    /\bglutathione\b/i.test(name) &&
    /\bproprietary\s+blend\b/i.test(name)
  ) {
    name = name.replace(/\s*\([^)]*\bproprietary\s+blend\b[^)]*\)/i, "");
  }

  if (PROBIOTIC_TITLE_PATTERN.test(productName)) {
    if (/^protectis\b/i.test(name) && !/\bprobiotic\b/i.test(name)) {
      name = name.replace(/^protectis\b/i, "Protectis Probiotic");
    } else if (/^osfortis\b/i.test(name) && !/\bprobiotic\b/i.test(name)) {
      name = name.replace(/^osfortis\b/i, "Osfortis Probiotic");
    } else if (/\bfloraphage/i.test(name) && !/\bprobiotic\b/i.test(name)) {
      name = name.replace(/\bfloraphage/i, "Floraphage Probiotic ");
    } else if (/^cytoflora\b/i.test(name) && !/\bprobiotic\b/i.test(name)) {
      name = name.replace(/^cytoflora\b/i, "CytoFlora Probiotic");
    } else if (/^bacterial culture$/i.test(name)) {
      name = "Probiotic Bacterial Culture";
    } else if (/^proprietary blend$/i.test(name)) {
      name = "Probiotic Blend";
    }
  }

  return {
    ...row,
    name: normalizeText(name),
    dose,
  };
};

const normalizeContextualIngredientRows = (
  rows: ScienceIngredientRow[],
  productName: string,
): ScienceIngredientRow[] =>
  dedupeIngredientRows(rows.map((row) => normalizeContextualIngredientRow(row, productName)));

const inferFamilyFromText = (combined: string): IngredientScienceIngredientFamily => {
  if (/astaxanthin|carotenoid/.test(combined)) return "astaxanthin_carotenoid";
  if (CURCUMIN_PATTERN.test(combined)) return "curcumin";
  if (TURMERIC_PATTERN.test(combined)) return "turmeric";
  if (COQ10_TITLE_PATTERN.test(combined)) return "coq10";
  if (CREATINE_PATTERN.test(combined)) return "creatine";
  if (BERBERINE_PATTERN.test(combined)) return "berberine";
  if (NAC_PATTERN.test(combined)) return "nac";
  if (COLLAGEN_PATTERN.test(combined)) return "collagen";
  if (PROTEIN_PATTERN.test(combined)) return "protein";
  if (FIBER_PATTERN.test(combined)) return "fiber";
  if (ELECTROLYTE_HYDRATION_PATTERN.test(combined)) return "electrolyte_hydration";
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
  if (/\bfish\s*oil\b|\bsalmon\s*oil\b|\bomega\s*-?\s*3\b|\bepa\b|\bdha\b|\bkrill\b|\balgal\s*oil\b|\balgae\b|\bplant\s+based\s+omega\s*-?\s*3\b|\bschizochytrium\b/.test(combined)) {
    return "omega_3";
  }
  if (
    /probiotic|lactobacillus|bifidobacterium|saccharomyces|phage/.test(combined) ||
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

  const productText = normalizeText(params.productName);
  if (/^protein$/i.test(rowText) && PROTEIN_PRODUCT_TITLE_PATTERN.test(productText)) return "protein";
  if (/^fiber$/i.test(rowText) && FIBER_PRODUCT_TITLE_PATTERN.test(productText)) return "fiber";

  const rowFamily = inferFamilyFromText(rowText);
  if (rowFamily !== "generic") return rowFamily;

  const normalizedProductText = productText.toLowerCase();
  if (!normalizedProductText) return "generic";

  // Only use product-level hints when the selected row is too generic to classify on its own.
  if (HARD_BLEND_LIKE_PATTERN.test(rowText) || SOFT_BLEND_LIKE_PATTERN.test(rowText)) {
    return inferFamilyFromText(`${rowText} ${normalizedProductText}`);
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
  if (family === "turmeric") return "botanical extract";
  if (family === "coq10") return "coenzyme";
  if (family === "creatine") return "performance compound";
  if (family === "berberine") return "botanical alkaloid";
  if (family === "nac") return "amino acid derivative";
  if (family === "collagen") return "structural protein";
  if (family === "protein") return "protein";
  if (family === "fiber") return "fiber ingredient";
  if (family === "electrolyte_hydration") return "hydration formula";
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
  family === "turmeric" ||
  family === "berberine" ||
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
  if (family === "coq10" && /\bubiquinol\b|\bubiquinone\b/i.test(normalized)) return "coenzyme-form line";
  if (family === "creatine" && /\bmonohydrate\b|\bhcl\b|\bhydrochloride\b|\bkre-?alkalyn\b/i.test(normalized)) {
    return "named form line";
  }
  if (family === "collagen" && /\bmarine\b|\bbovine\b|\bpeptides?\b|\bhydroly[sz]ed\b|\btype\b/i.test(normalized)) {
    return "source/type line";
  }
  if (family === "protein" && /\bwhey\b|\bpea\b|\bsoy\b|\brice\b|\bhemp\b|\bisolate\b|\bconcentrate\b/i.test(normalized)) {
    return "protein-source line";
  }
  if (family === "fiber" && /\bpsyllium\b|\binulin\b|\bacacia\b|\bprebiotic\b|\bsoluble\b/i.test(normalized)) {
    return "fiber-type line";
  }
  if (family === "electrolyte_hydration" && /\bdrink\s+mix\b|\bpowder\b|\bgel\b|\bchews?\b|\belectrolytes?\+?\b/i.test(normalized)) {
    return "hydration-form line";
  }
  if (/\bchelate\b|\bcitrate\b|\bglycinate\b|\bmalate\b|\boxide\b|\btaurate\b|\bthreonate\b/i.test(normalized)) {
    return "named form line";
  }
  if (family === "nac") return "amino-acid derivative line";
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
  "turmeric",
  "coq10",
  "creatine",
  "berberine",
  "nac",
  "collagen",
  "protein",
  "fiber",
  "electrolyte_hydration",
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
  "turmeric",
  "coq10",
  "creatine",
  "berberine",
  "nac",
  "collagen",
  "protein",
  "fiber",
  "electrolyte_hydration",
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
  {
    family: "omega_3",
    pattern: /\bomega\s*-?\s*3\b|\bfish\s*oil\b|\bsalmon\s*oil\b|\bepa\b|\bdha\b|\bkrill\s*oil\b|\balgal\s+oil\b|\balgae\b|\bplant\s+based\s+omega\s*-?\s*3\b|\bschizochytrium\b/i,
  },
  { family: "7keto_dhea_metabolite", pattern: /\b7[\s-]*keto\b/i },
  { family: "curcumin", pattern: /\bcurcumin\b|\bcurcuminoids?\b/i },
  { family: "turmeric", pattern: /\bturmeric\b|\bcurcuma\s+longa\b/i },
  { family: "coq10", pattern: COQ10_TITLE_PATTERN },
  { family: "creatine", pattern: CREATINE_TITLE_PATTERN },
  { family: "berberine", pattern: BERBERINE_TITLE_PATTERN },
  { family: "nac", pattern: NAC_TITLE_PATTERN },
  { family: "collagen", pattern: COLLAGEN_SUPPLEMENT_TITLE_PATTERN },
  { family: "protein", pattern: PROTEIN_PRODUCT_TITLE_PATTERN },
  { family: "fiber", pattern: FIBER_PRODUCT_TITLE_PATTERN },
  { family: "electrolyte_hydration", pattern: ELECTROLYTE_DRINK_MIX_TITLE_PATTERN },
  { family: "ashwagandha", pattern: /\bashwagandha\b/i },
  { family: "ginseng", pattern: /\bginseng\b/i },
  { family: "melatonin", pattern: /\bmelatonin\b/i },
  { family: "magnesium", pattern: /\bmagnesium\b/i },
  { family: "calcium", pattern: /\bcalcium\b/i },
  { family: "zinc", pattern: /\bzinc\b/i },
  { family: "iron", pattern: /\biron\b/i },
  { family: "vitamin_d", pattern: /\bvitamin\s*d\b|\bd3\b|\bd2\b/i },
  { family: "vitamin_c", pattern: /\bvitamin\s*c\b|\bascorbic\b/i },
  {
    family: "probiotic_or_blend",
    pattern: /\bprobiotic|(?:gut|intestinal|digestive)[\s-]+flora|flora\s+support|live cultures?\b/i,
  },
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

const isProbioticFormulaFamilyRow = (rowName: string, productName: string): boolean =>
  PROBIOTIC_FORMULA_TITLE_PATTERN.test(productName) &&
  PROBIOTIC_FORMULA_FAMILY_ROW_PATTERN.test(rowName);

const isProbioticFormulaCompanionYeastRow = (rowName: string, productName: string): boolean =>
  PROBIOTIC_FORMULA_TITLE_PATTERN.test(productName) &&
  PROBIOTIC_FORMULA_COMPANION_YEAST_PATTERN.test(rowName) &&
  !PROBIOTIC_FORMULA_FAMILY_ROW_PATTERN.test(rowName);

const isFoodLikeTitle = (productName: string): boolean => {
  if (FLOWER_ESSENCE_TITLE_PATTERN.test(productName)) return false;
  if (PROBIOTIC_TITLE_PATTERN.test(productName)) return false;
  return (
    FUNCTIONAL_FOOD_LIKE_TITLE_PATTERN.test(productName) ||
    FOOD_LIKE_PRODUCT_TITLE_PATTERN.test(productName) ||
    GREENS_TITLE_PATTERN.test(productName) ||
    TEA_BAG_TITLE_PATTERN.test(productName) ||
    FOOD_LIKE_POWDER_TITLE_PATTERN.test(productName)
  );
};

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

const isFoodLikeLowValueAnchorRow = (
  rowName: string | null | undefined,
  productName: string,
): boolean => {
  const normalizedRow = normalizeText(rowName);
  if (!normalizedRow || !isFoodLikeTitle(productName)) return false;
  if (matchesProductTitle(normalizedRow, productName)) return false;
  if (/\bbiotin\b/i.test(normalizedRow) && /\bbiotin\b/i.test(productName)) return false;
  return /\b(?:glycerin|monounsaturated\s+fat|polyunsaturated\s+fat|total\s+fat|saturated\s+fat|biotin)\b/i.test(normalizedRow);
};

const isLiquidAminosProteinAmountRow = (
  rowName: string | null | undefined,
  productName: string,
): boolean =>
  LIQUID_AMINOS_TITLE_PATTERN.test(productName) &&
  /^soy\s+protein$/i.test(normalizeText(rowName));

const hasTitleRescueContext = (productName: string): boolean =>
  isLeadAloeVeraTitle(productName) ||
  BCAA_TITLE_PATTERN.test(productName) ||
  RESVERATROL_TITLE_PATTERN.test(productName) ||
  CREATINE_TITLE_PATTERN.test(productName) ||
  NAC_TITLE_PATTERN.test(productName) ||
  COQ10_TITLE_PATTERN.test(productName) ||
  BERBERINE_TITLE_PATTERN.test(productName) ||
  hasTitleFamily("turmeric", productName) ||
  COLLAGEN_SUPPLEMENT_TITLE_PATTERN.test(productName) ||
  FIBER_PRODUCT_TITLE_PATTERN.test(productName) ||
  PROTEIN_PRODUCT_TITLE_PATTERN.test(productName) ||
  SOURCE_PROTEIN_TITLE_PATTERN.test(productName) ||
  POTASSIUM_SUPPLEMENT_PATTERN.test(productName) ||
  COCONUT_AMINOS_TITLE_PATTERN.test(productName) ||
  SOY_SAUCE_TITLE_PATTERN.test(productName) ||
  FOOD_LIKE_LOZENGE_TITLE_PATTERN.test(productName) ||
  MATCHA_LATTE_TITLE_PATTERN.test(productName) ||
  MULTIVITAMIN_DRINK_MIX_TITLE_PATTERN.test(productName) ||
  CRISPY_FRUIT_TITLE_PATTERN.test(productName) ||
  GUMMY_CANDY_TITLE_PATTERN.test(productName) ||
  CHOCOLATE_TRUFFLE_TITLE_PATTERN.test(productName) ||
  GREEN_CURRY_PASTE_TITLE_PATTERN.test(productName) ||
  FOOD_LIKE_SALT_TITLE_PATTERN.test(productName) ||
  SOY_MILK_POWDER_TITLE_PATTERN.test(productName) ||
  FLAVORED_MILK_DRINK_TITLE_PATTERN.test(productName) ||
  PROTEIN_SNACK_TITLE_PATTERN.test(productName) ||
  CHOCOLATE_FOOD_TITLE_PATTERN.test(productName) ||
  LIQUID_AMINOS_TITLE_PATTERN.test(productName) ||
  PROTEIN_BAR_TITLE_PATTERN.test(productName) ||
  ENERGY_DRINK_MIX_TITLE_PATTERN.test(productName) ||
  ENERGY_CHEWS_TITLE_PATTERN.test(productName) ||
  SEA_MOSS_GEL_TITLE_PATTERN.test(productName) ||
  GEL_FUEL_TITLE_PATTERN.test(productName) ||
  ELECTROLYTE_DRINK_MIX_TITLE_PATTERN.test(productName) ||
  REDS_SUPERFOOD_TITLE_PATTERN.test(productName) ||
  SPIRULINA_TITLE_PATTERN.test(productName) ||
  CHLORELLA_TITLE_PATTERN.test(productName) ||
  TRACE_MINERALS_TITLE_PATTERN.test(productName) ||
  DIGESTIVE_ENZYME_TITLE_PATTERN.test(productName) ||
  PARAFIGHT_TITLE_PATTERN.test(productName);

const isLeadAloeVeraTitle = (productName: string): boolean => {
  const normalizedTitle = normalizeText(productName);
  if (/^aloe\s+vera\b/i.test(normalizedTitle)) return true;
  const titleWithoutBrand = normalizeText(normalizedTitle.replace(/^[^,]{1,40},\s*/, ""));
  return /^aloe\s+vera\b/i.test(titleWithoutBrand);
};

const getTitleLedBotanicalPattern = (productName: string): RegExp | null => {
  const titleWithoutBrand = normalizeText(productName.replace(/^[^,]{1,40},\s*/, ""));
  if (/\bechinacea\b/i.test(titleWithoutBrand) && /\bgoldenseal\b/i.test(titleWithoutBrand)) {
    return /\bechinacea\b|\bgoldenseal\b/i;
  }
  if (/\blemon balm\b|\bmelissa\b/i.test(titleWithoutBrand)) {
    return /\blemon balm\b|\bmelissa\b/i;
  }
  const saffronIndex = titleWithoutBrand.search(/\bsaffron\b/i);
  const ashwagandhaIndex = titleWithoutBrand.search(/\bashwagandha\b/i);
  if (saffronIndex >= 0 && (ashwagandhaIndex < 0 || saffronIndex < ashwagandhaIndex)) {
    return /\bsaffron\b|\bcrocus\s+sativus\b/i;
  }
  if (EYE_HEALTH_TITLE_LED_ACTIVE_PATTERN.test(titleWithoutBrand)) {
    return EYE_HEALTH_TITLE_LED_ACTIVE_PATTERN;
  }
  return null;
};

const isTitleLedBotanicalAnchorRow = (
  rowName: string | null | undefined,
  productName: string,
): boolean => {
  const botanicalPattern = getTitleLedBotanicalPattern(productName);
  return botanicalPattern ? botanicalPattern.test(normalizeText(rowName)) : false;
};

const isTitleLedBotanicalSolventRow = (
  rowName: string | null | undefined,
  productName: string,
): boolean => {
  if (!getTitleLedBotanicalPattern(productName)) return false;
  return /^(?:alcohol|filtered water|water|vegetable glycerin|glycerin)$/i.test(normalizeText(rowName));
};

const isTitleRescueAnchorRow = (
  rowName: string | null | undefined,
  productName: string,
): boolean => {
  const normalizedRow = normalizeText(rowName);
  return (
    (isLeadAloeVeraTitle(productName) && ALOE_VERA_TITLE_PATTERN.test(normalizedRow)) ||
    (BCAA_TITLE_PATTERN.test(productName) && BCAA_TITLE_PATTERN.test(normalizedRow)) ||
    (RESVERATROL_TITLE_PATTERN.test(productName) && RESVERATROL_TITLE_PATTERN.test(normalizedRow)) ||
    (TART_CHERRY_TITLE_PATTERN.test(productName) && TART_CHERRY_TITLE_PATTERN.test(normalizedRow)) ||
    (QUERCETIN_TITLE_PATTERN.test(productName) && QUERCETIN_TITLE_PATTERN.test(normalizedRow)) ||
    (FIBER_PRODUCT_TITLE_PATTERN.test(productName) && /\bfiber\b/i.test(normalizedRow)) ||
    (PROTEIN_PRODUCT_TITLE_PATTERN.test(productName) && /\bprotein\b/i.test(normalizedRow)) ||
    (POTASSIUM_SUPPLEMENT_PATTERN.test(productName) && POTASSIUM_SUPPLEMENT_PATTERN.test(normalizedRow)) ||
    (
      BROTH_TITLE_PATTERN.test(productName) &&
      /\bbroth\b|\bherbal\s+broth\b/i.test(normalizedRow)
    ) ||
    (
      COCONUT_AMINOS_TITLE_PATTERN.test(productName) &&
      /\bcoconut\s+aminos\b|\bsoy\s+sauce\s+replacement\b|\bseasoning\b/i.test(normalizedRow)
    ) ||
    (
      SOY_SAUCE_TITLE_PATTERN.test(productName) &&
      /\btamari\b|\bsoy\s+sauce\b|\bseasoning\b/i.test(normalizedRow)
    ) ||
    (
      FOOD_LIKE_LOZENGE_TITLE_PATTERN.test(productName) &&
      /\bdry\s+mouth\s+lozenges?\b|\blozenges?\b|\bxylitol\s+lozenges?\b/i.test(normalizedRow)
    ) ||
    (
      MATCHA_LATTE_TITLE_PATTERN.test(productName) &&
      /\bmatcha\s+latte\b|\bmatcha\b/i.test(normalizedRow)
    ) ||
    (
      MULTIVITAMIN_DRINK_MIX_TITLE_PATTERN.test(productName) &&
      /\b(?:bubbly\s+)?(?:multi[\s-]*vitamin|vitamin)\s+drink\s+mix\b|\bdrink\s+mix\b/i.test(normalizedRow)
    ) ||
    (
      CRISPY_FRUIT_TITLE_PATTERN.test(productName) &&
      /\bcrispy\s+fruit\b|\bfruit\s+snacks?\b|\ball\s+(?:apple|mango)\b/i.test(normalizedRow)
    ) ||
    (
      GUMMY_CANDY_TITLE_PATTERN.test(productName) &&
      /\bgummy\s+squares\b|\bgummy\s+bears?\b|\b(?:organic\s+)?jelly\s+beans?\b|\bhealthy\s+sweets\b/i.test(normalizedRow)
    ) ||
    (
      CHOCOLATE_TRUFFLE_TITLE_PATTERN.test(productName) &&
      /\bchocolate\s+truffles?\b|\btruffles?\b|\bchocolate\b/i.test(normalizedRow)
    ) ||
    (
      GREEN_CURRY_PASTE_TITLE_PATTERN.test(productName) &&
      /\bgreen\s+curry\s+paste\b|\bcurry\s+paste\b/i.test(normalizedRow)
    ) ||
    (
      FOOD_LIKE_SALT_TITLE_PATTERN.test(productName) &&
      /\b(?:sea|himalayan|crystal)\s+salt\b|\bsalt\b/i.test(normalizedRow)
    ) ||
    (
      SOY_MILK_POWDER_TITLE_PATTERN.test(productName) &&
      /\bsoy\s+milk\s+powder\b|\bsoy\s+milk\b/i.test(normalizedRow)
    ) ||
    (
      FLAVORED_MILK_DRINK_TITLE_PATTERN.test(productName) &&
      /\bflavored\s+milk\s+drink\b|\bmilk\s+drink\b/i.test(normalizedRow)
    ) ||
    (
      PROTEIN_SNACK_TITLE_PATTERN.test(productName) &&
      /\bprotein\s+(?:bites?|snack\s+mix)\b/i.test(normalizedRow)
    ) ||
    (
      CHOCOLATE_FOOD_TITLE_PATTERN.test(productName) &&
      /\bchoco\s+latte\b|\b(?:milk|dark)\s+chocolate\b|\bchocolate\s+bars?\b|\bcandy\s+bars?\b/i.test(normalizedRow)
    ) ||
    (
      LIQUID_AMINOS_TITLE_PATTERN.test(productName) &&
      /\bliquid\s+aminos\b|\bsoy\s+protein\s+seasoning\b/i.test(normalizedRow)
    ) ||
    (
      PROTEIN_BAR_TITLE_PATTERN.test(productName) &&
      /\bprotein\s+bars?\b|\bcollagen\s+bars?\b|\b(?:crispy\s+)?snack\s+bars?\b/i.test(normalizedRow)
    ) ||
    (
      ENERGY_DRINK_MIX_TITLE_PATTERN.test(productName) &&
      /\benergy\s+drink\s+mix\b|\bdrink\s+mix\b|\benergy\s+mix\b/i.test(normalizedRow)
    ) ||
    (
      ENERGY_CHEWS_TITLE_PATTERN.test(productName) &&
      /\benergy\s+chews?\b|\bchews?\b/i.test(normalizedRow)
    ) ||
    (
      SEA_MOSS_GEL_TITLE_PATTERN.test(productName) &&
      /\bsea\s+moss\s+gel\b|\bsea\s+moss\b|\bgel\b/i.test(normalizedRow)
    ) ||
    (
      GEL_FUEL_TITLE_PATTERN.test(productName) &&
      /\bgo\s+gel\b|\bendurance\s+gel\b|\benergy\s+gel\b|\bgel\b/i.test(normalizedRow)
    ) ||
    (
      ELECTROLYTE_DRINK_MIX_TITLE_PATTERN.test(productName) &&
      /\bhydrationup\b|\belectrolyte\s+drink\s+mix\b|\belectrolyte\s+(?:formula|mix|blend|stack|mineral\s+stack)\b|\belectrolytes?\+?\b|\bhydrate\s+coconut\s+water\b|\belectrolyte\b/i.test(normalizedRow)
    ) ||
    (
      REDS_SUPERFOOD_TITLE_PATTERN.test(productName) &&
      /\bblend\b/i.test(normalizedRow) &&
      !/\bvitamin\b|\bpotassium\b|\bcalcium\b|\bsodium\b|\bcalories\b|\bsugars?\b/i.test(normalizedRow)
    ) ||
    (SPIRULINA_TITLE_PATTERN.test(productName) && SPIRULINA_TITLE_PATTERN.test(normalizedRow)) ||
    (CHLORELLA_TITLE_PATTERN.test(productName) && CHLORELLA_TITLE_PATTERN.test(normalizedRow)) ||
    (
      TRACE_MINERALS_TITLE_PATTERN.test(productName) &&
      /\b(?:ionized\s+)?trace\s+minerals?\b|\bcolloidal\s+minerals?\b/i.test(normalizedRow)
    ) ||
    (
      DIGESTIVE_ENZYME_TITLE_PATTERN.test(productName) &&
      /\bdigestive\s+enzymes?\b|\benzyme\s+blend\b/i.test(normalizedRow)
    ) ||
    (
      PARAFIGHT_TITLE_PATTERN.test(productName) &&
      /\bpara\s*fight\b|\bintestinal\s+support\b|\bherbal\s+blend\b/i.test(normalizedRow)
    ) ||
    (
      JOINT_SUPPORT_TITLE_PATTERN.test(productName) &&
      /\bjoint\s+(?:support|care)\b|\bnem\b|\beggshell\s+membrane\b|\bcollagen\b|\bcartilage\b|\bno\.?\s*7\b/i.test(normalizedRow)
    )
  );
};

const isTitleRescueMacroRow = (
  rowName: string | null | undefined,
  productName: string,
): boolean =>
  hasTitleRescueContext(productName) &&
  FOOD_LIKE_MACRO_ANCHOR_PATTERN.test(normalizeText(rowName)) &&
  !matchesProductTitle(normalizeText(rowName), productName);

const isNonZincCompanionInZincTitle = (
  family: IngredientScienceIngredientFamily,
  rowName: string,
  productName: string,
): boolean =>
  hasTitleFamily("zinc", productName) &&
  family !== "zinc" &&
  !(family === "probiotic_or_blend" && isProbioticLedZincCompanionTitle(productName)) &&
  (
    family === "vitamin_c" ||
    family === "vitamin_d" ||
    family === "calcium" ||
    family === "magnesium" ||
    family === "probiotic_or_blend" ||
    ELDERBERRY_PATTERN.test(rowName)
  );

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

const hasNamedTitleAlignedRow = (
  rows: ScienceIngredientRow[],
  pattern: RegExp,
): boolean =>
  rows.some((row) => {
    const normalizedName = normalizeText(row.name);
    if (!pattern.test(normalizedName)) return false;
    if (HARD_BLEND_LIKE_PATTERN.test(normalizedName)) return false;
    if (/^alcohol$/i.test(normalizedName)) return false;
    return true;
  });

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
  const titleWithBrandContext = normalizeText(`${params.brandName ?? ""} ${titleWithoutBrand} ${productName}`);
  const existingFamilies = params.existingRows.map((row) =>
    inferRowIngredientFamily({
      rowName: row.name,
      productName: titleWithoutBrand,
    }),
  );
  const hasDedicatedFamilyRow = (family: IngredientScienceIngredientFamily): boolean =>
    params.existingRows.some((row) => {
      const rowFamily = inferRowIngredientFamily({
        rowName: row.name,
        productName: titleWithoutBrand,
      });
      if (rowFamily !== family) return false;
      if (isBlendLike(row.name, rowFamily)) return false;
      if (HARD_BLEND_LIKE_PATTERN.test(row.name)) return false;
      return true;
    });
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

  if (BCAA_TITLE_PATTERN.test(titleWithoutBrand)) {
    pushRow(extractTitleMatch(titleWithoutBrand, BCAA_TITLE_PATTERN) ?? "BCAA");
  }

  if (RESVERATROL_TITLE_PATTERN.test(titleWithoutBrand)) {
    pushRow(extractTitleMatch(titleWithoutBrand, RESVERATROL_TITLE_PATTERN) ?? "Resveratrol");
  }

  if (hasTitleFamily("turmeric", titleWithoutBrand) && !hasDedicatedFamilyRow("turmeric")) {
    pushRow(extractTitleMatch(titleWithoutBrand, /\bturmeric\b|\bcurcuma\s+longa\b/i) ?? "Turmeric");
  }

  if (CREATINE_TITLE_PATTERN.test(titleWithoutBrand) && !hasDedicatedFamilyRow("creatine")) {
    pushRow(extractTitleMatch(titleWithoutBrand, CREATINE_TITLE_PATTERN) ?? "Creatine");
  }

  if (NAC_TITLE_PATTERN.test(titleWithoutBrand) && !hasDedicatedFamilyRow("nac")) {
    pushRow(extractTitleMatch(titleWithoutBrand, /\bn[\s-]*acetyl[\s-]*cysteine\b|\bnac\b/i) ?? "N-Acetyl-Cysteine");
  }

  if (hasTitleFamily("carnitine", titleWithoutBrand) && !hasDedicatedFamilyRow("carnitine")) {
    pushRow(
      extractTitleMatch(
        titleWithoutBrand,
        /\b(?:acetyl[\s-]*)?l[\s-]*carnitine(?:\s*\+\s*tartrate)?\b/i,
      ) ?? "L-Carnitine",
    );
  }

  if (hasTitleFamily("cla", titleWithoutBrand) && !hasDedicatedFamilyRow("cla")) {
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

  if (
    MINIMAL_ESSENTIAL_BROAD_NUTRIENT_TITLE_PATTERN.test(titleWithoutBrand) &&
    params.existingRows.filter((row) => BROAD_VITAMIN_MINERAL_ROW_PATTERN.test(row.name)).length >= 4
  ) {
    pushRow("Multivitamin & Mineral Formula");
  }

  if (PARAFIGHT_TITLE_PATTERN.test(titleWithoutBrand)) {
    pushRow("ParaFight Herbal Blend");
  }

  if (
    TART_CHERRY_TITLE_PATTERN.test(titleWithoutBrand) &&
    !hasNamedTitleAlignedRow(params.existingRows, TART_CHERRY_TITLE_PATTERN)
  ) {
    pushRow(extractTitleMatch(titleWithoutBrand, TART_CHERRY_TITLE_PATTERN) ?? "Tart Cherry");
  }

  if (
    CRANBERRY_TITLE_PATTERN.test(titleWithoutBrand) &&
    !hasNamedTitleAlignedRow(params.existingRows, CRANBERRY_TITLE_PATTERN)
  ) {
    pushRow("Cranberry");
  }

  if (
    QUERCETIN_TITLE_PATTERN.test(titleWithoutBrand) &&
    !hasNamedTitleAlignedRow(params.existingRows, QUERCETIN_TITLE_PATTERN)
  ) {
    pushRow(extractTitleMatch(titleWithoutBrand, QUERCETIN_TITLE_PATTERN) ?? "Quercetin");
  }

  if (
    JOINT_SUPPORT_TITLE_PATTERN.test(titleWithoutBrand) &&
    !hasNamedTitleAlignedRow(params.existingRows, /\bjoint\s+(?:support|care)\b|\bnem\b|\beggshell\s+membrane\b|\bcollagen\b|\bcartilage\b/i)
  ) {
    pushRow("Joint Support Complex");
  }

  if (hasTitleFamily("vitamin_c", titleWithoutBrand) && !hasDedicatedFamilyRow("vitamin_c")) {
    pushRow(extractTitleMatch(titleWithoutBrand, /\b(?:liposomal\s+)?vitamin\s*c\b|\bascorbic\s+acid\b/i) ?? "Vitamin C");
  }

  const hasDedicatedElderberryRow = params.existingRows.some((row) => isDedicatedElderberryRow(row.name));
  if (ELDERBERRY_PATTERN.test(titleWithBrandContext) && !hasDedicatedElderberryRow) {
    pushRow(/\belderberry\b/i.test(titleWithoutBrand) ? "Elderberry" : "Sambucus elderberry");
  }

  if (
    /\bechinacea\b/i.test(titleWithoutBrand) &&
    /\bgoldenseal\b/i.test(titleWithoutBrand) &&
    !hasNamedTitleAlignedRow(params.existingRows, /\bechinacea\b|\bgoldenseal\b/i)
  ) {
    pushRow("Echinacea Goldenseal");
  }

  if (
    /\blemon balm\b|\bmelissa\b/i.test(titleWithoutBrand) &&
    !hasNamedTitleAlignedRow(params.existingRows, /\blemon balm\b|\bmelissa\b/i)
  ) {
    pushRow("Lemon Balm");
  }

  if (
    EYE_HEALTH_TITLE_LED_ACTIVE_PATTERN.test(titleWithoutBrand) &&
    !hasNamedTitleAlignedRow(params.existingRows, EYE_HEALTH_TITLE_LED_ACTIVE_PATTERN)
  ) {
    pushRow(extractTitleMatch(titleWithoutBrand, EYE_HEALTH_TITLE_LED_ACTIVE_PATTERN) ?? "Bilberry");
  }

  if (
    DIGESTIVE_ENZYME_TITLE_PATTERN.test(titleWithoutBrand) &&
    !hasNamedTitleAlignedRow(params.existingRows, /\bdigestive\s+enzymes?\b|\benzyme\s+blend\b/i)
  ) {
    pushRow("Digestive Enzyme Blend");
  }

  if (
    SPIRULINA_TITLE_PATTERN.test(titleWithoutBrand) &&
    !hasNamedTitleAlignedRow(params.existingRows, SPIRULINA_TITLE_PATTERN)
  ) {
    pushRow("Spirulina");
  }

  if (
    CHLORELLA_TITLE_PATTERN.test(titleWithoutBrand) &&
    !hasNamedTitleAlignedRow(params.existingRows, CHLORELLA_TITLE_PATTERN)
  ) {
    pushRow("Chlorella");
  }

  if (
    TRACE_MINERALS_TITLE_PATTERN.test(titleWithoutBrand) &&
    !hasNamedTitleAlignedRow(params.existingRows, TRACE_MINERALS_TITLE_PATTERN)
  ) {
    pushRow(extractTitleMatch(titleWithoutBrand, TRACE_MINERALS_TITLE_PATTERN) ?? "Trace Minerals");
  }

  const hasDedicatedOmega3SourceRow = params.existingRows.some((row) =>
    /\bfish\s+oil\b|\bsalmon\s+oil\b|\bkrill\s+oil\b|\balgal\s+oil\b|\balgae\b|\bplant\s+based\s+omega\s*-?\s*3\b|\bschizochytrium\b/i.test(
      row.name,
    ),
  );
  if (hasTitleFamily("omega_3", titleWithoutBrand) && !hasDedicatedOmega3SourceRow) {
    if (OMEGA3_ALGAL_TITLE_PATTERN.test(titleWithoutBrand)) {
      pushRow("Algal Oil");
    } else if (/\bkrill\s+oil\b/i.test(titleWithoutBrand)) {
      pushRow("Krill Oil");
    } else if (/\bsalmon\s+oil\b/i.test(titleWithoutBrand)) {
      pushRow("Salmon Oil");
    } else {
      pushRow(
        extractTitleMatch(titleWithoutBrand, /\bomega[\s-]*3\b|\bfish oil\b|\bsalmon oil\b|\bepa\b|\bdha\b/i) ?? "Omega-3",
      );
    }
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
  const hasBiotinTitleActiveCoverage =
    BIOTIN_TITLE_PATTERN.test(titleWithoutBrand) &&
    params.existingRows.some((row) => BIOTIN_TITLE_PATTERN.test(row.name));

  if (
    titleMineralFamilies.includes("calcium") &&
    titleMineralFamilies.includes("magnesium") &&
    !params.existingRows.some((row) => /\bcalcium\b/i.test(row.name) && /\bmagnesium\b/i.test(row.name))
  ) {
    pushRow("Calcium Magnesium Mineral Stack");
  }

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

  const titleOnlyLooksGreens = GREENS_TITLE_PATTERN.test(titleWithoutBrand);
  const brandContextLooksGreens = GREENS_TITLE_PATTERN.test(titleWithBrandContext);
  const isFoodLikeTitle =
    !FLOWER_ESSENCE_TITLE_PATTERN.test(titleWithBrandContext) &&
    (
      brandContextLooksGreens ||
      TEA_BAG_TITLE_PATTERN.test(titleWithoutBrand) ||
      FOOD_LIKE_POWDER_TITLE_PATTERN.test(titleWithoutBrand) ||
      FOOD_LIKE_PRODUCT_TITLE_PATTERN.test(titleWithBrandContext) ||
      FUNCTIONAL_FOOD_LIKE_FORM_PATTERN.test(normalizeText(params.dosageForm))
    );

  if (titleOnlyLooksGreens) {
    pushRow("Greens");
  } else if (BROTH_TITLE_PATTERN.test(titleWithoutBrand)) {
    pushRow(extractTitleMatch(titleWithoutBrand, /\b(?:earth\s+)?broth\b/i) ?? "Herbal Broth Blend");
  } else if (TEA_BAG_TITLE_PATTERN.test(titleWithoutBrand)) {
    pushRow("Tea blend");
  } else if (COCONUT_AMINOS_TITLE_PATTERN.test(titleWithoutBrand)) {
    pushRow(
      extractTitleMatch(titleWithoutBrand, /\bcoconut\s+aminos\b|\bsoy\s+sauce\s+replacement\b/i) ??
        "Coconut Aminos",
    );
  } else if (SOY_SAUCE_TITLE_PATTERN.test(titleWithoutBrand)) {
    pushRow(extractTitleMatch(titleWithoutBrand, /\btamari(?:\s+brewed)?\s+soy\s+sauce\b|\btamari\b|\bsoy\s+sauce\b/i) ?? "Soy Sauce");
  } else if (FOOD_LIKE_LOZENGE_TITLE_PATTERN.test(titleWithoutBrand)) {
    pushRow(extractTitleMatch(titleWithoutBrand, /\bdry\s+mouth\s+lozenges?\b|\blozenges?\s+with\s+xylitol\b|\blozenges?\b/i) ?? "Lozenges");
  } else if (MATCHA_LATTE_TITLE_PATTERN.test(titleWithoutBrand)) {
    pushRow(extractTitleMatch(titleWithoutBrand, MATCHA_LATTE_TITLE_PATTERN) ?? "Matcha Latte");
  } else if (MULTIVITAMIN_DRINK_MIX_TITLE_PATTERN.test(titleWithoutBrand)) {
    pushRow(
      extractTitleMatch(titleWithoutBrand, MULTIVITAMIN_DRINK_MIX_TITLE_PATTERN) ??
        "Multi-Vitamin Drink Mix",
    );
  } else if (ANTIOXIDANT_DRINK_MIX_TITLE_PATTERN.test(titleWithoutBrand)) {
    pushRow(
      extractTitleMatch(titleWithoutBrand, ANTIOXIDANT_DRINK_MIX_TITLE_PATTERN) ??
        "Antioxidant Drink Mix",
    );
  } else if (CRISPY_FRUIT_TITLE_PATTERN.test(titleWithoutBrand)) {
    pushRow(extractTitleMatch(titleWithoutBrand, /\bcrispy\s+fruit\b|\ball\s+(?:apple|mango)\b/i) ?? "Crispy Fruit");
  } else if (APPLE_CIDER_VINEGAR_TITLE_PATTERN.test(titleWithoutBrand)) {
    pushRow(extractTitleMatch(titleWithoutBrand, APPLE_CIDER_VINEGAR_TITLE_PATTERN) ?? "Apple Cider Vinegar");
  } else if (BERBERINE_TITLE_PATTERN.test(titleWithoutBrand)) {
    pushRow(extractTitleMatch(titleWithoutBrand, BERBERINE_TITLE_PATTERN) ?? "Berberine");
  } else if (COQ10_TITLE_PATTERN.test(titleWithoutBrand)) {
    pushRow(extractTitleMatch(titleWithoutBrand, COQ10_TITLE_PATTERN) ?? "Coenzyme Q10");
  } else if (
    COLLAGEN_SUPPLEMENT_TITLE_PATTERN.test(titleWithoutBrand) &&
    !PROTEIN_BAR_TITLE_PATTERN.test(titleWithoutBrand)
  ) {
    pushRow(extractTitleMatch(titleWithoutBrand, /\bcollagen(?:30)?\b|\bcollagen\s+peptides?\b|\bverisol\b/i) ?? "Collagen Peptides");
  } else if (CRANBERRY_TITLE_PATTERN.test(titleWithoutBrand)) {
    pushRow(extractTitleMatch(titleWithoutBrand, /\bcranberry\b|\bultracran\b/i) ?? "Cranberry");
  } else if (GUMMY_CANDY_TITLE_PATTERN.test(titleWithoutBrand)) {
    pushRow(
      extractTitleMatch(
        titleWithoutBrand,
        /\bgummy\s+squares\b|\bgummy\s+bears?\b|\b(?:organic\s+)?jelly\s+beans?\b/i,
      ) ?? "Gummy Squares",
    );
  } else if (CHOCOLATE_TRUFFLE_TITLE_PATTERN.test(titleWithoutBrand)) {
    pushRow(extractTitleMatch(titleWithoutBrand, /\bchocolate\s+truffles?\b|\btruffles?\b/i) ?? "Chocolate Truffles");
  } else if (GREEN_CURRY_PASTE_TITLE_PATTERN.test(titleWithoutBrand)) {
    pushRow(extractTitleMatch(titleWithoutBrand, /\bgreen\s+curry\s+paste\b|\bcurry\s+paste\b/i) ?? "Curry Paste");
  } else if (SOY_MILK_POWDER_TITLE_PATTERN.test(titleWithoutBrand)) {
    pushRow(extractTitleMatch(titleWithoutBrand, SOY_MILK_POWDER_TITLE_PATTERN) ?? "Soy Milk Powder");
  } else if (FLAVORED_MILK_DRINK_TITLE_PATTERN.test(titleWithoutBrand)) {
    pushRow(extractTitleMatch(titleWithoutBrand, FLAVORED_MILK_DRINK_TITLE_PATTERN) ?? "Flavored Milk Drink");
  } else if (PROTEIN_SNACK_TITLE_PATTERN.test(titleWithoutBrand)) {
    pushRow(extractTitleMatch(titleWithoutBrand, PROTEIN_SNACK_TITLE_PATTERN) ?? "Protein Snack");
  } else if (PROTEIN_BAR_TITLE_PATTERN.test(titleWithoutBrand)) {
    pushRow(
      extractTitleMatch(titleWithoutBrand, /\b(?:protein|collagen)\s+bars?\b|\b(?:crispy\s+)?snack\s+bars?\b/i) ??
        "Snack Bar",
    );
  } else if (CHOCOLATE_FOOD_TITLE_PATTERN.test(titleWithoutBrand)) {
    pushRow(extractTitleMatch(titleWithoutBrand, CHOCOLATE_FOOD_TITLE_PATTERN) ?? "Chocolate Bar");
  } else if (LIQUID_AMINOS_TITLE_PATTERN.test(titleWithoutBrand)) {
    pushRow(extractTitleMatch(titleWithoutBrand, LIQUID_AMINOS_TITLE_PATTERN) ?? "Liquid Aminos");
  } else if (FOOD_LIKE_SALT_TITLE_PATTERN.test(titleWithoutBrand)) {
    pushRow(extractTitleMatch(titleWithoutBrand, /\b(?:sea|himalayan|crystal)\s+salt\b/i) ?? "Salt");
  } else if (SOURCE_PROTEIN_TITLE_PATTERN.test(titleWithoutBrand)) {
    pushRow(
      extractTitleMatch(titleWithoutBrand, /\b(?:pure\s+)?whey\s+isolate\b|\bclean\s+whey\s+protein\b|\badvanced\s+whey\b|\bwhey\s+protein\b|\bwhey\b|\bsoy\s+protein\b|\bpea\s+protein\b|\bcollagen\s+protein\b/i) ??
        "Whey Protein",
    );
  } else if (TRAIL_MIX_TITLE_PATTERN.test(titleWithoutBrand)) {
    pushRow(extractTitleMatch(titleWithoutBrand, TRAIL_MIX_TITLE_PATTERN) ?? "Trail Mix");
  } else if (ENERGY_DRINK_MIX_TITLE_PATTERN.test(titleWithoutBrand)) {
    pushRow(
      extractTitleMatch(titleWithoutBrand, /\benergy\s+drink\s+mix\b|\benergy\s+mix\b/i) ??
        "Energy Drink Mix",
    );
  } else if (ENERGY_CHEWS_TITLE_PATTERN.test(titleWithoutBrand)) {
    pushRow(extractTitleMatch(titleWithoutBrand, ENERGY_CHEWS_TITLE_PATTERN) ?? "Energy Chews");
  } else if (SEA_MOSS_GEL_TITLE_PATTERN.test(titleWithoutBrand)) {
    pushRow(
      extractTitleMatch(titleWithoutBrand, /\b(?:liposomal\s+)?sea\s+moss\s+gel\b|\bsea\s+moss\b/i) ??
        "Sea Moss Gel",
    );
  } else if (GEL_FUEL_TITLE_PATTERN.test(titleWithoutBrand)) {
    pushRow(
      extractTitleMatch(titleWithoutBrand, /\bendurance\s+gel\b|\bgo\s+gel\b|\benergy\s+gel\b/i) ??
        "Endurance Gel",
    );
  } else if (ELECTROLYTE_DRINK_MIX_TITLE_PATTERN.test(titleWithoutBrand)) {
    pushRow(
      extractTitleMatch(titleWithoutBrand, /\belectrolyte\s+drink\s+mix\b|\belectrolyte\s+(?:formula|mix|blend|stack|mineral\s+stack)\b|\bhydrationup\b|\belectrolytes?\+?\b|\bhydrate\s+coconut\s+water\b/i) ??
        "Electrolyte Drink Mix",
    );
  } else if (isLeadAloeVeraTitle(titleWithoutBrand)) {
    pushRow("Aloe Vera");
  } else if (FIBER_PRODUCT_TITLE_PATTERN.test(titleWithoutBrand)) {
    pushRow(extractTitleMatch(titleWithoutBrand, /(?:apple|psyllium|acacia|inulin|prebiotic)?\s*fiber/i) ?? "Fiber");
  } else if (PROTEIN_PRODUCT_TITLE_PATTERN.test(titleWithoutBrand)) {
    pushRow(extractTitleMatch(titleWithoutBrand, /\b(?:whey|pea|rice|soy|hemp|collagen)?\s*protein\b/i) ?? "Protein");
  } else if (POTASSIUM_SUPPLEMENT_PATTERN.test(titleWithoutBrand)) {
    pushRow(extractTitleMatch(titleWithoutBrand, POTASSIUM_SUPPLEMENT_PATTERN) ?? "Potassium Gluconate");
  } else if (brandContextLooksGreens) {
    pushRow("Greens");
  } else if (!hasMeaningfulCoverage && !hasBiotinTitleActiveCoverage && isFoodLikeTitle) {
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
  const titleWithoutBrand = normalizeText(productName.replace(/^[^,]{1,40},\s*/, ""));
  return familyPattern.test(titleWithoutBrand.slice(0, 48));
};

function isProbioticLedZincCompanionTitle(productName: string): boolean {
  const titleWithoutBrand = normalizeText(productName.replace(/^[^,]{1,40},\s*/, ""));
  const probioticIndex = titleWithoutBrand.search(PROBIOTIC_TITLE_PATTERN);
  const zincIndex = titleWithoutBrand.search(/\bzinc\b/i);
  return probioticIndex >= 0 && zincIndex >= 0 && probioticIndex < zincIndex && !titleStartsWithFamily("zinc", productName);
}

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

const hasStrongLeadActiveSignal = (families: IngredientScienceIngredientFamily[]): boolean =>
  families.some((family) => STRONG_LEAD_ACTIVE_FAMILIES.has(family));

const hasCalciumMagnesiumTitle = (productName: string): boolean =>
  hasTitleFamily("magnesium", productName) && hasTitleFamily("calcium", productName);

const hasClaCarnitineTitle = (productName: string): boolean =>
  CLA_PATTERN.test(productName) && CARNITINE_PATTERN.test(productName);

const getMineralStackPriorityBoost = (
  family: IngredientScienceIngredientFamily,
  hasMineralStackLead: boolean,
): number => {
  if (!hasMineralStackLead) return 0;
  if (family === "magnesium") return 145;
  if (family === "zinc") return 120;
  if (family === "calcium") return 36;
  return 0;
};

const pickPrimaryActiveRowIndex = (
  rows: ScienceIngredientRow[],
  families: IngredientScienceIngredientFamily[],
  productName: string,
): number => {
  if (rows.length === 0) return -1;
  const hasStrongLeadActive = hasStrongLeadActiveSignal(families);
  const hasMineralStackLead = hasMineralStackLeadSignal(rows, families, productName);
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
    const titleLedBotanicalAnchorBoost = isTitleLedBotanicalAnchorRow(row.name, productName) ? 520 : 0;
    const titleRescueAnchorBoost = isTitleRescueAnchorRow(row.name, productName) ? 860 : 0;
    const foodLikeMacroPenalty = isFoodLikeMacroAnchorRow(row.name, productName) ? 460 : 0;
    const foodLikeLowValueAnchorPenalty = isFoodLikeLowValueAnchorRow(row.name, productName) ? 520 : 0;
    const liquidAminosProteinAmountPenalty = isLiquidAminosProteinAmountRow(row.name, productName) ? 560 : 0;
    const titleLedBotanicalSolventPenalty = isTitleLedBotanicalSolventRow(row.name, productName) ? 420 : 0;
    const titleRescueMacroPenalty = isTitleRescueMacroRow(row.name, productName) ? 520 : 0;
    const audienceRowPenalty = NON_INGREDIENT_AUDIENCE_ROW_PATTERN.test(normalizeText(row.name)) ? 260 : 0;
    const magnesiumComboTitleBoost =
      family === "magnesium"
      && hasCalciumMagnesiumTitle(productName)
        ? 720
        : 0;
    const calciumMagnesiumStackRowBoost =
      hasCalciumMagnesiumTitle(productName)
      && /\bcalcium\b/i.test(row.name)
      && /\bmagnesium\b/i.test(row.name)
        ? 900
        : 0;
    const vitaminCInMagnesiumComboPenalty =
      family === "vitamin_c"
      && hasCalciumMagnesiumTitle(productName)
      && !titleStartsWithFamily("vitamin_c", productName)
        ? 520
        : 0;
    const elderberryTitleBoost =
      ELDERBERRY_PATTERN.test(productName) && ELDERBERRY_PATTERN.test(row.name)
        ? 190
        : 0;
    const immuneSupportLeadBoost =
      IMMUNE_BLEND_TITLE_PATTERN.test(productName)
        ? family === "zinc"
          ? 190
          : family === "vitamin_c"
            ? 150
            : ELDERBERRY_PATTERN.test(row.name)
              ? 140
              : 0
        : 0;
    const magnesiumInImmuneFormulaPenalty =
      IMMUNE_BLEND_TITLE_PATTERN.test(productName)
      && family === "magnesium"
      && !hasTitleFamily("magnesium", productName)
        ? 220
        : 0;
    const probioticLeadBoost =
      PROBIOTIC_TITLE_PATTERN.test(productName)
      && (family === "probiotic_or_blend" || PROBIOTIC_SPECIFIC_ROW_PATTERN.test(row.name))
        ? 420
        : 0;
    const probioticFormulaFamilyBoost = isProbioticFormulaFamilyRow(row.name, productName) ? 360 : 0;
    const probioticFormulaCompanionPenalty = isProbioticFormulaCompanionYeastRow(row.name, productName) ? 220 : 0;
    const vitaminDInProbioticTitlePenalty =
      PROBIOTIC_TITLE_PATTERN.test(productName) && family === "vitamin_d" ? 320 : 0;
    const opaqueProbioticBlendPenalty =
      PROBIOTIC_TITLE_PATTERN.test(productName)
      && isBlendLike(row.name, family)
      && !PROBIOTIC_SPECIFIC_ROW_PATTERN.test(row.name)
        ? 320
        : 0;
    const zincImmuneBlendBoost =
      family === "zinc"
      && hasTitleFamily("zinc", productName)
      && IMMUNE_BLEND_TITLE_PATTERN.test(productName)
        ? 150
        : 0;
    const zincTitleLeadBoost =
      family === "zinc" && hasTitleFamily("zinc", productName)
        ? titleStartsWithFamily("zinc", productName)
          ? 720
          : 620
        : 0;
    const zincInProbioticTitlePenalty =
      family === "zinc" && isProbioticLedZincCompanionTitle(productName)
        ? 1120
        : 0;
    const nonZincInZincTitlePenalty = isNonZincCompanionInZincTitle(family, row.name, productName) ? 360 : 0;
    const vitaminCImmuneCompanionPenalty =
      family === "vitamin_c"
      && hasTitleFamily("zinc", productName)
      && IMMUNE_BLEND_TITLE_PATTERN.test(productName)
      && !titleStartsWithFamily("vitamin_c", productName)
        ? 210
        : 0;
    const claCombinationLeadBoost =
      family === "cla" && hasClaCarnitineTitle(productName)
        ? 420
        : 0;
    const carnitineInClaCombinationPenalty =
      family === "carnitine" && hasClaCarnitineTitle(productName)
        ? 210
        : 0;
    const carnitineTitleBoost =
      family === "carnitine" && hasTitleFamily("carnitine", productName)
        ? 260
        : 0;
    const fiveHtpCombinationLeadBoost =
      family === "5htp" && hasTitleFamily("5htp", productName)
        ? 380
        : 0;
    const melatoninInFiveHtpPenalty =
      family === "melatonin" && hasTitleFamily("5htp", productName)
        ? 260
        : 0;
    const claMatrixPenalty =
      family === "cla" && CARNITINE_PATTERN.test(productName) && HARD_BLEND_LIKE_PATTERN.test(row.name)
        ? 180
        : 0;
    const supportingPenalty =
      hasStrongLeadActive && SUPPORTING_MICRONUTRIENT_FAMILIES.has(family) ? 96 : 0;
    const vitaminDInMineralStackPenalty =
      hasMineralStackLead && family === "vitamin_d" ? 145 : 0;
    const genericFormulaPenalty =
      GENERIC_FORMULA_LINE_PATTERN.test(row.name) ? 220 : 0;
    const enzymeSupportPenalty =
      ENZYME_SUPPORT_LINE_PATTERN.test(row.name) ? 190 : 0;
    const mineralStackPriorityBoost = getMineralStackPriorityBoost(family, hasMineralStackLead);
    const bComplexFormulaBoost =
      B_COMPLEX_TITLE_PATTERN.test(productName) && B_COMPLEX_FORMULA_ROW_PATTERN.test(row.name) ? 840 : 0;
    const hasBroadMultivitaminTitle =
      MULTIVITAMIN_TITLE_PATTERN.test(productName) ||
      MINIMAL_ESSENTIAL_BROAD_NUTRIENT_TITLE_PATTERN.test(productName);
    const multivitaminFormulaBoost =
      hasBroadMultivitaminTitle && MULTIVITAMIN_FORMULA_ROW_PATTERN.test(row.name) ? 880 : 0;
    const multivitaminSingleActivePenalty =
      hasBroadMultivitaminTitle
      && !MULTIVITAMIN_FORMULA_ROW_PATTERN.test(row.name)
      && family !== "generic"
        ? 140
        : 0;
    const score =
      (matchesProductTitle(row.name, productName) ? 120 : 0) +
      familyTitleBoost +
      familyTitlePositionBoost +
      foodLikeContextAnchorBoost +
      titleLedBotanicalAnchorBoost +
      titleRescueAnchorBoost +
      mineralStackPriorityBoost +
      magnesiumComboTitleBoost +
      calciumMagnesiumStackRowBoost +
      bComplexFormulaBoost +
      multivitaminFormulaBoost +
      probioticLeadBoost +
      probioticFormulaFamilyBoost +
      zincTitleLeadBoost +
      zincImmuneBlendBoost +
      elderberryTitleBoost +
      immuneSupportLeadBoost +
      claCombinationLeadBoost +
      carnitineTitleBoost +
      fiveHtpCombinationLeadBoost +
      (STRONG_LEAD_ACTIVE_FAMILIES.has(family) ? 86 : 0) +
      (PRIMARY_ACTIVE_FAMILIES.has(family) ? 24 : 0) +
      Math.min(parseDoseMagnitude(row.dose), 1200) / 24 +
      (row.dose ? 18 : 0) -
      (COMPANION_FAMILIES.has(family) ? 48 : 0) -
      supportingPenalty -
      vitaminDInProbioticTitlePenalty -
      zincInProbioticTitlePenalty -
      probioticFormulaCompanionPenalty -
      nonZincInZincTitlePenalty -
      carnitineInClaCombinationPenalty -
      melatoninInFiveHtpPenalty -
      vitaminDInMineralStackPenalty -
      vitaminCImmuneCompanionPenalty -
      magnesiumInImmuneFormulaPenalty -
      vitaminCInMagnesiumComboPenalty -
      multivitaminSingleActivePenalty -
      productTitleEchoPenalty -
      macroPenalty -
      foodLikeMacroPenalty -
      foodLikeLowValueAnchorPenalty -
      liquidAminosProteinAmountPenalty -
      titleLedBotanicalSolventPenalty -
      titleRescueMacroPenalty -
      audienceRowPenalty -
      opaqueProbioticBlendPenalty -
      claMatrixPenalty -
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
  row: ScienceIngredientRow;
  descriptor: IngredientScienceDescriptor;
  index: number;
  productName: string;
  anchorKey: string | null;
  hasStrongLeadActive: boolean;
  hasMineralStackLead: boolean;
}): number => {
  const {
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
  const productTitleEchoPenalty =
    normalizeIngredientScienceKey(row.name) === normalizeIngredientScienceKey(productName) ? 280 : 0;
  const macroPenalty = NUTRITION_FACTS_MACRO_PATTERN.test(row.name) ? 240 : 0;
  const foodLikeContextAnchorBoost =
    isFoodLikeTitle(productName)
    && isFoodLikeContextAnchorRow(row.name)
    && !shouldPreferSpecificFoodLikeIngredient(productName)
      ? 820
      : 0;
  const titleLedBotanicalAnchorBoost = isTitleLedBotanicalAnchorRow(row.name, productName) ? 540 : 0;
  const titleRescueAnchorBoost = isTitleRescueAnchorRow(row.name, productName) ? 880 : 0;
  const foodLikeMacroPenalty = isFoodLikeMacroAnchorRow(row.name, productName) ? 500 : 0;
  const foodLikeLowValueAnchorPenalty = isFoodLikeLowValueAnchorRow(row.name, productName) ? 560 : 0;
  const liquidAminosProteinAmountPenalty = isLiquidAminosProteinAmountRow(row.name, productName) ? 580 : 0;
  const titleLedBotanicalSolventPenalty = isTitleLedBotanicalSolventRow(row.name, productName) ? 440 : 0;
  const titleRescueMacroPenalty = isTitleRescueMacroRow(row.name, productName) ? 540 : 0;
  const audienceRowPenalty = NON_INGREDIENT_AUDIENCE_ROW_PATTERN.test(normalizeText(row.name)) ? 240 : 0;
  const magnesiumComboTitleBoost =
    descriptor.ingredientFamily === "magnesium"
    && hasCalciumMagnesiumTitle(productName)
      ? 740
      : 0;
  const calciumMagnesiumStackRowBoost =
    hasCalciumMagnesiumTitle(productName)
    && /\bcalcium\b/i.test(row.name)
    && /\bmagnesium\b/i.test(row.name)
      ? 930
      : 0;
  const vitaminCInMagnesiumComboPenalty =
    descriptor.ingredientFamily === "vitamin_c"
    && hasCalciumMagnesiumTitle(productName)
    && !titleStartsWithFamily("vitamin_c", productName)
      ? 520
      : 0;
  const elderberryTitleBoost =
    ELDERBERRY_PATTERN.test(productName) && ELDERBERRY_PATTERN.test(row.name)
      ? 180
      : 0;
  const immuneSupportLeadBoost =
    IMMUNE_BLEND_TITLE_PATTERN.test(productName)
      ? descriptor.ingredientFamily === "zinc"
        ? 190
        : descriptor.ingredientFamily === "vitamin_c"
          ? 150
          : ELDERBERRY_PATTERN.test(row.name)
            ? 140
            : 0
      : 0;
  const magnesiumInImmuneFormulaPenalty =
    IMMUNE_BLEND_TITLE_PATTERN.test(productName)
    && descriptor.ingredientFamily === "magnesium"
    && !hasTitleFamily("magnesium", productName)
      ? 220
      : 0;
  const probioticLeadBoost =
    PROBIOTIC_TITLE_PATTERN.test(productName)
    && (
      descriptor.ingredientFamily === "probiotic_or_blend"
      || PROBIOTIC_SPECIFIC_ROW_PATTERN.test(row.name)
    )
      ? 430
      : 0;
  const probioticFormulaFamilyBoost = isProbioticFormulaFamilyRow(row.name, productName) ? 380 : 0;
  const probioticFormulaCompanionPenalty = isProbioticFormulaCompanionYeastRow(row.name, productName) ? 220 : 0;
  const vitaminDInProbioticTitlePenalty =
    PROBIOTIC_TITLE_PATTERN.test(productName) && descriptor.ingredientFamily === "vitamin_d" ? 320 : 0;
  const opaqueProbioticBlendPenalty =
    PROBIOTIC_TITLE_PATTERN.test(productName)
    && isBlendLike(row.name, descriptor.ingredientFamily)
    && !PROBIOTIC_SPECIFIC_ROW_PATTERN.test(row.name)
      ? 340
      : 0;
  const zincImmuneBlendBoost =
    descriptor.ingredientFamily === "zinc"
    && hasTitleFamily("zinc", productName)
    && IMMUNE_BLEND_TITLE_PATTERN.test(productName)
      ? 140
      : 0;
  const zincTitleLeadBoost =
    descriptor.ingredientFamily === "zinc" && hasTitleFamily("zinc", productName)
      ? titleStartsWithFamily("zinc", productName)
        ? 740
        : 630
      : 0;
  const zincInProbioticTitlePenalty =
    descriptor.ingredientFamily === "zinc" && isProbioticLedZincCompanionTitle(productName)
      ? 1120
      : 0;
  const nonZincInZincTitlePenalty =
    isNonZincCompanionInZincTitle(descriptor.ingredientFamily, row.name, productName) ? 360 : 0;
  const vitaminCImmuneCompanionPenalty =
    descriptor.ingredientFamily === "vitamin_c"
    && hasTitleFamily("zinc", productName)
    && IMMUNE_BLEND_TITLE_PATTERN.test(productName)
    && !titleStartsWithFamily("vitamin_c", productName)
      ? 190
      : 0;
  const claCombinationLeadBoost =
    descriptor.ingredientFamily === "cla" && hasClaCarnitineTitle(productName)
      ? 430
      : 0;
  const carnitineInClaCombinationPenalty =
    descriptor.ingredientFamily === "carnitine" && hasClaCarnitineTitle(productName)
      ? 210
      : 0;
  const carnitineTitleBoost =
    descriptor.ingredientFamily === "carnitine" && hasTitleFamily("carnitine", productName)
      ? 260
      : 0;
  const fiveHtpCombinationLeadBoost =
    descriptor.ingredientFamily === "5htp" && hasTitleFamily("5htp", productName)
      ? 390
      : 0;
  const melatoninInFiveHtpPenalty =
    descriptor.ingredientFamily === "melatonin" && hasTitleFamily("5htp", productName)
      ? 260
      : 0;
  const claMatrixPenalty =
    descriptor.ingredientFamily === "cla" && CARNITINE_PATTERN.test(productName) && HARD_BLEND_LIKE_PATTERN.test(row.name)
      ? 160
      : 0;
  const genericFormulaPenalty = GENERIC_FORMULA_LINE_PATTERN.test(row.name) ? 180 : 0;
  const enzymeSupportPenalty = ENZYME_SUPPORT_LINE_PATTERN.test(row.name) ? 170 : 0;
  const supportingPenalty =
    hasStrongLeadActive && SUPPORTING_MICRONUTRIENT_FAMILIES.has(descriptor.ingredientFamily) ? 96 : 0;
  const vitaminDInMineralStackPenalty =
    hasMineralStackLead && descriptor.ingredientFamily === "vitamin_d" ? 130 : 0;
  const mineralStackPriorityBoost =
    getMineralStackPriorityBoost(descriptor.ingredientFamily, hasMineralStackLead);
  const bComplexFormulaBoost =
    B_COMPLEX_TITLE_PATTERN.test(productName) && B_COMPLEX_FORMULA_ROW_PATTERN.test(row.name) ? 860 : 0;
  const hasBroadMultivitaminTitle =
    MULTIVITAMIN_TITLE_PATTERN.test(productName) ||
    MINIMAL_ESSENTIAL_BROAD_NUTRIENT_TITLE_PATTERN.test(productName);
  const multivitaminFormulaBoost =
    hasBroadMultivitaminTitle && MULTIVITAMIN_FORMULA_ROW_PATTERN.test(row.name) ? 900 : 0;
  const multivitaminSingleActivePenalty =
    hasBroadMultivitaminTitle
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
    titleLedBotanicalAnchorBoost +
    titleRescueAnchorBoost +
    mineralStackPriorityBoost +
    magnesiumComboTitleBoost +
    calciumMagnesiumStackRowBoost +
    bComplexFormulaBoost +
    multivitaminFormulaBoost +
    probioticLeadBoost +
    probioticFormulaFamilyBoost +
    zincTitleLeadBoost +
    zincImmuneBlendBoost +
    elderberryTitleBoost +
    immuneSupportLeadBoost +
    claCombinationLeadBoost +
    carnitineTitleBoost +
    fiveHtpCombinationLeadBoost +
    (STRONG_LEAD_ACTIVE_FAMILIES.has(descriptor.ingredientFamily) ? 68 : 0) +
    (PRIMARY_ACTIVE_FAMILIES.has(descriptor.ingredientFamily) ? 34 : 0) +
    (row.dose ? 16 : 0) +
    Math.min(doseMagnitude, 1200) / 24 -
    (descriptor.lineRole === "companion_nutrient" ? 62 : 0) -
    supportingPenalty -
    vitaminDInProbioticTitlePenalty -
    zincInProbioticTitlePenalty -
    probioticFormulaCompanionPenalty -
    nonZincInZincTitlePenalty -
    carnitineInClaCombinationPenalty -
    melatoninInFiveHtpPenalty -
    vitaminDInMineralStackPenalty -
    magnesiumInImmuneFormulaPenalty -
    vitaminCImmuneCompanionPenalty -
    vitaminCInMagnesiumComboPenalty -
    multivitaminSingleActivePenalty -
    productTitleEchoPenalty -
    macroPenalty -
    foodLikeMacroPenalty -
    foodLikeLowValueAnchorPenalty -
    liquidAminosProteinAmountPenalty -
    titleLedBotanicalSolventPenalty -
    titleRescueMacroPenalty -
    audienceRowPenalty -
    opaqueProbioticBlendPenalty -
    claMatrixPenalty -
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
    family === "turmeric" ||
    family === "creatine" ||
    family === "berberine" ||
    family === "nac" ||
    family === "collagen" ||
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
  const titleLooksFoodLike =
    !FLOWER_ESSENCE_TITLE_PATTERN.test(productName) &&
    !PROBIOTIC_TITLE_PATTERN.test(productName) &&
    FUNCTIONAL_FOOD_LIKE_TITLE_PATTERN.test(productName);
  const formLooksFoodLike = FUNCTIONAL_FOOD_LIKE_FORM_PATTERN.test(dosageForm);
  const rowLooksFoodLike = params.rows.some((row) =>
    FUNCTIONAL_FOOD_LIKE_INGREDIENT_PATTERN.test(normalizeText(row.name)),
  );
  const foodLikeTitleDominant =
    GREENS_TITLE_PATTERN.test(productName) ||
    TEA_BAG_TITLE_PATTERN.test(productName) ||
    FOOD_LIKE_POWDER_TITLE_PATTERN.test(productName);
  const strongFoodPresentation = titleLooksFoodLike || formLooksFoodLike || rowLooksFoodLike;
  const definitelyFoodLikeFromTitle =
    titleLooksFoodLike && (formLooksFoodLike || rowLooksFoodLike);

  if (
    PROBIOTIC_TITLE_PATTERN.test(productName) &&
    params.rows.some((row, index) =>
      params.families[index] === "probiotic_or_blend" ||
      PROBIOTIC_SPECIFIC_ROW_PATTERN.test(row.name),
    )
  ) {
    return "standard_supplement";
  }

  if (foodLikeTitleDominant) {
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
  const productName =
    normalizeText(params.digest?.product?.name) ||
    normalizeText(params.overlayClaims?.title) ||
    "Supplement formula";
  const brandName =
    normalizeText(params.digest?.product?.brandDisplay) ||
    normalizeText(params.digest?.product?.brandLegal) ||
    normalizeText(params.overlayClaims?.brandName) ||
    null;
  const overlayTitle = normalizeText(params.overlayClaims?.title);
  const productContextName = normalizeText(
    [
      productName,
      overlayTitle && normalizeIngredientScienceKey(overlayTitle) !== normalizeIngredientScienceKey(productName)
        ? overlayTitle
        : null,
    ].filter(Boolean).join(" "),
  );
  const brandProductName = normalizeText([brandName, productContextName].filter(Boolean).join(" "));
  const rankingProductName =
    brandName
    && GREENS_TITLE_PATTERN.test(brandProductName)
    && !GREENS_TITLE_PATTERN.test(productContextName)
      ? brandProductName
      : productContextName || productName;
  const titleRescueRows = deriveScienceTitleRescueRows({
    productName: rankingProductName,
    brandName,
    dosageForm: params.digest?.product?.dosageForm ?? null,
    existingRows: selection.ingredientRows,
  });
  const ingredientRows = normalizeContextualIngredientRows(
    [...selection.ingredientRows, ...titleRescueRows],
    rankingProductName,
  );
  const sourceContext =
    selection.ingredientSourceTier === "overlay_iherb"
      ? "Supplemental product-page label data"
      : "Official record";
  const ingredientFamilies = ingredientRows.map((row) =>
    inferRowIngredientFamily({
      rowName: row.name,
      productName: rankingProductName,
    }),
  );
  const productArchetype = classifyProductArchetype({
    productName: rankingProductName,
    dosageForm: params.digest?.product?.dosageForm ?? null,
    rows: ingredientRows,
    families: ingredientFamilies,
  });
  const primaryIndex = pickPrimaryActiveRowIndex(ingredientRows, ingredientFamilies, rankingProductName);
  const lineRoles = buildLineRoles(ingredientRows, ingredientFamilies, primaryIndex, rankingProductName);
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
  const hasMineralStackLead = hasMineralStackLeadSignal(ingredientRows, ingredientFamilies, rankingProductName);
  const orderedEntries = ingredientRows
    .map((row, index) => ({
      row,
      descriptor: ingredientDescriptors[index]!,
      index,
    }))
    .sort((left, right) => {
      const scoreDiff =
        scoreIngredientDescriptorForDisplay({
          row: right.row,
          descriptor: right.descriptor,
          index: right.index,
          productName: rankingProductName,
          anchorKey,
          hasStrongLeadActive,
          hasMineralStackLead,
        }) -
        scoreIngredientDescriptorForDisplay({
          row: left.row,
          descriptor: left.descriptor,
          index: left.index,
          productName: rankingProductName,
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
    productName: rankingProductName,
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
