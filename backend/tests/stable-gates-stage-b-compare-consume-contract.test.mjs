import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const STABLE_GATES_PATH = path.resolve(__dirname, "../../scripts/maintainer/run-backend-gates-stable.mjs");

const readScriptSource = async () => readFile(STABLE_GATES_PATH, "utf8");

test("stable gate accepts stage-b compare report as external input", async () => {
  const source = await readScriptSource();
  assert.match(source, /--stage-b-compare-report/);
  assert.match(source, /stageBCompareReportPath/);
  assert.match(source, /stageBCompareReport = stageBCompareReportPath \? await readJson/);
});

test("stable gate consumes compare result and propagates fail reasons", async () => {
  const source = await readScriptSource();
  assert.match(source, /stage_b_compare_report_missing/);
  assert.match(source, /stage_b_baseline_compare_failed/);
  assert.match(source, /stageBCompare:\s*stageBCompareReport/);
});

test("stable gate keeps compare logic decoupled and does not execute compare script directly", async () => {
  const source = await readScriptSource();
  assert.doesNotMatch(source, /compare-stage-b-baseline\.mjs/);
});

