import assert from "node:assert/strict";
import test from "node:test";

import { buildProductOverviewWhatIsItFallback } from "../../backend/src/insights/productOverviewWhatIsItFallback";

test("product overview fallback builds a shopper-readable omega-3 summary without dosage-form facts", () => {
  const result = buildProductOverviewWhatIsItFallback({
    productName: "Omega-3 1040 mg Fish Oil 1250 mg",
    productTypeHint: "Omega-3 supplement",
    primaryIngredient: "Total Omega-3 Fatty Acids",
    keyIngredients: [
      { name: "Wild Alaska Pollock Fish Oil Concentrate" },
      { name: "Total Omega-3 Fatty Acids" },
      { name: "EPA (Eicosapentaenoic Acid)" },
      { name: "DHA (Docosahexaenoic Acid)" },
    ],
    sourceContextHint: null,
    chemicalFormHint: null,
    isLikelySingleIngredient: false,
  });

  assert.equal(result.mode, "short");
  assert.match(result.lead, /omega-3 supplement/i);
  assert.match(result.whatItIs, /EPA/i);
  assert.match(result.whatItIs, /DHA/i);
  assert.doesNotMatch(result.whyPeopleTakeIt, /\bsoftgel\b/i);
  assert.doesNotMatch(result.whyPeopleTakeIt, /\b90\b/);
});

test("product overview fallback keeps single-ingredient astaxanthin readable", () => {
  const result = buildProductOverviewWhatIsItFallback({
    productName: "Astaxanthin 12 mg",
    productTypeHint: "Antioxidant supplement",
    primaryIngredient: "Astaxanthin",
    keyIngredients: [{ name: "Astaxanthin" }],
    sourceContextHint: "Haematococcus pluvialis microalgae extract",
    chemicalFormHint: null,
    isLikelySingleIngredient: true,
  });

  assert.equal(result.mode, "rich");
  assert.match(result.lead, /astaxanthin/i);
  assert.match(result.whatItIs, /microalgae/i);
  assert.match(result.whyPeopleTakeIt, /compare/i);
});

test("product overview fallback avoids policy-trigger words in formula weighting copy", () => {
  const result = buildProductOverviewWhatIsItFallback({
    productName: "Magnesium Glycinate Complex",
    productTypeHint: "magnesium",
    primaryIngredient: "Magnesium Glycinate",
    keyIngredients: [{ name: "Magnesium Glycinate" }],
    sourceContextHint: null,
    chemicalFormHint: null,
    allIngredientRows: [{ name: "Magnesium Glycinate" }],
    isLikelySingleIngredient: false,
  });
  const text = [result.lead, result.whatItIs, result.whyPeopleTakeIt].join(" ");

  assert.doesNotMatch(text, /\btreats?\b|\btreating\b|\bprevents?\b|\bcur(?:e|ing)\b/i);
  assert.match(text, /comparison weight|compare/i);
});
