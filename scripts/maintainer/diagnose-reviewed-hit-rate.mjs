#!/usr/bin/env node
/* eslint-disable no-console */

import fs from "node:fs";
import path from "node:path";

import dotenv from "dotenv";

const ROOT_DIR = process.cwd();
dotenv.config({ path: path.join(ROOT_DIR, "backend", ".env") });
dotenv.config({ path: path.join(ROOT_DIR, ".env") });

const DEFAULT_BARCODES = ["064642079992", "033674121979", "860013460136", "026664275110", "00690290532093"];
const NOT_FOUND_PROBE_BARCODES = ["00000000000000", "99999999999999"];
const API_BASE_URL = process.env.API_BASE_URL || process.env.RENDER_BASE_URL || "http://127.0.0.1:3001";
const REGRESSION_TOKEN = process.env.RENDER_REGRESSION_TOKEN || process.env.REGRESSION_AUTH_TOKEN || "";

const SSE_TIMEOUT_MS = Number(process.env.REVIEWED_HIT_SSE_TIMEOUT_MS || 25000);
const SCORE_TIMEOUT_MS = Number(process.env.REVIEWED_HIT_SCORE_TIMEOUT_MS || 20000);
const KB_TIMEOUT_MS = Number(process.env.REVIEWED_HIT_KB_TIMEOUT_MS || 15000);
const HEALTH_TIMEOUT_MS = Number(process.env.REVIEWED_HIT_HEALTH_TIMEOUT_MS || 5000);
const PHASE2_ALIAS_TRIGGER_THRESHOLD = Number(process.env.REVIEWED_HIT_ALIAS_TRIGGER_THRESHOLD || 0.75);

const nowTag = new Date().toISOString().replace(/[:.]/g, "-");

const args = process.argv.slice(2);
let outDirArg = "";
let barcodesFile = "";
let showHelp = false;
const explicitIdentities = [];
const positionalBarcodes = [];
for (let i = 0; i < args.length; i += 1) {
  const arg = args[i];
  if (arg === "--help" || arg === "-h") {
    showHelp = true;
    continue;
  }
  if (arg === "--out-dir") {
    outDirArg = String(args[i + 1] || "");
    i += 1;
    continue;
  }
  if (arg === "--barcodes-file") {
    barcodesFile = String(args[i + 1] || "");
    i += 1;
    continue;
  }
  if (arg === "--identity") {
    const value = String(args[i + 1] || "");
    const [source, id] = value.split(":");
    if (source && id) explicitIdentities.push({ source: source.trim(), id: id.trim() });
    i += 1;
    continue;
  }
  positionalBarcodes.push(arg);
}

if (showHelp) {
  // eslint-disable-next-line no-console
  console.log(`Usage:
  node scripts/maintainer/diagnose-reviewed-hit-rate.mjs [barcodes...]
  node scripts/maintainer/diagnose-reviewed-hit-rate.mjs --barcodes-file <path>
  node scripts/maintainer/diagnose-reviewed-hit-rate.mjs --identity lnhpd:80129863 --identity dsld:307265

Options:
  --out-dir <path>         Write report.json to custom directory
  --barcodes-file <path>   JSON array or newline-delimited barcode list
  --identity <source:id>   Add explicit score probe without SSE
  --help, -h               Show this help

Env:
  API_BASE_URL / RENDER_BASE_URL
  REVIEWED_HIT_*_TIMEOUT_MS
  REVIEWED_HIT_ALIAS_TRIGGER_THRESHOLD (default 0.75)
`);
  process.exit(0);
}

const defaultOutDir = path.join(ROOT_DIR, "output", "reviewed_hit_diagnostics", nowTag);
const outDir = outDirArg ? (path.isAbsolute(outDirArg) ? outDirArg : path.join(ROOT_DIR, outDirArg)) : defaultOutDir;

const baseHeaders = {
  "Content-Type": "application/json",
  Accept: "application/json",
};
if (REGRESSION_TOKEN) {
  baseHeaders["x-regression-token"] = REGRESSION_TOKEN;
} else {
  baseHeaders["x-auth-disabled"] = "1";
}

const sseHeaders = {
  ...baseHeaders,
  Accept: "text/event-stream",
};

const isAbortLike = (error) => {
  if (!error) return false;
  const name = typeof error?.name === "string" ? error.name : "";
  const message = typeof error?.message === "string" ? error.message : String(error);
  return name === "AbortError" || /\btimeout\b|\babort(ed|ing)?\b/i.test(message);
};

const toGtin14 = (value) => {
  const d = String(value || "").replace(/\D/g, "");
  if (d.length === 14) return d;
  if (d.length === 13) return `0${d}`;
  if (d.length === 12) return `00${d}`;
  return d || null;
};

const ensureDir = async (p) => {
  await fs.promises.mkdir(p, { recursive: true });
};

const mean = (values) => {
  if (!values.length) return null;
  return Number((values.reduce((a, b) => a + b, 0) / values.length).toFixed(1));
};

const pct = (num, den) => (den > 0 ? Number((num / den).toFixed(3)) : null);
const percentile = (values, q) => {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const idx = Math.max(0, Math.min(sorted.length - 1, Math.ceil((q / 100) * sorted.length) - 1));
  return Number(sorted[idx].toFixed(1));
};

const pickString = (...values) => {
  for (const value of values) {
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return null;
};

const pickNumber = (...values) => {
  for (const value of values) {
    if (typeof value === "number" && Number.isFinite(value)) return value;
    if (typeof value === "string" && value.trim().length > 0) {
      const parsed = Number(value);
      if (Number.isFinite(parsed)) return parsed;
    }
  }
  return null;
};

const normalizeSignalRow = (row) => {
  if (!row || typeof row !== "object") return null;
  const ingredientId = pickString(
    row.ingredientId,
    row.ingredient_id,
    row?.ingredient?.id,
  );
  const ingredientName = pickString(
    row.ingredientName,
    row.ingredient_name,
    row.name,
    row?.ingredient?.name,
    row.displayName,
  );
  const ingredientCanonicalKey = pickString(
    row.ingredientCanonicalKey,
    row.ingredient_canonical_key,
    row.ingredientKey,
    row.canonicalKey,
  );
  const formKey = pickString(
    row.formKey,
    row.form_key,
    row?.form?.key,
    row?.resolvedFormKey,
    row?.formSignal?.formKey,
  );
  if (!formKey) return null;
  return { ingredientId, ingredientName, ingredientCanonicalKey, formKey };
};

const buildKbBatchItem = (signal, opts = { includeName: true }) => {
  const item = {
    formKey: signal?.formKey,
  };
  const ingredientId = pickString(signal?.ingredientId);
  const ingredientCanonicalKey = pickString(signal?.ingredientCanonicalKey);
  const ingredientName = opts?.includeName ? pickString(signal?.ingredientName) : null;
  if (ingredientId) item.ingredientId = ingredientId;
  if (ingredientCanonicalKey) item.ingredientCanonicalKey = ingredientCanonicalKey;
  if (ingredientName) item.ingredientName = ingredientName;
  return item;
};

const extractFormSignals = (payload) => {
  const candidates = [
    payload?.bundle?.explain?.evidence?.formSignals,
    payload?.bundle?.explain?.formSignals,
    payload?.explain?.formSignals,
    payload?.explain?.evidence?.formSignals,
    payload?.data?.explain?.formSignals,
    payload?.score?.explain?.formSignals,
  ];
  const rows = candidates.find((c) => Array.isArray(c)) || [];
  return rows.map(normalizeSignalRow).filter(Boolean);
};

const extractScoreCoverage = (payload, signalCount) => {
  const explains = [
    payload?.bundle?.explain,
    payload?.explain,
    payload?.data?.explain,
    payload?.score?.explain,
  ];
  const explain = explains.find((it) => it && typeof it === "object") || null;
  if (!explain) {
    return {
      matchRatio: null,
      activeCount: null,
      matchedIngredientCount: null,
      matchedIngredientCountDerived: false,
    };
  }
  const activeCount = pickNumber(
    explain?.coverage?.activeCount,
    explain?.activeCount,
  );
  const matchRatioRaw = pickNumber(
    explain?.matchRatio,
    explain?.coverage?.matchRatio,
  );
  const matchRatio =
    matchRatioRaw == null ? null : Number(Math.max(0, Math.min(1, matchRatioRaw)).toFixed(3));
  const explicitMatched = pickNumber(
    explain?.coverage?.matchedIngredientCount,
    explain?.coverage?.matchCount,
    explain?.matchedIngredientCount,
    explain?.matchCount,
  );
  let matchedIngredientCount = explicitMatched;
  let matchedIngredientCountDerived = false;
  if (matchedIngredientCount == null && activeCount != null && matchRatio != null) {
    matchedIngredientCount = Math.round(activeCount * matchRatio);
    matchedIngredientCountDerived = true;
  }
  if (matchedIngredientCount == null && signalCount > 0) {
    matchedIngredientCount = signalCount;
  }
  return {
    matchRatio,
    activeCount,
    matchedIngredientCount,
    matchedIngredientCountDerived,
  };
};

const extractScoreExplain = (payload) => {
  const explains = [
    payload?.bundle?.explain,
    payload?.explain,
    payload?.data?.explain,
    payload?.score?.explain,
  ];
  const explain = explains.find((item) => item && typeof item === "object");
  return explain && typeof explain === "object" ? explain : null;
};

const normalizeMatchDiagnosticRow = (row) => {
  if (!row || typeof row !== "object") return null;
  const ingredientId = pickString(row.ingredientId, row.ingredient_id);
  const ingredientCanonicalKey = pickString(row.ingredientCanonicalKey, row.ingredient_canonical_key);
  const ingredientName = pickString(row.ingredientName, row.ingredient_name, row.name);
  if (!ingredientId && !ingredientCanonicalKey && !ingredientName) return null;
  return {
    ingredientId,
    ingredientCanonicalKey,
    ingredientName,
    mismatchReason: pickString(row.mismatchReason, row.mismatch_reason),
    mappingConsistencyReason: pickString(row.mappingConsistencyReason, row.mapping_consistency_reason),
    expectedFormKey: pickString(row.expectedFormKey, row.expected_form_key),
    candidateTexts: Array.isArray(row.candidateTexts)
      ? row.candidateTexts
          .map((value) => (typeof value === "string" ? value.trim() : ""))
          .filter(Boolean)
      : [],
    availableFormKeys: Array.isArray(row.availableFormKeys)
      ? row.availableFormKeys
          .map((value) => (typeof value === "string" ? value.trim() : ""))
          .filter(Boolean)
      : [],
  };
};

const extractFormMatchingDiagnostics = (payload) => {
  const explain = extractScoreExplain(payload);
  const matching = explain?.evidence?.formMatching;
  if (!matching || typeof matching !== "object") return null;
  const rowsWithoutFormRows = Array.isArray(matching.rowsWithoutFormRows)
    ? matching.rowsWithoutFormRows.map(normalizeMatchDiagnosticRow).filter(Boolean)
    : [];
  const rowsWithFormsNoMatch = Array.isArray(matching.rowsWithFormsNoMatch)
    ? matching.rowsWithFormsNoMatch.map(normalizeMatchDiagnosticRow).filter(Boolean)
    : [];
  const rowsMappingMismatch = Array.isArray(matching.rowsMappingMismatch)
    ? matching.rowsMappingMismatch.map(normalizeMatchDiagnosticRow).filter(Boolean)
    : [];
  return {
    zeroSignalReason: pickString(matching.zeroSignalReason, matching.zero_signal_reason),
    ingredientRowsWithIds: pickNumber(matching.ingredientRowsWithIds, matching.ingredient_rows_with_ids),
    ingredientRowsWithForms: pickNumber(matching.ingredientRowsWithForms, matching.ingredient_rows_with_forms),
    ingredientRowsWithoutFormRows: pickNumber(
      matching.ingredientRowsWithoutFormRows,
      matching.ingredient_rows_without_form_rows,
    ),
    ingredientRowsWithFormsNoMatch: pickNumber(
      matching.ingredientRowsWithFormsNoMatch,
      matching.ingredient_rows_with_forms_no_match,
    ),
    ingredientRowsMappingMismatch: pickNumber(
      matching.ingredientRowsMappingMismatch,
      matching.ingredient_rows_mapping_mismatch,
    ),
    rowsWithoutFormRows,
    rowsWithFormsNoMatch,
    rowsMappingMismatch,
    rowsWithoutFormRowsTruncated: pickNumber(
      matching.rowsWithoutFormRowsTruncated,
      matching.rows_without_form_rows_truncated,
    ),
    rowsWithFormsNoMatchTruncated: pickNumber(
      matching.rowsWithFormsNoMatchTruncated,
      matching.rows_with_forms_no_match_truncated,
    ),
    rowsMappingMismatchTruncated: pickNumber(
      matching.rowsMappingMismatchTruncated,
      matching.rows_mapping_mismatch_truncated,
    ),
  };
};

const extractScoreProvenance = (payload) => {
  const candidates = [
    payload?.bundle?.provenance,
    payload?.provenance,
    payload?.data?.provenance,
    payload?.score?.provenance,
  ];
  const provenance = candidates.find((item) => item && typeof item === "object");
  if (!provenance || typeof provenance !== "object") return null;
  return {
    source: pickString(provenance.source),
    sourceId: pickString(provenance.sourceId, provenance.source_id),
    canonicalSourceId: pickString(provenance.canonicalSourceId, provenance.canonical_source_id),
  };
};

const resolveMappingPath = (identity, provenance) => {
  const identityValue = pickString(identity?.identityValue);
  const sourceType = pickString(identity?.source);
  const sourceId = pickString(provenance?.sourceId);
  const canonicalSourceId = pickString(provenance?.canonicalSourceId);
  const prefix = sourceType ? `${sourceType}:` : "";

  if (identityValue && sourceId && identityValue === sourceId) {
    return { type: "source_id", label: `${prefix}source_id`, identityValue, sourceId, canonicalSourceId };
  }
  if (identityValue && canonicalSourceId && identityValue === canonicalSourceId) {
    return {
      type: "canonical_source_id",
      label: `${prefix}canonical_source_id`,
      identityValue,
      sourceId,
      canonicalSourceId,
    };
  }
  if (sourceId || canonicalSourceId) {
    return {
      type: "runtime_or_alias",
      label: `${prefix}runtime_or_alias`,
      identityValue,
      sourceId,
      canonicalSourceId,
    };
  }
  return {
    type: "unknown",
    label: `${prefix}unknown`,
    identityValue,
    sourceId,
    canonicalSourceId,
  };
};

const collectMatchedIngredients = (signals, diagnostics) => {
  const byKey = new Map();
  signals.forEach((signal) => {
    const ingredientId = pickString(signal?.ingredientId);
    const ingredientCanonicalKey = pickString(signal?.ingredientCanonicalKey);
    const ingredientName = pickString(signal?.ingredientName);
    const key = ingredientId || ingredientCanonicalKey || ingredientName;
    if (!key) return;
    byKey.set(key, {
      ingredientId,
      ingredientCanonicalKey,
      ingredientName,
      source: "form_signals",
    });
  });

  const appendDiagnostics = (rows, source) => {
    rows.forEach((row) => {
      const ingredientId = pickString(row?.ingredientId);
      const ingredientCanonicalKey = pickString(row?.ingredientCanonicalKey);
      const ingredientName = pickString(row?.ingredientName);
      const key = ingredientId || ingredientCanonicalKey || ingredientName;
      if (!key || byKey.has(key)) return;
      byKey.set(key, {
        ingredientId,
        ingredientCanonicalKey,
        ingredientName,
        source,
      });
    });
  };

  appendDiagnostics(diagnostics?.rowsWithoutFormRows ?? [], "no_form_rows_diagnostics");
  appendDiagnostics(diagnostics?.rowsWithFormsNoMatch ?? [], "no_match_diagnostics");
  appendDiagnostics(diagnostics?.rowsMappingMismatch ?? [], "mapping_mismatch_diagnostics");
  return Array.from(byKey.values());
};

const normalizeTokenText = (value) =>
  String(value ?? "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();

const evaluateMappingCandidate = (candidate) => {
  const ingredientName = pickString(candidate?.ingredientName);
  const canonicalKey = pickString(candidate?.ingredientCanonicalKey);
  const normalizedName = normalizeTokenText(ingredientName);
  if (!canonicalKey) {
    return {
      nameRawNormalized: normalizedName || null,
      matchedCanonicalKey: null,
      consistencyStatus: "unknown",
      consistencyReason: "missing_canonical_key",
    };
  }
  if (!normalizedName) {
    return {
      nameRawNormalized: null,
      matchedCanonicalKey: canonicalKey,
      consistencyStatus: "unknown",
      consistencyReason: "missing_ingredient_name",
    };
  }
  const normalizedCanonical = normalizeTokenText(canonicalKey.replace(/[_-]+/g, " "));
  if (!normalizedCanonical) {
    return {
      nameRawNormalized: normalizedName,
      matchedCanonicalKey: canonicalKey,
      consistencyStatus: "unknown",
      consistencyReason: "empty_canonical_key",
    };
  }
  const canonicalTokens = normalizedCanonical.split(/\s+/).filter(Boolean);
  const nameTokens = new Set(normalizedName.split(/\s+/).filter(Boolean));
  const overlap = canonicalTokens.reduce((sum, token) => sum + (nameTokens.has(token) ? 1 : 0), 0);
  const overlapRatio = canonicalTokens.length ? overlap / canonicalTokens.length : 0;
  if (
    normalizedName.includes(normalizedCanonical)
    || normalizedCanonical.includes(normalizedName)
    || overlapRatio >= 0.5
  ) {
    return {
      nameRawNormalized: normalizedName,
      matchedCanonicalKey: canonicalKey,
      consistencyStatus: "ok",
      consistencyReason: overlapRatio >= 0.5 ? "token_overlap" : "canonical_in_name",
    };
  }
  return {
    nameRawNormalized: normalizedName,
    matchedCanonicalKey: canonicalKey,
    consistencyStatus: "mismatch",
    consistencyReason: "name_canonical_mismatch",
  };
};

const assessMappingQuality = (matchedIngredients) => {
  if (!Array.isArray(matchedIngredients) || matchedIngredients.length === 0) {
    return {
      nameRawNormalized: null,
      matchedCanonicalKey: null,
      consistencyStatus: "unknown",
      consistencyReason: "no_matched_ingredient_context",
    };
  }
  const evaluated = matchedIngredients.map((candidate) => evaluateMappingCandidate(candidate));
  const firstOk = evaluated.find((item) => item.consistencyStatus === "ok");
  if (firstOk) return firstOk;
  const firstMismatch = evaluated.find((item) => item.consistencyStatus === "mismatch");
  if (firstMismatch) return firstMismatch;
  return evaluated[0];
};

const classifySignalZeroCause = (signalCount, coverage, diagnostics) => {
  if (signalCount > 0) return null;
  const diagnosticReason = pickString(diagnostics?.zeroSignalReason);
  if (
    diagnosticReason === "NO_INGREDIENT_MATCH"
    || diagnosticReason === "NO_FORM_ROWS"
    || diagnosticReason === "FORM_ROWS_PRESENT_BUT_NO_MATCH"
    || diagnosticReason === "UNKNOWN"
  ) {
    return diagnosticReason;
  }
  const ratio = pickNumber(coverage?.matchRatio);
  if (ratio == null) return "UNKNOWN";
  if (ratio === 0) return "NO_INGREDIENT_MATCH";
  if (ratio > 0) return "NO_FORM_ROWS";
  return "UNKNOWN";
};

const classifyIdentityIssue = ({
  scoreOk,
  scoreTimedOut,
  scoreResponseStatus,
  signalCount,
  signalZeroCause,
  coverage,
  matchedIngredients,
}) => {
  const responseStatus = pickString(scoreResponseStatus);
  if (responseStatus === "not_found") return "identity_not_found";
  if (!scoreOk) return scoreTimedOut ? "score_timeout" : "score_error";
  if ((signalCount ?? 0) > 0) return null;

  const zeroCause = pickString(signalZeroCause);
  if (zeroCause && zeroCause !== "UNKNOWN") return null;

  const matchRatio = pickNumber(coverage?.matchRatio);
  const hasMatchedIngredients = Array.isArray(matchedIngredients) && matchedIngredients.length > 0;
  if (matchRatio == null && !hasMatchedIngredients) return "identity_unmapped_or_missing";
  return null;
};

const classifyWithoutNameCause = (signal, responseItem) => {
  const ingredientId = pickString(signal?.ingredientId);
  const ingredientCanonicalKey = pickString(signal?.ingredientCanonicalKey);
  const ingredientName = pickString(signal?.ingredientName);
  const reason = pickString(responseItem?.reason);

  if (!ingredientCanonicalKey && ingredientId && /^[0-9a-f-]{36}$/i.test(ingredientId)) {
    return "uuid_only";
  }
  if (!ingredientCanonicalKey && !ingredientName) {
    return "name_missing";
  }
  if (ingredientCanonicalKey && reason === "ingredient_not_supported") {
    return "reviewed_missing";
  }
  if (ingredientCanonicalKey && reason === "no_entry_for_form_key") {
    return "mapping_missing";
  }
  return "mapping_missing";
};

const parseIdentity = (bundle) => {
  const meta = bundle?.meta || {};
  const sourceType = typeof meta.sourceType === "string" ? meta.sourceType : null;
  const identityType = typeof meta?.authoritativeIdentity?.type === "string" ? meta.authoritativeIdentity.type : null;
  const identityValue = typeof meta?.authoritativeIdentity?.value === "string" ? meta.authoritativeIdentity.value : null;
  if (!sourceType || !identityType || !identityValue) return null;
  if (sourceType === "lnhpd") return { sourceType, identityType, identityValue, scoreSource: "lnhpd" };
  if (sourceType === "dsld") return { sourceType, identityType, identityValue, scoreSource: "dsld" };
  return null;
};

const fetchJsonWithTimeout = async (url, options, timeoutMs) => {
  const ctrl = new AbortController();
  const timeout = setTimeout(() => ctrl.abort(new Error("timeout")), timeoutMs);
  const startedAt = Date.now();
  try {
    const res = await fetch(url, { ...options, signal: ctrl.signal });
    const text = await res.text();
    let data = null;
    try {
      data = text ? JSON.parse(text) : null;
    } catch {
      data = { parseError: true, rawPreview: text.slice(0, 200) };
    }
    return {
      ok: res.ok,
      status: res.status,
      data,
      latencyMs: Date.now() - startedAt,
    };
  } finally {
    clearTimeout(timeout);
  }
};

const fetchSseBarcode = async (barcode) => {
  const ctrl = new AbortController();
  const timeout = setTimeout(() => ctrl.abort(new Error("timeout")), SSE_TIMEOUT_MS);
  const startedAt = Date.now();
  const events = [];
  let error = null;
  let timedOut = false;
  try {
    const res = await fetch(`${API_BASE_URL}/api/enrich-stream`, {
      method: "POST",
      headers: sseHeaders,
      body: JSON.stringify({ barcode }),
      signal: ctrl.signal,
    });
    if (!res.ok) {
      error = `HTTP_${res.status}`;
      return { barcode, events, error, timedOut, latencyMs: Date.now() - startedAt };
    }
    const reader = res.body?.getReader();
    if (!reader) {
      error = "NO_READER";
      return { barcode, events, error, timedOut, latencyMs: Date.now() - startedAt };
    }

    const decoder = new TextDecoder();
    let buffer = "";
    let currentEvent = null;
    let currentData = "";
    const pushEvent = () => {
      if (!currentEvent) return;
      const data = currentData.trim();
      if (!data) {
        currentEvent = null;
        currentData = "";
        return;
      }
      let parsed = data;
      try {
        parsed = JSON.parse(data);
      } catch {
        // keep raw string
      }
      events.push({ event: currentEvent, data: parsed, atMs: Date.now() - startedAt });
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
          pushEvent();
          continue;
        }
        if (line.startsWith("event:")) currentEvent = line.replace("event:", "").trim();
        else if (line.startsWith("data:")) currentData += line.replace("data:", "").trim();
      }
    }
    pushEvent();
  } catch (e) {
    timedOut = isAbortLike(e);
    error = e instanceof Error ? e.message : String(e);
  } finally {
    clearTimeout(timeout);
  }

  return { barcode, events, error, timedOut, latencyMs: Date.now() - startedAt };
};

const findEventAt = (events, predicate) => {
  const hit = events.find(predicate);
  return typeof hit?.atMs === "number" ? hit.atMs : null;
};

const extractSseLifecycle = (events) => ({
  tConnectMs: 0,
  tRev0Ms: findEventAt(events, (e) => e.event === "analysis_bundle" && Number(e?.data?.meta?.revision) === 0),
  tRev1OrLimitedMs: findEventAt(events, (e) => e.event === "analysis_bundle" && Number(e?.data?.meta?.revision) >= 1),
  tFinalizeMs: findEventAt(events, (e) => e.event === "done" || e.event === "error"),
});

const pickRev1Bundle = (events) => {
  const bundles = events
    .filter((e) => e.event === "analysis_bundle" && e.data && typeof e.data === "object")
    .map((e) => e.data);
  if (!bundles.length) return null;
  return [...bundles].reverse().find((bundle) => Number(bundle?.meta?.revision) >= 1) ?? bundles[bundles.length - 1];
};

const pickErrorEvent = (events) =>
  [...events].reverse().find((e) => e.event === "error" && e.data && typeof e.data === "object") ?? null;

const fetchApiHealth = async () => {
  const probes = [
    {
      name: "nutri_tips",
      url: `${API_BASE_URL}/api/nutri-tips`,
      options: { method: "GET", headers: baseHeaders },
    },
    {
      name: "barcode_metadata",
      url: `${API_BASE_URL}/api/barcode-metadata?barcode=064642079992`,
      options: { method: "GET", headers: baseHeaders },
    },
  ];
  const rows = [];
  for (const probe of probes) {
    // eslint-disable-next-line no-await-in-loop
    const result = await fetchJsonWithTimeout(probe.url, probe.options, HEALTH_TIMEOUT_MS).catch((error) => ({
      ok: false,
      status: 0,
      latencyMs: null,
      timedOut: isAbortLike(error),
      error: error instanceof Error ? error.message : String(error),
    }));
    rows.push({
      name: probe.name,
      ok: Boolean(result?.ok),
      status: result?.status ?? null,
      latencyMs: result?.latencyMs ?? null,
      timedOut: Boolean(result?.timedOut),
      error: result?.error ?? null,
    });
    if (result?.ok) {
      return {
        healthy: true,
        via: probe.name,
        checks: rows,
      };
    }
  }
  return {
    healthy: false,
    via: null,
    checks: rows,
  };
};

const runNotFoundProbes = async (health) => {
  if (!health?.healthy) {
    return {
      enabled: false,
      skippedReason: "health_unreachable",
      health,
      rows: [],
      summary: {
        total: 0,
        hasRev1Count: 0,
        deadEndCount: 0,
      },
    };
  }

  const rows = [];
  for (const barcode of NOT_FOUND_PROBE_BARCODES) {
    // eslint-disable-next-line no-await-in-loop
    const sse = await fetchSseBarcode(barcode);
    const rev1 = pickRev1Bundle(sse.events);
    const errorEvent = pickErrorEvent(sse.events);
    const reasonCode = pickString(
      errorEvent?.data?.reasonCode,
      errorEvent?.data?.code,
    );
    const hasRev1 = Boolean(rev1 && Number(rev1?.meta?.revision) >= 1);
    rows.push({
      barcode,
      sse: {
        eventCount: sse.events.length,
        timedOut: sse.timedOut,
        latencyMs: sse.latencyMs,
        error: sse.error,
      },
      hasRev1,
      rev1SourceType: pickString(rev1?.meta?.sourceType),
      errorReasonCode: reasonCode,
      expectedUiRoute: hasRev1 ? "dashboard" : "not_found",
    });
  }

  const deadEndCount = rows.filter((row) => !row.hasRev1 && !row.sse.timedOut).length;
  return {
    enabled: true,
    skippedReason: null,
    health,
    rows,
    summary: {
      total: rows.length,
      hasRev1Count: rows.filter((row) => row.hasRev1).length,
      deadEndCount,
      deadEndRate: pct(deadEndCount, rows.length),
    },
  };
};

const callKbBatch = async (items) => {
  const result = await fetchJsonWithTimeout(
    `${API_BASE_URL}/api/kb/runtime/form-insights/batch`,
    {
      method: "POST",
      headers: baseHeaders,
      body: JSON.stringify({ items }),
    },
    KB_TIMEOUT_MS,
  );
  const responseItems = Array.isArray(result?.data?.items) ? result.data.items : [];
  const reviewedHits = responseItems.filter((it) => {
    if (it?.status !== "ok") return false;
    const source = pickString(
      it?.meta?.source,
      it?.item?.meta?.source,
      it?.source,
      it?.item?.source,
    );
    return source === "reviewed_package";
  }).length;
  const okHits = responseItems.filter((it) => it?.status === "ok").length;
  const missReasons = {};
  for (const it of responseItems) {
    if (it?.status === "ok") continue;
    const reason = pickString(it?.reason, it?.item?.reason, "unknown_reason");
    missReasons[reason] = (missReasons[reason] || 0) + 1;
  }
  return {
    ...result,
    signalCount: items.length,
    reviewedHits,
    okHits,
    responseItems,
    missReasons,
  };
};

const loadBarcodesFromFile = (filePath) => {
  const raw = fs.readFileSync(filePath, "utf8");
  try {
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed)) return parsed.map((x) => String(x));
  } catch {
    // fallback to line-separated
  }
  return raw
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
};

const pickBarcodes = () => {
  if (barcodesFile) {
    const resolved = path.isAbsolute(barcodesFile) ? barcodesFile : path.join(ROOT_DIR, barcodesFile);
    return loadBarcodesFromFile(resolved);
  }
  if (positionalBarcodes.length) return positionalBarcodes;
  return DEFAULT_BARCODES;
};

const buildStageStats = () => ({
  calls: 0,
  ok: 0,
  timeout: 0,
  error: 0,
  latenciesMs: [],
});

const updateStats = (stageStats, result, isOk) => {
  stageStats.calls += 1;
  if (typeof result?.latencyMs === "number") stageStats.latenciesMs.push(result.latencyMs);
  if (isOk) stageStats.ok += 1;
  else if (result?.timedOut || isAbortLike(result?.error)) stageStats.timeout += 1;
  else stageStats.error += 1;
};

const compactStageStats = (stats) => ({
  calls: stats.calls,
  ok: stats.ok,
  timeout: stats.timeout,
  error: stats.error,
  avgLatencyMs: mean(stats.latenciesMs),
  timeoutRate: pct(stats.timeout, stats.calls),
});

const main = async () => {
  const rawBarcodes = pickBarcodes();
  const barcodes = rawBarcodes
    .map((b) => toGtin14(b) || String(b))
    .filter(Boolean);

  await ensureDir(outDir);

  const stageStats = {
    sse: buildStageStats(),
    score: buildStageStats(),
    kbWithName: buildStageStats(),
    kbWithoutName: buildStageStats(),
  };

  const rows = [];
  let totalSignals = 0;
  let reviewedHitsWithName = 0;
  let reviewedHitsWithoutName = 0;
  const withoutNameCauseCounts = {
    uuid_only: 0,
    name_missing: 0,
    mapping_missing: 0,
    reviewed_missing: 0,
  };
  const lifecycleTiming = {
    tConnectMs: [],
    tRev0Ms: [],
    tRev1OrLimitedMs: [],
    tFinalizeMs: [],
  };

const runIdentityProbe = async ({ source, id, label }) => {
    const score = await fetchJsonWithTimeout(
      `${API_BASE_URL}/api/score/v4/${source}/${encodeURIComponent(id)}`,
      { method: "GET", headers: baseHeaders },
      SCORE_TIMEOUT_MS,
    ).catch((error) => ({
      ok: false,
      status: 0,
      data: null,
      error: error instanceof Error ? error.message : String(error),
      timedOut: isAbortLike(error),
      latencyMs: null,
    }));
    updateStats(stageStats.score, score, Boolean(score?.ok));

    const signals = score?.ok ? extractFormSignals(score.data) : [];
    const coverage = score?.ok ? extractScoreCoverage(score.data, signals.length) : extractScoreCoverage(null, signals.length);
    const formMatchingDiagnostics = score?.ok ? extractFormMatchingDiagnostics(score.data) : null;
    const provenance = score?.ok ? extractScoreProvenance(score.data) : null;
    const scoreResponseStatus = pickString(score?.data?.status);
    const mappingPath = resolveMappingPath(
      {
        source,
        identityValue: id,
      },
      provenance,
    );
    const matchedIngredients = collectMatchedIngredients(signals, formMatchingDiagnostics);
    const withNameItems = signals.map((item) => buildKbBatchItem(item, { includeName: true }));
    const withoutNameItems = signals.map((item) => buildKbBatchItem(item, { includeName: false }));

    const row = {
      barcode: `probe:${source}:${id}`,
      sourceType: source,
      revision: null,
      probeLabel: label,
      identity: {
        source,
        identityType: source === "lnhpd" ? "npn" : source === "dsld" ? "dsld_label_id" : "unknown",
        identityValue: id,
      },
      identityResolution: {
        provenance,
        mappingPath,
      },
      sse: { skipped: true },
      score: {
        status: score?.status ?? null,
        responseStatus: scoreResponseStatus,
        ok: Boolean(score?.ok),
        timedOut: Boolean(score?.timedOut),
        latencyMs: score?.latencyMs ?? null,
        signalCount: signals.length,
        scoreCoverage: coverage,
        signalZeroCause: classifySignalZeroCause(signals.length, coverage, formMatchingDiagnostics),
        formMatchingDiagnostics,
        matchedIngredients,
        error: score?.error ?? null,
      },
      mappingQuality: assessMappingQuality(matchedIngredients),
      identityIssue: classifyIdentityIssue({
        scoreOk: Boolean(score?.ok),
        scoreTimedOut: Boolean(score?.timedOut),
        scoreResponseStatus,
        signalCount: signals.length,
        signalZeroCause: classifySignalZeroCause(signals.length, coverage, formMatchingDiagnostics),
        coverage,
        matchedIngredients,
      }),
      kbWithName: null,
      kbWithoutName: null,
      withoutNameCause: {},
    };

    if (!signals.length) {
      row.kbWithName = { skipped: true, reason: "no_form_signals" };
      row.kbWithoutName = { skipped: true, reason: "no_form_signals" };
      rows.push(row);
      return;
    }

    totalSignals += signals.length;

    const withName = await callKbBatch(withNameItems).catch((error) => ({
      ok: false,
      status: 0,
      timedOut: isAbortLike(error),
      latencyMs: null,
      signalCount: withNameItems.length,
      reviewedHits: 0,
      okHits: 0,
      responseItems: [],
      missReasons: { call_error: withNameItems.length },
      error: error instanceof Error ? error.message : String(error),
    }));
    updateStats(stageStats.kbWithName, withName, Boolean(withName?.ok));

    const withoutName = await callKbBatch(withoutNameItems).catch((error) => ({
      ok: false,
      status: 0,
      timedOut: isAbortLike(error),
      latencyMs: null,
      signalCount: withoutNameItems.length,
      reviewedHits: 0,
      okHits: 0,
      responseItems: [],
      missReasons: { call_error: withoutNameItems.length },
      error: error instanceof Error ? error.message : String(error),
    }));
    updateStats(stageStats.kbWithoutName, withoutName, Boolean(withoutName?.ok));

    reviewedHitsWithName += withName.reviewedHits;
    reviewedHitsWithoutName += withoutName.reviewedHits;
    const causeBySignal = {};
    withoutNameItems.forEach((signal, idx) => {
      const responseItem = withoutName.responseItems?.[idx];
      if (responseItem?.status === "ok") return;
      const cause = classifyWithoutNameCause(signal, responseItem);
      causeBySignal[cause] = (causeBySignal[cause] || 0) + 1;
      withoutNameCauseCounts[cause] += 1;
    });

    row.kbWithName = {
      status: withName.status ?? null,
      ok: Boolean(withName.ok),
      timedOut: Boolean(withName.timedOut),
      latencyMs: withName.latencyMs ?? null,
      signalCount: withName.signalCount,
      reviewedHits: withName.reviewedHits,
      hitRate: pct(withName.reviewedHits, withName.signalCount),
      okHits: withName.okHits,
      missReasons: withName.missReasons,
      error: withName.error ?? null,
    };
    row.kbWithoutName = {
      status: withoutName.status ?? null,
      ok: Boolean(withoutName.ok),
      timedOut: Boolean(withoutName.timedOut),
      latencyMs: withoutName.latencyMs ?? null,
      signalCount: withoutName.signalCount,
      reviewedHits: withoutName.reviewedHits,
      hitRate: pct(withoutName.reviewedHits, withoutName.signalCount),
      okHits: withoutName.okHits,
      missReasons: withoutName.missReasons,
      withoutNameCause: causeBySignal,
      error: withoutName.error ?? null,
    };
    row.withoutNameCause = causeBySignal;

    rows.push(row);
  };

  for (const barcode of barcodes) {
    // eslint-disable-next-line no-await-in-loop
    const sse = await fetchSseBarcode(barcode);
    updateStats(stageStats.sse, sse, !sse.error);
    const bundle = pickRev1Bundle(sse.events);
    const identity = parseIdentity(bundle);
    const row = {
      barcode,
      sourceType: bundle?.meta?.sourceType ?? null,
      revision: bundle?.meta?.revision ?? null,
      identity: identity
        ? {
            source: identity.scoreSource,
            identityType: identity.identityType,
            identityValue: identity.identityValue,
          }
        : null,
      sse: {
        eventCount: sse.events.length,
        timedOut: sse.timedOut,
        latencyMs: sse.latencyMs,
        error: sse.error,
      },
      score: null,
      mappingQuality: {
        nameRawNormalized: null,
        matchedCanonicalKey: null,
        consistencyStatus: "unknown",
        consistencyReason: "no_score_context",
      },
      kbWithName: null,
      kbWithoutName: null,
      withoutNameCause: {},
      identityIssue: null,
    };
    const lifecycle = extractSseLifecycle(sse.events);
    row.sse.lifecycle = lifecycle;
    if (typeof lifecycle.tConnectMs === "number") lifecycleTiming.tConnectMs.push(lifecycle.tConnectMs);
    if (typeof lifecycle.tRev0Ms === "number") lifecycleTiming.tRev0Ms.push(lifecycle.tRev0Ms);
    if (typeof lifecycle.tRev1OrLimitedMs === "number") lifecycleTiming.tRev1OrLimitedMs.push(lifecycle.tRev1OrLimitedMs);
    if (typeof lifecycle.tFinalizeMs === "number") lifecycleTiming.tFinalizeMs.push(lifecycle.tFinalizeMs);

    if (!identity) {
      row.score = { skipped: true, reason: "no_supported_identity" };
      row.identityIssue = "no_supported_identity";
      rows.push(row);
      continue;
    }

    // eslint-disable-next-line no-await-in-loop
    const score = await fetchJsonWithTimeout(
      `${API_BASE_URL}/api/score/v4/${identity.scoreSource}/${encodeURIComponent(identity.identityValue)}`,
      { method: "GET", headers: baseHeaders },
      SCORE_TIMEOUT_MS,
    ).catch((error) => ({
      ok: false,
      status: 0,
      data: null,
      error: error instanceof Error ? error.message : String(error),
      timedOut: isAbortLike(error),
      latencyMs: null,
    }));

    updateStats(stageStats.score, score, Boolean(score?.ok));
    const signals = score?.ok ? extractFormSignals(score.data) : [];
    const coverage = score?.ok ? extractScoreCoverage(score.data, signals.length) : extractScoreCoverage(null, signals.length);
    const formMatchingDiagnostics = score?.ok ? extractFormMatchingDiagnostics(score.data) : null;
    const provenance = score?.ok ? extractScoreProvenance(score.data) : null;
    const scoreResponseStatus = pickString(score?.data?.status);
    const mappingPath = resolveMappingPath(identity, provenance);
    const matchedIngredients = collectMatchedIngredients(signals, formMatchingDiagnostics);
    const withNameItems = signals.map((item) => buildKbBatchItem(item, { includeName: true }));
    const withoutNameItems = signals.map((item) => buildKbBatchItem(item, { includeName: false }));

    row.identityResolution = {
      provenance,
      mappingPath,
    };
    row.score = {
      status: score?.status ?? null,
      responseStatus: scoreResponseStatus,
      ok: Boolean(score?.ok),
      timedOut: Boolean(score?.timedOut),
      latencyMs: score?.latencyMs ?? null,
      signalCount: signals.length,
      scoreCoverage: coverage,
      signalZeroCause: classifySignalZeroCause(signals.length, coverage, formMatchingDiagnostics),
      formMatchingDiagnostics,
      matchedIngredients,
      error: score?.error ?? null,
    };
    row.mappingQuality = assessMappingQuality(matchedIngredients);
    row.identityIssue = classifyIdentityIssue({
      scoreOk: Boolean(score?.ok),
      scoreTimedOut: Boolean(score?.timedOut),
      scoreResponseStatus,
      signalCount: signals.length,
      signalZeroCause: row.score.signalZeroCause,
      coverage,
      matchedIngredients,
    });

    if (!signals.length) {
      row.kbWithName = { skipped: true, reason: "no_form_signals" };
      row.kbWithoutName = { skipped: true, reason: "no_form_signals" };
      rows.push(row);
      continue;
    }

    totalSignals += signals.length;

    // eslint-disable-next-line no-await-in-loop
    const withName = await callKbBatch(withNameItems).catch((error) => ({
      ok: false,
      status: 0,
      timedOut: isAbortLike(error),
      latencyMs: null,
      signalCount: withNameItems.length,
      reviewedHits: 0,
      okHits: 0,
      responseItems: [],
      missReasons: { call_error: withNameItems.length },
      error: error instanceof Error ? error.message : String(error),
    }));
    updateStats(stageStats.kbWithName, withName, Boolean(withName?.ok));

    // eslint-disable-next-line no-await-in-loop
    const withoutName = await callKbBatch(withoutNameItems).catch((error) => ({
      ok: false,
      status: 0,
      timedOut: isAbortLike(error),
      latencyMs: null,
      signalCount: withoutNameItems.length,
      reviewedHits: 0,
      okHits: 0,
      responseItems: [],
      missReasons: { call_error: withoutNameItems.length },
      error: error instanceof Error ? error.message : String(error),
    }));
    updateStats(stageStats.kbWithoutName, withoutName, Boolean(withoutName?.ok));

    reviewedHitsWithName += withName.reviewedHits;
    reviewedHitsWithoutName += withoutName.reviewedHits;
    const causeBySignal = {};
    withoutNameItems.forEach((signal, idx) => {
      const responseItem = withoutName.responseItems?.[idx];
      if (responseItem?.status === "ok") return;
      const cause = classifyWithoutNameCause(signal, responseItem);
      causeBySignal[cause] = (causeBySignal[cause] || 0) + 1;
      withoutNameCauseCounts[cause] += 1;
    });

    row.kbWithName = {
      status: withName.status ?? null,
      ok: Boolean(withName.ok),
      timedOut: Boolean(withName.timedOut),
      latencyMs: withName.latencyMs ?? null,
      signalCount: withName.signalCount,
      reviewedHits: withName.reviewedHits,
      hitRate: pct(withName.reviewedHits, withName.signalCount),
      okHits: withName.okHits,
      missReasons: withName.missReasons,
      error: withName.error ?? null,
    };
    row.kbWithoutName = {
      status: withoutName.status ?? null,
      ok: Boolean(withoutName.ok),
      timedOut: Boolean(withoutName.timedOut),
      latencyMs: withoutName.latencyMs ?? null,
      signalCount: withoutName.signalCount,
      reviewedHits: withoutName.reviewedHits,
      hitRate: pct(withoutName.reviewedHits, withoutName.signalCount),
      okHits: withoutName.okHits,
      missReasons: withoutName.missReasons,
      withoutNameCause: causeBySignal,
      error: withoutName.error ?? null,
    };
    row.withoutNameCause = causeBySignal;

    rows.push(row);
  }

  let probeModeUsed = false;
  if (explicitIdentities.length > 0) {
    for (const probe of explicitIdentities) {
      // eslint-disable-next-line no-await-in-loop
      await runIdentityProbe({
        source: probe.source,
        id: probe.id,
        label: "explicit_identity_probe",
      });
    }
    probeModeUsed = true;
  }

  if (totalSignals === 0) {
    const fallbackProbes = [
      { source: "lnhpd", id: "80129863" },
      { source: "dsld", id: "307265" },
    ];
    for (const probe of fallbackProbes) {
      // eslint-disable-next-line no-await-in-loop
      await runIdentityProbe({
        source: probe.source,
        id: probe.id,
        label: "auto_probe",
      });
    }
    probeModeUsed = true;
  }

  const apiHealth = await fetchApiHealth();
  const notFoundProbe = await runNotFoundProbes(apiHealth);

  const withNameRate = pct(reviewedHitsWithName, totalSignals);
  const withoutNameRate = pct(reviewedHitsWithoutName, totalSignals);
  const identityIssueCounts = rows.reduce((acc, row) => {
    const issue = pickString(row?.identityIssue);
    if (!issue) return acc;
    acc[issue] = (acc[issue] || 0) + 1;
    return acc;
  }, {});
  const reviewedReasonSummary = rows.reduce(
    (acc, row) => {
      const withMiss = row?.kbWithName?.missReasons;
      const withoutMiss = row?.kbWithoutName?.missReasons;
      const ingredientNotSupported =
        (pickNumber(withMiss?.ingredient_not_supported, 0) ?? 0)
        + (pickNumber(withoutMiss?.ingredient_not_supported, 0) ?? 0);
      const noEntryForFormKey =
        (pickNumber(withMiss?.no_entry_for_form_key, 0) ?? 0)
        + (pickNumber(withoutMiss?.no_entry_for_form_key, 0) ?? 0);
      acc.ingredientNotSupportedCount += ingredientNotSupported;
      acc.noEntryForFormKeyCount += noEntryForFormKey;
      return acc;
    },
    {
      ingredientNotSupportedCount: 0,
      noEntryForFormKeyCount: 0,
    },
  );
  const noFormRowsCount = rows.filter(
    (row) => pickString(row?.score?.signalZeroCause) === "NO_FORM_ROWS",
  ).length;
  const phase2AliasExpansion = {
    threshold: PHASE2_ALIAS_TRIGGER_THRESHOLD,
    shouldTrigger: withNameRate != null ? withNameRate < PHASE2_ALIAS_TRIGGER_THRESHOLD : false,
    status:
      withNameRate == null
        ? "insufficient_signals"
        : withNameRate < PHASE2_ALIAS_TRIGGER_THRESHOLD
          ? "triggered"
          : "skipped_threshold_met",
  };

  const report = {
    generatedAt: new Date().toISOString(),
    baseUrl: API_BASE_URL,
    barcodes,
    summary: {
      kpiPrimary: "reviewed_hit_rate",
      reviewed: {
        withNameHitRate: withNameRate,
        withoutNameHitRate: withoutNameRate,
        ingredientNotSupportedCount: reviewedReasonSummary.ingredientNotSupportedCount,
        noEntryForFormKeyCount: reviewedReasonSummary.noEntryForFormKeyCount,
      },
      guard: {
        noFormRowsCount,
      },
      identityIssues: identityIssueCounts,
    },
    metrics: {
      kpiPrimary: "reviewed_hit_rate",
      reviewed: {
        withNameHitRate: withNameRate,
        withoutNameHitRate: withoutNameRate,
        ingredientNotSupportedCount: reviewedReasonSummary.ingredientNotSupportedCount,
        noEntryForFormKeyCount: reviewedReasonSummary.noEntryForFormKeyCount,
      },
      probeModeUsed,
      whySignalsTotal: totalSignals,
      whyReviewedHitsWithName: reviewedHitsWithName,
      whyReviewedHitsWithoutName: reviewedHitsWithoutName,
      whyReviewedHitRateWithName: withNameRate,
      whyReviewedHitRateWithoutName: withoutNameRate,
      whyReviewedHitRateUplift: totalSignals > 0 ? Number(((reviewedHitsWithName - reviewedHitsWithoutName) / totalSignals).toFixed(3)) : null,
      withoutNameCauseCounts,
      noFormRowsCount,
      phase2AliasExpansion,
      timeoutDistribution: {
        sse: compactStageStats(stageStats.sse),
        score: compactStageStats(stageStats.score),
        kbWithName: compactStageStats(stageStats.kbWithName),
        kbWithoutName: compactStageStats(stageStats.kbWithoutName),
      },
      identityIssueCounts,
      lifecycleDistributionMs: {
        tConnect: {
          p50: percentile(lifecycleTiming.tConnectMs, 50),
          p90: percentile(lifecycleTiming.tConnectMs, 90),
          p95: percentile(lifecycleTiming.tConnectMs, 95),
        },
        tRev0: {
          p50: percentile(lifecycleTiming.tRev0Ms, 50),
          p90: percentile(lifecycleTiming.tRev0Ms, 90),
          p95: percentile(lifecycleTiming.tRev0Ms, 95),
        },
        tRev1OrLimited: {
          p50: percentile(lifecycleTiming.tRev1OrLimitedMs, 50),
          p90: percentile(lifecycleTiming.tRev1OrLimitedMs, 90),
          p95: percentile(lifecycleTiming.tRev1OrLimitedMs, 95),
        },
        tFinalize: {
          p50: percentile(lifecycleTiming.tFinalizeMs, 50),
          p90: percentile(lifecycleTiming.tFinalizeMs, 90),
          p95: percentile(lifecycleTiming.tFinalizeMs, 95),
        },
      },
      apiHealth,
      notFoundProbeSummary: notFoundProbe.summary,
    },
    rows,
    probes: {
      notFound: notFoundProbe,
    },
  };

  const reportPath = path.join(outDir, "report.json");
  await fs.promises.writeFile(reportPath, JSON.stringify(report, null, 2), "utf8");

  const table = rows.map((row) => ({
    barcode: row.barcode,
    source: row.sourceType,
    identityValue: row?.identity?.identityValue ?? null,
    mappingPath: row?.identityResolution?.mappingPath?.label ?? null,
    scoreSignals: row?.score?.signalCount ?? 0,
    matchRatio: row?.score?.scoreCoverage?.matchRatio ?? null,
    signalZeroCause: row?.score?.signalZeroCause ?? null,
    identityIssue: row?.identityIssue ?? null,
    matchedIngredients: Array.isArray(row?.score?.matchedIngredients) ? row.score.matchedIngredients.length : 0,
    mappingConsistency: row?.mappingQuality?.consistencyStatus ?? null,
    matchedCanonicalKey: row?.mappingQuality?.matchedCanonicalKey ?? null,
    withNameHits: row?.kbWithName?.reviewedHits ?? 0,
    withNameRate: row?.kbWithName?.hitRate ?? null,
    withoutNameHits: row?.kbWithoutName?.reviewedHits ?? 0,
    withoutNameRate: row?.kbWithoutName?.hitRate ?? null,
    withoutNameCause: row?.withoutNameCause ?? null,
    sseTimeout: row?.sse?.timedOut ?? false,
    scoreTimeout: row?.score?.timedOut ?? false,
    kbWithTimeout: row?.kbWithName?.timedOut ?? false,
    kbWithoutTimeout: row?.kbWithoutName?.timedOut ?? false,
  }));

  console.log(`[reviewed-hit-diagnostics] wrote ${reportPath}`);
  console.log("[reviewed-hit-diagnostics] summary:");
  console.table(table);
  console.log(JSON.stringify(report.metrics, null, 2));
};

main().catch((error) => {
  console.error("[reviewed-hit-diagnostics] failed", error);
  process.exit(1);
});
