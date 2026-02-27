import assert from "node:assert/strict";
import { test } from "node:test";

import {
  classifyUlRisk,
  convertDoseToUlUnit,
  formatDoseText,
  lookupUlByCanonicalKey,
} from "../dist/ods/ulDataset.js";

test("convertDoseToUlUnit converts vitamin D IU to mcg with alt unit mapping", () => {
  const converted = convertDoseToUlUnit({
    amount: 4000,
    fromUnit: "IU",
    targetUnit: "mcg",
    altUnits: [{ unit: "iu", factor: 40, direction: "mcg->iu" }],
  });
  assert.equal(converted.ok, true);
  assert.equal(converted.reasonCode, "ALT_UNIT_CONVERTED");
  assert.equal(Math.round((converted.value ?? 0) * 1000) / 1000, 100);
});

test("convertDoseToUlUnit mass conversion works across mg and mcg", () => {
  const converted = convertDoseToUlUnit({
    amount: 1,
    fromUnit: "mg",
    targetUnit: "mcg",
  });
  assert.equal(converted.ok, true);
  assert.equal(converted.reasonCode, "MASS_UNIT_CONVERTED");
  assert.equal(converted.value, 1000);
});

test("classifyUlRisk returns expected buckets", () => {
  assert.equal(classifyUlRisk(0.5), "low");
  assert.equal(classifyUlRisk(1.05), "moderate");
  assert.equal(classifyUlRisk(1.25), "high");
});

test("formatDoseText keeps IU uppercase", () => {
  assert.equal(formatDoseText(4000, "iu"), "4000 IU");
});

test("lookupUlByCanonicalKey resolves high-frequency vitamin aliases", () => {
  const vitaminD = lookupUlByCanonicalKey("cholecalciferol");
  const vitaminC = lookupUlByCanonicalKey("ascorbic_acid");
  assert.equal(vitaminD?.ingredientCanonicalKey, "vitamin_d");
  assert.equal(vitaminC?.ingredientCanonicalKey, "vitamin_c");
});
