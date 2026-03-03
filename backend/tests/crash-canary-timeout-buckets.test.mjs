import test from "node:test";
import assert from "node:assert/strict";

import { classifyCrashCanaryTimeoutBucket } from "../../scripts/maintainer/lib/crash-canary-timeout-bucket.mjs";

test("classifies timeout without SSE events as sse_not_connected", () => {
  const bucket = classifyCrashCanaryTimeoutBucket({
    terminal: "CLIENT_TIMEOUT",
    lastSseEventType: null,
    rev1Ms: null,
    doneMs: null,
  });
  assert.equal(bucket, "sse_not_connected");
});

test("classifies timeout with SSE event but no rev1 as sse_connected_no_done", () => {
  const bucket = classifyCrashCanaryTimeoutBucket({
    terminal: "CLIENT_TIMEOUT",
    lastSseEventType: "keepalive",
    rev1Ms: null,
    doneMs: null,
  });
  assert.equal(bucket, "sse_connected_no_done");
});

test("classifies timeout after rev1 as done_late", () => {
  const bucket = classifyCrashCanaryTimeoutBucket({
    terminal: "CLIENT_TIMEOUT",
    lastSseEventType: "analysis_bundle",
    rev1Ms: 2200,
    doneMs: null,
  });
  assert.equal(bucket, "done_late");
});

test("returns null for non-timeout terminal", () => {
  const bucket = classifyCrashCanaryTimeoutBucket({
    terminal: "DONE",
    lastSseEventType: "done",
    rev1Ms: 100,
    doneMs: 120,
  });
  assert.equal(bucket, null);
});

