#!/usr/bin/env node
/* eslint-disable no-console */

import fs from "node:fs/promises";
import path from "node:path";

import dotenv from "dotenv";
import { createClient } from "@supabase/supabase-js";

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
  node scripts/maintainer/npn-candidate-audit.mjs [options]

Options:
  --out-dir <path>              Output directory (default: output/maintainer-gates/npn-candidate-audit-<timestamp>)
  --api-base-url <url>          API base URL for enrich-stream probe (default: API_BASE_URL/RENDER_BASE_URL/http://127.0.0.1:3001)
  --map-limit <n>               Number of barcode_regulatory_map samples (default: 20)
  --jamieson-limit <n>          Number of Jamieson samples (default: 20)
  --jamieson-barcodes-file <p>  Optional JSON file with jamieson barcodes
  --stream-mode <mode>          Optional streamMode in probe payload
  --probe-timeout-ms <ms>       SSE probe timeout (default: 25000)
  --skip-api                    Only build pools; skip enrich-stream probe
`);
  process.exit(0);
}

const nowTag = new Date().toISOString().replace(/[:.]/g, "-");
const outDirArg =
  getArg("out-dir") ||
  path.join("output", "maintainer-gates", `npn-candidate-audit-${nowTag}`);
const OUT_DIR = path.isAbsolute(outDirArg) ? outDirArg : path.join(ROOT_DIR, outDirArg);
const API_BASE_URL =
  getArg("api-base-url") ||
  process.env.API_BASE_URL ||
  process.env.RENDER_BASE_URL ||
  "http://127.0.0.1:3001";
const MAP_LIMIT = Math.max(1, Number(getArg("map-limit") || process.env.NPN_AUDIT_MAP_LIMIT || 20));
const JAMIESON_LIMIT = Math.max(1, Number(getArg("jamieson-limit") || process.env.NPN_AUDIT_JAMIESON_LIMIT || 20));
const STREAM_MODE = String(getArg("stream-mode") || process.env.NPN_AUDIT_STREAM_MODE || "").trim();
const PROBE_TIMEOUT_MS = Math.max(
  3000,
  Number(getArg("probe-timeout-ms") || process.env.NPN_AUDIT_PROBE_TIMEOUT_MS || 25000),
);
const JAMIESON_BARCODES_FILE = getArg("jamieson-barcodes-file") || null;
const SKIP_API = hasFlag("skip-api");

const SUPABASE_URL = process.env.SUPABASE_URL || process.env.EXPO_PUBLIC_SUPABASE_URL || "";
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || "";
const REGRESSION_TOKEN = process.env.RENDER_REGRESSION_TOKEN || process.env.REGRESSION_AUTH_TOKEN || "";

const AUDIT_JSON_PATH = path.join(OUT_DIR, "npn_candidate_audit.json");
const AUDIT_MD_PATH = path.join(OUT_DIR, "npn_candidate_audit.md");
const REPAIR_QUEUE_PATH = path.join(OUT_DIR, "npn_candidate_repair_queue.json");

const toGtin14 = (value) => {
  const digits = String(value ?? "").replace(/\D/g, "");
  if (!digits) return "";
  if (digits.length >= 14) return digits.slice(-14);
  return digits.padStart(14, "0");
};

const normalizeNpnValue = (value) => {
  const digits = String(value ?? "").replace(/\D/g, "").trim();
  if (!digits) return null;
  return digits;
};

const readJson = async (filePath) => {
  try {
    const raw = await fs.readFile(filePath, "utf8");
    return JSON.parse(raw);
  } catch {
    return null;
  }
};

const rowBarcodeCandidates = (row) => {
  const keys = [
    "gtin14",
    "barcode_gtin14",
    "barcode",
    "barcode_raw",
    "barcode_digits",
    "upc",
    "ean",
    "code",
  ];
  const out = [];
  for (const key of keys) {
    const normalized = toGtin14(row?.[key]);
    if (!normalized) continue;
    out.push(normalized);
  }
  return Array.from(new Set(out));
};

const normalizeNpnCandidate = (value) => {
  if (!value || typeof value !== "object") return null;
  const npn = normalizeNpnValue(value?.value);
  if (!npn) return null;
  const sourceKind = String(value?.sourceKind ?? "").trim() || "unknown";
  const stableReason = String(value?.stableReason ?? "").trim() || "unverified";
  const confidenceNum = Number(value?.confidence);
  return {
    value: npn,
    sourceKind,
    stableReason,
    confidence: Number.isFinite(confidenceNum) ? Number(confidenceNum.toFixed(3)) : 0,
  };
};

const normalizeCandidateBackfill = (value) => {
  if (!value || typeof value !== "object") return null;
  return {
    attempted: value?.attempted === true,
    used: value?.used === true,
    source: value?.source ? String(value.source) : null,
    reasonCode: value?.reasonCode ? String(value.reasonCode) : null,
    latencyMs: Number.isFinite(Number(value?.latencyMs)) ? Number(value.latencyMs) : null,
    scoreSuppressed: value?.scoreSuppressed === true,
  };
};

const normalizeTerminalFromErrorPayload = (payload) => {
  if (!payload || typeof payload !== "object") return null;
  const code = typeof payload.code === "string" ? payload.code.trim().toUpperCase() : "";
  if (code) return code;
  const message = typeof payload.message === "string" ? payload.message.trim() : "";
  if (message === "Product not found") return "NOT_FOUND";
  return null;
};

const pickMapSamples = (rows, limit) => {
  const picked = [];
  const seen = new Set();
  for (const row of rows) {
    const npn = normalizeNpnValue(row?.npn);
    if (!npn) continue;
    for (const barcode of rowBarcodeCandidates(row)) {
      if (!barcode || seen.has(barcode)) continue;
      seen.add(barcode);
      picked.push({
        barcode,
        seedNpn: npn,
        seedSource: "barcode_regulatory_map",
        label: "map",
      });
      if (picked.length >= limit) return picked;
    }
  }
  return picked;
};

const pickJamiesonSamplesFromRows = (rows, limit, seenBarcodes) => {
  const picked = [];
  for (const row of rows) {
    const serialized = JSON.stringify(row ?? {}).toLowerCase();
    if (!serialized.includes("jamieson")) continue;
    for (const barcode of rowBarcodeCandidates(row)) {
      if (!barcode || seenBarcodes.has(barcode)) continue;
      seenBarcodes.add(barcode);
      picked.push({
        barcode,
        seedNpn: normalizeNpnValue(row?.npn),
        seedSource: "jamieson_detected",
        label: "jamieson",
      });
      if (picked.length >= limit) return picked;
    }
  }
  return picked;
};

const runProbe = async (barcode) => {
  const payload = { barcode: toGtin14(barcode) };
  if (STREAM_MODE) payload.streamMode = STREAM_MODE;
  const headers = {
    "Content-Type": "application/json",
    Accept: "text/event-stream",
    ...(REGRESSION_TOKEN
      ? { "x-regression-token": REGRESSION_TOKEN }
      : { "x-auth-disabled": "1" }),
  };
  const ctrl = new AbortController();
  const timeout = setTimeout(() => ctrl.abort(new Error(`probe_timeout_${PROBE_TIMEOUT_MS}ms`)), PROBE_TIMEOUT_MS);
  const startedAt = Date.now();

  let terminal = "NO_TERMINAL";
  let rev1Ms = null;
  let doneMs = null;
  let requestId = null;
  let metaSnapshot = null;
  const errorEvents = [];

  try {
    const res = await fetch(`${API_BASE_URL}/api/enrich-stream`, {
      method: "POST",
      headers,
      body: JSON.stringify(payload),
      signal: ctrl.signal,
    });
    if (!res.ok || !res.body) {
      const text = await res.text().catch(() => "");
      return {
        barcode: payload.barcode,
        terminal: `HTTP_${res.status}`,
        error: text.slice(0, 200),
        requestId: null,
        rev1Ms: null,
        doneMs: null,
        meta: null,
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
        // noop
      }
      const tMs = Date.now() - startedAt;
      if (data && typeof data === "object" && !requestId) {
        requestId =
          (typeof data?.requestId === "string" && data.requestId) ||
          (typeof data?.request_id === "string" && data.request_id) ||
          (typeof data?.meta?.requestId === "string" && data.meta.requestId) ||
          null;
      }
      if (currentEvent === "analysis_bundle" && data && typeof data === "object") {
        const revision = Number(data?.meta?.revision);
        if (revision >= 1 && rev1Ms == null) rev1Ms = tMs;
        if (revision >= 1) {
          const npnCandidates = Array.isArray(data?.meta?.regulatoryIds?.npnCandidates)
            ? data.meta.regulatoryIds.npnCandidates.map((item) => normalizeNpnCandidate(item)).filter(Boolean).slice(0, 3)
            : [];
          metaSnapshot = {
            sourceType: typeof data?.meta?.sourceType === "string" ? data.meta.sourceType : null,
            sourceTypeFinal: typeof data?.meta?.sourceTypeFinal === "boolean" ? data.meta.sourceTypeFinal : null,
            authoritativeIdentity:
              data?.meta?.authoritativeIdentity && typeof data.meta.authoritativeIdentity === "object"
                ? {
                    type:
                      typeof data.meta.authoritativeIdentity.type === "string"
                        ? data.meta.authoritativeIdentity.type
                        : null,
                    value:
                      typeof data.meta.authoritativeIdentity.value === "string"
                        ? data.meta.authoritativeIdentity.value
                        : null,
                  }
                : null,
            terminalReason: typeof data?.meta?.terminalReason === "string" ? data.meta.terminalReason : null,
            scoreAvailable: typeof data?.meta?.scoreAvailable === "boolean" ? data.meta.scoreAvailable : null,
            scoreReasonCode: typeof data?.meta?.scoreReasonCode === "string" ? data.meta.scoreReasonCode : null,
            regulatoryIds:
              npnCandidates.length > 0
                ? {
                    npnCandidates,
                  }
                : null,
            candidateBackfill: normalizeCandidateBackfill(data?.meta?.candidateBackfill ?? null),
          };
        }
      }
      if (currentEvent === "error") {
        errorEvents.push({
          tMs,
          terminal: normalizeTerminalFromErrorPayload(data) ?? "ERROR",
          reasonCode: typeof data?.reasonCode === "string" ? data.reasonCode : null,
          message: typeof data?.message === "string" ? data.message : null,
        });
      }
      if (currentEvent === "done") {
        terminal = "DONE";
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
          continue;
        }
        if (line.startsWith("event:")) currentEvent = line.slice("event:".length).trim();
        else if (line.startsWith("data:")) currentData += line.slice("data:".length).trim();
      }
    }
    flushEvent();
    if (terminal !== "DONE") {
      terminal = [...errorEvents].reverse().find((item) => item?.terminal)?.terminal ?? "NO_TERMINAL";
    }
    return {
      barcode: payload.barcode,
      terminal,
      error: null,
      requestId,
      rev1Ms,
      doneMs,
      meta: metaSnapshot,
    };
  } catch (error) {
    return {
      barcode: payload.barcode,
      terminal: String(error?.message ?? "").includes("probe_timeout_") ? "CLIENT_TIMEOUT" : "REQUEST_ERROR",
      error: error instanceof Error ? error.message : String(error),
      requestId,
      rev1Ms,
      doneMs,
      meta: metaSnapshot,
    };
  } finally {
    clearTimeout(timeout);
  }
};

const analyzeProbe = (seed, probe) => {
  const candidates = Array.isArray(probe?.meta?.regulatoryIds?.npnCandidates)
    ? probe.meta.regulatoryIds.npnCandidates
    : [];
  const topCandidate = candidates[0] ?? null;
  const candidateBackfill = probe?.meta?.candidateBackfill ?? null;
  const scoreReasonCode = probe?.meta?.scoreReasonCode ?? null;
  const scoreAvailable = probe?.meta?.scoreAvailable ?? null;
  const sourceTypeFinal = probe?.meta?.sourceTypeFinal ?? null;
  const scoreSuppressed =
    candidateBackfill?.scoreSuppressed === true ||
    String(scoreReasonCode ?? "").toUpperCase() === "CANDIDATE_MATCH_NOT_FINAL" ||
    (candidateBackfill?.used === true && sourceTypeFinal !== true && scoreAvailable === false);
  return {
    group: seed.label,
    barcode: seed.barcode,
    seedNpn: seed.seedNpn ?? null,
    seedSource: seed.seedSource,
    terminal: probe?.terminal ?? "NO_TERMINAL",
    requestId: probe?.requestId ?? null,
    sourceType: probe?.meta?.sourceType ?? null,
    sourceTypeFinal,
    authoritativeIdentity: probe?.meta?.authoritativeIdentity ?? null,
    rev1Ms: probe?.rev1Ms ?? null,
    doneMs: probe?.doneMs ?? null,
    candidateVisible: candidates.length > 0,
    npnCandidates: candidates,
    topCandidate,
    candidateBackfill,
    scoreAvailable,
    scoreReasonCode,
    scoreSuppressed,
    error: probe?.error ?? null,
  };
};

const summarizeRows = (rows) => {
  const acc = {
    total: rows.length,
    doneCount: 0,
    candidateVisibleCount: 0,
    backfillAttemptedCount: 0,
    backfillUsedCount: 0,
    rejectedMismatchCount: 0,
    timeoutCount: 0,
    notFoundCount: 0,
    scoreSuppressedCount: 0,
    sourceTypeFinalFalseCount: 0,
  };
  for (const row of rows) {
    if (row.terminal === "DONE") acc.doneCount += 1;
    if (row.candidateVisible) acc.candidateVisibleCount += 1;
    if (row.sourceTypeFinal === false) acc.sourceTypeFinalFalseCount += 1;
    if (row.candidateBackfill?.attempted === true) acc.backfillAttemptedCount += 1;
    if (row.candidateBackfill?.used === true) acc.backfillUsedCount += 1;
    const reasonCode = String(row?.candidateBackfill?.reasonCode ?? "").toUpperCase();
    if (reasonCode === "CANDIDATE_IDENTITY_MISMATCH") acc.rejectedMismatchCount += 1;
    if (reasonCode === "CANDIDATE_LOOKUP_TIMEOUT") acc.timeoutCount += 1;
    if (reasonCode === "CANDIDATE_LOOKUP_NOT_FOUND") acc.notFoundCount += 1;
    if (row.scoreSuppressed) acc.scoreSuppressedCount += 1;
  }
  return acc;
};

const toMarkdown = (report) => {
  const lines = [];
  lines.push("# NPN Candidate Audit");
  lines.push("");
  lines.push(`- Generated: ${report.generatedAt}`);
  lines.push(`- API Base URL: ${report.apiBaseUrl}`);
  lines.push(`- mapLimit: ${report.config.mapLimit}`);
  lines.push(`- jamiesonLimit: ${report.config.jamiesonLimit}`);
  lines.push(`- skipApi: ${report.config.skipApi}`);
  lines.push(`- streamMode: ${report.config.streamMode || "default"}`);
  lines.push("");
  lines.push("## Summary");
  lines.push("");
  lines.push(`- overall: \`${JSON.stringify(report.summary.overall)}\``);
  lines.push(`- map: \`${JSON.stringify(report.summary.map)}\``);
  lines.push(`- jamieson: \`${JSON.stringify(report.summary.jamieson)}\``);
  lines.push(`- repairQueueSize: ${report.repairQueue.length}`);
  lines.push("");
  lines.push("## Sample Rows");
  lines.push("");
  report.rows.slice(0, 120).forEach((row) => {
    lines.push(
      `- group=${row.group} barcode=${row.barcode} terminal=${row.terminal} sourceType=${row.sourceType ?? "null"} sourceTypeFinal=${row.sourceTypeFinal ?? "null"} candidates=${row.npnCandidates?.length ?? 0} topStable=${row.topCandidate?.stableReason ?? "none"} backfillReason=${row.candidateBackfill?.reasonCode ?? "none"} scoreSuppressed=${row.scoreSuppressed ? "yes" : "no"} requestId=${row.requestId ?? "null"}`,
    );
  });
  lines.push("");
  return `${lines.join("\n").trim()}\n`;
};

const main = async () => {
  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
    throw new Error("Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY");
  }

  await fs.mkdir(OUT_DIR, { recursive: true });
  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const { data: mapRows, error: mapError } = await supabase
    .from("barcode_regulatory_map")
    .select("*")
    .limit(5000);
  if (mapError) throw new Error(`barcode_regulatory_map query failed: ${mapError.message}`);
  const safeMapRows = Array.isArray(mapRows) ? mapRows : [];
  const mapSamples = pickMapSamples(safeMapRows, MAP_LIMIT);

  const seenBarcodes = new Set(mapSamples.map((item) => item.barcode));
  const jamiesonSamples = [];

  if (JAMIESON_BARCODES_FILE) {
    const filePath = path.isAbsolute(JAMIESON_BARCODES_FILE)
      ? JAMIESON_BARCODES_FILE
      : path.join(ROOT_DIR, JAMIESON_BARCODES_FILE);
    const data = await readJson(filePath);
    const rows = Array.isArray(data?.barcodes) ? data.barcodes : Array.isArray(data) ? data : [];
    for (const row of rows) {
      const barcode = toGtin14(typeof row === "string" ? row : row?.barcode);
      if (!barcode || seenBarcodes.has(barcode)) continue;
      seenBarcodes.add(barcode);
      jamiesonSamples.push({
        barcode,
        seedNpn: null,
        seedSource: "jamieson_fixture",
        label: "jamieson",
      });
      if (jamiesonSamples.length >= JAMIESON_LIMIT) break;
    }
  } else {
    const { data: trainingRows } = await supabase
      .from("barcode_resolution_training")
      .select("*")
      .limit(5000);
    const fromTraining = pickJamiesonSamplesFromRows(
      Array.isArray(trainingRows) ? trainingRows : [],
      JAMIESON_LIMIT,
      seenBarcodes,
    );
    jamiesonSamples.push(...fromTraining);
    if (jamiesonSamples.length < JAMIESON_LIMIT) {
      const fromMapRows = pickJamiesonSamplesFromRows(
        safeMapRows,
        JAMIESON_LIMIT - jamiesonSamples.length,
        seenBarcodes,
      ).map((row) => ({ ...row, seedSource: "jamieson_detected_map" }));
      jamiesonSamples.push(...fromMapRows);
    }
    if (jamiesonSamples.length < JAMIESON_LIMIT) {
      for (const row of mapSamples) {
        if (jamiesonSamples.length >= JAMIESON_LIMIT) break;
        if (seenBarcodes.has(row.barcode)) continue;
        seenBarcodes.add(row.barcode);
        jamiesonSamples.push({
          barcode: row.barcode,
          seedNpn: row.seedNpn,
          seedSource: "jamieson_fallback_pool",
          label: "jamieson",
        });
      }
    }
  }

  const seeds = [...mapSamples, ...jamiesonSamples];
  const rows = [];
  for (const seed of seeds) {
    // eslint-disable-next-line no-await-in-loop
    const probe = SKIP_API
      ? {
          barcode: seed.barcode,
          terminal: "SKIPPED",
          error: null,
          requestId: null,
          rev1Ms: null,
          doneMs: null,
          meta: null,
        }
      : await runProbe(seed.barcode);
    rows.push(analyzeProbe(seed, probe));
  }

  const mapRowsResult = rows.filter((row) => row.group === "map");
  const jamiesonRowsResult = rows.filter((row) => row.group === "jamieson");
  const summary = {
    overall: summarizeRows(rows),
    map: summarizeRows(mapRowsResult),
    jamieson: summarizeRows(jamiesonRowsResult),
  };

  const repairQueue = rows
    .filter((row) => row.candidateVisible && row.sourceTypeFinal !== true)
    .map((row) => {
      const reasonCode = String(row?.candidateBackfill?.reasonCode ?? "").toUpperCase();
      const priority =
        reasonCode === "CANDIDATE_IDENTITY_MISMATCH"
          ? "P0"
          : reasonCode === "CANDIDATE_LOOKUP_TIMEOUT"
            ? "P1"
            : "P1";
      return {
        priority,
        group: row.group,
        barcode: row.barcode,
        requestId: row.requestId,
        sourceType: row.sourceType,
        sourceTypeFinal: row.sourceTypeFinal,
        topCandidate: row.topCandidate ?? null,
        candidateBackfillReasonCode: row?.candidateBackfill?.reasonCode ?? null,
        scoreSuppressed: row.scoreSuppressed,
        seedSource: row.seedSource,
      };
    })
    .sort((a, b) => {
      const rank = (value) => (value === "P0" ? 1 : value === "P1" ? 2 : 3);
      const rankDiff = rank(a.priority) - rank(b.priority);
      if (rankDiff !== 0) return rankDiff;
      if (a.group !== b.group) return a.group.localeCompare(b.group);
      return a.barcode.localeCompare(b.barcode);
    });

  const report = {
    generatedAt: new Date().toISOString(),
    apiBaseUrl: API_BASE_URL,
    config: {
      outDir: OUT_DIR,
      mapLimit: MAP_LIMIT,
      jamiesonLimit: JAMIESON_LIMIT,
      streamMode: STREAM_MODE || null,
      probeTimeoutMs: PROBE_TIMEOUT_MS,
      skipApi: SKIP_API,
      jamiesonBarcodesFile: JAMIESON_BARCODES_FILE,
    },
    seedStats: {
      mapSeedCount: mapSamples.length,
      jamiesonSeedCount: jamiesonSamples.length,
    },
    summary,
    repairQueue,
    rows,
  };

  await fs.writeFile(AUDIT_JSON_PATH, JSON.stringify(report, null, 2), "utf8");
  await fs.writeFile(AUDIT_MD_PATH, toMarkdown(report), "utf8");
  await fs.writeFile(
    REPAIR_QUEUE_PATH,
    JSON.stringify(
      {
        generatedAt: report.generatedAt,
        size: repairQueue.length,
        items: repairQueue,
      },
      null,
      2,
    ),
    "utf8",
  );

  console.log(`[npn-candidate-audit] wrote ${AUDIT_JSON_PATH}`);
  console.log(`[npn-candidate-audit] wrote ${AUDIT_MD_PATH}`);
  console.log(`[npn-candidate-audit] wrote ${REPAIR_QUEUE_PATH}`);
};

main().catch((error) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error("[npn-candidate-audit] failed", message);
  process.exit(1);
});

