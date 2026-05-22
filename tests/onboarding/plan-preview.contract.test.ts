import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import {
  appendPersonalizedGuideApplied,
  buildScanResultReturnTo,
  getLegacyOnboardingRedirect,
  sanitizePostScanReturnTo,
} from '../../lib/onboarding/postScanReturn';

const planPreviewSource = readFileSync(new URL('../../app/onboarding/plan-preview.tsx', import.meta.url), 'utf8');
const firstStackSource = readFileSync(new URL('../../app/onboarding/first-stack.tsx', import.meta.url), 'utf8');
const redirectHelperSource = readFileSync(new URL('../../lib/onboarding/postScanReturn.ts', import.meta.url), 'utf8');
const sharedFlowSource = readFileSync(
  new URL('../../components/onboarding/flow/SummaryFlowScenes.tsx', import.meta.url),
  'utf8',
);

test('plan-preview and first-stack are redirect-only legacy routes', () => {
  for (const source of [planPreviewSource, firstStackSource]) {
    assert.match(source, /import \{ Redirect, useLocalSearchParams \} from 'expo-router';/);
    assert.match(source, /getLegacyOnboardingRedirect\(params\.returnTo\)/);
    assert.doesNotMatch(source, /QAContinueCTA|QAScreenShell|trackOnboardingEvent|saveDraft/);
  }

  assert.equal(sharedFlowSource.trim(), 'export {};');
});

test('legacy onboarding redirects prefer safe scan result returnTo and reject unsafe paths', () => {
  assert.match(redirectHelperSource, /pathname !== SCAN_RESULT_PATH/);
  assert.match(redirectHelperSource, /return '\/onboarding\?step=goals'/);
  assert.match(redirectHelperSource, /appendPersonalizedGuideApplied\(safeReturnTo\)/);
  assert.match(redirectHelperSource, /personalizedGuide=\$\{PERSONALIZED_GUIDE_APPLIED\}/);
  assert.doesNotMatch(redirectHelperSource, /startsWith\('\/'\)/);
});

test('legacy onboarding redirect helper only allows local scan result returns', () => {
  const safeReturnTo = '/scan/result?sessionId=abc&source=guest_scan&guestScanSessionId=guest-1';

  assert.equal(sanitizePostScanReturnTo(safeReturnTo), safeReturnTo);
  assert.equal(
    appendPersonalizedGuideApplied(safeReturnTo),
    '/scan/result?sessionId=abc&source=guest_scan&guestScanSessionId=guest-1&personalizedGuide=applied',
  );
  assert.equal(
    getLegacyOnboardingRedirect('/scan/result?sessionId=abc&personalizedGuide=old'),
    '/scan/result?sessionId=abc&personalizedGuide=applied',
  );

  for (const unsafe of [
    '/main/Home-Page',
    'https://example.com/scan/result?sessionId=abc',
    '//example.com/scan/result?sessionId=abc',
    '/scan/result\n?sessionId=abc',
  ]) {
    assert.equal(sanitizePostScanReturnTo(unsafe), null);
    assert.equal(getLegacyOnboardingRedirect(unsafe), '/onboarding?step=goals');
  }
});

test('scan result returnTo preserves dev fixture barcode for simulator smoke', () => {
  assert.equal(
    buildScanResultReturnTo({
      sessionId: 'postscan-smoke-001',
      source: 'onboarding',
      devBarcode: '023249011835',
    }),
    '/scan/result?sessionId=postscan-smoke-001&source=onboarding&devBarcode=023249011835',
  );
});
