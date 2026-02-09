import assert from "node:assert/strict";
import { test } from "node:test";

import { buildRuleBasedOverview } from "../dist/overviewRuleBased.js";

const countSentences = (value) => {
  const text = String(value ?? "").trim();
  if (!text) return 0;
  return text.split(/(?<=[.!?])\s+/).map((s) => s.trim()).filter(Boolean).length;
};

test("Rule-based overview: probiotic => empty stomach + 2-sentence summary", () => {
  const out = buildRuleBasedOverview({ productName: "Proprietary Probiotic Blend", dosageText: "50 mg" });
  assert.equal(typeof out.withFood, "boolean");
  assert.equal(out.withFood, false);
  assert.ok(out.timing.toLowerCase().includes("morning"));
  assert.equal(countSentences(out.overviewSummary), 2);
  assert.ok(Array.isArray(out.coreBenefits));
  assert.ok(out.coreBenefits.length >= 1);
  assert.equal(out.usageSummary, "Take on an empty stomach.");
});

test("Rule-based overview: vitamin B1 => with food + 2-sentence summary", () => {
  const out = buildRuleBasedOverview({ productName: "Vitamin B1", dosageText: "100 mg" });
  assert.equal(out.withFood, true);
  assert.equal(countSentences(out.overviewSummary), 2);
  assert.ok(out.coreBenefits.length >= 1);
  assert.equal(out.usageSummary, "Take with food.");
});

test("Rule-based overview: unknown product still returns stable fields", () => {
  const out = buildRuleBasedOverview({ productName: "Mystery Formula", dosageText: null });
  assert.equal(typeof out.withFood, "boolean");
  assert.equal(countSentences(out.overviewSummary), 2);
  assert.ok(out.coreBenefits.length >= 1);
  assert.ok(out.timing.length > 0);
  assert.equal(out.usageSummary, out.withFood ? "Take with food." : "Take on an empty stomach.");
});

