import type {
  EligibilityDecision,
  GoalKey,
  ProductCoverageDecision,
  ProductGoalMatch,
  ProductGoalMatchTier,
  SavedProductEvaluation,
  SavedProductEvaluationInput,
  SmartFilterProductBucket,
  SmartFilterProductMembership,
  SupplementTypeKey,
} from '../../../types/personalization';
import { flatMapCompat } from '@/lib/utils/arrayCompat';
import { buildReason, dedupeReasons, REASON_CODES, RULE_IDS } from './reasonCodes';
import { evaluateProductCoverageGate } from './productEvaluationGate';

export type SavedProductEvaluationSet = {
  coverage: Record<string, ProductCoverageDecision>;
  savedProductEvaluations: Record<string, SavedProductEvaluation>;
  productGoalMatches: Record<string, ProductGoalMatch[]>;
  eligibility: Record<string, EligibilityDecision>;
};

export type EvaluateSavedProductsInput = {
  prioritizedGoals: GoalKey[];
  savedProducts: Record<string, SavedProductEvaluationInput>;
};

const hasDisplayFields = (evaluation: Pick<SavedProductEvaluationInput, 'display'>) =>
  Boolean(
    evaluation.display?.title ||
      evaluation.display?.brandName ||
      evaluation.display?.dosageText ||
      evaluation.display?.imageUrl,
  );

const TIER_PRIORITY: Record<ProductGoalMatchTier, number> = {
  strong_match: 4,
  related: 3,
  weak_match: 2,
  no_match: 1,
};

const toEligibilitySummary = (decision?: EligibilityDecision) =>
  decision
    ? {
        eligible: decision.eligible,
        rankEligible: decision.rankEligible,
        caps: [...decision.caps],
      }
    : undefined;

const getTypeKeys = (
  savedProduct: Pick<SavedProductEvaluationInput, 'typeKeys'>,
): SupplementTypeKey[] => Array.from(new Set(savedProduct.typeKeys ?? []));

const getGoalTiers = (
  prioritizedGoals: GoalKey[],
  matches: ProductGoalMatch[],
): Partial<Record<GoalKey, ProductGoalMatchTier>> =>
  Object.fromEntries(
    prioritizedGoals
      .map((goalKey) => {
        const match = matches.find((entry) => entry.goalKey === goalKey);
        return match ? ([goalKey, match.tier] as const) : null;
      })
      .filter((entry): entry is readonly [GoalKey, ProductGoalMatchTier] => entry != null),
  );

const getMatchBucket = (
  prioritizedGoals: GoalKey[],
  matches: ProductGoalMatch[],
): Exclude<SmartFilterProductBucket, 'not_enough_structured_data'> => {
  const relevantMatches =
    prioritizedGoals.length > 0
      ? matches.filter((match) => prioritizedGoals.includes(match.goalKey))
      : matches;

  const bestMatch = relevantMatches
    .filter((match) => match.score > 0)
    .sort((left, right) => {
      const tierDelta = TIER_PRIORITY[right.tier] - TIER_PRIORITY[left.tier];
      if (tierDelta !== 0) return tierDelta;
      return right.score - left.score;
    })[0];

  return bestMatch?.tier ?? 'no_match';
};

const getHighlightedGoal = (
  prioritizedGoals: GoalKey[],
  matches: ProductGoalMatch[],
): GoalKey | undefined => {
  const bestMatch = matches
    .filter((match) => prioritizedGoals.includes(match.goalKey) && match.score > 0)
    .sort((left, right) => {
      const tierDelta = TIER_PRIORITY[right.tier] - TIER_PRIORITY[left.tier];
      if (tierDelta !== 0) return tierDelta;
      return right.score - left.score;
    })[0];

  return bestMatch?.goalKey;
};

const buildNotEnoughStructuredDataMembership = (input: {
  productId: string;
  factsStatus: SavedProductEvaluationInput['factsStatus'];
  typeKeys: SupplementTypeKey[];
  coverage: ProductCoverageDecision;
}): SmartFilterProductMembership => ({
  productId: input.productId,
  factsStatus: input.factsStatus,
  coverageStatus: input.coverage.status,
  bucket: 'not_enough_structured_data',
  typeKeys: input.typeKeys,
  goalTiers: {},
  reasons: [...input.coverage.reasons],
});

const buildCoverageReadyMembership = (input: {
  productId: string;
  factsStatus: SavedProductEvaluationInput['factsStatus'];
  typeKeys: SupplementTypeKey[];
  coverage: ProductCoverageDecision;
  prioritizedGoals: GoalKey[];
  productGoalMatches: ProductGoalMatch[];
  eligibility?: EligibilityDecision;
}): SmartFilterProductMembership => {
  const bucket = getMatchBucket(input.prioritizedGoals, input.productGoalMatches);
  const highlightedGoal = getHighlightedGoal(input.prioritizedGoals, input.productGoalMatches);

  return {
    productId: input.productId,
    factsStatus: input.factsStatus,
    coverageStatus: input.coverage.status,
    bucket,
    typeKeys: input.typeKeys,
    ...(highlightedGoal ? { highlightedGoal } : {}),
    goalTiers: getGoalTiers(input.prioritizedGoals, input.productGoalMatches),
    ...(input.eligibility ? { eligibility: toEligibilitySummary(input.eligibility) } : {}),
    reasons: dedupeReasons(
      input.coverage.reasons,
      flatMapCompat(input.productGoalMatches, (match) => match.reasons),
      input.eligibility?.reasons ?? [],
      [
        buildReason(
          REASON_CODES.smartFilterProductMembershipBucketed,
          RULE_IDS.smartFilterProductMembershipBucketed,
          'derived',
          {
            bucket,
            productId: input.productId,
            ...(highlightedGoal ? { highlightedGoal } : {}),
          },
        ),
      ],
    ),
  };
};

const evaluateSavedProduct = (input: {
  prioritizedGoals: GoalKey[];
  savedProduct: SavedProductEvaluationInput;
}): SavedProductEvaluation => {
  const coverage = evaluateProductCoverageGate({
    factsStatus: input.savedProduct.factsStatus,
    goalScoringBlockedReason: input.savedProduct.goalScoringBlockedReason ?? null,
  });
  const typeKeys = getTypeKeys(input.savedProduct);

  if (coverage.status !== 'coverage_ready') {
    const smartFilterMembership = buildNotEnoughStructuredDataMembership({
      productId: input.savedProduct.productId,
      factsStatus: input.savedProduct.factsStatus,
      typeKeys,
      coverage,
    });

    return {
      productId: input.savedProduct.productId,
      factsStatus: input.savedProduct.factsStatus,
      coverage,
      productGoalMatches: [],
      firstStackEligible: false,
      smartFilterMembership,
      ...(hasDisplayFields(input.savedProduct) ? { display: { ...input.savedProduct.display } } : {}),
      reasons: dedupeReasons(
        coverage.reasons,
        smartFilterMembership.reasons,
        [
          buildReason(
            REASON_CODES.savedProductEvaluationCompiled,
            RULE_IDS.savedProductEvaluationCompiled,
            'derived',
            {
              productId: input.savedProduct.productId,
              coverageStatus: coverage.status,
            },
          ),
        ],
      ),
    };
  }

  const productGoalMatches = [...(input.savedProduct.productGoalMatches ?? [])];
  const eligibility = input.savedProduct.eligibility;
  const smartFilterMembership = buildCoverageReadyMembership({
    productId: input.savedProduct.productId,
    factsStatus: input.savedProduct.factsStatus,
    typeKeys,
    coverage,
    prioritizedGoals: input.prioritizedGoals,
    productGoalMatches,
    eligibility,
  });

  return {
    productId: input.savedProduct.productId,
    factsStatus: input.savedProduct.factsStatus,
    coverage,
    productGoalMatches,
    ...(eligibility ? { eligibility } : {}),
    firstStackEligible:
      (eligibility?.rankEligible ?? true) &&
      smartFilterMembership.bucket !== 'no_match' &&
      smartFilterMembership.bucket !== 'not_enough_structured_data',
    smartFilterMembership,
    ...(hasDisplayFields(input.savedProduct) ? { display: { ...input.savedProduct.display } } : {}),
    reasons: dedupeReasons(
      coverage.reasons,
      flatMapCompat(productGoalMatches, (match) => match.reasons),
      eligibility?.reasons ?? [],
      smartFilterMembership.reasons,
      [
        buildReason(
          REASON_CODES.savedProductEvaluationCompiled,
          RULE_IDS.savedProductEvaluationCompiled,
          'derived',
          {
            productId: input.savedProduct.productId,
            coverageStatus: coverage.status,
            bucket: smartFilterMembership.bucket,
          },
        ),
      ],
    ),
  };
};

export const evaluateSavedProducts = (
  input: EvaluateSavedProductsInput,
): SavedProductEvaluationSet => {
  const entries = Object.values(input.savedProducts).map((savedProduct) =>
    evaluateSavedProduct({
      prioritizedGoals: input.prioritizedGoals,
      savedProduct,
    }),
  );

  return entries.reduce<SavedProductEvaluationSet>(
    (acc, evaluation) => {
      acc.coverage[evaluation.productId] = evaluation.coverage;
      acc.savedProductEvaluations[evaluation.productId] = evaluation;

      if (evaluation.coverage.status === 'coverage_ready') {
        acc.productGoalMatches[evaluation.productId] = evaluation.productGoalMatches;
        if (evaluation.eligibility) {
          acc.eligibility[evaluation.productId] = evaluation.eligibility;
        }
      }

      return acc;
    },
    {
      coverage: {},
      savedProductEvaluations: {},
      productGoalMatches: {},
      eligibility: {},
    },
  );
};

export const projectSavedProductEvaluations = (
  evaluations: Record<string, SavedProductEvaluation>,
): SavedProductEvaluationSet =>
  Object.values(evaluations).reduce<SavedProductEvaluationSet>(
    (acc, evaluation) => {
      acc.coverage[evaluation.productId] = evaluation.coverage;
      acc.savedProductEvaluations[evaluation.productId] = evaluation;

      if (evaluation.coverage.status === 'coverage_ready') {
        acc.productGoalMatches[evaluation.productId] = evaluation.productGoalMatches;
        if (evaluation.eligibility) {
          acc.eligibility[evaluation.productId] = evaluation.eligibility;
        }
      }

      return acc;
    },
    {
      coverage: {},
      savedProductEvaluations: {},
      productGoalMatches: {},
      eligibility: {},
    },
  );

export const savedProductEvaluationInternals = {
  evaluateSavedProduct,
  getGoalTiers,
  getHighlightedGoal,
  getMatchBucket,
  getTypeKeys,
  projectSavedProductEvaluations,
};
