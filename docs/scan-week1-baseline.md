# Scan Week 1 Baseline

Date: 2026-03-12

Scope:
- Week 1 `Scan barcode` stability work
- Core 5 barcode set only
- Formal baseline run against production Render

Production target:
- `https://nutri-app-qn0u.onrender.com`

Method:
- Production requests were replayed directly against Render.
- `GET /api/decision-support/v1?barcode=<code>&viewMode=details`
- `GET /api/scan-facts/v1/web/<code>`
- `POST /api/enrich-stream` with SSE timing capture for `rev0`, `rev1`, and `done`
- The run used the existing auth-disabled production path to isolate scan pipeline timing from user session state.

## Telemetry Added

Backend metrics:
- `decision_support_digest_mismatch`
- `decision_inputs_hash_mismatch`
- `decision_support_refetch_count_per_scan`
- `snapshot_bypass_missing_iherb_overlay_rate`
- `bundle_fast_cache_rejected_missing_overlay_rate`
- `stage0_dsld_recovery_rate`
- `stage0_dsld_recovery_ms`
- `time_to_rev0_ms`
- `time_to_rev1_ms`
- `time_to_done_ms`
- `ingredient_overview_ms`
- `scientific_background_ms`
- `product_overview_ai_closed_early_rate`

Frontend scan UX metrics:
- `time_to_first_renderable_decision_template`
- `time_to_score_visible`
- `time_to_core_cards_visible`
- `time_to_loading_badge_hidden`
- `decision_support_fetch_count_per_scan`

Implementation notes:
- Backend metrics are emitted from [metrics.ts](/Users/howard07/NuTriApp/nutri-app/backend/src/metrics.ts), [server.ts](/Users/howard07/NuTriApp/nutri-app/backend/src/server.ts).
- Frontend UX metrics are emitted from [useStreamAnalysis.ts](/Users/howard07/NuTriApp/nutri-app/hooks/useStreamAnalysis.ts), [AnalysisDashboard.tsx](/Users/howard07/NuTriApp/nutri-app/components/scan/AnalysisDashboard.tsx), and [result.tsx](/Users/howard07/NuTriApp/nutri-app/app/scan/result.tsx).

## Core 5 Production Baseline

| Product | Barcode | Decision Support | Scan Facts (web) | Stream `rev0` | Stream `rev1` | Stream `done` | Score |
|---|---|---:|---:|---:|---:|---:|---|
| Omega-3 | `00023249011835` | `1187.3ms` | `137.9ms` | `368.2ms` | `711.5ms` | `3530.5ms` | `85 / Strong` |
| Vitamin C | `00023249090021` | `439.9ms` | `128.6ms` | `281.2ms` | `2616.0ms` | `2618.1ms` | `85 / Strong` |
| GI with Phage | `00737870212539` | `410.7ms` | `139.0ms` | `283.4ms` | `2374.4ms` | `2479.3ms` | `60 / Fair` |
| Astaxanthin | `00023249012566` | `450.6ms` | `163.9ms` | `281.0ms` | `464.8ms` | `3952.6ms` | `85 / Strong` |
| NAC 600 mg | `00766298001890` | `478.6ms` | `135.7ms` | `365.7ms` | `2521.3ms` | `2619.4ms` | `60 / Fair` |

## Alignment Result

All 5 core products aligned on production:
- `factsDigestHash` match between stream `rev1` and `GET /api/decision-support/v1`
- `decisionSupportDigest` match between stream `rev1` and `GET /api/decision-support/v1`
- `decisionInputsHash` match between stream `rev1` and `GET /api/decision-support/v1`

This is the key Week 1 correctness checkpoint. The scan pipeline is no longer producing a separate GET-vs-stream decision contract for the core 5 set.

## Interpretation

What is fast:
- `scan-facts(web)` is consistently cheap: about `129ms - 164ms`
- `rev0` is also cheap: about `281ms - 368ms`
- `decision-support` is mostly sub-`500ms`, except Omega-3 at `1187ms`

What still dominates user-perceived wait:
- authoritative stream `rev1` for Vitamin C, GI with Phage, and NAC still lands around `2.3s - 2.6s`
- `done` can trail `rev1` significantly for Omega-3 and Astaxanthin (`3.5s - 4.0s`)

Implication:
- the pipeline is no longer failing contract consistency for the core 5
- the next performance bottleneck is not basic GET latency
- the next performance bottleneck is authoritative stream completion and finalization tail

## Week 1 Outcome

Week 1 is not only about speed. The main correctness goal was:
- one facts layer
- one decision contract
- one authoritative score/content result

That goal is now met for the core 5 production baseline.

The remaining Week 1 follow-up is operational:
- keep this baseline frozen
- run it before every preview/TestFlight candidate
- use the release gate in [scan-release-gate.md](/Users/howard07/NuTriApp/nutri-app/docs/scan-release-gate.md)
