#!/usr/bin/env node
/* eslint-disable no-console */
import fs from "node:fs/promises";
import path from "node:path";

const ROOT = process.cwd();
const TODAY = new Date().toISOString().slice(0, 10).replace(/-/g, "");
const args = process.argv.slice(2);

const getArg = (name, fallback = null) => {
  const flag = `--${name}`;
  const idx = args.indexOf(flag);
  if (idx === -1 || idx + 1 >= args.length) return fallback;
  return args[idx + 1];
};

const STAGING_PATH = getArg(
  "staging",
  path.join(ROOT, "output", "iherb_healthy_origins_p0_official_ocr_final_20260313", "staging_products.official_refreshed.json"),
);
const MERGE_REPORT_PATH = getArg(
  "merge-report",
  path.join(ROOT, "output", "iherb_overlay_bulk_merge_healthy_origins_final_20260313", "overlay_merge_coverage_report.json"),
);
const OUT_DIR = getArg(
  "out-dir",
  path.join(ROOT, "output", `iherb_header_facts_wave_${TODAY}`),
);

const DEFAULT_BRANDS = [
  "Nutricost",
  "Pure Encapsulations",
  "Metabolic Nutrition",
  "Micro Ingredients",
  "Vitamatic",
  "Nature's Truth",
  "Planetary Herbals",
];

const DEFAULT_SITE_ORIGINS = {
  "Nutricost": "https://nutricost.com",
  "Pure Encapsulations": "https://www.pureencapsulationspro.com",
  "Metabolic Nutrition": "https://www.metabolicnutrition.com",
  "Micro Ingredients": "https://www.microingredients.com",
  "Vitamatic": "https://vitamatic.com",
  "Nature's Truth": "https://naturestruth.com",
  "Planetary Herbals": "https://www.planetaryherbals.com",
};

const BRANDS = (() => {
  const raw = getArg("brands-json", null);
  if (!raw) return DEFAULT_BRANDS;
  const parsed = JSON.parse(raw);
  return Array.isArray(parsed) ? parsed.map((item) => String(item)) : DEFAULT_BRANDS;
})();
const {
  compileDecisionSupport,
} = await import("../../backend/src/decisionSupport.ts");
const {
  buildFactsDigestFromWeb,
  computeFactsDigestHash,
} = await import("../../backend/src/factsDigest.ts");
const {
  normalizeIherbSupplementFactsRows,
} = await import("../../backend/src/iherbOverlayIngredients.ts");
const {
  isNutritionLabelLikeIngredientName,
} = await import("../../backend/src/scoring/nutritionLabelLikeLexicon.ts");

const readJson = async (targetPath) => JSON.parse(await fs.readFile(targetPath, "utf8"));
const safeText = (value) => String(value ?? "").trim();
const hasText = (value) => safeText(value).length > 0;
const pct = (part, total) => total > 0 ? Number(((part / total) * 100).toFixed(1)) : 0;

const toObjectRecord = (value) =>
  value && typeof value === "object" && !Array.isArray(value)
    ? value
    : {};

const readSectionText = (sections, keys) => {
  for (const key of keys) {
    const value = sections[key];
    if (typeof value === "string" && value.trim().length > 0) return value.trim();
  }
  return null;
};

const deepClone = (value) => JSON.parse(JSON.stringify(value));

const normalizeWhitespace = (value) =>
  String(value ?? "")
    .replace(/\u00a0/g, " ")
    .replace(/\s+/g, " ")
    .trim();

const GENERIC_CATEGORY_TOKENS = new Set([
  "supplements",
  "sports",
  "brain cognitive",
  "brain cognitive support",
  "brain and cognitive",
  "mens health",
  "womens health",
  "beauty",
  "body care",
  "skin care",
  "muscle recovery supplements",
  "sports supplements",
  "vitamins",
  "minerals",
  "herbs",
  "amino acids",
  "sleep",
  "pre workout supplements",
  "non stim pre workout",
  "brain cognitive",
  "mens wellness",
  "wellness",
  "women s health",
  "bone joint muscle",
  "cardiovascular metabolic health",
  "vitamins minerals amino acids",
  "children s herbs",
  "liver formulas",
  "creatine blends",
  "sports fish oil omegas",
  "ginger root supplements",
  "coconut oil",
]);

const HEADER_VALUE_PATTERN =
  /^(amount per (serving|tablet|capsule|softgel|packet)|% ?daily value|daily value|serving size|servings per container)$/i;

const normalizeCategoryKey = (value) =>
  normalizeWhitespace(value)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();

const CATEGORY_KEYWORDS = (() => {
  const raw = getArg("category-keywords-json", null);
  if (!raw) return null;
  const parsed = JSON.parse(raw);
  if (!Array.isArray(parsed)) return null;
  const normalized = parsed
    .map((item) => normalizeCategoryKey(item))
    .filter(Boolean);
  return normalized.length > 0 ? normalized : null;
})();
const MAX_ROWS_PER_BRAND = (() => {
  const raw = getArg("max-rows-per-brand", null);
  if (!raw) return null;
  const parsed = Number(raw);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
})();
const BRAND_LIMIT_MAP = (() => {
  const raw = getArg("brand-limit-map-json", null);
  if (!raw) return {};
  const parsed = JSON.parse(raw);
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {};
  return Object.fromEntries(
    Object.entries(parsed)
      .map(([key, value]) => [String(key), Number(value)])
      .filter(([, value]) => Number.isFinite(value) && value > 0),
  );
})();

const normalizeTokenSet = (value) =>
  normalizeCategoryKey(value)
    .split(/\s+/)
    .filter((token) => token.length >= 4);

const isSpecificCategory = (value) => {
  const normalized = normalizeCategoryKey(value);
  if (!normalized) return false;
  if (GENERIC_CATEGORY_TOKENS.has(normalized)) return false;
  if (normalized.length < 4) return false;
  return !isNutritionLabelLikeIngredientName(normalized);
};

const cleanCategoryDisplay = (value) =>
  normalizeWhitespace(value)
    .replace(/\b(sports|supplements?|wellness|health|support|formulas?)\b/gi, " ")
    .replace(/\s*&\s*/g, " ")
    .replace(/\s+/g, " ")
    .trim();

const cleanCandidateName = (value) =>
  normalizeWhitespace(value)
    .replace(/[®™]/g, " ")
    .replace(/\b(natural|mixed|berry|fruit punch|blue raspberry|grape|green apple|watermelon|unflavored|unscented|vanilla|chocolate|strawberry)\b/gi, " ")
    .replace(/\b\d+(?:\.\d+)?\s*(mg|mcg|g|iu|oz|lb|lbs|ml|fl oz)\b/gi, " ")
    .replace(/\(\s*[^)]*(capsules?|softgels?|tablets?|gummies|count|g|mg|mcg|oz|lb|ml|fl oz)[^)]*\)/gi, " ")
    .replace(/\b\d+\s*(capsules?|softgels?|tablets?|gummies|caplets?|scoops?|servings?|packets?)\b/gi, " ")
    .replace(/\b(topical liquid|quick release|slow release|max potency|dietary supplement)\b/gi, " ")
    .replace(/[|/]+/g, " ")
    .replace(/\s+/g, " ")
    .replace(/^[,;:-]+|[,;:-]+$/g, "")
    .trim();

const extractAmountMatches = (value) => {
  const text = safeText(value);
  const matches = [];
  for (const match of text.matchAll(/(\d[\d,]*(?:\.\d+)?)\s*(mcg|μg|µg|ug|mg|g|iu)\b/gi)) {
    const amount = Number(String(match[1]).replace(/,/g, ""));
    const unit = String(match[2]).toLowerCase().replace(/^ug$|^μg$|^µg$/i, "mcg");
    const raw = `${match[1]} ${match[2]}`;
    if (Number.isFinite(amount) && amount > 0) {
      matches.push({
        amount,
        unit,
        raw,
        index: typeof match.index === "number" ? match.index : text.indexOf(match[0]),
      });
    }
  }
  return matches;
};

const choosePreferredDose = (title, servingSize) => {
  const titleMatches = extractAmountMatches(title);
  const servingMatches = extractAmountMatches(servingSize);

  const nonGramTitle = titleMatches.find((item) => item.unit !== "g");
  if (nonGramTitle) return nonGramTitle.raw;

  const servingDose = servingMatches[0]?.raw ?? null;
  if (servingDose) return servingDose;

  return titleMatches[0]?.raw ?? null;
};

const stripBrandPrefix = (title, brandName) => {
  const normalizedTitle = safeText(title);
  const brand = safeText(brandName);
  if (!brand) return normalizedTitle;
  const escaped = brand.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return normalizedTitle.replace(new RegExp(`^${escaped}\\s*,\\s*`, "i"), "");
};

const chooseSpecificCategory = (categories) =>
  (Array.isArray(categories) ? categories : [])
    .map((item) => safeText(item))
    .find((item) => isSpecificCategory(item))
  ?? null;

const isFormulaLike = (text) =>
  /\b(blend|complex|formula|matrix|support|daily|multi|stack|max|test|hydra|glycoload|amino\s*\d|shakercup)\b/i.test(text);

const classifyTitlePattern = (row, categoryName) => {
  const titleBody = stripBrandPrefix(row.title, row.brandName);
  const haystack = `${titleBody} | ${(row.categories ?? []).join(" | ")}`;
  if (/\bcollagen\b/i.test(haystack)) return "collagen";
  if (/\b(protein|whey|casein|pea protein|plant protein)\b/i.test(haystack)) return "protein";
  if (isFormulaLike(haystack)) return "formula";
  if (/\b(mushroom|herb|extract|root|berry|garlic|turmeric|curcumin|ashwagandha|echinacea)\b/i.test(haystack)) return "botanical";
  if (categoryName) return "single_ingredient";
  return "unknown";
};

const deriveTitleName = (row) => {
  const titleBody = stripBrandPrefix(row.title, row.brandName)
    .split(",")
    .map((item) => cleanCandidateName(item))
    .find(Boolean);
  if (!titleBody) return null;
  if (isFormulaLike(titleBody)) return null;
  if (/^(black|red|blue|green)\b/i.test(titleBody)) return null;
  return titleBody;
};

const categoryOverlapsTitle = (categoryName, title) => {
  const categoryTokens = normalizeTokenSet(categoryName);
  const titleTokens = new Set(normalizeTokenSet(title));
  return categoryTokens.some((token) => titleTokens.has(token));
};

const titleLooksBranded = (value) => {
  const normalized = safeText(value);
  if (!normalized) return false;
  if (/\d/.test(normalized)) return true;
  if (/^[A-Z0-9.\-+/ ]{2,}$/u.test(normalized)) return true;
  return normalized.split(/\s+/).length === 1 && normalized.length <= 8;
};

const matchesCategoryKeywords = (row) => {
  if (!Array.isArray(CATEGORY_KEYWORDS) || CATEGORY_KEYWORDS.length === 0) return true;
  const haystack = normalizeCategoryKey([
    safeText(row?.title),
    ...(Array.isArray(row?.categories) ? row.categories.map((item) => safeText(item)) : []),
  ].join(" | "));
  if (!haystack) return false;
  return CATEGORY_KEYWORDS.some((keyword) => {
    const escaped = keyword.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    return new RegExp(`(^| )${escaped}($| )`, "i").test(haystack);
  });
};

const brandWithinLimit = (brandCounts, brandName) => {
  const limit = BRAND_LIMIT_MAP[brandName] ?? MAX_ROWS_PER_BRAND ?? null;
  if (!Number.isFinite(limit) || limit <= 0) return true;
  return (brandCounts[brandName] ?? 0) < limit;
};

const toOverlayClaims = (row) => {
  const descriptionSections = toObjectRecord(row.descriptionSections);
  const supplementFacts = toObjectRecord(row.supplementFacts);
  const nutritionalFactsRaw = Array.isArray(supplementFacts.nutritionalFacts)
    ? supplementFacts.nutritionalFacts
    : [];

  return {
    provider: "iherb",
    productId: hasText(row.productId) ? String(row.productId) : null,
    brandName: hasText(row.brandName) ? String(row.brandName) : null,
    title: hasText(row.title) ? String(row.title) : null,
    link: hasText(row.link) ? String(row.link) : null,
    categories: Array.isArray(row.categories)
      ? row.categories.map((item) => safeText(item)).filter(Boolean)
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
        dailyValuePercent: safeText(item?.dailyValuePercent ?? item?.daily_value_percent ?? item?.dailyValue) || null,
      }))
      .filter((item) => item.substancy || item.amountPerServing || item.dailyValuePercent),
  };
};

const toIngredientsText = (overlayClaims) =>
  normalizeIherbSupplementFactsRows(overlayClaims?.nutritionalFacts)
    .map((row) => [safeText(row?.name), safeText(row?.dose)].filter(Boolean).join(" "))
    .filter(Boolean)
    .join("\n");

const toFactsDigest = (row, overlayClaims) => {
  const serving = toObjectRecord(row.serving);
  const supplementFacts = toObjectRecord(row.supplementFacts);
  const digest = buildFactsDigestFromWeb({
    facts: {
      barcode: safeText(row.barcode_gtin14),
      canonical: {
        name: hasText(row.title) ? String(row.title) : null,
        brand: hasText(row.brandName) ? String(row.brandName) : null,
        url: hasText(row.link) ? String(row.link) : null,
        domain: "iherb.com",
      },
      identifiers: { npn: null },
      textFacts: {
        ingredientsText: toIngredientsText(overlayClaims) || null,
        directionsText: overlayClaims?.suggestedUse ?? null,
        warningsText: overlayClaims?.warnings ?? null,
        servingSizeText:
          safeText(supplementFacts.servingSize) ||
          safeText(serving.servingSize) ||
          null,
      },
      coverageScore: 1,
      missingFields: [],
    },
    identityType: "gtin14",
    identityValue: safeText(row.barcode_gtin14),
    regionTags: ["us"],
  });

  digest.product.dosageForm =
    safeText(row.dosageForm) && safeText(row.dosageForm).toLowerCase() !== "n/a"
      ? safeText(row.dosageForm)
      : digest.product.dosageForm;
  digest.product.route = null;
  return digest;
};

const getDeepContentStatus = (payload) => {
  const overview = payload?.overviewBlock;
  const science = payload?.scienceBlock;
  const usage = payload?.usageBlock;
  const safety = payload?.safetyBlock;

  const overviewOk =
    Array.isArray(overview?.bestForBullets) && overview.bestForBullets.length > 0
    && Array.isArray(overview?.providesVerified?.keyIngredients) && overview.providesVerified.keyIngredients.length > 0;
  const scienceOk =
    Array.isArray(science?.ingredientRows) && science.ingredientRows.length > 0
    && Array.isArray(science?.aiSummaryContract3) && science.aiSummaryContract3.length === 3;
  const usageOk =
    hasText(usage?.directions?.text)
    && Array.isArray(usage?.directions?.lines) && usage.directions.lines.length > 0;
  const safetyOk =
    (Array.isArray(safety?.labelWarnings) && safety.labelWarnings.length > 0)
    || (Array.isArray(safety?.generalWatchouts) && safety.generalWatchouts.length > 0)
    || (Array.isArray(safety?.ulGuidance) && safety.ulGuidance.length > 0);

  return {
    ready: overviewOk && scienceOk && usageOk && safetyOk,
    overviewOk,
    scienceOk,
    usageOk,
    safetyOk,
    ingredientRows: Array.isArray(science?.ingredientRows) ? science.ingredientRows.length : 0,
    keyIngredients: Array.isArray(overview?.providesVerified?.keyIngredients)
      ? overview.providesVerified.keyIngredients.length
      : 0,
  };
};

const classifyFactType = (row) => {
  const facts = Array.isArray(row?.supplementFacts?.nutritionalFacts) ? row.supplementFacts.nutritionalFacts : [];
  const substanceRows = facts.filter((item) => hasText(item?.substancy));
  const normalized = normalizeIherbSupplementFactsRows(facts);

  if (normalized.length > 0) return "has_extractable_ingredients";
  if (substanceRows.length === 0 || substanceRows.every((item) => HEADER_VALUE_PATTERN.test(safeText(item?.substancy)))) {
    return "header_only_facts";
  }

  const nutritionLikeCount = substanceRows.filter((item) =>
    isNutritionLabelLikeIngredientName(safeText(item?.substancy))).length;

  if (nutritionLikeCount === substanceRows.length) return "nutrition_only_facts";
  return "named_rows_unparsed";
};

const buildPayload = (row) => {
  const overlayClaims = toOverlayClaims(row);
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
  return { overlayClaims, digest, payload };
};

const createSyntheticFactRow = (name, dose) => ({
  substancy: name,
  amountPerServing: dose ?? "",
  dailyValuePercent: null,
});

const deriveParserCandidate = (row) => {
  const categoryName = chooseSpecificCategory(row.categories);
  const titleName = deriveTitleName(row);
  const titlePattern = classifyTitlePattern(row, categoryName);
  const cleanedCategoryName = cleanCategoryDisplay(categoryName);
  const useCategoryName =
    hasText(cleanedCategoryName)
    && (categoryOverlapsTitle(cleanedCategoryName, row.title) || !hasText(titleName) || titleLooksBranded(titleName));
  const chosenName = useCategoryName ? cleanedCategoryName : (titleName ?? cleanedCategoryName);
  const chosenDose = choosePreferredDose(row.title, row?.supplementFacts?.servingSize ?? row?.serving?.servingSize ?? null);

  let confidence = 0;
  if (useCategoryName) confidence += 0.35;
  if (titleName && chosenName === titleName) confidence += 0.35;
  if (titleName && chosenName !== titleName) confidence += 0.1;
  if (chosenDose) confidence += 0.2;
  if (["single_ingredient", "collagen", "protein", "botanical"].includes(titlePattern)) confidence += 0.2;
  if (titlePattern === "formula") confidence -= 0.25;
  if (!chosenName) confidence -= 0.3;

  const parserReady = confidence >= 0.7 && hasText(chosenName);

  return {
    titlePattern,
    categoryName: cleanedCategoryName || null,
    titleName,
    chosenName: chosenName ?? null,
    chosenDose,
    confidence: Number(confidence.toFixed(2)),
    parserReady,
  };
};

const enrichRowWithParser = (row, parserCandidate) => {
  const cloned = deepClone(row);
  const supplementFacts = toObjectRecord(cloned.supplementFacts);
  const existingFacts = Array.isArray(supplementFacts.nutritionalFacts) ? supplementFacts.nutritionalFacts : [];
  const retainedFacts = existingFacts.filter((item) => {
    const substancy = safeText(item?.substancy ?? item?.substance ?? item?.name);
    if (!substancy) return false;
    return !HEADER_VALUE_PATTERN.test(substancy);
  });

  retainedFacts.push(createSyntheticFactRow(parserCandidate.chosenName, parserCandidate.chosenDose));

  cloned.supplementFacts = {
    ...supplementFacts,
    nutritionalFacts: retainedFacts,
  };
  cloned.maintainerHeaderFactsWave = {
    wave: "header_facts_v1",
    parser: parserCandidate,
    generatedAt: new Date().toISOString(),
  };
  return cloned;
};

const detectPlatform = (html) => {
  const lower = String(html ?? "").toLowerCase();
  if (lower.includes("cdn.shopify.com") || lower.includes("shopify.theme") || lower.includes("/cdn/shop/")) return "shopify";
  if (lower.includes("wp-content")) return "wordpress";
  if (lower.includes("mage") || lower.includes("magento")) return "magento";
  return "custom";
};

const fetchText = async (targetUrl) => {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 15000);
  try {
    const response = await fetch(targetUrl, {
      signal: controller.signal,
      headers: {
        Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        "User-Agent": "Mozilla/5.0",
      },
      redirect: "follow",
    });
    const text = await response.text();
    return { ok: response.ok, status: response.status, text };
  } catch (error) {
    return { ok: false, status: 0, text: "", error: error instanceof Error ? error.message : String(error) };
  } finally {
    clearTimeout(timeout);
  }
};

const discoverBrandSource = async (brandName) => {
  const siteOrigin = DEFAULT_SITE_ORIGINS[brandName] ?? null;
  if (!siteOrigin) {
    return {
      brandName,
      siteOrigin: null,
      platform: "unknown",
      hasJsonLd: false,
      hasCatalogApi: false,
      recommendedStrategy: "rapidapi_identity_only",
    };
  }

  const home = await fetchText(siteOrigin);
  const platform = detectPlatform(home.text);
  const hasJsonLd = /application\/ld\+json/i.test(home.text);

  let hasCatalogApi = false;
  if (platform === "shopify") {
    const catalog = await fetchText(`${siteOrigin.replace(/\/+$/, "")}/products.json?limit=1&page=1`);
    hasCatalogApi = catalog.ok && /"products"\s*:/i.test(catalog.text);
  }

  let recommendedStrategy = "official_search_then_page";
  if (brandName === "Pure Encapsulations") {
    recommendedStrategy = "existing_official_fallback_template";
  } else if (platform === "shopify" && hasCatalogApi) {
    recommendedStrategy = "shopify_catalog_then_product_json";
  } else if (platform === "magento") {
    recommendedStrategy = "magento_search_then_product_page";
  }

  return {
    brandName,
    siteOrigin,
    platform,
    hasJsonLd,
    hasCatalogApi,
    recommendedStrategy,
  };
};

const toOfficialQueueEntry = (row, sourceMatrixRow) => ({
  priorityLane: "deep_gap_header_only_official_wave",
  recommendedAction:
    sourceMatrixRow?.recommendedStrategy === "shopify_catalog_then_product_json"
      ? "official_fill_from_shopify_structured_data"
      : "official_fill_from_product_page",
  rationale: "Deep-gap header-only row unresolved after parser-first. Next step is official structured fetch.",
  brandName: safeText(row.brandName),
  title: safeText(row.title),
  productId: safeText(row.productId),
  barcode_gtin14: safeText(row.barcode_gtin14),
  upcCode: safeText(row.upcCode),
  hasUsIherbPage: true,
  highConfidenceUsProductPageReady: true,
  coreResolvedFields: ["suggested_use", "warnings"],
  coreMissingFields: ["ingredient", "dosage"],
  sourceTypes: ["iherb_us_product_page"],
});

const toMarkdown = (report) => {
  const lines = [];
  lines.push("# iHerb Header Facts Wave");
  lines.push("");
  lines.push(`- generatedAt: ${report.generatedAt}`);
  lines.push(`- cohortTotal: ${report.summary.cohortTotal}`);
  lines.push(`- parserPromotedToDeepReady: ${report.summary.parserPromotedToDeepReady}/${report.summary.cohortTotal} (${report.summary.parserPromotedPercent}%)`);
  lines.push(`- unresolvedAfterParser: ${report.summary.unresolvedAfterParser}`);
  lines.push(`- previewDeepContentReadyUplift: ${report.summary.previewDeepContentReadyBefore} -> ${report.summary.previewDeepContentReadyAfter}`);
  lines.push("");
  lines.push("## Brand Breakdown");
  lines.push("");
  for (const row of report.brandBreakdown) {
    lines.push(`- ${row.brand}: cohort=${row.cohort} | parserPromoted=${row.parserPromoted} | unresolved=${row.unresolved}`);
  }
  lines.push("");
  lines.push("## Source Matrix");
  lines.push("");
  for (const row of report.sourceMatrix) {
    lines.push(`- ${row.brandName}: platform=${row.platform} | catalogApi=${row.hasCatalogApi} | jsonLd=${row.hasJsonLd} | strategy=${row.recommendedStrategy}`);
  }
  lines.push("");
  lines.push("## Title Patterns");
  lines.push("");
  Object.entries(report.titlePatternCounts)
    .sort((a, b) => b[1] - a[1])
    .forEach(([key, value]) => {
      lines.push(`- ${key}: ${value}`);
    });
  lines.push("");
  lines.push("## Next Actions");
  lines.push("");
  Object.entries(report.nextActionCounts)
    .sort((a, b) => b[1] - a[1])
    .forEach(([key, value]) => {
      lines.push(`- ${key}: ${value}`);
    });
  lines.push("");
  lines.push("## Sample Promotions");
  lines.push("");
  for (const sample of report.samples.parserPromoted.slice(0, 20)) {
    lines.push(`- ${sample.brandName} | ${sample.title} | parser=${sample.parserCandidate.chosenName}${sample.parserCandidate.chosenDose ? ` ${sample.parserCandidate.chosenDose}` : ""}`);
  }
  lines.push("");
  lines.push("## Sample Unresolved");
  lines.push("");
  for (const sample of report.samples.unresolved.slice(0, 20)) {
    lines.push(`- ${sample.brandName} | ${sample.title} | pattern=${sample.parserCandidate.titlePattern} | next=${sample.nextAction}`);
  }
  return `${lines.join("\n")}\n`;
};

const main = async () => {
  const stagingPayload = await readJson(STAGING_PATH);
  const mergePayload = await readJson(MERGE_REPORT_PATH);
  const products = Array.isArray(stagingPayload?.products) ? stagingPayload.products : [];
  const matchedIds = new Set(
    (Array.isArray(mergePayload?.rows) ? mergePayload.rows : [])
      .filter((row) => row?.mergeDecision === "matched")
      .map((row) => String(row?.productId ?? "")),
  );

  const sourceMatrix = [];
  for (const brand of BRANDS) {
    sourceMatrix.push(await discoverBrandSource(brand));
  }
  const sourceMatrixByBrand = Object.fromEntries(sourceMatrix.map((row) => [row.brandName, row]));

  const previewProducts = deepClone(products);
  const previewProductById = new Map(previewProducts.map((row) => [String(row.productId ?? ""), row]));

  const cohort = [];
  let previewDeepContentReadyBefore = 0;
  let previewDeepContentReadyAfter = 0;
  const titlePatternCounts = {};
  const nextActionCounts = {};
  const brandBreakdownMap = {};
  const brandCounts = {};
  const parserPromoted = [];
  const unresolved = [];
  const parserSeeds = [];
  const officialQueue = [];

  for (const row of products) {
    if (!matchedIds.has(String(row?.productId ?? ""))) continue;
    if (!BRANDS.includes(safeText(row.brandName))) continue;
    if (!matchesCategoryKeywords(row)) continue;
    if (!brandWithinLimit(brandCounts, safeText(row.brandName))) continue;

    const initial = buildPayload(row);
    const deepStatus = getDeepContentStatus(initial.payload);
    if (deepStatus.ready) continue;

    const factType = classifyFactType(row);
    if (factType !== "header_only_facts") continue;

    previewDeepContentReadyBefore += 0;
    const parserCandidate = deriveParserCandidate(row);
    titlePatternCounts[parserCandidate.titlePattern] = (titlePatternCounts[parserCandidate.titlePattern] ?? 0) + 1;

    const brand = safeText(row.brandName);
    brandCounts[brand] = (brandCounts[brand] ?? 0) + 1;
    if (!brandBreakdownMap[brand]) {
      brandBreakdownMap[brand] = { brand, cohort: 0, parserPromoted: 0, unresolved: 0 };
    }
    brandBreakdownMap[brand].cohort += 1;

    const cohortRow = {
      brandName: brand,
      productId: safeText(row.productId),
      barcode_gtin14: safeText(row.barcode_gtin14),
      title: safeText(row.title),
      factType,
      missingBlocks: {
        overview: !deepStatus.overviewOk,
        science: !deepStatus.scienceOk,
        usage: !deepStatus.usageOk,
        safety: !deepStatus.safetyOk,
      },
      parserCandidate,
      sourceStrategy: sourceMatrixByBrand[brand]?.recommendedStrategy ?? "official_search_then_page",
      titlePattern: parserCandidate.titlePattern,
    };

    if (parserCandidate.parserReady) {
      const enrichedRow = enrichRowWithParser(row, parserCandidate);
      const enriched = buildPayload(enrichedRow);
      const enrichedStatus = getDeepContentStatus(enriched.payload);
      cohortRow.postParser = {
        ready: enrichedStatus.ready,
        ingredientRows: enrichedStatus.ingredientRows,
        keyIngredients: enrichedStatus.keyIngredients,
      };

      if (enrichedStatus.ready) {
        previewDeepContentReadyAfter += 1;
        parserSeeds.push({
          productId: safeText(row.productId),
          brandName: brand,
          title: safeText(row.title),
          parserCandidate,
          syntheticFactRow: createSyntheticFactRow(parserCandidate.chosenName, parserCandidate.chosenDose),
        });
        const previewTarget = previewProductById.get(safeText(row.productId));
        if (previewTarget) {
          Object.assign(previewTarget, enrichedRow);
        }
        parserPromoted.push({
          ...cohortRow,
          postParser: cohortRow.postParser,
        });
        brandBreakdownMap[brand].parserPromoted += 1;
        cohort.push(cohortRow);
        continue;
      }
    }

    previewDeepContentReadyAfter += 0;
    brandBreakdownMap[brand].unresolved += 1;
    const nextAction = sourceMatrixByBrand[brand]?.recommendedStrategy === "shopify_catalog_then_product_json"
      ? "official_structured_fetch"
      : "official_page_then_ocr";
    nextActionCounts[nextAction] = (nextActionCounts[nextAction] ?? 0) + 1;
    const unresolvedRow = {
      ...cohortRow,
      nextAction,
    };
    unresolved.push(unresolvedRow);
    officialQueue.push(toOfficialQueueEntry(row, sourceMatrixByBrand[brand]));
    cohort.push(unresolvedRow);
  }

  const brandBreakdown = Object.values(brandBreakdownMap).sort((a, b) => b.cohort - a.cohort);

  const report = {
    schemaVersion: "iherb_header_facts_wave.v1",
    generatedAt: new Date().toISOString(),
    inputs: {
      stagingPath: path.relative(ROOT, STAGING_PATH),
      mergeReportPath: path.relative(ROOT, MERGE_REPORT_PATH),
      brands: BRANDS,
      categoryKeywords: CATEGORY_KEYWORDS,
      maxRowsPerBrand: MAX_ROWS_PER_BRAND,
      brandLimitMap: BRAND_LIMIT_MAP,
    },
    summary: {
      cohortTotal: cohort.length,
      parserPromotedToDeepReady: parserPromoted.length,
      parserPromotedPercent: pct(parserPromoted.length, cohort.length),
      unresolvedAfterParser: unresolved.length,
      previewDeepContentReadyBefore,
      previewDeepContentReadyAfter: parserPromoted.length,
    },
    brandBreakdown,
    sourceMatrix,
    titlePatternCounts,
    nextActionCounts,
    samples: {
      parserPromoted,
      unresolved,
    },
  };

  await fs.mkdir(OUT_DIR, { recursive: true });
  const cohortPath = path.join(OUT_DIR, "cohort.json");
  const sourceMatrixPath = path.join(OUT_DIR, "source_matrix.json");
  const parserSeedsPath = path.join(OUT_DIR, "parser_seed.json");
  const officialQueuePath = path.join(OUT_DIR, "unresolved_official_queue.json");
  const previewStagingPath = path.join(OUT_DIR, "staging_products.parser_enriched.json");
  const reportJsonPath = path.join(OUT_DIR, "wave_report.json");
  const reportMdPath = path.join(OUT_DIR, "wave_report.md");

  await fs.writeFile(cohortPath, `${JSON.stringify(cohort, null, 2)}\n`, "utf8");
  await fs.writeFile(sourceMatrixPath, `${JSON.stringify(sourceMatrix, null, 2)}\n`, "utf8");
  await fs.writeFile(parserSeedsPath, `${JSON.stringify(parserSeeds, null, 2)}\n`, "utf8");
  await fs.writeFile(officialQueuePath, `${JSON.stringify(officialQueue, null, 2)}\n`, "utf8");
  await fs.writeFile(previewStagingPath, `${JSON.stringify({ ...stagingPayload, products: previewProducts }, null, 2)}\n`, "utf8");
  await fs.writeFile(reportJsonPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
  await fs.writeFile(reportMdPath, toMarkdown(report), "utf8");

  console.log(JSON.stringify({
    ok: true,
    summary: report.summary,
    outputs: {
      cohort: path.relative(ROOT, cohortPath),
      sourceMatrix: path.relative(ROOT, sourceMatrixPath),
      parserSeed: path.relative(ROOT, parserSeedsPath),
      unresolvedOfficialQueue: path.relative(ROOT, officialQueuePath),
      previewStaging: path.relative(ROOT, previewStagingPath),
      report: path.relative(ROOT, reportMdPath),
    },
  }, null, 2));
};

main().catch((error) => {
  console.error(error instanceof Error ? error.stack : String(error));
  process.exit(1);
});
