# Canonical Create Batch 1 Report (LNHPD)

## Approved List (30)
- inositol
- coenzyme_q10
- flaxseed
- citrus_bioflavonoids
- goldenseal
- alfalfa
- wild_yam
- trifolium_pratense
- eucalyptus
- mentha_x_piperita
- serenoa_repens
- atractylodes_macrocephala
- codonopsis_pilosula
- equisetum_arvense
- paeonia_lactiflora
- poria_cocos
- daucus_carota
- plantago_major
- rheum_palmatum
- arctium_lappa
- rehmannia_glutinosa
- lecithin
- olea_europaea
- ziziphus_jujuba
- cynara_scolymus
- actaea_racemosa
- black_pepper
- plantago_ovata
- avena_sativa
- paullinia_cupana

## Apply Summary
- datasetVersion: {apply_summary.get('datasetVersion')}
- ingredientsCreated: {apply_summary['summary'].get('ingredientsCreated')}
- synonymsInserted: {apply_summary['summary'].get('synonymsInserted')}
- rebackfillTargets: {apply_summary['summary'].get('rebackfillTargets')}
- applySummaryPath: backend/output/ingredient-resolution/canonical_create_apply_summary.json

## Rebackfill Summary
- runlistLines: {rebackfill_lines}
- processed: 894
- failed: 0
- ingredientUpsertFailed: 0
- scoreUpsertFailed: 0
- computeScoreFailed: 0

## Diagnose Form Coverage (LNHPD, limit=1000)
- zeroCoverageRatio: {lnhpd_diagnose['zeroCoverageRatio']}
- ingredientIdMissingRatio: {lnhpd_diagnose['ingredientIdMissingRatio']}
- formRawMissingRatio: {lnhpd_diagnose['formRawMissingRatio']}
- ingredientFormsMissingRatio: {lnhpd_diagnose['ingredientFormsMissingRatio']}
- matchedRatio: {lnhpd_diagnose['matchedRatio']}
- taxonomyMismatchRatio: {lnhpd_diagnose['taxonomyMismatchRatio']}

## Sprint Summary Deltas (LNHPD limit=1000)
- canonical_missing: {before_canonical_missing} -> {after_canonical_missing} (delta {after_canonical_missing - before_canonical_missing})
- true_no_candidates: {before_no_candidates} -> {after_no_candidates} (delta {after_no_candidates - before_no_candidates})

## Files
- Plan: backend/output/ingredient-resolution/canonical_create_plan.json
- Runlist: backend/output/ingredient-resolution/canonical_create_rebackfill.jsonl
- Sprint before: backend/output/ingredient-resolution/lnhpd_limit1000.json
- Sprint after: backend/output/ingredient-resolution/lnhpd_after_create_limit1000.json
