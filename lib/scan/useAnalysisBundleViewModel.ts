import { useMemo } from 'react';

import { lookupFoundationForIngredient } from '@/lib/knowledge/foundationLookup';
import { enforceNeverBlank, isPlaceholderText, sanitizeCoverBullets, sanitizeCoverLine } from '@/lib/scan/neverBlank';
import { resolveTrustedDisplayIdentity } from '@/lib/scan/resolveTrustedDisplayIdentity';
import type { InsightsDTO, FactsDTO } from '@/shared/types/scan-insights';
import type {
  AnalysisBundle,
  IngredientsDetail,
  SafetyCover,
  UsageCover,
  UsageDetail,
} from '@/types/analysisBundle';
import type { ScoreBundleV4 } from '@/types/scoreBundle';

export type ScoreUiMode = 'not_scored' | 'scoring' | 'scored';
export type SourceAttribution = 'verified_regulatory' | 'label_record' | 'web_hint_unverified';
type PlaceholderModule = 'overview' | 'science' | 'usage' | 'safety';

export type PlaceholderObservabilityCounts = {
  overview: number;
  science: number;
  usage: number;
  safety: number;
  total: number;
};

const createPlaceholderCounts = (): PlaceholderObservabilityCounts => ({
  overview: 0,
  science: 0,
  usage: 0,
  safety: 0,
  total: 0,
});

const bumpPlaceholderCount = (
  counts: PlaceholderObservabilityCounts,
  module: PlaceholderModule,
) => {
  counts[module] += 1;
  counts.total += 1;
};

export type AnalysisBundleScoreViewModel = {
  mode: ScoreUiMode;
  overall: number | null;
  effectiveness: number | null;
  safety: number | null;
  integrity: number | null;
  confidence: number | null;
  metaLines: string[];
};

export type AnalysisBundleViewModel = {
  productTitle: string;
  productSubtitle: string;
  sourceAttribution: SourceAttribution;
  score: AnalysisBundleScoreViewModel;
  overview: {
    summary: string;
    bullets: string[];
    detail: string[];
  };
  science: {
    coverIngredients: string[];
    detailTop3: string[];
    overallSummary: string;
    detail: string[];
  };
  usage: {
    bestTime: string;
    dosage: string;
    bullets: string[];
    scheduleFromLabel: string[];
    ulGuidance: string[];
    ulGuidanceItems: {
      text: string;
      sourceLabel: string | null;
      sourceUrl: string | null;
      canOpenLink: boolean;
      scope: string | null;
      reasonCode: string | null;
    }[];
    detail: string[];
  };
  safety: {
    verdict: string;
    bullets: string[];
    dataStatus: string;
    odsWatchOuts: string[];
    detail: string[];
  };
  debug: {
    rawPlaceholderCount: PlaceholderObservabilityCounts;
    sanitizedPlaceholderCount: PlaceholderObservabilityCounts;
  };
};

type UlWarningEntry = {
  ingredient: string;
  currentDose: string | null;
  ulLimit: string | null;
  riskLevel: string | null;
  scope: string | null;
  sourceUrl: string | null;
  scopeNote: string | null;
  reasonCode: string | null;
};

type UlMissingReasonCounts = {
  noUlEstablished: number;
  canonicalAliasMiss: number;
  unitConversionUncertain: number;
  legacyFallbackUsed: number;
};

type UlWarningPayload = {
  entries: UlWarningEntry[];
  webDisplayEligible: boolean;
  missingUlCount: number | null;
  missingReasonCounts: UlMissingReasonCounts | null;
};

type UlGuidanceItem = {
  text: string;
  sourceLabel: string | null;
  sourceUrl: string | null;
  canOpenLink: boolean;
  scope: string | null;
  reasonCode: string | null;
};

const normalizeText = (value: unknown): string =>
  typeof value === 'string' ? value.trim() : '';

const normalizeSanitizeInput = (value: string | null | undefined): string =>
  typeof value === 'string' ? value.trim() : '';

const WEB_HINT_DANGEROUS_TITLE_RE =
  /\b(youtube|forum|forums|reddit|stack\s*overflow|error|exception|traceback|uuid)\b/i;
const UUID_LIKE_RE =
  /\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/i;
const WEB_HINT_GENERIC_SUMMARY =
  'We could not verify this UPC to a supplement label. Here are general tips from limited unverified web evidence.';
const SHOW_SCAN_DEBUG =
  process.env.EXPO_PUBLIC_SHOW_SCAN_DEBUG === 'true' ||
  process.env.EXPO_PUBLIC_SHOW_SCAN_DEBUG === '1';
const INLINE_PLACEHOLDER_SEGMENT_PATTERNS = [
  /\bnot provided by source\b\.?/gi,
  /\bnot provided\b\.?/gi,
  /\bn\/a\b\.?/gi,
  /\bnull\b\.?/gi,
  /\bundefined\b\.?/gi,
];

const rewriteVerifiedLanguageForWebHint = (value: string): string =>
  value
    .replace(/\bbased on verified record data\b/gi, 'Based on limited unverified web evidence')
    .replace(/\bverified source records?\b/gi, 'limited unverified web evidence')
    .replace(/\bverified record\b/gi, 'unverified web hint record')
    .replace(/\bverified data\b/gi, 'unverified web evidence');

const sanitizeWebHintNarrative = (value: string): string => {
  const rewritten = rewriteVerifiedLanguageForWebHint(value);
  const trimmed = rewritten.trim();
  if (!trimmed) return WEB_HINT_GENERIC_SUMMARY;
  if (WEB_HINT_DANGEROUS_TITLE_RE.test(trimmed) || UUID_LIKE_RE.test(trimmed)) {
    return WEB_HINT_GENERIC_SUMMARY;
  }
  if (/\bthis supplement centers on\b/i.test(trimmed)) {
    return WEB_HINT_GENERIC_SUMMARY;
  }
  return trimmed;
};

const stripInlinePlaceholderSegments = (value: string): { text: string; replaced: boolean } => {
  let next = value;
  let replaced = false;
  INLINE_PLACEHOLDER_SEGMENT_PATTERNS.forEach((pattern) => {
    const before = next;
    next = next.replace(pattern, ' ');
    if (before !== next) replaced = true;
  });
  next = next
    .replace(/\s+([,.;:!?])/g, '$1')
    .replace(/[.;:!?]{2,}/g, '.')
    .replace(/\s{2,}/g, ' ')
    .replace(/^[,.;:!?–—\-\s]+/, '')
    .trim();
  return { text: next, replaced };
};

export const sanitizeText = (params: {
  text: string | null | undefined;
  replacement: string;
  module: PlaceholderModule;
  rawCounts: PlaceholderObservabilityCounts;
  sanitizedCounts: PlaceholderObservabilityCounts;
}): string => {
  const trimmed = normalizeSanitizeInput(params.text);
  if (!trimmed) return params.replacement;
  const stripped = stripInlinePlaceholderSegments(trimmed);
  const normalized = stripped.text;
  if (stripped.replaced) {
    bumpPlaceholderCount(params.rawCounts, params.module);
    bumpPlaceholderCount(params.sanitizedCounts, params.module);
  }
  if (!normalized) return params.replacement;
  if (isPlaceholderText(normalized)) {
    bumpPlaceholderCount(params.rawCounts, params.module);
    bumpPlaceholderCount(params.sanitizedCounts, params.module);
    return params.replacement;
  }
  return normalized;
};

export const sanitizeLines = (params: {
  lines: Array<string | null | undefined>;
  fallbackLines: string[];
  module: PlaceholderModule;
  rawCounts: PlaceholderObservabilityCounts;
  sanitizedCounts: PlaceholderObservabilityCounts;
  maxLines?: number;
}): string[] => {
  const maxLines = params.maxLines ?? 3;
  const cleaned: string[] = [];
  const seen = new Set<string>();

  for (const line of params.lines) {
    if (cleaned.length >= maxLines) break;
    const trimmed = normalizeSanitizeInput(line);
    if (!trimmed) continue;
    const stripped = stripInlinePlaceholderSegments(trimmed);
    const normalized = stripped.text;
    if (stripped.replaced) {
      bumpPlaceholderCount(params.rawCounts, params.module);
      bumpPlaceholderCount(params.sanitizedCounts, params.module);
    }
    if (!normalized) continue;
    const key = normalized.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    if (isPlaceholderText(normalized)) {
      bumpPlaceholderCount(params.rawCounts, params.module);
      bumpPlaceholderCount(params.sanitizedCounts, params.module);
      continue;
    }
    cleaned.push(normalized);
  }

  if (cleaned.length === 0) {
    for (const fallback of params.fallbackLines) {
      if (cleaned.length >= maxLines) break;
      const trimmed = normalizeSanitizeInput(fallback);
      if (!trimmed) continue;
      const key = trimmed.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      cleaned.push(trimmed);
    }
  }

  return cleaned.slice(0, maxLines);
};

const readUsageField = (value: unknown): string => {
  if (typeof value === 'string') return value.trim();
  if (value && typeof value === 'object' && typeof (value as { text?: unknown }).text === 'string') {
    return ((value as { text: string }).text ?? '').trim();
  }
  return '';
};

const readIngredientsDetailItems = (detail: IngredientsDetail | null | undefined): Array<{ name: string; whatItDoes: string }> => {
  if (!detail || !Array.isArray(detail.items)) return [];
  return detail.items
    .map((item) => {
      const name = normalizeText((item as { name?: unknown }).name);
      const whatItDoes = readUsageField((item as { whatItDoes?: unknown }).whatItDoes);
      return { name, whatItDoes };
    })
    .filter((item) => item.name.length > 0);
};

const readScheduleFromLabel = (detail: UsageDetail | null | undefined): string[] => {
  const rows = Array.isArray(detail?.scheduleFromLabel) ? detail.scheduleFromLabel : [];
  return rows
    .map((row) => {
      const population = normalizeText(row.population) || 'General';
      const dose = normalizeText(row.dose);
      const frequency = normalizeText(row.frequency);
      const raw = normalizeText(row.rawText);
      if (raw) return raw;
      const parts = [population, dose, frequency].filter(Boolean);
      return parts.join(': ');
    })
    .filter(Boolean)
    .slice(0, 3);
};

const toUlMissingReasonCounts = (value: unknown): UlMissingReasonCounts | null => {
  if (!value || typeof value !== 'object') return null;
  const obj = value as Record<string, unknown>;
  const read = (key: keyof UlMissingReasonCounts) =>
    typeof obj[key] === 'number' && Number.isFinite(obj[key]) ? Math.max(0, Number(obj[key])) : 0;
  return {
    noUlEstablished: read('noUlEstablished'),
    canonicalAliasMiss: read('canonicalAliasMiss'),
    unitConversionUncertain: read('unitConversionUncertain'),
    legacyFallbackUsed: read('legacyFallbackUsed'),
  };
};

const extractUlWarningPayload = (scoreBundle: ScoreBundleV4 | null): UlWarningPayload => {
  const explain = scoreBundle?.explain;
  if (!explain || typeof explain !== 'object') {
    return {
      entries: [],
      webDisplayEligible: true,
      missingUlCount: null,
      missingReasonCounts: null,
    };
  }

  const root = explain as Record<string, unknown>;
  const candidates = [
    root.ulWarnings,
    (root.safety as Record<string, unknown> | undefined)?.ulWarnings,
    (root.evidence as Record<string, unknown> | undefined)?.ulWarnings,
  ];

  for (const candidate of candidates) {
    let webDisplayEligible = true;
    let missingUlCount: number | null = null;
    let missingReasonCounts: UlMissingReasonCounts | null = null;

    if (candidate && typeof candidate === 'object' && !Array.isArray(candidate)) {
      const obj = candidate as Record<string, unknown>;
      webDisplayEligible =
        typeof obj.webDisplayEligible === 'boolean' ? obj.webDisplayEligible : true;
      missingUlCount =
        typeof obj.missingUlCount === 'number' && Number.isFinite(obj.missingUlCount)
          ? Math.max(0, Number(obj.missingUlCount))
          : null;
      missingReasonCounts = toUlMissingReasonCounts(obj.missingReasonCounts);
      const fromEntries = obj.entries;
      if (Array.isArray(fromEntries)) {
        const mapped = fromEntries
          .map((row) => {
            if (!row || typeof row !== 'object') return null;
            const data = row as Record<string, unknown>;
            const ingredient = normalizeText(data.displayName || data.ingredient || data.ingredientName || data.name);
            const currentDose = normalizeText(data.currentDose || data.dailyAmount || data.dose);
            const ulLimit = normalizeText(data.ulLimit || data.upperLimit || data.limit);
            const riskLevel = normalizeText(data.riskLevel || data.risk || data.severity);
            const scope = normalizeText(data.scope);
            const sourceUrl = normalizeText(data.sourceUrl || data.sourceURL || data.url);
            const scopeNote = normalizeText(data.scopeNote || data.note);
            const reasonCode = normalizeText(data.reasonCode || data.reason);
            if (!ingredient && !currentDose && !ulLimit) return null;
            return {
              ingredient: ingredient || 'Ingredient',
              currentDose: currentDose || null,
              ulLimit: ulLimit || null,
              riskLevel: riskLevel || null,
              scope: scope || null,
              sourceUrl: sourceUrl || null,
              scopeNote: scopeNote || null,
              reasonCode: reasonCode || null,
            } as UlWarningEntry;
          })
          .filter((row): row is UlWarningEntry => row !== null);
        if (mapped.length > 0 || missingUlCount !== null || missingReasonCounts) {
          return {
            entries: mapped,
            webDisplayEligible,
            missingUlCount,
            missingReasonCounts,
          };
        }
      }

      if (missingUlCount !== null || missingReasonCounts) {
        return {
          entries: [],
          webDisplayEligible,
          missingUlCount,
          missingReasonCounts,
        };
      }
    }

    if (Array.isArray(candidate)) {
      const mapped = candidate
        .map((row) => {
          if (!row || typeof row !== 'object') return null;
          const data = row as Record<string, unknown>;
          const ingredient = normalizeText(data.ingredient || data.ingredientName || data.name);
          const currentDose = normalizeText(data.currentDose || data.dailyAmount || data.dose);
          const ulLimit = normalizeText(data.ulLimit || data.upperLimit || data.limit);
          const riskLevel = normalizeText(data.riskLevel || data.risk || data.severity);
          const scope = normalizeText(data.scope);
          const sourceUrl = normalizeText(data.sourceUrl || data.sourceURL || data.url);
          const scopeNote = normalizeText(data.scopeNote || data.note);
          const reasonCode = normalizeText(data.reasonCode || data.reason);
          if (!ingredient && !currentDose && !ulLimit) return null;
          return {
            ingredient: ingredient || 'Ingredient',
            currentDose: currentDose || null,
            ulLimit: ulLimit || null,
            riskLevel: riskLevel || null,
            scope: scope || null,
            sourceUrl: sourceUrl || null,
            scopeNote: scopeNote || null,
            reasonCode: reasonCode || null,
          } as UlWarningEntry;
        })
        .filter((row): row is UlWarningEntry => row !== null);
      if (mapped.length > 0) {
        return {
          entries: mapped,
          webDisplayEligible: true,
          missingUlCount: null,
          missingReasonCounts: null,
        };
      }
    }

    if (candidate && typeof candidate === 'object') {
      const data = candidate as Record<string, unknown>;
      const highs = Array.isArray(data.high) ? data.high : [];
      const moderates = Array.isArray(data.moderate) ? data.moderate : [];
      const rows = [...highs, ...moderates]
        .map((row, index) => {
          if (typeof row !== 'string' || !row.trim()) return null;
          return {
            ingredient: `Signal ${index + 1}`,
            currentDose: row.trim(),
            ulLimit: null,
            riskLevel: index < highs.length ? 'high' : 'moderate',
            scope: null,
            sourceUrl: null,
            scopeNote: null,
            reasonCode: null,
          } as UlWarningEntry;
        })
        .filter((row): row is UlWarningEntry => row !== null);
      if (rows.length > 0) {
        return {
          entries: rows,
          webDisplayEligible: true,
          missingUlCount: null,
          missingReasonCounts: null,
        };
      }
    }
  }

  return {
    entries: [],
    webDisplayEligible: true,
    missingUlCount: null,
    missingReasonCounts: null,
  };
};

const getUlFallbackLine = (payload: UlWarningPayload): string => {
  if (payload.missingReasonCounts) {
    const counts = payload.missingReasonCounts;
    if (counts.noUlEstablished > 0 && counts.canonicalAliasMiss === 0) {
      return `No ODS UL is established for ${counts.noUlEstablished} ingredient(s) in this record.`;
    }
    if (counts.canonicalAliasMiss > 0) {
      return `UL signal unavailable for ${counts.canonicalAliasMiss} ingredient(s) due to unmatched ingredient mapping.`;
    }
    if (counts.unitConversionUncertain > 0) {
      return 'UL signal is conservative because some ingredient units are not directly comparable.';
    }
  }
  return 'No ODS upper-limit signal available for this product record.';
};

const formatUlGuidanceItems = (payload: UlWarningPayload): UlGuidanceItem[] => {
  if (!payload.webDisplayEligible) {
    return [
      {
        text: 'UL guidance is hidden for unverified web hints. Verify the package Supplement Facts for dose safety.',
        sourceLabel: null,
        sourceUrl: null,
        canOpenLink: false,
        scope: null,
        reasonCode: 'WEB_UL_HIDDEN_UNVERIFIED',
      },
    ];
  }
  if (!payload.entries.length) {
    return [
      {
        text: getUlFallbackLine(payload),
        sourceLabel: null,
        sourceUrl: null,
        canOpenLink: false,
        scope: null,
        reasonCode: null,
      },
    ];
  }
  return payload.entries.slice(0, 3).map((entry) => {
    const dosePart = entry.currentDose ? `current ${entry.currentDose}` : 'current dose not listed';
    const ulPart = entry.ulLimit ? `UL ${entry.ulLimit}` : 'UL not listed';
    const riskPart = entry.riskLevel ? ` (${entry.riskLevel})` : '';
    const scopePart = entry.scopeNote
      ? `; ${entry.scopeNote}`
      : entry.scope === 'supplements_only'
        ? '; scope supplements only'
        : entry.scope === 'supplements_or_fortified_only'
          ? '; scope supplements/fortified only'
          : entry.scope === 'total_intake'
            ? '; scope total intake'
            : '';
    const unitPolicyPart =
      entry.reasonCode === 'UNIT_CONVERSION_UNCERTAIN'
        ? '; unit basis may not be directly comparable'
        : '';
    const sourceUrl = entry.sourceUrl || null;
    return {
      text: `${entry.ingredient}: ${dosePart}; ${ulPart}${riskPart}${scopePart}${unitPolicyPart}.`,
      sourceLabel: sourceUrl ? 'Source: NIH ODS (Health Professional Fact Sheet)' : null,
      sourceUrl,
      canOpenLink: Boolean(sourceUrl && /^https?:\/\//i.test(sourceUrl)),
      scope: entry.scope,
      reasonCode: entry.reasonCode,
    } satisfies UlGuidanceItem;
  });
};

const getDegradedReasonCopy = (terminalReasonRaw: string): string => {
  const terminalReason = normalizeText(terminalReasonRaw).toUpperCase();
  if (terminalReason.includes('DEGRADED_WEB_BUDGET')) {
    return 'Some web evidence was limited to keep response times stable.';
  }
  if (terminalReason.includes('DEGRADED_EVENTLOOP')) {
    return 'System load was high, so we returned a conservative partial analysis.';
  }
  if (terminalReason.includes('BUNDLE_ONLY_NO_AUTHORITATIVE_MATCH')) {
    return 'No authoritative match was confirmed in this pass, so web expansion was intentionally skipped.';
  }
  return 'This result is partial because data availability was constrained during analysis.';
};

const ensureMinimumLines = (
  lines: string[],
  fallbackLines: string[],
  minLines: number,
  maxLines: number,
): string[] => {
  const out: string[] = [];
  const seen = new Set<string>();
  const add = (value: string) => {
    const text = normalizeText(value);
    if (!text || out.length >= maxLines) return;
    const key = text.toLowerCase();
    if (seen.has(key)) return;
    seen.add(key);
    out.push(text);
  };

  lines.forEach(add);
  if (out.length < minLines) {
    fallbackLines.forEach(add);
  }
  return out.slice(0, maxLines);
};

const getSourceFactLine = (
  sourceAttribution: SourceAttribution,
): string =>
  sourceAttribution === 'web_hint_unverified'
    ? 'Source fact: this barcode currently maps to unverified web hints.'
    : 'Source fact: this product identity is linked to verified label or regulatory records.';

const getSourceActionLine = (
  sourceAttribution: SourceAttribution,
): string =>
  sourceAttribution === 'web_hint_unverified'
    ? 'Next step: scan Supplement Facts and Directions panels to verify identity and dosage.'
    : 'Next step: scan Supplement Facts and Directions for richer product-level detail.';

export const extractUlWarningItems = (scoreBundle: ScoreBundleV4 | null): UlGuidanceItem[] =>
  formatUlGuidanceItems(extractUlWarningPayload(scoreBundle));

export const extractUlWarnings = (scoreBundle: ScoreBundleV4 | null): string[] =>
  extractUlWarningItems(scoreBundle).map((item) => item.text);

export const buildSafetyWatchouts = (ingredientNames: string[]): string[] => {
  const seen = new Set<string>();
  const lines: string[] = [];

  for (const name of ingredientNames.slice(0, 2)) {
    const normalizedName = normalizeText(name);
    if (!normalizedName) continue;
    const foundation = lookupFoundationForIngredient(normalizedName);
    const watchOuts = Array.isArray(foundation.watchOuts) ? foundation.watchOuts : [];

    for (const warning of watchOuts.slice(0, 2)) {
      const text = normalizeText(warning);
      if (!text) continue;
      const key = text.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      lines.push(`${normalizedName}: ${text}`);
      if (lines.length >= 4) break;
    }

    if (lines.length >= 4) break;
  }

  if (lines.length === 0) {
    return ['No ODS watch-outs were matched for the current key ingredients.'];
  }

  return lines;
};

type UseAnalysisBundleViewModelParams = {
  bundle: AnalysisBundle;
  facts: FactsDTO | null;
  scoreBundle: ScoreBundleV4 | null;
  score: AnalysisBundleScoreViewModel;
  productTitle: string;
  productSubtitle: string;
  keyIngredientsForIngredients: string[];
  keyIngredientsForSafety: string[];
  assembledInsights: InsightsDTO | null;
};

export const buildAnalysisBundleViewModel = (params: UseAnalysisBundleViewModelParams): AnalysisBundleViewModel => {
  const rawPlaceholderCount = createPlaceholderCounts();
  const sanitizedPlaceholderCount = createPlaceholderCounts();

  const overviewCover = params.bundle.sections.overview.cover;
  const overviewDetail = params.bundle.sections.overview.detail;
  const ingredientsCover = params.bundle.sections.ingredients.cover;
  const ingredientsDetail = params.bundle.sections.ingredients.detail;
  const usageCover = params.bundle.sections.usage.cover as UsageCover | null;
  const usageDetail = params.bundle.sections.usage.detail as UsageDetail | null;
  const safetyCover = params.bundle.sections.safety.cover as SafetyCover | null;

  const trustedIdentity = resolveTrustedDisplayIdentity({
    bundleMeta: params.bundle.meta,
    productName: params.productTitle,
    productSubtitle: params.productSubtitle,
    barcode: params.facts?.identity?.value ?? null,
    authoritativeIdentity: params.bundle?.meta?.authoritativeIdentity ?? null,
    sources:
      params.facts?.sources?.map((source) => ({
        domain: source?.domain ?? null,
        url: source?.url ?? null,
      })) ?? null,
    showDebugWebHintSource: SHOW_SCAN_DEBUG,
  });
  const resolvedAttribution = trustedIdentity.sourceAttributionUsed;
  const effectiveSourceAttribution: SourceAttribution =
    resolvedAttribution === 'unknown' ? 'web_hint_unverified' : resolvedAttribution;
  const productTitle = trustedIdentity.title;
  const productSubtitle = trustedIdentity.subtitle;
  const terminalReason = normalizeText((params.bundle.meta as any)?.terminalReason);
  const degradedMode =
    Boolean((params.bundle.meta as any)?.degradedMode)
    || terminalReason.toUpperCase().startsWith('DEGRADED_');
  const sourceFactLine = getSourceFactLine(effectiveSourceAttribution);
  const sourceActionLine = getSourceActionLine(effectiveSourceAttribution);
  const degradedActionLine = degradedMode
    ? 'Next step: retry shortly or scan Supplement Facts and Directions for full product detail.'
    : sourceActionLine;

  const overviewSummary = sanitizeText({
    text: sanitizeCoverLine(
      normalizeText(overviewCover?.summary),
      effectiveSourceAttribution === 'web_hint_unverified'
        ? 'This analysis uses limited unverified web evidence. Scan Supplement Facts to verify the product.'
        : 'This analysis is based on verified record data. Scan Supplement Facts for richer product-level detail.',
    ),
    replacement:
      effectiveSourceAttribution === 'web_hint_unverified'
        ? 'This analysis uses limited unverified web evidence. Scan Supplement Facts to verify the product.'
        : 'This analysis is based on verified record data. Scan Supplement Facts for richer product-level detail.',
    module: 'overview',
    rawCounts: rawPlaceholderCount,
    sanitizedCounts: sanitizedPlaceholderCount,
  });
  const overviewSummaryResolved =
    effectiveSourceAttribution === 'web_hint_unverified'
      ? sanitizeWebHintNarrative(overviewSummary)
      : overviewSummary;
  const overviewBullets = sanitizeLines({
    lines: sanitizeCoverBullets(
      overviewCover?.bullets ?? [],
      effectiveSourceAttribution === 'web_hint_unverified'
        ? [
            'Built from limited unverified web evidence for this barcode.',
            'Scan Supplement Facts for richer ingredient-level context.',
          ]
        : [
            'Built from verified source records for this product.',
            'Scan Supplement Facts for richer ingredient-level context.',
          ],
      2,
    ).map((row) => row.text),
    fallbackLines:
      effectiveSourceAttribution === 'web_hint_unverified'
        ? [
            'Built from limited unverified web evidence for this barcode.',
            'Scan Supplement Facts for richer ingredient-level context.',
          ]
        : [
            'Built from verified source records for this product.',
            'Scan Supplement Facts for richer ingredient-level context.',
          ],
    module: 'overview',
    rawCounts: rawPlaceholderCount,
    sanitizedCounts: sanitizedPlaceholderCount,
    maxLines: 2,
  }).map((line) =>
    effectiveSourceAttribution === 'web_hint_unverified' ? sanitizeWebHintNarrative(line) : line,
  );
  const overviewDetailLines = ensureMinimumLines(enforceNeverBlank({
    lines: sanitizeLines({
      lines: [overviewDetail?.summary, ...((overviewDetail?.bullets ?? []).map((bullet) => bullet?.text)), ...overviewBullets],
      fallbackLines: [
        effectiveSourceAttribution === 'web_hint_unverified'
          ? 'This section summarizes limited unverified web evidence and available ingredient context.'
          : 'This section summarizes the verified product record and available ingredient context.',
        'For stronger product-specific detail, scan a clear Supplement Facts panel.',
      ],
      module: 'overview',
      rawCounts: rawPlaceholderCount,
      sanitizedCounts: sanitizedPlaceholderCount,
      maxLines: 5,
    }),
    fallback: [
      effectiveSourceAttribution === 'web_hint_unverified'
        ? 'This section summarizes limited unverified web evidence and available ingredient context.'
        : 'This section summarizes the verified product record and available ingredient context.',
      'For stronger product-specific detail, scan a clear Supplement Facts panel.',
    ],
  }).map((line) => (
    effectiveSourceAttribution === 'web_hint_unverified'
      ? sanitizeWebHintNarrative(line)
      : line
  )), [
    degradedMode ? `Limited analysis: ${getDegradedReasonCopy(terminalReason)}` : sourceFactLine,
    sourceFactLine,
    degradedActionLine,
  ], 2, 5).map((line) =>
    effectiveSourceAttribution === 'web_hint_unverified'
      ? sanitizeWebHintNarrative(line)
      : line,
  );

  const coverIngredients = (
    Array.isArray(ingredientsCover?.items) ? ingredientsCover?.items.map((item) => normalizeText(item?.name)).filter(Boolean) : []
  ).slice(0, 6);
  if (coverIngredients.length === 0 && params.facts?.ingredients?.actives?.length) {
    coverIngredients.push(
      ...params.facts.ingredients.actives
        .map((item) => normalizeText(item.name))
        .filter(Boolean)
        .slice(0, 6),
    );
  }

  const detailItems = readIngredientsDetailItems(ingredientsDetail);
  let scienceDetailTop3 = detailItems
    .map((item) => {
      const line = item.whatItDoes || 'Supports normal nutritional goals based on available evidence.';
      return `${item.name}: ${line}`;
    })
    .slice(0, 3);

  if (scienceDetailTop3.length === 0 && params.assembledInsights?.keyIngredientsInsights?.length) {
    scienceDetailTop3 = params.assembledInsights.keyIngredientsInsights.slice(0, 3).map((item) => {
      const firstWhy = item.whyBullets?.[0] ?? 'Product-specific evidence remains limited in this record.';
      return `${item.name}: ${firstWhy}`;
    });
  }
  if (scienceDetailTop3.length === 0) {
    scienceDetailTop3 = [
      'Ingredient listing status: active ingredients and doses were not listed in this source.',
      'Scan Supplement Facts to capture ingredient names, forms, and dose values.',
    ];
  }

  const scienceOverallSummary =
    sanitizeText({
      text:
        readUsageField((ingredientsDetail as { overallSummary?: unknown } | null)?.overallSummary)
        || readUsageField(usageCover?.dosage),
      replacement: degradedMode
        ? `Limited analysis: ${getDegradedReasonCopy(terminalReason)}`
        : 'Ingredient detail is limited by current source coverage.',
      module: 'science',
      rawCounts: rawPlaceholderCount,
      sanitizedCounts: sanitizedPlaceholderCount,
    });

  const scienceDetailLines = ensureMinimumLines(enforceNeverBlank({
    lines: sanitizeLines({
      lines: [...scienceDetailTop3, scienceOverallSummary],
      fallbackLines: [
        degradedMode
          ? `Limited analysis: ${getDegradedReasonCopy(terminalReason)}`
          : 'Ingredient-level evidence is currently limited for this product record.',
        'Scan a clear Supplement Facts panel to unlock stronger form and dose explanations.',
      ],
      module: 'science',
      rawCounts: rawPlaceholderCount,
      sanitizedCounts: sanitizedPlaceholderCount,
      maxLines: 5,
    }),
    fallback: [
      degradedMode
        ? `Limited analysis: ${getDegradedReasonCopy(terminalReason)}`
        : 'Ingredient-level evidence is currently limited for this product record.',
      'Scan a clear Supplement Facts panel to unlock stronger form and dose explanations.',
    ],
  }), [
    degradedMode
      ? `Limited analysis: ${getDegradedReasonCopy(terminalReason)}`
      : sourceFactLine,
    'Science fact: ingredient names or dose values are limited in this record.',
    degradedActionLine,
  ], 2, 5);

  const usageBestTime = sanitizeText({
    text: sanitizeCoverLine(
      readUsageField(usageCover?.bestTimeToTake),
      'Follow the product label timing and keep a consistent daily schedule.',
    ),
    replacement: 'Follow the product label timing and keep a consistent daily schedule.',
    module: 'usage',
    rawCounts: rawPlaceholderCount,
    sanitizedCounts: sanitizedPlaceholderCount,
  });
  const usageDosage = sanitizeText({
    text: sanitizeCoverLine(
      readUsageField(usageCover?.dosage) || normalizeText(params.facts?.usage?.directionsText),
      'Dosage directions were not listed in this source record. Follow bottle label dose and frequency guidance.',
    ),
    replacement: 'Dosage directions were not listed in this source record. Follow bottle label dose and frequency guidance.',
    module: 'usage',
    rawCounts: rawPlaceholderCount,
    sanitizedCounts: sanitizedPlaceholderCount,
  });
  const usageBullets = ensureMinimumLines(sanitizeLines({
    lines: sanitizeCoverBullets(
      usageCover?.bullets ?? [],
      [
        'Use the product label first for dosing decisions.',
        'Scan the Directions panel to unlock more product-specific usage guidance.',
      ],
      3,
    ).map((row) => row.text),
    fallbackLines: [
      'Use the product label first for dosing decisions.',
      'Scan the Directions panel to unlock more product-specific usage guidance.',
    ],
    module: 'usage',
    rawCounts: rawPlaceholderCount,
    sanitizedCounts: sanitizedPlaceholderCount,
    maxLines: 3,
  }), [
    'Use the product label first for dosing decisions.',
    'Scan the Directions panel to unlock more product-specific usage guidance.',
  ], 2, 3);

  const scheduleFromLabel = ensureMinimumLines(sanitizeLines({
    lines: readScheduleFromLabel(usageDetail),
    fallbackLines: [],
    module: 'usage',
    rawCounts: rawPlaceholderCount,
    sanitizedCounts: sanitizedPlaceholderCount,
    maxLines: 3,
  }), [
    'Schedule from label: unavailable in this source record.',
  ], 1, 3);
  const ulGuidanceItemsRaw = extractUlWarningItems(params.scoreBundle);
  const ulGuidance = sanitizeLines({
    lines: ulGuidanceItemsRaw.map((item) => item.text),
    fallbackLines: ['No ODS upper-limit signal available for this product record.'],
    module: 'usage',
    rawCounts: rawPlaceholderCount,
    sanitizedCounts: sanitizedPlaceholderCount,
    maxLines: 3,
  });
  const ulGuidanceItems = ulGuidance
    .map((line, index) => {
      const candidate = ulGuidanceItemsRaw[index];
      if (!candidate) return null;
      return {
        ...candidate,
        text: line,
      };
    })
    .filter((item): item is UlGuidanceItem => item !== null);

  const usageDetailLines = ensureMinimumLines(enforceNeverBlank({
    lines: sanitizeLines({
      lines: [usageBestTime, usageDosage, ...usageBullets, ...scheduleFromLabel, ...ulGuidance],
      fallbackLines: [
        'Usage guidance is limited in this source, so we keep recommendations conservative.',
        effectiveSourceAttribution === 'web_hint_unverified'
          ? 'This section is based on web identity hints and should be confirmed against the package label.'
          : 'Follow the package directions and consult a clinician for personal advice.',
      ],
      module: 'usage',
      rawCounts: rawPlaceholderCount,
      sanitizedCounts: sanitizedPlaceholderCount,
      maxLines: 5,
    }),
    fallback: [
      'Usage guidance is limited in this source, so we keep recommendations conservative.',
      effectiveSourceAttribution === 'web_hint_unverified'
        ? 'This section is based on web identity hints and should be confirmed against the package label.'
        : 'Follow the package directions and consult a clinician for personal advice.',
    ],
  }).map((line) =>
    effectiveSourceAttribution === 'web_hint_unverified' ? sanitizeWebHintNarrative(line) : line,
  ), [
    'Usage fact: dosage and frequency should come from the package Directions panel.',
    degradedActionLine,
  ], 2, 5);
  const usageDetailLinesResolved = degradedMode
    ? ensureMinimumLines(enforceNeverBlank({
      lines: [
        getDegradedReasonCopy(terminalReason),
        'Retry shortly or scan the Supplement Facts panel for fuller product-specific guidance.',
        ...usageDetailLines,
      ],
      fallback: [
        getDegradedReasonCopy(terminalReason),
        'Retry shortly or scan the Supplement Facts panel for fuller product-specific guidance.',
      ],
    }), [
      getDegradedReasonCopy(terminalReason),
      'Retry shortly or scan the Supplement Facts panel for fuller product-specific guidance.',
    ], 2, 5)
    : usageDetailLines;

  const safetyVerdict = sanitizeText({
    text: sanitizeCoverLine(
      normalizeText(safetyCover?.verdict),
      'Safety details are not included in this source record.',
    ),
    replacement: 'Safety details are not included in this source record.',
    module: 'safety',
    rawCounts: rawPlaceholderCount,
    sanitizedCounts: sanitizedPlaceholderCount,
  });
  const safetyBullets = sanitizeLines({
    lines: sanitizeCoverBullets(
      safetyCover?.bullets ?? [],
      [
        'Safety warning fields were empty in this source record.',
        'If pregnant, breastfeeding, or on medications, consult your clinician before use.',
      ],
      3,
    ).map((row) => row.text),
    fallbackLines: [
      'Safety warning fields were empty in this source record.',
      'If pregnant, breastfeeding, or on medications, consult your clinician before use.',
    ],
    module: 'safety',
    rawCounts: rawPlaceholderCount,
    sanitizedCounts: sanitizedPlaceholderCount,
    maxLines: 3,
  });

  const labelWarnings = (Array.isArray(params.facts?.safety?.labelWarnings)
    ? params.facts?.safety?.labelWarnings
    : []);
  const safetyWatchOuts = sanitizeLines({
    lines: buildSafetyWatchouts(params.keyIngredientsForSafety),
    fallbackLines: ['No ODS watch-outs were matched for the current key ingredients.'],
    module: 'safety',
    rawCounts: rawPlaceholderCount,
    sanitizedCounts: sanitizedPlaceholderCount,
    maxLines: 4,
  });

  const safetyDetailLines = ensureMinimumLines(enforceNeverBlank({
    lines: sanitizeLines({
      lines: [
      safetyVerdict,
      ...safetyBullets,
      ...(labelWarnings.length ? labelWarnings.slice(0, 3) : ['Label warning fields were empty in this source record.']),
      ...safetyWatchOuts,
      ],
      fallbackLines: [
        degradedMode
          ? `Limited analysis: ${getDegradedReasonCopy(terminalReason)}`
          : '',
        effectiveSourceAttribution === 'web_hint_unverified'
          ? 'General watch-outs are educational references and do not confirm this exact product label.'
          : 'General watch-outs are educational and not a substitute for product-label warnings.',
        'Always prioritize the package warnings and stop use if adverse reactions occur.',
      ],
      module: 'safety',
      rawCounts: rawPlaceholderCount,
      sanitizedCounts: sanitizedPlaceholderCount,
      maxLines: 5,
    }),
    fallback: [
      degradedMode
        ? `Limited analysis: ${getDegradedReasonCopy(terminalReason)}`
        : '',
      effectiveSourceAttribution === 'web_hint_unverified'
        ? 'General watch-outs are educational references and do not confirm this exact product label.'
        : 'General watch-outs are educational and not a substitute for product-label warnings.',
      'Always prioritize the package warnings and stop use if adverse reactions occur.',
    ],
  }).map((line) =>
    effectiveSourceAttribution === 'web_hint_unverified' ? rewriteVerifiedLanguageForWebHint(line) : line,
  ), [
    'Safety fact: review package warnings before use and stop if adverse symptoms occur.',
    degradedActionLine,
  ], 2, 5);

  return {
    productTitle,
    productSubtitle,
    sourceAttribution: effectiveSourceAttribution,
    score: params.score,
    overview: {
      summary: overviewSummaryResolved,
      bullets: overviewBullets,
      detail: overviewDetailLines,
    },
    science: {
      coverIngredients,
      detailTop3: scienceDetailTop3,
      overallSummary: scienceOverallSummary,
      detail: scienceDetailLines,
    },
    usage: {
      bestTime: usageBestTime,
      dosage: usageDosage,
      bullets: usageBullets,
      scheduleFromLabel,
      ulGuidance,
      ulGuidanceItems,
      detail: usageDetailLinesResolved,
    },
    safety: {
      verdict: safetyVerdict,
      bullets: safetyBullets,
      dataStatus: params.bundle.sections.safety.dataStatus,
      odsWatchOuts: safetyWatchOuts,
      detail: safetyDetailLines,
    },
    debug: {
      rawPlaceholderCount,
      sanitizedPlaceholderCount,
    },
  };
};

export const useAnalysisBundleViewModel = (params: UseAnalysisBundleViewModelParams): AnalysisBundleViewModel =>
  useMemo(() => buildAnalysisBundleViewModel(params), [
    params.bundle,
    params.facts,
    params.scoreBundle,
    params.score,
    params.productTitle,
    params.productSubtitle,
    params.keyIngredientsForIngredients,
    params.keyIngredientsForSafety,
    params.assembledInsights,
  ]);
