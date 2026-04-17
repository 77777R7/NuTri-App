import assert from "node:assert/strict";
import test from "node:test";
import {
  loadGoldenJourneyPack,
  summarizeGoldenJourneyPack,
  validateGoldenJourneyPack,
} from "../../scripts/maintainer/lib/cross-surface-quality-reporting.mjs";

const pack = await loadGoldenJourneyPack("data/validation/golden-journey-pack.v1.json");
const scenarios = pack.scenarios;

const byId = (id) => {
  const scenario = scenarios.find((item) => item.id === id);
  assert.ok(scenario, `missing scenario ${id}`);
  return scenario;
};

test("golden journey pack v1 expands the curated matrix into the 80-120 band", () => {
  assert.ok(scenarios.length >= 80);
  assert.ok(scenarios.length <= 120);

  const errors = validateGoldenJourneyPack(pack);
  assert.deepEqual(errors, []);
});

test("golden journey pack v1 increases search-origin persona coverage and negative counterfactual lanes", () => {
  const summary = summarizeGoldenJourneyPack(pack);

  assert.ok(summary.surfaces.barcode_scan >= 55);
  assert.ok(summary.surfaces.search >= 10);
  assert.ok(summary.surfaces.search_origin_result >= 16);
  assert.ok(summary.categories.food_like >= 15);
  assert.ok(summary.categories.sparse_title_led >= 13);
  assert.ok(summary.categories.probiotic_microbiome >= 8);
  assert.ok(summary.categories.omega3_source_oil >= 8);
  assert.ok(summary.categories.sleep_amino >= 6);
  assert.ok(summary.categories.mineral_stack >= 6);

  for (const persona of [
    "shellfish_allergy",
    "soy_allergy",
    "fish_allergy",
    "vegan_preference",
    "melatonin_sensitivity",
    "duplicate_zinc_magnesium_d",
  ]) {
    assert.ok(summary.personas.includes(persona), `missing persona ${persona}`);
  }
});

test("golden journey pack v1 includes the priority taxonomy expansion scenarios", () => {
  for (const id of [
    "search_real_21stcentury_krill_oil",
    "search_real_alani_whey_fruity_cereal",
    "search_real_21stcentury_600_d3",
    "scan_real_21stcentury_600_d3_short_panel",
    "scan_real_21stcentury_acidophilus_short_panel",
    "scan_real_lifeextension_green_tea_short_panel",
    "scan_real_bio_nutrition_krill_oil_complex_short_panel",
    "scan_real_lifeextension_soy_isoflavones_short_panel",
    "scan_real_21stcentury_b12_prolonged_release_sparse",
    "scan_real_21stcentury_ashwagandha_sparse",
    "scan_real_biogaia_osfortis_vitamin_d_sparse",
    "scan_real_doctorsbest_vegan_dha_algae_sparse",
    "scan_real_annies_snack_mix_food_like",
    "search_origin_real_21stcentury_krill_oil_consistency",
    "search_origin_real_alani_whey_dairy_consistency",
    "search_origin_real_21stcentury_soy_isoflavones_consistency",
    "search_origin_real_21stcentury_600_d3_consistency",
    "scan_real_alani_protein_bar_food_like",
    "scan_real_akasha_sea_moss_gel_food_like",
    "scan_real_alani_energy_drink_mix_food_like",
    "scan_real_alani_whey_protein_dairy",
    "scan_real_21stcentury_soy_isoflavones",
    "scan_real_21stcentury_krill_oil_shellfish",
    "search_origin_krill_shellfish_consistency",
    "search_origin_soy_protein_consistency",
    "scan_food_like_collagen_bar_negative",
    "scan_sparse_multimineral_malformed_panel",
    "scan_probiotic_vitamin_d_counterfactual",
    "scan_omega3_fish_vs_algal_counterfactual",
    "scan_sleep_theanine_vs_melatonin_counterfactual",
    "scan_duplicate_zinc_stack_counterfactual",
  ]) {
    assert.ok(byId(id));
  }
});
