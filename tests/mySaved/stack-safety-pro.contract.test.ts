import assert from "node:assert/strict";
import test from "node:test";

import { buildSavedStackSummary } from "../../backend/src/safety/stackAggregation.ts";
import { buildStackOverlapResult } from "../../backend/src/stackOverlap.ts";

test("Stack Safety Check surfaces a conservative over-UL zinc summary", () => {
  const summary = buildSavedStackSummary({
    supplements: [
      {
        supplementId: "zinc-a",
        productName: "Zinc Product A",
        ingredientRows: [{ name: "Zinc picolinate", amount: 25, unit: "mg", amountText: "25 mg" }],
      },
      {
        supplementId: "zinc-b",
        productName: "Zinc Product B",
        ingredientRows: [{ name: "Zinc citrate", amount: 20, unit: "mg", amountText: "20 mg" }],
      },
    ],
    skippedSupplements: 0,
  });

  const zinc = summary.duplicateGroups.find((group) => group.ingredientCanonicalKey === "zinc");
  assert.ok(zinc);
  assert.equal(zinc.status, "over");
  assert.equal(zinc.surfaced, true);
  assert.equal(summary.stackLevelSummary.status, "over");
  assert.match(summary.stackLevelSummary.headline ?? "", /zinc may be above the adult upper limit/i);
  assert.ok(
    summary.stackLevelSummary.detailLines.some((line) => /estimated saved-stack total/i.test(line)),
  );
  assert.ok(summary.stackLevelSummary.detailLines.some((line) => /adult supplemental UL/i.test(line)));
  assert.doesNotMatch(
    [summary.stackLevelSummary.headline, ...summary.stackLevelSummary.detailLines].join(" "),
    /\b(overdose|toxicity|toxic|unsafe|safe)\b/i,
  );
});

test("Stack Safety Check surfaces a near-UL zinc summary before it becomes an over warning", () => {
  const summary = buildSavedStackSummary({
    supplements: [
      {
        supplementId: "zinc-a",
        productName: "Zinc Product A",
        ingredientRows: [{ name: "Zinc picolinate", amount: 20, unit: "mg", amountText: "20 mg" }],
      },
      {
        supplementId: "zinc-b",
        productName: "Zinc Product B",
        ingredientRows: [{ name: "Zinc citrate", amount: 12, unit: "mg", amountText: "12 mg" }],
      },
    ],
    skippedSupplements: 0,
  });

  const zinc = summary.duplicateGroups.find((group) => group.ingredientCanonicalKey === "zinc");
  assert.ok(zinc);
  assert.equal(zinc.status, "near");
  assert.equal(zinc.surfaced, true);
  assert.match(summary.stackLevelSummary.headline ?? "", /zinc is close to the adult upper limit/i);
});

test("Stack Safety Check keeps missing-dose overlaps visible without making an UL claim", () => {
  const result = buildStackOverlapResult([
    {
      supplementId: "mag-a",
      productName: "Magnesium Product A",
      ingredientNames: ["Magnesium glycinate"],
      ingredientRows: [{ name: "Magnesium glycinate", amount: null, unit: null, amountText: null }],
    },
    {
      supplementId: "mag-b",
      productName: "Magnesium Product B",
      ingredientNames: ["Magnesium citrate"],
      ingredientRows: [{ name: "Magnesium citrate", amount: null, unit: null, amountText: null }],
    },
  ]);

  assert.ok(result.overlaps.some((item) => item.ingredientKey === "magnesium"));
  const magnesium = result.duplicateGroups.find((group) => group.ingredientCanonicalKey === "magnesium");
  assert.ok(magnesium);
  assert.equal(magnesium.surfaced, false);
  assert.notEqual(result.stackLevelSummary.status, "over");
  assert.equal(result.stackLevelSummary.headline, null);
});
