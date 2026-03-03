import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const E0_BASELINE_PATH = path.resolve(__dirname, "../../scripts/maintainer/freeze-stage-e0-baseline.mjs");
const E0_READINESS_PATH = path.resolve(__dirname, "../../scripts/maintainer/build-stage-e0-readiness.mjs");
const E1_SHADOW_PATH = path.resolve(__dirname, "../../scripts/maintainer/run-stage-e1-shadow.mjs");
const E1_EVAL_PATH = path.resolve(__dirname, "../../scripts/maintainer/evaluate-stage-e1-shadow.mjs");
const E1_OWNER_CLOSURE_PATH = path.resolve(__dirname, "../../scripts/maintainer/close-e1-owner-metadata.mjs");
const E1_STAGING_COMPARE_PATH = path.resolve(__dirname, "../../scripts/maintainer/compare-e1-staging-repeat.mjs");
const E2_SELECT_TOP10_PATH = path.resolve(__dirname, "../../scripts/maintainer/select-e2-pilot-scope.mjs");
const E2_WATCH_WINDOW_PATH = path.resolve(__dirname, "../../scripts/maintainer/run-e2-pilot-watch-window.mjs");

const readSource = async (filePath) => readFile(filePath, "utf8");

test("stage-e0 baseline freeze locks lane policy and baseline artifacts", async () => {
  const source = await readSource(E0_BASELINE_PATH);
  assert.match(source, /stage_e0_manifest\.json/);
  assert.match(source, /stage_e0_metrics_baseline\.json/);
  assert.match(source, /stage_e0_scope_lock\.md/);
  assert.match(source, /lane2_primary.*patch_probiotics_strain_cfu_v1/);
  assert.match(source, /fish_oil.*repair_only/);
});

test("stage-e0 readiness builds probiotics candidate contract and thresholds", async () => {
  const source = await readSource(E0_READINESS_PATH);
  assert.match(source, /e0_probiotics_candidates\.jsonl/);
  assert.match(source, /stage_e0_readiness\.json/);
  assert.match(source, /missing_strain_rate/);
  assert.match(source, /missing_cfu_rate/);
  assert.match(source, /tier1_required/);
  assert.match(source, /candidate_count|evidence_availability_rate|conflict_risk_estimate/);
});

test("stage-e1 runner executes control\/patch shadow sequence plus focused probe", async () => {
  const source = await readSource(E1_SHADOW_PATH);
  assert.match(source, /run-stage-c-sequence\.mjs/);
  assert.match(source, /focused_probe_diff\.json/);
  assert.match(source, /PATCH|patch-shadow|patchModeConfirmed/);
  assert.match(source, /evaluate-stage-e1-shadow\.mjs/);
});

test("stage-e1 evaluator enforces shadow-only gates and queue routing outputs", async () => {
  const source = await readSource(E1_EVAL_PATH);
  assert.match(source, /primaryMetricRelativeImprovement/);
  assert.match(source, /conflict_rate|conflict_abs/);
  assert.match(source, /d1bIsolationPass|batchIsolationPass/);
  assert.match(source, /full_preview_readiness/);
  assert.match(source, /pilot_readiness/);
  assert.match(source, /blockingReasons/);
  assert.match(source, /e1_shadow_report\.json/);
  assert.match(source, /e1_release_readiness_decision\.json/);
  assert.match(source, /e1_postfilter_rejects\.jsonl/);
  assert.match(source, /e1_enforce_readiness_preview\.jsonl/);
  assert.match(source, /e1_fixable_repair_queue\.jsonl/);
  assert.match(source, /e1_fixable_owner_assignment_queue\.jsonl/);
  assert.match(source, /e1_ceiling_explain_queue\.jsonl/);
});

test("owner closure script emits pilot-ready and residual queues", async () => {
  const source = await readSource(E1_OWNER_CLOSURE_PATH);
  assert.match(source, /e2_pilot_ready_candidates\.jsonl/);
  assert.match(source, /owner_assignment_audit\.json/);
  assert.match(source, /owner_assignment_residual_queue\.jsonl/);
  assert.match(source, /candidateScopeId/);
});

test("staging repeat compare script enforces hash or overlap stability gate", async () => {
  const source = await readSource(E1_STAGING_COMPARE_PATH);
  assert.match(source, /previewHashRun1/);
  assert.match(source, /previewHashRun2/);
  assert.match(source, /previewOverlapRate/);
  assert.match(source, /previewHashEqual/);
  assert.match(source, /stabilityPass/);
});

test("top10 selection and watch-window scripts enforce pilot safety contracts", async () => {
  const selectSource = await readSource(E2_SELECT_TOP10_PATH);
  assert.match(selectSource, /e2_pilot_scope_top10\.json/);
  assert.match(selectSource, /maxPerBrand/);
  assert.match(selectSource, /candidateScopeId/);
  assert.match(selectSource, /sourceTier.*scanned_label/);

  const watchSource = await readSource(E2_WATCH_WINDOW_PATH);
  assert.match(watchSource, /e2_pilot_watch_report\.json/);
  assert.match(watchSource, /e2_scale_decision\.json/);
  assert.match(watchSource, /e2_pilot_rollback_manifest\.json/);
  assert.match(watchSource, /watchWindowPass/);
  assert.match(watchSource, /nextScope/);
});
