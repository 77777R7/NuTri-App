import activityGoalMapData from '@/data/personalization/activity_goal_map.v1.json';
import activityAnchorBundlesData from '@/data/personalization/activity_anchor_bundles.v2.json';
import type {
  ActivityPlan,
  DecisionReason,
  GoalKey,
  PersonalizationProfile,
  SupplementTypeKey,
} from '@/types/personalization';
import { flatMapCompat } from '@/lib/utils/arrayCompat';
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
const ACTIVITY_ANCHOR_BUNDLES = activityAnchorBundlesData as {
  version: string;
  bundles: Array<{
    planKey: string;
    reviewBundleKey: string;
    decisionModifier: string;
  }>;
};
const ACTIVITY_BUNDLE_BY_PLAN_KEY = new Map(
  ACTIVITY_ANCHOR_BUNDLES.bundles.map((bundle) => [bundle.planKey, bundle] as const),
);

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
    ...(plans[0] && ACTIVITY_BUNDLE_BY_PLAN_KEY.get(plans[0].planKey)
      ? {
          reviewBundleKey: ACTIVITY_BUNDLE_BY_PLAN_KEY.get(plans[0].planKey)?.reviewBundleKey,
          decisionModifier: ACTIVITY_BUNDLE_BY_PLAN_KEY.get(plans[0].planKey)?.decisionModifier,
        }
      : {}),
    suggestedGoals: uniqueValues(flatMapCompat(plans, (plan) => plan.suggestedGoals)),
    suggestedTypes: uniqueValues(flatMapCompat(plans, (plan) => plan.suggestedTypes)),
    suggestedTimingAnchors: uniqueValues(flatMapCompat(plans, (plan) => plan.suggestedTimingAnchors)),
    reasons: [
      buildReason(
        REASON_CODES.activityPlanStrategySelected,
        RULE_IDS.activityPlanStrategySelected,
        'derived',
        {
          activityPlanCount: plans.length,
          anchorCount: uniqueValues(flatMapCompat(plans, (plan) => plan.suggestedTimingAnchors)).length,
        },
      ),
    ],
  };
};

export const activityPlanInternals = {
  uniqueValues,
};
