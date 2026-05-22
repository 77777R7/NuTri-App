# App Store Release Gate - Current Evidence

Date: 2026-05-22
Branch observed: `codex/app-store-release-from-main`
Workspace: `/private/tmp/nutri-appstore-from-main`
Base: latest `origin/main` at `9ae796b9`

## Verdict

Main-based release candidate in progress.

This branch starts from the current `origin/main` Product Search and scan/backend
line, then layers only the App Store release essentials that were missing from
main:

- App Store config and release checker.
- RevenueCat production env contract.
- Pro feature gates and post-purchase success flow.
- Profile/legal/account deletion release surface.
- App icon alpha fix.
- Stack Safety wording contract.

Do not submit to App Store Review until this main-based candidate has passed the
full focused gate set again and a native TestFlight sandbox purchase/restore
smoke has passed on device.

## Current Release Package Commits

- `9f0537d2` - App Store config, RevenueCat env, release docs, release checker.
- `4df3f77b` - Pro gates, post-purchase success, saved limit, Stack Safety.
- `3a29edf3` - Home compile fix after applying Pro gates on latest main.
- `e9286b41` - Profile/legal release gates, App Store icon alpha, Stack Safety copy.
- `6b8f5646` - Stack Safety wording contract update.

## Evidence To Refresh On This Branch

Run from `/private/tmp/nutri-appstore-from-main`:

- `npm run release:app-store-check`
- `npm run search:verify-release`
- `npm run lint`
- Focused Pro/Auth/Saved/Stack Safety contract suite.
- Focused scan contract suite.
- iOS export or EAS TestFlight build.

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

## Do Not Ship Without Explicit Decision

- Any local preview `.ipa` artifacts.
- Local/temp metadata such as `supabase/.temp/*`.
- Untracked local tool or skill metadata unless intentionally required.
- Dirty science/search replay/progress changes from the active workspace unless
  they receive their own release gate.
