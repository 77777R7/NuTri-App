import activityGoalMapData from "@/data/personalization/activity_goal_map.v1.json";
import blockerBehaviorRulesData from "@/data/personalization/blocker_behavior_rules.v1.json";
import dietLaneMapData from "@/data/personalization/diet_nutrient_lane_map.v1.json";
import { getGoalLabel } from "@/lib/personalization/core/goalCatalog";
import type {
  BlockerKey,
  BlockerStrategy,
  FirstStackPlanItem,
  GoalKey,
  PlanPreviewPersonalizationVM,
  PreferenceVector,
  ScheduleDefaultsPersonalizationVM,
  SupportState,
  SupplementTypeKey,
} from "@/types/personalization";

type DietLaneMapFile = {
  laneCatalog: Array<{
    laneKey: string;
    label: string;
  }>;
};

type ActivityGoalMapFile = {
  activityMappings: Array<{
    suggestedTimingAnchors: string[];
  }>;
};

type BlockerRulesFile = {
  blockerStrategies: Array<{
    key: BlockerKey;
    onboardingLabel: string;
  }>;
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
      return "High reminder support";
    case "low":
      return "Light reminder support";
    default:
      return "Balanced reminder support";
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
    case "check_in":
      return "We will put Daily Check-in and consistency cues first so the habit feels easier to keep.";
    case "optimization":
      return "We will keep personalization light and focus on fine-tuning what already works for you.";
    case "reminder":
    default:
      return "We will help you anchor reminders early so busy days do not knock your plan off course.";
  }
};

export const buildScheduleDefaultsSummary = (scheduleDefaults: ScheduleDefaultsPersonalizationVM) => {
  const anchorLabel = scheduleDefaults.suggestedTimingAnchors[0]
    ? getTimingAnchorDisplayLabel(scheduleDefaults.suggestedTimingAnchors[0])
    : null;

  if (scheduleDefaults.preferScheduleSetup && anchorLabel) {
    return `Recommended: set this up now and anchor it to ${anchorLabel}.`;
  }

  if (scheduleDefaults.preferScheduleSetup) {
    return "Recommended: set this up now so Daily Check-in can stay accurate.";
  }

  if (anchorLabel) {
    return `Suggested anchor: ${anchorLabel}.`;
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
