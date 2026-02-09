import assert from "node:assert/strict";
import { test } from "node:test";

import { buildRuleBasedOverview } from "../dist/overviewRuleBased.js";

const countSentences = (text) => {
  if (typeof text !== "string") return 0;
  const matches = text.trim().match(/[.!?](\s|$)/g);
  return matches ? matches.length : 0;
};

test("Rule-based overview: probiotic => empty stomach + morning", () => {
  const overview = buildRuleBasedOverview({ productName: "Probiotic Blend", dosageText: "50 mg" });
  assert.equal(typeof overview.withFood, "boolean");
  assert.equal(overview.withFood, false);
  assert.ok(String(overview.timing || "").toLowerCase().includes("morning"));
  assert.equal(countSentences(overview.overviewSummary), 2);
});

test("Rule-based overview: vitamin B1 => with food", () => {
  const overview = buildRuleBasedOverview({ productName: "Vitamin B1", dosageText: "100 mg" });
  assert.equal(typeof overview.withFood, "boolean");
  assert.equal(overview.withFood, true);
  assert.equal(countSentences(overview.overviewSummary), 2);
});

test("Rule-based overview: unknown product still returns two sentences + boolean withFood", () => {
  const overview = buildRuleBasedOverview({ productName: "Mystery Product", dosageText: null });
  assert.equal(typeof overview.withFood, "boolean");
  assert.ok(Array.isArray(overview.coreBenefits));
  assert.ok(overview.coreBenefits.length >= 1);
  assert.equal(countSentences(overview.overviewSummary), 2);
});

