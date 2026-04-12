import { normalizeIherbSupplementFactsRowsWithTitleFallback } from "./iherbOverlayIngredients.js";
import { supabase } from "./supabase.js";
import { withRetry } from "./supabaseRetry.js";

type SearchTypeKey = "vitamin" | "mineral" | "herb" | "probiotic" | "protein";
type SearchGoalKey =
  | "sleep"
  | "energy"
  | "immunity"
  | "recovery"
  | "focus"
  | "stress_support"
  | "weight_management"
  | "libido_enhancement";
type SearchGoalTier = "strong_match" | "related" | "weak_match" | "no_match";
type FactsStatus = "full" | "partial" | "none";
type CoverageStatus = "coverage_ready" | "not_enough_structured_data";

type OverlaySearchTableRow = {
  id?: number | null;
  product_id?: string | null;
  upc_code?: string | null;
  barcode_gtin14?: string | null;
  brand_name?: string | null;
  title?: string | null;
  product_catalog_image?: string | null;
  product_images?: unknown;
  categories?: unknown;
  serving?: unknown;
  supplement_facts?: unknown;
  description_sections?: unknown;
  updated_at?: string | null;
};

type SearchIngredientRow = {
  name: string;
  dose: string | null;
  proprietaryBlendSource?: boolean;
  aggregateFormula?: boolean;
};

type ProductSearchIndexRow = {
  id: string;
  productId: string;
  barcode: string | null;
  upcCode: string | null;
  brandName: string;
  title: string;
  imageUrl: string | null;
  servingSize: string | null;
  description: string | null;
  suggestedUse: string | null;
  categories: string[];
  ingredients: SearchIngredientRow[];
  updatedAt: string | null;
  searchText: string;
  brandPopularity: number;
};

type ProductSearchIndex = {
  builtAt: number;
  rows: ProductSearchIndexRow[];
};

export type ProductSearchCard = {
  id: string;
  productId: string;
  barcode: string | null;
  name: string;
  brand: string;
  category: string;
  categoryKey: string | null;
  benefit: string;
  dose: string;
  imageUrl: string | null;
  popularityScore: number;
  relevanceScore: number | null;
  factsStatus: FactsStatus;
  coverageStatus: CoverageStatus;
};

export type ProductSearchResponse = {
  supplements: ProductSearchCard[];
  pagination: {
    total: number;
    page: number;
    limit: number;
    totalPages: number;
  };
  suggestions: {
    categories: string[];
    brands: string[];
    popularSearches: string[];
  };
};

type SearchParams = {
  query?: string | null;
  category?: string | null;
  brand?: string | null;
  page?: number;
  limit?: number;
};

type EnrichedCandidate = {
  row: ProductSearchIndexRow;
  card: ProductSearchCard;
  typeKey: SearchTypeKey | null;
  qualityScore: number;
  baseSearchScore: number;
  finalSearchScore: number;
};

const SEARCH_INDEX_TTL_MS = 15 * 60 * 1000;
const OVERLAY_PAGE_SIZE = 1000;
const DEFAULT_LIMIT = 20;
const MAX_LIMIT = 30;
const MAX_PRELIMINARY_CANDIDATES = 180;
const MAX_SUGGESTION_BRANDS = 6;
const COLD_FALLBACK_QUERY_LIMIT = 220;
const COLD_FALLBACK_BROWSE_LIMIT = 320;
const POPULAR_SEARCHES = ["Magnesium", "Vitamin D", "Omega-3", "Probiotic", "Ashwagandha"];
const OVERLAY_SEARCH_SELECT =
  "id,product_id,upc_code,barcode_gtin14,brand_name,title,product_catalog_image,product_images,categories,serving,supplement_facts,description_sections,updated_at";
const POPULAR_FALLBACK_BRANDS = [
  "Swanson",
  "NOW Foods",
  "Nutricost",
  "Solgar",
  "Solaray",
  "Source Naturals",
  "California Gold Nutrition",
  "Nature's Way",
  "Nature Made",
  "Nature's Bounty",
  "Healthy Origins",
  "Pure Encapsulations",
  "Carlson",
  "Garden of Life",
  "Nordic Naturals",
  "Sports Research",
  "Natrol",
  "Centrum",
  "Qunol",
] as const;

const FILTER_CATEGORY_TO_TYPE_KEY: Record<string, SearchTypeKey> = {
  vitamins: "vitamin",
  vitamin: "vitamin",
  minerals: "mineral",
  mineral: "mineral",
  herbs: "herb",
  herb: "herb",
  probiotics: "probiotic",
  probiotic: "probiotic",
  protein: "protein",
};

const TYPE_KEY_TO_CARD_CATEGORY: Record<SearchTypeKey, string> = {
  vitamin: "Vitamins",
  mineral: "Minerals",
  herb: "Herbs",
  probiotic: "Probiotics",
  protein: "Protein",
};

const GOAL_BENEFIT_COPY: Record<SearchGoalKey, string> = {
  sleep: "Sleep Support",
  energy: "Energy Support",
  immunity: "Immune Support",
  recovery: "Recovery & Performance",
  focus: "Focus Support",
  stress_support: "Stress Support",
  weight_management: "Weight Management",
  libido_enhancement: "Libido Support",
};

const GOAL_SEARCH_ALIASES: Record<SearchGoalKey, string[]> = {
  sleep: ["sleep", "calm", "rest"],
  energy: ["energy", "fatigue", "electrolyte"],
  immunity: ["immune", "immunity", "defense"],
  recovery: ["recovery", "muscle", "performance"],
  focus: ["focus", "cognition", "brain"],
  stress_support: ["stress", "calm", "mood"],
  weight_management: ["weight", "metabolic", "appetite"],
  libido_enhancement: ["libido", "sexual", "vitality"],
};

const GOAL_RULES: {
  key: SearchGoalKey;
  benefit: string;
  strong: RegExp[];
  related?: RegExp[];
}[] = [
  {
    key: "sleep",
    benefit: GOAL_BENEFIT_COPY.sleep,
    strong: [/\bmelatonin\b/, /\bglycine\b/, /\bvalerian\b/, /\bgaba\b/],
    related: [/\bmagnesium\b/, /\btheanine\b/, /\bsleep\b/, /\bcalm\b/],
  },
  {
    key: "energy",
    benefit: GOAL_BENEFIT_COPY.energy,
    strong: [/\bcoq10\b/, /\bcaffeine\b/, /\bb12\b/, /\bb[- ]complex\b/],
    related: [/\benergy\b/, /\biron\b/, /\bmitochondria\b/, /\belectrolyte\b/],
  },
  {
    key: "immunity",
    benefit: GOAL_BENEFIT_COPY.immunity,
    strong: [/\bvitamin c\b/, /\bzinc\b/, /\belderberry\b/, /\bechinacea\b/],
    related: [/\bimmune\b/, /\bimmunity\b/, /\bvitamin d\b/, /\bprobiotic\b/],
  },
  {
    key: "recovery",
    benefit: GOAL_BENEFIT_COPY.recovery,
    strong: [/\bprotein\b/, /\bcreatine\b/, /\bcollagen\b/, /\bbcaa\b/, /\beaa\b/],
    related: [/\brecovery\b/, /\bmuscle\b/, /\bperformance\b/, /\bglutamine\b/],
  },
  {
    key: "focus",
    benefit: GOAL_BENEFIT_COPY.focus,
    strong: [/\bbacopa\b/, /\blion'?s mane\b/, /\bcholine\b/, /\bphosphatidylserine\b/],
    related: [/\bfocus\b/, /\btheanine\b/, /\brhodiola\b/, /\bcognition\b/],
  },
  {
    key: "stress_support",
    benefit: GOAL_BENEFIT_COPY.stress_support,
    strong: [/\bashwagandha\b/, /\brhodiola\b/],
    related: [/\bstress\b/, /\bcalm\b/, /\bmagnesium\b/, /\btheanine\b/],
  },
  {
    key: "weight_management",
    benefit: GOAL_BENEFIT_COPY.weight_management,
    strong: [/\bberberine\b/, /\bglucomannan\b/, /\bappetite\b/, /\bglp[- ]?1\b/],
    related: [/\bweight\b/, /\bmetabolic\b/, /\bfiber\b/, /\bthermogenic\b/],
  },
  {
    key: "libido_enhancement",
    benefit: GOAL_BENEFIT_COPY.libido_enhancement,
    strong: [/\bmaca\b/, /\btongkat\b/, /\btribulus\b/, /\bhorny goat\b/],
    related: [/\blibido\b/, /\bsexual\b/, /\btestosterone\b/],
  },
];

let cachedSearchIndex: ProductSearchIndex | null = null;
let inflightSearchIndexBuild: Promise<ProductSearchIndex> | null = null;

const safeTrim = (value: unknown): string | null => {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
};

const toObjectRecord = (value: unknown): Record<string, unknown> =>
  value && typeof value === "object" ? (value as Record<string, unknown>) : {};

const normalizeSearchText = (value: string): string =>
  value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();

const POPULAR_FALLBACK_BRAND_SCORES = new Map(
  POPULAR_FALLBACK_BRANDS.map((brand, index) => [
    normalizeSearchText(brand),
    (POPULAR_FALLBACK_BRANDS.length - index) * 120,
  ]),
);

const normalizeLookupText = (value: string | null | undefined): string =>
  normalizeSearchText(String(value ?? ""));

const toPostgrestIlikeValue = (value: string | null | undefined): string | null => {
  const normalized = normalizeLookupText(value).replace(/[%_,]/g, " ").trim();
  return normalized.length > 0 ? normalized : null;
};

const getFallbackBrandPopularity = (brandName: string, batchCount: number): number =>
  (POPULAR_FALLBACK_BRAND_SCORES.get(normalizeLookupText(brandName)) ?? 0) + batchCount * 12;

const normalizeSectionKey = (value: string): string =>
  value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "")
    .trim();

const readSectionText = (sections: Record<string, unknown>, aliases: string[]): string | null => {
  const aliasKeys = new Set(aliases.map(normalizeSectionKey));
  for (const [rawKey, rawValue] of Object.entries(sections)) {
    if (!aliasKeys.has(normalizeSectionKey(rawKey))) continue;
    if (typeof rawValue !== "string") continue;
    const trimmed = rawValue.trim();
    if (trimmed) return trimmed;
  }
  return null;
};

const IHERB_IMAGE_HOST_PATTERN = /(^|\.)images-iherb\.com$/i;
const IHERB_CMS_BANNER_PATTERN = /\/images\/cms\//i;
const INTERNAL_RENDER_IMAGE_PATTERN =
  /\/overlay-label-assets\/(?:generated-fallback-cards|dsld-label-renders)\//i;

const scoreSearchImageUrl = (value: string): number => {
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    return 0;
  }

  if (IHERB_IMAGE_HOST_PATTERN.test(parsed.hostname)) {
    if (IHERB_CMS_BANNER_PATTERN.test(parsed.pathname)) return 20;
    return 100;
  }

  if (INTERNAL_RENDER_IMAGE_PATTERN.test(value)) {
    return 10;
  }

  if (/^https?:$/i.test(parsed.protocol)) {
    return 70;
  }

  return 30;
};

const readOverlayImageUrl = (row: Record<string, unknown>): string | null => {
  const candidates: string[] = [];
  const seen = new Set<string>();
  const pushCandidate = (value: unknown) => {
    if (typeof value !== "string") return;
    const trimmed = value.trim();
    if (!trimmed || seen.has(trimmed)) return;
    seen.add(trimmed);
    candidates.push(trimmed);
  };

  [row.productCatalogImage, row.product_catalog_image, row.imageUrl, row.image_url].forEach(pushCandidate);

  const imageCollections = [row.productImages, row.product_images];
  for (const collection of imageCollections) {
    if (!Array.isArray(collection)) continue;
    for (const item of collection) {
      if (typeof item === "string") {
        pushCandidate(item);
        continue;
      }
      if (item && typeof item === "object") {
        const record = item as Record<string, unknown>;
        for (const nested of [record.url, record.src, record.imageUrl, record.image_url]) {
          pushCandidate(nested);
        }
      }
    }
  }

  const ranked = candidates
    .map((candidate) => ({ candidate, score: scoreSearchImageUrl(candidate) }))
    .sort((left, right) => right.score - left.score);

  const best = ranked[0];
  if (!best || best.score < 50) return null;
  return best.candidate;
};

const readServingSize = (serving: Record<string, unknown>, supplementFacts: Record<string, unknown>): string | null => {
  const directCandidates = [
    supplementFacts.servingSize,
    supplementFacts.serving_size,
    serving.servingSize,
    serving.serving_size,
    serving.size,
    serving.label,
  ];

  for (const candidate of directCandidates) {
    if (typeof candidate !== "string") continue;
    const trimmed = candidate.trim();
    if (trimmed) return trimmed;
  }

  return null;
};

const extractOverlayCategories = (row: OverlaySearchTableRow): string[] => {
  if (!Array.isArray(row.categories)) return [];
  return row.categories
    .map((value) => String(value ?? "").trim())
    .filter(Boolean)
    .slice(0, 6);
};

const extractOverlayIngredients = (row: OverlaySearchTableRow): SearchIngredientRow[] => {
  const supplementFacts = toObjectRecord(row.supplement_facts);
  const descriptionSections = toObjectRecord(row.description_sections);
  const nutritionalFactsRaw = Array.isArray(supplementFacts.nutritionalFacts)
    ? supplementFacts.nutritionalFacts
    : Array.isArray(supplementFacts.nutritional_facts)
      ? supplementFacts.nutritional_facts
      : [];

  return normalizeIherbSupplementFactsRowsWithTitleFallback({
    rows: Array.isArray(nutritionalFactsRaw) ? (nutritionalFactsRaw as Record<string, unknown>[]) : [],
    title: row.title,
    brandName: row.brand_name,
    sourceZipPath: null,
    servingSize:
      typeof supplementFacts.servingSize === "string"
        ? supplementFacts.servingSize
        : typeof supplementFacts.serving_size === "string"
          ? supplementFacts.serving_size
          : null,
    servingsPerContainer:
      typeof supplementFacts.servingsPerContainer === "string"
        ? supplementFacts.servingsPerContainer
        : typeof supplementFacts.servings_per_container === "string"
          ? supplementFacts.servings_per_container
          : null,
    descriptionText: readSectionText(descriptionSections, ["description"]),
  });
};

const buildProductSearchIndexRow = (
  rawRow: OverlaySearchTableRow,
  brandPopularity: number,
): ProductSearchIndexRow | null => {
  const productId = safeTrim(rawRow.product_id);
  const title = safeTrim(rawRow.title);
  const brandName = safeTrim(rawRow.brand_name);
  if (!productId || !title || !brandName) return null;

  const supplementFacts = toObjectRecord(rawRow.supplement_facts);
  const descriptionSections = toObjectRecord(rawRow.description_sections);
  const serving = toObjectRecord(rawRow.serving);
  const categories = extractOverlayCategories(rawRow);
  const ingredients = extractOverlayIngredients(rawRow);
  const description = readSectionText(descriptionSections, ["description"]);
  const suggestedUse = readSectionText(descriptionSections, ["suggested use", "suggested usage", "suggested use."]);
  const imageUrl = readOverlayImageUrl(rawRow as Record<string, unknown>);
  const barcode = safeTrim(rawRow.barcode_gtin14);
  const upcCode = safeTrim(rawRow.upc_code);
  const servingSize = readServingSize(serving, supplementFacts);
  const searchText = buildSearchText({
    title,
    brandName,
    barcode,
    upcCode,
    categories,
    ingredients,
    description,
    suggestedUse,
  });

  return {
    id: String(rawRow.id ?? productId),
    productId,
    barcode,
    upcCode,
    brandName,
    title,
    imageUrl,
    servingSize,
    description,
    suggestedUse,
    categories,
    ingredients,
    updatedAt: rawRow.updated_at ?? null,
    searchText,
    brandPopularity,
  };
};

const escapeRegExp = (value: string): string => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

const normalizeDoseLabel = (value: string): string =>
  value
    .replace(/\bgram(?:\s*\(s\))?s?\b/gi, "g")
    .replace(/\bmilligram(?:\s*\(s\))?s?\b/gi, "mg")
    .replace(/\bmicrogram(?:\s*\(s\))?s?\b/gi, "mcg")
    .replace(/\binternational units?\b/gi, "IU")
    .replace(/\bcfu\b/gi, "CFU")
    .replace(/\(s\)/gi, "")
    .replace(/\s+/g, " ")
    .trim();

const DISPLAYABLE_DOSE_PATTERN =
  /[<>~]?\s*\d[\d,]*(?:[.,]\d+)?\s*(mcg|μg|µg|ug|mg|g|iu|ui|ml|cfu|(?:billion|million|trillion)(?:\s+cfu)?)\b/i;

const CALORIE_DOSE_PATTERN = /\b(?:calories?|kcal|cal)\b/i;

const NON_DISPLAY_DOSAGE_INGREDIENT_NAME_PATTERN = /^calories?$/i;

const DOSE_SUFFIX_NOISE_PATTERN =
  /\b(?:per\s+(?:capsule|capsules|tablet|tablets|softgel|softgels|serving|servings|gummy|gummies|packet|packets|stick|sticks|scoop|scoops|drop|drops|dropperful)|each)\b/gi;

const hasStructuredDose = (value: string | null | undefined): boolean =>
  DISPLAYABLE_DOSE_PATTERN.test(normalizeDoseLabel(String(value ?? "")));

const getDisplayDose = (ingredientDose: string | null | undefined): string | null => {
  const normalized = normalizeDoseLabel(String(ingredientDose ?? ""));
  if (!normalized) return null;
  if (CALORIE_DOSE_PATTERN.test(normalized)) return null;
  if (!DISPLAYABLE_DOSE_PATTERN.test(normalized)) return null;

  const compact = normalized.replace(DOSE_SUFFIX_NOISE_PATTERN, "").replace(/\s+/g, " ").trim();
  const extracted = compact.match(DISPLAYABLE_DOSE_PATTERN);
  if (!extracted?.[0]) return compact;
  return normalizeDoseLabel(extracted[0]);
};

const pickDisplayDose = (row: ProductSearchIndexRow): string => {
  for (const ingredient of row.ingredients) {
    if (NON_DISPLAY_DOSAGE_INGREDIENT_NAME_PATTERN.test(ingredient.name.trim())) continue;
    const displayDose = getDisplayDose(ingredient.dose);
    if (displayDose) return displayDose;
  }

  const servingDose = getDisplayDose(row.servingSize);
  return servingDose ?? "";
};

const stripRedundantBrandPrefix = (title: string, brandName: string): string => {
  const trimmedTitle = title.trim();
  const trimmedBrand = brandName.trim();
  if (!trimmedTitle || !trimmedBrand) return trimmedTitle;

  const looseBrandPattern = escapeRegExp(trimmedBrand).replace(/\s+/g, "[\\s,\\-–—]+");
  const strippedTitle = trimmedTitle
    .replace(new RegExp(`^${looseBrandPattern}[\\s,\\-–—:|]*`, "i"), "")
    .trim();

  return strippedTitle || trimmedTitle;
};

const normalizeDisplayTitle = (title: string, brandName: string): string =>
  stripRedundantBrandPrefix(title, brandName)
    .replace(/\s*,\s*,+/g, ", ")
    .replace(/\s+,/g, ",")
    .replace(/\s{2,}/g, " ")
    .trim();

const deriveFactsStatus = (ingredients: SearchIngredientRow[]): FactsStatus => {
  if (ingredients.length === 0) return "none";
  return ingredients.some((ingredient) => hasStructuredDose(ingredient.dose)) ? "full" : "partial";
};

const deriveTypeKeysFromContent = (input: {
  title: string;
  brandName: string;
  description: string | null;
  suggestedUse: string | null;
  ingredients: SearchIngredientRow[];
}): SearchTypeKey[] => {
  const haystack = normalizeLookupText(
    [
      input.title,
      input.brandName,
      input.description ?? "",
      input.suggestedUse ?? "",
      ...input.ingredients.map((ingredient) => ingredient.name),
    ].join(" "),
  );

  const next = new Set<SearchTypeKey>();

  if (/\b(probiotic|lactobacillus|bifidobacter|saccharomyces|prebiotic|cfu)\b/.test(haystack)) {
    next.add("probiotic");
  }
  const proteinSignalHaystack = normalizeLookupText(
    [input.title, ...input.ingredients.map((ingredient) => ingredient.name), input.suggestedUse ?? ""].join(" "),
  );
  if (
    /\b(protein|whey|casein|isolate|pea protein|rice protein|collagen peptides?|amino acid|bcaa|eaa)\b/.test(
      proteinSignalHaystack,
    )
  ) {
    next.add("protein");
  }
  if (
    /\b(vitamin|ascorbic|cholecalciferol|ergocalciferol|tocopherol|retinol|folate|folic acid|cobalamin|niacin|thiamin|riboflavin|biotin|pantothenic)\b/.test(
      haystack,
    )
  ) {
    next.add("vitamin");
  }
  if (
    /\b(magnesium|zinc|calcium|iron|selenium|copper|chromium|potassium|iodine|manganese|electrolyte)\b/.test(
      haystack,
    )
  ) {
    next.add("mineral");
  }
  if (
    /\b(ashwagandha|rhodiola|turmeric|elderberry|bacopa|ginseng|garlic|maca|valerian|mushroom|lion'?s mane|reishi|cordyceps|botanical|herbal?)\b/.test(
      haystack,
    )
  ) {
    next.add("herb");
  }

  return Array.from(next);
};

const getFallbackCardCategory = (input: {
  title: string;
  description: string | null;
  suggestedUse: string | null;
  ingredients: SearchIngredientRow[];
}): string => {
  const haystack = normalizeLookupText(
    [
      input.title,
      input.description ?? "",
      input.suggestedUse ?? "",
      ...input.ingredients.map((ingredient) => ingredient.name),
    ].join(" "),
  );

  if (/\b(omega 3|omega3|fish oil|dha|epa|essential fatty)\b/.test(haystack)) {
    return "Essential";
  }
  if (/\b(creatine|taurine|theanine|carnitine|bcaa|eaa|amino acid)\b/.test(haystack)) {
    return "Amino Acids";
  }
  return "Supplement";
};

const getFallbackBenefit = (category: string): string => {
  switch (category) {
    case "Vitamins":
      return "Foundational Nutrient Support";
    case "Minerals":
      return "Daily Mineral Support";
    case "Herbs":
      return "Botanical Wellness Support";
    case "Probiotics":
      return "Gut & Digestive Support";
    case "Protein":
      return "Recovery & Muscle Support";
    case "Essential":
      return "Heart & Brain Support";
    case "Amino Acids":
      return "Performance & Recovery Support";
    default:
      return "Daily Supplement Support";
  }
};

const categoryFilterToTypeKey = (value: string | null | undefined): SearchTypeKey | null => {
  const normalized = normalizeLookupText(value);
  if (!normalized || normalized === "all") return null;
  return FILTER_CATEGORY_TO_TYPE_KEY[normalized] ?? null;
};

const scoreTierPriority = (tier: SearchGoalTier): number => {
  switch (tier) {
    case "strong_match":
      return 4;
    case "related":
      return 3;
    case "weak_match":
      return 2;
    default:
      return 1;
  }
};

const buildSearchText = (params: {
  title: string;
  brandName: string;
  barcode: string | null;
  upcCode: string | null;
  categories: string[];
  ingredients: SearchIngredientRow[];
  description: string | null;
  suggestedUse: string | null;
}): string => {
  const baseText = [
    params.title,
    params.brandName,
    params.barcode ?? "",
    params.upcCode ?? "",
    ...params.categories,
    ...params.ingredients.map((ingredient) => ingredient.name),
    params.description ?? "",
    params.suggestedUse ?? "",
  ].join(" ");
  const normalizedBase = normalizeLookupText(baseText);
  const derivedGoalTokens = GOAL_RULES.flatMap((rule) => {
    const matched =
      rule.strong.some((pattern) => pattern.test(normalizedBase)) ||
      (rule.related ?? []).some((pattern) => pattern.test(normalizedBase));
    return matched ? GOAL_SEARCH_ALIASES[rule.key] ?? [] : [];
  });

  return normalizeSearchText([baseText, ...derivedGoalTokens].join(" "));
};

const computeBaseSearchScore = (row: ProductSearchIndexRow, tokens: string[]): number => {
  if (tokens.length === 0) return 0;

  const title = normalizeLookupText(row.title);
  const brand = normalizeLookupText(row.brandName);
  const categories = normalizeLookupText(row.categories.join(" "));
  const ingredientNames = normalizeLookupText(row.ingredients.map((ingredient) => ingredient.name).join(" "));

  let score = 0;
  for (const token of tokens) {
    if (!row.searchText.includes(token)) return 0;

    if (title.startsWith(token)) score += 36;
    else if (title.includes(token)) score += 24;
    else if (brand.startsWith(token)) score += 18;
    else if (brand.includes(token)) score += 14;
    else if (categories.includes(token)) score += 10;
    else if (ingredientNames.includes(token)) score += 8;
    else score += 4;
  }

  return score;
};

const buildQualityScore = (input: {
  factsStatus: FactsStatus;
  coverageStatus: CoverageStatus;
  bestTier: SearchGoalTier;
}): number => {
  const coverageWeight = input.coverageStatus === "coverage_ready" ? 90 : 32;
  const factsWeight = input.factsStatus === "full" ? 30 : input.factsStatus === "partial" ? 14 : 0;
  return coverageWeight + factsWeight + scoreTierPriority(input.bestTier) * 8;
};

const matchGoalForRow = (haystack: string): { benefit: string; tier: SearchGoalTier } => {
  let best: { benefit: string; tier: SearchGoalTier; score: number } | null = null;

  for (const rule of GOAL_RULES) {
    let score = 0;

    rule.strong.forEach((pattern) => {
      if (pattern.test(haystack)) score += 3;
    });

    (rule.related ?? []).forEach((pattern) => {
      if (pattern.test(haystack)) score += 1;
    });

    const tier: SearchGoalTier = score >= 3 ? "strong_match" : score >= 2 ? "related" : score >= 1 ? "weak_match" : "no_match";
    if (!best || score > best.score || (score === best.score && scoreTierPriority(tier) > scoreTierPriority(best.tier))) {
      best = {
        benefit: rule.benefit,
        tier,
        score,
      };
    }
  }

  if (!best || best.tier === "no_match") {
    return {
      benefit: "",
      tier: "no_match",
    };
  }

  return {
    benefit: best.benefit,
    tier: best.tier,
  };
};

const enrichSearchRow = (row: ProductSearchIndexRow, baseSearchScore: number): EnrichedCandidate => {
  const factsStatus = deriveFactsStatus(row.ingredients);
  const typeKeys = deriveTypeKeysFromContent({
    title: row.title,
    brandName: row.brandName,
    description: row.description,
    suggestedUse: row.suggestedUse,
    ingredients: row.ingredients,
  });
  const primaryTypeKey = typeKeys[0] ?? null;
  const fallbackCategory = getFallbackCardCategory({
    title: row.title,
    description: row.description,
    suggestedUse: row.suggestedUse,
    ingredients: row.ingredients,
  });
  const categoryLabel = primaryTypeKey ? TYPE_KEY_TO_CARD_CATEGORY[primaryTypeKey] : fallbackCategory;
  const goalHaystack = normalizeLookupText(
    [
      row.title,
      row.description ?? "",
      row.suggestedUse ?? "",
      ...row.ingredients.map((ingredient) => ingredient.name),
    ].join(" "),
  );
  const goalChoice = matchGoalForRow(goalHaystack);
  const benefit = goalChoice.benefit || getFallbackBenefit(categoryLabel);
  const coverageStatus: CoverageStatus = factsStatus === "full" ? "coverage_ready" : "not_enough_structured_data";
  const qualityScore = buildQualityScore({
    factsStatus,
    coverageStatus,
    bestTier: goalChoice.tier,
  });
  const finalSearchScore = baseSearchScore + (goalChoice.tier !== "no_match" && baseSearchScore > 0 ? 3 : 0);

  return {
    row,
    typeKey: primaryTypeKey,
    qualityScore,
    baseSearchScore,
    finalSearchScore,
    card: {
      id: row.id,
      productId: row.productId,
      barcode: row.barcode,
      name: normalizeDisplayTitle(row.title, row.brandName),
      brand: row.brandName,
      category: categoryLabel,
      categoryKey: primaryTypeKey,
      benefit,
      dose: pickDisplayDose(row),
      imageUrl: row.imageUrl,
      popularityScore: row.brandPopularity,
      relevanceScore: baseSearchScore > 0 ? finalSearchScore : null,
      factsStatus,
      coverageStatus,
    },
  };
};

const sortCandidates = (left: EnrichedCandidate, right: EnrichedCandidate, hasQuery: boolean): number => {
  if (hasQuery) {
    const relevanceDelta = right.finalSearchScore - left.finalSearchScore;
    if (relevanceDelta !== 0) return relevanceDelta;
  }

  const popularityDelta = right.card.popularityScore - left.card.popularityScore;
  if (popularityDelta !== 0) return popularityDelta;

  const qualityDelta = right.qualityScore - left.qualityScore;
  if (qualityDelta !== 0) return qualityDelta;

  return left.card.name.localeCompare(right.card.name);
};

const dedupeCandidates = (items: EnrichedCandidate[]): EnrichedCandidate[] => {
  const seen = new Set<string>();
  const next: EnrichedCandidate[] = [];

  items.forEach((item) => {
    const key = normalizeLookupText(`${item.card.brand} ${item.card.name}`);
    if (!key || seen.has(key)) return;
    seen.add(key);
    next.push(item);
  });

  return next;
};

const NON_SUPPLEMENT_TITLE_PATTERN =
  /\b(tea bags?|herbal tea|green tea|black tea|coffee|snack|candy|cookies?|cracker|rice|pasta|granola|sweeteners?)\b/;

const isLikelyNonSupplement = (item: EnrichedCandidate): boolean =>
  NON_SUPPLEMENT_TITLE_PATTERN.test(normalizeLookupText(item.card.name)) &&
  !/\bsupplement\b/.test(normalizeLookupText(`${item.card.name} ${item.row.description ?? ""}`));

const diversifyByBrand = (items: EnrichedCandidate[]): EnrichedCandidate[] => {
  const order: string[] = [];
  const buckets = new Map<string, EnrichedCandidate[]>();

  items.forEach((item) => {
    const key = normalizeLookupText(item.card.brand);
    if (!buckets.has(key)) {
      buckets.set(key, []);
      order.push(key);
    }
    buckets.get(key)?.push(item);
  });

  const next: EnrichedCandidate[] = [];
  let added = true;

  while (added) {
    added = false;
    order.forEach((key) => {
      const bucket = buckets.get(key);
      if (!bucket || bucket.length === 0) return;
      const candidate = bucket.shift();
      if (!candidate) return;
      next.push(candidate);
      added = true;
    });
  }

  return next;
};

const buildSearchIndex = async (): Promise<ProductSearchIndex> => {
  const rows: ProductSearchIndexRow[] = [];
  const brandCounts = new Map<string, number>();
  let lastSeenId = 0;

  while (true) {
    let query = supabase
      .from("iherb_overlay_products")
      .select(OVERLAY_SEARCH_SELECT)
      .order("id", { ascending: true })
      .limit(OVERLAY_PAGE_SIZE);

    if (lastSeenId > 0) {
      query = query.gt("id", lastSeenId);
    }

    const { data, error } = await withRetry(() => query, {
      retries: 3,
      baseDelayMs: 200,
      maxDelayMs: 1500,
    });
    if (error) {
      const message = error instanceof Error ? error.message : String(error);
      throw new Error(`[product-search] failed to read iherb_overlay_products: ${message}`);
    }

    const batch = Array.isArray(data) ? (data as OverlaySearchTableRow[]) : [];
    if (batch.length === 0) break;

    for (const rawRow of batch) {
      const brandName = safeTrim(rawRow.brand_name);
      if (!brandName) continue;
      const normalizedBrand = normalizeLookupText(brandName);
      brandCounts.set(normalizedBrand, (brandCounts.get(normalizedBrand) ?? 0) + 1);
      const builtRow = buildProductSearchIndexRow(rawRow, 0);
      if (builtRow) {
        rows.push(builtRow);
      }
    }

    const nextLastSeenId = Number(batch[batch.length - 1]?.id ?? 0);
    if (!Number.isFinite(nextLastSeenId) || nextLastSeenId <= lastSeenId) break;
    lastSeenId = nextLastSeenId;
  }

  return {
    builtAt: Date.now(),
    rows: rows.map((row) => ({
      ...row,
      brandPopularity: brandCounts.get(normalizeLookupText(row.brandName)) ?? 0,
    })),
  };
};

const ensureSearchIndexWarm = (): Promise<ProductSearchIndex> => {
  const now = Date.now();
  if (cachedSearchIndex && now - cachedSearchIndex.builtAt < SEARCH_INDEX_TTL_MS) {
    return Promise.resolve(cachedSearchIndex);
  }

  if (inflightSearchIndexBuild) {
    return inflightSearchIndexBuild;
  }

  inflightSearchIndexBuild = buildSearchIndex()
    .then((index) => {
      cachedSearchIndex = index;
      return index;
    })
    .finally(() => {
      inflightSearchIndexBuild = null;
    });

  return inflightSearchIndexBuild;
};

const warmSearchIndexInBackground = (): void => {
  void ensureSearchIndexWarm().catch((error) => {
    console.error("[product-search] background warm failed", error);
  });
};

const getUsableSearchIndex = (): ProductSearchIndex | null => {
  const now = Date.now();
  if (cachedSearchIndex && now - cachedSearchIndex.builtAt < SEARCH_INDEX_TTL_MS) {
    return cachedSearchIndex;
  }

  if (cachedSearchIndex) {
    warmSearchIndexInBackground();
    return cachedSearchIndex;
  }

  warmSearchIndexInBackground();
  return null;
};

const buildFallbackRows = (batch: OverlaySearchTableRow[]): ProductSearchIndexRow[] => {
  const brandCounts = new Map<string, number>();
  for (const rawRow of batch) {
    const brandName = safeTrim(rawRow.brand_name);
    if (!brandName) continue;
    const normalizedBrand = normalizeLookupText(brandName);
    brandCounts.set(normalizedBrand, (brandCounts.get(normalizedBrand) ?? 0) + 1);
  }

  return batch
    .map((rawRow) => {
      const brandName = safeTrim(rawRow.brand_name);
      const fallbackPopularity = brandName
        ? getFallbackBrandPopularity(brandName, brandCounts.get(normalizeLookupText(brandName)) ?? 0)
        : 0;
      return buildProductSearchIndexRow(rawRow, fallbackPopularity);
    })
    .filter((row): row is ProductSearchIndexRow => Boolean(row));
};

const fetchColdFallbackRows = async (params: SearchParams): Promise<ProductSearchIndexRow[]> => {
  const queryLike = toPostgrestIlikeValue(params.query);
  const brandLike = toPostgrestIlikeValue(params.brand);
  const hasQuery = Boolean(queryLike);
  const shouldUsePopularBrandBrowse = !hasQuery && !brandLike;

  let query = supabase
    .from("iherb_overlay_products")
    .select(OVERLAY_SEARCH_SELECT)
    .order("updated_at", { ascending: false })
    .limit(hasQuery ? COLD_FALLBACK_QUERY_LIMIT : COLD_FALLBACK_BROWSE_LIMIT);

  if (brandLike) {
    query = query.ilike("brand_name", `%${brandLike}%`);
  }

  if (queryLike) {
    query = query.or(
      [
        `title.ilike.%${queryLike}%`,
        `brand_name.ilike.%${queryLike}%`,
        `upc_code.ilike.%${queryLike}%`,
        `barcode_gtin14.ilike.%${queryLike}%`,
      ].join(","),
    );
  } else if (shouldUsePopularBrandBrowse) {
    query = query.in("brand_name", [...POPULAR_FALLBACK_BRANDS]);
  }

  const { data, error } = await withRetry(() => query, {
    retries: 2,
    baseDelayMs: 120,
    maxDelayMs: 800,
  });

  if (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`[product-search] cold fallback read failed: ${message}`);
  }

  return buildFallbackRows(Array.isArray(data) ? (data as OverlaySearchTableRow[]) : []);
};

const buildSearchResponseFromRows = (
  rows: ProductSearchIndexRow[],
  params: SearchParams,
): ProductSearchResponse => {
  const page = Number.isFinite(params.page) && (params.page ?? 0) > 0 ? Math.floor(params.page as number) : 1;
  const limit = Math.min(
    MAX_LIMIT,
    Math.max(1, Number.isFinite(params.limit) && (params.limit ?? 0) > 0 ? Math.floor(params.limit as number) : DEFAULT_LIMIT),
  );
  const normalizedQuery = normalizeLookupText(params.query);
  const queryTokens = normalizedQuery.length >= 2 ? normalizedQuery.split(" ").filter(Boolean) : [];
  const normalizedBrandFilter = normalizeLookupText(params.brand);
  const categoryTypeKey = categoryFilterToTypeKey(params.category);

  let preliminary = rows
    .filter((row) =>
      normalizedBrandFilter ? normalizeLookupText(row.brandName).includes(normalizedBrandFilter) : true,
    )
    .map((row) => ({
      row,
      baseSearchScore: queryTokens.length > 0 ? computeBaseSearchScore(row, queryTokens) : 0,
    }))
    .filter((entry) => (queryTokens.length > 0 ? entry.baseSearchScore > 0 : true));

  preliminary.sort((left, right) => {
    if (queryTokens.length > 0) {
      const scoreDelta = right.baseSearchScore - left.baseSearchScore;
      if (scoreDelta !== 0) return scoreDelta;
    }

    const popularityDelta = right.row.brandPopularity - left.row.brandPopularity;
    if (popularityDelta !== 0) return popularityDelta;
    return left.row.title.localeCompare(right.row.title);
  });

  const shortlistCap = queryTokens.length > 0 ? MAX_PRELIMINARY_CANDIDATES : 1200;
  const shortlisted = preliminary.slice(0, shortlistCap);
  let enriched = shortlisted.map((entry) => enrichSearchRow(entry.row, entry.baseSearchScore));

  if (categoryTypeKey) {
    enriched = enriched.filter((entry) => entry.typeKey === categoryTypeKey);
  }

  enriched.sort((left, right) => sortCandidates(left, right, queryTokens.length > 0));
  enriched = dedupeCandidates(enriched);
  enriched = enriched.filter((entry) => !isLikelyNonSupplement(entry));
  if (queryTokens.length === 0) {
    enriched = diversifyByBrand(enriched);
  }

  const total = enriched.length;
  const startIndex = (page - 1) * limit;
  const paged = enriched.slice(startIndex, startIndex + limit);
  const topBrands = Array.from(new Set(enriched.map((entry) => entry.card.brand))).slice(0, MAX_SUGGESTION_BRANDS);

  return {
    supplements: paged.map((entry) => entry.card),
    pagination: {
      total,
      page,
      limit,
      totalPages: Math.max(1, Math.ceil(total / limit)),
    },
    suggestions: {
      categories: ["All", "Vitamins", "Minerals", "Herbs", "Probiotics", "Protein"],
      brands: topBrands,
      popularSearches: POPULAR_SEARCHES,
    },
  };
};

export const searchProducts = async (params: SearchParams): Promise<ProductSearchResponse> => {
  const index = getUsableSearchIndex();
  if (index) {
    return buildSearchResponseFromRows(index.rows, params);
  }

  console.info("[product-search] using cold fallback while warming full index", {
    query: safeTrim(params.query) ?? null,
    category: safeTrim(params.category) ?? null,
    brand: safeTrim(params.brand) ?? null,
  });

  const fallbackRows = await fetchColdFallbackRows(params);
  return buildSearchResponseFromRows(fallbackRows, params);
};
