import assert from "node:assert/strict";
import { test } from "node:test";

import { buildProductSafetySummary } from "../dist/safety/productSafetySummary.js";
import { buildSavedStackSummary } from "../dist/safety/stackAggregation.js";

test("Week3 safety wording: supplements_only is never phrased as all sources", () => {
  const summary = buildProductSafetySummary({
    digest: {
      actives: [
        {
          name: "Magnesium citrate",
          amount: 200,
          unit: "mg",
          amountText: "200 mg",
          chemicalForm: null,
          chemicalFormEvidence: null,
        },
      ],
    },
  });
  const line = summary.ulGuidanceEntries[0]?.displayLine ?? "";
  assert.match(line, /supplemental magnesium/i);
  assert.doesNotMatch(line, /all sources/i);
});

test("Week3 safety wording: not comparable stays conservative", () => {
  const summary = buildProductSafetySummary({
    digest: {
      actives: [
        {
          name: "Folic Acid",
          amount: 400,
          unit: "mcg DFE",
          amountText: "400 mcg DFE",
          chemicalForm: null,
          chemicalFormEvidence: null,
        },
      ],
    },
  });
  const line = summary.ulGuidanceEntries[0]?.displayLine ?? "";
  assert.match(line, /could not be safely compared/i);
  assert.doesNotMatch(line, /\bsafe\b/i);
});

test("Week3 safety wording: no UL established is never described as no risk", () => {
  const summary = buildProductSafetySummary({
    digest: {
      actives: [
        {
          name: "N-Acetylcysteine",
          amount: 600,
          unit: "mg",
          amountText: "600 mg",
          chemicalForm: null,
          chemicalFormEvidence: null,
        },
      ],
    },
  });
  const line = summary.ulGuidanceEntries[0]?.displayLine ?? "";
  assert.match(line, /no NIH ODS upper limit is established/i);
  assert.doesNotMatch(line, /no risk/i);
});

test("Week3 safety wording: stack summary stays concise and scoped", () => {
  const summary = buildSavedStackSummary({
    supplements: [
      {
        supplementId: "mag-1",
        productName: "Magnesium A",
        dailyDoseBasis: "label_daily_estimate",
        dailyDoseBasisReason: "parsed_label_directions",
        ingredientRows: [{ name: "Magnesium glycinate", amount: 200, unit: "mg", amountText: "200 mg" }],
      },
      {
        supplementId: "mag-2",
        productName: "Magnesium B",
        dailyDoseBasisReason: "snapshot_only_no_directions",
        ingredientRows: [{ name: "Magnesium citrate", amount: 220, unit: "mg", amountText: "220 mg" }],
      },
    ],
    skippedSupplements: 1,
  });

  assert.match(summary.stackLevelSummary.headline ?? "", /magnesium may be above the adult upper limit/i);
  assert.ok(summary.stackLevelSummary.detailLines.every((line) => line.length < 140));
  assert.ok(summary.stackLevelSummary.detailLines.some((line) => /estimated saved-stack total/i.test(line)));
  assert.ok(summary.stackLevelSummary.detailLines.some((line) => /supplement/i.test(line)));
  assert.match(summary.meta.estimateBasisSummary ?? "", /label directions|1 serving\/day/i);
  assert.match(summary.meta.skippedSupplementNote ?? "", /skipped/i);
});
