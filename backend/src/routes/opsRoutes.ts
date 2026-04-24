import type { Express, Request, Response } from "express";

export type OpsRoutesDependencies = {
  getMetricsSnapshot: () => unknown;
  recordScanUxMetric?: (params: {
    event: string;
    elapsedMs?: number;
    count?: number;
  }) => void;
  env?: NodeJS.ProcessEnv;
  uptimeSec?: () => number;
};

export const registerOpsRoutes = (app: Express, deps: OpsRoutesDependencies): void => {
  const env = deps.env ?? process.env;
  const getUptimeSec = deps.uptimeSec ?? (() => Math.round(process.uptime()));

  app.get("/internal/metrics", (_req: Request, res: Response) => {
    res.json(deps.getMetricsSnapshot());
  });

  app.post("/api/scan-ux-metrics", (req: Request, res: Response) => {
    const body = req.body && typeof req.body === "object"
      ? req.body as Record<string, unknown>
      : {};
    const payload = body.payload && typeof body.payload === "object"
      ? body.payload as Record<string, unknown>
      : body;
    const event = typeof body.event === "string"
      ? body.event
      : typeof payload.event === "string"
        ? payload.event
        : "";
    deps.recordScanUxMetric?.({
      event,
      elapsedMs: typeof payload.elapsedMs === "number" ? payload.elapsedMs : Number(payload.elapsedMs),
      count: typeof payload.count === "number" ? payload.count : Number(payload.count),
    });
    res.status(204).end();
  });

  app.get("/health", (_req: Request, res: Response) => {
    const googleCseConfigured = Boolean(env.GOOGLE_CSE_API_KEY && env.GOOGLE_CSE_CX);
    const deepseekConfigured = Boolean(env.DEEPSEEK_API_KEY);

    res.json({
      status: "ok",
      uptimeSec: getUptimeSec(),
      configured: {
        googleCse: googleCseConfigured,
        deepseek: deepseekConfigured,
      },
    });
  });
};
