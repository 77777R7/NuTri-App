import {
  buildQualityMarkProgramMatches,
  evaluateOfficialRegistryTextMatch,
  summarizeQualityMarkProgramMatches,
} from "./matchers.js";
import { QUALITY_MARK_PROGRAMS } from "./programs.js";
import type {
  QualityMarkFetchResult,
  QualityMarkProgramMatch,
  QualityMarkProviderSource,
  QualityMarkVerificationSummary,
} from "./types.js";

const normalize = (value: string): string => value.replace(/\s+/g, " ").trim().toLowerCase();

export type QualityMarkDetection = {
  status: "detected" | "not_detected" | "unknown";
  checked: boolean;
  confidence: number | null;
  confidenceBucket: "high" | "medium" | "low";
  evidenceRef: string | null;
  evidenceType: "page" | "search" | "official_registry" | null;
  checkedMode: "search_only" | "page_fetch";
  pagesFetchedCount: number;
  searchPagesFetchedCount: number;
  note: string;
  programMatches: QualityMarkProgramMatch[];
  verificationSummary: QualityMarkVerificationSummary | null;
};

type OfficialRegistrySignals = {
  registryText: string;
  hasResults: boolean;
  explicitNoResults: boolean;
  extraWarnings: string[];
  candidateTexts: string[];
};

const toBucket = (confidence: number): "high" | "medium" | "low" =>
  confidence >= 0.85 ? "high" : confidence >= 0.65 ? "medium" : "low";

const sanitizeHtml = (html: string): string =>
  html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/\s+/g, " ")
    .trim();

const hasLogoCueNearby = (text: string, index: number): boolean => {
  const left = Math.max(0, index - 80);
  const right = Math.min(text.length, index + 80);
  const span = text.slice(left, right);
  return /\blogo\b|\bseal\b|\bicon\b|\bcertified\b|\btested\b|\bquality\b/i.test(span);
};

const toFetchResult = (input: string | null | QualityMarkFetchResult): QualityMarkFetchResult =>
  typeof input === "string" || input === null
    ? {
        ok: Boolean(input && input.trim()),
        body: input,
        error: input ? null : "empty_body",
        statusCode: input ? 200 : null,
        contentType: input ? "text/html" : null,
      }
    : input;

const extractAnchorTexts = (html: string): string[] =>
  Array.from(html.matchAll(/<a\b[^>]*>([\s\S]*?)<\/a>/gi))
    .map((match) => sanitizeHtml(match[1] ?? ""))
    .filter(Boolean);

const parseNutrasourceBody = (body: string | null): { html: string; hasResults: boolean; candidateTexts: string[] } => {
  if (!body) return { html: "", hasResults: false, candidateTexts: [] };
  try {
    const payload = JSON.parse(body) as {
      html?: string;
      success?: boolean;
      list?: Array<Record<string, unknown>>;
    };
    const html = typeof payload?.html === "string" ? payload.html : "";
    const list = Array.isArray(payload?.list) ? payload.list : [];
    const candidateTexts = list
      .flatMap((row) => [
        typeof row?.ProductName === "string" ? row.ProductName : null,
        typeof row?.Name === "string" ? row.Name : null,
      ])
      .filter((value): value is string => Boolean(value && value.trim()));
    return {
      html,
      hasResults: Boolean(payload?.success) && html.trim().length > 0,
      candidateTexts: [...candidateTexts, ...extractAnchorTexts(html)],
    };
  } catch {
    return { html: "", hasResults: false, candidateTexts: [] };
  }
};

const extractInformedRegistryResultText = (body: string): { registryText: string; resultCount: number } => {
  const resultBlocks = Array.from(
    body.matchAll(/<div[^>]*\bviews-row\b[\s\S]*?<a\b[\s\S]*?<\/a>/gi),
  ).map((match) => match[0]);
  return {
    registryText: sanitizeHtml(resultBlocks.join(" ")),
    resultCount: resultBlocks.length,
  };
};

const extractNutrasourceDetailSignals = (body: string): OfficialRegistrySignals => {
  const registryText = sanitizeHtml(body);
  const lowerBody = body.toLowerCase();
  const titleText =
    body.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1]
      ?.replace(/\| Certifications by Nutrasource/gi, "")
      ?.split("|")
      .map((value) => sanitizeHtml(value))
      .filter(Boolean) ?? [];
  const headingTexts = Array.from(body.matchAll(/<h[1-3][^>]*>([\s\S]*?)<\/h[1-3]>/gi))
    .map((match) => sanitizeHtml(match[1] ?? ""))
    .filter(Boolean);
  const hasIfosCue = /ifos(?:™)? testing results|certified ifos/i.test(body);
  return {
    registryText,
    hasResults: hasIfosCue && registryText.length > 0,
    explicitNoResults: /product not found|page not found|404/i.test(lowerBody),
    extraWarnings: hasIfosCue ? ["nutrasource_detail_page"] : [],
    candidateTexts: [...titleText, ...headingTexts],
  };
};

const extractNutrasourceBrandDetailSignals = (body: string): OfficialRegistrySignals => {
  const registryText = sanitizeHtml(body);
  const lowerBody = body.toLowerCase();
  const candidateTexts = Array.from(
    body.matchAll(/href="\/certified-products\/product\?id=[^"]+"[^>]*>\s*([^<]+?)\s*<\/a>/gi),
  )
    .map((match) => sanitizeHtml(match[1] ?? ""))
    .filter(Boolean);
  return {
    registryText,
    hasResults: candidateTexts.length > 0,
    explicitNoResults: /product not found|page not found|404/i.test(lowerBody),
    extraWarnings: candidateTexts.length > 0 ? ["nutrasource_brand_detail_page"] : [],
    candidateTexts,
  };
};

const extractOfficialRegistrySignals = (
  fetchResult: QualityMarkFetchResult,
  source: QualityMarkProviderSource,
): OfficialRegistrySignals => {
  if (source.adapterKind === "nutrasource_brand_search" || source.adapterKind === "nutrasource_product_search") {
    const parsed = parseNutrasourceBody(fetchResult.body);
    return {
      registryText: sanitizeHtml(parsed.html),
      hasResults: parsed.hasResults,
      explicitNoResults: !parsed.hasResults,
      extraWarnings: [],
      candidateTexts: parsed.candidateTexts,
    };
  }

  const body = fetchResult.body ?? "";
  const registryText = sanitizeHtml(body);
  const lowerBody = body.toLowerCase();

  if (source.adapterKind === "nsf_search") {
    const hasResults = /results__product-name|results__company-name/i.test(body);
    const candidateTexts = Array.from(
      body.matchAll(/class="results__product-name"[^>]*>([\s\S]*?)<\/[^>]+>/gi),
    )
      .map((match) => sanitizeHtml(match[1] ?? ""))
      .filter(Boolean);
    const explicitNoResults =
      /no results|0 results|sorry, no results|no certified products found/i.test(lowerBody) ||
      (!hasResults && /search-results\.php|search results for/i.test(lowerBody));
    return { registryText, hasResults, explicitNoResults, extraWarnings: [], candidateTexts };
  }

  if (source.adapterKind === "informed_choice_search" || source.adapterKind === "informed_sport_search") {
    const extracted = extractInformedRegistryResultText(body);
    const explicitNoResults =
      /no results were found|no results|0 results|no supplements found/i.test(lowerBody) ||
      /app-no-results/i.test(body);
    const hasResults = extracted.resultCount > 0 && !explicitNoResults;
    return {
      registryText: hasResults ? extracted.registryText : registryText,
      hasResults,
      explicitNoResults,
      extraWarnings: [],
      candidateTexts: [],
    };
  }

  if (source.adapterKind === "usp_listing") {
    return {
      registryText,
      hasResults: registryText.length > 0,
      explicitNoResults: /no results|no products found/i.test(lowerBody),
      extraWarnings: [],
      candidateTexts: [],
    };
  }

  if (source.adapterKind === "nutrasource_product_detail") {
    return extractNutrasourceDetailSignals(body);
  }

  if (source.adapterKind === "nutrasource_brand_detail") {
    return extractNutrasourceBrandDetailSignals(body);
  }

  return {
    registryText,
    hasResults: registryText.length > 0,
    explicitNoResults: false,
    extraWarnings: [],
    candidateTexts: [],
  };
};

const detectFromOfficialRegistry = (
  fetchResult: QualityMarkFetchResult,
  source: QualityMarkProviderSource,
): QualityMarkDetection => {
  const programId = source.programId;
  if (!programId) {
    return {
      status: "unknown",
      checked: false,
      confidence: null,
      confidenceBucket: "low",
      evidenceRef: source.url,
      evidenceType: "official_registry",
      checkedMode: "page_fetch",
      pagesFetchedCount: 1,
      searchPagesFetchedCount: 0,
      note: "Official registry source is missing program metadata.",
      programMatches: [],
      verificationSummary: summarizeQualityMarkProgramMatches({
        programMatches: [],
        checked: true,
        extraWarnings: ["registry_adapter_misconfigured"],
      }),
    };
  }

  const blockedByRegistry = [401, 403, 429].includes(fetchResult.statusCode ?? 0);
  if (blockedByRegistry) {
    const verificationSummary = summarizeQualityMarkProgramMatches({
      programMatches: [],
      checked: false,
      extraWarnings: ["registry_access_blocked"],
    });
    return {
      status: "unknown",
      checked: false,
      confidence: null,
      confidenceBucket: "low",
      evidenceRef: source.url,
      evidenceType: "official_registry",
      checkedMode: "page_fetch",
      pagesFetchedCount: 1,
      searchPagesFetchedCount: 0,
      note: `Official ${QUALITY_MARK_PROGRAMS.find((program) => program.id === programId)?.label ?? "registry"} access was blocked, so verification remains unproven.`,
      programMatches: [],
      verificationSummary,
    };
  }

  if (!fetchResult.ok || !fetchResult.body?.trim()) {
    return {
      status: "unknown",
      checked: false,
      confidence: null,
      confidenceBucket: "low",
      evidenceRef: source.url,
      evidenceType: "official_registry",
      checkedMode: "page_fetch",
      pagesFetchedCount: 1,
      searchPagesFetchedCount: 0,
      note: "Official registry could not be read.",
      programMatches: [],
      verificationSummary: summarizeQualityMarkProgramMatches({
        programMatches: [],
        checked: false,
        extraWarnings: ["registry_fetch_failed"],
      }),
    };
  }

  const signals = extractOfficialRegistrySignals(fetchResult, source);
  const matchSignals = evaluateOfficialRegistryTextMatch({
    registryText: signals.registryText,
    brandName: source.brandName,
    productName: source.productName,
    candidateTexts: signals.candidateTexts,
  });

  if (!signals.explicitNoResults && signals.hasResults && matchSignals.productMatched && (matchSignals.brandMatched || !source.brandName)) {
    const programMatches = buildQualityMarkProgramMatches({
      programIds: [programId],
      status: "verified_registry_match",
      evidenceUrl: source.url,
      evidenceType: "official_registry",
      sourceType: "official_registry",
      confidence: 0.97,
      matchLevel: "product",
      brandMatched: matchSignals.brandMatched,
      productMatched: true,
      note: "Official registry returned a product-level match.",
    });
    const verificationSummary = summarizeQualityMarkProgramMatches({
      programMatches,
      checked: true,
      extraWarnings: signals.extraWarnings,
    });
    return {
      status: "detected",
      checked: true,
      confidence: 0.97,
      confidenceBucket: "high",
      evidenceRef: source.url,
      evidenceType: "official_registry",
      checkedMode: "page_fetch",
      pagesFetchedCount: 1,
      searchPagesFetchedCount: 0,
      note: `Official ${programMatches[0]?.programLabel ?? "registry"} verification matched this product.`,
      programMatches,
      verificationSummary,
    };
  }

  if (
    !signals.explicitNoResults &&
    signals.hasResults &&
    matchSignals.productMatched &&
    source.adapterKind === "nutrasource_product_search" &&
    source.brandName
  ) {
    const programMatches = buildQualityMarkProgramMatches({
      programIds: [programId],
      status: "ambiguous_match",
      evidenceUrl: source.url,
      evidenceType: "official_registry",
      sourceType: "official_registry",
      confidence: 0.74,
      matchLevel: "product",
      brandMatched: false,
      productMatched: true,
      note: "Official registry matched product naming, but brand confirmation still depends on the brand-level result.",
    });
    const verificationSummary = summarizeQualityMarkProgramMatches({
      programMatches,
      checked: true,
      extraWarnings: [...signals.extraWarnings, "product_match_without_brand_confirmation"],
    });
    return {
      status: "unknown",
      checked: true,
      confidence: 0.74,
      confidenceBucket: "medium",
      evidenceRef: source.url,
      evidenceType: "official_registry",
      checkedMode: "page_fetch",
      pagesFetchedCount: 1,
      searchPagesFetchedCount: 0,
      note: `Official ${programMatches[0]?.programLabel ?? "registry"} product naming matched, but brand confirmation still needs the brand-level registry result.`,
      programMatches,
      verificationSummary,
    };
  }

  if (!signals.explicitNoResults && signals.hasResults && matchSignals.brandMatched) {
    const programMatches = buildQualityMarkProgramMatches({
      programIds: [programId],
      status: "ambiguous_match",
      evidenceUrl: source.url,
      evidenceType: "official_registry",
      sourceType: "official_registry",
      confidence: 0.68,
      matchLevel: "brand",
      brandMatched: true,
      productMatched: false,
      note: "Official registry matched the brand but not the product with enough confidence.",
    });
    const verificationSummary = summarizeQualityMarkProgramMatches({
      programMatches,
      checked: true,
      extraWarnings: [...signals.extraWarnings, "brand_level_only_match"],
    });
    return {
      status: "unknown",
      checked: true,
      confidence: 0.68,
      confidenceBucket: "medium",
      evidenceRef: source.url,
      evidenceType: "official_registry",
      checkedMode: "page_fetch",
      pagesFetchedCount: 1,
      searchPagesFetchedCount: 0,
      note: `Official ${programMatches[0]?.programLabel ?? "registry"} results only support a brand-level match so far.`,
      programMatches,
      verificationSummary,
    };
  }

  const programMatches = buildQualityMarkProgramMatches({
    programIds: [programId],
    status: "not_found_in_registry",
    evidenceUrl: source.url,
    evidenceType: "official_registry",
    sourceType: "official_registry",
    confidence: 0.9,
    matchLevel: "product",
    brandMatched: false,
    productMatched: false,
    note: signals.explicitNoResults
      ? "Official registry returned no matching results."
      : "Official registry was checked and no product-level match was confirmed.",
  });
  const verificationSummary = summarizeQualityMarkProgramMatches({
    programMatches,
    checked: true,
    extraWarnings: signals.extraWarnings,
  });
  return {
    status: "not_detected",
    checked: true,
    confidence: 0.9,
    confidenceBucket: "high",
    evidenceRef: source.url,
    evidenceType: "official_registry",
    checkedMode: "page_fetch",
    pagesFetchedCount: 1,
    searchPagesFetchedCount: 0,
    note: `Official ${programMatches[0]?.programLabel ?? "registry"} verification is not currently proven for this product.`,
    programMatches,
    verificationSummary,
  };
};

export const detectQualityMarkFromHtml = (
  htmlOrFetchResult: string | null | QualityMarkFetchResult,
  source: QualityMarkProviderSource,
  minNotDetectedConfidence = 0.8,
): QualityMarkDetection => {
  const fetchResult = toFetchResult(htmlOrFetchResult);
  const isSearchOnlySource = /duckduckgo\.com\/html\/\?q=/i.test(source.url);
  if (source.sourceType === "official_registry") {
    return detectFromOfficialRegistry(fetchResult, source);
  }

  if (!fetchResult.body || !fetchResult.body.trim()) {
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
      note: "No HTML content available for this source.",
      programMatches: [],
      verificationSummary: null,
    };
  }

  const text = sanitizeHtml(fetchResult.body);
  const normalized = normalize(text);
  if (!normalized) {
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
      note: "Source content was empty after sanitization.",
      programMatches: [],
      verificationSummary: null,
    };
  }

  if (isSearchOnlySource) {
    const verificationSummary = summarizeQualityMarkProgramMatches({
      programMatches: [],
      checked: true,
      searchOnlyEvidence: true,
    });
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
      programMatches: [],
      verificationSummary,
    };
  }

  const strongProgramIds = new Set<string>();
  const weakProgramLabels: string[] = [];

  for (const candidate of QUALITY_MARK_PROGRAMS) {
    const match = normalized.match(candidate.spacedPattern) ?? normalized.match(candidate.compactPattern);
    if (!match) continue;
    if (typeof match.index === "number" && hasLogoCueNearby(normalized, match.index)) {
      strongProgramIds.add(candidate.id);
      continue;
    }
    weakProgramLabels.push(candidate.label);
  }

  if (strongProgramIds.size > 0) {
    const programMatches = buildQualityMarkProgramMatches({
      programIds: Array.from(strongProgramIds) as Array<(typeof QUALITY_MARK_PROGRAMS)[number]["id"]>,
      status: "claimed_on_product_page",
      evidenceUrl: source.url,
      evidenceType: "page",
      sourceType: source.sourceType,
      confidence: 0.92,
      matchLevel: "product",
      brandMatched: true,
      productMatched: true,
      note: "Detected from fetched source content.",
    });
    const verificationSummary = summarizeQualityMarkProgramMatches({
      programMatches,
      checked: true,
    });
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
      note: `Detected ${programMatches.map((match) => match.programLabel).join(", ")} from source content.`,
      programMatches,
      verificationSummary,
    };
  }

  if (weakProgramLabels.length > 0) {
    const verificationSummary = summarizeQualityMarkProgramMatches({
      programMatches: [],
      checked: true,
    });
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
      note: `Potential ${weakProgramLabels.join(", ")} mention found but evidence quality is too weak.`,
      programMatches: [],
      verificationSummary,
    };
  }

  const confidence = source.sourceType === "brand_official" ? 0.86 : 0.82;
  const verificationSummary = summarizeQualityMarkProgramMatches({
    programMatches: [],
    checked: true,
  });
  return {
    status: confidence >= minNotDetectedConfidence ? "not_detected" : "unknown",
    checked: true,
    confidence,
    confidenceBucket: toBucket(confidence),
    evidenceRef: source.url,
    evidenceType: "page",
    checkedMode: "page_fetch",
    pagesFetchedCount: 1,
    searchPagesFetchedCount: 0,
    note: "Source checked and no quality-mark signal was confidently detected.",
    programMatches: [],
    verificationSummary,
  };
};
