import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const onboardingAnalyticsSource = readFileSync(
  new URL('../../lib/analytics/onboarding.ts', import.meta.url),
  'utf8',
);
const onboardingReturnSource = readFileSync(
  new URL('../../lib/analytics/onboarding-return.ts', import.meta.url),
  'utf8',
);
const scanResultSource = readFileSync(
  new URL('../../app/scan/result.tsx', import.meta.url),
  'utf8',
);
const barcodeSource = readFileSync(
  new URL('../../app/scan/barcode.tsx', import.meta.url),
  'utf8',
);
const onboardingRegistrySource = readFileSync(
  new URL('../../components/onboarding/flow/OnboardingSceneRegistry.tsx', import.meta.url),
  'utf8',
);
const dataTrustSource = readFileSync(
  new URL('../../app/onboarding/data-trust.tsx', import.meta.url),
  'utf8',
);
const analysisDashboardSource = readFileSync(
  new URL('../../components/scan/AnalysisDashboard.tsx', import.meta.url),
  'utf8',
);
const topSectionSource = readFileSync(
  new URL('../../components/scan/AnalysisTopSectionRedesign.tsx', import.meta.url),
  'utf8',
);
const headerChromeSource = readFileSync(
  new URL('../../components/scan/ScanResultHeaderChrome.tsx', import.meta.url),
  'utf8',
);
const homeSource = readFileSync(
  new URL('../../app/main/Home-Page.tsx', import.meta.url),
  'utf8',
);
const goalsSource = readFileSync(
  new URL('../../app/onboarding/goals.tsx', import.meta.url),
  'utf8',
);
const allergySource = readFileSync(
  new URL('../../app/onboarding/allergy.tsx', import.meta.url),
  'utf8',
);
const i18nSource = readFileSync(
  new URL('../../lib/i18n.ts', import.meta.url),
  'utf8',
);
const guestScanContractSource = readFileSync(
  new URL('../../docs/superpowers/specs/2026-05-05-guest-scan-claim-contract.md', import.meta.url),
  'utf8',
);

test('activation is defined as result ready plus a follow-up action', () => {
  assert.match(onboardingAnalyticsSource, /first_scan_result_plus_follow_up_v1/);
  assert.match(onboardingAnalyticsSource, /resultEvent:\s*'result_ready'/);
  assert.match(onboardingAnalyticsSource, /followUpEvents:\s*\['saved_to_stack', 'check_in_started'\]/);

  for (const event of [
    'onboarding_started',
    'goals_completed',
    'allergy_completed',
    'allergy_skipped',
    'first_scan_started',
    'result_ready',
    'post_scan_continue_tapped',
    'coach_dismissed',
    'saved_to_stack',
    'check_in_started',
    'd1_return',
    'd7_return',
  ]) {
    assert.match(onboardingAnalyticsSource, new RegExp(`'${event}'`));
  }
});

test('goals and allergy steps emit funnel completion events', () => {
  assert.match(goalsSource, /trackOnboardingEvent\('goals_completed'/);
  assert.match(goalsSource, /source:\s*'onboarding_goals'/);
  assert.match(allergySource, /trackOnboardingEvent\(skipped \? 'allergy_skipped' : 'allergy_completed'/);
  assert.match(allergySource, /source:\s*'onboarding_allergy'/);
  assert.match(allergySource, /onSkip=\{\(\) => persist\(true\)\}/);
});

test('scan result emits result-ready and keeps save in the header without a duplicate banner', () => {
  assert.match(scanResultSource, /trackOnboardingEvent\('result_ready'/);
  assert.match(scanResultSource, /dashboardCoreReady/);
  assert.match(scanResultSource, /allowsFirstScanRevealForCurrentScan\s*=\s*onbCompleted\s*\|\|\s*isOnboardingFirstScan/);
  assert.doesNotMatch(scanResultSource, /testID="scan-result-save-to-stack-action"/);
  assert.doesNotMatch(scanResultSource, />Save to my stack</);
  assert.doesNotMatch(scanResultSource, /activationActionNode/);
  assert.match(scanResultSource, /savePillState=\{\s*shouldShowGuestClaimPrompt/);
  assert.match(scanResultSource, /onSavePress=\{shouldShowGuestClaimPrompt \? handleKeepGuestResult : handleSaveFromDashboard\}/);
  assert.match(scanResultSource, /onboarding_save_supplement_guide_seen/);
  assert.match(scanResultSource, /testID="onboarding-save-coach-overlay"/);
  assert.match(scanResultSource, /Tap Save in the top right/);
  assert.match(scanResultSource, /shouldHoldPersonalizedGuideForSaveGuide/);
  assert.match(scanResultSource, /shouldHoldPersonalizedGuideForSaveGuide\s*\?\s*'hidden'/);
  assert.match(topSectionSource, /personalizationCoachMode\?: "applied" \| "hidden" \| null/);
  assert.match(topSectionSource, /!isCoachHidden &&/);
  assert.match(analysisDashboardSource, /topAccessory\?: React\.ReactNode/);
  assert.match(analysisDashboardSource, /\{topAccessory\}\s*\n\s*\{!disableHeroHeader/);
  assert.match(scanResultSource, /trackOnboardingEvent\('saved_to_stack'/);
  assert.match(scanResultSource, /trackOnboardingEvent\('check_in_started'/);
  assert.match(scanResultSource, /source:\s*'scan_result_primary_action'/);
});

test('onboarding scan result uses explicit first-result and post-QA exits instead of back-to-paywall', () => {
  assert.match(scanResultSource, /type OnboardingResultPhase = 'normal' \| 'before_qa' \| 'after_qa'/);
  assert.match(scanResultSource, /const onboardingResultPhase: OnboardingResultPhase =/);
  assert.match(scanResultSource, /params\.personalizedGuide === PERSONALIZED_GUIDE_APPLIED\s*\?\s*'after_qa'/);
  assert.match(scanResultSource, /isOnboardingFirstScan\s*\?\s*'before_qa'/);
  assert.match(scanResultSource, /const handleOnboardingDone = useCallback/);
  assert.match(scanResultSource, /router\.replace\('\/gate'\)/);
  assert.match(scanResultSource, /if \(onboardingResultPhase !== 'normal'\) \{/);
  assert.match(scanResultSource, /BackHandler\.addEventListener\('hardwareBackPress'/);
  assert.match(scanResultSource, /onboardingResultPhase === 'normal'/);
  assert.match(scanResultSource, /onboardingResultPhase === 'before_qa'\s*&&\s*dashboardCoreReady/);
  assert.match(scanResultSource, /onboardingResultPhase === 'before_qa'\s*&&\s*!onboardingSaveGuideCompleted/);
  assert.match(scanResultSource, /post_scan_done_guide_seen/);
  assert.match(scanResultSource, /testID="onboarding-done-coach-overlay"/);
  assert.match(scanResultSource, /testID="onboarding-done-coach-target"/);
  assert.match(scanResultSource, /Tap Done to keep this result and set up your account\./);
  assert.match(scanResultSource, /leadingAction=\{onboardingResultPhase === 'after_qa' \? 'done' : onboardingResultPhase === 'before_qa' \? 'none' : 'back'\}/);
  assert.match(scanResultSource, /onDonePress=\{handleOnboardingDone\}/);
  assert.match(headerChromeSource, /leadingAction\?: 'back' \| 'none' \| 'done'/);
  assert.match(headerChromeSource, /onDonePress\?: \(\) => void/);
  assert.match(headerChromeSource, /leadingAction === 'none'/);
  assert.match(headerChromeSource, /leadingAction === 'done'/);
  assert.match(headerChromeSource, />Done<\/Text>/);
});

test('canonical scan-first onboarding journey stays locked', () => {
  assert.match(
    onboardingRegistrySource,
    /export const ONBOARDING_FLOW_STEPS = \[\s*'welcome',\s*'problem',\s*'solution',\s*'data-trust',\s*'goals',\s*'allergy',\s*\] as const;/,
  );
  assert.match(onboardingRegistrySource, /goToStep\('problem', 'forward'\)/);
  assert.match(onboardingRegistrySource, /goToStep\('solution', 'forward'\)/);
  assert.match(onboardingRegistrySource, /exitTo\('\/scan\/barcode\?source=onboarding', 'forward'\)/);
  assert.doesNotMatch(onboardingRegistrySource, /goToStep\('plan-preview', 'forward'\)/);
  assert.doesNotMatch(onboardingRegistrySource, /goToStep\('first-stack', 'forward'\)/);

  assert.match(scanResultSource, /pathname:\s*'\/onboarding\/data-trust'/);
  assert.match(scanResultSource, /mode:\s*POST_SCAN_MODE/);
  assert.match(scanResultSource, /returnTo,\s*\n\s*\}/);
  assert.match(dataTrustSource, /pathname:\s*'\/onboarding\/goals'/);
  assert.match(goalsSource, /pathname:\s*'\/onboarding\/allergy'/);
  assert.match(allergySource, /continueLabel=\{isPostScan \? 'Show my result' : isProfileEdit \? 'Save answers' : 'Continue'\}/);
  assert.match(allergySource, /skipLabel=\{isPostScan \? 'Skip and show my result' : isProfileEdit \? 'Keep current answers' : undefined\}/);
  assert.match(allergySource, /appendPersonalizedGuideApplied\(safeReturnTo\)/);
  assert.match(scanResultSource, /params\.personalizedGuide === PERSONALIZED_GUIDE_APPLIED/);
  assert.match(scanResultSource, /router\.replace\('\/gate'\)/);
});

test('onboarding barcode scan removes the cancel escape while normal scan keeps it', () => {
  assert.match(barcodeSource, /const isOnboardingScan = params\.source === 'onboarding'/);
  assert.match(barcodeSource, /const shouldShowCloseButton = !isOnboardingScan/);
  assert.match(barcodeSource, /shouldShowCloseButton \? \(/);
  assert.match(barcodeSource, /safeBack\(navigation, \{ fallback: backFallback \}\)/);
  assert.match(barcodeSource, /styles\.iconButtonPlaceholder/);
});

test('personalized-insights coach dismissal stays in the activation funnel', () => {
  assert.match(topSectionSource, /trackOnboardingEvent\("coach_dismissed"/);
  assert.match(topSectionSource, /surface:\s*"scan_result_personalized_insights"/);
});

test('home empty state catches the first scan and return milestones are instrumented', () => {
  assert.match(homeSource, /hasRecentScanWaitingToSave/);
  assert.match(homeSource, /Start daily tracking/);
  assert.match(homeSource, /Save this scan to your stack\. It will appear here for Daily Check-in\./);
  assert.match(i18nSource, /checkInEmptyTitle:\s*'Save your first scan'/);
  assert.match(homeSource, /trackOnboardingEvent\('saved_to_stack'/);
  assert.match(homeSource, /trackOnboardingEvent\('check_in_started'/);
  assert.match(homeSource, /hasActivationFollowUp/);
  assert.match(homeSource, /trackOnboardingReturnMilestones/);
  assert.match(homeSource, /HOME_FIRST_SCAN_GUIDE_SEEN_PREFIX/);
  assert.match(homeSource, /home_first_scan_handoff_guide_seen/);
  assert.match(homeSource, /testID="home-first-scan-guide-overlay"/);
  assert.match(homeSource, /testID="home-first-scan-guide-target"/);
  assert.match(homeSource, /Start from here\./);
  assert.match(homeSource, /Save your scan to turn it into daily tracking\./);
  assert.match(homeSource, /onbCompleted &&/);
  assert.match(homeSource, /selectedDateKey === todayDateKey/);
  assert.match(onboardingReturnSource, /event:\s*'d1_return'/);
  assert.match(onboardingReturnSource, /event:\s*'d7_return'/);
});

test('guest scan claim remains a separately contracted scope from activation handoff', () => {
  assert.match(guestScanContractSource, /Guest Scan Claim Contract/);
  assert.match(guestScanContractSource, /implementation PR may touch the required client\/backend surfaces/);
  assert.match(guestScanContractSource, /Do not change the compact logged-in onboarding flow/);
});
