#!/usr/bin/env node
/* eslint-disable no-console */

import fs from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";

import { classifyCrashCanaryTimeoutBucket } from "./lib/crash-canary-timeout-bucket.mjs";

const ROOT_DIR = process.cwd();
const NOW_TAG = new Date().toISOString().replace(/[:.]/g, "-");

const parseArgs = () => {
  const args = process.argv.slice(2);
  const hasFlag = (flag) => args.includes(`--${flag}`);
  const getArg = (flag) => {
    const idx = args.indexOf(`--${flag}`);
    if (idx === -1) return null;
    return args[idx + 1] ?? null;
  };

  if (hasFlag("help")) {
    console.log(`Usage:
  node scripts/maintainer/run-cohort-replay.mjs [options]

Options:
  --cohort-jsonl <path>        Cohort jsonl input
  --cohort-json <path>         Cohort json array input
  --out-dir <path>             Output directory (default: output/replay/<timestamp>)
  --api-base-url <url>         API base URL (default: API_BASE_URL/RENDER_BASE_URL/http://127.0.0.1:3001)
  --profile <core|full_ui>     Replay profile (default: core)
  --timeout-ms <n>             Request timeout (default: 45000)
  --concurrency <n>            Replay concurrency (default: 4)
  --ui-max-per-role <n>        full_ui max heavy calls per role (default: 5)
  --ui-max-total <n>           full_ui max heavy calls total (default: 40)
`);
    process.exit(0);
  }

  const outDirArg = getArg("out-dir") || path.join("output", "replay", NOW_TAG);
  const apiBaseUrl = String(
    getArg("api-base-url")
      || process.env.API_BASE_URL
      || process.env.RENDER_BASE_URL
      || "http://127.0.0.1:3001",
  ).replace(/\/$/, "");
  const profileRaw = String(getArg("profile") || "core").trim().toLowerCase();
  const timeoutMs = Math.max(1, Math.floor(Number(getArg("timeout-ms") || 45000)));
  const concurrency = Math.max(1, Math.floor(Number(getArg("concurrency") || 4)));
  const uiMaxPerRole = Math.max(1, Math.floor(Number(getArg("ui-max-per-role") || 5)));
  const uiMaxTotal = Math.max(1, Math.floor(Number(getArg("ui-max-total") || 40)));
  const regressionToken = process.env.RENDER_REGRESSION_TOKEN || process.env.REGRESSION_AUTH_TOKEN || "";

  return {
    cohortJsonlArg: getArg("cohort-jsonl"),
    cohortJsonArg: getArg("cohort-json"),
    outDir: path.isAbsolute(outDirArg) ? outDirArg : path.join(ROOT_DIR, outDirArg),
    apiBaseUrl,
    profile: profileRaw === "full_ui" ? "full_ui" : "core",
    timeoutMs,
    concurrency,
    uiMaxPerRole,
    uiMaxTotal,
    commonHeaders: regressionToken ? { "x-regression-token": regressionToken } : { "x-auth-disabled": "1" },
  };
};

const normalizeBarcode = (value) => {
  const digits = String(value ?? "").replace(/\D/g, "");
  if (!digits) return null;
  if (digits.length >= 14) return digits.slice(-14);
  if (digits.length >= 8) return digits.padStart(14, "0");
  return null;
};

const normalizeRepeat = (value, fallback = 1) => {
  const n = Number(value);
  if (!Number.isFinite(n) || n <= 0) return fallback;
  return Math.max(1, Math.floor(n));
};

const readJson = async (filePath) => {
  try {
    return JSON.parse(await fs.readFile(filePath, "utf8"));
  } catch {
    return null;
  }
};

const readJsonl = async (filePath) => {
  try {
    const text = await fs.readFile(filePath, "utf8");
    return text
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter((line) => line.length > 0 && !line.startsWith("#"))
      .map((line) => {
        try {
          return JSON.parse(line);
        } catch {
          return null;
        }
      })
      .filter(Boolean);
  } catch {
    return [];
  }
};

const parseIdentity = (value) => {
  const text = String(value ?? "").trim();
  if (!text) return null;
  const idx = text.indexOf(":");
  if (idx === -1) return { type: "unknown", value: text };
  return { type: text.slice(0, idx), value: text.slice(idx + 1) };
};

const mapWithConcurrency = async (items, concurrency, worker) => {
  const output = Array(items.length).fill(null);
  let cursor = 0;
  const runners = Array.from({ length: Math.min(Math.max(1, concurrency), items.length || 1) }, async () => {
    while (true) {
      const index = cursor;
      cursor += 1;
      if (index >= items.length) return;
      output[index] = await worker(items[index], index);
    }
  });
  await Promise.all(runners);
  return output.filter(Boolean);
};

const runEnrichReplay = async ({ apiBaseUrl, headers, barcode, timeoutMs }) => {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  const startedAt = Date.now();
  let sseConnected = false;
  let doneSeen = false;
  let lastSseEventType = null;
  let sseEventCount = 0;
  let terminalReason = null;
  let terminal = "REQUEST_ERROR";
  let errorCode = null;
  let rev0SourceType = null;
  let rev1SourceType = null;
  let sourceTypeFinal = null;
  let rev1Ms = null;
  let identity = null;
  let requestId = null;
  let reader = null;

  try {
    const response = await fetch(`${apiBaseUrl}/api/enrich-stream`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "text/event-stream",
        ...headers,
      },
      body: JSON.stringify({ barcode, streamMode: "analysis_bundle_only" }),
      signal: controller.signal,
    });

    if (!response.ok || !response.body) {
      return {
        sseConnected,
        doneSeen,
        sseEventCount,
        lastSseEventType,
        terminalReason: `HTTP_${response.status}`,
        terminal,
        errorCode: `http_${response.status}`,
        elapsedMs: Date.now() - startedAt,
        rev0SourceType,
        rev1SourceType,
        sourceTypeFinal,
        rev1Ms,
        identity,
        requestId,
      };
    }

    sseConnected = true;
    reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    let currentEvent = "message";
    let dataLines = [];

    const flush = () => {
      if (!dataLines.length) return;
      const raw = dataLines.join("\n");
      dataLines = [];
      let payload = null;
      try {
        payload = JSON.parse(raw);
      } catch {
        payload = null;
      }
      sseEventCount += 1;
      lastSseEventType = currentEvent;
      requestId = requestId ?? payload?.requestId ?? payload?.meta?.requestId ?? null;

      if (currentEvent === "analysis_bundle" && payload && typeof payload === "object") {
        const revision = Number(payload?.meta?.revision);
        const sourceType = String(payload?.meta?.sourceType ?? "").trim().toLowerCase() || null;
        if (revision === 0) rev0SourceType = sourceType;
        if (revision >= 1) {
          rev1SourceType = sourceType;
          sourceTypeFinal = payload?.meta?.sourceTypeFinal === true;
          rev1Ms = Date.now() - startedAt;
          identity = parseIdentity(payload?.identity);
        }
      } else if (currentEvent === "done") {
        doneSeen = true;
        terminalReason = payload?.terminalReason ?? payload?.reasonCode ?? terminalReason;
        terminal = "DONE";
      } else if (currentEvent === "error") {
        terminalReason = payload?.reasonCode ?? payload?.code ?? terminalReason;
        errorCode = payload?.code ?? errorCode;
        terminal = payload?.code === "CLIENT_TIMEOUT" ? "CLIENT_TIMEOUT" : "REQUEST_ERROR";
      }
      currentEvent = "message";
    };

    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split(/\r?\n/);
      buffer = lines.pop() ?? "";
      for (const line of lines) {
        if (!line) {
          flush();
        } else if (line.startsWith("event:")) {
          currentEvent = line.slice(6).trim() || "message";
        } else if (line.startsWith("data:")) {
          dataLines.push(line.slice(5).trim());
        }
      }
    }
    flush();
    if (!doneSeen && terminal === "REQUEST_ERROR" && !terminalReason) {
      terminal = "CLIENT_TIMEOUT";
      terminalReason = "CLIENT_TIMEOUT";
    }
  } catch (error) {
    errorCode = error instanceof Error ? error.message : String(error);
    terminalReason = terminalReason ?? "REQUEST_ERROR";
  } finally {
    clearTimeout(timer);
    try {
      await reader?.cancel();
    } catch {
      // ignore cleanup failures
    }
    controller.abort();
  }

  return {
    sseConnected,
    doneSeen,
    sseEventCount,
    lastSseEventType,
    terminalReason,
    terminal,
    errorCode,
    elapsedMs: Date.now() - startedAt,
    rev0SourceType,
    rev1SourceType,
    sourceTypeFinal,
    rev1Ms,
    identity,
    requestId,
  };
};

const buildStabilityHash = ({ rev1SourceType, sourceTypeFinal, terminalReason, identity }) => [
  String(rev1SourceType ?? "null"),
  String(sourceTypeFinal === true),
  String(terminalReason ?? "null"),
  String(identity?.type ?? "null") || "null",
  String(identity?.value ?? "null") || "null",
].join("|");

const prepareReplayRows = (cohortRows) => {
  const rows = [];
  for (const row of cohortRows) {
    const barcode = normalizeBarcode(row?.barcode ?? row?.identity?.value);
    if (!barcode) continue;
    const repeat = normalizeRepeat(row?.repeat, 1);
    for (let idx = 1; idx <= repeat; idx += 1) {
      rows.push({ ...row, barcode, repeatIndex: idx });
    }
  }
  return rows;
};

const buildSummary = ({ traces, replayProfile, uiSkippedByBudget, heavyEndpointCalls, heavyEndpointTimeoutCount }) => {
  const byBarcode = new Map();
  for (const row of traces) {
    if (!byBarcode.has(row.barcode)) byBarcode.set(row.barcode, new Set());
    byBarcode.get(row.barcode).add(row.stabilityHash);
  }
  const nondeterministicBarcodes = [...byBarcode.entries()]
    .filter(([, hashes]) => hashes.size > 1)
    .map(([barcode]) => barcode);

  return {
    generatedAt: new Date().toISOString(),
    replayProfile,
    attempts: traces.length,
    doneSeenRate: traces.length > 0
      ? traces.filter((row) => row.doneSeen === true).length / traces.length
      : 0,
    timeoutBucketCounts: traces.reduce((acc, row) => {
      const key = String(row.timeoutBucket ?? "none");
      acc[key] = (acc[key] ?? 0) + 1;
      return acc;
    }, {}),
    uiSkippedByBudget,
    heavyEndpointCalls,
    heavyEndpointTimeoutCount,
    nondeterministicSameBarcodeCount: nondeterministicBarcodes.length,
    nondeterministicBarcodes,
  };
};

const main = async () => {
  const opts = parseArgs();
  const cohortJsonlPath = opts.cohortJsonlArg
    ? (path.isAbsolute(opts.cohortJsonlArg) ? opts.cohortJsonlArg : path.join(ROOT_DIR, opts.cohortJsonlArg))
    : null;
  const cohortJsonPath = opts.cohortJsonArg
    ? (path.isAbsolute(opts.cohortJsonArg) ? opts.cohortJsonArg : path.join(ROOT_DIR, opts.cohortJsonArg))
    : null;

  let cohortRows = [];
  if (cohortJsonlPath) {
    cohortRows = await readJsonl(cohortJsonlPath);
  } else if (cohortJsonPath) {
    const payload = await readJson(cohortJsonPath);
    cohortRows = Array.isArray(payload) ? payload : [];
  } else {
    throw new Error("Missing cohort input: provide --cohort-jsonl or --cohort-json");
  }

  const replayRows = prepareReplayRows(cohortRows);
  await fs.mkdir(opts.outDir, { recursive: true });

  let uiSkippedByBudget = 0;
  const heavyEndpointCalls = 0;
  const heavyEndpointTimeoutCount = 0;

  const traces = await mapWithConcurrency(replayRows, opts.concurrency, async (row) => {
    const enrich = await runEnrichReplay({
      apiBaseUrl: opts.apiBaseUrl,
      headers: opts.commonHeaders,
      barcode: row.barcode,
      timeoutMs: opts.timeoutMs,
    });
    if (opts.profile === "full_ui") uiSkippedByBudget += 1;
    const timeoutBucket = classifyCrashCanaryTimeoutBucket({
      terminal: enrich.terminal,
      lastSseEventType: enrich.lastSseEventType,
      rev1Ms: enrich.rev1Ms,
    });
    const stabilityHash = buildStabilityHash({
      rev1SourceType: enrich.rev1SourceType,
      sourceTypeFinal: enrich.sourceTypeFinal,
      terminalReason: enrich.terminalReason,
      identity: enrich.identity,
    });
    return {
      role: row?.role ?? "unknown",
      country: row?.country ?? null,
      barcode: row.barcode,
      replayProfile: opts.profile,
      repeatIndex: row.repeatIndex,
      priority: row?.priority ?? null,
      source: row?.source ?? null,
      expectedDatasetHint: row?.expected?.datasetHint ?? null,
      ...enrich,
      timeoutBucket,
      uiSkippedByBudget: opts.profile === "full_ui",
      heavyEndpointCalls,
      heavyEndpointTimeoutCount,
      stabilityHash,
    };
  });

  const summary = buildSummary({
    traces,
    replayProfile: opts.profile,
    uiSkippedByBudget,
    heavyEndpointCalls,
    heavyEndpointTimeoutCount,
  });
  const tracesPath = path.join(opts.outDir, "traces.jsonl");
  const summaryPath = path.join(opts.outDir, "replay_summary.json");
  await fs.writeFile(tracesPath, traces.map((row) => JSON.stringify(row)).join("\n") + "\n", "utf8");
  await fs.writeFile(summaryPath, JSON.stringify(summary, null, 2), "utf8");
  console.log(`[run-cohort-replay] wrote ${tracesPath}`);
  console.log(`[run-cohort-replay] wrote ${summaryPath}`);
  console.log(`[run-cohort-replay] attempts=${traces.length} profile=${opts.profile}`);
};

const isDirectRun = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isDirectRun) {
  main().catch((error) => {
    console.error("[run-cohort-replay] failed", error instanceof Error ? error.message : String(error));
    process.exit(1);
  });
}
