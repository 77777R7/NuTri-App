# DSLD Phase D Release Switch — Audit Summary (v15)

Date: 2026-02-07
Evidence closure updated: 2026-02-08

This document is an auditable, reproducible summary for the DSLD Phase D release switch. It is intended for external review and internal rollback readiness.

## 1) Release Metadata

- Source: `dsld`
- DatasetVersion (release switch): `v4.0.0-alpha.3-dsld-phaseD-verified-20260205a`
- ScoreVersion: `v4.0.0-alpha.3`
- Primary run dir:
  - `/Users/howard07/NuTriApp/nutri-app/backend/output/runs/20260205_dsld_phaseD_release_run1`

## 2) Run Summary (Targeted Rebackfill)

Rebackfill summary:

- File:
  - `/Users/howard07/NuTriApp/nutri-app/backend/output/runs/20260205_dsld_phaseD_release_run1/rebackfill/promotion_rebackfill_facts_summary_v15.json`
- Key results:
  - processed: `50000`
  - scores written: `49990`
  - skipped: `10`
  - failed: `0`
  - failuresLines: `0` (HARD GATE PASS)

Release switch status (canonical):

- File:
  - `/Users/howard07/NuTriApp/nutri-app/backend/output/runs/20260205_dsld_phaseD_release_run1/rebackfill/release_switch_status.json`
- Status: `completed`

## 3) Valid Pool Freeze + Audit Skips

Valid pool (post-release, v15):

- Valid IDs:
  - `/Users/howard07/NuTriApp/nutri-app/backend/output/runs/20260205_dsld_phaseD_release_run1/coverage/valid_ids_release_v15.json`
  - Count: `49990`
- Skipped IDs:
  - `/Users/howard07/NuTriApp/nutri-app/backend/output/runs/20260205_dsld_phaseD_release_run1/coverage/skipped_ids_release_v15.json`
  - Count: `10`
- Skip reasons:
  - `/Users/howard07/NuTriApp/nutri-app/backend/output/runs/20260205_dsld_phaseD_release_run1/coverage/skipped_reasons_release_v15.json`
  - Breakdown:
    - `empty_label_facts`: `8`
    - `facts_not_found`: `2`

Notes:

- Skips are treated as auditable exclusions and do not fail the run gate.
- Invalid IDs with `facts_not_found` are tracked in `public.invalid_source_ids` (Supabase).

## 4) Frozen Diagnostic Cohorts (Reproducible)

Generated from the frozen valid pool:

- 1k:
  - `/Users/howard07/NuTriApp/nutri-app/backend/output/runs/20260205_dsld_phaseD_release_run1/diagnostics/dsld_sample_ids_1k_release_v15.json`
- 5kA:
  - `/Users/howard07/NuTriApp/nutri-app/backend/output/runs/20260205_dsld_phaseD_release_run1/diagnostics/dsld_sample_ids_5kA_release_v15.json`
- 5kB:
  - `/Users/howard07/NuTriApp/nutri-app/backend/output/runs/20260205_dsld_phaseD_release_run1/diagnostics/dsld_sample_ids_5kB_release_v15.json`

## 5) Gates: IngredientIdMissing + TaxonomyMismatch (PASS)

Taxonomy mismatch diagnostics:

- 5kA:
  - `/Users/howard07/NuTriApp/nutri-app/backend/output/runs/20260205_dsld_phaseD_release_run1/diagnostics/taxonomy_5kA_release_v15/mismatch_summary_dsld.json`
  - `ingredientIdMissingRatio = 0.0538` (PASS, <= 0.10)
  - `taxonomyMismatchAmongResolved = 0.0409` (PASS, <= 0.08)
- 5kB:
  - `/Users/howard07/NuTriApp/nutri-app/backend/output/runs/20260205_dsld_phaseD_release_run1/diagnostics/taxonomy_5kB_release_v15/mismatch_summary_dsld.json`
  - `ingredientIdMissingRatio = 0.08` (PASS, <= 0.10)
  - `taxonomyMismatchAmongResolved = 0.0245` (PASS, <= 0.08)

IngredientIdMissing drilldown (topMissing evidence):

- 5kA:
  - `/Users/howard07/NuTriApp/nutri-app/backend/output/runs/20260205_dsld_phaseD_release_run1/diagnostics/ingredient_id_missing_5kA_release_v15.json`
- 5kB:
  - `/Users/howard07/NuTriApp/nutri-app/backend/output/runs/20260205_dsld_phaseD_release_run1/diagnostics/ingredient_id_missing_5kB_release_v15.json`

## 6) Gates: changedToEmpty + Shadow Compare (PASS)

### 6.1 changedToEmpty (Scores-only Safety)

Snapshot (before):

- File:
  - `/Users/howard07/NuTriApp/nutri-app/backend/output/runs/20260205_dsld_phaseD_release_run1/changedToEmpty/formraw_nonempty_snapshot_200_release_v15.json`
- Sample size: `200` non-empty `product_ingredients.form_raw` rows.

After (post shadow scores-only backfill):

- File:
  - `/Users/howard07/NuTriApp/nutri-app/backend/output/runs/20260205_dsld_phaseD_release_run1/changedToEmpty/formraw_nonempty_diff_after_shadow_release_v15.json`
- Gate: `PASS`
  - `changedToEmpty_count = 0` (out of `200`)

### 6.2 Shadow Scores-only Backfill (Valid Pool)

Purpose: refresh `product_scores_shadow` for the same frozen valid pool without mutating `product_ingredients`.

- Summary:
  - `/Users/howard07/NuTriApp/nutri-app/backend/output/runs/20260205_dsld_phaseD_release_run1/shadow/backfill_summary_shadow_release_v15.json`
- Key results:
  - processed: `49990`
  - scores written: `48436`
  - existing: `1554`
  - skipped: `0`
  - failed: `0`
  - failuresLines: `0` (HARD GATE PASS)

### 6.3 A/A Compare (Baseline vs Shadow)

Compare outputs:

- Compare summary:
  - `/Users/howard07/NuTriApp/nutri-app/backend/output/runs/20260205_dsld_phaseD_release_run1/compare/compare_summary_release_AA_v15.json`
- Outliers:
  - `/Users/howard07/NuTriApp/nutri-app/backend/output/runs/20260205_dsld_phaseD_release_run1/compare/outliers_gt20_release_v15.jsonl` (empty)
  - `/Users/howard07/NuTriApp/nutri-app/backend/output/runs/20260205_dsld_phaseD_release_run1/compare/outliers_gt10_release_v15.jsonl` (empty)
- factsHash:
  - `/Users/howard07/NuTriApp/nutri-app/backend/output/runs/20260205_dsld_phaseD_release_run1/compare/facts_hash_mismatch_release_v15.jsonl` (empty)
  - `/Users/howard07/NuTriApp/nutri-app/backend/output/runs/20260205_dsld_phaseD_release_run1/compare/facts_hash_breakdown_release_v15.json`

Hard gates:

- `PASS` (full valid pool compare: `totalIds=49990`, `matchedBoth=49990`)
  - `gt20Ratio = 0` (<= 1%)
  - `gt10Ratio = 0` (<= 5%)
  - `factsHash.mismatches = 0`
  - `factsHash.coverage = 1`
  - `missingA = 0` and `missingB = 0`

## 7) Final Evidence Pack (PASS)

Produced after Section 6 completion:

- `/Users/howard07/NuTriApp/nutri-app/backend/output/runs/20260205_dsld_phaseD_release_run1/evidence_pack_dsld_phaseD_release_v15.json`

Contents will include:

- Release switch rebackfill summary + status
- Valid pool + skip audit (with reasons)
- Frozen cohorts (1k/5kA/5kB)
- Taxonomy mismatch summaries (1k/5kA/5kB)
- IngredientIdMissing drilldowns (5kA/5kB)
- changedToEmpty before/after artifacts
- Shadow backfill summary
- Compare summary + outliers + factsHash artifacts

## 7.1) Scale 50k Gate (PASS)

- Gate summary:
  - `/Users/howard07/NuTriApp/nutri-app/backend/output/runs/20260128_dsld_phaseD_run1/scale_50k/scale_50k_gate_summary_v15.json` (overall PASS, parts 000..004)
- Evidence pack:
  - `/Users/howard07/NuTriApp/nutri-app/backend/output/runs/20260128_dsld_phaseD_run1/scale_50k/evidence_pack_dsld_phaseD_scale50k_v15.json`

## 8) Rollback Notes

If a rollback is required, the release switch can be reverted by:

1. Restoring the previous `datasetVersion` (commercial switch).
2. Re-running targeted rebackfill on the same frozen IDs if needed.
3. Keeping `public.invalid_source_ids` as an audit record of permanent exclusions.
