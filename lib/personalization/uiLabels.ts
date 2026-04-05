import activityGoalMapData from "@/data/personalization/activity_goal_map.v1.json";
import blockerBehaviorRulesData from "@/data/personalization/blocker_behavior_rules.v1.json";
import dietLaneMapData from "@/data/personalization/diet_nutrient_lane_map.v1.json";
import { getGoalLabel } from "@/lib/personalization/core/goalCatalog";
import { buildGoalIngredientPreviewLanes as buildGoalIngredientPreviewLanesFromOntology } from "@/lib/personalization/core/goalMatchOntology";
import type {
  BlockerKey,
  BlockerStrategy,
  FirstStackPlanItem,
  GoalKey,
  PersonalizationEventSummary,
  PlanPreviewPersonalizationVM,
  PreferenceVector,
  ScheduleDefaultsPersonalizationVM,
  SupportState,
  SupplementTypeKey,
} from "@/types/personalization";

type DietLaneMapFile = {
  laneCatalog: {
    laneKey: string;
    label: string;
  }[];
};

type ActivityGoalMapFile = {
  activityMappings: {
    suggestedTimingAnchors: string[];
  }[];
};

type BlockerRulesFile = {
  blockerStrategies: {
    key: BlockerKey;
    onboardingLabel: string;
  }[];
};

const DIET_LANE_MAP = dietLaneMapData as DietLaneMapFile;
const ACTIVITY_GOAL_MAP = activityGoalMapData as ActivityGoalMapFile;
const BLOCKER_RULES = blockerBehaviorRulesData as BlockerRulesFile;

const TYPE_LABELS: Record<SupplementTypeKey, string> = {
  vitamin: "Vitamin",
  mineral: "Mineral",
  herb: "Herb",
  probiotic: "Probiotic",
  protein: "Protein",
};

const GOAL_LABELS: Record<GoalKey, string> = {
  sleep: "Sleep",
  energy: "Energy",
  immunity: "Immunity",
  recovery: "Recovery",
  focus: "Focus",
  libido_enhancement: "Libido Enhancement",
  stress_support: "Stress Support",
  weight_management: "Weight Management",
};

const DEFAULT_TIMING_LABELS: Record<string, string> = {
  breakfast: "Breakfast",
  lunch: "Lunch",
  dinner: "Dinner",
  bedtime: "Bedtime",
  morning: "Morning",
  evening: "Evening",
  pre_workout: "Pre-workout",
  post_workout: "Post-workout",
  first_meal: "First meal",
  last_meal: "Last meal",
  daily_check_in: "Daily check-in",
  existing_routine: "Existing routine",
};

const INGREDIENT_LABELS: Record<string, string> = {
  ashwagandha: "Ashwagandha",
  beta_glucan: "Beta-glucan",
  caffeine: "Caffeine",
  citicoline: "Citicoline",
  coenzyme_q10: "CoQ10",
  creatine: "Creatine",
  elderberry: "Elderberry",
  fiber: "Fiber",
  iron: "Iron",
  l_theanine: "L-theanine",
  lemon_balm_extract: "Lemon balm",
  maca: "Maca",
  magnesium: "Magnesium",
  melatonin: "Melatonin",
  omega_3: "Omega-3",
  protein: "Protein",
  quercetin: "Quercetin",
  rhodiola_rosea: "Rhodiola",
  valerian_root_extract: "Valerian root",
  vitamin_b12: "Vitamin B12",
  vitamin_c: "Vitamin C",
  vitamin_d: "Vitamin D",
  zinc: "Zinc",
};

const SCHEDULE_TEMPLATE_LABELS: Record<string, string> = {
  phase3_simple_template: "Simple daily plan",
  phase3_guided_template: "Guided routine plan",
  phase3_advanced_template: "Advanced stack plan",
};

const blockerLabelByKey = new Map(
  BLOCKER_RULES.blockerStrategies.map((rule) => [rule.key, rule.onboardingLabel] as const),
);

const dietLaneLabelByKey = new Map(
  DIET_LANE_MAP.laneCatalog.map((lane) => [lane.laneKey, lane.label] as const),
);

const activityAnchorSet = new Set(
  ACTIVITY_GOAL_MAP.activityMappings.flatMap((mapping) => mapping.suggestedTimingAnchors),
);

const titleCaseFallback = (value: string) =>
  value
    .split(/[_\s-]+/)
    .filter(Boolean)
    .map((chunk) => chunk.charAt(0).toUpperCase() + chunk.slice(1))
    .join(" ");

export const getGoalDisplayLabel = (goalKey: GoalKey) => getGoalLabel(goalKey) ?? titleCaseFallback(goalKey);

const getIngredientDisplayLabel = (ingredientKey: string) =>
  INGREDIENT_LABELS[ingredientKey] ?? titleCaseFallback(ingredientKey);

export type GoalIngredientPreviewLane = {
  goalKey: GoalKey;
  goalLabel: string;
  ingredients: string[];
};

export const buildGoalIngredientPreviewLanes = (
  goals: readonly GoalKey[],
): GoalIngredientPreviewLane[] =>
  buildGoalIngredientPreviewLanesFromOntology(goals).map((lane) => ({
    goalKey: lane.goalKey,
    goalLabel: getGoalDisplayLabel(lane.goalKey),
    ingredients: lane.ingredientKeys.map((ingredientKey) => getIngredientDisplayLabel(ingredientKey)),
  }));

export const getAllGoalDisplayLabels = (): string[] =>
  Object.keys(GOAL_LABELS).map((goalKey) => getGoalDisplayLabel(goalKey as GoalKey));

export const getSupplementTypeDisplayLabel = (typeKey: SupplementTypeKey) =>
  TYPE_LABELS[typeKey] ?? titleCaseFallback(typeKey);

export const getAllSupplementTypeDisplayLabels = (): string[] =>
  Object.keys(TYPE_LABELS).map((typeKey) => getSupplementTypeDisplayLabel(typeKey as SupplementTypeKey));

export const getDietLaneDisplayLabel = (laneKey: string) =>
  dietLaneLabelByKey.get(laneKey) ?? titleCaseFallback(laneKey.replace(/^diet_/, "").replace(/_review$/, ""));

export const getTimingAnchorDisplayLabel = (anchor: string) =>
  DEFAULT_TIMING_LABELS[anchor] ??
  (activityAnchorSet.has(anchor) ? titleCaseFallback(anchor) : titleCaseFallback(anchor));

export const getReviewBundleDisplayLabel = (bundleKey?: string | null) =>
  bundleKey ? titleCaseFallback(bundleKey) : null;

export const getDecisionModifierDisplayLabel = (decisionModifier?: string | null) => {
  switch (decisionModifier) {
    case "easy_start_strength":
      return "Easy-start strength support";
    case "timing_anchor_endurance":
      return "Timing-friendly endurance support";
    case "consistency_friendly":
      return "Consistency-friendly recovery support";
    case "performance_anchor":
      return "Performance anchor support";
    case "easy_start_general":
      return "Easy-start general support";
    default:
      return decisionModifier ? titleCaseFallback(decisionModifier) : null;
  }
};

export const getScheduleTemplateDisplayLabel = (templateKey: string) =>
  SCHEDULE_TEMPLATE_LABELS[templateKey] ?? "Personalized plan";

export const getBlockerDisplayLabel = (blocker?: BlockerKey) =>
  blocker ? blockerLabelByKey.get(blocker) ?? titleCaseFallback(blocker) : null;

export const getFirstStackRoleLabel = (role: FirstStackPlanItem["role"]) => {
  switch (role) {
    case "foundation":
      return "Foundation support";
    case "goal_support":
      return "Goal support";
    case "optional":
    default:
      return "Optional add-on";
  }
};

export const getReminderPriorityLabel = (
  priority: ScheduleDefaultsPersonalizationVM["reminderPriority"],
) => {
  switch (priority) {
    case "high":
      return "More nudges";
    case "low":
      return "Fewer nudges";
    default:
      return "Balanced nudges";
  }
};

export const buildBlockerStrategySummary = (strategy: BlockerStrategy) => {
  switch (strategy.primarySupportFocus) {
    case "schedule":
      if (strategy.scheduleComplexity === "guided") {
        return "We will guide you into a more flexible routine instead of assuming every day.";
      }

      if (strategy.scheduleComplexity === "advanced") {
        return "We will keep more control points visible so you can tune a structured routine.";
      }

      return "We will keep setup simple and help you lock in the right routine early.";
    case "education":
    case "explanation":
      return "We will first clarify which supplements fit your goals before asking you to set up reminders or a routine.";
    case "checkin":
      return "We will put Daily Check-in and consistency cues first so the habit feels easier to keep.";
    case "optimization":
      return "We will keep personalization light and focus on fine-tuning what already works for you.";
    case "reminder":
    default:
      return "";
  }
};

export const buildScheduleDefaultsSummary = (scheduleDefaults: ScheduleDefaultsPersonalizationVM) => {
  const anchorLabel = scheduleDefaults.suggestedTimingAnchors[0]
    ? getTimingAnchorDisplayLabel(scheduleDefaults.suggestedTimingAnchors[0])
    : null;

  if (scheduleDefaults.preferScheduleSetup && anchorLabel) {
    return `Set this now and use ${anchorLabel.toLowerCase()} as the anchor.`;
  }

  if (scheduleDefaults.preferScheduleSetup) {
    return "Set this now so Daily Check-in stays accurate.";
  }

  if (anchorLabel) {
    return `Best anchor: ${anchorLabel}.`;
  }

  return getReminderPriorityLabel(scheduleDefaults.reminderPriority);
};

export const buildPlanPreviewSummary = (surface: PlanPreviewPersonalizationVM) => {
  const goalLabel = surface.goals[0] ? getGoalDisplayLabel(surface.goals[0]) : "your goals";
  const anchorLabel = surface.activityAnchors[0]
    ? getTimingAnchorDisplayLabel(surface.activityAnchors[0])
    : null;

  if (
    surface.blockerStrategy.primarySupportFocus === "education" ||
    surface.blockerStrategy.primarySupportFocus === "explanation"
  ) {
    return `We will start by showing which supplements best fit ${goalLabel} before we ask you to set up a routine.`;
  }

  if (anchorLabel) {
    return `We will start with ${goalLabel} and use ${anchorLabel.toLowerCase()} as your first timing anchor.`;
  }

  return `We will start by focusing your first experience around ${goalLabel}.`;
};

export const getSupportStateDisplayLabel = (supportState: SupportState) => {
  switch (supportState) {
    case "choose":
      return "Choose";
    case "install":
      return "Install";
    case "stabilize":
      return "Stabilize";
    case "optimize":
      return "Optimize";
    case "explore":
    default:
      return "Explore";
  }
};

export type UserSupportMode = 'help_me_choose' | 'stay_on_track';

const getPersonalizationEventCount = (
  eventSummary: PersonalizationEventSummary | undefined,
  eventName:
    | 'goal_navigator_opened'
    | 'goal_fit_detail_opened'
    | 'compare_opened'
    | 'control_selected'
    | 'schedule_edited'
    | 'reminder_disabled'
    | 'save_then_unsave'
    | 'first_stack_accepted',
) => eventSummary?.countsByEventName[eventName] ?? 0;

export const getUserSupportMode = (supportState: SupportState): UserSupportMode =>
  supportState === 'install' || supportState === 'stabilize' || supportState === 'optimize'
    ? 'stay_on_track'
    : 'help_me_choose';

export const buildUserSupportSurface = (input: {
  supportState: SupportState;
  goalLabel: string;
  scheduleDefaults: ScheduleDefaultsPersonalizationVM;
  eventSummary?: PersonalizationEventSummary;
}) => {
  const mode = getUserSupportMode(input.supportState);
  const anchorLabel = input.scheduleDefaults.suggestedTimingAnchors[0]
    ? getTimingAnchorDisplayLabel(input.scheduleDefaults.suggestedTimingAnchors[0])
    : null;
  const decisionOpenCount =
    getPersonalizationEventCount(input.eventSummary, 'goal_navigator_opened') +
    getPersonalizationEventCount(input.eventSummary, 'goal_fit_detail_opened') +
    getPersonalizationEventCount(input.eventSummary, 'compare_opened');
  const reminderDisabledCount = getPersonalizationEventCount(input.eventSummary, 'reminder_disabled');

  if (mode === 'help_me_choose') {
    if (decisionOpenCount >= 2) {
      return {
        mode,
        title: 'Help me choose',
        body: `Start with the clearest picks for ${input.goalLabel}. Open See differences only if you still feel unsure.`,
      };
    }

    return {
      mode,
      title: 'Help me choose',
      body: `Start with the clearest picks for ${input.goalLabel}. Refine only if you want a different kind of result.`,
    };
  }

  if (input.supportState === 'optimize') {
    return {
      mode,
      title: 'Stay on track',
      body: 'Keep what is already working. Only fine-tune when your routine starts to feel off.',
    };
  }

  if (reminderDisabledCount > 0) {
    return {
      mode,
      title: 'Stay on track',
      body: anchorLabel
        ? `Keep it light. Use ${anchorLabel.toLowerCase()} as your main anchor and skip extra nudges for now.`
        : 'Keep it light. Stick to one simple daily anchor and skip extra nudges for now.',
    };
  }

  if (anchorLabel && input.scheduleDefaults.reminderPriority === 'high') {
    return {
      mode,
      title: 'Stay on track',
      body: `Use one ${anchorLabel.toLowerCase()} reminder so this is easier to follow through.`,
    };
  }

  if (anchorLabel) {
    return {
      mode,
      title: 'Stay on track',
      body: `Use ${anchorLabel.toLowerCase()} as your main anchor this week.`,
    };
  }

  return {
    mode,
    title: 'Stay on track',
    body: 'Keep this simple with one steady daily step.',
  };
};

export const buildHomeSupportSurface = (input: {
  supportState: SupportState;
  goalLabel: string;
  scheduleDefaults: ScheduleDefaultsPersonalizationVM;
  eventSummary?: PersonalizationEventSummary;
  hasSavedSupplements: boolean;
}) => {
  const base = buildUserSupportSurface(input);
  const anchorLabel = input.scheduleDefaults.suggestedTimingAnchors[0]
    ? getTimingAnchorDisplayLabel(input.scheduleDefaults.suggestedTimingAnchors[0])
    : null;

  if (input.hasSavedSupplements) {
    return base;
  }

  if (base.mode === 'help_me_choose') {
    return {
      ...base,
      body: `Add your first supplement to see the clearest picks for ${input.goalLabel}.`,
    };
  }

  if (anchorLabel) {
    return {
      ...base,
      body: `Add your first supplement to set one simple ${anchorLabel.toLowerCase()} reminder for ${input.goalLabel}.`,
    };
  }

  return {
    ...base,
    body: `Add your first supplement to start one simple routine for ${input.goalLabel}.`,
  };
};

export const getDecisionModeDisplayLabel = (decisionMode: PreferenceVector["decisionMode"]) => {
  switch (decisionMode) {
    case "simpler":
      return "More simple";
    case "strong_only":
      return "Strong only";
    case "better_disclosure":
      return "Better disclosure";
    case "low_overlap":
      return "Low overlap";
    case "best_fit":
    default:
      return "Best fit";
  }
};

export const getNotificationToleranceDisplayLabel = (
  notificationTolerance: PreferenceVector["notificationTolerance"],
) => {
  switch (notificationTolerance) {
    case "low":
      return "Low reminders";
    case "high":
      return "High reminders";
    case "medium":
    default:
      return "Balanced reminders";
  }
};
