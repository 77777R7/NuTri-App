import fs from "node:fs";
import path from "node:path";

import { normalizeBarcodeInput } from "../src/barcode.js";
import { normalizeBarcodeKey } from "../src/barcodeKey.js";
import { upsertRegulatoryMapWithPolicy } from "../src/barcodeResolutionDbCache.js";
import { supabase } from "../src/supabase.js";

type LnhpdRow = {
  lnhpd_id: number;
  npn: string | null;
  brand_name: string | null;
  product_name: string | null;
  facts_json: Record<string, unknown> | null;
};

type Checkpoint = {
  listIndex: number;
  processed: number;
  queried: number;
  matched: number;
  inserted: number;
  conflicts: number;
  skippedExisting: number;
  skippedPrimaryMapped: number;
  skippedSameBarcode: number;
  failed: number;
  updatedFactsRows: number;
  consideredLinks: number;
  blockedDomainLinks: number;
  rejectedByAllowlistLinks: number;
  startedAt: string;
  updatedAt: string;
};

type CandidateEvidence = {
  barcodeGtin14: string;
  raw: string;
  link: string;
  sourceType: "jsonld" | "keyword" | "snippet";
  npnMentioned: boolean;
};

type RowContext = {
  brandTokens: string[];
  productTokens: string[];
};

const args = process.argv.slice(2);
const hasFlag = (flag: string) => args.includes(`--${flag}`);
const getArg = (flag: string) => {
  const idx = args.indexOf(`--${flag}`);
  if (idx === -1) return null;
  return args[idx + 1] ?? null;
};

const asNumber = (value: string | null, fallback: number): number => {
  if (!value) return fallback;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
};

const npnFile = getArg("npn-file");
if (!npnFile) {
  console.error("[lnhpd-barcode-ddg] Missing --npn-file");
  process.exit(1);
}

const pageSize = Math.min(1000, Math.max(20, asNumber(getArg("page-size"), 200)));
const maxNpns = Math.max(0, asNumber(getArg("max-npns"), 0));
const maxQueriesPerNpn = Math.min(4, Math.max(1, asNumber(getArg("max-queries-per-npn"), 2)));
const queryDelayMs = Math.max(0, asNumber(getArg("query-delay-ms"), 1000));
const ddgTimeoutMs = Math.max(2000, asNumber(getArg("ddg-timeout-ms"), 8000));
const htmlTimeoutMs = Math.max(2000, asNumber(getArg("html-timeout-ms"), 8000));
const maxBarcodesPerNpn = Math.min(10, Math.max(1, asNumber(getArg("max-barcodes-per-npn"), 3)));
const maxLinksPerNpn = Math.min(12, Math.max(2, asNumber(getArg("max-links-per-npn"), 8)));
const sourceName = getArg("source-name") ?? "web_npn_enrich_ddg_v1";

const dryRun = hasFlag("dry-run");
const writeFacts = hasFlag("write-facts");
const skipExistingNpn = !hasFlag("include-existing-npn");
const allowPrimaryOverlap = hasFlag("allow-primary-overlap");
const disableDdg = hasFlag("disable-ddg");
const disableBing = hasFlag("disable-bing");

const checkpointFile =
  getArg("checkpoint-file") ??
  path.resolve(process.cwd(), "output", "lnhpd_barcode_enrich_ddg_checkpoint.json");
const summaryJson =
  getArg("summary-json") ?? path.resolve(process.cwd(), "output", "lnhpd_barcode_enrich_ddg_summary.json");
const matchesJsonl =
  getArg("matches-jsonl") ?? path.resolve(process.cwd(), "output", "lnhpd_barcode_enrich_ddg_matches.jsonl");
const failuresJsonl =
  getArg("failures-jsonl") ?? path.resolve(process.cwd(), "output", "lnhpd_barcode_enrich_ddg_failures.jsonl");

const normalizeDomain = (value: string): string =>
  value.trim().toLowerCase().replace(/^www\./, "");

const DEFAULT_BLOCKED_DOMAINS = [
  "amazon.com",
  "amazon.ca",
  "amazon.co.uk",
  "amazon.de",
  "amazon.fr",
  "ebay.com",
  "ebay.ca",
  "etsy.com",
  "walmart.com",
  "walmart.ca",
  "target.com",
  "temu.com",
  "aliexpress.com",
  "alibaba.com",
  "mercari.com",
  "carousell.com",
  "wish.com",
];

const parseDomainSet = (raw: string | null, fallback: string[] = []): Set<string> => {
  const source = raw && raw.trim().length > 0 ? raw.split(",") : fallback;
  return new Set(source.map(normalizeDomain).filter(Boolean));
};

const blockedDomains = parseDomainSet(getArg("blocked-domains"), DEFAULT_BLOCKED_DOMAINS);
const allowedDomainsRaw = getArg("allowed-domains");
const allowedDomains = allowedDomainsRaw ? parseDomainSet(allowedDomainsRaw, []) : null;

const domainMatches = (domain: string, candidate: string): boolean =>
  domain === candidate || domain.endsWith(`.${candidate}`);

const isBlockedDomain = (domain: string): boolean => {
  for (const blocked of blockedDomains) {
    if (domainMatches(domain, blocked)) return true;
  }
  return false;
};

const isAllowedDomain = (domain: string): boolean => {
  if (!allowedDomains) return true;
  for (const allowed of allowedDomains) {
    if (domainMatches(domain, allowed)) return true;
  }
  return false;
};

const extractDomain = (value: string): string | null => {
  try {
    return normalizeDomain(new URL(value).hostname);
  } catch {
    return null;
  }
};

const ensureDir = async (filePath: string) => {
  await fs.promises.mkdir(path.dirname(filePath), { recursive: true });
};

const appendJsonl = async (filePath: string, payload: Record<string, unknown>) => {
  await ensureDir(filePath);
  await fs.promises.appendFile(filePath, `${JSON.stringify(payload)}\n`, "utf8");
};

const writeJson = async (filePath: string, payload: unknown) => {
  await ensureDir(filePath);
  await fs.promises.writeFile(filePath, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
};

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

const sanitize = (value: string | null | undefined): string =>
  String(value ?? "")
    .replace(/\s+/g, " ")
    .trim();

const normalizeLooseText = (value: string | null | undefined): string =>
  sanitize(value)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();

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
  "nutricorp",
]);

const normalizeNpn = (value: string | null | undefined): string | null => {
  const digits = String(value ?? "").replace(/\D/g, "").trim();
  if (!digits) return null;
  if (digits.length < 6 || digits.length > 10) return null;
  return digits;
};

const normalizeNpnArray = (values: unknown[]): string[] => {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const value of values) {
    const npn = normalizeNpn(typeof value === "string" || typeof value === "number" ? String(value) : null);
    if (!npn || seen.has(npn)) continue;
    seen.add(npn);
    out.push(npn);
  }
  return out;
};

type BarcodeCandidateMetaEntry = {
  barcode: string;
  source?: string | null;
  evidence?: string | null;
  matchMode?: string | null;
  confidence?: number | null;
  lastSeenAt?: string | null;
};

const normalizeBarcodeToGtin14 = (value: unknown): string | null => {
  const raw = sanitize(typeof value === "string" || typeof value === "number" ? String(value) : null);
  if (!raw) return null;
  const digits = raw.replace(/\D/g, "");
  if (!digits) return null;
  const inputs = digits.length === 11 ? [`0${digits}`, digits] : [digits];
  for (const input of inputs) {
    const normalized = normalizeBarcodeKey(input);
    if (normalized.isValidChecksum !== true) continue;
    if (normalized.gtin14) return normalized.gtin14;
  }
  return null;
};

const normalizeMetaText = (value: unknown): string | null => {
  const text = sanitize(typeof value === "string" || typeof value === "number" ? String(value) : null);
  return text ? text : null;
};

const normalizeMetaConfidence = (value: unknown): number | null => {
  const n = Number(value);
  if (!Number.isFinite(n)) return null;
  if (n < 0) return 0;
  if (n > 1) return 1;
  return Number(n.toFixed(4));
};

const hasMeaningfulMeta = (entry: BarcodeCandidateMetaEntry): boolean =>
  Boolean(entry.source || entry.evidence || entry.matchMode || entry.confidence != null || entry.lastSeenAt);

const mergeFactsBarcodeCandidates = (params: {
  facts: Record<string, unknown>;
  incomingBarcodes: string[];
  incomingMeta?: BarcodeCandidateMetaEntry[];
  maxCount: number;
}) => {
  const { facts, incomingBarcodes, incomingMeta = [], maxCount } = params;
  const metaByBarcode = new Map<string, BarcodeCandidateMetaEntry>();
  const existingOrder: string[] = [];
  const seenExisting = new Set<string>();

  const upsertMeta = (barcode: string, patch: Partial<BarcodeCandidateMetaEntry>) => {
    const current = metaByBarcode.get(barcode) ?? { barcode };
    metaByBarcode.set(barcode, {
      barcode,
      source: patch.source ?? current.source ?? null,
      evidence: patch.evidence ?? current.evidence ?? null,
      matchMode: patch.matchMode ?? current.matchMode ?? null,
      confidence: patch.confidence ?? current.confidence ?? null,
      lastSeenAt: patch.lastSeenAt ?? current.lastSeenAt ?? null,
    });
  };

  const rawCandidates = Array.isArray((facts as Record<string, unknown>).barcodeCandidates)
    ? ((facts as Record<string, unknown>).barcodeCandidates as unknown[])
    : [];
  for (const entry of rawCandidates) {
    let barcode: string | null = null;
    if (entry && typeof entry === "object" && !Array.isArray(entry)) {
      const obj = entry as Record<string, unknown>;
      barcode = normalizeBarcodeToGtin14(obj.barcode ?? obj.barcode_gtin14 ?? obj.gtin14 ?? obj.value);
      if (barcode) {
        upsertMeta(barcode, {
          source: normalizeMetaText(obj.source),
          evidence: normalizeMetaText(obj.evidence),
          matchMode: normalizeMetaText(obj.matchMode),
          confidence: normalizeMetaConfidence(obj.confidence),
          lastSeenAt: normalizeMetaText(obj.lastSeenAt ?? obj.last_seen_at),
        });
      }
    } else {
      barcode = normalizeBarcodeToGtin14(entry);
    }
    if (!barcode || seenExisting.has(barcode)) continue;
    seenExisting.add(barcode);
    existingOrder.push(barcode);
  }

  const rawMeta = Array.isArray((facts as Record<string, unknown>).barcodeCandidatesMeta)
    ? ((facts as Record<string, unknown>).barcodeCandidatesMeta as unknown[])
    : [];
  for (const entry of rawMeta) {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) continue;
    const obj = entry as Record<string, unknown>;
    const barcode = normalizeBarcodeToGtin14(obj.barcode ?? obj.barcode_gtin14 ?? obj.gtin14 ?? obj.value);
    if (!barcode) continue;
    upsertMeta(barcode, {
      source: normalizeMetaText(obj.source),
      evidence: normalizeMetaText(obj.evidence),
      matchMode: normalizeMetaText(obj.matchMode),
      confidence: normalizeMetaConfidence(obj.confidence),
      lastSeenAt: normalizeMetaText(obj.lastSeenAt ?? obj.last_seen_at),
    });
  }

  for (const entry of incomingMeta) {
    const barcode = normalizeBarcodeToGtin14(entry.barcode);
    if (!barcode) continue;
    upsertMeta(barcode, {
      source: normalizeMetaText(entry.source),
      evidence: normalizeMetaText(entry.evidence),
      matchMode: normalizeMetaText(entry.matchMode),
      confidence: normalizeMetaConfidence(entry.confidence),
      lastSeenAt: normalizeMetaText(entry.lastSeenAt),
    });
  }

  const incomingOrder = Array.from(
    new Set(incomingBarcodes.map((value) => normalizeBarcodeToGtin14(value)).filter((value): value is string => Boolean(value))),
  );
  const mergedOrder = [...existingOrder, ...incomingOrder];
  const finalOrder: string[] = [];
  const seenFinal = new Set<string>();
  for (const barcode of mergedOrder) {
    if (seenFinal.has(barcode)) continue;
    seenFinal.add(barcode);
    finalOrder.push(barcode);
    if (finalOrder.length >= maxCount) break;
  }

  const finalMeta = finalOrder
    .map((barcode) => metaByBarcode.get(barcode))
    .filter((entry): entry is BarcodeCandidateMetaEntry => Boolean(entry))
    .filter((entry) => hasMeaningfulMeta(entry))
    .map((entry) => ({
      barcode: entry.barcode,
      ...(entry.source ? { source: entry.source } : {}),
      ...(entry.evidence ? { evidence: entry.evidence } : {}),
      ...(entry.matchMode ? { matchMode: entry.matchMode } : {}),
      ...(entry.confidence != null ? { confidence: entry.confidence } : {}),
      ...(entry.lastSeenAt ? { lastSeenAt: entry.lastSeenAt } : {}),
    }));

  return { barcodes: finalOrder, meta: finalMeta };
};

const loadNpnListFromFile = async (filePath: string): Promise<string[]> => {
  const raw = await fs.promises.readFile(filePath, "utf8");
  const payload = JSON.parse(raw) as unknown;
  if (Array.isArray(payload)) return normalizeNpnArray(payload);
  if (payload && typeof payload === "object") {
    const obj = payload as Record<string, unknown>;
    if (Array.isArray(obj.npns)) return normalizeNpnArray(obj.npns);
    if (Array.isArray(obj.sourceIds)) return normalizeNpnArray(obj.sourceIds);
    if (Array.isArray(obj.ids)) return normalizeNpnArray(obj.ids);
  }
  throw new Error("invalid_npn_file_format: expected array or {npns|sourceIds|ids}");
};

const buildRowContext = (row: LnhpdRow): RowContext => {
  const brandTokens = normalizeLooseText(row.brand_name)
    .split(" ")
    .filter(Boolean)
    .filter((token) => token.length >= 4 && !BRAND_STOP_WORDS.has(token))
    .slice(0, 3);
  const productTokens = normalizeLooseText(row.product_name)
    .split(" ")
    .filter(Boolean)
    .filter((token) => token.length >= 4 && !PRODUCT_STOP_WORDS.has(token) && !/^\d+$/.test(token))
    .slice(0, 6);
  return { brandTokens, productTokens };
};

const hasRowContextSignals = (text: string, ctx: RowContext): boolean => {
  if (!text.trim()) return false;
  if (ctx.brandTokens.length === 0 && ctx.productTokens.length === 0) return true;
  const hasBrand = ctx.brandTokens.length > 0 && ctx.brandTokens.some((token) => text.includes(token));
  const hasProduct = ctx.productTokens.length > 0 && ctx.productTokens.some((token) => text.includes(token));
  return hasBrand || hasProduct;
};

const hasStrongNpnBinding = (text: string, npn: string): boolean => {
  if (!text) return false;
  const strict = new RegExp(`\\b(?:product\\s*)?npn\\s*[:#-]?\\s*${npn}\\b`, "i");
  if (strict.test(text)) return true;
  const near = new RegExp(`\\bnpn\\b[^\\d]{0,16}${npn}\\b|\\b${npn}\\b[^\\d]{0,16}\\bnpn\\b`, "i");
  if (near.test(text)) return true;
  const plain = new RegExp(`\\b${npn}\\b`);
  return plain.test(text);
};

const parseCheckpoint = async (): Promise<Checkpoint> => {
  const nowIso = new Date().toISOString();
  const base: Checkpoint = {
    listIndex: 0,
    processed: 0,
    queried: 0,
    matched: 0,
    inserted: 0,
    conflicts: 0,
    skippedExisting: 0,
    skippedPrimaryMapped: 0,
    skippedSameBarcode: 0,
    failed: 0,
    updatedFactsRows: 0,
    consideredLinks: 0,
    blockedDomainLinks: 0,
    rejectedByAllowlistLinks: 0,
    startedAt: nowIso,
    updatedAt: nowIso,
  };
  try {
    const raw = await fs.promises.readFile(checkpointFile, "utf8");
    const parsed = JSON.parse(raw) as Partial<Checkpoint>;
    return {
      ...base,
      ...parsed,
      startedAt: parsed.startedAt ?? nowIso,
      updatedAt: parsed.updatedAt ?? nowIso,
    };
  } catch {
    return base;
  }
};

const saveCheckpoint = async (cp: Checkpoint) => {
  cp.updatedAt = new Date().toISOString();
  await writeJson(checkpointFile, cp);
};

const buildQueries = (row: LnhpdRow): string[] => {
  const npn = sanitize(row.npn);
  const brand = sanitize(row.brand_name);
  const product = sanitize(row.product_name);
  const queries = new Set<string>();
  if (npn && brand && product) queries.add(`NPN ${npn} ${brand} ${product} barcode`);
  if (npn && product) queries.add(`"NPN ${npn}" "${product}" UPC`);
  if (npn) queries.add(`NPN ${npn} UPC`);
  if (npn) queries.add(`NPN ${npn} GTIN`);
  if (npn && brand) queries.add(`NPN ${npn} ${brand} barcode`);
  return Array.from(queries).slice(0, 4);
};

const fetchDuckHtml = async (query: string): Promise<string> => {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), ddgTimeoutMs);
  try {
    const url = new URL("https://duckduckgo.com/html/");
    url.searchParams.set("q", query);
    const response = await fetch(url.toString(), {
      signal: controller.signal,
      headers: {
        "user-agent":
          "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36",
        accept: "text/html,application/xhtml+xml",
      },
    });
    if (!response.ok) {
      throw new Error(`duck_search_error: HTTP ${response.status}`);
    }
    return await response.text();
  } finally {
    clearTimeout(timeout);
  }
};

const fetchBingHtml = async (query: string): Promise<string> => {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), ddgTimeoutMs);
  try {
    const url = new URL("https://www.bing.com/search");
    url.searchParams.set("q", query);
    url.searchParams.set("setlang", "en-CA");
    const response = await fetch(url.toString(), {
      signal: controller.signal,
      headers: {
        "user-agent":
          "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36",
        accept: "text/html,application/xhtml+xml",
      },
    });
    if (!response.ok) {
      throw new Error(`bing_search_error: HTTP ${response.status}`);
    }
    return await response.text();
  } finally {
    clearTimeout(timeout);
  }
};

const extractDuckLinks = (html: string): string[] => {
  const links: string[] = [];
  const seen = new Set<string>();

  const push = (raw: string) => {
    const value = sanitize(raw);
    if (!/^https?:\/\//i.test(value)) return;
    if (seen.has(value)) return;
    seen.add(value);
    links.push(value);
  };

  for (const match of html.matchAll(/uddg=([^"&]+)/g)) {
    try {
      push(decodeURIComponent(match[1]));
    } catch {
      // ignore bad decode
    }
  }

  for (const match of html.matchAll(/href="(https?:\/\/[^"]+)"/g)) {
    push(match[1]);
  }

  return links;
};

const extractBingLinks = (html: string): string[] => {
  const links: string[] = [];
  const seen = new Set<string>();
  const push = (raw: string) => {
    const value = sanitize(raw);
    if (!/^https?:\/\//i.test(value)) return;
    if (seen.has(value)) return;
    seen.add(value);
    links.push(value);
  };

  for (const match of html.matchAll(/<li class="b_algo"[\s\S]*?<a href="(https?:\/\/[^"]+)"/gi)) {
    push(match[1]);
  }

  for (const match of html.matchAll(/<a href="(https?:\/\/[^"]+)"/gi)) {
    push(match[1]);
  }

  return links;
};

const fetchHtml = async (url: string): Promise<string | null> => {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), htmlTimeoutMs);
  try {
    const response = await fetch(url, {
      signal: controller.signal,
      headers: {
        "user-agent":
          "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36",
        accept: "text/html,application/xhtml+xml",
      },
      redirect: "follow",
    });
    if (!response.ok) return null;
    const contentType = response.headers.get("content-type") ?? "";
    if (!/html|text/i.test(contentType)) return null;
    return await response.text();
  } catch {
    return null;
  } finally {
    clearTimeout(timeout);
  }
};

const extractHtmlCandidates = (
  html: string,
  npn: string,
  link: string,
  rowContext: RowContext,
): CandidateEvidence[] => {
  const out: CandidateEvidence[] = [];
  const normalizedText = normalizeLooseText(html);
  const npnMentioned = hasStrongNpnBinding(html, npn);
  if (!npnMentioned) return out;
  if (!hasRowContextSignals(normalizedText, rowContext)) return out;

  const add = (rawCode: string, sourceType: CandidateEvidence["sourceType"]) => {
    const normalized = normalizeBarcodeInput(rawCode);
    if (!normalized) return;
    if (normalized.code.length < 12) return;
    if (normalized.isValidChecksum !== true) return;
    const gtin14 = normalized.variants.find((value) => /^\d{14}$/.test(value)) ?? null;
    if (!gtin14) return;
    if (/^(\d)\1{13}$/.test(gtin14)) return;
    const trimmed = gtin14.replace(/^0+/, "");
    if (trimmed.length < 8) return;
    out.push({
      barcodeGtin14: gtin14,
      raw: normalized.code,
      link,
      sourceType,
      npnMentioned,
    });
  };

  let match: RegExpExecArray | null;
  const jsonLdRegex = /"(?:gtin\d*|gtin|barcode|upc|ean)"\s*:\s*"(\d{8,14})"/gi;
  while ((match = jsonLdRegex.exec(html))) add(match[1], "jsonld");
  const keywordRegex = /(?:upc|ean|gtin|barcode|sku)\D{0,24}((?:\d[\s-]?){8,14})/gi;
  while ((match = keywordRegex.exec(html))) add(match[1], "keyword");

  return out;
};

const extractSnippetCandidates = (
  snippetText: string,
  npn: string,
  link: string,
  rowContext: RowContext,
): CandidateEvidence[] => {
  const out: CandidateEvidence[] = [];
  const normalizedText = normalizeLooseText(snippetText);
  if (!hasStrongNpnBinding(snippetText, npn)) return out;
  if (!hasRowContextSignals(normalizedText, rowContext)) return out;
  const regex = /(?:upc|ean|gtin|barcode|sku)\D{0,24}((?:\d[\s-]?){8,14})/gi;
  let match: RegExpExecArray | null;
  while ((match = regex.exec(snippetText))) {
    const normalized = normalizeBarcodeInput(match[1]);
    if (!normalized) continue;
    if (normalized.code.length < 12) continue;
    if (normalized.isValidChecksum !== true) continue;
    const gtin14 = normalized.variants.find((value) => /^\d{14}$/.test(value)) ?? null;
    if (!gtin14) continue;
    if (/^(\d)\1{13}$/.test(gtin14)) continue;
    const trimmed = gtin14.replace(/^0+/, "");
    if (trimmed.length < 8) continue;
    out.push({
      barcodeGtin14: gtin14,
      raw: normalized.code,
      link,
      sourceType: "snippet",
      npnMentioned: true,
    });
  }
  return out;
};

const dedupeByBarcode = (items: CandidateEvidence[]): CandidateEvidence[] => {
  const byCode = new Map<string, CandidateEvidence>();
  const rank = (entry: CandidateEvidence) => {
    let score = 0;
    if (entry.npnMentioned) score += 5;
    if (entry.sourceType === "jsonld") score += 3;
    if (entry.sourceType === "keyword") score += 2;
    if (entry.sourceType === "snippet") score += 1;
    return score;
  };
  for (const item of items) {
    const prev = byCode.get(item.barcodeGtin14);
    if (!prev || rank(item) > rank(prev)) byCode.set(item.barcodeGtin14, item);
  }
  return Array.from(byCode.values());
};

const rankEvidence = (entry: CandidateEvidence): number => {
  let score = 0;
  if (entry.npnMentioned) score += 5;
  if (entry.sourceType === "jsonld") score += 3;
  if (entry.sourceType === "keyword") score += 2;
  if (entry.sourceType === "snippet") score += 1;
  return score;
};

const loadRowsByNpns = async (npns: string[]): Promise<LnhpdRow[]> => {
  if (!npns.length) return [];
  const out: LnhpdRow[] = [];
  const chunkSize = 200;
  for (let i = 0; i < npns.length; i += chunkSize) {
    const chunk = npns.slice(i, i + chunkSize);
    const { data, error } = await supabase
      .from("lnhpd_facts")
      .select("lnhpd_id,npn,brand_name,product_name,facts_json")
      .in("npn", chunk)
      .order("lnhpd_id", { ascending: true });
    if (error) throw new Error(`load_rows_by_npns_failed: ${error.message}`);
    out.push(...((data ?? []) as LnhpdRow[]));
  }

  const firstByNpn = new Map<string, LnhpdRow>();
  for (const row of out) {
    const npn = normalizeNpn(row.npn);
    if (!npn || firstByNpn.has(npn)) continue;
    firstByNpn.set(npn, row);
  }
  const ordered: LnhpdRow[] = [];
  for (const npn of npns) {
    const row = firstByNpn.get(npn);
    if (row) ordered.push(row);
  }
  return ordered;
};

const loadMappedNpnsBySource = async (npns: string[], source?: string): Promise<Set<string>> => {
  if (!npns.length) return new Set();
  const existing = new Set<string>();
  const chunkSize = 200;
  for (let i = 0; i < npns.length; i += chunkSize) {
    const chunk = npns.slice(i, i + chunkSize);
    let query = supabase.from("barcode_regulatory_map").select("npn").in("npn", chunk).limit(5000);
    if (source) query = query.eq("source", source);
    const { data, error } = await query;
    if (error) throw new Error(`load_existing_map_failed: ${error.message}`);
    (data ?? []).forEach((row: { npn?: string | null }) => {
      const npn = normalizeNpn(row.npn);
      if (npn) existing.add(npn);
    });
  }
  return existing;
};

const insertMappingNoOverwrite = async (params: {
  npn: string;
  barcodeGtin14: string;
  raw: string;
  confidence: number;
  source: string;
}): Promise<"inserted" | "conflict" | "skipped_same_barcode" | "skipped_dryrun"> => {
  if (dryRun) return "skipped_dryrun";

  const outcome = await upsertRegulatoryMapWithPolicy(
    {
      barcodeGtin14: params.barcodeGtin14,
      barcodeRaw: params.raw,
      npn: params.npn,
      confidence: params.confidence,
      source: params.source,
      expiresAt: null,
    },
    { timeoutMs: 1500, keyContractMode: "enforce", writeGuardMode: "enforce" },
  );
  if (outcome.status === "blocked") {
    const existing = outcome.existing;
    if (existing) {
      const existingNpn = normalizeNpn(existing.npn);
      if (existingNpn && existingNpn !== params.npn) return "conflict";
      return "skipped_same_barcode";
    }
    return "skipped_same_barcode";
  }
  return "inserted";
};

const updateFactsJson = async (row: LnhpdRow, barcodes: string[], incomingMeta: BarcodeCandidateMetaEntry[]) => {
  if (!writeFacts || dryRun) return false;
  const now = new Date().toISOString();
  const facts = row.facts_json && typeof row.facts_json === "object" ? { ...row.facts_json } : {};
  const existingSource = sanitize(String((facts as Record<string, unknown>).barcodeSource ?? ""));
  if (existingSource === "web_npn_enrich_v1") return false;
  const merged = mergeFactsBarcodeCandidates({
    facts: facts as Record<string, unknown>,
    incomingBarcodes: barcodes,
    incomingMeta,
    maxCount: maxBarcodesPerNpn,
  });
  facts.barcodeCandidates = merged.barcodes;
  if (merged.meta.length > 0) {
    (facts as Record<string, unknown>).barcodeCandidatesMeta = merged.meta;
  } else {
    delete (facts as Record<string, unknown>).barcodeCandidatesMeta;
  }
  facts.barcodeSource = sourceName;
  facts.barcodeUpdatedAt = now;

  const { error } = await supabase
    .from("lnhpd_facts")
    .update({ facts_json: facts })
    .eq("lnhpd_id", row.lnhpd_id);
  if (error) throw new Error(`update_facts_failed: ${error.message}`);
  return true;
};

const processRow = async (row: LnhpdRow) => {
  const npn = normalizeNpn(row.npn);
  if (!npn) {
    return {
      status: "skip" as const,
      reason: "invalid_npn",
      barcodes: [] as string[],
      evidences: [] as CandidateEvidence[],
      queries: [] as string[],
      consideredLinks: 0,
      blockedDomainLinks: 0,
      rejectedByAllowlistLinks: 0,
    };
  }

  const queries = buildQueries(row).slice(0, maxQueriesPerNpn);
  const rowContext = buildRowContext(row);
  const linksSet = new Set<string>();
  const evidences: CandidateEvidence[] = [];

  for (const query of queries) {
    if (!disableDdg) {
      try {
        const ddgHtml = await fetchDuckHtml(query);
        evidences.push(...extractSnippetCandidates(ddgHtml, npn, "https://duckduckgo.com", rowContext));
        for (const link of extractDuckLinks(ddgHtml)) {
          if (linksSet.size >= maxLinksPerNpn) break;
          linksSet.add(link);
        }
      } catch {
        // best-effort provider
      }
    }
    if (!disableBing && linksSet.size < maxLinksPerNpn) {
      try {
        const bingHtml = await fetchBingHtml(query);
        evidences.push(...extractSnippetCandidates(bingHtml, npn, "https://www.bing.com", rowContext));
        for (const link of extractBingLinks(bingHtml)) {
          if (linksSet.size >= maxLinksPerNpn) break;
          linksSet.add(link);
        }
      } catch {
        // best-effort provider
      }
    }
    await sleep(queryDelayMs);
    if (linksSet.size >= maxLinksPerNpn) break;
  }

  let consideredLinks = 0;
  let blockedDomainLinks = 0;
  let rejectedByAllowlistLinks = 0;

  for (const link of Array.from(linksSet)) {
    const domain = extractDomain(link);
    if (!domain) continue;
    if (isBlockedDomain(domain)) {
      blockedDomainLinks += 1;
      continue;
    }
    if (!isAllowedDomain(domain)) {
      rejectedByAllowlistLinks += 1;
      continue;
    }
    consideredLinks += 1;
    const html = await fetchHtml(link);
    if (!html) continue;
    evidences.push(...extractHtmlCandidates(html, npn, link, rowContext));
  }

  const picked = dedupeByBarcode(evidences)
    .filter((entry) => entry.npnMentioned)
    .sort((a, b) => rankEvidence(b) - rankEvidence(a))
    .slice(0, maxBarcodesPerNpn);
  const barcodes = picked.map((entry) => entry.barcodeGtin14);

  return {
    status: barcodes.length > 0 ? ("matched" as const) : ("no_match" as const),
    reason: barcodes.length > 0 ? null : "no_high_confidence_candidate",
    barcodes,
    evidences: picked,
    queries,
    consideredLinks,
    blockedDomainLinks,
    rejectedByAllowlistLinks,
  };
};

const loadCoverage = async () => {
  const [totalWithNpnRes, mappedRes] = await Promise.all([
    supabase.from("lnhpd_facts").select("lnhpd_id", { head: true, count: "exact" }).not("npn", "is", null),
    supabase.from("barcode_regulatory_map").select("barcode_gtin14", { head: true, count: "exact" }).eq("source", sourceName),
  ]);
  return {
    totalWithNpn: typeof totalWithNpnRes.count === "number" ? totalWithNpnRes.count : null,
    mappedBarcodeCount: typeof mappedRes.count === "number" ? mappedRes.count : null,
  };
};

const ratio = (numerator: number, denominator: number): number =>
  denominator > 0 ? Number((numerator / denominator).toFixed(6)) : 0;

const main = async () => {
  const npnList = await loadNpnListFromFile(npnFile);
  const checkpoint = await parseCheckpoint();
  if (checkpoint.listIndex > npnList.length) checkpoint.listIndex = npnList.length;
  const startedAt = new Date().toISOString();

  await ensureDir(matchesJsonl);
  await ensureDir(failuresJsonl);

  while (checkpoint.listIndex < npnList.length) {
    if (maxNpns > 0 && checkpoint.processed >= maxNpns) break;
    const remainingLimit = maxNpns > 0 ? Math.max(0, maxNpns - checkpoint.processed) : 0;
    const sliceSize = maxNpns > 0 ? Math.min(pageSize, Math.max(1, remainingLimit)) : pageSize;
    const pendingNpns = npnList.slice(checkpoint.listIndex, checkpoint.listIndex + sliceSize);
    if (!pendingNpns.length) break;

    const batchRows = await loadRowsByNpns(pendingNpns);
    const normalizedNpns = batchRows
      .map((row) => normalizeNpn(row.npn))
      .filter((value): value is string => Boolean(value));

    const existingMappedNpns = skipExistingNpn ? await loadMappedNpnsBySource(normalizedNpns) : new Set<string>();
    const primaryMappedNpns = allowPrimaryOverlap
      ? new Set<string>()
      : await loadMappedNpnsBySource(normalizedNpns, "web_npn_enrich_v1");

    for (const row of batchRows) {
      if (maxNpns > 0 && checkpoint.processed >= maxNpns) break;
      checkpoint.processed += 1;

      const npn = normalizeNpn(row.npn);
      if (!npn) {
        checkpoint.failed += 1;
        await appendJsonl(failuresJsonl, {
          lnhpdId: row.lnhpd_id,
          npn: row.npn,
          failCode: "invalid_npn",
          at: new Date().toISOString(),
        });
        await saveCheckpoint(checkpoint);
        continue;
      }

      if (!allowPrimaryOverlap && primaryMappedNpns.has(npn)) {
        checkpoint.skippedPrimaryMapped += 1;
        await appendJsonl(matchesJsonl, {
          lnhpdId: row.lnhpd_id,
          npn,
          status: "skip_primary_mapped_npn",
          at: new Date().toISOString(),
        });
        await saveCheckpoint(checkpoint);
        continue;
      }

      if (skipExistingNpn && existingMappedNpns.has(npn)) {
        checkpoint.skippedExisting += 1;
        await appendJsonl(matchesJsonl, {
          lnhpdId: row.lnhpd_id,
          npn,
          status: "skip_existing_npn",
          at: new Date().toISOString(),
        });
        await saveCheckpoint(checkpoint);
        continue;
      }

      try {
        checkpoint.queried += 1;
        const result = await processRow(row);
        checkpoint.consideredLinks += result.consideredLinks ?? 0;
        checkpoint.blockedDomainLinks += result.blockedDomainLinks ?? 0;
        checkpoint.rejectedByAllowlistLinks += result.rejectedByAllowlistLinks ?? 0;

        if (result.status !== "matched") {
          await appendJsonl(failuresJsonl, {
            lnhpdId: row.lnhpd_id,
            npn,
            brandName: row.brand_name,
            productName: row.product_name,
            failCode: result.reason,
            queries: result.queries,
            consideredLinks: result.consideredLinks,
            blockedDomainLinks: result.blockedDomainLinks,
            rejectedByAllowlistLinks: result.rejectedByAllowlistLinks,
            at: new Date().toISOString(),
          });
          await saveCheckpoint(checkpoint);
          continue;
        }

        checkpoint.matched += 1;
        const inserted: string[] = [];
        const conflicted: string[] = [];
        const skippedSame: string[] = [];
        for (const evidence of result.evidences) {
          const action = await insertMappingNoOverwrite({
            npn,
            barcodeGtin14: evidence.barcodeGtin14,
            raw: evidence.raw,
            confidence: evidence.sourceType === "jsonld" ? 0.92 : 0.85,
            source: sourceName,
          });
          if (action === "inserted") {
            checkpoint.inserted += 1;
            inserted.push(evidence.barcodeGtin14);
          } else if (action === "conflict") {
            checkpoint.conflicts += 1;
            conflicted.push(evidence.barcodeGtin14);
          } else if (action === "skipped_same_barcode") {
            checkpoint.skippedSameBarcode += 1;
            skippedSame.push(evidence.barcodeGtin14);
          }
        }

        if (inserted.length > 0) {
          const incomingMeta = result.evidences
            .filter((evidence) => inserted.includes(evidence.barcodeGtin14))
            .map((evidence) => ({
              barcode: evidence.barcodeGtin14,
              source: sourceName,
              evidence: evidence.link,
              matchMode: evidence.sourceType,
              confidence: evidence.sourceType === "jsonld" ? 0.92 : 0.85,
              lastSeenAt: new Date().toISOString(),
            }));
          const factsUpdated = await updateFactsJson(row, inserted, incomingMeta);
          if (factsUpdated) checkpoint.updatedFactsRows += 1;
        }

        await appendJsonl(matchesJsonl, {
          lnhpdId: row.lnhpd_id,
          npn,
          brandName: row.brand_name,
          productName: row.product_name,
          barcodes: result.barcodes,
          inserted,
          conflicted,
          skippedSameBarcode: skippedSame,
          evidence: result.evidences.slice(0, 8),
          queries: result.queries,
          consideredLinks: result.consideredLinks,
          blockedDomainLinks: result.blockedDomainLinks,
          rejectedByAllowlistLinks: result.rejectedByAllowlistLinks,
          at: new Date().toISOString(),
        });
      } catch (error) {
        checkpoint.failed += 1;
        await appendJsonl(failuresJsonl, {
          lnhpdId: row.lnhpd_id,
          npn,
          brandName: row.brand_name,
          productName: row.product_name,
          failCode: "exception",
          message: error instanceof Error ? error.message : String(error),
          at: new Date().toISOString(),
        });
      }

      await saveCheckpoint(checkpoint);
    }

    checkpoint.listIndex += pendingNpns.length;
    await saveCheckpoint(checkpoint);
  }

  const coverage = await loadCoverage();
  const consideredLinks = checkpoint.consideredLinks;
  const blockedLinks = checkpoint.blockedDomainLinks;
  const allowlistRejectedLinks = checkpoint.rejectedByAllowlistLinks;
  const totalEvaluatedLinks = consideredLinks + blockedLinks + allowlistRejectedLinks;
  const totalWrites = checkpoint.inserted + checkpoint.conflicts + checkpoint.skippedSameBarcode;

  const summary = {
    startedAt,
    finishedAt: new Date().toISOString(),
    sourceName,
    dryRun,
    writeFacts,
    skipExistingNpn,
    allowPrimaryOverlap,
    disableDdg,
    disableBing,
    npnFile,
    npnListSize: npnList.length,
    pageSize,
    maxNpns,
    maxQueriesPerNpn,
    queryDelayMs,
    ddgTimeoutMs,
    htmlTimeoutMs,
    maxBarcodesPerNpn,
    maxLinksPerNpn,
    qualityGate: {
      blockedDomains: Array.from(blockedDomains).sort(),
      allowedDomains: allowedDomains ? Array.from(allowedDomains).sort() : null,
      blockedDomainLinks: blockedLinks,
      rejectedByAllowlistLinks: allowlistRejectedLinks,
      consideredLinks,
      totalEvaluatedLinks,
      blockedDomainRate: ratio(blockedLinks, totalEvaluatedLinks),
      allowlistRejectedRate: ratio(allowlistRejectedLinks, totalEvaluatedLinks),
      conflictCandidatesBlocked: checkpoint.conflicts,
      conflictBlockRate: ratio(checkpoint.conflicts, totalWrites),
    },
    coverage,
    checkpoint,
    output: {
      checkpointFile,
      summaryJson,
      matchesJsonl,
      failuresJsonl,
    },
  };

  await writeJson(summaryJson, summary);
  console.log(JSON.stringify(summary, null, 2));
};

main().catch((error) => {
  console.error("[lnhpd-barcode-ddg] Fatal error", error);
  process.exitCode = 1;
});
