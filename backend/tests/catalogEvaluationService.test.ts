import assert from "node:assert/strict";
import test from "node:test";

import { prepareCatalogProduct } from "../../lib/personalization/core/catalogProductEvaluation";
import {
  createGoalNavigatorCatalogEvaluationService,
  goalNavigatorCatalogEvaluationServiceInternals,
} from "../src/personalization/catalogEvaluationService";

test("catalog evaluation service reuses a prepared candidate bundle within the TTL window", async () => {
  goalNavigatorCatalogEvaluationServiceInternals.goalNavigatorBundleObservabilityInternals.reset();
  let currentTime = 0;
  let fetchCount = 0;

  const service = createGoalNavigatorCatalogEvaluationService({
    now: () => currentTime,
    bundleTtlMs: 1_000,
    loadPrecomputedBundle: () => null,
    fetchOverlayCatalogRows: async () => {
      fetchCount += 1;
      return [
        {
          product_id: "immune_c",
          brand_name: "Trusted Brand",
          title: "Vitamin C 500",
          supplement_facts: {
            nutritionalFacts: [{ substancy: "Vitamin C", amountPerServing: "500 mg" }],
          },
          description_sections: {
            Description: "Buffered vitamin C support.",
            "Suggested Use": "Take 1 capsule daily.",
          },
        },
        {
          product_id: "mystery_blend",
          brand_name: "Low Data Brand",
          title: "Mystery Immune Blend",
          supplement_facts: {
            nutritionalFacts: [{ substancy: "Immune blend", amountPerServing: "" }],
          },
          description_sections: {
            Description: "A label with weak structured facts.",
          },
        },
      ];
    },
  });

  const first = await service.evaluateGoal({
    goalKey: "immunity",
    preferredTypes: ["vitamin"],
  });

  currentTime = 500;
  const second = await service.evaluateGoal({
    goalKey: "immunity",
    preferredTypes: ["vitamin"],
  });

  currentTime = 1_500;
  const third = await service.evaluateGoal({
    goalKey: "immunity",
    preferredTypes: ["vitamin"],
  });

  assert.equal(fetchCount, 2);
  assert.equal(first.candidates[0]?.productId, "immune_c");
  assert.equal(second.candidates[0]?.productId, "immune_c");
  assert.equal(third.candidates[0]?.productId, "immune_c");
  assert.equal(first.fallback.notEnoughStructuredDataCount, 1);
  assert.equal(second.fallback.notEnoughStructuredDataCount, 1);
  assert.equal(third.fallback.notEnoughStructuredDataCount, 1);

  const runtime =
    goalNavigatorCatalogEvaluationServiceInternals.getGoalNavigatorBundleObservabilitySnapshot();
  assert.equal(runtime.currentBundle.source, "live");
  assert.equal(runtime.counters.liveHits, 3);
  assert.equal(runtime.counters.liveBuildCount, 2);
  assert.equal(runtime.counters.precomputedMissCount, 3);
});

test("catalog evaluation service prefers a precomputed bundle artifact when one is available", async () => {
  goalNavigatorCatalogEvaluationServiceInternals.goalNavigatorBundleObservabilityInternals.reset();
  let fetchCount = 0;

  const service = createGoalNavigatorCatalogEvaluationService({
    fetchOverlayCatalogRows: async () => {
      fetchCount += 1;
      return [];
    },
    loadPrecomputedBundle: () => ({
      preparedAt: "2026-03-19T00:00:00.000Z",
      notEnoughStructuredDataCount: 1,
      source: "storage",
      activeRunId: "run_123",
      storageBucket: "personalization-artifacts",
      storagePath: "goal-navigator/test.json",
      preparedCandidates: [
        {
          preparedProduct: prepareCatalogProduct({
            productId: "immune_c_prebuilt",
            title: "Vitamin C 500",
            brandName: "Trusted Brand",
            description: "Buffered vitamin C support.",
            suggestedUse: "Take 1 capsule daily.",
            ingredients: [{ name: "Vitamin C", dose: "500 mg" }],
          }),
        },
      ],
    }),
  });

  const response = await service.evaluateGoal({
    goalKey: "immunity",
    preferredTypes: ["vitamin"],
  });

  assert.equal(fetchCount, 0);
  assert.equal(response.candidates[0]?.productId, "immune_c_prebuilt");
  assert.equal(response.fallback.notEnoughStructuredDataCount, 1);

  const runtime =
    goalNavigatorCatalogEvaluationServiceInternals.getGoalNavigatorBundleObservabilitySnapshot();
  assert.equal(runtime.currentBundle.source, "storage");
  assert.equal(runtime.currentBundle.activeRunId, "run_123");
  assert.equal(runtime.currentBundle.storagePath, "goal-navigator/test.json");
  assert.equal(runtime.counters.storageHits, 1);
  assert.equal(runtime.counters.precomputedMissCount, 0);
});

test("catalog evaluation service excludes out-of-scope pantry surfaces from the live bundle", async () => {
  const bundle = await goalNavigatorCatalogEvaluationServiceInternals.buildCatalogCandidateBundle(
    async () => [
      {
        product_id: "tea_bags_out_of_scope",
        brand_name: "Buddha Teas",
        title: "Buddha Teas, Organic Herbal Tea, Elderberry, 18 Tea Bags",
        source_zip_path: "buddha-teas.json",
        supplement_facts: {
          nutritionalFacts: [{ substancy: "Calories", amountPerServing: "" }],
        },
      },
      {
        product_id: "immune_c",
        brand_name: "Trusted Brand",
        title: "Vitamin C 500",
        supplement_facts: {
          nutritionalFacts: [{ substancy: "Vitamin C", amountPerServing: "500 mg" }],
        },
      },
    ],
  );

  assert.equal(bundle.preparedCandidates.length, 1);
  assert.equal(bundle.preparedCandidates[0]?.preparedProduct.productId, "immune_c");
  assert.equal(bundle.notEnoughStructuredDataCount, 0);
  assert.equal(bundle.gatedOutOfScopeNonSupplementCount, 1);
});

test("catalog evaluation service recovers simple header-only supplement titles into structured candidates", async () => {
  const bundle = await goalNavigatorCatalogEvaluationServiceInternals.buildCatalogCandidateBundle(
    async () => [
      {
        product_id: "biotin_header_only",
        brand_name: "Bariatric Advantage",
        title: "Bariatric Advantage, Biotin, 5,000 mcg, 90 Capsules",
        source_zip_path: "bariatric-advantage.json",
        supplement_facts: {
          nutritionalFacts: [
            {
              substancy: "",
              amountPerServing: "Amount Per Serving",
              dailyValuePercent: "%Daily Value",
            },
          ],
        },
      },
    ],
  );

  assert.equal(bundle.preparedCandidates.length, 1);
  assert.equal(bundle.preparedCandidates[0]?.preparedProduct.productId, "biotin_header_only");
  assert.equal(bundle.preparedCandidates[0]?.preparedProduct.factsStatus, "full");
  assert.deepEqual(bundle.preparedCandidates[0]?.preparedProduct.overlayIngredients, [
    { name: "Biotin", dose: "5,000 mcg" },
  ]);
  assert.equal(bundle.notEnoughStructuredDataCount, 0);
});

test("catalog evaluation service treats allowlisted herbal formula blends as structured candidates via aggregate rows", async () => {
  const bundle = await goalNavigatorCatalogEvaluationServiceInternals.buildCatalogCandidateBundle(
    async () => [
      {
        product_id: "heart_formula",
        brand_name: "Banyan Botanicals",
        title: "Banyan Botanicals, Heart Formula™, 90 Tablets",
        source_zip_path: "banyan-botanicals.json",
        supplement_facts: {
          nutritionalFacts: [
            {
              substancy: "",
              amountPerServing: "Amount Per Serving",
            },
            {
              substancy:
                "Proprietary BlendArjuna bark Terminalia arjuna+, Boerhavia root Boerhavia diffusa+, Indian Tinospora stem Tinospora cordifolia+, Hawthorn Berry fruit Crataegus spp.+",
              amountPerServing: "1000 mg",
            },
          ],
        },
      },
    ],
  );

  assert.equal(bundle.preparedCandidates.length, 1);
  assert.equal(bundle.preparedCandidates[0]?.preparedProduct.factsStatus, "full");
  assert.ok(
    bundle.preparedCandidates[0]?.preparedProduct.overlayIngredients.some(
      (row) =>
        row.name === "Heart Formula"
        && row.dose === "1000 mg"
        && row.aggregateFormula === true,
    ),
  );
  assert.equal(bundle.notEnoughStructuredDataCount, 0);
});

test("catalog evaluation service rescues source-specific liquid extract rows with dropperful serving counts", async () => {
  const bundle = await goalNavigatorCatalogEvaluationServiceInternals.buildCatalogCandidateBundle(
    async () => [
      {
        product_id: "dandelion_root_extract",
        brand_name: "Christopher's Original Formulas",
        title: "Christopher's Original Formulas, Dandelion Root Extract, 2 fl oz (59 ml)",
        source_zip_path: "christopher-s-original-formulas.json",
        supplement_facts: {
          servingSize: "1 Dropperful",
          servingsPerContainer: "60",
          nutritionalFacts: [
            {
              substancy: "",
              amountPerServing: "Amount Per Serving",
            },
            {
              substancy: "Organic Dandelion Root",
              amountPerServing: "1 Dropperful",
            },
          ],
        },
      },
    ],
  );

  assert.equal(bundle.preparedCandidates.length, 1);
  assert.equal(bundle.preparedCandidates[0]?.preparedProduct.factsStatus, "full");
  assert.deepEqual(bundle.preparedCandidates[0]?.preparedProduct.overlayIngredients, [
    { name: "Dandelion Root Extract", dose: "0.98 ml" },
  ]);
  assert.equal(bundle.notEnoughStructuredDataCount, 0);
});

test("catalog evaluation service treats Gaia herbal extract blends as structured candidates via aggregate rows", async () => {
  const bundle = await goalNavigatorCatalogEvaluationServiceInternals.buildCatalogCandidateBundle(
    async () => [
      {
        product_id: "sound_sleep",
        brand_name: "Gaia Herbs",
        title: "Gaia Herbs, Sound Sleep®, 60 Liquid Phyto-Caps®",
        source_zip_path: "gaia-herbs.json",
        supplement_facts: {
          servingSize: "3 Capsules",
          servingsPerContainer: "20",
          nutritionalFacts: [
            {
              substancy: "",
              amountPerServing: "Amount Per Serving",
            },
            {
              substancy:
                "Herbal Extract BlendOrganic Passionflower (Passiflora incarnata) flowering vine, Organic Hops (Humulus lupulus) strobile, Organic Skullcap (Scutellaria lateriflora) aerial parts extract, Organic Valerian (Valeriana officinalis) root extract, Organic California Poppy (Eschscholzia californica) whole plant, Organic Vervain aerial parts, Organic Gotu Kola (Centella asiatica) leaf, Organic Lavender flower essential oil",
              amountPerServing: "1,731 mg",
            },
          ],
        },
      },
    ],
  );

  assert.equal(bundle.preparedCandidates.length, 1);
  assert.equal(bundle.preparedCandidates[0]?.preparedProduct.factsStatus, "full");
  assert.ok(
    bundle.preparedCandidates[0]?.preparedProduct.overlayIngredients.some(
      (row) =>
        row.name === "Sound Sleep"
        && row.dose === "1,731 mg"
        && row.aggregateFormula === true,
    ),
  );
  assert.equal(bundle.notEnoughStructuredDataCount, 0);
});
