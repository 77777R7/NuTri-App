import assert from "node:assert/strict";
import test from "node:test";

import { compileIngredientSummaryAsync } from "../dist/insights/summaryCompiler.js";

const packet = {
  locale: "en",
  viewMode: "simple",
  ingredientName: "Vitamin D",
  facts: {
    amount: 25,
    unit: "mcg",
    formText: null,
  },
  directionsText: "Adults: 1 tablet once daily",
  supportBullets: ["Vitamin D may help support bone health."],
  missingHighImpact: ["label warnings"],
  insight: {
    rbfBand: "normal",
    rbfFactor: 1,
    confidenceTier: "medium",
    whyBullets: ["General support context available."],
    doseStatus: "unknown",
  },
  reviewedKbBullets: [],
  odsBullets: [],
};

const sentenceCount = (text) =>
  String(text)
    .split(/(?<=[.!?])\s+/)
    .map((line) => line.trim())
    .filter(Boolean).length;

test("ingredient summary enforces three-sentence simple contract", async () => {
  const response = await compileIngredientSummaryAsync(packet, {
    maxRetries: 0,
    llmFn: async () =>
      JSON.stringify({
        tldr:
          "Vitamin D may help support bone health. This product provides 25 mcg with directions to take one tablet daily. Product-specific warnings were not available in the official record.",
        highlights: ["General support context is available."],
        caveats: ["This summary is informational and not medical advice."],
      }),
  });

  assert.equal(response.reasonCode, "LLM_OK");
  assert.equal(response.guardApplied, true);
  assert.equal(response.fallbackUsed, false);
  assert.equal(response.summaryVersion, "v1.6.12-simple-1");
  assert.equal(sentenceCount(response.tldr), 3);
});

test("ingredient summary falls back when technical leakage appears", async () => {
  const response = await compileIngredientSummaryAsync(packet, {
    maxRetries: 0,
    llmFn: async () =>
      JSON.stringify({
        tldr:
          "Vitamin D summary with RBF 0.92 and match score 0.40. This product provides 25 mcg. Product-specific warnings were not available.",
        highlights: ["RBF normal band"],
        caveats: ["Confidence tier medium"],
      }),
  });

  assert.equal(response.fallbackUsed, true);
  assert.equal(response.guardApplied, true);
  assert.equal(response.summaryVersion, "v1.6.12-simple-1");
  assert.equal(sentenceCount(response.tldr), 3);
});

test("ingredient summary falls back when fluff phrasing appears", async () => {
  const response = await compileIngredientSummaryAsync(packet, {
    maxRetries: 0,
    llmFn: async () =>
      JSON.stringify({
        tldr:
          "Vitamin D may help support normal function. This product provides 25 mcg. Product-specific warnings were not available in the official record.",
        highlights: ["Supports day-to-day wellness outcomes."],
        caveats: ["Informational only."],
      }),
  });

  assert.equal(response.fallbackUsed, true);
  assert.equal(response.guardApplied, true);
  assert.equal(response.summaryVersion, "v1.6.12-simple-1");
  assert.equal(sentenceCount(response.tldr), 3);
});
