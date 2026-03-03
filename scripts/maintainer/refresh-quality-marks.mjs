#!/usr/bin/env node
/* eslint-disable no-console */
import fs from "node:fs/promises";
import path from "node:path";
import crypto from "node:crypto";

const ROOT = process.cwd();
const args = process.argv.slice(2);
const getArg = (name, fallback = null) => {
  const flag = `--${name}`;
  const idx = args.indexOf(flag);
  if (idx === -1 || idx + 1 >= args.length) return fallback;
  return args[idx + 1];
};

const scope = String(getArg("scope", "top53")).trim().toLowerCase();
const nightlyDir = getArg(
  "nightly-dir",
  path.join(ROOT, "output", "v1.6.14-new-top100-nightly-20260302T103930Z"),
);
const impactPath = getArg(
  "impact-json",
  path.join(nightlyDir, "next_phase", "new_top100_product_level_ux_impact.json"),
);
const outputDir = getArg("out-dir", path.join(ROOT, "output", "quality_marks"));
const cachePath = getArg("cache-json", path.join(outputDir, "quality_mark_cache.json"));
const auditPath = getArg("audit-json", path.join(outputDir, "quality_mark_audit.json"));
const ttlDays = Math.max(1, Number(getArg("ttl-days", "30")) || 30);

const normalize = (value) =>
  String(value ?? "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");

const nowIso = () => new Date().toISOString();

const buildKey = (row) => {
  const sourceType = normalize(row.sourceType || "unknown");
  const identityType = normalize((row.identityKey || "").split(":")[0] || "unknown");
  const identityValue = normalize((row.identityKey || "").split(":").slice(1).join(":") || row.barcode_gtin14 || "unknown");
  const brand = normalize(row.brandName || "unknown");
  const product = normalize(row.productName || "unknown");
  return `${sourceType}:${identityType}:${identityValue}:${brand}:${product}`;
};

const makeExpiresAt = () => new Date(Date.now() + ttlDays * 24 * 60 * 60 * 1000).toISOString();

const SEARCH_PATTERNS = [
  { label: "USP Verified", re: /\busp\b(?:\s*verified)?/i },
  { label: "NSF", re: /\bnsf\b(?:\s*certified(?:\s*for\s*sport)?)?/i },
  { label: "Informed Choice", re: /\binformed\s*choice\b/i },
  { label: "Informed Sport", re: /\binformed\s*sport\b/i },
  { label: "BSCG", re: /\bbscg\b/i },
  { label: "ConsumerLab", re: /\bconsumerlab\b/i },
];

const sanitizeHtml = (html) =>
  html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();

const fetchHtml = async (url, timeoutMs = 8000) => {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, {
      method: "GET",
      signal: controller.signal,
      headers: {
        "user-agent":
          "Mozilla/5.0 (Macintosh; Intel Mac OS X 14_0) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36",
        accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
      },
    });
    if (!response.ok) return { ok: false, html: null, error: `http_${response.status}` };
    const html = await response.text();
    return { ok: true, html, error: null };
  } catch (error) {
    return { ok: false, html: null, error: error instanceof Error ? error.message : String(error) };
  } finally {
    clearTimeout(timer);
  }
};

const buildSources = (row) => {
  const brand = String(row.brandName ?? "").trim();
  const product = String(row.productName ?? "").trim();
  const query = encodeURIComponent(`${brand} ${product} third-party tested USP NSF Informed Choice BSCG ConsumerLab`);
  const brandDomain = normalize(brand).replace(/_/g, "");
  return [
    {
      url: `https://duckduckgo.com/html/?q=${query}+site%3A${brandDomain}.com`,
      sourceType: "brand_official",
    },
    {
      url: `https://duckduckgo.com/html/?q=${query}+site%3Aamazon.com`,
      sourceType: "retailer_marketplace",
    },
    {
      url: `https://duckduckgo.com/html/?q=${query}+site%3Aiherb.com`,
      sourceType: "retailer_marketplace",
    },
    {
      url: `https://duckduckgo.com/html/?q=${query}+site%3Awell.ca`,
      sourceType: "retailer_marketplace",
    },
  ];
};

const detectFromHtml = (html, source) => {
  const isSearchOnlySource = /duckduckgo\.com\/html\/\?q=/i.test(source.url);
  if (!html) {
    return {
      status: "unknown",
      checked: false,
      confidence: null,
      confidenceBucket: "low",
      evidenceRef: null,
      evidenceType: null,
      checkedMode: isSearchOnlySource ? "search_only" : "page_fetch",
      pagesFetchedCount: isSearchOnlySource ? 0 : 1,
      searchPagesFetchedCount: isSearchOnlySource ? 1 : 0,
      note: "No source HTML returned.",
    };
  }
  const text = sanitizeHtml(html);
  if (!text) {
    return {
      status: "unknown",
      checked: false,
      confidence: null,
      confidenceBucket: "low",
      evidenceRef: null,
      evidenceType: null,
      checkedMode: isSearchOnlySource ? "search_only" : "page_fetch",
      pagesFetchedCount: isSearchOnlySource ? 0 : 1,
      searchPagesFetchedCount: isSearchOnlySource ? 1 : 0,
      note: "Source content empty after sanitization.",
    };
  }
  if (isSearchOnlySource) {
    return {
      status: "unknown",
      checked: true,
      confidence: 0.55,
      confidenceBucket: "low",
      evidenceRef: source.url,
      evidenceType: "search",
      checkedMode: "search_only",
      pagesFetchedCount: 0,
      searchPagesFetchedCount: 1,
      note: "Search-only evidence; no verified mark page/image found yet.",
    };
  }
  for (const item of SEARCH_PATTERNS) {
    const match = text.match(item.re);
    if (!match || typeof match.index !== "number") continue;
    const left = Math.max(0, match.index - 80);
    const right = Math.min(text.length, match.index + 80);
    const span = text.slice(left, right);
    if (!/\blogo\b|\bseal\b|\bicon\b|\bcertified\b|\btested\b|\bquality\b/i.test(span)) {
      return {
        status: "unknown",
        checked: true,
        confidence: 0.55,
        confidenceBucket: "low",
        evidenceRef: source.url,
        evidenceType: "page",
        checkedMode: "page_fetch",
        pagesFetchedCount: 1,
        searchPagesFetchedCount: 0,
        note: `Weak mention found for ${item.label}.`,
      };
    }
    return {
      status: "detected",
      checked: true,
      confidence: 0.92,
      confidenceBucket: "high",
      evidenceRef: source.url,
      evidenceType: "page",
      checkedMode: "page_fetch",
      pagesFetchedCount: 1,
      searchPagesFetchedCount: 0,
      note: `Detected ${item.label}.`,
    };
  }
  const confidence = source.sourceType === "brand_official" ? 0.86 : 0.82;
  return {
    status: "unknown",
    checked: true,
    confidence,
    confidenceBucket: confidence >= 0.85 ? "high" : "medium",
    evidenceRef: source.url,
    evidenceType: "page",
    checkedMode: "page_fetch",
    pagesFetchedCount: 1,
    searchPagesFetchedCount: 0,
    note: "Checked source with no confident quality mark detected.",
  };
};

const readJson = async (filePath) => JSON.parse(await fs.readFile(filePath, "utf8"));

const main = async () => {
  await fs.mkdir(path.dirname(cachePath), { recursive: true });
  const impact = await readJson(impactPath);
  const rawProducts = Array.isArray(impact?.products) ? impact.products : [];
  const top53Scoped = rawProducts.filter((row) => row?.executionScope === "top53");
  const products =
    scope === "top53"
      ? (top53Scoped.length > 0 ? top53Scoped : rawProducts.slice(0, 53))
      : rawProducts;
  const entries = {};
  const rows = [];
  for (const row of products.slice(0, scope === "top53" ? 53 : 120)) {
    const key = buildKey(row);
    const sources = buildSources(row);
    const tried = [];
    let final = {
      status: "unknown",
      checked: false,
      confidence: null,
      confidenceBucket: "low",
      evidenceRef: null,
      evidenceType: null,
      checkedMode: "search_only",
      pagesFetchedCount: 0,
      searchPagesFetchedCount: 0,
      note: "No source tried.",
      error: null,
    };
    let pageFetchCount = 0;
    let searchFetchCount = 0;
    let detectedOnPage = false;
    for (const source of sources) {
      tried.push(source.url);
      const fetched = await fetchHtml(source.url);
      if (!fetched.ok) {
        final.error = fetched.error;
        continue;
      }
      const detected = detectFromHtml(fetched.html, source);
      pageFetchCount += detected.pagesFetchedCount || 0;
      searchFetchCount += detected.searchPagesFetchedCount || 0;
      final = { ...detected, error: null };
      if (detected.status === "detected" && detected.checkedMode === "page_fetch") {
        detectedOnPage = true;
        break;
      }
    }
    if (!detectedOnPage) {
      if (pageFetchCount >= 2) {
        final = {
          ...final,
          status: "not_detected",
          checked: true,
          confidence: final.confidence ?? 0.82,
          confidenceBucket: final.confidenceBucket ?? "medium",
          note: "Checked >=2 page sources with no confident quality mark detected.",
          checkedMode: "page_fetch",
          evidenceType: final.evidenceType === "page" ? "page" : null,
        };
      } else if (searchFetchCount > 0 && pageFetchCount === 0) {
        final = {
          ...final,
          status: "unknown",
          checked: true,
          confidence: 0.55,
          confidenceBucket: "low",
          note: "Search-only evidence; no verified mark page/image found yet.",
          checkedMode: "search_only",
          evidenceType: "search",
        };
      }
    }

    const checkedAt = nowIso();
    const entry = {
      key,
      status: final.status,
      checked: final.checked,
      confidence: final.confidence,
      confidenceBucket: final.confidenceBucket,
      evidenceRef: final.evidenceRef,
      evidenceType: final.evidenceType,
      checkedMode: final.checkedMode,
      pagesFetchedCount: pageFetchCount,
      searchPagesFetchedCount: searchFetchCount,
      sourcesTried: tried,
      sourcePriority: ["brand_official", "retailer_marketplace", "retailer_other"],
      checkedAt,
      expiresAt: makeExpiresAt(),
      error: final.error,
    };
    entries[key] = entry;
    rows.push({
      brandName: row?.brandName ?? null,
      productName: row?.productName ?? null,
      barcode_gtin14: row?.barcode_gtin14 ?? null,
      identityKey: row?.identityKey ?? null,
      ...entry,
    });
  }

  const cachePayload = {
    schemaVersion: "quality_mark_cache.v1",
    ttlDays,
    updatedAt: nowIso(),
    entryCount: Object.keys(entries).length,
    entries,
  };
  await fs.writeFile(cachePath, `${JSON.stringify(cachePayload, null, 2)}\n`, "utf8");

  const auditPayload = {
    schemaVersion: "quality_mark_audit.v1",
    generatedAt: nowIso(),
    cachePath,
    cacheSha256: crypto.createHash("sha256").update(JSON.stringify(cachePayload)).digest("hex"),
    rows,
  };
  await fs.writeFile(auditPath, `${JSON.stringify(auditPayload, null, 2)}\n`, "utf8");

  console.log(
    JSON.stringify(
      {
        ok: true,
        scope,
        processed: rows.length,
        cachePath,
        auditPath,
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
