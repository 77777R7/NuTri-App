import assert from "node:assert/strict";
import test from "node:test";

import { compileSupportState } from "./core/supportStateMachine";

test("compileSupportState moves choose-first blockers into choose state", () => {
  const result = compileSupportState({
    profile: {
      declared: {
        goals: [{ key: "immunity", priority: 100 }],
        preferredTypes: ["vitamin"],
        adherenceBlocker: "goal_fit_uncertainty",
      },
      observed: {
        consistencyLevel: "unknown",
        savedStackCount: 0,
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
        computedAt: "2026-03-19T18:00:00.000Z",
      },
    },
  });

  assert.equal(result.supportState, "choose");
});

test("compileSupportState moves stable high-consistency stacks into optimize", () => {
  const result = compileSupportState({
    profile: {
      declared: {
        goals: [{ key: "recovery", priority: 100 }],
        preferredTypes: ["protein"],
        adherenceBlocker: "already_consistent",
      },
      observed: {
        currentStreak: 9,
        consistencyLevel: "high",
        savedStackCount: 5,
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
        computedAt: "2026-03-19T18:00:00.000Z",
      },
    },
  });

  assert.equal(result.supportState, "optimize");
});
