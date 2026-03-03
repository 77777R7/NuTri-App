#!/usr/bin/env node
/* eslint-disable no-console */

import fs from "node:fs/promises";
import path from "node:path";

import dotenv from "dotenv";

const ROOT_DIR = process.cwd();
dotenv.config({ path: path.join(ROOT_DIR, "backend", ".env") });
dotenv.config({ path: path.join(ROOT_DIR, ".env") });

const API_BASE_URL = process.env.API_BASE_URL || process.env.RENDER_BASE_URL || "http://127.0.0.1:3001";
const REGRESSION_TOKEN = process.env.RENDER_REGRESSION_TOKEN || process.env.REGRESSION_AUTH_TOKEN || "";
const SSE_TIMEOUT_MS = Number(process.env.ENRICH_STREAM_GATE_SSE_TIMEOUT_MS ?? 45000);
const OUTPUT_DIR = (() => {
  const override = process.env.ENRICH_STREAM_GATE_OUT_DIR ? String(process.env.ENRICH_STREAM_GATE_OUT_DIR) : "";
  if (!override.trim()) return path.join(ROOT_DIR, "output", `enrich-stream-concurrency-gate-${Date.now()}`);
  return path.isAbsolute(override) ? override : path.join(ROOT_DIR, override);
})();
const STREAM_MODE = String(process.env.ENRICH_STREAM_GATE_STREAM_MODE ?? "").trim();

const MUST_DONE_BARCODES = new Set(
  String(process.env.ENRICH_STREAM_GATE_MUST_DONE_BARCODES ?? "00084783891253")
    .split(",")
    .map((value) => toGtin14(value))
    .filter(Boolean),
);

const PARALLEL9_DONE_P95_MAX_MS = Number(process.env.ENRICH_STREAM_GATE_PARALLEL9_DONE_P95_MAX_MS ?? 1500);
const PARALLEL9_NOT_FOUND_REV1_P95_MAX_MS = Number(
  process.env.ENRICH_STREAM_GATE_PARALLEL9_NOT_FOUND_REV1_P95_MAX_MS ?? 1700,
);
const ANALYSIS_BUNDLE_PAYLOAD_WARN_BYTES = Number(
  process.env.ENRICH_STREAM_GATE_PAYLOAD_WARN_BYTES ?? 64 * 1024,
);
const ANALYSIS_BUNDLE_PAYLOAD_FAIL_BYTES = Number(
  process.env.ENRICH_STREAM_GATE_PAYLOAD_FAIL_BYTES ?? 80 * 1024,
);
const ANALYSIS_BUNDLE_PAYLOAD_TOPN = Math.max(
  3,
  Number(process.env.ENRICH_STREAM_GATE_PAYLOAD_TOPN ?? 8),
);
const CONTRACT_BARCODE_000646 = toGtin14(
  process.env.ENRICH_STREAM_GATE_CONTRACT_BARCODE ?? "00064642061379",
);
const CONTRACT_ROUNDS = Math.max(1, Number(process.env.ENRICH_STREAM_GATE_CONTRACT_ROUNDS ?? 5));

const ALLOWED_TERMINALS = new Set(["DONE", "NOT_FOUND", "STREAM_TIMEOUT", "STREAM_BUSY"]);

const headers = {
  "Content-Type": "application/json",
  Accept: "text/event-stream",
  ...(REGRESSION_TOKEN ? { "x-regression-token": REGRESSION_TOKEN } : { "x-auth-disabled": "1" }),
};

const BARCODES_9 = [
  "00035046009144",
  "00064435130763",
  "00074312131851",
  "00084783891253",
  "00649908268756",
  "00782932123261",
  "00812259003042",
  "00851005007163",
  "00851335007154",
];

const SCENARIOS = [
  { name: "parallel2", rounds: 5, barcodes: BARCODES_9.slice(0, 2), mode: "parallel" },
  { name: "parallel5", rounds: 5, barcodes: BARCODES_9.slice(0, 5), mode: "parallel" },
  { name: "parallel9", rounds: 5, barcodes: BARCODES_9.slice(0, 9), mode: "parallel" },
  { name: "post-stress-single", rounds: 10, barcodes: [BARCODES_9[1]], mode: "serial" },
  { name: "contract-000646-serial", rounds: CONTRACT_ROUNDS, barcodes: [CONTRACT_BARCODE_000646], mode: "serial" },
];

function toGtin14(value) {
  const digits = String(value ?? "").replace(/\D/g, "");
  if (digits.length === 14) return digits;
  if (digits.length === 13) return `0${digits}`;
  if (digits.length === 12) return `00${digits}`;
  return digits;
}

function normalizeTerminalFromErrorPayload(payload) {
  if (!payload || typeof payload !== "object") return null;
  const code = typeof payload.code === "string" ? payload.code.trim().toUpperCase() : "";
  if (code) return code;
  const message = typeof payload.message === "string" ? payload.message.trim() : "";
  if (message === "Product not found") return "NOT_FOUND";
  return null;
}

function latencyStats(rows) {
  const values = rows.filter((value) => Number.isFinite(value)).sort((a, b) => a - b);
  if (!values.length) {
    return { count: 0, p50: null, p90: null, p95: null, max: null, avg: null };
  }
  const pick = (quantile) => values[Math.floor((values.length - 1) * quantile)] ?? null;
  const avg = values.reduce((acc, value) => acc + value, 0) / values.length;
  return {
    count: values.length,
    p50: pick(0.5),
    p90: pick(0.9),
    p95: pick(0.95),
    max: values[values.length - 1] ?? null,
    avg: Number(avg.toFixed(1)),
  };
}

function toCountKey(value, fallback = "UNKNOWN") {
  if (value == null) return fallback;
  const text = String(value).trim();
  return text ? text : fallback;
}

function inferAdmissionLane(streamMode) {
  const normalized = typeof streamMode === "string" ? streamMode.trim().toLowerCase() : "";
  return normalized === "analysis_bundle_only" ? "bundle_only" : "full";
}

function toFiniteNumber(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function normalizeProductIdentity(value) {
  if (!value || typeof value !== "object") return null;
  const name = typeof value?.name === "string" ? value.name.trim() : "";
  const brand = typeof value?.brand === "string" ? value.brand.trim() : "";
  const sourceAttribution =
    typeof value?.sourceAttribution === "string" ? value.sourceAttribution.trim() : "";
  const sourceId = typeof value?.sourceId === "string" ? value.sourceId.trim() : "";
  const identityStable = typeof value?.identityStable === "boolean" ? value.identityStable : null;
  if (!name && !brand && !sourceAttribution && !sourceId && identityStable == null) return null;
  return {
    name: name || null,
    brand: brand || null,
    sourceAttribution: sourceAttribution || null,
    identityStable,
    sourceId: sourceId || null,
  };
}

function inferSourceTypeFromAttribution(sourceAttribution) {
  const normalized = typeof sourceAttribution === "string" ? sourceAttribution.trim().toLowerCase() : "";
  if (normalized === "verified_regulatory") return "regulatory";
  if (normalized === "label_record") return "label";
  if (normalized === "web_hint_unverified") return "web";
  return null;
}

function isBackendUnavailableMessage(message) {
  if (!message) return false;
  return /(fetch failed|econnrefused|econnreset|socket hang up|networkerror|enotfound|eai_again|backend unavailable)/i.test(
    String(message),
  );
}

function buildRowDiagnostics(row) {
  const identityValue =
    row?.requestContext?.authoritativeIdentity?.value ??
    row?.rev1Identity?.identityValue ??
    null;
  const sourceType =
    row?.requestContext?.sourceType ??
    row?.rev1Identity?.sourceType ??
    null;
  const requestError =
    row?.terminal === "REQUEST_ERROR" ||
    row?.terminal === "HTTP_ERROR" ||
    Boolean(row?.error);
  const backendUnavailable = requestError && isBackendUnavailableMessage(row?.error ?? null);
  const noiseFlags = {
    identityNull: !identityValue,
    sourceTypeNull: !sourceType,
    requestError,
    backendUnavailable,
  };

  let failureClass = null;
  if (row?.terminal === "DONE") {
    failureClass = null;
  } else if (row?.timedOut || row?.terminal === "CLIENT_TIMEOUT") {
    failureClass = "client_timeout";
  } else if (backendUnavailable) {
    failureClass = "infra_process";
  } else if (row?.terminal === "NOT_FOUND") {
    failureClass = "data_gap";
  } else if (requestError) {
    failureClass = "stream_flow";
  } else if (row?.terminal && row.terminal !== "DONE") {
    failureClass = "stream_flow";
  } else {
    failureClass = "unknown";
  }

  return {
    failureClass,
    noiseFlags,
  };
}

function jsonByteLength(value) {
  try {
    return Buffer.byteLength(JSON.stringify(value ?? null), "utf8");
  } catch {
    return 0;
  }
}

function collectPayloadFieldSizes(value, pathPrefix, depth = 0) {
  if (value == null || depth > 6) return [];
  if (typeof value !== "object") return [];

  const rows = [];
  if (Array.isArray(value)) {
    value.forEach((entry, index) => {
      const childPath = `${pathPrefix}[${index}]`;
      const childBytes = jsonByteLength(entry);
      rows.push({ path: childPath, bytes: childBytes });
      rows.push(...collectPayloadFieldSizes(entry, childPath, depth + 1));
    });
    return rows;
  }

  Object.entries(value).forEach(([key, entry]) => {
    const childPath = `${pathPrefix}.${key}`;
    const childBytes = jsonByteLength(entry);
    rows.push({ path: childPath, bytes: childBytes });
    rows.push(...collectPayloadFieldSizes(entry, childPath, depth + 1));
  });
  return rows;
}

async function runOne(barcode) {
  const ctrl = new AbortController();
  const timeout = setTimeout(() => ctrl.abort(new Error(`timeout_${SSE_TIMEOUT_MS}ms`)), SSE_TIMEOUT_MS);
  const startedAt = Date.now();
  const payload = { barcode: toGtin14(barcode) };
  if (STREAM_MODE) payload.streamMode = STREAM_MODE;
  let timedOut = false;
  let rev0Ms = null;
  let rev1Ms = null;
  let doneMs = null;
  let doneSeen = false;
  let rev1Identity = null;
  let rev1Meta = null;
  let doneMeta = null;
  let analysisBundlePayloadMaxBytes = 0;
  let analysisBundlePayloadTopFields = [];
  let analysisBundlePayloadRevision = null;
  let bundleProductIdentity = null;
  let requestId = null;
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
        ok: false,
        barcode: payload.barcode,
        terminal: "HTTP_ERROR",
        timedOut: false,
        error: `http_${res.status}:${text.slice(0, 160)}`,
      };
    }
    if (!res.body) {
      return {
        ok: false,
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
        // no-op
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
        const payloadBytes = Buffer.byteLength(raw, "utf8");
        if (payloadBytes >= analysisBundlePayloadMaxBytes) {
          const fieldSizes = collectPayloadFieldSizes(data, "analysis_bundle");
          const topFields = fieldSizes
            .filter((row) => Number.isFinite(row.bytes) && row.bytes > 0)
            .sort((a, b) => b.bytes - a.bytes)
            .slice(0, ANALYSIS_BUNDLE_PAYLOAD_TOPN)
            .map((row) => ({
              path: row.path,
              bytes: row.bytes,
              percent: payloadBytes > 0 ? Number(((row.bytes / payloadBytes) * 100).toFixed(2)) : 0,
            }));
          analysisBundlePayloadMaxBytes = payloadBytes;
          analysisBundlePayloadTopFields = topFields;
          analysisBundlePayloadRevision = Number.isFinite(Number(data?.meta?.revision))
            ? Number(data.meta.revision)
            : analysisBundlePayloadRevision;
        }
        const revision = Number(data?.meta?.revision);
        const productIdentity = normalizeProductIdentity(data?.meta?.productIdentity);
        if (productIdentity) bundleProductIdentity = productIdentity;
        if (revision === 0 && rev0Ms == null) rev0Ms = tMs;
        if (revision >= 1) {
          if (rev1Ms == null) rev1Ms = tMs;
          const stage0StartCount = toFiniteNumber(data?.meta?.stage0StartCount);
          const stage0ReplaceCount = toFiniteNumber(data?.meta?.stage0ReplaceCount);
          rev1Meta = {
            sourceType: typeof data?.meta?.sourceType === "string" ? data.meta.sourceType : rev1Meta?.sourceType ?? null,
            sourceTypeFinal:
              typeof data?.meta?.sourceTypeFinal === "boolean"
                ? data.meta.sourceTypeFinal
                : rev1Meta?.sourceTypeFinal ?? null,
            identityType:
              typeof data?.meta?.authoritativeIdentity?.type === "string"
                ? data.meta.authoritativeIdentity.type
                : rev1Meta?.identityType ?? null,
            identityValue:
              typeof data?.meta?.authoritativeIdentity?.value === "string"
                ? data.meta.authoritativeIdentity.value
                : rev1Meta?.identityValue ?? null,
            terminalReason:
              typeof data?.meta?.terminalReason === "string"
                ? data.meta.terminalReason
                : rev1Meta?.terminalReason ?? null,
            degradedMode:
              typeof data?.meta?.degradedMode === "boolean"
                ? data.meta.degradedMode
                : rev1Meta?.degradedMode ?? null,
            stage0Winner:
              typeof data?.meta?.stage0Winner === "string"
                ? data.meta.stage0Winner
                : rev1Meta?.stage0Winner ?? null,
            stage0StartCount: stage0StartCount ?? rev1Meta?.stage0StartCount ?? null,
            stage0ReplaceCount: stage0ReplaceCount ?? rev1Meta?.stage0ReplaceCount ?? null,
            productIdentity:
              productIdentity ?? rev1Meta?.productIdentity ?? bundleProductIdentity ?? null,
            rev1ToDoneMs:
              toFiniteNumber(data?.meta?.rev1ToDoneMs) ??
              toFiniteNumber(rev1Meta?.rev1ToDoneMs) ??
              null,
            doneTimerKind:
              typeof data?.meta?.doneTimerKind === "string"
                ? data.meta.doneTimerKind
                : rev1Meta?.doneTimerKind ?? null,
            doneTimerPlannedDelayMs:
              toFiniteNumber(data?.meta?.doneTimerPlannedDelayMs) ??
              toFiniteNumber(rev1Meta?.doneTimerPlannedDelayMs) ??
              null,
            doneTimerDriftMs:
              toFiniteNumber(data?.meta?.doneTimerDriftMs) ??
              toFiniteNumber(rev1Meta?.doneTimerDriftMs) ??
              null,
            persistedCommitMode:
              typeof data?.meta?.persistedCommitMode === "string"
                ? data.meta.persistedCommitMode
                : rev1Meta?.persistedCommitMode ?? null,
            persistedCommitCompletedBeforeDone:
              typeof data?.meta?.persistedCommitCompletedBeforeDone === "boolean"
                ? data.meta.persistedCommitCompletedBeforeDone
                : typeof rev1Meta?.persistedCommitCompletedBeforeDone === "boolean"
                  ? rev1Meta.persistedCommitCompletedBeforeDone
                  : null,
          };
          if (!rev1Identity) {
            rev1Identity = {
              sourceType: typeof data?.meta?.sourceType === "string" ? data.meta.sourceType : null,
              identityType:
                typeof data?.meta?.authoritativeIdentity?.type === "string"
                  ? data.meta.authoritativeIdentity.type
                  : null,
              identityValue:
                typeof data?.meta?.authoritativeIdentity?.value === "string"
                  ? data.meta.authoritativeIdentity.value
                  : null,
              sourceTypeFinal:
                typeof data?.meta?.sourceTypeFinal === "boolean" ? data.meta.sourceTypeFinal : null,
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
          admissionLane: typeof data?.admissionLane === "string" ? data.admissionLane : null,
          admissionGateState:
            data?.admissionGateState && typeof data.admissionGateState === "object"
              ? data.admissionGateState
              : null,
        });
      }
      if (currentEvent === "done") {
        if (data && typeof data === "object") {
          const doneStartCount = toFiniteNumber(data?.stage0StartCount);
          const doneReplaceCount = toFiniteNumber(data?.stage0ReplaceCount);
          doneMeta = {
            terminalReason: typeof data?.terminalReason === "string" ? data.terminalReason : null,
            degradedMode: typeof data?.degradedMode === "boolean" ? data.degradedMode : null,
            stage0Winner: typeof data?.stage0Winner === "string" ? data.stage0Winner : null,
            stage0StartCount: doneStartCount,
            stage0ReplaceCount: doneReplaceCount,
            rev1ToDoneMs: toFiniteNumber(data?.rev1ToDoneMs),
            doneTimerKind: typeof data?.doneTimerKind === "string" ? data.doneTimerKind : null,
            doneTimerPlannedDelayMs: toFiniteNumber(data?.doneTimerPlannedDelayMs),
            doneTimerDriftMs: toFiniteNumber(data?.doneTimerDriftMs),
            persistedCommitMode:
              typeof data?.persistedCommitMode === "string" ? data.persistedCommitMode : null,
            persistedCommitCompletedBeforeDone:
              typeof data?.persistedCommitCompletedBeforeDone === "boolean"
                ? data.persistedCommitCompletedBeforeDone
                : null,
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
        if (line.startsWith("event:")) {
          currentEvent = line.slice("event:".length).trim();
        } else if (line.startsWith("data:")) {
          currentData += line.slice("data:".length).trim();
        }
      }
      if (doneSeen) break;
    }

    flushEvent();
    const firstErrorTerminal = errorEvents.find((event) => event.terminal)?.terminal ?? null;
    const lastErrorTerminal =
      [...errorEvents].reverse().find((event) => event.terminal)?.terminal ?? null;
    const lastError = [...errorEvents].reverse().find((event) => event && typeof event === "object") ?? null;
    const terminal = doneSeen ? "DONE" : lastErrorTerminal ?? "NO_TERMINAL";
    const resolvedProductIdentity = rev1Meta?.productIdentity ?? bundleProductIdentity ?? null;
    const resolvedSourceType =
      rev1Meta?.sourceType ??
      rev1Identity?.sourceType ??
      inferSourceTypeFromAttribution(resolvedProductIdentity?.sourceAttribution) ??
      null;
    const resolvedIdentityType =
      rev1Meta?.identityType ??
      rev1Identity?.identityType ??
      (resolvedProductIdentity?.sourceId ? "source_id" : null) ??
      (resolvedProductIdentity?.name ? "product_name" : null);
    const resolvedIdentityValue =
      rev1Meta?.identityValue ??
      rev1Identity?.identityValue ??
      resolvedProductIdentity?.sourceId ??
      resolvedProductIdentity?.name ??
      null;
    const requestContext = {
      requestId,
      terminal,
      sourceType: resolvedSourceType,
      sourceTypeFinal: rev1Meta?.sourceTypeFinal ?? rev1Identity?.sourceTypeFinal ?? null,
      authoritativeIdentity:
        resolvedIdentityType || resolvedIdentityValue
          ? {
              type: resolvedIdentityType,
              value: resolvedIdentityValue,
            }
          : null,
      productIdentity: resolvedProductIdentity,
      terminalReason: doneMeta?.terminalReason ?? rev1Meta?.terminalReason ?? null,
      degradedMode:
        typeof doneMeta?.degradedMode === "boolean"
          ? doneMeta.degradedMode
          : typeof rev1Meta?.degradedMode === "boolean"
            ? rev1Meta.degradedMode
            : null,
      stage0Winner: doneMeta?.stage0Winner ?? rev1Meta?.stage0Winner ?? null,
      stage0StartCount:
        toFiniteNumber(doneMeta?.stage0StartCount) ??
        toFiniteNumber(rev1Meta?.stage0StartCount) ??
        null,
      stage0ReplaceCount:
        toFiniteNumber(doneMeta?.stage0ReplaceCount) ??
        toFiniteNumber(rev1Meta?.stage0ReplaceCount) ??
        null,
      rev1ToDoneMs:
        toFiniteNumber(doneMeta?.rev1ToDoneMs) ??
        toFiniteNumber(rev1Meta?.rev1ToDoneMs) ??
        null,
      doneTimerKind:
        typeof doneMeta?.doneTimerKind === "string"
          ? doneMeta.doneTimerKind
          : typeof rev1Meta?.doneTimerKind === "string"
            ? rev1Meta.doneTimerKind
            : null,
      doneTimerPlannedDelayMs:
        toFiniteNumber(doneMeta?.doneTimerPlannedDelayMs) ??
        toFiniteNumber(rev1Meta?.doneTimerPlannedDelayMs) ??
        null,
      doneTimerDriftMs:
        toFiniteNumber(doneMeta?.doneTimerDriftMs) ??
        toFiniteNumber(rev1Meta?.doneTimerDriftMs) ??
        null,
      persistedCommitMode:
        typeof doneMeta?.persistedCommitMode === "string"
          ? doneMeta.persistedCommitMode
          : typeof rev1Meta?.persistedCommitMode === "string"
            ? rev1Meta.persistedCommitMode
            : null,
      persistedCommitCompletedBeforeDone:
        typeof doneMeta?.persistedCommitCompletedBeforeDone === "boolean"
          ? doneMeta.persistedCommitCompletedBeforeDone
          : typeof rev1Meta?.persistedCommitCompletedBeforeDone === "boolean"
            ? rev1Meta.persistedCommitCompletedBeforeDone
            : null,
      admissionLane:
        typeof lastError?.admissionLane === "string"
          ? lastError.admissionLane
          : inferAdmissionLane(STREAM_MODE),
      admissionGateState:
        lastError?.admissionGateState && typeof lastError.admissionGateState === "object"
          ? lastError.admissionGateState
          : null,
    };
    const diagnostics = buildRowDiagnostics({
      terminal,
      timedOut,
      rev1Identity,
      requestContext,
      error: null,
    });
    return {
      ok: Boolean(terminal),
      barcode: payload.barcode,
      streamMode: STREAM_MODE || null,
      terminal,
      firstErrorTerminal,
      lastErrorTerminal,
      errorEvents,
      timedOut,
      rev0Ms,
      rev1Ms,
      doneMs,
      rev1Identity,
      requestContext,
      rev1Meta,
      analysisBundlePayloadMaxBytes,
      analysisBundlePayloadTopFields,
      analysisBundlePayloadRevision,
      failureClass: diagnostics.failureClass,
      noiseFlags: diagnostics.noiseFlags,
      elapsedMs: Date.now() - startedAt,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    timedOut = message.includes("timeout_");
    const terminal = timedOut ? "CLIENT_TIMEOUT" : "REQUEST_ERROR";
    const requestContext = {
      requestId,
      terminal,
      sourceType: null,
      sourceTypeFinal: null,
      authoritativeIdentity: null,
      productIdentity: null,
      terminalReason: null,
      degradedMode: null,
      stage0Winner: null,
      stage0StartCount: null,
      stage0ReplaceCount: null,
      rev1ToDoneMs: null,
      doneTimerKind: null,
      doneTimerPlannedDelayMs: null,
      doneTimerDriftMs: null,
      persistedCommitMode: null,
      persistedCommitCompletedBeforeDone: null,
    };
    const diagnostics = buildRowDiagnostics({
      terminal,
      timedOut,
      rev1Identity,
      requestContext,
      error: message,
    });
    return {
      ok: false,
      barcode: payload.barcode,
      terminal,
      timedOut,
      error: message,
      requestContext,
      analysisBundlePayloadMaxBytes: null,
      analysisBundlePayloadTopFields: [],
      analysisBundlePayloadRevision: null,
      failureClass: diagnostics.failureClass,
      noiseFlags: diagnostics.noiseFlags,
    };
  } finally {
    clearTimeout(timeout);
  }
}

async function runScenario(scenario) {
  const rows = [];
  for (let round = 1; round <= scenario.rounds; round += 1) {
    if (scenario.mode === "serial") {
      for (const barcode of scenario.barcodes) {
        // eslint-disable-next-line no-await-in-loop
        rows.push({ round, ...(await runOne(barcode)) });
      }
    } else {
      // eslint-disable-next-line no-await-in-loop
      const batch = await Promise.all(scenario.barcodes.map((barcode) => runOne(barcode)));
      rows.push(...batch.map((row) => ({ round, ...row })));
    }
  }
  return rows;
}

function summarizeScenario(name, rows) {
  const terminalCounts = rows.reduce((acc, row) => {
    acc[row.terminal] = (acc[row.terminal] ?? 0) + 1;
    return acc;
  }, {});
  const timeoutCount = rows.filter((row) => row.timedOut).length;
  const disallowedTerminals = Object.keys(terminalCounts).filter((terminal) => !ALLOWED_TERMINALS.has(terminal));
  const mustDoneViolations = rows
    .filter((row) => MUST_DONE_BARCODES.has(row.barcode) && row.terminal !== "DONE")
    .map((row) => ({
      barcode: row.barcode,
      terminal: row.terminal,
      requestContext: row.requestContext ?? null,
      rev1Identity: row.rev1Identity ?? null,
      firstErrorTerminal: row.firstErrorTerminal ?? null,
      lastErrorTerminal: row.lastErrorTerminal ?? null,
      errorEvents: row.errorEvents ?? [],
    }));
  const doneStats = latencyStats(rows.filter((row) => row.terminal === "DONE").map((row) => row.doneMs));
  const notFoundRev1Stats = latencyStats(
    rows.filter((row) => row.terminal === "NOT_FOUND").map((row) => row.rev1Ms),
  );
  const failureClassCounts = rows.reduce((acc, row) => {
    const key = row.failureClass ?? "none";
    acc[key] = (acc[key] ?? 0) + 1;
    return acc;
  }, {});
  const terminalReasonCounts = rows.reduce((acc, row) => {
    const key = toCountKey(row?.requestContext?.terminalReason, "UNKNOWN");
    acc[key] = (acc[key] ?? 0) + 1;
    return acc;
  }, {});
  const stage0WinnerCounts = rows.reduce((acc, row) => {
    const key = toCountKey(row?.requestContext?.stage0Winner, "UNKNOWN");
    acc[key] = (acc[key] ?? 0) + 1;
    return acc;
  }, {});
  const degradedModeCounts = rows.reduce(
    (acc, row) => {
      if (row?.requestContext?.degradedMode === true) acc.true += 1;
      else if (row?.requestContext?.degradedMode === false) acc.false += 1;
      else acc.unknown += 1;
      return acc;
    },
    { true: 0, false: 0, unknown: 0 },
  );
  const admissionLaneCounts = rows.reduce((acc, row) => {
    const key = toCountKey(row?.requestContext?.admissionLane, "UNKNOWN");
    acc[key] = (acc[key] ?? 0) + 1;
    return acc;
  }, {});
  const persistedCommitModeCounts = rows.reduce((acc, row) => {
    const key = toCountKey(row?.requestContext?.persistedCommitMode, "UNKNOWN");
    acc[key] = (acc[key] ?? 0) + 1;
    return acc;
  }, {});
  const persistedCommitNotCompletedBeforeDoneCount = rows.filter(
    (row) => row?.requestContext?.persistedCommitCompletedBeforeDone === false,
  ).length;
  const noiseCounts = rows.reduce(
    (acc, row) => {
      if (row?.noiseFlags?.identityNull) acc.identityNull += 1;
      if (row?.noiseFlags?.sourceTypeNull) acc.sourceTypeNull += 1;
      if (row?.noiseFlags?.requestError) acc.requestError += 1;
      if (row?.noiseFlags?.backendUnavailable) acc.backendUnavailable += 1;
      return acc;
    },
    { identityNull: 0, sourceTypeNull: 0, requestError: 0, backendUnavailable: 0 },
  );
  const payloadRows = rows
    .map((row) => ({
      barcode: row?.barcode ?? null,
      round: Number.isFinite(Number(row?.round)) ? Number(row.round) : null,
      maxBytes: Number.isFinite(Number(row?.analysisBundlePayloadMaxBytes))
        ? Number(row.analysisBundlePayloadMaxBytes)
        : null,
      topFields: Array.isArray(row?.analysisBundlePayloadTopFields) ? row.analysisBundlePayloadTopFields : [],
      revision: Number.isFinite(Number(row?.analysisBundlePayloadRevision))
        ? Number(row.analysisBundlePayloadRevision)
        : null,
      terminal: row?.terminal ?? null,
    }))
    .filter((row) => row.maxBytes != null)
    .sort((a, b) => Number(b.maxBytes ?? 0) - Number(a.maxBytes ?? 0));
  const payloadMaxBytes = payloadRows.length > 0 ? Number(payloadRows[0].maxBytes ?? 0) : null;
  const payloadWarnExceededCount = payloadRows.filter(
    (row) => Number(row.maxBytes ?? 0) > ANALYSIS_BUNDLE_PAYLOAD_WARN_BYTES,
  ).length;
  const payloadFailExceededCount = payloadRows.filter(
    (row) => Number(row.maxBytes ?? 0) > ANALYSIS_BUNDLE_PAYLOAD_FAIL_BYTES,
  ).length;
  const payloadLargestSample = payloadRows[0] ?? null;
  return {
    name,
    total: rows.length,
    timeoutCount,
    disallowedTerminals,
    terminalCounts,
    terminalBreakdown: terminalCounts,
    mustDoneViolations,
    failureClassCounts,
    terminalReasonCounts,
    stage0WinnerCounts,
    degradedModeCounts,
    admissionLaneCounts,
    noiseCounts,
    latencyStats: {
      doneMs: doneStats,
      notFoundRev1Ms: notFoundRev1Stats,
      stage0StartCount: latencyStats(rows.map((row) => toFiniteNumber(row?.requestContext?.stage0StartCount))),
      stage0ReplaceCount: latencyStats(rows.map((row) => toFiniteNumber(row?.requestContext?.stage0ReplaceCount))),
      rev1ToDoneMs: latencyStats(rows.map((row) => toFiniteNumber(row?.requestContext?.rev1ToDoneMs))),
      doneTimerDriftMs: latencyStats(rows.map((row) => toFiniteNumber(row?.requestContext?.doneTimerDriftMs))),
    },
    persistedCommitModeCounts,
    persistedCommitNotCompletedBeforeDoneCount,
    payloadBudget: {
      warnBytes: ANALYSIS_BUNDLE_PAYLOAD_WARN_BYTES,
      failBytes: ANALYSIS_BUNDLE_PAYLOAD_FAIL_BYTES,
      maxObservedBytes: payloadMaxBytes,
      warnExceededCount: payloadWarnExceededCount,
      failExceededCount: payloadFailExceededCount,
      warnExceeded: payloadWarnExceededCount > 0,
      failExceeded: payloadFailExceededCount > 0,
      sample: payloadLargestSample
        ? {
            barcode: payloadLargestSample.barcode,
            round: payloadLargestSample.round,
            revision: payloadLargestSample.revision,
            terminal: payloadLargestSample.terminal,
            topFields: payloadLargestSample.topFields,
          }
        : null,
    },
    rows,
  };
}

function assertGate(summary) {
  if (summary.timeoutCount > 0) {
    throw new Error(`${summary.name}: timeoutCount=${summary.timeoutCount}`);
  }
  if (summary.disallowedTerminals.length > 0) {
    throw new Error(
      `${summary.name}: disallowed terminals ${summary.disallowedTerminals.join(",")}`,
    );
  }
  if (summary.mustDoneViolations.length > 0) {
    const labels = summary.mustDoneViolations
      .map((row) => `${row.barcode}:${row.terminal}`)
      .join(",");
    throw new Error(`${summary.name}: must-DONE barcode failed (${labels})`);
  }
  if (summary.name === "parallel9") {
    const doneP95 = summary?.latencyStats?.doneMs?.p95;
    if (Number.isFinite(doneP95) && doneP95 > PARALLEL9_DONE_P95_MAX_MS) {
      throw new Error(
        `${summary.name}: done p95 ${doneP95}ms exceeds ${PARALLEL9_DONE_P95_MAX_MS}ms`,
      );
    }
    const notFoundRev1P95 = summary?.latencyStats?.notFoundRev1Ms?.p95;
    if (
      Number.isFinite(notFoundRev1P95)
      && notFoundRev1P95 > PARALLEL9_NOT_FOUND_REV1_P95_MAX_MS
    ) {
      throw new Error(
        `${summary.name}: NOT_FOUND rev1 p95 ${notFoundRev1P95}ms exceeds ${PARALLEL9_NOT_FOUND_REV1_P95_MAX_MS}ms`,
      );
    }
  }
  if (summary.name === "contract-000646-serial") {
    const nonDone = summary.rows.filter((row) => row.terminal !== "DONE");
    if (nonDone.length > 0) {
      const labels = nonDone.map((row) => `${row.barcode}:${row.terminal}`).join(",");
      throw new Error(`${summary.name}: expected DONE for all rows (${labels})`);
    }
    const missingTerminalReason = summary.rows.filter((row) => {
      const reason = typeof row?.requestContext?.terminalReason === "string" ? row.requestContext.terminalReason.trim() : "";
      return reason.length === 0;
    });
    if (missingTerminalReason.length > 0) {
      throw new Error(`${summary.name}: terminalReason missing for ${missingTerminalReason.length} rows`);
    }
  }
  if (summary?.payloadBudget?.failExceeded) {
    throw new Error(
      `${summary.name}: analysis_bundle payload max ${summary.payloadBudget.maxObservedBytes} bytes exceeds fail threshold ${ANALYSIS_BUNDLE_PAYLOAD_FAIL_BYTES} bytes`,
    );
  }
}

async function main() {
  await fs.mkdir(OUTPUT_DIR, { recursive: true });

  const scenarioSummaries = [];
  for (const scenario of SCENARIOS) {
    // eslint-disable-next-line no-await-in-loop
    const rows = await runScenario(scenario);
    const summary = summarizeScenario(scenario.name, rows);
    scenarioSummaries.push(summary);
    console.log(
      `[gate] ${summary.name} total=${summary.total} timeout=${summary.timeoutCount} terminals=${JSON.stringify(summary.terminalCounts)}`,
    );
  }

  const report = {
    generatedAt: new Date().toISOString(),
    apiBaseUrl: API_BASE_URL,
    streamMode: STREAM_MODE || null,
    sseTimeoutMs: SSE_TIMEOUT_MS,
    gateConfig: {
      mustDoneBarcodes: [...MUST_DONE_BARCODES],
      contract: {
        barcode000646: CONTRACT_BARCODE_000646,
        rounds: CONTRACT_ROUNDS,
      },
      thresholds: {
        parallel9DoneP95MaxMs: PARALLEL9_DONE_P95_MAX_MS,
        parallel9NotFoundRev1P95MaxMs: PARALLEL9_NOT_FOUND_REV1_P95_MAX_MS,
        analysisBundlePayloadWarnBytes: ANALYSIS_BUNDLE_PAYLOAD_WARN_BYTES,
        analysisBundlePayloadFailBytes: ANALYSIS_BUNDLE_PAYLOAD_FAIL_BYTES,
      },
    },
    scenarios: scenarioSummaries.map((summary) => ({
      name: summary.name,
      total: summary.total,
      timeoutCount: summary.timeoutCount,
      disallowedTerminals: summary.disallowedTerminals,
      terminalCounts: summary.terminalCounts,
      terminalBreakdown: summary.terminalBreakdown,
      mustDoneViolations: summary.mustDoneViolations,
      failureClassCounts: summary.failureClassCounts,
      terminalReasonCounts: summary.terminalReasonCounts,
      stage0WinnerCounts: summary.stage0WinnerCounts,
      degradedModeCounts: summary.degradedModeCounts,
      admissionLaneCounts: summary.admissionLaneCounts,
      persistedCommitModeCounts: summary.persistedCommitModeCounts,
      persistedCommitNotCompletedBeforeDoneCount:
        summary.persistedCommitNotCompletedBeforeDoneCount,
      payloadBudget: summary.payloadBudget,
      noiseCounts: summary.noiseCounts,
      latencyStats: summary.latencyStats,
    })),
    details: scenarioSummaries,
  };

  const reportPath = path.join(OUTPUT_DIR, "report.json");
  await fs.writeFile(reportPath, JSON.stringify(report, null, 2));
  console.log(`[gate] report=${reportPath}`);

  for (const summary of scenarioSummaries) {
    assertGate(summary);
  }
}

main().catch((error) => {
  console.error("[gate] failed", error instanceof Error ? error.message : error);
  process.exit(1);
});
