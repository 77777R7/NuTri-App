#!/usr/bin/env node
/* eslint-disable no-console */

import fs from "node:fs";
import path from "node:path";
import { spawn, spawnSync } from "node:child_process";

const args = process.argv.slice(2);
const getArg = (flag) => {
  const idx = args.indexOf(`--${flag}`);
  if (idx === -1) return null;
  return args[idx + 1] ?? null;
};
const hasFlag = (flag) => args.includes(`--${flag}`);

const mode = (getArg("mode") || "bootstrap").toLowerCase();
const rootDir = process.cwd();
const stamp = new Date().toISOString().replace(/[:]/g, "-");
const runId = getArg("run-id") || `npn-closure-${stamp}`;
const runDir = path.resolve(rootDir, "output/npn_webhunt/full_hunt", runId);
const queuesDir = path.resolve(rootDir, "output/npn_webhunt/queues", runId);
const domainYieldDir = path.resolve(rootDir, "output/npn_webhunt/domain_yield", runId);
const automationDir = path.resolve(rootDir, "output/npn_webhunt/automation", runId);

const ensureDir = (dirPath) => fs.mkdirSync(dirPath, { recursive: true });
const writeJson = (filePath, payload) => {
  ensureDir(path.dirname(filePath));
  fs.writeFileSync(filePath, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
};

const runStep = (name, cmdArgs, options = {}) => {
  console.log(`[npn-closure-automation] step=${name}`);
  console.log(`  cmd: ${[process.execPath, ...cmdArgs].join(" ")}`);
  const res = spawnSync(process.execPath, cmdArgs, {
    cwd: rootDir,
    env: process.env,
    stdio: "inherit",
    ...options,
  });
  if (res.status !== 0) {
    throw new Error(`step_failed:${name}:exit_${res.status}`);
  }
};

const startDetached = (name, cmdArgs, logPath) => {
  ensureDir(path.dirname(logPath));
  const outFd = fs.openSync(logPath, "a");
  const child = spawn(process.execPath, cmdArgs, {
    cwd: rootDir,
    env: process.env,
    detached: true,
    stdio: ["ignore", outFd, outFd],
  });
  child.unref();
  console.log(`[npn-closure-automation] started ${name} pid=${child.pid} log=${logPath}`);
  return child.pid;
};

const findLatestQueueFile = (baseDir) => {
  try {
    const dirs = fs
      .readdirSync(baseDir, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name)
      .sort();
    for (let i = dirs.length - 1; i >= 0; i -= 1) {
      const queueFile = path.join(baseDir, dirs[i], "uncovered_full.jsonl");
      if (fs.existsSync(queueFile)) return queueFile;
    }
  } catch {
    // ignore
  }
  return null;
};

const bootstrap = () => {
  ensureDir(automationDir);

  runStep("M0_baseline", ["--import", "tsx", "backend/scripts/freeze-npn-baseline-snapshot.ts", "--label", runId]);

  runStep("M1_backfill", ["--import", "tsx", "backend/scripts/backfill-lnhpd-barcode-candidates-from-map.ts"]);

  runStep("M2_queue", [
    "--import",
    "tsx",
    "backend/scripts/build-lnhpd-uncovered-npn-queue.ts",
    "--out-dir",
    queuesDir,
  ]);

  const queueFile = path.join(queuesDir, "uncovered_full.jsonl");
  const latestQueueDir = path.resolve(rootDir, "output/npn_webhunt/queues/latest");
  ensureDir(latestQueueDir);
  fs.copyFileSync(queueFile, path.join(latestQueueDir, "uncovered_full.jsonl"));
  fs.copyFileSync(path.join(queuesDir, "summary.json"), path.join(latestQueueDir, "summary.json"));

  runStep("M2_probe_domain_yield", [
    "--import",
    "tsx",
    "backend/scripts/probe-domain-yield.ts",
    "--out-dir",
    domainYieldDir,
    "--npn-allowlist-file",
    queueFile,
  ]);

  const scoreboardPath = path.join(domainYieldDir, "domain_scoreboard.json");

  const supervisorPid = startDetached(
    "M2_M3_supervisor",
    [
      "--import",
      "tsx",
      "backend/scripts/run-npn-full-hunt-supervisor.ts",
      "--run-id",
      runId,
      "--run-dir",
      runDir,
      "--queue-file",
      queueFile,
      "--domain-scoreboard-json",
      scoreboardPath,
      "--run-hours",
      getArg("run-hours") || "24",
      "--batch-size",
      getArg("batch-size") || "2000",
      "--max-attempts-per-npn",
      getArg("max-attempts-per-npn") || "2",
      ...(hasFlag("dry-run") ? ["--dry-run"] : []),
    ],
    path.join(runDir, "supervisor.log"),
  );

  const watchPid = startDetached(
    "watcher",
    [
      "scripts/maintainer/npn-full-hunt-watch.mjs",
      "--run-dir",
      runDir,
      "--interval-sec",
      getArg("watch-interval-sec") || "60",
      "--no-exit-when-stopped",
    ],
    path.join(runDir, "monitoring/watch.log"),
  );

  runStep("hourly_kpi_snapshot", [
    "scripts/maintainer/npn-hourly-kpi-report.mjs",
    "--run-dir",
    runDir,
  ]);

  const state = {
    generatedAt: new Date().toISOString(),
    mode: "bootstrap",
    runId,
    runDir,
    queueFile,
    queuesDir,
    domainYieldDir,
    scoreboardPath,
    supervisorPid,
    watchPid,
    commands: {
      hourlyKpi: `node scripts/maintainer/npn-hourly-kpi-report.mjs --run-dir ${runDir}`,
      stopWatch: `scripts/maintainer/stop-npn-full-hunt-watch.sh ${runDir}`,
      followWatchLog: `tail -f ${path.join(runDir, "monitoring/watch.log")}`,
      followSupervisorLog: `tail -f ${path.join(runDir, "supervisor.log")}`,
    },
  };

  writeJson(path.join(automationDir, "automation_state.json"), state);
  console.log(JSON.stringify({ ok: true, statePath: path.join(automationDir, "automation_state.json"), state }, null, 2));
};

const status = () => {
  const runDirArg = getArg("run-dir");
  if (!runDirArg) {
    throw new Error("status mode requires --run-dir");
  }
  runStep("hourly_kpi_status", [
    "scripts/maintainer/npn-hourly-kpi-report.mjs",
    "--run-dir",
    runDirArg,
  ]);
};

try {
  if (mode === "bootstrap") {
    bootstrap();
  } else if (mode === "status") {
    status();
  } else {
    throw new Error(`unsupported_mode:${mode}`);
  }
} catch (error) {
  console.error("[npn-closure-automation] fatal:", error?.message ?? error);
  process.exit(1);
}
