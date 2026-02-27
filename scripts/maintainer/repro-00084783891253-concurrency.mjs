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
  node scripts/maintainer/repro-00084783891253-concurrency.mjs [options]

Options:
  --barcode <gtin14>          Target barcode (default: 00084783891253)
  --single-rounds <n>         Serial rounds (default: 20)
  --parallel5-rounds <n>      Parallel-5 rounds (default: 20)
  --parallel9-rounds <n>      Parallel-9 rounds (default: 20)
  --sse-timeout-ms <ms>       Request timeout (default: 45000)
  --stream-mode <mode>        Optional stream mode
  --out-file <path>           JSON output path (default: output/maintainer-gates/<ts>/00084783891253_concurrency_repro.json)
`);
  process.exit(0);
}

const nowTag = new Date().toISOString().replace(/[:.]/g, "-");
const API_BASE_URL =
  getArg("api-base-url") ||
  process.env.API_BASE_URL ||
  process.env.RENDER_BASE_URL ||
  "http://127.0.0.1:3001";
const REGRESSION_TOKEN = process.env.RENDER_REGRESSION_TOKEN || process.env.REGRESSION_AUTH_TOKEN || "";
const barcode = String(getArg("barcode") || process.env.REPRO_000847_BARCODE || "00084783891253");
const singleRounds = Number(getArg("single-rounds") || process.env.REPRO_000847_SINGLE_ROUNDS || 20);
const parallel5Rounds = Number(getArg("parallel5-rounds") || process.env.REPRO_000847_PARALLEL5_ROUNDS || 20);
const parallel9Rounds = Number(getArg("parallel9-rounds") || process.env.REPRO_000847_PARALLEL9_ROUNDS || 20);
const sseTimeoutMs = Number(getArg("sse-timeout-ms") || process.env.REPRO_000847_SSE_TIMEOUT_MS || 45000);
const streamMode = String(getArg("stream-mode") || process.env.REPRO_000847_STREAM_MODE || "").trim();
const outFileArg = getArg("out-file") || process.env.REPRO_000847_OUT_FILE || "";
const outFile = (() => {
  if (outFileArg.trim()) {
    return path.isAbsolute(outFileArg) ? outFileArg : path.join(ROOT_DIR, outFileArg);
  }
  return path.join(
    ROOT_DIR,
    "output",
    "maintainer-gates",
    nowTag,
    "00084783891253_concurrency_repro.json",
  );
})();

const headers = {
  "Content-Type": "application/json",
  Accept: "text/event-stream",
  ...(REGRESSION_TOKEN ? { "x-regression-token": REGRESSION_TOKEN } : { "x-auth-disabled": "1" }),
};

const toGtin14 = (value) => {
  const digits = String(value ?? "").replace(/\D/g, "");
  if (digits.length === 14) return digits;
  if (digits.length === 13) return `0${digits}`;
  if (digits.length === 12) return `00${digits}`;
  return digits;
};

const normalizeTerminalFromErrorPayload = (payload) => {
  if (!payload || typeof payload !== "object") return null;
  const code = typeof payload.code === "string" ? payload.code.trim().toUpperCase() : "";
  if (code) return code;
  const message = typeof payload.message === "string" ? payload.message.trim() : "";
  if (message === "Product not found") return "NOT_FOUND";
  return null;
};

const extractMetaObservation = (meta) => {
  if (!meta || typeof meta !== "object") return null;
  const pick = (obj, key) => {
    if (!obj || typeof obj !== "object") return null;
    return Object.prototype.hasOwnProperty.call(obj, key) ? obj[key] : null;
  };
  const cacheKeys = [
    "cacheHit",
    "negativeCacheHit",
    "resolutionCacheHit",
    "identityCacheHit",
    "sourceCacheHit",
    "datasetCacheHit",
    "fastPathCacheHit",
    "stage0CacheHit",
  ];
  const cache = {};
  cacheKeys.forEach((key) => {
    const value = pick(meta, key);
    if (
      typeof value === "boolean" ||
      typeof value === "string" ||
      typeof value === "number"
    ) {
      cache[key] = value;
    }
  });
  return {
    phase: typeof meta.phase === "string" ? meta.phase : null,
    sourceType: typeof meta.sourceType === "string" ? meta.sourceType : null,
    sourceTypeFinal:
      typeof meta.sourceTypeFinal === "boolean" ? meta.sourceTypeFinal : null,
    terminalReason:
      typeof meta.terminalReason === "string" && meta.terminalReason.trim()
        ? meta.terminalReason.trim()
        : null,
    degradedMode:
      typeof meta.degradedMode === "boolean" ? meta.degradedMode : null,
    stage0Winner:
      typeof meta.stage0Winner === "string" && meta.stage0Winner.trim()
        ? meta.stage0Winner.trim()
        : null,
    stage0StartCount:
      Number.isFinite(Number(meta.stage0StartCount)) ? Number(meta.stage0StartCount) : null,
    stage0ReplaceCount:
      Number.isFinite(Number(meta.stage0ReplaceCount)) ? Number(meta.stage0ReplaceCount) : null,
    scoreAvailable:
      typeof meta.scoreAvailable === "boolean" ? meta.scoreAvailable : null,
    fallbackReason:
      (typeof meta.fallbackReason === "string" && meta.fallbackReason) ||
      (typeof meta.fallback?.code === "string" && meta.fallback.code) ||
      null,
    authorityFailureReason:
      (typeof meta.authorityFailureReason === "string" && meta.authorityFailureReason) ||
      (typeof meta.authority_failure_reason === "string" && meta.authority_failure_reason) ||
      null,
    authoritativeIdentity:
      meta.authoritativeIdentity && typeof meta.authoritativeIdentity === "object"
        ? {
            type:
              typeof meta.authoritativeIdentity.type === "string"
                ? meta.authoritativeIdentity.type
                : null,
            value:
              typeof meta.authoritativeIdentity.value === "string"
                ? meta.authoritativeIdentity.value
                : null,
          }
        : null,
    cache,
  };
};

const isAuthoritativeSourceType = (value) => {
  const normalized = String(value ?? "").trim().toLowerCase();
  return normalized === "lnhpd" || normalized === "dsld";
};

const isAuthoritativeIdentityType = (value) => {
  const normalized = String(value ?? "").trim().toLowerCase();
  return (
    normalized === "npn" ||
    normalized === "lnhpdnpn" ||
    normalized === "dsldlabelid" ||
    normalized === "dsld_label_id"
  );
};

const deriveAuthoritativeCandidateObservation = ({
  sourceType,
  sourceTypeFinal,
  identityType,
  stage0Winner,
}) => {
  const evidence = [];
  if (isAuthoritativeSourceType(sourceType)) {
    evidence.push(`sourceType:${sourceType}`);
  }
  if (sourceTypeFinal === true && isAuthoritativeSourceType(sourceType)) {
    evidence.push(`sourceTypeFinal:${sourceType}`);
  }
  if (isAuthoritativeIdentityType(identityType)) {
    evidence.push(`identityType:${identityType}`);
  }
  const stage0 = String(stage0Winner ?? "").trim().toLowerCase();
  if (stage0 === "verified_regulatory" || stage0 === "label_record" || stage0 === "lnhpd_candidate") {
    evidence.push(`stage0Winner:${stage0}`);
  }
  return {
    found: evidence.length > 0,
    evidence,
  };
};

const latencyStats = (values) => {
  const list = values.filter((value) => Number.isFinite(value)).sort((a, b) => a - b);
  if (!list.length) {
    return { count: 0, p50: null, p90: null, p95: null, max: null, avg: null };
  }
  const pick = (q) => list[Math.floor((list.length - 1) * q)] ?? null;
  const avg = list.reduce((acc, value) => acc + value, 0) / list.length;
  return {
    count: list.length,
    p50: pick(0.5),
    p90: pick(0.9),
    p95: pick(0.95),
    max: list[list.length - 1] ?? null,
    avg: Number(avg.toFixed(1)),
  };
};

const summarize = (rows) => {
  const terminalBreakdown = rows.reduce((acc, row) => {
    const key = row.terminal || "NO_TERMINAL";
    acc[key] = (acc[key] ?? 0) + 1;
    return acc;
  }, {});
  const doneCount = terminalBreakdown.DONE ?? 0;
  const notFoundCount = terminalBreakdown.NOT_FOUND ?? 0;
  const identityNullCount = rows.filter(
    (row) => !row.requestContext?.authoritativeIdentity?.value,
  ).length;
  const sourceTypeNullCount = rows.filter(
    (row) => !row.requestContext?.sourceType,
  ).length;
  const sourceTypeFinalTrueCount = rows.filter((row) => row?.requestContext?.sourceTypeFinal === true).length;
  const sourceTypeFinalFalseCount = rows.filter((row) => row?.requestContext?.sourceTypeFinal === false).length;
  const authoritativeCandidateFoundCount = rows.filter(
    (row) => row?.requestContext?.authoritativeCandidateFound === true,
  ).length;
  const stage0WinnerCounts = rows.reduce((acc, row) => {
    const key =
      typeof row?.requestContext?.stage0Winner === "string" && row.requestContext.stage0Winner.trim()
        ? row.requestContext.stage0Winner.trim()
        : "UNKNOWN";
    acc[key] = (acc[key] ?? 0) + 1;
    return acc;
  }, {});
  const terminalReasonCounts = rows.reduce((acc, row) => {
    const key =
      typeof row?.requestContext?.terminalReason === "string" && row.requestContext.terminalReason.trim()
        ? row.requestContext.terminalReason.trim()
        : "null";
    acc[key] = (acc[key] ?? 0) + 1;
    return acc;
  }, {});
  return {
    total: rows.length,
    terminalBreakdown,
    doneRate: rows.length ? Number((doneCount / rows.length).toFixed(3)) : 0,
    notFoundRate: rows.length ? Number((notFoundCount / rows.length).toFixed(3)) : 0,
    identityNullRate: rows.length ? Number((identityNullCount / rows.length).toFixed(3)) : 0,
    sourceTypeNullRate: rows.length ? Number((sourceTypeNullCount / rows.length).toFixed(3)) : 0,
    sourceTypeFinalTrueRate: rows.length ? Number((sourceTypeFinalTrueCount / rows.length).toFixed(3)) : 0,
    sourceTypeFinalFalseRate: rows.length ? Number((sourceTypeFinalFalseCount / rows.length).toFixed(3)) : 0,
    authoritativeCandidateFoundRate: rows.length
      ? Number((authoritativeCandidateFoundCount / rows.length).toFixed(3))
      : 0,
    stage0WinnerCounts,
    terminalReasonCounts,
    latency: {
      doneMs: latencyStats(rows.map((row) => row.doneMs)),
      rev1Ms: latencyStats(rows.map((row) => row.rev1Ms)),
    },
  };
};

const runOne = async (inputBarcode) => {
  const ctrl = new AbortController();
  const timeout = setTimeout(() => ctrl.abort(new Error(`timeout_${sseTimeoutMs}ms`)), sseTimeoutMs);
  const startedAt = Date.now();
  const payload = { barcode: toGtin14(inputBarcode) };
  if (streamMode) payload.streamMode = streamMode;

  let timedOut = false;
  let rev0Ms = null;
  let rev1Ms = null;
  let doneMs = null;
  let requestId = null;
  let doneSeen = false;
  let lastBundleMeta = null;
  let rev1Identity = null;
  let doneMeta = null;
  const errorEvents = [];

  try {
    const res = await fetch(`${API_BASE_URL}/api/enrich-stream`, {
      method: "POST",
      headers,
      body: JSON.stringify(payload),
      signal: ctrl.signal,
    });
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      return {
        barcode: payload.barcode,
        terminal: "HTTP_ERROR",
        timedOut: false,
        error: `http_${res.status}:${text.slice(0, 180)}`,
      };
    }
    if (!res.body) {
      return {
        barcode: payload.barcode,
        terminal: "HTTP_ERROR",
        timedOut: false,
        error: "sse_body_missing",
      };
    }

    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    let currentEvent = null;
    let currentData = "";

    const flushEvent = () => {
      if (!currentEvent) return;
      const raw = currentData.trim();
      if (!raw) {
        currentEvent = null;
        currentData = "";
        return;
      }
      let data = raw;
      try {
        data = JSON.parse(raw);
      } catch {
        // ignore
      }
      const tMs = Date.now() - startedAt;
      if (data && typeof data === "object" && !requestId) {
        requestId =
          (typeof data?.requestId === "string" && data.requestId) ||
          (typeof data?.request_id === "string" && data.request_id) ||
          (typeof data?.meta?.requestId === "string" && data.meta.requestId) ||
          (typeof data?.meta?.request_id === "string" && data.meta.request_id) ||
          null;
      }
      if (currentEvent === "analysis_bundle" && data && typeof data === "object") {
        const revision = Number(data?.meta?.revision);
        if (revision === 0 && rev0Ms == null) rev0Ms = tMs;
        if (revision >= 1 && rev1Ms == null) rev1Ms = tMs;
        if (data?.meta && typeof data.meta === "object") {
          lastBundleMeta = data.meta;
          if (revision >= 1 && !rev1Identity) {
            rev1Identity = {
              sourceType:
                typeof data.meta.sourceType === "string" ? data.meta.sourceType : null,
              sourceTypeFinal:
                typeof data.meta.sourceTypeFinal === "boolean"
                  ? data.meta.sourceTypeFinal
                  : null,
              identityType:
                typeof data.meta?.authoritativeIdentity?.type === "string"
                  ? data.meta.authoritativeIdentity.type
                  : null,
              identityValue:
                typeof data.meta?.authoritativeIdentity?.value === "string"
                  ? data.meta.authoritativeIdentity.value
                  : null,
              terminalReason:
                typeof data.meta.terminalReason === "string" ? data.meta.terminalReason : null,
              degradedMode:
                typeof data.meta.degradedMode === "boolean" ? data.meta.degradedMode : null,
              stage0Winner:
                typeof data.meta.stage0Winner === "string" ? data.meta.stage0Winner : null,
              stage0StartCount:
                Number.isFinite(Number(data.meta.stage0StartCount))
                  ? Number(data.meta.stage0StartCount)
                  : null,
              stage0ReplaceCount:
                Number.isFinite(Number(data.meta.stage0ReplaceCount))
                  ? Number(data.meta.stage0ReplaceCount)
                  : null,
            };
          }
        }
      }
      if (currentEvent === "error") {
        errorEvents.push({
          tMs,
          terminal: normalizeTerminalFromErrorPayload(data) ?? "ERROR",
          code: typeof data?.code === "string" ? data.code : null,
          reasonCode: typeof data?.reasonCode === "string" ? data.reasonCode : null,
          stage: typeof data?.stage === "string" ? data.stage : null,
          message: typeof data?.message === "string" ? data.message : null,
        });
      }
      if (currentEvent === "done") {
        if (data && typeof data === "object") {
          doneMeta = {
            reason:
              typeof data.reason === "string" && data.reason.trim()
                ? data.reason.trim()
                : null,
            terminalReason:
              typeof data.terminalReason === "string" && data.terminalReason.trim()
                ? data.terminalReason.trim()
                : null,
            degradedMode:
              typeof data.degradedMode === "boolean" ? data.degradedMode : null,
            stage0Winner:
              typeof data.stage0Winner === "string" && data.stage0Winner.trim()
                ? data.stage0Winner.trim()
                : null,
            stage0StartCount:
              Number.isFinite(Number(data.stage0StartCount)) ? Number(data.stage0StartCount) : null,
            stage0ReplaceCount:
              Number.isFinite(Number(data.stage0ReplaceCount)) ? Number(data.stage0ReplaceCount) : null,
          };
        }
        doneSeen = true;
        doneMs = tMs;
      }
      currentEvent = null;
      currentData = "";
    };

    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split(/\r?\n/);
      buffer = lines.pop() ?? "";
      for (const line of lines) {
        if (!line.trim()) {
          flushEvent();
          if (doneSeen) break;
          continue;
        }
        if (line.startsWith("event:")) currentEvent = line.slice("event:".length).trim();
        if (line.startsWith("data:")) currentData += line.slice("data:".length).trim();
      }
      if (doneSeen) break;
    }
    flushEvent();

    const lastErrorTerminal =
      [...errorEvents].reverse().find((event) => event.terminal)?.terminal ?? null;
    const terminal = doneSeen ? "DONE" : lastErrorTerminal ?? "NO_TERMINAL";
    const metaObservation = extractMetaObservation(lastBundleMeta);
    const sourceType = rev1Identity?.sourceType ?? metaObservation?.sourceType ?? null;
    const sourceTypeFinal =
      rev1Identity?.sourceTypeFinal ?? metaObservation?.sourceTypeFinal ?? null;
    const identityType = rev1Identity?.identityType ?? null;
    const identityValue = rev1Identity?.identityValue ?? null;
    const stage0Winner =
      doneMeta?.stage0Winner ?? rev1Identity?.stage0Winner ?? metaObservation?.stage0Winner ?? null;
    const stage0StartCount =
      doneMeta?.stage0StartCount ??
      rev1Identity?.stage0StartCount ??
      metaObservation?.stage0StartCount ??
      null;
    const stage0ReplaceCount =
      doneMeta?.stage0ReplaceCount ??
      rev1Identity?.stage0ReplaceCount ??
      metaObservation?.stage0ReplaceCount ??
      null;
    const terminalReason =
      doneMeta?.terminalReason ??
      doneMeta?.reason ??
      rev1Identity?.terminalReason ??
      metaObservation?.terminalReason ??
      null;
    const degradedMode =
      typeof doneMeta?.degradedMode === "boolean"
        ? doneMeta.degradedMode
        : typeof rev1Identity?.degradedMode === "boolean"
          ? rev1Identity.degradedMode
          : typeof metaObservation?.degradedMode === "boolean"
            ? metaObservation.degradedMode
            : null;
    const authoritativeCandidate = deriveAuthoritativeCandidateObservation({
      sourceType,
      sourceTypeFinal,
      identityType,
      stage0Winner,
    });

    return {
      barcode: payload.barcode,
      terminal,
      timedOut,
      elapsedMs: Date.now() - startedAt,
      rev0Ms,
      rev1Ms,
      doneMs,
      errorEvents,
      metaObservation,
      doneMeta,
      requestContext: {
        requestId,
        terminal,
        sourceType,
        sourceTypeFinal,
        terminalReason,
        degradedMode,
        stage0Winner,
        stage0StartCount,
        stage0ReplaceCount,
        authoritativeCandidateFound: authoritativeCandidate.found,
        authoritativeCandidateEvidence: authoritativeCandidate.evidence,
        authoritativeIdentity:
          identityType || identityValue
            ? {
                type: identityType ?? null,
                value: identityValue ?? null,
              }
            : null,
      },
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    timedOut = message.includes("timeout_");
    const terminal = timedOut ? "CLIENT_TIMEOUT" : "REQUEST_ERROR";
    return {
      barcode: payload.barcode,
      terminal,
      timedOut,
      elapsedMs: Date.now() - startedAt,
      error: message,
      errorEvents,
      requestContext: {
        requestId,
        terminal,
        sourceType: null,
        sourceTypeFinal: null,
        terminalReason: null,
        degradedMode: null,
        stage0Winner: null,
        stage0StartCount: null,
        stage0ReplaceCount: null,
        authoritativeCandidateFound: false,
        authoritativeCandidateEvidence: [],
        authoritativeIdentity: null,
      },
      metaObservation: extractMetaObservation(lastBundleMeta),
      doneMeta,
    };
  } finally {
    clearTimeout(timeout);
  }
};

const runScenario = async (name, rounds, parallel) => {
  const rows = [];
  for (let round = 1; round <= rounds; round += 1) {
    if (parallel <= 1) {
      // eslint-disable-next-line no-await-in-loop
      const result = await runOne(barcode);
      rows.push({ scenario: name, round, slot: 1, ...result });
      continue;
    }
    // eslint-disable-next-line no-await-in-loop
    const batch = await Promise.all(Array.from({ length: parallel }, () => runOne(barcode)));
    batch.forEach((result, index) => {
      rows.push({ scenario: name, round, slot: index + 1, ...result });
    });
  }
  return rows;
};

const main = async () => {
  await fs.mkdir(path.dirname(outFile), { recursive: true });

  console.log(
    `[repro-000847] target=${toGtin14(barcode)} single=${singleRounds} parallel5=${parallel5Rounds} parallel9=${parallel9Rounds}`,
  );

  const allRows = [];
  const singleRows = await runScenario("single20", singleRounds, 1);
  allRows.push(...singleRows);
  const p5Rows = await runScenario("parallel5", parallel5Rounds, 5);
  allRows.push(...p5Rows);
  const p9Rows = await runScenario("parallel9", parallel9Rounds, 9);
  allRows.push(...p9Rows);

  const byScenario = {
    single20: summarize(singleRows),
    parallel5: summarize(p5Rows),
    parallel9: summarize(p9Rows),
  };

  const report = {
    generatedAt: new Date().toISOString(),
    apiBaseUrl: API_BASE_URL,
    config: {
      barcode: toGtin14(barcode),
      singleRounds,
      parallel5Rounds,
      parallel9Rounds,
      sseTimeoutMs,
      streamMode: streamMode || null,
    },
    summary: byScenario,
    runs: allRows,
  };

  await fs.writeFile(outFile, JSON.stringify(report, null, 2), "utf8");

  console.log(`[repro-000847] wrote ${outFile}`);
  Object.entries(byScenario).forEach(([name, summary]) => {
    console.log(
      `[repro-000847] ${name} total=${summary.total} doneRate=${summary.doneRate} notFoundRate=${summary.notFoundRate} sourceTypeFinalTrueRate=${summary.sourceTypeFinalTrueRate} authoritativeCandidateFoundRate=${summary.authoritativeCandidateFoundRate} terminals=${JSON.stringify(
        summary.terminalBreakdown,
      )} terminalReasons=${JSON.stringify(summary.terminalReasonCounts)}`,
    );
  });
};

main().catch((error) => {
  console.error("[repro-000847] failed", error instanceof Error ? error.message : error);
  process.exit(1);
});
