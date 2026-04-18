import fs from "node:fs/promises";
import path from "node:path";

import { normalizeLower, normalizeText } from "./iherb-overlay-utils.mjs";
import { ROOT_DIR, writeJson, writeText } from "./science-validation-reporting.mjs";

const slugify = (value) =>
  normalizeLower(value)
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");

const buildWaveBrandQueuePath = (relativeRoot, waveId, brandName) =>
  path.join(relativeRoot, "waves", waveId, `${slugify(brandName)}.queue.json`);

export const groupRowsByBrand = (rows) => {
  const byBrand = new Map();
  for (const row of rows) {
    const brandName = normalizeText(row?.brandName);
    if (!brandName) continue;
    if (!byBrand.has(brandName)) byBrand.set(brandName, []);
    byBrand.get(brandName).push(row);
  }
  return byBrand;
};

export const rankBrandsByRowCount = (rows) =>
  [...groupRowsByBrand(rows).entries()]
    .map(([brandName, brandRows]) => ({ brandName, count: brandRows.length, rows: brandRows }))
    .sort((left, right) => right.count - left.count || left.brandName.localeCompare(right.brandName));

export const packBrandRollupIntoWaves = ({ rankedBrands, maxWaveRows = 140 }) => {
  const waves = [];
  let currentWave = null;

  for (const brand of rankedBrands) {
    const count = Number(brand?.count ?? 0);
    if (!currentWave) {
      currentWave = { brands: [], totalRows: 0 };
    }

    if (currentWave.brands.length > 0 && currentWave.totalRows + count > maxWaveRows) {
      waves.push(currentWave);
      currentWave = { brands: [], totalRows: 0 };
    }

    currentWave.brands.push({
      brandName: brand.brandName,
      count,
      rows: brand.rows,
    });
    currentWave.totalRows += count;
  }

  if (currentWave && currentWave.brands.length > 0) {
    waves.push(currentWave);
  }

  return waves;
};

export const buildOfficialWavePlan = ({
  queueRows,
  topBrandCount = 12,
  maxWaveRows = 140,
}) => {
  const officialRows = queueRows.filter(
    (row) => normalizeText(row?.recommendedRunner) === "refresh-iherb-overlay-p0-by-official-fallback",
  );
  const laneAHardFactsRows = officialRows.filter((row) => row.lane === "lane_a_hard_facts");
  const laneBSoftFieldRows = officialRows.filter((row) => row.lane === "lane_b_soft_fields_supplement_like");

  const rankedLaneBBrands = rankBrandsByRowCount(laneBSoftFieldRows);
  const selectedLaneBBrands = rankedLaneBBrands.slice(0, topBrandCount);
  const backlogLaneBBrands = rankedLaneBBrands.slice(topBrandCount);

  const waves = [];

  if (laneAHardFactsRows.length > 0) {
    waves.push({
      waveId: "wave_lane_a_hard_facts_01",
      waveType: "lane_a_hard_facts_official_ready",
      totalRows: laneAHardFactsRows.length,
      brands: rankBrandsByRowCount(laneAHardFactsRows).map((brand) => ({
        brandName: brand.brandName,
        count: brand.count,
        rows: brand.rows,
      })),
    });
  }

  const packedLaneBWaves = packBrandRollupIntoWaves({
    rankedBrands: selectedLaneBBrands,
    maxWaveRows,
  });

  packedLaneBWaves.forEach((wave, index) => {
    waves.push({
      waveId: `wave_lane_b_official_top_${String(index + 1).padStart(2, "0")}`,
      waveType: "lane_b_soft_fields_official_top_brands",
      totalRows: wave.totalRows,
      brands: wave.brands,
    });
  });

  return {
    schemaVersion: "full_db_api_fill_official_waves.v1",
    generatedAt: new Date().toISOString(),
    summary: {
      officialReadyRows: officialRows.length,
      laneAHardFactsOfficialReadyRows: laneAHardFactsRows.length,
      laneBSoftFieldOfficialReadyRows: laneBSoftFieldRows.length,
      selectedLaneBTopBrands: selectedLaneBBrands.length,
      deferredLaneBBrands: backlogLaneBBrands.length,
      waves: waves.length,
    },
    laneBBrandRanking: rankedLaneBBrands.map((brand) => ({
      brandName: brand.brandName,
      count: brand.count,
    })),
    selectedLaneBBrandRanking: selectedLaneBBrands.map((brand) => ({
      brandName: brand.brandName,
      count: brand.count,
    })),
    deferredLaneBBrandRanking: backlogLaneBBrands.map((brand) => ({
      brandName: brand.brandName,
      count: brand.count,
    })),
    waves,
  };
};

const buildBrandCommand = ({ configPath, queuePath, stagingPath, productIds, outDir }) =>
  [
    "node scripts/maintainer/run-iherb-official-fallback-wave.mjs",
    `--config-json ${configPath}`,
    `--queue-json ${queuePath}`,
    `--staging-json ${stagingPath}`,
    `--product-ids-json '${JSON.stringify(productIds)}'`,
    `--out-dir ${outDir}`,
  ].join(" ");

export const renderOfficialWaveMarkdown = (plan, relativeRoot) => {
  const lines = [
    "# Full DB Official Fallback Waves",
    "",
    `- officialReadyRows: ${plan?.summary?.officialReadyRows ?? 0}`,
    `- laneAHardFactsOfficialReadyRows: ${plan?.summary?.laneAHardFactsOfficialReadyRows ?? 0}`,
    `- laneBSoftFieldOfficialReadyRows: ${plan?.summary?.laneBSoftFieldOfficialReadyRows ?? 0}`,
    `- selectedLaneBTopBrands: ${plan?.summary?.selectedLaneBTopBrands ?? 0}`,
    `- deferredLaneBBrands: ${plan?.summary?.deferredLaneBBrands ?? 0}`,
    "",
    "## Waves",
    "",
  ];

  for (const wave of plan?.waves ?? []) {
    lines.push(`### ${wave.waveId}`, "");
    lines.push(`- type: ${wave.waveType}`);
    lines.push(`- totalRows: ${wave.totalRows}`);
    lines.push("");
    const stagingPath = path.join(relativeRoot, "waves", wave.waveId, "staging_products.json");
    for (const brand of wave.brands ?? []) {
      const firstRow = Array.isArray(brand.rows) ? brand.rows[0] : null;
      const queuePath = buildWaveBrandQueuePath(relativeRoot, wave.waveId, brand.brandName);
      const command = buildBrandCommand({
        configPath: firstRow?.recommendedConfigPath,
        queuePath,
        stagingPath,
        productIds: (brand.rows ?? []).map((row) => row.productId).filter(Boolean),
        outDir: path.join(relativeRoot, "runs", wave.waveId, slugify(brand.brandName)),
      });
      lines.push(`- ${brand.brandName}: ${brand.count}`);
      lines.push(`  queue: ${queuePath}`);
      lines.push(`  cmd: ${command}`);
    }
    lines.push("");
  }

  return `${lines.join("\n")}`.trimEnd() + "\n";
};

export const findLatestApiFillQueueDir = async (baseDir = path.join(ROOT_DIR, "output", "full_db_api_fill_queue")) => {
  const entries = await fs.readdir(baseDir, { withFileTypes: true });
  const dirs = entries
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort((left, right) => Number(right) - Number(left));
  if (dirs.length === 0) {
    throw new Error(`No queue directories found under ${baseDir}`);
  }
  return path.join(baseDir, dirs[0]);
};

export const writeOfficialWaveOutputs = async ({
  plan,
  outDir,
}) => {
  const relativeRoot = path.relative(ROOT_DIR, outDir);
  await fs.mkdir(path.join(outDir, "runs"), { recursive: true });

  for (const wave of plan.waves ?? []) {
    const waveDir = path.join(outDir, "waves", wave.waveId);
    await fs.mkdir(waveDir, { recursive: true });
    for (const brand of wave.brands ?? []) {
      const brandSlug = slugify(brand.brandName);
      const queuePath = buildWaveBrandQueuePath(relativeRoot, wave.waveId, brand.brandName);
      await writeJson(queuePath, brand.rows);
      await writeJson(path.join(relativeRoot, "waves", wave.waveId, `${brandSlug}.meta.json`), {
        schemaVersion: "full_db_api_fill_official_brand_queue_meta.v1",
        waveId: wave.waveId,
        waveType: wave.waveType,
        brandName: brand.brandName,
        count: brand.count,
        queuePath,
      });
    }
    await writeJson(path.join(relativeRoot, "waves", wave.waveId, "wave.manifest.json"), {
      waveId: wave.waveId,
      waveType: wave.waveType,
      totalRows: wave.totalRows,
      brands: (wave.brands ?? []).map((brand) => ({
        brandName: brand.brandName,
        count: brand.count,
        configPath: brand.rows?.[0]?.recommendedConfigPath ?? null,
        queuePath: buildWaveBrandQueuePath(relativeRoot, wave.waveId, brand.brandName),
        productIds: (brand.rows ?? []).map((row) => row.productId).filter(Boolean),
      })),
    });
  }

  await writeJson(path.join(relativeRoot, "official_waves.plan.json"), plan);
  await writeText(
    path.join(relativeRoot, "official_waves.plan.md"),
    renderOfficialWaveMarkdown(plan, relativeRoot),
  );

  return {
    planJsonPath: path.join(relativeRoot, "official_waves.plan.json"),
    planMarkdownPath: path.join(relativeRoot, "official_waves.plan.md"),
  };
};

const readJsonIfExists = async (filePath) => {
  try {
    return JSON.parse(await fs.readFile(filePath, "utf8"));
  } catch {
    return null;
  }
};

const asCount = (value) => {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : 0;
};

const readScraplingMergeValidationReport = async (absoluteBrandDir) => {
  for (const candidate of [
    path.join(absoluteBrandDir, "scrapling_merge_validation_report.json"),
    path.join(absoluteBrandDir, "merge_validation", "scrapling_merge_validation_report.json"),
  ]) {
    const report = await readJsonIfExists(candidate);
    if (report) return report;
  }
  return null;
};

const readScraplingFallbackReport = async (absoluteBrandDir) =>
  readJsonIfExists(path.join(absoluteBrandDir, "scrapling_official_fallback_report.json"));

const hasBrandRunShape = async (absoluteBrandDir) => {
  for (const candidate of [
    "official_fallback_report.json",
    "scrapling_official_fallback_report.json",
    "scrapling_merge_validation_report.json",
    path.join("merge_validation", "scrapling_merge_validation_report.json"),
    "staging_products.official_refreshed.json",
    "staging_products.scrapling_merged.json",
    path.join("merge_validation", "staging_products.scrapling_merged.json"),
  ]) {
    try {
      await fs.access(path.join(absoluteBrandDir, candidate));
      return true;
    } catch {
      // Keep looking for another known brand-run marker.
    }
  }
  return false;
};

const discoverBrandRunDirs = async ({ runDir, absoluteRunDir, entries, rootDir = ROOT_DIR }) => {
  if (await hasBrandRunShape(absoluteRunDir)) {
    return [{
      brandDir: runDir,
      absoluteBrandDir: absoluteRunDir,
      brandSlug: path.basename(runDir),
    }];
  }

  return entries
    .filter((entry) => entry.isDirectory())
    .map((entry) => ({
      brandDir: path.join(runDir, entry.name),
      absoluteBrandDir: path.resolve(rootDir, runDir, entry.name),
      brandSlug: entry.name,
    }));
};

export const readOfficialWaveYieldAdmission = async ({ runDirs, rootDir = ROOT_DIR }) => {
  const brandRuns = [];

  for (const runDir of runDirs ?? []) {
    const absoluteRunDir = path.resolve(rootDir, runDir);
    let entries = [];
    try {
      entries = await fs.readdir(absoluteRunDir, { withFileTypes: true });
    } catch {
      brandRuns.push({
        runDir,
        brandDir: null,
        brandSlug: null,
        brandName: null,
        summary: {
          queued: 0,
          processed: 0,
          improvedRows: 0,
          becameFullOverlayReady: 0,
          filledIngredient: 0,
          filledDosage: 0,
          filledSuggestedUse: 0,
          filledWarnings: 0,
        },
        admissionStatus: "discovery_only",
        admissionReason: "missing_run_dir",
        hasReport: false,
        hasStaging: false,
      });
      continue;
    }

    const brandRunDirs = await discoverBrandRunDirs({ runDir, absoluteRunDir, entries, rootDir });
    for (const { brandDir, absoluteBrandDir, brandSlug } of brandRunDirs) {
      const report = await readJsonIfExists(path.join(absoluteBrandDir, "official_fallback_report.json"));
      const scraplingValidationReport = await readScraplingMergeValidationReport(absoluteBrandDir);
      const scraplingFallbackReport = await readScraplingFallbackReport(absoluteBrandDir);
      const staging = await readJsonIfExists(
        path.join(absoluteBrandDir, "staging_products.official_refreshed.json"),
      );
      const summary = report?.summary ?? {};
      const scraplingSummary = scraplingValidationReport?.summary ?? {};
      const improvedRows = Math.max(
        asCount(summary?.improvedRows),
        asCount(scraplingSummary?.improvedRows),
        Array.isArray(report?.rows) ? report.rows.filter((row) => row?.improved === true).length : 0,
        Array.isArray(scraplingValidationReport?.rows)
          ? scraplingValidationReport.rows.filter((row) => row?.improved === true).length
          : 0,
      );
      const brandName =
        normalizeText(report?.inputs?.brandName)
        || normalizeText(report?.inputs?.brandFilter)
        || normalizeText(report?.rows?.find((row) => normalizeText(row?.brandName))?.brandName)
        || normalizeText(scraplingValidationReport?.rows?.find((row) => normalizeText(row?.brandName))?.brandName)
        || normalizeText(scraplingFallbackReport?.inputs?.brandName)
        || normalizeText(scraplingFallbackReport?.inputs?.brandFilter)
        || normalizeText(scraplingFallbackReport?.results?.find((row) => normalizeText(row?.brandName))?.brandName)
        || normalizeText(staging?.products?.find((row) => normalizeText(row?.brandName))?.brandName)
        || normalizeText(brandSlug);

      brandRuns.push({
        runDir,
        brandDir,
        brandSlug,
        brandName,
        summary: {
          queued: asCount(summary?.queued),
          processed: Math.max(asCount(summary?.processed), asCount(scraplingSummary?.processed)),
          improvedRows,
          becameFullOverlayReady: Math.max(
            asCount(summary?.becameFullOverlayReady),
            asCount(scraplingSummary?.becameFullOverlayReady),
          ),
          filledIngredient: Math.max(asCount(summary?.filledIngredient), asCount(scraplingSummary?.filledIngredient)),
          filledDosage: Math.max(asCount(summary?.filledDosage), asCount(scraplingSummary?.filledDosage)),
          filledSuggestedUse: Math.max(
            asCount(summary?.filledSuggestedUse),
            asCount(scraplingSummary?.filledSuggestedUse),
          ),
          filledWarnings: Math.max(asCount(summary?.filledWarnings), asCount(scraplingSummary?.filledWarnings)),
        },
        admissionStatus: improvedRows > 0 ? "admitted" : "discovery_only",
        admissionReason: improvedRows > 0 ? "yield_positive" : report ? "zero_yield" : "missing_report",
        hasReport: Boolean(report),
        hasStaging: Boolean(staging),
      });
    }
  }

  const admittedBrandRuns = brandRuns.filter((row) => row.admissionStatus === "admitted");
  const discoveryOnlyBrandRuns = brandRuns.filter((row) => row.admissionStatus !== "admitted");

  return {
    schemaVersion: "official_wave_yield_admission.v1",
    generatedAt: new Date().toISOString(),
    summary: {
      runDirs: [...new Set((runDirs ?? []).map((value) => normalizeText(value)).filter(Boolean))].length,
      brandRuns: brandRuns.length,
      admittedBrandRuns: admittedBrandRuns.length,
      discoveryOnlyBrandRuns: discoveryOnlyBrandRuns.length,
      improvedRows: brandRuns.reduce((sum, row) => sum + asCount(row?.summary?.improvedRows), 0),
      becameFullOverlayReady: brandRuns.reduce(
        (sum, row) => sum + asCount(row?.summary?.becameFullOverlayReady),
        0,
      ),
    },
    brandRuns,
    admittedBrandRuns,
    discoveryOnlyBrandRuns,
  };
};
