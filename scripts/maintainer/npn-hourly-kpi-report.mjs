#!/usr/bin/env node
/* eslint-disable no-console */

import fs from "node:fs";
import path from "node:path";

const args = process.argv.slice(2);
const getArg = (flag) => {
  const idx = args.indexOf(`--${flag}`);
  if (idx === -1) return null;
  return args[idx + 1] ?? null;
};

const runDirArg = getArg("run-dir");
if (!runDirArg) {
  console.error("[npn-hourly-kpi] missing --run-dir");
  process.exit(1);
}

const runDir = path.isAbsolute(runDirArg) ? runDirArg : path.resolve(process.cwd(), runDirArg);
const monitoringDir = path.join(runDir, "monitoring");
const heartbeatPath = path.join(monitoringDir, "heartbeat.jsonl");
const hourlyPath = path.join(monitoringDir, "hourly_metrics.jsonl");
const progressPath = path.join(runDir, "progress_report.json");

const readJsonSafe = (filePath) => {
  try {
    return JSON.parse(fs.readFileSync(filePath, "utf8"));
  } catch {
    return null;
  }
};

const readJsonlSafe = (filePath) => {
  try {
    return fs
      .readFileSync(filePath, "utf8")
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean)
      .map((line) => {
        try {
          return JSON.parse(line);
        } catch {
          return null;
        }
      })
      .filter(Boolean);
  } catch {
    return [];
  }
};

const listBatchIds = () => {
  const batchesDir = path.join(runDir, "batches");
  try {
    return fs
      .readdirSync(batchesDir, { withFileTypes: true })
      .filter((entry) => entry.isDirectory() && /^B\d+/.test(entry.name))
      .map((entry) => entry.name)
      .sort();
  } catch {
    return [];
  }
};

const aggregateRepairPriority = (rows) => {
  const reasonCounts = new Map();
  const brandCounts = new Map();
  for (const row of rows) {
    const reason = String(row?.rejectReason ?? row?.reason ?? row?.recommendedAction ?? "unknown").trim() || "unknown";
    reasonCounts.set(reason, (reasonCounts.get(reason) ?? 0) + 1);
    const brand = String(row?.brandName ?? row?.brand_name ?? "").trim();
    if (brand) {
      brandCounts.set(brand, (brandCounts.get(brand) ?? 0) + 1);
    }
  }
  return { reasonCounts, brandCounts, total: rows.length };
};

const toTopDelta = (currentMap, prevMap, limit = 5) => {
  const keys = new Set([...currentMap.keys(), ...prevMap.keys()]);
  return Array.from(keys)
    .map((key) => {
      const current = Number(currentMap.get(key) ?? 0);
      const previous = Number(prevMap.get(key) ?? 0);
      return {
        key,
        current,
        previous,
        delta: current - previous,
      };
    })
    .filter((row) => row.delta !== 0)
    .sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta))
    .slice(0, limit);
};

const round = (value, digits = 2) => {
  if (!Number.isFinite(Number(value))) return null;
  const n = Number(value);
  const base = 10 ** digits;
  return Math.round(n * base) / base;
};

const main = async () => {
  const hourlyRows = readJsonlSafe(hourlyPath);
  const heartbeatRows = readJsonlSafe(heartbeatPath);
  const progress = readJsonSafe(progressPath) ?? {};

  const latestHourly = hourlyRows.length ? hourlyRows[hourlyRows.length - 1] : null;
  const latestHeartbeat = heartbeatRows.length ? heartbeatRows[heartbeatRows.length - 1] : null;

  const batchIds = listBatchIds();
  const latestBatchId = batchIds.length ? batchIds[batchIds.length - 1] : null;
  const previousBatchId = batchIds.length > 1 ? batchIds[batchIds.length - 2] : null;
  const latestBatchDir = latestBatchId ? path.join(runDir, "batches", latestBatchId) : null;
  const latestBatchReport = latestBatchId
    ? readJsonSafe(path.join(runDir, "batches", latestBatchId, "batch_report.json"))
    : null;
  const previousBatchDir = previousBatchId ? path.join(runDir, "batches", previousBatchId) : null;
  const latestRepairQueue = latestBatchDir
    ? readJsonSafe(path.join(latestBatchDir, "compare", "repair_priority_queue.json"))
    : [];
  const previousRepairQueue = previousBatchDir
    ? readJsonSafe(path.join(previousBatchDir, "compare", "repair_priority_queue.json"))
    : [];
  const latestRepairRows = Array.isArray(latestRepairQueue) ? latestRepairQueue : [];
  const previousRepairRows = Array.isArray(previousRepairQueue) ? previousRepairQueue : [];
  const latestRepairAgg = aggregateRepairPriority(latestRepairRows);
  const previousRepairAgg = aggregateRepairPriority(previousRepairRows);
  const latestCheckpoint = latestBatchDir
    ? readJsonSafe(path.join(latestBatchDir, "enrich", "checkpoint.json"))
    : null;
  const latestSitemapSummary = latestBatchDir
    ? readJsonSafe(path.join(latestBatchDir, "sitemap", "summary.json"))
    : null;
  const latestBatchQueue = latestBatchDir ? readJsonSafe(path.join(latestBatchDir, "batch_queue.json")) : null;

  const heartbeatProgress =
    latestHeartbeat && latestHeartbeat.progress && typeof latestHeartbeat.progress === "object"
      ? latestHeartbeat.progress
      : {};

  const queueCurrentRaw =
    progress?.queueCursor ??
    heartbeatProgress?.queueCursor ??
    latestHeartbeat?.queueCursor ??
    0;
  const queueTotalRaw =
    progress?.queueTotal ??
    heartbeatProgress?.queueTotal ??
    latestHeartbeat?.queueTotal ??
    0;

  const batchQueueCount = Array.isArray(latestBatchQueue?.queue)
    ? latestBatchQueue.queue.length
    : null;
  const checkpointProcessed = Number(latestCheckpoint?.processed ?? 0);
  const checkpointStartedAt = latestCheckpoint?.startedAt ? new Date(latestCheckpoint.startedAt).getTime() : null;
  const checkpointElapsedSec =
    Number.isFinite(checkpointStartedAt) && checkpointStartedAt > 0
      ? Math.max(1, (Date.now() - checkpointStartedAt) / 1000)
      : null;
  const checkpointAttemptedPerHour =
    checkpointElapsedSec && checkpointProcessed > 0
      ? round((checkpointProcessed / checkpointElapsedSec) * 3600, 2)
      : null;

  const liveBatchFallback =
    !latestBatchReport && latestBatchId
      ? {
          batchId: latestBatchId,
          mode: "live_checkpoint",
          queueCount: batchQueueCount,
          processed: checkpointProcessed,
          matched: Number(latestCheckpoint?.matched ?? 0),
          upserted: Number(latestCheckpoint?.upserted ?? 0),
          conflicts: Number(latestCheckpoint?.conflicts ?? 0),
          failed: Number(latestCheckpoint?.failed ?? 0),
          attemptedPerHour: checkpointAttemptedPerHour,
          checkpointUpdatedAt: latestCheckpoint?.updatedAt ?? null,
          sitemapPairCountDedup: Number(latestSitemapSummary?.pairCountDedup ?? 0),
          sitemapDomainsScanned: Number(latestSitemapSummary?.domainsScanned ?? 0),
        }
      : null;

  const report = {
    generatedAt: new Date().toISOString(),
    runDir,
    latestBatchId,
    queueCursor: {
      current: Number(queueCurrentRaw ?? 0),
      total: Number(queueTotalRaw ?? 0),
      ratio:
        Number(queueTotalRaw ?? 0) > 0
          ? round(Number(queueCurrentRaw ?? 0) / Number(queueTotalRaw ?? 0), 6)
          : null,
    },
    hourly: latestHourly
      ? {
          attemptedPerHour: latestHourly.attemptedPerHour ?? null,
          importedP0PerHour: latestHourly.importedP0PerHour ?? null,
          repairQueuePerHour: latestHourly.repairQueuePerHour ?? null,
          conflictsPerHour: latestHourly.conflictsPerHour ?? null,
          attemptedDelta: latestHourly.attemptedDelta ?? null,
          repairQueueDelta: latestHourly.repairQueueDelta ?? null,
        }
      : null,
    latestBatch: latestBatchReport
      ? {
          batchId: latestBatchReport.batchId ?? latestBatchId,
          netNewPairs: latestBatchReport?.compareStats?.netNewPairs ?? null,
          p0AutoImport: latestBatchReport?.compareStats?.tierCounts?.P0_auto_import ?? null,
          p1Review: latestBatchReport?.compareStats?.tierCounts?.P1_review ?? null,
          p2Reject: latestBatchReport?.compareStats?.tierCounts?.P2_reject ?? null,
          conflictsByBarcode: latestBatchReport?.compareStats?.conflictsByBarcode ?? null,
          yieldPer1000Npns: latestBatchReport?.quality?.yieldPer1000Npns ?? null,
        }
      : liveBatchFallback,
    repairPriority: {
      latestBatchId,
      previousBatchId,
      latestCount: latestRepairAgg.total,
      previousCount: previousRepairAgg.total,
      deltaCount: latestRepairAgg.total - previousRepairAgg.total,
      topReasonDelta: toTopDelta(latestRepairAgg.reasonCounts, previousRepairAgg.reasonCounts, 5),
      topBrandDelta: toTopDelta(latestRepairAgg.brandCounts, previousRepairAgg.brandCounts, 5),
    },
    cumulative: {
      attemptedNpns: Number(
        progress?.cumulative?.attemptedNpns ??
          heartbeatProgress?.attemptedNpns ??
          latestHeartbeat?.attemptedNpns ??
          0,
      ),
      importedP0: Number(
        progress?.cumulative?.importedP0 ??
          heartbeatProgress?.importedP0 ??
          latestHeartbeat?.importedP0 ??
          0,
      ),
      wouldImportP0: Number(
        progress?.cumulative?.wouldImportP0 ??
          heartbeatProgress?.wouldImportP0 ??
          latestHeartbeat?.wouldImportP0 ??
          0,
      ),
      p1Review: Number(
        progress?.cumulative?.p1Review ??
          heartbeatProgress?.p1Review ??
          latestHeartbeat?.p1Review ??
          0,
      ),
      p2Reject: Number(
        progress?.cumulative?.p2Reject ??
          heartbeatProgress?.p2Reject ??
          latestHeartbeat?.p2Reject ??
          0,
      ),
      repairQueueSize: Number(
        progress?.cumulative?.repairQueueSize ??
          heartbeatProgress?.repairQueueSize ??
          latestHeartbeat?.repairQueueSize ??
          0,
      ),
      conflictsByBarcode: Number(
        progress?.cumulative?.conflictsByBarcode ??
          heartbeatProgress?.conflictsByBarcode ??
          latestHeartbeat?.conflictsByBarcode ??
          0,
      ),
      rejectedInvalidGtin14: Number(
        progress?.cumulative?.rejectedInvalidGtin14 ??
          heartbeatProgress?.rejectedInvalidGtin14 ??
          latestHeartbeat?.rejectedInvalidGtin14 ??
          0,
      ),
    },
    health: {
      processAlive: Boolean(latestHeartbeat?.processAlive),
      stalled: Boolean(latestHeartbeat?.stalled),
      checkpointAgeSec: latestHeartbeat?.checkpointAgeSec ?? null,
      stopReason: progress?.stopReason ?? heartbeatProgress?.stopReason ?? null,
      status: progress?.status ?? heartbeatProgress?.status ?? null,
    },
  };

  const md = [
    `# NPN Hourly KPI`,
    `- generatedAt: ${report.generatedAt}`,
    `- runDir: ${report.runDir}`,
    `- latestBatchId: ${report.latestBatchId ?? "n/a"}`,
    `- queue: ${report.queueCursor.current}/${report.queueCursor.total}`,
    `- attemptedPerHour: ${report.hourly?.attemptedPerHour ?? "n/a"}`,
    `- attemptedPerHour(liveBatch): ${report.latestBatch?.attemptedPerHour ?? "n/a"}`,
    `- netNewPairs(latestBatch): ${report.latestBatch?.netNewPairs ?? "n/a"}`,
    `- repairQueueDelta(lastHour): ${report.hourly?.repairQueueDelta ?? "n/a"}`,
    `- yieldPer1000Npns(latestBatch): ${report.latestBatch?.yieldPer1000Npns ?? "n/a"}`,
    `- repairPriority deltaCount(batch): ${report.repairPriority?.deltaCount ?? "n/a"}`,
    `- repairPriority topReasonDelta: ${
      Array.isArray(report.repairPriority?.topReasonDelta) && report.repairPriority.topReasonDelta.length
        ? report.repairPriority.topReasonDelta
            .map((row) => `${row.key}:${row.delta > 0 ? "+" : ""}${row.delta}`)
            .join(", ")
        : "n/a"
    }`,
    `- processAlive: ${report.health.processAlive}`,
    `- stalled: ${report.health.stalled}`,
    `- stopReason: ${report.health.stopReason ?? "null"}`,
  ].join("\n");

  fs.mkdirSync(monitoringDir, { recursive: true });
  fs.writeFileSync(path.join(monitoringDir, "hourly_kpi_latest.json"), `${JSON.stringify(report, null, 2)}\n`, "utf8");
  fs.writeFileSync(path.join(monitoringDir, "hourly_kpi_latest.md"), `${md}\n`, "utf8");

  console.log(JSON.stringify({ ok: true, report }, null, 2));
};

main().catch((error) => {
  console.error("[npn-hourly-kpi] fatal:", error?.message ?? error);
  process.exit(1);
});
