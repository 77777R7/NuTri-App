import assert from "node:assert/strict";
import test from "node:test";
import { loadGoldenJourneyPack } from "../../scripts/maintainer/lib/cross-surface-quality-reporting.mjs";

const pack = await loadGoldenJourneyPack();
const scenarios = pack.scenarios;

const byId = (id) => {
  const scenario = scenarios.find((item) => item.id === id);
  assert.ok(scenario, `missing scenario ${id}`);
  return scenario;
};

const normalizeBarcode = (value) => String(value ?? "").replace(/\D/g, "");

test("golden journey pack stays on the fixed 32-scenario stable gate with the targeted focus lanes", () => {
  assert.equal(scenarios.length, 32);

  const categories = new Set(scenarios.map((scenario) => scenario.category));
  for (const category of [
    "omega3_source_oil",
    "probiotic_microbiome",
    "sleep_amino",
    "food_like",
    "sparse_title_led",
  ]) {
    assert.ok(categories.has(category), `missing category ${category}`);
  }

  const personas = new Set(scenarios.flatMap((scenario) => scenario.personas ?? []));
  for (const persona of [
    "fish_allergy",
    "shellfish_allergy",
    "soy_allergy",
    "vegan_preference",
    "melatonin_sensitivity",
    "digestion_goal",
    "duplicate_zinc_magnesium_d",
  ]) {
    assert.ok(personas.has(persona), `missing persona ${persona}`);
  }
});

test("golden journey pack keeps the key sparse, food-like, omega, probiotic, sleep, and duplicate-stack fixtures", () => {
  for (const id of [
    "scan_core_nac_sparse_result",
    "scan_malformed_label_data_limited",
    "scan_beet_juice_food_like",
    "scan_core_sr_omega3_fish_allergy",
    "scan_krill_oil_shellfish",
    "scan_natures_way_algal_oil_vegan",
    "scan_core_gi_phage_digestive_goal",
    "scan_biogaia_protectis_zero_facts",
    "scan_5htp_melatonin_sleep",
    "scan_cal_mag_stack_duplicate",
    "scan_soy_lectin_allergy",
    "scan_solaray_matcha_green_tea_stimulant",
  ]) {
    assert.ok(byId(id));
  }
});

test("search-origin consistency scenarios map back to barcode-origin products by barcode", () => {
  const barcodeScenarios = scenarios.filter((scenario) => scenario.surface === "barcode_scan");
  const barcodeScenariosByBarcode = new Map(
    barcodeScenarios
      .map((scenario) => [normalizeBarcode(scenario.product?.barcode ?? scenario.input?.barcode), scenario])
      .filter(([barcode]) => barcode),
  );
  const barcodeScenariosByProductId = new Map(
    barcodeScenarios
      .map((scenario) => [scenario.product?.productId, scenario])
      .filter(([productId]) => productId),
  );

  const searchOriginScenarios = scenarios.filter((scenario) => scenario.surface === "search_origin_result");
  assert.ok(searchOriginScenarios.length >= 3);

  for (const scenario of searchOriginScenarios) {
    const barcode = normalizeBarcode(scenario.product?.barcode ?? scenario.input?.searchResultSeed?.barcode);
    const barcodeScenario = barcode
      ? barcodeScenariosByBarcode.get(barcode)
      : barcodeScenariosByProductId.get(scenario.product?.productId);
    assert.ok(barcodeScenario, `missing barcode-origin pair for ${scenario.id}`);
    assert.equal(barcodeScenario.product.brand, scenario.product.brand, `${scenario.id} brand drift`);
  }
});
