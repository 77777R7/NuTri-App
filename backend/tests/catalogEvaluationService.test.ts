import assert from "node:assert/strict";
import test from "node:test";

import { prepareCatalogProduct } from "../../lib/personalization/core/catalogProductEvaluation";
import { createGoalNavigatorCatalogEvaluationService } from "../src/personalization/catalogEvaluationService";

test("catalog evaluation service reuses a prepared candidate bundle within the TTL window", async () => {
  let currentTime = 0;
  let fetchCount = 0;

  const service = createGoalNavigatorCatalogEvaluationService({
    now: () => currentTime,
    bundleTtlMs: 1_000,
    fetchOverlayCatalogRows: async () => {
      fetchCount += 1;
      return [
        {
          product_id: "immune_c",
          brand_name: "Trusted Brand",
          title: "Vitamin C 500",
          supplement_facts: {
            nutritionalFacts: [{ substancy: "Vitamin C", amountPerServing: "500 mg" }],
          },
          description_sections: {
            Description: "Buffered vitamin C support.",
            "Suggested Use": "Take 1 capsule daily.",
          },
        },
        {
          product_id: "mystery_blend",
          brand_name: "Low Data Brand",
          title: "Mystery Immune Blend",
          supplement_facts: {
            nutritionalFacts: [{ substancy: "Immune blend", amountPerServing: "" }],
          },
          description_sections: {
            Description: "A label with weak structured facts.",
          },
        },
      ];
    },
  });

  const first = await service.evaluateGoal({
    goalKey: "immunity",
    preferredTypes: ["vitamin"],
  });

  currentTime = 500;
  const second = await service.evaluateGoal({
    goalKey: "immunity",
    preferredTypes: ["vitamin"],
  });

  currentTime = 1_500;
  const third = await service.evaluateGoal({
    goalKey: "immunity",
    preferredTypes: ["vitamin"],
  });

  assert.equal(fetchCount, 2);
  assert.equal(first.candidates[0]?.productId, "immune_c");
  assert.equal(second.candidates[0]?.productId, "immune_c");
  assert.equal(third.candidates[0]?.productId, "immune_c");
  assert.equal(first.fallback.notEnoughStructuredDataCount, 1);
  assert.equal(second.fallback.notEnoughStructuredDataCount, 1);
  assert.equal(third.fallback.notEnoughStructuredDataCount, 1);
});

test("catalog evaluation service prefers a precomputed bundle artifact when one is available", async () => {
  let fetchCount = 0;

  const service = createGoalNavigatorCatalogEvaluationService({
    fetchOverlayCatalogRows: async () => {
      fetchCount += 1;
      return [];
    },
    loadPrecomputedBundle: () => ({
      preparedAt: "2026-03-19T00:00:00.000Z",
      notEnoughStructuredDataCount: 1,
      preparedCandidates: [
        {
          preparedProduct: prepareCatalogProduct({
            productId: "immune_c_prebuilt",
            title: "Vitamin C 500",
            brandName: "Trusted Brand",
            description: "Buffered vitamin C support.",
            suggestedUse: "Take 1 capsule daily.",
            ingredients: [{ name: "Vitamin C", dose: "500 mg" }],
          }),
        },
      ],
    }),
  });

  const response = await service.evaluateGoal({
    goalKey: "immunity",
    preferredTypes: ["vitamin"],
  });

  assert.equal(fetchCount, 0);
  assert.equal(response.candidates[0]?.productId, "immune_c_prebuilt");
  assert.equal(response.fallback.notEnoughStructuredDataCount, 1);
});
