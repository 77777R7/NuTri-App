#!/usr/bin/env node
/* eslint-disable no-console */

import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";

const args = process.argv.slice(2);
const getArg = (flag) => {
  const idx = args.indexOf(`--${flag}`);
  if (idx === -1) return null;
  return args[idx + 1] ?? null;
};
const hasFlag = (flag) => args.includes(`--${flag}`);
const asNumber = (value, fallback) => {
  if (value == null) return fallback;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
};

const nowStamp = new Date().toISOString().replace(/[:]/g, "-");
const outParent =
  getArg("out-parent") ??
  path.resolve(process.cwd(), "output/npn_webhunt/runtime_signal_loop", nowStamp);
const lookbackHours = Math.max(1, asNumber(getArg("lookback-hours"), 24 * 90));
const b1BatchSize = Math.max(300, Math.min(500, asNumber(getArg("b1-batch-size"), 400)));
const b1MaxBatches = Math.max(1, asNumber(getArg("b1-max-batches"), 2));
const b1RunHours = Math.max(1, asNumber(getArg("b1-run-hours"), 6));
const b1StoplossYield = Math.max(0, asNumber(getArg("b1-stoploss-yield"), 1));
const b1StoplossHours = Math.max(1, asNumber(getArg("b1-stoploss-hours"), 2));
const maxRounds = Math.max(1, asNumber(getArg("max-rounds"), 48));
const intervalSec = Math.max(30, asNumber(getArg("interval-sec"), 1800));
const closureStreak = Math.max(1, asNumber(getArg("closure-streak"), 3));
const passThroughArgs = [];
if (hasFlag("dry-run")) passThroughArgs.push("--dry-run");
if (hasFlag("skip-baseline")) passThroughArgs.push("--skip-baseline");
if (hasFlag("require-baseline")) passThroughArgs.push("--require-baseline");
if (hasFlag("skip-b1")) passThroughArgs.push("--skip-b1");

const ensureDir = (dirPath) => fs.mkdirSync(dirPath, { recursive: true });
const readJsonSafe = (filePath) => {
  try {
    return JSON.parse(fs.readFileSync(filePath, "utf8"));
  } catch {
    return null;
  }
};
const writeJson = (filePath, payload) => {
  ensureDir(path.dirname(filePath));
  fs.writeFileSync(filePath, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
};
const appendJsonl = (filePath, payload) => {
  ensureDir(path.dirname(filePath));
  fs.writeFileSync(filePath, `${JSON.stringify(payload)}\n`, { flag: "a", encoding: "utf8" });
};
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const roundNum = (n) => `R${String(n).padStart(4, "0")}`;

const extractRoundMetrics = (roundDir) => {
  const pipeline = readJsonSafe(path.join(roundDir, "pipeline_summary.json")) ?? {};
  const a0 = pipeline?.a0?.previewStats ?? {};
  const a1Import = readJsonSafe(path.join(roundDir, "a1", "runtime_p0_import_report.json")) ?? {};
  const a1Stats = a1Import?.stats ?? {};
  const b1 = pipeline?.b1 ?? {};
  const b1Progress = b1?.runDir
    ? readJsonSafe(path.join(b1.runDir, "progress_report.json"))
    : null;
  const b1Batches = Array.isArray(b1Progress?.batchReports) ? b1Progress.batchReports : [];
  const b1LastBatch = b1Batches.length ? b1Batches[b1Batches.length - 1] : null;
  const b1RepairQueueSize = Number(b1Progress?.cumulative?.repairQueueSize ?? 0);
  const fallbackRepairQueueSize =
    Number(a0?.tier_counts?.P1_review ?? 0) + Number(a0?.tier_counts?.P2_reject ?? 0);
  const repairQueueSize = b1?.executed ? b1RepairQueueSize : fallbackRepairQueueSize;
  return {
    pipelineSummaryPath: path.join(roundDir, "pipeline_summary.json"),
    a0P0Count: Number(a0?.p0_count ?? 0),
    a0ConflictCount: Number(a0?.p0_conflict_count ?? 0),
    a0DistinctUserEstimate: Number(a0?.p0_distinct_user_estimate ?? 0),
    a1Attempted: Number(a1Stats?.attempted ?? 0),
    a1Imported: Number(a1Stats?.imported ?? 0),
    a1Blocked: Number(a1Stats?.blocked ?? 0),
    a1Failed: Number(a1Stats?.failed ?? 0),
    b1Executed: Boolean(b1?.executed),
    b1QueueSource: b1?.queueSource ?? null,
    b1SkipReason: b1?.autoGate?.reason ?? null,
    b1NetNewPairs: Number(b1LastBatch?.compareStats?.netNewPairs ?? 0),
    b1YieldPer1000Npns: Number(b1LastBatch?.quality?.yieldPer1000Npns ?? 0),
    repairQueueSize,
  };
};

const summarizeProgress = (rows) => {
  const last = rows.length ? rows[rows.length - 1] : null;
  if (!last) return { closed: false, reason: "no_rounds" };
  const tail = rows.slice(-closureStreak);
  const noProgress = tail.every(
    (row) =>
      Number(row.a1Imported ?? 0) === 0 &&
      Number(row.b1NetNewPairs ?? 0) === 0 &&
      Number(row.repairQueueDelta ?? 0) >= 0,
  );
  return {
    closed: noProgress && tail.length >= closureStreak,
    reason: noProgress && tail.length >= closureStreak ? `no_progress_${closureStreak}_rounds` : "running",
  };
};

const runOneRound = (roundIndex) => {
  const stamp = new Date().toISOString().replace(/[:]/g, "-");
  const roundId = `${roundNum(roundIndex)}-${stamp}`;
  const roundDir = path.join(outParent, roundId);
  ensureDir(roundDir);
  const cmd = [
    process.execPath,
    "scripts/maintainer/run-runtime-signal-a0-a1-b1.mjs",
    "--out-dir",
    roundDir,
    "--lookback-hours",
    String(lookbackHours),
    "--b1-batch-size",
    String(b1BatchSize),
    "--b1-max-batches",
    String(b1MaxBatches),
    "--b1-run-hours",
    String(b1RunHours),
    "--b1-stoploss-yield",
    String(b1StoplossYield),
    "--b1-stoploss-hours",
    String(b1StoplossHours),
    ...passThroughArgs,
  ];
  console.log(`[runtime-signal-loop] round=${roundId}`);
  const startedAt = new Date().toISOString();
  const result = spawnSync(cmd[0], cmd.slice(1), {
    cwd: process.cwd(),
    env: process.env,
    stdio: "inherit",
  });
  const finishedAt = new Date().toISOString();
  const ok = result.status === 0;
  const metrics = ok ? extractRoundMetrics(roundDir) : {};
  return {
    roundId,
    roundDir,
    startedAt,
    finishedAt,
    status: result.status,
    signal: result.signal,
    ok,
    ...metrics,
  };
};

const main = async () => {
  ensureDir(outParent);
  const monitorPath = path.join(outParent, "closure_monitor.jsonl");
  const statusPath = path.join(outParent, "closure_status.json");
  const rows = [];
  let repairQueuePrev = null;
  let closure = { closed: false, reason: "running" };

  for (let i = 1; i <= maxRounds; i += 1) {
    const row = runOneRound(i);
    if (!row.ok) {
      row.repairQueueDelta = null;
      appendJsonl(monitorPath, row);
      rows.push(row);
      closure = { closed: false, reason: `round_failed_${row.roundId}` };
      writeJson(statusPath, {
        updatedAt: new Date().toISOString(),
        outParent,
        maxRounds,
        intervalSec,
        closureStreak,
        roundsCompleted: rows.length,
        closure,
        lastRound: row,
      });
      break;
    }
    const currentRepair = Number(row.repairQueueSize ?? 0);
    row.repairQueueDelta =
      repairQueuePrev == null ? 0 : currentRepair - Number(repairQueuePrev ?? 0);
    repairQueuePrev = currentRepair;
    appendJsonl(monitorPath, row);
    rows.push(row);
    closure = summarizeProgress(rows);
    writeJson(statusPath, {
      updatedAt: new Date().toISOString(),
      outParent,
      maxRounds,
      intervalSec,
      closureStreak,
      roundsCompleted: rows.length,
      closure,
      lastRound: row,
    });

    if (closure.closed) {
      console.log(`[runtime-signal-loop] closure reached: ${closure.reason}`);
      break;
    }
    if (i < maxRounds) {
      console.log(`[runtime-signal-loop] sleeping ${intervalSec}s before next round`);
      await sleep(intervalSec * 1000);
    }
  }
};

main().catch((error) => {
  console.error("[runtime-signal-loop] fatal:", error?.message ?? error);
  process.exit(1);
});
