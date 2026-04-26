#!/usr/bin/env node
/* eslint-disable no-console */

import fs from "node:fs/promises";
import path from "node:path";
import {
  attachRunOrder,
  buildServer5xxBucketRows,
  countBy,
  ensureDir,
  findServer5xxWindows,
  isServer5xxRow,
  latencyStats,
  linkClientTimeoutTriggers,
  parseArgs,
  productKey,
  readJson,
  readJsonl,
  safeText,
  truncate,
  writeCsv,
  writeJson,
  writeText,
} from "./lib/scan-result-full-corpus-audit.mjs";

const DEFAULT_RUN_ID = "scan-result-full-corpus-core-20260425";
const DEFAULT_MANIFEST = "output/scan-result-full-corpus-audit/codex-full-corpus-manifest-20260425-v3/manifest.json";

const fileExists = async (filePath) => {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
};

const compactContext = (row) => ({
  runOrder: row?.runOrder ?? null,
  observedLine: row?.observedLine ?? null,
  productKey: row?.productKey ?? null,
  productId: row?.productId ?? null,
  barcode: row?.barcode ?? null,
  family: row?.family ?? null,
  brand: row?.brand ?? null,
  sourceTier: row?.sourceTier ?? null,
  factsStatus: row?.factsStatus ?? null,
  failureClass: row?.failureClass ?? null,
  terminal: row?.terminal ?? null,
  httpStatus: row?.finalHttpStatus ?? row?.httpStatus ?? null,
  productName: truncate(row?.productName, 140),
});

const dominantEntries = (rows, field, limit = 5) => Object.entries(countBy(rows, field))
  .slice(0, limit)
  .map(([key, count]) => `${key}:${count}`)
  .join("; ");

const flattenWindow = (window) => ({
  windowId: window.windowId,
  startRunOrder: window.startRunOrder,
  endRunOrder: window.endRunOrder,
  count: window.count,
  largeWindow: window.count >= 5,
  firstObservedLine: window.firstRow?.observedLine ?? null,
  lastObservedLine: window.lastRow?.observedLine ?? null,
  firstProductKey: window.firstRow?.productKey ?? null,
  firstBarcode: window.firstRow?.barcode ?? null,
  firstProductId: window.firstRow?.productId ?? null,
  firstFamily: window.firstRow?.family ?? null,
  firstBrand: window.firstRow?.brand ?? null,
  firstSourceTier: window.firstRow?.sourceTier ?? null,
  firstFactsStatus: window.firstRow?.factsStatus ?? null,
  previousRunOrder: window.previousRow?.runOrder ?? null,
  previousProductKey: window.previousRow?.productKey ?? null,
  previousFailureClass: window.previousRow?.failureClass ?? null,
  previousTerminal: window.previousRow?.terminal ?? null,
  previousWasClientTimeout: window.previousWasClientTimeout,
  recoveredAfterWindow: window.recoveredAfterWindow,
  nextRunOrder: window.nextRow?.runOrder ?? null,
  nextFailureClass: window.nextRow?.failureClass ?? null,
  topFamilies: dominantEntries(window.rows, "family"),
  topBrands: dominantEntries(window.rows, "brand"),
  topSourceTiers: dominantEntries(window.rows, "sourceTier"),
  topFactsStatuses: dominantEntries(window.rows, "factsStatus"),
  preliminaryClassification: window.preliminaryClassification,
});

const classifyEvidence = ({ windows, timeoutTriggers, rows }) => {
  const serverRows = rows.filter(isServer5xxRow);
  const largeWindows = windows.filter((window) => window.count >= 5);
  const multiEntityLarge = largeWindows.filter((window) => window.familyCount > 1 || window.brandCount > 1 || window.sourceTierCount > 1);
  const timeoutBeforeWindow = timeoutTriggers.filter((row) => row.immediatelyPrecedesWindow).length;
  const recoveredWindows = largeWindows.filter((window) => window.recoveredAfterWindow).length;
  if (largeWindows.length > 0 && (multiEntityLarge.length > 0 || timeoutBeforeWindow > 0 || recoveredWindows > 0)) {
    return {
      classification: "Render/service availability window or harness backoff gap",
      confidence: "medium_route_only",
      rationale: "5xx failures form contiguous run-order windows spanning multiple product entities, often around timeout/recovery boundaries. Isolated replay and Render logs are required before calling any single product the root cause.",
    };
  }
  if (serverRows.length > 0 && largeWindows.length === 0) {
    return {
      classification: "single/product-specific candidates pending replay",
      confidence: "low_route_only",
      rationale: "5xx rows do not cluster into large windows, so isolated replay is needed to separate product-specific crashes from transient service errors.",
    };
  }
  return {
    classification: "unknown",
    confidence: "low",
    rationale: "No actionable 5xx clustering signal was found in the available core rows.",
  };
};

const renderMarkdown = ({ args, evidenceFiles, rows, windows, timeoutTriggers, bucketRows, evidence }) => {
  const serverRows = rows.filter(isServer5xxRow);
  const largeWindows = windows.filter((window) => window.count >= args.largeWindowMin);
  const clientTimeoutRows = rows.filter((row) => row.clientTimeout || row.failureClass === "client_timeout");
  const serverStats = latencyStats(serverRows.map((row) => row.doneMs ?? row.rev1Ms));
  return [
    "# P0 Server 5xx Root-Cause Investigation",
    "",
    `- generatedAt: ${new Date().toISOString()}`,
    `- runId: ${args.runId}`,
    `- core rows analyzed: ${rows.length}`,
    `- server_5xx rows: ${serverRows.length}`,
    `- client_timeout rows: ${clientTimeoutRows.length}`,
    `- contiguous 5xx windows: ${windows.length}`,
    `- large 5xx windows (>=${args.largeWindowMin}): ${largeWindows.length}`,
    `- 5xx latency p50/p95/p99: ${serverStats.p50}/${serverStats.p95}/${serverStats.p99}`,
    "",
    "## Evidence Files Loaded",
    ...Object.entries(evidenceFiles).map(([name, loaded]) => `- ${name}: ${loaded ? "loaded" : "missing"}`),
    "",
    "## Root-Cause Classification",
    `- classification: ${evidence.classification}`,
    `- confidence: ${evidence.confidence}`,
    `- rationale: ${evidence.rationale}`,
    "- Render evidence: not included in this offline analyzer; trigger replay should add Render MCP/log evidence if available.",
    "",
    "## Largest Contiguous 5xx Windows",
    ...largeWindows.slice(0, 30).map((window) => {
      const flat = flattenWindow(window);
      return `- ${flat.windowId}: rows ${flat.startRunOrder}-${flat.endRunOrder} count=${flat.count} prevTimeout=${flat.previousWasClientTimeout} recovered=${flat.recoveredAfterWindow} class=${flat.preliminaryClassification} first=${flat.firstFamily}/${flat.firstBrand}/${flat.firstBarcode}`;
    }),
    "",
    "## Client Timeout Triggers",
    ...timeoutTriggers.map((row) => `- runOrder=${row.runOrder} product=${row.productKey} family=${row.family} nextWindow=${row.next5xxWindowId ?? "none"} immediate=${row.immediatelyPrecedesWindow}`),
    "",
    "## 5xx Buckets Snapshot",
    ...bucketRows.slice(0, 80).map((row) => `- ${row.dimension}=${row.bucket}: ${row.count} (${row.percent_of_5xx}%)`),
    "",
    "## What This Does Not Prove Yet",
    "- A contiguous 502 window is not automatically 4,546 independent product bugs.",
    "- Product-specific crashes require isolated replay failure for the same barcode while neighboring requests recover.",
    "- Render overload/restart/OOM requires Render log evidence or repeated route-level availability-window behavior.",
    "",
  ].join("\n");
};

const productIdType = (value) => {
  const text = safeText(value);
  if (!text) return "missing";
  if (/^\d+$/.test(text)) return "numeric";
  if (/^ca-official-url-/i.test(text)) return "ca_official_url";
  if (/^ca-official-/i.test(text)) return "ca_official";
  return "other";
};

const renderBucketLines = (rows, field, limit = 30) => Object.entries(countBy(rows, field))
  .slice(0, limit)
  .map(([key, count]) => `- ${key}: ${count}`);

const renderDataGapSummary = ({ rows, manifestProducts }) => {
  const gaps = rows.filter((row) => row.failureClass === "data_gap_not_found");
  const manifestKeys = new Set(manifestProducts.map((product) => productKey(product)));
  const manifestComposite = new Set(manifestProducts.map((product) => `${productKey(product)}::${safeText(product.productId)}`));
  const existsInManifest = gaps.filter((row) => manifestKeys.has(row.productKey) || manifestComposite.has(`${row.productKey}::${safeText(row.productId)}`));
  const leadingZero = gaps.filter((row) => String(row.barcode ?? "").startsWith("0"));
  return [
    "# Data Gap Not Found Summary",
    "",
    `- generatedAt: ${new Date().toISOString()}`,
    `- total data_gap_not_found rows: ${gaps.length}`,
    `- rows still present in manifest: ${existsInManifest.length}`,
    `- rows with barcode: ${gaps.filter((row) => row.barcode).length}`,
    `- rows with leading-zero barcode: ${leadingZero.length}`,
    `- productId-only rows: ${gaps.filter((row) => !row.barcode && row.productId).length}`,
    "",
    "## By Source Tier",
    ...renderBucketLines(gaps, "sourceTier"),
    "",
    "## By Facts Status",
    ...renderBucketLines(gaps, "factsStatus"),
    "",
    "## By ProductId Type",
    ...Object.entries(countBy(gaps, (row) => productIdType(row.productId))).map(([key, count]) => `- ${key}: ${count}`),
    "",
    "## Barcode Normalization Signals",
    ...Object.entries(countBy(gaps, (row) => {
      const barcode = String(row.barcode ?? "");
      if (!barcode) return "missing_barcode";
      if (barcode.length !== 14) return `length_${barcode.length}`;
      if (barcode.startsWith("00")) return "gtin14_with_double_leading_zero";
      if (barcode.startsWith("0")) return "gtin14_with_leading_zero";
      return "gtin14_no_leading_zero";
    })).map(([key, count]) => `- ${key}: ${count}`),
    "",
    "## First 40 Rows",
    ...gaps.slice(0, 40).map((row) => `- runOrder=${row.runOrder} ${row.productKey} family=${row.family} sourceTier=${row.sourceTier} facts=${row.factsStatus} terminal=${row.terminal} detail=${safeText(row.serverError)}`),
    "",
  ].join("\n");
};

const renderTerminalStateSummary = ({ rows }) => {
  const terminalRows = rows.filter((row) => row.failureClass === "terminal_state");
  return [
    "# Terminal State Summary",
    "",
    `- generatedAt: ${new Date().toISOString()}`,
    `- terminal_state rows: ${terminalRows.length}`,
    "",
    "## By Terminal",
    ...renderBucketLines(terminalRows, "terminal"),
    "",
    "## Rows",
    ...terminalRows.map((row) => `- runOrder=${row.runOrder} ${row.productKey} status=${row.httpStatus ?? row.finalHttpStatus ?? "n/a"} terminal=${row.terminal} events=${JSON.stringify(row.streamEventsSeen ?? [])} error=${safeText(row.serverError)}`),
    "",
  ].join("\n");
};

const renderBlankScoreSummary = async ({ args, rows }) => {
  const blankRows = rows.filter((row) => row.failureClass === "blank_score");
  let scoreExtractionStatus = "not_run";
  try {
    const scoreReport = await fs.readFile(path.join(args.runDir, "score-extraction-contract-report.md"), "utf8");
    const match = scoreReport.match(/score extraction status:\s*([^\n]+)/i);
    scoreExtractionStatus = match?.[1]?.trim() ?? "report_present";
  } catch {}
  return [
    "# Blank Score Summary",
    "",
    `- generatedAt: ${new Date().toISOString()}`,
    `- blank_score rows: ${blankRows.length}`,
    `- score extraction status: ${scoreExtractionStatus}`,
    scoreExtractionStatus === "blocked_by_service_5xx_window"
      ? "- interpretation: score extraction cannot be judged until `/api/enrich-stream` recovers; do not treat all blank_score rows as backend score bugs yet."
      : "- interpretation: use score-extraction sample rows to separate harness selector misses from true backend score omissions.",
    "",
    "## By Family",
    ...renderBucketLines(blankRows, "family"),
    "",
    "## By Source Tier",
    ...renderBucketLines(blankRows, "sourceTier"),
    "",
    "## By Facts Status",
    ...renderBucketLines(blankRows, "factsStatus"),
    "",
    "## First 40 Rows",
    ...blankRows.slice(0, 40).map((row) => `- runOrder=${row.runOrder} ${row.productKey} family=${row.family} sourceTier=${row.sourceTier} facts=${row.factsStatus} terminal=${row.terminal} scorePath=${row.scorePath ?? "none"}`),
    "",
  ].join("\n");
};

const main = async () => {
  const args = parseArgs(process.argv.slice(2), {
    runId: DEFAULT_RUN_ID,
    manifestPath: DEFAULT_MANIFEST,
    mode: "p0-core-root-cause",
    concurrency: 1,
    largeWindowMin: 5,
  });
  await ensureDir(args.runDir);
  const manifest = await readJson(args.manifestPath);
  const corePath = path.join(args.runDir, "core-results.jsonl");
  const rawCoreRows = await readJsonl(corePath);
  const rows = attachRunOrder(rawCoreRows, manifest.products ?? []);
  const windows = findServer5xxWindows(rows, { largeWindowMin: args.largeWindowMin });
  const timeoutTriggers = linkClientTimeoutTriggers(rows, windows);
  const bucketRows = buildServer5xxBucketRows(rows, { segmentSize: 1000 });
  const evidenceFiles = {
    "core-results.jsonl": await fileExists(corePath),
    "product-level-audit.csv": await fileExists(path.join(args.runDir, "product-level-audit.csv")),
    "p0-p1-failure-list.csv": await fileExists(path.join(args.runDir, "p0-p1-failure-list.csv")),
    "core-contract-summary.md": await fileExists(path.join(args.runDir, "core-contract-summary.md")),
    "FINAL_REPORT.md": await fileExists(path.join(args.runDir, "FINAL_REPORT.md")),
  };
  const evidence = classifyEvidence({ windows, timeoutTriggers, rows });
  await writeCsv(path.join(args.runDir, "p0-server-5xx-windows.csv"), windows.map(flattenWindow));
  await writeCsv(path.join(args.runDir, "p0-client-timeout-triggers.csv"), timeoutTriggers);
  await writeCsv(path.join(args.runDir, "p0-server-5xx-family-brand-buckets.csv"), bucketRows);
  await writeJson(path.join(args.runDir, "p0-server-5xx-root-cause.json"), {
    reportType: "p0_server_5xx_root_cause",
    generatedAt: new Date().toISOString(),
    runId: args.runId,
    summary: {
      rows: rows.length,
      server5xx: rows.filter(isServer5xxRow).length,
      clientTimeouts: timeoutTriggers.length,
      windows: windows.length,
      largeWindows: windows.filter((window) => window.count >= args.largeWindowMin).length,
    },
    evidence,
    windows: windows.map((window) => ({ ...flattenWindow(window), firstContext: compactContext(window.firstRow), previousContext: compactContext(window.previousRow), nextContext: compactContext(window.nextRow) })),
    timeoutTriggers,
  });
  await writeText(path.join(args.runDir, "p0-server-5xx-root-cause.md"), renderMarkdown({ args, evidenceFiles, rows, windows, timeoutTriggers, bucketRows, evidence }));
  await writeText(path.join(args.runDir, "data-gap-not-found-summary.md"), renderDataGapSummary({ rows, manifestProducts: manifest.products ?? [] }));
  await writeText(path.join(args.runDir, "terminal-state-summary.md"), renderTerminalStateSummary({ rows }));
  await writeText(path.join(args.runDir, "blank-score-summary.md"), await renderBlankScoreSummary({ args, rows }));
  console.log(`[p0-core-root-cause] complete runId=${args.runId} server5xx=${rows.filter(isServer5xxRow).length} windows=${windows.length}`);
};

main().catch((error) => {
  console.error("[p0-core-root-cause] failed", error instanceof Error ? error.stack || error.message : String(error));
  process.exitCode = 1;
});
