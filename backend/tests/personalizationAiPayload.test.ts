import assert from "node:assert/strict";
import { test } from "node:test";

import type { PersonalizationSnapshot } from "../../types/personalization";
import { buildExplanationPayload } from "../src/personalization/ai";

test("buildExplanationPayload shapes a plan preview payload from snapshot-only facts", () => {
  const snapshot: PersonalizationSnapshot = {
    snapshotId: "psn_plan_preview",
    rulesVersion: "personalization-rules/v1-phase3",
    computedAt: "2026-03-18T16:00:00.000Z",
    profile: {
      declared: {
        goals: [
          { key: "sleep", priority: 90 },
          { key: "immunity", priority: 80 },
        ],
        preferredTypes: ["vitamin", "mineral"],
        adherenceBlocker: "busy_day_forgetfulness",
        supplementExperience: "brand_new",
        diets: ["vegan"],
        activity: ["general_fitness"],
      },
      observed: {
        currentStreak: 1,
        consistencyLevel: "low",
        savedStackCount: 0,
        duplicateRisk: {
          level: "none",
          ingredientKeys: [],
        },
      },
      derived: {
        dietReviewLanes: ["diet_vegan_support"],
        activityPlanKeys: ["activity_general_support"],
        blockerMode: "reminder_first",
      },
      meta: {
        profileVersion: "personalization-profile/v1-phase1",
        computedAt: "2026-03-18T16:00:00.000Z",
      },
    },
    strategies: {
      blocker: {
        reminderPriority: "high",
        scheduleComplexity: "simple",
        notificationBudget: "heavy",
        emphasizeHomeCheckIn: true,
        emphasizeScheduleSetup: true,
        emphasizeExplanation: false,
      },
      experience: {
        explanationDepth: "simple",
        uiDensity: "minimal",
        showAdvancedSafety: false,
        showDetailedForms: false,
      },
      dietLanes: [
        {
          laneKey: "diet_vegan_support",
          priority: "high",
          reasons: [],
        },
      ],
      activityPlan: {
        suggestedGoals: ["energy", "recovery"],
        suggestedTypes: ["vitamin", "mineral"],
        suggestedTimingAnchors: ["breakfast", "dinner"],
        reasons: [],
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
        emphasizedModules: ["daily_check_in"],
        prioritizedGoals: ["sleep", "immunity"],
        tipLaneKeys: ["diet_vegan_support"],
        reasons: [],
      },
      smartFilter: {
        visibleGoals: ["sleep", "immunity"],
        preselectedTypes: ["vitamin", "mineral"],
        highlightedGoal: "sleep",
        reasons: [],
      },
      planPreview: {
        goals: ["sleep", "immunity"],
        types: ["vitamin", "mineral"],
        blockerStrategy: {
          reminderPriority: "high",
          scheduleComplexity: "simple",
          notificationBudget: "heavy",
          emphasizeHomeCheckIn: true,
          emphasizeScheduleSetup: true,
          emphasizeExplanation: false,
        },
        dietLanes: ["diet_vegan_support"],
        activityAnchors: ["breakfast", "dinner"],
        reasons: [],
      },
      scheduleDefaults: {
        reminderPriority: "high",
        suggestedTimingAnchors: ["breakfast", "dinner"],
        preferScheduleSetup: true,
        reasons: [],
      },
    },
    trace: [],
  };

  const payload = buildExplanationPayload(snapshot, "plan_preview");

  assert.equal(payload.surface, "plan_preview");
  assert.equal(payload.snapshotId, "psn_plan_preview");
  assert.deepEqual(payload.selectedGoals, ["sleep", "immunity"]);
  assert.deepEqual(payload.selectedTypes, ["vitamin", "mineral"]);
  assert.ok(!("profile" in payload));
  assert.ok(!("productGoalMatches" in payload));
  assert.ok(!("firstStackPlan" in payload));
  assert.ok(payload.facts.some((fact) => fact.code === "busy_day_blocker_mealtime_anchor"));
  assert.ok(payload.facts.some((fact) => fact.code === "vegan_lane_b12_review"));
  assert.ok(payload.facts.some((fact) => fact.code === "activity_recovery_direction"));
});

test("buildExplanationPayload shapes first-stack payload without leaking raw match tables", () => {
  const snapshot: PersonalizationSnapshot = {
    snapshotId: "psn_first_stack",
    rulesVersion: "personalization-rules/v1-phase3",
    computedAt: "2026-03-18T16:10:00.000Z",
    profile: {
      declared: {
        goals: [
          { key: "recovery", priority: 100 },
          { key: "energy", priority: 80 },
        ],
        preferredTypes: ["protein", "mineral"],
        adherenceBlocker: "already_consistent",
        supplementExperience: "structured_stack",
      },
      observed: {
        consistencyLevel: "high",
        savedStackCount: 4,
        duplicateRisk: {
          level: "none",
          ingredientKeys: [],
        },
      },
      derived: {
        dietReviewLanes: [],
        activityPlanKeys: [],
      },
      meta: {
        profileVersion: "personalization-profile/v1-phase1",
        computedAt: "2026-03-18T16:10:00.000Z",
      },
    },
    strategies: {
      blocker: {
        reminderPriority: "low",
        scheduleComplexity: "advanced",
        notificationBudget: "light",
        emphasizeHomeCheckIn: false,
        emphasizeScheduleSetup: false,
        emphasizeExplanation: false,
      },
      experience: {
        explanationDepth: "advanced",
        uiDensity: "advanced",
        showAdvancedSafety: true,
        showDetailedForms: true,
      },
      dietLanes: [],
      activityPlan: {
        suggestedGoals: [],
        suggestedTypes: [],
        suggestedTimingAnchors: [],
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
                params: { supportedGoals: "recovery,energy" },
              },
            ],
          },
          {
            productId: "magnesium_glycinate",
            role: "goal_support",
            reasons: [
              {
                code: "personalization.first_stack.goal_support_selected",
                ruleId: "personalization.evaluation.first_stack",
                source: "derived",
                params: { supportedGoals: "recovery" },
              },
            ],
          },
        ],
        scheduleTemplateKey: "phase3_advanced_template",
        explanationFacts: [
          {
            code: "personalization.first_stack.schedule_template_selected",
            ruleId: "personalization.evaluation.first_stack",
            source: "derived",
            params: { scheduleTemplateKey: "phase3_advanced_template" },
          },
        ],
      },
    },
    surfaces: {
      home: {
        emphasizedModules: ["stack_insights"],
        prioritizedGoals: ["recovery", "energy"],
        tipLaneKeys: [],
        reasons: [],
      },
      smartFilter: {
        visibleGoals: ["recovery", "energy"],
        preselectedTypes: ["protein", "mineral"],
        highlightedGoal: "recovery",
        reasons: [],
      },
      planPreview: {
        goals: ["recovery", "energy"],
        types: ["protein", "mineral"],
        blockerStrategy: {
          reminderPriority: "low",
          scheduleComplexity: "advanced",
          notificationBudget: "light",
          emphasizeHomeCheckIn: false,
          emphasizeScheduleSetup: false,
          emphasizeExplanation: false,
        },
        dietLanes: [],
        activityAnchors: [],
        reasons: [],
      },
      scheduleDefaults: {
        reminderPriority: "low",
        suggestedTimingAnchors: [],
        preferScheduleSetup: false,
        reasons: [],
      },
    },
    trace: [],
  };

  const payload = buildExplanationPayload(snapshot, "first_stack");

  assert.equal(payload.surface, "first_stack");
  assert.ok(payload.firstStackPlan);
  assert.equal(payload.firstStackPlan?.items.length, 2);
  assert.ok(payload.facts.some((fact) => fact.code === "first_stack_schedule_template"));
  assert.ok(payload.facts.some((fact) => fact.code === "first_stack_item_mix"));
  assert.ok(
    payload.facts.some(
      (fact) => fact.code === "first_stack_item_highlight" && fact.params?.productLabel === "Omega 3 Fish Oil",
    ),
  );
  assert.ok(!("profile" in payload));
  assert.ok(!("productGoalMatches" in payload));
});
