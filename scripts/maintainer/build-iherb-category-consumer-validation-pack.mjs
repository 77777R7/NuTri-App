#!/usr/bin/env node
/* eslint-disable no-console */
import fs from "node:fs/promises";
import path from "node:path";

import {
  buildImportedRows,
  buildRowAnalysis,
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
  path.join(ROOT, "output", `iherb_category_consumer_validation_pack_${TODAY}`),
);

const TARGET_CATEGORY_IDS = [
  "metabolic_glucose_support",
  "cholesterol_lipid_support",
  "liver_bile_support",
];

const scoreFit = (payload) => ({
  overallScore: Number(payload?.nutriScoreCardV2?.overallScore ?? 0),
  overallBand: safeText(payload?.nutriScoreCardV2?.overallBand),
  topBlockers: Array.isArray(payload?.topBlockers)
    ? payload.topBlockers.slice(0, 3).map((item) => ({
      code: safeText(item?.code),
      title: safeText(item?.title),
      severity: safeText(item?.severity),
    }))
    : [],
});

const blockStatus = (payload) => ({
  overview: {
    bestForCount: Array.isArray(payload?.overviewBlock?.bestForBullets) ? payload.overviewBlock.bestForBullets.length : 0,
    keyIngredientCount: Array.isArray(payload?.overviewBlock?.providesVerified?.keyIngredients)
      ? payload.overviewBlock.providesVerified.keyIngredients.length
      : 0,
  },
  science: {
    ingredientRowCount: Array.isArray(payload?.scienceBlock?.ingredientRows) ? payload.scienceBlock.ingredientRows.length : 0,
    aiSummaryCount: Array.isArray(payload?.scienceBlock?.aiSummaryContract3) ? payload.scienceBlock.aiSummaryContract3.length : 0,
  },
  usage: {
    hasDirectionsTextVisible: payload?.usageBlock?.directions?.hasDirectionsTextVisible === true,
    sourceTier: safeText(payload?.usageBlock?.directions?.sourceTier) || "unknown",
    lineCount: Array.isArray(payload?.usageBlock?.directions?.lines) ? payload.usageBlock.directions.lines.length : 0,
  },
  safety: {
    labelWarningCount: Array.isArray(payload?.safetyBlock?.labelWarnings) ? payload.safetyBlock.labelWarnings.length : 0,
    watchoutCount: Array.isArray(payload?.safetyBlock?.generalWatchouts) ? payload.safetyBlock.generalWatchouts.length : 0,
    ulGuidanceCount: Array.isArray(payload?.safetyBlock?.ulGuidance) ? payload.safetyBlock.ulGuidance.length : 0,
  },
});

const categoryWhyItWorks = {
  metabolic_glucose_support: "Checks whether a newly-added specialty metabolic category actually produces coherent overview/science/usage/safety output rather than just reducing unknown counts.",
  cholesterol_lipid_support: "Checks whether red-yeast-rice and lipid-support products form a coherent consumer-facing lane instead of staying mixed between botanical and unknown.",
  liver_bile_support: "Checks whether TUDCA and bile-support products form a coherent liver/bile lane instead of staying buried in unknown or generic digestive categories.",
};

const toMarkdown = (report) => {
  const lines = [];
  lines.push("# iHerb Category Consumer Validation Pack");
  lines.push("");
  lines.push(`- generatedAt: ${report.generatedAt}`);
  lines.push(`- importedRowCount: ${report.summary.importedRowCount}`);
  lines.push(`- validatedCategories: ${report.summary.validatedCategories.join(", ")}`);
  lines.push("");
  for (const category of report.categories) {
    lines.push(`## ${category.categoryId}`);
    lines.push(`- count: ${category.count}`);
    lines.push(`- why: ${category.whyNow}`);
    lines.push(`- avgScore: ${category.avgScore}`);
    lines.push(`- directionsVisibleRate: ${category.directionsVisibleRate}%`);
    lines.push(`- labelWarningsRate: ${category.labelWarningsRate}%`);
    lines.push(`- aiSummaryReadyRate: ${category.aiSummaryReadyRate}%`);
    lines.push("");
    for (const sample of category.samples) {
      lines.push(`- ${sample.brandName} / ${sample.title}`);
      lines.push(`  - score: ${sample.score.overallScore} / ${sample.score.overallBand}`);
      lines.push(`  - blockers: ${sample.score.topBlockers.map((item) => item.code).join(", ") || "none"}`);
      lines.push(`  - usageTier: ${sample.blocks.usage.sourceTier}`);
    }
    lines.push("");
  }
  return `${lines.join("\n")}\n`;
};

const average = (rows, field) => {
  if (rows.length === 0) return 0;
  return Number((rows.reduce((sum, row) => sum + Number(row[field] ?? 0), 0) / rows.length).toFixed(1));
};

const percent = (part, total) => (total > 0 ? Number(((part / total) * 100).toFixed(1)) : 0);

const main = async () => {
  const importedRows = await buildImportedRows({
    stagingPath: STAGING_PATH,
    mergeReportPath: MERGE_REPORT_PATH,
  });

  const byCategory = new Map(TARGET_CATEGORY_IDS.map((id) => [id, []]));

  for (const row of importedRows) {
    const analysis = buildRowAnalysis(row);
    const categoryId = safeText(analysis.categoryId);
    if (!byCategory.has(categoryId)) continue;
    byCategory.get(categoryId).push({
      productId: safeText(row.productId),
      barcode_gtin14: safeText(row.barcode_gtin14),
      brandName: safeText(row.brandName),
      title: safeText(row.title),
      score: scoreFit(analysis.payload),
      blocks: blockStatus(analysis.payload),
    });
  }

  const categories = TARGET_CATEGORY_IDS.map((categoryId) => {
    const rows = byCategory.get(categoryId) ?? [];
    const sorted = [...rows].sort((a, b) => b.score.overallScore - a.score.overallScore || a.title.localeCompare(b.title));
    return {
      categoryId,
      whyNow: categoryWhyItWorks[categoryId] ?? "",
      count: rows.length,
      avgScore: average(rows.map((row) => ({ value: row.score.overallScore })), "value"),
      directionsVisibleRate: percent(rows.filter((row) => row.blocks.usage.hasDirectionsTextVisible).length, rows.length),
      labelWarningsRate: percent(rows.filter((row) => row.blocks.safety.labelWarningCount > 0).length, rows.length),
      aiSummaryReadyRate: percent(rows.filter((row) => row.blocks.science.aiSummaryCount === 3).length, rows.length),
      samples: sorted.slice(0, 5),
    };
  });

  const report = {
    schemaVersion: "iherb_category_consumer_validation_pack.v1",
    generatedAt: new Date().toISOString(),
    inputs: {
      stagingPath: toRelative(STAGING_PATH),
      mergeReportPath: toRelative(MERGE_REPORT_PATH),
    },
    summary: {
      importedRowCount: importedRows.length,
      validatedCategories: TARGET_CATEGORY_IDS,
    },
    categories,
  };

  await fs.mkdir(OUT_DIR, { recursive: true });
  await Promise.all([
    writeJson(path.join(OUT_DIR, "category_consumer_validation_pack.json"), report),
    fs.writeFile(path.join(OUT_DIR, "category_consumer_validation_pack.md"), toMarkdown(report), "utf8"),
  ]);

  console.log(JSON.stringify({
    ok: true,
    outDir: toRelative(OUT_DIR),
    categoryCounts: categories.map((item) => ({ categoryId: item.categoryId, count: item.count })),
  }, null, 2));
};

main().catch((error) => {
  console.error(error instanceof Error ? error.stack : String(error));
  process.exit(1);
});
