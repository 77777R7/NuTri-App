# Canadian Dual Admission Closure - 2026-04-20

## Scope

Continue the Canadian dual admission queue after productId-backed search detail support landed.

This closure covered:

- the remaining `scan_lookup_needed` tail
- the next `search_ready_detail_rich_no_upc` batch
- refreshed queue state after the new batch was applied

## Fresh evidence

### Scan lookup closure

- wave: `canadian_scan_lookup_wave_03`
- rows merged: `2/2`
- post-merge validation: `2/2 pass`, `0 fail`
- brand: `Webber Naturals`

Artifacts:

- `output/canadian_brand_full_coverage_wave_v0/admission_waves/canadian_scan_lookup_wave_03/staging_products.canadian_scan_lookup_wave_03.json`
- `output/canadian_brand_full_coverage_wave_v0/admission_waves/canadian_scan_lookup_wave_03/apply/overlay_merge_coverage_report.json`
- `output/canadian_brand_full_coverage_wave_v0/admission_waves/canadian_scan_lookup_wave_03/post_merge_validation_rerun/canadian_official_post_merge_validation.json`

### Search-ready wave 01

- wave: `canadian_search_ready_wave_01`
- rows merged: `25/25`
- runtime validation: `25/25 pass`, `0 warn`, `0 fail`
- detail runtime: `25 ready`, `0 failed`

Artifacts:

- `output/canadian_brand_full_coverage_wave_v0/admission_waves/canadian_search_ready_wave_01/apply/canadian_search_ready_apply_report.json`
- `output/canadian_brand_full_coverage_wave_v0/admission_waves/canadian_search_ready_wave_01/validation_product_detail_rerun/canadian_search_ready_validation.json`

### Search-ready wave 02

- wave: `canadian_search_ready_wave_02`
- rows selected: `25`
- brand mix: `Organika 25`
- dry-run admission: `25 eligible`, `0 blocked`
- apply: `25 merged`, `0 blocked`
- runtime validation: `25/25 pass`, `0 warn`, `0 fail`
- warm rerun: `25/25 pass`, `0 warn`, `0 fail`
- detail runtime: `25 ready`, `0 failed`

Artifacts:

- `output/canadian_brand_full_coverage_wave_v0/admission_waves/canadian_search_ready_wave_02/staging_products.canadian_search_ready_wave_02.json`
- `output/canadian_brand_full_coverage_wave_v0/admission_waves/canadian_search_ready_wave_02/dry_run/canadian_search_ready_apply_report.json`
- `output/canadian_brand_full_coverage_wave_v0/admission_waves/canadian_search_ready_wave_02/apply/canadian_search_ready_apply_report.json`
- `output/canadian_brand_full_coverage_wave_v0/admission_waves/canadian_search_ready_wave_02/validation/canadian_search_ready_validation.json`
- `output/canadian_brand_full_coverage_wave_v0/admission_waves/canadian_search_ready_wave_02/validation_warm_pass_01/canadian_search_ready_validation.json`

### Search-ready wave 03

- wave: `canadian_search_ready_wave_03`
- rows selected: `25`
- brand mix: `Botanica 20`, `New Roots Herbal 4`, `Organika 1`
- dry-run admission: `25 eligible`, `0 blocked`
- apply: `25 merged`, `0 blocked`
- runtime validation: `0/25 pass`, `0 warn`, `25 fail`
- detail runtime: `24 ready`, `1 failed`

Observed failure shape:

- `25/25` failed on `search_exact_identity_missing`
- `1` row (`Botanica Olive Leaf Throat Spray - Peppermint`) returned `detail_missing_scientific_background`

Interpretation:

- this wave is useful as discovery evidence
- it is not stable-gate material yet
- the current dual-admission selector is still too permissive for some generic botanical / liquid-herb / spray titles

Artifacts:

- `output/canadian_brand_full_coverage_wave_v0/admission_waves/canadian_search_ready_wave_03/staging_products.canadian_search_ready_wave_03.json`
- `output/canadian_brand_full_coverage_wave_v0/admission_waves/canadian_search_ready_wave_03/dry_run/canadian_search_ready_apply_report.json`
- `output/canadian_brand_full_coverage_wave_v0/admission_waves/canadian_search_ready_wave_03/apply/canadian_search_ready_apply_report.json`
- `output/canadian_brand_full_coverage_wave_v0/admission_waves/canadian_search_ready_wave_03/validation/canadian_search_ready_validation.json`

### Search-ready wave 04 preview

- wave: `canadian_search_ready_wave_04_preview`
- rows selected: `25`
- brand mix: `AOR 8`, `New Roots Herbal 8`, `Botanica 6`, `Organika 2`, `Purica 1`
- dry-run admission: `25 eligible`, `0 blocked`
- apply: `25 merged`, `0 blocked`
- runtime validation: `25/25 pass`, `0 warn`, `0 fail`
- warm rerun: `25/25 pass`, `0 warn`, `0 fail`
- detail runtime: `25 ready`, `0 failed`

Artifacts:

- `output/canadian_brand_full_coverage_wave_v0/admission_waves/canadian_search_ready_wave_04_preview/staging_products.canadian_search_ready_wave_04_preview.json`
- `output/canadian_brand_full_coverage_wave_v0/admission_waves/canadian_search_ready_wave_04_preview/dry_run/canadian_search_ready_apply_report.json`
- `output/canadian_brand_full_coverage_wave_v0/admission_waves/canadian_search_ready_wave_04_preview/apply/canadian_search_ready_apply_report.json`
- `output/canadian_brand_full_coverage_wave_v0/admission_waves/canadian_search_ready_wave_04_preview/validation/canadian_search_ready_validation.json`
- `output/canadian_brand_full_coverage_wave_v0/admission_waves/canadian_search_ready_wave_04_preview/validation_warm_pass_01/canadian_search_ready_validation.json`

### Search-ready wave 05

- wave: `canadian_search_ready_wave_05`
- rows selected: `25`
- brand mix: `New Roots Herbal 25`
- dry-run admission: `25 eligible`, `0 blocked`
- apply: `25 merged`, `0 blocked`
- runtime validation: `23/25 pass`, `2 warn`, `0 fail`
- warm rerun: `23/25 pass`, `2 warn`, `0 fail`
- detail runtime: `25 ready`, `0 failed`

Warn shape:

- `New Roots Herbal | Co-Enzyme Q10 · 300 mg` -> `rank 4`
- `New Roots Herbal | Co-Enzyme Q10 · 60 mg` -> `rank 5`

Both warnings remained within the same brand/family and still resolved to working detail pages.

Artifacts:

- `output/canadian_brand_full_coverage_wave_v0/admission_waves/canadian_search_ready_wave_05/staging_products.canadian_search_ready_wave_05.json`
- `output/canadian_brand_full_coverage_wave_v0/admission_waves/canadian_search_ready_wave_05/dry_run/canadian_search_ready_apply_report.json`
- `output/canadian_brand_full_coverage_wave_v0/admission_waves/canadian_search_ready_wave_05/apply/canadian_search_ready_apply_report.json`
- `output/canadian_brand_full_coverage_wave_v0/admission_waves/canadian_search_ready_wave_05/validation/canadian_search_ready_validation.json`
- `output/canadian_brand_full_coverage_wave_v0/admission_waves/canadian_search_ready_wave_05/validation_warm_pass_01/canadian_search_ready_validation.json`

## Queue state after wave 02

Refreshed from:

- `output/canadian_brand_full_coverage_wave_v0/dual_admission_queue_01/canadian_dual_admission_queue.json`

Current summary:

- total catalog rows: `2998`
- queued rows: `2514`
- `next_scan_wave`: `0`
- `next_search_ready_wave`: `203`
- `already_covered`: `880`
- `residual`: `1431`

`next_search_ready_wave` by brand:

- `New Roots Herbal`: `98`
- `Platinum Naturals`: `43`
- `Organika`: `38`
- `Botanica`: `14`
- `AOR`: `8`
- `Purica`: `2`

## Product-surface meaning

This line is now in a better state than before:

- no remaining Canadian `scan_ready_now` rows are waiting to be pushed
- the old `scan_lookup_needed` tail was closed
- no-UPC Canadian products can now open detail through `productId`, so search-ready rows are no longer trapped at search-card only
- wave 02 proved the high-confidence search-ready lane can merge cleanly and validate cleanly
- wave 03 exposed a real selector quality boundary, so we now have concrete evidence for which cohorts should stay discovery-only

## Recommended next step

Stay on the dual admission queue and continue small search-ready waves from:

- `next_search_ready_wave`
- bucket `search_ready_detail_rich_no_upc`

Suggested next batch size:

- `20-30` rows per wave

Current high-yield brands for the next wave:

- `New Roots Herbal`
- `Platinum Naturals`
- `Organika`

Current brands to treat more cautiously:

- `Botanica` generic liquid herb / spray titles

## Selector tightening after wave 03

The selector was tightened to downgrade no-UPC rows that look too generic for search-ready admission, specifically:

- liquid herb / liquid capsules / throat spray style titles
- generic botanical titles that only differ by weak form tokens or promo wording

Code touched:

- `scripts/maintainer/lib/canadian-dual-admission-queue.mjs`
- `tests/validation/canadian-dual-admission-queue.test.mjs`

Fresh validation:

- `node --test tests/validation/canadian-dual-admission-queue.test.mjs`
- `git diff --check -- scripts/maintainer/lib/canadian-dual-admission-queue.mjs tests/validation/canadian-dual-admission-queue.test.mjs`

Fresh queue state after tightening and wave 05 apply:

- `next_search_ready_wave`: `142` (down from `203`)
- `residual`: `1442` (up from `1431`)
- `already_covered`: `930`
- downgraded generic rows: `20`

Brand impact inside `next_search_ready_wave`:

- `Botanica`: `14 -> 0` in the next mainline queue after wave 04 apply
- `AOR`: `8 -> 0` in the next mainline queue after wave 04 apply
- `New Roots Herbal`: `98 -> 63`
- `Organika`: `38 -> 35`
- `Purica`: `2 -> 1`
- `Platinum Naturals`: `43 -> 43`

Representative downgraded rows:

- `Botanica | Rhodiola Liquid Herb`
- `Botanica | St Johns Wort Liquid Capsules`
- `Botanica | Turmeric Liquid Herb`
- `Botanica | Valerian Liquid Herb`
- `St. Francis Herb Farm | allergy relief nasal spray`
- `Prairie Naturals | mountain mist conditioning spray`

Interpretation:

- the search-ready queue is now less polluted by generic liquid herb / spray cohorts
- wave 04 confirmed that the tightened selector can produce another clean 25/25 runtime batch
- wave 05 confirmed that the remaining `New Roots Herbal` lane is mostly stable, with only mild same-family strength-ranking warns
- the next mainline queue is now concentrated in `New Roots Herbal`, `Platinum Naturals`, and a smaller `Organika` tail

## Catalog-strong no-UPC lane

The remaining Canadian search-ready queue eventually collapsed into a separate lane:

- `search_ready_catalog_strong_no_upc`

This lane was treated as discovery-first and validated with brand canaries before any broader promotion.

### Platinum Naturals canary 01

- wave: `canadian_catalog_strong_canary_platinum_01`
- rows selected: `10`
- dry-run admission: `10 eligible`, `0 blocked`
- apply: `10 merged`, `0 blocked`
- runtime validation: `10/10 pass`, `0 warn`, `0 fail`
- warm rerun: `10/10 pass`, `0 warn`, `0 fail`
- detail runtime: `10 ready`, `0 failed`

Interpretation:

- `Platinum Naturals` catalog-strong no-UPC rows can be promoted beyond canary

Artifacts:

- `output/canadian_brand_full_coverage_wave_v0/admission_waves/canadian_catalog_strong_canary_platinum_01/staging_products.canadian_catalog_strong_canary_platinum_01.json`
- `output/canadian_brand_full_coverage_wave_v0/admission_waves/canadian_catalog_strong_canary_platinum_01/apply/canadian_search_ready_apply_report.json`
- `output/canadian_brand_full_coverage_wave_v0/admission_waves/canadian_catalog_strong_canary_platinum_01/validation/canadian_search_ready_validation.json`
- `output/canadian_brand_full_coverage_wave_v0/admission_waves/canadian_catalog_strong_canary_platinum_01/validation_warm_pass_01/canadian_search_ready_validation.json`

### Organika canary 01

- wave: `canadian_catalog_strong_canary_organika_01`
- rows selected: `10`
- dry-run admission: `10 eligible`, `0 blocked`
- apply: `10 merged`, `0 blocked`
- runtime validation: `0/10 pass`, `0 warn`, `10 fail`
- detail runtime: `10 ready`, `0 failed`
- failure shape: `10/10 search_exact_identity_missing`

Interpretation:

- `Organika` catalog-strong no-UPC rows should not be promoted as a stable lane yet
- they remain discovery / residual until search identity improves

Artifacts:

- `output/canadian_brand_full_coverage_wave_v0/admission_waves/canadian_catalog_strong_canary_organika_01/staging_products.canadian_catalog_strong_canary_organika_01.json`
- `output/canadian_brand_full_coverage_wave_v0/admission_waves/canadian_catalog_strong_canary_organika_01/apply/canadian_search_ready_apply_report.json`
- `output/canadian_brand_full_coverage_wave_v0/admission_waves/canadian_catalog_strong_canary_organika_01/validation/canadian_search_ready_validation.json`

### Platinum Naturals full residual wave

- wave: `canadian_catalog_strong_wave_platinum_03`
- rows selected: `33`
- dry-run admission: `33 eligible`, `0 blocked`
- apply: `33 merged`, `0 blocked`
- runtime validation: `0/33 pass`, `0 warn`, `33 fail`
- detail runtime: `31 ready`, `2 failed`
- failure shape: `33/33 search_exact_identity_missing`

Notable detail-runtime misses:

- `Quality Sleep | Natural Sleep Aid | Platinum Naturals`
- `Sleep Combo | Natural Sleep Aid | Platinum Naturals`

Interpretation:

- the top `Platinum Naturals` catalog-strong slice is promotable
- the long tail still degrades into search-title drift and a small scientific-background gap
- this tail should not be treated as stable-gate material without search normalization or tighter sub-selection

Artifacts:

- `output/canadian_brand_full_coverage_wave_v0/admission_waves/canadian_catalog_strong_wave_platinum_03/staging_products.canadian_catalog_strong_wave_platinum_03.json`
- `output/canadian_brand_full_coverage_wave_v0/admission_waves/canadian_catalog_strong_wave_platinum_03/apply/canadian_search_ready_apply_report.json`
- `output/canadian_brand_full_coverage_wave_v0/admission_waves/canadian_catalog_strong_wave_platinum_03/validation/canadian_search_ready_validation.json`

### New Roots Herbal detail-rich tail

The remaining `New Roots Herbal` detail-rich no-UPC tail was exhausted in three waves:

- `canadian_search_ready_wave_08`: `0/25 pass`
- `canadian_search_ready_wave_09`: `0/25 pass`
- `canadian_search_ready_wave_10`: `0/13 pass`

Common pattern:

- `detailRuntimeReady` remained strong
- live failure shape was consistently `search_exact_identity_missing`

Interpretation:

- this tail is now better understood as search-ranking / search-identity residual, not a data-merge blocker

## Current queue status

After these waves:

- `nextScanWave`: `0`
- `nextSearchReadyWave`: `26`
- `alreadyCovered`: `1047`
- `residual`: `1441`

Current `nextSearchReadyWave` mix:

- `Organika`: `25`
- `Purica`: `1`

Meaning:

- the detail-rich no-UPC mainline is exhausted
- `Platinum Naturals` is fully moved out of the active queue
- the remaining active queue is almost entirely `Organika` catalog-strong rows, which currently behave more like discovery than promotion candidates

## Cohort decisions

The current repo-local cohort record is now frozen in:

- `data/validation/canadian-catalog-strong-lane-cohorts.v0.json`

That manifest captures the promotion-vs-residual decisions for this lane so they no longer depend on local chat state or scattered artifacts.

### Promotion cohort: Platinum Naturals head 10

- cohort id: `platinum_catalog_strong_head10_promotion`
- source wave: `canadian_catalog_strong_canary_platinum_01`
- decision: promote beyond canary

Why:

- `10/10 pass`
- `10/10 warm rerun pass`
- `10/10 detail runtime ready`

### Residual / discovery: Platinum long tail

- cohort id: `platinum_catalog_strong_long_tail_residual`
- source wave: `canadian_catalog_strong_wave_platinum_03`
- decision: do not promote as stable gate

Why:

- `0/33 pass`
- `33/33` failed on `search_exact_identity_missing`
- `2` rows also missed scientific background on detail runtime

### Residual / discovery: Organika catalog-strong

- cohort id: `organika_catalog_strong_residual`
- source wave: `canadian_catalog_strong_canary_organika_01`
- decision: keep as discovery / residual

Why:

- `0/10 pass`
- `10/10 detail runtime ready`
- the failure shape is still cleanly `search_exact_identity_missing`, so the bottleneck is search identity, not merge or detail rendering

### Residual / discovery: New Roots search-miss tail

- cohort id: `new_roots_search_miss_tail_residual`
- source waves:
  - `canadian_search_ready_wave_08`
  - `canadian_search_ready_wave_09`
  - `canadian_search_ready_wave_10`
- decision: keep as residual / discovery

Why:

- `0/63 pass`
- detail runtime remained strong throughout
- this cluster is now understood as search-ranking / search-identity residual, not a merge blocker

### Singleton canary: Purica

- cohort id: `purica_catalog_strong_singleton_canary`
- source wave: `canadian_catalog_strong_canary_purica_01`
- rows selected: `1`
- dry-run: `1 eligible`, `0 blocked`
- apply: `1 merged`, `0 blocked`
- runtime validation: `1/1 pass`
- warm rerun: `1/1 pass`
- detail runtime: `1 ready`, `0 failed`

Interpretation:

- `Purica` validated clean as a singleton catalog-strong canary
- this is enough to mark the row as a clean canary success
- it is not evidence to promote the remaining `Organika` catalog-strong queue by analogy

Artifacts:

- `output/canadian_brand_full_coverage_wave_v0/admission_waves/canadian_catalog_strong_canary_purica_01/staging_products.canadian_catalog_strong_canary_purica_01.json`
- `output/canadian_brand_full_coverage_wave_v0/admission_waves/canadian_catalog_strong_canary_purica_01/dry_run/canadian_search_ready_apply_report.json`
- `output/canadian_brand_full_coverage_wave_v0/admission_waves/canadian_catalog_strong_canary_purica_01/apply/canadian_search_ready_apply_report.json`
- `output/canadian_brand_full_coverage_wave_v0/admission_waves/canadian_catalog_strong_canary_purica_01/validation/canadian_search_ready_validation.json`
- `output/canadian_brand_full_coverage_wave_v0/admission_waves/canadian_catalog_strong_canary_purica_01/validation_warm_pass_01/canadian_search_ready_validation.json`

## Fresh queue after Purica canary

- `nextScanWave`: `0`
- `nextSearchReadyWave`: `25`
- `alreadyCovered`: `1048`
- `residual`: `1441`

Current `nextSearchReadyWave` mix:

- `Organika`: `25`

Interpretation:

- `Purica` is no longer in the active queue
- the active catalog-strong queue is now purely `Organika`
- no additional brand should be promoted from this lane without a new brand-specific canary or search-identity improvement

## Organika holdout and next lane

`Organika` catalog-strong no-UPC is now intentionally treated as a holdout lane, not an active promotion queue:

- queue rule: `catalog_strong_brand_holdout_residual`
- next action: `keep_discovery_only_until_search_identity_improves`

This keeps the remaining `Organika 25` out of the mainline even if the dual admission queue is rebuilt.

The next higher-yield direction is now the UPC-explicit residual pool, summarized in:

- `data/validation/canadian-upc-explicit-next-lane.v0.json`

Current recommended next brands:

- `Jamieson`
- `Webber Naturals`
- `Progressive`

These were chosen because they already have explicit UPC coverage and stronger residual detail signals than the held-out `Organika` catalog-strong slice.

## UPC-explicit residual lane

The next lane was opened from the residual pool rather than the no-UPC queue:

- rule: `officialUpc=true`
- rule: `detailSignalCount >= 2` (first canary used `>= 3`)
- rule: exclude non-human / personal-care / grocery boundary residuals

### Jamieson canary 01

- wave: `canadian_upc_explicit_canary_jamieson_01`
- rows selected: `10`
- dry-run: `10 eligible`, `0 blocked`
- apply: `10 merged`, `0 blocked`
- cold validation: `9/10 pass`, `0 warn`, `1 fail`
- warm rerun: `10/10 pass`, `0 warn`, `0 fail`
- detail runtime: `10 ready`, `0 failed`

Cold miss:

- `100 % Pure Magnesium L-Threonate` returned `0` search results on the first replay, then passed on warm replay

Interpretation:

- `Jamieson` is the current highest-ROI follow-on lane
- this lane looks promotable for broader controlled waves
- the single cold miss should be tracked as a search warmup / first-query residual, not a reason to go back to `Organika`

Artifacts:

- `output/canadian_brand_full_coverage_wave_v0/admission_waves/canadian_upc_explicit_canary_jamieson_01/staging_products.canadian_upc_explicit_canary_jamieson_01.json`
- `output/canadian_brand_full_coverage_wave_v0/admission_waves/canadian_upc_explicit_canary_jamieson_01/dry_run/canadian_search_ready_apply_report.json`
- `output/canadian_brand_full_coverage_wave_v0/admission_waves/canadian_upc_explicit_canary_jamieson_01/apply/canadian_search_ready_apply_report.json`
- `output/canadian_brand_full_coverage_wave_v0/admission_waves/canadian_upc_explicit_canary_jamieson_01/validation/canadian_search_ready_validation.json`
- `output/canadian_brand_full_coverage_wave_v0/admission_waves/canadian_upc_explicit_canary_jamieson_01/validation_warm_pass_01/canadian_search_ready_validation.json`

### Jamieson wave 02

- wave: `canadian_upc_explicit_wave_jamieson_02`
- rows selected: `25`
- dry-run: `25 eligible`, `0 blocked`
- apply: `25 merged`, `0 blocked`
- cold validation: `10/25 pass`, `0 warn`, `15 fail`
- warm rerun: `10/25 pass`, `0 warn`, `15 fail`
- detail runtime: `25 ready`, `0 failed`

Interpretation:

- `Jamieson` head slice remains strong
- broadening the lane beyond the first clean 10 rows does **not** behave like a small cold-only residual
- the next controlled Jamieson move should be a tighter head/promotion cohort expansion, not a blind full-lane wave

Artifacts:

- `output/canadian_brand_full_coverage_wave_v0/admission_waves/canadian_upc_explicit_wave_jamieson_02/staging_products.canadian_upc_explicit_wave_jamieson_02.json`
- `output/canadian_brand_full_coverage_wave_v0/admission_waves/canadian_upc_explicit_wave_jamieson_02/dry_run/canadian_search_ready_apply_report.json`
- `output/canadian_brand_full_coverage_wave_v0/admission_waves/canadian_upc_explicit_wave_jamieson_02/apply/canadian_search_ready_apply_report.json`
- `output/canadian_brand_full_coverage_wave_v0/admission_waves/canadian_upc_explicit_wave_jamieson_02/validation/canadian_search_ready_validation.json`
- `output/canadian_brand_full_coverage_wave_v0/admission_waves/canadian_upc_explicit_wave_jamieson_02/validation_warm_pass_01/canadian_search_ready_validation.json`

### Jamieson head-only wave 03

- wave: `canadian_upc_explicit_head_wave_jamieson_03`
- rows selected: `9`
- cohort focus:
  - magnesium
  - B-complex
  - calcium / D3
  - baby omega
- dry-run: `9 eligible`, `0 blocked`
- apply: `9 merged`, `0 blocked`
- cold validation: `9/9 pass`
- warm rerun: `9/9 pass`
- detail runtime: `9 ready`, `0 failed`

Interpretation:

- Jamieson does have a clearly promotable head cohort
- the stable shape is narrower than the broader 25-row residual lane
- future Jamieson expansion should grow from this head cohort outward, not from the full residual pool

Formalized cohort:

- this 9-row slice is now the official `Jamieson` UPC-explicit promotion cohort
- follow-on expansion should stay adjacent to this shape rather than jumping back to the 25-row mixed residual pool

Artifacts:

- `output/canadian_brand_full_coverage_wave_v0/admission_waves/canadian_upc_explicit_head_wave_jamieson_03/staging_products.canadian_upc_explicit_head_wave_jamieson_03.json`
- `output/canadian_brand_full_coverage_wave_v0/admission_waves/canadian_upc_explicit_head_wave_jamieson_03/dry_run/canadian_search_ready_apply_report.json`
- `output/canadian_brand_full_coverage_wave_v0/admission_waves/canadian_upc_explicit_head_wave_jamieson_03/apply/canadian_search_ready_apply_report.json`
- `output/canadian_brand_full_coverage_wave_v0/admission_waves/canadian_upc_explicit_head_wave_jamieson_03/validation/canadian_search_ready_validation.json`
- `output/canadian_brand_full_coverage_wave_v0/admission_waves/canadian_upc_explicit_head_wave_jamieson_03/validation_warm_pass_01/canadian_search_ready_validation.json`

### Jamieson adjacent wave 05

- wave: `canadian_upc_explicit_adjacent_wave_jamieson_05`
- rows selected: `10`
- cohort focus:
  - cleaner Vitamin D singles
  - cleaner Vitamin B singles
  - cleaner Zinc / Magnesium singles
- source note:
  - first pass built from the compact queue rows blocked on `missing_search_ready_content`
  - final canary was rebuilt from `canadian_official_overlay_candidates.v2` so the same titles carried full image + label sections
- dry-run: `10 eligible`, `0 blocked`
- apply: `10 merged`, `0 blocked`
- cold validation: `8/10 pass`, `1/10 warn`, `1/10 fail`
- warm rerun: `8/10 pass`, `1/10 warn`, `1/10 fail`
- detail runtime: `10 ready`, `0 failed`

Interpretation:

- Jamieson adjacent expansion works when the rows come from the rich official candidate layer rather than the compact queue snapshot
- 8 titles are strong enough to join the next promotion ring
- `Zinc 25 mg` remains a non-blocking same-family ranking warning at rank 4
- `Vitamin D3 400 IU` stays residual because exact identity only landed at rank 7 even after warm replay

Promote now:

- `Vitamin D | Premium | 1,000 IU | Softgels`
- `Vitamin D3 1,000 IU: Tablets`
- `Jamieson Vitamin B1 100 mg Thiamine Supplement`
- `Jamieson Vitamin B2 Riboflavin 100 mg`
- `Jamieson Vitamin B6 100 mg Pyridoxine Supplement`
- `Jamieson Vitamin B12 1,000 mcg Fast‑Dissolving Tablets`
- `Jamieson Vitamin B12 Methylcobalamin 100 mcg Tablets`
- `Magnesium | Ultra Strength`

Keep warn:

- `Zinc 25 mg`

Residual:

- `Vitamin D3 400 IU`

Artifacts:

- `output/canadian_brand_full_coverage_wave_v0/admission_waves/canadian_upc_explicit_adjacent_wave_jamieson_05/staging_products.canadian_upc_explicit_adjacent_wave_jamieson_05.json`
- `output/canadian_brand_full_coverage_wave_v0/admission_waves/canadian_upc_explicit_adjacent_wave_jamieson_05/dry_run/canadian_search_ready_apply_report.json`
- `output/canadian_brand_full_coverage_wave_v0/admission_waves/canadian_upc_explicit_adjacent_wave_jamieson_05/apply/canadian_search_ready_apply_report.json`
- `output/canadian_brand_full_coverage_wave_v0/admission_waves/canadian_upc_explicit_adjacent_wave_jamieson_05/validation/canadian_search_ready_validation.json`
- `output/canadian_brand_full_coverage_wave_v0/admission_waves/canadian_upc_explicit_adjacent_wave_jamieson_05/validation_warm_pass_01/canadian_search_ready_validation.json`

### Jamieson adjacent wave 06

- wave: `canadian_upc_explicit_adjacent_wave_jamieson_06`
- rows selected: `8`
- cohort focus:
  - higher-strength Vitamin D singles
  - higher-strength Vitamin B singles
  - higher-strength Zinc single
- dry-run: `8 eligible`, `0 blocked`
- apply: `8 merged`, `0 blocked`
- cold validation: `7/8 pass`, `0/8 warn`, `1/8 fail`
- warm rerun: `7/8 pass`, `0/8 warn`, `1/8 fail`
- detail runtime: `8 ready`, `0 failed`

Interpretation:

- the second adjacent expansion is even cleaner than wave 05
- `Jamieson` keeps behaving well when we stay in the clean-single, head-adjacent neighborhood
- `Vitamin D3 2,500 IU | Softgels` stays residual because exact identity landed at rank 6 even after warm replay

Promote now:

- `Jamieson Vitamin B12 1,200 mcg Timed Release`
- `Jamieson Zinc 50 mg | Ultra Strength Zinc Supplement For Immunity`
- `Jamieson Vitamin B12 250 mcg Methycobalamin Supplement`
- `Vitamin D3 2,500 IU`
- `Jamieson High Potency Vitamin B6 Pyridoxine 250 mg`
- `Jamieson Niacin Vitamin B3 500 mg`
- `Vitamin D3 1,000 IU | Fast Dissolving`

Residual:

- `Vitamin D3 2,500 IU | Softgels`

Artifacts:

- `output/canadian_brand_full_coverage_wave_v0/admission_waves/canadian_upc_explicit_adjacent_wave_jamieson_06/staging_products.canadian_upc_explicit_adjacent_wave_jamieson_06.json`
- `output/canadian_brand_full_coverage_wave_v0/admission_waves/canadian_upc_explicit_adjacent_wave_jamieson_06/dry_run/canadian_search_ready_apply_report.json`
- `output/canadian_brand_full_coverage_wave_v0/admission_waves/canadian_upc_explicit_adjacent_wave_jamieson_06/apply/canadian_search_ready_apply_report.json`
- `output/canadian_brand_full_coverage_wave_v0/admission_waves/canadian_upc_explicit_adjacent_wave_jamieson_06/validation/canadian_search_ready_validation.json`
- `output/canadian_brand_full_coverage_wave_v0/admission_waves/canadian_upc_explicit_adjacent_wave_jamieson_06/validation_warm_pass_01/canadian_search_ready_validation.json`

### Jamieson adjacent wave 07

- wave: `canadian_upc_explicit_adjacent_wave_jamieson_07`
- rows selected: `8`
- cohort focus:
  - Vitamin D chewables
  - Vitamin D3 kids / babies
  - Vitamin B12 2,500 mcg
  - cleaner zinc family
- dry-run: `8 eligible`, `0 blocked`
- apply: `8 merged`, `0 blocked`
- cold validation: `8/8 pass`, `0/8 warn`, `0/8 fail`
- warm rerun: `8/8 pass`, `0/8 warn`, `0/8 fail`
- detail runtime: `8 ready`, `0 failed`

Interpretation:

- this last conservative ring is fully green
- Jamieson continues to generalize when the expansion stays inside clean singles and child-safe D/zinc/B12 variants
- this gives us a much larger formal promotion surface without reopening the mixed residual pool

Promote now:

- `Zinc Gummies for Immune Health`
- `Vitamin D3 for Babies: Liquid Drops`
- `Jamieson Vitamin B12 2,500 mcg Timed Release Tablets`
- `Zinc Tablets 10 mg: Immune Support`
- `Jamieson Vitamin B12 2,500 mcg Fast‑Dissolving Tablets`
- `Vitamin D Chewables: Immune & Bone Support`
- `Vitamin D3 for Kids`
- `Zinc Lozenges: 4 Delicious Flavours for Immune Support`

Artifacts:

- `output/canadian_brand_full_coverage_wave_v0/admission_waves/canadian_upc_explicit_adjacent_wave_jamieson_07/staging_products.canadian_upc_explicit_adjacent_wave_jamieson_07.json`
- `output/canadian_brand_full_coverage_wave_v0/admission_waves/canadian_upc_explicit_adjacent_wave_jamieson_07/dry_run/canadian_search_ready_apply_report.json`
- `output/canadian_brand_full_coverage_wave_v0/admission_waves/canadian_upc_explicit_adjacent_wave_jamieson_07/apply/canadian_search_ready_apply_report.json`
- `output/canadian_brand_full_coverage_wave_v0/admission_waves/canadian_upc_explicit_adjacent_wave_jamieson_07/validation/canadian_search_ready_validation.json`
- `output/canadian_brand_full_coverage_wave_v0/admission_waves/canadian_upc_explicit_adjacent_wave_jamieson_07/validation_warm_pass_01/canadian_search_ready_validation.json`

### Jamieson stable promotion pack v0

- pack: `data/validation/canadian-jamieson-promotion-pack.v0.json`
- rows selected: `32`
- composition:
  - `9` from the formal head-only promotion cohort
  - `8` from adjacent wave 05
  - `7` from adjacent wave 06
  - `8` from adjacent wave 07
- cold validation: `32/32 pass`
- warm rerun: `32/32 pass`
- detail runtime: `32/32 ready`

Interpretation:

- the current Canadian `Jamieson` lane is now fully closed into a release-grade stable baseline
- the active Canadian promotion queue is empty after materializing this baseline
- further Canadian work should open a new lane deliberately rather than continuing to churn this one

Artifacts:

- `data/validation/canadian-jamieson-promotion-pack.v0.json`
- `output/canadian_brand_full_coverage_wave_v0/stable_packs/canadian_jamieson_promotion_pack_v0/validation/canadian_search_ready_validation.json`
- `output/canadian_brand_full_coverage_wave_v0/stable_packs/canadian_jamieson_promotion_pack_v0/validation_warm_pass_01/canadian_search_ready_validation.json`

### Webber Naturals canary 01

- wave: `canadian_upc_explicit_canary_webber_01`
- rows selected: `10`
- dry-run: `10 eligible`, `0 blocked`
- apply: `10 merged`, `0 blocked`
- cold validation: `0/10 pass`
- warm rerun: `0/10 pass`
- detail runtime: `10 ready`, `0 failed`

Interpretation:

- `Webber Naturals` is not the next promotion lane despite explicit UPCs
- the current failure mode is search identity, not data completeness or detail rendering

Artifacts:

- `output/canadian_brand_full_coverage_wave_v0/admission_waves/canadian_upc_explicit_canary_webber_01/staging_products.canadian_upc_explicit_canary_webber_01.json`
- `output/canadian_brand_full_coverage_wave_v0/admission_waves/canadian_upc_explicit_canary_webber_01/dry_run/canadian_search_ready_apply_report.json`
- `output/canadian_brand_full_coverage_wave_v0/admission_waves/canadian_upc_explicit_canary_webber_01/apply/canadian_search_ready_apply_report.json`
- `output/canadian_brand_full_coverage_wave_v0/admission_waves/canadian_upc_explicit_canary_webber_01/validation/canadian_search_ready_validation.json`
- `output/canadian_brand_full_coverage_wave_v0/admission_waves/canadian_upc_explicit_canary_webber_01/validation_warm_pass_01/canadian_search_ready_validation.json`

### Progressive canary 01

- wave: `canadian_upc_explicit_canary_progressive_01`
- rows selected: `8`
- dry-run: `8 eligible`, `0 blocked`
- apply: `8 merged`, `0 blocked`
- cold validation: `0/8 pass`
- warm rerun: `0/8 pass`
- detail runtime: `8 ready`, `0 failed`

Interpretation:

- `Progressive` also stays below `Jamieson` as a promotion candidate
- this lane currently behaves like search-identity residual rather than a stable follow-on batch

Artifacts:

- `output/canadian_brand_full_coverage_wave_v0/admission_waves/canadian_upc_explicit_canary_progressive_01/staging_products.canadian_upc_explicit_canary_progressive_01.json`
- `output/canadian_brand_full_coverage_wave_v0/admission_waves/canadian_upc_explicit_canary_progressive_01/dry_run/canadian_search_ready_apply_report.json`
- `output/canadian_brand_full_coverage_wave_v0/admission_waves/canadian_upc_explicit_canary_progressive_01/apply/canadian_search_ready_apply_report.json`
- `output/canadian_brand_full_coverage_wave_v0/admission_waves/canadian_upc_explicit_canary_progressive_01/validation/canadian_search_ready_validation.json`
- `output/canadian_brand_full_coverage_wave_v0/admission_waves/canadian_upc_explicit_canary_progressive_01/validation_warm_pass_01/canadian_search_ready_validation.json`
