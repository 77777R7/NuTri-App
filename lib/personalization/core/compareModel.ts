import type {
  GoalCompareEntry,
  GoalKey,
  SavedProductEvaluation,
} from "@/types/personalization";

import { buildGoalFitCard } from "./goalFitCardBuilder";

const TIER_PRIORITY = {
  strong_match: 4,
  related: 3,
  weak_match: 2,
  no_match: 1,
  not_enough_structured_data: 0,
} as const;

const getGoalScore = (evaluation: SavedProductEvaluation, goalKey?: GoalKey) => {
  const match =
    goalKey != null
      ? evaluation.productGoalMatches.find((entry) => entry.goalKey === goalKey)
      : evaluation.productGoalMatches.find(
          (entry) => entry.goalKey === evaluation.smartFilterMembership.highlightedGoal,
        ) ?? evaluation.productGoalMatches[0];

  return {
    score: match?.score ?? 0,
    tier:
      evaluation.coverage.status === "coverage_ready"
        ? match?.tier ?? evaluation.smartFilterMembership.bucket
        : "not_enough_structured_data",
  };
};

export const buildGoalCompareEntries = (input: {
  evaluations: SavedProductEvaluation[];
  currentProductId: string;
  goalKey?: GoalKey;
  limit?: number;
}): GoalCompareEntry[] => {
  const current = input.evaluations.find((evaluation) => evaluation.productId === input.currentProductId);
  if (!current) return [];

  const peers = input.evaluations
    .filter((evaluation) => evaluation.productId !== input.currentProductId)
    .sort((left, right) => {
      const leftRank = getGoalScore(left, input.goalKey);
      const rightRank = getGoalScore(right, input.goalKey);
      const tierDelta = TIER_PRIORITY[rightRank.tier] - TIER_PRIORITY[leftRank.tier];
      if (tierDelta !== 0) return tierDelta;
      return rightRank.score - leftRank.score;
    });

  const selected = [current, ...peers].slice(0, Math.max(1, input.limit ?? 3));

  return selected.reduce<GoalCompareEntry[]>((acc, evaluation) => {
      const goalFitCard = buildGoalFitCard({
        evaluation,
        goalKey: input.goalKey,
      });
      if (!goalFitCard) return acc;

      acc.push({
        productId: evaluation.productId,
        ...(goalFitCard.goalKey ? { goalKey: goalFitCard.goalKey } : {}),
        title: evaluation.display?.title,
        brandName: evaluation.display?.brandName,
        dosageText: evaluation.display?.dosageText,
        tier: goalFitCard.tier,
        confidence: goalFitCard.confidence,
        whyFit: goalFitCard.whyFit,
        whyNotStronger: goalFitCard.whyNotStronger,
        holdbacks: goalFitCard.holdbacks,
      });

      return acc;
    }, []);
};
