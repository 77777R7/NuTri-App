import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import test from "node:test";

import { ROOT_DIR } from "../../scripts/maintainer/lib/science-validation-reporting.mjs";
import { readOfficialWaveYieldAdmission } from "../../scripts/maintainer/lib/full-db-api-fill-official-waves.mjs";
import {
  chooseValidationTargets,
  inferDynamicPassAnchors,
} from "../../scripts/maintainer/run-official-wave-merge-post-validate.mjs";

const execFileAsync = promisify(execFile);

test("run-official-wave-merge-post-validate skips merge when admission finds zero yield", async () => {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "official-wave-merge-skip-"));
  const runDir = path.join(tempDir, "runs", "wave_lane_b_official_top_99");
  const brandDir = path.join(runDir, "pure-synergy");
  const outDir = path.join(tempDir, "out");
  await fs.mkdir(brandDir, { recursive: true });

  await fs.writeFile(
    path.join(brandDir, "official_fallback_report.json"),
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
  await fs.writeFile(
    path.join(brandDir, "staging_products.official_refreshed.json"),
    JSON.stringify({
      products: [{ productId: "105654", brandName: "Pure Synergy", title: "Zero Yield Example" }],
    }),
  );

  const { stdout } = await execFileAsync(
    process.execPath,
    [
      path.join(ROOT_DIR, "scripts", "maintainer", "run-official-wave-merge-post-validate.mjs"),
      "--run-dirs",
      path.relative(ROOT_DIR, runDir),
      "--out-dir",
      path.relative(ROOT_DIR, outDir),
      "--api-base-url",
      "http://127.0.0.1:3001",
    ],
    { cwd: ROOT_DIR, env: process.env, maxBuffer: 1024 * 1024 * 8 },
  );

  const result = JSON.parse(stdout);
  assert.equal(result.mergeSkipped, true);
  assert.equal(result.yieldFirstAdmission, true);
  assert.equal(result.admissionSummary.admittedBrandRuns, 0);
  assert.equal(result.admissionSummary.discoveryOnlyBrandRuns, 1);

  const reportPath = path.join(ROOT_DIR, result.reportJsonPath);
  const report = JSON.parse(await fs.readFile(reportPath, "utf8"));
  assert.equal(report.merge.skipped, true);
  assert.equal(report.merge.skipReason, "no_admitted_improved_rows");
  assert.equal(report.admission.discoveryOnlyBrandRuns[0].brandName, "Pure Synergy");
});

test("yield admission accepts scrapling merge-validation positive yield", async () => {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "official-wave-scrapling-yield-"));
  const runDir = path.join(tempDir, "runs", "soft-tail");
  const brandDir = path.join(runDir, "flower-essence-services");
  await fs.mkdir(brandDir, { recursive: true });

  await fs.writeFile(
    path.join(brandDir, "official_fallback_report.json"),
    JSON.stringify({
      selectedCount: 2,
      results: [
        { productId: "16167", outcome: "scrapling_candidate_built" },
        { productId: "16178", outcome: "scrapling_candidate_built" },
      ],
    }),
  );
  await fs.writeFile(
    path.join(brandDir, "scrapling_merge_validation_report.json"),
    JSON.stringify({
      summary: {
        processed: 2,
        improvedRows: 2,
        becameFullOverlayReady: 2,
        filledSuggestedUse: 0,
        filledWarnings: 2,
      },
      rows: [
        { productId: "16167", brandName: "Flower Essence Services", improved: true },
        { productId: "16178", brandName: "Flower Essence Services", improved: true },
      ],
    }),
  );
  await fs.writeFile(
    path.join(brandDir, "staging_products.official_refreshed.json"),
    JSON.stringify({
      products: [
        { productId: "16167", brandName: "Flower Essence Services", title: "Angelica" },
        { productId: "16178", brandName: "Flower Essence Services", title: "Aspen" },
      ],
    }),
  );

  const admission = await readOfficialWaveYieldAdmission({
    runDirs: [path.relative(ROOT_DIR, runDir)],
    rootDir: ROOT_DIR,
  });

  assert.equal(admission.summary.admittedBrandRuns, 1);
  assert.equal(admission.summary.discoveryOnlyBrandRuns, 0);
  assert.equal(admission.summary.improvedRows, 2);
  assert.equal(admission.admittedBrandRuns[0].summary.filledWarnings, 2);
});

test("post-merge validation falls back to dynamic title-led targets for new positive-yield waves", () => {
  const anchors = inferDynamicPassAnchors({
    title: "HealthForce Superfoods, Spirulina Manna™, 150 VeganCaps™",
    supplementFacts: {
      nutritionalFacts: [
        {
          substancy: "Organic Spirulina",
          amountPerServing: "3 g",
        },
      ],
    },
  });

  assert.ok(anchors.includes("Spirulina"));

  const targets = chooseValidationTargets({
    limit: 2,
    mergedRows: [
      {
        productId: "121768",
        brandName: "HealthForce Superfoods",
        title: "HealthForce Superfoods, Spirulina Manna™, 150 VeganCaps™",
        barcodeGtin14: "00650786000055",
        mergeDecision: "merged",
      },
      {
        productId: "147021",
        brandName: "NB Pure",
        title: "NB Pure, Performance Glutamine+, 7.05 oz (200 g)",
        barcodeGtin14: "00679234147021",
        mergeDecision: "merged",
      },
    ],
    combinedProducts: [
      {
        productId: "121768",
        title: "HealthForce Superfoods, Spirulina Manna™, 150 VeganCaps™",
        supplementFacts: {
          nutritionalFacts: [
            {
              substancy: "Organic Spirulina",
              amountPerServing: "3 g",
            },
          ],
        },
      },
      {
        productId: "147021",
        title: "NB Pure, Performance Glutamine+, 7.05 oz (200 g)",
        supplementFacts: {
          nutritionalFacts: [
            {
              substancy: "L-Glutamine",
              amountPerServing: "5 g",
            },
          ],
        },
      },
    ],
  });

  assert.deepEqual(
    targets.map((row) => ({
      productId: row.productId,
      category: row.category,
      passAnchors: row.passAnchors.slice(0, 2),
      failAnchorsIncludesServing: row.failAnchors.includes("Serving Size"),
    })),
    [
      {
        productId: "121768",
        category: "dynamic_post_merge",
        passAnchors: ["Spirulina"],
        failAnchorsIncludesServing: true,
      },
      {
        productId: "147021",
        category: "dynamic_post_merge",
        passAnchors: ["Glutamine"],
        failAnchorsIncludesServing: true,
      },
    ],
  );
});

test("post-merge validation treats Udo's Oil 3-6-9 as an omega title-led target", () => {
  const anchors = inferDynamicPassAnchors({
    title: "Flora, Udo's Choice, Udo's Oil DHA 3-6-9 Blend, 17 fl oz (500 ml)",
    supplementFacts: {
      nutritionalFacts: [
        { substancy: "Saturated Fat", amountPerServing: "2 g" },
        { substancy: "Omega-3 ALA", amountPerServing: "6 g" },
        { substancy: "DHA", amountPerServing: "100 mg" },
      ],
    },
  });

  assert.deepEqual(anchors.slice(0, 4), ["Omega 3-6-9", "Omega-3", "DHA", "ALA"]);
});

test("post-merge validation treats daily multi formula titles as multivitamin targets", () => {
  const anchors = inferDynamicPassAnchors({
    title: "Mason Natural, Women's Daily Multi Formula, 90 Caplets",
    supplementFacts: {
      nutritionalFacts: [
        { substancy: "Vitamin A(as acetate, and 20% as beta-carotene)", amountPerServing: "750 mcg RAE" },
        { substancy: "Magnesium (magnesium oxide)", amountPerServing: "50 mg" },
      ],
    },
  });

  assert.deepEqual(anchors.slice(0, 2), ["Multivitamin", "Multivitamin & Mineral Formula"]);
});

test("post-merge validation treats just-one multi titles as multivitamin targets", () => {
  const anchors = inferDynamicPassAnchors({
    title: "Swanson, Just One Multi with Iron, 130 Tablets",
    supplementFacts: {
      nutritionalFacts: [
        { substancy: "Vitamin C (as ascorbic acid)", amountPerServing: "1,500 mcg" },
        { substancy: "Iron", amountPerServing: "18 mg" },
      ],
    },
  });

  assert.deepEqual(anchors.slice(0, 2), ["Multivitamin", "Multivitamin & Mineral Formula"]);
});

test("post-merge validation accepts sparse folate and probiotic family anchors", () => {
  assert.deepEqual(
    inferDynamicPassAnchors({
      title: "Protocol for Life Balance, 5-Methyl Folate, 5,000 mcg , 50 Veg Capsules",
      supplementFacts: {
        nutritionalFacts: [
          { substancy: "Folate", amountPerServing: "8333 mcg DFE" },
        ],
      },
    }).slice(0, 3),
    ["Folate", "5-Methyl Folate", "Methyl Folate"],
  );

  assert.deepEqual(
    inferDynamicPassAnchors({
      title: "Protocol for Life Balance, ProtoDophilus, 50 Billion, 50 Veg Capsules",
      supplementFacts: {
        nutritionalFacts: [
          { substancy: "Blend of 10 Strains of Probiotic Bacteria", amountPerServing: "np" },
        ],
      },
    }).slice(0, 2),
    ["Probiotics", "Probiotic"],
  );
});

test("post-merge validation accepts flower essence family anchors for flower essence products", () => {
  assert.deepEqual(
    inferDynamicPassAnchors({
      title: "Flower Essence Services, Flower Essence & Essential Oil, Grounding Green, 1 fl oz (30 ml)",
      supplementFacts: {
        nutritionalFacts: [
          { substancy: "infusions of flowers of", amountPerServing: null },
          { substancy: "Essential Oils", amountPerServing: null },
        ],
      },
    }).slice(0, 3),
    ["Flower Essence", "Flower Essence & Essential Oil", "Grounding Green"],
  );
});

test("post-merge validation accepts title-led botanical and nootropic anchors from sparse official rows", () => {
  assert.deepEqual(
    inferDynamicPassAnchors({
      title: "Eclectic Herb, Parafight, Intestinal Support, 2 fl oz (60 ml)",
      supplementFacts: { nutritionalFacts: [{ substancy: "Contains tree nuts (black walnut)" }] },
    }).slice(0, 3),
    ["ParaFight Herbal Blend", "ParaFight", "Intestinal Support Blend"],
  );

  assert.deepEqual(
    inferDynamicPassAnchors({
      title: "Eclectic Herb, Propolis, 2 fl oz ( 60 ml)",
      supplementFacts: { nutritionalFacts: [{ substancy: "Fresh propolis (resina propoli)" }] },
    }).slice(0, 1),
    ["Propolis"],
  );

  assert.deepEqual(
    inferDynamicPassAnchors({
      title: "Source Naturals, Caffeine + L-Theanine, 60 Tablets",
      supplementFacts: { nutritionalFacts: [{ substancy: "Microcrystalline cellulose" }] },
    }).slice(0, 2),
    ["Caffeine", "L-Theanine"],
  );

  assert.deepEqual(
    inferDynamicPassAnchors({
      title: "Futurebiotics, Thinkfast, Brain Performance + Memory, 120 Vegetarian Capsules",
      supplementFacts: { nutritionalFacts: [{ substancy: "Chinese Skullcap root extract" }] },
    }).slice(0, 1),
    ["CogninSA"],
  );
});

test("post-merge validation accepts NOW oil and menopause formula runtime anchors", () => {
  assert.ok(
    inferDynamicPassAnchors({
      title: "NOW Foods, Certified Organic Flax Seed Oil, 12 fl oz (355 ml)",
      supplementFacts: {
        nutritionalFacts: [
          { substancy: "Calories", amountPerServing: "120" },
          { substancy: "Total Fat", amountPerServing: "14 g" },
          { substancy: "Saturated Fat", amountPerServing: "1 g" },
          { substancy: "Polyunsaturated Fat", amountPerServing: "10 g" },
          { substancy: "Monounsaturated Fat", amountPerServing: "3 g" },
          { substancy: "Sodium", amountPerServing: "0 mg" },
          { substancy: "Total Carbohydrate", amountPerServing: "0 g" },
          { substancy: "Protein", amountPerServing: "0 g" },
          { substancy: "Linolenic Acid (Omega-3)", amountPerServing: "7.7 g" },
        ],
      },
    }).some((anchor) => /linolenic acid|flax seed oil/i.test(anchor)),
  );

  assert.ok(
    inferDynamicPassAnchors({
      title: "NOW Foods, Menopause Support, 90 Veg Capsules",
      supplementFacts: {
        nutritionalFacts: [
          { substancy: "Organic Dong Quai (Angelica sinensis) (Root/Rhizome)", amountPerServing: "400 mg" },
          { substancy: "Red Raspberry (Rubus idaeus) (Leaf)", amountPerServing: "300 mg" },
          { substancy: "Chaste Tree Extract (Vitex agnus castus) (Fruit) (min. 0.5% Agnusides)", amountPerServing: "300 mg" },
          { substancy: "Red Clover (Trifolium pratense) (Flower Tops)", amountPerServing: "250 mg" },
          { substancy: "Black Cohosh Extract (Actaea racemosa) (Root)", amountPerServing: "80 mg" },
          { substancy: "Soy Isoflavone Powder (Glycine max)(Seed)", amountPerServing: "50 mg" },
        ],
      },
    }).some((anchor) => /soy isoflavone/i.test(anchor)),
  );
});

test("post-merge validation accepts OralBiotic strain runtime anchors", () => {
  const [target] = chooseValidationTargets({
    limit: 1,
    mergedRows: [
      {
        productId: "23650",
        brandName: "NOW Foods",
        title: "NOW Foods, OralBiotic®, 60 Lozenges",
        barcodeGtin14: "00733739029218",
        mergeDecision: "merged",
      },
    ],
    combinedProducts: [
      {
        productId: "23650",
        title: "NOW Foods, OralBiotic®, 60 Lozenges",
        supplementFacts: {
          nutritionalFacts: [
            { substancy: "Streptococcus salivarius K12 (BLIS K12®) (1 Billion CFU†)" },
          ],
        },
      },
    ],
  });

  assert.ok(target.passAnchors.some((anchor) => /blis k12|streptococcus salivarius/i.test(anchor)));
});

test("post-merge validation accepts immune liquid zinc anchors beyond the first facts rows", () => {
  assert.ok(
    inferDynamicPassAnchors({
      title: "Trace, Liquid Immunity+, Mixed Berry, 30 fl oz (887 ml)",
      supplementFacts: {
        nutritionalFacts: [
          { substancy: "Total CarbohydrateR", amountPerServing: "10 g" },
          { substancy: "Vitamin C (as Ascorbic Acid)", amountPerServing: "1000 mg" },
          { substancy: "Vitamin D3 (as Cholecalciferol)", amountPerServing: "30 mcg" },
          { substancy: "Vitamin E (as D-Alpha Tocopherol Acetate)", amountPerServing: "30 mg" },
          { substancy: "Magnesium (from CTM)", amountPerServing: "10 mg" },
          { substancy: "Zinc (as Zinc Gluconate)", amountPerServing: "15 mg" },
          { substancy: "Black Elderberry", amountPerServing: "200 mg" },
        ],
      },
    }).some((anchor) => /zinc/i.test(anchor)),
  );
});

test("post-merge validation accepts lutein in bilberry ginkgo eyebright complex titles", () => {
  assert.ok(
    inferDynamicPassAnchors({
      title: "Solgar, Bilberry Ginkgo Eyebright Complex Plus Lutein, 60 Vegetable Capsules",
      supplementFacts: {
        nutritionalFacts: [
          { substancy: "Lutein (from marigold flower)", amountPerServing: "10 mg" },
          { substancy: "Eyebright Extract", amountPerServing: "25 mg" },
          { substancy: "Bilberry Extract", amountPerServing: "20 mg" },
          { substancy: "Ginkgo Extract", amountPerServing: "10 mg" },
        ],
      },
    }).some((anchor) => /lutein/i.test(anchor)),
  );
});
