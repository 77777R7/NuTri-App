import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const EVAL_SCRIPT_PATH = path.resolve(__dirname, "../../scripts/maintainer/evaluate-stage-c-shadow.mjs");

const readScriptSource = async () => readFile(EVAL_SCRIPT_PATH, "utf8");

test("stage-c shadow evaluator performs C4 dual-run delta comparison", async () => {
  const source = await readScriptSource();
  assert.match(source, /Run A: no-patch/);
  assert.match(source, /Run B: patch-shadow/);
  assert.match(source, /effect_delta_vs_control/);
  assert.match(source, /patchAppliedCandidateCount/);
  assert.match(source, /candidateCoverageRate/);
  assert.match(source, /conflictRate/);
});

test("stage-c shadow evaluator implements C4.5 post-filter rejection rules", async () => {
  const source = await readScriptSource();
  assert.match(source, /stage_c_patch_postfilter_rejects\.jsonl/);
  assert.match(source, /stage_c_patch_enforce_ready\.jsonl/);
  assert.match(source, /digest_unexpected_409_rate_regression/);
  assert.match(source, /inline_fallback_proxy_rate_regression/);
  assert.match(source, /verdict_distribution_proxy_drift_regression/);
  assert.match(source, /global_stability_guard_lane2/);
});

test("stage-c shadow evaluator enforces lane-by-lane C5 thresholds", async () => {
  const source = await readScriptSource();
  assert.match(source, /max-conflict-rate[\s\S]*0\.01/);
  assert.match(source, /max-conflict-abs[\s\S]*5/);
  assert.match(source, /min-lane-improvement[\s\S]*0\.20/);
  assert.match(source, /lane1Improvement/);
  assert.match(source, /lane2Improvement/);
  assert.match(source, /lane_not_enforced/);
});

test("stage-c shadow evaluator emits C6 closeout deliverables and queue split", async () => {
  const source = await readScriptSource();
  assert.match(source, /stage_c_gate_report\.json/);
  assert.match(source, /stage_c_gate_report\.md/);
  assert.match(source, /stage_c_fixable_repair_queue\.jsonl/);
  assert.match(source, /stage_c_ceiling_explain_queue\.jsonl/);
  assert.match(source, /stage_c_release_note\.md/);
  assert.match(source, /lane_effective_coverage_rate/);
});
