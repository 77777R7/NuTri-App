import assert from "node:assert/strict";
import test from "node:test";

import type { SavedProductEvaluation } from "@/types/personalization";

import { buildGoalFitCard } from "./core/goalFitCardBuilder";

const readyEvaluation: SavedProductEvaluation = {
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
    reasons: [{ code: "duplicate_overlap_high", ruleId: "overlap", source: "observed" }],
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
  display: {
    title: "Vitamin C 1000 mg",
    brandName: "Sports Research",
    dosageText: "1000 mg",
  },
  reasons: [],
};

test("buildGoalFitCard groups positive reasons, strength caps, and holdbacks", () => {
  const card = buildGoalFitCard({
    evaluation: readyEvaluation,
    goalKey: "immunity",
    stackOverlapCount: 1,
  });

  assert.ok(card);
  assert.equal(card?.tier, "related");
  assert.equal(card?.confidence.evidence, "medium");
  assert.equal(card?.confidence.overlapRisk, "high");
  assert.ok(card?.whyFit.some((reason) => reason.code === "goal_supported_by_ingredient"));
  assert.ok(card?.whyNotStronger.some((reason) => reason.code === "goal_specific_evidence_missing"));
  assert.ok(card?.holdbacks.some((reason) => reason.code === "duplicate_overlap_high"));
});

test("buildGoalFitCard falls back cleanly when data is not structured enough", () => {
  const card = buildGoalFitCard({
    evaluation: {
      ...readyEvaluation,
      factsStatus: "partial",
      coverage: {
        factsStatus: "partial",
        status: "not_enough_structured_data",
        reasons: [
          {
            code: "personalization.product_evaluation.not_enough_structured_data",
            ruleId: "coverage",
            source: "derived",
          },
        ],
      },
      productGoalMatches: [],
      smartFilterMembership: {
        ...readyEvaluation.smartFilterMembership,
        factsStatus: "partial",
        coverageStatus: "not_enough_structured_data",
        bucket: "not_enough_structured_data",
        goalTiers: {},
      },
    },
    goalKey: "immunity",
  });

  assert.ok(card);
  assert.equal(card?.tier, "not_enough_structured_data");
  assert.equal(card?.confidence.labelCompleteness, "weak");
  assert.ok(
    card?.holdbacks.some((reason) => reason.code === "personalization.product_evaluation.not_enough_structured_data"),
  );
});
