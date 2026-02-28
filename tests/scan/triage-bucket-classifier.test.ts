import assert from "node:assert/strict";
import test from "node:test";

import { classifyCohortBuckets, classifyTraceBucket } from "../../scripts/maintainer/lib/cohort-bucket-classifier.mjs";

test("classifyTraceBucket maps timeout rows to timeout buckets", () => {
  const bucket = classifyTraceBucket({
    terminal: "CLIENT_TIMEOUT",
    timeoutBucket: "sse_connected_no_done",
    sourceTypeFinal: false,
  });
  assert.equal(bucket, "SSE_CONNECTED_NO_DONE");
});

test("classifyCohortBuckets detects NONDETERMINISTIC_SAME_BARCODE via stability hash fan-out", () => {
  const rows = [
    {
      barcode: "00064642059000",
      role: "canary_crash",
      stabilityHash: "lnhpd|true|DONE|npn|80015041",
      terminal: "DONE",
      terminalReason: "OK",
      sourceTypeFinal: true,
    },
    {
      barcode: "00064642059000",
      role: "canary_crash",
      stabilityHash: "web|false|CLIENT_TIMEOUT|gtin14|00064642059000",
      terminal: "CLIENT_TIMEOUT",
      timeoutBucket: "done_late",
      terminalReason: "CLIENT_TIMEOUT",
      sourceTypeFinal: false,
    },
  ];
  const classified = classifyCohortBuckets(rows);
  assert.equal(classified.nondeterministicBarcodes.length, 1);
  assert.equal(classified.nondeterministicBarcodes[0], "00064642059000");
  assert.equal(classified.bucketCounts.NONDETERMINISTIC_SAME_BARCODE, 1);
});
