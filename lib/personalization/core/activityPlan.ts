import activityGoalMapData from '@/data/personalization/activity_goal_map.v1.json';
import type {
  ActivityPlan,
  DecisionReason,
  GoalKey,
  PersonalizationProfile,
  SupplementTypeKey,
} from '@/types/personalization';
import { REASON_CODES, RULE_IDS, buildReason } from './reasonCodes';

type ActivityGoalMapFile = {
  version: string;
  activityMappings: Array<{
    activityKey: string;
    planKey: string;
    suggestedGoals: GoalKey[];
    suggestedTypes: SupplementTypeKey[];
    suggestedTimingAnchors: string[];
  }>;
};

const ACTIVITY_GOAL_MAP = activityGoalMapData as ActivityGoalMapFile;

const uniqueValues = <T>(values: Array<T | null | undefined>): T[] =>
  Array.from(new Set(values.filter((value): value is T => value != null)));

export const compileActivityPlan = (profile: PersonalizationProfile): ActivityPlan => {
  const plans = ACTIVITY_GOAL_MAP.activityMappings.filter((mapping) =>
    profile.derived.activityPlanKeys.includes(mapping.planKey),
  );

  if (plans.length === 0) {
    return {
      suggestedGoals: [],
      suggestedTypes: [],
      suggestedTimingAnchors: [],
      reasons: [],
    };
  }

  return {
    suggestedGoals: uniqueValues(plans.flatMap((plan) => plan.suggestedGoals)),
    suggestedTypes: uniqueValues(plans.flatMap((plan) => plan.suggestedTypes)),
    suggestedTimingAnchors: uniqueValues(plans.flatMap((plan) => plan.suggestedTimingAnchors)),
    reasons: [
      buildReason(
        REASON_CODES.activityPlanStrategySelected,
        RULE_IDS.activityPlanStrategySelected,
        'derived',
        {
          activityPlanCount: plans.length,
          anchorCount: uniqueValues(plans.flatMap((plan) => plan.suggestedTimingAnchors)).length,
        },
      ),
    ],
  };
};

export const activityPlanInternals = {
  uniqueValues,
};
