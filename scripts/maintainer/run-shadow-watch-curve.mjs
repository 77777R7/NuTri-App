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
  --manage-backend             Let stable runner start/stop backend each round
  --full-gates                 Include concurrency/bulk/UL gates in each round
  --strict-enforce             Forward MAINTAINER_GATES_SHADOW_REPORTS_ENFORCE=1 to stable runner
`);
  process.exit(0);
}

const nowTag = new Date().toISOString().replace(/[:.]/g, "-");
const envName = String(getArg("env") || process.env.SHADOW_WATCH_ENV || "prod").trim();
const apiBaseUrl = String(getArg("api-base-url") || process.env.API_BASE_URL || "http://127.0.0.1:3001").replace(/\/$/, "");
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
const manageBackend = hasFlag("manage-backend");
const fullGates = hasFlag("full-gates");
const strictEnforce = hasFlag("strict-enforce");

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const readJson = async (filePath) => {
  try {
    const raw = await fs.readFile(filePath, "utf8");
    return JSON.parse(raw);
  } catch {
    return null;
  }
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
    `- goRate: ${formatRatio(payload.goRate)}`,
    "",
    "| round | startedAt | goNoGo | stablePass | sourceMismatch | verificationMismatch | conflictsByBarcode | residualHitRate | scoreVisibleRate | regulatoryRichRate |",
    "|---|---|---|---|---:|---:|---:|---:|---:|---:|",
  ];
  for (const row of payload.rounds) {
    lines.push(
      [
        `| ${row.round}`,
        row.startedAt ?? "n/a",
        row.goNoGo ? "GO" : "NO-GO",
        row.checks?.stableRunnerPass ? "PASS" : "FAIL",
        row.metrics?.sourceDatasetMismatchCount ?? "n/a",
        row.metrics?.verificationStatusMismatchCount ?? "n/a",
        row.metrics?.conflictsByBarcode ?? "n/a",
        row.metrics?.negativeResidualHitRate ?? "n/a",
        row.metrics?.scoreVisibleRate ?? "n/a",
        row.metrics?.regulatoryRichRateUniqueBarcode ?? "n/a",
        "|",
      ].join(" | "),
    );
  }
  lines.push("");
  return lines.join("\n");
};

const main = async () => {
  await fs.mkdir(roundsDir, { recursive: true });
  await fs.writeFile(
    manifestPath,
    JSON.stringify(
      {
        generatedAt: new Date().toISOString(),
        env: envName,
        apiBaseUrl,
        runDir,
        totalHours: hours,
        intervalMinutes,
        totalRounds,
        strictEnforce,
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
    const verdictPass = gateReport?.verdict?.pass === true;
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

    const checks = {
      stableRunnerPass: runResult.code === 0 && verdictPass,
      sourceDatasetMismatchZero: sourceDatasetMismatchCount === 0,
      verificationStatusMismatchZero: verificationStatusMismatchCount === 0,
      ingredientCountContradictionZero: ingredientCountContradictionCount === 0,
      doseCountContradictionZero: doseCountContradictionCount === 0,
      conflictsByBarcodeZero: conflictsByBarcode === 0,
      negativeResidualHitRateZero: negativeResidualHitRate === 0,
      scoreVisibleRateNoRegression,
      regulatoryRichRateNoRegression,
    };
    const goNoGo = Object.values(checks).every((value) => value === true);

    const row = {
      round,
      startedAt: startedAtIso,
      finishedAt: new Date(finishedAtMs).toISOString(),
      durationMs: finishedAtMs - startedAtMs,
      stableExitCode: runResult.code,
      gateReportPath: path.join(roundDir, "gate_full_report.json"),
      stableStdoutTail: String(runResult.stdout || "").split(/\r?\n/).slice(-20),
      stableStderrTail: String(runResult.stderr || "").split(/\r?\n/).slice(-20),
      checks,
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
      },
      verdict: gateReport?.verdict ?? null,
    };
    rounds.push(row);
    await fs.appendFile(curveJsonlPath, `${JSON.stringify(row)}\n`, "utf8");

    const goRounds = rounds.filter((item) => item.goNoGo).length;
    const noGoRounds = rounds.length - goRounds;
    const curve = {
      generatedAt: new Date().toISOString(),
      env: envName,
      apiBaseUrl,
      runDir,
      totalRounds,
      roundsCompleted: rounds.length,
      goRounds,
      noGoRounds,
      goRate: rounds.length > 0 ? goRounds / rounds.length : 0,
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
          latestGoNoGo: goNoGo,
          latestChecks: checks,
          latestMetrics: row.metrics,
          latestGateVerdictPass: verdictPass,
        },
        null,
        2,
      ),
      "utf8",
    );

    console.log(
      `[shadow-watch] round ${round}/${totalRounds} goNoGo=${goNoGo ? "GO" : "NO-GO"} exit=${runResult.code} out=${roundDir}`,
    );

    if (round >= totalRounds) break;
    const elapsedMs = Date.now() - startedAtMs;
    const waitMs = Math.max(0, intervalMs - elapsedMs);
    if (waitMs > 0) {
      await sleep(waitMs);
    }
  }

  console.log(`[shadow-watch] completed runDir=${runDir}`);
};

main().catch((error) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error("[shadow-watch] failed", message);
  process.exit(1);
});
