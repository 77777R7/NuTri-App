import assert from "node:assert/strict";
import test from "node:test";

import { catalogProductEvaluationInternals, evaluateCatalogProduct } from "./core/catalogProductEvaluation";

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

test("parseAmountText recognizes extended activity units and spelled-out gram doses", () => {
  assert.deepEqual(catalogProductEvaluationInternals.parseAmountText("800 GALU"), {
    amount: 800,
    unit: "galu",
  });
  assert.deepEqual(catalogProductEvaluationInternals.parseAmountText("24,000 DU"), {
    amount: 24000,
    unit: "du",
  });
  assert.deepEqual(catalogProductEvaluationInternals.parseAmountText("20,000 PC"), {
    amount: 20000,
    unit: "pc",
  });
  assert.deepEqual(catalogProductEvaluationInternals.parseAmountText("800 FCCLU"), {
    amount: 800,
    unit: "fcclu",
  });
  assert.deepEqual(catalogProductEvaluationInternals.parseAmountText("24 endo-PGU"), {
    amount: 24,
    unit: "endo-pgu",
  });
  assert.deepEqual(catalogProductEvaluationInternals.parseAmountText("2.7 billion CFU1"), {
    amount: 2.7e9,
    unit: "cfu",
  });
  assert.deepEqual(catalogProductEvaluationInternals.parseAmountText("20 grams"), {
    amount: 20,
    unit: "g",
  });
  assert.deepEqual(catalogProductEvaluationInternals.parseAmountText("40,000 units"), {
    amount: 40000,
    unit: "unit",
  });
  assert.deepEqual(catalogProductEvaluationInternals.parseAmountText("223,000 USP units"), {
    amount: 223000,
    unit: "usp",
  });
  assert.deepEqual(catalogProductEvaluationInternals.parseAmountText("5 Billion TFU"), {
    amount: 5e9,
    unit: "tfu",
  });
  assert.deepEqual(catalogProductEvaluationInternals.parseAmountText("300 million AFU"), {
    amount: 3e8,
    unit: "afu",
  });
  assert.deepEqual(catalogProductEvaluationInternals.parseAmountText("6 billion live cells†"), {
    amount: 6e9,
    unit: "cfu",
  });
  assert.deepEqual(catalogProductEvaluationInternals.parseAmountText("250 ppm"), {
    amount: 250,
    unit: "ppm",
  });
  assert.deepEqual(catalogProductEvaluationInternals.parseAmountText("1000-2000 mg"), {
    amount: 1000,
    unit: "mg",
  });
  assert.deepEqual(
    catalogProductEvaluationInternals.parseAmountText(
      "500 mg17,500 USP units110,000 USP units120,000 USP units",
    ),
    {
      amount: 500,
      unit: "mg",
    },
  );
});

test("evaluateCatalogProduct treats enzyme activity rows as coverage-ready structured facts", () => {
  const result = evaluateCatalogProduct({
    productId: "spectrazyme_complete_enzymes",
    goalKey: "digestion",
    title: "Metagenics, SpectraZyme Complete Enzymes, 180 Capsules",
    brandName: "Metagenics",
    ingredients: [
      {
        name: "Amylase",
        dose: "24,000 DU",
      },
      {
        name: "Neutral Protease",
        dose: "20,000 PC",
      },
      {
        name: "Lipase",
        dose: "800 FCCLU",
      },
      {
        name: "Pectinase",
        dose: "24 endo-PGU",
      },
    ],
  });

  assert.equal(result.coverageStatus, "coverage_ready");
  assert.equal(result.savedProductEvaluation.coverage.status, "coverage_ready");
});

test("evaluateCatalogProduct treats aggregate-formula blend totals as coverage-ready when the formula dose is explicit", () => {
  const result = evaluateCatalogProduct({
    productId: "snap_detox_formula",
    goalKey: "digestion",
    title: "Snap Supplements, Detox, Advanced Cleansing Blend, 60 Capsules",
    brandName: "Snap Supplements",
    ingredients: [
      {
        name: "Detox Formula",
        dose: "1.538 g",
        proprietaryBlendSource: true,
        aggregateFormula: true,
      },
      {
        name: "Psyllium Husk Powder",
        dose: null,
        proprietaryBlendSource: true,
      },
      {
        name: "Fennel Seed Powder",
        dose: null,
        proprietaryBlendSource: true,
      },
    ],
  });

  assert.equal(result.savedProductEvaluation.factsStatus, "full");
  assert.equal(result.coverageStatus, "coverage_ready");
});

test("evaluateCatalogProduct treats probiotic live-cell aggregate rows as coverage-ready when the formula dose is explicit", () => {
  const result = evaluateCatalogProduct({
    productId: "thorne_floramend_prime",
    goalKey: "digestion",
    title: "Thorne, FloraMend Prime Probiotic, 30 Capsules",
    brandName: "Thorne",
    ingredients: [
      {
        name: "Probiotics",
        dose: "5 Billion Live Cells†",
        proprietaryBlendSource: true,
        aggregateFormula: true,
      },
      {
        name: "Lactobacillus gasseri, KS-13",
        dose: null,
        proprietaryBlendSource: true,
      },
      {
        name: "Bifidobacterium longum MM-2",
        dose: null,
        proprietaryBlendSource: true,
      },
    ],
  });

  assert.equal(result.savedProductEvaluation.factsStatus, "full");
  assert.equal(result.coverageStatus, "coverage_ready");
});
