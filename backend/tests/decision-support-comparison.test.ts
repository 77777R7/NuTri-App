import test from "node:test";
import assert from "node:assert/strict";

import { decisionSupportComparisonInternals } from "../src/decisionSupportComparison.ts";

const makeModules = (overrides: Partial<Record<string, number>> = {}) => [
  { id: "ingredient_safety", score: overrides.ingredient_safety ?? 80 },
  { id: "formula_transparency", score: overrides.formula_transparency ?? 80 },
  { id: "label_clarity", score: overrides.label_clarity ?? 80 },
  { id: "manufacturing_standards", score: overrides.manufacturing_standards ?? 80 },
  { id: "testing_verification", score: overrides.testing_verification ?? 80 },
  { id: "product_quality", score: overrides.product_quality ?? 80 },
];

const makeAnalysis = ({
  title,
  score,
  scoreBand = "Strong",
  categoryId = "fish_oil_omega3",
  formBucket = "softgel",
  familyKey = "fish_oil",
  brand = "Brand",
  hasOmegaBreakdown = true,
  moduleOverrides = {},
}: {
  title: string;
  score: number;
  scoreBand?: string;
  categoryId?: string;
  formBucket?: string;
  familyKey?: string;
  brand?: string;
  hasOmegaBreakdown?: boolean;
  moduleOverrides?: Partial<Record<string, number>>;
}) => ({
  productId: title.toLowerCase().replace(/\s+/g, "_"),
  barcodeGtin14: null,
  title,
  brand,
  imageUrl: null,
  categoryId,
  score,
  scoreBand,
  formBucket,
  familyKey,
  dedupeKey: `${brand}::${title}`.toLowerCase(),
  digest: {
    actives: hasOmegaBreakdown
      ? [{ name: "EPA" }, { name: "DHA" }]
      : [{ name: "Omega-3 Fish Oil" }],
  },
  overlayClaims: {
    nutritionalFacts: hasOmegaBreakdown
      ? [{ substancy: "EPA", amountPerServing: "690 mg", dailyValuePercent: null }, { substancy: "DHA", amountPerServing: "260 mg", dailyValuePercent: null }]
      : [{ substancy: "Omega-3 Fish Oil", amountPerServing: "1040 mg", dailyValuePercent: null }],
    title,
  },
  payload: {
    nutriScoreCardV2: {
      modules: makeModules(moduleOverrides),
    },
  },
});

test("mapStandingLabelFromPercentile respects threshold boundaries", () => {
  assert.deepEqual(
    decisionSupportComparisonInternals.mapStandingLabelFromPercentile(80),
    { standing: "strong", label: "Top tier" },
  );
  assert.deepEqual(
    decisionSupportComparisonInternals.mapStandingLabelFromPercentile(60),
    { standing: "strong", label: "Above average" },
  );
  assert.deepEqual(
    decisionSupportComparisonInternals.mapStandingLabelFromPercentile(40),
    { standing: "average", label: "Around average" },
  );
  assert.deepEqual(
    decisionSupportComparisonInternals.mapStandingLabelFromPercentile(39),
    { standing: "weak", label: "Below average" },
  );
});

test("buildAlternativeReason prefers fish-oil EPA/DHA breakdown cue", () => {
  const current = makeAnalysis({
    title: "Current Fish Oil",
    score: 72,
    hasOmegaBreakdown: false,
    moduleOverrides: { formula_transparency: 60, testing_verification: 60 },
  });
  const candidate = makeAnalysis({
    title: "Candidate Fish Oil",
    score: 92,
    hasOmegaBreakdown: true,
    moduleOverrides: { formula_transparency: 95, testing_verification: 80 },
  });

  assert.equal(
    decisionSupportComparisonInternals.buildAlternativeReason(current as never, candidate as never),
    "Clearer EPA + DHA breakdown",
  );
});

test("computeComparisonStandingFromAnalyses returns fallback-ready rail when peers are light but alternatives exist", () => {
  const current = makeAnalysis({ title: "Current Vitamin C", score: 68, categoryId: "vitamin_mineral_other", formBucket: "capsule", familyKey: "vitamin_c", hasOmegaBreakdown: false });
  const peers = [
    makeAnalysis({ title: "Alt 1", score: 80, categoryId: "vitamin_mineral_other", formBucket: "capsule", familyKey: "vitamin_c", hasOmegaBreakdown: false, moduleOverrides: { label_clarity: 95 } }),
    makeAnalysis({ title: "Alt 2", score: 82, categoryId: "vitamin_mineral_other", formBucket: "capsule", familyKey: "vitamin_c", hasOmegaBreakdown: false, moduleOverrides: { testing_verification: 96 } }),
    makeAnalysis({ title: "Peer 3", score: 66, categoryId: "vitamin_mineral_other", formBucket: "capsule", familyKey: "vitamin_c", hasOmegaBreakdown: false }),
    makeAnalysis({ title: "Peer 4", score: 64, categoryId: "vitamin_mineral_other", formBucket: "capsule", familyKey: "vitamin_c", hasOmegaBreakdown: false }),
  ];

  const standing = decisionSupportComparisonInternals.computeComparisonStandingFromAnalyses({
    current: current as never,
    peers: peers as never,
  });

  assert.ok(standing);
  assert.equal(standing?.status, "ready");
  assert.equal(standing?.standing, "unknown");
  assert.equal(standing?.betterAlternatives.length, 2);
  assert.match(String(standing?.summary), /Higher-scoring options/);
});

test("extractTitleComparisonKeyword strips marketing and dose clutter", () => {
  assert.equal(
    decisionSupportComparisonInternals.extractTitleComparisonKeyword(
      "Sports Research, High Potency Vitamin C, 1,000 mg, 240 Veggie Capsules",
    ),
    "vitamin c",
  );
});
