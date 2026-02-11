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
- 100k scoreable gate: **`PASS`** (trusted pagination-fixed diagnostics/cache; missing gate uses `uniqueMissingKeys/sampleSize`).
- v16 compare gate (snapshot-vs-table): **`PASS`** (`matchedBoth=10000`, `gt10Ratio=0`, `gt20Ratio=0`, `factsHashMismatchRatio=0`).

## Important Audit Note
- Historical pre-fix numbers were impacted by PostgREST 1000-row truncation in diagnostics/cache reads.
- Current trusted baseline is the pagination-fixed 100k result in `/Users/howard07/NuTriApp/nutri-app/backend/output/runs/20260209_dsld_scale_100k_scoreable_v15_run2/scale_100k_gate_summary_v15.json`.
- Compare reliability is now fixed to snapshot-vs-table (baseline snapshot vs promo shadow table), avoiding same-table upsert overwrite bias.
