import fs from "node:fs/promises";
import path from "node:path";

import { normalizeLower, normalizeText } from "./iherb-overlay-utils.mjs";
import { ROOT_DIR, writeJson, writeText } from "./science-validation-reporting.mjs";

const SOURCE_SENSITIVE_PATTERN =
  /\b(?:whey|dairy|milk|casein|soy|soya|soybean|soy lecithin|soy protein|fish oil|cod liver|salmon oil|krill|shellfish|algal|algae oil|plant[-\s]*based omega)\b/i;
const SUPPLEMENT_OVERLAP_PATTERN =
  /\b(?:protein|whey|collagen|electrolyte|hydration|pre[-\s]*workout|energy gel|go gel|superfood|greens?|green vibrance|spirulina|chlorella|maca|omega|dha|epa|mct|brain octane)\b/i;
const SEARCH_DETAIL_RISK_PATTERN =
  /\b(?:protein\s+(?:bar|powder|energy bar)|whey|hydration|electrolyte|drink mix|energy gel|go gel|algal|omega|greens?|superfood|tea bags?|herbal tea|coconut aminos|soy sauce replacement)\b/i;

const BUCKET_RULES = [
  {
    bucket: "source_protein_boundary",
    pattern: /\b(?:whey|casein|soy protein|pea protein|protein\s+(?:powder|bar|energy bar)|pure whey|isolate)\b/i,
    defaultTier: "stable_gate_candidate",
  },
  {
    bucket: "sports_hydration_boundary",
    pattern: /\b(?:hydration|electrolyte|drink mix|energy gel|go gel|energy chews?|pre[-\s]*workout)\b/i,
    defaultTier: "stable_gate_candidate",
  },
  {
    bucket: "omega_source_oil_boundary",
    pattern: /\b(?:omega|dha|epa|fish oil|krill|cod liver|salmon oil|algal|algae oil|flax(?:\s+seed)? oil|udo'?s oil|mct|brain octane)\b/i,
    defaultTier: "stable_gate_candidate",
  },
  {
    bucket: "greens_superfood_boundary",
    pattern: /\b(?:greens?|superfood|green vibrance|spirulina|chlorella|maca|matcha|protein\s*&\s*greens)\b/i,
    defaultTier: "nightly_discovery",
  },
  {
    bucket: "tea_beverage_boundary",
    pattern: /\b(?:tea bags?|herbal tea|coffee|latte|beverage|smoothie)\b/i,
    defaultTier: "nightly_discovery",
  },
  {
    bucket: "snack_bar_boundary",
    pattern: /\b(?:protein\s+bar|nutrition\s+bar|energy\s+bar|granola\s+bars?|snack|cookie|cracker|chips?|candy|chocolate|gummy bears?|chews?)\b/i,
    defaultTier: "nightly_discovery",
  },
  {
    bucket: "condiment_sweetener_boundary",
    pattern: /\b(?:coconut aminos|soy sauce replacement|sauce|syrup|honey|sweetener|monk fruit|stevia|vinegar|seasoning|salt\b|rub\b|dressing)\b/i,
    defaultTier: "nightly_discovery",
  },
  {
    bucket: "personal_care_boundary",
    pattern: /\b(?:mouth rinse|balm|face kit|skin kit|teethers?|teething|body care|skin care)\b/i,
    defaultTier: "residual_discovery",
  },
  {
    bucket: "pure_grocery_boundary",
    pattern: /\b(?:pasta|beans?\b|dates?\b|cereal|pancake|scone|cornbread|baking powder|olive oil|coconut oil|sesame oil|grapeseed oil)\b/i,
    defaultTier: "residual_discovery",
  },
];

const TIER_ORDER = {
  stable_gate_candidate: 0,
  nightly_discovery: 1,
  residual_discovery: 2,
};

const asArray = (value) => (Array.isArray(value) ? value : []);

const slugify = (value) =>
  normalizeLower(value)
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");

const increment = (map, key, delta = 1) => {
  const normalized = normalizeText(key) || "unknown";
  map.set(normalized, (map.get(normalized) ?? 0) + delta);
};

const topEntries = (map, keyName, limit = 20) =>
  [...map.entries()]
    .sort((left, right) => right[1] - left[1] || String(left[0]).localeCompare(String(right[0])))
    .slice(0, limit)
    .map(([key, count]) => ({ [keyName]: key, count }));

const selectBucketRule = (row) => {
  const haystack = normalizeText(`${row?.brandName ?? ""} ${row?.title ?? ""}`);
  return BUCKET_RULES.find((rule) => rule.pattern.test(haystack)) ?? {
    bucket: "unclassified_food_like_boundary",
    defaultTier: "nightly_discovery",
  };
};

const deriveRiskTags = (row, bucket) => {
  const tags = new Set(["food_like_route_honesty"]);
  const title = normalizeText(row?.title);
  const reasons = asArray(row?.classification?.reasonCodes);
  const barcode = normalizeText(row?.barcode ?? row?.barcode_gtin14);

  if (barcode) tags.add("barcode_exact");
  if (SOURCE_SENSITIVE_PATTERN.test(title)) tags.add("source_sensitive");
  if (SUPPLEMENT_OVERLAP_PATTERN.test(title) || reasons.some((reason) => /supplement_signal/i.test(reason))) {
    tags.add("supplement_signal_overlap");
  }
  if (SEARCH_DETAIL_RISK_PATTERN.test(title)) tags.add("search_detail_route_risk");
  if (["source_protein_boundary", "omega_source_oil_boundary"].includes(bucket)) tags.add("allergy_or_dietary_source");
  if (bucket === "sports_hydration_boundary") tags.add("sports_context_route");
  if (bucket === "condiment_sweetener_boundary") tags.add("food_context_honesty");
  if (bucket === "tea_beverage_boundary") tags.add("beverage_context_honesty");

  return [...tags];
};

const deriveTier = ({ row, bucket, defaultTier, riskTags }) => {
  const title = normalizeText(row?.title);
  if (defaultTier === "residual_discovery") return defaultTier;
  if (
    bucket === "snack_bar_boundary" &&
    /\b(?:protein\s+(?:bar|bites?|snack mix)|energy\s+bar|nutrition\s+bar)\b/i.test(title) &&
    riskTags.includes("barcode_exact")
  ) {
    return "stable_gate_candidate";
  }
  if (
    defaultTier === "stable_gate_candidate" &&
    riskTags.includes("barcode_exact") &&
    (riskTags.includes("source_sensitive") ||
      riskTags.includes("supplement_signal_overlap") ||
      /(?:hydration|energy gel|go gel|drink mix|protein\s+(?:bar|powder))/i.test(title))
  ) {
    return "stable_gate_candidate";
  }
  return "nightly_discovery";
};

const computeImpactScore = ({ bucket, riskTags }) => {
  let score = 0;
  if (riskTags.includes("source_sensitive")) score += 60;
  if (riskTags.includes("search_detail_route_risk")) score += 35;
  if (riskTags.includes("supplement_signal_overlap")) score += 25;
  if (riskTags.includes("barcode_exact")) score += 10;
  if (bucket === "sports_hydration_boundary") score += 20;
  if (bucket === "source_protein_boundary") score += 18;
  if (bucket === "omega_source_oil_boundary") score += 14;
  return score;
};

export const classifyFoodLikeRouteHonestyRow = (row) => {
  const rule = selectBucketRule(row);
  const riskTags = deriveRiskTags(row, rule.bucket);
  const tier = deriveTier({
    row,
    bucket: rule.bucket,
    defaultTier: rule.defaultTier,
    riskTags,
  });
  return {
    ...row,
    routeHonesty: {
      tier,
      bucket: rule.bucket,
      riskTags,
      impactScore: computeImpactScore({ bucket: rule.bucket, riskTags }),
      promotionReason:
        tier === "stable_gate_candidate"
          ? "barcode/search/detail route can look like supplement content unless this food-like boundary stays stable"
          : tier === "nightly_discovery"
            ? "use for route-honesty drift discovery before stable-gate promotion"
            : "low product-surface risk; keep as residual discovery",
      suggestedGate:
        tier === "stable_gate_candidate"
          ? {
              surface: "search_origin_result",
              gates: [
                "barcode_exact_search",
                "canonical_product_consistency",
                "food_like_route_honesty",
                "selected_anchor_consistency",
              ],
            }
          : null,
    },
  };
};

const sortClassifiedRows = (left, right) => {
  const tierDelta = (TIER_ORDER[left.routeHonesty.tier] ?? 99) - (TIER_ORDER[right.routeHonesty.tier] ?? 99);
  if (tierDelta !== 0) return tierDelta;
  const bucketDelta = left.routeHonesty.bucket.localeCompare(right.routeHonesty.bucket);
  if (bucketDelta !== 0) return bucketDelta;
  const impactDelta = (right.routeHonesty.impactScore ?? 0) - (left.routeHonesty.impactScore ?? 0);
  if (impactDelta !== 0) return impactDelta;
  return normalizeText(left.title).localeCompare(normalizeText(right.title));
};

const selectDiverseRows = (rows, { totalLimit, perBucketLimit, perBrandBucketLimit = 1 }) => {
  const selected = [];
  const byBucket = new Map();
  const byBucketBrand = new Map();
  for (const row of rows) {
    if (selected.length >= totalLimit) break;
    const bucket = row.routeHonesty.bucket;
    const count = byBucket.get(bucket) ?? 0;
    if (count >= perBucketLimit) continue;
    const brandBucket = `${bucket}::${normalizeLower(row.brandName) || "unknown"}`;
    const brandBucketCount = byBucketBrand.get(brandBucket) ?? 0;
    if (brandBucketCount >= perBrandBucketLimit) continue;
    byBucket.set(bucket, count + 1);
    byBucketBrand.set(brandBucket, brandBucketCount + 1);
    selected.push(row);
  }
  return selected;
};

const toScenarioSeed = (row) => ({
  id: `food_like_route_${slugify(row.brandName)}_${slugify(row.title)}`.slice(0, 140),
  productId: normalizeText(row.productId) || null,
  barcode: normalizeText(row.barcode ?? row.barcode_gtin14) || null,
  brandName: normalizeText(row.brandName) || null,
  title: normalizeText(row.title) || null,
  bucket: row.routeHonesty.bucket,
  riskTags: row.routeHonesty.riskTags,
  expected: {
    routeHonesty: "food_like",
    searchDetailConsistency: "same_product_or_same_canonical",
    copyExpectation: "food_or_nutrition_context_without_supplement_overclaim",
  },
});

export const buildFoodLikeRouteHonestyReport = ({
  queueRows,
  generatedAt = new Date().toISOString(),
  maxStableCandidates = 24,
  maxNightlySeeds = 80,
  stablePerBucket = 4,
  nightlyPerBucket = 12,
} = {}) => {
  const laneRows = asArray(queueRows).filter((row) => row?.lane === "lane_c_food_like_route_honesty");
  const classifiedRows = laneRows.map(classifyFoodLikeRouteHonestyRow).sort(sortClassifiedRows);
  const tierCounts = new Map();
  const bucketCounts = new Map();
  const bucketTierCounts = new Map();
  const brandCounts = new Map();

  for (const row of classifiedRows) {
    const { tier, bucket } = row.routeHonesty;
    increment(tierCounts, tier);
    increment(bucketCounts, bucket);
    increment(brandCounts, row.brandName || "unknown_brand");
    if (!bucketTierCounts.has(bucket)) bucketTierCounts.set(bucket, new Map());
    increment(bucketTierCounts.get(bucket), tier);
  }

  const stableGateCandidates = selectDiverseRows(
    classifiedRows.filter((row) => row.routeHonesty.tier === "stable_gate_candidate"),
    { totalLimit: maxStableCandidates, perBucketLimit: stablePerBucket, perBrandBucketLimit: 1 },
  );
  const nightlySeeds = selectDiverseRows(
    classifiedRows.filter((row) => row.routeHonesty.tier !== "residual_discovery"),
    { totalLimit: maxNightlySeeds, perBucketLimit: nightlyPerBucket, perBrandBucketLimit: 2 },
  );

  return {
    schemaVersion: "food_like_route_honesty_report.v0",
    generatedAt,
    summary: {
      totalLaneRows: laneRows.length,
      tierCounts: Object.fromEntries(tierCounts),
      bucketCounts: Object.fromEntries(bucketCounts),
      topBrands: topEntries(brandCounts, "brandName", 20),
      stableGateCandidates: stableGateCandidates.length,
      nightlySeeds: nightlySeeds.length,
      residualDiscoveryRows: classifiedRows.filter((row) => row.routeHonesty.tier === "residual_discovery").length,
    },
    bucketTierCounts: Object.fromEntries(
      [...bucketTierCounts.entries()].map(([bucket, counts]) => [bucket, Object.fromEntries(counts)]),
    ),
    stableGateCandidates,
    nightlySeeds,
    residualExamples: classifiedRows
      .filter((row) => row.routeHonesty.tier === "residual_discovery")
      .slice(0, 30),
    stableGateScenarioSeeds: stableGateCandidates.map(toScenarioSeed),
    nightlyScenarioSeeds: nightlySeeds.map(toScenarioSeed),
  };
};

export const renderFoodLikeRouteHonestyMarkdown = (report) => {
  const lines = [
    "# Food-Like Route Honesty Discovery",
    "",
    `- generatedAt: ${report.generatedAt}`,
    `- total lane_c rows: ${report.summary.totalLaneRows}`,
    `- stable gate candidates: ${report.summary.stableGateCandidates}`,
    `- nightly seeds: ${report.summary.nightlySeeds}`,
    `- residual discovery rows: ${report.summary.residualDiscoveryRows}`,
    "",
    "## Tier Counts",
    "",
  ];

  for (const [tier, count] of Object.entries(report.summary.tierCounts ?? {})) {
    lines.push(`- ${tier}: ${count}`);
  }

  lines.push("", "## Bucket Counts", "");
  for (const [bucket, count] of Object.entries(report.summary.bucketCounts ?? {})) {
    const tierCounts = report.bucketTierCounts?.[bucket] ?? {};
    lines.push(`- ${bucket}: ${count} (${Object.entries(tierCounts).map(([tier, value]) => `${tier}=${value}`).join(", ")})`);
  }

  lines.push("", "## Stable Gate Candidate Seeds", "");
  for (const row of report.stableGateScenarioSeeds ?? []) {
    lines.push(
      `- ${row.productId || "n/a"} | ${row.brandName || "n/a"} | ${row.title || "n/a"} | bucket=${row.bucket} | tags=${row.riskTags.join(",")}`,
    );
  }

  lines.push("", "## Nightly Discovery Seeds", "");
  for (const row of (report.nightlyScenarioSeeds ?? []).slice(0, 40)) {
    lines.push(
      `- ${row.productId || "n/a"} | ${row.brandName || "n/a"} | ${row.title || "n/a"} | bucket=${row.bucket}`,
    );
  }

  lines.push("", "## Residual Examples", "");
  for (const row of report.residualExamples ?? []) {
    lines.push(
      `- ${row.productId || "n/a"} | ${row.brandName || "n/a"} | ${row.title || "n/a"} | bucket=${row.routeHonesty.bucket}`,
    );
  }

  return `${lines.join("\n").trim()}\n`;
};

export const findLatestFoodLikeQueuePath = async (
  baseDir = path.join(ROOT_DIR, "output", "full_db_api_fill_queue"),
) => {
  const candidates = [];
  const walk = async (dir, depth = 0) => {
    if (depth > 3) return;
    let entries = [];
    try {
      entries = await fs.readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      const absolute = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        await walk(absolute, depth + 1);
      } else if (entry.isFile() && entry.name === "api_fill_queue.food_like_route_honesty.json") {
        const stat = await fs.stat(absolute);
        candidates.push({ absolute, mtimeMs: stat.mtimeMs });
      }
    }
  };
  await walk(baseDir);
  candidates.sort((left, right) => right.mtimeMs - left.mtimeMs || right.absolute.localeCompare(left.absolute));
  if (!candidates[0]) throw new Error(`No api_fill_queue.food_like_route_honesty.json found under ${baseDir}`);
  return candidates[0].absolute;
};

export const writeFoodLikeRouteHonestyOutputs = async ({ report, outDir }) => {
  const stamp = String(Date.now());
  const outputDir = path.resolve(ROOT_DIR, outDir ?? path.join("output", "food_like_route_honesty", stamp));
  const relativeDir = path.relative(ROOT_DIR, outputDir);
  await fs.mkdir(outputDir, { recursive: true });

  const reportJsonPath = path.join(relativeDir, "food_like_route_honesty_report.json");
  const reportMdPath = path.join(relativeDir, "food_like_route_honesty_report.md");
  const stablePath = path.join(relativeDir, "food_like_route_honesty_stable_candidates.json");
  const nightlyPath = path.join(relativeDir, "food_like_route_honesty_nightly_seeds.json");

  await writeJson(reportJsonPath, report);
  await writeText(reportMdPath, renderFoodLikeRouteHonestyMarkdown(report));
  await writeJson(stablePath, {
    schemaVersion: "food_like_route_honesty_stable_candidates.v0",
    generatedAt: report.generatedAt,
    scenarios: report.stableGateScenarioSeeds,
  });
  await writeJson(nightlyPath, {
    schemaVersion: "food_like_route_honesty_nightly_seeds.v0",
    generatedAt: report.generatedAt,
    scenarios: report.nightlyScenarioSeeds,
  });

  return {
    outputDir: relativeDir,
    reportJsonPath,
    reportMdPath,
    stableCandidatesPath: stablePath,
    nightlySeedsPath: nightlyPath,
  };
};
