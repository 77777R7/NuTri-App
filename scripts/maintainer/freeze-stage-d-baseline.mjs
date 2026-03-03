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

const gitValue = (cmd) => {
  const proc = spawnSync("bash", ["-lc", cmd], {
    cwd: ROOT_DIR,
    stdio: ["ignore", "pipe", "ignore"],
  });
  if (proc.status !== 0) return null;
  return String(proc.stdout || "").trim() || null;
};

const clamp = (value, fallback = 0) => {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
};

const main = async () => {
  const stageCDir = resolvePath(getArg("stage-c-dir")) || await newestOutputDirByPrefix("v1.6.12-stage-c-");
  if (!stageCDir) {
    console.error("[freeze-stage-d-baseline] missing --stage-c-dir and no stage-c output found");
    process.exit(1);
  }

  const ts = new Date().toISOString().replace(/[:.]/g, "-");
  const stageDRoot = resolvePath(getArg("stage-d-root")) || path.join(OUTPUT_ROOT, `v1.6.13-stage-d-${ts}`);
  const outDir = resolvePath(getArg("out-dir")) || path.join(stageDRoot, "d0_baseline");

  const gateReportPath = path.join(stageCDir, "c4_to_c6", "c6_closeout", "stage_c_gate_report.json");
  const laneDecisionPath = path.join(stageCDir, "c4_to_c6", "c5_enforce", "stage_c_lane_enforce_decision.json");
  const enforceReadyPath = path.join(stageCDir, "c4_to_c6", "c4_5_postfilter", "stage_c_patch_enforce_ready.jsonl");
  const fixableQueuePath = path.join(stageCDir, "c4_to_c6", "c6_closeout", "stage_c_fixable_repair_queue.jsonl");

  const gate = await readJson(gateReportPath);
  const lane = await readJson(laneDecisionPath);
  const gitCommit = gitValue("git rev-parse HEAD");
  const branch = gitValue("git rev-parse --abbrev-ref HEAD");

  const flagsSnapshot = {
    KEY_CONTRACT_V2: process.env.KEY_CONTRACT_V2 ?? null,
    WRITE_GUARD_V2: process.env.WRITE_GUARD_V2 ?? null,
    METADATA_READONLY: process.env.METADATA_READONLY ?? null,
    STAGE0_PROTOCOL_UNIFIED: process.env.STAGE0_PROTOCOL_UNIFIED ?? null,
    PATCH_SHADOW_ENABLE: process.env.PATCH_SHADOW_ENABLE ?? null,
  };

  const manifest = {
    generatedAt: new Date().toISOString(),
    gitCommit,
    branch,
    env: process.env.STAGE_D_ENV || process.env.NODE_ENV || "local",
    flagsSnapshot,
    stageCArtifacts: {
      stageCDir,
      gateReportPath,
      laneDecisionPath,
      enforceReadyPath,
      fixableQueuePath,
    },
    metricFormulaVersion: "v1.6.13-stage-d-1",
    lanePolicy: {
      lane1: "patch_directions_text_v1",
      lane2: "triage_only",
      lane2Blocking: false,
    },
  };

  const metrics = {
    pass: Boolean(gate?.pass),
    lane1Enforce: Boolean(gate?.laneResults?.lane1_directions?.enforceDecision === "pass"),
    lane2Enforce: Boolean(gate?.laneResults?.lane2_dynamic?.enforceDecision === "pass"),
    conflict_rate: clamp(gate?.metrics?.conflict_rate, 1),
    conflict_abs: clamp(gate?.metrics?.conflict_abs, 999),
    doneSeenRate_control: clamp(gate?.metrics?.doneSeenRate_control, 0),
    doneSeenRate_patch: clamp(gate?.metrics?.doneSeenRate_patch, 0),
    scoreVisibleRate_control: clamp(gate?.metrics?.scoreVisibleRate_control, 0),
    scoreVisibleRate_patch: clamp(gate?.metrics?.scoreVisibleRate_patch, 0),
    runtimePatchHitCountDelta: clamp(gate?.patchActivationEvidence?.runtimePatchHitCountDelta, 0),
    laneDecisions: lane?.laneDecisions ?? [],
  };

  const lockMd = [
    "# Stage D Baseline Lock",
    "",
    `- generatedAt: ${manifest.generatedAt}`,
    `- gitCommit: ${manifest.gitCommit || "unknown"}`,
    `- branch: ${manifest.branch || "unknown"}`,
    `- env: ${manifest.env}`,
    `- stageC: ${stageCDir}`,
    "",
    "## Frozen Metrics",
    `- stageC pass: ${metrics.pass}`,
    `- lane1 enforce: ${metrics.lane1Enforce}`,
    `- lane2 enforce: ${metrics.lane2Enforce}`,
    `- conflict_rate: ${metrics.conflict_rate}`,
    `- conflict_abs: ${metrics.conflict_abs}`,
    `- doneSeenRate control/patch: ${metrics.doneSeenRate_control} / ${metrics.doneSeenRate_patch}`,
    `- scoreVisibleRate control/patch: ${metrics.scoreVisibleRate_control} / ${metrics.scoreVisibleRate_patch}`,
    `- runtimePatchHitCountDelta: ${metrics.runtimePatchHitCountDelta}`,
  ].join("\n");

  await writeJson(path.join(outDir, "stage_d_baseline_manifest.json"), manifest);
  await writeJson(path.join(outDir, "stage_d_baseline_metrics.json"), metrics);
  await writeText(path.join(outDir, "stage_d_baseline_lock.md"), `${lockMd}\n`);

  console.log("[freeze-stage-d-baseline] completed");
  console.log(JSON.stringify({ outDir, stageCDir, pass: metrics.pass }, null, 2));
};

main().catch((error) => {
  console.error("[freeze-stage-d-baseline] failed:", error instanceof Error ? error.stack || error.message : String(error));
  process.exit(1);
});
