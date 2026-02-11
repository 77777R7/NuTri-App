# DSLD Phase D External Audit Summary (One Pager)

## Release Decision
**Status: PASS (Release + Scale Closed Loop Complete)**

As of **2026-02-11**, DSLD Phase D meets the closure standard:
- Release switch: PASS
- 50k scale gate: PASS
- 100k scoreable scale gate: PASS
- v16 compare (snapshot-vs-table): PASS

## Scope and Version
- Dataset version: `v4.0.0-alpha.3-dsld-phaseD-verified-20260205a`
- Release run: `/Users/howard07/NuTriApp/nutri-app/backend/output/runs/20260205_dsld_phaseD_release_run1`
- 100k run: `/Users/howard07/NuTriApp/nutri-app/backend/output/runs/20260209_dsld_scale_100k_scoreable_v15_run2`
- Compare run: `/Users/howard07/NuTriApp/nutri-app/backend/output/runs/20260210_dsld_promo_v16_run1/compare_v16g`

## Gate Policy (Applied)
- `coverage >= 0.80`
- `missingRatio <= 0.10`
- `taxonomyMismatchAmongResolved <= 0.08`
- `changedToEmptyCount == 0`
- `failuresLines == 0`

Missing ratio for 100k is evaluated as **`uniqueMissingKeys / sampleSize`** (trusted gate metric).  
`activeMissingRows / sampleSize` is retained as audit/debug context only.

## 100k Gate Results (Trusted)
Source: `/Users/howard07/NuTriApp/nutri-app/backend/output/runs/20260209_dsld_scale_100k_scoreable_v15_run2/scale_100k_gate_summary_v15.json`

| Part | missingRatio | taxonomyMismatch | changedToEmpty | failuresLines | coverage |
|---|---:|---:|---:|---:|---:|
| 000 | 0.0981 | 0.0469 | 0 | 0 | 1.00 |
| 001 | 0.0867 | 0.0470 | 0 | 0 | 1.00 |
| 002 | 0.0652 | 0.0448 | 0 | 0 | 1.00 |
| 003 | 0.0954 | 0.0339 | 0 | 0 | 1.00 |
| 004 | 0.0789 | 0.0314 | 0 | 0 | 1.00 |
| 005 | 0.0736 | 0.0268 | 0 | 0 | 1.00 |
| 006 | 0.0922 | 0.0307 | 0 | 0 | 1.00 |

Overall: `pass=true`, `failingParts=[]`, `incompleteParts=[]`.

## v16 Compare Results (Risk Budget)
Source: `/Users/howard07/NuTriApp/nutri-app/backend/output/runs/20260210_dsld_promo_v16_run1/compare_v16g/product_scores_compare_v16g_vs_baseline_snapshot_10k.json`

- Mode: `snapshot-vs-table`
  - A: baseline snapshot JSONL
  - B: `product_scores_shadow` (`dsld-promo-v16g`)
- `matchedBoth = 10000`
- `missingA = 0`, `missingB = 0`
- `gt10Ratio = 0`
- `gt20Ratio = 0`
- `factsHash mismatchRatio = 0`

Risk budget verdict: **PASS**.

## Runtime and Data-State Signoff
- Supabase `public.scoring_dataset_state` (`key=ingredient_dataset`) is aligned to:
  - `v4.0.0-alpha.3-dsld-phaseD-verified-20260205a`
- Render service URL:
  - `https://nutri-app-qn0u.onrender.com`
- Combined evidence pack signoff:
  - `/Users/howard07/NuTriApp/nutri-app/backend/output/runs/20260205_dsld_phaseD_release_run1/evidence_pack_dsld_phaseD_release_plus_scale50k_plus_scale100k_v15.json`

## Evidence Pack Index
- Release pack:  
  `/Users/howard07/NuTriApp/nutri-app/backend/output/runs/20260205_dsld_phaseD_release_run1/evidence_pack_dsld_phaseD_release_v15.json`
- 100k gate summary:  
  `/Users/howard07/NuTriApp/nutri-app/backend/output/runs/20260209_dsld_scale_100k_scoreable_v15_run2/scale_100k_gate_summary_v15.json`
- 100k evidence pack:  
  `/Users/howard07/NuTriApp/nutri-app/backend/output/runs/20260209_dsld_scale_100k_scoreable_v15_run2/evidence_pack_dsld_scale_100k_v15.json`
- 100k refs (release-linked):  
  `/Users/howard07/NuTriApp/nutri-app/backend/output/runs/20260205_dsld_phaseD_release_run1/scale_100k_refs.json`
- v16 compare summary:  
  `/Users/howard07/NuTriApp/nutri-app/backend/output/runs/20260210_dsld_promo_v16_run1/compare_v16g/product_scores_compare_v16g_vs_baseline_snapshot_10k.json`

## Automation Operating State
To prevent stale or duplicate monitoring jobs:
- Active: `dsld-closure-monitor`
- Paused: `dsld-release-rebackfill-monitor`, `dsld-scale-50k-monitor`, `dsld-scale-scoreable-monitor`

This state preserves one authoritative closure巡检 path while minimizing operational noise.
