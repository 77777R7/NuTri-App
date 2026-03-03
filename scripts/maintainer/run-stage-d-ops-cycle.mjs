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

const runNode = ({ script, scriptArgs, allowFailure = false }) => {
  const cmd = [script, ...scriptArgs];
  console.log(`[stage-d-ops-cycle] node ${cmd.join(" ")}`);
  const proc = spawnSync("node", cmd, {
    cwd: ROOT_DIR,
    stdio: "inherit",
    env: process.env,
  });
  if (!allowFailure && proc.status !== 0) {
    throw new Error(`command_failed: node ${cmd.join(" ")} status=${proc.status}`);
  }
  return {
    ok: proc.status === 0,
    status: proc.status ?? 1,
  };
};

const collectBatchReports = async (cycleDir, batchManifestPath) => {
  const batchManifest = await readJson(batchManifestPath).catch(() => null);
  const batches = Array.isArray(batchManifest?.batches) ? batchManifest.batches : [];
  const reports = [];
  for (const batch of batches) {
    const batchId = String(batch.patchBatchId || "");
    if (!batchId) continue;
    const reportPath = path.join(cycleDir, "d1_batches", batchId, "stage_d1_batch_gate_report.json");
    const report = await readJson(reportPath).catch(() => null);
    if (report) {
      reports.push({ batchId, reportPath, report });
    }
  }
  return reports;
};

const computeDanglingWarnings = async (batchReports) => {
  let dangling = 0;
  for (const row of batchReports) {
    const fixablePath = row?.report?.gate?.outputs?.fixableQueuePath;
    const ceilingPath = row?.report?.gate?.outputs?.ceilingQueuePath;
    const fixable = await readJsonl(fixablePath || "");
    const ceiling = await readJsonl(ceilingPath || "");
    for (const item of [...fixable, ...ceiling]) {
      const hasRoute = Boolean(String(item?.reasonCode || "").trim());
      if (!hasRoute) dangling += 1;
    }
  }
  return dangling;
};

const runCycle = async ({
  cycleIndex,
  cycles,
  stageCDir,
  stageDDir,
  controlApiBaseUrl,
  patchApiBaseUrl,
  regressionToken,
  bearerToken,
  maxBatches,
  allowD0Fail,
  allowIsolationFail,
}) => {
  const cycleTag = `cycle-${String(cycleIndex).padStart(2, "0")}`;
  const cycleDir = path.join(stageDDir, cycleTag);
  await ensureDir(cycleDir);
  const steps = [];

  runNode({
    script: "scripts/maintainer/freeze-stage-d-baseline.mjs",
    scriptArgs: [
      "--stage-c-dir", stageCDir,
      "--stage-d-root", cycleDir,
      "--out-dir", path.join(cycleDir, "d0_baseline"),
    ],
  });
  steps.push({ step: "d0_baseline", pass: true });

  runNode({
    script: "scripts/maintainer/build-stage-d0-sample-manifest.mjs",
    scriptArgs: [
      "--stage-c-dir", stageCDir,
      "--stage-d-root", cycleDir,
      "--out-dir", path.join(cycleDir, "d0_runtime_hit"),
      "--negative-count", "10",
    ],
  });
  steps.push({ step: "d0_sample_manifest", pass: true });

  const d0Run = runNode({
    script: "scripts/maintainer/run-stage-d0-runtime-hit-proof.mjs",
    scriptArgs: [
      "--stage-c-dir", stageCDir,
      "--stage-d-root", cycleDir,
      "--out-dir", path.join(cycleDir, "d0_runtime_hit"),
      "--sample-manifest", path.join(cycleDir, "d0_runtime_hit", "stage_d0_sample_manifest.json"),
      "--control-api-base-url", controlApiBaseUrl,
      "--patch-api-base-url", patchApiBaseUrl,
      ...(regressionToken ? ["--regression-token", regressionToken] : []),
      ...(bearerToken ? ["--bearer-token", bearerToken] : []),
    ],
    allowFailure: true,
  });
  steps.push({ step: "d0_runtime_hit_proof", pass: d0Run.ok, status: d0Run.status });
  if (!d0Run.ok && !allowD0Fail) {
    return {
      cycleTag,
      cycleDir,
      pass: false,
      failReason: "d0_runtime_hit_proof_failed",
      steps,
    };
  }

  runNode({
    script: "scripts/maintainer/build-stage-d1-brand-batches.mjs",
    scriptArgs: [
      "--stage-c-dir", stageCDir,
      "--stage-d-root", cycleDir,
      "--out-dir", path.join(cycleDir, "d1_batches"),
      "--max-batches", String(maxBatches),
    ],
  });
  steps.push({ step: "d1_build_batches", pass: true });

  const batchManifestPath = path.join(cycleDir, "d1_batches", "brand_batch_manifest.json");
  const batchManifest = await readJson(batchManifestPath);
  const batches = Array.isArray(batchManifest?.batches) ? batchManifest.batches.slice(0, maxBatches) : [];

  const batchResults = [];
  for (const batch of batches) {
    const run = runNode({
      script: "scripts/maintainer/run-stage-d1-batch.mjs",
      scriptArgs: [
        "--stage-c-dir", stageCDir,
        "--stage-d-root", cycleDir,
        "--batch-manifest", batchManifestPath,
        "--batch-id", String(batch.patchBatchId),
        "--control-api-base-url", controlApiBaseUrl,
        "--patch-api-base-url", patchApiBaseUrl,
        ...(allowIsolationFail ? ["--allow-isolation-fail"] : []),
        ...(regressionToken ? ["--regression-token", regressionToken] : []),
        ...(bearerToken ? ["--bearer-token", bearerToken] : []),
      ],
      allowFailure: true,
    });
    batchResults.push({ batchId: batch.patchBatchId, pass: run.ok, status: run.status });
  }
  steps.push({ step: "d1_batches", pass: batchResults.every((row) => row.pass), batchResults });

  runNode({
    script: "scripts/maintainer/run-stage-d1-5-lane2-triage.mjs",
    scriptArgs: [
      "--stage-c-dir", stageCDir,
      "--stage-d-root", cycleDir,
      "--out-dir", path.join(cycleDir, "d1_5_lane2"),
    ],
  });
  steps.push({ step: "d1_5_lane2", pass: true });

  const d0Proof = await readJson(path.join(cycleDir, "d0_runtime_hit", "stage_d0_runtime_hit_proof.json")).catch(() => null);
  const batchReports = await collectBatchReports(cycleDir, batchManifestPath);
  const successfulBatches = batchResults.filter((row) => row.pass).length;
  const minSuccessfulBatches = Math.min(2, batches.length);

  const unassignedCount = batchReports.reduce(
    (sum, row) => sum + asNumber(row?.report?.unassignedCount, 0),
    0,
  );
  const ownerCoverageRate = batchReports.length > 0
    ? Number((batchReports.reduce((sum, row) => sum + asNumber(row?.report?.ownerCoverageRate, 0), 0) / batchReports.length).toFixed(6))
    : 0;
  const ttlReviewCompleteness = batchReports.length > 0 && batchReports.every((row) => {
    const queueRows = row?.report?.gate?.c5?.laneDecisions || [];
    return Array.isArray(queueRows);
  }) ? 1 : 0;
  const danglingWarningsCount = await computeDanglingWarnings(batchReports);

  const lane2Decision = await readJson(path.join(cycleDir, "d1_5_lane2", "lane2_decision.json")).catch(() => null);

  const pass = Boolean(d0Run.ok)
    && successfulBatches >= minSuccessfulBatches
    && Boolean(lane2Decision?.decision)
    && unassignedCount === 0
    && ttlReviewCompleteness === 1
    && danglingWarningsCount === 0;

  const report = {
    generatedAt: new Date().toISOString(),
    cycleTag,
    cycleIndex,
    cycles,
    stageCDir,
    cycleDir,
    pass,
    criteria: {
      d0PassRequired: true,
      minSuccessfulBatches,
      lane2DecisionRequired: true,
      unassignedCountMustBeZero: true,
      ttlReviewCompletenessMustBeOne: true,
      danglingWarningsMustBeZero: true,
    },
    summary: {
      d0Pass: d0Run.ok,
      successfulBatches,
      totalBatches: batches.length,
      lane2Decision: lane2Decision?.decision || null,
      runtimePatchHitSampleRate: asNumber(d0Proof?.metrics?.runtimePatchHitSampleRate, 0),
      visibleDirectionsImprovementRate: asNumber(d0Proof?.metrics?.visibleDirectionsImprovementRate, 0),
      ownerCoverageRate,
      unassignedCount,
      ttlReviewCompleteness,
      danglingWarningsCount,
    },
    steps,
  };

  await writeJson(path.join(cycleDir, "stage_d_ops_cycle_report.json"), report);
  return {
    cycleTag,
    cycleDir,
    pass,
    report,
  };
};

const main = async () => {
  const stageCDir = resolvePath(getArg("stage-c-dir")) || await newestOutputDirByPrefix("v1.6.12-stage-c-");
  if (!stageCDir) {
    console.error("[run-stage-d-ops-cycle] missing --stage-c-dir and no stage-c output found");
    process.exit(1);
  }

  const ts = new Date().toISOString().replace(/[:.]/g, "-");
  const stageDDir = resolvePath(getArg("stage-d-dir")) || path.join(OUTPUT_ROOT, `v1.6.13-stage-d-${ts}`);
  await ensureDir(stageDDir);

  const controlApiBaseUrl = String(getArg("control-api-base-url", process.env.STAGING_CONTROL_API_BASE_URL || "")).trim();
  const patchApiBaseUrl = String(getArg("patch-api-base-url", process.env.STAGING_PATCH_API_BASE_URL || "")).trim();
  if (!controlApiBaseUrl || !patchApiBaseUrl) {
    console.error("[run-stage-d-ops-cycle] missing control/patch api base url");
    process.exit(1);
  }

  const regressionToken = String(getArg("regression-token", process.env.REGRESSION_AUTH_TOKEN || "")).trim();
  const bearerToken = String(getArg("bearer-token", process.env.STAGE_D_BEARER_TOKEN || "")).trim();
  const maxBatches = Math.max(1, Number(getArg("max-batches", "2")) || 2);
  const cycles = Math.max(2, Number(getArg("cycles", "2")) || 2);
  const allowD0Fail = hasFlag("allow-d0-fail");
  const allowIsolationFail = hasFlag("allow-isolation-fail");

  const cycleReports = [];
  for (let i = 1; i <= cycles; i += 1) {
    const cycleRun = await runCycle({
      cycleIndex: i,
      cycles,
      stageCDir,
      stageDDir,
      controlApiBaseUrl,
      patchApiBaseUrl,
      regressionToken,
      bearerToken,
      maxBatches,
      allowD0Fail,
      allowIsolationFail,
    });
    cycleReports.push(cycleRun);
  }

  const noRegression = cycleReports.every((cycle, idx) => {
    if (idx === 0) return true;
    const prev = cycleReports[idx - 1]?.report?.summary || {};
    const curr = cycle?.report?.summary || {};
    return asNumber(curr.runtimePatchHitSampleRate, 0) >= asNumber(prev.runtimePatchHitSampleRate, 0)
      && asNumber(curr.visibleDirectionsImprovementRate, 0) >= asNumber(prev.visibleDirectionsImprovementRate, 0);
  });

  const pass = cycleReports.every((cycle) => cycle.pass)
    && noRegression;

  const report = {
    generatedAt: new Date().toISOString(),
    stageCDir,
    stageDDir,
    cycles,
    pass,
    criteria: {
      eachCyclePass: true,
      noRegressionRuntimeHitAndVisibleImprovement: true,
    },
    summary: {
      successfulCycles: cycleReports.filter((cycle) => cycle.pass).length,
      totalCycles: cycleReports.length,
      noRegression,
    },
    cycleReports: cycleReports.map((cycle) => ({
      cycleTag: cycle.cycleTag,
      cycleDir: cycle.cycleDir,
      pass: cycle.pass,
      summary: cycle.report?.summary || null,
    })),
  };

  await writeJson(path.join(stageDDir, "stage_d_ops_cycle_report.json"), report);

  console.log("[run-stage-d-ops-cycle] completed");
  console.log(JSON.stringify({ stageDDir, pass, cycles, noRegression }, null, 2));

  if (!pass) process.exit(3);
};

main().catch((error) => {
  console.error("[run-stage-d-ops-cycle] failed:", error instanceof Error ? error.stack || error.message : String(error));
  process.exit(1);
});
