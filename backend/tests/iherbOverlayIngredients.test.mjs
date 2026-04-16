import assert from "node:assert/strict";
import { test } from "node:test";

import {
  normalizeIherbSupplementFactsRows,
  normalizeIherbSupplementFactsRowsWithTitleFallback,
  selectScienceIngredientRows,
} from "../dist/iherbOverlayIngredients.js";

test("normalizeIherbSupplementFactsRows cleans Florassist blend rows and drops headers", () => {
  const rows = normalizeIherbSupplementFactsRows([
    {
      substancy: " ",
      amountPerServing: "Amount Per Serving",
      dailyValuePercent: "% Daily Value",
    },
    {
      substancy:
        "Proprietary Probiotic BlendB. breve Bbr8; L. plantarum 14D; B. animalis ssp. lactis BLC1; L. paracasei IMC 502; L. rhamnosus IMC 501; L. acidophilus LA1; B. longum ssp. longum SP54 (15 Billion CFU†)",
      amountPerServing: "50 mg",
      dailyValuePercent: "**",
    },
    {
      substancy: "TetraPhage BlendLH01 - Myoviridae; LL5 - Siphoviridae;T4D - Myoviridae; LL12 - Myoviridae",
      amountPerServing: "15 mg",
      dailyValuePercent: "**",
    },
  ]);

  assert.deepEqual(rows, [
    {
      name: "Proprietary Probiotic Blend",
      dose: "50 mg",
    },
    {
      name: "TetraPhage Blend",
      dose: "15 mg",
    },
  ]);
});

test("normalizeIherbSupplementFactsRows preserves chemical forms", () => {
  const rows = normalizeIherbSupplementFactsRows([
    {
      substancy: "Vitamin C (as Ascorbic Acid)",
      amountPerServing: "1000 mg",
      dailyValuePercent: "1111%",
    },
  ]);

  assert.deepEqual(rows, [
    {
      name: "Vitamin C (as Ascorbic Acid)",
      dose: "1000 mg",
    },
  ]);
});

test("normalizeIherbSupplementFactsRows splits concatenated proprietary blend members", () => {
  const rows = normalizeIherbSupplementFactsRows([
    {
      substancy:
        "Proprietary Extract BlendMarshmallow (Althaea officinalis) Root Extract, Fennel (Foeniculum vulgare) Seed Extract, Black Walnut (Juglans nigra) Hull Extract, Slippery Elm (Ulmus rubra) Bark Extract, Pumpkin (Cucurbita pepo) Seed Extract, Wormwood (Artemisia absinthium) Herb Extract, Clove (Syzygium aromaticum) Flower Extract, Garlic (Allium sativum) Bulb Extract, Peppermint (Mentha x piperita) Leaf Extract, Oregano (Origanum vulgare) Leaf Extract.",
      amountPerServing: "77 mg",
      dailyValuePercent: "**",
    },
  ]);

  assert.deepEqual(rows, [
    {
      name: "Marshmallow (Althaea officinalis) Root Extract",
      dose: null,
    },
    {
      name: "Fennel (Foeniculum vulgare) Seed Extract",
      dose: null,
    },
    {
      name: "Black Walnut (Juglans nigra) Hull Extract",
      dose: null,
    },
    {
      name: "Slippery Elm (Ulmus rubra) Bark Extract",
      dose: null,
    },
    {
      name: "Pumpkin (Cucurbita pepo) Seed Extract",
      dose: null,
    },
    {
      name: "Wormwood (Artemisia absinthium) Herb Extract",
      dose: null,
    },
    {
      name: "Clove (Syzygium aromaticum) Flower Extract",
      dose: null,
    },
    {
      name: "Garlic (Allium sativum) Bulb Extract",
      dose: null,
    },
    {
      name: "Peppermint (Mentha x piperita) Leaf Extract",
      dose: null,
    },
    {
      name: "Oregano (Origanum vulgare) Leaf Extract",
      dose: null,
    },
  ]);
});

test("normalizeIherbSupplementFactsRows keeps non-blend actives when complex only appears in parentheses", () => {
  const rows = normalizeIherbSupplementFactsRows([
    {
      substancy: "Grape Seed Phytosome † (Vitis vinifera extract / Phospholipid complex)",
      amountPerServing: "100 mg",
      dailyValuePercent: "*",
    },
  ]);

  assert.deepEqual(rows, [
    {
      name: "Grape Seed Phytosome † (Vitis vinifera extract / Phospholipid complex)",
      dose: "100 mg",
    },
  ]);
});

test("normalizeIherbSupplementFactsRowsWithTitleFallback recovers simple header-only supplement titles", () => {
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

test("selectScienceIngredientRows source-locks to iHerb when primary active coverage passes", () => {
  const selection = selectScienceIngredientRows({
    digest: {
      sourceType: "dsld",
      actives: [
        { name: "Proprietary Probiotic Blend", amount: 50, unit: "mg" },
        { name: "TetraPhage Blend", amount: 15, unit: "mg" },
      ],
    },
    overlayClaims: {
      nutritionalFacts: [
        {
          substancy:
            "Proprietary Probiotic BlendB. breve Bbr8; L. plantarum 14D; B. animalis ssp. lactis BLC1; L. paracasei IMC 502; L. rhamnosus IMC 501; L. acidophilus LA1; B. longum ssp. longum SP54 (15 Billion CFU†)",
          amountPerServing: "50 mg",
        },
        {
          substancy: "TetraPhage BlendLH01 - Myoviridae; LL5 - Siphoviridae;T4D - Myoviridae; LL12 - Myoviridae",
          amountPerServing: "15 mg",
        },
      ],
    },
  });

  assert.equal(selection.ingredientSourceTier, "overlay_iherb");
  assert.deepEqual(selection.ingredientRows, [
    { name: "Proprietary Probiotic Blend", dose: "50 mg" },
    { name: "TetraPhage Blend", dose: "15 mg" },
  ]);
});

test("selectScienceIngredientRows falls back to official rows when iHerb coverage fails", () => {
  const selection = selectScienceIngredientRows({
    digest: {
      sourceType: "dsld",
      actives: [
        { name: "Vitamin C", amount: 1000, unit: "mg" },
        { name: "Rose Hips", amount: 100, unit: "mg" },
      ],
    },
    overlayClaims: {
      nutritionalFacts: [
        {
          substancy: "Vitamin C (as Ascorbic Acid)",
          amountPerServing: "1000 mg",
        },
      ],
    },
  });

  assert.equal(selection.ingredientSourceTier, "official_record");
  assert.deepEqual(selection.ingredientRows, [
    { name: "Vitamin C", dose: "1000 mg" },
    { name: "Rose Hips", dose: "100 mg" },
  ]);
});

test("selectScienceIngredientRows accepts 2 of 3 primary active matches", () => {
  const selection = selectScienceIngredientRows({
    digest: {
      sourceType: "dsld",
      actives: [
        { name: "Vitamin C", amount: 1000, unit: "mg" },
        { name: "Rose Hips", amount: 100, unit: "mg" },
        { name: "Citrus Bioflavonoids", amount: 50, unit: "mg" },
      ],
    },
    overlayClaims: {
      nutritionalFacts: [
        {
          substancy: "Vitamin C (as Ascorbic Acid)",
          amountPerServing: "1000 mg",
        },
        {
          substancy: "Rose Hips",
          amountPerServing: "100 mg",
        },
      ],
    },
  });

  assert.equal(selection.ingredientSourceTier, "overlay_iherb");
  assert.deepEqual(selection.ingredientRows, [
    { name: "Vitamin C (as Ascorbic Acid)", dose: "1000 mg" },
    { name: "Rose Hips", dose: "100 mg" },
  ]);
});

test("selectScienceIngredientRows falls back when matched iHerb rows have no usable dose", () => {
  const selection = selectScienceIngredientRows({
    digest: {
      sourceType: "dsld",
      actives: [
        { name: "Vitamin C", amount: 1000, unit: "mg" },
      ],
    },
    overlayClaims: {
      nutritionalFacts: [
        {
          substancy: "Vitamin C (as Ascorbic Acid)",
          amountPerServing: "Amount Per Serving",
        },
      ],
    },
  });

  assert.equal(selection.ingredientSourceTier, "official_record");
  assert.deepEqual(selection.ingredientRows, [
    { name: "Vitamin C", dose: "1000 mg" },
  ]);
});

test("selectScienceIngredientRows source-locks to iHerb when trademark alias coverage passes", () => {
  const selection = selectScienceIngredientRows({
    digest: {
      sourceType: "dsld",
      actives: [
        { name: "Icelandic Astalif", amount: 12, unit: "mg" },
      ],
    },
    overlayClaims: {
      nutritionalFacts: [
        {
          substancy: "Astaxanthin (from Haematococcus pluvialis microalgae extract) (Icelandic Astalif™ )",
          amountPerServing: "12 mg",
        },
      ],
    },
  });

  assert.equal(selection.ingredientSourceTier, "overlay_iherb");
  assert.deepEqual(selection.ingredientRows, [
    {
      name: "Astaxanthin (from Haematococcus pluvialis microalgae extract) (Icelandic Astalif)",
      dose: "12 mg",
    },
  ]);
});

test("selectScienceIngredientRows does not infer alias coverage from explanatory parentheticals alone", () => {
  const selection = selectScienceIngredientRows({
    digest: {
      sourceType: "dsld",
      actives: [
        { name: "Icelandic Astalif", amount: 12, unit: "mg" },
      ],
    },
    overlayClaims: {
      nutritionalFacts: [
        {
          substancy: "Astaxanthin (from Haematococcus pluvialis microalgae extract)",
          amountPerServing: "12 mg",
        },
      ],
    },
  });

  assert.equal(selection.ingredientSourceTier, "official_record");
  assert.deepEqual(selection.ingredientRows, [
    { name: "Icelandic Astalif", dose: "12 mg" },
  ]);
});

test("selectScienceIngredientRows consumes overlay rows one time even when primary and alias keys both match", () => {
  const selection = selectScienceIngredientRows({
    digest: {
      sourceType: "dsld",
      actives: [
        { name: "Astaxanthin", amount: 12, unit: "mg" },
        { name: "Icelandic Astalif", amount: 12, unit: "mg" },
      ],
    },
    overlayClaims: {
      nutritionalFacts: [
        {
          substancy: "Astaxanthin (from Haematococcus pluvialis microalgae extract) (Icelandic Astalif™ )",
          amountPerServing: "12 mg",
        },
      ],
    },
  });

  assert.equal(selection.ingredientSourceTier, "official_record");
  assert.deepEqual(selection.ingredientRows, [
    { name: "Astaxanthin", dose: "12 mg" },
    { name: "Icelandic Astalif", dose: "12 mg" },
  ]);
});

test("selectScienceIngredientRows filters official nutrition rows before coverage and returns clean omega rows", () => {
  const selection = selectScienceIngredientRows({
    digest: {
      sourceType: "dsld",
      actives: [
        { name: "Calories", amount: 15, unit: "cal" },
        { name: "Total Fat", amount: 1.5, unit: "g" },
        { name: "Wild Alaska Pollock Fish Oil Concentrate", amount: 1250, unit: "mg" },
        { name: "Total Omega-3 Fatty Acids as TG", amount: 1040, unit: "mg" },
        { name: "EPA", amount: 690, unit: "mg" },
        { name: "DHA", amount: 260, unit: "mg" },
      ],
    },
    overlayClaims: {
      nutritionalFacts: [
        {
          substancy: "Calories",
          amountPerServing: "15",
        },
        {
          substancy: "Total Fat",
          amountPerServing: "1.5 g",
        },
        {
          substancy: "Wild Alaska Pollock Fish Oil Concentrate",
          amountPerServing: "1,250 mg",
        },
        {
          substancy: "Total Omega-3 Fatty Acids as TG",
          amountPerServing: "1,040 mg",
        },
        {
          substancy: "EPA (Eicosapentaenoic Acid)",
          amountPerServing: "690 mg",
        },
        {
          substancy: "DHA (Docosahexaenoic Acid)",
          amountPerServing: "260 mg",
        },
      ],
    },
  });

  assert.equal(selection.ingredientSourceTier, "overlay_iherb");
  assert.equal(selection.ingredientRows.some((row) => row.name === "Calories"), false);
  assert.equal(selection.ingredientRows.some((row) => row.name === "Total Fat"), false);
  assert.deepEqual(selection.ingredientRows, [
    { name: "Wild Alaska Pollock Fish Oil Concentrate", dose: "1,250 mg" },
    { name: "Total Omega-3 Fatty Acids as TG", dose: "1,040 mg" },
    { name: "EPA (Eicosapentaenoic Acid)", dose: "690 mg" },
    { name: "DHA (Docosahexaenoic Acid)", dose: "260 mg" },
  ]);
});

test("selectScienceIngredientRows uses overlay actives when official coverage rows are only nutrition facts", () => {
  const selection = selectScienceIngredientRows({
    digest: {
      sourceType: "dsld",
      actives: [
        { name: "Calories", amount: 15, unit: "cal" },
        { name: "Total Fat", amount: 1.5, unit: "g" },
      ],
    },
    overlayClaims: {
      nutritionalFacts: [
        {
          substancy: "Wild Alaska Pollock Fish Oil Concentrate",
          amountPerServing: "1,250 mg",
        },
      ],
    },
  });

  assert.equal(selection.ingredientSourceTier, "overlay_iherb");
  assert.deepEqual(selection.ingredientRows, [
    { name: "Wild Alaska Pollock Fish Oil Concentrate", dose: "1,250 mg" },
  ]);
});
