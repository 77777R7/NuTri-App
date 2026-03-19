# Codeage Akkermansia + Skin Batch Result

Executed: `2026-03-17`

## Scope

- Only handled:
  - `143300` | `Codeage, Akkermansia 500 Ultra, 90 Vegetable Capsules`
  - `157271` | `Codeage, Skin Vitamins+, 30 Vegetable Capsules`
- Did not edit shared control-plane JSON.
- Did not touch scan freeze / protected scan UI files.

## Live Verification

### Official site verification

- Current clean direct-fetch product pages do exist:
  - `143300` -> `https://www.codeage.com/products/akkermansia-muciniphila-500-ultra-probiotics-supplement`
  - `157271` -> `https://www.codeage.com/products/skin-vitamins-ceramosides-dermaval`
- Current browser-rendered verification via `agent-browser` did **not** stay on the product URL. Both product URLs redirected the rendered browser surface to:
  - `https://www.codeage.com/en-ca`
- Direct HTTP fetch of the same product URLs returned `200` and exposed:
  - `mobile-tab-ingredients`
  - `mobile-tab-suggested`
  - `mobile-tab-supplement` with a supplement-facts image

Evidence:

- `/Users/howard07/NuTriApp/nutri-app/output/p0_p3_codeage_batch_akkermansia_skin_20260317/live_verification_evidence.json`
- `/Users/howard07/NuTriApp/nutri-app/output/p0_p3_codeage_batch_akkermansia_skin_20260317/143300_official_page.png`
- `/Users/howard07/NuTriApp/nutri-app/output/p0_p3_codeage_batch_akkermansia_skin_20260317/157271_official_page.png`
- `/Users/howard07/NuTriApp/nutri-app/output/p0_p3_codeage_batch_akkermansia_skin_20260317/143300_supplement_facts.jpg`
- `/Users/howard07/NuTriApp/nutri-app/output/p0_p3_codeage_batch_akkermansia_skin_20260317/157271_supplement_facts.jpg`

## Execution

- Built a temporary product-specific config:
  - `/Users/howard07/NuTriApp/nutri-app/output/p0_p3_codeage_batch_akkermansia_skin_20260317/codeage_batch_temp_config.json`
- Built a temporary queue slice containing only the two target rows:
  - `/Users/howard07/NuTriApp/nutri-app/output/p0_p3_codeage_batch_akkermansia_skin_20260317/queue_slice.json`
- Ran the official fallback wave only for those targets.

Primary output:

- `/Users/howard07/NuTriApp/nutri-app/output/p0_p3_codeage_batch_akkermansia_skin_20260317/official_fallback_report.json`
- `/Users/howard07/NuTriApp/nutri-app/output/p0_p3_codeage_batch_akkermansia_skin_20260317/official_fallback_seed.json`
- `/Users/howard07/NuTriApp/nutri-app/output/p0_p3_codeage_batch_akkermansia_skin_20260317/staging_products.official_refreshed.json`

Summary:

- `queued = 2`
- `processed = 2`
- `improvedRows = 2`
- `becameFullOverlayReady = 2`

## Product Verdicts

### `143300` | Akkermansia 500 Ultra

- Raw official fallback result: `full_overlay_ready`
- Missing fields closed: `ingredient`, `dosage`
- `afterMissingFields = []`
- Source path:
  - direct official product page
  - official supplement-facts image OCR
- Cleanliness verdict: `YES`

Why this is clean:

- The live page exposed clean ingredient text.
- The official supplement-facts image clearly exposed:
  - `Akkermansia (Akkermansia muciniphila) AH39` -> `150 mg (500 million AFU‡)`
  - `Chicory Inulin` -> `276 mg`
- Final refreshed staging row remained `full_overlay_ready` with no contaminated warning tail in the target row quality check.

### `157271` | Skin Vitamins+

- Raw official fallback result: `full_overlay_ready`
- Missing fields closed: `suggested_use`, `warnings`
- `afterMissingFields = []`
- Source path:
  - direct official product page
  - official supplement-facts image OCR
  - manual section override in the temporary config
- Cleanliness verdict on the **raw pipeline output**: `NO`

Why this is not fully clean in raw pipeline output:

- The raw fallback run did clear the missing fields and reached `full_overlay_ready`.
- But the resulting `Warnings` text in the refreshed staging row picked up a long reader/page tail after the clean caution text.
- This means the row is operationally complete, but the raw warning field is not product-grade clean enough to call a fully clean close.

Useful salvage artifact created:

- `/Users/howard07/NuTriApp/nutri-app/output/p0_p3_codeage_batch_akkermansia_skin_20260317/staging_products.official_refreshed.sanitized.json`

In that local sanitized artifact:

- `157271` keeps `full_overlay_ready`
- `Warnings` is replaced with the exact clean caution text verified from the live official page

## Final Verdict

- `143300`: `closed cleanly to full_overlay_ready`
- `157271`: `reached full_overlay_ready in raw fallback output, but not cleanly`; a local sanitized artifact is available in the batch out dir

Strict verdict:

- If the bar is `raw pipeline output must itself be clean`, then only `143300` is cleanly closed.
- If the bar allows a product-specific local sanitized artifact in this isolated out dir, then both targets are usable, but `157271` still has a raw-pipeline quality residue that should not be silently promoted without review.

## Files Written

- `/Users/howard07/NuTriApp/nutri-app/output/p0_p3_codeage_batch_akkermansia_skin_20260317/codeage_batch_temp_config.json`
- `/Users/howard07/NuTriApp/nutri-app/output/p0_p3_codeage_batch_akkermansia_skin_20260317/queue_slice.json`
- `/Users/howard07/NuTriApp/nutri-app/output/p0_p3_codeage_batch_akkermansia_skin_20260317/live_verification_evidence.json`
- `/Users/howard07/NuTriApp/nutri-app/output/p0_p3_codeage_batch_akkermansia_skin_20260317/143300_official_page.png`
- `/Users/howard07/NuTriApp/nutri-app/output/p0_p3_codeage_batch_akkermansia_skin_20260317/157271_official_page.png`
- `/Users/howard07/NuTriApp/nutri-app/output/p0_p3_codeage_batch_akkermansia_skin_20260317/143300_supplement_facts.jpg`
- `/Users/howard07/NuTriApp/nutri-app/output/p0_p3_codeage_batch_akkermansia_skin_20260317/157271_supplement_facts.jpg`
- `/Users/howard07/NuTriApp/nutri-app/output/p0_p3_codeage_batch_akkermansia_skin_20260317/official_fallback_report.json`
- `/Users/howard07/NuTriApp/nutri-app/output/p0_p3_codeage_batch_akkermansia_skin_20260317/official_fallback_report.md`
- `/Users/howard07/NuTriApp/nutri-app/output/p0_p3_codeage_batch_akkermansia_skin_20260317/official_fallback_seed.json`
- `/Users/howard07/NuTriApp/nutri-app/output/p0_p3_codeage_batch_akkermansia_skin_20260317/staging_products.official_refreshed.json`
- `/Users/howard07/NuTriApp/nutri-app/output/p0_p3_codeage_batch_akkermansia_skin_20260317/staging_products.official_refreshed.sanitized.json`
- `/Users/howard07/NuTriApp/nutri-app/output/p0_p3_codeage_batch_akkermansia_skin_20260317/postrun_quality_check.json`
- `/Users/howard07/NuTriApp/nutri-app/docs/exec-plans/active/p0_p3_product_closure/subagents/runs/codeage_batch_akkermansia_skin_result.md`
