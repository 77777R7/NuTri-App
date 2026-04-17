import assert from "node:assert/strict";
import test from "node:test";
import {
  applyCanaryOverlay,
  isBadAnchorName,
  renderMarkdownReport,
  rowKey,
  scoreValidationRow,
  scoreUxSourceCopyRow,
  summarizeValidationRows,
  summarizeUxSourceCopyRows,
} from "../../scripts/maintainer/lib/science-validation-reporting.mjs";

test("baseline merge overlays newer canary decision-support fields by barcode+cluster", () => {
  const oldRow = {
    cluster: "zinc",
    barcode: "123",
    title: "Example Zinc",
    decisionSupport: {
      ok: true,
      status: 200,
      defaultIngredientName: "Vitamin C",
      defaultIngredientAligned: false,
      scienceRowCount: 1,
    },
  };
  const canaryRow = {
    bucket: "zinc",
    barcode: "00000000000123",
    httpStatus: 200,
    ok: true,
    defaultName: "Zinc",
    ingredientRowsCount: 4,
    aligned: true,
  };

  assert.equal(rowKey(oldRow), rowKey(canaryRow));
  const merged = applyCanaryOverlay(oldRow, canaryRow, "sixBucketCanary");
  assert.equal(merged.decisionSupport.defaultIngredientName, "Zinc");
  assert.equal(merged.decisionSupport.defaultIngredientAligned, true);
  assert.equal(merged.decisionSupport.scienceRowCount, 4);
  assert.deepEqual(merged._mergeSources, ["sixBucketCanary"]);
});

test("macro and package anchors are always bad anchors", () => {
  assert.equal(isBadAnchorName("Total Carbohydrates"), true);
  assert.equal(isBadAnchorName("Calories"), true);
  assert.equal(isBadAnchorName("60 Veggie Capsules"), true);
  assert.equal(isBadAnchorName("100% Organic Pea Protein Powder"), false);
  assert.equal(isBadAnchorName("Alive! Adult Premium Gummies Multivitamin"), false);
  assert.equal(isBadAnchorName("Blood Sugar Support Multivitamin"), false);
  assert.equal(isBadAnchorName("Magnesium"), false);
});

test("single active aligned row passes default ingredient quality", () => {
  const scored = scoreValidationRow({
    cluster: "magnesium",
    barcode: "456",
    title: "Magnesium Glycinate",
    decisionSupport: {
      ok: true,
      status: 200,
      scienceRowCount: 2,
      defaultIngredientName: "Magnesium",
      defaultIngredientAligned: true,
    },
    scientificBackground: {
      final: {
        ok: true,
        status: 200,
        source: "api",
        genericHit: false,
      },
    },
  });
  assert.equal(scored.flags.defaultIngredientQualityPass, true);
  assert.equal(scored.flags.scienceRowCoveragePass, true);
});

test("mineral stack accepts a reasonable disclosed anchor with warning", () => {
  const scored = scoreValidationRow({
    cluster: "mineral_multi_conflict",
    barcode: "789",
    title: "Calcium Magnesium Zinc",
    decisionSupport: {
      ok: true,
      status: 200,
      scienceRowCount: 5,
      defaultIngredientName: "Calcium",
      defaultIngredientAligned: false,
    },
  });
  assert.equal(scored.flags.defaultIngredientQualityPass, true);
  assert.equal(scored.flags.defaultIngredientQualityWarn, true);
});

test("food-like research mode is a product-type routing failure", () => {
  const scored = scoreValidationRow({
    canaryType: "stroopwafel",
    barcode: "321",
    title: "Stroopwafels, Caramel",
    dsStatus: 200,
    scienceRowCount: 3,
    selectedIngredient: "Total Carbohydrates",
    sbStatus: 200,
    sbSource: "fallback",
    sbMode: "research_mode",
  });
  assert.equal(scored.flags.productTypeRoutingApplicable, true);
  assert.equal(scored.flags.productTypeRoutingPass, false);
  assert.equal(scored.flags.foodLikeResearchModeLeakage, true);
});

test("summary reports five score areas and failure buckets", () => {
  const summary = summarizeValidationRows([
    {
      cluster: "omega3",
      barcode: "1",
      decisionSupport: {
        ok: true,
        status: 200,
        scienceRowCount: 1,
        defaultIngredientName: "EPA",
        defaultIngredientAligned: true,
      },
      scientificBackground: {
        final: {
          ok: true,
          status: 200,
          source: "api",
          genericHit: false,
        },
      },
    },
    {
      cluster: "broad_residue",
      barcode: "2",
      decisionSupport: {
        ok: true,
        status: 200,
        scienceRowCount: 0,
        defaultIngredientName: null,
        defaultIngredientAligned: false,
      },
    },
  ]);

  assert.equal(summary.sampleCount, 2);
  assert.ok(summary.routeHealth);
  assert.ok(summary.scienceRowCoverage);
  assert.ok(summary.defaultIngredientQuality);
  assert.ok(summary.summaryQuality);
  assert.ok(summary.productTypeRouting);
  assert.equal(summary.estimatedMissingScienceRows, 1);
  assert.ok(summary.failureBuckets.some((bucket) => bucket.reason === "missing_science_rows"));
});

test("ux source/copy gate flags weak source leakage and generic scientific background copy", () => {
  const scored = scoreUxSourceCopyRow({
    cluster: "omega3",
    barcode: "1001",
    title: "Omega-3 Fish Oil",
    decisionSupport: {
      ok: true,
      status: 200,
      scienceRowCount: 3,
      defaultIngredientName: "Omega-3 Fish Oil",
      defaultIngredientDose: "1000 mg",
      defaultIngredientAligned: true,
    },
    ingredientOverview: {
      initial: {
        ok: true,
        status: 200,
        source: "api",
        ingredientOverview: {
          mode: "single_anchor",
          titleLine: "Omega-3 Fish Oil",
          paragraph1:
            "This summary uses limited unverified web evidence and should be confirmed against the package label.",
          paragraph2: null,
          compareHint: null,
        },
      },
    },
    scientificBackground: {
      selectedIngredientName: "Omega-3 Fish Oil",
      final: {
        ok: true,
        status: 200,
        source: "api",
        scientificBackground: {
          mode: "research_mode",
          selectedLabel: "Omega-3 Fish Oil",
          selectedDose: "1000 mg",
          introLine: "Omega-3 Fish Oil • 1000 mg",
          sections: [
            {
              heading: "Primary research lane",
              summary: "Omega-3 appears in several research directions.",
              bullets: [],
              evidenceRead: "Some outcomes are usually more central than others.",
              shopperMeaning: null,
            },
          ],
          closingNote: null,
        },
      },
    },
  });

  assert.equal(scored.flags.sourceWeakHintLeakage, true);
  assert.equal(scored.flags.scientificBackgroundGeneric, true);
  assert.ok(scored.failureReasons.includes("source_weak_hint_leakage"));
  assert.ok(scored.failureReasons.includes("scientific_background_generic"));
});

test("ux source/copy gate flags ingredient overview factual echo and selected mismatch", () => {
  const scored = scoreUxSourceCopyRow({
    cluster: "zinc",
    barcode: "1002",
    title: "Zinc with Vitamin C",
    decisionSupport: {
      ok: true,
      status: 200,
      scienceRowCount: 4,
      defaultIngredientName: "Zinc",
      defaultIngredientDose: "30 mg",
      defaultIngredientAligned: true,
    },
    ingredientOverview: {
      initial: {
        ok: true,
        status: 200,
        source: "api",
        ingredientOverview: {
          mode: "single_anchor",
          titleLine: "Vitamin C Supplement",
          paragraph1: "Vitamin C provides 500 mg per serving in this formula.",
          paragraph2: null,
          compareHint: null,
        },
      },
    },
    scientificBackground: {
      selectedIngredientName: "Zinc",
      final: {
        ok: true,
        status: 200,
        source: "api",
        scientificBackground: {
          mode: "research_mode",
          selectedLabel: "Zinc",
          selectedDose: "30 mg",
          introLine: "Vitamin C • 500 mg",
          sections: [
            {
              heading: "Companion nutrient",
              summary: "Vitamin C is commonly paired into immune formulas.",
              bullets: [],
              evidenceRead: "Label context only.",
              shopperMeaning: "Compare the vitamin C line across formulas.",
            },
          ],
          closingNote: null,
        },
      },
    },
  });

  assert.equal(scored.flags.ingredientOverviewFactualEcho, true);
  assert.equal(scored.flags.ingredientOverviewSelectedMismatch, true);
  assert.equal(scored.flags.scientificBackgroundSelectedMismatch, true);
  assert.ok(scored.failureReasons.includes("ingredient_overview_factual_echo"));
  assert.ok(scored.failureReasons.includes("ingredient_overview_selected_mismatch"));
  assert.ok(scored.failureReasons.includes("scientific_background_selected_mismatch"));
});

test("ux source/copy summary counts failure buckets and report renders closure section", () => {
  const rows = [
    {
      cluster: "zinc",
      barcode: "1",
      title: "Zinc Formula",
      decisionSupport: {
        ok: true,
        status: 200,
        scienceRowCount: 2,
        defaultIngredientName: "Zinc",
        defaultIngredientDose: "15 mg",
        defaultIngredientAligned: true,
      },
      ingredientOverview: {
        initial: {
          ok: true,
          status: 200,
          source: "api",
          ingredientOverview: {
            mode: "single_anchor",
            titleLine: "Zinc",
            paragraph1: "This supplement contains Zinc 15 mg per serving.",
            paragraph2: null,
            compareHint: null,
          },
        },
      },
      scientificBackground: {
        selectedIngredientName: "Zinc",
        final: {
          ok: true,
          status: 200,
          source: "api",
          scientificBackground: {
            mode: "research_mode",
            selectedLabel: "Zinc",
            selectedDose: "15 mg",
            introLine: "Zinc • 15 mg",
            sections: [
              {
                heading: "Generic lane",
                summary: "Zinc appears in several research directions.",
                bullets: [],
                evidenceRead: "Some outcomes are usually more central than others.",
                shopperMeaning: null,
              },
            ],
            closingNote: null,
          },
        },
      },
    },
    {
      cluster: "probiotics",
      barcode: "2",
      title: "Protectis Probiotic",
      decisionSupport: {
        ok: true,
        status: 200,
        scienceRowCount: 2,
        defaultIngredientName: "Protectis Probiotic",
        defaultIngredientDose: null,
        defaultIngredientAligned: true,
      },
      ingredientOverview: {
        initial: {
          ok: true,
          status: 200,
          source: "api",
          ingredientOverview: {
            mode: "single_anchor",
            titleLine: "Protectis Probiotic",
            paragraph1:
              "Protectis is the named probiotic strain family the product is built around, so the shopper should compare strain identity and CFU disclosure before broader blend extras.",
            paragraph2: null,
            compareHint: "Check the named strain and CFU line against similar probiotic products.",
          },
        },
      },
      scientificBackground: {
        selectedIngredientName: "Protectis Probiotic",
        final: {
          ok: true,
          status: 200,
          source: "api",
          scientificBackground: {
            mode: "label_context_mode",
            selectedLabel: "Protectis Probiotic",
            selectedDose: null,
            introLine: "Protectis Probiotic",
            sections: [
              {
                heading: "Probiotic identity",
                summary:
                  "Protectis products are usually compared by the named strain identity and dose disclosure, because those details determine whether two probiotic labels are actually comparable.",
                bullets: [],
                evidenceRead:
                  "The strongest label-reading signal is the named strain and CFU disclosure rather than a broad probiotic umbrella claim.",
                shopperMeaning:
                  "Use the strain name and CFU line to compare this probiotic against nearby alternatives.",
              },
            ],
            closingNote: null,
          },
        },
      },
    },
  ];

  const uxSummary = summarizeUxSourceCopyRows(rows);
  assert.equal(uxSummary.sampleCount, 2);
  assert.equal(uxSummary.pass, 1);
  assert.equal(uxSummary.fail, 1);
  assert.equal(uxSummary.sourceWeakHintLeakage, 0);
  assert.equal(uxSummary.ingredientOverviewFactualEcho, 1);
  assert.equal(uxSummary.scientificBackgroundGeneric, 1);
  assert.ok(uxSummary.failureBuckets.some((bucket) => bucket.reason === "ingredient_overview_factual_echo"));

  const report = renderMarkdownReport({
    title: "Science UX Closure",
    generatedAt: "2026-04-16T00:00:00.000Z",
    summary: {
      ...summarizeValidationRows(rows),
      uxSourceCopy: uxSummary,
    },
  });

  assert.match(report, /UX Source\/Copy Closure/i);
  assert.match(report, /ingredient overview factual echo/i);
  assert.match(report, /scientific background generic/i);
});

test("ux source/copy gate treats EPA acronym mention as selected-ingredient match", () => {
  const scored = scoreUxSourceCopyRow({
    cluster: "omega3",
    barcode: "1003",
    title: "Super EPA Fish Oil",
    decisionSupport: {
      ok: true,
      status: 200,
      scienceRowCount: 3,
      defaultIngredientName: "EPA (eicosapentaenoic acid)",
      defaultIngredientDose: "720 mg",
      defaultIngredientAligned: true,
    },
    scientificBackground: {
      selectedIngredientName: "EPA (eicosapentaenoic acid)",
      final: {
        ok: true,
        status: 200,
        source: "fallback",
        scientificBackground: {
          mode: "research_mode",
          selectedLabel: "EPA",
          selectedDose: "720 mg",
          introLine: "EPA • 720 mg",
          sections: [
            {
              heading: "Lipid and triglyceride research",
              summary:
                "The clearest way to read EPA is through triglyceride and lipid-marker research, because that is still the most concrete and decision-useful EPA evidence lane.",
              bullets: [],
              evidenceRead: "This is the lane that usually carries the most decision value for EPA products.",
              shopperMeaning: "Use the EPA line and amount to compare similar omega-3 products.",
            },
          ],
          closingNote: null,
        },
      },
    },
  });

  assert.equal(scored.flags.scientificBackgroundSelectedMismatch, false);
  assert.ok(!scored.failureReasons.includes("scientific_background_selected_mismatch"));
});

test("ux source/copy gate treats vitamin D as a vitamin D3 selected-ingredient match", () => {
  const scored = scoreUxSourceCopyRow({
    cluster: "common_vitamins_minerals",
    barcode: "1004",
    title: "Vitamin D3 5000 IU",
    decisionSupport: {
      ok: true,
      status: 200,
      scienceRowCount: 2,
      defaultIngredientName: "Vitamin D3 (as Cholecalciferol)",
      defaultIngredientDose: "125 mcg",
      defaultIngredientAligned: true,
    },
    scientificBackground: {
      selectedIngredientName: "Vitamin D3 (as Cholecalciferol)",
      final: {
        ok: true,
        status: 200,
        source: "fallback",
        scientificBackground: {
          mode: "research_mode",
          selectedLabel: "Vitamin D3 (as Cholecalciferol)",
          selectedDose: "125 mcg",
          introLine: "Vitamin D • 125 mcg",
          sections: [
            {
              heading: "Bone and calcium regulation context",
              summary:
                "Vitamin D is easiest to interpret through bone and calcium-regulation context because that is the clearest lane for comparing this label.",
              bullets: [],
              evidenceRead: "This is the grounded lane for vitamin D products.",
              shopperMeaning: "Use the exact vitamin D line and amount as the main comparison point.",
            },
          ],
          closingNote: null,
        },
      },
    },
  });

  assert.equal(scored.flags.scientificBackgroundSelectedMismatch, false);
  assert.ok(!scored.failureReasons.includes("scientific_background_selected_mismatch"));
});

test("ux source/copy gate treats common branded and form aliases as selected-ingredient matches", () => {
  const sensoril = scoreUxSourceCopyRow({
    cluster: "popular_high_frequency_brands",
    barcode: "1007",
    title: "Swanson, Adrenal Essentials",
    decisionSupport: {
      ok: true,
      status: 200,
      scienceRowCount: 5,
      defaultIngredientName: "Sensoril",
      defaultIngredientAligned: true,
    },
    scientificBackground: {
      selectedIngredientName: "Sensoril",
      final: {
        ok: true,
        status: 200,
        source: "fallback",
        scientificBackground: {
          mode: "research_mode",
          selectedLabel: "Sensoril",
          selectedDose: "50 mg",
          introLine: "Ashwagandha • 50 mg",
          sections: [
            {
              heading: "Stress and mood-related research",
              summary: "Ashwagandha is easiest to read through stress- and mood-adjacent research context.",
              bullets: [],
              evidenceRead: "This is the most direct research lane for branded ashwagandha extracts.",
              shopperMeaning: "Compare the branded extract and amount rather than broad adrenal wording.",
            },
          ],
          closingNote: null,
        },
      },
    },
  });
  const b12 = scoreUxSourceCopyRow({
    cluster: "popular_high_frequency_brands",
    barcode: "1008",
    title: "Nature Made, B-12 Sublingual, Cherry",
    decisionSupport: {
      ok: true,
      status: 200,
      scienceRowCount: 1,
      defaultIngredientName: "Vitamin B12 (as Cyanocobalmin)",
      defaultIngredientAligned: true,
    },
    scientificBackground: {
      selectedIngredientName: "Vitamin B12 (as Cyanocobalmin)",
      final: {
        ok: true,
        status: 200,
        source: "fallback",
        scientificBackground: {
          mode: "research_mode",
          selectedLabel: "Vitamin B12",
          selectedDose: "1000 mcg",
          introLine: "Vitamin B12 • 1000 mcg",
          sections: [
            {
              heading: "Deficiency and supplementation context",
              summary: "Vitamin B12 is easiest to read through supplementation and status-related context.",
              bullets: [],
              evidenceRead: "This is the cleanest B12 comparison lane.",
              shopperMeaning: "Compare the B12 form and amount.",
            },
          ],
          closingNote: null,
        },
      },
    },
  });

  assert.equal(sensoril.flags.scientificBackgroundSelectedMismatch, false);
  assert.equal(b12.flags.scientificBackgroundSelectedMismatch, false);
});

test("default quality gate warns but accepts title-led probiotic vitamin D and protein food anchors", () => {
  const probioticDrops = scoreValidationRow({
    cluster: "common_vitamins_minerals",
    barcode: "1005",
    title: "Culturelle, Baby Probiotics, Immune + Digestive Support, Probiotic & Vitamin D Drops",
    decisionSupport: {
      ok: true,
      status: 200,
      scienceRowCount: 2,
      defaultIngredientName: "Probiotic Blend",
      defaultIngredientAligned: false,
    },
  });
  const proteinSnack = scoreValidationRow({
    cluster: "food_like_edge_cases",
    barcode: "1006",
    title: "Catalina Crunch, Protein Snack Mix, Cheddar, 5.25 oz",
    decisionSupport: {
      ok: true,
      status: 200,
      scienceRowCount: 5,
      defaultIngredientName: "Protein",
      defaultIngredientAligned: true,
    },
  });

  assert.equal(probioticDrops.flags.defaultIngredientQualityPass, true);
  assert.equal(probioticDrops.flags.defaultIngredientQualityWarn, true);
  assert.equal(proteinSnack.flags.defaultIngredientQualityPass, true);
  assert.equal(proteinSnack.flags.badAnchor, false);
});
