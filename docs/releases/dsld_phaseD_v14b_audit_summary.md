# DSLD Phase D v14b — Audit Summary

**Run ID:** 20260128_dsld_phaseD_run1
**Git SHA:** 24bd24cad0e6e7e8878faf953266b84170bba524
**Generated:** 2026-02-04 09:59:57

## 1) Scope
This report summarizes the DSLD Phase D v14b audit gates after refreshing the shadow backfill (scores-only), re-running compare, and updating taxonomy + identity diagnostics.

## 2) Gate Results (PASS/FAIL)
**Identity Missing (5kA/5kB): PASS**
- 5kA missing ratio: 0.0805 (191 / 2373)
- 5kB missing ratio: 0.0795 (232 / 2919)

**Taxonomy Mismatch (≤ 0.08): PASS**
- 1k taxonomyMismatchAmongResolved: 0.0422
- 5kA taxonomyMismatchAmongResolved: 0.0341
- 5kB taxonomyMismatchAmongResolved: 0.0238

**Phase D Compare (gt10/gt20): PASS**
- gt10Ratio: 0.0000 (gt10=0)
- gt20Ratio: 0.0000 (gt20=0)
- missingA/missingB: 0/0

**Backfill Stability: PASS**
- Shadow backfill failuresLines: 0
- Identity cohort rebackfill failuresLines: 0

## 3) Evidence Pack Pointers
- Evidence pack: `backend/output/runs/20260128_dsld_phaseD_run1/evidence_pack_dsld_phaseD.json`
- Compare summary v14b: `backend/output/runs/20260128_dsld_phaseD_run1/compare/compare_summary_valid_v14b.json`
- Shadow backfill summary v14: `backend/output/runs/20260128_dsld_phaseD_run1/shadow/backfill_summary_shadow_valid_v14.json`
- Identity rebackfill summary v14: `backend/output/runs/20260128_dsld_phaseD_run1/identity_sprint/rebackfill_summary_v14_cohort.json`
- Missing 5kA v14: `backend/output/runs/20260128_dsld_phaseD_run1/identity_sprint/after_rebackfill/ingredient_id_missing_5kA_after_v14.json`
- Missing 5kB v14: `backend/output/runs/20260128_dsld_phaseD_run1/identity_sprint/after_rebackfill/ingredient_id_missing_5kB_after_v14.json`
- Taxonomy 1k v14: `backend/output/runs/20260128_dsld_phaseD_run1/diagnostics/taxonomy_1k_v14/mismatch_summary_dsld.json`
- Taxonomy 5kA v14: `backend/output/runs/20260128_dsld_phaseD_run1/diagnostics/taxonomy_5kA_v14/mismatch_summary_dsld.json`
- Taxonomy 5kB v14: `backend/output/runs/20260128_dsld_phaseD_run1/diagnostics/taxonomy_5kB_v14/mismatch_summary_dsld.json`
- Outliers gt10 v14b: `backend/output/runs/20260128_dsld_phaseD_run1/compare/outliers_gt10_v14b.jsonl`
- Outliers gt20 v14b: `backend/output/runs/20260128_dsld_phaseD_run1/compare/outliers_gt20_v14b.jsonl`
- Outlier culprits gt10 v14b: `backend/output/runs/20260128_dsld_phaseD_run1/compare/outlier_culprits_gt10_v14b.json`
- Outlier culprits gt20 v14b: `backend/output/runs/20260128_dsld_phaseD_run1/compare/outlier_culprits_gt20_v14b.json`

## 4) Summary
All Phase D v14b gates pass after shadow refresh. The compare deltas are zero, and identity + taxonomy diagnostics are within thresholds. This run is suitable as the frozen baseline for the next DSLD stage.
