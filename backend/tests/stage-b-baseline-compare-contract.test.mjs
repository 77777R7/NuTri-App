import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const COMPARE_SCRIPT_PATH = path.resolve(__dirname, "../../scripts/maintainer/compare-stage-b-baseline.mjs");

const readScriptSource = async () => readFile(COMPARE_SCRIPT_PATH, "utf8");

test("stage-b compare script enforces bucket and L1 drift thresholds", async () => {
  const source = await readScriptSource();
  assert.match(source, /maxBucketDeltaPp[\s\S]*5/);
  assert.match(source, /maxL1DistancePp[\s\S]*10/);
  assert.match(source, /computeL1DistancePp[\s\S]*0\.5 \* sumAbs/);
  assert.match(source, /valuesWithinBucketThreshold/);
  assert.match(source, /verdict_distribution_drift_exceeded/);
});

test("stage-b compare script enforces digest\/409 release tolerances", async () => {
  const source = await readScriptSource();
  assert.match(source, /maxUnexpected409Rate[\s\S]*0\.001/);
  assert.match(source, /minRetrySuccessRate[\s\S]*0\.99/);
  assert.match(source, /maxInlineFallbackRate[\s\S]*0\.001/);
  assert.match(source, /digest_409_metrics_threshold_breach/);
});

test("stage-b compare script emits repair queue with owner/status/targetRelease", async () => {
  const source = await readScriptSource();
  assert.match(source, /stage_b_repair_queue\.jsonl/);
  assert.match(source, /owner:\s*"unassigned"/);
  assert.match(source, /status:\s*"open"/);
  assert.match(source, /targetRelease/);
});

test("stage-b compare script fails when role definition drifts", async () => {
  const source = await readScriptSource();
  assert.match(source, /roleDefinitionMatch/);
  assert.match(source, /role_definition_version_mismatch/);
  assert.match(source, /fixed_role_drift_exceeded_/);
});

