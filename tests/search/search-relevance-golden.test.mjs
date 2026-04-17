import assert from "node:assert/strict";
import test from "node:test";
import {
  evaluateClickThroughSeedConsistency,
  loadGoldenJourneyPack,
  scoreSearchRelevanceCase,
} from "../../scripts/maintainer/lib/cross-surface-quality-reporting.mjs";

const pack = await loadGoldenJourneyPack();
const searchScenarios = pack.scenarios.filter((scenario) => scenario.surface === "search");
const searchOriginScenarios = pack.scenarios.filter((scenario) => scenario.surface === "search_origin_result");
const packV1 = await loadGoldenJourneyPack("data/validation/golden-journey-pack.v1.json");
const searchScenariosV1 = packV1.scenarios.filter((scenario) => scenario.surface === "search");

const makeSupplement = (scenario, overrides = {}) => ({
  id: overrides.id ?? scenario.product.productId,
  productId: overrides.productId ?? scenario.product.productId,
  barcode: overrides.barcode ?? scenario.product.barcode ?? null,
  upcCode: overrides.upcCode ?? null,
  name: overrides.name ?? scenario.product.name,
  brand: overrides.brand ?? scenario.product.brand,
  category: overrides.category ?? "Supplement",
  benefit: overrides.benefit ?? "Fixture result",
  dose: overrides.dose ?? "",
  factsStatus: overrides.factsStatus ?? "partial",
  coverageStatus: overrides.coverageStatus ?? "coverage_ready",
});

const makeDecoy = (index) => ({
  id: `decoy-${index}`,
  productId: `decoy-${index}`,
  barcode: null,
  upcCode: null,
  name: `Decoy Product ${index}`,
  brand: "Decoy Brand",
  category: "Supplement",
  benefit: "Irrelevant fixture",
  dose: "",
  factsStatus: "partial",
  coverageStatus: "not_enough_structured_data",
});

const buildPassingResults = (scenario) => {
  const expected = makeSupplement(scenario);
  const metric = scenario.expected.search.metric;
  if (metric === "top1" || metric === "barcode_exact") return [expected, makeDecoy(1), makeDecoy(2)];
  if (metric === "top3") return [makeDecoy(1), expected, makeDecoy(2), makeDecoy(3)];
  return [makeDecoy(1), makeDecoy(2), makeDecoy(3), makeDecoy(4), expected];
};

const asApiResponse = (results) => ({
  success: true,
  data: {
    supplements: results,
    pagination: {
      total: results.length,
      page: 1,
      limit: 20,
      totalPages: 1,
    },
    suggestions: {
      categories: [],
      brands: [],
      popularSearches: [],
    },
  },
});

test("golden search scenarios define the first API relevance matrix", () => {
  assert.equal(searchScenarios.length, 7);
  assert.deepEqual(
    searchScenarios.map((scenario) => scenario.input.queryType).sort(),
    ["alias", "alias", "alias", "barcode", "brand_product", "brand_product", "typo"],
  );
});

test("search relevance scorer accepts API-shaped responses for top1, top3, recall5, and barcode exact gates", () => {
  for (const scenario of searchScenarios) {
    const response = asApiResponse(buildPassingResults(scenario));
    const scored = scoreSearchRelevanceCase({ scenario, response });
    assert.equal(scored.status, "pass", `${scenario.id} should pass`);
    assert.equal(scored.details.expectedProductId, scenario.expected.search.expectedProductId);
  }
});

test("search relevance scorer fails brand-family top1 when the expected product is not top1", () => {
  const scenario = searchScenarios.find((item) => item.id === "search_brand_family_sr_omega3");
  assert.ok(scenario);

  const response = asApiResponse([
    makeDecoy(1),
    makeSupplement(scenario),
    makeDecoy(2),
  ]);
  const scored = scoreSearchRelevanceCase({ scenario, response });

  assert.equal(scored.status, "fail");
  assert.equal(scored.reason, "search_top1_miss");
  assert.equal(scored.details.rank, 2);
});

test("search relevance scorer can use must-match terms for real API alias replay", () => {
  const scenario = searchScenarios.find((item) => item.id === "search_alias_sensoril_ashwagandha");
  assert.ok(scenario);

  const response = asApiResponse([
    makeDecoy(1),
    {
      ...makeDecoy(2),
      productId: "real-api-product-id",
      name: "Ashwagandha Sensoril Stress Support",
      brand: "Fixture Herbs",
      benefit: "Ashwagandha extract with Sensoril",
    },
  ]);
  const scored = scoreSearchRelevanceCase({ scenario, response });

  assert.equal(scored.status, "pass");
  assert.equal(scored.details.rank, 2);
  assert.equal(scored.details.matchMode, "terms");
});

test("search relevance scorer can match real API products by expected barcode", () => {
  const scenario = searchScenarios.find((item) => item.id === "search_brand_family_sr_omega3");
  assert.ok(scenario);

  const response = asApiResponse([
    makeSupplement(scenario, {
      productId: "real-api-product-id",
      barcode: "00023249011835",
    }),
  ]);
  const scored = scoreSearchRelevanceCase({ scenario, response });

  assert.equal(scored.status, "pass");
  assert.equal(scored.details.rank, 1);
  assert.equal(scored.details.matchMode, "barcode");
});

test("barcode exact gate requires the expected product and barcode at rank one", () => {
  const scenario = searchScenarios.find((item) => item.id === "search_barcode_sr_omega3");
  assert.ok(scenario);

  const wrongBarcodeResponse = asApiResponse([
    makeSupplement(scenario, { barcode: "00000000000001" }),
  ]);
  const scored = scoreSearchRelevanceCase({ scenario, response: wrongBarcodeResponse });

  assert.equal(scored.status, "fail");
  assert.equal(scored.reason, "search_barcode_exact_miss");
});

test("search-origin seeds preserve product identity before entering scan result", () => {
  assert.equal(searchOriginScenarios.length, 3);

  for (const scenario of searchOriginScenarios) {
    const scored = evaluateClickThroughSeedConsistency(scenario);
    assert.equal(scored.status, "pass", `${scenario.id} seed should match product`);
  }

  const drifted = evaluateClickThroughSeedConsistency(searchOriginScenarios[0], {
    product: {
      productId: "different-product",
      brand: searchOriginScenarios[0].product.brand,
      name: searchOriginScenarios[0].product.name,
      barcode: searchOriginScenarios[0].product.barcode,
    },
  });
  assert.equal(drifted.status, "fail");
  assert.deepEqual(drifted.details.mismatches, ["productId"]);
});

test("v1 real search scenarios extend replay expectations for krill, whey, and 600+D3 queries", () => {
  const realSearchIds = [
    "search_real_21stcentury_krill_oil",
    "search_real_alani_whey_fruity_cereal",
    "search_real_21stcentury_600_d3",
  ];

  for (const id of realSearchIds) {
    const scenario = searchScenariosV1.find((item) => item.id === id);
    assert.ok(scenario, `missing scenario ${id}`);

    const response = asApiResponse(buildPassingResults(scenario));
    const scored = scoreSearchRelevanceCase({ scenario, response });
    assert.equal(scored.status, "pass", `${scenario.id} should pass`);
  }
});
