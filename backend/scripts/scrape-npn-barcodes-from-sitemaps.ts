import fs from "node:fs";
import path from "node:path";

import { normalizeBarcodeInput } from "../src/barcode.js";

type PairRow = {
  domain: string;
  npn: string;
  barcode: string;
  url: string;
  extractMode: string;
  evidenceLevel: "high" | "medium" | "low";
  evidenceScore: number;
  tokenDistance: number | null;
  brandOverlap: number;
  productOverlap: number;
  requiredBrandOverlap: number;
  requiredProductOverlap: number;
  contextPass: boolean;
};

type DomainStats = {
  domain: string;
  sitemapsTried: number;
  sitemapsRead: number;
  pagesQueued: number;
  pagesScanned: number;
  pagesFetchFailed: number;
  pagesWithNpn: number;
  pagesWithBarcode: number;
  pagesWithPairs: number;
  pairCountRaw: number;
  pairCountDedup: number;
  pairCount: number;
  npnCount: number;
  avgFetchMs: number;
  errRate: number;
  npnFoundRate: number;
  barcodeFoundRate: number;
  npnAndBarcodeSamePageRate: number;
  yieldPer1000Urls: number;
};

type AllowlistContext = {
  npn: string;
  brandName: string | null;
  productName: string | null;
  productType: string | null;
  category: string | null;
  brandTokens: string[];
  productTokens: string[];
};

type AllowlistLoadResult = {
  npnSet: Set<string>;
  contextByNpn: Map<string, AllowlistContext>;
};

const args = process.argv.slice(2);
const hasFlag = (flag: string): boolean => args.includes(`--${flag}`);
const getArg = (flag: string): string | null => {
  const idx = args.indexOf(`--${flag}`);
  if (idx === -1) return null;
  return args[idx + 1] ?? null;
};

const asNumber = (value: string | null, fallback: number): number => {
  if (!value) return fallback;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
};

const timeoutMs = Math.max(2500, asNumber(getArg("timeout-ms"), 12000));
const delayMs = Math.max(0, asNumber(getArg("delay-ms"), 40));
const maxSitemapsPerDomain = Math.max(3, asNumber(getArg("max-sitemaps-per-domain"), 20));
const maxPagesPerDomain = Math.max(20, asNumber(getArg("max-pages-per-domain"), 450));
const maxUrlsPerSitemap = Math.max(100, asNumber(getArg("max-urls-per-sitemap"), 5000));
const concurrency = Math.max(1, Math.min(20, asNumber(getArg("concurrency"), 8)));
const domainsFile = getArg("domains-file");
const singleDomain = getArg("domain");
const outDirArg = getArg("out-dir");
const npnAllowlistFile = getArg("npn-allowlist-file");
const strictPairing = hasFlag("strict-pairing");
const allowLowValuePages = hasFlag("allow-low-value-pages");
const minEvidenceLevelRaw = (getArg("min-evidence-level") ?? "low").toLowerCase();

const USER_AGENT =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36";

const defaultDomains = [
  "goodhealthmarttoronto.com",
  "goodnaturedhealth.ca",
  "myvivastore.com",
  "shop.downtoearthnaturalfoods.ca",
  "nhddirect.com",
  "naturallyhealthysupplements.com",
  "gohealthstore.ca",
  "shopsupplements.ca",
  "nutritionpharmacist.com",
  "shop.georgianhealthfoods.ca",
  "pandoraspantry.ca",
  "herbahealth.ca",
  "nutritionhouse.com",
  "avivahealth.com",
  "bodyenergyclub.com",
  "purenaturenutrition.com",
  "westcoastnaturals.com",
  "vitasave.ca",
  "landish.ca",
  "nationalnutrition.ca",
  "supplementsource.ca",
  "healthyplanetcanada.com",
  "well.ca",
  "canadianvitaminshop.com",
  "organika.com",
  "newrootsherbal.com",
  "jamiesonvitamins.com",
  "webbernaturals.com",
  "canprev.ca",
  "genuinehealth.ca",
  "harmonicarts.ca",
  "omegaalpha.ca",
  "nowfoods.ca",
  "londondrugs.com",
  "foodsmiths.com",
  "molloys.ca",
  "mychoicenaturally.ca",
  "globalhealing.ca",
  "healthology.ca",
  "vitatree.com",
  "herbalmagic.ca",
  "medicosante.ca",
  "celebratevitamins.ca",
  "homegrownfoods.ca",
  "beingwell.com",
  "sopureproducts.ca",
  "naturelion.ca",
  "polarbearhealth.com",
  "certifiednaturals.ca",
  "bodycrafters.ca",
  "epproductscanada.com",
];

type EvidenceLevel = "high" | "medium" | "low";
const EVIDENCE_RANK: Record<EvidenceLevel, number> = { low: 1, medium: 2, high: 3 };
const parseEvidenceLevel = (raw: string): EvidenceLevel => {
  if (raw === "high" || raw === "medium" || raw === "low") return raw;
  return "low";
};
const minEvidenceLevel = parseEvidenceLevel(minEvidenceLevelRaw);
const minEvidenceRank = EVIDENCE_RANK[minEvidenceLevel];

const PRODUCT_STOP_WORDS = new Set([
  "mg",
  "mcg",
  "g",
  "iu",
  "ml",
  "tablet",
  "tablets",
  "capsule",
  "capsules",
  "softgel",
  "softgels",
  "caplet",
  "caplets",
  "bonus",
  "size",
  "regular",
  "strength",
  "extra",
  "timed",
  "release",
  "and",
  "with",
]);

const BRAND_STOP_WORDS = new Set([
  "ltd",
  "limited",
  "inc",
  "company",
  "laboratories",
  "international",
]);

const LOW_VALUE_HINTS = [
  "tea",
  "coffee",
  "kitchenware",
  "exercise equipment",
  "foot care",
  "cleaning products",
  "water systems",
  "accessories",
  "discontinued products",
];

const SUPPLEMENT_HINTS = [
  "npn",
  "natural product number",
  "supplement",
  "vitamin",
  "capsule",
  "tablet",
  "softgel",
  "health product",
];

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

const normalizeDomain = (value: string): string =>
  value
    .trim()
    .toLowerCase()
    .replace(/^https?:\/\//, "")
    .replace(/^www\./, "")
    .replace(/\/.*$/, "");

const normalizeLooseText = (value: string | null | undefined): string =>
  String(value ?? "")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();

const tokenize = (
  value: string | null | undefined,
  stopWords: Set<string>,
  maxTokens: number,
): string[] => {
  const out: string[] = [];
  const seen = new Set<string>();
  const normalized = normalizeLooseText(value)
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
  if (!normalized) return out;
  for (const token of normalized.split(" ")) {
    if (!token || token.length < 4 || /^\d+$/.test(token) || stopWords.has(token)) continue;
    if (seen.has(token)) continue;
    seen.add(token);
    out.push(token);
    if (out.length >= maxTokens) break;
  }
  return out;
};

const sameDomain = (candidateUrl: string, domain: string): boolean => {
  try {
    const host = normalizeDomain(new URL(candidateUrl).hostname);
    return host === domain || host.endsWith(`.${domain}`);
  } catch {
    return false;
  }
};

const canonicalizeUrl = (url: string): string | null => {
  try {
    const parsed = new URL(url);
    parsed.hash = "";
    for (const key of Array.from(parsed.searchParams.keys())) {
      const lowered = key.toLowerCase();
      if (
        lowered.startsWith("utm_") ||
        lowered === "gclid" ||
        lowered === "fbclid" ||
        lowered === "ref" ||
        lowered === "source" ||
        lowered === "variant"
      ) {
        parsed.searchParams.delete(key);
      }
    }
    const pathName = parsed.pathname.endsWith("/") && parsed.pathname !== "/"
      ? parsed.pathname.slice(0, -1)
      : parsed.pathname;
    parsed.pathname = pathName;
    const query = parsed.searchParams.toString();
    parsed.search = query ? `?${query}` : "";
    parsed.protocol = "https:";
    return parsed.toString();
  } catch {
    return null;
  }
};

const parseXmlLocs = (xml: string): string[] => {
  const out: string[] = [];
  const pattern = /<loc>([^<]+)<\/loc>/gi;
  let match = pattern.exec(xml);
  while (match) {
    const value = String(match[1] ?? "").trim();
    if (value) out.push(value);
    match = pattern.exec(xml);
  }
  return out;
};

const parseRobotsSitemaps = (robotsText: string): string[] => {
  const out: string[] = [];
  for (const rawLine of robotsText.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || !/^sitemap:/i.test(line)) continue;
    const value = line.split(":").slice(1).join(":").trim();
    if (value) out.push(value);
  }
  return out;
};

const fetchText = async (
  url: string,
  customTimeoutMs = timeoutMs,
): Promise<{ text: string | null; status: number | null; elapsedMs: number }> => {
  const startedAt = Date.now();
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), customTimeoutMs);
  try {
    const response = await fetch(url, {
      method: "GET",
      signal: controller.signal,
      redirect: "follow",
      headers: {
        "user-agent": USER_AGENT,
        accept: "text/html,application/xml,text/xml,*/*",
      },
    });
    if (!response.ok) {
      return {
        text: null,
        status: response.status,
        elapsedMs: Date.now() - startedAt,
      };
    }
    return {
      text: await response.text(),
      status: response.status,
      elapsedMs: Date.now() - startedAt,
    };
  } catch {
    return {
      text: null,
      status: null,
      elapsedMs: Date.now() - startedAt,
    };
  } finally {
    clearTimeout(timeout);
  }
};

const normalizeNpn = (value: string): string | null => {
  const digits = value.replace(/\D/g, "");
  if (!/^\d{8}$/.test(digits)) return null;
  if (/^(\d)\1{7}$/.test(digits)) return null;
  return digits;
};

const normalizeBarcodeToGtin14 = (value: string): string | null => {
  const digits = value.replace(/\D/g, "");
  if (!digits || digits.length < 8 || digits.length > 14) return null;
  const normalized = normalizeBarcodeInput(digits);
  if (!normalized || normalized.isValidChecksum !== true) return null;
  return normalized.variants.find((variant) => /^\d{14}$/.test(variant)) ?? null;
};

const toNpnFromUnknown = (value: unknown): string | null => {
  if (typeof value === "string" || typeof value === "number") {
    return normalizeNpn(String(value));
  }
  if (value && typeof value === "object") {
    const obj = value as Record<string, unknown>;
    return (
      toNpnFromUnknown(obj.npn) ??
      toNpnFromUnknown(obj.value) ??
      toNpnFromUnknown(obj.sourceId) ??
      toNpnFromUnknown(obj.id)
    );
  }
  return null;
};

const parseNpnAllowlistPayload = (payload: unknown): AllowlistContext[] => {
  const out: AllowlistContext[] = [];
  const seen = new Set<string>();

  const push = (value: unknown) => {
    let npn: string | null = null;
    let brandName: string | null = null;
    let productName: string | null = null;
    let productType: string | null = null;
    let category: string | null = null;

    if (typeof value === "string" || typeof value === "number") {
      npn = normalizeNpn(String(value));
    } else if (value && typeof value === "object") {
      const row = value as Record<string, unknown>;
      npn =
        toNpnFromUnknown(row.npn) ??
        toNpnFromUnknown(row.value) ??
        toNpnFromUnknown(row.sourceId) ??
        toNpnFromUnknown(row.id);
      brandName = row.brandName ? String(row.brandName) : row.brand_name ? String(row.brand_name) : null;
      productName = row.productName
        ? String(row.productName)
        : row.product_name
          ? String(row.product_name)
          : null;
      productType = row.productType
        ? String(row.productType)
        : row.product_type
          ? String(row.product_type)
          : null;
      category = row.category ? String(row.category) : null;
    }

    if (!npn || seen.has(npn)) return;
    seen.add(npn);
    out.push({
      npn,
      brandName,
      productName,
      productType,
      category,
      brandTokens: tokenize(brandName, BRAND_STOP_WORDS, 3),
      productTokens: tokenize(productName, PRODUCT_STOP_WORDS, 6),
    });
  };

  if (Array.isArray(payload)) {
    for (const value of payload) push(value);
    return out;
  }
  if (payload && typeof payload === "object") {
    const obj = payload as Record<string, unknown>;
    const fields = ["npns", "sourceIds", "ids", "rows", "items", "queue"];
    for (const field of fields) {
      const value = obj[field];
      if (Array.isArray(value)) {
        for (const item of value) push(item);
      }
    }
    push(obj);
    return out;
  }
  push(payload);
  return out;
};

const loadNpnAllowlist = async (filePath: string): Promise<AllowlistLoadResult> => {
  const raw = await fs.promises.readFile(filePath, "utf8");
  const trimmed = raw.trim();
  if (!trimmed) return { npnSet: new Set<string>(), contextByNpn: new Map<string, AllowlistContext>() };

  const extracted: AllowlistContext[] = [];
  if (trimmed.startsWith("[") || trimmed.startsWith("{")) {
    try {
      const parsed = JSON.parse(trimmed);
      extracted.push(...parseNpnAllowlistPayload(parsed));
    } catch {
      // Fall through to line-by-line JSONL parsing.
    }
  }

  if (extracted.length === 0) {
    const lines = trimmed
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean);
    for (const line of lines) {
      if (line.startsWith("{") || line.startsWith("[")) {
        try {
          extracted.push(...parseNpnAllowlistPayload(JSON.parse(line)));
          continue;
        } catch {
          // Fall through to raw token parsing.
        }
      }
      const token = normalizeNpn(line);
      if (token) {
        extracted.push({
          npn: token,
          brandName: null,
          productName: null,
          productType: null,
          category: null,
          brandTokens: [],
          productTokens: [],
        });
      }
    }
  }

  const npnSet = new Set<string>();
  const contextByNpn = new Map<string, AllowlistContext>();
  for (const row of extracted) {
    if (npnSet.has(row.npn)) continue;
    npnSet.add(row.npn);
    contextByNpn.set(row.npn, row);
  }
  return { npnSet, contextByNpn };
};

type IndexedToken = {
  value: string;
  index: number;
};

const extractNpnsWithIndex = (text: string): IndexedToken[] => {
  const out: IndexedToken[] = [];
  const seen = new Set<string>();
  const patterns = [
    /\b(?:npn|natural product number|product licence(?: number)?|license number|din-hm)\b[^0-9]{0,24}(\d{8})/gi,
    /\b(\d{8})\b[^a-z0-9]{0,24}\b(?:npn|natural product number|din-hm)\b/gi,
  ];
  for (const pattern of patterns) {
    let match = pattern.exec(text);
    while (match) {
      const npn = normalizeNpn(match[1] ?? "");
      if (npn) {
        const key = `${npn}|${match.index ?? 0}`;
        if (!seen.has(key)) {
          seen.add(key);
          out.push({ value: npn, index: match.index ?? 0 });
        }
      }
      match = pattern.exec(text);
    }
  }
  return out;
};

const extractBarcodesStage1WithIndex = (text: string): IndexedToken[] => {
  const out: IndexedToken[] = [];
  const seen = new Set<string>();
  const patterns = [
    /\b(?:upc|ean|gtin|barcode|sku)\b[^0-9]{0,24}((?:\d[\s-]?){8,16})/gi,
    /itemprop=["'](?:gtin\d*|upc|ean)["']\s+content=["']([0-9][0-9\-\s]{7,24})["']/gi,
  ];
  for (const pattern of patterns) {
    let match = pattern.exec(text);
    while (match) {
      const barcode = normalizeBarcodeToGtin14(match[1] ?? "");
      if (barcode) {
        const key = `${barcode}|${match.index ?? 0}`;
        if (!seen.has(key)) {
          seen.add(key);
          out.push({ value: barcode, index: match.index ?? 0 });
        }
      }
      match = pattern.exec(text);
    }
  }
  return out;
};

const extractBarcodesStage2WithIndex = (text: string): IndexedToken[] => {
  const out: IndexedToken[] = [];
  const seen = new Set<string>();
  const patterns = [
    /"(?:gtin\d*|gtin|upc|ean|barcode)"\s*:\s*"([0-9][0-9\-\s]{7,24})"/gi,
    /"variants"\s*:\s*\[[\s\S]{0,250000}?"barcode"\s*:\s*"([0-9][0-9\-\s]{7,24})"/gi,
    /"product"\s*:\s*\{[\s\S]{0,250000}?"barcode"\s*:\s*"([0-9][0-9\-\s]{7,24})"/gi,
    /"productID"\s*:\s*"([0-9][0-9\-\s]{7,24})"/gi,
  ];
  for (const pattern of patterns) {
    let match = pattern.exec(text);
    while (match) {
      const barcode = normalizeBarcodeToGtin14(match[1] ?? "");
      if (barcode) {
        const key = `${barcode}|${match.index ?? 0}`;
        if (!seen.has(key)) {
          seen.add(key);
          out.push({ value: barcode, index: match.index ?? 0 });
        }
      }
      match = pattern.exec(text);
    }
  }
  return out;
};

const urlLooksProduct = (url: string): boolean => {
  const lower = url.toLowerCase();
  if (
    /(\/blog\/|\/blogs\/|\/account\/|\/cart|\/checkout|\/policy|\/policies\/|\/search|\/tag\/|\/tags\/|\/category\/|\/collections\/|\/pages\/|\/news\/|\/article\/|\/wp-json\/|\/cdn-cgi\/)/i.test(
      lower,
    )
  ) {
    return false;
  }
  if (/\.(jpg|jpeg|png|gif|svg|webp|pdf|xml)(\?|$)/i.test(lower)) return false;
  return /(\/product\/|\/products\/|\/shop\/|\/supplement|\/vitamin|\/item\/|\/p\/)/i.test(lower);
};

const isLowValuePage = (text: string): boolean => {
  if (allowLowValuePages) return false;
  const normalized = normalizeLooseText(text);
  if (!normalized) return false;
  const hasLowValue = LOW_VALUE_HINTS.some((hint) => normalized.includes(hint));
  if (!hasLowValue) return false;
  const hasSupplementHint = SUPPLEMENT_HINTS.some((hint) => normalized.includes(hint));
  return !hasSupplementHint;
};

const loadDomains = async (): Promise<string[]> => {
  if (singleDomain) return [normalizeDomain(singleDomain)];
  if (!domainsFile) return defaultDomains;
  const raw = await fs.promises.readFile(domainsFile, "utf8");
  const parsed = raw
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith("#"))
    .map((line) => normalizeDomain(line));
  return parsed.length > 0 ? parsed : defaultDomains;
};

const writeJson = async (filePath: string, payload: unknown) => {
  await fs.promises.mkdir(path.dirname(filePath), { recursive: true });
  await fs.promises.writeFile(filePath, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
};

const writeCsv = async (filePath: string, headers: string[], rows: Record<string, unknown>[]) => {
  const escape = (value: unknown) => `"${String(value ?? "").replaceAll('"', '""')}"`;
  const lines = [headers.join(",")];
  for (const row of rows) {
    lines.push(headers.map((header) => escape(row[header])).join(","));
  }
  await fs.promises.mkdir(path.dirname(filePath), { recursive: true });
  await fs.promises.writeFile(filePath, `${lines.join("\n")}\n`, "utf8");
};

const gatherPageUrls = async (domain: string) => {
  const seeds = [
    `https://${domain}/robots.txt`,
    `https://${domain}/sitemap.xml`,
    `https://${domain}/sitemap_index.xml`,
    `https://${domain}/wp-sitemap.xml`,
  ];

  const queue: string[] = [];
  const sitemapSet = new Set<string>();
  const pageUrlSet = new Set<string>();
  let sitemapsRead = 0;

  const robotsRes = await fetchText(seeds[0], 4000);
  if (robotsRes.text) {
    for (const candidate of parseRobotsSitemaps(robotsRes.text)) {
      const canonical = canonicalizeUrl(candidate) ?? candidate;
      if (!sitemapSet.has(canonical)) {
        sitemapSet.add(canonical);
        queue.push(canonical);
      }
    }
  }

  for (const candidate of seeds.slice(1)) {
    if (!sitemapSet.has(candidate)) {
      sitemapSet.add(candidate);
      queue.push(candidate);
    }
  }

  const visited = new Set<string>();
  while (queue.length > 0 && visited.size < maxSitemapsPerDomain) {
    const sitemapUrl = queue.shift()!;
    if (visited.has(sitemapUrl)) continue;
    visited.add(sitemapUrl);
    const xmlRes = await fetchText(sitemapUrl);
    if (!xmlRes.text) continue;
    sitemapsRead += 1;
    const locs = parseXmlLocs(xmlRes.text).slice(0, maxUrlsPerSitemap);
    for (const locRaw of locs) {
      const loc = canonicalizeUrl(locRaw) ?? locRaw;
      if (/\.xml(\?|#|$)/i.test(loc)) {
        if (!visited.has(loc) && !sitemapSet.has(loc) && queue.length < maxSitemapsPerDomain * 4) {
          const inDomain = sameDomain(loc, domain);
          if (inDomain) {
            sitemapSet.add(loc);
            queue.push(loc);
          }
        }
        continue;
      }
      if (sameDomain(loc, domain)) pageUrlSet.add(loc);
    }
    if (delayMs > 0) await sleep(delayMs);
  }

  const all = Array.from(pageUrlSet);
  const product = all.filter((url) => urlLooksProduct(url));
  const prioritized = [...product, ...all.filter((url) => !product.includes(url))].slice(0, maxPagesPerDomain);

  return {
    pages: prioritized,
    sitemapsTried: visited.size,
    sitemapsRead,
  };
};

const pairEvidenceFromDistance = (distance: number): { level: EvidenceLevel; score: number } | null => {
  if (distance <= 80) return { level: "high", score: 9 };
  if (distance <= 160) return { level: "medium", score: 7 };
  if (distance <= 260) return { level: "low", score: 6 };
  return null;
};

const evaluateContextSignals = (
  text: string,
  context: AllowlistContext | null,
): {
  brandOverlap: number;
  productOverlap: number;
  requiredBrandOverlap: number;
  requiredProductOverlap: number;
  pass: boolean;
} => {
  if (!context) {
    return {
      brandOverlap: 0,
      productOverlap: 0,
      requiredBrandOverlap: 0,
      requiredProductOverlap: 0,
      pass: true,
    };
  }

  const brandOverlap = context.brandTokens.filter((token) => text.includes(token)).length;
  const productOverlap = context.productTokens.filter((token) => text.includes(token)).length;
  const requiredBrandOverlap = context.brandTokens.length > 0 ? 1 : 0;
  const requiredProductOverlap = context.productTokens.length > 0 ? Math.min(2, context.productTokens.length) : 0;
  const pass = brandOverlap >= requiredBrandOverlap && productOverlap >= requiredProductOverlap;
  return {
    brandOverlap,
    productOverlap,
    requiredBrandOverlap,
    requiredProductOverlap,
    pass,
  };
};

const scanDomain = async (
  domain: string,
  npnAllowlist: Set<string> | null,
  npnContextById: Map<string, AllowlistContext>,
): Promise<{ stats: DomainStats; pairs: PairRow[] }> => {
  const { pages, sitemapsTried, sitemapsRead } = await gatherPageUrls(domain);
  const pairs: PairRow[] = [];
  const pairSet = new Set<string>();
  let pagesScanned = 0;
  let pagesFetchFailed = 0;
  let pagesWithNpn = 0;
  let pagesWithBarcode = 0;
  let pagesWithPairs = 0;
  let fetchElapsedTotal = 0;
  let cursor = 0;

  const workers = Array.from({ length: concurrency }, async () => {
    while (true) {
      const idx = cursor;
      cursor += 1;
      if (idx >= pages.length) return;
      const url = pages[idx];
      const htmlRes = await fetchText(url);
      pagesScanned += 1;
      fetchElapsedTotal += htmlRes.elapsedMs;
      if (!htmlRes.text) {
        pagesFetchFailed += 1;
        continue;
      }

      const html = htmlRes.text;
      const normalizedHtml = normalizeLooseText(html);
      if (isLowValuePage(normalizedHtml)) continue;

      const npns = extractNpnsWithIndex(html)
        .filter((token) => !npnAllowlist || npnAllowlist.has(token.value))
        .slice(0, 8);
      if (!npns.length) continue;
      pagesWithNpn += 1;

      let barcodes = extractBarcodesStage1WithIndex(html).slice(0, 12);
      if (!barcodes.length) {
        barcodes = extractBarcodesStage2WithIndex(html).slice(0, 18);
      }
      if (!barcodes.length) continue;
      pagesWithBarcode += 1;

      const acceptedPairs: Array<{
        npn: string;
        barcode: string;
        evidenceLevel: EvidenceLevel;
        evidenceScore: number;
        tokenDistance: number | null;
        brandOverlap: number;
        productOverlap: number;
        requiredBrandOverlap: number;
        requiredProductOverlap: number;
        contextPass: boolean;
      }> = [];
      const acceptedKey = new Set<string>();
      const proximityWindow = 260;

      for (const npnToken of npns) {
        const context = npnContextById.get(npnToken.value) ?? null;
        const contextSignals = evaluateContextSignals(normalizedHtml, context);
        if (strictPairing && !contextSignals.pass) continue;

        const nearBarcodes = barcodes
          .map((barcodeToken) => ({
            barcodeToken,
            distance: Math.abs(barcodeToken.index - npnToken.index),
          }))
          .filter(({ distance }) => distance <= proximityWindow)
          .sort((a, b) => a.distance - b.distance)
          .slice(0, 4);
        for (const barcodeToken of nearBarcodes) {
          const evidence = pairEvidenceFromDistance(barcodeToken.distance);
          if (!evidence) continue;
          if (EVIDENCE_RANK[evidence.level] < minEvidenceRank) continue;
          const key = `${npnToken.value}|${barcodeToken.barcodeToken.value}`;
          if (acceptedKey.has(key)) continue;
          acceptedKey.add(key);
          acceptedPairs.push({
            npn: npnToken.value,
            barcode: barcodeToken.barcodeToken.value,
            evidenceLevel: evidence.level,
            evidenceScore: evidence.score,
            tokenDistance: barcodeToken.distance,
            brandOverlap: contextSignals.brandOverlap,
            productOverlap: contextSignals.productOverlap,
            requiredBrandOverlap: contextSignals.requiredBrandOverlap,
            requiredProductOverlap: contextSignals.requiredProductOverlap,
            contextPass: contextSignals.pass,
          });
        }
      }

      if (!strictPairing && acceptedPairs.length === 0 && npns.length === 1 && barcodes.length === 1) {
        if (minEvidenceRank <= EVIDENCE_RANK.low) {
          const context = npnContextById.get(npns[0].value) ?? null;
          const contextSignals = evaluateContextSignals(normalizedHtml, context);
          acceptedPairs.push({
            npn: npns[0].value,
            barcode: barcodes[0].value,
            evidenceLevel: "low",
            evidenceScore: 6,
            tokenDistance: null,
            brandOverlap: contextSignals.brandOverlap,
            productOverlap: contextSignals.productOverlap,
            requiredBrandOverlap: contextSignals.requiredBrandOverlap,
            requiredProductOverlap: contextSignals.requiredProductOverlap,
            contextPass: contextSignals.pass,
          });
        }
      }
      if (acceptedPairs.length === 0) continue;

      let pageHasPair = false;
      for (const row of acceptedPairs) {
        const key = `${row.npn}|${row.barcode}|${url}`;
        if (pairSet.has(key)) continue;
        pairSet.add(key);
        pairs.push({
          domain,
          npn: row.npn,
          barcode: row.barcode,
          url,
          extractMode: "sitemap_batch_v2",
          evidenceLevel: row.evidenceLevel,
          evidenceScore: row.evidenceScore,
          tokenDistance: row.tokenDistance,
          brandOverlap: row.brandOverlap,
          productOverlap: row.productOverlap,
          requiredBrandOverlap: row.requiredBrandOverlap,
          requiredProductOverlap: row.requiredProductOverlap,
          contextPass: row.contextPass,
        });
        pageHasPair = true;
      }
      if (pageHasPair) pagesWithPairs += 1;
      if (delayMs > 0) await sleep(delayMs);
    }
  });

  await Promise.all(workers);

  const dedupByPair = new Map<string, PairRow>();
  for (const row of pairs) {
    const key = `${row.npn}|${row.barcode}`;
    const existing = dedupByPair.get(key);
    if (!existing) {
      dedupByPair.set(key, row);
      continue;
    }
    const existingDistance = existing.tokenDistance == null ? Number.POSITIVE_INFINITY : existing.tokenDistance;
    const rowDistance = row.tokenDistance == null ? Number.POSITIVE_INFINITY : row.tokenDistance;
    if (
      row.evidenceScore > existing.evidenceScore ||
      (row.evidenceScore === existing.evidenceScore && rowDistance < existingDistance)
    ) {
      dedupByPair.set(key, row);
    }
  }

  const uniqueNpn = new Set(Array.from(dedupByPair.values()).map((row) => row.npn));
  const safeDenominator = pagesScanned > 0 ? pagesScanned : 1;
  const avgFetchMs = pagesScanned > 0 ? fetchElapsedTotal / pagesScanned : 0;
  const errRate = pagesFetchFailed / safeDenominator;
  const npnFoundRate = pagesWithNpn / safeDenominator;
  const barcodeFoundRate = pagesWithBarcode / safeDenominator;
  const npnAndBarcodeSamePageRate = pagesWithPairs / safeDenominator;
  const yieldPer1000Urls = (dedupByPair.size / safeDenominator) * 1000;

  return {
    stats: {
      domain,
      sitemapsTried,
      sitemapsRead,
      pagesQueued: pages.length,
      pagesScanned,
      pagesFetchFailed,
      pagesWithNpn,
      pagesWithBarcode,
      pagesWithPairs,
      pairCountRaw: pairs.length,
      pairCountDedup: dedupByPair.size,
      pairCount: dedupByPair.size,
      npnCount: uniqueNpn.size,
      avgFetchMs: Number(avgFetchMs.toFixed(2)),
      errRate: Number(errRate.toFixed(6)),
      npnFoundRate: Number(npnFoundRate.toFixed(6)),
      barcodeFoundRate: Number(barcodeFoundRate.toFixed(6)),
      npnAndBarcodeSamePageRate: Number(npnAndBarcodeSamePageRate.toFixed(6)),
      yieldPer1000Urls: Number(yieldPer1000Urls.toFixed(3)),
    },
    pairs,
  };
};

const main = async () => {
  const startedAt = new Date();
  const stamp = new Date().toISOString().replaceAll(":", "-");
  const outDir = outDirArg ?? path.resolve(process.cwd(), `output/npn_webhunt/domain_incremental/${stamp}`);
  const domains = Array.from(new Set((await loadDomains()).filter(Boolean).map((value) => normalizeDomain(value))));
  const allowlist = npnAllowlistFile
    ? await loadNpnAllowlist(npnAllowlistFile)
    : { npnSet: null as Set<string> | null, contextByNpn: new Map<string, AllowlistContext>() };

  const allPairsRaw: PairRow[] = [];
  const domainStats: DomainStats[] = [];

  for (const domain of domains) {
    const result = await scanDomain(domain, allowlist.npnSet, allowlist.contextByNpn);
    domainStats.push(result.stats);
    allPairsRaw.push(...result.pairs);
    console.log(
      `[npn-sitemap] ${domain} | pages=${result.stats.pagesScanned}/${result.stats.pagesQueued} | pairsRaw=${result.stats.pairCountRaw} | pairsDedup=${result.stats.pairCountDedup} | npns=${result.stats.npnCount}`,
    );
  }

  const dedup = new Map<string, PairRow>();
  for (const row of allPairsRaw) {
    const key = `${row.domain}|${row.npn}|${row.barcode}`;
    const existing = dedup.get(key);
    if (!existing) {
      dedup.set(key, row);
      continue;
    }
    const existingDistance = existing.tokenDistance == null ? Number.POSITIVE_INFINITY : existing.tokenDistance;
    const rowDistance = row.tokenDistance == null ? Number.POSITIVE_INFINITY : row.tokenDistance;
    if (
      row.evidenceScore > existing.evidenceScore ||
      (row.evidenceScore === existing.evidenceScore && rowDistance < existingDistance)
    ) {
      dedup.set(key, row);
    }
  }
  const pairsDedup = Array.from(dedup.values());

  const summary = {
    generatedAt: new Date().toISOString(),
    elapsedSec: Number(((Date.now() - startedAt.getTime()) / 1000).toFixed(2)),
    domains: domains.length,
    domainsWithPairs: domainStats.filter((row) => row.pairCountDedup > 0).length,
    pairCountRaw: allPairsRaw.length,
    pairCountDedup: pairsDedup.length,
    pairCount: pairsDedup.length,
    npnCount: new Set(pairsDedup.map((row) => row.npn)).size,
    outDir,
    settings: {
      strictPairing,
      allowLowValuePages,
      minEvidenceLevel,
      npnAllowlistFile: npnAllowlistFile ?? null,
      npnAllowlistSize: allowlist.npnSet ? allowlist.npnSet.size : null,
    },
    topDomains: domainStats
      .filter((row) => row.pairCountDedup > 0)
      .sort((a, b) => b.yieldPer1000Urls - a.yieldPer1000Urls)
      .slice(0, 20),
  };

  await writeJson(path.join(outDir, "pairs.raw.json"), allPairsRaw);
  await writeJson(path.join(outDir, "pairs.json"), pairsDedup);
  await writeCsv(
    path.join(outDir, "pairs.csv"),
    [
      "domain",
      "npn",
      "barcode",
      "url",
      "extractMode",
      "evidenceLevel",
      "evidenceScore",
      "tokenDistance",
      "brandOverlap",
      "productOverlap",
      "requiredBrandOverlap",
      "requiredProductOverlap",
      "contextPass",
    ],
    pairsDedup,
  );
  await writeJson(path.join(outDir, "domain_stats.json"), domainStats);
  await writeJson(path.join(outDir, "summary.json"), summary);

  console.log(
    `[npn-sitemap] done | out=${outDir} | pairsRaw=${summary.pairCountRaw} | pairsDedup=${summary.pairCountDedup} | npns=${summary.npnCount}`,
  );
};

main().catch((error) => {
  console.error("[npn-sitemap] fatal:", error instanceof Error ? error.message : String(error));
  process.exit(1);
});
