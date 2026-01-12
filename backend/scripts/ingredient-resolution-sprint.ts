import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

import { supabase } from "../src/supabase.js";
import { extractErrorMeta, withRetry } from "../src/supabaseRetry.js";

type ScoreSource = "dsld" | "lnhpd";

type MissingIngredientRow = {
  source_id: string;
  name_key: string | null;
  name_raw: string;
  is_active: boolean;
};

type IngredientRow = {
  id: string;
  name: string;
  scientific_name: string | null;
};

type SynonymRow = {
  ingredient_id: string;
  synonym: string;
  alias_type?: string | null;
  confidence?: number | null;
  source?: string | null;
};

type CandidateMatch = {
  ingredient_id: string;
  ingredient_name: string;
  confidence: number;
  reasons: string[];
};

type MissingCanonicalTarget = {
  normalized: string;
  ingredientName: string;
  reason: string;
};

type CandidateResult = {
  candidates: CandidateMatch[];
  missingCanonicalTargets: MissingCanonicalTarget[];
  requiresTokenMisses: RequiredTokenMiss[];
};

type IngredientSynonymRow = {
  ingredient_id: string;
  synonym: string;
  alias_type?: string | null;
  confidence?: number | null;
  source?: string | null;
};

type ReviewQueueRow = {
  entity_type: string;
  source: ScoreSource;
  name_key: string;
  name_raw: string;
  payload_json: Record<string, unknown>;
  status?: string;
};

type TopEntry = {
  source: ScoreSource;
  name_key: string;
  normalized_key: string;
  count: number;
  samples: string[];
  normalized_samples: string[];
  original_name_keys: string[];
  latin_binomial: boolean;
};

type NormalizedName = {
  original: string;
  stripped: string;
  normalized: string;
  hasLatinBinomial: boolean;
  variants: NormalizedVariant[];
};

type RequiredTokenMiss = {
  key: string;
  target: string;
  requiredTokens: string[];
  variantLabel: NormalizedVariant["label"];
};

type NormalizedVariant = {
  label: "base" | "paren" | "merged";
  raw: string;
  normalized: string;
  hasLatinBinomial: boolean;
};

type FuzzyEntry = {
  ingredient_id: string;
  ingredient_name: string;
  normalized: string;
  kind: "ingredient" | "scientific" | "synonym";
  synonym?: string | null;
  base_confidence?: number | null;
};

const args = process.argv.slice(2);
const getArg = (flag: string): string | null => {
  const prefix = `--${flag}=`;
  const arg = args.find((value) => value.startsWith(prefix));
  if (arg) return arg.slice(prefix.length);
  const index = args.indexOf(`--${flag}`);
  if (index !== -1) {
    const next = args[index + 1];
    if (next && !next.startsWith("--")) return next;
  }
  return null;
};

const hasFlag = (flag: string): boolean =>
  args.some((value) => value === `--${flag}` || value.startsWith(`--${flag}=`));

const normalizeText = (value: string): string =>
  value.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();

const formatErrorMessage = (error: unknown): string => {
  if (error && typeof error === "object" && "message" in error) {
    const message = (error as { message?: unknown }).message;
    if (typeof message === "string" && message.trim()) return message;
  }
  return error ? String(error) : "unknown error";
};

const stripParenthetical = (value: string): string =>
  value.replace(/\([^)]*\)/g, " ").replace(/\[[^\]]*]/g, " ").replace(/\{[^}]*}/g, " ");

const LATIN_BINOMIAL_REGEX = /\b[A-Z][a-z]+ [a-z]{2,}\b/;
const LATIN_SUFFIX_REGEX = /(aceae|ales|ensis|ina|ana|orum|arum|ii|ae|us|um|is|a)$/i;

const looksLatinToken = (token: string): boolean =>
  LATIN_SUFFIX_REGEX.test(token) && token.length >= 3;

const detectLatinBinomial = (value: string): boolean => {
  if (!value) return false;
  if (LATIN_BINOMIAL_REGEX.test(value)) return true;
  const normalized = normalizeText(stripParenthetical(value));
  const tokens = normalized.split(/\s+/).filter(Boolean);
  const filteredTokens = tokens.filter((token) => token !== "x" && token !== "×");
  if (filteredTokens.length === 2 && filteredTokens.every((token) => looksLatinToken(token))) {
    return true;
  }
  for (let i = 0; i < filteredTokens.length - 1; i += 1) {
    if (looksLatinToken(filteredTokens[i]) && looksLatinToken(filteredTokens[i + 1])) {
      return true;
    }
  }
  return false;
};

const extractParentheticalSegments = (value: string): string[] => {
  const segments: string[] = [];
  const patterns = [/\(([^)]*)\)/g, /\[([^\]]*)\]/g, /\{([^}]*)\}/g];
  patterns.forEach((regex) => {
    let match: RegExpExecArray | null;
    while ((match = regex.exec(value)) !== null) {
      if (match[1]) segments.push(match[1]);
    }
  });
  return segments;
};

const cleanParenSegment = (value: string): string => {
  const trimmed = value.trim();
  return trimmed.replace(/^(as|from|with|and)\s+/i, "").trim();
};

const buildVariants = (value: string): NormalizedVariant[] => {
  const original = value.trim();
  const baseRaw = stripParenthetical(original).replace(/[.,;:/]+/g, " ").trim();
  const parenSegments = extractParentheticalSegments(original).map(cleanParenSegment).filter(Boolean);
  const parenRaw = parenSegments.join(" ").trim();
  const mergedRaw = [baseRaw, parenRaw].filter(Boolean).join(" ").trim();

  const variants: NormalizedVariant[] = [];
  const seen = new Set<string>();

  const pushVariant = (label: NormalizedVariant["label"], raw: string) => {
    const normalized = normalizeText(raw);
    if (!normalized || seen.has(normalized)) return;
    seen.add(normalized);
    variants.push({
      label,
      raw,
      normalized,
      hasLatinBinomial: detectLatinBinomial(raw),
    });
  };

  pushVariant("base", baseRaw);
  if (parenRaw) pushVariant("paren", parenRaw);
  if (mergedRaw) pushVariant("merged", mergedRaw);

  return variants;
};

const normalizeName = (value: string): NormalizedName => {
  const original = value.trim();
  const stripped = stripParenthetical(original).replace(/[.,;:/]+/g, " ").trim();
  const variants = buildVariants(original);
  const baseVariant = variants.find((variant) => variant.label === "base") ?? variants[0];
  const normalized = baseVariant?.normalized ?? normalizeText(stripped);
  const hasLatinBinomial =
    detectLatinBinomial(original) || variants.some((variant) => variant.hasLatinBinomial);
  return {
    original,
    stripped,
    normalized,
    hasLatinBinomial,
    variants,
  };
};

const normalizeTokens = (value: string): string[] =>
  normalizeText(value).split(/\s+/).filter(Boolean);

const hasRequiredTokens = (tokens: Set<string>, requiredTokens: string[]): boolean => {
  if (!requiredTokens.length) return true;
  return requiredTokens.some((token) => tokens.has(normalizeText(token)));
};

const AUTO_APPLY_MIN_CONFIDENCE = 0.92;
const AUTO_APPLY_MARGIN = 0.08;
const TOP_CANDIDATES = 5;
const FUZZY_MIN_SCORE = 0.8;
const FUZZY_PREFILTER_LIMIT = 20;
const MAX_SAMPLE_COUNT = 3;

type PatternRule = {
  reason: string;
  pattern: RegExp;
};

const POTENCY_TOKEN_REGEX = /^\d+(?:\.\d+)?[xXcCdD]$/;
const NUMERIC_TOKEN_REGEX = /^\d+(?:\.\d+)?$/;

const CHEMICAL_FRAGMENT_TOKENS = new Set(
  [
    "alpha",
    "beta",
    "amino",
    "deoxy",
    "dl",
    "extract",
    "isolate",
    "concentrate",
    "methyl",
    "protein",
    "oil",
    "poly",
    "carboxy",
    "sulfonyl",
    "acid",
    "chloride",
    "sulfate",
    "hydrogen",
    "peroxide",
    "salicylate",
    "acetate",
    "tartrate",
    "nicotinate",
    "tocopheryl",
    "salt",
    "menthyl",
  ].map(normalizeText),
);

const NON_SCORING_PATTERNS: PatternRule[] = [
  {
    reason: "non_scoring_solvent",
    pattern: /\b(ethyl alcohol|ethanol|aqua|water|purified water|glycerin|glycerine)\b/,
  },
  {
    reason: "non_scoring_animal_source",
    pattern: /\b(rabbit|porcine|sus scrofa|oryctolagus cuniculus)\b/,
  },
  {
    reason: "non_scoring_dosage_form",
    pattern: /\b(capsule|capsules|tablet|tablets|softgel|softgels)\b/,
  },
];

const SPECIAL_HANDLING_PATTERNS: PatternRule[] = [
  {
    reason: "special_handling_homeopathy",
    pattern:
      /\b(homeopathic|homeopathy|natrum muriaticum|kali muriaticum|apis mellifica|mercurius corrosivus|bryonia|belladonna|drosera|cantharis|pulsatilla|orchitinum|sarsaparilla|absinthium|aethusa|ruta|causticum|aesculus|caryophyllus|histaminum|pneumococcinum|bromum|colocynthis|graphites|arnica|ipecacuanha|cinnabaris|lupulinum|syphilinum|camphora)\b/,
  },
  {
    reason: "special_handling_homeopathy",
    pattern: /\b\d+(?:\.\d+)?[xXcCdD]\b/,
  },
  {
    reason: "special_handling_enzyme",
    pattern: /\b(lipase|amylase|protease|lactase|cellulase|galactosidase|bromelain|papain|enzyme|enzymes)\b/,
  },
];

const SPECIAL_QUEUE_ENTITY_TYPE = "ingredient_special_handling";

const NON_SCORING_PREFIXES = [
  "calorie",
  "calories",
  "total fat",
  "saturated fat",
  "trans fat",
  "cholesterol",
  "total carbohydrate",
  "total carbohydrates",
  "dietary fiber",
  "total sugars",
  "added sugars",
  "sugars",
  "protein",
].map(normalizeText);

const isNonScoringNutrient = (nameKey: string): boolean =>
  NON_SCORING_PREFIXES.some((prefix) => nameKey === prefix || nameKey.startsWith(`${prefix} `));

const matchPattern = (values: string[], patterns: PatternRule[]): PatternRule | null => {
  for (const value of values) {
    if (!value) continue;
    for (const rule of patterns) {
      if (rule.pattern.test(value)) return rule;
    }
  }
  return null;
};

const isNoiseToken = (token: string): boolean =>
  token.length <= 1 || NUMERIC_TOKEN_REGEX.test(token) || POTENCY_TOKEN_REGEX.test(token);

const classifyNoCandidate = (tokens: string[]): string => {
  if (!tokens.length) return "short_or_empty_after_normalize";
  if (tokens.every((token) => isNoiseToken(token))) return "noise_token_only";

  const noiseOrFragmentCount = tokens.filter(
    (token) => isNoiseToken(token) || CHEMICAL_FRAGMENT_TOKENS.has(token),
  ).length;
  if (tokens.every((token) => isNoiseToken(token) || CHEMICAL_FRAGMENT_TOKENS.has(token))) {
    return "chemical_fragment";
  }
  if (tokens.length >= 2 && noiseOrFragmentCount / tokens.length >= 0.6) {
    return "chemical_fragment";
  }
  if (
    tokens.length === 2 &&
    ((isNoiseToken(tokens[0]) && tokens[1].length > 10) ||
      (isNoiseToken(tokens[1]) && tokens[0].length > 10))
  ) {
    return "chemical_fragment";
  }
  return "true_no_candidates";
};

const FORM_ONLY_TOKENS = new Set(
  [
    "hydrochloride",
    "hcl",
    "micronized",
    "phosphate",
    "citrate",
    "malate",
    "glycinate",
    "bisglycinate",
    "picolinate",
    "gluconate",
    "sulfate",
    "chloride",
    "carbonate",
    "nitrate",
    "phytosome",
    "liposomal",
    "micellar",
    "triglyceride",
  ].map(normalizeText),
);

type CuratedTarget = {
  ingredientName: string;
  confidence: number;
  reason: string;
  requiresTokens?: string[];
};

const CURATED_NAME_MAP: Record<string, CuratedTarget[]> = {
  carnosyn: [{ ingredientName: "beta alanine", confidence: 0.86, reason: "brand_override" }],
  "fish oil": [{ ingredientName: "Omega-3", confidence: 0.85, reason: "curated_common" }],
  "omega 3": [{ ingredientName: "Omega-3", confidence: 0.9, reason: "curated_common" }],
  inositol: [{ ingredientName: "Inositol", confidence: 0.9, reason: "curated_common" }],
  "myo inositol": [{ ingredientName: "Inositol", confidence: 0.9, reason: "curated_common" }],
  vanadium: [{ ingredientName: "Vanadium", confidence: 0.88, reason: "curated_common" }],
  silicon: [{ ingredientName: "Silicon", confidence: 0.88, reason: "curated_common" }],
  phosphorus: [{ ingredientName: "Phosphorus", confidence: 0.88, reason: "curated_common" }],
  nickel: [{ ingredientName: "Nickel", confidence: 0.88, reason: "curated_common" }],
  lecithin: [{ ingredientName: "Lecithin", confidence: 0.88, reason: "curated_common" }],
  menthol: [{ ingredientName: "Menthol", confidence: 0.88, reason: "curated_common" }],
  "mentha piperita": [{ ingredientName: "Peppermint", confidence: 0.9, reason: "curated_common" }],
  piperine: [{ ingredientName: "Piperine", confidence: 0.9, reason: "curated_common" }],
  camphor: [{ ingredientName: "Camphor", confidence: 0.88, reason: "curated_common" }],
  collagen: [
    { ingredientName: "Collagen peptides", confidence: 0.9, reason: "curated_common" },
  ],
  "hydrolyzed collagen": [
    { ingredientName: "Collagen peptides", confidence: 0.93, reason: "curated_common" },
  ],
  "hydrolysed collagen": [
    { ingredientName: "Collagen peptides", confidence: 0.93, reason: "curated_common" },
  ],
  "collagen hydrolysate": [
    { ingredientName: "Collagen peptides", confidence: 0.93, reason: "curated_common" },
  ],
  "hydrolysate collagen": [
    { ingredientName: "Collagen peptides", confidence: 0.93, reason: "curated_common" },
  ],
  phosphatidylcholine: [
    { ingredientName: "Choline", confidence: 0.88, reason: "curated_common" },
  ],
  "coenzyme q10": [
    { ingredientName: "Coenzyme Q10", confidence: 0.93, reason: "curated_common" },
  ],
  coq10: [{ ingredientName: "Coenzyme Q10", confidence: 0.93, reason: "curated_common" }],
  "co q10": [{ ingredientName: "Coenzyme Q10", confidence: 0.93, reason: "curated_common" }],
  "co q 10": [{ ingredientName: "Coenzyme Q10", confidence: 0.93, reason: "curated_common" }],
  "coq 10": [{ ingredientName: "Coenzyme Q10", confidence: 0.93, reason: "curated_common" }],
  ubiquinone: [{ ingredientName: "Coenzyme Q10", confidence: 0.9, reason: "curated_common" }],
  ubidecarenone: [{ ingredientName: "Coenzyme Q10", confidence: 0.9, reason: "curated_common" }],
  "salicylic acid": [
    { ingredientName: "Salicylic Acid", confidence: 0.9, reason: "curated_common" },
  ],
  "citrus bioflavonoids": [
    { ingredientName: "Citrus Bioflavonoids", confidence: 0.88, reason: "curated_common" },
  ],
  bioflavonoids: [
    { ingredientName: "Citrus Bioflavonoids", confidence: 0.88, reason: "curated_common" },
  ],
  phosphore: [{ ingredientName: "Phosphorus", confidence: 0.88, reason: "curated_common" }],
  silicea: [{ ingredientName: "Silica", confidence: 0.88, reason: "curated_common" }],
};

const LATIN_COMMON_MAP: Record<string, string[]> = {
  "vaccinium myrtillus": ["Bilberry"],
  "vaccinium macrocarpon": ["Cranberry extract"],
  "withania somnifera": ["ashwagandha"],
  "silybum marianum": ["milk thistle"],
  "vitis vinifera": ["Grape Seed Extract"],
  "lentinula edodes": ["Shiitake"],
  "linum usitatissimum": ["flaxseed"],
  "curcuma longa": ["Curcumin"],
  "piper nigrum": ["black pepper"],
  "panax ginseng": ["Panax ginseng"],
  "panax quinquefolius": ["American Ginseng"],
  "matricaria chamomilla": ["Chamomile"],
  "passiflora incarnata": ["Passionflower"],
  "camellia sinensis": ["Green Tea Extract"],
  "zingiber officinale": ["Ginger Root"],
  "ginkgo biloba": ["Ginkgo biloba"],
  "glycyrrhiza glabra": ["DGL Licorice"],
  "glycyrrhiza uralensis": ["DGL Licorice"],
  "allium sativum": ["Garlic Extract"],
  "valeriana officinalis": ["Valerian"],
  "sambucus nigra": ["Elderberry"],
  "echinacea purpurea": ["Echinacea"],
  "hypericum perforatum": ["St. John's Wort"],
  "boswellia serrata": ["Boswellia"],
  "bacopa monnieri": ["Bacopa monnieri"],
  "centella asiatica": ["gotu kola"],
  "rhodiola rosea": ["Rhodiola rosea"],
  "tribulus terrestris": ["Tribulus Terrestris"],
  "harpagophytum procumbens": ["Devil's Claw"],
  "eleutherococcus senticosus": ["Eleuthero"],
  "arnica montana": ["Arnica"],
  "hydrastis canadensis": ["Goldenseal"],
  "eucalyptus globulus": ["Eucalyptus"],
  "medicago sativa": ["Alfalfa"],
  "dioscorea oppositifolia": ["Wild Yam"],
  "calendula officinalis": ["Calendula"],
  "sus scrofa": ["Porcine"],
  "oryctolagus cuniculus": ["Rabbit"],
  "foeniculum vulgare": ["fennel"],
  "ocimum sanctum": ["Holy Basil"],
  "nigella sativa": ["Black seed oil"],
  "taraxacum officinale": ["Dandelion Root"],
  "urtica dioica": ["Stinging Nettle Root"],
  "prunus africana": ["Pygeum"],
  "trigonella foenum graecum": ["Fenugreek"],
  "pimpinella anisum": ["anise"],
  "citrus sinensis": ["Orange"],
  "citrus paradisi": ["Grapefruit Seed Extract"],
  "citrus aurantium": ["bitter orange"],
  "angelica sinensis": ["Dong Quai"],
  "ganoderma lucidum": ["Reishi Mushroom"],
  "cordyceps sinensis": ["Cordyceps Mushroom"],
  "schisandra chinensis": ["Schisandra Chinensis"],
  "coffea arabica": ["Green Coffee Bean Extract"],
  "ephedra sinica": ["ma huang"],
};

const LATIN_REQUIRED_TOKENS: Record<string, string[]> = {
  "glycyrrhiza glabra": ["dgl", "deglycyrrhizinated", "deglycyrrhizinized"],
  "glycyrrhiza uralensis": ["dgl", "deglycyrrhizinated", "deglycyrrhizinized"],
  "taraxacum officinale": ["root", "radix"],
  "urtica dioica": ["root"],
  "vitis vinifera": ["seed", "seeds"],
};

const MINERAL_TOKENS = new Set(
  [
    "calcium",
    "magnesium",
    "zinc",
    "iron",
    "selenium",
    "copper",
    "iodine",
    "chromium",
    "manganese",
    "potassium",
    "sodium",
    "phosphorus",
  ].map(normalizeText),
);

const estimateCategoryAndUnit = (
  name: string,
): { category: string | null; baseUnit: string | null } => {
  const normalized = normalizeText(name);
  if (!normalized) return { category: null, baseUnit: null };

  if (
    normalized.includes("probiotic") ||
    normalized.includes("lactobacillus") ||
    normalized.includes("bifidobacterium")
  ) {
    return { category: "probiotic", baseUnit: "cfu" };
  }

  if (normalized.includes("vitamin")) {
    const usesIU =
      normalized.includes("vitamin d") ||
      normalized.includes("vitamin a") ||
      normalized.includes("vitamin e");
    return { category: "vitamin", baseUnit: usesIU ? "iu" : "mg" };
  }

  if (MINERAL_TOKENS.has(normalized)) {
    return { category: "mineral", baseUnit: "mg" };
  }

  if (normalized.includes("omega") || normalized.includes("oil")) {
    return { category: "lipid", baseUnit: "mg" };
  }

  if (
    detectLatinBinomial(name) ||
    normalized.includes("extract") ||
    normalized.includes("root") ||
    normalized.includes("leaf") ||
    normalized.includes("seed") ||
    normalized.includes("flower") ||
    normalized.includes("berry") ||
    normalized.includes("herb") ||
    normalized.includes("mushroom")
  ) {
    return { category: "botanical", baseUnit: "mg" };
  }

  if (normalized.includes("enzyme")) {
    return { category: "enzyme", baseUnit: "mg" };
  }

  if (
    normalized.includes("protein") ||
    normalized.includes("collagen") ||
    normalized.includes("peptide")
  ) {
    return { category: "protein", baseUnit: "mg" };
  }

  if (normalized.includes("acid")) {
    return { category: "compound", baseUnit: "mg" };
  }

  return { category: null, baseUnit: "mg" };
};

const OUTPUT_DIR =
  getArg("output-dir") ??
  path.join(process.cwd(), "output", "ingredient-resolution");
const SOURCE_ARG = (getArg("source") ?? "all").toLowerCase();
const LIMIT = Math.max(1, Number(getArg("limit") ?? "200"));
const BATCH_SIZE = Math.max(100, Number(getArg("batch") ?? "5000"));
const CANONICAL_MISSING_LIMIT = Math.max(
  1,
  Number(getArg("canonical-missing-limit") ?? "50"),
);
const CANONICAL_MISSING_OUTPUT = getArg("canonical-missing-output");
const APPLY = hasFlag("apply");
const WRITE_REBACKFILL = hasFlag("write-rebackfill");
const PREVIEW_OUTPUT = getArg("preview-output");
const PREVIEW_LIMIT = Math.max(
  1,
  Math.min(100, Number(getArg("preview-limit") ?? "100")),
);

const SOURCES: ScoreSource[] =
  SOURCE_ARG === "all"
    ? ["dsld", "lnhpd"]
    : SOURCE_ARG === "dsld"
      ? ["dsld"]
      : SOURCE_ARG === "lnhpd"
        ? ["lnhpd"]
        : [];

if (!SOURCES.length) {
  console.error(`[resolution] invalid source: ${SOURCE_ARG}`);
  process.exit(1);
}

const ensureOutputDir = async () => {
  await mkdir(OUTPUT_DIR, { recursive: true });
};

const toQuantiles = (values: number[]) => {
  if (!values.length) {
    return { p50: null, p90: null, p95: null };
  }
  const sorted = [...values].sort((a, b) => a - b);
  const pick = (q: number) => {
    const index = Math.min(sorted.length - 1, Math.max(0, Math.floor((sorted.length - 1) * q)));
    return sorted[index];
  };
  return {
    p50: pick(0.5),
    p90: pick(0.9),
    p95: pick(0.95),
  };
};

type DatasetIndex = {
  ingredients: IngredientRow[];
  ingredientById: Map<string, IngredientRow>;
  ingredientNameByNorm: Map<string, IngredientRow[]>;
  ingredientScientificByNorm: Map<string, IngredientRow[]>;
  synonyms: SynonymRow[];
  synonymsByNorm: Map<string, SynonymRow[]>;
  fuzzyEntries: FuzzyEntry[];
  trigramIndex: Map<string, Set<number>>;
};

let datasetIndex: DatasetIndex | null = null;

const buildTrigramSet = (value: string): Set<string> => {
  const normalized = ` ${value.trim().replace(/\s+/g, " ")} `;
  const trigrams = new Set<string>();
  if (normalized.length < 3) return trigrams;
  for (let i = 0; i <= normalized.length - 3; i += 1) {
    trigrams.add(normalized.slice(i, i + 3));
  }
  return trigrams;
};

const trigramSimilarity = (a: string, b: string): number => {
  if (!a || !b) return 0;
  if (a === b) return 1;
  const setA = buildTrigramSet(a);
  const setB = buildTrigramSet(b);
  if (!setA.size || !setB.size) return 0;
  let intersection = 0;
  setA.forEach((gram) => {
    if (setB.has(gram)) intersection += 1;
  });
  return (2 * intersection) / (setA.size + setB.size);
};

const loadDatasetIndex = async (): Promise<DatasetIndex> => {
  if (datasetIndex) return datasetIndex;
  const [ingredientResult, synonymResult] = await Promise.all([
    withRetry(() =>
      supabase.from("ingredients").select("id,name,scientific_name"),
    ),
    withRetry(() =>
      supabase.from("ingredient_synonyms").select("ingredient_id,synonym,alias_type,confidence,source"),
    ),
  ]);
  if (ingredientResult.error) {
    const meta = extractErrorMeta(ingredientResult.error);
    throw new Error(
      `[resolution] ingredients load failed: ${meta.message ?? formatErrorMessage(ingredientResult.error)}`,
    );
  }
  if (synonymResult.error) {
    const meta = extractErrorMeta(synonymResult.error);
    throw new Error(
      `[resolution] ingredient_synonyms load failed: ${meta.message ?? formatErrorMessage(synonymResult.error)}`,
    );
  }

  const ingredients = (ingredientResult.data ?? []) as IngredientRow[];
  const ingredientById = new Map<string, IngredientRow>();
  const ingredientNameByNorm = new Map<string, IngredientRow[]>();
  const ingredientScientificByNorm = new Map<string, IngredientRow[]>();
  const fuzzyEntries: FuzzyEntry[] = [];
  const trigramIndex = new Map<string, Set<number>>();
  const seenFuzzy = new Set<string>();

  const registerFuzzyEntry = (entry: FuzzyEntry) => {
    if (!entry.normalized) return;
    const key = `${entry.kind}:${entry.ingredient_id}:${entry.normalized}`;
    if (seenFuzzy.has(key)) return;
    seenFuzzy.add(key);
    const index = fuzzyEntries.length;
    fuzzyEntries.push(entry);
    const trigrams = buildTrigramSet(entry.normalized);
    trigrams.forEach((gram) => {
      const bucket = trigramIndex.get(gram) ?? new Set<number>();
      bucket.add(index);
      trigramIndex.set(gram, bucket);
    });
  };

  ingredients.forEach((row) => {
    if (!row?.id) return;
    ingredientById.set(row.id, row);
    const nameNorm = normalizeText(row.name ?? "");
    if (nameNorm) {
      const bucket = ingredientNameByNorm.get(nameNorm) ?? [];
      bucket.push(row);
      ingredientNameByNorm.set(nameNorm, bucket);
      registerFuzzyEntry({
        ingredient_id: row.id,
        ingredient_name: row.name,
        normalized: nameNorm,
        kind: "ingredient",
      });
    }
    const scientificNorm = normalizeText(row.scientific_name ?? "");
    if (scientificNorm) {
      const bucket = ingredientScientificByNorm.get(scientificNorm) ?? [];
      bucket.push(row);
      ingredientScientificByNorm.set(scientificNorm, bucket);
      registerFuzzyEntry({
        ingredient_id: row.id,
        ingredient_name: row.name,
        normalized: scientificNorm,
        kind: "scientific",
      });
    }
  });

  const synonyms = (synonymResult.data ?? []) as SynonymRow[];
  const synonymsByNorm = new Map<string, SynonymRow[]>();
  synonyms.forEach((row) => {
    if (!row?.ingredient_id || !row?.synonym) return;
    const norm = normalizeText(row.synonym);
    if (!norm) return;
    const bucket = synonymsByNorm.get(norm) ?? [];
    bucket.push(row);
    synonymsByNorm.set(norm, bucket);
    const ingredient = ingredientById.get(row.ingredient_id);
    if (ingredient) {
      registerFuzzyEntry({
        ingredient_id: row.ingredient_id,
        ingredient_name: ingredient.name,
        normalized: norm,
        kind: "synonym",
        synonym: row.synonym,
        base_confidence: row.confidence ?? null,
      });
    }
  });

  datasetIndex = {
    ingredients,
    ingredientById,
    ingredientNameByNorm,
    ingredientScientificByNorm,
    synonyms,
    synonymsByNorm,
    fuzzyEntries,
    trigramIndex,
  };
  return datasetIndex;
};

const resolveIngredientIdsByName = (
  dataset: DatasetIndex,
  name: string,
): IngredientRow[] => {
  const normalized = normalizeText(name);
  if (!normalized) return [];
  const direct = dataset.ingredientNameByNorm.get(normalized) ?? [];
  if (direct.length) return direct;
  const synonymMatches = dataset.synonymsByNorm.get(normalized) ?? [];
  if (!synonymMatches.length) return [];
  const resolved: IngredientRow[] = [];
  synonymMatches.forEach((row) => {
    const ingredient = dataset.ingredientById.get(row.ingredient_id);
    if (ingredient) resolved.push(ingredient);
  });
  return resolved;
};

const prefilterFuzzyEntries = (
  normalized: string,
  dataset: DatasetIndex,
): FuzzyEntry[] => {
  if (!normalized) return [];
  const trigrams = buildTrigramSet(normalized);
  if (!trigrams.size) return [];
  const counts = new Map<number, number>();
  trigrams.forEach((gram) => {
    const entries = dataset.trigramIndex.get(gram);
    if (!entries) return;
    entries.forEach((index) => {
      counts.set(index, (counts.get(index) ?? 0) + 1);
    });
  });
  if (!counts.size) return [];
  return Array.from(counts.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, FUZZY_PREFILTER_LIMIT)
    .map(([index]) => dataset.fuzzyEntries[index])
    .filter(Boolean);
};

const addCandidate = (
  map: Map<string, { candidate: CandidateMatch; reasonSet: Set<string> }>,
  ingredient: IngredientRow,
  confidence: number,
  reason: string,
) => {
  if (!ingredient?.id) return;
  const normalizedConfidence = Math.max(0, Math.min(1, confidence));
  const existing = map.get(ingredient.id);
  if (!existing) {
    map.set(ingredient.id, {
      candidate: {
        ingredient_id: ingredient.id,
        ingredient_name: ingredient.name,
        confidence: normalizedConfidence,
        reasons: [reason],
      },
      reasonSet: new Set([reason]),
    });
    return;
  }
  existing.reasonSet.add(reason);
  if (normalizedConfidence > existing.candidate.confidence) {
    existing.candidate.confidence = normalizedConfidence;
  }
  existing.candidate.reasons = Array.from(existing.reasonSet);
};

const generateCandidates = (
  normalized: NormalizedName,
  dataset: DatasetIndex,
): CandidateResult => {
  if (!normalized.normalized && !normalized.variants.length) {
    return { candidates: [], missingCanonicalTargets: [], requiresTokenMisses: [] };
  }
  const candidates = new Map<string, { candidate: CandidateMatch; reasonSet: Set<string> }>();
  const missingTargets = new Map<string, MissingCanonicalTarget>();
  const requiresTokenMisses: RequiredTokenMiss[] = [];
  let hasRequiredTokenMiss = false;
  const registerMissingTarget = (ingredientName: string, reason: string) => {
    const normalizedKey = normalizeText(ingredientName);
    if (!normalizedKey) return;
    const key = `${normalizedKey}:${reason}`;
    if (missingTargets.has(key)) return;
    missingTargets.set(key, {
      normalized: normalizedKey,
      ingredientName,
      reason,
    });
  };
  const variants =
    normalized.variants.length > 0
      ? normalized.variants
      : [
          {
            label: "base" as const,
            raw: normalized.normalized,
            normalized: normalized.normalized,
            hasLatinBinomial: normalized.hasLatinBinomial,
          },
        ];

  variants.forEach((variant) => {
    if (!variant.normalized) return;
    const variantTokens = new Set(normalizeTokens(variant.raw));
    const addCuratedTarget = (
      targetName: string,
      reason: string,
      confidenceBase: number,
    ) => {
      const matches = resolveIngredientIdsByName(dataset, targetName);
      if (matches.length) {
        matches.forEach((ingredient) => {
          addCandidate(
            candidates,
            ingredient,
            confidenceBase,
            `${reason}:${variant.label}`,
          );
        });
        return;
      }
      const normalizedTarget = normalizeText(targetName);
      let added = false;
      if (normalizedTarget) {
        const fuzzyEntries = prefilterFuzzyEntries(normalizedTarget, dataset);
        fuzzyEntries.forEach((entry) => {
          const similarity = trigramSimilarity(normalizedTarget, entry.normalized);
          if (similarity < FUZZY_MIN_SCORE) return;
          const ingredient = dataset.ingredientById.get(entry.ingredient_id);
          if (!ingredient) return;
          const weight = entry.kind === "synonym" ? 0.9 : 0.94;
          addCandidate(
            candidates,
            ingredient,
            similarity * confidenceBase * weight,
            `${reason}_fuzzy:${variant.label}`,
          );
          added = true;
        });
      }
      if (!added) {
        registerMissingTarget(targetName, reason);
      }
    };

    const curatedTargets = CURATED_NAME_MAP[variant.normalized] ?? [];
    curatedTargets.forEach((target) => {
      if (target.requiresTokens?.length) {
        if (!hasRequiredTokens(variantTokens, target.requiresTokens)) {
          requiresTokenMisses.push({
            key: variant.normalized,
            target: target.ingredientName,
            requiredTokens: target.requiresTokens,
            variantLabel: variant.label,
          });
          hasRequiredTokenMiss = true;
          return;
        }
      }
      addCuratedTarget(target.ingredientName, target.reason, target.confidence);
    });

    const latinTargets = LATIN_COMMON_MAP[variant.normalized] ?? [];
    if (latinTargets.length) {
      const requiredTokens = LATIN_REQUIRED_TOKENS[variant.normalized];
      if (requiredTokens?.length) {
        if (!hasRequiredTokens(variantTokens, requiredTokens)) {
          latinTargets.forEach((targetName) => {
            requiresTokenMisses.push({
              key: variant.normalized,
              target: targetName,
              requiredTokens,
              variantLabel: variant.label,
            });
          });
          hasRequiredTokenMiss = true;
        } else {
          latinTargets.forEach((targetName) => {
            addCuratedTarget(targetName, "curated_latin_map", 0.98);
          });
        }
      } else {
        latinTargets.forEach((targetName) => {
          addCuratedTarget(targetName, "curated_latin_map", 0.98);
        });
      }
    }

    const nameMatches = dataset.ingredientNameByNorm.get(variant.normalized) ?? [];
    nameMatches.forEach((ingredient) => {
      addCandidate(candidates, ingredient, 0.96, `ingredient_exact:${variant.label}`);
    });

    const scientificMatches =
      dataset.ingredientScientificByNorm.get(variant.normalized) ?? [];
    scientificMatches.forEach((ingredient) => {
      addCandidate(candidates, ingredient, 0.95, `scientific_exact:${variant.label}`);
    });

    const synonymMatches = dataset.synonymsByNorm.get(variant.normalized) ?? [];
    synonymMatches.forEach((row) => {
      const ingredient = dataset.ingredientById.get(row.ingredient_id);
      if (!ingredient) return;
      const confidence = row.confidence != null ? row.confidence : 0.94;
      addCandidate(candidates, ingredient, confidence, `synonym_exact:${variant.label}`);
    });

    const fuzzyEntries = prefilterFuzzyEntries(variant.normalized, dataset);
    fuzzyEntries.forEach((entry) => {
      const similarity = trigramSimilarity(variant.normalized, entry.normalized);
      if (similarity < FUZZY_MIN_SCORE) return;
      const hasLatin = variant.hasLatinBinomial;
      if (entry.kind === "ingredient") {
        const weight = hasLatin ? 0.94 : 0.9;
        const ingredient = dataset.ingredientById.get(entry.ingredient_id);
        if (!ingredient) return;
        addCandidate(
          candidates,
          ingredient,
          similarity * weight,
          `ingredient_fuzzy:${variant.label}`,
        );
        return;
      }
      if (entry.kind === "scientific") {
        const weight = hasLatin ? 0.96 : 0.92;
        const ingredient = dataset.ingredientById.get(entry.ingredient_id);
        if (!ingredient) return;
        addCandidate(
          candidates,
          ingredient,
          similarity * weight,
          `scientific_fuzzy:${variant.label}`,
        );
        return;
      }
      if (entry.kind === "synonym") {
        const ingredient = dataset.ingredientById.get(entry.ingredient_id);
        if (!ingredient) return;
        const base = entry.base_confidence ?? 0.85;
        const weight = (0.85 + 0.15 * base) * 0.95;
        addCandidate(
          candidates,
          ingredient,
          similarity * weight,
          `synonym_fuzzy:${variant.label}`,
        );
      }
    });
  });

  const ordered = Array.from(candidates.values())
    .map((entry) => entry.candidate)
    .sort((a, b) => b.confidence - a.confidence)
    .slice(0, TOP_CANDIDATES);

  if (
    !ordered.length &&
    !missingTargets.size &&
    normalized.hasLatinBinomial &&
    !hasRequiredTokenMiss
  ) {
    const fallbackName = normalized.original || normalized.normalized;
    if (fallbackName) {
      registerMissingTarget(fallbackName, "latin_binomial_unmapped");
    }
  }

  return {
    candidates: ordered,
    missingCanonicalTargets: Array.from(missingTargets.values()),
    requiresTokenMisses,
  };
};

const fetchMissingRows = async (source: ScoreSource) => {
  let offset = 0;
  const counts = new Map<
    string,
    {
      count: number;
      samples: Set<string>;
      normalizedSamples: Set<string>;
      originalKeys: Set<string>;
      hasLatinBinomial: boolean;
    }
  >();
  const sourceIds = new Set<string>();

  while (true) {
    const { data, error } = await withRetry(() =>
      supabase
        .from("product_ingredients")
        .select("source_id,name_key,name_raw,is_active")
        .eq("source", source)
        .eq("is_active", true)
        .is("ingredient_id", null)
        .order("id", { ascending: true })
        .range(offset, offset + BATCH_SIZE - 1),
    );
    if (error) {
      const meta = extractErrorMeta(error);
      throw new Error(
        `[resolution] fetch missing rows failed (${source}): ${meta.message ?? formatErrorMessage(error)}`,
      );
    }

    const rows = (data ?? []) as MissingIngredientRow[];
    if (!rows.length) break;

    rows.forEach((row) => {
      const normalized = normalizeName(row.name_raw);
      if (!normalized.normalized) return;
      if (!isNonScoringNutrient(normalized.normalized)) {
        const entry = counts.get(normalized.normalized) ?? {
          count: 0,
          samples: new Set<string>(),
          normalizedSamples: new Set<string>(),
          originalKeys: new Set<string>(),
          hasLatinBinomial: false,
        };
        entry.count += 1;
        entry.hasLatinBinomial = entry.hasLatinBinomial || normalized.hasLatinBinomial;
        if (entry.samples.size < MAX_SAMPLE_COUNT) {
          entry.samples.add(row.name_raw.trim());
        }
        if (entry.normalizedSamples.size < MAX_SAMPLE_COUNT) {
          entry.normalizedSamples.add(normalized.normalized);
        }
        if (row.name_key && entry.originalKeys.size < MAX_SAMPLE_COUNT) {
          entry.originalKeys.add(row.name_key);
        }
        counts.set(normalized.normalized, entry);
      }
      sourceIds.add(row.source_id);
    });

    offset += rows.length;
    if (rows.length < BATCH_SIZE) break;
  }

  const top = Array.from(counts.entries())
    .map(([name_key, entry]) => ({
      source,
      name_key,
      normalized_key: name_key,
      count: entry.count,
      samples: Array.from(entry.samples),
      normalized_samples: Array.from(entry.normalizedSamples),
      original_name_keys: Array.from(entry.originalKeys),
      latin_binomial: entry.hasLatinBinomial,
    }))
    .sort((a, b) => b.count - a.count)
    .slice(0, LIMIT);

  return {
    top,
    sourceIds: Array.from(sourceIds),
  };
};

const writeTopFiles = async (source: ScoreSource, top: TopEntry[]) => {
  const jsonPath = path.join(OUTPUT_DIR, `unmatched_${source}_top${LIMIT}.json`);
  const csvPath = path.join(OUTPUT_DIR, `unmatched_${source}_top${LIMIT}.csv`);

  await writeFile(jsonPath, JSON.stringify(top, null, 2), "utf8");

  const csvLines = [
    "source,name_key,normalized_key,count,latin_binomial,original_name_keys,samples,normalized_samples",
    ...top.map((entry) => {
      const samples = entry.samples.map((value) => `"${value.replace(/\"/g, '""')}"`).join(" | ");
      const normalizedSamples = entry.normalized_samples
        .map((value) => `"${value.replace(/\"/g, '""')}"`)
        .join(" | ");
      const originalKeys = entry.original_name_keys
        .map((value) => `"${value.replace(/\"/g, '""')}"`)
        .join(" | ");
      return `${entry.source},"${entry.name_key}","${entry.normalized_key}",${entry.count},${entry.latin_binomial},${originalKeys},${samples},${normalizedSamples}`;
    }),
  ];
  await writeFile(csvPath, csvLines.join("\n"), "utf8");
};

const writeRebackfillFile = async (source: ScoreSource, sourceIds: string[]) => {
  if (!WRITE_REBACKFILL) return;
  const filePath = path.join(OUTPUT_DIR, `missing_ingredient_${source}.jsonl`);
  const lines = sourceIds.map((sourceId) =>
    JSON.stringify({
      timestamp: new Date().toISOString(),
      source,
      sourceId,
      stage: "missing_ingredient_id",
      status: null,
      rayId: null,
      message: null,
    }),
  );
  await writeFile(filePath, `${lines.join("\n")}\n`, "utf8");
};

const ensureSchemaReady = async () => {
  const { error: synonymError } = await supabase
    .from("ingredient_synonyms")
    .select("alias_type,confidence")
    .limit(1);
  if (synonymError) {
    throw new Error(
      "[resolution] ingredient_synonyms missing alias_type/confidence columns. Run migrations first.",
    );
  }

  const { error: reviewError } = await supabase
    .from("manual_review_queue")
    .select("id")
    .limit(1);
  if (reviewError) {
    throw new Error("[resolution] manual_review_queue missing. Run migrations first.");
  }
};

const upsertSynonym = async (row: IngredientSynonymRow): Promise<boolean> => {
  const { data, error } = await supabase
    .from("ingredient_synonyms")
    .select("id")
    .eq("ingredient_id", row.ingredient_id)
    .ilike("synonym", row.synonym)
    .limit(1);
  if (error) {
    throw new Error(`[resolution] synonym lookup failed: ${error.message}`);
  }
  if (data && data.length > 0) return false;

  const { error: insertError } = await supabase
    .from("ingredient_synonyms")
    .insert(row);
  if (insertError) {
    throw new Error(`[resolution] synonym insert failed: ${insertError.message}`);
  }
  return true;
};

const queueManualReview = async (row: ReviewQueueRow) => {
  const { data, error } = await supabase
    .from("manual_review_queue")
    .select("id")
    .eq("entity_type", row.entity_type)
    .eq("source", row.source)
    .eq("name_key", row.name_key)
    .eq("status", "open")
    .limit(1);
  if (error) {
    throw new Error(`[resolution] manual review lookup failed: ${error.message}`);
  }
  if (data && data.length > 0) return;

  const { error: insertError } = await supabase
    .from("manual_review_queue")
    .insert(row);
  if (insertError) {
    throw new Error(`[resolution] manual review insert failed: ${insertError.message}`);
  }
};

const applyResolution = async (source: ScoreSource, entries: TopEntry[]) => {
  const dataset = await loadDatasetIndex();
  if (APPLY) {
    await ensureSchemaReady();
  }

  let synonymsAdded = 0;
  let queued = 0;
  let skipped = 0;
  const unresolvedTokens = new Map<string, number>();
  const blockReasonCounts = new Map<string, number>();
  const margins: number[] = [];
  const confidences: number[] = [];
  let wouldAutoApplyCount = 0;
  const previewItems: Record<string, unknown>[] = [];
  const autoApplyItems: Record<string, unknown>[] = [];
  const noCandidateTokens = new Map<string, number>();
  const noCandidateSemanticTokens = new Map<string, number>();
  let filteredNonScoring = 0;
  let specialQueued = 0;
  const canonicalMissing = new Map<
    string,
    {
      ingredientName: string;
      normalized: string;
      count: number;
      samples: Set<string>;
      reasons: Set<string>;
    }
  >();

  for (const entry of entries) {
    const sample =
      entry.samples[0] ?? entry.name_key ?? entry.normalized_key ?? entry.name_key ?? "";
    const normalized = normalizeName(sample);
    const fallbackKey = normalizeText(entry.name_key ?? "");
    const normalizedKey = entry.normalized_key || normalized.normalized || fallbackKey;
    const variantList = normalized.variants.length
      ? [...normalized.variants]
      : buildVariants(sample);
    if (normalizedKey && !variantList.some((variant) => variant.normalized === normalizedKey)) {
      variantList.unshift({
        label: "base",
        raw: normalizedKey,
        normalized: normalizedKey,
        hasLatinBinomial: normalized.hasLatinBinomial,
      });
    }
    const normalizedName: NormalizedName = {
      ...normalized,
      normalized: normalizedKey || normalized.normalized,
      hasLatinBinomial: entry.latin_binomial || normalized.hasLatinBinomial,
      variants: variantList,
    };
    const nameKey = normalizedName.normalized || fallbackKey;

    const normalizedValues = new Set<string>();
    if (sample) normalizedValues.add(normalizeText(sample));
    if (entry.name_key) normalizedValues.add(normalizeText(entry.name_key));
    if (normalizedName.normalized) normalizedValues.add(normalizedName.normalized);
    normalizedName.variants.forEach((variant) => {
      if (variant.normalized) normalizedValues.add(variant.normalized);
    });
    const normalizedList = Array.from(normalizedValues).filter(Boolean);

    const nonScoringMatch = matchPattern(normalizedList, NON_SCORING_PATTERNS);
    if (nonScoringMatch) {
      filteredNonScoring += 1;
      blockReasonCounts.set(
        nonScoringMatch.reason,
        (blockReasonCounts.get(nonScoringMatch.reason) ?? 0) + 1,
      );
      continue;
    }

    const specialMatch = matchPattern(normalizedList, SPECIAL_HANDLING_PATTERNS);
    if (specialMatch) {
      specialQueued += 1;
      blockReasonCounts.set(
        specialMatch.reason,
        (blockReasonCounts.get(specialMatch.reason) ?? 0) + 1,
      );
      if (APPLY) {
        await queueManualReview({
          entity_type: SPECIAL_QUEUE_ENTITY_TYPE,
          source,
          name_key: entry.name_key,
          name_raw: sample,
          payload_json: {
            count: entry.count,
            samples: entry.samples,
            normalized_key: nameKey,
            normalized_samples: entry.normalized_samples,
            original_name_keys: entry.original_name_keys,
            latin_binomial: entry.latin_binomial,
            normalized_variants: normalizedName.variants,
            reason: specialMatch.reason,
          },
          status: "open",
        });
      }
      continue;
    }

    const { candidates, missingCanonicalTargets, requiresTokenMisses } = generateCandidates(
      normalizedName,
      dataset,
    );
    missingCanonicalTargets.forEach((target) => {
      const normalizedTarget = target.normalized || normalizeText(target.ingredientName);
      if (!normalizedTarget) return;
      const existing = canonicalMissing.get(normalizedTarget) ?? {
        ingredientName: target.ingredientName,
        normalized: normalizedTarget,
        count: 0,
        samples: new Set<string>(),
        reasons: new Set<string>(),
      };
      existing.count += entry.count;
      if (existing.samples.size < MAX_SAMPLE_COUNT) {
        existing.samples.add(sample);
      }
      existing.reasons.add(target.reason);
      canonicalMissing.set(normalizedTarget, existing);
    });
    const top = candidates[0] ?? null;
    const runnerUp = candidates[1] ?? null;
    const margin = top ? top.confidence - (runnerUp?.confidence ?? 0) : 0;
    const candidateIsNonScoring = top
      ? isNonScoringNutrient(normalizeText(top.ingredient_name))
      : false;
    const isBlacklisted =
      FORM_ONLY_TOKENS.has(nameKey) || isNonScoringNutrient(nameKey) || candidateIsNonScoring;
    const blockReasons = new Set<string>();
    const hasRequiresTokenMiss = requiresTokenMisses.length > 0;
    const noCandidateReason =
      !top && missingCanonicalTargets.length === 0 && !hasRequiresTokenMiss
        ? classifyNoCandidate(normalizeTokens(nameKey))
        : null;
    if (noCandidateReason) {
      blockReasons.add(noCandidateReason);
    }
    if (!top && hasRequiresTokenMiss) blockReasons.add("requires_tokens");
    if (top && top.confidence < AUTO_APPLY_MIN_CONFIDENCE) blockReasons.add("low_confidence");
    if (top && margin < AUTO_APPLY_MARGIN) blockReasons.add("low_margin");
    if (runnerUp && margin < AUTO_APPLY_MARGIN) blockReasons.add("ambiguous");
    if (isBlacklisted) blockReasons.add("blacklist");
    if (!top && missingCanonicalTargets.length) blockReasons.add("canonical_missing");

    const canAutoApply = Boolean(top) && blockReasons.size === 0;
    const blockedBy = Array.from(blockReasons);
    if (top) {
      confidences.push(top.confidence);
      margins.push(margin);
    }
    if (canAutoApply) {
      wouldAutoApplyCount += 1;
      if (top && autoApplyItems.length < PREVIEW_LIMIT) {
        autoApplyItems.push({
          source,
          raw: sample,
          normalizedVariants: normalizedName.variants,
          ingredientId: top.ingredient_id,
          ingredientName: top.ingredient_name,
          confidence: top.confidence,
          margin,
          reasons: top.reasons,
        });
      }
    } else {
      blockedBy.forEach((reason) => {
        blockReasonCounts.set(reason, (blockReasonCounts.get(reason) ?? 0) + 1);
      });
    }

    if (noCandidateReason === "true_no_candidates") {
      nameKey.split(/\s+/).forEach((token) => {
        if (!token) return;
        if (isNoiseToken(token)) return;
        noCandidateTokens.set(token, (noCandidateTokens.get(token) ?? 0) + entry.count);
      });
    }

    if (noCandidateReason === "true_no_candidates") {
      nameKey.split(/\s+/).forEach((token) => {
        if (!token) return;
        if (isNoiseToken(token)) return;
        if (CHEMICAL_FRAGMENT_TOKENS.has(token)) return;
        noCandidateSemanticTokens.set(token, (noCandidateSemanticTokens.get(token) ?? 0) + entry.count);
      });
    }

    if (!canAutoApply) {
      queued += 1;
    }

    if (APPLY && canAutoApply && top) {
      const inserted = await upsertSynonym({
        ingredient_id: top.ingredient_id,
        synonym: sample,
        alias_type: top.reasons[0] ?? "auto_match",
        confidence: top.confidence,
        source: "ingredient_resolution_sprint",
      });
      if (inserted) {
        synonymsAdded += 1;
      } else {
        skipped += 1;
      }
    } else if (APPLY) {
      await queueManualReview({
        entity_type: "ingredient_synonym",
        source,
        name_key: entry.name_key,
        name_raw: sample,
        payload_json: {
          count: entry.count,
          samples: entry.samples,
          normalized_key: nameKey,
          normalized_samples: entry.normalized_samples,
          original_name_keys: entry.original_name_keys,
          latin_binomial: entry.latin_binomial,
          normalized_original: normalizedName.original,
          normalized_stripped: normalizedName.stripped,
          normalized_variants: normalizedName.variants,
          candidates,
          missingCanonicalTargets,
          requiresTokenMisses,
          autoApplyThreshold: AUTO_APPLY_MIN_CONFIDENCE,
          autoApplyMargin: AUTO_APPLY_MARGIN,
          reason: candidates.length
            ? "below_auto_threshold"
            : hasRequiresTokenMiss
              ? "requires_tokens"
              : missingCanonicalTargets.length
                ? "canonical_missing"
                : noCandidateReason ?? "true_no_candidates",
          blockedBy,
          noCandidateReason,
        },
        status: "open",
      });
    }

    nameKey.split(/\s+/).forEach((token) => {
      if (!token) return;
      unresolvedTokens.set(token, (unresolvedTokens.get(token) ?? 0) + entry.count);
    });

    if (PREVIEW_OUTPUT && previewItems.length < PREVIEW_LIMIT) {
      previewItems.push({
        source,
        raw: sample,
        normalizedVariants: normalizedName.variants,
        top1Candidate: top
          ? {
              ingredientId: top.ingredient_id,
              ingredientName: top.ingredient_name,
              confidence: top.confidence,
              reason: top.reasons[0] ?? null,
            }
          : null,
        top2Candidate: runnerUp
          ? {
              ingredientId: runnerUp.ingredient_id,
              ingredientName: runnerUp.ingredient_name,
              confidence: runnerUp.confidence,
              reason: runnerUp.reasons[0] ?? null,
            }
          : null,
        margin,
        wouldAutoApply: canAutoApply,
        whyNotAutoApply: canAutoApply ? null : blockedBy[0] ?? "unknown",
        noCandidateReason,
        missingCanonicalTargets,
        requiresTokenMisses,
        candidates: candidates.slice(0, TOP_CANDIDATES).map((candidate) => ({
          ingredientId: candidate.ingredient_id,
          ingredientName: candidate.ingredient_name,
          confidence: candidate.confidence,
          reasons: candidate.reasons,
        })),
        decision: {
          wouldAutoApply: canAutoApply,
          topConfidence: top?.confidence ?? null,
          margin,
          blockedBy,
        },
      });
    }
  }

  const topTokens = Array.from(unresolvedTokens.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, 30)
    .map(([token, count]) => ({ token, count }));

  const noCandidatesTopTokens = Array.from(noCandidateTokens.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, 50)
    .map(([token, count]) => ({ token, count }));

  const noCandidatesTopTokensSemantic = Array.from(noCandidateSemanticTokens.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, 50)
    .map(([token, count]) => ({ token, count }));

  const noCandidatesPath = path.join(OUTPUT_DIR, `no_candidates_top_tokens_${source}.json`);
  await writeFile(
    noCandidatesPath,
    JSON.stringify(
      {
        source,
        timestamp: new Date().toISOString(),
        total: noCandidateTokens.size,
        tokens: noCandidatesTopTokens,
      },
      null,
      2,
    ),
    "utf8",
  );
  const noCandidatesSemanticPath = path.join(
    OUTPUT_DIR,
    `no_candidates_top_tokens_${source}_semantic.json`,
  );
  await writeFile(
    noCandidatesSemanticPath,
    JSON.stringify(
      {
        source,
        timestamp: new Date().toISOString(),
        total: noCandidateSemanticTokens.size,
        tokens: noCandidatesTopTokensSemantic,
      },
      null,
      2,
    ),
    "utf8",
  );
  if (SOURCE_ARG === source) {
    const defaultPath = path.join(OUTPUT_DIR, "no_candidates_top_tokens.json");
    await writeFile(
      defaultPath,
      JSON.stringify(
        {
          source,
          timestamp: new Date().toISOString(),
          total: noCandidateTokens.size,
          tokens: noCandidatesTopTokens,
        },
        null,
        2,
      ),
      "utf8",
    );
    const defaultSemanticPath = path.join(
      OUTPUT_DIR,
      "no_candidates_top_tokens_semantic.json",
    );
    await writeFile(
      defaultSemanticPath,
      JSON.stringify(
        {
          source,
          timestamp: new Date().toISOString(),
          total: noCandidateSemanticTokens.size,
          tokens: noCandidatesTopTokensSemantic,
        },
        null,
        2,
      ),
      "utf8",
    );
  }

  const canonicalMissingCandidates = Array.from(canonicalMissing.values())
    .map((entry) => {
      const estimate = estimateCategoryAndUnit(entry.ingredientName);
      return {
        ingredientName: entry.ingredientName,
        normalized: entry.normalized,
        count: entry.count,
        samples: Array.from(entry.samples),
        reasons: Array.from(entry.reasons),
        estimatedCategory: estimate.category,
        estimatedBaseUnit: estimate.baseUnit,
        latinBinomial: detectLatinBinomial(entry.ingredientName),
      };
    })
    .sort((a, b) => b.count - a.count);

  const canonicalMissingCreateCandidates = canonicalMissingCandidates.slice(
    0,
    CANONICAL_MISSING_LIMIT,
  );
  const canonicalMissingPayload = {
    source,
    timestamp: new Date().toISOString(),
    total: canonicalMissingCreateCandidates.length,
    candidates: canonicalMissingCreateCandidates,
  };
  const canonicalMissingCreatePath = path.join(
    OUTPUT_DIR,
    `canonical_missing_create_candidates_${source}.json`,
  );
  await writeFile(
    canonicalMissingCreatePath,
    JSON.stringify(canonicalMissingPayload, null, 2),
    "utf8",
  );
  if (CANONICAL_MISSING_OUTPUT) {
    await writeFile(
      CANONICAL_MISSING_OUTPUT,
      JSON.stringify(canonicalMissingPayload, null, 2),
      "utf8",
    );
  }
  if (SOURCE_ARG === source) {
    const defaultPath = path.join(OUTPUT_DIR, "canonical_missing_create_candidates.json");
    await writeFile(
      defaultPath,
      JSON.stringify(
        {
          source,
          timestamp: new Date().toISOString(),
          total: canonicalMissingCreateCandidates.length,
          candidates: canonicalMissingCreateCandidates,
        },
        null,
        2,
      ),
      "utf8",
    );
  }

  const canonicalMissingPath = path.join(
    OUTPUT_DIR,
    `canonical_missing_candidates_${source}.json`,
  );
  await writeFile(
    canonicalMissingPath,
    JSON.stringify(
      {
        source,
        timestamp: new Date().toISOString(),
        total: canonicalMissingCandidates.length,
        candidates: canonicalMissingCandidates,
      },
      null,
      2,
    ),
    "utf8",
  );
  if (SOURCE_ARG === source) {
    const defaultPath = path.join(OUTPUT_DIR, "canonical_missing_candidates.json");
    await writeFile(
      defaultPath,
      JSON.stringify(
        {
          source,
          timestamp: new Date().toISOString(),
          total: canonicalMissingCandidates.length,
          candidates: canonicalMissingCandidates,
        },
        null,
        2,
      ),
      "utf8",
    );
  }

  const summary = {
    source,
    timestamp: new Date().toISOString(),
    apply: APPLY,
    synonymsAdded,
    queued,
    skipped,
    filteredNonScoring,
    specialQueued,
    wouldAutoApplyCount,
    queuedCount: queued,
    topBlockReasons: Array.from(blockReasonCounts.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, 10)
      .map(([reason, count]) => ({ reason, count })),
    confidenceQuantiles: toQuantiles(confidences),
    marginQuantiles: toQuantiles(margins),
    unresolvedTopTokens: topTokens,
    noCandidatesTopTokens,
    noCandidatesTopTokensSemantic,
    previewOutput: PREVIEW_OUTPUT ?? null,
    previewItemsWritten: PREVIEW_OUTPUT ? previewItems.length : 0,
  };

  const summaryPath = path.join(OUTPUT_DIR, `resolution_summary_${source}.json`);
  await writeFile(
    summaryPath,
    JSON.stringify(summary, null, 2),
    "utf8",
  );

  if (PREVIEW_OUTPUT) {
    await mkdir(path.dirname(PREVIEW_OUTPUT), { recursive: true });
    await writeFile(
      PREVIEW_OUTPUT,
      JSON.stringify({ summary, items: previewItems }, null, 2),
      "utf8",
    );
    if (autoApplyItems.length) {
      const autoApplyPath = PREVIEW_OUTPUT.endsWith(".json")
        ? PREVIEW_OUTPUT.replace(/\.json$/, "_would_auto_apply.json")
        : `${PREVIEW_OUTPUT}_would_auto_apply.json`;
      await writeFile(
        autoApplyPath,
        JSON.stringify(autoApplyItems, null, 2),
        "utf8",
      );
    }
  }

  console.log(
    `[resolution:${source}] apply done synonymsAdded=${synonymsAdded} queued=${queued} skipped=${skipped}`,
  );

  return summary;
};

const run = async () => {
  await ensureOutputDir();
  for (const source of SOURCES) {
    const { top, sourceIds } = await fetchMissingRows(source);
    await writeTopFiles(source, top);
    const summary = await applyResolution(source, top);
    if (WRITE_REBACKFILL) {
      if (summary.synonymsAdded > 0) {
        await writeRebackfillFile(source, sourceIds);
      } else {
        await writeFile(
          path.join(OUTPUT_DIR, `missing_ingredient_${source}.jsonl`),
          "",
          "utf8",
        );
      }
    }
    console.log(
      `[resolution:${source}] top=${top.length} outputDir=${OUTPUT_DIR} rebackfillIds=${WRITE_REBACKFILL ? sourceIds.length : 0}`,
    );
  }
};

run().catch((error) => {
  console.error("[resolution] failed:", error);
  process.exit(1);
});
