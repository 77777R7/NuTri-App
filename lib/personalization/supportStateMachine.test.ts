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

test("compileSupportState uses recent decision events to keep users in choose", () => {
  const result = compileSupportState({
    profile: {
      declared: {
        goals: [{ key: "focus", priority: 100 }],
        preferredTypes: ["herb"],
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
        computedAt: "2026-03-21T18:00:00.000Z",
      },
    },
    eventSummary: {
      totalCount: 3,
      lastEventAt: "2026-03-21T18:00:00.000Z",
      countsByEventName: {
        goal_navigator_opened: 1,
        compare_opened: 1,
        goal_fit_detail_opened: 1,
      },
      countsBySurface: {
        goal_navigator: 2,
        my_saved: 1,
      },
      recentEvents: [],
    },
  });

  assert.equal(result.supportState, "choose");
});

test("compileSupportState uses recent install events to recover install state cross-device", () => {
  const result = compileSupportState({
    profile: {
      declared: {
        goals: [{ key: "sleep", priority: 100 }],
        preferredTypes: ["vitamin"],
      },
      observed: {
        consistencyLevel: "medium",
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
        computedAt: "2026-03-21T18:00:00.000Z",
      },
    },
    eventSummary: {
      totalCount: 1,
      lastEventAt: "2026-03-21T18:00:00.000Z",
      countsByEventName: {
        schedule_edited: 1,
      },
      countsBySurface: {
        schedule_defaults: 1,
      },
      recentEvents: [],
    },
  });

  assert.equal(result.supportState, "install");
});

test("compileSupportState keeps save-then-unsave users in choose even after first save", () => {
  const result = compileSupportState({
    profile: {
      declared: {
        goals: [{ key: "energy", priority: 100 }],
        preferredTypes: ["vitamin"],
      },
      observed: {
        consistencyLevel: "low",
        savedStackCount: 1,
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
        computedAt: "2026-03-22T01:00:00.000Z",
      },
    },
    eventSummary: {
      totalCount: 1,
      lastEventAt: "2026-03-22T01:00:00.000Z",
      countsByEventName: {
        save_then_unsave: 1,
      },
      countsBySurface: {
        my_saved: 1,
      },
      recentEvents: [],
    },
  });

  assert.equal(result.supportState, "choose");
});

test("compileSupportState uses repeated reminder pushback to avoid premature install", () => {
  const result = compileSupportState({
    profile: {
      declared: {
        goals: [{ key: "sleep", priority: 100 }],
        preferredTypes: ["vitamin"],
      },
      observed: {
        consistencyLevel: "low",
        savedStackCount: 1,
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
        computedAt: "2026-03-22T01:00:00.000Z",
      },
    },
    eventSummary: {
      totalCount: 2,
      lastEventAt: "2026-03-22T01:00:00.000Z",
      countsByEventName: {
        reminder_disabled: 2,
      },
      countsBySurface: {
        schedule_defaults: 2,
      },
      recentEvents: [],
    },
  });

  assert.equal(result.supportState, "choose");
});

test("compileSupportState keeps install when reminder pushback happens after real setup progress", () => {
  const result = compileSupportState({
    profile: {
      declared: {
        goals: [{ key: "sleep", priority: 100 }],
        preferredTypes: ["vitamin"],
      },
      observed: {
        consistencyLevel: "medium",
        savedStackCount: 1,
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
        computedAt: "2026-03-22T01:00:00.000Z",
      },
    },
    eventSummary: {
      totalCount: 3,
      lastEventAt: "2026-03-22T01:00:00.000Z",
      countsByEventName: {
        schedule_edited: 1,
        reminder_disabled: 2,
      },
      countsBySurface: {
        schedule_defaults: 3,
      },
      recentEvents: [],
    },
  });

  assert.equal(result.supportState, "install");
});
