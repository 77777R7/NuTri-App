#!/usr/bin/env node
/* eslint-disable no-console */

import fs from "node:fs";
import path from "node:path";
import { performance } from "node:perf_hooks";
import { spawnSync } from "node:child_process";

import dotenv from "dotenv";

const ROOT_DIR = process.cwd();
dotenv.config({ path: path.join(ROOT_DIR, "backend", ".env") });
dotenv.config({ path: path.join(ROOT_DIR, ".env") });

const API_BASE_URL = process.env.API_BASE_URL || process.env.RENDER_BASE_URL || "http://127.0.0.1:3001";
const REGRESSION_TOKEN = process.env.RENDER_REGRESSION_TOKEN || process.env.REGRESSION_AUTH_TOKEN || "";

const TARGET_CA = Number(process.env.WEB_E2E_TARGET_CA || 15);
const TARGET_US = Number(process.env.WEB_E2E_TARGET_US || 15);
const MAX_PRODUCT_PAGES_PER_SITE = Number(process.env.WEB_E2E_MAX_PRODUCT_PAGES_PER_SITE || 260);
const MAX_SITEMAPS_PER_SITE = Number(process.env.WEB_E2E_MAX_SITEMAPS_PER_SITE || 8);
const REQUEST_TIMEOUT_MS = Number(process.env.WEB_E2E_HTTP_TIMEOUT_MS || 18_000);
const SSE_TIMEOUT_MS = Number(process.env.WEB_E2E_SSE_TIMEOUT_MS || 50_000);
const ANALYSIS_TIMEOUT_MS = Number(process.env.WEB_E2E_ANALYSIS_TIMEOUT_MS || 20_000);
const RETRY_DELAYS_MS = [300, 900, 2_000];
const DEFAULT_RETRIES = Number(process.env.WEB_E2E_RETRIES || 2);
const DEFAULT_SSE_STOP_ON = process.env.WEB_E2E_SSE_STOP_ON || "revision1";
const DEFAULT_SSE_STOP_TAIL_MS = Number(process.env.WEB_E2E_SSE_STOP_TAIL_MS || 5000);
const DEFAULT_PHASE_MODE = (process.env.WEB_E2E_PHASE_MODE || "phase1").toLowerCase();
const PROMOTION_PASS_THRESHOLD = Number(process.env.WEB_E2E_SUITE_B_PROMOTION_THRESHOLD || 10);
const RAW_DONE_WARN_THRESHOLD = Number(process.env.WEB_E2E_RAW_DONE_WARN_THRESHOLD || 0.9);
const RAW_DONE_SHADOW_HARD_THRESHOLD = Number(process.env.WEB_E2E_RAW_DONE_SHADOW_HARD_THRESHOLD || 0.9);
const RAW_DONE_HARD_ENFORCE =
  String(process.env.WEB_E2E_RAW_DONE_HARD_ENFORCE || "")
    .trim()
    .toLowerCase() === "true" ||
  String(process.env.WEB_E2E_RAW_DONE_HARD_ENFORCE || "")
    .trim() === "1";
const PROMOTION_STATE_FILE =
  process.env.WEB_E2E_PROMOTION_STATE_FILE || path.join(ROOT_DIR, "output", "website-barcode-e2e-promotion-state.json");
const BACKEND_HEALTH_CHECK_SCRIPT = path.join(ROOT_DIR, "scripts", "maintainer", "backend-health-check.sh");

const FIXTURE_DIR = path.join(ROOT_DIR, "scripts", "maintainer", "fixtures");
const DEFAULT_KB_FIXTURE = path.join(FIXTURE_DIR, "kb_barcodes.json");
const DEFAULT_WEB_FIXTURE = path.join(FIXTURE_DIR, "web_only_barcodes.json");

const OUT_DIR = (() => {
  const override = process.env.WEB_E2E_OUT_DIR ? String(process.env.WEB_E2E_OUT_DIR).trim() : "";
  if (!override) return path.join(ROOT_DIR, "output", `website-barcode-e2e-${Date.now()}`);
  return path.isAbsolute(override) ? override : path.join(ROOT_DIR, override);
})();

const USER_AGENT =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36";

const SUPPLEMENT_INCLUDE_KEYWORDS = [
  "supplement",
  "supplements",
  "vitamin",
  "mineral",
  "multivitamin",
  "probiotic",
  "omega",
  "amino",
  "creatine",
  "capsule",
  "capsules",
  "tablet",
  "tablets",
  "softgel",
  "softgels",
  "powder",
  "vcap",
  "vcaps",
  "medicinal ingredients",
  "non medicinal ingredients",
  "dietary supplement",
  "supplement facts",
];

const SUPPLEMENT_EXCLUDE_KEYWORDS = [
  "shampoo",
  "conditioner",
  "deodorant",
  "body wash",
  "cleanser",
  "face wash",
  "serum",
  "lotion",
  "cream",
  "ointment",
  "toothpaste",
  "soap",
  "fragrance",
  "perfume",
  "cosmetic",
  "makeup",
  "mascara",
  "lipstick",
  "sunscreen",
  "hair care",
  "skin care",
];

const SUPPLEMENT_HARD_SIGNAL_PATTERNS = [
  /\bsupplement facts\b/i,
  /\bmedicinal ingredients\b/i,
  /\bnon[-\s]?medicinal ingredients\b/i,
  /\bnpn\b/i,
  /\bdin-?hm\b/i,
  /\bserving size\b/i,
  /\bamount per serving\b/i,
];

const defaultHeaders = {
  "User-Agent": USER_AGENT,
  Accept: "*/*",
};

const AUTH_DISABLED_HEADER =
  process.env.RENDER_AUTH_DISABLED_HEADER ||
  (REGRESSION_TOKEN ? null : "1");

const apiHeaders = {
  "Content-Type": "application/json",
  Accept: "text/event-stream",
  ...(REGRESSION_TOKEN ? { "x-regression-token": REGRESSION_TOKEN } : {}),
  ...(AUTH_DISABLED_HEADER ? { "x-auth-disabled": AUTH_DISABLED_HEADER } : {}),
};

const SITE_CONFIGS = [
  {
    region: "CA",
    site: "nationalnutrition.ca",
    sitemapUrl: "https://www.nationalnutrition.ca/sitemap.xml",
    productUrlRegex: /https:\/\/www\.nationalnutrition\.ca\/[a-z0-9\-]+\.html$/i,
    ignoreUrlRegex: /\/(fr\/|blog|account|checkout|cart|contact|about|privacy|terms)/i,
  },
  {
    region: "US",
    site: "swansonvitamins.com",
    sitemapUrl: "https://www.swansonvitamins.com/sitemap.xml",
    productUrlRegex: /https:\/\/www\.swansonvitamins\.com\/(p|products)\//i,
    ignoreUrlRegex: /\/(blogs|pages|policies|account|cart|collections)/i,
  },
];

class E2eError extends Error {
  constructor(type, message, options = {}) {
    super(message);
    this.name = "E2eError";
    this.type = type;
    this.status = options.status ?? null;
    this.retryable = Boolean(options.retryable);
    this.retryAfterMs = Number.isFinite(options.retryAfterMs) ? Number(options.retryAfterMs) : null;
    this.cause = options.cause;
  }
}

const parseArgs = (argv) => {
  const options = {
    suite: "both",
    input: null,
    harvestOnly: false,
    buildWebFixture: false,
    gateOnly: false,
    skipPostchecks: false,
    retries: DEFAULT_RETRIES,
    sseStopOn: DEFAULT_SSE_STOP_ON,
    sseStopTailMs: DEFAULT_SSE_STOP_TAIL_MS,
    phaseMode: DEFAULT_PHASE_MODE,
  };

  const withValue = new Set(["--suite", "--input", "--retries", "--sse-stop-on", "--sse-stop-tail-ms", "--phase-mode"]);

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (!arg.startsWith("--")) continue;

    let flag = arg;
    let value = null;
    const eq = arg.indexOf("=");
    if (eq >= 0) {
      flag = arg.slice(0, eq);
      value = arg.slice(eq + 1);
    } else if (withValue.has(flag)) {
      value = argv[i + 1];
      i += 1;
    }

    if (flag === "--suite" && value) options.suite = String(value).toLowerCase();
    else if (flag === "--input" && value) options.input = path.isAbsolute(value) ? value : path.join(ROOT_DIR, value);
    else if (flag === "--harvest-only") options.harvestOnly = true;
    else if (flag === "--build-web-fixture") options.buildWebFixture = true;
    else if (flag === "--gate-only") options.gateOnly = true;
    else if (flag === "--skip-postchecks") options.skipPostchecks = true;
    else if (flag === "--retries" && value != null) options.retries = Number(value);
    else if (flag === "--sse-stop-on" && value) options.sseStopOn = String(value).toLowerCase();
    else if (flag === "--sse-stop-tail-ms" && value != null) options.sseStopTailMs = Number(value);
    else if (flag === "--phase-mode" && value) options.phaseMode = String(value).toLowerCase();
    else if (flag === "--help" || flag === "-h") {
      printUsage();
      process.exit(0);
    }
  }

  if (!["kb", "web", "both"].includes(options.suite)) {
    throw new Error(`Invalid --suite: ${options.suite}. Expected kb|web|both.`);
  }
  if (!["revision1", "fast_ai", "persisted"].includes(options.sseStopOn)) {
    throw new Error(`Invalid --sse-stop-on: ${options.sseStopOn}. Expected revision1|fast_ai|persisted.`);
  }
  if (!["phase1", "phase2"].includes(options.phaseMode)) {
    throw new Error(`Invalid --phase-mode: ${options.phaseMode}. Expected phase1|phase2.`);
  }
  if (!Number.isFinite(options.retries) || options.retries < 0) {
    throw new Error(`Invalid --retries: ${options.retries}`);
  }
  if (!Number.isFinite(options.sseStopTailMs) || options.sseStopTailMs < 0) {
    throw new Error(`Invalid --sse-stop-tail-ms: ${options.sseStopTailMs}`);
  }

  return options;
};

const printUsage = () => {
  console.log(`Website Barcode E2E (product-grade gate)

Usage:
  node scripts/maintainer/website-barcode-e2e.mjs [options]

Options:
  --suite kb|web|both
  --input <abs-json>
  --harvest-only
  --build-web-fixture
  --gate-only
  --skip-postchecks
  --retries <n>
  --sse-stop-on revision1|fast_ai|persisted
  --sse-stop-tail-ms <ms>
  --phase-mode phase1|phase2
`);
};

const toDigits = (value) => String(value ?? "").replace(/\D/g, "");

const toGtin14 = (value) => {
  const d = toDigits(value);
  if (!d) return null;
  if (d.length === 14) return d;
  if (d.length === 13) return `0${d}`;
  if (d.length === 12) return `00${d}`;
  if (d.length === 11) return `000${d}`;
  return null;
};

const parseXmlLocs = (xml) => {
  const out = [];
  const regex = /<loc>([^<]+)<\/loc>/gi;
  let m = regex.exec(xml);
  while (m) {
    out.push(m[1].trim());
    m = regex.exec(xml);
  }
  return out;
};

const parseTitle = (html) => {
  const m = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  return m ? m[1].replace(/\s+/g, " ").trim() : null;
};

const normalizeText = (value) =>
  String(value ?? "")
    .toLowerCase()
    .replace(/[^a-z0-9\s]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();

const hasSupplementHardSignals = (html) => {
  const compact = normalizeText(html).slice(0, 30_000);
  if (SUPPLEMENT_HARD_SIGNAL_PATTERNS.some((pattern) => pattern.test(compact))) return true;

  const jsonLdBlocks = [...String(html).matchAll(/<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi)];
  for (const block of jsonLdBlocks) {
    const raw = block[1]?.trim();
    if (!raw) continue;
    try {
      const parsed = JSON.parse(raw);
      const nodes = Array.isArray(parsed) ? parsed : [parsed];
      for (const node of nodes) {
        const type = node?.["@type"];
        const typeStr = Array.isArray(type) ? type.join(" ") : String(type ?? "");
        const hasProductType = /product/i.test(typeStr);
        const hasGtin = Boolean(node?.gtin || node?.gtin14 || node?.gtin13 || node?.gtin12 || node?.upc);
        if (hasProductType && hasGtin) return true;
      }
    } catch {
      // ignore invalid JSON-LD
    }
  }
  return false;
};

const classifySupplementIntent = ({ title, url, html }) => {
  const titleText = normalizeText(title);
  const urlText = normalizeText(url);
  const pageText = normalizeText(html).slice(0, 15_000);
  const corpus = `${titleText} ${urlText} ${pageText}`;

  const excludeHit = SUPPLEMENT_EXCLUDE_KEYWORDS.find((keyword) => corpus.includes(keyword));
  if (excludeHit) {
    return { isSupplement: false, reason: `exclude_keyword:${excludeHit}` };
  }

  const hardSignal = hasSupplementHardSignals(html);
  if (hardSignal) {
    return { isSupplement: true, reason: "hard_signal" };
  }

  const includeHit = SUPPLEMENT_INCLUDE_KEYWORDS.find((keyword) => corpus.includes(keyword));
  if (includeHit) {
    return { isSupplement: true, reason: `include_keyword:${includeHit}` };
  }

  return { isSupplement: false, reason: "missing_supplement_intent" };
};

const extractBarcodes = (html) => {
  const candidates = new Set();
  const patterns = [
    /"gtin(?:8|12|13|14)?"\s*:\s*"([0-9][0-9\-\s]{7,24})"/gi,
    /"upc"\s*:\s*"([0-9][0-9\-\s]{7,24})"/gi,
    /itemprop=["']gtin(?:8|12|13|14)?["']\s+content=["']([0-9][0-9\-\s]{7,24})["']/gi,
    /\b(?:UPC|GTIN|EAN|BARCODE)\s*[:#]?\s*([0-9][0-9\-\s]{7,24})\b/gi,
  ];
  for (const pattern of patterns) {
    let m = pattern.exec(html);
    while (m) {
      const gtin14 = toGtin14(m[1]);
      if (gtin14) candidates.add(gtin14);
      m = pattern.exec(html);
    }
  }
  return [...candidates];
};

const randomJitter = (ms) => Math.max(0, Math.round(ms * (0.85 + Math.random() * 0.3)));
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const isAbortLikeError = (error) => {
  const name = String(error?.name ?? "");
  const message = String(error?.message ?? error ?? "");
  return name === "AbortError" || /abort/i.test(message);
};

const errorTypeFromStatus = (status) => {
  if (status === 429) return "http_429";
  if (status >= 500) return "http_5xx";
  return `http_${status}`;
};

const classifyErrorType = (error) => {
  if (!error) return "unknown_error";
  if (error instanceof E2eError) return error.type;
  if (isAbortLikeError(error)) return "AbortError";
  const message = String(error?.message ?? error);
  if (/429/.test(message)) return "http_429";
  if (/\b5\d\d\b/.test(message)) return "http_5xx";
  return "unknown_error";
};

const withRetries = async (fn, options = {}) => {
  const retries = Math.max(0, Number(options.retries ?? DEFAULT_RETRIES));
  let attempt = 0;
  let retryUsed = 0;

  while (true) {
    try {
      const value = await fn(attempt);
      return { value, retryUsed };
    } catch (error) {
      const type = classifyErrorType(error);
      const retryable =
        error instanceof E2eError
          ? error.retryable
          : type === "AbortError" || type === "http_429" || type === "http_5xx";

      if (!retryable || attempt >= retries) {
        if (error && typeof error === "object") {
          error.retryUsed = retryUsed;
        }
        throw error;
      }

      const retryAfterMs =
        error instanceof E2eError && Number.isFinite(error.retryAfterMs) && error.retryAfterMs > 0
          ? error.retryAfterMs
          : RETRY_DELAYS_MS[Math.min(attempt, RETRY_DELAYS_MS.length - 1)];
      const delayMs = randomJitter(retryAfterMs);
      options.onRetry?.({ attempt: attempt + 1, delayMs, errorType: type, error });
      await sleep(delayMs);
      attempt += 1;
      retryUsed += 1;
    }
  }
};

const fetchWithTimeout = async (url, options = {}, timeoutMs = REQUEST_TIMEOUT_MS) => {
  const ctrl = new AbortController();
  const timeout = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    return await fetch(url, { ...options, signal: ctrl.signal });
  } finally {
    clearTimeout(timeout);
  }
};

const fetchText = async (url, timeoutMs = REQUEST_TIMEOUT_MS) => {
  try {
    const res = await fetchWithTimeout(
      url,
      {
        headers: defaultHeaders,
        redirect: "follow",
      },
      timeoutMs,
    );
    if (!res.ok) return null;
    return await res.text();
  } catch {
    return null;
  }
};

const parseBrand = (html) => {
  const jsonLdBlocks = [...html.matchAll(/<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi)];
  for (const block of jsonLdBlocks) {
    const raw = block[1]?.trim();
    if (!raw) continue;
    try {
      const parsed = JSON.parse(raw);
      const nodes = Array.isArray(parsed) ? parsed : [parsed];
      for (const node of nodes) {
        const brand = node?.brand;
        if (typeof brand === "string" && brand.trim()) return brand.trim();
        if (brand && typeof brand === "object" && typeof brand.name === "string" && brand.name.trim()) {
          return brand.name.trim();
        }
      }
    } catch {
      // ignore invalid blocks
    }
  }
  return null;
};

const normalizeFixtureEntry = (entry, index, defaults = {}) => {
  const barcode = toGtin14(entry?.barcode);
  if (!barcode) return null;
  const expectedScoreAvailableRaw =
    typeof entry?.expectedScoreAvailable === "boolean"
      ? entry.expectedScoreAvailable
      : typeof defaults.expectedScoreAvailable === "boolean"
        ? defaults.expectedScoreAvailable
        : null;
  return {
    barcode,
    region: String(entry?.region || defaults.region || "US").toUpperCase(),
    site: String(entry?.site || defaults.site || "fixture"),
    expectedSourceType: entry?.expectedSourceType ? String(entry.expectedSourceType).toLowerCase() : defaults.expectedSourceType ?? null,
    expectedScoreAvailable: expectedScoreAvailableRaw,
    verifiedAt: entry?.verifiedAt ? String(entry.verifiedAt) : defaults.verifiedAt ?? new Date().toISOString().slice(0, 10),
    sourceUrl: entry?.sourceUrl ? String(entry.sourceUrl) : defaults.sourceUrl ?? null,
    notes: entry?.notes ? String(entry.notes) : defaults.notes ?? "",
    title: entry?.title ? String(entry.title) : defaults.title ?? "",
    brand: entry?.brand ? String(entry.brand) : defaults.brand ?? "",
    index,
  };
};

const readJson = async (filePath) => {
  const raw = await fs.promises.readFile(filePath, "utf8");
  return JSON.parse(raw);
};

const writeJson = async (filePath, data) => {
  await fs.promises.mkdir(path.dirname(filePath), { recursive: true });
  await fs.promises.writeFile(filePath, JSON.stringify(data, null, 2), "utf8");
};

const parseFixtureInput = async (inputPath) => {
  const loaded = await readJson(inputPath);
  if (Array.isArray(loaded)) {
    const all = loaded
      .map((entry, idx) => normalizeFixtureEntry(entry, idx))
      .filter(Boolean);
    return {
      all,
      kb: all.filter((entry) => entry.expectedSourceType !== "web"),
      web: all.filter((entry) => entry.expectedSourceType === "web"),
    };
  }

  if (loaded && typeof loaded === "object") {
    const kbList = Array.isArray(loaded.kb) ? loaded.kb : [];
    const webList = Array.isArray(loaded.web) ? loaded.web : [];
    const allList = Array.isArray(loaded.all) ? loaded.all : [...kbList, ...webList];
    const kb = kbList
      .map((entry, idx) => normalizeFixtureEntry(entry, idx, { expectedSourceType: "dsld", expectedScoreAvailable: true }))
      .filter(Boolean);
    const web = webList
      .map((entry, idx) => normalizeFixtureEntry(entry, idx, { expectedSourceType: "web", expectedScoreAvailable: false }))
      .filter(Boolean);
    const all = allList.map((entry, idx) => normalizeFixtureEntry(entry, idx)).filter(Boolean);
    return {
      all,
      kb: kb.length ? kb : all.filter((entry) => entry.expectedSourceType !== "web"),
      web: web.length ? web : all.filter((entry) => entry.expectedSourceType === "web"),
    };
  }

  throw new Error(`Invalid fixture format: ${inputPath}`);
};

const resolveFixtureInputs = async (options) => {
  if (options.input) {
    return parseFixtureInput(options.input);
  }

  const kbLoaded = await parseFixtureInput(DEFAULT_KB_FIXTURE).catch(() => ({ all: [], kb: [], web: [] }));
  const webLoaded = await parseFixtureInput(DEFAULT_WEB_FIXTURE).catch(() => ({ all: [], kb: [], web: [] }));
  return {
    all: [...kbLoaded.all, ...webLoaded.all],
    kb: kbLoaded.kb.length ? kbLoaded.kb : kbLoaded.all,
    web: webLoaded.web.length ? webLoaded.web : webLoaded.all,
  };
};

const harvestFromSite = async (config, targetCount) => {
  const harvested = [];
  const filteredOut = [];
  const seenBarcodes = new Set();
  const seenUrls = new Set();

  const sitemapIndex = await fetchText(config.sitemapUrl);
  if (!sitemapIndex) {
    return { harvested, failed: [`sitemap_unreachable:${config.sitemapUrl}`], filteredOut };
  }

  const sitemapLocs = parseXmlLocs(sitemapIndex);
  const prioritized = sitemapLocs.filter((u) => /sitemap.*(product|_00|products)/i.test(u));
  const candidates = [...new Set([...prioritized, ...sitemapLocs])].slice(0, MAX_SITEMAPS_PER_SITE);
  const failed = [];

  for (const sitemapUrl of candidates) {
    if (harvested.length >= targetCount || seenUrls.size >= MAX_PRODUCT_PAGES_PER_SITE) break;
    const xml = await fetchText(sitemapUrl);
    if (!xml) {
      failed.push(`sitemap_read_failed:${sitemapUrl}`);
      continue;
    }

    const locs = parseXmlLocs(xml)
      .filter((u) => config.productUrlRegex.test(u))
      .filter((u) => !config.ignoreUrlRegex.test(u));

    for (const url of locs) {
      if (harvested.length >= targetCount || seenUrls.size >= MAX_PRODUCT_PAGES_PER_SITE) break;
      if (seenUrls.has(url)) continue;
      seenUrls.add(url);

      const html = await fetchText(url);
      if (!html) continue;

      const supplementIntent = classifySupplementIntent({ title: parseTitle(html) || "", url, html });
      if (!supplementIntent.isSupplement) {
        filteredOut.push({
          region: config.region,
          site: config.site,
          url,
          reason: supplementIntent.reason,
        });
        continue;
      }

      const barcodes = extractBarcodes(html);
      if (!barcodes.length) continue;

      const title = parseTitle(html);
      const brand = parseBrand(html);
      for (const barcode of barcodes) {
        if (seenBarcodes.has(barcode)) continue;
        seenBarcodes.add(barcode);
        harvested.push({
          region: config.region,
          site: config.site,
          url,
          barcode,
          title: title || "",
          brand: brand || "",
          supplementFilterReason: supplementIntent.reason,
        });
        if (harvested.length >= targetCount) break;
      }
    }
  }

  return { harvested, failed, filteredOut };
};

const shouldStopOnEvent = (event, stopOn) => {
  if (stopOn === "persisted") {
    if (event?.event !== "persisted") return false;
    return Number(event?.data?.revision) >= 1;
  }
  if (event?.event !== "analysis_bundle") return false;
  if (!event.data || typeof event.data !== "object") return false;
  const meta = event.data.meta;
  if (!meta || typeof meta !== "object") return false;

  if (stopOn === "fast_ai") return meta.phase === "fast_ai";
  if (stopOn === "revision1") return Number(meta.revision) >= 1;
  return false;
};

const buildMetaFromPersistedEvent = (persistedData) => {
  if (!persistedData || typeof persistedData !== "object") return null;
  const identity = persistedData.identity;
  if (!identity || typeof identity !== "object") return null;
  if (typeof identity.type !== "string" || typeof identity.value !== "string") return null;
  const factsDigestHash =
    typeof persistedData.factsDigestHash === "string" && persistedData.factsDigestHash.trim()
      ? persistedData.factsDigestHash
      : null;
  if (!factsDigestHash) return null;

  const promptVersion =
    typeof persistedData.promptVersion === "string" && persistedData.promptVersion.trim()
      ? persistedData.promptVersion
      : "reg_v4.0";
  const locale =
    typeof persistedData.locale === "string" && (persistedData.locale === "en" || persistedData.locale === "zh")
      ? persistedData.locale
      : "en";

  return {
    authoritativeIdentity: {
      type: identity.type,
      value: identity.value,
    },
    factsDigestHash,
    promptVersion,
    locale,
    scoreAvailable: typeof persistedData.scoreAvailable === "boolean" ? persistedData.scoreAvailable : null,
    sourceType: typeof persistedData.sourceType === "string" ? persistedData.sourceType : null,
  };
};

let runPersistedReadinessProbe = async () => ({
  attempted: false,
  ready: true,
  reason: null,
  overviewStatus: null,
  usageStatus: null,
  contracts: null,
});

const fetchSseOnce = async (url, payload, options) => {
  const ctrl = new AbortController();
  const timeoutMs = options.timeoutMs ?? SSE_TIMEOUT_MS;
  const timeout = setTimeout(() => ctrl.abort(), timeoutMs);
  const start = performance.now();
  const events = [];
  let bytesReceived = 0;
  let lastEventType = null;
  let lastEventAtMs = null;
  let parseErrorCount = 0;
  let streamClosed = false;
  let timedOut = false;
  let abortError = false;
  let doneSeen = false;
  let stopEvent = null;
  let persistedProbe = {
    attempted: false,
    ready: null,
    reason: null,
    overviewStatus: null,
    usageStatus: null,
    contracts: null,
  };
  const partial = () => ({
    events,
    stopEvent,
    bytesReceived,
    lastEventType,
    lastEventAtMs,
    parseErrorCount,
    streamClosed,
    timedOut,
    abortError,
    doneSeen,
    persistedProbe,
  });

  try {
    const res = await fetch(url, {
      method: "POST",
      headers: apiHeaders,
      body: JSON.stringify(payload),
      signal: ctrl.signal,
    });

    if (!res.ok) {
      const text = await res.text().catch(() => "");
      const status = res.status;
      throw new E2eError(errorTypeFromStatus(status), `SSE failed ${status}: ${text.slice(0, 200)}`, {
        status,
        retryable: status === 429 || status >= 500,
        retryAfterMs: status === 429 ? 1000 : null,
      });
    }

    const reader = res.body?.getReader();
    if (!reader) {
      throw new E2eError("parse_failed", "SSE stream reader unavailable", {
        retryable: false,
      });
    }

    const decoder = new TextDecoder();
    let buffer = "";
    let currentEvent = null;
    let currentData = "";
    let sawStopMarker = false;

    const flush = () => {
      if (!currentEvent) return;
      const dataRaw = currentData.trim();
      if (!dataRaw) {
        currentEvent = null;
        currentData = "";
        return;
      }
      const tMs = Math.round(performance.now() - start);
      let parsed = dataRaw;
      try {
        parsed = JSON.parse(dataRaw);
      } catch {
        parseErrorCount += 1;
        // keep raw string
      }
      const event = { tMs, event: currentEvent, data: parsed };
      events.push(event);
      lastEventType = event.event;
      lastEventAtMs = event.tMs;
      if (event.event === "done") {
        doneSeen = true;
      }
      if (!stopEvent && shouldStopOnEvent(event, options.stopOn)) {
        stopEvent = {
          stopOn: options.stopOn,
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

      if (doneSeen) {
        await reader.cancel().catch(() => undefined);
        streamClosed = true;
        break;
      }

      if (sawStopMarker && options.stopOn === "persisted") {
        if (!persistedProbe.attempted) {
          persistedProbe = await runPersistedReadinessProbe(events, {
            retries: options.retries ?? DEFAULT_RETRIES,
          });
        }
        if (!persistedProbe.ready) {
          // persisted was observed but not yet readable via analysis-section; keep consuming stream.
          sawStopMarker = false;
          stopEvent = null;
        }
      }

      // If a stop marker was seen (revision1/fast_ai/persisted), keep reading for a short tail so we
      // can still observe "done" and classify contract failures precisely.
      if (sawStopMarker && Number.isFinite(options.stopTailMs) && options.stopTailMs > 0) {
        const elapsedMs = Math.round(performance.now() - start);
        if (elapsedMs >= stopEvent.tMs + options.stopTailMs) {
          await reader.cancel().catch(() => undefined);
          streamClosed = true;
          break;
        }
      }
      if (sawStopMarker && (!Number.isFinite(options.stopTailMs) || options.stopTailMs <= 0)) {
        await reader.cancel().catch(() => undefined);
        streamClosed = true;
        break;
      }
    }

    flush();
    return partial();
  } catch (error) {
    if (isAbortLikeError(error)) {
      timedOut = true;
      abortError = true;
      const wrapped = new E2eError("AbortError", `SSE timeout/abort after ${timeoutMs}ms`, {
        retryable: true,
        cause: error,
      });
      wrapped.partial = partial();
      throw wrapped;
    }
    if (error instanceof E2eError) {
      if (!error.partial) {
        error.partial = partial();
      }
      throw error;
    }
    const wrapped = new E2eError("unknown_error", String(error?.message ?? error), {
      retryable: true,
      cause: error,
    });
    wrapped.partial = partial();
    throw wrapped;
  } finally {
    clearTimeout(timeout);
  }
};

const fetchSse = async (url, payload, options = {}) => {
  const retries = options.retries ?? DEFAULT_RETRIES;
  const retryLog = [];
  try {
    const { value, retryUsed } = await withRetries(
      () => fetchSseOnce(url, payload, options),
      {
        retries,
        onRetry: ({ attempt, delayMs, errorType }) => {
          retryLog.push({ attempt, delayMs, errorType });
        },
      },
    );

    return {
      ...value,
      retryUsed,
      retryLog,
      terminalErrorType: null,
    };
  } catch (error) {
    const partial = error instanceof E2eError && error.partial ? error.partial : {
      events: [],
      stopEvent: null,
      bytesReceived: 0,
      lastEventType: null,
      lastEventAtMs: null,
      parseErrorCount: 0,
      streamClosed: false,
      timedOut: classifyErrorType(error) === "AbortError",
      abortError: classifyErrorType(error) === "AbortError",
      doneSeen: false,
      persistedProbe: {
        attempted: false,
        ready: null,
        reason: null,
        overviewStatus: null,
        usageStatus: null,
        contracts: null,
      },
    };
    return {
      ...partial,
      retryUsed: Number(error?.retryUsed ?? 0),
      retryLog,
      terminalErrorType: classifyErrorType(error),
      fatalError: String(error?.message ?? error),
    };
  }
};

const pickBundleEvents = (events) => {
  const bundles = events.filter((e) => e.event === "analysis_bundle" && e.data && typeof e.data === "object");
  const rev0 = bundles.find((e) => e.data?.meta?.revision === 0) || null;
  const rev1 = bundles.find((e) => Number(e.data?.meta?.revision) >= 1) || null;
  const best = [...bundles].reverse().find((e) => e.data?.meta?.phase === "fast_ai") || rev1 || rev0 || null;
  const persisted = events.find((e) => e.event === "persisted") || null;
  const done = events.find((e) => e.event === "done") || null;
  return { rev0, rev1, best, persisted, done, count: bundles.length };
};

const pickTerminalErrorEvent = (events) => {
  const errors = events.filter((event) => event?.event === "error");
  if (!errors.length) return null;
  return errors[errors.length - 1];
};

const asObject = (value) => {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  return value;
};

const pickString = (...values) => {
  for (const value of values) {
    if (typeof value !== "string") continue;
    const trimmed = value.trim();
    if (trimmed) return trimmed;
  }
  return null;
};

const isDoneTerminalCode = (code) => code === "DONE" || code === "DONE_DERIVED";

const deriveTerminalCode = ({ terminalCode, stopOnTriggered, finalProbe }) => {
  if (terminalCode) return terminalCode;
  if (!stopOnTriggered) return null;
  if (finalProbe?.attempted && !finalProbe?.reason) return "DONE_DERIVED";
  return null;
};

const classifySseContractFailure = ({ sse, picked }) => {
  if (!Array.isArray(sse.events) || sse.events.length === 0) return "no_sse";
  if (picked.rev0 && !picked.rev1) return "skeleton_only";
  if (!picked.rev1) return "missing_revision1";
  if (!sse.doneSeen) return "missing_done";
  if (Number(sse.parseErrorCount) > 0) return "parse_error";
  if (sse.timedOut) return "timeout";
  return null;
};

const buildSectionPayload = (meta, section) => {
  if (!meta?.authoritativeIdentity) {
    throw new E2eError("identity_missing", "missing authoritativeIdentity", { retryable: false });
  }
  if (!meta?.factsDigestHash) {
    throw new E2eError("facts_digest_missing", "missing factsDigestHash", { retryable: false });
  }

  const payload = {
    identity: meta.authoritativeIdentity,
    section,
    locale: meta.locale || "en",
    promptVersion: meta.promptVersion,
    factsDigestHash: meta.factsDigestHash,
  };

  if (section === "ingredients_detail") {
    payload.limit = 6;
    payload.cursor = 0;
  }

  return payload;
};

const fetchAnalysisSectionOnce = async (meta, section) => {
  const payload = buildSectionPayload(meta, section);
  const t0 = performance.now();

  try {
    const res = await fetchWithTimeout(
      `${API_BASE_URL}/api/analysis-section`,
      {
        method: "POST",
        headers: { ...apiHeaders, Accept: "application/json" },
        body: JSON.stringify(payload),
      },
      ANALYSIS_TIMEOUT_MS,
    );

    const timingMs = Math.round(performance.now() - t0);
    const data = await res.json().catch(() => null);

    if (res.status === 429) {
      throw new E2eError("http_429", "analysis-section rate limited", {
        status: 429,
        retryable: true,
        retryAfterMs: Number(res.headers.get("retry-after") || 1) * 1000,
      });
    }
    if (res.status >= 500) {
      throw new E2eError("http_5xx", `analysis-section server error ${res.status}`, {
        status: res.status,
        retryable: true,
      });
    }
    if (!res.ok) {
      const detailError = data?.error;
      const type = detailError === "facts_digest_missing" ? "facts_digest_missing" : errorTypeFromStatus(res.status);
      return {
        status: res.status,
        timingMs,
        data,
        dataStatus: data?.dataStatus ?? null,
        errorType: type,
        fallbackUsed: data?.meta?.fallbackUsed ?? null,
      };
    }

    if (!data || typeof data !== "object") {
      return {
        status: res.status,
        timingMs,
        data: null,
        dataStatus: null,
        errorType: "parse_failed",
        fallbackUsed: null,
      };
    }

    return {
      status: res.status,
      timingMs,
      data,
      dataStatus: data?.dataStatus ?? null,
      errorType: null,
      fallbackUsed: data?.meta?.fallbackUsed ?? null,
    };
  } catch (error) {
    if (error instanceof E2eError) throw error;
    if (isAbortLikeError(error)) {
      throw new E2eError("AbortError", `analysis-section timeout/abort (${section})`, {
        retryable: true,
        cause: error,
      });
    }
    throw new E2eError("unknown_error", `analysis-section failed (${section}): ${String(error?.message ?? error)}`, {
      retryable: true,
      cause: error,
    });
  }
};

const fetchAnalysisSection = async (meta, section, options = {}) => {
  const retries = options.retries ?? DEFAULT_RETRIES;
  const retryLog = [];
  try {
    const { value, retryUsed } = await withRetries(
      () => fetchAnalysisSectionOnce(meta, section),
      {
        retries,
        onRetry: ({ attempt, delayMs, errorType }) => {
          retryLog.push({ attempt, delayMs, errorType });
        },
      },
    );

    return {
      ...value,
      retryUsed,
      retryLog,
    };
  } catch (error) {
    return {
      status: 0,
      timingMs: 0,
      data: null,
      dataStatus: null,
      errorType: classifyErrorType(error),
      fallbackUsed: null,
      retryUsed: Number(error?.retryUsed ?? 0),
      retryLog,
    };
  }
};

const getOverviewSummary = (overviewSection) => {
  const data = overviewSection?.data;
  if (!data || typeof data !== "object") return "";
  const fromDetail = data?.detail?.summary;
  if (typeof fromDetail === "string" && fromDetail.trim()) return fromDetail.trim();
  const fromCover = data?.cover?.summary;
  if (typeof fromCover === "string" && fromCover.trim()) return fromCover.trim();
  return "";
};

const getUsageTiming = (usageSection) => {
  const data = usageSection?.data;
  if (!data || typeof data !== "object") return "";
  const fromCover = data?.cover?.bestTimeToTake?.text;
  if (typeof fromCover === "string" && fromCover.trim()) return fromCover.trim();
  const fromDetail = data?.detail?.timingRationale?.text;
  if (typeof fromDetail === "string" && fromDetail.trim()) return fromDetail.trim();
  return "";
};

const getUsageWithFoodValue = (usageSection) => {
  const data = usageSection?.data;
  if (!data || typeof data !== "object") return null;
  const fromCover = data?.cover?.withFood?.value;
  if (typeof fromCover === "boolean") return fromCover;
  return null;
};

const evaluateContentContracts = (sections) => {
  const overviewSummary = getOverviewSummary(sections.overview);
  const usageTiming = getUsageTiming(sections.usage);
  const usageWithFoodValue = getUsageWithFoodValue(sections.usage);
  const overviewStrongTokenPresent = hasOverviewStrongToken(overviewSummary, sections);

  const overviewPresent = typeof overviewSummary === "string" && overviewSummary.trim().length >= 40;
  const usageTimingPresent = typeof usageTiming === "string" && usageTiming.trim().length > 0;
  const usageWithFoodBoolean = typeof usageWithFoodValue === "boolean";
  const usagePresent = usageTimingPresent && usageWithFoodBoolean;

  return {
    overviewSummary,
    usageTiming,
    usageWithFoodValue,
    overviewPresent,
    overviewStrongTokenPresent,
    usagePresent,
    usageTimingPresent,
    usageWithFoodBoolean,
  };
};

const normalizeToken = (value) =>
  String(value ?? "")
    .toLowerCase()
    .replace(/[^a-z0-9\s]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();

const buildStrongOverviewTokens = (sections) => {
  const items = sections?.ingredients_detail?.data?.detail?.items;
  if (!Array.isArray(items)) return [];
  const generic = new Set(["calories", "total fat", "cholesterol", "supplement", "ingredient", "ingredients"]);
  const out = [];
  for (const item of items) {
    const name = normalizeToken(item?.name);
    if (!name || name.length < 3 || generic.has(name)) continue;
    out.push(name);
    if (out.length >= 6) break;
  }
  return out;
};

const hasOverviewStrongToken = (overviewSummary, sections) => {
  const summary = normalizeToken(overviewSummary);
  if (!summary) return false;
  const tokens = buildStrongOverviewTokens(sections);
  if (!tokens.length) return true;
  return tokens.some((token) => summary.includes(token));
};

runPersistedReadinessProbe = async (events, options = {}) => {
  const picked = pickBundleEvents(events || []);
  const probeMeta = picked.rev1?.data?.meta ?? buildMetaFromPersistedEvent(picked.persisted?.data) ?? null;
  if (!probeMeta) {
    return {
      attempted: true,
      ready: false,
      reason: "identity_missing",
      overviewStatus: null,
      usageStatus: null,
      contracts: null,
    };
  }

  const overview = await fetchAnalysisSection(probeMeta, "overview", { retries: options.retries ?? DEFAULT_RETRIES });
  const usage = await fetchAnalysisSection(probeMeta, "usage", { retries: options.retries ?? DEFAULT_RETRIES });
  const contracts = evaluateContentContracts({
    ingredients_detail: { data: null },
    overview,
    usage,
  });
  const probeReady =
    overview.status >= 200 &&
    overview.status < 300 &&
    usage.status >= 200 &&
    usage.status < 300 &&
    contracts.overviewPresent &&
    contracts.usagePresent;

  let reason = null;
  if (!probeReady) {
    reason =
      overview.errorType ||
      usage.errorType ||
      (contracts.overviewPresent ? null : "overview_contract_not_ready") ||
      (contracts.usagePresent ? null : "usage_contract_not_ready") ||
      "persisted_probe_not_ready";
  }

  return {
    attempted: true,
    ready: probeReady,
    reason,
    overviewStatus: overview.status,
    usageStatus: usage.status,
    contracts,
  };
};

const runFullFlow = async (item, options) => {
  const startedAt = new Date().toISOString();
  const errors = [];
  const fixtureInvalidReasons = [];
  const sse = await fetchSse(
    `${API_BASE_URL}/api/enrich-stream`,
    { barcode: item.barcode },
    {
      stopOn: options.sseStopOn,
      stopTailMs: options.sseStopTailMs,
      retries: options.retries,
    },
  );

  const picked = pickBundleEvents(sse.events);
  const rev1Meta = picked.rev1?.data?.meta ?? null;
  const persistedMeta = buildMetaFromPersistedEvent(picked.persisted?.data) ?? null;
  const bestMeta = picked.best?.data?.meta ?? rev1Meta ?? null;
  const sectionMeta = rev1Meta ?? persistedMeta ?? null;
  const sourceType = rev1Meta?.sourceType ?? persistedMeta?.sourceType ?? null;
  const terminalErrorEvent = pickTerminalErrorEvent(sse.events);
  const terminalErrorPayload = asObject(terminalErrorEvent?.data);
  const fallbackReason = pickString(
    bestMeta?.fallbackReason,
    bestMeta?.fallback?.code,
    terminalErrorPayload?.fallbackReason,
    terminalErrorPayload?.fallback_reason,
    null,
  );
  const authorityFailureReason = pickString(
    bestMeta?.authorityFailureReason,
    bestMeta?.authority_failure_reason,
    terminalErrorPayload?.authorityFailureReason,
    terminalErrorPayload?.authority_failure_reason,
    null,
  );
  const terminalCode = pickString(terminalErrorPayload?.code) ?? (picked.done || sse.doneSeen ? "DONE" : null);
  const errorReasonCode = pickString(terminalErrorPayload?.reasonCode, terminalErrorPayload?.reason_code);
  const terminalStage = pickString(terminalErrorPayload?.stage);
  const terminalRequestId = pickString(terminalErrorPayload?.requestId, terminalErrorPayload?.request_id);
  const terminalRetryable =
    typeof terminalErrorPayload?.retryable === "boolean" ? terminalErrorPayload.retryable : null;
  let contractFailure = classifySseContractFailure({ sse, picked });
  let missingDoneSuppressed = false;
  if (contractFailure) {
    errors.push(contractFailure);
  }
  if (sse.terminalErrorType) {
    errors.push(sse.terminalErrorType);
  }
  if (item.expectedSourceType && sourceType !== item.expectedSourceType) {
    fixtureInvalidReasons.push("source_type_mismatch");
  }

  const defaultSectionResult = {
    status: 0,
    timingMs: 0,
    data: null,
    dataStatus: null,
    errorType: contractFailure ?? sse.terminalErrorType ?? null,
    fallbackUsed: null,
    retryUsed: 0,
    retryLog: [],
  };

  let sections = {
    ingredients_detail: defaultSectionResult,
    overview: defaultSectionResult,
    usage: defaultSectionResult,
  };

  if (sectionMeta) {
    sections = {
      ingredients_detail: await fetchAnalysisSection(sectionMeta, "ingredients_detail", { retries: options.retries }),
      overview: await fetchAnalysisSection(sectionMeta, "overview", { retries: options.retries }),
      usage: await fetchAnalysisSection(sectionMeta, "usage", { retries: options.retries }),
    };

    if (sections.ingredients_detail.errorType) errors.push(sections.ingredients_detail.errorType);
    if (sections.overview.errorType) errors.push(sections.overview.errorType);
    if (sections.usage.errorType) errors.push(sections.usage.errorType);
  }

  let finalProbe = {
    attempted: false,
    reason: null,
    overviewStatus: null,
    usageStatus: null,
    contracts: null,
    trigger: null,
  };

  const finalProbeTrigger = sse.doneSeen ? "done" : sse.stopEvent?.stopOn ?? null;

  if (finalProbeTrigger) {
    if (!sectionMeta) {
      finalProbe = {
        attempted: true,
        reason: "identity_missing",
        overviewStatus: null,
        usageStatus: null,
        contracts: null,
        trigger: finalProbeTrigger,
      };
      errors.push("identity_missing");
    } else {
      const finalOverview = await fetchAnalysisSection(sectionMeta, "overview", { retries: options.retries });
      const finalUsage = await fetchAnalysisSection(sectionMeta, "usage", { retries: options.retries });
      if (finalOverview.errorType) errors.push(finalOverview.errorType);
      if (finalUsage.errorType) errors.push(finalUsage.errorType);

      sections = {
        ...sections,
        overview: finalOverview,
        usage: finalUsage,
      };

      const finalContracts = evaluateContentContracts(sections);
      const finalReady =
        finalOverview.status >= 200 &&
        finalOverview.status < 300 &&
        finalUsage.status >= 200 &&
        finalUsage.status < 300 &&
        finalContracts.overviewPresent &&
        finalContracts.usagePresent;

      const finalReason = finalReady
        ? null
        : finalOverview.errorType ||
          finalUsage.errorType ||
          (finalContracts.overviewPresent ? null : "overview_contract_failed") ||
          (finalContracts.usagePresent ? null : "usage_contract_failed") ||
          "content_contract_failed";

      finalProbe = {
        attempted: true,
        reason: finalReason,
        overviewStatus: finalOverview.status,
        usageStatus: finalUsage.status,
        contracts: finalContracts,
        trigger: finalProbeTrigger,
      };
      if (finalReason) errors.push(finalReason);
    }
  }

  if (
    contractFailure === "missing_done" &&
    sse.stopEvent?.stopOn &&
    !sse.abortError &&
    !sse.timedOut &&
    finalProbe.attempted &&
    !finalProbe.reason
  ) {
    contractFailure = null;
    missingDoneSuppressed = true;
  }

  const derivedTerminalCode = deriveTerminalCode({
    terminalCode,
    stopOnTriggered: Boolean(finalProbeTrigger),
    finalProbe,
  });

  const contracts = evaluateContentContracts(sections);
  const resolvedScoreAvailable =
    typeof sectionMeta?.scoreAvailable === "boolean"
      ? sectionMeta.scoreAvailable
      : sourceType === "web"
        ? false
        : sourceType === "dsld" || sourceType === "lnhpd"
          ? true
          : null;
  if (typeof item.expectedScoreAvailable === "boolean" &&
      typeof resolvedScoreAvailable === "boolean" &&
      item.expectedScoreAvailable !== resolvedScoreAvailable) {
    fixtureInvalidReasons.push("score_available_mismatch");
  }

  if (sectionMeta && (!contracts.overviewPresent || !contracts.usagePresent)) {
    errors.push("content_contract_failed");
  }
  if (resolvedScoreAvailable === true && !contracts.overviewStrongTokenPresent) {
    errors.push("overview_strong_token_missing");
  }

  return {
    input: item,
    startedAt,
    completedAt: new Date().toISOString(),
    sse: {
      eventCount: sse.events.length,
      bundleCount: picked.count,
      stoppedOn: sse.stopEvent?.stopOn ?? null,
      stopEvent: sse.stopEvent?.event ?? null,
      stopEventMs: sse.stopEvent?.tMs ?? null,
      revision0Ms: picked.rev0?.tMs ?? null,
      revision1Ms: picked.rev1?.tMs ?? null,
      doneMs: picked.done?.tMs ?? null,
      bestBundleMs: picked.best?.tMs ?? null,
      sourceType,
      sourceTypeFinal: rev1Meta?.sourceTypeFinal ?? null,
      identityType: sectionMeta?.authoritativeIdentity?.type ?? null,
      identityValue: sectionMeta?.authoritativeIdentity?.value ?? null,
      factsDigestHash: sectionMeta?.factsDigestHash ?? null,
      promptVersion: sectionMeta?.promptVersion ?? null,
      scoreAvailable: resolvedScoreAvailable,
      terminalCode,
      derivedTerminalCode,
      errorReasonCode,
      terminalStage,
      terminalRequestId,
      terminalRetryable,
      fallbackReason,
      authorityFailureReason,
      bytesReceived: sse.bytesReceived,
      lastEventType: sse.lastEventType,
      lastEventAtMs: sse.lastEventAtMs,
      parseErrorCount: sse.parseErrorCount,
      streamClosed: sse.streamClosed,
      timedOut: sse.timedOut,
      abortError: sse.abortError,
      rev0Seen: Boolean(picked.rev0),
      rev1Seen: Boolean(picked.rev1),
      doneSeen: Boolean(picked.done) || Boolean(sse.doneSeen),
      contractFailure,
      missingDoneSuppressed,
      terminalErrorType: sse.terminalErrorType,
      fatalError: sse.fatalError ?? null,
      persistedProbe: sse.persistedProbe ?? null,
      expectedSourceType: item.expectedSourceType ?? null,
      expectedScoreAvailable:
        typeof item.expectedScoreAvailable === "boolean" ? item.expectedScoreAvailable : null,
    },
    sections,
    contracts,
    finalProbe,
    fixture: {
      invalid: fixtureInvalidReasons.length > 0,
      reasons: fixtureInvalidReasons,
    },
    retry: {
      sse: sse.retryUsed,
      ingredients_detail: sections.ingredients_detail.retryUsed,
      overview: sections.overview.retryUsed,
      usage: sections.usage.retryUsed,
      total:
        sse.retryUsed +
        sections.ingredients_detail.retryUsed +
        sections.overview.retryUsed +
        sections.usage.retryUsed,
      logs: {
        sse: sse.retryLog,
        ingredients_detail: sections.ingredients_detail.retryLog,
        overview: sections.overview.retryLog,
        usage: sections.usage.retryLog,
      },
    },
    errors: [...new Set(errors.filter((errorType) => errorType !== "missing_done" || contractFailure === "missing_done"))],
  };
};

const countBy = (rows, keyFn) =>
  rows.reduce((acc, row) => {
    const key = keyFn(row);
    acc[key] = (acc[key] || 0) + 1;
    return acc;
  }, {});

const mergeCountMaps = (...maps) => {
  const merged = {};
  for (const map of maps) {
    if (!map || typeof map !== "object") continue;
    for (const [key, value] of Object.entries(map)) {
      if (!Number.isFinite(Number(value))) continue;
      merged[key] = (merged[key] || 0) + Number(value);
    }
  }
  return merged;
};

const topCountEntries = (counts, limit = 8) =>
  Object.entries(counts || {})
    .sort((a, b) => b[1] - a[1])
    .slice(0, Math.max(0, limit))
    .map(([key, count]) => ({ key, count }));

const normalizeAttributionToken = (value) => {
  const normalized = String(value ?? "")
    .toLowerCase()
    .replace(/[^a-z0-9._:-]+/g, "_")
    .replace(/^_+|_+$/g, "");
  return normalized || "unknown";
};

const deriveRawDoneAttributionKey = (row) => {
  if (row?.sse?.doneSeen === true) return "done_seen";

  const errorReasonCode = row?.sse?.errorReasonCode;
  const terminalCode = row?.sse?.terminalCode;
  const terminalErrorType = row?.sse?.terminalErrorType;
  const contractFailure = row?.sse?.contractFailure;
  const finalProbeReason = row?.finalProbe?.reason;

  if (row?.sse?.missingDoneSuppressed === true) {
    if (typeof errorReasonCode === "string" && errorReasonCode.trim()) {
      return `suppressed_reason_code:${normalizeAttributionToken(errorReasonCode)}`;
    }
    if (typeof terminalCode === "string" && terminalCode.trim()) {
      return `suppressed_terminal_code:${normalizeAttributionToken(terminalCode)}`;
    }
    return "suppressed_probe_ready_missing_done";
  }

  if (typeof errorReasonCode === "string" && errorReasonCode.trim()) {
    return `reason_code:${normalizeAttributionToken(errorReasonCode)}`;
  }
  if (typeof terminalCode === "string" && terminalCode.trim()) {
    return `terminal_code:${normalizeAttributionToken(terminalCode)}`;
  }
  if (typeof terminalErrorType === "string" && terminalErrorType.trim()) {
    return `terminal_error_type:${normalizeAttributionToken(terminalErrorType)}`;
  }
  if (typeof contractFailure === "string" && contractFailure.trim()) {
    return `contract:${normalizeAttributionToken(contractFailure)}`;
  }
  if (row?.sse?.abortError || row?.sse?.timedOut) {
    return "timeout_or_abort";
  }
  if (typeof finalProbeReason === "string" && finalProbeReason.trim()) {
    return `final_probe:${normalizeAttributionToken(finalProbeReason)}`;
  }
  return "unknown_missing_done";
};

const percentile = (arr, p) => {
  if (!arr.length) return null;
  const sorted = [...arr].sort((a, b) => a - b);
  const idx = Math.max(0, Math.min(sorted.length - 1, Math.floor((p / 100) * (sorted.length - 1))));
  return sorted[idx];
};

const evaluateSuiteGate = (suiteName, metrics, phaseMode) => {
  const reasons = [];
  const warnings = [];
  const contract = metrics.contractFailureCounts || {};
  const missingDoneCount = contract.missing_done || 0;

  if (suiteName === "A") {
    if (metrics.unknownRatio > 1 / 30) reasons.push("unknown_ratio_exceeds_1_over_30");
    if (metrics.abortErrorCount !== 0) reasons.push("abort_error_non_zero");
    if (metrics.revision1Rate < 0.95) reasons.push("revision1_rate_below_0_95");
    if (metrics.detail2xxRate < 0.95) reasons.push("detail_2xx_rate_below_0_95");
    if (metrics.enrichBestBundleP90Ms == null || metrics.enrichBestBundleP90Ms > 5_000)
      reasons.push("enrich_best_bundle_p90_over_5s");
    if (metrics.overviewPresentRatio < 0.95) reasons.push("overview_present_ratio_below_0_95");
    if (metrics.usagePresentRatio < 0.95) reasons.push("usage_present_ratio_below_0_95");
    if (metrics.scoreAvailableTrueRatio < 0.95) reasons.push("score_available_true_ratio_below_0_95");
    if (metrics.overviewStrongTokenRatio < 0.95) reasons.push("overview_strong_token_ratio_below_0_95");
    if ((contract.missing_revision1 || 0) > 0) reasons.push("sse_missing_revision1_non_zero");
    if (missingDoneCount > 0) {
      if (phaseMode === "phase1") warnings.push("sse_missing_done_warn_only_phase1");
      else reasons.push("sse_missing_done_non_zero");
    }
    if ((contract.no_sse || 0) > 0) reasons.push("sse_no_sse_non_zero");
    if ((contract.parse_error || 0) > 0) reasons.push("sse_parse_error_non_zero");
    if ((contract.timeout || 0) > 0) reasons.push("sse_timeout_non_zero");
  } else {
    if (metrics.sourceTypeWebRatio < 0.8) reasons.push("source_type_web_ratio_below_0_8");
    if (metrics.unknownRatio > 0.1) reasons.push("unknown_ratio_over_0_1");
    if (metrics.abortErrorCount !== 0) reasons.push("abort_error_non_zero");
    if (metrics.detail2xxRate < 0.9) reasons.push("detail_2xx_rate_below_0_9");
    if (metrics.detailP90Ms == null || metrics.detailP90Ms > 5_000) reasons.push("detail_p90_over_5s");
    if (metrics.overviewPresentRatio < 0.9) reasons.push("overview_present_ratio_below_0_9");
    if (metrics.usagePresentRatio < 0.9) reasons.push("usage_present_ratio_below_0_9");
    if ((contract.missing_revision1 || 0) > 0) reasons.push("sse_missing_revision1_non_zero");
    if (missingDoneCount > 0) {
      if (phaseMode === "phase1") warnings.push("sse_missing_done_warn_only_phase1");
      else reasons.push("sse_missing_done_non_zero");
    }
    if ((contract.no_sse || 0) > 0) reasons.push("sse_no_sse_non_zero");
    if ((contract.parse_error || 0) > 0) reasons.push("sse_parse_error_non_zero");
    if ((contract.timeout || 0) > 0) reasons.push("sse_timeout_non_zero");
  }

  return {
    pass: reasons.length === 0,
    failReasons: reasons,
    warnings,
  };
};

const summarizeSuite = (suiteName, rows, expectedSourceType = null, phaseMode = DEFAULT_PHASE_MODE) => {
  const sampledTotal = rows.length;
  const fixtureInvalidRows = rows.filter((row) => row.fixture?.invalid);
  const validRows = rows.filter((row) => !row.fixture?.invalid);
  const total = validRows.length;
  const unknownCount = validRows.filter((row) => !row.sse.sourceType || row.sse.sourceType === "unknown").length;
  const sourceTypeCounts = countBy(validRows, (row) => row.sse.sourceType || "unknown");
  const contractFailureCounts = countBy(validRows, (row) => row.sse.contractFailure || "none");
  const errorsByType = countBy(validRows.flatMap((row) => row.errors || []), (value) => value);
  const fixtureInvalidReasonCounts = countBy(
    fixtureInvalidRows.flatMap((row) => row.fixture?.reasons || []),
    (value) => value,
  );

  const revision1Count = validRows.filter((row) => Number.isFinite(row.sse.revision1Ms)).length;
  const doneSeenCount = validRows.filter((row) => row.sse.doneSeen === true).length;
  const rawMissingDoneRows = validRows.filter((row) => row.sse.doneSeen !== true);
  const rawMissingDoneCount = rawMissingDoneRows.length;
  const rawNoTerminalCount = validRows.filter((row) => !row.sse.terminalCode).length;
  const probeDoneCount = validRows.filter((row) => isDoneTerminalCode(row.sse.derivedTerminalCode)).length;
  const probeNoTerminalCount = validRows.filter((row) => !row.sse.derivedTerminalCode).length;
  const rawDoneAttributionCounts = countBy(rawMissingDoneRows, deriveRawDoneAttributionKey);
  const rawDoneAttributionTop = topCountEntries(rawDoneAttributionCounts, 8);
  const detail2xxCount = validRows.filter((row) => row.sections.ingredients_detail.status >= 200 && row.sections.ingredients_detail.status < 300).length;
  const overviewPresentCount = validRows.filter((row) => row.contracts.overviewPresent).length;
  const overviewStrongTokenCount = validRows.filter((row) => row.contracts.overviewStrongTokenPresent).length;
  const usagePresentCount = validRows.filter((row) => row.contracts.usagePresent).length;
  const scoreAvailableTrueCount = validRows.filter((row) => row.sse.scoreAvailable === true).length;
  const rawMissingDoneSuppressedCount = validRows.filter((row) => row.sse.missingDoneSuppressed === true).length;

  const enrichTimes = validRows.map((row) => row.sse.bestBundleMs).filter((value) => Number.isFinite(value) && value > 0);
  const detailTimes = validRows
    .map((row) => row.sections.ingredients_detail.timingMs)
    .filter((value) => Number.isFinite(value) && value > 0);

  const retryUsedCount = validRows.reduce((sum, row) => sum + (row.retry?.total || 0), 0);
  const sourceTypeWebCount = validRows.filter((row) => row.sse.sourceType === "web").length;

  const metrics = {
    sampledTotal,
    total,
    expectedSourceType,
    sourceTypeCounts,
    fixtureInvalidCount: fixtureInvalidRows.length,
    fixtureInvalidRatio: sampledTotal > 0 ? fixtureInvalidRows.length / sampledTotal : 0,
    fixtureInvalidReasonCounts,
    unknownCount,
    unknownRatio: total > 0 ? unknownCount / total : 1,
    abortErrorCount: errorsByType.AbortError || 0,
    revision1ReachedCount: revision1Count,
    revision1Rate: total > 0 ? revision1Count / total : 0,
    doneSeenCount,
    doneSeenRate: total > 0 ? doneSeenCount / total : 0,
    rawMissingDoneCount,
    rawNoTerminalCount,
    probeDoneCount,
    probeDoneRate: total > 0 ? probeDoneCount / total : 0,
    probeNoTerminalCount,
    rawDoneAttributionCounts,
    rawDoneAttributionTop,
    detail2xxCount,
    detail2xxRate: total > 0 ? detail2xxCount / total : 0,
    enrichBestBundleP50Ms: percentile(enrichTimes, 50),
    enrichBestBundleP90Ms: percentile(enrichTimes, 90),
    detailP50Ms: percentile(detailTimes, 50),
    detailP90Ms: percentile(detailTimes, 90),
    overviewPresentCount,
    overviewPresentRatio: total > 0 ? overviewPresentCount / total : 0,
    overviewStrongTokenCount,
    overviewStrongTokenRatio: total > 0 ? overviewStrongTokenCount / total : 0,
    usagePresentCount,
    usagePresentRatio: total > 0 ? usagePresentCount / total : 0,
    scoreAvailableTrueCount,
    scoreAvailableTrueRatio: total > 0 ? scoreAvailableTrueCount / total : 0,
    rawMissingDoneSuppressedCount,
    sourceTypeWebCount,
    sourceTypeWebRatio: total > 0 ? sourceTypeWebCount / total : 0,
    retryUsedCount,
    errorsByType,
    contractFailureCounts,
  };

  const gate = evaluateSuiteGate(suiteName, metrics, phaseMode);
  const warnings = [...gate.warnings];
  if (fixtureInvalidRows.length > 0) {
    warnings.push("fixture_invalid_present");
  }

  return {
    suite: suiteName,
    pass: gate.pass,
    failReasons: gate.failReasons,
    warnings,
    metrics,
    generatedAt: new Date().toISOString(),
  };
};

const loadPromotionState = async (statePath) => {
  try {
    const data = await readJson(statePath);
    if (!data || typeof data !== "object") return { suiteBConsecutivePasses: 0, updatedAt: null };
    return {
      suiteBConsecutivePasses: Number.isFinite(data.suiteBConsecutivePasses) ? Number(data.suiteBConsecutivePasses) : 0,
      updatedAt: data.updatedAt || null,
    };
  } catch {
    return { suiteBConsecutivePasses: 0, updatedAt: null };
  }
};

const savePromotionState = async (statePath, state) => {
  await writeJson(statePath, {
    ...state,
    updatedAt: new Date().toISOString(),
  });
};

const deriveSuiteGateForPhase = (suiteName, suiteSummary, phaseMode) => {
  if (!suiteSummary) return null;
  const gate = evaluateSuiteGate(suiteName, suiteSummary.metrics || {}, phaseMode);
  return {
    ...suiteSummary,
    pass: gate.pass,
    failReasons: gate.failReasons,
    warnings: gate.warnings,
  };
};

const buildGateSummary = async ({
  suiteA,
  suiteB,
  phaseMode,
  outDir,
  promotionUpdateEnabled = true,
  promotionSkipReason = null,
  backendHealth = null,
}) => {
  const suiteAForPhase = deriveSuiteGateForPhase("A", suiteA, phaseMode);
  const suiteBForPhase = deriveSuiteGateForPhase("B", suiteB, phaseMode);
  const suiteARequired = Boolean(suiteAForPhase);
  const suiteBRequired = phaseMode === "phase2" && Boolean(suiteBForPhase);
  const suiteAPass = suiteAForPhase?.pass ?? false;
  const suiteBPass = suiteBForPhase?.pass ?? false;
  const healthStatus = backendHealth?.status === "healthy" ? "healthy" : "unhealthy";
  const healthReason = healthStatus === "healthy" ? null : backendHealth?.reason || "backend_unhealthy";

  const gateTotals = {
    total:
      (suiteAForPhase?.metrics?.total || 0) + (suiteBForPhase?.metrics?.total || 0),
    rawDoneCount:
      (suiteAForPhase?.metrics?.doneSeenCount || 0) + (suiteBForPhase?.metrics?.doneSeenCount || 0),
    rawMissingDoneCount:
      (suiteAForPhase?.metrics?.rawMissingDoneCount || 0) + (suiteBForPhase?.metrics?.rawMissingDoneCount || 0),
    probeDoneCount:
      (suiteAForPhase?.metrics?.probeDoneCount || 0) + (suiteBForPhase?.metrics?.probeDoneCount || 0),
    rawNoTerminalCount:
      (suiteAForPhase?.metrics?.rawNoTerminalCount || 0) + (suiteBForPhase?.metrics?.rawNoTerminalCount || 0),
    probeNoTerminalCount:
      (suiteAForPhase?.metrics?.probeNoTerminalCount || 0) + (suiteBForPhase?.metrics?.probeNoTerminalCount || 0),
  };
  const rawDoneRate = gateTotals.total > 0 ? gateTotals.rawDoneCount / gateTotals.total : 0;
  const probeDoneRate = gateTotals.total > 0 ? gateTotals.probeDoneCount / gateTotals.total : 0;
  const rawDoneAttributionCounts = mergeCountMaps(
    suiteAForPhase?.metrics?.rawDoneAttributionCounts,
    suiteBForPhase?.metrics?.rawDoneAttributionCounts,
  );
  const rawDoneAttributionTop = topCountEntries(rawDoneAttributionCounts, 12);
  const shadowRawDonePass = gateTotals.total > 0 ? rawDoneRate >= RAW_DONE_SHADOW_HARD_THRESHOLD : true;
  const shadowRawDoneReason = shadowRawDonePass ? null : "raw_done_rate_below_shadow_hard_threshold";

  const promotionState = await loadPromotionState(PROMOTION_STATE_FILE);
  let consecutivePasses = promotionState.suiteBConsecutivePasses;
  const suiteBPromotionPass = suiteBPass && (!RAW_DONE_HARD_ENFORCE || shadowRawDonePass);
  const canUpdatePromotion = Boolean(suiteBForPhase) && promotionUpdateEnabled && healthStatus === "healthy";
  if (canUpdatePromotion) {
    consecutivePasses = suiteBPromotionPass ? consecutivePasses + 1 : 0;
    await savePromotionState(PROMOTION_STATE_FILE, { suiteBConsecutivePasses: consecutivePasses });
  }
  const resolvedPromotionSkipReason = canUpdatePromotion
    ? null
    : promotionSkipReason ||
      (healthStatus !== "healthy"
        ? "backend_unhealthy"
        : suiteBForPhase
          ? "promotion_update_disabled"
          : "suite_b_not_executed");

  const requiredPasses = [];
  if (suiteARequired) requiredPasses.push(suiteAPass);
  if (suiteBRequired) requiredPasses.push(suiteBPass);
  const requiredSuitesPass = healthStatus === "healthy" && requiredPasses.length > 0 ? requiredPasses.every(Boolean) : false;
  const rawDoneHardFail = RAW_DONE_HARD_ENFORCE && gateTotals.total > 0 && !shadowRawDonePass;

  const warnings = [];
  if (phaseMode === "phase1" && suiteBForPhase && !suiteBForPhase.pass) {
    warnings.push("suite_b_warn_only_in_phase1");
  }
  if (gateTotals.total > 0 && rawDoneRate < RAW_DONE_WARN_THRESHOLD) {
    warnings.push("raw_done_rate_low_warn_only");
  }
  if (!shadowRawDonePass && !RAW_DONE_HARD_ENFORCE) {
    warnings.push("raw_done_shadow_hard_would_fail");
  }
  if (suiteAForPhase?.warnings?.length) warnings.push(...suiteAForPhase.warnings);
  if (suiteBForPhase?.warnings?.length) warnings.push(...suiteBForPhase.warnings);

  const failReasons = [];
  if (healthStatus !== "healthy") failReasons.push("backend_unhealthy");
  if (suiteARequired && !suiteAPass) failReasons.push("suite_a_failed");
  if (suiteBRequired && !suiteBPass) failReasons.push("suite_b_failed");
  if (rawDoneHardFail) failReasons.push("raw_done_rate_below_hard_threshold");
  const overallPass = requiredSuitesPass && !rawDoneHardFail;

  const combinedErrors = {
    ...(suiteAForPhase?.metrics?.errorsByType || {}),
  };
  for (const [k, v] of Object.entries(suiteBForPhase?.metrics?.errorsByType || {})) {
    combinedErrors[k] = (combinedErrors[k] || 0) + v;
  }

  const gateSummary = {
    generatedAt: new Date().toISOString(),
    phaseMode,
    suiteA: suiteAForPhase
      ? {
          pass: suiteAForPhase.pass,
          failReasons: suiteAForPhase.failReasons,
          warnings: suiteAForPhase.warnings || [],
          metrics: suiteAForPhase.metrics,
        }
      : null,
    suiteB: suiteBForPhase
      ? {
          pass: suiteBForPhase.pass,
          failReasons: suiteBForPhase.failReasons,
          warnings: suiteBForPhase.warnings || [],
          metrics: suiteBForPhase.metrics,
        }
      : null,
    errors: {
      byType: combinedErrors,
    },
    observability: {
      doneRates: {
        rawDoneRate,
        probeDoneRate,
      },
      rawDone: {
        rawMissingDoneCount: gateTotals.rawMissingDoneCount,
        attributionCounts: rawDoneAttributionCounts,
        attributionTop: rawDoneAttributionTop,
      },
      noTerminal: {
        rawNoTerminalCount: gateTotals.rawNoTerminalCount,
        probeNoTerminalCount: gateTotals.probeNoTerminalCount,
      },
      rawMissingDoneSuppressedCount: {
        suiteA: suiteAForPhase?.metrics?.rawMissingDoneSuppressedCount || 0,
        suiteB: suiteBForPhase?.metrics?.rawMissingDoneSuppressedCount || 0,
        total:
          (suiteAForPhase?.metrics?.rawMissingDoneSuppressedCount || 0) +
          (suiteBForPhase?.metrics?.rawMissingDoneSuppressedCount || 0),
      },
    },
    retryUsedCount:
      (suiteAForPhase?.metrics?.retryUsedCount || 0) + (suiteBForPhase?.metrics?.retryUsedCount || 0),
    promotion: {
      updateEnabled: canUpdatePromotion,
      skipReason: resolvedPromotionSkipReason,
    },
    promotionSignal: {
      consecutivePasses,
      threshold: PROMOTION_PASS_THRESHOLD,
      recommendPhase2: consecutivePasses >= PROMOTION_PASS_THRESHOLD,
    },
    health: {
      status: healthStatus,
      reason: healthReason,
    },
    shadowGate: {
      rawDone: {
        threshold: RAW_DONE_SHADOW_HARD_THRESHOLD,
        actualRate: rawDoneRate,
        pass: shadowRawDonePass,
        reason: shadowRawDoneReason,
        enforce: RAW_DONE_HARD_ENFORCE,
      },
    },
    overall: {
      pass: overallPass,
      failReasons,
      warnings,
      blockingSuites: {
        suiteA: suiteARequired,
        suiteB: suiteBRequired,
      },
    },
    artifacts: {
      suiteASummary: suiteA ? path.join(outDir, "suite_a_summary.json") : null,
      suiteBSummary: suiteB ? path.join(outDir, "suite_b_summary.json") : null,
    },
  };

  return gateSummary;
};

const writeOnePageReport = async (outDir, context) => {
  const lines = [];
  lines.push("# Website Barcode E2E Report (Product Gate)");
  lines.push("");
  lines.push(`- API Base: \`${API_BASE_URL}\``);
  lines.push(`- Phase Mode: **${context.gate.phaseMode.toUpperCase()}**`);
  lines.push(`- Backend Health: **${String(context.gate.health?.status || "unknown").toUpperCase()}**`);
  lines.push(`- Overall Gate: **${context.gate.overall.pass ? "PASS" : "FAIL"}**`);
  lines.push(`- Suite A: ${context.gate.suiteA ? (context.gate.suiteA.pass ? "PASS" : "FAIL") : "N/A"}`);
  lines.push(`- Suite B: ${context.gate.suiteB ? (context.gate.suiteB.pass ? "PASS" : "FAIL") : "N/A"}`);
  lines.push(
    `- Done Rate (raw/probe): ${((context.gate.observability?.doneRates?.rawDoneRate || 0) * 100).toFixed(1)}% / ${((context.gate.observability?.doneRates?.probeDoneRate || 0) * 100).toFixed(1)}%`,
  );
  const rawAttributionTop = context.gate.observability?.rawDone?.attributionTop || [];
  if (rawAttributionTop.length) {
    const topText = rawAttributionTop
      .slice(0, 3)
      .map((entry) => `${entry.key}:${entry.count}`)
      .join(", ");
    lines.push(`- Raw missing done top causes: ${topText}`);
  }
  const shadowRawDone = context.gate.shadowGate?.rawDone;
  if (shadowRawDone) {
    lines.push(
      `- Shadow rawDone hard gate: ${shadowRawDone.pass ? "PASS" : "FAIL"} (threshold=${(Number(shadowRawDone.threshold || 0) * 100).toFixed(1)}%, enforce=${shadowRawDone.enforce ? "on" : "off"})`,
    );
  }
  lines.push("");

  const addSuiteSection = (title, suite) => {
    if (!suite) return;
    const m = suite.metrics;
    lines.push(`## ${title}`);
    lines.push("");
    lines.push(`- total: ${m.total}`);
    lines.push(`- unknown: ${m.unknownCount} (${(m.unknownRatio * 100).toFixed(1)}%)`);
    lines.push(`- AbortError: ${m.abortErrorCount}`);
    lines.push(`- revision1 rate: ${(m.revision1Rate * 100).toFixed(1)}%`);
    lines.push(`- detail 2xx rate: ${(m.detail2xxRate * 100).toFixed(1)}%`);
    lines.push(`- enrich p90: ${m.enrichBestBundleP90Ms ?? "n/a"}ms`);
    lines.push(`- detail p90: ${m.detailP90Ms ?? "n/a"}ms`);
    lines.push(`- overview.presentRatio: ${(m.overviewPresentRatio * 100).toFixed(1)}%`);
    lines.push(`- overview.strongTokenRatio: ${(m.overviewStrongTokenRatio * 100).toFixed(1)}%`);
    lines.push(`- usage.presentRatio: ${(m.usagePresentRatio * 100).toFixed(1)}%`);
    lines.push(`- scoreAvailable.trueRatio: ${(m.scoreAvailableTrueRatio * 100).toFixed(1)}%`);
    lines.push(`- rawMissingDoneSuppressedCount: ${m.rawMissingDoneSuppressedCount || 0}`);
    if (title.includes("Suite B")) {
      lines.push(`- sourceType=web ratio: ${(m.sourceTypeWebRatio * 100).toFixed(1)}%`);
    }
    lines.push(`- retryUsedCount: ${m.retryUsedCount}`);
    if (suite.failReasons.length) {
      lines.push(`- failReasons: ${suite.failReasons.join(", ")}`);
    }
    if (Array.isArray(suite.warnings) && suite.warnings.length) {
      lines.push(`- warnings: ${suite.warnings.join(", ")}`);
    }
    lines.push("");
  };

  addSuiteSection("Suite A (KB)", context.gate.suiteA);
  addSuiteSection("Suite B (Web)", context.gate.suiteB);

  if (context.sseContract) {
    lines.push("## SSE Contract");
    lines.push("");
    lines.push(`- rev0 rate: ${(context.sseContract.contract.revision0Rate * 100).toFixed(1)}%`);
    lines.push(`- rev1 rate: ${(context.sseContract.contract.revision1Rate * 100).toFixed(1)}%`);
    lines.push(`- done rate: ${(context.sseContract.contract.doneRate * 100).toFixed(1)}%`);
    lines.push(`- AbortError: ${context.sseContract.contract.abortErrorCount}`);
    lines.push("- failure breakdown:");
    for (const [k, v] of Object.entries(context.sseContract.failureCounts || {})) {
      lines.push(`  - ${k}: ${v}`);
    }
    lines.push("");
  }

  lines.push("## Promotion Signal");
  lines.push("");
  lines.push(`- consecutive Suite B passes: ${context.gate.promotionSignal.consecutivePasses}`);
  lines.push(`- threshold: ${context.gate.promotionSignal.threshold}`);
  lines.push(`- recommend Phase2: ${context.gate.promotionSignal.recommendPhase2 ? "yes" : "no"}`);
  lines.push("");

  lines.push("## Errors by Type");
  lines.push("");
  for (const [k, v] of Object.entries(context.gate.errors.byType || {})) {
    lines.push(`- ${k}: ${v}`);
  }
  lines.push("");

  if (context.checklist) {
    const scanOk = context.checklist.scans.filter((row) => row.ok).length;
    const scanRev1 = context.checklist.scans.filter((row) => row.ok && Number.isFinite(row.tRevision1Ms)).length;
    const detail2xx = context.checklist.details.filter((row) => row.status >= 200 && row.status < 300).length;
    const detailTimes = context.checklist.details
      .map((row) => row.timingMs)
      .filter((value) => Number.isFinite(value) && value > 0);
    lines.push("## Checklist 10x");
    lines.push("");
    lines.push(`- barcode: \`${context.checklist.barcode}\``);
    lines.push(`- scans ok: ${scanOk}/10`);
    lines.push(`- revision1 reached: ${scanRev1}/10`);
    lines.push(`- detail HTTP 2xx: ${detail2xx}/10`);
    lines.push(
      `- detail timing p50/p90: ${percentile(detailTimes, 50) ?? "n/a"}ms / ${percentile(detailTimes, 90) ?? "n/a"}ms`,
    );
    lines.push("");
  }

  if (context.disconnectProbe) {
    lines.push("## Client Disconnect Probe");
    lines.push("");
    lines.push(`- barcode: \`${context.disconnectProbe.barcode}\``);
    lines.push(`- pass: ${context.disconnectProbe.pass ? "yes" : "no"}`);
    lines.push(`- rev0 seen before abort: ${context.disconnectProbe.rev0Seen ? "yes" : "no"}`);
    lines.push(`- disconnect triggered: ${context.disconnectProbe.disconnectTriggered ? "yes" : "no"}`);
    lines.push(`- abort error observed: ${context.disconnectProbe.abortError ? "yes" : "no"}`);
    lines.push(`- fatalError: ${context.disconnectProbe.fatalError ?? "none"}`);
    lines.push("");
  }

  await fs.promises.writeFile(path.join(outDir, "one_page_report.md"), lines.join("\n"), "utf8");
};

const ensureBackendReachable = async () => {
  const timeoutMs = Math.min(5000, REQUEST_TIMEOUT_MS);
  const baseUrl = API_BASE_URL.replace(/\/$/, "");
  const probeUrls = [
    `${baseUrl}/health`,
    `${baseUrl}/api/nutri-tips`,
    `${baseUrl}/internal/metrics`,
  ];
  const probeHeaders = {
    ...defaultHeaders,
    ...(REGRESSION_TOKEN ? { "x-regression-token": REGRESSION_TOKEN } : {}),
    ...(AUTH_DISABLED_HEADER ? { "x-auth-disabled": AUTH_DISABLED_HEADER } : {}),
  };

  for (const probeUrl of probeUrls) {
    try {
      // eslint-disable-next-line no-await-in-loop
      const probe = await fetchWithTimeout(
        probeUrl,
        {
          method: "GET",
          headers: probeHeaders,
        },
        timeoutMs,
      );
      // Any non-5xx response means backend routing is reachable.
      if (probe.status > 0 && probe.status < 500) return true;
    } catch {
      // continue trying remaining read-only probes
    }
  }

  return false;
};

const parseApiBaseForHealthProbe = () => {
  try {
    const parsed = new URL(API_BASE_URL);
    const fallbackPort = parsed.protocol === "https:" ? 443 : 80;
    const port = Number(parsed.port || fallbackPort);
    return {
      port: Number.isFinite(port) ? port : 3001,
      url: `${API_BASE_URL.replace(/\/$/, "")}/health`,
    };
  } catch {
    return {
      port: 3001,
      url: "http://127.0.0.1:3001/health",
    };
  }
};

const deriveBackendHealthReason = (health) => {
  if (health.status === "healthy") return null;
  if (typeof health.error === "string" && health.error.trim()) return health.error.trim();
  if (typeof health.http === "string" && health.http && health.http !== "200") {
    return `http_${health.http}`;
  }
  if (!health.pid) return "backend_pid_missing";
  return "backend_unhealthy";
};

const runBackendHealthCheck = async (outDir) => {
  const { port, url } = parseApiBaseForHealthProbe();
  let payload = null;
  let stderrText = "";
  try {
    const proc = spawnSync(BACKEND_HEALTH_CHECK_SCRIPT, [String(port), url], {
      encoding: "utf8",
    });
    stderrText = String(proc.stderr ?? "").trim();
    const stdoutText = String(proc.stdout ?? "").trim();
    const line = stdoutText
      .split(/\r?\n/)
      .map((entry) => entry.trim())
      .filter(Boolean)
      .at(-1);
    if (line) {
      try {
        payload = JSON.parse(line);
      } catch {
        payload = null;
      }
    }
    if (proc.status !== 0) {
      payload = {
        ...(payload && typeof payload === "object" ? payload : {}),
        status: "unhealthy",
        error:
          (payload && typeof payload.error === "string" && payload.error.trim()) ||
          stderrText ||
          `backend_health_check_exit_${proc.status}`,
      };
    }
  } catch (error) {
    payload = {
      status: "unhealthy",
      error: error instanceof Error ? error.message : String(error),
    };
  }

  const normalized = {
    ts: typeof payload?.ts === "string" ? payload.ts : new Date().toISOString(),
    status: payload?.status === "healthy" ? "healthy" : "unhealthy",
    port: Number.isFinite(Number(payload?.port)) ? Number(payload.port) : port,
    pid: typeof payload?.pid === "string" ? payload.pid : "",
    http: typeof payload?.http === "string" ? payload.http : "",
    url: typeof payload?.url === "string" ? payload.url : url,
    error:
      typeof payload?.error === "string"
        ? payload.error
        : stderrText || "",
  };
  const reason = deriveBackendHealthReason(normalized);
  const health = { ...normalized, reason };
  await writeJson(path.join(outDir, "backend_health.json"), health);
  return health;
};

const buildWebFixtureFromHarvest = async (harvested, options) => {
  const candidates = [...(harvested.ca || []), ...(harvested.us || [])];
  const accepted = [];
  const rejected = [];

  for (const item of candidates) {
    const normalized = normalizeFixtureEntry(
      {
        barcode: item.barcode,
        region: item.region,
        site: item.site,
        sourceUrl: item.url,
        title: item.title,
        brand: item.brand,
      },
      accepted.length + rejected.length,
      { expectedSourceType: "web", notes: "generated_from_harvest" },
    );
    if (!normalized) continue;

    let sourceType = null;
    let errorType = null;
    try {
      const sse = await fetchSse(
        `${API_BASE_URL}/api/enrich-stream`,
        { barcode: normalized.barcode },
        { stopOn: options.sseStopOn, stopTailMs: options.sseStopTailMs, retries: options.retries },
      );
      const picked = pickBundleEvents(sse.events);
      sourceType = picked.rev1?.data?.meta?.sourceType ?? null;
      errorType = sse.terminalErrorType ?? null;
    } catch (error) {
      errorType = classifyErrorType(error);
    }

    if (sourceType === "web") {
      accepted.push({
        ...normalized,
        expectedSourceType: "web",
        expectedScoreAvailable: false,
        verifiedAt: new Date().toISOString().slice(0, 10),
        notes: normalized.notes || "generated_from_harvest_web_only",
      });
    } else {
      rejected.push({
        barcode: normalized.barcode,
        region: normalized.region,
        site: normalized.site,
        sourceType,
        errorType,
        sourceUrl: normalized.sourceUrl,
      });
    }
  }

  return {
    accepted,
    rejected,
    report: {
      generatedAt: new Date().toISOString(),
      candidateCount: candidates.length,
      acceptedCount: accepted.length,
      rejectedCount: rejected.length,
      rejectedBySourceType: countBy(rejected, (row) => row.sourceType || row.errorType || "unknown"),
    },
  };
};

const buildCompatibilitySummary = (suiteAResults, suiteBResults) => {
  const allRows = [...suiteAResults, ...suiteBResults];
  const sourceTypeCounts = countBy(allRows, (row) => row.sse.sourceType || "unknown");
  const terminalCodeCounts = countBy(allRows, (row) => row.sse.terminalCode || "none");
  const derivedTerminalCodeCounts = countBy(allRows, (row) => row.sse.derivedTerminalCode || "none");
  const errorReasonCounts = countBy(allRows, (row) => row.sse.errorReasonCode || "none");
  const fallbackReasonCounts = countBy(allRows, (row) => row.sse.fallbackReason || "none");
  const authorityFailureReasonCounts = countBy(allRows, (row) => row.sse.authorityFailureReason || "none");
  const detailTimes = allRows
    .map((row) => row.sections.ingredients_detail.timingMs)
    .filter((v) => Number.isFinite(v) && v > 0);

  return {
    rows: allRows.map((row) => ({
      region: row.input.region,
      site: row.input.site,
      barcode: row.input.barcode,
      sourceType: row.sse.sourceType,
      sourceTypeFinal: row.sse.sourceTypeFinal,
      terminalCode: row.sse.terminalCode,
      derivedTerminalCode: row.sse.derivedTerminalCode,
      errorReasonCode: row.sse.errorReasonCode,
      fallbackReason: row.sse.fallbackReason,
      authorityFailureReason: row.sse.authorityFailureReason,
      identityType: row.sse.identityType,
      identityValue: row.sse.identityValue,
      revision0Ms: row.sse.revision0Ms,
      revision1Ms: row.sse.revision1Ms,
      ingredientsStatus: row.sections.ingredients_detail.dataStatus,
      detailStatusCode: row.sections.ingredients_detail.status,
      detailDataStatus: row.sections.ingredients_detail.dataStatus,
      detailTimingMs: row.sections.ingredients_detail.timingMs,
      overviewPresent: row.contracts.overviewPresent,
      overviewStrongTokenPresent: row.contracts.overviewStrongTokenPresent,
      usagePresent: row.contracts.usagePresent,
      scoreAvailable: row.sse.scoreAvailable,
      finalProbeAttempted: row.finalProbe?.attempted ?? false,
      finalProbeReason: row.finalProbe?.reason ?? null,
      errors: row.errors,
      sourceUrl: row.input.sourceUrl,
      title: row.input.title,
    })),
    stats: {
      total: allRows.length,
      countsBySourceType: sourceTypeCounts,
      countsByTerminalCode: terminalCodeCounts,
      countsByDerivedTerminalCode: derivedTerminalCodeCounts,
      countsByErrorReasonCode: errorReasonCounts,
      countsByFallbackReason: fallbackReasonCounts,
      countsByAuthorityFailureReason: authorityFailureReasonCounts,
      detailTimingP50Ms: percentile(detailTimes, 50),
      detailTimingP90Ms: percentile(detailTimes, 90),
    },
  };
};

const buildSseContractSummary = (rows) => {
  const total = rows.length;
  const byFailure = countBy(rows, (row) => row.sse.contractFailure || "none");
  const rev0Count = rows.filter((row) => row.sse.rev0Seen).length;
  const rev1Count = rows.filter((row) => row.sse.rev1Seen).length;
  const doneCount = rows.filter((row) => row.sse.doneSeen).length;
  const abortErrorCount = rows.filter((row) => row.sse.abortError).length;
  const missingDoneSuppressedCount = rows.filter((row) => row.sse.missingDoneSuppressed === true).length;
  return {
    generatedAt: new Date().toISOString(),
    total,
    contract: {
      revision0Rate: total > 0 ? rev0Count / total : 0,
      revision1Rate: total > 0 ? rev1Count / total : 0,
      doneRate: total > 0 ? doneCount / total : 0,
      abortErrorCount,
      missingDoneSuppressedCount,
    },
    failureCounts: byFailure,
    failureRatios: Object.fromEntries(
      Object.entries(byFailure).map(([key, value]) => [key, total > 0 ? value / total : 0]),
    ),
  };
};

const writeSseContractReport = async (outDir, summary) => {
  const lines = [];
  lines.push("# SSE Contract Report");
  lines.push("");
  lines.push(`- Total: ${summary.total}`);
  lines.push(`- rev0: ${(summary.contract.revision0Rate * 100).toFixed(1)}%`);
  lines.push(`- rev1: ${(summary.contract.revision1Rate * 100).toFixed(1)}%`);
  lines.push(`- done: ${(summary.contract.doneRate * 100).toFixed(1)}%`);
  lines.push(`- AbortError: ${summary.contract.abortErrorCount}`);
  lines.push(`- rawMissingDoneSuppressedCount: ${summary.contract.missingDoneSuppressedCount || 0}`);
  lines.push("");
  lines.push("## Failure Breakdown");
  lines.push("");
  const failures = Object.entries(summary.failureCounts).sort((a, b) => b[1] - a[1]);
  for (const [failure, count] of failures) {
    const ratio = summary.failureRatios[failure] ?? 0;
    lines.push(`- ${failure}: ${count} (${(ratio * 100).toFixed(1)}%)`);
  }
  lines.push("");
  await fs.promises.writeFile(path.join(outDir, "sse_contract_report.md"), lines.join("\n"), "utf8");
};

const runSuite = async (suiteName, entries, options) => {
  const rows = [];
  for (const item of entries) {
    console.log(`[website-e2e] [suite-${suiteName}] barcode=${item.barcode} region=${item.region} site=${item.site}`);
    // eslint-disable-next-line no-await-in-loop
    const row = await runFullFlow(item, options);
    rows.push(row);
  }

  const summary = summarizeSuite(
    suiteName,
    rows,
    suiteName === "A" ? "kb" : "web",
    options.phaseMode,
  );

  return { rows, summary };
};

const pickChecklistBarcode = (suiteAResults, suiteBResults) => {
  const all = [...(suiteAResults || []), ...(suiteBResults || [])];
  const ok = all.filter((row) => !row.errors?.length && row.sse?.sourceType);
  const ln = ok.find((row) => row.sse.sourceType === "lnhpd");
  if (ln) return ln.input.barcode;
  const ds = ok.find((row) => row.sse.sourceType === "dsld");
  if (ds) return ds.input.barcode;
  const web = ok.find((row) => row.sse.sourceType === "web");
  if (web) return web.input.barcode;
  return all[0]?.input?.barcode ?? null;
};

const runChecklist = async (barcode, options) => {
  if (!barcode) return null;
  const scans = [];
  for (let i = 0; i < 10; i += 1) {
    // eslint-disable-next-line no-await-in-loop
    const sse = await fetchSse(
      `${API_BASE_URL}/api/enrich-stream`,
      { barcode },
      { stopOn: options.sseStopOn, stopTailMs: options.sseStopTailMs, retries: options.retries },
    );
    const picked = pickBundleEvents(sse.events);
    const errorType = sse.terminalErrorType ?? classifySseContractFailure({ sse, picked });
    scans.push({
      run: i + 1,
      ok: !errorType,
      sourceType: picked.rev1?.data?.meta?.sourceType ?? null,
      identityType: picked.rev1?.data?.meta?.authoritativeIdentity?.type ?? null,
      tRevision0Ms: picked.rev0?.tMs ?? null,
      tRevision1Ms: picked.rev1?.tMs ?? null,
      doneMs: picked.done?.tMs ?? null,
      errorType: errorType ?? null,
    });
  }

  const firstOk = scans.find((item) => item.ok);
  if (!firstOk) {
    return {
      barcode,
      scans,
      details: [],
    };
  }

  const metaSse = await fetchSse(
    `${API_BASE_URL}/api/enrich-stream`,
    { barcode },
    { stopOn: options.sseStopOn, stopTailMs: options.sseStopTailMs, retries: options.retries },
  );
  const meta = pickBundleEvents(metaSse.events).rev1?.data?.meta ?? null;

  const details = [];
  for (let i = 0; i < 10; i += 1) {
    // eslint-disable-next-line no-await-in-loop
    const detail = await fetchAnalysisSection(meta, "ingredients_detail", { retries: options.retries });
    details.push({
      run: i + 1,
      ok: detail.status >= 200 && detail.status < 300,
      status: detail.status,
      timingMs: detail.timingMs,
      dataStatus: detail.dataStatus ?? null,
      fallbackUsed: detail.fallbackUsed ?? null,
      errorType: detail.errorType ?? null,
    });
  }

  return { barcode, scans, details };
};

const runClientDisconnectProbe = async (barcode) => {
  if (!barcode) return null;

  const ctrl = new AbortController();
  const timeoutMs = Math.min(SSE_TIMEOUT_MS, 12_000);
  const timeout = setTimeout(() => ctrl.abort(), timeoutMs);
  const startedAt = performance.now();

  let rev0Seen = false;
  let doneSeen = false;
  let streamClosed = false;
  let bytesReceived = 0;
  let lastEventType = null;
  let lastEventAtMs = null;
  let abortError = false;
  let parseErrorCount = 0;
  let disconnectTriggered = false;
  let terminalErrorType = null;
  let fatalError = null;

  const payload = { barcode };

  try {
    const response = await fetch(`${API_BASE_URL}/api/enrich-stream`, {
      method: "POST",
      headers: apiHeaders,
      body: JSON.stringify(payload),
      signal: ctrl.signal,
    });

    if (!response.ok) {
      throw new E2eError(errorTypeFromStatus(response.status), `disconnect probe HTTP ${response.status}`, {
        status: response.status,
        retryable: false,
      });
    }

    const reader = response.body?.getReader();
    if (!reader) {
      throw new E2eError("parse_failed", "disconnect probe reader unavailable", { retryable: false });
    }

    const decoder = new TextDecoder();
    let buffer = "";
    let currentEvent = null;
    let currentData = "";
    const flush = () => {
      if (!currentEvent) return;
      const payloadRaw = currentData.trim();
      const tMs = Math.round(performance.now() - startedAt);
      lastEventType = currentEvent;
      lastEventAtMs = tMs;
      if (currentEvent === "done") {
        doneSeen = true;
      }
      if (currentEvent === "analysis_bundle" && payloadRaw) {
        try {
          const parsed = JSON.parse(payloadRaw);
          if (Number(parsed?.meta?.revision) === 0 && !rev0Seen) {
            rev0Seen = true;
            disconnectTriggered = true;
            ctrl.abort();
          }
        } catch {
          parseErrorCount += 1;
        }
      }
      currentEvent = null;
      currentData = "";
    };

    while (true) {
      // eslint-disable-next-line no-await-in-loop
      const { value, done } = await reader.read();
      if (done) {
        streamClosed = true;
        break;
      }
      if (value) bytesReceived += value.byteLength;
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split(/\r?\n/);
      buffer = lines.pop() || "";
      for (const line of lines) {
        if (!line.trim()) {
          flush();
          continue;
        }
        if (line.startsWith("event:")) currentEvent = line.slice(6).trim();
        if (line.startsWith("data:")) currentData += line.slice(5).trim();
      }
    }

    flush();
  } catch (error) {
    terminalErrorType = classifyErrorType(error);
    abortError = terminalErrorType === "AbortError";
    if (!abortError) {
      fatalError = String(error?.message ?? error);
    }
  } finally {
    clearTimeout(timeout);
  }

  return {
    barcode,
    attempted: true,
    disconnectTriggered,
    rev0Seen,
    doneSeen,
    streamClosed,
    abortError,
    terminalErrorType,
    fatalError,
    bytesReceived,
    lastEventType,
    lastEventAtMs,
    parseErrorCount,
    pass: rev0Seen && disconnectTriggered && abortError && !fatalError,
  };
};

const runGateOnly = async (
  outDir,
  phaseMode,
  {
    backendHealth = null,
    promotionUpdateEnabled = false,
    promotionSkipReason = "gate_only",
  } = {},
) => {
  const suiteASummaryPath = path.join(outDir, "suite_a_summary.json");
  const suiteBSummaryPath = path.join(outDir, "suite_b_summary.json");

  const suiteA = await readJson(suiteASummaryPath).catch(() => null);
  const suiteB = await readJson(suiteBSummaryPath).catch(() => null);
  const resolvedPromotionSkipReason =
    !suiteA && !suiteB
      ? "gate_only_no_suite_summaries"
      : promotionSkipReason;

  const gate = await buildGateSummary({
    suiteA,
    suiteB,
    phaseMode,
    outDir,
    promotionUpdateEnabled,
    promotionSkipReason: resolvedPromotionSkipReason,
    backendHealth,
  });
  await writeJson(path.join(outDir, "gate_summary.json"), gate);
  await writeOnePageReport(outDir, { gate });
  console.log(`[website-e2e] gate-only done: ${path.join(outDir, "gate_summary.json")}`);
};

const main = async () => {
  const options = parseArgs(process.argv.slice(2));
  await fs.promises.mkdir(OUT_DIR, { recursive: true });
  let backendHealth = await runBackendHealthCheck(OUT_DIR);
  let backendHealthy = backendHealth.status === "healthy";
  let backendReachable = null;

  if (!backendHealthy) {
    backendReachable = await ensureBackendReachable();
    if (backendReachable) {
      backendHealthy = true;
      backendHealth = {
        ...backendHealth,
        status: "healthy",
        reason: "health_probe_unhealthy_but_readonly_reachable",
        error: "",
      };
      await writeJson(path.join(OUT_DIR, "backend_health.json"), backendHealth);
      console.warn("[website-e2e] health probe failed but read-only fallback probe succeeded; continuing.");
    }
  }

  if (options.gateOnly) {
    await runGateOnly(OUT_DIR, options.phaseMode, {
      backendHealth,
      promotionUpdateEnabled: false,
      promotionSkipReason: backendHealthy ? "gate_only" : "gate_only_backend_unhealthy",
    });
    return;
  }

  if (!backendHealthy) {
    const gate = await buildGateSummary({
      suiteA: null,
      suiteB: null,
      phaseMode: options.phaseMode,
      outDir: OUT_DIR,
      promotionUpdateEnabled: false,
      promotionSkipReason: "backend_unhealthy",
      backendHealth,
    });
    await writeJson(path.join(OUT_DIR, "gate_summary.json"), gate);
    await writeOnePageReport(OUT_DIR, { gate });
    console.warn(`[website-e2e] backend unhealthy, round skipped (promotion not updated). reason=${backendHealth.reason || "unknown"}`);
    console.log(`[website-e2e] artifacts: ${OUT_DIR}`);
    return;
  }

  if (backendReachable == null) {
    backendReachable = await ensureBackendReachable();
  }
  if (!backendReachable) {
    const degradedHealth = {
      ...backendHealth,
      status: "unhealthy",
      reason: backendHealth.reason || "backend_reachability_failed",
      error: backendHealth.error || "backend_reachability_failed",
    };
    await writeJson(path.join(OUT_DIR, "backend_health.json"), degradedHealth);
    const gate = await buildGateSummary({
      suiteA: null,
      suiteB: null,
      phaseMode: options.phaseMode,
      outDir: OUT_DIR,
      promotionUpdateEnabled: false,
      promotionSkipReason: "backend_unhealthy",
      backendHealth: degradedHealth,
    });
    await writeJson(path.join(OUT_DIR, "gate_summary.json"), gate);
    await writeOnePageReport(OUT_DIR, { gate });
    console.warn(`[website-e2e] backend reachability check failed, round skipped.`);
    console.log(`[website-e2e] artifacts: ${OUT_DIR}`);
    return;
  }

  console.log(`[website-e2e] API_BASE_URL=${API_BASE_URL}`);
  console.log(
    `[website-e2e] mode suite=${options.suite} stopOn=${options.sseStopOn} tailMs=${options.sseStopTailMs} retries=${options.retries}`,
  );
  if (options.skipPostchecks) {
    console.log("[website-e2e] skip-postchecks enabled (checklist + disconnect probe skipped)");
  }

  let harvested = null;
  if (options.harvestOnly || options.buildWebFixture) {
    console.log("[website-e2e] harvesting barcodes from websites...");
    const caSite = SITE_CONFIGS.find((x) => x.region === "CA");
    const usSite = SITE_CONFIGS.find((x) => x.region === "US");
    const ca = await harvestFromSite(caSite, TARGET_CA);
    const us = await harvestFromSite(usSite, TARGET_US);

    harvested = {
      ca: ca.harvested,
      us: us.harvested,
      filteredOut: [...ca.filteredOut, ...us.filteredOut],
      failures: [...ca.failed.map((x) => `CA:${x}`), ...us.failed.map((x) => `US:${x}`)],
    };

    await writeJson(path.join(OUT_DIR, "harvested_barcodes.json"), harvested);
    console.log(`[website-e2e] harvested total=${(harvested.ca?.length || 0) + (harvested.us?.length || 0)}`);

    if (options.buildWebFixture) {
      const built = await buildWebFixtureFromHarvest(harvested, options);
      const generatedFixturePath = path.join(OUT_DIR, "web_only_barcodes.generated.json");
      await writeJson(generatedFixturePath, built.accepted);
      await writeJson(path.join(OUT_DIR, "build_web_fixture_report.json"), built.report);
      await writeJson(path.join(OUT_DIR, "build_web_fixture_rejected.json"), built.rejected);
      console.log(`[website-e2e] generated web fixture accepted=${built.accepted.length} rejected=${built.rejected.length}`);
    }

    if (options.harvestOnly) {
      console.log(`[website-e2e] harvest-only done. artifacts: ${OUT_DIR}`);
      return;
    }
  }

  const fixtures = await resolveFixtureInputs(options);
  let suiteAEntries = [];
  let suiteBEntries = [];

  if (options.suite === "kb") {
    suiteAEntries = fixtures.kb;
  } else if (options.suite === "web") {
    suiteBEntries = fixtures.web;
  } else {
    suiteAEntries = fixtures.kb;
    suiteBEntries = fixtures.web;
  }

  if (options.suite !== "web" && suiteAEntries.length === 0) {
    throw new Error("Suite A selected but no KB fixture entries available.");
  }
  if (options.suite !== "kb" && suiteBEntries.length === 0) {
    throw new Error("Suite B selected but no web fixture entries available.");
  }

  let suiteA = null;
  let suiteB = null;

  if (suiteAEntries.length) {
    suiteA = await runSuite("A", suiteAEntries, options);
    await writeJson(path.join(OUT_DIR, "suite_a_results.json"), suiteA.rows);
    await writeJson(path.join(OUT_DIR, "suite_a_summary.json"), suiteA.summary);
  }

  if (suiteBEntries.length) {
    suiteB = await runSuite("B", suiteBEntries, options);
    await writeJson(path.join(OUT_DIR, "suite_b_results.json"), suiteB.rows);
    await writeJson(path.join(OUT_DIR, "suite_b_summary.json"), suiteB.summary);
  }

  const compatibilitySummary = buildCompatibilitySummary(suiteA?.rows || [], suiteB?.rows || []);
  const allRows = [...(suiteA?.rows || []), ...(suiteB?.rows || [])];
  await writeJson(path.join(OUT_DIR, "e2e_results.json"), allRows);
  await writeJson(path.join(OUT_DIR, "e2e_summary.json"), compatibilitySummary);
  const sseContractSummary = buildSseContractSummary(allRows);
  await writeJson(path.join(OUT_DIR, "sse_contract_results.json"), allRows.map((row) => ({
    barcode: row.input.barcode,
    region: row.input.region,
    site: row.input.site,
    sourceType: row.sse.sourceType,
    sourceTypeFinal: row.sse.sourceTypeFinal,
    terminalCode: row.sse.terminalCode,
    errorReasonCode: row.sse.errorReasonCode,
    fallbackReason: row.sse.fallbackReason,
    authorityFailureReason: row.sse.authorityFailureReason,
    revision0Ms: row.sse.revision0Ms,
    revision1Ms: row.sse.revision1Ms,
    doneMs: row.sse.doneMs,
    bytesReceived: row.sse.bytesReceived,
    lastEventType: row.sse.lastEventType,
    lastEventAtMs: row.sse.lastEventAtMs,
    parseErrorCount: row.sse.parseErrorCount,
    streamClosed: row.sse.streamClosed,
    timedOut: row.sse.timedOut,
    abortError: row.sse.abortError,
    contractFailure: row.sse.contractFailure,
    terminalErrorType: row.sse.terminalErrorType,
    derivedTerminalCode: row.sse.derivedTerminalCode,
  })));
  await writeJson(path.join(OUT_DIR, "sse_contract_summary.json"), sseContractSummary);
  await writeSseContractReport(OUT_DIR, sseContractSummary);

  const gate = await buildGateSummary({
    suiteA: suiteA?.summary || null,
    suiteB: suiteB?.summary || null,
    phaseMode: options.phaseMode,
    outDir: OUT_DIR,
    promotionUpdateEnabled: backendHealthy,
    promotionSkipReason: backendHealthy ? null : "backend_unhealthy",
    backendHealth,
  });
  await writeJson(path.join(OUT_DIR, "gate_summary.json"), gate);

  const checklistBarcode = pickChecklistBarcode(suiteA?.rows || [], suiteB?.rows || []);
  let checklist = null;
  if (checklistBarcode && !options.skipPostchecks) {
    console.log(`[website-e2e] checklist barcode=${checklistBarcode}`);
    checklist = await runChecklist(checklistBarcode, options);
    await writeJson(path.join(OUT_DIR, "checklist_10x.json"), checklist);
  }

  let disconnectProbe = null;
  if (checklistBarcode && !options.skipPostchecks) {
    disconnectProbe = await runClientDisconnectProbe(checklistBarcode);
    await writeJson(path.join(OUT_DIR, "client_disconnect_probe.json"), disconnectProbe);
  }

  await writeOnePageReport(OUT_DIR, { gate, checklist, sseContract: sseContractSummary, disconnectProbe });

  console.log(`[website-e2e] done. gate=${gate.overall.pass ? "PASS" : "FAIL"}`);
  console.log(`[website-e2e] artifacts: ${OUT_DIR}`);
};

main().catch((error) => {
  console.error("[website-e2e] failed:", error);
  process.exit(1);
});
