import assert from "node:assert/strict";
import test from "node:test";

import type { GoalNavigatorCandidate, SavedProductEvaluation } from "@/types/personalization";

import { buildGoalNavigatorResponse } from "./core/goalNavigator";

const makeCandidate = (input: {
  productId: string;
  tier: GoalNavigatorCandidate["tier"];
  score: number;
  preferredTypeMatch?: boolean;
  rankEligible?: boolean;
}): GoalNavigatorCandidate => {
  const evaluation: SavedProductEvaluation = {
    productId: input.productId,
    factsStatus: "full",
    coverage: {
      factsStatus: "full",
      status: "coverage_ready",
      reasons: [],
    },
    productGoalMatches: [
      {
        goalKey: "immunity",
        score: input.score,
        tier: input.tier === "not_enough_structured_data" ? "no_match" : input.tier,
        reasons: [],
      },
    ],
    eligibility: {
      eligible: true,
      rankEligible: input.rankEligible ?? true,
      caps: [],
      reasons: [],
    },
    firstStackEligible: true,
    smartFilterMembership: {
      productId: input.productId,
      factsStatus: "full",
      coverageStatus: "coverage_ready",
      bucket: input.tier,
      typeKeys: ["vitamin"],
      highlightedGoal: "immunity",
      goalTiers: {
        immunity: input.tier === "not_enough_structured_data" ? "no_match" : input.tier,
      },
      eligibility: {
        eligible: true,
        rankEligible: input.rankEligible ?? true,
        caps: [],
      },
      reasons: [],
    },
    display: {
      title: input.productId,
      brandName: "Brand",
      dosageText: "100 mg",
    },
    reasons: [],
  };

  return {
    productId: input.productId,
    goalKey: "immunity",
    tier: input.tier,
    score: input.score,
    typeKeys: ["vitamin"],
    preferredTypeMatch: input.preferredTypeMatch ?? false,
    evaluation,
    goalFitCard: {
      productId: input.productId,
      goalKey: "immunity",
      tier: input.tier,
      confidence: {
        evidence: "medium",
        labelCompleteness: "full",
        overlapRisk: "none",
        routineFit: "easy",
      },
      whyFit: [],
      whyNotStronger: [],
      holdbacks: [],
    },
  };
};

test("buildGoalNavigatorResponse keeps only rank-eligible coverage-ready candidates and sorts by fit", () => {
  const response = buildGoalNavigatorResponse({
    goalKey: "immunity",
    rulesVersion: "personalization-rules/v1-phase7",
    preferredTypes: ["vitamin"],
    candidates: [
      makeCandidate({ productId: "strong", tier: "strong_match", score: 92 }),
      makeCandidate({ productId: "preferred-related", tier: "related", score: 70, preferredTypeMatch: true }),
      makeCandidate({ productId: "weak", tier: "weak_match", score: 41 }),
      makeCandidate({ productId: "guarded", tier: "strong_match", score: 95, rankEligible: false }),
      makeCandidate({ productId: "no-match", tier: "no_match", score: 0 }),
    ],
    notEnoughStructuredDataCount: 4,
  });

  assert.deepEqual(
    response.candidates.map((candidate) => candidate.productId),
    ["strong", "preferred-related", "weak"],
  );
  assert.equal(response.fallback.notEnoughStructuredDataCount, 4);
  assert.ok(
    response.reasons.some((reason) => reason.code === "goal_navigator_preferred_types_applied"),
  );
});

test("buildGoalNavigatorResponse honors strong-only decision mode when a control bar preference is active", () => {
  const response = buildGoalNavigatorResponse({
    goalKey: "immunity",
    rulesVersion: "personalization-rules/v1-phase7",
    preferenceVector: {
      decisionMode: "strong_only",
      explanationStyle: "compare",
      notificationTolerance: "medium",
    },
    candidates: [
      makeCandidate({ productId: "strong", tier: "strong_match", score: 91 }),
      makeCandidate({ productId: "related", tier: "related", score: 79 }),
    ],
    notEnoughStructuredDataCount: 0,
  });

  assert.deepEqual(
    response.candidates.map((candidate) => candidate.productId),
    ["strong"],
  );
  assert.equal(response.preferenceVector?.decisionMode, "strong_only");
  assert.ok(
    response.reasons.some((reason) => reason.code === "goal_navigator_preference_vector_applied"),
  );
});
