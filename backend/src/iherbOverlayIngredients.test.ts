import assert from "node:assert/strict";
import test from "node:test";

import {
  iherbOverlayIngredientInternals,
  normalizeIherbSupplementFactsRowsForGoalNavigatorCoverage,
} from "./iherbOverlayIngredients";

test("title fallback prefers the ingredient segment over package count segments", () => {
  const segment = iherbOverlayIngredientInternals.pickTitleFallbackIngredientSegment({
    title: "Advance Physician Formulas, Myo-Inositol, 90 Vegetable Capsules",
    brandName: "Advance Physician Formulas",
  });

  assert.equal(segment, "Myo-Inositol");
});

test("goal navigator coverage ignores header-only facts when title fallback has no structured dose", () => {
  const rows = normalizeIherbSupplementFactsRowsForGoalNavigatorCoverage({
    rows: [
      {
        substancy: "",
        amountPerServing: "Amount Per Serving",
        dailyValuePercent: "%Daily Value",
      },
    ],
    title: "Advance Physician Formulas, Myo-Inositol, 90 Vegetable Capsules",
    brandName: "Advance Physician Formulas",
    servingSize: "3 Capsules",
    servingsPerContainer: "30",
  });

  assert.deepEqual(rows, []);
});

test("goal navigator coverage still allows title fallback when the title supplies a structured dose", () => {
  const rows = normalizeIherbSupplementFactsRowsForGoalNavigatorCoverage({
    rows: [
      {
        substancy: "",
        amountPerServing: "Amount Per Serving",
        dailyValuePercent: "%Daily Value",
      },
    ],
    title: "Example Brand, Vitamin C, 1000 mg, 60 Capsules",
    brandName: "Example Brand",
    servingSize: "1 Capsule",
    servingsPerContainer: "60",
  });

  assert.deepEqual(rows, [
    {
      name: "Vitamin C",
      dose: "1000 mg",
    },
  ]);
});

test("goal navigator coverage does not merge a doseless title fallback into an existing proprietary blend row", () => {
  const rows = normalizeIherbSupplementFactsRowsForGoalNavigatorCoverage({
    rows: [
      {
        substancy: "",
        amountPerServing: "Amount Per Serving",
        dailyValuePercent: "%Daily Value",
      },
      {
        substancy:
          "Proprietary BlendL-Arginine (from L-Arginine HCI)L-CitrullineL-Citrulline DL-Malate 2:1",
        amountPerServing: "2,000 mg",
        dailyValuePercent: "**",
      },
    ],
    title: "21st Century, Nitric Oxide, 120 Vegetarian Capsules",
    brandName: "21st Century",
    servingSize: "4 Vegetarian Capsules",
    servingsPerContainer: "30",
  });

  assert.deepEqual(rows, [
    {
      name: "Nitric Oxide",
      dose: "2,000 mg",
    },
  ]);
});

test("cleanOverlayIngredientName strips OCR amount prefixes and leading embedded doses", () => {
  assert.equal(
    iherbOverlayIngredientInternals.cleanOverlayIngredientName(
      "Amount Per Serving Suntheanine® (L-Theanine)",
    ),
    "Suntheanine (L-Theanine)",
  );

  assert.equal(
    iherbOverlayIngredientInternals.cleanOverlayIngredientName(
      "183 mg** Oregano (Origanum vulgare) Oil",
    ),
    "Oregano (Origanum vulgare) Oil",
  );

  assert.equal(
    iherbOverlayIngredientInternals.cleanOverlayIngredientName(
      "5 Billion CFU Probiotic Blend",
    ),
    "5 Billion CFU Probiotic Blend",
  );
});

test("cleanOverlayIngredientName drops generic OCR residue rows", () => {
  assert.equal(iherbOverlayIngredientInternals.cleanOverlayIngredientName("provides"), null);
  assert.equal(iherbOverlayIngredientInternals.cleanOverlayIngredientName("Extract"), null);
  assert.equal(iherbOverlayIngredientInternals.cleanOverlayIngredientName("DFE"), null);
  assert.equal(iherbOverlayIngredientInternals.cleanOverlayIngredientName("from Lichen)"), null);
  assert.equal(iherbOverlayIngredientInternals.cleanOverlayIngredientName("B 9)"), null);
  assert.equal(
    iherbOverlayIngredientInternals.cleanOverlayIngredientName(
      "Suggested Ue Tel with food Sat aiy Per Serving Value %Daily dally as reqiztnn planned pegaoz Vtamn E",
    ),
    null,
  );
});

test("goal navigator coverage keeps cleaned OCR-recovered core actives", () => {
  const rows = normalizeIherbSupplementFactsRowsForGoalNavigatorCoverage({
    rows: [
      {
        substancy: "L-Theanine)",
        amountPerServing: "200 mg",
        dailyValuePercent: "*",
      },
      {
        substancy: "GABA (Gamma-Aminobutyric Acid)",
        amountPerServing: "100 mg",
        dailyValuePercent: "*",
      },
      {
        substancy: "Amount Per Serving Suntheanine® (L-Theanine)",
        amountPerServing: "200 mg",
        dailyValuePercent: "*",
      },
    ],
    title: "Dr. Mercola, L-Theanine Plus GABA, 180 Capsules",
    brandName: "Dr. Mercola",
  });

  assert.deepEqual(rows, [
    {
      name: "L-Theanine",
      dose: "200 mg",
    },
    {
      name: "GABA (Gamma-Aminobutyric Acid)",
      dose: "100 mg",
    },
    {
      name: "Suntheanine (L-Theanine)",
      dose: "200 mg",
    },
  ]);
});

test("goal navigator coverage prunes contained same-dose OCR duplicates", () => {
  const rows = normalizeIherbSupplementFactsRowsForGoalNavigatorCoverage({
    rows: [
      {
        substancy: "Myo-Inositol",
        amountPerServing: "1950 mg",
        dailyValuePercent: null,
      },
      {
        substancy: "Menstrats Myo-Inositol",
        amountPerServing: "1950 mg",
        dailyValuePercent: null,
      },
      {
        substancy: "Extract Beta Glucans",
        amountPerServing: "125 mg",
        dailyValuePercent: null,
      },
      {
        substancy: "Beta Glucans",
        amountPerServing: "125 mg",
        dailyValuePercent: null,
      },
      {
        substancy: "Liposomal",
        amountPerServing: "50 mg",
        dailyValuePercent: null,
      },
      {
        substancy: "Pregnenolone",
        amountPerServing: "50 mg",
        dailyValuePercent: null,
      },
    ],
    title: "Example Product",
    brandName: "Example Brand",
  });

  assert.deepEqual(rows, [
    {
      name: "Myo-Inositol",
      dose: "1950 mg",
    },
    {
      name: "Beta Glucans",
      dose: "125 mg",
    },
    {
      name: "Pregnenolone",
      dose: "50 mg",
    },
  ]);
});

test("goal navigator coverage treats compact OCR dose formatting as the same dose", () => {
  const rows = normalizeIherbSupplementFactsRowsForGoalNavigatorCoverage({
    rows: [
      {
        substancy: "Myo-Inositol",
        amountPerServing: "1950 mg",
        dailyValuePercent: null,
      },
      {
        substancy: "Menstrats Myo-Inositol",
        amountPerServing: "1950mg",
        dailyValuePercent: null,
      },
    ],
    title: "Conceive Plus, Women's Ovulation Support, 120 Vegan Capsules",
    brandName: "Conceive Plus",
  });

  assert.deepEqual(rows, [
    {
      name: "Myo-Inositol",
      dose: "1950 mg",
    },
  ]);
});

test("goal navigator coverage preserves enzyme activity units from verified facts rows", () => {
  const rows = normalizeIherbSupplementFactsRowsForGoalNavigatorCoverage({
    rows: [
      {
        substancy: "Amylase",
        amountPerServing: "24,000 DU",
        dailyValuePercent: "*",
      },
      {
        substancy: "Neutral Protease",
        amountPerServing: "20,000 PC",
        dailyValuePercent: "*",
      },
      {
        substancy: "Lipase",
        amountPerServing: "800 FCCLU",
        dailyValuePercent: "*",
      },
      {
        substancy: "Pectinase",
        amountPerServing: "24 endo-PGU",
        dailyValuePercent: "*",
      },
    ],
    title: "Metagenics, SpectraZyme Complete Enzymes, 180 Capsules",
    brandName: "Metagenics",
    servingSize: "2 Capsules",
    servingsPerContainer: "90",
  });

  assert.deepEqual(rows, [
    {
      name: "Amylase",
      dose: "24,000 DU",
    },
    {
      name: "Neutral Protease",
      dose: "20,000 PC",
    },
    {
      name: "Lipase",
      dose: "800 FCCLU",
    },
    {
      name: "Pectinase",
      dose: "24 endo-PGU",
    },
  ]);
});

test("goal navigator coverage rescues supplement blend totals into aggregate formula rows beyond the old source allowlist", () => {
  const rows = normalizeIherbSupplementFactsRowsForGoalNavigatorCoverage({
    rows: [
      {
        substancy: "",
        amountPerServing: "Amount Per Serving",
        dailyValuePercent: "%Daily Value",
      },
      {
        substancy:
          "Snap Detox BlendPsyllium Husk Powder, Fennel Seed Powder, Apple Pectin Powder, Ginger Root Extract",
        amountPerServing: "1.538 g",
        dailyValuePercent: "*",
      },
    ],
    title: "Snap Supplements, Detox, Advanced Cleansing Blend, 60 Capsules",
    brandName: "Snap Supplements",
    sourceZipPath: "snap-supplements.json",
    servingSize: "2 Capsules",
    servingsPerContainer: "30",
  });

  assert.equal(rows.some((row) => row.aggregateFormula === true && row.dose === "1.538 g"), true);
  assert.equal(rows.some((row) => row.name === "Psyllium Husk Powder"), true);
});

test("goal navigator coverage marks probiotic aggregate rescue rows as aggregate formulas", () => {
  const rows = normalizeIherbSupplementFactsRowsForGoalNavigatorCoverage({
    rows: [
      {
        substancy:
          "Proprietary BlendLactobacillus gasseri KS-13 Bifidobacterium bifidum G9-1 and Bifidobacterium longum MM-2",
        amountPerServing: "6 billion live cells†",
        dailyValuePercent: "*",
      },
    ],
    title: "Kyolic, Kyo-Dophilus, Multi 9 Probiotic, 180 Capsules",
    brandName: "Kyolic",
    servingSize: "3 Capsules",
    servingsPerContainer: "60",
  });

  assert.equal(
    rows.some(
      (row) =>
        row.name === "Probiotics" &&
        row.dose === "6 billion CFU" &&
        row.proprietaryBlendSource === true &&
        row.aggregateFormula === true,
    ),
    true,
  );
});

test("goal navigator coverage parses proprietary blend of prefixed herbal extracts into structured coverage rows", () => {
  const rows = normalizeIherbSupplementFactsRowsForGoalNavigatorCoverage({
    rows: [
      {
        substancy:
          "Proprietary Blend of Pre-stepped Herbal Extracts: Boldo Tree Leaf, Marigold Flower, Alder Buckthorn Bark, Mallow Leaf, Peppermint Leaf",
        amountPerServing: "588 mg",
        dailyValuePercent: "*",
      },
    ],
    title: "Alta Health, Can-Gest, A Natural Digestive Aid, 4 oz",
    brandName: "Alta Health",
    sourceZipPath: "alta-health.json",
    servingSize: "2 droppers",
    servingsPerContainer: "59",
  });

  assert.equal(rows.some((row) => row.name === "Boldo Tree Leaf"), true);
  assert.equal(rows.some((row) => row.name === "Marigold Flower"), true);
  assert.equal(rows.some((row) => row.aggregateFormula === true && row.dose === "588 mg"), true);
});

test("goal navigator coverage keeps dietary fiber rows even when the source label includes parenthetical ingredients", () => {
  const rows = normalizeIherbSupplementFactsRowsForGoalNavigatorCoverage({
    rows: [
      {
        substancy:
          "Dietary Fiber (from organic blue agave inulin, organic baobab fruit pulp powder [Adansonia digitata], and organic acacia seyal [bark])",
        amountPerServing: "4 g",
        dailyValuePercent: "14%",
      },
    ],
    title: "New Chapter, Organic Fiber Gummies, Citrus Berry, 60 Flavored Gummies",
    brandName: "New Chapter",
    sourceZipPath: "new-chapter.json",
    servingSize: "2 Gummies",
    servingsPerContainer: "30",
  });

  assert.deepEqual(rows, [
    {
      name: "Fiber",
      dose: "4 g",
    },
  ]);
});

test("goal navigator coverage can recover a title ingredient dose from description fallback sources", () => {
  const rows = normalizeIherbSupplementFactsRowsForGoalNavigatorCoverage({
    rows: [
      {
        substancy: "Turmeric Curcumin",
        amountPerServing: "",
        dailyValuePercent: null,
      },
    ],
    title: "Micro Ingredients, Turmeric Curcumin, 300 Softgels",
    brandName: "Micro Ingredients",
    sourceZipPath: "micro-ingredients.json",
    servingSize: "3 Softgels",
    servingsPerContainer: "100",
    descriptionText: "Ginger & Black Pepper Extract 3,000 mg Per Serving Made With MCT Oil",
  });

  assert.deepEqual(rows, [
    {
      name: "Turmeric Curcumin",
      dose: "3,000 mg",
    },
  ]);
});

test("goal navigator coverage can derive a powder aggregate dose from net content and servings", () => {
  const rows = normalizeIherbSupplementFactsRowsForGoalNavigatorCoverage({
    rows: [
      {
        substancy: "",
        amountPerServing: "Amount Per Serving",
        dailyValuePercent: "%Daily Value",
      },
      {
        substancy:
          "Proprietary Blend:Organic Flash-Dried Juice Powder from Alfalfa, Barley and Non-Hybrid Wheat Grass.",
        amountPerServing: "1 Level Scoop",
        dailyValuePercent: "*",
      },
    ],
    title: "Christopher's Original Formulas, Jurassic Green Nutritious Powder, 4 oz",
    brandName: "Christopher's Original Formulas",
    sourceZipPath: "christopher-s-original-formulas.json",
    servingSize: "1 Level Scoop",
    servingsPerContainer: "About 15",
  });

  assert.equal(
    rows.some(
      (row) =>
        row.aggregateFormula === true &&
        row.proprietaryBlendSource === true &&
        row.name === "Botanical Formula" &&
        row.dose === "7.56 g",
    ),
    true,
  );
});
