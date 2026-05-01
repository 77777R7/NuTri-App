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
- TestFlight/App Store Connect submit: `BLOCKED`
- Production 30-barcode route QA: `PASS`
- Internal same-commit iPhone install: `PASS`
- Internal same-commit iPhone 30 deep-link launch smoke: `PASS`
- Physical camera 30-scan automation: `NOT AUTOMATABLE BY CLI`

The remaining blocker is not scan-result runtime quality. It is the App Store Connect upload step through EAS Submit.

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

TestFlight distribution is currently `NO_GO_UNTIL_SUBMIT_RESOLVED` because the production build exists but has not successfully uploaded to App Store Connect through EAS Submit.

## Next Required Action

Resolve the App Store Connect submit step using one of these safe paths:

1. Retry EAS Submit after checking Expo/EAS service status or from the Expo web dashboard submission page.
2. Upload the production IPA with Apple Transporter using an App Store Connect key handled outside Codex.
3. Explicitly authorize a local short-lived private-key handling flow, then use `xcrun altool` from `/private/tmp` and immediately delete the key material.

Do not start new AI-quality or scan-redesign work to unblock this release. The remaining blocker is distribution, not scan-result content.
