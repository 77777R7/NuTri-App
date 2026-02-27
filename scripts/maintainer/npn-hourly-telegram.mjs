#!/usr/bin/env node
/* eslint-disable no-console */

import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

const args = process.argv.slice(2);
const getArg = (flag) => {
  const idx = args.indexOf(`--${flag}`);
  if (idx === -1) return null;
  return args[idx + 1] ?? null;
};

const runDirArg = getArg('run-dir');
if (!runDirArg) {
  console.error('[npn-hourly-telegram] missing --run-dir');
  process.exit(1);
}

const shouldRefresh = getArg('refresh') !== 'false';

const runDir = path.isAbsolute(runDirArg) ? runDirArg : path.resolve(process.cwd(), runDirArg);
const monitoringDir = path.join(runDir, 'monitoring');
const heartbeatPath = path.join(monitoringDir, 'heartbeat.jsonl');
const hourlyKpiPath = path.join(monitoringDir, 'hourly_kpi_latest.json');
const telegramPath = path.join(monitoringDir, 'hourly_telegram.jsonl');
const statePath = path.join(monitoringDir, 'hourly_telegram_state.json');
const mdPath = path.join(monitoringDir, 'hourly_telegram_latest.md');

const readJsonSafe = (filePath) => {
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch {
    return null;
  }
};

const writeJsonSafe = (filePath, payload) => {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `${JSON.stringify(payload, null, 2)}\n`, 'utf8');
};

const safeNum = (value, fallback = 0) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
};

const safeInt = (value, fallback = null) => {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.round(parsed);
};

if (shouldRefresh) {
  const res = spawnSync(
    process.execPath,
    ['scripts/maintainer/npn-hourly-kpi-report.mjs', '--run-dir', runDir],
    { cwd: process.cwd(), stdio: 'inherit' },
  );
  if (res.status !== 0) {
    process.exit(res.status || 1);
  }
}

const report = readJsonSafe(hourlyKpiPath) ?? {};
const heartbeatRows = (() => {
  try {
    return fs
      .readFileSync(heartbeatPath, 'utf8')
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
})();
const latestHeartbeat = heartbeatRows.length ? heartbeatRows[heartbeatRows.length - 1] : {};
const prev = readJsonSafe(statePath) ?? { cumulative: {} };

const now = {
  attemptedNpns: safeNum(report?.cumulative?.attemptedNpns, 0),
  importedP0: safeNum(report?.cumulative?.importedP0, 0),
  p1Review: safeNum(report?.cumulative?.p1Review, 0),
  p2Reject: safeNum(report?.cumulative?.p2Reject, 0),
  repairQueueSize: safeNum(report?.cumulative?.repairQueueSize, 0),
};

const delta = {
  attemptedNpns: now.attemptedNpns - safeNum(prev?.cumulative?.attemptedNpns, 0),
  p0AutoImport: now.importedP0 - safeNum(prev?.cumulative?.importedP0, 0),
  p1Review: now.p1Review - safeNum(prev?.cumulative?.p1Review, 0),
  p2Reject: now.p2Reject - safeNum(prev?.cumulative?.p2Reject, 0),
  repairQueueSize: now.repairQueueSize - safeNum(prev?.cumulative?.repairQueueSize, 0),
};

const latestBatch = report?.latestBatch ?? {};
const repairPriority = report?.repairPriority ?? {};
const telegramRow = {
  event: 'npn_hourly_telegram',
  ts: new Date().toISOString(),
  runDir,
  queueCursor: report?.queueCursor ?? null,
  hourly: {
    attemptedPerHour: report?.hourly?.attemptedPerHour ?? null,
    importedP0PerHour: report?.hourly?.importedP0PerHour ?? null,
    repairQueuePerHour: report?.hourly?.repairQueuePerHour ?? null,
    yieldPer1000Npns: latestBatch?.yieldPer1000Npns ?? null,
  },
  cumulative: {
    attemptedNpns: now.attemptedNpns,
    importedP0: now.importedP0,
    p1Review: now.p1Review,
    p2Reject: now.p2Reject,
    repairQueueSize: now.repairQueueSize,
  },
  delta,
  latestBatch: {
    batchId: latestBatch?.batchId ?? null,
    netNewPairs: latestBatch?.netNewPairs ?? null,
    p0AutoImport: latestBatch?.p0AutoImport ?? null,
    p1Review: latestBatch?.p1Review ?? null,
    p2Reject: latestBatch?.p2Reject ?? null,
  },
  repairPriority: {
    latestCount: repairPriority?.latestCount ?? null,
    previousCount: repairPriority?.previousCount ?? null,
    deltaCount: repairPriority?.deltaCount ?? null,
    topReasonDelta: Array.isArray(repairPriority?.topReasonDelta) ? repairPriority.topReasonDelta : [],
    topBrandDelta: Array.isArray(repairPriority?.topBrandDelta) ? repairPriority.topBrandDelta : [],
  },
  health: {
    processAlive: Boolean(report?.health?.processAlive),
    stalled: Boolean(report?.health?.stalled),
    checkpointAgeSec: latestHeartbeat?.checkpointAgeSec ?? null,
    stopReason: report?.health?.stopReason ?? null,
    status: report?.health?.status ?? null,
  },
};

fs.mkdirSync(monitoringDir, { recursive: true });
fs.writeFileSync(telegramPath, `${JSON.stringify(telegramRow)}\n`, { flag: 'a', encoding: 'utf8' });
fs.writeFileSync(
  statePath,
  `${JSON.stringify({ cumulative: now, updatedAt: telegramRow.ts }, null, 2)}\n`,
  'utf8',
);

const md = [
  '# NPN Hourly Telegram',
  `- ts: ${telegramRow.ts}`,
  `- runDir: ${runDir}`,
  `- queue: ${telegramRow.queueCursor?.current ?? 'n/a'}/${telegramRow.queueCursor?.total ?? 'n/a'}`,
  `- yieldPer1000Npns: ${telegramRow.hourly.yieldPer1000Npns ?? 'n/a'}`,
  `- attempted/hour: ${telegramRow.hourly.attemptedPerHour ?? 'n/a'}`,
  `- importedP0/hour: ${telegramRow.hourly.importedP0PerHour ?? 'n/a'}`,
  `- repairQueue/hour: ${telegramRow.hourly.repairQueuePerHour ?? 'n/a'}`,
  `- P0: ${now.importedP0} (Δ${safeInt(delta.p0AutoImport, 0)})`,
  `- P1: ${now.p1Review} (Δ${safeInt(delta.p1Review, 0)})`,
  `- P2: ${now.p2Reject} (Δ${safeInt(delta.p2Reject, 0)})`,
  `- repairPriorityΔ(batch): ${telegramRow.repairPriority.deltaCount ?? 'n/a'}`,
  `- repairReasonΔ: ${
    telegramRow.repairPriority.topReasonDelta.length
      ? telegramRow.repairPriority.topReasonDelta
          .map((row) => `${row.key}:${row.delta > 0 ? '+' : ''}${row.delta}`)
          .join(', ')
      : 'n/a'
  }`,
  `- repairBrandΔ: ${
    telegramRow.repairPriority.topBrandDelta.length
      ? telegramRow.repairPriority.topBrandDelta
          .map((row) => `${row.key}:${row.delta > 0 ? '+' : ''}${row.delta}`)
          .join(', ')
      : 'n/a'
  }`,
  `- latestBatch: ${latestBatch?.batchId ?? 'n/a'} / netNewPairs=${latestBatch?.netNewPairs ?? 'n/a'} / repairQueueDelta=${safeInt(delta.repairQueueSize, 0)}`,
  `- processAlive=${telegramRow.health.processAlive} stalled=${telegramRow.health.stalled}`,
  `- stopReason=${telegramRow.health.stopReason ?? 'null'}`,
].join('\n');
fs.writeFileSync(mdPath, `${md}\n`, 'utf8');

console.log(JSON.stringify(telegramRow, null, 2));
