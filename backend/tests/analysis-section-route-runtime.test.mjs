import assert from "node:assert/strict";
import { test } from "node:test";

import { registerAnalysisSectionRoute } from "../src/routes/analysisSectionRoute.ts";

const createFakeApp = () => {
  const routes = new Map();
  return {
    routes,
    post(path, ...handlers) {
      routes.set(path, handlers);
    },
  };
};

const createBaseDeps = () => ({
  verifySupabaseToken: (_req, _res, next) => next(),
  applyLegacyShadowHeaders: () => {},
  parseRequestBody: () => null,
  isRegressionRequest: () => false,
  config: {
    analysisDetailLimitDefault: 8,
    analysisDetailLimitMax: 12,
    analysisDetailLimitDsld: 6,
    analysisSectionDigestLookupTimeoutMs: 800,
    analysisDetailStaleMs: 120_000,
    analysisDetailErrorRetryMs: 30_000,
    analysisSectionRateLimitPerMinute: 30,
    analysisDetailLockMs: 30_000,
    analysisIdentityCacheTtlMs: 3_600_000,
    analysisDetailFallbackTtlMs: 90_000,
    analysisBundleDetailTimeoutMs: 12_000,
    analysisBundleDetailTimeoutMsDsld: 8_000,
    analysisDetailMaxTokens: 1200,
    analysisDetailMaxTokensDsld: 800,
    analysisDetailRescueMaxTokens: 900,
    analysisDetailRescueMaxTokensDsld: 650,
    analysisDetailLimitRescue: 4,
    resilienceDeepseekDsldMinQueueTimeoutMs: 600,
    resilienceDeepseekQueueTimeoutMsDetail: 1000,
  },
  supabase: {},
  getAnalysisIdentityCache: async () => null,
  insertAnalysisIdentityPending: async () => false,
  updateAnalysisIdentityCache: async () => false,
  upsertAnalysisIdentityCache: async () => false,
  withTimeoutPromise: (promise) => promise,
  isExpiredAt: () => false,
  safeParseAnalysisBundle: () => ({ success: false }),
  getKbRuntime: () => null,
  resolveDigestScoreMeta: () => ({ scoreAvailable: null, scoreReasonCode: null, inferenceOnly: false }),
  getScoreAvailableFromSourceType: () => null,
  buildFallbackOverviewSection: () => ({}),
  enforceOverviewSectionContract: (section) => section,
  buildFallbackUsageSection: () => ({}),
  buildIdentityFallbackOverviewSection: () => ({}),
  buildIdentityFallbackUsageSection: () => ({}),
  enforceUsageSectionContract: (section) => section,
  buildLabelDosingText: () => null,
  buildLnhpdIngredientsDetailKbFirst: () => ({ detail: { items: [] } }),
  buildDsldKbFallbackDetail: () => ({ detail: { items: [] } }),
  normalizeIngredientName: (value) => String(value ?? "").trim().toLowerCase(),
  applyWebIngredientsDetailEvidenceGate: (value) => ({ value, reasons: [] }),
  resolveFallbackUsed: () => null,
  resolveDsldWhatItDoesStatus: () => null,
  buildDetailSkeleton: () => ({ items: [] }),
  queueDsldDetailEnrichment: () => {},
  fetchIngredientsDetailV3: async () => null,
  deepseekBreaker: {},
  deepseekSemaphore: {},
  deepseekDsldMinimalSemaphore: {},
  sanitizeDetailDoseContext: (value) => value,
  applyFormExplainGuard: (value) => value,
  mergeDsldWhatItDoes: (value) => value,
  buildIngredientWhatItDoesFallback: () => ({ text: "Not provided by source.", basisTags: ["not_provided"] }),
});

test("analysis-section module registers route without touching enrich-stream", () => {
  const app = createFakeApp();
  registerAnalysisSectionRoute(app, createBaseDeps());

  assert.deepEqual([...app.routes.keys()], ["/api/analysis-section"]);
  const handlers = app.routes.get("/api/analysis-section");
  assert.equal(handlers.length, 2);
});
