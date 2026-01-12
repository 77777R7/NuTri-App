# LNHPD form_raw rollout report

## Commands run

Fixed-sample runlist:
- Generated JSONL from `output/diagnostics/lnhpd_sample_ids.json` into `output/formraw/formraw_rebackfill_lnhpd_fixed_sample.jsonl`.

Fixed-sample rebackfill:
- `npx tsx scripts/backfill-v4-scores.ts --failures-input output/formraw/formraw_rebackfill_lnhpd_fixed_sample.jsonl --failures-force --batch 100 --concurrency 2`

Fixed-sample compare:
- `npx tsx scripts/diagnose-form-coverage-compare.ts --source lnhpd --source-ids-file output/diagnostics/lnhpd_sample_ids.json --output output/diagnostics/lnhpd_after_formraw.json --compare output/diagnostics/lnhpd_before.json --compare-output output/diagnostics/lnhpd_compare_formraw.json`

5k runlist:
- `npx tsx scripts/build-formraw-rebackfill-lnhpd.ts --limit 5000 --output output/formraw/formraw_rebackfill_lnhpd_5k.jsonl`

5k rebackfill:
- `npx tsx scripts/backfill-v4-scores.ts --failures-input output/formraw/formraw_rebackfill_lnhpd_5k.jsonl --failures-force --batch 100 --concurrency 2`

## Counts

Fixed-sample runlist:
- N=1000 lines in `output/formraw/formraw_rebackfill_lnhpd_fixed_sample.jsonl`
- Backfill processed=1000, failures=0

5k runlist:
- lines=461 in `output/formraw/formraw_rebackfill_lnhpd_5k.jsonl`
- Backfill processed=461, failures=0

## Before/after metrics (fixed sample)

From `output/diagnostics/lnhpd_compare_formraw.json`:
- ingredientIdMissingRatio: 0.4263 -> 0.343 (delta -0.0833)
- ingredientIdResolvedRatio: 0.5737 -> 0.657 (delta +0.0833)
- formRawMissingAmongResolved: 0.999 -> 0.273 (delta -0.726)
- formRawMissing: 0.5732 -> 0.1793 (delta -0.3939)
- taxonomyMismatch: 0.0078 -> 0.0782 (delta +0.0704)
- zeroCoverageRatio: 0.84 -> 0.84 (no change)

## Interpretation

- form_raw extraction is now working: formRawMissingAmongResolved dropped materially (0.999 -> 0.273).
- taxonomyMismatch increased because more rows now have form_raw tokens that do not map to ingredient_forms; this is expected until form aliases/forms coverage improves.
- zeroCoverageRatio did not worsen.

## Recommendation

- Keep concurrency at 2 for now; if the next 5k batch remains 0 failures, consider raising to 3.
- Continue rolling 5k batches while monitoring taxonomyMismatch and formRawNoMatch.
- Resume orchestrator after this rollout batch.
