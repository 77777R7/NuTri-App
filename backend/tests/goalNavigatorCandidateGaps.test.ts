import assert from "node:assert/strict";
import test from "node:test";

import { prepareCatalogProduct } from "../../lib/personalization/core/catalogProductEvaluation";
import {
  buildGoalNavigatorCandidateGapRecord,
  goalNavigatorCandidateGapInternals,
} from "../src/personalization/goalNavigatorCandidateGaps";

test("candidate gap builder captures held-back products with missing dose and proprietary blend signals", () => {
  const preparedProduct = prepareCatalogProduct({
    productId: "immune_blend",
    title: "Immune Blend",
    brandName: "Low Disclosure Co",
    ingredients: [
      { name: "Immune Blend", dose: null },
      { name: "Citrus Bioflavonoids", dose: null },
    ],
  });

  const gap = buildGoalNavigatorCandidateGapRecord(preparedProduct);

  assert.ok(gap);
  assert.deepEqual(gap?.gapCodes, [
    "missing_dose",
    "unresolved_ingredient",
    "proprietary_blend",
    "low_disclosure",
  ]);
  assert.equal(gap?.details.missingDoseCount, 2);
});

test("candidate gap builder flags products with no structured ingredient rows", () => {
  const preparedProduct = prepareCatalogProduct({
    productId: "mystery_capsule",
    title: "Mystery Capsule",
    brandName: "Opaque Co",
    ingredients: [],
  });

  const gap = buildGoalNavigatorCandidateGapRecord(preparedProduct);

  assert.ok(gap);
  assert.deepEqual(gap?.gapCodes, ["no_structured_ingredients", "low_disclosure"]);
  assert.equal(gap?.details.ingredientCount, 0);
});

test("candidate gap internals detect numeric doses without supported units", () => {
  assert.equal(goalNavigatorCandidateGapInternals.hasDoseNumberWithoutSupportedUnit("500 IU"), true);
  assert.equal(goalNavigatorCandidateGapInternals.hasDoseNumberWithoutSupportedUnit("500 mg"), false);
});
