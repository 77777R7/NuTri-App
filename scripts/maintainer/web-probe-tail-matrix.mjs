#!/usr/bin/env node
/* eslint-disable no-console */

import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";

const ROOT_DIR = process.cwd();
const WEBSITE_E2E_SCRIPT = path.join(ROOT_DIR, "scripts", "maintainer", "website-barcode-e2e.mjs");
const BACKEND_HEALTH_CHECK_SCRIPT = path.join(ROOT_DIR, "scripts", "maintainer", "backend-health-check.sh");
const DEFAULT_FIXTURE = path.join(ROOT_DIR, "scripts", "maintainer", "fixtures", "web_probe_pool.json");

const DEFAULTS = {
  fixture: DEFAULT_FIXTURE,
  rounds: 3,
  phaseMode: "phase2",
  retries: 2,
  tailShortMs: 5_000,
  tailLongMs: 15_000,
  persistedTailMs: 5_000,
  maxAttemptsPerGroup: 8,
  sleepMs: 1_000,
  outDir: path.join(ROOT_DIR, "output", `web-probe-tail-matrix-${Date.now()}`),
};

const RAW_DELTA_THRESHOLD = 0.2;
const PROBE_DELTA_MAX = 0.02;
const MIN_VALID_SAMPLE_SIZE = 10;

const parseArgs = (argv) => {
  const options = { ...DEFAULTS };
  const withValue = new Set([
    "--fixture",
    "--rounds",
    "--phase-mode",
    "--retries",
    "--tail-short-ms",
    "--tail-long-ms",
    "--persisted-tail-ms",
    "--max-attempts-per-group",
    "--sleep-ms",
    "--out-dir",
  ]);

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (!arg.startsWith("--")) continue;

    let flag = arg;
    let value = null;
    const eq = arg.indexOf("=");
    if (eq >= 0) {
      flag = arg.slice(0, eq);
      value = arg.slice(eq + 1);
    } else if (withValue.has(flag)) {
      value = argv[i + 1];
      i += 1;
    }

    if (flag === "--fixture" && value) {
      options.fixture = path.isAbsolute(value) ? value : path.join(ROOT_DIR, value);
    } else if (flag === "--rounds" && value != null) {
      options.rounds = Number(value);
    } else if (flag === "--phase-mode" && value) {
      options.phaseMode = String(value).toLowerCase();
    } else if (flag === "--retries" && value != null) {
      options.retries = Number(value);
    } else if (flag === "--tail-short-ms" && value != null) {
      options.tailShortMs = Number(value);
    } else if (flag === "--tail-long-ms" && value != null) {
      options.tailLongMs = Number(value);
    } else if (flag === "--persisted-tail-ms" && value != null) {
      options.persistedTailMs = Number(value);
    } else if (flag === "--max-attempts-per-group" && value != null) {
      options.maxAttemptsPerGroup = Number(value);
    } else if (flag === "--sleep-ms" && value != null) {
      options.sleepMs = Number(value);
    } else if (flag === "--out-dir" && value) {
      options.outDir = path.isAbsolute(value) ? value : path.join(ROOT_DIR, value);
    } else if (flag === "--help" || flag === "-h") {
      printUsage();
      process.exit(0);
    }
  }

  if (!["phase1", "phase2"].includes(options.phaseMode)) {
    throw new Error(`Invalid --phase-mode: ${options.phaseMode}. Expected phase1|phase2.`);
  }
  if (!Number.isFinite(options.rounds) || options.rounds <= 0) {
    throw new Error(`Invalid --rounds: ${options.rounds}`);
  }
  if (!Number.isFinite(options.retries) || options.retries < 0) {
    throw new Error(`Invalid --retries: ${options.retries}`);
  }
  if (!Number.isFinite(options.maxAttemptsPerGroup) || options.maxAttemptsPerGroup <= 0) {
    throw new Error(`Invalid --max-attempts-per-group: ${options.maxAttemptsPerGroup}`);
  }
  if (!Number.isFinite(options.sleepMs) || options.sleepMs < 0) {
    throw new Error(`Invalid --sleep-ms: ${options.sleepMs}`);
  }
  for (const [label, value] of [
    ["tail-short-ms", options.tailShortMs],
    ["tail-long-ms", options.tailLongMs],
    ["persisted-tail-ms", options.persistedTailMs],
  ]) {
    if (!Number.isFinite(value) || value < 0) {
      throw new Error(`Invalid --${label}: ${value}`);
    }
  }

  return options;
};

const printUsage = () => {
  console.log(`Web Probe Tail Matrix

Usage:
  node scripts/maintainer/web-probe-tail-matrix.mjs [options]

Options:
  --fixture <path>                 (default: scripts/maintainer/fixtures/web_probe_pool.json)
  --rounds <n>                     (default: 3)
  --phase-mode phase1|phase2       (default: phase2)
  --retries <n>                    (default: 2)
  --tail-short-ms <ms>             (default: 5000)
  --tail-long-ms <ms>              (default: 15000)
  --persisted-tail-ms <ms>         (default: 5000)
  --max-attempts-per-group <n>     (default: 8)
  --sleep-ms <ms>                  (default: 1000)
  --out-dir <path>
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

const writeJson = async (filePath, data) => {
  await fs.promises.mkdir(path.dirname(filePath), { recursive: true });
  await fs.promises.writeFile(filePath, `${JSON.stringify(data, null, 2)}\n`, "utf8");
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

const toPct = (value) => {
  if (!Number.isFinite(value)) return "n/a";
  return `${(value * 100).toFixed(1)}%`;
};

const average = (values) => {
  const nums = values.filter((value) => Number.isFinite(value));
  if (nums.length === 0) return null;
  return nums.reduce((sum, value) => sum + value, 0) / nums.length;
};

const sum = (values) =>
  values.reduce((total, value) => (Number.isFinite(value) ? total + value : total), 0);

const buildGroupLabel = (stopOn, tailMs) => `${stopOn} + tail=${tailMs}ms`;

const groupDefinitions = (options) => [
  {
    key: "revision1_tail_5s",
    label: buildGroupLabel("revision1", options.tailShortMs),
    stopOn: "revision1",
    tailMs: options.tailShortMs,
  },
  {
    key: "revision1_tail_15s",
    label: buildGroupLabel("revision1", options.tailLongMs),
    stopOn: "revision1",
    tailMs: options.tailLongMs,
  },
  {
    key: "persisted_tail_5s",
    label: buildGroupLabel("persisted", options.persistedTailMs),
    stopOn: "persisted",
    tailMs: options.persistedTailMs,
  },
];

const runAttempt = async ({ group, attemptIndex, options, outDir }) => {
  const attemptName = `attempt-${String(attemptIndex).padStart(2, "0")}-${Date.now()}`;
  const attemptDir = path.join(outDir, group.key, attemptName);
  const websiteOutDir = path.join(attemptDir, "website-e2e");
  const promotionStateFile = path.join(attemptDir, "promotion-state.json");

  const backendHealth = runBackendHealthCheck();
  const baseResult = {
    attempt: attemptIndex,
    attemptDir,
    websiteOutDir,
    promotionStateFile,
    groupKey: group.key,
    groupLabel: group.label,
    stopOn: group.stopOn,
    tailMs: group.tailMs,
    startedAt: new Date().toISOString(),
    endedAt: null,
    status: "pending",
    backendHealth,
    processExitCode: null,
    gatePath: path.join(websiteOutDir, "gate_summary.json"),
    suiteBSummaryPath: path.join(websiteOutDir, "suite_b_summary.json"),
    gateOverallPass: null,
    metrics: null,
    validRound: false,
  };

  if (backendHealth.status !== "healthy") {
    await fs.promises.mkdir(attemptDir, { recursive: true });
    await writeJson(path.join(attemptDir, "backend_health.json"), backendHealth);
    return {
      ...baseResult,
      endedAt: new Date().toISOString(),
      status: "skipped_unhealthy",
    };
  }

  const args = [
    WEBSITE_E2E_SCRIPT,
    "--suite",
    "web",
    "--input",
    options.fixture,
    "--phase-mode",
    options.phaseMode,
    "--retries",
    String(options.retries),
    "--skip-postchecks",
    "--sse-stop-on",
    group.stopOn,
    "--sse-stop-tail-ms",
    String(group.tailMs),
  ];
  const env = {
    ...process.env,
    WEB_E2E_OUT_DIR: websiteOutDir,
    WEB_E2E_PROMOTION_STATE_FILE: promotionStateFile,
  };
  const proc = runProcess(process.execPath, args, env);
  const gate = await readJsonSafe(baseResult.gatePath);
  const suiteB = await readJsonSafe(baseResult.suiteBSummaryPath);
  const metrics = suiteB?.metrics || null;

  const normalizedMetrics = metrics
    ? {
        sampledTotal: Number.isFinite(Number(metrics.sampledTotal)) ? Number(metrics.sampledTotal) : null,
        total: Number.isFinite(Number(metrics.total)) ? Number(metrics.total) : null,
        fixtureInvalidCount: Number.isFinite(Number(metrics.fixtureInvalidCount))
          ? Number(metrics.fixtureInvalidCount)
          : null,
        fixtureInvalidRatio: Number.isFinite(Number(metrics.fixtureInvalidRatio))
          ? Number(metrics.fixtureInvalidRatio)
          : null,
        rawDoneCount: Number.isFinite(Number(metrics.doneSeenCount)) ? Number(metrics.doneSeenCount) : null,
        rawDoneRate: Number.isFinite(Number(metrics.doneSeenRate)) ? Number(metrics.doneSeenRate) : null,
        probeDoneCount: Number.isFinite(Number(metrics.probeDoneCount)) ? Number(metrics.probeDoneCount) : null,
        probeDoneRate: Number.isFinite(Number(metrics.probeDoneRate)) ? Number(metrics.probeDoneRate) : null,
        rawNoTerminalCount: Number.isFinite(Number(metrics.rawNoTerminalCount))
          ? Number(metrics.rawNoTerminalCount)
          : null,
        probeNoTerminalCount: Number.isFinite(Number(metrics.probeNoTerminalCount))
          ? Number(metrics.probeNoTerminalCount)
          : null,
        abortErrorCount: Number.isFinite(Number(metrics.abortErrorCount)) ? Number(metrics.abortErrorCount) : null,
        timeoutCount: Number.isFinite(Number(metrics?.contractFailureCounts?.timeout))
          ? Number(metrics.contractFailureCounts.timeout)
          : 0,
      }
    : null;

  const validRound =
    normalizedMetrics != null &&
    Number.isFinite(normalizedMetrics.total) &&
    Number.isFinite(normalizedMetrics.sampledTotal) &&
    normalizedMetrics.total > 0;

  return {
    ...baseResult,
    endedAt: new Date().toISOString(),
    status: validRound ? "completed" : "completed_missing_summary",
    processExitCode: proc.status,
    gateOverallPass: gate?.overall?.pass === true,
    metrics: normalizedMetrics,
    validRound,
  };
};

const summarizeGroup = ({ group, attempts, options }) => {
  const validRounds = attempts.filter((attempt) => attempt.validRound);
  const sampledTotal = sum(validRounds.map((attempt) => attempt.metrics?.sampledTotal));
  const totalValid = sum(validRounds.map((attempt) => attempt.metrics?.total));
  const fixtureInvalidCount = sum(validRounds.map((attempt) => attempt.metrics?.fixtureInvalidCount));
  const fixtureInvalidRatio = sampledTotal > 0 ? fixtureInvalidCount / sampledTotal : null;

  const averageRawDoneRate = average(validRounds.map((attempt) => attempt.metrics?.rawDoneRate));
  const averageProbeDoneRate = average(validRounds.map((attempt) => attempt.metrics?.probeDoneRate));
  const averageRawNoTerminalCount = average(validRounds.map((attempt) => attempt.metrics?.rawNoTerminalCount));
  const averageProbeNoTerminalCount = average(validRounds.map((attempt) => attempt.metrics?.probeNoTerminalCount));
  const abortErrorCount = sum(validRounds.map((attempt) => attempt.metrics?.abortErrorCount));
  const timeoutCount = sum(validRounds.map((attempt) => attempt.metrics?.timeoutCount));

  const insufficientReasons = [];
  if (validRounds.length < options.rounds) {
    insufficientReasons.push(`valid_rounds_${validRounds.length}_below_target_${options.rounds}`);
  }
  if (sampledTotal < MIN_VALID_SAMPLE_SIZE) {
    insufficientReasons.push(`sampled_total_below_${MIN_VALID_SAMPLE_SIZE}:${sampledTotal}`);
  }

  return {
    key: group.key,
    label: group.label,
    stopOn: group.stopOn,
    tailMs: group.tailMs,
    targetValidRounds: options.rounds,
    maxAttemptsPerGroup: options.maxAttemptsPerGroup,
    attemptsUsed: attempts.length,
    skippedUnhealthyCount: attempts.filter((attempt) => attempt.status === "skipped_unhealthy").length,
    completedCount: attempts.filter((attempt) => attempt.status === "completed").length,
    validRoundsCount: validRounds.length,
    totalValid,
    sampledTotal,
    fixtureInvalidCount,
    fixtureInvalidRatio,
    averageRawDoneRate,
    averageProbeDoneRate,
    averageRawNoTerminalCount,
    averageProbeNoTerminalCount,
    abortErrorCount,
    timeoutCount,
    insufficientEvidence: insufficientReasons.length > 0,
    insufficientReasons,
  };
};

const buildDecision = (groupSummaries) => {
  const byKey = new Map(groupSummaries.map((group) => [group.key, group]));
  const rev1Tail5 = byKey.get("revision1_tail_5s");
  const rev1Tail15 = byKey.get("revision1_tail_15s");
  const persistedTail5 = byKey.get("persisted_tail_5s");

  const preconditionsMet =
    groupSummaries.length === 3 &&
    groupSummaries.every((group) => !group.insufficientEvidence && group.validRoundsCount >= group.targetValidRounds);

  if (!preconditionsMet) {
    return {
      kind: "insufficient_evidence",
      preconditionsMet: false,
      reason: "one_or_more_groups_insufficient_evidence",
      recommendation: "restore backend health and run +2 additional valid rounds for insufficient groups",
    };
  }

  const deltaRaw = Number(rev1Tail15.averageRawDoneRate) - Number(rev1Tail5.averageRawDoneRate);
  const deltaProbe = Number(rev1Tail15.averageProbeDoneRate) - Number(rev1Tail5.averageProbeDoneRate);
  const persistedMeetsFlushConditions =
    persistedTail5.averageRawDoneRate < 0.95 &&
    persistedTail5.averageProbeDoneRate >= 0.99 &&
    persistedTail5.abortErrorCount === 0 &&
    persistedTail5.timeoutCount === 0;

  if (deltaRaw >= RAW_DELTA_THRESHOLD && Math.abs(deltaProbe) <= PROBE_DELTA_MAX) {
    return {
      kind: "timing_or_semantics_primary",
      preconditionsMet: true,
      deltaRaw,
      deltaProbe,
      thresholdRawDelta: RAW_DELTA_THRESHOLD,
      thresholdProbeDeltaMax: PROBE_DELTA_MAX,
      recommendation: "prioritize stop/tail timing and metric semantics alignment before transport-layer fixes",
    };
  }

  if (persistedMeetsFlushConditions) {
    return {
      kind: "proxy_or_flush_fix_required",
      preconditionsMet: true,
      deltaRaw,
      deltaProbe,
      persistedRawDoneRate: persistedTail5.averageRawDoneRate,
      persistedProbeDoneRate: persistedTail5.averageProbeDoneRate,
      persistedAbortErrorCount: persistedTail5.abortErrorCount,
      persistedTimeoutCount: persistedTail5.timeoutCount,
      recommendation: "enter proxy/flush remediation branch",
    };
  }

  return {
    kind: "insufficient_or_mixed_signal",
    preconditionsMet: true,
    deltaRaw,
    deltaProbe,
    thresholdRawDelta: RAW_DELTA_THRESHOLD,
    thresholdProbeDeltaMax: PROBE_DELTA_MAX,
    recommendation: "run +2 valid rounds per group and re-evaluate",
  };
};

const writeAnalysis = async ({ outDir, options, groupSummaries, decision }) => {
  const lines = [];
  lines.push("# Web Probe Tail Matrix");
  lines.push("");
  lines.push(`- generatedAt: ${new Date().toISOString()}`);
  lines.push(`- fixture: ${options.fixture}`);
  lines.push(`- target valid rounds per group: ${options.rounds}`);
  lines.push(`- max attempts per group: ${options.maxAttemptsPerGroup}`);
  lines.push(`- phase mode: ${options.phaseMode}`);
  lines.push(`- retries: ${options.retries}`);
  lines.push("");
  lines.push("## Group Summary");
  lines.push("");
  lines.push("| group | attempts | valid rounds | sampledTotal | validTotal | fixtureInvalid | rawDone | probeDone | abortError | timeout | insufficient |");
  lines.push("|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---|");
  for (const group of groupSummaries) {
    lines.push(
      `| ${group.label} | ${group.attemptsUsed} | ${group.validRoundsCount}/${group.targetValidRounds} | ${group.sampledTotal} | ${group.totalValid} | ${group.fixtureInvalidCount} (${toPct(group.fixtureInvalidRatio)}) | ${toPct(group.averageRawDoneRate)} | ${toPct(group.averageProbeDoneRate)} | ${group.abortErrorCount} | ${group.timeoutCount} | ${group.insufficientEvidence ? group.insufficientReasons.join("; ") : "no"} |`,
    );
  }
  lines.push("");
  lines.push("## Decision");
  lines.push("");
  lines.push(`- kind: ${decision.kind}`);
  lines.push(`- preconditionsMet: ${decision.preconditionsMet ? "yes" : "no"}`);
  if (Number.isFinite(decision.deltaRaw)) lines.push(`- deltaRaw(rev1 tail15 - tail5): ${toPct(decision.deltaRaw)}`);
  if (Number.isFinite(decision.deltaProbe)) lines.push(`- deltaProbe(rev1 tail15 - tail5): ${toPct(decision.deltaProbe)}`);
  lines.push(`- recommendation: ${decision.recommendation}`);
  lines.push("");
  await fs.promises.writeFile(path.join(outDir, "matrix_analysis.md"), lines.join("\n"), "utf8");
};

const main = async () => {
  const options = parseArgs(process.argv.slice(2));
  const fixture = await readJsonSafe(options.fixture);
  if (!Array.isArray(fixture) || fixture.length === 0) {
    throw new Error(`Fixture missing or empty: ${options.fixture}`);
  }
  await fs.promises.mkdir(options.outDir, { recursive: true });

  const groups = groupDefinitions(options);
  const attemptResultsByGroup = {};
  for (const group of groups) {
    attemptResultsByGroup[group.key] = [];
    let validRounds = 0;
    for (let attemptIndex = 1; attemptIndex <= options.maxAttemptsPerGroup; attemptIndex += 1) {
      if (validRounds >= options.rounds) break;
      // eslint-disable-next-line no-await-in-loop
      const attempt = await runAttempt({ group, attemptIndex, options, outDir: options.outDir });
      attemptResultsByGroup[group.key].push(attempt);
      if (attempt.validRound) validRounds += 1;
      const marker =
        attempt.status === "skipped_unhealthy"
          ? "skipped_unhealthy"
          : attempt.validRound
            ? "valid"
            : "invalid";
      console.log(
        `[web-probe-matrix] group=${group.key} attempt=${attemptIndex} status=${attempt.status} marker=${marker} validRounds=${validRounds}/${options.rounds}`,
      );
      if (attemptIndex < options.maxAttemptsPerGroup && validRounds < options.rounds) {
        // eslint-disable-next-line no-await-in-loop
        await sleep(options.sleepMs);
      }
    }
  }

  const groupSummaries = groups.map((group) =>
    summarizeGroup({ group, attempts: attemptResultsByGroup[group.key] || [], options }),
  );
  const decision = buildDecision(groupSummaries);

  const roundsPayload = {
    generatedAt: new Date().toISOString(),
    options,
    fixtureCount: fixture.length,
    groups: groups.map((group) => ({
      key: group.key,
      label: group.label,
      stopOn: group.stopOn,
      tailMs: group.tailMs,
      attempts: attemptResultsByGroup[group.key] || [],
    })),
  };
  const summaryPayload = {
    generatedAt: new Date().toISOString(),
    options,
    fixtureCount: fixture.length,
    groupSummaries,
    decision,
    thresholds: {
      rawDeltaThreshold: RAW_DELTA_THRESHOLD,
      probeDeltaMax: PROBE_DELTA_MAX,
      minValidSampleSize: MIN_VALID_SAMPLE_SIZE,
    },
  };

  await writeJson(path.join(options.outDir, "matrix_rounds.json"), roundsPayload);
  await writeJson(path.join(options.outDir, "matrix_summary.json"), summaryPayload);
  await writeAnalysis({ outDir: options.outDir, options, groupSummaries, decision });

  console.log(`[web-probe-matrix] done outDir=${options.outDir}`);
  console.log(`[web-probe-matrix] decision=${decision.kind}`);
};

main().catch((error) => {
  console.error("[web-probe-matrix] failed:", error);
  process.exit(1);
});
