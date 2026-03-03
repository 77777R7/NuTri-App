#!/usr/bin/env node
/* eslint-disable no-console */

import fs from "node:fs/promises";
import path from "node:path";
import crypto from "node:crypto";

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

const writeJsonl = async (filePath, rows) => {
  await ensureDir(path.dirname(filePath));
  const body = (Array.isArray(rows) ? rows : []).map((row) => JSON.stringify(row)).join("\n");
  await fs.writeFile(filePath, body ? `${body}\n` : "", "utf8");
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

const sha256 = (value) => crypto.createHash("sha256").update(value).digest("hex");

const getPathValue = (obj, pathParts, fallback = 0) => {
  let current = obj;
  for (const part of pathParts) {
    if (current == null || typeof current !== "object") return fallback;
    current = current[part];
  }
  return current == null ? fallback : current;
};

const toIso = (value) => {
  const t = new Date(value || "").getTime();
  if (!Number.isFinite(t)) return null;
  return new Date(t).toISOString();
};

const main = async () => {
  const waveId = String(getArg("wave-id", "")).trim();
  const metricsSourcePath = resolvePath(getArg("metrics-source-json"));
  if (!waveId || !metricsSourcePath) {
    console.error("[run-wave-post-enforce-smoke-watch] missing --wave-id or --metrics-source-json");
    process.exit(1);
  }

  const outDir = resolvePath(getArg("out-dir")) || path.join(path.dirname(metricsSourcePath), "smoke_watch");
  const apiBaseUrl = String(getArg("api-base-url", "")).trim() || null;
  const tokenMode = String(getArg("token-mode", "none")).trim().toLowerCase();
  const queryParamsRaw = String(getArg("query-params-json", "{}")).trim();
  const queryParams = (() => {
    try {
      const parsed = JSON.parse(queryParamsRaw);
      return parsed && typeof parsed === "object" ? parsed : {};
    } catch {
      return {};
    }
  })();

  const defaultWindowHours = Math.max(1, asNumber(getArg("window-hours", 6), 6));
  const overrideWindowHours = getArg("override-watch-window-hours");
  const usingEmergencyWindow = overrideWindowHours != null;
  const watchWindowHours = overrideWindowHours != null
    ? Math.max(2, asNumber(overrideWindowHours, 2))
    : defaultWindowHours;
  const overrideReason = String(getArg("override-reason", "")).trim() || null;
  const expectedMetricsSourceSha256 = String(getArg("expected-metrics-source-sha256", "")).trim() || null;
  const sourceDiversityPolicySha256Used = String(getArg("source-diversity-policy-sha256", "")).trim() || null;

  const thresholds = {
    maxUnexpected409Rate: clamp01(getArg("max-unexpected409-rate", 0.001)),
    maxInlineFallbackRate: clamp01(getArg("max-inline-fallback-rate", 0.001)),
  };

  const metricsRaw = await fs.readFile(metricsSourcePath, "utf8");
  const metrics = JSON.parse(metricsRaw);
  const metricsSourceSha256 = sha256(metricsRaw);

  const nowMs = Date.now();
  const metricsCaptureWindowStart = toIso(
    getArg("capture-window-start")
      || getPathValue(metrics, ["metricsCaptureWindowStart"], null)
      || new Date(nowMs - watchWindowHours * 60 * 60 * 1000).toISOString(),
  );
  const metricsCaptureWindowEnd = toIso(
    getArg("capture-window-end")
      || getPathValue(metrics, ["metricsCaptureWindowEnd"], null)
      || new Date(nowMs).toISOString(),
  );

  const querySignaturePayload = {
    apiBaseUrl,
    tokenMode,
    queryParams,
    waveId,
  };
  const metricsQuerySignature = sha256(JSON.stringify(querySignaturePayload));

  const startMs = metricsCaptureWindowStart ? new Date(metricsCaptureWindowStart).getTime() : Number.NaN;
  const endMs = metricsCaptureWindowEnd ? new Date(metricsCaptureWindowEnd).getTime() : Number.NaN;
  const windowOrderPass = Number.isFinite(startMs) && Number.isFinite(endMs) && endMs >= startMs;
  const expectedHashPass = !expectedMetricsSourceSha256 || expectedMetricsSourceSha256 === metricsSourceSha256;
  const hashDriftWithoutResample = Boolean(
    expectedMetricsSourceSha256
    && !expectedHashPass
    && !getPathValue(metrics, ["resampledAt"], null),
  );
  const overrideReasonPass = !usingEmergencyWindow || Boolean(overrideReason);

  const metricsSourceIntegrityPass = Boolean(
    metricsSourcePath
    && metricsSourceSha256
    && metricsCaptureWindowStart
    && metricsCaptureWindowEnd
    && metricsQuerySignature
    && windowOrderPass
    && !hashDriftWithoutResample,
  );

  const unexpected409Rate = asNumber(
    getPathValue(metrics, ["unexpected409Rate"], null),
    asNumber(getPathValue(metrics, ["metrics", "stableDigestUnexpected409Rate_patch"], 0), 0),
  );
  const inlineFallbackRate = asNumber(
    getPathValue(metrics, ["inlineFallbackRate"], null),
    asNumber(getPathValue(metrics, ["metrics", "inlineFallbackProxyRate_patch"], 0), 0),
  );
  const rollbackTriggerCount = Math.max(0, asNumber(getPathValue(metrics, ["rollbackTriggerCount"], 0), 0));
  const crossIdentityHitCount = Math.max(0, asNumber(getPathValue(metrics, ["crossIdentityHitCount"], 0), 0));
  const runtimePatchHitCountByLane = getPathValue(metrics, ["runtimePatchHitCountByLane"], null)
    ?? getPathValue(metrics, ["metrics", "runtimePatchHitCountByLane"], null);
  const runtimePatchLastMatchedIdentityByLane = getPathValue(metrics, ["runtimePatchLastMatchedIdentityByLane"], null)
    ?? getPathValue(metrics, ["metrics", "runtimePatchLastMatchedIdentityByLane"], null);

  const doneSeenControl = asNumber(
    getPathValue(metrics, ["doneSeenRate_control"], null),
    asNumber(getPathValue(metrics, ["metrics", "doneSeenRate_control"], 0), 0),
  );
  const doneSeenPatch = asNumber(
    getPathValue(metrics, ["doneSeenRate_patch"], null),
    asNumber(getPathValue(metrics, ["metrics", "doneSeenRate_patch"], 0), 0),
  );
  const scoreVisibleControl = asNumber(
    getPathValue(metrics, ["scoreVisibleRate_control"], null),
    asNumber(getPathValue(metrics, ["metrics", "scoreVisibleRate_control"], 0), 0),
  );
  const scoreVisiblePatch = asNumber(
    getPathValue(metrics, ["scoreVisibleRate_patch"], null),
    asNumber(getPathValue(metrics, ["metrics", "scoreVisibleRate_patch"], 0), 0),
  );

  const noVisibleRegression = doneSeenPatch >= doneSeenControl && scoreVisiblePatch >= scoreVisibleControl;
  const runtimeHitNonNegative = (() => {
    if (!runtimePatchHitCountByLane || typeof runtimePatchHitCountByLane !== "object") return true;
    return Object.values(runtimePatchHitCountByLane).every((value) => asNumber(value, 0) >= 0);
  })();

  const gateChecks = {
    metricsSourceIntegrityPass,
    overrideReasonPass,
    unexpected409Pass: unexpected409Rate <= thresholds.maxUnexpected409Rate,
    inlineFallbackPass: inlineFallbackRate <= thresholds.maxInlineFallbackRate,
    rollbackPass: rollbackTriggerCount === 0,
    crossIdentityPass: crossIdentityHitCount === 0,
    noVisibleRegressionPass: noVisibleRegression,
    runtimeHitNonNegativePass: runtimeHitNonNegative,
  };

  const watchWindowPass = Object.values(gateChecks).every(Boolean);
  const promotionTarget = String(getArg("promotion-target", "promote_to_50")).trim();
  const promotionDecision = watchWindowPass ? promotionTarget : "hold";

  const blockingReasons = Object.entries(gateChecks)
    .filter(([, ok]) => !ok)
    .map(([name]) => name);

  const fixableRows = [];
  if (!metricsSourceIntegrityPass) {
    fixableRows.push({
      queue: "fixable",
      reasonCode: "smoke_metrics_source_unverifiable",
      owner: "wave-smoke-ops",
      status: "open",
      eta: "next_cycle",
      waveId,
      metricsSourcePath,
      metricsSourceSha256,
      expectedMetricsSourceSha256,
    });
  }
  if (!overrideReasonPass) {
    fixableRows.push({
      queue: "fixable",
      reasonCode: "smoke_watch_override_reason_missing",
      owner: "wave-smoke-ops",
      status: "open",
      eta: "immediate",
      waveId,
      watchWindowHours,
      defaultWindowHours,
    });
  }

  const report = {
    generatedAt: new Date().toISOString(),
    waveId,
    watchWindowHours,
    overrideReason,
    watchWindowPass,
    promotionDecision,
    blockingReasons,
    thresholds,
    metrics: {
      unexpected409Rate,
      inlineFallbackRate,
      rollbackTriggerCount,
      crossIdentityHitCount,
      doneSeenRate_control: doneSeenControl,
      doneSeenRate_patch: doneSeenPatch,
      scoreVisibleRate_control: scoreVisibleControl,
      scoreVisibleRate_patch: scoreVisiblePatch,
      runtimePatchHitCountByLane,
      runtimePatchLastMatchedIdentityByLane,
    },
    gateChecks,
    metricsSourcePath: path.resolve(metricsSourcePath),
    metricsSourceSha256,
    metricsCaptureWindowStart,
    metricsCaptureWindowEnd,
    metricsQuerySignature,
    metricsSourceIntegrityPass,
    sourceDiversityPolicySha256Used,
    expectedMetricsSourceSha256,
    expectedHashPass,
  };

  const fileStem = `wave_${waveId}_smoke_watch_report`;
  await writeJson(path.join(outDir, `${fileStem}.json`), report);
  await writeText(
    path.join(outDir, `${fileStem}.md`),
    [
      `# Wave ${waveId} Smoke Watch Report`,
      "",
      `- watchWindowPass: ${watchWindowPass}`,
      `- promotionDecision: ${promotionDecision}`,
      `- blockingReasons: ${blockingReasons.length > 0 ? blockingReasons.join(", ") : "none"}`,
      "",
      `- metricsSourcePath: ${report.metricsSourcePath}`,
      `- metricsSourceSha256: ${metricsSourceSha256}`,
      `- metricsCaptureWindowStart: ${metricsCaptureWindowStart}`,
      `- metricsCaptureWindowEnd: ${metricsCaptureWindowEnd}`,
      `- metricsQuerySignature: ${metricsQuerySignature}`,
      `- metricsSourceIntegrityPass: ${metricsSourceIntegrityPass}`,
      `- overrideReasonPass: ${overrideReasonPass}`,
      "",
      `- unexpected409Rate: ${(unexpected409Rate * 100).toFixed(2)}%`,
      `- inlineFallbackRate: ${(inlineFallbackRate * 100).toFixed(2)}%`,
      `- rollbackTriggerCount: ${rollbackTriggerCount}`,
      `- crossIdentityHitCount: ${crossIdentityHitCount}`,
      `- noVisibleRegression: ${noVisibleRegression}`,
      `- sourceDiversityPolicySha256Used: ${sourceDiversityPolicySha256Used || "null"}`,
    ].join("\n") + "\n",
  );
  await writeJsonl(path.join(outDir, `wave_${waveId}_fixable_queue.jsonl`), fixableRows);

  console.log("[run-wave-post-enforce-smoke-watch] completed");
  console.log(JSON.stringify({
    outDir,
    waveId,
    watchWindowPass,
    promotionDecision,
    metricsSourceIntegrityPass,
  }, null, 2));

  if (!watchWindowPass) process.exit(2);
};

main().catch((error) => {
  console.error("[run-wave-post-enforce-smoke-watch] failed:", error instanceof Error ? error.stack || error.message : String(error));
  process.exit(1);
});
