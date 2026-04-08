import assert from "node:assert/strict";
import test from "node:test";

import {
  iherbOverlayIngredientInternals,
  normalizeIherbSupplementFactsRows,
  normalizeIherbSupplementFactsRowsWithTitleFallback,
} from "../src/iherbOverlayIngredients";

test("overlay ingredient normalization keeps a single disclosed proprietary blend member with its dose", () => {
  const rows = normalizeIherbSupplementFactsRows([
    {
      substancy: "Proprietary Blend:Yerba Mate Leaf (Ilex Paraguariensis) ⓞ",
      amountPerServing: "1.5 ml",
    },
  ]);

  assert.deepEqual(rows, [
    {
      name: "Yerba Mate Leaf (Ilex Paraguariensis)",
      dose: "1.5 ml",
    },
  ]);
});

test("overlay ingredient normalization splits multi-member proprietary blends and clears shared blend dose", () => {
  const rows = normalizeIherbSupplementFactsRows([
    {
      substancy:
        "Proprietary Blend:Cranberry fruit W, Uva Ursi leaf O, Cleavers aerials O, Usnea lichen W",
      amountPerServing: "3 ml",
    },
  ]);

  assert.deepEqual(rows, [
    { name: "Cranberry fruit", dose: null },
    { name: "Uva Ursi leaf", dose: null },
    { name: "Cleavers aerials", dose: null },
    { name: "Usnea lichen", dose: null },
  ]);
});

test("overlay ingredient internals expand blend members deterministically", () => {
  const members = iherbOverlayIngredientInternals.expandBlendMemberRows(
    "Proprietary Blend:Passionflower aerials (o), Scullcap aerials (o), Hops strobile (o)",
    "3 ml",
  );

  assert.deepEqual(members, [
    { name: "Passionflower aerials", dose: null, proprietaryBlendSource: true },
    { name: "Scullcap aerials", dose: null, proprietaryBlendSource: true },
    { name: "Hops strobile", dose: null, proprietaryBlendSource: true },
  ]);
});

test("overlay ingredient normalization keeps non-blend actives when complex appears only inside parentheses", () => {
  const rows = normalizeIherbSupplementFactsRows([
    {
      substancy: "Grape Seed Phytosome † (Vitis vinifera extract / Phospholipid complex)",
      amountPerServing: "100 mg",
    },
  ]);

  assert.deepEqual(rows, [
    {
      name: "Grape Seed Phytosome † (Vitis vinifera extract / Phospholipid complex)",
      dose: "100 mg",
    },
  ]);
});

test("overlay ingredient normalization can fall back to a simple supplement title when facts are header-only", () => {
  const rows = normalizeIherbSupplementFactsRowsWithTitleFallback({
    rows: [
      {
        substancy: "",
        amountPerServing: "Amount Per Serving",
        dailyValuePercent: "%Daily Value",
      },
    ],
    title: "Bariatric Advantage, Biotin, 5,000 mcg, 90 Capsules",
    brandName: "Bariatric Advantage",
  });

  assert.deepEqual(rows, [
    {
      name: "Biotin",
      dose: "5,000 mcg",
    },
  ]);
});

test("overlay ingredient normalization can merge a title dose into existing dose-less rows", () => {
  const rows = normalizeIherbSupplementFactsRowsWithTitleFallback({
    rows: [
      {
        substancy: "AHCC®",
        amountPerServing: "",
        dailyValuePercent: "†",
      },
    ],
    title: "Source Naturals, AHCC®, 60 Capsules (0.5 g per Capsule)",
    brandName: "Source Naturals",
  });

  assert.deepEqual(rows, [
    {
      name: "AHCC",
      dose: "0.5 g per Capsule",
    },
  ]);
});

test("overlay ingredient normalization can append a title-derived row when blend members have no usable dose", () => {
  const rows = normalizeIherbSupplementFactsRowsWithTitleFallback({
    rows: [
      {
        substancy:
          "AHCC® Proprietary Blend:Shiitake Mycelia Extract, Carnauba Wax, Microcrystalline Cellulose, Dextrin, and alpha-Cyclodextrin.",
        amountPerServing: "1 g",
        dailyValuePercent: "†",
      },
    ],
    title: "Planetary Herbals, AHCC®, 500 mg, 60 Capsules",
    brandName: "Planetary Herbals",
  });

  assert.ok(rows.some((row) => row.name === "AHCC" && row.dose === "500 mg"));
});

test("overlay ingredient normalization can rescue AHCC proprietary blend rows from title", () => {
  const rows = normalizeIherbSupplementFactsRowsWithTitleFallback({
    rows: [
      {
        substancy: "A.H.C.C. Proprietary Blend",
        amountPerServing: "1 g",
        dailyValuePercent: "†",
      },
    ],
    title: "American Biosciences, ImmPower® AHCC®, 500 mg, 30 Vegetarian Capsules",
    brandName: "American Biosciences",
  });

  assert.ok(rows.some((row) => row.name === "ImmPower AHCC" && row.dose === "500 mg"));
});

test("overlay ingredient normalization adds a probiotic CFU aggregate row from live cultures disclosure", () => {
  const rows = normalizeIherbSupplementFactsRows([
    {
      substancy:
        "Proprietary BlendContaining 20 billion live cultures Lactobacillus acidophilus, Bifidobacterium lactis, Lactobacillus plantarum",
      amountPerServing: "1,250 mg",
      dailyValuePercent: "†",
    },
  ]);

  assert.ok(rows.some((row) => row.name === "Probiotics" && row.dose === "20 billion CFU"));
});

test("overlay ingredient normalization adds a probiotic CFU aggregate row from organism disclosure", () => {
  const rows = normalizeIherbSupplementFactsRows([
    {
      substancy:
        "Proprietary Blend of 10 Strains of Probiotic Bacteria:Lactobacillus acidophilus DDS-1, Lactobacillus plantarum",
      amountPerServing: "30 Billion Organism †",
      dailyValuePercent: "**",
    },
  ]);

  assert.ok(rows.some((row) => row.name === "Probiotics" && row.dose === "30 Billion CFU"));
});

test("overlay ingredient normalization derives embedded enzyme activity member doses when amount is blank", () => {
  const rows = normalizeIherbSupplementFactsRows([
    {
      substancy: "Lactose-Digesting Enzyme Lactase (5,000 ALU)",
      amountPerServing: "",
      dailyValuePercent: null,
    },
    {
      substancy: "Protein-Digesting Enzyme Protease Thera-blend® (12,500 HUT)",
      amountPerServing: "",
      dailyValuePercent: null,
    },
  ]);

  assert.ok(rows.some((row) => row.name === "Lactase" && row.dose === "5,000 ALU"));
  assert.ok(rows.some((row) => row.name === "Protease Thera-blend" && row.dose === "12,500 HUT"));
});

test("overlay ingredient normalization treats dietary fiber rows as fiber support ingredients", () => {
  const rows = normalizeIherbSupplementFactsRows([
    {
      substancy: "Dietary Fiber",
      amountPerServing: "5 g",
      dailyValuePercent: "18%†",
    },
  ]);

  assert.deepEqual(rows, [
    {
      name: "Fiber",
      dose: "5 g",
    },
  ]);
});

test("overlay ingredient normalization can derive probiotic CFU aggregate rows from amount text", () => {
  const rows = normalizeIherbSupplementFactsRows([
    {
      substancy: "Intelliflora™ Blend:",
      amountPerServing: "150 mg5 billion CFUs",
      dailyValuePercent: null,
    },
  ]);

  assert.ok(rows.some((row) => row.name === "Probiotics" && row.dose === "5 billion CFU"));
});

test("overlay ingredient normalization can rescue Pro-Bio header-only probiotic formulas from description dose", () => {
  const rows = normalizeIherbSupplementFactsRowsWithTitleFallback({
    rows: [
      {
        substancy: "",
        amountPerServing: "Amount Per Serving",
        dailyValuePercent: "%Daily Value",
      },
    ],
    title: "Enzymedica, Pro-Bio®, 120 Capsules",
    brandName: "Enzymedica",
    descriptionText:
      "Guaranteed-Potency Probiotic 8 Strains of Probiotics Provide 10 Billion CFUs Per Single-Dose Capsule.",
  });

  assert.ok(rows.some((row) => row.name === "Probiotics" && row.dose === "10 Billion CFU"));
});

test("overlay ingredient normalization can rescue Eclectic extract titles from description dose", () => {
  const rows = normalizeIherbSupplementFactsRowsWithTitleFallback({
    rows: [],
    title: "Eclectic Herb, Ashwagandha Extract, 1 fl oz (30 ml)",
    brandName: "Eclectic Herb",
    sourceZipPath: "eclectic-herb.json",
    descriptionText:
      "Stress Support Herbal Extract Suggested use: Mix 1 full dropper in water. Dry Herb Strength: 1:4 (250 mg/ml).",
  });

  assert.ok(rows.some((row) => row.name === "Ashwagandha Extract" && row.dose === "250 mg"));
});

test("overlay ingredient normalization can rescue probiotic formulas from description-only live culture dose", () => {
  const rows = normalizeIherbSupplementFactsRowsWithTitleFallback({
    rows: [
      {
        substancy: "",
        amountPerServing: "Amount Per Serving",
        dailyValuePercent: "%DV",
      },
    ],
    title: "HUM Nutrition, Gut Instinct, 30 Vegan Capsules",
    brandName: "HUM Nutrition",
    sourceZipPath: "hum-nutrition.json",
    descriptionText:
      "Probiotics to Support Digestion, Health & Immunity 25 BN Probiotic Organisms (At Time of Manufacture) 10 Strains.",
  });

  assert.ok(rows.some((row) => row.name === "Probiotics" && row.dose === "25 BN CFU"));
});

test("overlay ingredient normalization keeps a digestive enzyme aggregate row when multi-enzyme members share one blend dose", () => {
  const rows = normalizeIherbSupplementFactsRows([
    {
      substancy: "Proprietary Digestive Enzyme BlendAmylase, Protease, Lipase, Cellulase",
      amountPerServing: "220 mg",
      dailyValuePercent: "†",
    },
  ]);

  assert.ok(rows.some((row) => row.name === "Digestive Enzymes" && row.dose === "220 mg"));
  assert.ok(rows.some((row) => row.name === "Amylase" && row.dose === null));
});

test("overlay ingredient normalization can rescue a single generic blend row with a strong title ingredient signal", () => {
  const rows = normalizeIherbSupplementFactsRowsWithTitleFallback({
    rows: [
      {
        substancy: "Proprietary BlendWhole Spectrum Black Cumin seed powder and extract",
        amountPerServing: "450 mg",
        dailyValuePercent: "†",
      },
    ],
    title: "Amazing Herbs, Black Seed, 60 Vegetarian Capsules",
    brandName: "Amazing Herbs",
  });

  assert.deepEqual(rows, [
    {
      name: "Black Seed",
      dose: "450 mg",
    },
  ]);
});

test("overlay ingredient normalization can derive a per-serving liquid dose for single-herb extract rescues", () => {
  const rows = normalizeIherbSupplementFactsRowsWithTitleFallback({
    rows: [
      {
        substancy: "Proprietary Blend:Wildcrafted Dandelion Root",
        amountPerServing: "10 Drops",
        dailyValuePercent: "*",
      },
    ],
    title: "Christopher's Original Formulas, Dandelion Root Extract, 2 fl oz (59 ml)",
    brandName: "Christopher's Original Formulas",
    servingsPerContainer: "57",
  });

  assert.deepEqual(rows, [
    {
      name: "Dandelion Root Extract",
      dose: "1.04 ml",
    },
  ]);
});

test("overlay ingredient normalization treats dropperful doses as serving-count liquid extract rescues", () => {
  const rows = normalizeIherbSupplementFactsRowsWithTitleFallback({
    rows: [
      {
        substancy: "Organic Dandelion Root",
        amountPerServing: "1 Dropperful",
        dailyValuePercent: "*",
      },
    ],
    title: "Christopher's Original Formulas, Dandelion Root Extract, 2 fl oz (59 ml)",
    brandName: "Christopher's Original Formulas",
    servingSize: "1 Dropperful",
    servingsPerContainer: "60",
  });

  assert.deepEqual(rows, [
    {
      name: "Dandelion Root Extract",
      dose: "0.98 ml",
    },
  ]);
});

test("overlay ingredient normalization can add a conservative aggregate row for allowlisted herbal formula sources", () => {
  const rows = normalizeIherbSupplementFactsRowsWithTitleFallback({
    rows: [
      {
        substancy:
          "Proprietary Blend:Organic Dandelion Leaf, Organic Beet Root, Wildcrafted Yellow Dock Root, Wildcrafted Nettle Leaf, and Organic Spirulina.",
        amountPerServing: "920 mg",
        dailyValuePercent: "†",
      },
    ],
    title: "Christopher's Original Formulas, Herbal Iron Formula, 100 Vegetarian Caps",
    brandName: "Christopher's Original Formulas",
    sourceZipPath: "christopher-s-original-formulas.json",
  });

  assert.ok(
    rows.some(
      (row) =>
        row.name === "Herbal Iron Formula"
        && row.dose === "920 mg"
        && row.proprietaryBlendSource === true
        && row.aggregateFormula === true,
    ),
  );
});

test("overlay ingredient normalization can add a conservative aggregate row for Gaia herbal extract blends", () => {
  const rows = normalizeIherbSupplementFactsRowsWithTitleFallback({
    rows: [
      {
        substancy:
          "Herbal Extract BlendOrganic Passionflower (Passiflora incarnata) flowering vine, Organic Hops (Humulus lupulus) strobile, Organic Skullcap (Scutellaria lateriflora) aerial parts extract, Organic Valerian (Valeriana officinalis) root extract, Organic California Poppy (Eschscholzia californica) whole plant, Organic Vervain aerial parts, Organic Gotu Kola (Centella asiatica) leaf, Organic Lavender flower essential oil",
        amountPerServing: "1,731 mg",
        dailyValuePercent: "†",
      },
    ],
    title: "Gaia Herbs, Sound Sleep®, 60 Liquid Phyto-Caps®",
    brandName: "Gaia Herbs",
    sourceZipPath: "gaia-herbs.json",
  });

  assert.ok(
    rows.some(
      (row) =>
        row.name === "Sound Sleep"
        && row.dose === "1,731 mg"
        && row.proprietaryBlendSource === true
        && row.aggregateFormula === true,
    ),
  );
});

test("overlay ingredient normalization can add a conservative aggregate row for Terry Naturally formulas", () => {
  const rows = normalizeIherbSupplementFactsRowsWithTitleFallback({
    rows: [
      {
        substancy:
          "Proprietary ComplexD-Limonene from Orange (Citrus sinensis) Peel Oil, Sea Buckthorn (Hippophae rhamnoides) Berry Pump andSeed Oil via supercritical CO2 extraction",
        amountPerServing: "600 mg",
        dailyValuePercent: "**",
      },
    ],
    title: "Terry Naturally, Heartburn Rescue, 30 Softgels",
    brandName: "Terry Naturally",
    sourceZipPath: "terry-naturally.json",
  });

  assert.ok(
    rows.some(
      (row) =>
        row.name === "Heartburn Rescue"
        && row.dose === "600 mg"
        && row.proprietaryBlendSource === true
        && row.aggregateFormula === true,
    ),
  );
});

test("overlay ingredient normalization can add a conservative aggregate row for Ancient Nutrition formulas", () => {
  const rows = normalizeIherbSupplementFactsRowsWithTitleFallback({
    rows: [
      {
        substancy:
          "Organic Fermented Botanical BlendOrganic Fermented Ashwagandha Root, Organic Ashwagandha Root and Leaf Extract, Organic Fermented Black Pepper Fruit.",
        amountPerServing: "800 mg",
        dailyValuePercent: "+",
      },
    ],
    title: "Ancient Nutrition, Ashwagandha, 30 Tablets",
    brandName: "Ancient Nutrition",
    sourceZipPath: "ancient-nutrition.json",
  });

  assert.ok(
    rows.some(
      (row) =>
        row.name === "Ashwagandha"
        && row.dose === "800 mg"
        && row.proprietaryBlendSource === true
        && row.aggregateFormula === true,
    ),
  );
});

test("overlay ingredient normalization can add a conservative aggregate row for Banyan Botanicals formulas", () => {
  const rows = normalizeIherbSupplementFactsRowsWithTitleFallback({
    rows: [
      {
        substancy: "Proprietary Blend",
        amountPerServing: "1000 mg",
        dailyValuePercent: "†",
      },
      {
        substancy:
          "Ashwagandha root, Withania somnifera+‡, Shatavari root, Asparagus racemosus+‡, Gotu Kola aerials, Centella asiatica+‡, Amla fruit phyllanthis emblica+‡, Indian Tinospora stem Tinospora cordifolia+‡, Tribulus fruit Tribulus terrestris+‡, Arjuna bark Terminalia arjuna+, Mucuna seed Mucuna pruriens+‡, Ginger rhizome, Zingiber officinale+‡, Long Pepper fruit Piper longum+‡, Cardamom seed Elettaria cardamomum+",
        amountPerServing: "",
        dailyValuePercent: null,
      },
    ],
    title: "Banyan Botanicals, Stress Ease, 90 Tablets",
    brandName: "Banyan Botanicals",
    sourceZipPath: "banyan-botanicals.json",
    servingSize: "2 tablets",
    servingsPerContainer: "45",
  });

  assert.ok(
    rows.some(
      (row) =>
        row.name === "Stress Ease"
        && row.dose === "1000 mg"
        && row.proprietaryBlendSource === true
        && row.aggregateFormula === true,
    ),
  );
});

test("overlay ingredient normalization can add a conservative aggregate row for Paradise Herbs formulas", () => {
  const rows = normalizeIherbSupplementFactsRowsWithTitleFallback({
    rows: [
      {
        substancy: "Proprietary Blend of Herbal ExtractsTribulus terrestris extract, Tongkat Ali root extract, Muira puama bark extract",
        amountPerServing: "700 mg",
        dailyValuePercent: "**",
      },
    ],
    title: "Paradise Herbs, Whole Man, Men's Libido Vitality Formula, 60 Vegetarian Capsules",
    brandName: "Paradise Herbs",
    sourceZipPath: "paradise-herbs.json",
  });

  assert.ok(
    rows.some(
      (row) =>
        row.name === "Whole Man"
        && row.dose === "700 mg"
        && row.proprietaryBlendSource === true
        && row.aggregateFormula === true,
    ),
  );
});

test("overlay ingredient normalization can add a conservative aggregate row for Michael's Health formulas", () => {
  const rows = normalizeIherbSupplementFactsRowsWithTitleFallback({
    rows: [
      {
        substancy:
          "Proprietary BlendFenugreek Seed (Trigonella foenum graecum), Horehound (Aerial Parts) (Marrubium vulgare), Slippery Elm Bark (Ulmus rubra), Mullein Leaf (Verbascum thapsus) and Thyme Leaf (Thymus vulgaris)",
        amountPerServing: "3.3 g (3,300 mg)",
        dailyValuePercent: "*",
      },
    ],
    title: "Michael's Health, LNG, 120 Vegetarian Tablets",
    brandName: "Michael's Health",
    sourceZipPath: "michaels-health.json",
  });

  assert.ok(
    rows.some(
      (row) =>
        row.name === "LNG"
        && row.dose === "3.3 g (3,300 mg)"
        && row.proprietaryBlendSource === true
        && row.aggregateFormula === true,
    ),
  );
});

test("overlay ingredient normalization can add a conservative aggregate row for Enzymedica digestive blends", () => {
  const rows = normalizeIherbSupplementFactsRowsWithTitleFallback({
    rows: [
      {
        substancy: "Digest Complete® Enzyme Blend",
        amountPerServing: "215 mg",
        dailyValuePercent: "†",
      },
    ],
    title: "Enzymedica, Digest Complete®, 90 Capsules",
    brandName: "Enzymedica",
    sourceZipPath: "enzymedica.json",
  });

  assert.ok(
    rows.some(
      (row) =>
        row.name === "Digest Complete"
        && row.dose === "215 mg"
        && row.proprietaryBlendSource === true
        && row.aggregateFormula === true,
    ),
  );
});

test("overlay ingredient normalization can add a conservative aggregate row for Enzymedica probiotic titles", () => {
  const rows = normalizeIherbSupplementFactsRowsWithTitleFallback({
    rows: [
      {
        substancy: "",
        amountPerServing: "Amount Per Serving",
        dailyValuePercent: "%Daily Value",
      },
    ],
    title: "Enzymedica, Pro-Bio®, 120 Capsules",
    brandName: "Enzymedica",
    sourceZipPath: "enzymedica.json",
    descriptionText:
      "Guaranteed-Potency Probiotic 8 Strains of Probiotics Provide 10 Billion CFUs Per Single-Dose Capsule.",
  });

  assert.ok(rows.some((row) => row.name === "Probiotics" && row.dose === "10 Billion CFU"));
});

test("overlay ingredient normalization can add a conservative aggregate row for HUM enzyme blends", () => {
  const rows = normalizeIherbSupplementFactsRowsWithTitleFallback({
    rows: [
      {
        substancy:
          "Proprietary Enzyme BlendTO BREAK DOWN PROTEIN: Bromelain, Papain, Protease 3.0, Protease 4.5, Protease 6.0, Peptidase, Neutral bacterial proteaseTO BREAK DOWN FATS: LipaseTO BREAK DOWN CARBS: Amylase, Glucoamylase, Alpha-galactosidase, Invertase, DiastaseTO BREAK DOWN FIBER: Hemicellulase, Cellulase AN, Beta-glucanase, PhytaseTO BREAK DOWN MILK SUGAR: Lactase",
        amountPerServing: "374 mg",
        dailyValuePercent: "**",
      },
    ],
    title: "HUM Nutrition, Flatter Me®, 60 Vegan Capsules",
    brandName: "HUM Nutrition",
    sourceZipPath: "hum-nutrition.json",
  });

  assert.ok(
    rows.some(
      (row) =>
        row.name === "Flatter Me"
        && row.dose === "374 mg"
        && row.proprietaryBlendSource === true
        && row.aggregateFormula === true,
    ),
  );
});

test("overlay ingredient normalization can add a conservative aggregate row for Metabolic Nutrition blends", () => {
  const rows = normalizeIherbSupplementFactsRowsWithTitleFallback({
    rows: [
      {
        substancy: "Proprietary Blend",
        amountPerServing: "566 mg",
        dailyValuePercent: "**",
      },
      {
        substancy:
          "Melatonin, Zinc, L-Theanine, Magnesium and Rhodiola rosea",
        amountPerServing: "",
        dailyValuePercent: null,
      },
    ],
    title: "Metabolic Nutrition, Relaxitrol, 60 Capsules",
    brandName: "Metabolic Nutrition",
    sourceZipPath: "metabolic-nutrition.json",
  });

  assert.ok(
    rows.some(
      (row) =>
        row.name === "Relaxitrol"
        && row.dose === "566 mg"
        && row.proprietaryBlendSource === true
        && row.aggregateFormula === true,
    ),
  );
});

test("overlay ingredient normalization can add a conservative aggregate row for Solaray blend titles", () => {
  const rows = normalizeIherbSupplementFactsRowsWithTitleFallback({
    rows: [
      {
        substancy:
          "Proprietary BlendValerian (valeriana officinalis) (root), Hops (Humulus lupulus) (cone), Skullcap (Scutellaria lateriflora) (aerial), Passion Flower (Passiflora incarnata) (flower), Dandelion (Taraxacum officinale) (root), Chamomile (Matricaria recutita) (flowering tops), Marshmallow (Althaea officinalis) (root), Hawthorn (Crataegus oxyacantha) (berry)",
        amountPerServing: "400 mg",
        dailyValuePercent: "*",
      },
    ],
    title: "Solaray, Sleep™ Blend SP-17, 100 VegCaps",
    brandName: "Solaray",
    sourceZipPath: "solaray.json",
  });

  assert.ok(
    rows.some(
      (row) =>
        row.name === "Sleep Blend"
        && row.dose === "400 mg"
        && row.proprietaryBlendSource === true
        && row.aggregateFormula === true,
    ),
  );
});

test("overlay ingredient normalization can add a conservative aggregate row for Nature's Way blends", () => {
  const rows = normalizeIherbSupplementFactsRowsWithTitleFallback({
    rows: [
      {
        substancy:
          "7-Herb Proprietary BlendOrganic Echinacea purpurea (stem, leaf, flower), Goldenseal (root), Echinacea angustifolia (root), Burdock (root), Gentian (root), Cayenne Pepper (fruit), Wood Betony (stem, leaf, flower)",
        amountPerServing: "900 mg",
        dailyValuePercent: "**",
      },
    ],
    title: "Nature's Way, Echinacea Goldenseal, 100 Vegan Capsules",
    brandName: "Nature's Way",
    sourceZipPath: "nature-s-way.json",
  });

  assert.ok(
    rows.some(
      (row) =>
        row.name === "Echinacea Goldenseal"
        && row.dose === "900 mg"
        && row.proprietaryBlendSource === true
        && row.aggregateFormula === true,
    ),
  );
});

test("overlay ingredient normalization can add a conservative aggregate row for Dragon Herbs formulas", () => {
  const rows = normalizeIherbSupplementFactsRowsWithTitleFallback({
    rows: [
      {
        substancy:
          "Proprietary Extract Blend:Prepared He Shou Wu root, Dang Gui root, Eleuthero root, Prepared Rehmannia root, Aged Tangerine rind, Red Jujube Dates, Chinese Licorice root.",
        amountPerServing: "1500 mg",
        dailyValuePercent: "†",
      },
    ],
    title: "Dragon Herbs, Shou Wu Formulation, 500 mg, 100 Vegetarian Capsules",
    brandName: "Dragon Herbs",
    sourceZipPath: "dragon-herbs.json",
  });

  assert.ok(
    rows.some(
      (row) =>
        row.name === "Shou Wu Formulation"
        && row.dose === "1500 mg"
        && row.proprietaryBlendSource === true
        && row.aggregateFormula === true,
    ),
  );
});

test("overlay ingredient normalization can derive liquid aggregate formula doses for allowlisted Christopher sources", () => {
  const rows = normalizeIherbSupplementFactsRowsWithTitleFallback({
    rows: [
      {
        substancy:
          "Proprietary Blend:Wildcrafted Barberry Root Bark, Wildcrafted Wild Yam Root, Wildcrafted Cramp Bark, Organic Fennel Seed, Organic Ginger Root, Organic Catnip Herb, & Organic Peppermint Leaf",
        amountPerServing: "15 drops",
        dailyValuePercent: "*",
      },
    ],
    title: "Christopher's Original Formulas, Liver & Gallbladder Formula, 2 fl oz (59 ml)",
    brandName: "Christopher's Original Formulas",
    sourceZipPath: "christopher-s-original-formulas.json",
    servingSize: "15 Drops",
    servingsPerContainer: "76",
  });

  assert.ok(
    rows.some(
      (row) =>
        row.name === "Liver & Gallbladder Formula"
        && row.dose === "0.78 ml"
        && row.proprietaryBlendSource === true
        && row.aggregateFormula === true,
    ),
  );
});

test("overlay ingredient normalization can derive serving-size aggregate formula doses for Christopher powder formulas", () => {
  const rows = normalizeIherbSupplementFactsRowsWithTitleFallback({
    rows: [
      {
        substancy:
          "Proprietary Blend:Apple Pectin, Organic Flax Seed, Wildcrafted Psyllium Seed, Wildcrafted Slippery Elm Bark, Organic Fennel Seed, Wildcrafted Marshmallow Root, Activated Charcoal Powder, & Plantain Leaf.",
        amountPerServing: "1 Teaspoon",
        dailyValuePercent: "*",
      },
    ],
    title: "Christopher's Original Formulas, Quick Colon Part #2 Powder, 8 oz",
    brandName: "Christopher's Original Formulas",
    sourceZipPath: "christopher-s-original-formulas.json",
    servingSize: "1 Teaspoon (3 grams)",
    servingsPerContainer: "75",
  });

  assert.ok(
    rows.some(
      (row) =>
        row.name === "Quick Colon Part #2 Powder"
        && row.dose === "3 grams"
        && row.proprietaryBlendSource === true
        && row.aggregateFormula === true,
    ),
  );
});

test("overlay ingredient normalization can add a conservative aggregate row for California Gold formula blends", () => {
  const rows = normalizeIherbSupplementFactsRowsWithTitleFallback({
    rows: [
      {
        substancy:
          "Menopause Support BlendAngelica gigas (root), Cynanchum wilfordii (root), Phlomis umbrosa (root)",
        amountPerServing: "514 mg",
        dailyValuePercent: "†",
      },
    ],
    title:
      "California Gold Nutrition, Beauty, Menopause Support with Angelica gigas, Cynanchum wilfordii, Phlomis umbrosa and L-Leucine, 30 Veggie Capsules",
    brandName: "California Gold Nutrition",
    sourceZipPath: "california-gold-nutrition.json | iherb-brands.json",
    servingSize: "1 Capsule",
    servingsPerContainer: "30",
  });

  assert.ok(
    rows.some(
      (row) =>
        row.name === "Menopause Support"
        && row.dose === "514 mg"
        && row.proprietaryBlendSource === true
        && row.aggregateFormula === true,
    ),
  );
});

test("overlay ingredient normalization can add a conservative aggregate row for EuroMedica complexes", () => {
  const rows = normalizeIherbSupplementFactsRowsWithTitleFallback({
    rows: [
      {
        substancy:
          "Proprietary ComplexDLPA (DL-phenylalanine), Boswellia (Boswellia serrata) Gum Resin Extract (BOS-10®) standardized to contain ≥ 70% Total Organic and Boswellic Acids with AKBA ≥ 10%, with ≤ 5% beta-boswellic acids, Curcumin (Curcuma longa) Rhizome Extract (BCM-95®/Curcugreen®) enhanced with turmeric essential oil and standardized for curcuminoid complex (curcumin, demethoxycurcumin and bisdemethoxycurcumin), Nattokinase",
        amountPerServing: "727 mg",
        dailyValuePercent: "**",
      },
    ],
    title: "EuroMedica, Curaphen®, 120 Capsules",
    brandName: "EuroMedica",
    sourceZipPath: "euromedica.json",
  });

  assert.ok(
    rows.some(
      (row) =>
        row.name === "Curaphen"
        && row.dose === "727 mg"
        && row.proprietaryBlendSource === true
        && row.aggregateFormula === true,
    ),
  );
});

test("overlay ingredient normalization can rescue Planetary header-only formulas with description dose", () => {
  const rows = normalizeIherbSupplementFactsRowsWithTitleFallback({
    rows: [
      {
        substancy: "",
        amountPerServing: "Amount Per Serving",
        dailyValuePercent: "%Daily Value",
      },
    ],
    title: "Planetary Herbals, Bupleurum Liver Cleanse™, 72 Tablets",
    brandName: "Planetary Herbals",
    sourceZipPath: "planetary-herbals.json",
    descriptionText:
      "Support The Natural Cleansing Action of The Liver545 mgHerbal SupplementFormulated by Michael Tierra L.Ac, O.M.D",
  });

  assert.deepEqual(rows, [
    {
      name: "Bupleurum Liver Cleanse",
      dose: "545 mg",
    },
  ]);
});

test("overlay ingredient normalization can rescue single nutrition residue rows with title and description dose", () => {
  const rows = normalizeIherbSupplementFactsRowsWithTitleFallback({
    rows: [
      {
        substancy: "Calcium (as dibasic calcium phosphate)",
        amountPerServing: "36 mg",
        dailyValuePercent: "3%",
      },
    ],
    title: "Planetary Herbals, Artichoke Extract, 60 Tablets",
    brandName: "Planetary Herbals",
    sourceZipPath: "planetary-herbals.json",
    descriptionText:
      "For Liver And Digestive Support Herbal Supplement 500 mg Approved by Michael Tierra L.Ac, O.M.D",
  });

  assert.ok(rows.some((row) => row.name === "Artichoke Extract" && row.dose === "500 mg"));
});

test("overlay ingredient normalization can add a conservative aggregate row for Himalaya generic herbal blends", () => {
  const rows = normalizeIherbSupplementFactsRowsWithTitleFallback({
    rows: [
      {
        substancy: "Proprietary herbal blend",
        amountPerServing: "300 mg",
        dailyValuePercent: "♦",
      },
      {
        substancy:
          "amla extract (fruit), ashwagandha extract (root), Convolvulus pluricaulis choisy extract (whole plant), bacopa extract (whole plant), holy basil extract (aerial parts).",
        amountPerServing: "",
        dailyValuePercent: null,
      },
    ],
    title: "Himalaya, Hello Joy, Mood Support with Ashwagandha, 60 Vegetarian Capsules",
    brandName: "Himalaya",
    sourceZipPath: "himalaya.json",
    servingSize: "1 Capsule",
    servingsPerContainer: "60",
  });

  assert.ok(
    rows.some(
      (row) =>
        row.name === "Mood Support with Ashwagandha"
        && row.dose === "300 mg"
        && row.proprietaryBlendSource === true
        && row.aggregateFormula === true,
    ),
  );
});

test("overlay ingredient normalization can merge title probiotic CFU fallback when only blend doses are structured", () => {
  const rows = normalizeIherbSupplementFactsRowsWithTitleFallback({
    rows: [
      {
        substancy: "Adult Probiotic Blend",
        amountPerServing: "82 mg",
        dailyValuePercent: "**",
      },
      {
        substancy: "Lactobacillus rhamnosus HA-111",
        amountPerServing: "",
        dailyValuePercent: null,
      },
    ],
    title: "Flora, Adult's Probiotic, 17 Billion Cells, 60 Capsules",
    brandName: "Flora",
    sourceZipPath: "flora.json",
    servingSize: "1 Capsule",
    servingsPerContainer: "60",
  });

  assert.ok(
    rows.some(
      (row) =>
        row.name === "Adult's Probiotic"
        && row.dose === "17 Billion CFU",
    ),
  );
});

test("overlay ingredient normalization does not add herbal formula aggregate rows for non-allowlisted sources", () => {
  const rows = normalizeIherbSupplementFactsRowsWithTitleFallback({
    rows: [
      {
        substancy:
          "Proprietary Blend:Elderberry fruit, Echinacea purpurea herb, Zinc citrate",
        amountPerServing: "500 mg",
        dailyValuePercent: "†",
      },
    ],
    title: "Example Brand, Immune Support Formula, 60 Capsules",
    brandName: "Example Brand",
    sourceZipPath: "example-brand.json",
  });

  assert.ok(!rows.some((row) => row.aggregateFormula === true));
});

test("overlay ingredient normalization skips generic marketing titles when header-only facts give no usable ingredient", () => {
  const rows = normalizeIherbSupplementFactsRowsWithTitleFallback({
    rows: [
      {
        substancy: "",
        amountPerServing: "Amount Per Serving",
        dailyValuePercent: "%DV",
      },
    ],
    title: "Ancient Nutrition, Male Performance, 180 Capsules",
    brandName: "Ancient Nutrition",
  });

  assert.deepEqual(rows, []);
});

test("overlay ingredient normalization can use serving-size structured dose when nutrition-label residue rows would otherwise block title fallback", () => {
  const rows = normalizeIherbSupplementFactsRowsWithTitleFallback({
    rows: [
      {
        substancy: "",
        amountPerServing: "Amount Per Serving",
        dailyValuePercent: "%Daily Value*",
      },
      {
        substancy: "Includes 0 g Added Sugars",
        amountPerServing: "",
        dailyValuePercent: "0%",
      },
      {
        substancy: "Vitamin D",
        amountPerServing: "0 mcg",
        dailyValuePercent: "0%",
      },
      {
        substancy: "Calcium",
        amountPerServing: "0 mg",
        dailyValuePercent: "0%",
      },
      {
        substancy: "Iron",
        amountPerServing: "0 mg",
        dailyValuePercent: "0%",
      },
    ],
    title: "Nutricost, Organic Moringa, Unflavored, 16 oz (454 g)",
    brandName: "Nutricost",
    servingSize: "1 Scoop (1/5 tsp)(1 g)",
    sourceZipPath: "nutricost.json",
  });

  assert.deepEqual(rows, [
    {
      name: "Organic Moringa",
      dose: "1 g",
    },
  ]);
});

test("overlay ingredient normalization keeps structured sodium bicarbonate ingredient rows even when sodium nutrient rows are present", () => {
  const rows = normalizeIherbSupplementFactsRowsWithTitleFallback({
    rows: [
      {
        substancy: "",
        amountPerServing: "Amount Per Serving",
        dailyValuePercent: "%Daily Value",
      },
      {
        substancy: "Sodium",
        amountPerServing: "690 mg",
        dailyValuePercent: "30%",
      },
      {
        substancy: "Sodium Bicarbonate",
        amountPerServing: "2,500 mg",
        dailyValuePercent: "*",
      },
    ],
    title: "Nutricost, Sodium Bicarbonate, 120 Capsules",
    brandName: "Nutricost",
    servingSize: "2 Capsules",
    sourceZipPath: "nutricost.json",
  });

  assert.ok(rows.some((row) => row.name === "Sodium Bicarbonate" && row.dose === "2,500 mg"));
});

test("overlay ingredient normalization can rescue sodium citrate powders from title plus serving size", () => {
  const rows = normalizeIherbSupplementFactsRowsWithTitleFallback({
    rows: [
      {
        substancy: "",
        amountPerServing: "Amount Per Serving",
        dailyValuePercent: "%Daily Value*",
      },
      {
        substancy: "Sodium",
        amountPerServing: "530 mg",
        dailyValuePercent: "23%",
      },
      {
        substancy: "Includes 0 g Added Sugars",
        amountPerServing: "",
        dailyValuePercent: "0%",
      },
    ],
    title: "Nutricost, Sodium Citrate, Unflavored, 16 oz (454 g)",
    brandName: "Nutricost",
    servingSize: "1/2 tsp. (2.5 g)**",
    sourceZipPath: "nutricost.json",
  });

  assert.ok(rows.some((row) => row.name === "Sodium Citrate" && row.dose === "2.5 g"));
});

test("overlay ingredient normalization can rescue header-only probiotic formulas from description dose disclosure", () => {
  const rows = normalizeIherbSupplementFactsRowsWithTitleFallback({
    rows: [
      {
        substancy: "",
        amountPerServing: "Amount Per Serving",
        dailyValuePercent: "%Daily Value",
      },
    ],
    title: "Nutricost, Saccharomyces Boulardii + MOS, 120 Capsules",
    brandName: "Nutricost",
    servingSize: "1 Capsule",
    sourceZipPath: "nutricost.json",
    descriptionText:
      "Prebiotic + Probiotic >5 Billion CFU Saccharomyces Boulardii Per Serving 200 mg MOS Per Serving 120 Servings",
  });

  assert.ok(rows.some((row) => row.name === "Saccharomyces Boulardii + MOS" && row.dose === "5 Billion CFU"));
});
