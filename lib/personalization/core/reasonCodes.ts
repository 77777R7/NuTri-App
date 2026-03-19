import type { DecisionReason, DecisionReasonSource } from '@/types/personalization';

export const PERSONALIZATION_PROFILE_VERSION = 'personalization-profile/v1-phase1';
export const PERSONALIZATION_RULES_VERSION = 'personalization-rules/v1-phase7';
export const DEFAULT_PERSONALIZATION_COMPUTED_AT = '1970-01-01T00:00:00.000Z';

const PROFILE_RULE_IDS = {
  declaredGoalSelected: 'personalization.profile.declared_goals',
  declaredTypeSelected: 'personalization.profile.declared_types',
  declaredBlockerSelected: 'personalization.profile.declared_blocker',
  declaredExperienceSelected: 'personalization.profile.declared_experience',
  declaredDietSelected: 'personalization.profile.declared_diets',
  declaredActivitySelected: 'personalization.profile.declared_activity',
  observedStreakRecorded: 'personalization.profile.observed_streak',
  observedConsistencyDerived: 'personalization.profile.observed_consistency',
  observedMissedPatternRecorded: 'personalization.profile.observed_missed_pattern',
  observedSavedStackRecorded: 'personalization.profile.observed_saved_stack',
  observedDuplicateRiskDetected: 'personalization.profile.observed_duplicate_risk',
  derivedDietReviewLane: 'personalization.profile.derived_diet_lanes',
  derivedActivityPlan: 'personalization.profile.derived_activity_plan',
  derivedBlockerMode: 'personalization.profile.derived_blocker_mode',
} as const;

const STRATEGY_RULE_IDS = {
  blockerStrategySelected: 'personalization.strategy.blocker',
  blockerObservedConsistency: 'personalization.strategy.blocker_consistency_overlay',
  blockerObservedStack: 'personalization.strategy.blocker_stack_overlay',
  blockerDefault: 'personalization.strategy.blocker_default',
  experienceModeSelected: 'personalization.strategy.experience',
  experienceObservedStack: 'personalization.strategy.experience_observed_stack',
  experienceDefault: 'personalization.strategy.experience_default',
  dietLaneStrategySelected: 'personalization.strategy.diet_lanes',
  activityPlanStrategySelected: 'personalization.strategy.activity_plan',
  activityPlanFallback: 'personalization.strategy.activity_plan_fallback',
} as const;

const SURFACE_RULE_IDS = {
  homeSurfaceSelected: 'personalization.surface.home',
  homeGoalPrioritySeeded: 'personalization.surface.home',
  smartFilterSurfaceSelected: 'personalization.surface.smart_filter',
  smartFilterGoalsSeeded: 'personalization.surface.smart_filter',
  smartFilterTypesSeeded: 'personalization.surface.smart_filter',
  smartFilterProductMembershipBucketed: 'personalization.surface.smart_filter',
  smartFilterFallbackBucketed: 'personalization.surface.smart_filter',
  planPreviewSurfaceSelected: 'personalization.surface.plan_preview',
  planPreviewGoalsSeeded: 'personalization.surface.plan_preview',
  planPreviewTypesSeeded: 'personalization.surface.plan_preview',
  scheduleDefaultsSurfaceSelected: 'personalization.surface.schedule_defaults',
  scheduleDefaultsFromBlocker: 'personalization.surface.schedule_defaults',
  scheduleDefaultsFromActivity: 'personalization.surface.schedule_defaults',
  scheduleSetupRecommended: 'personalization.surface.schedule_defaults',
} as const;

const FALLBACK_RULE_IDS = {
  smartFilterCatalogGoals: 'personalization.fallback.smart_filter_catalog_goals',
  scheduleDefaultsCatalogAnchors: 'personalization.fallback.schedule_defaults_catalog_anchors',
} as const;

const EVALUATION_RULE_IDS = {
  evaluationReasonsCollected: 'personalization.evaluation.collected',
  evaluationPlaceholdersSelected: 'personalization.evaluation.placeholders',
  productCoverageReady: 'personalization.evaluation.coverage_gate',
  productNotEnoughStructuredData: 'personalization.evaluation.coverage_gate',
  savedProductEvaluationCompiled: 'personalization.evaluation.saved_product',
  firstStackFoundationSelected: 'personalization.evaluation.first_stack',
  firstStackGoalSupportSelected: 'personalization.evaluation.first_stack',
  firstStackOptionalSelected: 'personalization.evaluation.first_stack',
  firstStackFilteredIneligible: 'personalization.evaluation.first_stack',
  firstStackGoalGapRemaining: 'personalization.evaluation.first_stack',
  firstStackScheduleTemplateSelected: 'personalization.evaluation.first_stack',
  goalSupportedByIngredient: 'personalization.evaluation.goal_match',
  doseMeetsEffectiveFloor: 'personalization.evaluation.goal_match',
  doseBelowEffectiveFloor: 'personalization.evaluation.goal_match',
  lowDisclosureCapsStrongMatch: 'personalization.evaluation.goal_match',
  proprietaryBlendCapsGoalMatch: 'personalization.evaluation.goal_match',
  noGoalEvidence: 'personalization.evaluation.goal_match',
  duplicateOverlapHigh: 'personalization.evaluation.eligibility',
  dietConstraintConflict: 'personalization.evaluation.eligibility',
  genericSafetyPath: 'personalization.evaluation.eligibility',
} as const;

export const RULE_IDS = {
  profile: PROFILE_RULE_IDS,
  strategy: STRATEGY_RULE_IDS,
  surface: SURFACE_RULE_IDS,
  fallback: FALLBACK_RULE_IDS,
  evaluation: EVALUATION_RULE_IDS,
  ...PROFILE_RULE_IDS,
  ...STRATEGY_RULE_IDS,
  ...SURFACE_RULE_IDS,
  ...FALLBACK_RULE_IDS,
  ...EVALUATION_RULE_IDS,
} as const;

const PROFILE_REASON_CODES = {
  declaredGoalSelected: 'personalization.goals.declared',
  declaredTypeSelected: 'personalization.types.declared',
  declaredBlockerSelected: 'personalization.blocker.declared',
  declaredExperienceSelected: 'personalization.experience.declared',
  declaredDietSelected: 'personalization.diets.declared',
  declaredActivitySelected: 'personalization.activity.declared',
  observedStreakRecorded: 'personalization.streak.observed',
  observedConsistencyDerived: 'personalization.consistency.observed',
  observedMissedPatternRecorded: 'personalization.missed_pattern.observed',
  observedSavedStackRecorded: 'personalization.saved_stack.observed',
  observedDuplicateRiskDetected: 'personalization.duplicate_risk.observed',
  derivedDietReviewLane: 'personalization.diet_lane.derived',
  derivedActivityPlan: 'personalization.activity_plan.derived',
  derivedBlockerMode: 'personalization.blocker_mode.derived',
} as const;

const STRATEGY_REASON_CODES = {
  blockerStrategySelected: 'personalization.blocker_strategy.selected',
  blockerObservedConsistency: 'personalization.blocker_strategy.consistency_overlay',
  blockerObservedStack: 'personalization.blocker_strategy.stack_overlay',
  blockerDefault: 'personalization.blocker_strategy.default',
  experienceModeSelected: 'personalization.experience_mode.selected',
  experienceObservedStack: 'personalization.experience_mode.observed_stack',
  experienceDefault: 'personalization.experience_mode.default',
  dietLaneStrategySelected: 'personalization.diet_lane_strategy.selected',
  activityPlanStrategySelected: 'personalization.activity_plan_strategy.selected',
  activityPlanFallback: 'personalization.activity_plan_strategy.fallback',
} as const;

const SURFACE_REASON_CODES = {
  homeSurfaceSelected: 'personalization.home_surface.selected',
  homeEmphasizesCheckIn: 'personalization.home_surface.check_in_emphasis',
  homeEmphasizesInsights: 'personalization.home_surface.insights_emphasis',
  homeGoalPrioritySeeded: 'personalization.home_surface.goal_priority_seeded',
  smartFilterSurfaceSelected: 'personalization.smart_filter_surface.selected',
  smartFilterGoalsSeeded: 'personalization.smart_filter_surface.goals_seeded',
  smartFilterTypesSeeded: 'personalization.smart_filter_surface.types_seeded',
  smartFilterProductMembershipBucketed: 'personalization.smart_filter_surface.product_membership_bucketed',
  smartFilterFallbackBucketed: 'personalization.smart_filter_surface.fallback_bucketed',
  planPreviewSurfaceSelected: 'personalization.plan_preview_surface.selected',
  planPreviewGoalsSeeded: 'personalization.plan_preview_surface.goals_seeded',
  planPreviewTypesSeeded: 'personalization.plan_preview_surface.types_seeded',
  scheduleDefaultsSurfaceSelected: 'personalization.schedule_defaults_surface.selected',
  scheduleDefaultsFromBlocker: 'personalization.schedule_defaults_surface.blocker_seeded',
  scheduleDefaultsFromActivity: 'personalization.schedule_defaults_surface.activity_seeded',
  scheduleSetupRecommended: 'personalization.schedule_defaults_surface.schedule_setup_recommended',
} as const;

const FALLBACK_REASON_CODES = {
  smartFilterCatalogGoals: 'personalization.smart_filter_surface.catalog_goals',
  scheduleDefaultsCatalogAnchors: 'personalization.schedule_defaults_surface.catalog_anchors',
} as const;

const EVALUATION_REASON_CODES = {
  evaluationReasonsCollected: 'personalization.evaluation.collected',
  evaluationPlaceholdersSelected: 'personalization.evaluation_placeholders.selected',
  productCoverageReady: 'personalization.product_evaluation.coverage_ready',
  productNotEnoughStructuredData: 'personalization.product_evaluation.not_enough_structured_data',
  savedProductEvaluationCompiled: 'personalization.product_evaluation.compiled',
  firstStackFoundationSelected: 'personalization.first_stack.foundation_selected',
  firstStackGoalSupportSelected: 'personalization.first_stack.goal_support_selected',
  firstStackOptionalSelected: 'personalization.first_stack.optional_selected',
  firstStackFilteredIneligible: 'personalization.first_stack.filtered_ineligible',
  firstStackGoalGapRemaining: 'personalization.first_stack.goal_gap_remaining',
  firstStackScheduleTemplateSelected: 'personalization.first_stack.schedule_template_selected',
  goalSupportedByIngredient: 'goal_supported_by_ingredient',
  doseMeetsEffectiveFloor: 'dose_meets_effective_floor',
  doseBelowEffectiveFloor: 'dose_below_effective_floor',
  lowDisclosureCapsStrongMatch: 'low_disclosure_caps_strong_match',
  proprietaryBlendCapsGoalMatch: 'proprietary_blend_caps_goal_match',
  noGoalEvidence: 'goal_specific_evidence_missing',
  duplicateOverlapHigh: 'duplicate_overlap_high',
  dietConstraintConflict: 'diet_constraint_conflict',
  genericSafetyPath: 'generic_safety_path',
} as const;

export const REASON_CODES = {
  profile: PROFILE_REASON_CODES,
  strategy: STRATEGY_REASON_CODES,
  surface: SURFACE_REASON_CODES,
  fallback: FALLBACK_REASON_CODES,
  evaluation: EVALUATION_REASON_CODES,
  declaredGoalSelected: PROFILE_REASON_CODES.declaredGoalSelected,
  goalsDeclared: PROFILE_REASON_CODES.declaredGoalSelected,
  declaredTypeSelected: PROFILE_REASON_CODES.declaredTypeSelected,
  preferredTypesDeclared: PROFILE_REASON_CODES.declaredTypeSelected,
  declaredBlockerSelected: PROFILE_REASON_CODES.declaredBlockerSelected,
  blockerDeclared: PROFILE_REASON_CODES.declaredBlockerSelected,
  declaredExperienceSelected: PROFILE_REASON_CODES.declaredExperienceSelected,
  experienceDeclared: PROFILE_REASON_CODES.declaredExperienceSelected,
  declaredDietSelected: PROFILE_REASON_CODES.declaredDietSelected,
  declaredActivitySelected: PROFILE_REASON_CODES.declaredActivitySelected,
  observedStreakRecorded: PROFILE_REASON_CODES.observedStreakRecorded,
  streakObserved: PROFILE_REASON_CODES.observedStreakRecorded,
  observedConsistencyDerived: PROFILE_REASON_CODES.observedConsistencyDerived,
  consistencyObserved: PROFILE_REASON_CODES.observedConsistencyDerived,
  observedMissedPatternRecorded: PROFILE_REASON_CODES.observedMissedPatternRecorded,
  observedSavedStackRecorded: PROFILE_REASON_CODES.observedSavedStackRecorded,
  savedStackObserved: PROFILE_REASON_CODES.observedSavedStackRecorded,
  observedDuplicateRiskDetected: PROFILE_REASON_CODES.observedDuplicateRiskDetected,
  duplicateRiskObserved: PROFILE_REASON_CODES.observedDuplicateRiskDetected,
  derivedDietReviewLane: PROFILE_REASON_CODES.derivedDietReviewLane,
  dietLaneDerived: PROFILE_REASON_CODES.derivedDietReviewLane,
  derivedActivityPlan: PROFILE_REASON_CODES.derivedActivityPlan,
  activityPlanDerived: PROFILE_REASON_CODES.derivedActivityPlan,
  derivedBlockerMode: PROFILE_REASON_CODES.derivedBlockerMode,
  blockerModeDerived: PROFILE_REASON_CODES.derivedBlockerMode,
  blockerStrategySelected: STRATEGY_REASON_CODES.blockerStrategySelected,
  blockerObservedConsistency: STRATEGY_REASON_CODES.blockerObservedConsistency,
  blockerObservedStack: STRATEGY_REASON_CODES.blockerObservedStack,
  blockerDefault: STRATEGY_REASON_CODES.blockerDefault,
  blockerStrategyApplied: STRATEGY_REASON_CODES.blockerStrategySelected,
  experienceModeSelected: STRATEGY_REASON_CODES.experienceModeSelected,
  experienceObservedStack: STRATEGY_REASON_CODES.experienceObservedStack,
  experienceDefault: STRATEGY_REASON_CODES.experienceDefault,
  experienceModeApplied: STRATEGY_REASON_CODES.experienceModeSelected,
  dietLaneStrategySelected: STRATEGY_REASON_CODES.dietLaneStrategySelected,
  dietLanePrioritized: STRATEGY_REASON_CODES.dietLaneStrategySelected,
  activityPlanStrategySelected: STRATEGY_REASON_CODES.activityPlanStrategySelected,
  activityPlanCompiled: STRATEGY_REASON_CODES.activityPlanStrategySelected,
  activityPlanFallback: STRATEGY_REASON_CODES.activityPlanFallback,
  homeSurfaceSelected: SURFACE_REASON_CODES.homeSurfaceSelected,
  homeEmphasizesCheckIn: SURFACE_REASON_CODES.homeEmphasizesCheckIn,
  homeEmphasizesInsights: SURFACE_REASON_CODES.homeEmphasizesInsights,
  homeGoalPrioritySeeded: SURFACE_REASON_CODES.homeGoalPrioritySeeded,
  smartFilterSurfaceSelected: SURFACE_REASON_CODES.smartFilterSurfaceSelected,
  smartFilterGoalsSeeded: SURFACE_REASON_CODES.smartFilterGoalsSeeded,
  smartFilterTypesSeeded: SURFACE_REASON_CODES.smartFilterTypesSeeded,
  smartFilterProductMembershipBucketed: SURFACE_REASON_CODES.smartFilterProductMembershipBucketed,
  smartFilterFallbackBucketed: SURFACE_REASON_CODES.smartFilterFallbackBucketed,
  planPreviewSurfaceSelected: SURFACE_REASON_CODES.planPreviewSurfaceSelected,
  planPreviewGoalsSeeded: SURFACE_REASON_CODES.planPreviewGoalsSeeded,
  planPreviewTypesSeeded: SURFACE_REASON_CODES.planPreviewTypesSeeded,
  scheduleDefaultsSurfaceSelected: SURFACE_REASON_CODES.scheduleDefaultsSurfaceSelected,
  scheduleDefaultsFromBlocker: SURFACE_REASON_CODES.scheduleDefaultsFromBlocker,
  scheduleDefaultsFromActivity: SURFACE_REASON_CODES.scheduleDefaultsFromActivity,
  scheduleSetupRecommended: SURFACE_REASON_CODES.scheduleSetupRecommended,
  smartFilterCatalogGoals: FALLBACK_REASON_CODES.smartFilterCatalogGoals,
  scheduleDefaultsCatalogAnchors: FALLBACK_REASON_CODES.scheduleDefaultsCatalogAnchors,
  evaluationReasonsCollected: EVALUATION_REASON_CODES.evaluationReasonsCollected,
  evaluationPlaceholdersSelected: EVALUATION_REASON_CODES.evaluationPlaceholdersSelected,
  productCoverageReady: EVALUATION_REASON_CODES.productCoverageReady,
  productNotEnoughStructuredData: EVALUATION_REASON_CODES.productNotEnoughStructuredData,
  savedProductEvaluationCompiled: EVALUATION_REASON_CODES.savedProductEvaluationCompiled,
  firstStackFoundationSelected: EVALUATION_REASON_CODES.firstStackFoundationSelected,
  firstStackGoalSupportSelected: EVALUATION_REASON_CODES.firstStackGoalSupportSelected,
  firstStackOptionalSelected: EVALUATION_REASON_CODES.firstStackOptionalSelected,
  firstStackFilteredIneligible: EVALUATION_REASON_CODES.firstStackFilteredIneligible,
  firstStackGoalGapRemaining: EVALUATION_REASON_CODES.firstStackGoalGapRemaining,
  firstStackScheduleTemplateSelected: EVALUATION_REASON_CODES.firstStackScheduleTemplateSelected,
  goalSupportedByIngredient: EVALUATION_REASON_CODES.goalSupportedByIngredient,
  doseMeetsEffectiveFloor: EVALUATION_REASON_CODES.doseMeetsEffectiveFloor,
  doseBelowEffectiveFloor: EVALUATION_REASON_CODES.doseBelowEffectiveFloor,
  lowDisclosureCapsStrongMatch: EVALUATION_REASON_CODES.lowDisclosureCapsStrongMatch,
  proprietaryBlendCapsGoalMatch: EVALUATION_REASON_CODES.proprietaryBlendCapsGoalMatch,
  noGoalEvidence: EVALUATION_REASON_CODES.noGoalEvidence,
  duplicateOverlapHigh: EVALUATION_REASON_CODES.duplicateOverlapHigh,
  dietConstraintConflict: EVALUATION_REASON_CODES.dietConstraintConflict,
  genericSafetyPath: EVALUATION_REASON_CODES.genericSafetyPath,
} as const;

export type PersonalizationReasonCode =
  Exclude<(typeof REASON_CODES)[keyof typeof REASON_CODES], Record<string, string>>;

type ReasonParamValue = string | number | boolean;
type ReasonParams = Record<string, ReasonParamValue>;
type ReasonScope = 'profile' | 'strategy' | 'surface' | 'fallback' | 'evaluation';

const REASON_GROUPS: Record<ReasonScope, Record<string, string>> = {
  profile: PROFILE_REASON_CODES,
  strategy: STRATEGY_REASON_CODES,
  surface: SURFACE_REASON_CODES,
  fallback: FALLBACK_REASON_CODES,
  evaluation: EVALUATION_REASON_CODES,
};

const RULE_GROUPS: Record<ReasonScope, Record<string, string>> = {
  profile: PROFILE_RULE_IDS,
  strategy: STRATEGY_RULE_IDS,
  surface: SURFACE_RULE_IDS,
  fallback: FALLBACK_RULE_IDS,
  evaluation: EVALUATION_RULE_IDS,
};

const sortParams = (params?: DecisionReason['params']): DecisionReason['params'] | undefined => {
  if (!params) return undefined;

  const entries = Object.entries(params)
    .filter(([, value]) => value !== undefined)
    .sort(([left], [right]) => left.localeCompare(right));

  return entries.length > 0 ? Object.fromEntries(entries) : undefined;
};

export const buildRuleId = (...segments: string[]) => ['personalization', ...segments].join('.');
export const buildReasonCode = (...segments: string[]) => ['personalization', ...segments].join('.');

export type DecisionReasonInput = {
  code: string;
  ruleId: string;
  source: DecisionReasonSource;
  params?: ReasonParams;
};

export const createDecisionReason = (input: DecisionReasonInput): DecisionReason => {
  const params = sortParams(input.params);

  return {
    code: input.code,
    ruleId: input.ruleId,
    source: input.source,
    ...(params ? { params } : {}),
  };
};

export const buildReason = (
  code: string,
  ruleId: string,
  source: DecisionReasonSource,
  params?: DecisionReason['params'],
): DecisionReason =>
  createDecisionReason({
    code,
    ruleId,
    source,
    params,
  });

export const createScopedReason = (
  scope: ReasonScope,
  key: string,
  source: DecisionReasonSource,
  params?: ReasonParams,
): DecisionReason => {
  const code = REASON_GROUPS[scope][key];
  const ruleId = RULE_GROUPS[scope][key];

  if (!code || !ruleId) {
    throw new Error(`Unknown personalization reason mapping: ${scope}.${key}`);
  }

  return createDecisionReason({
    code,
    ruleId,
    source,
    params,
  });
};

const createScopedDecisionReason =
  (source: DecisionReasonSource) =>
  (input: Omit<DecisionReasonInput, 'source'>): DecisionReason =>
    createDecisionReason({
      ...input,
      source,
    });

export const createDeclaredReason = createScopedDecisionReason('declared');
export const createObservedReason = createScopedDecisionReason('observed');
export const createDerivedReason = createScopedDecisionReason('derived');
export const createCatalogReason = createScopedDecisionReason('catalog');

export const cloneReason = (reason: DecisionReason): DecisionReason =>
  createDecisionReason({
    code: reason.code,
    ruleId: reason.ruleId,
    source: reason.source,
    params: reason.params as ReasonParams | undefined,
  });

export const getDecisionReasonKey = (reason: DecisionReason) =>
  JSON.stringify([
    reason.ruleId,
    reason.code,
    reason.source,
    reason.params ? Object.entries(sortParams(reason.params) ?? {}) : [],
  ]);

export const dedupeDecisionReasons = (reasons: readonly DecisionReason[]) => {
  const seen = new Set<string>();
  const deduped: DecisionReason[] = [];

  reasons.forEach((reason) => {
    const normalized = cloneReason(reason);
    const key = getDecisionReasonKey(normalized);
    if (seen.has(key)) return;
    seen.add(key);
    deduped.push(normalized);
  });

  return deduped;
};

export const dedupeReasons = (...collections: Array<readonly DecisionReason[] | undefined>) =>
  dedupeDecisionReasons(collections.flatMap((collection) => collection ?? []));

export const mergeDecisionReasons = (...collections: Array<readonly DecisionReason[] | undefined>) =>
  dedupeReasons(...collections);

export const isPersonalizationReasonCode = (
  value: string,
): value is PersonalizationReasonCode =>
  Object.values(REASON_CODES).some(
    (entry) => typeof entry === 'string' && entry === value,
  );
