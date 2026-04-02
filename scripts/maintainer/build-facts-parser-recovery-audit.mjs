#!/usr/bin/env node
/* eslint-disable no-console */
import fs from "node:fs/promises";
import path from "node:path";

import { normalizeLower, normalizeText } from "./lib/iherb-overlay-utils.mjs";
import {
  countUsefulNutritionFacts,
  hasTitleDosageSignal,
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
const CLASSIFIER_ROWS_PATH = getArg(
  "classifier-rows-json",
  path.join(ROOT, "output", "refill_mega_04", "subcluster_classifier", "supplement_subcluster_classifier.rows.json"),
);
const OUT_DIR = getArg(
  "out-dir",
  path.join(ROOT, "output", "refill_mega_04", "facts_parser_recovery_audit"),
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

const classifyRecoveryPath = ({ stagingRow, missingIngredient, missingDosage }) => {
  const sectionKeys = Object.keys(stagingRow?.descriptionSections ?? {});
  const hasSections = sectionKeys.length > 0;
  const servingSize = normalizeText(stagingRow?.supplementFacts?.servingSize ?? stagingRow?.serving?.servingSize ?? null);
  const servingsPerContainer = normalizeText(
    stagingRow?.supplementFacts?.servingsPerContainer ?? stagingRow?.serving?.servingsPerContainer ?? null,
  );
  const usefulFactsCount = countUsefulNutritionFacts(stagingRow?.supplementFacts);
  const hasServingMeta = Boolean(servingSize || servingsPerContainer);
  const titleHasDose = hasTitleDosageSignal(stagingRow?.title);
  const hasSuggestedUse = sectionKeys.includes("Suggested use");
  const hasWarnings = sectionKeys.includes("Warnings") || sectionKeys.includes("Disclaimer");

  if (usefulFactsCount > 0) return "structured_facts_present";
  if (missingIngredient && missingDosage && titleHasDose && hasSections) return "title_plus_sections_recoverable";
  if (missingIngredient && missingDosage && hasServingMeta && hasSections) return "serving_stub_parser_repair";
  if (missingIngredient && missingDosage && hasSections) return "section_only_recoverable";
  if ((missingIngredient || missingDosage) && hasServingMeta && hasSections) return "serving_stub_parser_repair";
  if ((missingIngredient || missingDosage) && titleHasDose && hasSections) return "title_plus_sections_recoverable";
  if ((missingIngredient || missingDosage) && hasSections) return "section_only_recoverable";
  if ((missingIngredient || missingDosage) && hasServingMeta) return "serving_only_recoverable";
  return "needs_source_lane";
};

const buildMarkdown = (report) => {
  const lines = [
    "# Facts Parser Recovery Audit",
    "",
    `- generated_at: ${report.generatedAt}`,
    `- total_hard_field_rows: ${report.summary.totalHardFieldRows}`,
    `- supplement_only_hard_field_rows: ${report.summary.supplementOnlyHardFieldRows}`,
    "",
    "## Recovery Classes",
  ];

  for (const [recoveryClass, count] of Object.entries(report.summary.recoveryClassCounts)) {
    lines.push(`- ${recoveryClass}: ${count}`);
  }

  lines.push("", "## Supplement-only Recovery Classes");
  for (const [recoveryClass, count] of Object.entries(report.summary.supplementRecoveryClassCounts)) {
    lines.push(`- ${recoveryClass}: ${count}`);
  }

  lines.push("", "## Top Brands");
  for (const [brandName, count] of Object.entries(report.summary.brandCounts).slice(0, 25)) {
    lines.push(`- ${brandName}: ${count}`);
  }

  lines.push("");
  return `${lines.join("\n")}\n`;
};

const main = async () => {
  const stagingRows = await readJson(STAGING_PATH);
  const mergeReport = await readJson(MERGE_REPORT_PATH);
  const classifierRows = await readJson(CLASSIFIER_ROWS_PATH);

  const stagingByProductId = new Map(stagingRows.map((row) => [normalizeText(row?.productId), row]));
  const classifierByProductId = new Map(classifierRows.map((row) => [normalizeText(row?.productId), row]));

  const auditRows = [];

  for (const mergeRow of mergeReport?.rows ?? []) {
    if (normalizeLower(mergeRow?.mergeDecision) !== "queued") continue;
    if (normalizeLower(mergeRow?.status) !== "partial_overlay") continue;

    const missing = new Set((mergeRow?.stillMissingFields ?? []).map((value) => normalizeLower(value)).filter(Boolean));
    const missingIngredient = missing.has("ingredient");
    const missingDosage = missing.has("dosage");
    if (!missingIngredient && !missingDosage) continue;

    const productId = normalizeText(mergeRow?.productId);
    const stagingRow = stagingByProductId.get(productId);
    if (!stagingRow) continue;
    const classifierRow = classifierByProductId.get(productId) ?? null;
    const recoveryClass = classifyRecoveryPath({ stagingRow, missingIngredient, missingDosage });

    auditRows.push({
      productId,
      brandName: stagingRow?.brandName ?? mergeRow?.brandName ?? null,
      title: stagingRow?.title ?? mergeRow?.title ?? null,
      clusterKind: classifierRow?.clusterKind ?? null,
      clusterLabel: classifierRow?.clusterLabel ?? null,
      supplementOnly: Boolean(classifierRow?.supplementOnly),
      highConfidenceUsProductPageReady: Boolean(mergeRow?.highConfidenceUsProductPageReady),
      stillMissingFields: mergeRow?.stillMissingFields ?? [],
      overlayResolvedFields: mergeRow?.overlayResolvedFields ?? [],
      recoveryClass,
      sectionKeys: Object.keys(stagingRow?.descriptionSections ?? {}),
      usefulFactsCount: countUsefulNutritionFacts(stagingRow?.supplementFacts),
      servingSize: normalizeText(stagingRow?.supplementFacts?.servingSize ?? stagingRow?.serving?.servingSize ?? null) || null,
      servingsPerContainer:
        normalizeText(stagingRow?.supplementFacts?.servingsPerContainer ?? stagingRow?.serving?.servingsPerContainer ?? null) || null,
      titleHasDosageSignal: hasTitleDosageSignal(stagingRow?.title),
      dosageForm: stagingRow?.dosageForm ?? null,
      categories: stagingRow?.categories ?? [],
    });
  }

  const supplementRows = auditRows.filter((row) => row.supplementOnly);
  const report = {
    generatedAt: new Date().toISOString(),
    inputs: {
      stagingPath: path.resolve(ROOT, STAGING_PATH),
      mergeReportPath: path.resolve(ROOT, MERGE_REPORT_PATH),
      classifierRowsPath: path.resolve(ROOT, CLASSIFIER_ROWS_PATH),
    },
    summary: {
      totalHardFieldRows: auditRows.length,
      supplementOnlyHardFieldRows: supplementRows.length,
      recoveryClassCounts: summarizeCounts(auditRows, "recoveryClass"),
      supplementRecoveryClassCounts: summarizeCounts(supplementRows, "recoveryClass"),
      brandCounts: summarizeCounts(supplementRows, "brandName"),
    },
    outputs: {
      rowsPath: path.resolve(ROOT, OUT_DIR, "facts_parser_recovery_audit.rows.json"),
      reportPath: path.resolve(ROOT, OUT_DIR, "facts_parser_recovery_audit.json"),
      markdownPath: path.resolve(ROOT, OUT_DIR, "facts_parser_recovery_audit.md"),
    },
  };

  await writeJson(report.outputs.rowsPath, auditRows);
  await writeJson(report.outputs.reportPath, report);
  await writeText(report.outputs.markdownPath, buildMarkdown(report));

  for (const [recoveryClass] of Object.entries(report.summary.supplementRecoveryClassCounts).slice(0, 10)) {
    await writeJson(
      path.resolve(ROOT, OUT_DIR, `${slugify(recoveryClass)}.rows.json`),
      supplementRows.filter((row) => row.recoveryClass === recoveryClass),
    );
  }

  console.log(
    JSON.stringify(
      {
        ok: true,
        outDir: path.resolve(ROOT, OUT_DIR),
        totalHardFieldRows: report.summary.totalHardFieldRows,
        supplementOnlyHardFieldRows: report.summary.supplementOnlyHardFieldRows,
        recoveryClasses: report.summary.supplementRecoveryClassCounts,
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
