# P0 Active Queue Rescuer

## Mission
Shrink the current high-frequency `active_queue` aggressively and safely. The goal is to convert queued high-frequency products into product-surface complete hits, not merely to create more staging rows.

## Scope
- Work only on the current P0 high-frequency set.
- Stay within non-scan product closure.
- Prioritize products that already have enough identity to be merged safely.

## Priority brands
- Schiff
- Pure Encapsulations
- Nature's Bounty
- Nutricost
- Vital Proteins
- Nature Made
- Solgar
- Nature's Way
- Healthy Origins

## Primary scripts and inputs
- `scripts/maintainer/refresh-iherb-overlay-p0-by-official-fallback.mjs`
- `scripts/maintainer/merge-iherb-overlay-bulk-to-supabase.mjs`
- `scripts/maintainer/build-iherb-overlay-high-frequency-validation.mjs`
- `scripts/maintainer/run-week2-p0-rescue-executor.mjs`
- `docs/exec-plans/active/p0_p3_product_closure/high_frequency_product_hit_validation.json`

## Required outputs
- Refresh `high_frequency_product_hit_validation.json`
- Refresh `high_frequency_recovery_wave_status.json`
- Update `blocker_registry.json` when a lane is proven no-signal

## Must do
- Convert queued rows all the way through merge and product-surface validation.
- Measure net incremental uplift only against the latest stable baseline.
- Classify every failed recovery as either `execution_success`, `diagnostic_success`, `blocker_isolation`, or `no_signal`.

## Do not do
- Do not reopen the blocked browser-search lane.
- Do not use exact-barcode iHerb discovery as a primary lane unless a new signal source appears.
- Do not count a row as a win if it does not survive to product consumption.

## Exit criteria
- `active_queue` drops below `50`
- The complete-hit rate rises materially
- New complete hits survive product-surface audit
