## natrol-external-discovery

Status: execution_success_with_narrow_validated_queue_presence

Executed:
- Loaded the Natrol lane context from `docs/exec-plans/active/p0_p3_product_closure/queued_brand_execution_lanes_current.json` and `docs/exec-plans/active/p0_p3_product_closure/queued_brand_target_match_matrix.json`.
- Ran a fresh official-site-led pass against `https://www.natrol.com/` on March 17, 2026 using the live product, collection, and page sitemaps plus Shopify `.js` product endpoints.
- Collected current official product identity evidence across `42` live product pages, `85` collection pages, and `25` site pages.
- Verified that all `42` current official Natrol product pages expose machine-usable variant barcodes plus label assets, then compared those barcodes against the current `41`-row Natrol missing queue from `output/p0_p3_live_wave_pack_20260317/missing_brand_queues/natrol.json`.
- Used browser automation on the official site to confirm a live matched product page and visible `Buy On Amazon` action on `https://www.natrol.com/products/melatonin-gummies-sleep-support-strawberry-5mg`.

Findings:
- Natrol is not zero-signal under current official evidence. Current queue-presence can be re-materialized without loosening thresholds, but only narrowly.
- Strict threshold used: exact `GTIN14` match between queued Natrol barcodes and current Shopify variant barcodes from the official Natrol product endpoints.
- Exact current queue candidates validated: `2` of `41`.
- Exact validated candidates:
  - `00047469075859` `Melatonin 5 mg Strawberry` -> `Melatonin Gummies, 5mg`
  - `00047469071714` `Melatonin Advanced 10 mg Time Release` -> `Time Release Melatonin Tablets, 10mg`
- Both validated candidates have current official product URLs, current sitemap timestamps, label assets, and official-site Amazon outbound links.
- The live official catalog is heavily skewed toward current sleep/melatonin inventory rather than Natrol’s older broader assortment:
  - `25` product titles include `melatonin`
  - `9` include `sleep`
  - `5` include `5-HTP`
  - `2` include `biotin`
  - `2` include `magnesium`
- The remaining `39` queued rows did not re-materialize under strict barcode proof. Some show only weak title overlap to current products, for example:
  - `Advanced Sleep Melatonin 10 mg Time Release`
  - `Biotin 10,000 mcg Maximum Strength Strawberry`
  - `High Absorption Magnesium 250 mg Cranberry Apple Natural Flavor`
  - `Mood Positive 5-HTP`

Blocker classification:
- Primary blocker: current-catalog mismatch / legacy-tail blocker. Most of the old Natrol missing queue does not map back to the current North America official catalog under strict barcode identity.
- Secondary blocker: broad replay would be low-yield. The official site is strong and barcode-rich, but the validated overlap is only `2` rows, so reopening a wide Natrol recovery wave would mostly reprocess non-current or reformulated legacy items.
- Optional retailer blocker: iHerb remains optional and was not needed for the Natrol decision; known Cloudflare issues still make it a weak dependency in this environment.

Recommended next execution step:
- Materialize a tightly scoped official Natrol replay for the `2` exact-barcode melatonin candidates only, using the official product URLs, label assets, and official-site Amazon cross-links already captured in the Natrol output bundle.
- Keep the remaining `39` Natrol queue rows paused unless a separate reformulation-mapping lane is explicitly approved. Do not loosen thresholds and do not reopen a broad Natrol recovery pass.

Repo-native evidence written:
- `output/p0_p3_natrol_external_discovery_20260317/official_catalog_summary.json`
- `output/p0_p3_natrol_external_discovery_20260317/official_catalog_products.json`
- `output/p0_p3_natrol_external_discovery_20260317/validated_queue_candidates.json`
- `output/p0_p3_natrol_external_discovery_20260317/unmatched_queue_rows_with_name_hints.json`
