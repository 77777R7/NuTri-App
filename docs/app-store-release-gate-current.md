# App Store Release Gate - Current Evidence

Date: 2026-05-22
Branch observed: `codex/auth-visual-refresh`
Workspace: `/Users/howard07/NuTriApp/nutri-app`

## Verdict

Release candidate with blockers.

The current checkout has strong automated evidence for Product Search, Pro gates,
onboarding routing, scan result contracts, backend bundle generation, and iOS
Metro export. It is not ready to submit directly because the working tree still
mixes release-ready Search changes with dirty protected scan/release files and
unpackaged onboarding, paywall, profile, saved-stack, and backend changes.

## Passed Evidence

- `npx expo export --platform ios --output-dir /private/tmp/nutri-ios-export-check`
  - Passed.
  - iOS bundle generated successfully.
  - Bundle: `_expo/static/js/ios/entry-53b054e572fe816d2e414e50efdcfc43.hbc`
  - Output directory: `/private/tmp/nutri-ios-export-check`

- `npm run search:verify-release`
  - Passed.
  - Summary: `status=pass`, `passed=6`, `total=6`.
  - Product Search UI/query contracts: 52/52 passed.
  - Product Search replay/smoke verifier tests: 22/22 passed.
  - Backend release build passed.

- Pro/Auth/Saved/Stack Safety release contracts
  - Command:
    `node --import tsx --test tests/mySaved/stack-safety-paywall-contract.test.ts tests/mySaved/stack-safety-pro.contract.test.ts tests/pro/app-store-readiness-contract.test.ts tests/pro/pro-feature-gates.test.ts tests/pro/pro-paywall-contract.test.ts tests/pro/waitlist-trial-bonus.test.ts tests/auth/auth-mode-policy.test.ts backend/tests/week3-safety-wording.test.mjs`
  - Passed: 31/31.

- Onboarding release contracts
  - Command:
    `node --import tsx --test tests/onboarding/compact-flow.contract.test.ts tests/onboarding/allergy-step.contract.test.ts tests/onboarding/goals.contract.test.ts tests/onboarding/activation-loop.contract.test.ts tests/onboarding/first-stack.analytics.test.ts tests/onboarding/plan-preview.contract.test.ts tests/onboarding/scan-first-handoff.contract.test.ts tests/onboarding/motion-contract.test.mjs tests/onboarding/profile-edit-flow.contract.test.ts tests/onboarding/deferred-routes-redirect.contract.test.ts tests/onboarding/done.destination-contract.test.ts`
  - Passed: 38/38.

- Scan release contracts
  - Command:
    `node --import tsx --test tests/scan/barcode-success-stability-contract.test.ts tests/scan/crash-proof-gate.test.ts tests/scan/mobile-soak-timeout-classification.test.ts tests/scan/resultViewRouting.test.ts tests/scan/scan-trust-ui-contract.test.ts tests/scan/personalized-insights-coach-overlay-contract.test.ts tests/scan/result-breakdown-paywall.contract.test.ts tests/scan/score-ring-state-consistency.test.ts tests/scan/product-overview-ai-fallback.test.ts tests/scan/verification-presentation.test.ts backend/tests/barcode-release-flags-contract.test.mjs backend/tests/guest-scan-session-contract.test.mjs backend/tests/barcode-resolution-policy-contract.test.mjs`
  - Passed: 40/40.

- `npm run lint`
  - Passed with 0 errors.
  - Remaining: 124 warnings.

- `npm --prefix backend run build`
  - Passed.
  - Render runtime wrapper generated.

## Blocking Evidence

- `npm run release:app-store-check`
  - Failed with `status=blocked`.
  - Blocker: protected scan/release files are dirty and need a dedicated release
    gate before submission:
    - `app.config.ts`
    - `app/scan/barcode.tsx`
    - `app/scan/result.tsx`
    - `backend/src/server.ts`
    - `components/scan/AnalysisDashboard.tsx`
    - `components/scan/AnalysisTopSectionRedesign.tsx`
    - `components/scan/ScanResultHeaderChrome.tsx`
    - `eas.json`

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

Ship-ready after packaging:

- Product Search release package.
  - Search contracts and iOS bundle export passed.
  - Needs final commit/merge discipline so the app branch uses the latest Search
    UI/cache/index contracts.

Needs dedicated release review before shipping:

- Protected scan/release files listed above.
- App Store config and production env wiring.
- RevenueCat/paywall post-purchase flow.
- Auth/onboarding/home profile changes.
- My Saved and Stack Safety changes.
- Backend science/safety/search support changes that are not part of the staged
  Product Search package.

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

Do not submit from the current dirty branch.

Next best step is to create a clean release branch or worktree, then apply
packages one by one:

1. Commit/merge Product Search package.
2. Apply App Store config and RevenueCat env package.
3. Apply Paywall/Pro package.
4. Apply Onboarding/Auth/Home package only after focused contracts stay green.
5. Apply protected Scan package only with the scan release contracts attached.
6. Rerun `npm run release:app-store-check`.
7. Build TestFlight and complete native sandbox purchase smoke.
