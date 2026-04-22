import type {
  IngredientScienceContext,
  IngredientScienceDescriptor,
  IngredientScienceIngredientFamily,
} from "../ingredientScienceContext.js";
import { normalizeIngredientScienceKey } from "../ingredientScienceContext.js";
import {
  getScientificBackgroundEvidence,
  type ScientificBackgroundEvidenceRow,
} from "./scientificBackgroundEvidencePackage.js";
import { extractJsonObjectLoose } from "./summaryCompiler.js";

type ScientificBackgroundMode = "research_mode" | "label_context_mode";
type ScientificBackgroundSection = {
  heading: string;
  summary: string;
  bullets: string[];
  evidenceRead: string;
  shopperMeaning: string | null;
};

type ScientificBackgroundBlock = {
  mode: ScientificBackgroundMode;
  selectedLabel: string;
  selectedDose: string | null;
  introLine: string | null;
  sections: ScientificBackgroundSection[];
  closingNote: string | null;
};

type ScientificBackgroundWriterSection = ScientificBackgroundSection & {
  headingId?: string;
};

type ScientificBackgroundWriterOutput = {
  introLine?: string | null;
  sections?: ScientificBackgroundWriterSection[];
  closingNote?: string | null;
};

type ScientificBackgroundSectionPlan = {
  headingId: string;
  heading: string;
  intent: string;
  bulletThemes: string[];
  evidenceGoal: string;
  shopperMeaningGoal: string | null;
};

export type ScientificBackgroundPlan = {
  mode: ScientificBackgroundMode;
  selectedLabel: string;
  selectedDose: string | null;
  family: IngredientScienceIngredientFamily;
  sections: ScientificBackgroundSectionPlan[];
};

export type ScientificBackgroundCompileResult = {
  scientificBackground: ScientificBackgroundBlock;
  source: "api" | "fallback";
  fallbackUsed: boolean;
  promptVersion: string;
  diagnostics: ScientificBackgroundCompileDiagnostics;
};

export type ScientificBackgroundCompileDiagnostics = {
  liveWriterConfigured: boolean;
  liveWriterAttempted: boolean;
  liveWriterHit: boolean;
  attemptCount: number;
  timeoutMs: number;
  maxRetries: number;
  fallbackReason: string | null;
  lastError: string | null;
  parseFailureCount: number;
  gateRejectCount: number;
  timeoutCount: number;
  errorCount: number;
};

export type CompileScientificBackgroundOpts = {
  llmFn?: (prompt: string) => Promise<string>;
  timeoutMs?: number;
  maxRetries?: number;
};

export type ScientificBackgroundExecutionProfile = {
  preferLiveWriter: boolean;
  timeoutMs: number;
  backgroundRefreshTimeoutMs: number;
  maxRetries: number;
  backgroundRefreshMaxRetries: number;
  maxTokens: number;
  cacheTtlMs: number;
};

export const SCIENTIFIC_BACKGROUND_PROMPT_VERSION = "scientific_background_v21";

const RESEARCH_MODE_TIMEOUT_MS = 2_500;
const CURCUMIN_RESEARCH_MODE_TIMEOUT_MS = 2_900;
const ASHWAGANDHA_RESEARCH_MODE_TIMEOUT_MS = 2_900;
const GINSENG_RESEARCH_MODE_TIMEOUT_MS = 2_900;
const OMEGA3_RESEARCH_MODE_TIMEOUT_MS = 3_800;
const GREEN_TEA_EXTRACT_RESEARCH_MODE_TIMEOUT_MS = 3_600;
const SEVEN_KETO_RESEARCH_MODE_TIMEOUT_MS = 3_500;
const CLA_RESEARCH_MODE_TIMEOUT_MS = 3_500;
const CARNITINE_RESEARCH_MODE_TIMEOUT_MS = 3_500;
const NIACINAMIDE_RESEARCH_MODE_TIMEOUT_MS = 2_750;
const HTP5_RESEARCH_MODE_TIMEOUT_MS = 3_500;
const VITAMIN_D_RESEARCH_MODE_TIMEOUT_MS = 2_750;
const B12_RESEARCH_MODE_TIMEOUT_MS = 2_500;
const FOLATE_RESEARCH_MODE_TIMEOUT_MS = 2_500;
const B6_RESEARCH_MODE_TIMEOUT_MS = 2_500;
const MAGNESIUM_RESEARCH_MODE_TIMEOUT_MS = 3_000;
const ZINC_RESEARCH_MODE_TIMEOUT_MS = 2_750;
const CALCIUM_RESEARCH_MODE_TIMEOUT_MS = 2_750;
const IRON_RESEARCH_MODE_TIMEOUT_MS = 3_000;
const MELATONIN_RESEARCH_MODE_TIMEOUT_MS = 2_500;
const DHA_RESEARCH_MODE_TIMEOUT_MS = 4_200;
const LABEL_CONTEXT_MODE_TIMEOUT_MS = 1_500;
const RESEARCH_MODE_BACKGROUND_REFRESH_TIMEOUT_MS = 18_000;
const LONG_RESEARCH_MODE_BACKGROUND_REFRESH_TIMEOUT_MS = 22_000;
const DHA_RESEARCH_MODE_BACKGROUND_REFRESH_TIMEOUT_MS = 24_000;
const EXTENDED_RESEARCH_MODE_BACKGROUND_REFRESH_TIMEOUT_MS = 28_000;
const MAGNESIUM_RESEARCH_MODE_BACKGROUND_REFRESH_TIMEOUT_MS = EXTENDED_RESEARCH_MODE_BACKGROUND_REFRESH_TIMEOUT_MS;
const ZINC_RESEARCH_MODE_BACKGROUND_REFRESH_TIMEOUT_MS = EXTENDED_RESEARCH_MODE_BACKGROUND_REFRESH_TIMEOUT_MS;
const CARNITINE_RESEARCH_MODE_BACKGROUND_REFRESH_TIMEOUT_MS = LONG_RESEARCH_MODE_BACKGROUND_REFRESH_TIMEOUT_MS;
const GREEN_TEA_EXTRACT_RESEARCH_MODE_BACKGROUND_REFRESH_TIMEOUT_MS = EXTENDED_RESEARCH_MODE_BACKGROUND_REFRESH_TIMEOUT_MS;
const LLM_TIMEOUT_MS = RESEARCH_MODE_TIMEOUT_MS;
const LLM_MAX_RETRIES = 0;
const BACKGROUND_REFRESH_MAX_RETRIES = 1;
const RESEARCH_MODE_MAX_TOKENS = 750;
const TARGETED_RESEARCH_MODE_MAX_TOKENS = 650;
const TARGETED_RESEARCH_MODE_MAX_RETRIES = 0;
const LABEL_CONTEXT_MODE_MAX_TOKENS = 400;
const RESEARCH_MODE_CACHE_TTL_MS = 10 * 60_000;
const LABEL_CONTEXT_MODE_CACHE_TTL_MS = 20 * 60_000;

const MEDICAL_BANNED_PATTERNS = [
  /\bproven to\b/i,
  /\b(?:this|it|research|evidence|study|studies)\s+proves?\b/i,
  /\bproof of\b/i,
  /\btreats\b/i,
  /\bused to treat\b/i,
  /\btreatment of\b/i,
  /\bprevents?\b/i,
  /\bcures?\b/i,
  /\bdiagnoses?\b/i,
  /\bbest for\b/i,
  /\bboosts?\b/i,
  /strongly improves/i,
  /\btreating\s+(?:symptoms?|conditions?|disease|illness|insomnia|infection|anxiety|depression|deficiency)\b/i,
];

const GENERIC_IDENTITY_PATTERNS = [
  /\bis a naturally occurring\b/i,
  /\bis a carotenoid pigment\b/i,
  /gives salmon its color/i,
  /\bthis supplement provides\b/i,
  /\bpeople take this\b/i,
];

const GENERIC_BULLET_PATTERNS = [
  /-related research\.?$/i,
  /\bcommon research areas\b/i,
  /\bevidence varies\b/i,
];

const TEMPLATE_SUMMARY_PATTERNS = [
  /^\s*(?:this ingredient|this selected ingredient)\s+(?:is|has been)\s+/i,
  /^\s*.+?\s+is\s+(?:frequently|commonly|often|also)?\s*(?:studied|discussed|explored)\b/i,
  /^\s*.+?\s+has been\s+(?:frequently|commonly|often|also)?\s*(?:studied|discussed|explored)\b/i,
];

const WEAK_EVIDENCE_PATTERNS = [
  /^\s*evidence varies\.?$/i,
  /^\s*study designs vary\.?$/i,
  /^\s*results are mixed\.?$/i,
  /^\s*this is informative\.?$/i,
];

const WEAK_SHOPPER_MEANING_PATTERNS = [
  /\buse this as proof\b/i,
  /\bproof of\b/i,
  /\bstrong differentiator\b/i,
  /\bbroad .* benefits?\b/i,
  /\bworks for broad\b/i,
  /\bbroad .* language is common here\b/i,
  /\buse this as supporting context\b/i,
];

const SHOPPER_DECISION_KEYWORDS = [
  /\bcompar(?:e|es|ed|ing|ison)\b/i,
  /\blabels?\b/i,
  /\bproducts?\b/i,
  /\bshopping\b/i,
  /\bshoppers?\b/i,
  /\bread\b/i,
  /\bpackaging\b/i,
  /\bclaims?\b/i,
  /\bdisclosure\b/i,
  /\bbreakdown\b/i,
  /\bformula(?:s)?\b/i,
  /\brow(?:s)?\b/i,
];

const normalizeText = (value: string | null | undefined): string =>
  String(value ?? "")
    .replace(/\s+/g, " ")
    .trim();

const normalizeDiagnosticReason = (value: string | null | undefined): string | null => {
  const normalized = normalizeText(value)
    .toLowerCase()
    .replace(/[^a-z0-9_:-]+/g, "_")
    .replace(/^_+|_+$/g, "");
  return normalized || null;
};

const resolveErrorReason = (error: unknown): string => {
  if (!(error instanceof Error)) return "unknown_error";
  if (error.name === "AbortError" || /aborted/i.test(error.message)) return "llm_timeout";
  const normalized = normalizeDiagnosticReason(error.message);
  return normalized ?? "unknown_error";
};

const normalizeHeading = (value: string | null | undefined): string =>
  normalizeText(value)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();

const asSentence = (value: string | null | undefined): string => {
  const normalized = normalizeText(value);
  if (!normalized) return "";
  return /[.!?]$/.test(normalized) ? normalized : `${normalized}.`;
};

const splitSentences = (value: string): string[] =>
  normalizeText(value)
    .split(/(?<=[.!?])\s+/)
    .map((part) => normalizeText(part))
    .filter(Boolean);

const dedupe = (items: string[]): string[] => {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const item of items) {
    const normalized = normalizeText(item);
    if (!normalized) continue;
    const key = normalized.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(normalized);
  }
  return out;
};

const isOmega3Epa = (name: string): boolean => /\bepa\b|eicosapentaenoic/i.test(name);
const isOmega3Dha = (name: string): boolean => /\bdha\b|docosahexaenoic/i.test(name);
const isOmega3Total = (name: string): boolean => /\btotal\b.*\bomega\s*-?\s*3\b|\bomega\s*-?\s*3\b.*\btotal\b/i.test(name);
const isOmega3Source = (name: string): boolean => /\bfish\s*oil\b|\bkrill\s*oil\b|\balgal\s*oil\b|\boil\s*concentrate\b/i.test(name);
const isPhageBlend = (name: string): boolean => /phage/i.test(name);

const omega3SourceNarrativeLabel = (name: string): string => {
  if (/\balgal\s*oil\b|\balgae\b|\bschizochytrium\b/i.test(name)) return "This algal-oil source line";
  if (/\bkrill\s*oil\b/i.test(name)) return "This krill-oil source line";
  return "This fish-oil source line";
};

const buildReferenceLabel = (plan: ScientificBackgroundPlan): string => {
  if (plan.family === "astaxanthin_carotenoid") return "Astaxanthin";
  if (plan.family === "curcumin") return "Curcumin";
  if (plan.family === "ashwagandha") return "Ashwagandha";
  if (plan.family === "ginseng") return "Ginseng";
  if (plan.family === "green_tea_extract") return "Green tea extract";
  if (plan.family === "5htp") return "5-HTP";
  if (plan.family === "b3_niacinamide" && /\bniacinamide\b|\bnicotinamide\b/i.test(plan.selectedLabel)) return "Niacinamide";
  if (plan.family === "b3_niacinamide") return "Vitamin B3";
  if (plan.family === "glycine") return "Glycine";
  if (plan.family === "taurine") return "Taurine";
  if (plan.family === "inositol") return "Inositol";
  if (plan.family === "vitamin_d") return "Vitamin D";
  if (plan.family === "b12") return "Vitamin B12";
  if (plan.family === "folate") return "Folate";
  if (plan.family === "b6") return "Vitamin B6";
  if (plan.family === "vitamin_c" && /\bvitamin\s*c\b/i.test(plan.selectedLabel)) return "Vitamin C";
  if (plan.family === "zinc" && /\bzinc\b/i.test(plan.selectedLabel)) return "Zinc";
  if (plan.family === "magnesium") return "Magnesium";
  if (plan.family === "calcium") return "Calcium";
  if (plan.family === "iron") return "Iron";
  if (plan.family === "melatonin") return "Melatonin";
  if (plan.family === "omega_3" && isOmega3Epa(plan.selectedLabel)) return "EPA";
  if (plan.family === "omega_3" && isOmega3Dha(plan.selectedLabel)) return "DHA";
  return plan.selectedLabel;
};

const buildNarrativeLabel = (plan: ScientificBackgroundPlan): string => {
  if (plan.mode === "label_context_mode" && plan.family === "omega_3" && isOmega3Total(plan.selectedLabel)) {
    return "This total omega-3 line";
  }
  if (plan.mode === "label_context_mode" && plan.family === "omega_3" && isOmega3Source(plan.selectedLabel)) {
    return omega3SourceNarrativeLabel(plan.selectedLabel);
  }
  if (plan.mode === "label_context_mode" && isPhageBlend(plan.selectedLabel)) {
    return "This phage blend line";
  }
  if (plan.mode === "label_context_mode" && /\bblend\b/i.test(plan.selectedLabel)) {
    return "This blend line";
  }
  return buildReferenceLabel(plan);
};

const getSelectedDescriptor = (
  context: IngredientScienceContext,
  selectedIngredientName: string,
): IngredientScienceDescriptor | null => {
  const selectedKey = normalizeIngredientScienceKey(selectedIngredientName);
  if (!selectedKey) return null;
  return context.ingredientDescriptors.find((descriptor) => descriptor.key === selectedKey) ?? null;
};

const hasOtherResearchReadyOmega3Lines = (
  context: IngredientScienceContext,
  selectedDescriptor: IngredientScienceDescriptor,
): boolean =>
  context.ingredientDescriptors.some((descriptor) => {
    if (descriptor.key === selectedDescriptor.key) return false;
    if (descriptor.ingredientFamily !== "omega_3") return false;
    return descriptor.lineRole === "breakdown_line" || descriptor.lineRole === "primary_active";
  });

const PROTEIN_OR_FIBER_POWDER_PATTERN = /\bpowder\b/i;
const FOOD_LIKE_PROTEIN_OR_FIBER_BLOCKER_PATTERN =
  /\b(?:bars?|bites?|snack|cookies?|crackers?|chews?|gumm(?:y|ies)|drink|latte|smoothie|trail\s+mix)\b/i;

const hasResearchReadyFunctionalFoodOverride = (
  context: IngredientScienceContext,
  descriptor: IngredientScienceDescriptor,
): boolean => {
  if (descriptor.ingredientFamily !== "protein" && descriptor.ingredientFamily !== "fiber") return false;
  if (descriptor.lineRole === "blend_line" || descriptor.lineRole === "aggregate_line") return false;
  if (!PROTEIN_OR_FIBER_POWDER_PATTERN.test(context.productName)) return false;
  if (FOOD_LIKE_PROTEIN_OR_FIBER_BLOCKER_PATTERN.test(context.productName)) return false;
  return true;
};

const resolveScientificBackgroundMode = (
  context: IngredientScienceContext,
  descriptor: IngredientScienceDescriptor | null,
): ScientificBackgroundMode => {
  if (!descriptor) return "research_mode";
  if (context.productArchetype === "functional_food_like") {
    if (hasResearchReadyFunctionalFoodOverride(context, descriptor)) return "research_mode";
    return "label_context_mode";
  }
  if (descriptor.lineRole === "blend_line" || descriptor.lineRole === "aggregate_line") return "label_context_mode";
  if (descriptor.lineRole === "source_line") {
    return hasOtherResearchReadyOmega3Lines(context, descriptor) ? "label_context_mode" : "research_mode";
  }
  return "research_mode";
};

const buildSectionPlan = (
  headingId: string,
  heading: string,
  intent: string,
  bulletThemes: string[],
  evidenceGoal: string,
  shopperMeaningGoal: string | null,
): ScientificBackgroundSectionPlan => ({
  headingId,
  heading,
  intent,
  bulletThemes,
  evidenceGoal,
  shopperMeaningGoal,
});

const buildResearchPlan = (
  context: IngredientScienceContext,
  descriptor: IngredientScienceDescriptor,
): ScientificBackgroundSectionPlan[] => {
  const name = descriptor.name;
  if (descriptor.ingredientFamily === "astaxanthin_carotenoid") {
    return [
      buildSectionPlan(
        "antioxidant_activity",
        "Antioxidant activity",
        "Explain the main antioxidant and oxidative-stress outcomes most often discussed for the selected ingredient.",
        ["Oxidative-stress marker outcomes", "Cellular antioxidant-response context", "Results can vary by dose and study design"],
        "Show that antioxidant interest is meaningful but not identical across every endpoint.",
        "Translate this into why antioxidant positioning is more defensible than broader all-purpose claims.",
      ),
      buildSectionPlan(
        "eye_and_skin_context",
        "Eye and skin context",
        "Explain eye-comfort and skin-related research directions without overstating certainty.",
        ["Eye-comfort research context", "Skin hydration or elasticity context", "Supportive rather than definitive findings"],
        "Make clear that these outcomes are supportive and context-dependent.",
        "Help the shopper understand that this is a narrower evidence lane, not a universal promise.",
      ),
      buildSectionPlan(
        "exercise_and_recovery_research",
        "Exercise and recovery research",
        "Explain how the ingredient appears in fatigue, endurance, and recovery discussions.",
        ["Exercise-recovery context", "Endurance-performance context", "Mixed results across studies"],
        "Make clear that this is the most mixed of the three research areas.",
        "Signal that exercise positioning should be read more cautiously than antioxidant positioning.",
      ),
    ];
  }

  if (descriptor.ingredientFamily === "curcumin") {
    return [
      buildSectionPlan(
        "most_studied_outcomes",
        "Most studied outcomes",
        "Explain the main outcome areas most often discussed for curcumin or curcuminoid ingredients without flattening them into one generic anti-inflammatory promise.",
        ["Common research lanes often center on inflammation-adjacent or joint-related interpretation", "Some labels also lean on broader recovery or comfort positioning", "Keep the language narrower than broad cure-style marketing"],
        "Show that curcumin has recognizable research lanes, but not all outcome claims carry the same interpretive weight.",
        "Help the shopper understand which curcumin claims sound closer to the usual research map and which ones drift into broader marketing.",
      ),
      buildSectionPlan(
        "why_extract_detail_matters",
        "Why extract detail matters",
        "Explain why extract identity, standardization, or curcuminoid detail often matters when shoppers compare curcumin products.",
        ["Named extracts or standardized curcuminoid lines improve comparison", "Two turmeric labels can differ a lot in practical comparison value", "Keep the focus on reading the exact ingredient line"],
        "Make this a comparison-oriented lane, not a best-extract ranking.",
        "Help the shopper understand why the detailed extract line often matters more than broad turmeric positioning.",
      ),
      buildSectionPlan(
        "where_evidence_remains_mixed",
        "Where evidence remains mixed",
        "Explain that broader benefit language can outrun the clearest research lanes for curcumin products.",
        ["Not every broad comfort or wellness promise maps neatly to the evidence", "Study context and formula design still matter", "Do not turn mixed findings into empty disclaimer copy"],
        "Show that evidence texture varies by outcome and context.",
        "Help the shopper keep broad packaging language in proportion when comparing curcumin products.",
      ),
    ];
  }

  if (descriptor.ingredientFamily === "turmeric") {
    return [
      buildSectionPlan(
        "turmeric_traditional_and_modern_context",
        "Turmeric traditional and modern context",
        "Explain the broader traditional and modern supplement context for turmeric without treating every turmeric label like a concentrated curcumin product.",
        ["Turmeric can appear as whole-root powder, extract, or curcuminoid-adjacent ingredient", "This lane is broader than tightly standardized curcumin positioning", "Keep the interpretation supplement-specific rather than generic anti-inflammatory folklore"],
        "Show that turmeric has a recognizable context, but not every turmeric label carries the same comparison value as a concentrated curcuminoid product.",
        "Help the shopper read a plain turmeric row differently from a tightly specified curcumin extract.",
      ),
      buildSectionPlan(
        "extract_and_curcuminoid_detail",
        "Extract and curcuminoid detail",
        "Explain why extract identity, curcuminoid standardization, and bioavailability phrasing can materially change how turmeric products are compared.",
        ["Whole-root and extract products are not automatically the same comparison set", "Curcuminoid detail improves comparison much more than broad turmeric headlines", "Do not turn enhanced-absorption language into a universal best-product claim"],
        "Make clear that exact extract disclosure carries more interpretive weight than generic turmeric branding.",
        "Tell the shopper to check extract detail and standardization before assuming two turmeric products are similar.",
      ),
      buildSectionPlan(
        "where_turmeric_and_curcumin_diverge",
        "Where turmeric and curcumin diverge",
        "Explain that turmeric should not automatically be read as a curcumin-equivalent label or as proof of high active delivery.",
        ["Turmeric labels are not always curcumin-dense", "Some formulas lean on a whole-root story rather than a concentrated active story", "Do not infer concentrated actives when the line stays broad"],
        "Set a clear boundary between broad turmeric positioning and more specific curcuminoid comparison.",
        "Help the shopper avoid treating turmeric products as interchangeable with concentrated curcumin extracts.",
      ),
    ];
  }

  if (descriptor.ingredientFamily === "coq10") {
    return [
      buildSectionPlan(
        "energy_metabolism_context",
        "Energy metabolism context",
        "Explain the main mitochondrial and cellular-energy lane that usually anchors CoQ10 interpretation on supplement labels.",
        ["Energy-metabolism context is the clearest lane", "This is more specific than generic vitality marketing", "Keep the interpretation product-aware rather than mechanistic for its own sake"],
        "Show that energy-related positioning is the most recognizable CoQ10 lane without making it infinitely broad.",
        "Help the shopper understand why CoQ10 is easier to compare through its energy-metabolism role than through vague wellness copy.",
      ),
      buildSectionPlan(
        "heart_related_context",
        "Heart-related context",
        "Explain the narrower heart-related and statin-adjacent discussion around CoQ10 without turning it into a broad heart-health promise.",
        ["Heart-related context appears often", "Statin-adjacent positioning is common on some labels", "Not every broad heart claim is equally specific"],
        "Keep this as a supportive but narrower lane than generic cardiovascular marketing.",
        "Help the shopper keep broad heart language in proportion when comparing CoQ10 products.",
      ),
      buildSectionPlan(
        "what_form_disclosure_changes",
        "What form disclosure changes",
        "Explain why ubiquinone versus ubiquinol disclosure can change label interpretation and comparison value without turning the card into a best-form ranking.",
        ["Ubiquinone and ubiquinol lines can change comparison value", "Form detail often matters more than a generic CoQ10 headline", "Do not turn form differences into a universal superiority claim"],
        "Keep this section comparison-oriented and careful.",
        "Tell the shopper why disclosed CoQ10 form is often one of the first things worth checking.",
      ),
    ];
  }

  if (descriptor.ingredientFamily === "creatine") {
    return [
      buildSectionPlan(
        "strength_and_power_context",
        "Strength and power context",
        "Explain the main strength, power, and repeated high-intensity performance lane for creatine without flattening it into generic sports hype.",
        ["Strength and high-intensity performance are the clearest creatine lane", "This is more specific than broad performance marketing", "Keep the interpretation anchored to supplementation context"],
        "Show that creatine has a strong core lane, but not every athletic promise is equally specific.",
        "Help the shopper compare creatine products through the clearest performance-relevant context rather than generic gym copy.",
      ),
      buildSectionPlan(
        "exercise_recovery_context",
        "Exercise recovery context",
        "Explain the secondary recovery and training-volume context for creatine without making it sound identical to protein or general recovery ingredients.",
        ["Recovery-related interpretation appears often", "Training-volume or repeated-effort context can matter", "This is secondary to the core strength-and-power lane"],
        "Make clear that recovery language is real but should not outrank the primary lane.",
        "Help the shopper understand why creatine can appear in recovery positioning without meaning every creatine product serves the same job.",
      ),
      buildSectionPlan(
        "what_product_comparison_depends_on",
        "What product comparison depends on",
        "Explain which label details matter most when comparing creatine products.",
        ["Monohydrate disclosure often matters most", "Disclosed grams matter more than broad athlete language", "Simple formulas and loaded blends should not be read the same way"],
        "Keep this practical and comparison-focused.",
        "Tell the shopper what to check before assuming two creatine labels are interchangeable.",
      ),
    ];
  }

  if (descriptor.ingredientFamily === "berberine") {
    return [
      buildSectionPlan(
        "glucose_metabolic_context",
        "Glucose-metabolic context",
        "Explain the main glucose-metabolic lane that usually anchors berberine interpretation without turning it into a universal metabolic cure story.",
        ["Glucose-metabolic context is the clearest lane", "This is more specific than generic metabolism marketing", "Keep the wording evidence-aware and bounded"],
        "Show that berberine has a recognizable metabolic lane, but not an infinitely broad one.",
        "Help the shopper understand why glucose-oriented positioning is easier to justify than broad all-purpose metabolic language.",
      ),
      buildSectionPlan(
        "lipid_related_context",
        "Lipid-related context",
        "Explain the secondary lipid-related lane for berberine without making it sound equally strong across every endpoint.",
        ["Lipid-related discussion appears often", "This lane is supportive but broader than the clearest glucose lane", "Outcome specificity still matters"],
        "Keep this section secondary and more interpretive than the primary lane.",
        "Help the shopper keep broad lipid-support copy in proportion when comparing berberine products.",
      ),
      buildSectionPlan(
        "dose_and_extract_context",
        "Dose and extract context",
        "Explain why exact berberine form, dose, and formula setting change product comparison.",
        ["Berberine HCl disclosure improves comparison", "Dose matters more than broad botanical storytelling", "Combo formulas can change how central berberine really is"],
        "Make this a practical interpretation section rather than a generic caveat section.",
        "Tell the shopper what to compare on the label before assuming two berberine products do the same thing.",
      ),
    ];
  }

  if (descriptor.ingredientFamily === "nac") {
    return [
      buildSectionPlan(
        "glutathione_precursor_context",
        "Glutathione precursor context",
        "Explain the main glutathione-precursor lane for NAC without turning it into generic antioxidant filler.",
        ["Precursor framing is the clearest NAC lane", "This is more useful than broad detox-style marketing", "Keep the interpretation ingredient-specific and shopper-safe"],
        "Show that NAC is easiest to interpret through a narrower precursor lens rather than vague wellness language.",
        "Help the shopper understand why NAC comparison should start with the exact ingredient line and amount.",
      ),
      buildSectionPlan(
        "respiratory_and_mucus_context",
        "Respiratory and mucus context",
        "Explain the respiratory and mucus-related lane that can appear around NAC without drifting into treatment language.",
        ["Respiratory-adjacent interpretation appears often", "This lane is narrower than broad immune marketing", "Keep the section bounded and non-medical"],
        "Make clear that this is a recognizable but more context-sensitive lane.",
        "Help the shopper understand why NAC can appear in some respiratory-support formulas without meaning every NAC product is positioned the same way.",
      ),
      buildSectionPlan(
        "what_dose_and_use_context_can_change",
        "What dose and use-context can change",
        "Explain why dose, intended use context, and surrounding formula design meaningfully change how NAC labels should be read.",
        ["Dose changes interpretation", "Use context changes label meaning", "Blend formulas and single-ingredient formulas should not be read the same way"],
        "Keep this section practical and label-aware.",
        "Tell the shopper what to compare before assuming two NAC products belong in the same comparison set.",
      ),
    ];
  }

  if (descriptor.ingredientFamily === "collagen") {
    return [
      buildSectionPlan(
        "skin_and_connective_tissue_context",
        "Skin and connective-tissue context",
        "Explain the main skin and connective-tissue lane that usually anchors collagen interpretation on supplement labels.",
        ["Skin and connective-tissue context is the clearest lane", "This is more specific than generic beauty marketing", "Keep the section grounded in supplement comparison rather than aspirational copy"],
        "Show that collagen has a strong recognizable lane without turning every claim into the same promise.",
        "Help the shopper understand why collagen products are often easiest to compare through their skin or connective-tissue framing.",
      ),
      buildSectionPlan(
        "joint_and_structure_context",
        "Joint and structure context",
        "Explain the secondary joint and structural-support lane for collagen without making it sound identical to glucosamine-style products.",
        ["Joint-related interpretation appears often", "Structural-support wording is broader than the clearest beauty lane", "Formula setting still changes what collagen is doing in the product"],
        "Keep this section secondary and context-aware.",
        "Help the shopper understand why some collagen products lean more structural than cosmetic without meaning all collagen labels tell the same story.",
      ),
      buildSectionPlan(
        "source_and_type_context",
        "Source and type context",
        "Explain why source, peptide type, and hydrolyzed-collagen disclosure can change product comparison.",
        ["Marine and bovine collagen should not be treated as identical shorthand", "Type or peptide detail improves comparison", "Do not turn source differences into a universal superiority claim"],
        "Make this a comparison lane, not a best-source ranking.",
        "Tell the shopper why source and type disclosure often matter more than a generic collagen headline.",
      ),
    ];
  }

  if (descriptor.ingredientFamily === "protein") {
    return [
      buildSectionPlan(
        "muscle_and_recovery_context",
        "Muscle and recovery context",
        "Explain the main muscle-support and recovery lane for protein powders and protein-forward supplements.",
        ["Muscle-support context is the clearest lane", "Recovery wording is common but should stay specific", "Keep the interpretation anchored to disclosed protein rather than broad fitness marketing"],
        "Show that protein has a straightforward core lane without making every label equivalent.",
        "Help the shopper compare protein products through the clearest recovery and protein-content story.",
      ),
      buildSectionPlan(
        "satiety_and_meal_support_context",
        "Satiety and meal-support context",
        "Explain the secondary satiety and meal-support lane for protein without flattening it into weight-loss marketing.",
        ["Satiety-related interpretation appears often", "Meal-support positioning is broader than the clearest muscle lane", "Do not let this drift into generic slimming copy"],
        "Keep this section secondary and bounded.",
        "Help the shopper understand why some protein products are positioned more like meal support than pure performance support.",
      ),
      buildSectionPlan(
        "protein_type_and_disclosure_context",
        "Protein type and disclosure context",
        "Explain why protein source, isolate-versus-concentrate detail, and blend complexity change product comparison.",
        ["Whey, pea, soy, and blended protein lines should not be flattened together", "Isolate or concentrate detail changes comparison value", "Flavor systems and add-on actives can make two protein products less comparable than they look"],
        "Make this a practical comparison section.",
        "Tell the shopper what to read before assuming two protein products belong in the same comparison set.",
      ),
    ];
  }

  if (descriptor.ingredientFamily === "fiber") {
    return [
      buildSectionPlan(
        "digestive_regularity_context",
        "Digestive regularity context",
        "Explain the main digestive-regularity lane that makes fiber easier to interpret than broad gut-wellness marketing.",
        ["Digestive-regularity context is the clearest lane", "This is more specific than vague gut-health copy", "Keep the section shopper-facing and product-relevant"],
        "Show that fiber has a recognizable primary lane without making every fiber product interchangeable.",
        "Help the shopper anchor comparison on the clearest and most practical fiber context.",
      ),
      buildSectionPlan(
        "satiety_and_gut_context",
        "Satiety and gut context",
        "Explain the secondary satiety and gut-environment lane for fiber without turning it into a catch-all digestive promise.",
        ["Satiety-related interpretation appears often", "Broader gut-environment language is wider than the clearest regularity lane", "This lane is more context-dependent than the primary lane"],
        "Keep this section secondary and bounded.",
        "Help the shopper keep broad gut-support wording in proportion when comparing fiber products.",
      ),
      buildSectionPlan(
        "source_and_solubility_context",
        "Source and solubility context",
        "Explain why source and solubility detail can materially change fiber comparison.",
        ["Psyllium, inulin, acacia, and mixed fibers should not be read as identical", "Soluble-versus-insoluble context changes label meaning", "Blend complexity can make comparison harder even when the front label sounds similar"],
        "Make this a comparison-oriented section rather than a best-fiber ranking.",
        "Tell the shopper why exact fiber type often matters more than generic digestive-support branding.",
      ),
    ];
  }

  if (descriptor.ingredientFamily === "electrolyte_hydration") {
    return [
      buildSectionPlan(
        "hydration_context",
        "Hydration context",
        "Explain the main hydration lane that usually anchors electrolyte-product interpretation.",
        ["Hydration is the clearest lane", "This is more useful than vague wellness or energy language", "Keep the section grounded in formula reading rather than sports-drink hype"],
        "Show that electrolyte products are easiest to interpret through a straightforward hydration lens.",
        "Help the shopper anchor comparison on the clearest hydration-focused story.",
      ),
      buildSectionPlan(
        "exercise_and_sweat_loss_context",
        "Exercise and sweat-loss context",
        "Explain the narrower exercise and sweat-loss lane for electrolyte products without making every hydration product sound like a sports-performance formula.",
        ["Exercise-related context appears often", "Sweat-loss framing can matter", "Not every hydration formula is built around the same use case"],
        "Keep this section narrower and more use-context dependent than the primary hydration lane.",
        "Help the shopper understand why some electrolyte products are positioned more for training than for everyday hydration.",
      ),
      buildSectionPlan(
        "balance_and_disclosure_context",
        "Balance and disclosure context",
        "Explain why sodium, potassium, magnesium, sugar, and flavor-system disclosure change electrolyte-product comparison.",
        ["Electrolyte balance matters", "Disclosed sodium often changes product comparison more than broad branding", "Sweeteners and add-ons can make similar-looking products less comparable"],
        "Make this a practical comparison section.",
        "Tell the shopper what to read on the label before assuming two hydration products are interchangeable.",
      ),
    ];
  }

  if (descriptor.ingredientFamily === "ashwagandha") {
    return [
      buildSectionPlan(
        "stress_and_mood_related_research",
        "Stress and mood-related research",
        "Explain the main stress- and mood-adjacent lane most often associated with ashwagandha without turning it into a universal calm claim.",
        ["This is usually the clearest ashwagandha lane", "Labels often overextend broad mood or resilience language", "Keep the interpretation narrower than front-label marketing"],
        "Show that this is the most recognizable lane while still keeping evidence-aware boundaries.",
        "Help the shopper understand why stress-related positioning is easier to justify than broad all-purpose wellness messaging.",
      ),
      buildSectionPlan(
        "sleep_and_recovery_context",
        "Sleep and recovery context",
        "Explain the narrower sleep- and recovery-adjacent lane for ashwagandha without making it sound identical to melatonin or exercise ingredients.",
        ["Sleep-adjacent context is real but narrower", "Recovery language varies more by study design and formula setting", "Do not flatten these lanes into one generic support story"],
        "Make this a secondary and more context-dependent lane.",
        "Help the shopper understand why ashwagandha can appear in sleep or recovery products without meaning every ashwagandha label serves the same job.",
      ),
      buildSectionPlan(
        "why_extract_identity_matters",
        "Why extract identity matters",
        "Explain why branded extracts or specific withania extract lines matter when comparing ashwagandha products.",
        ["Extract identity can change how shoppers compare products", "Brand-style extract naming often carries comparison value", "Do not convert extract identity into a universal superiority claim"],
        "Keep this practical and label-aware.",
        "Help the shopper read extract identity as a comparison tool instead of as proof that every ashwagandha product is interchangeable.",
      ),
    ];
  }

  if (descriptor.ingredientFamily === "ginseng") {
    return [
      buildSectionPlan(
        "energy_and_fatigue_context",
        "Energy and fatigue context",
        "Explain the main energy- and fatigue-adjacent lane for ginseng without collapsing it into generic stimulant-style language.",
        ["Energy and fatigue wording is common but can be over-broad", "This lane is more useful when tied to the exact ginseng ingredient", "Keep the interpretation specific and shopper-facing"],
        "Show that this is a recognizable lane, but not a license for broad performance promises.",
        "Help the shopper understand why ginseng labels should be read more specifically than generic energy marketing.",
      ),
      buildSectionPlan(
        "cognitive_and_performance_interpretation",
        "Cognitive and performance interpretation",
        "Explain the broader cognitive or performance lane without making it sound equally strong across all outcomes.",
        ["This lane is more variable than the simplest energy framing", "Different products may lean on different use contexts", "Do not overstate certainty"],
        "Keep this section broader and more interpretive than the primary lane.",
        "Help the shopper keep cognitive or performance positioning in proportion when comparing ginseng products.",
      ),
      buildSectionPlan(
        "why_species_and_extract_detail_matter",
        "Why species and extract detail matter",
        "Explain why species or extract detail changes how a ginseng label should be compared.",
        ["Panax, American, and red ginseng labels are not the same thing", "Extract detail improves comparison", "Species naming often matters more than broad front-label positioning"],
        "Make this a comparison lane, not a superiority claim.",
        "Help the shopper understand why species and extract detail can carry more decision value than a generic ginseng headline.",
      ),
    ];
  }

  if (descriptor.ingredientFamily === "green_tea_extract") {
    return [
      buildSectionPlan(
        "catechin_and_antioxidant_context",
        "Catechin and antioxidant context",
        "Explain the catechin- and antioxidant-adjacent lane most often associated with green tea extract without turning it into a broad wellness cliché.",
        ["Catechin or EGCG detail often matters", "Antioxidant framing is common but should stay specific", "Do not let this become generic tea marketing"],
        "Show that this lane is real, but best read through the exact extract line.",
        "Help the shopper understand why catechin-focused disclosure often matters more than broad antioxidant wording.",
      ),
      buildSectionPlan(
        "metabolic_and_weight_related_interpretation",
        "Metabolic and weight-related interpretation",
        "Explain the metabolic or weight-related lane carefully, without turning it into a weight-loss promise.",
        ["This lane is common in positioning but easy to overread", "Outcome interpretation depends on context", "Keep the tone evidence-aware and bounded"],
        "Show that this is a broader and more easily overstated lane.",
        "Help the shopper keep metabolic or weight-oriented packaging in proportion when comparing products.",
      ),
      buildSectionPlan(
        "why_extract_concentration_matters",
        "Why extract concentration matters",
        "Explain why extract concentration or catechin detail changes product comparison.",
        ["Extract concentration can change comparison value", "Named EGCG or catechin detail improves label reading", "Do not turn concentration detail into a universal superiority story"],
        "Keep this section practical and comparison-focused.",
        "Help the shopper understand why a detailed extract line is often more useful than a generic green tea label.",
      ),
    ];
  }

  if (descriptor.ingredientFamily === "7keto_dhea_metabolite") {
    return [
      buildSectionPlan(
        "metabolic_and_body_composition_context",
        "Metabolic and body-composition context",
        "Explain the body-composition and metabolic-rate lane that makes 7-Keto easier to interpret than generic fat-loss marketing.",
        ["Metabolic and body-composition context is the clearest lane", "Broad fat-loss language is looser than the best comparison lane", "Amount and formula setting still matter"],
        "Keep this lane practical and product-aware rather than hypey.",
        "Help the shopper compare 7-Keto labels through the exact disclosed active and the rest of the formula.",
      ),
      buildSectionPlan(
        "why_it_reads_differently_from_dhea",
        "Why it reads differently from DHEA",
        "Explain why 7-Keto is usually interpreted through its own metabolite lane instead of being treated like ordinary DHEA marketing shorthand.",
        ["The shopper should not flatten 7-Keto into a generic DHEA story", "Formula context still changes comparison value", "The exact row and amount matter more than broad category language"],
        "Use this section to keep interpretation specific and comparison-oriented.",
        "Help the shopper understand why 7-Keto products should be compared through the exact metabolite line, not through broad category assumptions.",
      ),
    ];
  }

  if (descriptor.ingredientFamily === "cla") {
    return [
      buildSectionPlan(
        "body_composition_context",
        "Body-composition context",
        "Explain the body-composition and fat-metabolism lane that makes CLA easier to interpret than generic slimming copy.",
        ["Body-composition context is the clearest CLA lane", "Generic slimming or weight-loss language can overreach", "The exact formula and disclosed amount still matter"],
        "Keep this lane specific and shopper-safe.",
        "Help the shopper compare CLA products through the exact fatty-acid line and disclosed amount.",
      ),
      buildSectionPlan(
        "source_oil_and_isomer_detail",
        "Source oil and isomer detail",
        "Explain why safflower-oil source detail or CLA isomer wording can change how directly one CLA label compares with another.",
        ["Source-oil detail can change comparison value", "Isomer or source wording helps separate similar-sounding CLA labels", "Do not turn this into a universal superiority claim"],
        "Keep this section label-aware and comparison-focused.",
        "Tell the shopper why the source line matters before treating two CLA formulas as close substitutes.",
      ),
    ];
  }

  if (descriptor.ingredientFamily === "carnitine") {
    return [
      buildSectionPlan(
        "energy_transport_and_exercise_context",
        "Energy transport and exercise context",
        "Explain the energy-transport and exercise-context lane that makes carnitine easier to interpret than generic performance slogans.",
        ["Energy-transport context is the clearest lane", "Broad performance language can sound bigger than the main evidence lane", "Amount and formula setting still shape interpretation"],
        "Keep this lane product-aware and comparison-friendly.",
        "Help the shopper compare carnitine products through the exact active line and the disclosed amount.",
      ),
      buildSectionPlan(
        "what_form_disclosure_changes_for_carnitine",
        "What form disclosure changes",
        "Explain why acetyl-L-carnitine, L-carnitine tartrate, or other form wording changes how shoppers compare carnitine formulas.",
        ["Form disclosure changes comparison value", "Different carnitine forms often live in different shopping contexts", "Do not turn this into a best-form ranking"],
        "Keep this section precise and label-aware.",
        "Help the shopper understand why carnitine form detail often matters more than broad performance packaging language.",
      ),
    ];
  }

  if (descriptor.ingredientFamily === "5htp") {
    return [
      buildSectionPlan(
        "serotonin_precursor_context",
        "Serotonin-precursor context",
        "Explain the main serotonin-precursor lane that makes 5-HTP easier to interpret than generic mood or sleep marketing.",
        ["Serotonin-precursor context is the clearest lane", "Mood or sleep positioning should stay narrower than broad wellness claims", "Interpretation still depends on dose and formula setting"],
        "Keep this lane specific and product-aware rather than turning it into a blanket claim.",
        "Help the shopper compare 5-HTP products through the exact active line and the disclosed amount.",
      ),
      buildSectionPlan(
        "formula_pairing_and_dose_context",
        "Formula pairing and dose context",
        "Explain how B-vitamin, glycine, taurine, or inositol pairings can change the way 5-HTP is read on the label without replacing it as the lead active.",
        ["Supporting lines can change formula interpretation", "The main 5-HTP line still does most of the comparison work", "Amount and co-formulation both matter"],
        "Use this section to explain formula reading rather than to pad the card with generic caution language.",
        "Tell the shopper what to compare before assuming two 5-HTP formulas are interchangeable.",
      ),
    ];
  }

  if (descriptor.ingredientFamily === "b3_niacinamide") {
    return [
      buildSectionPlan(
        "b3_coenzyme_context",
        "B3 coenzyme context",
        "Explain the coenzyme and metabolism-related lane that makes niacinamide or vitamin B3 easier to interpret than broad energy copy.",
        ["Coenzyme context is the clearest lane", "Broad energy language is looser than the main interpretation lane", "The stated amount still matters"],
        "Keep this lane practical and shopper-safe rather than generic.",
        "Help the shopper read B3 through the actual ingredient line and amount instead of broad category language.",
      ),
      buildSectionPlan(
        "companion_role_on_the_label",
        "Companion role on the label",
        "Explain why niacinamide often acts like a supporting nutrient in multi-ingredient formulas even when it is clearly disclosed.",
        ["B3 can be central or supportive depending on the formula", "Supporting nutrient rows should not be over-read as the whole product story", "The rest of the formula changes comparison value"],
        "Use this section to explain formula role, not to flatten every B3 product into the same narrative.",
        "Help the shopper decide whether the B3 row is the main thing to compare or just one part of a broader formula.",
      ),
    ];
  }

  if (descriptor.ingredientFamily === "glycine") {
    return [
      buildSectionPlan(
        "glycine_formula_context",
        "Glycine formula context",
        "Explain the amino-acid and formula-support lane that makes glycine easier to interpret than generic calm or sleep filler.",
        ["Glycine often shows up as a formula-support ingredient", "Its role can shift between lead-active and supporting contexts", "The exact amount changes how much weight to give it"],
        "Keep this section practical and ingredient-specific.",
        "Help the shopper understand whether glycine is the story of the product or part of a broader formula setup.",
      ),
      buildSectionPlan(
        "coformulation_changes_reading",
        "How co-formulation changes the reading",
        "Explain how glycine behaves differently when it appears next to ingredients like 5-HTP or taurine versus when it stands more on its own.",
        ["Co-formulation changes interpretation", "Supporting roles should not be mistaken for the main active", "Comparison still depends on the rest of the disclosed formula"],
        "Keep this grounded in label interpretation rather than generic caveats.",
        "Tell the shopper why the same glycine row can mean different things in different products.",
      ),
    ];
  }

  if (descriptor.ingredientFamily === "taurine") {
    return [
      buildSectionPlan(
        "taurine_physiology_context",
        "Taurine physiology context",
        "Explain the main physiology and formulation lane that makes taurine easier to interpret than broad energy or performance slogans.",
        ["Taurine has recognizable physiology-related context", "Front-label performance wording can be broader than the clearest lane", "Dose and formula setting still shape interpretation"],
        "Keep this lane narrow and product-aware rather than hypey.",
        "Help the shopper compare taurine products through the actual row and amount instead of broad category language.",
      ),
      buildSectionPlan(
        "taurine_formula_role",
        "Taurine formula role",
        "Explain why taurine can act as either a lead active or a supporting line depending on the rest of the formula.",
        ["Formula role matters", "Supporting taurine rows should not automatically be treated like the headline story", "The co-ingredients change comparison value"],
        "Use this section to explain the row's job on the label.",
        "Help the shopper decide whether taurine is central to the comparison or mainly part of a broader blend.",
      ),
    ];
  }

  if (descriptor.ingredientFamily === "inositol") {
    return [
      buildSectionPlan(
        "inositol_signaling_context",
        "Inositol signaling context",
        "Explain the signaling and formula-context lane that makes inositol more specific than broad mood or hormone-adjacent marketing.",
        ["Signaling-related context is the clearest lane", "Broad mood or hormone language can stretch past the cleanest interpretation", "The exact formula setting still matters"],
        "Keep this section product-aware and shopper-safe.",
        "Help the shopper understand what makes an inositol row more or less central to comparison.",
      ),
      buildSectionPlan(
        "inositol_amount_and_pairing",
        "Amount and pairing context",
        "Explain why disclosed amount and co-formulation matter so much when shoppers compare inositol formulas.",
        ["Amount changes interpretation", "Pairing with other actives changes the role of the row", "Not every inositol line deserves the same comparison weight"],
        "Use this section for practical comparison, not for padding with generic caution.",
        "Tell the shopper what to read before assuming two inositol products belong in the same comparison set.",
      ),
    ];
  }

  if (descriptor.ingredientFamily === "vitamin_c") {
    return [
      buildSectionPlan(
        "antioxidant_and_immune_research",
        "Antioxidant and immune research",
        "Explain the main antioxidant and immune-related research contexts for vitamin C.",
        ["Antioxidant marker context", "Immune-function context", "Do not convert this into disease-prevention language"],
        "Show that research exists but broad immune claims should stay evidence-aware.",
        "Help the shopper distinguish legitimate research context from overextended marketing language.",
      ),
      buildSectionPlan(
        "collagen_and_tissue_support",
        "Collagen and tissue support",
        "Explain why vitamin C appears in collagen and connective-tissue research.",
        ["Collagen formation context", "Tissue-support context", "Applicability depends on product setting"],
        "Keep this grounded in function and context rather than dramatic claims.",
        "Help the shopper see why this ingredient appears in skin, connective-tissue, and structure-oriented products.",
      ),
      buildSectionPlan(
        "iron_absorption_context",
        "Iron absorption context",
        "Explain the specific context in which vitamin C is discussed alongside iron.",
        ["Iron co-administration context", "Formula setting matters", "Not every vitamin C product is being used for this purpose"],
        "Keep this as a context-specific research area, not a generic promise.",
        "Show that product comparison depends on whether the formula and use case actually match this context.",
      ),
    ];
  }

  if (descriptor.ingredientFamily === "vitamin_d") {
    return [
      buildSectionPlan(
        "bone_and_calcium_regulation_context",
        "Bone and calcium regulation context",
        "Explain the main bone and calcium-regulation lane for vitamin D without drifting into generic health language.",
        ["Bone and calcium-regulation context", "This is usually the clearest and most grounded lane", "Keep broader claims secondary"],
        "Show that this is the most established reading of vitamin D on a supplement label.",
        "Help the shopper anchor comparison on the exact vitamin D ingredient and disclosed amount rather than on broad wellness phrasing.",
      ),
      buildSectionPlan(
        "immune_and_broader_health_research",
        "Immune and broader health research",
        "Explain that vitamin D is also discussed in immune and broader health research, but not every outcome is equally settled.",
        ["Immune-related context", "Broader health language is wider than the clearest evidence lane", "Interpretation depends on the exact outcome and study setting"],
        "Keep this as a broader and less tidy lane than bone-focused context.",
        "Help the shopper understand why broad vitamin D marketing can outrun the cleanest evidence.",
      ),
      buildSectionPlan(
        "what_interpretation_depends_on",
        "What interpretation depends on",
        "Explain why dose, baseline status, and label detail change how vitamin D research should be read.",
        ["Baseline status changes interpretation", "Dose and formula setting matter", "Label detail still matters when comparing products"],
        "Make this a practical interpretation section, not a clinical instruction section.",
        "Help the shopper know what to compare before assuming two vitamin D products are equivalent.",
      ),
    ];
  }

  if (descriptor.ingredientFamily === "b12") {
    return [
      buildSectionPlan(
        "deficiency_and_supplementation_context",
        "Deficiency and supplementation context",
        "Explain the main supplementation and deficiency-related lens that usually anchors vitamin B12 interpretation.",
        ["Supplementation context is the clearest lane", "This is more specific than generic energy language", "Keep the lane practical and shopper-safe"],
        "Make clear that B12 is easiest to read through supplementation context rather than broad vitality marketing.",
        "Help the shopper compare B12 products through the ingredient, dose, and formula setting instead of through generic energy promises.",
      ),
      buildSectionPlan(
        "nerve_and_blood_cell_context",
        "Nerve and blood-cell context",
        "Explain the nerve and red-blood-cell context that often appears in vitamin B12 discussion.",
        ["Nerve-related interpretation appears often", "Red-blood-cell context helps explain why B12 appears in some formulas", "Do not flatten this into a universal wellness slogan"],
        "Keep this section narrower than generic energy or focus claims.",
        "Help the shopper understand why B12 can appear in more than one product category without meaning every B12 label is saying the same thing.",
      ),
      buildSectionPlan(
        "what_form_disclosure_changes",
        "What form disclosure changes",
        "Explain why the disclosed B12 form can change label interpretation and product comparison without turning the card into a best-form ranking.",
        ["Form disclosure can change comparison value", "Different B12 forms are often discussed for label-reading and positioning reasons", "Do not declare one form universally superior"],
        "Keep the section comparison-oriented and careful.",
        "Tell the shopper why methylcobalamin, cyanocobalamin, or other form lines can matter when comparing products.",
      ),
    ];
  }

  if (descriptor.ingredientFamily === "folate") {
    return [
      buildSectionPlan(
        "folate_status_and_supplementation_context",
        "Folate status and supplementation context",
        "Explain the main supplementation lane that makes folate easiest to interpret on a label.",
        ["Supplementation context is the clearest lane", "This is more useful than broad wellness framing", "Keep the lane practical rather than medicalized"],
        "Make clear that folate labels are easiest to compare through the exact ingredient and amount.",
        "Help the shopper anchor comparison on the actual folate row instead of on generic B-vitamin language.",
      ),
      buildSectionPlan(
        "pregnancy_and_developmental_context",
        "Pregnancy and developmental context",
        "Explain why pregnancy and developmental context often appears around folate without turning the section into medical advice.",
        ["Developmental context matters", "Pregnancy-related positioning is narrower than generic wellness copy", "Do not overstate universality across all folate products"],
        "Keep this lane specific and shopper-safe.",
        "Help the shopper understand why folate products can be positioned differently depending on the formula setting and use context.",
      ),
      buildSectionPlan(
        "what_form_labeling_changes",
        "What form labeling changes",
        "Explain why folic acid versus methylfolate-style labeling changes comparison value without turning the card into a one-line superiority claim.",
        ["Form labeling changes product comparison", "Different folate labels can signal different formula positioning", "Do not declare one label form universally superior"],
        "Keep this section label-aware and practical.",
        "Tell the shopper why the exact folate label line is worth checking before assuming two products are interchangeable.",
      ),
    ];
  }

  if (descriptor.ingredientFamily === "b6") {
    return [
      buildSectionPlan(
        "cofactor_and_metabolism_context",
        "Cofactor and metabolism context",
        "Explain the main cofactor and metabolism-related context that makes vitamin B6 easier to interpret than generic energy copy.",
        ["Cofactor context is the clearest lane", "Metabolism language should stay specific", "Avoid turning this into broad energy filler"],
        "Make clear that B6 should be read through specific functional context rather than generic wellness wording.",
        "Help the shopper compare B6 products through the disclosed ingredient and amount instead of broad category language.",
      ),
      buildSectionPlan(
        "nerve_related_interpretation",
        "Nerve-related interpretation",
        "Explain the narrower nerve-related lane that can appear in vitamin B6 discussion without stretching it into a universal claim.",
        ["Nerve-related context appears in some settings", "This lane is narrower than generic energy marketing", "Interpretation still depends on the formula setting"],
        "Keep the section specific and non-hypey.",
        "Help the shopper see why B6 can sound broader on the front of the label than it really is in comparison terms.",
      ),
      buildSectionPlan(
        "why_dose_context_matters",
        "Why dose context matters",
        "Explain why the stated amount and formula context matter when comparing vitamin B6 products.",
        ["Dose changes interpretation", "Form and amount both matter", "The rest of the formula can change how central B6 is"],
        "Use this section for practical interpretation rather than as a generic caveat.",
        "Tell the shopper what to check before assuming two B6 products belong in the same comparison set.",
      ),
    ];
  }

  if (descriptor.ingredientFamily === "zinc") {
    return [
      buildSectionPlan(
        "immune_function_context",
        "Immune function context",
        "Explain the main immune-related research lane for zinc.",
        ["Immune-function outcomes", "Context depends on dose and population", "Avoid broad cure-like language"],
        "Make visible that immune positioning is common but not infinitely broad.",
        "Help the shopper interpret immune framing more carefully.",
      ),
      buildSectionPlan(
        "skin_and_barrier_research",
        "Skin and barrier research",
        "Explain the skin and barrier-related research lane for zinc.",
        ["Skin-related context", "Barrier-related context", "Applicability varies by product and dose"],
        "Keep this narrower and more context-dependent than the immune section.",
        "Help the shopper understand why some zinc products are positioned differently from others.",
      ),
    ];
  }

  if (descriptor.ingredientFamily === "magnesium") {
    return [
      buildSectionPlan(
        "common_use_contexts",
        "Common use contexts",
        "Explain the main supplementation and research contexts in which magnesium most often appears.",
        ["Relaxation, muscle, and sleep-adjacent contexts are common", "Not every common use sits on the same kind of evidence", "Keep this anchored to supplementation context rather than generic wellness copy"],
        "Show that magnesium is versatile, but not infinitely broad.",
        "Help the shopper see why magnesium can appear in more than one product category without turning it into a catch-all ingredient.",
      ),
      buildSectionPlan(
        "form_and_tolerability_context",
        "Form and tolerability context",
        "Explain why form disclosure matters for magnesium, especially in shopper-facing comparison and tolerability discussions.",
        ["Different forms are often used for different label positions", "Tolerability and label meaning can change with the disclosed form", "Do not reduce this to a single best-form claim"],
        "Keep this section nuanced and comparison-oriented.",
        "Help the shopper understand why magnesium form is often one of the first things to compare.",
      ),
      buildSectionPlan(
        "what_product_comparison_depends_on",
        "What product comparison depends on",
        "Explain which label details matter most when comparing magnesium products.",
        ["Exact form matters", "Disclosed amount matters", "Complex or blend labels can make comparison harder"],
        "Make this a practical comparison section.",
        "Tell the shopper what to check on the label before assuming similar magnesium products are interchangeable.",
      ),
    ];
  }

  if (descriptor.ingredientFamily === "calcium") {
    return [
      buildSectionPlan(
        "bone_and_intake_context",
        "Bone and intake context",
        "Explain the main bone and calcium-intake context that makes calcium easy to position on supplement labels.",
        ["Bone-related context is the clearest lane", "Intake context matters more than broad generic health language", "Keep the section grounded and product-relevant"],
        "Show that calcium is easiest to interpret through intake and bone-related context.",
        "Help the shopper anchor calcium comparison on the most straightforward and established lane.",
      ),
      buildSectionPlan(
        "form_and_absorption_context",
        "Form and absorption context",
        "Explain why calcium form shows up in shopping decisions without turning the card into a best-form ranking.",
        ["Different forms are often compared for practicality and absorption context", "Carbonate and citrate lines are often read differently", "Do not overstate superiority"],
        "Keep this section careful, practical, and non-hypey.",
        "Help the shopper understand why form disclosure can matter when comparing calcium products.",
      ),
      buildSectionPlan(
        "how_coformulation_changes_comparison",
        "How co-formulation changes comparison",
        "Explain how combo formulas can change the way shoppers interpret calcium rows.",
        ["Paired nutrients can change why calcium is in the formula", "Combo products are not always built around calcium as the primary story", "The rest of the label changes how central calcium is"],
        "Use this section to prevent over-reading calcium in mixed formulas.",
        "Help the shopper decide whether calcium is the main thing being compared or just part of a broader formula.",
      ),
    ];
  }

  if (descriptor.ingredientFamily === "iron") {
    return [
      buildSectionPlan(
        "iron_status_and_deficiency_context",
        "Iron status and deficiency context",
        "Explain the main supplementation context in which iron research is usually interpreted without turning it into self-diagnosis advice.",
        ["Iron supplementation is usually read through status-related context", "This is more specific than broad energy marketing", "Keep the lane outcome-aware and shopper-safe"],
        "Make clear that this is a focused supplementation lane, not generic fatigue copy.",
        "Help the shopper understand why iron products are usually compared more narrowly than many other supplement categories.",
      ),
      buildSectionPlan(
        "form_and_tolerability_context",
        "Form and tolerability context",
        "Explain why iron form and tolerability often matter in product comparison.",
        ["Different forms can be discussed for tolerability and label interpretation", "Form disclosure helps comparison", "Do not turn form differences into absolute superiority claims"],
        "Keep this section practical and careful.",
        "Help the shopper understand why form can matter even when two products look similar at the top line.",
      ),
      buildSectionPlan(
        "what_product_comparison_depends_on",
        "What product comparison depends on",
        "Explain which label details are most useful when comparing iron products.",
        ["Exact form matters", "Disclosed amount matters", "Paired-nutrient context can matter in some formulas"],
        "Keep this operational and product-comparison focused.",
        "Tell the shopper what to read before assuming two iron products are interchangeable.",
      ),
    ];
  }

  if (descriptor.ingredientFamily === "melatonin") {
    return [
      buildSectionPlan(
        "sleep_timing_and_onset_context",
        "Sleep timing and onset context",
        "Explain the main circadian and sleep-onset context for melatonin without drifting into generic bedtime advice.",
        ["Sleep timing and onset are the main research lane", "Circadian context matters", "Avoid turning this into a broad sleep cure claim"],
        "Show that melatonin is best read through timing-related context rather than generic sleep marketing.",
        "Help the shopper understand why timing context matters when comparing melatonin products.",
      ),
      buildSectionPlan(
        "what_dose_and_use_context_can_change",
        "What dose and use-context can change",
        "Explain why dose, timing, and intended use context shape how melatonin products should be interpreted.",
        ["Dose changes interpretation", "Use context changes expectations", "Products that look similar can still be positioned differently"],
        "Keep this section practical and non-medical.",
        "Tell the shopper what to compare on the label instead of reducing melatonin to a single generic use case.",
      ),
    ];
  }

  if (descriptor.ingredientFamily === "omega_3") {
    if (isOmega3Epa(name)) {
      return [
        buildSectionPlan(
          "lipid_and_triglyceride_research",
          "Lipid and triglyceride research",
          "Explain that EPA is most strongly associated with triglyceride and lipid-marker discussions.",
          ["Triglyceride and lipid endpoints", "This is the strongest and most direct research lane", "Do not flatten all heart claims into this lane"],
          "Make clear that lipid endpoints are a stronger lane than broad heart-health wording.",
          "Tell the shopper this is the research area where EPA is easiest to compare across products.",
        ),
        buildSectionPlan(
          "inflammation_and_recovery_context",
          "Inflammation and recovery context",
          "Explain the secondary lane around inflammation, recovery, and adjacent performance contexts.",
          ["Inflammation-related context", "Recovery-related context", "Less settled than lipid endpoints"],
          "Show this as a secondary and more mixed lane.",
          "Tell the shopper not to weight these outcomes the same way as triglyceride data.",
        ),
        buildSectionPlan(
          "broader_heart_claim_boundaries",
          "How this differs from broader heart claims",
          "Explain that general heart-health marketing is broader than the most specific research endpoints.",
          ["Broader cardiovascular claims can overrun the exact evidence", "Endpoint specificity matters", "Dose and baseline risk can change interpretation"],
          "Make this section explicitly about boundary-setting.",
          "Help the shopper resist reading a narrow lipid signal as a universal heart promise.",
        ),
      ];
    }

    if (isOmega3Dha(name)) {
      return [
        buildSectionPlan(
          "brain_and_eye_context",
          "Brain and eye context",
          "Explain that DHA often appears in brain and eye-related research contexts.",
          ["Retinal and eye context", "Brain structure or function context", "Not every broad cognition claim is equally strong"],
          "Show that the research lane is real but not identical across all brain claims.",
          "Tell the shopper why DHA is usually read differently from EPA.",
        ),
        buildSectionPlan(
          "developmental_and_structural_roles",
          "Developmental and structural roles in research",
          "Explain the developmental and structural lens that often appears around DHA.",
          ["Structural role context", "Developmental context", "Adult interpretation can differ from developmental interpretation"],
          "Make clear that context matters a lot here.",
          "Help the shopper avoid collapsing developmental research into generic adult promises.",
        ),
        buildSectionPlan(
          "how_this_differs_from_epa",
          "How this differs from EPA-focused outcomes",
          "Directly explain that DHA should not be read as an EPA clone.",
          ["EPA and DHA are related but not interchangeable in research framing", "Outcome emphasis changes", "Comparison requires reading the breakdown lines carefully"],
          "Use this section to separate DHA from copy-paste omega-3 language.",
          "Tell the shopper why the EPA/DHA split on the label is worth paying attention to.",
        ),
      ];
    }

    return [
      buildSectionPlan(
        "most_studied_lipid_endpoints",
        "Most studied: lipid-related endpoints",
        "Explain the main lipid and triglyceride lane for combined omega-3 actives.",
        ["Lipid-marker context", "Triglyceride context", "This is more concrete than broad wellness language"],
        "Show that lipid endpoints are the clearest evidence lane.",
        "Help the shopper anchor comparison on specific omega-3 outcomes rather than vague promises.",
      ),
      buildSectionPlan(
        "broader_cardiovascular_context",
        "Broader cardiovascular context",
        "Explain that broader cardiovascular claims are wider and more varied than the core lipid lane.",
        ["Broader cardiovascular discussions exist", "Not every outcome is equally strong", "Interpretation depends on endpoint and study design"],
        "Make this section boundary-setting, not hype.",
        "Help the shopper understand where broad claims outrun the cleanest evidence.",
      ),
      buildSectionPlan(
        "secondary_contexts",
        "Secondary contexts in brain, eye, and joint discussions",
        "Explain that omega-3s also appear in broader secondary research areas.",
        ["Brain-related context", "Eye-related context", "Joint-related context"],
        "Keep this secondary and more variable than the primary lipid lane.",
        "Help the shopper see these as adjacent areas, not the main reason to compare products.",
      ),
    ];
  }

  if (descriptor.ingredientFamily === "probiotic_or_blend") {
    return [
      buildSectionPlan(
        "digestive_and_microbiome_research",
        "Digestive and microbiome research",
        "Explain the digestive and microbiome lane most often associated with probiotic ingredients.",
        ["Digestive-comfort context", "Microbiome context", "Applicability depends on the exact named strains"],
        "Make it clear that broad probiotic language is less useful than strain-matched context.",
        "Help the shopper understand why the exact strain list matters more than the category label alone.",
      ),
      buildSectionPlan(
        "strain_specificity_and_fit",
        "Why strain specificity matters",
        "Explain why probiotic research is hard to map when labels stay broad.",
        ["Exact strain names matter", "Amounts and CFU matter", "Broad labels weaken research matching"],
        "Use this section to explain precision limits, not to pad the card.",
        "Help the shopper see why better disclosure usually improves comparability.",
      ),
    ];
  }

  return [
    buildSectionPlan(
      "most_studied_roles",
      "Most studied roles",
      "Explain the main roles or outcome areas most often associated with this ingredient category.",
      ["Most common research directions", "Outcome emphasis depends on the exact ingredient", "Not every broad claim is equally strong"],
      "Show that some areas are more grounded than others.",
      "Help the shopper understand what kind of claim is more central versus more peripheral.",
    ),
    buildSectionPlan(
      "why_interpretation_depends_on_detail",
      "Why interpretation depends on detail",
      "Explain why amount, exact form, and formula setting affect interpretation.",
      ["Amount matters", "Exact ingredient identity matters", "Formula and label detail change applicability"],
      "Keep this grounded in label interpretation, not form-superiority hype.",
      "Help the shopper see why seemingly similar products may not be equally comparable.",
    ),
  ];
};

const buildLabelContextPlan = (
  descriptor: IngredientScienceDescriptor,
): ScientificBackgroundSectionPlan[] => {
  const name = descriptor.name;
  if (descriptor.ingredientFamily === "probiotic_or_blend" && descriptor.lineRole === "blend_line") {
    return [
      buildSectionPlan(
        "what_this_blend_line_shows",
        "What this blend line does and does not show",
        "Explain that a broad blend line can describe the formula category without fully disclosing the exact research-target components underneath it.",
        ["This line gives formula-level context", "It does not fully map the label to named strains or named subcomponents", "A blend total is not the same as item-level disclosure"],
        "Frame this as a disclosure and interpretation issue rather than a stand-alone efficacy claim.",
        "Help the shopper understand why a broad blend label is useful as context but weaker for exact comparison.",
      ),
      buildSectionPlan(
        "why_specific_disclosure_changes_fit",
        "Why deeper disclosure changes comparison",
        "Explain why named strains, named subcomponents, or more granular disclosure make research interpretation easier.",
        ["Specific naming improves research matching", "Blend totals alone leave important comparison gaps", "More detail usually improves product-to-product comparability"],
        "Keep the focus on research fit and transparency, not on hype.",
        "Help the shopper see why a more itemized label is usually easier to compare than a broad blend line by itself.",
      ),
    ];
  }

  if (descriptor.ingredientFamily === "omega_3" && isOmega3Total(name)) {
    return [
      buildSectionPlan(
        "what_this_total_line_means",
        "What this total line means on the label",
        "Explain that this line reports a total omega-3 pool rather than one discrete stand-alone fatty acid.",
        ["This is a total disclosure line", "It combines more than one omega-3 component", "It does not replace the EPA and DHA breakdown lines"],
        "Explain that this is a label-reading tool more than a direct research target.",
        "Help the shopper use the total line for comparison without confusing it with a single ingredient.",
      ),
      buildSectionPlan(
        "why_form_and_breakdown_still_matter",
        "Why the breakdown still matters",
        "Explain that a total line is most useful when read alongside the more specific omega-3 entries.",
        ["EPA and DHA lines still matter", "The declared form can change how the label is interpreted", "Top-line totals are not the whole story"],
        "Keep this section practical and comparison-oriented.",
        "Help the shopper know which rows to read next before comparing products.",
      ),
    ];
  }

  if (descriptor.ingredientFamily === "omega_3" && isOmega3Source(name)) {
    return [
      buildSectionPlan(
        "what_this_source_line_means",
        "What this source line means on the label",
        "Explain that this line identifies the oil source rather than fully breaking out the active omega-3 profile.",
        ["This is a source line", "It tells you where the omega-3s come from", "It is not the same as the EPA and DHA breakdown"],
        "Make clear that source identity and active breakdown are different jobs on the label.",
        "Help the shopper understand why source-oil identity and fatty-acid profile are not interchangeable.",
      ),
      buildSectionPlan(
        "how_to_compare_from_here",
        "How to compare from here",
        "Explain how shoppers should move from the source line to the more decision-useful omega-3 lines.",
        ["Read the total omega-3 line", "Read the EPA and DHA lines", "Use the source line as context, not as the whole story"],
        "Keep this operational and label-focused.",
        "Help the shopper know what to compare next instead of over-reading the source line.",
      ),
    ];
  }

  if (descriptor.ingredientFamily === "electrolyte_hydration") {
    return [
      buildSectionPlan(
        "what_this_hydration_line_means",
        "What this hydration line means on the label",
        "Explain that this line usually identifies a hydration or electrolyte formula concept rather than a single stand-alone research ingredient.",
        ["This is a formula-identity line", "It usually works as context for the mineral and active rows underneath it", "It does not replace the disclosed electrolyte breakdown"],
        "Keep this as a label-reading section rather than a stand-alone efficacy claim.",
        "Help the shopper understand what this hydration line is doing before comparing products.",
      ),
      buildSectionPlan(
        "why_balance_and_disclosure_still_matter",
        "Why balance and disclosure still matter",
        "Explain why the more decision-useful comparison details are usually the disclosed electrolytes, carbohydrate system, and use-context cues underneath the broad hydration line.",
        ["Mineral balance still matters", "The broad hydration line is not the whole comparison answer", "More itemized disclosure makes these products easier to compare"],
        "Keep this practical and label-focused.",
        "Help the shopper know which details to read next instead of overweighting the hydration headline.",
      ),
    ];
  }

  return [
    buildSectionPlan(
      "what_this_line_means",
      "What this line means on the label",
      "Explain what role this selected line plays in the formula instead of treating it like a stand-alone research ingredient.",
      ["This line is part of the label structure", "It is not always the most direct research target", "Its meaning depends on the surrounding formula lines"],
      "Explain that this is a label-context interpretation task more than a direct research summary.",
      "Help the shopper understand how to read the line before comparing products.",
    ),
    buildSectionPlan(
      "why_it_matters_for_comparison",
      "Why it matters for comparison",
      "Explain what this selected line does and does not tell the shopper when comparing products.",
      ["Some lines give context, not the full answer", "Other rows may be more decision-useful", "Comparability depends on the rest of the disclosure"],
      "Keep this grounded in label meaning and comparison value.",
      "Help the shopper avoid overweighting this line when other rows carry the real comparison value.",
    ),
  ];
};

const buildMissingDescriptorLabelContextPlan = (): ScientificBackgroundSectionPlan[] => [
  buildSectionPlan(
    "what_this_line_means",
    "What this line means on the label",
    "Explain this product line as a label-context interpretation, not as a stand-alone research claim.",
    [
      "This line helps decode label structure",
      "It should be read with nearby ingredient rows",
      "Comparability depends on surrounding disclosure detail",
    ],
    "Keep this grounded in label interpretation and comparison value.",
    "Help the shopper decide how much weight this line should carry before comparing products.",
  ),
  buildSectionPlan(
    "why_it_matters_for_comparison",
    "Why it matters for comparison",
    "Explain how this line changes confidence and comparability when products are compared side by side.",
    [
      "This line provides context, not the full answer",
      "Other rows may carry stronger decision weight",
      "Cleaner disclosure improves comparison confidence",
    ],
    "Keep this practical and shopper-facing.",
    "Help the shopper avoid overweighting one vague line when the rest of the label is thin.",
  ),
];

export const planScientificBackgroundSections = (params: {
  context: IngredientScienceContext;
  selectedIngredientName: string;
}): ScientificBackgroundPlan => {
  const descriptor =
    getSelectedDescriptor(params.context, params.selectedIngredientName) ??
    params.context.ingredientDescriptors[0] ??
    null;
  const selectedLabel =
    (
      descriptor?.name
      ?? normalizeText(params.selectedIngredientName)
      ?? normalizeText(params.context.anchorIngredient?.name)
      ?? normalizeText(params.context.productName)
    )
    || "Supplement label context";
  const selectedDose = descriptor?.dose ?? null;
  const family = descriptor?.ingredientFamily ?? params.context.ingredientFamily;
  const mode = descriptor ? resolveScientificBackgroundMode(params.context, descriptor) : "label_context_mode";
  const sections =
    !descriptor
      ? buildMissingDescriptorLabelContextPlan()
      : mode === "label_context_mode"
        ? buildLabelContextPlan(descriptor)
        : buildResearchPlan(params.context, descriptor);

  return {
    mode,
    selectedLabel,
    selectedDose,
    family,
    sections: sections.slice(0, 3),
  };
};

export const resolveScientificBackgroundExecutionProfile = (
  plan: ScientificBackgroundPlan,
): ScientificBackgroundExecutionProfile => {
  if (plan.mode === "label_context_mode") {
    return {
      preferLiveWriter: false,
      timeoutMs: LABEL_CONTEXT_MODE_TIMEOUT_MS,
      backgroundRefreshTimeoutMs: LABEL_CONTEXT_MODE_TIMEOUT_MS,
      maxRetries: 0,
      backgroundRefreshMaxRetries: 0,
      maxTokens: LABEL_CONTEXT_MODE_MAX_TOKENS,
      cacheTtlMs: LABEL_CONTEXT_MODE_CACHE_TTL_MS,
    };
  }

  if (plan.family === "omega_3") {
    return {
      preferLiveWriter: true,
      timeoutMs: isOmega3Dha(plan.selectedLabel) ? DHA_RESEARCH_MODE_TIMEOUT_MS : OMEGA3_RESEARCH_MODE_TIMEOUT_MS,
      backgroundRefreshTimeoutMs: DHA_RESEARCH_MODE_BACKGROUND_REFRESH_TIMEOUT_MS,
      maxRetries: TARGETED_RESEARCH_MODE_MAX_RETRIES,
      backgroundRefreshMaxRetries: BACKGROUND_REFRESH_MAX_RETRIES,
      maxTokens: TARGETED_RESEARCH_MODE_MAX_TOKENS,
      cacheTtlMs: RESEARCH_MODE_CACHE_TTL_MS,
    };
  }

  if (plan.family === "magnesium") {
    return {
      preferLiveWriter: true,
      timeoutMs: MAGNESIUM_RESEARCH_MODE_TIMEOUT_MS,
      backgroundRefreshTimeoutMs: MAGNESIUM_RESEARCH_MODE_BACKGROUND_REFRESH_TIMEOUT_MS,
      maxRetries: LLM_MAX_RETRIES,
      backgroundRefreshMaxRetries: BACKGROUND_REFRESH_MAX_RETRIES,
      maxTokens: TARGETED_RESEARCH_MODE_MAX_TOKENS,
      cacheTtlMs: RESEARCH_MODE_CACHE_TTL_MS,
    };
  }

  if (plan.family === "curcumin") {
    return {
      preferLiveWriter: true,
      timeoutMs: CURCUMIN_RESEARCH_MODE_TIMEOUT_MS,
      backgroundRefreshTimeoutMs: LONG_RESEARCH_MODE_BACKGROUND_REFRESH_TIMEOUT_MS,
      maxRetries: LLM_MAX_RETRIES,
      backgroundRefreshMaxRetries: BACKGROUND_REFRESH_MAX_RETRIES,
      maxTokens: RESEARCH_MODE_MAX_TOKENS,
      cacheTtlMs: RESEARCH_MODE_CACHE_TTL_MS,
    };
  }

  if (plan.family === "ashwagandha") {
    return {
      preferLiveWriter: true,
      timeoutMs: ASHWAGANDHA_RESEARCH_MODE_TIMEOUT_MS,
      backgroundRefreshTimeoutMs: LONG_RESEARCH_MODE_BACKGROUND_REFRESH_TIMEOUT_MS,
      maxRetries: LLM_MAX_RETRIES,
      backgroundRefreshMaxRetries: BACKGROUND_REFRESH_MAX_RETRIES,
      maxTokens: RESEARCH_MODE_MAX_TOKENS,
      cacheTtlMs: RESEARCH_MODE_CACHE_TTL_MS,
    };
  }

  if (plan.family === "ginseng") {
    return {
      preferLiveWriter: true,
      timeoutMs: GINSENG_RESEARCH_MODE_TIMEOUT_MS,
      backgroundRefreshTimeoutMs: LONG_RESEARCH_MODE_BACKGROUND_REFRESH_TIMEOUT_MS,
      maxRetries: LLM_MAX_RETRIES,
      backgroundRefreshMaxRetries: BACKGROUND_REFRESH_MAX_RETRIES,
      maxTokens: RESEARCH_MODE_MAX_TOKENS,
      cacheTtlMs: RESEARCH_MODE_CACHE_TTL_MS,
    };
  }

  if (plan.family === "green_tea_extract") {
    return {
      preferLiveWriter: true,
      timeoutMs: GREEN_TEA_EXTRACT_RESEARCH_MODE_TIMEOUT_MS,
      backgroundRefreshTimeoutMs: GREEN_TEA_EXTRACT_RESEARCH_MODE_BACKGROUND_REFRESH_TIMEOUT_MS,
      maxRetries: TARGETED_RESEARCH_MODE_MAX_RETRIES,
      backgroundRefreshMaxRetries: BACKGROUND_REFRESH_MAX_RETRIES,
      maxTokens: TARGETED_RESEARCH_MODE_MAX_TOKENS,
      cacheTtlMs: RESEARCH_MODE_CACHE_TTL_MS,
    };
  }

  if (plan.family === "7keto_dhea_metabolite") {
    return {
      preferLiveWriter: true,
      timeoutMs: SEVEN_KETO_RESEARCH_MODE_TIMEOUT_MS,
      backgroundRefreshTimeoutMs: LONG_RESEARCH_MODE_BACKGROUND_REFRESH_TIMEOUT_MS,
      maxRetries: TARGETED_RESEARCH_MODE_MAX_RETRIES,
      backgroundRefreshMaxRetries: BACKGROUND_REFRESH_MAX_RETRIES,
      maxTokens: TARGETED_RESEARCH_MODE_MAX_TOKENS,
      cacheTtlMs: RESEARCH_MODE_CACHE_TTL_MS,
    };
  }

  if (plan.family === "cla") {
    return {
      preferLiveWriter: true,
      timeoutMs: CLA_RESEARCH_MODE_TIMEOUT_MS,
      backgroundRefreshTimeoutMs: LONG_RESEARCH_MODE_BACKGROUND_REFRESH_TIMEOUT_MS,
      maxRetries: TARGETED_RESEARCH_MODE_MAX_RETRIES,
      backgroundRefreshMaxRetries: BACKGROUND_REFRESH_MAX_RETRIES,
      maxTokens: TARGETED_RESEARCH_MODE_MAX_TOKENS,
      cacheTtlMs: RESEARCH_MODE_CACHE_TTL_MS,
    };
  }

  if (plan.family === "carnitine") {
    return {
      preferLiveWriter: true,
      timeoutMs: CARNITINE_RESEARCH_MODE_TIMEOUT_MS,
      backgroundRefreshTimeoutMs: CARNITINE_RESEARCH_MODE_BACKGROUND_REFRESH_TIMEOUT_MS,
      maxRetries: TARGETED_RESEARCH_MODE_MAX_RETRIES,
      backgroundRefreshMaxRetries: BACKGROUND_REFRESH_MAX_RETRIES,
      maxTokens: TARGETED_RESEARCH_MODE_MAX_TOKENS,
      cacheTtlMs: RESEARCH_MODE_CACHE_TTL_MS,
    };
  }

  if (plan.family === "b3_niacinamide") {
    return {
      preferLiveWriter: true,
      timeoutMs: NIACINAMIDE_RESEARCH_MODE_TIMEOUT_MS,
      backgroundRefreshTimeoutMs: RESEARCH_MODE_BACKGROUND_REFRESH_TIMEOUT_MS,
      maxRetries: LLM_MAX_RETRIES,
      backgroundRefreshMaxRetries: BACKGROUND_REFRESH_MAX_RETRIES,
      maxTokens: RESEARCH_MODE_MAX_TOKENS,
      cacheTtlMs: RESEARCH_MODE_CACHE_TTL_MS,
    };
  }

  if (plan.family === "5htp") {
    return {
      preferLiveWriter: true,
      timeoutMs: HTP5_RESEARCH_MODE_TIMEOUT_MS,
      backgroundRefreshTimeoutMs: LONG_RESEARCH_MODE_BACKGROUND_REFRESH_TIMEOUT_MS,
      maxRetries: TARGETED_RESEARCH_MODE_MAX_RETRIES,
      backgroundRefreshMaxRetries: BACKGROUND_REFRESH_MAX_RETRIES,
      maxTokens: TARGETED_RESEARCH_MODE_MAX_TOKENS,
      cacheTtlMs: RESEARCH_MODE_CACHE_TTL_MS,
    };
  }

  if (plan.family === "b12") {
    return {
      preferLiveWriter: true,
      timeoutMs: B12_RESEARCH_MODE_TIMEOUT_MS,
      backgroundRefreshTimeoutMs: RESEARCH_MODE_BACKGROUND_REFRESH_TIMEOUT_MS,
      maxRetries: LLM_MAX_RETRIES,
      backgroundRefreshMaxRetries: BACKGROUND_REFRESH_MAX_RETRIES,
      maxTokens: RESEARCH_MODE_MAX_TOKENS,
      cacheTtlMs: RESEARCH_MODE_CACHE_TTL_MS,
    };
  }

  if (plan.family === "folate") {
    return {
      preferLiveWriter: true,
      timeoutMs: FOLATE_RESEARCH_MODE_TIMEOUT_MS,
      backgroundRefreshTimeoutMs: RESEARCH_MODE_BACKGROUND_REFRESH_TIMEOUT_MS,
      maxRetries: LLM_MAX_RETRIES,
      backgroundRefreshMaxRetries: BACKGROUND_REFRESH_MAX_RETRIES,
      maxTokens: RESEARCH_MODE_MAX_TOKENS,
      cacheTtlMs: RESEARCH_MODE_CACHE_TTL_MS,
    };
  }

  if (plan.family === "b6") {
    return {
      preferLiveWriter: true,
      timeoutMs: B6_RESEARCH_MODE_TIMEOUT_MS,
      backgroundRefreshTimeoutMs: RESEARCH_MODE_BACKGROUND_REFRESH_TIMEOUT_MS,
      maxRetries: LLM_MAX_RETRIES,
      backgroundRefreshMaxRetries: BACKGROUND_REFRESH_MAX_RETRIES,
      maxTokens: RESEARCH_MODE_MAX_TOKENS,
      cacheTtlMs: RESEARCH_MODE_CACHE_TTL_MS,
    };
  }

  if (plan.family === "vitamin_d") {
    return {
      preferLiveWriter: true,
      timeoutMs: VITAMIN_D_RESEARCH_MODE_TIMEOUT_MS,
      backgroundRefreshTimeoutMs: RESEARCH_MODE_BACKGROUND_REFRESH_TIMEOUT_MS,
      maxRetries: LLM_MAX_RETRIES,
      backgroundRefreshMaxRetries: BACKGROUND_REFRESH_MAX_RETRIES,
      maxTokens: RESEARCH_MODE_MAX_TOKENS,
      cacheTtlMs: RESEARCH_MODE_CACHE_TTL_MS,
    };
  }

  if (plan.family === "calcium") {
    return {
      preferLiveWriter: true,
      timeoutMs: CALCIUM_RESEARCH_MODE_TIMEOUT_MS,
      backgroundRefreshTimeoutMs: RESEARCH_MODE_BACKGROUND_REFRESH_TIMEOUT_MS,
      maxRetries: LLM_MAX_RETRIES,
      backgroundRefreshMaxRetries: BACKGROUND_REFRESH_MAX_RETRIES,
      maxTokens: RESEARCH_MODE_MAX_TOKENS,
      cacheTtlMs: RESEARCH_MODE_CACHE_TTL_MS,
    };
  }

  if (plan.family === "zinc") {
    return {
      preferLiveWriter: true,
      timeoutMs: ZINC_RESEARCH_MODE_TIMEOUT_MS,
      backgroundRefreshTimeoutMs: ZINC_RESEARCH_MODE_BACKGROUND_REFRESH_TIMEOUT_MS,
      maxRetries: LLM_MAX_RETRIES,
      backgroundRefreshMaxRetries: BACKGROUND_REFRESH_MAX_RETRIES,
      maxTokens: TARGETED_RESEARCH_MODE_MAX_TOKENS,
      cacheTtlMs: RESEARCH_MODE_CACHE_TTL_MS,
    };
  }

  if (plan.family === "iron") {
    return {
      preferLiveWriter: true,
      timeoutMs: IRON_RESEARCH_MODE_TIMEOUT_MS,
      backgroundRefreshTimeoutMs: LONG_RESEARCH_MODE_BACKGROUND_REFRESH_TIMEOUT_MS,
      maxRetries: LLM_MAX_RETRIES,
      backgroundRefreshMaxRetries: BACKGROUND_REFRESH_MAX_RETRIES,
      maxTokens: RESEARCH_MODE_MAX_TOKENS,
      cacheTtlMs: RESEARCH_MODE_CACHE_TTL_MS,
    };
  }

  if (plan.family === "melatonin") {
    return {
      preferLiveWriter: true,
      timeoutMs: MELATONIN_RESEARCH_MODE_TIMEOUT_MS,
      backgroundRefreshTimeoutMs: RESEARCH_MODE_BACKGROUND_REFRESH_TIMEOUT_MS,
      maxRetries: LLM_MAX_RETRIES,
      backgroundRefreshMaxRetries: BACKGROUND_REFRESH_MAX_RETRIES,
      maxTokens: RESEARCH_MODE_MAX_TOKENS,
      cacheTtlMs: RESEARCH_MODE_CACHE_TTL_MS,
    };
  }

  return {
    preferLiveWriter: true,
    timeoutMs: RESEARCH_MODE_TIMEOUT_MS,
    backgroundRefreshTimeoutMs: RESEARCH_MODE_BACKGROUND_REFRESH_TIMEOUT_MS,
    maxRetries: LLM_MAX_RETRIES,
    backgroundRefreshMaxRetries: BACKGROUND_REFRESH_MAX_RETRIES,
    maxTokens: RESEARCH_MODE_MAX_TOKENS,
    cacheTtlMs: RESEARCH_MODE_CACHE_TTL_MS,
  };
};

const buildPrompt = (params: {
  context: IngredientScienceContext;
  plan: ScientificBackgroundPlan;
  selectedDescriptor: IngredientScienceDescriptor | null;
}): string => {
  const selectedRoleLabel = (() => {
    switch (params.selectedDescriptor?.lineRole) {
      case "primary_active":
        return "lead active";
      case "companion_nutrient":
        return "supporting nutrient";
      case "source_line":
        return "source line";
      case "aggregate_line":
        return "total line";
      case "breakdown_line":
        return "breakdown line";
      case "blend_line":
        return "blend-style line";
      default:
        return "supporting formula line";
    }
  })();

  const evidenceGrounding = buildPromptEvidenceGrounding({
    context: params.context,
    plan: params.plan,
    selectedDescriptor: params.selectedDescriptor,
  });

  const payload = {
    selectedItem: {
      name: params.plan.selectedLabel,
      dose: params.plan.selectedDose,
      family: params.plan.family,
      mode: params.plan.mode,
      lineRole: params.selectedDescriptor?.lineRole ?? "generic_line",
      roleLabel: selectedRoleLabel,
      categoryHint: params.selectedDescriptor?.categoryHint ?? null,
      sourceContext: params.selectedDescriptor?.sourceContext ?? null,
      formContext: params.selectedDescriptor?.formContext ?? null,
    },
    formulaContext: {
      productName: params.context.productName,
      productArchetype: params.context.productArchetype,
      formulaMode: params.context.formulaMode,
      sourceType: params.context.sourceType,
      ingredientSourceTier: params.context.ingredientSourceTier,
      anchorIngredient: params.context.anchorIngredient,
      coIngredients: params.context.coIngredients.slice(0, 4),
      relationshipCandidates: params.context.relationshipCandidates.slice(0, 3),
      labelConstraints: params.context.labelConstraints,
    },
    sectionPlan: params.plan.sections.map((section) => ({
      headingId: section.headingId,
      heading: section.heading,
      intent: section.intent,
      bulletThemes: section.bulletThemes,
      evidenceGoal: section.evidenceGoal,
      shopperMeaningGoal: section.shopperMeaningGoal,
    })),
    ...(evidenceGrounding ? { evidenceGrounding } : {}),
  };

  const familyWritingRules = (() => {
    if (params.plan.mode === "label_context_mode" && params.plan.family === "omega_3" && isOmega3Total(params.plan.selectedLabel)) {
      return [
        "Treat the selected item as a total-line explanation, not as a stand-alone fatty acid with its own full research card.",
        "Explain why shoppers should read the EPA and DHA rows after the total line.",
      ];
    }
    if (params.plan.mode === "label_context_mode" && params.plan.family === "omega_3" && isOmega3Source(params.plan.selectedLabel)) {
      return [
        "Treat the selected item as a source-line explanation, not as a substitute for the EPA and DHA breakdown.",
        "Explain that source identity and active breakdown play different roles on the label.",
      ];
    }
    if (params.plan.mode === "label_context_mode" && params.plan.family === "probiotic_or_blend") {
      return [
        "Keep the focus on strain-level, phage-level, or subcomponent disclosure limits.",
        "Explain why broad blend naming is weaker for comparison than more itemized disclosure.",
      ];
    }
    if (params.plan.family === "astaxanthin_carotenoid") {
      return [
        "Useful specifics include oxidative-stress markers, eye-comfort or skin-context research, and mixed exercise/recovery findings.",
        "Do not turn antioxidant interest into a blanket promise for every health outcome.",
      ];
    }
    if (params.plan.family === "curcumin") {
      return [
        "Keep curcumin grounded in outcome-specific and extract-aware interpretation rather than generic anti-inflammatory hype.",
        "Do not turn standardized extracts or curcuminoid wording into a universal best-extract claim.",
        "Make shopper meaning practical by tying comparison to extract detail, standardization, and what the label actually discloses.",
      ];
    }
    if (params.plan.family === "turmeric") {
      return [
        "Keep turmeric distinct from concentrated curcumin products and explain when it is being used as a broader root or extract story.",
        "Do not turn extract, curcuminoid, or enhanced-absorption wording into a universal superiority claim.",
        "Make shopper meaning practical by tying comparison to extract detail, standardization, and whether the label stays broad or gets specific.",
      ];
    }
    if (params.plan.family === "coq10") {
      return [
        "Keep CoQ10 grounded in energy-metabolism context first, with heart-related discussion as a narrower secondary lane.",
        "Do not turn ubiquinone or ubiquinol wording into a universal best-form claim.",
        "Make shopper meaning practical by tying comparison to exact form disclosure, amount, and how broad heart language is being used on the label.",
      ];
    }
    if (params.plan.family === "creatine") {
      return [
        "Keep creatine anchored to strength and high-intensity performance first, with recovery as a secondary lane.",
        "Do not flatten every creatine label into generic gym-performance hype or treat every form as a universal upgrade over monohydrate.",
        "Make comparison meaning practical by tying it to disclosed grams, exact form, and whether the formula stays simple or gets heavily blended.",
      ];
    }
    if (params.plan.family === "berberine") {
      return [
        "Keep berberine grounded in glucose-metabolic context first, with lipid-related discussion as a secondary lane.",
        "Do not turn broad metabolic storytelling into a universal cure-style summary.",
        "Make shopper meaning practical by tying comparison to exact berberine disclosure, dose, and whether combo formulas change how central berberine really is.",
      ];
    }
    if (params.plan.family === "nac") {
      return [
        "Keep NAC anchored to glutathione-precursor context first, with respiratory and mucus-related discussion as a narrower secondary lane.",
        "Do not drift into treatment language or generic detox marketing.",
        "Make shopper meaning practical by tying comparison to exact ingredient disclosure, dose, and how the intended use context changes label interpretation.",
      ];
    }
    if (params.plan.family === "collagen") {
      return [
        "Keep collagen grounded in skin and connective-tissue context first, with joint or structural context as a secondary lane.",
        "Do not flatten every collagen label into the same beauty or mobility promise.",
        "Make shopper meaning practical by tying comparison to source, peptide or type disclosure, and whether the formula is beauty-led, joint-led, or more general.",
      ];
    }
    if (params.plan.family === "electrolyte_hydration") {
      return [
        "Keep electrolyte products grounded in hydration context first, with exercise or sweat-loss framing as a narrower secondary lane.",
        "Do not flatten every hydration label into sports-performance hype or treat the broad hydration headline as the whole product story.",
        "Make shopper meaning practical by tying comparison to disclosed sodium, potassium, magnesium, sugar or carbohydrate context, and the rest of the label detail.",
      ];
    }
    if (params.plan.family === "protein") {
      return [
        "Keep protein anchored to muscle and recovery context first, with satiety or meal-support language as a secondary lane.",
        "Do not flatten every protein label into generic fitness or weight-loss marketing.",
        "Make shopper meaning practical by tying comparison to exact protein source, isolate or concentrate detail, disclosed grams, and whether the formula stays simple or heavily blended.",
      ];
    }
    if (params.plan.family === "fiber") {
      return [
        "Keep fiber grounded in digestive-regularity context first, with satiety or broader gut-environment language as a secondary lane.",
        "Do not turn broad gut-health branding into a catch-all summary that ignores source and solubility.",
        "Make shopper meaning practical by tying comparison to exact fiber type, source, solubility detail, and whether the product is a simple fiber ingredient or a more complex blend.",
      ];
    }
    if (params.plan.family === "ashwagandha") {
      return [
        "Keep ashwagandha anchored to stress- and mood-related context first, with sleep or recovery as narrower secondary lanes.",
        "Do not turn branded extracts into a universal superiority claim.",
        "Use practical label-reading language that explains why extract identity changes comparison value.",
      ];
    }
    if (params.plan.family === "ginseng") {
      return [
        "Keep ginseng more specific than generic energy marketing and distinguish species or extract detail when it matters.",
        "Do not imply that all ginseng labels map to the same research story.",
        "Make comparison meaning concrete by tying it to species naming and extract detail.",
      ];
    }
    if (params.plan.family === "green_tea_extract") {
      return [
        "Keep green tea extract anchored to catechin or extract-detail interpretation rather than generic antioxidant or weight-loss copy.",
        "Do not turn EGCG or concentration detail into a universal superiority claim.",
        "Use shopper-facing language that explains why extract concentration and exact labeling matter for comparison.",
      ];
    }
    if (params.plan.family === "5htp") {
      return [
        "Keep 5-HTP anchored to serotonin-precursor and formula-positioning context rather than generic mood or sleep promises.",
        "Treat glycine, taurine, inositol, or B-vitamin lines as context that can change formula interpretation without replacing 5-HTP as the main active.",
        "Use shopper-facing language that explains why the main active line and the disclosed amount still do most of the comparison work.",
      ];
    }
    if (params.plan.family === "b3_niacinamide") {
      return [
        "Keep niacinamide or vitamin B3 grounded in coenzyme and formula-role context rather than generic energy or skin hype.",
        "Do not flatten every B3 line into the same research story when the surrounding formula makes it a supporting nutrient.",
        "Make comparison meaning practical by tying it to disclosed amount and whether the B3 row is central or supportive.",
      ];
    }
    if (params.plan.family === "glycine") {
      return [
        "Keep glycine grounded in amino-acid and formula-support context rather than generic relaxation filler.",
        "Do not pretend glycine carries the same role in every multi-ingredient formula.",
        "Explain how shoppers should read glycine differently when it appears as a supporting formula line versus a lead active.",
      ];
    }
    if (params.plan.family === "taurine") {
      return [
        "Keep taurine grounded in physiology and formula-support context rather than generic energy or performance hype.",
        "Do not imply taurine is always the lead active just because it is named prominently on the label.",
        "Make comparison meaning practical by tying it to disclosed amount and the rest of the formula.",
      ];
    }
    if (params.plan.family === "inositol") {
      return [
        "Keep inositol grounded in signaling and formula-context interpretation rather than broad hormone or mood promises.",
        "Do not treat every inositol line as the same when the exact type and formula setting may differ.",
        "Use shopper-facing language that explains why the disclosed amount and co-formulation still matter.",
      ];
    }
    if (params.plan.family === "vitamin_c") {
      return [
        "Keep the immune lane outcome-specific and avoid prevention-style phrasing.",
        "Use collagen/tissue context and iron co-administration context as distinct lanes instead of repeating one generic vitamin summary.",
      ];
    }
    if (params.plan.family === "vitamin_d") {
      return [
        "Keep bone and calcium-regulation context as the clearest lane for vitamin D.",
        "Treat broader immune or whole-health language as wider and less tidy than the core evidence lane.",
        "Use shopper-facing language that explains why broad packaging can outrun the cleanest comparison signal.",
        "Make dose, ingredient line, and formula setting feel like the practical comparison anchor rather than like a generic disclaimer.",
      ];
    }
    if (params.plan.family === "b12") {
      return [
        "Keep vitamin B12 grounded in supplementation, nerve, and blood-cell context rather than generic energy marketing.",
        "Do not turn methylcobalamin or cyanocobalamin wording into a universal best-form claim.",
        "Make the shopper meaning practical by tying comparison to form disclosure, amount, and the rest of the formula.",
      ];
    }
    if (params.plan.family === "folate") {
      return [
        "Keep folate grounded in supplementation and developmental context without drifting into medical advice.",
        "Do not treat methylfolate or folic acid labeling as a simplistic better-versus-worse story.",
        "Explain why the exact folate line changes comparison value and formula interpretation.",
      ];
    }
    if (params.plan.family === "b6") {
      return [
        "Keep vitamin B6 anchored to cofactor, metabolism, and narrower nerve-related context rather than generic energy filler.",
        "Do not claim one B6 form is universally superior.",
        "Make shopper meaning practical by tying comparison to dose, form disclosure, and formula role.",
      ];
    }
    if (params.plan.family === "zinc") {
      return [
        "Keep zinc grounded in immune-function and skin/barrier context rather than drifting into unrelated marketing themes.",
        "Make clear that dose and population affect interpretation.",
      ];
    }
    if (params.plan.family === "magnesium") {
      return [
        "Use common supplementation context, form disclosure, and tolerability as distinct lanes instead of promising one best magnesium story.",
        "Do not claim one magnesium form is always superior or more absorbable.",
        "Explain why magnesium can sound broad on the front of the label while still needing exact form and amount to compare products well.",
        "Let shopper meaning sound practical and label-aware rather than like a generic relaxation or sleep-support slogan.",
      ];
    }
    if (params.plan.family === "calcium") {
      return [
        "Keep bone/intake context as the clearest lane and treat form comparisons carefully.",
        "Do not turn carbonate-vs-citrate discussion into a universal best-form claim.",
        "Use shopper-facing language that explains why form disclosure and formula role change comparison value.",
        "Let co-formulation meaning sound practical instead of generic or encyclopedic.",
      ];
    }
    if (params.plan.family === "iron") {
      return [
        "Keep iron grounded in supplementation and status-related context rather than broad fatigue or vitality marketing.",
        "Use form and tolerability as practical comparison context without turning the card into self-diagnosis advice.",
        "Make comparison meaning concrete by tying it to exact form, amount, and paired-nutrient context.",
        "Keep the prose narrow, shopper-safe, and more specific than generic energy wording.",
      ];
    }
    if (params.plan.family === "melatonin") {
      return [
        "Keep melatonin anchored to timing and onset context rather than generic bedtime or sleep-quality filler.",
        "Do not write insomnia-treatment style claims or bedtime instructions.",
        "Use practical shopper language that makes dose and timing framing feel like the real comparison anchors.",
      ];
    }
    if (params.plan.family === "omega_3" && isOmega3Epa(params.plan.selectedLabel)) {
      return [
        "Make triglyceride and lipid-marker endpoints the clearest lane for EPA.",
        "Do not flatten EPA into generic heart-health copy or reuse DHA framing.",
      ];
    }
    if (params.plan.family === "omega_3" && isOmega3Dha(params.plan.selectedLabel)) {
      return [
        "Make brain/eye context and structural roles the clearest DHA lanes.",
        "Do not recycle EPA's lipid-first framing for DHA.",
      ];
    }
    if (params.plan.family === "omega_3") {
      return [
        "Keep lipid endpoints as the primary comparison lane for combined omega-3 discussion.",
        "Treat broader cardiovascular and secondary contexts as wider and less tidy than the core lipid lane.",
      ];
    }
    if (params.plan.family === "probiotic_or_blend") {
      return [
        "Keep digestive/microbiome context tied to strain precision and label disclosure quality.",
        "Do not imply that a broad probiotic category label maps cleanly to a specific strain evidence base.",
      ];
    }
    return [];
  })();

  return [
    "Write a Scientific background card for a supplement shopper in plain English.",
    "Explain the research map for the selected item, not the product's full ingredient list.",
    "If mode is research_mode, show the main research lane, the narrower or more mixed lanes, and why that distinction matters.",
    "If mode is label_context_mode, explain what the selected line means on the label and why it matters for comparison, without pretending it is a stand-alone research ingredient.",
    "If productArchetype is functional_food_like, prefer label-reading and formula-role interpretation over stand-alone research storytelling.",
    "Use the selected item's lineRole, categoryHint, sourceContext, formContext, coIngredients, relationshipCandidates, and anchorIngredient to explain this ingredient inside this formula, not in isolation.",
    "Make it clear when the selected line is the lead active versus a companion nutrient, supporting line, source line, total line, or breakdown line.",
    "When surrounding co-ingredients or pairing candidates matter, explain how they change interpretation without turning them into the main active.",
    "Do not redefine ingredient identity, rewrite the factual ingredient list, or write support-claim marketing copy.",
    "Do not open sections with 'X is studied' or 'X is discussed'. Start with the evidence lane, outcome cluster, or label-reading takeaway instead.",
    "Each section summary should read like an interpretation for a shopper, not a textbook intro or a restatement of the heading.",
    "Use bullets for concrete endpoints, research settings, or interpretation boundaries that add new information.",
    "Make evidence texture visible: stronger, narrower, mixed, context-dependent, or harder to compare.",
    "If evidenceGrounding is present for a section, use it as the strongest phrasing boundary for that section's summary, evidenceRead, and shopperMeaning.",
    "Do not mention PMID numbers, journal names, or formal citations in the shopper-facing card; use evidenceGrounding only to stay specific and comparison-safe.",
    "If evidenceGrounding exists for only some sections, keep the other sections specific without inventing equally strong support.",
    "Do not use treatment, prevention, cure, diagnosis, or superiority language.",
    "Use the provided headings exactly and in the same order.",
    "Write in English only.",
    ...familyWritingRules,
    'Return JSON only with this shape: {"introLine":"...","sections":[{"headingId":"...","heading":"...","summary":"...","bullets":["...","..."],"evidenceRead":"...","shopperMeaning":"..."}],"closingNote":"..."}',
    `INPUT_JSON: ${JSON.stringify(payload)}`,
  ].join("\n");
};

const lineRoleNarrative = (value: string | null | undefined): string => {
  switch (value) {
    case "primary_active":
      return "lead active";
    case "companion_nutrient":
      return "supporting nutrient";
    case "source_line":
      return "source line";
    case "aggregate_line":
      return "total line";
    case "breakdown_line":
      return "breakdown line";
    case "blend_line":
      return "blend-style line";
    default:
      return "supporting formula line";
  }
};

const joinReadableList = (values: string[]): string => {
  if (values.length <= 1) return values[0] ?? "";
  if (values.length === 2) return `${values[0]} and ${values[1]}`;
  return `${values.slice(0, -1).join(", ")}, and ${values[values.length - 1]}`;
};

const parseWriterOutput = (raw: string): ScientificBackgroundWriterOutput | null => {
  const result = extractJsonObjectLoose(raw);
  if (!result.ok || !result.parsed || typeof result.parsed !== "object") return null;
  const parsed = result.parsed as Record<string, unknown>;
  const sections = Array.isArray(parsed.sections)
    ? parsed.sections
        .filter((item): item is Record<string, unknown> => Boolean(item) && typeof item === "object")
        .map((section) => ({
          headingId: normalizeText(typeof section.headingId === "string" ? section.headingId : "") || undefined,
          heading: normalizeText(typeof section.heading === "string" ? section.heading : ""),
          summary: normalizeText(typeof section.summary === "string" ? section.summary : ""),
          bullets: Array.isArray(section.bullets)
            ? section.bullets
                .filter((item): item is string => typeof item === "string")
                .map((item) => normalizeText(item))
                .filter(Boolean)
            : [],
          evidenceRead: normalizeText(typeof section.evidenceRead === "string" ? section.evidenceRead : ""),
          shopperMeaning: normalizeText(typeof section.shopperMeaning === "string" ? section.shopperMeaning : "") || null,
        }))
    : [];

  return {
    introLine: normalizeText(typeof parsed.introLine === "string" ? parsed.introLine : "") || null,
    sections,
    closingNote: normalizeText(typeof parsed.closingNote === "string" ? parsed.closingNote : "") || null,
  };
};

const headingsMatchPlan = (
  actual: ScientificBackgroundWriterSection,
  planned: ScientificBackgroundSectionPlan,
): boolean => {
  if (actual.headingId) return actual.headingId === planned.headingId;
  return normalizeHeading(actual.heading) === normalizeHeading(planned.heading);
};

const looksTooGeneric = (texts: string[]): boolean => {
  const normalized = texts.map((text) => normalizeText(text)).filter(Boolean);
  if (normalized.length === 0) return true;
  const genericBulletCount = normalized.filter((text) => GENERIC_BULLET_PATTERNS.some((pattern) => pattern.test(text))).length;
  return genericBulletCount >= normalized.length;
};

const summaryLooksTemplatey = (summary: string): boolean =>
  TEMPLATE_SUMMARY_PATTERNS.some((pattern) => pattern.test(normalizeText(summary)));

const evidenceReadLooksWeak = (value: string): boolean =>
  WEAK_EVIDENCE_PATTERNS.some((pattern) => pattern.test(normalizeText(value)));

const shopperMeaningLooksWeak = (value: string | null | undefined): boolean =>
  WEAK_SHOPPER_MEANING_PATTERNS.some((pattern) => pattern.test(normalizeText(value))) ||
  !SHOPPER_DECISION_KEYWORDS.some((pattern) => pattern.test(normalizeText(value)));

const introLineLooksWeak = (value: string | null | undefined): boolean => {
  const normalized = normalizeText(value);
  if (!normalized) return true;
  return (
    GENERIC_IDENTITY_PATTERNS.some((pattern) => pattern.test(normalized)) ||
    TEMPLATE_SUMMARY_PATTERNS.some((pattern) => pattern.test(normalized)) ||
    MEDICAL_BANNED_PATTERNS.some((pattern) => pattern.test(normalized))
  );
};

const closingNoteLooksWeak = (value: string | null | undefined): boolean => {
  const normalized = normalizeText(value);
  if (!normalized) return true;
  return (
    MEDICAL_BANNED_PATTERNS.some((pattern) => pattern.test(normalized)) ||
    WEAK_SHOPPER_MEANING_PATTERNS.some((pattern) => pattern.test(normalized)) ||
    /\bproof\b|\bguarantee\b|\bdefinitive\b/i.test(normalized)
  );
};

const normalizeBullets = (bullets: string[]): string[] =>
  dedupe(
    bullets
      .map((bullet) => normalizeText(bullet))
      .filter(Boolean),
  ).slice(0, 3);

const repairSectionFromFallback = (params: {
  plan: ScientificBackgroundPlan;
  planned: ScientificBackgroundSectionPlan;
  section: ScientificBackgroundWriterSection;
}): ScientificBackgroundSection => {
  const fallback = buildSectionFallback(params.plan, params.planned);
  const summary = normalizeText(params.section.summary);
  const bullets = normalizeBullets(params.section.bullets);
  const evidenceRead = normalizeText(params.section.evidenceRead);
  const shopperMeaning = normalizeText(params.section.shopperMeaning ?? "");

  return {
    heading: params.planned.heading,
    summary:
      summary && !summaryLooksTemplatey(summary) && !looksTooGeneric([summary, ...bullets])
        ? asSentence(summary)
        : fallback.summary,
    bullets:
      bullets.length >= 2 && !looksTooGeneric(bullets)
        ? bullets.map((bullet) => asSentence(bullet))
        : fallback.bullets,
    evidenceRead:
      evidenceRead && !evidenceReadLooksWeak(evidenceRead)
        ? asSentence(evidenceRead)
        : fallback.evidenceRead,
    shopperMeaning:
      shopperMeaning && !shopperMeaningLooksWeak(shopperMeaning)
        ? asSentence(shopperMeaning)
        : fallback.shopperMeaning,
  };
};

const repairWriterOutput = (params: {
  plan: ScientificBackgroundPlan;
  parsed: ScientificBackgroundWriterOutput;
}): ScientificBackgroundBlock | null => {
  if (!params.parsed.sections || params.parsed.sections.length === 0) return null;

  const usedIndexes = new Set<number>();
  let matchedSectionCount = 0;
  const repairedSections = params.plan.sections.map((planned) => {
    const matchedIndex = params.parsed.sections!.findIndex((section, index) => {
      if (usedIndexes.has(index)) return false;
      return headingsMatchPlan(section, planned);
    });

    if (matchedIndex < 0) {
      return buildSectionFallback(params.plan, planned);
    }

    usedIndexes.add(matchedIndex);
    matchedSectionCount += 1;
    return repairSectionFromFallback({
      plan: params.plan,
      planned,
      section: params.parsed.sections![matchedIndex]!,
    });
  });

  if (matchedSectionCount === 0) return null;
  const defaultIntroLine = params.plan.selectedDose
    ? `${buildReferenceLabel(params.plan)} • ${params.plan.selectedDose}`
    : buildReferenceLabel(params.plan);
  const defaultClosingNote =
    params.plan.mode === "research_mode"
      ? "Read the research context as outcome-specific guidance, not as a blanket promise for every claim on the label."
      : "Read this line as label context first, then compare it with the more specific ingredient rows that carry the strongest decision value.";
  const closingNote = normalizeText(params.parsed.closingNote)
    ? (closingNoteLooksWeak(params.parsed.closingNote)
      ? defaultClosingNote
      : asSentence(params.parsed.closingNote))
    : defaultClosingNote;

  return {
    mode: params.plan.mode,
    selectedLabel: params.plan.selectedLabel,
    selectedDose: params.plan.selectedDose,
    introLine:
      params.parsed.introLine && !introLineLooksWeak(params.parsed.introLine)
        ? asSentence(params.parsed.introLine)
        : defaultIntroLine,
    sections: repairedSections,
    closingNote,
  };
};

const gateScientificBackground = (params: {
  requestedIngredientName: string;
  repaired: ScientificBackgroundBlock;
}): boolean => {
  const allTexts = [
    params.repaired.introLine ?? "",
    params.repaired.closingNote ?? "",
    ...params.repaired.sections.flatMap((section) => [
      section.heading,
      section.summary,
      ...section.bullets,
      section.evidenceRead,
      section.shopperMeaning ?? "",
    ]),
  ];

  if (MEDICAL_BANNED_PATTERNS.some((pattern) => pattern.test(allTexts.join(" ")))) return false;
  if (GENERIC_IDENTITY_PATTERNS.some((pattern) => pattern.test(allTexts.join(" ")))) return false;

  const requestedKey = normalizeIngredientScienceKey(params.requestedIngredientName);
  const contentKey = normalizeIngredientScienceKey(allTexts.join(" "));
  if (!requestedKey || !contentKey) return false;

  for (let index = 0; index < params.repaired.sections.length; index += 1) {
    const section = params.repaired.sections[index];
    if (!section || !section.heading || !section.summary || !section.evidenceRead) return false;
    if (section.bullets.length < 2 || section.bullets.length > 3) return false;
    if (!section.shopperMeaning) return false;
    if (summaryLooksTemplatey(section.summary)) return false;
    if (looksTooGeneric([section.summary, ...section.bullets])) return false;
    if (evidenceReadLooksWeak(section.evidenceRead)) return false;
    if (shopperMeaningLooksWeak(section.shopperMeaning)) return false;
  }

  return true;
};

const buildSectionFallback = (
  plan: ScientificBackgroundPlan,
  section: ScientificBackgroundSectionPlan,
  context?: IngredientScienceContext,
): ScientificBackgroundSection => {
  const label = buildReferenceLabel(plan);
  const narrativeLabel = buildNarrativeLabel(plan);
  const selectedDescriptor = context ? getSelectedDescriptor(context, plan.selectedLabel) : null;
  const anchorName = context?.anchorIngredient?.name ?? null;
  const companionNames =
    context?.coIngredients
      .filter((row) => normalizeIngredientScienceKey(row.name) !== normalizeIngredientScienceKey(plan.selectedLabel))
      .map((row) => row.name)
      .slice(0, 2) ?? [];
  const relationshipStatement = context?.relationshipCandidates[0]?.safeStatement ?? null;
  switch (section.headingId) {
    case "antioxidant_activity":
      return {
        heading: section.heading,
        summary: `Research on ${label} most often starts with oxidative-stress markers and antioxidant-response questions, which is why antioxidant activity remains the clearest lane to read first.`,
        bullets: [
          "Laboratory and human studies often look first at oxidative-stress markers rather than at broad clinical outcomes.",
          "Mechanistic discussions usually focus on how astaxanthin may help stabilize free radicals and limit oxidative damage under specific conditions.",
          "The signal is more convincing at the marker level than as proof of every antioxidant claim seen in marketing.",
        ],
        evidenceRead: "This is one of the stronger lanes for astaxanthin, but it is still more outcome-specific than a broad promise of whole-body benefit.",
        shopperMeaning: "For shopping and comparison, antioxidant positioning is the most evidence-grounded reading of astaxanthin.",
      };
    case "eye_and_skin_context":
      return {
        heading: section.heading,
        summary: `Eye-comfort and skin-related studies form a meaningful secondary lane for ${label}, especially in settings that look at visual fatigue, hydration, elasticity, or UV-exposure context.`,
        bullets: [
          "Some studies look at eye-fatigue or eye-comfort outcomes rather than only antioxidant markers.",
          "Skin research often focuses on hydration, elasticity, appearance, or protection from oxidative stress linked with environmental exposure.",
          "These findings are better read as supportive context than as definitive proof of a broad beauty claim.",
        ],
        evidenceRead: "This is a credible but narrower lane than the core antioxidant story, and the results are still more context-dependent.",
        shopperMeaning: "This can help explain why astaxanthin products are often positioned for eye or skin support, but it should stay secondary to the main antioxidant lane.",
      };
    case "exercise_and_recovery_research":
      return {
        heading: section.heading,
        summary: `Exercise, endurance, and recovery research is the most variable part of the astaxanthin story, with smaller studies asking whether ${label} changes fatigue, recovery, or performance-related outcomes.`,
        bullets: [
          "Some studies focus on fatigue, recovery, soreness, or endurance-related outcomes.",
          "Results are not as consistent here as they are in the oxidative-stress marker lane.",
          "Training status, protocol design, and study size can all change how strong the signal looks.",
        ],
        evidenceRead: "This is the most mixed and interpretation-sensitive lane for astaxanthin.",
        shopperMeaning: "Treat exercise positioning as a cautious secondary angle, not as the main reason to rank one astaxanthin product over another.",
      };
    case "antioxidant_and_immune_research":
      return {
        heading: section.heading,
        summary: `Vitamin C research is most useful when it stays anchored to antioxidant markers and specific immune-function outcomes instead of stretching into broad prevention-style language.`,
        bullets: [
          "Research can include antioxidant markers, immune-function measures, or broader resilience-related context rather than a single umbrella outcome.",
          "The familiar immune positioning is broader than the clearest endpoint-level evidence and should not be read like disease-prevention language.",
          "This is one reason vitamin C copy often sounds firmer than the underlying outcome-specific evidence actually is.",
        ],
        evidenceRead: "The research base is real, but it is outcome-specific enough that broad immune wording can outrun the cleanest evidence.",
        shopperMeaning: "Vitamin C makes sense in immune-positioned products, but comparison should still stay anchored to the exact ingredient, dose, and form rather than to broad claims alone.",
      };
    case "collagen_and_tissue_support":
      return {
        heading: section.heading,
        summary: `Collagen and connective-tissue context is one reason ${label} shows up in skin, structure, and recovery-oriented formulas instead of only immune-positioned ones.`,
        bullets: [
          "This lane is about tissue function and collagen-related roles, not about a vague beauty claim.",
          "It helps explain why vitamin C can plausibly sit in more than one supplement category.",
          "The practical importance still depends on the rest of the formula and what the product is trying to do.",
        ],
        evidenceRead: "This is a meaningful secondary lane, but it should still be read in a context-specific way rather than as a catch-all promise.",
        shopperMeaning: "It helps the shopper understand why vitamin C is used beyond immune positioning, without assuming every vitamin C label is aiming at the same outcome.",
      };
    case "iron_absorption_context":
      return {
        heading: section.heading,
        summary: `Iron co-administration is a narrower but important vitamin C context, and it matters most when the shopper goal or formula actually overlaps with that use case.`,
        bullets: [
          "This matters most when the shopper goal or formula actually overlaps with iron context.",
          "It is easier to justify in paired or co-administered products than as a generic umbrella talking point.",
          "Not every vitamin C label is trying to serve this specific purpose.",
        ],
        evidenceRead: "This is a narrower context lane, not a generic vitamin C promise.",
        shopperMeaning: "It matters most when comparing formulas that are explicitly built around iron context or paired nutrient use.",
      };
    case "bone_and_calcium_regulation_context":
      return {
        heading: section.heading,
        summary: `${label} is easiest to interpret through bone and calcium-regulation context, because that is still the clearest and most established lane behind most vitamin D positioning.`,
        bullets: [
          "Bone and calcium-regulation context is usually the strongest anchor for reading a vitamin D label.",
          "This lane is more concrete than broad whole-health wording that can appear on packaging.",
          "It gives the shopper a cleaner starting point for comparison than generic wellness language does.",
        ],
        evidenceRead: "This is the clearest and most grounded lane for vitamin D, even when products are marketed much more broadly.",
        shopperMeaning: "Use the exact vitamin D ingredient and disclosed amount as the main comparison point before giving much weight to broader claims.",
      };
    case "immune_and_broader_health_research":
      return {
        heading: section.heading,
        summary: `${label} also appears in immune and broader health discussions, but those claims are wider and more variable than the clearest bone-focused lane.`,
        bullets: [
          "Some vitamin D research is discussed in immune-related settings, but not every broad claim rests on equally direct evidence.",
          "Broader health language often stretches further than the clearest endpoint-specific research lane.",
          "Study design, baseline status, and the exact outcome being measured can change how strong the signal looks.",
        ],
        evidenceRead: "This is a real but wider and less tidy lane than bone and calcium-regulation context.",
        shopperMeaning: "Treat broader vitamin D packaging language more cautiously than the bone-focused context that is easiest to compare across products.",
      };
    case "what_interpretation_depends_on":
      return {
        heading: section.heading,
        summary: `How much vitamin D matters in practice depends on the disclosed dose, the formula setting, and the baseline context behind the shopper's use case.`,
        bullets: [
          "Dose changes interpretation more than category language alone.",
          "Baseline status can matter when people try to map broad claims onto a specific product.",
          "Two vitamin D products can sound similar on the front of the label while still differing in comparison value once the details are read.",
        ],
        evidenceRead: "This is an interpretation section: vitamin D should be compared through disclosed detail, not through generic positioning alone.",
        shopperMeaning: "Read the amount, exact ingredient name, and the rest of the formula before assuming two vitamin D products are interchangeable.",
      };
    case "deficiency_and_supplementation_context":
      return {
        heading: section.heading,
        summary: `${label} is easiest to read through supplementation and status-related context, which is why the cleanest B12 comparisons usually start with the exact ingredient line and the stated amount rather than with broad energy marketing.`,
        bullets: [
          "Supplementation context is usually the clearest way to interpret a B12 label.",
          "That makes the exact ingredient line and amount more useful than generic vitality copy when products are compared.",
          "This lane is practical and shopper-safe, but it should not be turned into self-diagnosis language.",
        ],
        evidenceRead: "This is the clearest and most practical B12 lane, and it is narrower than broad energy-style positioning.",
        shopperMeaning: "Compare B12 products through the exact ingredient, the amount, and the rest of the formula instead of leaning on generic energy wording.",
      };
    case "nerve_and_blood_cell_context":
      return {
        heading: section.heading,
        summary: `${label} also appears in nerve and red-blood-cell context, which helps explain why B12 products can be positioned more narrowly than broad front-label wellness language suggests.`,
        bullets: [
          "This lane helps explain why B12 shows up in more than one supplement category without meaning every B12 label is saying the same thing.",
          "It is more specific than generic energy copy and easier to interpret when the formula stays simple.",
          "The surrounding formula can still change how central this lane is to the shopping decision.",
        ],
        evidenceRead: "This is a meaningful secondary lane, but it should stay narrower and more specific than broad vitality marketing.",
        shopperMeaning: "Use this lane to understand formula positioning, but still compare products through the disclosed ingredient and amount.",
      };
    case "what_form_disclosure_changes":
      return {
        heading: section.heading,
        summary: `Form disclosure matters for ${label} because shoppers often use methylcobalamin, cyanocobalamin, or other form lines to judge how directly one B12 product can be compared with another.`,
        bullets: [
          "Different B12 forms can change label-reading and comparison value even when the category name sounds identical.",
          "A clearly disclosed form usually makes B12 products easier to compare than a broad or partially described vitamin line.",
          "This is most useful as a comparison tool, not as proof that one B12 form is universally better.",
        ],
        evidenceRead: "This is a practical form-disclosure lane rather than a blanket best-form ranking.",
        shopperMeaning: "Read the exact B12 form and the amount together before assuming two B12 products belong in the same comparison set.",
      };
    case "folate_status_and_supplementation_context":
      return {
        heading: section.heading,
        summary: `${label} is easiest to compare through supplementation context, because the cleanest folate reading usually comes from the exact ingredient line and amount rather than from broad B-vitamin language.`,
        bullets: [
          "Supplementation context is the clearest lane for reading a folate label.",
          "That makes the exact folate ingredient and amount more useful than generic category wording when products are compared.",
          "This lane should stay practical and shopper-safe rather than drifting into medical advice.",
        ],
        evidenceRead: "This is the clearest and most practical folate lane for product comparison.",
        shopperMeaning: "Compare folate products through the exact ingredient line and the amount before letting broader category language drive the decision.",
      };
    case "pregnancy_and_developmental_context":
      return {
        heading: section.heading,
        summary: `${label} also appears in pregnancy and developmental context, which is why some folate products are positioned more specifically than general B-vitamin formulas.`,
        bullets: [
          "Developmental context is one reason folate can read differently from more generic vitamin labels.",
          "This lane is narrower than broad wellness language and should stay tied to the exact formula setting.",
          "It helps explain why product positioning can differ even when two labels both say folate.",
        ],
        evidenceRead: "This is a specific use-context lane and should stay narrower than generic category copy.",
        shopperMeaning: "Use this lane to understand why some folate products are framed more specifically than others before comparing them head to head.",
      };
    case "what_form_labeling_changes":
      return {
        heading: section.heading,
        summary: `Form labeling changes comparison value for ${label} because folic acid, methylfolate, and similar lines can make two folate products look similar at the top level while still reading differently on the label.`,
        bullets: [
          "Exact folate labeling can change how easy the product is to compare with another formula.",
          "A clearly named folate line usually carries more comparison value than broad B-vitamin wording alone.",
          "This is most useful as a label-reading distinction, not as a simplistic better-versus-worse ranking.",
        ],
        evidenceRead: "This section is about comparison and label interpretation rather than about declaring one folate form universally superior.",
        shopperMeaning: "Check the exact folate line before assuming two products with similar top-line language belong in the same comparison bucket.",
      };
    case "cofactor_and_metabolism_context":
      return {
        heading: section.heading,
        summary: `${label} is easiest to read through cofactor and metabolism-related context, which is a cleaner and more specific lane than broad front-label energy language.`,
        bullets: [
          "Cofactor context is the clearest way to understand why B6 appears in so many different formulas.",
          "That makes the ingredient line and stated amount more useful than generic category language when products are compared.",
          "This lane should stay practical and outcome-aware rather than turning into catch-all wellness copy.",
        ],
        evidenceRead: "This is the most useful and grounded B6 lane, and it is more specific than generic energy-style positioning.",
        shopperMeaning: "Compare B6 products through the exact ingredient and amount instead of broad energy wording.",
      };
    case "nerve_related_interpretation":
      return {
        heading: section.heading,
        summary: `${label} also appears in narrower nerve-related interpretation, which helps explain why some B6 products sound more specific than others even when the top-line category looks similar.`,
        bullets: [
          "This lane is narrower than generic energy or stress-style marketing.",
          "It is easier to read well when the rest of the formula keeps the role of B6 clear.",
          "The formula setting still changes how much weight the shopper should give the B6 row.",
        ],
        evidenceRead: "This is a narrower interpretive lane and should not be flattened into a universal claim.",
        shopperMeaning: "Use this lane to understand positioning, but still compare products through the exact ingredient line and amount.",
      };
    case "why_dose_context_matters":
      return {
        heading: section.heading,
        summary: `Dose context matters for ${label} because two products can both say vitamin B6 while still differing meaningfully in comparison value once the stated amount and formula role are read closely.`,
        bullets: [
          "The stated amount can change how the shopper should interpret the product.",
          "Exact form and formula role can matter almost as much as the category name itself.",
          "Mixed formulas can position B6 differently from simpler single-ingredient products.",
        ],
        evidenceRead: "This section is about practical comparison and interpretation, not about promising that one B6 product always does more.",
        shopperMeaning: "Read the amount, form, and formula role together before assuming two B6 products belong in the same comparison set.",
      };
    case "serotonin_precursor_context":
      return {
        heading: section.heading,
        summary: `${label} is easiest to interpret through serotonin-precursor context, which is a cleaner and more specific lane than broad mood or sleep marketing by itself.`,
        bullets: [
          "This is the clearest lane for understanding why 5-HTP appears in supplement formulas.",
          "Broad mood or sleep wording can sound bigger than the most grounded interpretation lane.",
          "The disclosed amount still matters when shoppers compare one 5-HTP product with another.",
        ],
        evidenceRead: "This is the clearest and most practical 5-HTP lane, but it should still be read through the exact label line and amount.",
        shopperMeaning: "Compare 5-HTP products through the named active and the disclosed dose before giving extra weight to broader packaging claims.",
      };
    case "formula_pairing_and_dose_context":
      return {
        heading: section.heading,
        summary: `Supporting lines around ${label}, such as B vitamins or companion amino-acid ingredients, can change how the formula is read without replacing the main 5-HTP line as the core comparison anchor.`,
        bullets: [
          "The supporting ingredients can change formula positioning and shopper expectations.",
          "They do not replace the main 5-HTP row when the shopper is deciding how central the active really is.",
          "Amount and co-formulation both matter before two formulas can be treated as close substitutes.",
        ],
        evidenceRead: "This is mainly a formula-interpretation section rather than a stand-alone research claim section.",
        shopperMeaning: "Use it to read the rest of the formula in context after checking the main 5-HTP line and dose.",
      };
    case "b3_coenzyme_context":
      return {
        heading: section.heading,
        summary: `${label} is easiest to read through coenzyme and metabolism-related context, which is more useful than generic energy copy when the shopper is comparing formulas.`,
        bullets: [
          "This is the clearest lane for understanding why B3 or niacinamide appears on the label.",
          "Broad energy language is looser than the actual ingredient-and-dose reading.",
          "The disclosed amount still changes how much weight the shopper should give the row.",
        ],
        evidenceRead: "This is the cleanest practical lane for B3 interpretation, and it is narrower than generic front-label energy messaging.",
        shopperMeaning: "Compare B3 products through the exact ingredient line and amount before leaning on broader category language.",
      };
    case "companion_role_on_the_label":
      return {
        heading: section.heading,
        summary: `${label} often behaves like a supporting nutrient in multi-ingredient formulas, which means the shopper has to judge whether it is central to the product or mainly part of the surrounding setup.`,
        bullets: [
          "A clearly disclosed B3 row can still be a supporting line rather than the main story of the formula.",
          "The rest of the formula changes how much comparison value the B3 line really carries.",
          "That is why two products that both list niacinamide can still feel very different once the full label is read.",
        ],
        evidenceRead: "This is a formula-role section: it explains what the B3 row is doing on the label rather than turning every B3 line into the same research story.",
        shopperMeaning: "Use it to decide whether the B3 row deserves primary comparison weight or should be read as a supporting nutrient.",
      };
    case "glycine_formula_context":
      return {
        heading: section.heading,
        summary: `${label} is often easiest to interpret as an amino-acid formula line whose importance depends on whether it is acting as a lead active or supporting a broader product story.`,
        bullets: [
          "Glycine can be central in some formulas and clearly supportive in others.",
          "The disclosed amount changes how much weight the shopper should give the row.",
          "It is more useful to read glycine through the full formula context than through generic calm or sleep language alone.",
        ],
        evidenceRead: "This is a product-context section rather than a broad umbrella claim about glycine.",
        shopperMeaning: "It helps the shopper decide whether glycine is the reason to compare the product or one supporting part of a broader formula.",
      };
    case "coformulation_changes_reading":
      return {
        heading: section.heading,
        summary: `How much ${label} matters in practice can change a lot once the shopper sees what it is paired with and whether it is carrying a supporting role instead of the lead-active role.`,
        bullets: [
          "Pairing with ingredients like 5-HTP or taurine can change what glycine is doing on the label.",
          "Supporting roles should not be mistaken for the headline story of the product.",
          "Formula context changes comparability even when the ingredient name stays the same.",
        ],
        evidenceRead: "This is about formula reading and comparison, not about claiming that glycine always means the same thing across products.",
        shopperMeaning: "Read glycine together with the rest of the active lines before assuming two products are directly comparable.",
      };
    case "taurine_physiology_context":
      return {
        heading: section.heading,
        summary: `${label} has a recognizable physiology-related context, but broad energy or performance language can easily sound wider than the clearest label-reading interpretation.`,
        bullets: [
          "This is the clearest lane for understanding why taurine is present on the label.",
          "Front-label performance wording can overstate how central taurine really is in a mixed formula.",
          "Dose and formula setting still shape how much comparison value the taurine row carries.",
        ],
        evidenceRead: "This is a real taurine lane, but it should stay narrower and more product-aware than generic performance marketing.",
        shopperMeaning: "Use the taurine row and amount as the comparison anchor before giving too much weight to broad category copy.",
      };
    case "taurine_formula_role":
      return {
        heading: section.heading,
        summary: `${label} can act as either a lead active or a supporting formula line, so the shopper has to judge its role in the context of the whole disclosed ingredient setup.`,
        bullets: [
          "A named taurine row does not automatically mean taurine is the main thing being sold.",
          "The co-ingredients and the dose change whether taurine is central or supporting.",
          "That role difference can make two taurine-containing products feel less directly comparable than they first appear.",
        ],
        evidenceRead: "This is mainly a formula-role interpretation section rather than a broad taurine claim section.",
        shopperMeaning: "It helps the shopper decide whether taurine deserves primary comparison weight or should be read as part of a broader formula.",
      };
    case "inositol_signaling_context":
      return {
        heading: section.heading,
        summary: `${label} is easiest to interpret through signaling and formula-context language, which is more useful than broad mood or hormone-adjacent marketing when products are compared.`,
        bullets: [
          "This is the clearest lane for understanding what an inositol row is doing on the label.",
          "Broad mood or hormone wording can stretch further than the most grounded interpretation lane.",
          "The product context still matters because inositol can be central in some formulas and supportive in others.",
        ],
        evidenceRead: "This is a practical inositol lane, but it should stay narrower and more product-aware than generic front-label promises.",
        shopperMeaning: "Use it to anchor the inositol row in a concrete comparison frame before relying on broader packaging language.",
      };
    case "inositol_amount_and_pairing":
      return {
        heading: section.heading,
        summary: `Amount and co-formulation matter a lot for ${label}, because the same ingredient line can carry very different comparison value depending on what else surrounds it in the formula.`,
        bullets: [
          "The disclosed amount changes interpretation more than the category label alone.",
          "Pairing with other actives can shift inositol from lead-active territory into a supporting role.",
          "That is why two inositol products may not belong in the same comparison set even if the ingredient name matches.",
        ],
        evidenceRead: "This section is about practical comparison and formula reading, not about turning inositol into a generic umbrella claim.",
        shopperMeaning: "Read the amount and the surrounding actives together before assuming two inositol formulas are interchangeable.",
      };
    case "immune_function_context":
      return {
        heading: section.heading,
        summary: `Immune-function context is still the clearest way to read ${label}, but the practical meaning of that research changes with dose, population, and the exact endpoint being measured.`,
        bullets: [
          "Immune positioning is common because zinc is easy to market in that lane, but the strongest interpretation is still outcome-specific.",
          "Dose and population can change what the research seems to support most clearly.",
          "This is one of the clearest zinc lanes, but it still should not be flattened into a one-size-fits-all immune slogan.",
        ],
        evidenceRead: "This is a legitimate zinc lane, but it still needs a narrower reading than broad immune marketing usually implies.",
        shopperMeaning: "This makes zinc easy to position, but shoppers should still compare the disclosed amount and the formula context instead of leaning only on immune wording.",
      };
    case "skin_and_barrier_research":
      return {
        heading: section.heading,
        summary: `Skin and barrier research is one reason ${label} can be positioned beyond straightforward immune support without turning zinc into a catch-all ingredient.`,
        bullets: [
          "This is a real but narrower lane than the main immune-function story.",
          "Interpretation still depends on the formula setting and the amount being used.",
          "It helps explain category overlap without turning zinc into a catch-all ingredient.",
        ],
        evidenceRead: "This is a supporting lane rather than a broad umbrella claim.",
        shopperMeaning: "It adds useful product context, but it usually should not outweigh the main ingredient and dose comparison.",
      };
    case "turmeric_traditional_and_modern_context":
      return {
        heading: section.heading,
        summary: `${label} is often easier to read through a broader turmeric lane that includes whole-root and extract products, instead of assuming every turmeric label works like a tightly standardized curcuminoid product.`,
        bullets: [
          "Turmeric can appear as whole-root powder, extract, or a curcuminoid-adjacent ingredient line.",
          "That makes the turmeric lane broader than a more tightly standardized curcumin lane.",
          "It is more useful to read the exact ingredient line first than to rely on broad anti-inflammatory folklore.",
        ],
        evidenceRead: "This is the clearest shopper-facing turmeric orientation section, but it is broader than a tightly standardized curcumin claim.",
        shopperMeaning: "Use it to separate plain turmeric products from more concentrated extract-style products before comparing labels.",
      };
    case "extract_and_curcuminoid_detail":
      return {
        heading: section.heading,
        summary: `Extract detail changes the comparison value of ${label} because whole-root products, standardized extracts, and curcuminoid-heavy formulas are not all saying the same thing on the label.`,
        bullets: [
          "Curcuminoid or standardization detail usually makes a turmeric label much easier to compare.",
          "Whole-root and extract products should not be treated as the same comparison bucket by default.",
          "Bioavailability wording can matter, but it should not be turned into a universal best-product claim.",
        ],
        evidenceRead: "This is mainly a comparison and label-interpretation section, not a blanket endorsement of every enhanced-absorption claim.",
        shopperMeaning: "Check extract identity, curcuminoid detail, and standardization before assuming two turmeric products are close substitutes.",
      };
    case "where_turmeric_and_curcumin_diverge":
      return {
        heading: section.heading,
        summary: `${label} should not automatically be read as a curcumin-equivalent line, because some turmeric products lean on a broader whole-root story while others are clearly built around concentrated curcuminoid disclosure.`,
        bullets: [
          "A turmeric label is not automatically a curcumin-dense label.",
          "Some products are built around broad turmeric positioning, while others emphasize concentrated actives.",
          "That distinction changes how interchangeable two turmeric or curcumin products really are.",
        ],
        evidenceRead: "This section sets a boundary between broad turmeric positioning and concentrated curcuminoid comparison.",
        shopperMeaning: "Use it to avoid treating turmeric products as interchangeable with more extract-specific curcumin formulas.",
      };
    case "energy_metabolism_context":
      return {
        heading: section.heading,
        summary: `${label} is easiest to interpret through energy-metabolism context, which is a cleaner and more specific lane than vague vitality language when shoppers compare CoQ10 products.`,
        bullets: [
          "Energy-metabolism context is the clearest lane for reading a CoQ10 line.",
          "This is more specific than generic vitality or daily-wellness marketing.",
          "Exact form and amount still matter when two CoQ10 products are compared.",
        ],
        evidenceRead: "This is the clearest CoQ10 lane, but it should stay narrower than generic energy-marketing language.",
        shopperMeaning: "Compare CoQ10 products through the exact ingredient line, form, and amount before leaning on broader packaging language.",
      };
    case "heart_related_context":
      return {
        heading: section.heading,
        summary: `${label} also appears in narrower heart-related and statin-adjacent discussion, but that lane is less precise than the core energy-metabolism reading and should not be stretched into a universal heart-health promise.`,
        bullets: [
          "Heart-related positioning appears often, but it is broader than the clearest CoQ10 lane.",
          "Statin-adjacent framing can matter, yet not every broad heart claim is equally specific.",
          "This lane is most useful as supporting context rather than the whole comparison story.",
        ],
        evidenceRead: "This is a real but narrower CoQ10 lane and should stay secondary to the core energy-metabolism context.",
        shopperMeaning: "Use it as supporting context, then compare products through exact CoQ10 disclosure instead of broad heart wording alone.",
      };
    case "strength_and_power_context":
      return {
        heading: section.heading,
        summary: `${label} is easiest to read through strength and repeated high-intensity performance context, which is a cleaner lane than broad sports-marketing language when creatine products are compared.`,
        bullets: [
          "Strength and high-intensity performance are the clearest creatine lanes.",
          "This is more specific than generic gym or athlete-marketing copy.",
          "Exact disclosed grams still matter before two creatine labels can be treated as close substitutes.",
        ],
        evidenceRead: "This is the clearest creatine lane, but it should stay anchored to the label rather than broad performance hype.",
        shopperMeaning: "Compare creatine products through the exact creatine line and disclosed grams before giving extra weight to broad performance language.",
      };
    case "exercise_recovery_context":
      return {
        heading: section.heading,
        summary: `${label} also appears in exercise-recovery and training-volume language, but that lane is secondary to the main strength-and-power reading and should not be confused with generic recovery ingredients.`,
        bullets: [
          "Recovery-related interpretation appears often, especially in training-focused formulas.",
          "This lane is narrower and more secondary than the main strength-and-power context.",
          "Formula setting still changes whether creatine is the clear lead active or one part of a broader sports stack.",
        ],
        evidenceRead: "This is a useful secondary lane, but it should not replace the clearest creatine comparison anchor.",
        shopperMeaning: "Use it to understand product positioning, then compare labels through the main creatine line and amount.",
      };
    case "glucose_metabolic_context":
      return {
        heading: section.heading,
        summary: `${label} is easiest to interpret through glucose-metabolic context, which is a cleaner and more specific lane than broad metabolism marketing when berberine products are compared.`,
        bullets: [
          "Glucose-metabolic context is the clearest berberine lane.",
          "This is more specific than generic metabolism or blood-sugar-support headlines by themselves.",
          "Exact berberine disclosure and dose still matter before products can be treated as direct substitutes.",
        ],
        evidenceRead: "This is the clearest berberine lane, but it should stay bounded and outcome-aware rather than turning into a universal metabolic story.",
        shopperMeaning: "Compare berberine products through the exact berberine line and dose before leaning on broad metabolic packaging claims.",
      };
    case "lipid_related_context":
      return {
        heading: section.heading,
        summary: `${label} also appears in lipid-related discussion, but that lane is broader and less clean than the main glucose-metabolic reading, so it should stay secondary when products are compared.`,
        bullets: [
          "Lipid-related interpretation appears often, but it is broader than the clearest berberine lane.",
          "Outcome specificity still matters more than packaging usually suggests.",
          "This lane is most useful as supporting context rather than the whole comparison story.",
        ],
        evidenceRead: "This is a secondary berberine lane and should not replace the more concrete glucose-metabolic anchor.",
        shopperMeaning: "Use it as supporting context, then compare products through exact berberine disclosure, dose, and formula setting.",
      };
    case "dose_and_extract_context":
      return {
        heading: section.heading,
        summary: `Exact berberine disclosure matters for ${label} because dose, extract wording, and combo-formula context can change how central berberine really is in the product.`,
        bullets: [
          "Berberine HCl or more exact extract wording improves comparison.",
          "Dose matters more than broad botanical storytelling when similar products are compared.",
          "Combo formulas can change whether berberine is the main anchor or one part of a wider metabolic stack.",
        ],
        evidenceRead: "This is mainly a comparison and label-reading section rather than a universal claim about what berberine always does.",
        shopperMeaning: "Check dose, exact berberine wording, and whether the formula is combo-driven before assuming two berberine products do the same job.",
      };
    case "glutathione_precursor_context":
      return {
        heading: section.heading,
        summary: `${label} is easiest to interpret through glutathione-precursor context, which is a cleaner and more specific NAC lane than broad detox or antioxidant wording.`,
        bullets: [
          "Precursor framing is the clearest way to understand why NAC appears on the label.",
          "This is more useful than broad detox-style marketing when products are compared.",
          "Exact NAC amount still matters before two formulas can be treated as close substitutes.",
        ],
        evidenceRead: "This is the clearest NAC lane, but it should stay narrower than vague antioxidant or detox copy.",
        shopperMeaning: "Compare NAC products through the named active and disclosed amount before giving extra weight to broader wellness language.",
      };
    case "respiratory_and_mucus_context":
      return {
        heading: section.heading,
        summary: `${label} also appears in narrower respiratory and mucus-related discussion, but that lane is more context-sensitive than the core glutathione-precursor reading and should stay carefully bounded.`,
        bullets: [
          "Respiratory-adjacent interpretation appears often, but it is narrower than generic immune marketing.",
          "This lane is more context-sensitive than the core precursor lane.",
          "Formula setting and use context still change how much weight the shopper should give the NAC row.",
        ],
        evidenceRead: "This is a real but narrower NAC lane and should stay secondary to the core precursor context.",
        shopperMeaning: "Use it as secondary context, then compare products through the exact NAC line, dose, and formula setting.",
      };
    case "what_dose_and_use_context_can_change":
      return {
        heading: section.heading,
        summary: `Dose and use context matter for ${label} because similar NAC labels can still carry different comparison value once the amount and broader formula job are read closely.`,
        bullets: [
          "Dose changes interpretation more than the category name alone.",
          "Use context changes how central NAC is to the product story.",
          "Single-ingredient and blend formulas should not be read as the same comparison bucket by default.",
        ],
        evidenceRead: "This section is about practical label interpretation and comparison, not about claiming that one NAC setup is universally best.",
        shopperMeaning: "Read the NAC amount, use context, and surrounding formula together before assuming two NAC products belong in the same comparison set.",
      };
    case "skin_and_connective_tissue_context":
      return {
        heading: section.heading,
        summary: `${label} is easiest to interpret through skin and connective-tissue context, which is a cleaner and more specific collagen lane than generic beauty marketing by itself.`,
        bullets: [
          "Skin and connective-tissue context is the clearest collagen lane.",
          "This is more specific than broad beauty or healthy-aging packaging language.",
          "Exact collagen source, type, and amount still matter before products are treated as close substitutes.",
        ],
        evidenceRead: "This is the clearest collagen lane, but it should stay narrower than generic beauty-style copy.",
        shopperMeaning: "Compare collagen products through the exact source, type, and disclosed amount before leaning on broad beauty positioning.",
      };
    case "joint_and_structure_context":
      return {
        heading: section.heading,
        summary: `${label} also appears in joint and structural-support discussion, but that lane is secondary to the clearest connective-tissue reading and should not be treated as identical to other mobility ingredients.`,
        bullets: [
          "Joint-related interpretation appears often, but it is broader than the clearest collagen lane.",
          "Structural-support wording can matter without making every collagen label tell the same story.",
          "Formula setting still changes whether a product leans more cosmetic, structural, or blended in its positioning.",
        ],
        evidenceRead: "This is a useful secondary collagen lane, but it should stay context-aware and bounded.",
        shopperMeaning: "Use it to understand whether a collagen product leans more structural or cosmetic before comparing it with other formulas.",
      };
    case "source_and_type_context":
      return {
        heading: section.heading,
        summary: `Source and type detail change the comparison value of ${label} because marine, bovine, hydrolyzed, and type-specific collagen lines are not all saying the same thing on the label.`,
        bullets: [
          "Marine and bovine collagen should not be flattened into identical shorthand.",
          "Type or peptide detail usually improves comparison much more than a generic collagen headline.",
          "Source differences can matter without turning the section into a universal best-source ranking.",
        ],
        evidenceRead: "This is mainly a comparison and disclosure section rather than a hard ranking section.",
        shopperMeaning: "Check source, type, and peptide detail before assuming two collagen products belong in the same comparison set.",
      };
    case "hydration_context":
      return {
        heading: section.heading,
        summary: `${label} is easiest to interpret through hydration context, which is a cleaner and more specific electrolyte-product lane than vague wellness or energy language by itself.`,
        bullets: [
          "Hydration is the clearest lane for reading an electrolyte-focused product.",
          "This is more specific than broad wellness or active-lifestyle packaging language.",
          "The exact electrolyte disclosure still matters before two hydration products can be treated as close substitutes.",
        ],
        evidenceRead: "This is the clearest electrolyte-product lane, but it should stay grounded in the actual label rather than broad sports-drink hype.",
        shopperMeaning: "Compare hydration products through their disclosed electrolyte setup before leaning on broad hydration branding alone.",
      };
    case "exercise_and_sweat_loss_context":
      return {
        heading: section.heading,
        summary: `${label} also appears in exercise and sweat-loss positioning, but that lane is narrower and more use-context dependent than the clearest hydration reading.`,
        bullets: [
          "Exercise-related framing appears often, especially in training-oriented products.",
          "Sweat-loss context can matter without making every hydration product tell the same story.",
          "The rest of the formula still changes whether the product reads like everyday hydration or workout support.",
        ],
        evidenceRead: "This is a useful secondary electrolyte-product lane, but it should stay narrower than the main hydration context.",
        shopperMeaning: "Use it to understand whether a product is framed more around training or everyday hydration before comparing formulas.",
      };
    case "balance_and_disclosure_context":
      return {
        heading: section.heading,
        summary: `Balance and disclosure change the comparison value of ${label} because sodium, potassium, magnesium, carbohydrate context, and flavor-system add-ons are not all disclosed with the same clarity across hydration products.`,
        bullets: [
          "Disclosed electrolyte balance usually matters more than a broad hydration headline.",
          "Sweeteners, carbohydrate systems, and add-on actives can change what the product is really built to do.",
          "More itemized disclosure usually makes hydration products easier to compare side by side.",
        ],
        evidenceRead: "This is mainly a comparison and label-reading section rather than a broad efficacy claim.",
        shopperMeaning: "Check electrolyte balance, carbohydrate context, and overall disclosure detail before assuming two hydration products belong in the same comparison set.",
      };
    case "muscle_and_recovery_context":
      return {
        heading: section.heading,
        summary: `${label} is easiest to interpret through muscle and recovery context, which is a cleaner and more specific protein lane than broad fitness marketing by itself.`,
        bullets: [
          "Muscle-support and recovery language is the clearest lane for reading a protein label.",
          "This is more specific than generic fitness, lean-body, or active-lifestyle copy.",
          "Exact disclosed protein and source still matter before two protein products can be treated as close substitutes.",
        ],
        evidenceRead: "This is the clearest protein lane, but it should stay anchored to the actual protein line rather than broad gym-style packaging language.",
        shopperMeaning: "Compare protein products through exact protein source and disclosed grams before leaning on broader fitness copy.",
      };
    case "satiety_and_meal_support_context":
      return {
        heading: section.heading,
        summary: `${label} also appears in satiety and meal-support positioning, but that lane is broader than the clearest muscle-and-recovery reading and should not be flattened into generic weight-loss marketing.`,
        bullets: [
          "Satiety-related interpretation appears often, especially in powders and meal-support products.",
          "This lane is broader and more context-dependent than the clearest protein lane.",
          "The rest of the formula changes whether the product reads like straightforward protein support or a more meal-like blend.",
        ],
        evidenceRead: "This is a useful secondary protein lane, but it should stay bounded and product-aware.",
        shopperMeaning: "Use it to understand whether a protein product leans more recovery-oriented or meal-support oriented before comparing formulas.",
      };
    case "protein_type_and_disclosure_context":
      return {
        heading: section.heading,
        summary: `Protein type and disclosure matter for ${label} because whey, pea, soy, isolate, concentrate, and blended protein lines are not all saying the same thing on the label.`,
        bullets: [
          "Exact protein source usually improves comparison much more than a generic protein headline.",
          "Isolate, concentrate, and blend wording can change how directly products should be compared.",
          "Flavor systems and add-on actives can make similar-looking protein products less interchangeable than they first appear.",
        ],
        evidenceRead: "This is mainly a comparison and label-reading section rather than a hard ranking section.",
        shopperMeaning: "Check source, isolate or blend detail, and disclosed grams before assuming two protein products belong in the same comparison set.",
      };
    case "digestive_regularity_context":
      return {
        heading: section.heading,
        summary: `${label} is easiest to interpret through digestive-regularity context, which is a cleaner and more specific fiber lane than vague gut-wellness marketing.`,
        bullets: [
          "Digestive-regularity context is the clearest lane for reading a fiber label.",
          "This is more specific than generic gut-health or daily-wellness packaging language.",
          "Exact fiber type still matters before two fiber products can be treated as close substitutes.",
        ],
        evidenceRead: "This is the clearest fiber lane, but it should stay anchored to the exact fiber line rather than broad gut-branding language.",
        shopperMeaning: "Compare fiber products through the named fiber type and disclosed amount before leaning on broad gut-health copy.",
      };
    case "satiety_and_gut_context":
      return {
        heading: section.heading,
        summary: `${label} also appears in satiety and broader gut-environment positioning, but that lane is more secondary and context-dependent than the clearest digestive-regularity reading.`,
        bullets: [
          "Satiety-related interpretation appears often, but it is broader than the main regularity lane.",
          "Broader gut-environment language can matter without making every fiber label tell the same story.",
          "Formula setting still changes whether a product reads like straightforward fiber support or a wider digestive blend.",
        ],
        evidenceRead: "This is a useful secondary fiber lane, but it should stay bounded and product-aware.",
        shopperMeaning: "Use it to understand whether a fiber product is framed more around regularity, satiety, or a broader digestive story before comparing labels.",
      };
    case "source_and_solubility_context":
      return {
        heading: section.heading,
        summary: `Source and solubility detail change the comparison value of ${label} because psyllium, inulin, acacia, and mixed-fiber lines are not all saying the same thing on the label.`,
        bullets: [
          "Exact fiber type usually improves comparison much more than a generic digestive-support headline.",
          "Soluble-versus-insoluble framing can change how the label should be interpreted.",
          "Blend complexity can make similar-looking fiber products less interchangeable than they first appear.",
        ],
        evidenceRead: "This is mainly a comparison and disclosure section rather than a best-fiber ranking section.",
        shopperMeaning: "Check fiber source, solubility detail, and whether the formula is simple or blended before assuming two fiber products belong in the same comparison set.",
      };
    case "common_use_contexts":
      return {
        heading: section.heading,
        summary: `${label} often appears in products positioned around relaxation, muscle, or sleep-adjacent supplementation contexts, which is why magnesium can span more than one shopper goal without becoming a catch-all claim.`,
        bullets: [
          "Magnesium can sit in relaxation, muscle, or sleep-adjacent formulas because those are common supplementation contexts for the ingredient.",
          "That does not mean every one of those lanes carries the same evidence strength or the same shopping importance.",
          "It is more useful to read magnesium through the exact formula setting than through generic wellness copy.",
        ],
        evidenceRead: "Magnesium is versatile, but the interpretation still depends on which lane the label is actually using and how clearly the product discloses the form.",
        shopperMeaning: "This helps the shopper understand why magnesium products can sound similar at the top line while still being built for slightly different comparison goals.",
      };
    case "form_and_tolerability_context":
      if (plan.family === "iron") {
        return {
          heading: section.heading,
          summary: `Form disclosure matters for ${label} because shoppers often use it to judge tolerability, label clarity, and how directly one iron product can be compared with another.`,
          bullets: [
            "Different iron forms are often discussed for tolerability and label interpretation rather than as a universal best-form ranking.",
            "A clearly disclosed form usually makes iron products easier to compare than broad or partially described labels.",
            "This is one reason apparently similar iron products can still feel quite different in practice and on the label.",
          ],
          evidenceRead: "This section is about practical comparison and tolerability context, not about declaring one iron form universally superior.",
          shopperMeaning: "When comparing iron products, the disclosed form is often one of the first details worth checking alongside the stated amount and the rest of the formula.",
        };
      }
      return {
        heading: section.heading,
        summary: `Form disclosure matters more for ${label} than for many simpler ingredients, because shoppers often use the form line to judge tolerability, label clarity, and product fit rather than just the top-line amount.`,
        bullets: [
          "Different magnesium forms are often discussed for practical or tolerability reasons rather than because one form is universally best.",
          "A clear form line usually makes magnesium products easier to compare than a broad complex or partially disclosed blend.",
          "This is one of the main reasons magnesium labels are often read differently from simpler vitamin labels.",
        ],
        evidenceRead: "This section is about product interpretation and comparison, not about declaring a single best magnesium form.",
        shopperMeaning: "When comparing magnesium products, the disclosed form is often one of the first details worth checking alongside the amount per serving.",
      };
    case "bone_and_intake_context":
      return {
        heading: section.heading,
        summary: `${label} is most straightforward to read through bone and intake context, because that is still the clearest lane behind why calcium appears on supplement labels.`,
        bullets: [
          "Bone-related context is usually the cleanest and most intuitive calcium lane for shoppers.",
          "Intake and supplementation framing is more useful than trying to stretch calcium into broad generic health copy.",
          "This gives the shopper a more stable comparison anchor than marketing language alone.",
        ],
        evidenceRead: "This is the main and most practical lane for calcium interpretation.",
        shopperMeaning: "Start with the calcium ingredient, form, and stated amount before letting broader category language influence the comparison.",
      };
    case "form_and_absorption_context":
      return {
        heading: section.heading,
        summary: `Form is one of the key reasons calcium labels can look similar on the surface but still differ in how shoppers interpret them, especially when carbonate and citrate products are being compared.`,
        bullets: [
          "Calcium form is often discussed because labels can differ in how clearly they present the ingredient and the practical comparison context.",
          "Carbonate and citrate products are often read differently, but that does not justify turning the card into a blanket best-form ranking.",
          "Form discussion is most useful when it helps the shopper compare like with like rather than chase hype.",
        ],
        evidenceRead: "This is a useful comparison lane, but it should stay more careful than simplistic absorption-superiority claims.",
        shopperMeaning: "Use the form line to compare calcium products more carefully, especially when two products sound similar but disclose different calcium forms.",
      };
    case "how_coformulation_changes_comparison":
      return {
        heading: section.heading,
        summary: `In mixed formulas, ${label} is not always the sole story on the label, which is why calcium can read differently when it appears alone versus when it appears beside other actives.`,
        bullets: [
          "Some formulas include calcium as the main point of the product, while others include it as one piece of a broader ingredient story.",
          "That changes how much weight the shopper should give the calcium line when comparing products.",
          "The surrounding actives can matter almost as much as the calcium row itself in mixed formulas.",
        ],
        evidenceRead: "This is a comparison-setting section: co-formulation changes how central calcium is to the purchase decision.",
        shopperMeaning: "Check whether calcium is the main thing being sold or just one part of a broader formula before comparing products head-to-head.",
      };
    case "iron_status_and_deficiency_context":
      return {
        heading: section.heading,
        summary: `${label} is usually interpreted through a narrow supplementation and status-related lens rather than through the kind of broad energy language that often appears in marketing.`,
        bullets: [
          "Iron products are usually easier to understand when the shopper keeps the focus on supplementation context instead of generic vitality copy.",
          "That makes iron a more specific category to compare than many broad wellness ingredients.",
          "The clearest reading comes from the exact iron ingredient, amount, and formula setting.",
        ],
        evidenceRead: "This is a focused lane, which is why broad fatigue-style marketing can easily outrun the cleanest way to interpret iron labels.",
        shopperMeaning: "Compare iron products through the disclosed ingredient and formula context instead of letting broad energy wording carry the decision.",
      };
    case "what_product_comparison_depends_on":
      if (plan.family === "magnesium") {
        return {
          heading: section.heading,
          summary: `The most useful way to compare ${label} products is to read the exact form, the disclosed amount, and whether the label is simple enough to compare cleanly with alternatives.`,
          bullets: [
            "Exact form disclosure often matters more than category language alone.",
            "Amount per serving still matters because similar form names can appear at very different doses.",
            "Complex or partially disclosed formulas are usually harder to compare than simple, clearly labeled products.",
          ],
          evidenceRead: "This section is about practical comparison value rather than about promising that one magnesium product always works better.",
          shopperMeaning: "Read the form line and stated amount together before assuming two magnesium products are interchangeable.",
        };
      }
      if (plan.family === "iron") {
        return {
          heading: section.heading,
          summary: `The most useful iron comparison points are the exact form, the disclosed amount, and whether the formula includes other nutrients that change how the product is being positioned.`,
          bullets: [
            "Exact iron form can change how easy the label is to compare.",
            "Disclosed amount matters because similar ingredient names can appear at very different strengths.",
            "Paired nutrients can change whether the product is being framed as a narrow iron formula or a broader combo product.",
          ],
          evidenceRead: "This section is about label-reading and comparison, not about choosing a universal best iron product.",
          shopperMeaning: "Read the form, amount, and paired-nutrient context before assuming two iron products serve the same purpose.",
        };
      }
      return {
        heading: section.heading,
        summary: `${label} is easiest to compare when the exact form, amount, and label role are all clearly disclosed instead of being buried in a broader formula story.`,
        bullets: [
          "Exact ingredient identity matters.",
          "Disclosed amount matters.",
          "Label role and formula setting still influence comparability.",
        ],
        evidenceRead: "This section is about practical comparison value rather than about broad efficacy claims.",
        shopperMeaning: "Use the exact ingredient line, amount, and formula context together when comparing products in this family.",
      };
    case "sleep_timing_and_onset_context":
      return {
        heading: section.heading,
        summary: `${label} is easiest to understand through sleep timing and onset context, because melatonin is usually discussed through circadian timing rather than through broad generic sleep marketing.`,
        bullets: [
          "The clearest melatonin lane is about timing and sleep-onset context rather than a catch-all sleep promise.",
          "Circadian timing language is more useful than generic bedtime positioning when shoppers compare products.",
          "This is why melatonin labels can sound simple while still differing a lot in how they should be interpreted.",
        ],
        evidenceRead: "This is the clearest and most stable lane for melatonin interpretation.",
        shopperMeaning: "Compare melatonin products through timing-oriented context and the disclosed amount instead of reading every sleep claim as interchangeable.",
      };
    case "what_dose_and_use_context_can_change":
      return {
        heading: section.heading,
        summary: `How ${label} should be interpreted can change a lot with dose, use context, and label framing, which is why products that all say melatonin can still be serving slightly different shopper needs.`,
        bullets: [
          "Dose can change how the product is being positioned and compared.",
          "Use context matters because the same ingredient can show up in products aimed at different timing or routine questions.",
          "The label can sound simple while still hiding meaningful comparison differences in the details.",
        ],
        evidenceRead: "This is a practical interpretation section: melatonin should not be reduced to a single one-size-fits-all use case.",
        shopperMeaning: "Check the disclosed amount and how the label frames timing or routine context before assuming two melatonin products are equivalent.",
      };
    case "most_studied_outcomes":
      return {
        heading: section.heading,
        summary: `${label} is most useful to read through the outcome lanes most commonly discussed for curcumin or curcuminoid ingredients, rather than through a vague anti-inflammatory promise that tries to cover every possible use case at once.`,
        bullets: [
          "Joint-comfort, inflammation-adjacent, and recovery-style lanes are often easier to interpret than broad whole-body positioning.",
          "The cleanest reading comes from matching the exact curcumin ingredient line with the narrower outcomes the label seems to be aiming at.",
          "That keeps the shopper focused on the main research map instead of on packaging language that can stretch much wider.",
        ],
        evidenceRead: "This is a real and recognizable curcumin lane, but the clearest signals are still narrower than the broadest anti-inflammatory marketing language.",
        shopperMeaning: "Use the main curcumin lane to separate more evidence-grounded positioning from broader claims that sound stronger than the label detail supports.",
      };
    case "why_extract_detail_matters":
      return {
        heading: section.heading,
        summary: `Extract detail matters for ${label} because standardized curcuminoid lines, named extracts, and clearer ingredient wording often make curcumin products easier to compare than labels that only sound turmeric-adjacent at the top level.`,
        bullets: [
          "A clearly described curcuminoid or extract line gives the shopper a better comparison handle than broad turmeric wording alone.",
          "Two curcumin products can look similar from the front of the label while still offering very different comparison value once the exact extract detail is read.",
          "This is why standardized extract detail often matters more as a label-reading aid than as a built-in superiority claim.",
        ],
        evidenceRead: "This is a comparison-focused section: extract detail improves interpretability, but it does not prove that one curcumin product is universally best.",
        shopperMeaning: "When comparing curcumin products, the exact extract wording and any standardization detail are often more useful than broad category language alone.",
      };
    case "where_evidence_remains_mixed":
      return {
        heading: section.heading,
        summary: `Broader benefit language for ${label} can travel further than the cleanest curcumin research lanes, which is why some labels sound more certain than the most comparable outcome-specific evidence actually is.`,
        bullets: [
          "The further a curcumin product moves from a narrow extract-and-outcome story, the more careful the shopper usually needs to be with interpretation.",
          "Formula design, accompanying ingredients, and the exact claim lane can all change how persuasive the label sounds relative to the detail it actually discloses.",
          "This is one reason curcumin packaging can feel stronger than the most decision-useful comparison facts on the label.",
        ],
        evidenceRead: "This is the main caution lane for curcumin: broad benefit language often outruns the clearest outcome-specific reading.",
        shopperMeaning: "Keep the shopping decision anchored to the exact curcumin line and extract detail rather than to the broadest promise on the package.",
      };
    case "stress_and_mood_related_research":
      return {
        heading: section.heading,
        summary: `${label} is easiest to read through stress- and mood-adjacent research context, because that is usually the clearest lane behind why ashwagandha appears on supplement labels in the first place.`,
        bullets: [
          "This lane usually gives the shopper a cleaner interpretation anchor than broad resilience or wellness wording.",
          "It helps explain why ashwagandha often sounds calmer and more specific than many other botanical ingredients on the label.",
          "At the same time, the cleanest interpretation still depends on the exact extract line and the rest of the formula.",
        ],
        evidenceRead: "This is the strongest and most shopper-useful ashwagandha lane, but it should still stay narrower than broad mood or resilience marketing.",
        shopperMeaning: "Treat stress- and mood-related context as the main reason to compare ashwagandha labels, rather than assuming every broad calm claim means the same thing.",
      };
    case "sleep_and_recovery_context":
      return {
        heading: section.heading,
        summary: `${label} also appears in sleep- and recovery-adjacent contexts, but this is a narrower secondary lane than the main stress-related story and should not be read as if ashwagandha works like a dedicated sleep ingredient.`,
        bullets: [
          "This lane helps explain why ashwagandha can show up in bedtime or recovery formulas without making every ashwagandha product a direct sleep analogue.",
          "The interpretation usually changes with formula setting, dose, and the rest of the ingredient story around it.",
          "That keeps this section useful as context, but not as the main comparison lane for most ashwagandha products.",
        ],
        evidenceRead: "This is a real but secondary lane for ashwagandha, and it is easier to overread than the main stress-context section.",
        shopperMeaning: "Use this as supporting context after you understand the main stress-oriented positioning and the exact extract line on the label.",
      };
    case "why_extract_identity_matters":
      return {
        heading: section.heading,
        summary: `Extract identity matters for ${label} because branded or more clearly named withania extract lines often change how directly shoppers feel they can compare one ashwagandha product with another.`,
        bullets: [
          "A named extract line gives the shopper a clearer comparison handle than generic ashwagandha wording alone.",
          "This can matter even when two products sound similar at the category level.",
          "It is most useful as a label-reading distinction, not as proof that a branded extract is automatically better for every shopper.",
        ],
        evidenceRead: "This is a comparison and interpretation lane, not a blanket extract-superiority claim.",
        shopperMeaning: "When comparing ashwagandha products, the exact extract identity can be one of the most useful details for deciding whether two labels really belong in the same comparison set.",
      };
    case "energy_and_fatigue_context":
      return {
        heading: section.heading,
        summary: `${label} is easier to read through energy- and fatigue-adjacent context than through generic stimulant-style marketing, because ginseng products often live or die on how specifically that lane is framed on the label.`,
        bullets: [
          "This lane works best when it is kept narrower than catch-all energy wording.",
          "Species and extract detail often affect how much comparison value the shopper can actually get from the label.",
          "That makes precise label-reading more useful than simply trusting top-line energy positioning.",
        ],
        evidenceRead: "This is one of the clearest ginseng lanes, but it still needs to be read more carefully than broad energy marketing usually implies.",
        shopperMeaning: "Use the narrower energy/fatigue lane to compare ginseng products instead of assuming that every ginseng label is making the same kind of promise.",
      };
    case "cognitive_and_performance_interpretation":
      return {
        heading: section.heading,
        summary: `${label} also appears in cognitive- and performance-adjacent interpretation, but this is a broader and more variable lane than the most specific energy/fatigue reading.`,
        bullets: [
          "This section helps explain why ginseng can sound broader on the label than the clearest comparison lane really is.",
          "Outcome breadth, product framing, and shopper expectations can all change how this lane should be interpreted.",
          "That makes it useful context, but usually not the first section a shopper should rely on when comparing two ginseng products.",
        ],
        evidenceRead: "This is a broader and less tidy lane for ginseng, so it should carry less interpretive weight than the tighter energy/fatigue lane.",
        shopperMeaning: "Keep this as a secondary reading layer after you have already compared species, extract detail, and the more specific lane on the label.",
      };
    case "why_species_and_extract_detail_matter":
      return {
        heading: section.heading,
        summary: `Species and extract detail matter for ${label} because Panax, American, red ginseng, and differently described extract lines can sound similar at the category level while still changing how well the shopper can compare one label with another.`,
        bullets: [
          "Species naming is often one of the most important comparison clues on a ginseng label.",
          "Extract detail can change whether two ginseng products really belong in the same comparison bucket.",
          "This is most useful as a precision and comparison tool, not as a shortcut to declare one ginseng type universally superior.",
        ],
        evidenceRead: "This is primarily a label-precision section: clearer species and extract detail make ginseng products easier to compare.",
        shopperMeaning: "Before comparing ginseng products head to head, check whether the label clearly identifies the species and the extract rather than relying on the word ginseng alone.",
      };
    case "catechin_and_antioxidant_context":
      return {
        heading: section.heading,
        summary: `${label} is easiest to read through catechin- and extract-detail context, because green tea extract labels often become most informative when the shopper can see how closely the product is tied to its actual catechin or EGCG content.`,
        bullets: [
          "This lane is more useful than broad antioxidant tea language because it stays closer to the part of the label that can actually be compared.",
          "It helps the shopper distinguish a more clearly disclosed extract from a looser green-tea category reference.",
          "That makes exact extract wording more valuable than generic antioxidant positioning alone.",
        ],
        evidenceRead: "This is one of the strongest and most comparison-friendly green tea extract lanes because it stays tied to the exact extract detail on the label.",
        shopperMeaning: "Use catechin- and extract-detail context to separate more informative green tea labels from products that lean mostly on broad tea language.",
      };
    case "metabolic_and_weight_related_interpretation":
      return {
        heading: section.heading,
        summary: `${label} also appears in metabolic- and weight-related interpretation, but this lane is broader, easier to overstate, and more dependent on exact extract framing than the clearest catechin-focused reading.`,
        bullets: [
          "Weight-oriented packaging can outrun the most careful outcome-specific reading of a green tea extract label.",
          "The shopper usually gets a better comparison signal from the exact extract line than from broad metabolic language.",
          "That makes this lane useful as context, but not as the main reason to rank one green tea extract product over another.",
        ],
        evidenceRead: "This is a real but more interpretation-sensitive lane, so it should be read more cautiously than the tighter catechin-focused context.",
        shopperMeaning: "Treat weight- or metabolism-oriented wording as a secondary layer after comparing the exact extract and concentration details on the label.",
      };
    case "why_extract_concentration_matters":
      return {
        heading: section.heading,
        summary: `Extract concentration matters for ${label} because catechin or EGCG-heavy labels often give shoppers a much clearer basis for comparison than products that only mention green tea extract in broad category terms.`,
        bullets: [
          "Concentration detail often determines how easy one green tea extract product is to compare with another.",
          "A more explicit EGCG or catechin line usually carries more comparison value than broad extract naming alone.",
          "This is best read as a precision and label-reading advantage, not as automatic proof that a more concentrated product is universally better.",
        ],
        evidenceRead: "This is a comparison lane first: concentration detail sharpens interpretation even when it does not settle every efficacy question.",
        shopperMeaning: "When comparing green tea extract products, exact concentration detail is often one of the best clues to whether two labels actually belong in the same comparison set.",
      };
    case "metabolic_and_body_composition_context":
      return {
        heading: section.heading,
        summary: `${label} is easiest to read through metabolic-rate and body-composition context rather than through generic fat-loss language, because that is the clearest lane for comparing 7-Keto formulas.`,
        bullets: [
          "This is the tightest comparison lane for 7-Keto because it stays closer to the actual disclosed active than broad slimming copy.",
          "The stated amount and the rest of the formula still shape how much weight the shopper should give the row.",
          "That keeps the card useful for comparison without turning it into a blanket weight-loss promise.",
        ],
        evidenceRead: "This is the clearest and most comparison-friendly 7-Keto lane, but it should still stay narrower than broad metabolic marketing.",
        shopperMeaning: "Use the exact 7-Keto row and disclosed amount as the comparison anchor before giving extra weight to generic body-composition packaging language.",
      };
    case "why_it_reads_differently_from_dhea":
      return {
        heading: section.heading,
        summary: `${label} should usually be read through its own metabolite-specific lane rather than being flattened into ordinary DHEA-style category language, because that shortcut makes the label harder to compare accurately.`,
        bullets: [
          "A 7-Keto row is not the same thing as a generic DHEA headline, even when shoppers may loosely associate the two.",
          "The exact ingredient wording helps the shopper compare like with like instead of relying on category shorthand.",
          "Formula setting still matters because 7-Keto can be central in some products and just one active in others.",
        ],
        evidenceRead: "This section keeps interpretation specific and comparison-oriented rather than letting the card collapse back into generic hormone-adjacent language.",
        shopperMeaning: "Compare products through the exact metabolite line before assuming they belong in the same bucket as broader DHEA-style formulas.",
      };
    case "body_composition_context":
      return {
        heading: section.heading,
        summary: `${label} is easiest to read through body-composition and fatty-acid context rather than through generic slimming language, because that is the clearest lane for comparing CLA labels.`,
        bullets: [
          "This lane keeps the shopper focused on the disclosed CLA row instead of broad weight-loss packaging copy.",
          "The stated amount and the rest of the formula still change how central the CLA line really is.",
          "That makes label detail more useful than broad category wording when products are compared.",
        ],
        evidenceRead: "This is the cleanest CLA lane, but it should stay narrower and more label-aware than generic slimming claims.",
        shopperMeaning: "Compare CLA products through the exact row and amount before treating broad body-composition wording as the whole story.",
      };
    case "source_oil_and_isomer_detail":
      return {
        heading: section.heading,
        summary: `Source-oil and isomer detail matter for ${label} because safflower-oil wording or more explicit CLA disclosure can change how directly one label compares with another.`,
        bullets: [
          "A source-oil line can carry real comparison value when the top-level category wording is broad.",
          "More explicit fatty-acid wording often makes the label easier to compare than generic CLA shorthand alone.",
          "This is most useful as a precision and label-reading tool, not as a universal best-source claim.",
        ],
        evidenceRead: "This section is about comparison precision: source and isomer detail can matter even when two products both sound like CLA formulas at the top level.",
        shopperMeaning: "Read the source-oil line before assuming two CLA labels are close substitutes.",
      };
    case "energy_transport_and_exercise_context":
      return {
        heading: section.heading,
        summary: `${label} is easiest to interpret through energy-transport and exercise-context language rather than through generic performance slogans, because that is the clearest lane for reading carnitine on a supplement label.`,
        bullets: [
          "This keeps the shopper anchored to the actual carnitine row instead of broad performance marketing.",
          "The amount and the rest of the formula still affect how central the carnitine line is to the purchase decision.",
          "That makes the exact active line more useful than top-level category language when products are compared.",
        ],
        evidenceRead: "This is the clearest carnitine lane, but it should stay narrower and more product-aware than broad performance copy.",
        shopperMeaning: "Compare carnitine products through the named active and amount before treating broad performance wording as the main evidence lane.",
      };
    case "what_form_disclosure_changes_for_carnitine":
      return {
        heading: section.heading,
        summary: `Form disclosure matters for ${label} because acetyl-L-carnitine, L-carnitine tartrate, and other carnitine lines can change how directly one formula compares with another.`,
        bullets: [
          "Form wording often changes product comparison value more than broad performance language alone.",
          "Different carnitine forms can live in different shopping contexts even when the category name sounds similar.",
          "This is most useful as a label-reading distinction, not as a blanket best-form ranking.",
        ],
        evidenceRead: "This section is about precision and comparison rather than about declaring one carnitine form universally superior.",
        shopperMeaning: "Check the exact carnitine form before assuming two formulas belong in the same comparison set.",
      };
    case "lipid_and_triglyceride_research":
      return {
        heading: section.heading,
        summary: `The clearest way to read ${label} is through triglyceride and lipid-marker research, because that is still the most concrete and decision-useful EPA evidence lane.`,
        bullets: [
          "This is the lane where EPA is easiest to compare across products because the endpoints are more concrete than broad heart-language.",
          "It is more useful to read EPA through lipid endpoints than through slogan-style cardiovascular packaging copy.",
          "Dose, baseline risk, and study population can still change how findings apply to a shopper's context.",
        ],
        evidenceRead: "This is one of the stronger and more decision-useful lanes in omega-3 interpretation because the endpoints are clearer and less inflated by marketing.",
        shopperMeaning: "If you are comparing omega-3 products, this is why the EPA breakdown line matters more than the top-line fish-oil number alone.",
      };
    case "inflammation_and_recovery_context":
      return {
        heading: section.heading,
        summary: `${label} also appears in inflammation, soreness, and recovery discussions, but this lane is less settled and less direct than the lipid-focused research lane.`,
        bullets: [
          "These discussions can sound compelling in sports or recovery marketing, but the outcome map is less tidy than it is for triglycerides.",
          "Training context, baseline status, and study design can all shift the apparent signal.",
          "This works best as secondary context rather than as the main comparison story for EPA.",
        ],
        evidenceRead: "This lane is more mixed and should carry less weight than the lipid-focused section when you compare products.",
        shopperMeaning: "Keep this as a secondary comparison lens after you have already compared the clearer EPA dose and breakdown details.",
      };
    case "broader_heart_claim_boundaries":
      return {
        heading: section.heading,
        summary: `Broad heart-health language often reaches further than the narrowest EPA evidence lane, which is why packaging can sound more certain than the underlying endpoint map.`,
        bullets: [
          "A triglyceride or lipid signal is not automatically the same thing as a blanket cardiovascular promise.",
          "Endpoint specificity matters more than slogan-style positioning when you compare products.",
          "The same ingredient can sit behind several claims with very different evidence strength.",
        ],
        evidenceRead: "This is mainly a boundary-setting section: not every broad heart claim sits on equally strong evidence.",
        shopperMeaning: "Compare products on the detailed EPA disclosure and label breakdown, not just on general heart-health packaging language.",
      };
    case "brain_and_eye_context":
      return {
        heading: section.heading,
        summary: `${label} is usually easier to understand through brain and eye context than through EPA-style lipid language, which is why DHA tends to read differently on supplement labels.`,
        bullets: [
          "Retinal and eye-related context is one of the clearest reasons DHA appears on labels in its own right.",
          "Brain-focused positioning is common, but not every broad cognition claim sits on the same level of evidence.",
          "This is a different research lane from EPA, not just the same omega-3 story with a new name.",
        ],
        evidenceRead: "This is a meaningful DHA lane, but it still contains more nuance than a simple brain-health slogan suggests.",
        shopperMeaning: "This helps explain why DHA and EPA should not be treated as interchangeable on the label.",
      };
    case "developmental_and_structural_roles":
      return {
        heading: section.heading,
        summary: `${label} also appears in developmental and structural research contexts, which is part of why DHA often carries a different research identity from other omega-3 lines.`,
        bullets: [
          "Developmental context matters in how some DHA research is interpreted and how much of it applies outside that setting.",
          "Structural roles in tissues do not automatically translate into every broad adult-function claim that appears in marketing.",
          "This section is most useful as context for interpretation, not as a shortcut to strong headline claims.",
        ],
        evidenceRead: "This is a useful DHA context lane, but interpretation changes a lot with population and use setting.",
        shopperMeaning: "Read this as context for why DHA is discussed differently, not as a license for broad brain-claim language.",
      };
    case "how_this_differs_from_epa":
      return {
        heading: section.heading,
        summary: `${label} should not be read as a simple EPA substitute, because the research emphasis and label meaning are not identical even when both appear in the same omega-3 product.`,
        bullets: [
          "EPA and DHA are related, but the reasons shoppers might focus on them are not the same.",
          "Outcome emphasis changes across the two fatty acids, which is why the breakdown is more useful than a single total number.",
          "The EPA/DHA split is one of the most informative parts of the label for product comparison.",
        ],
        evidenceRead: "This is less about one ingredient being better and more about the research lens being different.",
        shopperMeaning: "A product with the same total omega-3 can still look very different once you read the EPA and DHA lines separately.",
      };
    case "most_studied_lipid_endpoints":
      return {
        heading: section.heading,
        summary: `For a combined omega-3 entry, the cleanest interpretation still starts with lipid and triglyceride endpoints, because that is where omega-3 evidence is usually easiest to compare.`,
        bullets: [
          "Lipid-related endpoints are the most concrete anchor for interpreting a combined omega-3 line.",
          "This is more useful than generic wellness or heart-language when you are comparing labels.",
          "It gives the shopper a more solid starting point than broad benefit slogans.",
        ],
        evidenceRead: "This is the most practical and comparison-friendly evidence lane when reading a combined omega-3 entry.",
        shopperMeaning: "Use this as the main context for comparison before giving much weight to broader claims.",
      };
    case "broader_cardiovascular_context":
      return {
        heading: section.heading,
        summary: `${label} also appears in broader cardiovascular discussions, but those claims are wider and more variable than the clearest lipid-focused endpoints.`,
        bullets: [
          "Broader cardiovascular discussions can mix stronger and weaker endpoints together.",
          "Study design and endpoint choice matter much more here than packaging usually suggests.",
          "Not every cardiovascular phrase on a label carries the same evidence weight.",
        ],
        evidenceRead: "This is a broader and less tidy lane than the main lipid-focused section.",
        shopperMeaning: "It is useful context, but it should not replace the more concrete omega-3 breakdown when comparing products.",
      };
    case "secondary_contexts":
      return {
        heading: section.heading,
        summary: `${label} is also discussed in secondary contexts such as brain, eye, and joint-related areas, but those should stay secondary in the shopping hierarchy once the core omega-3 breakdown is clear.`,
        bullets: [
          "These are adjacent research contexts rather than the cleanest primary lane for comparison.",
          "Applicability varies across outcomes and study populations.",
          "They should not outweigh the primary lipid and composition details on the label.",
        ],
        evidenceRead: "This is a useful secondary lane, but it is not as clean for comparison as the main omega-3 endpoints.",
        shopperMeaning: "Treat this as a secondary reading layer after you understand the core omega-3 breakdown and the more decision-useful label details.",
      };
    case "digestive_and_microbiome_research":
      return {
        heading: section.heading,
        summary: `Digestive and microbiome research is the main lane behind ${label}, but it becomes much easier to interpret when the label clearly names the exact strains or subcomponents involved.`,
        bullets: [
          "Digestive comfort and microbiome context are the main lanes here, not a vague wellness umbrella.",
          "Exact strain names and amounts change how well research can be matched to the label in front of the shopper.",
          "Broad probiotic wording is much less precise than strain-matched evidence.",
        ],
        evidenceRead: "This is a real research area, but precision depends heavily on strain-level disclosure.",
        shopperMeaning: "This tells the shopper why probiotic category language is less informative than exact strain naming.",
      };
    case "strain_specificity_and_fit":
      return {
        heading: section.heading,
        summary: `The key question for ${label} is not only whether research exists, but whether the label gives enough strain-level detail to map that research cleanly and compare it with other products.`,
        bullets: [
          "Exact strains matter because probiotic evidence rarely transfers cleanly from one strain to every product in the category.",
          "Amounts or CFU matter because category naming alone does not tell the shopper how much meaningful material is actually present.",
          "Broad labels weaken research fit and make product-to-product comparison much harder.",
        ],
        evidenceRead: "This is mainly a precision section: the less specific the label, the less exact the research match.",
        shopperMeaning: "It helps the shopper understand why two probiotic products in the same category may not be equally comparable.",
      };
    case "most_studied_roles":
      if (context && selectedDescriptor) {
        const roleText = lineRoleNarrative(selectedDescriptor.lineRole);
        const companionText = companionNames.length
          ? `It appears alongside ${joinReadableList(companionNames)}, so the surrounding formula changes which research lane should carry the most weight.`
          : "The surrounding formula still changes which research lane should carry the most weight.";
        return {
          heading: section.heading,
          summary: `${label} is more useful to read through the specific role it plays as a ${roleText} in this formula than through a broad umbrella of unrelated research directions.`,
          bullets: [
            companionText,
            selectedDescriptor.formContext
              ? `The line also includes ${selectedDescriptor.formContext} wording, which changes how directly it can be compared with simpler labels.`
              : "Exact ingredient identity and dose still shape which lane is most central.",
            "Not every broad claim deserves the same weight once the label role and co-ingredients are visible.",
          ]
            .map((bullet) => normalizeText(bullet))
            .filter(Boolean)
            .slice(0, 3),
          evidenceRead: "This section is an orientation tool for the ingredient inside this formula, not a blanket endorsement of every broad claim associated with the category.",
          shopperMeaning: `Use ${label} as part of the full formula map, then compare how clearly the label separates the lead active from supporting or structural lines.`,
        };
      }
      return {
        heading: section.heading,
        summary: `${label} is easier to interpret when the shopper focuses on the exact ingredient role, amount, and label detail instead of treating every broad research direction as equally central.`,
        bullets: [
          "Research emphasis changes with the exact ingredient and formula setting.",
          "Not every broad claim is equally central to the evidence.",
          "The best interpretation still depends on amount and label detail.",
        ],
        evidenceRead: "This is a useful orientation section, but it should not be read as a blanket endorsement of every possible claim.",
        shopperMeaning: "It helps the shopper distinguish core positioning from more peripheral marketing language.",
      };
    case "why_interpretation_depends_on_detail":
      return {
        heading: section.heading,
        summary: `How well research applies to ${label} depends on the exact amount, form, and formula setting rather than the ingredient category alone.`,
        bullets: [
          "Amount matters for interpretation.",
          "Exact ingredient identity and form matter.",
          "Formula context changes comparability.",
        ],
        evidenceRead: "This section is about reading evidence carefully, not about claiming one form is automatically superior.",
        shopperMeaning: "It helps the shopper understand why similar-sounding labels may still differ in practical comparability.",
      };
    case "what_this_total_line_means":
      return {
        heading: section.heading,
        summary: `${narrativeLabel} reports the total omega-3 pool in the serving rather than one stand-alone fatty acid with its own separate research story.`,
        bullets: [
          "It bundles more than one omega-3 component into a single disclosure line.",
          "That makes it useful for understanding the size of the omega-3 pool, but not for replacing the specific EPA and DHA entries.",
          "It is best read as a total-line tool, not as a single active with its own full research identity.",
        ],
        evidenceRead: "This is primarily a label-reading tool rather than the cleanest stand-alone research target.",
        shopperMeaning: "Use it to understand how much total omega-3 the product delivers, then look to the EPA and DHA lines for more detailed comparison.",
      };
    case "why_form_and_breakdown_still_matter":
      return {
        heading: section.heading,
        summary: `A total line becomes much more useful once it is read alongside the EPA and DHA breakdown lines and the declared omega-3 form.`,
        bullets: [
          "The EPA and DHA rows still do most of the detailed comparison work.",
          "Form disclosure adds context, but it is not the whole comparison story by itself.",
          "Top-line totals are helpful, but they can look more impressive than they are if the shopper never checks the breakdown.",
        ],
        evidenceRead: "This is a comparison-oriented interpretation section, not a research claim section.",
        shopperMeaning: "It tells the shopper which rows to read next instead of overweighting the total line.",
      };
    case "what_this_source_line_means":
      return {
        heading: section.heading,
        summary: `${narrativeLabel} identifies the oil source in the formula, which tells you where the omega-3s come from but not the full fatty-acid profile by itself.`,
        bullets: [
          "This is a source line rather than a full active breakdown.",
          "It gives origin context for the omega-3s in the product, which can matter for shopper preference and sourcing questions.",
          "It still needs to be read together with the total omega-3, EPA, and DHA lines before the product can be compared well.",
        ],
        evidenceRead: "This is mostly a label-context line rather than a direct research-summary line.",
        shopperMeaning: "Use it for source context, then compare the detailed omega-3 breakdown before judging the product.",
      };
    case "how_to_compare_from_here":
      return {
        heading: section.heading,
        summary: `Once the source line is clear, the more decision-useful rows are usually the total omega-3 figure plus the individual EPA and DHA disclosures underneath it.`,
        bullets: [
          "Read the total omega-3 line next.",
          "Read the EPA and DHA lines after that.",
          "Treat the source line as context, not as the whole comparison answer.",
        ],
        evidenceRead: "This section is purely about better label interpretation and product comparison.",
        shopperMeaning: "It helps the shopper avoid confusing source identity with the ingredient amounts that usually matter most.",
      };
    case "what_this_hydration_line_means":
      return {
        heading: section.heading,
        summary: `${narrativeLabel} is better interpreted as a hydration-formula identity line than as a single stand-alone research ingredient with its own full evidence card.`,
        bullets: [
          "This line usually signals the type of hydration or electrolyte product you are looking at.",
          "It gives context for the disclosed minerals and supporting actives underneath it rather than replacing them.",
          "That makes it useful for orientation, but weaker than a fully itemized electrolyte breakdown for direct comparison.",
        ],
        evidenceRead: "This is mainly a label-reading section, not a stand-alone evidence summary for one isolated ingredient.",
        shopperMeaning: "Use this line for product context first, then compare the more specific electrolyte and formula rows underneath it.",
      };
    case "why_balance_and_disclosure_still_matter":
      return {
        heading: section.heading,
        summary: `The practical comparison value of ${narrativeLabel} still depends on how clearly the label discloses the electrolyte balance, carbohydrate context, and other supporting details around it.`,
        bullets: [
          "The broad hydration line is not the whole comparison answer by itself.",
          "Sodium, potassium, magnesium, and related details still do most of the practical comparison work.",
          "Cleaner disclosure usually makes hydration products easier to compare than broad branding alone.",
        ],
        evidenceRead: "This is a disclosure and comparison section rather than a broad efficacy claim.",
        shopperMeaning: "Treat the hydration line as a starting point, then compare the disclosed balance and supporting formula details before judging the product.",
      };
    case "what_this_line_means":
      return {
        heading: section.heading,
        summary: `${narrativeLabel} is better interpreted as a label-structure line for this product than as a stand-alone research claim.`,
        bullets: [
          "It gives context about how this formula is disclosed on the label.",
          companionNames.length > 0
            ? `Read it together with ${joinReadableList(companionNames)} before deciding which row should carry primary comparison weight.`
            : "Read it together with nearby ingredient rows before deciding which line should carry primary comparison weight.",
          "Its interpretation depends on surrounding disclosure detail, not on this line alone.",
        ],
        evidenceRead: "This is a label-meaning section rather than a traditional research summary.",
        shopperMeaning: `Use ${narrativeLabel} as context first, then rank comparison weight using the clearer ingredient rows around it.`,
      };
    case "why_it_matters_for_comparison":
      return {
        heading: section.heading,
        summary: `${narrativeLabel} still affects comparison confidence because thinner disclosure around this line makes side-by-side product ranking less reliable.`,
        bullets: [
          "Some rows add context but do not carry the whole comparison on their own.",
          "Comparison quality depends on how clearly the rest of the label explains related actives.",
          "More itemized disclosure usually improves interpretation and product-to-product comparability.",
        ],
        evidenceRead: "This is about comparability and disclosure quality, not about claiming a direct effect.",
        shopperMeaning: `Treat ${narrativeLabel} as a confidence signal for disclosure quality, then compare products through the better-explained rows.`,
      };
    case "what_this_blend_line_shows":
      if (isPhageBlend(plan.selectedLabel)) {
        return {
          heading: section.heading,
          summary: `${narrativeLabel} gives category-level context for the bacteriophage side of the formula, but it does not fully show which named phages or phage families are carrying the most research weight underneath it.`,
          bullets: [
            "A phage blend line gives category context more than item-by-item precision.",
            "A single blend amount does not tell the shopper how much of each named phage component is present.",
            "That makes the label easier to summarize than to match cleanly to more specific phage research or product comparisons.",
          ],
          evidenceRead: "This is primarily a disclosure and interpretation section rather than a stand-alone evidence summary.",
          shopperMeaning: "It helps the shopper understand why a broad phage blend line is useful as context but weaker for precise comparison.",
        };
      }
      return {
        heading: section.heading,
        summary: `${narrativeLabel} gives category-level context for the formula, but it does not fully show which named strains or subcomponents are carrying the most research weight underneath it.`,
        bullets: [
          "A blend line gives category context more than item-by-item precision.",
          "A total blend amount does not tell the shopper how much of each named component is present.",
          "That makes the label easier to summarize than to match cleanly to specific research.",
        ],
        evidenceRead: "This is primarily a disclosure and interpretation section rather than a stand-alone evidence summary.",
        shopperMeaning: "It helps the shopper understand why a broad blend label is useful as context but weaker for precise comparison.",
      };
    case "why_specific_disclosure_changes_fit":
      if (isPhageBlend(plan.selectedLabel)) {
        return {
          heading: section.heading,
          summary: `Research matching becomes much easier once the label moves beyond a broad phage blend line and names the specific phages, families, or subcomponents more clearly.`,
          bullets: [
            "Named phages or more specific family detail improve research fit.",
            "Blend totals alone leave important comparison gaps.",
            "More granular disclosure usually makes phage-focused product comparison easier.",
          ],
          evidenceRead: "This is about research fit and transparency, not about claiming that the phage blend is ineffective.",
          shopperMeaning: "It helps the shopper understand why a more itemized phage label is usually easier to compare than a broad blend line by itself.",
        };
      }
      return {
        heading: section.heading,
        summary: `Research matching becomes much easier once the label moves beyond a broad blend line and names the strains or subcomponents more precisely.`,
        bullets: [
          "Named strains or named components improve research fit.",
          "Blend totals alone leave important comparison gaps.",
          "More granular disclosure usually makes product-to-product comparison easier.",
        ],
        evidenceRead: "This is about research fit and transparency, not about claiming that the blend is ineffective.",
        shopperMeaning: "It helps the shopper understand why a more itemized label is usually easier to compare than a broad blend line by itself.",
      };
    default:
      if (context && selectedDescriptor) {
        const roleText = lineRoleNarrative(selectedDescriptor.lineRole);
        const anchorContext =
          anchorName && normalizeIngredientScienceKey(anchorName) !== normalizeIngredientScienceKey(plan.selectedLabel)
            ? ` around ${anchorName}`
            : "";
        const formBullet = selectedDescriptor.formContext
          ? `The line includes ${selectedDescriptor.formContext} wording, which changes how directly it can be compared with simpler labels.`
          : `This row behaves like a ${roleText}${anchorContext}, so the formula context matters as much as the ingredient family.`;
        const companionBullet = companionNames.length
          ? `${label} appears alongside ${joinReadableList(companionNames)}, so shoppers should read it in the context of the surrounding formula rather than as an isolated ingredient story.`
          : dedupe(section.bulletThemes)[0] ?? "Amount, identity, and surrounding formula context all affect interpretation.";
        const relationshipBullet =
          relationshipStatement ??
          dedupe(section.bulletThemes)[1] ??
          "The rest of the label can change how central this ingredient really is for product comparison.";
        return {
          heading: section.heading,
          summary: `The useful way to read ${label} in this formula depends on its role as a ${roleText}${anchorContext}, not just on the broad category it belongs to.`,
          bullets: [
            formBullet,
            companionBullet,
            relationshipBullet,
          ]
            .map((bullet) => normalizeText(bullet))
            .filter(Boolean)
            .slice(0, 3),
          evidenceRead: "This is a formula-aware orientation section, not a universal claim about the ingredient in every product.",
          shopperMeaning: `Use ${label} as one part of the formula map, then compare how clearly the label separates the lead active from companion or structural lines.`,
        };
      }
      return {
        heading: section.heading,
        summary: `The useful way to read ${label} still depends on the exact ingredient identity, amount, and label detail, not just on the broad category it belongs to.`,
        bullets: dedupe(section.bulletThemes).slice(0, 3),
        evidenceRead: "This is a broad orientation section, not a universal claim.",
        shopperMeaning: section.shopperMeaningGoal,
      };
  }
};

const firstEvidenceSentence = (
  bucket:
    | ScientificBackgroundEvidenceRow["segments"]["summarySupport"]
    | ScientificBackgroundEvidenceRow["segments"]["evidenceReadSupport"]
    | ScientificBackgroundEvidenceRow["segments"]["shopperMeaningSupport"]
    | ScientificBackgroundEvidenceRow["segments"]["caveats"]
    | undefined,
): string | null => {
  const text = normalizeText(bucket?.[0]?.text);
  return text ? asSentence(text) : null;
};

const appendUniqueSentence = (base: string, addition: string | null): string => {
  const normalizedBase = normalizeText(base);
  const normalizedAddition = normalizeText(addition);
  if (!normalizedAddition) return normalizedBase;
  if (!normalizedBase) return asSentence(normalizedAddition);
  if (normalizedBase.toLowerCase().includes(normalizedAddition.toLowerCase())) return normalizedBase;
  return `${asSentence(normalizedBase)} ${asSentence(normalizedAddition)}`.trim();
};

const resolveEvidenceVariantKey = (params: {
  plan: ScientificBackgroundPlan;
  section: ScientificBackgroundSectionPlan;
  context: IngredientScienceContext;
  selectedDescriptor: IngredientScienceDescriptor | null;
}): string | undefined => {
  const evidenceEligibleSection =
    params.section.headingId === "antioxidant_and_immune_research" ||
    params.section.headingId === "form_and_tolerability_context" ||
    params.section.headingId === "what_product_comparison_depends_on" ||
    params.section.headingId === "iron_absorption_context" ||
    params.section.headingId === "immune_function_context" ||
    params.section.headingId === "why_dose_context_matters" ||
    params.section.headingId === "what_dose_and_use_context_can_change";
  if (!evidenceEligibleSection) return undefined;

  const contextText = normalizeText(
    [
      params.context.productName,
      ...params.context.ingredientRows.map((row) => row.name),
      ...params.context.ingredientSnapshotNames,
    ]
      .filter(Boolean)
      .join(" "),
  );

  const descriptorText = normalizeText(
    [
      params.selectedDescriptor?.name,
      params.selectedDescriptor?.formContext,
      params.selectedDescriptor?.sourceContext,
      params.plan.selectedLabel,
      contextText,
    ]
      .filter(Boolean)
      .join(" "),
  );

  if (params.plan.family === "magnesium") {
    if (/\bcitrate\b|\boxide\b/i.test(descriptorText)) return "citrate_vs_oxide";
    return "generic_form_comparison";
  }

  if (params.plan.family === "iron") {
    if (params.section.headingId === "form_and_tolerability_context") {
      if (/\bbisglycinate\b/i.test(descriptorText)) return "ferrous_bisglycinate_anchor";
      return "generic_form_comparison";
    }
    if (
      params.section.headingId === "what_product_comparison_depends_on" &&
      /\bvitamin c\b|\bascorbic acid\b|\bfolate\b|\bfolic acid\b|\b5-mthf\b|\bmethylfolate\b|\bb12\b|\bcobalamin\b/i.test(
        contextText,
      )
    ) {
      return "with_cofactor_blend";
    }
    return "generic_form_comparison";
  }

  if (params.plan.family === "vitamin_c") {
    if (params.section.headingId === "iron_absorption_context") {
      if (/\biron\b|\bferrous\b/i.test(contextText)) return "with_iron";
      return undefined;
    }
    if (
      params.section.headingId === "antioxidant_and_immune_research" &&
      /\bliposomal\b|\bbuffered\b|\bsustained release\b|\bsustained-release\b|\bslow release\b|\bslow-release\b|\btime release\b|\btime-release\b|\bextended release\b|\bextended-release\b|\bdelayed release\b|\bdelayed-release\b/i.test(
        descriptorText,
      )
    ) {
      return "alt_delivery";
    }
    return undefined;
  }

  if (params.plan.family === "zinc" && params.section.headingId === "immune_function_context") {
    if (/\bvitamin c\b|\bascorbic acid\b/i.test(contextText)) return "with_vitamin_c";
    if (/\blozenge\b/i.test(contextText)) return "lozenge_short_term_context";
    return undefined;
  }

  if (params.plan.family === "b6" && params.section.headingId === "why_dose_context_matters") {
    if (
      /\bb-complex\b|\bvitamin b12\b|\bb12\b|\bcobalamin\b|\bfolate\b|\bfolic acid\b|\bmethylfolate\b|\briboflavin\b|\bthiamin\b|\bthiamine\b|\bniacin\b|\bvitamin b1\b|\bvitamin b2\b|\bvitamin b3\b/i.test(
        contextText,
      )
    ) {
      return "b_complex_pairing";
    }
    return undefined;
  }

  if (
    params.plan.family === "melatonin" &&
    params.section.headingId === "what_dose_and_use_context_can_change"
  ) {
    if (
      /\bextended release\b|\bextended-release\b|\btime release\b|\btime-release\b|\btimed release\b|\bprolonged release\b|\bcontrolled release\b|\bsustained release\b|\bslow release\b/i.test(
        descriptorText,
      )
    ) {
      return "extended_release";
    }
    return undefined;
  }

  return undefined;
};

const getReviewedEvidenceForSection = (params: {
  plan: ScientificBackgroundPlan;
  planned: ScientificBackgroundSectionPlan;
  context: IngredientScienceContext;
  selectedDescriptor?: IngredientScienceDescriptor | null;
}): ScientificBackgroundEvidenceRow | null => {
  const selectedDescriptor =
    params.selectedDescriptor ??
    getSelectedDescriptor(params.context, params.plan.selectedLabel);
  const variantKey = resolveEvidenceVariantKey({
    plan: params.plan,
    section: params.planned,
    context: params.context,
    selectedDescriptor,
  });
  return getScientificBackgroundEvidence(
    params.plan.family,
    params.planned.headingId,
    "en",
    variantKey,
  );
};

const buildPromptEvidenceGrounding = (params: {
  context: IngredientScienceContext;
  plan: ScientificBackgroundPlan;
  selectedDescriptor: IngredientScienceDescriptor | null;
}):
  | Array<{
      headingId: string;
      heading: string;
      variantKey?: string;
      displayText?: string;
      summarySupport?: string;
      evidenceReadSupport?: string;
      shopperMeaningSupport?: string;
      caveat?: string;
      references: Array<{ id: string; title: string | null }>;
    }>
  | undefined => {
  const rows = params.plan.sections.flatMap((section) => {
    const evidence = getReviewedEvidenceForSection({
      context: params.context,
      plan: params.plan,
      planned: section,
      selectedDescriptor: params.selectedDescriptor,
    });
    if (!evidence) return [];

    return [
      {
        headingId: section.headingId,
        heading: section.heading,
        ...(evidence.variantKey ? { variantKey: evidence.variantKey } : {}),
        ...(evidence.displayText ? { displayText: evidence.displayText } : {}),
        ...(firstEvidenceSentence(evidence.segments.summarySupport)
          ? { summarySupport: firstEvidenceSentence(evidence.segments.summarySupport) ?? undefined }
          : {}),
        ...(firstEvidenceSentence(evidence.segments.evidenceReadSupport)
          ? { evidenceReadSupport: firstEvidenceSentence(evidence.segments.evidenceReadSupport) ?? undefined }
          : {}),
        ...(firstEvidenceSentence(evidence.segments.shopperMeaningSupport)
          ? { shopperMeaningSupport: firstEvidenceSentence(evidence.segments.shopperMeaningSupport) ?? undefined }
          : {}),
        ...(firstEvidenceSentence(evidence.segments.caveats)
          ? { caveat: firstEvidenceSentence(evidence.segments.caveats) ?? undefined }
          : {}),
        references: evidence.supportingReferences.slice(0, 3).map((reference) => ({
          id: reference.id,
          title: reference.title,
        })),
      },
    ];
  });

  return rows.length > 0 ? rows : undefined;
};

const enrichSectionWithReviewedEvidence = (params: {
  plan: ScientificBackgroundPlan;
  planned: ScientificBackgroundSectionPlan;
  context?: IngredientScienceContext;
  section: ScientificBackgroundSection;
}): ScientificBackgroundSection => {
  if (!params.context) return params.section;
  const evidence = getReviewedEvidenceForSection({
    context: params.context,
    plan: params.plan,
    planned: params.planned,
  });
  if (!evidence) return params.section;

  const summaryText = firstEvidenceSentence(evidence.segments.summarySupport) ?? evidence.displayText ?? null;
  const evidenceReadText = firstEvidenceSentence(evidence.segments.evidenceReadSupport);
  const shopperMeaningText = firstEvidenceSentence(evidence.segments.shopperMeaningSupport);
  const caveatText = firstEvidenceSentence(evidence.segments.caveats);

  return {
    ...params.section,
    ...(summaryText ? { summary: summaryText } : {}),
    evidenceRead: appendUniqueSentence(
      evidenceReadText ?? params.section.evidenceRead,
      caveatText,
    ),
    shopperMeaning:
      shopperMeaningText ??
      (caveatText ? appendUniqueSentence(params.section.shopperMeaning ?? "", caveatText) : params.section.shopperMeaning),
  };
};

export const buildScientificBackgroundDeterministicFallback = (params: {
  context: IngredientScienceContext;
  selectedIngredientName: string;
  plan?: ScientificBackgroundPlan;
}): ScientificBackgroundBlock => {
  const plan =
    params.plan ??
    planScientificBackgroundSections({
      context: params.context,
      selectedIngredientName: params.selectedIngredientName,
    });

  return {
    mode: plan.mode,
    selectedLabel: plan.selectedLabel,
    selectedDose: plan.selectedDose,
    introLine: plan.selectedDose ? `${buildReferenceLabel(plan)} • ${plan.selectedDose}` : buildReferenceLabel(plan),
    sections: plan.sections.map((section) =>
      enrichSectionWithReviewedEvidence({
        plan,
        planned: section,
        context: params.context,
        section: buildSectionFallback(plan, section, params.context),
      }),
    ),
    closingNote:
      plan.mode === "research_mode"
        ? "Read the research context as outcome-specific guidance within this formula, not as a blanket promise for every claim on the label."
        : "Read this line as label context first, then compare it with the more specific ingredient rows and the lead active that carry the strongest decision value.",
  };
};

const withTimeout = async <T>(promise: Promise<T>, timeoutMs: number): Promise<T> => {
  let timeoutId: ReturnType<typeof setTimeout> | null = null;
  const timeoutPromise = new Promise<never>((_resolve, reject) => {
    timeoutId = setTimeout(() => reject(new Error("llm_timeout")), timeoutMs);
  });
  try {
    return await Promise.race([promise, timeoutPromise]);
  } finally {
    if (timeoutId) clearTimeout(timeoutId);
  }
};

export const compileScientificBackgroundAsync = async (
  context: IngredientScienceContext,
  selectedIngredientName: string,
  opts?: CompileScientificBackgroundOpts,
): Promise<ScientificBackgroundCompileResult> => {
  const plan = planScientificBackgroundSections({ context, selectedIngredientName });
  const fallback = buildScientificBackgroundDeterministicFallback({
    context,
    selectedIngredientName,
    plan,
  });
  const llmFn = opts?.llmFn;
  const timeoutMs = opts?.timeoutMs ?? LLM_TIMEOUT_MS;
  const maxRetries = opts?.maxRetries ?? LLM_MAX_RETRIES;
  const diagnostics: ScientificBackgroundCompileDiagnostics = {
    liveWriterConfigured: Boolean(llmFn),
    liveWriterAttempted: false,
    liveWriterHit: false,
    attemptCount: 0,
    timeoutMs,
    maxRetries,
    fallbackReason: null,
    lastError: null,
    parseFailureCount: 0,
    gateRejectCount: 0,
    timeoutCount: 0,
    errorCount: 0,
  };

  if (!llmFn) {
    return {
      scientificBackground: fallback,
      source: "fallback",
      fallbackUsed: true,
      promptVersion: SCIENTIFIC_BACKGROUND_PROMPT_VERSION,
      diagnostics: {
        ...diagnostics,
        fallbackReason: "llm_unconfigured",
      },
    };
  }

  const selectedDescriptor = getSelectedDescriptor(context, selectedIngredientName);
  const prompt = buildPrompt({ context, plan, selectedDescriptor });

  for (let attempt = 0; attempt <= maxRetries; attempt += 1) {
    diagnostics.liveWriterAttempted = true;
    diagnostics.attemptCount = attempt + 1;
    try {
      const raw = await withTimeout(llmFn(prompt), timeoutMs);
      const parsed = parseWriterOutput(raw);
      if (!parsed) {
        diagnostics.parseFailureCount += 1;
        diagnostics.fallbackReason = "parse_failed";
        continue;
      }
      const repaired = repairWriterOutput({
        plan,
        parsed,
      });
      if (!repaired) {
        diagnostics.parseFailureCount += 1;
        diagnostics.fallbackReason = "repair_failed";
        continue;
      }
      if (
        !gateScientificBackground({
          requestedIngredientName: plan.selectedLabel,
          repaired,
        })
      ) {
        diagnostics.gateRejectCount += 1;
        diagnostics.fallbackReason = "quality_gate_rejected";
        continue;
      }

      return {
        scientificBackground: repaired,
        source: "api",
        fallbackUsed: false,
        promptVersion: SCIENTIFIC_BACKGROUND_PROMPT_VERSION,
        diagnostics: {
          ...diagnostics,
          liveWriterHit: true,
          fallbackReason: null,
          lastError: null,
        },
      };
    } catch (error) {
      const reason = resolveErrorReason(error);
      diagnostics.lastError = reason;
      diagnostics.fallbackReason = reason;
      if (reason === "llm_timeout") diagnostics.timeoutCount += 1;
      else diagnostics.errorCount += 1;
      continue;
    }
  }

  return {
    scientificBackground: fallback,
    source: "fallback",
    fallbackUsed: true,
    promptVersion: SCIENTIFIC_BACKGROUND_PROMPT_VERSION,
    diagnostics: {
      ...diagnostics,
      fallbackReason:
        diagnostics.fallbackReason ??
        (diagnostics.parseFailureCount > 0
          ? "parse_failed"
          : diagnostics.gateRejectCount > 0
            ? "quality_gate_rejected"
            : "exhausted_without_valid_output"),
    },
  };
};
