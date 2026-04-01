#!/usr/bin/env node
/* eslint-disable no-console */
import fs from "node:fs/promises";
import path from "node:path";

import { normalizeText, normalizeLower } from "./lib/iherb-overlay-utils.mjs";

const ROOT = process.cwd();
const args = process.argv.slice(2);

const getArg = (name, fallback = null) => {
  const flag = `--${name}`;
  const idx = args.indexOf(flag);
  if (idx === -1 || idx + 1 >= args.length) return fallback;
  return args[idx + 1];
};

const DEFAULT_MASTER_QUEUE_DIR = path.join(
  ROOT,
  "output",
  `scrapling_human_supplement_master_queue_${new Date().toISOString().slice(0, 10).replace(/-/g, "")}`,
);

const MASTER_QUEUE_PATH = getArg(
  "master-queue-json",
  path.join(DEFAULT_MASTER_QUEUE_DIR, "human_supplement_master_queue.rows.json"),
);
const STAGING_PATH = getArg(
  "staging-json",
  path.join(
    ROOT,
    "output",
    "p0_p3_codeage_remaining_six_closure_20260317",
    "unified_wave",
    "staging_products.official_refreshed.sanitized.json",
  ),
);
const OUT_DIR = getArg(
  "out-dir",
  path.join(ROOT, "output", `scrapling_wave_manifest_${new Date().toISOString().slice(0, 10).replace(/-/g, "")}`),
);
const RAW_BRAND_FILTERS = (getArg(
  "prioritized-brands",
  "Nutricost,Pure Encapsulations,Life Extension,Garden of Life",
) || "")
  .split(",")
  .map((value) => normalizeText(value))
  .filter(Boolean);
const USE_ALL_BRANDS =
  RAW_BRAND_FILTERS.length === 0 ||
  RAW_BRAND_FILTERS.some((value) => value === "*" || normalizeLower(value) === "all");
const BATCH_SIZE = Math.max(1, Number(getArg("batch-size", 12)) || 12);

const readJson = async (filePath) => JSON.parse(await fs.readFile(path.resolve(ROOT, filePath), "utf8"));
const writeJson = async (filePath, payload) => {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
};
const writeText = async (filePath, body) => {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, body, "utf8");
};
const slugify = (value) =>
  normalizeLower(value)
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
const toArray = (value) => (Array.isArray(value) ? value : []);
const hasSourceType = (row, sourceType) => toArray(row?.sourceTypes).includes(sourceType);
const knownUrlsText = (row) => toArray(row?.knownProductUrls).join(" ");

const fieldWeight = {
  ingredient: 100,
  dosage: 100,
  suggested_use: 40,
  warnings: 30,
  product_image: 10,
};

const scoreRow = (row) => {
  const missingScore = toArray(row?.coreMissingFields).reduce(
    (sum, field) => sum + (fieldWeight[normalizeLower(field)] ?? 0),
    0,
  );
  const policyBoost = row?.recommendedMode === "reader_scrapling_then_agent_browser" ? 5 : 0;
  return missingScore + policyBoost;
};

const sortBrandRows = (rows) =>
  [...rows].sort((left, right) => {
    const scoreDiff = scoreRow(right) - scoreRow(left);
    if (scoreDiff !== 0) return scoreDiff;
    return normalizeText(left.title).localeCompare(normalizeText(right.title));
  });

const chunk = (rows, size) => {
  const out = [];
  for (let i = 0; i < rows.length; i += size) {
    out.push(rows.slice(i, i + size));
  }
  return out;
};

const deriveSourceBucket = (row) => {
  const urls = knownUrlsText(row);
  const brandSlug = slugify(row?.brandName ?? "");
  if (row?.hasUsIherbPage || /iherb/i.test(urls)) {
    return {
      key: "iherb-confirmed",
      sourcePreference: "iherb",
    };
  }
  if (
    brandSlug === "pure-encapsulations" &&
    (
      hasSourceType(row, "smartq_public_product_page") ||
      hasSourceType(row, "official_sitemap_title") ||
      /smartq\.pureforyou\.com\/products\//i.test(urls) ||
      /pureencapsulationspro\.com\/sitemap/i.test(urls)
    )
  ) {
    return {
      key: "official-browser-candidate",
      sourcePreference: "official-browser",
    };
  }
  if (hasSourceType(row, "smartq_public_product_page") || /smartq/i.test(urls)) {
    return {
      key: "smartq-product",
      sourcePreference: "smartq",
    };
  }
  if (hasSourceType(row, "atriumpro_public_product_page") || /atriumpro/i.test(urls)) {
    return {
      key: "atriumpro-product",
      sourcePreference: "atriumpro",
    };
  }
  if (hasSourceType(row, "official_product_page") || /\/products?\//i.test(urls)) {
    return {
      key: "official-product",
      sourcePreference: "official",
    };
  }
  if (hasSourceType(row, "official_sitemap_title")) {
    return {
      key: "official-sitemap-only",
      sourcePreference: "official",
    };
  }
  return {
    key: "generic-known-url",
    sourcePreference: "auto",
  };
};

const SOFT_MISSING_FIELDS = new Set(["warnings", "suggested_use"]);
const BOOTSTRAP_EXCLUDE_PATTERNS = [
  /\b(detergent|laundry|dishwashing|cleaner|air freshener|shampoo|conditioner|soap|sunscreen|toothpaste|baby powder)\b/i,
  /\b(mustard|relish|ketchup|dip|spread|preserves?|marinara|jerky|pasta|lasagn(?:e|a)|fusilli|orzo|beans?|puree|sandwich bar)\b/i,
  /\b(advil|aleve|claritin|mucinex|tylenol|dulcolax|dramamine|unisom|zantac|xyzal|zicam|alka-seltzer|coricidin|vicks|tums|prilosec|homeopathic|expectorant|allergy|sinus|cough)\b/i,
];
const SMALL_LANE_SUPPLEMENT_SIGNAL_PATTERNS = [
  /\b(capsule|capsules|tablet|tablets|softgel|softgels|gummy|gummies|powder|packets?|drops?|chewable|chewables|vegicaps?|vegcaps?)\b/i,
  /\b(\d+\s*(mg|mcg|g|iu|cfu))\b/i,
  /\b(vitamin|mineral|multivitamin|probiotic|omega|fish oil|melatonin|magnesium|creatine|amino|ashwagandha|electrolyte|sleep|gut health|sports supplements?)\b/i,
  /\b(chlorella|spirulina|maca|mushroom|lion'?s mane|berberine|inositol|nattokinase|irish sea moss|urolithin)\b/i,
];
const HARD_GAP_SUPPLEMENT_SIGNAL_PATTERNS = [
  /\b(capsule|capsules|tablet|tablets|softgel|softgels|gummy|gummies|lozenge|lozenges|drops?)\b/i,
  /\b(extract|extracts|tincture|tinctures|glycerite|glycerites|powder|powders|spray|sprays|chewable|chewables)\b/i,
  /\b(\d+\s*(mg|mcg|iu|cfu))\b/i,
  /\b(vitamin|mineral|multivitamin|probiotic|omega|fish oil|melatonin|magnesium|creatine|electrolyte|sleep|gut health)\b/i,
  /\b(pre-?workout|ahcc|nac|bilberry|quercetin|goldenseal|echinacea|elderberry|slippery elm|tart cherry|kidney formula|intest(?:inal|ine)|herbal formulas?)\b/i,
];

const summarizeLaneRows = (rows) => {
  const summary = {
    rowCount: rows.length,
    missingFieldCounts: {},
    onlySoftMissingCount: 0,
    warningsOnlyCount: 0,
    missingIngredientOrDosageCount: 0,
    bootstrapExcludedCount: 0,
  };

  for (const row of rows) {
    const missing = toArray(row?.coreMissingFields).map((field) => normalizeLower(field)).filter(Boolean);
    for (const field of missing) {
      summary.missingFieldCounts[field] = (summary.missingFieldCounts[field] ?? 0) + 1;
    }
    if (missing.every((field) => SOFT_MISSING_FIELDS.has(field))) {
      summary.onlySoftMissingCount += 1;
    }
    if (missing.length === 1 && missing[0] === "warnings") {
      summary.warningsOnlyCount += 1;
    }
    if (missing.includes("ingredient") || missing.includes("dosage")) {
      summary.missingIngredientOrDosageCount += 1;
    }
    const corpus = [normalizeText(row?.title), normalizeText(row?.dosageForm), ...toArray(row?.categories)].join(" | ");
    if (BOOTSTRAP_EXCLUDE_PATTERNS.some((pattern) => pattern.test(corpus))) {
      summary.bootstrapExcludedCount += 1;
    }
  }

  summary.onlySoftMissingPct = summary.rowCount > 0 ? summary.onlySoftMissingCount / summary.rowCount : 0;
  summary.warningsOnlyPct = summary.rowCount > 0 ? summary.warningsOnlyCount / summary.rowCount : 0;
  summary.missingIngredientOrDosagePct =
    summary.rowCount > 0 ? summary.missingIngredientOrDosageCount / summary.rowCount : 0;
  return summary;
};

const deriveBootstrapLaneStatus = (laneKey, laneRows) => {
  if (laneKey !== "iherb-confirmed") {
    return { status: null, reason: null };
  }
  const summary = summarizeLaneRows(laneRows);
  const strictSmallLaneEligible = laneRows.every((row) => {
    const corpus = [normalizeText(row?.brandName), normalizeText(row?.title), normalizeText(row?.dosageForm), ...toArray(row?.categories)].join(" | ");
    return SMALL_LANE_SUPPLEMENT_SIGNAL_PATTERNS.some((pattern) => pattern.test(corpus));
  });
  const hardGapSupplementEligible = laneRows.every((row) => {
    const corpus = [normalizeText(row?.brandName), normalizeText(row?.title), normalizeText(row?.dosageForm), ...toArray(row?.categories)].join(" | ");
    return HARD_GAP_SUPPLEMENT_SIGNAL_PATTERNS.some((pattern) => pattern.test(corpus));
  });
  const bootstrapEligible =
    summary.rowCount >= 4 &&
    summary.onlySoftMissingPct >= 0.65 &&
    summary.missingIngredientOrDosagePct <= 0.35 &&
    summary.bootstrapExcludedCount === 0;

  const bootstrapEligibleSmallLane =
    summary.rowCount >= 1 &&
    summary.rowCount <= 3 &&
    summary.onlySoftMissingPct >= 0.5 &&
    summary.missingIngredientOrDosagePct <= 0.5 &&
    summary.bootstrapExcludedCount === 0 &&
    (strictSmallLaneEligible || summary.warningsOnlyPct >= 0.5);

  if (!bootstrapEligible && !bootstrapEligibleSmallLane) {
    const hardGapRecoveryEligible =
      summary.rowCount >= 1 &&
      summary.rowCount <= 15 &&
      summary.bootstrapExcludedCount === 0 &&
      summary.missingIngredientOrDosagePct >= 0.5 &&
      hardGapSupplementEligible;

    if (!hardGapRecoveryEligible) {
      return { status: null, reason: null, summary };
    }

    return {
      status: "GO",
      reason:
        "Bootstrap GO: small iHerb-confirmed supplement lane with recoverable ingredient/dosage gaps and strong supplement-form signals.",
      summary,
    };
  }

  return {
    status: "GO",
    reason: bootstrapEligibleSmallLane
      ? "Bootstrap GO: small clean iHerb-confirmed lane with warnings/suggested_use-only gaps and explicit supplement-form signals."
      : "Bootstrap GO: iHerb-confirmed lane with mostly warnings/suggested_use-only gaps and no obvious food/personal-care/OTC contamination.",
    summary,
  };
};

const main = async () => {
  const masterQueue = await readJson(MASTER_QUEUE_PATH);
  const rows = Array.isArray(masterQueue) ? masterQueue : (masterQueue.rows ?? []);

  const grouped = new Map();
  for (const row of rows) {
    const brandName = normalizeText(row?.brandName ?? null);
    if (!brandName) continue;
    if (!grouped.has(brandName)) grouped.set(brandName, []);
    grouped.get(brandName).push(row);
  }

  const laneConfigDir = path.join(OUT_DIR, "lane_configs");
  const brandQueueDir = path.join(OUT_DIR, "brand_queues");
  await fs.mkdir(laneConfigDir, { recursive: true });
  await fs.mkdir(brandQueueDir, { recursive: true });

  const manifestBrands = [];
  const targetBrands = USE_ALL_BRANDS
    ? [...grouped.keys()].sort((a, b) => a.localeCompare(b))
    : RAW_BRAND_FILTERS;
  for (const brandName of targetBrands) {
    const brandRows = sortBrandRows(grouped.get(brandName) ?? []);
    const lanesMap = new Map();
    for (const row of brandRows) {
      const lane = deriveSourceBucket(row);
      if (!lanesMap.has(lane.key)) {
        lanesMap.set(lane.key, {
          key: lane.key,
          sourcePreference: lane.sourcePreference,
          rows: [],
        });
      }
      lanesMap.get(lane.key).rows.push(row);
    }

    const lanes = [];
    for (const lane of [...lanesMap.values()].sort((a, b) => a.key.localeCompare(b.key))) {
      const laneRows = sortBrandRows(lane.rows);
      const bootstrap = deriveBootstrapLaneStatus(lane.key, laneRows);
      const brandQueuePath = path.join(brandQueueDir, `${slugify(brandName)}__${slugify(lane.key)}.json`);
      await writeJson(brandQueuePath, laneRows);

      const batches = chunk(laneRows, BATCH_SIZE).map((batchRows, idx) => {
        const waveNumber = String(idx + 1).padStart(2, "0");
        const waveId = `${slugify(brandName)}_${slugify(lane.key)}_wave_${waveNumber}`;
        const configPath = path.join(laneConfigDir, `${waveId}.json`);
        const configPayload = {
          name: `${slugify(brandName)}_${slugify(lane.key)}_human_supplement_wave_${waveNumber}`,
          stagingPath: path.relative(ROOT, path.resolve(ROOT, STAGING_PATH)),
          queuePath: path.relative(ROOT, brandQueuePath),
          outDir: `output/scrapling_bulk_program_runs/${waveId}`,
          brandFilter: brandName,
          limit: batchRows.length,
          execute: false,
          scraplingMode: "plain",
          sourcePreference: lane.sourcePreference,
          includeProductIds: batchRows.map((row) => String(row.productId)),
        };
        return {
          waveId,
          brandName,
          sourceBucket: lane.key,
          sourcePreference: lane.sourcePreference,
          count: batchRows.length,
          productIds: batchRows.map((row) => String(row.productId)),
          missingFieldCounts: batchRows.reduce((acc, row) => {
            for (const field of toArray(row?.coreMissingFields)) {
              const key = normalizeText(field);
              acc[key] = (acc[key] ?? 0) + 1;
            }
            return acc;
          }, {}),
          brandQueuePath: path.relative(ROOT, brandQueuePath),
          configPath: path.relative(ROOT, configPath),
          configPayload,
        };
      });

      for (const batch of batches) {
        await writeJson(path.join(ROOT, batch.configPath), batch.configPayload);
      }

      lanes.push({
        sourceBucket: lane.key,
        sourcePreference: lane.sourcePreference,
        status: bootstrap.status,
        bootstrapReason: bootstrap.reason,
        laneSummary: bootstrap.summary,
        totalRows: laneRows.length,
        waves: batches.map(({ configPayload, ...rest }) => rest),
      });
    }

    manifestBrands.push({
      brandName,
      totalRows: brandRows.length,
      batchSize: BATCH_SIZE,
      lanes,
      waves: lanes.flatMap((lane) => lane.waves),
    });
  }

  const manifest = {
    schemaVersion: "scrapling_wave_manifest.v1",
    generatedAt: new Date().toISOString(),
    inputs: {
      masterQueuePath: path.relative(ROOT, path.resolve(ROOT, MASTER_QUEUE_PATH)),
      stagingPath: path.relative(ROOT, path.resolve(ROOT, STAGING_PATH)),
      prioritizedBrands: RAW_BRAND_FILTERS,
      useAllBrands: USE_ALL_BRANDS,
      batchSize: BATCH_SIZE,
    },
    brands: manifestBrands,
  };

  const manifestPath = path.join(OUT_DIR, "scrapling_wave_manifest.json");
  const summaryMdPath = path.join(OUT_DIR, "scrapling_wave_manifest.md");
  await writeJson(manifestPath, manifest);

  const md = [
    "# Scrapling Wave Manifest",
    "",
    `- generatedAt: ${manifest.generatedAt}`,
    `- masterQueuePath: ${manifest.inputs.masterQueuePath}`,
    `- stagingPath: ${manifest.inputs.stagingPath}`,
    `- batchSize: ${manifest.inputs.batchSize}`,
    "",
    "## Brand Waves",
    "",
    ...manifestBrands.flatMap((brand) => [
      `### ${brand.brandName}`,
      `- totalRows: ${brand.totalRows}`,
      ...brand.lanes.flatMap((lane) => [
        `- lane ${lane.sourceBucket}: totalRows=${lane.totalRows} | sourcePreference=${lane.sourcePreference}${lane.status ? ` | bootstrapStatus=${lane.status}` : ""}`,
        ...(lane.bootstrapReason ? [`  - bootstrapReason: ${lane.bootstrapReason}`] : []),
        ...lane.waves.map((wave) => {
          const missing = Object.entries(wave.missingFieldCounts)
            .sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0]))
            .map(([field, count]) => `${field}=${count}`)
            .join(", ");
          return `  - ${wave.waveId}: count=${wave.count} | config=${wave.configPath}${missing ? ` | missing=${missing}` : ""}`;
        }),
      ]),
      "",
    ]),
  ].join("\n");
  await writeText(summaryMdPath, `${md}\n`);

  console.log(
    JSON.stringify(
      {
        ok: true,
        outputs: {
          manifestPath,
          summaryMdPath,
          laneConfigDir,
          brandQueueDir,
        },
        brands: manifestBrands.map((brand) => ({
          brandName: brand.brandName,
          totalRows: brand.totalRows,
          waves: brand.waves.length,
        })),
      },
      null,
      2,
    ),
  );
};

main().catch((error) => {
  console.error(error instanceof Error ? error.stack : String(error));
  process.exit(1);
});
