import type { SearchProductDetailResponse } from '@/lib/api-client';
import type { AnalysisBundle } from '@/types/analysisBundle';

type DatabaseAnalysisPayload = {
  analysis: {
    productInfo: {
      brand: string | null;
      name: string | null;
      category: string | null;
      image: string | null;
    };
    barcode: string | null;
    efficacy: Record<string, never>;
    safety: Record<string, never>;
    usage: Record<string, never>;
    value: Record<string, never>;
    social: Record<string, never>;
    meta: {
      analysisStatus: 'database_product';
      analysisVersion: 'product_search_detail_v1';
      labelExtraction: null;
      actualDoseMg: number;
    };
    status: 'success';
  };
  analysisBundle: AnalysisBundle;
};

const normalizeText = (value: unknown): string | null => {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
};

const parseDoseNumber = (value: string | null | undefined): number => {
  const match = normalizeText(value)?.match(/[0-9]+(?:\.[0-9]+)?/);
  if (!match) return 0;
  const parsed = Number(match[0]);
  return Number.isFinite(parsed) ? parsed : 0;
};

const buildBullet = (text: string) => ({
  text,
  basisTags: ['label_fact' as const],
});

export const buildDatabaseAnalysisPayload = (
  detail: SearchProductDetailResponse,
): DatabaseAnalysisPayload => {
  const product = detail.product;
  const productId = normalizeText(product.productId) ?? 'unknown-product';
  const productName = normalizeText(product.name) ?? 'Supplement detail';
  const brandName = normalizeText(product.brand) ?? 'Unknown brand';
  const ingredientRows = detail.scienceBlock?.ingredientRows ?? [];
  const overviewSummary =
    normalizeText(detail.overviewBlock?.bestForBullets?.[0]) ??
    `${productName} is shown from the Product Search label record.`;
  const ingredientItems = ingredientRows.slice(0, 8).map((row) => ({
    name: normalizeText(row?.name) ?? 'Ingredient',
    dose: normalizeText(row?.dose),
    basisTags: ['label_fact' as const],
  }));
  const usageLines =
    detail.usageBlock?.directions?.lines ??
    (normalizeText(detail.usageBlock?.directions?.text)
      ? [normalizeText(detail.usageBlock?.directions?.text) as string]
      : []);
  const safetyLines = [
    ...(detail.safetyBlock?.labelWarnings ?? []).map((item) =>
      typeof item === 'string'
        ? item
        : normalizeText(item?.text) ?? normalizeText(item?.label) ?? '',
    ),
    ...(detail.safetyBlock?.generalWatchouts ?? []).map((item) =>
      typeof item === 'string'
        ? item
        : normalizeText(item?.text) ?? normalizeText(item?.label) ?? '',
    ),
  ].filter(Boolean);

  const decisionSupportInline = {
    digest: detail.decisionDigest,
    decisionInputsHash: detail.decisionInputsHash ?? detail.decisionDigest,
    personalizationScopeHash: detail.personalizationScopeHash ?? 'none',
    decisionContractVersion: detail.decisionContractVersion ?? null,
    sourceType: 'web',
    nutriScoreCardV2: detail.nutriScoreCardV2,
    personalizedResultLane: detail.personalizedResultLane,
    topBlockers: detail.topBlockers,
    overviewBlock: detail.overviewBlock,
    scienceBlock: detail.scienceBlock,
    usageBlock: detail.usageBlock,
    safetyBlock: detail.safetyBlock,
  };

  const analysisBundle = {
    meta: {
      schemaVersion: 4,
      promptVersion: 'database_product_analysis_v1',
      sourceType: 'web',
      sourceTypeFinal: true,
      scoreAvailable: Boolean(detail.nutriScoreCardV2),
      authoritativeIdentity: { type: 'webCanonicalId', value: productId },
      productIdentity: {
        name: productName,
        brand: brandName,
        sourceAttribution: 'label_record',
        identityStable: true,
        sourceId: productId,
      },
      locale: 'en',
      phase: 'full_ai',
      bundleId: `database:${productId}`,
      revision: 1,
      factsDigestHash: detail.decisionDigest || `database:${productId}`,
      factsSourceVersion: 'product_search_detail_v1',
      detailReady: true,
      fallbackReason: 'database_product_detail',
      stage0Winner: 'label_record',
      stage0StartCount: 0,
      stage0ReplaceCount: 0,
      decisionSupportDigest: detail.decisionDigest,
      decisionInputsHash: detail.decisionInputsHash ?? detail.decisionDigest,
      personalizationScopeHash: detail.personalizationScopeHash ?? 'none',
      decisionContractVersion: detail.decisionContractVersion ?? undefined,
      decisionSupportInline,
    },
    sections: {
      overview: {
        layout: 'overview_card',
        cover: {
          summary: overviewSummary,
          bullets: [
            ...ingredientItems.slice(0, 3).map((item) =>
              buildBullet(item.dose ? `${item.name} - ${item.dose}` : item.name),
            ),
          ],
        },
        detail: {
          summary: overviewSummary,
          bullets: [
            ...(detail.overviewBlock?.bestForBullets ?? []).slice(0, 4).map(buildBullet),
          ],
        },
        dataStatus: product.coverageStatus === 'coverage_ready' ? 'complete' : 'limited',
      },
      ingredients: {
        layout: 'ingredients_list',
        cover: {
          items: ingredientItems,
          totalCount: ingredientItems.length,
        },
        detail: null,
        dataStatus: ingredientItems.length > 0 ? 'complete' : 'limited',
      },
      usage: {
        layout: 'usage_bullets',
        cover: {
          bullets: usageLines.slice(0, 4).map(buildBullet),
          bestTimeToTake: null,
          withFood: null,
          dosage: normalizeText(product.dose)
            ? { text: product.dose as string, basisTags: ['label_fact' as const] }
            : null,
        },
        detail: null,
        dataStatus: usageLines.length > 0 ? 'complete' : 'limited',
      },
      safety: {
        layout: 'safety_bullets',
        cover: {
          verdict: safetyLines.length > 0 ? 'Review label cautions before use.' : 'No label warning captured in this record.',
          bullets: safetyLines.slice(0, 4).map(buildBullet),
        },
        detail: null,
        signals: null,
        dataStatus: safetyLines.length > 0 ? 'complete' : 'limited',
      },
    },
  } as AnalysisBundle;

  return {
    analysis: {
      productInfo: {
        brand: brandName,
        name: productName,
        category: normalizeText(product.category),
        image: normalizeText(product.imageUrl),
      },
      barcode: normalizeText(product.barcode),
      efficacy: {},
      safety: {},
      usage: {},
      value: {},
      social: {},
      meta: {
        analysisStatus: 'database_product',
        analysisVersion: 'product_search_detail_v1',
        labelExtraction: null,
        actualDoseMg: parseDoseNumber(product.dose),
      },
      status: 'success',
    },
    analysisBundle,
  };
};
