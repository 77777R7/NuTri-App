# V1 Strict-Only Post-Merge Smoke Check

Executed: `2026-03-18T00:52:25Z`

## Scope

Validate the just-applied V1 strict-only merge cohort at the product-consumption level, with special attention to:

- `NuTri Score V2` completeness
- score module/checklist presence
- deep content completeness
- deep category / category specialization gaps
- runtime decision-support behavior after merge
- Week 3 safety non-regression

## Merge Baseline

Canonical merged cohort:

- merged rows: `22,273 / 22,273`
- blocked: `0`
- queued: `0`
- authoritative DSLD merges: `11,855`
- high-confidence product-page merges: `10,418`

Artifacts:

- [combined_overlay_merge_coverage_report.json](/Users/howard07/NuTriApp/nutri-app/output/p0_p3_v1_strict_only_post_merge_smoke_20260317/combined_overlay_merge_coverage_report.json)
- [apply_canary_2000 report](/Users/howard07/NuTriApp/nutri-app/output/p0_p3_v1_strict_only_merge_cohort_20260318/apply_canary_2000/overlay_merge_coverage_report.json)
- [apply_batch2_10000 report](/Users/howard07/NuTriApp/nutri-app/output/p0_p3_v1_strict_only_merge_cohort_20260318/apply_batch2_10000/overlay_merge_coverage_report.json)
- [apply_remainder_10273 report](/Users/howard07/NuTriApp/nutri-app/output/p0_p3_v1_strict_only_merge_cohort_20260318/apply_remainder_10273/overlay_merge_coverage_report.json)

## Score V2 Readiness

Full merged cohort offline readiness:

- imported total: `22,273`
- `NuTri Score V2` ready: `22,273 / 22,273` (`100%`)
- deep content ready: `22,058 / 22,273` (`99.0%`)
- category specialization hit: `19,274 / 22,273` (`86.5%`)
- error count: `0`

Artifacts:

- [score_v2_readiness_report.json](/Users/howard07/NuTriApp/nutri-app/output/p0_p3_v1_strict_only_post_merge_smoke_20260317/score_v2_readiness/score_v2_readiness_report.json)
- [score_v2_readiness_report.md](/Users/howard07/NuTriApp/nutri-app/output/p0_p3_v1_strict_only_post_merge_smoke_20260317/score_v2_readiness/score_v2_readiness_report.md)

## Deep Category / Category Experience

Validated current merged-cohort category experience summary:

- imported row count: `22,273`
- full-corpus unknown category rate: `13.5%`
- full-corpus deep-content-ready rate: `99.0%`
- validated categories are all `mature`
- weak experience categories: `[]`
- recommendation: move taxonomy lane to maintenance; unknowns are mostly long-tail cleanup

Validated mature lanes:

- `probiotics`
- `magnesium`
- `sleep_stress_mood_support`
- `botanical_herbal_support`
- `metabolic_glucose_support`
- `cholesterol_lipid_support`
- `liver_bile_support`
- `fish_oil_omega3`

Artifacts:

- [category_experience_validation_pack.json](/Users/howard07/NuTriApp/nutri-app/output/p0_p3_v1_strict_only_post_merge_smoke_20260317/category_experience/category_experience_validation_pack.json)
- [category_experience_validation_pack.md](/Users/howard07/NuTriApp/nutri-app/output/p0_p3_v1_strict_only_post_merge_smoke_20260317/category_experience/category_experience_validation_pack.md)
- [full_audit_stub.json](/Users/howard07/NuTriApp/nutri-app/output/p0_p3_v1_strict_only_post_merge_smoke_20260317/full_audit_stub.json)

## Sample Harness

Category/score sample harness on `200` merged products:

- score V2 ready rate: `100%`
- deep content ready rate: `99.5%`
- unknown category rate: `8.5%`
- category mismatch rate: `0%`

Top blocker distribution in sampled rows:

- `missing_form_high_impact`: `19`
- `missing_active_breakdown`: `6`

Artifacts:

- [sample_manifest.json](/Users/howard07/NuTriApp/nutri-app/output/p0_p3_v1_strict_only_post_merge_smoke_20260317/harness_sample/sample_manifest.json)
- [decision_support_results.jsonl](/Users/howard07/NuTriApp/nutri-app/output/p0_p3_v1_strict_only_post_merge_smoke_20260317/harness_sample/decision_support_results.jsonl)
- [quality_summary.json](/Users/howard07/NuTriApp/nutri-app/output/p0_p3_v1_strict_only_post_merge_smoke_20260317/harness_sample/quality_summary.json)
- [anomaly_buckets.json](/Users/howard07/NuTriApp/nutri-app/output/p0_p3_v1_strict_only_post_merge_smoke_20260317/harness_sample/anomaly_buckets.json)

## Runtime Probe

Representative runtime probe over `8` merged barcodes:

- HTTP success: `8 / 8`
- score V2 complete: `8 / 8`
- deep content complete: `8 / 8`
- unknown category count: `0`

Important nuance:

- one barcode that appeared `unknown` in the offline harness (`Force Factor Volcano`) classified at runtime as `sports_performance_amino_acids`
- this means the runtime path is at least slightly better than the offline staged-row harness on some tail rows

Artifacts:

- [runtime_decision_support_probe_summary.json](/Users/howard07/NuTriApp/nutri-app/output/p0_p3_v1_strict_only_post_merge_smoke_20260317/runtime_decision_support_probe_summary.json)
- [fish_oil runtime audit](/Users/howard07/NuTriApp/nutri-app/output/p0_p3_v1_strict_only_post_merge_smoke_20260317/runtime_audits/fish_oil_omega3/20260318T004932Z/overlay_trace_00088395016325.md)
- [probiotics runtime audit](/Users/howard07/NuTriApp/nutri-app/output/p0_p3_v1_strict_only_post_merge_smoke_20260317/runtime_audits/probiotics/20260318T004932Z/overlay_trace_00037000505051.md)
- [metabolic runtime audit](/Users/howard07/NuTriApp/nutri-app/output/p0_p3_v1_strict_only_post_merge_smoke_20260317/runtime_audits/metabolic_glucose_support/20260318T004932Z/overlay_trace_00693749048008.md)
- [unknown candidate runtime audit](/Users/howard07/NuTriApp/nutri-app/output/p0_p3_v1_strict_only_post_merge_smoke_20260317/runtime_audits/unknown/20260318T004932Z/overlay_trace_00818594011759.md)

## Remaining Deep Category Tail

Deep category is not fully closed across the merged cohort. Confirmed runtime `unknown` examples still exist:

- `Solaray, Respiration Blend SP-3, 100 VegCaps`
- `Sports Research, CLA 1250, Max Strength, 1,250 mg, 90 Softgels`
- `California Gold Nutrition, Colostrum with 20% IgG Immunoglobulins, 240 Veggie Capsules`

All three still returned `categoryId = unknown` at runtime, despite having working score V2 payloads.

Artifact:

- [runtime_unknown_tail_probe_summary.json](/Users/howard07/NuTriApp/nutri-app/output/p0_p3_v1_strict_only_post_merge_smoke_20260317/runtime_unknown_tail_probe_summary.json)

## Non-Regression Checks

Passing tests:

- [decision-support-category-expansion.test.mjs](/Users/howard07/NuTriApp/nutri-app/backend/tests/decision-support-category-expansion.test.mjs)
- [decision-support-contract.test.mjs](/Users/howard07/NuTriApp/nutri-app/backend/tests/decision-support-contract.test.mjs)
- [recent-scan-save-chain-contract.test.mjs](/Users/howard07/NuTriApp/nutri-app/backend/tests/recent-scan-save-chain-contract.test.mjs)

Week 3 safety harness:

- pass: `16 / 16`
- no regression detected in duplicate ingredient / UL behavior

## Verdict

Product-level conclusion after merge:

- `NuTri Score V2` is healthy on the merged strict-only cohort
- score modules/checklists are not missing in the merged cohort
- deep content is healthy, but not perfect
- representative runtime probes are healthy
- Week 3 safety did not regress
- deep category is improved enough for V1, but still has a real long-tail `unknown` residue

Recommended product decision:

- keep the V1 strict-only merge as valid
- treat `Deep Category unknown` as a long-tail cleanup lane, not as a blocker for this merge
- do not reopen `queued`
