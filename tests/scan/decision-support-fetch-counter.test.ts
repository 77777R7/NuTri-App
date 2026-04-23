import assert from "node:assert/strict";
import test from "node:test";

import { createDecisionSupportFetchCounter } from "../../backend/src/decisionSupportFetchCounter.js";

test("decision support fetch counter counts per scan session and barcode", () => {
  let refetchCount = 0;
  const counter = createDecisionSupportFetchCounter({
    now: () => 1000,
    onRefetch: () => {
      refetchCount += 1;
    },
  });

  assert.equal(counter.record(null, "000646"), null);
  assert.equal(counter.record("scan-a", "000646"), 1);
  assert.equal(counter.record("scan-a", "000646"), 2);
  assert.equal(counter.record("scan-a", "000647"), 1);
  assert.equal(refetchCount, 1);
});

test("decision support fetch counter prunes stale scan sessions", () => {
  let currentTime = 1000;
  const counter = createDecisionSupportFetchCounter({
    windowMs: 100,
    now: () => currentTime,
  });

  assert.equal(counter.record("scan-a", "000646"), 1);
  currentTime = 1200;
  assert.equal(counter.record("scan-a", "000646"), 1);
});

