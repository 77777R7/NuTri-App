import fs from "node:fs/promises";
import path from "node:path";
import { ROOT_DIR, writeJson, writeText } from "./science-validation-reporting.mjs";

const LANE_PATTERNS = [
  ["probiotic_microbiome", /\b(probiotic|cfu|floraphage|protectis|osfortis|microbiome|bacteriophage)\b/i],
  ["omega3_source_oil", /\b(omega[\s-]?3|fish oil|krill|algal|dha|epa)\b/i],
  ["sleep_amino", /\b(sleep|melatonin|5-htp|theanine|gaba|valerian)\b/i],
  ["mineral_stack", /\b(calcium.*magnesium|magnesium.*calcium|electrolyte|mineral stack|zinc stack|multimineral)\b/i],
  ["food_like", /\b(bar|cookie|latte|drink|snack|bites|gel|chew)\b/i],
];

const normalizeText = (value) => String(value ?? "").trim();
const normalizeTitle = (row) => normalizeText(row?.title ?? row?.name).toLowerCase();
const normalizeFactsArray = (row) => {
  if (typeof row?.facts_count === "number") {
    const count = Number.isFinite(row.facts_count) ? row.facts_count : 0;
    return Array.from({ length: Math.max(0, count) }, () => ({}));
  }

  const nutritionalFacts = row?.supplement_facts?.nutritionalFacts;
  if (Array.isArray(nutritionalFacts)) return nutritionalFacts;
  return [];
};

const getFactsCount = (row) => normalizeFactsArray(row).length;

const getFactsType = (row) => {
  if (typeof row?.facts_type === "string") return row.facts_type;
  const nutritionalFacts = row?.supplement_facts?.nutritionalFacts;
  if (Array.isArray(nutritionalFacts)) return "array";
  if (nutritionalFacts === null) return "null";
  if (typeof nutritionalFacts === "undefined") return "missing";
  return typeof nutritionalFacts;
};

const collectExample = (row) => ({
  productId: row.product_id ?? row.productId ?? null,
  brand: row.brand_name ?? row.brand ?? null,
  title: row.title ?? row.name ?? null,
  barcode: row.barcode_gtin14 ?? row.upc_code ?? row.barcode ?? null,
});

const DISCOVERY_BUCKETS = [
  ["facts_zero", (row) => getFactsCount(row) === 0],
  ["facts_short_1_3", (row) => {
    const factsCount = getFactsCount(row);
    return factsCount >= 1 && factsCount <= 3;
  }],
  ["facts_malformed_shape", (row) => {
    const factsType = getFactsType(row);
    return !["array", "missing"].includes(factsType);
  }],
  ["omega_shellfish_source", (row) => /\bkrill\b/i.test(normalizeTitle(row))],
  ["omega_fish_source", (row) => /\bfish oil\b/i.test(normalizeTitle(row))],
  ["omega_algal_source", (row) => /(algal|algae)/i.test(normalizeTitle(row)) && /(omega|dha)/i.test(normalizeTitle(row))],
  ["probiotic_trade_name", (row) => /(protectis|floraphage|osfortis)/i.test(normalizeTitle(row))],
  ["stimulant_matcha_green_tea", (row) => /(matcha|green tea|camellia sinensis)/i.test(normalizeTitle(row))],
  ["sleep_5htp_melatonin", (row) => /5-htp/i.test(normalizeTitle(row)) && /melatonin/i.test(normalizeTitle(row))],
  ["duplicate_stack_cal_mag", (row) => /calcium/i.test(normalizeTitle(row)) && /magnesium/i.test(normalizeTitle(row))],
  ["duplicate_stack_zinc_d", (row) => /zinc/i.test(normalizeTitle(row)) && /(vitamin d|\bd3\b)/i.test(normalizeTitle(row))],
  ["source_soy", (row) => /\bsoy\b/i.test(normalizeTitle(row))],
  ["source_whey_dairy", (row) => /\bwhey\b/i.test(normalizeTitle(row))],
  ["food_like_boundary", (row) => /\b(bar|cookie|latte|drink|snack|bites|gel|chew)\b/i.test(normalizeTitle(row))],
];

export const classifyDiscoveryLane = (row) => {
  const title = normalizeText(row?.title ?? row?.name);
  for (const [lane, pattern] of LANE_PATTERNS) {
    if (pattern.test(title)) return lane;
  }
  return "unclassified";
};

export const classifyDiscoveryBuckets = (row) =>
  DISCOVERY_BUCKETS
    .filter(([, predicate]) => predicate(row))
    .map(([bucket]) => bucket);

export const summarizeDiscoveryRows = (
  rows,
  {
    maxExamplesPerLane = 5,
    maxExamplesPerBucket = 5,
    priorityBuckets = [],
    promotionCandidatesByBucket = [],
  } = {},
) => {
  const summary = {
    total: rows.length,
    lanes: {},
    buckets: {},
    highlights: {
      candidateFailureBuckets: [],
      promotedScenarioCandidates: [],
    },
  };
  for (const row of rows) {
    const lane = classifyDiscoveryLane(row);
    if (!summary.lanes[lane]) {
      summary.lanes[lane] = { count: 0, examples: [] };
    }
    summary.lanes[lane].count += 1;
    if (summary.lanes[lane].examples.length < maxExamplesPerLane) {
      summary.lanes[lane].examples.push(collectExample(row));
    }

    for (const bucket of classifyDiscoveryBuckets(row)) {
      if (!summary.buckets[bucket]) {
        summary.buckets[bucket] = { count: 0, examples: [] };
      }
      summary.buckets[bucket].count += 1;
      if (summary.buckets[bucket].examples.length < maxExamplesPerBucket) {
        summary.buckets[bucket].examples.push(collectExample(row));
      }
    }
  }

  const bucketCounts = summary.buckets ?? {};
  const configuredPriorityBuckets = Array.isArray(priorityBuckets) ? priorityBuckets : [];
  summary.highlights.candidateFailureBuckets = configuredPriorityBuckets
    .map((entry) => {
      const bucket = typeof entry === "string" ? entry : entry?.bucket;
      const details = bucket ? bucketCounts[bucket] : null;
      if (!bucket || !details) return null;
      return {
        bucket,
        products: details.count,
        note: typeof entry === "string" ? null : (entry?.note ?? null),
      };
    })
    .filter(Boolean);

  const configuredPromotionBuckets = Array.isArray(promotionCandidatesByBucket)
    ? promotionCandidatesByBucket
    : [];
  const promoted = [];
  const seenProductIds = new Set();
  for (const entry of configuredPromotionBuckets) {
    const bucket = entry?.bucket;
    if (!bucket) continue;
    const limit = Number(entry?.limit) > 0 ? Number(entry.limit) : 1;
    const examples = bucketCounts[bucket]?.examples ?? [];
    for (const example of examples.slice(0, limit)) {
      const productId = example?.productId ?? null;
      if (productId && seenProductIds.has(productId)) continue;
      if (productId) seenProductIds.add(productId);
      promoted.push({
        id: productId ? `promote-${productId}` : `promote-${bucket}-${promoted.length + 1}`,
        productId,
        title: example?.title ?? null,
        brand: example?.brand ?? null,
        buckets: [bucket],
        note: entry?.note ?? null,
      });
    }
  }
  summary.highlights.promotedScenarioCandidates = promoted;

  return summary;
};

export const loadFullDbSweepConfig = async (
  filePath = "data/validation/full-db-sweep-discovery.v1.json",
) => {
  const resolved = path.resolve(ROOT_DIR, filePath);
  return JSON.parse(await fs.readFile(resolved, "utf8"));
};

export const renderFullDbSweepMarkdown = (summary) => {
  const lines = [
    "# Full DB Sweep Discovery",
    "",
    `- total: ${summary.total ?? 0}`,
    "",
    "## Lanes",
    "",
  ];
  for (const [lane, details] of Object.entries(summary.lanes ?? {})) {
    lines.push(`- ${lane}: ${details.count}`);
  }
  if (Object.keys(summary.buckets ?? {}).length > 0) {
    lines.push("", "## Buckets", "");
    for (const [bucket, details] of Object.entries(summary.buckets ?? {})) {
      lines.push(`- ${bucket}: ${details.count}`);
    }
  }
  if (Array.isArray(summary.highlights?.candidateFailureBuckets) && summary.highlights.candidateFailureBuckets.length > 0) {
    lines.push("", "## Candidate Failure Buckets", "");
    for (const bucket of summary.highlights.candidateFailureBuckets) {
      lines.push(`- ${bucket.bucket}: ${bucket.products}${bucket.note ? ` - ${bucket.note}` : ""}`);
    }
  }
  if (Array.isArray(summary.highlights?.promotedScenarioCandidates) && summary.highlights.promotedScenarioCandidates.length > 0) {
    lines.push("", "## Promoted Scenarios", "");
    for (const scenario of summary.highlights.promotedScenarioCandidates) {
      const bucketText = Array.isArray(scenario.buckets) && scenario.buckets.length > 0
        ? ` (${scenario.buckets.join(", ")})`
        : "";
      lines.push(`- ${scenario.id}: ${scenario.title}${bucketText}`);
    }
  }
  return `${lines.join("\n")}\n`;
};

export const writeFullDbSweepSummary = async ({
  summary,
  outDir = "output/validation-discovery",
  outputBase = "full-db-sweep-discovery",
}) => {
  const resolvedOutDir = path.resolve(ROOT_DIR, outDir);
  await fs.mkdir(resolvedOutDir, { recursive: true });
  const timestamp = String(Date.now());
  const jsonPath = path.join(outDir, `${outputBase}-${timestamp}.json`);
  const mdPath = path.join(outDir, `${outputBase}-${timestamp}.md`);
  await writeJson(jsonPath, summary);
  await writeText(mdPath, renderFullDbSweepMarkdown(summary));
  return { jsonPath, mdPath };
};
