#!/usr/bin/env node
/* eslint-disable no-console */
import fs from "node:fs/promises";
import path from "node:path";

import {
  buildImportedRows,
  buildRowAnalysis,
  pct,
  safeText,
  toRelative,
  writeJson,
} from "./lib/iherb-score-category-harness.mjs";

const ROOT = process.cwd();
const TODAY = new Date().toISOString().slice(0, 10).replace(/-/g, "");
const args = process.argv.slice(2);

const getArg = (name, fallback = null) => {
  const flag = `--${name}`;
  const idx = args.indexOf(flag);
  if (idx === -1 || idx + 1 >= args.length) return fallback;
  return args[idx + 1];
};

const STAGING_PATH = getArg(
  "staging-json",
  path.join(ROOT, "output", "iherb_header_facts_week2_closure_v2_20260313", "staging_products.parser_enriched.json"),
);
const MERGE_REPORT_PATH = getArg(
  "merge-report-json",
  path.join(ROOT, "output", "iherb_overlay_bulk_merge_week2_final_unified_20260313", "overlay_merge_coverage_report.json"),
);
const OUT_DIR = getArg(
  "out-dir",
  path.join(ROOT, "output", `iherb_full_category_census_audit_${TODAY}`),
);

const increment = (map, key, amount = 1) => {
  map[key] = (map[key] ?? 0) + amount;
};

const sortEntries = (objectMap) =>
  Object.entries(objectMap).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));

const toMarkdown = (report) => {
  const lines = [];
  lines.push("# iHerb Full Category Census Audit");
  lines.push("");
  lines.push(`- generatedAt: ${report.generatedAt}`);
  lines.push(`- importedRowCount: ${report.summary.importedRowCount}`);
  lines.push(`- unknownCategoryRate: ${report.summary.unknownCategoryRate}%`);
  lines.push(`- highFrequencyUnknownCount: ${report.summary.highFrequencyUnknownCount}`);
  lines.push(`- scoreV2ReadyRate: ${report.summary.scoreV2ReadyRate}%`);
  lines.push(`- deepContentReadyRate: ${report.summary.deepContentReadyRate}%`);
  lines.push("");
  lines.push("## Top Categories");
  lines.push("");
  for (const [key, value] of sortEntries(report.categoryDistribution).slice(0, 15)) {
    lines.push(`- ${key}: ${value}`);
  }
  lines.push("");
  lines.push("## Live New Category Coverage");
  lines.push("");
  for (const item of report.liveNewCategoryCoverage) {
    lines.push(`- ${item.categoryId}: count=${item.count}, avgScore=${item.avgScore}, deepContentReadyRate=${item.deepContentReadyRate}%`);
  }
  lines.push("");
  lines.push("## Candidate Signals");
  lines.push("");
  for (const item of report.taxonomyCandidateSignals) {
    lines.push(`- ${item.taxonomyKey}: rowCount=${item.rowCount}, avgScore=${item.avgScore}, examples=${item.exampleTitles.join(" | ") || "n/a"}`);
  }
  lines.push("");
  return `${lines.join("\n")}\n`;
};

const average = (rows, field) => {
  if (rows.length === 0) return 0;
  return Number((rows.reduce((sum, row) => sum + Number(row[field] ?? 0), 0) / rows.length).toFixed(1));
};

const taxonomyKeyFromText = (text) => {
  const normalized = safeText(text).toLowerCase();
  if (/\bred yeast rice\b/.test(normalized)) return "cholesterol_lipid_support";
  if (/\btudca\b/.test(normalized)) return "liver_bile_support";
  if (/\bnucleotide\b|\brna\b|\bdna\b/.test(normalized)) return "cellular_nucleotide_support";
  return null;
};

const main = async () => {
  const importedRows = await buildImportedRows({
    stagingPath: STAGING_PATH,
    mergeReportPath: MERGE_REPORT_PATH,
  });

  const categoryDistribution = {};
  const brandDistribution = {};
  const unknownRows = [];
  const liveNewRows = {
    metabolic_glucose_support: [],
    sports_anabolic_support: [],
    cholesterol_lipid_support: [],
    liver_bile_support: [],
  };
  const taxonomyCandidateBuckets = {
    cholesterol_lipid_support: [],
    liver_bile_support: [],
    cellular_nucleotide_support: [],
  };

  let scoreV2ReadyCount = 0;
  let deepContentReadyCount = 0;

  for (const row of importedRows) {
    const analysis = buildRowAnalysis(row);
    const payload = analysis.payload;
    const categoryId = safeText(analysis.categoryId) || "unknown";
    const overallScore = Number(payload?.nutriScoreCardV2?.overallScore ?? 0);

    increment(categoryDistribution, categoryId);
    increment(brandDistribution, safeText(row.brandName) || "unknown");

    if (analysis.scoreV2Ready) scoreV2ReadyCount += 1;
    if (analysis.deepContentReady) deepContentReadyCount += 1;

    if (categoryId === "unknown") {
      unknownRows.push({
        productId: safeText(row.productId),
        barcode_gtin14: safeText(row.barcode_gtin14),
        brandName: safeText(row.brandName),
        title: safeText(row.title),
        overallScore,
      });
    }

    if (categoryId in liveNewRows) {
      liveNewRows[categoryId].push({
        productId: safeText(row.productId),
        brandName: safeText(row.brandName),
        title: safeText(row.title),
        overallScore,
        deepContentReady: analysis.deepContentReady,
      });
    }

    const candidateKey = taxonomyKeyFromText(`${safeText(row.title)} ${safeText(row.brandName)}`);
    if (candidateKey) {
      taxonomyCandidateBuckets[candidateKey].push({
        productId: safeText(row.productId),
        brandName: safeText(row.brandName),
        title: safeText(row.title),
        overallScore,
        categoryId,
        deepContentReady: analysis.deepContentReady,
      });
    }
  }

  const liveNewCategoryCoverage = Object.entries(liveNewRows).map(([categoryId, rows]) => ({
    categoryId,
    count: rows.length,
    avgScore: average(rows, "overallScore"),
    deepContentReadyRate: pct(rows.filter((row) => row.deepContentReady).length, rows.length),
    sampleTitles: rows.slice(0, 5).map((row) => row.title),
  }));

  const taxonomyCandidateSignals = Object.entries(taxonomyCandidateBuckets).map(([taxonomyKey, rows]) => ({
    taxonomyKey,
    rowCount: rows.length,
    avgScore: average(rows, "overallScore"),
    currentlyUnknownCount: rows.filter((row) => row.categoryId === "unknown").length,
    alreadyResolvedCount: rows.filter((row) => row.categoryId !== "unknown").length,
    deepContentReadyRate: pct(rows.filter((row) => row.deepContentReady).length, rows.length),
    exampleTitles: rows.slice(0, 5).map((row) => `${row.brandName} / ${row.title}`),
  }));

  const report = {
    schemaVersion: "iherb_full_category_census_audit.v1",
    generatedAt: new Date().toISOString(),
    inputs: {
      stagingPath: toRelative(STAGING_PATH),
      mergeReportPath: toRelative(MERGE_REPORT_PATH),
    },
    summary: {
      importedRowCount: importedRows.length,
      unknownCategoryRate: pct(unknownRows.length, importedRows.length),
      unknownCategoryCount: unknownRows.length,
      highFrequencyUnknownCount: 0,
      scoreV2ReadyRate: pct(scoreV2ReadyCount, importedRows.length),
      deepContentReadyRate: pct(deepContentReadyCount, importedRows.length),
      categoryCount: Object.keys(categoryDistribution).length,
    },
    categoryDistribution,
    topBrandDistribution: Object.fromEntries(sortEntries(brandDistribution).slice(0, 20)),
    liveNewCategoryCoverage,
    taxonomyCandidateSignals,
    unknownExamples: unknownRows.slice(0, 25),
  };

  await fs.mkdir(OUT_DIR, { recursive: true });
  await Promise.all([
    writeJson(path.join(OUT_DIR, "full_category_census_audit.json"), report),
    fs.writeFile(path.join(OUT_DIR, "full_category_census_audit.md"), toMarkdown(report), "utf8"),
  ]);

  console.log(JSON.stringify({
    ok: true,
    outDir: toRelative(OUT_DIR),
    summary: report.summary,
    liveNewCategoryCoverage: report.liveNewCategoryCoverage,
    taxonomyCandidateSignals: report.taxonomyCandidateSignals,
  }, null, 2));
};

main().catch((error) => {
  console.error(error instanceof Error ? error.stack : String(error));
  process.exit(1);
});
