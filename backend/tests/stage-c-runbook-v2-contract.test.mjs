import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const PREFLIGHT_PATH = path.resolve(__dirname, "../../scripts/maintainer/stage-c-preflight.mjs");
const SEQUENCE_PATH = path.resolve(__dirname, "../../scripts/maintainer/run-stage-c-sequence.mjs");
const FOCUSED_PATH = path.resolve(__dirname, "../../scripts/maintainer/run-stage-c-focused-probe.mjs");
const EVAL_PATH = path.resolve(__dirname, "../../scripts/maintainer/evaluate-stage-c-shadow.mjs");

const readSource = async (filePath) => readFile(filePath, "utf8");

test("stage-c preflight enforces snapshot/hash/C3/health/patch-status/db-write checks", async () => {
  const source = await readSource(PREFLIGHT_PATH);
  assert.match(source, /plan_snapshot\.json/);
  assert.match(source, /plan_snapshot\.sha256/);
  assert.match(source, /stage_c_patch_candidates_filtered\.jsonl/);
  assert.match(source, /dbWriteCount/);
  assert.match(source, /\/api\/patch-shadow\/status/);
  assert.match(source, /barcodesHash|barcodes_hash/);
});

test("stage-c sequence runs full fixed phases and validates patch mode explicitly", async () => {
  const source = await readSource(SEQUENCE_PATH);
  assert.match(source, /mode must be control\|patch|--mode/);
  assert.match(source, /\/api\/patch-shadow\/status/);
  assert.match(source, /patch_shadow_not_ready/);
  assert.match(source, /run-backend-gates-stable\.mjs/);
  assert.match(source, /mobile-soak-run\.mjs/);
  assert.match(source, /s50-run1/);
  assert.match(source, /s50-run2/);
  assert.match(source, /killer10/);
  assert.match(source, /gate-reconcile/);
});

test("focused probe produces control/patch artifacts and diff", async () => {
  const source = await readSource(FOCUSED_PATH);
  assert.match(source, /focused_probe_control\.json/);
  assert.match(source, /focused_probe_patch\.json/);
  assert.match(source, /focused_probe_diff\.json/);
  assert.match(source, /\/api\/patch-shadow\/status/);
});

test("stage-c shadow eval consumes focused probe and patch activation evidence", async () => {
  const source = await readSource(EVAL_PATH);
  assert.match(source, /--focused-probe-diff/);
  assert.match(source, /focusedProbeDiff/);
  assert.match(source, /patchActivationEvidence/);
  assert.match(source, /patchModeConfirmed/);
  assert.match(source, /patch_shadow_mode_not_confirmed/);
  assert.match(source, /laneResults/);
});
