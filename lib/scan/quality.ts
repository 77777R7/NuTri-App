import type { LabelDraft } from '@/backend/src/labelTypes';

export type DraftIssue = { type: string; message?: string };

export type LabelDraftQuality = {
  reviewRecommended: boolean;
  mutedScore: boolean;
  blockingIssues: DraftIssue[];
  labelOnlyScoreEligible: boolean;
  extractionQuality: 'High' | 'Medium' | 'Low';
  validCount: number;
};

const HIGH_RISK_ISSUES = new Set([
  'unit_invalid',
  'value_anomaly',
  'low_coverage',
  'incomplete_ingredients',
]);

const getValidIngredientCount = (draft?: LabelDraft | null) => {
  if (!draft?.ingredients?.length) return 0;
  return draft.ingredients.filter((ingredient) => ingredient.amount != null && ingredient.unit).length;
};

export const getLabelDraftQuality = (draft?: LabelDraft | null, issues?: DraftIssue[]): LabelDraftQuality => {
  const effectiveIssues = issues ?? draft?.issues ?? [];
  const blockingIssues = effectiveIssues.filter((issue) => HIGH_RISK_ISSUES.has(issue.type));
  const validCount = getValidIngredientCount(draft);
  const confidence = draft?.confidenceScore ?? 0;
  const coverage = draft?.parseCoverage ?? 0;
  const hasDraft = Boolean(draft);

  const reviewRecommended =
    !hasDraft
    || validCount === 0
    || confidence < 0.75
    || coverage < 0.7
    || blockingIssues.length > 0;

  const labelOnlyScoreEligible =
    hasDraft
    && confidence >= 0.85
    && coverage >= 0.85
    && blockingIssues.length === 0
    && validCount >= 1;

  const mutedScore = !labelOnlyScoreEligible || reviewRecommended;

  const extractionQuality =
    !hasDraft
      ? 'Low'
      : blockingIssues.length === 0 && confidence >= 0.85 && coverage >= 0.85
        ? 'High'
        : blockingIssues.length === 0 && confidence >= 0.75 && coverage >= 0.7
          ? 'Medium'
          : 'Low';

  return {
    reviewRecommended,
    mutedScore,
    blockingIssues,
    labelOnlyScoreEligible,
    extractionQuality,
    validCount,
  };
};

export type BarcodeQuality = {
  errorState: boolean;
  page: 'dashboard' | 'not_found' | 'recoverable_error' | 'session_expired';
  failureKind: 'none' | 'not_found' | 'unauthorized' | 'network' | 'server' | 'session_expired';
};

export const getBarcodeQuality = (input: {
  status?: string | null;
  error?: string | null;
  errorKind?: string | null;
  sessionState?: 'ok' | 'session_expired' | null;
}): BarcodeQuality => {
  if (input.sessionState === 'session_expired') {
    return {
      errorState: true,
      page: 'session_expired',
      failureKind: 'session_expired',
    };
  }

  if (input.status === 'not_found' || input.errorKind === 'not_found') {
    return {
      errorState: true,
      page: 'not_found',
      failureKind: 'not_found',
    };
  }

  const isRecoverableError = input.status === 'error' || Boolean(input.error);
  if (isRecoverableError) {
    const kind = input.errorKind === 'unauthorized'
      ? 'unauthorized'
      : input.errorKind === 'network'
        ? 'network'
        : 'server';
    return {
      errorState: true,
      page: 'recoverable_error',
      failureKind: kind,
    };
  }

  return {
    errorState: false,
    page: 'dashboard',
    failureKind: 'none',
  };
};
