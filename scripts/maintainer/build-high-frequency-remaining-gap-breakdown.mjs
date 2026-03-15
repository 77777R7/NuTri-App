#!/usr/bin/env node
/* eslint-disable no-console */
import fs from "node:fs/promises";
import path from "node:path";

const ROOT = process.cwd();
const args = process.argv.slice(2);

const getArg = (name, fallback = null) => {
  const flag = `--${name}`;
  const idx = args.indexOf(flag);
  if (idx === -1 || idx + 1 >= args.length) return fallback;
  return args[idx + 1];
};

const HIGH_FREQUENCY_DETAILS_PATH = getArg(
  "high-frequency-details-json",
  path.join(
    ROOT,
    "output",
    "iherb_overlay_high_frequency_validation_post_close_now_20260313",
    "high_frequency_hit_details.json",
  ),
);
const PARTIAL_WAVE_PLAN_PATH = getArg(
  "partial-wave-plan-json",
  path.join(ROOT, "output", "iherb_partial_wave_plan_post_close_now_20260313", "partial_wave_plan_summary.json"),
);
const DEEP_GAP_PLAN_PATH = getArg(
  "deep-gap-plan-json",
  path.join(ROOT, "output", "iherb_deep_content_gap_plan_post_close_now_20260313", "deep_content_gap_plan.json"),
);
const BRAND_MAP_PATH = getArg("brand-map-json", path.join(ROOT, "data", "iherb_rapidapi_brand_map.json"));
const CONFIG_DIR = getArg("config-dir", path.join(ROOT, "data", "iherb_official_fallback_configs"));
const BLOCKERS_PATH = getArg("blockers-md", path.join(ROOT, "output", "post_close_blockers_20260313.md"));
const OUT_JSON_PATH = getArg(
  "out-json",
  path.join(ROOT, "output", "high_frequency_remaining_gap_breakdown.json"),
);
const OUT_MD_PATH = getArg(
  "out-md",
  path.join(ROOT, "output", "high_frequency_remaining_gap_breakdown.md"),
);
const OUT_QUEUE_DIR = getArg(
  "out-queue-dir",
  path.join(ROOT, "output", "high_frequency_remaining_gap_breakdown_queues"),
);
const FIRST_KPI_BRANDS = (getArg(
  "first-kpi-brands",
  "Healthy Origins,Pure Encapsulations,Nature's Bounty",
) ?? "")
  .split(",")
  .map((value) => String(value ?? "").trim())
  .filter(Boolean);

const ALL_BUCKETS = [
  "missing_from_staging",
  "paused_brand",
  "blocked_brand",
  "identity_unresolved",
  "official_fetch_unresolved",
  "ocr_resolvable",
  "rapidapi_identity_only",
  "warnings_unresolved",
  "suggested_use_unresolved",
  "ingredient_dosage_unresolved",
  "non_us_or_conflicted",
  "no_actionable_path_yet",
];

const MOVABLE_BUCKETS = new Set([
  "official_fetch_unresolved",
  "ocr_resolvable",
  "warnings_unresolved",
  "suggested_use_unresolved",
  "ingredient_dosage_unresolved",
]);
const BLOCKER_ONLY_BUCKETS = new Set(["blocked_brand", "identity_unresolved", "non_us_or_conflicted", "no_actionable_path_yet"]);

const normalizeText = (value) =>
  String(value ?? "")
    .replace(/\u00a0/g, " ")
    .replace(/\s+/g, " ")
    .trim();

const normalizeLower = (value) => normalizeText(value).toLowerCase();
const normalizeBrandKey = (value) =>
  normalizeLower(value)
    .replace(/'/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
const slugify = (value) =>
  normalizeLower(value)
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");

const readJson = async (filePath) => JSON.parse(await fs.readFile(filePath, "utf8"));
const writeJson = async (filePath, payload) => {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
};

const readConfigBrandSet = async (configDir) => {
  const entries = await fs.readdir(configDir);
  return new Set(
    entries
      .filter((entry) => entry.endsWith(".json"))
      .map((entry) => entry.replace(/\.json$/i, ""))
      .map((entry) => normalizeBrandKey(entry.replace(/-/g, " "))),
  );
};

const summarizeTopBrands = (rows) =>
  Object.entries(
    rows.reduce((acc, row) => {
      const brandName = normalizeText(row?.brandName) || "unknown";
      acc[brandName] = (acc[brandName] ?? 0) + 1;
      return acc;
    }, {}),
  )
    .sort((left, right) => {
      if (right[1] !== left[1]) return right[1] - left[1];
      return left[0].localeCompare(right[0]);
    })
    .map(([brandName, total]) => ({ brandName, total }));

const renderBucketNote = (bucket, rowCount) => {
  switch (bucket) {
    case "official_fetch_unresolved":
      return `${rowCount} high-frequency rows remain missing from staging but already have official brand configs. These are the primary KPI-recovery candidates.`;
    case "rapidapi_identity_only":
      return `${rowCount} rows map to brands with current RapidAPI coverage, but the last exact-barcode lane only produced identity-level uplift, not closure uplift.`;
    case "blocked_brand":
      return `${rowCount} rows are currently blocked at the brand level and should not be reopened without a new path.`;
    case "no_actionable_path_yet":
      return `${rowCount} rows do not currently have a proven executable path on this line.`;
    default:
      return `${rowCount} rows`;
  }
};

const main = async () => {
  const [highFrequencyDetails, partialWavePlan, deepGapPlan, brandMapPayload, configBrandSet] = await Promise.all([
    readJson(HIGH_FREQUENCY_DETAILS_PATH),
    readJson(PARTIAL_WAVE_PLAN_PATH),
    readJson(DEEP_GAP_PLAN_PATH),
    readJson(BRAND_MAP_PATH),
    readConfigBrandSet(CONFIG_DIR),
  ]);
  const brandMap = new Map(
    (Array.isArray(brandMapPayload?.brands) ? brandMapPayload.brands : []).map((row) => [
      normalizeBrandKey(row?.brandName),
      row,
    ]),
  );

  const highFrequencyRows = Array.isArray(highFrequencyDetails) ? highFrequencyDetails : [];
  const remainingRows = highFrequencyRows.filter(
    (row) => normalizeText(row?.validationOutcome) !== "complete_hit",
  );
  const completeHitCount = highFrequencyRows.filter((row) => normalizeText(row?.validationOutcome) === "complete_hit").length;
  const currentCompleteHitRate =
    highFrequencyRows.length > 0 ? Number(((completeHitCount / highFrequencyRows.length) * 100).toFixed(1)) : 0;

  const bucketRows = Object.fromEntries(ALL_BUCKETS.map((bucket) => [bucket, []]));

  for (const row of remainingRows) {
    const brandName = normalizeText(row?.brandName);
    const brandKey = normalizeBrandKey(brandName);
    const brandMapRow = brandMap.get(brandKey) ?? null;
    const hasOfficialConfig = configBrandSet.has(brandKey);
    const isUnavailableBrand = brandMapRow?.status === "unavailable";
    const isBlockedBrand = isUnavailableBrand || brandName === "Spring Valley";

    let bucket = "no_actionable_path_yet";
    if (normalizeText(row?.validationOutcome) !== "missing_from_staging") {
      bucket = normalizeText(row?.validationOutcome) === "staging_present_not_complete" ? "official_fetch_unresolved" : "no_actionable_path_yet";
    } else if (isBlockedBrand) {
      bucket = "blocked_brand";
    } else if (hasOfficialConfig) {
      bucket = "official_fetch_unresolved";
    } else if (brandMapRow?.status === "available") {
      bucket = "rapidapi_identity_only";
    }

    bucketRows[bucket].push({
      ...row,
      bucket,
      executableThisWeek: MOVABLE_BUCKETS.has(bucket),
      blockerOnly: BLOCKER_ONLY_BUCKETS.has(bucket),
    });
  }

  const bucketSummaries = ALL_BUCKETS.map((bucket) => {
    const rows = bucketRows[bucket];
    const topBrands = summarizeTopBrands(rows);
    return {
      bucket,
      total: rows.length,
      executableThisWeek: MOVABLE_BUCKETS.has(bucket),
      blockerOnly: BLOCKER_ONLY_BUCKETS.has(bucket),
      note: renderBucketNote(bucket, rows.length),
      topBrands: topBrands.slice(0, 20),
    };
  });

  const largestMovableBucket =
    bucketSummaries
      .filter((bucket) => bucket.executableThisWeek)
      .sort((left, right) => {
        if (right.total !== left.total) return right.total - left.total;
        return left.bucket.localeCompare(right.bucket);
      })[0]?.bucket ?? null;

  await fs.mkdir(OUT_QUEUE_DIR, { recursive: true });
  for (const bucket of ALL_BUCKETS) {
    await writeJson(path.join(OUT_QUEUE_DIR, `${bucket}.json`), bucketRows[bucket]);
  }

  const firstWaveRows = FIRST_KPI_BRANDS.flatMap((brandName) =>
    bucketRows.official_fetch_unresolved.filter((row) => normalizeBrandKey(row.brandName) === normalizeBrandKey(brandName)),
  );
  for (const brandName of FIRST_KPI_BRANDS) {
    const brandRows = bucketRows.official_fetch_unresolved.filter(
      (row) => normalizeBrandKey(row.brandName) === normalizeBrandKey(brandName),
    );
    await writeJson(path.join(OUT_QUEUE_DIR, `first_kpi_wave_${slugify(brandName)}.json`), brandRows);
  }
  await writeJson(path.join(OUT_QUEUE_DIR, "first_kpi_wave_all.json"), firstWaveRows);

  const report = {
    schemaVersion: "high_frequency_remaining_gap_breakdown.v1",
    generatedAt: new Date().toISOString(),
    inputs: {
      highFrequencyDetailsPath: HIGH_FREQUENCY_DETAILS_PATH,
      partialWavePlanPath: PARTIAL_WAVE_PLAN_PATH,
      deepGapPlanPath: DEEP_GAP_PLAN_PATH,
      brandMapPath: BRAND_MAP_PATH,
      configDir: CONFIG_DIR,
      blockersPath: BLOCKERS_PATH,
    },
    baseline: {
      uniqueCandidates: highFrequencyRows.length,
      remainingNonComplete: remainingRows.length,
      currentCompleteHitCount: completeHitCount,
      currentCompleteHitRate,
    },
    context: {
      officialCatalogImageOcrRows: Number(partialWavePlan?.summary?.officialCatalogImageOcrRows ?? 0),
      rapidapiPartialRows: Number(partialWavePlan?.summary?.rapidapiPartialRows ?? 0),
      deepContentGapTotal: Number(deepGapPlan?.summary?.deepContentGapTotal ?? 0),
      unknownCategoryTotal: Number(deepGapPlan?.summary?.unknownCategoryTotal ?? 0),
    },
    summary: {
      totalRemainingHighFrequencyRows: remainingRows.length,
      largestMovableBucket,
      firstKpiWaveBrandOrder: FIRST_KPI_BRANDS,
    },
    buckets: bucketSummaries,
  };

  const lines = [
    "# High-Frequency Remaining Gap Breakdown",
    "",
    `- generatedAt: ${report.generatedAt}`,
    `- total_remaining_high_frequency_rows: ${report.summary.totalRemainingHighFrequencyRows}`,
    `- largest_movable_bucket: ${report.summary.largestMovableBucket ?? "n/a"}`,
    `- first_kpi_wave_brand_order: ${report.summary.firstKpiWaveBrandOrder.join(", ")}`,
    "",
    "## Bucket Summary",
    "",
  ];

  for (const bucket of bucketSummaries) {
    lines.push(`- ${bucket.bucket}: total=${bucket.total} | executable_this_week=${bucket.executableThisWeek} | blocker_only=${bucket.blockerOnly}`);
    if (bucket.note) lines.push(`  ${bucket.note}`);
    for (const brand of bucket.topBrands.slice(0, 10)) {
      lines.push(`  - ${brand.brandName}: ${brand.total}`);
    }
  }

  lines.push("", "## First KPI Wave Queues", "");
  for (const brandName of FIRST_KPI_BRANDS) {
    const brandRows = bucketRows.official_fetch_unresolved.filter(
      (row) => normalizeBrandKey(row.brandName) === normalizeBrandKey(brandName),
    );
    lines.push(`- ${brandName}: ${brandRows.length}`);
  }

  await writeJson(OUT_JSON_PATH, report);
  await fs.writeFile(OUT_MD_PATH, `${lines.join("\n")}\n`, "utf8");

  console.log(
    JSON.stringify(
      {
        ok: true,
        outputs: {
          json: OUT_JSON_PATH,
          md: OUT_MD_PATH,
          queueDir: OUT_QUEUE_DIR,
        },
        summary: report.summary,
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
