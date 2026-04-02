import type {
  ExplanationResult,
  ExplanationSurface,
  PersonalizationSnapshot,
} from "../../../types/personalization.js";
import { createSnapshotExplanationService } from "./snapshotService.js";

type RouteRequest = {
  body?: {
    snapshot?: PersonalizationSnapshot;
    surface?: ExplanationSurface;
  };
};

type RouteResponse = {
  status(code: number): RouteResponse;
  json(payload: unknown): void;
};

const ALLOWED_SURFACES = new Set<ExplanationSurface>([
  "plan_preview",
  "first_stack",
  "goal_fit_detail",
  "product_compare",
  "weekly_insight",
]);

export const createPersonalizationExplanationRouteHandlers = () => {
  const service = createSnapshotExplanationService();

  return {
    explain: async (req: RouteRequest, res: RouteResponse): Promise<void> => {
      const snapshot = req.body?.snapshot;
      const surface = req.body?.surface;

      if (!snapshot || !surface || !ALLOWED_SURFACES.has(surface)) {
        res.status(400).json({
          error: "invalid_personalization_explanation_request",
        });
        return;
      }

      const { payload, result } = await service.explain(snapshot, surface);
      res.status(200).json({ payload, result });
    },
  };
};
