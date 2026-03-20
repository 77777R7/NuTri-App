import supportStateRulesData from "@/data/personalization/support_state_rules.v1.json";
import type {
  DecisionReason,
  FeedbackState,
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

export const compileSupportState = (input: CompileSupportStateInput): CompiledSupportState => {
  const { profile, feedbackState } = input;
  const thresholds = SUPPORT_STATE_RULES.thresholds;
  const savedStackCount = profile.observed.savedStackCount ?? 0;
  const currentStreak = profile.observed.currentStreak ?? 0;
  const blocker = profile.declared.adherenceBlocker;
  const consistencyLevel = profile.observed.consistencyLevel;

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
    hasFirstStackAcceptance(feedbackState) ||
    hasScheduleCustomization(feedbackState) ||
    savedStackCount >= thresholds.installSavedStackCount
  ) {
    return {
      supportState: "install",
      reasons: [
        buildReason("support_state_install", {
          savedStackCount,
          scheduleCustomized: hasScheduleCustomization(feedbackState),
        }),
      ],
    };
  }

  if (
    (blocker && SUPPORT_STATE_RULES.chooseBlockers.includes(blocker)) ||
    hasGoalFitSteering(feedbackState)
  ) {
    return {
      supportState: "choose",
      reasons: [
        buildReason("support_state_choose", {
          blocker: blocker ?? "none",
          goalFitSteering: hasGoalFitSteering(feedbackState),
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
  hasScheduleCustomization,
  SUPPORT_STATE_RULES,
};
