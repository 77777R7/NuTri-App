import assert from "node:assert/strict";
import { test } from "node:test";

import { compileIngredientSummaryAsync } from "../dist/insights/summaryCompiler.js";

const packet = {
  locale: "en",
  ingredientName: "Vitamin D",
  facts: {
    amount: 25,
    unit: "mcg",
    formText: null,
  },
  insight: {
    rbfBand: "normal",
    rbfFactor: 1,
    confidenceTier: "medium",
    whyBullets: ["Dataset signal available."],
    doseStatus: "unknown",
  },
  reviewedKbBullets: ["Reviewed sentence."],
  odsBullets: [],
};

test("compileIngredientSummaryAsync returns LLM_OK when mock LLM returns valid JSON", async () => {
  const response = await compileIngredientSummaryAsync(packet, {
    maxRetries: 0,
    llmFn: async () =>
      JSON.stringify({
        tldr:
          "Vitamin D may help support bone and immune health. This product provides 25 mcg with label-based usage context. Product-specific warnings were not available in the official record.",
        highlights: ["Dataset indicates normal relative availability."],
        caveats: ["Individual response can vary by context."],
      }),
  });

  assert.equal(response.reasonCode, "LLM_OK");
  assert.equal(response.fallbackUsed, false);
  assert.equal(response.guardApplied, true);
  assert.equal(typeof response.summaryVersion, "string");
  assert.equal(typeof response.tldr, "string");
  assert.ok(response.tldr.length > 0);
});

test("compileIngredientSummaryAsync falls back when mock LLM returns non-JSON", async () => {
  const response = await compileIngredientSummaryAsync(packet, {
    maxRetries: 0,
    llmFn: async () => "hello world",
  });

  assert.equal(response.reasonCode, "LLM_PARSE_FAILED_NON_JSON");
  assert.equal(response.fallbackUsed, true);
  assert.equal(response.guardApplied, true);
  assert.ok(response.tldr.length > 0);
});
