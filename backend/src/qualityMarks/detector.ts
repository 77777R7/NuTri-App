import type { QualityMarkProviderSource } from "./types.js";

const normalize = (value: string): string => value.replace(/\s+/g, " ").trim().toLowerCase();

const QUALITY_MARK_PATTERNS: Array<{ label: string; re: RegExp }> = [
  { label: "USP Verified", re: /\busp\b(?:\s*verified)?/i },
  { label: "NSF", re: /\bnsf\b(?:\s*certified(?:\s*for\s*sport)?)?/i },
  { label: "Informed Choice", re: /\binformed\s*choice\b/i },
  { label: "Informed Sport", re: /\binformed\s*sport\b/i },
  { label: "BSCG", re: /\bbscg\b/i },
  { label: "ConsumerLab", re: /\bconsumerlab\b/i },
];

export type QualityMarkDetection = {
  status: "detected" | "not_detected" | "unknown";
  checked: boolean;
  confidence: number | null;
  confidenceBucket: "high" | "medium" | "low";
  evidenceRef: string | null;
  evidenceType: "page" | "search" | null;
  checkedMode: "search_only" | "page_fetch";
  pagesFetchedCount: number;
  searchPagesFetchedCount: number;
  note: string;
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

export const detectQualityMarkFromHtml = (
  html: string | null,
  source: QualityMarkProviderSource,
  minNotDetectedConfidence = 0.8,
): QualityMarkDetection => {
  const isSearchOnlySource = /duckduckgo\.com\/html\/\?q=/i.test(source.url);
  if (!html || !html.trim()) {
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
    };
  }
  const text = sanitizeHtml(html);
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

  for (const candidate of QUALITY_MARK_PATTERNS) {
    const match = normalized.match(candidate.re);
    if (!match || typeof match.index !== "number") continue;
    // Guard against weak mentions (e.g. comment snippets) without any “logo/seal/tested/certified” cues.
    if (!hasLogoCueNearby(normalized, match.index)) {
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
        note: `Potential ${candidate.label} mention found but evidence quality is too weak.`,
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
      note: `Detected ${candidate.label} from source content.`,
    };
  }

  const confidence = source.sourceType === "brand_official" ? 0.86 : 0.82;
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
  };
};
