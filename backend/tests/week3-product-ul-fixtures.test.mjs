import assert from "node:assert/strict";
import { test } from "node:test";

import { canonicalizeSafetyIngredient } from "../dist/safety/ingredientCanonicalization.js";
import { normalizeDoseForSafety } from "../dist/safety/doseNormalization.js";
import { buildProductSafetySummary } from "../dist/safety/productSafetySummary.js";
import { matchSafetyUl } from "../dist/safety/ulMatching.js";

const evaluateUl = ({ name, amount, unit, amountText = null }) => {
  const ingredient = canonicalizeSafetyIngredient({ rawIngredientText: name });
  const dose = normalizeDoseForSafety({
    amount,
    unit,
    amountText,
    dailyMultiplier: 1,
    dailyDoseBasis: "one_serving_fallback",
  });
  const ul = matchSafetyUl({ ingredient, dose });
  return { ingredient, dose, ul };
};

test("Week3 safety: magnesium comparable statuses are deterministic", () => {
  const below = evaluateUl({ name: "Magnesium glycinate", amount: 200, unit: "mg" });
  const near = evaluateUl({ name: "Magnesium citrate", amount: 300, unit: "mg" });
  const over = evaluateUl({ name: "Magnesium oxide", amount: 400, unit: "mg" });

  assert.equal(below.ingredient.ingredientCanonicalKey, "magnesium");
  assert.equal(below.ul.comparisonStatus, "below");
  assert.equal(near.ul.comparisonStatus, "near");
  assert.equal(over.ul.comparisonStatus, "over");
  assert.equal(over.ul.ulValueText, "350 mg");
  assert.match(over.ul.scopeNote ?? "", /supplemental magnesium/i);
});

test("Week3 safety: product UL guidance uses parsed daily label directions when available", () => {
  const summary = buildProductSafetySummary({
    digest: {
      actives: [
        {
          name: "Magnesium glycinate",
          amount: 200,
          unit: "mg",
          amountText: "200 mg",
          chemicalForm: null,
          chemicalFormEvidence: null,
        },
      ],
      labelDosing: [
        {
          population: "Adults",
          age: null,
          dose: "Take 1 capsule",
          frequency: "twice daily",
          rawText: "Adults: Take 1 capsule twice daily.",
        },
      ],
    },
  });

  assert.equal(summary.ulGuidanceEntries[0]?.comparisonStatus, "over");
  assert.match(summary.ulGuidanceEntries[0]?.displayLine ?? "", /estimated daily amount 400 mg/i);
});

test("Week3 safety: simple daily wording upgrades from one-serving fallback to a daily estimate", () => {
  const summary = buildProductSafetySummary({
    digest: {
      actives: [
        {
          name: "Magnesium glycinate",
          amount: 200,
          unit: "mg",
          amountText: "200 mg",
          chemicalForm: null,
          chemicalFormEvidence: null,
        },
      ],
      labelDosing: [
        {
          population: "Adults",
          age: null,
          dose: "Take 1 capsule",
          frequency: "daily",
          rawText: "Adults: Take 1 capsule daily.",
        },
      ],
    },
  });

  assert.equal(summary.ulGuidanceEntries[0]?.comparisonStatus, "below");
  assert.match(summary.ulGuidanceEntries[0]?.displayLine ?? "", /estimated daily amount 200 mg/i);
});

test("Week3 safety: vitamin c, zinc, and iron compare against adult UL", () => {
  const vitaminC = evaluateUl({ name: "Vitamin C", amount: 1000, unit: "mg" });
  const zinc = evaluateUl({ name: "Zinc picolinate", amount: 50, unit: "mg" });
  const iron = evaluateUl({ name: "Ferrous bisglycinate", amount: 27, unit: "mg" });

  assert.equal(vitaminC.ul.comparisonStatus, "below");
  assert.equal(vitaminC.ul.ulValueText, "2000 mg");
  assert.equal(zinc.ul.comparisonStatus, "over");
  assert.equal(zinc.ul.ulValueText, "40 mg");
  assert.equal(iron.ul.comparisonStatus, "below");
  assert.equal(iron.ul.ulValueText, "45 mg");
});

test("Week3 safety: folate DFE-style units stay conservative", () => {
  const folate = evaluateUl({
    name: "Folic Acid",
    amount: 1000,
    unit: "mcg DFE",
    amountText: "1000 mcg DFE",
  });
  const summary = buildProductSafetySummary({
    digest: {
      actives: [
        {
          name: "Folic Acid",
          amount: 1000,
          unit: "mcg DFE",
          amountText: "1000 mcg DFE",
          chemicalForm: null,
          chemicalFormEvidence: null,
        },
      ],
    },
  });

  assert.equal(folate.ul.comparisonStatus, "not_comparable");
  assert.equal(summary.ulGuidanceEntries[0]?.comparisonStatus, "not_comparable");
  assert.match(summary.ulGuidanceEntries[0]?.displayLine ?? "", /could not be safely compared/i);
});

test("Week3 safety: omega-3 and NAC fall back without overclaiming UL", () => {
  const omega = buildProductSafetySummary({
    digest: {
      actives: [
        {
          name: "Omega-3 Fish Oil",
          amount: 1000,
          unit: "mg",
          amountText: "1000 mg",
          chemicalForm: null,
          chemicalFormEvidence: null,
        },
      ],
    },
  });
  const nac = buildProductSafetySummary({
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

  assert.equal(omega.ulGuidanceEntries[0]?.comparisonStatus, "no_ul_established");
  assert.match(omega.ulGuidanceEntries[0]?.displayLine ?? "", /no NIH ODS upper limit is established/i);
  assert.equal(nac.ulGuidanceEntries[0]?.comparisonStatus, "no_ul_established");
  assert.match(nac.ulGuidanceEntries[0]?.displayLine ?? "", /no NIH ODS upper limit is established/i);
});

test("Week3 safety: non-comparable units never become safe UL comparisons", () => {
  const probiotic = evaluateUl({ name: "Probiotic Blend", amount: 20, unit: "CFU", amountText: "20 CFU" });
  assert.equal(probiotic.dose.comparableToUl, false);
  assert.equal(probiotic.ul.comparisonStatus, "no_ul_established");
});
