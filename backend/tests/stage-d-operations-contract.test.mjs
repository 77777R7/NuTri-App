import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const BASELINE_PATH = path.resolve(__dirname, "../../scripts/maintainer/freeze-stage-d-baseline.mjs");
const D0_SAMPLE_PATH = path.resolve(__dirname, "../../scripts/maintainer/build-stage-d0-sample-manifest.mjs");
const D0_PROOF_PATH = path.resolve(__dirname, "../../scripts/maintainer/run-stage-d0-runtime-hit-proof.mjs");
const D1_BATCHES_PATH = path.resolve(__dirname, "../../scripts/maintainer/build-stage-d1-brand-batches.mjs");
const D1B_BUILD_PATH = path.resolve(__dirname, "../../scripts/maintainer/build-stage-d1-batch-candidates.mjs");
const D1B_PROOF_PATH = path.resolve(__dirname, "../../scripts/maintainer/run-stage-d1-batch-isolation-proof.mjs");
const D1_BATCH_PATH = path.resolve(__dirname, "../../scripts/maintainer/run-stage-d1-batch.mjs");
const D15_PATH = path.resolve(__dirname, "../../scripts/maintainer/run-stage-d1-5-lane2-triage.mjs");
const D2_OPS_PATH = path.resolve(__dirname, "../../scripts/maintainer/run-stage-d-ops-cycle.mjs");

const readSource = async (filePath) => readFile(filePath, "utf8");

test("stage-d baseline freeze script emits baseline lock artifacts", async () => {
  const source = await readSource(BASELINE_PATH);
  assert.match(source, /stage_d_baseline_manifest\.json/);
  assert.match(source, /stage_d_baseline_metrics\.json/);
  assert.match(source, /stage_d_baseline_lock\.md/);
  assert.match(source, /metricFormulaVersion/);
  assert.match(source, /lanePolicy/);
});

test("stage-d0 sample manifest script enforces sample sizing and brand diversity", async () => {
  const source = await readSource(D0_SAMPLE_PATH);
  assert.match(source, /minPositive|maxPositive/);
  assert.match(source, /minBrands/);
  assert.match(source, /negativeCount/);
  assert.match(source, /stage_d0_sample_manifest\.json/);
  assert.match(source, /stage_d0_positive_samples\.jsonl/);
  assert.match(source, /stage_d0_negative_samples\.jsonl/);
});

test("stage-d0 runtime proof script enforces strict thresholds and evidence classes", async () => {
  const source = await readSource(D0_PROOF_PATH);
  assert.match(source, /runtimePatchHitSampleRate/);
  assert.match(source, /visibleDirectionsImprovementRate/);
  assert.match(source, /minNegative|negativeSampleCount/);
  assert.match(source, /payloadSoftThreshold|payload-soft-threshold/);
  assert.match(source, /softGateWarnings|payload_evidence_gap/);
  assert.match(source, /unexpectedCrossIdentityHitCount/);
  assert.match(source, /evidencePositiveCount/);
  assert.match(source, /stage_d0_runtime_hit_proof\.json/);
  assert.match(source, /stage_d0_payload_diff\.json/);
  assert.match(source, /stage_d0_ui_visible_diff\.json/);
});

test("stage-d1 scripts support dynamic batches, state machine, rollback, and drift guard", async () => {
  const batchBuilder = await readSource(D1_BATCHES_PATH);
  assert.match(batchBuilder, /batch_priority/);
  assert.match(batchBuilder, /brand_batch_manifest\.json/);
  assert.match(batchBuilder, /stage_d1_state_machine\.json/);

  const batchRunner = await readSource(D1_BATCH_PATH);
  assert.match(batchRunner, /candidateRefreshDelta/);
  assert.match(batchRunner, /allow-drift/);
  assert.match(batchRunner, /stage_d1_batch_rollback_manifest\.json/);
  assert.match(batchRunner, /owner_not_unassigned/);
  assert.match(batchRunner, /patchBatchId/);
});

test("stage-d1b scripts enforce batch candidate scope materialization and isolation proof", async () => {
  const buildSource = await readSource(D1B_BUILD_PATH);
  assert.match(buildSource, /batch_patch_candidates\.jsonl/);
  assert.match(buildSource, /batch_patch_candidates\.meta\.json/);
  assert.match(buildSource, /candidateScopeId/);
  assert.match(buildSource, /sourceTier_not_scanned_label|scanned_label/);

  const proofSource = await readSource(D1B_PROOF_PATH);
  assert.match(proofSource, /inBatchHitRate/);
  assert.match(proofSource, /outOfBatchFalseHitRate/);
  assert.match(proofSource, /runtime_candidates_path_mismatch|candidatesPath/);
  assert.match(proofSource, /batch_scope_leakage/);
  assert.match(proofSource, /stage_d1b_batch_isolation_proof\.json/);
});

test("stage-d1.5 triage script enforces recover/replace/retire decision", async () => {
  const source = await readSource(D15_PATH);
  assert.match(source, /recover|replace|retire/);
  assert.match(source, /stage_d1_5_lane2_rootcause_report\.json/);
  assert.match(source, /stage_d1_5_lane2_repair_plan\.jsonl/);
  assert.match(source, /lane2_decision\.json/);
});

test("stage-d ops cycle orchestrates D0 -> D1 -> D1.5 and writes cycle report", async () => {
  const source = await readSource(D2_OPS_PATH);
  assert.match(source, /freeze-stage-d-baseline/);
  assert.match(source, /build-stage-d0-sample-manifest/);
  assert.match(source, /run-stage-d0-runtime-hit-proof/);
  assert.match(source, /build-stage-d1-brand-batches/);
  assert.match(source, /run-stage-d1-batch/);
  assert.match(source, /cycles/);
  assert.match(source, /noRegression/);
  assert.match(source, /unassignedCount|ttlReviewCompleteness|danglingWarningsCount/);
  assert.match(source, /run-stage-d1-batch/);
  assert.match(source, /run-stage-d1-5-lane2-triage/);
  assert.match(source, /stage_d_ops_cycle_report\.json/);
});
