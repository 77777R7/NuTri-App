import { randomUUID } from 'node:crypto';
import type { LabelDraft } from './labelAnalysis.js';
import type { AiSupplementAnalysis, SearchItem } from './types.js';
import { normalizeBarcodeInput } from './barcode.js';
import {
  EXCERPT_MAX_CHARS,
  SNAPSHOT_SCHEMA_VERSION,
  SupplementSnapshotSchema,
  type SupplementSnapshot,
} from './schemas/supplementSnapshot.js';

export type SnapshotStatus = 'resolved' | 'partial' | 'unknown_product' | 'error';
export type SnapshotSource = 'barcode' | 'label' | 'mixed';

export type SnapshotAnalysisPayload = {
  brandExtraction?: {
    brand: string | null;
    product: string | null;
    category: string | null;
    confidence: 'high' | 'medium' | 'low';
    source: 'rule' | 'ai';
  } | null;
  productInfo?: {
    brand: string | null;
    name: string | null;
    category: string | null;
    image: string | null;
  } | null;
  sources?: Array<{
    title: string;
    link: string;
    domain?: string;
    isHighQuality?: boolean;
  }>;
  efficacy?: unknown;
  safety?: unknown;
  usagePayload?: unknown;
};

export const SNAPSHOT_VALIDATION_ERROR_CODE = 'SNAPSHOT_VALIDATION_FAILED' as const;

type SnapshotScoreConfidence = {
  overall: number | null;
  labelCoverage: number | null;
  ingredientCoverage: number | null;
  priceCoverage: number | null;
  trustCoverage: number | null;
  regulatoryCoverage: number | null;
};

type NormalizedAmountUnit = 'mg' | 'mcg' | 'g' | 'iu' | 'cfu' | 'ml';

const createSnapshotId = () => {
  try {
    return randomUUID();
  } catch {
    return `snapshot_${Date.now()}_${Math.floor(Math.random() * 1_000_000)}`;
  }
};

const nowIso = () => new Date().toISOString();

const truncateExcerpt = (value?: string | null): string => {
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

const buildReferencesFromSearchItems = (
  items: SearchItem[],
  retrievedAt: string,
): SupplementSnapshot['references'] => {
  const references: SupplementSnapshot['references']['items'] = [];
  const seen = new Set<string>();

  items.forEach((item, index) => {
    const title = item.title?.trim() || 'Source';
    const url = item.link?.trim() || '';
    const excerpt = truncateExcerpt(item.snippet ?? '');
    const hash = hashString(`${url}\n${excerpt}`);
    if (seen.has(hash)) return;
    seen.add(hash);
    references.push({
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

  return { items: references };
};

const buildConfidenceBase = (): SnapshotScoreConfidence => ({
  overall: null,
  labelCoverage: null,
  ingredientCoverage: null,
  priceCoverage: null,
  trustCoverage: null,
  regulatoryCoverage: null,
});

const buildScores = (params: {
  efficacyScore?: number | null;
  safetyScore?: number | null;
  valueScore?: number | null;
  confidence: SnapshotScoreConfidence;
  computedAt: string;
}): SupplementSnapshot['scores'] | undefined => {
  const { efficacyScore, safetyScore, valueScore, confidence, computedAt } = params;
  if (
    typeof efficacyScore !== 'number' ||
    typeof safetyScore !== 'number' ||
    typeof valueScore !== 'number'
  ) {
    return undefined;
  }

  const effectiveness = Math.round(efficacyScore * 10);
  const safety = Math.round(safetyScore * 10);
  const value = Math.round(valueScore * 10);
  const overall = Math.round((effectiveness + safety + value) / 3);

  return {
    overall,
    effectiveness,
    safety,
    value,
    version: 'ai-raw',
    computedAt,
    confidence,
  };
};

const baseSnapshot = (input: {
  status: SnapshotStatus;
  source: SnapshotSource;
  barcodeRaw: string | null;
  createdAt?: string;
  error?: SupplementSnapshot['error'];
}): SupplementSnapshot => {
  const createdAt = input.createdAt ?? nowIso();
  const normalized = input.barcodeRaw ? normalizeBarcodeInput(input.barcodeRaw) : null;
  const canonical = normalized ? normalized.code.padStart(14, '0') : null;

  return {
    schemaVersion: SNAPSHOT_SCHEMA_VERSION,
    snapshotId: createSnapshotId(),
    status: input.status,
    source: input.source,
    region: 'global',
    createdAt,
    updatedAt: createdAt,
    error: input.error ?? null,
    product: {
      brand: null,
      name: null,
      category: null,
      imageUrl: null,
      barcode: {
        raw: input.barcodeRaw,
        normalized: canonical,
        normalizedFormat: canonical ? 'gtin14' : null,
        isChecksumValid: normalized?.isValidChecksum ?? null,
        variants: normalized?.variants ?? null,
      },
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

  const scores = buildScores({
    efficacyScore: input.analysis?.status === 'success' ? input.analysis.efficacy?.score ?? null : null,
    safetyScore: input.analysis?.status === 'success' ? input.analysis.safety?.score ?? null : null,
    valueScore: input.analysis?.status === 'success' ? input.analysis.value?.score ?? null : null,
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
          : scores
            ? 'resolved'
            : 'partial';

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
    error: errorMessage ? { code: 'label_scan_failed', message: errorMessage } : null,
  });

  const productInfo = input.analysis?.status === 'success'
    ? input.analysis.productInfo
    : null;

  const actives = input.draft
    ? input.draft.ingredients.map((ingredient) => {
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
        source: 'label' as const,
        confidence: ingredient.confidence ?? null,
      };
    })
    : [];

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
      actives,
      extraction: input.draft
        ? {
          parseCoverage: input.draft.parseCoverage ?? null,
          confidenceScore: input.draft.confidenceScore ?? null,
          issues: input.draft.issues?.length
            ? input.draft.issues.map((issue) => `${issue.type}: ${issue.message}`)
            : null,
        }
        : null,
    },
    references: {
      items: input.analysis?.status === 'success'
        ? input.analysis.sources.map((source, index) => {
          const title = source.title?.trim() || 'Source';
          const url = source.link?.trim() || '';
          const excerpt = truncateExcerpt('');
          const hash = hashString(`${url}\n${excerpt}`);
          return {
            id: `ref_${index + 1}_${hash}`,
            sourceType: 'OTHER',
            title,
            url,
            excerpt,
            retrievedAt: timestamp,
            hash,
            evidenceFor: 'general' as const,
          };
        })
        : [],
    },
    scores,
  };
};

export const buildBarcodeSnapshot = (input: {
  barcode: string;
  productInfo: {
    brand: string | null;
    name: string | null;
    category?: string | null;
    image?: string | null;
  } | null;
  sources: SearchItem[];
  efficacy: any | null;
  safety: any | null;
  usagePayload: any | null;
}): SupplementSnapshot => {
  const timestamp = nowIso();
  const confidence = buildConfidenceBase();
  const scores = buildScores({
    efficacyScore: input.efficacy?.score ?? null,
    safetyScore: input.safety?.score ?? null,
    valueScore: input.usagePayload?.value?.score ?? null,
    confidence,
    computedAt: timestamp,
  });

  const status: SnapshotStatus = scores ? 'resolved' : 'partial';

  const base = baseSnapshot({
    status,
    source: 'barcode',
    barcodeRaw: input.barcode,
    createdAt: timestamp,
  });

  return {
    ...base,
    product: {
      ...base.product,
      brand: input.productInfo?.brand ?? null,
      name: input.productInfo?.name ?? null,
      category: input.productInfo?.category ?? null,
      imageUrl: input.productInfo?.image ?? null,
    },
    references: buildReferencesFromSearchItems(input.sources ?? [], timestamp),
    scores,
  };
};

export const validateSnapshotOrFallback = (params: {
  candidate: SupplementSnapshot;
  fallback: {
    source: SnapshotSource;
    barcodeRaw: string | null;
    productInfo?: { brand?: unknown; name?: unknown; category?: unknown; imageUrl?: unknown } | null;
    createdAt?: string;
  };
}): SupplementSnapshot => {
  const { candidate, fallback } = params;
  try {
    return SupplementSnapshotSchema.parse(candidate);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown snapshot validation error';
    console.warn('[snapshot] validation failed', message);

    const base = baseSnapshot({
      status: 'partial',
      source: fallback.source,
      barcodeRaw: fallback.barcodeRaw,
      createdAt: fallback.createdAt,
      error: { code: SNAPSHOT_VALIDATION_ERROR_CODE, message },
    });

    const safeString = (value: unknown): string | null =>
      typeof value === 'string' && value.trim().length > 0 ? value : null;

    const sanitized = {
      ...base,
      product: {
        ...base.product,
        brand: safeString(fallback.productInfo?.brand),
        name: safeString(fallback.productInfo?.name),
        category: safeString(fallback.productInfo?.category),
        imageUrl: safeString(fallback.productInfo?.imageUrl),
      },
    } satisfies SupplementSnapshot;

    return SupplementSnapshotSchema.parse(sanitized);
  }
};
