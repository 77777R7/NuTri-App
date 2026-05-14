import assert from "node:assert/strict";
import test from "node:test";
import {
  loadGoldenJourneyPack,
  validateGoldenJourneyPack,
} from "../../scripts/maintainer/lib/cross-surface-quality-reporting.mjs";

const EXPECTED_INTENTS = new Set([
  "exact_barcode",
  "exact_product",
  "brand_product",
  "ingredient_family",
  "form_dose",
  "benefit_goal",
  "category_browse",
  "discovery",
]);

test("Product Search P0 release pack covers 80-100 real user-style search scenarios with intent and tier contracts", async () => {
  const pack = await loadGoldenJourneyPack("data/validation/search-p0-release-pack.v0.json");
  const errors = validateGoldenJourneyPack(pack);
  assert.deepEqual(errors, []);

  const searchScenarios = pack.scenarios.filter((scenario) => scenario.surface === "search");
  assert.ok(searchScenarios.length >= 80);
  assert.ok(searchScenarios.length <= 100);
  assert.ok(searchScenarios.every((scenario) => EXPECTED_INTENTS.has(scenario.expected.search.intent)));
  assert.ok(searchScenarios.every((scenario) => Number.isInteger(scenario.expected.search.tier)));
  assert.deepEqual(
    Array.from(new Set(searchScenarios.map((scenario) => scenario.expected.search.tier))).sort(),
    [0, 1, 2, 3, 4],
  );
  for (const intent of EXPECTED_INTENTS) {
    assert.ok(
      searchScenarios.some((scenario) => scenario.expected.search.intent === intent),
      `missing intent ${intent}`,
    );
  }
  assert.ok(searchScenarios.some((scenario) => scenario.expected.search.metric === "zero_results"));
  assert.ok(searchScenarios.some((scenario) => scenario.input.queryType === "category_filter"));
  assert.ok(searchScenarios.some((scenario) => Number(scenario.input.page ?? 1) > 1));
  assert.ok(searchScenarios.some((scenario) => Number(scenario.input.page ?? 1) >= 3));
  assert.ok(
    searchScenarios.some((scenario) =>
      scenario.input.queryType === "category_filter" &&
      scenario.input.category === "Vitamins" &&
      Number(scenario.input.page ?? 1) === 2
    ),
  );
  assert.ok(
    searchScenarios.some((scenario) =>
      scenario.expected.search.intent === "brand_product" &&
      Number(scenario.input.page ?? 1) === 2 &&
      scenario.expected.search.brandProductNoForcedDiversity === true
    ),
  );
  assert.ok(searchScenarios.some((scenario) => scenario.input.queryType === "vitamin_phrase"));
  assert.ok(searchScenarios.some((scenario) => scenario.input.queryType === "ingredient_form"));
});
