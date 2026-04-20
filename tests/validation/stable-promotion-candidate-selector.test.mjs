import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import {
  buildRuntimeCanaryPack,
  classifyStablePromotionCandidates,
  collectPromotionCandidateScenarios,
  renderStablePromotionCandidateMarkdown,
  writeRuntimeCanaryPackOutputs,
  writeStablePromotionCandidateOutputs,
} from "../../scripts/maintainer/lib/stable-promotion-candidate-selector.mjs";

const candidate = (overrides = {}) => ({
  id: overrides.id ?? `food_like_route_${overrides.productId ?? "fixture"}`,
  productId: overrides.productId ?? "fixture",
  barcode: overrides.barcode ?? "00012345678905",
  brandName: overrides.brandName ?? "Fixture Brand",
  title: overrides.title ?? "Fixture Brand, Useful Boundary Product, 30 servings",
  bucket: overrides.bucket ?? "sports_hydration_boundary",
  riskTags: overrides.riskTags ?? [
    "food_like_route_honesty",
    "barcode_exact",
    "supplement_signal_overlap",
    "search_detail_route_risk",
  ],
});

const stableScenario = (overrides = {}) => ({
  id: overrides.id ?? `stable_${overrides.productId ?? "stable"}`,
  category: "food_like",
  surface: "barcode_scan",
  product: {
    productId: overrides.productId ?? "stable",
    barcode: overrides.barcode ?? "00099999999905",
    brand: overrides.brandName ?? "Stable Brand",
    name: overrides.title ?? "Stable Brand, Stable Product, 30 servings",
  },
  expected: {
    consistency: {
      productId: overrides.productId ?? "stable",
      barcode: overrides.barcode ?? "00099999999905",
    },
  },
});

test("selector promotes only diverse user-surface candidates and classifies duplicates, residual, and data fixes", () => {
  const stableScenarios = [
    stableScenario({
      productId: "140892",
      barcode: "00850017468160",
      brandName: "Catalina Crunch",
      title: "Catalina Crunch, Protein Snack Mix, Cheddar, 5.25 oz (148 g)",
    }),
  ];
  const candidates = [
    candidate({
      id: "exact_duplicate",
      productId: "140892",
      barcode: "00850017468160",
      brandName: "Catalina Crunch",
      title: "Catalina Crunch, Protein Snack Mix, Cheddar, 5.25 oz (148 g)",
      bucket: "snack_bar_boundary",
    }),
    candidate({
      id: "line_duplicate",
      productId: "140894",
      barcode: "00850017468146",
      brandName: "Catalina Crunch",
      title: "Catalina Crunch, Protein Snack Mix, Creamy Ranch, 5.25 oz (148 g)",
      bucket: "snack_bar_boundary",
    }),
    candidate({
      id: "needs_data",
      productId: "missing_barcode",
      barcode: "",
      brandName: "Missing Barcode",
      title: "Missing Barcode, Energy Drink Mix",
    }),
    candidate({
      id: "residual_grocery",
      productId: "pasta",
      brandName: "Plain Foods",
      title: "Plain Foods, Organic Pasta, 16 oz",
      bucket: "pure_grocery_boundary",
      riskTags: ["food_like_route_honesty", "barcode_exact"],
    }),
    candidate({
      id: "promote_condiment",
      productId: "114934",
      brandName: "BetterBody Foods",
      title: "BetterBody Foods, Organic Coconut Aminos, Soy Sauce Replacement, 16.9 fl oz (500 ml)",
      bucket: "condiment_sweetener_boundary",
      riskTags: [
        "food_like_route_honesty",
        "barcode_exact",
        "source_sensitive",
        "search_detail_route_risk",
        "food_context_honesty",
      ],
    }),
    candidate({
      id: "promote_sleep_tea",
      productId: "134837",
      brandName: "Celestial Seasonings",
      title: "Celestial Seasonings, Wellness Tea, Sleepytime Melatonin, Caffeine Free",
      bucket: "tea_beverage_boundary",
      riskTags: [
        "food_like_route_honesty",
        "barcode_exact",
        "supplement_signal_overlap",
        "search_detail_route_risk",
        "beverage_context_honesty",
      ],
    }),
    candidate({
      id: "promote_stimulant",
      productId: "108263",
      brandName: "Lake Avenue Nutrition",
      title: "Lake Avenue Nutrition, Energy Powder Drink Mix with Caffeine and Vitamin C",
      bucket: "sports_hydration_boundary",
      riskTags: [
        "food_like_route_honesty",
        "barcode_exact",
        "supplement_signal_overlap",
        "search_detail_route_risk",
        "sports_context_route",
      ],
    }),
    candidate({
      id: "promote_kids_greens",
      productId: "11229",
      brandName: "Amazing Grass",
      title: "Amazing Grass, Kidz Superfood Blend, Outrageous Chocolate",
      bucket: "greens_superfood_boundary",
      riskTags: [
        "food_like_route_honesty",
        "barcode_exact",
        "supplement_signal_overlap",
        "search_detail_route_risk",
      ],
    }),
    candidate({
      id: "fifth_valuable_keep_nightly",
      productId: "101706",
      brandName: "Teeccino",
      title: "Teeccino, Organic Mushroom Herbal Tea, Chaga Ashwagandha",
      bucket: "tea_beverage_boundary",
      riskTags: [
        "food_like_route_honesty",
        "barcode_exact",
        "supplement_signal_overlap",
        "search_detail_route_risk",
        "beverage_context_honesty",
      ],
    }),
  ];

  const report = classifyStablePromotionCandidates({
    candidates,
    stableScenarios,
    maxPromote: 4,
    generatedAt: "2026-04-19T00:00:00.000Z",
  });

  assert.deepEqual(
    report.promote_now.map((row) => row.id).sort(),
    ["promote_condiment", "promote_kids_greens", "promote_sleep_tea", "promote_stimulant"].sort(),
  );
  assert.ok(report.skip_duplicate_coverage.some((row) => row.id === "exact_duplicate"));
  assert.ok(report.skip_duplicate_coverage.some((row) => row.id === "line_duplicate"));
  assert.ok(report.needs_data_fix.some((row) => row.id === "needs_data"));
  assert.ok(report.residual.some((row) => row.id === "residual_grocery"));
  assert.ok(report.keep_nightly.some((row) => row.id === "fifth_valuable_keep_nightly"));
  assert.equal(report.summary.promote_now, 4);
  assert.equal(report.summary.skip_duplicate_coverage, 2);
});

test("selector can collect scenarios from discovery report shapes and render operator output", async () => {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "stable-promotion-selector-"));
  const reportPath = path.join(tempDir, "food_like_route_honesty_report.json");
  await fs.writeFile(
    reportPath,
    JSON.stringify({
      stableGateScenarioSeeds: [
        candidate({ id: "stable_seed", productId: "stable-seed" }),
      ],
      nightlyScenarioSeeds: [
        candidate({ id: "nightly_seed", productId: "nightly-seed" }),
      ],
    }),
  );

  const scenarios = await collectPromotionCandidateScenarios([reportPath]);
  assert.deepEqual(scenarios.map((row) => row.id), ["stable_seed", "nightly_seed"]);

  const selection = classifyStablePromotionCandidates({
    candidates: scenarios,
    stableScenarios: [],
    maxPromote: 1,
    generatedAt: "2026-04-19T00:00:00.000Z",
  });
  const markdown = renderStablePromotionCandidateMarkdown(selection);
  assert.match(markdown, /# Stable Promotion Candidate Selector/);
  assert.match(markdown, /promote_now/);

  const outputs = await writeStablePromotionCandidateOutputs({
    report: selection,
    outDir: tempDir,
  });
  assert.ok(outputs.jsonPath.endsWith("stable_promotion_candidate_selector_report.json"));
  assert.ok(outputs.markdownPath.endsWith("stable_promotion_candidate_selector_report.md"));
});

test("selector emits a runtime canary pack from promote_now without hand-written scenario JSON", async () => {
  const selection = classifyStablePromotionCandidates({
    candidates: [
      candidate({
        id: "whey",
        productId: "134706",
        barcode: "00649908211905",
        brandName: "NutraBio",
        title: "NutraBio, Classic Whey Protein, Pistachio Delight, 2 lb (907 g)",
        bucket: "source_protein_boundary",
        riskTags: [
          "food_like_route_honesty",
          "barcode_exact",
          "source_sensitive",
          "supplement_signal_overlap",
          "search_detail_route_risk",
        ],
      }),
      candidate({
        id: "coconut_aminos",
        productId: "119309",
        barcode: "00851492002948",
        brandName: "Coconut Secret",
        title: "Coconut Secret, Coconut Aminos, Soy-Free Soy Sauce Alternative, Medium Spicy, 10 fl oz (296 ml)",
        bucket: "condiment_sweetener_boundary",
        riskTags: [
          "food_like_route_honesty",
          "barcode_exact",
          "source_sensitive",
          "search_detail_route_risk",
        ],
      }),
    ],
    stableScenarios: [],
    maxPromote: 2,
    generatedAt: "2026-04-19T00:00:00.000Z",
  });

  const pack = buildRuntimeCanaryPack({
    report: selection,
    configPath: "output/test/stable-promotion-live-canary.json",
    additionsPath: "output/test/stable-promotion-live-canary-additions.json",
  });

  assert.equal(pack.additions.scenarios.length, 4);
  assert.equal(pack.config.scenarioIds.length, 4);
  assert.deepEqual(pack.config.additionalPackPaths, ["output/test/stable-promotion-live-canary-additions.json"]);
  assert.ok(pack.config.scenarioIds.includes("canary_scan_food_like_nutrabio_classic_whey_protein_route_honesty"));
  assert.ok(pack.config.scenarioIds.includes("canary_search_origin_food_like_coconut_secret_coconut_aminos_route_honesty"));

  const wheyScan = pack.additions.scenarios.find((scenario) =>
    scenario.id === "canary_scan_food_like_nutrabio_classic_whey_protein_route_honesty");
  assert.deepEqual(wheyScan.gates, ["route_health", "selected_anchor_consistency", "unsafe_language"]);
  assert.ok(wheyScan.expected.defaultAnchor.pass.includes("Whey Protein"));
  assert.ok(wheyScan.expected.defaultAnchor.fail.includes("Potassium"));

  const coconutSearch = pack.additions.scenarios.find((scenario) =>
    scenario.id === "canary_search_origin_food_like_coconut_secret_coconut_aminos_route_honesty");
  assert.equal(coconutSearch.input.searchResultSeed.productId, "119309");
  assert.deepEqual(coconutSearch.gates, [
    "click_through_seed_consistency",
    "canonical_product_consistency",
    "selected_anchor_consistency",
    "warning_consistency",
  ]);
  assert.ok(coconutSearch.expected.defaultAnchor.pass.includes("Coconut Aminos"));

  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "stable-promotion-canary-pack-"));
  const outputs = await writeRuntimeCanaryPackOutputs({
    pack,
    configPath: path.join(tempDir, "stable-promotion-live-canary.json"),
  });
  assert.equal(JSON.parse(await fs.readFile(outputs.configPath, "utf8")).scenarioIds.length, 4);
  assert.equal(JSON.parse(await fs.readFile(outputs.additionsPath, "utf8")).scenarios.length, 4);
});
