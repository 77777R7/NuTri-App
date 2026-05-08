import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';

const root = process.cwd();
const scanResultSource = readFileSync(path.join(root, 'app/scan/result.tsx'), 'utf8');
const dataTrustSource = readFileSync(path.join(root, 'app/onboarding/data-trust.tsx'), 'utf8');
const goalsSource = readFileSync(path.join(root, 'app/onboarding/goals.tsx'), 'utf8');
const allergySource = readFileSync(path.join(root, 'app/onboarding/allergy.tsx'), 'utf8');

test('scan result sends post-scan Continue through data trust with a local returnTo', () => {
  assert.match(scanResultSource, /buildGuestScanResultReturnTo/);
  assert.match(scanResultSource, /\/scan\/result\?sessionId=/);
  assert.match(scanResultSource, /source=guest_scan/);
  assert.match(scanResultSource, /guestScanSessionId=/);
  assert.match(scanResultSource, /params\.devBarcode/);
  assert.match(scanResultSource, /query\.set\('devBarcode', routeDevBarcode\)/);
  assert.match(scanResultSource, /pathname: '\/onboarding\/data-trust'/);
  assert.match(scanResultSource, /mode: 'post_scan'/);
  assert.match(scanResultSource, /returnTo/);
});

test('data trust post-scan mode carries returnTo to goals before the QA steps', () => {
  assert.match(dataTrustSource, /useLocalSearchParams/);
  assert.match(dataTrustSource, /normalizePostScanReturnTo/);
  assert.match(dataTrustSource, /trimmed\.startsWith\('\/scan\/result\?'\)/);
  assert.match(dataTrustSource, /params\.mode === 'post_scan'/);
  assert.match(dataTrustSource, /pathname: '\/onboarding\/goals'/);
  assert.match(dataTrustSource, /mode: 'post_scan'/);
  assert.match(dataTrustSource, /returnTo: postScanReturnTo/);
});

test('goals post-scan mode carries returnTo to allergy instead of the normal compact flow', () => {
  assert.match(goalsSource, /useLocalSearchParams/);
  assert.match(goalsSource, /normalizePostScanReturnTo/);
  assert.match(goalsSource, /trimmed\.startsWith\('\/scan\/result\?'\)/);
  assert.match(goalsSource, /params\.mode === 'post_scan'/);
  assert.match(goalsSource, /pathname: '\/onboarding\/allergy'/);
  assert.match(goalsSource, /mode: 'post_scan'/);
  assert.match(goalsSource, /returnTo: postScanReturnTo/);
  assert.match(goalsSource, /router\.replace\(postScanReturnTo as never\)/);
});

test('allergy post-scan mode returns to the original scan result after complete or skip', () => {
  assert.match(allergySource, /useLocalSearchParams/);
  assert.match(allergySource, /normalizePostScanReturnTo/);
  assert.match(allergySource, /trackOnboardingEvent\(skipped \? 'allergy_skipped' : 'allergy_completed'/);
  assert.match(allergySource, /router\.replace\(postScanReturnTo as never\)/);
  assert.match(allergySource, /pathname: '\/onboarding\/goals'/);
  assert.match(allergySource, /mode: 'post_scan'/);
  assert.match(allergySource, /returnTo: postScanReturnTo/);
});

test('scan result prefers current onboarding draft over the scan-start snapshot', () => {
  assert.match(scanResultSource, /useOnboarding\(\)/);
  assert.match(scanResultSource, /effectiveDashboardOnboardingDraft = onboardingDraft \?\? session\?\.onboardingDraftSnapshot \?\? null/);
  assert.match(scanResultSource, /onboardingDraftOverride=\{effectiveDashboardOnboardingDraft\}/);
});
