import assert from "node:assert/strict";
import test from "node:test";

import {
  buildPersonalizationControlEvents,
  compilePreferenceVector,
  listPersonalizationControlChips,
} from "./core/critiqueEngine";

test("compilePreferenceVector respects feedback overrides for control chips", () => {
  const result = compilePreferenceVector({
    profile: {
      declared: {
        goals: [{ key: "focus", priority: 100 }],
        preferredTypes: ["herb"],
        adherenceBlocker: "goal_fit_uncertainty",
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
        computedAt: "2026-03-19T18:00:00.000Z",
      },
    },
    supportState: "choose",
    feedbackState: {
      version: "personalization-feedback/v1",
      updatedAt: "2026-03-19T18:00:00.000Z",
      events: [],
      overrides: {
        controls: {
          decisionMode: "low_overlap",
          notificationTolerance: "low",
        },
      },
      dismissals: {},
    },
  });

  assert.equal(result.preferenceVector.decisionMode, "low_overlap");
  assert.equal(result.preferenceVector.notificationTolerance, "low");
});

test("control chip helpers mark the active chip and build toggle events", () => {
  const chips = listPersonalizationControlChips({
    decisionMode: "strong_only",
    explanationStyle: "brief",
    notificationTolerance: "medium",
  });

  assert.equal(chips.find((chip) => chip.key === "strong_only")?.active, true);

  const events = buildPersonalizationControlEvents({
    key: "strong_only",
    active: true,
    timestamp: "2026-03-19T18:30:00.000Z",
  });

  assert.equal(events[0]?.surface, "personalization_controls");
  assert.equal(events[0]?.action, "remove");
  assert.equal(events[0]?.field, "decisionMode");
});
