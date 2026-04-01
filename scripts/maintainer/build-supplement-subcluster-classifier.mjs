#!/usr/bin/env node
/* eslint-disable no-console */
import fs from "node:fs/promises";
import path from "node:path";

import { normalizeText } from "./lib/iherb-overlay-utils.mjs";
import {
  classifySupplementSubcluster,
  countUsefulNutritionFacts,
  getRowCorpus,
  slugify,
} from "./lib/supplement-subcluster-utils.mjs";

const ROOT = process.cwd();
const args = process.argv.slice(2);

const getArg = (name, fallback = null) => {
  const flag = `--${name}`;
  const idx = args.indexOf(flag);
  if (idx === -1 || idx + 1 >= args.length) return fallback;
  return args[idx + 1];
};

const STAGING_PATH = getArg(
  "staging-json",
  path.join(ROOT, "output", "refill_mega_02", "execute_curated_01", "current_staging_products.scrapling_merged.json"),
);
const MERGE_REPORT_PATH = getArg(
  "merge-report-json",
  path.join(ROOT, "output", "refill_mega_02", "execute_curated_01", "merge_baseline_v2", "overlay_merge_coverage_report.json"),
);
const OUT_DIR = getArg(
  "out-dir",
  path.join(ROOT, "output", "refill_mega_04", "subcluster_classifier"),
);

const readJson = async (filePath) => JSON.parse(await fs.readFile(path.resolve(ROOT, filePath), "utf8"));
const writeJson = async (filePath, payload) => {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
};
const writeText = async (filePath, body) => {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, body, "utf8");
};

const summarizeCounts = (entries, key) => {
  const counts = {};
  for (const entry of entries) {
    const bucket = normalizeText(entry?.[key] ?? "unknown");
    counts[bucket] = (counts[bucket] ?? 0) + 1;
  }
  return Object.fromEntries(Object.entries(counts).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])));
};

const buildMarkdown = (report) => {
  const lines = [
    "# Supplement-only Subcluster Classifier",
    "",
    `- generated_at: ${report.generatedAt}`,
    `- total_queued_rows: ${report.summary.totalQueuedRows}`,
    `- supplement_only_rows: ${report.summary.supplementOnlyRows}`,
    `- high_confidence_soft_only_rows: ${report.summary.highConfidenceSoftOnlyRows}`,
    `- high_confidence_soft_only_supplement_rows: ${report.summary.highConfidenceSoftOnlySupplementRows}`,
    "",
    "## Cluster Kinds",
  ];

  for (const [clusterKind, count] of Object.entries(report.summary.clusterKindCounts)) {
    lines.push(`- ${clusterKind}: ${count}`);
  }

  lines.push("", "## Top Cluster Labels");
  for (const [label, count] of Object.entries(report.summary.clusterLabelCounts).slice(0, 25)) {
    lines.push(`- ${label}: ${count}`);
  }

  lines.push("", "## Top Supplement-only Brands");
  for (const [brandName, count] of Object.entries(report.summary.supplementBrandCounts).slice(0, 25)) {
    lines.push(`- ${brandName}: ${count}`);
  }

  lines.push("");
  return `${lines.join("\n")}\n`;
};

const main = async () => {
  const stagingRows = await readJson(STAGING_PATH);
  const mergeReport = await readJson(MERGE_REPORT_PATH);

  const stagingByProductId = new Map(stagingRows.map((row) => [normalizeText(row?.productId), row]));
  const stagingByBarcode = new Map(
    stagingRows
      .map((row) => [normalizeText(row?.barcode_gtin14 ?? row?.barcode), row])
      .filter(([barcode]) => barcode),
  );

  const classifiedRows = [];

  for (const mergeRow of mergeReport?.rows ?? []) {
    if (normalizeText(mergeRow?.mergeDecision).toLowerCase() !== "queued") continue;
    if (normalizeText(mergeRow?.status).toLowerCase() !== "partial_overlay") continue;

    const stagingRow =
      stagingByProductId.get(normalizeText(mergeRow?.productId)) ||
      stagingByBarcode.get(normalizeText(mergeRow?.barcodeGtin14)) ||
      null;
    if (!stagingRow) continue;

    const cluster = classifySupplementSubcluster({
      brandName: stagingRow?.brandName ?? mergeRow?.brandName,
      title: stagingRow?.title ?? mergeRow?.title,
      categories: stagingRow?.categories ?? [],
      dosageForm: stagingRow?.dosageForm,
    });

    const usefulFactsCount = countUsefulNutritionFacts(stagingRow?.supplementFacts);
    const missing = Array.isArray(mergeRow?.stillMissingFields) ? mergeRow.stillMissingFields : [];
    const resolved = Array.isArray(mergeRow?.overlayResolvedFields) ? mergeRow.overlayResolvedFields : [];
    const highConfidenceSoftOnly =
      Boolean(mergeRow?.highConfidenceUsProductPageReady) &&
      resolved.includes("ingredient") &&
      resolved.includes("dosage") &&
      resolved.includes("product_image") &&
      missing.length > 0 &&
      missing.every((field) => ["suggested_use", "warnings", "product_image"].includes(String(field)));

    classifiedRows.push({
      productId: stagingRow?.productId ?? mergeRow?.productId ?? null,
      barcodeGtin14: stagingRow?.barcode_gtin14 ?? stagingRow?.barcode ?? mergeRow?.barcodeGtin14 ?? null,
      brandName: stagingRow?.brandName ?? mergeRow?.brandName ?? null,
      title: stagingRow?.title ?? mergeRow?.title ?? null,
      categories: stagingRow?.categories ?? [],
      dosageForm: stagingRow?.dosageForm ?? null,
      clusterKind: cluster.clusterKind,
      clusterLabel: cluster.clusterLabel,
      supplementOnly: cluster.supplementOnly,
      confidence: cluster.confidence,
      reason: cluster.reason,
      mergeDecision: mergeRow?.mergeDecision ?? null,
      status: mergeRow?.status ?? null,
      highConfidenceUsProductPageReady: Boolean(mergeRow?.highConfidenceUsProductPageReady),
      hasUsIherbPage: Boolean(stagingRow?.sourceSummary?.hasUsIherbPage),
      stillMissingFields: missing,
      overlayResolvedFields: resolved,
      usefulFactsCount,
      sectionCount: Object.keys(stagingRow?.descriptionSections ?? {}).length,
      corpus: getRowCorpus({
        brandName: stagingRow?.brandName ?? mergeRow?.brandName,
        title: stagingRow?.title ?? mergeRow?.title,
        categories: stagingRow?.categories ?? [],
        dosageForm: stagingRow?.dosageForm,
      }),
      highConfidenceSoftOnly,
    });
  }

  const supplementOnlyRows = classifiedRows.filter((row) => row.supplementOnly);
  const highConfidenceSoftOnlyRows = classifiedRows.filter((row) => row.highConfidenceSoftOnly);
  const highConfidenceSoftOnlySupplementRows = highConfidenceSoftOnlyRows.filter((row) => row.supplementOnly);

  const report = {
    generatedAt: new Date().toISOString(),
    inputs: {
      stagingPath: path.resolve(ROOT, STAGING_PATH),
      mergeReportPath: path.resolve(ROOT, MERGE_REPORT_PATH),
    },
    summary: {
      totalQueuedRows: classifiedRows.length,
      supplementOnlyRows: supplementOnlyRows.length,
      highConfidenceSoftOnlyRows: highConfidenceSoftOnlyRows.length,
      highConfidenceSoftOnlySupplementRows: highConfidenceSoftOnlySupplementRows.length,
      clusterKindCounts: summarizeCounts(classifiedRows, "clusterKind"),
      clusterLabelCounts: summarizeCounts(classifiedRows, "clusterLabel"),
      supplementBrandCounts: summarizeCounts(supplementOnlyRows, "brandName"),
    },
    outputs: {
      rowsPath: path.resolve(ROOT, OUT_DIR, "supplement_subcluster_classifier.rows.json"),
      reportPath: path.resolve(ROOT, OUT_DIR, "supplement_subcluster_classifier.json"),
      markdownPath: path.resolve(ROOT, OUT_DIR, "supplement_subcluster_classifier.md"),
    },
  };

  await writeJson(report.outputs.rowsPath, classifiedRows);
  await writeJson(report.outputs.reportPath, report);
  await writeText(report.outputs.markdownPath, buildMarkdown(report));

  const topClusterFiles = [];
  for (const [clusterKind] of Object.entries(report.summary.clusterKindCounts).slice(0, 10)) {
    const clusterRows = classifiedRows.filter((row) => row.clusterKind === clusterKind);
    const filePath = path.resolve(ROOT, OUT_DIR, `${slugify(clusterKind)}.rows.json`);
    await writeJson(filePath, clusterRows);
    topClusterFiles.push(filePath);
  }

  console.log(
    JSON.stringify(
      {
        ok: true,
        outDir: path.resolve(ROOT, OUT_DIR),
        totalQueuedRows: report.summary.totalQueuedRows,
        supplementOnlyRows: report.summary.supplementOnlyRows,
        highConfidenceSoftOnlySupplementRows: report.summary.highConfidenceSoftOnlySupplementRows,
        topClusterFiles,
      },
      null,
      2,
    ),
  );
};

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
