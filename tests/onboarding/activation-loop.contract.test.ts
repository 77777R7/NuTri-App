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
const analysisDashboardSource = readFileSync(
  new URL('../../components/scan/AnalysisDashboard.tsx', import.meta.url),
  'utf8',
);
const topSectionSource = readFileSync(
  new URL('../../components/scan/AnalysisTopSectionRedesign.tsx', import.meta.url),
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

test('scan result emits result-ready and one save-to-stack activation action', () => {
  assert.match(scanResultSource, /trackOnboardingEvent\('result_ready'/);
  assert.match(scanResultSource, /dashboardCoreReady/);
  assert.match(scanResultSource, /allowsFirstScanRevealForCurrentScan\s*=\s*onbCompleted\s*\|\|\s*isOnboardingFirstScan/);
  assert.match(scanResultSource, /testID="scan-result-save-to-stack-action"/);
  assert.match(scanResultSource, />Save to my stack</);
  assert.match(scanResultSource, /topAccessory=\{activationActionNode\}/);
  assert.match(analysisDashboardSource, /topAccessory\?: React\.ReactNode/);
  assert.match(analysisDashboardSource, /\{topAccessory\}\s*\n\s*\{!disableHeroHeader/);
  assert.match(scanResultSource, /trackOnboardingEvent\('saved_to_stack'/);
  assert.match(scanResultSource, /trackOnboardingEvent\('check_in_started'/);
  assert.match(scanResultSource, /source:\s*'scan_result_primary_action'/);
});

test('personalized-insights coach dismissal stays in the activation funnel', () => {
  assert.match(topSectionSource, /trackOnboardingEvent\("coach_dismissed"/);
  assert.match(topSectionSource, /surface:\s*"scan_result_personalized_insights"/);
});

test('home empty state catches the first scan and return milestones are instrumented', () => {
  assert.match(homeSource, /hasRecentScanWaitingToSave/);
  assert.match(homeSource, /Save \$\{latestScanName\} to start tracking/);
  assert.match(i18nSource, /checkInEmptyTitle:\s*'Save your first scan'/);
  assert.match(homeSource, /trackOnboardingEvent\('saved_to_stack'/);
  assert.match(homeSource, /trackOnboardingEvent\('check_in_started'/);
  assert.match(homeSource, /hasActivationFollowUp/);
  assert.match(homeSource, /trackOnboardingReturnMilestones/);
  assert.match(onboardingReturnSource, /event:\s*'d1_return'/);
  assert.match(onboardingReturnSource, /event:\s*'d7_return'/);
});

test('guest scan claim remains a separately contracted scope from activation handoff', () => {
  assert.match(guestScanContractSource, /Guest Scan Claim Contract/);
  assert.match(guestScanContractSource, /implementation PR may touch the required client\/backend surfaces/);
  assert.match(guestScanContractSource, /Do not change the compact logged-in onboarding flow/);
});
