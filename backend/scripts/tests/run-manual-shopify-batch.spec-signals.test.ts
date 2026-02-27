import assert from "node:assert/strict";
import { test } from "node:test";

import { extractSpecSignals } from "../run-manual-shopify-batch.ts";

test("extractSpecSignals: count captures pack and packs tokens", () => {
  const singlePack = extractSpecSignals("Bee Propolis 2 pack 500 mg");
  assert.equal(singlePack.count.has("2"), true);
  assert.equal(singlePack.strength.has("500mg"), true);

  const multiPack = extractSpecSignals("Vitamin C 3 packs 100 capsules");
  assert.equal(multiPack.count.has("3"), true);
  assert.equal(multiPack.count.has("100"), true);
});

test("extractSpecSignals: existing capsule count behavior stays intact", () => {
  const signals = extractSpecSignals("Magnesium 200 capsules");
  assert.equal(signals.count.has("200"), true);
});

test("extractSpecSignals: captures shorthand caps/tabs and compact sku tokens", () => {
  const shorthand = extractSpecSignals("Bee Propolis 100 caps / 60 tabs");
  assert.equal(shorthand.count.has("100"), true);
  assert.equal(shorthand.count.has("60"), true);

  const compactSku = extractSpecSignals("BP 2 PK 120 CT");
  assert.equal(compactSku.count.has("2"), true);
  assert.equal(compactSku.count.has("120"), true);
});
