import assert from "node:assert/strict";
import test from "node:test";

import { compileDecisionSupport } from "../src/decisionSupport.ts";
import { toIngredientsText } from "../../scripts/maintainer/lib/iherb-score-category-harness.mjs";

const makeDigest = ({ brand = "Test Brand", name, actives = [], dosageForm = "Capsule" }) => ({
  sourceType: "web",
  identity: {
    type: "gtin14",
    value: `fixture-${name}`.toLowerCase().replace(/[^a-z0-9]+/g, "-"),
    regionTags: ["US"],
  },
  product: {
    brandDisplay: brand,
    name,
    dosageForm,
    route: null,
  },
  actives: actives.map((active) => ({
    name: active,
    amount: 100,
    unit: "mg",
    source: "web",
    confidence: 1,
  })),
  inactives: [],
  serving: {
    servingSize: "1 Capsule",
    servingsPerContainer: 30,
  },
  labelDosing: [
    {
      population: "Adults",
      age: null,
      dose: "1 capsule",
      frequency: "daily",
      rawText: "Adults take 1 capsule daily.",
    },
  ],
  warnings: {
    warnings: ["Keep out of reach of children."],
    consultDoctorIf: [],
    redFlags: [],
    missingFlag: false,
  },
  claims: {
    labelPurposes: [],
    webClaims: [],
  },
  quality: {
    isComplete: true,
    missingFields: [],
    completenessScore: 100,
  },
});

const compileCategory = (params) =>
  compileDecisionSupport({
    digest: makeDigest(params),
    factsDigestHash: `fixture-${params.name}`,
    viewMode: "details",
  }).categoryId;

const compilePayload = (params) =>
  compileDecisionSupport({
    digest: makeDigest(params),
    factsDigestHash: `fixture-${params.name}`,
    viewMode: "details",
  });

test("decision support detects collagen products as collagen_connective_support", () => {
  assert.equal(
    compileCategory({
      brand: "Vital Proteins",
      name: "Collagen Peptides, Unflavored",
      actives: ["Collagen Peptides"],
    }),
    "collagen_connective_support",
  );
});

test("decision support detects amino/performance products as sports_performance_amino_acids", () => {
  assert.equal(
    compileCategory({
      brand: "California Gold Nutrition",
      name: "BCAA 2:1:1, 500 mg",
      actives: ["L-Leucine", "L-Isoleucine", "L-Valine"],
    }),
    "sports_performance_amino_acids",
  );
});

test("decision support detects mood support products as sleep_stress_mood_support", () => {
  assert.equal(
    compileCategory({
      brand: "Doctor's Best",
      name: "5-HTP, 100 mg",
      actives: ["5-HTP"],
    }),
    "sleep_stress_mood_support",
  );
});

test("decision support detects herbal products as botanical_herbal_support", () => {
  assert.equal(
    compileCategory({
      brand: "MegaFood",
      name: "Turmeric Curcumin",
      actives: ["Turmeric Root Extract"],
    }),
    "botanical_herbal_support",
  );

  assert.equal(
    compileCategory({
      brand: "Swanson",
      name: "Full Spectrum Cinnamon, 375 mg",
      actives: ["Cinnamon"],
    }),
    "botanical_herbal_support",
  );

  assert.equal(
    compileCategory({
      brand: "NOW Foods",
      name: "Horse Chestnut With Added Rutin, 90 Veg Capsules",
      actives: ["Horse Chestnut"],
    }),
    "botanical_herbal_support",
  );

  assert.equal(
    compileCategory({
      brand: "Swanson",
      name: "Full Spectrum Catuaba Bark, 465 mg",
      actives: ["Catuaba Bark"],
    }),
    "botanical_herbal_support",
  );

  assert.equal(
    compileCategory({
      brand: "Nutricost",
      name: "Mucuna Pruriens, 120 Capsules",
      actives: ["Mucuna Pruriens"],
    }),
    "botanical_herbal_support",
  );

  assert.equal(
    compileCategory({
      brand: "Gaia Herbs",
      name: "St. John's Wort, 60 Vegan Capsules",
      actives: ["St. John's Wort"],
    }),
    "botanical_herbal_support",
  );

  assert.equal(
    compileCategory({
      brand: "Frontier Co-op",
      name: "Organic Cut & Sifted Hawthorn Leaf & Flower",
      actives: ["Hawthorn Leaf", "Hawthorn Flower"],
    }),
    "botanical_herbal_support",
  );
});

test("decision support detects other vitamin/mineral products as vitamin_mineral_other", () => {
  assert.equal(
    compileCategory({
      brand: "Sports Research",
      name: "Biotin, 10000 mcg",
      actives: ["Biotin"],
    }),
    "vitamin_mineral_other",
  );

  assert.equal(
    compileCategory({
      brand: "Nature's Truth",
      name: "Potassium Citrate, 275 mg",
      actives: ["Potassium Citrate"],
    }),
    "vitamin_mineral_other",
  );
});

test("decision support detects folate support products as specialty_vitamins_other", () => {
  assert.equal(
    compileCategory({
      brand: "BrainMD",
      name: "Methyl Folate, 5,000 mcg",
      actives: ["Methylfolate"],
    }),
    "specialty_vitamins_other",
  );
});

test("decision support detects metabolic glucose support products", () => {
  assert.equal(
    compileCategory({
      brand: "Natural Factors",
      name: "WellBetX Berberine, 500 mg",
      actives: ["Berberine HCl"],
    }),
    "metabolic_glucose_support",
  );
});

test("probiotics overview and science use category-specific framing", () => {
  const payload = compilePayload({
    brand: "Best Naturals",
    name: "Probiotic, 30 Billion CFU",
    actives: ["Lactobacillus acidophilus 15 Billion CFU", "Bifidobacterium lactis 15 Billion CFU"],
  });

  assert.equal(payload.categoryId, "probiotics");
  assert.match(
    payload.overviewBlock.bestForBullets.join(" "),
    /\b(probiotic|gut|digestive-flora|strain|cfu|storage)\b/i,
  );
  assert.doesNotMatch(
    payload.overviewBlock.bestForBullets.join(" "),
    /comparing ingredient support based on clear label disclosure/i,
  );
  assert.match(
    payload.scienceBlock.aiSummaryContract3.join(" "),
    /\b(gut|digestive-flora|strain|cfu|storage)\b/i,
  );
  assert.doesNotMatch(
    payload.scienceBlock.aiSummaryContract3.join(" "),
    /goal-oriented supplement support/i,
  );
});

test("probiotics usage and safety use category-specific framing", () => {
  const payload = compilePayload({
    brand: "Best Naturals",
    name: "Probiotic, 30 Billion CFU",
    actives: ["Lactobacillus acidophilus 15 Billion CFU", "Bifidobacterium lactis 15 Billion CFU"],
  });

  assert.equal(payload.categoryId, "probiotics");
  assert.match(
    payload.usageBlock.directions.lines.join(" "),
    /\b(daily|with-meal|empty-stomach|refrigeration|probiotic-lane)\b/i,
  );
  assert.match(
    payload.safetyBlock.generalWatchouts.join(" "),
    /\b(immunocompromised|pregnant|medications?|storage|refrigeration)\b/i,
  );
  assert.doesNotMatch(
    payload.safetyBlock.generalWatchouts.join(" "),
    /review watch-outs before use|ingredient-level guidance/i,
  );
});

test("magnesium overview and science use category-specific framing", () => {
  const payload = compilePayload({
    brand: "Doctor's Best",
    name: "High Absorption Magnesium Glycinate",
    actives: ["Magnesium Glycinate"],
  });

  assert.equal(payload.categoryId, "magnesium");
  assert.match(
    payload.overviewBlock.bestForBullets.join(" "),
    /\bmagnesium|glycinate|citrate|oxide|form|timing|tolerance\b/i,
  );
  assert.doesNotMatch(
    payload.overviewBlock.bestForBullets.join(" "),
    /comparing ingredient support based on clear label disclosure/i,
  );
  assert.match(
    payload.scienceBlock.aiSummaryContract3.join(" "),
    /\bmagnesium|glycinate|citrate|oxide|form|timing|tolerance\b/i,
  );
  assert.doesNotMatch(
    payload.scienceBlock.aiSummaryContract3.join(" "),
    /goal-oriented supplement support/i,
  );
});

test("magnesium usage and safety use category-specific framing", () => {
  const payload = compilePayload({
    brand: "Doctor's Best",
    name: "High Absorption Magnesium Glycinate",
    actives: ["Magnesium Glycinate"],
  });

  assert.equal(payload.categoryId, "magnesium");
  assert.match(
    payload.usageBlock.directions.lines.join(" "),
    /\b(with food|serving|split routine|tolerance|magnesium-lane)\b/i,
  );
  assert.match(
    payload.safetyBlock.generalWatchouts.join(" "),
    /\b(diarrhea|laxative|kidney|pregnant|medications?)\b/i,
  );
  assert.doesNotMatch(
    payload.safetyBlock.generalWatchouts.join(" "),
    /review watch-outs before use|ingredient-level guidance/i,
  );
});

test("sleep stress mood overview and science use category-specific framing", () => {
  const payload = compilePayload({
    brand: "Thorne",
    name: "Melaton-3",
    actives: ["Melatonin"],
  });

  assert.equal(payload.categoryId, "sleep_stress_mood_support");
  assert.match(
    payload.overviewBlock.bestForBullets.join(" "),
    /\b(sleep|stress|mood|bedtime|melatonin|theanine|gaba|5-htp|timing)\b/i,
  );
  assert.doesNotMatch(
    payload.overviewBlock.bestForBullets.join(" "),
    /comparing ingredient support based on clear label disclosure/i,
  );
  assert.match(
    payload.scienceBlock.aiSummaryContract3.join(" "),
    /\b(sleep|stress|mood|bedtime|melatonin|theanine|gaba|5-htp|timing)\b/i,
  );
  assert.doesNotMatch(
    payload.scienceBlock.aiSummaryContract3.join(" "),
    /goal-oriented supplement support/i,
  );
});

test("sleep stress mood usage and safety use category-specific framing", () => {
  const payload = compilePayload({
    brand: "Thorne",
    name: "Melaton-3",
    actives: ["Melatonin"],
  });

  assert.equal(payload.categoryId, "sleep_stress_mood_support");
  assert.match(
    payload.usageBlock.directions.lines.join(" "),
    /\b(at bedtime|night-time|sleep-lane|next-day fit)\b/i,
  );
  assert.match(
    payload.safetyBlock.generalWatchouts.join(" "),
    /\b(drows|driving|sedating|pregnant|medications?)\b/i,
  );
  assert.doesNotMatch(
    payload.safetyBlock.generalWatchouts.join(" "),
    /review watch-outs before use|ingredient-level guidance/i,
  );
});

test("botanical herbal overview and science use category-specific framing", () => {
  const payload = compilePayload({
    brand: "Gaia Herbs",
    name: "Turmeric Supreme",
    actives: ["Turmeric Root Extract"],
  });

  assert.equal(payload.categoryId, "botanical_herbal_support");
  assert.match(
    payload.overviewBlock.bestForBullets.join(" "),
    /\b(herb|herbal|extract|plant part|source|turmeric|root)\b/i,
  );
  assert.doesNotMatch(
    payload.overviewBlock.bestForBullets.join(" "),
    /comparing ingredient support based on clear label disclosure/i,
  );
  assert.match(
    payload.scienceBlock.aiSummaryContract3.join(" "),
    /\b(herb|herbal|extract|plant|source|turmeric|root)\b/i,
  );
  assert.doesNotMatch(
    payload.scienceBlock.aiSummaryContract3.join(" "),
    /goal-oriented supplement support/i,
  );
});

test("botanical herbal usage and safety use category-specific framing", () => {
  const payload = compilePayload({
    brand: "Gaia Herbs",
    name: "Turmeric Supreme",
    actives: ["Turmeric Root Extract"],
  });

  assert.equal(payload.categoryId, "botanical_herbal_support");
  assert.match(
    payload.usageBlock.directions.lines.join(" "),
    /\b(daily|herbal|extract|tea|capsule|serving|herbal-lane)\b/i,
  );
  assert.match(
    payload.safetyBlock.generalWatchouts.join(" "),
    /\b(herb|pregnant|medications?|allerg|clinician)\b/i,
  );
  assert.doesNotMatch(
    payload.safetyBlock.generalWatchouts.join(" "),
    /review watch-outs before use|ingredient-level guidance/i,
  );
});

test("fish oil overview and science use category-specific framing", () => {
  const payload = compilePayload({
    brand: "Sports Research",
    name: "Omega-3 Fish Oil, Triple Strength",
    actives: [
      "Wild Alaska Pollock Fish Oil Concentrate",
      "EPA (Eicosapentaenoic Acid)",
      "DHA (Docosahexaenoic Acid)",
    ],
    dosageForm: "Softgel",
  });

  assert.equal(payload.categoryId, "fish_oil_omega3");
  assert.match(
    payload.overviewBlock.bestForBullets.join(" "),
    /\b(omega-?3|epa|dha|heart|vascular)\b/i,
  );
  assert.match(
    payload.scienceBlock.aiSummaryContract3.join(" "),
    /\b(omega-?3|epa|dha|source oil|per-serving strength|heart|vascular)\b/i,
  );
  assert.doesNotMatch(
    payload.scienceBlock.aiSummaryContract3.join(" "),
    /\bgeneral science\b/i,
  );
});

test("metabolic glucose support overview and science use category-specific framing", () => {
  const payload = compilePayload({
    brand: "Natural Factors",
    name: "WellBetX Berberine, 500 mg",
    actives: ["Berberine HCl"],
  });

  assert.equal(payload.categoryId, "metabolic_glucose_support");
  assert.match(
    payload.overviewBlock.bestForBullets.join(" "),
    /\b(glucose|glycemic|berberine|meal-timing)\b/i,
  );
  assert.doesNotMatch(
    payload.overviewBlock.bestForBullets.join(" "),
    /comparing ingredient support based on clear label disclosure/i,
  );
  assert.match(
    payload.scienceBlock.aiSummaryContract3.join(" "),
    /\b(glucose|glycemic|berberine|meal-timing)\b/i,
  );
  assert.doesNotMatch(
    payload.scienceBlock.aiSummaryContract3.join(" "),
    /goal-oriented supplement support/i,
  );
});

test("metabolic glucose support usage and safety use category-specific framing", () => {
  const payload = compilePayload({
    brand: "Natural Factors",
    name: "WellBetX Berberine, 500 mg",
    actives: ["Berberine HCl"],
  });

  assert.equal(payload.categoryId, "metabolic_glucose_support");
  assert.match(
    payload.usageBlock.directions.lines.join(" "),
    /\b(before-meal|with-meal|blood-sugar|glucose-lane)\b/i,
  );
  assert.match(
    payload.safetyBlock.generalWatchouts.join(" "),
    /\b(blood-sugar|diabetes|pregnant|medications?|glucose-lowering)\b/i,
  );
  assert.doesNotMatch(
    payload.safetyBlock.generalWatchouts.join(" "),
    /review watch-outs before use|ingredient-level guidance/i,
  );
});

test("decision support detects specialty anabolic sports products", () => {
  assert.equal(
    compileCategory({
      brand: "Nutricost",
      name: "Beta Ecdysterone, 300 mg",
      actives: ["Beta Ecdysterone"],
    }),
    "sports_anabolic_support",
  );

  assert.equal(
    compileCategory({
      brand: "Nutrex Research",
      name: "Anabol Hardcore, 160 mg",
      actives: ["Anabolic Matrix"],
    }),
    "sports_anabolic_support",
  );
});

test("decision support detects cholesterol and lipid support products", () => {
  assert.equal(
    compileCategory({
      brand: "NaturesPlus",
      name: "Herbal Actives, Red Yeast Rice, 600 mg",
      actives: ["Red Yeast Rice"],
    }),
    "cholesterol_lipid_support",
  );

  assert.equal(
    compileCategory({
      brand: "California Gold Nutrition",
      name: "Red Yeast Rice Complex",
      actives: ["Organic Red Yeast Rice", "Coenzyme Q10"],
    }),
    "cholesterol_lipid_support",
  );
});

test("cholesterol lipid support overview and science use category-specific framing", () => {
  const payload = compilePayload({
    brand: "NaturesPlus",
    name: "Herbal Actives, Red Yeast Rice, 600 mg",
    actives: ["Red Yeast Rice"],
  });

  assert.equal(payload.categoryId, "cholesterol_lipid_support");
  assert.match(
    payload.overviewBlock.bestForBullets.join(" "),
    /\b(cholesterol|lipid|red yeast rice|with-food)\b/i,
  );
  assert.doesNotMatch(
    payload.overviewBlock.bestForBullets.join(" "),
    /comparing ingredient support based on clear label disclosure/i,
  );
  assert.match(
    payload.scienceBlock.aiSummaryContract3.join(" "),
    /\b(cholesterol|lipid|red yeast rice|with-food)\b/i,
  );
  assert.doesNotMatch(
    payload.scienceBlock.aiSummaryContract3.join(" "),
    /goal-oriented supplement support/i,
  );
});

test("cholesterol lipid support usage and safety use category-specific framing", () => {
  const payload = compilePayload({
    brand: "NaturesPlus",
    name: "Herbal Actives, Red Yeast Rice, 600 mg",
    actives: ["Red Yeast Rice"],
  });

  assert.equal(payload.categoryId, "cholesterol_lipid_support");
  assert.match(
    payload.usageBlock.directions.lines.join(" "),
    /\b(with-food|cholesterol-lane|lipid-support|daily serving)\b/i,
  );
  assert.match(
    payload.safetyBlock.generalWatchouts.join(" "),
    /\b(cholesterol|liver|statin|pregnant|medications?)\b/i,
  );
  assert.doesNotMatch(
    payload.safetyBlock.generalWatchouts.join(" "),
    /review watch-outs before use|ingredient-level guidance/i,
  );
});

test("decision support detects liver and bile support products", () => {
  assert.equal(
    compileCategory({
      brand: "BodyBio",
      name: "TUDCA, 250 mg",
      actives: ["TUDCA"],
    }),
    "liver_bile_support",
  );

  assert.equal(
    compileCategory({
      brand: "Seeking Health",
      name: "Ox Bile, 125 mg",
      actives: ["Ox Bile"],
    }),
    "liver_bile_support",
  );

  assert.equal(
    compileCategory({
      brand: "Banyan Botanicals",
      name: "Liver Formula",
      actives: [],
    }),
    "liver_bile_support",
  );
});

test("liver bile support overview and science use category-specific framing", () => {
  const payload = compilePayload({
    brand: "BodyBio",
    name: "TUDCA, 250 mg",
    actives: ["TUDCA"],
  });

  assert.equal(payload.categoryId, "liver_bile_support");
  assert.match(
    payload.overviewBlock.bestForBullets.join(" "),
    /\b(liver|bile|tudca|ox bile|with-food|with-fat)\b/i,
  );
  assert.doesNotMatch(
    payload.overviewBlock.bestForBullets.join(" "),
    /comparing ingredient support based on clear label disclosure/i,
  );
  assert.match(
    payload.scienceBlock.aiSummaryContract3.join(" "),
    /\b(liver|bile|tudca|ox bile|with-food|with-fat)\b/i,
  );
  assert.doesNotMatch(
    payload.scienceBlock.aiSummaryContract3.join(" "),
    /goal-oriented supplement support/i,
  );
});

test("liver bile support usage and safety use category-specific framing", () => {
  const payload = compilePayload({
    brand: "BodyBio",
    name: "TUDCA, 250 mg",
    actives: ["TUDCA"],
  });

  assert.equal(payload.categoryId, "liver_bile_support");
  assert.match(
    payload.usageBlock.directions.lines.join(" "),
    /\b(with-food|with-fat|bile-support|liver-bile lane)\b/i,
  );
  assert.match(
    payload.safetyBlock.generalWatchouts.join(" "),
    /\b(liver|bile|gallbladder|healthcare practitioner|medications?)\b/i,
  );
  assert.doesNotMatch(
    payload.safetyBlock.generalWatchouts.join(" "),
    /review watch-outs before use|ingredient-level guidance/i,
  );
});

test("decision support detects cellular nucleotide support products", () => {
  assert.equal(
    compileCategory({
      brand: "Bluebonnet Nutrition",
      name: "Nucleotide Complex, RNA / DNA",
      actives: ["Nucleotide Complex"],
    }),
    "cellular_nucleotide_support",
  );
});

test("decision support routes explicit out-of-scope products away from unknown", () => {
  assert.equal(
    compileCategory({
      brand: "NOW Foods",
      name: "Better Stevia Organic Extract Powder",
      actives: ["Stevia Extract"],
      dosageForm: "Powder",
    }),
    "out_of_scope_non_supplement",
  );

  assert.equal(
    compileCategory({
      brand: "Everyone",
      name: "Hand Soap, Lavender + Coconut",
      actives: [],
      dosageForm: "Liquid",
    }),
    "out_of_scope_non_supplement",
  );

  assert.equal(
    compileCategory({
      brand: "Aura Cacia",
      name: "Aromatherapy Foam Bath, Relaxing Lavender",
      actives: [],
      dosageForm: "Powder",
    }),
    "out_of_scope_non_supplement",
  );
});

test("decision support routes backlog-hold boundary products away from unknown", () => {
  assert.equal(
    compileCategory({
      brand: "Natural Balance",
      name: "Chitosan, 250 mg",
      actives: ["Chitosan"],
    }),
    "taxonomy_backlog_hold",
  );
});

test("decision support detects antioxidant energy products as antioxidant_cellular_energy", () => {
  assert.equal(
    compileCategory({
      brand: "Qunol",
      name: "Ultra CoQ10, 200 mg",
      actives: ["Coenzyme Q10"],
    }),
    "antioxidant_cellular_energy",
  );
});

test("decision support detects nootropic products as nootropic_memory_cognition", () => {
  assert.equal(
    compileCategory({
      brand: "Jarrow Formulas",
      name: "Citicoline, 250 mg",
      actives: ["Citicoline"],
    }),
    "nootropic_memory_cognition",
  );
});

test("decision support detects specialty vitamins as specialty_vitamins_other", () => {
  assert.equal(
    compileCategory({
      brand: "Natrol",
      name: "Vitamin B-12, 5,000 mcg",
      actives: ["Vitamin B-12"],
    }),
    "specialty_vitamins_other",
  );
});

test("decision support detects single amino and neuro products as specialty_single_amino_and_neuro", () => {
  assert.equal(
    compileCategory({
      brand: "California Gold Nutrition",
      name: "L-Lysine, 500 mg",
      actives: ["L-Lysine"],
    }),
    "specialty_single_amino_and_neuro",
  );

  assert.equal(
    compileCategory({
      brand: "Carlson",
      name: "Taurine, 1,000 mg",
      actives: ["Taurine"],
    }),
    "specialty_single_amino_and_neuro",
  );
});

test("decision support detects specialty lipid products as fatty_acids_specialty_lipids", () => {
  assert.equal(
    compileCategory({
      brand: "Sports Research",
      name: "Organic MCT Oil",
      actives: ["MCT Oil"],
      dosageForm: "Liquid",
    }),
    "fatty_acids_specialty_lipids",
  );

  assert.equal(
    compileCategory({
      brand: "NOW Foods",
      name: "Sunflower Lecithin, 1,200 mg",
      actives: ["Sunflower Lecithin"],
    }),
    "fatty_acids_specialty_lipids",
  );

  assert.equal(
    compileCategory({
      brand: "Manitoba Harvest",
      name: "Hemp Seed Oil, Cold Pressed",
      actives: ["Hemp Seed Oil"],
      dosageForm: "Liquid",
    }),
    "fatty_acids_specialty_lipids",
  );
});

test("decision support detects nootropic boundary products as nootropic_memory_cognition", () => {
  assert.equal(
    compileCategory({
      brand: "Natrol",
      name: "Ginkgo Biloba",
      actives: ["Ginkgo Biloba"],
    }),
    "nootropic_memory_cognition",
  );

  assert.equal(
    compileCategory({
      brand: "Solgar",
      name: "Phosphatidylserine, 200 mg",
      actives: ["Phosphatidylserine"],
    }),
    "nootropic_memory_cognition",
  );

  assert.equal(
    compileCategory({
      brand: "Tru Niagen",
      name: "Nicotinamide Riboside Chloride, 300 mg",
      actives: ["Nicotinamide Riboside Chloride"],
    }),
    "nootropic_memory_cognition",
  );

  assert.equal(
    compileCategory({
      brand: "InnovixLabs",
      name: "Choline, 100 Vegetarian Capsules",
      actives: ["Choline"],
    }),
    "nootropic_memory_cognition",
  );

  assert.equal(
    compileCategory({
      brand: "Metabolic Nutrition",
      name: "NAD DAILY, Anti-Aging Cellular Rejuvenator",
      actives: [],
    }),
    "nootropic_memory_cognition",
  );
});

test("decision support detects women's hormonal support products", () => {
  assert.equal(
    compileCategory({
      brand: "Nutricost",
      name: "Women, Black Cohosh, 660 mg",
      actives: ["Black Cohosh"],
    }),
    "womens_hormonal_and_lactation",
  );

  assert.equal(
    compileCategory({
      brand: "NOW Foods",
      name: "Soy Isoflavones, 120 Veg Capsules",
      actives: ["Soy Isoflavones"],
    }),
    "womens_hormonal_and_lactation",
  );
});

test("decision support detects men's prostate and hormonal products", () => {
  assert.equal(
    compileCategory({
      brand: "Doctor's Best",
      name: "Saw Palmetto, Standardized Extract, 320 mg",
      actives: ["Saw Palmetto"],
    }),
    "mens_prostate_and_hormonal",
  );

  assert.equal(
    compileCategory({
      brand: "Force Factor",
      name: "DHEA, 50 mg",
      actives: ["DHEA"],
    }),
    "mens_prostate_and_hormonal",
  );

  assert.equal(
    compileCategory({
      brand: "Conceive Plus",
      name: "Men's Fertility Support, 60 Vegan Capsules",
      actives: [],
    }),
    "mens_prostate_and_hormonal",
  );

  assert.equal(
    compileCategory({
      brand: "Dr. Mercola",
      name: "Testosterone Support, 30 Capsules",
      actives: [],
    }),
    "mens_prostate_and_hormonal",
  );

  assert.equal(
    compileCategory({
      brand: "Force Factor",
      name: "Male Enhancement, 60 Tablets",
      actives: [],
    }),
    "mens_prostate_and_hormonal",
  );
});

test("decision support detects digestive and gastro functional products", () => {
  assert.equal(
    compileCategory({
      brand: "Country Life",
      name: "Tropical Papaya",
      actives: ["Papain", "Papaya"],
      dosageForm: "Chewable",
    }),
    "digestive_and_gastro_functional",
  );

  assert.equal(
    compileCategory({
      brand: "OLLY",
      name: "Keep It Movin'",
      actives: ["Rhubarb", "Prune"],
      dosageForm: "Gummy",
    }),
    "digestive_and_gastro_functional",
  );

  assert.equal(
    compileCategory({
      brand: "21st Century",
      name: "Herbal Slimming Tea, Caffeine Free",
      actives: [],
      dosageForm: "Tea",
    }),
    "digestive_and_gastro_functional",
  );

  assert.equal(
    compileCategory({
      brand: "American Health",
      name: "TAM, Herbal Laxative, 250 Tablets",
      actives: [],
    }),
    "digestive_and_gastro_functional",
  );
});

test("decision support detects digestive enzyme lane products", () => {
  assert.equal(
    compileCategory({
      brand: "Enzymedica",
      name: "Digest Basic, 90 Capsules",
      actives: ["Digestive Enzyme Blend"],
    }),
    "digestive_fiber_enzymes",
  );

  assert.equal(
    compileCategory({
      brand: "Nature's Craft",
      name: "Pancreatic Enzymes, 120 Capsules",
      actives: ["Pancreatic Enzyme Blend"],
    }),
    "digestive_fiber_enzymes",
  );
});

test("decision support detects micro-fix residual products in existing categories", () => {
  assert.equal(
    compileCategory({
      brand: "Thorne",
      name: "5-Hydroxytryptophan, 90 Capsules",
      actives: ["5-Hydroxytryptophan"],
    }),
    "sleep_stress_mood_support",
  );

  assert.equal(
    compileCategory({
      brand: "Nature's Way",
      name: "Astragalus Root",
      actives: ["Astragalus Root"],
    }),
    "botanical_herbal_support",
  );

  assert.equal(
    compileCategory({
      brand: "Host Defense",
      name: "Mushrooms, Cordychi",
      actives: ["Cordyceps"],
    }),
    "superfoods_mushrooms_greens",
  );

  assert.equal(
    compileCategory({
      brand: "Nutricost",
      name: "Niacin, 500 mg",
      actives: ["Niacin"],
    }),
    "specialty_vitamins_other",
  );

  assert.equal(
    compileCategory({
      brand: "Theralogix",
      name: "TherOmega, 90 Softgels",
      actives: ["Fish Oil Concentrate", "EPA", "DHA"],
    }),
    "fish_oil_omega3",
  );

  assert.equal(
    compileCategory({
      brand: "Bluebonnet Nutrition",
      name: "L-Glutathione, 100 mg",
      actives: ["L-Glutathione"],
    }),
    "antioxidant_cellular_energy",
  );

  assert.equal(
    compileCategory({
      brand: "Solaray",
      name: "Lycopene, 10 mg",
      actives: ["Lycopene"],
    }),
    "antioxidant_cellular_energy",
  );

  assert.equal(
    compileCategory({
      brand: "NutraMedix",
      name: "Chanca Piedra, Stone Breaker",
      actives: ["Chanca Piedra"],
      dosageForm: "Liquid",
    }),
    "botanical_herbal_support",
  );

  assert.equal(
    compileCategory({
      brand: "Paradise Herbs",
      name: "Ginger, 250 mg",
      actives: ["Ginger"],
    }),
    "botanical_herbal_support",
  );

  assert.equal(
    compileCategory({
      brand: "Oregon's Wild Harvest",
      name: "Organic Licorice",
      actives: ["Licorice"],
    }),
    "botanical_herbal_support",
  );
});

test("decision support routes prenatal products into vitamin mineral other", () => {
  assert.equal(
    compileCategory({
      brand: "Conceive Plus",
      name: "Prenatal, 60 Vegan Capsules",
      actives: [],
    }),
    "vitamin_mineral_other",
  );
});

test("decision support detects ovulation support as women's hormonal support", () => {
  assert.equal(
    compileCategory({
      brand: "Conceive Plus",
      name: "Women's Ovulation Support, 120 Vegan Capsules",
      actives: [],
    }),
    "womens_hormonal_and_lactation",
  );
});

test("title-derived ingredient fallback rescues explicit header-only ingredient names", () => {
  assert.match(
    toIngredientsText({
      title: "Ageless Foundation Laboratories, NMN, 500 mg, 90 Veg Capsules",
      nutritionalFacts: [{ name: "Calories", dose: "0" }],
    }),
    /\bNMN\b/,
  );

  assert.match(
    toIngredientsText({
      title: "ALLMAX, Essentials, DIM, 60 Veggie Caps (100 mg per Capsule)",
      nutritionalFacts: [{ name: "Calories", dose: "0" }],
    }),
    /\bDIM\b/,
  );

  assert.match(
    toIngredientsText({
      title: "ALLMAX, Essentials, Arachidonic Acid+, 120 Capsules",
      nutritionalFacts: [{ name: "Calories", dose: "0" }],
    }),
    /\bArachidonic Acid\b/,
  );

  assert.match(
    toIngredientsText({
      title: "EuroMedica, Melatonin, 10 mg, 60 Sustained Release Tablets",
      nutritionalFacts: [{ name: "Calories", dose: "0" }],
    }),
    /\bMelatonin\b/,
  );

  assert.match(
    toIngredientsText({
      title: "Havasu Nutrition, L-Arginine, 60 Capsules",
      nutritionalFacts: [{ name: "Calories", dose: "0" }],
    }),
    /\bL-Arginine\b/,
  );

  assert.match(
    toIngredientsText({
      title: "Gaia Herbs, Quercetin Synergy, 50 Vegan Capsules",
      nutritionalFacts: [{ name: "Calories", dose: "0" }],
    }),
    /\bQuercetin\b/,
  );

  assert.match(
    toIngredientsText({
      title: "BrainMD, Optimized3x CoQ10, 60 Vegan Capsules",
      nutritionalFacts: [{ name: "Calories", dose: "0" }],
    }),
    /\bCoenzyme Q10\b/,
  );

  assert.match(
    toIngredientsText({
      title: "Eclectic Herb, Black Raspberry Powder, 3.2 oz (90 g)",
      nutritionalFacts: [{ name: "Calories", dose: "0" }],
    }),
    /\bBlack Raspberry\b/,
  );

  assert.match(
    toIngredientsText({
      title: "Himalaya, Boswellia, 120 Vegetarian Capsules (125 mg per Capsule)",
      nutritionalFacts: [{ name: "Calories", dose: "0" }],
    }),
    /\bBoswellia\b/,
  );

  assert.match(
    toIngredientsText({
      title: "Host Defense, Mushrooms™, Chaga, 60 Capsules",
      nutritionalFacts: [{ name: "Calories", dose: "0" }],
    }),
    /\bChaga Mushroom\b/,
  );

  assert.match(
    toIngredientsText({
      title: "Forest Leaf, Advanced Magnesium Complex, 500 mg, 120 Vegetable Capsules",
      nutritionalFacts: [{ name: "Calories", dose: "0" }],
    }),
    /\bMagnesium\b/,
  );

  assert.match(
    toIngredientsText({
      title: "Bucked Up, Babe, Collagen, Chocolate, 14.9 oz (423 g)",
      nutritionalFacts: [{ name: "Calories", dose: "0" }],
    }),
    /\bCollagen\b/,
  );

  assert.match(
    toIngredientsText({
      title: "Gaia Herbs, Milk Thistle, 120 Vegan Capsules",
      nutritionalFacts: [{ name: "Calories", dose: "0" }],
    }),
    /\bMilk Thistle\b/,
  );

  assert.match(
    toIngredientsText({
      title: "Happy Healthy Hippie, Maca, 120 Vegetarian Capsules",
      nutritionalFacts: [{ name: "Calories", dose: "0" }],
    }),
    /\bMaca Root\b/,
  );

  assert.match(
    toIngredientsText({
      title: "InnovixLabs, Choline, 100 Vegetarian Capsules (275 mg per Capsule)",
      nutritionalFacts: [{ name: "Calories", dose: "0" }],
    }),
    /\bCholine\b/,
  );

  assert.match(
    toIngredientsText({
      title: "MaryRuth's, Organic Elderberry Liquid Drops, Alcohol Free, Blueberry + Raspberry, 1 fl oz (30 ml)",
      nutritionalFacts: [{ name: "Calories", dose: "0" }],
    }),
    /\bElderberry\b/,
  );

  assert.match(
    toIngredientsText({
      title: "Frontier Co-op, Organic Freeze-Dried Cranberry Powder, 8 oz (226 g)",
      nutritionalFacts: [{ name: "Calories", dose: "0" }],
    }),
    /\bCranberry Powder\b/,
  );

  assert.match(
    toIngredientsText({
      title: "Kyolic, Kyo-Green, Powdered Drink Mix, Greens Blend, 10 oz",
      nutritionalFacts: [{ name: "Calories", dose: "0" }],
    }),
    /\bGreens Blend\b/,
  );

  assert.match(
    toIngredientsText({
      title: "Manitoba Harvest, Hemp Seed Oil, Cold Pressed, 12 fl oz (355 ml)",
      nutritionalFacts: [{ name: "Calories", dose: "0" }],
    }),
    /\bHemp Seed Oil\b/,
  );

  assert.match(
    toIngredientsText({
      title: "Metagenics, Intrinsi Vitamin B12-Folate, 60 Tablets",
      nutritionalFacts: [{ name: "Calories", dose: "0" }],
    }),
    /\bVitamin B12 \+ Folate\b/,
  );

  assert.match(
    toIngredientsText({
      title: "JUNP Hydration, Electrolyte Powder Mix, Peach, 20 Stick Packs",
      nutritionalFacts: [{ name: "Calories", dose: "0" }],
    }),
    /\bElectrolyte Blend\b/,
  );

  assert.match(
    toIngredientsText({
      title: "Metamucil, On-The-Go, 4-in-1 Fiber, Orange, Sugar Free",
      nutritionalFacts: [{ name: "Calories", dose: "0" }],
    }),
    /\bFiber Blend\b/,
  );

  assert.match(
    toIngredientsText({
      title: "Biocidin Botanicals, Biocidin TS, Daily Herbal Throat Spray, 1 fl oz",
      nutritionalFacts: [{ name: "Calories", dose: "0" }],
    }),
    /\bHerbal Throat Spray\b/,
  );
});

test("decision support exposes personalized result lane v1 shell with safety-first ordering", () => {
  const payload = compilePayload({
    brand: "Nature Made",
    name: "Melatonin, 3 mg",
    actives: ["Melatonin"],
  });

  assert.deepEqual(payload.personalizedResultLane.recommendedSectionOrder, [
    "safety",
    "goal_fit",
    "personal_insight",
    "allergy_insight",
    "dosage_context",
    "product_standing",
  ]);
  assert.equal(payload.personalizedResultLane.goalFit.status, "pending");
  assert.ok(
    payload.personalizedResultLane.goalFit.candidateGoalKeys.includes("sleep"),
    "expected melatonin preview to surface sleep support",
  );
  assert.equal(payload.personalizedResultLane.personalInsight.status, "pending");
  assert.equal(payload.personalizedResultLane.allergyInsight.status, "pending");
  assert.ok(["pending", "unavailable"].includes(payload.personalizedResultLane.dosageContext.status));
  assert.equal(payload.personalizedResultLane.productStanding.status, "pending");
});
