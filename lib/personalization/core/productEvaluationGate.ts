import type {
  ProductCoverageDecision,
  SavedProductFactsStatus,
} from '../../../types/personalization';
import { buildReason, REASON_CODES, RULE_IDS } from './reasonCodes';

export type ProductEvaluationGateInput = {
  factsStatus?: SavedProductFactsStatus | null;
  goalScoringBlockedReason?: 'out_of_scope_non_supplement' | null;
};

const normalizeFactsStatus = (
  factsStatus?: SavedProductFactsStatus | null,
): SavedProductFactsStatus => {
  if (factsStatus === 'full' || factsStatus === 'partial' || factsStatus === 'none') {
    return factsStatus;
  }

  return 'none';
};

export const evaluateProductCoverageGate = (
  input: ProductEvaluationGateInput,
): ProductCoverageDecision => {
  const factsStatus = normalizeFactsStatus(input.factsStatus);

  if (input.goalScoringBlockedReason === 'out_of_scope_non_supplement') {
    return {
      factsStatus,
      status: 'not_enough_structured_data',
      reasons: [
        buildReason(
          REASON_CODES.productOutOfScopeNonSupplement,
          RULE_IDS.productOutOfScopeNonSupplement,
          'derived',
          {
            factsStatus,
            goalScoringBlockedReason: input.goalScoringBlockedReason,
          },
        ),
      ],
    };
  }

  if (factsStatus === 'full') {
    return {
      factsStatus,
      status: 'coverage_ready',
      reasons: [
        buildReason(
          REASON_CODES.productCoverageReady,
          RULE_IDS.productCoverageReady,
          'derived',
          { factsStatus },
        ),
      ],
    };
  }

  return {
    factsStatus,
    status: 'not_enough_structured_data',
    reasons: [
      buildReason(
        REASON_CODES.productNotEnoughStructuredData,
        RULE_IDS.productNotEnoughStructuredData,
        'derived',
        { factsStatus },
      ),
    ],
  };
};

export const productEvaluationGateInternals = {
  normalizeFactsStatus,
};
