#!/usr/bin/env node
/* eslint-disable no-console */

import fs from "node:fs/promises";
import path from "node:path";

const ROOT_DIR = process.cwd();
const OUTPUT_ROOT = path.join(ROOT_DIR, "output");
const args = process.argv.slice(2);

const hasFlag = (flag) => args.includes(`--${flag}`);
const getArg = (flag) => {
  const idx = args.indexOf(`--${flag}`);
  if (idx === -1) return null;
  return args[idx + 1] ?? null;
};

if (hasFlag("help")) {
  console.log(`Usage:
  node scripts/maintainer/evaluate-stage-c-shadow.mjs [options]

Options:
  --stage-c-dir <path>                      Stage C output dir from run-stage-c-final (required unless newest exists)
  --control-seq-dir <path>                  Shadow control sequence dir (Run A: no-patch)
  --patch-seq-dir <path>                    Shadow patch sequence dir (Run B: patch-shadow)
  --focused-probe-diff <path>               Focused probe diff json (default: <stage-c-dir>/focused_probe/focused_probe_diff.json)
  --out-dir <path>                          Output dir (default: <stage-c-dir>/c4_to_c6)
  --max-conflict-rate <num>                 C5 global threshold (default: 0.01)
  --max-conflict-abs <num>                  C5 global threshold (default: 5)
  --min-lane-improvement <num>              Lane enforce threshold (default: 0.20)
  --max-unexpected409-rate <num>            C4.5 anomaly threshold (default: 0.001)
  --min-retry-success-rate <num>            C4.5 anomaly threshold (default: 0.99)
  --max-inline-fallback-rate <num>          C4.5 anomaly threshold (default: 0.001)
  --max-verdict-drift-pp <num>              C4.5 anomaly threshold in pp (default: 5)
`);
  process.exit(0);
}

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
const writeJsonl = async (filePath, rows) => {
  await ensureDir(path.dirname(filePath));
  const body = (Array.isArray(rows) ? rows : [])
    .map((row) => JSON.stringify(row))
    .join("\n");
  await fs.writeFile(filePath, body ? `${body}\n` : "", "utf8");
};
const writeText = async (filePath, body) => {
  await ensureDir(path.dirname(filePath));
  await fs.writeFile(filePath, body, "utf8");
};
const asNumber = (value, fallback = 0) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
};
const clamp01 = (value) => Math.max(0, Math.min(1, asNumber(value, 0)));
const rate = (count, total) => (total > 0 ? count / total : 0);
const pp = (value) => Number((clamp01(value) * 100).toFixed(2));
const relImprovement = (before, after) => {
  if (before <= 0) return 0;
  return (before - after) / before;
};

const tryReadJson = async (filePath) => {
  try {
    return await readJson(filePath);
  } catch {
    return null;
  }
};

const readJsonl = async (filePath) => {
  try {
    const raw = await fs.readFile(filePath, "utf8");
    return raw
      .split("\n")
      .map((line) => line.trim())
      .filter(Boolean)
      .map((line) => JSON.parse(line));
  } catch {
    return [];
  }
};

const listOutputDirsByPrefix = async (prefix) => {
  try {
    const names = await fs.readdir(OUTPUT_ROOT);
    return names.filter((name) => name.startsWith(prefix)).sort();
  } catch {
    return [];
  }
};

const newestOutputDirByPrefix = async (prefix) => {
  const dirs = await listOutputDirsByPrefix(prefix);
  if (dirs.length === 0) return null;
  return path.join(OUTPUT_ROOT, dirs[dirs.length - 1]);
};

const loadRoundsStats = async (seqDir, phase) => {
  const filePath = path.join(seqDir, phase, "rounds_summary.json");
  const report = await tryReadJson(filePath);
  return report?.stats ?? {};
};

const loadObservability = async (seqDir) =>
  tryReadJson(path.join(seqDir, "stable", "decision_support_observability_report.json"));

const loadGateReport = async (seqDir) => {
  const reconcile = await tryReadJson(path.join(seqDir, "gate-reconcile", "gate_full_report.json"));
  if (reconcile) return reconcile;
  return tryReadJson(path.join(seqDir, "stable", "gate_full_report.json"));
};

const loadSequenceReport = async (seqDir) =>
  tryReadJson(path.join(seqDir, "stage_c_sequence_report.json"));

const collectSequenceMetrics = async (seqDir) => {
  const s50Run1 = await loadRoundsStats(seqDir, "s50-run1");
  const s50Run2 = await loadRoundsStats(seqDir, "s50-run2");
  const killer = await loadRoundsStats(seqDir, "killer10");
  const obs = await loadObservability(seqDir);
  const gate = await loadGateReport(seqDir);
  const sequenceReport = await loadSequenceReport(seqDir);
  const obsMetrics = obs?.metrics ?? {};
  return {
    seqDir,
    doneSeenRate: asNumber(s50Run2.doneSeenRate, asNumber(s50Run1.doneSeenRate, 0)),
    scoreVisibleRate: asNumber(s50Run2.scoreVisibleRate, asNumber(s50Run1.scoreVisibleRate, 0)),
    regulatoryRichRate_uniqueBarcode: asNumber(
      s50Run2.regulatoryRichRate_uniqueBarcode,
      asNumber(s50Run1.regulatoryRichRate_uniqueBarcode, 0),
    ),
    killerProductClientTimeoutCount: asNumber(killer.killerProductClientTimeoutCount, 0),
    killerProductSseConnectedButNoDoneCount: asNumber(killer.killerProductSseConnectedButNoDoneCount, 0),
    stableDigestUnexpected409Rate: asNumber(obsMetrics.stableDigestUnexpected409Rate, 0),
    forced409RetrySuccessRate: asNumber(obsMetrics.forced409RetrySuccessRate, 0),
    inlineFallbackProxyRate: asNumber(obsMetrics.inlineFallbackProxyRate, 0),
    authoritativeExpectedButNotFinalCount: asNumber(gate?.authoritativeExpectedButNotFinalCount, 0),
    webFallbackCount: asNumber(gate?.webFallbackCount, 0),
    patchActivationEvidence: sequenceReport?.patchActivationEvidence ?? null,
    sequenceReportPath: path.join(seqDir, "stage_c_sequence_report.json"),
    source: {
      s50Run1: path.join(seqDir, "s50-run1", "rounds_summary.json"),
      s50Run2: path.join(seqDir, "s50-run2", "rounds_summary.json"),
      killer10: path.join(seqDir, "killer10", "rounds_summary.json"),
      observability: path.join(seqDir, "stable", "decision_support_observability_report.json"),
      gateReport: gate
        ? (path.join(seqDir, "gate-reconcile", "gate_full_report.json"))
        : null,
      sequenceReport: path.join(seqDir, "stage_c_sequence_report.json"),
    },
  };
};

const parseLaneId = (laneSelection) => ({
  lane1: laneSelection?.selected_lane_1 ?? "patch_directions_text_v1",
  lane2: laneSelection?.selected_lane_2 ?? null,
});

const laneMetricKey = (laneId) => {
  if (laneId === "patch_directions_text_v1") return "missing_directions_rate";
  if (laneId === "patch_fish_oil_breakdown_v1") return "missing_fish_oil_active_breakdown_rate";
  if (laneId === "patch_vitamin_d_form_v1") return "missing_vitamin_d_form_rate";
  if (laneId === "patch_magnesium_elemental_form_v1") return "missing_magnesium_form_or_elemental_rate";
  if (laneId === "patch_probiotics_strain_cfu_v1") return "missing_probiotics_strain_or_cfu_rate";
  return "unknown_lane_metric";
};

const main = async () => {
  const stageCDir = resolvePath(getArg("stage-c-dir")) || (await newestOutputDirByPrefix("v1.6.12-stage-c-"));
  if (!stageCDir) {
    console.error("[stage-c-shadow-eval] Missing --stage-c-dir and no stage-c output dir found.");
    process.exit(1);
  }
  const controlSeqDir = resolvePath(getArg("control-seq-dir"));
  const patchSeqDir = resolvePath(getArg("patch-seq-dir"));
  if (!controlSeqDir || !patchSeqDir) {
    console.error("[stage-c-shadow-eval] Missing --control-seq-dir or --patch-seq-dir.");
    process.exit(1);
  }

  const outDir = resolvePath(getArg("out-dir")) || path.join(stageCDir, "c4_to_c6");
  const focusedProbeDiffPath =
    resolvePath(getArg("focused-probe-diff"))
    || path.join(stageCDir, "focused_probe", "focused_probe_diff.json");
  const focusedProbeDiff = await tryReadJson(focusedProbeDiffPath);
  if (!focusedProbeDiff) {
    console.error(`[stage-c-shadow-eval] missing focused probe diff: ${focusedProbeDiffPath}`);
    process.exit(1);
  }
  const c4Dir = path.join(outDir, "c4_shadow_apply");
  const c45Dir = path.join(outDir, "c4_5_postfilter");
  const c5Dir = path.join(outDir, "c5_enforce");
  const c6Dir = path.join(outDir, "c6_closeout");
  await ensureDir(c4Dir);
  await ensureDir(c45Dir);
  await ensureDir(c5Dir);
  await ensureDir(c6Dir);

  const thresholds = {
    maxConflictRate: clamp01(getArg("max-conflict-rate") ?? 0.01),
    maxConflictAbs: Math.max(0, asNumber(getArg("max-conflict-abs"), 5)),
    minLaneImprovement: clamp01(getArg("min-lane-improvement") ?? 0.2),
    maxUnexpected409Rate: clamp01(getArg("max-unexpected409-rate") ?? 0.001),
    minRetrySuccessRate: clamp01(getArg("min-retry-success-rate") ?? 0.99),
    maxInlineFallbackRate: clamp01(getArg("max-inline-fallback-rate") ?? 0.001),
    maxVerdictDriftPp: Math.max(0, asNumber(getArg("max-verdict-drift-pp"), 5)),
  };

  const laneSelection = await readJson(path.join(stageCDir, "c1_5_lane_selection", "lane_selection_decision.json"));
  const laneReadinessMatrix = await readJson(path.join(stageCDir, "c1a_top100_census", "lane_readiness_matrix.json"));
  const executionSlice = await readJson(path.join(stageCDir, "c1b_top30_execution_slice", "execution_slice_top30.json"));
  const candidateSummary = await readJson(path.join(stageCDir, "c2_patch_candidates", "stage_c_patch_candidates_summary.json"));
  const conflictQueue = await readJsonl(path.join(stageCDir, "c3_conflict_prefilter", "stage_c_patch_conflicts_queue.jsonl"));
  const filteredCandidates = await readJsonl(path.join(stageCDir, "c3_conflict_prefilter", "stage_c_patch_candidates_filtered.jsonl"));

  const controlMetrics = await collectSequenceMetrics(controlSeqDir);
  const patchMetrics = await collectSequenceMetrics(patchSeqDir);
  const patchActivationEvidence = patchMetrics.patchActivationEvidence ?? {};
  const patchModeConfirmed = Boolean(patchActivationEvidence?.patchModeConfirmed);
  const patchCandidatesHash = patchActivationEvidence?.candidatesHash ?? null;
  const patchRuntimePatchHitCount = Number(patchActivationEvidence?.runtimePatchHitCountAfter ?? 0);
  const laneIds = parseLaneId(laneSelection);

  const totalCandidates = Math.max(1, asNumber(candidateSummary.totalCandidates, filteredCandidates.length + conflictQueue.length));
  const conflictAbs = conflictQueue.length;
  const conflictRate = rate(conflictAbs, totalCandidates);
  const patchAppliedCandidateCount = filteredCandidates.length;
  const candidateCoverageRate = rate(patchAppliedCandidateCount, totalCandidates);
  const selectedProducts = Array.isArray(executionSlice?.selected) ? executionSlice.selected : [];
  const selectedProductCount = Math.max(
    1,
    selectedProducts.reduce((sum, row) => sum + asNumber(row?.product_count, 0), 0),
  );
  const uniquePatchedProducts = new Set(filteredCandidates.map((row) => String(row?.identityKey ?? ""))).size;
  const laneEffectiveCoverageRate = rate(uniquePatchedProducts, selectedProductCount);

  const effectDeltaVsControl = {
    doneSeenRateDeltaPp: Number(((patchMetrics.doneSeenRate - controlMetrics.doneSeenRate) * 100).toFixed(2)),
    scoreVisibleRateDeltaPp: Number(((patchMetrics.scoreVisibleRate - controlMetrics.scoreVisibleRate) * 100).toFixed(2)),
    regulatoryRichRateDeltaPp: Number(((patchMetrics.regulatoryRichRate_uniqueBarcode - controlMetrics.regulatoryRichRate_uniqueBarcode) * 100).toFixed(2)),
    killerProductClientTimeoutDelta: patchMetrics.killerProductClientTimeoutCount - controlMetrics.killerProductClientTimeoutCount,
    killerProductSseConnectedButNoDoneDelta: patchMetrics.killerProductSseConnectedButNoDoneCount - controlMetrics.killerProductSseConnectedButNoDoneCount,
    unexpected409RateDeltaPp: Number(((patchMetrics.stableDigestUnexpected409Rate - controlMetrics.stableDigestUnexpected409Rate) * 100).toFixed(3)),
    inlineFallbackRateDeltaPp: Number(((patchMetrics.inlineFallbackProxyRate - controlMetrics.inlineFallbackProxyRate) * 100).toFixed(3)),
  };

  const c4Report = {
    generatedAt: new Date().toISOString(),
    stageCDir,
    controlSeqDir,
    patchSeqDir,
    patchAppliedCandidateCount,
    laneSelectionDecision: laneSelection?.lane_selection_decision ?? "unknown",
    laneSelectionReason: laneSelection?.lane_selection_reason ?? laneSelection?.selection_reason ?? "unknown",
    laneReadinessSnapshot: laneReadinessMatrix,
    candidateCoverageRate: Number(candidateCoverageRate.toFixed(6)),
    lane_effective_coverage_rate: Number(laneEffectiveCoverageRate.toFixed(6)),
    focusedProbeDelta: focusedProbeDiff?.focusedProbeDelta ?? null,
    patchActivationEvidence: {
      patchModeConfirmed,
      candidatesHash: patchCandidatesHash,
      runtimePatchHitCount: patchRuntimePatchHitCount,
      runtimePatchHitCountDelta: Number(patchActivationEvidence?.runtimePatchHitCountDelta ?? 0),
      sequenceReportPath: patchMetrics.sequenceReportPath,
    },
    patchModeConfirmed,
    candidatesHash: patchCandidatesHash,
    runtimePatchHitCount: patchRuntimePatchHitCount,
    conflictRate: Number(conflictRate.toFixed(6)),
    effect_delta_vs_control: effectDeltaVsControl,
    controlMetrics,
    patchMetrics,
    thresholds,
  };
  await writeJson(path.join(c4Dir, "stage_c_shadow_apply_report.json"), c4Report);

  const globalAnomalyReasons = [];
  if (patchMetrics.stableDigestUnexpected409Rate > thresholds.maxUnexpected409Rate) {
    globalAnomalyReasons.push("digest_unexpected_409_rate_regression");
  }
  if (patchMetrics.forced409RetrySuccessRate < thresholds.minRetrySuccessRate) {
    globalAnomalyReasons.push("digest_retry_success_rate_regression");
  }
  if (patchMetrics.inlineFallbackProxyRate > thresholds.maxInlineFallbackRate) {
    globalAnomalyReasons.push("inline_fallback_proxy_rate_regression");
  }
  if (Math.abs(effectDeltaVsControl.regulatoryRichRateDeltaPp) > thresholds.maxVerdictDriftPp) {
    globalAnomalyReasons.push("verdict_distribution_proxy_drift_regression");
  }
  if (!patchModeConfirmed) {
    globalAnomalyReasons.push("patch_shadow_mode_not_confirmed");
  }

  const postfilterRejects = [];
  const enforceReady = [];
  for (const row of filteredCandidates) {
    const rejectReasons = [];
    const confidence = asNumber(row?.confidence, 0);
    const hasEvidence = Boolean(row?.context?.scannedLabelEvidenceAvailable);
    if (!hasEvidence) rejectReasons.push("evidence_unstable_missing_scanned_label");
    if (confidence < 0.65) rejectReasons.push("evidence_unstable_low_confidence");
    if ((row?.laneId === laneIds.lane2) && globalAnomalyReasons.length > 0) {
      rejectReasons.push("global_stability_guard_lane2");
    }
    if (rejectReasons.length > 0) {
      postfilterRejects.push({
        ...row,
        status: "postfilter_rejected",
        rejectReasons,
      });
    } else {
      enforceReady.push({
        ...row,
        status: "enforce_ready",
      });
    }
  }
  await writeJsonl(path.join(c45Dir, "stage_c_patch_postfilter_rejects.jsonl"), postfilterRejects);
  await writeJsonl(path.join(c45Dir, "stage_c_patch_enforce_ready.jsonl"), enforceReady);

  const ttlComplete = enforceReady.every((row) =>
    Boolean(String(row?.expiresAt ?? "").trim()) && asNumber(row?.reviewAfterDays, 0) > 0);
  const stabilityNoRegression =
    patchMetrics.doneSeenRate >= controlMetrics.doneSeenRate
    && patchMetrics.killerProductClientTimeoutCount <= controlMetrics.killerProductClientTimeoutCount
    && patchMetrics.killerProductSseConnectedButNoDoneCount <= controlMetrics.killerProductSseConnectedButNoDoneCount
    && patchMetrics.authoritativeExpectedButNotFinalCount <= controlMetrics.authoritativeExpectedButNotFinalCount;
  const globalPreconditions = {
    conflictRatePass: conflictRate <= thresholds.maxConflictRate,
    conflictAbsPass: conflictAbs <= thresholds.maxConflictAbs,
    stabilityPass: stabilityNoRegression,
    ttlCompletePass: ttlComplete,
  };
  const globalPass = Object.values(globalPreconditions).every(Boolean);

  const lane1Before = asNumber(candidateSummary?.lane1?.candidateCount, 0);
  const lane2Before = asNumber(candidateSummary?.lane2?.candidateCount, 0);
  // Lane improvement is based on unresolved candidates after prefilter+postfilter.
  // This matches Stage C lane-by-lane intent: unresolved should go down.
  const unresolvedForLane = (laneId) => {
    if (!laneId) return 0;
    const conflictCount = conflictQueue.filter((row) => row?.laneId === laneId).length;
    const rejectCount = postfilterRejects.filter((row) => row?.laneId === laneId).length;
    return conflictCount + rejectCount;
  };
  const lane1After = unresolvedForLane(laneIds.lane1);
  const lane2After = laneIds.lane2 ? unresolvedForLane(laneIds.lane2) : 0;
  const lane1Resolved = Math.max(0, lane1Before - lane1After);
  const lane2Resolved = Math.max(0, lane2Before - lane2After);
  const lane1Improvement = relImprovement(lane1Before, lane1After);
  const lane2Improvement = relImprovement(lane2Before, lane2After);

  const laneDecisions = [
    {
      laneId: laneIds.lane1,
      metricKey: laneMetricKey(laneIds.lane1),
      beforeCount: lane1Before,
      resolvedCount: lane1Resolved,
      unresolvedCount: lane1After,
      afterCount: lane1After,
      improvementRate: Number(lane1Improvement.toFixed(6)),
      improvementRatePp: Number((lane1Improvement * 100).toFixed(2)),
      meetsImprovement: lane1Improvement >= thresholds.minLaneImprovement,
      enforce: globalPass && lane1Improvement >= thresholds.minLaneImprovement && lane1Before > 0,
      reasons: [],
    },
    laneIds.lane2
      ? {
        laneId: laneIds.lane2,
        metricKey: laneMetricKey(laneIds.lane2),
        beforeCount: lane2Before,
        resolvedCount: lane2Resolved,
        unresolvedCount: lane2After,
        afterCount: lane2After,
        improvementRate: Number(lane2Improvement.toFixed(6)),
        improvementRatePp: Number((lane2Improvement * 100).toFixed(2)),
        meetsImprovement: lane2Improvement >= thresholds.minLaneImprovement,
        enforce: globalPass && lane2Improvement >= thresholds.minLaneImprovement && lane2Before > 0,
        reasons: [],
      }
      : {
        laneId: "none",
        metricKey: "not_enabled",
        beforeCount: 0,
        resolvedCount: 0,
        unresolvedCount: 0,
        afterCount: 0,
        improvementRate: 0,
        improvementRatePp: 0,
        meetsImprovement: false,
        enforce: false,
        reasons: ["lane2_not_selected_in_c1_5"],
      },
  ];
  for (const decision of laneDecisions) {
    if (decision.enforce) continue;
    if (!globalPreconditions.conflictRatePass) decision.reasons.push("global_conflict_rate_exceeded");
    if (!globalPreconditions.conflictAbsPass) decision.reasons.push("global_conflict_abs_exceeded");
    if (!globalPreconditions.stabilityPass) decision.reasons.push("global_stability_regression");
    if (!globalPreconditions.ttlCompletePass) decision.reasons.push("global_ttl_missing");
    if (!decision.meetsImprovement && decision.laneId !== "none") decision.reasons.push("lane_improvement_below_threshold");
  }

  const c5Report = {
    generatedAt: new Date().toISOString(),
    thresholds,
    globalPreconditions,
    globalPass,
    laneDecisions,
    lane_effective_coverage_rate: Number(laneEffectiveCoverageRate.toFixed(6)),
  };
  await writeJson(path.join(c5Dir, "stage_c_lane_enforce_decision.json"), c5Report);

  const laneResults = {
    lane1_directions: {
      laneId: laneIds.lane1,
      eligible: lane1Before > 0,
      improvementRate: Number(lane1Improvement.toFixed(6)),
      enforceDecision:
        laneDecisions.find((row) => row.laneId === laneIds.lane1)?.enforce === true ? "pass" : "hold",
      reason:
        laneDecisions.find((row) => row.laneId === laneIds.lane1)?.reasons?.join("|") || null,
    },
    lane2_dynamic: {
      laneId: laneIds.lane2 ?? "none",
      eligible: lane2Before > 0,
      improvementRate: Number(lane2Improvement.toFixed(6)),
      enforceDecision:
        laneDecisions.find((row) => row.laneId === laneIds.lane2)?.enforce === true ? "pass" : "hold",
      reason:
        laneDecisions.find((row) => row.laneId === laneIds.lane2)?.reasons?.join("|")
        || (laneIds.lane2 ? null : "lane2_not_selected"),
    },
  };

  const fixableQueue = [];
  const ceilingQueue = [];
  const pushFixable = (row, breachType, reason) => {
    fixableQueue.push({
      barcode: row?.barcode_gtin14 ?? null,
      identityKey: row?.identityKey ?? null,
      laneId: row?.laneId ?? null,
      breachType,
      reasonCode: reason,
      owner: "unassigned",
      status: "open",
      targetRelease: "v1.6.12-stage-c-followup",
    });
  };
  const pushCeiling = (row, reason) => {
    ceilingQueue.push({
      barcode: row?.barcode_gtin14 ?? null,
      identityKey: row?.identityKey ?? null,
      laneId: row?.laneId ?? null,
      reasonCode: reason,
      owner: "unassigned",
      status: "open",
      targetRelease: "v1.6.12-stage-c-followup",
    });
  };

  for (const row of conflictQueue) {
    if (row?.conflictReason === "missing_scanned_label_evidence") {
      pushCeiling(row, "ceiling_missing_scanned_label_evidence");
    } else {
      pushFixable(row, "conflict_prefilter", row?.conflictReason ?? "unknown_conflict");
    }
  }
  for (const row of postfilterRejects) {
    const reasons = Array.isArray(row?.rejectReasons) ? row.rejectReasons : [];
    if (reasons.some((reason) => String(reason).includes("missing_scanned_label"))) {
      pushCeiling(row, "ceiling_missing_scanned_label_evidence");
    } else {
      pushFixable(row, "postfilter_reject", reasons.join("|") || "postfilter_reject");
    }
  }
  for (const lane of laneDecisions) {
    if (!lane.enforce && lane.laneId !== "none") {
      fixableQueue.push({
        barcode: null,
        identityKey: null,
        laneId: lane.laneId,
        breachType: "lane_not_enforced",
        reasonCode: lane.reasons.join("|") || "unknown",
        owner: "unassigned",
        status: "open",
        targetRelease: "v1.6.12-stage-c-followup",
      });
    }
  }

  const gatePass =
    laneDecisions.find((row) => row.laneId === laneIds.lane1)?.enforce === true
    && globalPass
    && patchMetrics.authoritativeExpectedButNotFinalCount === 0
    && patchModeConfirmed;

  const stageCGateReport = {
    generatedAt: new Date().toISOString(),
    pass: gatePass,
    stageCDir,
    controlSeqDir,
    patchSeqDir,
    c4: c4Report,
    c4_5: {
      rejectCount: postfilterRejects.length,
      enforceReadyCount: enforceReady.length,
      globalAnomalyReasons,
    },
    c5: c5Report,
    laneResults,
    laneSelectionDecision: laneSelection?.lane_selection_decision ?? "unknown",
    laneSelectionReason: laneSelection?.lane_selection_reason ?? laneSelection?.selection_reason ?? "unknown",
    focusedProbeDelta: focusedProbeDiff?.focusedProbeDelta ?? null,
    patchActivationEvidence: {
      patchModeConfirmed,
      candidatesHash: patchCandidatesHash,
      runtimePatchHitCount: patchRuntimePatchHitCount,
      runtimePatchHitCountDelta: Number(patchActivationEvidence?.runtimePatchHitCountDelta ?? 0),
      sequenceReportPath: patchMetrics.sequenceReportPath,
      focusedProbeDiffPath,
    },
    metrics: {
      lane_effective_coverage_rate: Number(laneEffectiveCoverageRate.toFixed(6)),
      conflict_rate: Number(conflictRate.toFixed(6)),
      conflict_abs: conflictAbs,
      lane1_improvement_rate: Number(lane1Improvement.toFixed(6)),
      lane2_improvement_rate: Number(lane2Improvement.toFixed(6)),
      doneSeenRate_control: controlMetrics.doneSeenRate,
      doneSeenRate_patch: patchMetrics.doneSeenRate,
      scoreVisibleRate_control: controlMetrics.scoreVisibleRate,
      scoreVisibleRate_patch: patchMetrics.scoreVisibleRate,
      regulatoryRichRate_control: controlMetrics.regulatoryRichRate_uniqueBarcode,
      regulatoryRichRate_patch: patchMetrics.regulatoryRichRate_uniqueBarcode,
    },
    outputs: {
      fixableQueuePath: path.join(c6Dir, "stage_c_fixable_repair_queue.jsonl"),
      ceilingQueuePath: path.join(c6Dir, "stage_c_ceiling_explain_queue.jsonl"),
      focusedProbeDiffPath,
    },
  };

  await writeJson(path.join(c6Dir, "stage_c_gate_report.json"), stageCGateReport);
  await writeJsonl(path.join(c6Dir, "stage_c_fixable_repair_queue.jsonl"), fixableQueue);
  await writeJsonl(path.join(c6Dir, "stage_c_ceiling_explain_queue.jsonl"), ceilingQueue);

  const gateMd = [
    "# Stage C Gate Report",
    "",
    `- pass: ${gatePass}`,
    `- lane1 (${laneIds.lane1}) enforce: ${laneDecisions.find((row) => row.laneId === laneIds.lane1)?.enforce === true}`,
    `- lane2 (${laneIds.lane2 ?? "none"}) enforce: ${laneDecisions.find((row) => row.laneId === laneIds.lane2)?.enforce === true}`,
    `- conflict_rate: ${pp(conflictRate)}%`,
    `- conflict_abs: ${conflictAbs}`,
    `- lane_effective_coverage_rate: ${pp(laneEffectiveCoverageRate)}%`,
    "",
    "## Global Preconditions",
    "",
    ...Object.entries(globalPreconditions).map(([key, value]) => `- ${key}: ${value}`),
    "",
    "## Lane Decisions",
    "",
    ...laneDecisions.map((row) =>
      `- ${row.laneId}: enforce=${row.enforce}, improvement=${row.improvementRatePp}%${row.reasons.length > 0 ? `, reasons=${row.reasons.join(",")}` : ""}`),
    "",
  ].join("\n");
  await writeText(path.join(c6Dir, "stage_c_gate_report.md"), gateMd);

  const releaseNote = [
    "# Stage C Release Note",
    "",
    `Generated: ${new Date().toISOString()}`,
    "",
    "## Scope",
    "- lane1 fixed directions lane",
    `- lane2 dynamic lane: ${laneIds.lane2 ?? "none"}`,
    "- patch source tier writable: scanned_label only",
    "",
    "## Outcome",
    `- pass: ${gatePass}`,
    `- fixable_queue_count: ${fixableQueue.length}`,
    `- ceiling_queue_count: ${ceilingQueue.length}`,
    "",
    "## Safety",
    `- conflict_rate: ${pp(conflictRate)}%`,
    `- digest_unexpected_409_rate: ${pp(patchMetrics.stableDigestUnexpected409Rate)}%`,
    `- retry_success_rate: ${pp(patchMetrics.forced409RetrySuccessRate)}%`,
    `- inline_fallback_rate: ${pp(patchMetrics.inlineFallbackProxyRate)}%`,
    "",
  ].join("\n");
  await writeText(path.join(c6Dir, "stage_c_release_note.md"), releaseNote);

  console.log("[stage-c-shadow-eval] completed");
  console.log(
    JSON.stringify(
      {
        pass: gatePass,
        lane1: laneIds.lane1,
        lane2: laneIds.lane2,
        lane1Enforce: laneDecisions.find((row) => row.laneId === laneIds.lane1)?.enforce === true,
        lane2Enforce: laneDecisions.find((row) => row.laneId === laneIds.lane2)?.enforce === true,
        laneEffectiveCoverageRate: Number(laneEffectiveCoverageRate.toFixed(6)),
      },
      null,
      2,
    ),
  );
};

main().catch((error) => {
  console.error("[stage-c-shadow-eval] failed:", error instanceof Error ? error.stack || error.message : String(error));
  process.exit(1);
});
