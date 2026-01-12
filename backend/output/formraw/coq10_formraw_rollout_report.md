# CoQ10 form_raw fallback rollout

## Commands run
- Build runlist:
  - `npx tsx scripts/build-coq10-formraw-rebackfill-lnhpd.ts --limit 20000 --output output/formraw/coq10_formraw_rebackfill.jsonl`
- Rebackfill:
  - `npx tsx scripts/backfill-v4-scores.ts --failures-input output/formraw/coq10_formraw_rebackfill.jsonl --failures-force --batch 100 --concurrency 2 --summary-json output/formraw/coq10_rebackfill_summary.json`
- Root-cause before:
  - `npx tsx scripts/diagnose-zero-coverage-root-causes.ts --source lnhpd --limit 1000 --random-sample --output output/diagnostics/lnhpd_zero_coverage_root_causes_before_coq10.json`
- Root-cause after:
  - `npx tsx scripts/diagnose-zero-coverage-root-causes.ts --source lnhpd --limit 1000 --random-sample --output output/diagnostics/lnhpd_zero_coverage_root_causes_after_coq10.json`
- Taxonomy mismatch check:
  - `npx tsx scripts/diagnose-form-taxonomy-mismatch.ts --source lnhpd --limit 1000 --out-dir output/form-taxonomy/coq10-rollout --top-n 50`

## Runlist + backfill
- Runlist: `output/formraw/coq10_formraw_rebackfill.jsonl`
  - coq10Products=160, missingFormRaw=69, formCoverageZero=60, runlistCount=69
- Rebackfill summary: `output/formraw/coq10_rebackfill_summary.json`
  - processed=69, scores=69, failed=0, ingredientUpsertFailed=0, scoreUpsertFailed=0, computeScoreFailed=0

## Before/after (random sample, N=1000)
- Before: `output/diagnostics/lnhpd_zero_coverage_root_causes_before_coq10.json`
  - zeroCoverageCount=331, mismatch=5
- After: `output/diagnostics/lnhpd_zero_coverage_root_causes_after_coq10.json`
  - zeroCoverageCount=339, mismatch=4
- Delta: mismatch -1 (random sample; directionally flat)

## Taxonomy mismatch gate
- Summary: `output/form-taxonomy/coq10-rollout/mismatch_summary_lnhpd.json`
  - taxonomyMismatchAmongResolved=0.0068 (<= 0.08)

## Interpretation
- CoQ10-specific rebackfill succeeded with 0 failures and preserved low taxonomy mismatch.
- Random-sample mismatch count moved slightly (5 -> 4); sample is stochastic, so this is directionally neutral.

