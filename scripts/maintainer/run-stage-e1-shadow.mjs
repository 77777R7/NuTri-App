#!/usr/bin/env node
/* eslint-disable no-console */

import fs from "node:fs/promises";
import path from "node:path";
import { spawnSync } from "node:child_process";

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

const normalizeBarcode = (value) => {
  const digits = String(value ?? "").replace(/\D/g, "");
  if (!digits) return null;
  if (digits.length >= 14) return digits.slice(-14);
  return digits.padStart(14, "0");
};

const asNumber = (value, fallback = 0) => {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
};

const runNode = ({ script, scriptArgs }) => {
  const cmd = [script, ...scriptArgs];
  console.log(`[stage-e1-shadow] node ${cmd.join(" ")}`);
  const proc = spawnSync("node", cmd, {
    cwd: ROOT_DIR,
    stdio: "inherit",
    env: process.env,
  });
  if (proc.status !== 0) {
    throw new Error(`command_failed: node ${cmd.join(" ")} status=${proc.status}`);
  }
};

const buildHeaders = ({ regressionToken, bearerToken }) => {
  const headers = {};
  if (regressionToken) headers["x-regression-token"] = regressionToken;
  if (bearerToken) headers.Authorization = `Bearer ${bearerToken}`;
  return headers;
};

const fetchJson = async (url, headers) => {
  const response = await fetch(url, { headers });
  const text = await response.text();
  let body = null;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    body = null;
  }
  return {
    ok: response.ok,
    status: response.status,
    body,
    raw: text,
  };
};

const readRoundsStats = async (dirPath) => {
  const report = await readJson(path.join(dirPath, "rounds_summary.json"));
  return report?.stats ?? {};
};

const pickMetrics = (stats) => ({
  doneSeenRate: asNumber(stats?.doneSeenRate, 0),
  scoreVisibleRate: asNumber(stats?.scoreVisibleRate, 0),
  regulatoryRichRate_uniqueBarcode: asNumber(stats?.regulatoryRichRate_uniqueBarcode, 0),
  killerProductClientTimeoutCount: asNumber(stats?.killerProductClientTimeoutCount, 0),
  killerProductSseConnectedButNoDoneCount: asNumber(stats?.killerProductSseConnectedButNoDoneCount, 0),
  nutritionLabelLikeLeakCount: asNumber(stats?.nutritionLabelLikeLeakCount, 0),
  attemptsTotal: asNumber(stats?.attemptsTotal, 0),
});

const main = async () => {
  const stageCDir = resolvePath(getArg("stage-c-dir")) || await newestOutputDirByPrefix("v1.6.12-stage-c-");
  if (!stageCDir) {
    console.error("[run-stage-e1-shadow] missing --stage-c-dir and no stage-c output found");
    process.exit(1);
  }

  const stageEDir = resolvePath(getArg("stage-e-dir")) || path.join(OUTPUT_ROOT, `v1.6.14-stage-e-${new Date().toISOString().replace(/[:.]/g, "-")}`);
  const outDir = resolvePath(getArg("out-dir")) || path.join(stageEDir, "e1_shadow");
  await ensureDir(outDir);

  const e0ReadinessPath = resolvePath(getArg("e0-readiness")) || path.join(stageEDir, "e0_baseline", "stage_e0_readiness.json");
  const e0Readiness = await readJson(e0ReadinessPath);
  if (e0Readiness?.pass !== true) {
    console.error("[run-stage-e1-shadow] E0 readiness is not passing");
    process.exit(2);
  }

  const candidatesPath = resolvePath(getArg("probiotics-candidates"))
    || resolvePath(e0Readiness?.candidateArtifacts?.path)
    || path.join(stageEDir, "e0_baseline", "e0_probiotics_candidates.jsonl");
  const candidateRows = await readJsonl(candidatesPath);
  if (candidateRows.length === 0) {
    console.error("[run-stage-e1-shadow] no probiotics candidates found");
    process.exit(1);
  }

  const controlApiBaseUrl = String(getArg("control-api-base-url", process.env.STAGING_CONTROL_API_BASE_URL || "")).trim();
  const patchApiBaseUrl = String(getArg("patch-api-base-url", process.env.STAGING_PATCH_API_BASE_URL || "")).trim();
  if (!controlApiBaseUrl || !patchApiBaseUrl) {
    console.error("[run-stage-e1-shadow] missing control/patch api base url");
    process.exit(1);
  }

  const regressionToken = String(getArg("regression-token", process.env.REGRESSION_AUTH_TOKEN || "")).trim();
  const bearerToken = String(getArg("bearer-token", process.env.STAGE_E1_BEARER_TOKEN || "")).trim();
  const webHintContentThreshold = String(getArg("web-hint-content-threshold", "0")).trim();
  const requireFirstFramePending = String(getArg("require-first-frame-pending", "0")).trim();
  const requireWebHintCoverage = String(getArg("require-web-hint-coverage", "0")).trim();

  const candidateBarcodes = [...new Set(candidateRows.map((row) => normalizeBarcode(row?.barcode_gtin14)).filter(Boolean))];
  const webHintProbeBarcode = normalizeBarcode(getArg("web-hint-probe-barcode", "00666183000154"));
  const probeBarcodes = [];
  if (candidateBarcodes[0]) probeBarcodes.push(candidateBarcodes[0]);
  if (webHintProbeBarcode && !probeBarcodes.includes(webHintProbeBarcode)) {
    probeBarcodes.push(webHintProbeBarcode);
  }
  for (const barcode of candidateBarcodes.slice(1)) {
    if (!probeBarcodes.includes(barcode)) probeBarcodes.push(barcode);
  }
  const barcodes = probeBarcodes.slice(0, 50);
  if (barcodes.length === 0) {
    console.error("[run-stage-e1-shadow] no candidate barcodes available");
    process.exit(1);
  }

  const probeFixturePath = path.join(outDir, "e1_probe_barcodes.json");
  await writeJson(
    probeFixturePath,
    barcodes.map((barcode, idx) => ({
      role: idx === 0 ? "killer" : `e1_probe_${String(idx).padStart(2, "0")}`,
      barcode,
    })),
  );

  const controlSeqDir = path.join(outDir, "runA_control_shadow");
  const patchSeqDir = path.join(outDir, "runB_patch_shadow");
  const focusedProbeDir = path.join(outDir, "focused_probe");
  const focusedControlRunDir = path.join(focusedProbeDir, "control_probe_run");
  const focusedPatchRunDir = path.join(focusedProbeDir, "patch_probe_run");
  await ensureDir(focusedProbeDir);

  runNode({
    script: "scripts/maintainer/run-stage-c-sequence.mjs",
    scriptArgs: [
      "--stage-c-dir", stageCDir,
      "--api-base-url", controlApiBaseUrl,
      "--out-dir", controlSeqDir,
      "--barcodes-json", probeFixturePath,
      "--mode", "control",
      "--fast-gates",
      ...(webHintContentThreshold.length > 0 ? ["--web-hint-content-threshold", webHintContentThreshold] : []),
      ...(requireFirstFramePending.length > 0 ? ["--require-first-frame-pending", requireFirstFramePending] : []),
      ...(requireWebHintCoverage.length > 0 ? ["--require-web-hint-coverage", requireWebHintCoverage] : []),
      ...(regressionToken ? ["--regression-token", regressionToken] : []),
      ...(bearerToken ? ["--bearer-token", bearerToken] : []),
    ],
  });

  runNode({
    script: "scripts/maintainer/run-stage-c-sequence.mjs",
    scriptArgs: [
      "--stage-c-dir", stageCDir,
      "--api-base-url", patchApiBaseUrl,
      "--out-dir", patchSeqDir,
      "--barcodes-json", probeFixturePath,
      "--mode", "patch",
      "--fast-gates",
      ...(webHintContentThreshold.length > 0 ? ["--web-hint-content-threshold", webHintContentThreshold] : []),
      ...(requireFirstFramePending.length > 0 ? ["--require-first-frame-pending", requireFirstFramePending] : []),
      ...(requireWebHintCoverage.length > 0 ? ["--require-web-hint-coverage", requireWebHintCoverage] : []),
      ...(regressionToken ? ["--regression-token", regressionToken] : []),
      ...(bearerToken ? ["--bearer-token", bearerToken] : []),
    ],
  });

  const mobileCommon = [
    "--skip-cold-hot",
    "--no-open-result-screen",
    "--concurrent-rounds", "0",
    "--killer-cold-runs", "0",
    "--killer-hot-runs", "0",
    "--serial-rounds", "1",
    "--barcodes-json", probeFixturePath,
  ];

  runNode({
    script: "scripts/maintainer/mobile-soak-run.mjs",
    scriptArgs: [
      "--api-base-url", controlApiBaseUrl,
      "--out-dir", focusedControlRunDir,
      ...mobileCommon,
    ],
  });

  const headers = buildHeaders({ regressionToken, bearerToken });
  const patchStatusUrl = `${patchApiBaseUrl.replace(/\/$/, "")}/api/patch-shadow/status`;
  const patchStatusBefore = await fetchJson(patchStatusUrl, headers).catch(() => ({ ok: false, status: 0, body: null }));

  runNode({
    script: "scripts/maintainer/mobile-soak-run.mjs",
    scriptArgs: [
      "--api-base-url", patchApiBaseUrl,
      "--out-dir", focusedPatchRunDir,
      ...mobileCommon,
    ],
  });

  const patchStatusAfter = await fetchJson(patchStatusUrl, headers).catch(() => ({ ok: false, status: 0, body: null }));

  const controlMetrics = pickMetrics(await readRoundsStats(focusedControlRunDir));
  const patchMetrics = pickMetrics(await readRoundsStats(focusedPatchRunDir));

  const focusedDiff = {
    generatedAt: new Date().toISOString(),
    probeBarcodeCount: barcodes.length,
    metricsDelta: {
      doneSeenRateDeltaPp: Number(((patchMetrics.doneSeenRate - controlMetrics.doneSeenRate) * 100).toFixed(2)),
      scoreVisibleRateDeltaPp: Number(((patchMetrics.scoreVisibleRate - controlMetrics.scoreVisibleRate) * 100).toFixed(2)),
      regulatoryRichRateDeltaPp: Number(((patchMetrics.regulatoryRichRate_uniqueBarcode - controlMetrics.regulatoryRichRate_uniqueBarcode) * 100).toFixed(2)),
      killerProductClientTimeoutDelta: patchMetrics.killerProductClientTimeoutCount - controlMetrics.killerProductClientTimeoutCount,
      killerProductSseConnectedButNoDoneDelta:
        patchMetrics.killerProductSseConnectedButNoDoneCount - controlMetrics.killerProductSseConnectedButNoDoneCount,
      nutritionLabelLikeLeakDelta: patchMetrics.nutritionLabelLikeLeakCount - controlMetrics.nutritionLabelLikeLeakCount,
    },
    patchActivationEvidence: {
      statusUrl: patchStatusUrl,
      patchModeConfirmed: Boolean(patchStatusAfter?.body?.enabled) && Number(patchStatusAfter?.body?.candidatesLoaded ?? 0) > 0,
      candidatesPath: patchStatusAfter?.body?.candidatesPath ?? patchStatusBefore?.body?.candidatesPath ?? null,
      candidatesHash: patchStatusAfter?.body?.candidatesHash ?? patchStatusBefore?.body?.candidatesHash ?? null,
      candidateScopeId: patchStatusAfter?.body?.candidateScopeId ?? patchStatusBefore?.body?.candidateScopeId ?? null,
      candidatesLoaded: Number(patchStatusAfter?.body?.candidatesLoaded ?? patchStatusBefore?.body?.candidatesLoaded ?? 0),
      runtimePatchHitCountBefore: Number(patchStatusBefore?.body?.runtimePatchHitCount ?? 0),
      runtimePatchHitCountAfter: Number(patchStatusAfter?.body?.runtimePatchHitCount ?? 0),
      runtimePatchHitCountDelta:
        Number(patchStatusAfter?.body?.runtimePatchHitCount ?? 0) - Number(patchStatusBefore?.body?.runtimePatchHitCount ?? 0),
      runtimePatchHitCountByLane: patchStatusAfter?.body?.runtimePatchHitCountByLane ?? null,
      runtimePatchLastMatchedIdentityByLane: patchStatusAfter?.body?.runtimePatchLastMatchedIdentityByLane ?? null,
    },
  };

  await writeJson(path.join(focusedProbeDir, "focused_probe_control.json"), {
    generatedAt: focusedDiff.generatedAt,
    outDir: focusedControlRunDir,
    metrics: controlMetrics,
  });
  await writeJson(path.join(focusedProbeDir, "focused_probe_patch.json"), {
    generatedAt: focusedDiff.generatedAt,
    outDir: focusedPatchRunDir,
    metrics: patchMetrics,
  });
  await writeJson(path.join(focusedProbeDir, "focused_probe_diff.json"), focusedDiff);

  const d1bEvidencePath = resolvePath(getArg("d1b-evidence"))
    || path.join(stageEDir, "d1b_isolation", "stage_d1b_batch_isolation_proof.json");

  runNode({
    script: "scripts/maintainer/evaluate-stage-e1-shadow.mjs",
    scriptArgs: [
      "--stage-c-dir", stageCDir,
      "--stage-e-dir", stageEDir,
      "--control-seq-dir", controlSeqDir,
      "--patch-seq-dir", patchSeqDir,
      "--e0-readiness", e0ReadinessPath,
      "--focused-probe-diff", path.join(focusedProbeDir, "focused_probe_diff.json"),
      "--d1b-evidence", d1bEvidencePath,
      "--out-dir", path.join(outDir, "e1_eval"),
    ],
  });

  console.log("[run-stage-e1-shadow] completed");
  console.log(JSON.stringify({
    outDir,
    probeBarcodeCount: barcodes.length,
    controlSeqDir,
    patchSeqDir,
  }, null, 2));
};

main().catch((error) => {
  console.error("[run-stage-e1-shadow] failed:", error instanceof Error ? error.stack || error.message : String(error));
  process.exit(1);
});
