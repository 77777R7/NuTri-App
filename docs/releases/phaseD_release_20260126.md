# Phase D Release Notes (LNHPD) — Verified Promotion Release

Release date: 2026-01-26
Run ID (compare + evidence pack): 20260125_phaseD_v9_scaledpool_run2
Release switch (datasetVersion): v4.0.0-alpha.3-phaseD-verified-20260126b

## Scope
This release promotes a small, verified subset of forms/evidence and enables it in scoring.
Changes are evaluated using shadow compare (baseline vs shadow) with a frozen input pool.

## Evidence Pack (audit)
- Evidence pack: `backend/output/runs/20260125_phaseD_v9_scaledpool_run2/evidence_pack_phaseD_v9.json`
- Compare summary: `backend/output/runs/20260125_phaseD_v9_scaledpool_run2/compare/compare_summary.json`
- Facts hash breakdown: `backend/output/runs/20260125_phaseD_v9_scaledpool_run2/compare/facts_hash_breakdown.json`
- Diagnostics (1k/5kA/5kB): `backend/output/runs/20260125_phaseD_v9_scaledpool_run2/diagnostics/`

## Gate Results
Compare gates (A/B):
- totalIds: 10651
- gt20Ratio: 0
- gt10Ratio: 0.0002 (2 / 10651)

Hard gates:
- failuresLines: 0 (baseline + shadow)
- taxonomyMismatchAmongResolved:
  - 1k: 0.0305
  - 5kA: 0.0507
  - 5kB: 0.0448
- ingredientIdMissingRatio:
  - 1k: 0.0534
  - 5kA: 0.0079
  - 5kB: 0.0296
- changedToEmpty: 0 (5kA/5kB full snapshots)
- factsHash: coverage 1.0, mismatches 0

## Release Switch
Dataset version was bumped to enable verified promotions in scoring:
- `v4.0.0-alpha.3-phaseD-verified-20260126b`

## Targeted Rebackfill (release window)
Purpose: apply promoted knowledge to affected products.

Run ID: 20260126_phaseD_release_run1
Summary:
- processed: 1000
- scores written: 616
- existing: 384
- failuresLines: 0
- summary: `backend/output/runs/20260126_phaseD_release_run1/rebackfill/promotion_rebackfill_summary.json`
- evidence: `backend/output/runs/20260126_phaseD_release_run1/evidence_pack_phaseD_release.json`

## Rollback Plan
- Revert `scoring_dataset_state` to the previous version.
- Re-run targeted rebackfill with the prior datasetVersion.
- Re-compare if needed using the same union input pool.

## Verification Commands (for audit)
- Compare summary:
  - `cat backend/output/runs/20260125_phaseD_v9_scaledpool_run2/compare/compare_summary.json`
- Evidence pack:
  - `cat backend/output/runs/20260125_phaseD_v9_scaledpool_run2/evidence_pack_phaseD_v9.json`
- Release rebackfill summary:
  - `cat backend/output/runs/20260126_phaseD_release_run1/rebackfill/promotion_rebackfill_summary.json`

## Status
Release gates PASS. Verified promotion is now active in scoring via datasetVersion bump.
