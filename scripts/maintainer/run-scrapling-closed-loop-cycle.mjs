#!/usr/bin/env node
/* eslint-disable no-console */
import fs from "node:fs/promises";
import path from "node:path";
import { spawn } from "node:child_process";

const ROOT = process.cwd();
const args = process.argv.slice(2);

const getArg = (name, fallback = null) => {
  const flag = `--${name}`;
  const idx = args.indexOf(flag);
  if (idx === -1 || idx + 1 >= args.length) return fallback;
  return args[idx + 1];
};

const normalizeText = (value) => (value == null ? "" : String(value).trim());
const normalizeLower = (value) => normalizeText(value).toLowerCase();
const timestampSlug = () => new Date().toISOString().replace(/[:.]/g, "-");

const EXECUTE = normalizeLower(getArg("execute", "true")) === "true";
const CYCLE_TAG = getArg("cycle-tag", timestampSlug());
const MASTER_QUEUE_OUT_DIR = path.resolve(
  ROOT,
  getArg("master-queue-out-dir", path.join("output", `scrapling_human_supplement_master_queue_${CYCLE_TAG}`)),
);
const MANIFEST_OUT_DIR = path.resolve(
  ROOT,
  getArg("manifest-out-dir", path.join("output", `scrapling_wave_manifest_${CYCLE_TAG}`)),
);
const BULK_OUT_DIR = path.resolve(
  ROOT,
  getArg("bulk-out-dir", path.join("output", `scrapling_bulk_program_${CYCLE_TAG}`)),
);
const REPORT_OUT_DIR = path.resolve(
  ROOT,
  getArg("report-out-dir", path.join("output", `scrapling_program_report_${CYCLE_TAG}`)),
);
const REGISTRY_PATH = path.resolve(
  ROOT,
  getArg(
    "registry-json",
    path.join("docs", "exec-plans", "active", "p0_p3_product_closure", "scrapling_lane_registry.v1.json"),
  ),
);

const writeJson = async (filePath, payload) => {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
};

const writeText = async (filePath, body) => {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, body, "utf8");
};

const readJson = async (filePath) => JSON.parse(await fs.readFile(filePath, "utf8"));

const runNodeScript = async ({ scriptPath, scriptArgs, logPath }) =>
  new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [scriptPath, ...scriptArgs], {
      cwd: ROOT,
      env: process.env,
      stdio: ["ignore", "pipe", "pipe"],
    });

    let stdout = "";
    let stderr = "";

    child.stdout.on("data", (chunk) => {
      stdout += chunk.toString();
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString();
    });
    child.on("error", reject);
    child.on("close", async (code) => {
      const body = [
        `$ ${[process.execPath, scriptPath, ...scriptArgs].join(" ")}`,
        "",
        "## stdout",
        stdout.trim() || "(empty)",
        "",
        "## stderr",
        stderr.trim() || "(empty)",
        "",
        `exitCode: ${code}`,
        "",
      ].join("\n");
      await writeText(logPath, body);
      if (code !== 0) {
        reject(new Error(`Command failed (${code}): ${scriptPath}`));
        return;
      }
      resolve({ stdout, stderr, code });
    });
  });

const parseLastJsonObject = (text) => {
  const trimmed = String(text ?? "").trim();
  const lines = trimmed.split("\n").filter(Boolean);
  for (let idx = lines.length - 1; idx >= 0; idx -= 1) {
    const candidate = lines.slice(idx).join("\n");
    try {
      return JSON.parse(candidate);
    } catch {
      // keep scanning upward
    }
  }
  return null;
};

const main = async () => {
  const cycleRoot = path.resolve(ROOT, path.join("output", `scrapling_closed_loop_cycle_${CYCLE_TAG}`));
  const logsDir = path.join(cycleRoot, "logs");
  await fs.mkdir(logsDir, { recursive: true });
  const registryBeforePath = path.join(cycleRoot, "registry_before.json");
  const registryAfterPath = path.join(cycleRoot, "registry_after.json");
  const statusChangesPath = path.join(cycleRoot, "status_changes.json");
  const nextIterationActionsPath = path.join(cycleRoot, "next_iteration_actions.json");

  const registryBefore = await readJson(REGISTRY_PATH);
  await writeJson(registryBeforePath, registryBefore);

  const steps = [
    {
      id: "build_master_queue",
      script: path.join(ROOT, "scripts", "maintainer", "build-human-supplement-master-queue.mjs"),
      args: ["--out-dir", MASTER_QUEUE_OUT_DIR],
    },
    {
      id: "build_manifest",
      script: path.join(ROOT, "scripts", "maintainer", "build-scrapling-wave-manifest.mjs"),
      args: ["--prioritized-brands", "all", "--out-dir", MANIFEST_OUT_DIR],
    },
    {
      id: "bulk_execute",
      script: path.join(ROOT, "scripts", "maintainer", "run-scrapling-bulk-program.mjs"),
      args: [
        "--manifest-json",
        path.join(MANIFEST_OUT_DIR, "scrapling_wave_manifest.json"),
        "--registry-json",
        REGISTRY_PATH,
        "--out-dir",
        BULK_OUT_DIR,
        "--execute",
        EXECUTE ? "true" : "false",
      ],
    },
    {
      id: "aggregate_report",
      script: path.join(ROOT, "scripts", "maintainer", "aggregate-scrapling-program-report.mjs"),
      args: [
        "--manifest-json",
        path.join(MANIFEST_OUT_DIR, "scrapling_wave_manifest.json"),
        "--program-summary-json",
        path.join(BULK_OUT_DIR, "scrapling_bulk_program_summary.json"),
        "--reports-root",
        path.join(ROOT, "output"),
        "--lane-registry-json",
        REGISTRY_PATH,
        "--out-dir",
        REPORT_OUT_DIR,
      ],
    },
    {
      id: "materialize_registry",
      script: path.join(ROOT, "scripts", "maintainer", "materialize-scrapling-lane-registry-v1.mjs"),
      args: [
        "--base-registry-json",
        REGISTRY_PATH,
        "--current-registry-json",
        path.join(REPORT_OUT_DIR, "scrapling_lane_registry_current.json"),
        "--manifest-json",
        path.join(MANIFEST_OUT_DIR, "scrapling_wave_manifest.json"),
        "--out-json",
        REGISTRY_PATH,
      ],
    },
  ];

  const executedSteps = [];
  for (const step of steps) {
    const logPath = path.join(logsDir, `${step.id}.log`);
    const result = await runNodeScript({
      scriptPath: step.script,
      scriptArgs: step.args.map((value) => String(value)),
      logPath,
    });
    executedSteps.push({
      id: step.id,
      logPath,
      parsedJson: parseLastJsonObject(result.stdout),
    });
  }

  const cycleSummary = {
    schemaVersion: "scrapling_closed_loop_cycle.v1",
    generatedAt: new Date().toISOString(),
    execute: EXECUTE,
    cycleTag: CYCLE_TAG,
    paths: {
      cycleRoot,
      masterQueueOutDir: MASTER_QUEUE_OUT_DIR,
      manifestOutDir: MANIFEST_OUT_DIR,
      bulkOutDir: BULK_OUT_DIR,
      reportOutDir: REPORT_OUT_DIR,
      registryPath: REGISTRY_PATH,
    },
    steps: executedSteps,
  };

  const summaryPath = path.join(cycleRoot, "scrapling_closed_loop_cycle_summary.json");
  const summaryMdPath = path.join(cycleRoot, "scrapling_closed_loop_cycle_summary.md");
  const registryAfter = await readJson(REGISTRY_PATH);
  await writeJson(registryAfterPath, registryAfter);

  const beforeMap = new Map(
    (registryBefore.laneStatuses ?? []).map((entry) => [
      `${entry.brandName}::${entry.sourceBucket}`,
      entry,
    ]),
  );
  const afterMap = new Map(
    (registryAfter.laneStatuses ?? []).map((entry) => [
      `${entry.brandName}::${entry.sourceBucket}`,
      entry,
    ]),
  );

  const allKeys = [...new Set([...beforeMap.keys(), ...afterMap.keys()])].sort();
  const statusChanges = allKeys
    .map((key) => {
      const before = beforeMap.get(key) ?? null;
      const after = afterMap.get(key) ?? null;
      return {
        laneKey: key,
        beforeStatus: before?.status ?? null,
        afterStatus: after?.status ?? null,
        changed: (before?.status ?? null) !== (after?.status ?? null),
        beforeReason: before?.reason ?? null,
        afterReason: after?.reason ?? null,
      };
    })
    .filter((item) => item.changed);
  await writeJson(statusChangesPath, statusChanges);

  const report = await readJson(path.join(REPORT_OUT_DIR, "scrapling_program_report.json"));
  const nextIterationActions = {
    schemaVersion: "scrapling_next_iteration_actions.v1",
    generatedAt: new Date().toISOString(),
    goLanes: (registryAfter.laneStatuses ?? []).filter((entry) => entry.status === "GO"),
    holdLanes: (registryAfter.laneStatuses ?? []).filter((entry) => entry.status === "HOLD"),
    stopLanes: (registryAfter.laneStatuses ?? []).filter((entry) => entry.status === "STOP"),
    topQuarantinedReasons: report?.summary?.quarantinedReasonCounts ?? [],
    staleUrls: report?.staleUrls ?? [],
  };
  await writeJson(nextIterationActionsPath, nextIterationActions);

  const md = [
    "# Scrapling Closed Loop Cycle",
    "",
    `- cycleTag: ${CYCLE_TAG}`,
    `- execute: ${EXECUTE}`,
    `- cycleRoot: ${cycleRoot}`,
    "",
    "## Paths",
    "",
    `- masterQueueOutDir: ${MASTER_QUEUE_OUT_DIR}`,
    `- manifestOutDir: ${MANIFEST_OUT_DIR}`,
    `- bulkOutDir: ${BULK_OUT_DIR}`,
    `- reportOutDir: ${REPORT_OUT_DIR}`,
    `- registryPath: ${REGISTRY_PATH}`,
    `- registryBefore: ${registryBeforePath}`,
    `- registryAfter: ${registryAfterPath}`,
    `- statusChanges: ${statusChangesPath}`,
    `- nextIterationActions: ${nextIterationActionsPath}`,
    "",
    "## Steps",
    "",
    ...executedSteps.map((step) => `- ${step.id}: ${step.logPath}`),
    "",
  ].join("\n");

  await writeJson(summaryPath, cycleSummary);
  await writeText(summaryMdPath, `${md}\n`);

  console.log(
    JSON.stringify(
      {
        ok: true,
        cycleRoot,
        summaryPath,
        summaryMdPath,
      },
      null,
      2,
    ),
  );
};

main().catch((error) => {
  console.error(error instanceof Error ? error.stack : String(error));
  process.exit(1);
});
