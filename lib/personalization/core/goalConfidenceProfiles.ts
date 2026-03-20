import goalConfidenceProfilesData from "@/data/personalization/goal_confidence_profiles.v1.json";
import type { GoalKey } from "@/types/personalization";

type GoalConfidenceProfilesFile = {
  version: string;
  goals: Array<{
    goalKey: GoalKey;
    confidenceProfile: "core_confidence" | "conservative_review";
    goalNavigatorEnabled: boolean;
    coachTone: "standard" | "conservative";
  }>;
};

const GOAL_CONFIDENCE_PROFILES = goalConfidenceProfilesData as GoalConfidenceProfilesFile;

const GOAL_PROFILE_BY_KEY = new Map(
  GOAL_CONFIDENCE_PROFILES.goals.map((entry) => [entry.goalKey, entry] as const),
);

export const getGoalConfidenceProfile = (goalKey: GoalKey) => GOAL_PROFILE_BY_KEY.get(goalKey) ?? null;

export const isGoalNavigatorEnabled = (goalKey: GoalKey) =>
  getGoalConfidenceProfile(goalKey)?.goalNavigatorEnabled ?? false;

export const getGoalNavigatorEnabledGoals = (goals?: GoalKey[]) =>
  (goals ?? GOAL_CONFIDENCE_PROFILES.goals.map((entry) => entry.goalKey)).filter(isGoalNavigatorEnabled);

export const getConservativeReviewGoals = (goals?: GoalKey[]) =>
  (goals ?? GOAL_CONFIDENCE_PROFILES.goals.map((entry) => entry.goalKey)).filter(
    (goalKey) => !isGoalNavigatorEnabled(goalKey),
  );

export const goalConfidenceProfileInternals = {
  GOAL_CONFIDENCE_PROFILES,
};
