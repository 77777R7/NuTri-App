import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import {
  buildOfficialWavePlan,
  packBrandRollupIntoWaves,
  rankBrandsByRowCount,
  readOfficialWaveYieldAdmission,
  writeOfficialWaveOutputs,
} from "../../scripts/maintainer/lib/full-db-api-fill-official-waves.mjs";
import { ROOT_DIR } from "../../scripts/maintainer/lib/science-validation-reporting.mjs";

test("packBrandRollupIntoWaves keeps brands intact while respecting max wave rows", () => {
  const rankedBrands = [
    { brandName: "A", count: 82, rows: [] },
    { brandName: "B", count: 47, rows: [] },
    { brandName: "C", count: 43, rows: [] },
    { brandName: "D", count: 36, rows: [] },
    { brandName: "E", count: 31, rows: [] },
  ];

  const waves = packBrandRollupIntoWaves({ rankedBrands, maxWaveRows: 140 });

  assert.deepEqual(
    waves.map((wave) => ({
      totalRows: wave.totalRows,
      brands: wave.brands.map((brand) => brand.brandName),
    })),
    [
      { totalRows: 129, brands: ["A", "B"] },
      { totalRows: 110, brands: ["C", "D", "E"] },
    ],
  );
});

test("buildOfficialWavePlan splits lane_a into its own wave and lane_b by top brand ranking", () => {
  const queueRows = [
    {
      lane: "lane_a_hard_facts",
      brandName: "Eclectic Herb",
      productId: "1",
      recommendedRunner: "refresh-iherb-overlay-p0-by-official-fallback",
      recommendedConfigPath: "data/iherb_official_fallback_configs/eclectic-herb.json",
    },
    {
      lane: "lane_a_hard_facts",
      brandName: "Swanson",
      productId: "2",
      recommendedRunner: "refresh-iherb-overlay-p0-by-official-fallback",
      recommendedConfigPath: "data/iherb_official_fallback_configs/swanson.json",
    },
    {
      lane: "lane_b_soft_fields_supplement_like",
      brandName: "NOW Foods",
      productId: "3",
      recommendedRunner: "refresh-iherb-overlay-p0-by-official-fallback",
      recommendedConfigPath: "data/iherb_official_fallback_configs/now-foods.json",
    },
    {
      lane: "lane_b_soft_fields_supplement_like",
      brandName: "NOW Foods",
      productId: "4",
      recommendedRunner: "refresh-iherb-overlay-p0-by-official-fallback",
      recommendedConfigPath: "data/iherb_official_fallback_configs/now-foods.json",
    },
    {
      lane: "lane_b_soft_fields_supplement_like",
      brandName: "NutriBiotic",
      productId: "5",
      recommendedRunner: "refresh-iherb-overlay-p0-by-official-fallback",
      recommendedConfigPath: "data/iherb_official_fallback_configs/nutribiotic.json",
    },
    {
      lane: "lane_b_soft_fields_supplement_like",
      brandName: "Frontier Co-op",
      productId: "6",
      recommendedRunner: "refresh-iherb-overlay-p0-by-official-fallback",
      recommendedConfigPath: "data/iherb_official_fallback_configs/frontier-coop.json",
    },
    {
      lane: "lane_b_soft_fields_supplement_like",
      brandName: "Trace",
      productId: "7",
      recommendedRunner: "refresh-iherb-overlay-p0-by-official-fallback",
      recommendedConfigPath: "data/iherb_official_fallback_configs/trace.json",
    },
    {
      lane: "lane_b_soft_fields_supplement_like",
      brandName: "Ignored",
      productId: "8",
      recommendedRunner: "needs_brand_support_onboarding",
      recommendedConfigPath: null,
    },
  ];

  const plan = buildOfficialWavePlan({
    queueRows,
    topBrandCount: 3,
    maxWaveRows: 3,
  });

  assert.equal(plan.summary.officialReadyRows, 7);
  assert.equal(plan.summary.laneAHardFactsOfficialReadyRows, 2);
  assert.equal(plan.summary.laneBSoftFieldOfficialReadyRows, 5);
  assert.equal(plan.summary.selectedLaneBTopBrands, 3);
  assert.equal(plan.waves[0].waveType, "lane_a_hard_facts_official_ready");
  assert.deepEqual(plan.waves[0].brands.map((brand) => brand.brandName), ["Eclectic Herb", "Swanson"]);
  assert.deepEqual(
    plan.waves.slice(1).map((wave) => wave.brands.map((brand) => brand.brandName)),
    [["NOW Foods", "Frontier Co-op"], ["NutriBiotic"]],
  );
});

test("rankBrandsByRowCount sorts descending with stable alpha tie-break", () => {
  const ranked = rankBrandsByRowCount([
    { brandName: "B", productId: "1" },
    { brandName: "A", productId: "2" },
    { brandName: "B", productId: "3" },
    { brandName: "A", productId: "4" },
    { brandName: "C", productId: "5" },
  ]);

  assert.deepEqual(
    ranked.map((brand) => [brand.brandName, brand.count]),
    [
      ["A", 2],
      ["B", 2],
      ["C", 1],
    ],
  );
});

test("writeOfficialWaveOutputs writes wave-scoped queue files instead of shared brand queues", async () => {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "official-waves-"));
  const outDir = path.join(tempDir, "official_waves");
  const relativeOutDir = path.relative(ROOT_DIR, outDir);

  const plan = buildOfficialWavePlan({
    queueRows: [
      {
        lane: "lane_a_hard_facts",
        brandName: "Trace",
        productId: "72459",
        recommendedRunner: "refresh-iherb-overlay-p0-by-official-fallback",
        recommendedConfigPath: "data/iherb_official_fallback_configs/trace.json",
      },
      {
        lane: "lane_b_soft_fields_supplement_like",
        brandName: "Trace",
        productId: "99999",
        recommendedRunner: "refresh-iherb-overlay-p0-by-official-fallback",
        recommendedConfigPath: "data/iherb_official_fallback_configs/trace.json",
      },
    ],
    topBrandCount: 1,
    maxWaveRows: 100,
  });

  await writeOfficialWaveOutputs({ plan, outDir });

  const laneAQueuePath = path.join(outDir, "waves", "wave_lane_a_hard_facts_01", "trace.queue.json");
  const laneBQueuePath = path.join(outDir, "waves", "wave_lane_b_official_top_01", "trace.queue.json");
  const laneAManifestPath = path.join(outDir, "waves", "wave_lane_a_hard_facts_01", "wave.manifest.json");

  assert.deepEqual(JSON.parse(await fs.readFile(laneAQueuePath, "utf8")).map((row) => row.productId), ["72459"]);
  assert.deepEqual(JSON.parse(await fs.readFile(laneBQueuePath, "utf8")).map((row) => row.productId), ["99999"]);
  assert.equal(
    JSON.parse(await fs.readFile(laneAManifestPath, "utf8")).brands[0].queuePath,
    path.join(relativeOutDir, "waves", "wave_lane_a_hard_facts_01", "trace.queue.json"),
  );
});

test("rendered wave commands include wave-scoped queue and staging inputs", async () => {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "official-waves-md-"));
  const outDir = path.join(tempDir, "official_waves");
  const relativeOutDir = path.relative(ROOT_DIR, outDir);

  const plan = buildOfficialWavePlan({
    queueRows: [
      {
        lane: "lane_b_soft_fields_supplement_like",
        brandName: "Trace",
        productId: "72459",
        recommendedRunner: "refresh-iherb-overlay-p0-by-official-fallback",
        recommendedConfigPath: "data/iherb_official_fallback_configs/trace.json",
      },
    ],
    topBrandCount: 1,
    maxWaveRows: 100,
  });

  await writeOfficialWaveOutputs({ plan, outDir });

  const markdown = await fs.readFile(path.join(outDir, "official_waves.plan.md"), "utf8");
  assert.match(
    markdown,
    new RegExp(
      `--queue-json ${path.join(relativeOutDir, "waves", "wave_lane_b_official_top_01", "trace.queue.json").replace(/[.*+?^${}()|[\\]\\\\]/g, "\\\\$&")}`,
    ),
  );
  assert.match(
    markdown,
    new RegExp(
      `--staging-json ${path.join(relativeOutDir, "waves", "wave_lane_b_official_top_01", "staging_products.json").replace(/[.*+?^${}()|[\\]\\\\]/g, "\\\\$&")}`,
    ),
  );
});

test("readOfficialWaveYieldAdmission admits only positive-yield brand runs", async () => {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "official-wave-yield-"));
  const runDir = path.join(tempDir, "runs", "wave_lane_b_official_top_02");
  const traceDir = path.join(runDir, "trace");
  const zeroYieldDir = path.join(runDir, "pure-synergy");
  await fs.mkdir(traceDir, { recursive: true });
  await fs.mkdir(zeroYieldDir, { recursive: true });

  await fs.writeFile(
    path.join(traceDir, "official_fallback_report.json"),
    JSON.stringify({
      summary: {
        queued: 31,
        processed: 31,
        improvedRows: 3,
        becameFullOverlayReady: 3,
        filledSuggestedUse: 1,
        filledWarnings: 3,
      },
      rows: [{ productId: "72459", brandName: "Trace", improved: true }],
    }),
  );
  await fs.writeFile(
    path.join(traceDir, "staging_products.official_refreshed.json"),
    JSON.stringify({
      products: [{ productId: "72459", brandName: "Trace" }],
    }),
  );

  await fs.writeFile(
    path.join(zeroYieldDir, "official_fallback_report.json"),
    JSON.stringify({
      summary: {
        queued: 22,
        processed: 22,
        improvedRows: 0,
        becameFullOverlayReady: 0,
      },
      rows: [{ productId: "105654", brandName: "Pure Synergy", improved: false }],
    }),
  );

  const admission = await readOfficialWaveYieldAdmission({
    runDirs: [path.relative(ROOT_DIR, runDir)],
    rootDir: ROOT_DIR,
  });

  assert.equal(admission.summary.brandRuns, 2);
  assert.equal(admission.summary.admittedBrandRuns, 1);
  assert.equal(admission.summary.discoveryOnlyBrandRuns, 1);
  assert.equal(admission.summary.improvedRows, 3);
  assert.deepEqual(
    admission.admittedBrandRuns.map((row) => ({
      brandName: row.brandName,
      admissionStatus: row.admissionStatus,
      improvedRows: row.summary.improvedRows,
    })),
    [{ brandName: "Trace", admissionStatus: "admitted", improvedRows: 3 }],
  );
  assert.deepEqual(
    admission.discoveryOnlyBrandRuns.map((row) => ({
      brandName: row.brandName,
      admissionReason: row.admissionReason,
      improvedRows: row.summary.improvedRows,
    })),
    [{ brandName: "Pure Synergy", admissionReason: "zero_yield", improvedRows: 0 }],
  );
});
