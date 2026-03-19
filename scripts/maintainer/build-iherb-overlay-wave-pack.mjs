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

const ACTIVE_QUEUE_PATH = getArg(
  "active-queue-json",
  path.join(ROOT, "output", "iherb_overlay_execution_plan_full_p0p1_final", "active_priority_queue.json"),
);
const HIGH_FREQUENCY_DETAILS_PATH = getArg(
  "high-frequency-details-json",
  path.join(
    ROOT,
    "output",
    "iherb_overlay_high_frequency_validation_full_p0p1_final",
    "high_frequency_hit_details.json",
  ),
);
const OUT_DIR = getArg("out-dir", path.join(ROOT, "output", "iherb_overlay_wave_pack"));
const KPI_BRANDS = (getArg("kpi-brands", "Carlson,Nature's Bounty,Nature Made,Solgar"))
  .split(",")
  .map((item) => item.trim())
  .filter(Boolean);
const COVERAGE_BRANDS = (getArg("coverage-brands", "NOW Foods,Frontier Co-op,Boiron,Aura Cacia,Wet n Wild"))
  .split(",")
  .map((item) => item.trim())
  .filter(Boolean);
const MISSING_BRANDS = (getArg("missing-brands", "Healthy Origins,Schiff,Natrol,Spring Valley,Centrum"))
  .split(",")
  .map((item) => item.trim())
  .filter(Boolean);

const normalizeText = (value) =>
  String(value ?? "")
    .replace(/\u00a0/g, " ")
    .replace(/\s+/g, " ")
    .trim();
const normalizeLower = (value) => normalizeText(value).toLowerCase();
const slugify = (value) =>
  normalizeLower(value)
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");

const readJson = async (filePath) => JSON.parse(await fs.readFile(filePath, "utf8"));

const writeJson = async (filePath, payload) => {
  await fs.writeFile(filePath, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
};

const sortByTitle = (rows) =>
  [...rows].sort((left, right) => {
    const brandCmp = String(left.brandName).localeCompare(String(right.brandName));
    if (brandCmp !== 0) return brandCmp;
    return String(left.title ?? left.productName).localeCompare(String(right.title ?? right.productName));
  });

const buildMissingCounts = (rows) =>
  Object.entries(
    rows.reduce((acc, row) => {
      const key = (row.coreMissingFields ?? []).join("|") || "none";
      acc[key] = (acc[key] ?? 0) + 1;
      return acc;
    }, {}),
  ).sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0]));

const buildSummaryMd = (report) => {
  const lines = [
    "# iHerb Overlay Wave Pack",
    "",
    `- generatedAt: ${report.generatedAt}`,
    `- activeQueuePath: ${report.inputs.activeQueuePath}`,
    `- highFrequencyDetailsPath: ${report.inputs.highFrequencyDetailsPath}`,
    "",
    "## KPI Wave",
    "",
    `- brands: ${report.kpiWave.brands.join(", ")}`,
    `- rows: ${report.kpiWave.rows.length}`,
    "",
    "## Coverage Wave",
    "",
    `- brands: ${report.coverageWave.brands.join(", ")}`,
    "",
  ];

  for (const brand of report.coverageWave.brandRollup) {
    lines.push(
      `- ${brand.brandName}: total=${brand.total}, top_missing=${brand.missingCounts[0]?.[0] || "none"} (${brand.missingCounts[0]?.[1] || 0})`,
    );
  }

  lines.push("", "## Missing From Staging Wave", "", `- brands: ${report.missingWave.brands.join(", ")}`, `- rows: ${report.missingWave.rows.length}`, "");
  for (const brand of report.missingWave.brandRollup) {
    lines.push(`- ${brand.brandName}: missing_rows=${brand.total}`);
  }

  return `${lines.join("\n")}\n`;
};

const main = async () => {
  await fs.mkdir(OUT_DIR, { recursive: true });
  await fs.mkdir(path.join(OUT_DIR, "kpi_brand_queues"), { recursive: true });
  await fs.mkdir(path.join(OUT_DIR, "coverage_brand_queues"), { recursive: true });
  await fs.mkdir(path.join(OUT_DIR, "missing_brand_queues"), { recursive: true });

  const [activeQueueRows, highFrequencyDetails] = await Promise.all([
    readJson(ACTIVE_QUEUE_PATH),
    readJson(HIGH_FREQUENCY_DETAILS_PATH),
  ]);

  const activeQueue = Array.isArray(activeQueueRows) ? activeQueueRows : [];
  const highFrequency = Array.isArray(highFrequencyDetails) ? highFrequencyDetails : [];

  const activeHighFrequencyBarcodes = new Set(
    highFrequency
      .filter((row) => row.validationOutcome === "active_queue")
      .map((row) => normalizeText(row.barcode_gtin14))
      .filter(Boolean),
  );

  const kpiRows = sortByTitle(
    activeQueue.filter(
      (row) =>
        KPI_BRANDS.some((brand) => normalizeLower(row.brandName) === normalizeLower(brand)) &&
        activeHighFrequencyBarcodes.has(normalizeText(row.barcode_gtin14)),
    ),
  );

  const coverageBrandRollup = COVERAGE_BRANDS.map((brandName) => {
    const rows = sortByTitle(activeQueue.filter((row) => normalizeLower(row.brandName) === normalizeLower(brandName)));
    return {
      brandName,
      total: rows.length,
      missingCounts: buildMissingCounts(rows),
      sampleRows: rows.slice(0, 20),
    };
  }).filter((row) => row.total > 0);

  const missingRows = sortByTitle(
    highFrequency.filter(
      (row) =>
        row.validationOutcome === "missing_from_staging" &&
        MISSING_BRANDS.some((brand) => normalizeLower(row.brandName) === normalizeLower(brand)),
    ),
  );

  const missingBrandRollup = MISSING_BRANDS.map((brandName) => {
    const rows = missingRows.filter((row) => normalizeLower(row.brandName) === normalizeLower(brandName));
    return {
      brandName,
      total: rows.length,
      sampleRows: rows.slice(0, 20),
    };
  }).filter((row) => row.total > 0);

  for (const brandName of KPI_BRANDS) {
    const rows = kpiRows.filter((row) => normalizeLower(row.brandName) === normalizeLower(brandName));
    await writeJson(path.join(OUT_DIR, "kpi_brand_queues", `${slugify(brandName)}.json`), rows);
  }

  for (const brand of coverageBrandRollup) {
    const rows = activeQueue.filter((row) => normalizeLower(row.brandName) === normalizeLower(brand.brandName));
    await writeJson(path.join(OUT_DIR, "coverage_brand_queues", `${slugify(brand.brandName)}.json`), sortByTitle(rows));
  }

  for (const brand of missingBrandRollup) {
    const rows = missingRows.filter((row) => normalizeLower(row.brandName) === normalizeLower(brand.brandName));
    await writeJson(path.join(OUT_DIR, "missing_brand_queues", `${slugify(brand.brandName)}.json`), rows);
  }

  const report = {
    schemaVersion: "iherb_overlay_wave_pack.v1",
    generatedAt: new Date().toISOString(),
    inputs: {
      activeQueuePath: ACTIVE_QUEUE_PATH,
      highFrequencyDetailsPath: HIGH_FREQUENCY_DETAILS_PATH,
    },
    kpiWave: {
      brands: KPI_BRANDS,
      rows: kpiRows,
    },
    coverageWave: {
      brands: COVERAGE_BRANDS,
      brandRollup: coverageBrandRollup,
    },
    missingWave: {
      brands: MISSING_BRANDS,
      rows: missingRows,
      brandRollup: missingBrandRollup,
    },
  };

  await writeJson(path.join(OUT_DIR, "wave_pack_summary.json"), report);
  await fs.writeFile(path.join(OUT_DIR, "wave_pack_summary.md"), buildSummaryMd(report), "utf8");
  await writeJson(path.join(OUT_DIR, "kpi_active_queue.json"), kpiRows);
  await writeJson(path.join(OUT_DIR, "missing_from_staging_wave.json"), missingRows);

  console.log(
    JSON.stringify(
      {
        ok: true,
        outputs: {
          summaryJson: path.join(OUT_DIR, "wave_pack_summary.json"),
          summaryMd: path.join(OUT_DIR, "wave_pack_summary.md"),
          kpiQueueJson: path.join(OUT_DIR, "kpi_active_queue.json"),
          missingWaveJson: path.join(OUT_DIR, "missing_from_staging_wave.json"),
        },
        counts: {
          kpiRows: kpiRows.length,
          coverageBrands: coverageBrandRollup.length,
          missingRows: missingRows.length,
        },
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
