import assert from "node:assert/strict";
import { test } from "node:test";

import { deriveAllowlistCounterDeltas } from "../run-manual-shopify-batch.ts";

test("deriveAllowlistCounterDeltas: no allowlist means no telemetry increments", () => {
  const deltas = deriveAllowlistCounterDeltas({
    allowlistApplied: false,
    matchMode: "allowlist_unique_spec_anchor_as_is",
  });
  assert.deepEqual(deltas, {
    allowlistAppliedCount: 0,
    allowlistReleasedCount: 0,
    allowlistHeldCount: 0,
  });
});

test("deriveAllowlistCounterDeltas: unique anchor release is counted", () => {
  const deltas = deriveAllowlistCounterDeltas({
    allowlistApplied: true,
    matchMode: "allowlist_unique_spec_anchor_upc11_leading0",
  });
  assert.deepEqual(deltas, {
    allowlistAppliedCount: 1,
    allowlistReleasedCount: 1,
    allowlistHeldCount: 0,
  });
});

test("deriveAllowlistCounterDeltas: hold and conflict are counted as held", () => {
  const hold = deriveAllowlistCounterDeltas({
    allowlistApplied: true,
    matchMode: "allowlist_hold_until_unique_spec_anchor",
  });
  assert.deepEqual(hold, {
    allowlistAppliedCount: 1,
    allowlistReleasedCount: 0,
    allowlistHeldCount: 1,
  });

  const conflict = deriveAllowlistCounterDeltas({
    allowlistApplied: true,
    matchMode: "allowlist_anchor_conflict",
  });
  assert.deepEqual(conflict, {
    allowlistAppliedCount: 1,
    allowlistReleasedCount: 0,
    allowlistHeldCount: 1,
  });
});

test("deriveAllowlistCounterDeltas: top handle tie is not released/held by allowlist counters", () => {
  const deltas = deriveAllowlistCounterDeltas({
    allowlistApplied: true,
    matchMode: "top_handle_tie_ambiguous",
  });
  assert.deepEqual(deltas, {
    allowlistAppliedCount: 1,
    allowlistReleasedCount: 0,
    allowlistHeldCount: 0,
  });
});
