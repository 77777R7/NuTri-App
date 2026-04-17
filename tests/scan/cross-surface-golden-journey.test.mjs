import assert from "node:assert/strict";
import test from "node:test";
import {
  containsUnsafeLanguage,
  evaluateCrossSurfaceConsistency,
  evaluatePersonaExpectations,
  loadGoldenJourneyPack,
  summarizeGoldenJourneyPack,
  validateGoldenJourneyPack,
} from "../../scripts/maintainer/lib/cross-surface-quality-reporting.mjs";

const pack = await loadGoldenJourneyPack();
const scenarios = pack.scenarios;

const byId = (id) => {
  const scenario = scenarios.find((item) => item.id === id);
  assert.ok(scenario, `missing scenario ${id}`);
  return scenario;
};

test("golden journey pack v0 has a valid schema", () => {
  assert.equal(pack.version, "golden-journey-pack.v0");
  assert.ok(Array.isArray(scenarios));
  assert.equal(scenarios.length, 32);

  const errors = validateGoldenJourneyPack(pack);
  assert.deepEqual(errors, []);
});

test("golden journey pack v0 covers core surfaces, categories, personas, and gates", () => {
  const summary = summarizeGoldenJourneyPack(pack);

  assert.equal(summary.total, 32);
  assert.ok(summary.surfaces.barcode_scan >= 15);
  assert.ok(summary.surfaces.search >= 6);
  assert.ok(summary.surfaces.search_origin_result >= 3);
  assert.ok(Object.keys(summary.categories).length >= 10);
  assert.ok(summary.personas.length >= 12);
  assert.ok(summary.personas.includes("shellfish_allergy"));
  assert.ok(summary.personas.includes("soy_allergy"));

  for (const gate of [
    "default_anchor",
    "search_relevance",
    "click_through_seed_consistency",
    "canonical_product_consistency",
    "allergy_sensitivity_relevance",
    "unsafe_language",
  ]) {
    assert.ok(summary.gates.includes(gate), `missing gate ${gate}`);
  }
});

test("golden journey pack v0 includes scan release core 5 barcodes", () => {
  const barcodes = new Set(
    scenarios
      .filter((scenario) => scenario.surface === "barcode_scan")
      .map((scenario) => scenario.input?.barcode)
      .filter(Boolean),
  );

  for (const barcode of [
    "00023249011835",
    "00023249090021",
    "00737870212539",
    "00023249012566",
    "00766298001890",
  ]) {
    assert.ok(barcodes.has(barcode), `missing core barcode ${barcode}`);
  }
});

test("golden journey pack v0 keeps the fixed default-anchor buckets represented", () => {
  for (const id of [
    "scan_zinc_elderberry_immune_combo",
    "scan_core_gi_phage_digestive_goal",
    "scan_5htp_melatonin_sleep",
    "scan_cla_carnitine_fitness",
    "scan_cal_mag_stack_duplicate",
    "scan_biogaia_protectis_zero_facts",
    "scan_codeage_aloe_no_anchor_steal",
    "scan_apple_fiber_digestion",
    "scan_whey_protein_dairy",
    "scan_natures_way_algal_oil_vegan",
    "scan_solaray_matcha_green_tea_stimulant",
    "search_alias_matcha_green_tea",
  ]) {
    assert.ok(byId(id));
  }
});

test("persona expectation evaluator passes positive warning examples and fails missed explicit risk", () => {
  const omega = byId("scan_core_sr_omega3_fish_allergy");
  const positive = evaluatePersonaExpectations(omega, {
    warnings: ["Contains fish source oil, which matches your fish allergy setting."],
  });
  assert.equal(positive[0].status, "pass");

  const missed = evaluatePersonaExpectations(omega, {
    warnings: ["Omega-3 source oil."],
  });
  assert.equal(missed[0].status, "fail");
  assert.deepEqual(missed[0].details.missing, ["fish"]);

  const algal = byId("scan_natures_way_algal_oil_vegan");
  const falsePositive = evaluatePersonaExpectations(algal, {
    warnings: ["Possible fish allergy conflict."],
  });
  assert.equal(falsePositive[0].status, "fail");
  assert.deepEqual(falsePositive[0].details.forbidden, ["fish allergy conflict"]);
});

test("search-origin result consistency evaluator catches seed drift", () => {
  const scenario = byId("search_origin_sr_omega3_consistency");
  const clean = evaluateCrossSurfaceConsistency(scenario, {
    selectedAnchor: "Fish Oil",
    scoreBand: "Strong",
  });
  assert.equal(clean.every((result) => result.status === "pass"), true);

  const drifted = evaluateCrossSurfaceConsistency(scenario, {
    product: {
      productId: "wrong-product",
      brand: "Sports Research",
      name: "Alaskan Omega-3 Fish Oil, 90 Softgels",
      barcode: "00023249011835",
    },
    selectedAnchor: "Calories",
    scoreBand: "Fair",
  });

  assert.ok(drifted.some((result) => result.gate === "click_through_seed_consistency" && result.status === "fail"));
  assert.ok(drifted.some((result) => result.gate === "canonical_product_consistency" && result.status === "fail"));
  assert.ok(drifted.some((result) => result.gate === "selected_anchor_consistency" && result.status === "fail"));
  assert.ok(drifted.some((result) => result.gate === "score_consistency" && result.status === "fail"));
});

test("unsafe language helper blocks high-risk user safety phrasing", () => {
  assert.equal(containsUnsafeLanguage(["This product is safe for you."]), true);
  assert.equal(containsUnsafeLanguage(["Safe in pregnancy based on this scan."]), true);
  assert.equal(containsUnsafeLanguage(["This label appears relevant to your sleep goal."]), false);
});
