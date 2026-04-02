import assert from "node:assert/strict";
import test from "node:test";

import {
  normalizeAllergenTextInputs,
  allergenNormalizationInternals,
} from "../src/allergy/allergenNormalization";
import { extractFromIherbOverlay } from "../src/allergy/extractFromIherbOverlay";
import { extractFromLnhpd } from "../src/allergy/extractFromLnhpd";

test("allergen normalization avoids milk thistle false positives", () => {
  const result = normalizeAllergenTextInputs([
    { source: "active_ingredient", text: "Milk Thistle Extract 250 mg" },
  ]);

  assert.deepEqual(result.allergyFlags, []);
  assert.deepEqual(result.ingredientRestrictions, []);
});

test("allergen normalization avoids gluten-free false positives", () => {
  const result = normalizeAllergenTextInputs([
    { source: "label_disclosure", text: "Gluten-free, dairy-free, soy-free." },
  ]);

  assert.deepEqual(result.allergyFlags, []);
  assert.deepEqual(result.ingredientRestrictions, []);
  assert.equal(result.coverageStatus, "partial");
});

test("lnhpd extractor finds medicinal fish and non-medicinal gelatin", () => {
  const result = extractFromLnhpd({
    lnhpdId: 123,
    factsJson: {
      medicinalIngredients: [
        { ingredient_name: "Fish oil" },
      ],
      nonMedicinalIngredients: [
        { nonmedicinal_ingredient_name: "Gelatin" },
      ],
    },
  });

  assert.deepEqual(result.allergyFlags, ["fish"]);
  assert.deepEqual(result.ingredientRestrictions, ["gelatin_animal_based"]);
  assert.equal(result.coverageStatus, "resolved");
});

test("iherb overlay extractor uses other ingredients and warnings", () => {
  const result = extractFromIherbOverlay({
    productId: "51870",
    supplementFacts: {
      nutritionalFacts: [
        { substancy: "N-Acetyl-L-Cysteine (free-form)" },
      ],
    },
    descriptionSections: {
      "Other ingredients": "Gelatin capsule, soy lecithin.",
      Warnings: "Contains fish-derived ingredients.",
    },
  });

  assert.deepEqual(result.allergyFlags, ["fish", "soy"]);
  assert.deepEqual(result.ingredientRestrictions, ["gelatin_animal_based"]);
  assert.ok(
    result.details.some((detail) => detail.flag === "fish" && detail.source === "warning"),
  );
});

test("allergen normalization internals expose stable canonical rule counts", () => {
  assert.equal(allergenNormalizationInternals.ALLERGY_RULES.length, 9);
  assert.equal(allergenNormalizationInternals.RESTRICTION_RULES.length, 2);
});
