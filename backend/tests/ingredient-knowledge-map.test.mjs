import assert from "node:assert/strict";
import { test } from "node:test";

import { getIngredientFallbackText } from "../dist/insights/ingredientKnowledgeMap.js";

test("ingredient knowledge map returns specific copy for known ingredients", () => {
  const vitaminD = getIngredientFallbackText("Vitamin D3");
  assert.match(vitaminD, /immune|bone/i);
  assert.doesNotMatch(vitaminD, /not provided by source/i);
});

test("ingredient knowledge map returns safe generic copy for unknown ingredients", () => {
  const unknown = getIngredientFallbackText("mystery botanical 123");
  assert.equal(
    unknown,
    "A common supplement ingredient. Scan Supplement Facts for specific analysis.",
  );
  assert.doesNotMatch(unknown, /not provided by source/i);
});

test("ingredient knowledge map includes alpha lipoic acid coverage", () => {
  const ala = getIngredientFallbackText("Alpha Lipoic Acid");
  assert.match(ala, /antioxidant|energy/i);
  assert.doesNotMatch(ala, /not provided by source/i);
});
