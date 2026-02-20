#!/usr/bin/env node
/* eslint-disable no-console */

import fs from "node:fs";
import path from "node:path";
import { performance } from "node:perf_hooks";

import dotenv from "dotenv";

const ROOT_DIR = process.cwd();
dotenv.config({ path: path.join(ROOT_DIR, "backend", ".env") });
dotenv.config({ path: path.join(ROOT_DIR, ".env") });

const API_BASE_URL = process.env.API_BASE_URL || process.env.RENDER_BASE_URL || "http://127.0.0.1:3001";
const REGRESSION_TOKEN = process.env.RENDER_REGRESSION_TOKEN || process.env.REGRESSION_AUTH_TOKEN || "";
const AUTH_DISABLED_HEADER =
  process.env.RENDER_AUTH_DISABLED_HEADER ||
  (REGRESSION_TOKEN ? null : "1");
const FIXTURE_DIR = path.join(ROOT_DIR, "scripts", "maintainer", "fixtures");
const OUT_POOL_PATH = path.join(FIXTURE_DIR, "web_probe_pool.json");
const OUT_POOL_PARTIAL_PATH = path.join(FIXTURE_DIR, "web_probe_pool.partial.json");
const OUT_REPORT_PATH = path.join(FIXTURE_DIR, "web_probe_pool_report.json");

const TARGET = Math.max(1, Number(process.env.WEB_PROBE_POOL_TARGET || 15));
const ROUNDS = Math.max(1, Number(process.env.WEB_PROBE_POOL_ROUNDS || 2));
const CONCURRENCY = Math.max(1, Number(process.env.WEB_PROBE_POOL_CONCURRENCY || 3));
const CANDIDATE_LIMIT = Math.max(TARGET, Number(process.env.WEB_PROBE_POOL_CANDIDATE_LIMIT || 90));
const SSE_TIMEOUT_MS = Math.max(5_000, Number(process.env.WEB_PROBE_POOL_SSE_TIMEOUT_MS || 20_000));
const STOP_TAIL_MS = Math.max(1_000, Number(process.env.WEB_PROBE_POOL_STOP_TAIL_MS || 6_000));
const PROBE_RETRIES = Math.max(0, Number(process.env.WEB_PROBE_POOL_RETRIES || 2));
const PROBE_RETRY_BASE_MS = Math.max(50, Number(process.env.WEB_PROBE_POOL_RETRY_BASE_MS || 300));
const PROBE_RETRY_MAX_MS = Math.max(PROBE_RETRY_BASE_MS, Number(process.env.WEB_PROBE_POOL_RETRY_MAX_MS || 2500));
const MIN_WEB_RATE = Math.max(0, Math.min(1, Number(process.env.WEB_PROBE_POOL_MIN_WEB_RATE || 1)));
const MIN_DONE_RATE = Math.max(0, Math.min(1, Number(process.env.WEB_PROBE_POOL_MIN_DONE_RATE || 1)));
const MIN_STABLE_RATE = Math.max(0, Math.min(1, Number(process.env.WEB_PROBE_POOL_MIN_STABLE_RATE || 1)));
const MAX_HARD_ERROR_RATE = Math.max(0, Math.min(1, Number(process.env.WEB_PROBE_POOL_MAX_HARD_ERROR_RATE || 0.1)));
const MAX_HARD_ERROR_RATE_TERMINAL = Math.max(
  0,
  Math.min(1, Number(process.env.WEB_PROBE_POOL_MAX_HARD_ERROR_RATE_TERMINAL || 1)),
);
const REQUIRE_REV1_STABLE = (() => {
  const raw = String(process.env.WEB_PROBE_POOL_REQUIRE_REV1 ?? "")
    .trim()
    .toLowerCase();
  if (!raw) return true;
  if (raw === "0" || raw === "false") return false;
  return true;
})();
const ENABLE_OFF_DISCOVERY =
  process.env.WEB_PROBE_POOL_ENABLE_OFF_DISCOVERY !== "0" &&
  process.env.WEB_PROBE_POOL_ENABLE_OFF_DISCOVERY !== "false";
const OFF_DISCOVERY_LIMIT = Math.max(0, Number(process.env.WEB_PROBE_POOL_OFF_LIMIT || 120));
const OFF_DISCOVERY_PAGES = Math.max(1, Number(process.env.WEB_PROBE_POOL_OFF_PAGES || 4));
const OFF_FETCH_TIMEOUT_MS = Math.max(500, Number(process.env.WEB_PROBE_POOL_OFF_FETCH_TIMEOUT_MS || 8_000));
const MANUAL_FIXTURE_WEIGHT = Math.max(1, Number(process.env.WEB_PROBE_POOL_MANUAL_WEIGHT || 120));
const PRECHECK_ENABLED =
  process.env.WEB_PROBE_POOL_PRECHECK !== "0" &&
  process.env.WEB_PROBE_POOL_PRECHECK !== "false";
const PRECHECK_INTERVAL = Math.max(1, Number(process.env.WEB_PROBE_POOL_PRECHECK_INTERVAL || 1));
const PRECHECK_TIMEOUT_MS = Math.max(200, Number(process.env.WEB_PROBE_POOL_PRECHECK_TIMEOUT_MS || 1200));
const PRECHECK_UNHEALTHY_BACKOFF_MS = Math.max(
  0,
  Number(process.env.WEB_PROBE_POOL_PRECHECK_UNHEALTHY_BACKOFF_MS || 1200),
);
const PRECHECK_ABORT_STREAK = Math.max(1, Number(process.env.WEB_PROBE_POOL_PRECHECK_ABORT_STREAK || 6));
const PROBE_COOLDOWN_MS = Math.max(0, Number(process.env.WEB_PROBE_POOL_COOLDOWN_MS || 250));
const WRITE_PARTIAL_ON_FAIL =
  process.env.WEB_PROBE_POOL_WRITE_PARTIAL_ON_FAIL !== "0" &&
  process.env.WEB_PROBE_POOL_WRITE_PARTIAL_ON_FAIL !== "false";

const trimSlash = (value) => String(value || "").replace(/\/+$/, "");
const API_BASE_TRIMMED = trimSlash(API_BASE_URL);
const PRECHECK_URLS = [
  `${API_BASE_TRIMMED}/health`,
  `${API_BASE_TRIMMED}/api/nutri-tips`,
  `${API_BASE_TRIMMED}/internal/metrics`,
];
let precheckCounter = 0;
let lastHealthyPrecheck = null;
const PRECHECK_HEADERS = {
  accept: "application/json",
  ...(REGRESSION_TOKEN ? { "x-regression-token": REGRESSION_TOKEN, "x-regression-debug": "1" } : {}),
  ...(AUTH_DISABLED_HEADER ? { "x-auth-disabled": AUTH_DISABLED_HEADER } : {}),
};

const todayIso = () => new Date().toISOString().slice(0, 10);

const normalizeBarcode = (value) => {
  const digits = String(value ?? "").replace(/\D/g, "");
  if (!digits) return null;
  if (digits.length > 14 || digits.length < 8) return null;
  return digits.padStart(14, "0");
};

const readJson = async (filePath) => JSON.parse(await fs.promises.readFile(filePath, "utf8"));

const maybeReadJson = async (filePath) => {
  try {
    return await readJson(filePath);
  } catch {
    return null;
  }
};

const listOutputDirs = async () => {
  const outDir = path.join(ROOT_DIR, "output");
  let entries = [];
  try {
    entries = await fs.promises.readdir(outDir, { withFileTypes: true });
  } catch {
    return [];
  }
  return entries
    .filter((entry) => entry.isDirectory() && entry.name.startsWith("website-barcode-e2e-"))
    .map((entry) => path.join(outDir, entry.name))
    .sort((a, b) => b.localeCompare(a));
};

const addCandidate = (map, barcodeRaw, sourceMeta) => {
  const barcode = normalizeBarcode(barcodeRaw);
  if (!barcode) return;
  if (barcode === "00000000000000" || barcode === "99999999999999") return;
  const existing = map.get(barcode);
  if (existing) {
    if (!existing.region && sourceMeta.region) existing.region = sourceMeta.region;
    if (!existing.sourceUrl && sourceMeta.sourceUrl) existing.sourceUrl = sourceMeta.sourceUrl;
    if (sourceMeta.origin) existing.origins.add(sourceMeta.origin);
    if (sourceMeta.weight) existing.weight += sourceMeta.weight;
    return;
  }
  map.set(barcode, {
    barcode,
    region: sourceMeta.region ?? "US",
    sourceUrl: sourceMeta.sourceUrl ?? "probe_seed",
    origins: new Set(sourceMeta.origin ? [sourceMeta.origin] : []),
    weight: sourceMeta.weight ?? 1,
  });
};

const collectSeedCandidates = async () => {
  const candidateMap = new Map();

  const fetchJsonWithTimeout = async (url, timeoutMs) => {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), timeoutMs);
    try {
      const response = await fetch(url, { signal: ctrl.signal });
      if (!response.ok) return null;
      return await response.json();
    } catch {
      return null;
    } finally {
      clearTimeout(timer);
    }
  };

  const webFixture = await maybeReadJson(path.join(FIXTURE_DIR, "web_only_barcodes.json"));
  if (Array.isArray(webFixture)) {
    for (const row of webFixture) {
      addCandidate(candidateMap, row?.barcode, {
        region: row?.region ?? "US",
        sourceUrl: row?.sourceUrl ?? "fixtures/web_only_barcodes.json",
        origin: "fixture:web_only_barcodes",
        weight: 8,
      });
    }
  }

  const manualProbeFixture = await maybeReadJson(path.join(FIXTURE_DIR, "web_probe_manual_candidates.json"));
  if (Array.isArray(manualProbeFixture)) {
    for (const row of manualProbeFixture) {
      addCandidate(candidateMap, row?.barcode, {
        region: row?.region ?? "US",
        sourceUrl: row?.sourceUrl ?? "fixtures/web_probe_manual_candidates.json",
        origin: "fixture:web_probe_manual_candidates",
        weight: MANUAL_FIXTURE_WEIGHT,
      });
    }
  }

  const fixed50Fixture = await maybeReadJson(path.join(FIXTURE_DIR, "stage3a_fixed50.json"));
  if (Array.isArray(fixed50Fixture)) {
    for (const row of fixed50Fixture) {
      if (row?.expectedSourceType !== "web") continue;
      addCandidate(candidateMap, row?.barcode, {
        region: row?.region ?? "US",
        sourceUrl: row?.sourceUrl ?? "fixtures/stage3a_fixed50.json",
        origin: "fixture:stage3a_fixed50",
        weight: 4,
      });
    }
  }

  const outputDirs = await listOutputDirs();
  for (const dir of outputDirs) {
    // eslint-disable-next-line no-await-in-loop
    const harvested = await maybeReadJson(path.join(dir, "harvested_barcodes.json"));
    if (harvested && typeof harvested === "object") {
      for (const row of harvested.ca ?? []) {
        addCandidate(candidateMap, row?.barcode, {
          region: "CA",
          sourceUrl: row?.productUrl ?? row?.sourceUrl ?? `${path.basename(dir)}:harvested`,
          origin: `harvest:${path.basename(dir)}`,
          weight: 3,
        });
      }
      for (const row of harvested.us ?? []) {
        addCandidate(candidateMap, row?.barcode, {
          region: "US",
          sourceUrl: row?.productUrl ?? row?.sourceUrl ?? `${path.basename(dir)}:harvested`,
          origin: `harvest:${path.basename(dir)}`,
          weight: 3,
        });
      }
    }

    // eslint-disable-next-line no-await-in-loop
    const generated = await maybeReadJson(path.join(dir, "web_only_barcodes.generated.json"));
    if (Array.isArray(generated)) {
      for (const row of generated) {
        addCandidate(candidateMap, row?.barcode, {
          region: row?.region ?? "US",
          sourceUrl: row?.sourceUrl ?? `${path.basename(dir)}:generated`,
          origin: `generated:${path.basename(dir)}`,
          weight: 3,
        });
      }
    }

    // eslint-disable-next-line no-await-in-loop
    const e2eRows = await maybeReadJson(path.join(dir, "e2e_results.json"));
    if (Array.isArray(e2eRows)) {
      for (const row of e2eRows) {
        const barcode = row?.input?.barcode ?? row?.barcode ?? null;
        const sourceType = row?.sse?.sourceType ?? null;
        const expectedSourceType = row?.input?.expectedSourceType ?? null;
        if (sourceType !== "web" && expectedSourceType !== "web") continue;
        const weight = sourceType === "web" ? 6 : 2;
        addCandidate(candidateMap, barcode, {
          region: row?.input?.region ?? "US",
          sourceUrl: row?.input?.sourceUrl ?? `${path.basename(dir)}:e2e`,
          origin: `e2e:${path.basename(dir)}:${sourceType ?? "unknown"}`,
          weight,
        });
      }
    }
  }

  if (ENABLE_OFF_DISCOVERY && OFF_DISCOVERY_LIMIT > 0) {
    let discovered = 0;
    for (let page = 1; page <= OFF_DISCOVERY_PAGES && discovered < OFF_DISCOVERY_LIMIT; page += 1) {
      // Prefer supplement category pages so discovered barcodes better match this probe's target domain.
      // Keep the legacy generic search endpoint as fallback for resiliency.
      const offUrls = [
        `https://world.openfoodfacts.org/facets/categories/food-supplements/${page}.json`,
        `https://world.openfoodfacts.org/cgi/search.pl?search_simple=1&action=process&json=1&page_size=100&page=${page}`,
      ];
      let payload = null;
      for (const url of offUrls) {
        // eslint-disable-next-line no-await-in-loop
        payload = await fetchJsonWithTimeout(url, OFF_FETCH_TIMEOUT_MS);
        if (payload && Array.isArray(payload.products) && payload.products.length > 0) break;
      }
      const products = Array.isArray(payload?.products) ? payload.products : [];
      for (const product of products) {
        if (discovered >= OFF_DISCOVERY_LIMIT) break;
        const barcode = normalizeBarcode(product?.code);
        if (!barcode) continue;
        addCandidate(candidateMap, barcode, {
          region: "US",
          sourceUrl: "openfoodfacts.org",
          origin: `off:supplements:page${page}`,
          weight: 1,
        });
        discovered += 1;
      }
    }
  }

  const seeds = [...candidateMap.values()]
    .sort((a, b) => {
      if (b.weight !== a.weight) return b.weight - a.weight;
      return a.barcode.localeCompare(b.barcode);
    })
    .slice(0, CANDIDATE_LIMIT)
    .map((item) => ({
      barcode: item.barcode,
      region: item.region,
      sourceUrl: item.sourceUrl,
      origins: [...item.origins].sort(),
      weight: item.weight,
    }));

  return seeds;
};

const pickString = (...values) => {
  for (const value of values) {
    if (typeof value !== "string") continue;
    const trimmed = value.trim();
    if (trimmed) return trimmed;
  }
  return null;
};

const fetchWithTimeout = async (url, options, timeoutMs) => {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    return await fetch(url, { ...options, signal: ctrl.signal });
  } finally {
    clearTimeout(timer);
  }
};

const runReadOnlyPreflight = async () => {
  if (!PRECHECK_ENABLED) {
    return {
      healthy: true,
      reason: "precheck_disabled",
      status: null,
      url: null,
      skipped: true,
    };
  }
  precheckCounter += 1;
  if (PRECHECK_INTERVAL > 1 && lastHealthyPrecheck && precheckCounter % PRECHECK_INTERVAL !== 0) {
    return {
      healthy: true,
      reason: "precheck_cached",
      status: lastHealthyPrecheck.status,
      url: lastHealthyPrecheck.url,
      skipped: true,
    };
  }
  for (const url of PRECHECK_URLS) {
    try {
      // eslint-disable-next-line no-await-in-loop
      const response = await fetchWithTimeout(
        url,
        {
          method: "GET",
          headers: PRECHECK_HEADERS,
        },
        PRECHECK_TIMEOUT_MS,
      );
      if (response.status > 0 && response.status < 500) {
        lastHealthyPrecheck = {
          status: response.status,
          url,
        };
        return {
          healthy: true,
          reason: null,
          status: response.status,
          url,
          skipped: false,
        };
      }
    } catch (error) {
      const reason =
        error?.name === "AbortError"
          ? "preflight_timeout"
          : (error instanceof Error ? error.message : "preflight_fetch_failed");
      void reason;
      // eslint-disable-next-line no-continue
      continue;
    }
  }
  lastHealthyPrecheck = null;
  return {
    healthy: false,
    reason: "preflight_unhealthy",
    status: null,
    url: PRECHECK_URLS[0],
    skipped: false,
  };
};

const sleep = (ms) =>
  new Promise((resolve) => {
    setTimeout(resolve, ms);
  });

const parseSseStream = async (responseBody, options) => {
  const reader = responseBody?.getReader();
  if (!reader) {
    return {
      doneSeen: false,
      rev1Seen: false,
      sourceType: null,
      terminalCode: null,
      errorReasonCode: null,
      fallbackReason: null,
      authorityFailureReason: null,
      timedOut: false,
      abortError: false,
      lastEventType: null,
      lastEventAtMs: null,
      revision1Ms: null,
    };
  }

  const start = performance.now();
  const decoder = new TextDecoder();
  let buffer = "";
  let currentEvent = null;
  let currentData = "";
  let doneSeen = false;
  let rev1Seen = false;
  let terminalCode = null;
  let errorReasonCode = null;
  let sourceType = null;
  let fallbackReason = null;
  let authorityFailureReason = null;
  let revision1Ms = null;
  let lastEventType = null;
  let lastEventAtMs = null;
  let stopAfterMs = null;

  const flush = () => {
    if (!currentEvent) return;
    const tMs = Math.round(performance.now() - start);
    const raw = currentData.trim();
    let payload = raw;
    if (raw) {
      try {
        payload = JSON.parse(raw);
      } catch {
        payload = raw;
      }
    }
    lastEventType = currentEvent;
    lastEventAtMs = tMs;

    if (currentEvent === "analysis_bundle" && payload && typeof payload === "object") {
      const meta = payload?.meta ?? {};
      const revision = Number(meta?.revision);
      const isRevision1OrNewer = Number.isFinite(revision) && revision >= 1;
      // Keep sourceType semantics aligned with website-e2e: only trust rev1+ metadata.
      if (isRevision1OrNewer) {
        sourceType = pickString(meta?.sourceType, sourceType);
      }
      fallbackReason = pickString(meta?.fallbackReason, fallbackReason);
      authorityFailureReason = pickString(meta?.authorityFailureReason, authorityFailureReason);
      if (!rev1Seen && isRevision1OrNewer) {
        rev1Seen = true;
        revision1Ms = tMs;
        stopAfterMs = tMs + options.stopTailMs;
      }
    }

    if (currentEvent === "error" && payload && typeof payload === "object") {
      terminalCode = pickString(payload?.code, terminalCode, "ERROR");
      errorReasonCode = pickString(payload?.reasonCode, errorReasonCode);
      authorityFailureReason = pickString(payload?.authorityFailureReason, authorityFailureReason);
    }

    if (currentEvent === "done") {
      doneSeen = true;
      terminalCode = terminalCode || "DONE";
    }

    currentEvent = null;
    currentData = "";
  };

  while (true) {
    // eslint-disable-next-line no-await-in-loop
    const { value, done } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split(/\r?\n/);
    buffer = lines.pop() || "";
    for (const line of lines) {
      if (!line.trim()) {
        flush();
        if (doneSeen) break;
        continue;
      }
      if (line.startsWith("event:")) currentEvent = line.slice(6).trim();
      if (line.startsWith("data:")) currentData += line.slice(5).trim();
    }
    if (doneSeen) break;
    if (stopAfterMs !== null) {
      const elapsed = Math.round(performance.now() - start);
      if (elapsed >= stopAfterMs) {
        await reader.cancel().catch(() => undefined);
        break;
      }
    }
  }
  flush();

  return {
    doneSeen,
    rev1Seen,
    sourceType,
    terminalCode,
    errorReasonCode,
    fallbackReason,
    authorityFailureReason,
    timedOut: false,
    abortError: false,
    lastEventType,
    lastEventAtMs,
    revision1Ms,
  };
};

const headers = {
  "content-type": "application/json",
  accept: "text/event-stream",
};
if (REGRESSION_TOKEN) {
  headers["x-regression-token"] = REGRESSION_TOKEN;
  headers["x-regression-debug"] = "1";
}
if (AUTH_DISABLED_HEADER) {
  headers["x-auth-disabled"] = AUTH_DISABLED_HEADER;
}

const probeCandidateOnce = async (candidate) => {
  const preflight = await runReadOnlyPreflight();
  if (!preflight.healthy) {
    return {
      barcode: candidate.barcode,
      region: candidate.region ?? "US",
      httpStatus: null,
      doneSeen: false,
      rev1Seen: false,
      sourceType: null,
      terminalCode: null,
      errorReasonCode: "preflight_unhealthy",
      fallbackReason: null,
      authorityFailureReason: null,
      timedOut: false,
      abortError: false,
      stableBundleHit: false,
      stableTerminalHit: false,
      preflightHealthy: false,
      preflightReason: preflight.reason,
      preflightStatus: preflight.status,
      preflightUrl: preflight.url,
      preflightSkipped: preflight.skipped,
      preflightUnhealthy: true,
    };
  }

  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), SSE_TIMEOUT_MS);
  try {
    const response = await fetch(`${API_BASE_TRIMMED}/api/enrich-stream`, {
      method: "POST",
      headers,
      body: JSON.stringify({ barcode: candidate.barcode, streamMode: "analysis_bundle_only" }),
      signal: ctrl.signal,
    });
    if (!response.ok) {
      return {
        barcode: candidate.barcode,
        region: candidate.region ?? "US",
        httpStatus: response.status,
        doneSeen: false,
        rev1Seen: false,
        sourceType: null,
        terminalCode: null,
        errorReasonCode: `HTTP_${response.status}`,
        fallbackReason: null,
        authorityFailureReason: null,
        timedOut: false,
        abortError: false,
        stableBundleHit: false,
        stableTerminalHit: false,
        preflightHealthy: true,
        preflightReason: preflight.reason,
        preflightStatus: preflight.status,
        preflightUrl: preflight.url,
        preflightSkipped: preflight.skipped,
        preflightUnhealthy: false,
      };
    }
    const parsed = await parseSseStream(response.body, { stopTailMs: STOP_TAIL_MS });
    const hardError = Boolean(parsed.terminalCode && parsed.terminalCode !== "DONE");
    const stableBundleHit =
      parsed.sourceType === "web" &&
      parsed.rev1Seen &&
      parsed.doneSeen &&
      !parsed.timedOut &&
      !parsed.abortError &&
      !hardError;
    const stableTerminalHit =
      parsed.sourceType === "web" &&
      parsed.doneSeen &&
      !parsed.timedOut &&
      !parsed.abortError;
    return {
      barcode: candidate.barcode,
      region: candidate.region ?? "US",
      httpStatus: response.status,
      ...parsed,
      stableBundleHit,
      stableTerminalHit,
      preflightHealthy: true,
      preflightReason: preflight.reason,
      preflightStatus: preflight.status,
      preflightUrl: preflight.url,
      preflightSkipped: preflight.skipped,
      preflightUnhealthy: false,
    };
  } catch (error) {
    const abortError = error?.name === "AbortError";
    return {
      barcode: candidate.barcode,
      region: candidate.region ?? "US",
      httpStatus: null,
      doneSeen: false,
      rev1Seen: false,
      sourceType: null,
      terminalCode: null,
      errorReasonCode: abortError ? "AbortError" : "request_failed",
      fallbackReason: null,
      authorityFailureReason: null,
      timedOut: abortError,
      abortError,
      stableBundleHit: false,
      stableTerminalHit: false,
      preflightHealthy: true,
      preflightReason: preflight.reason,
      preflightStatus: preflight.status,
      preflightUrl: preflight.url,
      preflightSkipped: preflight.skipped,
      preflightUnhealthy: false,
    };
  } finally {
    clearTimeout(timer);
  }
};

const isRetryableProbeResult = (result) => {
  if (!result || typeof result !== "object") return false;
  if (result.preflightUnhealthy) return true;
  if (result.timedOut || result.abortError) return true;
  if (result.httpStatus === 429 || (Number.isFinite(result.httpStatus) && result.httpStatus >= 500)) return true;
  const terminalCode = pickString(result.terminalCode)?.toUpperCase() ?? "";
  if (terminalCode === "STREAM_BUSY") return true;
  const reasonCode = pickString(result.errorReasonCode)?.toUpperCase() ?? "";
  if (reasonCode === "REQUEST_FAILED" || reasonCode === "ABORTERROR" || reasonCode === "QUEUE_WAIT_TIMEOUT" || reasonCode === "QUEUE_FULL") {
    return true;
  }
  if (!result.doneSeen && !result.rev1Seen && !terminalCode) return true;
  return false;
};

const probeCandidate = async (candidate) => {
  let last = null;
  for (let attempt = 1; attempt <= PROBE_RETRIES + 1; attempt += 1) {
    // eslint-disable-next-line no-await-in-loop
    last = await probeCandidateOnce(candidate);
    if (!isRetryableProbeResult(last) || attempt > PROBE_RETRIES) {
      return {
        ...last,
        attempts: attempt,
      };
    }
    const rawBackoff = Math.min(PROBE_RETRY_MAX_MS, PROBE_RETRY_BASE_MS * 2 ** (attempt - 1));
    const baseBackoff = last.preflightUnhealthy
      ? Math.max(rawBackoff, PRECHECK_UNHEALTHY_BACKOFF_MS)
      : rawBackoff;
    const jitter = Math.max(0, Math.round(baseBackoff * (0.75 + Math.random() * 0.5)));
    // eslint-disable-next-line no-await-in-loop
    await sleep(jitter);
  }
  return {
    ...last,
    attempts: PROBE_RETRIES + 1,
  };
};

const runWithConcurrency = async (items, concurrency, worker) => {
  const results = new Array(items.length);
  let cursor = 0;
  const workers = Array.from({ length: Math.min(concurrency, items.length) }, async () => {
    while (true) {
      const index = cursor;
      cursor += 1;
      if (index >= items.length) return;
      // eslint-disable-next-line no-await-in-loop
      results[index] = await worker(items[index], index);
    }
  });
  await Promise.all(workers);
  return results;
};

const safeRate = (part, total) => (total > 0 ? part / total : 0);

const main = async () => {
  const candidates = await collectSeedCandidates();
  if (candidates.length === 0) {
    throw new Error("No seed candidates found. Run website harvest first.");
  }

  const statsMap = new Map();
  const updateStats = (result) => {
    const current = statsMap.get(result.barcode) ?? {
      barcode: result.barcode,
      region: result.region ?? "US",
      observed: 0,
      webHits: 0,
      doneHits: 0,
      rev1Hits: 0,
      stableBundleHits: 0,
      stableTerminalHits: 0,
      hardErrorHits: 0,
      timeoutHits: 0,
      preflightUnhealthyHits: 0,
      preflightChecks: 0,
      attemptsTotal: 0,
      fallbackReasons: new Map(),
      authorityFailureReasons: new Map(),
      sourceTypes: new Map(),
    };
    current.observed += 1;
    if (result.preflightSkipped === false) current.preflightChecks += 1;
    if (result.preflightUnhealthy) current.preflightUnhealthyHits += 1;
    if (result.sourceType === "web") current.webHits += 1;
    if (result.doneSeen) current.doneHits += 1;
    if (result.rev1Seen) current.rev1Hits += 1;
    if (result.stableBundleHit) current.stableBundleHits += 1;
    if (result.stableTerminalHit) current.stableTerminalHits += 1;
    if (result.timedOut || result.abortError) current.timeoutHits += 1;
    current.attemptsTotal += Math.max(1, Number(result.attempts ?? 1));
    if (result.terminalCode && result.terminalCode !== "DONE") current.hardErrorHits += 1;
    if (result.sourceType) {
      current.sourceTypes.set(result.sourceType, (current.sourceTypes.get(result.sourceType) ?? 0) + 1);
    }
    if (result.fallbackReason) {
      current.fallbackReasons.set(
        result.fallbackReason,
        (current.fallbackReasons.get(result.fallbackReason) ?? 0) + 1,
      );
    }
    if (result.authorityFailureReason) {
      current.authorityFailureReasons.set(
        result.authorityFailureReason,
        (current.authorityFailureReasons.get(result.authorityFailureReason) ?? 0) + 1,
      );
    }
    statsMap.set(result.barcode, current);
  };

  const stableSet = new Set();
  let candidateCursor = 0;
  let progress = 0;
  const totalJobs = candidates.length * ROUNDS;
  let shouldStop = false;
  let stopReason = null;
  let consecutivePreflightUnhealthy = 0;

  const workers = Array.from(
    { length: Math.min(Math.max(1, CONCURRENCY), candidates.length) },
    async () => {
      while (true) {
        if (shouldStop) return;
        const candidateIndex = candidateCursor;
        candidateCursor += 1;
        if (candidateIndex >= candidates.length) return;
        const candidate = candidates[candidateIndex];
        let candidateStable = true;
        for (let round = 1; round <= ROUNDS; round += 1) {
          progress += 1;
          console.log(
            `[web-probe-pool] probe ${progress}/${totalJobs} barcode=${candidate.barcode} round=${round}/${ROUNDS}`,
          );
          // eslint-disable-next-line no-await-in-loop
          const result = await probeCandidate(candidate);
          updateStats(result);
          if (result.preflightUnhealthy) {
            consecutivePreflightUnhealthy += 1;
            if (consecutivePreflightUnhealthy >= PRECHECK_ABORT_STREAK) {
              stopReason = `preflight_unhealthy_streak_${consecutivePreflightUnhealthy}`;
              shouldStop = true;
              break;
            }
          } else {
            consecutivePreflightUnhealthy = 0;
          }
          const stableHit = REQUIRE_REV1_STABLE ? result.stableBundleHit : result.stableTerminalHit;
          if (!stableHit) {
            candidateStable = false;
            break;
          }
          if (PROBE_COOLDOWN_MS > 0) {
            // eslint-disable-next-line no-await-in-loop
            await sleep(PROBE_COOLDOWN_MS);
          }
        }
        if (candidateStable) {
          stableSet.add(candidate.barcode);
          if (stableSet.size >= TARGET) {
            shouldStop = true;
            return;
          }
        }
      }
    },
  );
  await Promise.all(workers);

  const rows = candidates.map((candidate) => {
    const stats = statsMap.get(candidate.barcode);
    const observed = stats?.observed ?? 0;
    const webRate = safeRate(stats?.webHits ?? 0, observed);
    const doneRate = safeRate(stats?.doneHits ?? 0, observed);
    const stableBundleRate = safeRate(stats?.stableBundleHits ?? 0, observed);
    const stableTerminalRate = safeRate(stats?.stableTerminalHits ?? 0, observed);
    const stableRate = REQUIRE_REV1_STABLE ? stableBundleRate : stableTerminalRate;
    const maxHardErrorRate = REQUIRE_REV1_STABLE ? MAX_HARD_ERROR_RATE : MAX_HARD_ERROR_RATE_TERMINAL;
    const hardErrorRate = safeRate(stats?.hardErrorHits ?? 0, observed);
    const stable =
      observed >= ROUNDS &&
      webRate >= MIN_WEB_RATE &&
      doneRate >= MIN_DONE_RATE &&
      stableRate >= MIN_STABLE_RATE &&
      hardErrorRate <= maxHardErrorRate;
    return {
      barcode: candidate.barcode,
      region: candidate.region ?? "US",
      sourceUrl: candidate.sourceUrl ?? "probe_seed",
      origins: candidate.origins,
      weight: candidate.weight,
      observed,
      webHits: stats?.webHits ?? 0,
      doneHits: stats?.doneHits ?? 0,
      rev1Hits: stats?.rev1Hits ?? 0,
      stableBundleHits: stats?.stableBundleHits ?? 0,
      stableTerminalHits: stats?.stableTerminalHits ?? 0,
      timeoutHits: stats?.timeoutHits ?? 0,
      preflightUnhealthyHits: stats?.preflightUnhealthyHits ?? 0,
      preflightChecks: stats?.preflightChecks ?? 0,
      hardErrorHits: stats?.hardErrorHits ?? 0,
      attemptsAvg: observed > 0 ? (stats?.attemptsTotal ?? observed) / observed : 0,
      webRate,
      doneRate,
      stableBundleRate,
      stableTerminalRate,
      stableRate,
      hardErrorRate,
      sourceTypes: Object.fromEntries([...(stats?.sourceTypes ?? new Map()).entries()]),
      fallbackReasons: Object.fromEntries([...(stats?.fallbackReasons ?? new Map()).entries()]),
      authorityFailureReasons: Object.fromEntries([...(stats?.authorityFailureReasons ?? new Map()).entries()]),
      stable,
    };
  });

  const stableRows = rows
    .filter((row) => row.stable)
    .sort((a, b) => {
      if (b.stableRate !== a.stableRate) return b.stableRate - a.stableRate;
      if (b.doneRate !== a.doneRate) return b.doneRate - a.doneRate;
      if (b.webRate !== a.webRate) return b.webRate - a.webRate;
      if (b.weight !== a.weight) return b.weight - a.weight;
      return a.barcode.localeCompare(b.barcode);
    });

  const selected = stableRows.slice(0, TARGET).map((row) => ({
    barcode: row.barcode,
    region: row.region,
    expectedSourceType: "web",
    expectedScoreAvailable: false,
    verifiedAt: todayIso(),
    sourceUrl: row.sourceUrl || "web_probe_pool",
    notes:
      `probe_pool stable=${REQUIRE_REV1_STABLE ? row.stableBundleHits : row.stableTerminalHits}/${row.observed} ` +
      `quality=${row.stableBundleHits > 0 ? "bundle" : "terminal_only"} ` +
      `webRate=${row.webRate.toFixed(2)} doneRate=${row.doneRate.toFixed(2)} ` +
      `fallbackTop=${Object.entries(row.fallbackReasons).sort((a, b) => b[1] - a[1])[0]?.[0] ?? "none"}`,
  }));

  const report = {
    generatedAt: new Date().toISOString(),
    apiBaseUrl: API_BASE_URL,
    target: TARGET,
    rounds: ROUNDS,
    concurrency: CONCURRENCY,
    retries: PROBE_RETRIES,
    retryBaseMs: PROBE_RETRY_BASE_MS,
    retryMaxMs: PROBE_RETRY_MAX_MS,
    candidateLimit: CANDIDATE_LIMIT,
    precheck: {
      enabled: PRECHECK_ENABLED,
      interval: PRECHECK_INTERVAL,
      timeoutMs: PRECHECK_TIMEOUT_MS,
      unhealthyBackoffMs: PRECHECK_UNHEALTHY_BACKOFF_MS,
      abortStreak: PRECHECK_ABORT_STREAK,
      cooldownMs: PROBE_COOLDOWN_MS,
    },
    thresholds: {
      minWebRate: MIN_WEB_RATE,
      minDoneRate: MIN_DONE_RATE,
      minStableRate: MIN_STABLE_RATE,
      maxHardErrorRate: MAX_HARD_ERROR_RATE,
      maxHardErrorRateTerminal: MAX_HARD_ERROR_RATE_TERMINAL,
      requireRev1Stable: REQUIRE_REV1_STABLE,
    },
    counts: {
      candidates: candidates.length,
      stable: stableRows.length,
      selected: selected.length,
    },
    stopReason,
    selectedBarcodes: selected.map((row) => row.barcode),
    stableRows,
    allRows: rows,
  };

  await fs.promises.mkdir(FIXTURE_DIR, { recursive: true });
  if (selected.length >= TARGET) {
    await fs.promises.writeFile(OUT_POOL_PATH, JSON.stringify(selected, null, 2), "utf8");
    if (WRITE_PARTIAL_ON_FAIL) {
      await fs.promises.rm(OUT_POOL_PARTIAL_PATH, { force: true });
    }
  } else if (WRITE_PARTIAL_ON_FAIL) {
    await fs.promises.writeFile(OUT_POOL_PARTIAL_PATH, JSON.stringify(selected, null, 2), "utf8");
  }
  await fs.promises.writeFile(OUT_REPORT_PATH, JSON.stringify(report, null, 2), "utf8");

  if (selected.length >= TARGET) {
    console.log(`[web-probe-pool] wrote ${OUT_POOL_PATH}`);
  } else if (WRITE_PARTIAL_ON_FAIL) {
    console.warn(`[web-probe-pool] target unmet; preserved ${OUT_POOL_PATH}, wrote partial ${OUT_POOL_PARTIAL_PATH}`);
  } else {
    console.warn(`[web-probe-pool] target unmet; preserved ${OUT_POOL_PATH}`);
  }
  console.log(`[web-probe-pool] wrote ${OUT_REPORT_PATH}`);
  console.log(`[web-probe-pool] stable=${stableRows.length}, selected=${selected.length}, target=${TARGET}`);

  if (selected.length < TARGET) {
    throw new Error(
      `Only selected ${selected.length}/${TARGET} stable unique web barcodes (stopReason=${stopReason ?? "none"}). Run more harvest rounds or relax thresholds.`,
    );
  }
};

main().catch((error) => {
  console.error("[web-probe-pool] failed:", error);
  process.exit(1);
});
