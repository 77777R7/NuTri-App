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
  path.join(ROOT, "output", "iherb_overlay_execution_plan_missing_wave_rapidapi_strict_20260313", "active_priority_queue.json"),
);
const HIGH_FREQUENCY_DETAILS_PATH = getArg(
  "high-frequency-details-json",
  path.join(
    ROOT,
    "output",
    "iherb_overlay_high_frequency_validation_missing_wave_rapidapi_strict_20260313",
    "high_frequency_hit_details.json",
  ),
);
const CONFIG_DIR = getArg(
  "config-dir",
  path.join(ROOT, "data", "iherb_official_fallback_configs"),
);
const OUT_DIR = getArg("out-dir", path.join(ROOT, "output", "iherb_partial_wave_plan"));

const normalizeText = (value) =>
  String(value ?? "")
    .replace(/\u00a0/g, " ")
    .replace(/\s+/g, " ")
    .trim();
const normalizeLower = (value) => normalizeText(value).toLowerCase();
const normalizeDigits = (value) => normalizeText(value).replace(/\D/g, "");
const slugify = (value) =>
  normalizeLower(value)
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");

const readJson = async (filePath) => JSON.parse(await fs.readFile(filePath, "utf8"));

const writeJson = async (filePath, payload) => {
  await fs.writeFile(filePath, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
};

const hasAnyMissing = (row, fields) =>
  fields.some((field) => Array.isArray(row?.coreMissingFields) && row.coreMissingFields.includes(field));

const buildHighFrequencySet = (rows) =>
  new Set(
    rows
      .filter((row) => normalizeText(row?.validationOutcome) === "active_queue")
      .map((row) => normalizeDigits(row?.barcode_gtin14))
      .filter(Boolean),
  );

const summarizeBrandRows = (rows, highFrequencySet) =>
  Object.values(
    rows.reduce((acc, row) => {
      const brandName = normalizeText(row?.brandName) || "unknown";
      const key = normalizeLower(brandName);
      if (!acc[key]) {
        acc[key] = {
          brandName,
          total: 0,
          highFrequencyRows: 0,
          p0Rows: 0,
          p1Rows: 0,
          usageOnlyRows: 0,
          factsRows: 0,
          sampleRows: [],
        };
      }
      const bucket = acc[key];
      bucket.total += 1;
      if (normalizeText(row?.priorityLane) === "P0_api_fill_us_strong_identity") bucket.p0Rows += 1;
      if (normalizeText(row?.priorityLane) === "P1_api_fill_non_us_strong_identity") bucket.p1Rows += 1;
      if (hasAnyMissing(row, ["suggested_use", "warnings"])) bucket.usageOnlyRows += 1;
      if (hasAnyMissing(row, ["ingredient", "dosage"])) bucket.factsRows += 1;
      if (highFrequencySet.has(normalizeDigits(row?.barcode_gtin14))) bucket.highFrequencyRows += 1;
      if (bucket.sampleRows.length < 8) {
        bucket.sampleRows.push({
          title: row?.title ?? null,
          productId: row?.productId ?? null,
          barcode_gtin14: row?.barcode_gtin14 ?? null,
          priorityLane: row?.priorityLane ?? null,
          coreMissingFields: row?.coreMissingFields ?? [],
        });
      }
      return acc;
    }, {}),
  ).sort((left, right) => {
    if (right.highFrequencyRows !== left.highFrequencyRows) return right.highFrequencyRows - left.highFrequencyRows;
    if (right.total !== left.total) return right.total - left.total;
    return left.brandName.localeCompare(right.brandName);
  });

const toMarkdown = (report) => {
  const lines = [
    "# iHerb Partial Wave Plan",
    "",
    `- generatedAt: ${report.generatedAt}`,
    `- activeQueuePath: ${report.inputs.activeQueuePath}`,
    `- highFrequencyDetailsPath: ${report.inputs.highFrequencyDetailsPath}`,
    `- configDir: ${report.inputs.configDir}`,
    "",
    "## Official Catalog + Image OCR Wave",
    "",
    `- rows: ${report.summary.officialCatalogImageOcrRows}`,
    `- brands: ${report.summary.officialCatalogImageOcrBrands}`,
    "",
  ];

  for (const brand of report.officialCatalogImageOcr.brandRollup.slice(0, 20)) {
    lines.push(
      `- ${brand.brandName}: total=${brand.total}, high_frequency=${brand.highFrequencyRows}, usage_only=${brand.usageOnlyRows}, facts=${brand.factsRows}`,
    );
  }

  lines.push("", "## RapidAPI Partial Wave", "", `- rows: ${report.summary.rapidapiPartialRows}`, `- brands: ${report.summary.rapidapiPartialBrands}`, "");
  for (const brand of report.rapidapiPartial.brandRollup.slice(0, 20)) {
    lines.push(
      `- ${brand.brandName}: total=${brand.total}, high_frequency=${brand.highFrequencyRows}, p1=${brand.p1Rows}, facts=${brand.factsRows}`,
    );
  }

  if (report.configNeeded.brandRollup.length > 0) {
    lines.push("", "## Config Needed", "");
    for (const brand of report.configNeeded.brandRollup.slice(0, 20)) {
      lines.push(`- ${brand.brandName}: total=${brand.total}, high_frequency=${brand.highFrequencyRows}`);
    }
  }

  return `${lines.join("\n")}\n`;
};

const main = async () => {
  await fs.mkdir(OUT_DIR, { recursive: true });
  await fs.mkdir(path.join(OUT_DIR, "official_brand_queues"), { recursive: true });
  await fs.mkdir(path.join(OUT_DIR, "rapidapi_brand_queues"), { recursive: true });

  const [activeQueueRows, highFrequencyDetails, configEntries] = await Promise.all([
    readJson(ACTIVE_QUEUE_PATH),
    readJson(HIGH_FREQUENCY_DETAILS_PATH),
    fs.readdir(CONFIG_DIR),
  ]);

  const configBrandSet = new Set(
    configEntries
      .filter((entry) => entry.endsWith(".json"))
      .map((entry) => entry.replace(/\.json$/i, ""))
      .map((entry) => normalizeLower(entry.replace(/-/g, " "))),
  );

  const activeQueue = Array.isArray(activeQueueRows) ? activeQueueRows : [];
  const highFrequency = Array.isArray(highFrequencyDetails) ? highFrequencyDetails : [];
  const highFrequencySet = buildHighFrequencySet(highFrequency);

  const officialCatalogImageOcrRows = activeQueue.filter(
    (row) =>
      normalizeText(row?.priorityLane) === "P0_api_fill_us_strong_identity" &&
      hasAnyMissing(row, ["suggested_use", "warnings", "ingredient", "dosage"]) &&
      configBrandSet.has(normalizeLower(row?.brandName).replace(/[^a-z0-9]+/g, " ")),
  );

  const rapidapiPartialRows = activeQueue.filter(
    (row) =>
      normalizeText(row?.priorityLane) === "P1_api_fill_non_us_strong_identity" ||
      (normalizeText(row?.priorityLane) === "P0_api_fill_us_strong_identity" &&
        !configBrandSet.has(normalizeLower(row?.brandName).replace(/[^a-z0-9]+/g, " ")) &&
        hasAnyMissing(row, ["ingredient", "dosage"])),
  );

  const configNeededRows = activeQueue.filter(
    (row) =>
      normalizeText(row?.priorityLane) === "P0_api_fill_us_strong_identity" &&
      !configBrandSet.has(normalizeLower(row?.brandName).replace(/[^a-z0-9]+/g, " ")) &&
      hasAnyMissing(row, ["suggested_use", "warnings", "ingredient", "dosage"]),
  );

  const officialBrandRollup = summarizeBrandRows(officialCatalogImageOcrRows, highFrequencySet);
  const rapidapiBrandRollup = summarizeBrandRows(rapidapiPartialRows, highFrequencySet);
  const configNeededBrandRollup = summarizeBrandRows(configNeededRows, highFrequencySet);

  for (const brand of officialBrandRollup) {
    const rows = officialCatalogImageOcrRows.filter((row) => normalizeLower(row?.brandName) === normalizeLower(brand.brandName));
    await writeJson(path.join(OUT_DIR, "official_brand_queues", `${slugify(brand.brandName)}.json`), rows);
  }

  for (const brand of rapidapiBrandRollup) {
    const rows = rapidapiPartialRows.filter((row) => normalizeLower(row?.brandName) === normalizeLower(brand.brandName));
    await writeJson(path.join(OUT_DIR, "rapidapi_brand_queues", `${slugify(brand.brandName)}.json`), rows);
  }

  const report = {
    schemaVersion: "iherb_partial_wave_plan.v1",
    generatedAt: new Date().toISOString(),
    inputs: {
      activeQueuePath: ACTIVE_QUEUE_PATH,
      highFrequencyDetailsPath: HIGH_FREQUENCY_DETAILS_PATH,
      configDir: CONFIG_DIR,
    },
    summary: {
      officialCatalogImageOcrRows: officialCatalogImageOcrRows.length,
      officialCatalogImageOcrBrands: officialBrandRollup.length,
      rapidapiPartialRows: rapidapiPartialRows.length,
      rapidapiPartialBrands: rapidapiBrandRollup.length,
      configNeededRows: configNeededRows.length,
      configNeededBrands: configNeededBrandRollup.length,
    },
    officialCatalogImageOcr: {
      rows: officialCatalogImageOcrRows,
      brandRollup: officialBrandRollup,
    },
    rapidapiPartial: {
      rows: rapidapiPartialRows,
      brandRollup: rapidapiBrandRollup,
    },
    configNeeded: {
      rows: configNeededRows,
      brandRollup: configNeededBrandRollup,
    },
  };

  await writeJson(path.join(OUT_DIR, "partial_wave_plan_summary.json"), report);
  await fs.writeFile(path.join(OUT_DIR, "partial_wave_plan_summary.md"), toMarkdown(report), "utf8");
  await writeJson(path.join(OUT_DIR, "official_catalog_image_ocr_queue.json"), officialCatalogImageOcrRows);
  await writeJson(path.join(OUT_DIR, "rapidapi_partial_queue.json"), rapidapiPartialRows);

  console.log(
    JSON.stringify(
      {
        ok: true,
        outputs: {
          summaryJson: path.join(OUT_DIR, "partial_wave_plan_summary.json"),
          summaryMd: path.join(OUT_DIR, "partial_wave_plan_summary.md"),
          officialQueueJson: path.join(OUT_DIR, "official_catalog_image_ocr_queue.json"),
          rapidapiQueueJson: path.join(OUT_DIR, "rapidapi_partial_queue.json"),
        },
        counts: report.summary,
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
