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
  cautionClass?: 'clear' | 'review' | 'blocked';
  suppressionLevel?: 'none' | 'deprioritize' | 'exclude';
};

export type ProductGoalMatch = {
  goalKey: GoalKey;
  score: number;
  tier: ProductGoalMatchTier;
  reasons: DecisionReason[];
  caps?: string[];
  confidence?: {
    evidence: 'high' | 'medium' | 'low';
    dose: 'meets' | 'below' | 'unknown' | 'not_applicable';
    disclosure: 'full' | 'partial' | 'weak';
  };
};

export type ProductCoverageDecision = {
  factsStatus: SavedProductFactsStatus;
  status: ProductCoverageStatus;
  reasons: DecisionReason[];
};

export type GoalFitCardTier = ProductGoalMatchTier | 'not_enough_structured_data';

export type ConfidenceBreakdown = {
  evidence: 'high' | 'medium' | 'low';
  labelCompleteness: 'full' | 'partial' | 'weak';
  overlapRisk: 'none' | 'watch' | 'high';
  routineFit: 'easy' | 'moderate' | 'complex';
};

export type GoalFitCard = {
  productId: string;
  goalKey?: GoalKey;
  tier: GoalFitCardTier;
  confidence: ConfidenceBreakdown;
  whyFit: DecisionReason[];
  whyNotStronger: DecisionReason[];
  holdbacks: DecisionReason[];
  stackContext?: DecisionReason[];
};

export type GoalCompareEntry = {
  productId: string;
  goalKey?: GoalKey;
  title?: string;
  brandName?: string;
  dosageText?: string;
  tier: GoalFitCardTier;
  confidence: ConfidenceBreakdown;
  whyFit: DecisionReason[];
  whyNotStronger: DecisionReason[];
  holdbacks: DecisionReason[];
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
  goalScoringBlockedReason?: 'out_of_scope_non_supplement' | null;
  typeKeys?: SupplementTypeKey[];
  productGoalMatches?: ProductGoalMatch[];
  eligibility?: EligibilityDecision;
  display?: EvaluatedProductDisplay;
};

export type BlockerStrategy = {
  primarySupportFocus:
    | 'reminder'
    | 'schedule'
    | 'explanation'
    | 'education'
    | 'checkin'
    | 'optimization';
  reminderPriority: 'high' | 'medium' | 'low';
  scheduleComplexity: 'simple' | 'guided' | 'advanced';
  notificationBudget: 'light' | 'standard' | 'heavy';
  emphasizeHomeCheckIn: boolean;
  emphasizeScheduleSetup: boolean;
  emphasizeExplanation: boolean;
};

export type SupportState =
  | 'explore'
  | 'choose'
  | 'install'
  | 'stabilize'
  | 'optimize';

export type PreferenceVector = {
  decisionMode: 'best_fit' | 'simpler' | 'strong_only' | 'better_disclosure' | 'low_overlap';
  explanationStyle: 'brief' | 'compare' | 'deep';
  notificationTolerance: 'low' | 'medium' | 'high';
};

export type PersonalizationControlKey =
  | 'simpler'
  | 'strong_only'
  | 'better_disclosure'
  | 'low_overlap'
  | 'explain_first'
  | 'less_reminders';

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
  reviewBundleKey?: string;
  focusAreas?: string[];
};

export type ActivityPlan = {
  suggestedGoals: GoalKey[];
  suggestedTypes: SupplementTypeKey[];
  suggestedTimingAnchors: string[];
  reasons: DecisionReason[];
  decisionModifier?: string;
  reviewBundleKey?: string;
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

export type ExplanationSurface =
  | 'plan_preview'
  | 'first_stack'
  | 'goal_fit_detail'
  | 'product_compare'
  | 'weekly_insight';

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

export type GoalNavigatorUserContext = {
  duplicateRisk?: PersonalizationObservedSignals['duplicateRisk'];
  supplementExperience?: ExperienceLevel;
  ageRange?: string;
  adherenceBlocker?: BlockerKey;
};

export type GoalNavigatorRequest = {
  goalKey: GoalKey;
  preferredTypes?: SupplementTypeKey[];
  limit?: number;
  snapshotId?: string;
  userContext?: GoalNavigatorUserContext;
  preferenceVector?: PreferenceVector;
};

export type GoalNavigatorCandidate = {
  productId: string;
  goalKey: GoalKey;
  tier: GoalFitCardTier;
  score: number;
  typeKeys: SupplementTypeKey[];
  preferredTypeMatch: boolean;
  sourceProductId?: string;
  barcode?: string | null;
  externalUrl?: string | null;
  evaluation: SavedProductEvaluation;
  goalFitCard: GoalFitCard;
};

export type GoalNavigatorResponse = {
  goalKey: GoalKey;
  snapshotId?: string;
  rulesVersion: string;
  preferredTypes: SupplementTypeKey[];
  preferenceVector?: PreferenceVector;
  candidates: GoalNavigatorCandidate[];
  fallback: {
    notEnoughStructuredDataCount: number;
  };
  reasons: DecisionReason[];
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
  typeKeys: SupplementTypeKey[];
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
  | 'first_stack'
  | 'personalization_controls';

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

export type PersonalizationEventName =
  | 'goal_navigator_opened'
  | 'goal_fit_detail_opened'
  | 'compare_opened'
  | 'control_selected'
  | 'schedule_edited'
  | 'reminder_disabled'
  | 'save_then_unsave'
  | 'first_stack_accepted';

export type PersonalizationEventRecord = {
  eventName: PersonalizationEventName;
  surface: string;
  createdAt: string;
  snapshotId?: string | null;
  rulesVersion?: string | null;
  supportState?: SupportState | null;
};

export type PersonalizationEventSummary = {
  totalCount: number;
  lastEventAt: string | null;
  countsByEventName: Partial<Record<PersonalizationEventName, number>>;
  countsBySurface: Record<string, number>;
  recentEvents: PersonalizationEventRecord[];
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
    controls?: Partial<PreferenceVector>;
  };
  dismissals: Partial<Record<OverrideTargetSurface, string[]>>;
};

export type StackAuditItem = {
  productId: string;
  title?: string;
  status: 'kept' | 'held_back' | 'watch';
  goalKey?: GoalKey;
  confidence?: ConfidenceBreakdown;
  reasons: DecisionReason[];
};

export type StackAudit = {
  supportState: SupportState;
  overlapRisk: ConfidenceBreakdown['overlapRisk'];
  headline: string;
  summary: string;
  kept: StackAuditItem[];
  heldBack: StackAuditItem[];
  reasons: DecisionReason[];
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
    supportState: SupportState;
    preferenceVector: PreferenceVector;
  };
  evaluations: {
    productGoalMatches: Record<string, ProductGoalMatch[]>;
    eligibility?: Record<string, EligibilityDecision>;
    coverage?: Record<string, ProductCoverageDecision>;
    savedProductEvaluations?: Record<string, SavedProductEvaluation>;
    goalFitCards?: Record<string, GoalFitCard>;
    firstStackPlan?: FirstStackPlan;
  };
  surfaces: {
    home: HomePersonalizationVM;
    smartFilter: SmartFilterPersonalizationVM;
    planPreview: PlanPreviewPersonalizationVM;
    scheduleDefaults: ScheduleDefaultsPersonalizationVM;
  };
  premiumInsights?: {
    stackAudit?: StackAudit;
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
