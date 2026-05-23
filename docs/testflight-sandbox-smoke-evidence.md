# TestFlight Sandbox Smoke Evidence

Date:
Tester:
Device:
iOS version:
TestFlight build:
Apple sandbox account:
RevenueCat project:

## Release Build

- App Store Connect app ID: `6759846833`
- EAS build ID: `e4cca553-6be9-4912-8a96-dc13e8d493f2`
- Build number: `76`
- EAS submit ID: `2f373bf2-2341-4eed-8c50-254b2b506428`
- IPA: `https://expo.dev/artifacts/eas/ufFvJAVEHUYYhPe8PgD1XC.ipa`

## Required Pass/Fail Evidence

Use this file as the release sign-off record. Fill every row with Pass, Fail,
or Blocked plus short evidence. Do not submit the app version for App Store
Review while any required row is Fail or Blocked.

| Area | Required check | Status | Evidence |
| --- | --- | --- | --- |
| Apple processing | Build #76 appears in App Store Connect/TestFlight and is installable | Pending | |
| Install | Install release build from TestFlight on iPhone | Pending | |
| Cold launch | App opens from cold start without crash | Pending | |
| Auth/onboarding | Production auth/onboarding path lets a new tester reach Home | Pending | |
| Product Search browse | All browse loads and shows release catalog copy | Pending | |
| Product Search category | Vitamins does not imply the full catalog only has category-count rows | Pending | |
| Product Search exact | Exact product or brand-product query returns relevant tiered rows | Pending | |
| Product Search pagination | Load more continues without duplicates or stuck loading footer | Pending | |
| Product detail | Database result opens the analysis/result experience without onboarding overlay leakage | Pending | |
| Scan first use | First barcode scan reaches result without crash | Pending | |
| Scan limit gate | Second normal scan attempt shows official paywall for free user | Pending | |
| Search gate | Product Search paywall appears for free user when gate is expected | Pending | |
| Saved limit gate | Second saved supplement attempt shows official paywall | Pending | |
| Monthly purchase | Monthly sandbox purchase succeeds | Pending | |
| Annual purchase | Annual sandbox purchase succeeds | Pending | |
| RevenueCat entitlement | RevenueCat returns active `pro` entitlement after purchase | Pending | |
| App premium state | App observes `isPremium=true` after purchase | Pending | |
| Post-purchase success | Purchase routes through source-specific success screen | Pending | |
| Resume action | CTA returns to the action that triggered paywall | Pending | |
| Restore purchase | Restore succeeds and routes through post-purchase success screen | Pending | |
| Relaunch entitlement | Kill/relaunch keeps Pro entitlement and app access | Pending | |

## RevenueCat Evidence

- Monthly product ID tested:
- Annual product ID tested:
- Entitlement ID observed:
- Customer/user ID:
- RevenueCat dashboard link or screenshot:

## App Store Review Readiness Decision

- Ready to submit for review: No
- Sign-off owner:
- Notes:
