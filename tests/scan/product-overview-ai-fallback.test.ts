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
  assert.match(text, /equally central|compare/i);
});

test("product overview fallback does not call every blend probiotic-style", () => {
  const result = buildProductOverviewWhatIsItFallback({
    productName: "CARBION+ With Electrolytes",
    productTypeHint: "electrolyte hydration",
    primaryIngredient: "Phased-Delivery Energy Blend",
    keyIngredients: [
      { name: "Phased-Delivery Energy Blend" },
      { name: "Sodium" },
      { name: "Potassium" },
      { name: "Magnesium" },
      { name: "Total Carbohydrate" },
      { name: "Caffeine" },
    ],
    sourceContextHint: "iherb",
    chemicalFormHint: null,
    allIngredientRows: [
      { name: "Phased-Delivery Energy Blend" },
      { name: "Sodium" },
      { name: "Potassium" },
      { name: "Magnesium" },
      { name: "Total Carbohydrate" },
      { name: "Caffeine" },
    ],
    isLikelySingleIngredient: false,
  });
  const text = [result.lead, result.whatItIs, result.whyPeopleTakeIt].join(" ");

  assert.doesNotMatch(text, /probiotic-style/i);
  assert.match(text, /hydration and electrolyte formula/i);
  assert.match(text, /sodium, potassium, and magnesium balance/i);
  assert.match(text, /serving size|carbohydrate|caffeine|stimulant|blend disclosure/i);
});

test("product overview fallback explains opaque probiotic blends instead of treating proprietary blend as an ingredient", () => {
  const result = buildProductOverviewWhatIsItFallback({
    productName: "Probiotic 40 Billion CFU",
    brandName: "Example Brand",
    productTypeHint: "Probiotics",
    primaryIngredient: "Proprietary Blend",
    keyIngredients: [
      { name: "Proprietary Blend", dose: "120 mg" },
    ],
    sourceContextHint: "iherb",
    chemicalFormHint: null,
    allIngredientRows: [
      { name: "Proprietary Blend", dose: "120 mg" },
    ],
    isLikelySingleIngredient: true,
  });
  const text = [result.lead, result.whatItIs, result.whyPeopleTakeIt].join(" ");

  assert.match(result.lead, /probiotic supplement/i);
  assert.doesNotMatch(text, /Proprietary Blend is a supplement ingredient/i);
  assert.doesNotMatch(text, /probiotic-style/i);
  assert.match(text, /strain-level|strain names/i);
  assert.match(text, /CFU|storage|blend hides/i);
});

test("product overview fallback uses named probiotic strains when the label provides them", () => {
  const result = buildProductOverviewWhatIsItFallback({
    productName: "Daily Probiotic",
    brandName: "Example Brand",
    productTypeHint: "Probiotic supplement",
    primaryIngredient: "Lactobacillus acidophilus",
    keyIngredients: [
      { name: "Lactobacillus acidophilus", dose: "5 billion CFU" },
      { name: "Bifidobacterium lactis", dose: "5 billion CFU" },
    ],
    sourceContextHint: "iherb",
    chemicalFormHint: null,
    allIngredientRows: [
      { name: "Lactobacillus acidophilus", dose: "5 billion CFU" },
      { name: "Bifidobacterium lactis", dose: "5 billion CFU" },
    ],
    isLikelySingleIngredient: true,
  });
  const text = [result.lead, result.whatItIs, result.whyPeopleTakeIt].join(" ");

  assert.match(text, /Lactobacillus acidophilus/i);
  assert.match(text, /Bifidobacterium lactis/i);
  assert.match(text, /CFU/i);
  assert.doesNotMatch(text, /\btreats?\b|\bprevents?\b|\bcures?\b|\bguarantees?\b/i);
});

test("product overview fallback extracts probiotic strain names from concatenated blend lines", () => {
  const result = buildProductOverviewWhatIsItFallback({
    productName: "Acidophilus Probiotic Blend",
    brandName: "21st Century",
    productTypeHint: "Probiotics",
    primaryIngredient: "Proprietary Blend",
    keyIngredients: [
      {
        name:
          "Proprietary BlendContaining 1 billion live cultures†Lactobacillus acidophilusLactobacillus acidophilusBifidobacterium bifidumStreptococcus thermophilus",
        dose: "175 mg",
      },
    ],
    sourceContextHint: "iherb",
    chemicalFormHint: null,
    allIngredientRows: [
      {
        name:
          "Proprietary BlendContaining 1 billion live cultures†Lactobacillus acidophilusLactobacillus acidophilusBifidobacterium bifidumStreptococcus thermophilus",
        dose: "175 mg",
      },
    ],
    isLikelySingleIngredient: true,
  });
  const text = [result.lead, result.whatItIs, result.whyPeopleTakeIt].join(" ");

  assert.match(text, /Lactobacillus acidophilus/i);
  assert.match(text, /Bifidobacterium bifidum/i);
  assert.doesNotMatch(text, /Proprietary BlendContaining/i);
  assert.doesNotMatch(text, /live cultures†/i);
  assert.doesNotMatch(text, /acidophilus Lactobacillus|bifidum Streptococcus/i);
});

test("product overview fallback does not let supporting fish oil steal non-omega formula identity", () => {
  const result = buildProductOverviewWhatIsItFallback({
    productName: "Adrenal Chill - Men",
    brandName: "CanPrev",
    productTypeHint: "ashwagandha blend",
    primaryIngredient: "Ashwagandha Extract",
    keyIngredients: [
      { name: "Ashwagandha Extract" },
      { name: "Fish Oil" },
      { name: "Magnesium" },
    ],
    sourceContextHint: "official_or_brand",
    chemicalFormHint: null,
    allIngredientRows: [
      { name: "Ashwagandha Extract" },
      { name: "Fish Oil" },
      { name: "Magnesium" },
    ],
    isLikelySingleIngredient: false,
  });
  const text = [result.lead, result.whatItIs, result.whyPeopleTakeIt].join(" ");

  assert.doesNotMatch(text, /omega-3 supplement/i);
  assert.match(text, /Ashwagandha Extract-led/i);
});

test("product overview fallback does not let omega wording steal a CoQ10-led formula", () => {
  const result = buildProductOverviewWhatIsItFallback({
    productName: "CoQ10 with Omega-3",
    brandName: "Jamieson",
    productTypeHint: "Omega-3 supplement",
    primaryIngredient: "CoQ10",
    keyIngredients: [
      { name: "CoQ10" },
      { name: "Fish Oil" },
      { name: "Omega-3 fatty acids" },
    ],
    sourceContextHint: "official_or_brand",
    chemicalFormHint: null,
    allIngredientRows: [
      { name: "CoQ10" },
      { name: "Fish Oil" },
      { name: "Omega-3 fatty acids" },
    ],
    isLikelySingleIngredient: false,
  });
  const text = [result.lead, result.whatItIs, result.whyPeopleTakeIt].join(" ");

  assert.doesNotMatch(text, /This is an omega-3 supplement/i);
  assert.match(text, /CoQ10-led/i);
});

test("product overview fallback keeps prenatal multi formulas from becoming omega-only copy", () => {
  const result = buildProductOverviewWhatIsItFallback({
    productName: "Prenatal 1 with Folic Acid, DHA & Iron",
    brandName: "One-A-Day",
    productTypeHint: "Omega-3 supplement",
    primaryIngredient: "Omega-3 DHA",
    keyIngredients: [
      { name: "Omega-3 DHA" },
      { name: "Folic Acid" },
      { name: "Iron" },
    ],
    sourceContextHint: "iherb",
    chemicalFormHint: null,
    allIngredientRows: [
      { name: "Omega-3 DHA" },
      { name: "Folic Acid" },
      { name: "Iron" },
    ],
    isLikelySingleIngredient: false,
  });
  const text = [result.lead, result.whatItIs, result.whyPeopleTakeIt].join(" ");

  assert.doesNotMatch(text, /This is an omega-3 supplement/i);
  assert.match(text, /Omega-3 DHA-led|more than one disclosed ingredient/i);
});

test("single-ingredient fallback avoids broad category claims that do not match the ingredient", () => {
  const result = buildProductOverviewWhatIsItFallback({
    productName: "Milk Thistle 150 mg 60% Silymarin",
    brandName: "Webber Naturals",
    productTypeHint: "Probiotics & Digestion",
    primaryIngredient: "Milk thistle",
    keyIngredients: [{ name: "Milk thistle" }],
    sourceContextHint: "official_or_brand",
    chemicalFormHint: null,
    allIngredientRows: [{ name: "Milk thistle" }],
    isLikelySingleIngredient: true,
  });
  const text = [result.lead, result.whatItIs, result.whyPeopleTakeIt].join(" ");

  assert.match(result.lead, /Milk thistle is the main named ingredient/i);
  assert.doesNotMatch(text, /used in probiotics/i);
});

test("product overview fallback does not let companion vitamin C override a zinc-led formula", () => {
  const result = buildProductOverviewWhatIsItFallback({
    productName: "ACES + Zinc & Copper",
    brandName: "CanPrev",
    productTypeHint: "zinc and antioxidant formula",
    primaryIngredient: "Zinc",
    keyIngredients: [
      { name: "Zinc" },
      { name: "Vitamin C" },
      { name: "Copper" },
    ],
    sourceContextHint: "official_or_brand",
    chemicalFormHint: null,
    allIngredientRows: [
      { name: "Zinc" },
      { name: "Vitamin C" },
      { name: "Copper" },
    ],
    isLikelySingleIngredient: false,
  });
  const text = [result.lead, result.whatItIs, result.whyPeopleTakeIt].join(" ");

  assert.doesNotMatch(text, /vitamin C supplement built around/i);
  assert.match(text, /Zinc-led/i);
});

test("product overview fallback does not let companion vitamin C override an iron-led formula", () => {
  const result = buildProductOverviewWhatIsItFallback({
    productName: "Iron with Vitamin C, Thiamin, and Copper",
    brandName: "Bariatric Advantage",
    productTypeHint: "Iron",
    primaryIngredient: "Iron with Vitamin C",
    keyIngredients: [{ name: "Iron with Vitamin C" }],
    sourceContextHint: "iherb",
    chemicalFormHint: null,
    allIngredientRows: [{ name: "Iron with Vitamin C" }],
    isLikelySingleIngredient: false,
  });
  const text = [result.lead, result.whatItIs, result.whyPeopleTakeIt].join(" ");

  assert.doesNotMatch(text, /vitamin C supplement built around/i);
  assert.match(text, /Iron with Vitamin C-led iron formula/i);
  assert.doesNotMatch(text, /\ba Iron\b/i);
});

test("product overview fallback ignores broad digestion categories for liver-focused milk thistle formulas", () => {
  const result = buildProductOverviewWhatIsItFallback({
    productName: "Liver Health with Milk Thistle, Turmeric",
    brandName: "Webber Naturals",
    productTypeHint: "Probiotics & Digestion",
    primaryIngredient: "Milk Thistle Extract (Silybum marianum) (seed) (60% silymarin)",
    keyIngredients: [
      { name: "Milk Thistle Extract (Silybum marianum) (seed) (60% silymarin)" },
      { name: "Curcuminoids (Curcuma longa) (rhizome)" },
      { name: "Schisandra Powder (Schisandra chinensis) (fruit)" },
      { name: "Alpha-Lipoic Acid" },
    ],
    sourceContextHint: "official_or_brand",
    chemicalFormHint: null,
    allIngredientRows: [
      { name: "Milk Thistle Extract (Silybum marianum) (seed) (60% silymarin)" },
      { name: "Curcuminoids (Curcuma longa) (rhizome)" },
      { name: "Schisandra Powder (Schisandra chinensis) (fruit)" },
      { name: "Alpha-Lipoic Acid" },
    ],
    isLikelySingleIngredient: false,
  });
  const text = [result.lead, result.whatItIs, result.whyPeopleTakeIt].join(" ");

  assert.match(result.lead, /Milk thistle seed extract-led liver-focused formula/i);
  assert.doesNotMatch(text, /probiotics? & digestion/i);
});

test("product overview fallback avoids brand-like product type hints and long extract tails", () => {
  const result = buildProductOverviewWhatIsItFallback({
    productName: "Adrenal Chill - Men",
    brandName: "CanPrev",
    productTypeHint: "CanPrev",
    primaryIngredient:
      "KSM-66 Ashwagandha (root, Withania somnifera) 12:1 extract equivalent to 3600mg of dry root, standardized to 5.0% withanolides*",
    keyIngredients: [
      {
        name:
          "KSM-66 Ashwagandha (root, Withania somnifera) 12:1 extract equivalent to 3600mg of dry root, standardized to 5.0% withanolides*",
      },
      { name: "Magnesium" },
    ],
    sourceContextHint: "official_or_brand",
    chemicalFormHint: null,
    allIngredientRows: [
      {
        name:
          "KSM-66 Ashwagandha (root, Withania somnifera) 12:1 extract equivalent to 3600mg of dry root, standardized to 5.0% withanolides*",
      },
      { name: "Magnesium" },
    ],
    isLikelySingleIngredient: false,
  });
  const text = [result.lead, result.whatItIs, result.whyPeopleTakeIt].join(" ");

  assert.doesNotMatch(text, /canprev formula/i);
  assert.doesNotMatch(text, /equivalent to 3600mg|standardized to 5\.0%/i);
  assert.match(result.lead, /Ashwagandha/i);
  assert.match(result.lead, /multi-ingredient formula/i);
  assert.doesNotMatch(result.whatItIs, /such as[^.]*KSM-66 Ashwagandha extract/i);
});

test("product overview fallback avoids marketing detox and duplicate formula wording", () => {
  const liver = buildProductOverviewWhatIsItFallback({
    productName: "Liver Cleanse",
    brandName: "Ancient Nutrition",
    productTypeHint: "Liver Detox",
    primaryIngredient: "Milk Thistle Seed Extract",
    keyIngredients: [{ name: "Milk Thistle Seed Extract" }, { name: "Reishi Mushroom" }],
    sourceContextHint: "iherb",
    chemicalFormHint: null,
    allIngredientRows: [{ name: "Milk Thistle Seed Extract" }, { name: "Reishi Mushroom" }],
    isLikelySingleIngredient: false,
  });
  const glucosamine = buildProductOverviewWhatIsItFallback({
    productName: "Glucosamine Chondroitin Formula",
    productTypeHint: "Glucosamine Chondroitin Formulas",
    primaryIngredient: "Glucosamine Sulfate",
    keyIngredients: [{ name: "Glucosamine Sulfate" }, { name: "Chondroitin Sulfate" }],
    sourceContextHint: "iherb",
    chemicalFormHint: null,
    allIngredientRows: [{ name: "Glucosamine Sulfate" }, { name: "Chondroitin Sulfate" }],
    isLikelySingleIngredient: false,
  });

  assert.doesNotMatch([liver.lead, liver.whatItIs, liver.whyPeopleTakeIt].join(" "), /\bdetox\b/i);
  assert.match(liver.lead, /liver-focused formula/i);
  assert.doesNotMatch(glucosamine.lead, /formula formula/i);
  assert.match(glucosamine.lead, /glucosamine chondroitin formula/i);
});

test("product overview fallback cleans mixed milk thistle botanical blend anchors", () => {
  const result = buildProductOverviewWhatIsItFallback({
    productName: "Ancient Nutrition, Liver Cleanse, 90 Capsules",
    brandName: "Ancient Nutrition",
    productTypeHint: "Liver Cleanse",
    primaryIngredient:
      "Superfood BlendRegenerative Organic Certified® Reishi (Ganoderma lucidum) Mushroom Myceliated Milk Thistle Seed Extract, Organic Fermented Burdock Root, Organic Fermented Bupleurum Root.",
    keyIngredients: [
      {
        name:
          "Superfood BlendRegenerative Organic Certified® Reishi (Ganoderma lucidum) Mushroom Myceliated Milk Thistle Seed Extract, Organic Fermented Burdock Root, Organic Fermented Bupleurum Root.",
      },
      { name: "Bacillus subtilis AB22" },
    ],
    sourceContextHint: "iherb",
    chemicalFormHint: null,
    allIngredientRows: [
      {
        name:
          "Superfood BlendRegenerative Organic Certified® Reishi (Ganoderma lucidum) Mushroom Myceliated Milk Thistle Seed Extract, Organic Fermented Burdock Root, Organic Fermented Bupleurum Root.",
      },
      { name: "Bacillus subtilis AB22" },
    ],
    isLikelySingleIngredient: false,
  });
  const text = [result.lead, result.whatItIs, result.whyPeopleTakeIt].join(" ");

  assert.match(result.lead, /Milk thistle seed extract-led liver(?:-focused)? formula/i);
  assert.match(text, /Bacillus subtilis/i);
  assert.doesNotMatch(text, /Reishi Mushroom Myceliated Milk Thistle Seed Extract-led/i);
  assert.doesNotMatch(text, /Regenerative Organic Certified|Superfood Blend/i);
});

test("product overview fallback removes dangling parentheses from cleaned active names", () => {
  const result = buildProductOverviewWhatIsItFallback({
    productName: "Active Multi Drink Mix",
    brandName: "CanPrev",
    productTypeHint: "CanPrev",
    primaryIngredient: "Choline (as Choline L(+) Bitartrate) (VitaCholine)****",
    keyIngredients: [
      { name: "Choline (as Choline L(+) Bitartrate) (VitaCholine)****" },
      { name: "Inositol (inositol hexanicotinate)" },
      { name: "Magnesium" },
    ],
    sourceContextHint: "official_or_brand",
    chemicalFormHint: null,
    allIngredientRows: [
      { name: "Choline (as Choline L(+) Bitartrate) (VitaCholine)****" },
      { name: "Inositol (inositol hexanicotinate)" },
      { name: "Magnesium" },
    ],
    isLikelySingleIngredient: false,
  });
  const text = [result.lead, result.whatItIs, result.whyPeopleTakeIt].join(" ");

  assert.match(result.lead, /Choline Bitartrate-led multi-ingredient formula/i);
  assert.doesNotMatch(text, /Bitartrate\)|\(\)/i);
});
