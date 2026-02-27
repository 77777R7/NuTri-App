import assert from "node:assert/strict";
import { test } from "node:test";

import { __test__, createDefaultDailyMultiplier } from "../dist/scoring/v4ScoreEngine.js";

const baseRow = {
  source_id: "src-1",
  canonical_source_id: null,
  ingredient_id: "ing-zinc",
  name_raw: "Zinc",
  name_key: "zinc",
  amount: 45,
  unit: "mg",
  amount_normalized: 45,
  unit_normalized: "mg",
  unit_kind: "mass",
  amount_unknown: false,
  is_active: true,
  is_proprietary_blend: false,
  parse_confidence: 0.9,
  basis: "label_serving",
  form_raw: null,
};

test("computeUlWarnings emits entries[] and remains compatible with high/moderate arrays", () => {
  const ingredientMeta = new Map([
    [
      "ing-zinc",
      {
        id: "ing-zinc",
        name: "Zinc",
        canonical_key: "zinc",
        unit: "mg",
        rda_adult: null,
        ul_adult: 40,
        goals: null,
      },
    ],
  ]);

  const warnings = __test__.computeUlWarnings([baseRow], ingredientMeta, createDefaultDailyMultiplier());

  assert.ok(Array.isArray(warnings.high));
  assert.ok(Array.isArray(warnings.moderate));
  assert.ok(Array.isArray(warnings.entries));
  assert.equal(warnings.entries.length >= 1, true);
  assert.equal(warnings.entries[0].displayName, "Zinc");
  assert.equal(warnings.entries[0].ulLimit, "40 mg");
  assert.equal(warnings.entries[0].scope, "total_intake");
  assert.equal(typeof warnings.webDisplayEligible, "boolean");
  assert.equal(typeof warnings.unitPolicyWarningsCount, "number");
  assert.equal(typeof warnings.missingReasonCounts?.canonicalAliasMiss, "number");
  assert.ok(
    warnings.entries[0].reasonCode === "ODS_UL_MATCHED" ||
      warnings.entries[0].reasonCode === "LEGACY_UL_META_MATCHED",
  );
});

test("computeUlWarnings sets webDisplayEligible=false for web source", () => {
  const ingredientMeta = new Map([
    [
      "ing-zinc",
      {
        id: "ing-zinc",
        name: "Zinc",
        canonical_key: "zinc",
        unit: "mg",
        rda_adult: null,
        ul_adult: 40,
        goals: null,
      },
    ],
  ]);
  const warnings = __test__.computeUlWarnings(
    [baseRow],
    ingredientMeta,
    createDefaultDailyMultiplier(),
    "web",
  );
  assert.equal(warnings.webDisplayEligible, false);
});

test("computeUlWarnings applies folate unit policy warning for DFE labels", () => {
  const rows = [
    {
      ...baseRow,
      ingredient_id: "ing-folate",
      name_raw: "Folate (mcg DFE)",
      name_key: "folate",
      amount: 800,
      unit: "mcg",
      amount_normalized: 800,
      unit_normalized: "mcg",
    },
  ];
  const ingredientMeta = new Map([
    [
      "ing-folate",
      {
        id: "ing-folate",
        name: "Folate",
        canonical_key: "folate",
        unit: "mcg",
        rda_adult: null,
        ul_adult: null,
        goals: null,
      },
    ],
  ]);
  const warnings = __test__.computeUlWarnings(rows, ingredientMeta, createDefaultDailyMultiplier(), "dsld");
  assert.equal(warnings.entries.length >= 1, true);
  assert.equal(warnings.entries[0].reasonCode, "UNIT_CONVERSION_UNCERTAIN");
  assert.equal(warnings.unitPolicyWarningsCount >= 1, true);
  assert.equal(warnings.missingReasonCounts.unitConversionUncertain >= 1, true);
});

test("computeUlWarnings resolves UL from row name_key when ingredient meta is missing", () => {
  const rows = [
    {
      ...baseRow,
      ingredient_id: "ing-vitd-missing-meta",
      name_raw: "Vitamin D3",
      name_key: "cholecalciferol",
      amount: 4000,
      unit: "iu",
      amount_normalized: 4000,
      unit_normalized: "iu",
    },
  ];

  const warnings = __test__.computeUlWarnings(rows, new Map(), createDefaultDailyMultiplier(), "lnhpd");
  assert.equal(warnings.entries.length >= 1, true);
  assert.equal(warnings.entries[0].ingredientCanonicalKey, "vitamin_d");
  assert.equal(warnings.entries[0].reasonCode, "ODS_UL_MATCHED");
  assert.equal(warnings.missingReasonCounts.canonicalAliasMiss, 0);
});
