#!/usr/bin/env node
/* eslint-disable no-console */

import path from "node:path";
import {
  ROOT_DIR,
  applyCanaryOverlay,
  getRows,
  readJson,
  renderMarkdownReport,
  rowKey,
  summarizeValidationRows,
  writeJson,
  writeText,
} from "./lib/science-validation-reporting.mjs";

const DEFAULT_INPUTS = {
  old2000: "tmp/science-cluster-regression-1776291807171.json",
  sixBucketCanary: "tmp/failed-bucket-online-canary-1776296106428.json",
  productTypeCanary: "tmp/residual-product-type-canary-1776303164942.json",
  trueMissingCanary: "tmp/true-missing-live-canary-1776304650069.json",
  outJson: "output/science-validation/current-baseline-v2.json",
  outMd: "output/science-validation/current-baseline-v2.md",
};

const parseArgs = () => {
  const args = process.argv.slice(2);
  const values = { ...DEFAULT_INPUTS };
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    const next = args[index + 1];
    if (arg === "--old-2000" && next) {
      values.old2000 = next;
      index += 1;
    } else if (arg === "--six-bucket-canary" && next) {
      values.sixBucketCanary = next;
      index += 1;
    } else if (arg === "--product-type-canary" && next) {
      values.productTypeCanary = next;
      index += 1;
    } else if (arg === "--true-missing-canary" && next) {
      values.trueMissingCanary = next;
      index += 1;
    } else if (arg === "--out-json" && next) {
      values.outJson = next;
      index += 1;
    } else if (arg === "--out-md" && next) {
      values.outMd = next;
      index += 1;
    }
  }
  return values;
};

const sourceSpec = (label, inputPath, report) => ({
  label,
  path: inputPath,
  rows: getRows(report).length,
});

const overlayRows = ({ rowsByKey, rows, sourceName, mergeStats, supplementalRows }) => {
  let overlaid = 0;
  let supplemental = 0;
  for (const row of rows) {
    const key = rowKey(row);
    const existing = rowsByKey.get(key);
    if (existing) {
      const merged = applyCanaryOverlay(existing, row, sourceName);
      rowsByKey.set(key, merged);
      overlaid += 1;
    } else {
      supplementalRows.push({
        ...row,
        _supplementalSource: sourceName,
      });
      supplemental += 1;
    }
  }
  mergeStats[`${sourceName}Overlaid`] = overlaid;
  mergeStats[`${sourceName}SupplementalOnly`] = supplemental;
};

const main = async () => {
  const inputs = parseArgs();
  const generatedAt = new Date().toISOString();
  const old2000 = await readJson(inputs.old2000);
  const sixBucket = await readJson(inputs.sixBucketCanary);
  const productType = await readJson(inputs.productTypeCanary);
  const trueMissing = await readJson(inputs.trueMissingCanary);

  const oldRows = getRows(old2000);
  const rowsByKey = new Map();
  for (const row of oldRows) {
    rowsByKey.set(rowKey(row), {
      ...row,
      _mergeSources: ["old_2000"],
    });
  }

  const mergeStats = {
    old2000Rows: oldRows.length,
  };
  const supplementalRows = [];

  overlayRows({
    rowsByKey,
    rows: getRows(sixBucket),
    sourceName: "sixBucketCanary",
    mergeStats,
    supplementalRows,
  });
  overlayRows({
    rowsByKey,
    rows: getRows(productType),
    sourceName: "productTypeCanary",
    mergeStats,
    supplementalRows,
  });
  overlayRows({
    rowsByKey,
    rows: getRows(trueMissing),
    sourceName: "trueMissingCanary",
    mergeStats,
    supplementalRows,
  });

  const mergedRows = Array.from(rowsByKey.values()).sort((a, b) =>
    String(a.cluster ?? "").localeCompare(String(b.cluster ?? ""))
    || String(a.barcode ?? "").localeCompare(String(b.barcode ?? "")));
  mergeStats.finalRows = mergedRows.length;

  const summary = summarizeValidationRows(mergedRows);
  const sourceReports = [
    sourceSpec("Original 2000", inputs.old2000, old2000),
    sourceSpec("6-bucket canary", inputs.sixBucketCanary, sixBucket),
    sourceSpec("Product-type canary", inputs.productTypeCanary, productType),
    sourceSpec("True missing canary", inputs.trueMissingCanary, trueMissing),
  ];

  const output = {
    generatedAt,
    reportType: "science_current_baseline_v2_estimate",
    importantNote:
      "This is an estimated merged baseline, not final validation. Newer canaries override the old 2000 report by barcode+cluster.",
    sourceReports,
    mergeStats,
    summary,
    supplementalRows,
    rows: mergedRows,
  };

  await writeJson(inputs.outJson, output);
  await writeText(inputs.outMd, renderMarkdownReport({
    title: "Science Current Baseline v2",
    generatedAt,
    summary,
    sourceReports,
    mergeStats,
    phaseNotes: [
      "Baseline v2 uses old 2000 as the mother report and overlays newer canaries by barcode+cluster.",
      "Canary rows that are not present in the old 2000 are retained as supplemental evidence but are not counted in the baseline denominator.",
      "Use this only to choose the next targeted validation shape. It is not launch acceptance.",
    ],
  }));

  console.log(path.resolve(ROOT_DIR, inputs.outJson));
  console.log(path.resolve(ROOT_DIR, inputs.outMd));
};

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
