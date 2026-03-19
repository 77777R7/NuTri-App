# iHerb Official Fallback Runbook

## Goal

Use the same strict policy across brands:

- merge only `authoritative_overlay_ready`
- merge only `high_confidence_product_page_ready`
- keep every `partial_overlay` inside active queues until all five core fields are complete
- pause `catalog_only` and `conflicted_or_non_us`

## Reusable Capability

The fallback chain is now standardized as:

1. official search and product page fetch
2. `agent-browser` fallback when reader fetches hit `403/429`
3. manual page and brochure filename overrides for tail cleanup
4. manual section overrides only for the final unresolved edge cases

## Brand Config

Start from `data/iherb_official_fallback_configs/template.brand.json` and create a brand-specific config under `data/iherb_official_fallback_configs/`.

Pure is the reference implementation:

- `data/iherb_official_fallback_configs/pure-encapsulations.json`

## Standard Flow

1. Build the strict execution plan.

```bash
npm run gates:f-iherb-overlay-execution-plan -- \
  --staging-json output/pure_p0_official_fallback_final/staging_products.official_refreshed.json \
  --merge-report-json output/iherb_overlay_bulk_merge_pure_p0_official_fallback_final/overlay_merge_coverage_report.json \
  --out-dir output/iherb_overlay_execution_plan_full
```

2. Run the brand fallback wave against the active queue.

```bash
npm run gates:f-iherb-official-fallback-wave -- \
  --config-json data/iherb_official_fallback_configs/pure-encapsulations.json \
  --staging-json output/iherb_overlay_staging/staging_products.json \
  --queue-json output/iherb_overlay_execution_plan_full/active_priority_queue.json \
  --out-dir output/pure_official_fallback_wave
```

3. Re-run strict merge and execution plan on the refreshed staging output.

4. Run the business validation and use `complete_hit_rate` as the primary KPI.

```bash
npm run gates:f-iherb-high-frequency-validation -- \
  --staging-json output/pure_p0_official_fallback_final/staging_products.official_refreshed.json \
  --merge-report-json output/iherb_overlay_bulk_merge_pure_p0_official_fallback_final/overlay_merge_coverage_report.json \
  --queue-json output/iherb_overlay_execution_plan_full/api_fill_priority_queue.json \
  --out-dir output/iherb_overlay_high_frequency_validation
```

## Guardrails

- do not spend current-cycle effort on `catalog_only`
- do not spend current-cycle effort on `conflicted_or_non_us`
- keep images inside the same fallback wave
- promote rows only after `ingredient`, `dosage`, `suggested_use`, `warnings`, and `product_image` are all complete
