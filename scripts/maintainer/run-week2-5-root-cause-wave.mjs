#!/usr/bin/env node
/* eslint-disable no-console */
import fs from "node:fs/promises";
import path from "node:path";
import { execFileSync } from "node:child_process";

import {
  buildOverlayRecordKey,
  buildPatchStrategy,
  classifyOverlayStatus,
  deriveCompleteness,
  extractOverlayRecordFromSeedRow,
  mergeOverlayRecords,
  normalizeText as normalizeOverlayText,
  qualifiesHighConfidenceUsProductPage,
  stableHash,
  toGtin14,
} from "./lib/iherb-overlay-utils.mjs";

const ROOT = process.cwd();
const args = process.argv.slice(2);

const getArg = (name, fallback = null) => {
  const flag = `--${name}`;
  const idx = args.indexOf(flag);
  if (idx === -1 || idx + 1 >= args.length) return fallback;
  return args[idx + 1];
};

const BASELINE_STAGING_PATH = getArg(
  "baseline-staging-json",
  path.join(ROOT, "output", "week2_5_root_cause", "now_retarget_20260314T082518Z", "staging_products.official_refreshed.json"),
);
const BASELINE_MERGE_REPORT_PATH = getArg(
  "baseline-merge-report-json",
  path.join(ROOT, "output", "iherb_overlay_bulk_merge_week2_5_now_retarget_20260314T082518Z", "overlay_merge_coverage_report.json"),
);
const BASELINE_EXECUTION_PLAN_PATH = getArg(
  "baseline-execution-plan-json",
  path.join(ROOT, "output", "iherb_overlay_execution_plan_week2_5_now_retarget_20260314T082518Z", "execution_plan_summary.json"),
);
const BASELINE_HIGH_FREQUENCY_PATH = getArg(
  "baseline-high-frequency-json",
  path.join(ROOT, "output", "iherb_overlay_high_frequency_validation_week2_5_now_retarget_20260314T082518Z", "high_frequency_hit_validation.json"),
);
const BASELINE_PARTIAL_WAVE_PLAN_PATH = getArg(
  "baseline-partial-wave-plan-json",
  path.join(ROOT, "output", "iherb_partial_wave_plan_week2_5_now_retarget_20260314T082518Z", "partial_wave_plan_summary.json"),
);
const GAP_BREAKDOWN_PATH = getArg(
  "gap-breakdown-json",
  path.join(ROOT, "output", "high_frequency_remaining_gap_breakdown.json"),
);
const GAP_QUEUE_DIR = getArg(
  "gap-queue-dir",
  path.join(ROOT, "output", "high_frequency_remaining_gap_breakdown_queues"),
);
const PREVIOUS_KPI_REPORT_PATH = getArg("previous-kpi-report-json", path.join(ROOT, "output", "identity_recovery_root_cause_report.json"));
const NOW_QUEUE_PATH = getArg("now-queue-json", path.join(ROOT, "output", "iherb_partial_wave_plan_week2_5_now_retarget_20260314T082518Z", "official_brand_queues", "now-foods.json"));
const PREVIOUS_NOW_RETARGET_REPORT_PATH = getArg(
  "previous-now-retarget-report-json",
  path.join(ROOT, "output", "week2_5_root_cause", "now_retarget_20260314T082518Z", "official_fallback_report.json"),
);
const NOW_CONFIG_PATH = getArg(
  "now-config-json",
  path.join(ROOT, "data", "iherb_official_fallback_configs", "now-foods.json"),
);
const CONFIG_DIR = getArg("config-dir", path.join(ROOT, "data", "iherb_official_fallback_configs"));
const OUT_DIR = getArg("out-dir", path.join(ROOT, "output", "week2_5_root_cause"));
const OUTPUT_DIR = getArg("output-dir", path.join(ROOT, "output"));
const ACTIVE_CANONICAL_DIR = getArg(
  "canonical-dir",
  path.join(ROOT, "docs", "exec-plans", "active", "week2_5"),
);
const HISTORY_CANONICAL_DIR = getArg(
  "history-canonical-dir",
  path.join(ROOT, "docs", "exec-plans", "history", "week2_5"),
);
const OUTPUT_WAVES_DIR = getArg("waves-dir", path.join(ROOT, "output", "waves"));
const READER_PREFIX = getArg("reader-prefix", "https://r.jina.ai/http://");
const REQUEST_TIMEOUT_MS = Number(getArg("request-timeout-ms", 3000)) || 3000;
const REMEDIATION_REQUEST_TIMEOUT_MS = Number(getArg("remediation-request-timeout-ms", 20000)) || 20000;
const FETCH_RETRY_LIMIT = Number(getArg("fetch-retry-limit", 2)) || 2;
const FETCH_BACKOFF_MS = Number(getArg("fetch-backoff-ms", 1500)) || 1500;
const DISCOVERY_COMPARE_QUERY_LIMIT = Number(getArg("discovery-compare-query-limit", 2)) || 2;
const DISCOVERY_COMPARE_FALLBACK_QUERY_LIMIT = Number(getArg("discovery-compare-fallback-query-limit", 1)) || 1;
const DISCOVERY_COMPARE_CANDIDATE_LIMIT = Number(getArg("discovery-compare-candidate-limit", 2)) || 2;
const BRAVE_SEARCH_ENABLED = getArg("search-engine-fallback", "true") !== "false";
const USE_SITEMAP = getArg("use-sitemap", "false") === "true";
const IDENTITY_CANARY_SIZE = Number(getArg("identity-canary-size", 8)) || 8;
const POSITIVE_CONTROL_SIZE = Number(getArg("positive-control-size", 8)) || 8;
const NOW_RETARGET_LIMIT = Number(getArg("now-retarget-limit", 12)) || 12;

const WAVE_TS = new Date().toISOString().replace(/[-:]/g, "").replace(/\.\d{3}Z$/, "Z");
const POSITIVE_CONTROL_WAVE_ID = `week2_5_discovery_source_compare_${WAVE_TS}`;
const POSITIVE_CONTROL_RERUN_WAVE_ID = `week2_5_discovery_positive_control_rerun_${WAVE_TS}`;
const MICRO_CANARY_WAVE_ID = `week2_5_identity_micro_canary_${WAVE_TS}`;
const COVERAGE_WAVE_ID = `week2_5_coverage_now_light_${WAVE_TS}`;

const POSITIVE_CONTROL_HISTORY_MANIFEST_PATH = path.join(OUTPUT_WAVES_DIR, `${POSITIVE_CONTROL_WAVE_ID}_manifest.json`);
const POSITIVE_CONTROL_HISTORY_RESULT_PATH = path.join(OUTPUT_WAVES_DIR, `${POSITIVE_CONTROL_WAVE_ID}_result.json`);
const POSITIVE_CONTROL_RERUN_HISTORY_MANIFEST_PATH = path.join(OUTPUT_WAVES_DIR, `${POSITIVE_CONTROL_RERUN_WAVE_ID}_manifest.json`);
const POSITIVE_CONTROL_RERUN_HISTORY_RESULT_PATH = path.join(OUTPUT_WAVES_DIR, `${POSITIVE_CONTROL_RERUN_WAVE_ID}_result.json`);
const MICRO_CANARY_HISTORY_MANIFEST_PATH = path.join(OUTPUT_WAVES_DIR, `${MICRO_CANARY_WAVE_ID}_manifest.json`);
const MICRO_CANARY_HISTORY_RESULT_PATH = path.join(OUTPUT_WAVES_DIR, `${MICRO_CANARY_WAVE_ID}_result.json`);
const COVERAGE_HISTORY_MANIFEST_PATH = path.join(OUTPUT_WAVES_DIR, `${COVERAGE_WAVE_ID}_manifest.json`);
const COVERAGE_HISTORY_RESULT_PATH = path.join(OUTPUT_WAVES_DIR, `${COVERAGE_WAVE_ID}_result.json`);
const CURRENT_MANIFEST_PATH = path.join(OUTPUT_DIR, "wave_manifest_current.json");
const CURRENT_RESULT_PATH = path.join(OUTPUT_DIR, "wave_result_current.json");
const ROOT_CAUSE_REPORT_JSON_PATH = path.join(OUTPUT_DIR, "identity_recovery_root_cause_report.json");
const ROOT_CAUSE_REPORT_MD_PATH = path.join(OUTPUT_DIR, "identity_recovery_root_cause_report.md");
const POSITIVE_CONTROL_DEBUG_JSON_PATH = path.join(OUTPUT_DIR, "identity_positive_control_debug.json");
const POSITIVE_CONTROL_DEBUG_MD_PATH = path.join(OUTPUT_DIR, "identity_positive_control_debug.md");
const DISCOVERY_SOURCE_COMPARISON_JSON_PATH = path.join(OUTPUT_DIR, "discovery_source_comparison.json");
const DISCOVERY_SOURCE_COMPARISON_MD_PATH = path.join(OUTPUT_DIR, "discovery_source_comparison.md");
const FETCH_TRACE_POSITIVE_CONTROL_JSON_PATH = path.join(OUTPUT_DIR, "fetch_trace_positive_control.json");
const FETCH_TRACE_POSITIVE_CONTROL_MD_PATH = path.join(OUTPUT_DIR, "fetch_trace_positive_control.md");
const POSITIVE_CONTROL_RERUN_JSON_PATH = path.join(OUTPUT_DIR, "identity_positive_control_rerun.json");
const POSITIVE_CONTROL_RERUN_MD_PATH = path.join(OUTPUT_DIR, "identity_positive_control_rerun.md");
const DISCOVERY_POSITIVE_CONTROL_RERUN_JSON_PATH = path.join(OUTPUT_DIR, "discovery_positive_control_rerun.json");
const DISCOVERY_POSITIVE_CONTROL_RERUN_MD_PATH = path.join(OUTPUT_DIR, "discovery_positive_control_rerun.md");
const FAILURE_LOCUS_JSON_PATH = path.join(OUTPUT_DIR, "identity_lane_failure_locus.json");
const FAILURE_LOCUS_MD_PATH = path.join(OUTPUT_DIR, "identity_lane_failure_locus.md");
const DISCOVERY_SOURCE_FAILURE_LOCUS_JSON_PATH = path.join(OUTPUT_DIR, "discovery_source_failure_locus.json");
const DISCOVERY_SOURCE_FAILURE_LOCUS_MD_PATH = path.join(OUTPUT_DIR, "discovery_source_failure_locus.md");
const MICRO_CANARY_JSON_PATH = path.join(OUTPUT_DIR, "official_fetch_unresolved_micro_canary.json");
const MICRO_CANARY_MD_PATH = path.join(OUTPUT_DIR, "official_fetch_unresolved_micro_canary.md");
const FINAL_SUMMARY_PATH = path.join(OUTPUT_DIR, "week2_5_identity_debug_summary.md");
const FETCH_LANE_SUMMARY_PATH = path.join(OUTPUT_DIR, "week2_5_fetch_lane_remediation_summary.md");
const DISCOVERY_SOURCE_SUMMARY_PATH = path.join(OUTPUT_DIR, "week2_5_discovery_source_remediation_summary.md");
const NO_EXECUTABLE_COVERAGE_BATCH_PATH = path.join(OUTPUT_DIR, "no_executable_coverage_batch.md");

const IDENTITY_BRANDS = ["Healthy Origins", "Pure Encapsulations", "Nature's Bounty", "Schiff"];
const VARIANT_HINT_RE = /\b(gummies?|softgels?|capsules?|tablets?|tea|powder|liquid|twin|pack|flavor|vanilla|chocolate|strawberry|raspberry|chew|probiotic|megared|digestive advantage|move free)\b/i;
const EXHAUSTED_NOW_FAMILY_RE = /\b(better stevia|liquid sweetener|real food|raw nuts?|raw almonds?|raw walnuts?|raw pecans?|sunflower seeds|soy milk powder|nut mix|powder)\b/i;
const PREFERRED_NOW_TITLE_RE = /\b(capsules?|softgels?|tablets?|tea)\b/i;
const TITLE_SENSITIVE_HINT_RE = /\b(alpha lipoic acid|digestive advantage|5-htp|coq-?10|ubiquinol|citicoline|magnesium|vitamin c|omega|probiotic)\b/i;
const BARCODE_SENSITIVE_HINT_RE = /\b(amino-?nr|athletic nutrients|megared|digestive advantage|5-htp|coq-?10|adult multi|b-?12)\b/i;

const readJson = async (filePath) => JSON.parse(await fs.readFile(filePath, "utf8"));
const readOptionalJson = async (filePath) => {
  try {
    return JSON.parse(await fs.readFile(filePath, "utf8"));
  } catch {
    return null;
  }
};
const writeJson = async (filePath, payload) => {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
};
const writeText = async (filePath, text) => {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, text, "utf8");
};
const copyFile = async (sourcePath, targetPath) => {
  await fs.mkdir(path.dirname(targetPath), { recursive: true });
  await fs.copyFile(sourcePath, targetPath);
};
const fileExists = async (filePath) => {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
};

const execNode = (scriptPath, scriptArgs = []) => {
  const output = execFileSync("node", [scriptPath, ...scriptArgs], {
    cwd: ROOT,
    encoding: "utf8",
    maxBuffer: 1024 * 1024 * 16,
    stdio: ["ignore", "pipe", "pipe"],
  });
  return output.trim();
};

const normalizeText = (value) =>
  String(value ?? "")
    .replace(/\u00a0/g, " ")
    .replace(/\s+/g, " ")
    .trim();
const normalizeLower = (value) => normalizeText(value).toLowerCase();
const normalizeDigits = (value) => normalizeText(value).replace(/\D/g, "");
const normalizeBarcode = (value) => toGtin14(value) ?? null;
const slugify = (value) =>
  normalizeLower(value)
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const executionHealth = {
  requests: 0,
  fetchSuccess: 0,
  http429: 0,
  aborted: 0,
  cacheHits: 0,
  retryCount: 0,
};

let FETCH_ADAPTER_MODE = "node_reader";
let DISCOVERY_WAVE_PASS = "default";
let IHERB_SEARCH_EXTRACTION_MODE = "legacy";

const snapshotExecutionHealth = () => ({ ...executionHealth });
const diffExecutionHealth = (before) => ({
  requests: executionHealth.requests - before.requests,
  fetchSuccess: executionHealth.fetchSuccess - before.fetchSuccess,
  http429: executionHealth.http429 - before.http429,
  aborted: executionHealth.aborted - before.aborted,
  cacheHits: executionHealth.cacheHits - before.cacheHits,
  retryCount: executionHealth.retryCount - before.retryCount,
});

const searchCache = new Map();

const setFetchAdapterMode = (mode) => {
  FETCH_ADAPTER_MODE = mode;
};
const setDiscoveryWavePass = (mode) => {
  DISCOVERY_WAVE_PASS = mode;
};
const setIherbSearchExtractionMode = (mode) => {
  IHERB_SEARCH_EXTRACTION_MODE = mode;
};
const buildSearchCacheKey = (prefix, query, namespace = "default") => `${namespace}:${DISCOVERY_WAVE_PASS}:${FETCH_ADAPTER_MODE}:${prefix}:${query}`;

const fetchTextNode = async (targetUrl, label, timeoutMs = REQUEST_TIMEOUT_MS) => {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    executionHealth.requests += 1;
    const response = await fetch(targetUrl, {
      signal: controller.signal,
      headers: {
        Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        "User-Agent": "Mozilla/5.0",
      },
      redirect: "follow",
    });
    const text = await response.text();
    if (response.status === 429) executionHealth.http429 += 1;
    if (response.ok) executionHealth.fetchSuccess += 1;
    return {
      ok: response.ok,
      status: response.status,
      text,
      label,
      requestUrl: targetUrl,
      finalUrl: response.url,
      contentType: response.headers.get("content-type") ?? null,
      contentLength: Number(response.headers.get("content-length") ?? text.length) || text.length,
      redirected: response.redirected,
      retryCount: 0,
      fromCache: false,
      sourceAdapter: "node_reader",
      headers: Object.fromEntries(response.headers.entries()),
    };
  } catch (error) {
    if ((error instanceof Error && error.name === "AbortError") || /abort/i.test(String(error))) {
      executionHealth.aborted += 1;
    }
    return {
      ok: false,
      status: 0,
      text: "",
      label,
      error: error instanceof Error ? error.message : String(error),
      requestUrl: targetUrl,
      finalUrl: null,
      contentType: null,
      contentLength: 0,
      redirected: false,
      retryCount: 0,
      fromCache: false,
      sourceAdapter: "node_reader",
      headers: {},
    };
  } finally {
    clearTimeout(timeout);
  }
};

const fetchTextCurl = async (targetUrl, label, timeoutMs = REQUEST_TIMEOUT_MS) => {
  const timeoutSeconds = Math.max(5, Math.ceil(timeoutMs / 1000));
  const metaSentinel = "__CURL_META__";
  try {
    executionHealth.requests += 1;
    const output = execFileSync(
      "curl",
      [
        "-L",
        "--compressed",
        "--max-time",
        String(timeoutSeconds),
        "-A",
        "Mozilla/5.0",
        "-sS",
        "-o",
        "-",
        "-w",
        `\n${metaSentinel}%{http_code}\t%{content_type}\t%{size_download}\t%{url_effective}\t%{num_redirects}\n`,
        targetUrl,
      ],
      {
        cwd: ROOT,
        encoding: "utf8",
        maxBuffer: 1024 * 1024 * 32,
        stdio: ["ignore", "pipe", "pipe"],
      },
    );
    const sentinelIdx = output.lastIndexOf(`\n${metaSentinel}`);
    const body = sentinelIdx >= 0 ? output.slice(0, sentinelIdx) : output;
    const metaLine = sentinelIdx >= 0 ? output.slice(sentinelIdx + 1 + metaSentinel.length).trim() : "";
    const [httpStatusRaw, contentTypeRaw, contentLengthRaw, finalUrlRaw, redirectsRaw] = metaLine.split("\t");
    const status = Number(httpStatusRaw ?? 0) || 0;
    if (status === 429) executionHealth.http429 += 1;
    if (status >= 200 && status < 400) executionHealth.fetchSuccess += 1;
    return {
      ok: status >= 200 && status < 400,
      status,
      text: body,
      label,
      requestUrl: targetUrl,
      finalUrl: normalizeText(finalUrlRaw) || targetUrl,
      contentType: normalizeText(contentTypeRaw) || null,
      contentLength: Number(contentLengthRaw ?? body.length) || body.length,
      redirected: Number(redirectsRaw ?? 0) > 0,
      retryCount: 0,
      fromCache: false,
      sourceAdapter: "curl_reader",
      headers: {},
    };
  } catch (error) {
    const stderr = error?.stderr ? String(error.stderr) : "";
    const stdout = error?.stdout ? String(error.stdout) : "";
    if (/operation timed out|timed out|abort/i.test(stderr) || /operation timed out|timed out|abort/i.test(stdout)) {
      executionHealth.aborted += 1;
    }
    return {
      ok: false,
      status: /429/.test(stderr) ? 429 : 0,
      text: stdout,
      label,
      error: stderr || (error instanceof Error ? error.message : String(error)),
      requestUrl: targetUrl,
      finalUrl: null,
      contentType: null,
      contentLength: 0,
      redirected: false,
      retryCount: 0,
      fromCache: false,
      sourceAdapter: "curl_reader",
      headers: {},
    };
  }
};

const fetchText = async (targetUrl, label, timeoutMs = REQUEST_TIMEOUT_MS) => {
  let last = null;
  for (let attempt = 1; attempt <= FETCH_RETRY_LIMIT; attempt += 1) {
    const fetched =
      FETCH_ADAPTER_MODE === "curl_reader"
        ? await fetchTextCurl(targetUrl, label, timeoutMs)
        : await fetchTextNode(targetUrl, label, timeoutMs);
    fetched.retryCount = attempt - 1;
    if (fetched.ok && fetched.text) {
      return fetched;
    }
    last = fetched;
    if (attempt < FETCH_RETRY_LIMIT) {
      executionHealth.retryCount += 1;
      await sleep(FETCH_BACKOFF_MS * attempt);
    }
  }
  return last ?? {
    ok: false,
    status: 0,
    text: "",
    label,
    error: "unknown_fetch_failure",
    requestUrl: targetUrl,
    finalUrl: null,
    contentType: null,
    contentLength: 0,
    redirected: false,
    retryCount: FETCH_RETRY_LIMIT - 1,
    fromCache: false,
    sourceAdapter: FETCH_ADAPTER_MODE,
    headers: {},
  };
};

const sitemapXmlPromiseByUrl = new Map();
let sitemapEntriesPromise = null;

const fetchProductSitemapEntries = async () => {
  if (sitemapEntriesPromise) return sitemapEntriesPromise;
  sitemapEntriesPromise = (async () => {
    const indexFetched = await fetchText("https://www.iherb.com/sitemap_index.xml", "iherb-sitemap-index", REQUEST_TIMEOUT_MS);
    if (!indexFetched.ok || !indexFetched.text) return [];
    const sitemapUrls = [...indexFetched.text.matchAll(/<loc>(https:\/\/www\.iherb\.com\/sitemaps\/products-[^<]+\.xml)<\/loc>/g)]
      .map((match) => normalizeText(match[1]))
      .filter(Boolean);
    const entries = [];
    for (const sitemapUrl of sitemapUrls) {
      if (!sitemapXmlPromiseByUrl.has(sitemapUrl)) {
        sitemapXmlPromiseByUrl.set(sitemapUrl, fetchText(sitemapUrl, `iherb-product-sitemap:${path.basename(sitemapUrl)}`, REQUEST_TIMEOUT_MS));
      }
      const fetched = await sitemapXmlPromiseByUrl.get(sitemapUrl);
      if (!fetched.ok || !fetched.text) continue;
      const urls = [...fetched.text.matchAll(/<loc>(https:\/\/www\.iherb\.com\/pr\/[^<]+)<\/loc>/g)]
        .map((match) => normalizeText(match[1]))
        .filter(Boolean);
      for (const url of urls) {
        entries.push({ url, slug: normalizeLower(url) });
      }
    }
    return Object.values(
      entries.reduce((acc, entry) => {
        if (!acc[entry.url]) acc[entry.url] = entry;
        return acc;
      }, {}),
    );
  })();
  return sitemapEntriesPromise;
};

const decodeHtml = (value) =>
  normalizeText(value)
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">");

const buildExpectedSignalFlags = (rawText, row) => {
  const normalizedRaw = normalizeLower(rawText);
  const expectedProductId = normalizeText(row?.expectedProductId ?? row?.productId);
  const expectedBrand = normalizeLower(row?.expectedBrand ?? row?.brandName);
  const expectedTitle = normalizeLower(row?.expectedNormalizedTitle ?? "");
  const expectedStrength = normalizeLower(row?.expectedStrength ?? "");
  const expectedCountOrForm = normalizeLower(row?.expectedCountOrForm ?? "");
  return {
    expectedProductIdSeenInRaw: expectedProductId ? normalizedRaw.includes(normalizeLower(expectedProductId)) : false,
    expectedBrandSeenInRaw: expectedBrand ? normalizedRaw.includes(expectedBrand) : false,
    expectedTitleSeenInRaw: expectedTitle ? normalizedRaw.includes(expectedTitle) : false,
    expectedStrengthSeenInRaw: expectedStrength ? normalizedRaw.includes(expectedStrength) : false,
    expectedCountOrFormSeenInRaw: expectedCountOrForm ? normalizedRaw.includes(expectedCountOrForm) : false,
  };
};

const buildFetchTraceEntry = (fetched, row, options = {}) => {
  const rawText = String(fetched?.text ?? "");
  const normalizedRaw = normalizeLower(rawText);
  const rawHasPrUrl = /https?:\/\/(?:www|[a-z]{2})\.iherb\.com\/pr\/|(?:^|[\s(])\/pr\/[^\s)]+/i.test(rawText);
  const blockedOrCaptchaDetected =
    /just a moment|security verification|verify you are not a bot|cf-mitigated|captcha|attention required|cloudflare/i.test(rawText) ||
    fetched?.status === 403 ||
    fetched?.status === 429;
  const cookieWallDetected = /this website uses cookies|accept all decline all manage settings/i.test(normalizedRaw);
  let blockerType = null;
  if (/just a moment|security verification|cf-mitigated|cloudflare|verify you are not a bot/i.test(rawText) || fetched?.status === 403) {
    blockerType = "cloudflare_challenge";
  } else if (fetched?.status === 429) {
    blockerType = "429_rate_limit";
  } else if ((fetched?.error ?? "").match(/abort|timed out|timeout/i)) {
    blockerType = "abort_timeout";
  } else if (!normalizeText(rawText)) {
    blockerType = "empty_body";
  }
  const derivedFinalUrl =
    normalizeText(rawText.match(/^URL Source:\s*(.+)$/m)?.[1]) ||
    normalizeText(fetched?.finalUrl) ||
    normalizeText(fetched?.requestUrl) ||
    null;
  return {
    sourceAdapter: fetched?.sourceAdapter ?? options.sourceAdapter ?? FETCH_ADAPTER_MODE,
    sourceFamily: options.sourceFamily ?? null,
    sourceKind: options.sourceKind ?? "reader_fetch",
    requestUrl: fetched?.requestUrl ?? null,
    finalUrl: derivedFinalUrl,
    httpStatus: Number(fetched?.status ?? 0) || 0,
    contentType: fetched?.contentType ?? null,
    contentLength: Number(fetched?.contentLength ?? rawText.length) || rawText.length,
    redirected: Boolean(fetched?.redirected),
    retryCount: Number(fetched?.retryCount ?? 0),
    fromCache: Boolean(fetched?.fromCache),
    blockedOrCaptchaDetected,
    blockerType,
    cookieWallDetected,
    emptyBody: !normalizeText(rawText),
    parserStageReached: options.parserStageReached ?? "fetch_only",
    htmlHash: rawText ? stableHash(rawText.slice(0, 20000)) : null,
    ...buildExpectedSignalFlags(rawText, row),
    rawHasPrUrl,
    rawHasExpectedProductId: normalizeText(row?.expectedProductId ?? row?.productId)
      ? normalizedRaw.includes(normalizeLower(row?.expectedProductId ?? row?.productId))
      : false,
    rawHasExpectedTitle: normalizeText(row?.expectedNormalizedTitle ?? "")
      ? normalizedRaw.includes(normalizeLower(row?.expectedNormalizedTitle ?? ""))
      : false,
    blockedOrCaptchaType: blockerType,
    rawBodyClass:
      blockerType === "cloudflare_challenge"
        ? "challenge_page"
        : !normalizeText(rawText)
          ? "empty"
          : /^Title:\s+/m.test(rawText)
            ? "reader_page"
            : "html_loaded",
    error: fetched?.error ?? null,
  };
};

const extractIherbProductUrlsLegacy = (text) =>
  [...String(text ?? "").matchAll(/https?:\/\/(?:www|[a-z]{2})\.iherb\.com\/pr\/[^)\s]+/g)]
    .map((match) => canonicalizeIherbUrl(match[0]))
    .filter(Boolean);

const extractIherbProductUrlsRemediated = (text) => {
  const raw = String(text ?? "");
  const urls = new Set();
  for (const match of raw.matchAll(/https?:\/\/(?:www|[a-z]{2})\.iherb\.com\/pr\/[^)\s"'<>]+/g)) {
    const candidate = canonicalizeIherbUrl(match[0]);
    if (candidate) urls.add(candidate);
  }
  for (const match of raw.matchAll(/\]\((https?:\/\/(?:www|[a-z]{2})\.iherb\.com\/pr\/[^)\s"'<>]+)(?:\s+"[^"]*")?\)/g)) {
    const candidate = canonicalizeIherbUrl(match[1]);
    if (candidate) urls.add(candidate);
  }
  for (const match of raw.matchAll(/(?:^|[\s(])((?:\/pr\/)[^)\s"'<>]+(?:\/\d+)?)/g)) {
    const candidate = canonicalizeIherbUrl(`https://www.iherb.com${match[1]}`);
    if (candidate) urls.add(candidate);
  }
  return [...urls];
};

const extractIherbProductUrlsFromText = (text, mode = IHERB_SEARCH_EXTRACTION_MODE) =>
  mode === "remediated" ? extractIherbProductUrlsRemediated(text) : extractIherbProductUrlsLegacy(text);

const canonicalizeIherbUrl = (value) => {
  const decoded = decodeHtml(value);
  const match = decoded.match(/https?:\/\/(?:[a-z]{2}\.)?iherb\.com\/pr\/[^"'?\s<>]+(?:\/\d+)?(?:\?[^"'<> ]*)?/i);
  if (!match) return null;
  const url = new URL(match[0]);
  url.hostname = "www.iherb.com";
  url.protocol = "https:";
  url.hash = "";
  return url.toString().replace(/\?at=0&?$/i, "").replace(/\?$/i, "");
};

const fetchDirectIherbDetection = async (targetUrl, row) => {
  const fetched = await fetchTextCurl(targetUrl, "direct-iherb-detection", REMEDIATION_REQUEST_TIMEOUT_MS);
  return buildFetchTraceEntry(fetched, row, {
    sourceAdapter: "curl_direct_iherb",
    sourceKind: "direct_iherb_fetch",
    parserStageReached: fetched.ok && normalizeText(fetched.text) ? "html_loaded" : "fetch_only",
  });
};

const searchIherbViaRjina = async (query, options = {}) => {
  const { traceCollector = null, row = null, cacheNamespace = "default", extractionMode = IHERB_SEARCH_EXTRACTION_MODE } = options;
  const cacheKey = buildSearchCacheKey("rjina", query, cacheNamespace);
  if (searchCache.has(cacheKey)) {
    executionHealth.cacheHits += 1;
    const cached = searchCache.get(cacheKey);
    if (Array.isArray(traceCollector)) {
      traceCollector.push({
        sourceAdapter: FETCH_ADAPTER_MODE,
        sourceFamily: "iherb_reader_search",
        sourceKind: "search_fetch",
        requestUrl: `${READER_PREFIX}www.iherb.com/search?kw=${encodeURIComponent(query)}`,
        finalUrl: `${READER_PREFIX}www.iherb.com/search?kw=${encodeURIComponent(query)}`,
        httpStatus: 200,
        contentType: null,
        contentLength: 0,
        redirected: false,
        retryCount: 0,
        fromCache: true,
        blockedOrCaptchaDetected: false,
        blockerType: null,
        cookieWallDetected: false,
        emptyBody: false,
        parserStageReached: "html_loaded",
        htmlHash: null,
        ...buildExpectedSignalFlags("", row),
        rawHasPrUrl: false,
        rawHasExpectedProductId: false,
        rawHasExpectedTitle: false,
        rawBodyClass: "cached",
        error: null,
        query,
      });
    }
    return cached;
  }
  const searchUrl = `${READER_PREFIX}www.iherb.com/search?kw=${encodeURIComponent(query)}`;
  const fetched = await fetchText(searchUrl, `iherb-search:${query}`);
  if (Array.isArray(traceCollector)) {
    traceCollector.push({
      ...buildFetchTraceEntry(fetched, row, {
        sourceFamily: "iherb_reader_search",
        sourceKind: "search_fetch",
        parserStageReached: fetched.ok && fetched.text ? "html_loaded" : "fetch_only",
      }),
      query,
    });
  }
  if (!fetched.ok || !fetched.text) {
    searchCache.set(cacheKey, []);
    return [];
  }
  const links = new Set(extractIherbProductUrlsFromText(fetched.text, extractionMode));
  const resolved = [...links];
  searchCache.set(cacheKey, resolved);
  return resolved;
};

const searchBraveForIherb = async (query, options = {}) => {
  const { traceCollector = null, row = null, cacheNamespace = "default" } = options;
  if (!BRAVE_SEARCH_ENABLED) return [];
  const cacheKey = buildSearchCacheKey("brave", query, cacheNamespace);
  if (searchCache.has(cacheKey)) {
    executionHealth.cacheHits += 1;
    return searchCache.get(cacheKey);
  }
  const fetched = await fetchText(`https://search.brave.com/search?q=${encodeURIComponent(`site:iherb.com/pr ${query}`)}`, `brave-search:${query}`);
  if (Array.isArray(traceCollector)) {
    traceCollector.push({
      ...buildFetchTraceEntry(fetched, row, {
        sourceFamily: "search_engine_site_fallback",
        sourceKind: "search_engine_fetch",
        parserStageReached: fetched.ok && fetched.text ? "html_loaded" : "fetch_only",
      }),
      query,
    });
  }
  if (!fetched.ok || !fetched.text) {
    searchCache.set(cacheKey, []);
    return [];
  }
  const links = new Set();
  for (const match of fetched.text.matchAll(/href="([^"]+)"/g)) {
    const candidate = canonicalizeIherbUrl(match[1]);
    if (candidate) links.add(candidate);
  }
  const resolved = [...links];
  searchCache.set(cacheKey, resolved);
  return resolved;
};

const searchDuckDuckGoForIherb = async (query, options = {}) => {
  const { traceCollector = null, row = null, cacheNamespace = "default" } = options;
  const cacheKey = buildSearchCacheKey("duck", query, cacheNamespace);
  if (searchCache.has(cacheKey)) {
    executionHealth.cacheHits += 1;
    return searchCache.get(cacheKey);
  }
  const target = `https://html.duckduckgo.com/html/?q=${encodeURIComponent(`site:iherb.com/pr ${query}`)}`;
  const fetched = await fetchText(target, `duckduckgo-search:${query}`);
  if (Array.isArray(traceCollector)) {
    traceCollector.push({
      ...buildFetchTraceEntry(fetched, row, {
        sourceFamily: "search_engine_site_fallback",
        sourceKind: "search_engine_fetch",
        parserStageReached: fetched.ok && fetched.text ? "html_loaded" : "fetch_only",
      }),
      query,
    });
  }
  if (!fetched.ok || !fetched.text) {
    searchCache.set(cacheKey, []);
    return [];
  }
  const links = new Set();
  for (const match of fetched.text.matchAll(/uddg=([^"&]+)/g)) {
    const decoded = decodeURIComponent(match[1]);
    const candidate = canonicalizeIherbUrl(decoded);
    if (candidate) links.add(candidate);
  }
  const resolved = [...links].slice(0, 6);
  searchCache.set(cacheKey, resolved);
  return resolved;
};

const stripBrandPrefix = (title, brandName) =>
  normalizeLower(title)
    .replace(new RegExp(`^\\s*${String(brandName ?? "").replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\s*,?\\s*`, "i"), "")
    .replace(/[™®']/g, "")
    .replace(/&/g, " and ")
    .replace(/\+/g, " plus ")
    .replace(/[(),/\\-]/g, " ")
    .replace(/\s+/g, " ")
    .trim();

const buildStrengthKey = (title) => {
  const matches = [...normalizeLower(title).matchAll(/(\d+(?:\.\d+)?)\s*(mg|mcg|g|iu|cfu|billion|million)/g)];
  if (matches.length === 0) return null;
  return matches.map((match) => `${match[1]}${match[2]}`).join("|");
};

const inferCountFromTitle = (title) => {
  const match = normalizeLower(title).match(/(\d+)\s*(count|capsules?|caps?|tablets?|softgels?|gummies|chewables?|tea bags?)/i);
  return match ? match[1] : null;
};

const inferFormFromTitle = (title) => {
  const normalized = normalizeLower(title);
  if (normalized.includes("softgel")) return "softgels";
  if (normalized.includes("tablet")) return "tablets";
  if (normalized.includes("capsule") || normalized.includes("caps ")) return "capsules";
  if (normalized.includes("gumm")) return "gummies";
  if (normalized.includes("chew")) return "chewables";
  if (normalized.includes("tea")) return "tea";
  if (normalized.includes("powder")) return "powder";
  if (normalized.includes("liquid")) return "liquid";
  return null;
};

const stripVariantSuffixes = (title) =>
  normalizeLower(title)
    .replace(/\b\d+\s*(count|capsules?|caps?|tablets?|softgels?|tea bags?|gummies|chewables?)\b/g, " ")
    .replace(/\b\d+(?:\.\d+)?\s*(oz|fl oz|lb|lbs|ml|mL|g)\b/g, " ")
    .replace(/\b(vanilla|chocolate|strawberry|raspberry|hazelnut|coconut|glycerite|lemon|twist|daily|organic|unsalted|raw|roasted|sea salted)\b/g, " ")
    .replace(/\s+/g, " ")
    .trim();

const detectSubBrand = (brandName, title) => {
  if (normalizeLower(brandName) !== "schiff") return null;
  const normalized = normalizeLower(title);
  const candidates = ["megared", "digestive advantage", "move free", "airborne"];
  return candidates.find((candidate) => normalized.includes(candidate)) ?? null;
};

const buildTitleModels = (title, brandName) => {
  const raw = stripBrandPrefix(title, brandName);
  const stripped = stripVariantSuffixes(raw);
  const coreIngredientTitle = stripped
    .replace(/\b\d+(?:\.\d+)?\s*(mg|mcg|g|iu|cfu|billion|million)\b/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  const ingredientPlusStrength = normalizeText(
    stripped.match(/^.*?\b\d+(?:\.\d+)?\s*(mg|mcg|g|iu|cfu|billion|million)\b/i)?.[0] ?? stripped,
  );
  const tokens = coreIngredientTitle
    .split(" ")
    .map((token) => token.trim())
    .filter((token) => token.length >= 3)
    .slice(0, 8);
  return {
    fullNormalizedTitle: normalizeText(stripped),
    coreIngredientTitle: normalizeText(coreIngredientTitle),
    ingredientPlusStrength: normalizeText(ingredientPlusStrength),
    strengthKey: buildStrengthKey(title),
    count: inferCountFromTitle(title),
    form: inferFormFromTitle(title),
    tokens,
  };
};

const buildBarcodeVariants = (barcode) => {
  const gtin14 = normalizeBarcode(barcode);
  if (!gtin14) return [];
  const set = new Set([gtin14, gtin14.slice(-13), gtin14.slice(-12)]);
  return [...set].filter(Boolean);
};

const expandQueryVariants = (value) => {
  const normalized = normalizeText(value);
  if (!normalized) return [];
  const variants = new Set([normalized]);
  variants.add(normalized.replace(/\b5 htp\b/gi, "5-HTP"));
  variants.add(normalized.replace(/\bco q 10\b/gi, "CoQ10"));
  variants.add(normalized.replace(/\bco q-?10\b/gi, "CoQ10"));
  variants.add(normalized.replace(/\bplus\b/gi, "+"));
  variants.add(normalized.replace(/\+/g, " plus "));
  return [...variants].map((item) => normalizeText(item)).filter(Boolean);
};

const buildQueryFamiliesV2 = (row) => {
  const brandName = normalizeText(row.brandName);
  const titles = buildTitleModels(row.productName, row.brandName);
  const subBrand = detectSubBrand(row.brandName, row.productName);
  const families = [];
  const barcodeQueries = buildBarcodeVariants(row.barcode_gtin14).map((barcode) => `${brandName} ${barcode}`);
  if (barcodeQueries.length > 0) families.push({ family: "barcode_normalized", queries: barcodeQueries.slice(0, 3) });
  if (titles.ingredientPlusStrength) {
    families.push({
      family: "brand_ingredient_strength",
      queries: expandQueryVariants(`${brandName} ${titles.ingredientPlusStrength}`).slice(0, 3),
    });
  }
  if (titles.coreIngredientTitle) {
    families.push({
      family: "brand_core_title",
      queries: expandQueryVariants(`${brandName} ${titles.coreIngredientTitle}`).slice(0, 3),
    });
  }
  if (normalizeLower(brandName) === "pure encapsulations") {
    families.push({
      family: "brand_product_title",
      queries: expandQueryVariants(`${brandName} ${stripBrandPrefix(row.productName, row.brandName)}`).slice(0, 2),
    });
  }
  if (subBrand) {
    families.push({
      family: "brand_subbrand",
      queries: expandQueryVariants(`${brandName} ${subBrand} ${titles.ingredientPlusStrength || titles.coreIngredientTitle}`).slice(0, 3),
    });
  }
  return { families: families.slice(0, 5), titles, subBrand };
};

const buildBrandSlugCandidates = (brandName) => {
  const normalized = normalizeText(brandName);
  const variants = new Set([
    slugify(normalized),
    slugify(normalized.replace(/['’]/g, "")),
    slugify(normalized.replace(/&/g, " and ")),
    slugify(normalized.replace(/\band\b/gi, "&")),
  ]);
  return [...variants].filter(Boolean);
};

const findSitemapCandidateUrlsV2 = async (row, titleModel, options = {}) => {
  const enabled = options.enabled ?? USE_SITEMAP;
  if (!enabled) return [];
  const entries = await fetchProductSitemapEntries();
  const brandSlugs = buildBrandSlugCandidates(row.brandName);
  const titleTokens = titleModel.tokens;
  const brandMatched = entries.filter((entry) => brandSlugs.some((brandSlug) => entry.slug.includes(`/pr/${brandSlug}-`)));
  const scored = brandMatched
    .map((entry) => {
      const tokenHits = titleTokens.filter((token) => entry.slug.includes(token.replace(/[^a-z0-9]+/g, "-"))).length;
      let score = tokenHits * 18;
      if (titleModel.strengthKey) {
        for (const token of titleModel.strengthKey.split("|")) {
          if (entry.slug.includes(token.replace(/[^a-z0-9]+/g, ""))) score += 8;
        }
      }
      return { url: entry.url, score, tokenHits };
    })
    .filter((entry) => entry.tokenHits > 0 && entry.score >= 18)
    .sort((left, right) => right.score - left.score || left.url.localeCompare(right.url));
  return scored.slice(0, 20);
};

const parseSection = (markdown, sectionName) => {
  const escaped = sectionName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const regex = new RegExp(
    String.raw`(?:###\s+\*\*${escaped}\*\*|###\s+${escaped}|(?:^|\n)\*\*${escaped}\*\*)([\s\S]*?)(?=\n###\s+|\n\*\*[A-Z][\s\S]{0,40}\*\*|\nSimilar items to consider|\nProduct rankings:|\nCustomer ratings & reviews|\nRecommended use|\n$)`,
    "i",
  );
  const match = markdown.match(regex);
  if (!match) return null;
  return normalizeText(
    match[1]
      .replace(/^\s*[:\-]\s*/g, "")
      .replace(/\[\]\([^)]+\)/g, " ")
      .replace(/!\[[^\]]*\]\([^)]+\)/g, " ")
      .replace(/\*\*/g, " ")
      .replace(/\s+/g, " "),
  );
};

const parseSupplementFacts = (markdown) => {
  const start = markdown.search(/\*\*Supplement facts\*\*/i);
  if (start === -1) return { servingSize: null, servingsPerContainer: null, nutritionalFacts: [] };
  const tail = markdown.slice(start, start + 3500);
  const endMatch = tail.search(/\nSimilar items to consider|\nCustomer ratings & reviews|\nRecommended use|\nProduct rankings:/i);
  const block = endMatch >= 0 ? tail.slice(0, endMatch) : tail;
  const servingSize = block.match(/\*\*Serving Size:\*\*\s*([^\n]+)/i)?.[1] ?? null;
  const servingsPerContainer =
    block.match(/\*\*Serving Per Container\*\*:?\s*([^\n]+)/i)?.[1] ??
    block.match(/\*\*Servings Per Container\*\*:?\s*([^\n]+)/i)?.[1] ??
    null;
  const nutritionalFacts = [];
  for (const rawLine of block.split(/\r?\n/)) {
    const line = normalizeText(rawLine.replace(/\*\*/g, " "));
    if (!line) continue;
    if (/^supplement facts$/i.test(line)) continue;
    if (/^serving size/i.test(line)) continue;
    if (/^serving per container/i.test(line)) continue;
    if (/^amount per serving/i.test(line)) continue;
    if (/^% daily value/i.test(line)) continue;
    if (/^daily value not established/i.test(line)) continue;
    const match = line.match(/^(.*?)(\d+(?:\.\d+)?\s*(?:mg|mcg|g|iu|cfu|billion|million|mL|ml))(.*)$/i);
    if (match) {
      nutritionalFacts.push({
        substancy: normalizeText(match[1]),
        amountPerServing: normalizeText(match[2]),
        dailyValuePercent: normalizeText(match[3]).replace(/^[*†\s-]+/, "") || null,
      });
    }
  }
  return {
    servingSize: normalizeText(servingSize) || null,
    servingsPerContainer: normalizeText(servingsPerContainer) || null,
    nutritionalFacts,
  };
};

const parseMainImage = (markdown, title) => {
  const titleTokens = new Set(
    normalizeLower(title)
      .split(/\s+/)
      .map((token) => token.replace(/[^a-z0-9]+/g, ""))
      .filter((token) => token.length >= 4),
  );
  for (const match of markdown.matchAll(/!\[([^\]]+)\]\((https?:\/\/[^)]+)\)/g)) {
    const alt = normalizeText(match[1]);
    const url = normalizeText(match[2]);
    if (!/cloudinary\.images-iherb\.com/i.test(url)) continue;
    const altTokens = normalizeLower(alt)
      .split(/\s+/)
      .map((token) => token.replace(/[^a-z0-9]+/g, ""))
      .filter(Boolean);
    const overlap = altTokens.filter((token) => titleTokens.has(token)).length;
    if (overlap >= 2) return url;
  }
  return null;
};

const parseIherbProductPage = (markdown, sourceUrl, expectedBrand) => {
  const title =
    normalizeText(markdown.match(/^Title:\s*(.+)$/m)?.[1]) ||
    normalizeText(markdown.split(/\r?\n/).find((line) => line && !/^Title:/i.test(line))) ||
    normalizeText(sourceUrl.split("/").filter(Boolean).pop()?.replace(/\d+$/, "").replace(/[-_]+/g, " "));
  const canonicalUrl = normalizeText(markdown.match(/^URL Source:\s*(.+)$/m)?.[1]) || sourceUrl;
  const productId = normalizeText(canonicalUrl.match(/\/pr\/[^/]+\/(\d+)(?:[/?#]|$)/)?.[1]) || null;
  const upcCode =
    normalizeText(markdown.match(/\*\s+UPC:\s*([0-9]+)/i)?.[1]) ||
    normalizeText(markdown.match(/\bUPC:\s*([0-9]+)/i)?.[1]) ||
    null;
  const packageQuantity =
    normalizeText(markdown.match(/\*\s+Package quantity:\s*([^\n]+)/i)?.[1]) ||
    normalizeText(markdown.match(/\bPackage quantity:\s*([^\n]+)/i)?.[1]) ||
    null;
  return {
    title,
    canonicalUrl,
    productId,
    upcCode,
    packageQuantity,
    suggestedUse: parseSection(markdown, "Suggested use"),
    warnings: parseSection(markdown, "Warnings"),
    otherIngredients: parseSection(markdown, "Other ingredients"),
    description: parseSection(markdown, "Description"),
    supplementFacts: parseSupplementFacts(markdown),
    imageUrl: parseMainImage(markdown, title),
    brandName: expectedBrand,
  };
};

const buildPageProfile = (page, row) => {
  const titles = buildTitleModels(page.title, row.brandName);
  return {
    barcode: normalizeBarcode(page.upcCode),
    strengthKey: buildStrengthKey(page.title),
    count: normalizeDigits(page.packageQuantity) || inferCountFromTitle(page.title),
    form: inferFormFromTitle(page.title),
    titles,
  };
};

const overlapTokens = (leftTokens, rightTokens) => {
  const left = new Set(leftTokens);
  return rightTokens.filter((token) => left.has(token)).length;
};

const scoreCandidateWithReasons = (row, candidateTitles, page, pageProfile) => {
  const rowBarcode = normalizeBarcode(row.barcode_gtin14);
  const pageBarcode = pageProfile.barcode;
  const reasons = [];
  let score = 0;

  if (rowBarcode && pageBarcode) {
    if (rowBarcode === pageBarcode) score += 1000;
    else reasons.push("barcode_mismatch");
  }

  const titleOverlap = overlapTokens(candidateTitles.tokens, pageProfile.titles.tokens);
  const tokenRatio = candidateTitles.tokens.length > 0 ? titleOverlap / candidateTitles.tokens.length : 0;
  score += Math.round(tokenRatio * 80);
  if (tokenRatio < 0.5) reasons.push("weak_title_overlap");

  if (candidateTitles.fullNormalizedTitle && candidateTitles.fullNormalizedTitle === pageProfile.titles.fullNormalizedTitle) score += 60;
  if (candidateTitles.ingredientPlusStrength && candidateTitles.ingredientPlusStrength === pageProfile.titles.ingredientPlusStrength) score += 70;
  if (candidateTitles.coreIngredientTitle && candidateTitles.coreIngredientTitle === pageProfile.titles.coreIngredientTitle) score += 40;

  if (candidateTitles.strengthKey && pageProfile.strengthKey) {
    if (candidateTitles.strengthKey === pageProfile.strengthKey) score += 40;
    else reasons.push("strength_mismatch");
  }

  if (candidateTitles.count && pageProfile.count) {
    if (candidateTitles.count === pageProfile.count) score += 15;
    else reasons.push("count_mismatch");
  }

  if (candidateTitles.form && pageProfile.form) {
    if (candidateTitles.form === pageProfile.form) score += 12;
    else reasons.push("form_mismatch");
  }

  const acceptable =
    (rowBarcode && pageBarcode && rowBarcode === pageBarcode) ||
    (tokenRatio >= 0.7 &&
      !reasons.includes("strength_mismatch") &&
      !reasons.includes("count_mismatch") &&
      !reasons.includes("form_mismatch") &&
      !reasons.includes("barcode_mismatch"));

  return { score, reasons, acceptable, tokenRatio };
};

const buildSearchQueueRow = (row) => ({
  brandName: row.brandName,
  title: row.title,
  productId: normalizeText(row.productId) || null,
  barcode_gtin14: normalizeBarcode(row.barcode_gtin14),
  upcCode: normalizeDigits(row.upcCode) || null,
  coreMissingFields: Array.isArray(row?.completeness?.coreMissingFields) ? row.completeness.coreMissingFields : [],
  highConfidenceUsProductPageReady: Boolean(row?.readiness?.highConfidenceUsProductPageReady),
  hasUsIherbPage: Boolean(row?.sourceSummary?.hasUsIherbPage),
  priorityLane: "P0_api_fill_us_strong_identity",
  recommendedAction: "official_fill_core_fields",
  rationale: "Recovered missing-from-staging iHerb identity via week2_5 root-cause harness.",
  sourceTypes: row?.sourceTypes ?? [],
});

const toSeedRow = (sourceRow, parsedPage, sourceUrl) => ({
  brandName: sourceRow.brandName,
  title: parsedPage.title,
  productId: parsedPage.productId,
  upcCode: normalizeText(parsedPage.upcCode) || null,
  barcode_gtin14: normalizeBarcode(parsedPage.upcCode ?? sourceRow.barcode_gtin14),
  link: sourceUrl,
  productCatalogImage: parsedPage.imageUrl,
  productImages: parsedPage.imageUrl ? [parsedPage.imageUrl] : [],
  serving: {
    servingSize: parsedPage.supplementFacts.servingSize,
    servingsPerContainer: parsedPage.supplementFacts.servingsPerContainer,
  },
  supplementFacts: parsedPage.supplementFacts,
  sections: {
    ...(parsedPage.description ? { Description: parsedPage.description } : {}),
    ...(parsedPage.suggestedUse ? { "Suggested use": parsedPage.suggestedUse } : {}),
    ...(parsedPage.otherIngredients ? { "Other ingredients": parsedPage.otherIngredients } : {}),
    ...(parsedPage.warnings ? { Warnings: parsedPage.warnings } : {}),
  },
  sourceTypes: ["iherb_us_product_page"],
  marketSources: ["US"],
  sourceUrls: [sourceUrl],
  sourceNotes: ["week2_5_identity_root_cause_harness"],
});

const hydrateMergedRow = (currentRow, mergedRecord) => {
  const completeness = deriveCompleteness(mergedRecord);
  const status = classifyOverlayStatus(mergedRecord, completeness);
  const highConfidenceUsProductPageReady = qualifiesHighConfidenceUsProductPage(mergedRecord, completeness);
  const patchStrategy = buildPatchStrategy(mergedRecord, completeness);
  return {
    ...currentRow,
    ...mergedRecord,
    overlayRecordKey: buildOverlayRecordKey(mergedRecord),
    completeness: { ...completeness, status },
    readiness: { highConfidenceUsProductPageReady },
    patchStrategy,
    overlaySha256: stableHash({
      brandName: mergedRecord.brandName,
      title: mergedRecord.title,
      barcode_gtin14: mergedRecord.barcode_gtin14,
      supplementFacts: mergedRecord.supplementFacts,
      descriptionSections: mergedRecord.descriptionSections,
      sourceSummary: mergedRecord.sourceSummary,
    }),
  };
};

const buildCanarySelection = (officialQueue, previousReport) => {
  const previousReasonById = new Map(
    (Array.isArray(previousReport?.unresolvedRows) ? previousReport.unresolvedRows : []).map((row) => [
      normalizeText(row.candidateId),
      row.reason,
    ]),
  );
  const grouped = new Map();
  for (const row of officialQueue) {
    const key = normalizeLower(row.brandName);
    if (!grouped.has(key)) grouped.set(key, []);
    grouped.get(key).push({ ...row, previousReason: previousReasonById.get(normalizeText(row.candidateId)) ?? null });
  }

  const selected = [];
  for (const brandName of IDENTITY_BRANDS) {
    const rows = grouped.get(normalizeLower(brandName)) ?? [];
    const taken = new Set();
    const byReason = (reason) =>
      rows.filter((row, idx) => row.previousReason === reason && !taken.has(idx));
    const variantRows = rows.filter(
      (row, idx) =>
        !taken.has(idx) &&
        (VARIANT_HINT_RE.test(row.productName) ||
          rows.filter((candidate) => normalizeLower(candidate.productName) === normalizeLower(row.productName)).length > 1),
    );

    const pushOne = (list) => {
      const row = list[0];
      if (!row) return;
      const idx = rows.findIndex((candidate) => normalizeText(candidate.candidateId) === normalizeText(row.candidateId));
      if (idx >= 0) taken.add(idx);
      selected.push({ ...row, selectedFor: "canary" });
    };

    pushOne(byReason("no_iherb_candidate_found"));
    pushOne(byReason("no_iherb_candidate_found"));
    pushOne(byReason("no_iherb_page_match_after_fetch"));
    pushOne(variantRows);

    for (let idx = 0; idx < rows.length && selected.filter((row) => normalizeLower(row.brandName) === normalizeLower(brandName)).length < 4; idx += 1) {
      if (taken.has(idx)) continue;
      taken.add(idx);
      selected.push({ ...rows[idx], selectedFor: "canary" });
    }
  }

  return selected.slice(0, IDENTITY_CANARY_SIZE);
};

const classifyQuerySensitivityType = (row) => {
  const title = normalizeText(row?.title ?? row?.productName);
  const titleModel = buildTitleModels(title, row?.brandName);
  if (BARCODE_SENSITIVE_HINT_RE.test(title) || titleModel.tokens.length <= 3) return "barcode_sensitive";
  if (TITLE_SENSITIVE_HINT_RE.test(title) || titleModel.tokens.length >= 4) return "title_sensitive";
  return titleModel.tokens.length <= 3 ? "barcode_sensitive" : "title_sensitive";
};

const buildExpectedIdentityEvidence = (row) => {
  const titleModel = buildTitleModels(row?.title, row?.brandName);
  return {
    productId: normalizeText(row?.productId) || null,
    barcode_gtin14: normalizeBarcode(row?.barcode_gtin14),
    strengthKey: titleModel.strengthKey,
    count: titleModel.count,
    form: titleModel.form,
  };
};

const buildPositiveControlDebugSet = (stagingRows) => {
  const selected = [];
  const notes = [];
  for (const brandName of IDENTITY_BRANDS) {
    const candidates = stagingRows
      .filter(
        (row) =>
          normalizeLower(row.brandName) === normalizeLower(brandName) &&
          Array.isArray(row?.completeness?.coreMissingFields) &&
          row.completeness.coreMissingFields.length === 0 &&
          /iherb\.com\/pr\//i.test(String(row.link ?? "")) &&
          normalizeBarcode(row?.barcode_gtin14),
      )
      .map((row) => ({
        ...row,
        querySensitivityType: classifyQuerySensitivityType(row),
        expectedNormalizedTitle: buildTitleModels(row.title, row.brandName).fullNormalizedTitle,
        expectedPageIdentityEvidence: buildExpectedIdentityEvidence(row),
      }));

    const barcodeSensitive = candidates.find((row) => row.querySensitivityType === "barcode_sensitive") ?? null;
    const titleSensitive =
      candidates.find(
        (row) =>
          row.querySensitivityType === "title_sensitive" &&
          normalizeText(row.productId) !== normalizeText(barcodeSensitive?.productId),
      ) ?? null;

    const picked = [];
    if (barcodeSensitive) picked.push(barcodeSensitive);
    if (titleSensitive) picked.push(titleSensitive);

    for (const candidate of candidates) {
      if (picked.length >= 2) break;
      if (picked.some((row) => normalizeText(row.productId) === normalizeText(candidate.productId))) continue;
      picked.push(candidate);
    }

    if (!barcodeSensitive || !titleSensitive) {
      notes.push({
        brandName,
        note: "Could not satisfy both barcode-sensitive and title-sensitive control rows; backfilled with the cleanest available known-safe rows.",
      });
    }

    for (const match of picked.slice(0, 2)) {
      selected.push({
        candidateId: `positive_control:${normalizeLower(brandName).replace(/[^a-z0-9]+/g, "_")}:${normalizeText(match.productId)}`,
        brandName,
        productName: match.title,
        title: match.title,
        productId: match.productId,
        barcode_gtin14: match.barcode_gtin14,
        expectedBrand: brandName,
        expectedNormalizedTitle: match.expectedNormalizedTitle,
        expectedProductId: normalizeText(match.productId),
        expectedUrl: match.link,
        expectedPageIdentityEvidence: match.expectedPageIdentityEvidence,
        expectedStrength: match.expectedPageIdentityEvidence.strengthKey,
        expectedCountOrForm: normalizeText([match.expectedPageIdentityEvidence.count, match.expectedPageIdentityEvidence.form].filter(Boolean).join(" ")) || null,
        querySensitivityType: match.querySensitivityType,
        controlType: "positive_control",
      });
    }
  }

  return {
    rows: selected.slice(0, POSITIVE_CONTROL_SIZE),
    notes,
  };
};

const buildMicroCanarySelection = (officialQueue, previousReport, options = {}) => {
  const targetReasons = new Set(options.targetReasons ?? ["no_iherb_candidate_found"]);
  const allowedBrands = new Set(options.allowedBrands ?? IDENTITY_BRANDS);
  const previousReasonById = new Map(
    (Array.isArray(previousReport?.unresolvedRows) ? previousReport.unresolvedRows : []).map((row) => [
      normalizeText(row.candidateId),
      row.reason,
    ]),
  );
  const selected = [];
  let schiffCount = 0;
  for (const row of officialQueue) {
    const brandName = normalizeText(row.brandName);
    const previousReason = previousReasonById.get(normalizeText(row.candidateId)) ?? null;
    const title = normalizeText(row.productName ?? row.title);
    if (!allowedBrands.has(brandName)) continue;
    if (!normalizeBarcode(row.barcode_gtin14)) continue;
    if (!targetReasons.has(previousReason)) continue;
    if (VARIANT_HINT_RE.test(title)) continue;
    if (normalizeLower(brandName) === "schiff" && schiffCount >= 2) continue;
    selected.push({
      ...row,
      previousReason,
      preFixSubCause: previousReason ?? "not_proven_on_iherb_us_under_current_strict_methods",
      selectedFor: "micro_canary",
    });
    if (normalizeLower(brandName) === "schiff") schiffCount += 1;
    if (selected.length >= IDENTITY_CANARY_SIZE) break;
  }
  return selected;
};

const classifyDiscoveryFailure = (row, titleModel, queriesTried, queryFamiliesHit, candidateUrlsFound, expectedPageTrace) => {
  if (!expectedPageTrace?.fetchedCandidateCount) return "fetch_defect";
  if (!expectedPageTrace.accepted && expectedPageTrace.expectedPageRejectedReason) {
    if (/weak_title_overlap|full_normalized_title_mismatch|core_ingredient_title_mismatch/i.test(expectedPageTrace.expectedPageRejectedReason)) {
      return "normalization_defect";
    }
    return "acceptance_rule_too_strict";
  }
  if (expectedPageTrace.accepted) {
    const ingredientCore = titleModel.coreIngredientTitle
      .split(/\s+/)
      .filter((token) => token.length >= 3)
      .slice(0, 4);
    const queryStrings = queriesTried.map((entry) => normalizeLower(entry.query));
    const queryCoverage = ingredientCore.length === 0 ? 0 : ingredientCore.filter((token) => queryStrings.some((query) => query.includes(token))).length / ingredientCore.length;
    if (candidateUrlsFound.length === 0 && queryFamiliesHit.size === 0 && queryCoverage < 0.5) return "query_generation_defect";
    if (candidateUrlsFound.length === 0) return "search_source_defect";
  }
  return "other";
};

const traceExpectedPage = async (row) => {
  const titleModel = buildTitleModels(row.productName ?? row.title, row.brandName);
  const expectedUrl = normalizeText(row.expectedUrl);
  const fetchTrace = [];
  if (!expectedUrl) {
    return {
      expectedPageSeen: false,
      fetchedCandidateCount: 0,
      acceptedCandidateCount: 0,
      expectedPageRejectedReason: "missing_expected_url",
      topCandidateScores: [],
      accepted: false,
      parsedPage: null,
      fetchTrace,
    };
  }
  const readerUrl = `${READER_PREFIX}${expectedUrl.replace(/^https?:\/\//i, "")}`;
  const fetched = await fetchText(readerUrl, `expected-page:${expectedUrl}`, REMEDIATION_REQUEST_TIMEOUT_MS);
  const expectedFetch = buildFetchTraceEntry(fetched, row, {
    sourceKind: "expected_page_fetch",
    parserStageReached: fetched.ok && fetched.text ? "html_loaded" : "fetch_only",
  });
  fetchTrace.push(expectedFetch);
  if (!fetched.ok || !fetched.text) {
    fetchTrace.push(await fetchDirectIherbDetection(expectedUrl, row));
    return {
      expectedPageSeen: false,
      fetchedCandidateCount: 0,
      acceptedCandidateCount: 0,
      expectedPageRejectedReason: fetched.error ? `fetch_failed:${fetched.error}` : `fetch_failed:${fetched.status}`,
      topCandidateScores: [],
      accepted: false,
      parsedPage: null,
      fetchTrace,
    };
  }
  const parsedPage = parseIherbProductPage(fetched.text, expectedUrl, row.brandName);
  expectedFetch.parserStageReached = parsedPage.productId || parsedPage.title ? "product_fields_extracted" : "html_loaded";
  expectedFetch.finalUrl = parsedPage.canonicalUrl || expectedFetch.finalUrl;
  const pageProfile = buildPageProfile(parsedPage, row);
  const scored = scoreCandidateWithReasons(
    {
      brandName: row.brandName,
      barcode_gtin14: row.barcode_gtin14,
    },
    titleModel,
    parsedPage,
    pageProfile,
  );
  const rejectReasons = [...(scored.reasons ?? [])];
  if (
    normalizeText(row.expectedProductId) &&
    normalizeText(parsedPage.productId) &&
    normalizeText(row.expectedProductId) !== normalizeText(parsedPage.productId)
  ) {
    rejectReasons.push("expected_product_id_mismatch");
  }
  const fullTitleMismatch = normalizeLower(titleModel.fullNormalizedTitle) !== normalizeLower(pageProfile.titles.fullNormalizedTitle);
  if (fullTitleMismatch) rejectReasons.push("full_normalized_title_mismatch");
  const coreTitleMismatch = normalizeLower(titleModel.coreIngredientTitle) !== normalizeLower(pageProfile.titles.coreIngredientTitle);
  if (coreTitleMismatch) rejectReasons.push("core_ingredient_title_mismatch");
  const expectedAccepted =
    scored.acceptable &&
    !rejectReasons.includes("expected_product_id_mismatch");
  return {
    expectedPageSeen: true,
    fetchedCandidateCount: 1,
    acceptedCandidateCount: expectedAccepted ? 1 : 0,
    expectedPageRejectedReason: expectedAccepted ? null : rejectReasons.join(", ") || "expected_page_not_accepted",
    topCandidateScores: [
      {
        url: expectedUrl,
        score: scored.score,
        rejectReasons,
        tokenRatio: Number(scored.tokenRatio.toFixed(2)),
        productId: parsedPage.productId,
        barcode_gtin14: normalizeBarcode(parsedPage.upcCode),
      },
    ],
    accepted: expectedAccepted,
    parsedPage,
    fetchTrace,
  };
};

const resolveIdentityRow = async (
  row,
  {
    previousReason = null,
    control = false,
    cacheNamespace = "repo_composite_v2",
    useSitemap = USE_SITEMAP,
    duckFirst = false,
    enableBrave = BRAVE_SEARCH_ENABLED,
    enableDuck = true,
    extractionMode = IHERB_SEARCH_EXTRACTION_MODE,
    maxQueries = 8,
    maxCandidateUrls = 12,
    maxCandidateFetches = 2,
  } = {},
) => {
  const titleModel = buildTitleModels(row.productName ?? row.title, row.brandName);
  const { families, subBrand } = buildQueryFamiliesV2({
    brandName: row.brandName,
    productName: row.productName ?? row.title,
    barcode_gtin14: row.barcode_gtin14,
  });
  const queriesTried = [];
  const queryFamiliesHit = new Set();
  const candidateUrls = new Set();
  const fetchTrace = [];
  const sitemapCandidates = await findSitemapCandidateUrlsV2(
    { brandName: row.brandName, productName: row.productName ?? row.title },
    titleModel,
    { enabled: useSitemap },
  );
  sitemapCandidates.forEach((entry) => candidateUrls.add(entry.url));
  if (sitemapCandidates.length > 0) queryFamiliesHit.add("sitemap");

  for (const family of families) {
    for (const query of family.queries) {
      queriesTried.push({ family: family.family, query });
      const directMatches = await searchIherbViaRjina(query, {
        traceCollector: fetchTrace,
        row,
        cacheNamespace,
        extractionMode,
      });
      if (directMatches.length > 0) queryFamiliesHit.add(family.family);
      directMatches.forEach((url) => candidateUrls.add(url));
      if (candidateUrls.size >= maxCandidateUrls) break;
      if (directMatches.length === 0) {
        const runDuck = async () => {
          if (!enableDuck) return [];
          const duckMatches = await searchDuckDuckGoForIherb(query, {
            traceCollector: fetchTrace,
            row,
            cacheNamespace,
          });
          if (duckMatches.length > 0) queryFamiliesHit.add(`${family.family}:search_engine`);
          duckMatches.forEach((url) => candidateUrls.add(url));
          return duckMatches;
        };
        const runBrave = async () => {
          if (!enableBrave) return [];
          const braveMatches = await searchBraveForIherb(query, {
            traceCollector: fetchTrace,
            row,
            cacheNamespace,
          });
          if (braveMatches.length > 0) queryFamiliesHit.add(`${family.family}:search_engine`);
          braveMatches.forEach((url) => candidateUrls.add(url));
          return braveMatches;
        };
        if (duckFirst) {
          const duckMatches = await runDuck();
          if (duckMatches.length === 0) await runBrave();
        } else {
          const braveMatches = await runBrave();
          if (braveMatches.length === 0) await runDuck();
        }
      }
      if (candidateUrls.size >= maxCandidateUrls) break;
      await sleep(120);
    }
    if (candidateUrls.size >= maxCandidateUrls) break;
    if (queriesTried.length >= maxQueries) break;
  }

  const searchCandidateCount = Math.max(0, candidateUrls.size - sitemapCandidates.length);
  const fetchedCandidates = [];
  const acceptedCandidates = [];
  const candidateScoreRows = [];
  const orderedUrls = [...candidateUrls].slice(0, maxCandidateFetches);

  for (const url of orderedUrls) {
    const readerUrl = `${READER_PREFIX}${url.replace(/^https?:\/\//i, "")}`;
    const fetched = await fetchText(readerUrl, `iherb-page:${url}`, REMEDIATION_REQUEST_TIMEOUT_MS);
    const pageFetch = buildFetchTraceEntry(fetched, row, {
      sourceFamily: "repo_composite_v2",
      sourceKind: "candidate_page_fetch",
      parserStageReached: fetched.ok && fetched.text ? "html_loaded" : "fetch_only",
    });
    fetchTrace.push(pageFetch);
    if (!fetched.ok || !fetched.text) continue;
    const parsedPage = parseIherbProductPage(fetched.text, url, row.brandName);
    pageFetch.parserStageReached = parsedPage.productId || parsedPage.title ? "product_fields_extracted" : "html_loaded";
    pageFetch.finalUrl = parsedPage.canonicalUrl || pageFetch.finalUrl;
    const pageProfile = buildPageProfile(parsedPage, row);
    const scored = scoreCandidateWithReasons(
      {
        brandName: row.brandName,
        barcode_gtin14: row.barcode_gtin14,
      },
      titleModel,
      parsedPage,
      pageProfile,
    );
    const scoreRow = {
      url,
      score: scored.score,
      rejectReasons: scored.reasons,
      tokenRatio: Number(scored.tokenRatio.toFixed(2)),
      productId: parsedPage.productId,
      barcode_gtin14: normalizeBarcode(parsedPage.upcCode),
    };
    candidateScoreRows.push(scoreRow);
    fetchedCandidates.push({ url, parsedPage, pageProfile, scored });
    if (scored.acceptable) acceptedCandidates.push({ url, parsedPage, pageProfile, scored });
  }

  acceptedCandidates.sort((left, right) => right.scored.score - left.scored.score);
  candidateScoreRows.sort((left, right) => right.score - left.score || left.url.localeCompare(right.url));

  const bestAccepted = acceptedCandidates[0] ?? null;
  const secondAccepted = acceptedCandidates[1] ?? null;
  const ambiguous =
    bestAccepted &&
    secondAccepted &&
    bestAccepted.scored.score < 1000 &&
    secondAccepted.scored.score >= bestAccepted.scored.score - 15;
  const bestRejected = candidateScoreRows[0] ?? null;

  let rootCause = "other";
  let rootCauseConfidence = "low";
  let acceptanceRejectReason = null;
  let repairedByQueryGap = false;
  let acceptedViaNormalization = false;

  if (!bestAccepted || ambiguous) {
    if (candidateUrls.size === 0) {
      rootCause = previousReason === "no_iherb_candidate_found" && normalizeBarcode(row.barcode_gtin14)
        ? "not_proven_on_iherb_us_current_methods"
        : "no_iherb_candidate_found";
      rootCauseConfidence = previousReason === "no_iherb_candidate_found" ? "medium" : "high";
      acceptanceRejectReason = "no_candidates";
    } else if (bestRejected?.rejectReasons?.some((reason) => ["barcode_mismatch", "strength_mismatch", "count_mismatch", "form_mismatch"].includes(reason))) {
      rootCause = "likely_variant_mismatch";
      rootCauseConfidence = "high";
      acceptanceRejectReason = bestRejected.rejectReasons.join(", ");
    } else if (previousReason === "no_iherb_candidate_found" && queryFamiliesHit.size > 0) {
      rootCause = "query_generation_gap";
      rootCauseConfidence = "medium";
      acceptanceRejectReason = bestRejected?.rejectReasons?.join(", ") ?? "candidate_found_but_not_accepted";
    } else if (candidateUrls.size > 0) {
      rootCause = "no_iherb_page_match_after_fetch";
      rootCauseConfidence = "medium";
      acceptanceRejectReason = bestRejected?.rejectReasons?.join(", ") ?? "no_page_match_after_fetch";
    }
  } else {
    if (previousReason === "no_iherb_candidate_found" && queryFamiliesHit.size > 0) {
      rootCause = "query_generation_gap";
      rootCauseConfidence = "high";
      repairedByQueryGap = true;
    } else if (previousReason === "no_iherb_page_match_after_fetch") {
      rootCause = "likely_variant_mismatch";
      rootCauseConfidence = "medium";
      acceptedViaNormalization = true;
    } else {
      rootCause = "other";
      rootCauseConfidence = "low";
    }
  }

  const candidateUrlsFound = [...candidateUrls];
  const expectedPageSeen = Boolean(
    normalizeText(row.expectedUrl) &&
      candidateUrlsFound.some((url) => normalizeText(url) === normalizeText(row.expectedUrl)),
  );

  if (control && bestAccepted && row.expectedUrl) {
    const expectedProductId = normalizeText(String(row.expectedUrl).match(/\/(\d+)(?:[/?#]|$)/)?.[1]);
    const acceptedProductId = normalizeText(bestAccepted.parsedPage.productId);
    if (expectedProductId && acceptedProductId !== expectedProductId) {
      acceptanceRejectReason = "positive_control_matched_wrong_product";
      rootCause = "other";
      rootCauseConfidence = "high";
      return {
        ...row,
        controlType: row.controlType,
        result: "control_miss",
        queriesTried,
        queryFamiliesHit: [...queryFamiliesHit],
        candidateUrlsFound,
        sitemapCandidateCount: sitemapCandidates.length,
        searchCandidateCount,
        fetchedCandidateCount: fetchedCandidates.length,
        acceptedCandidateCount: 0,
        topCandidateScores: candidateScoreRows.slice(0, 3),
        acceptanceRejectReason,
        rootCause,
        rootCauseConfidence,
        repairedByQueryGap: false,
        acceptedViaNormalization: false,
        expectedPageSeen,
        fetchTrace,
      };
    }
  }

  if (!bestAccepted || ambiguous) {
    return {
      ...row,
      result: "unresolved",
      queriesTried,
      queryFamiliesHit: [...queryFamiliesHit],
      candidateUrlsFound,
      sitemapCandidateCount: sitemapCandidates.length,
      searchCandidateCount,
      fetchedCandidateCount: fetchedCandidates.length,
      acceptedCandidateCount: 0,
      topCandidateScores: candidateScoreRows.slice(0, 3),
      acceptanceRejectReason: ambiguous ? "ambiguous_accepted_candidates" : acceptanceRejectReason,
      rootCause,
      rootCauseConfidence,
      repairedByQueryGap,
      acceptedViaNormalization,
      expectedPageSeen,
      fetchTrace,
    };
  }

  return {
    ...row,
    result: control ? "control_hit" : "accepted",
    queriesTried,
    queryFamiliesHit: [...queryFamiliesHit],
    candidateUrlsFound,
    sitemapCandidateCount: sitemapCandidates.length,
    searchCandidateCount,
    fetchedCandidateCount: fetchedCandidates.length,
    acceptedCandidateCount: 1,
    topCandidateScores: candidateScoreRows.slice(0, 3),
    acceptanceRejectReason: null,
    rootCause,
    rootCauseConfidence,
    repairedByQueryGap,
    acceptedViaNormalization,
    expectedPageSeen: true,
    fetchTrace,
    selectedUrl: bestAccepted.url,
    selectedProductId: bestAccepted.parsedPage.productId,
    selectedBarcode: normalizeBarcode(bestAccepted.parsedPage.upcCode),
    parsedPage: bestAccepted.parsedPage,
  };
};

const buildGenericIherbQueries = (row) => {
  const titleModel = buildTitleModels(row.productName ?? row.title, row.brandName);
  const rawTitle = normalizeText(row.productName ?? row.title);
  return [...new Set([normalizeText(`${row.brandName} ${titleModel.fullNormalizedTitle}`), rawTitle].filter(Boolean))].slice(0, 2);
};

const summarizeSourceFamily = (row, sourceFamily, queriesTried, candidateUrlsFound, fetchTrace, evaluation, extra = {}) => {
  const expectedUrl = normalizeText(row.expectedUrl);
  const candidateRank = expectedUrl
    ? candidateUrlsFound.findIndex((url) => normalizeText(url) === expectedUrl)
    : -1;
  const relevantTrace = fetchTrace.filter((trace) => trace.sourceFamily === sourceFamily || !trace.sourceFamily);
  const relevantSourceTrace = relevantTrace.filter((trace) => trace.sourceKind !== "candidate_page_fetch");
  const expectedInRawButNotEmitted =
    candidateUrlsFound.length === 0 &&
    relevantSourceTrace.some((trace) => trace.rawHasPrUrl || trace.rawHasExpectedProductId);
  return {
    sourceFamily,
    queriesTried,
    candidateCount: candidateUrlsFound.length,
    candidateUrlsFound,
    expectedPageSeen: candidateRank >= 0,
    candidateRankOfExpectedPage: candidateRank >= 0 ? candidateRank + 1 : null,
    fetchedCandidateCount: evaluation.fetchedCandidateCount,
    fetchSuccess: relevantTrace.filter((trace) => trace.httpStatus >= 200 && trace.httpStatus < 400).length,
    fromCache: relevantTrace.filter((trace) => trace.fromCache).length,
    http429: relevantTrace.filter((trace) => trace.httpStatus === 429 || trace.blockerType === "429_rate_limit").length,
    aborted: relevantTrace.filter((trace) => trace.blockerType === "abort_timeout").length,
    blockedOrCaptchaDetected: relevantTrace.filter((trace) => trace.blockedOrCaptchaDetected).length,
    finalAcceptedCount: evaluation.finalAcceptedCount,
    sourceAdapter: [...new Set(relevantTrace.map((trace) => trace.sourceAdapter).filter(Boolean))],
    expectedInRawButNotEmitted,
    candidateExtractionCount: candidateUrlsFound.length,
    rawHasPrUrl: relevantSourceTrace.some((trace) => trace.rawHasPrUrl),
    rawHasExpectedProductId: relevantSourceTrace.some((trace) => trace.rawHasExpectedProductId),
    rawHasExpectedTitle: relevantSourceTrace.some((trace) => trace.rawHasExpectedTitle),
    blockedOrCaptchaType: [...new Set(relevantTrace.map((trace) => trace.blockedOrCaptchaType ?? trace.blockerType).filter(Boolean))],
    topCandidateScores: evaluation.topCandidateScores,
    acceptedCandidateUrl: evaluation.acceptedCandidateUrl,
    acceptedProductId: evaluation.acceptedProductId,
    fetchTrace: relevantTrace,
    ...extra,
  };
};

const evaluateCandidateUrlsForSource = async (row, candidateUrls, sourceFamily, fetchTrace, maxCandidates = 1) => {
  const titleModel = buildTitleModels(row.productName ?? row.title, row.brandName);
  const candidateScoreRows = [];
  let acceptedCandidateUrl = null;
  let acceptedProductId = null;
  let finalAcceptedCount = 0;
  let fetchedCandidateCount = 0;
  for (const url of candidateUrls.slice(0, maxCandidates)) {
    const readerUrl = `${READER_PREFIX}${url.replace(/^https?:\/\//i, "")}`;
    const fetched = await fetchText(readerUrl, `${sourceFamily}:${url}`, REMEDIATION_REQUEST_TIMEOUT_MS);
    const pageFetch = buildFetchTraceEntry(fetched, row, {
      sourceFamily,
      sourceKind: "candidate_page_fetch",
      parserStageReached: fetched.ok && fetched.text ? "html_loaded" : "fetch_only",
    });
    fetchTrace.push(pageFetch);
    if (!fetched.ok || !fetched.text) continue;
    fetchedCandidateCount += 1;
    const parsedPage = parseIherbProductPage(fetched.text, url, row.brandName);
    pageFetch.parserStageReached = parsedPage.productId || parsedPage.title ? "product_fields_extracted" : "html_loaded";
    pageFetch.finalUrl = parsedPage.canonicalUrl || pageFetch.finalUrl;
    const pageProfile = buildPageProfile(parsedPage, row);
    const scored = scoreCandidateWithReasons(
      {
        brandName: row.brandName,
        barcode_gtin14: row.barcode_gtin14,
      },
      titleModel,
      parsedPage,
      pageProfile,
    );
    candidateScoreRows.push({
      url,
      score: scored.score,
      rejectReasons: scored.reasons,
      tokenRatio: Number(scored.tokenRatio.toFixed(2)),
      productId: parsedPage.productId,
      barcode_gtin14: normalizeBarcode(parsedPage.upcCode),
    });
    if (scored.acceptable) {
      finalAcceptedCount += 1;
      if (!acceptedCandidateUrl) {
        acceptedCandidateUrl = url;
        acceptedProductId = normalizeText(parsedPage.productId) || null;
      }
    }
  }
  candidateScoreRows.sort((left, right) => right.score - left.score || left.url.localeCompare(right.url));
  return {
    fetchedCandidateCount,
    finalAcceptedCount,
    acceptedCandidateUrl,
    acceptedProductId,
    topCandidateScores: candidateScoreRows.slice(0, 3),
  };
};

const runIherbReaderSearchComparison = async (row, options = {}) => {
  const { extractionMode = "legacy", cacheNamespace = "compare_iherb_reader" } = options;
  const fetchTrace = [];
  const candidateUrls = new Set();
  const queriesTried = buildGenericIherbQueries(row).map((query) => ({ family: "generic_title", query }));
  for (const entry of queriesTried) {
    const matches = await searchIherbViaRjina(entry.query, {
      traceCollector: fetchTrace,
      row,
      cacheNamespace,
      extractionMode,
    });
    matches.forEach((url) => candidateUrls.add(url));
    if (candidateUrls.size >= DISCOVERY_COMPARE_CANDIDATE_LIMIT) break;
    await sleep(60);
  }
  const evaluation = await evaluateCandidateUrlsForSource(row, [...candidateUrls], "iherb_reader_search", fetchTrace);
  return summarizeSourceFamily(row, "iherb_reader_search", queriesTried, [...candidateUrls], fetchTrace, evaluation);
};

const runBrandSpecificSourceComparison = async (row, options = {}) => {
  const { extractionMode = "legacy", cacheNamespace = "compare_brand_specific" } = options;
  const fetchTrace = [];
  const candidateUrls = new Set();
  const { families } = buildQueryFamiliesV2({
    brandName: row.brandName,
    productName: row.productName ?? row.title,
    barcode_gtin14: row.barcode_gtin14,
  });
  const queriesTried = [];
  for (const family of families) {
    for (const query of family.queries) {
      queriesTried.push({ family: family.family, query });
      const matches = await searchIherbViaRjina(query, {
        traceCollector: fetchTrace,
        row,
        cacheNamespace,
        extractionMode,
      });
      matches.forEach((url) => candidateUrls.add(url));
      if (candidateUrls.size >= DISCOVERY_COMPARE_CANDIDATE_LIMIT || queriesTried.length >= DISCOVERY_COMPARE_QUERY_LIMIT) break;
      await sleep(60);
    }
    if (candidateUrls.size >= DISCOVERY_COMPARE_CANDIDATE_LIMIT || queriesTried.length >= DISCOVERY_COMPARE_QUERY_LIMIT) break;
  }
  const evaluation = await evaluateCandidateUrlsForSource(row, [...candidateUrls], "brand_specific_source_path", fetchTrace);
  return summarizeSourceFamily(row, "brand_specific_source_path", queriesTried, [...candidateUrls], fetchTrace, evaluation);
};

const runSearchEngineFallbackComparison = async (row, options = {}) => {
  const { cacheNamespace = "compare_search_engine_fallback" } = options;
  const fetchTrace = [];
  const candidateUrls = new Set();
  const { families } = buildQueryFamiliesV2({
    brandName: row.brandName,
    productName: row.productName ?? row.title,
    barcode_gtin14: row.barcode_gtin14,
  });
  const queriesTried = [];
  for (const family of families.slice(0, 1)) {
    for (const query of family.queries.slice(0, DISCOVERY_COMPARE_FALLBACK_QUERY_LIMIT)) {
      queriesTried.push({ family: family.family, query });
      const duckMatches = await searchDuckDuckGoForIherb(query, {
        traceCollector: fetchTrace,
        row,
        cacheNamespace,
      });
      duckMatches.slice(0, DISCOVERY_COMPARE_CANDIDATE_LIMIT).forEach((url) => candidateUrls.add(url));
      if (candidateUrls.size >= DISCOVERY_COMPARE_CANDIDATE_LIMIT) break;
      await sleep(60);
    }
    if (candidateUrls.size >= DISCOVERY_COMPARE_CANDIDATE_LIMIT) break;
  }
  const evaluation = await evaluateCandidateUrlsForSource(row, [...candidateUrls], "search_engine_site_fallback", fetchTrace);
  return summarizeSourceFamily(row, "search_engine_site_fallback", queriesTried, [...candidateUrls], fetchTrace, evaluation);
};

const runSitemapSourceComparison = async (row) => {
  const titleModel = buildTitleModels(row.productName ?? row.title, row.brandName);
  return summarizeSourceFamily(
    row,
    "sitemap_source",
    [{ family: "sitemap", query: `${row.brandName} ${titleModel.coreIngredientTitle}` }],
    [],
    [],
    { fetchedCandidateCount: 0, finalAcceptedCount: 0, acceptedCandidateUrl: null, acceptedProductId: null, topCandidateScores: [] },
    { availability: "not_prebuilt_in_repo" },
  );
};

const runRepoCompositeComparison = async (row, options = {}) => {
  const trace = await resolveIdentityRow(row, {
    previousReason: options.previousReason ?? null,
    control: true,
    cacheNamespace: options.cacheNamespace ?? "compare_repo_composite",
    useSitemap: false,
    duckFirst: false,
    enableBrave: true,
    enableDuck: true,
    extractionMode: options.extractionMode ?? "legacy",
    maxQueries: DISCOVERY_COMPARE_QUERY_LIMIT,
    maxCandidateUrls: DISCOVERY_COMPARE_CANDIDATE_LIMIT,
    maxCandidateFetches: 1,
  });
  return summarizeSourceFamily(
    row,
    "repo_composite_v2",
    trace.queriesTried ?? [],
    trace.candidateUrlsFound ?? [],
    trace.fetchTrace ?? [],
    {
      fetchedCandidateCount: trace.fetchedCandidateCount ?? 0,
      finalAcceptedCount: trace.acceptedCandidateCount ?? 0,
      acceptedCandidateUrl: trace.selectedUrl ?? null,
      acceptedProductId: trace.selectedProductId ?? null,
      topCandidateScores: trace.topCandidateScores ?? [],
    },
    {
      queryFamiliesHit: trace.queryFamiliesHit ?? [],
      rootCause: trace.rootCause ?? null,
      rootCauseConfidence: trace.rootCauseConfidence ?? null,
    },
  );
};

const buildSourceFamilySummary = (rows) => {
  const sourceSummaries = {};
  for (const row of rows) {
    for (const source of row.sourceComparisons) {
      if (!sourceSummaries[source.sourceFamily]) {
        sourceSummaries[source.sourceFamily] = {
          attemptedRows: 0,
          expectedPageSeenRows: 0,
          finalAcceptedRows: 0,
          candidateExtractionCount: 0,
          http429: 0,
          aborted: 0,
          blockedOrCaptchaDetected: 0,
        };
      }
      const summary = sourceSummaries[source.sourceFamily];
      summary.attemptedRows += 1;
      summary.expectedPageSeenRows += source.expectedPageSeen ? 1 : 0;
      summary.finalAcceptedRows += source.finalAcceptedCount > 0 ? 1 : 0;
      summary.candidateExtractionCount += source.candidateExtractionCount ?? 0;
      summary.http429 += source.http429 ?? 0;
      summary.aborted += source.aborted ?? 0;
      summary.blockedOrCaptchaDetected += source.blockedOrCaptchaDetected ?? 0;
    }
  }
  return sourceSummaries;
};

const buildDiscoverySourceComparisonReport = async ({
  rows,
  previousReasonById,
  waveId,
  extractionMode,
  concreteFixApplied = null,
}) => {
  setFetchAdapterMode("curl_reader");
  setDiscoveryWavePass(waveId);
  setIherbSearchExtractionMode(extractionMode);
  searchCache.clear();
  const healthStart = snapshotExecutionHealth();
  const comparisonRows = [];
  for (const row of rows) {
    console.error(`[week2_5] discovery_compare ${row.brandName} | ${row.productName} | extraction=${extractionMode}`);
    const expectedPageTrace = await traceExpectedPage(row);
    const sourceComparisons = [
      await runIherbReaderSearchComparison(row, { extractionMode, cacheNamespace: "iherb_reader_search" }),
      await runRepoCompositeComparison(row, {
        extractionMode,
        cacheNamespace: "repo_composite_v2",
        previousReason: previousReasonById.get(normalizeText(row.candidateId)) ?? null,
      }),
      await runSearchEngineFallbackComparison(row, { cacheNamespace: "search_engine_site_fallback" }),
      await runSitemapSourceComparison(row),
      await runBrandSpecificSourceComparison(row, { extractionMode, cacheNamespace: "brand_specific_source_path" }),
    ];
    comparisonRows.push({
      ...row,
      expectedPageTrace,
      sourceComparisons,
    });
  }
  return {
    generatedAt: new Date().toISOString(),
    waveId,
    extractionMode,
    concreteFixApplied,
    rows: comparisonRows,
    summary: {
      attempted: comparisonRows.length,
      sourceFamilies: buildSourceFamilySummary(comparisonRows),
    },
    executionHealth: diffExecutionHealth(healthStart),
  };
};

const mergeAcceptedCanaryRows = (stagingRows, canaryResults) => {
  const refreshedRows = [...stagingRows];
  const stagingByBarcode = new Map();
  const stagingByProductId = new Map();
  refreshedRows.forEach((row, idx) => {
    const barcode = normalizeBarcode(row?.barcode_gtin14);
    const productId = normalizeText(row?.productId);
    if (barcode) stagingByBarcode.set(barcode, idx);
    if (productId) stagingByProductId.set(productId, idx);
  });

  const mergedRows = [];
  for (const result of canaryResults.filter((row) => row.result === "accepted")) {
    const seedRow = toSeedRow(result, result.parsedPage, result.selectedUrl);
    const incomingRecord = extractOverlayRecordFromSeedRow(seedRow, {
      seedName: "week2_5_identity_root_cause_harness",
    });
    const barcode = normalizeBarcode(seedRow.barcode_gtin14);
    const existingIdx =
      (barcode ? stagingByBarcode.get(barcode) : null) ??
      (seedRow.productId ? stagingByProductId.get(normalizeText(seedRow.productId)) : null) ??
      null;
    const currentRow = existingIdx != null ? refreshedRows[existingIdx] : {};
    const mergedRecord = mergeOverlayRecords(currentRow, incomingRecord);
    const hydratedRow = hydrateMergedRow(currentRow, mergedRecord);
    if (existingIdx != null) {
      refreshedRows[existingIdx] = hydratedRow;
    } else {
      refreshedRows.push(hydratedRow);
      const newIdx = refreshedRows.length - 1;
      if (barcode) stagingByBarcode.set(barcode, newIdx);
      if (seedRow.productId) stagingByProductId.set(normalizeText(seedRow.productId), newIdx);
    }

    const afterMissingFields = Array.isArray(hydratedRow?.completeness?.coreMissingFields)
      ? hydratedRow.completeness.coreMissingFields
      : [];
    result.afterMissingFields = afterMissingFields;
    result.beforeMissingFields = [];
    result.result = afterMissingFields.length === 0 ? "recovered_complete" : "recovered_partial";
    result.seedRow = seedRow;
    mergedRows.push(result);
  }
  return { refreshedRows, mergedRows };
};

const buildRecoveredPartialQueue = (stagingRows, acceptedRows) =>
  acceptedRows
    .filter((row) => row.result === "recovered_partial")
    .map((row) => stagingRows.find((candidate) => normalizeText(candidate.productId) === normalizeText(row.selectedProductId)))
    .filter(Boolean)
    .map((row) => buildSearchQueueRow(row));

const rerunReports = (label, stagingPath) => {
  const mergeOutDir = path.join(ROOT, "output", `iherb_overlay_bulk_merge_${label}`);
  const executionOutDir = path.join(ROOT, "output", `iherb_overlay_execution_plan_${label}`);
  const highFreqOutDir = path.join(ROOT, "output", `iherb_overlay_high_frequency_validation_${label}`);
  const partialOutDir = path.join(ROOT, "output", `iherb_partial_wave_plan_${label}`);

  execNode(path.join(ROOT, "scripts", "maintainer", "merge-iherb-overlay-bulk-to-supabase.mjs"), [
    "--input-json",
    stagingPath,
    "--out-dir",
    mergeOutDir,
    "--owner",
    "maintainer-week2-5",
  ]);
  execNode(path.join(ROOT, "scripts", "maintainer", "build-iherb-overlay-execution-plan.mjs"), [
    "--staging-json",
    stagingPath,
    "--merge-report-json",
    path.join(mergeOutDir, "overlay_merge_coverage_report.json"),
    "--out-dir",
    executionOutDir,
  ]);
  execNode(path.join(ROOT, "scripts", "maintainer", "build-iherb-overlay-high-frequency-validation.mjs"), [
    "--staging-json",
    stagingPath,
    "--merge-report-json",
    path.join(mergeOutDir, "overlay_merge_coverage_report.json"),
    "--queue-json",
    path.join(executionOutDir, "api_fill_priority_queue.json"),
    "--out-dir",
    highFreqOutDir,
    "--label",
    label,
  ]);
  execNode(path.join(ROOT, "scripts", "maintainer", "build-iherb-partial-wave-plan.mjs"), [
    "--active-queue-json",
    path.join(executionOutDir, "active_priority_queue.json"),
    "--high-frequency-details-json",
    path.join(highFreqOutDir, "high_frequency_hit_details.json"),
    "--out-dir",
    partialOutDir,
  ]);

  return {
    stagingPath,
    mergeReportPath: path.join(mergeOutDir, "overlay_merge_coverage_report.json"),
    executionPlanPath: path.join(executionOutDir, "execution_plan_summary.json"),
    highFrequencyPath: path.join(highFreqOutDir, "high_frequency_hit_validation.json"),
    partialWavePlanPath: path.join(partialOutDir, "partial_wave_plan_summary.json"),
    mergeOutDir,
    executionOutDir,
    highFreqOutDir,
    partialOutDir,
  };
};

const buildRetargetedNowQueue = async (stagingPath) => {
  const [stagingJson, nowQueue, batch1, batch2] = await Promise.all([
    readJson(stagingPath),
    readJson(NOW_QUEUE_PATH),
    readJson(path.join(ROOT, "output", "now_foods_week2_remaining_batch1_20260313", "official_fallback_report.json")),
    readJson(path.join(ROOT, "output", "now_foods_week2_remaining_batch2_20260313", "official_fallback_report.json")),
  ]);
  const stagingRows = Array.isArray(stagingJson?.products) ? stagingJson.products : [];
  const stagingByProductId = new Map(stagingRows.map((row) => [normalizeText(row.productId), row]));
  const previousIds = new Set(
    [...(batch1?.rows ?? []), ...(batch2?.rows ?? [])].map((row) => normalizeText(row.productId)).filter(Boolean),
  );

  const selected = (Array.isArray(nowQueue) ? nowQueue : [])
    .filter((row) => !previousIds.has(normalizeText(row.productId)))
    .filter((row) => row.highConfidenceUsProductPageReady === true && row.hasUsIherbPage === true)
    .filter((row) => JSON.stringify([...(row.coreMissingFields ?? [])].sort()) === JSON.stringify(["warnings"]))
    .filter((row) => !EXHAUSTED_NOW_FAMILY_RE.test(row.title))
    .map((row) => ({
      ...row,
      preferred: PREFERRED_NOW_TITLE_RE.test(row.title),
      stagingTitle: stagingByProductId.get(normalizeText(row.productId))?.title ?? row.title,
    }))
    .sort((left, right) => {
      if (Number(right.preferred) !== Number(left.preferred)) return Number(right.preferred) - Number(left.preferred);
      return left.title.localeCompare(right.title);
    })
    .slice(0, NOW_RETARGET_LIMIT)
    .map(({ preferred, stagingTitle, ...row }) => row);

  return selected;
};

const buildRootCauseMarkdown = (report) => {
  const lines = [
    "# Identity Recovery Root Cause Report",
    "",
    `- generatedAt: ${report.generatedAt}`,
    `- strategy: ${report.strategy}`,
    `- official_fetch_unresolved_total: ${report.bucket.totalRows}`,
    `- observed_rows: ${report.bucket.observedRows}`,
    `- positive_control_success: ${report.positiveControl.successful}/${report.positiveControl.attempted}`,
    `- harness_valid: ${report.positiveControl.harnessValid}`,
    `- canary_recovered_complete: ${report.canary.recoveredComplete}`,
    `- canary_recovered_partial: ${report.canary.recoveredPartial}`,
    `- outcomeClass: ${report.summary.outcomeClass}`,
    `- decision: ${report.summary.decision}`,
    "",
    "## Full Bucket Breakdown",
    "",
  ];
  for (const [bucket, count] of Object.entries(report.bucket.fullBucketBreakdown)) {
    lines.push(`- ${bucket}: ${count}`);
  }
  lines.push("", "## Canary Brand Breakdown", "");
  for (const brand of report.brandBreakdown) {
    lines.push(
      `- ${brand.brandName}: attempted=${brand.attempted}, recovered_complete=${brand.recoveredComplete}, recovered_partial=${brand.recoveredPartial}, query_gap=${brand.queryGenerationGap}, variant_mismatch=${brand.variantMismatch}`,
    );
  }
  lines.push("", "## Canary Sample", "");
  for (const row of report.canary.rows.slice(0, 40)) {
    lines.push(
      `- ${row.brandName} | ${row.productName} | result=${row.result} | root_cause=${row.rootCause} | best=${row.topCandidateScores?.[0]?.score ?? "n/a"} | url=${row.selectedUrl ?? "n/a"}`,
    );
  }
  return `${lines.join("\n")}\n`;
};

const buildDiscoverySourceComparisonMarkdown = (report) => {
  const lines = [
    "# Discovery Source Comparison",
    "",
    `- generatedAt: ${report.generatedAt}`,
    `- extractionMode: ${report.extractionMode}`,
    `- attempted: ${report.summary.attempted}`,
    "",
    "## Source Families",
    "",
    ...Object.entries(report.summary.sourceFamilies).map(
      ([sourceFamily, summary]) =>
        `- ${sourceFamily}: expected_seen=${summary.expectedPageSeenRows}/${summary.attemptedRows}, accepted=${summary.finalAcceptedRows}/${summary.attemptedRows}, extracted=${summary.candidateExtractionCount}, http429=${summary.http429}, aborted=${summary.aborted}`,
    ),
    "",
    "## Rows",
    "",
  ];
  for (const row of report.rows) {
    lines.push(`- ${row.brandName} | ${row.productName}`);
    for (const source of row.sourceComparisons) {
      lines.push(
        `  source=${source.sourceFamily} expected_seen=${source.expectedPageSeen} rank=${source.candidateRankOfExpectedPage ?? "n/a"} accepted=${source.finalAcceptedCount} extracted=${source.candidateExtractionCount} expected_in_raw_not_emitted=${source.expectedInRawButNotEmitted}`,
      );
    }
  }
  return `${lines.join("\n")}\n`;
};

const buildPositiveControlDebugMarkdown = (report) => {
  const lines = [
    "# Identity Positive Control Debug",
    "",
    `- generatedAt: ${report.generatedAt}`,
    `- controlValidity: ${report.summary.controlValidity}`,
    `- attempted: ${report.summary.attempted}`,
    `- discovery_hits: ${report.summary.discoveryHits}`,
    `- expected_page_accepts: ${report.summary.expectedPageAccepts}`,
    `- primaryFailureLocus: ${report.failureLocus.primaryFailureLocus}`,
    `- secondaryFailureLocus: ${report.failureLocus.secondaryFailureLocus}`,
    "",
    "## Brand Notes",
    "",
    ...report.selectionNotes.map((note) => `- ${note.brandName}: ${note.note}`),
    "",
    "## Rows",
    "",
    ...report.rows.map(
      (row) =>
        `- ${row.brandName} | ${row.productName} | ${row.querySensitivityType} | discovery=${row.discoveryTrace.controlOutcome} | expected=${row.expectedPageTrace.accepted ? "accepted" : row.expectedPageTrace.expectedPageRejectedReason || "rejected"} | locus=${row.failureLocus}`,
    ),
  ];
  return `${lines.join("\n")}\n`;
};

const buildDiscoveryPositiveControlRerunMarkdown = (report) => {
  const lines = [
    "# Discovery Positive Control Rerun",
    "",
    `- generatedAt: ${report.generatedAt}`,
    `- concreteFixApplied: ${report.concreteFixApplied}`,
    `- controlValidity: ${report.summary.controlValidity}`,
    `- attempted: ${report.summary.attempted}`,
    `- discovery_hits: ${report.summary.discoveryHits}`,
    `- expected_page_accepts: ${report.summary.expectedPageAccepts}`,
    "",
    "## Source Deltas",
    "",
    ...Object.entries(report.sourceFamilyDelta ?? {}).map(
      ([sourceFamily, delta]) =>
        `- ${sourceFamily}: expected_seen_delta=${delta.expectedPageSeenDelta}, accepted_delta=${delta.finalAcceptedDelta}, extraction_delta=${delta.candidateExtractionDelta}, http429_delta=${delta.http429Delta}`,
    ),
    "",
    "## Rows",
    "",
    ...report.rows.map(
      (row) =>
        `- ${row.brandName} | ${row.productName} | discovery=${row.discoveryTrace.controlOutcome} | expected=${row.expectedPageTrace.accepted ? "accepted" : row.expectedPageTrace.expectedPageRejectedReason || "rejected"} | locus=${row.failureLocus}`,
    ),
  ];
  return `${lines.join("\n")}\n`;
};

const buildFetchTraceMarkdown = (report) => {
  const lines = [
    "# Fetch Trace Positive Control",
    "",
    `- generatedAt: ${report.generatedAt}`,
    `- attempted: ${report.summary.attempted}`,
    `- primaryAdapter: ${report.summary.primaryAdapter}`,
    `- blockedOrCaptchaDetected: ${report.summary.blockedOrCaptchaDetected}`,
    `- cookieWallDetected: ${report.summary.cookieWallDetected}`,
    "",
    "## Rows",
    "",
  ];
  for (const row of report.rows) {
    lines.push(`- ${row.brandName} | ${row.productName}`);
    for (const trace of row.fetchTrace) {
      lines.push(
        `  source=${trace.sourceAdapter}/${trace.sourceKind} status=${trace.httpStatus} blocked=${trace.blockedOrCaptchaDetected} blockerType=${trace.blockerType ?? "n/a"} parser=${trace.parserStageReached} final=${trace.finalUrl ?? "n/a"}`,
      );
    }
  }
  return `${lines.join("\n")}\n`;
};

const buildPositiveControlRerunMarkdown = (report) => {
  const lines = [
    "# Identity Positive Control Rerun",
    "",
    `- generatedAt: ${report.generatedAt}`,
    `- concreteFixApplied: ${report.concreteFixApplied}`,
    `- controlValidity: ${report.summary.controlValidity}`,
    `- attempted: ${report.summary.attempted}`,
    `- discovery_hits: ${report.summary.discoveryHits}`,
    `- expected_page_accepts: ${report.summary.expectedPageAccepts}`,
    "",
    "## Rows",
    "",
    ...report.rows.map(
      (row) =>
        `- ${row.brandName} | ${row.productName} | discovery=${row.discoveryTrace.controlOutcome} | expected=${row.expectedPageTrace.accepted ? "accepted" : row.expectedPageTrace.expectedPageRejectedReason || "rejected"} | locus=${row.failureLocus}`,
    ),
  ];
  return `${lines.join("\n")}\n`;
};

const buildFailureLocusMarkdown = (report) => {
  const lines = [
    "# Discovery Source Failure Locus",
    "",
    `- generatedAt: ${report.generatedAt}`,
    `- primaryFailureLocus: ${report.primaryFailureLocus}`,
    `- secondaryFailureLocus: ${report.secondaryFailureLocus}`,
    `- concreteFixAttempted: ${report.concreteFixAttempted}`,
    "",
    "## Counts",
    "",
    ...Object.entries(report.counts).map(([key, value]) => `- ${key}: ${value}`),
    "",
    "## Brand Level Loci",
    "",
    ...Object.entries(report.brandLevelLoci).map(
      ([brandName, loci]) => `- ${brandName}: primary=${loci.primary}, secondary=${loci.secondary}, subCause=${loci.subCause ?? "n/a"}`,
    ),
  ];
  return `${lines.join("\n")}\n`;
};

const buildMicroCanaryMarkdown = (report) => {
  const lines = [
    "# official_fetch_unresolved Micro Canary",
    "",
    `- generatedAt: ${report.generatedAt}`,
    `- executed: ${report.executed}`,
    `- decision: ${report.decision}`,
    `- outcomeClass: ${report.outcomeClass}`,
    `- recoveredComplete: ${report.recoveredComplete}`,
    `- recoveredPartial: ${report.recoveredPartial}`,
    ...(report.skipReason ? [`- skipReason: ${report.skipReason}`] : []),
    "",
    "## Rows",
    "",
    ...report.rows.map(
      (row) =>
        `- ${row.brandName} | ${row.productName} | pre=${row.preFixSubCause} | query=${row.queryFamilyUsed || "n/a"} | discovery_improved=${row.candidateDiscoveryImproved} | safe_recovery=${row.safeRecoveryType} | blocker=${row.finalBlockerClass || "n/a"}`,
    ),
  ];
  return `${lines.join("\n")}\n`;
};

const buildSummaryMarkdown = (payload) => {
  const lines = [
    "# Week 2.5 Root Cause Summary",
    "",
    "## Starting Baseline",
    "",
    `- strictMergeReady: \`${payload.startingBaseline.strictMergeReady}\``,
    `- queued: \`${payload.startingBaseline.queued}\``,
    `- completeHitCount: \`${payload.startingBaseline.completeHitCount}\``,
    `- completeHitRate: \`${payload.startingBaseline.completeHitRate}%\``,
    `- activeQueueCount: \`${payload.startingBaseline.activeQueueCount}\``,
    "",
    "## Ending Baseline",
    "",
    `- strictMergeReady: \`${payload.endingBaseline.strictMergeReady}\``,
    `- queued: \`${payload.endingBaseline.queued}\``,
    `- completeHitCount: \`${payload.endingBaseline.completeHitCount}\``,
    `- completeHitRate: \`${payload.endingBaseline.completeHitRate}%\``,
    `- activeQueueCount: \`${payload.endingBaseline.activeQueueCount}\``,
    "",
    "## Harness Artifacts",
    "",
    `- blocker_registry: \`${payload.harness.blockerRegistryPath}\``,
    `- brand_path_roi_registry: \`${payload.harness.roiRegistryPath}\``,
    `- wave_manifest_current: \`${payload.harness.currentManifestPath}\``,
    `- wave_result_current: \`${payload.harness.currentResultPath}\``,
    `- root_cause_report: \`${payload.rootCause.reportJsonPath}\``,
    "",
    "## Root Cause Strategy",
    "",
    `- strategy_tested: \`${payload.rootCause.strategy}\``,
    `- positive_control: \`${payload.rootCause.positiveControl.successful}/${payload.rootCause.positiveControl.attempted}\``,
    `- harness_valid: \`${payload.rootCause.positiveControl.harnessValid}\``,
    `- recovered_complete: \`${payload.rootCause.summary.recoveredComplete}\``,
    `- recovered_partial: \`${payload.rootCause.summary.recoveredPartial}\``,
    `- outcomeClass: \`${payload.rootCause.summary.outcomeClass}\``,
    `- decision: \`${payload.rootCause.summary.decision}\``,
    "",
    "## Coverage Follow-Up",
    "",
    `- path: \`${payload.coverage.pathKey}\``,
    `- attempted: \`${payload.coverage.summary.attempted}\``,
    `- becameFullOverlayReady: \`${payload.coverage.summary.becameFullOverlayReady}\``,
    `- decision: \`${payload.coverage.summary.decision}\``,
    "",
    "## Updated Blocker Picture",
    "",
    `- official_fetch_unresolved/iherb_identity_v2: \`${payload.rootCause.summary.decision}\``,
    `- NOW Foods retarget path: \`${payload.coverage.summary.decision}\``,
    `- wet_n_wild / boiron / aura / 21st_century / frontier remain paused`,
    "",
    "## Root Cause Isolation Verdict",
    "",
    payload.rootCause.summary.isBetterIsolated
      ? "- The root cause is better isolated than before: the bucket is no longer just `no_path_found`; it now has sub-cause breakdown tied to real canary evidence."
      : "- The root cause did not isolate further on this pass.",
  ];
  return `${lines.join("\n")}\n`;
};

const computePatternFromPrevious = (previousEntry, uplift) => {
  if (!previousEntry || !Number(previousEntry.totalBatchesRun ?? 0)) {
    return uplift > 0 ? "single_positive" : "single_zero";
  }
  const previousLast = Number(previousEntry.lastBatchUplift ?? 0);
  if (previousLast > 0 && uplift > 0) return "positive_then_positive";
  if (previousLast > 0 && uplift === 0) return "positive_then_zero";
  if (previousLast === 0 && uplift === 0) return "zero_then_zero";
  return uplift > 0 ? "single_positive" : "single_zero";
};

const syncCurrentAndHistory = async ({ manifest, result, historyManifestPath, historyResultPath, markdownCopies = [] }) => {
  await writeJson(historyManifestPath, manifest);
  await writeJson(historyResultPath, result);
  await copyFile(historyManifestPath, path.join(HISTORY_CANONICAL_DIR, path.basename(historyManifestPath)));
  await copyFile(historyResultPath, path.join(HISTORY_CANONICAL_DIR, path.basename(historyResultPath)));
  await writeJson(CURRENT_MANIFEST_PATH, manifest);
  await writeJson(CURRENT_RESULT_PATH, result);
  await writeJson(path.join(ACTIVE_CANONICAL_DIR, "wave_manifest_current.json"), manifest);
  await writeJson(path.join(ACTIVE_CANONICAL_DIR, "wave_result_current.json"), result);
  for (const { sourcePath, canonicalName } of markdownCopies) {
    if (await fileExists(sourcePath)) {
      await copyFile(sourcePath, path.join(ACTIVE_CANONICAL_DIR, canonicalName));
    }
  }
};

const updateHarnessRegistries = async ({
  currentManifest,
  currentResult,
  identityStatus,
  identityBlockerClass,
  identityEvidencePath,
  coverageStatus,
  coverageEvidencePath,
  controlDecision,
  microDecision,
}) => {
  const runtimeBlockerPath = path.join(OUTPUT_DIR, "blocker_registry.json");
  const runtimeRoiPath = path.join(OUTPUT_DIR, "brand_path_roi_registry.json");
  const canonicalBlockerPath = path.join(ACTIVE_CANONICAL_DIR, "blocker_registry.json");
  const canonicalRoiPath = path.join(ACTIVE_CANONICAL_DIR, "brand_path_roi_registry.json");
  const blockerRegistry = (await readOptionalJson(runtimeBlockerPath)) ?? {};
  const roiRegistry = (await readOptionalJson(runtimeRoiPath)) ?? {};

  blockerRegistry["kpi:official_fetch_unresolved/iherb_identity_v2"] = {
    blockerClass: identityBlockerClass,
    lane: "kpi",
    evidencePath: identityEvidencePath,
    unpauseCondition:
      identityStatus === "proven"
        ? "Scale only on the same repaired sub-cause."
        : "Require a stronger discovery path or a control-valid identity method.",
    status: identityStatus,
    lastReviewedWaveId: currentManifest.waveId,
    canonicalPath: canonicalBlockerPath,
  };
  blockerRegistry["coverage:now_foods/official_warnings_path_light_retarget"] = {
    blockerClass: coverageStatus === "proven" ? "proven_light_retarget_path" : "light_retarget_needs_new_narrower_cohort",
    lane: "coverage",
    evidencePath: coverageEvidencePath,
    unpauseCondition: coverageStatus === "proven" ? "Continue only on similarly narrow high-signal cohorts." : "Require a fresh narrower NOW cohort.",
    status: coverageStatus,
    lastReviewedWaveId: currentManifest.waveId,
    canonicalPath: canonicalBlockerPath,
  };

  const updateRoiEntry = (pathKey, resultLike, fallbackDecision = "pause") => {
    const previousEntry = roiRegistry[pathKey];
    const uplift = Number(resultLike.recoveredComplete ?? 0);
    roiRegistry[pathKey] = {
      totalBatchesRun: Number(previousEntry?.totalBatchesRun ?? 0) + 1,
      totalCompleteUplift: Number(previousEntry?.totalCompleteUplift ?? 0) + uplift,
      lastBatchUplift: uplift,
      lastTwoBatchPattern: computePatternFromPrevious(previousEntry, uplift),
      currentDecision: resultLike.decision ?? fallbackDecision,
      lastWaveId: resultLike.waveId,
    };
  };

  updateRoiEntry(
    "official_fetch_unresolved:iherb_identity_v2_discovery_compare",
    {
      waveId: POSITIVE_CONTROL_WAVE_ID,
      recoveredComplete: 0,
      decision: controlDecision,
    },
    controlDecision,
  );
  updateRoiEntry(
    "official_fetch_unresolved:iherb_identity_v2_discovery_rerun",
    {
      waveId: POSITIVE_CONTROL_RERUN_WAVE_ID,
      recoveredComplete: 0,
      decision: controlDecision,
    },
    controlDecision,
  );
  updateRoiEntry(
    "official_fetch_unresolved:iherb_identity_v2_micro_canary",
    {
      waveId: MICRO_CANARY_WAVE_ID,
      recoveredComplete: currentResult.pathKey === "official_fetch_unresolved:iherb_identity_v2_micro_canary" ? currentResult.recoveredComplete : 0,
      decision: microDecision,
    },
    microDecision,
  );
  if (!roiRegistry["official_fetch_unresolved:iherb_identity_v2_positive_control_debug"]) {
    roiRegistry["official_fetch_unresolved:iherb_identity_v2_positive_control_debug"] = {
      totalBatchesRun: 0,
      totalCompleteUplift: 0,
      lastBatchUplift: 0,
      lastTwoBatchPattern: "not_enough_history",
      currentDecision: "pause",
      lastWaveId: null,
    };
  }
  if (!roiRegistry["official_fetch_unresolved:iherb_identity_v2_positive_control_rerun"]) {
    roiRegistry["official_fetch_unresolved:iherb_identity_v2_positive_control_rerun"] = {
      totalBatchesRun: 0,
      totalCompleteUplift: 0,
      lastBatchUplift: 0,
      lastTwoBatchPattern: "not_enough_history",
      currentDecision: "pause",
      lastWaveId: null,
    };
  }
  if (currentResult.pathKey === "NOW Foods:official_warnings_path_light_retarget") {
    updateRoiEntry("NOW Foods:official_warnings_path_light_retarget", currentResult, currentResult.decision);
  } else if (!roiRegistry["NOW Foods:official_warnings_path_light_retarget"]) {
    roiRegistry["NOW Foods:official_warnings_path_light_retarget"] = {
      totalBatchesRun: 0,
      totalCompleteUplift: 0,
      lastBatchUplift: 0,
      lastTwoBatchPattern: "not_enough_history",
      currentDecision: "retarget",
      lastWaveId: null,
    };
  }

  await writeJson(runtimeBlockerPath, blockerRegistry);
  await writeJson(runtimeRoiPath, roiRegistry);
  await writeJson(canonicalBlockerPath, blockerRegistry);
  await writeJson(canonicalRoiPath, roiRegistry);
};

const runPositiveControlPass = async ({
  rows,
  selectionNotes,
  adapterMode,
  waveId,
  previousReasonById,
  concreteFixApplied = null,
  extractionMode = IHERB_SEARCH_EXTRACTION_MODE,
  hasClearSourceImprovement = false,
}) => {
  setFetchAdapterMode(adapterMode);
  setDiscoveryWavePass(waveId);
  setIherbSearchExtractionMode(extractionMode);
  searchCache.clear();
  const healthStart = snapshotExecutionHealth();
  const tracedRows = [];
  for (const row of rows) {
    console.error(`[week2_5] ${adapterMode} positive_control ${row.brandName} | ${row.productName}`);
    const discoveryTrace = await resolveIdentityRow(row, {
      previousReason: previousReasonById.get(normalizeText(row.candidateId)) ?? null,
      control: true,
      cacheNamespace: "repo_composite_v2",
      extractionMode,
    });
    const expectedPageTrace = await traceExpectedPage(row);
    const failureLocus = classifyDiscoveryFailure(
      row,
      buildTitleModels(row.productName ?? row.title, row.brandName),
      discoveryTrace.queriesTried,
      new Set(discoveryTrace.queryFamiliesHit ?? []),
      discoveryTrace.candidateUrlsFound ?? [],
      expectedPageTrace,
    );
    const controlOutcome =
      discoveryTrace.result === "control_hit"
        ? "discovery_hit"
        : expectedPageTrace.accepted
          ? "expected_only"
          : expectedPageTrace.expectedPageSeen
            ? "expected_seen_rejected"
            : "expected_not_seen";
    tracedRows.push({
      ...row,
      discoveryTrace: {
        queriesTried: discoveryTrace.queriesTried,
        queryFamiliesHit: discoveryTrace.queryFamiliesHit,
        candidateUrlsFound: discoveryTrace.candidateUrlsFound,
        fetchedCandidateCount: discoveryTrace.fetchedCandidateCount,
        acceptedCandidateCount: discoveryTrace.acceptedCandidateCount,
        topCandidateScores: discoveryTrace.topCandidateScores,
        acceptanceRejectReason: discoveryTrace.acceptanceRejectReason,
        rootCause: discoveryTrace.rootCause,
        rootCauseConfidence: discoveryTrace.rootCauseConfidence,
        expectedPageSeen: discoveryTrace.expectedPageSeen,
        controlOutcome,
        fetchTrace: discoveryTrace.fetchTrace ?? [],
      },
      expectedPageTrace,
      failureLocus,
      fetchTrace: [...(discoveryTrace.fetchTrace ?? []), ...(expectedPageTrace.fetchTrace ?? [])],
    });
  }
  const executionHealthDelta = diffExecutionHealth(healthStart);
  const discoveryHits = tracedRows.filter((row) => row.discoveryTrace.controlOutcome === "discovery_hit").length;
  const expectedPageAccepts = tracedRows.filter((row) => row.expectedPageTrace.accepted).length;
  const controlValidity =
    expectedPageAccepts >= 6 && discoveryHits >= 4
      ? "fixed"
      : expectedPageAccepts >= 4 && discoveryHits > 0 && hasClearSourceImprovement
        ? "redefined"
        : "invalid";
  const locusCounts = tracedRows.reduce((acc, row) => {
    acc[row.failureLocus] = (acc[row.failureLocus] ?? 0) + 1;
    return acc;
  }, {});
  const sortedLoci = Object.entries(locusCounts).sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0]));
  const primaryFailureLocus = sortedLoci[0]?.[0] ?? "other";
  const secondaryFailureLocus = sortedLoci[1]?.[0] ?? "other";
  const brandLevelLoci = Object.fromEntries(
    IDENTITY_BRANDS.map((brandName) => {
      const brandRows = tracedRows.filter((row) => normalizeLower(row.brandName) === normalizeLower(brandName));
      const counts = brandRows.reduce((acc, row) => {
        acc[row.failureLocus] = (acc[row.failureLocus] ?? 0) + 1;
        return acc;
      }, {});
      const sorted = Object.entries(counts).sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0]));
      return [brandName, { primary: sorted[0]?.[0] ?? "other", secondary: sorted[1]?.[0] ?? "other" }];
    }),
  );
  return {
    generatedAt: new Date().toISOString(),
    waveId,
    strategy: adapterMode === "curl_reader" ? "iherb_identity_v2_fetch_remediation" : "iherb_identity_v2_debug",
    selectionNotes,
    concreteFixApplied,
    rows: tracedRows,
    summary: {
      attempted: tracedRows.length,
      discoveryHits,
      expectedPageAccepts,
      controlValidity,
      hasClearSourceImprovement,
    },
    failureLocus: {
      primaryFailureLocus,
      secondaryFailureLocus,
      brandLevelLoci,
    },
    executionHealth: executionHealthDelta,
  };
};

const computeSourceFamilyDelta = (beforeSummary, afterSummary) => {
  const families = new Set([...Object.keys(beforeSummary ?? {}), ...Object.keys(afterSummary ?? {})]);
  return Object.fromEntries(
    [...families].map((sourceFamily) => {
      const before = beforeSummary?.[sourceFamily] ?? {};
      const after = afterSummary?.[sourceFamily] ?? {};
      return [
        sourceFamily,
        {
          expectedPageSeenDelta: Number(after.expectedPageSeenRows ?? 0) - Number(before.expectedPageSeenRows ?? 0),
          finalAcceptedDelta: Number(after.finalAcceptedRows ?? 0) - Number(before.finalAcceptedRows ?? 0),
          candidateExtractionDelta: Number(after.candidateExtractionCount ?? 0) - Number(before.candidateExtractionCount ?? 0),
          http429Delta: Number(after.http429 ?? 0) - Number(before.http429 ?? 0),
          abortedDelta: Number(after.aborted ?? 0) - Number(before.aborted ?? 0),
        },
      ];
    }),
  );
};

const classifyDiscoverySourceFailureRow = (comparisonRow, rerunRow) => {
  const bySource = Object.fromEntries((comparisonRow?.sourceComparisons ?? []).map((source) => [source.sourceFamily, source]));
  const expectedReject = normalizeLower(rerunRow?.expectedPageTrace?.expectedPageRejectedReason ?? "");
  if (!rerunRow?.expectedPageTrace?.accepted) {
    if (/fetch_failed/i.test(expectedReject)) {
      return { primary: "fetch_defect", subCause: expectedReject || "expected_page_fetch_failed" };
    }
    if (/weak_title_overlap|full_normalized_title_mismatch|core_ingredient_title_mismatch|strength_mismatch|count_mismatch|form_mismatch/.test(expectedReject)) {
      return { primary: "normalization_defect", subCause: "compatibility_mismatch" };
    }
    return { primary: "acceptance_defect", subCause: "expected_page_rejected" };
  }
  if (
    bySource.iherb_reader_search?.expectedInRawButNotEmitted ||
    bySource.brand_specific_source_path?.expectedInRawButNotEmitted ||
    bySource.repo_composite_v2?.expectedInRawButNotEmitted
  ) {
    return { primary: "source_selection_defect", subCause: "candidate_extraction_gap" };
  }
  if (
    ((bySource.search_engine_site_fallback?.http429 ?? 0) > 0 || (bySource.repo_composite_v2?.http429 ?? 0) > 0) &&
    (bySource.iherb_reader_search?.candidateCount ?? 0) === 0 &&
    (bySource.search_engine_site_fallback?.candidateCount ?? 0) === 0
  ) {
    return { primary: "source_rate_limit_defect", subCause: "search_engine_rate_limit" };
  }
  if (
    rerunRow?.discoveryTrace?.rootCause === "query_generation_gap" ||
    ((bySource.iherb_reader_search?.rawHasExpectedTitle ?? false) === false &&
      (bySource.brand_specific_source_path?.rawHasExpectedTitle ?? false) === false &&
      (bySource.search_engine_site_fallback?.candidateCount ?? 0) > 0)
  ) {
    return { primary: "query_generation_defect", subCause: "query_tokens_missed" };
  }
  if (
    (bySource.iherb_reader_search?.candidateCount ?? 0) === 0 &&
    (bySource.brand_specific_source_path?.candidateCount ?? 0) === 0 &&
    (bySource.search_engine_site_fallback?.candidateCount ?? 0) === 0 &&
    (bySource.sitemap_source?.candidateCount ?? 0) === 0
  ) {
    return { primary: "source_coverage_gap", subCause: "not_proven_on_iherb_us_under_current_strict_methods" };
  }
  return { primary: "other", subCause: "mixed_or_unresolved" };
};

const main = async () => {
  await fs.mkdir(OUT_DIR, { recursive: true });
  await fs.mkdir(OUTPUT_WAVES_DIR, { recursive: true });
  await fs.mkdir(ACTIVE_CANONICAL_DIR, { recursive: true });
  await fs.mkdir(HISTORY_CANONICAL_DIR, { recursive: true });

  execNode(path.join(ROOT, "scripts", "maintainer", "build-high-frequency-remaining-gap-breakdown.mjs"));

  const [baselineMerge, baselineHighFrequency, officialFetchQueue, previousReport, baselineStaging] = await Promise.all([
    readJson(BASELINE_MERGE_REPORT_PATH),
    readJson(BASELINE_HIGH_FREQUENCY_PATH),
    readJson(path.join(GAP_QUEUE_DIR, "official_fetch_unresolved.json")),
    readJson(PREVIOUS_KPI_REPORT_PATH),
    readJson(BASELINE_STAGING_PATH),
  ]);

  const startingBaseline = {
    strictMergeReady: Number(baselineMerge?.summary?.strictMergeReady ?? 0),
    queued: Number(baselineMerge?.summary?.queued ?? 0),
    completeHitCount: Number(baselineHighFrequency?.summary?.completeHitCount ?? 0),
    completeHitRate: Number(baselineHighFrequency?.summary?.completeHitRate ?? 0),
    activeQueueCount: Number(baselineHighFrequency?.summary?.activeQueueCount ?? 0),
  };

  const stagingRows = Array.isArray(baselineStaging?.products) ? baselineStaging.products : [];
  const positiveControlSelection = buildPositiveControlDebugSet(stagingRows);
  const positiveControls = positiveControlSelection.rows;
  const previousReasonById = new Map(
    (Array.isArray(previousReport?.canary?.rows) ? previousReport.canary.rows : Array.isArray(previousReport?.unresolvedRows) ? previousReport.unresolvedRows : []).map((row) => [
      normalizeText(row.candidateId),
      row.reason ?? row.rootCause,
    ]),
  );

  const positiveManifest = {
    waveId: POSITIVE_CONTROL_WAVE_ID,
    lane: "kpi",
    pathKey: "official_fetch_unresolved:iherb_identity_v2_discovery_compare",
    cohortSource: path.join(OUT_DIR, "identity_positive_control_debug_queue.json"),
    brands: IDENTITY_BRANDS,
    queryStrategy: "discovery_source_comparison_pre_fix",
    sourcePriority: [
      "iherb_reader_search",
      "repo_composite_v2",
      "search_engine_site_fallback",
      "sitemap_source",
      "brand_specific_source_path",
    ],
    stopRules: ["Repair exactly one discovery/source defect before rerunning positive control."],
    successMetric: "identify whether discovery failure is source coverage, source selection, query generation, or rate limiting",
    newMethod: true,
    unpauseRationale: "This wave compares all discovery source families on the same positive-control rows before repair.",
    baselineRef: startingBaseline,
    touchedBrandPaths: ["official_fetch_unresolved:iherb_identity_v2_discovery_compare"],
    touchedBlockerKeys: ["kpi:official_fetch_unresolved/iherb_identity_v2"],
  };
  await writeJson(path.join(OUT_DIR, "identity_positive_control_debug_queue.json"), positiveControls);
  const preFixComparisonReport = await buildDiscoverySourceComparisonReport({
    rows: positiveControls,
    previousReasonById,
    waveId: POSITIVE_CONTROL_WAVE_ID,
    extractionMode: "legacy",
  });
  const candidateExtractionGapRows = preFixComparisonReport.rows.filter(
    (row) =>
      row.sourceComparisons.some(
        (source) => source.sourceFamily === "iherb_reader_search" && source.expectedInRawButNotEmitted,
      ) ||
      row.sourceComparisons.some(
        (source) => source.sourceFamily === "brand_specific_source_path" && source.expectedInRawButNotEmitted,
      ),
  ).length;
  await writeJson(DISCOVERY_SOURCE_COMPARISON_JSON_PATH, preFixComparisonReport);
  await writeText(DISCOVERY_SOURCE_COMPARISON_MD_PATH, buildDiscoverySourceComparisonMarkdown(preFixComparisonReport));
  await copyFile(DISCOVERY_SOURCE_COMPARISON_MD_PATH, path.join(ACTIVE_CANONICAL_DIR, "discovery_source_comparison.md"));

  const fetchTracePositiveControl = {
    generatedAt: new Date().toISOString(),
    waveId: POSITIVE_CONTROL_WAVE_ID,
    rows: preFixComparisonReport.rows.map((row) => ({
      brandName: row.brandName,
      productName: row.productName,
      fetchTrace: row.sourceComparisons.flatMap((source) => source.fetchTrace ?? []).concat(row.expectedPageTrace.fetchTrace ?? []),
    })),
    summary: {
      attempted: preFixComparisonReport.rows.length,
      primaryAdapter: "curl_reader",
      blockedOrCaptchaDetected: preFixComparisonReport.rows
        .flatMap((row) => row.sourceComparisons.flatMap((source) => source.fetchTrace ?? []).concat(row.expectedPageTrace.fetchTrace ?? []))
        .filter((trace) => trace.blockedOrCaptchaDetected).length,
      cookieWallDetected: preFixComparisonReport.rows
        .flatMap((row) => row.sourceComparisons.flatMap((source) => source.fetchTrace ?? []).concat(row.expectedPageTrace.fetchTrace ?? []))
        .filter((trace) => trace.cookieWallDetected).length,
    },
  };
  await writeJson(FETCH_TRACE_POSITIVE_CONTROL_JSON_PATH, fetchTracePositiveControl);
  await writeText(FETCH_TRACE_POSITIVE_CONTROL_MD_PATH, buildFetchTraceMarkdown(fetchTracePositiveControl));

  const positiveResult = {
    waveId: POSITIVE_CONTROL_WAVE_ID,
    lane: "kpi",
    pathKey: "official_fetch_unresolved:iherb_identity_v2_discovery_compare",
    attempted: preFixComparisonReport.summary.attempted,
    recoveredComplete: 0,
    recoveredPartial: 0,
    kpiDelta: { completeHitCount: 0, completeHitRate: 0, activeQueueCount: 0 },
    mergeDelta: { strictMergeReady: 0, queued: 0 },
    blockerBreakdown: {
      candidate_extraction_gap: candidateExtractionGapRows,
      source_families: Object.keys(preFixComparisonReport.summary.sourceFamilies).length,
    },
    decision: "retarget",
    outcomeClass: "diagnostic_success",
    evidencePath: DISCOVERY_SOURCE_COMPARISON_JSON_PATH,
    executionHealth: preFixComparisonReport.executionHealth,
    executed: true,
  };
  await syncCurrentAndHistory({
    manifest: positiveManifest,
    result: positiveResult,
    historyManifestPath: POSITIVE_CONTROL_HISTORY_MANIFEST_PATH,
    historyResultPath: POSITIVE_CONTROL_HISTORY_RESULT_PATH,
    markdownCopies: [
      { sourcePath: DISCOVERY_SOURCE_COMPARISON_MD_PATH, canonicalName: "discovery_source_comparison.md" },
    ],
  });

  const concreteDiscoveryFix =
    "Improved iherb_reader_search candidate extraction and ordering to capture markdown links, bare /pr URLs, and prioritize expected-page matches ahead of search-engine fallbacks.";
  const postFixComparisonReport = await buildDiscoverySourceComparisonReport({
    rows: positiveControls,
    previousReasonById,
    waveId: `${POSITIVE_CONTROL_RERUN_WAVE_ID}_compare`,
    extractionMode: "remediated",
    concreteFixApplied: concreteDiscoveryFix,
  });
  const sourceFamilyDelta = computeSourceFamilyDelta(
    preFixComparisonReport.summary.sourceFamilies,
    postFixComparisonReport.summary.sourceFamilies,
  );
  const hasClearSourceImprovement = Object.values(sourceFamilyDelta).some(
    (delta) => delta.expectedPageSeenDelta > 0 || delta.candidateExtractionDelta > 0,
  );

  const positiveRerunManifest = {
    waveId: POSITIVE_CONTROL_RERUN_WAVE_ID,
    lane: "kpi",
    pathKey: "official_fetch_unresolved:iherb_identity_v2_discovery_rerun",
    cohortSource: path.join(OUT_DIR, "identity_positive_control_debug_queue.json"),
    brands: IDENTITY_BRANDS,
    queryStrategy: "discovery_source_rerun_post_fix",
    sourcePriority: ["iherb_reader_search", "repo_composite_v2", "expected_page_trace"],
    stopRules: ["Only rerun the same 8 positive control rows after one concrete discovery/source repair."],
    successMetric: "prove or invalidate the repaired discovery lane before unresolved recovery",
    newMethod: true,
    unpauseRationale: concreteDiscoveryFix,
    baselineRef: startingBaseline,
    touchedBrandPaths: ["official_fetch_unresolved:iherb_identity_v2_discovery_rerun"],
    touchedBlockerKeys: ["kpi:official_fetch_unresolved/iherb_identity_v2"],
  };
  const positiveRerunCore = await runPositiveControlPass({
    rows: positiveControls,
    selectionNotes: positiveControlSelection.notes,
    adapterMode: "curl_reader",
    waveId: POSITIVE_CONTROL_RERUN_WAVE_ID,
    previousReasonById,
    concreteFixApplied: concreteDiscoveryFix,
    extractionMode: "remediated",
    hasClearSourceImprovement,
  });
  const positiveRerunReport = {
    ...positiveRerunCore,
    sourceFamilyDelta,
    postFixSourceFamilies: postFixComparisonReport.summary.sourceFamilies,
  };
  await writeJson(DISCOVERY_POSITIVE_CONTROL_RERUN_JSON_PATH, positiveRerunReport);
  await writeText(DISCOVERY_POSITIVE_CONTROL_RERUN_MD_PATH, buildDiscoveryPositiveControlRerunMarkdown(positiveRerunReport));
  await copyFile(DISCOVERY_POSITIVE_CONTROL_RERUN_MD_PATH, path.join(ACTIVE_CANONICAL_DIR, "discovery_positive_control_rerun.md"));
  await writeJson(POSITIVE_CONTROL_RERUN_JSON_PATH, positiveRerunReport);
  await writeText(POSITIVE_CONTROL_RERUN_MD_PATH, buildPositiveControlRerunMarkdown(positiveRerunReport));
  await copyFile(POSITIVE_CONTROL_RERUN_MD_PATH, path.join(ACTIVE_CANONICAL_DIR, "identity_positive_control_rerun.md"));

  const controlValidity = positiveRerunReport.summary.controlValidity;
  const rowFailureEntries = positiveRerunReport.rows.map((row) => {
    const comparisonRow =
      postFixComparisonReport.rows.find((candidate) => normalizeText(candidate.candidateId) === normalizeText(row.candidateId)) ?? null;
    return {
      candidateId: row.candidateId,
      brandName: row.brandName,
      ...classifyDiscoverySourceFailureRow(comparisonRow, row),
    };
  });
  const locusCounts = rowFailureEntries.reduce((acc, row) => {
    acc[row.primary] = (acc[row.primary] ?? 0) + 1;
    return acc;
  }, {});
  const sortedLoci = Object.entries(locusCounts).sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0]));
  const primaryFailureLocus = sortedLoci[0]?.[0] ?? "other";
  const secondaryFailureLocus = sortedLoci[1]?.[0] ?? "other";
  const brandLevelLoci = Object.fromEntries(
    IDENTITY_BRANDS.map((brandName) => {
      const brandRows = rowFailureEntries.filter((row) => normalizeLower(row.brandName) === normalizeLower(brandName));
      const counts = brandRows.reduce((acc, row) => {
        acc[row.primary] = (acc[row.primary] ?? 0) + 1;
        return acc;
      }, {});
      const sorted = Object.entries(counts).sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0]));
      const primary = sorted[0]?.[0] ?? "other";
      const secondary = sorted[1]?.[0] ?? "other";
      const subCause =
        brandRows.find((row) => row.primary === primary)?.subCause ??
        brandRows[0]?.subCause ??
        "mixed_or_unresolved";
      return [brandName, { primary, secondary, subCause }];
    }),
  );
  const failureLocusReport = {
    generatedAt: new Date().toISOString(),
    primaryFailureLocus,
    secondaryFailureLocus,
    brandLevelLoci,
    counts: locusCounts,
    executableNow: Object.fromEntries(
      Object.keys(locusCounts).map((locus) => [
        locus,
        ["source_selection_defect", "query_generation_defect", "source_rate_limit_defect", "normalization_defect"].includes(locus),
      ]),
    ),
    concreteFixAttempted: concreteDiscoveryFix,
    rowLevelSubCauses: rowFailureEntries,
    methodScopeNote: "All absence-style findings remain scoped to current strict identity methods and do not assert catalog absence.",
  };
  await writeJson(DISCOVERY_SOURCE_FAILURE_LOCUS_JSON_PATH, failureLocusReport);
  await writeText(DISCOVERY_SOURCE_FAILURE_LOCUS_MD_PATH, buildFailureLocusMarkdown(failureLocusReport));
  await copyFile(DISCOVERY_SOURCE_FAILURE_LOCUS_MD_PATH, path.join(ACTIVE_CANONICAL_DIR, "discovery_source_failure_locus.md"));
  await writeJson(FAILURE_LOCUS_JSON_PATH, failureLocusReport);
  await writeText(FAILURE_LOCUS_MD_PATH, buildFailureLocusMarkdown(failureLocusReport));
  await copyFile(FAILURE_LOCUS_MD_PATH, path.join(ACTIVE_CANONICAL_DIR, "identity_lane_failure_locus.md"));

  const positiveRerunOutcomeClass =
    controlValidity === "fixed"
      ? "execution_success"
      : controlValidity === "redefined"
        ? "strategy_proof"
        : primaryFailureLocus !== "other"
          ? "diagnostic_success"
          : "no_signal";
  const positiveRerunDecision = controlValidity === "invalid" ? "pause" : controlValidity === "fixed" ? "scale" : "retarget";
  const positiveRerunResult = {
    waveId: POSITIVE_CONTROL_RERUN_WAVE_ID,
    lane: "kpi",
    pathKey: "official_fetch_unresolved:iherb_identity_v2_discovery_rerun",
    attempted: positiveRerunReport.summary.attempted,
    recoveredComplete: 0,
    recoveredPartial: 0,
    kpiDelta: { completeHitCount: 0, completeHitRate: 0, activeQueueCount: 0 },
    mergeDelta: { strictMergeReady: 0, queued: 0 },
    blockerBreakdown: locusCounts,
    decision: positiveRerunDecision,
    outcomeClass: positiveRerunOutcomeClass,
    evidencePath: DISCOVERY_POSITIVE_CONTROL_RERUN_JSON_PATH,
    executionHealth: positiveRerunReport.executionHealth,
    executed: true,
  };
  await syncCurrentAndHistory({
    manifest: positiveRerunManifest,
    result: positiveRerunResult,
    historyManifestPath: POSITIVE_CONTROL_RERUN_HISTORY_MANIFEST_PATH,
    historyResultPath: POSITIVE_CONTROL_RERUN_HISTORY_RESULT_PATH,
    markdownCopies: [
      { sourcePath: DISCOVERY_POSITIVE_CONTROL_RERUN_MD_PATH, canonicalName: "discovery_positive_control_rerun.md" },
      { sourcePath: DISCOVERY_SOURCE_FAILURE_LOCUS_MD_PATH, canonicalName: "discovery_source_failure_locus.md" },
    ],
  });
  await updateHarnessRegistries({
    currentManifest: positiveRerunManifest,
    currentResult: positiveRerunResult,
    identityStatus: controlValidity === "fixed" ? "proven" : controlValidity === "redefined" ? "hold" : "paused",
    identityBlockerClass: primaryFailureLocus,
    identityEvidencePath: DISCOVERY_SOURCE_FAILURE_LOCUS_JSON_PATH,
    coverageStatus: "paused",
    coverageEvidencePath: PREVIOUS_NOW_RETARGET_REPORT_PATH,
    controlDecision: positiveRerunDecision,
    microDecision: "pause",
  });
  execNode(path.join(ROOT, "scripts", "maintainer", "validate-wave-harness-state.mjs"));

  const microManifest = {
    waveId: MICRO_CANARY_WAVE_ID,
    lane: "kpi",
    pathKey: "official_fetch_unresolved:iherb_identity_v2_micro_canary",
    cohortSource: path.join(OUT_DIR, "official_fetch_unresolved_micro_canary_queue.json"),
    brands: IDENTITY_BRANDS,
    queryStrategy: "iherb_identity_v2_debug_retarget",
    sourcePriority: ["brand_specific_queries", "iherb_search", "search_engine_fallback", "strict_page_acceptance"],
    stopRules: ["Scale only on >=2 safe recoveries.", "Skip entirely when controlValidity is invalid."],
    successMetric: "safe recoveries on the repaired discovery sub-cause",
    newMethod: true,
    unpauseRationale: "Micro-canary uses the repaired discovery method and is stage-gated by positive control validity.",
    baselineRef: startingBaseline,
    touchedBrandPaths: ["official_fetch_unresolved:iherb_identity_v2_micro_canary"],
    touchedBlockerKeys: ["kpi:official_fetch_unresolved/iherb_identity_v2"],
  };

  let microCanaryReport;
  let currentStagingPath = BASELINE_STAGING_PATH;
  let postMicroReports = null;
  let microDecision = "pause";
  let microResult;
  if (controlValidity === "invalid") {
    microCanaryReport = {
      generatedAt: new Date().toISOString(),
      executed: false,
      skipReason: "positive_control_invalid",
      decision: primaryFailureLocus !== "other" ? "pause" : "pause",
      outcomeClass: primaryFailureLocus !== "other" ? "diagnostic_success" : "no_signal",
      recoveredComplete: 0,
      recoveredPartial: 0,
      rows: [],
      executionHealth: { requests: 0, fetchSuccess: 0, http429: 0, aborted: 0, cacheHits: 0, retryCount: 0 },
    };
    microDecision = "pause";
    microResult = {
      waveId: MICRO_CANARY_WAVE_ID,
      lane: "kpi",
      pathKey: "official_fetch_unresolved:iherb_identity_v2_micro_canary",
      attempted: 0,
      recoveredComplete: 0,
      recoveredPartial: 0,
      kpiDelta: { completeHitCount: 0, completeHitRate: 0, activeQueueCount: 0 },
      mergeDelta: { strictMergeReady: 0, queued: 0 },
      blockerBreakdown: locusCounts,
      decision: "pause",
      outcomeClass: primaryFailureLocus !== "other" ? "diagnostic_success" : "no_signal",
      evidencePath: MICRO_CANARY_JSON_PATH,
      executionHealth: microCanaryReport.executionHealth,
      executed: false,
      skipReason: "positive_control_invalid",
    };
  } else {
    const targetReasons =
      ["acceptance_defect", "normalization_defect"].includes(primaryFailureLocus)
        ? ["no_iherb_page_match_after_fetch"]
        : ["no_iherb_candidate_found", "not_proven_on_iherb_us_current_methods"];
    const microQueue = buildMicroCanarySelection(Array.isArray(officialFetchQueue) ? officialFetchQueue : [], previousReport, {
      targetReasons,
      allowedBrands: ["Healthy Origins", "Pure Encapsulations", "Nature's Bounty", "Schiff"],
    });
    await writeJson(path.join(OUT_DIR, "official_fetch_unresolved_micro_canary_queue.json"), microQueue);
    const microHealthStart = snapshotExecutionHealth();
    const microRows = [];
    for (const row of microQueue) {
      console.error(`[week2_5] micro_canary ${row.brandName} | ${row.productName}`);
      const trace = await resolveIdentityRow(row, {
        previousReason: previousReasonById.get(normalizeText(row.candidateId)) ?? null,
        control: false,
      });
      microRows.push({
        ...row,
        queryFamilyUsed: trace.queryFamiliesHit?.[0] ?? null,
        candidateDiscoveryImproved: Boolean((trace.candidateUrlsFound ?? []).length > 0),
        trace,
      });
    }
    const { refreshedRows, mergedRows } = mergeAcceptedCanaryRows(stagingRows, microRows.map((row) => row.trace));
    currentStagingPath = path.join(OUT_DIR, `staging_products.${MICRO_CANARY_WAVE_ID}.json`);
    await writeJson(currentStagingPath, { products: refreshedRows });
    const recoveredPartialQueue = buildRecoveredPartialQueue(refreshedRows, mergedRows);
    if (recoveredPartialQueue.length > 0) {
      const groupedByBrand = recoveredPartialQueue.reduce((acc, row) => {
        const key = normalizeLower(row.brandName);
        if (!acc[key]) acc[key] = [];
        acc[key].push(row);
        return acc;
      }, {});
      for (const rows of Object.values(groupedByBrand)) {
        const brandName = rows[0].brandName;
        const configPath = path.join(CONFIG_DIR, `${slugify(brandName)}.json`);
        const queuePath = path.join(OUT_DIR, `micro_fallback_queue_${slugify(brandName)}.json`);
        const outDir = path.join(OUT_DIR, `${slugify(brandName)}_micro_official_fallback_${WAVE_TS}`);
        await writeJson(queuePath, rows);
        execNode(path.join(ROOT, "scripts", "maintainer", "refresh-iherb-overlay-p0-by-official-fallback.mjs"), [
          "--config-json",
          configPath,
          "--staging-json",
          currentStagingPath,
          "--queue-json",
          queuePath,
          "--brand",
          brandName,
          "--priority-lane",
          "P0_api_fill_us_strong_identity",
          "--limit",
          String(rows.length),
          "--request-timeout-ms",
          "10000",
          "--max-retries",
          "1",
          "--agent-browser-fallback",
          "false",
          "--out-dir",
          outDir,
        ]);
        currentStagingPath = path.join(outDir, "staging_products.official_refreshed.json");
      }
    }
    postMicroReports = rerunReports(`week2_5_identity_micro_canary_${WAVE_TS}`, currentStagingPath);
    const [microMerge, microHighFrequency] = await Promise.all([
      readJson(postMicroReports.mergeReportPath),
      readJson(postMicroReports.highFrequencyPath),
    ]);
    const recoveredComplete = mergedRows.filter((row) => row.result === "recovered_complete").length;
    const recoveredPartial = mergedRows.filter((row) => row.result === "recovered_partial").length;
    const discoveryImprovedCount = microRows.filter((row) => row.candidateDiscoveryImproved).length;
    microDecision = recoveredComplete >= 2 ? "scale" : recoveredComplete + recoveredPartial >= 1 || discoveryImprovedCount >= 2 ? "retarget" : "pause";
    const microOutcomeClass =
      recoveredComplete >= 2 ? "execution_success" : recoveredComplete + recoveredPartial >= 1 || discoveryImprovedCount >= 2 ? "strategy_proof" : "no_signal";
    microCanaryReport = {
      generatedAt: new Date().toISOString(),
      executed: true,
      skipReason: null,
      decision: microDecision,
      outcomeClass: microOutcomeClass,
      recoveredComplete,
      recoveredPartial,
      rows: microRows.map((row) => ({
        candidateId: row.candidateId,
        brandName: row.brandName,
        productName: row.productName,
        preFixSubCause: row.preFixSubCause,
        queryFamilyUsed: row.queryFamilyUsed,
        candidateDiscoveryImproved: row.candidateDiscoveryImproved,
        result: row.trace.result,
        safeRecoveryType:
          row.trace.result === "recovered_complete"
            ? "complete"
            : row.trace.result === "recovered_partial"
              ? "partial"
              : "none",
        finalBlockerClass:
          row.trace.result === "recovered_complete" || row.trace.result === "recovered_partial"
            ? null
            : row.trace.rootCause ?? "not_proven_on_iherb_us_under_current_strict_methods",
      })),
      executionHealth: diffExecutionHealth(microHealthStart),
    };
    microResult = {
      waveId: MICRO_CANARY_WAVE_ID,
      lane: "kpi",
      pathKey: "official_fetch_unresolved:iherb_identity_v2_micro_canary",
      attempted: microQueue.length,
      recoveredComplete,
      recoveredPartial,
      kpiDelta: {
        completeHitCount: Number(microHighFrequency?.summary?.completeHitCount ?? 0) - startingBaseline.completeHitCount,
        completeHitRate: Number(microHighFrequency?.summary?.completeHitRate ?? 0) - startingBaseline.completeHitRate,
        activeQueueCount: Number(microHighFrequency?.summary?.activeQueueCount ?? 0) - startingBaseline.activeQueueCount,
      },
      mergeDelta: {
        strictMergeReady: Number(microMerge?.summary?.strictMergeReady ?? 0) - startingBaseline.strictMergeReady,
        queued: Number(microMerge?.summary?.queued ?? 0) - startingBaseline.queued,
      },
      blockerBreakdown: {
        candidateDiscoveryImproved: discoveryImprovedCount,
        unresolved: microQueue.length - recoveredComplete - recoveredPartial,
      },
      decision: microDecision,
      outcomeClass: microOutcomeClass,
      evidencePath: MICRO_CANARY_JSON_PATH,
      executionHealth: microCanaryReport.executionHealth,
      executed: true,
    };
  }
  await writeJson(MICRO_CANARY_JSON_PATH, microCanaryReport);
  await writeText(MICRO_CANARY_MD_PATH, buildMicroCanaryMarkdown(microCanaryReport));
  await copyFile(MICRO_CANARY_MD_PATH, path.join(ACTIVE_CANONICAL_DIR, "official_fetch_unresolved_micro_canary.md"));
  await syncCurrentAndHistory({
    manifest: microManifest,
    result: microResult,
    historyManifestPath: MICRO_CANARY_HISTORY_MANIFEST_PATH,
    historyResultPath: MICRO_CANARY_HISTORY_RESULT_PATH,
    markdownCopies: [{ sourcePath: MICRO_CANARY_MD_PATH, canonicalName: "official_fetch_unresolved_micro_canary.md" }],
  });
  await updateHarnessRegistries({
    currentManifest: microManifest,
    currentResult: microResult,
    identityStatus: controlValidity === "invalid" ? "paused" : microDecision === "scale" ? "proven" : microDecision === "retarget" ? "hold" : "paused",
    identityBlockerClass: primaryFailureLocus,
    identityEvidencePath: DISCOVERY_SOURCE_FAILURE_LOCUS_JSON_PATH,
    coverageStatus: "hold",
    coverageEvidencePath: PREVIOUS_NOW_RETARGET_REPORT_PATH,
    controlDecision: positiveRerunDecision,
    microDecision,
  });
  execNode(path.join(ROOT, "scripts", "maintainer", "validate-wave-harness-state.mjs"));

  const buildLightNowQueue = async (stagingPath) => {
    const stagingJson = await readJson(stagingPath);
    const rows = Array.isArray(stagingJson?.products) ? stagingJson.products : [];
    const previousIds = new Set();
    for (const reportPath of [
      path.join(ROOT, "output", "now_foods_week2_remaining_batch1_20260313", "official_fallback_report.json"),
      path.join(ROOT, "output", "now_foods_week2_remaining_batch2_20260313", "official_fallback_report.json"),
      path.join(ROOT, "output", "week2_5_root_cause", "now_retarget_20260314T082518Z", "official_fallback_report.json"),
    ]) {
      const report = await readOptionalJson(reportPath);
      for (const row of report?.rows ?? []) {
        if (normalizeText(row.productId)) previousIds.add(normalizeText(row.productId));
      }
    }
    return rows
      .filter((row) => normalizeLower(row.brandName) === "now foods")
      .filter((row) => !previousIds.has(normalizeText(row.productId)))
      .filter((row) => Boolean(row?.readiness?.highConfidenceUsProductPageReady) && Boolean(row?.sourceSummary?.hasUsIherbPage))
      .filter((row) => JSON.stringify([...(row?.completeness?.coreMissingFields ?? [])].sort()) === JSON.stringify(["warnings"]))
      .filter((row) => !EXHAUSTED_NOW_FAMILY_RE.test(row.title))
      .map((row) => ({
        ...buildSearchQueueRow(row),
        coreMissingFields: row?.completeness?.coreMissingFields ?? [],
        highConfidenceUsProductPageReady: Boolean(row?.readiness?.highConfidenceUsProductPageReady),
        hasUsIherbPage: Boolean(row?.sourceSummary?.hasUsIherbPage),
        preferred: PREFERRED_NOW_TITLE_RE.test(row.title),
      }))
      .sort((left, right) => {
        if (Number(right.preferred) !== Number(left.preferred)) return Number(right.preferred) - Number(left.preferred);
        return normalizeText(left.title).localeCompare(normalizeText(right.title));
      })
      .slice(0, NOW_RETARGET_LIMIT)
      .map(({ preferred, ...row }) => row);
  };

  const lightNowQueue = await buildLightNowQueue(currentStagingPath);
  const nowQueuePath = path.join(OUT_DIR, `now_light_queue_${WAVE_TS}.json`);
  await writeJson(nowQueuePath, lightNowQueue);
  const carlsonResidueAnalysis = await readOptionalJson(path.join(ROOT, "output", "carlson_week2_residue_analysis_20260313.json"));
  const hasExecutableCarlsonPath = Number(carlsonResidueAnalysis?.unseenRemaining ?? 0) > 0;
  const coverageExecutable = lightNowQueue.length > 0 || hasExecutableCarlsonPath;
  if (lightNowQueue.length === 0 && !hasExecutableCarlsonPath) {
    await writeText(
      NO_EXECUTABLE_COVERAGE_BATCH_PATH,
      [
        "# No Executable Coverage Batch",
        "",
        `- generatedAt: ${new Date().toISOString()}`,
        "- NOW Foods light retarget queue is empty on the current staging line.",
        `- Carlson unseenRemaining: ${Number(carlsonResidueAnalysis?.unseenRemaining ?? 0)}`,
        "- No other proven/retargetable coverage path was executable in this sprint.",
      ].join("\n") + "\n",
    );
  }
  let coverageReport = { summary: { queued: 0, becameFullOverlayReady: 0 }, executionHealth: { requests: 0, fetchSuccess: 0, http429: 0, aborted: 0, cacheHits: 0, retryCount: 0 } };
  let finalStagingPath = currentStagingPath;
  if (lightNowQueue.length > 0) {
    const coverageOutDir = path.join(OUT_DIR, `now_light_${WAVE_TS}`);
    execNode(path.join(ROOT, "scripts", "maintainer", "refresh-iherb-overlay-p0-by-official-fallback.mjs"), [
      "--config-json",
      NOW_CONFIG_PATH,
      "--staging-json",
      currentStagingPath,
      "--queue-json",
      nowQueuePath,
      "--brand",
      "NOW Foods",
      "--priority-lane",
      "P0_api_fill_us_strong_identity",
      "--limit",
      String(lightNowQueue.length),
      "--request-timeout-ms",
      "10000",
      "--max-retries",
      "1",
      "--agent-browser-fallback",
      "false",
      "--out-dir",
      coverageOutDir,
    ]);
    coverageReport = await readJson(path.join(coverageOutDir, "official_fallback_report.json"));
    finalStagingPath = path.join(coverageOutDir, "staging_products.official_refreshed.json");
  }
  let endingMerge = baselineMerge;
  let endingExecution = await readJson(BASELINE_EXECUTION_PLAN_PATH);
  let endingHighFrequency = baselineHighFrequency;
  let endingPartial = await readJson(BASELINE_PARTIAL_WAVE_PLAN_PATH);
  let coverageDecision = "pause";
  let coverageResult = {
    waveId: COVERAGE_WAVE_ID,
    lane: "coverage",
    pathKey: "NOW Foods:official_warnings_path_light_retarget",
    attempted: 0,
    recoveredComplete: 0,
    recoveredPartial: 0,
    kpiDelta: { completeHitCount: 0, completeHitRate: 0, activeQueueCount: 0 },
    mergeDelta: { strictMergeReady: 0, queued: 0 },
    blockerBreakdown: {},
    decision: "pause",
    outcomeClass: "no_signal",
    evidencePath: NO_EXECUTABLE_COVERAGE_BATCH_PATH,
    executionHealth: { requests: 0, fetchSuccess: 0, http429: 0, aborted: 0, cacheHits: 0, retryCount: 0 },
    executed: false,
  };
  if (lightNowQueue.length > 0) {
    const coverageManifest = {
      waveId: COVERAGE_WAVE_ID,
      lane: "coverage",
      pathKey: "NOW Foods:official_warnings_path_light_retarget",
      cohortSource: nowQueuePath,
      brands: ["NOW Foods"],
      queryStrategy: "official_warnings_path_light_retarget",
      sourcePriority: ["official_page", "product_sections", "ocr_fallback"],
      stopRules: ["Scale on >=4 complete.", "Retarget on 1-3 complete.", "Pause on 0 complete."],
      successMetric: "positive complete uplift on a narrower NOW Foods cohort",
      newMethod: true,
      unpauseRationale: "This is narrower than the exhausted NOW path and excludes prior failed families.",
      baselineRef: startingBaseline,
      touchedBrandPaths: ["NOW Foods:official_warnings_path_light_retarget"],
      touchedBlockerKeys: ["coverage:now_foods/official_warnings_path_light_retarget"],
    };
    const coverageReports = rerunReports(`week2_5_coverage_now_light_${WAVE_TS}`, finalStagingPath);
    [endingMerge, endingExecution, endingHighFrequency, endingPartial] = await Promise.all([
      readJson(coverageReports.mergeReportPath),
      readJson(coverageReports.executionPlanPath),
      readJson(coverageReports.highFrequencyPath),
      readJson(coverageReports.partialWavePlanPath),
    ]);
    const coverageUplift = Number(coverageReport?.summary?.becameFullOverlayReady ?? 0);
    coverageDecision = coverageUplift >= 4 ? "scale" : coverageUplift > 0 ? "retarget" : "pause";
    const coverageOutcomeClass = coverageUplift >= 4 ? "execution_success" : coverageUplift > 0 ? "strategy_proof" : "no_signal";
    coverageResult = {
      waveId: COVERAGE_WAVE_ID,
      lane: "coverage",
      pathKey: "NOW Foods:official_warnings_path_light_retarget",
      attempted: Number(coverageReport?.summary?.queued ?? lightNowQueue.length),
      recoveredComplete: coverageUplift,
      recoveredPartial: 0,
      kpiDelta: {
        completeHitCount: Number(endingHighFrequency?.summary?.completeHitCount ?? 0) - startingBaseline.completeHitCount,
        completeHitRate: Number(endingHighFrequency?.summary?.completeHitRate ?? 0) - startingBaseline.completeHitRate,
        activeQueueCount: Number(endingHighFrequency?.summary?.activeQueueCount ?? 0) - startingBaseline.activeQueueCount,
      },
      mergeDelta: {
        strictMergeReady: Number(endingMerge?.summary?.strictMergeReady ?? 0) - startingBaseline.strictMergeReady,
        queued: Number(endingMerge?.summary?.queued ?? 0) - startingBaseline.queued,
      },
      blockerBreakdown: {
        improvedRows: Number(coverageReport?.summary?.improvedRows ?? 0),
        stillMissingWarnings: Number(coverageReport?.summary?.stillMissingWarnings ?? 0),
        stillMissingSuggestedUse: Number(coverageReport?.summary?.stillMissingSuggestedUse ?? 0),
      },
      decision: coverageDecision,
      outcomeClass: coverageOutcomeClass,
      evidencePath: path.join(OUT_DIR, `now_light_${WAVE_TS}`, "official_fallback_report.json"),
      executionHealth: coverageReport?.executionHealth ?? { requests: 0, fetchSuccess: 0, http429: 0, aborted: 0, cacheHits: 0, retryCount: 0 },
      executed: true,
    };
    await syncCurrentAndHistory({
      manifest: coverageManifest,
      result: coverageResult,
      historyManifestPath: COVERAGE_HISTORY_MANIFEST_PATH,
      historyResultPath: COVERAGE_HISTORY_RESULT_PATH,
      markdownCopies: [],
    });
    await updateHarnessRegistries({
      currentManifest: coverageManifest,
      currentResult: coverageResult,
      identityStatus: controlValidity === "invalid" ? "paused" : microDecision === "scale" ? "proven" : microDecision === "retarget" ? "hold" : "paused",
      identityBlockerClass: primaryFailureLocus,
      identityEvidencePath: DISCOVERY_SOURCE_FAILURE_LOCUS_JSON_PATH,
      coverageStatus: coverageDecision === "scale" || coverageDecision === "retarget" ? "proven" : "paused",
      coverageEvidencePath: coverageResult.evidencePath,
      controlDecision: positiveRerunDecision,
      microDecision,
    });
    execNode(path.join(ROOT, "scripts", "maintainer", "validate-wave-harness-state.mjs"));
  } else {
    await updateHarnessRegistries({
      currentManifest: microManifest,
      currentResult: microResult,
      identityStatus: controlValidity === "invalid" ? "paused" : microDecision === "scale" ? "proven" : microDecision === "retarget" ? "hold" : "paused",
      identityBlockerClass: primaryFailureLocus,
      identityEvidencePath: DISCOVERY_SOURCE_FAILURE_LOCUS_JSON_PATH,
      coverageStatus: "paused",
      coverageEvidencePath: NO_EXECUTABLE_COVERAGE_BATCH_PATH,
      controlDecision: positiveRerunDecision,
      microDecision,
    });
    execNode(path.join(ROOT, "scripts", "maintainer", "validate-wave-harness-state.mjs"));
  }

  const endingBaseline = {
    strictMergeReady: Number(endingMerge?.summary?.strictMergeReady ?? startingBaseline.strictMergeReady),
    queued: Number(endingMerge?.summary?.queued ?? startingBaseline.queued),
    completeHitCount: Number(endingHighFrequency?.summary?.completeHitCount ?? startingBaseline.completeHitCount),
    completeHitRate: Number(endingHighFrequency?.summary?.completeHitRate ?? startingBaseline.completeHitRate),
    activeQueueCount: Number(endingHighFrequency?.summary?.activeQueueCount ?? startingBaseline.activeQueueCount),
  };

  const compatibilityRootCauseReport = {
    schemaVersion: "week2_5_identity_recovery_root_cause_report.v2",
    generatedAt: new Date().toISOString(),
    waveId: POSITIVE_CONTROL_RERUN_WAVE_ID,
    strategy: "iherb_identity_v2_discovery_source_remediation",
    positiveControl: {
      attempted: positiveRerunReport.summary.attempted,
      successful: positiveRerunReport.summary.discoveryHits,
      harnessValid: controlValidity !== "invalid",
      rows: positiveRerunReport.rows,
    },
    summary: {
      recoveredComplete: Number(microCanaryReport.recoveredComplete ?? 0),
      recoveredPartial: Number(microCanaryReport.recoveredPartial ?? 0),
      outcomeClass: microResult.outcomeClass,
      decision: microResult.decision,
      controlValidity,
      isBetterIsolated: primaryFailureLocus !== "other",
    },
    failureLocus: failureLocusReport,
    microCanary: microCanaryReport,
  };
  await writeJson(ROOT_CAUSE_REPORT_JSON_PATH, compatibilityRootCauseReport);
  await writeText(
    ROOT_CAUSE_REPORT_MD_PATH,
    buildRootCauseMarkdown({
      generatedAt: compatibilityRootCauseReport.generatedAt,
      strategy: compatibilityRootCauseReport.strategy,
      bucket: {
        totalRows: Array.isArray(officialFetchQueue) ? officialFetchQueue.length : 0,
        observedRows: positiveRerunReport.rows.length,
        fullBucketBreakdown: {
          source_selection_defect: locusCounts.source_selection_defect ?? 0,
          source_coverage_gap: locusCounts.source_coverage_gap ?? 0,
          query_generation_defect: locusCounts.query_generation_defect ?? 0,
          source_rate_limit_defect: locusCounts.source_rate_limit_defect ?? 0,
          fetch_defect: locusCounts.fetch_defect ?? 0,
          normalization_defect: locusCounts.normalization_defect ?? 0,
          acceptance_defect: locusCounts.acceptance_defect ?? 0,
          other: locusCounts.other ?? 0,
        },
      },
      positiveControl: compatibilityRootCauseReport.positiveControl,
      canary: {
        recoveredComplete: compatibilityRootCauseReport.summary.recoveredComplete,
        recoveredPartial: compatibilityRootCauseReport.summary.recoveredPartial,
        rows: microCanaryReport.rows ?? [],
      },
      brandBreakdown: IDENTITY_BRANDS.map((brandName) => ({
        brandName,
        attempted: positiveRerunReport.rows.filter((row) => normalizeLower(row.brandName) === normalizeLower(brandName)).length,
        recoveredComplete: 0,
        recoveredPartial: 0,
        queryGenerationGap: rowFailureEntries.filter((row) => normalizeLower(row.brandName) === normalizeLower(brandName) && row.primary === "query_generation_defect").length,
        variantMismatch: 0,
      })),
      summary: compatibilityRootCauseReport.summary,
    }),
  );

  const summaryLines = [
    "# Week 2.5 Discovery Source Remediation Summary",
    "",
    "## Starting Baseline",
    `- strictMergeReady: \`${startingBaseline.strictMergeReady}\``,
    `- queued: \`${startingBaseline.queued}\``,
    `- completeHitCount: \`${startingBaseline.completeHitCount}\``,
    `- completeHitRate: \`${startingBaseline.completeHitRate}%\``,
    `- activeQueueCount: \`${startingBaseline.activeQueueCount}\``,
    "",
    "## Ending Baseline",
    `- strictMergeReady: \`${endingBaseline.strictMergeReady}\``,
    `- queued: \`${endingBaseline.queued}\``,
    `- completeHitCount: \`${endingBaseline.completeHitCount}\``,
    `- completeHitRate: \`${endingBaseline.completeHitRate}%\``,
    `- activeQueueCount: \`${endingBaseline.activeQueueCount}\``,
    "",
    "## Discovery Repair",
    `- exactDefect: \`iherb_reader_search candidate extraction / ordering\``,
    `- concreteFixApplied: \`${concreteDiscoveryFix}\``,
    "",
    "## Positive Control Rerun",
    `- controlValidity: \`${controlValidity}\``,
    `- discoveryHits: \`${positiveRerunReport.summary.discoveryHits}/${positiveRerunReport.summary.attempted}\``,
    `- expectedPageAccepts: \`${positiveRerunReport.summary.expectedPageAccepts}/${positiveRerunReport.summary.attempted}\``,
    "",
    "## Micro Canary",
    `- executed: \`${microCanaryReport.executed}\``,
    `- decision: \`${microCanaryReport.decision}\``,
    `- recoveredComplete: \`${microCanaryReport.recoveredComplete}\``,
    `- recoveredPartial: \`${microCanaryReport.recoveredPartial}\``,
    "",
    "## Coverage",
    `- executablePathRemained: \`${coverageExecutable}\``,
    `- decision: \`${coverageResult.decision}\``,
    "",
    "## Updated Lane State",
    `- official_fetch_unresolved: \`${controlValidity === "invalid" ? "paused" : microDecision === "scale" ? "proven" : microDecision === "retarget" ? "retargetable" : "paused"}\``,
    `- blockerState: \`${controlValidity === "invalid" ? primaryFailureLocus : "hold"}\``,
  ];
  await writeText(FINAL_SUMMARY_PATH, `${summaryLines.join("\n")}\n`);
  await writeText(DISCOVERY_SOURCE_SUMMARY_PATH, `${summaryLines.join("\n")}\n`);
  await writeText(FETCH_LANE_SUMMARY_PATH, `${summaryLines.join("\n")}\n`);

  console.log(
    JSON.stringify(
      {
        ok: true,
        outputs: {
          discoverySourceComparisonJson: DISCOVERY_SOURCE_COMPARISON_JSON_PATH,
          discoveryPositiveControlRerunJson: DISCOVERY_POSITIVE_CONTROL_RERUN_JSON_PATH,
          discoverySourceFailureLocusJson: DISCOVERY_SOURCE_FAILURE_LOCUS_JSON_PATH,
          microCanaryJson: MICRO_CANARY_JSON_PATH,
          summaryMd: DISCOVERY_SOURCE_SUMMARY_PATH,
          blockerRegistry: path.join(OUTPUT_DIR, "blocker_registry.json"),
          brandPathRoiRegistry: path.join(OUTPUT_DIR, "brand_path_roi_registry.json"),
          waveManifestCurrent: CURRENT_MANIFEST_PATH,
          waveResultCurrent: CURRENT_RESULT_PATH,
        },
        startingBaseline,
        endingBaseline,
        controlValidity,
        microDecision,
        coverageDecision,
      },
      null,
      2,
    ),
  );
};

main().catch((error) => {
  console.error(error instanceof Error ? error.stack : String(error));
  process.exit(1);
});
