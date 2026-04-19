import { normalizeIherbSupplementFactsRowsWithTitleFallback } from "./iherbOverlayIngredients.js";
import { supabase } from "./supabase.js";
import { withRetry } from "./supabaseRetry.js";

type SearchTypeKey =
  | "vitamin"
  | "mineral"
  | "herb"
  | "probiotic"
  | "protein"
  | "essential"
  | "amino_acid";
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

export type ProductSearchIndexRow = {
  id: string;
  productId: string;
  barcode: string | null;
  upcCode: string | null;
  brandName: string;
  title: string;
  imageUrl: string | null;
  primaryFactsAmount: string | null;
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

export type SearchQueryPlan = {
  normalizedQuery: string;
  requiredGroups: string[][];
  optionalGroups: string[][];
};

export type ProductSearchCard = {
  id: string;
  productId: string;
  barcode: string | null;
  upcCode: string | null;
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

export type ProductSearchBootstrapResponse = {
  generatedAt: number;
  categories: Record<string, ProductSearchCard[]>;
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
const COLD_BOOTSTRAP_TTL_MS = 5 * 60 * 1000;
const OVERLAY_PAGE_SIZE = 250;
const DEFAULT_LIMIT = 20;
const MAX_LIMIT = 30;
const MAX_PRELIMINARY_CANDIDATES = 180;
const MAX_SUGGESTION_BRANDS = 6;
const COLD_FALLBACK_QUERY_LIMIT = 220;
const COLD_FALLBACK_BROWSE_LIMIT = 320;
const COLD_FALLBACK_MAX_QUERY_TERMS = 8;
const POPULAR_SEARCHES = ["Magnesium", "Vitamin D", "Omega-3", "Probiotic", "Ashwagandha"];
const SEARCH_BROWSE_CATEGORIES = [
  "All",
  "Vitamins",
  "Minerals",
  "Herbs",
  "Essential",
  "Amino Acids",
  "Probiotics",
  "Protein",
] as const;
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
  essential: "essential",
  essentials: "essential",
  amino: "amino_acid",
  aminoacid: "amino_acid",
  aminoacids: "amino_acid",
  "amino acid": "amino_acid",
  "amino acids": "amino_acid",
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
  essential: "Essential",
  amino_acid: "Amino Acids",
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
let cachedBrowseResponseMap:
  | {
      builtAt: number;
      responses: Map<string, ProductSearchResponse>;
      bootstrap: ProductSearchBootstrapResponse;
    }
  | null = null;
let cachedColdBootstrap:
  | {
      builtAt: number;
      payload: ProductSearchBootstrapResponse;
    }
  | null = null;

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

const SEARCH_QUERY_PHRASE_ALIASES: { pattern: RegExp; terms: string[] }[] = [
  {
    pattern: /\bcamellia sinensis\b/i,
    terms: ["camellia sinensis", "green tea", "matcha"],
  },
];

const SEARCH_QUERY_TOKEN_ALIASES: Record<string, string[]> = {
  sensoril: ["sensoril", "ashwagandha"],
  florafage: ["florafage", "floraphage"],
  floraphage: ["floraphage", "florafage"],
  matcha: ["matcha", "green tea"],
  d3: ["d3", "vitamin d"],
  cholecalciferol: ["cholecalciferol", "vitamin d"],
};

const SEARCH_QUERY_OPTIONAL_TOKENS = new Set([
  "support",
  "supplement",
  "formula",
  "capsule",
  "capsules",
  "tablet",
  "tablets",
  "softgel",
  "softgels",
  "gummy",
  "gummies",
  "with",
  "plus",
]);

const SEARCH_QUERY_OPTIONAL_GOAL_TOKENS = new Set([
  "stress",
  "sleep",
  "calm",
  "immune",
  "immunity",
  "focus",
  "energy",
  "recovery",
  "digestive",
  "digestion",
]);

const SEARCH_QUERY_OPTIONAL_DOSE_TOKEN_PATTERN =
  /^(?:\d+(?:[.,]\d+)?|\d+(?:[.,]\d+)?(?:mg|mcg|g|iu|ui|ml|oz|cfu)|mg|mcg|g|iu|ui|ml|oz|cfu)$/i;
const SEARCH_QUERY_EXACT_BOOST_PRIMARY_TERMS = new Set([
  "sensoril",
  "florafage",
  "floraphage",
  "d3",
  "cholecalciferol",
]);

const normalizeGroupTerms = (terms: string[]): string[] =>
  Array.from(
    new Set(
      terms
        .map((term) => normalizeLookupText(term))
        .filter(Boolean),
    ),
  );

const addQueryGroup = (groups: string[][], seenKeys: Set<string>, terms: string[]): void => {
  const normalizedTerms = normalizeGroupTerms(terms);
  if (normalizedTerms.length === 0) return;
  const key = normalizedTerms.join("|");
  if (seenKeys.has(key)) return;
  seenKeys.add(key);
  groups.push(normalizedTerms);
};

const isBarcodeLikeQueryToken = (token: string): boolean => /^\d{8,14}$/.test(token);

const normalizeBarcodeDigits = (value: unknown): string | null => {
  const raw = safeTrim(value);
  if (!raw || !/^[\d\s-]+$/.test(raw)) return null;
  const digits = raw.replace(/\D/g, "");
  return /^\d{8,14}$/.test(digits) ? digits : null;
};

const trimBarcodeLeadingZeros = (value: string): string => value.replace(/^0+/, "") || "0";

const barcodeDigitsMatch = (candidate: string | null, query: string): boolean => {
  if (!candidate) return false;
  if (candidate === query) return true;
  return trimBarcodeLeadingZeros(candidate) === trimBarcodeLeadingZeros(query);
};

export const getBarcodeExactSearchDigits = (query: string | null | undefined): string | null =>
  normalizeBarcodeDigits(query);

export const productSearchResponseHasExactBarcodeMatch = (
  response: ProductSearchResponse,
  query: string | null | undefined,
): boolean => {
  const queryDigits = getBarcodeExactSearchDigits(query);
  if (!queryDigits) return false;

  return response.supplements.some((card) =>
    [normalizeBarcodeDigits(card.barcode), normalizeBarcodeDigits(card.upcCode)].some((candidate) =>
      barcodeDigitsMatch(candidate, queryDigits),
    ),
  );
};

export const shouldUseColdBarcodeExactFallback = (
  response: ProductSearchResponse,
  params: Pick<SearchParams, "query">,
): boolean => Boolean(getBarcodeExactSearchDigits(params.query)) && !productSearchResponseHasExactBarcodeMatch(response, params.query);

const isOptionalQueryToken = (token: string): boolean => {
  if (SEARCH_QUERY_OPTIONAL_TOKENS.has(token)) return true;
  if (!SEARCH_QUERY_OPTIONAL_DOSE_TOKEN_PATTERN.test(token)) return false;
  return !isBarcodeLikeQueryToken(token);
};

export const buildSearchQueryPlan = (query: string | null | undefined): SearchQueryPlan => {
  const normalizedQuery = normalizeLookupText(query);
  if (!normalizedQuery) {
    return {
      normalizedQuery: "",
      requiredGroups: [],
      optionalGroups: [],
    };
  }

  const requiredGroups: string[][] = [];
  const optionalGroups: string[][] = [];
  const seenRequiredKeys = new Set<string>();
  const seenOptionalKeys = new Set<string>();

  let remaining = normalizedQuery;
  for (const { pattern, terms } of SEARCH_QUERY_PHRASE_ALIASES) {
    if (!pattern.test(remaining)) continue;
    addQueryGroup(requiredGroups, seenRequiredKeys, terms);
    remaining = remaining.replace(pattern, " ");
  }

  const tokens = remaining.split(" ").filter(Boolean);
  for (const token of tokens) {
    if (isOptionalQueryToken(token)) {
      continue;
    }

    if (SEARCH_QUERY_OPTIONAL_GOAL_TOKENS.has(token) && requiredGroups.length > 0) {
      addQueryGroup(optionalGroups, seenOptionalKeys, [token]);
      continue;
    }

    addQueryGroup(requiredGroups, seenRequiredKeys, SEARCH_QUERY_TOKEN_ALIASES[token] ?? [token]);
  }

  if (requiredGroups.length === 0 && optionalGroups.length > 0) {
    requiredGroups.push(...optionalGroups);
    optionalGroups.length = 0;
  }

  return {
    normalizedQuery,
    requiredGroups,
    optionalGroups,
  };
};

const buildBrowseCacheKey = (params: SearchParams): string => {
  const category = safeTrim(params.category) ?? "All";
  const page =
    Number.isFinite(params.page) && (params.page ?? 0) > 0 ? Math.floor(params.page as number) : 1;
  const limit = Math.min(
    MAX_LIMIT,
    Math.max(
      1,
      Number.isFinite(params.limit) && (params.limit ?? 0) > 0
        ? Math.floor(params.limit as number)
        : DEFAULT_LIMIT,
    ),
  );
  return `${category}::${page}::${limit}`;
};

const toPostgrestIlikeValue = (value: string | null | undefined): string | null => {
  const normalized = normalizeLookupText(value).replace(/[%_,]/g, " ").trim();
  return normalized.length > 0 ? normalized : null;
};

const isDigitsOnlyQueryTerm = (value: string): boolean => /^\d{8,14}$/.test(value);

export const buildColdFallbackOrClauses = (query: string | null | undefined): string[] => {
  const normalizedQuery = toPostgrestIlikeValue(query);
  if (!normalizedQuery) return [];

  const queryPlan = buildSearchQueryPlan(query);
  const candidateTerms = [
    normalizedQuery,
    ...queryPlan.requiredGroups.flatMap((group) => group),
  ];

  if (queryPlan.requiredGroups.length === 0) {
    candidateTerms.push(...normalizedQuery.split(/\s+/));
  }

  const normalizedTerms = Array.from(
    new Set(
      candidateTerms
        .map((term) => toPostgrestIlikeValue(term))
        .filter((term): term is string => Boolean(term)),
    ),
  ).slice(0, COLD_FALLBACK_MAX_QUERY_TERMS);

  const clauses: string[] = [];
  for (const term of normalizedTerms) {
    if (isDigitsOnlyQueryTerm(term)) {
      clauses.push(`upc_code.ilike.%${term}%`, `barcode_gtin14.ilike.%${term}%`);
      continue;
    }

    clauses.push(`title.ilike.%${term}%`, `brand_name.ilike.%${term}%`);
    if (term === normalizedQuery) {
      clauses.push(`upc_code.ilike.%${term}%`, `barcode_gtin14.ilike.%${term}%`);
    }
  }

  return Array.from(new Set(clauses));
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
  /\/overlay-label-assets\/(?:generated-fallback-cards|dsld-label-renders|manual-fallback-renders)\//i;
const INTERNAL_RENDER_FILENAME_PATTERN = /(?:^|[_-])render(?:s|ed)?(?:[_-]|\b)/i;

const isInternalRenderImageUrl = (value: string): boolean =>
  INTERNAL_RENDER_IMAGE_PATTERN.test(value) ||
  (/supabase\.co/i.test(value) && INTERNAL_RENDER_FILENAME_PATTERN.test(value)) ||
  /HAIR_GROWTH_RENDER/i.test(value);

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

  if (isInternalRenderImageUrl(value)) {
    return 0;
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
    .filter((candidate) => !isInternalRenderImageUrl(candidate))
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

const readPrimarySupplementFactsAmount = (supplementFacts: Record<string, unknown>): string | null => {
  const nutritionalFactsRaw = Array.isArray(supplementFacts.nutritionalFacts)
    ? supplementFacts.nutritionalFacts
    : Array.isArray(supplementFacts.nutritional_facts)
      ? supplementFacts.nutritional_facts
      : [];

  for (const entry of nutritionalFactsRaw) {
    const record = toObjectRecord(entry);
    const substance = safeTrim(record.substancy ?? record.substance ?? record.substance_name ?? record.name) ?? "";
    const amount = safeTrim(record.amountPerServing ?? record.amount_per_serving ?? record.amount);
    if (!amount) continue;
    if (/^calories?$/i.test(substance)) continue;
    if (/\b(?:calories?|kcal|cal)\b/i.test(amount)) continue;
    return amount;
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
  const primaryFactsAmount = readPrimarySupplementFactsAmount(supplementFacts);
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
    primaryFactsAmount,
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

const NON_DISPLAY_DOSAGE_INGREDIENT_NAME_PATTERN =
  /^(?:calories?|fat calories|total fat|saturated fat|trans fat|cholesterol|sodium|total carbohydrates?|dietary fiber|sugars?|added sugars?)$/i;

const DOSE_SUFFIX_NOISE_PATTERN =
  /\b(?:per\s+(?:capsule|capsules|tablet|tablets|softgel|softgels|serving|servings|gummy|gummies|packet|packets|stick|sticks|scoop|scoops|drop|drops|dropperful)|each)\b/gi;

const TITLE_DOSE_PATTERN = new RegExp(`(${DISPLAYABLE_DOSE_PATTERN.source})`, "i");
const TITLE_PACKAGE_SIZE_PATTERN =
  /\b\d[\d,]*(?:[.,]\d+)?\s*(?:lb|lbs|oz|fl\.?\s*oz|fluid ounces?)\s*(?:\(\s*\d[\d,]*(?:[.,]\d+)?\s*(?:mcg|μg|µg|ug|mg|g|ml)\s*\))?/gi;
const TYPE_PRIORITY: Record<SearchTypeKey, number> = {
  vitamin: 7,
  mineral: 6,
  probiotic: 5,
  essential: 4,
  amino_acid: 3,
  herb: 2,
  protein: 1,
};
const PROBIOTIC_SIGNAL_PATTERN = /\b(probiotic|lactobacillus|bifidobacter(?:ium)?|saccharomyces|prebiotic|cfu|biome)\b/;
const PROTEIN_SIGNAL_PATTERN =
  /\b(?:\w*protein|whey|casein|pea protein|rice protein|milk protein|hemp protein|bone broth protein|isolate|collagen peptides?)\b/;
const VITAMIN_SIGNAL_PATTERN =
  /\b(vitamin|multivitamin|multi\b|prenatal|ascorbic|cholecalciferol|ergocalciferol|tocopherol|retinol|folate|folic acid|cobalamin|niacin|thiamin|riboflavin|biotin|pantothenic|lutein|coq10|ubiquinol|ubiquinone|b[- ]?complex)\b/;
const MINERAL_SIGNAL_PATTERN =
  /\b(magnesium|zinc|calcium|iron|selenium|copper|chromium|potassium|iodine|manganese|electrolyte)\b/;
const HERB_SIGNAL_PATTERN =
  /\b(ashwagandha|rhodiola|turmeric|elderberry|bacopa|ginseng|garlic|maca|valerian|mushroom|lion'?s mane|reishi|cordyceps|botanical|herbal?|echinacea|ginger|cranberry|saffron|dandelion|black seed)\b/;
const AMINO_ACID_FALLBACK_PATTERN =
  /\b(creatine|taurine|theanine|carnitine|bcaa|eaa|amino acid|amino acids|nac|n acetyl cysteine|glutamine|glycine|glutathione|arginine|citrulline|ornithine|5-htp|tryptophan|lysine|tyrosine|citicoline|cdp choline|alpha gpc|gaba|betaine|acetyl l carnitine)\b/;
const ESSENTIAL_FALLBACK_PATTERN =
  /\b(omega 3|omega3|fish oil|krill oil|cod liver oil|dha|epa|essential fatty|borage oil|evening primrose|flax oil|gla|mct oil|calanus oil|algae omega|omega 7|omega-7|black seed oil|cla)\b/;
const PROBIOTIC_DOSE_UNIT_PATTERN = /\b(?:cfu|billion(?:\s+cfu)?|million(?:\s+cfu)?|trillion(?:\s+cfu)?)\b/i;

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

const parseDoseMagnitude = (value: string | null | undefined): number | null => {
  const match = normalizeDoseLabel(String(value ?? "")).match(/[<>~]?\s*([\d,]+(?:[.,]\d+)?)/);
  if (!match?.[1]) return null;
  const parsed = Number.parseFloat(match[1].replace(/,/g, ""));
  return Number.isFinite(parsed) ? parsed : null;
};

const buildTitleSignalTokens = (title: string): string[] =>
  Array.from(
    new Set(
      normalizeLookupText(title)
        .split(" ")
        .filter(
          (token) =>
            token.length >= 4 &&
            !/^\d/.test(token) &&
            !/^(capsule|capsules|tablet|tablets|softgel|softgels|powder|flavor|vegan|pack|packets|count|liquid)$/i.test(
              token,
            ),
        ),
    ),
  );

const getDoseUnit = (value: string | null | undefined): string | null => {
  const normalized = normalizeDoseLabel(String(value ?? ""));
  const match = normalized.match(
    /\b(mcg|μg|µg|ug|mg|g|iu|ui|ml|cfu|billion(?:\s+cfu)?|million(?:\s+cfu)?|trillion(?:\s+cfu)?)\b/i,
  );
  return match?.[1]?.toLowerCase() ?? null;
};

const computeDoseCandidateScore = (
  row: ProductSearchIndexRow,
  ingredient: SearchIngredientRow,
  typeKey: SearchTypeKey | null,
): number => {
  const name = normalizeLookupText(ingredient.name);
  if (!name || NON_DISPLAY_DOSAGE_INGREDIENT_NAME_PATTERN.test(name)) return Number.NEGATIVE_INFINITY;

  const displayDose = getDisplayDose(ingredient.dose);
  if (!displayDose) return Number.NEGATIVE_INFINITY;

  const magnitude = parseDoseMagnitude(displayDose);
  if (magnitude !== null && magnitude <= 0) return Number.NEGATIVE_INFINITY;
  const unit = getDoseUnit(displayDose);

  let score = 0;
  const titleTokens = buildTitleSignalTokens(row.title);
  if (titleTokens.some((token) => name.includes(token))) score += 5;

  if (typeKey === "probiotic" && PROBIOTIC_SIGNAL_PATTERN.test(name)) score += 8;
  if (typeKey === "protein" && PROTEIN_SIGNAL_PATTERN.test(name)) score += 8;
  if (typeKey === "vitamin" && VITAMIN_SIGNAL_PATTERN.test(name)) score += 8;
  if (typeKey === "mineral" && MINERAL_SIGNAL_PATTERN.test(name)) score += 8;
  if (typeKey === "herb" && HERB_SIGNAL_PATTERN.test(name)) score += 8;
  if (typeKey === "protein" && unit === "g") score += 6;
  if (typeKey === "protein" && (unit === "mg" || unit === "mcg" || unit === "ug")) score -= 4;

  if (
    ESSENTIAL_FALLBACK_PATTERN.test(normalizeLookupText(row.title)) &&
    /\b(epa|dha|omega|fish oil|krill|borage|gla|primrose|cod liver|flax)\b/.test(name)
  )
    score += 7;
  if (AMINO_ACID_FALLBACK_PATTERN.test(normalizeLookupText(row.title)) && AMINO_ACID_FALLBACK_PATTERN.test(name))
    score += 7;
  if (/\bblend\b/.test(name)) score += 2;

  return score + 1;
};

const extractTitleDisplayDose = (title: string): string | null => {
  const cleanedTitle = normalizeDoseLabel(title.replace(TITLE_PACKAGE_SIZE_PATTERN, " "));
  const match = cleanedTitle.match(TITLE_DOSE_PATTERN);
  if (!match?.[1]) return null;
  return getDisplayDose(match[1]);
};

const pickDisplayDose = (row: ProductSearchIndexRow, typeKey: SearchTypeKey | null): string => {
  const titleDose = extractTitleDisplayDose(row.title);
  if (typeKey === "probiotic" && titleDose && PROBIOTIC_DOSE_UNIT_PATTERN.test(titleDose)) {
    return titleDose;
  }
  if (typeKey === "protein" && titleDose) return titleDose;
  if (titleDose) return titleDose;

  const ingredientCandidates = row.ingredients
    .map((ingredient) => ({
      ingredient,
      score: computeDoseCandidateScore(row, ingredient, typeKey),
      displayDose: getDisplayDose(ingredient.dose),
      unit: getDoseUnit(ingredient.dose),
    }))
    .filter((entry) => Number.isFinite(entry.score) && entry.displayDose);

  if (typeKey === "protein") {
    const proteinNamedGramCandidate = ingredientCandidates
      .filter(
        (entry) =>
          entry.unit === "g" && PROTEIN_SIGNAL_PATTERN.test(normalizeLookupText(entry.ingredient.name)),
      )
      .sort((left, right) => right.score - left.score)[0];

    if (proteinNamedGramCandidate?.displayDose) {
      return proteinNamedGramCandidate.displayDose;
    }

    const servingDose = getDisplayDose(row.servingSize);
    if (getDoseUnit(servingDose) === "g") {
      return servingDose as string;
    }

    const gramCandidate = ingredientCandidates
      .filter((entry) => entry.unit === "g")
      .sort((left, right) => right.score - left.score)[0];
    if (gramCandidate?.displayDose) {
      return gramCandidate.displayDose;
    }
  }

  const bestIngredient = ingredientCandidates.sort((left, right) => right.score - left.score)[0];

  if (bestIngredient?.displayDose) {
    return bestIngredient.displayDose;
  }

  for (const ingredient of row.ingredients) {
    if (NON_DISPLAY_DOSAGE_INGREDIENT_NAME_PATTERN.test(ingredient.name.trim())) continue;
    const displayDose = getDisplayDose(ingredient.dose);
    if (displayDose) return displayDose;
  }

  const primaryFactsDose = getDisplayDose(row.primaryFactsAmount);
  if (primaryFactsDose) return primaryFactsDose;

  if (titleDose) return titleDose;

  return getDisplayDose(row.servingSize) ?? "";
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
  categories: string[];
  ingredients: SearchIngredientRow[];
}): SearchTypeKey[] => {
  const titleHaystack = normalizeLookupText([input.title, input.brandName, ...input.categories].join(" "));
  const ingredientHaystack = normalizeLookupText(input.ingredients.map((ingredient) => ingredient.name).join(" "));
  const contextHaystack = normalizeLookupText([input.description ?? "", input.suggestedUse ?? ""].join(" "));

  const scores = new Map<SearchTypeKey, number>();
  const addScore = (key: SearchTypeKey, amount: number) => {
    scores.set(key, (scores.get(key) ?? 0) + amount);
  };

  if (PROBIOTIC_SIGNAL_PATTERN.test(titleHaystack)) addScore("probiotic", 8);
  if (PROBIOTIC_SIGNAL_PATTERN.test(ingredientHaystack)) addScore("probiotic", 6);
  if (PROBIOTIC_SIGNAL_PATTERN.test(contextHaystack)) addScore("probiotic", 3);

  if (PROTEIN_SIGNAL_PATTERN.test(titleHaystack)) addScore("protein", 8);
  if (PROTEIN_SIGNAL_PATTERN.test(ingredientHaystack)) addScore("protein", 6);

  if (VITAMIN_SIGNAL_PATTERN.test(titleHaystack)) addScore("vitamin", 8);
  if (VITAMIN_SIGNAL_PATTERN.test(ingredientHaystack)) addScore("vitamin", 6);
  if (VITAMIN_SIGNAL_PATTERN.test(contextHaystack)) addScore("vitamin", 2);

  if (MINERAL_SIGNAL_PATTERN.test(titleHaystack)) addScore("mineral", 8);
  if (MINERAL_SIGNAL_PATTERN.test(ingredientHaystack)) addScore("mineral", 6);
  if (MINERAL_SIGNAL_PATTERN.test(contextHaystack)) addScore("mineral", 2);

  if (ESSENTIAL_FALLBACK_PATTERN.test(titleHaystack)) addScore("essential", 8);
  if (ESSENTIAL_FALLBACK_PATTERN.test(ingredientHaystack)) addScore("essential", 6);
  if (ESSENTIAL_FALLBACK_PATTERN.test(contextHaystack)) addScore("essential", 3);

  if (AMINO_ACID_FALLBACK_PATTERN.test(titleHaystack)) addScore("amino_acid", 8);
  if (AMINO_ACID_FALLBACK_PATTERN.test(ingredientHaystack)) addScore("amino_acid", 6);
  if (AMINO_ACID_FALLBACK_PATTERN.test(contextHaystack)) addScore("amino_acid", 2);

  if (HERB_SIGNAL_PATTERN.test(titleHaystack)) addScore("herb", 8);
  if (HERB_SIGNAL_PATTERN.test(ingredientHaystack)) addScore("herb", 6);
  if (HERB_SIGNAL_PATTERN.test(contextHaystack)) addScore("herb", 2);

  return Array.from(scores.entries())
    .filter(([, score]) => score > 0)
    .sort((left, right) => {
      const scoreDelta = right[1] - left[1];
      if (scoreDelta !== 0) return scoreDelta;
      return TYPE_PRIORITY[right[0]] - TYPE_PRIORITY[left[0]];
    })
    .map(([key]) => key);
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
  if (AMINO_ACID_FALLBACK_PATTERN.test(haystack)) {
    return "Amino Acids";
  }
  return "Supplement";
};

const resolveCardCategoryLabel = (input: {
  primaryTypeKey: SearchTypeKey | null;
  fallbackCategory: string;
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

  if (input.primaryTypeKey) return TYPE_KEY_TO_CARD_CATEGORY[input.primaryTypeKey];
  if (ESSENTIAL_FALLBACK_PATTERN.test(haystack)) return "Essential";
  if (AMINO_ACID_FALLBACK_PATTERN.test(haystack)) return "Amino Acids";
  return input.fallbackCategory;
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

const scoreSearchTermMatch = (
  row: ProductSearchIndexRow,
  term: string,
): number => {
  const title = normalizeLookupText(row.title);
  const brand = normalizeLookupText(row.brandName);
  const categories = normalizeLookupText(row.categories.join(" "));
  const ingredientNames = normalizeLookupText(row.ingredients.map((ingredient) => ingredient.name).join(" "));
  const normalizedTerm = normalizeLookupText(term);
  if (!normalizedTerm) return 0;

  if (!row.searchText.includes(normalizedTerm)) return 0;

  if (title.startsWith(normalizedTerm)) return 36;
  if (title.includes(normalizedTerm)) return 24;
  if (brand.startsWith(normalizedTerm)) return 18;
  if (brand.includes(normalizedTerm)) return 14;
  if (categories.includes(normalizedTerm)) return 10;
  if (ingredientNames.includes(normalizedTerm)) return 8;
  return 4;
};

export const computeSearchScoreForQueryPlan = (
  row: ProductSearchIndexRow,
  plan: SearchQueryPlan,
): number => {
  if (plan.requiredGroups.length === 0 && plan.optionalGroups.length === 0) return 0;

  let score = 0;
  for (const group of plan.requiredGroups) {
    const primaryTerm = group[0] ?? "";
    const primaryScore = primaryTerm ? scoreSearchTermMatch(row, primaryTerm) : 0;
    let bestGroupScore = group.reduce((best, term) => Math.max(best, scoreSearchTermMatch(row, term)), 0);
    if (bestGroupScore === 0) return 0;
    if (primaryScore > 0 && SEARCH_QUERY_EXACT_BOOST_PRIMARY_TERMS.has(primaryTerm)) {
      bestGroupScore += 12;
    }
    score += bestGroupScore;
  }

  for (const group of plan.optionalGroups) {
    const bestGroupScore = group.reduce((best, term) => Math.max(best, scoreSearchTermMatch(row, term)), 0);
    if (bestGroupScore > 0) {
      score += Math.max(2, Math.floor(bestGroupScore / 2));
    }
  }

  return score;
};

const planIncludesTerm = (plan: SearchQueryPlan, term: string): boolean =>
  plan.requiredGroups.some((group) => group.includes(term)) ||
  plan.optionalGroups.some((group) => group.includes(term));

export const computeSearchQueryIntentBonus = (
  row: ProductSearchIndexRow,
  typeKey: SearchTypeKey | null,
  plan: SearchQueryPlan,
): number => {
  const visibleHaystack = normalizeLookupText(row.title);
  if (!visibleHaystack) return 0;

  const isGreenTeaFamilyQuery =
    plan.normalizedQuery.includes("matcha") &&
    (plan.normalizedQuery.includes("camellia sinensis") || planIncludesTerm(plan, "green tea"));
  if (!isGreenTeaFamilyQuery) return 0;

  const hasMatcha = visibleHaystack.includes("matcha");
  const hasGreenTeaFamilySignal =
    visibleHaystack.includes("green tea") || visibleHaystack.includes("camellia sinensis");

  if (hasMatcha && hasGreenTeaFamilySignal) return 70;
  if (hasGreenTeaFamilySignal) return 24;
  if (hasMatcha && (typeKey === "protein" || typeKey === "amino_acid")) return -12;
  return 0;
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

const enrichSearchRow = (
  row: ProductSearchIndexRow,
  baseSearchScore: number,
  queryPlan: SearchQueryPlan | null = null,
): EnrichedCandidate => {
  const factsStatus = deriveFactsStatus(row.ingredients);
  const typeKeys = deriveTypeKeysFromContent({
    title: row.title,
    brandName: row.brandName,
    description: row.description,
    suggestedUse: row.suggestedUse,
    categories: row.categories,
    ingredients: row.ingredients,
  });
  const primaryTypeKey = typeKeys[0] ?? null;
  const fallbackCategory = getFallbackCardCategory({
    title: row.title,
    description: row.description,
    suggestedUse: row.suggestedUse,
    ingredients: row.ingredients,
  });
  const categoryLabel = resolveCardCategoryLabel({
    primaryTypeKey,
    fallbackCategory,
    title: row.title,
    description: row.description,
    suggestedUse: row.suggestedUse,
    ingredients: row.ingredients,
  });
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
  const queryIntentBonus = queryPlan ? computeSearchQueryIntentBonus(row, primaryTypeKey, queryPlan) : 0;
  const finalSearchScore =
    baseSearchScore +
    (goalChoice.tier !== "no_match" && baseSearchScore > 0 ? 3 : 0) +
    queryIntentBonus;

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
      upcCode: row.upcCode,
      name: normalizeDisplayTitle(row.title, row.brandName),
      brand: row.brandName,
      category: categoryLabel,
      categoryKey: primaryTypeKey,
      benefit,
      dose: pickDisplayDose(row, primaryTypeKey),
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
const SUPPLEMENT_FORM_TITLE_PATTERN =
  /\b(?:capsules?|vcaps?|veggie\s+caps?|vegan\s+capsules?|tablets?|softgels?|extract|per\s+capsule|per\s+tablet|dietary\s+supplement)\b/;

export const isLikelyNonSupplementTitle = (
  name: string | null | undefined,
  description: string | null | undefined,
): boolean => {
  const normalizedName = normalizeLookupText(name);
  if (!NON_SUPPLEMENT_TITLE_PATTERN.test(normalizedName)) return false;
  if (SUPPLEMENT_FORM_TITLE_PATTERN.test(normalizedName)) return false;
  return !/\bsupplement\b/.test(normalizeLookupText(`${name ?? ""} ${description ?? ""}`));
};

const isLikelyNonSupplement = (item: EnrichedCandidate): boolean =>
  isLikelyNonSupplementTitle(item.card.name, item.row.description);

export const shouldAllowExactBarcodeNonSupplementResult = (params: {
  name: string | null | undefined;
  description: string | null | undefined;
  barcode: string | null | undefined;
  upcCode: string | null | undefined;
  query: string | null | undefined;
}): boolean => {
  if (!isLikelyNonSupplementTitle(params.name, params.description)) return false;
  const queryDigits = getBarcodeExactSearchDigits(params.query);
  if (!queryDigits) return false;
  return [normalizeBarcodeDigits(params.barcode), normalizeBarcodeDigits(params.upcCode)].some((candidate) =>
    barcodeDigitsMatch(candidate, queryDigits),
  );
};

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
      rebuildWarmBrowseResponseMap(index);
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

export const warmProductSearchIndex = (): void => {
  warmSearchIndexInBackground();
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
  const fallbackOrClauses = buildColdFallbackOrClauses(params.query);
  const brandLike = toPostgrestIlikeValue(params.brand);
  const hasQuery = fallbackOrClauses.length > 0;
  const shouldUsePopularBrandBrowse = !hasQuery && !brandLike;

  let query = supabase
    .from("iherb_overlay_products")
    .select(OVERLAY_SEARCH_SELECT)
    .order("updated_at", { ascending: false })
    .limit(hasQuery ? COLD_FALLBACK_QUERY_LIMIT : COLD_FALLBACK_BROWSE_LIMIT);

  if (brandLike) {
    query = query.ilike("brand_name", `%${brandLike}%`);
  }

  if (fallbackOrClauses.length > 0) {
    query = query.or(fallbackOrClauses.join(","));
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
  const queryPlan = buildSearchQueryPlan(params.query);
  const hasQuery =
    queryPlan.requiredGroups.length > 0 || queryPlan.optionalGroups.length > 0;
  const normalizedBrandFilter = normalizeLookupText(params.brand);
  const categoryTypeKey = categoryFilterToTypeKey(params.category);

  let preliminary = rows
    .filter((row) =>
      normalizedBrandFilter ? normalizeLookupText(row.brandName).includes(normalizedBrandFilter) : true,
    )
    .map((row) => ({
      row,
      baseSearchScore: hasQuery ? computeSearchScoreForQueryPlan(row, queryPlan) : 0,
    }))
    .filter((entry) => (hasQuery ? entry.baseSearchScore > 0 : true));

  preliminary.sort((left, right) => {
    if (hasQuery) {
      const scoreDelta = right.baseSearchScore - left.baseSearchScore;
      if (scoreDelta !== 0) return scoreDelta;
    }

    const popularityDelta = right.row.brandPopularity - left.row.brandPopularity;
    if (popularityDelta !== 0) return popularityDelta;
    return left.row.title.localeCompare(right.row.title);
  });

  const shortlistCap = hasQuery ? MAX_PRELIMINARY_CANDIDATES : 1200;
  const shortlisted = preliminary.slice(0, shortlistCap);
  let enriched = shortlisted.map((entry) => enrichSearchRow(entry.row, entry.baseSearchScore, queryPlan));

  if (categoryTypeKey) {
    enriched = enriched.filter((entry) => entry.typeKey === categoryTypeKey);
  }

  enriched.sort((left, right) => sortCandidates(left, right, hasQuery));
  enriched = dedupeCandidates(enriched);
  enriched = enriched.filter((entry) =>
    !isLikelyNonSupplement(entry) ||
    shouldAllowExactBarcodeNonSupplementResult({
      name: entry.card.name,
      description: entry.row.description,
      barcode: entry.card.barcode,
      upcCode: entry.card.upcCode,
      query: params.query,
    }),
  );
  if (!hasQuery) {
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
      categories: [...SEARCH_BROWSE_CATEGORIES],
      brands: topBrands,
      popularSearches: POPULAR_SEARCHES,
    },
  };
};

const useColdBarcodeExactFallbackIfNeeded = async (
  response: ProductSearchResponse,
  params: SearchParams,
): Promise<ProductSearchResponse> => {
  if (!shouldUseColdBarcodeExactFallback(response, params)) return response;

  const fallbackRows = await fetchColdFallbackRows(params);
  const fallbackResponse = buildSearchResponseFromRows(fallbackRows, params);
  if (!productSearchResponseHasExactBarcodeMatch(fallbackResponse, params.query)) return response;

  console.info("[product-search] using cold barcode exact fallback after warm index miss", {
    query: getBarcodeExactSearchDigits(params.query),
  });
  return fallbackResponse;
};

const buildBootstrapPayloadFromRows = (rows: ProductSearchIndexRow[]): ProductSearchBootstrapResponse => ({
  generatedAt: Date.now(),
  categories: Object.fromEntries(
    SEARCH_BROWSE_CATEGORIES.map((category) => {
      const params: SearchParams = {
        query: "",
        category: category === "All" ? null : category,
        page: 1,
        limit: DEFAULT_LIMIT,
      };
      return [category, buildSearchResponseFromRows(rows, params).supplements];
    }),
  ),
});

const rebuildWarmBrowseResponseMap = (index: ProductSearchIndex): void => {
  const responses = new Map<string, ProductSearchResponse>();

  for (const category of SEARCH_BROWSE_CATEGORIES) {
    const params: SearchParams = {
      query: "",
      category: category === "All" ? null : category,
      page: 1,
      limit: DEFAULT_LIMIT,
    };
    const response = buildSearchResponseFromRows(index.rows, params);
    responses.set(buildBrowseCacheKey(params), response);
  }

  cachedBrowseResponseMap = {
    builtAt: index.builtAt,
    responses,
    bootstrap: buildBootstrapPayloadFromRows(index.rows),
  };
};

const getWarmBrowseResponse = (params: SearchParams): ProductSearchResponse | null => {
  if (safeTrim(params.query) || safeTrim(params.brand)) return null;
  const page =
    Number.isFinite(params.page) && (params.page ?? 0) > 0 ? Math.floor(params.page as number) : 1;
  const limit = Math.min(
    MAX_LIMIT,
    Math.max(
      1,
      Number.isFinite(params.limit) && (params.limit ?? 0) > 0
        ? Math.floor(params.limit as number)
        : DEFAULT_LIMIT,
    ),
  );
  if (page !== 1 || limit !== DEFAULT_LIMIT) return null;

  if (!cachedBrowseResponseMap) return null;
  if (cachedSearchIndex && cachedBrowseResponseMap.builtAt !== cachedSearchIndex.builtAt) {
    return null;
  }
  return cachedBrowseResponseMap.responses.get(buildBrowseCacheKey(params)) ?? null;
};

export const getProductSearchBootstrap = async (): Promise<ProductSearchBootstrapResponse> => {
  const warmIndex = getUsableSearchIndex();
  if (warmIndex && cachedBrowseResponseMap?.builtAt === warmIndex.builtAt) {
    return cachedBrowseResponseMap.bootstrap;
  }
  if (warmIndex) {
    if (!cachedBrowseResponseMap || cachedBrowseResponseMap.builtAt !== warmIndex.builtAt) {
      rebuildWarmBrowseResponseMap(warmIndex);
    }
    return cachedBrowseResponseMap!.bootstrap;
  }

  const now = Date.now();
  if (cachedColdBootstrap && now - cachedColdBootstrap.builtAt < COLD_BOOTSTRAP_TTL_MS) {
    warmSearchIndexInBackground();
    return cachedColdBootstrap.payload;
  }

  warmSearchIndexInBackground();
  const fallbackRows = await fetchColdFallbackRows({ query: "", page: 1, limit: DEFAULT_LIMIT });
  const payload = buildBootstrapPayloadFromRows(fallbackRows);
  cachedColdBootstrap = {
    builtAt: Date.now(),
    payload,
  };
  return payload;
};

export const searchProducts = async (params: SearchParams): Promise<ProductSearchResponse> => {
  const warmBrowseResponse = getWarmBrowseResponse(params);
  if (warmBrowseResponse) {
    return warmBrowseResponse;
  }

  const index = getUsableSearchIndex();
  if (index) {
    if (!cachedBrowseResponseMap || cachedBrowseResponseMap.builtAt !== index.builtAt) {
      rebuildWarmBrowseResponseMap(index);
    }
    const response = buildSearchResponseFromRows(index.rows, params);
    return useColdBarcodeExactFallbackIfNeeded(response, params);
  }

  console.info("[product-search] using cold fallback while warming full index", {
    query: safeTrim(params.query) ?? null,
    category: safeTrim(params.category) ?? null,
    brand: safeTrim(params.brand) ?? null,
  });

  const fallbackRows = await fetchColdFallbackRows(params);
  return buildSearchResponseFromRows(fallbackRows, params);
};
