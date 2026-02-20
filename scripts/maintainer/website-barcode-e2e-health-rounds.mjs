#!/usr/bin/env node
/* eslint-disable no-console */

import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";

const ROOT_DIR = process.cwd();
const WEBSITE_E2E_SCRIPT = path.join(ROOT_DIR, "scripts", "maintainer", "website-barcode-e2e.mjs");
const BACKEND_HEALTH_CHECK_SCRIPT = path.join(ROOT_DIR, "scripts", "maintainer", "backend-health-check.sh");
const RUN_ROOT_DIR = path.join(ROOT_DIR, "output", `website-barcode-e2e-health-rounds-${Date.now()}`);
const PROMOTION_STATE_FILE =
  process.env.WEB_E2E_PROMOTION_STATE_FILE || path.join(RUN_ROOT_DIR, "website-barcode-e2e-promotion-state.json");

const DEFAULTS = {
  suite: "web",
  phaseMode: "phase2",
  stopOn: process.env.WEB_E2E_SSE_STOP_ON || "revision1",
  sseStopTailMs: Number(process.env.WEB_E2E_SSE_STOP_TAIL_MS || 5000),
  retries: Number(process.env.WEB_E2E_RETRIES || 2),
  targetConsecutive: Number(process.env.WEB_E2E_TARGET_CONSECUTIVE || 10),
  healthyThreshold: Number(process.env.WEB_E2E_HEALTHY_THRESHOLD || 5),
  admissionMode: String(process.env.WEB_E2E_ADMISSION_MODE || "auto").toLowerCase(),
  admissionRawDoneThreshold: Number(process.env.WEB_E2E_ADMISSION_RAW_DONE_THRESHOLD || 0.95),
  admissionProbeDoneThreshold: Number(process.env.WEB_E2E_ADMISSION_PROBE_DONE_THRESHOLD || 0.99),
  maxRounds: Number(process.env.WEB_E2E_MAX_ROUNDS || 20),
  sleepMs: Number(process.env.WEB_E2E_ROUND_SLEEP_MS || 1500),
  skipPostchecks: true,
  rawDoneShadowHardThreshold:
    process.env.WEB_E2E_RAW_DONE_SHADOW_HARD_THRESHOLD != null
      ? Number(process.env.WEB_E2E_RAW_DONE_SHADOW_HARD_THRESHOLD)
      : null,
  rawDoneHardEnforce:
    String(process.env.WEB_E2E_RAW_DONE_HARD_ENFORCE || "")
      .trim()
      .toLowerCase() === "true" ||
    String(process.env.WEB_E2E_RAW_DONE_HARD_ENFORCE || "")
      .trim() === "1",
};

const parseArgs = (argv) => {
  const options = { ...DEFAULTS };
  const withValue = new Set([
    "--suite",
    "--phase-mode",
    "--sse-stop-on",
    "--sse-stop-tail-ms",
    "--retries",
    "--target-consecutive",
    "--healthy-threshold",
    "--admission-mode",
    "--admission-raw-done-threshold",
    "--admission-probe-done-threshold",
    "--max-rounds",
    "--sleep-ms",
    "--raw-done-shadow-hard-threshold",
  ]);

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (!arg.startsWith("--")) continue;

    let flag = arg;
    let value = null;
    const eqIndex = arg.indexOf("=");
    if (eqIndex >= 0) {
      flag = arg.slice(0, eqIndex);
      value = arg.slice(eqIndex + 1);
    } else if (withValue.has(flag)) {
      value = argv[i + 1];
      i += 1;
    }

    if (flag === "--suite" && value) options.suite = String(value).toLowerCase();
    else if (flag === "--phase-mode" && value) options.phaseMode = String(value).toLowerCase();
    else if (flag === "--sse-stop-on" && value) options.stopOn = String(value).toLowerCase();
    else if (flag === "--sse-stop-tail-ms" && value != null) options.sseStopTailMs = Number(value);
    else if (flag === "--retries" && value != null) options.retries = Number(value);
    else if (flag === "--target-consecutive" && value != null) options.targetConsecutive = Number(value);
    else if (flag === "--healthy-threshold" && value != null) options.healthyThreshold = Number(value);
    else if (flag === "--admission-mode" && value) options.admissionMode = String(value).toLowerCase();
    else if (flag === "--admission-raw-done-threshold" && value != null) {
      options.admissionRawDoneThreshold = Number(value);
    } else if (flag === "--admission-probe-done-threshold" && value != null) {
      options.admissionProbeDoneThreshold = Number(value);
    }
    else if (flag === "--max-rounds" && value != null) options.maxRounds = Number(value);
    else if (flag === "--sleep-ms" && value != null) options.sleepMs = Number(value);
    else if (flag === "--no-skip-postchecks") options.skipPostchecks = false;
    else if (flag === "--skip-postchecks") options.skipPostchecks = true;
    else if (flag === "--raw-done-hard-enforce") options.rawDoneHardEnforce = true;
    else if (flag === "--raw-done-shadow-hard-threshold" && value != null) {
      options.rawDoneShadowHardThreshold = Number(value);
    } else if (flag === "--help" || flag === "-h") {
      printUsage();
      process.exit(0);
    }
  }

  if (!["kb", "web", "both"].includes(options.suite)) {
    throw new Error(`Invalid --suite: ${options.suite}. Expected kb|web|both.`);
  }
  if (!["phase1", "phase2"].includes(options.phaseMode)) {
    throw new Error(`Invalid --phase-mode: ${options.phaseMode}. Expected phase1|phase2.`);
  }
  if (!["revision1", "fast_ai", "persisted"].includes(options.stopOn)) {
    throw new Error(`Invalid --sse-stop-on: ${options.stopOn}. Expected revision1|fast_ai|persisted.`);
  }
  if (!Number.isFinite(options.sseStopTailMs) || options.sseStopTailMs < 0) {
    throw new Error(`Invalid --sse-stop-tail-ms: ${options.sseStopTailMs}`);
  }
  if (!["auto", "persisted", "revision1"].includes(options.admissionMode)) {
    throw new Error(`Invalid --admission-mode: ${options.admissionMode}. Expected auto|persisted|revision1.`);
  }
  if (!Number.isFinite(options.retries) || options.retries < 0) {
    throw new Error(`Invalid --retries: ${options.retries}`);
  }
  if (!Number.isFinite(options.targetConsecutive) || options.targetConsecutive <= 0) {
    throw new Error(`Invalid --target-consecutive: ${options.targetConsecutive}`);
  }
  if (!Number.isFinite(options.healthyThreshold) || options.healthyThreshold <= 0) {
    throw new Error(`Invalid --healthy-threshold: ${options.healthyThreshold}`);
  }
  if (
    !Number.isFinite(options.admissionRawDoneThreshold) ||
    options.admissionRawDoneThreshold < 0 ||
    options.admissionRawDoneThreshold > 1
  ) {
    throw new Error(`Invalid --admission-raw-done-threshold: ${options.admissionRawDoneThreshold}`);
  }
  if (
    !Number.isFinite(options.admissionProbeDoneThreshold) ||
    options.admissionProbeDoneThreshold < 0 ||
    options.admissionProbeDoneThreshold > 1
  ) {
    throw new Error(`Invalid --admission-probe-done-threshold: ${options.admissionProbeDoneThreshold}`);
  }
  if (!Number.isFinite(options.maxRounds) || options.maxRounds <= 0) {
    throw new Error(`Invalid --max-rounds: ${options.maxRounds}`);
  }
  if (!Number.isFinite(options.sleepMs) || options.sleepMs < 0) {
    throw new Error(`Invalid --sleep-ms: ${options.sleepMs}`);
  }
  if (
    options.rawDoneShadowHardThreshold != null &&
    (!Number.isFinite(options.rawDoneShadowHardThreshold) || options.rawDoneShadowHardThreshold < 0)
  ) {
    throw new Error(
      `Invalid --raw-done-shadow-hard-threshold: ${options.rawDoneShadowHardThreshold}`,
    );
  }

  return options;
};

const printUsage = () => {
  console.log(`Website E2E Continuous Healthy Rounds

Usage:
  node scripts/maintainer/website-barcode-e2e-health-rounds.mjs [options]

Options:
  --suite kb|web|both
  --phase-mode phase1|phase2
  --sse-stop-on revision1|fast_ai|persisted
  --sse-stop-tail-ms <ms>          (default: env WEB_E2E_SSE_STOP_TAIL_MS or 5000)
  --retries <n>
  --target-consecutive <n>         (default: 10)
  --healthy-threshold <n>          (default: 5)
  --admission-mode auto|persisted|revision1
  --admission-raw-done-threshold <ratio>   (default: 0.95)
  --admission-probe-done-threshold <ratio> (default: 0.99)
  --max-rounds <n>                 (default: 20)
  --sleep-ms <ms>                  (default: 1500)
  --skip-postchecks                (default: on)
  --no-skip-postchecks
  --raw-done-shadow-hard-threshold <ratio>
  --raw-done-hard-enforce
`);
};

const sleep = (ms) =>
  new Promise((resolve) => {
    setTimeout(resolve, Math.max(0, ms));
  });

const readJsonSafe = async (filePath) => {
  try {
    const raw = await fs.promises.readFile(filePath, "utf8");
    return JSON.parse(raw);
  } catch {
    return null;
  }
};

const runProcess = (command, args, env = process.env) =>
  spawnSync(command, args, {
    cwd: ROOT_DIR,
    env,
    encoding: "utf8",
  });

const parseLastJsonLine = (text) => {
  const lines = String(text || "")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
  for (let i = lines.length - 1; i >= 0; i -= 1) {
    try {
      return JSON.parse(lines[i]);
    } catch {
      // continue
    }
  }
  return null;
};

const runBackendHealthCheck = () => {
  const proc = runProcess(BACKEND_HEALTH_CHECK_SCRIPT, []);
  const payload = parseLastJsonLine(proc.stdout);
  if (payload && typeof payload === "object") {
    return {
      ...payload,
      status: payload.status === "healthy" ? "healthy" : "unhealthy",
    };
  }
  return {
    ts: new Date().toISOString(),
    status: "unhealthy",
    reason: proc.status === 0 ? "health_parse_failed" : `health_check_exit_${proc.status}`,
    stdout: String(proc.stdout || "").trim(),
    stderr: String(proc.stderr || "").trim(),
  };
};

const loadConsecutivePasses = async () => {
  const state = await readJsonSafe(PROMOTION_STATE_FILE);
  return Number.isFinite(Number(state?.suiteBConsecutivePasses))
    ? Number(state.suiteBConsecutivePasses)
    : 0;
};

const mergeCountMaps = (...maps) => {
  const merged = {};
  for (const map of maps) {
    if (!map || typeof map !== "object") continue;
    for (const [key, value] of Object.entries(map)) {
      if (!Number.isFinite(Number(value))) continue;
      merged[key] = (merged[key] || 0) + Number(value);
    }
  }
  return merged;
};

const topCountEntries = (counts, limit = 10) =>
  Object.entries(counts || {})
    .sort((a, b) => b[1] - a[1])
    .slice(0, Math.max(0, limit))
    .map(([key, count]) => ({ key, count }));

const resolveAdmissionMode = (configuredMode, stopOn) => {
  if (configuredMode !== "auto") return configuredMode;
  return stopOn === "persisted" ? "persisted" : "revision1";
};

const resolveAdmissionMetricPass = (mode, round, options) => {
  if (!round || round.status !== "completed" || round.healthStatus !== "healthy") return false;
  if (mode === "persisted") {
    if (!Number.isFinite(round.rawDoneRate)) return false;
    return round.rawDoneRate >= options.admissionRawDoneThreshold;
  }
  if (!Number.isFinite(round.probeDoneRate)) return false;
  return round.probeDoneRate >= options.admissionProbeDoneThreshold;
};

const toPct = (value) => {
  if (!Number.isFinite(value)) return "n/a";
  return `${(value * 100).toFixed(1)}%`;
};

const buildRoundSummaryLine = (round, options) => {
  const prefix = `[round ${String(round.round).padStart(2, "0")}]`;
  if (round.status === "skipped_unhealthy") {
    return (
      `${prefix} unhealthy -> skipped ` +
      `(promotion=${round.promotionConsecutivePasses}/${options.targetConsecutive}, ` +
      `healthy=${round.consecutiveHealthyRounds}/${options.healthyThreshold}, ` +
      `admission=${round.consecutiveAdmissionRounds}/${options.healthyThreshold})`
    );
  }
  return (
    `${prefix} gate=${round.gatePass ? "PASS" : "FAIL"} ` +
    `health=${round.healthStatus || "unknown"} ` +
    `promotion=${round.promotionConsecutivePasses}/${options.targetConsecutive} ` +
    `healthy=${round.consecutiveHealthyRounds}/${options.healthyThreshold} ` +
    `admission=${round.consecutiveAdmissionRounds}/${options.healthyThreshold} ` +
    `metric=${round.admissionModeResolved || "n/a"}:${round.admissionMetricPass ? "pass" : "fail"} ` +
    `rawDone=${toPct(round.rawDoneRate)} ` +
    `probeDone=${toPct(round.probeDoneRate)}`
  );
};

const writeReport = async (runDir, summary) => {
  const reportPath = path.join(runDir, "rounds_report.md");
  const lines = [];
  lines.push("# Website E2E Continuous Healthy Rounds");
  lines.push("");
  lines.push(`- generatedAt: ${summary.generatedAt}`);
  lines.push(`- targetConsecutive: ${summary.targetConsecutive}`);
  lines.push(`- healthyThreshold: ${summary.newAdmissionThreshold.healthyThreshold}`);
  lines.push(
    `- admissionMode: ${summary.newAdmissionThreshold.admissionMode} (auto->${summary.newAdmissionThreshold.autoModeRule})`,
  );
  lines.push(`- sseStopTailMs: ${summary.newAdmissionThreshold.sseStopTailMs}`);
  lines.push(`- admissionRawDoneThreshold: ${summary.newAdmissionThreshold.admissionRawDoneThreshold}`);
  lines.push(`- admissionProbeDoneThreshold: ${summary.newAdmissionThreshold.admissionProbeDoneThreshold}`);
  lines.push(`- maxRounds: ${summary.maxRounds}`);
  lines.push(`- reachedTargetByNewAdmission: ${summary.reachedTargetByNewAdmission ? "yes" : "no"}`);
  lines.push(`- reachedTargetByPromotion: ${summary.reachedTargetByPromotion ? "yes" : "no"}`);
  lines.push(`- reachedTarget: ${summary.reachedTarget ? "yes" : "no"}`);
  lines.push(`- finalConsecutivePasses: ${summary.finalConsecutivePasses}`);
  lines.push(`- runDir: ${runDir}`);
  lines.push("");
  lines.push("## Rounds");
  lines.push("");
  for (const round of summary.rounds) {
    lines.push(
      `- round=${round.round} status=${round.status} gate=${round.gatePass == null ? "n/a" : round.gatePass ? "PASS" : "FAIL"} promotion=${round.promotionConsecutivePasses}`,
    );
    if (round.outDir) lines.push(`  outDir=${round.outDir}`);
    lines.push(
      `  healthy/admission=${round.consecutiveHealthyRounds}/${round.consecutiveAdmissionRounds} mode=${round.admissionModeResolved ?? "n/a"} metric=${round.admissionMetricPass ? "pass" : "fail"}`,
    );
    if (round.rawDoneRate != null || round.probeDoneRate != null) {
      lines.push(
        `  done(raw/probe)=${toPct(round.rawDoneRate)}/${toPct(round.probeDoneRate)}`,
      );
    }
  }
  lines.push("");
  lines.push("## Raw Done Attribution (Aggregate)");
  lines.push("");
  for (const entry of summary.aggregate.rawDoneAttributionTop) {
    lines.push(`- ${entry.key}: ${entry.count}`);
  }
  lines.push("");
  await fs.promises.writeFile(reportPath, lines.join("\n"), "utf8");
};

const main = async () => {
  const options = parseArgs(process.argv.slice(2));
  await fs.promises.mkdir(RUN_ROOT_DIR, { recursive: true });

  const rounds = [];
  let reachedTarget = false;
  let reachedTargetByNewAdmission = false;
  let finalConsecutivePasses = await loadConsecutivePasses();
  let consecutiveHealthyRounds = 0;
  let consecutiveAdmissionRounds = 0;

  console.log(
    `[health-rounds] start promotionTarget=${options.targetConsecutive} healthyThreshold=${options.healthyThreshold} maxRounds=${options.maxRounds} suite=${options.suite} phase=${options.phaseMode} admissionMode=${options.admissionMode} tailMs=${options.sseStopTailMs}`,
  );
  console.log(`[health-rounds] runDir=${RUN_ROOT_DIR}`);

  for (let round = 1; round <= options.maxRounds; round += 1) {
    const startedAt = new Date().toISOString();
    const roundLabel = `round-${String(round).padStart(2, "0")}-${Date.now()}`;
    const roundOutDir = path.join(RUN_ROOT_DIR, roundLabel);
    const backendHealth = runBackendHealthCheck();

    const roundResult = {
      round,
      startedAt,
      endedAt: null,
      status: "pending",
      outDir: null,
      healthStatus: backendHealth?.status || "unknown",
      backendHealth,
      gatePass: null,
      promotionConsecutivePasses: finalConsecutivePasses,
      promotionUpdateEnabled: null,
      promotionSkipReason: null,
      rawDoneRate: null,
      probeDoneRate: null,
      rawNoTerminalCount: null,
      probeNoTerminalCount: null,
      rawDoneAttributionTop: [],
      shadowRawDone: null,
      warnings: [],
      failReasons: [],
      processExitCode: null,
      admissionModeResolved: resolveAdmissionMode(options.admissionMode, options.stopOn),
      admissionMetricPass: false,
      admissionRoundPass: false,
      consecutiveHealthyRounds,
      consecutiveAdmissionRounds,
    };

    if (backendHealth?.status !== "healthy") {
      roundResult.status = "skipped_unhealthy";
      roundResult.promotionConsecutivePasses = await loadConsecutivePasses();
      finalConsecutivePasses = roundResult.promotionConsecutivePasses;
      consecutiveHealthyRounds = 0;
      consecutiveAdmissionRounds = 0;
      roundResult.consecutiveHealthyRounds = consecutiveHealthyRounds;
      roundResult.consecutiveAdmissionRounds = consecutiveAdmissionRounds;
      roundResult.endedAt = new Date().toISOString();
      rounds.push(roundResult);
      console.log(buildRoundSummaryLine(roundResult, options));
      if (round < options.maxRounds) {
        // eslint-disable-next-line no-await-in-loop
        await sleep(options.sleepMs);
      }
      continue;
    }

    const args = [
      WEBSITE_E2E_SCRIPT,
      "--suite",
      options.suite,
      "--phase-mode",
      options.phaseMode,
      "--sse-stop-on",
      options.stopOn,
      "--sse-stop-tail-ms",
      String(options.sseStopTailMs),
      "--retries",
      String(options.retries),
    ];
    if (options.skipPostchecks) args.push("--skip-postchecks");

    const env = {
      ...process.env,
      WEB_E2E_OUT_DIR: roundOutDir,
      WEB_E2E_PROMOTION_STATE_FILE: PROMOTION_STATE_FILE,
    };
    if (Number.isFinite(options.rawDoneShadowHardThreshold)) {
      env.WEB_E2E_RAW_DONE_SHADOW_HARD_THRESHOLD = String(options.rawDoneShadowHardThreshold);
    }
    if (options.rawDoneHardEnforce) {
      env.WEB_E2E_RAW_DONE_HARD_ENFORCE = "true";
    }

    const proc = runProcess(process.execPath, args, env);
    roundResult.processExitCode = proc.status;
    roundResult.outDir = roundOutDir;

    const gatePath = path.join(roundOutDir, "gate_summary.json");
    const gate = await readJsonSafe(gatePath);
    if (gate && typeof gate === "object") {
      roundResult.status = "completed";
      roundResult.gatePass = gate?.overall?.pass === true;
      roundResult.healthStatus = gate?.health?.status || roundResult.healthStatus;
      roundResult.promotionUpdateEnabled = gate?.promotion?.updateEnabled ?? null;
      roundResult.promotionSkipReason = gate?.promotion?.skipReason ?? null;
      roundResult.rawDoneRate = Number.isFinite(Number(gate?.observability?.doneRates?.rawDoneRate))
        ? Number(gate.observability.doneRates.rawDoneRate)
        : null;
      roundResult.probeDoneRate = Number.isFinite(Number(gate?.observability?.doneRates?.probeDoneRate))
        ? Number(gate.observability.doneRates.probeDoneRate)
        : null;
      roundResult.rawNoTerminalCount = Number.isFinite(Number(gate?.observability?.noTerminal?.rawNoTerminalCount))
        ? Number(gate.observability.noTerminal.rawNoTerminalCount)
        : null;
      roundResult.probeNoTerminalCount = Number.isFinite(Number(gate?.observability?.noTerminal?.probeNoTerminalCount))
        ? Number(gate.observability.noTerminal.probeNoTerminalCount)
        : null;
      roundResult.rawDoneAttributionTop = Array.isArray(gate?.observability?.rawDone?.attributionTop)
        ? gate.observability.rawDone.attributionTop
        : [];
      roundResult.shadowRawDone = gate?.shadowGate?.rawDone || null;
      roundResult.warnings = Array.isArray(gate?.overall?.warnings) ? gate.overall.warnings : [];
      roundResult.failReasons = Array.isArray(gate?.overall?.failReasons) ? gate.overall.failReasons : [];
    } else {
      roundResult.status = "gate_missing";
    }

    roundResult.promotionConsecutivePasses = await loadConsecutivePasses();
    finalConsecutivePasses = roundResult.promotionConsecutivePasses;
    roundResult.admissionMetricPass = resolveAdmissionMetricPass(
      roundResult.admissionModeResolved,
      roundResult,
      options,
    );
    roundResult.admissionRoundPass =
      roundResult.status === "completed" &&
      roundResult.healthStatus === "healthy" &&
      roundResult.admissionMetricPass;
    if (roundResult.status === "completed" && roundResult.healthStatus === "healthy") {
      consecutiveHealthyRounds += 1;
    } else {
      consecutiveHealthyRounds = 0;
    }
    if (roundResult.admissionRoundPass) {
      consecutiveAdmissionRounds += 1;
    } else {
      consecutiveAdmissionRounds = 0;
    }
    roundResult.consecutiveHealthyRounds = consecutiveHealthyRounds;
    roundResult.consecutiveAdmissionRounds = consecutiveAdmissionRounds;
    roundResult.endedAt = new Date().toISOString();
    rounds.push(roundResult);
    console.log(buildRoundSummaryLine(roundResult, options));

    if (
      consecutiveHealthyRounds >= options.healthyThreshold &&
      consecutiveAdmissionRounds >= options.healthyThreshold
    ) {
      reachedTargetByNewAdmission = true;
      break;
    }
    if (round < options.maxRounds) {
      // eslint-disable-next-line no-await-in-loop
      await sleep(options.sleepMs);
    }
  }

  const reachedTargetByPromotion = finalConsecutivePasses >= options.targetConsecutive;
  reachedTarget = reachedTargetByNewAdmission;

  const executedRounds = rounds.filter((round) => round.status === "completed");
  const rawDoneSamples = executedRounds
    .map((round) => round.rawDoneRate)
    .filter((value) => Number.isFinite(value));
  const probeDoneSamples = executedRounds
    .map((round) => round.probeDoneRate)
    .filter((value) => Number.isFinite(value));
  const rawDoneAttributionCounts = mergeCountMaps(
    ...executedRounds.map((round) => {
      const countMap = {};
      for (const entry of round.rawDoneAttributionTop || []) {
        if (!entry || typeof entry !== "object") continue;
        const key = String(entry.key || "").trim();
        const count = Number(entry.count);
        if (!key || !Number.isFinite(count)) continue;
        countMap[key] = (countMap[key] || 0) + count;
      }
      return countMap;
    }),
  );

  const summary = {
    generatedAt: new Date().toISOString(),
    runDir: RUN_ROOT_DIR,
    targetConsecutive: options.targetConsecutive,
    healthyThreshold: options.healthyThreshold,
    maxRounds: options.maxRounds,
    reachedTargetByNewAdmission,
    reachedTargetByPromotion,
    reachedTarget,
    finalConsecutivePasses,
    newAdmissionThreshold: {
      healthyThreshold: options.healthyThreshold,
      admissionMode: options.admissionMode,
      autoModeRule: "stopOn=persisted -> rawDone; otherwise probeDone",
      sseStopTailMs: options.sseStopTailMs,
      admissionRawDoneThreshold: options.admissionRawDoneThreshold,
      admissionProbeDoneThreshold: options.admissionProbeDoneThreshold,
      consecutiveWindowRule: "all_rounds",
    },
    options,
    rounds,
    aggregate: {
      completedRounds: executedRounds.length,
      unhealthySkippedRounds: rounds.filter((round) => round.status === "skipped_unhealthy").length,
      rawDoneRateAverage:
        rawDoneSamples.length > 0
          ? rawDoneSamples.reduce((sum, value) => sum + value, 0) / rawDoneSamples.length
          : null,
      probeDoneRateAverage:
        probeDoneSamples.length > 0
          ? probeDoneSamples.reduce((sum, value) => sum + value, 0) / probeDoneSamples.length
          : null,
      rawDoneAttributionCounts,
      rawDoneAttributionTop: topCountEntries(rawDoneAttributionCounts, 12),
    },
  };

  await fs.promises.writeFile(
    path.join(RUN_ROOT_DIR, "rounds_summary.json"),
    `${JSON.stringify(summary, null, 2)}\n`,
    "utf8",
  );
  await writeReport(RUN_ROOT_DIR, summary);

  console.log(
    `[health-rounds] done admissionReached=${reachedTargetByNewAdmission ? "yes" : "no"} promotionReached=${reachedTargetByPromotion ? "yes" : "no"} finalConsecutive=${finalConsecutivePasses}/${options.targetConsecutive}`,
  );
  console.log(`[health-rounds] summary=${path.join(RUN_ROOT_DIR, "rounds_summary.json")}`);
};

main().catch((error) => {
  console.error("[health-rounds] failed:", error);
  process.exit(1);
});
