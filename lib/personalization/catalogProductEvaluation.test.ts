import assert from "node:assert/strict";
import test from "node:test";

import { evaluateCatalogProduct } from "./core/catalogProductEvaluation";

test("evaluateCatalogProduct turns structured overlay ingredients into a coverage-ready goal navigator candidate", () => {
  const result = evaluateCatalogProduct({
    productId: "vitamin_c_1000",
    goalKey: "immunity",
    preferredTypes: ["vitamin"],
    title: "Vitamin C 1000 mg",
    brandName: "Sports Research",
    ingredients: [
      {
        name: "Vitamin C (as Ascorbic Acid)",
        dose: "1000 mg",
      },
    ],
  });

  assert.equal(result.coverageStatus, "coverage_ready");
  assert.ok(result.candidate);
  assert.equal(result.candidate?.goalKey, "immunity");
  assert.equal(result.candidate?.preferredTypeMatch, true);
  assert.equal(result.goalFitCard?.confidence.evidence, "high");
  assert.match(result.savedProductEvaluation.display?.title ?? "", /Vitamin C/i);
});

test("evaluateCatalogProduct keeps weakly structured rows out of coverage-ready navigator candidates", () => {
  const result = evaluateCatalogProduct({
    productId: "elderberry_unknown",
    goalKey: "immunity",
    title: "Elderberry Gummies",
    brandName: "Example Brand",
    ingredients: [
      {
        name: "Elderberry",
        dose: null,
      },
    ],
  });

  assert.equal(result.coverageStatus, "not_enough_structured_data");
  assert.equal(result.candidate, undefined);
  assert.equal(result.savedProductEvaluation.coverage.status, "not_enough_structured_data");
});

test("evaluateCatalogProduct blocks pantry surfaces before goal matching", () => {
  const result = evaluateCatalogProduct({
    productId: "tea_bags_out_of_scope",
    goalKey: "immunity",
    title: "Buddha Teas, Organic Herbal Tea, Elderberry, 18 Tea Bags",
    brandName: "Buddha Teas",
    sourceZipPath: "buddha-teas.json",
    ingredients: [
      {
        name: "Calories",
        dose: null,
      },
      {
        name: "Total Fat",
        dose: null,
      },
    ],
  });

  assert.equal(result.coverageStatus, "not_enough_structured_data");
  assert.equal(result.candidate, undefined);
  assert.equal(result.savedProductEvaluation.coverage.status, "not_enough_structured_data");
  assert.equal(
    result.savedProductEvaluation.coverage.reasons[0]?.code,
    "personalization.product_evaluation.out_of_scope_non_supplement",
  );
});

test("evaluateCatalogProduct treats explicit-dose named complexes as coverage-ready when they are not generic blends", () => {
  const result = evaluateCatalogProduct({
    productId: "butyragen_complex",
    goalKey: "recovery",
    title: "Allergy Research Group, ButyrEn®, 100 Delayed-Release Vegetarian Capsules",
    brandName: "Allergy Research Group",
    ingredients: [
      {
        name: "ButyraGen (Tributyrin Complex)",
        dose: "200 mg",
      },
    ],
  });

  assert.equal(result.coverageStatus, "coverage_ready");
  assert.equal(result.savedProductEvaluation.coverage.status, "coverage_ready");
});

test("evaluateCatalogProduct still keeps generic blend rows out of coverage-ready candidates", () => {
  const result = evaluateCatalogProduct({
    productId: "generic_probiotic_blend",
    goalKey: "immunity",
    title: "Life Extension, Florassist® Probiotic, GI with Phage Technology",
    brandName: "Life Extension",
    ingredients: [
      {
        name: "Probiotic Blend",
        dose: "15 mg",
      },
    ],
  });

  assert.equal(result.coverageStatus, "not_enough_structured_data");
  assert.equal(result.savedProductEvaluation.coverage.status, "not_enough_structured_data");
});
