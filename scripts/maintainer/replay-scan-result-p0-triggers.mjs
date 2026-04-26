#!/usr/bin/env node
/* eslint-disable no-console */

import path from "node:path";
import {
  attachRunOrder,
  ensureDir,
  findServer5xxWindows,
  isServer5xxStatus,
  parseArgs,
  productKey,
  readJson,
  readJsonl,
  safeText,
  sleep,
  truncate,
  writeJson,
  writeText,
} from "./lib/scan-result-full-corpus-audit.mjs";

const DEFAULT_RUN_ID = "scan-result-full-corpus-core-20260425";
const DEFAULT_MANIFEST = "output/scan-result-full-corpus-audit/codex-full-corpus-manifest-20260425-v3/manifest.json";

const PERSONALIZATION_HEADER = JSON.stringify({
  profile: {
    goals: ["Sleep", "Energy", "Immunity", "Recovery", "Focus", "Stress Support"],
    preferredTypes: ["Vitamin", "Mineral", "Herb", "Probiotic", "Protein"],
  },
  savedSupplements: [],
});

const buildHeaders = ({ sse = false } = {}) => ({
  Accept: sse ? "text/event-stream" : "application/json, text/plain, */*",
  "Content-Type": "application/json",
  "x-auth-disabled": "1",
  "x-local-personalization": PERSONALIZATION_HEADER,
  "Cache-Control": "no-cache, no-store",
  Pragma: "no-cache",
});

const fetchWithTimeout = async (url, options = {}, timeoutMs = 10_000) => {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(new Error(`timeout_${timeoutMs}ms`)), timeoutMs);
  const startedAt = Date.now();
  try {
    const response = await fetch(url, { ...options, signal: controller.signal });
    const text = await response.text().catch(() => "");
    return { ok: response.ok, status: response.status, text, latencyMs: Date.now() - startedAt };
  } catch (error) {
    return { ok: false, status: 0, text: "", latencyMs: Date.now() - startedAt, error: error instanceof Error ? error.message : String(error) };
  } finally {
    clearTimeout(timeout);
  }
};

const probeHealthcheck = async (url, timeoutMs) => {
  if (!url) return { ok: null, status: null, latencyMs: null, error: "healthcheck_unavailable" };
  const response = await fetchWithTimeout(url, { headers: buildHeaders() }, timeoutMs);
  return {
    ok: response.ok,
    status: response.status,
    latencyMs: response.latencyMs,
    error: response.error ?? (!response.ok ? truncate(response.text, 220) : null),
  };
};

const detectHealthcheckUrl = async (args) => {
  if (args.healthcheckUrl) return args.healthcheckUrl;
  for (const candidate of ["/api/health", "/health", "/api/status", "/status"]) {
    const url = `${args.stagingUrl}${candidate}`;
    const probe = await probeHealthcheck(url, Math.min(args.timeoutMs, 4_000));
    if (probe.ok) return url;
  }
  return null;
};

const fetchEnrichStream = async ({ args, barcode }) => {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(new Error(`timeout_${args.timeoutMs}ms`)), args.timeoutMs);
  const startedAt = Date.now();
  const events = [];
  const rawPayloads = [];
  let terminal = null;
  let rev0Ms = null;
  let rev1Ms = null;
  let doneMs = null;
  let serverError = null;
  let latestBundle = null;
  try {
    const response = await fetch(`${args.stagingUrl}/api/enrich-stream`, {
      method: "POST",
      headers: buildHeaders({ sse: true }),
      body: JSON.stringify({ barcode }),
      signal: controller.signal,
    });
    const httpStatus = response.status;
    if (!response.ok) {
      const text = await response.text().catch(() => "");
      return { httpStatus, terminal: "HTTP_ERROR", serverError: truncate(text, 800), clientTimeout: false, latencyMs: Date.now() - startedAt, events, rev0Ms, rev1Ms, doneMs, rawPayloads, latestBundle };
    }
    if (!response.body) {
      return { httpStatus, terminal: "HTTP_ERROR", serverError: "missing_sse_body", clientTimeout: false, latencyMs: Date.now() - startedAt, events, rev0Ms, rev1Ms, doneMs, rawPayloads, latestBundle };
    }
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    let currentEvent = null;
    let currentData = "";
    const flush = () => {
      if (!currentEvent) return;
      const raw = currentData.trim();
      let payload = raw;
      try { payload = raw ? JSON.parse(raw) : null; } catch { payload = raw; }
      const elapsed = Date.now() - startedAt;
      events.push(currentEvent);
      rawPayloads.push({ event: currentEvent, elapsedMs: elapsed, payload });
      if (currentEvent === "analysis_bundle" && payload && typeof payload === "object") {
        latestBundle = payload;
        const revision = Number(payload?.meta?.revision);
        if (revision === 0 && rev0Ms == null) rev0Ms = elapsed;
        if (revision >= 1 && rev1Ms == null) rev1Ms = elapsed;
      }
      if (currentEvent === "done") {
        terminal = "DONE";
        doneMs = elapsed;
      }
      if (currentEvent === "error") {
        terminal = safeText(payload?.code ?? payload?.reasonCode ?? payload?.message) || "ERROR";
        serverError = truncate(payload?.message ?? raw, 800);
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
          flush();
          if (terminal === "DONE") break;
          continue;
        }
        if (line.startsWith("event:")) currentEvent = line.slice(6).trim();
        else if (line.startsWith("data:")) currentData += line.slice(5).trim();
      }
      if (terminal === "DONE") break;
    }
    flush();
    return { httpStatus, terminal: terminal ?? "NO_TERMINAL", serverError, clientTimeout: false, latencyMs: Date.now() - startedAt, events, rev0Ms, rev1Ms, doneMs, rawPayloads, latestBundle };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return { httpStatus: null, terminal: /timeout|abort/i.test(message) ? "CLIENT_TIMEOUT" : "REQUEST_ERROR", serverError: truncate(message, 800), clientTimeout: /timeout|abort/i.test(message), latencyMs: Date.now() - startedAt, events, rev0Ms, rev1Ms, doneMs, rawPayloads, latestBundle };
  } finally {
    clearTimeout(timeout);
  }
};

const addSelection = (map, row, reason) => {
  if (!row) return;
  const key = row.productKey || productKey(row);
  if (!key) return;
  const existing = map.get(key) ?? { row, reasons: new Set() };
  existing.reasons.add(reason);
  map.set(key, existing);
};

const selectTriggerRows = ({ rows, windows, largeWindowMin }) => {
  const byRunOrder = new Map(rows.map((row) => [Number(row.runOrder), row]));
  const selected = new Map();
  for (const row of rows.filter((item) => item.clientTimeout || item.failureClass === "client_timeout")) {
    addSelection(selected, row, "client_timeout");
  }
  for (const window of windows.filter((item) => item.count >= largeWindowMin)) {
    addSelection(selected, byRunOrder.get(window.startRunOrder - 1), `before_${window.windowId}`);
    addSelection(selected, window.rows[0], `first_${window.windowId}`);
    addSelection(selected, window.rows[Math.floor(window.rows.length / 2)], `middle_${window.windowId}`);
    addSelection(selected, window.rows.at(-1), `end_${window.windowId}`);
  }
  return [...selected.values()].map((entry) => ({ ...entry.row, replayReasons: [...entry.reasons].sort() }));
};

const classifyReplay = ({ original, attempts, healthcheck = null }) => {
  const first = attempts[0] ?? {};
  const final = attempts.at(-1) ?? {};
  const finalSucceeded = final.httpStatus === 200 && final.terminal === "DONE";
  const repeated5xx = attempts.length > 1 && attempts.every((attempt) => isServer5xxStatus(attempt.httpStatus));
  if (!original?.barcode) return "not_replayed_missing_barcode";
  if (isServer5xxStatus(healthcheck?.status)) return "service_availability_window_healthcheck_5xx";
  if (repeated5xx) return "product_specific_backend_crash_candidate";
  if (isServer5xxStatus(first.httpStatus) && finalSucceeded) return "transient_5xx_retry_recovered";
  if ((original.failureClass === "server_5xx" || isServer5xxStatus(original.httpStatus)) && finalSucceeded) return "failed_in_full_run_succeeded_in_isolation";
  if (first.clientTimeout && finalSucceeded) return "timeout_recovered_on_retry";
  if (finalSucceeded) return "isolation_success";
  if (first.clientTimeout || final.clientTimeout) return "endpoint_timeout_or_network_timeout";
  if (isServer5xxStatus(final.httpStatus)) return "server_5xx_unresolved";
  return "other_replay_failure";
};

const renderSummary = ({ args, selected, replayRows, healthcheckUrl }) => {
  const byClass = replayRows.reduce((acc, row) => {
    acc[row.replayClassification] = (acc[row.replayClassification] ?? 0) + 1;
    return acc;
  }, {});
  const repeated = replayRows.filter((row) => row.replayClassification === "product_specific_backend_crash_candidate");
  const serviceWindow = replayRows.filter((row) => /^service_availability_window/.test(row.replayClassification));
  const isolationSuccess = replayRows.filter((row) => /isolation_success|failed_in_full_run_succeeded|transient_5xx_retry_recovered|timeout_recovered/.test(row.replayClassification));
  return [
    "# P0 Trigger Replay Summary",
    "",
    `- generatedAt: ${new Date().toISOString()}`,
    `- runId: ${args.runId}`,
    `- stagingUrl: ${args.stagingUrl}`,
    `- selected triggers: ${selected.length}`,
    `- replay rows: ${replayRows.length}`,
    `- forced concurrency: 1`,
    `- maxRetries: ${args.maxRetries}`,
    `- backoffBaseMs: ${args.backoffBaseMs}`,
    `- maxConsecutive5xx: ${args.maxConsecutive5xx}`,
    `- healthcheckUrl: ${healthcheckUrl ?? "healthcheck_unavailable"}`,
    "- Render MCP evidence: not collected by this route-level replay script; use connector/log inspection separately if available.",
    "",
    "## Replay Classification",
    ...Object.entries(byClass).map(([key, count]) => `- ${key}: ${count}`),
    "",
    "## Preliminary Interpretation",
    `- service-window healthcheck failures: ${serviceWindow.length}`,
    `- isolation successes: ${isolationSuccess.length}`,
    `- repeated isolated 5xx candidates: ${repeated.length}`,
    serviceWindow.length > 0
      ? "- Healthcheck also returned 5xx during replay, so current evidence points to a service availability window rather than product-specific payload crashes."
      : repeated.length > 0
      ? "- Evidence includes product-specific backend crash candidates; inspect server logs for those exact barcodes."
      : "- No repeated isolated 5xx candidate was observed in this replay set; that points away from thousands of independent product bugs and toward service-window/load/harness behavior, subject to Render log evidence.",
    "",
    "## Replayed Products",
    ...replayRows.map((row) => `- ${row.replayClassification} | ${row.productKey} | reasons=${row.replayReasons.join("+")} | final=${row.finalHttpStatus}/${row.finalTerminal} | retry=${row.retryCount}`),
    "",
  ].join("\n");
};

const main = async () => {
  const args = parseArgs(process.argv.slice(2), {
    runId: DEFAULT_RUN_ID,
    manifestPath: DEFAULT_MANIFEST,
    mode: "p0-trigger-replay",
    concurrency: 1,
    maxRetries: 2,
    backoffBaseMs: 2_000,
    maxConsecutive5xx: 3,
    circuitBreakerSleepMs: 60_000,
    timeoutMs: 45_000,
    largeWindowMin: 5,
  });
  args.concurrency = 1;
  await ensureDir(args.runDir);
  const outPath = path.join(args.runDir, "p0-trigger-replay-results.jsonl");
  if (args.resume) {
    const existingRows = await readJsonl(outPath);
    if (existingRows.length > 0) {
      const replayRows = existingRows.map((row) => ({
        ...row,
        replayClassification: classifyReplay({ original: row, attempts: row.attempts ?? [], healthcheck: row.healthcheck }),
      }));
      await writeText(outPath, replayRows.map((row) => JSON.stringify(row)).join("\n") + "\n");
      await writeJson(path.join(args.runDir, "p0-trigger-replay-summary.json"), {
        reportType: "p0_trigger_replay_summary",
        generatedAt: new Date().toISOString(),
        runId: args.runId,
        selected: replayRows.length,
        healthcheckUrl: replayRows.find((row) => row.healthcheck)?.healthcheck?.url ?? null,
        replayRows,
      });
      await writeText(path.join(args.runDir, "p0-trigger-replay-summary.md"), renderSummary({ args, selected: replayRows, replayRows, healthcheckUrl: null }));
      console.log(`[p0-trigger-replay] resume regenerated report rows=${replayRows.length}`);
      return;
    }
  } else {
    await writeText(outPath, "");
  }
  const manifest = await readJson(args.manifestPath);
  const rawCoreRows = await readJsonl(path.join(args.runDir, "core-results.jsonl"));
  const rows = attachRunOrder(rawCoreRows, manifest.products ?? []);
  const windows = findServer5xxWindows(rows, { largeWindowMin: args.largeWindowMin });
  let selected = selectTriggerRows({ rows, windows, largeWindowMin: args.largeWindowMin });
  if (args.limit) selected = selected.slice(0, args.limit);
  const healthcheckUrl = await detectHealthcheckUrl(args);
  const replayRows = [];
  let consecutive5xx = 0;

  for (const [index, row] of selected.entries()) {
    if (consecutive5xx >= args.maxConsecutive5xx && args.circuitBreakerSleepMs > 0) {
      console.error(`[p0-trigger-replay] circuit breaker sleeping ${args.circuitBreakerSleepMs}ms after ${consecutive5xx} consecutive 5xx`);
      await sleep(args.circuitBreakerSleepMs);
      consecutive5xx = 0;
    }
    const healthcheck = await probeHealthcheck(healthcheckUrl, Math.min(args.timeoutMs, 6_000));
    const attempts = [];
    if (!row.barcode) {
      const replayRow = {
        productKey: row.productKey,
        productId: row.productId,
        barcode: row.barcode,
        productName: row.productName,
        brand: row.brand,
        family: row.family,
        sourceTier: row.sourceTier,
        factsStatus: row.factsStatus,
        runOrder: row.runOrder,
        replayReasons: row.replayReasons,
        healthcheck,
        retryCount: 0,
        initialHttpStatus: null,
        finalHttpStatus: null,
        finalTerminal: "NOT_REPLAYED",
        attempts,
        replayClassification: "not_replayed_missing_barcode",
      };
      replayRows.push(replayRow);
      await fsAppendJsonl(outPath, replayRow);
      continue;
    }
    console.error(`[p0-trigger-replay] ${index + 1}/${selected.length} ${row.productKey} ${row.replayReasons.join("+")}`);
    for (let attempt = 0; attempt <= args.maxRetries; attempt += 1) {
      const result = await fetchEnrichStream({ args, barcode: row.barcode });
      attempts.push({
        attempt,
        httpStatus: result.httpStatus,
        terminal: result.terminal,
        serverError: result.serverError,
        clientTimeout: result.clientTimeout,
        latencyMs: result.latencyMs,
        rev0Ms: result.rev0Ms,
        rev1Ms: result.rev1Ms,
        doneMs: result.doneMs,
        events: result.events,
      });
      if (!isServer5xxStatus(result.httpStatus) && !result.clientTimeout) break;
      if (attempt < args.maxRetries) await sleep(args.backoffBaseMs * (2 ** attempt));
    }
    const final = attempts.at(-1) ?? {};
    consecutive5xx = isServer5xxStatus(final.httpStatus) ? consecutive5xx + 1 : 0;
    const replayRow = {
      productKey: row.productKey,
      productId: row.productId,
      barcode: row.barcode,
      productName: row.productName,
      brand: row.brand,
      family: row.family,
      sourceTier: row.sourceTier,
      factsStatus: row.factsStatus,
      runOrder: row.runOrder,
      observedLine: row.observedLine,
      originalFailureClass: row.failureClass,
      originalHttpStatus: row.finalHttpStatus ?? row.httpStatus ?? null,
      originalTerminal: row.terminal,
      replayReasons: row.replayReasons,
      healthcheck,
      retryCount: Math.max(0, attempts.length - 1),
      initialHttpStatus: attempts[0]?.httpStatus ?? null,
      finalHttpStatus: final.httpStatus ?? null,
      finalTerminal: final.terminal ?? null,
      finalServerError: final.serverError ?? null,
      attempts,
    };
    replayRow.replayClassification = classifyReplay({ original: row, attempts, healthcheck });
    replayRows.push(replayRow);
    await fsAppendJsonl(outPath, replayRow);
  }

  await writeJson(path.join(args.runDir, "p0-trigger-replay-summary.json"), {
    reportType: "p0_trigger_replay_summary",
    generatedAt: new Date().toISOString(),
    runId: args.runId,
    selected: selected.length,
    healthcheckUrl,
    replayRows,
  });
  await writeText(path.join(args.runDir, "p0-trigger-replay-summary.md"), renderSummary({ args, selected, replayRows, healthcheckUrl }));
  console.log(`[p0-trigger-replay] complete runId=${args.runId} selected=${selected.length}`);
};

const fsAppendJsonl = async (filePath, row) => {
  await ensureDir(path.dirname(filePath));
  const fsModule = await import("node:fs/promises");
  await fsModule.appendFile(filePath, `${JSON.stringify(row)}\n`);
};

main().catch((error) => {
  console.error("[p0-trigger-replay] failed", error instanceof Error ? error.stack || error.message : String(error));
  process.exitCode = 1;
});
