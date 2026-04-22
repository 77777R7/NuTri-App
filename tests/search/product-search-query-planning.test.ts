import assert from "node:assert/strict";
import test from "node:test";

import {
  buildColdFallbackOrClauses,
  buildSearchQueryPlan,
  computeSearchQueryIdentityBonus,
  extractColdFallbackBrandLead,
  extractColdFallbackCoreTerms,
  extractSearchFormSignals,
  extractSearchStrengthSignals,
} from "../../backend/src/productSearch.ts";

test("extractColdFallbackBrandLead prefers the leading brand segment for comma-prefixed titles", () => {
  assert.equal(
    extractColdFallbackBrandLead("Swanson, DIM Complex, 30 Capsules"),
    "swanson",
  );
  assert.equal(
    extractColdFallbackBrandLead("The Smurfs, Elderberry Liquid Drops, Ages 1+, Berry"),
    "the smurfs",
  );
  assert.equal(
    extractColdFallbackBrandLead("Natural Lecithin Concentrate (From Soy) 400 mg"),
    null,
  );
});

test("cold fallback core terms drop noisy packaging and filler tokens", () => {
  assert.deepEqual(
    extractColdFallbackCoreTerms(
      "YumEarth, Gummy Bears, Assorted, 35 Snack Packs, 0.7 oz (19.8 g) Each",
    ),
    ["bears"],
  );

  assert.deepEqual(
    extractColdFallbackCoreTerms(
      "Nutricost, Grass-Fed Whey Protein Isolate, Milk Chocolate, 2 lb (907 g)",
    ),
    ["whey", "protein", "isolate"],
  );

  assert.deepEqual(
    extractColdFallbackCoreTerms("Natural Lecithin Concentrate (From Soy) 400 mg"),
    ["natural", "lecithin", "concentrate", "soy"],
  );
});

test("cold fallback or clauses do not include noisy food-like packaging tokens", () => {
  const clauses = buildColdFallbackOrClauses(
    "YumEarth, Gummy Bears, Assorted, 35 Snack Packs, 0.7 oz (19.8 g) Each",
  );

  assert.ok(clauses.includes("title.ilike.%bears%"));
  assert.ok(!clauses.includes("title.ilike.%each%"));
  assert.ok(!clauses.includes("title.ilike.%packs%"));
  assert.ok(!clauses.includes("title.ilike.%snack%"));
  assert.ok(!clauses.includes("title.ilike.%assorted%"));
});

test("search query plan still keeps exact ingredient families for normal scoring", () => {
  const plan = buildSearchQueryPlan(
    "Nutricost, Grass-Fed Whey Protein Isolate, Milk Chocolate, 2 lb (907 g)",
  );

  assert.deepEqual(
    plan.requiredGroups.map((group) => group[0]),
    ["nutricost", "grass", "fed", "whey", "protein", "isolate", "milk", "chocolate", "lb"],
  );
});

test("search strength and form signals preserve exact identity cues", () => {
  assert.deepEqual(
    extractSearchStrengthSignals("Jamieson Vitamin D3 1,000 IU: Tablets"),
    ["1000 iu"],
  );
  assert.deepEqual(
    extractSearchStrengthSignals("Vitamin D3 2,500 IU | Softgels"),
    ["2500 iu"],
  );
  assert.deepEqual(
    extractSearchFormSignals("Jamieson Vitamin D3 1,000 IU: Tablets"),
    ["tablet"],
  );
  assert.deepEqual(
    extractSearchFormSignals("Vitamin D3 1,000 IU | Fast Dissolving"),
    ["fast_dissolving"],
  );
});

test("query identity bonus prefers exact Jamieson vitamin D siblings over same-family alternates", () => {
  const tabletTarget = {
    brandName: "Jamieson",
    title: "Vitamin D3 1,000 IU: Tablets",
  };
  const softgelSibling = {
    brandName: "Jamieson",
    title: "Vitamin D | Premium | 1,000 IU | Softgels",
  };
  const d2500Target = {
    brandName: "Jamieson",
    title: "Vitamin D3 2,500 IU",
  };

  assert.ok(
    computeSearchQueryIdentityBonus(
      tabletTarget,
      "Jamieson Vitamin D3 1,000 IU: Tablets",
    ) > computeSearchQueryIdentityBonus(
      softgelSibling,
      "Jamieson Vitamin D3 1,000 IU: Tablets",
    ),
  );

  assert.ok(
    computeSearchQueryIdentityBonus(
      d2500Target,
      "Jamieson Vitamin D3 2,500 IU",
    ) > computeSearchQueryIdentityBonus(
      softgelSibling,
      "Jamieson Vitamin D3 2,500 IU",
    ),
  );
});
