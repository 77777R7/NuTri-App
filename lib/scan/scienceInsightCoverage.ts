export type BundleSectionStatus = 'complete' | 'limited' | 'not_provided' | 'pending' | 'error';

export type ProductSpecificInsightLike = {
  formLabel?: string | null;
  matchScore?: number | null;
  confidenceTier?: string | null;
  effectiveFactor?: number | null;
  rbfBand?: string | null;
  doseSignal?: {
    status?: string | null;
  } | null;
};

export type IngredientDetailLike = {
  chemicalFormExplain?: {
    text?: string | null;
    basisTags?: string[] | null;
  } | null;
};

export type ScienceInsightCoverage = {
  hasFormSignal: boolean;
  hasRbfSignal: boolean;
  hasDoseSignal: boolean;
  allMissing: boolean;
};

const FORM_MATCH_GATE = 0.35;

const hasFormFromDetail = (detail: IngredientDetailLike): boolean => {
  const explain = detail.chemicalFormExplain;
  if (!explain) return false;
  const tags = Array.isArray(explain.basisTags) ? explain.basisTags : [];
  if (tags.includes('not_provided')) return false;
  const text = typeof explain.text === 'string' ? explain.text.trim() : '';
  if (!text) return false;
  return !/not\s+provided/i.test(text);
};

const hasFormFromInsight = (insight: ProductSpecificInsightLike): boolean => {
  const formLabel = typeof insight.formLabel === 'string' ? insight.formLabel.trim() : '';
  if (!formLabel) return false;
  const confidence = String(insight.confidenceTier ?? '').toLowerCase();
  if (confidence === 'none') return false;
  const score = typeof insight.matchScore === 'number' && Number.isFinite(insight.matchScore)
    ? insight.matchScore
    : null;
  return score != null && score >= FORM_MATCH_GATE;
};

const hasRbfFromInsight = (insight: ProductSpecificInsightLike): boolean => {
  if (typeof insight.effectiveFactor === 'number' && Number.isFinite(insight.effectiveFactor)) return true;
  const band = String(insight.rbfBand ?? '').toLowerCase();
  return band === 'high' || band === 'normal' || band === 'low';
};

const hasDoseFromInsight = (insight: ProductSpecificInsightLike): boolean => {
  const status = String(insight.doseSignal?.status ?? '').trim().toLowerCase();
  if (!status) return false;
  return status !== 'unknown';
};

export const computeScienceInsightCoverage = (params: {
  insights: ProductSpecificInsightLike[];
  ingredientDetails: IngredientDetailLike[];
}): ScienceInsightCoverage => {
  const hasFormSignal =
    params.ingredientDetails.some(hasFormFromDetail) || params.insights.some(hasFormFromInsight);
  const hasRbfSignal = params.insights.some(hasRbfFromInsight);
  const hasDoseSignal = params.insights.some(hasDoseFromInsight);
  const allMissing = !hasFormSignal && !hasRbfSignal && !hasDoseSignal;
  return {
    hasFormSignal,
    hasRbfSignal,
    hasDoseSignal,
    allMissing,
  };
};

export const computeScienceDisplayStatus = (
  sectionStatus: BundleSectionStatus,
  coverage: ScienceInsightCoverage,
): BundleSectionStatus => {
  if (sectionStatus === 'complete' && coverage.allMissing) {
    return 'limited';
  }
  return sectionStatus;
};
