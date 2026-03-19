# Nutricost Official Recovery Execution Result

- Date: 2026-03-17
- Scope: Nutricost-only execution. Shared control-plane files were not modified.

## Canonical evidence inspected

- `docs/exec-plans/active/p0_p3_product_closure/queued_brand_target_match_matrix.json`
  - Nutricost is marked `active_queue` with `49` total, `17` complete hits, and `32` active rows.
  - The matrix points to the P0 US strong-identity lane and references `output/iherb_partial_wave_plan_week2_remaining_now_batch2_20260313/official_brand_queues/nutricost.json`.
- `output/p0_p3_highfreq_schiff_healthy_natures_bounty_nature_made_pure_encapsulations_20260317/high_frequency_hit_details.json`
  - Current Nutricost canonical actives are DSLD-backed rows keyed by barcode, still missing `suggested_use`, `warnings`, and `product_image`.
- `output/p0_p3_highfreq_schiff_healthy_natures_bounty_nature_made_pure_encapsulations_20260317/high_frequency_hit_validation.json`
  - Current canonical validation uses `output/p0_p3_official_bootstrap_pure_encapsulations_active38_20260317/staging_products.official_refreshed.json` as the staging baseline.

## Queue re-materialization

- The older Nutricost official queue contained `41` rows, but it had `0` barcode overlap with the current `32` canonical Nutricost active rows.
- I re-materialized a fresh Nutricost queue from the current canonical active barcodes matched against the current staging baseline.
- Re-materialized queue stats:
  - canonical active rows: `32`
  - re-materialized queue rows: `32`
  - missing from staging: `0`
  - missing-field rollup: `suggested_use=32`, `warnings=32`, `product_image=32`
- Queue artifacts written to:
  - `output/p0_p3_nutricost_official_recovery_20260317/official_fallback_bootstrap_queue.json`
  - `output/p0_p3_nutricost_official_recovery_20260317/queue_rematerialization_summary.json`

## Commands run

1. Re-materialized the current Nutricost queue with a one-off `python3` transform from:
   - `output/p0_p3_highfreq_schiff_healthy_natures_bounty_nature_made_pure_encapsulations_20260317/high_frequency_hit_details.json`
   - `output/p0_p3_official_bootstrap_pure_encapsulations_active38_20260317/staging_products.official_refreshed.json`
   - `output/iherb_partial_wave_plan_week2_remaining_now_batch2_20260313/official_brand_queues/nutricost.json`
2. Ran the live Nutricost official recovery wave:

```bash
node scripts/maintainer/run-iherb-official-fallback-parallel.mjs \
  --config-json data/iherb_official_fallback_configs/nutricost.json \
  --staging-json output/p0_p3_official_bootstrap_pure_encapsulations_active38_20260317/staging_products.official_refreshed.json \
  --queue-json output/p0_p3_nutricost_official_recovery_20260317/official_fallback_bootstrap_queue.json \
  --out-dir output/p0_p3_nutricost_official_recovery_20260317 \
  --brand Nutricost \
  --priority-lane P0_api_fill_us_strong_identity \
  --concurrency 4 \
  --shards 4 \
  --delay-ms 250
```

3. Inspected:
   - `output/p0_p3_nutricost_official_recovery_20260317/official_fallback_report.json`
   - `output/p0_p3_nutricost_official_recovery_20260317/official_fallback_seed.json`
   - shard reports under `output/p0_p3_nutricost_official_recovery_20260317/_tmp/`

## Recovery output

- Final output directory: `output/p0_p3_nutricost_official_recovery_20260317`
- Processed rows: `32 / 32`
- Improved rows: `3`
- Became full-overlay-ready: `3`
- Catalog hits: `3`
- Page hits: `3`
- Image OCR hits: `3`
- Search hits: `0`
- PDF hits: `0`
- Remaining rows still missing `suggested_use`, `warnings`, and `product_image`: `29`

## Improved products

- `269804` | `Testosterone Complex`
  - matched via `catalog_api:title`
  - filled `suggested_use`, `warnings`, `product_image`
  - official page: `https://nutricost.com/products/nutricost-testosterone-complex-863mg-90-capsules`
- `308234` | `L-Citrulline Malate 2:1 3 g Blue Raspberry`
  - matched via `catalog_api:title`
  - filled `suggested_use`, `warnings`, `product_image`
  - official page: `https://nutricost.com/products/nutricost-l-citrulline-malate-2-1-flavored-powder`
- `223363` | `L-Citrulline Malate 2:1 3 g Unflavored`
  - matched via `catalog_api:title`
  - filled `suggested_use`, `warnings`, `product_image`
  - official page: `https://nutricost.com/products/nutricost-l-citrulline-malate-2-1-powder-600-grams`

## Execution health

- Aggregate shard execution health:
  - requests: `74`
  - fetchSuccess: `53`
  - http429: `21`
  - aborted: `0`
  - cacheHits: `57`
  - retryCount: `16`
- Shard split:
  - shard 1: `1` improved
  - shard 2: `1` improved
  - shard 3: `0` improved
  - shard 4: `1` improved

## Merge / validation readiness

- This is a real positive Nutricost recovery wave: it converted `3` current canonical active rows into full-overlay-ready rows.
- It is not ready for a blind canonical merge.
  - All `3` wins relied on label-image OCR for `Suggested use` and `Warnings`.
  - The recovered OCR text is visibly noisy/truncated and should be spot-checked before any canonical adoption.
- Recommended call:
  - `merge-ready for gated review`: yes
  - `ready for immediate canonical merge`: no
  - `ready for high-frequency validation after manual spot-check of the 3 improved rows`: yes
- Canonical merge and high-frequency validation were not executed here because the requested write scope excluded shared control-plane updates.
