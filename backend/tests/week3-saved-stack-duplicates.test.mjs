import assert from "node:assert/strict";
import { test } from "node:test";

import { buildSavedStackSummary } from "../dist/safety/stackAggregation.js";
import { buildStackOverlapResult } from "../dist/stackOverlap.js";

test("Week3 safety: magnesium duplicates surface a high-confidence over-UL warning", () => {
  const summary = buildSavedStackSummary({
    supplements: [
      {
        supplementId: "mag-1",
        productName: "Magnesium Product A",
        dailyMultiplier: 2,
        dailyDoseBasis: "label_daily_estimate",
        dailyDoseBasisReason: "parsed_label_directions",
        ingredientRows: [{ name: "Magnesium glycinate", amount: 200, unit: "mg", amountText: "200 mg" }],
      },
      {
        supplementId: "mag-2",
        productName: "Magnesium Product B",
        dailyDoseBasisReason: "snapshot_only_no_directions",
        dailyDoseBasis: "one_serving_fallback",
        ingredientRows: [{ name: "Magnesium citrate", amount: 220, unit: "mg", amountText: "220 mg" }],
      },
    ],
    skippedSupplements: 0,
  });

  const magnesium = summary.duplicateGroups.find((group) => group.ingredientCanonicalKey === "magnesium");
  assert.ok(magnesium);
  assert.equal(magnesium.status, "over");
  assert.equal(magnesium.surfaced, true);
  assert.equal(summary.stackLevelSummary.status, "over");
  assert.match(summary.stackLevelSummary.headline ?? "", /magnesium/i);
  assert.equal(summary.meta.dailyDoseBasisCounts.labelDailyEstimate, 1);
  assert.equal(summary.meta.dailyDoseBasisCounts.oneServingFallback, 1);
  assert.match(magnesium.products[0]?.dailyDoseBasisLabel ?? "", /estimated from label directions|estimated from 1 serving\/day/i);
});

test("Week3 safety: zinc duplicates also surface when totals exceed the UL", () => {
  const summary = buildSavedStackSummary({
    supplements: [
      {
        supplementId: "zn-1",
        productName: "Zinc Product A",
        ingredientRows: [{ name: "Zinc picolinate", amount: 25, unit: "mg", amountText: "25 mg" }],
      },
      {
        supplementId: "zn-2",
        productName: "Zinc Product B",
        ingredientRows: [{ name: "Zinc citrate", amount: 25, unit: "mg", amountText: "25 mg" }],
      },
    ],
    skippedSupplements: 0,
  });

  const zinc = summary.duplicateGroups.find((group) => group.ingredientCanonicalKey === "zinc");
  assert.ok(zinc);
  assert.equal(zinc.status, "over");
  assert.equal(zinc.surfaced, true);
});

test("Week3 safety: folate uncertainty stays out of the primary surfaced warning", () => {
  const summary = buildSavedStackSummary({
    supplements: [
      {
        supplementId: "fol-1",
        productName: "Folate Product A",
        ingredientRows: [{ name: "Folic Acid", amount: 400, unit: "mcg DFE", amountText: "400 mcg DFE" }],
      },
      {
        supplementId: "fol-2",
        productName: "Folate Product B",
        ingredientRows: [{ name: "Methylfolate", amount: 400, unit: "mcg DFE", amountText: "400 mcg DFE" }],
      },
    ],
    skippedSupplements: 0,
  });

  const folate = summary.duplicateGroups.find((group) => group.ingredientCanonicalKey === "folate");
  assert.ok(folate);
  assert.equal(folate.status, "not_comparable");
  assert.equal(folate.surfaced, false);
});

test("Week3 safety: tier2 duplicate groups do not surface as high-confidence UL warnings", () => {
  const summary = buildSavedStackSummary({
    supplements: [
      {
        supplementId: "om-1",
        productName: "Omega Product A",
        ingredientRows: [{ name: "Omega-3 Fish Oil", amount: 1000, unit: "mg", amountText: "1000 mg" }],
      },
      {
        supplementId: "om-2",
        productName: "Omega Product B",
        ingredientRows: [{ name: "EPA DHA", amount: 1000, unit: "mg", amountText: "1000 mg" }],
      },
    ],
    skippedSupplements: 0,
  });

  const omega = summary.duplicateGroups.find((group) => group.ingredientCanonicalKey === "omega_3");
  assert.ok(omega);
  assert.equal(omega.surfaced, false);
  assert.equal(omega.status, "no_ul_established");
});

test("Week3 safety: upgraded stack overlap result keeps old overlaps and reports skipped supplements", () => {
  const result = buildStackOverlapResult(
    [
      {
        supplementId: "mix-1",
        productName: "Magnesium Product A",
        ingredientNames: ["Magnesium glycinate", "Vitamin C"],
        ingredientRows: [{ name: "Magnesium glycinate", amount: 200, unit: "mg", amountText: "200 mg" }],
      },
      {
        supplementId: "mix-2",
        productName: "Magnesium Product B",
        ingredientNames: ["Magnesium citrate"],
        ingredientRows: [{ name: "Magnesium citrate", amount: 200, unit: "mg", amountText: "200 mg" }],
      },
      {
        supplementId: "mix-3",
        productName: "Unknown Product",
        ingredientNames: ["Folate"],
      },
    ],
    { maxOverlaps: 5, skippedSupplements: 1 },
  );

  assert.ok(Array.isArray(result.overlaps));
  assert.ok(result.overlaps.some((item) => item.ingredientKey === "magnesium"));
  assert.equal(result.meta.skippedSupplements, 2);
  assert.ok(result.stackLevelSummary.headline);
});
