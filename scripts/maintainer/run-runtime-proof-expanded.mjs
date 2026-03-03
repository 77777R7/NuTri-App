#!/usr/bin/env node
/* eslint-disable no-console */

import fs from "node:fs/promises";
import path from "node:path";

const ROOT_DIR = process.cwd();
const args = process.argv.slice(2);

const getArg = (flag, fallback = null) => {
  const idx = args.indexOf(`--${flag}`);
  if (idx === -1) return fallback;
  return args[idx + 1] ?? fallback;
};

const resolvePath = (value) => {
  if (!value) return null;
  return path.isAbsolute(value) ? value : path.join(ROOT_DIR, value);
};

const ensureDir = async (dirPath) => {
  await fs.mkdir(dirPath, { recursive: true });
};

const writeJson = async (filePath, payload) => {
  await ensureDir(path.dirname(filePath));
  await fs.writeFile(filePath, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
};

const writeText = async (filePath, body) => {
  await ensureDir(path.dirname(filePath));
  await fs.writeFile(filePath, body, "utf8");
};

const readJson = async (filePath) => JSON.parse(await fs.readFile(filePath, "utf8"));

const asNumber = (value, fallback = 0) => {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
};

const toRate = (num, den) => (den > 0 ? num / den : 0);

const gatherBatchReports = async (batchesDir) => {
  const out = [];
  try {
    const entries = await fs.readdir(batchesDir, { withFileTypes: true });
    for (const ent of entries) {
      if (!ent.isDirectory()) continue;
      const reportPath = path.join(batchesDir, ent.name, "batch_gate_report.json");
      try {
        const report = await readJson(reportPath);
        out.push(report);
      } catch {
        // ignore missing
      }
    }
  } catch {
    // ignore missing root
  }
  return out;
};

const summarizeReports = (reports) => {
  const totalBatches = reports.length;
  const totalRuntimePatchHitCountDelta = reports.reduce((sum, row) => sum + asNumber(row?.metrics?.runtimePatchHitCountDelta, 0), 0);
  const totalSampledBarcodes = reports.reduce((sum, row) => sum + asNumber(row?.counts?.uniqueBarcodes, 0), 0);
  const totalAvailableBarcodes = reports.reduce((sum, row) => sum + asNumber(row?.counts?.uniqueBarcodesTotalAvailable, 0), 0);
  const passBatches = reports.filter((row) => Boolean(row?.gates?.pass)).length;

  return {
    totalBatches,
    passBatches,
    failBatches: Math.max(0, totalBatches - passBatches),
    totalRuntimePatchHitCountDelta,
    totalSampledBarcodes,
    totalAvailableBarcodes,
    runtimeHitRateOnSampled: Number(toRate(totalRuntimePatchHitCountDelta, totalSampledBarcodes).toFixed(6)),
    runtimeHitRateOnAvailable: Number(toRate(totalRuntimePatchHitCountDelta, totalAvailableBarcodes).toFixed(6)),
    topBatchesByRuntimeHit: reports
      .map((row) => ({
        batchId: row?.batchId,
        runtimePatchHitCountDelta: asNumber(row?.metrics?.runtimePatchHitCountDelta, 0),
        improvementRate: asNumber(row?.metrics?.missingDirectionsImprovementRate, 0),
        conflictRate: asNumber(row?.metrics?.conflict_rate, 0),
      }))
      .sort((a, b) => b.runtimePatchHitCountDelta - a.runtimePatchHitCountDelta || b.improvementRate - a.improvementRate)
      .slice(0, 10),
  };
};

const main = async () => {
  const newTop100Dir = resolvePath(getArg("new-top100-dir"));
  if (!newTop100Dir) {
    console.error("[run-runtime-proof-expanded] missing --new-top100-dir");
    process.exit(1);
  }

  const oldTop100ReportJson =
    resolvePath(getArg("old-top100-report-json"))
    ?? path.join(ROOT_DIR, "output", "v1.6.14-e-plus-20260302T085848Z", "analysis", "top100_patch_ux_coverage_report.json");

  const probeMaxBarcodes = Math.max(10, asNumber(getArg("probe-max-barcodes"), 25));
  const outDir =
    resolvePath(getArg("out-dir"))
    ?? path.join(newTop100Dir, "phase_e");

  const newBatchReports = await gatherBatchReports(path.join(newTop100Dir, "phase_d", "batches"));
  const newSummary = summarizeReports(newBatchReports);

  const oldReport = await readJson(oldTop100ReportJson).catch(() => null);
  const oldSummary = {
    generatedAt: new Date().toISOString(),
    source: oldTop100ReportJson,
    runtime_hit_rate: asNumber(oldReport?.summary?.runtime_hit_rate, asNumber(oldReport?.runtime_hit_rate, 0)),
    runtime_hit_count: asNumber(oldReport?.summary?.runtime_hit_count, 0),
    runtime_can_hit_count: asNumber(oldReport?.summary?.runtime_can_hit_count, 0),
    enforced_coverage_rate: asNumber(oldReport?.summary?.enforced_coverage_rate, 0),
    ui_visible_uplift_rate: oldReport?.summary?.ui_visible_uplift_rate ?? null,
  };

  const newReport = {
    generatedAt: new Date().toISOString(),
    source: path.join(newTop100Dir, "phase_d", "batches"),
    probeMaxBarcodes,
    ...newSummary,
  };

  const compare = {
    generatedAt: newReport.generatedAt,
    probeMaxBarcodes,
    newTop100: newReport,
    oldTop100: oldSummary,
    notes: [
      "runtime proof expanded is non-blocking for enforce",
      "newTop100 metrics derived from batch gate reports",
      "oldTop100 metrics sourced from historical top100_patch_ux_coverage_report",
    ],
  };

  await writeJson(path.join(outDir, "runtime_proof_expanded_new_top100.json"), newReport);
  await writeJson(path.join(outDir, "runtime_proof_expanded_old_top100.json"), oldSummary);
  await writeText(
    path.join(outDir, "runtime_proof_expanded_compare.md"),
    [
      "# Runtime Proof Expanded Compare",
      "",
      `- probeMaxBarcodes: ${probeMaxBarcodes}`,
      "",
      "## New Top100",
      `- totalBatches: ${newReport.totalBatches}`,
      `- passBatches: ${newReport.passBatches}`,
      `- runtimeHitDelta: ${newReport.totalRuntimePatchHitCountDelta}`,
      `- runtimeHitRateOnSampled: ${(newReport.runtimeHitRateOnSampled * 100).toFixed(2)}%`,
      `- runtimeHitRateOnAvailable: ${(newReport.runtimeHitRateOnAvailable * 100).toFixed(2)}%`,
      "",
      "## Old Top100",
      `- runtime_hit_rate: ${(asNumber(oldSummary.runtime_hit_rate, 0) * 100).toFixed(2)}%`,
      `- runtime_hit_count: ${oldSummary.runtime_hit_count}`,
      `- runtime_can_hit_count: ${oldSummary.runtime_can_hit_count}`,
      `- enforced_coverage_rate: ${(asNumber(oldSummary.enforced_coverage_rate, 0) * 100).toFixed(2)}%`,
    ].join("\n") + "\n",
  );

  await writeJson(path.join(outDir, "runtime_proof_expanded_compare.json"), compare);

  console.log("[run-runtime-proof-expanded] completed");
  console.log(JSON.stringify({
    outDir,
    newBatchCount: newReport.totalBatches,
    probeMaxBarcodes,
  }, null, 2));
};

main().catch((error) => {
  console.error("[run-runtime-proof-expanded] failed:", error instanceof Error ? error.stack || error.message : String(error));
  process.exit(1);
});
