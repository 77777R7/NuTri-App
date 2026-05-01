# TestFlight Release Runbook - 2026-05-01

Release branch: `release/rc-1`
Current release branch HEAD: `9580ff22 Finalize release candidate checklist`
Required app code ancestor: `e77ee517 Fix release scan result simulator blockers`
Render target: `https://nutri-app-qn0u.onrender.com`
Render service: `srv-d4v0qbvpm1nc73benu7g`
Current live backend deploy observed: `dep-d7p6oi448j3c73ad5ckg`
Current live backend commit observed: `2aeae83aca8535a74b512610c5f4a5d68266da1f`

## Decision

Current release posture: `GO_WITH_WATCH` for scan-result readiness.

This RC is acceptable for TestFlight or controlled soft launch if release ops confirms App Store metadata, privacy, subscription, and crash monitoring. Do not add new science-writing, AI pass-rate, frontend redesign, Expo camera upgrade, or Express migration work to this release branch.

## What Is In Scope

- P0 crash fixes.
- P0 blank, unavailable, undefined, null, or `[object Object]` visible fixes.
- Login, onboarding, subscription, or scan-result blockers.
- Production configuration mistakes.
- App Store review blockers.
- Monitoring or rollback wiring needed to safely release.

## What Is Out Of Scope

- Expo camera upgrade.
- Express 5 migration.
- Barcode scan frontend redesign.
- Scan result layout redesign.
- New family expansion.
- Premium Scientific Background rewrite work.
- P3 copy polish.
- Broad API pass-rate chasing beyond verified release blockers.

## Pre-Build Checks

- [ ] Confirm local release branch is `release/rc-1`.
- [ ] Confirm `git rev-parse HEAD` is `9580ff22` or a later release-only checklist/build metadata commit.
- [ ] Confirm `git merge-base --is-ancestor e77ee517 HEAD` succeeds.
- [ ] Confirm `git status --short` is clean before build.
- [ ] Confirm Render `/health` returns `200`.
- [ ] Confirm no unrelated scan frontend redesign or backend migration is included.

## TestFlight Build

- [ ] Build from `release/rc-1`.
- [ ] Use the intended production/staging environment values for this RC.
- [ ] Do not point the build at a local backend.
- [ ] Upload build to TestFlight.
- [ ] Record build number:
- [ ] Record build artifact / EAS build URL:
- [ ] Record tester group:

## Minimum Manual Smoke

Use the companion barcode checklist:

- `docs/releases/RC_30_BARCODE_DEVICE_QA_20260501.md`

Minimum before controlled TestFlight:

- [ ] Fresh install opens without crash.
- [ ] Login works.
- [ ] Camera permission grant allows barcode scan.
- [ ] At least one real barcode scan navigates to result.
- [ ] Result page does not crash.
- [ ] Product identity appears.
- [ ] NuTri Score or limited-data state appears.
- [ ] Core cards appear.
- [ ] No visible blank, unavailable, undefined, null, or `[object Object]`.

Recommended before broader beta:

- [ ] Complete the full 30-barcode real-device pack.
- [ ] Confirm a second barcode scan works in the same session.
- [ ] Background/foreground during scan does not crash.
- [ ] Paywall opens, if enabled.
- [ ] Restore purchase works in sandbox, if subscriptions are enabled.

## Existing Evidence To Keep Attached

- `docs/releases/RELEASE_RC_CHECKLIST.md`
- `docs/releases/RC_AUTOMATION_EXECUTION_20260501.md`
- `output/scan-result-full-corpus-audit/scan-result-rc-cached-720-post-io-final-20260428/MVP_CLOSURE_VERDICT.md`
- `output/scan-result-full-corpus-audit/scan-result-full-corpus-core-closure-20260426/core-contract-summary.md`
- `output/scan-result-full-corpus-audit/rc-device-qa-30-render-20260430/RC_DEVICE_QA_REPORT.md`
- `output/scan-result-full-corpus-audit/rc-device-qa-30-render-20260430/simulator-preflight-release-fixed-r5/preflight.png`

## Launch Watch

Watch these during the first controlled release window:

- Render `/health`.
- `/api/enrich-stream` 5xx rate.
- `/api/enrich-stream` timeout/client abort rate.
- stream terminal state distribution.
- score available rate.
- visible unavailable counter or audit equivalent.
- sidecar fallback reason distribution.
- DeepSeek `llm_timeout`, `parse_failed`, and `quality_gate_rejected` buckets.
- app crash-free sessions.
- login/signup error rate.
- barcode not found / product not found rate.
- subscription purchase / restore errors, if enabled.

## Red Lines

Pause rollout if any of these are confirmed:

- Server 5xx above 1% sustained.
- Any confirmed blank scan result.
- Any confirmed visible `undefined`, `null`, or `[object Object]`.
- Crash-free sessions below 99%.
- Visible unavailable above 0.5%.
- Payment or login blocker.
- Reproducible scan-result crash on release/TestFlight build.

## Rollback / Hotfix

If the issue is backend-only:

- [ ] Keep current TestFlight build unchanged.
- [ ] Hotfix backend from the smallest branch possible.
- [ ] Deploy to Render.
- [ ] Re-run health and one barcode route replay.

If the issue is mobile-only:

- [ ] Stop expanding TestFlight group.
- [ ] Create smallest release branch patch.
- [ ] Build a new TestFlight RC.
- [ ] Re-run at least one real-device barcode scan.

If the issue is payment/login:

- [ ] Treat as release blocker.
- [ ] Do not expand rollout until the affected path is verified on device.

## Final Sign-Off

- Release owner:
- Build number:
- Date/time:
- Decision: `GO` / `GO_WITH_WATCH` / `NO_GO`
- Notes:
