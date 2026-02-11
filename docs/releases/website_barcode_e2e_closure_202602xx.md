# Website Barcode E2E Closure (2026-02-11)

## Scope
This release upgrades Website Barcode E2E from link-level checks to product-grade user-flow gating.

- Suite A: KB-hit regression (DSLD/LNHPD fixture)
- Suite B: web-only fallback regression (fixture)
- Phase mode: `phase1` (Suite A blocking, Suite B warning) or `phase2` (both blocking)

## Delivered
1. Fixture-driven suites (`kb|web|both`) with explicit input contracts.
2. SSE stop condition (`revision1|fast_ai|persisted`) and early stream cancel support.
3. Retry/backoff+jitter for SSE and analysis-section calls.
4. Section coverage for `ingredients_detail`, `overview`, `usage`.
5. Content contracts in gate:
   - `overviewSummary.length >= 40`
   - `usage.timing` non-empty
   - `usage.withFood` is boolean
6. Error bucketing and retry accounting in `gate_summary.json`.
7. Backend SSE `persisted` event and `analysis_bundle.meta.scoreAvailable` stream contract.

## Artifacts
- `suite_a_results.json`
- `suite_b_results.json`
- `suite_a_summary.json`
- `suite_b_summary.json`
- `gate_summary.json`
- `one_page_report.md`
- `build_web_fixture_report.json` (when `--build-web-fixture`)
- compatibility outputs retained:
  - `e2e_results.json`
  - `e2e_summary.json`

## Gate policy
- Phase 1:
  - Suite A blocks release
  - Suite B warning only
- Phase 2:
  - Suite A and Suite B both block release
- Promotion signal:
  - `suiteB` must pass for 10 consecutive runs before recommending Phase 2 switch.

## Route policy
- Route A (current): web fallback is analysis-only (`scoreAvailable=false`).
- Route B (future): web source enters V4 scoring via separate ingestion/scoring closure.
