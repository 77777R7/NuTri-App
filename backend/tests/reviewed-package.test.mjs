import assert from "node:assert/strict";
import { test } from "node:test";

import { getReviewedFormExplain } from "../dist/insights/reviewedPackage.js";

test("reviewed package returns calcium citrate entry", () => {
  const entry = getReviewedFormExplain("calcium", "citrate", "en");
  assert.ok(entry, "expected calcium|citrate entry");
  assert.equal(entry?.ingredientId, "calcium");
  assert.equal(entry?.formKey, "citrate");

  const segmentCount =
    (entry?.segments.absorption?.length ?? 0) +
    (entry?.segments.solubility?.length ?? 0) +
    (entry?.segments.tolerability?.length ?? 0) +
    (entry?.segments.caveats?.length ?? 0);
  assert.ok(segmentCount >= 1, "expected at least one reviewed segment");
});

test("reviewed package returns null for unknown form key", () => {
  const entry = getReviewedFormExplain("calcium", "__not_exist__", "en");
  assert.equal(entry, null);
});

test("reviewed package meta includes sha256", () => {
  const entry = getReviewedFormExplain("calcium", "citrate", "en");
  assert.ok(entry?.meta.packageSha256);
  assert.equal(entry?.meta.packageSha256.length, 64);
});
