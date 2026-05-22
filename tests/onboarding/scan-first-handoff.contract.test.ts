import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';

const resultSource = readFileSync(new URL('../../app/scan/result.tsx', import.meta.url), 'utf8');
const dataTrustSource = readFileSync(new URL('../../app/onboarding/data-trust.tsx', import.meta.url), 'utf8');
const goalsSource = readFileSync(new URL('../../app/onboarding/goals.tsx', import.meta.url), 'utf8');
const allergySource = readFileSync(new URL('../../app/onboarding/allergy.tsx', import.meta.url), 'utf8');
const dashboardSource = readFileSync(new URL('../../components/scan/AnalysisDashboard.tsx', import.meta.url), 'utf8');
const topSectionSource = readFileSync(new URL('../../components/scan/AnalysisTopSectionRedesign.tsx', import.meta.url), 'utf8');

test('scan result post-scan continue starts the trust goals allergy handoff', () => {
  assert.match(resultSource, /testID="scan-result-post-scan-continue"/);
  assert.match(resultSource, />Continue</);
  assert.match(resultSource, /Next: 2 quick questions for Goal fit and Allergy check\./);
  assert.match(resultSource, /pathname:\s*'\/onboarding\/data-trust'/);
  assert.match(resultSource, /mode:\s*POST_SCAN_MODE/);
  assert.match(resultSource, /buildScanResultReturnTo/);
  assert.match(resultSource, /post_scan_continue_tapped/);
  assert.match(resultSource, /shouldEnablePostScanContinue =\s*\n\s*onboardingResultPhase === 'before_qa' &&/);
  assert.match(resultSource, /shouldShowPostScanContinue = shouldEnablePostScanContinue && postScanContinueVisible/);
  assert.match(resultSource, /POST_SCAN_CONTINUE_HIDE_DISTANCE/);
  assert.match(resultSource, /shouldShowPostScanContinueForMetrics/);
  assert.match(resultSource, /return remainingDistance < threshold/);
  assert.match(resultSource, /onScrollViewportMetricsChange=\{handleDashboardScrollMetricsChange\}/);
  assert.match(resultSource, /shouldUnlockPostScanResult/);
  assert.match(resultSource, /premiumAccess\.isPremium \|\| isFirstRevealActive \|\| isFirstRevealPendingGrant \|\| shouldUnlockPostScanResult/);
  assert.match(dashboardSource, /onScrollViewportMetricsChange\?: \(metrics: AnalysisScrollViewportMetrics\) => void/);
  assert.match(dashboardSource, /runOnJS\(handleScrollMetricsFromWorklet\)/);
});

test('post-scan onboarding routes preserve mode and sanitized returnTo', () => {
  assert.match(dataTrustSource, /isPostScanMode\(params\.mode\)/);
  assert.match(dataTrustSource, /sanitizePostScanReturnTo\(params\.returnTo\)/);
  assert.match(dataTrustSource, /title=\{isPostScan \? 'Continue' : 'Get Started'\}/);
  assert.match(dataTrustSource, /pathname:\s*'\/onboarding\/goals'/);
  assert.match(goalsSource, /isPostScanMode\(params\.mode\)/);
  assert.match(goalsSource, /sanitizePostScanReturnTo\(params\.returnTo\)/);
  assert.match(goalsSource, /pathname:\s*'\/onboarding\/allergy'/);
  assert.match(allergySource, /appendPersonalizedGuideApplied\(safeReturnTo\)/);
  assert.match(allergySource, /continueLabel=\{isPostScan \? 'Show my result' : isProfileEdit \? 'Save answers' : 'Continue'\}/);
  assert.match(allergySource, /skipLabel=\{isPostScan \? 'Skip and show my result' : isProfileEdit \? 'Keep current answers' : undefined\}/);
});

test('post-scan applied guide uses live draft and dismisses once per scan session', () => {
  assert.match(resultSource, /post_scan_personalized_guide_seen:\$\{scanKey\}/);
  assert.match(resultSource, /AsyncStorage\.getItem\(appliedGuideStorageKey\)/);
  assert.match(resultSource, /AsyncStorage\.setItem\(appliedGuideStorageKey, '1'\)/);
  assert.match(resultSource, /personalizedGuideMode=\{\s*\n\s*showAppliedPersonalizedGuide\s*\n\s*\? 'applied'\s*\n\s*: shouldHoldPersonalizedGuideForSaveGuide\s*\n\s*\? 'hidden'\s*\n\s*: null\s*\n\s*\}/);
  assert.match(dashboardSource, /const effectiveOnboardingDraft = onboardingDraft \?\? onboardingDraftOverride/);
  assert.match(topSectionSource, /personalizationCoachMode\?: "applied" \| "hidden" \| null/);
  assert.match(topSectionSource, /Your answers are applied here/);
  assert.match(topSectionSource, /Goal fit/);
  assert.match(topSectionSource, /Allergy check/);
});
