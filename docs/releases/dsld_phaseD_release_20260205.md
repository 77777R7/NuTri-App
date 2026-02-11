# DSLD Phase D Release 2026-02-05 (v15)

## Scope
- Run ID: `20260205_dsld_phaseD_release_run1`
- Dataset version: `v4.0.0-alpha.3-dsld-phaseD-verified-20260205a`

## Evidence Packs
- Release evidence: `/Users/howard07/NuTriApp/nutri-app/backend/output/runs/20260205_dsld_phaseD_release_run1/evidence_pack_dsld_phaseD_release_v15.json`
- Release + scale50k + scale100k combined evidence: `/Users/howard07/NuTriApp/nutri-app/backend/output/runs/20260205_dsld_phaseD_release_run1/evidence_pack_dsld_phaseD_release_plus_scale50k_plus_scale100k_v15.json`
- 100k refs: `/Users/howard07/NuTriApp/nutri-app/backend/output/runs/20260205_dsld_phaseD_release_run1/scale_100k_refs.json`

## Gate Status
- Release switch gate: `PASS`
- 50k scale gate: `PASS`
- 100k scoreable gate: **trusted recompute `FAIL`** (pagination-fixed diagnostics/cache).

## Important Audit Note
- Historical pre-fix report had “100k scoreable gate PASS”, but that result was impacted by PostgREST 1000-row truncation in diagnostics/cache reads.
- Current trusted baseline is the pagination-fixed 100k result in `/Users/howard07/NuTriApp/nutri-app/backend/output/runs/20260209_dsld_scale_100k_scoreable_v15_run2/scale_100k_gate_summary_v15.json`.
