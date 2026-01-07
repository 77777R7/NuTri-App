import assert from "node:assert/strict";

import { __test__ } from "../../src/scoring/v4ScoreEngine.js";

const rows = [
  {
    source_id: "test-source",
    canonical_source_id: null,
    ingredient_id: "ingredient-1",
    name_raw: "Test Ingredient",
    name_key: "test ingredient",
    amount: 50,
    unit: "mg",
    amount_normalized: null,
    unit_normalized: null,
    unit_kind: "mass",
    amount_unknown: false,
    is_active: true,
    is_proprietary_blend: false,
    parse_confidence: 0.9,
    basis: "label_serving",
    form_raw: null,
  },
];

const ingredientMeta = new Map([
  [
    "ingredient-1",
    {
      id: "ingredient-1",
      unit: "mg",
      rda_adult: null,
      ul_adult: 80,
      goals: null,
    },
  ],
]);

const warnings = __test__.computeUlWarnings(rows, ingredientMeta, {
  multiplier: 2,
  source: "lnhpd_dose",
  reliability: "reliable",
});

assert.deepEqual(warnings.high, ["Test Ingredient"]);
assert.deepEqual(warnings.moderate, []);
assert.equal(warnings.basis, "per_day_adult");
assert.equal(warnings.dailyMultiplierUsed, 2);
assert.equal(warnings.dailyMultiplierSource, "lnhpd_dose");

console.log("ok");
