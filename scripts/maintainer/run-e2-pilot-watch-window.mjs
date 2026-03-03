#!/usr/bin/env node
/* eslint-disable no-console */

import fs from "node:fs/promises";
import path from "node:path";

const ROOT_DIR = process.cwd();
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

const readJson = async (filePath) => JSON.parse(await fs.readFile(filePath, "utf8"));

const writeJson = async (filePath, payload) => {
  await ensureDir(path.dirname(filePath));
  await fs.writeFile(filePath, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
};

const writeText = async (filePath, body) => {
  await ensureDir(path.dirname(filePath));
  await fs.writeFile(filePath, body, "utf8");
};

const asNumber = (value, fallback = 0) => {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
};

const clamp01 = (value) => Math.max(0, Math.min(1, asNumber(value, 0)));

const main = async () => {
  const pilotScopePath = resolvePath(getArg("pilot-scope-json"));
  if (!pilotScopePath) {
    console.error("[run-e2-pilot-watch-window] missing --pilot-scope-json");
    process.exit(1);
  }

  const outDir = resolvePath(getArg("out-dir")) || path.join(path.dirname(pilotScopePath), "watch_window");
  await ensureDir(outDir);

  const e1ReportPath = resolvePath(getArg("e1-report-json"));
  const watchMetricsPath = resolvePath(getArg("watch-metrics-json"));
  const currentScope = String(getArg("current-scope", "top10")).trim().toLowerCase();
  const windowHours = Math.max(1, asNumber(getArg("window-hours"), 48));

  const pilotScope = await readJson(pilotScopePath);
  const e1Report = e1ReportPath ? await readJson(e1ReportPath).catch(() => null) : null;
  const watchMetrics = watchMetricsPath ? await readJson(watchMetricsPath).catch(() => null) : null;

  const thresholds = {
    minPrimaryImprovement: clamp01(getArg("min-primary-improvement", 0.2)),
    maxConflictRate: clamp01(getArg("max-conflict-rate", 0.01)),
    maxConflictAbs: Math.max(0, asNumber(getArg("max-conflict-abs", 5))),
    maxUnexpected409Rate: clamp01(getArg("max-unexpected409-rate", 0.001)),
    maxInlineFallbackRate: clamp01(getArg("max-inline-fallback-rate", 0.001)),
  };

  const primaryMetricRelativeImprovement = asNumber(
    watchMetrics?.primaryMetricRelativeImprovement,
    asNumber(e1Report?.primaryMetricRelativeImprovement, 0),
  );
  const conflictRate = asNumber(watchMetrics?.conflict_rate, asNumber(e1Report?.conflict_rate, 0));
  const conflictAbs = asNumber(watchMetrics?.conflict_abs, asNumber(e1Report?.conflict_abs, 0));
  const unexpected409Rate = asNumber(
    watchMetrics?.unexpected409Rate,
    asNumber(e1Report?.metrics?.stableDigestUnexpected409Rate_patch, 0),
  );
  const inlineFallbackRate = asNumber(
    watchMetrics?.inlineFallbackRate,
    asNumber(e1Report?.metrics?.inlineFallbackProxyRate_patch, 0),
  );
  const crossIdentityHitCount = Math.max(0, asNumber(watchMetrics?.crossIdentityHitCount, 0));
  const rollbackTriggerCount = Math.max(0, asNumber(watchMetrics?.rollbackTriggerCount, 0));
  const candidateScopeDriftCount = Math.max(0, asNumber(watchMetrics?.candidateScopeDriftCount, 0));

  const doneSeenControl = asNumber(watchMetrics?.doneSeenRate_control, asNumber(e1Report?.metrics?.doneSeenRate_control, 0));
  const doneSeenPatch = asNumber(watchMetrics?.doneSeenRate_patch, asNumber(e1Report?.metrics?.doneSeenRate_patch, 0));
  const scoreVisibleControl = asNumber(watchMetrics?.scoreVisibleRate_control, asNumber(e1Report?.metrics?.scoreVisibleRate_control, 0));
  const scoreVisiblePatch = asNumber(watchMetrics?.scoreVisibleRate_patch, asNumber(e1Report?.metrics?.scoreVisibleRate_patch, 0));
  const userVisibleRegression = doneSeenPatch < doneSeenControl || scoreVisiblePatch < scoreVisibleControl;

  const gateChecks = {
    primaryImprovementPass: primaryMetricRelativeImprovement >= thresholds.minPrimaryImprovement,
    conflictRatePass: conflictRate <= thresholds.maxConflictRate,
    conflictAbsPass: conflictAbs <= thresholds.maxConflictAbs,
    crossIdentityPass: crossIdentityHitCount === 0,
    noUserVisibleRegressionPass: !userVisibleRegression,
    unexpected409Pass: unexpected409Rate <= thresholds.maxUnexpected409Rate,
    inlineFallbackPass: inlineFallbackRate <= thresholds.maxInlineFallbackRate,
    rollbackPass: rollbackTriggerCount === 0,
    candidateScopeDriftPass: candidateScopeDriftCount === 0,
  };

  const watchWindowPass = Object.values(gateChecks).every(Boolean);
  const rollbackApplied = !watchWindowPass;

  let nextScope = "hold";
  if (watchWindowPass && currentScope === "top10") nextScope = "top25";
  if (watchWindowPass && currentScope === "top25") nextScope = "full53";

  const blockingReasons = Object.entries(gateChecks)
    .filter(([, ok]) => !ok)
    .map(([name]) => name);

  const watchReport = {
    generatedAt: new Date().toISOString(),
    windowHours,
    currentScope,
    watchWindowPass,
    rollbackApplied,
    nextScope,
    blockingReasons,
    thresholds,
    metrics: {
      primaryMetricRelativeImprovement,
      conflict_rate: conflictRate,
      conflict_abs: conflictAbs,
      doneSeenRate_control: doneSeenControl,
      doneSeenRate_patch: doneSeenPatch,
      scoreVisibleRate_control: scoreVisibleControl,
      scoreVisibleRate_patch: scoreVisiblePatch,
      unexpected409Rate,
      inlineFallbackRate,
      crossIdentityHitCount,
      rollbackTriggerCount,
      candidateScopeDriftCount,
    },
    gateChecks,
    pilotScopeSummary: {
      pass: pilotScope?.pass === true,
      selectedRows: asNumber(pilotScope?.counts?.selectedRows, 0),
      selectionHash: pilotScope?.selectionHash || null,
    },
    sources: {
      pilotScopePath,
      e1ReportPath: e1ReportPath || null,
      watchMetricsPath: watchMetricsPath || null,
    },
  };

  const scaleDecision = {
    generatedAt: watchReport.generatedAt,
    watchWindowPass,
    rollbackApplied,
    nextScope,
    blockingReasons,
  };

  const rollbackManifest = {
    generatedAt: watchReport.generatedAt,
    rollbackApplied,
    reason: rollbackApplied ? (blockingReasons.join("|") || "watch_window_failure") : null,
    currentScope,
    nextScope,
  };

  await writeJson(path.join(outDir, "e2_pilot_watch_report.json"), watchReport);
  await writeText(path.join(outDir, "e2_pilot_watch_report.md"), [
    "# E2 Pilot Watch Window Report",
    "",
    `- watchWindowPass: ${watchWindowPass}`,
    `- rollbackApplied: ${rollbackApplied}`,
    `- nextScope: ${nextScope}`,
    `- blockingReasons: ${blockingReasons.length > 0 ? blockingReasons.join(", ") : "none"}`,
    `- windowHours: ${windowHours}`,
    "",
    `- primaryMetricRelativeImprovement: ${(primaryMetricRelativeImprovement * 100).toFixed(2)}%`,
    `- conflict_rate: ${(conflictRate * 100).toFixed(2)}%`,
    `- conflict_abs: ${conflictAbs}`,
    `- crossIdentityHitCount: ${crossIdentityHitCount}`,
    `- unexpected409Rate: ${(unexpected409Rate * 100).toFixed(2)}%`,
    `- inlineFallbackRate: ${(inlineFallbackRate * 100).toFixed(2)}%`,
  ].join("\n") + "\n");
  await writeJson(path.join(outDir, "e2_scale_decision.json"), scaleDecision);
  await writeJson(path.join(outDir, "e2_pilot_rollback_manifest.json"), rollbackManifest);

  console.log("[run-e2-pilot-watch-window] completed");
  console.log(JSON.stringify({ outDir, watchWindowPass, nextScope, rollbackApplied }, null, 2));

  if (!watchWindowPass) process.exit(2);
};

main().catch((error) => {
  console.error("[run-e2-pilot-watch-window] failed:", error instanceof Error ? error.stack || error.message : String(error));
  process.exit(1);
});

