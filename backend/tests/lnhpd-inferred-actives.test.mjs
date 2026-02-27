import assert from "node:assert/strict";
import { test } from "node:test";

import {
  INFERRED_FROM_PRODUCT_NAME,
  INFERENCE_ONLY_ACTIVE_CONFIDENCE_MAX,
  INFERENCE_SOURCE_PRODUCT_NAME,
  inferLnhpdActivesFromProductName,
  isOnlyInferredLnhpdDigestActives,
  isProductNameInferredMeta,
} from "../dist/lnhpd/inferredActives.js";

test("inferLnhpdActivesFromProductName covers CA thin-record product names", () => {
  const cases = [
    { barcode: "80010311", input: "L-Glutamine", expected: "L-Glutamine" },
    { barcode: "80017685", input: "L-METHIONINE", expected: "L-Methionine" },
    { barcode: "80021829", input: "Super Fiber", expected: "Dietary Fiber" },
    { barcode: "80043836", input: "Pau D'arco (Capsules)", expected: "Pau d'Arco" },
    { barcode: "80044382", input: "Pau D'arco (Tincture)", expected: "Pau d'Arco" },
  ];

  cases.forEach((item) => {
    const rows = inferLnhpdActivesFromProductName(item.input);
    assert.equal(rows.length, 1, `barcode=${item.barcode}`);
    assert.equal(rows[0].name, item.expected, `barcode=${item.barcode}`);
    assert.equal(rows[0].lnhpdMeta.properName, INFERRED_FROM_PRODUCT_NAME, `barcode=${item.barcode}`);
    assert.equal(rows[0].lnhpdMeta.inferenceSource, INFERENCE_SOURCE_PRODUCT_NAME, `barcode=${item.barcode}`);
    assert.equal(rows[0].amount, null, `barcode=${item.barcode}`);
  });
});

test("inferLnhpdActivesFromProductName parses vitamin D amount and unit when available", () => {
  const rows = inferLnhpdActivesFromProductName("Vitamin D3 1000 IU");
  assert.equal(rows.length, 1);
  assert.equal(rows[0].name, "Vitamin D");
  assert.equal(rows[0].amount, 1000);
  assert.equal(rows[0].unit, "iu");
});

test("inferLnhpdActivesFromProductName does not infer unknown product names", () => {
  assert.deepEqual(inferLnhpdActivesFromProductName("Random Herbal Blend X"), []);
});

test("isProductNameInferredMeta detects inferred metadata marker", () => {
  assert.equal(
    isProductNameInferredMeta({
      properName: INFERRED_FROM_PRODUCT_NAME,
      inferenceSource: INFERENCE_SOURCE_PRODUCT_NAME,
    }),
    true,
  );
  assert.equal(
    isProductNameInferredMeta({
      properName: "standard_name",
      inferenceSource: null,
    }),
    false,
  );
});

test("isOnlyInferredLnhpdDigestActives is true only for low-confidence product-name inference evidence", () => {
  assert.equal(
    isOnlyInferredLnhpdDigestActives([
      {
        source: "lnhpd",
        confidence: INFERENCE_ONLY_ACTIVE_CONFIDENCE_MAX,
        evidenceText: "Inferred from product name; treat as low-confidence ingredient evidence.",
      },
    ]),
    true,
  );

  assert.equal(
    isOnlyInferredLnhpdDigestActives([
      {
        source: "lnhpd",
        confidence: 0.8,
        evidenceText: "Direct medicinal ingredient extraction.",
      },
    ]),
    false,
  );
});
