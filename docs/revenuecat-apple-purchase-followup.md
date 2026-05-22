# RevenueCat / Apple Purchase Follow-Up

Created: 2026-05-13

## Current State

- App Store Connect bundle ID: `com.nutri-Nige.app`
- App Store Connect app ID: `6759846833`
- App Store Connect subscription products exist:
  - `nutri_pro_monthly`
  - `nutri_pro_yearly`
- RevenueCat app exists for `NuTri (App Store)`.
- RevenueCat Offering: `default`
- RevenueCat packages:
  - Monthly: `$rc_monthly`, includes `nutri_pro_monthly`
  - Annual: `$rc_annual`, includes `nutri_pro_yearly`
- RevenueCat entitlement displays as `Pro`; app config uses `pro`.
- Client entitlement lookup is intentionally case-insensitive so `pro` config can match RevenueCat `Pro`.
- RevenueCat public iOS SDK key is configured in:
  - `.env.local`
  - `eas.json` build profiles: `development`, `preview`, `preview_noauth`, `production`

## Verified Locally

Commands already run successfully:

```bash
node -e "JSON.parse(require('fs').readFileSync('eas.json','utf8'))"
node --import tsx --test tests/pro/app-store-readiness-contract.test.ts
npx eas-cli config --profile production --platform ios --json --non-interactive
npx eas-cli config --profile development --platform ios --json --non-interactive
```

Confirmed by EAS config output:

- Production iOS build includes:
  - `EXPO_PUBLIC_REVENUECAT_IOS_API_KEY`
  - `EXPO_PUBLIC_REVENUECAT_ENTITLEMENT_ID=pro`
- Development iOS build includes:
  - `EXPO_PUBLIC_REVENUECAT_IOS_API_KEY`
  - `EXPO_PUBLIC_REVENUECAT_ENTITLEMENT_ID=pro`

## Remaining Blockers

1. Apple Paid Apps Agreement / subscription availability must be fully active.
2. The first subscription usually must be submitted together with a new app version.
3. Real purchase smoke requires an iOS dev build or TestFlight build plus a sandbox Apple account.

## Next Execution Plan

1. Confirm App Store Connect status:
   - Paid Apps Agreement active.
   - Subscription group/products ready to submit.
   - `nutri_pro_monthly` and `nutri_pro_yearly` are attached to the app version if required.

2. Build iOS test artifact:

```bash
npx eas-cli build -p ios --profile development
```

or for TestFlight:

```bash
npx eas-cli build -p ios --profile production
```

3. Run sandbox purchase smoke:
   - Open paywall.
   - Tap monthly purchase.
   - Confirm Apple sandbox sheet appears.
   - Complete sandbox purchase.
   - Confirm RevenueCat returns active entitlement.
   - Confirm app sees `isPremium=true`.
   - Confirm post-purchase success page appears.
   - Confirm CTA returns to original blocked action.

4. Run annual package smoke:
   - Repeat purchase flow for annual, or at minimum verify annual package loads from RevenueCat offering.

5. Run restore smoke:
   - Start from a clean install or logged-out/restored state.
   - Tap restore purchase.
   - Confirm RevenueCat returns active entitlement.
   - Confirm restore success enters post-purchase success page.
   - Confirm app sees `isPremium=true`.

6. Final App Store review readiness:
   - Confirm paywall copy only sells currently gated features.
   - Confirm screenshot/review notes are attached to App Store subscription review.
   - Submit new app version with first subscription.

## Do Not Forget

- Do not replace the RevenueCat public SDK key with a secret API key.
- Do not change the `pro` app config unless RevenueCat entitlement handling changes.
- Do not submit App Store review until sandbox purchase and restore have both been verified.
