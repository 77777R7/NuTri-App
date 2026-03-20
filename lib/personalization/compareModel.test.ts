import assert from "node:assert/strict";
import test from "node:test";

import type { SavedProductEvaluation } from "@/types/personalization";

import { buildGoalCompareEntries } from "./core/compareModel";

const makeEvaluation = (
  productId: string,
  score: number,
  tier: SavedProductEvaluation["smartFilterMembership"]["bucket"],
): SavedProductEvaluation => ({
  productId,
  factsStatus: "full",
  coverage: {
    factsStatus: "full",
    status: "coverage_ready",
    reasons: [{ code: "personalization.product_evaluation.coverage_ready", ruleId: "coverage", source: "derived" }],
  },
  productGoalMatches: [
    {
      goalKey: "immunity",
      score,
      tier: tier === "not_enough_structured_data" ? "no_match" : tier,
      reasons: [{ code: "goal_supported_by_ingredient", ruleId: "goal", source: "catalog" }],
    },
  ],
  eligibility: {
    eligible: true,
    rankEligible: true,
    caps: [],
    reasons: [],
  },
  firstStackEligible: true,
  smartFilterMembership: {
    productId,
    factsStatus: "full",
    coverageStatus: "coverage_ready",
    bucket: tier,
    typeKeys: ["vitamin"],
    highlightedGoal: "immunity",
    goalTiers: { immunity: tier === "not_enough_structured_data" ? "no_match" : tier },
    eligibility: { eligible: true, rankEligible: true, caps: [] },
    reasons: [],
  },
  display: {
    title: productId,
    brandName: "Brand",
    dosageText: "100 mg",
  },
  reasons: [],
});

test("buildGoalCompareEntries keeps the current product first and ranks peers by fit", () => {
  const entries = buildGoalCompareEntries({
    evaluations: [
      makeEvaluation("current", 64, "related"),
      makeEvaluation("peer-strong", 91, "strong_match"),
      makeEvaluation("peer-weak", 35, "weak_match"),
    ],
    currentProductId: "current",
    goalKey: "immunity",
  });

  assert.equal(entries[0]?.productId, "current");
  assert.equal(entries[1]?.productId, "peer-strong");
  assert.equal(entries[2]?.productId, "peer-weak");
});
