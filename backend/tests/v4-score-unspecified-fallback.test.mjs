import assert from "node:assert/strict";
import { test } from "node:test";

import {
  __test__,
  createDefaultDailyMultiplier,
} from "../dist/scoring/v4ScoreEngine.js";

const makeBaseRow = (overrides = {}) => ({
  source_id: "src-1",
  canonical_source_id: null,
  ingredient_id: "ing-1",
  name_raw: "Magnesium",
  name_key: "magnesium",
  amount: 100,
  unit: "mg",
  amount_normalized: 100,
  unit_normalized: "mg",
  unit_kind: "mass_mg",
  amount_unknown: false,
  is_active: true,
  is_proprietary_blend: false,
  parse_confidence: 0.9,
  basis: "label_serving",
  form_raw: null,
  ...overrides,
});

const ingredientMeta = new Map([
  [
    "ing-1",
    {
      id: "ing-1",
      name: "Magnesium",
      canonical_key: "magnesium",
      unit: "mg",
      rda_adult: null,
      ul_adult: null,
      goals: null,
    },
  ],
]);

test("computeScores emits conservative form signal when only unspecified fallback exists", () => {
  const row = makeBaseRow();
  const metrics = __test__.computeScores(
    "lnhpd",
    [row],
    null,
    ingredientMeta,
    [],
    [],
    [],
    createDefaultDailyMultiplier(),
    [
      {
        id: "f-unspecified-1",
        ingredient_id: "ing-1",
        form_key: "unspecified",
        form_label: "Unspecified form",
        relative_factor: 1,
        confidence: 0.2,
        evidence_grade: "D",
        audit_status: "derived",
      },
    ],
  );

  assert.ok(metrics.formSignals.length >= 1);
  const signal = metrics.formSignals[0];
  assert.equal(signal.reasonCode, "FORM_NOT_DISCLOSED");
  assert.equal(signal.formKey, "unspecified");
  assert.equal(signal.effectiveFactor, 1);
});

test("computeScores preserves explicit form matching when verified form exists", () => {
  const row = makeBaseRow({ form_raw: "citrate" });
  const metrics = __test__.computeScores(
    "lnhpd",
    [row],
    null,
    ingredientMeta,
    [],
    [
      {
        id: "f-citrate-1",
        ingredient_id: "ing-1",
        form_key: "citrate",
        form_label: "Citrate",
        relative_factor: 1.1,
        confidence: 0.9,
        evidence_grade: "B",
        audit_status: "verified",
      },
    ],
    [],
    createDefaultDailyMultiplier(),
    [
      {
        id: "f-unspecified-1",
        ingredient_id: "ing-1",
        form_key: "unspecified",
        form_label: "Unspecified form",
        relative_factor: 1,
        confidence: 0.2,
        evidence_grade: "D",
        audit_status: "derived",
      },
    ],
  );

  assert.ok(metrics.formSignals.length >= 1);
  const signal = metrics.formSignals[0];
  assert.equal(signal.reasonCode, "FORM_INFERRED_GATE_PASS");
  assert.equal(signal.formKey, "citrate");
});

test("computeScores reports FORM_ROWS_PRESENT_BUT_NO_MATCH when form rows exist but matching fails", () => {
  const row = makeBaseRow({ form_raw: "citrate" });
  const metrics = __test__.computeScores(
    "lnhpd",
    [row],
    null,
    ingredientMeta,
    [],
    [
      {
        id: "f-glycinate-1",
        ingredient_id: "ing-1",
        form_key: "glycinate",
        form_label: "Glycinate",
        relative_factor: 1.08,
        confidence: 0.82,
        evidence_grade: "B",
        audit_status: "verified",
      },
    ],
    [],
    createDefaultDailyMultiplier(),
    [],
  );

  assert.equal(metrics.formSignals.length, 0);
  assert.equal(metrics.formMatchingDiagnostics.zeroSignalReason, "FORM_ROWS_PRESENT_BUT_NO_MATCH");
  assert.equal(metrics.formMatchingDiagnostics.ingredientRowsWithForms, 1);
  assert.equal(metrics.formMatchingDiagnostics.ingredientRowsWithFormsNoMatch, 1);
  assert.equal(metrics.formMatchingDiagnostics.rowsWithFormsNoMatch.length, 1);
  assert.equal(metrics.formMatchingDiagnostics.rowsWithFormsNoMatch[0].ingredientId, "ing-1");
  assert.ok(metrics.formMatchingDiagnostics.rowsWithFormsNoMatch[0].availableFormKeys.includes("glycinate"));
});

test("computeScores gates mismatched name/canonical mappings with conservative form signal", () => {
  const row = makeBaseRow({
    ingredient_id: "ing-2",
    name_raw: "Cat's Claw",
    name_key: "cats claw",
    form_raw: "root extract",
    match_method: "trgm",
    match_confidence: 0.62,
  });
  const mismatchMeta = new Map([
    [
      "ing-2",
      {
        id: "ing-2",
        name: "Clove bud",
        canonical_key: "clove_bud",
        unit: "mg",
        rda_adult: null,
        ul_adult: null,
        goals: null,
      },
    ],
  ]);
  const metrics = __test__.computeScores(
    "lnhpd",
    [row],
    null,
    mismatchMeta,
    [],
    [
      {
        id: "f-clove-1",
        ingredient_id: "ing-2",
        form_key: "extract",
        form_label: "Extract",
        relative_factor: 1,
        confidence: 0.7,
        evidence_grade: "C",
        audit_status: "verified",
      },
    ],
    [],
    createDefaultDailyMultiplier(),
    [],
  );

  assert.ok(metrics.formSignals.length >= 1);
  assert.equal(metrics.formSignals[0].reasonCode, "MAPPING_NAME_CANONICAL_MISMATCH");
  assert.equal(metrics.formSignals[0].formKey, "unspecified");
  assert.equal(metrics.formSignals[0].ingredientCanonicalKey, "cat_s_claw");
  assert.equal(metrics.formSignals[0].effectiveFactor, 1);
  assert.equal(metrics.formMatchingDiagnostics.ingredientRowsMappingMismatch, 1);
  assert.equal(metrics.formMatchingDiagnostics.rowsMappingMismatch.length, 1);
  assert.equal(metrics.formMatchingDiagnostics.rowsMappingMismatch[0].mismatchReason, "MAPPING_NAME_CANONICAL_MISMATCH");
  assert.equal(metrics.formMatchingDiagnostics.rowsMappingMismatch[0].ingredientCanonicalKey, "cat_s_claw");
  assert.equal(metrics.formMatchingDiagnostics.rowsMappingMismatch[0].mappingConsistencyReason, "name_alias_override_available");
});

test("computeScores applies inference-only confidence cap and reason code for low-confidence LNHPD-only actives", () => {
  const inferredLikeRow = makeBaseRow({
    amount: null,
    unit: null,
    amount_normalized: null,
    unit_normalized: null,
    unit_kind: null,
    amount_unknown: true,
    parse_confidence: 0.18,
  });
  const metrics = __test__.computeScores(
    "lnhpd",
    [inferredLikeRow],
    null,
    ingredientMeta,
    [],
    [],
    [],
    createDefaultDailyMultiplier(),
    [],
  );

  assert.equal(metrics.inferenceOnlyActives, true);
  assert.equal(metrics.inferenceGuardReasonCode, "INFERENCE_ONLY_LOW_CONFIDENCE");
  assert.ok(metrics.confidence <= 0.4);
});

test("computeScores does not trigger inference-only guard for non-LNHPD rows", () => {
  const lowConfidenceRow = makeBaseRow({
    parse_confidence: 0.2,
  });
  const metrics = __test__.computeScores(
    "dsld",
    [lowConfidenceRow],
    null,
    ingredientMeta,
    [],
    [],
    [],
    createDefaultDailyMultiplier(),
    [],
  );

  assert.equal(metrics.inferenceOnlyActives, false);
  assert.equal(metrics.inferenceGuardReasonCode, null);
});
