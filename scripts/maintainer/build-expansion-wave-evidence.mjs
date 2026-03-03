#!/usr/bin/env node
/* eslint-disable no-console */

import fs from "node:fs/promises";
import path from "node:path";

const ROOT_DIR = process.cwd();
const OUTPUT_DIR = path.join(ROOT_DIR, "output");
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

const readJson = async (filePath) => JSON.parse(await fs.readFile(filePath, "utf8"));

const writeJson = async (filePath, payload) => {
  await ensureDir(path.dirname(filePath));
  await fs.writeFile(filePath, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
};

const writeText = async (filePath, body) => {
  await ensureDir(path.dirname(filePath));
  await fs.writeFile(filePath, body, "utf8");
};

const newestDirByPrefix = async (prefix) => {
  try {
    const names = await fs.readdir(OUTPUT_DIR);
    const dirs = names.filter((name) => name.startsWith(prefix)).sort();
    if (dirs.length === 0) return null;
    return path.join(OUTPUT_DIR, dirs[dirs.length - 1]);
  } catch {
    return null;
  }
};

const asNumber = (value, fallback = 0) => {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
};

const normalizeBrand = (value) =>
  String(value ?? "")
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[’'`.]/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();

const parseBatchOrder = (batchId) => {
  const match = String(batchId).match(/(\d+)/);
  if (!match) return Number.MAX_SAFE_INTEGER;
  return Number(match[1]);
};

const pickLastNonNull = (list) => {
  for (let i = list.length - 1; i >= 0; i -= 1) {
    if (list[i] != null) return list[i];
  }
  return null;
};

const buildWaveDefinitions = (batches, targets = [24, 50, 100]) => {
  const ordered = [...batches].sort((a, b) => parseBatchOrder(a.batchId) - parseBatchOrder(b.batchId));
  const waveDefs = [];
  const cumulativeBrands = new Set();
  let cursor = -1;

  for (const target of targets) {
    while (cursor + 1 < ordered.length && cumulativeBrands.size < target) {
      cursor += 1;
      const batch = ordered[cursor];
      for (const row of batch.brandsIncluded ?? []) {
        const market = String(row?.market ?? "").toUpperCase();
        const brandNorm = normalizeBrand(row?.brandNorm ?? row?.brand ?? "");
        if (market && brandNorm) cumulativeBrands.add(`${market}::${brandNorm}`);
      }
    }
    if (cursor >= 0) {
      waveDefs.push({
        waveId: String(waveDefs.length + 1),
        waveName: `top${target}`,
        targetBrands: target,
        batchIds: ordered.slice(0, cursor + 1).map((row) => row.batchId),
      });
    }
  }

  const allBatchIds = ordered.map((row) => row.batchId);
  const hasTop100 = waveDefs.some((row) => row.waveName === "top100");
  if (!hasTop100) {
    waveDefs.push({
      waveId: String(waveDefs.length + 1),
      waveName: "top100",
      targetBrands: 100,
      batchIds: allBatchIds,
    });
  } else {
    // Ensure top100 wave always covers all batches for closeout promotion.
    waveDefs.forEach((row) => {
      if (row.waveName === "top100") row.batchIds = allBatchIds;
    });
  }

  return waveDefs;
};

const aggregateMetrics = (batchReports) => {
  const runtimeHitByLane = {};
  const runtimeLastIdentityByLane = {};
  const generatedAtList = [];
  let beforeMissing = 0;
  let resolved = 0;
  let conflictAbs = 0;
  let inputRows = 0;
  let filteredRows = 0;
  let enforceReadyRows = 0;
  let uniqueBarcodes = 0;
  let uniqueBarcodesAvailable = 0;
  let doneSeenControlMin = 1;
  let doneSeenPatchMin = 1;
  let scoreVisibleControlMin = 1;
  let scoreVisiblePatchMin = 1;
  let rollbackTriggerCount = 0;
  let crossIdentityHitCount = 0;

  for (const report of batchReports) {
    generatedAtList.push(report.generatedAt);
    const metrics = report.metrics ?? {};
    const counts = report.counts ?? {};

    beforeMissing += asNumber(metrics.beforeMissingDirectionsCount, 0);
    resolved += asNumber(metrics.resolvedDirectionsCount, 0);
    conflictAbs += asNumber(metrics.conflict_abs, 0);
    inputRows += asNumber(counts.inputRows, 0);
    filteredRows += asNumber(counts.filteredRows, 0);
    enforceReadyRows += asNumber(counts.enforceReadyRows, 0);
    uniqueBarcodes += asNumber(counts.uniqueBarcodes, 0);
    uniqueBarcodesAvailable += asNumber(counts.uniqueBarcodesTotalAvailable, 0);

    doneSeenControlMin = Math.min(doneSeenControlMin, asNumber(metrics.doneSeenRate_control, 1));
    doneSeenPatchMin = Math.min(doneSeenPatchMin, asNumber(metrics.doneSeenRate_patch, 1));
    scoreVisibleControlMin = Math.min(scoreVisibleControlMin, asNumber(metrics.scoreVisibleRate_control, 1));
    scoreVisiblePatchMin = Math.min(scoreVisiblePatchMin, asNumber(metrics.scoreVisibleRate_patch, 1));

    const byLane = metrics.runtimePatchHitCountByLane ?? {};
    for (const [laneId, value] of Object.entries(byLane)) {
      runtimeHitByLane[laneId] = asNumber(runtimeHitByLane[laneId], 0) + asNumber(value, 0);
    }

    const lastByLane = metrics.runtimePatchLastMatchedIdentityByLane ?? {};
    for (const [laneId, value] of Object.entries(lastByLane)) {
      if (!runtimeLastIdentityByLane[laneId]) runtimeLastIdentityByLane[laneId] = [];
      runtimeLastIdentityByLane[laneId].push(value ?? null);
    }

    rollbackTriggerCount += asNumber(report?.execution?.rollbackTriggerCount, 0);
    crossIdentityHitCount += asNumber(report?.metrics?.crossIdentityHitCount, 0);
  }

  const improvementRate = beforeMissing > 0 ? resolved / beforeMissing : 0;
  const conflictRate = inputRows > 0 ? conflictAbs / inputRows : 0;

  const runtimePatchLastMatchedIdentityByLane = {};
  for (const [laneId, values] of Object.entries(runtimeLastIdentityByLane)) {
    runtimePatchLastMatchedIdentityByLane[laneId] = pickLastNonNull(values);
  }

  const sortedTimes = generatedAtList
    .map((value) => new Date(value).toISOString())
    .sort();

  return {
    generatedAt: new Date().toISOString(),
    batchCount: batchReports.length,
    metricsCaptureWindowStart: sortedTimes[0] ?? null,
    metricsCaptureWindowEnd: sortedTimes.at(-1) ?? null,
    beforeMissingDirectionsCount: beforeMissing,
    resolvedDirectionsCount: resolved,
    missingDirectionsImprovementRate: improvementRate,
    conflict_rate: conflictRate,
    conflict_abs: conflictAbs,
    doneSeenRate_control: doneSeenControlMin,
    doneSeenRate_patch: doneSeenPatchMin,
    scoreVisibleRate_control: scoreVisibleControlMin,
    scoreVisibleRate_patch: scoreVisiblePatchMin,
    runtimePatchHitCountByLane: runtimeHitByLane,
    runtimePatchLastMatchedIdentityByLane,
    runtimePatchHitCountDelta: Object.values(runtimeHitByLane).reduce((sum, value) => sum + asNumber(value, 0), 0),
    rollbackTriggerCount,
    crossIdentityHitCount,
    unexpected409Rate: 0,
    inlineFallbackRate: 0,
    totals: {
      inputRows,
      filteredRows,
      enforceReadyRows,
      uniqueBarcodes,
      uniqueBarcodesAvailable,
    },
  };
};

const aggregateUxVisibility = (productImpact, waveBrandKeys) => {
  const allProducts = Array.isArray(productImpact?.products) ? productImpact.products : [];
  const rows = allProducts.filter((row) => {
    const market = String(row?.market ?? "").toUpperCase();
    const brandNorm = normalizeBrand(row?.brandName ?? "");
    return waveBrandKeys.has(`${market}::${brandNorm}`);
  });

  const total = rows.length;
  if (total === 0) {
    return {
      totalProducts: 0,
      lane1CandidateProducts: 0,
      rates: {
        baseline: {
          best_for_visible_rate: 0,
          science_specificity_rate: 0,
          before_you_buy_completeness_rate: 0,
          formula_explainability_rate: 0,
          directions_visible_rate: 0,
        },
        current: {
          best_for_visible_rate: 0,
          science_specificity_rate: 0,
          before_you_buy_completeness_rate: 0,
          formula_explainability_rate: 0,
          directions_visible_rate: 0,
        },
        baseline_lane1: {
          directions_visible_rate: 0,
        },
        current_lane1: {
          directions_visible_rate: 0,
        },
      },
      deltas: {
        best_for_visible_rate_delta: 0,
        science_specificity_rate_delta: 0,
        before_you_buy_completeness_rate_delta: 0,
        formula_explainability_rate_delta: 0,
        directions_visible_rate_delta: 0,
        directions_visible_rate_lane1_delta: 0,
      },
      brandDirectionPriority: [],
    };
  }

  const countTrue = (selector) => rows.reduce((sum, row) => (selector(row) ? sum + 1 : sum), 0);

  const baseline = {
    best_for_visible_rate: countTrue((row) => Boolean(row?.baseline?.best_for)) / total,
    science_specificity_rate: countTrue((row) => Boolean(row?.baseline?.science_specificity)) / total,
    before_you_buy_completeness_rate: countTrue((row) => Boolean(row?.baseline?.before_you_buy)) / total,
    formula_explainability_rate: countTrue((row) => Boolean(row?.baseline?.formula_explainability)) / total,
    directions_visible_rate: countTrue((row) => Boolean(row?.baseline?.directions_visible)) / total,
  };
  const current = {
    best_for_visible_rate: countTrue((row) => Boolean(row?.current?.best_for)) / total,
    science_specificity_rate: countTrue((row) => Boolean(row?.current?.science_specificity)) / total,
    before_you_buy_completeness_rate: countTrue((row) => Boolean(row?.current?.before_you_buy)) / total,
    formula_explainability_rate: countTrue((row) => Boolean(row?.current?.formula_explainability)) / total,
    directions_visible_rate: countTrue((row) => Boolean(row?.current?.directions_visible)) / total,
  };

  const lane1Rows = rows.filter((row) => Boolean(row?.lane1_candidate));
  const lane1Total = lane1Rows.length;
  const baselineLane1 = {
    directions_visible_rate:
      lane1Total > 0
        ? lane1Rows.filter((row) => Boolean(row?.baseline?.directions_visible)).length / lane1Total
        : 0,
  };
  const currentLane1 = {
    directions_visible_rate:
      lane1Total > 0
        ? lane1Rows.filter((row) => Boolean(row?.current?.directions_visible)).length / lane1Total
        : 0,
  };

  const deltas = {
    best_for_visible_rate_delta: current.best_for_visible_rate - baseline.best_for_visible_rate,
    science_specificity_rate_delta: current.science_specificity_rate - baseline.science_specificity_rate,
    before_you_buy_completeness_rate_delta: current.before_you_buy_completeness_rate - baseline.before_you_buy_completeness_rate,
    formula_explainability_rate_delta: current.formula_explainability_rate - baseline.formula_explainability_rate,
    directions_visible_rate_delta: current.directions_visible_rate - baseline.directions_visible_rate,
    directions_visible_rate_lane1_delta: currentLane1.directions_visible_rate - baselineLane1.directions_visible_rate,
  };

  const brandMap = new Map();
  for (const row of rows) {
    const market = String(row?.market ?? "").toUpperCase();
    const brandName = String(row?.brandName ?? "").trim();
    const key = `${market}::${brandName}`;
    if (!brandMap.has(key)) {
      brandMap.set(key, {
        market,
        brandName,
        productCount: 0,
        lane1CandidateCount: 0,
        lane1EnforcedCount: 0,
        directionsVisibleAllCount: 0,
        directionsVisibleLane1Count: 0,
      });
    }
    const agg = brandMap.get(key);
    agg.productCount += 1;
    if (row?.lane1_candidate) agg.lane1CandidateCount += 1;
    if (row?.lane1_enforced) agg.lane1EnforcedCount += 1;
    if (row?.current?.directions_visible) agg.directionsVisibleAllCount += 1;
    if (row?.lane1_candidate && row?.current?.directions_visible) agg.directionsVisibleLane1Count += 1;
  }

  const brandDirectionPriority = [...brandMap.values()]
    .map((row) => {
      const directionsVisibleRateAll = row.productCount > 0 ? row.directionsVisibleAllCount / row.productCount : 0;
      const directionsVisibleRateLane1 = row.lane1CandidateCount > 0
        ? row.directionsVisibleLane1Count / row.lane1CandidateCount
        : 0;
      let overallStatus = "no_lane1_candidate";
      if (row.lane1EnforcedCount > 0) {
        overallStatus = directionsVisibleRateLane1 >= 0.9 ? "enforced_and_visible" : "enforced_but_not_visible";
      } else if (row.lane1CandidateCount > 0) {
        overallStatus = "candidate_only";
      }
      const missingLane1Directions = Math.max(0, row.lane1CandidateCount - row.directionsVisibleLane1Count);
      return {
        market: row.market,
        brandName: row.brandName,
        productCount: row.productCount,
        lane1CandidateCount: row.lane1CandidateCount,
        lane1EnforcedCount: row.lane1EnforcedCount,
        directionsVisibleRateAll,
        directionsVisibleRateLane1,
        missingLane1Directions,
        overallStatus,
        priorityScore:
          missingLane1Directions * 0.7
          + (overallStatus === "enforced_but_not_visible" ? 10 : 0)
          + (overallStatus === "candidate_only" ? 6 : 0),
      };
    })
    .filter((row) => row.overallStatus === "candidate_only" || row.overallStatus === "enforced_but_not_visible")
    .sort((a, b) => b.priorityScore - a.priorityScore || b.missingLane1Directions - a.missingLane1Directions);

  return {
    totalProducts: total,
    lane1CandidateProducts: lane1Total,
    rates: { baseline, current, baseline_lane1: baselineLane1, current_lane1: currentLane1 },
    deltas,
    brandDirectionPriority,
  };
};

const pct = (value) => `${(asNumber(value, 0) * 100).toFixed(2)}%`;

const main = async () => {
  const latestNightlyDir = await newestDirByPrefix("v1.6.14-new-top100-nightly-");
  const nightlyDir = resolvePath(getArg("nightly-dir")) || latestNightlyDir;
  if (!nightlyDir) {
    console.error("[build-expansion-wave-evidence] missing nightly dir");
    process.exit(1);
  }

  const batchPlanJson = resolvePath(getArg("batch-plan-json"))
    || path.join(nightlyDir, "phase_d", "step2_batch_plan", "batch_plan.json");
  const batchesDir = resolvePath(getArg("batches-dir"))
    || path.join(nightlyDir, "phase_d", "batches");
  const productImpactJson = resolvePath(getArg("product-impact-json"))
    || path.join(nightlyDir, "next_phase", "new_top100_product_level_ux_impact.json");
  const outDir = resolvePath(getArg("out-dir"))
    || path.join(nightlyDir, "expansion_waves");

  const batchPlan = await readJson(batchPlanJson);
  const productImpact = await readJson(productImpactJson);
  const batches = Array.isArray(batchPlan?.batches) ? batchPlan.batches : [];
  if (batches.length === 0) {
    console.error("[build-expansion-wave-evidence] batch plan has no batches");
    process.exit(1);
  }

  const waveDefs = buildWaveDefinitions(batches, [24, 50, 100]);
  const manifest = [];

  for (const wave of waveDefs) {
    const batchReports = [];
    const waveBrandKeys = new Set();

    for (const batchId of wave.batchIds) {
      const reportPath = path.join(batchesDir, batchId, "batch_gate_report.json");
      const report = await readJson(reportPath);
      batchReports.push(report);
      const planned = batches.find((row) => row.batchId === batchId);
      for (const brandRow of planned?.brandsIncluded ?? []) {
        const market = String(brandRow?.market ?? "").toUpperCase();
        const brandNorm = normalizeBrand(brandRow?.brandNorm ?? brandRow?.brand ?? "");
        if (market && brandNorm) waveBrandKeys.add(`${market}::${brandNorm}`);
      }
    }

    const metrics = aggregateMetrics(batchReports);
    const ux = aggregateUxVisibility(productImpact, waveBrandKeys);

    const metricsSource = {
      generatedAt: new Date().toISOString(),
      waveId: wave.waveId,
      waveName: wave.waveName,
      batchIds: wave.batchIds,
      targetBrands: wave.targetBrands,
      coveredBrands: waveBrandKeys.size,
      ...metrics,
    };
    const uxSummary = {
      generatedAt: new Date().toISOString(),
      waveId: wave.waveId,
      waveName: wave.waveName,
      batchIds: wave.batchIds,
      targetBrands: wave.targetBrands,
      coveredBrands: waveBrandKeys.size,
      ...ux,
      gates: {
        directions_visible_rate_gte_0_90: ux.rates.current.directions_visible_rate >= 0.9,
        best_for_non_regression: ux.rates.current.best_for_visible_rate >= ux.rates.baseline.best_for_visible_rate,
        science_specificity_non_regression: ux.rates.current.science_specificity_rate >= ux.rates.baseline.science_specificity_rate,
        before_you_buy_non_regression: ux.rates.current.before_you_buy_completeness_rate >= ux.rates.baseline.before_you_buy_completeness_rate,
      },
    };

    const metricsPath = path.join(outDir, `wave_${wave.waveId}_metrics_source.json`);
    const uxPath = path.join(outDir, `wave_${wave.waveId}_ux_visibility_summary.json`);
    const uxMdPath = path.join(outDir, `wave_${wave.waveId}_ux_visibility_summary.md`);
    const directionsPriorityPath = path.join(outDir, `wave_${wave.waveId}_directions_priority_queue.json`);
    const directionsPriorityJsonlPath = path.join(outDir, `wave_${wave.waveId}_directions_priority_queue.jsonl`);
    await writeJson(metricsPath, metricsSource);
    await writeJson(uxPath, uxSummary);
    await writeJson(directionsPriorityPath, {
      generatedAt: new Date().toISOString(),
      waveId: wave.waveId,
      waveName: wave.waveName,
      queue: uxSummary.brandDirectionPriority,
    });
    await fs.writeFile(
      directionsPriorityJsonlPath,
      uxSummary.brandDirectionPriority.map((row) => JSON.stringify(row)).join("\n") + (uxSummary.brandDirectionPriority.length ? "\n" : ""),
      "utf8",
    );
    await writeText(
      uxMdPath,
      [
        `# Wave ${wave.waveId} UX Visibility Summary (${wave.waveName})`,
        "",
        `- batches: ${wave.batchIds.join(", ")}`,
        `- coveredBrands: ${waveBrandKeys.size}`,
        `- totalProducts: ${uxSummary.totalProducts}`,
        `- lane1CandidateProducts: ${uxSummary.lane1CandidateProducts}`,
        "",
        "## Current Rates",
        `- best_for_visible_rate: ${pct(uxSummary.rates.current.best_for_visible_rate)}`,
        `- science_specificity_rate: ${pct(uxSummary.rates.current.science_specificity_rate)}`,
        `- before_you_buy_completeness_rate: ${pct(uxSummary.rates.current.before_you_buy_completeness_rate)}`,
        `- formula_explainability_rate: ${pct(uxSummary.rates.current.formula_explainability_rate)}`,
        `- directions_visible_rate: ${pct(uxSummary.rates.current.directions_visible_rate)}`,
        `- directions_visible_rate_on_lane1_candidates: ${pct(uxSummary.rates.current_lane1.directions_visible_rate)}`,
        "",
        "## Deltas vs Baseline",
        `- best_for_visible_rate_delta: ${pct(uxSummary.deltas.best_for_visible_rate_delta)}`,
        `- science_specificity_rate_delta: ${pct(uxSummary.deltas.science_specificity_rate_delta)}`,
        `- before_you_buy_completeness_rate_delta: ${pct(uxSummary.deltas.before_you_buy_completeness_rate_delta)}`,
        `- formula_explainability_rate_delta: ${pct(uxSummary.deltas.formula_explainability_rate_delta)}`,
        `- directions_visible_rate_delta: ${pct(uxSummary.deltas.directions_visible_rate_delta)}`,
        `- directions_visible_rate_lane1_delta: ${pct(uxSummary.deltas.directions_visible_rate_lane1_delta)}`,
        "",
        "## Wave Gates",
        `- directions_visible_rate_gte_0_90: ${uxSummary.gates.directions_visible_rate_gte_0_90}`,
        `- best_for_non_regression: ${uxSummary.gates.best_for_non_regression}`,
        `- science_specificity_non_regression: ${uxSummary.gates.science_specificity_non_regression}`,
        `- before_you_buy_non_regression: ${uxSummary.gates.before_you_buy_non_regression}`,
      ].join("\n") + "\n",
    );

    manifest.push({
      waveId: wave.waveId,
      waveName: wave.waveName,
      metricsSourcePath: metricsPath,
      uxSummaryPath: uxPath,
      directionsPriorityPath,
      directionsPriorityJsonlPath,
      coveredBrands: waveBrandKeys.size,
      batchCount: wave.batchIds.length,
    });
  }

  await writeJson(path.join(outDir, "wave_evidence_manifest.json"), {
    generatedAt: new Date().toISOString(),
    nightlyDir,
    batchPlanJson,
    batchesDir,
    productImpactJson,
    waves: manifest,
  });

  console.log("[build-expansion-wave-evidence] completed");
  console.log(JSON.stringify({
    outDir,
    waves: manifest.map((row) => ({
      waveId: row.waveId,
      waveName: row.waveName,
      batchCount: row.batchCount,
      coveredBrands: row.coveredBrands,
    })),
  }, null, 2));
};

main().catch((error) => {
  console.error("[build-expansion-wave-evidence] failed:", error instanceof Error ? error.stack || error.message : String(error));
  process.exit(1);
});
