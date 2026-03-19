import type {
  ActivityPlan,
  BlockerStrategy,
  DecisionReason,
  EligibilityDecision,
  ExperienceMode,
  FirstStackPlan,
  FirstStackPlanItem,
  GoalKey,
  ProductGoalMatch,
  SavedProductEvaluation,
} from '@/types/personalization';
import { buildReason, dedupeReasons, REASON_CODES, RULE_IDS } from './reasonCodes';

export type StackComposerInput = {
  prioritizedGoals: GoalKey[];
  blockerStrategy: BlockerStrategy;
  experienceMode: ExperienceMode;
  activityPlan: ActivityPlan;
  savedProductEvaluations?: Record<string, SavedProductEvaluation>;
  productGoalMatches: Record<string, ProductGoalMatch[]>;
  eligibility?: Record<string, EligibilityDecision>;
  duplicateRiskLevel?: 'none' | 'medium' | 'high';
};

type StackCandidate = {
  productId: string;
  matches: ProductGoalMatch[];
  eligibility: EligibilityDecision;
  coveredGoals: GoalKey[];
  matchedGoalSet: Set<GoalKey>;
  totalScore: number;
  capCount: number;
  topGoalIndex: number;
  firstStackEligible: boolean;
  reasons: DecisionReason[];
  display?: FirstStackPlanItem['display'];
};

const tierWeight: Record<ProductGoalMatch['tier'], number> = {
  strong_match: 3,
  related: 2,
  weak_match: 1,
  no_match: 0,
};

const toEligibilityDecision = (input?: EligibilityDecision): EligibilityDecision => ({
  eligible: input?.eligible ?? true,
  rankEligible: input?.rankEligible ?? true,
  caps: [...(input?.caps ?? [])],
  reasons: [...(input?.reasons ?? [])],
});

const hasDisplayFields = (display?: FirstStackPlanItem['display']) =>
  Boolean(display?.title || display?.brandName || display?.dosageText || display?.imageUrl);

const getMaxItems = (
  experienceMode: ExperienceMode,
  duplicateRiskLevel: StackComposerInput['duplicateRiskLevel'],
): number => {
  switch (experienceMode.uiDensity) {
    case 'minimal':
      return 2;
    case 'advanced':
      return duplicateRiskLevel === 'high' ? 3 : 4;
    default:
      return duplicateRiskLevel === 'high' ? 2 : 3;
  }
};

const getScheduleTemplateKey = (
  blockerStrategy: BlockerStrategy,
  activityPlan: ActivityPlan,
  experienceMode: ExperienceMode,
) => {
  if (blockerStrategy.scheduleComplexity === 'advanced' || experienceMode.uiDensity === 'advanced') {
    return 'phase3_advanced_template';
  }

  if (
    blockerStrategy.scheduleComplexity === 'guided' ||
    activityPlan.suggestedTimingAnchors.length > 1
  ) {
    return 'phase3_guided_template';
  }

  return 'phase3_simple_template';
};

const buildCandidate = (input: {
  prioritizedGoals: GoalKey[];
  productId: string;
  matches: ProductGoalMatch[];
  eligibility?: EligibilityDecision;
  firstStackEligible: boolean;
  reasons?: DecisionReason[];
  display?: FirstStackPlanItem['display'];
}): StackCandidate => {
  const eligibleDecision = toEligibilityDecision(input.eligibility);
  const coveredGoals = input.prioritizedGoals.filter((goalKey) =>
    input.matches.some(
      (match) => match.goalKey === goalKey && match.tier !== 'no_match' && match.score > 0,
    ),
  );

  const totalScore = coveredGoals.reduce((sum, goalKey) => {
    const match = input.matches.find((entry) => entry.goalKey === goalKey);
    return sum + (match?.score ?? 0);
  }, 0);

  const capCount = new Set([
    ...eligibleDecision.caps,
    ...input.matches.flatMap((match) => match.caps ?? []),
  ]).size;

  const topGoalIndex =
    coveredGoals.length > 0
      ? input.prioritizedGoals.findIndex((goalKey) => coveredGoals.includes(goalKey))
      : Number.MAX_SAFE_INTEGER;

  return {
    productId: input.productId,
    matches: input.matches,
    eligibility: eligibleDecision,
    coveredGoals,
    matchedGoalSet: new Set(coveredGoals),
    totalScore,
    capCount,
    topGoalIndex,
    firstStackEligible: input.firstStackEligible,
    reasons: [...(input.reasons ?? [])],
    ...(hasDisplayFields(input.display) ? { display: { ...input.display } } : {}),
  };
};

const sortCandidates = (left: StackCandidate, right: StackCandidate) => {
  if (left.firstStackEligible !== right.firstStackEligible) {
    return left.firstStackEligible ? -1 : 1;
  }

  if (left.eligibility.rankEligible !== right.eligibility.rankEligible) {
    return left.eligibility.rankEligible ? -1 : 1;
  }

  if (left.coveredGoals.length !== right.coveredGoals.length) {
    return right.coveredGoals.length - left.coveredGoals.length;
  }

  if (left.topGoalIndex !== right.topGoalIndex) {
    return left.topGoalIndex - right.topGoalIndex;
  }

  if (left.totalScore !== right.totalScore) {
    return right.totalScore - left.totalScore;
  }

  return left.capCount - right.capCount;
};

const buildCandidatesFromEvaluations = (
  prioritizedGoals: GoalKey[],
  savedProductEvaluations: Record<string, SavedProductEvaluation>,
): StackCandidate[] =>
  Object.values(savedProductEvaluations)
    .filter((evaluation) => evaluation.coverage.status === 'coverage_ready')
    .map((evaluation) =>
      buildCandidate({
        prioritizedGoals,
        productId: evaluation.productId,
        matches: evaluation.productGoalMatches,
        eligibility: evaluation.eligibility,
        firstStackEligible: evaluation.firstStackEligible,
        reasons: evaluation.reasons,
        display: evaluation.display,
      }),
    )
    .sort(sortCandidates);

const buildLegacyCandidates = (
  prioritizedGoals: GoalKey[],
  productGoalMatches: Record<string, ProductGoalMatch[]>,
  eligibility: Record<string, EligibilityDecision>,
): StackCandidate[] =>
  Object.entries(productGoalMatches)
    .map(([productId, matches]) =>
      buildCandidate({
        prioritizedGoals,
        productId,
        matches,
        eligibility: eligibility[productId],
        firstStackEligible:
          toEligibilityDecision(eligibility[productId]).rankEligible &&
          matches.some((match) => match.tier !== 'no_match' && match.score > 0),
      }),
    )
    .sort(sortCandidates);

const buildCandidates = (input: StackComposerInput): StackCandidate[] =>
  input.savedProductEvaluations
    ? buildCandidatesFromEvaluations(input.prioritizedGoals, input.savedProductEvaluations)
    : buildLegacyCandidates(input.prioritizedGoals, input.productGoalMatches, input.eligibility ?? {});

const getBestMatchForGoals = (
  candidate: StackCandidate,
  goalKeys: GoalKey[],
): ProductGoalMatch | undefined =>
  candidate.matches
    .filter((match) => goalKeys.includes(match.goalKey) && match.tier !== 'no_match')
    .sort((left, right) => {
      const tierDelta = tierWeight[right.tier] - tierWeight[left.tier];
      if (tierDelta !== 0) return tierDelta;
      return right.score - left.score;
    })[0];

const compareCandidatesForGoals = (
  left: StackCandidate,
  right: StackCandidate,
  goalKeys: GoalKey[],
) => {
  const leftBest = getBestMatchForGoals(left, goalKeys);
  const rightBest = getBestMatchForGoals(right, goalKeys);
  const leftTier = leftBest ? tierWeight[leftBest.tier] : -1;
  const rightTier = rightBest ? tierWeight[rightBest.tier] : -1;

  if (leftTier !== rightTier) {
    return rightTier - leftTier;
  }

  if ((leftBest?.score ?? -1) !== (rightBest?.score ?? -1)) {
    return (rightBest?.score ?? -1) - (leftBest?.score ?? -1);
  }

  if (left.capCount !== right.capCount) {
    return left.capCount - right.capCount;
  }

  if (left.coveredGoals.length !== right.coveredGoals.length) {
    return right.coveredGoals.length - left.coveredGoals.length;
  }

  if (left.totalScore !== right.totalScore) {
    return right.totalScore - left.totalScore;
  }

  return left.productId.localeCompare(right.productId);
};

const findBestCandidateForGoals = (
  candidates: StackCandidate[],
  goalKeys: GoalKey[],
  selectedIds: Set<string>,
) =>
  candidates
    .filter(
      (candidate) =>
        !selectedIds.has(candidate.productId) &&
        candidate.firstStackEligible &&
        goalKeys.some((goalKey) => candidate.matchedGoalSet.has(goalKey)),
    )
    .sort((left, right) => compareCandidatesForGoals(left, right, goalKeys))[0];

const buildItem = (
  candidate: StackCandidate,
  role: FirstStackPlanItem['role'],
  focusGoals: GoalKey[],
): FirstStackPlanItem => {
  const bestMatch = getBestMatchForGoals(candidate, focusGoals) ?? candidate.matches[0];

  const selectionReason =
    role === 'foundation'
      ? buildReason(REASON_CODES.firstStackFoundationSelected, RULE_IDS.firstStackFoundationSelected, 'derived', {
          productId: candidate.productId,
          supportedGoals: candidate.coveredGoals.join(','),
        })
      : role === 'goal_support'
        ? buildReason(REASON_CODES.firstStackGoalSupportSelected, RULE_IDS.firstStackGoalSupportSelected, 'derived', {
            productId: candidate.productId,
            supportedGoals: candidate.coveredGoals.join(','),
          })
        : buildReason(REASON_CODES.firstStackOptionalSelected, RULE_IDS.firstStackOptionalSelected, 'derived', {
            productId: candidate.productId,
            supportedGoals: candidate.coveredGoals.join(','),
          });

  return {
    productId: candidate.productId,
    role,
    reasons: dedupeReasons(
      [selectionReason],
      candidate.reasons,
      bestMatch?.reasons ?? [],
      candidate.eligibility.reasons,
    ),
    ...(hasDisplayFields(candidate.display) ? { display: { ...candidate.display } } : {}),
  };
};

export const composeFirstStackPlan = (input: StackComposerInput): FirstStackPlan => {
  const candidates = buildCandidates(input);
  const selected: FirstStackPlanItem[] = [];
  const explanationFacts: DecisionReason[] = [];
  const selectedIds = new Set<string>();
  const coveredGoals = new Set<GoalKey>();

  const maxItems = getMaxItems(input.experienceMode, input.duplicateRiskLevel);
  const scheduleTemplateKey = getScheduleTemplateKey(
    input.blockerStrategy,
    input.activityPlan,
    input.experienceMode,
  );

  if (input.duplicateRiskLevel && input.duplicateRiskLevel !== 'none') {
    explanationFacts.push(
      buildReason(REASON_CODES.duplicateOverlapHigh, RULE_IDS.duplicateOverlapHigh, 'observed', {
        duplicateRiskLevel: input.duplicateRiskLevel,
        maxItems,
      }),
    );
  }

  const eligibleCandidates = candidates.filter((candidate) => candidate.firstStackEligible);
  const ineligibleCount = candidates.length - eligibleCandidates.length;

  if (ineligibleCount > 0) {
    explanationFacts.push(
      buildReason(REASON_CODES.firstStackFilteredIneligible, RULE_IDS.firstStackFilteredIneligible, 'derived', {
        count: ineligibleCount,
      }),
    );
  }

  const primaryGoal = input.prioritizedGoals[0];
  const foundationCandidate =
    (primaryGoal
      ? findBestCandidateForGoals(eligibleCandidates, [primaryGoal], selectedIds)
      : undefined) ?? eligibleCandidates[0];

  if (foundationCandidate) {
    selected.push(buildItem(foundationCandidate, 'foundation', [primaryGoal].filter(Boolean) as GoalKey[]));
    selectedIds.add(foundationCandidate.productId);
    foundationCandidate.coveredGoals.forEach((goalKey) => coveredGoals.add(goalKey));
  }

  for (const goalKey of input.prioritizedGoals) {
    if (selected.length >= maxItems) break;
    if (coveredGoals.has(goalKey)) continue;

    const supportCandidate = findBestCandidateForGoals(eligibleCandidates, [goalKey], selectedIds);

    if (!supportCandidate) continue;

    selected.push(buildItem(supportCandidate, 'goal_support', [goalKey]));
    selectedIds.add(supportCandidate.productId);
    supportCandidate.coveredGoals.forEach((coveredGoal) => coveredGoals.add(coveredGoal));
  }

  for (const candidate of eligibleCandidates) {
    if (selected.length >= maxItems) break;
    if (selectedIds.has(candidate.productId)) continue;
    if (candidate.coveredGoals.length === 0) continue;

    selected.push(buildItem(candidate, 'optional', candidate.coveredGoals));
    selectedIds.add(candidate.productId);
    candidate.coveredGoals.forEach((goalKey) => coveredGoals.add(goalKey));
  }

  const uncoveredGoals = input.prioritizedGoals.filter((goalKey) => !coveredGoals.has(goalKey));
  if (uncoveredGoals.length > 0) {
    explanationFacts.push(
      buildReason(REASON_CODES.firstStackGoalGapRemaining, RULE_IDS.firstStackGoalGapRemaining, 'derived', {
        uncoveredGoals: uncoveredGoals.join(','),
      }),
    );
  }

  explanationFacts.push(
    buildReason(
      REASON_CODES.firstStackScheduleTemplateSelected,
      RULE_IDS.firstStackScheduleTemplateSelected,
      'derived',
      {
        scheduleTemplateKey,
        selectedCount: selected.length,
      },
    ),
  );

  return {
    items: selected,
    scheduleTemplateKey,
    explanationFacts: dedupeReasons(
      explanationFacts,
      selected.flatMap((item) => item.reasons),
    ),
  };
};

export const stackComposerInternals = {
  buildCandidates,
  getScheduleTemplateKey,
  getMaxItems,
};
