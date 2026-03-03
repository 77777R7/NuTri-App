#!/usr/bin/env node
/* eslint-disable no-console */

import fs from "node:fs/promises";
import path from "node:path";
import { spawnSync } from "node:child_process";

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

const normalizeBaseUrl = (value) => String(value ?? "").trim().replace(/\/$/, "");

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

const normalizeBarcode = (value) => {
  const digits = String(value ?? "").replace(/\D/g, "");
  if (!digits) return null;
  if (digits.length >= 14) return digits.slice(-14);
  return digits.padStart(14, "0");
};

const runNode = ({ script, scriptArgs }) => {
  const cmd = [script, ...scriptArgs];
  console.log(`[stage-c-focused-probe] node ${cmd.join(" ")}`);
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

const extractProbeBarcodes = ({ executionSlice, filteredCandidates, maxBarcodes }) => {
  const selected = Array.isArray(executionSlice?.selected) ? executionSlice.selected : [];
  const selectedKeys = new Set(selected.map((row) => `${String(row?.market ?? "").toUpperCase()}:${String(row?.brandNorm ?? "").toLowerCase()}`));
  const intersection = [];
  for (const row of filteredCandidates) {
    const barcode = normalizeBarcode(row?.barcode_gtin14);
    if (!barcode) continue;
    const key = `${String(row?.market ?? "").toUpperCase()}:${String(row?.seedBrandNorm ?? row?.brandNorm ?? "").toLowerCase()}`;
    if (selectedKeys.has(key)) intersection.push(barcode);
  }

  const fromFiltered = filteredCandidates
    .map((row) => normalizeBarcode(row?.barcode_gtin14))
    .filter(Boolean);

  const chosen = intersection.length > 0 ? intersection : fromFiltered;
  const deduped = [...new Set(chosen)].slice(0, Math.max(1, maxBarcodes));

  if (deduped.length === 0) {
    return ["00665553227870", "00064642079992", "00690290532093"];
  }
  return deduped;
};

const toRoleBarcodes = (barcodes) =>
  barcodes.map((barcode, idx) => ({
    role: idx === 0 ? "killer" : `probe_${String(idx).padStart(2, "0")}`,
    barcode,
  }));

const readRoundsStats = async (dirPath) => {
  const report = await readJson(path.join(dirPath, "rounds_summary.json"));
  return report?.stats ?? {};
};

const pickMetrics = (stats) => ({
  doneSeenRate: Number(stats?.doneSeenRate ?? 0),
  scoreVisibleRate: Number(stats?.scoreVisibleRate ?? 0),
  regulatoryRichRate_uniqueBarcode: Number(stats?.regulatoryRichRate_uniqueBarcode ?? 0),
  killerProductClientTimeoutCount: Number(stats?.killerProductClientTimeoutCount ?? 0),
  killerProductSseConnectedButNoDoneCount: Number(stats?.killerProductSseConnectedButNoDoneCount ?? 0),
  nutritionLabelLikeLeakCount: Number(stats?.nutritionLabelLikeLeakCount ?? 0),
  attemptsTotal: Number(stats?.attemptsTotal ?? 0),
});

const main = async () => {
  const stageCDir = resolvePath(getArg("stage-c-dir"));
  const controlApiBaseUrl = normalizeBaseUrl(getArg("control-api-base-url", process.env.STAGING_CONTROL_API_BASE_URL || ""));
  const patchApiBaseUrl = normalizeBaseUrl(getArg("patch-api-base-url", process.env.STAGING_PATCH_API_BASE_URL || ""));
  const outDir = resolvePath(getArg("out-dir")) || (stageCDir ? path.join(stageCDir, "focused_probe") : null);
  const regressionToken = String(getArg("regression-token", process.env.REGRESSION_AUTH_TOKEN || "")).trim();
  const bearerToken = String(getArg("bearer-token", process.env.STAGE_C_FOCUSED_PROBE_BEARER_TOKEN || "")).trim();
  const maxBarcodes = Math.max(1, Number(getArg("max-barcodes", "20")) || 20);

  if (!stageCDir || !controlApiBaseUrl || !patchApiBaseUrl || !outDir) {
    console.error("[stage-c-focused-probe] missing required args");
    process.exit(1);
  }

  await ensureDir(outDir);

  const executionSlice = await readJson(path.join(stageCDir, "c1b_top30_execution_slice", "execution_slice_top30.json"));
  const filteredCandidates = await readJsonl(path.join(stageCDir, "c3_conflict_prefilter", "stage_c_patch_candidates_filtered.jsonl"));

  const probeBarcodes = extractProbeBarcodes({ executionSlice, filteredCandidates, maxBarcodes });
  const probeFixture = toRoleBarcodes(probeBarcodes);
  const probeFixturePath = path.join(outDir, "focused_probe_barcodes.json");
  await writeJson(probeFixturePath, probeFixture);

  const controlDir = path.join(outDir, "control_probe_run");
  const patchDir = path.join(outDir, "patch_probe_run");

  const mobileCommon = [
    "--serial-rounds", "1",
    "--concurrent-rounds", "0",
    "--skip-cold-hot",
    "--killer-cold-runs", "0",
    "--killer-hot-runs", "0",
    "--no-open-result-screen",
    "--barcodes-json", probeFixturePath,
  ];

  runNode({
    script: "scripts/maintainer/mobile-soak-run.mjs",
    scriptArgs: [
      "--api-base-url", controlApiBaseUrl,
      "--out-dir", controlDir,
      ...mobileCommon,
    ],
  });

  const headers = buildHeaders({ regressionToken, bearerToken });
  const patchStatusUrl = `${patchApiBaseUrl}/api/patch-shadow/status`;
  const patchStatusBefore = await fetchJson(patchStatusUrl, headers).catch(() => ({ ok: false, status: 0, body: null, raw: null }));

  runNode({
    script: "scripts/maintainer/mobile-soak-run.mjs",
    scriptArgs: [
      "--api-base-url", patchApiBaseUrl,
      "--out-dir", patchDir,
      ...mobileCommon,
    ],
  });

  const patchStatusAfter = await fetchJson(patchStatusUrl, headers).catch(() => ({ ok: false, status: 0, body: null, raw: null }));

  const controlStats = await readRoundsStats(controlDir);
  const patchStats = await readRoundsStats(patchDir);
  const controlMetrics = pickMetrics(controlStats);
  const patchMetrics = pickMetrics(patchStats);

  const diff = {
    generatedAt: new Date().toISOString(),
    probeBarcodeCount: probeFixture.length,
    metricsDelta: {
      doneSeenRateDeltaPp: Number(((patchMetrics.doneSeenRate - controlMetrics.doneSeenRate) * 100).toFixed(2)),
      scoreVisibleRateDeltaPp: Number(((patchMetrics.scoreVisibleRate - controlMetrics.scoreVisibleRate) * 100).toFixed(2)),
      regulatoryRichRateDeltaPp: Number(((patchMetrics.regulatoryRichRate_uniqueBarcode - controlMetrics.regulatoryRichRate_uniqueBarcode) * 100).toFixed(2)),
      killerProductClientTimeoutDelta: patchMetrics.killerProductClientTimeoutCount - controlMetrics.killerProductClientTimeoutCount,
      killerProductSseConnectedButNoDoneDelta:
        patchMetrics.killerProductSseConnectedButNoDoneCount - controlMetrics.killerProductSseConnectedButNoDoneCount,
      nutritionLabelLikeLeakDelta: patchMetrics.nutritionLabelLikeLeakCount - controlMetrics.nutritionLabelLikeLeakCount,
    },
    focusedProbeDelta: {
      nonNegativeTrend:
        patchMetrics.doneSeenRate >= controlMetrics.doneSeenRate
        && patchMetrics.scoreVisibleRate >= controlMetrics.scoreVisibleRate,
      target20PctHint:
        patchMetrics.regulatoryRichRate_uniqueBarcode >= controlMetrics.regulatoryRichRate_uniqueBarcode * 1.2,
    },
    patchActivationEvidence: {
      statusUrl: patchStatusUrl,
      patchModeConfirmed: Boolean(patchStatusAfter?.body?.enabled) && Number(patchStatusAfter?.body?.candidatesLoaded ?? 0) > 0,
      candidatesHash: patchStatusAfter?.body?.candidatesHash ?? patchStatusBefore?.body?.candidatesHash ?? null,
      runtimePatchHitCountBefore: Number(patchStatusBefore?.body?.runtimePatchHitCount ?? 0),
      runtimePatchHitCountAfter: Number(patchStatusAfter?.body?.runtimePatchHitCount ?? 0),
      runtimePatchHitCountDelta:
        Number(patchStatusAfter?.body?.runtimePatchHitCount ?? 0) - Number(patchStatusBefore?.body?.runtimePatchHitCount ?? 0),
    },
  };

  await writeJson(path.join(outDir, "focused_probe_control.json"), {
    generatedAt: new Date().toISOString(),
    apiBaseUrl: controlApiBaseUrl,
    outDir: controlDir,
    probeBarcodes: probeFixture,
    metrics: controlMetrics,
  });

  await writeJson(path.join(outDir, "focused_probe_patch.json"), {
    generatedAt: new Date().toISOString(),
    apiBaseUrl: patchApiBaseUrl,
    outDir: patchDir,
    probeBarcodes: probeFixture,
    metrics: patchMetrics,
  });

  await writeJson(path.join(outDir, "focused_probe_diff.json"), diff);

  console.log("[stage-c-focused-probe] completed");
  console.log(JSON.stringify({
    outDir,
    probeBarcodeCount: probeFixture.length,
    patchModeConfirmed: diff.patchActivationEvidence.patchModeConfirmed,
    runtimePatchHitCountDelta: diff.patchActivationEvidence.runtimePatchHitCountDelta,
  }, null, 2));
};

main().catch((error) => {
  console.error("[stage-c-focused-probe] failed:", error instanceof Error ? error.stack || error.message : String(error));
  process.exit(1);
});
