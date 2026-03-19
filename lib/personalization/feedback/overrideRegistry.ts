import type { FeedbackState, FirstStackPlan, PersonalizationSnapshot } from '@/types/personalization';
import { buildReason, dedupeReasons, buildReasonCode, buildRuleId } from '@/lib/personalization/core/reasonCodes';

const OVERRIDE_REASON_CODE = buildReasonCode('override', 'applied');
const OVERRIDE_RULE_ID = buildRuleId('override', 'applied');

const cloneSnapshot = (snapshot: PersonalizationSnapshot): PersonalizationSnapshot => ({
  ...snapshot,
  evaluations: {
    ...snapshot.evaluations,
    ...(snapshot.evaluations.eligibility ? { eligibility: { ...snapshot.evaluations.eligibility } } : {}),
    productGoalMatches: { ...snapshot.evaluations.productGoalMatches },
    ...(snapshot.evaluations.firstStackPlan
      ? {
          firstStackPlan: {
            ...snapshot.evaluations.firstStackPlan,
            items: snapshot.evaluations.firstStackPlan.items.map((item) => ({
              ...item,
              reasons: [...item.reasons],
            })),
            explanationFacts: [...snapshot.evaluations.firstStackPlan.explanationFacts],
          },
        }
      : {}),
  },
  surfaces: {
    home: {
      ...snapshot.surfaces.home,
      emphasizedModules: [...snapshot.surfaces.home.emphasizedModules],
      prioritizedGoals: [...snapshot.surfaces.home.prioritizedGoals],
      tipLaneKeys: [...snapshot.surfaces.home.tipLaneKeys],
      reasons: [...snapshot.surfaces.home.reasons],
    },
    smartFilter: {
      ...snapshot.surfaces.smartFilter,
      visibleGoals: [...snapshot.surfaces.smartFilter.visibleGoals],
      preselectedTypes: [...snapshot.surfaces.smartFilter.preselectedTypes],
      reasons: [...snapshot.surfaces.smartFilter.reasons],
    },
    planPreview: {
      ...snapshot.surfaces.planPreview,
      goals: [...snapshot.surfaces.planPreview.goals],
      types: [...snapshot.surfaces.planPreview.types],
      dietLanes: [...snapshot.surfaces.planPreview.dietLanes],
      activityAnchors: [...snapshot.surfaces.planPreview.activityAnchors],
      reasons: [...snapshot.surfaces.planPreview.reasons],
    },
    scheduleDefaults: {
      ...snapshot.surfaces.scheduleDefaults,
      suggestedTimingAnchors: [...snapshot.surfaces.scheduleDefaults.suggestedTimingAnchors],
      reasons: [...snapshot.surfaces.scheduleDefaults.reasons],
    },
  },
  trace: [...snapshot.trace],
});

const buildOverrideReason = (
  surface: string,
  field: string,
  value?: string | number | boolean,
) =>
  buildReason(OVERRIDE_REASON_CODE, OVERRIDE_RULE_ID, 'derived', {
    surface,
    field,
    ...(value !== undefined ? { value } : {}),
  });

const applyScheduleDefaultsOverrides = (
  snapshot: PersonalizationSnapshot,
  feedbackState: FeedbackState,
) => {
  const override = feedbackState.overrides.scheduleDefaults;
  if (!override) return;

  if (override.reminderPriority) {
    snapshot.surfaces.scheduleDefaults.reminderPriority = override.reminderPriority;
    snapshot.surfaces.scheduleDefaults.reasons = dedupeReasons(
      snapshot.surfaces.scheduleDefaults.reasons,
      [buildOverrideReason('schedule_defaults', 'reminderPriority', override.reminderPriority)],
    );
  }

  if (override.suggestedTimingAnchors) {
    snapshot.surfaces.scheduleDefaults.suggestedTimingAnchors = [...override.suggestedTimingAnchors];
    snapshot.surfaces.scheduleDefaults.reasons = dedupeReasons(
      snapshot.surfaces.scheduleDefaults.reasons,
      [buildOverrideReason('schedule_defaults', 'suggestedTimingAnchors')],
    );
  }

  if (typeof override.preferScheduleSetup === 'boolean') {
    snapshot.surfaces.scheduleDefaults.preferScheduleSetup = override.preferScheduleSetup;
    snapshot.surfaces.scheduleDefaults.reasons = dedupeReasons(
      snapshot.surfaces.scheduleDefaults.reasons,
      [buildOverrideReason('schedule_defaults', 'preferScheduleSetup', override.preferScheduleSetup)],
    );
  }
};

const applySmartFilterOverrides = (
  snapshot: PersonalizationSnapshot,
  feedbackState: FeedbackState,
) => {
  const override = feedbackState.overrides.smartFilter;
  if (!override) return;

  if (override.visibleGoals) {
    snapshot.surfaces.smartFilter.visibleGoals = [...override.visibleGoals];
  }
  if (override.preselectedTypes) {
    snapshot.surfaces.smartFilter.preselectedTypes = [...override.preselectedTypes];
  }
  if (override.highlightedGoal) {
    snapshot.surfaces.smartFilter.highlightedGoal = override.highlightedGoal;
  }

  snapshot.surfaces.smartFilter.reasons = dedupeReasons(
    snapshot.surfaces.smartFilter.reasons,
    [buildOverrideReason('smart_filter', 'config')],
  );
};

const applyFirstStackOverrides = (
  snapshot: PersonalizationSnapshot,
  feedbackState: FeedbackState,
) => {
  const override = feedbackState.overrides.firstStack;
  const firstStackPlan = snapshot.evaluations.firstStackPlan;
  if (!override || !firstStackPlan) return;

  let nextItems = [...firstStackPlan.items];

  if (override.dismissedProductIds?.length) {
    const dismissedIds = new Set(override.dismissedProductIds);
    nextItems = nextItems.filter((item) => !dismissedIds.has(item.productId));
  }

  if (override.acceptedProductIds?.length) {
    const acceptedIds = new Set(override.acceptedProductIds);
    nextItems = [
      ...nextItems.filter((item) => acceptedIds.has(item.productId)),
      ...nextItems.filter((item) => !acceptedIds.has(item.productId)),
    ];
  }

  const nextPlan: FirstStackPlan = {
    ...firstStackPlan,
    items: nextItems,
    scheduleTemplateKey: override.scheduleTemplateKey ?? firstStackPlan.scheduleTemplateKey,
    explanationFacts: dedupeReasons(
      firstStackPlan.explanationFacts,
      [buildOverrideReason('first_stack', 'plan')],
    ),
  };

  snapshot.evaluations.firstStackPlan = nextPlan;
};

export const applyFeedbackStateToSnapshot = (
  snapshot: PersonalizationSnapshot,
  feedbackState?: FeedbackState,
): PersonalizationSnapshot => {
  if (!feedbackState) return snapshot;

  const nextSnapshot = cloneSnapshot(snapshot);

  applyScheduleDefaultsOverrides(nextSnapshot, feedbackState);
  applySmartFilterOverrides(nextSnapshot, feedbackState);
  applyFirstStackOverrides(nextSnapshot, feedbackState);

  nextSnapshot.trace = dedupeReasons(
    nextSnapshot.trace,
    nextSnapshot.surfaces.scheduleDefaults.reasons,
    nextSnapshot.surfaces.smartFilter.reasons,
    nextSnapshot.evaluations.firstStackPlan?.explanationFacts ?? [],
  );

  return nextSnapshot;
};
