import {
  readLatestGoalNavigatorBundleDebugSnapshot,
  type GoalNavigatorBundleDebugSnapshot,
} from "./goalNavigatorBundleRepository.js";
import { goalNavigatorCatalogEvaluationServiceInternals } from "./catalogEvaluationService.js";
import type { GoalNavigatorBundleObservabilitySnapshot } from "./goalNavigatorBundleObservability.js";

type RouteRequest = {
  query?: {
    limit?: string | string[];
  };
};

type RouteResponse = {
  status(code: number): RouteResponse;
  json(payload: unknown): void;
};

export type GoalNavigatorDebugService = {
  readLatestSnapshot(input?: { limit?: number }): Promise<GoalNavigatorBundleDebugSnapshot>;
  readRuntimeSnapshot(): GoalNavigatorBundleObservabilitySnapshot;
};

const parseLimit = (value: string | string[] | undefined): number | null => {
  const raw = Array.isArray(value) ? value[0] : value;
  if (raw == null || raw === "") return 25;

  const parsed = Number.parseInt(raw, 10);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return null;
  }

  return Math.min(100, parsed);
};

export const createGoalNavigatorDebugRouteHandlers = (
  service: GoalNavigatorDebugService = {
    readLatestSnapshot: readLatestGoalNavigatorBundleDebugSnapshot,
    readRuntimeSnapshot:
      goalNavigatorCatalogEvaluationServiceInternals.getGoalNavigatorBundleObservabilitySnapshot,
  },
) => {
  return {
    bundleDebug: async (req: RouteRequest, res: RouteResponse): Promise<void> => {
      const limit = parseLimit(req.query?.limit);
      if (limit == null) {
        res.status(400).json({
          error: "invalid_goal_navigator_debug_request",
        });
        return;
      }

      const snapshot = await service.readLatestSnapshot({ limit });
      res.status(200).json({
        ...snapshot,
        runtime: service.readRuntimeSnapshot(),
      });
    },
  };
};

export const goalNavigatorDebugRouteInternals = {
  parseLimit,
};
