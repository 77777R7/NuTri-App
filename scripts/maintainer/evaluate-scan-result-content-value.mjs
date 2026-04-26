#!/usr/bin/env node
/* eslint-disable no-console */

import path from "node:path";
import {
  buildFamilyCoverageRows,
  ensureDir,
  evaluateContentValue,
  parseArgs,
  productKey,
  readJson,
  readJsonl,
  selectProducts,
  writeCsv,
  writeJson,
  writeText,
} from "./lib/scan-result-full-corpus-audit.mjs";

const average = (rows, field) => {
  const values = rows.map((row) => Number(row[field])).filter(Number.isFinite);
  return values.length ? Number((values.reduce((sum, value) => sum + value, 0) / values.length).toFixed(1)) : null;
};

const renderContentValueSummary = (rows) => {
  const buckets = {
    excellent_80_100: rows.filter((row) => row.overall_scan_result_value_score >= 80).length,
    useful_60_79: rows.filter((row) => row.overall_scan_result_value_score >= 60 && row.overall_scan_result_value_score < 80).length,
    weak_40_59: rows.filter((row) => row.overall_scan_result_value_score >= 40 && row.overall_scan_result_value_score < 60).length,
    broken_0_39: rows.filter((row) => row.overall_scan_result_value_score < 40).length,
  };
  return [
    "# Content Value Summary",
    "",
    `- total products: ${rows.length}`,
    `- average overall score: ${average(rows, "overall_scan_result_value_score")}`,
    `- personalized insights avg: ${average(rows, "personalized_insights_value_score")}`,
    `- nutri score avg: ${average(rows, "nutri_score_value_score")}`,
    `- product overview avg: ${average(rows, "product_overview_value_score")}`,
    `- formula overview avg: ${average(rows, "formula_overview_value_score")}`,
    `- scientific background avg: ${average(rows, "scientific_background_value_score")}`,
    `- usage avg: ${average(rows, "usage_value_score")}`,
    `- safety avg: ${average(rows, "safety_value_score")}`,
    "",
    "## Distribution",
    ...Object.entries(buckets).map(([key, count]) => `- ${key}: ${count}`),
    "",
  ].join("\n");
};

const renderLowValueProducts = (rows) => [
  "# Low Value Products",
  "",
  ...rows
    .filter((row) => row.overall_scan_result_value_score < 60)
    .sort((a, b) => a.overall_scan_result_value_score - b.overall_scan_result_value_score)
    .slice(0, 120)
    .map((row) => `- score=${row.overall_scan_result_value_score} | ${row.family} | ${row.brand ?? ""} ${row.productName ?? ""} | ${row.barcode ?? row.productId}`),
  "",
].join("\n");

const main = async () => {
  const args = parseArgs(process.argv.slice(2), { mode: "content", concurrency: 1 });
  await ensureDir(args.runDir);
  const manifest = await readJson(args.manifestPath);
  const products = selectProducts(manifest.products ?? [], args);
  const coreRows = await readJsonl(path.join(args.runDir, "core-results.jsonl"));
  const sidecarRows = await readJsonl(path.join(args.runDir, "sidecar-results.jsonl"));
  const productSidecars = new Map();
  for (const row of sidecarRows) {
    const current = productSidecars.get(row.productKey) ?? {};
    current[row.route] = row;
    productSidecars.set(row.productKey, current);
  }
  const contentRows = products.map((product) => ({
    productKey: productKey(product),
    productId: product.productId,
    barcode: product.barcode,
    productName: product.productName,
    brand: product.brand,
    family: product.family,
    sourceTier: product.sourceTier,
    factsStatus: product.factsStatus,
    missingCriticalFields: product.missingCriticalFields.join("|"),
    ...evaluateContentValue({ product, sidecars: productSidecars.get(productKey(product)) ?? {} }),
  }));
  await writeCsv(path.join(args.runDir, "content-value-scores.csv"), contentRows);
  await writeJson(path.join(args.runDir, "content-value-scores.json"), { reportType: "content_value_scores", generatedAt: new Date().toISOString(), rows: contentRows });
  await writeText(path.join(args.runDir, "content-value-summary.md"), renderContentValueSummary(contentRows));
  await writeText(path.join(args.runDir, "low-value-products.md"), renderLowValueProducts(contentRows));
  const familyRows = buildFamilyCoverageRows({ products: manifest.products ?? [], coreRows, sidecarRows, contentRows, catalog: manifest.familyCatalog });
  await writeCsv(path.join(args.runDir, "family-coverage-matrix.csv"), familyRows);
  await writeJson(path.join(args.runDir, "family-coverage-matrix.json"), { reportType: "family_coverage_matrix", generatedAt: new Date().toISOString(), rows: familyRows });
  console.log(`[scan-result-content-value] complete runId=${args.runId} rows=${contentRows.length}`);
};

main().catch((error) => {
  console.error("[scan-result-content-value] failed", error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
