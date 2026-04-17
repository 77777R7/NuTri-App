# Runtime/Search/Persona Closure (2026-04-17)

## Scope

This release freezes the current runtime/search quality closure as the new
release baseline for Science & Ingredients decision-support.

The closed blocker surface now includes:

- `stable-gate-baseline.v1`
- `runtime-result-page-contract.v0`
- `scan-smoke.v0`
- `persona-blocker-pack.v0`
- `consistency-pack.v0`
- warm-index live search replay

## Delivered

1. Runtime contract runner and blocker packs for result-page, scan smoke,
   persona blocker, and cross-surface consistency.
2. Search replay warm-ready gating for live search ranking and click-through
   expectations.
3. Source-aware decision-support and allergy insight hardening for algal oil,
   fish/shellfish/dairy/soy-sensitive scenarios, and title-led ingredient
   closure.
4. Repo-local governance tests that freeze the baseline and enforce blocker
   pack wiring.
5. A release runner that materializes the frozen curated baseline and executes
   all live runtime/search blocker suites in one shot.
6. A first `mobile-scan-smoke-mini.v0` harness on the existing mobile-soak
   lane for pre-device cold/hot/repeat/not-found/runtime regression checks.
   This first cut is intentionally continuity-first; it does not yet block on
   richer content-value or regulatory-richness heuristics.

## Frozen Evidence

Local closure evidence for this baseline:

- runtime result-page contract: `21 total / 0 fail`
- live scan smoke: `20 total / 0 fail`
- persona blocker: `14 total / 0 fail`
- cross-surface consistency: `24 total / 0 fail`
- warm-index live search replay: `10 / 10 pass`
- repo-local validation/test pack: `81 / 81 pass`

Artifacts remain local under:

- `output/validation-runtime/`
- `output/search-validation/`

## CI / Release Policy

PR and push policy:

- run repo-local blocker tests for governance, runtime-contract runner,
  search replay runner, and current scan/source/copy hardening tests.

Schedule / workflow-dispatch policy:

- start a local backend in CI
- run `run-release-quality-system-gates.mjs`
- fail the job if any runtime/search blocker suite reports `fail > 0`
- materialize the frozen curated live slice for PR/handoff evidence
- run `run-mobile-scan-smoke-mini.mjs` as non-blocking discovery/nightly smoke

## Notes

- The barcode scan UI freeze remains intact. This closure does not require
  editing protected scan UX files.
- `mobile-scan-smoke-mini.v0` is intentionally not yet a hard release blocker.
  It is the first repeatable smoke harness on the current mobile-soak lane,
  ahead of full device/camera automation.
