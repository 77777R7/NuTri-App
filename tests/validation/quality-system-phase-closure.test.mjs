import assert from "node:assert/strict";
import test from "node:test";

import { loadGoldenJourneyPack } from "../../scripts/maintainer/lib/cross-surface-quality-reporting.mjs";
import {
  buildStratifiedNightlyPack,
  loadStratifiedNightlyConfig,
  loadStratifiedNightlySourcePack,
} from "../../scripts/maintainer/lib/stratified-nightly-pack.mjs";
import {
  buildCuratedValidationPack,
  deriveScenarioGovernance,
  loadCuratedValidationConfig,
  loadCuratedValidationSourcePack,
  loadStableGateBaseline,
  loadTaxonomyConfig,
  summarizeScenarioGovernance,
  validateCuratedValidationConfig,
  validateStableGateBaseline,
  validateTaxonomyConfig,
} from "../../scripts/maintainer/lib/validation-governance.mjs";

const sourcePack = await loadGoldenJourneyPack("data/validation/golden-journey-pack.v1.json");

const byId = (pack, id) => {
  const scenario = pack.scenarios.find((item) => item.id === id);
  assert.ok(scenario, `missing scenario ${id}`);
  return scenario;
};

test("stable gate baseline freezes source pack, stable curated packs, and expectation modes", async () => {
  const baseline = await loadStableGateBaseline("data/validation/stable-gate-baseline.v1.json");
  assert.deepEqual(validateStableGateBaseline(baseline), []);

  assert.equal(baseline.baselineId, "science-baseline-v1");
  assert.equal(baseline.sourcePackPath, "data/validation/golden-journey-pack.v1.json");
  assert.deepEqual(baseline.stablePackPaths, [
    "data/validation/live-replay-release-slice.v1.json",
    "data/validation/consistency-pack.v0.json",
    "data/validation/scan-smoke.v0.json",
    "data/validation/runtime-result-page-contract.v0.json",
    "data/validation/persona-blocker-pack.v0.json",
    "data/validation/food-like-route-honesty-stable.v0.json",
    "data/validation/mobile-scan-smoke-mini.v0.json",
  ]);

  assert.equal(baseline.expectationModesBySurface.barcode_scan.identityMode, "exact_product");
  assert.equal(baseline.expectationModesBySurface.barcode_scan.anchorMode, "exact_anchor");
  assert.equal(baseline.expectationModesBySurface.barcode_scan.scoreMode, "exact_score");
  assert.equal(
    baseline.expectationModesBySurface.search_origin_result.warningMode,
    "detail_superset_allowed",
  );
  assert.equal(
    baseline.closureEvidence.localLiveReplay.summary,
    "23/23 pass",
  );
});

test("taxonomy v0 covers all golden journey categories and provides persona maturity tiers", async () => {
  const taxonomy = await loadTaxonomyConfig("data/validation/taxonomy-v0.json");
  assert.deepEqual(validateTaxonomyConfig(taxonomy), []);

  const omegaScenario = byId(sourcePack, "scan_real_21stcentury_krill_oil_shellfish");
  const omegaGovernance = deriveScenarioGovernance(omegaScenario, taxonomy);
  assert.equal(omegaGovernance.familyId, "omega_source_oils");
  assert.equal(omegaGovernance.primaryPersonaMaturity, "blocker");
  assert.ok(omegaGovernance.overlayTags.includes("source_sensitive"));

  const microbiomeScenario = byId(sourcePack, "scan_core_gi_phage_digestive_goal");
  const microbiomeGovernance = deriveScenarioGovernance(microbiomeScenario, taxonomy);
  assert.equal(microbiomeGovernance.familyId, "microbiome");
  assert.equal(microbiomeGovernance.primaryPersonaMaturity, "nightly");

  const lifecycleScenario = byId(sourcePack, "scan_prenatal_multivitamin_counterfactual_b");
  const lifecycleGovernance = deriveScenarioGovernance(lifecycleScenario, taxonomy);
  assert.equal(lifecycleGovernance.familyId, "lifecycle_specific");
  assert.equal(lifecycleGovernance.primaryPersonaMaturity, "nightly");
  assert.ok(lifecycleGovernance.overlayTags.includes("lifecycle"));

  const summary = summarizeScenarioGovernance(sourcePack.scenarios, taxonomy);
  assert.equal(summary.total, 119);
  assert.equal(summary.familyCounts.omega_source_oils, 15);
  assert.equal(summary.familyCounts.microbiome, 15);
  assert.ok(summary.maturityCounts.blocker > 0);
  assert.ok(summary.maturityCounts.nightly > 0);
});

test("live replay release slice freezes the current 23-scenario passing local slice", async () => {
  const config = await loadCuratedValidationConfig("data/validation/live-replay-release-slice.v1.json");
  assert.deepEqual(validateCuratedValidationConfig(config), []);

  const mergedPack = await loadCuratedValidationSourcePack(config);
  const slice = buildCuratedValidationPack({ pack: mergedPack, config });
  assert.equal(slice.summary.total, 23);
  assert.equal(slice.metadata.releaseBlocker, true);
  assert.equal(slice.metadata.runner, "local_live_replay");
  assert.ok(slice.scenarios.some((scenario) => scenario.id === "scan_core_nac_sparse_result"));
  assert.ok(slice.scenarios.some((scenario) => scenario.id === "search_origin_sr_omega3_consistency"));
  assert.ok(slice.scenarios.some((scenario) => scenario.id === "search_real_alani_whey_fruity_cereal"));
});

test("consistency pack v0 selects the current cross-surface blocker slice from supported scenarios", async () => {
  const config = await loadCuratedValidationConfig("data/validation/consistency-pack.v0.json");
  assert.deepEqual(validateCuratedValidationConfig(config), []);

  const consistencyPack = buildCuratedValidationPack({ pack: sourcePack, config });
  assert.equal(consistencyPack.metadata.releaseBlocker, true);
  assert.equal(consistencyPack.summary.total, 24);
  assert.ok((consistencyPack.summary.surfaces.barcode_scan ?? 0) >= 8);
  assert.ok((consistencyPack.summary.surfaces.search_origin_result ?? 0) >= 16);
  assert.ok((consistencyPack.summary.categories.omega3_source_oil ?? 0) >= 6);

  for (const scenario of consistencyPack.scenarios) {
    assert.ok(
      (scenario.gates ?? []).some((gate) => [
        "click_through_seed_consistency",
        "canonical_product_consistency",
        "selected_anchor_consistency",
        "score_consistency",
        "warning_consistency",
      ].includes(gate)),
      `scenario ${scenario.id} should carry a consistency gate`,
    );
  }
});

test("scan smoke v0 pins a barcode-only release blocker slice with runtime profiles", async () => {
  const config = await loadCuratedValidationConfig("data/validation/scan-smoke.v0.json");
  assert.deepEqual(validateCuratedValidationConfig(config), []);

  const mergedPack = await loadCuratedValidationSourcePack(config);
  const smokePack = buildCuratedValidationPack({ pack: mergedPack, config });
  assert.equal(smokePack.metadata.releaseBlocker, true);
  assert.equal(smokePack.summary.total, 21);
  assert.deepEqual(
    Object.keys(smokePack.summary.surfaces),
    ["barcode_scan"],
  );
  assert.equal(config.runtimeProfiles.length, 3);
  assert.ok(smokePack.scenarios.some((scenario) => scenario.id === "scan_nightly_bpn_go_gel_food_like"));
  assert.ok(smokePack.scenarios.some((scenario) => scenario.id === "scan_nightly_simply_protein_bar_food_like"));
  assert.ok(smokePack.scenarios.some((scenario) => scenario.id === "scan_core_sr_omega3_fish_allergy"));
  assert.ok(smokePack.scenarios.some((scenario) => scenario.id === "scan_real_alani_whey_protein_dairy"));
  assert.ok((smokePack.summary.categories.food_like ?? 0) >= 4);
  assert.ok((smokePack.summary.categories.omega3_source_oil ?? 0) >= 3);
  assert.ok((smokePack.summary.categories.sparse_title_led ?? 0) >= 2);
});

test("mobile scan smoke mini is frozen as release evidence for device-adjacent scan stability", async () => {
  const { loadMobileScanSmokeConfig, validateMobileScanSmokeConfig } = await import(
    "../../scripts/maintainer/lib/mobile-scan-smoke-mini.mjs"
  );
  const config = await loadMobileScanSmokeConfig("data/validation/mobile-scan-smoke-mini.v0.json");
  assert.deepEqual(validateMobileScanSmokeConfig(config), []);
  assert.equal(config.releaseBlocker, true);
  assert.equal(config.devicePreflight?.enabled, true);
  assert.match(String(config.devicePreflight?.appUrl ?? ""), /^nutri:\/\//);
});

test("runtime result-page contract pack covers live-capable runtime routes and search-origin detail checks", async () => {
  const config = await loadCuratedValidationConfig("data/validation/runtime-result-page-contract.v0.json");
  assert.deepEqual(validateCuratedValidationConfig(config), []);

  const mergedPack = await loadCuratedValidationSourcePack(config);
  const runtimePack = buildCuratedValidationPack({ pack: mergedPack, config });
  assert.equal(runtimePack.metadata.releaseBlocker, true);
  assert.equal(runtimePack.metadata.runner, "runtime_contract_runner");
  assert.equal(runtimePack.summary.total, 22);
  assert.ok((runtimePack.summary.surfaces.barcode_scan ?? 0) >= 18);
  assert.ok((runtimePack.summary.surfaces.search_origin_result ?? 0) >= 3);
  assert.ok((runtimePack.summary.categories.food_like ?? 0) >= 4);
  assert.ok(runtimePack.scenarios.some((scenario) => scenario.id === "scan_nightly_barleans_algal_oil_source"));
  assert.ok(runtimePack.scenarios.some((scenario) => scenario.id === "scan_nightly_simply_protein_bar_food_like"));
  assert.ok(runtimePack.scenarios.some((scenario) => scenario.id === "search_origin_real_alani_whey_dairy_consistency"));
});

test("persona blocker pack freezes deterministic source, duplicate-stack, and lifecycle blocker slices", async () => {
  const config = await loadCuratedValidationConfig("data/validation/persona-blocker-pack.v0.json");
  assert.deepEqual(validateCuratedValidationConfig(config), []);

  const mergedPack = await loadCuratedValidationSourcePack(config);
  const blockerPack = buildCuratedValidationPack({ pack: mergedPack, config });
  assert.equal(blockerPack.metadata.releaseBlocker, true);
  assert.equal(blockerPack.summary.total, 17);
  assert.ok(blockerPack.summary.personas.includes("fish_allergy"));
  assert.ok(blockerPack.summary.personas.includes("shellfish_allergy"));
  assert.ok(blockerPack.summary.personas.includes("dairy_allergy"));
  assert.ok(blockerPack.summary.personas.includes("soy_allergy"));
  assert.ok(blockerPack.summary.personas.includes("pregnancy_prenatal"));
  assert.ok(blockerPack.summary.personas.includes("duplicate_zinc_magnesium_d"));
  assert.ok(blockerPack.scenarios.some((scenario) => scenario.id === "scan_nightly_nutricost_grassfed_whey_dairy"));
  assert.ok(blockerPack.scenarios.some((scenario) => scenario.id === "scan_nightly_now_soy_protein_isolate_source"));
  assert.ok(blockerPack.scenarios.some((scenario) => scenario.id === "scan_nightly_swanson_krill_curcumin_shellfish"));
});

test("food-like route honesty stable pack promotes only user-surface-impacting discovery seeds", async () => {
  const config = await loadCuratedValidationConfig("data/validation/food-like-route-honesty-stable.v0.json");
  assert.deepEqual(validateCuratedValidationConfig(config), []);

  const mergedPack = await loadCuratedValidationSourcePack(config);
  const routeHonestyPack = buildCuratedValidationPack({ pack: mergedPack, config });
  assert.equal(routeHonestyPack.metadata.releaseBlocker, true);
  assert.equal(routeHonestyPack.metadata.runner, "runtime_contract_runner");
  assert.equal(routeHonestyPack.summary.total, 60);
  assert.equal(routeHonestyPack.summary.surfaces.barcode_scan, 30);
  assert.equal(routeHonestyPack.summary.surfaces.search_origin_result, 30);
  assert.equal(routeHonestyPack.summary.categories.food_like, 60);

  for (const id of [
    "scan_food_like_bulletproof_mct_oil_route_honesty",
    "search_origin_food_like_bulletproof_mct_oil_route_honesty",
    "scan_food_like_gfuel_hydration_focus_route_honesty",
    "search_origin_food_like_gfuel_hydration_focus_route_honesty",
    "scan_food_like_powerup_mega_omega_route_honesty",
    "search_origin_food_like_powerup_mega_omega_route_honesty",
    "scan_food_like_mt_capra_clean_whey_route_honesty",
    "search_origin_food_like_mt_capra_clean_whey_route_honesty",
    "scan_food_like_aps_whey_isolate_route_honesty",
    "search_origin_food_like_aps_whey_isolate_route_honesty",
    "scan_food_like_bonk_breaker_energy_chews_route_honesty",
    "search_origin_food_like_bonk_breaker_energy_chews_route_honesty",
    "scan_food_like_aurora_glutathione_drink_mix_route_honesty",
    "search_origin_food_like_aurora_glutathione_drink_mix_route_honesty",
    "scan_food_like_eden_tamari_soy_sauce_route_honesty",
    "search_origin_food_like_eden_tamari_soy_sauce_route_honesty",
    "scan_food_like_chamberlain_matcha_latte_route_honesty",
    "search_origin_food_like_chamberlain_matcha_latte_route_honesty",
    "scan_food_like_crispy_green_apple_route_honesty",
    "search_origin_food_like_crispy_green_apple_route_honesty",
    "scan_food_like_alter_eco_truffles_route_honesty",
    "search_origin_food_like_alter_eco_truffles_route_honesty",
    "scan_food_like_laird_hydrate_electrolyte_drink_mix_route_honesty",
    "search_origin_food_like_laird_hydrate_electrolyte_drink_mix_route_honesty",
    "scan_food_like_now_soy_milk_powder_route_honesty",
    "search_origin_food_like_now_soy_milk_powder_route_honesty",
    "scan_food_like_binggrae_banana_milk_drink_route_honesty",
    "search_origin_food_like_binggrae_banana_milk_drink_route_honesty",
    "scan_food_like_bhu_protein_bites_route_honesty",
    "search_origin_food_like_bhu_protein_bites_route_honesty",
    "scan_food_like_hu_simple_milk_chocolate_route_honesty",
    "search_origin_food_like_hu_simple_milk_chocolate_route_honesty",
    "scan_food_like_tcho_choco_latte_route_honesty",
    "search_origin_food_like_tcho_choco_latte_route_honesty",
    "scan_food_like_bragg_liquid_aminos_soy_protein_seasoning_route_honesty",
    "search_origin_food_like_bragg_liquid_aminos_soy_protein_seasoning_route_honesty",
    "scan_food_like_ener_c_bubbly_multivitamin_drink_mix_route_honesty",
    "search_origin_food_like_ener_c_bubbly_multivitamin_drink_mix_route_honesty",
    "scan_food_like_pure_indian_foods_mct_oil_route_honesty",
    "search_origin_food_like_pure_indian_foods_mct_oil_route_honesty",
    "scan_food_like_catalina_crunch_protein_snack_mix_route_honesty",
    "search_origin_food_like_catalina_crunch_protein_snack_mix_route_honesty",
    "scan_food_like_eas_platinum_whey_route_honesty",
    "search_origin_food_like_eas_platinum_whey_route_honesty",
    "scan_food_like_muscletech_nitro_tech_whey_route_honesty",
    "search_origin_food_like_muscletech_nitro_tech_whey_route_honesty",
    "scan_food_like_betterbody_coconut_aminos_route_honesty",
    "search_origin_food_like_betterbody_coconut_aminos_route_honesty",
    "scan_food_like_celestial_sleepytime_melatonin_tea_route_honesty",
    "search_origin_food_like_celestial_sleepytime_melatonin_tea_route_honesty",
    "scan_food_like_lake_avenue_energy_drink_mix_route_honesty",
    "search_origin_food_like_lake_avenue_energy_drink_mix_route_honesty",
    "scan_food_like_amazing_grass_kidz_superfood_route_honesty",
    "search_origin_food_like_amazing_grass_kidz_superfood_route_honesty",
    "scan_food_like_nutrabio_classic_whey_protein_route_honesty",
    "search_origin_food_like_nutrabio_classic_whey_protein_route_honesty",
    "scan_food_like_coconut_secret_coconut_aminos_route_honesty",
    "search_origin_food_like_coconut_secret_coconut_aminos_route_honesty",
    "scan_food_like_celestial_authentic_green_tea_route_honesty",
    "search_origin_food_like_celestial_authentic_green_tea_route_honesty",
  ]) {
    assert.ok(routeHonestyPack.scenarios.some((scenario) => scenario.id === id), `missing ${id}`);
  }

  for (const scenario of routeHonestyPack.scenarios.filter((item) => item.surface === "barcode_scan")) {
    assert.ok(scenario.gates.includes("selected_anchor_consistency"), `${scenario.id} should pin selected anchor`);
  }
});

test("persona nightly pack keeps partially wired goal and persona nuance out of blocker scope", async () => {
  const config = await loadCuratedValidationConfig("data/validation/persona-nightly-pack.v0.json");
  assert.deepEqual(validateCuratedValidationConfig(config), []);

  const nightlyPersonaPack = buildCuratedValidationPack({ pack: sourcePack, config });
  assert.equal(nightlyPersonaPack.metadata.releaseBlocker, false);
  assert.equal(nightlyPersonaPack.summary.total, 14);
  assert.ok(nightlyPersonaPack.summary.personas.includes("digestion_goal"));
  assert.ok(nightlyPersonaPack.summary.personas.includes("sleep_goal"));
  assert.ok(nightlyPersonaPack.summary.personas.includes("stimulant_sensitivity"));
  assert.ok(nightlyPersonaPack.summary.personas.includes("pregnancy_prenatal"));
});

test("stratified nightly v2 becomes discovery-first and reserves a hidden holdout", async () => {
  const config = await loadStratifiedNightlyConfig("data/validation/stratified-nightly-pack.v2.json");
  const pack = await loadStratifiedNightlySourcePack(config);
  const nightly = buildStratifiedNightlyPack({ pack, config });

  assert.equal(config.discoveryOnly, true);
  assert.equal(config.releaseBlocker, false);
  assert.ok(config.hiddenHoldoutFraction > 0);
  assert.equal(nightly.scenarios.length, config.targetSize);
  assert.ok(Array.isArray(nightly.hiddenHoldout));
  assert.ok(nightly.hiddenHoldout.length > 0);
  assert.ok((nightly.hiddenHoldoutSummary?.total ?? 0) > 0);
  assert.ok(nightly.summary.personas.includes("shellfish_allergy"));
  assert.ok(nightly.summary.personas.includes("pregnancy_prenatal"));
});
