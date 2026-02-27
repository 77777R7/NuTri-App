#!/usr/bin/env node
/* eslint-disable no-console */

import fs from "node:fs/promises";
import path from "node:path";

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
  node scripts/maintainer/shadow-realtime-board.mjs --run-dir <shadow-watch-dir> [options]

Options:
  --run-dir <path>            Shadow watch run directory (required)
  --out-file <path>           Markdown output file (default: <run-dir>/realtime_summary_board.md)
  --json-out <path>           JSON output file (default: <run-dir>/realtime_summary_board.json)
  --round-window <n>          Max recent rounds shown in table (default: 12)
  --watch                     Enable periodic refresh loop
  --interval-minutes <n>      Refresh interval in minutes in watch mode (default: 60)
`);
  process.exit(0);
}

const runDirArg = getArg("run-dir");
if (!runDirArg) {
  console.error("[shadow-realtime-board] missing --run-dir");
  process.exit(1);
}

const runDir = path.isAbsolute(runDirArg) ? runDirArg : path.join(ROOT_DIR, runDirArg);
const outFileArg = getArg("out-file");
const outFilePath = outFileArg
  ? (path.isAbsolute(outFileArg) ? outFileArg : path.join(ROOT_DIR, outFileArg))
  : path.join(runDir, "realtime_summary_board.md");
const jsonOutArg = getArg("json-out");
const jsonOutPath = jsonOutArg
  ? (path.isAbsolute(jsonOutArg) ? jsonOutArg : path.join(ROOT_DIR, jsonOutArg))
  : path.join(runDir, "realtime_summary_board.json");
const roundWindowRaw = Number(getArg("round-window") || process.env.SHADOW_BOARD_ROUND_WINDOW || 12);
const roundWindow = Number.isFinite(roundWindowRaw) && roundWindowRaw > 0 ? Math.floor(roundWindowRaw) : 12;
const watchMode = hasFlag("watch");
const intervalMinutesRaw = Number(getArg("interval-minutes") || process.env.SHADOW_BOARD_INTERVAL_MINUTES || 60);
const intervalMinutes = Number.isFinite(intervalMinutesRaw) && intervalMinutesRaw > 0 ? intervalMinutesRaw : 60;
const intervalMs = Math.floor(intervalMinutes * 60 * 1000);

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const readJson = async (filePath) => {
  try {
    const raw = await fs.readFile(filePath, "utf8");
    return JSON.parse(raw);
  } catch {
    return null;
  }
};

const normalizeDigits = (value) => String(value ?? "").replace(/\D/g, "").trim();

const unique = (values) => Array.from(new Set(values.filter(Boolean)));

const pickBarcode = (value) => {
  if (!value || typeof value !== "object") return null;
  const row = value;
  const candidates = [
    row.barcode,
    row.barcodeGtin14,
    row.barcode_gtin14,
    row.expectedBarcode,
    row.expected_barcode,
    row.sampleBarcode,
    row.sample_barcode,
  ];
  for (const candidate of candidates) {
    const digits = normalizeDigits(candidate);
    if (!digits) continue;
    if (digits.length >= 14) return digits.slice(-14);
    return digits.padStart(14, "0");
  }
  return null;
};

const collectRoundAnomalies = (gateReport) => {
  const surface = gateReport?.reports?.surfaceConsistencyReport ?? null;
  const candidates = gateReport?.reports?.candidatesQualityReport ?? null;
  const negative = gateReport?.reports?.negativeCacheResidualReport ?? null;
  const sourceTypeFinalViolations = Array.isArray(gateReport?.sourceTypeFinalViolations)
    ? gateReport.sourceTypeFinalViolations
    : [];
  const verdictReasons = Array.isArray(gateReport?.verdict?.reasons)
    ? gateReport.verdict.reasons.map((item) => String(item))
    : [];

  const mismatchRows = Array.isArray(surface?.mismatchRows) ? surface.mismatchRows : [];
  const surfaceMismatchBarcodes = unique(
    mismatchRows
      .filter((row) => row?.mismatch?.sourceDatasetMismatch || row?.mismatch?.verificationStatusMismatch)
      .map((row) => normalizeDigits(row?.barcode))
      .filter(Boolean),
  );
  const doseContradictionBarcodes = unique(
    mismatchRows
      .filter((row) => row?.mismatch?.doseCountContradiction)
      .map((row) => normalizeDigits(row?.barcode))
      .filter(Boolean),
  );

  const doseBucketBarcodes = unique(
    Object.values(surface?.doseCountBucketBarcodes ?? {})
      .flatMap((list) => (Array.isArray(list) ? list : []))
      .map((value) => normalizeDigits(value))
      .filter(Boolean),
  );

  const conflictBarcodes = unique(
    (Array.isArray(candidates?.conflictBarcodes) ? candidates.conflictBarcodes : [])
      .map((row) => normalizeDigits(row?.barcodeGtin14 ?? row?.barcode_gtin14 ?? row?.barcode))
      .filter(Boolean),
  );

  const negativeResidualBarcodes = unique(
    (Array.isArray(negative?.sampleResidualRows) ? negative.sampleResidualRows : [])
      .map((row) => normalizeDigits(row?.barcodeGtin14 ?? row?.barcode_gtin14 ?? row?.barcode))
      .filter(Boolean),
  );

  const sourceTypeViolationBarcodes = unique(
    sourceTypeFinalViolations
      .map((row) => pickBarcode(row))
      .filter(Boolean),
  );

  const anomalyBarcodeSet = new Set([
    ...surfaceMismatchBarcodes,
    ...doseContradictionBarcodes,
    ...doseBucketBarcodes,
    ...conflictBarcodes,
    ...negativeResidualBarcodes,
    ...sourceTypeViolationBarcodes,
  ]);

  return {
    counts: {
      sourceDatasetMismatchCount: Number(surface?.sourceDatasetMismatchCount ?? 0),
      verificationStatusMismatchCount: Number(surface?.verificationStatusMismatchCount ?? 0),
      doseCountContradictionCount: Number(surface?.doseCountContradictionCount ?? 0),
      ingredientCountContradictionCount: Number(surface?.ingredientCountContradictionCount ?? 0),
      conflictsByBarcode: Number(candidates?.conflictsByBarcode ?? 0),
      negativeResidualCount: Number(negative?.residualCount ?? 0),
      sourceTypeFinalViolationCount: sourceTypeFinalViolations.length,
      anomalyBarcodeCount: anomalyBarcodeSet.size,
    },
    barcodes: {
      surfaceMismatchBarcodes,
      doseContradictionBarcodes,
      doseBucketBarcodes,
      conflictBarcodes,
      negativeResidualBarcodes,
      sourceTypeViolationBarcodes,
      anomalyBarcodes: Array.from(anomalyBarcodeSet).sort(),
    },
    verdictReasons,
  };
};

const summarizeList = (values, fallback = "无") => {
  if (!Array.isArray(values) || values.length === 0) return fallback;
  return values.join(", ");
};

const buildMarkdown = (payload) => {
  const latest = payload.latestRound;
  const lines = [
    "# Shadow 实时摘要板",
    "",
    `- 更新时间: ${payload.generatedAt}`,
    `- 目录: ${payload.runDir}`,
    `- 进度: ${payload.roundsCompleted}/${payload.totalRounds}`,
    `- 最新轮次: R${String(latest?.round ?? 0).padStart(4, "0")}`,
    `- 最新 Go/No-Go: ${latest?.goNoGo ? "GO" : "NO-GO"}`,
    "",
    "## 最近轮次 Go/No-Go",
    "",
    "| round | startedAt | go/no-go | 异常条码数 |",
    "|---|---|---|---:|",
  ];

  for (const row of payload.recentRounds) {
    lines.push(
      `| ${row.round} | ${row.startedAt ?? "n/a"} | ${row.goNoGo ? "GO" : "NO-GO"} | ${row.anomalyBarcodeCount ?? 0} |`,
    );
  }

  lines.push("");
  lines.push("## 最新一轮异常条码清单");
  lines.push("");
  lines.push(`- surface mismatch: ${summarizeList(latest?.anomalies?.barcodes?.surfaceMismatchBarcodes)}`);
  lines.push(`- dose contradiction: ${summarizeList(latest?.anomalies?.barcodes?.doseContradictionBarcodes)}`);
  lines.push(`- candidate conflicts: ${summarizeList(latest?.anomalies?.barcodes?.conflictBarcodes)}`);
  lines.push(`- negative residual: ${summarizeList(latest?.anomalies?.barcodes?.negativeResidualBarcodes)}`);
  lines.push(`- sourceTypeFinal violations: ${summarizeList(latest?.anomalies?.barcodes?.sourceTypeViolationBarcodes)}`);
  lines.push(`- all anomaly barcodes: ${summarizeList(latest?.anomalies?.barcodes?.anomalyBarcodes)}`);
  lines.push(`- verdict reasons: ${summarizeList(latest?.anomalies?.verdictReasons)}`);
  lines.push("");
  return lines.join("\n");
};

const buildPayload = async () => {
  const curvePath = path.join(runDir, "go_no_go_curve.json");
  const curve = await readJson(curvePath);
  if (!curve) {
    throw new Error(`curve_missing:${curvePath}`);
  }

  const rounds = Array.isArray(curve.rounds) ? curve.rounds : [];
  const enrichedRounds = [];

  for (const row of rounds) {
    const round = Number(row?.round ?? 0);
    const gateReportPath = String(row?.gateReportPath ?? "").trim();
    const gateReport = gateReportPath ? await readJson(gateReportPath) : null;
    const anomalies = collectRoundAnomalies(gateReport);
    enrichedRounds.push({
      round,
      startedAt: row?.startedAt ?? null,
      goNoGo: row?.goNoGo === true,
      gateReportPath: gateReportPath || null,
      anomalies,
      anomalyBarcodeCount: anomalies.counts.anomalyBarcodeCount,
    });
  }

  const sorted = enrichedRounds.sort((a, b) => a.round - b.round);
  const latestRound = sorted.length > 0 ? sorted[sorted.length - 1] : null;
  const recentRounds = sorted.slice(Math.max(0, sorted.length - roundWindow)).reverse();

  return {
    generatedAt: new Date().toISOString(),
    runDir,
    totalRounds: Number(curve.totalRounds ?? sorted.length),
    roundsCompleted: Number(curve.roundsCompleted ?? sorted.length),
    goRounds: Number(curve.goRounds ?? sorted.filter((row) => row.goNoGo).length),
    noGoRounds: Number(curve.noGoRounds ?? sorted.filter((row) => !row.goNoGo).length),
    goRate: Number(curve.goRate ?? 0),
    latestRound,
    recentRounds,
  };
};

const renderOnce = async () => {
  const payload = await buildPayload();
  const markdown = buildMarkdown(payload);
  await fs.mkdir(path.dirname(outFilePath), { recursive: true });
  await fs.mkdir(path.dirname(jsonOutPath), { recursive: true });
  await fs.writeFile(outFilePath, `${markdown}\n`, "utf8");
  await fs.writeFile(jsonOutPath, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
  console.log(`[shadow-realtime-board] wrote md=${outFilePath}`);
  console.log(`[shadow-realtime-board] wrote json=${jsonOutPath}`);
};

const main = async () => {
  if (!watchMode) {
    await renderOnce();
    return;
  }

  while (true) {
    try {
      await renderOnce();
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.error("[shadow-realtime-board] render failed", message);
    }
    await sleep(intervalMs);
  }
};

main().catch((error) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error("[shadow-realtime-board] fatal", message);
  process.exit(1);
});
