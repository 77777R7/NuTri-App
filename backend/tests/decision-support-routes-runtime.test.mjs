import assert from "node:assert/strict";
import { test } from "node:test";

import { registerDecisionSupportRoutes } from "../src/routes/decisionSupportRoutes.ts";

const createFakeApp = () => {
  const routes = new Map();
  return {
    routes,
    get(path, ...handlers) {
      routes.set(path, handlers);
    },
  };
};

const createJsonResponse = () => {
  const calls = [];
  return {
    calls,
    statusCode: 200,
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(payload) {
      calls.push({ statusCode: this.statusCode, payload });
      return this;
    },
  };
};

const createBaseDeps = (overrides = {}) => ({
  verifySupabaseToken: (_req, _res, next) => next(),
  normalizeBarcodeInput: (value) => (value ? { code: value } : null),
  parseDecisionSupportViewMode: () => "details",
  parseDebugDecisionRequested: () => false,
  recordDecisionSupportFetch: () => 2,
  buildDecisionSupportAuthorityBundle: async () => ({
    overlayClaims: null,
    quickDigest: {
      factsDigestHash: "facts-hash",
      digest: {
        sourceType: "dsld",
        identity: { type: "dsldLabelId", value: "123" },
      },
    },
    patched: {
      digest: { sourceType: "dsld" },
      activation: { patchApplied: false },
    },
    decisionSupport: {
      digest: "latest-digest",
      decisionInputsHash: "latest-inputs",
      decisionContractVersion: "v1",
      personalizedResultLane: { recommendedSectionOrder: ["overview"] },
      verdict: "ok",
    },
    personalizationScopeHash: "scope-hash",
  }),
  buildDecisionSupportComparisonStanding: async () => ({ rank: "top_pick" }),
  buildDecisionSupportDigestMismatchPayload: (latestDigest, latestDecisionInputsHash, latestPersonalizationScopeHash) => ({
    error: "DECISION_SUPPORT_DIGEST_MISMATCH",
    latestDigest,
    latestDecisionInputsHash,
    latestPersonalizationScopeHash,
  }),
  getPatchShadowLookup: () => ({ found: false }),
  incrementMetric: () => {},
  allowDebugFields: () => false,
  captureException: () => {},
  ...overrides,
});

const getRouteHandler = (app) => {
  const handlers = app.routes.get("/api/decision-support/v1");
  assert.ok(Array.isArray(handlers), "missing decision support route handlers");
  assert.equal(handlers.length, 2);
  return handlers[1];
};

test("decision support route returns invalid_request before authority lookup", async () => {
  let authorityCalled = false;
  const app = createFakeApp();
  registerDecisionSupportRoutes(app, createBaseDeps({
    buildDecisionSupportAuthorityBundle: async () => {
      authorityCalled = true;
      throw new Error("should_not_call");
    },
  }));

  const res = createJsonResponse();
  await getRouteHandler(app)({ query: {}, headers: {} }, res);

  assert.equal(authorityCalled, false);
  assert.deepEqual(res.calls, [
    {
      statusCode: 400,
      payload: { error: "invalid_request", detail: "barcode is required" },
    },
  ]);
});

test("decision support route preserves digest mismatch response contract", async () => {
  const metrics = [];
  const app = createFakeApp();
  registerDecisionSupportRoutes(app, createBaseDeps({
    incrementMetric: (metricName) => metrics.push(metricName),
  }));

  const res = createJsonResponse();
  await getRouteHandler(app)({
    query: {
      barcode: "12345",
      digest: "stale-digest",
      decisionInputsHash: "stale-inputs",
    },
    headers: {},
  }, res);

  assert.deepEqual(metrics, ["decision_inputs_hash_mismatch", "decision_support_digest_mismatch"]);
  assert.deepEqual(res.calls, [
    {
      statusCode: 409,
      payload: {
        error: "DECISION_SUPPORT_DIGEST_MISMATCH",
        latestDigest: "latest-digest",
        latestDecisionInputsHash: "latest-inputs",
        latestPersonalizationScopeHash: "scope-hash",
      },
    },
  ]);
});

test("decision support route preserves ok payload and comparison enrichment", async () => {
  const app = createFakeApp();
  registerDecisionSupportRoutes(app, createBaseDeps());

  const res = createJsonResponse();
  await getRouteHandler(app)({
    query: {
      barcode: "12345",
      digest: "latest-digest",
      decisionInputsHash: "latest-inputs",
    },
    headers: {},
  }, res);

  assert.equal(res.calls.length, 1);
  assert.equal(res.calls[0].statusCode, 200);
  assert.equal(res.calls[0].payload.status, "ok");
  assert.equal(res.calls[0].payload.barcode, "00000000012345");
  assert.equal(res.calls[0].payload.decisionSupportDigest, "latest-digest");
  assert.equal(res.calls[0].payload.decisionSupportFetchCount, 2);
  assert.deepEqual(res.calls[0].payload.personalizedResultLane.productStanding, { rank: "top_pick" });
});
