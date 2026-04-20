import fs from "node:fs/promises";
import path from "node:path";

import { ROOT_DIR, writeJson, writeText } from "./science-validation-reporting.mjs";

const CATEGORY_ORDER = [
  "promote_now",
  "stable_candidate_pool",
  "large_canary",
  "keep_nightly",
  "residual",
  "needs_data_fix",
  "skip_duplicate_coverage",
];

const RESIDUAL_BUCKETS = new Set([
  "personal_care_boundary",
  "pure_grocery_boundary",
]);

const BUCKET_WEIGHTS = {
  source_protein_boundary: 34,
  omega_source_oil_boundary: 30,
  sports_hydration_boundary: 28,
  tea_beverage_boundary: 25,
  greens_superfood_boundary: 23,
  condiment_sweetener_boundary: 22,
  snack_bar_boundary: 18,
  unclassified_food_like_boundary: 10,
};

const RISK_TAG_WEIGHTS = {
  source_sensitive: 45,
  allergy_or_dietary_source: 34,
  search_detail_route_risk: 32,
  supplement_signal_overlap: 24,
  sports_context_route: 16,
  beverage_context_honesty: 14,
  food_context_honesty: 12,
  barcode_exact: 8,
};

const TITLE_SIGNAL_WEIGHTS = [
  { pattern: /\b(?:whey|casein|soy protein|pea protein|protein powder|protein bar)\b/i, score: 28, reason: "protein_source_user_visible" },
  { pattern: /\b(?:fish oil|krill|shellfish|algal|algae oil|omega|dha|epa|mct|brain octane)\b/i, score: 26, reason: "source_oil_user_visible" },
  { pattern: /\b(?:melatonin|sleepytime|bedtime|sleep)\b/i, score: 24, reason: "sleep_boundary_user_visible" },
  { pattern: /\b(?:caffeine|energy powder|energy drink|green coffee|green tea)\b/i, score: 22, reason: "stimulant_boundary_user_visible" },
  { pattern: /\b(?:kids?|kidz|children)\b/i, score: 20, reason: "kids_context_user_visible" },
  { pattern: /\b(?:coconut aminos|soy sauce|soy-free|tamari)\b/i, score: 18, reason: "condiment_source_user_visible" },
  { pattern: /\b(?:greens?|superfood|spirulina|chlorella|matcha)\b/i, score: 16, reason: "greens_boundary_user_visible" },
  { pattern: /\b(?:drink mix|electrolyte|hydration|energy gel|go gel|chews?)\b/i, score: 14, reason: "drink_or_sports_route_user_visible" },
];

const BUCKET_INFERENCE_RULES = [
  { bucket: "source_protein_boundary", pattern: /\b(?:whey|casein|soy protein|pea protein|protein\s+(?:powder|bar)|pure whey|isolate)\b/i },
  { bucket: "sports_hydration_boundary", pattern: /\b(?:hydration|electrolyte|drink mix|energy gel|go gel|energy chews?|pre[-\s]*workout)\b/i },
  { bucket: "omega_source_oil_boundary", pattern: /\b(?:omega|dha|epa|fish oil|krill|cod liver|salmon oil|algal|algae oil|mct|brain octane)\b/i },
  { bucket: "greens_superfood_boundary", pattern: /\b(?:greens?|superfood|spirulina|chlorella|maca|matcha)\b/i },
  { bucket: "tea_beverage_boundary", pattern: /\b(?:tea bags?|herbal tea|coffee|latte|beverage|smoothie)\b/i },
  { bucket: "snack_bar_boundary", pattern: /\b(?:snack|cookie|cracker|chips?|candy|chocolate|gummy|chews?)\b/i },
  { bucket: "condiment_sweetener_boundary", pattern: /\b(?:coconut aminos|soy sauce replacement|sauce|syrup|honey|sweetener|tamari|seasoning|salt\b|dressing)\b/i },
  { bucket: "personal_care_boundary", pattern: /\b(?:mouth rinse|balm|skin care|body care)\b/i },
  { bucket: "pure_grocery_boundary", pattern: /\b(?:pasta|beans?\b|cereal|pancake|baking powder|olive oil|coconut oil)\b/i },
];

const normalizeText = (value) =>
  String(value ?? "")
    .replace(/\s+/g, " ")
    .trim();

const normalizeLoose = (value) =>
  normalizeText(value)
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[®™†]/g, "")
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();

const toArray = (value) => (Array.isArray(value) ? value : []);

const uniqueBy = (items, selector) => {
  const seen = new Set();
  const selected = [];
  for (const item of items) {
    const key = selector(item);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    selected.push(item);
  }
  return selected;
};

const scenarioProductId = (scenario) =>
  normalizeText(
    scenario?.productId
      ?? scenario?.product_id
      ?? scenario?.product?.productId
      ?? scenario?.product?.id
      ?? scenario?.input?.productId
      ?? scenario?.input?.searchResultSeed?.productId
      ?? scenario?.expected?.consistency?.productId,
  );

const scenarioBarcode = (scenario) =>
  normalizeText(
    scenario?.barcode
      ?? scenario?.barcodeGtin14
      ?? scenario?.barcode_gtin14
      ?? scenario?.upcCode
      ?? scenario?.product?.barcode
      ?? scenario?.input?.barcode
      ?? scenario?.input?.barcodeGtin14
      ?? scenario?.input?.searchResultSeed?.barcode
      ?? scenario?.input?.searchResultSeed?.upcCode
      ?? scenario?.expected?.consistency?.barcode,
  );

const scenarioBrand = (scenario) =>
  normalizeText(
    scenario?.brandName
      ?? scenario?.brand
      ?? scenario?.brand_name
      ?? scenario?.product?.brand
      ?? scenario?.input?.searchResultSeed?.brand,
  );

const scenarioTitle = (scenario) =>
  normalizeText(
    scenario?.title
      ?? scenario?.name
      ?? scenario?.productName
      ?? scenario?.product?.name
      ?? scenario?.input?.searchResultSeed?.name,
  );

const scenarioBucket = (scenario) =>
  normalizeText(scenario?.bucket ?? scenario?.routeHonesty?.bucket)
  || (
    normalizeText(scenario?.category) !== "food_like"
      ? normalizeText(scenario?.category)
      : ""
  )
  || BUCKET_INFERENCE_RULES.find((rule) => rule.pattern.test(scenarioTitle(scenario)))?.bucket
  || normalizeText(scenario?.category)
  || "unknown";

const scenarioRiskTags = (scenario) =>
  toArray(scenario?.riskTags ?? scenario?.routeHonesty?.riskTags)
    .map(normalizeText)
    .filter(Boolean);

const stripPackageNoise = (value) =>
  normalizeLoose(value)
    .replace(/\b\d+(?:\.\d+)?\s*(?:oz|fl oz|lb|lbs|g|kg|mg|mcg|ml|l|ct|count|packets?|packs?|servings?|tea bags?|softgels?|capsules?|tablets?|bars?)\b/g, " ")
    .replace(/\b(?:chocolate|vanilla|strawberry|berry|cheddar|ranch|mixed|lemon|ginger|orange|mango|pineapple|green apple|milkshake|fudge|caramel|cream|creamy|flavored|flavour|unsweetened)\b/g, " ")
    .replace(/\s+/g, " ")
    .trim();

const escapeRegExp = (value) =>
  String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

const slugifyUnderscore = (value) =>
  normalizeLoose(value)
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");

const productLineKey = ({ brand, title, bucket }) => {
  const normalizedBrand = normalizeLoose(brand);
  const parts = normalizeText(title)
    .split(",")
    .map((part) => part.trim())
    .filter(Boolean);
  let line = "";
  if (parts.length >= 2 && normalizeLoose(parts[0]).includes(normalizedBrand.split(" ")[0] ?? "")) {
    line = parts[1];
  } else if (parts.length >= 2) {
    line = parts[0];
  } else {
    line = normalizeText(title).replace(new RegExp(`^${escapeRegExp(brand)}\\b`, "i"), "");
  }
  const normalizedLine = stripPackageNoise(line);
  return [normalizeLoose(bucket), normalizedBrand, normalizedLine].filter(Boolean).join("::");
};

const productLineName = ({ brand, title }) => {
  const normalizedBrand = normalizeLoose(brand);
  const parts = normalizeText(title)
    .split(",")
    .map((part) => part.trim())
    .filter(Boolean);
  if (parts.length >= 2 && normalizeLoose(parts[0]).includes(normalizedBrand.split(" ")[0] ?? "")) {
    return parts[1];
  }
  if (parts.length >= 2) return parts[0];
  return normalizeText(title).replace(new RegExp(`^${escapeRegExp(brand)}\\b`, "i"), "").trim();
};

const canarySlug = (candidate, { includeProductId = false } = {}) => {
  const line = stripPackageNoise(productLineName({
    brand: candidate.brandName,
    title: candidate.title,
  }))
    .split(/\s+/)
    .slice(0, 5)
    .join(" ");
  const base = `${candidate.brandName ?? "unknown"} ${line || candidate.title || candidate.productId}`;
  return slugifyUnderscore(includeProductId ? `${base} ${candidate.productId ?? ""}` : base);
};

const buildStableCoverage = (stableScenarios) => {
  const productIds = new Set();
  const barcodes = new Set();
  const familyKeys = new Set();
  for (const scenario of toArray(stableScenarios)) {
    const productId = scenarioProductId(scenario);
    const barcode = scenarioBarcode(scenario);
    const brand = scenarioBrand(scenario);
    const title = scenarioTitle(scenario);
    const bucket = scenarioBucket(scenario);
    if (productId) productIds.add(productId);
    if (barcode) barcodes.add(barcode);
    const familyKey = productLineKey({ brand, title, bucket });
    if (familyKey) familyKeys.add(familyKey);
  }
  return { productIds, barcodes, familyKeys };
};

const dataFixReasons = (candidate) => {
  const missing = [];
  if (!scenarioProductId(candidate)) missing.push("productId");
  if (!scenarioBarcode(candidate)) missing.push("barcode");
  if (!scenarioBrand(candidate)) missing.push("brand");
  if (!scenarioTitle(candidate)) missing.push("title");
  return missing;
};

const duplicateReason = ({ candidate, coverage }) => {
  const productId = scenarioProductId(candidate);
  const barcode = scenarioBarcode(candidate);
  const familyKey = productLineKey({
    brand: scenarioBrand(candidate),
    title: scenarioTitle(candidate),
    bucket: scenarioBucket(candidate),
  });
  if (productId && coverage.productIds.has(productId)) return "exact_product_already_in_stable_gate";
  if (barcode && coverage.barcodes.has(barcode)) return "exact_barcode_already_in_stable_gate";
  if (familyKey && coverage.familyKeys.has(familyKey)) return "brand_product_line_already_represented";
  return null;
};

const computePromotionScore = (candidate) => {
  const bucket = scenarioBucket(candidate);
  const riskTags = scenarioRiskTags(candidate);
  const title = scenarioTitle(candidate);
  let score = BUCKET_WEIGHTS[bucket] ?? 0;
  const reasons = [];
  if (BUCKET_WEIGHTS[bucket]) reasons.push(`bucket:${bucket}`);
  for (const tag of riskTags) {
    const weight = RISK_TAG_WEIGHTS[tag] ?? 0;
    if (weight > 0) {
      score += weight;
      reasons.push(`tag:${tag}`);
    }
  }
  for (const signal of TITLE_SIGNAL_WEIGHTS) {
    if (signal.pattern.test(title)) {
      score += signal.score;
      reasons.push(signal.reason);
    }
  }
  return { score, reasons: [...new Set(reasons)] };
};

const isResidualCandidate = (candidate, promotionScore) => {
  const bucket = scenarioBucket(candidate);
  const riskTags = scenarioRiskTags(candidate);
  if (RESIDUAL_BUCKETS.has(bucket)) return true;
  if (bucket === "unclassified_food_like_boundary" && !riskTags.includes("source_sensitive")) return true;
  return promotionScore < 45;
};

const decorateCandidate = (candidate) => {
  const { score, reasons } = computePromotionScore(candidate);
  return {
    ...candidate,
    productId: scenarioProductId(candidate) || null,
    barcode: scenarioBarcode(candidate) || null,
    brandName: scenarioBrand(candidate) || null,
    title: scenarioTitle(candidate) || null,
    bucket: scenarioBucket(candidate),
    riskTags: scenarioRiskTags(candidate),
    promotionScore: score,
    promotionReasons: reasons,
  };
};

const sortByPromotionPriority = (left, right) =>
  (right.promotionScore ?? 0) - (left.promotionScore ?? 0)
  || String(left.bucket).localeCompare(String(right.bucket))
  || String(left.brandName).localeCompare(String(right.brandName))
  || String(left.title).localeCompare(String(right.title));

const selectPromoteNow = ({ eligible, maxPromote, perBucketPromoteLimit }) => {
  const limit = Math.max(0, Number(maxPromote) || 4);
  const perBucket = Math.max(1, Number(perBucketPromoteLimit) || 1);
  const selected = [];
  const selectedIds = new Set();
  const bucketCounts = new Map();
  for (const candidate of eligible) {
    if (selected.length >= limit) break;
    const bucketCount = bucketCounts.get(candidate.bucket) ?? 0;
    if (bucketCount >= perBucket) continue;
    selected.push(candidate);
    selectedIds.add(candidate.id);
    bucketCounts.set(candidate.bucket, bucketCount + 1);
  }
  for (const candidate of eligible) {
    if (selected.length >= limit) break;
    if (selectedIds.has(candidate.id)) continue;
    selected.push(candidate);
    selectedIds.add(candidate.id);
  }
  return { selected, selectedIds };
};

const summarizeBuckets = (rows) =>
  rows.reduce((acc, row) => {
    const bucket = row.bucket ?? "unknown";
    acc[bucket] = (acc[bucket] ?? 0) + 1;
    return acc;
  }, {});

const defaultAnchorExpectationForCandidate = (candidate) => {
  const title = normalizeText(candidate.title);
  const bucket = scenarioBucket(candidate);
  const pass = [];
  const warn = [];
  const fail = ["Calories", "Serving Size", "Sugars"];

  const add = (target, values) => {
    for (const value of values) {
      if (normalizeText(value) && !target.includes(value)) target.push(value);
    }
  };

  if (/\bcoconut aminos\b/i.test(title)) {
    add(pass, ["Coconut Aminos", "Soy-Free Soy Sauce Alternative", "Soy Sauce Alternative"]);
    add(warn, ["Aminos"]);
    add(fail, ["Iron", "Potassium", "Fiber", "Added Sugars"]);
  } else if (/\bwhey\b/i.test(title)) {
    add(pass, ["Whey Protein", "Protein"]);
    add(warn, ["Whey"]);
    add(fail, ["Magnesium", "Calcium", "Phosphorus", "Potassium", "Total Carbs"]);
  } else if (/\bgreen tea\b/i.test(title)) {
    add(pass, ["Green Tea", productLineName({ brand: candidate.brandName, title })]);
    add(warn, ["Tea"]);
  } else if (/\bmelatonin\b/i.test(title) && /\btea\b/i.test(title)) {
    add(pass, ["Tea blend", "Melatonin Tea", "Sleepytime Melatonin"]);
    add(warn, ["Melatonin", "Tea"]);
    add(fail, ["Caffeine"]);
  } else if (/\bcaffeine\b|\benergy\b/i.test(title) && /\bdrink mix\b/i.test(title)) {
    add(pass, ["Caffeine", "Energy Powder Drink Mix", "Energy Drink Mix", "Green Coffee Bean Extract", "Green Tea Leaf Extract"]);
    add(warn, ["Drink Mix"]);
    add(fail, ["Vitamin C", "Potassium", "Sodium", "Total Carbohydrate"]);
  } else if (/\bgreens?\b|\bsuperfood\b|\bkyo-green\b/i.test(title)) {
    add(pass, ["Greens", "Superfood Blend", "Greens Blend", productLineName({ brand: candidate.brandName, title })]);
    add(warn, ["Superfood"]);
    add(fail, ["Sodium", "Total Carbohydrate"]);
  } else if (/\bmct\b/i.test(title)) {
    add(pass, ["MCT Oil", productLineName({ brand: candidate.brandName, title })]);
    add(warn, ["Oil"]);
    add(fail, ["Total Fat"]);
  } else if (/\bomega|dha|epa|krill|fish oil|algal|algae/i.test(title)) {
    add(pass, ["Omega-3", "Omega-3 Source Oil", productLineName({ brand: candidate.brandName, title })]);
    add(warn, ["Oil"]);
    add(fail, ["Total Fat"]);
  } else if (bucket === "sports_hydration_boundary") {
    add(pass, ["Drink Mix", "Hydration", "Electrolyte"]);
    add(warn, ["Sports Drink"]);
    add(fail, ["Vitamin C", "Potassium", "Sodium"]);
  } else if (bucket === "source_protein_boundary") {
    add(pass, ["Protein", productLineName({ brand: candidate.brandName, title })]);
    add(warn, ["Protein Source"]);
    add(fail, ["Potassium", "Total Carbs"]);
  } else if (bucket === "tea_beverage_boundary") {
    add(pass, ["Tea", productLineName({ brand: candidate.brandName, title })]);
    add(warn, ["Beverage"]);
  } else if (bucket === "condiment_sweetener_boundary") {
    add(pass, [productLineName({ brand: candidate.brandName, title }), "Condiment"]);
    add(warn, ["Food"]);
    add(fail, ["Sodium", "Potassium"]);
  } else {
    add(pass, [productLineName({ brand: candidate.brandName, title }), candidate.title]);
    add(warn, ["Food-like Product"]);
  }

  return { pass: pass.filter(Boolean), warn, fail };
};

const selectedAnchorExpectation = (defaultAnchor) =>
  defaultAnchor.pass[0] ?? defaultAnchor.warn[0] ?? null;

const searchQueryForCandidate = (candidate) =>
  normalizeText(`${candidate.brandName ?? ""} ${productLineName({
    brand: candidate.brandName,
    title: candidate.title,
  }) || candidate.title || ""}`);

const canaryScenarioPairForCandidate = (candidate, options = {}) => {
  const slug = canarySlug(candidate, options);
  const defaultAnchor = defaultAnchorExpectationForCandidate(candidate);
  const product = {
    productId: candidate.productId,
    brand: candidate.brandName,
    name: candidate.title,
    barcode: candidate.barcode,
  };
  const expectedBase = {
    defaultAnchor,
    profileWarnings: {
      mustInclude: [],
      mustNotInclude: ["safe for you"],
    },
  };
  return [
    {
      id: `canary_scan_food_like_${slug}_route_honesty`,
      surface: "barcode_scan",
      origin: "barcode_scan",
      category: "food_like",
      personas: [],
      input: { barcode: candidate.barcode },
      product,
      expected: expectedBase,
      gates: ["route_health", "selected_anchor_consistency", "unsafe_language"],
      severityOnFail: "P1",
    },
    {
      id: `canary_search_origin_food_like_${slug}_route_honesty`,
      surface: "search_origin_result",
      origin: "search_result",
      category: "food_like",
      personas: [],
      input: {
        query: searchQueryForCandidate(candidate),
        queryType: "brand_product",
        searchResultSeed: {
          productId: candidate.productId,
          barcode: candidate.barcode,
          upcCode: candidate.barcode,
          name: candidate.title,
          brand: candidate.brandName,
          category: "Food",
          benefit: `Food-like ${candidate.bucket} boundary`,
          dose: null,
          factsStatus: "partial",
          coverageStatus: "not_enough_structured_data",
        },
      },
      product,
      expected: {
        ...expectedBase,
        consistency: {
          productId: candidate.productId,
          barcode: candidate.barcode,
          selectedAnchor: selectedAnchorExpectation(defaultAnchor),
        },
      },
      gates: [
        "click_through_seed_consistency",
        "canonical_product_consistency",
        "selected_anchor_consistency",
        "warning_consistency",
      ],
      severityOnFail: "P1",
    },
  ];
};

const relativePathForConfig = (filePath) => {
  const resolved = path.resolve(ROOT_DIR, filePath);
  const relative = path.relative(ROOT_DIR, resolved);
  return relative.startsWith("..") ? resolved : relative;
};

const defaultAdditionsPathForConfig = (configPath) => {
  const resolved = path.resolve(ROOT_DIR, configPath);
  const parsed = path.parse(resolved);
  return path.join(parsed.dir, `${parsed.name}-additions${parsed.ext || ".json"}`);
};

export const buildRuntimeCanaryPack = ({
  report,
  configPath = "output/stable_promotion_candidate_selector/live_canary/stable-promotion-live-canary.json",
  additionsPath = null,
  candidateSection = "promote_now",
} = {}) => {
  const resolvedAdditionsPath = additionsPath ?? defaultAdditionsPathForConfig(configPath);
  const additionsRelativePath = relativePathForConfig(resolvedAdditionsPath);
  const sourceRows = toArray(report?.[candidateSection]);
  const includeProductIdInScenarioId = candidateSection === "large_canary";
  const scenarios = sourceRows.flatMap((candidate) =>
    canaryScenarioPairForCandidate(candidate, { includeProductId: includeProductIdInScenarioId }));
  const packRole = candidateSection === "large_canary"
    ? "stable_promotion_large_canary"
    : "stable_promotion_live_canary";
  const version = candidateSection === "large_canary"
    ? "stable-promotion-large-canary.v0"
    : "stable-promotion-live-canary.v0";
  const additions = {
    version,
    description: `Temporary runtime canary generated from stable-promotion selector ${candidateSection}.`,
    generatedAt: report?.generatedAt ?? new Date().toISOString(),
    scenarios,
  };
  const config = {
    version,
    sourcePackPath: "data/validation/golden-journey-pack.v1.json",
    additionalPackPaths: [additionsRelativePath],
    scenarioIds: scenarios.map((scenario) => scenario.id),
    releaseBlocker: false,
    runner: "runtime_contract_runner",
    packRole,
    notes: [
      "Temporary canary artifact generated by build-stable-promotion-candidate-selector.mjs; do not commit output artifacts.",
    ],
  };
  return { config, additions };
};

export const classifyStablePromotionCandidates = ({
  candidates,
  stableScenarios = [],
  maxPromote = 4,
  perBucketPromoteLimit = 1,
  stableCandidatePoolLimit = 100,
  largeCanaryLimit = maxPromote,
  generatedAt = new Date().toISOString(),
} = {}) => {
  const coverage = buildStableCoverage(stableScenarios);
  const uniqueCandidates = uniqueBy(
    toArray(candidates).map(decorateCandidate),
    (candidate) => candidate.id || `${candidate.productId ?? ""}:${candidate.barcode ?? ""}:${candidate.title ?? ""}`,
  );

  const skipDuplicate = [];
  const needsDataFix = [];
  const residual = [];
  const eligible = [];

  for (const candidate of uniqueCandidates) {
    const missing = dataFixReasons(candidate);
    if (missing.length > 0) {
      needsDataFix.push({
        ...candidate,
        selectorReason: "missing_required_live_replay_fields",
        missingFields: missing,
      });
      continue;
    }
    const duplicate = duplicateReason({ candidate, coverage });
    if (duplicate) {
      skipDuplicate.push({
        ...candidate,
        selectorReason: duplicate,
      });
      continue;
    }
    if (isResidualCandidate(candidate, candidate.promotionScore)) {
      residual.push({
        ...candidate,
        selectorReason: "low_user_surface_release_blocker_value",
      });
      continue;
    }
    eligible.push(candidate);
  }

  eligible.sort(sortByPromotionPriority);
  const { selected: promoteNow, selectedIds } = selectPromoteNow({
    eligible,
    maxPromote,
    perBucketPromoteLimit,
  });
  const keepNightly = eligible
    .filter((candidate) => !selectedIds.has(candidate.id))
    .map((candidate) => ({
      ...candidate,
      selectorReason: "valuable_but_not_needed_for_current_stable_gate_slice",
    }));
  const poolLimit = Math.max(0, Number(stableCandidatePoolLimit) || 0);
  const stableCandidatePool = eligible
    .filter((candidate) => !selectedIds.has(candidate.id))
    .slice(0, poolLimit)
    .map((candidate) => ({
      ...candidate,
      selectorReason: "candidate_for_repeated_large_canary_before_stable_promotion",
    }));
  const largeLimit = Math.max(0, Number(largeCanaryLimit) || 0);
  const largeCanary = [
    ...promoteNow,
    ...stableCandidatePool,
  ]
    .slice(0, largeLimit)
    .map((candidate) => ({
      ...candidate,
      selectorReason: "pre_release_large_canary_user_surface_boundary",
    }));

  return {
    schemaVersion: "stable_promotion_candidate_selector.v0",
    generatedAt,
    policy: {
      maxPromote,
      perBucketPromoteLimit,
      stableCandidatePoolLimit: poolLimit,
      largeCanaryLimit: largeLimit,
      stableGatePrinciple: "large discovery finds buckets; stable gate only admits representative user-surface blockers",
    },
    summary: {
      totalCandidates: uniqueCandidates.length,
      promote_now: promoteNow.length,
      stable_candidate_pool: stableCandidatePool.length,
      large_canary: largeCanary.length,
      keep_nightly: keepNightly.length,
      residual: residual.length,
      needs_data_fix: needsDataFix.length,
      skip_duplicate_coverage: skipDuplicate.length,
    },
    bucketSummary: {
      promote_now: summarizeBuckets(promoteNow),
      stable_candidate_pool: summarizeBuckets(stableCandidatePool),
      large_canary: summarizeBuckets(largeCanary),
      keep_nightly: summarizeBuckets(keepNightly),
      residual: summarizeBuckets(residual),
      needs_data_fix: summarizeBuckets(needsDataFix),
      skip_duplicate_coverage: summarizeBuckets(skipDuplicate),
    },
    promote_now: promoteNow.map((candidate) => ({
      ...candidate,
      selectorReason: "highest_value_user_surface_boundary_for_current_stable_gate_slice",
    })),
    stable_candidate_pool: stableCandidatePool,
    large_canary: largeCanary,
    keep_nightly: keepNightly,
    residual,
    needs_data_fix: needsDataFix,
    skip_duplicate_coverage: skipDuplicate,
  };
};

export const collectPromotionCandidateScenarios = async (candidatePaths) => {
  const scenarios = [];
  for (const candidatePath of toArray(candidatePaths)) {
    const resolved = path.resolve(ROOT_DIR, candidatePath);
    const json = JSON.parse(await fs.readFile(resolved, "utf8"));
    const sourceLists = [
      ["scenarios", json?.scenarios],
      ["stableGateScenarioSeeds", json?.stableGateScenarioSeeds],
      ["nightlyScenarioSeeds", json?.nightlyScenarioSeeds],
      ["stableGateCandidates", json?.stableGateCandidates],
      ["nightlySeeds", json?.nightlySeeds],
      ["array", Array.isArray(json) ? json : null],
    ];
    for (const [sourceList, value] of sourceLists) {
      for (const scenario of toArray(value)) {
        scenarios.push({
          ...scenario,
          selectorSource: {
            path: path.relative(ROOT_DIR, resolved),
            list: sourceList,
          },
        });
      }
    }
  }
  return scenarios;
};

const formatRow = (row) =>
  `- ${row.productId ?? "n/a"} | ${row.brandName ?? "n/a"} | ${row.title ?? "n/a"} | bucket=${row.bucket ?? "n/a"} | score=${row.promotionScore ?? 0} | reason=${row.selectorReason ?? "n/a"}`;

export const renderStablePromotionCandidateMarkdown = (report) => {
  const lines = [
    "# Stable Promotion Candidate Selector",
    "",
    `- generatedAt: ${report.generatedAt}`,
    `- schemaVersion: ${report.schemaVersion}`,
    `- totalCandidates: ${report.summary.totalCandidates}`,
    `- promote_now: ${report.summary.promote_now}`,
    `- stable_candidate_pool: ${report.summary.stable_candidate_pool ?? 0}`,
    `- large_canary: ${report.summary.large_canary ?? 0}`,
    `- keep_nightly: ${report.summary.keep_nightly}`,
    `- residual: ${report.summary.residual}`,
    `- needs_data_fix: ${report.summary.needs_data_fix}`,
    `- skip_duplicate_coverage: ${report.summary.skip_duplicate_coverage}`,
    "",
  ];

  for (const section of CATEGORY_ORDER) {
    lines.push(`## ${section}`, "");
    const rows = report[section] ?? [];
    if (rows.length === 0) {
      lines.push("- none", "");
      continue;
    }
    for (const row of rows) lines.push(formatRow(row));
    lines.push("");
  }

  return `${lines.join("\n").trim()}\n`;
};

export const writeStablePromotionCandidateOutputs = async ({ report, outDir }) => {
  const outputDir = path.resolve(ROOT_DIR, outDir ?? path.join("output", "stable_promotion_candidate_selector"));
  const relativeDir = path.relative(ROOT_DIR, outputDir);
  await fs.mkdir(outputDir, { recursive: true });
  const jsonPath = path.join(relativeDir, "stable_promotion_candidate_selector_report.json");
  const markdownPath = path.join(relativeDir, "stable_promotion_candidate_selector_report.md");
  await writeJson(jsonPath, report);
  await writeText(markdownPath, renderStablePromotionCandidateMarkdown(report));
  return { outputDir: relativeDir, jsonPath, markdownPath };
};

export const writeRuntimeCanaryPackOutputs = async ({ pack, configPath, additionsPath = null }) => {
  const resolvedConfigPath = path.resolve(ROOT_DIR, configPath);
  const resolvedAdditionsPath = additionsPath
    ? path.resolve(ROOT_DIR, additionsPath)
    : path.resolve(ROOT_DIR, pack.config.additionalPackPaths[0]);
  const configRelativePath = relativePathForConfig(resolvedConfigPath);
  const additionsRelativePath = relativePathForConfig(resolvedAdditionsPath);
  await writeJson(additionsRelativePath, pack.additions);
  await writeJson(configRelativePath, {
    ...pack.config,
    additionalPackPaths: [additionsRelativePath],
  });
  return {
    configPath: resolvedConfigPath,
    additionsPath: resolvedAdditionsPath,
    configRelativePath,
    additionsRelativePath,
  };
};
