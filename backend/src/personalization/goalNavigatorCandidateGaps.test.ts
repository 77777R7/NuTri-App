import assert from "node:assert/strict";
import test from "node:test";

import { buildGoalNavigatorCandidateGapRecord } from "./goalNavigatorCandidateGaps";
import { prepareCatalogProduct } from "../../../lib/personalization/core/catalogProductEvaluation";

test("blend rows with explicit member ingredients no longer get unresolved_ingredient noise", () => {
  const preparedProduct = prepareCatalogProduct({
    productId: "bell-lifestyle-fixture",
    title: "Bell Lifestyle, Histamine Balance",
    brandName: "Bell Lifestyle",
    ingredients: [
      { name: "Proprietary Blend", dose: "500 mg" },
      { name: "Lobelia (whole plant)", dose: null, proprietaryBlendSource: true },
      { name: "Lemon balm (herb top)", dose: null, proprietaryBlendSource: true },
      { name: "Holy basil (leaf)", dose: null, proprietaryBlendSource: true },
    ],
  });

  const gap = buildGoalNavigatorCandidateGapRecord(preparedProduct);

  assert.ok(gap);
  assert.equal(gap?.gapCodes.includes("unresolved_ingredient"), false);
  assert.equal(gap?.gapCodes.includes("missing_dose"), true);
  assert.equal(gap?.details.concreteIngredientCount, 3);
});

test("generic blend rows without explicit members remain unresolved_ingredient", () => {
  const preparedProduct = prepareCatalogProduct({
    productId: "generic-blend-fixture",
    title: "Nitric Oxide Formula",
    brandName: "Example",
    ingredients: [{ name: "Proprietary Blend", dose: null }],
  });

  const gap = buildGoalNavigatorCandidateGapRecord(preparedProduct);

  assert.ok(gap);
  assert.equal(gap?.gapCodes.includes("proprietary_blend"), true);
  assert.equal(gap?.gapCodes.includes("unresolved_ingredient"), true);
  assert.equal(gap?.details.concreteIngredientCount, 0);
});
