import fs from "node:fs";
import path from "node:path";

import { isHighQualityDomain, isMarketplaceDomain } from "./searchQuality.js";

export type OwnershipTier = "strong" | "weak" | "failed";

export type OwnershipEvidence = {
  hasBarcodeMatch: boolean;
  hasRegulatoryIdMatch: boolean;
  hasBrandSignal: boolean;
  hasNameSignal: boolean;
  providerGtinMatch: boolean;
};

export type ProviderVerdict = {
  ownershipVerdict: OwnershipTier;
  reason: string;
  providerUsed: string | null;
  providerGtinMatch: boolean;
  providerBrand: string | null;
  providerProductName: string | null;
  providerSourceUrl: string | null;
};

export type IdentityProviderResult = {
  provider: string;
  brand: string | null;
  productName: string | null;
  gtinMatched: boolean;
  confidence: "strong" | "medium" | "failed";
  sourceUrl: string | null;
};

export type IdentityProvider = {
  id: string;
  lookup: (params: {
    barcode: string;
    timeoutMs: number;
    apiKey?: string | null;
  }) => Promise<IdentityProviderResult | null>;
};

export type ProviderLookupConfig = {
  enabled: boolean;
  order: string[];
  timeoutMs: number;
  upcItemDbApiKey?: string | null;
};

export type WebCandidateForSelection = {
  url: string;
  domain: string;
  isMarketplace: boolean;
  isAuthoritative: boolean;
  strongOwnership: boolean;
  rankScore: number;
};

export type WebCandidateSelection = {
  selected: WebCandidateForSelection[];
  authoritativeCandidatePresent: boolean;
  marketplaceRejectedCount: number;
};

const withFetchTimeout = async (
  url: string,
  timeoutMs: number,
  init?: RequestInit,
): Promise<Response | null> => {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), Math.max(100, timeoutMs));
  try {
    const response = await fetch(url, {
      ...init,
      signal: controller.signal,
    });
    return response;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
};

const normalizeBarcodeDigits = (value: string): string => value.replace(/\D/g, "");
const toBarcodeCandidates = (value: string): string[] => {
  const digits = normalizeBarcodeDigits(value);
  if (!digits) return [];
  const set = new Set<string>();
  set.add(digits);
  if (digits.length <= 14) set.add(digits.padStart(14, "0"));
  if (digits.length === 14 && /^0+/.test(digits)) set.add(digits.replace(/^0+/, ""));
  return Array.from(set).filter(Boolean);
};

const normalizeText = (value?: string | null): string | null => {
  const normalized = (value ?? "").replace(/\s+/g, " ").trim();
  return normalized.length > 0 ? normalized : null;
};

type OffSeedRow = {
  barcode?: string;
  barcode_gtin14?: string;
  brand?: string | null;
  productName?: string | null;
  sourceUrl?: string | null;
  lane?: "primary" | "shadow_usca" | string;
};

let offSeedLoadAttempted = false;
let offSeedIndex: Map<string, OffSeedRow> = new Map();

const resolveLatestOffSeedRunDir = (): string | null => {
  const baseDir = process.env.OFF_SEED_BASE_DIR ?? path.join(process.cwd(), "output", "off_candidates");
  try {
    const entries = fs.readdirSync(baseDir, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name)
      .sort((a, b) => b.localeCompare(a));
    if (entries.length === 0) return null;
    return path.join(baseDir, entries[0] ?? "");
  } catch {
    return null;
  }
};

const resolveOffSeedPaths = (): string[] => {
  const explicitPrimary = process.env.OFF_SEED_PRIMARY_PATH;
  const explicitShadow = process.env.OFF_SEED_SHADOW_PATH;
  if (explicitPrimary || explicitShadow) {
    return [explicitPrimary, explicitShadow].filter((value): value is string => Boolean(value));
  }

  const baseDir = process.env.OFF_SEED_BASE_DIR ?? path.join(process.cwd(), "output", "off_candidates");
  const runId = process.env.OFF_SEED_RUN_ID?.trim();
  const runDir = runId ? path.join(baseDir, runId) : resolveLatestOffSeedRunDir();
  if (!runDir) return [];
  return [
    path.join(runDir, "candidates.primary.jsonl"),
    path.join(runDir, "candidates.shadow_usca.jsonl"),
  ];
};

const loadOffSeedIndexOnce = (): Map<string, OffSeedRow> => {
  if (offSeedLoadAttempted) return offSeedIndex;
  offSeedLoadAttempted = true;

  const rowsByBarcode = new Map<string, OffSeedRow>();
  const paths = resolveOffSeedPaths();
  for (const filePath of paths) {
    if (!filePath || !fs.existsSync(filePath)) continue;
    let raw = "";
    try {
      raw = fs.readFileSync(filePath, "utf8");
    } catch {
      continue;
    }
    const lines = raw.split(/\r?\n/);
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      let parsed: OffSeedRow;
      try {
        parsed = JSON.parse(trimmed) as OffSeedRow;
      } catch {
        continue;
      }
      const barcode = normalizeBarcodeDigits(
        String(parsed.barcode_gtin14 ?? parsed.barcode ?? ""),
      );
      if (!barcode) continue;

      const prev = rowsByBarcode.get(barcode);
      const nextLane = parsed.lane === "primary" ? "primary" : "shadow_usca";
      const prevLane = prev?.lane === "primary" ? "primary" : prev?.lane === "shadow_usca" ? "shadow_usca" : null;
      if (!prev || (prevLane !== "primary" && nextLane === "primary")) {
        rowsByBarcode.set(barcode, { ...parsed, lane: nextLane });
      }
    }
  }

  offSeedIndex = rowsByBarcode;
  return offSeedIndex;
};

const openFoodFactsProvider: IdentityProvider = {
  id: "openfoodfacts",
  lookup: async ({ barcode, timeoutMs }) => {
    const digits = normalizeBarcodeDigits(barcode);
    if (!digits) return null;
    const url = `https://world.openfoodfacts.org/api/v2/product/${encodeURIComponent(
      digits,
    )}.json?fields=code,product_name,brands`;
    const response = await withFetchTimeout(url, timeoutMs, {
      headers: { Accept: "application/json" },
    });
    if (!response || !response.ok) return null;
    let payload: unknown;
    try {
      payload = await response.json();
    } catch {
      return null;
    }
    if (!payload || typeof payload !== "object") return null;
    const record = payload as Record<string, unknown>;
    const status = typeof record.status === "number" ? record.status : 0;
    if (status !== 1) return null;
    const product = record.product;
    if (!product || typeof product !== "object") return null;
    const productRecord = product as Record<string, unknown>;
    const code = normalizeBarcodeDigits(String(productRecord.code ?? ""));
    const productName = normalizeText(
      typeof productRecord.product_name === "string" ? productRecord.product_name : null,
    );
    const brandsRaw =
      typeof productRecord.brands === "string" ? productRecord.brands : null;
    const brand = normalizeText(brandsRaw?.split(",")[0] ?? null);
    const gtinMatched = Boolean(code && digits && code === digits);
    return {
      provider: "openfoodfacts",
      brand,
      productName,
      gtinMatched,
      confidence: gtinMatched ? "strong" : "medium",
      sourceUrl: code ? `https://world.openfoodfacts.org/product/${code}` : url,
    };
  },
};

const upcItemDbProvider: IdentityProvider = {
  id: "upcitemdb",
  lookup: async ({ barcode, timeoutMs, apiKey }) => {
    const digits = normalizeBarcodeDigits(barcode);
    if (!digits || !apiKey) return null;
    const url = `https://api.upcitemdb.com/prod/trial/lookup?upc=${encodeURIComponent(digits)}`;
    const response = await withFetchTimeout(url, timeoutMs, {
      headers: {
        Accept: "application/json",
        user_key: apiKey,
      },
    });
    if (!response || !response.ok) return null;
    let payload: unknown;
    try {
      payload = await response.json();
    } catch {
      return null;
    }
    if (!payload || typeof payload !== "object") return null;
    const items = (payload as Record<string, unknown>).items;
    if (!Array.isArray(items) || items.length === 0) return null;
    const first = items[0];
    if (!first || typeof first !== "object") return null;
    const row = first as Record<string, unknown>;
    const upc = normalizeBarcodeDigits(String(row.upc ?? ""));
    const title = normalizeText(typeof row.title === "string" ? row.title : null);
    const brand = normalizeText(typeof row.brand === "string" ? row.brand : null);
    const offers = Array.isArray(row.offers) ? row.offers : [];
    let sourceUrl: string | null = null;
    const firstOffer = offers[0];
    if (firstOffer && typeof firstOffer === "object") {
      const link = (firstOffer as Record<string, unknown>).link;
      if (typeof link === "string") sourceUrl = link;
    }
    const gtinMatched = Boolean(upc && digits && upc === digits);
    return {
      provider: "upcitemdb",
      brand,
      productName: title,
      gtinMatched,
      confidence: gtinMatched ? "strong" : "medium",
      sourceUrl,
    };
  },
};

const offSeedProvider: IdentityProvider = {
  id: "off_seed",
  lookup: async ({ barcode }) => {
    const index = loadOffSeedIndexOnce();
    if (!index.size) return null;
    const barcodeCandidates = toBarcodeCandidates(barcode);
    if (!barcodeCandidates.length) return null;

    let hit: OffSeedRow | null = null;
    let hitBarcode: string | null = null;
    for (const candidate of barcodeCandidates) {
      const row = index.get(candidate);
      if (!row) continue;
      hit = row;
      hitBarcode = candidate;
      break;
    }
    if (!hit || !hitBarcode) return null;

    const lane = hit.lane === "primary" ? "primary" : "shadow_usca";
    const sourceUrl =
      normalizeText(hit.sourceUrl) ??
      `https://world.openfoodfacts.org/product/${hitBarcode.replace(/^0+/, "")}`;

    return {
      provider: "off_seed",
      brand: normalizeText(hit.brand),
      productName: normalizeText(hit.productName),
      gtinMatched: true,
      confidence: lane === "primary" ? "strong" : "medium",
      sourceUrl,
    };
  },
};

const PROVIDER_REGISTRY: Record<string, IdentityProvider> = {
  off_seed: offSeedProvider,
  openfoodfacts: openFoodFactsProvider,
  upcitemdb: upcItemDbProvider,
};

export const resolveIdentityProviderLookup = async (
  barcode: string,
  config: ProviderLookupConfig,
): Promise<IdentityProviderResult | null> => {
  if (!config.enabled) return null;
  const order = Array.from(
    new Set(
      (config.order.length > 0 ? config.order : ["openfoodfacts"])
        .map((entry) => entry.trim().toLowerCase())
        .filter(Boolean),
    ),
  );
  for (const providerId of order) {
    const provider = PROVIDER_REGISTRY[providerId];
    if (!provider) continue;
    const result = await provider.lookup({
      barcode,
      timeoutMs: config.timeoutMs,
      apiKey: providerId === "upcitemdb" ? config.upcItemDbApiKey ?? null : null,
    });
    if (result) return result;
  }
  return null;
};

export const buildProviderVerdict = (
  evidence: OwnershipEvidence,
  providerResult: IdentityProviderResult | null,
): ProviderVerdict => {
  const providerGtinMatch = Boolean(providerResult?.gtinMatched);
  if (evidence.hasBarcodeMatch || evidence.hasRegulatoryIdMatch || providerGtinMatch) {
    return {
      ownershipVerdict: "strong",
      reason: evidence.hasBarcodeMatch
        ? "barcode_match"
        : evidence.hasRegulatoryIdMatch
          ? "regulatory_id_match"
          : "provider_gtin_match",
      providerUsed: providerResult?.provider ?? null,
      providerGtinMatch,
      providerBrand: providerResult?.brand ?? null,
      providerProductName: providerResult?.productName ?? null,
      providerSourceUrl: providerResult?.sourceUrl ?? null,
    };
  }
  if (evidence.hasBrandSignal || evidence.hasNameSignal) {
    return {
      ownershipVerdict: "weak",
      reason: "name_or_brand_only",
      providerUsed: providerResult?.provider ?? null,
      providerGtinMatch,
      providerBrand: providerResult?.brand ?? null,
      providerProductName: providerResult?.productName ?? null,
      providerSourceUrl: providerResult?.sourceUrl ?? null,
    };
  }
  return {
    ownershipVerdict: "failed",
    reason: "missing_identity_signals",
    providerUsed: providerResult?.provider ?? null,
    providerGtinMatch,
    providerBrand: providerResult?.brand ?? null,
    providerProductName: providerResult?.productName ?? null,
    providerSourceUrl: providerResult?.sourceUrl ?? null,
  };
};

export const selectBestWebCandidates = (
  rows: WebCandidateForSelection[],
  maxCount = 2,
): WebCandidateSelection => {
  const sorted = [...rows].sort((a, b) => b.rankScore - a.rankScore);
  const authoritativeCandidatePresent = sorted.some(
    (row) => !row.isMarketplace && row.isAuthoritative,
  );
  let marketplaceRejectedCount = 0;
  const filtered = sorted.filter((row) => {
    if (!row.isMarketplace) return true;
    if (authoritativeCandidatePresent) {
      marketplaceRejectedCount += 1;
      return false;
    }
    if (!row.strongOwnership) {
      marketplaceRejectedCount += 1;
      return false;
    }
    return true;
  });
  const selected = (filtered.length > 0 ? filtered : sorted).slice(0, Math.max(1, maxCount));
  return {
    selected,
    authoritativeCandidatePresent,
    marketplaceRejectedCount,
  };
};

export const isAuthoritativeWebCandidate = (domain: string): boolean => {
  if (!domain) return false;
  if (isMarketplaceDomain(domain)) return false;
  return isHighQualityDomain(domain);
};
