import assert from "node:assert/strict";
import test from "node:test";

import {
  buildSearchQueryPlan,
  computeSearchQueryIntentBonus,
  computeSearchScoreForQueryPlan,
  getBarcodeExactSearchDigits,
  isLikelyNonSupplementTitle,
  productSearchResponseHasExactBarcodeMatch,
  shouldUseColdBarcodeExactFallback,
  type ProductSearchResponse,
  type ProductSearchIndexRow,
} from "../src/productSearch.js";

const buildRow = (overrides: Partial<ProductSearchIndexRow> = {}): ProductSearchIndexRow => ({
  id: overrides.id ?? "fixture-id",
  productId: overrides.productId ?? "fixture-product",
  barcode: overrides.barcode ?? null,
  upcCode: overrides.upcCode ?? null,
  brandName: overrides.brandName ?? "Fixture Brand",
  title: overrides.title ?? "Fixture Product",
  imageUrl: overrides.imageUrl ?? null,
  primaryFactsAmount: overrides.primaryFactsAmount ?? null,
  servingSize: overrides.servingSize ?? null,
  description: overrides.description ?? null,
  suggestedUse: overrides.suggestedUse ?? null,
  categories: overrides.categories ?? ["Supplement"],
  ingredients: overrides.ingredients ?? [],
  updatedAt: overrides.updatedAt ?? null,
  searchText: overrides.searchText ?? "",
  brandPopularity: overrides.brandPopularity ?? 0,
});

test("buildSearchQueryPlan expands search aliases and parks generic support words as optional", () => {
  const plan = buildSearchQueryPlan("Sensoril stress support");

  assert.deepEqual(plan.requiredGroups, [["sensoril", "ashwagandha"]]);
  assert.deepEqual(plan.optionalGroups, [["stress"]]);
});

test("buildSearchQueryPlan expands botanical/binomial aliases and typo corrections", () => {
  const matchaPlan = buildSearchQueryPlan("matcha camellia sinensis");
  assert.deepEqual(
    matchaPlan.requiredGroups.map((group) => group.join("|")).sort(),
    [
      ["matcha", "green tea"].join("|"),
      ["camellia sinensis", "green tea", "matcha"].join("|"),
    ].sort(),
  );

  const floraphagePlan = buildSearchQueryPlan("florafage probiotic");
  assert.deepEqual(floraphagePlan.requiredGroups, [
    ["florafage", "floraphage"],
    ["probiotic"],
  ]);
});

test("buildSearchQueryPlan keeps barcode-length numeric queries as required search terms", () => {
  const plan = buildSearchQueryPlan("00023249011835");

  assert.deepEqual(plan.requiredGroups, [["00023249011835"]]);
  assert.deepEqual(plan.optionalGroups, []);
});

test("barcode exact search detects warm-index misses that need cold fallback", () => {
  const emptyResponse: ProductSearchResponse = {
    supplements: [],
    pagination: { total: 0, page: 1, limit: 20, totalPages: 1 },
    suggestions: { categories: [], brands: [], popularSearches: [] },
  };
  const exactResponse: ProductSearchResponse = {
    ...emptyResponse,
    supplements: [
      {
        id: "120987",
        productId: "120987",
        barcode: "00609492800275",
        upcCode: "609492800275",
        name: "MRM Nutrition, Matcha Green Tea",
        brand: "MRM Nutrition",
        category: "Herbs",
        categoryKey: "herb",
        benefit: "Weight Management",
        dose: "500 mg",
        imageUrl: null,
        popularityScore: 0,
        relevanceScore: 36,
        factsStatus: "full",
        coverageStatus: "coverage_ready",
      },
    ],
  };

  assert.equal(getBarcodeExactSearchDigits("00609492800275"), "00609492800275");
  assert.equal(getBarcodeExactSearchDigits("MRM Matcha 500 mg"), null);
  assert.equal(productSearchResponseHasExactBarcodeMatch(exactResponse, "00609492800275"), true);
  assert.equal(productSearchResponseHasExactBarcodeMatch(exactResponse, "609492800275"), true);
  assert.equal(shouldUseColdBarcodeExactFallback(emptyResponse, { query: "00609492800275" }), true);
  assert.equal(shouldUseColdBarcodeExactFallback(exactResponse, { query: "00609492800275" }), false);
  assert.equal(shouldUseColdBarcodeExactFallback(emptyResponse, { query: "MRM Matcha Green Tea" }), false);
});

test("non-supplement filtering keeps green tea capsule supplements searchable", () => {
  assert.equal(
    isLikelyNonSupplementTitle(
      "MRM Nutrition, Matcha Green Tea, 60 Vegan Capsules (500 mg per Capsule)",
      "SuperfoodDietary SupplementContains 10 mg Caffeine Per Serving",
    ),
    false,
  );
  assert.equal(isLikelyNonSupplementTitle("Organic Green Tea Bags", "Premium steeping tea"), true);
});

test("computeSearchScoreForQueryPlan matches trademark aliases even when generic goal text is absent", () => {
  const plan = buildSearchQueryPlan("Sensoril stress support");
  const ashwagandhaRow = buildRow({
    title: "Ashwagandha, Sensoril®, 60 Veg Capsules",
    brandName: "Natural Factors",
    searchText: "ashwagandha sensoril natural factors calm adaptogen",
    ingredients: [{ name: "Ashwagandha (Sensoril)", dose: "125 mg" }],
  });
  const genericStressRow = buildRow({
    title: "Stress Support Multivitamin",
    brandName: "Generic Brand",
    searchText: "stress support multivitamin b complex",
    ingredients: [{ name: "Vitamin B6", dose: "10 mg" }],
  });

  assert.ok(computeSearchScoreForQueryPlan(ashwagandhaRow, plan) > 0);
  assert.equal(computeSearchScoreForQueryPlan(genericStressRow, plan), 0);
});

test("computeSearchScoreForQueryPlan prefers exact trademark hits over generic alias fallback", () => {
  const plan = buildSearchQueryPlan("Sensoril stress support");
  const trademarkRow = buildRow({
    title: "Sensoril® Ashwagandha, 125 mg, 120 Capsules",
    brandName: "Swanson",
    searchText: "sensoril ashwagandha stress swanson 125 mg",
    ingredients: [{ name: "Sensoril Ashwagandha", dose: "125 mg" }],
  });
  const genericAliasRow = buildRow({
    title: "Ashwagandha for Stress, 60 Vegan Capsules",
    brandName: "NatureWise",
    searchText: "ashwagandha stress naturewise vegan capsules",
    ingredients: [{ name: "Ashwagandha", dose: "500 mg" }],
  });

  assert.ok(
    computeSearchScoreForQueryPlan(trademarkRow, plan) >
      computeSearchScoreForQueryPlan(genericAliasRow, plan),
  );
});

test("computeSearchScoreForQueryPlan does not require dose tokens for exact-title family search", () => {
  const plan = buildSearchQueryPlan("Sports Research Omega-3 1040 mg Fish Oil 1250 mg");
  const omegaRow = buildRow({
    title: "Alaskan Omega-3 Fish Oil, 90 Softgels",
    brandName: "Sports Research",
    searchText: "sports research alaskan omega 3 fish oil dha epa 1250 mg 90 softgels",
    ingredients: [
      { name: "Omega-3 Fish Oil", dose: "1,250 mg" },
      { name: "EPA", dose: "690 mg" },
    ],
  });
  const unrelatedRow = buildRow({
    title: "Ashwagandha Sensoril",
    brandName: "Fixture Herbs",
    searchText: "ashwagandha sensoril stress adaptogen",
  });

  assert.ok(computeSearchScoreForQueryPlan(omegaRow, plan) > 0);
  assert.equal(computeSearchScoreForQueryPlan(unrelatedRow, plan), 0);
});

test("computeSearchQueryIntentBonus boosts matcha green tea family products ahead of matcha-only collagen hits", () => {
  const plan = buildSearchQueryPlan("matcha camellia sinensis");
  const matchaGreenTeaRow = buildRow({
    title: "Organic Matcha Green Tea Powder, 4 oz (114 g)",
    brandName: "California Gold Nutrition",
    searchText: "organic matcha green tea powder california gold nutrition camellia sinensis",
    ingredients: [{ name: "Matcha Green Tea Powder", dose: "2 g" }],
  });
  const matchaCollagenRow = buildRow({
    title: "Matcha Collagen Latte Supplement",
    brandName: "Vital Proteins",
    searchText: "matcha collagen latte supplement vital proteins collagen peptides",
    ingredients: [{ name: "Collagen Peptides", dose: "10 g" }],
  });

  const matchaGreenTeaScore =
    computeSearchScoreForQueryPlan(matchaGreenTeaRow, plan) +
    computeSearchQueryIntentBonus(matchaGreenTeaRow, "herb", plan);
  const matchaCollagenScore =
    computeSearchScoreForQueryPlan(matchaCollagenRow, plan) +
    computeSearchQueryIntentBonus(matchaCollagenRow, "protein", plan);

  assert.ok(matchaGreenTeaScore > matchaCollagenScore);
});
