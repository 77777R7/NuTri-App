import assert from "node:assert/strict";
import test from "node:test";

import { createGoalNavigatorRouteHandlers } from "../src/personalization/goalNavigatorRoutes";

const buildResponseDouble = () => {
  const response = {
    statusCode: 200,
    payload: undefined as unknown,
    status(code: number) {
      response.statusCode = code;
      return response;
    },
    json(payload: unknown) {
      response.payload = payload;
    },
  };

  return response;
};

test("goal navigator route rejects unsupported goals", async () => {
  const handlers = createGoalNavigatorRouteHandlers({
    evaluateGoal: async () => {
      throw new Error("should not be called");
    },
  });
  const response = buildResponseDouble();

  await handlers.goalNavigator(
    {
      body: {
        goalKey: "weight_management",
      },
    },
    response,
  );

  assert.equal(response.statusCode, 400);
  assert.deepEqual(response.payload, {
    error: "invalid_goal_navigator_request",
  });
});

test("goal navigator route returns deterministic candidates from the injected catalog service", async () => {
  const handlers = createGoalNavigatorRouteHandlers({
    evaluateGoal: async (request) => ({
      goalKey: request.goalKey,
      rulesVersion: "personalization-rules/v1-phase7",
      preferredTypes: request.preferredTypes ?? [],
      candidates: [],
      fallback: {
        notEnoughStructuredDataCount: 3,
      },
      reasons: [],
    }),
  });
  const response = buildResponseDouble();

  await handlers.goalNavigator(
    {
      body: {
        goalKey: "immunity",
        preferredTypes: ["vitamin"],
        snapshotId: "psn_goal_nav",
      },
    },
    response,
  );

  assert.equal(response.statusCode, 200);
  assert.deepEqual(response.payload, {
    goalKey: "immunity",
    rulesVersion: "personalization-rules/v1-phase7",
    preferredTypes: ["vitamin"],
    candidates: [],
    fallback: {
      notEnoughStructuredDataCount: 3,
    },
    reasons: [],
  });
});
