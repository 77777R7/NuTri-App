# App Store Release Gate - Current Evidence

Date: 2026-05-22
Branch observed: `codex/auth-visual-refresh`
Workspace: `/Users/howard07/NuTriApp/nutri-app`

## Verdict

Release candidate for TestFlight, with native purchase/device smoke still required.

The release-critical packages have been separated into commits and the current
release checker passes from a clean candidate worktree. Product Search, Pro
gates, onboarding routing, scan result contracts, Profile/legal release
surfaces, backend bundle generation, and iOS Metro export all have current
automated evidence.

Do not submit to App Store Review until TestFlight/native sandbox purchase smoke
is complete. The working tree also still has non-protected dirty work that
should either be committed in a follow-up release package or kept out of the
submission branch.

## Release Package Commits

- `5f51dcf7` - Product Search release package.
- `fc8b7ba7` - App Store config, RevenueCat env, release docs, release checker.
- `70e41b17` - Pro gates, post-purchase success, saved limit, Stack Safety.
- `c1cd3b26` - Onboarding/auth handoff and post-scan/profile return helpers.
- `b8a6e1a4` - Protected scan release gates and scan contracts.
- `334e3db2` - Release gate evidence update for the first candidate.
- `e73e9c0f` - Product Search Database analysis helper and spinner hook gate.
- `ec5f7b5f` - Product Search index migrations.
- `91be3711` - Stable Database analysis import for lint release gate.
- `a2906dbe` - Profile/legal release gates, App Store icon alpha, Stack Safety copy.
- `ca92c40e` - Stack Safety wording contract update.

## Passed Evidence

- `npx expo export --platform ios --output-dir /private/tmp/nutri-ios-export-check`
  - Passed.
  - iOS bundle generated successfully.
  - Bundle: `_expo/static/js/ios/entry-53b054e572fe816d2e414e50efdcfc43.hbc`
  - Output directory: `/private/tmp/nutri-ios-export-check`

- `npx expo export --platform ios --output-dir /private/tmp/nutri-ios-export-check-2`
  - Passed after release package commits.
  - iOS bundle generated successfully.
  - Bundle: `_expo/static/js/ios/entry-53b054e572fe816d2e414e50efdcfc43.hbc`
  - Output directory: `/private/tmp/nutri-ios-export-check-2`

- `npx expo export --platform ios --output-dir /private/tmp/nutri-ios-export-clean-candidate`
  - Passed from clean candidate worktree at `ca92c40e`.
  - iOS bundle generated successfully.
  - Bundle: `_expo/static/js/ios/entry-fe3d939d1bf806096ae5fe94511fcad8.hbc`
  - Output directory: `/private/tmp/nutri-ios-export-clean-candidate`

- `npm run release:app-store-check`
  - Passed from clean candidate worktree at `ca92c40e`.
  - Summary: `status=pass`, `blockerCount=0`, `warningCount=0`.
  - Confirms:
    - no unused `expo-location`
    - no unused iOS location permission string
    - camera purpose string configured
    - production EAS profile has public HTTPS API URLs and RevenueCat contract
    - App Store Connect app id configured
    - required release docs exist
    - no protected scan/release files are dirty

- `npm run search:verify-release`
  - Passed from clean candidate worktree at `ca92c40e`.
  - Summary: `status=pass`, `passed=6`, `total=6`.
  - Product Search UI/query contracts: 52/52 passed.
  - Product Search replay/smoke verifier tests: 17/17 passed.
  - Backend release build passed.

- Pro/Auth/Saved/Stack Safety release contracts
  - Command:
    `node --import tsx --test tests/mySaved/stack-safety-paywall-contract.test.ts tests/mySaved/stack-safety-pro.contract.test.ts tests/pro/app-store-readiness-contract.test.ts tests/pro/pro-feature-gates.test.ts tests/pro/pro-paywall-contract.test.ts tests/pro/waitlist-trial-bonus.test.ts tests/auth/auth-mode-policy.test.ts backend/tests/week3-safety-wording.test.mjs`
  - Passed: 31/31.

- Pro/Auth/Saved/Stack Safety release contracts after adding Stack Safety card
  contract:
  - Command:
    `node --import tsx --test tests/mySaved/stack-safety-paywall-contract.test.ts tests/mySaved/stack-safety-pro.contract.test.ts tests/mySaved/stack-safety-presentation.test.ts tests/pro/app-store-readiness-contract.test.ts tests/pro/pro-feature-gates.test.ts tests/pro/pro-paywall-contract.test.ts tests/pro/waitlist-trial-bonus.test.ts tests/auth/auth-mode-policy.test.ts backend/tests/week3-safety-wording.test.mjs`
  - Passed from clean candidate worktree at `ca92c40e`: 33/33.

- Onboarding release contracts
  - Command:
    `node --import tsx --test tests/onboarding/compact-flow.contract.test.ts tests/onboarding/allergy-step.contract.test.ts tests/onboarding/goals.contract.test.ts tests/onboarding/activation-loop.contract.test.ts tests/onboarding/first-stack.analytics.test.ts tests/onboarding/plan-preview.contract.test.ts tests/onboarding/scan-first-handoff.contract.test.ts tests/onboarding/motion-contract.test.mjs tests/onboarding/profile-edit-flow.contract.test.ts tests/onboarding/deferred-routes-redirect.contract.test.ts tests/onboarding/done.destination-contract.test.ts`
  - Passed from clean candidate worktree at `ca92c40e`: 38/38.

- Scan release contracts
  - Command:
    `node --import tsx --test tests/scan/barcode-success-stability-contract.test.ts tests/scan/crash-proof-gate.test.ts tests/scan/mobile-soak-timeout-classification.test.ts tests/scan/resultViewRouting.test.ts tests/scan/scan-trust-ui-contract.test.ts tests/scan/personalized-insights-coach-overlay-contract.test.ts tests/scan/result-breakdown-paywall.contract.test.ts tests/scan/score-ring-state-consistency.test.ts tests/scan/product-overview-ai-fallback.test.ts tests/scan/verification-presentation.test.ts backend/tests/barcode-release-flags-contract.test.mjs backend/tests/guest-scan-session-contract.test.mjs backend/tests/barcode-resolution-policy-contract.test.mjs`
  - Passed from clean candidate worktree at `ca92c40e`: 40/40.

- `npm run lint`
  - Passed from clean candidate worktree at `ca92c40e` with 0 errors.
  - Remaining: 124 warnings.

- `npm --prefix backend run build`
  - Passed.
  - Render runtime wrapper generated.

## Remaining Non-Automated Release Evidence

- Native TestFlight install and sandbox purchase/restore have not been executed
  in this gate yet.
- App Store Connect subscription submission readiness still depends on Apple
  Paid Apps Agreement/subscription product availability and first-subscription
  review packaging.
- Current working tree has non-protected dirty files that should not be silently
  included in the App Store submission branch.

## Typecheck Diagnostic Evidence

- `npx tsc --noEmit`
  - Failed.
  - Current project-level TypeScript config includes broad backend scripts,
    temporary review files, generated/maintainer surfaces, and tests that are
    not a clean App Store release gate.
  - This should not be treated as the single release blocker, but the repo needs
    a dedicated app-store typecheck config before the final release branch.

- `npx tsc --noEmit --project tsconfig.scan-gate.json`
  - Failed.
  - The existing scan-gate TypeScript config follows imports into broad backend
    and test surfaces. It is currently useful as a diagnostic, not a pass/fail
    release gate.

## Current Package Classification

Committed release packages:

- Product Search release package.
- Product Search index migrations.
- App Store config and production env wiring.
- RevenueCat/paywall post-purchase flow.
- Auth/onboarding/home handoff package.
- My Saved and Stack Safety gates.
- Protected scan release package.
- Profile/legal release surfaces.
- App Store icon alpha fix.

Still outside the release package unless explicitly accepted:

- Progress screen style changes.
- Backend science/safety compiler changes not covered by the release commits.
- Search replay/data artifacts not committed in the Product Search package.
- Local/temp metadata such as `supabase/.temp/cli-latest`.
- Untracked local tool or skill metadata unless intentionally required.

Do not ship without explicit decision:

- Local/temp metadata such as `supabase/.temp/cli-latest`.
- Untracked local tool or skill metadata unless intentionally required.
- Any local preview `.ipa` artifacts.

## Native TestFlight Checklist Still Required

Automated JS and contract gates are not enough for App Store submission. Before
submit, run a real device or TestFlight smoke:

- Install release/TestFlight build on iPhone.
- Open app from cold start.
- Complete or bypass auth exactly as production intends.
- Complete first scan and verify no barcode/result crash.
- Open Product Search, browse All and Vitamins, search exact brand-product, load
  more, open Database analysis.
- Confirm low-facts/basic records do not appear as full analysis-ready rows.
- Trigger scan-limit paywall for second normal scan.
- Trigger Product Search paywall for a free user.
- Trigger saved supplement limit paywall.
- Purchase monthly and annual in sandbox.
- Verify RevenueCat returns active `pro` entitlement.
- Verify app sets `isPremium=true`.
- Restore purchase and confirm restore goes through the post-purchase success
  screen.
- Kill and relaunch app, confirm entitlement and navigation recover.

## Next Release Action

Do not submit directly from the current dirty working tree.

Next best step is to push `codex/app-store-release-candidate` at `ca92c40e`,
open/merge a release PR, then:

1. Build TestFlight from the clean release candidate.
2. Complete native sandbox purchase/restore smoke.
3. Verify production Product Search index/cache and Render backend after deploy.
4. Only then submit the app version and first subscription package to App Store
   Review.
