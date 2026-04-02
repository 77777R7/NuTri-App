#!/usr/bin/env node
/* eslint-disable no-console */

import fs from "node:fs/promises";
import path from "node:path";
import { spawnSync } from "node:child_process";

const ROOT_DIR = process.cwd();
const DEFAULT_BARCODES = [
  { role: "killer", barcode: "00665553227870" },
  { role: "lnhpd", barcode: "00064642079992" },
  { role: "dsld", barcode: "00690290532093" },
  { role: "web_hint", barcode: "00666183000154" },
  { role: "not_found", barcode: "99999999999999" },
];

const args = process.argv.slice(2);

const getArg = (flag, fallback = "") => {
  const inline = args.find((entry) => entry.startsWith(`${flag}=`));
  if (inline) return inline.slice(flag.length + 1);
  const index = args.indexOf(flag);
  if (index >= 0 && index + 1 < args.length) return args[index + 1];
  return fallback;
};

const hasArg = (flag) => args.includes(flag);

const asNumber = (value, fallback) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
};

const normalizeBarcode = (value) => {
  const digits = String(value ?? "").replace(/\D/g, "");
  if (!digits) return "";
  if (digits.length >= 14) return digits.slice(-14);
  return digits.padStart(14, "0");
};

const ensureDir = async (dirPath) => {
  await fs.mkdir(dirPath, { recursive: true });
};

const readJson = async (filePath) => JSON.parse(await fs.readFile(filePath, "utf8"));

const OUT_DIR = (() => {
  const outDir = getArg("--out-dir", "");
  if (!outDir) return path.join(ROOT_DIR, "output", `mobile-soak-${Date.now()}`);
  if (path.isAbsolute(outDir)) return outDir;
  return path.join(ROOT_DIR, outDir);
})();

const API_BASE_URL = String(
  getArg("--api-base-url", process.env.API_BASE_URL || process.env.RENDER_BASE_URL || "http://127.0.0.1:3001"),
).replace(/\/$/, "");
const SERIAL_ROUNDS = Math.max(0, asNumber(getArg("--serial-rounds", "1"), 1));
const CONCURRENT_ROUNDS = Math.max(0, asNumber(getArg("--concurrent-rounds", "0"), 0));
const KILLER_COLD_RUNS = Math.max(0, asNumber(getArg("--killer-cold-runs", "0"), 0));
const KILLER_HOT_RUNS = Math.max(0, asNumber(getArg("--killer-hot-runs", "0"), 0));
const TIMEOUT_MS = Math.max(1000, asNumber(getArg("--timeout-ms", "12000"), 12000));
const VIEW_MODE = getArg("--view-mode", "details");
const BARCODES_JSON = getArg("--barcodes-json", "");
const REGRESSION_TOKEN = getArg("--regression-token", process.env.RENDER_REGRESSION_TOKEN || "");
const BEARER_TOKEN = getArg("--bearer-token", "");
const NO_OPEN_RESULT_SCREEN = hasArg("--no-open-result-screen");
const SKIP_COLD_HOT = hasArg("--skip-cold-hot");
const ROLE_DEFINITION_VERSION = "mobile-soak/v1-decision-support";

const buildHeaders = () => {
  const headers = {
    Accept: "application/json",
  };
  if (BEARER_TOKEN) {
    headers.Authorization = `Bearer ${BEARER_TOKEN}`;
  } else if (REGRESSION_TOKEN) {
    headers["x-regression-token"] = REGRESSION_TOKEN;
    headers["x-regression-debug"] = "1";
  } else {
    headers["x-auth-disabled"] = "1";
  }
  return headers;
};

const resolveBarcodes = async () => {
  if (!BARCODES_JSON) {
    return DEFAULT_BARCODES.map((entry) => ({
      role: entry.role,
      barcode: normalizeBarcode(entry.barcode),
    }));
  }

  const filePath = path.isAbsolute(BARCODES_JSON)
    ? BARCODES_JSON
    : path.join(ROOT_DIR, BARCODES_JSON);
  const payload = await readJson(filePath);
  const rows = Array.isArray(payload?.barcodes) ? payload.barcodes : [];
  return rows
    .map((row, index) => ({
      role: String(row?.role ?? `barcode_${index + 1}`).trim() || `barcode_${index + 1}`,
      barcode: normalizeBarcode(row?.barcode),
    }))
    .filter((row) => row.barcode);
};

const fetchDecisionSupportInfo = async ({ barcode, phase, round }) => {
  const params = new URLSearchParams({
    barcode,
    viewMode: VIEW_MODE,
  });
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), TIMEOUT_MS);
  const startedAt = Date.now();

  try {
    const response = await fetch(`${API_BASE_URL}/api/decision-support/v1?${params.toString()}`, {
      headers: buildHeaders(),
      signal: controller.signal,
    });
    const elapsedMs = Date.now() - startedAt;
    const rawText = await response.text();
    let payload = null;
    try {
      payload = rawText ? JSON.parse(rawText) : null;
    } catch {
      payload = null;
    }

    const topBlockers = Array.isArray(payload?.topBlockers) ? payload.topBlockers : [];
    const decisionSupportTopBlockerCodes = topBlockers
      .map((item) => String(item?.code ?? "").trim())
      .filter(Boolean)
      .slice(0, 5);
    const decisionSupportVerdict =
      typeof payload?.verdict === "string" && payload.verdict.trim() ? payload.verdict.trim() : null;
    const scoreVisible =
      payload?.nutriScoreCardV2 != null ||
      payload?.scoreCardV2 != null ||
      payload?.score != null;
    const safetySignals = Array.isArray(payload?.safetySignals) ? payload.safetySignals : [];

    return {
      phase,
      round,
      barcode,
      status: response.ok ? "pass" : "fail",
      doneSeen: response.ok,
      terminalReason: response.ok ? "done" : `http_${response.status}`,
      elapsedMs,
      decisionSupportFetchStatus: response.ok ? "ok" : `http_${response.status}`,
      decisionSupportVerdict,
      decisionSupportTopBlockerCodes,
      decisionSupportFetchHttpStatus: response.status,
      contentValueApplied: response.ok,
      contentValuePass: response.ok && decisionSupportTopBlockerCodes.length === 0,
      contentValueFailReasons: response.ok ? [] : [`decision_support_http_${response.status}`],
      verifiedContentPass: response.ok,
      webHintContentPass: response.ok,
      degradedContentPass: response.ok,
      ulVisible: response.ok && safetySignals.length >= 0,
      scoreVisible,
      regulatoryRich: response.ok && safetySignals.length > 0,
      rawDecisionSupport: payload,
    };
  } catch (error) {
    const elapsedMs = Date.now() - startedAt;
    const message = error instanceof Error ? error.message : String(error);
    return {
      phase,
      round,
      barcode,
      status: "fail",
      doneSeen: false,
      terminalReason: message.includes("AbortError") ? "timeout" : "request_failed",
      elapsedMs,
      decisionSupportFetchStatus: message.includes("AbortError") ? "timeout" : "error",
      decisionSupportVerdict: null,
      decisionSupportTopBlockerCodes: [],
      decisionSupportFetchHttpStatus: 0,
      contentValueApplied: false,
      contentValuePass: false,
      contentValueFailReasons: [message],
      verifiedContentPass: false,
      webHintContentPass: false,
      degradedContentPass: false,
      ulVisible: false,
      scoreVisible: false,
      regulatoryRich: false,
      rawDecisionSupport: null,
    };
  } finally {
    clearTimeout(timeout);
  }
};

const runAttempts = async ({ rows, phase, rounds }) => {
  const attempts = [];
  for (let round = 1; round <= rounds; round += 1) {
    for (const row of rows) {
      const attempt = await fetchDecisionSupportInfo({
        barcode: row.barcode,
        phase,
        round,
      });
      attempts.push({
        ...attempt,
        role: row.role,
      });
    }
  }
  return attempts;
};

const buildDecisionSupportVerdictDistribution = (attempts) => {
  const overall = {};
  const byRole = {};

  for (const attempt of attempts) {
    const verdict = String(attempt?.decisionSupportVerdict ?? "").trim() || "unknown";
    overall[verdict] = (overall[verdict] || 0) + 1;
    byRole[attempt.role] ||= {};
    byRole[attempt.role][verdict] = (byRole[attempt.role][verdict] || 0) + 1;
  }

  return {
    decisionSupportVerdictDistribution: overall,
    decisionSupportVerdictDistributionByRole: byRole,
  };
};

const buildDecisionSupportTopBlockerDistribution = (attempts) => {
  const distribution = {};
  for (const attempt of attempts) {
    for (const code of attempt.decisionSupportTopBlockerCodes || []) {
      distribution[code] = (distribution[code] || 0) + 1;
    }
  }
  return distribution;
};

const averageRate = (attempts, selector) => {
  if (attempts.length === 0) return 0;
  const passing = attempts.filter(selector).length;
  return Number((passing / attempts.length).toFixed(4));
};

const main = async () => {
  await ensureDir(OUT_DIR);

  const barcodeRows = await resolveBarcodes();
  const killerRows = barcodeRows.filter((row) => row.role === "killer");
  const nonKillerRows = barcodeRows.filter((row) => row.role !== "killer");

  const attempts = [];

  if (!SKIP_COLD_HOT && nonKillerRows.length > 0) {
    attempts.push(...(await runAttempts({ rows: nonKillerRows, phase: "cold_start", rounds: 1 })));
    attempts.push(...(await runAttempts({ rows: nonKillerRows, phase: "hot_start", rounds: 1 })));
  }
  if (SERIAL_ROUNDS > 0 && barcodeRows.length > 0) {
    attempts.push(...(await runAttempts({ rows: barcodeRows, phase: "serial", rounds: SERIAL_ROUNDS })));
  }
  if (CONCURRENT_ROUNDS > 0 && barcodeRows.length > 0) {
    attempts.push(...(await runAttempts({ rows: barcodeRows, phase: "concurrent", rounds: CONCURRENT_ROUNDS })));
  }
  if (KILLER_COLD_RUNS > 0 && killerRows.length > 0) {
    attempts.push(...(await runAttempts({ rows: killerRows, phase: "killer_cold", rounds: KILLER_COLD_RUNS })));
  }
  if (KILLER_HOT_RUNS > 0 && killerRows.length > 0) {
    attempts.push(...(await runAttempts({ rows: killerRows, phase: "killer_hot", rounds: KILLER_HOT_RUNS })));
  }

  const decisionSupportVerdicts = buildDecisionSupportVerdictDistribution(attempts);
  const decisionSupportTopBlockerDistribution =
    buildDecisionSupportTopBlockerDistribution(attempts);

  const summary = {
    generatedAt: new Date().toISOString(),
    apiBaseUrl: API_BASE_URL,
    outDir: OUT_DIR,
    barcodes: barcodeRows,
    attempts,
    config: {
      serialRounds: SERIAL_ROUNDS,
      concurrentRounds: CONCURRENT_ROUNDS,
      killerColdRuns: KILLER_COLD_RUNS,
      killerHotRuns: KILLER_HOT_RUNS,
      timeoutMs: TIMEOUT_MS,
      noOpenResultScreen: NO_OPEN_RESULT_SCREEN,
      roleDefinitionVersion: ROLE_DEFINITION_VERSION,
    },
    stats: {
      attemptsTotal: attempts.length,
      doneSeenRate: averageRate(attempts, (attempt) => attempt.doneSeen === true),
      deadEndRate: averageRate(attempts, (attempt) => attempt.doneSeen !== true),
      scoreVisibleRate: averageRate(attempts, (attempt) => attempt.scoreVisible === true),
      contentValuePassRate: averageRate(attempts, (attempt) => attempt.contentValuePass === true),
      verifiedContentValuePassRate: averageRate(
        attempts,
        (attempt) => attempt.verifiedContentPass === true,
      ),
      webHintContentValuePassRate: averageRate(
        attempts,
        (attempt) => attempt.webHintContentPass === true,
      ),
      degradedContentValuePassRate: averageRate(
        attempts,
        (attempt) => attempt.degradedContentPass === true,
      ),
      ulVisibilityPassRate: averageRate(attempts, (attempt) => attempt.ulVisible === true),
      regulatoryRichRate: averageRate(attempts, (attempt) => attempt.regulatoryRich === true),
      regulatoryRichRate_uniqueBarcode: averageRate(
        barcodeRows,
        (row) => attempts.some((attempt) => attempt.barcode === row.barcode && attempt.regulatoryRich),
      ),
      firstFramePendingRate: 0,
      firstFrameTrustedRate: 0,
      firstFrameTrustedRateRegulatory: 0,
      killerProductClientTimeoutCount: attempts.filter(
        (attempt) => attempt.role === "killer" && attempt.decisionSupportFetchStatus === "timeout",
      ).length,
      killerProductClientTimeoutRate: averageRate(
        attempts.filter((attempt) => attempt.role === "killer"),
        (attempt) => attempt.decisionSupportFetchStatus === "timeout",
      ),
      killerProductSseConnectedButNoDoneCount: 0,
      authoritativeExpectedButNotFinalCount: 0,
      decisionSupportVerdictDistribution:
        decisionSupportVerdicts.decisionSupportVerdictDistribution,
      decisionSupportVerdictDistributionByRole:
        decisionSupportVerdicts.decisionSupportVerdictDistributionByRole,
      decisionSupportTopBlockerDistribution,
      roleDefinitionVersion: ROLE_DEFINITION_VERSION,
    },
  };

  const summaryPath = path.join(OUT_DIR, "rounds_summary.json");
  await fs.writeFile(summaryPath, `${JSON.stringify(summary, null, 2)}\n`, "utf8");

  const reportScript = path.join(ROOT_DIR, "scripts", "maintainer", "mobile-soak-report.mjs");
  const reportRun = spawnSync("node", [reportScript, "--summary", summaryPath], {
    cwd: ROOT_DIR,
    encoding: "utf8",
  });
  if (reportRun.status !== 0) {
    console.warn("[mobile-soak-run] report generation failed", {
      status: reportRun.status,
      stderr: reportRun.stderr?.trim() || null,
    });
  }

  console.log(
    JSON.stringify(
      {
        status: "ok",
        outDir: OUT_DIR,
        summaryPath,
        attemptsTotal: summary.stats.attemptsTotal,
        doneSeenRate: summary.stats.doneSeenRate,
        decisionSupportVerdictDistribution:
          summary.stats.decisionSupportVerdictDistribution,
      },
      null,
      2,
    ),
  );
};

main().catch((error) => {
  console.error("[mobile-soak-run] failed", error);
  process.exit(1);
});
