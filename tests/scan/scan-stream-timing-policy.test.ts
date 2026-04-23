import assert from "node:assert/strict";
import test from "node:test";

import {
  DEFAULT_FULL_REV1_DONE_DELAY_MS,
  resolveScanStreamRev1DonePolicy,
  toNonNegativeDelayMs,
} from "../../backend/src/scanStreamTimingPolicy.js";
import {
  DEFAULT_FULL_STREAM_MAX_ACTIVE,
  DEFAULT_FULL_STREAM_QUEUE_WAIT_MS,
  resolveEnrichStreamAdmissionPolicy,
} from "../../backend/src/scanStreamAdmissionPolicy.js";

test("full stream rev1 done policy caps the post-rev1 tail below the release gate", () => {
  assert.equal(DEFAULT_FULL_REV1_DONE_DELAY_MS, 1000);

  const policy = resolveScanStreamRev1DonePolicy({
    analysisBundleOnly: false,
    bundleOnlyDoneDelayMs: 250,
    fullRev1DoneDelayMs: DEFAULT_FULL_REV1_DONE_DELAY_MS,
  });

  assert.deepEqual(policy, {
    delayMs: 1000,
    finalizeReason: "full_rev1_watchdog_complete",
    timerKind: "full_rev1_watchdog",
  });
});

test("bundle-only stream keeps its short terminal delay and reason separate from full mode", () => {
  const policy = resolveScanStreamRev1DonePolicy({
    analysisBundleOnly: true,
    bundleOnlyDoneDelayMs: 250,
    fullRev1DoneDelayMs: DEFAULT_FULL_REV1_DONE_DELAY_MS,
  });

  assert.deepEqual(policy, {
    delayMs: 250,
    finalizeReason: "analysis_bundle_only_rev1_complete",
    timerKind: "bundle_only_done",
  });
});

test("full stream can disable the rev1 done watchdog with a zero delay env override", () => {
  const policy = resolveScanStreamRev1DonePolicy({
    analysisBundleOnly: false,
    bundleOnlyDoneDelayMs: 250,
    fullRev1DoneDelayMs: 0,
  });

  assert.equal(policy, null);
});

test("delay parsing clamps invalid or negative values to a stable fallback", () => {
  assert.equal(toNonNegativeDelayMs("1750", 2500), 1750);
  assert.equal(toNonNegativeDelayMs("-1", 2500), 2500);
  assert.equal(toNonNegativeDelayMs("not-a-number", 2500), 2500);
});

test("full stream admission defaults can absorb the parallel9 gate without queueing first", () => {
  const policy = resolveEnrichStreamAdmissionPolicy({});

  assert.equal(DEFAULT_FULL_STREAM_MAX_ACTIVE, 9);
  assert.equal(DEFAULT_FULL_STREAM_QUEUE_WAIT_MS, 750);
  assert.equal(policy.full.maxActive, 9);
  assert.equal(policy.full.maxQueue, 20);
  assert.equal(policy.full.queueWaitMs, 750);
  assert.equal(policy.bundleOnly.maxActive, 12);
  assert.equal(policy.bundleOnly.maxQueue, 50);
  assert.equal(policy.bundleOnly.queueWaitMs, 1500);
  assert.equal(policy.overloadInflightThreshold, 10);
});

test("stream admission policy preserves explicit operator overrides", () => {
  const policy = resolveEnrichStreamAdmissionPolicy({
    ENRICH_STREAM_MAX_ACTIVE: "5",
    ENRICH_STREAM_MAX_QUEUE: "11",
    ENRICH_STREAM_MAX_ACTIVE_FULL: "6",
    ENRICH_STREAM_QUEUE_WAIT_MS: "900",
    ENRICH_STREAM_MAX_ACTIVE_BUNDLE_ONLY: "7",
    ENRICH_STREAM_QUEUE_WAIT_MS_BUNDLE_ONLY: "1200",
    ENRICH_STREAM_OVERLOAD_INFLIGHT_THRESHOLD: "8",
  });

  assert.equal(policy.shared.maxActive, 5);
  assert.equal(policy.shared.maxQueue, 11);
  assert.equal(policy.full.maxActive, 6);
  assert.equal(policy.full.maxQueue, 11);
  assert.equal(policy.full.queueWaitMs, 900);
  assert.equal(policy.bundleOnly.maxActive, 7);
  assert.equal(policy.bundleOnly.maxQueue, 11);
  assert.equal(policy.bundleOnly.queueWaitMs, 1200);
  assert.equal(policy.overloadInflightThreshold, 8);
});
