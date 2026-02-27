#!/usr/bin/env node
/* eslint-disable no-console */

import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

import dotenv from "dotenv";
import { createClient } from "@supabase/supabase-js";

const ROOT_DIR = process.cwd();
const OUT_DIR = (() => {
  const override = process.env.BULK_E2E_OUT_DIR ? String(process.env.BULK_E2E_OUT_DIR) : "";
  if (!override.trim()) return path.join(ROOT_DIR, "output", `bulk-barcode-e2e-${Date.now()}`);
  return path.isAbsolute(override) ? override : path.join(ROOT_DIR, override);
})();

dotenv.config({ path: path.join(ROOT_DIR, "backend", ".env") });
dotenv.config({ path: path.join(ROOT_DIR, ".env") });

const API_BASE_URL = process.env.API_BASE_URL || process.env.RENDER_BASE_URL || "http://127.0.0.1:3001";
const BULK_E2E_SSE_TIMEOUT_MS = Number(process.env.BULK_E2E_SSE_TIMEOUT_MS || 45000);
const BULK_E2E_SSE_STOP_ON = String(process.env.BULK_E2E_SSE_STOP_ON || "revision1").toLowerCase();
const BULK_E2E_SSE_STOP_TAIL_MS = Number(process.env.BULK_E2E_SSE_STOP_TAIL_MS || 6000);
const BULK_E2E_RETRIES = Number(process.env.BULK_E2E_RETRIES || 1);
const BULK_E2E_CA_ZERO_INGREDIENTS_MAX = Number(process.env.BULK_E2E_CA_ZERO_INGREDIENTS_MAX || 1);
const BULK_E2E_US_ZERO_INGREDIENTS_MAX = Number(
  process.env.BULK_E2E_US_ZERO_INGREDIENTS_MAX || Number.MAX_SAFE_INTEGER,
);
const BULK_E2E_ENFORCE_GATES = !["0", "false", "off"].includes(
  String(process.env.BULK_E2E_ENFORCE_GATES || "1").toLowerCase(),
);

const SUPABASE_URL = process.env.SUPABASE_URL || process.env.EXPO_PUBLIC_SUPABASE_URL || "";
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || "";
const BULK_E2E_UPSERT_MAP =
  process.env.BULK_E2E_UPSERT_MAP === "1" || process.env.BULK_E2E_UPSERT_MAP === "true";
const REGRESSION_TOKEN = process.env.RENDER_REGRESSION_TOKEN || process.env.REGRESSION_AUTH_TOKEN || "";

const headers = {
  "Content-Type": "application/json",
  Accept: "text/event-stream",
};
if (REGRESSION_TOKEN) {
  headers["x-regression-token"] = REGRESSION_TOKEN;
} else {
  // Local/dev back-compat: do not require auth for maintainer testing.
  headers["x-auth-disabled"] = "1";
}

function toGtin14(digits) {
  const d = String(digits).replace(/\D/g, "");
  if (d.length === 14) return d;
  if (d.length === 13) return `0${d}`;
  if (d.length === 12) return `00${d}`;
  return null;
}

function sha256(s) {
  return crypto.createHash("sha256").update(String(s)).digest("hex");
}

async function ensureDir(p) {
  await fs.promises.mkdir(p, { recursive: true });
}

function isAbortLikeError(error) {
  if (!error) return false;
  const name = typeof error?.name === "string" ? error.name : "";
  const message = typeof error?.message === "string" ? error.message : String(error);
  return name === "AbortError" || /\babort(ed|ing)?\b/i.test(message);
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const latencyStats = (rows) => {
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
};

const isBackendUnavailableMessage = (message) => {
  if (!message) return false;
  return /(fetch failed|econnrefused|econnreset|socket hang up|networkerror|enotfound|eai_again|backend unavailable)/i.test(
    String(message),
  );
};

const classifySummaryRow = (row) => {
  const requestError = Boolean(row?.error);
  const backendUnavailable = isBackendUnavailableMessage(row?.error) ||
    (Boolean(row?.sseTimedOut) && !row?.sourceType && !row?.identityValue);
  const noiseFlags = {
    identityNull: !row?.identityValue,
    sourceTypeNull: !row?.sourceType,
    requestError,
    backendUnavailable,
  };

  let failureClass = null;
  if (requestError && backendUnavailable) {
    failureClass = "infra_process";
  } else if (row?.sseTimedOut) {
    failureClass = "client_timeout";
  } else if (requestError) {
    failureClass = "stream_flow";
  } else if (row?.terminalCode && row.terminalCode !== "DONE") {
    failureClass = row.terminalCode === "NOT_FOUND" ? "data_gap" : "stream_flow";
  } else if (Number(row?.ingredientsTotal ?? 0) === 0) {
    if (!row?.sourceType && !row?.identityValue) {
      failureClass = "infra_process";
    } else {
      failureClass = "data_gap";
    }
  } else if (!row?.sourceType || !row?.identityValue) {
    failureClass = "unknown";
  } else {
    failureClass = null;
  }

  return {
    failureClass,
    noiseFlags,
    requestContext: {
      requestId:
        row?.requestId ??
        row?.sseRequestId ??
        row?.metaRequestId ??
        null,
      terminal: row?.terminalCode ?? null,
      sourceType: row?.sourceType ?? null,
      sourceTypeFinal: row?.sourceTypeFinal ?? null,
      authoritativeIdentity:
        row?.identityType || row?.identityValue
          ? {
              type: row?.identityType ?? null,
              value: row?.identityValue ?? null,
            }
          : null,
      productIdentity:
        row?.productIdentityName ||
        row?.productIdentityBrand ||
        row?.productIdentitySourceAttribution ||
        row?.productIdentitySourceId ||
        typeof row?.productIdentityStable === "boolean"
          ? {
              name: row?.productIdentityName ?? null,
              brand: row?.productIdentityBrand ?? null,
              sourceAttribution: row?.productIdentitySourceAttribution ?? null,
              identityStable:
                typeof row?.productIdentityStable === "boolean"
                  ? row.productIdentityStable
                  : null,
              sourceId: row?.productIdentitySourceId ?? null,
            }
          : null,
      terminalReason: row?.terminalReason ?? null,
      degradedMode:
        typeof row?.degradedMode === "boolean" ? row.degradedMode : null,
      stage0Winner: row?.stage0Winner ?? null,
      stage0StartCount:
        Number.isFinite(Number(row?.stage0StartCount)) ? Number(row.stage0StartCount) : null,
      stage0ReplaceCount:
        Number.isFinite(Number(row?.stage0ReplaceCount)) ? Number(row.stage0ReplaceCount) : null,
    },
  };
};

function shouldStopOnEvent(event, stopOn) {
  if (!event || typeof event !== "object") return false;
  if (stopOn === "persisted") return event.event === "persisted";
  if (event.event !== "analysis_bundle") return false;
  if (!event.data || typeof event.data !== "object") return false;
  const meta = event.data.meta;
  if (!meta || typeof meta !== "object") return false;
  if (stopOn === "fast_ai") return meta.phase === "fast_ai";
  if (stopOn === "revision1") return Number(meta.revision) >= 1;
  return false;
}

async function fetchSseOnce(url, payload, options = {}) {
  const ctrl = new AbortController();
  const timeoutMs = Number.isFinite(options.timeoutMs) ? options.timeoutMs : BULK_E2E_SSE_TIMEOUT_MS;
  const stopOn = ["revision1", "fast_ai", "persisted"].includes(options.stopOn) ? options.stopOn : BULK_E2E_SSE_STOP_ON;
  const stopTailMs = Number.isFinite(options.stopTailMs) ? options.stopTailMs : BULK_E2E_SSE_STOP_TAIL_MS;
  const timeout = setTimeout(() => ctrl.abort(), timeoutMs);
  const start = Date.now();
  let bytesReceived = 0;
  let lastEventType = null;
  let lastEventAtMs = null;
  let parseErrorCount = 0;
  let streamClosed = false;
  let timedOut = false;
  let abortError = false;
  let doneSeen = false;
  let stopEvent = null;
  let sawStopMarker = false;
  const events = [];

  try {
    const res = await fetch(url, {
      method: "POST",
      headers,
      body: JSON.stringify(payload),
      signal: ctrl.signal,
    });
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      throw new Error(`SSE request failed: ${res.status} ${text.slice(0, 200)}`);
    }

    const reader = res.body?.getReader();
    if (!reader) {
      throw new Error("SSE stream reader unavailable");
    }

    const decoder = new TextDecoder();
    let buffer = "";
    let currentEvent = null;
    let currentData = "";

    const flushEvent = () => {
      if (!currentEvent) return;
      const data = currentData.trim();
      if (!data) {
        currentEvent = null;
        currentData = "";
        return;
      }
      const tMs = Date.now() - start;
      let parsed = data;
      try {
        parsed = JSON.parse(data);
      } catch {
        parseErrorCount += 1;
      }
      const event = { tMs, event: currentEvent, data: parsed };
      events.push(event);
      lastEventType = event.event;
      lastEventAtMs = event.tMs;
      if (event.event === "done") {
        doneSeen = true;
      }
      if (!stopEvent && shouldStopOnEvent(event, stopOn)) {
        stopEvent = {
          stopOn,
          event: event.event,
          tMs: event.tMs,
        };
        sawStopMarker = true;
      }
      currentEvent = null;
      currentData = "";
    };

    while (true) {
      const { value, done } = await reader.read();
      if (done) {
        streamClosed = true;
        break;
      }
      if (value) {
        bytesReceived += value.byteLength;
      }
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split(/\r?\n/);
      buffer = lines.pop() ?? "";
      for (const line of lines) {
        if (!line.trim()) {
          flushEvent();
          if (doneSeen) break;
          continue;
        }
        if (line.startsWith("event:")) currentEvent = line.replace("event:", "").trim();
        else if (line.startsWith("data:")) currentData += line.replace("data:", "").trim();
      }

      if (doneSeen) {
        await reader.cancel().catch(() => undefined);
        streamClosed = true;
        break;
      }

      if (sawStopMarker && Number.isFinite(stopTailMs) && stopTailMs > 0) {
        const elapsedMs = Date.now() - start;
        if (elapsedMs >= (stopEvent?.tMs ?? 0) + stopTailMs) {
          await reader.cancel().catch(() => undefined);
          streamClosed = true;
          break;
        }
      }

      if (sawStopMarker && (!Number.isFinite(stopTailMs) || stopTailMs <= 0)) {
        await reader.cancel().catch(() => undefined);
        streamClosed = true;
        break;
      }
    }

    return {
      events,
      stopEvent,
      doneSeen,
      streamClosed,
      timedOut,
      abortError,
      bytesReceived,
      lastEventType,
      lastEventAtMs,
      parseErrorCount,
    };
  } catch (error) {
    if (isAbortLikeError(error)) {
      timedOut = true;
      abortError = true;
      return {
        events,
        stopEvent,
        doneSeen,
        streamClosed,
        timedOut,
        abortError,
        bytesReceived,
        lastEventType,
        lastEventAtMs,
        parseErrorCount,
      };
    }
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}

async function fetchSse(url, payload, options = {}) {
  const retries = Number.isFinite(options.retries) ? options.retries : BULK_E2E_RETRIES;
  let lastError = null;
  for (let attempt = 0; attempt <= retries; attempt += 1) {
    try {
      return await fetchSseOnce(url, payload, options);
    } catch (error) {
      lastError = error;
      if (attempt >= retries) break;
      const delayMs = 300 * (attempt + 1);
      await sleep(delayMs);
    }
  }
  throw lastError ?? new Error("SSE failed without explicit error");
}

function pickBundles(events) {
  const bundles = events
    .filter((e) => e.event === "analysis_bundle" && e.data && typeof e.data === "object")
    .map((e) => ({ tMs: e.tMs, bundle: e.data }));
  const rev0 = bundles.find((b) => b.bundle?.meta?.revision === 0) || null;
  const rev1 = bundles.find((b) => b.bundle?.meta?.revision === 1) || null;
  const best = [...bundles].reverse().find((b) => b.bundle?.meta?.phase === "fast_ai") || null;
  return { rev0, rev1, best };
}

function pickTerminalSignals(events) {
  const errors = events.filter((e) => e.event === "error");
  const done = [...events].reverse().find((e) => e.event === "done") || null;
  return {
    terminalError: errors.length > 0 ? errors[errors.length - 1] : null,
    done,
  };
}

function summarizeBundle(bundle) {
  const meta = bundle?.meta || null;
  const sections = bundle?.sections || {};
  return {
    meta,
    sections: {
      overview: {
        dataStatus: sections?.overview?.dataStatus ?? null,
        cover: sections?.overview?.cover ?? null,
      },
      ingredients: {
        dataStatus: sections?.ingredients?.dataStatus ?? null,
        cover: sections?.ingredients?.cover ?? null,
      },
      usage: {
        dataStatus: sections?.usage?.dataStatus ?? null,
        cover: sections?.usage?.cover ?? null,
      },
      safety: {
        dataStatus: sections?.safety?.dataStatus ?? null,
        cover: sections?.safety?.cover ?? null,
      },
    },
  };
}

async function fetchIngredientsDetail(meta, limit = 6, cursor = 0) {
  if (!meta?.authoritativeIdentity || !meta?.factsDigestHash) {
    return { status: 0, data: null, timingMs: 0 };
  }
  const payload = {
    identity: meta.authoritativeIdentity,
    section: "ingredients_detail",
    locale: meta.locale || "en",
    promptVersion: meta.promptVersion,
    factsDigestHash: meta.factsDigestHash,
    limit,
    cursor,
  };
  const t0 = Date.now();
  const res = await fetch(`${API_BASE_URL}/api/analysis-section`, {
    method: "POST",
    headers: { ...headers, Accept: "application/json" },
    body: JSON.stringify(payload),
  });
  const timingMs = Date.now() - t0;
  const data = await res.json().catch(() => null);
  return { status: res.status, data, timingMs };
}

function safePick(obj, keys) {
  let cur = obj;
  for (const k of keys) {
    if (!cur || typeof cur !== "object") return null;
    cur = cur[k];
  }
  return cur ?? null;
}

async function upsertBarcodeMapForCanada(caItems) {
  if (!BULK_E2E_UPSERT_MAP) {
    return { inserted: 0, skipped: caItems.length, mode: "disabled" };
  }
  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
    console.warn("[bulk-e2e] SUPABASE_URL/SUPABASE_SERVICE_ROLE_KEY missing; skipping map upserts.");
    return { inserted: 0, skipped: caItems.length, mode: "missing_env" };
  }
  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false },
  });

  const now = new Date();
  const expiresAt = new Date(now.getTime() + 90 * 24 * 60 * 60 * 1000).toISOString();

  let inserted = 0;
  for (const it of caItems) {
    const gtin14 = toGtin14(it.barcode);
    if (!gtin14) continue;
    const record = {
      barcode_gtin14: gtin14,
      barcode_raw: String(it.barcode),
      npn: String(it.npn),
      confidence: 0.95,
      source: "bulk_e2e_manual",
      last_seen_at: now.toISOString(),
      expires_at: expiresAt,
      updated_at: now.toISOString(),
    };
    // eslint-disable-next-line no-await-in-loop
    const { error } = await supabase.from("barcode_regulatory_map").upsert(record, { onConflict: "barcode_gtin14" });
    if (!error) inserted += 1;
  }
  return { inserted, skipped: caItems.length - inserted, mode: "enabled" };
}

function buildTestSet() {
  const ca = [
    { barcode: "628747100045", npn: "80062961", url: "https://newrootsherbal.com/shop/acidophilus-ultra-11-billion" },
    { barcode: "628747200097", npn: "80036596", url: "https://newrootsherbal.com/shop/grapefruit-seed-extract-liquid-concentrate" },
    { barcode: "628747100113", npn: "80021829", url: "https://newrootsherbal.com/shop/super-fibre-psyllium-capsules" },
    { barcode: "628747100168", npn: "80100520", url: "https://newrootsherbal.com/shop/prolax" },
    { barcode: "628747100212", npn: "80066778", url: "https://newrootsherbal.com/shop/candida-stop" },
    { barcode: "628747100229", npn: "80041615", url: "https://newrootsherbal.com/shop/caprylic-acid-plus" },
    { barcode: "628747200264", npn: "80044382", url: "https://newrootsherbal.com/shop/pau-darco-taheebo-liquid-extract" },
    { barcode: "628747000277", npn: "80106954", url: "https://newrootsherbal.com/shop/vitamin-c-crystals" },
    { barcode: "628747000307", npn: "80066047", url: "https://newrootsherbal.com/shop/vitamin-c-calcium-ascorbate-crystals" },
    { barcode: "628747000567", npn: "80030361", url: "https://newrootsherbal.com/shop/ultra-max-36-billion" },
    { barcode: "628747100892", npn: "80021987", url: "https://newrootsherbal.com/shop/taurine" },
    { barcode: "628747108652", npn: "80010311", url: "https://newrootsherbal.com/shop/l-glutamine-capsules" },
    { barcode: "628747101240", npn: "80043836", url: "https://newrootsherbal.com/shop/pau-darco-taheebo-capsules" },
    { barcode: "628747201308", npn: "80035939", url: "https://newrootsherbal.com/shop/black-cumin-seed-oil-softgels-500-mg" },
    { barcode: "628747101486", npn: "80017685", url: "https://newrootsherbal.com/shop/l-methionine" },
  ];

  const us = [
    { barcode: "00883196120819", dsldLabelId: "264429", brand: "Genestra Brands", name: "Phyto-Gen Imu-gen" },
    { barcode: "00064435131173", dsldLabelId: "281185", brand: "TerraVita", name: "Mallow (Malva sylvestris) Flower Mint Flavor" },
    { barcode: "00649908268756", dsldLabelId: "329337", brand: "NutraBio", name: "KSM-66 Ashwagandha" },
    { barcode: "00074312131851", dsldLabelId: "62057", brand: "Nature's Bounty", name: "SAM-e 400 mg" },
    { barcode: "00819209022184", dsldLabelId: "251767", brand: "AN Amazing Nutrition", name: "Amazing Omega Norwegian Fish Oil 1,000 mg Fresh Lemon Flavor" },
    { barcode: "00818423021065", dsldLabelId: "207107", brand: "BIOVEA", name: "Biotin 500 mcg" },
    { barcode: "00035046009144", dsldLabelId: "7444", brand: "Windmill", name: "Super Omega 3 EPA/DHA Formula" },
    { barcode: "00782932123261", dsldLabelId: "29906", brand: "Flower Essence Services", name: "Lupine Flower Essence" },
    { barcode: "00064435130763", dsldLabelId: "287952", brand: "TerraVita", name: "Shiitake and Reishi Mushroom Combination Powder" },
    { barcode: "00812259003042", dsldLabelId: "260939", brand: "Quality of Life", name: "Allerfin" },
    { barcode: "00367703180065", dsldLabelId: "202305", brand: "Terry Naturally", name: "BioActive Vitamin B" },
    { barcode: "00850002207323", dsldLabelId: "307265", brand: "Kion", name: "Omega" },
    { barcode: "00851005007163", dsldLabelId: "229055", brand: "Racked", name: "BCAA Blood Raz" },
    { barcode: "00851335007154", dsldLabelId: "256558", brand: "Organixx", name: "T-Plexx" },
    { barcode: "00084783891253", dsldLabelId: "200338", brand: "Christopher's Original Formulas", name: "Herbal Iron Formula" },
  ];

  return { ca, us };
}

function evaluateQualityGates(summaryRows) {
  const caRows = summaryRows.filter((row) => row.country === "CA");
  const usRows = summaryRows.filter((row) => row.country === "US");
  const caZeroIngredientsRows = caRows.filter((row) => Number(row.ingredientsTotal ?? 0) === 0);
  const usZeroIngredientsRows = usRows.filter((row) => Number(row.ingredientsTotal ?? 0) === 0);
  const terminalBreakdown = summaryRows.reduce((acc, row) => {
    const key = row.terminalCode || "NO_TERMINAL";
    acc[key] = (acc[key] || 0) + 1;
    return acc;
  }, {});
  const failureClassBreakdown = summaryRows.reduce((acc, row) => {
    const key = row.failureClass || "none";
    acc[key] = (acc[key] || 0) + 1;
    return acc;
  }, {});
  const terminalReasonCounts = summaryRows.reduce((acc, row) => {
    const key = String(row.terminalReason || "UNKNOWN");
    acc[key] = (acc[key] || 0) + 1;
    return acc;
  }, {});
  const stage0WinnerCounts = summaryRows.reduce((acc, row) => {
    const key = String(row.stage0Winner || "UNKNOWN");
    acc[key] = (acc[key] || 0) + 1;
    return acc;
  }, {});
  const degradedModeCounts = summaryRows.reduce(
    (acc, row) => {
      if (row.degradedMode === true) acc.true += 1;
      else if (row.degradedMode === false) acc.false += 1;
      else acc.unknown += 1;
      return acc;
    },
    { true: 0, false: 0, unknown: 0 },
  );
  const noiseCounts = summaryRows.reduce(
    (acc, row) => {
      if (row.noiseFlags?.identityNull) acc.identityNull += 1;
      if (row.noiseFlags?.sourceTypeNull) acc.sourceTypeNull += 1;
      if (row.noiseFlags?.requestError) acc.requestError += 1;
      if (row.noiseFlags?.backendUnavailable) acc.backendUnavailable += 1;
      return acc;
    },
    { identityNull: 0, sourceTypeNull: 0, requestError: 0, backendUnavailable: 0 },
  );
  const caZeroFailureClassBreakdown = caZeroIngredientsRows.reduce((acc, row) => {
    const key = row.failureClass || "none";
    acc[key] = (acc[key] || 0) + 1;
    return acc;
  }, {});

  const failures = [];
  if (caZeroIngredientsRows.length > BULK_E2E_CA_ZERO_INGREDIENTS_MAX) {
    failures.push(
      `ca_zero_ingredients ${caZeroIngredientsRows.length} > ${BULK_E2E_CA_ZERO_INGREDIENTS_MAX}`,
    );
  }
  if (
    Number.isFinite(BULK_E2E_US_ZERO_INGREDIENTS_MAX)
    && usZeroIngredientsRows.length > BULK_E2E_US_ZERO_INGREDIENTS_MAX
  ) {
    failures.push(
      `us_zero_ingredients ${usZeroIngredientsRows.length} > ${BULK_E2E_US_ZERO_INGREDIENTS_MAX}`,
    );
  }

  return {
    pass: failures.length === 0,
    enforce: BULK_E2E_ENFORCE_GATES,
    thresholds: {
      caZeroIngredientsMax: BULK_E2E_CA_ZERO_INGREDIENTS_MAX,
      usZeroIngredientsMax: Number.isFinite(BULK_E2E_US_ZERO_INGREDIENTS_MAX)
        ? BULK_E2E_US_ZERO_INGREDIENTS_MAX
        : null,
    },
    metrics: {
      caTotal: caRows.length,
      usTotal: usRows.length,
      caZeroIngredientsCount: caZeroIngredientsRows.length,
      usZeroIngredientsCount: usZeroIngredientsRows.length,
      terminalBreakdown,
      failureClassBreakdown,
      terminalReasonCounts,
      stage0WinnerCounts,
      degradedModeCounts,
      noiseCounts,
      caZeroFailureClassBreakdown,
      doneLatencyMs: latencyStats(summaryRows.map((row) => row.doneMs)),
      notFoundRev1LatencyMs: latencyStats(
        summaryRows
          .filter((row) => row.terminalCode === "NOT_FOUND")
          .map((row) => row.revision1Ms),
      ),
      stage0StartCountStats: latencyStats(
        summaryRows.map((row) => (Number.isFinite(Number(row.stage0StartCount)) ? Number(row.stage0StartCount) : null)),
      ),
      stage0ReplaceCountStats: latencyStats(
        summaryRows.map((row) => (Number.isFinite(Number(row.stage0ReplaceCount)) ? Number(row.stage0ReplaceCount) : null)),
      ),
    },
    rows: {
      caZeroIngredients: caZeroIngredientsRows.map((row) => ({
        barcode: row.barcode,
        identityValue: row.identityValue,
        sourceType: row.sourceType,
        failureClass: row.failureClass ?? null,
        noiseFlags: row.noiseFlags ?? null,
        requestContext: row.requestContext ?? null,
      })),
      usZeroIngredients: usZeroIngredientsRows.map((row) => ({
        barcode: row.barcode,
        identityValue: row.identityValue,
        sourceType: row.sourceType,
        failureClass: row.failureClass ?? null,
        noiseFlags: row.noiseFlags ?? null,
        requestContext: row.requestContext ?? null,
      })),
    },
    failures,
  };
}

async function runOne(item) {
  const barcodeGtin14 = toGtin14(item.barcode) || String(item.barcode);
  const sseResult = await fetchSse(`${API_BASE_URL}/api/enrich-stream`, { barcode: barcodeGtin14 });
  const events = sseResult.events;
  const { rev0, rev1, best } = pickBundles(events);
  const { terminalError, done } = pickTerminalSignals(events);
  const fastBundle = (best?.bundle || rev1?.bundle || rev0?.bundle) ?? null;
  const fallbackReason =
    fastBundle?.meta?.fallbackReason ??
    fastBundle?.meta?.fallback?.code ??
    null;
  const sourceType = fastBundle?.meta?.sourceType ?? null;
  const scoreAvailable =
    typeof fastBundle?.meta?.scoreAvailable === "boolean"
      ? fastBundle.meta.scoreAvailable
      : sourceType === "dsld" || sourceType === "lnhpd"
        ? true
        : sourceType === "web"
          ? false
          : null;
  const terminalCode =
    typeof terminalError?.data?.code === "string"
      ? terminalError.data.code
      : done
        ? "DONE"
        : null;
  const doneTerminalReason =
    (typeof done?.data?.terminalReason === "string" && done.data.terminalReason) ||
    (typeof done?.data?.reason === "string" && done.data.reason) ||
    null;
  const doneStage0Winner =
    typeof done?.data?.stage0Winner === "string" ? done.data.stage0Winner : null;
  const doneStage0StartCount =
    Number.isFinite(Number(done?.data?.stage0StartCount))
      ? Number(done.data.stage0StartCount)
      : null;
  const doneStage0ReplaceCount =
    Number.isFinite(Number(done?.data?.stage0ReplaceCount))
      ? Number(done.data.stage0ReplaceCount)
      : null;
  const doneDegradedMode =
    typeof done?.data?.degradedMode === "boolean" ? done.data.degradedMode : null;
  const errorReasonCode =
    typeof terminalError?.data?.reasonCode === "string" ? terminalError.data.reasonCode : null;
  const authorityFailureReason =
    (typeof fastBundle?.meta?.authorityFailureReason === "string" && fastBundle.meta.authorityFailureReason) ||
    (typeof fastBundle?.meta?.authority_failure_reason === "string" && fastBundle.meta.authority_failure_reason) ||
    (typeof terminalError?.data?.authorityFailureReason === "string" && terminalError.data.authorityFailureReason) ||
    (typeof terminalError?.data?.authority_failure_reason === "string" && terminalError.data.authority_failure_reason) ||
    null;

  const sse = {
    barcode: barcodeGtin14,
    sseEventCount: events.length,
    stopEvent: sseResult.stopEvent,
    doneSeen: sseResult.doneSeen,
    streamClosed: sseResult.streamClosed,
    timedOut: sseResult.timedOut,
    abortError: sseResult.abortError,
    bytesReceived: sseResult.bytesReceived,
    lastEventType: sseResult.lastEventType,
    lastEventAtMs: sseResult.lastEventAtMs,
    parseErrorCount: sseResult.parseErrorCount,
    tRevision0Ms: rev0?.tMs ?? null,
    tRevision1Ms: rev1?.tMs ?? null,
    tDoneMs: done?.tMs ?? null,
    terminalCode,
    terminalReason: doneTerminalReason,
    stage0Winner: doneStage0Winner,
    stage0StartCount: doneStage0StartCount,
    stage0ReplaceCount: doneStage0ReplaceCount,
    degradedMode: doneDegradedMode,
    errorReasonCode,
    fallbackReason,
    sourceTypeFinal: fastBundle?.meta?.sourceTypeFinal ?? null,
    scoreAvailable,
    authorityFailureReason,
    meta: fastBundle?.meta ?? null,
    bundleSummary: summarizeBundle(fastBundle),
    snapshotNpn: (() => {
      const snap = events.find((e) => e.event === "snapshot")?.data;
      return safePick(snap, ["regulatory", "npn"]);
    })(),
  };

  const meta = fastBundle?.meta || null;
  const ingredientsCover = safePick(fastBundle, ["sections", "ingredients", "cover"]);
  const totalCount = Number(ingredientsCover?.totalCount ?? 0);
  const shouldFetchDetail = totalCount > 0 && meta?.authoritativeIdentity && meta?.factsDigestHash;

  const detail = shouldFetchDetail ? await fetchIngredientsDetail(meta, 6, 0) : { status: 0, data: null, timingMs: 0 };

  return {
    input: item,
    sse,
    detail,
  };
}

async function main() {
  await ensureDir(OUT_DIR);
  const { ca, us } = buildTestSet();

  const mapRes = await upsertBarcodeMapForCanada(ca);
  console.log(`[bulk-e2e] API_BASE_URL=${API_BASE_URL}`);
  console.log(
    `[bulk-e2e] SSE stopOn=${BULK_E2E_SSE_STOP_ON} stopTailMs=${BULK_E2E_SSE_STOP_TAIL_MS} timeoutMs=${BULK_E2E_SSE_TIMEOUT_MS} retries=${BULK_E2E_RETRIES}`,
  );
  console.log(
    `[bulk-e2e] CA map upserts mode=${mapRes.mode} inserted=${mapRes.inserted} skipped=${mapRes.skipped}`,
  );

  const all = [
    ...ca.map((x) => ({ ...x, country: "CA" })),
    ...us.map((x) => ({ ...x, country: "US" })),
  ];

  const results = [];
  for (const it of all) {
    console.log(`[bulk-e2e] scanning ${it.country} ${it.barcode} ...`);
    // eslint-disable-next-line no-await-in-loop
    const r = await runOne(it).catch((err) => ({ input: it, error: String(err) }));
    results.push(r);
    await fs.promises.writeFile(path.join(OUT_DIR, "results.json"), JSON.stringify(results, null, 2));
  }

  // lightweight summary
  const summary = results.map((r) => {
    const meta = r?.sse?.meta || null;
    const detailData = r?.detail?.data || null;
    const row = {
      country: r?.input?.country || null,
      barcode: r?.sse?.barcode || r?.input?.barcode || null,
      expectedNpn: r?.input?.npn || null,
      expectedDsldLabelId: r?.input?.dsldLabelId || null,
      sourceType: meta?.sourceType || null,
      sourceTypeFinal: r?.sse?.sourceTypeFinal ?? null,
      terminalReason:
        (typeof r?.sse?.terminalReason === "string" && r.sse.terminalReason) ||
        (typeof meta?.terminalReason === "string" && meta.terminalReason) ||
        null,
      stage0Winner:
        (typeof r?.sse?.stage0Winner === "string" && r.sse.stage0Winner) ||
        (typeof meta?.stage0Winner === "string" ? meta.stage0Winner : null),
      stage0StartCount:
        Number.isFinite(Number(r?.sse?.stage0StartCount))
          ? Number(r.sse.stage0StartCount)
          : Number.isFinite(Number(meta?.stage0StartCount))
            ? Number(meta.stage0StartCount)
            : null,
      stage0ReplaceCount:
        Number.isFinite(Number(r?.sse?.stage0ReplaceCount))
          ? Number(r.sse.stage0ReplaceCount)
          : Number.isFinite(Number(meta?.stage0ReplaceCount))
            ? Number(meta.stage0ReplaceCount)
            : null,
      degradedMode:
        typeof r?.sse?.degradedMode === "boolean"
          ? r.sse.degradedMode
          : typeof meta?.degradedMode === "boolean"
            ? meta.degradedMode
            : null,
      identityType: meta?.authoritativeIdentity?.type || null,
      identityValue: meta?.authoritativeIdentity?.value || null,
      productIdentityName:
        typeof meta?.productIdentity?.name === "string" ? meta.productIdentity.name : null,
      productIdentityBrand:
        typeof meta?.productIdentity?.brand === "string" ? meta.productIdentity.brand : null,
      productIdentitySourceAttribution:
        typeof meta?.productIdentity?.sourceAttribution === "string"
          ? meta.productIdentity.sourceAttribution
          : null,
      productIdentityStable:
        typeof meta?.productIdentity?.identityStable === "boolean"
          ? meta.productIdentity.identityStable
          : null,
      productIdentitySourceId:
        typeof meta?.productIdentity?.sourceId === "string" ? meta.productIdentity.sourceId : null,
      factsDigestHash: meta?.factsDigestHash || null,
      terminalCode: r?.sse?.terminalCode ?? null,
      errorReasonCode: r?.sse?.errorReasonCode ?? null,
      fallbackReason: r?.sse?.fallbackReason ?? null,
      scoreAvailable: r?.sse?.scoreAvailable ?? null,
      authorityFailureReason: r?.sse?.authorityFailureReason ?? null,
      sseStopOn: r?.sse?.stopEvent?.stopOn ?? null,
      sseStopEvent: r?.sse?.stopEvent?.event ?? null,
      sseDoneSeen: r?.sse?.doneSeen ?? null,
      sseStreamClosed: r?.sse?.streamClosed ?? null,
      sseTimedOut: r?.sse?.timedOut ?? null,
      sseAbortError: r?.sse?.abortError ?? null,
      revision0Ms: r?.sse?.tRevision0Ms ?? null,
      revision1Ms: r?.sse?.tRevision1Ms ?? null,
      doneMs: r?.sse?.tDoneMs ?? null,
      ingredientsTotal: safePick(r?.sse, ["bundleSummary", "sections", "ingredients", "cover", "totalCount"]) ?? null,
      detailStatus: r?.detail?.status ?? null,
      detailDataStatus: detailData?.dataStatus ?? null,
      detailTimingMs: r?.detail?.timingMs ?? null,
      detailFallbackUsed: safePick(detailData, ["meta", "fallbackUsed"]) ?? null,
      error: r?.error || null,
    };
    const diagnostics = classifySummaryRow(row);
    return {
      ...row,
      failureClass: diagnostics.failureClass,
      noiseFlags: diagnostics.noiseFlags,
      requestContext: diagnostics.requestContext,
    };
  });

  const summaryPath = path.join(OUT_DIR, "summary.json");
  await fs.promises.writeFile(summaryPath, JSON.stringify(summary, null, 2));
  console.log(`[bulk-e2e] wrote ${summaryPath}`);
  const gate = evaluateQualityGates(summary);
  const gatePath = path.join(OUT_DIR, "gate.json");
  await fs.promises.writeFile(gatePath, JSON.stringify(gate, null, 2));
  console.log(`[bulk-e2e] wrote ${gatePath}`);

  // Print compact table to stdout
  console.log("\ncountry\tbarcode\tsource\tterminal\tidentity\tingredients\tdetailStatus\tdetailDataStatus\tdetailMs\tfallback");
  for (const row of summary) {
    console.log(
      [
        row.country,
        row.barcode,
        row.sourceType,
        row.terminalCode,
        `${row.identityType || ""}:${row.identityValue || ""}`,
        row.ingredientsTotal,
        row.detailStatus,
        row.detailDataStatus,
        row.detailTimingMs,
        row.detailFallbackUsed || "",
      ].join("\t"),
    );
  }

  // Basic stats
  const bySource = {};
  for (const row of summary) {
    const key = row.sourceType || "unknown";
    bySource[key] = (bySource[key] || 0) + 1;
  }
  console.log("\n[bulk-e2e] counts by sourceType:", bySource);
  console.log(`[bulk-e2e] results dir: ${OUT_DIR}`);
  console.log(
    `[bulk-e2e] gate pass=${gate.pass} enforce=${gate.enforce} caZeroIngredients=${gate.metrics.caZeroIngredientsCount}/${gate.thresholds.caZeroIngredientsMax}`,
  );
  if (gate.enforce && !gate.pass) {
    throw new Error(`[bulk-e2e] quality gate failed: ${gate.failures.join("; ")}`);
  }
}

main().catch((err) => {
  console.error("bulk-e2e failed:", err);
  process.exit(1);
});
