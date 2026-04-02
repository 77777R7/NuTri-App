"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.goalConfidenceProfileInternals = exports.getConservativeReviewGoals = exports.getGoalNavigatorEnabledGoals = exports.isGoalNavigatorEnabled = exports.getGoalConfidenceProfile = void 0;
const goal_confidence_profiles_v1_json_1 = __importDefault(require("@/data/personalization/goal_confidence_profiles.v1.json"));
const GOAL_CONFIDENCE_PROFILES = goal_confidence_profiles_v1_json_1.default;
const GOAL_PROFILE_BY_KEY = new Map(GOAL_CONFIDENCE_PROFILES.goals.map((entry) => [entry.goalKey, entry]));
const getGoalConfidenceProfile = (goalKey) => GOAL_PROFILE_BY_KEY.get(goalKey) ?? null;
exports.getGoalConfidenceProfile = getGoalConfidenceProfile;
const isGoalNavigatorEnabled = (goalKey) => (0, exports.getGoalConfidenceProfile)(goalKey)?.goalNavigatorEnabled ?? false;
exports.isGoalNavigatorEnabled = isGoalNavigatorEnabled;
const getGoalNavigatorEnabledGoals = (goals) => (goals ?? GOAL_CONFIDENCE_PROFILES.goals.map((entry) => entry.goalKey)).filter(exports.isGoalNavigatorEnabled);
exports.getGoalNavigatorEnabledGoals = getGoalNavigatorEnabledGoals;
const getConservativeReviewGoals = (goals) => (goals ?? GOAL_CONFIDENCE_PROFILES.goals.map((entry) => entry.goalKey)).filter((goalKey) => !(0, exports.isGoalNavigatorEnabled)(goalKey));
exports.getConservativeReviewGoals = getConservativeReviewGoals;
exports.goalConfidenceProfileInternals = {
    GOAL_CONFIDENCE_PROFILES,
};
