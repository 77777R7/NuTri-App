#!/usr/bin/env node
/* eslint-disable no-console */
import fs from "node:fs/promises";
import fsSync from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";

import {
  buildOverlayRecordKey,
  buildPatchStrategy,
  classifyOverlayStatus,
  deriveCompleteness,
  extractOverlayRecordFromSeedRow,
  mergeOverlayRecords,
  normalizeText,
  qualifiesHighConfidenceUsProductPage,
  stableHash,
  toGtin14,
} from "./lib/iherb-overlay-utils.mjs";
import { runMacosVisionOcr } from "./lib/macos-vision-ocr.mjs";

const ROOT = process.cwd();
const args = process.argv.slice(2);

const getArg = (name, fallback = null) => {
  const flag = `--${name}`;
  const idx = args.indexOf(flag);
  if (idx === -1 || idx + 1 >= args.length) return fallback;
  return args[idx + 1];
};

const getJsonArg = (name) => {
  const raw = getArg(name, null);
  return raw ? JSON.parse(raw) : null;
};

const readJsonSync = (filePath) => JSON.parse(fsSync.readFileSync(path.resolve(ROOT, filePath), "utf8"));

const CONFIG_JSON_PATH = getArg("config-json", null);
const CONFIG = CONFIG_JSON_PATH ? readJsonSync(CONFIG_JSON_PATH) : {};

const STAGING_PATH = getArg(
  "staging-json",
  path.join(ROOT, "output", "iherb_overlay_staging_pure_refresh", "staging_products.json"),
);
const QUEUE_PATH = getArg(
  "queue-json",
  path.join(ROOT, "output", "pure_execution_plan_strict", "api_fill_priority_queue.json"),
);
const OUT_DIR = getArg("out-dir", path.join(ROOT, "output", "pure_p0_official_fallback"));
const BRAND_FILTER = getArg("brand", CONFIG.brandName ?? "Pure Encapsulations");
const PRIORITY_LANE = getArg("priority-lane", CONFIG.priorityLane ?? "P0_api_fill_us_strong_identity");
const SITE_ORIGIN = getArg("site-origin", CONFIG.siteOrigin ?? "https://www.pureencapsulationspro.com").replace(/\/+$/, "");
const READER_PREFIX = getArg("reader-prefix", CONFIG.readerPrefix ?? "https://r.jina.ai/http://");
const SEARCH_PATH_TEMPLATE = getArg("search-path-template", CONFIG.searchPathTemplate ?? "/catalogsearch/result/?q={query}");
const LIMIT = Number(getArg("limit", 0)) || null;
const DELAY_MS = Number(getArg("delay-ms", 1500)) || 0;
const REQUEST_TIMEOUT_MS = Number(getArg("request-timeout-ms", 45000)) || 45000;
const MAX_RETRIES = Number(getArg("max-retries", 3)) || 3;
const WRITE_STAGING_OUT = getArg("write-staging-out", "true") !== "false";
const WRITE_REPORT_MD = getArg("write-report-md", "true") !== "false";
const ENABLE_AGENT_BROWSER_FALLBACK =
  getArg("agent-browser-fallback", String(CONFIG.enableAgentBrowserFallback ?? true)) !== "false";
const AGENT_BROWSER_SHELL_CMD = getArg("agent-browser-shell-cmd", "npx agent-browser");
const ENABLE_IMAGE_OCR_FALLBACK =
  getArg("image-ocr-fallback", String(CONFIG.enableImageOcrFallback ?? true)) !== "false";
const ENABLE_STAGED_IMAGE_OCR =
  getArg("staged-image-ocr", String(CONFIG.enableStagedImageOcr ?? true)) !== "false";
const OCR_MAX_IMAGES = Number(getArg("ocr-max-images", CONFIG.ocrMaxImages ?? 6)) || 6;
const CATALOG_API = getJsonArg("catalog-api-json") ?? CONFIG.catalogApi ?? null;

const CORE_FIELDS = ["ingredient", "dosage", "suggested_use", "warnings", "product_image"];
const DEFAULT_PRODUCT_PAGE_URL_OVERRIDES = {
  "158022": "https://www.pureencapsulationspro.com/boron.html",
  "158067": "https://www.pureencapsulationspro.com/calcium-with-vit-d3.html",
  "158082": "https://www.pureencapsulationspro.com/caprylic-acid.html",
  "158064": "https://www.pureencapsulationspro.com/cat-s-claw.html",
  "158078": "https://www.pureencapsulationspro.com/chaste-tree-vitex.html",
};
const DEFAULT_MANUAL_SECTION_OVERRIDES = {
  "158082": {
    "Suggested use":
      "As a dietary supplement, take 2 capsules, 30 minutes before each meal, or as directed by a health professional.",
  },
};
const PRODUCT_PAGE_URL_OVERRIDES = {
  ...DEFAULT_PRODUCT_PAGE_URL_OVERRIDES,
  ...(getJsonArg("product-page-url-overrides") ?? CONFIG.productPageUrlOverrides ?? {}),
};
const MANUAL_SECTION_OVERRIDES = {
  ...DEFAULT_MANUAL_SECTION_OVERRIDES,
  ...(getJsonArg("manual-section-overrides") ?? CONFIG.manualSectionOverrides ?? {}),
};
const SEARCH_QUERY_OVERRIDES = getJsonArg("search-query-overrides") ?? CONFIG.searchQueryOverrides ?? {};
const BROCHURE_FILENAME_OVERRIDES =
  getJsonArg("brochure-filename-overrides") ?? CONFIG.brochureFilenameOverrides ?? {};
const MANUAL_SUPPLEMENT_FACTS_OVERRIDES =
  getJsonArg("manual-supplement-facts-overrides") ?? CONFIG.manualSupplementFactsOverrides ?? {};

const executionHealth = {
  requests: 0,
  fetchSuccess: 0,
  http429: 0,
  aborted: 0,
  cacheHits: 0,
  retryCount: 0,
};

const normalizeLower = (value) => normalizeText(value).toLowerCase();
const normalizeDigits = (value) => normalizeText(value).replace(/\D/g, "");
const normalizeBarcode = (value) => toGtin14(value) ?? null;
const normalizeStringList = (value) =>
  (Array.isArray(value) ? value : [value])
    .map((item) => normalizeText(item))
    .filter(Boolean);

const REQUIRED_MISSING_FIELDS = normalizeStringList(
  getJsonArg("required-missing-fields-json") ?? CONFIG.requiredMissingFields ?? [],
);
const FORBID_MISSING_FIELDS = normalizeStringList(
  getJsonArg("forbid-missing-fields-json") ?? CONFIG.forbidMissingFields ?? [],
);
const MISSING_FIELDS_MODE = getArg("missing-fields-mode", CONFIG.missingFieldsMode ?? "contains_all");
const REQUIRE_HIGH_CONFIDENCE_PRODUCT_PAGE_READY =
  getArg(
    "require-high-confidence-product-page-ready",
    String(CONFIG.requireHighConfidenceProductPageReady ?? false),
  ) === "true";
const REQUIRE_US_IHERB_PATH = getArg("require-us-iherb-path", String(CONFIG.requireUsIherbPath ?? false)) === "true";
const INCLUDE_PRODUCT_IDS = new Set(
  normalizeStringList(getJsonArg("product-ids-json") ?? CONFIG.productIds ?? []),
);
const EXCLUDE_TITLE_REGEX = (() => {
  const raw = getArg("exclude-title-regex", CONFIG.excludeTitleRegex ?? null);
  if (!raw) return null;
  return new RegExp(raw, "i");
})();
const ALLOW_SITE_WIDE_FDA_WARNING =
  getArg("allow-site-wide-fda-warning", String(CONFIG.allowSiteWideFdaWarning ?? false)) === "true";

const readJson = async (filePath) => JSON.parse(await fs.readFile(filePath, "utf8"));
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const escapeRegExp = (value) => String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const nowIso = () => new Date().toISOString();

const buildOverlayHash = (row) =>
  stableHash({
    brandName: row.brandName,
    title: row.title,
    barcode_gtin14: row.barcode_gtin14,
    supplementFacts: row.supplementFacts,
    descriptionSections: row.descriptionSections,
    sourceSummary: row.sourceSummary,
  });

const toReaderUrl = (targetUrl) => `${READER_PREFIX}${targetUrl}`;
const buildSearchUrl = (query) => {
  const resolvedPath = SEARCH_PATH_TEMPLATE.replace(/\{query\}/g, encodeURIComponent(query));
  return /^https?:\/\//i.test(resolvedPath) ? resolvedPath : `${SITE_ORIGIN}${resolvedPath}`;
};
const buildCatalogApiUrl = (page) => {
  const pathTemplate = String(CATALOG_API?.pathTemplate ?? "");
  if (!pathTemplate) return null;
  const resolvedPath = pathTemplate.replace(/\{page\}/g, String(page));
  return /^https?:\/\//i.test(resolvedPath) ? resolvedPath : `${SITE_ORIGIN}${resolvedPath}`;
};
const slugToTitle = (pageUrl) =>
  normalizeText(
    decodeURIComponent(String(pageUrl ?? "").split("/").filter(Boolean).pop() ?? "")
      .replace(/\.html$/i, "")
      .replace(/[-_]+/g, " "),
  ) || null;

const fetchTextViaAgentBrowser = (targetUrl, label) => {
  const readerUrl = toReaderUrl(targetUrl);
  console.error(`[official-fallback] agent-browser fallback for ${label}`);
  const openCmd = `${AGENT_BROWSER_SHELL_CMD} open ${JSON.stringify(readerUrl)}`;
  const waitCmd = `${AGENT_BROWSER_SHELL_CMD} wait --load networkidle`;
  const getCmd = `${AGENT_BROWSER_SHELL_CMD} --max-output 120000 get text body`;
  const output = execFileSync("zsh", ["-lc", `${openCmd} && ${waitCmd} && ${getCmd}`], {
    encoding: "utf8",
    maxBuffer: 1024 * 1024 * 8,
  });
  const titleIdx = output.indexOf("Title:");
  return titleIdx >= 0 ? output.slice(titleIdx) : output;
};

const fetchText = async (targetUrl, label) => {
  let lastError = null;
  for (let attempt = 1; attempt <= MAX_RETRIES; attempt += 1) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
    try {
      executionHealth.requests += 1;
      if (attempt > 1) executionHealth.retryCount += 1;
      const response = await fetch(toReaderUrl(targetUrl), {
        signal: controller.signal,
        headers: {
          Accept: "text/plain, text/markdown;q=0.9, */*;q=0.8",
          "User-Agent": "Mozilla/5.0",
        },
      });
      const text = await response.text();
      if (response.status === 429) executionHealth.http429 += 1;
      if (!response.ok) {
        throw new Error(`${label} failed (${response.status})`);
      }
      executionHealth.fetchSuccess += 1;
      return text;
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error));
      if (lastError.name === "AbortError" || /aborted|abort/i.test(lastError.message)) {
        executionHealth.aborted += 1;
      }
      if (attempt < MAX_RETRIES) {
        await sleep(Math.min(1000 * attempt, 3000));
      }
    } finally {
      clearTimeout(timeout);
    }
  }
  if (
    ENABLE_AGENT_BROWSER_FALLBACK &&
    /\((429|403)\)/.test(lastError?.message ?? "")
  ) {
    try {
      return fetchTextViaAgentBrowser(targetUrl, label);
    } catch (fallbackError) {
      const fallbackMessage = fallbackError instanceof Error ? fallbackError.message : String(fallbackError);
      throw new Error(`${lastError?.message ?? `${label} failed`}; agent-browser fallback failed: ${fallbackMessage}`);
    }
  }
  throw lastError ?? new Error(`${label} failed`);
};

const fetchJson = async (targetUrl, label) => {
  let lastError = null;
  for (let attempt = 1; attempt <= MAX_RETRIES; attempt += 1) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
    try {
      executionHealth.requests += 1;
      if (attempt > 1) executionHealth.retryCount += 1;
      const response = await fetch(targetUrl, {
        signal: controller.signal,
        headers: {
          Accept: "application/json, text/plain;q=0.9, */*;q=0.8",
          "User-Agent": "Mozilla/5.0",
        },
      });
      const text = await response.text();
      if (response.status === 429) executionHealth.http429 += 1;
      if (!response.ok) {
        throw new Error(`${label} failed (${response.status})`);
      }
      executionHealth.fetchSuccess += 1;
      return JSON.parse(text);
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error));
      if (lastError.name === "AbortError" || /aborted|abort/i.test(lastError.message)) {
        executionHealth.aborted += 1;
      }
      if (attempt < MAX_RETRIES) {
        await sleep(Math.min(1000 * attempt, 3000));
      }
    } finally {
      clearTimeout(timeout);
    }
  }
  throw lastError ?? new Error(`${label} failed`);
};

const htmlEntityMap = {
  amp: "&",
  apos: "'",
  quot: '"',
  nbsp: " ",
  lt: "<",
  gt: ">",
  reg: "(R)",
  trade: "(TM)",
};
const decodeHtmlEntities = (value) =>
  String(value ?? "").replace(/&(#x?[0-9a-f]+|[a-z]+);/gi, (match, entity) => {
    const normalized = String(entity).toLowerCase();
    if (normalized.startsWith("#x")) {
      const codePoint = Number.parseInt(normalized.slice(2), 16);
      return Number.isFinite(codePoint) ? String.fromCodePoint(codePoint) : match;
    }
    if (normalized.startsWith("#")) {
      const codePoint = Number.parseInt(normalized.slice(1), 10);
      return Number.isFinite(codePoint) ? String.fromCodePoint(codePoint) : match;
    }
    return htmlEntityMap[normalized] ?? match;
  });

const stripHtmlToText = (html) =>
  decodeHtmlEntities(
    String(html ?? "")
      .replace(/<br\s*\/?>/gi, "\n")
      .replace(/<\/p>/gi, "\n")
      .replace(/<\/li>/gi, "\n")
      .replace(/<li[^>]*>/gi, "- ")
      .replace(/<[^>]+>/g, " "),
  )
    .replace(/\r/g, "")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n");

const cleanupSearchText = (value) =>
  normalizeText(value)
    .replace(/^Pure Encapsulations,\s*/i, "")
    .replace(/\([^)]*\)/g, " ")
    .replace(/[®™•]/g, " ")
    .replace(/\+/g, " ")
    .replace(/[']/g, "")
    .replace(/\b\d+\s+(capsules?|softgel capsules?|softgels?|packets?|packet|caplique(?:\s+capsules?)?|tablets?)\b/gi, " ")
    .replace(/\s+/g, " ")
    .trim();

const buildSearchQueries = (title) => {
  const withoutBrand = normalizeText(title).replace(/^Pure Encapsulations,\s*/i, "");
  const parts = withoutBrand
    .replace(/\([^)]*\)/g, " ")
    .split(",")
    .map((item) => normalizeText(item))
    .filter(Boolean);

  const nonPackagingParts = parts.filter(
    (item) =>
      !/^\d+\s+(capsules?|softgel capsules?|softgels?|packets?|packet|caplique(?:\s+capsules?)?|tablets?)$/i.test(
        item,
      ),
  );

  const candidates = [
    cleanupSearchText(nonPackagingParts.join(" ")),
    cleanupSearchText(nonPackagingParts.slice(0, 2).join(" ")),
    cleanupSearchText(nonPackagingParts[0] ?? ""),
    cleanupSearchText(withoutBrand),
  ].filter(Boolean);

  const extras = [];
  for (const candidate of candidates) {
    extras.push(candidate.replace(/\s+/g, " ").trim());
    extras.push(candidate.replace(/\bplus\b/gi, " ").replace(/\s+/g, " ").trim());
    extras.push(candidate.replace(/-/g, " ").replace(/\s+/g, " ").trim());
  }

  return [...new Set([...candidates, ...extras].filter(Boolean))];
};

const normalizeComparisonText = (value) =>
  cleanupSearchText(value)
    .toLowerCase()
    .replace(/\b\d+(?:,\d+)?\s*(mg|mcg|iu)\b/g, " ")
    .replace(/\b\d+\b/g, " ")
    .replace(/[^a-z0-9\s-]/g, " ")
    .replace(/\s+/g, " ")
    .trim();

const normalizeCatalogTitle = (value) =>
  normalizeText(value)
    .replace(/[®™•]/g, " ")
    .replace(/\+/g, " ")
    .replace(/[']/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();

const extractNumericTokens = (value) => [
  ...new Set(
    [...String(value ?? "").matchAll(/\d+/g)]
      .map((match) => normalizeText(match[0]))
      .filter(Boolean),
  ),
];

const CATALOG_MATCH_GENERIC_TOKENS = new Set([
  "a",
  "and",
  "caps",
  "capsule",
  "capsules",
  "cap",
  "chew",
  "chews",
  "default",
  "fl",
  "floz",
  "food",
  "foods",
  "for",
  "formula",
  "g",
  "gel",
  "gels",
  "gram",
  "grams",
  "isolate",
  "lb",
  "lbs",
  "liquid",
  "mg",
  "ml",
  "natural",
  "now",
  "nutrition",
  "nutricost",
  "of",
  "organic",
  "oz",
  "pack",
  "packs",
  "powder",
  "product",
  "products",
  "protein",
  "serving",
  "softgel",
  "softgels",
  "supplement",
  "supplements",
  "tablet",
  "tablets",
  "the",
  "title",
  "veg",
  "vegcaps",
  "veggie",
  "vegetarian",
  "vitamin",
  "with",
]);

const scoreCatalogTitleMatch = (targetTitle, productTitle, variantTitle) => {
  const target = normalizeCatalogTitle(targetTitle);
  const candidate = normalizeCatalogTitle(`${productTitle ?? ""} ${variantTitle ?? ""}`);
  if (!target || !candidate) return 0;

  let score = 0;
  if (candidate === target) score += 140;
  if (candidate.includes(target) || target.includes(candidate)) score += 80;

  const targetTokens = target.split(" ").filter((token) => token.length > 1);
  const candidateSet = new Set(candidate.split(" ").filter((token) => token.length > 1));
  const overlap = targetTokens.filter((token) => candidateSet.has(token)).length;
  score += overlap * 8;

  const targetDistinctiveTokens = targetTokens.filter((token) => !CATALOG_MATCH_GENERIC_TOKENS.has(token));
  const missingDistinctiveCount = targetDistinctiveTokens.filter((token) => !candidateSet.has(token)).length;
  score -= missingDistinctiveCount * 18;
  if (targetDistinctiveTokens.length > 0 && missingDistinctiveCount === targetDistinctiveTokens.length) {
    score -= 30;
  }

  const targetNumbers = new Set(extractNumericTokens(target));
  const candidateNumbers = extractNumericTokens(candidate);
  let numericMatches = 0;
  for (const token of candidateNumbers) {
    if (targetNumbers.has(token)) {
      score += 22;
      numericMatches += 1;
    } else if (targetNumbers.size > 0) {
      score -= 16;
    }
  }
  if (targetNumbers.size > 0 && candidateNumbers.length > 0 && numericMatches === 0) {
    score -= 30;
  }

  return score;
};

const tokenize = (value) =>
  normalizeComparisonText(value)
    .split(" ")
    .map((item) => item.trim())
    .filter((item) => item.length > 1);

const isLikelyProductLink = (pageUrl) => {
  const value = String(pageUrl ?? "");
  if (!value) return false;
  if (/\.(png|jpe?g|webp|gif|svg)(?:$|\?)/i.test(value)) return false;
  if (/\/cdn\/shop\/(products|files)\//i.test(value)) return false;
  return /\/products\/[^/?#]+|\.html(?:$|\?)/i.test(value);
};
const isLikelyProductImageUrl = (imageUrl) => {
  const value = normalizeLower(imageUrl);
  if (!value) return false;
  if (!/^https?:\/\//.test(value)) return false;
  if (/\.(svg|gif)(?:$|\?)/i.test(value)) return false;
  if (/cookie|logo|icon|sprite|banner|placeholder|poweredby|favicon/.test(value)) return false;
  return /\.(png|jpe?g|webp|gif)(?:$|\?)/i.test(value) || /\/media\/catalog\/product\/|cloudinary\.images-iherb\.com|cdn\.shopify\.com/.test(value);
};
const isIherbProductUrl = (pageUrl) => /:\/\/(?:www\.)?iherb\.com\/pr\//i.test(String(pageUrl ?? ""));
const isSecurityVerificationBody = (text) =>
  /performing security verification|uses a security service to protect against malicious bots|target url returned error 403|make sure you are authorized to access this page/i.test(
    String(text ?? ""),
  );
const isIgnoredSearchCandidateTitle = (title) => {
  const normalized = normalizeLower(title);
  return (
    !normalized ||
    normalized.length < 3 ||
    [
      "products",
      "product",
      "view all",
      "shop all",
      "shop",
      "search",
      "menu",
      "learn",
      "about us",
      "where to buy",
      "account",
      "sign in",
      "register",
      "favorites",
      "skip to content",
      "loading results",
      "close",
    ].includes(normalized)
  );
};

const scoreCandidate = (candidate, targetTitle, query) => {
  const targetTokens = new Set([...tokenize(targetTitle), ...tokenize(query)]);
  const candidateTokens = tokenize(candidate.title);
  const candidateSet = new Set(candidateTokens);
  let score = 0;
  for (const token of targetTokens) {
    if (candidateSet.has(token)) score += 5;
  }
  const normalizedCandidate = normalizeComparisonText(candidate.title);
  const normalizedTarget = normalizeComparisonText(targetTitle);
  if (normalizedCandidate === normalizedTarget) score += 50;
  if (normalizedCandidate.includes(normalizedTarget) || normalizedTarget.includes(normalizedCandidate)) score += 20;
  if (normalizeLower(candidate.pageUrl).includes(normalizedTarget.replace(/\s+/g, "-"))) score += 10;
  return score;
};
const MIN_SEARCH_CANDIDATE_SCORE = 18;

const parseSearchCandidates = (markdown) => {
  const originRe = escapeRegExp(SITE_ORIGIN);
  const re = new RegExp(
    String.raw`\[\!\[Image \d+: ([^\]]+)\]\((` +
      `${originRe}` +
      String.raw`\/media\/catalog\/product\/[^)]+)\)\]\((` +
      `${originRe}` +
      String.raw`\/[^)\s]+\.html)\)`,
    "g",
  );
  const byUrl = new Map();
  const pushCandidate = (candidate) => {
    const pageUrl = normalizeText(candidate?.pageUrl).replace(/#.*$/, "");
    if (!pageUrl || !isLikelyProductLink(pageUrl)) return;
    const title = normalizeText(candidate?.title ?? slugToTitle(pageUrl) ?? pageUrl);
    if (isIgnoredSearchCandidateTitle(title)) return;
    const current = byUrl.get(pageUrl);
    if (!current) {
      byUrl.set(pageUrl, {
        title,
        imageAlt: normalizeText(candidate?.imageAlt ?? title) || title,
        imageUrl: normalizeText(candidate?.imageUrl ?? null) || null,
        pageUrl,
      });
      return;
    }
    if ((!current.imageUrl && candidate?.imageUrl) || slugToTitle(pageUrl) === current.title) {
      byUrl.set(pageUrl, {
        ...current,
        title,
        imageAlt: normalizeText(candidate?.imageAlt ?? title) || title,
        imageUrl: normalizeText(candidate?.imageUrl ?? current.imageUrl) || current.imageUrl,
      });
    }
  };
  let match;
  while ((match = re.exec(markdown)) !== null) {
    const imageAlt = normalizeText(match[1]);
    const imageUrl = normalizeText(match[2]);
    const pageUrl = normalizeText(match[3]);
    const nearby = markdown.slice(match.index, match.index + 1200);
    const titleMatch = nearby.match(new RegExp(String.raw`\[([^\]]+)\]\(${escapeRegExp(pageUrl)}\)`));
    pushCandidate({
      title: normalizeText(titleMatch?.[1] ?? imageAlt) || imageAlt || pageUrl,
      imageAlt,
      imageUrl,
      pageUrl,
    });
  }

  const genericLinkRe = new RegExp(String.raw`\[([^\]]{2,240})\]\((` + `${originRe}` + String.raw`\/[^)\s]+)\)`, "g");
  while ((match = genericLinkRe.exec(markdown)) !== null) {
    pushCandidate({
      title: normalizeText(match[1]),
      imageAlt: normalizeText(match[1]),
      imageUrl: null,
      pageUrl: normalizeText(match[2]),
    });
  }

  return [...byUrl.values()];
};

const extractFirstImageUrl = (markdown) => {
  const images = extractAllImageUrls(markdown);
  return images[0] ?? null;
};

const parseInlineLabeledBlock = (markdown, label, stopMatchers = []) => {
  const lines = String(markdown ?? "").replace(/\r/g, "").split("\n");
  const labelLower = `${label.toLowerCase()}:`;
  let capturing = false;
  const pieces = [];

  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!capturing) {
      if (line.toLowerCase().startsWith(labelLower)) {
        const remainder = normalizeText(line.slice(label.length + 1));
        if (remainder) pieces.push(remainder);
        capturing = true;
      }
      continue;
    }

    if (!line) {
      if (pieces.length > 0) continue;
      break;
    }
    if (stopMatchers.some((matcher) => matcher.test(line))) break;
    pieces.push(normalizeText(line.replace(/^[-*]\s*/, "")));
  }

  return normalizeText(pieces.join(" ")) || null;
};

const parseLinkedHeadingBlock = (markdown, heading, stopHeadings = []) => {
  const headingRe = heading.replace(/\s+/g, "\\s+");
  const stopRe = stopHeadings.map((item) => item.replace(/\s+/g, "\\s+")).join("|");
  const match = String(markdown ?? "").match(
    new RegExp(
      String.raw`\[${headingRe}\]\([^)]+\)\s*\n+\s*([\s\S]*?)(?=\n\s*\[(?:${stopRe})\]\([^)]+\)|$)`,
      "i",
    ),
  );
  return normalizeText(match?.[1] ?? null) || null;
};

const parsePdfHeadingBlock = (markdown, heading, stopHeadings) => {
  const headingRe = heading.replace(/\s+/g, "\\s+");
  const stopRe = stopHeadings.map((item) => item.replace(/\s+/g, "\\s+")).join("|");
  const match = String(markdown ?? "").match(
    new RegExp(String.raw`(?:^|\n)\s*${headingRe}\s*(?:\n|:)\s*([\s\S]*?)(?=\n\s*(?:${stopRe})\s*(?:\n|:)|$)`, "i"),
  );
  return normalizeText(match?.[1] ?? null) || null;
};

const parsePageHeadingBlock = (markdown, headings, stopHeadings) => {
  for (const heading of headings) {
    const headingRe = heading.replace(/\s+/g, "\\s+");
    const stopRe = stopHeadings.map((item) => item.replace(/\s+/g, "\\s+")).join("|");
    const match = String(markdown ?? "").match(
      new RegExp(
        String.raw`(?:^|\n)\s*(?:#{1,6}\s*)?${headingRe}\s*(?:\n|:)\s*([\s\S]*?)(?=\n\s*(?:#{1,6}\s*)?(?:${stopRe})\s*(?:\n|:)|$)`,
        "i",
      ),
    );
    const parsed = normalizeText(match?.[1] ?? null) || null;
    if (parsed) return parsed;
  }
  return null;
};

const parseBrochureFilenames = (markdown) => {
  const match = String(markdown ?? "").match(/Brochure Links \(comma-separated\):\s*([^\n]+)/i);
  if (!match) return [];
  return match[1]
    .split(",")
    .map((item) => normalizeText(item))
    .filter(Boolean);
};

const extractAllImageUrls = (markdown) => {
  const matches = String(markdown ?? "").matchAll(/\!\[[^\]]*\]\((https?:\/\/[^)\s]+)\)/g);
  return [
    ...new Set(
      [...matches]
        .map((match) => normalizeText(match[1]))
        .filter((value) => Boolean(value) && isLikelyProductImageUrl(value)),
    ),
  ];
};

const parseSuggestedUseFromBlock = (text) =>
  parseInlineLabeledBlock(text, "Suggested Use", [
    /^Warning:/i,
    /^Warnings:/i,
    /^Caution:/i,
    /^Other Ingredients:/i,
    /^Store/i,
    /^KEEP OUT OF REACH/i,
    /^Distributed by/i,
    /^Supplement Facts/i,
  ]) ??
  parseInlineLabeledBlock(text, "Directions", [
    /^Warning:/i,
    /^Warnings:/i,
    /^Caution:/i,
    /^Other Ingredients:/i,
    /^Store/i,
    /^KEEP OUT OF REACH/i,
    /^Distributed by/i,
    /^Supplement Facts/i,
  ]) ??
  parseInlineLabeledBlock(text, "Recommended Use", [
    /^Warning:/i,
    /^Warnings:/i,
    /^Caution:/i,
    /^Other Ingredients:/i,
    /^Store/i,
    /^KEEP OUT OF REACH/i,
    /^Distributed by/i,
    /^Supplement Facts/i,
  ]) ??
  parsePageHeadingBlock(text, ["Suggested Use", "Directions", "Recommended Use"], [
    "Warning",
    "Warnings",
    "Caution",
    "Supplement Facts",
    "Other Ingredients",
    "Store",
    "KEEP OUT OF REACH",
    "Distributed by",
  ]) ??
  parseLinkedHeadingBlock(text, "How to Use", ["Ingredients", "Safety Guidelines", "More Information", "Details"]) ??
  null;

const inferAllergenWarning = (text) => {
  const normalized = normalizeText(text);
  if (!normalized) return null;

  const containsMatch = normalized.match(/\bcontains\b[:\s-]*([^.;]+(?:\([^)]*\))?)/i);
  if (containsMatch) {
    const tail = normalizeText(containsMatch[1]).replace(/[.;:,]+$/g, "");
    if (tail && /(fish|soy|milk|shellfish|tree nut|nuts|wheat|egg|sesame|gluten|bovine)/i.test(tail)) {
      return `Contains ${tail}.`;
    }
  }

  if (/\bsoybean oil\b/i.test(normalized) || /\bfrom soy\b/i.test(normalized)) {
    return "Contains soy.";
  }

  if (/contains bovine-derived ingredients/i.test(normalized)) {
    return "Contains bovine-derived ingredients.";
  }

  return null;
};

const inferStorageWarning = (text) => {
  const normalized = String(text ?? "").replace(/\r/g, "\n");
  if (!normalized.trim()) return null;

  const matchedLines = normalized
    .split("\n")
    .map((line) => normalizeText(line))
    .filter(
      (line) =>
        /\b(keep bottle tightly closed|keep tightly closed|store away from heat and moisture|refrigerate after opening|keep out of reach)\b/i.test(
          line,
        ),
    );
  if (matchedLines.length > 0) return normalizeText(matchedLines.join(" "));

  const sentenceMatch = normalized.match(
    /(Keep bottle tightly closed[^.\n]*\.(?:\s*Store away from heat and moisture[^.\n]*\.)?)/i,
  );
  if (sentenceMatch) return normalizeText(sentenceMatch[1]);

  return null;
};

const inferFdaDisclaimerWarning = (text) => {
  const normalized = String(text ?? "").replace(/\r/g, "\n");
  if (!normalized.trim()) return null;
  const match = normalized.match(
    /(?:\*+\s*)?These statements have not been evaluated by the FDA\.\s*This product\s+is\s+not\s+intended\s+to\s+diagnose,\s*treat,\s*cure,\s*or\s+prevent\s+any\s+disease\./i,
  );
  return normalizeText(match?.[0] ?? null) || null;
};

const parseWarningsFromBlock = (text) =>
  inferAllergenWarning(text) ??
  (() => {
    const lines = String(text ?? "")
      .replace(/\r/g, "")
      .split("\n")
      .map((line) => normalizeText(line))
      .filter(Boolean);
    for (let index = 0; index < lines.length; index += 1) {
      const line = lines[index];
      if (!/\bcontains\b/i.test(line)) continue;
      const tail = line.replace(/^.*?\bcontains\b[:\s-]*/i, "");
      const pieces = [tail];
      for (let offset = 1; offset <= 2; offset += 1) {
        const nextLine = lines[index + offset] ?? "";
        if (
          !nextLine ||
          /^(directions?|suggested use|recommended use|warning|warnings|caution|supplement facts|distributed by|dist\.|store|keep out)/i.test(
            nextLine,
          )
        ) {
          break;
        }
        pieces.push(nextLine);
        if (/[.。]$/.test(nextLine)) break;
      }
      const parsed = normalizeText(pieces.join(" ").replace(/^other ingredients:\s*/i, ""));
      if (parsed && /(fish|soy|milk|shellfish|tree nut|nuts|wheat|egg|sesame|gluten|bovine)/i.test(parsed)) {
        const cleaned = parsed.replace(/[.;:,]+$/g, "");
        return /^contains\b/i.test(cleaned) ? `${cleaned}.` : `Contains ${cleaned}.`;
      }
    }
    return null;
  })() ??
  parseInlineLabeledBlock(text, "Warning", [
    /^Other Ingredients:/i,
    /^Store/i,
    /^KEEP OUT OF REACH/i,
    /^Distributed by/i,
    /^Supplement Facts/i,
    /^\*These statements/i,
  ]) ??
  parseInlineLabeledBlock(text, "Warnings", [
    /^Other Ingredients:/i,
    /^Store/i,
    /^KEEP OUT OF REACH/i,
    /^Distributed by/i,
    /^Supplement Facts/i,
    /^\*These statements/i,
  ]) ??
  parseInlineLabeledBlock(text, "Caution", [
    /^Other Ingredients:/i,
    /^Store/i,
    /^KEEP OUT OF REACH/i,
    /^Distributed by/i,
    /^Supplement Facts/i,
    /^\*These statements/i,
  ]) ??
  parsePageHeadingBlock(text, ["Warning", "Warnings", "Caution", "Use Caution"], [
    "Suggested Use",
    "Directions",
    "Recommended Use",
    "Supplement Facts",
    "Other Ingredients",
    "Store",
    "KEEP OUT OF REACH",
    "Distributed by",
  ]) ??
  inferFdaDisclaimerWarning(text) ??
  inferStorageWarning(text) ??
  null;

const parseOtherIngredientsFromBlock = (text) =>
  parseInlineLabeledBlock(text, "Other Ingredients", [
    /^Store/i,
    /^KEEP OUT OF REACH/i,
    /^Distributed by/i,
    /^Suggested Use/i,
    /^Directions:/i,
    /^Warning:/i,
    /^Warnings:/i,
    /^Caution:/i,
    /^\*These statements/i,
  ]) ?? null;

const parseSupplementFactsFromOcrText = (text) => {
  const normalized = String(text ?? "").replace(/\r/g, "");
  const blockMatch = normalized.match(
    /Supplement Facts([\s\S]*?)(?=\n(?:Other Ingredients|Directions|Suggested Use|Recommended Use|Warning|Warnings|Caution|Store in a cool|KEEP OUT OF REACH|Distributed by)\b|$)/i,
  );
  if (!blockMatch) return null;

  const block = blockMatch[1];
  const servingSize = normalizeText(block.match(/Serving Size[:\s]+([^\n]+)/i)?.[1] ?? null) || null;
  const servingsPerContainer = normalizeText(block.match(/Servings per Container[:\s]+([^\n]+)/i)?.[1] ?? null) || null;

  const facts = [];
  const seen = new Set();
  const registerFact = (substancy, amountPerServing, dailyValuePercent = null) => {
    const name = normalizeText(substancy);
    const amount = normalizeText(amountPerServing);
    const dailyValue = normalizeText(dailyValuePercent) || null;
    if (!name || !amount) return;
    const key = `${normalizeLower(name)}||${normalizeLower(amount)}`;
    if (seen.has(key)) return;
    seen.add(key);
    facts.push({
      substancy: name,
      amountPerServing: amount,
      dailyValuePercent: dailyValue,
    });
  };

  const inlineMatches = block.matchAll(
    /([A-Z][A-Za-z0-9 ,()/'%-]{2,120}?)\s+(\d[\d,]*(?:\.\d+)?)\s*(mg|mcg|g|iu|cfu|fus?|mcg)\b(?:\s+(\d+%|\*|Daily Value not established))?/gi,
  );
  for (const match of inlineMatches) {
    registerFact(match[1], `${match[2]} ${match[3]}`, match[4] ?? null);
  }

  const reversedMatches = block.matchAll(
    /(\d[\d,]*(?:\.\d+)?)\s*(mg|mcg|g|iu|cfu|fus?|mL|mcg)\b[\s\n]{1,20}([A-Z][A-Za-z0-9 ,()/'%-]{2,120})/gi,
  );
  for (const match of reversedMatches) {
    registerFact(match[3], `${match[1]} ${match[2]}`);
  }

  const cleanedLines = block
    .split("\n")
    .map((line) => normalizeText(line))
    .filter(Boolean)
    .filter(
      (line) =>
        !/^Supplement Facts$/i.test(line) &&
        !/^Serving Size/i.test(line) &&
        !/^Servings per Container/i.test(line) &&
        !/^Amount$/i.test(line) &&
        !/^per Serving$/i.test(line) &&
        !/^% Daily$/i.test(line) &&
        !/^Value$/i.test(line) &&
        !/Daily Value not established/i.test(line),
    );

  for (let index = 0; index < cleanedLines.length; index += 1) {
    const line = cleanedLines[index];
    const nextLine = cleanedLines[index + 1] ?? "";
    const amountMatch = line.match(/(\d[\d,]*(?:\.\d+)?)\s*(mg|mcg|g|iu|cfu|fus?|mL)\b/i);
    const nextAmountMatch = nextLine.match(/(\d[\d,]*(?:\.\d+)?)\s*(mg|mcg|g|iu|cfu|fus?|mL)\b/i);
    if (amountMatch && nextLine && /[A-Za-z]/.test(nextLine)) {
      registerFact(nextLine, `${amountMatch[1]} ${amountMatch[2]}`);
    } else if (nextAmountMatch && /[A-Za-z]/.test(line)) {
      registerFact(line, `${nextAmountMatch[1]} ${nextAmountMatch[2]}`);
    }
  }

  if (!servingSize && !servingsPerContainer && facts.length === 0) return null;

  return {
    servingSize,
    servingsPerContainer,
    nutritionalFacts: facts,
  };
};

const buildImagePreferenceTokens = (variant) => {
  const rawTokens = [
    variant?.sku,
    variant?.title,
    variant?.option1,
    variant?.option2,
    variant?.option3,
    variant?.barcode,
  ].filter(Boolean);
  const tokens = new Set();
  for (const raw of rawTokens) {
    const text = normalizeText(raw);
    if (!text) continue;
    tokens.add(text.toLowerCase());
    const digits = normalizeDigits(text);
    if (digits) tokens.add(digits);
    text
      .toLowerCase()
      .split(/[^a-z0-9]+/)
      .filter((token) => token.length > 2)
      .forEach((token) => tokens.add(token));
  }
  return [...tokens];
};

const scoreCatalogImage = (imageUrl, variant) => {
  const url = normalizeLower(imageUrl);
  let score = 0;
  if (/\bright\b/.test(url)) score += 40;
  if (/\bleft\b/.test(url)) score += 30;
  if (/\bback\b/.test(url)) score += 25;
  if (/\bfront\b/.test(url)) score -= 5;
  for (const token of buildImagePreferenceTokens(variant)) {
    if (token && url.includes(token)) score += 20;
  }
  return score;
};

const catalogProductsPromiseBySite = new Map();
const fetchCatalogProducts = async () => {
  if (!CATALOG_API || CATALOG_API.mode !== "shopify_products_json") return [];
  if (!catalogProductsPromiseBySite.has(SITE_ORIGIN)) {
    catalogProductsPromiseBySite.set(
      SITE_ORIGIN,
      (async () => {
        const maxPages = Number(CATALOG_API.maxPages ?? 12) || 12;
        const products = [];
        for (let page = 1; page <= maxPages; page += 1) {
          const url = buildCatalogApiUrl(page);
          if (!url) break;
          const payload = await fetchJson(url, `catalog api page ${page}`);
          const pageProducts = Array.isArray(payload?.products) ? payload.products : [];
          if (pageProducts.length === 0) break;
          products.push(...pageProducts);
          if (pageProducts.length < Number(CATALOG_API.pageSize ?? 250)) break;
        }
        return products;
      })(),
    );
  } else {
    executionHealth.cacheHits += 1;
  }
  return catalogProductsPromiseBySite.get(SITE_ORIGIN);
};

const shopifyProductPromiseByHandle = new Map();
const extractShopifyHandle = (pageUrl) =>
  normalizeText(String(pageUrl ?? "").match(/\/products\/([^/?#]+)/i)?.[1] ?? null) || null;

const fetchShopifyProductByHandle = async (pageUrl) => {
  const handle = extractShopifyHandle(pageUrl);
  if (!handle) return null;
  if (!shopifyProductPromiseByHandle.has(handle)) {
    shopifyProductPromiseByHandle.set(
      handle,
      fetchJson(`${SITE_ORIGIN}/products/${handle}.js`, `shopify product ${handle}`).catch(() => null),
    );
  } else {
    executionHealth.cacheHits += 1;
  }
  return shopifyProductPromiseByHandle.get(handle);
};

const findCatalogCandidate = async (stagedRow) => {
  const catalogProducts = await fetchCatalogProducts();
  if (catalogProducts.length === 0) return null;
  const targetBarcode = normalizeBarcode(stagedRow?.barcode_gtin14 ?? stagedRow?.upcCode);

  let best = null;
  for (const product of catalogProducts) {
    for (const variant of Array.isArray(product?.variants) ? product.variants : []) {
      let score = 0;
      const variantBarcode = normalizeBarcode(variant?.barcode);
      if (targetBarcode && variantBarcode && targetBarcode === variantBarcode) score += 1000;
      score += scoreCatalogTitleMatch(stagedRow?.title ?? "", product?.title ?? "", variant?.title ?? "");
      if (!best || score > best.score) {
        best = { score, product, variant };
      }
    }
  }

  if (!best || best.score < 60) return null;
  const product = best.product;
  const variant = best.variant;
  const productImages = (Array.isArray(product?.images) ? product.images : [])
    .map((image) => normalizeText(image?.src ?? null).replace(/^\/\//, "https://"))
    .filter(Boolean)
    .sort((left, right) => scoreCatalogImage(right, variant) - scoreCatalogImage(left, variant));

  return {
    title: `${product?.title ?? stagedRow?.title}`,
    pageUrl: `${SITE_ORIGIN}/products/${normalizeText(product?.handle)}`,
    imageUrl: productImages[0] ?? null,
    imageUrls: productImages,
    bodyText: stripHtmlToText(product?.body_html ?? ""),
    catalogHit: true,
    catalogMatchType:
      normalizeBarcode(variant?.barcode) === normalizeBarcode(stagedRow?.barcode_gtin14 ?? stagedRow?.upcCode)
        ? "barcode"
        : "title",
    catalogVariant: {
      sku: normalizeText(variant?.sku ?? null) || null,
      title: normalizeText(variant?.title ?? null) || null,
      barcode: normalizeBarcode(variant?.barcode) ?? null,
    },
  };
};

const enrichCandidateWithShopifyProduct = async (candidate) => {
  const shopifyProduct = await fetchShopifyProductByHandle(candidate?.pageUrl);
  if (!shopifyProduct) return candidate;
  const productImages = (Array.isArray(shopifyProduct?.images) ? shopifyProduct.images : [])
    .map((image) =>
      typeof image === "string"
        ? normalizeText(image).replace(/^\/\//, "https://")
        : normalizeText(image?.src ?? null).replace(/^\/\//, "https://"),
    )
    .filter(Boolean);
  return {
    ...candidate,
    title: normalizeText(shopifyProduct?.title ?? candidate?.title) || candidate?.title,
    imageUrl: productImages[0] ?? candidate?.imageUrl ?? null,
    imageUrls: productImages.length > 0 ? productImages : candidate?.imageUrls ?? [],
    bodyText: [candidate?.bodyText, stripHtmlToText(shopifyProduct?.description ?? "")]
      .filter(Boolean)
      .join("\n\n"),
  };
};

const runImageOcrFallback = async ({ stagedRow, selectedCandidate, beforeMissingFields }) => {
  if (!ENABLE_IMAGE_OCR_FALLBACK) {
    return {
      imageOcrHit: false,
      imageUrlsTried: [],
      suggestedUse: null,
      warnings: null,
      otherIngredients: null,
      supplementFacts: null,
      imageEvidenceUrl: null,
    };
  }

  const candidateImageUrls = [
    ...(Array.isArray(selectedCandidate?.imageUrls) ? selectedCandidate.imageUrls : []),
    selectedCandidate?.imageUrl,
    ...(ENABLE_STAGED_IMAGE_OCR ? stagedRow?.productImages ?? [] : []),
    ENABLE_STAGED_IMAGE_OCR ? stagedRow?.productCatalogImage : null,
  ]
    .map((value) => normalizeText(value))
    .filter((value) => Boolean(value) && isLikelyProductImageUrl(value) && !/\/cms\/|banner/i.test(value));

  const imageUrls = [...new Set(candidateImageUrls)].slice(0, OCR_MAX_IMAGES);
  let suggestedUse = null;
  let warnings = null;
  let otherIngredients = null;
  let supplementFacts = null;
  let imageEvidenceUrl = null;
  let imageOcrHit = false;

  for (const imageUrl of imageUrls) {
    try {
      const payload = await runMacosVisionOcr(imageUrl);
      const ocrText = String(payload?.fullText ?? "")
        .replace(/\r/g, "")
        .split("\n")
        .map((line) => normalizeText(line))
        .filter(Boolean)
        .join("\n");
      if (!ocrText) continue;
      const parsedSuggestedUse = parseSuggestedUseFromBlock(ocrText);
      const parsedWarnings = parseWarningsFromBlock(ocrText);
      const parsedOtherIngredients = parseOtherIngredientsFromBlock(ocrText);
      const parsedSupplementFacts = parseSupplementFactsFromOcrText(ocrText);
      if (parsedSuggestedUse || parsedWarnings || parsedOtherIngredients || parsedSupplementFacts) {
        imageOcrHit = true;
        imageEvidenceUrl = imageEvidenceUrl ?? imageUrl;
      }
      suggestedUse = suggestedUse ?? parsedSuggestedUse ?? null;
      warnings = warnings ?? parsedWarnings ?? null;
      otherIngredients = otherIngredients ?? parsedOtherIngredients ?? null;
      supplementFacts = supplementFacts ?? parsedSupplementFacts ?? null;

      const remainingNeeds = new Set(beforeMissingFields);
      if (suggestedUse) remainingNeeds.delete("suggested_use");
      if (warnings) remainingNeeds.delete("warnings");
      if (supplementFacts?.nutritionalFacts?.length) {
        remainingNeeds.delete("ingredient");
        if (supplementFacts.nutritionalFacts.some((row) => normalizeText(row?.amountPerServing))) {
          remainingNeeds.delete("dosage");
        }
      }
      if (remainingNeeds.size === 0) break;
    } catch (error) {
      console.error(`[official-fallback] image OCR failed for ${imageUrl}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  return {
    imageOcrHit,
    imageUrlsTried: imageUrls,
    suggestedUse,
    warnings,
    otherIngredients,
    supplementFacts,
    imageEvidenceUrl,
  };
};

const hydrateMergedRow = (currentRow, mergedRecord) => {
  const completeness = deriveCompleteness(mergedRecord);
  const status = classifyOverlayStatus(mergedRecord, completeness);
  const highConfidenceUsProductPageReady = qualifiesHighConfidenceUsProductPage(mergedRecord, completeness);
  const patchStrategy = buildPatchStrategy(mergedRecord, completeness);

  return {
    ...currentRow,
    ...mergedRecord,
    overlayRecordKey: buildOverlayRecordKey(mergedRecord),
    completeness: {
      ...completeness,
      status,
    },
    readiness: {
      highConfidenceUsProductPageReady,
    },
    patchStrategy,
    overlaySha256: buildOverlayHash(mergedRecord),
  };
};

const readSectionValue = (sections, keys) => {
  const source = sections && typeof sections === "object" ? sections : {};
  for (const key of keys) {
    const value = normalizeText(source[key] ?? null);
    if (value) return value;
  }
  return null;
};

const buildStagedSectionFallback = (row) => {
  const sections = row?.descriptionSections && typeof row.descriptionSections === "object" ? row.descriptionSections : {};
  const suggestedUse = readSectionValue(sections, ["Suggested use", "Suggested Use", "Suggested usage"]);
  const warnings = readSectionValue(sections, ["Warnings", "Warning"]);
  const otherIngredients = readSectionValue(sections, ["Other ingredients", "Other Ingredients"]);
  const description = readSectionValue(sections, ["Description"]);
  const combinedText = [description, suggestedUse, warnings, otherIngredients].filter(Boolean).join("\n\n");
  return {
    suggestedUse,
    warnings,
    otherIngredients,
    description,
    combinedText,
  };
};

const inferSiteWideFdaDisclaimerWarning = (text) => {
  const normalized = String(text ?? "").replace(/\r/g, "\n");
  if (!normalized.trim()) return null;
  const sentenceMatch = normalized.match(
    /\*?\s*Statements on this website have not been evaluated by the Food and Drug Administration\.\s*These products? are not intended to diagnose,\s*treat,\s*(?:prevent,\s*or\s*cure|cure,\s*or\s*prevent)\s+any disease\./i,
  );
  if (sentenceMatch) return normalizeText(sentenceMatch[0].replace(/^\*\s*/, ""));
  return null;
};

const mergeSeedIntoStagedRow = (stagedRow, seedRow) => {
  const incomingRecord = extractOverlayRecordFromSeedRow(seedRow, {
    seedName: "official_fallback_seed",
  });
  const mergedRecord = mergeOverlayRecords(stagedRow, incomingRecord);
  const hydratedRow = hydrateMergedRow(stagedRow, mergedRecord);
  return {
    incomingRecord,
    mergedRecord,
    hydratedRow,
  };
};

const queueRowMatchesCohort = (row) => {
  if (normalizeText(row?.priorityLane) !== PRIORITY_LANE) return false;
  if (BRAND_FILTER && normalizeLower(row?.brandName) !== normalizeLower(BRAND_FILTER)) return false;
  if (!normalizeText(row?.productId)) return false;
  if (INCLUDE_PRODUCT_IDS.size > 0 && !INCLUDE_PRODUCT_IDS.has(normalizeText(row?.productId))) return false;
  if (EXCLUDE_TITLE_REGEX && EXCLUDE_TITLE_REGEX.test(normalizeText(row?.title))) return false;

  const missingFields = normalizeStringList(row?.coreMissingFields ?? []);
  if (REQUIRED_MISSING_FIELDS.length > 0) {
    const hasAllRequired = REQUIRED_MISSING_FIELDS.every((field) => missingFields.includes(field));
    if (!hasAllRequired) return false;
    if (MISSING_FIELDS_MODE === "exact" && missingFields.length !== REQUIRED_MISSING_FIELDS.length) return false;
  }
  if (FORBID_MISSING_FIELDS.length > 0 && FORBID_MISSING_FIELDS.some((field) => missingFields.includes(field))) {
    return false;
  }
  if (REQUIRE_HIGH_CONFIDENCE_PRODUCT_PAGE_READY && !Boolean(row?.highConfidenceUsProductPageReady)) return false;
  if (REQUIRE_US_IHERB_PATH) {
    const hasUsIherbPath = Boolean(row?.hasUsIherbPage ?? row?.sourceSummary?.hasUsIherbPage);
    if (!hasUsIherbPath) return false;
  }

  return true;
};

const renderMissing = (fields) => (fields.length > 0 ? fields.join(", ") : "none");

const buildMarkdownReport = (report) => {
  const lines = [
    "# iHerb Official Fallback Refresh",
    "",
    `- generatedAt: ${report.generatedAt}`,
    `- stagingPath: ${report.inputs.stagingPath}`,
    `- queuePath: ${report.inputs.queuePath}`,
    `- configJson: ${report.inputs.configJsonPath || "n/a"}`,
    `- brandFilter: ${report.inputs.brandFilter || "n/a"}`,
    `- priorityLane: ${report.inputs.priorityLane}`,
    `- siteOrigin: ${report.inputs.siteOrigin}`,
    `- searchPathTemplate: ${report.inputs.searchPathTemplate}`,
    `- delayMs: ${report.inputs.delayMs}`,
    "",
    "## Summary",
    "",
    `- queued: ${report.summary.queued}`,
    `- processed: ${report.summary.processed}`,
    `- search_hits: ${report.summary.searchHits}`,
    `- catalog_hits: ${report.summary.catalogHits}`,
    `- page_hits: ${report.summary.pageHits}`,
    `- pdf_hits: ${report.summary.pdfHits}`,
    `- image_ocr_hits: ${report.summary.imageOcrHits}`,
    `- improved_rows: ${report.summary.improvedRows}`,
    `- became_full_overlay_ready: ${report.summary.becameFullOverlayReady}`,
    `- filled_ingredient: ${report.summary.filledIngredient}`,
    `- filled_dosage: ${report.summary.filledDosage}`,
    `- filled_suggested_use: ${report.summary.filledSuggestedUse}`,
    `- filled_warnings: ${report.summary.filledWarnings}`,
    `- filled_product_image: ${report.summary.filledProductImage}`,
    `- still_missing_suggested_use: ${report.summary.stillMissingSuggestedUse}`,
    `- still_missing_warnings: ${report.summary.stillMissingWarnings}`,
    `- still_missing_product_image: ${report.summary.stillMissingProductImage}`,
    `- execution_requests: ${report.executionHealth.requests}`,
    `- execution_fetch_success: ${report.executionHealth.fetchSuccess}`,
    `- execution_http429: ${report.executionHealth.http429}`,
    `- execution_aborted: ${report.executionHealth.aborted}`,
    `- execution_cache_hits: ${report.executionHealth.cacheHits}`,
    `- execution_retry_count: ${report.executionHealth.retryCount}`,
    "",
    "## Sample Results",
    "",
  ];

  for (const row of report.rows.slice(0, 60)) {
    lines.push(
      `- ${row.productId || "n/a"} | ${row.title} | query=${row.searchQuery || "n/a"} | searchHit=${row.searchHit} | catalogHit=${row.catalogHit} | pageHit=${row.pageHit} | pdfHit=${row.pdfHit} | imageOcrHit=${row.imageOcrHit} | before=${renderMissing(
        row.beforeMissingFields,
      )} | after=${renderMissing(row.afterMissingFields)} | changed=${row.improved}`,
    );
  }

  return `${lines.join("\n")}\n`;
};

const parsePackageAmountForGenericFacts = (text) => {
  const value = normalizeText(text);
  if (!value) return null;
  const allMatches = [...value.matchAll(/(\d+(?:\.\d+)?)\s*(fl\s*oz|oz|ml|mL|g|mg|mcg|lb|lbs|tablets?|capsules?|softgels?|pellets?)(?:\s*\(([^)]+)\))?/gi)];
  const match = allMatches[allMatches.length - 1];
  if (!match) return null;
  const amount = `${match[1]} ${match[2]}`.replace(/\s+/g, " ").trim();
  const paren = normalizeText(match[3] ?? "");
  return normalizeText([amount, paren ? `(${paren})` : null].filter(Boolean).join(" ")) || null;
};

const buildGenericIngredientFactsHelper = ({
  stagedRow,
  combinedPageText,
  otherIngredients,
  existingSupplementFacts,
}) => {
  if (existingSupplementFacts?.nutritionalFacts?.length) return existingSupplementFacts;
  if (stagedRow?.supplementFacts?.nutritionalFacts?.length) {
    return stagedRow.supplementFacts;
  }
  const ingredientText = normalizeText(otherIngredients) || null;
  const dosageText =
    parsePackageAmountForGenericFacts(stagedRow?.title) ??
    parsePackageAmountForGenericFacts(stagedRow?.count) ??
    parsePackageAmountForGenericFacts(combinedPageText);
  if (!ingredientText || !dosageText) return existingSupplementFacts;
  return {
    servingSize: null,
    servingsPerContainer: null,
    nutritionalFacts: [
      {
        substancy: ingredientText.replace(/\.\s*$/, ""),
        amountPerServing: dosageText,
        dailyValuePercent: null,
      },
    ],
  };
};

const main = async () => {
  await fs.mkdir(OUT_DIR, { recursive: true });

  const stagingPayload = await readJson(STAGING_PATH);
  const queueRows = await readJson(QUEUE_PATH);
  const stagingRows = Array.isArray(stagingPayload?.products) ? stagingPayload.products : [];
  const requestedRows = (Array.isArray(queueRows) ? queueRows : []).filter(queueRowMatchesCohort);

  const selectedRows = LIMIT ? requestedRows.slice(0, LIMIT) : requestedRows;
  const buildStagingKey = (brandName, productId) => `${normalizeLower(brandName)}||${normalizeText(productId)}`;
  const stagingByProductId = new Map();
  stagingRows.forEach((row, idx) => {
    const productId = normalizeText(row?.productId);
    if (!productId) return;
    stagingByProductId.set(buildStagingKey(row?.brandName, productId), { row, idx });
  });

  const refreshedRows = [...stagingRows];
  const auditRows = [];
  const seedProducts = [];

  for (let idx = 0; idx < selectedRows.length; idx += 1) {
    const queueRow = selectedRows[idx];
    const productId = normalizeText(queueRow.productId);
    const stagedEntry = stagingByProductId.get(buildStagingKey(queueRow?.brandName ?? BRAND_FILTER, productId));
    console.error(
      `[official-fallback] ${idx + 1}/${selectedRows.length} productId=${productId || "n/a"} title=${normalizeText(
        queueRow.title,
      ) || "n/a"}`,
    );
    if (!stagedEntry) {
      auditRows.push({
        productId,
        title: queueRow.title,
        searchHit: false,
        pageHit: false,
        pdfHit: false,
        improved: false,
        reason: "missing_staging_row",
        beforeMissingFields: queueRow.coreMissingFields ?? [],
        afterMissingFields: queueRow.coreMissingFields ?? [],
      });
      if (DELAY_MS > 0 && idx < selectedRows.length - 1) await sleep(DELAY_MS);
      continue;
    }

    const beforeMissingFields = Array.isArray(stagedEntry.row?.completeness?.coreMissingFields)
      ? stagedEntry.row.completeness.coreMissingFields
      : [];
    const stagedSectionFallback = buildStagedSectionFallback(stagedEntry.row);

    const searchQueries = [
      ...new Set([
        ...normalizeStringList(SEARCH_QUERY_OVERRIDES[productId] ?? []),
        ...buildSearchQueries(stagedEntry.row.title),
      ]),
    ];
    let searchQueryUsed = null;
    let searchHit = false;
    let catalogHit = false;
    let pageHit = false;
    let pdfHit = false;
    let imageOcrHit = false;
    let selectedCandidate = null;
    let searchError = null;
    let pageError = null;
    let pdfError = null;
    let pageMarkdown = null;
    let pdfMarkdown = null;
    let catalogError = null;
    const manualPageOverride = PRODUCT_PAGE_URL_OVERRIDES[productId] ?? null;

    if (manualPageOverride) {
      selectedCandidate = {
        title: stagedEntry.row.title,
        imageAlt: stagedEntry.row.title,
        imageUrl: normalizeText(stagedEntry.row?.productCatalogImage ?? null) || null,
        imageUrls: [
          normalizeText(stagedEntry.row?.productCatalogImage ?? null) || null,
          ...(Array.isArray(stagedEntry.row?.productImages) ? stagedEntry.row.productImages : []),
        ].filter(Boolean),
        pageUrl: manualPageOverride,
      };
      searchQueryUsed = `manual_override:${productId}`;
      searchHit = true;
    } else if (CATALOG_API?.mode === "shopify_products_json") {
      try {
        selectedCandidate = await findCatalogCandidate(stagedEntry.row);
        if (selectedCandidate) {
          searchQueryUsed = `catalog_api:${selectedCandidate.catalogMatchType}`;
          catalogHit = true;
        }
      } catch (error) {
        catalogError = error instanceof Error ? error.message : String(error);
      }
    }

    if (!selectedCandidate) {
      for (const query of searchQueries) {
        try {
          const searchUrl = buildSearchUrl(query);
          const searchMarkdown = await fetchText(searchUrl, `official search for ${query}`);
          const candidates = parseSearchCandidates(searchMarkdown);
          if (candidates.length === 0) continue;
          const ranked = [...candidates]
            .map((candidate) => ({
              ...candidate,
              matchScore: scoreCandidate(candidate, stagedEntry.row.title, query),
            }))
            .sort((left, right) => right.matchScore - left.matchScore);
          selectedCandidate = (ranked[0]?.matchScore ?? 0) >= MIN_SEARCH_CANDIDATE_SCORE ? ranked[0] : null;
          if (selectedCandidate) {
            searchQueryUsed = query;
            searchHit = true;
            break;
          }
        } catch (error) {
          searchError = error instanceof Error ? error.message : String(error);
        }
      }
    }

    if (!selectedCandidate) {
      try {
        selectedCandidate = await findCatalogCandidate(stagedEntry.row);
        if (selectedCandidate) {
          searchQueryUsed = `catalog_api:${selectedCandidate.catalogMatchType}`;
          catalogHit = true;
        }
      } catch (error) {
        catalogError = error instanceof Error ? error.message : String(error);
      }
    }

    if (!selectedCandidate && ENABLE_STAGED_IMAGE_OCR) {
      const stagedImages = [
        normalizeText(stagedEntry.row?.productCatalogImage ?? null) || null,
        ...(Array.isArray(stagedEntry.row?.productImages) ? stagedEntry.row.productImages : []),
      ].filter(Boolean);
      if (stagedImages.length > 0) {
        selectedCandidate = {
          title: stagedEntry.row.title,
          imageAlt: stagedEntry.row.title,
          imageUrl: stagedImages[0],
          imageUrls: stagedImages,
          pageUrl: normalizeText(stagedEntry.row?.link ?? null) || null,
          stagedImageFallback: true,
          bodyText: "",
        };
        searchQueryUsed = `staged_images:${productId}`;
      }
    }

    if (selectedCandidate) {
      selectedCandidate = await enrichCandidateWithShopifyProduct(selectedCandidate);
    }

    if (!selectedCandidate) {
      const stagedOnlySupplementFacts = buildGenericIngredientFactsHelper({
        stagedRow: stagedEntry.row,
        combinedPageText: stagedSectionFallback.combinedText,
        otherIngredients: stagedSectionFallback.otherIngredients,
        existingSupplementFacts: stagedEntry.row?.supplementFacts ?? null,
      });
      if (stagedOnlySupplementFacts?.nutritionalFacts?.length) {
        const seedSections = {};
        if (stagedSectionFallback.suggestedUse) seedSections["Suggested use"] = stagedSectionFallback.suggestedUse;
        if (stagedSectionFallback.warnings) seedSections.Warnings = stagedSectionFallback.warnings;
        if (stagedSectionFallback.otherIngredients) seedSections["Other ingredients"] = stagedSectionFallback.otherIngredients;
        const seedRow = {
          brandName: stagedEntry.row.brandName,
          title: stagedEntry.row.title,
          productId,
          upcCode: stagedEntry.row.upcCode,
          barcode_gtin14: stagedEntry.row.barcode_gtin14,
          sourceTypes: ["staged_section_fallback"],
          marketSources: ["US"],
          sourceUrls: [normalizeText(stagedEntry.row?.link ?? null) || null].filter(Boolean),
          sourceNotes: [
            `official_search_query:${searchQueryUsed ?? "n/a"}`,
            "staged_section_fallback:generic_facts",
          ],
          productCatalogImage: normalizeText(stagedEntry.row?.productCatalogImage ?? null) || null,
          sections: seedSections,
          supplementFacts: stagedOnlySupplementFacts,
        };
        const { hydratedRow } = mergeSeedIntoStagedRow(stagedEntry.row, seedRow);
        refreshedRows[stagedEntry.idx] = hydratedRow;
        const afterMissingFields = Array.isArray(hydratedRow?.completeness?.coreMissingFields)
          ? hydratedRow.completeness.coreMissingFields
          : [];
        const filledFields = CORE_FIELDS.filter(
          (field) => beforeMissingFields.includes(field) && !afterMissingFields.includes(field),
        );
        if (filledFields.length > 0) {
          seedProducts.push(seedRow);
        }
        auditRows.push({
          productId,
          title: hydratedRow.title,
          searchQuery: searchQueryUsed,
          searchHit,
          catalogHit,
          pageHit,
          pdfHit,
          imageOcrHit,
          improved: filledFields.length > 0,
          reason: filledFields.length > 0 ? "staged_section_fallback_applied" : "staged_section_fallback_no_change",
          requestError: searchError ?? catalogError,
          beforeMissingFields,
          afterMissingFields,
          filledFields,
          pageUrl: normalizeText(stagedEntry.row?.link ?? null) || null,
          brochureUrl: null,
          pageSuggestedUseFound: Boolean(stagedSectionFallback.suggestedUse),
          pageWarningFound: Boolean(stagedSectionFallback.warnings),
          pdfSuggestedUseFound: false,
          pdfWarningFound: false,
          ocrSuggestedUseFound: false,
          ocrWarningFound: false,
          ocrSupplementFactsFound: true,
          imageUrlsTried: [],
          productCatalogImage: normalizeText(stagedEntry.row?.productCatalogImage ?? null) || null,
        });
        if (DELAY_MS > 0 && idx < selectedRows.length - 1) await sleep(DELAY_MS);
        continue;
      }

      auditRows.push({
        productId,
        title: stagedEntry.row.title,
        searchQuery: searchQueryUsed,
        searchHit,
        catalogHit,
        pageHit,
        pdfHit,
        imageOcrHit,
        improved: false,
        reason: searchError || catalogError ? "search_failed" : "search_no_match",
        requestError: searchError ?? catalogError,
        beforeMissingFields,
        afterMissingFields: beforeMissingFields,
      });
      if (DELAY_MS > 0 && idx < selectedRows.length - 1) await sleep(DELAY_MS);
      continue;
    }

    const skipPageFetchForStagedIherbFallback =
      Boolean(selectedCandidate?.stagedImageFallback) && isIherbProductUrl(selectedCandidate?.pageUrl);

    if (!skipPageFetchForStagedIherbFallback && selectedCandidate.pageUrl && /^https?:\/\//i.test(selectedCandidate.pageUrl)) {
      try {
        pageMarkdown = await fetchText(selectedCandidate.pageUrl, `product page ${selectedCandidate.pageUrl}`);
        if (isSecurityVerificationBody(pageMarkdown)) {
          pageError = "ignored_security_verification_body";
          pageMarkdown = null;
        } else {
          pageHit = true;
        }
      } catch (error) {
        pageError = error instanceof Error ? error.message : String(error);
      }
    }

    const combinedPageText = [selectedCandidate.bodyText, pageMarkdown].filter(Boolean).join("\n\n");
    let suggestedUse =
      parseSuggestedUseFromBlock(combinedPageText) ??
      parseInlineLabeledBlock(pageMarkdown, "Suggested Use", [
        /^Warning:/i,
        /^\*\s+Supplement Facts Panel:/i,
        /^###\s+/i,
        /^##\s+/i,
        /^Practitioner Sign In/i,
        /^Close$/i,
      ]) ??
      parseInlineLabeledBlock(pageMarkdown, "Directions", [
        /^Warning:/i,
        /^Warnings:/i,
        /^\*\s+Supplement Facts Panel:/i,
        /^###\s+/i,
        /^##\s+/i,
        /^Practitioner Sign In/i,
        /^Close$/i,
      ]) ??
      parsePageHeadingBlock(pageMarkdown, ["Suggested Use", "Directions"], [
        "Warning",
        "Warnings",
        "Use Caution",
        "Interactions",
        "Supplement Facts",
        "Description",
        "Ingredients",
        "Other Ingredients",
        "Practitioner Sign In",
        "Close",
  ]) ??
  null;

const parseIngredientsFromBlock = (text) =>
  parseInlineLabeledBlock(text, "Ingredients", [
    /^How to Use/i,
    /^Directions/i,
    /^Suggested Use/i,
    /^Warning:/i,
    /^Warnings:/i,
    /^Caution:/i,
    /^Safety Guidelines/i,
    /^Store/i,
    /^KEEP OUT OF REACH/i,
    /^More Information/i,
    /^Supplement Facts/i,
  ]) ??
  parseInlineLabeledBlock(text, "Active ingredient", [
    /^Inactive ingredient/i,
    /^Directions/i,
    /^Uses/i,
    /^Warning:/i,
    /^Warnings:/i,
    /^Caution:/i,
    /^Supplement Facts/i,
  ]) ??
  parseInlineLabeledBlock(text, "Active ingredients", [
    /^Inactive ingredient/i,
    /^Directions/i,
    /^Uses/i,
    /^Warning:/i,
    /^Warnings:/i,
    /^Caution:/i,
    /^Supplement Facts/i,
  ]) ??
  parsePageHeadingBlock(text, ["Ingredients", "Active ingredient", "Active ingredients"], [
    "How to Use",
    "Directions",
    "Suggested Use",
    "Warning",
    "Warnings",
    "Caution",
    "Safety Guidelines",
    "More Information",
    "Supplement Facts",
  ]) ??
  parseLinkedHeadingBlock(text, "Ingredients", [
    "How to Use",
    "Directions",
    "Suggested Use",
    "Warning",
    "Warnings",
    "Safety Guidelines",
    "More Information",
    "Details",
  ]) ??
  null;

const parsePackageAmount = (text) => {
  const value = normalizeText(text);
  if (!value) return null;
  const allMatches = [...value.matchAll(/(\d+(?:\.\d+)?)\s*(fl\s*oz|oz|ml|mL|g|mg|mcg|lb|lbs|tablets?|capsules?|softgels?|pellets?)(?:\s*\(([^)]+)\))?/gi)];
  const match = allMatches[allMatches.length - 1];
  if (!match) return null;
  const amount = `${match[1]} ${match[2]}`.replace(/\s+/g, " ").trim();
  const paren = normalizeText(match[3] ?? "");
  return normalizeText([amount, paren ? `(${paren})` : null].filter(Boolean).join(" ")) || null;
};

const buildGenericIngredientFacts = ({ stagedRow, combinedPageText, otherIngredients, existingSupplementFacts }) => {
  if (existingSupplementFacts?.nutritionalFacts?.length) return existingSupplementFacts;
  const ingredientText = parseIngredientsFromBlock(combinedPageText) ?? (normalizeText(otherIngredients) || null);
  const dosageText =
    parsePackageAmount(stagedRow?.title) ??
    parsePackageAmount(stagedRow?.count) ??
    parsePackageAmount(combinedPageText);
  if (!ingredientText || !dosageText) return existingSupplementFacts;
  return {
    servingSize: null,
    servingsPerContainer: null,
    nutritionalFacts: [
      {
        substancy: ingredientText.replace(/\.\s*$/, ""),
        amountPerServing: dosageText,
        dailyValuePercent: null,
      },
    ],
  };
};

    let warnings =
      parseWarningsFromBlock(combinedPageText) ??
      parseInlineLabeledBlock(pageMarkdown, "Warning", [
        /^\*\s+Weight Management or Muscle Building Product:/i,
        /^\*\s+Yotpo ID:/i,
        /^\*\s+Weight:/i,
        /^Close$/i,
        /^Practitioner Sign In/i,
        /^###\s+/i,
        /^##\s+/i,
      ]) ??
      parseInlineLabeledBlock(pageMarkdown, "Warnings", [
        /^\*\s+Weight Management or Muscle Building Product:/i,
        /^\*\s+Yotpo ID:/i,
        /^\*\s+Weight:/i,
        /^Close$/i,
        /^Practitioner Sign In/i,
        /^###\s+/i,
        /^##\s+/i,
      ]) ??
      parsePageHeadingBlock(pageMarkdown, ["Warning", "Warnings", "Use Caution"], [
        "Suggested Use",
        "Directions",
        "Interactions",
        "Supplement Facts",
        "Description",
        "Ingredients",
        "Other Ingredients",
        "Practitioner Sign In",
        "Close",
      ]) ??
      null;

    let otherIngredients = parseOtherIngredientsFromBlock(combinedPageText);
    let supplementFacts = null;

    const brochureFilenames = [
      ...new Set([
        ...normalizeStringList(BROCHURE_FILENAME_OVERRIDES[productId] ?? []),
        ...parseBrochureFilenames(pageMarkdown),
      ]),
    ];
    const pageImage = extractFirstImageUrl(pageMarkdown);
    let brochureUrlUsed = null;

    if ((!suggestedUse || !warnings) && brochureFilenames.length > 0) {
      for (const brochureFilename of brochureFilenames) {
        const pdfCandidates = [
          `${SITE_ORIGIN}/media/pdf_upload/${brochureFilename}`,
          `${SITE_ORIGIN}/media/${brochureFilename}`,
        ];

        for (const pdfUrl of pdfCandidates) {
          try {
            const fetchedPdfMarkdown = await fetchText(pdfUrl, `product information sheet ${brochureFilename}`);
            const parsedSuggestedUse =
              parsePdfHeadingBlock(fetchedPdfMarkdown, "SUGGESTED USE", [
                "WARNING",
                "WARNINGS",
                "OTHER INGREDIENTS",
                "STORAGE",
                "ALLERGENS",
                "SUPPLEMENT FACTS",
                "BENEFITS",
                "FEATURES",
                "VERIFIABLE SCIENCE",
                "INDICATIONS",
                "Ages",
              ]) ??
              parsePdfHeadingBlock(fetchedPdfMarkdown, "Suggested Use", [
                "Warning",
                "Warnings",
                "Other Ingredients",
                "Storage",
                "Allergens",
                "Supplement Facts",
                "Benefits",
                "Features",
                "Verifiable Science",
                "Indications",
                "Ages",
              ]);
            const parsedWarnings =
              parsePdfHeadingBlock(fetchedPdfMarkdown, "WARNING", [
                "OTHER INGREDIENTS",
                "STORAGE",
                "ALLERGENS",
                "SUPPLEMENT FACTS",
                "BENEFITS",
                "FEATURES",
                "VERIFIABLE SCIENCE",
                "INDICATIONS",
                "Ages",
              ]) ??
              parsePdfHeadingBlock(fetchedPdfMarkdown, "Warnings", [
                "Other Ingredients",
                "Storage",
                "Allergens",
                "Supplement Facts",
                "Benefits",
                "Features",
                "Verifiable Science",
                "Indications",
                "Ages",
              ]);

            if (parsedSuggestedUse || parsedWarnings) {
              suggestedUse = suggestedUse ?? parsedSuggestedUse ?? null;
              warnings = warnings ?? parsedWarnings ?? null;
              pdfMarkdown = fetchedPdfMarkdown;
              brochureUrlUsed = pdfUrl;
              pdfHit = true;
              break;
            }
          } catch (error) {
            pdfError = error instanceof Error ? error.message : String(error);
          }
        }

        if (pdfHit) break;
      }
    }

    const pageImageUrls = extractAllImageUrls(pageMarkdown);
    const combinedExtractionText = [combinedPageText, stagedSectionFallback.combinedText].filter(Boolean).join("\n\n");
    const imageOcr = await runImageOcrFallback({
      stagedRow: stagedEntry.row,
      selectedCandidate: {
        ...selectedCandidate,
        imageUrls: [
          ...(Array.isArray(selectedCandidate?.imageUrls) ? selectedCandidate.imageUrls : []),
          ...pageImageUrls,
        ],
      },
      beforeMissingFields,
    });
    imageOcrHit = imageOcr.imageOcrHit;
    suggestedUse = suggestedUse ?? imageOcr.suggestedUse ?? null;
    suggestedUse = suggestedUse ?? stagedSectionFallback.suggestedUse ?? null;
    warnings = warnings ?? imageOcr.warnings ?? null;
    otherIngredients = otherIngredients ?? imageOcr.otherIngredients ?? null;
    otherIngredients = otherIngredients ?? stagedSectionFallback.otherIngredients ?? null;
    supplementFacts = supplementFacts ?? imageOcr.supplementFacts ?? null;
    warnings =
      warnings ??
      stagedSectionFallback.warnings ??
      (ALLOW_SITE_WIDE_FDA_WARNING
        ? inferSiteWideFdaDisclaimerWarning(pageMarkdown) ?? inferSiteWideFdaDisclaimerWarning(combinedExtractionText)
        : null) ??
      inferAllergenWarning(otherIngredients) ??
      inferAllergenWarning(stagedEntry.row?.descriptionSections?.Description ?? null) ??
      null;
    supplementFacts = buildGenericIngredientFactsHelper({
      stagedRow: stagedEntry.row,
      combinedPageText: combinedExtractionText,
      otherIngredients,
      existingSupplementFacts: supplementFacts,
    });

    const productCatalogImage =
      normalizeText(
        [imageOcr.imageEvidenceUrl, selectedCandidate.imageUrl, pageImage, stagedEntry.row?.productCatalogImage].find((value) =>
          isLikelyProductImageUrl(value),
        ) || null,
      ) || null;
    const manualSectionOverride = MANUAL_SECTION_OVERRIDES[productId] ?? {};
    const manualSupplementFactsOverride = MANUAL_SUPPLEMENT_FACTS_OVERRIDES[productId] ?? null;
    suggestedUse = suggestedUse ?? (normalizeText(manualSectionOverride["Suggested use"] ?? null) || null);
    warnings = warnings ?? (normalizeText(manualSectionOverride.Warnings ?? null) || null);
    const seedSections = {};
    if (suggestedUse) seedSections["Suggested use"] = suggestedUse;
    if (warnings) seedSections.Warnings = warnings;
    if (otherIngredients) seedSections["Other ingredients"] = otherIngredients;
    supplementFacts = manualSupplementFactsOverride ?? supplementFacts ?? null;

    const sourceUrls = [selectedCandidate.pageUrl, brochureUrlUsed].filter(Boolean);
    const sourceTypes = ["official_product_page"];
    if (brochureUrlUsed) sourceTypes.push("official_product_information_sheet");
    if (catalogHit) sourceTypes.push("official_shopify_catalog");
    if (imageOcrHit) sourceTypes.push("official_product_label_image_ocr");

    const seedRow = {
      brandName: stagedEntry.row.brandName,
      title: stagedEntry.row.title,
      productId,
      upcCode: stagedEntry.row.upcCode,
      barcode_gtin14: stagedEntry.row.barcode_gtin14,
      sourceTypes,
      marketSources: ["US"],
      sourceUrls,
      sourceNotes: [
        `official_search_query:${searchQueryUsed ?? "n/a"}`,
        selectedCandidate.pageUrl ? `official_page_path:${selectedCandidate.pageUrl.replace(SITE_ORIGIN, "")}` : null,
        catalogHit ? `official_catalog_match:${selectedCandidate.catalogMatchType ?? "unknown"}` : null,
      ],
      productCatalogImage,
      sections: seedSections,
      supplementFacts,
    };

    const { hydratedRow } = mergeSeedIntoStagedRow(stagedEntry.row, seedRow);
    refreshedRows[stagedEntry.idx] = hydratedRow;

    const afterMissingFields = Array.isArray(hydratedRow?.completeness?.coreMissingFields)
      ? hydratedRow.completeness.coreMissingFields
      : [];
    const filledFields = CORE_FIELDS.filter(
      (field) => beforeMissingFields.includes(field) && !afterMissingFields.includes(field),
    );

    if (filledFields.length > 0) {
      seedProducts.push(seedRow);
    }

    auditRows.push({
      productId,
      title: hydratedRow.title,
      searchQuery: searchQueryUsed,
      searchHit,
      catalogHit,
      pageHit,
      pdfHit,
      imageOcrHit,
      improved: filledFields.length > 0,
      reason: filledFields.length > 0 ? "official_fallback_applied" : "official_fallback_no_change",
      requestError: searchError ?? catalogError ?? pageError ?? pdfError,
      beforeMissingFields,
      afterMissingFields,
      filledFields,
      pageUrl: selectedCandidate.pageUrl,
      brochureUrl: brochureUrlUsed,
      pageSuggestedUseFound: Boolean(
        parseInlineLabeledBlock(pageMarkdown, "Suggested Use", [
          /^Warning:/i,
          /^\*\s+Supplement Facts Panel:/i,
          /^###\s+/i,
          /^##\s+/i,
        ]) ||
          parseInlineLabeledBlock(pageMarkdown, "Directions", [
            /^Warning:/i,
            /^Warnings:/i,
            /^\*\s+Supplement Facts Panel:/i,
            /^###\s+/i,
            /^##\s+/i,
          ]) ||
          parsePageHeadingBlock(pageMarkdown, ["Suggested Use", "Directions"], [
            "Warning",
            "Warnings",
            "Use Caution",
            "Interactions",
            "Supplement Facts",
            "Description",
            "Ingredients",
            "Other Ingredients",
          ]),
      ),
      pageWarningFound: Boolean(
        parseInlineLabeledBlock(pageMarkdown, "Warning", [
          /^\*\s+Weight Management or Muscle Building Product:/i,
          /^\*\s+Yotpo ID:/i,
          /^\*\s+Weight:/i,
          /^###\s+/i,
          /^##\s+/i,
        ]) ||
          parseInlineLabeledBlock(pageMarkdown, "Warnings", [
            /^\*\s+Weight Management or Muscle Building Product:/i,
            /^\*\s+Yotpo ID:/i,
            /^\*\s+Weight:/i,
            /^###\s+/i,
            /^##\s+/i,
          ]) ||
          parsePageHeadingBlock(pageMarkdown, ["Warning", "Warnings", "Use Caution"], [
            "Suggested Use",
            "Directions",
            "Interactions",
            "Supplement Facts",
            "Description",
            "Ingredients",
            "Other Ingredients",
          ]),
      ),
      pdfSuggestedUseFound: Boolean(
        parsePdfHeadingBlock(pdfMarkdown, "SUGGESTED USE", [
          "WARNING",
          "WARNINGS",
          "OTHER INGREDIENTS",
          "STORAGE",
          "ALLERGENS",
          "SUPPLEMENT FACTS",
          "BENEFITS",
          "FEATURES",
          "VERIFIABLE SCIENCE",
          "INDICATIONS",
          "Ages",
        ]),
      ),
      pdfWarningFound: Boolean(
        parsePdfHeadingBlock(pdfMarkdown, "WARNING", [
          "OTHER INGREDIENTS",
          "STORAGE",
          "ALLERGENS",
          "SUPPLEMENT FACTS",
          "BENEFITS",
          "FEATURES",
          "VERIFIABLE SCIENCE",
          "INDICATIONS",
          "Ages",
        ]),
      ),
      ocrSuggestedUseFound: Boolean(imageOcr.suggestedUse),
      ocrWarningFound: Boolean(imageOcr.warnings),
      ocrSupplementFactsFound: Boolean(imageOcr.supplementFacts?.nutritionalFacts?.length),
      imageUrlsTried: imageOcr.imageUrlsTried,
      productCatalogImage,
    });

    if (DELAY_MS > 0 && idx < selectedRows.length - 1) await sleep(DELAY_MS);
  }

  const summary = auditRows.reduce(
    (acc, row) => {
      acc.processed += 1;
      if (row.searchHit) acc.searchHits += 1;
      if (row.catalogHit) acc.catalogHits += 1;
      if (row.pageHit) acc.pageHits += 1;
      if (row.pdfHit) acc.pdfHits += 1;
      if (row.imageOcrHit) acc.imageOcrHits += 1;
      if (row.improved) acc.improvedRows += 1;
      if ((row.filledFields ?? []).includes("ingredient")) acc.filledIngredient += 1;
      if ((row.filledFields ?? []).includes("dosage")) acc.filledDosage += 1;
      if ((row.filledFields ?? []).includes("suggested_use")) acc.filledSuggestedUse += 1;
      if ((row.filledFields ?? []).includes("warnings")) acc.filledWarnings += 1;
      if ((row.filledFields ?? []).includes("product_image")) acc.filledProductImage += 1;
      if ((row.afterMissingFields ?? []).includes("suggested_use")) acc.stillMissingSuggestedUse += 1;
      if ((row.afterMissingFields ?? []).includes("warnings")) acc.stillMissingWarnings += 1;
      if ((row.afterMissingFields ?? []).includes("product_image")) acc.stillMissingProductImage += 1;
      if (!(row.afterMissingFields ?? []).length) acc.becameFullOverlayReady += 1;
      return acc;
    },
    {
      queued: selectedRows.length,
      processed: 0,
      searchHits: 0,
      catalogHits: 0,
      pageHits: 0,
      pdfHits: 0,
      imageOcrHits: 0,
      improvedRows: 0,
      becameFullOverlayReady: 0,
      filledIngredient: 0,
      filledDosage: 0,
      filledSuggestedUse: 0,
      filledWarnings: 0,
      filledProductImage: 0,
      stillMissingSuggestedUse: 0,
      stillMissingWarnings: 0,
      stillMissingProductImage: 0,
    },
  );

  const report = {
    generatedAt: nowIso(),
    inputs: {
      stagingPath: STAGING_PATH,
      queuePath: QUEUE_PATH,
      configJsonPath: CONFIG_JSON_PATH,
      brandFilter: BRAND_FILTER,
      priorityLane: PRIORITY_LANE,
      siteOrigin: SITE_ORIGIN,
      searchPathTemplate: SEARCH_PATH_TEMPLATE,
      delayMs: DELAY_MS,
      requestTimeoutMs: REQUEST_TIMEOUT_MS,
    },
    summary,
    executionHealth,
    rows: auditRows,
  };

  const stagingOut = path.join(OUT_DIR, "staging_products.official_refreshed.json");
  const seedOut = path.join(OUT_DIR, "official_fallback_seed.json");
  const reportJsonOut = path.join(OUT_DIR, "official_fallback_report.json");
  const reportMdOut = path.join(OUT_DIR, "official_fallback_report.md");

  if (WRITE_STAGING_OUT) {
    await fs.writeFile(stagingOut, `${JSON.stringify({ products: refreshedRows }, null, 2)}\n`, "utf8");
  }
  await fs.writeFile(seedOut, `${JSON.stringify({ products: seedProducts }, null, 2)}\n`, "utf8");
  await fs.writeFile(reportJsonOut, `${JSON.stringify(report, null, 2)}\n`, "utf8");
  if (WRITE_REPORT_MD) {
    await fs.writeFile(reportMdOut, buildMarkdownReport(report), "utf8");
  }

  console.log(
    JSON.stringify(
      {
        ok: true,
        outputs: {
          staging: WRITE_STAGING_OUT ? stagingOut : null,
          seed: seedOut,
          reportJson: reportJsonOut,
          reportMd: WRITE_REPORT_MD ? reportMdOut : null,
        },
        summary,
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
