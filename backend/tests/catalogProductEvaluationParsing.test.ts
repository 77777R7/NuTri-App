import assert from "node:assert/strict";
import test from "node:test";

import {
  catalogProductEvaluationInternals,
  prepareCatalogProduct,
} from "../../lib/personalization/core/catalogProductEvaluation";

test("catalog product parsing recognizes SPU, CFU, and mL units", () => {
  assert.deepEqual(catalogProductEvaluationInternals.parseAmountText("120,000 SPU"), {
    amount: 120000,
    unit: "spu",
  });
  assert.deepEqual(catalogProductEvaluationInternals.parseAmountText("10 billion CFU"), {
    amount: 10_000_000_000,
    unit: "cfu",
  });
  assert.deepEqual(catalogProductEvaluationInternals.parseAmountText("1.5 mL"), {
    amount: 1.5,
    unit: "ml",
  });
  assert.deepEqual(catalogProductEvaluationInternals.parseAmountText("30,000 HUT"), {
    amount: 30000,
    unit: "hut",
  });
  assert.deepEqual(catalogProductEvaluationInternals.parseAmountText("225 FIP"), {
    amount: 225,
    unit: "fip",
  });
  assert.deepEqual(catalogProductEvaluationInternals.parseAmountText("30 Billion Organism †"), {
    amount: 30_000_000_000,
    unit: "cfu",
  });
  assert.deepEqual(catalogProductEvaluationInternals.parseAmountText("1,000,000 PFU's"), {
    amount: 1_000_000,
    unit: "pfu",
  });
  assert.deepEqual(catalogProductEvaluationInternals.parseAmountText("4,000 FUs"), {
    amount: 4000,
    unit: "fu",
  });
});

test("catalog product parsing keeps proprietary blends out of full facts coverage", () => {
  const preparedProduct = prepareCatalogProduct({
    productId: "proprietary_blend_capsule",
    title: "Herbal Blend",
    ingredients: [{ name: "Proprietary Blend", dose: "500 mg" }],
  });

  assert.equal(preparedProduct.factsStatus, "partial");
});

test("catalog product parsing allows clear single-ingredient mL disclosures into full facts coverage", () => {
  const preparedProduct = prepareCatalogProduct({
    productId: "yerba_mate_extract",
    title: "Yerba Mate Extract",
    ingredients: [{ name: "Yerba Mate Leaf", dose: "1.5 ml" }],
  });

  assert.equal(preparedProduct.factsStatus, "full");
});

test("catalog product parsing treats enzyme activity units as structured coverage", () => {
  const preparedProduct = prepareCatalogProduct({
    productId: "digestive_enzymes_activity_units",
    title: "Digestive Enzymes",
    ingredients: [
      { name: "Amylase", dose: "30,000 HUT" },
      { name: "Lipase", dose: "225 FIP" },
    ],
  });

  assert.equal(preparedProduct.factsStatus, "full");
});

test("catalog product parsing treats dietary fiber supplement rows as full structured coverage", () => {
  const preparedProduct = prepareCatalogProduct({
    productId: "fiber_gummies",
    title: "Fiber Gummies",
    ingredients: [{ name: "Fiber", dose: "5 g" }],
  });

  assert.equal(preparedProduct.factsStatus, "full");
});

test("catalog product parsing treats conservative herbal formula aggregates as full facts coverage", () => {
  const preparedProduct = prepareCatalogProduct({
    productId: "herbal_iron_formula",
    title: "Christopher's Original Formulas, Herbal Iron Formula",
    sourceZipPath: "christopher-s-original-formulas.json",
    ingredients: [
      {
        name: "Organic Dandelion Leaf",
        dose: null,
        proprietaryBlendSource: true,
      },
      {
        name: "Wildcrafted Nettle Leaf",
        dose: null,
        proprietaryBlendSource: true,
      },
      {
        name: "Herbal Iron Formula",
        dose: "920 mg",
        proprietaryBlendSource: true,
        aggregateFormula: true,
      },
    ],
  });

  assert.equal(preparedProduct.factsStatus, "full");
  assert.equal(preparedProduct.ingredientInputs.find((row) => row.name === "Herbal Iron Formula")?.proprietaryBlend, true);
  assert.equal(preparedProduct.ingredientInputs.find((row) => row.name === "Herbal Iron Formula")?.aggregateFormula, true);
});

test("catalog product parsing treats Gaia herbal extract blend aggregates as full facts coverage", () => {
  const preparedProduct = prepareCatalogProduct({
    productId: "gaia_sound_sleep",
    title: "Gaia Herbs, Sound Sleep®",
    sourceZipPath: "gaia-herbs.json",
    ingredients: [
      {
        name: "Organic Passionflower (Passiflora incarnata) flowering vine",
        dose: null,
        proprietaryBlendSource: true,
      },
      {
        name: "Organic Hops (Humulus lupulus) strobile",
        dose: null,
        proprietaryBlendSource: true,
      },
      {
        name: "Sound Sleep",
        dose: "1,731 mg",
        proprietaryBlendSource: true,
        aggregateFormula: true,
      },
    ],
  });

  assert.equal(preparedProduct.factsStatus, "full");
  assert.equal(preparedProduct.ingredientInputs.find((row) => row.name === "Sound Sleep")?.proprietaryBlend, true);
  assert.equal(preparedProduct.ingredientInputs.find((row) => row.name === "Sound Sleep")?.aggregateFormula, true);
});

test("catalog product parsing treats Banyan botanical formula aggregates as full facts coverage", () => {
  const preparedProduct = prepareCatalogProduct({
    productId: "banyan_stress_ease",
    title: "Banyan Botanicals, Stress Ease",
    sourceZipPath: "banyan-botanicals.json",
    ingredients: [
      {
        name: "Ashwagandha root, Withania somnifera+‡, Shatavari root, Asparagus racemosus+‡, Gotu Kola aerials, Centella asiatica+‡",
        dose: null,
        proprietaryBlendSource: true,
      },
      {
        name: "Stress Ease",
        dose: "1000 mg",
        proprietaryBlendSource: true,
        aggregateFormula: true,
      },
    ],
  });

  assert.equal(preparedProduct.factsStatus, "full");
  assert.equal(preparedProduct.ingredientInputs.find((row) => row.name === "Stress Ease")?.aggregateFormula, true);
});

test("catalog product parsing treats Paradise Herbs formula aggregates as full facts coverage", () => {
  const preparedProduct = prepareCatalogProduct({
    productId: "paradise_whole_man",
    title: "Paradise Herbs, Whole Man",
    sourceZipPath: "paradise-herbs.json",
    ingredients: [
      {
        name: "Tribulus terrestris extract, Tongkat Ali root extract, Muira puama bark extract",
        dose: null,
        proprietaryBlendSource: true,
      },
      {
        name: "Whole Man",
        dose: "700 mg",
        proprietaryBlendSource: true,
        aggregateFormula: true,
      },
    ],
  });

  assert.equal(preparedProduct.factsStatus, "full");
  assert.equal(preparedProduct.ingredientInputs.find((row) => row.name === "Whole Man")?.aggregateFormula, true);
});

test("catalog product parsing treats Michael's Health formula aggregates as full facts coverage", () => {
  const preparedProduct = prepareCatalogProduct({
    productId: "michaels_lng",
    title: "Michael's Health, LNG",
    sourceZipPath: "michaels-health.json",
    ingredients: [
      {
        name: "Fenugreek Seed, Horehound, Slippery Elm Bark, Mullein Leaf and Thyme Leaf",
        dose: null,
        proprietaryBlendSource: true,
      },
      {
        name: "LNG",
        dose: "3.3 g (3,300 mg)",
        proprietaryBlendSource: true,
        aggregateFormula: true,
      },
    ],
  });

  assert.equal(preparedProduct.factsStatus, "full");
  assert.equal(preparedProduct.ingredientInputs.find((row) => row.name === "LNG")?.aggregateFormula, true);
});

test("catalog product parsing treats Enzymedica digestive blend aggregates as full facts coverage", () => {
  const preparedProduct = prepareCatalogProduct({
    productId: "enzymedica_digest_complete",
    title: "Enzymedica, Digest Complete",
    sourceZipPath: "enzymedica.json",
    ingredients: [
      {
        name: "Digest Complete",
        dose: "215 mg",
        proprietaryBlendSource: true,
        aggregateFormula: true,
      },
    ],
  });

  assert.equal(preparedProduct.factsStatus, "full");
});

test("catalog product parsing treats HUM digestive blend aggregates as full facts coverage", () => {
  const preparedProduct = prepareCatalogProduct({
    productId: "hum_flatter_me",
    title: "HUM Nutrition, Flatter Me",
    sourceZipPath: "hum-nutrition.json",
    ingredients: [
      {
        name: "Flatter Me",
        dose: "374 mg",
        proprietaryBlendSource: true,
        aggregateFormula: true,
      },
    ],
  });

  assert.equal(preparedProduct.factsStatus, "full");
});

test("catalog product parsing treats Himalaya generic herbal blend aggregates as full facts coverage", () => {
  const preparedProduct = prepareCatalogProduct({
    productId: "himalaya_hello_joy",
    title: "Himalaya, Hello Joy, Mood Support with Ashwagandha",
    sourceZipPath: "himalaya.json",
    ingredients: [
      {
        name: "amla extract (fruit), ashwagandha extract (root), Convolvulus pluricaulis choisy extract (whole plant), bacopa extract (whole plant), holy basil extract (aerial parts)",
        dose: null,
        proprietaryBlendSource: true,
      },
      {
        name: "Mood Support with Ashwagandha",
        dose: "300 mg",
        proprietaryBlendSource: true,
        aggregateFormula: true,
      },
    ],
  });

  assert.equal(preparedProduct.factsStatus, "full");
  assert.equal(
    preparedProduct.ingredientInputs.find((row) => row.name === "Mood Support with Ashwagandha")?.aggregateFormula,
    true,
  );
});

test("catalog product parsing treats specialized PFU and FU units as structured coverage", () => {
  const floraphageProduct = prepareCatalogProduct({
    productId: "floraphage",
    title: "Floraphage",
    ingredients: [{ name: "Floraphage Prebiotic Bacteriophage", dose: "1,000,000 PFU's" }],
  });
  const nattokinaseProduct = prepareCatalogProduct({
    productId: "nattovena",
    title: "Pure Nattokinase",
    ingredients: [{ name: "Nattokinase", dose: "4,000 FUs" }],
  });

  assert.equal(floraphageProduct.factsStatus, "full");
  assert.equal(nattokinaseProduct.factsStatus, "full");
});
