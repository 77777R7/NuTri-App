import assert from "node:assert/strict";
import test from "node:test";

import {
  canonicalizeNonOdsKey,
  getNonOdsFactForSupplement,
} from "./non-ods-factpack";

test("non-ods factpack: canonicalization maps high-frequency ingredients", () => {
  assert.equal(canonicalizeNonOdsKey("Astaxanthin"), "astaxanthin");
  assert.equal(canonicalizeNonOdsKey("Ashwagandha Root"), "ashwagandha");
  assert.equal(canonicalizeNonOdsKey("Curcumin Complex"), "turmeric");
  assert.equal(canonicalizeNonOdsKey("Coenzyme Q10"), "coq10");
  assert.equal(canonicalizeNonOdsKey("Whey Protein Isolate"), "whey protein");
  assert.equal(canonicalizeNonOdsKey("Unknown Blend"), null);
});

test("non-ods factpack: supplement lookup hits astaxanthin and misses unknown", () => {
  const astaxanthinHit = getNonOdsFactForSupplement({
    activeNames: ["Astaxanthin"],
    productName: "Triple Strength Astaxanthin",
  });
  assert.equal(astaxanthinHit?.key, "astaxanthin");
  assert.ok((astaxanthinHit?.entry.whatItDoes ?? []).length >= 2);

  const miss = getNonOdsFactForSupplement({
    activeNames: ["Random Extract"],
    productName: "Unknown Formula",
  });
  assert.equal(miss, null);
});
