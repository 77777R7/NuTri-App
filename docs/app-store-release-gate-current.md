# App Store Release Gate - Current Evidence

Date: 2026-05-23
Branch observed: `main` via `codex/app-store-release-from-main`, `codex/app-store-eas-lockfile-fix`, `codex/app-store-submit-evidence`, `codex/app-store-final-gate-wording`, `codex/testflight-smoke-evidence`, `codex/testflight-evidence-hard-gate`, `codex/app-store-metadata-gate`
Workspace: `/private/tmp/nutri-appstore-from-main`
Base: latest `origin/main` through PR #210 (`57eea67f`)

## Verdict

Release candidate is code-gated, has a successful production iOS EAS build, and
the build has been uploaded to App Store Connect/TestFlight. It is now waiting
for Apple build processing before native TestFlight and sandbox purchase/restore
smoke can complete.

This branch starts from the current `origin/main` Product Search and scan/backend
line, then layers only the App Store release essentials that were missing from
main:

- App Store config and release checker.
- RevenueCat production env contract.
- Pro feature gates and post-purchase success flow.
- Profile/legal/account deletion release surface.
- App icon alpha fix.
- Stack Safety wording contract.
- App Store metadata privacy/support and age-rating contract.

Do not submit to App Store Review until Apple processing completes and native
TestFlight sandbox purchase/restore smoke has passed on device.

## Current Release Package Commits

- `9f0537d2` - App Store config, RevenueCat env, release docs, release checker.
- `4df3f77b` - Pro gates, post-purchase success, saved limit, Stack Safety.
- `3a29edf3` - Home compile fix after applying Pro gates on latest main.
- `e9286b41` - Profile/legal release gates, App Store icon alpha, Stack Safety copy.
- `6b8f5646` - Stack Safety wording contract update.
- `0f02d10e` - Release QA gates: legal helper usage, tester bypass guards, scan
  paywall price fallback cleanup, cohort/mobile-soak diagnostics.
- `5d1c5c82` - Sync `package-lock.json` for EAS `npm ci`.
- `5f5716b2` - Remove temporary push notification entitlement from release build.

## Current Verified Evidence

Run from `/private/tmp/nutri-appstore-from-main`:

- `npm ci --include=dev --ignore-scripts --dry-run`: pass.
- `npm run release:app-store-check`: now intentionally blocked until
  `docs/testflight-sandbox-smoke-evidence.md` is completed with native
  TestFlight/sandbox evidence and `Ready to submit for review: Yes`.
- `npm run lint`: pass, 0 errors / 117 existing warnings.
- `npm run search:verify-release`: pass, 6/6 verifier groups.
- Product Search UI/query contracts: 52/52 pass.
- Product Search replay/smoke tests: 22/22 pass.
- Pro/Auth/Saved/Stack Safety focused tests: 26/26 pass.
- Scan focused release regression tests: 51/51 pass.
- `npx expo export --platform ios --output-dir /private/tmp/nutri-ios-export-from-main`: pass.
- EAS production iOS build `e4cca553-6be9-4912-8a96-dc13e8d493f2`: pass.
  - Build number: 76.
  - IPA: `https://expo.dev/artifacts/eas/ufFvJAVEHUYYhPe8PgD1XC.ipa`.
  - Earlier EAS blockers fixed:
    - Build `abac7935-5347-4d89-ba6b-240dd41dea70`: `npm ci` lockfile mismatch.
    - Build `00eaa591-3fba-4ef8-9c6f-9f254965a365`: Push Notifications entitlement/profile mismatch.
- EAS Submit `2f373bf2-2341-4eed-8c50-254b2b506428`: pass.
  - Command that worked:
    `npx eas-cli submit --platform ios --url https://expo.dev/artifacts/eas/ufFvJAVEHUYYhPe8PgD1XC.ipa --non-interactive --verbose`
  - Upload result: `Successfully uploaded the new binary to App Store Connect`.
  - Apple processing link:
    `https://appstoreconnect.apple.com/apps/6759846833/testflight/ios`.
- EAS Metadata pull: pass.
  - Command:
    `npx eas-cli metadata:pull --profile production --non-interactive`
  - Result: generated `store.config.json` from App Store Connect using the EAS
    App Store Connect API key.
- EAS Metadata lint: pass.
  - Command:
    `npx eas-cli metadata:lint --profile production --json`
  - Result: `[]`.
- App Store metadata age rating: adjusted.
  - `healthOrWellnessTopics` is set to `true` because NuTri contains supplement
    health/wellness decision-support content.
- EAS Metadata push: pass.
  - Command:
    `npx eas-cli metadata:push --profile production --non-interactive`
  - Result:
    App Store Connect version/release info, en-US localized info, localized app
    info, and age rating declaration were updated.
  - App Store Connect link:
    `https://appstoreconnect.apple.com/apps/6759846833/appstore`.
- Physical device discovery: not ready.
  - `xcrun xctrace list devices` sees `Howard's iPhone (2)` on iOS `18.7.8`,
    but it is listed under Devices Offline.
  - `xcrun devicectl list devices` sees the same iPhone as `unavailable`.

## Submit Notes

`eas submit --platform ios --latest --non-interactive` and
`eas submit --platform ios --id e4cca553-6be9-4912-8a96-dc13e8d493f2 --non-interactive`
both returned:

```text
Service Unavailable
Error: GraphQL request failed.
```

This happened before Apple upload/auth output, so it is currently an Expo submit
service availability issue, not evidence of an app binary failure. The direct
IPA URL submit path succeeded and should be preferred if the same GraphQL error
appears again.

## Evidence To Refresh After Any New Code Change

Run from `/private/tmp/nutri-appstore-from-main`:

- `npm run release:app-store-check`
- `npm run search:verify-release`
- `npm run lint`
- Focused Pro/Auth/Saved/Stack Safety contract suite.
- Focused scan contract suite.
- iOS export or EAS TestFlight build.

## Native TestFlight Checklist Still Required

Automated JS and contract gates are not enough for App Store Review. Before
submitting the app version for review, run a real device or TestFlight smoke:

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

Record this final native evidence in
`docs/testflight-sandbox-smoke-evidence.md` before submitting the app version
for App Store Review.

## Do Not Ship Without Explicit Decision

- Any local preview `.ipa` artifacts.
- Local/temp metadata such as `supabase/.temp/*`.
- Untracked local tool or skill metadata unless intentionally required.
- Dirty science/search replay/progress changes from the active workspace unless
  they receive their own release gate.
