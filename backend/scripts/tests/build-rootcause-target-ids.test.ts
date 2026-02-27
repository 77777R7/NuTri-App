import assert from "node:assert/strict";
import { test } from "node:test";

import { buildTargetIds } from "../build-rootcause-target-ids.ts";

const payload = {
  products: [
    {
      sourceId: "NPN-100",
      canonicalSourceId: "3960567",
      primaryReason: "mismatch",
    },
    {
      sourceId: "NPN-200",
      canonicalSourceId: " 3960568 ",
      primaryReason: "mismatch",
    },
    {
      sourceId: "NPN-300",
      canonicalSourceId: null,
      primaryReason: "missingVerified",
    },
  ],
};

test("rootcause ids: impact_key uses intNorm(canonical||source)", () => {
  const result = buildTargetIds({
    payload,
    reason: "mismatch",
    idMode: "impact_key",
  });
  assert.deepEqual(result.sourceIds, ["3960567", "3960568"]);
});

test("rootcause ids: source_id_raw preserves source ids", () => {
  const result = buildTargetIds({
    payload,
    reason: "mismatch",
    idMode: "source_id_raw",
  });
  assert.deepEqual(result.sourceIds, ["NPN-100", "NPN-200"]);
});

test("rootcause ids: canonical_source_id only uses canonical", () => {
  const result = buildTargetIds({
    payload,
    reason: "missingVerified",
    idMode: "canonical_source_id",
  });
  assert.deepEqual(result.sourceIds, []);
  assert.equal(result.droppedMissingId, 1);
});
