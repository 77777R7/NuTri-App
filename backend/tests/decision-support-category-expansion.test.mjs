import assert from "node:assert/strict";
import test from "node:test";

import { compileDecisionSupport } from "../src/decisionSupport.ts";

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
