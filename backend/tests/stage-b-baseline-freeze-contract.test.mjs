import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const FREEZE_SCRIPT_PATH = path.resolve(__dirname, "../../scripts/maintainer/freeze-stage-b-baseline.mjs");

const readScriptSource = async () => readFile(FREEZE_SCRIPT_PATH, "utf8");

test("stage-b baseline freeze script writes required artifacts", async () => {
  const source = await readScriptSource();
  assert.match(source, /baseline_manifest\.json/);
  assert.match(source, /verdict_distribution_baseline\.json/);
  assert.match(source, /s50_killer_baseline_stats\.json/);
  assert.match(source, /decision_support_observability_baseline\.json/);
  assert.match(source, /baseline_lock\.md/);
});

test("stage-b baseline freeze manifest captures fixed role and metric versions", async () => {
  const source = await readScriptSource();
  assert.match(source, /roleDefinitionVersion/);
  assert.match(source, /roleSetFixed/);
  assert.match(source, /cohortFixturePath/);
  assert.match(source, /metricFormulaVersion/);
});

test("stage-b baseline freeze records source artifacts and verdict source selection", async () => {
  const source = await readScriptSource();
  assert.match(source, /sourceArtifacts/);
  assert.match(source, /selectedFrom/);
  assert.match(source, /s50_run2/);
});

