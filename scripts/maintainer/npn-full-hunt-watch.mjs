#!/usr/bin/env node
/* eslint-disable no-console */
import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";
import { execSync } from "node:child_process";

const args = process.argv.slice(2);
const getArg = (flag) => {
  const idx = args.indexOf(`--${flag}`);
  if (idx === -1) return null;
  return args[idx + 1] ?? null;
};
const hasFlag = (flag) => args.includes(`--${flag}`);

const runDirArg = getArg("run-dir");
if (!runDirArg) {
  console.error(
    "[npn-watch] missing required --run-dir, e.g. --run-dir output/npn_webhunt/full_hunt/<timestamp>",
  );
  process.exit(1);
}

const runDir = path.resolve(process.cwd(), runDirArg);
const intervalSec = Math.max(15, Number(getArg("interval-sec") || 60));
const stallSec = Math.max(120, Number(getArg("stall-sec") || 1800));
const once = hasFlag("once");
const exitWhenStopped = !hasFlag("no-exit-when-stopped");
const maxMissingProcessTicks = Math.max(1, Number(getArg("max-missing-process-ticks") || 3));

const monitoringDir = path.join(runDir, "monitoring");
const heartbeatFile = path.join(monitoringDir, "heartbeat.jsonl");
const latestStatusFile = path.join(monitoringDir, "latest_status.txt");
const hourlyMetricsFile = path.join(monitoringDir, "hourly_metrics.jsonl");
const latestHourlyStatusFile = path.join(monitoringDir, "hourly_status.txt");

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const readJsonSafe = async (filePath) => {
  try {
    const raw = await fsp.readFile(filePath, "utf8");
    return JSON.parse(raw);
  } catch {
    return null;
  }
};

const statSafe = async (filePath) => {
  try {
    return await fsp.stat(filePath);
  } catch {
    return null;
  }
};

const findSupervisorPids = () => {
  try {
    const output = execSync("ps -ax -o pid=,command=", {
      stdio: ["ignore", "pipe", "ignore"],
    })
      .toString("utf8")
      .trim();
    if (!output) return [];

    const runDirRel = path.relative(process.cwd(), runDir).replace(/\\/g, "/");
    const runDirAbs = runDir.replace(/\\/g, "/");

    return output
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean)
      .filter((line) => line.includes("run-npn-full-hunt-supervisor.ts"))
      .filter((line) => {
        const normalized = line.replace(/\\/g, "/");
        return normalized.includes(runDirAbs) || normalized.includes(runDirRel);
      })
      .map((line) => Number(line.split(/\s+/, 1)[0]))
      .filter((value) => Number.isFinite(value) && value > 0);
  } catch {
    return [];
  }
};

const findLatestBatchId = async () => {
  const batchesDir = path.join(runDir, "batches");
  try {
    const entries = await fsp.readdir(batchesDir, { withFileTypes: true });
    const ids = entries
      .filter((entry) => entry.isDirectory() && /^B\d{4,}$/.test(entry.name))
      .map((entry) => entry.name)
      .sort();
    return ids.length ? ids[ids.length - 1] : null;
  } catch {
    return null;
  }
};

const formatSec = (value) => {
  if (!Number.isFinite(value) || value < 0) return "n/a";
  if (value < 60) return `${Math.round(value)}s`;
  const mins = Math.floor(value / 60);
  const secs = Math.round(value % 60);
  return `${mins}m ${secs}s`;
};

const toNumber = (value, fallback = 0) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
};

const readHeartbeats = async () => {
  try {
    const raw = await fsp.readFile(heartbeatFile, "utf8");
    const rows = [];
    for (const line of raw.split(/\r?\n/)) {
      const text = line.trim();
      if (!text) continue;
      try {
        rows.push(JSON.parse(text));
      } catch {
        // ignore malformed row
      }
    }
    return rows;
  } catch {
    return [];
  }
};

const buildHourlyMetrics = (rows) => {
  const snapshots = rows
    .filter((row) => row && row.progress && row.ts)
    .map((row) => ({
      ts: row.ts,
      progress: row.progress,
      latestBatchId: row.latestBatchId ?? null,
    }))
    .sort((a, b) => new Date(a.ts).getTime() - new Date(b.ts).getTime());
  if (snapshots.length < 2) return null;

  const nowMs = Date.now();
  const windowMs = 60 * 60 * 1000;
  const lowerBound = nowMs - windowMs;
  const windowRows = snapshots.filter((row) => new Date(row.ts).getTime() >= lowerBound);
  if (windowRows.length < 2) return null;

  const start = windowRows[0];
  const end = windowRows[windowRows.length - 1];
  const elapsedHours = Math.max(
    1 / 3600,
    (new Date(end.ts).getTime() - new Date(start.ts).getTime()) / (1000 * 3600),
  );
  const delta = (key) => toNumber(end.progress?.[key], 0) - toNumber(start.progress?.[key], 0);

  const attemptedDelta = delta("attemptedNpns");
  const importedDelta = delta("importedP0");
  const p1Delta = delta("p1Review");
  const p2Delta = delta("p2Reject");
  const conflictsDelta = delta("conflictsByBarcode");
  const queueCursorDelta = delta("queueCursor");

  return {
    ts: new Date().toISOString(),
    windowHours: Number(elapsedHours.toFixed(3)),
    batchId: end.latestBatchId ?? null,
    queueCursor: `${toNumber(end.progress?.queueCursor, 0)}/${toNumber(end.progress?.queueTotal, 0)}`,
    attemptedDelta,
    importedP0Delta: importedDelta,
    p1ReviewDelta: p1Delta,
    p2RejectDelta: p2Delta,
    conflictsDelta,
    repairQueueDelta: p1Delta + p2Delta,
    queueCursorDelta,
    attemptedPerHour: Number((attemptedDelta / elapsedHours).toFixed(2)),
    importedP0PerHour: Number((importedDelta / elapsedHours).toFixed(2)),
    repairQueuePerHour: Number(((p1Delta + p2Delta) / elapsedHours).toFixed(2)),
    conflictsPerHour: Number((conflictsDelta / elapsedHours).toFixed(2)),
  };
};

const collectSnapshot = async () => {
  const now = new Date();
  const pids = findSupervisorPids();
  const latestBatchId = await findLatestBatchId();

  const progressPath = path.join(runDir, "progress_report.json");
  const progress = await readJsonSafe(progressPath);

  let checkpoint = null;
  let checkpointAgeSec = null;
  let sitemapSummary = null;
  let compareSummary = null;
  let batchReport = null;

  if (latestBatchId) {
    const batchDir = path.join(runDir, "batches", latestBatchId);
    const checkpointPath = path.join(batchDir, "enrich", "checkpoint.json");
    const checkpointStat = await statSafe(checkpointPath);
    checkpoint = await readJsonSafe(checkpointPath);
    if (checkpointStat) checkpointAgeSec = Math.max(0, (Date.now() - checkpointStat.mtimeMs) / 1000);

    sitemapSummary = await readJsonSafe(path.join(batchDir, "sitemap", "summary.json"));
    compareSummary = await readJsonSafe(path.join(batchDir, "compare", "summary.json"));
    batchReport = await readJsonSafe(path.join(batchDir, "batch_report.json"));
  }

  const stalled =
    Array.isArray(pids) &&
    pids.length > 0 &&
    Number.isFinite(checkpointAgeSec) &&
    checkpointAgeSec > stallSec;

  return {
    ts: now.toISOString(),
    runDir,
    pids,
    processAlive: pids.length > 0,
    latestBatchId,
    stalled,
    stallSecThreshold: stallSec,
    checkpointAgeSec: checkpointAgeSec == null ? null : Number(checkpointAgeSec.toFixed(2)),
    progress: progress
      ? {
          status: progress.status ?? null,
          batchesCompleted: toNumber(progress.batchesCompleted, 0),
          queueCursor: toNumber(progress.queueCursor, 0),
          queueTotal: toNumber(progress.queueTotal, 0),
          attemptedNpns: toNumber(progress?.cumulative?.attemptedNpns, 0),
          importedP0: toNumber(progress?.cumulative?.importedP0, 0),
          p1Review: toNumber(progress?.cumulative?.p1Review, 0),
          p2Reject: toNumber(progress?.cumulative?.p2Reject, 0),
          conflictsByBarcode: toNumber(progress?.cumulative?.conflictsByBarcode, 0),
          stopReason: progress.stopReason ?? null,
        }
      : null,
    currentBatch: {
      batchId: latestBatchId,
      checkpoint: checkpoint
        ? {
            processed: toNumber(checkpoint.processed, 0),
            queried: toNumber(checkpoint.queried, 0),
            matched: toNumber(checkpoint.matched, 0),
            upserted: toNumber(checkpoint.upserted, 0),
            conflicts: toNumber(checkpoint.conflicts, 0),
            failed: toNumber(checkpoint.failed, 0),
            consideredLinks: toNumber(checkpoint.consideredLinks, 0),
            rejectedByContextLinks: toNumber(checkpoint.rejectedByContextLinks, 0),
            updatedAt: checkpoint.updatedAt ?? null,
          }
        : null,
      sitemapSummary: sitemapSummary
        ? {
            pairCountRaw: toNumber(sitemapSummary.pairCountRaw, 0),
            pairCountDedup: toNumber(sitemapSummary.pairCountDedup, 0),
            npnCount: toNumber(sitemapSummary.npnCount, 0),
            domainsScanned: toNumber(sitemapSummary.domainsScanned, 0),
          }
        : null,
      compareSummary: compareSummary
        ? {
            netNewPairs: toNumber(compareSummary?.stats?.netNewPairs, 0),
            conflictsByBarcode: toNumber(compareSummary?.stats?.conflictsByBarcode, 0),
            tierCounts: compareSummary?.stats?.tierCounts ?? null,
          }
        : null,
      batchReport: batchReport
        ? {
            elapsedSec: toNumber(batchReport.elapsedSec, 0),
            imported: toNumber(batchReport?.importStats?.imported, 0),
            wouldImport: toNumber(batchReport?.importStats?.wouldImport, 0),
            p0Rate: toNumber(batchReport?.quality?.p0Rate, 0),
            conflictRate: toNumber(batchReport?.quality?.conflictRate, 0),
          }
        : null,
    },
  };
};

const writeLatestStatus = async (snapshot) => {
  const lines = [];
  lines.push(`time: ${snapshot.ts}`);
  lines.push(`run_dir: ${snapshot.runDir}`);
  lines.push(`process_alive: ${snapshot.processAlive ? "yes" : "no"} pids=${snapshot.pids.join(",") || "-"}`);
  lines.push(`latest_batch: ${snapshot.latestBatchId ?? "-"}`);
  lines.push(
    `checkpoint_age: ${snapshot.checkpointAgeSec == null ? "n/a" : formatSec(snapshot.checkpointAgeSec)} stalled=${snapshot.stalled ? "yes" : "no"}`,
  );
  if (snapshot.progress) {
    lines.push(
      `progress: status=${snapshot.progress.status ?? "-"} batches=${snapshot.progress.batchesCompleted}/${snapshot.progress.queueTotal ? "?" : "?"} queue_cursor=${snapshot.progress.queueCursor}/${snapshot.progress.queueTotal}`,
    );
    lines.push(
      `cumulative: attempted=${snapshot.progress.attemptedNpns} imported_p0=${snapshot.progress.importedP0} p1=${snapshot.progress.p1Review} p2=${snapshot.progress.p2Reject} conflicts=${snapshot.progress.conflictsByBarcode}`,
    );
    if (snapshot.progress.stopReason) lines.push(`stop_reason: ${snapshot.progress.stopReason}`);
  }
  if (snapshot.currentBatch?.checkpoint) {
    const c = snapshot.currentBatch.checkpoint;
    lines.push(
      `batch_checkpoint: processed=${c.processed} queried=${c.queried} matched=${c.matched} upserted=${c.upserted} failed=${c.failed} ctx_reject=${c.rejectedByContextLinks}`,
    );
  }
  if (snapshot.currentBatch?.sitemapSummary) {
    const s = snapshot.currentBatch.sitemapSummary;
    lines.push(
      `batch_sitemap: pairs_dedup=${s.pairCountDedup} npns=${s.npnCount} domains=${s.domainsScanned}`,
    );
  }
  if (snapshot.currentBatch?.compareSummary) {
    const c = snapshot.currentBatch.compareSummary;
    lines.push(`batch_compare: net_new=${c.netNewPairs} conflicts=${c.conflictsByBarcode}`);
  }
  await fsp.writeFile(latestStatusFile, `${lines.join("\n")}\n`, "utf8");
};

const appendHeartbeat = async (snapshot) => {
  await fsp.appendFile(heartbeatFile, `${JSON.stringify(snapshot)}\n`, "utf8");
};

const appendHourlyMetrics = async (metrics) => {
  await fsp.appendFile(hourlyMetricsFile, `${JSON.stringify(metrics)}\n`, "utf8");
};

const writeHourlyStatus = async (metrics) => {
  if (!metrics) return;
  const lines = [];
  lines.push(`time: ${metrics.ts}`);
  lines.push(`window_hours: ${metrics.windowHours}`);
  lines.push(`queue_cursor: ${metrics.queueCursor}`);
  lines.push(`attempted_per_hour: ${metrics.attemptedPerHour}`);
  lines.push(`imported_p0_per_hour: ${metrics.importedP0PerHour}`);
  lines.push(`repair_queue_delta_last_hour: ${metrics.repairQueueDelta}`);
  lines.push(`repair_queue_per_hour: ${metrics.repairQueuePerHour}`);
  lines.push(`conflicts_per_hour: ${metrics.conflictsPerHour}`);
  lines.push(
    `deltas: attempted=${metrics.attemptedDelta}, imported_p0=${metrics.importedP0Delta}, p1=${metrics.p1ReviewDelta}, p2=${metrics.p2RejectDelta}, conflicts=${metrics.conflictsDelta}`,
  );
  await fsp.writeFile(latestHourlyStatusFile, `${lines.join("\n")}\n`, "utf8");
};

const main = async () => {
  if (!fs.existsSync(runDir)) {
    console.error(`[npn-watch] run dir not found: ${runDir}`);
    process.exit(1);
  }
  await fsp.mkdir(monitoringDir, { recursive: true });

  let missingProcessTicks = 0;
  for (;;) {
    const snapshot = await collectSnapshot();
    await appendHeartbeat(snapshot);
    await writeLatestStatus(snapshot);
    const rows = await readHeartbeats();
    const hourlyMetrics = buildHourlyMetrics(rows);
    if (hourlyMetrics) {
      await appendHourlyMetrics(hourlyMetrics);
      await writeHourlyStatus(hourlyMetrics);
    }
    console.log(
      `[npn-watch] ${snapshot.ts} alive=${snapshot.processAlive} batch=${snapshot.latestBatchId ?? "-"} stalled=${snapshot.stalled} checkpointAge=${snapshot.checkpointAgeSec ?? "n/a"}s`,
    );

    if (!snapshot.processAlive) missingProcessTicks += 1;
    else missingProcessTicks = 0;

    if (once) break;
    if (exitWhenStopped && missingProcessTicks >= maxMissingProcessTicks) {
      console.log(
        `[npn-watch] supervisor missing for ${missingProcessTicks} ticks, exiting watch loop`,
      );
      break;
    }

    await sleep(intervalSec * 1000);
  }
};

main().catch((error) => {
  console.error("[npn-watch] fatal:", error instanceof Error ? error.message : String(error));
  process.exit(1);
});
