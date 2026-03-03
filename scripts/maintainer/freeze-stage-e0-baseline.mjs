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

const writeText = async (filePath, body) => {
  await ensureDir(path.dirname(filePath));
  await fs.writeFile(filePath, body, "utf8");
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
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
};

const gitValue = (cmd) => {
  const proc = spawnSync("bash", ["-lc", cmd], {
    cwd: ROOT_DIR,
    stdio: ["ignore", "pipe", "ignore"],
  });
  if (proc.status !== 0) return null;
  return String(proc.stdout || "").trim() || null;
};

const main = async () => {
  const stageDDir = resolvePath(getArg("stage-d-dir")) || await newestOutputDirByPrefix("v1.6.13-stage-d-");
  if (!stageDDir) {
    console.error("[freeze-stage-e0-baseline] missing --stage-d-dir and no stage-d output found");
    process.exit(1);
  }

  const stageCFromArg = resolvePath(getArg("stage-c-dir"));
  const stageEOut = resolvePath(getArg("stage-e-dir")) || path.join(OUTPUT_ROOT, `v1.6.14-stage-e-${new Date().toISOString().replace(/[:.]/g, "-")}`);
  const outDir = resolvePath(getArg("out-dir")) || path.join(stageEOut, "e0_baseline");

  const opsReportPath = path.join(stageDDir, "stage_d_ops_cycle_report.json");
  const opsReport = await readJson(opsReportPath);
  const cycleReports = Array.isArray(opsReport?.cycleReports) ? opsReport.cycleReports : [];
  const latestCycle = cycleReports[cycleReports.length - 1] || null;
  const latestCycleDir = latestCycle?.cycleDir ? resolvePath(latestCycle.cycleDir) : null;

  const d0ProofPath = latestCycleDir
    ? path.join(latestCycleDir, "d0_runtime_hit", "stage_d0_runtime_hit_proof.json")
    : null;
  const lane2DecisionPath = latestCycleDir
    ? path.join(latestCycleDir, "d1_5_lane2", "lane2_decision.json")
    : null;

  const d0Proof = d0ProofPath ? await readJson(d0ProofPath).catch(() => null) : null;
  const lane2Decision = lane2DecisionPath ? await readJson(lane2DecisionPath).catch(() => null) : null;

  const stageCDir = stageCFromArg
    || resolvePath(opsReport?.stageCDir)
    || (latestCycleDir ? resolvePath(path.join(latestCycleDir, "..", "..")) : null);

  const flagsSnapshot = {
    KEY_CONTRACT_V2: process.env.KEY_CONTRACT_V2 ?? null,
    WRITE_GUARD_V2: process.env.WRITE_GUARD_V2 ?? null,
    METADATA_READONLY: process.env.METADATA_READONLY ?? null,
    STAGE0_PROTOCOL_UNIFIED: process.env.STAGE0_PROTOCOL_UNIFIED ?? null,
    PATCH_SHADOW_ENABLE: process.env.PATCH_SHADOW_ENABLE ?? null,
  };

  const manifest = {
    generatedAt: new Date().toISOString(),
    gitCommit: gitValue("git rev-parse HEAD"),
    branch: gitValue("git rev-parse --abbrev-ref HEAD"),
    env: process.env.STAGE_E_ENV || process.env.NODE_ENV || "local",
    flagsSnapshot,
    stageDArtifacts: {
      stageDDir,
      stageCDir,
      opsReportPath,
      latestCycleDir,
      d0ProofPath,
      lane2DecisionPath,
    },
    lanePolicy: {
      lane1_active: "patch_directions_text_v1",
      lane2_primary: "patch_probiotics_strain_cfu_v1",
      fish_oil_lane: "repair_only",
    },
    metricFormulaVersion: "v1.6.14-stage-e0-1",
  };

  const metrics = {
    stageDPass: Boolean(opsReport?.pass),
    cycles: asNumber(opsReport?.cycles, 0),
    successfulCycles: asNumber(opsReport?.summary?.successfulCycles, 0),
    noRegression: Boolean(opsReport?.summary?.noRegression),
    runtimePatchHitSampleRate: asNumber(d0Proof?.metrics?.runtimePatchHitSampleRate, 0),
    visibleDirectionsImprovementRate: asNumber(d0Proof?.metrics?.visibleDirectionsImprovementRate, 0),
    payloadDirectionsImprovementRate: asNumber(d0Proof?.metrics?.payloadDirectionsImprovementRate, 0),
    lane2Decision: lane2Decision?.decision || null,
    lane2Replacement: lane2Decision?.replacementLaneCandidate || null,
  };

  const lockMd = [
    "# Stage E0 Baseline Lock",
    "",
    `- generatedAt: ${manifest.generatedAt}`,
    `- stageDDir: ${stageDDir}`,
    `- stageCDir: ${stageCDir || "unknown"}`,
    `- lane1 active: ${manifest.lanePolicy.lane1_active}`,
    `- lane2 primary: ${manifest.lanePolicy.lane2_primary}`,
    `- fish_oil policy: ${manifest.lanePolicy.fish_oil_lane}`,
    "",
    "## Metrics Baseline",
    `- stageDPass: ${metrics.stageDPass}`,
    `- cycles: ${metrics.cycles}`,
    `- successfulCycles: ${metrics.successfulCycles}`,
    `- noRegression: ${metrics.noRegression}`,
    `- runtimePatchHitSampleRate: ${metrics.runtimePatchHitSampleRate}`,
    `- visibleDirectionsImprovementRate: ${metrics.visibleDirectionsImprovementRate}`,
    `- payloadDirectionsImprovementRate: ${metrics.payloadDirectionsImprovementRate}`,
    `- lane2Decision: ${metrics.lane2Decision}`,
    `- lane2Replacement: ${metrics.lane2Replacement}`,
  ].join("\n");

  await writeJson(path.join(outDir, "stage_e0_manifest.json"), manifest);
  await writeJson(path.join(outDir, "stage_e0_metrics_baseline.json"), metrics);
  await writeText(path.join(outDir, "stage_e0_scope_lock.md"), `${lockMd}\n`);

  console.log("[freeze-stage-e0-baseline] completed");
  console.log(JSON.stringify({
    outDir,
    stageDDir,
    stageCDir,
    lane2Primary: manifest.lanePolicy.lane2_primary,
  }, null, 2));
};

main().catch((error) => {
  console.error("[freeze-stage-e0-baseline] failed:", error instanceof Error ? error.stack || error.message : String(error));
  process.exit(1);
});
