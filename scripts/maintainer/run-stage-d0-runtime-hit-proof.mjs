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
  if (value == null || value === "") return fallback;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
};

const toRate = (count, total) => (total > 0 ? Number((count / total).toFixed(6)) : 0);

const normalizeIdentity = (value) => String(value ?? "").trim().toLowerCase();
const LANE1_ID = "patch_directions_text_v1";

const laneHitCount = (statusJson, laneId) =>
  asNumber(statusJson?.runtimePatchHitCountByLane?.[laneId], 0);

const laneLastIdentity = (statusJson, laneId) =>
  normalizeIdentity(statusJson?.runtimePatchLastMatchedIdentityByLane?.[laneId] ?? null);

const buildHeaders = ({ regressionToken, bearerToken }) => {
  const headers = {
    Accept: "application/json",
  };
  if (regressionToken) headers["x-regression-token"] = regressionToken;
  if (bearerToken) headers.Authorization = `Bearer ${bearerToken}`;
  return headers;
};

const fetchJson = async (url, headers, timeoutMs) => {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, { headers, signal: controller.signal });
    const text = await response.text();
    let json = null;
    try {
      json = text ? JSON.parse(text) : null;
    } catch {
      json = null;
    }
    return {
      ok: response.ok,
      status: response.status,
      json,
      raw: text,
    };
  } catch (error) {
    return {
      ok: false,
      status: 0,
      json: { error: error instanceof Error ? error.message : String(error) },
      raw: "",
    };
  } finally {
    clearTimeout(timer);
  }
};

const hasMissingDirectionsSignal = (payload) => {
  const blockers = Array.isArray(payload?.blockers) ? payload.blockers : [];
  return blockers.some((row) => String(row?.code || "") === "missing_directions_dsld");
};

const hasTopMissingDirectionsSignal = (payload) => {
  const blockers = Array.isArray(payload?.topBlockers) ? payload.topBlockers : [];
  return blockers.some((row) => String(row?.code || "") === "missing_directions_dsld");
};

const checklistDirectionsPassed = (payload) => {
  const checklist = Array.isArray(payload?.checklist) ? payload.checklist : [];
  const row = checklist.find((item) => String(item?.id || "") === "safetytransparency:directions_present");
  if (!row) return null;
  return row.passed === true;
};

const decisionSupportEndpoint = (apiBaseUrl, barcode, viewMode) =>
  `${apiBaseUrl.replace(/\/$/, "")}/api/decision-support/v1?barcode=${encodeURIComponent(barcode)}&viewMode=${encodeURIComponent(viewMode)}`;

const patchStatusEndpoint = (apiBaseUrl) => `${apiBaseUrl.replace(/\/$/, "")}/api/patch-shadow/status`;

const main = async () => {
  const stageCDir = resolvePath(getArg("stage-c-dir")) || await newestOutputDirByPrefix("v1.6.12-stage-c-");
  if (!stageCDir) {
    console.error("[run-stage-d0-runtime-hit-proof] missing --stage-c-dir and no stage-c outputs found");
    process.exit(1);
  }

  const stageDRoot = resolvePath(getArg("stage-d-root")) || path.join(OUTPUT_ROOT, `v1.6.13-stage-d-${new Date().toISOString().replace(/[:.]/g, "-")}`);
  const outDir = resolvePath(getArg("out-dir")) || path.join(stageDRoot, "d0_runtime_hit");

  const sampleManifestPath = resolvePath(getArg("sample-manifest")) || path.join(outDir, "stage_d0_sample_manifest.json");
  const controlApiBaseUrl = String(getArg("control-api-base-url", process.env.STAGING_CONTROL_API_BASE_URL || "")).trim();
  const patchApiBaseUrl = String(getArg("patch-api-base-url", process.env.STAGING_PATCH_API_BASE_URL || "")).trim();
  if (!controlApiBaseUrl || !patchApiBaseUrl) {
    console.error("[run-stage-d0-runtime-hit-proof] missing control/patch api base url");
    process.exit(1);
  }

  const timeoutMs = Math.max(2000, asNumber(getArg("timeout-ms"), 12000));
  const minTargeted = Math.max(20, asNumber(getArg("min-targeted"), 20));
  const minNegative = Math.max(10, asNumber(getArg("min-negative"), 10));
  const hitThreshold = Math.max(0, Math.min(1, asNumber(getArg("hit-threshold"), 0.7)));
  const visibleThreshold = Math.max(0, Math.min(1, asNumber(getArg("visible-threshold"), 0.7)));
  const payloadSoftThreshold = Math.max(0, Math.min(1, asNumber(getArg("payload-soft-threshold"), 0.4)));
  const viewMode = "details";
  const regressionToken = String(getArg("regression-token", process.env.REGRESSION_AUTH_TOKEN || "")).trim();
  const bearerToken = String(getArg("bearer-token", process.env.STAGE_D0_BEARER_TOKEN || "")).trim();

  const headers = buildHeaders({ regressionToken, bearerToken });
  const manifest = await readJson(sampleManifestPath);
  const positives = Array.isArray(manifest?.positiveSamples) ? manifest.positiveSamples : [];
  const negatives = Array.isArray(manifest?.negativeSamples) ? manifest.negativeSamples : [];

  if (positives.length < minTargeted) {
    console.error(`[run-stage-d0-runtime-hit-proof] targetedSampleCount too low: ${positives.length} < ${minTargeted}`);
    process.exit(1);
  }
  if (negatives.length < minNegative) {
    console.error(`[run-stage-d0-runtime-hit-proof] negativeSampleCount too low: ${negatives.length} < ${minNegative}`);
    process.exit(1);
  }

  const perSample = [];
  let hitCount = 0;
  let payloadImprovedCount = 0;
  let uiVisibleImprovedCount = 0;
  let unexpectedCrossIdentityHitCount = 0;
  let negativeFalsePositiveCount = 0;

  const patchStatusBeforeRun = await fetchJson(patchStatusEndpoint(patchApiBaseUrl), headers, timeoutMs);

  for (const sample of positives) {
    const barcode = String(sample?.barcode_gtin14 ?? "").trim();
    const expectedIdentity = normalizeIdentity(sample?.identityKey);

    const controlResp = await fetchJson(decisionSupportEndpoint(controlApiBaseUrl, barcode, viewMode), headers, timeoutMs);

    const patchStatusBefore = await fetchJson(patchStatusEndpoint(patchApiBaseUrl), headers, timeoutMs);
    const patchResp = await fetchJson(decisionSupportEndpoint(patchApiBaseUrl, barcode, viewMode), headers, timeoutMs);
    const patchStatusAfter = await fetchJson(patchStatusEndpoint(patchApiBaseUrl), headers, timeoutMs);

    const hitDelta = laneHitCount(patchStatusAfter?.json, LANE1_ID)
      - laneHitCount(patchStatusBefore?.json, LANE1_ID);
    const sampleHit = hitDelta > 0;
    if (sampleHit) hitCount += 1;

    const lastMatchedIdentity = laneLastIdentity(patchStatusAfter?.json, LANE1_ID);
    const crossIdentityHit = sampleHit && Boolean(expectedIdentity) && Boolean(lastMatchedIdentity) && expectedIdentity !== lastMatchedIdentity;
    if (crossIdentityHit) unexpectedCrossIdentityHitCount += 1;

    const controlMissing = hasMissingDirectionsSignal(controlResp?.json);
    const patchMissing = hasMissingDirectionsSignal(patchResp?.json);
    const payloadImproved = controlMissing && !patchMissing;
    if (payloadImproved) payloadImprovedCount += 1;

    const controlTopMissing = hasTopMissingDirectionsSignal(controlResp?.json);
    const patchTopMissing = hasTopMissingDirectionsSignal(patchResp?.json);
    const controlDirectionsPassed = checklistDirectionsPassed(controlResp?.json);
    const patchDirectionsPassed = checklistDirectionsPassed(patchResp?.json);
    const uiVisibleImproved = (controlTopMissing && !patchTopMissing) || (controlDirectionsPassed === false && patchDirectionsPassed === true);
    if (uiVisibleImproved) uiVisibleImprovedCount += 1;

    perSample.push({
      sampleId: sample.sampleId,
      barcode_gtin14: barcode,
      identityKey: sample.identityKey,
      expectedPatchedField: sample.expectedPatchedField,
      controlStatus: controlResp.status,
      patchStatus: patchResp.status,
      sampleHit,
      crossIdentityHit,
      payloadImproved,
      uiVisibleImproved,
      controlMissingDirections: controlMissing,
      patchMissingDirections: patchMissing,
      controlDirectionsPassed,
      patchDirectionsPassed,
      patchStatusBeforeHitCount: laneHitCount(patchStatusBefore?.json, LANE1_ID),
      patchStatusAfterHitCount: laneHitCount(patchStatusAfter?.json, LANE1_ID),
      patchStatusLastMatchedIdentity: patchStatusAfter?.json?.runtimePatchLastMatchedIdentity ?? null,
      patchStatusLaneLastMatchedIdentity: patchStatusAfter?.json?.runtimePatchLastMatchedIdentityByLane?.[LANE1_ID] ?? null,
    });
  }

  const negativeRows = [];
  for (const sample of negatives) {
    const barcode = String(sample?.barcode_gtin14 ?? "").trim();
    if (!barcode) continue;

    const patchStatusBefore = await fetchJson(patchStatusEndpoint(patchApiBaseUrl), headers, timeoutMs);
    const patchResp = await fetchJson(decisionSupportEndpoint(patchApiBaseUrl, barcode, viewMode), headers, timeoutMs);
    const patchStatusAfter = await fetchJson(patchStatusEndpoint(patchApiBaseUrl), headers, timeoutMs);

    const hitDelta = laneHitCount(patchStatusAfter?.json, LANE1_ID)
      - laneHitCount(patchStatusBefore?.json, LANE1_ID);
    const falsePositiveHit = hitDelta > 0;
    if (falsePositiveHit) negativeFalsePositiveCount += 1;

    negativeRows.push({
      sampleId: sample.sampleId,
      barcode_gtin14: barcode,
      identityKey: sample.identityKey,
      laneId: sample.laneId,
      reasonCode: sample.reasonCode,
      patchStatus: patchResp.status,
      falsePositiveHit,
      patchStatusBeforeHitCount: laneHitCount(patchStatusBefore?.json, LANE1_ID),
      patchStatusAfterHitCount: laneHitCount(patchStatusAfter?.json, LANE1_ID),
      patchStatusLastMatchedIdentity: patchStatusAfter?.json?.runtimePatchLastMatchedIdentity ?? null,
      patchStatusLaneLastMatchedIdentity: patchStatusAfter?.json?.runtimePatchLastMatchedIdentityByLane?.[LANE1_ID] ?? null,
    });
  }

  const patchStatusAfterRun = await fetchJson(patchStatusEndpoint(patchApiBaseUrl), headers, timeoutMs);

  const targetedSampleCount = positives.length;
  const runtimePatchHitSampleRate = toRate(hitCount, targetedSampleCount);
  const payloadDirectionsImprovementRate = toRate(payloadImprovedCount, targetedSampleCount);
  const visibleDirectionsImprovementRate = toRate(uiVisibleImprovedCount, targetedSampleCount);

  const runtimeEvidencePositive = runtimePatchHitSampleRate >= hitThreshold;
  const payloadEvidencePositive = payloadDirectionsImprovementRate >= payloadSoftThreshold;
  const uiEvidencePositive = visibleDirectionsImprovementRate >= visibleThreshold;
  const evidencePositiveCount = [runtimeEvidencePositive, payloadEvidencePositive, uiEvidencePositive].filter(Boolean).length;

  const failReasons = [];
  const softGateWarnings = [];
  const patchModeConfirmed = Boolean(patchStatusAfterRun?.json?.patchModeConfirmed);
  if (!patchModeConfirmed) failReasons.push("patch_mode_not_confirmed");
  if (targetedSampleCount < minTargeted) failReasons.push("insufficient_targeted_samples");
  if (negatives.length < minNegative) failReasons.push("insufficient_negative_samples");
  if (runtimePatchHitSampleRate < hitThreshold) failReasons.push("runtime_hit_rate_below_threshold");
  if (visibleDirectionsImprovementRate < visibleThreshold) failReasons.push("visible_improvement_rate_below_threshold");
  if (unexpectedCrossIdentityHitCount > 0) failReasons.push("unexpected_cross_identity_hits_detected");
  if (negativeFalsePositiveCount > 0) failReasons.push("negative_false_positive_detected");
  if (evidencePositiveCount < 2) failReasons.push("insufficient_evidence_classes");
  if (payloadDirectionsImprovementRate < payloadSoftThreshold) softGateWarnings.push("payload_evidence_gap");

  const pass = failReasons.length === 0;

  const proof = {
    generatedAt: new Date().toISOString(),
    stageCDir,
    outDir,
    sampleManifestPath,
    thresholds: {
      minTargeted,
      minNegative,
      hitThreshold,
      visibleThreshold,
      payloadSoftThreshold,
    },
    metrics: {
      targetedSampleCount,
      negativeSampleCount: negatives.length,
      runtimePatchHitSampleRate,
      payloadDirectionsImprovementRate,
      visibleDirectionsImprovementRate,
      unexpectedCrossIdentityHitCount,
      negativeFalsePositiveCount,
      evidencePositiveCount,
    },
    evidenceClasses: {
      runtimeStatus: runtimeEvidencePositive,
      payloadDiff: payloadEvidencePositive,
      uiVisibleDiff: uiEvidencePositive,
    },
    patchActivationEvidence: {
      statusUrl: patchStatusEndpoint(patchApiBaseUrl),
      patchModeConfirmed,
      candidatesPath: patchStatusAfterRun?.json?.candidatesPath ?? patchStatusBeforeRun?.json?.candidatesPath ?? null,
      candidatesHash: patchStatusAfterRun?.json?.candidatesHash ?? patchStatusBeforeRun?.json?.candidatesHash ?? null,
      candidateScopeId: patchStatusAfterRun?.json?.candidateScopeId ?? patchStatusBeforeRun?.json?.candidateScopeId ?? null,
      runtimePatchHitCountBefore: asNumber(patchStatusBeforeRun?.json?.runtimePatchHitCount, 0),
      runtimePatchHitCountAfter: asNumber(patchStatusAfterRun?.json?.runtimePatchHitCount, 0),
      runtimePatchHitCountDelta:
        asNumber(patchStatusAfterRun?.json?.runtimePatchHitCount, 0)
        - asNumber(patchStatusBeforeRun?.json?.runtimePatchHitCount, 0),
      runtimePatchHitSampleCount: asNumber(patchStatusAfterRun?.json?.runtimePatchHitSampleCount, 0),
      runtimePatchHitCountByLane: patchStatusAfterRun?.json?.runtimePatchHitCountByLane || null,
      runtimePatchLastMatchedIdentity: patchStatusAfterRun?.json?.runtimePatchLastMatchedIdentity || null,
      runtimePatchLastMatchedIdentityByLane: patchStatusAfterRun?.json?.runtimePatchLastMatchedIdentityByLane || null,
      retrySuccessRateNullable: patchStatusAfterRun?.json?.retrySuccessRateNullable ?? null,
    },
    softGateWarnings,
    pass,
    failReasons,
    perSample,
    negativeRows,
  };

  const payloadDiff = {
    generatedAt: proof.generatedAt,
    targetedSampleCount,
    improvedCount: payloadImprovedCount,
    improvementRate: payloadDirectionsImprovementRate,
    rows: perSample.map((row) => ({
      sampleId: row.sampleId,
      barcode_gtin14: row.barcode_gtin14,
      payloadImproved: row.payloadImproved,
      controlMissingDirections: row.controlMissingDirections,
      patchMissingDirections: row.patchMissingDirections,
    })),
  };

  const uiVisibleDiff = {
    generatedAt: proof.generatedAt,
    targetedSampleCount,
    improvedCount: uiVisibleImprovedCount,
    improvementRate: visibleDirectionsImprovementRate,
    rows: perSample.map((row) => ({
      sampleId: row.sampleId,
      barcode_gtin14: row.barcode_gtin14,
      uiVisibleImproved: row.uiVisibleImproved,
      controlTopMissing: row.controlMissingDirections,
      patchTopMissing: row.patchMissingDirections,
      controlDirectionsPassed: row.controlDirectionsPassed,
      patchDirectionsPassed: row.patchDirectionsPassed,
    })),
  };

  const md = [
    "# Stage D0 Runtime Hit Proof",
    "",
    `- pass: ${pass}`,
    `- targetedSampleCount: ${targetedSampleCount}`,
    `- runtimePatchHitSampleRate: ${(runtimePatchHitSampleRate * 100).toFixed(2)}%`,
    `- visibleDirectionsImprovementRate: ${(visibleDirectionsImprovementRate * 100).toFixed(2)}%`,
    `- payloadDirectionsImprovementRate: ${(payloadDirectionsImprovementRate * 100).toFixed(2)}%`,
    `- payloadSoftThreshold: ${(payloadSoftThreshold * 100).toFixed(2)}%`,
    `- unexpectedCrossIdentityHitCount: ${unexpectedCrossIdentityHitCount}`,
    `- negativeFalsePositiveCount: ${negativeFalsePositiveCount}`,
    `- negativeSampleCount: ${negatives.length}`,
    `- patchModeConfirmed: ${patchModeConfirmed}`,
    `- evidencePositiveCount: ${evidencePositiveCount}/3`,
    "",
    "## Soft Gate Warnings",
    ...(softGateWarnings.length > 0 ? softGateWarnings.map((reason) => `- ${reason}`) : ["- none"]),
    "",
    "## Fail Reasons",
    ...(failReasons.length > 0 ? failReasons.map((reason) => `- ${reason}`) : ["- none"]),
  ].join("\n");

  const softGateFixableQueue = softGateWarnings.map((warning, idx) => ({
    id: `d0_soft_gate_${String(idx + 1).padStart(3, "0")}`,
    breachType: warning,
    reasonCode: warning,
    owner: "unassigned",
    status: "open",
    targetRelease: "v1.6.14-stage-e-followup",
    stage: "d0_medium_plus",
  }));

  await writeJson(path.join(outDir, "stage_d0_runtime_hit_proof.json"), proof);
  await writeText(path.join(outDir, "stage_d0_runtime_hit_proof.md"), `${md}\n`);
  await writeJson(path.join(outDir, "stage_d0_payload_diff.json"), payloadDiff);
  await writeJson(path.join(outDir, "stage_d0_ui_visible_diff.json"), uiVisibleDiff);
  await writeJsonl(path.join(outDir, "stage_d0_fixable_repair_queue.jsonl"), softGateFixableQueue);

  if (!pass) {
    console.error("[run-stage-d0-runtime-hit-proof] failed strict gate", failReasons);
    process.exit(2);
  }

  console.log("[run-stage-d0-runtime-hit-proof] completed");
  console.log(JSON.stringify({ outDir, pass, targetedSampleCount, runtimePatchHitSampleRate, visibleDirectionsImprovementRate }, null, 2));
};

main().catch((error) => {
  console.error("[run-stage-d0-runtime-hit-proof] failed:", error instanceof Error ? error.stack || error.message : String(error));
  process.exit(1);
});
