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

const resolvePath = (input, fallback = null) => {
  if (!input) return fallback;
  return path.isAbsolute(input) ? input : path.resolve(process.cwd(), input);
};

const baselinePath = resolvePath(
  getArg("baseline"),
  path.resolve(process.cwd(), "output/npn_webhunt/baselines/latest/baseline_snapshot.json"),
);
const backfillSummaryPath = resolvePath(getArg("backfill-summary"));
const runDir = resolvePath(getArg("run-dir"));
const phase3SummaryPath = resolvePath(getArg("phase3-summary"));
const validationPath = resolvePath(getArg("validation"));
const outDir = resolvePath(
  getArg("out-dir"),
  path.resolve(process.cwd(), "output/npn_webhunt/closure_reports", new Date().toISOString().replace(/[:]/g, "-")),
);

const readJsonSafe = (filePath) => {
  if (!filePath || !fs.existsSync(filePath)) return null;
  try {
    return JSON.parse(fs.readFileSync(filePath, "utf8"));
  } catch {
    return null;
  }
};

const readLatestRunArtifacts = (runBaseDir) => {
  if (!runBaseDir) return null;
  let progress = readJsonSafe(path.join(runBaseDir, "progress_report.json"));
  const latestHourly = readJsonSafe(path.join(runBaseDir, "monitoring/hourly_kpi_latest.json"));
  const heartbeatPath = path.join(runBaseDir, "monitoring/heartbeat.jsonl");
  let latestBatch = null;

  if (!progress && fs.existsSync(heartbeatPath)) {
    try {
      const rows = fs
        .readFileSync(heartbeatPath, "utf8")
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
      const latest = rows.length ? rows[rows.length - 1] : null;
      if (latest) {
        progress = {
          status: latest?.processAlive ? "running" : null,
          queueCursor: latest?.progress?.queueCursor ?? 0,
          queueTotal: latest?.progress?.queueTotal ?? 0,
          cumulative: {
            attemptedNpns: latest?.progress?.attemptedNpns ?? 0,
            importedP0: latest?.progress?.importedP0 ?? 0,
            wouldImportP0: latest?.progress?.wouldImportP0 ?? 0,
            p1Review: latest?.progress?.p1Review ?? 0,
            p2Reject: latest?.progress?.p2Reject ?? 0,
            repairQueueSize: latest?.progress?.repairQueueSize ?? 0,
            conflictsByBarcode: latest?.progress?.conflictsByBarcode ?? 0,
            rejectedInvalidGtin14: latest?.progress?.rejectedInvalidGtin14 ?? 0,
          },
          stopReason: latest?.progress?.stopReason ?? null,
        };
      }
    } catch {
      // ignore heartbeat fallback failure
    }
  }

  try {
    const batchId = fs
      .readdirSync(path.join(runBaseDir, "batches"), { withFileTypes: true })
      .filter((entry) => entry.isDirectory() && /^B\d+/.test(entry.name))
      .map((entry) => entry.name)
      .sort()
      .pop();
    if (batchId) {
      latestBatch = readJsonSafe(path.join(runBaseDir, "batches", batchId, "batch_report.json"));
      if (!latestBatch) {
        const checkpoint = readJsonSafe(path.join(runBaseDir, "batches", batchId, "enrich/checkpoint.json"));
        if (checkpoint) {
          const startedAtMs = checkpoint?.startedAt ? new Date(checkpoint.startedAt).getTime() : null;
          const elapsedHours =
            Number.isFinite(startedAtMs) && startedAtMs > 0
              ? Math.max(1 / 3600, (Date.now() - startedAtMs) / (1000 * 3600))
              : null;
          const attemptedPerHour =
            elapsedHours && Number(checkpoint?.processed ?? 0) > 0
              ? Number((Number(checkpoint.processed) / elapsedHours).toFixed(2))
              : null;
          latestBatch = {
            batchId,
            live: true,
            checkpoint,
            quality: { yieldPer1000Npns: null },
            compareStats: { netNewPairs: null },
            liveAttemptedPerHour: attemptedPerHour,
          };
        }
      }
    }
  } catch {
    // ignore
  }

  return { progress, latestHourly, latestBatch };
};

const ensureDir = async (dirPath) => {
  await fs.promises.mkdir(dirPath, { recursive: true });
};

const main = async () => {
  const baseline = readJsonSafe(baselinePath);
  const backfillSummary = readJsonSafe(backfillSummaryPath);
  const phase3Summary = readJsonSafe(phase3SummaryPath);
  const validation = readJsonSafe(validationPath);
  const runArtifacts = readLatestRunArtifacts(runDir);

  const baselineBarcodes = Number(baseline?.metrics?.activeUsableBarcodes ?? 0);
  const baselineCandidates = Number(baseline?.metrics?.barcodeCandidatesCoveredLnhpdIds ?? 0);

  const afterCandidates = Number(backfillSummary?.afterCounts?.lnhpdFactsRowsWithBarcodeCandidates ?? baselineCandidates);
  const afterMapCoverage = Number(backfillSummary?.coverage?.mapNpnCoverageRateAfter ?? 0);

  const report = {
    generatedAt: new Date().toISOString(),
    inputs: {
      baselinePath,
      backfillSummaryPath,
      runDir,
      phase3SummaryPath,
      validationPath,
    },
    kpis: {
      activeUsableBarcodesBaseline: baselineBarcodes,
      barcodeCandidatesBaseline: baselineCandidates,
      barcodeCandidatesAfterBackfill: afterCandidates,
      barcodeCandidatesDelta: afterCandidates - baselineCandidates,
      mapNpnCoverageRateAfterBackfill: afterMapCoverage,
      runStatus: runArtifacts?.progress?.status ?? null,
      runQueueCursor: runArtifacts?.progress
        ? `${Number(runArtifacts.progress.queueCursor ?? 0)}/${Number(runArtifacts.progress.queueTotal ?? 0)}`
        : null,
      latestYieldPer1000Npns: runArtifacts?.latestBatch?.quality?.yieldPer1000Npns ?? null,
      latestNetNewPairs: runArtifacts?.latestBatch?.compareStats?.netNewPairs ?? null,
      hourlyAttemptedPerHour:
        runArtifacts?.latestHourly?.hourly?.attemptedPerHour ??
        runArtifacts?.latestHourly?.latestBatch?.attemptedPerHour ??
        runArtifacts?.latestBatch?.liveAttemptedPerHour ??
        null,
      hourlyRepairQueueDelta: runArtifacts?.latestHourly?.hourly?.repairQueueDelta ?? null,
      lowYieldPhase3QueueSize: Number(phase3Summary?.queueSize ?? 0),
      validationViolations: Number(validation?.violationsCount ?? 0),
    },
    status: {
      m0BaselineFrozen: Boolean(baseline),
      m1BackfillDone: Boolean(backfillSummary),
      m2m3RunningOrDone: Boolean(runArtifacts?.progress),
      m4QueueBuilt: Boolean(phase3Summary),
      m5ValidationDone: Boolean(validation),
      closureReady:
        Boolean(baseline) &&
        Boolean(backfillSummary) &&
        Boolean(runArtifacts?.progress) &&
        Number(backfillSummary?.coverage?.mapNpnCoverageRateAfter ?? 0) >= 0.8,
    },
    details: {
      baseline,
      backfillSummary,
      runArtifacts,
      phase3Summary,
      validation,
    },
  };

  const mdLines = [
    `# NPN Closure Report`,
    `- generatedAt: ${report.generatedAt}`,
    `- M0 baseline frozen: ${report.status.m0BaselineFrozen}`,
    `- M1 backfill done: ${report.status.m1BackfillDone}`,
    `- M2/M3 run status: ${report.kpis.runStatus ?? "n/a"}`,
    `- M4 phase3 queue built: ${report.status.m4QueueBuilt}`,
    `- M5 validation done: ${report.status.m5ValidationDone}`,
    ``,
    `## KPI`,
    `- active usable barcodes (baseline): ${report.kpis.activeUsableBarcodesBaseline}`,
    `- barcodeCandidates baseline: ${report.kpis.barcodeCandidatesBaseline}`,
    `- barcodeCandidates after backfill: ${report.kpis.barcodeCandidatesAfterBackfill}`,
    `- barcodeCandidates delta: ${report.kpis.barcodeCandidatesDelta}`,
    `- map NPN coverage rate after backfill: ${report.kpis.mapNpnCoverageRateAfterBackfill}`,
    `- latest yieldPer1000Npns: ${report.kpis.latestYieldPer1000Npns ?? "n/a"}`,
    `- latest netNewPairs: ${report.kpis.latestNetNewPairs ?? "n/a"}`,
    `- hourly attempted/hour: ${report.kpis.hourlyAttemptedPerHour ?? "n/a"}`,
    `- hourly repair queue delta: ${report.kpis.hourlyRepairQueueDelta ?? "n/a"}`,
    `- phase3 queue size: ${report.kpis.lowYieldPhase3QueueSize}`,
    `- validation violations: ${report.kpis.validationViolations}`,
    ``,
    `## Closure`,
    `- closureReady: ${report.status.closureReady}`,
  ];

  await ensureDir(outDir);
  const jsonPath = path.join(outDir, "closure_report.json");
  const mdPath = path.join(outDir, "closure_report.md");
  fs.writeFileSync(jsonPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
  fs.writeFileSync(mdPath, `${mdLines.join("\n")}\n`, "utf8");

  console.log(JSON.stringify({ ok: true, outDir, jsonPath, mdPath, closureReady: report.status.closureReady }, null, 2));
};

main().catch((error) => {
  console.error("[build-npn-closure-report] fatal:", error?.message ?? error);
  process.exit(1);
});
