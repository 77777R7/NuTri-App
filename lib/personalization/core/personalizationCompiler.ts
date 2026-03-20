import type {
  ActivityPlan,
  FeedbackState,
  GoalKey,
  PersonalizationProfile,
  PersonalizationSnapshot,
  ProductGoalMatch,
  SavedProductEvaluation,
  SavedProductEvaluationInput,
} from '@/types/personalization';

import {
  buildProfileTrace,
  resolvePersonalizationProfile,
  type ProfileResolverInput,
} from './profileResolver';
import { compileBlockerStrategy } from './blockerStrategy';
import { compileExperienceMode } from './experienceStrategy';
import { compileDietLanes } from './dietReviewLanes';
import { compileActivityPlan } from './activityPlan';
import {
  buildHomeSurface,
  buildPlanPreviewSurface,
  buildScheduleDefaultsSurface,
  buildSmartFilterSurface,
  getPrioritizedGoals,
  getSelectedTypes,
} from './surfaceRankers';
import { composeFirstStackPlan } from './stackComposer';
import { evaluateSavedProducts, projectSavedProductEvaluations } from './savedProductEvaluation';
import { applyFeedbackStateToSnapshot } from '@/lib/personalization/feedback/overrideRegistry';
import { reduceFeedbackState } from '@/lib/personalization/feedback/feedbackStore';
import {
  dedupeReasons,
  DEFAULT_PERSONALIZATION_COMPUTED_AT,
  PERSONALIZATION_RULES_VERSION,
} from './reasonCodes';
import { buildGoalFitCard } from './goalFitCardBuilder';
import { compileSupportState } from './supportStateMachine';
import { compilePreferenceVector } from './critiqueEngine';
import { buildStackAudit } from './stackAudit';

type SnapshotEvaluationsInput = {
  productGoalMatches?: Record<string, ProductGoalMatch[]>;
  eligibility?: PersonalizationSnapshot['evaluations']['eligibility'];
  savedProductEvaluations?: Record<string, SavedProductEvaluation>;
  savedProducts?: Record<string, SavedProductEvaluationInput>;
  firstStackPlan?: PersonalizationSnapshot['evaluations']['firstStackPlan'];
};

export type PersonalizationCompilerInput = {
  profile?: PersonalizationProfile;
  profileInput?: ProfileResolverInput;
  computedAt?: string;
  rulesVersion?: string;
  snapshotId?: string;
  evaluations?: SnapshotEvaluationsInput;
  feedbackState?: FeedbackState;
  overrideEvents?: FeedbackState['events'];
};

const hashString = (value: string) => {
  let hash = 5381;

  for (let index = 0; index < value.length; index += 1) {
    hash = (hash * 33) ^ value.charCodeAt(index);
  }

  return (hash >>> 0).toString(36);
};

const resolveCompilerProfile = (input: PersonalizationCompilerInput): PersonalizationProfile => {
  if (input.profile) {
    return input.profile;
  }

  return resolvePersonalizationProfile({
    ...input.profileInput,
    computedAt: input.computedAt ?? input.profileInput?.computedAt,
  });
};

const buildSnapshotId = (
  profile: PersonalizationProfile,
  computedAt: string,
  rulesVersion: string,
) =>
  `psn_${hashString(
    JSON.stringify({
      computedAt,
      profile,
      rulesVersion,
    }),
  )}`;

const buildDefaultEvaluations = (input: {
  profile: PersonalizationProfile;
  prioritizedGoals: GoalKey[];
  activityPlan: ActivityPlan;
  blockerStrategy: PersonalizationSnapshot['strategies']['blocker'];
  experienceMode: PersonalizationSnapshot['strategies']['experience'];
  evaluations?: SnapshotEvaluationsInput;
}): PersonalizationSnapshot['evaluations'] => {
  const savedProductEvaluationSet = input.evaluations?.savedProductEvaluations
    ? projectSavedProductEvaluations(input.evaluations.savedProductEvaluations)
    : input.evaluations?.savedProducts
      ? evaluateSavedProducts({
          prioritizedGoals: input.prioritizedGoals,
          savedProducts: input.evaluations.savedProducts,
        })
      : undefined;

  const productGoalMatches =
    savedProductEvaluationSet?.productGoalMatches ?? input.evaluations?.productGoalMatches ?? {};
  const eligibility =
    savedProductEvaluationSet?.eligibility ?? input.evaluations?.eligibility ?? {};

  const defaultFirstStackPlan = composeFirstStackPlan({
    prioritizedGoals: input.prioritizedGoals,
    blockerStrategy: input.blockerStrategy,
    experienceMode: input.experienceMode,
    activityPlan: input.activityPlan,
    savedProductEvaluations: savedProductEvaluationSet?.savedProductEvaluations,
    productGoalMatches,
    eligibility,
    duplicateRiskLevel: input.profile.observed.duplicateRisk.level,
  });

  const goalFitCards = savedProductEvaluationSet?.savedProductEvaluations
    ? Object.fromEntries(
        Object.values(savedProductEvaluationSet.savedProductEvaluations).flatMap((evaluation) => {
          const card = buildGoalFitCard({
            evaluation,
            goalKey: evaluation.smartFilterMembership.highlightedGoal,
          });
          return card ? [[evaluation.productId, card] as const] : [];
        }),
      )
    : undefined;

  return {
    productGoalMatches,
    eligibility,
    ...(savedProductEvaluationSet
      ? {
          coverage: savedProductEvaluationSet.coverage,
          savedProductEvaluations: savedProductEvaluationSet.savedProductEvaluations,
        }
      : {}),
    ...(goalFitCards ? { goalFitCards } : {}),
    firstStackPlan: input.evaluations?.firstStackPlan ?? defaultFirstStackPlan,
  };
};

const collectEvaluationReasons = (evaluations: PersonalizationSnapshot['evaluations']) =>
  dedupeReasons(
    Object.values(evaluations.productGoalMatches).flatMap((matches) =>
      matches.flatMap((match) => match.reasons),
    ),
    Object.values(evaluations.eligibility ?? {}).flatMap((decision) => decision.reasons),
    Object.values(evaluations.coverage ?? {}).flatMap((decision) => decision.reasons),
    Object.values(evaluations.savedProductEvaluations ?? {}).flatMap((evaluation) => evaluation.reasons),
    Object.values(evaluations.goalFitCards ?? {}).flatMap((card) => [
      ...card.whyFit,
      ...card.whyNotStronger,
      ...card.holdbacks,
      ...(card.stackContext ?? []),
    ]),
    evaluations.firstStackPlan?.items.flatMap((item) => item.reasons) ?? [],
    evaluations.firstStackPlan?.explanationFacts ?? [],
  );

const buildPreferenceReason = (
  code: string,
  params?: Record<string, string | number | boolean>,
) => ({
  code,
  ruleId: 'personalization.preference_vector.v1',
  source: 'derived' as const,
  ...(params ? { params } : {}),
});

const applyPreferenceVectorToSurfaces = (input: {
  preferenceVector: PersonalizationSnapshot['strategies']['preferenceVector'];
  home: PersonalizationSnapshot['surfaces']['home'];
  smartFilter: PersonalizationSnapshot['surfaces']['smartFilter'];
  planPreview: PersonalizationSnapshot['surfaces']['planPreview'];
  scheduleDefaults: PersonalizationSnapshot['surfaces']['scheduleDefaults'];
}) => {
  if (input.preferenceVector.explanationStyle !== 'brief') {
    input.home.emphasizedModules = Array.from(
      new Set([...input.home.emphasizedModules, 'education']),
    );
    input.planPreview.reasons = dedupeReasons(
      input.planPreview.reasons,
      [
        buildPreferenceReason('preference_vector_explanation_applied', {
          explanationStyle: input.preferenceVector.explanationStyle,
        }),
      ],
    );
  }

  input.smartFilter.reasons = dedupeReasons(
    input.smartFilter.reasons,
    [
      buildPreferenceReason('preference_vector_decision_mode_applied', {
        decisionMode: input.preferenceVector.decisionMode,
      }),
    ],
  );

  if (input.preferenceVector.notificationTolerance === 'low') {
    input.scheduleDefaults.reminderPriority = 'low';
  } else if (input.preferenceVector.notificationTolerance === 'high') {
    input.scheduleDefaults.reminderPriority = 'high';
  }

  input.scheduleDefaults.reasons = dedupeReasons(
    input.scheduleDefaults.reasons,
    [
      buildPreferenceReason('preference_vector_notification_applied', {
        notificationTolerance: input.preferenceVector.notificationTolerance,
        reminderPriority: input.scheduleDefaults.reminderPriority,
      }),
    ],
  );
};

export const compilePersonalizationSnapshot = (
  input: PersonalizationCompilerInput = {},
): PersonalizationSnapshot => {
  const profile = resolveCompilerProfile(input);
  const computedAt = input.computedAt ?? profile.meta.computedAt ?? DEFAULT_PERSONALIZATION_COMPUTED_AT;
  const rulesVersion = input.rulesVersion ?? PERSONALIZATION_RULES_VERSION;
  const effectiveFeedbackState =
    input.overrideEvents && input.overrideEvents.length > 0
      ? reduceFeedbackState(
          input.feedbackState ?? {
            version: 'personalization-feedback/v1',
            updatedAt: computedAt,
            events: [],
            overrides: {},
            dismissals: {},
          },
          input.overrideEvents,
        )
      : input.feedbackState;
  const blockerStrategyResult = compileBlockerStrategy(profile);
  const experienceModeResult = compileExperienceMode(profile);
  const dietLanes = compileDietLanes(profile);
  const activityPlan = compileActivityPlan(profile);
  const supportStateResult = compileSupportState({
    profile,
    feedbackState: effectiveFeedbackState,
  });
  const preferenceVectorResult = compilePreferenceVector({
    profile,
    supportState: supportStateResult.supportState,
    feedbackState: effectiveFeedbackState,
  });
  const prioritizedGoals = getPrioritizedGoals(profile, activityPlan);
  const selectedTypes = getSelectedTypes(profile, activityPlan);

  const evaluations = buildDefaultEvaluations({
    profile,
    prioritizedGoals,
    activityPlan,
    blockerStrategy: blockerStrategyResult.strategy,
    experienceMode: experienceModeResult.mode,
    evaluations: input.evaluations,
  });
  const home = buildHomeSurface({
    profile,
    blockerStrategy: blockerStrategyResult.strategy,
    prioritizedGoals,
    dietLanes,
    activityPlan,
    experienceMode: experienceModeResult.mode,
  });
  const smartFilter = buildSmartFilterSurface({
    prioritizedGoals,
    selectedTypes,
    savedProductEvaluations: evaluations.savedProductEvaluations,
  });
  const planPreview = buildPlanPreviewSurface({
    prioritizedGoals,
    selectedTypes,
    blockerStrategy: blockerStrategyResult.strategy,
    dietLanes,
    activityPlan,
  });
  const scheduleDefaults = buildScheduleDefaultsSurface({
    blockerStrategy: blockerStrategyResult.strategy,
    blockerAnchors: blockerStrategyResult.preferredTimingAnchors,
    activityPlan,
  });
  applyPreferenceVectorToSurfaces({
    preferenceVector: preferenceVectorResult.preferenceVector,
    home,
    smartFilter,
    planPreview,
    scheduleDefaults,
  });
  const stackAudit = buildStackAudit({
    profile,
    supportState: supportStateResult.supportState,
    preferenceVector: preferenceVectorResult.preferenceVector,
    evaluations,
  });

  const baseSnapshot: PersonalizationSnapshot = {
    snapshotId: input.snapshotId ?? buildSnapshotId(profile, computedAt, rulesVersion),
    rulesVersion,
    computedAt,
    profile,
    strategies: {
      blocker: blockerStrategyResult.strategy,
      experience: experienceModeResult.mode,
      dietLanes,
      activityPlan,
      supportState: supportStateResult.supportState,
      preferenceVector: preferenceVectorResult.preferenceVector,
    },
    evaluations,
    surfaces: {
      home,
      smartFilter,
      planPreview,
      scheduleDefaults,
    },
    premiumInsights: {
      stackAudit,
    },
    trace: dedupeReasons(
      buildProfileTrace(profile, input.profileInput),
      blockerStrategyResult.reasons,
      experienceModeResult.reasons,
      dietLanes.flatMap((lane) => lane.reasons),
      activityPlan.reasons,
      supportStateResult.reasons,
      preferenceVectorResult.reasons,
      home.reasons,
      smartFilter.reasons,
      planPreview.reasons,
      scheduleDefaults.reasons,
      collectEvaluationReasons(evaluations),
      stackAudit.reasons,
    ),
  };

  return applyFeedbackStateToSnapshot(baseSnapshot, effectiveFeedbackState);
};

export const personalizationCompilerInternals = {
  buildDefaultEvaluations,
  buildSnapshotId,
  compileActivityPlan,
  compileBlockerStrategy,
  compileDietLanes,
  compileExperienceMode,
  getPrioritizedGoals,
  getSelectedTypes,
};
