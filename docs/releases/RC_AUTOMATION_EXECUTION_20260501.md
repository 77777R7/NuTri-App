# RC Automation Execution - 2026-05-01

Release branch: `release/rc-1`
Release branch HEAD during execution: `4ea14f53 Add TestFlight release runbook`
Required app-code ancestor: `e77ee517 Fix release scan result simulator blockers`
Render target: `https://nutri-app-qn0u.onrender.com`
Device: `Howard's iPhone (2)`, iPhone 13 Pro, iOS 18.7.8
Device identifiers observed: CoreDevice `175ED72E-1ECC-5607-BAFF-02EE2EA6AF70`, USB UDID `00008110-000A79263A0B801E`

## Summary

Automated release execution is partially complete.

- Production/TestFlight build: `FINISHED`
- TestFlight/App Store Connect submit: `BLOCKED_BY_APPLE_AGREEMENT`
- Production 30-barcode route QA: `PASS`
- Internal same-commit iPhone install: `PASS`
- Internal same-commit iPhone 30 deep-link launch smoke: `PASS`
- Physical camera 30-scan automation: `NOT AUTOMATABLE BY CLI`

The remaining blocker is not scan-result runtime quality. It is an App Store Connect account agreement gate that blocks both EAS Submit and direct `altool` upload.

## Production Build

- Build id: `cf710dea-0940-492e-a7fb-a6908a962234`
- Profile: `production`
- Distribution: `STORE`
- App version: `1.0.0`
- Build number: `73`
- Commit: `4ea14f538d60e66794334b70cd9a3a179e8c4350`
- Status: `FINISHED`
- Artifact: `https://expo.dev/artifacts/eas/rBHtbcWEiJrkx4m7q9bpMW.ipa`
- Build logs: `https://expo.dev/accounts/nutri000/projects/nutri-app/builds/cf710dea-0940-492e-a7fb-a6908a962234`

Production EAS environment was confirmed to include:

- `EXPO_PUBLIC_API_BASE_URL=https://nutri-app-qn0u.onrender.com`
- `EXPO_PUBLIC_SEARCH_API_BASE_URL=https://nutri-app-qn0u.onrender.com`
- `EXPO_PUBLIC_DISABLE_AUTH=1`
- `EXPO_PUBLIC_SUPABASE_URL`
- `EXPO_PUBLIC_SUPABASE_ANON_KEY`

## TestFlight Submit Attempts

Initial `eas build --auto-submit --what-to-test ...` created the production build but failed to schedule submission because EAS reported that changelog / `what-to-test` submission requires an Enterprise plan.

Follow-up submissions without changelog:

- Submission id: `15cd6b05-3e79-4c01-8439-5b3c3690b9d4`, status `ERRORED`
- Submission id: `02a47b68-4e0e-4840-a200-b412f052a614`, status `ERRORED`
- Submission id: `29ef09d5-39ab-48bc-9402-4b90e9b80097`, status `ERRORED`

EAS GraphQL returned `error=null` and `logFiles=[]` for all three errored submissions, so the CLI did not expose a concrete Apple-side failure reason.

App Store Connect API key metadata checked:

- Key id: `P683UA7THK`
- Key name: `[Expo] EAS Submit IZgR-9GHN8`
- Apple team: `K8L86F2X5X`
- Role: `ADMIN`

Direct local `altool` upload was not performed because it would require exporting the App Store Connect private API key from EAS to a local file. That is intentionally not done without explicit secret-handling approval.

After explicit approval, a short-lived local `altool` upload attempt was performed from `/private/tmp` using the existing App Store Connect API key metadata above.

Result:

- Upload command: `xcrun altool --upload-app`
- IPA: production build `73`
- Status: `BLOCKED`
- Apple API status: `403`
- Apple error code: `FORBIDDEN.REQUIRED_AGREEMENTS_MISSING_OR_EXPIRED`
- Apple error title: `A required agreement is missing or has expired.`
- Apple detail: `This request requires an in-effect agreement that has not been signed or has expired.`

Interpretation:

The production IPA is available and local upload reached Apple's App Store Connect APIs, but Apple refused the request before app upload because the account has a required agreement missing or expired. This is not an EAS-only issue and should be resolved in App Store Connect / Apple Business agreements before retrying submission.

Secret handling:

- The App Store Connect private key was written only to `/private/tmp/nutri-asc-private-keys/AuthKey_P683UA7THK.p8`.
- The key directory was removed immediately after the failed upload attempt.
- Deletion was verified locally: `/private/tmp/nutri-asc-private-keys` no longer exists.

## Free-Only Submit Verification - 2026-05-02

Follow-up check requested whether this could be bypassed by treating the release as free-only rather than paid/subscription-enabled.

Engineering/config result:

- The clean `release/rc-1` worktree does not configure RevenueCat in `app.config.ts`.
- Production EAS environment does not include `EXPO_PUBLIC_REVENUECAT_*` keys.
- iOS entitlements only include Sign in with Apple; no StoreKit / IAP entitlement is present in the release branch.
- Existing production build `73` is therefore not blocked by a binary-level paid/subscription configuration.

Free-only submission retry:

- Submission id: `43760736-f964-4a94-a160-9b33c6dc6902`
- Build id: `cf710dea-0940-492e-a7fb-a6908a962234`
- EAS result: `ERRORED`
- EAS error details: `error=null`, `logFiles=[]`

Direct Apple verification retry:

- IPA: existing production build `73`
- Method: temporary-key `xcrun altool --upload-app`
- Apple API status: `403`
- Apple error code: `FORBIDDEN.REQUIRED_AGREEMENTS_MISSING_OR_EXPIRED`
- Apple detail: `This request requires an in-effect agreement that has not been signed or has expired.`
- Local key directory: `/private/tmp/nutri-asc-private-keys-free-only-check`
- Key deletion verified: directory no longer exists after the retry

Conclusion:

The TestFlight blocker is not caused by the current app binary requiring Paid App Agreement or RevenueCat. Apple blocks the account before upload at the App Store Connect agreement gate. This is a non-engineering blocker until the required Apple agreement / business setup is completed in App Store Connect.

## Production Route QA

Output directory:

- `output/rc-device-automation-20260501/`

Automated route result:

- Total: 30
- Pass: 30
- Fail: 0
- HTTP 5xx: 0
- Client timeout: 0
- Terminal DONE: 30/30
- Score available: 30/30
- Core cards available: 30/30
- Bad visible text: 0

Generated artifacts:

- `output/rc-device-automation-20260501/ROUTE_QA_SUMMARY.md`
- `output/rc-device-automation-20260501/route-qa-summary.json`
- `output/rc-device-automation-20260501/route-qa-results.jsonl`

## Internal Device QA Build

Because App Store / TestFlight builds cannot be installed directly over USB, a same-commit internal build was created for device automation.

- Build id: `87e30fef-3c90-4bae-a858-49452d1a9e2b`
- Profile: `preview_noauth`
- Distribution: `INTERNAL`
- App version: `1.0.0`
- Build number: `73`
- Commit: `4ea14f538d60e66794334b70cd9a3a179e8c4350`
- Status: `FINISHED`
- Artifact: `https://expo.dev/artifacts/eas/hMeA7KAZr7BwNC1Wgm1t26.ipa`

The Ad Hoc provisioning profile includes the connected iPhone UDID `00008110-000A79263A0B801E`.

USB install result:

- Bundle id: `com.nutri-Nige.app`
- Installed app: `NuTri`
- Version: `1.0.0`
- Bundle version: `73`
- Install status: `PASS`

Initial app launch result:

- Launch status: `PASS`
- Process id observed: `4484`

## Device Deep-Link Launch Smoke

The installed internal build was launched 30 times with:

- `nutri://scan/result?devBarcode=<barcode>`

Result:

- Launch OK: 30/30
- Launch fail: 0/30

Generated artifacts:

- `output/rc-device-automation-20260501/DEVICE_DEEPLINK_LAUNCH_SUMMARY.md`
- `output/rc-device-automation-20260501/device-deeplink-launch-summary.json`
- `output/rc-device-automation-20260501/device-deeplink-launch-results.jsonl`

Important limitation:

This validates the installed app's route launch path on a real iPhone. It does not validate physical camera frame capture for all 30 barcodes because iOS does not allow CLI tools to inject camera frames into the real camera pipeline.

## Direct Production IPA Install Attempt

The production IPA could not be installed directly over USB, which is expected for this distribution path.

Observed error:

- `ApplicationVerificationFailed`
- `Attempted to install a Beta profile without the proper entitlement`

Interpretation:

The production build must be distributed through App Store Connect / TestFlight. The internal Ad Hoc build is the correct path for USB install automation.

## Current Release Decision

Scan-result runtime readiness remains `GO_WITH_WATCH`.

TestFlight distribution is currently `NO_GO_UNTIL_APPLE_AGREEMENT_RESOLVED` because the production build exists, but App Store Connect rejects EAS Submit and direct local `altool` upload until the missing or expired Apple agreement is signed. A free-only retry on 2026-05-02 confirmed this is not caused by the release binary requiring paid/subscription configuration.

## Next Required Action

Resolve the App Store Connect agreement gate first:

1. Sign or renew the required agreement in App Store Connect / Apple Business.
2. Retry submission of existing production build `73`; a new build is not required unless Apple processing later rejects the binary.

Safe retry paths after the agreement is in effect:

1. Retry EAS Submit from CLI or the Expo web dashboard.
2. Upload the production IPA with Apple Transporter.
3. Re-run the short-lived local `xcrun altool` upload flow from `/private/tmp`, then immediately delete the key material again.

Do not start new AI-quality or scan-redesign work to unblock this release. The remaining blocker is distribution, not scan-result content.
