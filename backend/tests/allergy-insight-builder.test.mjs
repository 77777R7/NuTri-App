import assert from "node:assert/strict";
import test from "node:test";

import { buildAllergyInsight } from "../src/allergy/allergyInsightBuilder";

test("allergy insight reports matches when user settings conflict with product flags", () => {
  const insight = buildAllergyInsight({
    userAllergyFlags: ["fish"],
    userIngredientRestrictions: ["gelatin_animal_based"],
    productAllergyFlags: ["fish", "soy"],
    productIngredientRestrictions: ["gelatin_animal_based"],
    productCoverageStatus: "resolved",
    productDetails: [
      {
        flag: "fish",
        source: "active_ingredient",
        matchedText: "Fish oil",
        confidence: "high",
      },
      {
        flag: "gelatin_animal_based",
        source: "inactive_ingredient",
        matchedText: "Gelatin capsule",
        confidence: "high",
      },
    ],
  });

  assert.equal(insight.status, "ready");
  assert.equal(insight.reasonCode, null);
  assert.equal(insight.summary, "May conflict with your allergy settings.");
  assert.deepEqual(insight.matchedAllergyFlags, ["fish"]);
  assert.deepEqual(insight.matchedRestrictions, ["gelatin_animal_based"]);
  assert.equal(insight.details.length, 2);
});

test("allergy insight returns unknown-style summary when product coverage is insufficient", () => {
  const insight = buildAllergyInsight({
    userAllergyFlags: ["soy"],
    userIngredientRestrictions: [],
    productAllergyFlags: [],
    productIngredientRestrictions: [],
    productCoverageStatus: "insufficient",
    productDetails: [],
  });

  assert.equal(insight.status, "ready");
  assert.equal(insight.summary, "Needs more label detail to confirm.");
});

test("allergy insight reports unsaved profile settings cleanly", () => {
  const insight = buildAllergyInsight({
    userAllergyFlags: [],
    userIngredientRestrictions: [],
  });

  assert.equal(insight.status, "ready");
  assert.equal(insight.summary, "No allergy or restriction settings saved yet.");
});
