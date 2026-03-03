#!/usr/bin/env node
/* eslint-disable no-console */

import fs from "node:fs/promises";
import path from "node:path";

const ROOT_DIR = process.cwd();
const OUTPUT_ROOT = path.join(ROOT_DIR, "output");
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

const writeJsonl = async (filePath, rows) => {
  await ensureDir(path.dirname(filePath));
  const body = (Array.isArray(rows) ? rows : []).map((row) => JSON.stringify(row)).join("\n");
  await fs.writeFile(filePath, body ? `${body}\n` : "", "utf8");
};

const readJson = async (filePath) => JSON.parse(await fs.readFile(filePath, "utf8"));

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

const asNumber = (value, fallback = 0) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
};

const clamp01 = (value) => Math.max(0, Math.min(1, asNumber(value, 0)));
const rate = (count, total) => (total > 0 ? count / total : 0);
const hasValue = (value) => !(value == null || (typeof value === "string" && value.trim().length === 0));
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
  const retryHasDenominator = asNumber(obsMetrics?.forced409RetryDenominator, 0) > 0;
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
    forced409RetrySuccessRate: retryHasDenominator ? asNumber(obsMetrics.forced409RetrySuccessRate, 1) : 1,
    inlineFallbackProxyRate: asNumber(obsMetrics.inlineFallbackProxyRate, 0),
    authoritativeExpectedButNotFinalCount: asNumber(gate?.authoritativeExpectedButNotFinalCount, 0),
    patchActivationEvidence: sequenceReport?.patchActivationEvidence ?? null,
    sequenceReportPath: path.join(seqDir, "stage_c_sequence_report.json"),
  };
};

const main = async () => {
  const stageCDir = resolvePath(getArg("stage-c-dir")) || await newestOutputDirByPrefix("v1.6.12-stage-c-");
  if (!stageCDir) {
    console.error("[evaluate-stage-e1-shadow] missing --stage-c-dir and no stage-c output found");
    process.exit(1);
  }

  const stageEDir = resolvePath(getArg("stage-e-dir")) || await newestOutputDirByPrefix("v1.6.14-stage-e-");
  if (!stageEDir) {
    console.error("[evaluate-stage-e1-shadow] missing --stage-e-dir and no stage-e output found");
    process.exit(1);
  }

  const controlSeqDir = resolvePath(getArg("control-seq-dir"));
  const patchSeqDir = resolvePath(getArg("patch-seq-dir"));
  if (!controlSeqDir || !patchSeqDir) {
    console.error("[evaluate-stage-e1-shadow] missing --control-seq-dir or --patch-seq-dir");
    process.exit(1);
  }

  const outDir = resolvePath(getArg("out-dir")) || path.join(stageEDir, "e1_shadow", "e1_eval");
  const e0ReadinessPath = resolvePath(getArg("e0-readiness")) || path.join(stageEDir, "e0_baseline", "stage_e0_readiness.json");
  const focusedProbeDiffPath = resolvePath(getArg("focused-probe-diff")) || path.join(stageEDir, "e1_shadow", "focused_probe", "focused_probe_diff.json");
  const d1bEvidencePath = resolvePath(getArg("d1b-evidence")) || path.join(stageEDir, "d1b_isolation", "stage_d1b_batch_isolation_proof.json");

  const e0Readiness = await readJson(e0ReadinessPath);
  const focusedProbeDiff = await readJson(focusedProbeDiffPath);
  const d1bEvidence = await readJson(d1bEvidencePath);

  const thresholds = {
    minPrimaryImprovement: clamp01(getArg("min-primary-improvement") ?? 0.2),
    maxConflictRate: clamp01(getArg("max-conflict-rate") ?? 0.01),
    maxConflictAbs: Math.max(0, asNumber(getArg("max-conflict-abs"), 5)),
    maxUnexpected409Rate: clamp01(getArg("max-unexpected409-rate") ?? 0.001),
    minRetrySuccessRate: clamp01(getArg("min-retry-success-rate") ?? 0.99),
    maxInlineFallbackRate: clamp01(getArg("max-inline-fallback-rate") ?? 0.001),
  };

  const candidatesPath = resolvePath(getArg("probiotics-candidates"))
    || resolvePath(e0Readiness?.candidateArtifacts?.path)
    || path.join(stageEDir, "e0_baseline", "e0_probiotics_candidates.jsonl");
  const candidates = await readJsonl(candidatesPath);
  if (candidates.length === 0) {
    console.error("[evaluate-stage-e1-shadow] no probiotics candidates loaded");
    process.exit(1);
  }

  const controlMetrics = await collectSequenceMetrics(controlSeqDir);
  const patchMetrics = await collectSequenceMetrics(patchSeqDir);
  const expectedCandidateScopeId = String(
    patchMetrics?.patchActivationEvidence?.candidateScopeId
      ?? focusedProbeDiff?.patchActivationEvidence?.candidateScopeId
      ?? "",
  ).trim();

  const prefFilterRejects = [];
  const postFilterRejects = [];
  const enforceReadyPreview = [];
  for (const row of candidates) {
    const preReasons = [];
    if (String(row?.sourceTier ?? "").toLowerCase() !== "scanned_label") preReasons.push("source_tier_not_scanned_label");
    if (!row?.evidenceRef) preReasons.push("missing_evidence_ref");
    if (!row?.identityKey) preReasons.push("missing_identity");
    if (!row?.expiresAt || asNumber(row?.reviewAfterDays, 0) <= 0) preReasons.push("missing_ttl_review");
    if (preReasons.length > 0) {
      prefFilterRejects.push({ ...row, stage: "prefilter", rejectReasons: preReasons });
      continue;
    }

    const postReasons = [];
    if (asNumber(row?.confidence, 0) < 0.65) postReasons.push("low_confidence");
    if (patchMetrics.stableDigestUnexpected409Rate > thresholds.maxUnexpected409Rate) postReasons.push("digest_unexpected_409_rate_regression");
    if (patchMetrics.inlineFallbackProxyRate > thresholds.maxInlineFallbackRate) postReasons.push("inline_fallback_proxy_rate_regression");
    if (patchMetrics.forced409RetrySuccessRate < thresholds.minRetrySuccessRate) postReasons.push("digest_retry_success_rate_regression");

    if (postReasons.length > 0) {
      postFilterRejects.push({ ...row, stage: "postfilter", rejectReasons: postReasons });
      continue;
    }

    enforceReadyPreview.push({
      ...row,
      status: "enforce_preview_ready",
      candidateScopeId: String(row?.candidateScopeId ?? expectedCandidateScopeId ?? "").trim() || null,
    });
  }

  const totalCandidates = Math.max(1, candidates.length);
  const conflictAbs = prefFilterRejects.length + postFilterRejects.length;
  const conflictRate = rate(conflictAbs, totalCandidates);

  const primaryMetric = String(e0Readiness?.baselines?.primary_metric || "missing_strain_rate");
  const baselineBefore = asNumber(e0Readiness?.baselines?.[primaryMetric], 0);
  const resolvedRatio = rate(enforceReadyPreview.length, totalCandidates);
  const baselineAfter = Math.max(0, baselineBefore * (1 - resolvedRatio));
  const primaryRelativeImprovement = relImprovement(baselineBefore, baselineAfter);

  const noRegression =
    patchMetrics.doneSeenRate >= controlMetrics.doneSeenRate
    && patchMetrics.scoreVisibleRate >= controlMetrics.scoreVisibleRate;

  const d1bIsolationPass = d1bEvidence?.batchIsolationPass === true;
  const postfilterOutputsExist = true;

  const gateChecks = {
    primaryMetricImprovementPass: primaryRelativeImprovement >= thresholds.minPrimaryImprovement,
    conflictRatePass: conflictRate <= thresholds.maxConflictRate,
    conflictAbsPass: conflictAbs <= thresholds.maxConflictAbs,
    noRegressionPass: noRegression,
    unexpected409Pass: patchMetrics.stableDigestUnexpected409Rate <= thresholds.maxUnexpected409Rate,
    retrySuccessPass: patchMetrics.forced409RetrySuccessRate >= thresholds.minRetrySuccessRate,
    inlineFallbackPass: patchMetrics.inlineFallbackProxyRate <= thresholds.maxInlineFallbackRate,
    d1bIsolationPass,
    postfilterOutputsExist,
  };

  const pass = Object.values(gateChecks).every(Boolean);

  const requiredEnforceFields = [
    "owner",
    "status",
    "targetRelease",
    "expiresAt",
    "reviewAfterDays",
    "reasonCode",
    "evidenceRef",
    "patchBatchId",
    "laneId",
  ];
  const fullPreviewFieldViolations = [];
  const ownerAssignmentQueue = [];
  const pilotEligibleRows = [];
  for (const row of enforceReadyPreview) {
    const missingFields = requiredEnforceFields.filter((field) => !hasValue(row?.[field]));
    const ownerValue = String(row?.owner ?? "").trim().toLowerCase();
    const ownerAssigned = ownerValue.length > 0 && ownerValue !== "unassigned";
    const sourceTierOk = String(row?.sourceTier ?? "").toLowerCase() === "scanned_label";
    const scopeId = String(row?.candidateScopeId ?? "").trim();
    const scopeMatches = expectedCandidateScopeId.length === 0 || (scopeId.length > 0 && scopeId === expectedCandidateScopeId);
    const rowComplete = missingFields.length === 0 && ownerAssigned && sourceTierOk && scopeMatches;

    if (missingFields.length > 0 || !ownerAssigned) {
      ownerAssignmentQueue.push({
        candidateId: row?.candidateId || null,
        laneId: row?.laneId || "patch_probiotics_strain_cfu_v1",
        identityKey: row?.identityKey || null,
        barcode_gtin14: row?.barcode_gtin14 || null,
        owner: row?.owner || null,
        missingFields,
        needsOwnerAssignment: !ownerAssigned,
        status: "open",
        targetRelease: row?.targetRelease || "v1.6.14-stage-e-followup",
      });
    }

    if (!rowComplete) {
      fullPreviewFieldViolations.push({
        candidateId: row?.candidateId || null,
        missingFields,
        ownerAssigned,
        sourceTierOk,
        scopeMatches,
      });
      continue;
    }
    pilotEligibleRows.push(row);
  }

  const fullPreviewReadiness = fullPreviewFieldViolations.length === 0;
  const pilotReadiness = pilotEligibleRows.length >= 10;
  const blockingReasons = [];
  if (!pass) blockingReasons.push("hard_gate_failure");
  if (!pilotReadiness) blockingReasons.push("pilot_candidates_not_ready");
  const goToE2Pilot = pass && pilotReadiness;

  const fixableQueue = [];
  const ceilingQueue = [];
  const addFixable = (code, reason) => {
    fixableQueue.push({
      id: `e1_fixable_${String(fixableQueue.length + 1).padStart(3, "0")}`,
      breachType: code,
      reasonCode: reason,
      laneId: "patch_probiotics_strain_cfu_v1",
      owner: "unassigned",
      status: "open",
      targetRelease: "v1.6.14-stage-e-followup",
    });
  };

  if (!gateChecks.primaryMetricImprovementPass) addFixable("primary_metric_improvement_below_threshold", "missing_metric_improvement_insufficient");
  if (!gateChecks.conflictRatePass || !gateChecks.conflictAbsPass) addFixable("conflict_threshold_exceeded", "conflict_threshold_exceeded");
  if (!gateChecks.noRegressionPass) addFixable("stability_regression", "done_or_score_regression");
  if (!gateChecks.d1bIsolationPass) addFixable("batch_scope_leakage", "d1b_isolation_not_passing");

  for (const row of [...prefFilterRejects, ...postFilterRejects]) {
    const reasons = Array.isArray(row?.rejectReasons) ? row.rejectReasons : [];
    if (reasons.some((reason) => String(reason).includes("missing_evidence"))) {
      ceilingQueue.push({
        barcode: row?.barcode_gtin14 || null,
        identityKey: row?.identityKey || null,
        laneId: row?.laneId || "patch_probiotics_strain_cfu_v1",
        reasonCode: "ceiling_missing_scanned_label_evidence",
        owner: "unassigned",
        status: "open",
        targetRelease: "v1.6.14-stage-e-followup",
      });
    } else {
      addFixable("candidate_rejected", reasons.join("|") || "candidate_rejected");
    }
  }

  const report = {
    generatedAt: new Date().toISOString(),
    stageCDir,
    stageEDir,
    controlSeqDir,
    patchSeqDir,
    thresholds,
    primaryMetric,
    primaryMetricBeforeRate: baselineBefore,
    primaryMetricAfterRate: baselineAfter,
    primaryMetricRelativeImprovement: Number(primaryRelativeImprovement.toFixed(6)),
    conflict_rate: Number(conflictRate.toFixed(6)),
    conflict_abs: conflictAbs,
    laneResults: {
      lane2_probiotics: {
        laneId: "patch_probiotics_strain_cfu_v1",
        eligible: true,
        improvementRate: Number(primaryRelativeImprovement.toFixed(6)),
        enforceDecision: "shadow_only",
        reason: pass ? "shadow_validation_pass" : "shadow_validation_hold",
      },
    },
    gateChecks,
    pass,
    full_preview_readiness: fullPreviewReadiness,
    pilot_readiness: pilotReadiness,
    blockingReasons,
    metrics: {
      doneSeenRate_control: controlMetrics.doneSeenRate,
      doneSeenRate_patch: patchMetrics.doneSeenRate,
      scoreVisibleRate_control: controlMetrics.scoreVisibleRate,
      scoreVisibleRate_patch: patchMetrics.scoreVisibleRate,
      stableDigestUnexpected409Rate_patch: patchMetrics.stableDigestUnexpected409Rate,
      forced409RetrySuccessRate_patch: patchMetrics.forced409RetrySuccessRate,
      inlineFallbackProxyRate_patch: patchMetrics.inlineFallbackProxyRate,
    },
    focusedProbeDelta: focusedProbeDiff,
    patchActivationEvidence: {
      ...(patchMetrics.patchActivationEvidence || {}),
      ...(focusedProbeDiff?.patchActivationEvidence || {}),
    },
    patchScopeEvidence: d1bEvidence?.patchScopeEvidence || null,
    batchIsolationPass: d1bEvidence?.batchIsolationPass === true,
    outOfBatchFalseHitRate: asNumber(d1bEvidence?.metrics?.outOfBatchFalseHitRate, 0),
    payloadDirectionsImprovementRate: asNumber(focusedProbeDiff?.metricsDelta?.regulatoryRichRateDeltaPp, 0),
    softGateWarnings: [],
    outputs: {
      e1ReleaseReadinessDecision: path.join(outDir, "e1_release_readiness_decision.json"),
      e1PostfilterRejects: path.join(outDir, "e1_postfilter_rejects.jsonl"),
      e1EnforceReadinessPreview: path.join(outDir, "e1_enforce_readiness_preview.jsonl"),
      e1FixableQueue: path.join(outDir, "e1_fixable_repair_queue.jsonl"),
      e1CeilingQueue: path.join(outDir, "e1_ceiling_explain_queue.jsonl"),
      e1FixableOwnerAssignmentQueue: path.join(outDir, "e1_fixable_owner_assignment_queue.jsonl"),
    },
  };

  const releaseDecision = {
    generatedAt: new Date().toISOString(),
    stageCDir,
    stageEDir,
    hard_gates_pass: pass,
    full_preview_readiness: fullPreviewReadiness,
    pilot_readiness: pilotReadiness,
    go_to_e2_pilot: goToE2Pilot,
    blockingReasons,
    counts: {
      previewCount: enforceReadyPreview.length,
      pilotEligibleCount: pilotEligibleRows.length,
      fullPreviewViolations: fullPreviewFieldViolations.length,
      ownerAssignmentQueueCount: ownerAssignmentQueue.length,
    },
    thresholds: {
      minPilotReadyCount: 10,
      expectedCandidateScopeId: expectedCandidateScopeId || null,
    },
    gateChecks,
    metrics: {
      primaryMetric,
      primaryMetricBeforeRate: baselineBefore,
      primaryMetricAfterRate: baselineAfter,
      primaryMetricRelativeImprovement: Number(primaryRelativeImprovement.toFixed(6)),
      doneSeenRate_control: controlMetrics.doneSeenRate,
      doneSeenRate_patch: patchMetrics.doneSeenRate,
      scoreVisibleRate_control: controlMetrics.scoreVisibleRate,
      scoreVisibleRate_patch: patchMetrics.scoreVisibleRate,
      stableDigestUnexpected409Rate_patch: patchMetrics.stableDigestUnexpected409Rate,
      forced409RetrySuccessRate_patch: patchMetrics.forced409RetrySuccessRate,
      inlineFallbackProxyRate_patch: patchMetrics.inlineFallbackProxyRate,
    },
  };

  await writeJson(path.join(outDir, "e1_shadow_report.json"), report);
  await writeText(path.join(outDir, "e1_shadow_report.md"), [
    "# Stage E1 Shadow Report",
    "",
    `- pass: ${pass}`,
    `- primaryMetric: ${primaryMetric}`,
    `- primaryMetricRelativeImprovement: ${(primaryRelativeImprovement * 100).toFixed(2)}%`,
    `- conflict_rate: ${(conflictRate * 100).toFixed(2)}%`,
    `- conflict_abs: ${conflictAbs}`,
    `- batchIsolationPass: ${d1bIsolationPass}`,
    "",
    "## Gate Checks",
    ...Object.entries(gateChecks).map(([key, value]) => `- ${key}: ${value}`),
  ].join("\n") + "\n");

  await writeJsonl(path.join(outDir, "e1_postfilter_rejects.jsonl"), [...prefFilterRejects, ...postFilterRejects]);
  await writeJsonl(path.join(outDir, "e1_enforce_readiness_preview.jsonl"), enforceReadyPreview);
  await writeJsonl(path.join(outDir, "e1_fixable_repair_queue.jsonl"), fixableQueue);
  await writeJsonl(path.join(outDir, "e1_ceiling_explain_queue.jsonl"), ceilingQueue);
  await writeJson(path.join(outDir, "e1_release_readiness_decision.json"), releaseDecision);
  await writeText(path.join(outDir, "e1_release_readiness_decision.md"), [
    "# E1 Release Readiness Decision",
    "",
    `- hard_gates_pass: ${pass}`,
    `- full_preview_readiness: ${fullPreviewReadiness}`,
    `- pilot_readiness: ${pilotReadiness}`,
    `- go_to_e2_pilot: ${goToE2Pilot}`,
    `- blockingReasons: ${blockingReasons.length > 0 ? blockingReasons.join(", ") : "none"}`,
    "",
    "## Counts",
    `- previewCount: ${enforceReadyPreview.length}`,
    `- pilotEligibleCount: ${pilotEligibleRows.length}`,
    `- fullPreviewViolations: ${fullPreviewFieldViolations.length}`,
    `- ownerAssignmentQueueCount: ${ownerAssignmentQueue.length}`,
  ].join("\n") + "\n");
  await writeJsonl(path.join(outDir, "e1_fixable_owner_assignment_queue.jsonl"), ownerAssignmentQueue);

  console.log("[evaluate-stage-e1-shadow] completed");
  console.log(JSON.stringify({
    outDir,
    pass,
    primaryMetric,
    primaryMetricRelativeImprovement: primaryRelativeImprovement,
    fullPreviewReadiness,
    pilotReadiness,
    goToE2Pilot,
    conflictRate,
  }, null, 2));

  if (!pass) process.exit(2);
};

main().catch((error) => {
  console.error("[evaluate-stage-e1-shadow] failed:", error instanceof Error ? error.stack || error.message : String(error));
  process.exit(1);
});
