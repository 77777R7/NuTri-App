# Codeage Glutathione+ And Beauty Tonic Targeted Recovery

Executed: 2026-03-17

Scope:
- `157265` | `Codeage, Liposomal Glutathione+, 120 Vegetable Capsules`
- `121637` | `Codeage, Beauty Tonic, 90 Vegetable Capsules`

Constraints honored:
- scan freeze untouched
- shared control-plane JSON untouched
- shared `data/iherb_official_fallback_configs/codeage.json` untouched
- work limited to product-specific temp config and output artifacts

## Live Verification

Current official product pages were verified live and differ from the older `/en-ca/...` paths that were previously treated as blockers:

- `157265`
  - clean current official page: `https://www.codeage.com/products/liposomal-glutathione-vitaminc-coq10`
  - legacy locale path now returns `404`: `https://www.codeage.com/en-ca/products/liposomal-glutathione-vitaminc-coq10`
  - browser screenshot: `/Users/howard07/NuTriApp/nutri-app/output/p0_p3_codeage_batch_glutathione_beauty_20260317/browser/glutathione_page.png`
- `121637`
  - clean current official page: `https://www.codeage.com/products/beauty-tonic-formula`
  - legacy locale path now returns `404`: `https://www.codeage.com/en-ca/products/beauty-tonic-formula`
  - browser screenshot: `/Users/howard07/NuTriApp/nutri-app/output/p0_p3_codeage_batch_glutathione_beauty_20260317/browser/beauty_tonic_page.png`

Live verification JSON:
- `/Users/howard07/NuTriApp/nutri-app/output/p0_p3_codeage_batch_glutathione_beauty_20260317/codeage_live_verification.json`

## Execution Attempts

### Attempt 1: direct official page override

- config: `/Users/howard07/NuTriApp/nutri-app/output/p0_p3_codeage_batch_glutathione_beauty_20260317/codeage_batch_config.json`
- report: `/Users/howard07/NuTriApp/nutri-app/output/p0_p3_codeage_batch_glutathione_beauty_20260317/official_fallback_report.json`
- result:
  - both products reached `full_overlay_ready`
  - but `Warnings` was polluted by long product-page tail content for both products
  - verdict: not clean enough for product-data closure

### Attempt 2: reader-based official page override

- config: `/Users/howard07/NuTriApp/nutri-app/output/p0_p3_codeage_batch_glutathione_beauty_20260317/codeage_batch_config_reader.json`
- report: `/Users/howard07/NuTriApp/nutri-app/output/p0_p3_codeage_batch_glutathione_beauty_20260317/reader_attempt/official_fallback_report.json`
- result:
  - `Warnings` became clean for both products
  - `157265` stayed clean overall
  - `121637` `Suggested use` was polluted by OCR text
  - verdict: still not clean enough for product-data closure

### Attempt 3: reader-based official page override with OCR disabled

- config: `/Users/howard07/NuTriApp/nutri-app/output/p0_p3_codeage_batch_glutathione_beauty_20260317/codeage_batch_config_reader_noocr.json`
- report: `/Users/howard07/NuTriApp/nutri-app/output/p0_p3_codeage_batch_glutathione_beauty_20260317/reader_noocr_attempt/official_fallback_report.json`
- staging: `/Users/howard07/NuTriApp/nutri-app/output/p0_p3_codeage_batch_glutathione_beauty_20260317/reader_noocr_attempt/staging_products.official_refreshed.json`
- seed: `/Users/howard07/NuTriApp/nutri-app/output/p0_p3_codeage_batch_glutathione_beauty_20260317/reader_noocr_attempt/official_fallback_seed.json`
- result:
  - both products reached `full_overlay_ready`
  - both products now have clean `Suggested use`
  - both products now have clean `Warnings`
  - no scan-surface changes were required

## Final Verdict Per Product

### `157265` | Codeage, Liposomal Glutathione+, 120 Vegetable Capsules

- final verdict: `closed`
- reached `full_overlay_ready` cleanly: `yes`
- final artifact:
  - `/Users/howard07/NuTriApp/nutri-app/output/p0_p3_codeage_batch_glutathione_beauty_20260317/reader_noocr_attempt/staging_products.official_refreshed.json`
- clean values:
  - Suggested use: `Adults take 2 capsules daily, or as recommended by your healthcare practitioner, with 8 ounces of water or your favorite beverage. May be taken with or without food.`
  - Warnings: `CAUTION: Do not exceed suggested use. Pregnant, nursing mothers, individuals with a known medical condition, and individuals using prescription drugs or over-the-counter medications should consult a healthcare professional before using this or any dietary supplement. Discontinue use two weeks prior to surgery. Please use caution if you have allergies or sensitivities to any of the listed ingredients. Not intended for those under the age of 18.`

### `121637` | Codeage, Beauty Tonic, 90 Vegetable Capsules

- final verdict: `closed`
- reached `full_overlay_ready` cleanly: `yes`
- final artifact:
  - `/Users/howard07/NuTriApp/nutri-app/output/p0_p3_codeage_batch_glutathione_beauty_20260317/reader_noocr_attempt/staging_products.official_refreshed.json`
- clean values:
  - Suggested use: `Take 3 capsules daily with 8 ounces of water or your favorite beverage. May be taken with or without food.`
  - Warnings: `CAUTION: Do not exceed recommended dose. It's important to know that one can't lose weight by use of the product alone, or without following a calorie controlled diet and exercise program. Weight loss results might not be effective for everyone and results might not be permanent. Pregnant, nursing mothers, children under 18 and individuals with a known medical condition should consult a physician before using this or any dietary supplement. Please use caution if you have allergies or sensitivities to any of the listed ingredients. Keep out of reach of children and pets. Do not use if safety seal is damaged or missing. Store in a cool dry place. Biotin can be received in adequate or extra amounts from food and regular diet only. Use this product as a food supplement only. Do not use for weight reduction.`

## Files Created / Changed In This Task

- `/Users/howard07/NuTriApp/nutri-app/output/p0_p3_codeage_batch_glutathione_beauty_20260317/codeage_batch_queue.json`
- `/Users/howard07/NuTriApp/nutri-app/output/p0_p3_codeage_batch_glutathione_beauty_20260317/codeage_batch_config.json`
- `/Users/howard07/NuTriApp/nutri-app/output/p0_p3_codeage_batch_glutathione_beauty_20260317/codeage_batch_config_reader.json`
- `/Users/howard07/NuTriApp/nutri-app/output/p0_p3_codeage_batch_glutathione_beauty_20260317/codeage_batch_config_reader_noocr.json`
- `/Users/howard07/NuTriApp/nutri-app/output/p0_p3_codeage_batch_glutathione_beauty_20260317/codeage_live_verification.json`
- `/Users/howard07/NuTriApp/nutri-app/output/p0_p3_codeage_batch_glutathione_beauty_20260317/browser/glutathione_page.png`
- `/Users/howard07/NuTriApp/nutri-app/output/p0_p3_codeage_batch_glutathione_beauty_20260317/browser/beauty_tonic_page.png`
- `/Users/howard07/NuTriApp/nutri-app/output/p0_p3_codeage_batch_glutathione_beauty_20260317/official_fallback_seed.json`
- `/Users/howard07/NuTriApp/nutri-app/output/p0_p3_codeage_batch_glutathione_beauty_20260317/official_fallback_report.json`
- `/Users/howard07/NuTriApp/nutri-app/output/p0_p3_codeage_batch_glutathione_beauty_20260317/official_fallback_report.md`
- `/Users/howard07/NuTriApp/nutri-app/output/p0_p3_codeage_batch_glutathione_beauty_20260317/staging_products.official_refreshed.json`
- `/Users/howard07/NuTriApp/nutri-app/output/p0_p3_codeage_batch_glutathione_beauty_20260317/reader_attempt/official_fallback_seed.json`
- `/Users/howard07/NuTriApp/nutri-app/output/p0_p3_codeage_batch_glutathione_beauty_20260317/reader_attempt/official_fallback_report.json`
- `/Users/howard07/NuTriApp/nutri-app/output/p0_p3_codeage_batch_glutathione_beauty_20260317/reader_attempt/official_fallback_report.md`
- `/Users/howard07/NuTriApp/nutri-app/output/p0_p3_codeage_batch_glutathione_beauty_20260317/reader_attempt/staging_products.official_refreshed.json`
- `/Users/howard07/NuTriApp/nutri-app/output/p0_p3_codeage_batch_glutathione_beauty_20260317/reader_noocr_attempt/official_fallback_seed.json`
- `/Users/howard07/NuTriApp/nutri-app/output/p0_p3_codeage_batch_glutathione_beauty_20260317/reader_noocr_attempt/official_fallback_report.json`
- `/Users/howard07/NuTriApp/nutri-app/output/p0_p3_codeage_batch_glutathione_beauty_20260317/reader_noocr_attempt/official_fallback_report.md`
- `/Users/howard07/NuTriApp/nutri-app/output/p0_p3_codeage_batch_glutathione_beauty_20260317/reader_noocr_attempt/staging_products.official_refreshed.json`
- `/Users/howard07/NuTriApp/nutri-app/docs/exec-plans/active/p0_p3_product_closure/subagents/runs/codeage_batch_glutathione_beauty_result.md`
