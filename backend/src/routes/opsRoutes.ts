import type { Express, Request, Response } from "express";

export type OpsRoutesDependencies = {
  getMetricsSnapshot: () => unknown;
  env?: NodeJS.ProcessEnv;
  uptimeSec?: () => number;
};

export const registerOpsRoutes = (app: Express, deps: OpsRoutesDependencies): void => {
  const env = deps.env ?? process.env;
  const getUptimeSec = deps.uptimeSec ?? (() => Math.round(process.uptime()));

  app.get("/internal/metrics", (_req: Request, res: Response) => {
    res.json(deps.getMetricsSnapshot());
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
