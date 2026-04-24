import {
  recordMetricTiming,
  recordSidecarMetric,
} from "./metrics.js";
import {
  getScanSidecarPolicy,
  type ScanSidecarRoute,
} from "./scanSidecarPolicy.js";

export const resolveScanSidecarRouteForPath = (path: string): ScanSidecarRoute | null => {
  if (path === "/api/decision-support/v1") return "decision_support";
  if (path.startsWith("/api/scan-facts/v1/")) return "scan_facts";
  if (path === "/api/ingredient-overview/v1") return "ingredient_overview";
  if (path === "/api/scientific-background/v1") return "scientific_background";
  if (path === "/api/product-overview-ai/v1") return "product_overview_ai";
  if (path === "/api/summary/safety") return "summary_safety";
  return null;
};

export const recordScanSidecarRouteTiming = (route: ScanSidecarRoute, durationMs: number): void => {
  const policy = getScanSidecarPolicy(route);
  recordSidecarMetric({
    route,
    priority: policy.priority,
    latencyMs: durationMs,
    fetched: true,
  });
};

export const recordScanSidecarCacheStatus = (
  route: ScanSidecarRoute,
  cacheStatus: "hit" | "miss" | "stale" | "write" | "bypass",
): void => {
  const policy = getScanSidecarPolicy(route);
  recordSidecarMetric({
    route,
    priority: policy.priority,
    cacheStatus,
  });
};

export const recordKnownScanSidecarRouteTimings = (params: {
  path: string;
  durationMs: number;
}): void => {
  const sidecarRoute = resolveScanSidecarRouteForPath(params.path);
  if (sidecarRoute) {
    recordScanSidecarRouteTiming(sidecarRoute, params.durationMs);
  }
  if (params.path === "/api/ingredient-overview/v1") {
    recordMetricTiming("ingredient_overview_ms", params.durationMs);
    return;
  }
  if (params.path === "/api/scientific-background/v1") {
    recordMetricTiming("scientific_background_ms", params.durationMs);
  }
};

