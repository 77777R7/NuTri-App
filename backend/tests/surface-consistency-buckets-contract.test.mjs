import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const SURFACE_REPORT_PATH = path.resolve(__dirname, "../../scripts/maintainer/surface-consistency-report.mjs");

test("surface consistency report emits barcode bucket breakdowns", async () => {
  const source = await readFile(SURFACE_REPORT_PATH, "utf8");
  assert.match(source, /datasetVerificationBucketCounts/);
  assert.match(source, /datasetVerificationBucketBarcodes/);
  assert.match(source, /doseCountBucketCounts/);
  assert.match(source, /A_scan_zero_mysupp_positive/);
  assert.match(source, /B_scan_positive_mysupp_zero/);
  assert.match(source, /C_both_positive_value_diff/);
  assert.match(source, /mismatchRows/);
  assert.match(source, /scanStrictIngredientCount/);
  assert.match(source, /scanInferredIngredientCount/);
  assert.match(source, /scanStrictDoseCount/);
  assert.match(source, /scanInferredDoseCount/);
  assert.match(source, /sourceDatasetMismatchHard/);
  assert.match(source, /sourceDatasetMismatchWarning/);
  assert.match(source, /sourceDatasetMismatchWarningCount/);
  assert.match(source, /sourceDatasetMismatchWarningRows/);
  assert.match(source, /ingredientCountInferredOnlyContradictionCount/);
  assert.match(source, /doseCountInferredOnlyContradictionCount/);
  assert.match(source, /inferredOnlyContradictionRows/);
  assert.match(source, /inferredOnlyRootCauseCounts/);
  assert.match(source, /rootCause/);
  assert.match(source, /inference_only_expected/);
});
