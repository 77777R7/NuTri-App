import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import {
  buildOverlayYieldPreflightReport,
  discoverOfficialWaveRunDirs,
  renderOverlayYieldPreflightMarkdown,
} from "../../scripts/maintainer/lib/overlay-yield-preflight.mjs";

const toolReady = {
  rapidapi: { keyPresent: true, keyEnvNamesPresent: ["IHERB_RAPIDAPI_KEY"] },
  scrapling: { importOk: true, version: "0.4.7", ready047: true },
  agentBrowser: { available: true, invocation: "npx --yes agent-browser", version: "0.26.0" },
};

test("overlay yield preflight admits historical positive yield and quarantines historical zero yield", () => {
  const report = buildOverlayYieldPreflightReport({
    toolReadiness: toolReady,
    samplePerBrand: 2,
    maxBrands: 10,
    outputRoot: "output/preflight-test",
    admission: {
      brandRuns: [
        {
          brandName: "Trace",
          admissionStatus: "admitted",
          summary: { improvedRows: 2, becameFullOverlayReady: 1 },
        },
        {
          brandName: "Pure Synergy",
          admissionStatus: "discovery_only",
          summary: { improvedRows: 0, becameFullOverlayReady: 0 },
        },
      ],
    },
    queueRows: [
      {
        lane: "lane_a_hard_facts",
        brandName: "Trace",
        productId: "72459",
        title: "Trace Minerals, Ionic Zinc Liquid",
        coreMissingFields: ["ingredient", "dosage"],
        recommendedRunner: "refresh-iherb-overlay-p0-by-official-fallback",
        recommendedConfigPath: "data/iherb_official_fallback_configs/trace.json",
      },
      {
        lane: "lane_b_soft_fields_supplement_like",
        brandName: "Pure Synergy",
        productId: "105654",
        title: "Pure Synergy, SuperPure Astaxanthin",
        coreMissingFields: ["suggested_use", "warnings"],
        recommendedRunner: "refresh-iherb-overlay-p0-by-official-fallback",
        recommendedConfigPath: "data/iherb_official_fallback_configs/pure-synergy.json",
      },
    ],
  });

  const trace = report.brands.find((brand) => brand.brandName === "Trace");
  const pureSynergy = report.brands.find((brand) => brand.brandName === "Pure Synergy");

  assert.equal(trace.admission.admissionStatus, "admitted");
  assert.equal(trace.admission.nextAction, "merge_validate");
  assert.equal(trace.historicalYield.improvedRows, 2);
  assert.equal(pureSynergy.admission.admissionStatus, "discovery_only");
  assert.equal(pureSynergy.admission.admissionReason, "historical_zero_yield");
  assert.match(renderOverlayYieldPreflightMarkdown(report), /Trace: status=admitted/);
});

test("overlay yield preflight separates rapidapi key blockers, route honesty, and scrapling setup", () => {
  const report = buildOverlayYieldPreflightReport({
    toolReadiness: {
      rapidapi: { keyPresent: false, keyEnvNamesPresent: [] },
      scrapling: { importOk: true, version: "0.2.99", ready047: false },
      agentBrowser: { available: true, version: "0.26.0" },
    },
    knownZeroYieldBrands: {
      brands: [
        {
          brandName: "Global Healing",
          reason: "prior zero-yield lane",
        },
      ],
    },
    samplePerBrand: 1,
    maxBrands: 10,
    queueRows: [
      {
        lane: "lane_a_hard_facts",
        brandName: "Natrol",
        productId: "1",
        title: "Natrol Vitamin D3",
        coreMissingFields: ["ingredient", "dosage"],
        recommendedRunner: "run-iherb-missing-brand-rapidapi-wave",
        rapidApiBrandSlug: "natrol",
      },
      {
        lane: "lane_b_soft_fields_supplement_like",
        brandName: "Global Healing",
        productId: "4",
        title: "Global Healing, Liquid Vitamin D3",
        coreMissingFields: ["suggested_use", "warnings"],
        recommendedRunner: "refresh-iherb-overlay-p0-by-official-fallback",
        recommendedConfigPath: "data/iherb_official_fallback_configs/global-healing.json",
      },
      {
        lane: "lane_b_soft_fields_supplement_like",
        brandName: "Source Naturals",
        productId: "2",
        title: "Source Naturals, Melatonin Sleep Formula",
        coreMissingFields: ["suggested_use", "warnings"],
        recommendedRunner: "refresh-iherb-overlay-p0-by-official-fallback",
        recommendedConfigPath: "data/iherb_official_fallback_configs/source-naturals.json",
      },
      {
        lane: "lane_c_food_like_route_honesty",
        brandName: "BetterBody Foods",
        productId: "3",
        title: "BetterBody Foods, Coconut Aminos Soy Sauce Replacement",
        coreMissingFields: ["warnings"],
        recommendedRunner: "route_honesty_audit_only",
      },
    ],
  });

  const natrol = report.brands.find((brand) => brand.brandName === "Natrol");
  const globalHealing = report.brands.find((brand) => brand.brandName === "Global Healing");
  const sourceNaturals = report.brands.find((brand) => brand.brandName === "Source Naturals");
  const betterBody = report.brands.find((brand) => brand.brandName === "BetterBody Foods");

  assert.equal(natrol.admission.admissionStatus, "blocked");
  assert.equal(natrol.admission.admissionReason, "rapidapi_key_missing");
  assert.equal(natrol.commands.rapidApiPrefetch.includes("run-iherb-missing-brand-rapidapi-wave"), true);
  assert.equal(globalHealing.admission.admissionStatus, "discovery_only");
  assert.equal(globalHealing.admission.admissionReason, "known_zero_yield_registry");
  assert.equal(globalHealing.knownZeroYield.reason, "prior zero-yield lane");
  assert.equal(sourceNaturals.admission.admissionStatus, "setup_required");
  assert.equal(sourceNaturals.admission.admissionReason, "scrapling_047_not_ready");
  assert.match(sourceNaturals.commands.officialScraplingPreflight, /--staging-json output\/overlay_yield_preflight\/staging_products\.json/);
  assert.ok(sourceNaturals.summary.sourceRiskTags.includes("sleep_melatonin"));
  assert.equal(betterBody.admission.admissionStatus, "discovery_only");
  assert.equal(betterBody.admission.nextAction, "route_honesty_nightly");
  assert.ok(betterBody.summary.sourceRiskTags.includes("food_like_boundary"));
});

test("discoverOfficialWaveRunDirs finds wave-scoped run directories", async () => {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "overlay-yield-preflight-"));
  const queueDir = path.join(tempDir, "queue");
  await fs.mkdir(path.join(queueDir, "official_waves", "runs", "wave_lane_b_official_top_01", "trace"), {
    recursive: true,
  });
  await fs.mkdir(path.join(queueDir, "official_waves_top34_yield_first", "runs", "wave_lane_b_official_top_03"), {
    recursive: true,
  });
  await fs.mkdir(path.join(queueDir, "overlay_yield_preflight_123", "runs", "nature-s-way-v3"), {
    recursive: true,
  });
  await fs.mkdir(path.join(queueDir, "not_official_waves", "runs", "ignored"), {
    recursive: true,
  });

  const runDirs = await discoverOfficialWaveRunDirs({ queueDir, rootDir: tempDir });

  assert.deepEqual(runDirs, [
    path.join("queue", "official_waves", "runs", "wave_lane_b_official_top_01"),
    path.join("queue", "official_waves_top34_yield_first", "runs", "wave_lane_b_official_top_03"),
    path.join("queue", "overlay_yield_preflight_123", "runs"),
  ]);
});
