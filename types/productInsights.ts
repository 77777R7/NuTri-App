export const FORM_REASON_CODES = [
  'FORM_FACTS_PRESENT',
  'FORM_INFERRED_GATE_PASS',
  'FORM_INFERRED_GATE_FAIL_LOW_SCORE',
  'FORM_INFERRED_GATE_FAIL_NO_EVIDENCE',
  'FORM_NOT_DISCLOSED',
] as const;

export const RBF_REASON_CODES = [
  'RBF_SIGNAL_PRESENT',
  'RBF_SIGNAL_MISSING',
  'RBF_INVALID_SIGNAL',
] as const;

export const DOSE_REASON_CODES = [
  'DOSE_DAILY_COMPUTED',
  'DOSE_DAILY_MISSING_DIRECTIONS',
  'DOSE_UNIT_UNSUPPORTED',
  'DOSE_RANGE_MISSING',
  'DOSE_BELOW_TYPICAL',
  'DOSE_WITHIN_TYPICAL',
  'DOSE_ABOVE_TYPICAL',
] as const;

export const WEB_SCORING_REASON_CODES = [
  'WEB_ELIGIBILITY_FAILED_INSUFFICIENT_ACTIVES',
  'WEB_OWNERSHIP_STRONG_PASS_BARCODE',
  'WEB_OWNERSHIP_STRONG_PASS_REG_ID',
  'WEB_OWNERSHIP_MEDIUM_PASS',
  'WEB_OWNERSHIP_FAILED',
  'WEB_SCORE_PENDING',
  'WEB_SCORE_OK',
  'WEB_PARSE_FAILED',
  'WEB_DATA_UNAVAILABLE',
] as const;

export const LLM_VERIFIER_REASON_CODES = [
  'LLM_VERIFIER_PASS',
  'LLM_VERIFIER_FAIL_NUMERIC_NOT_IN_INPUT',
  'LLM_VERIFIER_FAIL_FORM_NOT_IN_INPUT',
  'LLM_VERIFIER_FAIL_UL_NOT_IN_INPUT',
  'LLM_VERIFIER_FAIL_NON_JSON',
  'LLM_FALLBACK_USED',
] as const;

export type FormReasonCode = (typeof FORM_REASON_CODES)[number];
export type RbfReasonCode = (typeof RBF_REASON_CODES)[number];
export type DoseReasonCode = (typeof DOSE_REASON_CODES)[number];
export type WebScoringReasonCode = (typeof WEB_SCORING_REASON_CODES)[number];
export type LlmVerifierReasonCode = (typeof LLM_VERIFIER_REASON_CODES)[number];

export type FactsDTO = {
  source: 'label_scan' | 'lnhpd' | 'dsld' | 'web_verified';
  sourceId: string;
  canonicalSourceId?: string | null;
  barcode: string;
  product?: {
    brandName?: string | null;
    productName?: string | null;
  };
  usage?: {
    servingsPerDay?: number | null;
    directionsRaw?: string | null;
  };
  ingredients: Array<{
    name: string;
    amount: number | null;
    unit: string | null;
    formText?: string | null;
    isBlendPlaceholder?: boolean;
  }>;
  provenance?: {
    sourceUrl?: string | null;
    extractedAt?: string | null;
  };
};

export type InsightsDTO = {
  ingredientName: string;
  formExplain?: string | null;
  rbfBand?: 'high' | 'normal' | 'low' | 'unknown';
  confidenceTier?: 'high' | 'medium' | 'low' | 'none';
  reasonCode?: FormReasonCode | RbfReasonCode | DoseReasonCode;
};

export type BackgroundDTO = {
  ingredientName: string;
  kind: 'ods' | 'curated';
  summary: string;
  watchOuts?: string[];
  sourceUrl?: string | null;
};
