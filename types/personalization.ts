export type GoalKey =
  | 'sleep'
  | 'energy'
  | 'immunity'
  | 'recovery'
  | 'focus'
  | 'libido_enhancement'
  | 'stress_support'
  | 'weight_management';

export type SupplementTypeKey =
  | 'vitamin'
  | 'mineral'
  | 'herb'
  | 'probiotic'
  | 'protein';

export type BlockerKey =
  | 'busy_day_forgetfulness'
  | 'routine_changes_day_to_day'
  | 'goal_fit_uncertainty'
  | 'label_and_dosage_confusion'
  | 'weak_tracking_habit'
  | 'already_consistent';

export type ExperienceLevel =
  | 'brand_new'
  | 'tried_a_few'
  | 'regular_user'
  | 'structured_stack';

export type DecisionReasonSource =
  | 'declared'
  | 'observed'
  | 'derived'
  | 'catalog';

export type ProductGoalMatchTier =
  | 'strong_match'
  | 'related'
  | 'weak_match'
  | 'no_match';

export type SavedProductFactsStatus = 'full' | 'partial' | 'none';
export type ProductCoverageStatus = 'coverage_ready' | 'not_enough_structured_data';
export type SmartFilterProductBucket = ProductGoalMatchTier | 'not_enough_structured_data';

export type DuplicateRiskLevel = 'none' | 'medium' | 'high';
export type ConsistencyLevel = 'unknown' | 'low' | 'medium' | 'high';

export type DecisionReason = {
  code: string;
  ruleId: string;
  source: DecisionReasonSource;
  params?: Record<string, string | number | boolean>;
};

export type PersonalizationDeclaredSignals = {
  goals: Array<{ key: GoalKey; priority: number }>;
  preferredTypes: SupplementTypeKey[];
  adherenceBlocker?: BlockerKey;
  supplementExperience?: ExperienceLevel;
  diets?: string[];
  activity?: string[];
  ageRange?: string;
  sex?: string;
};

export type PersonalizationObservedSignals = {
  currentStreak?: number;
  consistencyLevel: ConsistencyLevel;
  missedPattern?: string;
  savedStackCount: number;
  duplicateRisk: {
    level: DuplicateRiskLevel;
    ingredientKeys: string[];
  };
};

export type PersonalizationDerivedSignals = {
  dietReviewLanes: string[];
  activityPlanKeys: string[];
  blockerMode?: string;
};

export type PersonalizationProfile = {
  declared: PersonalizationDeclaredSignals;
  observed: PersonalizationObservedSignals;
  derived: PersonalizationDerivedSignals;
  meta: {
    profileVersion: string;
    computedAt: string;
  };
};

export type EligibilityDecision = {
  eligible: boolean;
  rankEligible: boolean;
  caps: string[];
  reasons: DecisionReason[];
};

export type ProductGoalMatch = {
  goalKey: GoalKey;
  score: number;
  tier: ProductGoalMatchTier;
  reasons: DecisionReason[];
  caps?: string[];
};

export type ProductCoverageDecision = {
  factsStatus: SavedProductFactsStatus;
  status: ProductCoverageStatus;
  reasons: DecisionReason[];
};

export type EvaluatedProductDisplay = {
  title?: string;
  brandName?: string;
  dosageText?: string;
  imageUrl?: string;
};

export type SavedProductEvaluationInput = {
  productId: string;
  factsStatus: SavedProductFactsStatus;
  productGoalMatches?: ProductGoalMatch[];
  eligibility?: EligibilityDecision;
  display?: EvaluatedProductDisplay;
};

export type BlockerStrategy = {
  reminderPriority: 'high' | 'medium' | 'low';
  scheduleComplexity: 'simple' | 'guided' | 'advanced';
  notificationBudget: 'light' | 'standard' | 'heavy';
  emphasizeHomeCheckIn: boolean;
  emphasizeScheduleSetup: boolean;
  emphasizeExplanation: boolean;
};

export type ExperienceMode = {
  explanationDepth: 'simple' | 'guided' | 'advanced';
  uiDensity: 'minimal' | 'standard' | 'advanced';
  showAdvancedSafety: boolean;
  showDetailedForms: boolean;
};

export type DietReviewLane = {
  laneKey: string;
  priority: 'high' | 'medium' | 'low';
  reasons: DecisionReason[];
};

export type ActivityPlan = {
  suggestedGoals: GoalKey[];
  suggestedTypes: SupplementTypeKey[];
  suggestedTimingAnchors: string[];
  reasons: DecisionReason[];
};

export type FirstStackPlanItem = {
  productId: string;
  role: 'foundation' | 'goal_support' | 'optional';
  reasons: DecisionReason[];
  display?: EvaluatedProductDisplay;
};

export type FirstStackPlan = {
  items: FirstStackPlanItem[];
  scheduleTemplateKey: string;
  explanationFacts: DecisionReason[];
};

export type ExplanationSurface = 'plan_preview' | 'first_stack';

export type ExplanationFact = {
  factId: string;
  code: string;
  params?: Record<string, string | number | boolean>;
};

export type ExplanationPayload = {
  snapshotId: string;
  rulesVersion: string;
  surface: ExplanationSurface;
  selectedGoals: GoalKey[];
  selectedTypes: SupplementTypeKey[];
  facts: ExplanationFact[];
  firstStackPlan?: FirstStackPlan;
};

export type ExplanationResult = {
  source: 'deepseek' | 'deterministic';
  fallback: boolean;
  summary: string;
  bullets: string[];
  model?: string;
};

export type HomePersonalizationVM = {
  emphasizedModules: string[];
  prioritizedGoals: GoalKey[];
  tipLaneKeys: string[];
  reasons: DecisionReason[];
};

export type SmartFilterProductMembership = {
  productId: string;
  factsStatus: SavedProductFactsStatus;
  coverageStatus: ProductCoverageStatus;
  bucket: SmartFilterProductBucket;
  highlightedGoal?: GoalKey;
  goalTiers: Partial<Record<GoalKey, ProductGoalMatchTier>>;
  eligibility?: Pick<EligibilityDecision, 'eligible' | 'rankEligible' | 'caps'>;
  reasons: DecisionReason[];
};

export type SmartFilterPersonalizationVM = {
  visibleGoals: GoalKey[];
  preselectedTypes: SupplementTypeKey[];
  highlightedGoal?: GoalKey;
  productMembershipById?: Record<string, SmartFilterProductMembership>;
  productBuckets?: Record<SmartFilterProductBucket, string[]>;
  fallback?: {
    notEnoughStructuredDataProductIds: string[];
  };
  reasons: DecisionReason[];
};

export type PlanPreviewPersonalizationVM = {
  goals: GoalKey[];
  types: SupplementTypeKey[];
  blockerStrategy: BlockerStrategy;
  dietLanes: string[];
  activityAnchors: string[];
  reasons: DecisionReason[];
};

export type ScheduleDefaultsPersonalizationVM = {
  reminderPriority: BlockerStrategy['reminderPriority'];
  suggestedTimingAnchors: string[];
  preferScheduleSetup: boolean;
  reasons: DecisionReason[];
};

export type SavedProductEvaluation = {
  productId: string;
  factsStatus: SavedProductFactsStatus;
  coverage: ProductCoverageDecision;
  productGoalMatches: ProductGoalMatch[];
  eligibility?: EligibilityDecision;
  firstStackEligible: boolean;
  smartFilterMembership: SmartFilterProductMembership;
  reasons: DecisionReason[];
  display?: EvaluatedProductDisplay;
};

export type OverrideEventAction = 'set' | 'dismiss' | 'accept' | 'remove';
export type OverrideTargetSurface =
  | 'schedule_defaults'
  | 'smart_filter'
  | 'plan_preview'
  | 'first_stack';

export type OverrideEvent = {
  id: string;
  userId?: string | null;
  timestamp: string;
  source: 'user';
  surface: OverrideTargetSurface;
  action: OverrideEventAction;
  field: string;
  value?: string | string[] | boolean | number;
};

export type FeedbackState = {
  version: string;
  updatedAt: string;
  events: OverrideEvent[];
  overrides: {
    scheduleDefaults?: Partial<{
      reminderPriority: ScheduleDefaultsPersonalizationVM['reminderPriority'];
      suggestedTimingAnchors: string[];
      preferScheduleSetup: boolean;
    }>;
    smartFilter?: Partial<{
      visibleGoals: GoalKey[];
      preselectedTypes: SupplementTypeKey[];
      highlightedGoal?: GoalKey;
    }>;
    firstStack?: Partial<{
      dismissedProductIds: string[];
      acceptedProductIds: string[];
      scheduleTemplateKey: string;
    }>;
  };
  dismissals: Partial<Record<OverrideTargetSurface, string[]>>;
};

export type PersonalizationSnapshot = {
  snapshotId: string;
  rulesVersion: string;
  computedAt: string;
  profile: PersonalizationProfile;
  strategies: {
    blocker: BlockerStrategy;
    experience: ExperienceMode;
    dietLanes: DietReviewLane[];
    activityPlan: ActivityPlan;
  };
  evaluations: {
    productGoalMatches: Record<string, ProductGoalMatch[]>;
    eligibility?: Record<string, EligibilityDecision>;
    coverage?: Record<string, ProductCoverageDecision>;
    savedProductEvaluations?: Record<string, SavedProductEvaluation>;
    firstStackPlan?: FirstStackPlan;
  };
  surfaces: {
    home: HomePersonalizationVM;
    smartFilter: SmartFilterPersonalizationVM;
    planPreview: PlanPreviewPersonalizationVM;
    scheduleDefaults: ScheduleDefaultsPersonalizationVM;
  };
  trace: DecisionReason[];
};

export type PersonalizationFeatureFlags = {
  enablePersonalizationV1: boolean;
  enableGoalMatchScoring: boolean;
  enableEligibilityPolicy: boolean;
  enablePlanPreviewPersonalization: boolean;
  enableSmartFilterPersonalization: boolean;
};
