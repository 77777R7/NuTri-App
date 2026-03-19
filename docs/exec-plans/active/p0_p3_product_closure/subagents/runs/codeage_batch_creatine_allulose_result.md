# Codeage Creatine Gummies + Allulose Batch Result

Executed: 2026-03-17

Scope:
- `146937` | `Codeage, Sport, Creatine Gummies, Mixed Berry, 120 Gummies`
- `152821` | `Codeage, Miracle Sugar Allulose Powder, Unflavored, 35.27 oz (1 kg)`

Constraints honored:
- scan freeze untouched
- no shared control-plane JSON updated
- product-specific temporary config only

## Live verification

- Official Codeage localized `/en-ca/products/...` paths for both targets were not usable for recovery and returned `404`.
- Current live product surfaces do exist at the non-locale Codeage `/products/...` paths:
  - `https://www.codeage.com/products/creatine-gummies-supplement-sport-performance-muscles-astragin-panax`
  - `https://www.codeage.com/products/miracle-sugar-allulose-powder-sweetener-alternative-zero-calories`
- Shopify catalog confirmation and extracted live text were saved to:
  - `/Users/howard07/NuTriApp/nutri-app/output/p0_p3_codeage_batch_creatine_allulose_20260317/live_page_evidence.json`

## Product verdicts

### `152821` Miracle Sugar Allulose Powder

- Verdict: `closed_clean`
- `full_overlay_ready` cleanly: `yes`
- Missing field closed: `suggested_use`
- Method:
  - temporary config with direct official product URL override
  - official fallback wave run only for this batch
- Clean final artifact:
  - `/Users/howard07/NuTriApp/nutri-app/output/p0_p3_codeage_batch_creatine_allulose_20260317/fallback_run/staging_products.official_refreshed.json`
- Notes:
  - official page text yielded a clean suggested-use sentence
  - existing iHerb warnings stayed intact and did not need override

### `146937` Creatine Gummies

- Verdict: `closed_clean_with_post_fallback_sanitization`
- `full_overlay_ready` cleanly via fallback pipeline alone: `no`
- `full_overlay_ready` cleanly in final product artifact: `yes`
- Missing fields closed: `suggested_use`, `warnings`
- Method:
  - temporary config with direct official product URL override
  - first official fallback wave reached `full_overlay_ready` structurally but polluted `Warnings` with non-warning marketing/OCR text
  - second no-OCR rerun still left parser-derived warning contamination in the raw refreshed staging row
  - final clean artifact was produced by sanitizing the warnings back to the live official caution text verified from the current product page
- Raw fallback artifacts:
  - `/Users/howard07/NuTriApp/nutri-app/output/p0_p3_codeage_batch_creatine_allulose_20260317/fallback_run/staging_products.official_refreshed.json`
  - `/Users/howard07/NuTriApp/nutri-app/output/p0_p3_codeage_batch_creatine_allulose_20260317/fallback_run_creatine_noocr/staging_products.official_refreshed.json`
- Clean final artifact:
  - `/Users/howard07/NuTriApp/nutri-app/output/p0_p3_codeage_batch_creatine_allulose_20260317/cleaned_staging_products.official_refreshed.json`

## Outputs

- Temporary batch config:
  - `/Users/howard07/NuTriApp/nutri-app/output/p0_p3_codeage_batch_creatine_allulose_20260317/temp_codeage_creatine_allulose_config.json`
- Temporary creatine no-OCR config:
  - `/Users/howard07/NuTriApp/nutri-app/output/p0_p3_codeage_batch_creatine_allulose_20260317/temp_codeage_creatine_noocr_config.json`
- Product batch queue:
  - `/Users/howard07/NuTriApp/nutri-app/output/p0_p3_codeage_batch_creatine_allulose_20260317/selected_queue.json`
- Creatine-only queue:
  - `/Users/howard07/NuTriApp/nutri-app/output/p0_p3_codeage_batch_creatine_allulose_20260317/selected_queue_creatine_only.json`
- Live page evidence:
  - `/Users/howard07/NuTriApp/nutri-app/output/p0_p3_codeage_batch_creatine_allulose_20260317/live_page_evidence.json`
- Batch fallback report:
  - `/Users/howard07/NuTriApp/nutri-app/output/p0_p3_codeage_batch_creatine_allulose_20260317/fallback_run/official_fallback_report.json`
- Creatine no-OCR fallback report:
  - `/Users/howard07/NuTriApp/nutri-app/output/p0_p3_codeage_batch_creatine_allulose_20260317/fallback_run_creatine_noocr/official_fallback_report.json`
- Final verdict manifest:
  - `/Users/howard07/NuTriApp/nutri-app/output/p0_p3_codeage_batch_creatine_allulose_20260317/final_product_verdicts.json`

## Bottom line

- `152821` is recoverable to clean `full_overlay_ready` directly from the official fallback lane.
- `146937` is recoverable to clean product-data quality, but not cleanly from the current fallback parser alone; it required post-fallback sanitization grounded in the live official page text.
