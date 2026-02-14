import assert from "node:assert/strict";
import { test } from "node:test";

import { withEnrichStreamBoundedRetry } from "../../scripts/ci/enrich-stream-retry.mjs";

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

