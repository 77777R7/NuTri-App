import assert from "node:assert/strict";
import { test } from "node:test";

import type { ExplanationPayload } from "../../types/personalization";
import {
  buildExplanationPayload,
  createPersonalizationExplanationService,
  renderDeterministicExplanation,
} from "../src/personalization/ai";
import { createDeepSeekPersonalizationExplainer } from "../src/personalization/explainers/deepseekExplainer";
import type { PersonalizationSnapshot } from "../../types/personalization";

const PLAN_PREVIEW_PAYLOAD: ExplanationPayload = {
  snapshotId: "psn_plan_preview",
  rulesVersion: "personalization-rules/v1-phase3",
  surface: "plan_preview",
  selectedGoals: ["sleep", "immunity"],
  selectedTypes: ["vitamin", "mineral"],
  facts: [{ factId: "busy", code: "busy_day_blocker_mealtime_anchor" }],
};

const PLAN_PREVIEW_SNAPSHOT: PersonalizationSnapshot = {
  snapshotId: "psn_plan_preview_service",
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
      primarySupportFocus: "reminder",
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
    supportState: "explore",
    preferenceVector: {
      decisionMode: "best_fit",
      explanationStyle: "brief",
      notificationTolerance: "medium",
    },
  },
  evaluations: {
    productGoalMatches: {},
    eligibility: {},
    firstStackPlan: {
      items: [],
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
        primarySupportFocus: "reminder",
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

test("renderDeterministicExplanation returns a stable plan-preview fallback from structured payload only", () => {
  const result = renderDeterministicExplanation(PLAN_PREVIEW_PAYLOAD);

  assert.equal(result.source, "deterministic");
  assert.equal(result.fallback, true);
  assert.match(result.summary, /sleep/i);
  assert.ok(result.summary.includes("Melatonin") || result.summary.includes("Vitamin C"));
  assert.ok(result.bullets.some((bullet) => /Melatonin|Vitamin C|Zinc/i.test(bullet)));
});

test("renderDeterministicExplanation keeps all selected plan-preview goals visible when many are chosen", () => {
  const result = renderDeterministicExplanation({
    ...PLAN_PREVIEW_PAYLOAD,
    snapshotId: "psn_plan_preview_many_goals",
    selectedGoals: [
      "energy",
      "immunity",
      "sleep",
      "recovery",
      "libido_enhancement",
      "focus",
    ],
    selectedTypes: ["mineral", "herb", "probiotic", "vitamin"],
  });

  assert.match(result.summary, /Energy/i);
  assert.match(result.summary, /Immunity/i);
  assert.match(result.summary, /Sleep/i);
  assert.match(result.summary, /Recovery/i);
  assert.match(result.summary, /Libido Enhancement/i);
  assert.match(result.summary, /Focus/i);
  assert.equal(result.bullets.length, 6);
  assert.ok(result.bullets.some((bullet) => /Energy/i.test(bullet)));
  assert.ok(result.bullets.some((bullet) => /Immunity/i.test(bullet)));
  assert.ok(result.bullets.some((bullet) => /Sleep/i.test(bullet)));
  assert.ok(result.bullets.some((bullet) => /Recovery/i.test(bullet)));
  assert.ok(result.bullets.some((bullet) => /Libido Enhancement/i.test(bullet)));
  assert.ok(result.bullets.some((bullet) => /Focus/i.test(bullet)));
});

test("renderDeterministicExplanation keeps goal-fit uncertainty explanation-first", () => {
  const result = renderDeterministicExplanation({
    ...PLAN_PREVIEW_PAYLOAD,
    snapshotId: "psn_goal_fit",
    selectedGoals: ["immunity"],
    selectedTypes: ["vitamin"],
    facts: [{ factId: "goal-fit", code: "goal_fit_uncertainty_explanation_first" }],
  });

  assert.match(result.summary, /immunity/i);
  assert.ok(result.bullets.some((bullet) => /fits your goals/i.test(bullet)));
});

test("DeepSeek personalization explainer falls back deterministically when no API key is available", async () => {
  const explainer = createDeepSeekPersonalizationExplainer({ apiKey: null });
  const result = await explainer.explain(PLAN_PREVIEW_PAYLOAD);

  assert.equal(result.source, "deterministic");
  assert.equal(result.fallback, true);
  assert.ok(result.bullets.length > 0);
});

test("DeepSeek personalization explainer falls back when the model response is invalid", async () => {
  const explainer = createDeepSeekPersonalizationExplainer({
    apiKey: "test-key",
    transport: async () => "not json",
  });

  const result = await explainer.explain(PLAN_PREVIEW_PAYLOAD);

  assert.equal(result.fallback, true);
  assert.equal(result.model, "deepseek-chat");
  assert.ok(result.summary.length > 0);
});

test("plan_preview explanation service stays deterministic even when an explainer is provided", async () => {
  const service = createPersonalizationExplanationService({
    explain: async () => ({
      source: "deepseek",
      fallback: false,
      summary: "should not be used",
      bullets: ["should not be used"],
      model: "deepseek-chat",
    }),
  });

  const { payload, result } = await service.explainSnapshot(PLAN_PREVIEW_SNAPSHOT, "plan_preview");
  const expected = renderDeterministicExplanation(buildExplanationPayload(PLAN_PREVIEW_SNAPSHOT, "plan_preview"));

  assert.equal(payload.surface, "plan_preview");
  assert.deepEqual(result, expected);
});
