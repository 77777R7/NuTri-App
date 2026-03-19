import fs from "node:fs/promises";
import path from "node:path";
import { execFileSync } from "node:child_process";

import { stableHash, toGtin14 } from "./iherb-overlay-utils.mjs";

export const DEFAULT_IDENTITY_BRANDS = ["Healthy Origins", "Pure Encapsulations", "Nature's Bounty", "Schiff"];

export const normalizeText = (value) =>
  String(value ?? "")
    .replace(/\u00a0/g, " ")
    .replace(/\s+/g, " ")
    .trim();

export const normalizeLower = (value) => normalizeText(value).toLowerCase();
export const normalizeDigits = (value) => normalizeText(value).replace(/\D/g, "");
export const normalizeBarcode = (value) => toGtin14(value) ?? null;
export const slugify = (value) =>
  normalizeLower(value)
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");

export const readJson = async (filePath) => JSON.parse(await fs.readFile(filePath, "utf8"));
export const readOptionalJson = async (filePath) => {
  try {
    return JSON.parse(await fs.readFile(filePath, "utf8"));
  } catch {
    return null;
  }
};

export const writeJson = async (filePath, payload) => {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
};

export const writeText = async (filePath, text) => {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, text, "utf8");
};

export const copyFile = async (sourcePath, targetPath) => {
  await fs.mkdir(path.dirname(targetPath), { recursive: true });
  await fs.copyFile(sourcePath, targetPath);
};

export const fileExists = async (filePath) => {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
};

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const decodeHtml = (value) =>
  normalizeText(value)
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">");

const escapeRegExp = (value) => String(value ?? "").replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

const stripBrandPrefix = (title, brandName) =>
  normalizeLower(title)
    .replace(new RegExp(`^\\s*${escapeRegExp(brandName)}\\s*,?\\s*`, "i"), "")
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

export const buildTitleModels = (title, brandName) => {
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
  return [...new Set([gtin14, gtin14.slice(-13), gtin14.slice(-12)])].filter(Boolean);
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

export const buildQueryFamilyMap = (row) => {
  const brandName = normalizeText(row.brandName);
  const titles = buildTitleModels(row.productName ?? row.title, row.brandName);
  const subBrand = detectSubBrand(row.brandName, row.productName ?? row.title);
  const strippedProductName = normalizeText(stripBrandPrefix(row.productName ?? row.title, row.brandName));
  const barcodeVariants = buildBarcodeVariants(row.barcode_gtin14);
  const families = {
    barcode_only_normalized: barcodeVariants.slice(0, 3),
    brand_plus_barcode: barcodeVariants.map((barcode) => `${brandName} ${barcode}`).slice(0, 3),
    brand_plus_active_strength: expandQueryVariants(`${brandName} ${titles.ingredientPlusStrength}`).slice(0, 3),
    brand_plus_normalized_title: expandQueryVariants(`${brandName} ${titles.fullNormalizedTitle}`).slice(0, 3),
    product_name_only: expandQueryVariants(strippedProductName).slice(0, 2),
    sub_brand_family: subBrand
      ? expandQueryVariants(`${subBrand} ${titles.ingredientPlusStrength || titles.coreIngredientTitle || strippedProductName}`).slice(0, 3)
      : [],
  };
  return {
    subBrand,
    titles,
    families: Object.fromEntries(Object.entries(families).map(([key, queries]) => [key, queries.filter(Boolean)])),
  };
};

const classifyQuerySensitivityType = (row) => {
  const title = normalizeText(row?.title ?? row?.productName);
  const titleModel = buildTitleModels(title, row?.brandName);
  if (buildBarcodeVariants(row?.barcode_gtin14).length > 0 && titleModel.tokens.length <= 3) return "barcode_sensitive";
  if (titleModel.tokens.length >= 4) return "title_sensitive";
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

export const buildPositiveControlDebugSet = (stagingRows, options = {}) => {
  const brands = options.brands ?? DEFAULT_IDENTITY_BRANDS;
  const selected = [];
  const notes = [];
  for (const brandName of brands) {
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
        expectedCountOrForm:
          normalizeText([match.expectedPageIdentityEvidence.count, match.expectedPageIdentityEvidence.form].filter(Boolean).join(" ")) || null,
        querySensitivityType: match.querySensitivityType,
        controlType: "positive_control",
      });
    }
  }
  return {
    rows: selected.slice(0, options.limit ?? 8),
    notes,
  };
};

export const createDiscoveryHarness = (config = {}) => {
  const ROOT = config.root ?? process.cwd();
  const READER_PREFIX = config.readerPrefix ?? "https://r.jina.ai/http://";
  const REQUEST_TIMEOUT_MS = Number(config.requestTimeoutMs ?? 2000) || 2000;
  const PAGE_TIMEOUT_MS = Number(config.pageTimeoutMs ?? 8000) || 8000;
  const FETCH_RETRY_LIMIT = Number(config.fetchRetryLimit ?? 2) || 2;
  const FETCH_BACKOFF_MS = Number(config.fetchBackoffMs ?? 500) || 500;
  const DISCOVERY_QUERY_LIMIT = Number(config.discoveryQueryLimit ?? 2) || 2;
  const DISCOVERY_FALLBACK_QUERY_LIMIT = Number(config.discoveryFallbackQueryLimit ?? 1) || 1;
  const DISCOVERY_CANDIDATE_LIMIT = Number(config.discoveryCandidateLimit ?? 2) || 2;
  const USE_SITEMAP = Boolean(config.useSitemap ?? false);

  const executionHealth = {
    requests: 0,
    fetchSuccess: 0,
    http429: 0,
    aborted: 0,
    cacheHits: 0,
    retryCount: 0,
  };

  let fetchAdapterMode = "curl_reader";
  let wavePass = "default";
  const searchCache = new Map();
  let sitemapEntriesPromise = null;

  const snapshotExecutionHealth = () => ({ ...executionHealth });
  const diffExecutionHealth = (before) => ({
    requests: executionHealth.requests - before.requests,
    fetchSuccess: executionHealth.fetchSuccess - before.fetchSuccess,
    http429: executionHealth.http429 - before.http429,
    aborted: executionHealth.aborted - before.aborted,
    cacheHits: executionHealth.cacheHits - before.cacheHits,
    retryCount: executionHealth.retryCount - before.retryCount,
  });

  const setFetchAdapterMode = (mode) => {
    fetchAdapterMode = mode;
  };

  const setWavePass = (mode) => {
    wavePass = mode;
  };

  const resetSearchCache = () => {
    searchCache.clear();
  };

  const buildSearchCacheKey = (prefix, query, namespace = "default") =>
    `${namespace}:${wavePass}:${fetchAdapterMode}:${prefix}:${query}`;

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
        fetchAdapterMode === "curl_reader"
          ? await fetchTextCurl(targetUrl, label, timeoutMs)
          : await fetchTextNode(targetUrl, label, timeoutMs);
      fetched.retryCount = attempt - 1;
      if (fetched.ok && fetched.text) return fetched;
      last = fetched;
      if (attempt < FETCH_RETRY_LIMIT) {
        executionHealth.retryCount += 1;
        await sleep(FETCH_BACKOFF_MS * attempt);
      }
    }
    return (
      last ?? {
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
        sourceAdapter: fetchAdapterMode,
        headers: {},
      }
    );
  };

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
    const rawHasPrUrl = /https?:\/\/(?:www|[a-z]{2})\.iherb\.com\/pr\/|(?:^|[\s(])(?:www\.)?iherb\.com\/pr\/|(?:^|[\s(])\/pr\/[^\s)]+/i.test(rawText);
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
      sourceAdapter: fetched?.sourceAdapter ?? options.sourceAdapter ?? fetchAdapterMode,
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

  const canonicalizeIherbUrl = (value) => {
    let decoded = decodeHtml(value);
    for (let attempt = 0; attempt < 2; attempt += 1) {
      try {
        if (/%[0-9A-Fa-f]{2}/.test(decoded)) decoded = decodeURIComponent(decoded);
      } catch {
        break;
      }
    }
    let candidate = decoded;
    if (/^(?:www\.)?iherb\.com\/pr\//i.test(candidate)) candidate = `https://${candidate.replace(/^\/+/, "")}`;
    if (/^\/pr\//i.test(candidate)) candidate = `https://www.iherb.com${candidate}`;
    const match = candidate.match(/https?:\/\/(?:www\.|[a-z]{2}\.)?iherb\.com\/pr\/[^"'?\s<>]+(?:\/\d+)?(?:\?[^"'<> ]*)?/i);
    if (!match) return null;
    try {
      const url = new URL(match[0]);
      url.hostname = "www.iherb.com";
      url.protocol = "https:";
      url.hash = "";
      return url.toString().replace(/\?at=0&?$/i, "").replace(/\?$/i, "");
    } catch {
      return null;
    }
  };

  const extractIherbProductUrlsCurrent = (text) => {
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

  const extractIherbProductUrlsAggressive = (text) => {
    const raw = String(text ?? "");
    const urls = new Set(extractIherbProductUrlsCurrent(raw));
    const passes = [raw];
    for (const candidate of [raw]) {
      try {
        if (/%[0-9A-Fa-f]{2}/.test(candidate)) passes.push(decodeURIComponent(candidate));
      } catch {
        // ignore decode failure
      }
    }
    for (const pass of passes) {
      for (const match of pass.matchAll(/(?:^|[\s("'])((?:https?:\/\/)?(?:www\.)?iherb\.com\/pr\/[^)\s"'<>]+)/gi)) {
        const candidate = canonicalizeIherbUrl(match[1]);
        if (candidate) urls.add(candidate);
      }
      for (const match of pass.matchAll(/(?:^|[\s("'])((?:\/pr\/)[^)\s"'<>]+)/gi)) {
        const candidate = canonicalizeIherbUrl(match[1]);
        if (candidate) urls.add(candidate);
      }
    }
    return [...urls];
  };

  const fetchDirectIherbDetection = async (targetUrl, row) => {
    const fetched = await fetchTextCurl(targetUrl, "direct-iherb-detection", PAGE_TIMEOUT_MS);
    return buildFetchTraceEntry(fetched, row, {
      sourceAdapter: "curl_direct_iherb",
      sourceKind: "direct_iherb_fetch",
      parserStageReached: fetched.ok && normalizeText(fetched.text) ? "html_loaded" : "fetch_only",
    });
  };

  const searchIherbViaRjina = async (query, options = {}) => {
    const {
      traceCollector = null,
      row = null,
      cacheNamespace = "default",
      extractionMode = "current",
    } = options;
    const cacheKey = buildSearchCacheKey(`rjina:${extractionMode}`, query, cacheNamespace);
    if (searchCache.has(cacheKey)) {
      executionHealth.cacheHits += 1;
      const cached = searchCache.get(cacheKey);
      if (Array.isArray(traceCollector)) {
        traceCollector.push({
          sourceAdapter: fetchAdapterMode,
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
          blockedOrCaptchaType: null,
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
    const urls =
      extractionMode === "aggressive"
        ? extractIherbProductUrlsAggressive(fetched.text)
        : extractIherbProductUrlsCurrent(fetched.text);
    searchCache.set(cacheKey, urls);
    return urls;
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
    const resolved = [...links].slice(0, DISCOVERY_CANDIDATE_LIMIT);
    searchCache.set(cacheKey, resolved);
    return resolved;
  };

  const fetchProductSitemapEntries = async () => {
    if (!USE_SITEMAP) return [];
    if (sitemapEntriesPromise) return sitemapEntriesPromise;
    sitemapEntriesPromise = (async () => {
      const indexFetched = await fetchText("https://www.iherb.com/sitemap_index.xml", "iherb-sitemap-index", REQUEST_TIMEOUT_MS);
      if (!indexFetched.ok || !indexFetched.text) return [];
      const sitemapUrls = [...indexFetched.text.matchAll(/<loc>(https:\/\/www\.iherb\.com\/sitemaps\/products-[^<]+\.xml)<\/loc>/g)]
        .map((match) => normalizeText(match[1]))
        .filter(Boolean)
        .slice(0, 4);
      const entries = [];
      for (const sitemapUrl of sitemapUrls) {
        const fetched = await fetchText(sitemapUrl, `iherb-product-sitemap:${path.basename(sitemapUrl)}`, REQUEST_TIMEOUT_MS);
        if (!fetched.ok || !fetched.text) continue;
        const urls = [...fetched.text.matchAll(/<loc>(https:\/\/www\.iherb\.com\/pr\/[^<]+)<\/loc>/g)]
          .map((match) => normalizeText(match[1]))
          .filter(Boolean);
        for (const url of urls) entries.push({ url, slug: normalizeLower(url) });
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

  const findSitemapCandidateUrlsV2 = async (row, titleModel) => {
    if (!USE_SITEMAP) return [];
    const entries = await fetchProductSitemapEntries();
    const brandSlugs = [...new Set([slugify(row.brandName), slugify(String(row.brandName).replace(/['’]/g, ""))])].filter(Boolean);
    const titleTokens = titleModel.tokens;
    const scored = entries
      .filter((entry) => brandSlugs.some((brandSlug) => entry.slug.includes(`/pr/${brandSlug}-`)))
      .map((entry) => {
        const tokenHits = titleTokens.filter((token) => entry.slug.includes(token.replace(/[^a-z0-9]+/g, "-"))).length;
        return {
          url: entry.url,
          score: tokenHits * 10,
          tokenHits,
        };
      })
      .filter((entry) => entry.tokenHits > 0)
      .sort((left, right) => right.score - left.score || left.url.localeCompare(right.url));
    return scored.slice(0, DISCOVERY_CANDIDATE_LIMIT);
  };

  const parseSection = (markdown, sectionName) => {
    const escaped = escapeRegExp(sectionName);
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
    const fetched = await fetchText(readerUrl, `expected-page:${expectedUrl}`, PAGE_TIMEOUT_MS);
    const expectedFetch = buildFetchTraceEntry(fetched, row, {
      sourceFamily: "expected_page_trace",
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
    const scored = scoreCandidateWithReasons(row, titleModel, parsedPage, pageProfile);
    const rejectReasons = [...(scored.reasons ?? [])];
    if (
      normalizeText(row.expectedProductId) &&
      normalizeText(parsedPage.productId) &&
      normalizeText(row.expectedProductId) !== normalizeText(parsedPage.productId)
    ) {
      rejectReasons.push("expected_product_id_mismatch");
    }
    if (normalizeLower(titleModel.fullNormalizedTitle) !== normalizeLower(pageProfile.titles.fullNormalizedTitle)) {
      rejectReasons.push("full_normalized_title_mismatch");
    }
    if (normalizeLower(titleModel.coreIngredientTitle) !== normalizeLower(pageProfile.titles.coreIngredientTitle)) {
      rejectReasons.push("core_ingredient_title_mismatch");
    }
    const expectedAccepted = scored.acceptable && !rejectReasons.includes("expected_product_id_mismatch");
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

  const evaluateCandidateUrlsForSource = async (row, candidateUrls, sourceFamily, fetchTrace, maxCandidates = 1) => {
    const titleModel = buildTitleModels(row.productName ?? row.title, row.brandName);
    const candidateScoreRows = [];
    let acceptedCandidateUrl = null;
    let acceptedProductId = null;
    let finalAcceptedCount = 0;
    let fetchedCandidateCount = 0;
    for (const url of candidateUrls.slice(0, maxCandidates)) {
      const readerUrl = `${READER_PREFIX}${url.replace(/^https?:\/\//i, "")}`;
      const fetched = await fetchText(readerUrl, `${sourceFamily}:${url}`, PAGE_TIMEOUT_MS);
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
      const scored = scoreCandidateWithReasons(row, titleModel, parsedPage, pageProfile);
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

  const summarizeSourceFamily = (row, sourceFamily, queriesTried, candidateUrlsFound, fetchTrace, evaluation, extra = {}) => {
    const expectedUrl = normalizeText(row.expectedUrl);
    const candidateRank = expectedUrl ? candidateUrlsFound.findIndex((url) => normalizeText(url) === expectedUrl) : -1;
    const relevantTrace = fetchTrace.filter((trace) => trace.sourceFamily === sourceFamily || !trace.sourceFamily);
    const sourceTrace = relevantTrace.filter((trace) => trace.sourceKind !== "candidate_page_fetch");
    const expectedInRawButNotEmitted =
      candidateUrlsFound.length === 0 &&
      sourceTrace.some((trace) => trace.rawHasPrUrl || trace.rawHasExpectedProductId);
    return {
      sourceFamily,
      queriesTried,
      candidateCount: candidateUrlsFound.length,
      candidateUrlsFound,
      candidateRankOfExpectedPage: candidateRank >= 0 ? candidateRank + 1 : null,
      expectedPageSeen: candidateRank >= 0,
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
      rawHasPrUrl: sourceTrace.some((trace) => trace.rawHasPrUrl),
      rawHasExpectedProductId: sourceTrace.some((trace) => trace.rawHasExpectedProductId),
      rawHasExpectedTitle: sourceTrace.some((trace) => trace.rawHasExpectedTitle),
      blockedOrCaptchaType: [...new Set(relevantTrace.map((trace) => trace.blockedOrCaptchaType ?? trace.blockerType).filter(Boolean))],
      topCandidateScores: evaluation.topCandidateScores,
      acceptedCandidateUrl: evaluation.acceptedCandidateUrl,
      acceptedProductId: evaluation.acceptedProductId,
      fetchTrace: relevantTrace,
      ...extra,
    };
  };

  const runGenericSourceSearch = async (row, sourceFamily, queries, options = {}) => {
    const {
      extractionMode = "current",
      cacheNamespace = sourceFamily,
      maxQueries = DISCOVERY_QUERY_LIMIT,
      maxCandidates = DISCOVERY_CANDIDATE_LIMIT,
      searchEngine = false,
    } = options;
    const fetchTrace = [];
    const candidateUrls = new Set();
    const queriesTried = [];
    for (const query of queries.filter(Boolean).slice(0, maxQueries)) {
      queriesTried.push({ family: sourceFamily, query });
      const matches = searchEngine
        ? await searchDuckDuckGoForIherb(query, { traceCollector: fetchTrace, row, cacheNamespace })
        : await searchIherbViaRjina(query, { traceCollector: fetchTrace, row, cacheNamespace, extractionMode });
      matches.slice(0, maxCandidates).forEach((url) => candidateUrls.add(url));
      if (candidateUrls.size >= maxCandidates) break;
      await sleep(60);
    }
    const evaluation = await evaluateCandidateUrlsForSource(row, [...candidateUrls], sourceFamily, fetchTrace);
    return summarizeSourceFamily(row, sourceFamily, queriesTried, [...candidateUrls], fetchTrace, evaluation);
  };

  const runIherbReaderSearchComparison = async (row, options = {}) => {
    const queries = expandQueryVariants(`${normalizeText(row.brandName)} ${buildTitleModels(row.productName ?? row.title, row.brandName).fullNormalizedTitle}`).slice(
      0,
      DISCOVERY_QUERY_LIMIT,
    );
    return runGenericSourceSearch(row, "iherb_reader_search", queries, {
      extractionMode: options.extractionMode ?? "current",
      cacheNamespace: options.cacheNamespace ?? "iherb_reader_search",
    });
  };

  const runBrandSpecificSourceComparison = async (row, options = {}) => {
    const queryMap = buildQueryFamilyMap(row).families;
    const orderedQueries = [
      ...queryMap.brand_plus_barcode,
      ...queryMap.brand_plus_active_strength,
      ...queryMap.brand_plus_normalized_title,
      ...queryMap.product_name_only,
      ...queryMap.sub_brand_family,
    ];
    return runGenericSourceSearch(row, "brand_specific_source_path", orderedQueries, {
      extractionMode: options.extractionMode ?? "current",
      cacheNamespace: options.cacheNamespace ?? "brand_specific_source_path",
    });
  };

  const runSearchEngineFallbackComparison = async (row, options = {}) => {
    const queryMap = buildQueryFamilyMap(row).families;
    const orderedQueries = [
      ...queryMap.brand_plus_barcode,
      ...queryMap.brand_plus_active_strength,
      ...queryMap.brand_plus_normalized_title,
      ...queryMap.sub_brand_family,
    ];
    return runGenericSourceSearch(row, "search_engine_site_fallback", orderedQueries, {
      cacheNamespace: options.cacheNamespace ?? "search_engine_site_fallback",
      maxQueries: DISCOVERY_FALLBACK_QUERY_LIMIT,
      searchEngine: true,
    });
  };

  const runSitemapSourceComparison = async (row) => {
    const titleModel = buildTitleModels(row.productName ?? row.title, row.brandName);
    if (!USE_SITEMAP) {
      return summarizeSourceFamily(
        row,
        "sitemap_source",
        [{ family: "sitemap_source", query: `${row.brandName} ${titleModel.coreIngredientTitle}` }],
        [],
        [],
        { fetchedCandidateCount: 0, finalAcceptedCount: 0, acceptedCandidateUrl: null, acceptedProductId: null, topCandidateScores: [] },
        { availability: "not_prebuilt_in_repo" },
      );
    }
    const scored = await findSitemapCandidateUrlsV2(row, titleModel);
    const candidateUrls = scored.map((entry) => entry.url);
    return summarizeSourceFamily(
      row,
      "sitemap_source",
      [{ family: "sitemap_source", query: `${row.brandName} ${titleModel.coreIngredientTitle}` }],
      candidateUrls,
      [],
      { fetchedCandidateCount: 0, finalAcceptedCount: 0, acceptedCandidateUrl: null, acceptedProductId: null, topCandidateScores: scored },
      { availability: "live_sitemap" },
    );
  };

  const runRepoCompositeComparison = async (row, options = {}) => {
    const extractionMode = options.extractionMode ?? "current";
    const queryMap = buildQueryFamilyMap(row).families;
    const fetchTrace = [];
    const candidateUrls = new Set();
    const queriesTried = [];
    const orderedFamilies = [
      ["brand_plus_barcode", queryMap.brand_plus_barcode],
      ["brand_plus_active_strength", queryMap.brand_plus_active_strength],
      ["brand_plus_normalized_title", queryMap.brand_plus_normalized_title],
      ["product_name_only", queryMap.product_name_only],
      ["sub_brand_family", queryMap.sub_brand_family],
    ];
    for (const [familyName, queries] of orderedFamilies) {
      for (const query of queries.slice(0, DISCOVERY_QUERY_LIMIT)) {
        queriesTried.push({ family: familyName, query });
        const directMatches = await searchIherbViaRjina(query, {
          traceCollector: fetchTrace,
          row,
          cacheNamespace: options.cacheNamespace ?? "repo_composite_v2",
          extractionMode,
        });
        directMatches.slice(0, DISCOVERY_CANDIDATE_LIMIT).forEach((url) => candidateUrls.add(url));
        if (candidateUrls.size === 0) {
          const fallbackMatches = await searchDuckDuckGoForIherb(query, {
            traceCollector: fetchTrace,
            row,
            cacheNamespace: options.cacheNamespace ?? "repo_composite_v2",
          });
          fallbackMatches.slice(0, DISCOVERY_CANDIDATE_LIMIT).forEach((url) => candidateUrls.add(url));
        }
        if (candidateUrls.size >= DISCOVERY_CANDIDATE_LIMIT || queriesTried.length >= DISCOVERY_QUERY_LIMIT * 2) break;
        await sleep(60);
      }
      if (candidateUrls.size >= DISCOVERY_CANDIDATE_LIMIT || queriesTried.length >= DISCOVERY_QUERY_LIMIT * 2) break;
    }
    const evaluation = await evaluateCandidateUrlsForSource(row, [...candidateUrls], "repo_composite_v2", fetchTrace);
    return summarizeSourceFamily(row, "repo_composite_v2", queriesTried, [...candidateUrls], fetchTrace, evaluation);
  };

  const buildSourceFamilySummary = (rows) => {
    const families = {};
    for (const row of rows) {
      for (const source of row.sourceComparisons) {
        if (!families[source.sourceFamily]) {
          families[source.sourceFamily] = {
            attemptedRows: 0,
            expectedPageSeenRows: 0,
            finalAcceptedRows: 0,
            candidateExtractionCount: 0,
            expectedInRawButNotEmittedRows: 0,
            http429: 0,
            aborted: 0,
            blockedOrCaptchaDetected: 0,
            fetchSuccess: 0,
          };
        }
        const bucket = families[source.sourceFamily];
        bucket.attemptedRows += 1;
        bucket.expectedPageSeenRows += source.expectedPageSeen ? 1 : 0;
        bucket.finalAcceptedRows += source.finalAcceptedCount > 0 ? 1 : 0;
        bucket.candidateExtractionCount += source.candidateExtractionCount ?? 0;
        bucket.expectedInRawButNotEmittedRows += source.expectedInRawButNotEmitted ? 1 : 0;
        bucket.http429 += source.http429 ?? 0;
        bucket.aborted += source.aborted ?? 0;
        bucket.blockedOrCaptchaDetected += source.blockedOrCaptchaDetected ?? 0;
        bucket.fetchSuccess += source.fetchSuccess ?? 0;
      }
    }
    return families;
  };

  const buildDiscoverySourceFamilyComparisonReport = async ({ rows, waveId }) => {
    resetSearchCache();
    setFetchAdapterMode("curl_reader");
    setWavePass(waveId);
    const healthStart = snapshotExecutionHealth();
    const comparisonRows = [];
    for (const row of rows) {
      console.error(`[week3_phase1] source_compare ${row.brandName} | ${row.productName}`);
      const expectedPageTrace = await traceExpectedPage(row);
      const sourceComparisons = [
        await runIherbReaderSearchComparison(row, { extractionMode: "current", cacheNamespace: "iherb_reader_search" }),
        await runRepoCompositeComparison(row, { extractionMode: "current", cacheNamespace: "repo_composite_v2" }),
        await runSearchEngineFallbackComparison(row, { cacheNamespace: "search_engine_site_fallback" }),
        await runSitemapSourceComparison(row),
        await runBrandSpecificSourceComparison(row, { extractionMode: "current", cacheNamespace: "brand_specific_source_path" }),
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
      rows: comparisonRows,
      summary: {
        attempted: comparisonRows.length,
        sourceFamilies: buildSourceFamilySummary(comparisonRows),
      },
      executionHealth: diffExecutionHealth(healthStart),
    };
  };

  const runQueryFamilyOnSource = async (row, sourceFamily, queryFamily, queries) => {
    const fetchTrace = [];
    const candidateUrls = new Set();
    const queriesTried = [];
    const limitedQueries = queries.filter(Boolean).slice(0, sourceFamily === "search_engine_site_fallback" ? DISCOVERY_FALLBACK_QUERY_LIMIT : DISCOVERY_QUERY_LIMIT);
    for (const query of limitedQueries) {
      queriesTried.push({ family: queryFamily, query });
      const matches =
        sourceFamily === "search_engine_site_fallback"
          ? await searchDuckDuckGoForIherb(query, {
              traceCollector: fetchTrace,
              row,
              cacheNamespace: `query_family:${sourceFamily}:${queryFamily}`,
            })
          : await searchIherbViaRjina(query, {
              traceCollector: fetchTrace,
              row,
              cacheNamespace: `query_family:${sourceFamily}:${queryFamily}`,
              extractionMode: "current",
            });
      matches.slice(0, DISCOVERY_CANDIDATE_LIMIT).forEach((url) => candidateUrls.add(url));
      if (candidateUrls.size >= DISCOVERY_CANDIDATE_LIMIT) break;
      await sleep(60);
    }
    const evaluation = await evaluateCandidateUrlsForSource(row, [...candidateUrls], sourceFamily, fetchTrace);
    const expectedProductId = normalizeText(row.expectedProductId);
    const topAcceptedMismatch =
      evaluation.acceptedProductId &&
      expectedProductId &&
      normalizeText(evaluation.acceptedProductId) !== expectedProductId;
    return {
      rowId: row.candidateId,
      brandName: row.brandName,
      productName: row.productName,
      sourceFamilyUsed: sourceFamily,
      queryFamily,
      queriesTried,
      candidateCount: candidateUrls.size,
      candidateUrlsFound: [...candidateUrls],
      expectedPageVisibility:
        normalizeText(row.expectedUrl) &&
        [...candidateUrls].some((candidate) => normalizeText(candidate) === normalizeText(row.expectedUrl)),
      bestRankOfExpectedPage:
        normalizeText(row.expectedUrl)
          ? (() => {
              const idx = [...candidateUrls].findIndex((candidate) => normalizeText(candidate) === normalizeText(row.expectedUrl));
              return idx >= 0 ? idx + 1 : null;
            })()
          : null,
      fetchedCandidateCount: evaluation.fetchedCandidateCount,
      finalAcceptedCount: evaluation.finalAcceptedCount,
      topCandidateScores: evaluation.topCandidateScores,
      falsePositive: Boolean(topAcceptedMismatch),
      fetchSuccess: fetchTrace.filter((trace) => trace.httpStatus >= 200 && trace.httpStatus < 400).length,
      fromCache: fetchTrace.filter((trace) => trace.fromCache).length,
      http429: fetchTrace.filter((trace) => trace.httpStatus === 429 || trace.blockerType === "429_rate_limit").length,
      aborted: fetchTrace.filter((trace) => trace.blockerType === "abort_timeout").length,
      blockedOrCaptchaDetected: fetchTrace.filter((trace) => trace.blockedOrCaptchaDetected).length,
      sourceAdapter: [...new Set(fetchTrace.map((trace) => trace.sourceAdapter).filter(Boolean))],
      expectedInRawButNotEmitted:
        candidateUrls.size === 0 && fetchTrace.some((trace) => trace.rawHasPrUrl || trace.rawHasExpectedProductId),
      fetchTrace,
    };
  };

  const summarizeQueryFamilyRows = (rows, sourceFamily) => {
    const families = {};
    for (const row of rows) {
      if (!families[row.queryFamily]) {
        families[row.queryFamily] = {
          sourceFamilyUsed: sourceFamily,
          attemptedRows: 0,
          hitRows: 0,
          expectedPageVisibleRows: 0,
          falsePositiveRows: 0,
          bestRankOfExpectedPage: null,
          brandsWhereUseful: new Set(),
          brandsWhereNoisy: new Set(),
          http429: 0,
          aborted: 0,
          blockedOrCaptchaDetected: 0,
        };
      }
      const bucket = families[row.queryFamily];
      bucket.attemptedRows += 1;
      bucket.hitRows += row.candidateCount > 0 ? 1 : 0;
      bucket.expectedPageVisibleRows += row.expectedPageVisibility ? 1 : 0;
      bucket.falsePositiveRows += row.falsePositive ? 1 : 0;
      if (row.expectedPageVisibility) {
        bucket.brandsWhereUseful.add(row.brandName);
        bucket.bestRankOfExpectedPage =
          bucket.bestRankOfExpectedPage == null
            ? row.bestRankOfExpectedPage
            : Math.min(bucket.bestRankOfExpectedPage, row.bestRankOfExpectedPage ?? Number.POSITIVE_INFINITY);
      }
      if (row.falsePositive) bucket.brandsWhereNoisy.add(row.brandName);
      bucket.http429 += row.http429;
      bucket.aborted += row.aborted;
      bucket.blockedOrCaptchaDetected += row.blockedOrCaptchaDetected;
    }
    return Object.fromEntries(
      Object.entries(families).map(([queryFamily, bucket]) => [
        queryFamily,
        {
          sourceFamilyUsed: sourceFamily,
          hitRate: bucket.attemptedRows > 0 ? Number((bucket.hitRows / bucket.attemptedRows).toFixed(3)) : 0,
          expectedPageVisibility:
            bucket.attemptedRows > 0 ? Number((bucket.expectedPageVisibleRows / bucket.attemptedRows).toFixed(3)) : 0,
          falsePositiveRisk:
            bucket.attemptedRows > 0 ? Number((bucket.falsePositiveRows / bucket.attemptedRows).toFixed(3)) : 0,
          bestRankOfExpectedPage: bucket.bestRankOfExpectedPage,
          brandsWhereUseful: [...bucket.brandsWhereUseful].sort(),
          brandsWhereNoisy: [...bucket.brandsWhereNoisy].sort(),
          hitRows: bucket.hitRows,
          expectedPageVisibleRows: bucket.expectedPageVisibleRows,
          falsePositiveRows: bucket.falsePositiveRows,
          http429: bucket.http429,
          aborted: bucket.aborted,
          blockedOrCaptchaDetected: bucket.blockedOrCaptchaDetected,
        },
      ]),
    );
  };

  const buildDiscoveryQueryFamilyComparisonReport = async ({ rows, waveId, primarySourceFamily = "iherb_reader_search" }) => {
    resetSearchCache();
    setFetchAdapterMode("curl_reader");
    setWavePass(waveId);
    const healthStart = snapshotExecutionHealth();
    const familiesBySource = {};
    const sourceOrder = [primarySourceFamily];
    const runForSource = async (sourceFamily) => {
      const perRow = [];
      for (const row of rows) {
        console.error(`[week3_phase1] query_compare ${sourceFamily} | ${row.brandName} | ${row.productName}`);
        const queryMap = buildQueryFamilyMap(row).families;
        for (const [queryFamily, queries] of Object.entries(queryMap)) {
          perRow.push(await runQueryFamilyOnSource(row, sourceFamily, queryFamily, queries));
        }
      }
      familiesBySource[sourceFamily] = {
        sourceFamily,
        rows: perRow,
        families: summarizeQueryFamilyRows(perRow, sourceFamily),
      };
    };
    await runForSource(primarySourceFamily);
    const primaryAllZero = Object.values(familiesBySource[primarySourceFamily].families).every(
      (family) => Number(family.expectedPageVisibility ?? 0) === 0,
    );
    if (primaryAllZero) {
      sourceOrder.push("search_engine_site_fallback");
      await runForSource("search_engine_site_fallback");
    }
    return {
      generatedAt: new Date().toISOString(),
      waveId,
      sourceFamilies: sourceOrder.map((sourceFamily) => familiesBySource[sourceFamily]),
      primarySourceFamilyUsed: primarySourceFamily,
      secondarySourceFamilyUsed: sourceOrder[1] ?? null,
      executionHealth: diffExecutionHealth(healthStart),
    };
  };

  const chooseBestQueryFamily = (queryComparisonReport) => {
    const candidates = [];
    for (const sourceEntry of queryComparisonReport.sourceFamilies ?? []) {
      for (const [queryFamily, summary] of Object.entries(sourceEntry.families ?? {})) {
        candidates.push({
          sourceFamily: sourceEntry.sourceFamily,
          queryFamily,
          expectedPageVisibility: Number(summary.expectedPageVisibility ?? 0),
          falsePositiveRisk: Number(summary.falsePositiveRisk ?? 0),
          hitRate: Number(summary.hitRate ?? 0),
          noise: Number(summary.http429 ?? 0) + Number(summary.aborted ?? 0) + Number(summary.blockedOrCaptchaDetected ?? 0),
        });
      }
    }
    candidates.sort((left, right) =>
      right.expectedPageVisibility - left.expectedPageVisibility ||
      left.falsePositiveRisk - right.falsePositiveRisk ||
      right.hitRate - left.hitRate ||
      left.noise - right.noise ||
      left.sourceFamily.localeCompare(right.sourceFamily) ||
      left.queryFamily.localeCompare(right.queryFamily),
    );
    return candidates[0] ?? null;
  };

  const chooseDiscoveryPath = (sourceComparisonReport, queryComparisonReport) => {
    const sourceEntries = Object.entries(sourceComparisonReport.summary.sourceFamilies ?? {}).map(([sourceFamily, summary]) => ({
      sourceFamily,
      ...summary,
    }));
    sourceEntries.sort((left, right) =>
      Number(right.expectedInRawButNotEmittedRows ?? 0) - Number(left.expectedInRawButNotEmittedRows ?? 0) ||
      Number(right.expectedPageSeenRows ?? 0) - Number(left.expectedPageSeenRows ?? 0) ||
      (Number(left.http429 ?? 0) + Number(left.aborted ?? 0) + Number(left.blockedOrCaptchaDetected ?? 0)) -
        (Number(right.http429 ?? 0) + Number(right.aborted ?? 0) + Number(right.blockedOrCaptchaDetected ?? 0)) ||
      left.sourceFamily.localeCompare(right.sourceFamily),
    );
    const bestQueryFamily = chooseBestQueryFamily(queryComparisonReport);
    const topSource = sourceEntries[0] ?? null;
    if (topSource?.sourceFamily === "iherb_reader_search" && Number(topSource.expectedInRawButNotEmittedRows ?? 0) > 0) {
      return {
        pathKind: "source_ordering_candidate_emission_rewrite",
        sourceFamily: "iherb_reader_search",
        queryFamily: bestQueryFamily?.queryFamily ?? "brand_plus_barcode",
        extractionMode: "aggressive",
        rationale: {
          sourceFamily: "iherb_reader_search",
          expectedInRawButNotEmittedRows: topSource.expectedInRawButNotEmittedRows,
          bestQueryFamily,
        },
      };
    }
    if (topSource?.sourceFamily === "repo_composite_v2" && Number(topSource.expectedPageSeenRows ?? 0) > 0) {
      return {
        pathKind: "source_selection_reorder_using_repo_composite",
        sourceFamily: "repo_composite_v2",
        queryFamily: bestQueryFamily?.queryFamily ?? "brand_plus_barcode",
        extractionMode: "current",
        rationale: {
          topSource,
          bestQueryFamily,
        },
      };
    }
    if (bestQueryFamily) {
      return {
        pathKind:
          bestQueryFamily.sourceFamily === "search_engine_site_fallback"
            ? "search_engine_fallback_discovery_only"
            : "brand_routed_query_family",
        sourceFamily: bestQueryFamily.sourceFamily,
        queryFamily: bestQueryFamily.queryFamily,
        extractionMode: bestQueryFamily.sourceFamily === "iherb_reader_search" ? "aggressive" : "current",
        rationale: {
          bestQueryFamily,
          topSource,
        },
      };
    }
    return {
      pathKind: "no_safe_candidate_path_found",
      sourceFamily: "iherb_reader_search",
      queryFamily: "brand_plus_barcode",
      extractionMode: "aggressive",
      rationale: { topSource },
    };
  };

  const runDiscoveryPathProof = async ({ rows, waveId, sourceComparisonReport, queryComparisonReport }) => {
    resetSearchCache();
    setFetchAdapterMode("curl_reader");
    setWavePass(waveId);
    const healthStart = snapshotExecutionHealth();
    const chosenPath = chooseDiscoveryPath(sourceComparisonReport, queryComparisonReport);
    const proofRows = [];
    for (const row of rows) {
      console.error(`[week3_phase1] path_proof ${chosenPath.sourceFamily} ${chosenPath.queryFamily} | ${row.brandName} | ${row.productName}`);
      const queryMap = buildQueryFamilyMap(row).families;
      const queries = queryMap[chosenPath.queryFamily] ?? [];
      const result =
        chosenPath.sourceFamily === "search_engine_site_fallback"
          ? await runQueryFamilyOnSource(row, "search_engine_site_fallback", chosenPath.queryFamily, queries)
          : chosenPath.sourceFamily === "repo_composite_v2"
            ? await runRepoCompositeComparison(row, {
                extractionMode: chosenPath.extractionMode,
                cacheNamespace: `path_proof:${chosenPath.sourceFamily}:${chosenPath.queryFamily}`,
              })
          : await runGenericSourceSearch(row, chosenPath.sourceFamily, queries, {
              extractionMode: chosenPath.extractionMode,
              cacheNamespace: `path_proof:${chosenPath.sourceFamily}:${chosenPath.queryFamily}`,
            });
      const normalizedResult =
        chosenPath.sourceFamily === "search_engine_site_fallback"
          ? result
          : {
              rowId: row.candidateId,
              brandName: row.brandName,
              productName: row.productName,
              sourceFamilyUsed: chosenPath.sourceFamily,
              queryFamily: chosenPath.queryFamily,
              queriesTried: result.queriesTried,
              candidateCount: result.candidateCount,
              candidateUrlsFound: result.candidateUrlsFound,
              expectedPageVisibility: result.expectedPageSeen,
              bestRankOfExpectedPage: result.candidateRankOfExpectedPage,
              fetchedCandidateCount: result.fetchedCandidateCount,
              finalAcceptedCount: result.finalAcceptedCount,
              topCandidateScores: result.topCandidateScores,
              falsePositive:
                Boolean(result.acceptedProductId) &&
                normalizeText(result.acceptedProductId) !== normalizeText(row.expectedProductId) &&
                result.finalAcceptedCount > 0,
              fetchSuccess: result.fetchSuccess,
              fromCache: result.fromCache,
              http429: result.http429,
              aborted: result.aborted,
              blockedOrCaptchaDetected: result.blockedOrCaptchaDetected,
              sourceAdapter: result.sourceAdapter,
              expectedInRawButNotEmitted: result.expectedInRawButNotEmitted,
              fetchTrace: result.fetchTrace,
            };
      proofRows.push(normalizedResult);
    }
    const discoveryHits = proofRows.filter((row) => row.expectedPageVisibility).length;
    const falsePositiveRows = proofRows.filter((row) => row.falsePositive).length;
    const expectedPageVisibility = proofRows.length > 0 ? Number((discoveryHits / proofRows.length).toFixed(3)) : 0;
    const falsePositiveRisk = proofRows.length > 0 ? Number((falsePositiveRows / proofRows.length).toFixed(3)) : 0;
    const currentSourceFamily = sourceComparisonReport.summary.sourceFamilies?.[chosenPath.sourceFamily];
    const currentVisibility =
      currentSourceFamily && Number(currentSourceFamily.attemptedRows ?? 0) > 0
        ? Number((Number(currentSourceFamily.expectedPageSeenRows ?? 0) / Number(currentSourceFamily.attemptedRows ?? 1)).toFixed(3))
        : 0;
    const proven = discoveryHits > 0 && expectedPageVisibility > currentVisibility && falsePositiveRisk === 0;
    return {
      generatedAt: new Date().toISOString(),
      waveId,
      chosenPath,
      rows: proofRows,
      summary: {
        attempted: proofRows.length,
        discoveryHits,
        expectedPageVisibility,
        falsePositiveRisk,
        currentExpectedPageVisibility: currentVisibility,
        noBaselineDelta: true,
        noMergeStateChange: true,
        classification: proven ? "retargetable" : "exhausted",
        proven,
      },
      executionHealth: diffExecutionHealth(healthStart),
    };
  };

  const syncCurrentAndHistory = async ({
    manifest,
    result,
    currentManifestPath,
    currentResultPath,
    historyManifestPath,
    historyResultPath,
    activeCanonicalDir,
    historyCanonicalDir,
    markdownCopies = [],
    currentJsonCopies = [],
  }) => {
    await writeJson(historyManifestPath, manifest);
    await writeJson(historyResultPath, result);
    await copyFile(historyManifestPath, path.join(historyCanonicalDir, path.basename(historyManifestPath)));
    await copyFile(historyResultPath, path.join(historyCanonicalDir, path.basename(historyResultPath)));
    await writeJson(currentManifestPath, manifest);
    await writeJson(currentResultPath, result);
    await writeJson(path.join(activeCanonicalDir, "wave_manifest_current.json"), manifest);
    await writeJson(path.join(activeCanonicalDir, "wave_result_current.json"), result);
    for (const { sourcePath, canonicalName } of markdownCopies) {
      if (await fileExists(sourcePath)) {
        await copyFile(sourcePath, path.join(activeCanonicalDir, canonicalName));
      }
    }
    for (const { sourcePath, canonicalName } of currentJsonCopies) {
      if (await fileExists(sourcePath)) {
        await copyFile(sourcePath, path.join(activeCanonicalDir, canonicalName));
      }
    }
  };

  return {
    snapshotExecutionHealth,
    diffExecutionHealth,
    setFetchAdapterMode,
    setWavePass,
    resetSearchCache,
    buildDiscoverySourceFamilyComparisonReport,
    buildDiscoveryQueryFamilyComparisonReport,
    buildPositiveControlDebugSet,
    buildQueryFamilyMap,
    runDiscoveryPathProof,
    syncCurrentAndHistory,
  };
};
