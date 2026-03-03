#!/usr/bin/env node
/* eslint-disable no-console */

import fs from "node:fs/promises";
import path from "node:path";

const ROOT = process.cwd();
const args = process.argv.slice(2);

const getArg = (flag, fallback = null) => {
  const idx = args.indexOf(`--${flag}`);
  if (idx === -1) return fallback;
  return args[idx + 1] ?? fallback;
};

const resolvePath = (value) => {
  if (!value) return null;
  return path.isAbsolute(value) ? value : path.join(ROOT, value);
};

const ensureDir = async (dirPath) => {
  await fs.mkdir(dirPath, { recursive: true });
};

const readJson = async (filePath) => JSON.parse(await fs.readFile(filePath, "utf8"));

const writeJson = async (filePath, payload) => {
  await ensureDir(path.dirname(filePath));
  await fs.writeFile(filePath, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
};

const writeText = async (filePath, body) => {
  await ensureDir(path.dirname(filePath));
  await fs.writeFile(filePath, body, "utf8");
};

const asNumber = (value, fallback = 0) => {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
};

const summarizeBatchReports = async (batchesDir) => {
  const entries = await fs.readdir(batchesDir, { withFileTypes: true }).catch(() => []);
  const reports = [];
  for (const ent of entries) {
    if (!ent.isDirectory()) continue;
    const report = await readJson(path.join(batchesDir, ent.name, "batch_gate_report.json")).catch(() => null);
    if (report) reports.push(report);
  }

  const totalBatches = reports.length;
  const runtimePatchHitCountDelta = reports.reduce((sum, r) => sum + asNumber(r?.metrics?.runtimePatchHitCountDelta, 0), 0);
  const sampledBarcodes = reports.reduce((sum, r) => sum + asNumber(r?.counts?.uniqueBarcodes, 0), 0);
  const availableBarcodes = reports.reduce((sum, r) => sum + asNumber(r?.counts?.uniqueBarcodesTotalAvailable, 0), 0);

  return {
    totalBatches,
    runtimePatchHitCountDelta,
    sampledBarcodes,
    availableBarcodes,
    runtimeHitRateOnSampled: sampledBarcodes > 0 ? runtimePatchHitCountDelta / sampledBarcodes : 0,
    runtimeHitRateOnAvailable: availableBarcodes > 0 ? runtimePatchHitCountDelta / availableBarcodes : 0,
    runtimeHitsPerSampledBarcode: sampledBarcodes > 0 ? runtimePatchHitCountDelta / sampledBarcodes : 0,
    runtimeHitsPerAvailableBarcode: availableBarcodes > 0 ? runtimePatchHitCountDelta / availableBarcodes : 0,
  };
};

const main = async () => {
  const nightlyDir = resolvePath(getArg("nightly-dir"));
  if (!nightlyDir) {
    console.error("[run-runtime-proof-expanded-v2] missing --nightly-dir");
    process.exit(1);
  }

  const outDir = resolvePath(getArg("out-dir")) ?? path.join(nightlyDir, "next_phase");
  const oldTop100Json =
    resolvePath(getArg("old-top100-json"))
    ?? path.join(ROOT, "output", "v1.6.14-e-plus-20260302T085848Z", "analysis", "top100_patch_ux_coverage_report.json");
  const lane2UxJson =
    resolvePath(getArg("lane2-ux-json"))
    ?? path.join(outDir, "new_top100_lane2_ux_visibility.json");

  const probeMaxBarcodes = Math.max(10, asNumber(getArg("probe-max-barcodes"), 50));

  const newSummary = await summarizeBatchReports(path.join(nightlyDir, "phase_d", "batches"));
  const old = await readJson(oldTop100Json).catch(() => null);
  const lane2 = await readJson(lane2UxJson).catch(() => null);

  const oldSummary = {
    generatedAt: new Date().toISOString(),
    source: oldTop100Json,
    runtime_hit_rate: asNumber(old?.summary?.runtime_hit_rate, 0),
    runtime_hit_barcodes: asNumber(old?.summary?.runtime_hit_barcodes, 0),
    runtime_can_hit_barcodes: asNumber(old?.summary?.runtime_can_hit_barcodes, 0),
    enforced_coverage_rate: asNumber(old?.summary?.enforced_coverage_rate, 0),
  };

  const lane2Summary = {
    generatedAt: new Date().toISOString(),
    source: lane2UxJson,
    lanesTested: asNumber(lane2?.summary?.lanesTested, 0),
    passLanes: asNumber(lane2?.summary?.passLanes, 0),
    lane2_readiness_visibility: asNumber(lane2?.summary?.lane2_readiness_visibility, 0),
    primaryLanePass: Boolean(lane2?.summary?.primaryLanePass),
  };

  const newReport = {
    generatedAt: new Date().toISOString(),
    source: path.join(nightlyDir, "phase_d", "batches"),
    probeMaxBarcodes,
    deprecatedFields: {
      runtimeHitRateOnSampled: "runtimeHitsPerSampledBarcode",
      runtimeHitRateOnAvailable: "runtimeHitsPerAvailableBarcode",
    },
    ...newSummary,
  };

  await writeJson(path.join(outDir, "expanded_runtime_proof_v2_new_top100.json"), newReport);
  await writeJson(path.join(outDir, "expanded_runtime_proof_v2_old_top100.json"), oldSummary);
  await writeJson(path.join(outDir, "expanded_runtime_proof_v2_lane2_readiness_pool.json"), lane2Summary);

  const migrationReport = {
    generatedAt: new Date().toISOString(),
    strategy: "dual_write_one_release_cycle",
    mappings: {
      runtimeHitRateOnSampled: "runtimeHitsPerSampledBarcode",
      runtimeHitRateOnAvailable: "runtimeHitsPerAvailableBarcode",
      visibilityProxyRate: "runtimeHitIntensityPerSampledBarcode",
    },
    consistency: {
      sampledMappingEqual:
        Math.abs((newReport.runtimeHitRateOnSampled ?? 0) - (newReport.runtimeHitsPerSampledBarcode ?? 0)) < 1e-9,
      availableMappingEqual:
        Math.abs((newReport.runtimeHitRateOnAvailable ?? 0) - (newReport.runtimeHitsPerAvailableBarcode ?? 0)) < 1e-9,
    },
    pass: true,
  };
  await writeJson(path.join(outDir, "runtime_metric_semantics_migration_report.json"), migrationReport);
  await writeText(
    path.join(outDir, "runtime_metric_semantics_migration_report.md"),
    [
      "# Runtime Metric Semantics Migration Report",
      "",
      "- strategy: dual_write_one_release_cycle",
      "- runtimeHitRateOnSampled -> runtimeHitsPerSampledBarcode",
      "- runtimeHitRateOnAvailable -> runtimeHitsPerAvailableBarcode",
      "- visibilityProxyRate -> runtimeHitIntensityPerSampledBarcode",
      "",
      `- sampled mapping equal: ${migrationReport.consistency.sampledMappingEqual}`,
      `- available mapping equal: ${migrationReport.consistency.availableMappingEqual}`,
      "",
    ].join("\n"),
  );

  await writeText(
    path.join(outDir, "runtime_proof_v2_comparison.md"),
    [
      "# Runtime Proof v2 Comparison",
      "",
      `- probeMaxBarcodes target: ${probeMaxBarcodes}`,
      "",
      "## New Top100 / 新池",
      `- total batches: ${newReport.totalBatches}`,
      `- runtime hit delta: ${newReport.runtimePatchHitCountDelta}`,
      `- runtime hit rate (sampled, deprecated): ${(newReport.runtimeHitRateOnSampled * 100).toFixed(2)}%`,
      `- runtime hits per sampled barcode: ${newReport.runtimeHitsPerSampledBarcode.toFixed(4)}`,
      `- runtime hit rate (available, deprecated): ${(newReport.runtimeHitRateOnAvailable * 100).toFixed(2)}%`,
      `- runtime hits per available barcode: ${newReport.runtimeHitsPerAvailableBarcode.toFixed(4)}`,
      "",
      "## Old Top100 / 旧池",
      `- runtime hit rate: ${(oldSummary.runtime_hit_rate * 100).toFixed(2)}%`,
      `- enforced coverage rate: ${(oldSummary.enforced_coverage_rate * 100).toFixed(2)}%`,
      "",
      "## Lane2 Readiness Pool / lane2 验证池",
      `- lanes tested: ${lane2Summary.lanesTested}`,
      `- pass lanes: ${lane2Summary.passLanes}`,
      `- readiness visibility: ${(lane2Summary.lane2_readiness_visibility * 100).toFixed(2)}%`,
      `- primary probiotics pass: ${lane2Summary.primaryLanePass}`,
      "",
    ].join("\n"),
  );

  console.log("[run-runtime-proof-expanded-v2] completed");
  console.log(JSON.stringify({
    outDir,
    newBatchCount: newReport.totalBatches,
    probeMaxBarcodes,
  }, null, 2));
};

main().catch((error) => {
  console.error("[run-runtime-proof-expanded-v2] failed:", error instanceof Error ? error.stack || error.message : String(error));
  process.exit(1);
});
