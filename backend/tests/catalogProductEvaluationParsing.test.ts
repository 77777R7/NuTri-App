import assert from "node:assert/strict";
import test from "node:test";

import {
  catalogProductEvaluationInternals,
  prepareCatalogProduct,
} from "../../lib/personalization/core/catalogProductEvaluation";

test("catalog product parsing recognizes SPU, CFU, and mL units", () => {
  assert.deepEqual(catalogProductEvaluationInternals.parseAmountText("120,000 SPU"), {
    amount: 120000,
    unit: "spu",
  });
  assert.deepEqual(catalogProductEvaluationInternals.parseAmountText("10 billion CFU"), {
    amount: 10_000_000_000,
    unit: "cfu",
  });
  assert.deepEqual(catalogProductEvaluationInternals.parseAmountText("1.5 mL"), {
    amount: 1.5,
    unit: "ml",
  });
});

test("catalog product parsing keeps proprietary blends out of full facts coverage", () => {
  const preparedProduct = prepareCatalogProduct({
    productId: "proprietary_blend_capsule",
    title: "Herbal Blend",
    ingredients: [{ name: "Proprietary Blend", dose: "500 mg" }],
  });

  assert.equal(preparedProduct.factsStatus, "partial");
});

test("catalog product parsing allows clear single-ingredient mL disclosures into full facts coverage", () => {
  const preparedProduct = prepareCatalogProduct({
    productId: "yerba_mate_extract",
    title: "Yerba Mate Extract",
    ingredients: [{ name: "Yerba Mate Leaf", dose: "1.5 ml" }],
  });

  assert.equal(preparedProduct.factsStatus, "full");
});
