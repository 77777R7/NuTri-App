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
  assert.equal(result.goalFitCard?.confidence.evidence, "medium");
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
