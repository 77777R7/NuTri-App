#!/usr/bin/env node
/* eslint-disable no-console */

import fs from "node:fs/promises";
import path from "node:path";
import { spawn } from "node:child_process";

import dotenv from "dotenv";

const ROOT_DIR = process.cwd();
dotenv.config({ path: path.join(ROOT_DIR, "backend", ".env") });
dotenv.config({ path: path.join(ROOT_DIR, ".env") });

const args = process.argv.slice(2);
const hasFlag = (flag) => args.includes(`--${flag}`);
const getArg = (flag) => {
  const idx = args.indexOf(`--${flag}`);
  if (idx === -1) return null;
  return args[idx + 1] ?? null;
};

if (hasFlag("help")) {
  console.log(`Usage:
  node scripts/maintainer/run-shadow-watch-curve.mjs [options]

Options:
  --env <name>                 Environment label for artifact path (default: prod)
  --api-base-url <url>         API base URL (default: API_BASE_URL or http://127.0.0.1:3001)
  --out-root <path>            Output root (default: output/release-gates)
  --hours <n>                  Total watch duration in hours (default: 48)
  --interval-minutes <n>       Round interval in minutes (default: 60)
  --rounds <n>                 Override rounds count (default: ceil(hours*60/interval))
  --backend-mode <mode>        Backend mode: managed|external (default: external)
  --backend-port <n>           Backend port used when api-base-url is omitted (default: 3001)
  --manage-backend             Backward-compat alias for --backend-mode managed
  --full-gates                 Include concurrency/bulk/UL gates in each round
  --strict-enforce             Forward MAINTAINER_GATES_SHADOW_REPORTS_ENFORCE=1 to stable runner
  --strict-checks <0|1>        Enforce strict surface/candidate/negative checks into product gate (default: 0)
  --treat-infra-as-inconclusive <0|1>  Treat infra failures as INCONCLUSIVE instead of NO_GO (default: 1)
  --go-threshold <n>           Consecutive GO rounds needed to mark closure readiness (default: 6)
`);
  process.exit(0);
}

const nowTag = new Date().toISOString().replace(/[:.]/g, "-");
const envName = String(getArg("env") || process.env.SHADOW_WATCH_ENV || "prod").trim();
const backendPortRaw = Number(getArg("backend-port") || process.env.SHADOW_WATCH_BACKEND_PORT || 3001);
const backendPort = Number.isFinite(backendPortRaw) && backendPortRaw > 0 ? Math.floor(backendPortRaw) : 3001;
const apiBaseUrl = String(
  getArg("api-base-url")
  || process.env.API_BASE_URL
  || `http://127.0.0.1:${backendPort}`,
).replace(/\/$/, "");
const outRootArg = getArg("out-root") || path.join("output", "release-gates");
const outRoot = path.isAbsolute(outRootArg) ? outRootArg : path.join(ROOT_DIR, outRootArg);
const runDir = path.join(outRoot, envName, nowTag, "shadow-watch");
const roundsDir = path.join(runDir, "rounds");
const curveJsonlPath = path.join(runDir, "go_no_go_curve.jsonl");
const curveJsonPath = path.join(runDir, "go_no_go_curve.json");
const curveMdPath = path.join(runDir, "go_no_go_curve.md");
const statusPath = path.join(runDir, "shadow_watch_status.json");
const manifestPath = path.join(runDir, "shadow_watch_manifest.json");

const hoursRaw = Number(getArg("hours") || process.env.SHADOW_WATCH_HOURS || 48);
const intervalMinutesRaw = Number(getArg("interval-minutes") || process.env.SHADOW_WATCH_INTERVAL_MINUTES || 60);
const roundsRaw = Number(getArg("rounds") || process.env.SHADOW_WATCH_ROUNDS || Number.NaN);
const hours = Number.isFinite(hoursRaw) && hoursRaw > 0 ? hoursRaw : 48;
const intervalMinutes = Number.isFinite(intervalMinutesRaw) && intervalMinutesRaw > 0 ? intervalMinutesRaw : 60;
const intervalMs = Math.floor(intervalMinutes * 60 * 1000);
const totalRounds = Number.isFinite(roundsRaw) && roundsRaw > 0
  ? Math.floor(roundsRaw)
  : Math.max(1, Math.ceil((hours * 60) / intervalMinutes));
const parseBool = (value, fallback = false) => {
  if (value == null) return fallback;
  const normalized = String(value).trim().toLowerCase();
  if (!normalized) return fallback;
  return ["1", "true", "yes", "on"].includes(normalized);
};
const backendModeInput = String(
  getArg("backend-mode")
  || process.env.SHADOW_WATCH_BACKEND_MODE
  || (hasFlag("manage-backend") ? "managed" : "external"),
).trim().toLowerCase();
const backendMode = backendModeInput === "managed" ? "managed" : "external";
const manageBackend = backendMode === "managed";
const fullGates = hasFlag("full-gates");
const strictEnforce = hasFlag("strict-enforce");
const strictChecks = parseBool(getArg("strict-checks") ?? process.env.SHADOW_WATCH_STRICT_CHECKS ?? "0", false);
const treatInfraAsInconclusive = parseBool(
  getArg("treat-infra-as-inconclusive") ?? process.env.SHADOW_WATCH_TREAT_INFRA_AS_INCONCLUSIVE ?? "1",
  true,
);
const goThresholdRaw = Number(getArg("go-threshold") || process.env.SHADOW_WATCH_GO_THRESHOLD || 6);
const goThreshold = Number.isFinite(goThresholdRaw) && goThresholdRaw > 0 ? Math.floor(goThresholdRaw) : 6;
const parsedApiPort = (() => {
  try {
    const parsed = new URL(apiBaseUrl);
    if (parsed.port) {
      const explicitPort = Number(parsed.port);
      return Number.isFinite(explicitPort) ? explicitPort : null;
    }
    if (parsed.protocol === "https:") return 443;
    if (parsed.protocol === "http:") return 80;
  } catch {
    // ignore
  }
  return null;
})();
const watchLockPath = path.join(
  outRoot,
  envName,
  `shadow-watch.${Number.isFinite(parsedApiPort) ? parsedApiPort : backendPort}.lock.json`,
);

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const readJson = async (filePath) => {
  try {
    const raw = await fs.readFile(filePath, "utf8");
    return JSON.parse(raw);
  } catch {
    return null;
  }
};

const isProcessAlive = (pid) => {
  if (!Number.isFinite(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
};

const acquireWatchLock = async () => {
  await fs.mkdir(path.dirname(watchLockPath), { recursive: true });
  const existing = await readJson(watchLockPath);
  if (existing) {
    const existingPid = Number(existing.pid);
    if (isProcessAlive(existingPid)) {
      throw new Error(
        `shadow_watch_lock_held pid=${existingPid} env=${envName} apiBaseUrl=${existing.apiBaseUrl ?? "unknown"}`,
      );
    }
    await fs.rm(watchLockPath, { force: true });
  }
  const payload = {
    pid: process.pid,
    env: envName,
    apiBaseUrl,
    backendMode,
    acquiredAt: new Date().toISOString(),
    runDir,
  };
  await fs.writeFile(watchLockPath, JSON.stringify(payload, null, 2), { encoding: "utf8", flag: "wx" });
  return payload;
};

const releaseWatchLock = async () => {
  const lock = await readJson(watchLockPath);
  if (!lock) return;
  const lockPid = Number(lock.pid);
  if (!Number.isFinite(lockPid) || lockPid === process.pid) {
    await fs.rm(watchLockPath, { force: true });
  }
};

const parseLastNonEmptyLine = (text) => {
  const lines = String(text || "")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
  if (!lines.length) return null;
  return lines[lines.length - 1];
};

const inferInfraFailureReason = ({ runResult, gateReport }) => {
  const stderr = String(runResult?.stderr || "");
  const stdout = String(runResult?.stdout || "");
  const verdict = gateReport?.verdict ?? null;
  const infraReasons = Array.isArray(verdict?.infraReasons) ? verdict.infraReasons : [];
  if (infraReasons.length > 0) return String(infraReasons[0]);
  const reasons = Array.isArray(verdict?.reasons) ? verdict.reasons : [];
  const infraReasonFromReasons = reasons.find((reason) =>
    String(reason).startsWith("preflight_")
    || String(reason).endsWith("_report_missing")
    || String(reason).includes("_timeout_")
    || String(reason).includes("infra_untrusted_"),
  );
  if (infraReasonFromReasons) return String(infraReasonFromReasons);
  const combined = `${stderr}\n${stdout}`.toLowerCase();
  if (combined.includes("preflight failed")) return "preflight_failed";
  if (combined.includes("managed backend health check failed")) return "managed_backend_health_failed";
  if (combined.includes("fetch failed")) return "fetch_failed";
  if (combined.includes("port_in_use")) return "port_in_use";
  if (combined.includes("timeout")) return "timeout";
  return null;
};

const runNode = async (scriptPath, scriptArgs = [], envPatch = {}) => {
  return await new Promise((resolve) => {
    const child = spawn("node", [scriptPath, ...scriptArgs], {
      cwd: ROOT_DIR,
      env: {
        ...process.env,
        ...envPatch,
      },
      stdio: ["ignore", "pipe", "pipe"],
      shell: false,
    });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => {
      stdout += String(chunk);
    });
    child.stderr.on("data", (chunk) => {
      stderr += String(chunk);
    });
    child.on("close", (code) => {
      resolve({
        code: code ?? 1,
        stdout,
        stderr,
      });
    });
    child.on("error", (error) => {
      resolve({
        code: 1,
        stdout,
        stderr: String(error?.message ?? error),
      });
    });
  });
};

const asNumber = (value) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
};

const toIso = (value) => {
  if (!value) return null;
  const ms = Date.parse(String(value));
  if (!Number.isFinite(ms)) return null;
  return new Date(ms).toISOString();
};

const SUMMARY_TECHNICAL_LEAK_PATTERN = /\brbf\b|match score|confidence tier|reason code|verified dataset|reviewed[_\s]?kb|within_typical|below_typical|above_typical/i;

const collectSummaryLeakage = async ({ roundDir, gateReport }) => {
  const candidatePaths = [
    gateReport?.reports?.summaryRenderProbePath,
    path.join(roundDir, "scan_summary_samples.json"),
    path.join(roundDir, "scan_summary_rendered_samples.json"),
  ].filter(Boolean);

  for (const candidate of candidatePaths) {
    try {
      const raw = await fs.readFile(String(candidate), "utf8");
      const parsed = JSON.parse(raw);
      const rows = Array.isArray(parsed?.rows)
        ? parsed.rows
        : Array.isArray(parsed)
          ? parsed
          : [];
      if (rows.length === 0) {
        return {
          observed: true,
          sampleCount: 0,
          leakageCount: 0,
          leakageSamples: [],
          sourcePath: String(candidate),
        };
      }
      const leakageRows = rows.filter((row) => {
        const text = typeof row?.summaryText === "string"
          ? row.summaryText
          : typeof row?.tldr === "string"
            ? row.tldr
            : "";
        return SUMMARY_TECHNICAL_LEAK_PATTERN.test(text);
      });
      return {
        observed: true,
        sampleCount: rows.length,
        leakageCount: leakageRows.length,
        leakageSamples: leakageRows.slice(0, 5),
        sourcePath: String(candidate),
      };
    } catch {
      // Try next candidate path.
    }
  }

  return {
    observed: false,
    sampleCount: 0,
    leakageCount: 0,
    leakageSamples: [],
    sourcePath: null,
  };
};

const formatRatio = (value) => {
  const parsed = asNumber(value);
  if (parsed == null) return "n/a";
  return `${(parsed * 100).toFixed(2)}%`;
};

const buildCurveMarkdown = (payload) => {
  const lines = [
    "# Shadow Go/No-Go Curve",
    "",
    `- env: ${payload.env}`,
    `- apiBaseUrl: ${payload.apiBaseUrl}`,
    `- generatedAt: ${payload.generatedAt}`,
    `- roundsCompleted: ${payload.roundsCompleted}/${payload.totalRounds}`,
    `- goRounds: ${payload.goRounds}`,
    `- noGoRounds: ${payload.noGoRounds}`,
    `- infraInconclusiveRounds: ${payload.infraInconclusiveRounds ?? 0}`,
    `- goRate: ${formatRatio(payload.goRate)}`,
    `- currentGoStreak: ${payload.currentGoStreak ?? 0}/${payload.goThreshold ?? goThreshold}`,
    `- meetsGoThreshold: ${payload.meetsGoThreshold ? "yes" : "no"}`,
    "",
    "| round | startedAt | roundState | go/no-go | stablePass | productGoNoGo | infraInconclusive | infraReason | sourceMismatch | verificationMismatch | conflictsByBarcode | residualHitRate | scoreVisibleRate | regulatoryRichRate | summaryLeakObserved | summaryLeakCount |",
    "|---|---|---|---|---|---|---|---|---:|---:|---:|---:|---:|---:|---:|---:|",
  ];
  for (const row of payload.rounds) {
    lines.push(
      [
        `| ${row.round}`,
        row.startedAt ?? "n/a",
        row.roundState ?? (row.goNoGo ? "GO" : "NO_GO"),
        row.goNoGo ? "GO" : "NO-GO",
        row.checks?.stableRunnerPass ? "PASS" : "FAIL",
        row.productGoNoGo ? "PASS" : "FAIL",
        row.infraInconclusive ? "yes" : "no",
        row.infraFailureReason ?? "n/a",
        row.metrics?.sourceDatasetMismatchCount ?? "n/a",
        row.metrics?.verificationStatusMismatchCount ?? "n/a",
        row.metrics?.conflictsByBarcode ?? "n/a",
        row.metrics?.negativeResidualHitRate ?? "n/a",
        row.metrics?.scoreVisibleRate ?? "n/a",
        row.metrics?.regulatoryRichRateUniqueBarcode ?? "n/a",
        row.metrics?.summaryLeakageObserved ? "yes" : "no",
        row.metrics?.summaryLeakageCount ?? "n/a",
        "|",
      ].join(" | "),
    );
  }
  lines.push("");
  return lines.join("\n");
};

const main = async () => {
  const handleSignal = async () => {
    await releaseWatchLock();
  };
  process.on("SIGINT", handleSignal);
  process.on("SIGTERM", handleSignal);
  try {
    const lockPayload = await acquireWatchLock();
    await fs.mkdir(roundsDir, { recursive: true });
    await fs.writeFile(
      manifestPath,
      JSON.stringify(
        {
          generatedAt: new Date().toISOString(),
          env: envName,
          apiBaseUrl,
          backendMode,
          backendPort: Number.isFinite(parsedApiPort) ? parsedApiPort : backendPort,
          runDir,
          watchLockPath,
          lock: lockPayload,
          totalHours: hours,
          intervalMinutes,
          totalRounds,
          strictEnforce,
          strictChecks,
          treatInfraAsInconclusive,
          goThreshold,
          fullGates,
          mode: {
            KEY_CONTRACT_V2: "shadow",
            WRITE_GUARD_V2: "shadow",
            STAGE0_PROTOCOL_UNIFIED: "1",
            METADATA_READONLY: "1",
          },
        },
        null,
        2,
      ),
      "utf8",
    );

    let baselineScoreVisibleRate = null;
    let baselineRegulatoryRichRate = null;
    const rounds = [];

    for (let round = 1; round <= totalRounds; round += 1) {
      const startedAtMs = Date.now();
      const startedAtIso = new Date(startedAtMs).toISOString();
      const roundTag = startedAtIso.replace(/[:.]/g, "-");
      const roundDir = path.join(roundsDir, `R${String(round).padStart(4, "0")}_${roundTag}`);
      await fs.mkdir(roundDir, { recursive: true });

      const stableArgs = [
        "scripts/maintainer/run-backend-gates-stable.mjs",
        "--out-dir",
        roundDir,
        "--api-base-url",
        apiBaseUrl,
      ];
      if (manageBackend) stableArgs.push("--manage-backend");
      if (!fullGates) {
        stableArgs.push("--skip-concurrency", "--skip-bulk", "--skip-ul");
      }

      const runResult = await runNode(stableArgs[0], stableArgs.slice(1), {
        API_BASE_URL: apiBaseUrl,
        KEY_CONTRACT_V2: "shadow",
        WRITE_GUARD_V2: "shadow",
        STAGE0_PROTOCOL_UNIFIED: "1",
        METADATA_READONLY: "1",
        MAINTAINER_GATES_SHADOW_REPORTS_ENFORCE: strictEnforce ? "1" : "0",
      });

      const finishedAtMs = Date.now();
      const gateReport = await readJson(path.join(roundDir, "gate_full_report.json"));
      const verdict = gateReport?.verdict ?? null;
      const verdictPass = verdict?.pass === true;
      const surface = gateReport?.reports?.surfaceConsistencyReport ?? null;
      const candidates = gateReport?.reports?.candidatesQualityReport ?? null;
      const negative = gateReport?.reports?.negativeCacheResidualReport ?? null;
      const mobileObserved = gateReport?.mobileRichnessGate?.observed ?? null;

      const sourceDatasetMismatchCount = asNumber(surface?.sourceDatasetMismatchCount);
      const verificationStatusMismatchCount = asNumber(surface?.verificationStatusMismatchCount);
      const ingredientCountContradictionCount = asNumber(surface?.ingredientCountContradictionCount);
      const doseCountContradictionCount = asNumber(surface?.doseCountContradictionCount);
      const conflictsByBarcode = asNumber(candidates?.conflictsByBarcode);
      const negativeResidualHitRate = asNumber(negative?.residualHitRate);
      const scoreVisibleRate = asNumber(mobileObserved?.scoreVisibleRate);
      const regulatoryRichRateUniqueBarcode = asNumber(
        mobileObserved?.regulatoryRichRateUniqueBarcode
        ?? mobileObserved?.regulatoryRichRate_uniqueBarcode,
      );
      const summaryLeakage = await collectSummaryLeakage({ roundDir, gateReport });

      if (baselineScoreVisibleRate == null && scoreVisibleRate != null) {
        baselineScoreVisibleRate = scoreVisibleRate;
      }
      if (baselineRegulatoryRichRate == null && regulatoryRichRateUniqueBarcode != null) {
        baselineRegulatoryRichRate = regulatoryRichRateUniqueBarcode;
      }

      const scoreVisibleRateNoRegression = baselineScoreVisibleRate == null || scoreVisibleRate == null
        ? true
        : scoreVisibleRate + 1e-9 >= baselineScoreVisibleRate;
      const regulatoryRichRateNoRegression = baselineRegulatoryRichRate == null || regulatoryRichRateUniqueBarcode == null
        ? true
        : regulatoryRichRateUniqueBarcode + 1e-9 >= baselineRegulatoryRichRate;

      const strictChecksPass = (
        sourceDatasetMismatchCount === 0
        && verificationStatusMismatchCount === 0
        && ingredientCountContradictionCount === 0
        && doseCountContradictionCount === 0
        && conflictsByBarcode === 0
        && negativeResidualHitRate === 0
        && scoreVisibleRateNoRegression
        && regulatoryRichRateNoRegression
      );

      const checks = {
        stableRunnerPass: runResult.code === 0 && verdictPass,
        strictChecksApplied: strictChecks,
        strictChecksPass,
        sourceDatasetMismatchZero: sourceDatasetMismatchCount === 0,
        verificationStatusMismatchZero: verificationStatusMismatchCount === 0,
        ingredientCountContradictionZero: ingredientCountContradictionCount === 0,
        doseCountContradictionZero: doseCountContradictionCount === 0,
        conflictsByBarcodeZero: conflictsByBarcode === 0,
        negativeResidualHitRateZero: negativeResidualHitRate === 0,
        scoreVisibleRateNoRegression,
        regulatoryRichRateNoRegression,
        summaryLeakageObserved: summaryLeakage.observed,
        summaryLeakagePass: summaryLeakage.leakageCount === 0,
      };
      if (summaryLeakage.observed && summaryLeakage.leakageCount > 0) {
        console.warn(
          `[shadow-watch] summary leakage detected round=${round} count=${summaryLeakage.leakageCount} source=${summaryLeakage.sourcePath ?? "unknown"}`,
        );
      }

      const verdictLayer = verdict?.layer ?? {};
      let productRegression =
        verdictLayer?.productRegression === true
        || verdict?.productRegression === true
        || verdict?.classification === "product_regression"
        || verdict?.classification === "mixed";
      let infraInconclusive =
        verdictLayer?.infraInconclusive === true
        || verdict?.infraInconclusive === true
        || verdict?.classification === "infra_inconclusive";
      const infraFailureReason =
        inferInfraFailureReason({ runResult, gateReport })
        ?? (Array.isArray(verdict?.infraReasons) && verdict.infraReasons.length > 0
          ? String(verdict.infraReasons[0])
          : null);

      if (!gateReport && runResult.code !== 0) {
        if (treatInfraAsInconclusive && infraFailureReason) {
          infraInconclusive = true;
          productRegression = false;
        } else {
          productRegression = true;
        }
      }

      const productGoNoGo = Boolean(
        verdictPass
        && !productRegression
        && (!strictChecks || strictChecksPass),
      );
      const roundState =
        infraInconclusive && !productRegression
          ? "INCONCLUSIVE"
          : productGoNoGo
            ? "GO"
            : "NO_GO";
      const goNoGo = roundState === "GO";

      const row = {
        round,
        startedAt: startedAtIso,
        finishedAt: new Date(finishedAtMs).toISOString(),
        durationMs: finishedAtMs - startedAtMs,
        stableExitCode: runResult.code,
        gateReportPath: path.join(roundDir, "gate_full_report.json"),
        stableStdoutTail: String(runResult.stdout || "").split(/\r?\n/).slice(-20),
        stableStderrTail: String(runResult.stderr || "").split(/\r?\n/).slice(-20),
        stableStdoutLastLine: parseLastNonEmptyLine(runResult.stdout),
        stableStderrLastLine: parseLastNonEmptyLine(runResult.stderr),
        checks,
        roundState,
        productGoNoGo,
        infraInconclusive,
        infraFailureReason,
        goNoGo,
        metrics: {
          sourceDatasetMismatchCount,
          verificationStatusMismatchCount,
          ingredientCountContradictionCount,
          doseCountContradictionCount,
          conflictsByBarcode,
          negativeResidualHitRate,
          scoreVisibleRate,
          regulatoryRichRateUniqueBarcode,
          summaryLeakageObserved: summaryLeakage.observed,
          summaryLeakageSampleCount: summaryLeakage.sampleCount,
          summaryLeakageCount: summaryLeakage.leakageCount,
          summaryLeakageSourcePath: summaryLeakage.sourcePath,
        },
        verdict,
        summaryLeakage,
      };
      rounds.push(row);
      await fs.appendFile(curveJsonlPath, `${JSON.stringify(row)}\n`, "utf8");

      const goRounds = rounds.filter((item) => item.roundState === "GO").length;
      const noGoRounds = rounds.filter((item) => item.roundState === "NO_GO").length;
      const infraInconclusiveRounds = rounds.filter((item) => item.roundState === "INCONCLUSIVE").length;
      let currentGoStreak = 0;
      for (let i = rounds.length - 1; i >= 0; i -= 1) {
        if (rounds[i].roundState !== "GO") break;
        currentGoStreak += 1;
      }
      let runningGo = 0;
      let maxGoStreak = 0;
      for (const item of rounds) {
        if (item.roundState === "GO") {
          runningGo += 1;
          if (runningGo > maxGoStreak) maxGoStreak = runningGo;
        } else {
          runningGo = 0;
        }
      }
      const meetsGoThreshold = currentGoStreak >= goThreshold;

      const curve = {
        generatedAt: new Date().toISOString(),
        env: envName,
        apiBaseUrl,
        backendMode,
        runDir,
        totalRounds,
        roundsCompleted: rounds.length,
        goRounds,
        noGoRounds,
        infraInconclusiveRounds,
        goRate: rounds.length > 0 ? goRounds / rounds.length : 0,
        goThreshold,
        currentGoStreak,
        maxGoStreak,
        meetsGoThreshold,
        baseline: {
          scoreVisibleRate: baselineScoreVisibleRate,
          regulatoryRichRateUniqueBarcode: baselineRegulatoryRichRate,
        },
        rounds,
      };

      await fs.writeFile(curveJsonPath, JSON.stringify(curve, null, 2), "utf8");
      await fs.writeFile(curveMdPath, `${buildCurveMarkdown(curve)}\n`, "utf8");
      await fs.writeFile(
        statusPath,
        JSON.stringify(
          {
            generatedAt: new Date().toISOString(),
            env: envName,
            runDir,
            currentRound: round,
            totalRounds,
            latestRoundPath: roundDir,
            latestRoundState: roundState,
            latestGoNoGo: goNoGo,
            latestProductGoNoGo: productGoNoGo,
            latestInfraInconclusive: infraInconclusive,
            latestInfraFailureReason: infraFailureReason,
            latestChecks: checks,
            latestMetrics: row.metrics,
            latestGateVerdictPass: verdictPass,
            currentGoStreak,
            meetsGoThreshold,
          },
          null,
          2,
        ),
        "utf8",
      );

      console.log(
        `[shadow-watch] round ${round}/${totalRounds} roundState=${roundState} goNoGo=${goNoGo ? "GO" : "NO-GO"} exit=${runResult.code} out=${roundDir}`,
      );

      if (round >= totalRounds) break;
      const elapsedMs = Date.now() - startedAtMs;
      const waitMs = Math.max(0, intervalMs - elapsedMs);
      if (waitMs > 0) {
        await sleep(waitMs);
      }
    }

    console.log(`[shadow-watch] completed runDir=${runDir}`);
  } finally {
    process.off("SIGINT", handleSignal);
    process.off("SIGTERM", handleSignal);
    await releaseWatchLock();
  }
};

main().catch((error) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error("[shadow-watch] failed", message);
  process.exit(1);
});
