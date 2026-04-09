import {
  buildFactsDigestFromWeb,
  computeFactsDigestHash,
  type FactsDigest,
} from "./factsDigest.js";
import {
  compileDecisionSupport,
  type DecisionSupportCategoryId,
  type DecisionSupportNutriScoreCardV2Module,
  type DecisionSupportNutriScoreCardV2ModuleId,
  type DecisionSupportOverallBand,
  type DecisionSupportOverlayClaims,
  type DecisionSupportPayload,
  type DecisionSupportPersonalizedProductStanding,
  type DecisionSupportPersonalizedProductStandingBlock,
  type DecisionSupportPersonalizedStandingAlternative,
} from "./decisionSupport.js";
import { normalizeIherbSupplementFactsRowsWithTitleFallback } from "./iherbOverlayIngredients.js";
import { supabase } from "./supabase.js";

type ComparisonOverlayRow = {
  product_id?: string | null;
  barcode_gtin14?: string | null;
  brand_name?: string | null;
  title?: string | null;
  link?: string | null;
  product_catalog_image?: string | null;
  product_images?: unknown;
  categories?: unknown;
  supplement_facts?: unknown;
  description_sections?: unknown;
  updated_at?: string | null;
};

type ComparisonOverlayAnalysis = {
  productId: string | null;
  barcodeGtin14: string | null;
  title: string;
  brand: string | null;
  imageUrl: string | null;
  categoryId: DecisionSupportCategoryId;
  score: number | null;
  scoreBand: DecisionSupportOverallBand | null;
  formBucket: ComparisonFormBucket;
  familyKey: string | null;
  dedupeKey: string;
  digest: FactsDigest;
  overlayClaims: DecisionSupportOverlayClaims;
  payload: DecisionSupportPayload;
};

type ComparisonStandingComputationInput = {
  current: ComparisonOverlayAnalysis;
  peers: ComparisonOverlayAnalysis[];
};

type ComparisonStandingCacheEntry = {
  expiresAt: number;
  value: DecisionSupportPersonalizedProductStandingBlock | null;
};

type ComparisonStandingParams = {
  barcodeGtin14: string;
  overlayClaims: DecisionSupportOverlayClaims | null;
  digest: FactsDigest;
  decisionSupport: DecisionSupportPayload;
};

type ComparisonFormBucket =
  | "softgel"
  | "capsule"
  | "tablet"
  | "gummy_chewable"
  | "powder"
  | "liquid"
  | "other";

const COMPARISON_CACHE_TTL_MS = 5 * 60 * 1000;
const COMPARISON_MAX_CANDIDATES = 180;
const COMPARISON_MAX_FILTERED_PEERS = 24;
const COMPARISON_MIN_STANDING_PEERS = 8;
const COMPARISON_MIN_PERCENTILE_PEERS = 15;
const COMPARISON_MIN_ALTERNATIVES = 2;
const COMPARISON_MAX_ALTERNATIVES = 3;

const comparisonStandingCache = new Map<string, ComparisonStandingCacheEntry>();
const comparisonStandingInflight = new Map<
  string,
  Promise<DecisionSupportPersonalizedProductStandingBlock | null>
>();

const safeText = (value: unknown): string => String(value ?? "").trim();

const hasText = (value: unknown): boolean => safeText(value).length > 0;

const toObjectRecord = (value: unknown): Record<string, unknown> =>
  value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};

const normalizeLower = (value: unknown): string =>
  safeText(value)
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();

const normalizeTextKey = (value: unknown): string =>
  normalizeLower(value).replace(/[^a-z0-9]+/g, " ").trim();

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

const readOverlayImageUrl = (row: Record<string, unknown>): string | null => {
  for (const candidate of [
    row.productCatalogImage,
    row.product_catalog_image,
    row.imageUrl,
    row.image_url,
  ]) {
    if (typeof candidate === "string" && candidate.trim()) return candidate.trim();
  }

  for (const collection of [row.productImages, row.product_images]) {
    if (!Array.isArray(collection)) continue;
    for (const item of collection) {
      if (typeof item === "string" && item.trim()) return item.trim();
      if (!item || typeof item !== "object") continue;
      const record = item as Record<string, unknown>;
      for (const nested of [record.url, record.src, record.imageUrl, record.image_url]) {
        if (typeof nested === "string" && nested.trim()) return nested.trim();
      }
    }
  }

  return null;
};

const normalizeBarcode = (value: unknown): string | null => {
  const digits = safeText(value).replace(/\D/g, "");
  if (!digits) return null;
  return digits.padStart(14, "0").slice(-14);
};

const toDecisionSupportOverlayClaims = (
  row: ComparisonOverlayRow | Record<string, unknown>,
): DecisionSupportOverlayClaims => {
  const descriptionSections = toObjectRecord(
    (row as Record<string, unknown>).description_sections ??
      (row as Record<string, unknown>).descriptionSections,
  );
  const supplementFacts = toObjectRecord(
    (row as Record<string, unknown>).supplement_facts ??
      (row as Record<string, unknown>).supplementFacts,
  );
  const nutritionalFactsRaw = Array.isArray(supplementFacts.nutritionalFacts)
    ? (supplementFacts.nutritionalFacts as Record<string, unknown>[])
    : Array.isArray(supplementFacts.nutritional_facts)
      ? (supplementFacts.nutritional_facts as Record<string, unknown>[])
      : [];

  return {
    provider: "iherb",
    productId: hasText((row as ComparisonOverlayRow).product_id)
      ? safeText((row as ComparisonOverlayRow).product_id)
      : null,
    brandName: hasText((row as ComparisonOverlayRow).brand_name)
      ? safeText((row as ComparisonOverlayRow).brand_name)
      : null,
    title: hasText((row as ComparisonOverlayRow).title)
      ? safeText((row as ComparisonOverlayRow).title)
      : null,
    link: hasText((row as ComparisonOverlayRow).link)
      ? safeText((row as ComparisonOverlayRow).link)
      : null,
    imageUrl: readOverlayImageUrl(row as Record<string, unknown>),
    categories: Array.isArray((row as ComparisonOverlayRow).categories)
      ? ((row as ComparisonOverlayRow).categories as unknown[]).map(safeText).filter(Boolean)
      : [],
    description: readSectionText(descriptionSections, ["Description"]),
    suggestedUse: readSectionText(descriptionSections, ["Suggested use", "Suggested Use", "Suggested usage"]),
    otherIngredients: readSectionText(descriptionSections, ["Other ingredients", "Other Ingredients"]),
    warnings: readSectionText(descriptionSections, ["Warnings", "Warning"]),
    disclaimer: readSectionText(descriptionSections, ["Disclaimer"]),
    nutritionalFacts: nutritionalFactsRaw
      .map((item) => ({
        substancy: safeText(item?.substancy ?? item?.substance ?? item?.substance_name ?? item?.name),
        amountPerServing: safeText(item?.amountPerServing ?? item?.amount_per_serving ?? item?.amount),
        dailyValuePercent: safeText(
          item?.dailyValuePercent ?? item?.daily_value_percent ?? item?.dailyValue,
        ) || null,
      }))
      .filter((item) => item.substancy || item.amountPerServing || item.dailyValuePercent),
  };
};

const buildOverlayIngredientsText = (
  row: ComparisonOverlayRow,
  overlayClaims: DecisionSupportOverlayClaims,
): string | null => {
  const supplementFacts = toObjectRecord(row.supplement_facts);
  const descriptionSections = toObjectRecord(row.description_sections);
  const nutritionalFacts = Array.isArray(overlayClaims.nutritionalFacts)
    ? overlayClaims.nutritionalFacts
    : [];

  const normalizedRows = normalizeIherbSupplementFactsRowsWithTitleFallback({
    rows: nutritionalFacts,
    title: overlayClaims.title,
    brandName: overlayClaims.brandName,
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
    sourceZipPath: null,
    descriptionText: readSectionText(descriptionSections, ["Description"]),
  });

  const text = normalizedRows
    .map((item) => [safeText(item.name), safeText(item.dose)].filter(Boolean).join(" "))
    .filter(Boolean)
    .join("\n");

  return text || null;
};

const toFactsDigest = (row: ComparisonOverlayRow, overlayClaims: DecisionSupportOverlayClaims): FactsDigest => {
  const supplementFacts = toObjectRecord(row.supplement_facts);
  const digest = buildFactsDigestFromWeb({
    facts: {
      barcode: safeText(row.barcode_gtin14),
      canonical: {
        name: overlayClaims.title,
        brand: overlayClaims.brandName,
        url: overlayClaims.link,
        domain: "iherb.com",
      },
      identifiers: { npn: null },
      textFacts: {
        ingredientsText: buildOverlayIngredientsText(row, overlayClaims),
        directionsText: overlayClaims.suggestedUse,
        warningsText: overlayClaims.warnings,
        servingSizeText:
          typeof supplementFacts.servingSize === "string"
            ? supplementFacts.servingSize
            : typeof supplementFacts.serving_size === "string"
              ? supplementFacts.serving_size
              : null,
      },
      coverageScore: 1,
      missingFields: [],
    },
    identityType: "gtin14",
    identityValue: safeText(row.barcode_gtin14),
    regionTags: ["us"],
  });

  digest.product.route = null;
  return digest;
};

const normalizeComparisonFormBucket = (
  digest: FactsDigest,
  overlayClaims: DecisionSupportOverlayClaims,
): ComparisonFormBucket => {
  const haystack = normalizeLower(
    [
      digest.product?.dosageForm,
      overlayClaims.suggestedUse,
      overlayClaims.title,
      overlayClaims.description,
    ]
      .filter(Boolean)
      .join(" "),
  );

  if (/\bsoft\s*gel\b|\bsoftgel\b/.test(haystack)) return "softgel";
  if (/\bcapsule\b/.test(haystack)) return "capsule";
  if (/\btablet\b|\bcaplet\b/.test(haystack)) return "tablet";
  if (/\bgummy\b|\bchew(?:able)?\b|\blozenge\b/.test(haystack)) return "gummy_chewable";
  if (/\bpowder\b|\bpacket\b|\bstick pack\b/.test(haystack)) return "powder";
  if (/\bliquid\b|\bdrop(?:s)?\b|\bsyrup\b|\btincture\b/.test(haystack)) return "liquid";
  return "other";
};

const detectOmegaBreakdown = (digest: FactsDigest, overlayClaims: DecisionSupportOverlayClaims): boolean => {
  const activeNames = (Array.isArray(digest.actives) ? digest.actives : [])
    .map((active) => normalizeLower(active?.name))
    .filter(Boolean);
  if (activeNames.some((item) => item.includes("epa")) && activeNames.some((item) => item.includes("dha"))) {
    return true;
  }
  const factNames = overlayClaims.nutritionalFacts
    .map((row) => normalizeLower(row.substancy))
    .filter(Boolean);
  return factNames.some((item) => item.includes("epa")) && factNames.some((item) => item.includes("dha"));
};

const pickMagnesiumFamily = (digest: FactsDigest, overlayClaims: DecisionSupportOverlayClaims): string => {
  const haystack = normalizeLower(
    [
      ...digest.actives.map((active) => active.chemicalForm ?? active.name),
      overlayClaims.title,
      overlayClaims.description,
    ]
      .filter(Boolean)
      .join(" "),
  );

  for (const candidate of [
    "glycinate",
    "bisglycinate",
    "citrate",
    "oxide",
    "threonate",
    "malate",
    "taurate",
  ]) {
    if (haystack.includes(candidate)) return candidate;
  }

  return "magnesium";
};

const buildComparisonFamilyKey = (
  categoryId: DecisionSupportCategoryId,
  digest: FactsDigest,
  overlayClaims: DecisionSupportOverlayClaims,
): string | null => {
  const haystack = normalizeLower(
    [
      overlayClaims.title,
      overlayClaims.description,
      ...digest.actives.map((active) => active.name),
    ]
      .filter(Boolean)
      .join(" "),
  );

  if (!haystack) return null;

  if (categoryId === "fish_oil_omega3") {
    if (/\bkrill\b/.test(haystack)) return "krill";
    if (/\bcod liver\b/.test(haystack)) return "cod_liver";
    if (/\balgal\b|\balgae\b/.test(haystack)) return "algal";
    if (/\bsalmon\b/.test(haystack)) return "salmon";
    if (/\bdha\b/.test(haystack) && !/\bepa\b/.test(haystack)) return "dha_only";
    if (/\bepa\b/.test(haystack) && !/\bdha\b/.test(haystack)) return "epa_only";
    return "fish_oil";
  }

  if (categoryId === "vitamin_d") {
    if (/\bd3\b|\bcholecalciferol\b/.test(haystack)) return "d3";
    if (/\bd2\b|\bergocalciferol\b/.test(haystack)) return "d2";
    return "vitamin_d";
  }

  if (categoryId === "magnesium") {
    return pickMagnesiumFamily(digest, overlayClaims);
  }

  if (categoryId === "probiotics") {
    if (/\bsaccharomyces boulardii\b|\bboulardii\b/.test(haystack)) return "boulardii";
    if (/\bkids\b|\bchildren\b/.test(haystack)) return "kids";
    if (/\bwomen'?s\b/.test(haystack)) return "women";
    return "probiotic";
  }

  if (categoryId === "collagen_connective_support") {
    if (/\bmarine\b/.test(haystack)) return "marine";
    if (/\bbovine\b/.test(haystack)) return "bovine";
    if (/\btype ii\b/.test(haystack)) return "type_ii";
    return "collagen";
  }

  const firstActive = digest.actives
    .map((active) => normalizeTextKey(active?.name))
    .find(Boolean);
  if (firstActive) return firstActive;

  const titleKey = normalizeTextKey(overlayClaims.title);
  return titleKey ? titleKey.split(" ").slice(0, 3).join("_") : null;
};

const buildDedupeKey = (brand: string | null, title: string): string => {
  const normalizedTitle = normalizeLower(title)
    .replace(/\b\d+(?:,\d+)?(?:\.\d+)?\s*(mcg|mg|g|iu|cfu|ml|softgels?|capsules?|tablets?|caplets?)\b/g, " ")
    .replace(/\b\d+\s*(count|ct)\b/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  return `${normalizeTextKey(brand)}::${normalizedTitle}`;
};

const buildCategoryBenchmarkLabel = (categoryId: DecisionSupportCategoryId): string => {
  switch (categoryId) {
    case "fish_oil_omega3":
      return "omega-3 supplements";
    case "vitamin_d":
      return "vitamin D supplements";
    case "magnesium":
      return "magnesium supplements";
    case "probiotics":
      return "probiotic supplements";
    case "collagen_connective_support":
      return "collagen supplements";
    case "sleep_stress_mood_support":
      return "sleep and stress support supplements";
    case "botanical_herbal_support":
      return "botanical support supplements";
    case "vitamin_mineral_other":
      return "vitamin and mineral supplements";
    default:
      return "supplements";
  }
};

const extractTitleComparisonKeyword = (title: string | null | undefined): string | null => {
  const parts = safeText(title)
    .split(",")
    .map((part) => part.trim())
    .filter(Boolean);
  const preferred =
    parts.find((part, index) => index > 0 && !/\b\d/.test(part)) ??
    parts.find((part) => !/\b\d/.test(part)) ??
    parts[0] ??
    null;
  if (!preferred) return null;

  const cleaned = normalizeLower(preferred)
    .replace(/\b(high potency|extra strength|advanced|premium|maximum strength)\b/g, " ")
    .replace(/\bveggie\b|\bvegetarian\b|\bsoftgels?\b|\bcapsules?\b|\btablets?\b|\bcaplets?\b/g, " ")
    .replace(/\b\d+(?:,\d+)?(?:\.\d+)?\s*(mcg|mg|g|iu|ml|count|ct)\b/g, " ")
    .replace(/\s+/g, " ")
    .trim();

  return cleaned.length >= 4 ? cleaned : null;
};

const buildComparisonSearchKeyword = (
  categoryId: DecisionSupportCategoryId,
  familyKey: string | null,
  title: string | null,
): string | null => {
  if (familyKey === "krill") return "krill";
  if (familyKey === "cod_liver") return "cod liver";
  if (familyKey === "algal") return "algae";
  if (familyKey === "glycinate" || familyKey === "bisglycinate") return "magnesium glycinate";
  if (familyKey === "citrate") return "magnesium citrate";
  if (familyKey === "boulardii") return "boulardii";
  if (familyKey === "marine") return "marine collagen";

  switch (categoryId) {
    case "fish_oil_omega3":
      return "fish oil";
    case "vitamin_d":
      return "vitamin d";
    case "magnesium":
      return "magnesium";
    case "probiotics":
      return "probiotic";
    case "collagen_connective_support":
      return "collagen";
    default:
      return (
        extractTitleComparisonKeyword(title) ||
        familyKey
          ?.replace(/_/g, " ")
          .replace(/\b\d+\b/g, " ")
          .replace(/\s+/g, " ")
          .trim()
      ) || null;
  }
};

const analyzeOverlayRow = (row: ComparisonOverlayRow): ComparisonOverlayAnalysis | null => {
  const overlayClaims = toDecisionSupportOverlayClaims(row);
  if (!hasText(overlayClaims.title)) return null;

  const digest = toFactsDigest(row, overlayClaims);
  const factsDigestHash = computeFactsDigestHash(digest);
  const payload = compileDecisionSupport({
    digest,
    factsDigestHash,
    viewMode: "details",
    locale: "en",
    flagsSnapshot: null,
    patchActivation: null,
    overlayClaims,
  });

  const scoreValue = Number(payload.nutriScoreCardV2?.overallScore);
  const score = Number.isFinite(scoreValue) ? scoreValue : null;
  const title = safeText(overlayClaims.title);
  const brand = hasText(overlayClaims.brandName) ? safeText(overlayClaims.brandName) : null;

  return {
    productId: overlayClaims.productId,
    barcodeGtin14: normalizeBarcode(row.barcode_gtin14),
    title,
    brand,
    imageUrl: overlayClaims.imageUrl ?? null,
    categoryId: payload.categoryId,
    score,
    scoreBand: payload.nutriScoreCardV2?.overallBand ?? null,
    formBucket: normalizeComparisonFormBucket(digest, overlayClaims),
    familyKey: buildComparisonFamilyKey(payload.categoryId, digest, overlayClaims),
    dedupeKey: buildDedupeKey(brand, title),
    digest,
    overlayClaims,
    payload,
  };
};

const compareStandingPercentile = (
  peerCount: number,
  currentScore: number,
  peers: ComparisonOverlayAnalysis[],
): number | null => {
  if (peerCount < COMPARISON_MIN_PERCENTILE_PEERS) return null;
  const belowCount = peers.filter((item) => Number(item.score ?? -1) < currentScore).length;
  return Math.max(0, Math.min(99, Math.round((belowCount / Math.max(peerCount, 1)) * 100)));
};

const mapStandingLabelFromPercentile = (percentile: number | null): {
  standing: DecisionSupportPersonalizedProductStanding;
  label: string | null;
} => {
  if (percentile === null) {
    return { standing: "unknown", label: null };
  }
  if (percentile >= 80) return { standing: "strong", label: "Top tier" };
  if (percentile >= 60) return { standing: "strong", label: "Above average" };
  if (percentile >= 40) return { standing: "average", label: "Around average" };
  return { standing: "weak", label: "Below average" };
};

const pickLargestModuleDelta = (
  currentModules: DecisionSupportNutriScoreCardV2Module[],
  candidateModules: DecisionSupportNutriScoreCardV2Module[],
): DecisionSupportNutriScoreCardV2ModuleId | null => {
  const currentScores = new Map(currentModules.map((item) => [item.id, Number(item.score ?? 0)]));
  const candidateScores = new Map(candidateModules.map((item) => [item.id, Number(item.score ?? 0)]));

  let best: { id: DecisionSupportNutriScoreCardV2ModuleId; delta: number } | null = null;
  for (const id of [
    "formula_transparency",
    "testing_verification",
    "label_clarity",
    "product_quality",
    "manufacturing_standards",
    "ingredient_safety",
  ] satisfies DecisionSupportNutriScoreCardV2ModuleId[]) {
    const delta = (candidateScores.get(id) ?? 0) - (currentScores.get(id) ?? 0);
    if (delta <= 0) continue;
    if (!best || delta > best.delta) best = { id, delta };
  }
  return best?.id ?? null;
};

const buildAlternativeReason = (
  current: ComparisonOverlayAnalysis,
  candidate: ComparisonOverlayAnalysis,
): string | null => {
  if (current.categoryId === "fish_oil_omega3") {
    const currentHasBreakdown = detectOmegaBreakdown(current.digest, current.overlayClaims);
    const candidateHasBreakdown = detectOmegaBreakdown(candidate.digest, candidate.overlayClaims);
    if (candidateHasBreakdown && !currentHasBreakdown) {
      return "Clearer EPA + DHA breakdown";
    }
  }

  const moduleId = pickLargestModuleDelta(
    Array.isArray(current.payload.nutriScoreCardV2?.modules) ? current.payload.nutriScoreCardV2.modules : [],
    Array.isArray(candidate.payload.nutriScoreCardV2?.modules) ? candidate.payload.nutriScoreCardV2.modules : [],
  );

  switch (moduleId) {
    case "testing_verification":
      return "Stronger testing signals";
    case "label_clarity":
      return "More complete label detail";
    case "formula_transparency":
      return "Better formula transparency";
    case "product_quality":
      return "Better product quality signals";
    case "manufacturing_standards":
      return "Stronger manufacturing standards";
    case "ingredient_safety":
      return "Stronger ingredient safety profile";
    default:
      return "Better formula transparency";
  }
};

const fetchOverlayRowsByTitleKeyword = async (
  keyword: string,
  excludeBarcodeGtin14: string,
): Promise<ComparisonOverlayRow[]> => {
  const { data, error } = await supabase
    .from("iherb_overlay_products")
    .select(
      "product_id,barcode_gtin14,brand_name,title,link,product_catalog_image,product_images,categories,supplement_facts,description_sections,updated_at",
    )
    .ilike("title", `%${keyword}%`)
    .neq("barcode_gtin14", excludeBarcodeGtin14)
    .order("updated_at", { ascending: false })
    .limit(Math.floor(COMPARISON_MAX_CANDIDATES / 2));

  if (error) {
    console.warn("[comparison] title keyword fetch failed", { keyword, error: error.message });
    return [];
  }

  return Array.isArray(data) ? (data as ComparisonOverlayRow[]) : [];
};

const filterRowsBySharedCategories = (
  rows: ComparisonOverlayRow[],
  categories: string[],
): ComparisonOverlayRow[] => {
  if (categories.length === 0) return [];
  const categoryKeys = new Set(categories.map(normalizeTextKey).filter(Boolean));
  return rows.filter((row) => {
    const rowCategories = Array.isArray(row.categories) ? row.categories : [];
    return rowCategories.some((value) => categoryKeys.has(normalizeTextKey(value)));
  });
};

const fetchLatestOverlayRows = async (excludeBarcodeGtin14: string): Promise<ComparisonOverlayRow[]> => {
  const { data, error } = await supabase
    .from("iherb_overlay_products")
    .select(
      "product_id,barcode_gtin14,brand_name,title,link,product_catalog_image,product_images,categories,supplement_facts,description_sections,updated_at",
    )
    .neq("barcode_gtin14", excludeBarcodeGtin14)
    .order("updated_at", { ascending: false })
    .limit(COMPARISON_MAX_CANDIDATES);

  if (error) {
    console.warn("[comparison] latest overlay fetch failed", error.message);
    return [];
  }

  return Array.isArray(data) ? (data as ComparisonOverlayRow[]) : [];
};

const mergeUniqueRows = (...batches: ComparisonOverlayRow[][]): ComparisonOverlayRow[] => {
  const seen = new Set<string>();
  const merged: ComparisonOverlayRow[] = [];
  for (const batch of batches) {
    for (const row of batch) {
      const key =
        normalizeBarcode(row.barcode_gtin14) ??
        safeText(row.product_id) ??
        `${normalizeTextKey(row.brand_name)}::${normalizeTextKey(row.title)}`;
      if (!key || seen.has(key)) continue;
      seen.add(key);
      merged.push(row);
    }
  }
  return merged;
};

const computeComparisonStandingFromAnalyses = (
  input: ComparisonStandingComputationInput,
): DecisionSupportPersonalizedProductStandingBlock | null => {
  const benchmarkLabel = buildCategoryBenchmarkLabel(input.current.categoryId);
  const peerCount = input.peers.length + 1;
  const higherScoringPeers = input.peers
    .filter((item) => Number.isFinite(item.score) && Number(item.score) > Number(input.current.score))
    .sort((left, right) => Number(right.score ?? 0) - Number(left.score ?? 0));

  const alternativeKeys = new Set<string>();
  const betterAlternatives: DecisionSupportPersonalizedStandingAlternative[] = [];
  for (const peer of higherScoringPeers) {
    const dedupeKey = peer.dedupeKey;
    if (alternativeKeys.has(dedupeKey)) continue;
    const reason = buildAlternativeReason(input.current, peer);
    if (!reason) continue;
    alternativeKeys.add(dedupeKey);
    betterAlternatives.push({
      productId: peer.productId,
      title: peer.title,
      brand: peer.brand,
      imageUrl: peer.imageUrl,
      nutriScore: peer.score,
      nutriScoreBand: peer.scoreBand,
      reason,
    });
    if (betterAlternatives.length >= COMPARISON_MAX_ALTERNATIVES) break;
  }

  if (peerCount < COMPARISON_MIN_STANDING_PEERS && betterAlternatives.length < COMPARISON_MIN_ALTERNATIVES) {
    return null;
  }

  if (peerCount < COMPARISON_MIN_STANDING_PEERS) {
    return {
      status: "ready",
      reasonCode: null,
      summary: `Higher-scoring options for similar ${benchmarkLabel}`,
      secondarySummary: "Not enough comparable products yet",
      standing: "unknown",
      standingLabel: null,
      benchmarkLabel,
      percentile: null,
      peerCount,
      betterAlternatives,
    };
  }

  const percentile = compareStandingPercentile(peerCount, Number(input.current.score ?? 0), input.peers);
  const { standing, label } = mapStandingLabelFromPercentile(
    percentile ??
      Math.round(
        ((input.peers.filter((item) => Number(item.score ?? 0) < Number(input.current.score ?? 0)).length) /
          Math.max(peerCount, 1)) *
          100,
      ),
  );

  return {
    status: "ready",
    reasonCode: null,
    summary: label ? `${label} for similar ${benchmarkLabel}` : `Compared with similar ${benchmarkLabel}`,
    secondarySummary:
      percentile !== null
        ? `Better than ${percentile}% of ${peerCount} similar products`
        : `Based on ${peerCount} comparable products`,
    standing,
    standingLabel: label,
    benchmarkLabel,
    percentile,
    peerCount,
    betterAlternatives,
  };
};

const filterComparablePeers = (
  current: ComparisonOverlayAnalysis,
  rows: ComparisonOverlayRow[],
): ComparisonOverlayAnalysis[] => {
  const peers: ComparisonOverlayAnalysis[] = [];
  const seenPeerKeys = new Set<string>([current.dedupeKey]);

  for (const row of rows) {
    if (peers.length >= COMPARISON_MAX_FILTERED_PEERS) break;
    const analysis = analyzeOverlayRow(row);
    if (!analysis) continue;
    if (analysis.categoryId !== current.categoryId) continue;
    if (analysis.categoryId === "unknown" || analysis.categoryId === "out_of_scope_non_supplement") continue;
    if (analysis.formBucket !== current.formBucket) continue;
    if (current.familyKey && analysis.familyKey && analysis.familyKey !== current.familyKey) continue;
    if (!Number.isFinite(analysis.score)) continue;
    if (seenPeerKeys.has(analysis.dedupeKey)) continue;
    seenPeerKeys.add(analysis.dedupeKey);
    peers.push(analysis);
  }

  return peers;
};

const buildComparisonCacheKey = (params: ComparisonStandingParams): string => [
  params.barcodeGtin14,
  params.decisionSupport.digest,
  params.decisionSupport.categoryId,
  params.decisionSupport.nutriScoreCardV2?.overallScore ?? "na",
].join("|");

export const buildDecisionSupportComparisonStanding = async (
  params: ComparisonStandingParams,
): Promise<DecisionSupportPersonalizedProductStandingBlock | null> => {
  if (!params.overlayClaims) return null;
  if (!Number.isFinite(Number(params.decisionSupport.nutriScoreCardV2?.overallScore))) return null;
  if (
    params.decisionSupport.categoryId === "unknown" ||
    params.decisionSupport.categoryId === "out_of_scope_non_supplement"
  ) {
    return null;
  }

  const cacheKey = buildComparisonCacheKey(params);
  const cached = comparisonStandingCache.get(cacheKey);
  if (cached && cached.expiresAt > Date.now()) {
    return cached.value;
  }

  const existingInflight = comparisonStandingInflight.get(cacheKey);
  if (existingInflight) return existingInflight;

  const work = (async () => {
    const current: ComparisonOverlayAnalysis = {
      productId: params.overlayClaims?.productId ?? null,
      barcodeGtin14: params.barcodeGtin14,
      title: params.overlayClaims?.title ?? params.digest.product.name ?? "Supplement",
      brand: params.overlayClaims?.brandName ?? params.digest.product.brandDisplay ?? null,
      imageUrl: params.overlayClaims?.imageUrl ?? null,
      categoryId: params.decisionSupport.categoryId,
      score: params.decisionSupport.nutriScoreCardV2?.overallScore ?? null,
      scoreBand: params.decisionSupport.nutriScoreCardV2?.overallBand ?? null,
      formBucket: normalizeComparisonFormBucket(params.digest, params.overlayClaims),
      familyKey: buildComparisonFamilyKey(params.decisionSupport.categoryId, params.digest, params.overlayClaims),
      dedupeKey: buildDedupeKey(
        params.overlayClaims?.brandName ?? params.digest.product.brandDisplay ?? null,
        params.overlayClaims?.title ?? params.digest.product.name ?? "Supplement",
      ),
      digest: params.digest,
      overlayClaims: params.overlayClaims,
      payload: params.decisionSupport,
    };

    const keyword = buildComparisonSearchKeyword(
      current.categoryId,
      current.familyKey,
      current.overlayClaims.title,
    );
    const [keywordRows, latestRows] = await Promise.all([
      keyword ? fetchOverlayRowsByTitleKeyword(keyword, params.barcodeGtin14) : Promise.resolve([]),
      fetchLatestOverlayRows(params.barcodeGtin14),
    ]);
    const categoryRows = filterRowsBySharedCategories(latestRows, params.overlayClaims.categories);
    const mergedRows = mergeUniqueRows(categoryRows, keywordRows, latestRows);
    const peers = filterComparablePeers(current, mergedRows);
    return computeComparisonStandingFromAnalyses({ current, peers });
  })()
    .then((value) => {
      comparisonStandingCache.set(cacheKey, {
        value,
        expiresAt: Date.now() + COMPARISON_CACHE_TTL_MS,
      });
      return value;
    })
    .finally(() => {
      comparisonStandingInflight.delete(cacheKey);
    });

  comparisonStandingInflight.set(cacheKey, work);
  return work;
};

export const decisionSupportComparisonInternals = {
  analyzeOverlayRow,
  buildAlternativeReason,
  buildCategoryBenchmarkLabel,
  buildComparisonFamilyKey,
  buildComparisonSearchKeyword,
  buildDedupeKey,
  computeComparisonStandingFromAnalyses,
  detectOmegaBreakdown,
  extractTitleComparisonKeyword,
  filterRowsBySharedCategories,
  mapStandingLabelFromPercentile,
  normalizeComparisonFormBucket,
  toDecisionSupportOverlayClaims,
  toFactsDigest,
};
