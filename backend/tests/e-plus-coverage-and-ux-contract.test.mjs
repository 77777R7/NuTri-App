import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const COVERAGE_TERMS_SCRIPT_PATH = path.resolve(__dirname, "../../scripts/maintainer/build-brand-coverage-terms.mjs");
const GAP_MATRIX_SCRIPT_PATH = path.resolve(__dirname, "../../scripts/maintainer/build-coverage-gap-hit-matrix.mjs");
const MERGED_SCOPE_SCRIPT_PATH = path.resolve(__dirname, "../../scripts/maintainer/build-merged-top100-scope-from-gap-matrix.mjs");
const UX_VIS_SCRIPT_PATH = path.resolve(__dirname, "../../scripts/maintainer/evaluate-stage-e-ux-visibility.mjs");
const UX_BASELINE_FREEZE_SCRIPT_PATH = path.resolve(__dirname, "../../scripts/maintainer/freeze-stage-e-ux-closure-baseline.mjs");
const UX_PROJECTION_SCRIPT_PATH = path.resolve(__dirname, "../../scripts/maintainer/project-stage-e-ux-closure.mjs");
const UX_NONREG_SCRIPT_PATH = path.resolve(__dirname, "../../scripts/maintainer/evaluate-stage-e-ux-nonregression.mjs");
const TOP100_ORCH_PATH = path.resolve(__dirname, "../../scripts/maintainer/run_top100_lane1_orchestrator.mjs");
const PACKAGE_JSON_PATH = path.resolve(__dirname, "../../package.json");

test("coverage terms builder emits diagnosis + map + hash artifacts", async () => {
  const source = await readFile(COVERAGE_TERMS_SCRIPT_PATH, "utf8");
  assert.match(source, /brand_coverage_gap_diagnosis\.json/);
  assert.match(source, /brand_coverage_terms_map\.json/);
  assert.match(source, /brand_coverage_terms_map\.sha256/);
  assert.match(source, /legal_entity_variance/);
  assert.match(source, /title_led_brand/);
  assert.match(source, /market_naming_variance/);
});

test("ux visibility evaluator includes uplift + closure dual gates and newly visible deltas", async () => {
  const source = await readFile(UX_VIS_SCRIPT_PATH, "utf8");
  assert.match(source, /UX_uplift_gate/);
  assert.match(source, /UX_closure_gate/);
  assert.match(source, /newly_visible_best_for_count/);
  assert.match(source, /newly_visible_formula_explainability_count/);
  assert.match(source, /newly_visible_before_you_buy_count/);
  assert.match(source, /coq10|vitamin_c|ascorbic|zinc|magnesium/);
  assert.match(source, /min-uplift-science-specificity-rate/);
  assert.match(source, /safe-fallback-json/);
  assert.match(source, /issueType/);
});

test("top100 orchestrator accepts coverage terms map and records matching order", async () => {
  const source = await readFile(TOP100_ORCH_PATH, "utf8");
  assert.match(source, /brand-coverage-terms-json/);
  assert.match(source, /coverage_term_confirmed/);
  assert.match(source, /matching_order/);
});

test("coverage gap matrix and merged scope scripts emit required artifacts", async () => {
  const gapSource = await readFile(GAP_MATRIX_SCRIPT_PATH, "utf8");
  assert.match(gapSource, /coverage_gap_hit_matrix\.json/);
  assert.match(gapSource, /coverage_gap_matchable_candidates\.jsonl/);
  assert.match(gapSource, /coverage_gap_residual_queue\.jsonl/);
  const mergeSource = await readFile(MERGED_SCOPE_SCRIPT_PATH, "utf8");
  assert.match(mergeSource, /brand_scope_products_top100\.merged\.json/);
  assert.match(mergeSource, /coverage_gap_scope_additions\.jsonl/);
  assert.match(mergeSource, /coverage_gap_scope_merge_audit\.json/);
});

test("ux closure scripts expose baseline freeze, projection, and nonregression gates", async () => {
  const freezeSource = await readFile(UX_BASELINE_FREEZE_SCRIPT_PATH, "utf8");
  assert.match(freezeSource, /ux_closure_baseline\.json/);
  assert.match(freezeSource, /strict_pass/);

  const projectionSource = await readFile(UX_PROJECTION_SCRIPT_PATH, "utf8");
  assert.match(projectionSource, /ux_closure_projection\.json/);
  assert.match(projectionSource, /projectionPass/);
  assert.match(projectionSource, /vitamin_d/);
  assert.match(projectionSource, /fish_oil_omega3/);

  const nonregSource = await readFile(UX_NONREG_SCRIPT_PATH, "utf8");
  assert.match(nonregSource, /ux_nonregression_report\.json/);
  assert.match(nonregSource, /formula_explainability_non_regression/);
  assert.match(nonregSource, /before_you_buy_non_regression/);
});

test("package scripts expose e-plus coverage tooling commands", async () => {
  const pkgRaw = await readFile(PACKAGE_JSON_PATH, "utf8");
  const pkg = JSON.parse(pkgRaw);
  assert.equal(typeof pkg?.scripts?.["gates:e-plus-coverage-terms"], "string");
  assert.equal(typeof pkg?.scripts?.["gates:e-plus-gap-hit-matrix"], "string");
  assert.equal(typeof pkg?.scripts?.["gates:e-plus-merge-scope"], "string");
  assert.equal(typeof pkg?.scripts?.["gates:e-plus-ux-baseline-freeze"], "string");
  assert.equal(typeof pkg?.scripts?.["gates:e-plus-ux-projection"], "string");
  assert.equal(typeof pkg?.scripts?.["gates:e-plus-ux-nonregression"], "string");
});
