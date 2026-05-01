# NuTri Release Candidate Checklist

Release branch: `release/rc-1`
Release target: TestFlight / controlled soft launch
Created: 2026-04-30
Final RC evidence refresh: 2026-05-01

## 1. Release Freeze Scope

The release lane is now frozen for launch readiness work only.

Allowed before RC approval:

- P0 crash fixes.
- P0 blank, unavailable, undefined, null, or `[object Object]` user-visible fixes.
- Login, onboarding, subscription, or scan-result blockers.
- Production configuration mistakes.
- App Store review blockers.
- Monitoring or rollback wiring needed to safely release.

Not allowed in this release lane:

- Expo camera upgrade.
- Express 5 migration.
- Barcode scan frontend redesign.
- Scan result layout redesign.
- New family expansion.
- Premium Scientific Background rewrite work.
- P3 copy polish.
- Broad API pass-rate chasing beyond verified release blockers.

## 2. Current Release Evidence

Release ops documents:

- TestFlight runbook: `docs/releases/TESTFLIGHT_RELEASE_RUNBOOK_20260501.md`
- 30-barcode device QA sheet: `docs/releases/RC_30_BARCODE_DEVICE_QA_20260501.md`

Release branch / app build target:

- Release branch HEAD confirmed: `e77ee51731d1b971521e7ff986ce88905d8abfd9`
- Commit message: `Fix release scan result simulator blockers`
- Remote branch confirmed: `origin/release/rc-1` points to `e77ee51731d1b971521e7ff986ce88905d8abfd9`
- Scope of `e77ee517`: mobile scan-result release blocker fix, not a backend deploy change.

Backend/Render target:

- Render URL: `https://nutri-app-qn0u.onrender.com`
- Current live backend deploy commit observed: `2aeae83aca8535a74b512610c5f4a5d68266da1f`
- Current live backend deploy id observed: `dep-d7p6oi448j3c73ad5ckg`
- Render deploy status observed: `live`
- Note: backend staying on `2aeae83a` is expected because `e77ee517` does not change backend runtime code.
- Health check after deploy: `200 OK`

Scan Result MVP evidence:

- Report: `output/scan-result-full-corpus-audit/scan-result-rc-cached-720-post-io-final-20260428/MVP_CLOSURE_VERDICT.md`
- Status: `PASS_CACHED_FIRST_SCAN_RESULT_MVP`
- Sample size: 720 products
- Families covered: 117
- Visible unavailable: 0
- AI P0/P1: 0
- Unsafe/overclaim previews: 0
- Placeholder/null previews: 0

Core scan evidence:

- Full corpus closure report: `output/scan-result-full-corpus-audit/scan-result-full-corpus-core-closure-20260426/core-contract-summary.md`
- Total: 32,581
- Pass: 32,579
- Fail: 2 terminal-state rows
- Score available rate: 99.6%
- Core cards available rate: 100%
- rev1 p95: 547ms
- done p95: 547ms

Scientific Background quality-wave evidence:

- Botanical gate repair report: `output/scan-result-full-corpus-audit/scan-result-quality-wave-kickoff-20260428/SCIENTIFIC_BOTANICAL_GATE_REPAIR_REPORT.md`
- Label-context fallback report: `output/scan-result-full-corpus-audit/scan-result-quality-wave-kickoff-20260428/SCIENTIFIC_LABEL_CONTEXT_FALLBACK_CLASSIFICATION_REPORT.md`
- Focused safety-sensitive botanical replay: 9/9 API after repair
- 45-product Scientific Background warm replay: 42/45 API, 3/45 deterministic label-context fallback by design
- quality_gate_rejected: 0
- parse_failed: 0
- timeout: 0
- P0/P1: 0

30-barcode Render route QA evidence:

- Report: `output/scan-result-full-corpus-audit/rc-device-qa-30-render-20260430/RC_DEVICE_QA_REPORT.md`
- Core pass: 30/30
- HTTP 5xx: 0
- client_timeout: 0
- terminal DONE: 30/30
- product identity: 30/30
- core cards: 30/30
- score available: 29/30
- AI unavailable: 0/30
- AI P0/P1: 0
- Note: this is route-level QA against the Render target, not a substitute for a strict 30-product real-device manual pass.

Simulator / real-device release evidence:

- Simulator preflight screenshot: `output/scan-result-full-corpus-audit/rc-device-qa-30-render-20260430/simulator-preflight-release-fixed-r5/preflight.png`
- Simulator blocker check: `popupBlocked=false`, `popupSignals=[]`
- Real-device/TestFlight barcode scan: user-confirmed passed on 2026-05-01.
- Note: detailed permission-denial, background/foreground, purchase, and App Store metadata checks remain manual release-ops items unless separately confirmed.

## 3. RC Must-Pass Device QA

Run on a real iPhone build, not only Expo Go.

Fresh install and account flow:

- [ ] Fresh install opens without crash.
- [ ] Login works.
- [ ] Signup works, if enabled for this release.
- [ ] Token/session persists after app restart.
- [ ] Logout works, if exposed.
- [ ] Onboarding can be completed.
- [ ] Existing user path skips onboarding when appropriate.

Camera and scan flow:

- [ ] Camera permission prompt appears with acceptable wording.
- [ ] Denying camera permission does not crash.
- [x] Granting camera permission enables barcode scan.
- [x] Barcode scan navigates to result page.
- [x] Result page does not crash after scan.
- [ ] Re-scanning a second product works.
- [ ] App background/foreground during scan does not crash.

Scan result first view:

- [x] Product identity is visible.
- [x] NuTri Score or limited-data state is visible.
- [x] Core decision cards are visible.
- [x] No blank first screen.
- [x] No visible `unavailable` for supported sections.
- [x] No visible `undefined`, `null`, or `[object Object]`.
- [ ] Main score and mini score agree.

Deep Dive sections:

- [x] Product Overview renders.
- [x] Ingredient / Formula Overview renders.
- [x] Scientific Background / Research Snapshot renders.
- [x] Suggested Use / Practical Usage renders or clearly explains missing label directions.
- [x] Warnings / Safety renders or clearly explains missing label warnings.
- [ ] Expanding/collapsing Deep Dive does not break layout.
- [x] Slow sidecars use safe fallback and never block core result visibility.

Safety/content checks:

- [x] No disease treatment/prevention/cure promise in visible AI sections.
- [x] No medication replacement claim.
- [x] No guaranteed outcome claim.
- [x] High-risk families show bounded language.
- [x] Label context and research context are not obviously contradictory.

Subscription/paywall, if enabled:

- [ ] Paywall opens.
- [ ] Restore purchase works.
- [ ] Purchase flow works in sandbox.
- [ ] User can recover from failed purchase.
- [ ] No scan result dead end behind paywall unless intentionally designed.

## 4. Required Barcode QA Pack

Minimum 30 real-device scans before RC approval.

Status: 30-product Render route QA passed. One real-device/TestFlight barcode scan was user-confirmed passed on 2026-05-01. If the release owner requires the strictest reading of this section, the manual 30-product real-device pass remains the only not-yet-completed scan QA item.

Core/common families:

- [ ] omega-3
- [ ] magnesium
- [ ] iron
- [ ] vitamin C
- [ ] vitamin D
- [ ] calcium
- [ ] zinc
- [ ] B12 / B-complex
- [ ] probiotic
- [ ] collagen
- [ ] creatine
- [ ] protein
- [ ] fiber
- [ ] electrolyte hydration

Safety-sensitive or recently fixed families:

- [ ] milk thistle
- [ ] red yeast rice
- [ ] schisandra
- [ ] ashwagandha
- [ ] turmeric / curcumin
- [ ] berberine
- [ ] NAC
- [ ] green tea extract

Edge cases:

- [ ] proprietary blend
- [ ] total omega-3 line
- [ ] B-complex line
- [ ] food-like product
- [ ] topical/external or ambiguous product
- [ ] barcode not found

## 5. Release Monitoring Gate

Must be observable before soft launch:

- [x] Render `/health`.
- [x] `/api/enrich-stream` 5xx rate.
- [x] `/api/enrich-stream` timeout/client abort rate.
- [x] stream terminal state distribution.
- [x] score available rate.
- [x] visible unavailable counter or audit equivalent.
- [x] sidecar fallback reason distribution.
- [x] DeepSeek timeout / parse_failed / quality_gate_rejected buckets.
- [ ] app crash-free sessions.
- [ ] login/signup error rate.
- [ ] barcode not found / product not found rate.

Launch red lines:

- Server 5xx above 1% sustained: pause rollout.
- Any confirmed blank scan result: hotfix before expanding rollout.
- Any confirmed visible `undefined`, `null`, or `[object Object]`: hotfix before expanding rollout.
- Crash-free sessions below 99%: pause rollout.
- Visible unavailable above 0.5%: investigate before expanding rollout.
- Payment or login blocker: block release.

## 6. RC Approval Decision

Approve RC only when:

- [x] Real-device QA passes with zero P0 issues.
- [ ] 30-barcode QA pack has no scan-result crash or blank result.
- [x] Production/Render health is green.
- [x] Monitoring dashboard/runbook is ready.
- [ ] App Store metadata/privacy/subscription requirements are ready.
- [x] No unrelated migration or redesign is included.

Release decision labels:

- `GO`: ready for TestFlight or controlled soft launch.
- `GO_WITH_WATCH`: acceptable small known issues, monitoring required.
- `NO_GO`: P0/P1 blocker remains.

Current RC decision: `GO_WITH_WATCH` for scan-result release readiness. The 30-product Render route QA has no scan-result crash or blank result, but the strict 30-product real-device manual pass remains unchecked unless the release owner accepts route QA plus the user-confirmed real-device smoke as sufficient. Full public launch still depends on release-ops confirmation for App Store metadata/privacy/subscription items.

## 7. Post-Launch Quality Wave Parking Lot

Do after RC, not before:

- API pass-rate improvement beyond release-critical paths.
- Premium Scientific Background writing.
- More reviewed evidence grounding.
- P3 copy polish.
- Additional family expansion.
- Content-value scorer improvements.
- Larger full live-AI stratified audits.
- Onboarding conversion experiments.
- Paywall/pricing experiments.
