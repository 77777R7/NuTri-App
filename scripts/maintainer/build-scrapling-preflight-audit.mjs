#!/usr/bin/env node
/* eslint-disable no-console */
import fs from "node:fs/promises";
import path from "node:path";
import { decideOfficialFetchPolicy } from "./lib/official-fetch-policy.mjs";
import { normalizeText } from "./lib/iherb-overlay-utils.mjs";

const ROOT = process.cwd();
const args = process.argv.slice(2);

const getArg = (name, fallback = null) => {
  const flag = `--${name}`;
  const idx = args.indexOf(flag);
  if (idx === -1 || idx + 1 >= args.length) return fallback;
  return args[idx + 1];
};

const STAGING_PATH = getArg("staging-json", path.join(ROOT, "output", "iherb_overlay_staging", "staging_products.json"));
const QUEUE_PATH = getArg("queue-json", path.join(ROOT, "output", "iherb_overlay_execution_plan_full", "active_priority_queue.json"));
const OUT_DIR = getArg("out-dir", path.join(ROOT, "output", `scrapling_preflight_audit_${new Date().toISOString().slice(0,10).replace(/-/g, "")}`));
const LIMIT = Number(getArg("limit", 20)) || 20;

const readJson = async (filePath) => JSON.parse(await fs.readFile(filePath, "utf8"));

const toArray = (value) => (Array.isArray(value) ? value : []);

const buildStagingIndex = (rows) => {
  const byProductId = new Map();
  const byBarcode = new Map();
  for (const row of rows) {
    const productId = normalizeText(row?.productId ?? null);
    const barcode = normalizeText(row?.barcode_gtin14 ?? row?.barcode ?? null);
    if (productId) byProductId.set(productId, row);
    if (barcode) byBarcode.set(barcode, row);
  }
  return { byProductId, byBarcode };
};

const getKnownUrls = (row) => {
  const urls = [];
  const summaryUrls = toArray(row?.sourceSummary?.sourceUrls);
  urls.push(...summaryUrls);
  if (row?.link) urls.push(row.link);
  return [...new Set(urls.filter((value) => /^https?:\/\//i.test(String(value ?? ""))))];
};

const main = async () => {
  const stagingRaw = await readJson(path.resolve(ROOT, STAGING_PATH));
  const queue = await readJson(path.resolve(ROOT, QUEUE_PATH));
  const stagingRows = Array.isArray(stagingRaw) ? stagingRaw : (stagingRaw.products ?? []);
  const index = buildStagingIndex(stagingRows);

  const missingFieldCounts = {};
  const sourceComboCounts = {};
  const recommendedModes = {};
  const sampleRows = [];

  for (const entry of queue) {
    const productId = normalizeText(entry?.productId ?? null);
    const barcode = normalizeText(entry?.barcode_gtin14 ?? null);
    const staged =
      (productId && index.byProductId.get(productId)) ||
      (barcode && index.byBarcode.get(barcode)) ||
      null;
    const knownProductUrls = getKnownUrls(staged);
    const coreMissingFields = toArray(entry?.coreMissingFields);
    coreMissingFields.forEach((field) => {
      const key = normalizeText(field);
      missingFieldCounts[key] = (missingFieldCounts[key] || 0) + 1;
    });

    const sourceCombo = toArray(entry?.sourceTypes).sort().join(" + ") || "(none)";
    sourceComboCounts[sourceCombo] = (sourceComboCounts[sourceCombo] || 0) + 1;

    const policy = decideOfficialFetchPolicy({
      knownProductUrls,
      coreMissingFields,
      sourceTypes: entry?.sourceTypes,
      hasUsIherbPage: entry?.hasUsIherbPage,
      highConfidenceUsProductPageReady: entry?.highConfidenceUsProductPageReady,
    });
    recommendedModes[policy.mode] = (recommendedModes[policy.mode] || 0) + 1;

    if (sampleRows.length < LIMIT) {
      sampleRows.push({
        productId: entry?.productId ?? null,
        barcode_gtin14: entry?.barcode_gtin14 ?? null,
        brandName: entry?.brandName ?? null,
        title: entry?.title ?? null,
        coreMissingFields,
        knownProductUrls,
        sourceTypes: entry?.sourceTypes ?? [],
        recommendedMode: policy.mode,
        policyReasons: policy.reasons,
      });
    }
  }

  const report = {
    generatedAt: new Date().toISOString(),
    inputs: {
      stagingPath: STAGING_PATH,
      queuePath: QUEUE_PATH,
    },
    totals: {
      stagingRows: stagingRows.length,
      queueRows: queue.length,
    },
    gapTable: Object.entries(missingFieldCounts)
      .sort((a, b) => b[1] - a[1])
      .map(([field, count]) => ({ field, count })),
    sourceTable: Object.entries(sourceComboCounts)
      .sort((a, b) => b[1] - a[1])
      .map(([sourceTypes, count]) => ({ sourceTypes, count })),
    policyTable: Object.entries(recommendedModes)
      .sort((a, b) => b[1] - a[1])
      .map(([mode, count]) => ({ mode, count })),
    sampleRows,
  };

  await fs.mkdir(path.resolve(ROOT, OUT_DIR), { recursive: true });
  await fs.writeFile(
    path.resolve(ROOT, OUT_DIR, "scrapling_preflight_audit.json"),
    `${JSON.stringify(report, null, 2)}\n`,
  );

  const md = [
    "# Scrapling Preflight Audit",
    "",
    `- generatedAt: ${report.generatedAt}`,
    `- stagingRows: ${report.totals.stagingRows}`,
    `- queueRows: ${report.totals.queueRows}`,
    "",
    "## Gap Table",
    "",
    ...report.gapTable.map((row) => `- ${row.field}: ${row.count}`),
    "",
    "## Source Table",
    "",
    ...report.sourceTable.slice(0, 10).map((row) => `- ${row.sourceTypes}: ${row.count}`),
    "",
    "## Recommended Fetch Modes",
    "",
    ...report.policyTable.map((row) => `- ${row.mode}: ${row.count}`),
    "",
    "## Sample Rows",
    "",
    ...report.sampleRows.map(
      (row) =>
        `- ${row.brandName ?? "Unknown"} | ${row.title ?? "Unknown"} | missing=${row.coreMissingFields.join(", ") || "none"} | mode=${row.recommendedMode} | urls=${row.knownProductUrls.join(", ") || "none"}`,
    ),
    "",
  ].join("\n");

  await fs.writeFile(path.resolve(ROOT, OUT_DIR, "scrapling_preflight_audit.md"), `${md}\n`);
  console.log(`Wrote preflight audit to ${path.resolve(ROOT, OUT_DIR)}`);
};

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
