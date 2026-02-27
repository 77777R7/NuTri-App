#!/usr/bin/env node
/* eslint-disable no-console */

import fs from "node:fs/promises";
import path from "node:path";
import { spawn } from "node:child_process";

import dotenv from "dotenv";
import { createClient } from "@supabase/supabase-js";

const ROOT_DIR = process.cwd();
dotenv.config({ path: path.join(ROOT_DIR, "backend", ".env") });
dotenv.config({ path: path.join(ROOT_DIR, ".env") });

const nowTag = new Date().toISOString().replace(/[:.]/g, "-");
const args = process.argv.slice(2);
const hasFlag = (flag) => args.includes(`--${flag}`);
const getArg = (flag) => {
  const idx = args.indexOf(`--${flag}`);
  if (idx === -1) return null;
  return args[idx + 1] ?? null;
};

const boolFromEnv = (value, fallback = false) => {
  if (value == null) return fallback;
  const normalized = String(value).trim().toLowerCase();
  if (!normalized) return fallback;
  return ["1", "true", "yes", "on"].includes(normalized);
};

if (hasFlag("help")) {
  console.log(`Usage:
  node scripts/maintainer/run-backend-gates-stable.mjs [options]

Options:
  --out-dir <path>            Output root (default: output/maintainer-gates/<timestamp>)
  --api-base-url <url>        Backend URL (default: API_BASE_URL/RENDER_BASE_URL/http://127.0.0.1:3001)
  --manage-backend            Start/stop backend inside this runner (default: false)
  --backend-cmd <command>     Backend start command (default: "PORT=3001 node backend/dist/server.js")
  --health-url <url>          Health probe URL (default: <api-base-url>/)
  --startup-timeout-ms <ms>   Health check timeout (default: 120000)
  --health-interval-ms <ms>   Health check interval (default: 2000)
  --focus-barcode <gtin14>    Focus barcode section in report (default: 00084783891253)
  --skip-concurrency          Skip enrich-stream-concurrency gate
  --skip-bulk                 Skip bulk-barcode-e2e gate
  --skip-ul                   Skip ODS UL visibility + coverage gate
  --ul-barcodes-file <path>   Barcode fixture for UL visibility report
  --skip-shadow-reports       Skip write policy/candidates/negative-cache/surface consistency reports
  --expected-authoritative-set <path>  Expected authoritative barcode set (default: scripts/maintainer/fixtures/expected_authoritative_set.v1.json)
  --repair-queue-fallback-report <path> Optional fallback gate_full_report.json for repair queue when infra_untrusted and current queue is empty
  --mobile-soak-summary <path> Optional mobile soak rounds_summary.json for content-value metrics
`);
  process.exit(0);
}

const API_BASE_URL =
  getArg("api-base-url") ||
  process.env.API_BASE_URL ||
  process.env.RENDER_BASE_URL ||
  "http://127.0.0.1:3001";
const outDirArg =
  getArg("out-dir") ||
  process.env.MAINTAINER_GATES_OUT_DIR ||
  path.join("output", "maintainer-gates", nowTag);
const OUTPUT_DIR = path.isAbsolute(outDirArg) ? outDirArg : path.join(ROOT_DIR, outDirArg);
const ENRICH_OUT_DIR = path.join(OUTPUT_DIR, "enrich-stream-concurrency-gate");
const BULK_OUT_DIR = path.join(OUTPUT_DIR, "bulk-barcode-e2e");
const UL_OUT_DIR = path.join(OUTPUT_DIR, "ods-ul-visibility");
const REPORT_JSON_PATH = path.join(OUTPUT_DIR, "gate_full_report.json");
const REPORT_MD_PATH = path.join(OUTPUT_DIR, "gate_full_report.md");
const WRITE_POLICY_SHADOW_REPORT_PATH = path.join(OUTPUT_DIR, "write_policy_shadow_report.json");
const CANDIDATES_QUALITY_REPORT_PATH = path.join(OUTPUT_DIR, "candidates_quality_report.json");
const NEGATIVE_CACHE_RESIDUAL_REPORT_PATH = path.join(OUTPUT_DIR, "negative_cache_residual_report.json");
const SURFACE_CONSISTENCY_REPORT_PATH = path.join(OUTPUT_DIR, "surface_consistency_report.json");
const REPAIR_QUEUE_JSON_PATH = path.join(OUTPUT_DIR, "authoritative_expected_not_final_repair_queue.json");
const REPAIR_QUEUE_MD_PATH = path.join(OUTPUT_DIR, "authoritative_expected_not_final_repair_queue.md");

const manageBackend = hasFlag("manage-backend") || boolFromEnv(process.env.RUN_BACKEND_GATES_MANAGE_BACKEND, false);
const backendCmd = getArg("backend-cmd") || process.env.RUN_BACKEND_GATES_BACKEND_CMD || "PORT=3001 node backend/dist/server.js";
const healthUrl = getArg("health-url") || process.env.RUN_BACKEND_GATES_HEALTH_URL || `${API_BASE_URL}/`;
const startupTimeoutMs = Number(getArg("startup-timeout-ms") || process.env.RUN_BACKEND_GATES_STARTUP_TIMEOUT_MS || 120000);
const healthIntervalMs = Number(getArg("health-interval-ms") || process.env.RUN_BACKEND_GATES_HEALTH_INTERVAL_MS || 2000);
const skipConcurrency = hasFlag("skip-concurrency");
const skipBulk = hasFlag("skip-bulk");
const skipUl = hasFlag("skip-ul");
const skipShadowReports = hasFlag("skip-shadow-reports");
const SHADOW_REPORTS_ENFORCE = !["0", "false", "off"].includes(
  String(process.env.MAINTAINER_GATES_SHADOW_REPORTS_ENFORCE || "1").toLowerCase(),
);
const enrichStreamGateStreamMode = String(
  process.env.ENRICH_STREAM_GATE_STREAM_MODE || "analysis_bundle_only",
).trim();
const FOCUS_BARCODE = String(getArg("focus-barcode") || process.env.MAINTAINER_GATES_FOCUS_BARCODE || "00084783891253")
  .replace(/\D/g, "")
  .padStart(14, "0");
const ulBarcodesFile =
  getArg("ul-barcodes-file") ||
  process.env.ODS_UL_VIS_BARCODES_FILE ||
  path.join("scripts", "maintainer", "fixtures", "ods_ul_visibility_barcodes.v1.json");
const ulGateEnforce = !["0", "false", "off"].includes(
  String(process.env.ODS_UL_GATE_ENFORCE || "1").toLowerCase(),
);
const mobileSoakSummaryArg =
  getArg("mobile-soak-summary") ||
  process.env.MOBILE_SOAK_SUMMARY_PATH ||
  null;
const mobileSoakSummaryPath = mobileSoakSummaryArg
  ? path.isAbsolute(mobileSoakSummaryArg)
    ? mobileSoakSummaryArg
    : path.join(ROOT_DIR, mobileSoakSummaryArg)
  : null;
const TERMINAL_REASON_WARN_THRESHOLD = Number(
  process.env.MAINTAINER_GATES_TERMINAL_REASON_WARN_THRESHOLD || 0.05,
);
const TERMINAL_REASON_FAIL_THRESHOLD = Number(
  process.env.MAINTAINER_GATES_TERMINAL_REASON_FAIL_THRESHOLD || 0.15,
);
const TERMINAL_REASON_NULL_SAMPLE_LIMIT = Number(
  process.env.MAINTAINER_GATES_TERMINAL_REASON_NULL_SAMPLE_LIMIT || 50,
);
const TERMINAL_REASON_TOPN_LIMIT = Number(
  process.env.MAINTAINER_GATES_TERMINAL_REASON_TOPN_LIMIT || 10,
);
const MOBILE_REGULATORY_RICH_RATE_MIN = Number(
  process.env.MAINTAINER_GATES_MOBILE_REGULATORY_RICH_RATE_MIN || 0.3,
);
const MOBILE_SCORE_VISIBLE_RATE_MIN = Number(
  process.env.MAINTAINER_GATES_MOBILE_SCORE_VISIBLE_RATE_MIN || 0.9,
);
const MOBILE_SCORE_VISIBLE_RATE_STRICT_MIN = Number(
  process.env.MAINTAINER_GATES_MOBILE_SCORE_VISIBLE_RATE_STRICT_MIN || 0.95,
);
const MOBILE_ESTER_CORE_RATE_ALL_MIN = Number(
  process.env.MAINTAINER_GATES_MOBILE_ESTER_CORE_RATE_ALL_MIN || 0.8,
);
const MOBILE_ESTER_CORE_RATE_FIXABLE_MIN = Number(
  process.env.MAINTAINER_GATES_MOBILE_ESTER_CORE_RATE_FIXABLE_MIN || 0.85,
);
const MOBILE_ESTER_CORE_RATE_LNHPD_MIN = Number(
  process.env.MAINTAINER_GATES_MOBILE_ESTER_CORE_RATE_LNHPD_MIN || 0.7,
);
const MOBILE_ESTER_CORE_RATE_DSLD_MIN = Number(
  process.env.MAINTAINER_GATES_MOBILE_ESTER_CORE_RATE_DSLD_MIN || 0.9,
);
const MOBILE_ESTER_UL_READY_ELIGIBLE_MIN = Number(
  process.env.MAINTAINER_GATES_MOBILE_ESTER_UL_READY_ELIGIBLE_MIN || 0.75,
);
const MOBILE_ESTER_UL_COMPARABLE_ELIGIBLE_WARN_MIN = Number(
  process.env.MAINTAINER_GATES_MOBILE_ESTER_UL_COMPARABLE_ELIGIBLE_WARN_MIN || 0.3,
);
const MOBILE_NOT_FOUND_TARGETED_MAX = Number(
  process.env.MAINTAINER_GATES_MOBILE_NOT_FOUND_TARGETED_MAX || 0.02,
);
const MOBILE_RELEASE_STRICT_ENFORCE = ["1", "true", "yes", "on"].includes(
  String(process.env.MAINTAINER_GATES_MOBILE_RELEASE_STRICT_ENFORCE || "0").toLowerCase(),
);
const MOBILE_KILLER_CLIENT_TIMEOUT_RATE_MAX = Number(
  process.env.MAINTAINER_GATES_MOBILE_KILLER_CLIENT_TIMEOUT_RATE_MAX || 0.05,
);
const MOBILE_KILLER_INFRA_UNAVAILABLE_WARN_RATE = Number(
  process.env.MAINTAINER_GATES_MOBILE_KILLER_INFRA_UNAVAILABLE_WARN_RATE || 0.3,
);
const MOBILE_RICHNESS_ENFORCE_HARD_FAIL = ["1", "true", "yes", "on"].includes(
  String(process.env.MAINTAINER_GATES_MOBILE_RICHNESS_ENFORCE || "0").toLowerCase(),
);
const FOCUS_PROBE_TIMEOUT_MS = Number(process.env.MAINTAINER_GATES_FOCUS_PROBE_TIMEOUT_MS || 30000);
const FOCUS_PROBE_RETRIES = Number(process.env.MAINTAINER_GATES_FOCUS_PROBE_RETRIES || 1);
const REPORT_FRESHNESS_MAX_AGE_MS = Number(
  process.env.MAINTAINER_GATES_REPORT_FRESHNESS_MAX_AGE_MS || 60 * 60 * 1000,
);
const EXPECTED_AUTH_DB_MIN_SUPPORT_COUNT = Number(
  process.env.MAINTAINER_GATES_EXPECTED_AUTH_DB_MIN_SUPPORT_COUNT || 3,
);
const EXPECTED_AUTH_DB_MIN_SPAN_DAYS = Number(
  process.env.MAINTAINER_GATES_EXPECTED_AUTH_DB_MIN_SPAN_DAYS || 7,
);
const EXPECTED_AUTH_DB_MIN_SOURCE_KINDS = Number(
  process.env.MAINTAINER_GATES_EXPECTED_AUTH_DB_MIN_SOURCE_KINDS || 2,
);
const expectedAuthoritativeArg =
  getArg("expected-authoritative-set") ||
  process.env.MAINTAINER_GATES_EXPECTED_AUTHORITATIVE_SET ||
  path.join("scripts", "maintainer", "fixtures", "expected_authoritative_set.v1.json");
const expectedAuthoritativePath = path.isAbsolute(expectedAuthoritativeArg)
  ? expectedAuthoritativeArg
  : path.join(ROOT_DIR, expectedAuthoritativeArg);
const repairQueueFallbackReportArg =
  getArg("repair-queue-fallback-report") ||
  process.env.MAINTAINER_GATES_REPAIR_QUEUE_FALLBACK_REPORT ||
  null;
const repairQueueFallbackReportPath = repairQueueFallbackReportArg
  ? path.isAbsolute(repairQueueFallbackReportArg)
    ? repairQueueFallbackReportArg
    : path.join(ROOT_DIR, repairQueueFallbackReportArg)
  : null;
const EXPECTED_AUTH_RESOLVED_PATH = path.join(OUTPUT_DIR, "expected_authoritative_set.resolved.json");
const SUPABASE_URL = process.env.SUPABASE_URL || process.env.EXPO_PUBLIC_SUPABASE_URL || "";
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || "";
const FOCUS_PROBE_SET = [
  { role: "lnhpd", barcode: "00064642079992" },
  { role: "dsld", barcode: "00690290532093" },
  { role: "web_hint", barcode: "00666183000154" },
  { role: "000847", barcode: "00084783891253" },
  { role: "killer", barcode: "00665553227870" },
];
const FOCUS_CRITICAL_ROLES = new Set(["lnhpd", "dsld", "web_hint", "000847"]);
const INFRA_MIN_SAMPLE = Number(process.env.MAINTAINER_GATES_INFRA_MIN_SAMPLE || 30);
const INFRA_HTTP503_RATE_MAX = Number(process.env.MAINTAINER_GATES_INFRA_HTTP503_RATE_MAX || 0.15);
const INFRA_REQUEST_ERROR_RATE_MAX = Number(process.env.MAINTAINER_GATES_INFRA_REQUEST_ERROR_RATE_MAX || 0.2);
const INFRA_IDENTITY_NULL_RATE_MAX = Number(process.env.MAINTAINER_GATES_INFRA_IDENTITY_NULL_RATE_MAX || 0.25);
const INFRA_SOURCE_TYPE_NULL_RATE_MAX = Number(
  process.env.MAINTAINER_GATES_INFRA_SOURCE_TYPE_NULL_RATE_MAX || 0.25,
);

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const readJson = async (filePath) => {
  try {
    const raw = await fs.readFile(filePath, "utf8");
    return JSON.parse(raw);
  } catch {
    return null;
  }
};

const toEpochMs = (value) => {
  if (typeof value !== "string" || !value.trim()) return null;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : null;
};

const getReportTimestampMs = async ({ report, reportPath }) => {
  const generatedAtCandidates = [
    report?.generatedAt,
    report?.generated_at,
    report?.meta?.generatedAt,
    report?.meta?.generated_at,
    report?.summary?.generatedAt,
    report?.summary?.generated_at,
  ];
  for (const candidate of generatedAtCandidates) {
    const parsed = toEpochMs(candidate);
    if (parsed != null) return parsed;
  }
  try {
    const stat = await fs.stat(reportPath);
    return Number.isFinite(stat?.mtimeMs) ? Number(stat.mtimeMs) : null;
  } catch {
    return null;
  }
};

const evaluateReportFreshness = async ({ reports, anchorMs, maxAgeMs }) => {
  const byKey = {};
  const staleReasons = [];
  for (const item of reports) {
    const key = String(item?.key || "");
    if (!key) continue;
    const required = Boolean(item?.required);
    const reportPath = item?.path ?? null;
    const report = item?.report ?? null;
    const timestampMs = reportPath ? await getReportTimestampMs({ report, reportPath }) : null;
    const ageMs = timestampMs != null ? Math.max(0, anchorMs - timestampMs) : null;
    const missing = required && !report;
    const stale = required && report && (timestampMs == null || (ageMs != null && ageMs > maxAgeMs));
    byKey[key] = {
      required,
      missing,
      stale,
      isFresh: required ? !missing && !stale : true,
      timestampMs,
      generatedAt: timestampMs != null ? new Date(timestampMs).toISOString() : null,
      ageMs,
      maxAgeMs,
      reportPath,
    };
    if (stale) staleReasons.push(`stale_report_${key}`);
  }
  return {
    generatedAt: new Date(anchorMs).toISOString(),
    maxAgeMs,
    staleReasons,
    byKey,
  };
};

const mergeCountMaps = (target, source) => {
  if (!source || typeof source !== "object") return;
  for (const [key, value] of Object.entries(source)) {
    if (!Number.isFinite(value)) continue;
    target[key] = (target[key] ?? 0) + Number(value);
  }
};

const countBy = (rows, readValue, fallback = "UNKNOWN") => {
  const counts = {};
  if (!Array.isArray(rows)) return counts;
  for (const row of rows) {
    const raw = readValue(row);
    const key = raw == null || String(raw).trim() === "" ? fallback : String(raw);
    counts[key] = (counts[key] ?? 0) + 1;
  }
  return counts;
};

const countBooleans = (rows, readValue) => {
  if (!Array.isArray(rows)) return { true: 0, false: 0, unknown: 0 };
  return rows.reduce(
    (acc, row) => {
      const value = readValue(row);
      if (value === true) acc.true += 1;
      else if (value === false) acc.false += 1;
      else acc.unknown += 1;
      return acc;
    },
    { true: 0, false: 0, unknown: 0 },
  );
};

const toGtin14 = (value) => {
  const digits = String(value ?? "").replace(/\D/g, "");
  if (!digits) return "";
  if (digits.length >= 14) return digits.slice(-14);
  return digits.padStart(14, "0");
};

const normalizeSourceType = (value) => {
  const normalized = String(value ?? "").trim().toLowerCase();
  if (!normalized) return "unknown";
  if (normalized === "lnhpd") return "lnhpd";
  if (normalized === "dsld") return "dsld";
  if (normalized === "web") return "web";
  return "unknown";
};

const normalizeTerminalReason = (value) => {
  if (value == null) return null;
  const text = String(value).trim();
  return text || null;
};

const normalizeProductIdentity = (value) => {
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
};

const isNullLikeTerminalReason = (value) => {
  const reason = normalizeTerminalReason(value);
  return !reason || reason.toUpperCase() === "UNKNOWN";
};

const normalizeTerminalFromErrorPayload = (payload) => {
  if (!payload || typeof payload !== "object") return null;
  const code = typeof payload.code === "string" ? payload.code.trim().toUpperCase() : "";
  if (code) return code;
  const message = typeof payload.message === "string" ? payload.message.trim() : "";
  if (message === "Product not found") return "NOT_FOUND";
  return null;
};

const classifyFailureClass = ({ terminal, timedOut, error, requestContext }) => {
  const requestError = terminal === "REQUEST_ERROR" || terminal === "HTTP_ERROR" || Boolean(error);
  const backendUnavailable =
    requestError &&
    /(fetch failed|econnrefused|econnreset|socket hang up|networkerror|enotfound|eai_again|backend unavailable)/i.test(
      String(error ?? ""),
    );
  const noiseFlags = {
    identityNull: !requestContext?.authoritativeIdentity?.value,
    sourceTypeNull: !requestContext?.sourceType,
    requestError,
    backendUnavailable,
  };
  let failureClass = null;
  if (terminal === "DONE") failureClass = null;
  else if (timedOut || terminal === "CLIENT_TIMEOUT") failureClass = "client_timeout";
  else if (backendUnavailable) failureClass = "infra_process";
  else if (terminal === "NOT_FOUND") failureClass = "data_gap";
  else if (requestError) failureClass = "stream_flow";
  else if (terminal) failureClass = "stream_flow";
  else failureClass = "unknown";
  return { failureClass, noiseFlags };
};

const aggregateScenarioCounts = (details, field) => {
  const acc = {};
  if (!Array.isArray(details)) return acc;
  for (const item of details) {
    if (!item || typeof item !== "object") continue;
    const source = item[field];
    if (!source || typeof source !== "object") continue;
    mergeCountMaps(acc, source);
  }
  return acc;
};

const aggregateMustDoneViolations = (details) => {
  const rows = [];
  if (!Array.isArray(details)) return rows;
  for (const scenario of details) {
    const list = Array.isArray(scenario?.mustDoneViolations) ? scenario.mustDoneViolations : [];
    for (const item of list) {
      rows.push({
        scenario: scenario?.name ?? "unknown",
        barcode: item?.barcode ?? null,
        terminal: item?.terminal ?? null,
        requestContext: item?.requestContext ?? null,
        rev1Identity: item?.rev1Identity ?? null,
        firstErrorTerminal: item?.firstErrorTerminal ?? null,
        lastErrorTerminal: item?.lastErrorTerminal ?? null,
      });
    }
  }
  return rows;
};

const extractBarcodeFocusRows = (details, barcode) => {
  const normalized = String(barcode ?? "").replace(/\D/g, "").padStart(14, "0");
  const rows = [];
  if (!Array.isArray(details)) return rows;
  for (const scenario of details) {
    const scenarioRows = Array.isArray(scenario?.rows) ? scenario.rows : [];
    for (const row of scenarioRows) {
      if (String(row?.barcode ?? "") !== normalized) continue;
      rows.push({
        scenario: scenario?.name ?? "unknown",
        round: row?.round ?? null,
        barcode: row?.barcode ?? null,
        terminal: row?.terminal ?? null,
        doneMs: row?.doneMs ?? null,
        rev1Ms: row?.rev1Ms ?? null,
        requestId: row?.requestContext?.requestId ?? null,
        failureClass: row?.failureClass ?? null,
        noiseFlags: row?.noiseFlags ?? null,
        requestContext: row?.requestContext ?? null,
        productIdentity: normalizeProductIdentity(row?.requestContext?.productIdentity) ?? null,
        terminalReason: row?.requestContext?.terminalReason ?? null,
        degradedMode:
          typeof row?.requestContext?.degradedMode === "boolean" ? row.requestContext.degradedMode : null,
        stage0Winner: row?.requestContext?.stage0Winner ?? null,
        stage0StartCount:
          Number.isFinite(Number(row?.requestContext?.stage0StartCount)) ? Number(row.requestContext.stage0StartCount) : null,
        stage0ReplaceCount:
          Number.isFinite(Number(row?.requestContext?.stage0ReplaceCount)) ? Number(row.requestContext.stage0ReplaceCount) : null,
        rev1Identity: row?.rev1Identity ?? null,
        firstErrorTerminal: row?.firstErrorTerminal ?? null,
        lastErrorTerminal: row?.lastErrorTerminal ?? null,
        errorEvents: row?.errorEvents ?? [],
      });
    }
  }
  return rows;
};

const summarizeFocusRows = (rows, parallelScenarioName = "parallel9") => {
  const terminalBreakdown = rows.reduce((acc, row) => {
    const key = row?.terminal ?? "NO_TERMINAL";
    acc[key] = (acc[key] ?? 0) + 1;
    return acc;
  }, {});
  const byScenario = rows.reduce((acc, row) => {
    const scenario = row?.scenario ?? "unknown";
    if (!acc[scenario]) {
      acc[scenario] = {
        total: 0,
        terminals: {},
      };
    }
    acc[scenario].total += 1;
    const terminal = row?.terminal ?? "NO_TERMINAL";
    acc[scenario].terminals[terminal] = (acc[scenario].terminals[terminal] ?? 0) + 1;
    return acc;
  }, {});
  const parallelRows = rows.filter((row) => row?.scenario === parallelScenarioName);
  const parallelNotFound = parallelRows.filter((row) => row?.terminal === "NOT_FOUND").length;
  const parallelNotFoundRate =
    parallelRows.length > 0 ? Number((parallelNotFound / parallelRows.length).toFixed(3)) : null;
  return {
    total: rows.length,
    terminalBreakdown,
    byScenario,
    parallelScenarioName,
    parallelNotFoundCount: parallelNotFound,
    parallelNotFoundRate,
  };
};

const normalizeNpnCandidate = (value) => {
  if (!value || typeof value !== "object") return null;
  const digits = String(value?.value ?? "").replace(/\D/g, "").trim();
  if (!digits) return null;
  const sourceKind = String(value?.sourceKind ?? "").trim() || "unknown";
  const stableReason = String(value?.stableReason ?? "").trim() || "unverified";
  const confidenceNum = Number(value?.confidence);
  return {
    value: digits,
    sourceKind,
    stableReason,
    confidence: Number.isFinite(confidenceNum) ? Number(confidenceNum.toFixed(3)) : 0,
  };
};

const readNpnCandidates = (row) => {
  const raw =
    row?.requestContext?.regulatoryIds?.npnCandidates ??
    row?.regulatoryIds?.npnCandidates ??
    row?.npnCandidates ??
    null;
  if (!Array.isArray(raw)) return [];
  const byValue = new Map();
  for (const item of raw) {
    const normalized = normalizeNpnCandidate(item);
    if (!normalized) continue;
    const existing = byValue.get(normalized.value);
    if (!existing || normalized.confidence > existing.confidence) {
      byValue.set(normalized.value, normalized);
    }
  }
  return [...byValue.values()].sort((a, b) => {
    const stableRank = (value) => {
      if (value === "verified_record") return 3;
      if (value === "stable_db") return 2;
      return 1;
    };
    const stableDiff = stableRank(b.stableReason) - stableRank(a.stableReason);
    if (stableDiff !== 0) return stableDiff;
    if (b.confidence !== a.confidence) return b.confidence - a.confidence;
    return a.value.localeCompare(b.value);
  });
};

const normalizeCandidateBackfill = (value) => {
  if (!value || typeof value !== "object") return null;
  const attempted = value?.attempted === true;
  const used = value?.used === true;
  const source = value?.source ? String(value.source) : null;
  const reasonCode = value?.reasonCode ? String(value.reasonCode) : null;
  const latencyMs = Number(value?.latencyMs);
  const scoreSuppressed = value?.scoreSuppressed === true;
  if (!attempted && !used && !source && !reasonCode && !scoreSuppressed && !Number.isFinite(latencyMs)) {
    return null;
  }
  return {
    attempted,
    used,
    source,
    reasonCode,
    latencyMs: Number.isFinite(latencyMs) ? Number(latencyMs) : null,
    scoreSuppressed,
  };
};

const readCandidateBackfill = (row) =>
  normalizeCandidateBackfill(
    row?.requestContext?.candidateBackfill ?? row?.candidateBackfill ?? null,
  );

const readScoreReasonCode = (row) => {
  const value = row?.requestContext?.scoreReasonCode ?? row?.scoreReasonCode ?? null;
  return value == null ? null : String(value);
};

const readScoreAvailable = (row) => {
  const value = row?.requestContext?.scoreAvailable ?? row?.scoreAvailable ?? null;
  return typeof value === "boolean" ? value : null;
};

const toRate = (numerator, denominator) =>
  denominator > 0 ? Number((numerator / denominator).toFixed(4)) : 0;

const normalizeErrorText = (value) => String(value ?? "").trim().toLowerCase();

const isRowHttp503Like = (row) => {
  const errorText = normalizeErrorText(row?.error);
  if (errorText.includes("http_503") || errorText.includes("status_503")) return true;
  if (/\b503\b/.test(errorText)) return true;
  return false;
};

const buildInfraTrust = (rows) => {
  const safeRows = Array.isArray(rows) ? rows : [];
  const totalRows = safeRows.length;
  const nonBundleLaneRows = safeRows.filter(
    (row) => String(row?.admissionLane ?? "").trim().toLowerCase() !== "bundle_only",
  );
  const identitySourceSampleRows = nonBundleLaneRows;
  const identitySourceChecksSkipped = identitySourceSampleRows.length === 0;
  const http503Count = safeRows.filter((row) => isRowHttp503Like(row)).length;
  const requestErrorCount = safeRows.filter((row) => {
    if (row?.noiseFlags?.requestError === true) return true;
    const terminal = String(row?.terminal ?? "").trim().toUpperCase();
    return terminal === "HTTP_ERROR" || terminal === "REQUEST_ERROR" || terminal === "NO_TERMINAL";
  }).length;
  const identityNullCount = identitySourceSampleRows.filter((row) => {
    if (typeof row?.noiseFlags?.identityNull === "boolean") return row.noiseFlags.identityNull;
    return !row?.authoritativeIdentity?.value;
  }).length;
  const sourceTypeNullCount = identitySourceSampleRows.filter((row) => {
    if (typeof row?.noiseFlags?.sourceTypeNull === "boolean") return row.noiseFlags.sourceTypeNull;
    return !row?.sourceType;
  }).length;

  const metrics = {
    totalRows,
    http503Count,
    http503Rate: toRate(http503Count, totalRows),
    requestErrorCount,
    requestErrorRate: toRate(requestErrorCount, totalRows),
    identitySourceSampleRows: identitySourceSampleRows.length,
    identitySourceChecksSkipped,
    identityNullRate: toRate(identityNullCount, identitySourceSampleRows.length),
    sourceTypeNullRate: toRate(sourceTypeNullCount, identitySourceSampleRows.length),
  };
  const thresholds = {
    minSample: INFRA_MIN_SAMPLE,
    http503RateMax: INFRA_HTTP503_RATE_MAX,
    requestErrorRateMax: INFRA_REQUEST_ERROR_RATE_MAX,
    identityNullRateMax: INFRA_IDENTITY_NULL_RATE_MAX,
    sourceTypeNullRateMax: INFRA_SOURCE_TYPE_NULL_RATE_MAX,
  };
  const triggeredBy = [];
  if (metrics.totalRows >= thresholds.minSample) {
    if (metrics.http503Rate > thresholds.http503RateMax) {
      triggeredBy.push(
        `http503Rate_${metrics.http503Rate}_gt_${thresholds.http503RateMax}`,
      );
    }
    if (metrics.requestErrorRate > thresholds.requestErrorRateMax) {
      triggeredBy.push(
        `requestErrorRate_${metrics.requestErrorRate}_gt_${thresholds.requestErrorRateMax}`,
      );
    }
    if (metrics.identityNullRate > thresholds.identityNullRateMax) {
      triggeredBy.push(
        `identityNullRate_${metrics.identityNullRate}_gt_${thresholds.identityNullRateMax}`,
      );
    }
    if (metrics.sourceTypeNullRate > thresholds.sourceTypeNullRateMax) {
      triggeredBy.push(
        `sourceTypeNullRate_${metrics.sourceTypeNullRate}_gt_${thresholds.sourceTypeNullRateMax}`,
      );
    }
  }
  const infraUntrusted = triggeredBy.length > 0;
  return {
    infraUntrusted,
    classification: infraUntrusted ? "infra_untrusted" : "trusted",
    triggeredBy,
    metrics,
    thresholds,
  };
};

const isFocusFailureCandidate = (row) => {
  const terminal = String(row?.terminal ?? "").trim().toUpperCase();
  return (terminal === "CLIENT_TIMEOUT" || terminal === "REQUEST_ERROR") && !row?.requestId;
};

const detectFocusContamination = (rows) => {
  const safeRows = Array.isArray(rows) ? rows : [];
  const firstFailureIdx = safeRows.findIndex((row) => isFocusFailureCandidate(row));
  if (firstFailureIdx < 0) {
    return {
      detected: false,
      summary: null,
    };
  }
  const firstFailureRole = safeRows[firstFailureIdx]?.role ?? null;
  const cascadeRows = safeRows.slice(firstFailureIdx + 1).filter((row) => isFocusFailureCandidate(row));
  const affectedRoles = Array.from(
    new Set(cascadeRows.map((row) => row?.role).filter(Boolean)),
  ).sort((a, b) => a.localeCompare(b));
  const cascadeFailureCount = cascadeRows.length;
  const detected = firstFailureRole !== "killer" && cascadeFailureCount > 0;
  return {
    detected,
    summary: detected
      ? {
          firstFailureRole,
          cascadeFailureCount,
          affectedRoles,
        }
      : null,
  };
};

const buildNpnCandidateStats = (rows) => {
  const safeRows = Array.isArray(rows) ? rows : [];
  const stableReasonCounts = {};
  const sourceKindCounts = {};
  const topStableReasonCounts = {};
  const uniqueValues = new Set();
  let rowsWithCandidates = 0;
  let totalCandidateCount = 0;
  let candidateBackfillAttempted = 0;
  let candidateBackfillUsed = 0;
  let candidateBackfillRejectedMismatch = 0;
  let candidateBackfillTimeout = 0;
  let candidateBackfillNotFound = 0;
  let scoreSuppressedByCandidateBackfillCount = 0;

  for (const row of safeRows) {
    const candidates = readNpnCandidates(row);
    if (candidates.length > 0) {
      rowsWithCandidates += 1;
      totalCandidateCount += candidates.length;
      topStableReasonCounts[candidates[0].stableReason] =
        (topStableReasonCounts[candidates[0].stableReason] ?? 0) + 1;
    }
    for (const candidate of candidates) {
      uniqueValues.add(candidate.value);
      stableReasonCounts[candidate.stableReason] =
        (stableReasonCounts[candidate.stableReason] ?? 0) + 1;
      sourceKindCounts[candidate.sourceKind] =
        (sourceKindCounts[candidate.sourceKind] ?? 0) + 1;
    }

    const backfill = readCandidateBackfill(row);
    if (!backfill) continue;
    if (backfill.attempted) candidateBackfillAttempted += 1;
    if (backfill.used) candidateBackfillUsed += 1;
    const reasonCode = String(backfill.reasonCode ?? "").toUpperCase();
    if (reasonCode === "CANDIDATE_IDENTITY_MISMATCH") candidateBackfillRejectedMismatch += 1;
    if (reasonCode === "CANDIDATE_LOOKUP_TIMEOUT") candidateBackfillTimeout += 1;
    if (reasonCode === "CANDIDATE_LOOKUP_NOT_FOUND") candidateBackfillNotFound += 1;

    const scoreReasonCode = String(readScoreReasonCode(row) ?? "").toUpperCase();
    const scoreAvailable = readScoreAvailable(row);
    const sourceTypeFinal = row?.sourceTypeFinal === true;
    const scoreSuppressed =
      backfill.scoreSuppressed === true ||
      scoreReasonCode === "CANDIDATE_MATCH_NOT_FINAL" ||
      (backfill.used === true && sourceTypeFinal !== true && scoreAvailable === false);
    if (scoreSuppressed) scoreSuppressedByCandidateBackfillCount += 1;
  }

  return {
    totalRows: safeRows.length,
    rowsWithCandidates,
    rowsWithCandidatesRate: toRate(rowsWithCandidates, safeRows.length),
    totalCandidateCount,
    uniqueCandidateValueCount: uniqueValues.size,
    stableReasonCounts,
    sourceKindCounts,
    topStableReasonCounts,
    candidateBackfillAttempted,
    candidateBackfillUsed,
    candidateBackfillRejectedMismatch,
    candidateBackfillTimeout,
    candidateBackfillNotFound,
    scoreSuppressedByCandidateBackfillCount,
  };
};

const buildRepairQueueFromViolations = (violations) => {
  const rows = Array.isArray(violations)
    ? violations.filter((row) => row?.bucket === "expected_but_not_final")
    : [];
  const uniqueRows = [];
  const seen = new Set();
  for (const row of rows) {
    const barcode = toGtin14(row?.barcode);
    if (!barcode) continue;
    const scenario = row?.scenario ? String(row.scenario) : "unknown";
    const requestId = row?.requestId ? String(row.requestId) : "null";
    const dedupeKey = `${barcode}::${scenario}::${requestId}`;
    if (seen.has(dedupeKey)) continue;
    seen.add(dedupeKey);
    uniqueRows.push({
      ...row,
      barcode,
      scenario,
      requestId: requestId === "null" ? null : requestId,
    });
  }
  const grouped = new Map();
  for (const row of uniqueRows) {
    const barcode = row.barcode;
    const existing = grouped.get(barcode) ?? {
      barcode,
      occurrences: 0,
      scenarios: new Set(),
      requestIds: new Set(),
      slots: new Set(),
      sourceTypes: new Set(),
      expectedSetReason: null,
    };
    existing.occurrences += 1;
    if (row?.scenario) existing.scenarios.add(String(row.scenario));
    if (row?.requestId) existing.requestIds.add(String(row.requestId));
    if (Number.isFinite(Number(row?.slot))) existing.slots.add(Number(row.slot));
    if (row?.sourceType) existing.sourceTypes.add(String(row.sourceType));
    if (!existing.expectedSetReason && row?.expectedSetReason) {
      existing.expectedSetReason = String(row.expectedSetReason);
    }
    grouped.set(barcode, existing);
  }
  return [...grouped.values()]
    .sort((a, b) => a.barcode.localeCompare(b.barcode))
    .map((item) => ({
      barcode: item.barcode,
      occurrences: item.occurrences,
      scenarios: [...item.scenarios].sort((a, b) => a.localeCompare(b)),
      requestIds: [...item.requestIds].sort((a, b) => a.localeCompare(b)),
      slots: [...item.slots].sort((a, b) => a - b),
      sourceTypes: [...item.sourceTypes].sort((a, b) => a.localeCompare(b)),
      expectedSetReason: item.expectedSetReason ?? null,
    }));
};

const repairQueueToMarkdown = (payload) => {
  const lines = [];
  lines.push("# Authoritative Expected-Not-Final Repair Queue");
  lines.push("");
  lines.push(`- Generated: ${payload.generatedAt}`);
  lines.push(`- queueSource: ${payload.queueSource}`);
  lines.push(`- sourceReport: ${payload.sourceReport}`);
  lines.push(`- infraUntrusted: ${payload.infraUntrusted}`);
  lines.push(`- fallbackUsed: ${payload.fallbackUsed}`);
  if (payload.fallbackReport) lines.push(`- fallbackReport: ${payload.fallbackReport}`);
  lines.push(`- queueSize: ${payload.repairQueue.length}`);
  lines.push("");
  if (payload.repairQueue.length > 0) {
    lines.push("## Items");
    lines.push("");
    payload.repairQueue.forEach((item) => {
      lines.push(
        `- barcode=${item.barcode} occurrences=${item.occurrences} scenarios=${item.scenarios.join(",") || "none"} slots=${item.slots.join(",") || "none"} sourceTypes=${item.sourceTypes.join(",") || "none"} reason=${item.expectedSetReason ?? "none"} requestIds=${item.requestIds.slice(0, 10).join(",") || "none"}`,
      );
    });
    lines.push("");
  }
  return `${lines.join("\n").trim()}\n`;
};

const isInfraReason = (reason) => {
  const text = String(reason ?? "");
  return (
    /^concurrency_gate_exit_/.test(text) ||
    /^bulk_gate_exit_/.test(text) ||
    /^ul_visibility_exit_/.test(text) ||
    /^ul_coverage_gate_exit_/.test(text) ||
    /_report_missing$/.test(text) ||
    /^terminal_reason_null_like_rate_/.test(text) ||
    /^focus_probe_incomplete_/.test(text) ||
    /^focus_role_missing_/.test(text) ||
    /^ul_coverage_inconclusive_/.test(text) ||
    /^infra_untrusted_/.test(text)
  );
};

const rowBarcodeCandidates = (row) => {
  if (!row || typeof row !== "object") return [];
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
    const value = toGtin14(row?.[key]);
    if (!value) continue;
    out.push(value);
  }
  return Array.from(new Set(out));
};

const looksLikeDsldRow = (row) => {
  const outcome = String(row?.outcome ?? "").toLowerCase();
  if (outcome.includes("dsld")) return true;
  const signals = row?.signals;
  if (!signals) return false;
  const signalText = JSON.stringify(signals).toLowerCase();
  return signalText.includes("dsld") || signalText.includes("labelid") || signalText.includes("dsldlabelid");
};

const parseOptionalDate = (value) => {
  if (!value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return date.toISOString();
};

const extractEvidenceTimestamp = (row) => {
  if (!row || typeof row !== "object") return null;
  const candidates = [
    row.updated_at,
    row.last_seen_at,
    row.observed_at,
    row.created_at,
    row.inserted_at,
  ];
  for (const candidate of candidates) {
    const parsed = parseOptionalDate(candidate);
    if (parsed) return parsed;
  }
  return null;
};

const computeSpanDays = (firstSeenAt, lastSeenAt) => {
  if (!firstSeenAt || !lastSeenAt) return null;
  const first = new Date(firstSeenAt).getTime();
  const last = new Date(lastSeenAt).getTime();
  if (!Number.isFinite(first) || !Number.isFinite(last)) return null;
  const spanMs = Math.max(0, last - first);
  return Number((spanMs / 86400000).toFixed(2));
};

const registerDbEvidence = (dbEvidenceMap, barcode, evidenceKind, row) => {
  if (!barcode) return;
  const existing = dbEvidenceMap.get(barcode) ?? {
    barcode,
    supportCount: 0,
    sourceKinds: new Set(),
    firstSeenAt: null,
    lastSeenAt: null,
    timestampSamples: 0,
    reasons: new Set(),
  };
  existing.supportCount += 1;
  existing.sourceKinds.add(evidenceKind);
  existing.reasons.add(evidenceKind);
  const seenAt = extractEvidenceTimestamp(row);
  if (seenAt) {
    existing.timestampSamples += 1;
    if (!existing.firstSeenAt || seenAt < existing.firstSeenAt) existing.firstSeenAt = seenAt;
    if (!existing.lastSeenAt || seenAt > existing.lastSeenAt) existing.lastSeenAt = seenAt;
  }
  dbEvidenceMap.set(barcode, existing);
};

const readExpectedAuthoritativeFixture = async (fixturePath) => {
  const raw = await readJson(fixturePath);
  const rows = Array.isArray(raw?.barcodes) ? raw.barcodes : [];
  const items = [];
  for (const row of rows) {
    const barcode = toGtin14(row?.barcode);
    if (!barcode) continue;
    items.push({
      barcode,
      reason: typeof row?.reason === "string" ? row.reason : "fixture",
      expectedFinal: row?.expectedFinal !== false,
      source: "fixture",
      enforcement: "hard_fail",
    });
  }
  return {
    path: fixturePath,
    version: typeof raw?.version === "string" ? raw.version : null,
    generatedAt: raw?.generatedAt ?? null,
    items,
  };
};

const resolveExpectedAuthoritativeSet = async (fixturePath) => {
  const fixture = await readExpectedAuthoritativeFixture(fixturePath);
  const merged = new Map();
  fixture.items.forEach((row) => {
    merged.set(row.barcode, row);
  });
  const fixtureBarcodeSet = new Set(fixture.items.map((item) => item.barcode));
  const dbEvidenceMap = new Map();

  const dbSummary = {
    enabled: Boolean(SUPABASE_URL && SUPABASE_SERVICE_ROLE_KEY),
    barcodeRegulatoryMapCount: 0,
    barcodeResolutionTrainingCount: 0,
    selectedCount: 0,
    rejectedUnstableCount: 0,
    evidenceCandidateCount: 0,
    selectedBarcodesPreview: [],
    errors: [],
    thresholds: {
      minSupportCount: EXPECTED_AUTH_DB_MIN_SUPPORT_COUNT,
      minSpanDays: EXPECTED_AUTH_DB_MIN_SPAN_DAYS,
      minSourceKinds: EXPECTED_AUTH_DB_MIN_SOURCE_KINDS,
    },
  };

  if (dbSummary.enabled) {
    try {
      const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
        auth: { persistSession: false, autoRefreshToken: false },
      });

      const { data: mapRows, error: mapError } = await supabase
        .from("barcode_regulatory_map")
        .select("*")
        .limit(3000);
      if (mapError) {
        dbSummary.errors.push(`barcode_regulatory_map:${mapError.message}`);
      } else if (Array.isArray(mapRows)) {
        for (const row of mapRows) {
          const hasNpn = Boolean(String(row?.npn ?? "").replace(/\D/g, ""));
          if (!hasNpn) continue;
          for (const barcode of rowBarcodeCandidates(row)) {
            if (!barcode) continue;
            dbSummary.barcodeRegulatoryMapCount += 1;
            if (fixtureBarcodeSet.has(barcode)) continue;
            registerDbEvidence(dbEvidenceMap, barcode, "db_barcode_regulatory_map_npn", row);
          }
        }
      }

      const { data: trainingRows, error: trainingError } = await supabase
        .from("barcode_resolution_training")
        .select("*")
        .limit(3000);
      if (trainingError) {
        dbSummary.errors.push(`barcode_resolution_training:${trainingError.message}`);
      } else if (Array.isArray(trainingRows)) {
        for (const row of trainingRows) {
          if (!looksLikeDsldRow(row)) continue;
          for (const barcode of rowBarcodeCandidates(row)) {
            if (!barcode) continue;
            dbSummary.barcodeResolutionTrainingCount += 1;
            if (fixtureBarcodeSet.has(barcode)) continue;
            registerDbEvidence(dbEvidenceMap, barcode, "db_barcode_resolution_training_dsld", row);
          }
        }
      }
    } catch (error) {
      dbSummary.errors.push(error instanceof Error ? error.message : String(error));
    }
  }

  const dbEvidenceCandidates = [...dbEvidenceMap.values()].map((entry) => {
    const sourceKinds = [...entry.sourceKinds].sort();
    const reasons = [...entry.reasons].sort();
    const spanDays = computeSpanDays(entry.firstSeenAt, entry.lastSeenAt);
    const hasEnoughSupport = entry.supportCount >= EXPECTED_AUTH_DB_MIN_SUPPORT_COUNT;
    const stableBySupportAndTime =
      hasEnoughSupport &&
      spanDays != null &&
      spanDays >= EXPECTED_AUTH_DB_MIN_SPAN_DAYS;
    const stableByCrossSource =
      hasEnoughSupport &&
      sourceKinds.length >= EXPECTED_AUTH_DB_MIN_SOURCE_KINDS;
    const stableEvidence = stableBySupportAndTime || stableByCrossSource;
    return {
      barcode: entry.barcode,
      supportCount: entry.supportCount,
      sourceKinds,
      reasons,
      timestampSamples: entry.timestampSamples,
      firstSeenAt: entry.firstSeenAt,
      lastSeenAt: entry.lastSeenAt,
      spanDays,
      stableEvidence,
      stableReason: stableBySupportAndTime
        ? "support_and_time_span"
        : stableByCrossSource
          ? "support_and_multi_source"
          : "insufficient_stability",
    };
  });
  dbSummary.evidenceCandidateCount = dbEvidenceCandidates.length;

  const stableDbRows = dbEvidenceCandidates
    .filter((entry) => entry.stableEvidence)
    .sort((a, b) => a.barcode.localeCompare(b.barcode));
  const unstableDbRows = dbEvidenceCandidates
    .filter((entry) => !entry.stableEvidence)
    .sort((a, b) => a.barcode.localeCompare(b.barcode));

  stableDbRows.forEach((entry) => {
    if (merged.has(entry.barcode)) return;
    merged.set(entry.barcode, {
      barcode: entry.barcode,
      reason: entry.reasons[0] ?? "db_stable_expected_authoritative",
      expectedFinal: true,
      source: "db",
      enforcement: "warning_only",
      stableEvidence: {
        supportCount: entry.supportCount,
        sourceKinds: entry.sourceKinds,
        spanDays: entry.spanDays,
        firstSeenAt: entry.firstSeenAt,
        lastSeenAt: entry.lastSeenAt,
        stableReason: entry.stableReason,
      },
    });
  });
  dbSummary.selectedCount = stableDbRows.length;
  dbSummary.rejectedUnstableCount = unstableDbRows.length;
  dbSummary.selectedBarcodesPreview = stableDbRows.slice(0, 50).map((entry) => ({
    barcode: entry.barcode,
    supportCount: entry.supportCount,
    sourceKinds: entry.sourceKinds,
    spanDays: entry.spanDays,
    stableReason: entry.stableReason,
  }));

  const resolved = {
    version: "v1",
    generatedAt: new Date().toISOString(),
    fixture: {
      path: fixture.path,
      version: fixture.version,
      generatedAt: fixture.generatedAt,
      count: fixture.items.length,
    },
    db: dbSummary,
    enforcementSummary: {
      hardFailCount: fixture.items.length,
      warningOnlyCount: stableDbRows.length,
    },
    barcodes: [...merged.values()]
      .sort((a, b) => a.barcode.localeCompare(b.barcode))
      .map((row) => ({
        barcode: row.barcode,
        reason: row.reason,
        expectedFinal: row.expectedFinal !== false,
        source: row.source,
        enforcement: row.enforcement ?? (row.source === "fixture" ? "hard_fail" : "warning_only"),
        stableEvidence: row.stableEvidence ?? null,
      })),
    dbRejectedUnstablePreview: unstableDbRows.slice(0, 50).map((entry) => ({
      barcode: entry.barcode,
      supportCount: entry.supportCount,
      sourceKinds: entry.sourceKinds,
      spanDays: entry.spanDays,
      stableReason: entry.stableReason,
    })),
  };
  return resolved;
};

const runFocusProbeOne = async (role, barcode, options = {}) => {
  const retries = Number.isFinite(options.retries) ? options.retries : FOCUS_PROBE_RETRIES;
  const timeoutMs = Number.isFinite(options.timeoutMs) ? options.timeoutMs : FOCUS_PROBE_TIMEOUT_MS;
  const payload = { barcode };
  const headers = {
    "Content-Type": "application/json",
    Accept: "text/event-stream",
    ...(process.env.RENDER_REGRESSION_TOKEN || process.env.REGRESSION_AUTH_TOKEN
      ? {
          "x-regression-token": process.env.RENDER_REGRESSION_TOKEN || process.env.REGRESSION_AUTH_TOKEN,
        }
      : { "x-auth-disabled": "1" }),
  };

  let lastError = null;
  for (let attempt = 0; attempt <= retries; attempt += 1) {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(new Error(`focus_timeout_${timeoutMs}ms`)), timeoutMs);
    const startedAt = Date.now();
    let rev1Ms = null;
    let doneMs = null;
    let requestId = null;
    let doneSeen = false;
    let timedOut = false;
    const errorEvents = [];
    let rev1Context = null;
    let doneContext = null;

    try {
      const res = await fetch(`${API_BASE_URL}/api/enrich-stream`, {
        method: "POST",
        headers,
        body: JSON.stringify(payload),
        signal: ctrl.signal,
      });
      if (!res.ok || !res.body) {
        const text = await res.text().catch(() => "");
        throw new Error(`focus_http_${res.status}:${text.slice(0, 120)}`);
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
          // ignore json parse errors
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
          const productIdentity = normalizeProductIdentity(data?.meta?.productIdentity);
          const revision = Number(data?.meta?.revision);
          if (revision >= 1 && rev1Ms == null) rev1Ms = tMs;
          if (revision >= 1) {
            const rawNpnCandidates = Array.isArray(data?.meta?.regulatoryIds?.npnCandidates)
              ? data.meta.regulatoryIds.npnCandidates
              : [];
            const npnCandidates = rawNpnCandidates
              .map((item) => normalizeNpnCandidate(item))
              .filter(Boolean)
              .slice(0, 3);
            const candidateBackfill = normalizeCandidateBackfill(data?.meta?.candidateBackfill ?? null);
            rev1Context = {
              sourceType: typeof data?.meta?.sourceType === "string" ? data.meta.sourceType : null,
              sourceTypeFinal:
                typeof data?.meta?.sourceTypeFinal === "boolean" ? data.meta.sourceTypeFinal : null,
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
              terminalReason:
                typeof data?.meta?.terminalReason === "string" ? data.meta.terminalReason : null,
              degradedMode:
                typeof data?.meta?.degradedMode === "boolean" ? data.meta.degradedMode : null,
              stage0Winner:
                typeof data?.meta?.stage0Winner === "string" ? data.meta.stage0Winner : null,
              stage0StartCount:
                Number.isFinite(Number(data?.meta?.stage0StartCount)) ? Number(data.meta.stage0StartCount) : null,
              stage0ReplaceCount:
                Number.isFinite(Number(data?.meta?.stage0ReplaceCount))
                  ? Number(data.meta.stage0ReplaceCount)
                  : null,
              productIdentity: productIdentity ?? rev1Context?.productIdentity ?? null,
              regulatoryIds:
                npnCandidates.length > 0
                  ? {
                      npnCandidates,
                    }
                  : rev1Context?.regulatoryIds ?? null,
              candidateBackfill: candidateBackfill ?? rev1Context?.candidateBackfill ?? null,
              scoreReasonCode:
                typeof data?.meta?.scoreReasonCode === "string"
                  ? data.meta.scoreReasonCode
                  : rev1Context?.scoreReasonCode ?? null,
              scoreAvailable:
                typeof data?.meta?.scoreAvailable === "boolean"
                  ? data.meta.scoreAvailable
                  : typeof rev1Context?.scoreAvailable === "boolean"
                    ? rev1Context.scoreAvailable
                    : null,
            };
          } else if (productIdentity && !rev1Context?.productIdentity) {
            rev1Context = {
              ...(rev1Context ?? {}),
              productIdentity,
            };
          }
        }
        if (currentEvent === "error") {
          errorEvents.push({
            tMs,
            terminal: normalizeTerminalFromErrorPayload(data) ?? "ERROR",
            code: typeof data?.code === "string" ? data.code : null,
            reasonCode: typeof data?.reasonCode === "string" ? data.reasonCode : null,
            message: typeof data?.message === "string" ? data.message : null,
          });
        }
        if (currentEvent === "done") {
          doneSeen = true;
          doneMs = tMs;
          if (data && typeof data === "object") {
            doneContext = {
              terminalReason:
                typeof data?.terminalReason === "string" ? data.terminalReason : null,
              degradedMode:
                typeof data?.degradedMode === "boolean" ? data.degradedMode : null,
              stage0Winner:
                typeof data?.stage0Winner === "string" ? data.stage0Winner : null,
              stage0StartCount:
                Number.isFinite(Number(data?.stage0StartCount)) ? Number(data.stage0StartCount) : null,
              stage0ReplaceCount:
                Number.isFinite(Number(data?.stage0ReplaceCount)) ? Number(data.stage0ReplaceCount) : null,
            };
          }
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
          else if (line.startsWith("data:")) currentData += line.slice("data:".length).trim();
        }
        if (doneSeen) {
          await reader.cancel().catch(() => undefined);
          break;
        }
      }
      flushEvent();
      if (doneSeen) {
        await reader.cancel().catch(() => undefined);
      }
      const terminalFromErrors = [...errorEvents].reverse().find((row) => row?.terminal)?.terminal ?? null;
      const terminal = doneSeen ? "DONE" : terminalFromErrors ?? "NO_TERMINAL";
      const requestContext = {
        requestId,
        terminal,
        sourceType: rev1Context?.sourceType ?? null,
        sourceTypeFinal: rev1Context?.sourceTypeFinal ?? null,
        authoritativeIdentity: rev1Context?.authoritativeIdentity ?? null,
        productIdentity: rev1Context?.productIdentity ?? null,
        regulatoryIds: rev1Context?.regulatoryIds ?? null,
        candidateBackfill: rev1Context?.candidateBackfill ?? null,
        scoreReasonCode: rev1Context?.scoreReasonCode ?? null,
        scoreAvailable:
          typeof rev1Context?.scoreAvailable === "boolean" ? rev1Context.scoreAvailable : null,
        terminalReason: doneContext?.terminalReason ?? rev1Context?.terminalReason ?? null,
        degradedMode:
          typeof doneContext?.degradedMode === "boolean"
            ? doneContext.degradedMode
            : typeof rev1Context?.degradedMode === "boolean"
              ? rev1Context.degradedMode
              : null,
        stage0Winner: doneContext?.stage0Winner ?? rev1Context?.stage0Winner ?? null,
        stage0StartCount:
          Number.isFinite(Number(doneContext?.stage0StartCount))
            ? Number(doneContext.stage0StartCount)
            : Number.isFinite(Number(rev1Context?.stage0StartCount))
              ? Number(rev1Context.stage0StartCount)
              : null,
        stage0ReplaceCount:
          Number.isFinite(Number(doneContext?.stage0ReplaceCount))
            ? Number(doneContext.stage0ReplaceCount)
            : Number.isFinite(Number(rev1Context?.stage0ReplaceCount))
              ? Number(rev1Context.stage0ReplaceCount)
              : null,
      };
      const diagnostics = classifyFailureClass({
        terminal,
        timedOut,
        error: null,
        requestContext,
      });
      return {
        role,
        barcode,
        route: "/api/enrich-stream",
        scenario: "focus_probe",
        terminal,
        requestId,
        sourceType: requestContext.sourceType ?? null,
        sourceTypeFinal:
          typeof requestContext.sourceTypeFinal === "boolean" ? requestContext.sourceTypeFinal : null,
        productIdentity: requestContext.productIdentity ?? null,
        terminalReason: requestContext.terminalReason ?? null,
        degradedMode:
          typeof requestContext.degradedMode === "boolean" ? requestContext.degradedMode : null,
        stage0Winner: requestContext.stage0Winner ?? null,
        stage0StartCount: requestContext.stage0StartCount ?? null,
        stage0ReplaceCount: requestContext.stage0ReplaceCount ?? null,
        authoritativeIdentity: requestContext.authoritativeIdentity ?? null,
        regulatoryIds: requestContext.regulatoryIds ?? null,
        candidateBackfill: requestContext.candidateBackfill ?? null,
        scoreReasonCode: requestContext.scoreReasonCode ?? null,
        scoreAvailable:
          typeof requestContext.scoreAvailable === "boolean" ? requestContext.scoreAvailable : null,
        failureClass: diagnostics.failureClass,
        noiseFlags: diagnostics.noiseFlags,
        doneMs,
        rev1Ms,
        attempt,
      };
    } catch (error) {
      lastError = error;
      timedOut = /focus_timeout_/i.test(String(error?.message ?? ""));
      if (attempt >= retries) {
        const terminal = timedOut ? "CLIENT_TIMEOUT" : "REQUEST_ERROR";
        const requestContext = {
          requestId,
          terminal,
          sourceType: rev1Context?.sourceType ?? null,
          sourceTypeFinal:
            typeof rev1Context?.sourceTypeFinal === "boolean" ? rev1Context.sourceTypeFinal : null,
          authoritativeIdentity: rev1Context?.authoritativeIdentity ?? null,
          productIdentity: rev1Context?.productIdentity ?? null,
          regulatoryIds: rev1Context?.regulatoryIds ?? null,
          candidateBackfill: rev1Context?.candidateBackfill ?? null,
          scoreReasonCode: rev1Context?.scoreReasonCode ?? null,
          scoreAvailable:
            typeof rev1Context?.scoreAvailable === "boolean" ? rev1Context.scoreAvailable : null,
          terminalReason: terminal,
          degradedMode: null,
          stage0Winner: null,
          stage0StartCount: null,
          stage0ReplaceCount: null,
        };
        const diagnostics = classifyFailureClass({
          terminal,
          timedOut,
          error: error instanceof Error ? error.message : String(error),
          requestContext,
        });
        return {
          role,
          barcode,
          route: "/api/enrich-stream",
          scenario: "focus_probe",
          terminal,
          requestId,
          sourceType: requestContext.sourceType ?? null,
          sourceTypeFinal:
            typeof requestContext.sourceTypeFinal === "boolean" ? requestContext.sourceTypeFinal : null,
          productIdentity: requestContext.productIdentity ?? null,
          terminalReason: requestContext.terminalReason ?? null,
          degradedMode: requestContext.degradedMode,
          stage0Winner: requestContext.stage0Winner,
          stage0StartCount: requestContext.stage0StartCount,
          stage0ReplaceCount: requestContext.stage0ReplaceCount,
          authoritativeIdentity: requestContext.authoritativeIdentity ?? null,
          regulatoryIds: requestContext.regulatoryIds ?? null,
          candidateBackfill: requestContext.candidateBackfill ?? null,
          scoreReasonCode: requestContext.scoreReasonCode ?? null,
          scoreAvailable:
            typeof requestContext.scoreAvailable === "boolean" ? requestContext.scoreAvailable : null,
          failureClass: diagnostics.failureClass,
          noiseFlags: diagnostics.noiseFlags,
          doneMs: null,
          rev1Ms,
          attempt,
          error: error instanceof Error ? error.message : String(error),
        };
      }
      await sleep(250 * (attempt + 1));
    } finally {
      clearTimeout(timer);
    }
  }

  return {
    role,
    barcode,
    route: "/api/enrich-stream",
    scenario: "focus_probe",
    terminal: "REQUEST_ERROR",
    sourceType: null,
    sourceTypeFinal: null,
    productIdentity: null,
    terminalReason: "REQUEST_ERROR",
    degradedMode: null,
    stage0Winner: null,
    stage0StartCount: null,
    stage0ReplaceCount: null,
    authoritativeIdentity: null,
    regulatoryIds: null,
    candidateBackfill: null,
    scoreReasonCode: null,
    scoreAvailable: null,
    failureClass: "unknown",
    noiseFlags: {
      identityNull: true,
      sourceTypeNull: true,
      requestError: true,
      backendUnavailable: false,
    },
    doneMs: null,
    rev1Ms: null,
    attempt: retries,
    error: lastError instanceof Error ? lastError.message : String(lastError ?? "focus_probe_unknown_error"),
  };
};

const runFocusProbes = async () => {
  const rows = [];
  for (const item of FOCUS_PROBE_SET) {
    // eslint-disable-next-line no-await-in-loop
    const row = await runFocusProbeOne(item.role, toGtin14(item.barcode), {
      retries: FOCUS_PROBE_RETRIES,
      timeoutMs: FOCUS_PROBE_TIMEOUT_MS,
    });
    rows.push(row);
  }
  return rows;
};

const collectEvidenceRows = (enrichScenarios, bulkRows) => {
  const rows = [];
  if (Array.isArray(enrichScenarios)) {
    for (const scenario of enrichScenarios) {
      const scenarioRows = Array.isArray(scenario?.rows) ? scenario.rows : [];
      for (const row of scenarioRows) {
        rows.push({
          route: "/api/enrich-stream",
          source: "concurrency_gate",
          scenario: scenario?.name ?? "unknown",
          role: null,
          barcode: toGtin14(row?.barcode),
          round: Number.isFinite(Number(row?.round)) ? Number(row.round) : null,
          slot: Number.isFinite(Number(row?.slot)) ? Number(row.slot) : null,
          terminal: row?.terminal ?? null,
          requestId: row?.requestContext?.requestId ?? null,
          sourceType: row?.requestContext?.sourceType ?? null,
          sourceTypeFinal:
            typeof row?.requestContext?.sourceTypeFinal === "boolean"
              ? row.requestContext.sourceTypeFinal
              : null,
          terminalReason: row?.requestContext?.terminalReason ?? null,
          degradedMode:
            typeof row?.requestContext?.degradedMode === "boolean"
              ? row.requestContext.degradedMode
              : null,
          stage0Winner: row?.requestContext?.stage0Winner ?? null,
          stage0StartCount:
            Number.isFinite(Number(row?.requestContext?.stage0StartCount))
              ? Number(row.requestContext.stage0StartCount)
              : null,
          stage0ReplaceCount:
            Number.isFinite(Number(row?.requestContext?.stage0ReplaceCount))
              ? Number(row.requestContext.stage0ReplaceCount)
              : null,
          authoritativeIdentity: row?.requestContext?.authoritativeIdentity ?? null,
          productIdentity:
            normalizeProductIdentity(row?.requestContext?.productIdentity) ??
            normalizeProductIdentity(row?.rev1Meta?.productIdentity) ??
            null,
          regulatoryIds:
            row?.requestContext?.regulatoryIds && typeof row.requestContext.regulatoryIds === "object"
              ? row.requestContext.regulatoryIds
              : null,
          candidateBackfill:
            row?.requestContext?.candidateBackfill && typeof row.requestContext.candidateBackfill === "object"
              ? row.requestContext.candidateBackfill
              : null,
          scoreReasonCode:
            typeof row?.requestContext?.scoreReasonCode === "string"
              ? row.requestContext.scoreReasonCode
              : null,
          scoreAvailable:
            typeof row?.requestContext?.scoreAvailable === "boolean"
              ? row.requestContext.scoreAvailable
              : null,
          failureClass: row?.failureClass ?? null,
          noiseFlags: row?.noiseFlags ?? null,
          error: row?.error ?? null,
          doneMs: Number.isFinite(Number(row?.doneMs)) ? Number(row.doneMs) : null,
          rev1Ms: Number.isFinite(Number(row?.rev1Ms)) ? Number(row.rev1Ms) : null,
          admissionLane:
            typeof row?.requestContext?.admissionLane === "string"
              ? row.requestContext.admissionLane
              : null,
        });
      }
    }
  }

  if (Array.isArray(bulkRows)) {
    for (const row of bulkRows) {
      const bulkProductIdentity =
        normalizeProductIdentity(row?.requestContext?.productIdentity) ??
        normalizeProductIdentity({
          name: row?.productIdentityName ?? null,
          brand: row?.productIdentityBrand ?? null,
          sourceAttribution: row?.productIdentitySourceAttribution ?? null,
          identityStable:
            typeof row?.productIdentityStable === "boolean" ? row.productIdentityStable : null,
          sourceId: row?.productIdentitySourceId ?? null,
        }) ??
        null;
      rows.push({
        route: "/api/enrich-stream",
        source: "bulk_gate",
        scenario: row?.country ? `bulk_${String(row.country).toLowerCase()}` : "bulk",
        role: null,
        barcode: toGtin14(row?.barcode),
        round: null,
        slot: null,
        terminal: row?.terminalCode ?? null,
        requestId: row?.requestContext?.requestId ?? null,
        sourceType: row?.sourceType ?? row?.requestContext?.sourceType ?? null,
        sourceTypeFinal:
          typeof row?.sourceTypeFinal === "boolean"
            ? row.sourceTypeFinal
            : typeof row?.requestContext?.sourceTypeFinal === "boolean"
              ? row.requestContext.sourceTypeFinal
              : null,
        terminalReason: row?.terminalReason ?? row?.requestContext?.terminalReason ?? null,
        degradedMode:
          typeof row?.degradedMode === "boolean"
            ? row.degradedMode
            : typeof row?.requestContext?.degradedMode === "boolean"
              ? row.requestContext.degradedMode
              : null,
        stage0Winner: row?.stage0Winner ?? row?.requestContext?.stage0Winner ?? null,
        stage0StartCount:
          Number.isFinite(Number(row?.stage0StartCount))
            ? Number(row.stage0StartCount)
            : Number.isFinite(Number(row?.requestContext?.stage0StartCount))
              ? Number(row.requestContext.stage0StartCount)
              : null,
        stage0ReplaceCount:
          Number.isFinite(Number(row?.stage0ReplaceCount))
            ? Number(row.stage0ReplaceCount)
            : Number.isFinite(Number(row?.requestContext?.stage0ReplaceCount))
              ? Number(row.requestContext.stage0ReplaceCount)
              : null,
        authoritativeIdentity:
          row?.requestContext?.authoritativeIdentity ??
          (row?.identityType || row?.identityValue
            ? { type: row?.identityType ?? null, value: row?.identityValue ?? null }
            : null),
        productIdentity: bulkProductIdentity,
        regulatoryIds:
          row?.requestContext?.regulatoryIds && typeof row.requestContext.regulatoryIds === "object"
            ? row.requestContext.regulatoryIds
            : null,
        candidateBackfill:
          row?.requestContext?.candidateBackfill && typeof row.requestContext.candidateBackfill === "object"
            ? row.requestContext.candidateBackfill
            : null,
        scoreReasonCode:
          typeof row?.requestContext?.scoreReasonCode === "string"
            ? row.requestContext.scoreReasonCode
            : null,
        scoreAvailable:
          typeof row?.requestContext?.scoreAvailable === "boolean"
            ? row.requestContext.scoreAvailable
            : null,
        failureClass: row?.failureClass ?? null,
        noiseFlags: row?.noiseFlags ?? null,
        error: row?.error ?? null,
        doneMs: Number.isFinite(Number(row?.doneMs)) ? Number(row.doneMs) : null,
        rev1Ms: Number.isFinite(Number(row?.revision1Ms)) ? Number(row.revision1Ms) : null,
        admissionLane:
          typeof row?.requestContext?.admissionLane === "string"
            ? row.requestContext.admissionLane
            : "full",
      });
    }
  }

  return rows.filter((row) => Boolean(row.barcode));
};

const buildSourceTypeFinalCounts = (rows) => {
  const initBucket = () => ({ total: 0, true: 0, false: 0, unknown: 0 });
  const bySourceType = {
    lnhpd: initBucket(),
    dsld: initBucket(),
    web: initBucket(),
    unknown: initBucket(),
  };
  const all = initBucket();
  for (const row of rows) {
    const source = normalizeSourceType(row?.sourceType);
    const bucket = bySourceType[source] ?? bySourceType.unknown;
    bucket.total += 1;
    all.total += 1;
    if (row?.sourceTypeFinal === true) {
      bucket.true += 1;
      all.true += 1;
    } else if (row?.sourceTypeFinal === false) {
      bucket.false += 1;
      all.false += 1;
    } else {
      bucket.unknown += 1;
      all.unknown += 1;
    }
  }
  return { all, bySourceType };
};

const buildProductIdentityStats = (rows) => {
  const safeRows = Array.isArray(rows) ? rows : [];
  const sourceAttributionCounts = {};
  const identityStableCounts = { true: 0, false: 0, unknown: 0 };
  const sourceAttributionStableCounts = {};
  let presentCount = 0;
  let namePresentCount = 0;
  let trustedStableCount = 0;
  let verifiedRegulatoryStableCount = 0;

  for (const row of safeRows) {
    const productIdentity = normalizeProductIdentity(row?.productIdentity);
    if (!productIdentity) continue;
    presentCount += 1;
    if (productIdentity.name) namePresentCount += 1;

    const sourceAttribution = productIdentity.sourceAttribution || "UNKNOWN";
    sourceAttributionCounts[sourceAttribution] = (sourceAttributionCounts[sourceAttribution] ?? 0) + 1;

    if (productIdentity.identityStable === true) {
      identityStableCounts.true += 1;
    } else if (productIdentity.identityStable === false) {
      identityStableCounts.false += 1;
    } else {
      identityStableCounts.unknown += 1;
    }

    const stableBucket = sourceAttributionStableCounts[sourceAttribution] ?? {
      total: 0,
      stableTrue: 0,
      stableFalse: 0,
      stableUnknown: 0,
    };
    stableBucket.total += 1;
    if (productIdentity.identityStable === true) stableBucket.stableTrue += 1;
    else if (productIdentity.identityStable === false) stableBucket.stableFalse += 1;
    else stableBucket.stableUnknown += 1;
    sourceAttributionStableCounts[sourceAttribution] = stableBucket;

    if (productIdentity.sourceAttribution === "verified_regulatory" && productIdentity.identityStable === true) {
      verifiedRegulatoryStableCount += 1;
    }
    if (
      (productIdentity.sourceAttribution === "verified_regulatory" ||
        productIdentity.sourceAttribution === "label_record") &&
      productIdentity.identityStable === true
    ) {
      trustedStableCount += 1;
    }
  }

  const totalRows = safeRows.length;
  return {
    totalRows,
    presentCount,
    presentRate: toRate(presentCount, totalRows),
    namePresentCount,
    namePresentRate: toRate(namePresentCount, totalRows),
    sourceAttributionCounts,
    identityStableCounts,
    sourceAttributionStableCounts,
    trustedStableCount,
    trustedStableRate: toRate(trustedStableCount, totalRows),
    verifiedRegulatoryStableCount,
    verifiedRegulatoryStableRate: toRate(verifiedRegulatoryStableCount, totalRows),
  };
};

const buildTerminalReasonSemanticStats = (rows) => {
  const safeRows = Array.isArray(rows) ? rows : [];
  const counts = {
    bundleOnlyNoAuthoritativeMatch: 0,
    degradedWebBudget: 0,
    degradedEventloop: 0,
    doneOk: 0,
  };
  const contractMismatches = [];

  for (const row of safeRows) {
    const reason = normalizeTerminalReason(row?.terminalReason);
    if (!reason) continue;
    const reasonUpper = reason.toUpperCase();

    if (reasonUpper.includes("BUNDLE_ONLY_NO_AUTHORITATIVE_MATCH")) {
      counts.bundleOnlyNoAuthoritativeMatch += 1;
      if (row?.sourceTypeFinal === true) {
        contractMismatches.push({
          type: "bundle_only_with_source_type_final_true",
          barcode: row?.barcode ?? null,
          scenario: row?.scenario ?? null,
          role: row?.role ?? null,
          terminal: row?.terminal ?? null,
          terminalReason: reason,
          sourceType: row?.sourceType ?? null,
          sourceTypeFinal: row?.sourceTypeFinal ?? null,
          requestId: row?.requestId ?? null,
        });
      }
    }
    if (reasonUpper.includes("DEGRADED_WEB_BUDGET")) counts.degradedWebBudget += 1;
    if (reasonUpper.includes("DEGRADED_EVENTLOOP")) counts.degradedEventloop += 1;
    if (reasonUpper === "DONE_OK") counts.doneOk += 1;

    if (reasonUpper.startsWith("DEGRADED_") && row?.degradedMode !== true) {
      contractMismatches.push({
        type: "degraded_reason_without_degraded_mode",
        barcode: row?.barcode ?? null,
        scenario: row?.scenario ?? null,
        role: row?.role ?? null,
        terminal: row?.terminal ?? null,
        terminalReason: reason,
        sourceType: row?.sourceType ?? null,
        sourceTypeFinal: row?.sourceTypeFinal ?? null,
        degradedMode: row?.degradedMode ?? null,
        requestId: row?.requestId ?? null,
      });
    }
  }

  return {
    counts,
    contractMismatchCount: contractMismatches.length,
    contractMismatches: contractMismatches.slice(0, 50),
  };
};

const buildTerminalReasonNullMetrics = (rows) => {
  const candidates = rows.filter((row) => row?.terminal !== "REQUEST_ERROR" && row?.terminal !== "CLIENT_TIMEOUT");
  const nullSamples = candidates
    .filter((row) => isNullLikeTerminalReason(row?.terminalReason))
    .slice(0, TERMINAL_REASON_NULL_SAMPLE_LIMIT)
    .map((row) => ({
      requestId: row?.requestId ?? null,
      barcode: row?.barcode ?? null,
      route: row?.route ?? "/api/enrich-stream",
      sourceType: row?.sourceType ?? null,
      sourceTypeFinal:
        typeof row?.sourceTypeFinal === "boolean" ? row.sourceTypeFinal : null,
      stage0Winner: row?.stage0Winner ?? null,
      terminal: row?.terminal ?? null,
      scenario: row?.scenario ?? null,
      role: row?.role ?? null,
    }));
  const nullCount = candidates.filter((row) => row?.terminalReason == null || String(row.terminalReason).trim() === "").length;
  const unknownCount = candidates.filter((row) => String(row?.terminalReason ?? "").trim().toUpperCase() === "UNKNOWN").length;
  const nullLikeCount = nullCount + unknownCount;
  const denominator = candidates.length;
  const nullLikeRate = denominator > 0 ? Number((nullLikeCount / denominator).toFixed(4)) : null;
  const warning = nullLikeRate != null && nullLikeRate > TERMINAL_REASON_WARN_THRESHOLD;
  const fail = nullLikeRate != null && nullLikeRate >= TERMINAL_REASON_FAIL_THRESHOLD;
  return {
    denominator,
    terminalReasonNullCount: nullCount,
    terminalReasonUnknownCount: unknownCount,
    terminalReasonNullLikeCount: nullLikeCount,
    terminalReasonNullLikeRate: nullLikeRate,
    warning,
    fail,
    nullLikeDefinition: "null|\"\"|\"UNKNOWN\"",
    samples: nullSamples,
  };
};

const buildTerminalReasonTopN = (rows, limit = TERMINAL_REASON_TOPN_LIMIT) => {
  const candidates = rows.filter((row) => row?.terminal !== "REQUEST_ERROR" && row?.terminal !== "CLIENT_TIMEOUT");
  const denominator = candidates.length;
  const counts = {};
  for (const row of candidates) {
    const normalized = normalizeTerminalReason(row?.terminalReason);
    const key = !normalized ? "null" : normalized.toUpperCase() === "UNKNOWN" ? "UNKNOWN" : normalized;
    counts[key] = (counts[key] ?? 0) + 1;
  }
  return Object.entries(counts)
    .sort((a, b) => {
      if (b[1] !== a[1]) return b[1] - a[1];
      return a[0].localeCompare(b[0]);
    })
    .slice(0, Math.max(1, limit))
    .map(([reason, count]) => ({
      reason,
      count,
      rate: denominator > 0 ? Number((count / denominator).toFixed(4)) : null,
    }));
};

const evaluateSourceTypeFinalViolations = (rows, expectedSet) => {
  const expectedLookup = new Map();
  if (Array.isArray(expectedSet?.barcodes)) {
    for (const row of expectedSet.barcodes) {
      const barcode = toGtin14(row?.barcode);
      if (!barcode) continue;
      if (expectedLookup.has(barcode)) continue;
      expectedLookup.set(barcode, {
        source: row?.source ?? "unknown",
        reason: row?.reason ?? null,
        enforcement: row?.enforcement === "hard_fail" ? "hard_fail" : "warning_only",
      });
    }
  }
  const sourceTypeFinalViolations = [];
  let authoritativeExpectedButNotFinalCount = 0;
  let dbExpectedButNotFinalCount = 0;
  let webFallbackCount = 0;
  let barcode000847Bucket = "not_observed";
  for (const row of rows) {
    if (row?.sourceTypeFinal !== false) {
      if (row?.barcode === "00084783891253" && barcode000847Bucket === "not_observed") {
        barcode000847Bucket = "final_or_unknown";
      }
      continue;
    }
    const expectedConfig = expectedLookup.get(row?.barcode);
    const isFixtureHardFail = expectedConfig?.enforcement === "hard_fail";
    const isDbWarning = Boolean(expectedConfig) && !isFixtureHardFail;
    const bucket = isFixtureHardFail
      ? "expected_but_not_final"
      : isDbWarning
        ? "db_expected_warning"
        : "allowed_web_fallback";
    const severity = isFixtureHardFail ? "fail" : "warning";
    if (isFixtureHardFail) authoritativeExpectedButNotFinalCount += 1;
    else if (isDbWarning) dbExpectedButNotFinalCount += 1;
    else webFallbackCount += 1;
    if (row?.barcode === "00084783891253") barcode000847Bucket = bucket;
    sourceTypeFinalViolations.push({
      barcode: row?.barcode ?? null,
      route: row?.route ?? "/api/enrich-stream",
      sourceType: row?.sourceType ?? null,
      sourceTypeFinal: false,
      expectedSetSource: expectedConfig?.source ?? null,
      expectedSetReason: expectedConfig?.reason ?? null,
      expectedSetEnforcement: expectedConfig?.enforcement ?? null,
      requestId: row?.requestId ?? null,
      terminal: row?.terminal ?? null,
      scenario: row?.scenario ?? null,
      round: Number.isFinite(Number(row?.round)) ? Number(row.round) : null,
      slot: Number.isFinite(Number(row?.slot)) ? Number(row.slot) : null,
      role: row?.role ?? null,
      bucket,
      severity,
    });
  }
  return {
    authoritativeExpectedButNotFinalCount,
    dbExpectedButNotFinalCount,
    webFallbackCount,
    sourceTypeFinalViolations,
    barcode000847Bucket,
  };
};

const runNodeScript = async (scriptPath, extraEnv = {}, scriptArgs = []) =>
  new Promise((resolve) => {
    const startedAt = Date.now();
    const child = spawn(process.execPath, [scriptPath, ...scriptArgs], {
      cwd: ROOT_DIR,
      env: {
        ...process.env,
        ...extraEnv,
      },
      stdio: "inherit",
    });
    child.on("error", (error) => {
      resolve({
        scriptPath,
        exitCode: 1,
        durationMs: Date.now() - startedAt,
        error: error instanceof Error ? error.message : String(error),
      });
    });
    child.on("close", (code) => {
      resolve({
        scriptPath,
        exitCode: code ?? 1,
        durationMs: Date.now() - startedAt,
        error: null,
      });
    });
  });

const waitForBackendHealthy = async () => {
  const startedAt = Date.now();
  let lastError = null;
  while (Date.now() - startedAt < startupTimeoutMs) {
    try {
      const res = await fetch(healthUrl, { method: "GET" });
      if (res.status < 500) {
        return {
          ok: true,
          status: res.status,
          latencyMs: Date.now() - startedAt,
        };
      }
      lastError = `status_${res.status}`;
    } catch (error) {
      lastError = error instanceof Error ? error.message : String(error);
    }
    await sleep(healthIntervalMs);
  }
  return {
    ok: false,
    status: null,
    latencyMs: Date.now() - startedAt,
    error: lastError ?? "timeout_waiting_for_backend",
  };
};

const startManagedBackend = async () => {
  const backendLogPath = path.join(OUTPUT_DIR, "backend.log");
  const child = spawn(process.env.SHELL || "zsh", ["-lc", backendCmd], {
    cwd: ROOT_DIR,
    env: {
      ...process.env,
    },
    stdio: ["ignore", "pipe", "pipe"],
  });

  const appendLog = async (chunk, channel) => {
    const line = `[${new Date().toISOString()}][${channel}] ${String(chunk)}`;
    await fs.appendFile(backendLogPath, line, "utf8").catch(() => undefined);
  };
  child.stdout?.on("data", (chunk) => {
    appendLog(chunk, "stdout");
  });
  child.stderr?.on("data", (chunk) => {
    appendLog(chunk, "stderr");
  });

  const healthy = await waitForBackendHealthy();
  return {
    child,
    backendLogPath,
    healthy,
  };
};

const stopManagedBackend = async (child) => {
  if (!child || child.killed || child.exitCode !== null) return;
  child.kill("SIGTERM");
  await sleep(600);
  if (child.exitCode === null) {
    child.kill("SIGKILL");
  }
};

const toMarkdown = (report) => {
  const lines = [];
  lines.push("# Backend Gate Full Report");
  lines.push("");
  lines.push(`- Generated: ${report.generatedAt}`);
  lines.push(`- API Base: ${report.apiBaseUrl}`);
  lines.push(`- Output Dir: ${report.outputDir}`);
  lines.push(`- Verdict: ${report.verdict.pass ? "PASS" : "FAIL"}`);
  lines.push(`- Verdict classification: ${report.verdict.classification ?? "unknown"}`);
  lines.push("");

  lines.push("## Key Stats");
  lines.push("");
  lines.push(`- Terminal breakdown: \`${JSON.stringify(report.terminalBreakdown)}\``);
  lines.push(`- Failure classes: \`${JSON.stringify(report.failureClassCounts)}\``);
  lines.push(`- Noise counts: \`${JSON.stringify(report.noiseCounts)}\``);
  lines.push(`- Terminal reasons: \`${JSON.stringify(report.terminalReasonCounts)}\``);
  lines.push(`- Terminal reason TopN: \`${JSON.stringify(report.terminalReasonTopN ?? [])}\``);
  lines.push(`- Stage0 winners: \`${JSON.stringify(report.stage0WinnerCounts)}\``);
  lines.push(`- Degraded mode counts: \`${JSON.stringify(report.degradedModeCounts)}\``);
  lines.push(`- Admission lane counts: \`${JSON.stringify(report.admissionLaneCounts ?? {})}\``);
  lines.push(`- sourceTypeFinal counts: \`${JSON.stringify(report.sourceTypeFinalCounts)}\``);
  lines.push(
    `- npn rows with candidates: ${report.npnCandidateStats?.rowsWithCandidates ?? 0}/${report.npnCandidateStats?.totalRows ?? 0}`,
  );
  lines.push(
    `- npn candidateBackfill attempted/used: ${report.candidateBackfillAttempted ?? 0}/${report.candidateBackfillUsed ?? 0}`,
  );
  lines.push(
    `- npn candidateBackfill mismatch/timeout: ${report.candidateBackfillRejectedMismatch ?? 0}/${report.candidateBackfillTimeout ?? 0}`,
  );
  lines.push(
    `- scoreSuppressedByCandidateBackfill: ${report.scoreSuppressedByCandidateBackfillCount ?? 0}`,
  );
  lines.push(
    `- productIdentity present rate: ${
      report.productIdentityStats?.presentRate != null
        ? `${(report.productIdentityStats.presentRate * 100).toFixed(1)}%`
        : "n/a"
    }`,
  );
  lines.push(
    `- productIdentity trustedStable rate: ${
      report.productIdentityStats?.trustedStableRate != null
        ? `${(report.productIdentityStats.trustedStableRate * 100).toFixed(1)}%`
        : "n/a"
    }`,
  );
  lines.push(
    `- terminalReason semantics: \`${JSON.stringify(report.terminalReasonSemanticStats?.counts ?? {})}\``,
  );
  lines.push(`- Must-DONE violations: ${report.mustDoneViolations.length}`);
  lines.push(`- parallel9 DONE p95: ${report.latencyStats.parallel9DoneP95Ms ?? "n/a"} ms`);
  lines.push(`- parallel9 NOT_FOUND rev1 p95: ${report.latencyStats.parallel9NotFoundRev1P95Ms ?? "n/a"} ms`);
  lines.push(`- parallel9 rev1->done p95: ${report.latencyStats.parallel9Rev1ToDoneP95Ms ?? "n/a"} ms`);
  lines.push(`- parallel9 done timer drift p95: ${report.latencyStats.parallel9DoneTimerDriftP95Ms ?? "n/a"} ms`);
  lines.push(`- parallel9 persisted commit mode counts: ${JSON.stringify(report.latencyStats.parallel9PersistedCommitModeCounts ?? {})}`);
  lines.push(`- parallel9 persisted-not-completed-before-done: ${report.latencyStats.parallel9PersistedCommitNotCompletedBeforeDoneCount ?? "n/a"}`);
  lines.push(`- stream_busy_queue_wait_timeout count: ${report.latencyStats.streamBusyQueueWaitTimeoutCount ?? "n/a"}`);
  lines.push(`- stream_busy_queue_full count: ${report.latencyStats.streamBusyQueueFullCount ?? "n/a"}`);
  lines.push(`- stream_busy_server_overload count: ${report.latencyStats.streamBusyServerOverloadCount ?? "n/a"}`);
  lines.push(`- bulk DONE p95: ${report.latencyStats.bulkDoneP95Ms ?? "n/a"} ms`);
  lines.push(`- bulk NOT_FOUND rev1 p95: ${report.latencyStats.bulkNotFoundRev1P95Ms ?? "n/a"} ms`);
  lines.push(`- stage0StartCount p95: ${report.latencyStats.stage0StartCountP95 ?? "n/a"}`);
  lines.push(`- stage0ReplaceCount p95: ${report.latencyStats.stage0ReplaceCountP95 ?? "n/a"}`);
  lines.push(`- UL guidance rate: ${report.ulCoverage?.metrics?.ulGuidanceRate != null ? `${(report.ulCoverage.metrics.ulGuidanceRate * 100).toFixed(1)}%` : "n/a"}`);
  lines.push(`- UL scope!=total count: ${report.ulCoverage?.metrics?.scopeNonTotalCount ?? "n/a"}`);
  lines.push(`- UL uncertain rate: ${report.ulCoverage?.metrics?.unitConversionUncertainRate != null ? `${(report.ulCoverage.metrics.unitConversionUncertainRate * 100).toFixed(1)}%` : "n/a"}`);
  lines.push(`- UL web-unverified entries shown: ${report.ulCoverage?.metrics?.webUnverifiedEntriesShownCount ?? "n/a"}`);
  lines.push(`- infra_untrusted: ${report.infraTrust?.infraUntrusted ? "yes" : "no"}`);
  lines.push(`- focus contamination detected: ${report.focusContaminationDetected ? "yes" : "no"}`);
  lines.push(`- repair queue artifact: ${report.repairQueueArtifactPath ?? "n/a"}`);
  const writePolicyShadow = report?.reports?.writePolicyShadowReport ?? null;
  if (writePolicyShadow?.summary) {
    lines.push(`- writePolicy wouldBlock: ${writePolicyShadow.summary.wouldBlock ?? 0}`);
    lines.push(`- writePolicy wouldUpgrade: ${writePolicyShadow.summary.wouldUpgrade ?? 0}`);
    lines.push(`- writePolicy wouldReplaceSameRank: ${writePolicyShadow.summary.wouldReplaceSameRank ?? 0}`);
    lines.push(`- writePolicy wouldWriteCandidateOnly: ${writePolicyShadow.summary.wouldWriteCandidateOnly ?? 0}`);
  }
  const candidatesQuality = report?.reports?.candidatesQualityReport ?? null;
  if (candidatesQuality) {
    lines.push(`- candidates conflictsByBarcode: ${candidatesQuality.conflictsByBarcode ?? "n/a"}`);
  }
  const negativeCacheResidual = report?.reports?.negativeCacheResidualReport ?? null;
  if (negativeCacheResidual) {
    lines.push(`- negative cache residualHitRate: ${negativeCacheResidual.residualHitRate ?? "n/a"}`);
  }
  const surfaceConsistency = report?.reports?.surfaceConsistencyReport ?? null;
  if (surfaceConsistency) {
    lines.push(`- surface consistency sourceDatasetMismatch: ${surfaceConsistency.sourceDatasetMismatchCount ?? "n/a"}`);
    lines.push(`- surface consistency verificationStatusMismatch: ${surfaceConsistency.verificationStatusMismatchCount ?? "n/a"}`);
    lines.push(`- surface consistency ingredientCountContradiction(strict): ${surfaceConsistency.ingredientCountContradictionCount ?? "n/a"}`);
    lines.push(`- surface consistency doseCountContradiction(strict): ${surfaceConsistency.doseCountContradictionCount ?? "n/a"}`);
    lines.push(`- surface consistency ingredientCountInferredOnlyContradiction: ${surfaceConsistency.ingredientCountInferredOnlyContradictionCount ?? "n/a"}`);
    lines.push(`- surface consistency doseCountInferredOnlyContradiction: ${surfaceConsistency.doseCountInferredOnlyContradictionCount ?? "n/a"}`);
  }
  if (report.mobileSoakSummary?.stats) {
    const soakStats = report.mobileSoakSummary.stats;
    lines.push(`- mobile contentValuePassRate(serial): ${soakStats.contentValuePassRate != null ? `${(soakStats.contentValuePassRate * 100).toFixed(1)}%` : "n/a"}`);
    lines.push(`- mobile verifiedContentPassRate(serial): ${soakStats.verifiedContentPassRate != null ? `${(soakStats.verifiedContentPassRate * 100).toFixed(1)}%` : "n/a"}`);
    lines.push(`- mobile webHintContentPassRate(serial): ${soakStats.webHintContentPassRate != null ? `${(soakStats.webHintContentPassRate * 100).toFixed(1)}%` : "n/a"}`);
    lines.push(`- mobile degradedContentPassRate(serial): ${soakStats.degradedContentPassRate != null ? `${(soakStats.degradedContentPassRate * 100).toFixed(1)}%` : "n/a"}`);
    lines.push(`- mobile ulVisibilityPassRate(serial): ${soakStats.ulVisibilityPassRate != null ? `${(soakStats.ulVisibilityPassRate * 100).toFixed(1)}%` : "n/a"}`);
    lines.push(`- mobile regulatoryRichRate_attemptWeighted(serial verified-final): ${soakStats.regulatoryRichRate_attemptWeighted != null ? `${(soakStats.regulatoryRichRate_attemptWeighted * 100).toFixed(1)}%` : "n/a"}`);
    lines.push(`- mobile regulatoryRichRate_uniqueBarcode(serial verified-final; gate): ${soakStats.regulatoryRichRate_uniqueBarcode != null ? `${(soakStats.regulatoryRichRate_uniqueBarcode * 100).toFixed(1)}%` : soakStats.regulatoryRichRate != null ? `${(soakStats.regulatoryRichRate * 100).toFixed(1)}%` : "n/a"}`);
    lines.push(`- mobile scoreVisibleRate(serial verified-final): ${soakStats.scoreVisibleRate != null ? `${(soakStats.scoreVisibleRate * 100).toFixed(1)}%` : "n/a"}`);
    lines.push(`- mobile ulEntriesCoverageVerified(serial verified-final; legacy): ${soakStats.ulEntriesCoverageVerified != null ? `${(soakStats.ulEntriesCoverageVerified * 100).toFixed(1)}%` : "n/a"}`);
    lines.push(`- mobile ulReferenceCoverageVerified(serial verified-final): ${soakStats.ulReferenceCoverageVerified != null ? `${(soakStats.ulReferenceCoverageVerified * 100).toFixed(1)}%` : "n/a"}`);
    lines.push(`- mobile ulComparableCoverageVerified(serial verified-final): ${soakStats.ulComparableCoverageVerified != null ? `${(soakStats.ulComparableCoverageVerified * 100).toFixed(1)}%` : "n/a"}`);
    lines.push(`- mobile ulEligibleRateVerified(serial verified-final): ${soakStats.ulEligibleRateVerified != null ? `${(soakStats.ulEligibleRateVerified * 100).toFixed(1)}%` : "n/a"}`);
    lines.push(`- mobile esterCoreRate_all(serial verified-final): ${soakStats.esterCoreRate_all != null ? `${(soakStats.esterCoreRate_all * 100).toFixed(1)}%` : "n/a"}`);
    lines.push(`- mobile esterCoreRate_fixable(serial verified-final): ${soakStats.esterCoreRate_fixable != null ? `${(soakStats.esterCoreRate_fixable * 100).toFixed(1)}%` : "n/a"}`);
    lines.push(`- mobile esterUlReferenceReadyRate_eligible(serial verified-final; release gate): ${(soakStats.esterUlReferenceReadyRate_eligible ?? soakStats.esterUlReadyRate_eligible) != null ? `${(Number(soakStats.esterUlReferenceReadyRate_eligible ?? soakStats.esterUlReadyRate_eligible) * 100).toFixed(1)}%` : "n/a"}`);
    lines.push(`- mobile esterUlComparableReadyRate_eligible(serial verified-final): ${soakStats.esterUlComparableReadyRate_eligible != null ? `${(soakStats.esterUlComparableReadyRate_eligible * 100).toFixed(1)}%` : "n/a"}`);
    lines.push(`- mobile esterUlReadyRate_eligible(legacy alias): ${soakStats.esterUlReadyRate_eligible != null ? `${(soakStats.esterUlReadyRate_eligible * 100).toFixed(1)}%` : "n/a"}`);
    lines.push(`- mobile dataCeilingRateByRole: ${JSON.stringify(soakStats.dataCeilingRateByRole ?? {})}`);
    lines.push(`- mobile scoreNotFoundTargetedCount(serial): ${soakStats.scoreNotFoundTargetedCount ?? 0}`);
    lines.push(`- mobile scoreNotFoundTargetedByReason(serial): ${JSON.stringify(soakStats.scoreNotFoundTargetedByReason ?? {})}`);
    lines.push(`- mobile firstFramePendingRate(serial): ${soakStats.firstFramePendingRate != null ? `${(soakStats.firstFramePendingRate * 100).toFixed(1)}%` : "n/a"}`);
    lines.push(`- mobile firstFrameTrustedRateRegulatory(serial): ${soakStats.firstFrameTrustedRateRegulatory != null ? `${(soakStats.firstFrameTrustedRateRegulatory * 100).toFixed(1)}%` : "n/a"}`);
    lines.push(`- mobile timeoutClassCounts(all): ${JSON.stringify(soakStats.timeoutClassCounts ?? {})}`);
    lines.push(`- mobile killerTimeoutClassCounts: ${JSON.stringify(soakStats.killerTimeoutClassCounts ?? {})}`);
    lines.push(`- mobile killerConfiguredAttempts: ${soakStats.killerConfiguredAttempts ?? 0}`);
    lines.push(`- mobile killerInfraUnavailableRate: ${soakStats.killerInfraUnavailableRate != null ? `${(soakStats.killerInfraUnavailableRate * 100).toFixed(1)}%` : "n/a"}`);
    lines.push(`- mobile killerProductAttempts: ${soakStats.killerProductAttempts ?? 0}`);
    lines.push(`- mobile killerInconclusive: ${soakStats.killerInconclusive ? "yes" : "no"}`);
    lines.push(`- mobile killerProductTimeoutClassCounts: ${JSON.stringify(soakStats.killerProductTimeoutClassCounts ?? {})}`);
    lines.push(`- mobile ceilingSuite: ${JSON.stringify(soakStats.ceilingSuite ?? {})}`);
    lines.push(`- mobile richness thresholds: regulatoryRichRate_uniqueBarcode>=${(report.mobileRichnessGate?.thresholds?.regulatoryRichRateMin ?? MOBILE_REGULATORY_RICH_RATE_MIN) * 100}% scoreVisibleRate>=${(report.mobileRichnessGate?.thresholds?.scoreVisibleRateMin ?? MOBILE_SCORE_VISIBLE_RATE_MIN) * 100}%`);
    lines.push(`- mobile UL release thresholds: referenceReady@eligible>=${Math.round((report.mobileRichnessGate?.thresholds?.esterUlReadyEligibleMin ?? MOBILE_ESTER_UL_READY_ELIGIBLE_MIN) * 100)}% comparable@eligible warn>=${Math.round((report.mobileRichnessGate?.thresholds?.esterUlComparableEligibleWarnMin ?? MOBILE_ESTER_UL_COMPARABLE_ELIGIBLE_WARN_MIN) * 100)}%`);
    lines.push(`- mobile killer timeout threshold (product-only): CLIENT_TIMEOUT<=${Math.round((report.mobileRichnessGate?.thresholds?.killerClientTimeoutRateMax ?? MOBILE_KILLER_CLIENT_TIMEOUT_RATE_MAX) * 100)}% and SSE_CONNECTED_BUT_NO_DONE=0`);
    lines.push(`- mobile killer infra warning threshold: infraUnavailableRate<=${Math.round((report.mobileRichnessGate?.thresholds?.killerInfraUnavailableWarnRate ?? MOBILE_KILLER_INFRA_UNAVAILABLE_WARN_RATE) * 100)}%`);
    lines.push(`- mobile richness enforcement: ${report.mobileRichnessGate?.enforceHardFail ? "hard_fail" : "warning_only"}`);
    lines.push(`- mobile release strict enforcement: ${report.mobileRichnessGate?.releaseStrictEnforce ? "hard_fail" : "warning_only"}`);
  }
  lines.push("");

  if (report.npnCandidateStats) {
    lines.push("## NPN Candidate Stats");
    lines.push("");
    lines.push(`- rowsWithCandidates: ${report.npnCandidateStats.rowsWithCandidates ?? 0}`);
    lines.push(`- rowsWithCandidatesRate: ${report.npnCandidateStats.rowsWithCandidatesRate ?? 0}`);
    lines.push(`- totalCandidateCount: ${report.npnCandidateStats.totalCandidateCount ?? 0}`);
    lines.push(`- uniqueCandidateValueCount: ${report.npnCandidateStats.uniqueCandidateValueCount ?? 0}`);
    lines.push(`- stableReasonCounts: \`${JSON.stringify(report.npnCandidateStats.stableReasonCounts ?? {})}\``);
    lines.push(`- sourceKindCounts: \`${JSON.stringify(report.npnCandidateStats.sourceKindCounts ?? {})}\``);
    lines.push(`- topStableReasonCounts: \`${JSON.stringify(report.npnCandidateStats.topStableReasonCounts ?? {})}\``);
    lines.push(`- candidateBackfillAttempted: ${report.npnCandidateStats.candidateBackfillAttempted ?? 0}`);
    lines.push(`- candidateBackfillUsed: ${report.npnCandidateStats.candidateBackfillUsed ?? 0}`);
    lines.push(
      `- candidateBackfillRejectedMismatch: ${report.npnCandidateStats.candidateBackfillRejectedMismatch ?? 0}`,
    );
    lines.push(`- candidateBackfillTimeout: ${report.npnCandidateStats.candidateBackfillTimeout ?? 0}`);
    lines.push(`- candidateBackfillNotFound: ${report.npnCandidateStats.candidateBackfillNotFound ?? 0}`);
    lines.push(
      `- scoreSuppressedByCandidateBackfillCount: ${report.npnCandidateStats.scoreSuppressedByCandidateBackfillCount ?? 0}`,
    );
    lines.push("");
  }

  lines.push("## TerminalReason Gate");
  lines.push("");
  lines.push(`- denominator: ${report.terminalReasonQuality?.denominator ?? 0}`);
  lines.push(`- null count: ${report.terminalReasonQuality?.terminalReasonNullCount ?? 0}`);
  lines.push(`- unknown count: ${report.terminalReasonQuality?.terminalReasonUnknownCount ?? 0}`);
  lines.push(`- null-like rate: ${report.terminalReasonQuality?.terminalReasonNullLikeRate ?? "n/a"}`);
  lines.push(`- warning threshold: ${report.terminalReasonQuality?.warnThreshold ?? TERMINAL_REASON_WARN_THRESHOLD}`);
  lines.push(`- fail threshold: ${report.terminalReasonQuality?.failThreshold ?? TERMINAL_REASON_FAIL_THRESHOLD}`);
  lines.push(`- warning active: ${report.terminalReasonQuality?.warning ? "yes" : "no"}`);
  lines.push(`- fail active: ${report.terminalReasonQuality?.fail ? "yes" : "no"}`);
  lines.push(`- topN limit: ${report.terminalReasonQuality?.topNLimit ?? TERMINAL_REASON_TOPN_LIMIT}`);
  lines.push("");

  if (report.infraTrust) {
    lines.push("## Infra Trust");
    lines.push("");
    lines.push(`- classification: ${report.infraTrust.classification}`);
    lines.push(`- triggeredBy: ${(report.infraTrust.triggeredBy ?? []).join(", ") || "none"}`);
    lines.push(`- totalRows: ${report.infraTrust.metrics?.totalRows ?? 0}`);
    lines.push(`- http503Rate: ${report.infraTrust.metrics?.http503Rate ?? 0} (max ${report.infraTrust.thresholds?.http503RateMax ?? "n/a"})`);
    lines.push(`- requestErrorRate: ${report.infraTrust.metrics?.requestErrorRate ?? 0} (max ${report.infraTrust.thresholds?.requestErrorRateMax ?? "n/a"})`);
    lines.push(`- identityNullRate: ${report.infraTrust.metrics?.identityNullRate ?? 0} (max ${report.infraTrust.thresholds?.identityNullRateMax ?? "n/a"})`);
    lines.push(`- sourceTypeNullRate: ${report.infraTrust.metrics?.sourceTypeNullRate ?? 0} (max ${report.infraTrust.thresholds?.sourceTypeNullRateMax ?? "n/a"})`);
    lines.push("");
  }

  if (report.productIdentityStats) {
    lines.push("## Product Identity");
    lines.push("");
    lines.push(`- totalRows: ${report.productIdentityStats.totalRows ?? 0}`);
    lines.push(`- presentCount: ${report.productIdentityStats.presentCount ?? 0}`);
    lines.push(`- presentRate: ${report.productIdentityStats.presentRate ?? 0}`);
    lines.push(`- namePresentCount: ${report.productIdentityStats.namePresentCount ?? 0}`);
    lines.push(`- namePresentRate: ${report.productIdentityStats.namePresentRate ?? 0}`);
    lines.push(`- trustedStableCount: ${report.productIdentityStats.trustedStableCount ?? 0}`);
    lines.push(`- trustedStableRate: ${report.productIdentityStats.trustedStableRate ?? 0}`);
    lines.push(
      `- verifiedRegulatoryStableCount: ${report.productIdentityStats.verifiedRegulatoryStableCount ?? 0}`,
    );
    lines.push(
      `- verifiedRegulatoryStableRate: ${report.productIdentityStats.verifiedRegulatoryStableRate ?? 0}`,
    );
    lines.push(
      `- sourceAttributionCounts: \`${JSON.stringify(report.productIdentityStats.sourceAttributionCounts ?? {})}\``,
    );
    lines.push(
      `- identityStableCounts: \`${JSON.stringify(report.productIdentityStats.identityStableCounts ?? {})}\``,
    );
    lines.push("");
  }

  if (report.terminalReasonSemanticStats) {
    lines.push("## TerminalReason Semantics");
    lines.push("");
    lines.push(
      `- counts: \`${JSON.stringify(report.terminalReasonSemanticStats.counts ?? {})}\``,
    );
    lines.push(
      `- contractMismatchCount: ${report.terminalReasonSemanticStats.contractMismatchCount ?? 0}`,
    );
    const samples = Array.isArray(report.terminalReasonSemanticStats.contractMismatches)
      ? report.terminalReasonSemanticStats.contractMismatches
      : [];
    samples.slice(0, 20).forEach((sample) => {
      lines.push(
        `- type=${sample.type ?? "unknown"} barcode=${sample.barcode ?? "null"} scenario=${sample.scenario ?? "null"} role=${sample.role ?? "null"} terminal=${sample.terminal ?? "null"} reason=${sample.terminalReason ?? "null"} sourceType=${sample.sourceType ?? "null"} sourceTypeFinal=${sample.sourceTypeFinal ?? "null"} degradedMode=${sample.degradedMode ?? "null"} requestId=${sample.requestId ?? "null"}`,
      );
    });
    lines.push("");
  }

  lines.push("## SourceTypeFinal Gate");
  lines.push("");
  lines.push(`- expected-but-not-final count: ${report.authoritativeExpectedButNotFinalCount ?? 0}`);
  lines.push(`- db-expected-warning count: ${report.dbExpectedButNotFinalCount ?? 0}`);
  lines.push(`- web fallback count: ${report.webFallbackCount ?? 0}`);
  lines.push(`- 000847 bucket: ${report.barcode000847Bucket ?? "not_observed"}`);
  lines.push("");

  lines.push("## Focus Contamination");
  lines.push("");
  lines.push(`- detected: ${report.focusContaminationDetected ? "yes" : "no"}`);
  if (report.focusContaminationSummary) {
    lines.push(`- firstFailureRole: ${report.focusContaminationSummary.firstFailureRole ?? "null"}`);
    lines.push(`- cascadeFailureCount: ${report.focusContaminationSummary.cascadeFailureCount ?? 0}`);
    lines.push(
      `- affectedRoles: ${(report.focusContaminationSummary.affectedRoles ?? []).join(", ") || "none"}`,
    );
  }
  lines.push("");

  if (Array.isArray(report.terminalReasonTopN) && report.terminalReasonTopN.length > 0) {
    lines.push("## TerminalReason TopN");
    lines.push("");
    report.terminalReasonTopN.forEach((item) => {
      lines.push(`- ${item.reason}: count=${item.count} rate=${item.rate ?? "n/a"}`);
    });
    lines.push("");
  }

  if (report.barcodeFocus?.summary) {
    lines.push("## Focus Rows");
    lines.push("");
    lines.push(`- Total rows: ${report.focusRows?.length ?? 0}`);
    lines.push(`- Roles: ${(report.focusRows ?? []).map((row) => row?.role).filter(Boolean).join(", ") || "n/a"}`);
    const focusRows = Array.isArray(report.focusRows) ? report.focusRows : [];
    focusRows.slice(0, 30).forEach((row) => {
      lines.push(
        `- ${row.role ?? "unknown"} ${row.scenario ?? "focus_probe"}: terminal=${row.terminal ?? "null"} doneMs=${row.doneMs ?? "null"} requestId=${row.requestId ?? "null"} meta=${JSON.stringify(
          {
            sourceType: row?.sourceType ?? null,
            sourceTypeFinal: row?.sourceTypeFinal ?? null,
            identityValue: row?.authoritativeIdentity?.value ?? null,
            productIdentitySourceAttribution:
              row?.productIdentity?.sourceAttribution ?? null,
            productIdentityIdentityStable:
              typeof row?.productIdentity?.identityStable === "boolean"
                ? row.productIdentity.identityStable
                : null,
            productIdentityName: row?.productIdentity?.name ?? null,
            npnCandidatesCount: readNpnCandidates(row).length,
            candidateBackfillReasonCode: readCandidateBackfill(row)?.reasonCode ?? null,
            candidateBackfillUsed: readCandidateBackfill(row)?.used ?? null,
            candidateBackfillScoreSuppressed:
              readCandidateBackfill(row)?.scoreSuppressed ?? null,
            scoreReasonCode: readScoreReasonCode(row),
            scoreAvailable: readScoreAvailable(row),
            terminalReason: row?.terminalReason ?? null,
            degradedMode: row?.degradedMode ?? null,
            stage0Winner: row?.stage0Winner ?? null,
            stage0StartCount: row?.stage0StartCount ?? null,
            stage0ReplaceCount: row?.stage0ReplaceCount ?? null,
            failureClass: row?.failureClass ?? null,
            route: row?.route ?? null,
          },
        )}`,
      );
    });
    lines.push("");
  }

  if (Array.isArray(report.terminalReasonNullSamples) && report.terminalReasonNullSamples.length > 0) {
    lines.push("## TerminalReason Null-Like Samples");
    lines.push("");
    report.terminalReasonNullSamples.forEach((sample) => {
      lines.push(
        `- requestId=${sample.requestId ?? "null"} barcode=${sample.barcode ?? "null"} route=${sample.route ?? "null"} sourceType=${sample.sourceType ?? "null"} sourceTypeFinal=${sample.sourceTypeFinal ?? "null"} stage0Winner=${sample.stage0Winner ?? "null"} terminal=${sample.terminal ?? "null"} role=${sample.role ?? "null"} scenario=${sample.scenario ?? "null"}`,
      );
    });
    lines.push("");
  }

  if (Array.isArray(report.sourceTypeFinalViolations) && report.sourceTypeFinalViolations.length > 0) {
    lines.push("## SourceTypeFinal Violations");
    lines.push("");
    report.sourceTypeFinalViolations.slice(0, 100).forEach((item) => {
      lines.push(
        `- barcode=${item.barcode ?? "null"} bucket=${item.bucket ?? "null"} severity=${item.severity ?? "warning"} route=${item.route ?? "null"} sourceType=${item.sourceType ?? "null"} expectedSource=${item.expectedSetSource ?? "null"} expectedEnforcement=${item.expectedSetEnforcement ?? "null"} terminal=${item.terminal ?? "null"} requestId=${item.requestId ?? "null"} scenario=${item.scenario ?? "null"} round=${item.round ?? "null"} slot=${item.slot ?? "null"} role=${item.role ?? "null"}`,
      );
    });
    lines.push("");
  }

  if (Array.isArray(report.repairQueue?.repairQueue)) {
    lines.push("## Repair Queue");
    lines.push("");
    lines.push(`- source: ${report.repairQueue.queueSource ?? "unknown"}`);
    lines.push(`- sourceReport: ${report.repairQueue.sourceReport ?? "unknown"}`);
    lines.push(`- infraUntrusted: ${report.repairQueue.infraUntrusted ? "yes" : "no"}`);
    lines.push(`- fallbackUsed: ${report.repairQueue.fallbackUsed ? "yes" : "no"}`);
    lines.push(`- queueSize: ${report.repairQueue.repairQueue.length}`);
    report.repairQueue.repairQueue.slice(0, 50).forEach((item) => {
      lines.push(
        `- barcode=${item.barcode} occurrences=${item.occurrences} scenarios=${item.scenarios?.join(",") || "none"} slots=${item.slots?.join(",") || "none"} sourceTypes=${item.sourceTypes?.join(",") || "none"} reason=${item.expectedSetReason ?? "none"}`,
      );
    });
    lines.push("");
  }

  lines.push("## Script Status");
  lines.push("");
  lines.push(`- enrich-stream-concurrency-gate: exit=${report.scripts.enrich.exitCode} durationMs=${report.scripts.enrich.durationMs}`);
  lines.push(`- bulk-barcode-e2e: exit=${report.scripts.bulk.exitCode} durationMs=${report.scripts.bulk.durationMs}`);
  lines.push(`- ods-ul-visibility-report: exit=${report.scripts.ulVisibility.exitCode} durationMs=${report.scripts.ulVisibility.durationMs}`);
  lines.push(`- ods-ul-coverage-gate: exit=${report.scripts.ulCoverageGate.exitCode} durationMs=${report.scripts.ulCoverageGate.durationMs}`);
  lines.push(`- write-policy-shadow-report: exit=${report.scripts.writePolicyShadow.exitCode} durationMs=${report.scripts.writePolicyShadow.durationMs}`);
  lines.push(`- candidates-quality-report: exit=${report.scripts.candidatesQuality.exitCode} durationMs=${report.scripts.candidatesQuality.durationMs}`);
  lines.push(`- negative-cache-residual-report: exit=${report.scripts.negativeCacheResidual.exitCode} durationMs=${report.scripts.negativeCacheResidual.durationMs}`);
  lines.push(`- surface-consistency-report: exit=${report.scripts.surfaceConsistency.exitCode} durationMs=${report.scripts.surfaceConsistency.durationMs}`);
  lines.push("");

  if (Array.isArray(report.verdict.warnings) && report.verdict.warnings.length > 0) {
    lines.push("## Warnings");
    lines.push("");
    report.verdict.warnings.forEach((warning) => {
      lines.push(`- ${warning}`);
    });
    lines.push("");
  }

  if (report.verdict.reasons.length > 0) {
    lines.push("## Failure Reasons");
    lines.push("");
    report.verdict.reasons.forEach((reason) => {
      lines.push(`- ${reason}`);
    });
    lines.push("");
  }

  if (Array.isArray(report.verdict.suppressedProductReasons) && report.verdict.suppressedProductReasons.length > 0) {
    lines.push("## Suppressed Product Reasons");
    lines.push("");
    report.verdict.suppressedProductReasons.forEach((reason) => {
      lines.push(`- ${reason}`);
    });
    lines.push("");
  }

  if (report.mustDoneViolations.length > 0) {
    lines.push("## Must-DONE Violations");
    lines.push("");
    report.mustDoneViolations.forEach((item) => {
      lines.push(`- ${item.scenario}: ${item.barcode ?? "unknown"} -> ${item.terminal ?? "unknown"}`);
    });
    lines.push("");
  }

  return `${lines.join("\n").trim()}\n`;
};

const main = async () => {
  await fs.mkdir(OUTPUT_DIR, { recursive: true });
  await fs.mkdir(ENRICH_OUT_DIR, { recursive: true });
  await fs.mkdir(BULK_OUT_DIR, { recursive: true });
  await fs.mkdir(UL_OUT_DIR, { recursive: true });

  const state = {
    backend: {
      managed: manageBackend,
      command: manageBackend ? backendCmd : null,
      healthUrl,
      healthy: null,
      backendLogPath: null,
    },
  };

  let backendChild = null;
  if (manageBackend) {
    console.log(`[stable-gates] starting managed backend: ${backendCmd}`);
    const managed = await startManagedBackend();
    backendChild = managed.child;
    state.backend.healthy = managed.healthy;
    state.backend.backendLogPath = managed.backendLogPath;
    if (!managed.healthy.ok) {
      throw new Error(`Managed backend health check failed: ${managed.healthy.error ?? "unknown_error"}`);
    }
  }

  const enrichRun = skipConcurrency
    ? { scriptPath: "scripts/maintainer/enrich-stream-concurrency-gate.mjs", exitCode: 0, durationMs: 0, skipped: true }
    : await runNodeScript("scripts/maintainer/enrich-stream-concurrency-gate.mjs", {
        API_BASE_URL,
        ENRICH_STREAM_GATE_OUT_DIR: ENRICH_OUT_DIR,
        ENRICH_STREAM_GATE_STREAM_MODE: enrichStreamGateStreamMode,
      });

  const bulkRun = skipBulk
    ? { scriptPath: "scripts/maintainer/bulk-barcode-e2e.mjs", exitCode: 0, durationMs: 0, skipped: true }
    : await runNodeScript("scripts/maintainer/bulk-barcode-e2e.mjs", {
        API_BASE_URL,
        BULK_E2E_OUT_DIR: BULK_OUT_DIR,
      });

  const ulVisibilityRun = skipUl
    ? { scriptPath: "scripts/maintainer/ods-ul-visibility-report.mjs", exitCode: 0, durationMs: 0, skipped: true }
    : await runNodeScript(
        "scripts/maintainer/ods-ul-visibility-report.mjs",
        {
          API_BASE_URL,
        },
        ["--out-dir", UL_OUT_DIR, "--barcodes-file", ulBarcodesFile],
      );
  const ulCoverageGateRun = skipUl
    ? { scriptPath: "scripts/maintainer/ods-ul-coverage-gate.mjs", exitCode: 0, durationMs: 0, skipped: true }
    : await runNodeScript(
        "scripts/maintainer/ods-ul-coverage-gate.mjs",
        {
          API_BASE_URL,
        },
        [
          "--report",
          path.join(UL_OUT_DIR, "ods_ul_visibility_report.json"),
          "--out-dir",
          UL_OUT_DIR,
          ...(ulGateEnforce ? ["--enforce"] : []),
        ],
      );
  const writePolicyShadowRun = skipShadowReports
    ? { scriptPath: "scripts/maintainer/write-policy-shadow-report.mjs", exitCode: 0, durationMs: 0, skipped: true }
    : await runNodeScript(
        "scripts/maintainer/write-policy-shadow-report.mjs",
        {
          API_BASE_URL,
        },
        ["--api-base-url", API_BASE_URL, "--out-dir", OUTPUT_DIR],
      );
  const candidatesQualityRun = skipShadowReports
    ? { scriptPath: "scripts/maintainer/candidates-quality-report.mjs", exitCode: 0, durationMs: 0, skipped: true }
    : await runNodeScript(
        "scripts/maintainer/candidates-quality-report.mjs",
        {},
        ["--out-dir", OUTPUT_DIR, ...(SHADOW_REPORTS_ENFORCE ? ["--enforce"] : [])],
      );
  const negativeCacheResidualRun = skipShadowReports
    ? { scriptPath: "scripts/maintainer/negative-cache-residual-report.mjs", exitCode: 0, durationMs: 0, skipped: true }
    : await runNodeScript(
        "scripts/maintainer/negative-cache-residual-report.mjs",
        {},
        ["--out-dir", OUTPUT_DIR, ...(SHADOW_REPORTS_ENFORCE ? ["--enforce"] : [])],
      );
  const surfaceConsistencyRun = skipShadowReports
    ? { scriptPath: "scripts/maintainer/surface-consistency-report.mjs", exitCode: 0, durationMs: 0, skipped: true }
    : await runNodeScript(
        "scripts/maintainer/surface-consistency-report.mjs",
        {
          API_BASE_URL,
        },
        [
          "--api-base-url",
          API_BASE_URL,
          "--out-dir",
          OUTPUT_DIR,
          ...(SHADOW_REPORTS_ENFORCE ? ["--enforce"] : []),
        ],
      );

  const enrichReport = await readJson(path.join(ENRICH_OUT_DIR, "report.json"));
  const bulkGate = await readJson(path.join(BULK_OUT_DIR, "gate.json"));
  const bulkSummary = await readJson(path.join(BULK_OUT_DIR, "summary.json"));
  const ulVisibilityReport = await readJson(path.join(UL_OUT_DIR, "ods_ul_visibility_report.json"));
  const ulCoverageGate = await readJson(path.join(UL_OUT_DIR, "gate.json"));
  const writePolicyShadowReport = await readJson(WRITE_POLICY_SHADOW_REPORT_PATH);
  const candidatesQualityReport = await readJson(CANDIDATES_QUALITY_REPORT_PATH);
  const negativeCacheResidualReport = await readJson(NEGATIVE_CACHE_RESIDUAL_REPORT_PATH);
  const surfaceConsistencyReport = await readJson(SURFACE_CONSISTENCY_REPORT_PATH);
  const reportFreshness = await evaluateReportFreshness({
    anchorMs: Date.now(),
    maxAgeMs: REPORT_FRESHNESS_MAX_AGE_MS,
    reports: [
      {
        key: "surface_consistency",
        required: !skipShadowReports,
        report: surfaceConsistencyReport,
        path: SURFACE_CONSISTENCY_REPORT_PATH,
      },
      {
        key: "candidates_quality",
        required: !skipShadowReports,
        report: candidatesQualityReport,
        path: CANDIDATES_QUALITY_REPORT_PATH,
      },
      {
        key: "ods_ul_visibility",
        required: !skipUl,
        report: ulVisibilityReport,
        path: path.join(UL_OUT_DIR, "ods_ul_visibility_report.json"),
      },
    ],
  });
  const mobileSoakSummary = mobileSoakSummaryPath ? await readJson(mobileSoakSummaryPath) : null;
  const focusRows = await runFocusProbes();
  const focusContamination = detectFocusContamination(focusRows);
  const expectedAuthoritativeResolved = await resolveExpectedAuthoritativeSet(expectedAuthoritativePath);
  await fs.writeFile(
    EXPECTED_AUTH_RESOLVED_PATH,
    JSON.stringify(expectedAuthoritativeResolved, null, 2),
    "utf8",
  );

  const enrichScenarios = Array.isArray(enrichReport?.details) ? enrichReport.details : [];
  const bulkRows = Array.isArray(bulkSummary) ? bulkSummary : [];
  const evidenceRows = collectEvidenceRows(enrichScenarios, bulkRows);
  const focusEvidenceRows = focusRows.map((row) => ({
    ...row,
    source: "focus_probe",
    round: null,
    slot: Number.isFinite(Number(row?.slot)) ? Number(row.slot) : null,
    terminalReason: row?.terminalReason ?? null,
    error: row?.error ?? null,
  }));
  const focusCriticalEvidenceRows = focusEvidenceRows.filter((row) =>
    FOCUS_CRITICAL_ROLES.has(String(row?.role ?? "")),
  );
  const allEvidenceRows = [...evidenceRows, ...focusCriticalEvidenceRows];
  const infraTrust = buildInfraTrust(evidenceRows);
  const terminalBreakdown = aggregateScenarioCounts(enrichScenarios, "terminalBreakdown");
  const failureClassCounts = aggregateScenarioCounts(enrichScenarios, "failureClassCounts");
  const noiseCounts = aggregateScenarioCounts(enrichScenarios, "noiseCounts");
  const terminalReasonCounts = aggregateScenarioCounts(enrichScenarios, "terminalReasonCounts");
  const stage0WinnerCounts = aggregateScenarioCounts(enrichScenarios, "stage0WinnerCounts");
  const degradedModeCounts = aggregateScenarioCounts(enrichScenarios, "degradedModeCounts");
  const admissionLaneCounts = aggregateScenarioCounts(enrichScenarios, "admissionLaneCounts");

  mergeCountMaps(terminalBreakdown, bulkGate?.metrics?.terminalBreakdown ?? null);
  mergeCountMaps(failureClassCounts, bulkGate?.metrics?.failureClassBreakdown ?? null);
  mergeCountMaps(noiseCounts, bulkGate?.metrics?.noiseCounts ?? null);
  mergeCountMaps(terminalReasonCounts, bulkGate?.metrics?.terminalReasonCounts ?? countBy(bulkRows, (row) => row?.terminalReason));
  mergeCountMaps(stage0WinnerCounts, bulkGate?.metrics?.stage0WinnerCounts ?? countBy(bulkRows, (row) => row?.stage0Winner));
  mergeCountMaps(
    degradedModeCounts,
    bulkGate?.metrics?.degradedModeCounts ?? countBooleans(bulkRows, (row) => row?.degradedMode),
  );
  mergeCountMaps(terminalReasonCounts, countBy(focusRows, (row) => row?.terminalReason));
  mergeCountMaps(stage0WinnerCounts, countBy(focusRows, (row) => row?.stage0Winner));
  mergeCountMaps(degradedModeCounts, countBooleans(focusRows, (row) => row?.degradedMode));
  mergeCountMaps(admissionLaneCounts, countBy(focusRows, (row) => row?.admissionLane));

  const terminalReasonCountsCanonical = allEvidenceRows.reduce((acc, row) => {
    const reason = normalizeTerminalReason(row?.terminalReason);
    if (!reason) {
      acc.null = (acc.null ?? 0) + 1;
      return acc;
    }
    if (reason.toUpperCase() === "UNKNOWN") {
      acc.UNKNOWN = (acc.UNKNOWN ?? 0) + 1;
      return acc;
    }
    acc[reason] = (acc[reason] ?? 0) + 1;
    return acc;
  }, {});
  const stage0WinnerCountsCanonical = allEvidenceRows.reduce((acc, row) => {
    const key = row?.stage0Winner ? String(row.stage0Winner) : "UNKNOWN";
    acc[key] = (acc[key] ?? 0) + 1;
    return acc;
  }, {});
  const degradedModeCountsCanonical = countBooleans(allEvidenceRows, (row) => row?.degradedMode);

  const mustDoneViolations = aggregateMustDoneViolations(enrichScenarios);
  const parallel9 = Array.isArray(enrichReport?.scenarios)
    ? enrichReport.scenarios.find((item) => item?.name === "parallel9")
    : null;
  const barcodeFocusRows = extractBarcodeFocusRows(enrichScenarios, FOCUS_BARCODE);
  const barcodeFocusSummary = summarizeFocusRows(barcodeFocusRows, "parallel9");
  const sourceTypeFinalCounts = buildSourceTypeFinalCounts(allEvidenceRows);
  const productIdentityStats = buildProductIdentityStats(allEvidenceRows);
  const terminalReasonQuality = buildTerminalReasonNullMetrics(allEvidenceRows);
  const terminalReasonTopN = buildTerminalReasonTopN(allEvidenceRows, TERMINAL_REASON_TOPN_LIMIT);
  const terminalReasonSemanticStats = buildTerminalReasonSemanticStats(allEvidenceRows);
  const npnCandidateStats = buildNpnCandidateStats(allEvidenceRows);
  const sourceTypeFinalEvaluation = evaluateSourceTypeFinalViolations(
    allEvidenceRows,
    expectedAuthoritativeResolved,
  );
  let repairQueue = buildRepairQueueFromViolations(
    sourceTypeFinalEvaluation.sourceTypeFinalViolations,
  );
  let repairQueueSource = "current_report";
  let repairQueueSourceReport = REPORT_JSON_PATH;
  let repairQueueFallbackUsed = false;
  let repairQueueFallbackReport = null;
  if (infraTrust.infraUntrusted && repairQueue.length === 0 && repairQueueFallbackReportPath) {
    const fallbackReport = await readJson(repairQueueFallbackReportPath);
    const fallbackViolations = Array.isArray(fallbackReport?.sourceTypeFinalViolations)
      ? fallbackReport.sourceTypeFinalViolations
      : [];
    const fallbackQueue = buildRepairQueueFromViolations(fallbackViolations);
    if (fallbackQueue.length > 0) {
      repairQueue = fallbackQueue;
      repairQueueSource = "fallback_report";
      repairQueueSourceReport = repairQueueFallbackReportPath;
      repairQueueFallbackUsed = true;
      repairQueueFallbackReport = repairQueueFallbackReportPath;
    }
  }
  const repairQueuePayload = {
    generatedAt: new Date().toISOString(),
    queueSource: repairQueueSource,
    sourceReport: repairQueueSourceReport,
    infraUntrusted: infraTrust.infraUntrusted,
    fallbackUsed: repairQueueFallbackUsed,
    fallbackReport: repairQueueFallbackReport,
    repairQueue,
  };
  await fs.writeFile(REPAIR_QUEUE_JSON_PATH, JSON.stringify(repairQueuePayload, null, 2), "utf8");
  await fs.writeFile(REPAIR_QUEUE_MD_PATH, repairQueueToMarkdown(repairQueuePayload), "utf8");

  const verdictReasons = [];
  const verdictWarnings = [];
  if (!skipConcurrency && enrichRun.exitCode !== 0) verdictReasons.push(`concurrency_gate_exit_${enrichRun.exitCode}`);
  if (!skipBulk && bulkRun.exitCode !== 0) verdictReasons.push(`bulk_gate_exit_${bulkRun.exitCode}`);
  if (!skipUl && ulVisibilityRun.exitCode !== 0) verdictReasons.push(`ul_visibility_exit_${ulVisibilityRun.exitCode}`);
  if (!skipUl && ulCoverageGateRun.exitCode !== 0) verdictReasons.push(`ul_coverage_gate_exit_${ulCoverageGateRun.exitCode}`);
  if (!skipShadowReports && writePolicyShadowRun.exitCode !== 0) {
    verdictReasons.push(`write_policy_shadow_report_exit_${writePolicyShadowRun.exitCode}`);
  }
  if (!skipShadowReports && candidatesQualityRun.exitCode !== 0) {
    verdictReasons.push(`candidates_quality_report_exit_${candidatesQualityRun.exitCode}`);
  }
  if (!skipShadowReports && negativeCacheResidualRun.exitCode !== 0) {
    verdictReasons.push(`negative_cache_residual_report_exit_${negativeCacheResidualRun.exitCode}`);
  }
  if (!skipShadowReports && surfaceConsistencyRun.exitCode !== 0) {
    verdictReasons.push(`surface_consistency_report_exit_${surfaceConsistencyRun.exitCode}`);
  }
  if (!skipConcurrency && !enrichReport) verdictReasons.push("concurrency_report_missing");
  if (!skipBulk && !bulkGate) verdictReasons.push("bulk_gate_report_missing");
  if (!skipUl && !ulVisibilityReport) verdictReasons.push("ul_visibility_report_missing");
  if (!skipUl && !ulCoverageGate) verdictReasons.push("ul_coverage_gate_report_missing");
  if (!skipShadowReports && !writePolicyShadowReport) verdictReasons.push("write_policy_shadow_report_missing");
  if (!skipShadowReports && !candidatesQualityReport) verdictReasons.push("candidates_quality_report_missing");
  if (!skipShadowReports && !negativeCacheResidualReport) verdictReasons.push("negative_cache_residual_report_missing");
  if (!skipShadowReports && !surfaceConsistencyReport) verdictReasons.push("surface_consistency_report_missing");
  for (const staleReason of reportFreshness.staleReasons) {
    verdictReasons.push(staleReason);
  }
  if (!skipBulk && bulkGate?.enforce !== false && bulkGate?.pass === false) verdictReasons.push("bulk_gate_failed");
  if (!skipShadowReports && writePolicyShadowReport?.checks?.hasRequiredDecisionFields !== true) {
    verdictReasons.push("write_policy_shadow_missing_required_decision_fields");
  }
  if (!skipShadowReports && writePolicyShadowReport?.checks?.hasBucketGroups !== true) {
    verdictReasons.push("write_policy_shadow_missing_required_buckets");
  }
  const candidatesQualityFresh =
    reportFreshness?.byKey?.candidates_quality?.isFresh !== false;
  const surfaceConsistencyFresh =
    reportFreshness?.byKey?.surface_consistency?.isFresh !== false;
  const ulVisibilityFresh =
    reportFreshness?.byKey?.ods_ul_visibility?.isFresh !== false;
  if (
    !skipShadowReports
    && SHADOW_REPORTS_ENFORCE
    && candidatesQualityFresh
    && Number(candidatesQualityReport?.conflictsByBarcode ?? 1) > 0
  ) {
    verdictReasons.push(`candidates_quality_conflicts_by_barcode_${Number(candidatesQualityReport?.conflictsByBarcode ?? 0)}`);
  }
  if (!skipShadowReports && SHADOW_REPORTS_ENFORCE && Number(negativeCacheResidualReport?.residualHitRate ?? 1) > 0) {
    verdictReasons.push(`negative_cache_residual_hit_rate_${Number(negativeCacheResidualReport?.residualHitRate ?? 0)}`);
  }
  if (!skipShadowReports && SHADOW_REPORTS_ENFORCE && surfaceConsistencyFresh) {
    const sourceDatasetMismatch = Number(surfaceConsistencyReport?.sourceDatasetMismatchCount ?? 0);
    const verificationStatusMismatch = Number(surfaceConsistencyReport?.verificationStatusMismatchCount ?? 0);
    const ingredientContradiction = Number(surfaceConsistencyReport?.ingredientCountContradictionCount ?? 0);
    const doseContradiction = Number(surfaceConsistencyReport?.doseCountContradictionCount ?? 0);
    const ingredientInferredOnlyContradiction = Number(
      surfaceConsistencyReport?.ingredientCountInferredOnlyContradictionCount ?? 0,
    );
    const doseInferredOnlyContradiction = Number(
      surfaceConsistencyReport?.doseCountInferredOnlyContradictionCount ?? 0,
    );
    if (sourceDatasetMismatch > 0) {
      verdictReasons.push(`surface_consistency_source_dataset_mismatch_${sourceDatasetMismatch}`);
    }
    if (verificationStatusMismatch > 0) {
      verdictReasons.push(`surface_consistency_verification_status_mismatch_${verificationStatusMismatch}`);
    }
    if (ingredientContradiction > 0) {
      verdictReasons.push(`surface_consistency_ingredient_count_contradiction_${ingredientContradiction}`);
    }
    if (doseContradiction > 0) {
      verdictReasons.push(`surface_consistency_dose_count_contradiction_${doseContradiction}`);
    }
    if (ingredientInferredOnlyContradiction > 0) {
      verdictWarnings.push(
        `surface_consistency_ingredient_count_inferred_only_contradiction_${ingredientInferredOnlyContradiction}`,
      );
    }
    if (doseInferredOnlyContradiction > 0) {
      verdictWarnings.push(`surface_consistency_dose_count_inferred_only_contradiction_${doseInferredOnlyContradiction}`);
    }
  }
  if (!skipUl && !ulVisibilityFresh) {
    verdictWarnings.push("ul_visibility_report_stale_rerun_required");
  } else if (!skipUl && ulCoverageGate?.inconclusive) {
    verdictWarnings.push(
      `ul_coverage_inconclusive_${ulCoverageGate?.infraReason ?? "unknown_reason"}`,
    );
  } else if (!skipUl && ulCoverageGate?.pass === false) {
    verdictReasons.push("ul_coverage_gate_failed");
  }
  if (mustDoneViolations.length > 0) verdictReasons.push(`must_done_violations_${mustDoneViolations.length}`);
  if (mobileSoakSummaryPath && !mobileSoakSummary) {
    verdictWarnings.push("mobile_soak_summary_missing");
  }
  if (mobileSoakSummary?.stats) {
    const soakStats = mobileSoakSummary.stats;
    const addMobileRichnessViolation = (code) => {
      if (MOBILE_RICHNESS_ENFORCE_HARD_FAIL) verdictReasons.push(code);
      else verdictWarnings.push(code);
    };
    const regulatoryRichRateObserved = Number(
      soakStats.regulatoryRichRate_uniqueBarcode
      ?? soakStats.regulatoryRichRate
      ?? 0,
    );
    const regulatoryRichRateAttemptWeighted = Number(
      soakStats.regulatoryRichRate_attemptWeighted
      ?? soakStats.regulatoryRichRate
      ?? 0,
    );
    if (Number(soakStats.contentValuePassRate ?? 0) < 0.95) {
      verdictReasons.push("mobile_content_value_rate_below_95");
    }
    if (Number(soakStats.verifiedContentPassRate ?? 0) < 0.9) {
      verdictReasons.push("mobile_verified_content_rate_below_90");
    }
    if (Number(soakStats.webHintContentPassRate ?? 0) < 0.8) {
      verdictReasons.push("mobile_web_hint_content_rate_below_80");
    }
    if (Number(soakStats.degradedContentPassRate ?? 1) < 0.95) {
      verdictReasons.push("mobile_degraded_content_rate_below_95");
    }
    if (Number(soakStats.ulVisibilityPassRate ?? 1) < 0.95) {
      verdictReasons.push("mobile_ul_visibility_rate_below_95");
    }
    if (Number(soakStats.firstFramePendingRate ?? 0) <= 0) {
      verdictReasons.push("mobile_first_frame_pending_rate_not_positive");
    }
    if (Number(soakStats.firstFrameTrustedRateRegulatory ?? 0) < 0.6) {
      verdictReasons.push("mobile_first_frame_regulatory_trusted_rate_below_60");
    }
    if (regulatoryRichRateObserved < MOBILE_REGULATORY_RICH_RATE_MIN) {
      addMobileRichnessViolation(
        `mobile_regulatory_rich_rate_unique_below_${Math.round(MOBILE_REGULATORY_RICH_RATE_MIN * 100)}`,
      );
    }
    if (regulatoryRichRateAttemptWeighted < MOBILE_REGULATORY_RICH_RATE_MIN) {
      verdictWarnings.push(
        `mobile_regulatory_rich_rate_attempt_weighted_below_${Math.round(MOBILE_REGULATORY_RICH_RATE_MIN * 100)}`,
      );
    }
    if (Number(soakStats.scoreVisibleRate ?? 0) < MOBILE_SCORE_VISIBLE_RATE_MIN) {
      addMobileRichnessViolation(
        `mobile_score_visible_rate_below_${Math.round(MOBILE_SCORE_VISIBLE_RATE_MIN * 100)}`,
      );
    }
    const addReleaseViolation = (code) => {
      if (MOBILE_RELEASE_STRICT_ENFORCE) verdictReasons.push(code);
      else verdictWarnings.push(code);
    };
    if (Number(soakStats.esterCoreRate_all ?? 0) < MOBILE_ESTER_CORE_RATE_ALL_MIN) {
      addReleaseViolation(
        `mobile_ester_core_rate_all_below_${Math.round(MOBILE_ESTER_CORE_RATE_ALL_MIN * 100)}`,
      );
    }
    if (Number(soakStats.esterCoreRate_fixable ?? 0) < MOBILE_ESTER_CORE_RATE_FIXABLE_MIN) {
      addReleaseViolation(
        `mobile_ester_core_rate_fixable_below_${Math.round(MOBILE_ESTER_CORE_RATE_FIXABLE_MIN * 100)}`,
      );
    }
    const esterByRole =
      soakStats?.esterCoreRateByRole && typeof soakStats.esterCoreRateByRole === "object"
        ? soakStats.esterCoreRateByRole
        : {};
    const lnhpdEsterTotal = Number(esterByRole?.lnhpd?.total ?? 0);
    const lnhpdEsterPassCount = Number(esterByRole?.lnhpd?.passCount ?? 0);
    const lnhpdEsterPassRateRaw = Number(esterByRole?.lnhpd?.passRate ?? 0);
    const lnhpdDataCeilingCount = Number(soakStats?.dataCeilingRateByRole?.lnhpd?.dataCeilingCount ?? 0);
    const lnhpdEsterFixableTotal = Math.max(0, lnhpdEsterTotal - lnhpdDataCeilingCount);
    const lnhpdEsterPassRateFixable =
      lnhpdEsterFixableTotal > 0
        ? lnhpdEsterPassCount / lnhpdEsterFixableTotal
        : lnhpdEsterPassRateRaw;
    // Prefer fixable denominator to avoid warning on known data-ceiling samples.
    if (lnhpdEsterPassRateFixable < MOBILE_ESTER_CORE_RATE_LNHPD_MIN) {
      addReleaseViolation(
        `mobile_ester_core_rate_lnhpd_below_${Math.round(MOBILE_ESTER_CORE_RATE_LNHPD_MIN * 100)}`,
      );
    }
    if (Number(esterByRole?.dsld?.passRate ?? 0) < MOBILE_ESTER_CORE_RATE_DSLD_MIN) {
      addReleaseViolation(
        `mobile_ester_core_rate_dsld_below_${Math.round(MOBILE_ESTER_CORE_RATE_DSLD_MIN * 100)}`,
      );
    }
    const esterUlReferenceReadyRateEligible = Number(
      soakStats.esterUlReferenceReadyRate_eligible
      ?? soakStats.esterUlReadyRate_eligible
      ?? 0,
    );
    if (esterUlReferenceReadyRateEligible < MOBILE_ESTER_UL_READY_ELIGIBLE_MIN) {
      addReleaseViolation(
        `mobile_ester_ul_ready_eligible_below_${Math.round(MOBILE_ESTER_UL_READY_ELIGIBLE_MIN * 100)}`,
      );
    }
    const esterUlComparableReadyRateEligible = Number(soakStats.esterUlComparableReadyRate_eligible ?? 0);
    if (esterUlComparableReadyRateEligible < MOBILE_ESTER_UL_COMPARABLE_ELIGIBLE_WARN_MIN) {
      verdictWarnings.push(
        `mobile_ester_ul_comparable_eligible_below_${Math.round(MOBILE_ESTER_UL_COMPARABLE_ELIGIBLE_WARN_MIN * 100)}`,
      );
    }
    if (Number(soakStats.scoreVisibleRate ?? 0) < MOBILE_SCORE_VISIBLE_RATE_STRICT_MIN) {
      addReleaseViolation(
        `mobile_score_visible_rate_strict_below_${Math.round(MOBILE_SCORE_VISIBLE_RATE_STRICT_MIN * 100)}`,
      );
    }
    const verifiedFinalTotal = Object.values(esterByRole).reduce(
      (acc, row) => acc + Number(row?.total ?? 0),
      0,
    );
    const scoreNotFoundTargetedRate =
      verifiedFinalTotal > 0
        ? Number(soakStats.scoreNotFoundTargetedCount ?? 0) / verifiedFinalTotal
        : 0;
    if (verifiedFinalTotal > 0 && scoreNotFoundTargetedRate > MOBILE_NOT_FOUND_TARGETED_MAX) {
      addReleaseViolation(
        `mobile_score_not_found_targeted_rate_${Number(scoreNotFoundTargetedRate.toFixed(3))}_gt_${MOBILE_NOT_FOUND_TARGETED_MAX}`,
      );
    }

    const killerConfiguredAttempts = Number(soakStats?.killerConfiguredAttempts ?? soakStats?.killerConfidence?.total ?? 0);
    const killerInfraUnavailableCount = Number(soakStats?.killerInfraUnavailableCount ?? 0);
    const killerInfraUnavailableRate =
      Number.isFinite(Number(soakStats?.killerInfraUnavailableRate))
        ? Number(soakStats.killerInfraUnavailableRate)
        : killerConfiguredAttempts > 0
          ? killerInfraUnavailableCount / killerConfiguredAttempts
          : 0;
    if (killerInfraUnavailableRate > MOBILE_KILLER_INFRA_UNAVAILABLE_WARN_RATE) {
      verdictWarnings.push(
        `mobile_killer_infra_unavailable_rate_${Number(killerInfraUnavailableRate.toFixed(3))}_gt_${MOBILE_KILLER_INFRA_UNAVAILABLE_WARN_RATE}`,
      );
    }

    const killerProductAttempts = Number(
      soakStats?.killerProductAttempts ?? Math.max(0, killerConfiguredAttempts - killerInfraUnavailableCount),
    );
    const killerInconclusive =
      Boolean(soakStats?.killerInconclusive)
      || (killerConfiguredAttempts > 0 && killerProductAttempts === 0);
    if (killerInconclusive) {
      verdictWarnings.push("mobile_killer_inconclusive_product_attempts_zero");
    } else {
      const killerProductTerminalReasonCounts =
        (soakStats?.killerProductTerminalReasonCounts && typeof soakStats.killerProductTerminalReasonCounts === "object"
          ? soakStats.killerProductTerminalReasonCounts
          : null)
        || {};
      const killerClientTimeoutCount = Number(killerProductTerminalReasonCounts.CLIENT_TIMEOUT ?? 0);
      const killerClientTimeoutRate =
        Number.isFinite(Number(soakStats?.killerProductClientTimeoutRate))
          ? Number(soakStats.killerProductClientTimeoutRate)
          : killerProductAttempts > 0
            ? killerClientTimeoutCount / killerProductAttempts
            : 0;
      if (killerProductAttempts > 0 && killerClientTimeoutRate > MOBILE_KILLER_CLIENT_TIMEOUT_RATE_MAX) {
        verdictReasons.push(
          `mobile_killer_product_client_timeout_rate_${Number(killerClientTimeoutRate.toFixed(3))}_gt_${MOBILE_KILLER_CLIENT_TIMEOUT_RATE_MAX}`,
        );
      }
      const killerTimeoutClassCounts =
        (soakStats.killerProductTimeoutClassCounts && typeof soakStats.killerProductTimeoutClassCounts === "object"
          ? soakStats.killerProductTimeoutClassCounts
          : soakStats.killerTimeoutClassCounts && typeof soakStats.killerTimeoutClassCounts === "object"
            ? soakStats.killerTimeoutClassCounts
            : soakStats?.killerConfidence?.timeoutClassCounts)
        || {};
      const killerSseConnectedNoDone = Number(killerTimeoutClassCounts.SSE_CONNECTED_BUT_NO_DONE ?? 0);
      const killerSseConnectFailed = Number(killerTimeoutClassCounts.SSE_CONNECT_FAILED ?? 0);
      if (killerSseConnectedNoDone > 0) {
        verdictReasons.push(`mobile_killer_sse_connected_but_no_done_${killerSseConnectedNoDone}`);
      }
      if (killerClientTimeoutCount > 0 && killerSseConnectFailed < killerClientTimeoutCount) {
        verdictReasons.push(
          `mobile_killer_timeout_class_mismatch_connect_failed_${killerSseConnectFailed}_of_${killerClientTimeoutCount}`,
        );
      }
    }

    const ceilingSuite =
      soakStats?.ceilingSuite && typeof soakStats.ceilingSuite === "object"
        ? soakStats.ceilingSuite
        : null;
    if (ceilingSuite && Number(ceilingSuite.total ?? 0) > 0) {
      const doneSeenRate = Number(ceilingSuite.doneSeenRate ?? 0);
      const consistencyFailCount = Number(ceilingSuite.coverDetailConsistencyFailCount ?? 0);
      const scoreTerminalSeenRate = Number(ceilingSuite.scoreTerminalSeenRate ?? 0);
      const verifiedUnverifiedConflictCount = Number(ceilingSuite.verifiedUnverifiedConflictCount ?? 0);
      if (doneSeenRate < 1) {
        verdictReasons.push(`mobile_ceiling_suite_done_seen_rate_${Number(doneSeenRate.toFixed(3))}_lt_1`);
      }
      if (consistencyFailCount > 0) {
        verdictReasons.push(`mobile_ceiling_suite_consistency_fail_count_${consistencyFailCount}`);
      }
      if (scoreTerminalSeenRate < 1) {
        verdictReasons.push(`mobile_ceiling_suite_score_terminal_seen_rate_${Number(scoreTerminalSeenRate.toFixed(3))}_lt_1`);
      }
      if (verifiedUnverifiedConflictCount > 0) {
        verdictReasons.push(`mobile_ceiling_suite_verified_unverified_conflict_count_${verifiedUnverifiedConflictCount}`);
      }
    }
  }
  if (terminalReasonQuality.warning) {
    verdictWarnings.push(
      `terminal_reason_null_like_rate_${terminalReasonQuality.terminalReasonNullLikeRate}_gt_${TERMINAL_REASON_WARN_THRESHOLD}`,
    );
  }
  if (terminalReasonQuality.fail) {
    verdictReasons.push(
      `terminal_reason_null_like_rate_${terminalReasonQuality.terminalReasonNullLikeRate}_gte_${TERMINAL_REASON_FAIL_THRESHOLD}`,
    );
  }
  if (sourceTypeFinalEvaluation.authoritativeExpectedButNotFinalCount > 0) {
    verdictReasons.push(
      `authoritative_expected_but_not_final_${sourceTypeFinalEvaluation.authoritativeExpectedButNotFinalCount}`,
    );
  }
  if (sourceTypeFinalEvaluation.dbExpectedButNotFinalCount > 0) {
    verdictWarnings.push(
      `db_expected_warning_source_type_final_false_${sourceTypeFinalEvaluation.dbExpectedButNotFinalCount}`,
    );
  }
  const actionableWebFallbackCount = sourceTypeFinalEvaluation.sourceTypeFinalViolations.filter((row) => {
    if (row?.bucket !== "allowed_web_fallback") return false;
    // focus_probe explicitly includes web_hint/not_found probes; do not warn for those expected fallbacks.
    if (row?.scenario === "focus_probe" && (row?.role === "web_hint" || row?.role === "not_found")) return false;
    return true;
  }).length;
  if (actionableWebFallbackCount > 0) {
    verdictWarnings.push(`web_fallback_source_type_final_false_${actionableWebFallbackCount}`);
  }
  if (focusRows.length < FOCUS_PROBE_SET.length) {
    verdictReasons.push(`focus_probe_incomplete_${focusRows.length}_of_${FOCUS_PROBE_SET.length}`);
  }
  const focusRolesSeen = new Set(focusRows.map((row) => row?.role).filter(Boolean));
  for (const item of FOCUS_PROBE_SET) {
    if (!focusRolesSeen.has(item.role)) {
      verdictReasons.push(`focus_role_missing_${item.role}`);
    }
  }
  if (focusContamination.detected) {
    verdictWarnings.push(
      `focus_probe_contamination_after_${focusContamination.summary?.firstFailureRole ?? "unknown"}`,
    );
  }

  const infraReasonsRaw = verdictReasons.filter((reason) => isInfraReason(reason));
  const productReasonsRaw = verdictReasons.filter((reason) => !isInfraReason(reason));
  const infraTriggeredReasons = infraTrust.triggeredBy.map((entry) => `infra_untrusted_${entry}`);
  if (infraTriggeredReasons.length > 0) {
    verdictWarnings.push(...infraTriggeredReasons);
  }
  let finalReasons = [...verdictReasons];
  let verdictClassification = "pass";
  let suppressedProductReasons = [];
  if (infraTrust.infraUntrusted) {
    const infraReasons = [...new Set([...infraReasonsRaw, ...infraTriggeredReasons])];
    finalReasons = infraReasons.length > 0 ? infraReasons : ["infra_untrusted_triggered"];
    suppressedProductReasons = [...new Set(productReasonsRaw)];
    verdictClassification = "infra_untrusted";
  } else if (finalReasons.length === 0) {
    verdictClassification = "pass";
  } else if (infraReasonsRaw.length > 0 && productReasonsRaw.length > 0) {
    verdictClassification = "mixed";
  } else if (productReasonsRaw.length > 0) {
    verdictClassification = "product_regression";
  } else {
    verdictClassification = "infra_untrusted";
  }
  const finalWarnings = [...new Set(verdictWarnings)];

  const fullReport = {
    generatedAt: new Date().toISOString(),
    apiBaseUrl: API_BASE_URL,
    outputDir: OUTPUT_DIR,
    backend: state.backend,
    scripts: {
      enrich: enrichRun,
      bulk: bulkRun,
      ulVisibility: ulVisibilityRun,
      ulCoverageGate: ulCoverageGateRun,
      writePolicyShadow: writePolicyShadowRun,
      candidatesQuality: candidatesQualityRun,
      negativeCacheResidual: negativeCacheResidualRun,
      surfaceConsistency: surfaceConsistencyRun,
    },
    terminalBreakdown,
    failureClassCounts,
    noiseCounts,
    terminalReasonCounts: terminalReasonCountsCanonical,
    terminalReasonTopN,
    stage0WinnerCounts: stage0WinnerCountsCanonical,
    degradedModeCounts: degradedModeCountsCanonical,
    admissionLaneCounts,
    sourceTypeFinalCounts,
    npnCandidateStats,
    candidateBackfillAttempted: npnCandidateStats.candidateBackfillAttempted,
    candidateBackfillUsed: npnCandidateStats.candidateBackfillUsed,
    candidateBackfillRejectedMismatch: npnCandidateStats.candidateBackfillRejectedMismatch,
    candidateBackfillTimeout: npnCandidateStats.candidateBackfillTimeout,
    scoreSuppressedByCandidateBackfillCount:
      npnCandidateStats.scoreSuppressedByCandidateBackfillCount,
    productIdentityStats,
    mustDoneViolations,
    terminalReasonQuality: {
      ...terminalReasonQuality,
      warnThreshold: TERMINAL_REASON_WARN_THRESHOLD,
      failThreshold: TERMINAL_REASON_FAIL_THRESHOLD,
      topNLimit: TERMINAL_REASON_TOPN_LIMIT,
    },
    terminalReasonSemanticStats,
    terminalReasonNullSamples: terminalReasonQuality.samples,
    infraTrust,
    authoritativeExpectedButNotFinalCount:
      sourceTypeFinalEvaluation.authoritativeExpectedButNotFinalCount,
    dbExpectedButNotFinalCount: sourceTypeFinalEvaluation.dbExpectedButNotFinalCount,
    webFallbackCount: sourceTypeFinalEvaluation.webFallbackCount,
    sourceTypeFinalViolations: sourceTypeFinalEvaluation.sourceTypeFinalViolations,
    barcode000847Bucket: sourceTypeFinalEvaluation.barcode000847Bucket,
    focusContaminationDetected: focusContamination.detected,
    focusContaminationSummary: focusContamination.summary,
    repairQueueArtifactPath: REPAIR_QUEUE_JSON_PATH,
    latencyStats: {
      parallel9DoneP95Ms: parallel9?.latencyStats?.doneMs?.p95 ?? null,
      parallel9NotFoundRev1P95Ms: parallel9?.latencyStats?.notFoundRev1Ms?.p95 ?? null,
      parallel9Rev1ToDoneP95Ms: parallel9?.latencyStats?.rev1ToDoneMs?.p95 ?? null,
      parallel9DoneTimerDriftP95Ms: parallel9?.latencyStats?.doneTimerDriftMs?.p95 ?? null,
      parallel9PersistedCommitModeCounts: parallel9?.persistedCommitModeCounts ?? {},
      parallel9PersistedCommitNotCompletedBeforeDoneCount:
        parallel9?.persistedCommitNotCompletedBeforeDoneCount ?? 0,
      streamBusyQueueWaitTimeoutCount:
        Number(terminalReasonCountsCanonical.stream_busy_queue_wait_timeout ?? 0),
      streamBusyQueueFullCount:
        Number(terminalReasonCountsCanonical.stream_busy_queue_full ?? 0),
      streamBusyServerOverloadCount:
        Number(terminalReasonCountsCanonical.stream_busy_server_overload ?? 0),
      bulkDoneP95Ms: bulkGate?.metrics?.doneLatencyMs?.p95 ?? null,
      bulkNotFoundRev1P95Ms: bulkGate?.metrics?.notFoundRev1LatencyMs?.p95 ?? null,
      stage0StartCountP95:
        parallel9?.latencyStats?.stage0StartCount?.p95 ??
        bulkGate?.metrics?.stage0StartCountStats?.p95 ??
        null,
      stage0ReplaceCountP95:
        parallel9?.latencyStats?.stage0ReplaceCount?.p95 ??
        bulkGate?.metrics?.stage0ReplaceCountStats?.p95 ??
        null,
    },
    barcodeFocus: {
      barcode: FOCUS_BARCODE,
      summary: barcodeFocusSummary,
      rows: barcodeFocusRows,
    },
    focusRows,
    mobileSoakSummary,
    mobileRichnessGate: {
      enforceHardFail: MOBILE_RICHNESS_ENFORCE_HARD_FAIL,
      releaseStrictEnforce: MOBILE_RELEASE_STRICT_ENFORCE,
      thresholds: {
        regulatoryRichRateMin: MOBILE_REGULATORY_RICH_RATE_MIN,
        scoreVisibleRateMin: MOBILE_SCORE_VISIBLE_RATE_MIN,
        scoreVisibleRateStrictMin: MOBILE_SCORE_VISIBLE_RATE_STRICT_MIN,
        esterCoreRateAllMin: MOBILE_ESTER_CORE_RATE_ALL_MIN,
        esterCoreRateFixableMin: MOBILE_ESTER_CORE_RATE_FIXABLE_MIN,
        esterCoreRateLnhpdMin: MOBILE_ESTER_CORE_RATE_LNHPD_MIN,
        esterCoreRateDsldMin: MOBILE_ESTER_CORE_RATE_DSLD_MIN,
        esterUlReadyEligibleMin: MOBILE_ESTER_UL_READY_ELIGIBLE_MIN,
        esterUlComparableEligibleWarnMin: MOBILE_ESTER_UL_COMPARABLE_ELIGIBLE_WARN_MIN,
        scoreNotFoundTargetedMax: MOBILE_NOT_FOUND_TARGETED_MAX,
        killerClientTimeoutRateMax: MOBILE_KILLER_CLIENT_TIMEOUT_RATE_MAX,
        killerInfraUnavailableWarnRate: MOBILE_KILLER_INFRA_UNAVAILABLE_WARN_RATE,
      },
      observed: mobileSoakSummary?.stats
        ? {
          regulatoryRichRate: mobileSoakSummary.stats.regulatoryRichRate ?? null,
          regulatoryRichRate_attemptWeighted: mobileSoakSummary.stats.regulatoryRichRate_attemptWeighted ?? null,
          regulatoryRichRate_uniqueBarcode: mobileSoakSummary.stats.regulatoryRichRate_uniqueBarcode ?? null,
          scoreVisibleRate: mobileSoakSummary.stats.scoreVisibleRate ?? null,
          ulEntriesCoverageVerified: mobileSoakSummary.stats.ulEntriesCoverageVerified ?? null,
          ulReferenceCoverageVerified: mobileSoakSummary.stats.ulReferenceCoverageVerified ?? null,
          ulComparableCoverageVerified: mobileSoakSummary.stats.ulComparableCoverageVerified ?? null,
          ulEligibleRateVerified: mobileSoakSummary.stats.ulEligibleRateVerified ?? null,
          esterCoreRate_all: mobileSoakSummary.stats.esterCoreRate_all ?? null,
          esterCoreRate_fixable: mobileSoakSummary.stats.esterCoreRate_fixable ?? null,
          esterCoreRateByRole: mobileSoakSummary.stats.esterCoreRateByRole ?? null,
          esterUlReferenceReadyRate_eligible: mobileSoakSummary.stats.esterUlReferenceReadyRate_eligible ?? null,
          esterUlComparableReadyRate_eligible: mobileSoakSummary.stats.esterUlComparableReadyRate_eligible ?? null,
          esterUlReadyRate_eligible: mobileSoakSummary.stats.esterUlReadyRate_eligible ?? null,
          dataCeilingRateByRole: mobileSoakSummary.stats.dataCeilingRateByRole ?? null,
          scoreNotFoundTargetedCount: mobileSoakSummary.stats.scoreNotFoundTargetedCount ?? null,
          scoreNotFoundTargetedByReason: mobileSoakSummary.stats.scoreNotFoundTargetedByReason ?? null,
          timeoutClassCounts: mobileSoakSummary.stats.timeoutClassCounts ?? null,
          killerTimeoutClassCounts: mobileSoakSummary.stats.killerTimeoutClassCounts ?? null,
          killerConfiguredAttempts: mobileSoakSummary.stats.killerConfiguredAttempts ?? null,
          killerInfraUnavailableCount: mobileSoakSummary.stats.killerInfraUnavailableCount ?? null,
          killerInfraUnavailableRate: mobileSoakSummary.stats.killerInfraUnavailableRate ?? null,
          killerProductAttempts: mobileSoakSummary.stats.killerProductAttempts ?? null,
          killerInconclusive: mobileSoakSummary.stats.killerInconclusive ?? null,
          killerProductClientTimeoutRate: mobileSoakSummary.stats.killerProductClientTimeoutRate ?? null,
          killerProductTimeoutClassCounts: mobileSoakSummary.stats.killerProductTimeoutClassCounts ?? null,
          ceilingSuite: mobileSoakSummary.stats.ceilingSuite ?? null,
        }
        : null,
    },
    repairQueue: repairQueuePayload,
    reports: {
      enrichReportPath: path.join(ENRICH_OUT_DIR, "report.json"),
      bulkSummaryPath: path.join(BULK_OUT_DIR, "summary.json"),
      bulkGatePath: path.join(BULK_OUT_DIR, "gate.json"),
      ulVisibilityReportPath: path.join(UL_OUT_DIR, "ods_ul_visibility_report.json"),
      ulCoverageGatePath: path.join(UL_OUT_DIR, "gate.json"),
      writePolicyShadowReportPath: WRITE_POLICY_SHADOW_REPORT_PATH,
      candidatesQualityReportPath: CANDIDATES_QUALITY_REPORT_PATH,
      negativeCacheResidualReportPath: NEGATIVE_CACHE_RESIDUAL_REPORT_PATH,
      surfaceConsistencyReportPath: SURFACE_CONSISTENCY_REPORT_PATH,
      mobileSoakSummaryPath,
      expectedAuthoritativeResolvedPath: EXPECTED_AUTH_RESOLVED_PATH,
      repairQueuePath: REPAIR_QUEUE_JSON_PATH,
      repairQueueMarkdownPath: REPAIR_QUEUE_MD_PATH,
      enrich: enrichReport,
      bulkSummary,
      bulkGate,
      ulVisibilityReport,
      ulCoverageGate,
      writePolicyShadowReport,
      candidatesQualityReport,
      negativeCacheResidualReport,
      surfaceConsistencyReport,
      mobileSoakSummary,
      expectedAuthoritativeResolved,
      reportFreshness,
    },
    reportFreshness,
    ulCoverage: ulCoverageGate,
    verdict: {
      pass: !infraTrust.infraUntrusted && finalReasons.length === 0,
      classification: verdictClassification,
      reasons: finalReasons,
      warnings: finalWarnings,
      infraReasons: [...new Set([...infraReasonsRaw, ...infraTriggeredReasons])],
      productReasons: [...new Set(productReasonsRaw)],
      suppressedProductReasons,
    },
  };

  await fs.writeFile(REPORT_JSON_PATH, JSON.stringify(fullReport, null, 2), "utf8");
  await fs.writeFile(REPORT_MD_PATH, toMarkdown(fullReport), "utf8");

  if (backendChild) {
    await stopManagedBackend(backendChild);
  }

  console.log(`[stable-gates] wrote ${REPORT_JSON_PATH}`);
  console.log(`[stable-gates] wrote ${REPORT_MD_PATH}`);
  if (!fullReport.verdict.pass) {
    console.error(`[stable-gates] failed: ${fullReport.verdict.reasons.join(", ")}`);
    process.exit(1);
  }
};

main().catch(async (error) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error("[stable-gates] failed", message);
  process.exit(1);
});
