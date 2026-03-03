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

  const cohortJsonlArg = getArg("cohort-jsonl");
  const cohortJsonArg = getArg("cohort-json");
  const outDirArg = getArg("out-dir") || path.join("output", "replay", NOW_TAG);
  const outDir = path.isAbsolute(outDirArg) ? outDirArg : path.join(ROOT_DIR, outDirArg);
  const apiBaseUrl = String(
    getArg("api-base-url")
    || process.env.API_BASE_URL
    || process.env.RENDER_BASE_URL
    || "http://127.0.0.1:3001",
  ).replace(/\/$/, "");
  const profileRaw = String(getArg("profile") || "core").trim().toLowerCase();
  const profile = profileRaw === "full_ui" ? "full_ui" : "core";
  const timeoutRaw = Number(getArg("timeout-ms") || 45000);
  const timeoutMs = Number.isFinite(timeoutRaw) && timeoutRaw > 0 ? Math.floor(timeoutRaw) : 45000;
  const concurrencyRaw = Number(getArg("concurrency") || 4);
  const concurrency = Number.isFinite(concurrencyRaw) && concurrencyRaw > 0 ? Math.floor(concurrencyRaw) : 4;
  const uiMaxPerRoleRaw = Number(getArg("ui-max-per-role") || 5);
  const uiMaxTotalRaw = Number(getArg("ui-max-total") || 40);
  const uiMaxPerRole = Number.isFinite(uiMaxPerRoleRaw) && uiMaxPerRoleRaw > 0 ? Math.floor(uiMaxPerRoleRaw) : 5;
  const uiMaxTotal = Number.isFinite(uiMaxTotalRaw) && uiMaxTotalRaw > 0 ? Math.floor(uiMaxTotalRaw) : 40;
  const regressionToken = process.env.RENDER_REGRESSION_TOKEN || process.env.REGRESSION_AUTH_TOKEN || "";

  return {
    cohortJsonlArg,
    cohortJsonArg,
    outDir,
    apiBaseUrl,
    profile,
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
  return {
    type: text.slice(0, idx),
    value: text.slice(idx + 1),
  };
};

const mapWithConcurrency = async (items, concurrency, worker) => {
  const output = Array(items.length).fill(null);
  let cursor = 0;
  const workerCount = Math.max(1, Math.min(concurrency, items.length || 1));
  const runners = Array.from({ length: workerCount }, async () => {
    while (true) {
      const index = cursor;
      cursor += 1;
      if (index >= items.length) return;
      output[index] = await worker(items[index], index);
    }
  });
  await Promise.all(runners);
  return output;
};

const runEnrichReplay = async ({ apiBaseUrl, headers, barcode, timeoutMs }) => {
  const controller = new AbortController();
  const startedAt = Date.now();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  let reader = null;
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

  try {
    const response = await fetch(`${apiBaseUrl}/api/enrich-stream`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "text/event-stream",
        ...headers,
      },
      body: JSON.stringify({
        barcode,
        streamMode: "analysis_bundle_only",
      }),
      signal: controller.signal,
    });
    if (!response.ok || !response.body) {
      return {
        sseConnected: false,
        doneSeen: false,
        sseEventCount: 0,
        lastSseEventType: null,
        terminalReason: `HTTP_${response.status}`,
        terminal: "REQUEST_ERROR",
        errorCode: `http_${response.status}`,
        elapsedMs: Date.now() - startedAt,
        rev0SourceType: null,
        rev1SourceType: null,
        sourceTypeFinal: null,
        rev1Ms: null,
        identity: null,
        requestId: null,
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
      if (payload && typeof payload === "object" && !requestId) {
        requestId = payload?.requestId
          ?? payload?.request_id
          ?? payload?.meta?.requestId
          ?? payload?.meta?.request_id
          ?? null;
      }
      if (currentEvent === "analysis_bundle" && payload && typeof payload === "object") {
        const revision = Number(payload?.meta?.revision);
        const sourceType = String(payload?.meta?.sourceType ?? "").trim().toLowerCase() || null;
        if (revision === 0) {
          rev0SourceType = sourceType;
        }
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
          continue;
        }
        if (line.startsWith("event:")) {
          currentEvent = line.slice(6).trim() || "message";
          continue;
        }
        if (line.startsWith("data:")) {
          dataLines.push(line.slice(5).trim());
        }
      }
    }
    flush();
    if (!doneSeen && terminal === "REQUEST_ERROR" && !terminalReason) {
      terminal = "CLIENT_TIMEOUT";
      terminalReason = "CLIENT_TIMEOUT";
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
  } catch (error) {
    return {
      sseConnected,
      doneSeen: false,
      sseEventCount,
      lastSseEventType,
      terminalReason: "REQUEST_ERROR",
      terminal: "REQUEST_ERROR",
      errorCode: error instanceof Error ? error.message : String(error),
      elapsedMs: Date.now() - startedAt,
      rev0SourceType,
      rev1SourceType,
      sourceTypeFinal,
      rev1Ms,
      identity,
      requestId,
    };
  } finally {
    clearTimeout(timer);
    try {
      await reader?.cancel();
    } catch {
      // ignore
    }
    controller.abort();
  }
};

const fetchJsonWithTimeout = async ({ url, method = "GET", headers = {}, body = null, timeoutMs = 12000 }) => {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  const startedAt = Date.now();
  try {
    const response = await fetch(url, {
      method,
      headers,
      body,
      signal: controller.signal,
    });
    let payload = null;
    try {
      payload = await response.json();
    } catch {
      payload = null;
    }
    return {
      ok: response.ok,
      status: response.status,
      payload,
      elapsedMs: Date.now() - startedAt,
      timeout: false,
    };
  } catch (error) {
    return {
      ok: false,
      status: null,
      payload: null,
      elapsedMs: Date.now() - startedAt,
      timeout: true,
      error: error instanceof Error ? error.message : String(error),
    };
  } finally {
    clearTimeout(timer);
    controller.abort();
  }
};

const getSourceLookup = (enrichResult, fallbackBarcode) => {
  const sourceType = String(enrichResult?.rev1SourceType ?? "").trim().toLowerCase();
  const identity = enrichResult?.identity;
  if (!sourceType) return null;
  const identityType = String(identity?.type ?? "").trim().toLowerCase();
  const identityValue = String(identity?.value ?? "").trim();
  if (identityType && identityValue && identityType !== "unknown") {
    return { sourceType, sourceId: identityValue, identityType };
  }
  if (sourceType === "web") {
    return { sourceType: "web", sourceId: fallbackBarcode, identityType: "gtin14" };
  }
  return null;
};

const buildStabilityHash = ({ rev1SourceType, sourceTypeFinal, terminalReason, identity }) => {
  const identityType = String(identity?.type ?? "null").trim();
  const identityValue = String(identity?.value ?? "null").trim();
  return [
    String(rev1SourceType ?? "null"),
    String(sourceTypeFinal === true),
    String(terminalReason ?? "null"),
    identityType || "null",
    identityValue || "null",
  ].join("|");
};

const prepareReplayRows = (cohortRows) => {
  const rows = [];
  for (const row of cohortRows) {
    const barcode = normalizeBarcode(row?.barcode ?? row?.identity?.value);
    if (!barcode) continue;
    const repeat = normalizeRepeat(row?.repeat, 1);
    for (let idx = 1; idx <= repeat; idx += 1) {
      rows.push({
        ...row,
        barcode,
        repeatIndex: idx,
      });
    }
  }
  return rows;
};

const canRunHeavyForRow = ({ profile, role, counters, uiMaxPerRole, uiMaxTotal }) => {
  if (profile !== "full_ui") return false;
  if (counters.total >= uiMaxTotal) return false;
  const byRole = counters.byRole.get(role) ?? 0;
  return byRole < uiMaxPerRole;
};

const runHeavyEndpoints = async ({
  apiBaseUrl,
  headers,
  sourceType,
  sourceId,
  timeoutMs,
}) => {
  const requests = [
    fetchJsonWithTimeout({
      url: `${apiBaseUrl}/api/analysis-section`,
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...headers,
      },
      body: JSON.stringify({
        section: "safety",
        sourceType,
        sourceId,
      }),
      timeoutMs,
    }),
    fetchJsonWithTimeout({
      url: `${apiBaseUrl}/api/summary/ingredient`,
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...headers,
      },
      body: JSON.stringify({
        ingredient: "Vitamin C",
        sourceType,
        sourceId,
      }),
      timeoutMs,
    }),
  ];
  const results = await Promise.all(requests);
  return {
    callCount: results.length,
    timeoutCount: results.filter((row) => row?.timeout === true).length,
  };
};

const buildSummary = ({ traces, profile, uiSkippedByBudget, heavyEndpointCalls, heavyEndpointTimeoutCount }) => {
  const doneSeenCount = traces.filter((row) => row?.doneSeen === true).length;
  const terminalReasonCounts = traces.reduce((acc, row) => {
    const key = String(row?.terminalReason ?? "null");
    acc[key] = (acc[key] ?? 0) + 1;
    return acc;
  }, {});
  const timeoutBucketCounts = traces.reduce((acc, row) => {
    const key = String(row?.timeoutBucket ?? "none");
    acc[key] = (acc[key] ?? 0) + 1;
    return acc;
  }, {});
  const nondeterministicBarcodes = [];
  const byBarcode = new Map();
  for (const row of traces) {
    if (!byBarcode.has(row.barcode)) byBarcode.set(row.barcode, new Set());
    byBarcode.get(row.barcode).add(row.stabilityHash);
  }
  for (const [barcode, set] of byBarcode.entries()) {
    if (set.size > 1) nondeterministicBarcodes.push(barcode);
  }
  return {
    generatedAt: new Date().toISOString(),
    replayProfile: profile,
    attempts: traces.length,
    doneSeenRate: traces.length > 0 ? doneSeenCount / traces.length : 0,
    terminalReasonCounts,
    timeoutBucketCounts,
    heavyEndpointCalls,
    heavyEndpointTimeoutCount,
    uiSkippedByBudget,
    nondeterministicSameBarcodeCount: nondeterministicBarcodes.length,
    nondeterministicBarcodes,
  };
};

const main = async () => {
  const opts = parseArgs();
  const cohortJsonlPath = opts.cohortJsonlArg
    ? (path.isAbsolute(opts.cohortJsonlArg)
      ? opts.cohortJsonlArg
      : path.join(ROOT_DIR, opts.cohortJsonlArg))
    : null;
  const cohortJsonPath = opts.cohortJsonArg
    ? (path.isAbsolute(opts.cohortJsonArg)
      ? opts.cohortJsonArg
      : path.join(ROOT_DIR, opts.cohortJsonArg))
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

  let heavyEndpointCalls = 0;
  let heavyEndpointTimeoutCount = 0;
  let uiSkippedByBudget = 0;
  const heavyCounter = { total: 0, byRole: new Map() };

  const traces = await mapWithConcurrency(replayRows, opts.concurrency, async (row) => {
    const role = String(row?.role ?? "unknown");
    const enrich = await runEnrichReplay({
      apiBaseUrl: opts.apiBaseUrl,
      headers: opts.commonHeaders,
      barcode: row.barcode,
      timeoutMs: opts.timeoutMs,
    });
    const sourceLookup = getSourceLookup(enrich, row.barcode);

    let scanFactsStatus = null;
    let scoreResponseStatus = null;
    let scoreQueryInitiated = false;
    let scoreLatencyMs = null;
    if (sourceLookup?.sourceType && sourceLookup?.sourceId) {
      const facts = await fetchJsonWithTimeout({
        url: `${opts.apiBaseUrl}/api/scan-facts/v1/${sourceLookup.sourceType}/${encodeURIComponent(sourceLookup.sourceId)}`,
        headers: opts.commonHeaders,
        timeoutMs: Math.min(opts.timeoutMs, 15000),
      });
      scanFactsStatus = facts.status;
      if (sourceLookup.sourceType === "lnhpd" || sourceLookup.sourceType === "dsld") {
        scoreQueryInitiated = true;
        const score = await fetchJsonWithTimeout({
          url: `${opts.apiBaseUrl}/api/score/v4/${sourceLookup.sourceType}/${encodeURIComponent(sourceLookup.sourceId)}`,
          headers: opts.commonHeaders,
          timeoutMs: Math.min(opts.timeoutMs, 20000),
        });
        scoreLatencyMs = score.elapsedMs;
        scoreResponseStatus = score.payload?.responseStatus ?? (score.ok ? "ok" : "error");
      }
    }

    let heavyCallCount = 0;
    let heavyTimeoutCount = 0;
    if (sourceLookup && canRunHeavyForRow({
      profile: opts.profile,
      role,
      counters: heavyCounter,
      uiMaxPerRole: opts.uiMaxPerRole,
      uiMaxTotal: opts.uiMaxTotal,
    })) {
      const heavy = await runHeavyEndpoints({
        apiBaseUrl: opts.apiBaseUrl,
        headers: opts.commonHeaders,
        sourceType: sourceLookup.sourceType,
        sourceId: sourceLookup.sourceId,
        timeoutMs: Math.min(opts.timeoutMs, 15000),
      });
      heavyCallCount = heavy.callCount;
      heavyTimeoutCount = heavy.timeoutCount;
      heavyEndpointCalls += heavy.callCount;
      heavyEndpointTimeoutCount += heavy.timeoutCount;
      heavyCounter.total += 1;
      heavyCounter.byRole.set(role, (heavyCounter.byRole.get(role) ?? 0) + 1);
    } else if (opts.profile === "full_ui") {
      uiSkippedByBudget += 1;
    }

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
      role,
      country: row?.country ?? null,
      barcode: row.barcode,
      replayProfile: opts.profile,
      repeatIndex: row.repeatIndex,
      priority: row?.priority ?? null,
      source: row?.source ?? null,
      expectedDatasetHint: row?.expected?.datasetHint ?? null,
      sseConnected: enrich.sseConnected,
      sseEventCount: enrich.sseEventCount,
      lastSseEventType: enrich.lastSseEventType,
      doneSeen: enrich.doneSeen,
      terminal: enrich.terminal,
      terminalReason: enrich.terminalReason,
      errorCode: enrich.errorCode,
      elapsedMs: enrich.elapsedMs,
      requestId: enrich.requestId ?? null,
      rev0SourceType: enrich.rev0SourceType,
      rev1SourceType: enrich.rev1SourceType,
      sourceTypeFinal: enrich.sourceTypeFinal,
      authoritativeIdentity: enrich.identity,
      timeoutBucket,
      scoreQueryInitiated,
      scoreResponseStatus,
      scoreLatencyMs,
      scanFactsStatus,
      heavyEndpointCalls: heavyCallCount,
      heavyEndpointTimeoutCount: heavyTimeoutCount,
      stabilityHash,
    };
  });

  const tracesPath = path.join(opts.outDir, "traces.jsonl");
  const summaryPath = path.join(opts.outDir, "replay_summary.json");
  const summary = buildSummary({
    traces,
    profile: opts.profile,
    uiSkippedByBudget,
    heavyEndpointCalls,
    heavyEndpointTimeoutCount,
  });

  await fs.writeFile(tracesPath, traces.map((row) => JSON.stringify(row)).join("\n") + "\n", "utf8");
  await fs.writeFile(summaryPath, JSON.stringify(summary, null, 2), "utf8");
  console.log(`[run-cohort-replay] wrote ${tracesPath}`);
  console.log(`[run-cohort-replay] wrote ${summaryPath}`);
  console.log(`[run-cohort-replay] attempts=${traces.length} profile=${opts.profile}`);
};

const isDirectRun = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isDirectRun) {
  main().catch((error) => {
    console.error(
      "[run-cohort-replay] failed",
      error instanceof Error ? error.message : String(error),
    );
    process.exit(1);
  });
}
