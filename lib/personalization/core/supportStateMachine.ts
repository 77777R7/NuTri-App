import supportStateRulesData from "@/data/personalization/support_state_rules.v1.json";
import type {
  DecisionReason,
  FeedbackState,
  PersonalizationEventSummary,
  PersonalizationProfile,
  SupportState,
} from "@/types/personalization";

type SupportStateRulesFile = {
  version: string;
  thresholds: {
    installSavedStackCount: number;
    stabilizeSavedStackCount: number;
    optimizeSavedStackCount: number;
    stabilizeStreakDays: number;
  };
  chooseBlockers: string[];
};

type CompileSupportStateInput = {
  profile: PersonalizationProfile;
  feedbackState?: FeedbackState;
  eventSummary?: PersonalizationEventSummary;
};

export type CompiledSupportState = {
  supportState: SupportState;
  reasons: DecisionReason[];
};

const SUPPORT_STATE_RULES = supportStateRulesData as SupportStateRulesFile;

const buildReason = (
  code: string,
  params?: DecisionReason["params"],
): DecisionReason => ({
  code,
  ruleId: "personalization.support_state.v1",
  source: "derived",
  ...(params ? { params } : {}),
});

const hasScheduleCustomization = (feedbackState?: FeedbackState) =>
  (feedbackState?.events ?? []).some(
    (event) =>
      event.surface === "schedule_defaults" &&
      (event.field === "suggestedTimingAnchors" ||
        event.field === "preferScheduleSetup" ||
        event.field === "reminderPriority"),
  );

const hasFirstStackAcceptance = (feedbackState?: FeedbackState) =>
  (feedbackState?.events ?? []).some(
    (event) => event.surface === "first_stack" && event.action === "accept",
  );

const hasGoalFitSteering = (feedbackState?: FeedbackState) => {
  const controls = feedbackState?.overrides.controls;
  return Boolean(
    (controls?.decisionMode && controls.decisionMode !== "best_fit") ||
      (controls?.explanationStyle && controls.explanationStyle !== "brief"),
  );
};

const getEventCount = (
  eventSummary: PersonalizationEventSummary | undefined,
  eventName:
    | "goal_navigator_opened"
    | "goal_fit_detail_opened"
    | "compare_opened"
    | "control_selected"
    | "schedule_edited"
    | "reminder_disabled"
    | "save_then_unsave"
    | "first_stack_accepted",
) => eventSummary?.countsByEventName[eventName] ?? 0;

const hasRecentDecisionResearch = (eventSummary?: PersonalizationEventSummary) =>
  getEventCount(eventSummary, "goal_navigator_opened") +
    getEventCount(eventSummary, "goal_fit_detail_opened") +
    getEventCount(eventSummary, "compare_opened") >=
  2;

const hasRecentInstallProgress = (eventSummary?: PersonalizationEventSummary) =>
  getEventCount(eventSummary, "first_stack_accepted") > 0 ||
  getEventCount(eventSummary, "schedule_edited") > 0;

const hasRecentReminderPushback = (eventSummary?: PersonalizationEventSummary) =>
  getEventCount(eventSummary, "reminder_disabled") > 0;

const hasRecentSaveInstability = (eventSummary?: PersonalizationEventSummary) =>
  getEventCount(eventSummary, "save_then_unsave") > 0;

export const compileSupportState = (input: CompileSupportStateInput): CompiledSupportState => {
  const { profile, feedbackState, eventSummary } = input;
  const thresholds = SUPPORT_STATE_RULES.thresholds;
  const savedStackCount = profile.observed.savedStackCount ?? 0;
  const currentStreak = profile.observed.currentStreak ?? 0;
  const blocker = profile.declared.adherenceBlocker;
  const consistencyLevel = profile.observed.consistencyLevel;
  const scheduleCustomized =
    hasScheduleCustomization(feedbackState) || getEventCount(eventSummary, "schedule_edited") > 0;
  const firstStackAccepted =
    hasFirstStackAcceptance(feedbackState) || getEventCount(eventSummary, "first_stack_accepted") > 0;
  const decisionResearching = hasRecentDecisionResearch(eventSummary);
  const saveInstability = hasRecentSaveInstability(eventSummary);

  if (
    consistencyLevel === "high" &&
    savedStackCount >= thresholds.optimizeSavedStackCount
  ) {
    return {
      supportState: "optimize",
      reasons: [
        buildReason("support_state_optimize", {
          consistencyLevel,
          savedStackCount,
        }),
      ],
    };
  }

  if (
    savedStackCount >= thresholds.stabilizeSavedStackCount ||
    currentStreak >= thresholds.stabilizeStreakDays
  ) {
    return {
      supportState: "stabilize",
      reasons: [
        buildReason("support_state_stabilize", {
          currentStreak,
          savedStackCount,
        }),
      ],
    };
  }

  if (
    firstStackAccepted ||
    scheduleCustomized ||
    hasRecentInstallProgress(eventSummary) ||
    savedStackCount >= thresholds.installSavedStackCount
  ) {
    return {
      supportState: "install",
      reasons: [
        buildReason("support_state_install", {
          savedStackCount,
          scheduleCustomized,
          firstStackAccepted,
          reminderPushback: hasRecentReminderPushback(eventSummary),
        }),
      ],
    };
  }

  if (
    (blocker && SUPPORT_STATE_RULES.chooseBlockers.includes(blocker)) ||
    hasGoalFitSteering(feedbackState) ||
    decisionResearching ||
    saveInstability
  ) {
    return {
      supportState: "choose",
      reasons: [
        buildReason("support_state_choose", {
          blocker: blocker ?? "none",
          goalFitSteering: hasGoalFitSteering(feedbackState),
          compareOpenCount: getEventCount(eventSummary, "compare_opened"),
          detailOpenCount: getEventCount(eventSummary, "goal_fit_detail_opened"),
          saveInstability,
        }),
      ],
    };
  }

  return {
    supportState: "explore",
    reasons: [
      buildReason("support_state_explore", {
        savedStackCount,
      }),
    ],
  };
};

export const supportStateMachineInternals = {
  hasFirstStackAcceptance,
  hasGoalFitSteering,
  hasRecentDecisionResearch,
  hasRecentInstallProgress,
  hasRecentReminderPushback,
  hasRecentSaveInstability,
  hasScheduleCustomization,
  getEventCount,
  SUPPORT_STATE_RULES,
};
