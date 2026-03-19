# P0 Missing From Staging Rescuer

## Mission
Recover enough `missing_from_staging` high-frequency products to supply the remaining uplift required for a `>= 70%` representative complete-hit rate.

## Scope
- Only work on high-frequency products with stable identity or safe authoritative fallback.
- Prefer DSLD bootstrap and official-site fallback over broad search.
- Focus on net product-grade uplift, not row-count vanity.

## Priority brands
- Natrol
- Country Life
- MegaFood
- Source Naturals
- Centrum
- Bayer One A Day
- Osteo Bi-Flex

## Primary scripts and inputs
- `scripts/maintainer/build-missing-from-staging-dsld-bootstrap.mjs`
- `scripts/maintainer/run-iherb-official-fallback-wave.mjs`
- `scripts/maintainer/run-iherb-official-fallback-parallel.mjs`
- `scripts/maintainer/merge-iherb-overlay-bulk-to-supabase.mjs`
- `scripts/maintainer/build-iherb-overlay-high-frequency-validation.mjs`
- `docs/exec-plans/active/p0_p3_product_closure/high_frequency_product_hit_validation.json`

## Required outputs
- Refresh `high_frequency_product_hit_validation.json`
- Refresh `high_frequency_recovery_wave_status.json`
- Add blocker evidence when a target brand cannot be rescued safely

## Must do
- Target at least `190` new complete hits from the current missing pool.
- Keep identity thresholds stable.
- Preserve safe degradation for weak rows.

## Do not do
- Do not start a broad iHerb expansion wave.
- Do not use noisy product-title guesses to inflate merges.
- Do not keep scaling a brand lane after it is proven non-incremental.

## Exit criteria
- The representative high-frequency set reaches `>= 70.0%` complete hits
- Or the remaining gap is explicitly blocker-classified with evidence
