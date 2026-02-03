# DSLD Phase D Release (2026-01-31)

This document summarizes the DSLD Phase D shadow-compare run and the evidence pack for auditability.

## Run ID
- `20260128_dsld_phaseD_run1`

## Evidence Pack
- `backend/output/runs/20260128_dsld_phaseD_run1/evidence_pack_dsld_phaseD.json`

## Hard Gates (PASS)
- failuresLines: **0** (invalid facts now recorded via `invalid_source_ids` skip path)
- taxonomyMismatchAmongResolved: **<= 0.08** (1k/5kA/5kB diagnostics in evidence pack)
- changedToEmpty: **0** (sample diff; see `nonempty_diff_dsld.json`)

## Compare Summary (PASS)
- compare file: `backend/output/runs/20260128_dsld_phaseD_run1/compare/compare_summary_valid.json`
- gt20Ratio: **0**
- gt10Ratio: **0**
- matchedBoth: **10631**

## Coverage / Valid Pool
- valid pool: `backend/output/runs/20260128_dsld_phaseD_run1/coverage_facts/after/valid_ids.json`
- invalid IDs recorded via `invalid_source_ids` (facts_not_found)

## Key Artifacts
- Shadow backfill summary:
  - `backend/output/runs/20260128_dsld_phaseD_run1/shadow/backfill_summary_shadow_valid.json`
- Coverage facts backfill summary:
  - `backend/output/runs/20260128_dsld_phaseD_run1/coverage_facts/backfill_missing_ingredients_summary.json`
- Invalid skip test:
  - `backend/output/runs/20260128_dsld_phaseD_run1/coverage_facts/after/invalid_test_summary2.json`

## Notes
- `invalid_source_ids` table created via migration `20260130090000_invalid_source_ids.sql`.
- Missing facts now yield **SKIP** (audited), not failures.

## Next Steps
1. Stage-2 DSLD 50k run with 10k checkpoints.
2. Identity sprint (alias-first) to drive ingredientIdMissingRatio <= 0.10 across 5kA/5kB.
3. Verified promotion (small batch) + single datasetVersion bump after stability gates.
