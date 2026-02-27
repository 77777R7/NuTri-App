import assert from "node:assert/strict";
import test from "node:test";

import { resolveBrand, sanitizeBrandCandidate } from "./resolveBrand";

test("resolveBrand: prefers AI extraction (high/medium) over candidates", () => {
  const next = resolveBrand(
    { brand: "Sports Research", confidence: "high", source: "ai" },
    "Fallback Brand",
  );
  assert.equal(next, "Sports Research");
});

test("resolveBrand: does not blindly trust rule extraction when it looks like a DBA group list", () => {
  const extracted =
    "Nestle Canada Inc dba Atrium Innovations Genestra Brands Pure Encapsulations Garden of Life Canada Trophic Canada";
  const next = resolveBrand(
    { brand: extracted, confidence: "high", source: "rule" },
    "Ester-C",
  );
  assert.equal(next, "Ester-C");
});

test("resolveBrand: ignores noisy marketplace-like rule extraction and falls back to candidate brand", () => {
  const next = resolveBrand(
    {
      brand: "10 BOTTLES), Ester-C Vitamin C 1000mg (180 Tablets), Exp ... - eBay",
      confidence: "high",
      source: "rule",
    },
    "American Health",
  );
  assert.equal(next, "American Health");
});

test("resolveBrand: allows rule extraction when it is short and sane", () => {
  const next = resolveBrand(
    { brand: "Sports Research", confidence: "high", source: "rule" },
    "Fallback Brand",
  );
  assert.equal(next, "Sports Research");
});

test("sanitizeBrandCandidate: collapses obvious separators", () => {
  assert.equal(sanitizeBrandCandidate("Foo | Bar"), "Foo");
  assert.equal(sanitizeBrandCandidate("Foo - Bar"), "Foo");
  assert.equal(sanitizeBrandCandidate("  "), null);
});
