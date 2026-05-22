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
  | "gut_health"
  | "weight_management"
  | "libido_enhancement";
type SearchGoalTier = "strong_match" | "related" | "weak_match" | "no_match";
type FactsStatus = "full" | "partial" | "none";
type CoverageStatus = "coverage_ready" | "not_enough_structured_data";
export type ProductSearchResultTier = "analysis_ready" | "basic_catalog" | "needs_label_verification";

export type ProductSearchCatalogStats = {
  totalRecords: number;
  analysisReadyTotal: number;
  displayTotalRecordsLabel: string;
  displayAnalysisReadyLabel: string;
};

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

type ProductSearchIndexTableRow = {
  id?: number | null;
  overlay_id?: number | null;
  product_id?: string | null;
  upc_code?: string | null;
  barcode_gtin14?: string | null;
  brand_name?: string | null;
  title?: string | null;
  image_url?: string | null;
  categories?: unknown;
  ingredients?: unknown;
  primary_facts_amount?: string | null;
  serving_size?: string | null;
  description?: string | null;
  suggested_use?: string | null;
  search_text?: string | null;
  ingredient_families?: unknown;
  form_signals?: unknown;
  strength_signals?: unknown;
  facts_status?: string | null;
  coverage_status?: string | null;
  brand_popularity?: number | null;
  quality_rank?: number | null;
  source_updated_at?: string | null;
  indexed_at?: string | null;
};

type ProductSearchHomeCacheTableRow = {
  payload?: unknown;
  indexed_rows?: number | null;
  source_indexed_at?: string | null;
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
  ingredientFamilies: string[];
  formSignals: string[];
  strengthSignals: string[];
  factsStatus: FactsStatus;
  coverageStatus: CoverageStatus;
  brandPopularity: number;
  qualityRank: number;
};

type ProductSearchIndex = {
  builtAt: number;
  rows: ProductSearchIndexRow[];
  catalogStats?: ProductSearchCatalogStats;
};

export type SearchQueryPlan = {
  normalizedQuery: string;
  requiredGroups: string[][];
  optionalGroups: string[][];
};

export type SearchQueryIntentKind =
  | "exact_barcode"
  | "exact_product"
  | "brand_product"
  | "ingredient_family"
  | "form_dose"
  | "benefit_goal"
  | "category_browse"
  | "discovery";

export type SearchRelevanceTier = 0 | 1 | 2 | 3 | 4;

export type SearchQueryIntent = {
  kind: SearchQueryIntentKind;
  normalizedQuery: string;
  barcodeDigits: string | null;
  brandLead: string | null;
  brandHint: string | null;
  coreTerms: string[];
  ingredientFamilies: string[];
  ingredientFormSignals: string[];
  packageFormSignals: string[];
  strengthSignals: string[];
  benefitGoalKey: SearchGoalKey | "joint_support" | null;
  categoryTypeKey: SearchTypeKey | null;
  isBroad: boolean;
};

export type SearchRelevanceTierResult = {
  tier: SearchRelevanceTier;
  reason: "exact_barcode" | "exact_title" | "brand_product" | "ingredient_form_or_dose" | "ingredient_family" | "adjacent" | "fallback";
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
  matchReason?: string | null;
  factsStatus: FactsStatus;
  coverageStatus: CoverageStatus;
  resultTier: ProductSearchResultTier;
  resultTierLabel: string;
  resultTierDescription: string | null;
};

export type ProductSearchResponse = {
  supplements: ProductSearchCard[];
  pagination: {
    total: number;
    page: number;
    limit: number;
    totalPages: number;
    hasMore: boolean;
    nextPage: number | null;
    shown: number;
    totalIsExact: boolean;
  };
  suggestions: {
    categories: string[];
    brands: string[];
    popularSearches: string[];
  };
  catalogStats: ProductSearchCatalogStats;
};

export type ProductSearchBootstrapResponse = {
  generatedAt: number;
  categories: Record<string, ProductSearchCard[]>;
  paginationByCategory?: Record<string, ProductSearchResponse["pagination"]>;
  catalogStats: ProductSearchCatalogStats;
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
  relevanceTier: SearchRelevanceTier;
  relevanceTierReason: SearchRelevanceTierResult["reason"];
};

const SEARCH_INDEX_TTL_MS = 15 * 60 * 1000;
const COLD_BOOTSTRAP_TTL_MS = 5 * 60 * 1000;
const COLD_SEARCH_RESPONSE_TTL_MS = 2 * 60 * 1000;
const PERSISTED_HOME_CACHE_TTL_MS = 5 * 60 * 1000;
const OVERLAY_PAGE_SIZE = 1000;
const DEFAULT_LIMIT = 20;
const MAX_LIMIT = 30;
export const PRODUCT_SEARCH_BROWSE_BOOTSTRAP_LIMIT = 120;
const MAX_PRELIMINARY_CANDIDATES = 180;
const MAX_SUGGESTION_BRANDS = 6;
const COLD_FALLBACK_QUERY_LIMIT = 220;
const COLD_FALLBACK_BROWSE_LIMIT = 1200;
const COLD_FALLBACK_MAX_QUERY_TERMS = 8;
const COLD_INDEX_MIN_CANDIDATES_BEFORE_EXPAND = 60;
const PRODUCT_SEARCH_CATALOG_STATS_TTL_MS = 5 * 60 * 1000;
const POPULAR_SEARCHES = ["Magnesium", "Vitamin D", "Omega-3", "Probiotic", "Ashwagandha"];
export const DEFAULT_PRODUCT_SEARCH_WARM_QUERIES = [
  "magnesium",
  "magnesium glycinate",
  "vitamin d",
  "D3 1000 IU",
  "omega-3",
  "fish oil epa dha",
  "probiotic",
  "ashwagandha stress",
  "B12 methylcobalamin",
  "selenium thyroid support",
  "gut health",
  "mood support",
  "Doctors Best high absorption magnesium",
  "Nordic Naturals omega 3",
  "Sports Research omega-3",
] as const;
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
const PRODUCT_SEARCH_LIST_INDEX_SELECT =
  "id,overlay_id,product_id,upc_code,barcode_gtin14,brand_name,title,image_url,categories,ingredients,primary_facts_amount,serving_size,search_text,ingredient_families,form_signals,strength_signals,facts_status,coverage_status,brand_popularity,quality_rank,source_updated_at,indexed_at";
const PRODUCT_SEARCH_HOME_CACHE_KEY = "default";
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
const KNOWN_SEARCH_BRAND_ALIASES = [
  ...POPULAR_FALLBACK_BRANDS,
  "Jamieson",
  "Webber Naturals",
  "Natural Factors",
  "Organika",
  "AOR",
  "Progressive",
  "Platinum Naturals",
  "Botanica",
  "New Roots Herbal",
  "CanPrev",
  "Thorne",
  "Life Extension",
  "Jarrow Formulas",
  "Doctor's Best",
  "Doctors Best",
  "Kirkland Signature",
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
  gut_health: "Gut & Digestive Support",
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
  gut_health: ["gut", "digestive", "digestion", "microbiome", "prebiotic"],
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
    strong: [/\bashwagandha\b/, /\brhodiola\b/, /\bmood support\b/, /\bst\.?\s+john'?s\s+wort\b/],
    related: [/\bstress\b/, /\bcalm\b/, /\bmood\b/, /\bmagnesium\b/, /\btheanine\b/],
  },
  {
    key: "gut_health",
    benefit: GOAL_BENEFIT_COPY.gut_health,
    strong: [
      /\bprobiotics?\b/,
      /\bprebiotics?\b/,
      /\bdigestive enzymes?\b/,
      /\bmicrobiome\b/,
      /\binulin\b/,
      /\bacacia\b/,
      /\bpsyllium\b/,
    ],
    related: [/\bgut\b/, /\bdigestive\b/, /\bdigestion\b/, /\bfiber\b/],
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
let cachedPersistedHomeBootstrap:
  | {
      builtAt: number;
      payload: ProductSearchBootstrapResponse;
    }
  | null = null;
let cachedCatalogStats:
  | {
      builtAt: number;
      payload: ProductSearchCatalogStats;
    }
  | null = null;
let inflightCatalogStats: Promise<ProductSearchCatalogStats> | null = null;
let inflightColdBootstrap: Promise<ProductSearchBootstrapResponse> | null = null;
const cachedColdSearchResponses = new Map<
  string,
  {
    builtAt: number;
    payload: ProductSearchResponse;
  }
>();
const inflightColdSearchResponses = new Map<string, Promise<ProductSearchResponse>>();

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

const normalizeBrandComparableText = (value: string | null | undefined): string =>
  normalizeLookupText(value).replace(/\b([a-z]+) s\b/g, "$1s");

const formatSearchCount = (value: number): string =>
  new Intl.NumberFormat("en-US", { maximumFractionDigits: 0 }).format(Math.max(0, Math.floor(value)));

const formatCatalogTotalLabel = (value: number): string => {
  const normalized = Math.max(0, Math.floor(value));
  if (normalized >= 10000) {
    return `${formatSearchCount(Math.floor(normalized / 10000) * 10000)}+`;
  }
  if (normalized >= 1000) {
    return `${formatSearchCount(Math.floor(normalized / 1000) * 1000)}+`;
  }
  return formatSearchCount(normalized);
};

const normalizeCatalogStats = (stats: {
  totalRecords: number;
  analysisReadyTotal: number;
}): ProductSearchCatalogStats => {
  const totalRecords = Math.max(0, Math.floor(stats.totalRecords));
  const analysisReadyTotal = Math.max(0, Math.floor(stats.analysisReadyTotal));

  return {
    totalRecords,
    analysisReadyTotal,
    displayTotalRecordsLabel: formatCatalogTotalLabel(totalRecords),
    displayAnalysisReadyLabel: formatSearchCount(analysisReadyTotal),
  };
};

const getProductSearchResultTier = (
  value: Pick<ProductSearchIndexRow, "factsStatus" | "coverageStatus">,
): ProductSearchResultTier => {
  if (value.coverageStatus === "coverage_ready" && value.factsStatus === "full") {
    return "analysis_ready";
  }
  if (value.factsStatus === "partial") return "basic_catalog";
  return "needs_label_verification";
};

const getProductSearchResultTierLabel = (tier: ProductSearchResultTier): string => {
  switch (tier) {
    case "analysis_ready":
      return "Ready for full analysis";
    case "basic_catalog":
      return "Basic record";
    case "needs_label_verification":
      return "Needs label verification";
  }
};

const getProductSearchResultTierDescription = (tier: ProductSearchResultTier): string | null =>
  tier === "analysis_ready" ? null : "Not enough label detail for full analysis";

const PRODUCT_SEARCH_RESULT_TIER_RANK: Record<ProductSearchResultTier, number> = {
  analysis_ready: 0,
  basic_catalog: 1,
  needs_label_verification: 2,
};

const compareProductSearchResultTier = (left: ProductSearchCard, right: ProductSearchCard): number =>
  PRODUCT_SEARCH_RESULT_TIER_RANK[left.resultTier] - PRODUCT_SEARCH_RESULT_TIER_RANK[right.resultTier];

const isAnalysisReadySearchRow = (
  value: Pick<ProductSearchIndexRow, "factsStatus" | "coverageStatus">,
): boolean => getProductSearchResultTier(value) === "analysis_ready";

const isAnalysisReadySearchCard = (
  value: Pick<ProductSearchCard, "factsStatus" | "coverageStatus">,
): boolean => getProductSearchResultTier(value) === "analysis_ready";

const buildCatalogStatsFromRows = (rows: ProductSearchIndexRow[]): ProductSearchCatalogStats =>
  normalizeCatalogStats({
    totalRecords: rows.length,
    analysisReadyTotal: rows.filter(isAnalysisReadySearchRow).length,
  });

const buildCatalogStatsFromCards = (cards: ProductSearchCard[]): ProductSearchCatalogStats =>
  normalizeCatalogStats({
    totalRecords: cards.length,
    analysisReadyTotal: cards.filter(isAnalysisReadySearchCard).length,
  });

const attachCatalogStatsToResponse = (
  response: ProductSearchResponse,
  catalogStats: ProductSearchCatalogStats,
): ProductSearchResponse => ({
  ...response,
  catalogStats,
});

const attachCatalogStatsToBootstrap = (
  response: ProductSearchBootstrapResponse,
  catalogStats: ProductSearchCatalogStats,
): ProductSearchBootstrapResponse => ({
  ...response,
  catalogStats,
});

const toPostgrestIlikeRawValue = (value: string | null | undefined): string | null => {
  const trimmed = safeTrim(value);
  if (!trimmed) return null;
  const sanitized = trimmed.replace(/[%_,]/g, " ").replace(/\s+/g, " ").trim();
  return sanitized.length > 0 ? sanitized : null;
};

const buildBrandIlikeValues = (value: string | null | undefined): string[] => {
  const normalized = toPostgrestIlikeValue(value);
  const raw = toPostgrestIlikeRawValue(value);
  const comparable = normalizeBrandComparableText(value);
  const values = new Set<string>();

  if (raw) values.add(raw);
  if (normalized) values.add(normalized);

  if (comparable) {
    for (const brand of KNOWN_SEARCH_BRAND_ALIASES) {
      if (normalizeBrandComparableText(brand) !== comparable) continue;
      const brandRaw = toPostgrestIlikeRawValue(brand);
      const brandNormalized = toPostgrestIlikeValue(brand);
      if (brandRaw) values.add(brandRaw);
      if (brandNormalized) values.add(brandNormalized);
    }
  }

  return Array.from(values);
};

const buildBrandIlikeOrClauses = (column: string, value: string | null | undefined): string[] =>
  buildBrandIlikeValues(value).map((term) => `${column}.ilike.%${term}%`);

const applyBrandIlikeFilter = <
  T extends {
    ilike: (column: string, pattern: string) => T;
    or: (filters: string) => T;
  },
>(
  builder: T,
  column: string,
  value: string | null | undefined,
): T => {
  const values = buildBrandIlikeValues(value);
  if (values.length === 0) return builder;
  if (values.length === 1) return builder.ilike(column, `%${values[0]}%`);
  return builder.or(buildBrandIlikeOrClauses(column, value).join(","));
};

const isMissingProductSearchIndexTableError = (error: unknown): boolean => {
  const message = String(
    error && typeof error === "object" && "message" in error
      ? (error as { message?: unknown }).message
      : error ?? "",
  );
  return (
    /relation .*product_search_index.* does not exist/i.test(message) ||
    /could not find the table .*product_search_index.*schema cache/i.test(message)
  );
};

const isMissingProductSearchHomeCacheTableError = (error: unknown): boolean => {
  const message = String(
    error && typeof error === "object" && "message" in error
      ? (error as { message?: unknown }).message
      : error ?? "",
  );
  return (
    /relation .*product_search_home_cache.* does not exist/i.test(message) ||
    /could not find the table .*product_search_home_cache.*schema cache/i.test(message)
  );
};

const getErrorMessage = (error: unknown): string =>
  String(
    error && typeof error === "object" && "message" in error
      ? (error as { message?: unknown }).message
      : error,
  );

const readProductSearchCatalogStatsFromDatabase = async (
  fallbackRows?: ProductSearchIndexRow[] | null,
  options: { preferFallbackAnalysisReady?: boolean } = {},
): Promise<ProductSearchCatalogStats> => {
  const fallbackStats = fallbackRows ? buildCatalogStatsFromRows(fallbackRows) : normalizeCatalogStats({
    totalRecords: 0,
    analysisReadyTotal: 0,
  });

  try {
    const catalogCountResult = await supabase
      .from("iherb_overlay_products")
      .select("*", { head: true, count: "exact" });

    const analysisReadyCountResult = options.preferFallbackAnalysisReady
      ? { count: fallbackStats.analysisReadyTotal, error: null }
      : await supabase
          .from("product_search_index")
          .select("*", { head: true, count: "exact" })
          .eq("facts_status", "full")
          .eq("coverage_status", "coverage_ready");

    const catalogError = catalogCountResult.error;
    const analysisReadyError = analysisReadyCountResult.error;
    if (
      catalogError ||
      (analysisReadyError && !isMissingProductSearchIndexTableError(analysisReadyError))
    ) {
      console.warn("[product-search] catalog stats count fell back to local rows", {
        catalogError: catalogError ? getErrorMessage(catalogError) : null,
        analysisReadyError: analysisReadyError ? getErrorMessage(analysisReadyError) : null,
      });
      return fallbackStats;
    }

    return normalizeCatalogStats({
      totalRecords: catalogCountResult.count ?? fallbackStats.totalRecords,
      analysisReadyTotal:
        options.preferFallbackAnalysisReady && fallbackRows
          ? fallbackStats.analysisReadyTotal
          : analysisReadyCountResult.count ?? fallbackStats.analysisReadyTotal,
    });
  } catch (error) {
    console.warn("[product-search] catalog stats read failed; using local fallback", {
      error: getErrorMessage(error),
    });
    return fallbackStats;
  }
};

const readPersistedProductSearchCatalogStats = async (): Promise<ProductSearchCatalogStats | null> => {
  const persistedBootstrap = await readPersistedProductSearchHomeBootstrap();
  return persistedBootstrap?.catalogStats ?? null;
};

const resolveProductSearchCatalogStats = async (
  fallbackRows?: ProductSearchIndexRow[] | null,
): Promise<ProductSearchCatalogStats> => {
  const now = Date.now();
  if (cachedCatalogStats && now - cachedCatalogStats.builtAt < PRODUCT_SEARCH_CATALOG_STATS_TTL_MS) {
    return cachedCatalogStats.payload;
  }
  if (inflightCatalogStats) return inflightCatalogStats;

  inflightCatalogStats = (async () => {
    const persistedStats = await readPersistedProductSearchCatalogStats();
    const payload = persistedStats ?? (await readProductSearchCatalogStatsFromDatabase(fallbackRows));
    cachedCatalogStats = {
      builtAt: Date.now(),
      payload,
    };
    return payload;
  })();

  try {
    return await inflightCatalogStats;
  } finally {
    inflightCatalogStats = null;
  }
};

const KNOWN_SEARCH_BRAND_PREFIXES = KNOWN_SEARCH_BRAND_ALIASES
  .map((brand) => normalizeLookupText(brand))
  .filter(Boolean)
  .sort((left, right) => right.length - left.length);

const BRAND_LEAD_PRODUCT_TOKEN_PATTERN =
  /\b(?:omega|omega3|d3|b12|vitamin|magnesium|mineral|minerals|zinc|calcium|iron|selenium|thyroid|probiotic|protein|ashwagandha|melatonin|collagen|creatine|krill|fish oil|sleep|stress|joint|joints|energy|immune|immunity|focus|recovery|calm|mood|support|digestion|digestive|gut|mg|mcg|g|iu|ui|cfu|softgels?|capsules?|tablets?|gummies?)\b/;

const extractKnownBrandPrefix = (normalizedQuery: string): string | null =>
  KNOWN_SEARCH_BRAND_PREFIXES.find(
    (brand) => normalizedQuery === brand || normalizedQuery.startsWith(`${brand} `),
  ) ?? null;

const SEARCH_QUERY_PHRASE_ALIASES: { pattern: RegExp; terms: string[] }[] = [
  {
    pattern: /\bdoctors?\s+best\b/i,
    terms: ["doctor s best", "doctors best"],
  },
  {
    pattern: /\bmood\s+support\b/i,
    terms: ["mood support"],
  },
  {
    pattern: /\bvitamin d(?:3)?\b/i,
    terms: ["vitamin d", "vitamin d3", "cholecalciferol", "d3"],
  },
  {
    pattern: /\bvitamin c\b/i,
    terms: ["vitamin c", "ascorbic acid", "ascorbate"],
  },
  {
    pattern: /\bvitamin a\b/i,
    terms: ["vitamin a", "retinol", "beta carotene"],
  },
  {
    pattern: /\bvitamin e\b/i,
    terms: ["vitamin e", "tocopherol", "tocotrienol"],
  },
  {
    pattern: /\bvitamin k(?:1|2)?\b/i,
    terms: ["vitamin k", "vitamin k1", "vitamin k2", "phylloquinone", "menaquinone", "mk 7"],
  },
  {
    pattern: /\b(?:vitamin b12|b12)\b/i,
    terms: ["vitamin b12", "b12", "cobalamin", "methylcobalamin", "cyanocobalamin"],
  },
  {
    pattern: /\bomega\s*3\b/i,
    terms: ["omega 3", "omega3", "omega", "fish oil", "epa", "dha"],
  },
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
  omega3: ["omega3", "omega 3", "omega", "fish oil", "epa", "dha"],
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

const SEARCH_QUERY_FORM_PATTERNS: { key: string; pattern: RegExp }[] = [
  { key: "tablet", pattern: /\btablets?\b/i },
  { key: "softgel", pattern: /\bsoftgels?\b/i },
  { key: "gummy", pattern: /\bgummies?\b/i },
  { key: "chewable", pattern: /\bchewables?\b/i },
  { key: "drop", pattern: /\bdrops?\b/i },
  { key: "liquid", pattern: /\bliquid\b/i },
  { key: "fast_dissolving", pattern: /\bfast[-\s]?dissolv(?:e|ing)\b/i },
];

const SEARCH_INGREDIENT_FAMILY_ALIASES: {
  key: string;
  typeKey: SearchTypeKey | null;
  aliases: string[];
}[] = [
  { key: "vitamin_d", typeKey: "vitamin", aliases: ["vitamin d", "vitamin d3", "d3", "cholecalciferol"] },
  { key: "vitamin_c", typeKey: "vitamin", aliases: ["vitamin c", "ascorbic acid", "ascorbate"] },
  { key: "vitamin_a", typeKey: "vitamin", aliases: ["vitamin a", "retinol", "beta carotene"] },
  { key: "vitamin_e", typeKey: "vitamin", aliases: ["vitamin e", "tocopherol", "tocotrienol"] },
  { key: "vitamin_k", typeKey: "vitamin", aliases: ["vitamin k", "vitamin k1", "vitamin k2", "mk 7", "menaquinone"] },
  { key: "vitamin_b12", typeKey: "vitamin", aliases: ["vitamin b12", "b12", "cobalamin", "methylcobalamin", "cyanocobalamin"] },
  { key: "omega_3", typeKey: "essential", aliases: ["omega 3", "omega3", "omega", "fish oil", "krill oil", "epa", "dha"] },
  { key: "magnesium", typeKey: "mineral", aliases: ["magnesium"] },
  { key: "zinc", typeKey: "mineral", aliases: ["zinc"] },
  { key: "calcium", typeKey: "mineral", aliases: ["calcium"] },
  { key: "iron", typeKey: "mineral", aliases: ["iron"] },
  { key: "selenium", typeKey: "mineral", aliases: ["selenium"] },
  { key: "probiotic", typeKey: "probiotic", aliases: ["probiotic", "probiotics", "lactobacillus", "bifidobacterium"] },
  { key: "protein", typeKey: "protein", aliases: ["protein", "whey", "casein", "collagen", "pea protein"] },
  { key: "creatine", typeKey: "amino_acid", aliases: ["creatine"] },
  { key: "ashwagandha", typeKey: "herb", aliases: ["ashwagandha", "sensoril", "ksm 66"] },
  { key: "melatonin", typeKey: null, aliases: ["melatonin"] },
  { key: "turmeric", typeKey: "herb", aliases: ["turmeric", "curcumin"] },
];

const SEARCH_INGREDIENT_FORM_ALIASES: { key: string; aliases: string[] }[] = [
  { key: "d3", aliases: ["d3", "cholecalciferol"] },
  { key: "glycinate", aliases: ["glycinate", "bisglycinate"] },
  { key: "citrate", aliases: ["citrate"] },
  { key: "malate", aliases: ["malate"] },
  { key: "threonate", aliases: ["threonate", "l threonate"] },
  { key: "oxide", aliases: ["oxide"] },
  { key: "taurate", aliases: ["taurate"] },
  { key: "methylcobalamin", aliases: ["methylcobalamin"] },
  { key: "cyanocobalamin", aliases: ["cyanocobalamin"] },
  { key: "fish_oil", aliases: ["fish oil"] },
  { key: "krill_oil", aliases: ["krill oil"] },
  { key: "isolate", aliases: ["isolate"] },
  { key: "peptides", aliases: ["peptides", "collagen peptides"] },
];

const CATEGORY_BROWSE_TERMS: Record<string, SearchTypeKey> = {
  protein: "protein",
  proteins: "protein",
  probiotic: "probiotic",
  probiotics: "probiotic",
  vitamin: "vitamin",
  vitamins: "vitamin",
  mineral: "mineral",
  minerals: "mineral",
  herb: "herb",
  herbs: "herb",
};

const BENEFIT_GOAL_QUERY_TERMS: Record<string, SearchQueryIntent["benefitGoalKey"]> = {
  sleep: "sleep",
  rest: "sleep",
  calm: "stress_support",
  stress: "stress_support",
  mood: "stress_support",
  "mood support": "stress_support",
  energy: "energy",
  fatigue: "energy",
  immune: "immunity",
  immunity: "immunity",
  focus: "focus",
  cognition: "focus",
  recovery: "recovery",
  muscle: "recovery",
  joint: "joint_support",
  joints: "joint_support",
  "joint support": "joint_support",
  digestion: "gut_health",
  digestive: "gut_health",
  gut: "gut_health",
  "gut health": "gut_health",
  microbiome: "gut_health",
};

const SEARCH_QUERY_STRENGTH_PATTERN =
  /\b(\d[\d,]*(?:\.\d+)?)\s*(mg|mcg|g|iu|ui|ml|oz|cfu)\b/gi;

const COLD_FALLBACK_IGNORE_TOKENS = new Set([
  "each",
  "pack",
  "packs",
  "snack",
  "snacks",
  "assorted",
  "from",
  "grass",
  "fed",
  "milk",
  "chocolate",
  "lb",
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
  "thyroid",
  "health",
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

const productSearchRowsHaveExactBarcodeMatch = (
  rows: ProductSearchIndexRow[],
  query: string | null | undefined,
): boolean => {
  const queryDigits = getBarcodeExactSearchDigits(query);
  if (!queryDigits) return false;

  return rows.some((row) =>
    [normalizeBarcodeDigits(row.barcode), normalizeBarcodeDigits(row.upcCode)].some((candidate) =>
      barcodeDigitsMatch(candidate, queryDigits),
    ),
  );
};

export const shouldUseColdBarcodeExactFallback = (
  response: ProductSearchResponse,
  params: Pick<SearchParams, "query">,
): boolean => Boolean(getBarcodeExactSearchDigits(params.query)) && !productSearchResponseHasExactBarcodeMatch(response, params.query);

const isOptionalQueryToken = (token: string): boolean => {
  if (/^[a-z]$/i.test(token)) return true;
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

export const extractColdFallbackBrandLead = (query: string | null | undefined): string | null => {
  const raw = safeTrim(query);
  if (!raw) return null;

  const firstSegment = raw
    .split(",")
    .map((part) => part.trim())
    .find(Boolean);

  if (!firstSegment) return null;
  const normalized = normalizeLookupText(firstSegment);
  if (!normalized) return null;
  const knownBrandPrefix = extractKnownBrandPrefix(normalized);
  if (knownBrandPrefix) return knownBrandPrefix;
  if (normalized.split(" ").length > 4) return null;
  if (COLD_FALLBACK_IGNORE_TOKENS.has(normalized)) return null;
  if (BRAND_LEAD_PRODUCT_TOKEN_PATTERN.test(normalized)) return null;
  return normalized;
};

export const extractColdFallbackCoreTerms = (query: string | null | undefined): string[] => {
  const queryPlan = buildSearchQueryPlan(query);
  const brandLead = extractColdFallbackBrandLead(query);
  const brandLeadTerms = new Set((brandLead ?? "").split(/\s+/).filter(Boolean));
  const comparableBrandLead = normalizeBrandComparableText(brandLead);

  return queryPlan.requiredGroups
    .map((group) => group[0] ?? "")
    .map((term) => normalizeLookupText(term))
    .filter(Boolean)
    .filter((term) => term !== brandLead)
    .filter((term) => normalizeBrandComparableText(term) !== comparableBrandLead)
    .filter((term) => !brandLeadTerms.has(term))
    .filter((term) => !COLD_FALLBACK_IGNORE_TOKENS.has(term))
    .slice(0, 4);
};

const canonicalizeSearchStrengthNumber = (value: string): string | null => {
  const digits = value.replace(/,/g, "").trim();
  if (!digits) return null;
  const numeric = Number(digits);
  if (!Number.isFinite(numeric)) return null;
  return Number.isInteger(numeric) ? String(numeric) : String(numeric);
};

export const extractSearchStrengthSignals = (value: string | null | undefined): string[] => {
  const raw = safeTrim(value);
  if (!raw) return [];

  const matches = new Set<string>();
  for (const match of raw.matchAll(SEARCH_QUERY_STRENGTH_PATTERN)) {
    const amount = canonicalizeSearchStrengthNumber(match[1] ?? "");
    const unit = normalizeLookupText(match[2] ?? "");
    if (!amount || !unit) continue;
    matches.add(`${amount} ${unit === "ui" ? "iu" : unit}`);
  }

  return Array.from(matches);
};

export const extractSearchFormSignals = (value: string | null | undefined): string[] => {
  const raw = safeTrim(value);
  if (!raw) return [];

  return SEARCH_QUERY_FORM_PATTERNS
    .filter(({ pattern }) => pattern.test(raw))
    .map(({ key }) => key);
};

const normalizeSearchIdentityTitle = (
  value: string | null | undefined,
  brandName: string | null | undefined,
): string => {
  const normalized = normalizeLookupText(value);
  const normalizedBrand = normalizeLookupText(brandName);
  if (!normalized || !normalizedBrand) return normalized;
  if (normalized === normalizedBrand) return "";
  if (normalized.startsWith(`${normalizedBrand} `)) {
    return normalized.slice(normalizedBrand.length + 1).trim();
  }
  return normalized;
};

export const computeSearchQueryIdentityBonus = (
  row: Pick<ProductSearchIndexRow, "title" | "brandName">,
  query: string | null | undefined,
): number => {
  const normalizedQuery = normalizeSearchIdentityTitle(query, row.brandName);
  const normalizedTitle = normalizeSearchIdentityTitle(row.title, row.brandName);
  if (!normalizedQuery || !normalizedTitle) return 0;

  let bonus = 0;

  if (normalizedTitle === normalizedQuery) {
    bonus += 84;
  }

  const queryStrengths = extractSearchStrengthSignals(query);
  const rowStrengths = extractSearchStrengthSignals(row.title);
  const rowStrengthUnits = new Set(rowStrengths.map((signal) => signal.split(" ")[1] ?? ""));
  queryStrengths.forEach((signal) => {
    if (rowStrengths.includes(signal)) {
      bonus += 26;
      return;
    }

    const unit = signal.split(" ")[1] ?? "";
    if (unit && rowStrengthUnits.has(unit)) {
      bonus -= 18;
    }
  });

  const queryForms = extractSearchFormSignals(query);
  const rowForms = new Set(extractSearchFormSignals(row.title));
  queryForms.forEach((form) => {
    if (rowForms.has(form)) {
      bonus += 16;
      return;
    }

    if (rowForms.size > 0) {
      bonus -= 10;
    }
  });

  return bonus;
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

const buildColdSearchCacheKey = (params: SearchParams): string => {
  const query = normalizeLookupText(params.query);
  const category = normalizeLookupText(params.category);
  const brand = normalizeLookupText(params.brand);
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
  return `${query}::${category}::${brand}::${page}::${limit}`;
};

const getRequestedResultWindow = (params: SearchParams): number => {
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
  return page * limit;
};

export const getStableRankingWindow = (_params: SearchParams): number => COLD_FALLBACK_QUERY_LIMIT;

export const shouldStopAfterFocusedColdCandidateFetch = (
  params: SearchParams,
  queryIntent: SearchQueryIntent,
  candidateCount: number,
): boolean => {
  if (candidateCount < getRequestedResultWindow(params)) return false;
  if (!safeTrim(params.query) && !safeTrim(params.brand)) return false;
  if (queryIntent.barcodeDigits) return true;
  if (safeTrim(params.brand)) return true;
  return (
    (queryIntent.kind === "brand_product" || queryIntent.kind === "exact_product") &&
    Boolean(queryIntent.brandLead ?? queryIntent.brandHint)
  );
};

const getCachedColdSearchResponse = (key: string): ProductSearchResponse | null => {
  const cached = cachedColdSearchResponses.get(key);
  if (!cached) return null;
  if (Date.now() - cached.builtAt > COLD_SEARCH_RESPONSE_TTL_MS) {
    cachedColdSearchResponses.delete(key);
    return null;
  }
  return cached.payload;
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
  const coreTerms = extractColdFallbackCoreTerms(query);
  const knownBrandPrefix = extractKnownBrandPrefix(normalizedQuery);
  const candidateTerms = [
    normalizedQuery,
    ...coreTerms,
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

    const fullKnownBrandProductQuery =
      term === normalizedQuery && Boolean(knownBrandPrefix) && coreTerms.length > 0;
    clauses.push(`title.ilike.%${term}%`);
    if (!fullKnownBrandProductQuery) {
      clauses.push(`brand_name.ilike.%${term}%`);
    }
    if (term === normalizedQuery && !fullKnownBrandProductQuery) {
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
  const factsStatus: FactsStatus = ingredients.length === 0
    ? "none"
    : ingredients.some((ingredient) => hasStructuredDose(ingredient.dose))
      ? "full"
      : "partial";
  const coverageStatus: CoverageStatus = factsStatus === "full" ? "coverage_ready" : "not_enough_structured_data";
  const ingredientFamilies = collectIngredientFamilies(searchText);
  const formSignals = Array.from(
    new Set([...collectIngredientFormSignals(searchText), ...extractSearchFormSignals(title)]),
  );
  const strengthSignals = extractSearchStrengthSignals([title, primaryFactsAmount ?? "", servingSize ?? ""].join(" "));
  const qualityRank = (coverageStatus === "coverage_ready" ? 120 : factsStatus === "partial" ? 40 : 10) + brandPopularity;

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
    ingredientFamilies,
    formSignals,
    strengthSignals,
    factsStatus,
    coverageStatus,
    brandPopularity,
    qualityRank,
  };
};

const readSearchIndexIngredients = (value: unknown): SearchIngredientRow[] => {
  if (!Array.isArray(value)) return [];

  return value
    .map((item): SearchIngredientRow | null => {
      if (typeof item === "string") {
        const name = safeTrim(item);
        return name ? { name, dose: null } : null;
      }

      const record = toObjectRecord(item);
      const name =
        safeTrim(record.name) ??
        safeTrim(record.substance) ??
        safeTrim(record.substancy) ??
        safeTrim(record.substance_name) ??
        safeTrim(record.label);
      if (!name) return null;

      const dose =
        safeTrim(record.dose) ??
        safeTrim(record.amountPerServing) ??
        safeTrim(record.amount_per_serving) ??
        safeTrim(record.amount);

      return {
        name,
        dose,
        proprietaryBlendSource: Boolean(record.proprietaryBlendSource),
        aggregateFormula: Boolean(record.aggregateFormula),
      };
    })
    .filter((item): item is SearchIngredientRow => Boolean(item));
};

const normalizeSearchIndexKeySignal = (value: unknown): string =>
  String(value ?? "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, "_")
    .replace(/[^a-z0-9_]+/g, "_")
    .replace(/_+/g, "_")
    .replace(/^_+|_+$/g, "");

const readSearchIndexStringArray = (
  value: unknown,
  normalizer: (item: unknown) => string = (item) => normalizeLookupText(String(item ?? "")),
): string[] => {
  if (!Array.isArray(value)) return [];
  return Array.from(
    new Set(
      value
        .map(normalizer)
        .filter(Boolean),
    ),
  );
};

const normalizeFactsStatusValue = (value: unknown, ingredients: SearchIngredientRow[]): FactsStatus => {
  if (value === "full" || value === "partial" || value === "none") return value;
  return ingredients.length === 0
    ? "none"
    : ingredients.some((ingredient) => hasStructuredDose(ingredient.dose))
      ? "full"
      : "partial";
};

const normalizeCoverageStatusValue = (value: unknown, factsStatus: FactsStatus): CoverageStatus => {
  if (value === "coverage_ready" || value === "not_enough_structured_data") return value;
  return factsStatus === "full" ? "coverage_ready" : "not_enough_structured_data";
};

export const buildProductSearchIndexRowFromSearchIndex = (
  rawRow: ProductSearchIndexTableRow,
): ProductSearchIndexRow | null => {
  const productId = safeTrim(rawRow.product_id);
  const title = safeTrim(rawRow.title);
  const brandName = safeTrim(rawRow.brand_name);
  if (!productId || !title || !brandName) return null;

  const categories = Array.isArray(rawRow.categories)
    ? rawRow.categories.map((value) => String(value ?? "").trim()).filter(Boolean).slice(0, 6)
    : [];
  const ingredients = readSearchIndexIngredients(rawRow.ingredients);
  const fallbackSearchText = buildSearchText({
    title,
    brandName,
    barcode: safeTrim(rawRow.barcode_gtin14),
    upcCode: safeTrim(rawRow.upc_code),
    categories,
    ingredients,
    description: safeTrim(rawRow.description),
    suggestedUse: safeTrim(rawRow.suggested_use),
  });
  const factsStatus = normalizeFactsStatusValue(rawRow.facts_status, ingredients);
  const coverageStatus = normalizeCoverageStatusValue(rawRow.coverage_status, factsStatus);
  const ingredientFamilies = readSearchIndexStringArray(rawRow.ingredient_families, normalizeSearchIndexKeySignal);
  const formSignals = readSearchIndexStringArray(rawRow.form_signals, normalizeSearchIndexKeySignal);
  const strengthSignals = readSearchIndexStringArray(rawRow.strength_signals);

  return {
    id: String(rawRow.overlay_id ?? rawRow.id ?? productId),
    productId,
    barcode: safeTrim(rawRow.barcode_gtin14),
    upcCode: safeTrim(rawRow.upc_code),
    brandName,
    title,
    imageUrl: safeTrim(rawRow.image_url),
    primaryFactsAmount: safeTrim(rawRow.primary_facts_amount),
    servingSize: safeTrim(rawRow.serving_size),
    description: safeTrim(rawRow.description),
    suggestedUse: safeTrim(rawRow.suggested_use),
    categories,
    ingredients,
    updatedAt: rawRow.source_updated_at ?? rawRow.indexed_at ?? null,
    searchText: safeTrim(rawRow.search_text) ?? fallbackSearchText,
    ingredientFamilies,
    formSignals,
    strengthSignals,
    factsStatus,
    coverageStatus,
    brandPopularity: Number.isFinite(rawRow.brand_popularity) ? Number(rawRow.brand_popularity) : 0,
    qualityRank: Number.isFinite(rawRow.quality_rank) ? Number(rawRow.quality_rank) : 0,
  };
};

const escapeRegExp = (value: string): string => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

const normalizedTextIncludesTerm = (haystack: string, term: string): boolean => {
  const normalizedTerm = normalizeLookupText(term);
  if (!haystack || !normalizedTerm) return false;
  const pattern = new RegExp(`(?:^|\\s)${escapeRegExp(normalizedTerm).replace(/\s+/g, "\\s+")}(?:\\s|$)`);
  return pattern.test(haystack);
};

const collectIngredientFamilies = (value: string | null | undefined): string[] => {
  const haystack = normalizeLookupText(value);
  if (!haystack) return [];

  return SEARCH_INGREDIENT_FAMILY_ALIASES
    .filter(({ aliases }) => aliases.some((alias) => normalizedTextIncludesTerm(haystack, alias)))
    .map(({ key }) => key);
};

const collectIngredientFormSignals = (value: string | null | undefined): string[] => {
  const haystack = normalizeLookupText(value);
  if (!haystack) return [];

  return SEARCH_INGREDIENT_FORM_ALIASES
    .filter(({ aliases }) => aliases.some((alias) => normalizedTextIncludesTerm(haystack, alias)))
    .map(({ key }) => key);
};

const findFirstIngredientFamilyAliasIndex = (normalizedQuery: string): number => {
  let bestIndex = Number.POSITIVE_INFINITY;

  for (const descriptor of SEARCH_INGREDIENT_FAMILY_ALIASES) {
    for (const alias of descriptor.aliases) {
      const normalizedAlias = normalizeLookupText(alias);
      if (!normalizedAlias) continue;
      const index = normalizedQuery.indexOf(normalizedAlias);
      if (index > 0 && index < bestIndex) {
        bestIndex = index;
      }
    }
  }

  return Number.isFinite(bestIndex) ? bestIndex : -1;
};

const deriveSearchQueryBrandHint = (normalizedQuery: string): string | null => {
  const firstFamilyIndex = findFirstIngredientFamilyAliasIndex(normalizedQuery);
  if (firstFamilyIndex <= 0) return null;
  const brandHint = normalizedQuery
    .slice(0, firstFamilyIndex)
    .replace(/\b(?:the|a|an)\b/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (!brandHint || brandHint.split(" ").length > 4) return null;
  return brandHint;
};

const detectBenefitGoalKey = (normalizedQuery: string): SearchQueryIntent["benefitGoalKey"] => {
  const exact = BENEFIT_GOAL_QUERY_TERMS[normalizedQuery];
  if (exact) return exact;

  for (const token of normalizedQuery.split(" ").filter(Boolean)) {
    const match = BENEFIT_GOAL_QUERY_TERMS[token];
    if (match) return match;
  }

  return null;
};

export const classifySearchQueryIntent = (
  query: string | null | undefined,
  options: { category?: string | null } = {},
): SearchQueryIntent => {
  const normalizedQuery = normalizeLookupText(query);
  const barcodeDigits = getBarcodeExactSearchDigits(query);
  const brandLead = extractColdFallbackBrandLead(query);
  const coreTerms = extractColdFallbackCoreTerms(query);
  const ingredientFamilies = collectIngredientFamilies(normalizedQuery);
  const ingredientFormSignals = collectIngredientFormSignals(normalizedQuery);
  const packageFormSignals = extractSearchFormSignals(query);
  const strengthSignals = extractSearchStrengthSignals(query);
  const brandHint = brandLead ?? deriveSearchQueryBrandHint(normalizedQuery);
  const benefitGoalKey = detectBenefitGoalKey(normalizedQuery);
  const categoryTypeKey =
    CATEGORY_BROWSE_TERMS[normalizedQuery] ?? FILTER_CATEGORY_TO_TYPE_KEY[normalizeLookupText(options.category)] ?? null;

  let kind: SearchQueryIntentKind = "discovery";
  if (barcodeDigits) {
    kind = "exact_barcode";
  } else if (!normalizedQuery) {
    kind = categoryTypeKey ? "category_browse" : "discovery";
  } else if (categoryTypeKey && normalizedQuery.split(" ").length <= 2) {
    kind = "category_browse";
  } else if (brandLead && coreTerms.length > 0) {
    kind = strengthSignals.length > 0 || packageFormSignals.length > 0 ? "exact_product" : "brand_product";
  } else if (brandHint && ingredientFamilies.length > 0 && (strengthSignals.length > 0 || packageFormSignals.length > 0)) {
    kind = "exact_product";
  } else if (
    ingredientFamilies.length > 0 &&
    (strengthSignals.length > 0 ||
      ingredientFamilies.some((family) => family === "vitamin_d" || family === "vitamin_b12") &&
        ingredientFormSignals.length > 0)
  ) {
    kind = "form_dose";
  } else if (ingredientFamilies.length > 0) {
    kind = "ingredient_family";
  } else if (benefitGoalKey) {
    kind = "benefit_goal";
  }

  const isBroad =
    kind === "category_browse" ||
    kind === "benefit_goal" ||
    (kind === "ingredient_family" &&
      ingredientFamilies.length <= 1 &&
      ingredientFormSignals.length === 0 &&
      packageFormSignals.length === 0 &&
      strengthSignals.length === 0);

  return {
    kind,
    normalizedQuery,
    barcodeDigits,
    brandLead,
    brandHint,
    coreTerms,
    ingredientFamilies,
    ingredientFormSignals,
    packageFormSignals,
    strengthSignals,
    benefitGoalKey,
    categoryTypeKey,
    isBroad,
  };
};

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

const computeVisibleCoreMatchBonus = (
  row: ProductSearchIndexRow,
  intent: SearchQueryIntent | null,
): number => {
  if (!intent || (intent.kind !== "brand_product" && intent.kind !== "exact_product")) return 0;
  if (intent.coreTerms.length === 0 && intent.ingredientFamilies.length === 0) return 0;

  const visibleHaystack = buildVisibleProductCoreHaystack(row);
  const fullHaystack = buildSearchTierHaystack(row);
  const coreMatches = intent.coreTerms.filter((term) => normalizedTextIncludesTerm(visibleHaystack, term)).length;
  const familyMatches = intent.ingredientFamilies.filter((familyKey) =>
    familyHasVisibleProductSignal(row, familyKey),
  ).length;
  const visibleMatches = coreMatches + familyMatches;
  if (visibleMatches > 0) {
    return 38 + visibleMatches * 18;
  }

  const offSurfaceCoreMatches = intent.coreTerms.some((term) => normalizedTextIncludesTerm(fullHaystack, term));
  return offSurfaceCoreMatches ? -30 : 0;
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

const buildSearchQualityBonus = (input: {
  factsStatus: FactsStatus;
  coverageStatus: CoverageStatus;
}): number =>
  (input.coverageStatus === "coverage_ready" ? 8 : 0) +
  (input.factsStatus === "full" ? 5 : input.factsStatus === "partial" ? 2 : 0);

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

const buildSearchTierHaystack = (row: ProductSearchIndexRow): string =>
  normalizeLookupText(
    [
      row.title,
      row.brandName,
      row.searchText,
      row.primaryFactsAmount ?? "",
      row.servingSize ?? "",
      ...row.categories,
      ...row.ingredients.flatMap((ingredient) => [ingredient.name, ingredient.dose ?? ""]),
      row.description ?? "",
      row.suggestedUse ?? "",
    ].join(" "),
  );

const findIngredientFamilyDescriptor = (key: string) =>
  SEARCH_INGREDIENT_FAMILY_ALIASES.find((descriptor) => descriptor.key === key) ?? null;

const findIngredientFormDescriptor = (key: string) =>
  SEARCH_INGREDIENT_FORM_ALIASES.find((descriptor) => descriptor.key === key) ?? null;

const rowMatchesBrandSignal = (row: ProductSearchIndexRow, brandSignal: string | null): boolean => {
  const normalizedSignal = normalizeLookupText(brandSignal);
  if (!normalizedSignal) return false;
  const normalizedBrand = normalizeLookupText(row.brandName);
  const comparableBrand = normalizeBrandComparableText(row.brandName);
  const comparableSignal = normalizeBrandComparableText(brandSignal);
  return (
    normalizedBrand === normalizedSignal ||
    normalizedBrand.includes(normalizedSignal) ||
    comparableBrand === comparableSignal ||
    comparableBrand.includes(comparableSignal)
  );
};

const rowMatchesCoreTerms = (row: ProductSearchIndexRow, terms: string[]): boolean => {
  if (terms.length === 0) return false;
  const haystack = buildSearchTierHaystack(row);
  return terms.every((term) => normalizedTextIncludesTerm(haystack, term));
};

const buildVisibleProductCoreHaystack = (row: ProductSearchIndexRow): string =>
  normalizeLookupText(
    [
      row.title,
      ...row.categories,
      ...row.ingredients.flatMap((ingredient) => [ingredient.name, ingredient.dose ?? ""]),
      row.primaryFactsAmount ?? "",
      row.servingSize ?? "",
    ].join(" "),
  );

const familyHasVisibleProductSignal = (row: ProductSearchIndexRow, familyKey: string): boolean => {
  const descriptor = findIngredientFamilyDescriptor(familyKey);
  if (!descriptor) return false;
  const visibleHaystack = buildVisibleProductCoreHaystack(row);
  return descriptor.aliases.some((alias) => normalizedTextIncludesTerm(visibleHaystack, alias));
};

const rowMatchesVisibleProductCore = (
  row: ProductSearchIndexRow,
  intent: SearchQueryIntent,
): boolean => {
  const visibleHaystack = buildVisibleProductCoreHaystack(row);
  if (intent.coreTerms.some((term) => normalizedTextIncludesTerm(visibleHaystack, term))) {
    return true;
  }
  return intent.ingredientFamilies.some((familyKey) => familyHasVisibleProductSignal(row, familyKey));
};

const rowMatchesIngredientFamily = (
  row: ProductSearchIndexRow,
  intent: SearchQueryIntent,
): boolean => {
  if (intent.ingredientFamilies.length === 0) return false;
  const indexedFamilies = new Set(row.ingredientFamilies);
  if (intent.ingredientFamilies.some((familyKey) => indexedFamilies.has(familyKey))) {
    return true;
  }

  const haystack = buildSearchTierHaystack(row);

  return intent.ingredientFamilies.some((familyKey) => {
    const descriptor = findIngredientFamilyDescriptor(familyKey);
    return descriptor?.aliases.some((alias) => normalizedTextIncludesTerm(haystack, alias)) ?? false;
  });
};

const rowMatchesIngredientForm = (
  row: ProductSearchIndexRow,
  intent: SearchQueryIntent,
): boolean => {
  if (intent.ingredientFormSignals.length === 0) return false;
  const indexedForms = new Set(row.formSignals);
  if (intent.ingredientFormSignals.some((formKey) => indexedForms.has(formKey))) {
    return true;
  }

  const haystack = buildSearchTierHaystack(row);

  return intent.ingredientFormSignals.some((formKey) => {
    const descriptor = findIngredientFormDescriptor(formKey);
    return descriptor?.aliases.some((alias) => normalizedTextIncludesTerm(haystack, alias)) ?? false;
  });
};

const rowMatchesPackageForm = (
  row: ProductSearchIndexRow,
  intent: SearchQueryIntent,
): boolean => {
  if (intent.packageFormSignals.length === 0) return false;
  const indexedForms = new Set(row.formSignals);
  if (intent.packageFormSignals.some((form) => indexedForms.has(form))) {
    return true;
  }

  const rowForms = new Set(extractSearchFormSignals(row.title));
  return intent.packageFormSignals.some((form) => rowForms.has(form));
};

const rowMatchesExactStrength = (
  row: ProductSearchIndexRow,
  intent: SearchQueryIntent,
): boolean => {
  if (intent.strengthSignals.length === 0) return false;
  const indexedStrengths = new Set(row.strengthSignals);
  if (intent.strengthSignals.every((signal) => indexedStrengths.has(signal))) {
    return true;
  }

  const rowStrengths = new Set(
    extractSearchStrengthSignals(
      [
        row.title,
        row.primaryFactsAmount ?? "",
        row.servingSize ?? "",
        ...row.ingredients.map((ingredient) => ingredient.dose ?? ""),
      ].join(" "),
    ),
  );
  return intent.strengthSignals.every((signal) => rowStrengths.has(signal));
};

const rowMatchesExactTitle = (row: ProductSearchIndexRow, intent: SearchQueryIntent): boolean => {
  if (!intent.normalizedQuery) return false;
  const normalizedFullTitle = normalizeLookupText(`${row.brandName} ${row.title}`);
  const normalizedTitle = normalizeSearchIdentityTitle(row.title, row.brandName);
  const normalizedQuery = normalizeSearchIdentityTitle(intent.normalizedQuery, row.brandName);
  return normalizedFullTitle === intent.normalizedQuery || (!!normalizedTitle && normalizedTitle === normalizedQuery);
};

const rowMatchesIntentCategory = (
  row: ProductSearchIndexRow,
  intent: SearchQueryIntent,
): boolean => {
  if (!intent.categoryTypeKey) return false;
  return deriveTypeKeysFromContent({
    title: row.title,
    brandName: row.brandName,
    description: row.description,
    suggestedUse: row.suggestedUse,
    categories: row.categories,
    ingredients: row.ingredients,
  }).includes(intent.categoryTypeKey);
};

const rowMatchesBenefitGoal = (
  row: ProductSearchIndexRow,
  intent: SearchQueryIntent,
): SearchGoalTier => {
  if (!intent.benefitGoalKey) return "no_match";
  const haystack = buildSearchTierHaystack(row);

  if (intent.benefitGoalKey === "joint_support") {
    if (/\b(?:glucosamine|chondroitin|msm|collagen|hyaluronic|joint)\b/.test(haystack)) {
      return "strong_match";
    }
    if (/\b(?:turmeric|curcumin|omega 3|omega3|fish oil)\b/.test(haystack)) {
      return "related";
    }
    return "no_match";
  }

  const goalChoice = matchGoalForRow(haystack);
  return goalChoice.benefit === GOAL_BENEFIT_COPY[intent.benefitGoalKey]
    ? goalChoice.tier
    : "no_match";
};

export const scoreSearchRelevanceTier = (
  row: ProductSearchIndexRow,
  intent: SearchQueryIntent,
): SearchRelevanceTierResult => {
  if (intent.barcodeDigits) {
    const exactBarcode = [normalizeBarcodeDigits(row.barcode), normalizeBarcodeDigits(row.upcCode)].some(
      (candidate) => barcodeDigitsMatch(candidate, intent.barcodeDigits as string),
    );
    if (exactBarcode) return { tier: 0, reason: "exact_barcode" };
  }

  if (rowMatchesExactTitle(row, intent)) {
    return { tier: 0, reason: "exact_title" };
  }

  const brandSignal = intent.brandLead ?? intent.brandHint;
  const brandMatched = rowMatchesBrandSignal(row, brandSignal);
  const coreMatched = rowMatchesCoreTerms(row, intent.coreTerms);
  const familyMatched = rowMatchesIngredientFamily(row, intent);
  const visibleCoreMatched = rowMatchesVisibleProductCore(row, intent);
  const strengthMatched = rowMatchesExactStrength(row, intent);
  const ingredientFormMatched = rowMatchesIngredientForm(row, intent);
  const packageFormMatched = rowMatchesPackageForm(row, intent);
  const familyTierEligible =
    familyMatched &&
    ((intent.kind !== "brand_product" && intent.kind !== "exact_product") || visibleCoreMatched);
  const hasStrengthConstraint = intent.strengthSignals.length > 0;
  const hasFormConstraint = intent.ingredientFormSignals.length > 0 || intent.packageFormSignals.length > 0;
  const specificConstraintMatched = hasStrengthConstraint
    ? strengthMatched
    : hasFormConstraint
      ? ingredientFormMatched || packageFormMatched
      : coreMatched;

  if (brandMatched && (coreMatched || familyMatched) && specificConstraintMatched && visibleCoreMatched) {
    return { tier: 0, reason: "brand_product" };
  }

  if (intent.kind === "brand_product" && brandMatched && visibleCoreMatched && (coreMatched || familyMatched)) {
    return { tier: 0, reason: "brand_product" };
  }

  if (
    (intent.kind === "brand_product" || intent.kind === "exact_product") &&
    brandMatched &&
    familyMatched &&
    visibleCoreMatched
  ) {
    return { tier: 1, reason: "ingredient_form_or_dose" };
  }

  if (familyTierEligible) {
    if (hasStrengthConstraint) {
      return strengthMatched
        ? { tier: 1, reason: "ingredient_form_or_dose" }
        : { tier: 2, reason: "ingredient_family" };
    }

    if (hasFormConstraint) {
      return ingredientFormMatched || packageFormMatched
        ? { tier: 1, reason: "ingredient_form_or_dose" }
        : { tier: 2, reason: "ingredient_family" };
    }

    return { tier: 2, reason: "ingredient_family" };
  }

  const benefitTier = rowMatchesBenefitGoal(row, intent);
  if (benefitTier === "strong_match" || benefitTier === "related") {
    return {
      tier: benefitTier === "strong_match" ? 2 : 3,
      reason: benefitTier === "strong_match" ? "ingredient_family" : "adjacent",
    };
  }

  if (brandMatched || rowMatchesIntentCategory(row, intent)) {
    return { tier: 3, reason: "adjacent" };
  }

  return { tier: 4, reason: "fallback" };
};

const deriveSearchMatchReason = (params: {
  row: ProductSearchIndexRow;
  queryPlan: SearchQueryPlan | null;
  rawQuery: string | null | undefined;
  categoryLabel: string;
}): string | null => {
  const normalizedQuery = normalizeLookupText(params.rawQuery);
  const title = normalizeLookupText(params.row.title);
  const brand = normalizeLookupText(params.row.brandName);
  const ingredientNames = normalizeLookupText(params.row.ingredients.map((ingredient) => ingredient.name).join(" "));
  const categories = normalizeLookupText([params.categoryLabel, ...params.row.categories].join(" "));
  if (!normalizedQuery) {
    return params.categoryLabel && params.categoryLabel !== "Supplement"
      ? `Popular ${params.categoryLabel}`
      : "Popular supplement";
  }

  if (title.includes(normalizedQuery)) return "Title match";
  if (brand.includes(normalizedQuery) || extractKnownBrandPrefix(normalizedQuery) === brand) return "Brand match";

  const groups = [
    ...(params.queryPlan?.requiredGroups ?? []),
    ...(params.queryPlan?.optionalGroups ?? []),
  ];
  const terms = groups.flat();
  if (terms.some((term) => title.includes(term))) return "Title match";
  if (terms.some((term) => brand.includes(term))) return "Brand match";
  if (terms.some((term) => ingredientNames.includes(term))) return "Ingredient match";
  if (terms.some((term) => categories.includes(term))) return "Category match";
  return "Related match";
};

const enrichSearchRow = (
  row: ProductSearchIndexRow,
  baseSearchScore: number,
  queryPlan: SearchQueryPlan | null = null,
  rawQuery: string | null | undefined = null,
  queryIntent: SearchQueryIntent | null = null,
  tierResult: SearchRelevanceTierResult | null = null,
): EnrichedCandidate => {
  const factsStatus = row.factsStatus;
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
  const coverageStatus = row.coverageStatus;
  const qualityScore = buildQualityScore({
    factsStatus,
    coverageStatus,
    bestTier: goalChoice.tier,
  }) + Math.min(Math.max(row.qualityRank, 0), 40);
  const queryIntentBonus = queryPlan ? computeSearchQueryIntentBonus(row, primaryTypeKey, queryPlan) : 0;
  const visibleCoreMatchBonus = computeVisibleCoreMatchBonus(row, queryIntent);
  const queryIdentityBonus =
    rawQuery && baseSearchScore > 0 ? computeSearchQueryIdentityBonus(row, rawQuery) : 0;
  const searchQualityBonus = baseSearchScore > 0
    ? buildSearchQualityBonus({ factsStatus, coverageStatus })
    : 0;
  const finalSearchScore =
    baseSearchScore +
    (goalChoice.tier !== "no_match" && baseSearchScore > 0 ? 3 : 0) +
    queryIntentBonus +
    visibleCoreMatchBonus +
    queryIdentityBonus +
    searchQualityBonus;
  const matchReason = deriveSearchMatchReason({
    row,
    queryPlan,
    rawQuery,
    categoryLabel,
  });
  const relevanceTierResult =
    tierResult ??
    (queryIntent
      ? scoreSearchRelevanceTier(row, queryIntent)
      : { tier: 4 as SearchRelevanceTier, reason: "fallback" as const });
  const resultTier = getProductSearchResultTier(row);

  return {
    row,
    typeKey: primaryTypeKey,
    qualityScore,
    baseSearchScore,
    finalSearchScore,
    relevanceTier: relevanceTierResult.tier,
    relevanceTierReason: relevanceTierResult.reason,
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
      matchReason,
      factsStatus,
      coverageStatus,
      resultTier,
      resultTierLabel: getProductSearchResultTierLabel(resultTier),
      resultTierDescription: getProductSearchResultTierDescription(resultTier),
    },
  };
};

const sortCandidates = (left: EnrichedCandidate, right: EnrichedCandidate, hasQuery: boolean): number => {
  if (hasQuery) {
    const tierDelta = left.relevanceTier - right.relevanceTier;
    if (tierDelta !== 0) return tierDelta;

    const relevanceDelta = right.finalSearchScore - left.finalSearchScore;
    if (relevanceDelta !== 0) return relevanceDelta;

    const qualityDelta = right.qualityScore - left.qualityScore;
    if (qualityDelta !== 0) return qualityDelta;
  }

  const resultTierDelta = compareProductSearchResultTier(left.card, right.card);
  if (resultTierDelta !== 0) return resultTierDelta;

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

const filterFocusedProductCandidates = (
  items: EnrichedCandidate[],
  intent: SearchQueryIntent,
): EnrichedCandidate[] => {
  if (intent.kind !== "brand_product" && intent.kind !== "exact_product") return items;
  return items.filter((item) => item.relevanceTier <= 2);
};

const shouldAllowNonReadyCatalogResults = (
  params: SearchParams,
  intent: SearchQueryIntent,
  hasQuery: boolean,
): boolean => {
  if (
    intent.kind === "exact_barcode" ||
    intent.kind === "exact_product" ||
    intent.kind === "brand_product" ||
    intent.kind === "form_dose"
  ) {
    return true;
  }
  if (safeTrim(params.brand)) return true;
  if (!hasQuery) return false;

  const hasBrandLeadOnly =
    !!(intent.brandLead || intent.brandHint) &&
    intent.coreTerms.length === 0 &&
    intent.ingredientFamilies.length === 0 &&
    intent.benefitGoalKey === null &&
    intent.categoryTypeKey === null;
  return hasBrandLeadOnly;
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

const shouldDiversifySearchResults = (
  params: SearchParams,
  queryPlan: SearchQueryPlan,
  queryIntent: SearchQueryIntent,
  hasQuery: boolean,
): boolean => {
  if (safeTrim(params.brand)) return false;
  if (!hasQuery) return true;
  const normalizedQuery = normalizeLookupText(params.query);
  if (extractKnownBrandPrefix(normalizedQuery)) return false;
  if (!queryIntent.isBroad) return false;
  return queryPlan.requiredGroups.length <= 2;
};

const fetchProductSearchIndexRows = async (): Promise<ProductSearchIndexRow[] | null> => {
  const rows: ProductSearchIndexRow[] = [];
  let lastSeenId = 0;

  while (true) {
    let query = supabase
      .from("product_search_index")
      .select(PRODUCT_SEARCH_LIST_INDEX_SELECT)
      .order("id", { ascending: true })
      .limit(OVERLAY_PAGE_SIZE);

    if (lastSeenId > 0) {
      query = query.gt("id", lastSeenId);
    }

    const { data, error } = await withRetry(() => query, {
      retries: 2,
      baseDelayMs: 120,
      maxDelayMs: 800,
    });

    if (error) {
      if (isMissingProductSearchIndexTableError(error)) return null;
      throw new Error(`[product-search] failed to read product_search_index: ${getErrorMessage(error)}`);
    }

    const batch = Array.isArray(data) ? (data as ProductSearchIndexTableRow[]) : [];
    if (batch.length === 0) break;

    for (const rawRow of batch) {
      const builtRow = buildProductSearchIndexRowFromSearchIndex(rawRow);
      if (builtRow) rows.push(builtRow);
    }

    const nextLastSeenId = Number(batch[batch.length - 1]?.id ?? 0);
    if (!Number.isFinite(nextLastSeenId) || nextLastSeenId <= lastSeenId) break;
    lastSeenId = nextLastSeenId;
  }

  return rows;
};

const buildSearchIndex = async (): Promise<ProductSearchIndex> => {
  const indexedRows = await fetchProductSearchIndexRows();
  if (indexedRows && indexedRows.length > 0) {
    return {
      builtAt: Date.now(),
      rows: indexedRows,
      catalogStats: buildCatalogStatsFromRows(indexedRows),
    };
  }

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

  const rankedRows = rows.map((row) => ({
    ...row,
    brandPopularity: brandCounts.get(normalizeLookupText(row.brandName)) ?? 0,
  }));

  return {
    builtAt: Date.now(),
    rows: rankedRows,
    catalogStats: buildCatalogStatsFromRows(rankedRows),
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

const parseProductSearchWarmQueries = (): string[] => {
  const configured = safeTrim(process.env.PRODUCT_SEARCH_WARM_COMMON_QUERIES);
  const source = configured ? configured.split(",") : [...DEFAULT_PRODUCT_SEARCH_WARM_QUERIES];
  const limit = Math.max(
    0,
    Math.min(50, Number(process.env.PRODUCT_SEARCH_WARM_COMMON_QUERY_LIMIT ?? source.length)),
  );
  return Array.from(
    new Set(
      source
        .map((query) => safeTrim(query))
        .filter((query): query is string => Boolean(query)),
    ),
  ).slice(0, limit);
};

const warmCommonSearchResponsesInBackground = (): void => {
  const queries = parseProductSearchWarmQueries();
  if (queries.length === 0) return;

  void (async () => {
    const startedAt = performance.now();
    let warmed = 0;
    for (const query of queries) {
      try {
        await searchProducts({ query, page: 1, limit: DEFAULT_LIMIT });
        warmed += 1;
      } catch (error) {
        console.warn("[product-search] common query warm failed", {
          query,
          error: getErrorMessage(error),
        });
      }
    }
    console.info("[product-search] common query warm complete", {
      warmed,
      total: queries.length,
      durationMs: Math.round(performance.now() - startedAt),
    });
  })();
};

export const warmProductSearchIndex = (): void => {
  warmSearchIndexInBackground();
  warmCommonSearchResponsesInBackground();
};

const getUsableSearchIndex = (
  options: { warmIfMissing?: boolean } = {},
): ProductSearchIndex | null => {
  const warmIfMissing = options.warmIfMissing ?? true;
  const now = Date.now();
  if (cachedSearchIndex && now - cachedSearchIndex.builtAt < SEARCH_INDEX_TTL_MS) {
    return cachedSearchIndex;
  }

  if (cachedSearchIndex) {
    warmSearchIndexInBackground();
    return cachedSearchIndex;
  }

  if (warmIfMissing) {
    warmSearchIndexInBackground();
  }
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

export const buildProductSearchIndexOrClauses = (query: string | null | undefined): string[] => {
  const normalizedQuery = toPostgrestIlikeValue(query);
  if (!normalizedQuery) return [];

  const queryPlan = buildSearchQueryPlan(query);
  const coreTerms = extractColdFallbackCoreTerms(query);
  const knownBrandPrefix = extractKnownBrandPrefix(normalizedQuery);
  const candidateTerms = [normalizedQuery, ...coreTerms];

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

    clauses.push(`search_text.ilike.%${term}%`);
    const fullKnownBrandProductQuery =
      term === normalizedQuery && Boolean(knownBrandPrefix) && coreTerms.length > 0;
    if (term === normalizedQuery && !fullKnownBrandProductQuery) {
      clauses.push(`brand_name.ilike.%${term}%`);
    }
  }

  return Array.from(new Set(clauses));
};

const fetchColdProductSearchIndexRows = async (
  params: SearchParams,
): Promise<ProductSearchIndexRow[] | null> => {
  const searchIndexOrClauses = buildProductSearchIndexOrClauses(params.query);
  const queryIntent = classifySearchQueryIntent(params.query, { category: params.category });
  const indexedFormSignals = Array.from(
    new Set([...queryIntent.ingredientFormSignals, ...queryIntent.packageFormSignals]),
  );
  const brandLike = toPostgrestIlikeValue(params.brand);
  const hasQuery = searchIndexOrClauses.length > 0;
  const shouldUsePopularBrandBrowse = !hasQuery && !brandLike;
  const derivedBrandLead = !brandLike ? extractColdFallbackBrandLead(params.query) : null;
  const coreTerms = extractColdFallbackCoreTerms(params.query);
  const buildBaseQuery = (limit: number) =>
    supabase
      .from("product_search_index")
      .select(PRODUCT_SEARCH_LIST_INDEX_SELECT)
      .order("quality_rank", { ascending: false })
      .order("brand_popularity", { ascending: false })
      .order("source_updated_at", { ascending: false, nullsFirst: false })
      .limit(limit);
  const buildBaseRangeQuery = (from: number, to: number) =>
    supabase
      .from("product_search_index")
      .select(PRODUCT_SEARCH_LIST_INDEX_SELECT)
      .order("quality_rank", { ascending: false })
      .order("brand_popularity", { ascending: false })
      .order("source_updated_at", { ascending: false, nullsFirst: false })
      .range(from, to);

  const mergedRows = new Map<string, ProductSearchIndexTableRow>();
  const mergeBatch = (batch: ProductSearchIndexTableRow[] | null | undefined) => {
    for (const row of batch ?? []) {
      const key = safeTrim(row.product_id) ?? safeTrim(row.barcode_gtin14) ?? safeTrim(row.upc_code) ?? null;
      if (!key || mergedRows.has(key)) continue;
      mergedRows.set(key, row);
    }
  };
  const buildMergedIndexRows = (): ProductSearchIndexRow[] =>
    Array.from(mergedRows.values())
      .map(buildProductSearchIndexRowFromSearchIndex)
      .filter((row): row is ProductSearchIndexRow => Boolean(row));
  const focusedRowsCanFillRequestedWindow = (rows: ProductSearchIndexRow[]): boolean =>
    buildSearchResponseFromRows(rows, params).pagination.total >= getRequestedResultWindow(params);

  const executeQuery = async (
    builder: ReturnType<typeof buildBaseQuery>,
  ): Promise<ProductSearchIndexTableRow[] | null> => {
    const { data, error } = await withRetry(() => builder, {
      retries: 2,
      baseDelayMs: 100,
      maxDelayMs: 500,
    });

    if (error) {
      if (isMissingProductSearchIndexTableError(error)) return null;
      throw new Error(`[product-search] cold search index read failed: ${getErrorMessage(error)}`);
    }

    return Array.isArray(data) ? (data as ProductSearchIndexTableRow[]) : [];
  };

  if (queryIntent.barcodeDigits) {
    const barcodeBatch = await executeQuery(
      buildBaseQuery(12).or(
        [
          `barcode_gtin14.eq.${queryIntent.barcodeDigits}`,
          `upc_code.eq.${queryIntent.barcodeDigits}`,
          `barcode_gtin14.eq.${queryIntent.barcodeDigits.padStart(14, "0")}`,
        ].join(","),
      ),
    );
    if (barcodeBatch === null) return null;
    mergeBatch(barcodeBatch);
    if (mergedRows.size > 0) {
      return buildMergedIndexRows();
    }
  }

  if (
    queryIntent.ingredientFamilies.length > 0 ||
    indexedFormSignals.length > 0 ||
    queryIntent.strengthSignals.length > 0
  ) {
    const stableRankingWindow = getStableRankingWindow(params);
    let signalQuery = buildBaseQuery(Math.min(stableRankingWindow, COLD_FALLBACK_QUERY_LIMIT));
    const focusedBrand = brandLike ?? queryIntent.brandLead ?? queryIntent.brandHint;

    if (focusedBrand) {
      signalQuery = applyBrandIlikeFilter(signalQuery, "brand_name", focusedBrand);
    }

    if (queryIntent.ingredientFamilies.length > 0) {
      signalQuery = signalQuery.overlaps("ingredient_families", queryIntent.ingredientFamilies);
    }

    if (indexedFormSignals.length > 0) {
      signalQuery = signalQuery.overlaps("form_signals", indexedFormSignals);
    }

    if (queryIntent.strengthSignals.length > 0) {
      signalQuery = signalQuery.overlaps("strength_signals", queryIntent.strengthSignals);
    }

    const signalBatch = await executeQuery(signalQuery);
    if (signalBatch === null) return null;
    mergeBatch(signalBatch);
    if (shouldStopAfterFocusedColdCandidateFetch(params, queryIntent, mergedRows.size)) {
      const focusedRows = buildMergedIndexRows();
      if (focusedRowsCanFillRequestedWindow(focusedRows)) {
        return focusedRows;
      }
    }
  }

  if (
    mergedRows.size < COLD_INDEX_MIN_CANDIDATES_BEFORE_EXPAND &&
    hasQuery &&
    (brandLike || derivedBrandLead || coreTerms.length > 0)
  ) {
    const stableRankingWindow = getStableRankingWindow(params);
    let focusedQuery = buildBaseQuery(Math.min(stableRankingWindow, COLD_FALLBACK_QUERY_LIMIT));
    const focusedBrand = brandLike ?? derivedBrandLead;

    if (focusedBrand) {
      focusedQuery = applyBrandIlikeFilter(focusedQuery, "brand_name", focusedBrand);
    }

    for (const term of coreTerms.slice(0, 3)) {
      focusedQuery = focusedQuery.ilike("search_text", `%${term}%`);
    }

    const focusedBatch = await executeQuery(focusedQuery);
    if (focusedBatch === null) return null;
    mergeBatch(focusedBatch);
    if (shouldStopAfterFocusedColdCandidateFetch(params, queryIntent, mergedRows.size)) {
      const focusedRows = buildMergedIndexRows();
      if (focusedRowsCanFillRequestedWindow(focusedRows)) {
        return focusedRows;
      }
    }
  }

  const stableRankingWindow = getStableRankingWindow(params);
  let query = buildBaseQuery(
    hasQuery ? Math.min(stableRankingWindow, COLD_FALLBACK_QUERY_LIMIT) : COLD_FALLBACK_BROWSE_LIMIT,
  );

  if (brandLike) {
    query = applyBrandIlikeFilter(query, "brand_name", brandLike);
  }

  if (searchIndexOrClauses.length > 0) {
    query = query.or(searchIndexOrClauses.join(","));
  } else if (shouldUsePopularBrandBrowse) {
    query = query.in("brand_name", [...POPULAR_FALLBACK_BRANDS]);
  }

  if (mergedRows.size < COLD_INDEX_MIN_CANDIDATES_BEFORE_EXPAND || !hasQuery) {
    const batch = await executeQuery(query);
    if (batch === null) return null;
    mergeBatch(batch);
    if (!hasQuery && COLD_FALLBACK_BROWSE_LIMIT > 1000) {
      const continuationBatch = await executeQuery(
        buildBaseRangeQuery(1000, COLD_FALLBACK_BROWSE_LIMIT - 1),
      );
      if (continuationBatch === null) return null;
      mergeBatch(continuationBatch);
    }
  }

  return buildMergedIndexRows();
};

const fetchColdFallbackRows = async (params: SearchParams): Promise<ProductSearchIndexRow[]> => {
  const searchIndexRows = await fetchColdProductSearchIndexRows(params);
  if (searchIndexRows !== null) {
    if (!getBarcodeExactSearchDigits(params.query) || productSearchRowsHaveExactBarcodeMatch(searchIndexRows, params.query)) {
      return searchIndexRows;
    }
    console.info("[product-search] exact barcode missing from search index; checking overlay fallback", {
      query: getBarcodeExactSearchDigits(params.query),
    });
  }

  const fallbackOrClauses = buildColdFallbackOrClauses(params.query);
  const brandLike = toPostgrestIlikeValue(params.brand);
  const hasQuery = fallbackOrClauses.length > 0;
  const shouldUsePopularBrandBrowse = !hasQuery && !brandLike;
  const derivedBrandLead = !brandLike ? extractColdFallbackBrandLead(params.query) : null;
  const coreTerms = extractColdFallbackCoreTerms(params.query);
  const queryIntent = classifySearchQueryIntent(params.query, { category: params.category });
  const stableRankingWindow = getStableRankingWindow(params);

  const buildBaseQuery = (limit: number) =>
    supabase
      .from("iherb_overlay_products")
      .select(OVERLAY_SEARCH_SELECT)
      .order("updated_at", { ascending: false })
      .limit(limit);

  const mergedRows = new Map<string, OverlaySearchTableRow>();
  const mergeBatch = (batch: OverlaySearchTableRow[] | null | undefined) => {
    for (const row of batch ?? []) {
      const key = safeTrim(row.product_id) ?? safeTrim(row.barcode_gtin14) ?? safeTrim(row.upc_code) ?? null;
      if (!key || mergedRows.has(key)) continue;
      mergedRows.set(key, row);
    }
  };

  const executeQuery = async (
    builder: ReturnType<typeof buildBaseQuery>,
  ): Promise<OverlaySearchTableRow[]> => {
    const { data, error } = await withRetry(() => builder, {
      retries: 2,
      baseDelayMs: 120,
      maxDelayMs: 800,
    });

    if (error) {
      const message = error instanceof Error ? error.message : String(error);
      throw new Error(`[product-search] cold fallback read failed: ${message}`);
    }

    return Array.isArray(data) ? (data as OverlaySearchTableRow[]) : [];
  };

  if (hasQuery && (brandLike || derivedBrandLead || coreTerms.length > 0)) {
    let focusedQuery = buildBaseQuery(Math.min(stableRankingWindow, COLD_FALLBACK_QUERY_LIMIT));
    const focusedBrand = brandLike ?? derivedBrandLead;

    if (focusedBrand) {
      focusedQuery = applyBrandIlikeFilter(focusedQuery, "brand_name", focusedBrand);
    }

    for (const term of coreTerms.slice(0, 3)) {
      focusedQuery = focusedQuery.ilike("title", `%${term}%`);
    }

    mergeBatch(await executeQuery(focusedQuery));
    if (shouldStopAfterFocusedColdCandidateFetch(params, queryIntent, mergedRows.size)) {
      const focusedRows = buildFallbackRows(Array.from(mergedRows.values()));
      if (buildSearchResponseFromRows(focusedRows, params).pagination.total >= getRequestedResultWindow(params)) {
        return focusedRows;
      }
    }
  }

  let query = buildBaseQuery(
    hasQuery ? Math.min(stableRankingWindow, COLD_FALLBACK_QUERY_LIMIT) : COLD_FALLBACK_BROWSE_LIMIT,
  );

  if (brandLike) {
    query = applyBrandIlikeFilter(query, "brand_name", brandLike);
  }

  if (fallbackOrClauses.length > 0) {
    query = query.or(fallbackOrClauses.join(","));
  } else if (shouldUsePopularBrandBrowse) {
    query = query.in("brand_name", [...POPULAR_FALLBACK_BRANDS]);
  }

  mergeBatch(await executeQuery(query));

  return buildFallbackRows(Array.from(mergedRows.values()));
};

export const buildSearchResponseFromRows = (
  rows: ProductSearchIndexRow[],
  params: SearchParams,
  options: { catalogStats?: ProductSearchCatalogStats | null } = {},
): ProductSearchResponse => {
  const page = Number.isFinite(params.page) && (params.page ?? 0) > 0 ? Math.floor(params.page as number) : 1;
  const limit = Math.min(
    MAX_LIMIT,
    Math.max(1, Number.isFinite(params.limit) && (params.limit ?? 0) > 0 ? Math.floor(params.limit as number) : DEFAULT_LIMIT),
  );
  const queryPlan = buildSearchQueryPlan(params.query);
  const queryIntent = classifySearchQueryIntent(params.query, { category: params.category });
  const hasQuery =
    queryPlan.requiredGroups.length > 0 || queryPlan.optionalGroups.length > 0;
  const allowNonReadyCatalogResults = shouldAllowNonReadyCatalogResults(params, queryIntent, hasQuery);
  const catalogStats = options.catalogStats ?? buildCatalogStatsFromRows(rows);
  const normalizedBrandFilter = normalizeLookupText(params.brand);
  const categoryTypeKey = categoryFilterToTypeKey(params.category);

  let preliminary = rows
    .filter((row) =>
      normalizedBrandFilter ? normalizeLookupText(row.brandName).includes(normalizedBrandFilter) : true,
    )
    .map((row) => ({
      row,
      baseSearchScore: hasQuery ? computeSearchScoreForQueryPlan(row, queryPlan) : 0,
      tierResult: scoreSearchRelevanceTier(row, queryIntent),
    }))
    .filter((entry) => (hasQuery ? entry.baseSearchScore > 0 : true));

  preliminary.sort((left, right) => {
    if (hasQuery) {
      const tierDelta = left.tierResult.tier - right.tierResult.tier;
      if (tierDelta !== 0) return tierDelta;

      const scoreDelta = right.baseSearchScore - left.baseSearchScore;
      if (scoreDelta !== 0) return scoreDelta;
    }

    const popularityDelta = right.row.brandPopularity - left.row.brandPopularity;
    if (popularityDelta !== 0) return popularityDelta;
    return left.row.title.localeCompare(right.row.title);
  });

  const shortlistCap = hasQuery ? MAX_PRELIMINARY_CANDIDATES : 1200;
  const shortlisted = preliminary.slice(0, shortlistCap);
  let enriched = shortlisted.map((entry) =>
    enrichSearchRow(entry.row, entry.baseSearchScore, queryPlan, params.query, queryIntent, entry.tierResult),
  );

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
  enriched = filterFocusedProductCandidates(enriched, queryIntent);
  if (!allowNonReadyCatalogResults) {
    enriched = enriched.filter((entry) => entry.card.resultTier === "analysis_ready");
  }
  if (shouldDiversifySearchResults(params, queryPlan, queryIntent, hasQuery)) {
    enriched = diversifyByBrand(enriched);
  }

  const total = enriched.length;
  const totalIsExact = !hasQuery || rows.length < COLD_FALLBACK_QUERY_LIMIT;
  const startIndex = (page - 1) * limit;
  const endIndex = startIndex + limit;
  const paged = enriched.slice(startIndex, endIndex);
  const hasMore = endIndex < total;
  const topBrands = Array.from(new Set(enriched.map((entry) => entry.card.brand))).slice(0, MAX_SUGGESTION_BRANDS);

  return {
    supplements: paged.map((entry) => entry.card),
    pagination: {
      total,
      page,
      limit,
      totalPages: Math.max(1, Math.ceil(total / limit)),
      hasMore,
      nextPage: hasMore ? page + 1 : null,
      shown: Math.min(endIndex, total),
      totalIsExact,
    },
    suggestions: {
      categories: [...SEARCH_BROWSE_CATEGORIES],
      brands: topBrands,
      popularSearches: POPULAR_SEARCHES,
    },
    catalogStats,
  };
};

const applyColdBarcodeExactFallbackIfNeeded = async (
  response: ProductSearchResponse,
  params: SearchParams,
): Promise<ProductSearchResponse> => {
  if (!shouldUseColdBarcodeExactFallback(response, params)) return response;

  const fallbackRows = await fetchColdFallbackRows(params);
  const fallbackResponse = buildSearchResponseFromRows(fallbackRows, params, {
    catalogStats: response.catalogStats,
  });
  if (!productSearchResponseHasExactBarcodeMatch(fallbackResponse, params.query)) return response;

  console.info("[product-search] using cold barcode exact fallback after warm index miss", {
    query: getBarcodeExactSearchDigits(params.query),
  });
  return fallbackResponse;
};

export const buildProductSearchBootstrapPayloadFromRows = (
  rows: ProductSearchIndexRow[],
  options: { catalogStats?: ProductSearchCatalogStats | null } = {},
): ProductSearchBootstrapResponse => {
  const catalogStats = options.catalogStats ?? buildCatalogStatsFromRows(rows);
  const responses = SEARCH_BROWSE_CATEGORIES.map((category) => {
    const params: SearchParams = {
      query: "",
      category: category === "All" ? null : category,
      page: 1,
      limit: DEFAULT_LIMIT,
    };
    const firstPage = buildSearchResponseFromRows(rows, params, { catalogStats });
    const cachedPages = Math.max(
      1,
      Math.ceil(
        Math.min(firstPage.pagination.total, PRODUCT_SEARCH_BROWSE_BOOTSTRAP_LIMIT) / DEFAULT_LIMIT,
      ),
    );
    const supplements = Array.from({ length: cachedPages }, (_, index) =>
      buildSearchResponseFromRows(rows, {
        ...params,
        page: index + 1,
      }, { catalogStats }).supplements,
    ).flat();

    return [
      category,
      {
        supplements,
        pagination: {
          ...firstPage.pagination,
          shown: Math.min(DEFAULT_LIMIT, firstPage.pagination.total),
          hasMore: firstPage.pagination.total > DEFAULT_LIMIT,
          nextPage: firstPage.pagination.total > DEFAULT_LIMIT ? 2 : null,
        },
      },
    ] as const;
  });

  return {
    generatedAt: Date.now(),
    categories: Object.fromEntries(
      responses.map(([category, response]) => [category, response.supplements]),
    ),
    paginationByCategory: Object.fromEntries(
      responses.map(([category, response]) => [category, response.pagination]),
    ),
    catalogStats,
  };
};

const normalizePersistedProductSearchCard = (value: unknown): ProductSearchCard => {
  const card = value as ProductSearchCard;
  const resultTier = card.resultTier ?? getProductSearchResultTier({
    factsStatus: card.factsStatus ?? "none",
    coverageStatus: card.coverageStatus ?? "not_enough_structured_data",
  });

  return {
    ...card,
    resultTier,
    resultTierLabel: card.resultTierLabel ?? getProductSearchResultTierLabel(resultTier),
    resultTierDescription:
      card.resultTierDescription ?? getProductSearchResultTierDescription(resultTier),
  };
};

const normalizePersistedSearchBootstrapPayload = (
  value: unknown,
  fallbackIndexedRows?: number | null,
): ProductSearchBootstrapResponse | null => {
  const record = toObjectRecord(value);
  const categories = toObjectRecord(record.categories);
  if (Object.keys(categories).length === 0) return null;

  const normalizedCategories: ProductSearchBootstrapResponse["categories"] = {};
  for (const [category, supplements] of Object.entries(categories)) {
    if (!Array.isArray(supplements)) continue;
    normalizedCategories[category] = supplements.map(normalizePersistedProductSearchCard);
  }

  if (Object.keys(normalizedCategories).length === 0) return null;

  const rawPaginationByCategory = toObjectRecord(record.paginationByCategory);
  const paginationByCategory: ProductSearchBootstrapResponse["paginationByCategory"] = {};
  for (const [category, pagination] of Object.entries(rawPaginationByCategory)) {
    const paginationRecord = toObjectRecord(pagination);
    const total = Number(paginationRecord.total);
    const page = Number(paginationRecord.page);
    const limit = Number(paginationRecord.limit);
    const totalPages = Number(paginationRecord.totalPages);
    const hasMore = Boolean(paginationRecord.hasMore ?? page < totalPages);
    const rawNextPage = Number(paginationRecord.nextPage);
    const shown = Number(
      paginationRecord.shown ?? Math.min(total, page * limit),
    );
    const totalIsExact = paginationRecord.totalIsExact !== false;
    if ([total, page, limit, totalPages].every(Number.isFinite)) {
      paginationByCategory[category] = {
        total,
        page,
        limit,
        totalPages,
        hasMore,
        nextPage: Number.isFinite(rawNextPage) ? rawNextPage : hasMore ? page + 1 : null,
        shown: Number.isFinite(shown) ? shown : Math.min(total, page * limit),
        totalIsExact,
      };
    }
  }

  const catalogStatsRecord = toObjectRecord(record.catalogStats);
  const allCards = Object.values(normalizedCategories).flat();
  const fallbackReadyTotal =
    paginationByCategory.All?.total ??
    allCards.filter(isAnalysisReadySearchCard).length;
  const catalogStats = normalizeCatalogStats({
    totalRecords: Number.isFinite(Number(catalogStatsRecord.totalRecords))
      ? Number(catalogStatsRecord.totalRecords)
      : Number.isFinite(Number(fallbackIndexedRows))
        ? Number(fallbackIndexedRows)
        : allCards.length,
    analysisReadyTotal: Number.isFinite(Number(catalogStatsRecord.analysisReadyTotal))
      ? Number(catalogStatsRecord.analysisReadyTotal)
      : fallbackReadyTotal,
  });

  return {
    generatedAt: Number.isFinite(record.generatedAt) ? Number(record.generatedAt) : Date.now(),
    categories: normalizedCategories,
    paginationByCategory,
    catalogStats,
  };
};

const readPersistedProductSearchHomeBootstrap = async (): Promise<ProductSearchBootstrapResponse | null> => {
  if (
    cachedPersistedHomeBootstrap &&
    Date.now() - cachedPersistedHomeBootstrap.builtAt < PERSISTED_HOME_CACHE_TTL_MS
  ) {
    return cachedPersistedHomeBootstrap.payload;
  }

  const { data, error } = await withRetry(
    () =>
      supabase
        .from("product_search_home_cache")
        .select("payload,indexed_rows,source_indexed_at,updated_at")
        .eq("cache_key", PRODUCT_SEARCH_HOME_CACHE_KEY)
        .maybeSingle(),
    { retries: 1, baseDelayMs: 80, maxDelayMs: 250 },
  );

  if (error) {
    if (isMissingProductSearchHomeCacheTableError(error)) return null;
    throw new Error(`[product-search] home cache read failed: ${getErrorMessage(error)}`);
  }

  const row = data as ProductSearchHomeCacheTableRow | null;
  const payload = normalizePersistedSearchBootstrapPayload(row?.payload, row?.indexed_rows ?? null);
  if (!payload) return null;

  cachedPersistedHomeBootstrap = {
    builtAt: Date.now(),
    payload,
  };
  return payload;
};

export const writePersistedProductSearchHomeBootstrap = async (
  payload: ProductSearchBootstrapResponse,
): Promise<void> => {
  const { count, error: countError } = await supabase
    .from("product_search_index")
    .select("*", { head: true, count: "exact" });
  if (countError && !isMissingProductSearchIndexTableError(countError)) {
    throw new Error(`[product-search] home cache index count failed: ${getErrorMessage(countError)}`);
  }

  const { data: maxRows, error: maxError } = await supabase
    .from("product_search_index")
    .select("indexed_at")
    .order("indexed_at", { ascending: false, nullsFirst: false })
    .limit(1);
  if (maxError && !isMissingProductSearchIndexTableError(maxError)) {
    throw new Error(`[product-search] home cache index timestamp failed: ${getErrorMessage(maxError)}`);
  }

  const sourceIndexedAt = Array.isArray(maxRows) ? safeTrim(maxRows[0]?.indexed_at) : null;
  const { error } = await supabase.from("product_search_home_cache").upsert({
    cache_key: PRODUCT_SEARCH_HOME_CACHE_KEY,
    payload,
    indexed_rows: count ?? 0,
    source_indexed_at: sourceIndexedAt,
    updated_at: new Date().toISOString(),
  });
  if (error) {
    if (isMissingProductSearchHomeCacheTableError(error)) return;
    throw new Error(`[product-search] home cache write failed: ${getErrorMessage(error)}`);
  }

  cachedPersistedHomeBootstrap = {
    builtAt: Date.now(),
    payload,
  };
};

export const refreshPersistedProductSearchHomeBootstrap = async (): Promise<ProductSearchBootstrapResponse> => {
  const fallbackRows = await fetchColdFallbackRows({ query: "", page: 1, limit: DEFAULT_LIMIT });
  const baseCatalogStats = await readProductSearchCatalogStatsFromDatabase(fallbackRows, {
    preferFallbackAnalysisReady: true,
  });
  const basePayload = buildProductSearchBootstrapPayloadFromRows(fallbackRows, {
    catalogStats: baseCatalogStats,
  });
  const catalogStats = normalizeCatalogStats({
    totalRecords: baseCatalogStats.totalRecords,
    analysisReadyTotal:
      basePayload.paginationByCategory?.All?.total ?? baseCatalogStats.analysisReadyTotal,
  });
  const payload = attachCatalogStatsToBootstrap(basePayload, catalogStats);
  await writePersistedProductSearchHomeBootstrap(payload);
  return payload;
};

const buildBrowseResponseFromBootstrapPayload = (
  payload: ProductSearchBootstrapResponse,
  params: SearchParams,
): ProductSearchResponse | null => {
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
  if (limit !== DEFAULT_LIMIT) return null;

  const category = safeTrim(params.category) ?? "All";
  const supplements = payload.categories[category];
  if (!supplements) return null;
  const startIndex = (page - 1) * limit;
  const endIndex = startIndex + limit;
  if (startIndex >= supplements.length) return null;
  const sourcePagination = payload.paginationByCategory?.[category] ?? null;
  const total = Math.max(sourcePagination?.total ?? 0, supplements.length);
  const pagedSupplements = supplements.slice(startIndex, endIndex);
  const hasMore = endIndex < total;

  return {
    supplements: pagedSupplements,
    pagination: sourcePagination
      ? {
          ...sourcePagination,
          page,
          limit,
          total,
          totalPages: Math.max(1, Math.ceil(total / limit)),
          hasMore,
          nextPage: hasMore ? page + 1 : null,
          shown: Math.min(endIndex, total),
        }
      : {
          total,
          page,
          limit: DEFAULT_LIMIT,
          totalPages: Math.max(1, Math.ceil(total / limit)),
          hasMore,
          nextPage: hasMore ? page + 1 : null,
          shown: Math.min(endIndex, total),
          totalIsExact: true,
        },
    suggestions: {
      categories: [...SEARCH_BROWSE_CATEGORIES],
      brands: [],
      popularSearches: POPULAR_SEARCHES,
    },
    catalogStats: payload.catalogStats,
  };
};

const rebuildWarmBrowseResponseMap = (index: ProductSearchIndex): void => {
  const responses = new Map<string, ProductSearchResponse>();
  const catalogStats = index.catalogStats ?? buildCatalogStatsFromRows(index.rows);

  for (const category of SEARCH_BROWSE_CATEGORIES) {
    const params: SearchParams = {
      query: "",
      category: category === "All" ? null : category,
      page: 1,
      limit: DEFAULT_LIMIT,
    };
    const response = buildSearchResponseFromRows(index.rows, params, { catalogStats });
    responses.set(buildBrowseCacheKey(params), response);
  }

  cachedBrowseResponseMap = {
    builtAt: index.builtAt,
    responses,
    bootstrap: buildProductSearchBootstrapPayloadFromRows(index.rows, { catalogStats }),
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
  const warmIndex = getUsableSearchIndex({ warmIfMissing: false });
  if (warmIndex && cachedBrowseResponseMap?.builtAt === warmIndex.builtAt) {
    const catalogStats = await resolveProductSearchCatalogStats(warmIndex.rows);
    return attachCatalogStatsToBootstrap(cachedBrowseResponseMap.bootstrap, catalogStats);
  }
  if (warmIndex) {
    if (!cachedBrowseResponseMap || cachedBrowseResponseMap.builtAt !== warmIndex.builtAt) {
      rebuildWarmBrowseResponseMap(warmIndex);
    }
    const catalogStats = await resolveProductSearchCatalogStats(warmIndex.rows);
    return attachCatalogStatsToBootstrap(cachedBrowseResponseMap!.bootstrap, catalogStats);
  }

  const persistedBootstrap = await readPersistedProductSearchHomeBootstrap();
  if (persistedBootstrap) {
    cachedColdBootstrap = {
      builtAt: Date.now(),
      payload: persistedBootstrap,
    };
    return persistedBootstrap;
  }

  const now = Date.now();
  if (cachedColdBootstrap && now - cachedColdBootstrap.builtAt < COLD_BOOTSTRAP_TTL_MS) {
    return cachedColdBootstrap.payload;
  }
  if (inflightColdBootstrap) {
    return inflightColdBootstrap;
  }

  inflightColdBootstrap = (async () => {
    const payload = await refreshPersistedProductSearchHomeBootstrap();
    cachedColdBootstrap = {
      builtAt: Date.now(),
      payload,
    };
    return payload;
  })();

  try {
    return await inflightColdBootstrap;
  } finally {
    inflightColdBootstrap = null;
  }
};

export const searchProducts = async (params: SearchParams): Promise<ProductSearchResponse> => {
  const hasSearchIntent = Boolean(safeTrim(params.query) || safeTrim(params.brand));
  const warmBrowseResponse = getWarmBrowseResponse(params);
  if (warmBrowseResponse) {
    const warmIndex = getUsableSearchIndex({ warmIfMissing: false });
    const catalogStats = await resolveProductSearchCatalogStats(warmIndex?.rows ?? null);
    return attachCatalogStatsToResponse(warmBrowseResponse, catalogStats);
  }

  if (!safeTrim(params.query) && !safeTrim(params.brand)) {
    const persistedBootstrap = await readPersistedProductSearchHomeBootstrap();
    const persistedBrowseResponse = persistedBootstrap
      ? buildBrowseResponseFromBootstrapPayload(persistedBootstrap, params)
      : null;
    if (persistedBrowseResponse) {
      return persistedBrowseResponse;
    }
  }

  const index = hasSearchIntent ? null : getUsableSearchIndex({ warmIfMissing: false });
  if (index) {
    if (!cachedBrowseResponseMap || cachedBrowseResponseMap.builtAt !== index.builtAt) {
      rebuildWarmBrowseResponseMap(index);
    }
    const catalogStats = await resolveProductSearchCatalogStats(index.rows);
    const response = buildSearchResponseFromRows(index.rows, params, { catalogStats });
    return applyColdBarcodeExactFallbackIfNeeded(response, params);
  }

  const coldCacheKey = buildColdSearchCacheKey(params);
  const cachedColdResponse = getCachedColdSearchResponse(coldCacheKey);
  if (cachedColdResponse) {
    return cachedColdResponse;
  }

  const inflightColdResponse = inflightColdSearchResponses.get(coldCacheKey);
  if (inflightColdResponse) {
    return inflightColdResponse;
  }

  console.info("[product-search] using cold product search index fallback", {
    query: safeTrim(params.query) ?? null,
    category: safeTrim(params.category) ?? null,
    brand: safeTrim(params.brand) ?? null,
  });

  const coldResponsePromise = (async () => {
    const fallbackRows = await fetchColdFallbackRows(params);
    const catalogStats = await resolveProductSearchCatalogStats(fallbackRows);
    const response = buildSearchResponseFromRows(fallbackRows, params, { catalogStats });
    cachedColdSearchResponses.set(coldCacheKey, {
      builtAt: Date.now(),
      payload: response,
    });
    return response;
  })();
  inflightColdSearchResponses.set(coldCacheKey, coldResponsePromise);

  try {
    return await coldResponsePromise;
  } finally {
    inflightColdSearchResponses.delete(coldCacheKey);
  }
};
