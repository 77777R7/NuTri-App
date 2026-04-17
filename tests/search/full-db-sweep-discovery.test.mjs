import assert from "node:assert/strict";
import test from "node:test";
import {
  classifyDiscoveryBuckets,
  classifyDiscoveryLane,
  summarizeDiscoveryRows,
} from "../../scripts/maintainer/lib/full-db-sweep-discovery.mjs";

test("full DB sweep discovery classifies the highest-priority taxonomy lanes from title signals", () => {
  assert.equal(classifyDiscoveryLane({ title: "Krill Oil Omega-3" }), "omega3_source_oil");
  assert.equal(classifyDiscoveryLane({ title: "Floraphage Probiotic" }), "probiotic_microbiome");
  assert.equal(classifyDiscoveryLane({ title: "Melatonin Sleep Support" }), "sleep_amino");
  assert.equal(classifyDiscoveryLane({ title: "Calcium Magnesium Zinc" }), "mineral_stack");
  assert.equal(classifyDiscoveryLane({ title: "Protein Cookie" }), "food_like");
  assert.equal(classifyDiscoveryLane({ title: "Ashwagandha Extract" }), "unclassified");
  assert.equal(classifyDiscoveryLane({ title: "Mystery Daily Support" }), "unclassified");
});

test("full DB sweep discovery detects sparse, source-risk, and trade-name buckets from title and facts shape", () => {
  assert.deepEqual(
    classifyDiscoveryBuckets({
      title: "BioGaia, Protectis Baby, Immune Active Probiotic Drops",
      supplement_facts: { nutritionalFacts: [] },
    }),
    ["facts_zero", "probiotic_trade_name"],
  );

  assert.deepEqual(
    classifyDiscoveryBuckets({
      title: "Solaray, Matcha Green Tea, 300 mg, 100 VegCaps",
      supplement_facts: {
        nutritionalFacts: [{ substancy: "Matcha Green Tea", amountPerServing: "300 mg" }],
      },
    }),
    ["facts_short_1_3", "stimulant_matcha_green_tea"],
  );

  assert.deepEqual(
    classifyDiscoveryBuckets({
      title: "21st Century, Calcium Magnesium Zinc + D3, 250 Tablets",
      supplement_facts: {
        nutritionalFacts: [
          { substancy: "Calcium", amountPerServing: "1000 mg" },
          { substancy: "Magnesium", amountPerServing: "400 mg" },
          { substancy: "Zinc", amountPerServing: "15 mg" },
          { substancy: "Vitamin D3", amountPerServing: "10 mcg" },
          { substancy: "Copper", amountPerServing: "1 mg" },
        ],
      },
    }),
    ["duplicate_stack_cal_mag", "duplicate_stack_zinc_d"],
  );
});

test("full DB sweep discovery summary counts rows by lane and bucket and keeps representative examples", () => {
  const summary = summarizeDiscoveryRows([
    {
      product_id: "1",
      title: "BioGaia, Protectis Baby, Immune Active Probiotic Drops",
      brand_name: "BioGaia",
      supplement_facts: { nutritionalFacts: [] },
    },
    {
      product_id: "2",
      title: "Solaray, Matcha Green Tea, 300 mg, 100 VegCaps",
      brand_name: "Solaray",
      supplement_facts: { nutritionalFacts: [{ substancy: "Matcha Green Tea" }] },
    },
    {
      product_id: "3",
      title: "Barlean's, Plant Based Omega-3 From Algae Oil",
      brand_name: "Barlean's",
      supplement_facts: { nutritionalFacts: [{ substancy: "DHA" }] },
    },
    {
      product_id: "4",
      title: "21st Century, Calcium Magnesium Zinc + D3, 250 Tablets",
      brand_name: "21st Century",
      supplement_facts: {
        nutritionalFacts: [
          { substancy: "Calcium" },
          { substancy: "Magnesium" },
          { substancy: "Zinc" },
          { substancy: "Vitamin D3" },
          { substancy: "Copper" },
        ],
      },
    },
  ]);

  assert.equal(summary.total, 4);
  assert.equal(summary.lanes.probiotic_microbiome.count, 1);
  assert.equal(summary.lanes.omega3_source_oil.count, 1);
  assert.equal(summary.lanes.food_like, undefined);
  assert.equal(summary.buckets.facts_zero.count, 1);
  assert.equal(summary.buckets.facts_short_1_3.count, 2);
  assert.equal(summary.buckets.probiotic_trade_name.count, 1);
  assert.equal(summary.buckets.stimulant_matcha_green_tea.count, 1);
  assert.equal(summary.buckets.omega_algal_source.count, 1);
  assert.equal(summary.buckets.duplicate_stack_cal_mag.count, 1);
  assert.equal(summary.buckets.duplicate_stack_zinc_d.count, 1);
  assert.equal(summary.lanes.probiotic_microbiome.count, 1);
  assert.ok(summary.buckets.probiotic_trade_name.examples.length > 0);
  assert.ok(summary.lanes.omega3_source_oil.examples.length > 0);
});
