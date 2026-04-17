import fs from "node:fs/promises";
import path from "node:path";

import { ROOT_DIR, writeJson, writeText } from "./science-validation-reporting.mjs";

const readJson = async (filePath) => {
  const resolved = path.isAbsolute(filePath) ? filePath : path.join(ROOT_DIR, filePath);
  return JSON.parse(await fs.readFile(resolved, "utf8"));
};

const pct = (value) => (Number.isFinite(value) ? Number((value * 100).toFixed(2)) : null);

const normalizeText = (value) => String(value ?? "").replace(/\s+/g, " ").trim();
const hasText = (value) => normalizeText(value).length > 0;

const stableUnique = (values) =>
  Array.from(
    new Set(
      values
        .map((value) => normalizeText(value))
        .filter(Boolean),
    ),
  );

export const loadMobileScanSmokeConfig = async (
  filePath = "data/validation/mobile-scan-smoke-mini.v0.json",
) => readJson(filePath);

export const validateMobileScanSmokeConfig = (config) => {
  const errors = [];
  if (!config || typeof config !== "object" || Array.isArray(config)) {
    return [{ field: "config", message: "must be an object" }];
  }
  if (!normalizeText(config.version)) errors.push({ field: "version", message: "must be a non-empty string" });
  if (!Array.isArray(config.barcodes) || config.barcodes.length === 0) {
    errors.push({ field: "barcodes", message: "must be a non-empty array" });
  } else {
    for (const row of config.barcodes) {
      if (!normalizeText(row?.role)) errors.push({ field: "barcodes.role", message: "role must be non-empty" });
      if (!normalizeText(row?.barcode)) errors.push({ field: "barcodes.barcode", message: "barcode must be non-empty" });
    }
  }
  if (!config.runProfile || typeof config.runProfile !== "object") {
    errors.push({ field: "runProfile", message: "must be an object" });
  }
  if (!config.thresholds || typeof config.thresholds !== "object") {
    errors.push({ field: "thresholds", message: "must be an object" });
  }
  if (config.devicePreflight != null) {
    if (typeof config.devicePreflight !== "object" || Array.isArray(config.devicePreflight)) {
      errors.push({ field: "devicePreflight", message: "must be an object when provided" });
    } else {
      if (config.devicePreflight.enabled != null && typeof config.devicePreflight.enabled !== "boolean") {
        errors.push({ field: "devicePreflight.enabled", message: "must be a boolean when provided" });
      }
      if (config.devicePreflight.appUrl != null && !hasText(config.devicePreflight.appUrl)) {
        errors.push({ field: "devicePreflight.appUrl", message: "must be a non-empty string when provided" });
      }
      if (
        config.devicePreflight.waitSeconds != null
        && !Number.isFinite(Number(config.devicePreflight.waitSeconds))
      ) {
        errors.push({ field: "devicePreflight.waitSeconds", message: "must be numeric when provided" });
      }
      if (
        config.devicePreflight.strictPopupCheck != null
        && typeof config.devicePreflight.strictPopupCheck !== "boolean"
      ) {
        errors.push({ field: "devicePreflight.strictPopupCheck", message: "must be a boolean when provided" });
      }
    }
  }
  return errors;
};

const buildGate = ({ gate, status, reason, details = {} }) => ({
  gate,
  status,
  reason,
  details,
});

const rateFor = (attempts, predicate) => {
  if (!attempts.length) return 0;
  return attempts.filter(predicate).length / attempts.length;
};

const extractSelectedAnchor = (attempt) =>
  normalizeText(
    attempt?.rawDecisionSupport?.selectedIngredientName
    || attempt?.rawDecisionSupport?.selectedIngredient?.name
    || attempt?.rawDecisionSupport?.selectedIngredient
    || "",
  );

const extractScoreBand = (attempt) =>
  normalizeText(
    attempt?.rawDecisionSupport?.nutriScoreCardV2?.overallBand
    || attempt?.rawDecisionSupport?.scoreCardV2?.overallBand
    || attempt?.rawDecisionSupport?.score?.overallBand
    || "",
  );

const extractVerdict = (attempt) => normalizeText(attempt?.decisionSupportVerdict);

const evaluateMinGate = ({ gate, actual, minimum }) =>
  buildGate({
    gate,
    status: actual >= minimum ? "pass" : "fail",
    reason: actual >= minimum ? "threshold_met" : "threshold_below_min",
    details: {
      actual,
      actualPct: pct(actual),
      minimum,
      minimumPct: pct(minimum),
    },
  });

const evaluateMaxGate = ({ gate, actual, maximum }) =>
  buildGate({
    gate,
    status: actual <= maximum ? "pass" : "fail",
    reason: actual <= maximum ? "threshold_met" : "threshold_above_max",
    details: {
      actual,
      actualPct: pct(actual),
      maximum,
      maximumPct: pct(maximum),
    },
  });

const maybePushMinGate = ({ gates, gate, actual, minimum }) => {
  if (!Number.isFinite(minimum)) return;
  gates.push(evaluateMinGate({ gate, actual, minimum }));
};

const maybePushMaxGate = ({ gates, gate, actual, maximum }) => {
  if (!Number.isFinite(maximum)) return;
  gates.push(evaluateMaxGate({ gate, actual, maximum }));
};

const evaluateRoleExpectation = ({ attempts, expectation }) => {
  const roleAttempts = attempts.filter((attempt) => attempt.role === expectation.role);
  if (roleAttempts.length === 0) {
    return buildGate({
      gate: `role_${expectation.role}`,
      status: "fail",
      reason: "role_missing_from_summary",
      details: { role: expectation.role },
    });
  }

  const doneSeenRate = rateFor(roleAttempts, (attempt) => attempt.doneSeen === true);
  const scoreVisibleRate = rateFor(roleAttempts, (attempt) => attempt.scoreVisible === true);
  const failures = [];

  if (Number.isFinite(expectation.doneSeenRateMin) && doneSeenRate < expectation.doneSeenRateMin) {
    failures.push(`doneSeenRate_${doneSeenRate}_lt_${expectation.doneSeenRateMin}`);
  }
  if (Number.isFinite(expectation.doneSeenRateMax) && doneSeenRate > expectation.doneSeenRateMax) {
    failures.push(`doneSeenRate_${doneSeenRate}_gt_${expectation.doneSeenRateMax}`);
  }
  if (Number.isFinite(expectation.scoreVisibleRateMin) && scoreVisibleRate < expectation.scoreVisibleRateMin) {
    failures.push(`scoreVisibleRate_${scoreVisibleRate}_lt_${expectation.scoreVisibleRateMin}`);
  }
  if (Number.isFinite(expectation.scoreVisibleRateMax) && scoreVisibleRate > expectation.scoreVisibleRateMax) {
    failures.push(`scoreVisibleRate_${scoreVisibleRate}_gt_${expectation.scoreVisibleRateMax}`);
  }

  return buildGate({
    gate: `role_${expectation.role}`,
    status: failures.length === 0 ? "pass" : "fail",
    reason: failures.length === 0 ? "role_expectation_met" : "role_expectation_failed",
    details: {
      role: expectation.role,
      attempts: roleAttempts.length,
      doneSeenRate,
      doneSeenRatePct: pct(doneSeenRate),
      scoreVisibleRate,
      scoreVisibleRatePct: pct(scoreVisibleRate),
      failures,
    },
  });
};

const evaluateRepeatConsistency = ({ attempts, roles }) => {
  const failures = [];
  for (const role of roles) {
    const roleAttempts = attempts.filter((attempt) => attempt.role === role);
    if (roleAttempts.length < 2) continue;
    const selectedAnchors = stableUnique(roleAttempts.map(extractSelectedAnchor));
    const scoreBands = stableUnique(roleAttempts.map(extractScoreBand));
    const verdicts = stableUnique(roleAttempts.map(extractVerdict));
    if (selectedAnchors.length > 1 || scoreBands.length > 1 || verdicts.length > 1) {
      failures.push({
        role,
        selectedAnchors,
        scoreBands,
        verdicts,
      });
    }
  }

  return buildGate({
    gate: "repeat_consistency",
    status: failures.length === 0 ? "pass" : "fail",
    reason: failures.length === 0 ? "repeat_consistency_stable" : "repeat_consistency_drift",
    details: { failures },
  });
};

export const evaluateMobileScanSmokeSummary = ({ config, summary }) => {
  const attempts = Array.isArray(summary?.attempts) ? summary.attempts : [];
  const thresholds = config?.thresholds ?? {};
  const stats = summary?.stats ?? {};
  const gates = [];

  maybePushMinGate({
    gates,
    gate: "done_seen_rate",
    actual: Number(stats.doneSeenRate ?? rateFor(attempts, (attempt) => attempt.doneSeen === true)),
    minimum: Number(thresholds.doneSeenRateMin),
  });
  maybePushMinGate({
    gates,
    gate: "score_visible_rate",
    actual: Number(stats.scoreVisibleRate ?? rateFor(attempts, (attempt) => attempt.scoreVisible === true)),
    minimum: Number(thresholds.scoreVisibleRateMin),
  });
  maybePushMinGate({
    gates,
    gate: "content_value_pass_rate",
    actual: Number(stats.contentValuePassRate ?? rateFor(attempts, (attempt) => attempt.contentValuePass === true)),
    minimum: Number(thresholds.contentValuePassRateMin),
  });
  maybePushMinGate({
    gates,
    gate: "regulatory_rich_rate",
    actual: Number(stats.regulatoryRichRate ?? rateFor(attempts, (attempt) => attempt.regulatoryRich === true)),
    minimum: Number(thresholds.regulatoryRichRateMin),
  });
  maybePushMaxGate({
    gates,
    gate: "killer_client_timeout_rate",
    actual: Number(
      stats.killerProductClientTimeoutRate
      ?? rateFor(
        attempts.filter((attempt) => attempt.role === "killer"),
        (attempt) => attempt.decisionSupportFetchStatus === "timeout",
      ),
    ),
    maximum: Number(thresholds.killerProductClientTimeoutRateMax),
  });

  for (const expectation of config?.roleExpectations ?? []) {
    gates.push(evaluateRoleExpectation({ attempts, expectation }));
  }

  gates.push(
    evaluateRepeatConsistency({
      attempts,
      roles: Array.isArray(config?.repeatConsistencyRoles) ? config.repeatConsistencyRoles : [],
    }),
  );

  const fail = gates.filter((gate) => gate.status === "fail").length;
  const pass = gates.filter((gate) => gate.status === "pass").length;
  const warn = gates.filter((gate) => gate.status === "warn").length;

  return {
    version: config?.version ?? "mobile-scan-smoke-mini",
    generatedAt: new Date().toISOString(),
    releaseBlocker: Boolean(config?.releaseBlocker),
    summaryPath: summary?.summaryPath ?? null,
    stats: summary?.stats ?? {},
    gates,
    summary: {
      total: gates.length,
      pass,
      warn,
      fail,
    },
  };
};

const summarizePreflight = (preflight) => ({
  targetUdid: normalizeText(preflight?.targetUdid) || null,
  appUrl: normalizeText(preflight?.appUrl) || null,
  popupBlocked: preflight?.popupBlocked === true,
  popupSignals: Array.isArray(preflight?.popupSignals) ? preflight.popupSignals.filter((item) => hasText(item)) : [],
  screenshots: {
    launch: normalizeText(preflight?.screenshots?.launch) || null,
    preflight: normalizeText(preflight?.screenshots?.preflight) || null,
  },
});

const buildPreflightGate = ({ config, preflight }) => {
  const requirement = config?.devicePreflight ?? {};
  const preflightEnabled = requirement.enabled !== false;
  if (!preflightEnabled) {
    return buildGate({
      gate: "device_preflight",
      status: "warn",
      reason: "device_preflight_disabled",
      details: {},
    });
  }

  if (!preflight || typeof preflight !== "object") {
    return buildGate({
      gate: "device_preflight",
      status: "fail",
      reason: "device_preflight_missing",
      details: {
        requiredAppUrl: normalizeText(requirement.appUrl) || null,
      },
    });
  }

  const summary = summarizePreflight(preflight);
  const hasLaunchShot = hasText(summary.screenshots.launch);
  const hasPreflightShot = hasText(summary.screenshots.preflight);

  if (!summary.targetUdid) {
    return buildGate({
      gate: "device_preflight",
      status: "fail",
      reason: "device_preflight_missing_udid",
      details: summary,
    });
  }

  if (!hasLaunchShot || !hasPreflightShot) {
    return buildGate({
      gate: "device_preflight",
      status: "fail",
      reason: "device_preflight_missing_screenshots",
      details: summary,
    });
  }

  if (summary.popupBlocked) {
    return buildGate({
      gate: "device_preflight",
      status: "fail",
      reason: "device_preflight_blocked",
      details: summary,
    });
  }

  return buildGate({
    gate: "device_preflight",
    status: "pass",
    reason: "device_preflight_ready",
    details: summary,
  });
};

export const evaluateMobileScanSmokeRun = ({ config, summary, preflight = null }) => {
  const report = evaluateMobileScanSmokeSummary({ config, summary });
  const gates = [buildPreflightGate({ config, preflight }), ...(report.gates ?? [])];
  const fail = gates.filter((gate) => gate.status === "fail").length;
  const pass = gates.filter((gate) => gate.status === "pass").length;
  const warn = gates.filter((gate) => gate.status === "warn").length;
  return {
    ...report,
    preflight: preflight ? summarizePreflight(preflight) : null,
    gates,
    summary: {
      total: gates.length,
      pass,
      warn,
      fail,
    },
  };
};

export const renderMobileScanSmokeMarkdown = (report) => {
  const lines = [];
  lines.push(`# Mobile Scan Smoke Mini`);
  lines.push("");
  lines.push(`- version: ${report.version}`);
  lines.push(`- generatedAt: ${report.generatedAt}`);
  lines.push(`- releaseBlocker: ${report.releaseBlocker}`);
  if (report.summaryPath) lines.push(`- summaryPath: ${report.summaryPath}`);
  if (report.preflight?.targetUdid) lines.push(`- preflightTargetUdid: ${report.preflight.targetUdid}`);
  if (report.preflight?.appUrl) lines.push(`- preflightAppUrl: ${report.preflight.appUrl}`);
  lines.push("");
  lines.push(`## Gate Summary`);
  lines.push("");
  lines.push(`- pass: ${report.summary.pass}`);
  lines.push(`- warn: ${report.summary.warn}`);
  lines.push(`- fail: ${report.summary.fail}`);
  if (report.preflight) {
    lines.push("");
    lines.push("## Device Preflight");
    lines.push("");
    lines.push(`- popupBlocked: ${report.preflight.popupBlocked}`);
    lines.push(`- popupSignals: ${(report.preflight.popupSignals ?? []).join(", ") || "none"}`);
    lines.push(`- launchScreenshot: ${report.preflight.screenshots?.launch ?? "missing"}`);
    lines.push(`- preflightScreenshot: ${report.preflight.screenshots?.preflight ?? "missing"}`);
  }
  lines.push("");
  lines.push(`## Gates`);
  lines.push("");
  for (const gate of report.gates) {
    lines.push(`- ${gate.gate}: ${gate.status} (${gate.reason})`);
  }
  return `${lines.join("\n")}\n`;
};

export const writeMobileScanSmokeReport = async ({
  report,
  outDir = "output/mobile-scan-smoke-mini",
  outputBase = "mobile-scan-smoke-mini",
}) => {
  const resolvedOutDir = path.resolve(ROOT_DIR, outDir);
  await fs.mkdir(resolvedOutDir, { recursive: true });
  const stamp = String(Date.now());
  const jsonPath = path.join(outDir, `${outputBase}-${stamp}.json`);
  const mdPath = path.join(outDir, `${outputBase}-${stamp}.md`);
  await writeJson(jsonPath, report);
  await writeText(mdPath, renderMobileScanSmokeMarkdown(report));
  return { jsonPath, mdPath };
};
