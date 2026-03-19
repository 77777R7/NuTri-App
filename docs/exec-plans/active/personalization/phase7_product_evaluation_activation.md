# Phase 7: Product Evaluation Activation

## Objective

Turn personalization from profile-only orchestration into a real, coverage-gated product evaluation loop that users can feel on a product surface.

This phase does **not** open personalization to the full catalog. It activates a narrow, explainable path on `My Saved / Smart Filter` first, then reuses the exact same evaluated candidate bundle for `First Stack`.

## Activation Rules

- only products with `factsStatus === full` are treated as `coverage_ready`
- `partial` and `none` facts status products are classified as `not_enough_structured_data`
- `not_enough_structured_data` products cannot enter:
  - `strong_match`
  - `related`
  - `first stack`
- relevance and eligibility remain separate:
  - goal scoring answers `how relevant`
  - eligibility answers `can it be promoted / ranked`

## What Landed

- `productEvaluationGate`
  - evaluates saved-product coverage status from facts status
- `savedProductEvaluation`
  - compiles per-product coverage, goal matches, eligibility, and Smart Filter membership
- `PersonalizationProvider`
  - runs an async saved-product evaluation loop via `/api/ensure-overview`
  - recompiles snapshot with evaluation results
- `Smart Filter`
  - goal/type activation now consumes evaluated membership from snapshot-backed context
  - local behaviors like search, timing tags, custom tags, and `Recently Viewed` remain intact
- `First Stack`
  - candidate selection now reuses evaluated saved-product bundles instead of recomputing from stale legacy maps
  - item display metadata comes from evaluated product facts/display payloads when present
  - explanation facts remain tied to the same evaluated bundle used for ranking and gating
- `Evaluated-loop analytics`
  - Smart Filter and First Stack now emit shared `evaluated_loop_*` analytics
  - exposure, click, save, and conversion events carry replayable snapshot fields
  - page-local events still exist where helpful, but now use the shared analytics transport

## User-Facing Result

When a user opens `My Saved` and uses Smart Filter:

- goal filters no longer rely only on local tags
- coverage-ready products can appear as real `strong_match` / `related`
- low-structure products are held back behind `not_enough_structured_data`
- seeded personalization tags only auto-activate if real evaluated membership exists

When a user reaches `First Stack`:

- recommended items now come from the same coverage-gated evaluation loop used by Smart Filter
- first-stack content prefers real product display metadata over raw ids
- products held back by coverage or eligibility do not silently leak into the stack composer path
- exposure, click, save, and accepted-stack events are now attributable to the same evaluated bundle used to build the result

## Guardrails

- scan/barcode protected scope was not modified
- no partial/weakly structured product is promoted into strong personalization paths
- all decisions remain reason-coded and snapshot-backed
- AI explanation still consumes structured snapshot facts only
- evaluated-loop analytics now log against the same `snapshotId` / `rulesVersion` used for ranking and explanation

## Validation

- `tsc --noEmit`
- `lib/personalization/productEvaluationGate.test.ts`
- `lib/personalization/savedProductEvaluation.test.ts`
- `lib/personalization/personalizationCompiler.snapshot.test.ts`
- `lib/personalization/goldenPersonas.test.ts`
- `contexts/PersonalizationContext.smartFilterEvaluation.test.ts`
- `components/screens/MySupplement.smartFilterEvaluation.test.ts`
- `lib/personalization/stackComposer.test.ts`
- `backend/tests/personalizationAiPayload.test.ts`
- `backend/tests/personalizationRoutes.test.ts`
- `lib/analytics/transport.test.ts`
- `lib/analytics/evaluated-loop.test.ts`
- `tests/onboarding/first-stack.analytics.test.ts`

## Product Verdict

`Phase 7` is activated at the `Smart Filter` and `First Stack` surfaces, with evaluated-loop funnel analytics now attached.

This is the first place where onboarding goals now produce a real product result instead of a UI-only seed, and where `First Stack` recommendations are grounded in the same high-confidence evaluation loop.

## Next Recommended Step

Use the new evaluated-loop exposure / click / save / conversion data to decide whether activation quality is strong enough to broaden toward `Home`.
