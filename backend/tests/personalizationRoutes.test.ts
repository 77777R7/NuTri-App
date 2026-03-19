import assert from "node:assert/strict";
import { test } from "node:test";

import type { PersonalizationSnapshot } from "../../types/personalization";
import { createPersonalizationExplanationRouteHandlers } from "../src/personalization/routes";

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

const SNAPSHOT: PersonalizationSnapshot = {
  snapshotId: "psn_route_test",
  rulesVersion: "personalization-rules/v1-phase3",
  computedAt: "2026-03-18T22:00:00.000Z",
  profile: {
    declared: {
      goals: [{ key: "sleep", priority: 100 }],
      preferredTypes: ["vitamin"],
      adherenceBlocker: "busy_day_forgetfulness",
      supplementExperience: "brand_new",
    },
    observed: {
      currentStreak: 0,
      consistencyLevel: "low",
      savedStackCount: 0,
      duplicateRisk: {
        level: "none",
        ingredientKeys: [],
      },
    },
    derived: {
      dietReviewLanes: [],
      activityPlanKeys: [],
      blockerMode: "reminder_first",
    },
    meta: {
      profileVersion: "personalization-profile/v1-phase1",
      computedAt: "2026-03-18T22:00:00.000Z",
    },
  },
  strategies: {
    blocker: {
      reminderPriority: "high",
      scheduleComplexity: "simple",
      notificationBudget: "heavy",
      emphasizeHomeCheckIn: true,
      emphasizeScheduleSetup: true,
      emphasizeExplanation: true,
    },
    experience: {
      explanationDepth: "simple",
      uiDensity: "minimal",
      showAdvancedSafety: false,
      showDetailedForms: false,
    },
    dietLanes: [],
    activityPlan: {
      suggestedGoals: [],
      suggestedTypes: [],
      suggestedTimingAnchors: ["breakfast"],
      reasons: [],
    },
  },
  evaluations: {
    productGoalMatches: {},
    eligibility: {},
    firstStackPlan: {
      items: [
        {
          productId: "omega_3_fish_oil",
          role: "foundation",
          reasons: [
            {
              code: "personalization.first_stack.foundation_selected",
              ruleId: "personalization.evaluation.first_stack",
              source: "derived",
              params: { supportedGoals: "sleep" },
            },
          ],
        },
      ],
      scheduleTemplateKey: "phase3_simple_template",
      explanationFacts: [],
    },
  },
  surfaces: {
    home: {
      emphasizedModules: ["home_check_in", "plan_preview"],
      prioritizedGoals: ["sleep"],
      tipLaneKeys: [],
      reasons: [],
    },
    smartFilter: {
      visibleGoals: ["sleep"],
      preselectedTypes: ["vitamin"],
      highlightedGoal: "sleep",
      reasons: [],
    },
    planPreview: {
      goals: ["sleep"],
      types: ["vitamin"],
      blockerStrategy: {
        reminderPriority: "high",
        scheduleComplexity: "simple",
        notificationBudget: "heavy",
        emphasizeHomeCheckIn: true,
        emphasizeScheduleSetup: true,
        emphasizeExplanation: true,
      },
      dietLanes: [],
      activityAnchors: ["breakfast"],
      reasons: [],
    },
    scheduleDefaults: {
      reminderPriority: "high",
      suggestedTimingAnchors: ["breakfast"],
      preferScheduleSetup: true,
      reasons: [],
    },
  },
  trace: [],
};

test("personalization explanation route rejects invalid requests", async () => {
  const handlers = createPersonalizationExplanationRouteHandlers();
  const response = buildResponseDouble();

  await handlers.explain({ body: { surface: "plan_preview" } }, response);

  assert.equal(response.statusCode, 400);
  assert.deepEqual(response.payload, {
    error: "invalid_personalization_explanation_request",
  });
});

test("personalization explanation route returns deterministic explanation payload from snapshot input", async () => {
  const handlers = createPersonalizationExplanationRouteHandlers();
  const response = buildResponseDouble();

  await handlers.explain(
    {
      body: {
        snapshot: SNAPSHOT,
        surface: "plan_preview",
      },
    },
    response,
  );

  assert.equal(response.statusCode, 200);
  const payload = response.payload as {
    payload: { snapshotId: string; surface: string; facts: Array<{ code: string }> };
    result: { fallback: boolean; summary: string };
  };
  assert.equal(payload.payload.snapshotId, "psn_route_test");
  assert.equal(payload.payload.surface, "plan_preview");
  assert.equal(payload.result.fallback, true);
  assert.ok(payload.payload.facts.some((fact) => fact.code === "busy_day_blocker_mealtime_anchor"));
  assert.match(payload.result.summary, /sleep/i);
});

test("personalization explanation route returns structured first-stack facts without raw profile access", async () => {
  const handlers = createPersonalizationExplanationRouteHandlers();
  const response = buildResponseDouble();

  await handlers.explain(
    {
      body: {
        snapshot: SNAPSHOT,
        surface: "first_stack",
      },
    },
    response,
  );

  assert.equal(response.statusCode, 200);
  const payload = response.payload as {
    payload: {
      snapshotId: string;
      surface: string;
      firstStackPlan?: { items: Array<{ productId: string }> };
      facts: Array<{ code: string; params?: Record<string, unknown> }>;
    };
    result: { fallback: boolean; summary: string; bullets: string[] };
  };

  assert.equal(payload.payload.snapshotId, "psn_route_test");
  assert.equal(payload.payload.surface, "first_stack");
  assert.equal(payload.payload.firstStackPlan?.items.length, 1);
  assert.ok(payload.payload.facts.some((fact) => fact.code === "first_stack_item_highlight"));
  assert.match(payload.result.summary, /Omega 3 Fish Oil/i);
  assert.ok(payload.result.bullets.some((bullet) => /foundation support/i.test(bullet)));
});
