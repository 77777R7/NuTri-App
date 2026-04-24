import assert from "node:assert/strict";
import { test } from "node:test";

import { registerScienceSidecarRoutes } from "../src/routes/scienceSidecarRoutes.ts";

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
    statusCode: 200,
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(payload) {
      calls.push(payload);
      return this;
    },
  };
};

const createBaseDeps = (parsedBody, overrides = {}) => ({
  verifySupabaseToken: (_req, _res, next) => next(),
  parseRequestBody: () => parsedBody,
  buildDecisionSupportAuthorityBundle: async () => ({
    decisionSupport: {
      digest: "digest-1",
      decisionInputsHash: "inputs-1",
    },
    personalizationScopeHash: "scope-1",
    ingredientScienceContext: {
      productName: "Example Magnesium",
      productArchetype: "standard_supplement",
      ingredientSourceTier: "official_record",
      sourceType: "other",
      ingredientRows: [],
      ingredientSnapshotNames: [],
      ingredientDescriptors: [],
      formulaMode: "single_ingredient",
      ingredientFamily: "magnesium",
      anchorIngredient: null,
      coIngredients: [],
      relationshipCandidates: [],
      labelConstraints: {
        hasOpaqueBlend: false,
        ingredientDisclosureLimited: false,
      },
    },
  }),
  buildDecisionSupportDigestMismatchPayload: (latestDigest, latestDecisionInputsHash, latestPersonalizationScopeHash) => ({
    error: "DECISION_SUPPORT_DIGEST_MISMATCH",
    latestDigest,
    latestDecisionInputsHash,
    latestPersonalizationScopeHash,
  }),
  captureException: () => {},
  env: {},
  now: () => 1000,
  ...overrides,
});

const getRouteHandler = (app, path) => {
  const handlers = app.routes.get(path);
  assert.ok(Array.isArray(handlers), `missing route handlers for ${path}`);
  assert.equal(handlers.length, 2);
  return handlers[1];
};

test("science sidecar module registers overview and scientific background routes", () => {
  const app = createFakeApp();
  registerScienceSidecarRoutes(app, createBaseDeps(null));

  assert.deepEqual([...app.routes.keys()].sort(), [
    "/api/ingredient-overview/v1",
    "/api/scientific-background/v1",
  ]);
});

test("ingredient overview route rejects invalid barcode before authority lookup", async () => {
  let authorityCalls = 0;
  const app = createFakeApp();
  registerScienceSidecarRoutes(app, createBaseDeps({
    barcode: "not-a-barcode",
    revalidateFallback: false,
  }, {
    buildDecisionSupportAuthorityBundle: async () => {
      authorityCalls += 1;
      throw new Error("should_not_lookup_authority");
    },
  }));

  const res = createJsonResponse();
  await getRouteHandler(app, "/api/ingredient-overview/v1")({ headers: {} }, res);

  assert.equal(authorityCalls, 0);
  assert.equal(res.statusCode, 400);
  assert.deepEqual(res.calls[0], {
    error: "invalid_request",
    detail: "barcode is required",
  });
});

test("scientific background route preserves selected ingredient contract", async () => {
  const app = createFakeApp();
  registerScienceSidecarRoutes(app, createBaseDeps({
    barcode: "00000000012345",
    selectedIngredientName: "Magnesium glycinate",
    decisionDigest: "digest-1",
    decisionInputsHash: "inputs-1",
    personalizationScopeHash: "scope-1",
    revalidateFallback: false,
  }));

  const res = createJsonResponse();
  await getRouteHandler(app, "/api/scientific-background/v1")({ headers: {} }, res);

  assert.equal(res.statusCode, 400);
  assert.deepEqual(res.calls[0], {
    error: "invalid_request",
    detail: "selectedIngredientName must match a source-locked ingredient",
  });
});
