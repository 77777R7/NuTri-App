import assert from "node:assert/strict";
import test from "node:test";
import {
  buildStratifiedNightlyPack,
  loadStratifiedNightlyConfig,
  loadStratifiedNightlySourcePack,
} from "../../scripts/maintainer/lib/stratified-nightly-pack.mjs";
import {
  loadGoldenJourneyPack,
  validateGoldenJourneyPack,
} from "../../scripts/maintainer/lib/cross-surface-quality-reporting.mjs";

const config = await loadStratifiedNightlyConfig("data/validation/stratified-nightly-pack.v1.json");
const pack = await loadStratifiedNightlySourcePack(config);

test("stratified nightly config points at the expanded v1 pack and nightly-only additions", async () => {
  assert.equal(config.version, "stratified-nightly-pack.v1");
  assert.equal(config.sourcePackPath, "data/validation/golden-journey-pack.v1.json");
  assert.deepEqual(config.additionalPackPaths, [
    "data/validation/stratified-nightly-additions.v1.json",
  ]);
  assert.deepEqual(config.pinnedScenarioIds, [
    "scan_nightly_betterbody_coconut_aminos_soy_replacement",
    "scan_nightly_bpn_go_gel_food_like",
    "scan_nightly_hydrationup_electrolyte_drink_mix",
    "scan_nightly_barleans_algal_oil_source",
  ]);
  assert.ok(config.targetSize >= 40);

  const nightlyOnlyPack = await loadGoldenJourneyPack(config.additionalPackPaths[0]);
  assert.deepEqual(validateGoldenJourneyPack(nightlyOnlyPack), []);
});

test("stratified nightly pack builder selects a subset that meets configured surface, category, and persona minimums", () => {
  const nightly = buildStratifiedNightlyPack({ pack, config });

  assert.ok(nightly.sourcePackVersion.includes("golden-journey-pack.v1"));
  assert.ok(nightly.sourcePackVersion.includes("stratified-nightly-additions.v1"));
  assert.equal(nightly.scenarios.length, config.targetSize);

  for (const [surface, minimum] of Object.entries(config.surfaceMinimums ?? {})) {
    assert.ok((nightly.summary.surfaces[surface] ?? 0) >= minimum, `surface minimum failed for ${surface}`);
  }
  for (const [category, minimum] of Object.entries(config.categoryMinimums ?? {})) {
    assert.ok((nightly.summary.categories[category] ?? 0) >= minimum, `category minimum failed for ${category}`);
  }
  for (const persona of config.requiredPersonas ?? []) {
    assert.ok(nightly.summary.personas.includes(persona), `missing persona ${persona}`);
  }

  for (const scenarioId of config.pinnedScenarioIds ?? []) {
    assert.ok(nightly.scenarios.some((scenario) => scenario.id === scenarioId), `missing pinned scenario ${scenarioId}`);
  }
});
