import type {
  ActivityPlan,
  BlockerStrategy,
  DietReviewLane,
  ExperienceMode,
  GoalKey,
  HomePersonalizationVM,
  PersonalizationProfile,
  PlanPreviewPersonalizationVM,
  SavedProductEvaluation,
  ScheduleDefaultsPersonalizationVM,
  SmartFilterProductBucket,
  SmartFilterPersonalizationVM,
  SupplementTypeKey,
} from '@/types/personalization';
import { getDefaultGoalKeys } from './goalCatalog';
import { REASON_CODES, RULE_IDS, buildReason } from './reasonCodes';

const uniqueValues = <T>(values: Array<T | null | undefined>): T[] =>
  Array.from(new Set(values.filter((value): value is T => value != null)));

export const getPrioritizedGoals = (
  profile: PersonalizationProfile,
  activityPlan: ActivityPlan,
): GoalKey[] => {
  const declaredGoals = profile.declared.goals
    .slice()
    .sort((left, right) => right.priority - left.priority || left.key.localeCompare(right.key))
    .map((goal) => goal.key);

  if (declaredGoals.length > 0) {
    return declaredGoals;
  }

  if (activityPlan.suggestedGoals.length > 0) {
    return [...activityPlan.suggestedGoals];
  }

  return getDefaultGoalKeys();
};

export const getSelectedTypes = (
  profile: PersonalizationProfile,
  activityPlan: ActivityPlan,
): SupplementTypeKey[] =>
  profile.declared.preferredTypes.length > 0
    ? [...profile.declared.preferredTypes]
    : [...activityPlan.suggestedTypes];

export const buildHomeSurface = (input: {
  profile: PersonalizationProfile;
  blockerStrategy: BlockerStrategy;
  prioritizedGoals: GoalKey[];
  dietLanes: DietReviewLane[];
  activityPlan: ActivityPlan;
  experienceMode: ExperienceMode;
}): HomePersonalizationVM => {
  const emphasizedModules = uniqueValues([
    input.blockerStrategy.emphasizeHomeCheckIn ? 'home_check_in' : null,
    input.blockerStrategy.emphasizeScheduleSetup ? 'schedule_setup' : null,
    input.blockerStrategy.emphasizeExplanation ? 'education' : null,
    input.experienceMode.showAdvancedSafety ? 'safety' : null,
    input.dietLanes.length > 0 ? 'diet_review' : null,
    input.blockerStrategy.emphasizeExplanation || input.activityPlan.suggestedTimingAnchors.length > 0
      ? 'plan_preview'
      : null,
  ]);

  const reasons = [
    buildReason(REASON_CODES.homeSurfaceSelected, RULE_IDS.homeSurfaceSelected, 'derived', {
      emphasizedModuleCount: emphasizedModules.length,
      prioritizedGoalCount: input.prioritizedGoals.length,
    }),
  ];

  if (input.blockerStrategy.emphasizeHomeCheckIn) {
    reasons.push(
      buildReason(REASON_CODES.homeEmphasizesCheckIn, RULE_IDS.homeSurfaceSelected, 'derived', {
        currentStreak: input.profile.observed.currentStreak ?? 0,
      }),
    );
  }

  if (input.experienceMode.showAdvancedSafety) {
    reasons.push(
      buildReason(REASON_CODES.homeEmphasizesInsights, RULE_IDS.homeSurfaceSelected, 'derived', {
        uiDensity: input.experienceMode.uiDensity,
      }),
    );
  }

  return {
    emphasizedModules,
    prioritizedGoals: input.prioritizedGoals,
    tipLaneKeys: uniqueValues([
      ...input.dietLanes.map((lane) => lane.laneKey),
      ...input.profile.derived.activityPlanKeys,
    ]),
    reasons,
  };
};

export const buildSmartFilterSurface = (input: {
  prioritizedGoals: GoalKey[];
  selectedTypes: SupplementTypeKey[];
  savedProductEvaluations?: Record<string, SavedProductEvaluation>;
}): SmartFilterPersonalizationVM => {
  const productMembershipById = Object.fromEntries(
    Object.entries(input.savedProductEvaluations ?? {}).map(([productId, evaluation]) => [
      productId,
      evaluation.smartFilterMembership,
    ]),
  );

  const emptyBuckets: Record<SmartFilterProductBucket, string[]> = {
    strong_match: [],
    related: [],
    weak_match: [],
    no_match: [],
    not_enough_structured_data: [],
  };

  const productBuckets = Object.values(productMembershipById).reduce<Record<SmartFilterProductBucket, string[]>>(
    (acc, membership) => {
      acc[membership.bucket].push(membership.productId);
      return acc;
    },
    emptyBuckets,
  );

  const reasons = [
    buildReason(REASON_CODES.smartFilterSurfaceSelected, RULE_IDS.smartFilterSurfaceSelected, 'derived', {
      preselectedTypeCount: input.selectedTypes.length,
      visibleGoalCount: input.prioritizedGoals.length,
    }),
  ];

  if (Object.keys(productMembershipById).length > 0) {
    reasons.push(
      buildReason(
        REASON_CODES.smartFilterProductMembershipBucketed,
        RULE_IDS.smartFilterProductMembershipBucketed,
        'derived',
        {
          membershipCount: Object.keys(productMembershipById).length,
          notEnoughStructuredDataCount: productBuckets.not_enough_structured_data.length,
        },
      ),
    );
  }

  if (productBuckets.not_enough_structured_data.length > 0) {
    reasons.push(
      buildReason(
        REASON_CODES.smartFilterFallbackBucketed,
        RULE_IDS.smartFilterFallbackBucketed,
        'derived',
        {
          notEnoughStructuredDataCount: productBuckets.not_enough_structured_data.length,
        },
      ),
    );
  }

  return {
    visibleGoals: input.prioritizedGoals,
    preselectedTypes: input.selectedTypes,
    ...(input.prioritizedGoals[0] ? { highlightedGoal: input.prioritizedGoals[0] } : {}),
    productMembershipById,
    productBuckets,
    fallback: {
      notEnoughStructuredDataProductIds: [...productBuckets.not_enough_structured_data],
    },
    reasons,
  };
};

export const buildPlanPreviewSurface = (input: {
  prioritizedGoals: GoalKey[];
  selectedTypes: SupplementTypeKey[];
  blockerStrategy: BlockerStrategy;
  dietLanes: DietReviewLane[];
  activityPlan: ActivityPlan;
}): PlanPreviewPersonalizationVM => ({
  goals: input.prioritizedGoals,
  types: input.selectedTypes,
  blockerStrategy: input.blockerStrategy,
  dietLanes: input.dietLanes.map((lane) => lane.laneKey),
  activityAnchors: input.activityPlan.suggestedTimingAnchors,
  reasons: [
    buildReason(REASON_CODES.planPreviewSurfaceSelected, RULE_IDS.planPreviewSurfaceSelected, 'derived', {
      activityAnchorCount: input.activityPlan.suggestedTimingAnchors.length,
      dietLaneCount: input.dietLanes.length,
    }),
  ],
});

export const buildScheduleDefaultsSurface = (input: {
  blockerStrategy: BlockerStrategy;
  blockerAnchors: string[];
  activityPlan: ActivityPlan;
}): ScheduleDefaultsPersonalizationVM => {
  const suggestedTimingAnchors =
    input.activityPlan.suggestedTimingAnchors.length > 0
      ? [...input.activityPlan.suggestedTimingAnchors]
      : input.blockerAnchors[0]
        ? [input.blockerAnchors[0]]
        : [];

  const reasons = [
    buildReason(
      REASON_CODES.scheduleDefaultsSurfaceSelected,
      RULE_IDS.scheduleDefaultsSurfaceSelected,
      'derived',
      {
        preferScheduleSetup: input.blockerStrategy.emphasizeScheduleSetup,
        reminderPriority: input.blockerStrategy.reminderPriority,
      },
    ),
  ];

  if (suggestedTimingAnchors.length > 0) {
    reasons.push(
      buildReason(
        input.activityPlan.suggestedTimingAnchors.length > 0
          ? REASON_CODES.scheduleDefaultsFromActivity
          : REASON_CODES.scheduleDefaultsFromBlocker,
        input.activityPlan.suggestedTimingAnchors.length > 0
          ? RULE_IDS.scheduleDefaultsFromActivity
          : RULE_IDS.scheduleDefaultsFromBlocker,
        'derived',
        {
          anchor: suggestedTimingAnchors[0],
        },
      ),
    );
  }

  if (input.blockerStrategy.emphasizeScheduleSetup) {
    reasons.push(
      buildReason(REASON_CODES.scheduleSetupRecommended, RULE_IDS.scheduleSetupRecommended, 'derived', {
        reminderPriority: input.blockerStrategy.reminderPriority,
      }),
    );
  }

  return {
    reminderPriority: input.blockerStrategy.reminderPriority,
    suggestedTimingAnchors,
    preferScheduleSetup: input.blockerStrategy.emphasizeScheduleSetup,
    reasons,
  };
};

export const surfaceRankersInternals = {
  uniqueValues,
};
