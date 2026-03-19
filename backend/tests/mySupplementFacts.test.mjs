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

test("MySupplementFacts: parseLabelDirectionsV1 treats simple daily directions as once per day", () => {
  const out = parseLabelDirectionsV1("Take 1 capsule daily with breakfast");
  assert.equal(out.parsed.perDoseCount, 1);
  assert.equal(out.parsed.countUnit, "capsule");
  assert.equal(out.parsed.timesPerDay, 1);
  assert.ok(out.parseConfidence > 0.5);
});

test("MySupplementFacts: parseLabelDirectionsV1 keeps ranged daily frequency conservative", () => {
  const out = parseLabelDirectionsV1("Adults take 1 capsule 1-2 times daily");
  assert.equal(out.parsed.perDoseCount, 1);
  assert.equal(out.parsed.countUnit, "capsule");
  assert.equal(out.parsed.timesPerDay, 1);
});

test("MySupplementFacts: parseLabelDirectionsV1 recognizes twice a day wording", () => {
  const out = parseLabelDirectionsV1("Take 1 softgel twice a day");
  assert.equal(out.parsed.perDoseCount, 1);
  assert.equal(out.parsed.countUnit, "softgel");
  assert.equal(out.parsed.timesPerDay, 2);
});
