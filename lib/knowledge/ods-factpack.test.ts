import assert from "node:assert/strict";
import test from "node:test";
import packData from "./ods-factpack.json";

import {
  canonicalizeKnowledgeKey,
  getOdsFactByKey,
  getOdsFactForSupplement,
  getOdsFactPackMeta,
} from "./ods-factpack";

test("ods factpack: canonical keys map consistently", () => {
  assert.equal(canonicalizeKnowledgeKey("Eicosapentaenoic Acid"), "omega-3");
  assert.equal(canonicalizeKnowledgeKey("Fish–Oil"), "omega-3");
  assert.equal(canonicalizeKnowledgeKey("Cholecalciferol"), "vitamin d");
  assert.equal(canonicalizeKnowledgeKey("Vitamin‑D3®"), "vitamin d");
  assert.equal(canonicalizeKnowledgeKey("Ester-C"), "vitamin c");
  assert.equal(canonicalizeKnowledgeKey("Ester‑C"), "vitamin c");
  assert.equal(canonicalizeKnowledgeKey("NAC"), "nac");
  assert.equal(canonicalizeKnowledgeKey("Methylcobalamin"), "vitamin b12");
  assert.equal(canonicalizeKnowledgeKey("Pyridoxine HCl"), "vitamin b6");
  assert.equal(canonicalizeKnowledgeKey("Vitamin B5"), "pantothenic acid");
  assert.equal(canonicalizeKnowledgeKey("Choline"), "choline");
  assert.equal(canonicalizeKnowledgeKey("Chromium (picolinate)"), "chromium");
  assert.equal(canonicalizeKnowledgeKey("Copper (gluconate)"), "copper");
  assert.equal(canonicalizeKnowledgeKey("Manganese (citrate)"), "manganese");
  assert.equal(canonicalizeKnowledgeKey("Phosphorus"), "phosphorus");
  assert.equal(canonicalizeKnowledgeKey("Folic Acid"), "folate");
  assert.equal(canonicalizeKnowledgeKey("Vitamin K2"), "vitamin k");
  assert.equal(canonicalizeKnowledgeKey("Vitamin B3 (Niacinamide)"), "niacin");
});

test("ods factpack: pack meta and key lookup are stable", () => {
  const meta = getOdsFactPackMeta();
  assert.ok(meta.packVersion.length > 0);
  assert.ok(meta.updatedAt.length > 0);

  const vitaminC = getOdsFactByKey("vitamin c");
  assert.ok(vitaminC);
  assert.ok(Array.isArray(vitaminC?.whatItDoes));
  const entries = Object.keys((packData as { entries: Record<string, unknown> }).entries ?? {});
  assert.ok(entries.length >= 27, `Expected at least 27 ODS entries, received ${entries.length}`);
});

test("ods factpack: supplement lookup uses actives first then product name", () => {
  const byActives = getOdsFactForSupplement({
    activeNames: ["Ascorbic Acid"],
    productName: "Unknown Product",
  });
  assert.equal(byActives?.key, "vitamin c");
  assert.equal(byActives?.displayTitle, "About Vitamin C (NIH ODS)");
  assert.equal(typeof byActives?.qualityRejected, "boolean");

  const byName = getOdsFactForSupplement({
    activeNames: [],
    productName: "Omega-3 Fish Oil",
  });
  assert.equal(byName?.key, "omega-3");
  assert.equal(byName?.displayTitle, "About Omega-3 (NIH ODS)");
  assert.equal(typeof byName?.qualityRejected, "boolean");

  const miss = getOdsFactForSupplement({
    activeNames: ["Random Botanical"],
    productName: "Unknown Blend",
  });
  assert.equal(miss, null);
});

test("ods factpack: low-quality overview falls back away from covid/nav text", () => {
  const vitaminD = getOdsFactByKey("vitamin d");
  assert.ok(vitaminD);
  assert.ok(!/covid-19/i.test(vitaminD?.overview ?? ""));

  const omega = getOdsFactForSupplement({
    activeNames: ["Omega-3"],
    productName: "Omega-3 Fish Oil",
  });
  assert.ok(omega);
  assert.ok(!/\?$/.test(omega?.entry.overview ?? ""));
  assert.ok(!/^what\s+(is|are)\b/i.test(omega?.entry.overview ?? ""));
});

test("ods factpack: expanded core ingredient keys resolve", () => {
  const keyInputs = [
    ["Vitamin B12", "vitamin b12"],
    ["Vitamin B6", "vitamin b6"],
    ["Pantothenic acid", "pantothenic acid"],
    ["Choline", "choline"],
    ["Chromium", "chromium"],
    ["Copper", "copper"],
    ["Manganese", "manganese"],
    ["Phosphorus", "phosphorus"],
    ["Calcium carbonate", "calcium"],
    ["Folate", "folate"],
    ["Potassium citrate", "potassium"],
    ["Selenium", "selenium"],
    ["Iodide", "iodine"],
    ["Retinol (Vitamin A)", "vitamin a"],
    ["Alpha-tocopherol", "vitamin e"],
    ["Vitamin K1", "vitamin k"],
    ["Niacinamide", "niacin"],
    ["Thiamine", "thiamin"],
    ["Riboflavin", "riboflavin"],
    ["Biotin", "biotin"],
  ] as const;

  for (const [input, expectedKey] of keyInputs) {
    assert.equal(canonicalizeKnowledgeKey(input), expectedKey, `input=${input}`);
    const entry = getOdsFactByKey(expectedKey);
    assert.ok(entry, `missing ods entry for ${expectedKey}`);
  }
});
