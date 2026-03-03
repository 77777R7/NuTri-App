import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const STAGE_C_SCRIPT_PATH = path.resolve(__dirname, "../../scripts/maintainer/run-stage-c-final.mjs");

const readScriptSource = async () => readFile(STAGE_C_SCRIPT_PATH, "utf8");

test("stage-c C1A gate enforces read-only and normalization threshold", async () => {
  const source = await readScriptSource();
  assert.match(source, /min-brand-normalization-hit-rate[\s\S]*0\.95/);
  assert.match(source, /dbWriteCount:\s*0/);
  assert.match(source, /brand-coverage-terms-json/);
  assert.match(source, /includedMatchTypes[\s\S]*coverage_term_confirmed/);
  assert.match(source, /excludedMatchTypes[\s\S]*fuzzy_review/);
  assert.match(source, /brand_normalization_hit_rate_below_threshold/);
  assert.match(source, /product_title_token_overlap/);
  assert.match(source, /distributor_or_manufacturer_signal/);
  assert.match(source, /known_family_token_signal/);
});

test("stage-c C1.5 lane selection gate enforces threshold set with reach", async () => {
  const source = await readScriptSource();
  assert.match(source, /minCandidateCount[\s\S]*20/);
  assert.match(source, /minEvidenceAvailabilityRate[\s\S]*0\.6/);
  assert.match(source, /maxConflictRiskEstimate[\s\S]*0\.05/);
  assert.match(source, /minExpectedMissingReduction[\s\S]*0\.15/);
  assert.match(source, /minBrandCountCovered[\s\S]*8/);
  assert.match(source, /minProductCountCovered[\s\S]*40/);
});

test("stage-c C1B enforces market floor with explicit override reasons", async () => {
  const source = await readScriptSource();
  assert.match(source, /market-floor-us[\s\S]*10/);
  assert.match(source, /market-floor-ca[\s\S]*10/);
  assert.match(source, /us_brand_normalization_hit_rate_below_95/);
  assert.match(source, /ca_brand_normalization_hit_rate_below_95/);
  assert.match(source, /us_lane_readiness_below_floor/);
  assert.match(source, /ca_lane_readiness_below_floor/);
});

test("stage-c C2 hard-locks writable source tier to scanned_label only", async () => {
  const source = await readScriptSource();
  assert.match(source, /WRITABLE_SOURCE_TIERS[\s\S]*scanned_label/);
  assert.match(source, /NON_WRITABLE_SOURCE_TIERS[\s\S]*official_record[\s\S]*general_science[\s\S]*inferred/);
  assert.match(source, /const sourceTier = "scanned_label"/);
});

test("stage-c fish oil lane guards reverse inference from total fish oil", async () => {
  const source = await readScriptSource();
  assert.match(source, /FISH_OIL_REVERSE_INFERENCE_FORBIDDEN/);
  assert.match(source, /hasOnlyTotalFishOil/);
  assert.match(source, /fishOilReverseInferenceForbidden/);
});

test("stage-c C3 pre-filter enforces required candidate fields and conflict queue", async () => {
  const source = await readScriptSource();
  assert.match(source, /requiredFields/);
  assert.match(source, /missing_required_fields/);
  assert.match(source, /stage_c_patch_conflicts_queue\.jsonl/);
  assert.match(source, /stage_c_patch_candidates_filtered\.jsonl/);
});
