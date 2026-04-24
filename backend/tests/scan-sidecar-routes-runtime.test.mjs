import assert from "node:assert/strict";
import { test } from "node:test";

import { registerScanSidecarRoutes } from "../src/routes/scanSidecarRoutes.ts";

const createFakeApp = () => {
  const routes = new Map();
  return {
    routes,
    post(path, ...handlers) {
      routes.set(path, handlers);
    },
  };
};

const createJsonResponse = () => {
  const calls = [];
  return {
    calls,
    headers: {},
    setHeader(name, value) {
      this.headers[name] = value;
    },
    json(payload) {
      calls.push(payload);
      return this;
    },
  };
};

const createBaseDeps = (parsedBody) => ({
  verifySupabaseToken: (_req, _res, next) => next(),
  parseRequestBody: () => parsedBody,
  applyLegacyShadowHeaders: () => "regression",
  isRegressionRequest: () => true,
  captureException: () => {},
  deepseekBreaker: {
    canRequest: () => true,
    recordSuccess: () => {},
    recordFailure: () => {},
  },
  deepseekSemaphore: {
    acquire: async () => () => {},
  },
  mySupplementOverviewTimeoutMs: 4000,
  detailQueueTimeoutMs: 1500,
  env: {},
  now: () => 1000,
});

const getRouteHandler = (app, path) => {
  const handlers = app.routes.get(path);
  assert.ok(Array.isArray(handlers), `missing route handlers for ${path}`);
  assert.equal(handlers.length, 2);
  return handlers[1];
};

test("scan sidecar module registers deferred sidecar routes", () => {
  const app = createFakeApp();
  registerScanSidecarRoutes(app, createBaseDeps(null));

  assert.deepEqual([...app.routes.keys()].sort(), [
    "/api/product-overview-ai/v1",
    "/api/summary/ingredient",
    "/api/summary/safety",
    "/api/summary/usage",
  ]);
});

test("product overview sidecar returns fallback when ai is not configured", async () => {
  const app = createFakeApp();
  registerScanSidecarRoutes(app, createBaseDeps({
    digest: "digest-1",
    productName: "Example Magnesium",
    brandName: "Example",
    productTypeHint: "magnesium supplement",
    primaryIngredient: "Magnesium glycinate",
    keyIngredients: [{ name: "Magnesium glycinate", dose: "200 mg" }],
    sourceContextHint: null,
    chemicalFormHint: "glycinate",
    allIngredientRows: [{ name: "Magnesium glycinate", dose: "200 mg" }],
    descriptionHighlights: [],
    warningHighlights: [],
    strengthClaim: null,
    servingStrength: null,
    form: "capsule",
    count: "120",
    isLikelySingleIngredient: true,
  }));

  const res = createJsonResponse();
  await getRouteHandler(app, "/api/product-overview-ai/v1")({ query: {}, headers: {} }, res);

  assert.equal(res.calls.length, 1);
  assert.equal(res.calls[0].status, "ok");
  assert.equal(res.calls[0].digest, "digest-1");
  assert.equal(res.calls[0].source, "fallback");
  assert.equal(res.calls[0].fallbackUsed, true);
  assert.equal(res.calls[0].fallbackReason, "ai_not_configured");
  assert.ok(res.calls[0].overviewAi);
});
