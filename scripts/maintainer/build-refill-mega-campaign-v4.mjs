#!/usr/bin/env node
/* eslint-disable no-console */
import fs from "node:fs/promises";
import path from "node:path";

import { normalizeLower, normalizeText } from "./lib/iherb-overlay-utils.mjs";
import {
  buildQueueRowFromStagingMerge,
  slugify,
  SOFT_FIELD_NAMES,
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
const FACTS_AUDIT_ROWS_PATH = getArg(
  "facts-audit-rows-json",
  path.join(ROOT, "output", "refill_mega_04", "facts_parser_recovery_audit", "facts_parser_recovery_audit.rows.json"),
);
const OUT_DIR = getArg(
  "out-dir",
  path.join(ROOT, "output", "refill_mega_04", "miner_v4"),
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

const summarizeRows = (rows) => {
  const byBrand = {};
  for (const row of rows) {
    const brandName = normalizeText(row?.brandName ?? "Unknown");
    byBrand[brandName] = (byBrand[brandName] ?? 0) + 1;
  }
  return {
    rowCount: rows.length,
    brandCount: Object.keys(byBrand).length,
    byBrand: Object.fromEntries(Object.entries(byBrand).sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0]))),
  };
};

const estimateStrictUplift = (manifest) => {
  const counts = {
    tier1Soft: manifest.tier1Soft.summary.rowCount,
    tier1FactsLite: manifest.tier1FactsLite.summary.rowCount,
    tier1FactsHeavy: manifest.tier1FactsHeavy.summary.rowCount,
    tier2Soft: manifest.tier2Soft.summary.rowCount,
    tier2FactsLite: manifest.tier2FactsLite.summary.rowCount,
    tier2FactsHeavy: manifest.tier2FactsHeavy.summary.rowCount,
  };

  const conservative =
    counts.tier1Soft * 0.55 +
    counts.tier1FactsLite * 0.22 +
    counts.tier1FactsHeavy * 0.08 +
    counts.tier2Soft * 0.18 +
    counts.tier2FactsLite * 0.08 +
    counts.tier2FactsHeavy * 0.03;
  const target =
    counts.tier1Soft * 0.7 +
    counts.tier1FactsLite * 0.32 +
    counts.tier1FactsHeavy * 0.12 +
    counts.tier2Soft * 0.28 +
    counts.tier2FactsLite * 0.14 +
    counts.tier2FactsHeavy * 0.05;
  const aggressive =
    counts.tier1Soft * 0.82 +
    counts.tier1FactsLite * 0.42 +
    counts.tier1FactsHeavy * 0.18 +
    counts.tier2Soft * 0.38 +
    counts.tier2FactsLite * 0.2 +
    counts.tier2FactsHeavy * 0.08;

  return {
    conservative: Math.round(conservative),
    target: Math.round(target),
    aggressive: Math.round(aggressive),
  };
};

const buildMarkdown = (manifest) => {
  const lines = [
    "# Refill Mega Campaign v4",
    "",
    `- generated_at: ${manifest.generatedAt}`,
    `- campaign_id: ${manifest.campaignId}`,
    `- total_selected_rows: ${manifest.totalSelectedRows}`,
    `- total_selected_brands: ${manifest.totalSelectedBrandCount}`,
    `- strict_goal: ${manifest.targetStrictDelta}`,
    `- projected_conservative: ${manifest.projectedStrictUplift.conservative}`,
    `- projected_target: ${manifest.projectedStrictUplift.target}`,
    `- projected_aggressive: ${manifest.projectedStrictUplift.aggressive}`,
    "",
  ];

  for (const [label, block] of [
    ["Tier 1 Soft", manifest.tier1Soft],
    ["Tier 1 Facts Lite", manifest.tier1FactsLite],
    ["Tier 1 Facts Heavy", manifest.tier1FactsHeavy],
    ["Tier 2 Soft", manifest.tier2Soft],
    ["Tier 2 Facts Lite", manifest.tier2FactsLite],
    ["Tier 2 Facts Heavy", manifest.tier2FactsHeavy],
  ]) {
    lines.push(`## ${label}`);
    lines.push(`- rows: ${block.summary.rowCount}`);
    lines.push(`- brands: ${block.summary.brandCount}`);
    for (const [brandName, count] of Object.entries(block.summary.byBrand).slice(0, 20)) {
      lines.push(`- ${brandName}: ${count}`);
    }
    lines.push("");
  }

  return `${lines.join("\n")}\n`;
};

const main = async () => {
  const stagingRows = await readJson(STAGING_PATH);
  const mergeReport = await readJson(MERGE_REPORT_PATH);
  const classifierRows = await readJson(CLASSIFIER_ROWS_PATH);
  const factsAuditRows = await readJson(FACTS_AUDIT_ROWS_PATH);

  const stagingByProductId = new Map(stagingRows.map((row) => [normalizeText(row?.productId), row]));
  const classifierByProductId = new Map(classifierRows.map((row) => [normalizeText(row?.productId), row]));
  const factsAuditByProductId = new Map(factsAuditRows.map((row) => [normalizeText(row?.productId), row]));

  const tier1Soft = [];
  const tier1FactsLite = [];
  const tier1FactsHeavy = [];
  const tier2Soft = [];
  const tier2FactsLite = [];
  const tier2FactsHeavy = [];
  const seen = new Set();

  for (const mergeRow of mergeReport?.rows ?? []) {
    if (normalizeLower(mergeRow?.mergeDecision) !== "queued") continue;
    if (normalizeLower(mergeRow?.status) !== "partial_overlay") continue;

    const productId = normalizeText(mergeRow?.productId);
    const stagingRow = stagingByProductId.get(productId);
    const classifierRow = classifierByProductId.get(productId);
    if (!stagingRow || !classifierRow || !classifierRow.supplementOnly) continue;

    const factsAuditRow = factsAuditByProductId.get(productId) ?? null;
    const missing = new Set((mergeRow?.stillMissingFields ?? []).map((value) => normalizeLower(value)).filter(Boolean));
    const resolved = new Set((mergeRow?.overlayResolvedFields ?? []).map((value) => normalizeLower(value)).filter(Boolean));
    const hasIngredient = resolved.has("ingredient");
    const hasDosage = resolved.has("dosage");
    const hasSuggestedUse = resolved.has("suggested_use");
    const hasWarnings = resolved.has("warnings");
    const hasImage = resolved.has("product_image");
    const highConfidence = Boolean(mergeRow?.highConfidenceUsProductPageReady);
    const clusterKind = normalizeText(classifierRow?.clusterKind);
    const inTier1 = clusterKind === "supplement_core";
    const onlySoftMissing = [...missing].every((field) => SOFT_FIELD_NAMES.includes(field));
    const queueRow = buildQueueRowFromStagingMerge(stagingRow, mergeRow, "refill_miner_v4");

    if (hasIngredient && hasDosage && hasImage && onlySoftMissing && missing.size > 0) {
      const key = `${inTier1 ? "t1s" : "t2s"}:${productId}`;
      if (!seen.has(key)) {
        (inTier1 ? tier1Soft : tier2Soft).push(queueRow);
        seen.add(key);
      }
      continue;
    }

    const factsLite =
      hasSuggestedUse &&
      hasWarnings &&
      ((missing.size === 1 && (missing.has("ingredient") || missing.has("dosage"))) ||
        (missing.size === 2 && hasImage && (missing.has("ingredient") || missing.has("dosage"))));

    if (factsLite) {
      const recoveryClass = normalizeText(factsAuditRow?.recoveryClass);
      if (
        [
          "title_plus_sections_recoverable",
          "serving_stub_parser_repair",
          "section_only_recoverable",
          "serving_only_recoverable",
        ].includes(recoveryClass)
      ) {
        const key = `${inTier1 ? "t1fl" : "t2fl"}:${productId}`;
        if (!seen.has(key)) {
          (inTier1 ? tier1FactsLite : tier2FactsLite).push(queueRow);
          seen.add(key);
        }
        continue;
      }
    }

    if (missing.has("ingredient") && missing.has("dosage")) {
      const recoveryClass = normalizeText(factsAuditRow?.recoveryClass);
      const recoverable =
        recoveryClass === "title_plus_sections_recoverable" ||
        recoveryClass === "serving_stub_parser_repair" ||
        (recoveryClass === "section_only_recoverable" && highConfidence);
      if (recoverable) {
        const key = `${inTier1 ? "t1fh" : "t2fh"}:${productId}`;
        if (!seen.has(key)) {
          (inTier1 ? tier1FactsHeavy : tier2FactsHeavy).push(queueRow);
          seen.add(key);
        }
      }
    }
  }

  const manifest = {
    generatedAt: new Date().toISOString(),
    campaignId: "REFILL-MEGA-04",
    targetStrictDelta: 1000,
    inputs: {
      stagingPath: path.resolve(ROOT, STAGING_PATH),
      mergeReportPath: path.resolve(ROOT, MERGE_REPORT_PATH),
      classifierRowsPath: path.resolve(ROOT, CLASSIFIER_ROWS_PATH),
      factsAuditRowsPath: path.resolve(ROOT, FACTS_AUDIT_ROWS_PATH),
    },
    totalSelectedRows:
      tier1Soft.length +
      tier1FactsLite.length +
      tier1FactsHeavy.length +
      tier2Soft.length +
      tier2FactsLite.length +
      tier2FactsHeavy.length,
    totalSelectedBrandCount: new Set(
      [
        ...tier1Soft,
        ...tier1FactsLite,
        ...tier1FactsHeavy,
        ...tier2Soft,
        ...tier2FactsLite,
        ...tier2FactsHeavy,
      ].map((row) => normalizeText(row?.brandName)),
    ).size,
    tier1Soft: {
      queuePath: path.resolve(ROOT, OUT_DIR, "tier1_soft.queue.rows.json"),
      summary: summarizeRows(tier1Soft),
    },
    tier1FactsLite: {
      queuePath: path.resolve(ROOT, OUT_DIR, "tier1_facts_lite.queue.rows.json"),
      summary: summarizeRows(tier1FactsLite),
    },
    tier1FactsHeavy: {
      queuePath: path.resolve(ROOT, OUT_DIR, "tier1_facts_heavy.queue.rows.json"),
      summary: summarizeRows(tier1FactsHeavy),
    },
    tier2Soft: {
      queuePath: path.resolve(ROOT, OUT_DIR, "tier2_soft.queue.rows.json"),
      summary: summarizeRows(tier2Soft),
    },
    tier2FactsLite: {
      queuePath: path.resolve(ROOT, OUT_DIR, "tier2_facts_lite.queue.rows.json"),
      summary: summarizeRows(tier2FactsLite),
    },
    tier2FactsHeavy: {
      queuePath: path.resolve(ROOT, OUT_DIR, "tier2_facts_heavy.queue.rows.json"),
      summary: summarizeRows(tier2FactsHeavy),
    },
    combinedQueuePath: path.resolve(ROOT, OUT_DIR, "combined.queue.rows.json"),
  };

  manifest.projectedStrictUplift = estimateStrictUplift(manifest);

  const combinedRows = [
    ...tier1Soft,
    ...tier1FactsLite,
    ...tier1FactsHeavy,
    ...tier2Soft,
    ...tier2FactsLite,
    ...tier2FactsHeavy,
  ];

  await writeJson(path.resolve(ROOT, OUT_DIR, "combined.queue.rows.json"), combinedRows);
  await writeJson(path.resolve(ROOT, OUT_DIR, "tier1_soft.queue.rows.json"), tier1Soft);
  await writeJson(path.resolve(ROOT, OUT_DIR, "tier1_facts_lite.queue.rows.json"), tier1FactsLite);
  await writeJson(path.resolve(ROOT, OUT_DIR, "tier1_facts_heavy.queue.rows.json"), tier1FactsHeavy);
  await writeJson(path.resolve(ROOT, OUT_DIR, "tier2_soft.queue.rows.json"), tier2Soft);
  await writeJson(path.resolve(ROOT, OUT_DIR, "tier2_facts_lite.queue.rows.json"), tier2FactsLite);
  await writeJson(path.resolve(ROOT, OUT_DIR, "tier2_facts_heavy.queue.rows.json"), tier2FactsHeavy);
  await writeJson(path.resolve(ROOT, OUT_DIR, "campaign_manifest.json"), manifest);
  await writeText(path.resolve(ROOT, OUT_DIR, "campaign_manifest.md"), buildMarkdown(manifest));

  console.log(
    JSON.stringify(
      {
        ok: true,
        outDir: path.resolve(ROOT, OUT_DIR),
        totalSelectedRows: manifest.totalSelectedRows,
        totalSelectedBrandCount: manifest.totalSelectedBrandCount,
        projectedStrictUplift: manifest.projectedStrictUplift,
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
