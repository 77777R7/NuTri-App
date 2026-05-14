import assert from "node:assert/strict";
import test from "node:test";

import {
  buildColdFallbackOrClauses,
  buildProductSearchBootstrapPayloadFromRows,
  buildProductSearchIndexOrClauses,
  buildProductSearchIndexRowFromSearchIndex,
  buildSearchResponseFromRows,
  buildSearchQueryPlan,
  classifySearchQueryIntent,
  computeSearchQueryIntentBonus,
  computeSearchScoreForQueryPlan,
  DEFAULT_PRODUCT_SEARCH_WARM_QUERIES,
  extractColdFallbackBrandLead,
  extractColdFallbackCoreTerms,
  scoreSearchRelevanceTier,
  getBarcodeExactSearchDigits,
  PRODUCT_SEARCH_BROWSE_BOOTSTRAP_LIMIT,
  getStableRankingWindow,
  isLikelyNonSupplementTitle,
  productSearchResponseHasExactBarcodeMatch,
  shouldAllowExactBarcodeNonSupplementResult,
  shouldStopAfterFocusedColdCandidateFetch,
  shouldUseColdBarcodeExactFallback,
  type ProductSearchResponse,
  type ProductSearchIndexRow,
} from "../src/productSearch.js";

const buildRow = (overrides: Partial<ProductSearchIndexRow> = {}): ProductSearchIndexRow => {
  const ingredients = overrides.ingredients ?? [];
  const factsStatus = overrides.factsStatus ?? (
    ingredients.length === 0
      ? "none"
      : ingredients.some((ingredient) => ingredient.dose)
        ? "full"
        : "partial"
  );

  return {
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
    ingredients,
    updatedAt: overrides.updatedAt ?? null,
    searchText: overrides.searchText ?? "",
    ingredientFamilies: overrides.ingredientFamilies ?? [],
    formSignals: overrides.formSignals ?? [],
    strengthSignals: overrides.strengthSignals ?? [],
    factsStatus,
    coverageStatus: overrides.coverageStatus ?? (factsStatus === "full" ? "coverage_ready" : "not_enough_structured_data"),
    brandPopularity: overrides.brandPopularity ?? 0,
    qualityRank: overrides.qualityRank ?? 0,
  };
};

test("buildSearchQueryPlan expands search aliases and parks generic support words as optional", () => {
  const plan = buildSearchQueryPlan("Sensoril stress support");

  assert.deepEqual(plan.requiredGroups, [["sensoril", "ashwagandha"]]);
  assert.deepEqual(plan.optionalGroups, [["stress"]]);
});

test("buildSearchQueryPlan treats mood support as an explicit goal phrase", () => {
  const plan = buildSearchQueryPlan("mood support");

  assert.deepEqual(plan.requiredGroups, [["mood support"]]);
  assert.deepEqual(plan.optionalGroups, []);
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

test("buildSearchQueryPlan keeps vitamin letter families as phrase aliases instead of single-letter matches", () => {
  const vitaminDPlan = buildSearchQueryPlan("vitamin d");
  assert.deepEqual(vitaminDPlan.requiredGroups, [["vitamin d", "vitamin d3", "cholecalciferol", "d3"]]);
  assert.deepEqual(vitaminDPlan.optionalGroups, []);

  const vitaminCPlan = buildSearchQueryPlan("Vitamin C gummies");
  assert.deepEqual(vitaminCPlan.requiredGroups, [["vitamin c", "ascorbic acid", "ascorbate"]]);
  assert.deepEqual(vitaminCPlan.optionalGroups, []);
});

test("search responses expose catalog stats and hide low-facts rows from empty category browse", () => {
  const readyVitamin = buildRow({
    id: "ready-vitamin",
    productId: "ready-vitamin",
    brandName: "Jamieson",
    title: "Vitamin D3 1000 IU",
    categories: ["Vitamins"],
    searchText: "jamieson vitamin d3 cholecalciferol 1000 iu",
    ingredientFamilies: ["vitamin_d"],
    ingredients: [{ name: "Vitamin D3", dose: "1000 IU" }],
    factsStatus: "full",
    coverageStatus: "coverage_ready",
  });
  const lowFactsVitamin = buildRow({
    id: "low-facts-vitamin",
    productId: "low-facts-vitamin",
    brandName: "Unknown Brand",
    title: "Vitamin D Blend",
    categories: ["Vitamins"],
    searchText: "unknown brand vitamin d blend",
    ingredientFamilies: ["vitamin_d"],
    ingredients: [],
    factsStatus: "none",
    coverageStatus: "not_enough_structured_data",
    brandPopularity: 999,
  });

  const response = buildSearchResponseFromRows(
    [lowFactsVitamin, readyVitamin],
    { query: "", category: "Vitamins", page: 1, limit: 20 },
  );

  assert.equal(response.catalogStats.totalRecords, 2);
  assert.equal(response.catalogStats.analysisReadyTotal, 1);
  assert.equal(response.catalogStats.displayAnalysisReadyLabel, "1");
  assert.deepEqual(response.supplements.map((item) => item.productId), ["ready-vitamin"]);
  assert.equal(response.supplements[0]?.resultTier, "analysis_ready");
  assert.equal(response.supplements[0]?.resultTierLabel, "Ready for full analysis");
});

test("exact brand-product searches can include basic catalog rows after analysis-ready matches", () => {
  const readyOmega = buildRow({
    id: "ready-omega",
    productId: "ready-omega",
    brandName: "Sports Research",
    title: "Omega-3 Fish Oil",
    searchText: "sports research omega 3 fish oil epa dha softgels",
    ingredientFamilies: ["omega_3"],
    ingredients: [{ name: "Fish Oil", dose: "1250 mg" }],
    factsStatus: "full",
    coverageStatus: "coverage_ready",
  });
  const basicOmega = buildRow({
    id: "basic-omega",
    productId: "basic-omega",
    brandName: "Sports Research",
    title: "Omega-3 Softgels",
    searchText: "sports research omega 3 fish oil softgels",
    ingredientFamilies: ["omega_3"],
    ingredients: [{ name: "Fish Oil" }],
    factsStatus: "partial",
    coverageStatus: "not_enough_structured_data",
  });

  const response = buildSearchResponseFromRows(
    [basicOmega, readyOmega],
    { query: "Sports Research omega-3", page: 1, limit: 10 },
  );

  assert.deepEqual(response.supplements.map((item) => item.resultTier), [
    "analysis_ready",
    "basic_catalog",
  ]);
  assert.equal(response.supplements[1]?.resultTierLabel, "Basic record");
  assert.equal(response.supplements[1]?.resultTierDescription, "Not enough label detail for full analysis");
});

test("broad ingredient searches do not surface low-facts rows as primary results", () => {
  const readyMagnesium = buildRow({
    id: "ready-magnesium",
    productId: "ready-magnesium",
    brandName: "Webber Naturals",
    title: "Magnesium Bisglycinate 200 mg",
    searchText: "webber naturals magnesium bisglycinate glycinate mineral 200 mg",
    ingredientFamilies: ["magnesium"],
    formSignals: ["glycinate"],
    ingredients: [{ name: "Magnesium Bisglycinate", dose: "200 mg" }],
    factsStatus: "full",
    coverageStatus: "coverage_ready",
  });
  const lowFactsMagnesium = buildRow({
    id: "low-facts-magnesium",
    productId: "low-facts-magnesium",
    brandName: "Popular Fallback",
    title: "Magnesium Complex",
    searchText: "popular fallback magnesium complex mineral",
    ingredientFamilies: ["magnesium"],
    ingredients: [],
    factsStatus: "none",
    coverageStatus: "not_enough_structured_data",
    brandPopularity: 10000,
  });

  const response = buildSearchResponseFromRows(
    [lowFactsMagnesium, readyMagnesium],
    { query: "magnesium", page: 1, limit: 10 },
  );

  assert.deepEqual(response.supplements.map((item) => item.productId), ["ready-magnesium"]);
  assert.ok(response.supplements.every((item) => item.resultTier === "analysis_ready"));
});

test("classifySearchQueryIntent separates product, ingredient, benefit, and browse searches", () => {
  assert.equal(classifySearchQueryIntent("Jamieson Vitamin D3 1000 IU").kind, "exact_product");
  assert.equal(classifySearchQueryIntent("Sports Research omega-3").kind, "brand_product");
  assert.equal(classifySearchQueryIntent("magnesium glycinate").kind, "ingredient_family");
  assert.equal(classifySearchQueryIntent("D3 1000 IU").kind, "form_dose");
  assert.equal(classifySearchQueryIntent("B12 methylcobalamin").kind, "form_dose");
  assert.equal(classifySearchQueryIntent("sleep").kind, "benefit_goal");
  assert.equal(classifySearchQueryIntent("sleep").brandLead, null);
  assert.equal(classifySearchQueryIntent("joint support").kind, "benefit_goal");
  assert.equal(classifySearchQueryIntent("joint support").brandLead, null);
  assert.equal(classifySearchQueryIntent("protein").kind, "category_browse");
  assert.equal(classifySearchQueryIntent("probiotic").kind, "category_browse");
});

test("default Product Search warm queries cover release-critical intents", () => {
  const warmQueries = new Set(DEFAULT_PRODUCT_SEARCH_WARM_QUERIES);

  assert.ok(warmQueries.has("magnesium"));
  assert.ok(warmQueries.has("vitamin d"));
  assert.ok(warmQueries.has("omega-3"));
  assert.ok(warmQueries.has("gut health"));
  assert.ok(warmQueries.has("mood support"));
  assert.ok(warmQueries.has("selenium thyroid support"));
  assert.ok(warmQueries.has("Doctors Best high absorption magnesium"));
  assert.ok(warmQueries.has("Sports Research omega-3"));
  assert.ok(DEFAULT_PRODUCT_SEARCH_WARM_QUERIES.length <= 20);
});

test("buildProductSearchIndexRowFromSearchIndex maps lightweight DB rows into runtime search rows", () => {
  const row = buildProductSearchIndexRowFromSearchIndex({
    id: 10,
    overlay_id: 7,
    product_id: "ps-index-1",
    brand_name: "Index Brand",
    title: "Vitamin D3 1,000 IU Tablets",
    barcode_gtin14: "00012345678901",
    upc_code: "12345678901",
    image_url: "https://example.com/product.jpg",
    categories: ["Vitamins"],
    ingredients: [
      { name: "Vitamin D3", dose: "1,000 IU" },
      { substance: "Calcium", amountPerServing: "200 mg" },
    ],
    primary_facts_amount: "1,000 IU",
    serving_size: "1 Tablet",
    description: "Vitamin D supplement",
    suggested_use: "Take daily",
    search_text: "index brand vitamin d3 1000 iu tablets",
    ingredient_families: ["vitamin_d", "calcium"],
    form_signals: ["d3", "tablet"],
    strength_signals: ["1000 iu", "200 mg"],
    facts_status: "full",
    coverage_status: "coverage_ready",
    brand_popularity: 12,
    quality_rank: 132,
    source_updated_at: "2026-05-12T00:00:00Z",
  });

  assert.ok(row);
  assert.equal(row.productId, "ps-index-1");
  assert.equal(row.id, "7");
  assert.equal(row.searchText, "index brand vitamin d3 1000 iu tablets");
  assert.deepEqual(row.categories, ["Vitamins"]);
  assert.deepEqual(row.ingredients, [
    { name: "Vitamin D3", dose: "1,000 IU", proprietaryBlendSource: false, aggregateFormula: false },
    { name: "Calcium", dose: "200 mg", proprietaryBlendSource: false, aggregateFormula: false },
  ]);
  assert.deepEqual(row.ingredientFamilies, ["vitamin_d", "calcium"]);
  assert.deepEqual(row.formSignals, ["d3", "tablet"]);
  assert.deepEqual(row.strengthSignals, ["1000 iu", "200 mg"]);
  assert.equal(row.factsStatus, "full");
  assert.equal(row.coverageStatus, "coverage_ready");
  assert.equal(row.qualityRank, 132);
});

test("buildColdFallbackOrClauses expands tokenized family terms for cold title misses", () => {
  const clauses = buildColdFallbackOrClauses("tropical oasis trace minerals");

  assert.ok(clauses.includes("title.ilike.%tropical oasis trace minerals%"));
  assert.ok(clauses.includes("title.ilike.%tropical%"));
  assert.ok(clauses.includes("brand_name.ilike.%oasis%"));
  assert.ok(clauses.includes("title.ilike.%trace%"));
  assert.ok(clauses.includes("title.ilike.%minerals%"));
});

test("cold fallback splits known brand-product queries instead of treating the whole query as brand", () => {
  assert.equal(extractColdFallbackBrandLead("sports research omega-3"), "sports research");
  assert.deepEqual(extractColdFallbackCoreTerms("sports research omega-3"), ["omega 3"]);

  const clauses = buildColdFallbackOrClauses("sports research omega-3");
  assert.ok(clauses.includes("title.ilike.%omega 3%"));
  assert.ok(clauses.includes("brand_name.ilike.%omega 3%"));
  assert.ok(!clauses.includes("brand_name.ilike.%sports research omega 3%"));
});

test("cold fallback keeps ingredient-goal queries out of brand lead parsing", () => {
  assert.equal(extractColdFallbackBrandLead("selenium thyroid support"), null);
  assert.deepEqual(extractColdFallbackCoreTerms("selenium thyroid support"), ["selenium"]);
  assert.ok(
    buildProductSearchIndexOrClauses("selenium thyroid support").includes("search_text.ilike.%selenium%"),
  );
});

test("product search index OR clauses avoid impossible full brand-product brand predicates", () => {
  const clauses = buildProductSearchIndexOrClauses("sports research omega-3");

  assert.ok(clauses.includes("search_text.ilike.%sports research omega 3%"));
  assert.ok(clauses.includes("search_text.ilike.%omega 3%"));
  assert.ok(!clauses.includes("brand_name.ilike.%sports research omega 3%"));
});

test("focused cold candidate fetch can stop before broad expansion for filled brand-product windows", () => {
  const brandIntent = classifySearchQueryIntent("Sports Research omega-3");
  assert.equal(brandIntent.kind, "brand_product");

  assert.equal(
    shouldStopAfterFocusedColdCandidateFetch(
      { query: "Sports Research omega-3", page: 1, limit: 20 },
      brandIntent,
      20,
    ),
    true,
  );
  assert.equal(
    shouldStopAfterFocusedColdCandidateFetch(
      { query: "Sports Research omega-3", page: 1, limit: 20 },
      brandIntent,
      19,
    ),
    false,
  );
  assert.equal(
    shouldStopAfterFocusedColdCandidateFetch(
      { query: "Sports Research omega-3", page: 2, limit: 20 },
      brandIntent,
      20,
    ),
    false,
  );

  const exactProductIntent = classifySearchQueryIntent("Jamieson Vitamin D3 1000 IU");
  assert.equal(exactProductIntent.kind, "exact_product");
  assert.equal(
    shouldStopAfterFocusedColdCandidateFetch(
      { query: "Jamieson Vitamin D3 1000 IU", page: 1, limit: 10 },
      exactProductIntent,
      10,
    ),
    true,
  );
});

test("focused cold candidate fetch still expands broad ingredient searches", () => {
  const ingredientIntent = classifySearchQueryIntent("magnesium");
  assert.equal(ingredientIntent.kind, "ingredient_family");

  assert.equal(
    shouldStopAfterFocusedColdCandidateFetch(
      { query: "magnesium", page: 1, limit: 20 },
      ingredientIntent,
      80,
    ),
    false,
  );
});

test("buildSearchResponseFromRows returns hasMore and nextPage for continuation lists", () => {
  const rows = Array.from({ length: 45 }, (_, index) =>
    buildRow({
      id: `row-${index}`,
      productId: `product-${index}`,
      title: `Magnesium Glycinate ${index}`,
      brandName: `Brand ${index}`,
      ingredientFamilies: ["magnesium"],
      formSignals: ["glycinate"],
      searchText: `magnesium glycinate brand ${index}`,
      ingredients: [{ name: "Magnesium Glycinate", dose: "200 mg" }],
    }),
  );

  const response = buildSearchResponseFromRows(rows, {
    query: "magnesium glycinate",
    page: 2,
    limit: 20,
  });

  assert.equal(response.pagination.page, 2);
  assert.equal(response.pagination.limit, 20);
  assert.equal(response.pagination.total, 45);
  assert.equal(response.pagination.hasMore, true);
  assert.equal(response.pagination.nextPage, 3);
  assert.equal(response.pagination.shown, 40);
  assert.equal(response.pagination.totalIsExact, true);
});

test("cold Search ranking window is stable across continuation pages", () => {
  const page1Window = getStableRankingWindow({
    query: "magnesium glycinate",
    page: 1,
    limit: 20,
  });
  const page7Window = getStableRankingWindow({
    query: "magnesium glycinate",
    page: 7,
    limit: 20,
  });

  assert.equal(page1Window, page7Window);
});

test("search response marks capped candidate totals as inexact", () => {
  const rows = Array.from({ length: 220 }, (_, index) =>
    buildRow({
      id: `capped-${index}`,
      productId: `capped-product-${index}`,
      title: `Magnesium Glycinate ${index}`,
      brandName: `Brand ${index}`,
      ingredientFamilies: ["magnesium"],
      formSignals: ["glycinate"],
      searchText: `magnesium glycinate brand ${index}`,
      ingredients: [{ name: "Magnesium Glycinate", dose: "200 mg" }],
    }),
  );

  const response = buildSearchResponseFromRows(rows, {
    query: "magnesium glycinate",
    page: 1,
    limit: 20,
  });

  assert.equal(response.pagination.totalIsExact, false);
});

test("Product Search pagination slices a stable ordered candidate set without duplicates", () => {
  const rows = Array.from({ length: 80 }, (_, index) =>
    buildRow({
      id: `stable-${index}`,
      productId: `stable-product-${index}`,
      title: `Vitamin D3 1000 IU ${index}`,
      brandName: `Brand ${index % 8}`,
      ingredientFamilies: ["vitamin_d"],
      formSignals: ["d3"],
      strengthSignals: ["1000 iu"],
      searchText: `vitamin d3 1000 iu brand ${index}`,
      ingredients: [{ name: "Vitamin D3", dose: "1,000 IU" }],
      qualityRank: 80 - index,
    }),
  );

  const page1 = buildSearchResponseFromRows(rows, { query: "vitamin d3 1000 iu", page: 1, limit: 20 });
  const page2 = buildSearchResponseFromRows(rows, { query: "vitamin d3 1000 iu", page: 2, limit: 20 });
  const first30 = buildSearchResponseFromRows(rows, { query: "vitamin d3 1000 iu", page: 1, limit: 30 });
  const pageIds = [...page1.supplements, ...page2.supplements].map((item) => item.productId);

  assert.equal(new Set(pageIds).size, pageIds.length);
  assert.deepEqual(pageIds.slice(0, 30), first30.supplements.map((item) => item.productId));
  assert.equal(page1.pagination.hasMore, true);
  assert.equal(page2.pagination.hasMore, true);
});

test("Product Search browse bootstrap caches continuation rows instead of a one-page dead end", () => {
  const rows = Array.from({ length: 160 }, (_, index) =>
    buildRow({
      id: `browse-${index}`,
      productId: `browse-product-${index}`,
      title: `Vitamin C Browse Supplement ${index}`,
      brandName: `Brand ${index % 12}`,
      searchText: `vitamin c browse supplement ${index}`,
      categories: ["Vitamins"],
      ingredientFamilies: ["vitamin_c"],
      ingredients: [{ name: "Vitamin C", dose: "100 mg" }],
      brandPopularity: 160 - index,
      qualityRank: 160 - index,
    }),
  );

  const bootstrap = buildProductSearchBootstrapPayloadFromRows(rows);
  const allRows = bootstrap.categories.All ?? [];
  const vitaminsRows = bootstrap.categories.Vitamins ?? [];
  const allPagination = bootstrap.paginationByCategory?.All;

  assert.equal(PRODUCT_SEARCH_BROWSE_BOOTSTRAP_LIMIT, 120);
  assert.equal(allRows.length, PRODUCT_SEARCH_BROWSE_BOOTSTRAP_LIMIT);
  assert.equal(vitaminsRows.length, PRODUCT_SEARCH_BROWSE_BOOTSTRAP_LIMIT);
  assert.equal(allPagination?.total, 160);
  assert.equal(allPagination?.shown, 20);
  assert.equal(allPagination?.hasMore, true);
  assert.equal(allPagination?.nextPage, 2);
  assert.equal(bootstrap.catalogStats.totalRecords, 160);
  assert.equal(bootstrap.catalogStats.analysisReadyTotal, 160);
  assert.equal(bootstrap.catalogStats.displayAnalysisReadyLabel, "160");
  assert.equal(new Set(allRows.map((item) => item.productId)).size, allRows.length);
});

test("brand-product pagination stays relevance-first instead of forcing brand diversity", () => {
  const sportsResearchRows = Array.from({ length: 6 }, (_, index) =>
    buildRow({
      id: `sr-omega-${index}`,
      productId: `sr-omega-${index}`,
      brandName: "Sports Research",
      title: `Omega-3 Fish Oil ${index}`,
      ingredientFamilies: ["omega_3"],
      formSignals: ["softgel"],
      searchText: `sports research omega 3 fish oil softgel ${index}`,
      ingredients: [{ name: "Omega-3 Fish Oil", dose: "1,250 mg" }],
      brandPopularity: 20,
      qualityRank: 50 - index,
    }),
  );
  const decoyRows = Array.from({ length: 6 }, (_, index) =>
    buildRow({
      id: `decoy-omega-${index}`,
      productId: `decoy-omega-${index}`,
      brandName: `Popular Omega Brand ${index}`,
      title: `Omega-3 Fish Oil ${index}`,
      ingredientFamilies: ["omega_3"],
      formSignals: ["softgel"],
      searchText: `popular omega brand ${index} omega 3 fish oil softgel`,
      ingredients: [{ name: "Omega-3 Fish Oil", dose: "1,250 mg" }],
      brandPopularity: 2000,
      qualityRank: 100,
    }),
  );

  const response = buildSearchResponseFromRows(
    [...decoyRows, ...sportsResearchRows],
    { query: "Sports Research omega-3", page: 1, limit: 6 },
  );

  assert.deepEqual(
    response.supplements.slice(0, 5).map((item) => item.brand),
    ["Sports Research", "Sports Research", "Sports Research", "Sports Research", "Sports Research"],
  );
});

test("exact brand-product search prefers the requested product over adjacent high-absorption decoys", () => {
  const response = buildSearchResponseFromRows(
    [
      buildRow({
        id: "db-curcumin",
        productId: "db-curcumin",
        brandName: "Doctor's Best",
        title: "Curcumin Phytosome, 60 Veggie Caps (500 mg per Capsule)",
        searchText: "doctor s best curcumin phytosome high absorption magnesium stearate",
        ingredients: [
          { name: "Curcumin Phytosome", dose: "500 mg" },
          { name: "Magnesium Stearate", dose: null },
        ],
        brandPopularity: 5000,
        qualityRank: 120,
      }),
      buildRow({
        id: "db-magnesium",
        productId: "db-magnesium",
        brandName: "Doctor's Best",
        title: "High Absorption Magnesium, 120 Tablets",
        searchText: "doctor s best high absorption magnesium lysinate glycinate",
        ingredientFamilies: ["magnesium"],
        formSignals: ["glycinate"],
        ingredients: [{ name: "Magnesium Lysinate Glycinate", dose: "100 mg" }],
        brandPopularity: 10,
        qualityRank: 20,
      }),
    ],
    { query: "Doctors Best high absorption magnesium", page: 1, limit: 2 },
  );

  assert.equal(response.supplements[0]?.productId, "db-magnesium");
});

test("brand omega searches prefer visible omega products over DHA-only brand matches", () => {
  const response = buildSearchResponseFromRows(
    [
      buildRow({
        id: "nordic-dha",
        productId: "nordic-dha",
        brandName: "Nordic Naturals",
        title: "Algae DHA, 60 Soft Gels",
        searchText: "nordic naturals algae dha vegetarian",
        ingredientFamilies: ["omega_3"],
        ingredients: [{ name: "DHA", dose: "250 mg" }],
        brandPopularity: 5000,
        qualityRank: 120,
      }),
      buildRow({
        id: "nordic-omega",
        productId: "nordic-omega",
        brandName: "Nordic Naturals",
        title: "Ultimate Omega, Lemon, 120 Soft Gels",
        searchText: "nordic naturals ultimate omega fish oil epa dha",
        ingredientFamilies: ["omega_3"],
        ingredients: [{ name: "Omega-3 Fish Oil", dose: "1,280 mg" }],
        brandPopularity: 10,
        qualityRank: 20,
      }),
    ],
    { query: "Nordic Naturals omega 3", page: 1, limit: 2 },
  );

  assert.equal(response.supplements[0]?.productId, "nordic-omega");
});

test("ingredient plus goal query treats thyroid support as optional and returns selenium products", () => {
  const response = buildSearchResponseFromRows(
    [
      buildRow({
        id: "coq10-selenium",
        productId: "coq10-selenium",
        title: "CoQ10 With Selenium & Vitamin E, 100 Softgels",
        ingredientFamilies: ["selenium"],
        searchText: "coq10 with selenium vitamin e antioxidant",
        ingredients: [{ name: "Selenium", dose: "200 mcg" }],
        brandPopularity: 5000,
        qualityRank: 120,
      }),
      buildRow({
        id: "selenium",
        productId: "selenium",
        title: "Selenium, 200 mcg, 180 Veg Capsules",
        ingredientFamilies: ["selenium"],
        searchText: "selenium 200 mcg trace mineral antioxidant",
        ingredients: [{ name: "Selenium", dose: "200 mcg" }],
      }),
    ],
    { query: "selenium thyroid support", page: 1, limit: 20 },
  );

  assert.equal(response.supplements[0]?.productId, "selenium");
});

test("gut health searches prefer digestive/probiotic intent over weight-management fiber fallbacks", () => {
  const response = buildSearchResponseFromRows(
    [
      buildRow({
        id: "glucomannan",
        productId: "glucomannan",
        title: "Glucomannan, 575 mg, 180 Veg Capsules",
        searchText: "glucomannan weight management appetite fiber",
        ingredients: [{ name: "Glucomannan", dose: "575 mg" }],
        brandPopularity: 5000,
        qualityRank: 120,
      }),
      buildRow({
        id: "gut-probiotic",
        productId: "gut-probiotic",
        title: "Probiotic Gut Health, 50 Billion CFU",
        searchText: "probiotic gut health digestive support microbiome 50 billion cfu",
        ingredientFamilies: ["probiotic"],
        ingredients: [{ name: "Probiotic Blend", dose: "50 Billion CFU" }],
        brandPopularity: 10,
        qualityRank: 20,
      }),
    ],
    { query: "gut health", page: 1, limit: 2 },
  );

  assert.equal(response.supplements[0]?.productId, "gut-probiotic");
});

test("broad goal searches diversify brands after keeping goal relevance", () => {
  const nowRows = Array.from({ length: 4 }, (_, index) =>
    buildRow({
      id: `now-gut-${index}`,
      productId: `now-gut-${index}`,
      brandName: "NOW Foods",
      title: `Digestive Probiotic ${index}`,
      searchText: `now foods digestive probiotic gut health microbiome ${index}`,
      ingredientFamilies: ["probiotic"],
      ingredients: [{ name: "Probiotic Blend", dose: "10 Billion CFU" }],
      brandPopularity: 5000,
      qualityRank: 120 - index,
    }),
  );
  const response = buildSearchResponseFromRows(
    [
      ...nowRows,
      buildRow({
        id: "garden-gut",
        productId: "garden-gut",
        brandName: "Garden of Life",
        title: "Digestive Probiotic, 50 Billion CFU",
        searchText: "garden of life digestive probiotic gut health microbiome",
        ingredientFamilies: ["probiotic"],
        ingredients: [{ name: "Probiotic Blend", dose: "50 Billion CFU" }],
        brandPopularity: 10,
        qualityRank: 20,
      }),
    ],
    { query: "gut health", page: 1, limit: 5 },
  );

  assert.equal(response.supplements[0]?.brand, "NOW Foods");
  assert.equal(response.supplements[1]?.brand, "Garden of Life");
});

test("mood support searches prefer explicit mood products over generic stress adaptogens", () => {
  const response = buildSearchResponseFromRows(
    [
      buildRow({
        id: "ashwagandha",
        productId: "ashwagandha",
        title: "Ashwagandha Stress Support, 60 Veg Capsules",
        searchText: "ashwagandha stress support adaptogen calm",
        ingredientFamilies: ["ashwagandha"],
        ingredients: [{ name: "Ashwagandha", dose: "450 mg" }],
        brandPopularity: 5000,
        qualityRank: 120,
      }),
      buildRow({
        id: "mood-support",
        productId: "mood-support",
        title: "Mood Support with St. John's Wort, 90 Veg Capsules",
        searchText: "mood support st john s wort emotional wellness",
        ingredientFamilies: ["st_johns_wort"],
        ingredients: [{ name: "St. John's Wort", dose: "300 mg" }],
        brandPopularity: 10,
        qualityRank: 20,
      }),
    ],
    { query: "mood support", page: 1, limit: 2 },
  );

  assert.equal(response.supplements[0]?.productId, "mood-support");
});

test("brand-product continuation excludes same-brand products that only mention the family in generic copy", () => {
  const omegaRows = Array.from({ length: 20 }, (_, index) =>
    buildRow({
      id: `sr-omega-page-${index}`,
      productId: `sr-omega-page-${index}`,
      brandName: "Sports Research",
      title: `Omega-3 Fish Oil ${index}`,
      ingredientFamilies: ["omega_3"],
      searchText: `sports research omega 3 fish oil epa dha ${index}`,
      ingredients: [{ name: "Omega-3 Fish Oil", dose: "1,250 mg" }],
      qualityRank: 40 - index,
    }),
  );
  const adjacentRows = [
    buildRow({
      id: "sr-collagen",
      productId: "sr-collagen",
      brandName: "Sports Research",
      title: "Multi Collagen, Chocolate",
      searchText: "sports research multi collagen chocolate pairs with an omega 3 routine",
      ingredientFamilies: ["protein"],
      ingredients: [{ name: "Collagen Peptides", dose: "9,850 mg" }],
      brandPopularity: 5000,
      qualityRank: 120,
    }),
    buildRow({
      id: "sr-quercetin",
      productId: "sr-quercetin",
      brandName: "Sports Research",
      title: "Quercetin, 120 Softgels",
      searchText: "sports research quercetin softgels pairs with fish oil",
      ingredients: [{ name: "Quercetin", dose: "1,250 mg" }],
      brandPopularity: 4000,
      qualityRank: 110,
    }),
  ];

  const page2 = buildSearchResponseFromRows(
    [...adjacentRows, ...omegaRows],
    { query: "Sports Research omega-3", page: 2, limit: 20 },
  );

  assert.deepEqual(page2.supplements.map((item) => item.productId), []);
  assert.equal(page2.pagination.hasMore, false);
});

test("buildColdFallbackOrClauses keeps barcode-like queries exact and numeric", () => {
  const clauses = buildColdFallbackOrClauses("00617279334578");

  assert.deepEqual(clauses, [
    "upc_code.ilike.%00617279334578%",
    "barcode_gtin14.ilike.%00617279334578%",
  ]);
});

test("barcode exact search detects warm-index misses that need cold fallback", () => {
  const emptyResponse: ProductSearchResponse = {
    supplements: [],
    pagination: {
      total: 0,
      page: 1,
      limit: 20,
      totalPages: 1,
      hasMore: false,
      nextPage: null,
      shown: 0,
      totalIsExact: true,
    },
    suggestions: { categories: [], brands: [], popularSearches: [] },
    catalogStats: {
      totalRecords: 0,
      analysisReadyTotal: 0,
      displayTotalRecordsLabel: "0",
      displayAnalysisReadyLabel: "0",
    },
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
        resultTier: "analysis_ready",
        resultTierLabel: "Ready for full analysis",
        resultTierDescription: null,
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

test("exact barcode search can return a food-like product without opening generic tea search", () => {
  assert.equal(
    shouldAllowExactBarcodeNonSupplementResult({
      name: "NOW Foods, Better Off Red Tea, Caffeine Free, 24 Tea Bags",
      description: "Premium steeping tea",
      barcode: "00733739042217",
      upcCode: "733739042217",
      query: "00733739042217",
    }),
    true,
  );
  assert.equal(
    shouldAllowExactBarcodeNonSupplementResult({
      name: "NOW Foods, Better Off Red Tea, Caffeine Free, 24 Tea Bags",
      description: "Premium steeping tea",
      barcode: "00733739042217",
      upcCode: "733739042217",
      query: "Better Off Red Tea",
    }),
    false,
  );
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

test("computeSearchScoreForQueryPlan does not let vitamin d queries rank unrelated vitamin c products", () => {
  const plan = buildSearchQueryPlan("vitamin d");
  const vitaminDRow = buildRow({
    title: "Vitamin D3 1,000 IU Softgels",
    brandName: "Jamieson",
    searchText: "jamieson vitamin d3 vitamin d cholecalciferol immune bone 1000 iu",
    ingredients: [{ name: "Vitamin D3 (Cholecalciferol)", dose: "1,000 IU" }],
  });
  const vitaminCRow = buildRow({
    title: "Vitamin C Sodium Ascorbate",
    brandName: "New Roots Herbal",
    searchText: "new roots herbal vitamin c sodium ascorbate immune antioxidant",
    ingredients: [{ name: "Vitamin C", dose: "1,000 mg" }],
  });

  assert.ok(computeSearchScoreForQueryPlan(vitaminDRow, plan) > 0);
  assert.equal(computeSearchScoreForQueryPlan(vitaminCRow, plan), 0);
});

test("broad ingredient search diversifies top results by brand and prefers coverage before popularity", () => {
  const response = buildSearchResponseFromRows(
    [
      buildRow({
        id: "webber-1",
        productId: "webber-1",
        brandName: "Webber Naturals",
        title: "Magnesium Bisglycinate 200 mg",
        searchText: "webber naturals magnesium bisglycinate mineral 200 mg",
        ingredients: [{ name: "Magnesium", dose: "200 mg" }],
        brandPopularity: 900,
      }),
      buildRow({
        id: "webber-2",
        productId: "webber-2",
        brandName: "Webber Naturals",
        title: "Magnesium Citrate 150 mg",
        searchText: "webber naturals magnesium citrate mineral 150 mg",
        ingredients: [{ name: "Magnesium", dose: "150 mg" }],
        brandPopularity: 900,
      }),
      buildRow({
        id: "jamieson-1",
        productId: "jamieson-1",
        brandName: "Jamieson",
        title: "Magnesium 250 mg Caplets",
        searchText: "jamieson magnesium mineral 250 mg",
        ingredients: [{ name: "Magnesium", dose: "250 mg" }],
        brandPopularity: 30,
      }),
      buildRow({
        id: "now-1",
        productId: "now-1",
        brandName: "NOW Foods",
        title: "Magnesium Caps",
        searchText: "now foods magnesium mineral caps",
        ingredients: [{ name: "Magnesium", dose: "250 mg" }],
        brandPopularity: 1200,
      }),
    ],
    { query: "magnesium", page: 1, limit: 4 },
  );

  const topBrands = response.supplements.slice(0, 3).map((item) => item.brand);
  assert.equal(new Set(topBrands).size, 3);
  assert.deepEqual([...topBrands].sort(), [
    "Jamieson",
    "NOW Foods",
    "Webber Naturals",
  ]);
  assert.equal(response.supplements[0]?.coverageStatus, "coverage_ready");
  assert.equal(response.supplements[0]?.matchReason, "Title match");
});

test("tier-first search keeps exact form and brand-product matches above coverage/popularity boosts", () => {
  const d3ExactDose = buildRow({
    id: "d3-1000-empty",
    productId: "d3-1000-empty",
    brandName: "Small Brand",
    title: "Vitamin D3 1,000 IU Tablets",
    searchText: "small brand vitamin d3 vitamin d cholecalciferol 1000 iu tablets",
    ingredients: [],
    brandPopularity: 1,
  });
  const d3WrongDoseCoverage = buildRow({
    id: "d3-2500-full",
    productId: "d3-2500-full",
    brandName: "Popular Brand",
    title: "Vitamin D3 2,500 IU Softgels",
    searchText: "popular brand vitamin d3 vitamin d cholecalciferol 2500 iu softgels",
    ingredients: [{ name: "Vitamin D3 (Cholecalciferol)", dose: "2,500 IU" }],
    brandPopularity: 2000,
  });
  const sportsResearchOmega = buildRow({
    id: "sports-research-omega",
    productId: "sports-research-omega",
    brandName: "Sports Research",
    title: "Alaskan Omega-3 Fish Oil, 1,250 mg",
    searchText: "sports research alaskan omega 3 fish oil epa dha 1250 mg softgels",
    ingredients: [{ name: "Omega-3 Fish Oil", dose: "1,250 mg" }],
    brandPopularity: 10,
  });
  const nordicOmega = buildRow({
    id: "nordic-omega",
    productId: "nordic-omega",
    brandName: "Nordic Naturals",
    title: "Ultimate Omega Fish Oil, 1,280 mg",
    searchText: "nordic naturals ultimate omega 3 fish oil epa dha 1280 mg softgels",
    ingredients: [{ name: "Omega-3 Fish Oil", dose: "1,280 mg" }],
    brandPopularity: 3000,
  });

  const d3Intent = classifySearchQueryIntent("D3 1000 IU");
  assert.equal(scoreSearchRelevanceTier(d3ExactDose, d3Intent).tier, 1);
  assert.equal(scoreSearchRelevanceTier(d3WrongDoseCoverage, d3Intent).tier, 2);

  const d3Response = buildSearchResponseFromRows(
    [d3WrongDoseCoverage, d3ExactDose],
    { query: "D3 1000 IU", page: 1, limit: 2 },
  );
  assert.equal(d3Response.supplements[0]?.productId, "d3-1000-empty");

  const brandResponse = buildSearchResponseFromRows(
    [nordicOmega, sportsResearchOmega],
    { query: "Sports Research omega-3", page: 1, limit: 2 },
  );
  assert.equal(brandResponse.supplements[0]?.productId, "sports-research-omega");
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
