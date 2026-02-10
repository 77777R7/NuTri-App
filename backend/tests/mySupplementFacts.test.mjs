import assert from "node:assert/strict";
import { test } from "node:test";

import { parseLabelDirectionsV1 } from "../dist/mySupplementFacts.js";

test("MySupplementFacts: parseLabelDirectionsV1 parses count + frequency", () => {
  const out = parseLabelDirectionsV1("Adults: 1 tablet, 2 times daily");
  assert.equal(out.parsed.perDoseCount, 1);
  assert.equal(out.parsed.countUnit, "tablet");
  assert.equal(out.parsed.timesPerDay, 2);
  assert.ok(out.parseConfidence > 0.5);
});

test("MySupplementFacts: parseLabelDirectionsV1 detects meal hints", () => {
  const out = parseLabelDirectionsV1("Take 2 capsules twice daily with meals");
  assert.equal(out.parsed.perDoseCount, 2);
  assert.equal(out.parsed.countUnit, "capsule");
  assert.equal(out.parsed.timesPerDay, 2);
  assert.equal(out.parsed.withMeals, true);
  assert.ok(out.parsed.timingHints.includes("with_meals"));
});

