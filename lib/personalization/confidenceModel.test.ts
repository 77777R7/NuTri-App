import assert from "node:assert/strict";
import test from "node:test";

import type { SavedProductEvaluation } from "@/types/personalization";

import { buildConfidenceBreakdown } from "./core/confidenceModel";

const directSupportEvaluation: SavedProductEvaluation = {
  productId: "product-1",
  factsStatus: "full",
  coverage: {
    factsStatus: "full",
    status: "coverage_ready",
    reasons: [{ code: "personalization.product_evaluation.coverage_ready", ruleId: "coverage", source: "derived" }],
  },
  productGoalMatches: [
    {
      goalKey: "immunity",
      score: 78,
      tier: "related",
      reasons: [
        { code: "goal_supported_by_ingredient", ruleId: "goal", source: "catalog" },
        { code: "dose_meets_effective_floor", ruleId: "dose", source: "derived" },
        { code: "goal_specific_evidence_missing", ruleId: "evidence", source: "catalog" },
      ],
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
    productId: "product-1",
    factsStatus: "full",
    coverageStatus: "coverage_ready",
    bucket: "related",
    typeKeys: ["vitamin"],
    highlightedGoal: "immunity",
    goalTiers: { immunity: "related" },
    eligibility: { eligible: true, rankEligible: true, caps: [] },
    reasons: [],
  },
  reasons: [],
};

test("buildConfidenceBreakdown keeps direct goal support with met dose at medium evidence when product evidence row is missing", () => {
  const confidence = buildConfidenceBreakdown({
    evaluation: directSupportEvaluation,
    goalKey: "immunity",
  });

  assert.equal(confidence.evidence, "medium");
});
