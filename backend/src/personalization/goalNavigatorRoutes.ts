import type {
  GoalKey,
  GoalNavigatorRequest,
  PreferenceVector,
  SupplementTypeKey,
} from "../../../types/personalization";
import {
  createGoalNavigatorCatalogEvaluationService,
  type GoalNavigatorCatalogEvaluationService,
} from "./catalogEvaluationService.js";
import { getGoalNavigatorEnabledGoals } from "../../../lib/personalization/core/goalConfidenceProfiles";

type RouteRequest = {
  body?: GoalNavigatorRequest;
};

type RouteResponse = {
  status(code: number): RouteResponse;
  json(payload: unknown): void;
};

const SUPPORTED_GOALS = new Set<GoalKey>(getGoalNavigatorEnabledGoals());

const isGoalKey = (value: unknown): value is GoalKey =>
  value === "sleep" ||
  value === "energy" ||
  value === "immunity" ||
  value === "recovery" ||
  value === "focus" ||
  value === "libido_enhancement" ||
  value === "stress_support" ||
  value === "weight_management";

const isSupplementTypeKey = (value: unknown): value is SupplementTypeKey =>
  value === "vitamin" ||
  value === "mineral" ||
  value === "herb" ||
  value === "probiotic" ||
  value === "protein";

const isPreferenceVector = (value: unknown): value is PreferenceVector => {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Record<string, unknown>;
  return (
    (candidate.decisionMode === "best_fit" ||
      candidate.decisionMode === "simpler" ||
      candidate.decisionMode === "strong_only" ||
      candidate.decisionMode === "better_disclosure" ||
      candidate.decisionMode === "low_overlap") &&
    (candidate.explanationStyle === "brief" ||
      candidate.explanationStyle === "compare" ||
      candidate.explanationStyle === "deep") &&
    (candidate.notificationTolerance === "low" ||
      candidate.notificationTolerance === "medium" ||
      candidate.notificationTolerance === "high")
  );
};

const toRequest = (body?: GoalNavigatorRequest): GoalNavigatorRequest | null => {
  const goalKey = body?.goalKey;
  if (!isGoalKey(goalKey) || !SUPPORTED_GOALS.has(goalKey)) {
    return null;
  }

  return {
    goalKey,
    preferredTypes: Array.isArray(body?.preferredTypes)
      ? body?.preferredTypes.filter(isSupplementTypeKey)
      : [],
    limit:
      typeof body?.limit === "number" && Number.isFinite(body.limit) && body.limit > 0
        ? Math.min(12, Math.round(body.limit))
        : undefined,
    snapshotId: typeof body?.snapshotId === "string" && body.snapshotId.trim()
      ? body.snapshotId.trim()
      : undefined,
    userContext: body?.userContext
      ? {
          duplicateRisk: body.userContext.duplicateRisk,
          supplementExperience: body.userContext.supplementExperience,
          ageRange: body.userContext.ageRange,
          adherenceBlocker: body.userContext.adherenceBlocker,
        }
      : undefined,
    preferenceVector: isPreferenceVector(body?.preferenceVector)
      ? body?.preferenceVector
      : undefined,
  };
};

export const createGoalNavigatorRouteHandlers = (
  service: GoalNavigatorCatalogEvaluationService = createGoalNavigatorCatalogEvaluationService(),
) => {

  return {
    goalNavigator: async (req: RouteRequest, res: RouteResponse): Promise<void> => {
      const request = toRequest(req.body);
      if (!request) {
        res.status(400).json({
          error: "invalid_goal_navigator_request",
        });
        return;
      }

      const response = await service.evaluateGoal(request);
      res.status(200).json(response);
    },
  };
};

export const goalNavigatorRouteInternals = {
  SUPPORTED_GOALS,
  toRequest,
};
