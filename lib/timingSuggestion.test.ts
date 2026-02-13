import assert from "node:assert/strict";
import test from "node:test";

import { buildTimingSuggestion, normalizeTimingText } from "./timingSuggestion";

test("normalizeTimingText: keeps time-first wording for meal guidance", () => {
  assert.equal(normalizeTimingText("With meals (morning or dinner)"), "Breakfast or dinner (with a meal)");
  assert.equal(normalizeTimingText("With meals"), "Anytime (with meals)");
  assert.equal(normalizeTimingText("Before meals"), "Anytime (before meals)");
});

test("buildTimingSuggestion: partial + missing label forces general source", () => {
  const out = buildTimingSuggestion({
    factsStatus: "partial",
    labelRawText: null,
    usageTiming: "With meals (morning or dinner)",
    factsTimingHint: null,
    fallbackTiming: "Anytime (with meals)",
    usageWithFood: true,
    factsWithMeals: null,
    fallbackWithFood: true,
    usageWithFoodReason: "label_says_with_meals",
    labelHasWithMealsSignal: false,
    activeNames: ["Omega-3"],
  });

  assert.equal(out.source, "general");
  assert.equal(out.text, "Breakfast or dinner");
  assert.equal(out.withFood, false);
  assert.notEqual(out.reasonKind, "label_says_with_meals");
});

test("buildTimingSuggestion: label-backed signals can emit label source", () => {
  const out = buildTimingSuggestion({
    factsStatus: "full",
    labelRawText: "Take with meals.",
    usageTiming: null,
    factsTimingHint: "With a meal",
    fallbackTiming: "Anytime (with meals)",
    usageWithFood: null,
    factsWithMeals: true,
    fallbackWithFood: true,
    usageWithFoodReason: "label_says_with_meals",
    labelHasWithMealsSignal: true,
    activeNames: [],
  });

  assert.equal(out.source, "label");
  assert.equal(out.reasonKind, "label_says_with_meals");
});

test("buildTimingSuggestion: final suggestion text never leaks legacy phrase", () => {
  const out = buildTimingSuggestion({
    factsStatus: "none",
    labelRawText: null,
    usageTiming: null,
    factsTimingHint: null,
    fallbackTiming: "With meals (morning or dinner)",
    usageWithFood: true,
    factsWithMeals: null,
    fallbackWithFood: true,
    usageWithFoodReason: null,
    labelHasWithMealsSignal: false,
    activeNames: [],
  });

  assert.equal(out.text.includes("With meals (morning or dinner)"), false);
  assert.equal(out.text, "Breakfast or dinner");
  assert.equal(out.withFood, false);
});

test("buildTimingSuggestion: general tip keeps meal text when reason has confidence", () => {
  const out = buildTimingSuggestion({
    factsStatus: "none",
    labelRawText: null,
    usageTiming: "Morning (with breakfast)",
    factsTimingHint: null,
    fallbackTiming: "Morning (with breakfast)",
    usageWithFood: true,
    factsWithMeals: null,
    fallbackWithFood: true,
    usageWithFoodReason: "fat_soluble",
    labelHasWithMealsSignal: false,
    activeNames: ["Vitamin D3"],
  });

  assert.equal(out.source, "general");
  assert.equal(out.withFood, true);
  assert.equal(out.text, "Morning (with breakfast)");
});
