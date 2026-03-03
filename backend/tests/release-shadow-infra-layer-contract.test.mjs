import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const SHADOW_WATCH_PATH = path.resolve(__dirname, "../../scripts/maintainer/run-shadow-watch-curve.mjs");
const STABLE_GATES_PATH = path.resolve(__dirname, "../../scripts/maintainer/run-backend-gates-stable.mjs");
const SHADOW_BOARD_PATH = path.resolve(__dirname, "../../scripts/maintainer/shadow-realtime-board.mjs");
const SURFACE_REPORT_PATH = path.resolve(__dirname, "../../scripts/maintainer/surface-consistency-report.mjs");
const BOOTSTRAP_BASELINE_PATH = path.resolve(__dirname, "../../scripts/maintainer/bootstrap-gate-baseline.mjs");

test("shadow watch supports backend mode and infra inconclusive layering", async () => {
  const source = await readFile(SHADOW_WATCH_PATH, "utf8");
  assert.match(source, /--backend-mode <mode>/);
  assert.match(source, /--backend-port <n>/);
  assert.match(source, /--strict-checks <0\|1>/);
  assert.match(source, /--treat-infra-as-inconclusive <0\|1>/);
  assert.match(source, /const roundState =/);
  assert.match(source, /infraInconclusive/);
  assert.match(source, /productGoNoGo/);
  assert.match(source, /infraFailureReason/);
  assert.match(source, /currentGoStreak/);
  assert.match(source, /goThreshold/);
});

test("stable gates exposes layered verdict fields for product vs infra", async () => {
  const source = await readFile(STABLE_GATES_PATH, "utf8");
  assert.match(source, /classification:\s*verdictClassification/);
  assert.match(source, /infraInconclusive/);
  assert.match(source, /productRegression/);
  assert.match(source, /layer:\s*\{/);
  assert.match(source, /productRegression,\s*[\r\n\s]*infraInconclusive/);
});

test("realtime board shows infra context when gate report is missing", async () => {
  const source = await readFile(SHADOW_BOARD_PATH, "utf8");
  assert.match(source, /gate report exists/);
  assert.match(source, /infra inconclusive/);
  assert.match(source, /infra reason/);
  assert.match(source, /stable stderr\(last\)/);
  assert.match(source, /roundState/);
});

test("surface consistency supports fixture sampling mode contract", async () => {
  const source = await readFile(SURFACE_REPORT_PATH, "utf8");
  assert.match(source, /--sample-mode <mode>/);
  assert.match(source, /--fixture-file <path>/);
  assert.match(source, /SURFACE_CONSISTENCY_SAMPLE_MODE/);
  assert.match(source, /SURFACE_CONSISTENCY_FIXTURE_FILE/);
  assert.match(source, /sampleSource/);
  assert.match(source, /fixturePath/);
});

test("bootstrap baseline script defines required env and report outputs", async () => {
  const source = await readFile(BOOTSTRAP_BASELINE_PATH, "utf8");
  assert.match(source, /SOURCE_SUPABASE_URL/);
  assert.match(source, /SOURCE_SUPABASE_SERVICE_ROLE_KEY/);
  assert.match(source, /TARGET_SUPABASE_URL/);
  assert.match(source, /TARGET_SUPABASE_SERVICE_ROLE_KEY/);
  assert.match(source, /baseline_import_report\.json/);
  assert.match(source, /baseline_import_report\.md/);
});
