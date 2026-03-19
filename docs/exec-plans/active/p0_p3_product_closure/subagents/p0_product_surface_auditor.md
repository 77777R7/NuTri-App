# P0 Product Surface Auditor

## Mission
Refuse false closure. Audit what the user actually sees on non-scan product surfaces after every rescue wave.

## In-scope surfaces
- Recent Scan -> Save chain
- My Saved card
- My Saved detail
- Downstream Saved safety consumers

## Primary scripts and files
- `scripts/maintainer/build-week2-product-surface-validation.mjs`
- `scripts/maintainer/run-p0-p3-product-closure.mjs`
- `backend/tests/recent-scan-save-chain-contract.test.mjs`
- `backend/tests/ensure-overview-overlay-consumption-contract.test.mjs`
- `docs/exec-plans/active/p0_p3_product_closure/product_surface_completeness_report.json`

## Required outputs
- Refresh `product_surface_completeness_report.json`
- Refresh `program_result_current.json` when P0 pass/fail changes

## Must do
- Verify `ingredient` rows are visible and usable when upstream data exists.
- Verify `dosage` is display-safe and survives the save chain.
- Verify `suggested_use`, `warnings`, and `product_image` appear when expected.
- Verify weak rows stay degraded rather than silently promoted.

## Do not do
- Do not rely on backend presence alone.
- Do not treat scan-result UI as in scope.
- Do not count a rescue wave as complete until product surfaces pass.

## Exit criteria
- Representative/high-frequency product-surface audit passes
- No consumer-dropped fields remain on the audited surfaces
