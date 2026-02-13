# Web-Only Route A Promise (Not Scored, Evidence-Gated, Limited Output)

Date: 2026-02-13  
Owner: NutriApp team  
Status: Accepted / Implemented

## Context

Web-only barcodes are long-tail and inherently noisy (marketplace pages, JS-rendered content, prompt-injection risk, missing label facts). In practice, users can experience:

1. Very fast results with limited content (often due to fast watchdog timeouts and/or missing usable evidence).
2. Misleading UI score placeholders (e.g. `50/100`) that look like a real computed score.
3. Logs that look like schema failures or errors even when behavior is expected/handled.

This ADR makes the product promise explicit so "what we show" is aligned with "what we can prove".

## Decision: Route A (Web-only, analysis-only, safety-first)

For web-only inputs, we commit to a conservative, auditable experience:

1. No scoring:
   - `analysis_bundle.meta.scoreAvailable=false` for web-only Route A.
   - The UI must show **Not scored** with a short reason, and must never show placeholder numeric scores.
2. Evidence-gated output:
   - Retrieved web text is treated as **untrusted data**, sanitized, and never allowed to override system/developer instructions.
   - Chemical form / salt form explanations remain **not_provided** unless evidence is present (no guessing).
3. Explicit degradation:
   - When evidence is insufficient or budgets/timeouts trigger, we degrade to `limited/not_provided` rather than fabricating.
4. Contract and resiliency non-negotiables remain in force:
   - SSE must converge `rev0 -> rev1 -> done -> close`.
   - `/api/analysis-section` never returns 500 (always `200 + dataStatus`).

## UI Requirements

1. If `scoreAvailable=false`: show "Not scored" + reason.
2. If `scoreAvailable=true` but scoring is not complete (streaming/pending): show "Scoring..." (no numeric score, no `/100` suffix).
3. Only show `NN/100` when score is present and complete.

## Route B (Scoring + richer web output) Is Explicitly Deferred

Route B (web scoring + richer verified sections) is allowed only after we can measure and sustain stability:

1. `watchdogFastTimeoutRateNoCache` is low and stable (threshold TBD after measurement).
2. `webUsefulOutputRate` and RAG quadrant metrics are stable for N nightly runs (N TBD).
3. Contract metrics remain healthy (done/close, missing_done attributable).

Until those conditions are met, Route A is the product promise for web-only.

