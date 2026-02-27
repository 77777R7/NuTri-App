import assert from "node:assert/strict";
import test from "node:test";

import {
  LNHPD_000_BUCKETS,
  classifyLnhpd000Bucket,
} from "../../backend/scripts/lib/lnhpd-000-bucket.mjs";

test("classifies missing medicinal ingredients when medicinal raw fields are absent", () => {
  const result = classifyLnhpd000Bucket({
    factsJson: {
      doses: [{ rawText: "Adults: 1 capsule daily." }],
    },
    hasBarcodeMapping: true,
  });

  assert.equal(result.bucket, LNHPD_000_BUCKETS.MISSING_MEDICINAL_INGREDIENTS);
  assert.equal(result.subcause, "raw_medicinal_missing");
});

test("classifies missing amount fields when medicinal rows exist without amount/unit", () => {
  const result = classifyLnhpd000Bucket({
    factsJson: {
      medicinalIngredients: [
        { name: "Vitamin C", amount: null, unit: null },
      ],
    },
    hasBarcodeMapping: true,
  });

  assert.equal(result.bucket, LNHPD_000_BUCKETS.MISSING_AMOUNT_FIELDS);
  assert.equal(result.subcause, "ingredient_present_amount_missing");
});

test("classifies parser gap fixable when raw fields exist but extractor outputs zero", () => {
  const result = classifyLnhpd000Bucket({
    factsJson: {
      medicinalIngredients: [{ name: "Vitamin C", amount: 1000, unit: "mg" }],
      warnings: [{ text: "Consult clinician when pregnant." }],
    },
    hasBarcodeMapping: true,
    extractorCounts: {
      extractorIngredientCount: 0,
      extractorDoseCount: 0,
      extractorSafetyCount: 0,
    },
  });

  assert.equal(result.bucket, LNHPD_000_BUCKETS.PARSER_GAP_FIXABLE);
  assert.equal(result.subcause, "raw_present_extractor_zero");
});

test("classifies mapping gap when parser output exists but barcode mapping is missing", () => {
  const result = classifyLnhpd000Bucket({
    factsJson: {
      medicinalIngredients: [{ name: "Vitamin C", amount: 1000, unit: "mg" }],
      warnings: [{ text: "Consult clinician when pregnant." }],
    },
    hasBarcodeMapping: false,
  });

  assert.equal(result.bucket, LNHPD_000_BUCKETS.MAPPING_GAP_NO_BARCODE);
  assert.equal(result.subcause, "npn_unmapped");
});

test("falls back to DATA_CEILING when raw fields are present and mapped without parser gaps", () => {
  const result = classifyLnhpd000Bucket({
    factsJson: {
      medicinalIngredients: [{ name: "Vitamin C", amount: 1000, unit: "mg" }],
      warnings: [{ text: "Consult clinician when pregnant." }],
      doses: [{ rawText: "Adults: 1 capsule daily." }],
    },
    hasBarcodeMapping: true,
  });

  assert.equal(result.bucket, LNHPD_000_BUCKETS.DATA_CEILING);
  assert.equal(result.subcause, "source_thin_nonfixable");
});
