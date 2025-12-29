import type { AiSupplementAnalysis } from '@/backend/src/types';
import type { LabelDraft } from '@/backend/src/labelAnalysis';
import { computeSmartScores } from '@/lib/scoring';
import type {
  NormalizedAmountUnit,
  SnapshotSource,
  SnapshotStatus,
  SupplementSnapshot,
} from '@/types/supplementSnapshot';
import {
  EXCERPT_MAX_CHARS,
  SNAPSHOT_SCHEMA_VERSION,
} from '@/types/supplementSnapshot';

import type { AnalysisState, EnrichedSource } from '@/hooks/useStreamAnalysis';

type SnapshotScoreConfidence = NonNullable<SupplementSnapshot['scores']>['confidence'];

const createSnapshotId = () => {
  try {
    return globalThis.crypto?.randomUUID?.() ?? `snapshot_${Date.now()}_${Math.floor(Math.random() * 1_000_000)}`;
  } catch {
    return `snapshot_${Date.now()}_${Math.floor(Math.random() * 1_000_000)}`;
  }
};

const nowIso = () => new Date().toISOString();

const truncateExcerpt = (value: string | null | undefined): string => {
  if (!value) return '';
  const trimmed = value.trim();
  if (!trimmed) return '';
  if (trimmed.length <= EXCERPT_MAX_CHARS) return trimmed;
  return trimmed.slice(0, EXCERPT_MAX_CHARS);
};

const hashString = (input: string): string => {
  let hash = 0x811c9dc5;
  for (let i = 0; i < input.length; i += 1) {
    hash ^= input.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, '0');
};

const buildReferences = (
  sources: Array<{ title?: string | null; link?: string | null }>,
  retrievedAt: string,
): SupplementSnapshot['references'] => {
  const items: SupplementSnapshot['references']['items'] = [];
  const seen = new Set<string>();

  sources.forEach((source, index) => {
    const title = source.title?.trim() || 'Source';
    const url = source.link?.trim() || '';
    const excerpt = truncateExcerpt('');
    const hash = hashString(`${url}\n${excerpt}`);
    if (seen.has(hash)) return;
    seen.add(hash);
    items.push({
      id: `ref_${index + 1}_${hash}`,
      sourceType: 'OTHER',
      title,
      url,
      excerpt,
      retrievedAt,
      hash,
      evidenceFor: 'general',
    });
  });

  return { items };
};

const normalizeUnit = (unitRaw?: string | null): NormalizedAmountUnit | null => {
  if (!unitRaw) return null;
  const normalized = unitRaw.trim().toLowerCase();
  if (!normalized) return null;

  if (
    normalized.startsWith('mcg') ||
    normalized.startsWith('ug') ||
    normalized.startsWith('\u00b5g') ||
    normalized.startsWith('\u03bcg')
  ) {
    return 'mcg';
  }
  if (normalized.startsWith('mg')) return 'mg';
  if (normalized.startsWith('g')) return 'g';
  if (normalized.startsWith('iu') || normalized.startsWith('i.u')) return 'iu';
  if (normalized.includes('cfu') || normalized.includes('ufc')) return 'cfu';
  if (normalized.startsWith('ml')) return 'ml';

  return null;
};

type BarcodeFormat = 'gtin8' | 'upca' | 'ean13' | 'gtin14' | 'unknown';

type NormalizedBarcode = {
  raw: string;
  code: string;
  format: BarcodeFormat;
  isValidChecksum: boolean | null;
  variants: string[];
};

const GTIN_LENGTHS = new Set([8, 12, 13, 14]);

const detectFormat = (code: string): BarcodeFormat => {
  switch (code.length) {
    case 8:
      return 'gtin8';
    case 12:
      return 'upca';
    case 13:
      return 'ean13';
    case 14:
      return 'gtin14';
    default:
      return 'unknown';
  }
};

const computeGtinCheckDigit = (body: string): number | null => {
  if (!/^\d+$/.test(body)) return null;
  let sum = 0;
  let position = 1;
  for (let i = body.length - 1; i >= 0; i -= 1) {
    const digit = Number(body[i]);
    const weight = position % 2 === 1 ? 3 : 1;
    sum += digit * weight;
    position += 1;
  }
  return (10 - (sum % 10)) % 10;
};

const isValidGtin = (code: string): boolean => {
  if (!/^\d+$/.test(code) || !GTIN_LENGTHS.has(code.length)) return false;
  const body = code.slice(0, -1);
  const check = Number(code.slice(-1));
  const computed = computeGtinCheckDigit(body);
  return computed !== null && computed === check;
};

const correctCheckDigitIfPossible = (code: string): string | null => {
  if (!/^\d+$/.test(code) || !GTIN_LENGTHS.has(code.length)) return null;
  const body = code.slice(0, -1);
  const computed = computeGtinCheckDigit(body);
  if (computed === null) return null;
  return `${body}${computed}`;
};

const extractBarcodeCandidate = (raw: string): string | null => {
  const trimmed = raw.trim();
  if (!trimmed) return null;

  const sequences = trimmed.match(/\d{8,14}/g);
  if (sequences && sequences.length > 0) {
    return [...sequences].sort((a, b) => b.length - a.length)[0] ?? null;
  }

  const digitsOnly = trimmed.replace(/\D/g, '');
  if (digitsOnly.length >= 8 && digitsOnly.length <= 14) {
    return digitsOnly;
  }

  return null;
};

const buildBarcodeVariants = (code: string): string[] => {
  const variants: string[] = [];
  const seen = new Set<string>();
  const add = (value: string | null | undefined) => {
    if (!value) return;
    if (seen.has(value)) return;
    seen.add(value);
    variants.push(value);
  };

  add(code);

  const corrected = correctCheckDigitIfPossible(code);
  if (corrected && corrected !== code) add(corrected);

  if (code.length === 12) add(`0${code}`);
  if (code.length === 13 && code.startsWith('0')) add(code.slice(1));

  const trimmed = code.replace(/^0+/, '');
  if (trimmed && trimmed !== code && trimmed.length >= 8 && trimmed.length <= 14) {
    add(trimmed);
  }

  if (code.length < 14) add(code.padStart(14, '0'));
  if (trimmed && trimmed.length >= 8 && trimmed.length < 14) {
    add(trimmed.padStart(14, '0'));
  }

  return variants;
};

const normalizeBarcodeInput = (raw: string): NormalizedBarcode | null => {
  const candidate = extractBarcodeCandidate(raw);
  if (!candidate) return null;

  const format = detectFormat(candidate);
  const isValidChecksum = GTIN_LENGTHS.has(candidate.length) ? isValidGtin(candidate) : null;
  const variants = buildBarcodeVariants(candidate);

  return {
    raw,
    code: candidate,
    format,
    isValidChecksum,
    variants,
  };
};

const buildBarcodeMeta = (barcodeRaw: string | null): SupplementSnapshot['product']['barcode'] => {
  if (!barcodeRaw) {
    return {
      raw: null,
      normalized: null,
      normalizedFormat: null,
      isChecksumValid: null,
      variants: null,
    };
  }

  const normalized = normalizeBarcodeInput(barcodeRaw);
  if (!normalized) {
    return {
      raw: barcodeRaw,
      normalized: null,
      normalizedFormat: null,
      isChecksumValid: null,
      variants: [barcodeRaw],
    };
  }

  const canonical = normalized.code.padStart(14, '0');
  return {
    raw: barcodeRaw,
    normalized: canonical,
    normalizedFormat: 'gtin14',
    isChecksumValid: normalized.isValidChecksum,
    variants: normalized.variants,
  };
};

const baseSnapshot = (params: {
  status: SnapshotStatus;
  source: SnapshotSource;
  barcodeRaw: string | null;
  createdAt?: string;
  error?: SupplementSnapshot['error'];
}): SupplementSnapshot => {
  const createdAt = params.createdAt ?? nowIso();
  return {
    schemaVersion: SNAPSHOT_SCHEMA_VERSION,
    snapshotId: createSnapshotId(),
    status: params.status,
    source: params.source,
    region: 'global',
    createdAt,
    updatedAt: createdAt,
    error: params.error ?? null,
    product: {
      brand: null,
      name: null,
      category: null,
      imageUrl: null,
      barcode: buildBarcodeMeta(params.barcodeRaw),
      externalIds: {
        upc: null,
        ean: null,
        gtin: null,
        asin: null,
      },
      entityRefs: {
        supplementId: null,
        brandId: null,
      },
    },
    label: {
      servingSize: null,
      servingsPerContainer: null,
      servingsPerContainerText: null,
      actives: [],
      inactive: [],
      proprietaryBlends: [],
      extraction: null,
    },
    regulatory: {
      npn: null,
      npnStatus: null,
      dsldLabelId: null,
      regionTags: [],
      lastCheckedAt: null,
      sourceUrls: null,
    },
    trust: {
      overallStatus: 'unknown',
      signals: [],
      claims: null,
    },
    listings: {
      items: [],
      bestOffer: null,
    },
    references: {
      items: [],
    },
  };
};

const buildScoresFromSections = (input: {
  efficacy: AnalysisState['efficacy'];
  safety: AnalysisState['safety'];
  value: AnalysisState['value'];
  social: AnalysisState['social'];
  confidence: SnapshotScoreConfidence;
  computedAt: string;
}): SupplementSnapshot['scores'] | undefined => {
  const { efficacy, safety, value, social, confidence, computedAt } = input;
  const canScore =
    typeof efficacy?.score === 'number' &&
    typeof safety?.score === 'number' &&
    typeof value?.score === 'number';

  if (!canScore) return undefined;

  const analysisInput = {
    efficacy: {
      score: efficacy?.score,
      primaryActive: efficacy?.primaryActive ?? null,
      ingredients: efficacy?.ingredients ?? [],
      overallAssessment: efficacy?.overallAssessment,
      marketingVsReality: efficacy?.marketingVsReality,
      coreBenefits: efficacy?.coreBenefits ?? efficacy?.benefits ?? [],
    },
    safety: {
      score: safety?.score,
      ulWarnings: safety?.ulWarnings ?? [],
      allergens: safety?.allergens ?? [],
      interactions: safety?.interactions ?? [],
      redFlags: safety?.redFlags ?? [],
      consultDoctorIf: safety?.consultDoctorIf ?? [],
    },
    value: {
      score: value?.score,
      costPerServing: value?.costPerServing ?? null,
      alternatives: value?.alternatives ?? [],
    },
    social: {
      score: social?.score,
      summary: social?.summary,
    },
  };

  const breakdown = computeSmartScores(analysisInput);

  return {
    overall: breakdown.overall,
    effectiveness: breakdown.effectiveness,
    safety: breakdown.safety,
    value: breakdown.value,
    version: 'v2-ai',
    computedAt,
    confidence,
  };
};

const buildScoresFromAnalysis = (input: {
  analysis: AiSupplementAnalysis | null;
  confidence: SnapshotScoreConfidence;
  computedAt: string;
}): SupplementSnapshot['scores'] | undefined => {
  const { analysis, confidence, computedAt } = input;
  if (!analysis || analysis.status !== 'success') return undefined;

  const canScore =
    typeof analysis.efficacy?.score === 'number' &&
    typeof analysis.safety?.score === 'number' &&
    typeof analysis.value?.score === 'number';

  if (!canScore) return undefined;

  const analysisInput = {
    efficacy: {
      score: analysis.efficacy?.score,
      primaryActive: analysis.efficacy?.primaryActive ?? null,
      ingredients: analysis.efficacy?.ingredients ?? [],
      overallAssessment: analysis.efficacy?.overallAssessment,
      marketingVsReality: analysis.efficacy?.marketingVsReality,
      coreBenefits: analysis.efficacy?.coreBenefits ?? analysis.efficacy?.benefits ?? [],
    },
    safety: {
      score: analysis.safety?.score,
      ulWarnings: [],
      allergens: [],
      interactions: [],
      redFlags: analysis.safety?.redFlags ?? [],
      consultDoctorIf: [],
    },
    value: {
      score: analysis.value?.score,
      costPerServing: null,
      alternatives: [],
    },
    social: {
      score: analysis.social?.score,
      summary: analysis.social?.summary,
    },
  };

  const breakdown = computeSmartScores(analysisInput);

  return {
    overall: breakdown.overall,
    effectiveness: breakdown.effectiveness,
    safety: breakdown.safety,
    value: breakdown.value,
    version: 'v2-ai',
    computedAt,
    confidence,
  };
};

const buildConfidenceBase = (): SnapshotScoreConfidence => ({
  overall: null,
  labelCoverage: null,
  ingredientCoverage: null,
  priceCoverage: null,
  trustCoverage: null,
  regulatoryCoverage: null,
});

const buildLabelActives = (draft: LabelDraft | null): SupplementSnapshot['label']['actives'] => {
  if (!draft) return [];
  return draft.ingredients.map((ingredient) => {
    const amountUnknown = ingredient.amount == null && ingredient.dvPercent == null;
    return {
      name: ingredient.name,
      ingredientId: null,
      amount: ingredient.amount ?? null,
      amountUnit: ingredient.unit ?? null,
      amountUnitRaw: ingredient.unit ?? null,
      amountUnitNormalized: normalizeUnit(ingredient.unit ?? null),
      dvPercent: ingredient.dvPercent ?? null,
      form: null,
      isProprietaryBlend: false,
      amountUnknown,
      source: 'label',
      confidence: ingredient.confidence ?? null,
    };
  });
};

const buildLabelExtraction = (draft: LabelDraft | null): SupplementSnapshot['label']['extraction'] => {
  if (!draft) return null;
  return {
    parseCoverage: draft.parseCoverage ?? null,
    confidenceScore: draft.confidenceScore ?? null,
    issues: draft.issues?.length
      ? draft.issues.map((issue) => `${issue.type}: ${issue.message}`)
      : null,
  };
};

const buildReferencesFromSources = (
  sources: EnrichedSource[] | { title?: string | null; link?: string | null }[],
  retrievedAt: string,
): SupplementSnapshot['references'] => {
  const normalizedSources = sources.map((source) => ({
    title: source.title ?? null,
    link: source.link ?? null,
  }));
  return buildReferences(normalizedSources, retrievedAt);
};

export const buildBarcodeSnapshot = (input: {
  barcode: string;
  analysis: AnalysisState;
}): SupplementSnapshot | null => {
  if (!input.barcode) return null;
  const timestamp = nowIso();

  const hasError = input.analysis.status === 'error';

  const base = baseSnapshot({
    status: hasError ? 'error' : 'partial',
    source: 'barcode',
    barcodeRaw: input.barcode,
    createdAt: timestamp,
    error: hasError && input.analysis.error
      ? { code: 'barcode_scan_failed', message: input.analysis.error }
      : null,
  });

  const productInfo = input.analysis.productInfo;
  const resolvedConfidence = buildConfidenceBase();

  const scores = buildScoresFromSections({
    efficacy: input.analysis.efficacy,
    safety: input.analysis.safety,
    value: input.analysis.value,
    social: input.analysis.social,
    confidence: resolvedConfidence,
    computedAt: timestamp,
  });

  const snapshotStatus: SnapshotStatus = hasError ? 'error' : (scores ? 'resolved' : 'partial');

  return {
    ...base,
    status: snapshotStatus,
    product: {
      ...base.product,
      brand: productInfo?.brand ?? null,
      name: productInfo?.name ?? null,
      category: productInfo?.category ?? null,
      imageUrl: productInfo?.image ?? null,
    },
    references: buildReferencesFromSources(input.analysis.sources ?? [], timestamp),
    scores,
  };
};

export const buildLabelSnapshot = (input: {
  status: 'ok' | 'needs_confirmation' | 'failed';
  analysis: AiSupplementAnalysis | null;
  draft: LabelDraft | null;
  message?: string;
}): SupplementSnapshot => {
  const timestamp = nowIso();
  const confidence = buildConfidenceBase();

  if (input.draft) {
    confidence.overall = input.draft.confidenceScore ?? null;
    confidence.labelCoverage = input.draft.parseCoverage ?? null;
    confidence.ingredientCoverage = input.draft.parseCoverage ?? null;
  }

  const scores = buildScoresFromAnalysis({
    analysis: input.analysis,
    confidence,
    computedAt: timestamp,
  });

  const statusFromAnalysis: SnapshotStatus | null =
    input.analysis?.status === 'unknown_product'
      ? 'unknown_product'
      : input.analysis?.status === 'error'
        ? 'error'
        : null;

  const status: SnapshotStatus =
    input.status === 'failed'
      ? 'error'
      : statusFromAnalysis
        ? statusFromAnalysis
        : input.status === 'needs_confirmation'
          ? 'partial'
          : (scores ? 'resolved' : 'partial');

  const errorMessage =
    input.status === 'failed'
      ? input.message ?? 'Label scan failed'
      : statusFromAnalysis === 'error'
        ? 'Label analysis failed'
        : null;

  const base = baseSnapshot({
    status,
    source: 'label',
    barcodeRaw: null,
    createdAt: timestamp,
    error: errorMessage
      ? { code: 'label_scan_failed', message: errorMessage }
      : null,
  });

  const productInfo = input.analysis?.status === 'success'
    ? input.analysis.productInfo
    : null;

  return {
    ...base,
    product: {
      ...base.product,
      brand: productInfo?.brand ?? null,
      name: productInfo?.name ?? null,
      category: productInfo?.category ?? null,
      imageUrl: productInfo?.image ?? null,
    },
    label: {
      ...base.label,
      servingSize: input.draft?.servingSize ?? null,
      actives: buildLabelActives(input.draft),
      extraction: buildLabelExtraction(input.draft),
    },
    references: buildReferencesFromSources(input.analysis?.sources ?? [], timestamp),
    scores,
  };
};
