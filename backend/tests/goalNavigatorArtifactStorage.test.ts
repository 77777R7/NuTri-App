import assert from "node:assert/strict";
import test from "node:test";

import {
  GOAL_NAVIGATOR_ARTIFACT_STORAGE_BUCKET,
  goalNavigatorArtifactStorageInternals,
} from "../src/personalization/goalNavigatorArtifactStorage";

test("goal navigator artifact storage builds a stable storage path and checksum", () => {
  const path = goalNavigatorArtifactStorageInternals.buildGoalNavigatorArtifactStoragePath({
    generatedAt: "2026-03-21T17:00:00.000Z",
    schemaVersion: "goal_navigator_candidate_bundle.v1",
    rulesVersion: "personalization-rules/v1-phase7",
  });
  const checksum = goalNavigatorArtifactStorageInternals.computeGoalNavigatorCandidateBundleChecksum(
    '{"ok":true}\n',
  );

  assert.equal(GOAL_NAVIGATOR_ARTIFACT_STORAGE_BUCKET, "personalization-artifacts");
  assert.equal(
    path,
    "goal-navigator/2026-03-21T17-00-00.000Z__goal_navigator_candidate_bundle.v1__personalization-rules-v1-phase7.json",
  );
  assert.equal(checksum.length, 64);
});
