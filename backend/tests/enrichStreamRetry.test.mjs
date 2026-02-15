import assert from "node:assert/strict";
import { test } from "node:test";

import {
  collectEnrichStreamErrorStrings,
  collectEnrichStreamSeenStatuses,
  computeEnrichStreamRetryTotal,
  withEnrichStreamBoundedRetry,
} from "../../scripts/ci/enrich-stream-retry.mjs";

test("withEnrichStreamBoundedRetry counts retryable HTTP statuses and surfaces audit fields on failure", async () => {
  const sleepFn = async () => {};

  // Recovers within the retry budget.
  {
    const statuses = [503, 503, 200];
    let idx = 0;
    const fn = async () => {
      const status = statuses[idx++];
      if (status === 200) return "ok";
      const err = new Error(`enrich-stream HTTP ${status}`);
      err.httpStatus = status;
      throw err;
    };

    const res = await withEnrichStreamBoundedRetry(fn, { sleepFn });
    assert.equal(res.value, "ok");
    assert.equal(res.retryCount, 2);
    assert.deepEqual(res.seen5xxStatuses, [503, 503]);
  }

  // Exhausts retries and keeps auditable counters on the thrown error.
  {
    const fn = async () => {
      const err = new Error("enrich-stream HTTP 503");
      err.httpStatus = 503;
      throw err;
    };

    await assert.rejects(
      () => withEnrichStreamBoundedRetry(fn, { sleepFn }),
      (err) => {
        assert.equal(err.enrichStreamRetryCount, 2);
        assert.deepEqual(err.enrichStreamSeen5xxStatuses, [503, 503]);
        return true;
      },
    );
  }
});

test("computeEnrichStreamRetryTotal sums retries across attempts without double-counting the successful fallback", () => {
  // Fallback succeeded: fallbackAttempts includes primary + successful fallback.
  {
    const summary = {
      primaryBarcode: "p",
      usedBarcode: "f",
      enrichStreamRetryCount: 2, // current attempt (fallback)
      fallbackAttempts: [
        { barcode: "p", enrichStreamRetryCount: 0 },
        { barcode: "f", enrichStreamRetryCount: 2 },
      ],
    };
    assert.equal(computeEnrichStreamRetryTotal(summary), 2);
  }

  // All failed: summary is primary attempt, fallbackAttempts excludes primary.
  {
    const summary = {
      primaryBarcode: "p",
      usedBarcode: "p",
      enrichStreamRetryCount: 1,
      fallbackAttempts: [{ barcode: "f", enrichStreamRetryCount: 2 }],
    };
    assert.equal(computeEnrichStreamRetryTotal(summary), 3);
  }
});

test("collectEnrichStreamSeenStatuses + collectEnrichStreamErrorStrings include fallback attempts", () => {
  const summary = {
    enrichStreamSeen5xxStatuses: [503],
    errors: ["exception: Error: enrich-stream HTTP 503"],
    fallbackAttempts: [
      {
        barcode: "f",
        enrichStreamSeen5xxStatuses: [503, 503],
        errors: ["exception: Error: enrich-stream HTTP 503"],
      },
    ],
  };
  assert.deepEqual(collectEnrichStreamSeenStatuses(summary), [503, 503, 503]);
  assert.equal(collectEnrichStreamErrorStrings(summary).length, 2);
});
