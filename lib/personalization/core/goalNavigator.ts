import type {
  DecisionReason,
  GoalKey,
  GoalNavigatorCandidate,
  GoalNavigatorResponse,
  PreferenceVector,
  SupplementTypeKey,
} from "@/types/personalization";

type BuildGoalNavigatorResponseInput = {
  goalKey: GoalKey;
  rulesVersion: string;
  preferredTypes?: SupplementTypeKey[];
  preferenceVector?: PreferenceVector;
  snapshotId?: string;
  candidates: GoalNavigatorCandidate[];
  notEnoughStructuredDataCount: number;
  limit?: number;
};

const TIER_PRIORITY: Record<GoalNavigatorCandidate["tier"], number> = {
  strong_match: 4,
  related: 3,
  weak_match: 2,
  no_match: 1,
  not_enough_structured_data: 0,
};

const EVIDENCE_PRIORITY: Record<GoalNavigatorCandidate["goalFitCard"]["confidence"]["evidence"], number> = {
  high: 3,
  medium: 2,
  low: 1,
};

const LABEL_PRIORITY: Record<GoalNavigatorCandidate["goalFitCard"]["confidence"]["labelCompleteness"], number> = {
  full: 3,
  partial: 2,
  weak: 1,
};

const ROUTINE_PRIORITY: Record<GoalNavigatorCandidate["goalFitCard"]["confidence"]["routineFit"], number> = {
  easy: 3,
  moderate: 2,
  complex: 1,
};

const OVERLAP_PRIORITY: Record<GoalNavigatorCandidate["goalFitCard"]["confidence"]["overlapRisk"], number> = {
  none: 3,
  watch: 2,
  high: 1,
};

const buildReason = (
  code: string,
  params?: DecisionReason["params"],
): DecisionReason => ({
  code,
  ruleId: "personalization.goal_navigator.v1",
  source: "derived",
  ...(params ? { params } : {}),
});

const isRankEligible = (candidate: GoalNavigatorCandidate) =>
  candidate.evaluation.coverage.status === "coverage_ready" &&
  (candidate.evaluation.eligibility?.rankEligible ?? true) &&
  candidate.tier !== "no_match";

const compareByDefaultRanking = (left: GoalNavigatorCandidate, right: GoalNavigatorCandidate) => {
  const tierDelta = TIER_PRIORITY[right.tier] - TIER_PRIORITY[left.tier];
  if (tierDelta !== 0) return tierDelta;

  if (left.preferredTypeMatch !== right.preferredTypeMatch) {
    return Number(right.preferredTypeMatch) - Number(left.preferredTypeMatch);
  }

  const scoreDelta = right.score - left.score;
  if (scoreDelta !== 0) return scoreDelta;

  const evidenceDelta =
    EVIDENCE_PRIORITY[right.goalFitCard.confidence.evidence] -
    EVIDENCE_PRIORITY[left.goalFitCard.confidence.evidence];
  if (evidenceDelta !== 0) return evidenceDelta;

  const overlapDelta =
    OVERLAP_PRIORITY[right.goalFitCard.confidence.overlapRisk] -
    OVERLAP_PRIORITY[left.goalFitCard.confidence.overlapRisk];
  if (overlapDelta !== 0) return overlapDelta;

  const routineDelta =
    ROUTINE_PRIORITY[right.goalFitCard.confidence.routineFit] -
    ROUTINE_PRIORITY[left.goalFitCard.confidence.routineFit];
  if (routineDelta !== 0) return routineDelta;

  return (right.evaluation.display?.title ?? "").localeCompare(left.evaluation.display?.title ?? "");
};

const sortCandidates = (
  candidates: GoalNavigatorCandidate[],
  preferenceVector?: PreferenceVector,
) =>
  [...candidates].sort((left, right) => {
    switch (preferenceVector?.decisionMode) {
      case "simpler": {
        const routineDelta =
          ROUTINE_PRIORITY[right.goalFitCard.confidence.routineFit] -
          ROUTINE_PRIORITY[left.goalFitCard.confidence.routineFit];
        if (routineDelta !== 0) return routineDelta;

        const overlapDelta =
          OVERLAP_PRIORITY[right.goalFitCard.confidence.overlapRisk] -
          OVERLAP_PRIORITY[left.goalFitCard.confidence.overlapRisk];
        if (overlapDelta !== 0) return overlapDelta;

        return compareByDefaultRanking(left, right);
      }
      case "better_disclosure": {
        const labelDelta =
          LABEL_PRIORITY[right.goalFitCard.confidence.labelCompleteness] -
          LABEL_PRIORITY[left.goalFitCard.confidence.labelCompleteness];
        if (labelDelta !== 0) return labelDelta;

        const evidenceDelta =
          EVIDENCE_PRIORITY[right.goalFitCard.confidence.evidence] -
          EVIDENCE_PRIORITY[left.goalFitCard.confidence.evidence];
        if (evidenceDelta !== 0) return evidenceDelta;

        return compareByDefaultRanking(left, right);
      }
      case "low_overlap": {
        const overlapDelta =
          OVERLAP_PRIORITY[right.goalFitCard.confidence.overlapRisk] -
          OVERLAP_PRIORITY[left.goalFitCard.confidence.overlapRisk];
        if (overlapDelta !== 0) return overlapDelta;

        return compareByDefaultRanking(left, right);
      }
      case "strong_only": {
        const tierDelta = TIER_PRIORITY[right.tier] - TIER_PRIORITY[left.tier];
        if (tierDelta !== 0) return tierDelta;

        const evidenceDelta =
          EVIDENCE_PRIORITY[right.goalFitCard.confidence.evidence] -
          EVIDENCE_PRIORITY[left.goalFitCard.confidence.evidence];
        if (evidenceDelta !== 0) return evidenceDelta;

        return compareByDefaultRanking(left, right);
      }
      case "best_fit":
      default:
        return compareByDefaultRanking(left, right);
    }
  });

export const buildGoalNavigatorResponse = (
  input: BuildGoalNavigatorResponseInput,
): GoalNavigatorResponse => {
  const sortedCandidates = sortCandidates(
    input.candidates.filter(isRankEligible),
    input.preferenceVector,
  );
  const strongOnlyCandidates =
    input.preferenceVector?.decisionMode === "strong_only"
      ? sortedCandidates.filter((candidate) => candidate.tier === "strong_match")
      : sortedCandidates;
  const rankableCandidates = (
    strongOnlyCandidates.length > 0 ? strongOnlyCandidates : sortedCandidates
  ).slice(0, Math.max(1, input.limit ?? 6));

  return {
    goalKey: input.goalKey,
    ...(input.snapshotId ? { snapshotId: input.snapshotId } : {}),
    rulesVersion: input.rulesVersion,
    preferredTypes: [...(input.preferredTypes ?? [])],
    ...(input.preferenceVector ? { preferenceVector: input.preferenceVector } : {}),
    candidates: rankableCandidates,
    fallback: {
      notEnoughStructuredDataCount: input.notEnoughStructuredDataCount,
    },
    reasons: [
      buildReason("goal_navigator_candidates_ranked", {
        goalKey: input.goalKey,
        candidateCount: rankableCandidates.length,
        notEnoughStructuredDataCount: input.notEnoughStructuredDataCount,
      }),
      ...(input.preferredTypes?.length
        ? [
            buildReason("goal_navigator_preferred_types_applied", {
              preferredTypes: input.preferredTypes.join(","),
            }),
          ]
        : []),
      ...(input.preferenceVector
        ? [
            buildReason("goal_navigator_preference_vector_applied", {
              decisionMode: input.preferenceVector.decisionMode,
              explanationStyle: input.preferenceVector.explanationStyle,
              notificationTolerance: input.preferenceVector.notificationTolerance,
            }),
          ]
        : []),
    ],
  };
};

export const goalNavigatorInternals = {
  buildReason,
  compareByDefaultRanking,
  isRankEligible,
  sortCandidates,
};
