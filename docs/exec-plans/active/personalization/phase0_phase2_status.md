# Personalization Phase 0-7 Status

## What Landed

- `Phase 0`
  - V1 personalization catalogs under `data/personalization/`
  - JSON schemas under `data/personalization/schemas/`
  - conservative feature flags defaulted off
- `Phase 1`
  - `PersonalizationProfile` resolution with `declared / observed / derived / meta`
  - `PersonalizationSnapshot` compiler
  - thin selector layer for `home`, `smartFilter`, `planPreview`, and `scheduleDefaults`
- `Phase 2`
  - goal catalog normalization
  - conservative product-goal scoring
  - eligibility policy that keeps `relevance` separate from `eligibility`
- `Phase 3`
  - dedicated strategy engines for blocker, experience, diet review lanes, and activity plan
  - `stackComposer` that outputs a composition-based first stack with roles, schedule template, and explanation facts
- `Phase 4`
  - shared `PersonalizationProvider`
  - selector-backed surface consumption for onboarding plan preview, first stack, My Saved smart filter, and schedule defaults
  - Home emphasis reads `HomePersonalizationVM`
- `Phase 5`
  - thin explainer adapter backed by DeepSeek with deterministic fallback
  - structured `ExplanationPayload` generated from snapshot facts only
  - route exposure for `/api/personalization/explain`
- `Phase 6`
  - local-first feedback persistence keyed by user
  - override registry that applies persisted and current-session overrides before surfaces are consumed
  - override event recording for schedule defaults and first-stack choices
- `Phase 7`
  - coverage-gated real product evaluation loop for saved supplements
  - `factsStatus === full` required for `coverage_ready`
  - Smart Filter activation now consumes evaluated membership instead of local tags pretending to be personalization
  - First Stack now reuses the same evaluated candidate bundle instead of recomputing from stale legacy match maps
  - first-stack item display and explanation payloads now prefer evaluated product metadata from the same bundle
  - non-coverage-ready products fall back to `not_enough_structured_data` and are excluded from `strong_match`, `related`, and first-stack eligibility
  - Smart Filter and First Stack now emit shared evaluated-loop exposure, click, save, and conversion analytics with replayable snapshot metadata

## Guardrails Confirmed

- personalization config keys align with onboarding goal/type/blocker enums
- diet and activity remain direction-only, not diagnosis or dosing
- low disclosure, proprietary blends, duplicate overlap, and generic safety paths are represented as caps/reasons
- UI consumers read precompiled snapshot surfaces instead of recomputing logic page-by-page
- overrides apply with explicit precedence: override > persisted feedback > observed > declared > catalog
- AI explanation consumes structured facts from snapshot output only; it does not receive raw profile or raw match tables

## Validation

- `tsc --noEmit`
- targeted personalization tests:
  - `lib/personalization/dataSchema.test.ts`
  - `lib/personalization/profileResolver.test.ts`
  - `lib/personalization/personalizationCompiler.snapshot.test.ts`
  - `lib/personalization/goldenPersonas.test.ts`
  - `lib/personalization/goalMatchScoring.test.ts`
  - `lib/personalization/eligibilityPolicy.test.ts`
  - `lib/personalization/stackComposer.test.ts`
  - `lib/personalization/feedbackStore.test.ts`
  - `lib/personalization/overrideRegistry.test.ts`
  - `lib/personalization/productEvaluationGate.test.ts`
  - `lib/personalization/savedProductEvaluation.test.ts`
  - `lib/analytics/transport.test.ts`
  - `lib/analytics/evaluated-loop.test.ts`
  - `tests/onboarding/first-stack.analytics.test.ts`
  - `contexts/PersonalizationContext.smartFilterEvaluation.test.ts`
  - `components/screens/MySupplement.smartFilterEvaluation.test.ts`
  - `backend/tests/personalizationAiFallback.test.ts`
  - `backend/tests/personalizationAiPayload.test.ts`
  - `backend/tests/personalizationRoutes.test.ts`

All targeted personalization tests pass.

## Current Verdict

- `Phase 0-7` core personalization infrastructure is now landed.
- `Smart Filter` and `First Stack` now share the same high-confidence product evaluation loop instead of relying on tag-only preselection or stale legacy match maps.
- Evaluated-loop funnel analytics are now live on the first two activated personalization surfaces.
- The next recommended step is to use this funnel to decide whether activation quality is strong enough to broaden rollout to `Home`.
