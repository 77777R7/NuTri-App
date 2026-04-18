import assert from "node:assert/strict";
import test from "node:test";

import {
  buildExecutableQueueRow,
  classifyProductKind,
  detectMissingCoreFields,
} from "../../scripts/maintainer/lib/full-db-api-fill-queue.mjs";

const brandSupportIndex = {
  officialConfigByBrand: new Map([
    ["swanson", { configPath: "data/iherb_official_fallback_configs/swanson.json", priorityLane: "P0_api_fill_us_strong_identity" }],
  ]),
  rapidApiByBrand: new Map([
    ["natrol", { brandSlug: "natrol" }],
  ]),
};

test("classifyProductKind keeps explicit supplement dosage forms in supplement-like", () => {
  const result = classifyProductKind({
    title: "Natrol Melatonin Gummies, 90 Gummies",
    categories: ["Supplements", "Sleep"],
    supplement_facts: {
      nutritionalFacts: [{ substancy: "Melatonin", amountPerServing: "5 mg" }],
    },
  });

  assert.equal(result.productKind, "supplement_like");
});

test("detectMissingCoreFields captures hard facts gaps", () => {
  const result = detectMissingCoreFields({
    title: "Mystery NAC Capsules",
    supplement_facts: { nutritionalFacts: [] },
    description_sections: { "Suggested Use": "Take 1 capsule daily.", Warnings: "Keep out of reach." },
    product_catalog_image: "https://example.com/a.jpg",
  });

  assert.deepEqual(result.coreMissingFields, ["ingredient", "dosage"]);
});

test("food-like bars route into route-honesty audit instead of supplement API fill", () => {
  const queueRow = buildExecutableQueueRow({
    row: {
      product_id: "1001",
      brand_name: "Barebells",
      title: "Protein Bar, Cookies & Cream",
      categories: ["Snacks", "Protein Bars"],
      supplement_facts: {
        nutritionalFacts: [{ substancy: "Protein", amountPerServing: "20 g" }],
      },
      description_sections: {},
      product_catalog_image: "https://example.com/bar.jpg",
    },
    brandSupportIndex,
  });

  assert.equal(queueRow.lane, "lane_c_food_like_route_honesty");
  assert.equal(queueRow.recommendedRunner, "route_honesty_audit_only");
});

test("pantry items like jam stay out of supplement API soft-field queue", () => {
  const queueRow = buildExecutableQueueRow({
    row: {
      product_id: "1005",
      brand_name: "Stonewall Kitchen",
      title: "Blueberry Rhubarb Jam, 12.25 oz",
      categories: ["Pantry", "Condiments"],
      supplement_facts: {
        nutritionalFacts: [{ substancy: "Sugars", amountPerServing: "10 g" }],
      },
      description_sections: { "Suggested Use": "Spread and enjoy." },
      product_catalog_image: "https://example.com/jam.jpg",
    },
    brandSupportIndex,
  });

  assert.equal(queueRow.lane, "lane_c_food_like_route_honesty");
});

test("supplement-like soft-field gaps stay executable and prefer official fallback when configured", () => {
  const queueRow = buildExecutableQueueRow({
    row: {
      product_id: "1002",
      brand_name: "Swanson",
      title: "Whey Protein Isolate Powder",
      categories: ["Supplements", "Protein"],
      supplement_facts: {
        nutritionalFacts: [{ substancy: "Protein", amountPerServing: "25 g" }],
      },
      description_sections: { Description: "Protein powder." },
      product_catalog_image: "https://example.com/whey.jpg",
    },
    brandSupportIndex,
  });

  assert.equal(queueRow.lane, "lane_b_soft_fields_supplement_like");
  assert.equal(queueRow.recommendedRunner, "refresh-iherb-overlay-p0-by-official-fallback");
  assert.deepEqual(queueRow.coreMissingFields, ["suggested_use", "warnings"]);
});

test("supplement-like hard facts gaps can route to RapidAPI when the brand is mapped", () => {
  const queueRow = buildExecutableQueueRow({
    row: {
      product_id: "1003",
      brand_name: "Natrol",
      title: "Vitamin D3, 60 Tablets",
      categories: ["Supplements", "Vitamin D"],
      supplement_facts: { nutritionalFacts: [] },
      description_sections: { Description: "Daily vitamin D." },
      product_catalog_image: "https://example.com/d3.jpg",
    },
    brandSupportIndex,
  });

  assert.equal(queueRow.lane, "lane_a_hard_facts");
  assert.equal(queueRow.recommendedRunner, "run-iherb-missing-brand-rapidapi-wave");
  assert.equal(queueRow.rapidApiBrandSlug, "natrol");
});

test("parser-like partial facts do not get mislabeled as API hard-facts queue", () => {
  const queueRow = buildExecutableQueueRow({
    row: {
      product_id: "1004",
      brand_name: "Swanson",
      title: "Mystery Formula, 90 Capsules",
      categories: ["Supplements"],
      supplement_facts: {
        nutritionalFacts: [{ substancy: "Mystery Formula", amountPerServing: "" }],
      },
      description_sections: { "Suggested Use": "Take 1 capsule daily.", Warnings: "Keep out of reach." },
      product_catalog_image: "https://example.com/mystery.jpg",
    },
    brandSupportIndex,
  });

  assert.equal(queueRow, null);
});
