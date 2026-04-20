import assert from "node:assert/strict";
import test from "node:test";

import {
  buildCanadianOfficialMergeWave,
  parseCanadianOfficialFacts,
} from "../../scripts/maintainer/lib/canadian-official-merge-wave.mjs";

test("parses Canadian official facts without dosage-form prefixes", () => {
  const turmericRows = parseCanadianOfficialFacts(
    "Amount per Gummy Turmeric (25:1) extract (Curcuma longa, rhizome) 6,250 mg Non-Medicinal Ingredients: Glucose syrup.",
  );
  const creatineRows = parseCanadianOfficialFacts(
    "Medicinal Ingredients Per 1 Scoop Creatine monohydrate 5 g Non-Medicinal Ingredients: Bamboo silica.",
  );

  assert.deepEqual(turmericRows[0], {
    substancy: "Turmeric (25:1) extract (Curcuma longa, rhizome)",
    amountPerServing: "6,250 mg",
    dailyValuePercent: null,
  });
  assert.deepEqual(creatineRows[0], {
    substancy: "Creatine monohydrate",
    amountPerServing: "5 g",
    dailyValuePercent: null,
  });
});

test("builds balanced Canadian official merge waves and skips already promoted gtins", () => {
  const candidate = ({ brandName, title, gtin, upc = gtin.slice(-12), ingredientText }) => ({
    brandName,
    title,
    normalizedTitle: title.toLowerCase(),
    productId: `ca-official-${gtin}`,
    upcCode: upc,
    barcode_gtin14: gtin,
    link: `https://example.test/${gtin}`,
    productCatalogImage: `https://example.test/${gtin}.png`,
    productImages: [`https://example.test/${gtin}.png`],
    categories: ["Supplements"],
    count: "60 Capsules",
    dosageForm: "capsule",
    serving: {},
    supplementFacts: {},
    descriptionSections: {
      "Suggested use": "Adults take 1 capsule daily.",
      "Other ingredients": ingredientText,
      Warnings: "Consult a health care practitioner prior to use.",
    },
    sourceSummary: {
      sourceTypes: ["official_product_page"],
      marketSources: ["ca"],
      sourceUrls: [`https://example.test/${gtin}`],
      sourceNotes: ["fixture"],
    },
  });

  const wave = buildCanadianOfficialMergeWave({
    candidates: [
      candidate({
        brandName: "Jamieson",
        title: "Jamieson Biotin",
        gtin: "00000000000001",
        ingredientText: "Biotin 10,000 mcg",
      }),
      candidate({
        brandName: "Jamieson",
        title: "Jamieson Melatonin",
        gtin: "00000000000002",
        ingredientText: "Melatonin 5 mg",
      }),
      candidate({
        brandName: "Webber Naturals",
        title: "Webber Magnesium",
        gtin: "00000000000003",
        ingredientText: "Magnesium (Citrate) 150 mg",
      }),
      candidate({
        brandName: "Progressive",
        title: "Progressive Creatine",
        gtin: "00000000000004",
        ingredientText: "Medicinal Ingredients Per 1 Scoop Creatine monohydrate 5 g Non-Medicinal Ingredients: Bamboo silica.",
      }),
    ],
    waveId: "fixture_wave",
    sourceCandidatePath: "fixture.json",
    brands: ["Jamieson", "Webber Naturals", "Progressive"],
    brandTargets: new Map([
      ["Jamieson", 2],
      ["Webber Naturals", 1],
      ["Progressive", 1],
    ]),
    excludeGtins: new Set(["00000000000001"]),
  });

  assert.equal(wave.summary.selected, 3);
  assert.deepEqual(wave.products.map((row) => row.brandName), [
    "Jamieson",
    "Webber Naturals",
    "Progressive",
  ]);
  assert.equal(wave.products[2].supplementFacts.nutritionalFacts[0].substancy, "Creatine monohydrate");
  assert.equal(wave.products[2].sourceSummary.sourceTypes.includes("official_product_page"), true);
  assert.equal(wave.products[2].sourceSummary.marketSources.includes("ca"), true);
});
