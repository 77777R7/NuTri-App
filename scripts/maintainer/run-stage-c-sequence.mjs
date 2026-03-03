#!/usr/bin/env node
/* eslint-disable no-console */

import fs from "node:fs/promises";
import path from "node:path";
import crypto from "node:crypto";
import { spawnSync } from "node:child_process";

const ROOT_DIR = process.cwd();
const args = process.argv.slice(2);

const getArg = (flag, fallback = null) => {
  const idx = args.indexOf(`--${flag}`);
  if (idx === -1) return fallback;
  return args[idx + 1] ?? fallback;
};

const hasFlag = (flag) => args.includes(`--${flag}`);

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

const normalizeBarcode = (value) => {
  const digits = String(value ?? "").replace(/\D/g, "");
  if (!digits) return null;
  if (digits.length >= 14) return digits.slice(-14);
  return digits.padStart(14, "0");
};

const hashObject = (value) =>
  crypto.createHash("sha256").update(JSON.stringify(value)).digest("hex");

const runNode = ({ script, scriptArgs, env }) => {
  const cmd = [script, ...scriptArgs];
  console.log(`[stage-c-sequence] node ${cmd.join(" ")}`);
  const proc = spawnSync("node", cmd, {
    cwd: ROOT_DIR,
    stdio: "inherit",
    env: {
      ...process.env,
      ...env,
    },
  });
  if (proc.status !== 0) {
    throw new Error(`command_failed: node ${cmd.join(" ")} status=${proc.status}`);
  }
};

const runNodeSoft = ({ script, scriptArgs, env }) => {
  const cmd = [script, ...scriptArgs];
  console.log(`[stage-c-sequence] node ${cmd.join(" ")}`);
  const proc = spawnSync("node", cmd, {
    cwd: ROOT_DIR,
    stdio: "inherit",
    env: {
      ...process.env,
      ...env,
    },
  });
  return {
    ok: proc.status === 0,
    status: proc.status ?? 1,
    cmd,
  };
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

const deriveStageCDirFromBarcodesJson = (barcodesPath) => {
  if (!barcodesPath) return null;
  const parent = path.dirname(barcodesPath);
  const base = path.basename(parent);
  if (base === "c1b_top30_execution_slice") {
    return path.dirname(parent);
  }
  return null;
};

const uniqueBarcodes = (rows) => {
  const out = new Set();
  for (const row of rows) {
    const normalized = normalizeBarcode(row);
    if (normalized) out.add(normalized);
  }
  return [...out];
};

const pickBarcodesFromExecutionSlice = async ({ executionSlice, stageCDir }) => {
  const direct = [];
  if (Array.isArray(executionSlice)) {
    for (const row of executionSlice) {
      const barcode = normalizeBarcode(row?.barcode ?? row?.barcode_gtin14 ?? row);
      if (barcode) direct.push(barcode);
    }
  }
  if (Array.isArray(executionSlice?.rows)) {
    for (const row of executionSlice.rows) {
      const barcode = normalizeBarcode(row?.barcode ?? row?.barcode_gtin14);
      if (barcode) direct.push(barcode);
    }
  }
  if (direct.length > 0) return uniqueBarcodes(direct);

  if (!stageCDir) return [];

  const selected = Array.isArray(executionSlice?.selected) ? executionSlice.selected : [];
  const selectedKeys = new Set(selected.map((row) => `${String(row?.market ?? "").toUpperCase()}:${String(row?.brandNorm ?? "").toLowerCase()}`));

  const filteredPath = path.join(stageCDir, "c3_conflict_prefilter", "stage_c_patch_candidates_filtered.jsonl");
  const filteredRows = await readJsonl(filteredPath);

  const fromFiltered = [];
  for (const row of filteredRows) {
    const barcode = normalizeBarcode(row?.barcode_gtin14);
    if (!barcode) continue;
    if (selectedKeys.size === 0) {
      fromFiltered.push(barcode);
      continue;
    }
    const key = `${String(row?.market ?? "").toUpperCase()}:${String(row?.seedBrandNorm ?? row?.brandNorm ?? "").toLowerCase()}`;
    if (selectedKeys.has(key)) fromFiltered.push(barcode);
  }
  if (fromFiltered.length > 0) return uniqueBarcodes(fromFiltered);

  const scopePath = path.join(stageCDir, "c1a_top100_census", "brand_scope_products_top100.json");
  try {
    const scopeJson = await readJson(scopePath);
    const scopeRows = Array.isArray(scopeJson?.rows) ? scopeJson.rows : [];
    const fromScope = [];
    for (const row of scopeRows) {
      const barcode = normalizeBarcode(row?.barcodeGtIn14);
      if (!barcode) continue;
      if (selectedKeys.size === 0) {
        fromScope.push(barcode);
        continue;
      }
      const key = `${String(row?.seedMarket ?? "").toUpperCase()}:${String(row?.seedBrandNorm ?? "").toLowerCase()}`;
      if (selectedKeys.has(key)) fromScope.push(barcode);
    }
    return uniqueBarcodes(fromScope);
  } catch {
    return [];
  }
};

const toRoleBarcodes = (barcodes, max = 50) => {
  const limited = barcodes.slice(0, Math.max(1, max));
  if (limited.length === 0) {
    return [
      { role: "killer", barcode: "00665553227870" },
      { role: "fallback", barcode: "00064642079992" },
    ];
  }
  const out = [];
  for (let i = 0; i < limited.length; i += 1) {
    out.push({
      role: i === 0 ? "killer" : `sample_${String(i).padStart(2, "0")}`,
      barcode: limited[i],
    });
  }
  return out;
};

const main = async () => {
  const apiBaseUrl = String(getArg("api-base-url", process.env.API_BASE_URL || process.env.RENDER_BASE_URL || "")).trim().replace(/\/$/, "");
  const outDir = resolvePath(getArg("out-dir"));
  const barcodesJsonPath = resolvePath(getArg("barcodes-json"));
  const mode = String(getArg("mode", "control")).trim().toLowerCase();
  const fastGates = hasFlag("fast-gates")
    || ["1", "true", "on"].includes(String(process.env.STAGE_D_FAST_GATES || "").toLowerCase());
  const regressionToken = String(getArg("regression-token", process.env.REGRESSION_AUTH_TOKEN || "")).trim();
  const bearerToken = String(getArg("bearer-token", process.env.STAGE_C_SEQUENCE_BEARER_TOKEN || "")).trim();
  const maxBarcodes = Math.max(1, Number(getArg("max-barcodes", "50")) || 50);
  const webHintContentThreshold = getArg("web-hint-content-threshold");
  const contentPassThreshold = getArg("content-pass-threshold");
  const verifiedContentThreshold = getArg("verified-content-threshold");
  const scoreVisibleThreshold = getArg("score-visible-threshold");
  const requireFirstFramePending = getArg("require-first-frame-pending");
  const requireWebHintCoverage = getArg("require-web-hint-coverage");

  if (!apiBaseUrl) {
    console.error("[stage-c-sequence] missing --api-base-url");
    process.exit(1);
  }
  if (!outDir) {
    console.error("[stage-c-sequence] missing --out-dir");
    process.exit(1);
  }
  if (!barcodesJsonPath) {
    console.error("[stage-c-sequence] missing --barcodes-json");
    process.exit(1);
  }
  if (!["control", "patch"].includes(mode)) {
    console.error("[stage-c-sequence] --mode must be control|patch");
    process.exit(1);
  }

  await ensureDir(outDir);

  const stageCDir = resolvePath(getArg("stage-c-dir")) || deriveStageCDirFromBarcodesJson(barcodesJsonPath);
  const executionSlice = await readJson(barcodesJsonPath);
  const barcodes = await pickBarcodesFromExecutionSlice({ executionSlice, stageCDir });
  const roleBarcodes = toRoleBarcodes(barcodes, maxBarcodes);
  const killerBarcode = roleBarcodes.find((row) => row.role === "killer")?.barcode || "00665553227870";

  const stratifiedPath = path.join(outDir, "stratified50.barcodes.json");
  const killerPath = path.join(outDir, "killer10.barcodes.json");
  await writeJson(stratifiedPath, roleBarcodes);
  await writeJson(killerPath, [{ role: "killer", barcode: killerBarcode }]);

  const headers = buildHeaders({ regressionToken, bearerToken });
  const patchStatusUrl = `${apiBaseUrl}/api/patch-shadow/status`;

  let patchStatusBefore = null;
  try {
    const statusResp = await fetchJson(patchStatusUrl, headers);
    patchStatusBefore = statusResp.body;
    if (mode === "patch") {
      const enabled = Boolean(statusResp.body?.enabled);
      const loaded = Number(statusResp.body?.candidatesLoaded ?? 0);
      if (!(statusResp.ok && enabled && loaded > 0)) {
        throw new Error(`patch_shadow_not_ready status=${statusResp.status} enabled=${enabled} candidatesLoaded=${loaded}`);
      }
    }
  } catch (error) {
    if (mode === "patch") {
      throw error;
    }
  }

  const stableDir = path.join(outDir, "stable");
  const s50Run1Dir = path.join(outDir, "s50-run1");
  const s50Run2Dir = path.join(outDir, "s50-run2");
  const killer10Dir = path.join(outDir, "killer10");
  const reconcileDir = path.join(outDir, "gate-reconcile");
  let killerFallbackUsed = false;
  let killerFailureReason = null;

  const fastGateArgs = fastGates
    ? ["--skip-bulk", "--skip-ul", "--skip-focus-probes", "--skip-crash-canary", "--skip-shadow-reports"]
    : [];

  runNode({
    script: "scripts/maintainer/run-backend-gates-stable.mjs",
    scriptArgs: [
      "--api-base-url", apiBaseUrl,
      "--out-dir", stableDir,
      ...fastGateArgs,
      ...(mode === "patch" ? ["--skip-shadow-reports"] : []),
    ],
  });

  const mobileThresholdArgs = [
    ...(contentPassThreshold != null ? ["--content-pass-threshold", String(contentPassThreshold)] : []),
    ...(verifiedContentThreshold != null ? ["--verified-content-threshold", String(verifiedContentThreshold)] : []),
    ...(webHintContentThreshold != null ? ["--web-hint-content-threshold", String(webHintContentThreshold)] : []),
    ...(scoreVisibleThreshold != null ? ["--score-visible-threshold", String(scoreVisibleThreshold)] : []),
    ...(requireFirstFramePending != null ? ["--require-first-frame-pending", String(requireFirstFramePending)] : []),
    ...(requireWebHintCoverage != null ? ["--require-web-hint-coverage", String(requireWebHintCoverage)] : []),
  ];

  const mobileCommon = [
    "--api-base-url", apiBaseUrl,
    "--skip-cold-hot",
    "--no-open-result-screen",
    "--concurrent-rounds", "0",
    "--killer-cold-runs", "0",
    "--killer-hot-runs", "0",
    ...mobileThresholdArgs,
  ];

  runNode({
    script: "scripts/maintainer/mobile-soak-run.mjs",
    scriptArgs: [
      "--out-dir", s50Run1Dir,
      "--barcodes-json", stratifiedPath,
      "--serial-rounds", "1",
      ...mobileCommon,
    ],
  });

  runNode({
    script: "scripts/maintainer/mobile-soak-run.mjs",
    scriptArgs: [
      "--out-dir", s50Run2Dir,
      "--barcodes-json", stratifiedPath,
      "--serial-rounds", "1",
      ...mobileCommon,
    ],
  });

  const killerRun = runNodeSoft({
    script: "scripts/maintainer/mobile-soak-run.mjs",
    scriptArgs: [
      "--api-base-url", apiBaseUrl,
      "--out-dir", killer10Dir,
      "--barcodes-json", killerPath,
      "--serial-rounds", "0",
      "--concurrent-rounds", "0",
      "--skip-cold-hot",
      "--no-open-result-screen",
      "--killer-cold-runs", "5",
      "--killer-hot-runs", "5",
      "--killer-barcode", killerBarcode,
      ...mobileThresholdArgs,
    ],
  });
  if (!killerRun.ok) {
    killerFallbackUsed = true;
    killerFailureReason = `primary_killer_run_failed_status_${killerRun.status}`;
    runNode({
      script: "scripts/maintainer/mobile-soak-run.mjs",
      scriptArgs: [
        "--api-base-url", apiBaseUrl,
        "--out-dir", killer10Dir,
        "--barcodes-json", killerPath,
        "--serial-rounds", "1",
        "--concurrent-rounds", "0",
        "--skip-cold-hot",
        "--no-open-result-screen",
        "--killer-cold-runs", "0",
        "--killer-hot-runs", "0",
        "--killer-barcode", killerBarcode,
        ...mobileThresholdArgs,
      ],
    });
  }

  runNode({
    script: "scripts/maintainer/run-backend-gates-stable.mjs",
    scriptArgs: [
      "--api-base-url", apiBaseUrl,
      "--out-dir", reconcileDir,
      "--mobile-soak-summary", path.join(s50Run2Dir, "rounds_summary.json"),
      ...fastGateArgs,
      ...(mode === "patch" ? ["--skip-shadow-reports"] : []),
    ],
  });

  let patchStatusAfter = null;
  try {
    const statusResp = await fetchJson(patchStatusUrl, headers);
    patchStatusAfter = statusResp.body;
  } catch {
    patchStatusAfter = null;
  }

  const report = {
    generatedAt: new Date().toISOString(),
    mode,
    apiBaseUrl,
    outDir,
    stageCDir,
    inputs: {
      barcodesJsonPath,
      stratifiedPath,
      killerPath,
      barcodesCount: roleBarcodes.length,
      barcodesHash: hashObject(roleBarcodes.map((row) => row.barcode)),
    },
    outputs: {
      stableDir,
      s50Run1Dir,
      s50Run2Dir,
      killer10Dir,
      reconcileDir,
    },
    patchActivationEvidence: {
      statusUrl: patchStatusUrl,
      before: patchStatusBefore,
      after: patchStatusAfter,
      patchModeConfirmed:
        mode === "patch"
          ? Boolean(patchStatusAfter?.enabled) && Number(patchStatusAfter?.candidatesLoaded ?? 0) > 0
          : Boolean(patchStatusAfter?.enabled) === false,
      candidatesPath: patchStatusAfter?.candidatesPath ?? patchStatusBefore?.candidatesPath ?? null,
      candidatesHash: patchStatusAfter?.candidatesHash ?? patchStatusBefore?.candidatesHash ?? null,
      candidatesLoaded: Number(patchStatusAfter?.candidatesLoaded ?? patchStatusBefore?.candidatesLoaded ?? 0),
      candidateScopeId: patchStatusAfter?.candidateScopeId ?? patchStatusBefore?.candidateScopeId ?? null,
      runtimePatchHitCountBefore: Number(patchStatusBefore?.runtimePatchHitCount ?? 0),
      runtimePatchHitCountAfter: Number(patchStatusAfter?.runtimePatchHitCount ?? 0),
      runtimePatchHitCountDelta:
        Number(patchStatusAfter?.runtimePatchHitCount ?? 0) - Number(patchStatusBefore?.runtimePatchHitCount ?? 0),
    },
    killerExecution: {
      fallbackUsed: killerFallbackUsed,
      fallbackReason: killerFailureReason,
    },
    fastGates,
  };

  await writeJson(path.join(outDir, "stage_c_sequence_report.json"), report);
  await writeJsonl(path.join(outDir, "stage_c_sequence_barcodes.jsonl"), roleBarcodes);

  console.log("[stage-c-sequence] completed");
  console.log(JSON.stringify({
    mode,
    outDir,
    barcodesCount: roleBarcodes.length,
    patchModeConfirmed: report.patchActivationEvidence.patchModeConfirmed,
    runtimePatchHitCountDelta: report.patchActivationEvidence.runtimePatchHitCountDelta,
  }, null, 2));
};

main().catch((error) => {
  console.error("[stage-c-sequence] failed:", error instanceof Error ? error.stack || error.message : String(error));
  process.exit(1);
});
