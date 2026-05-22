import assert from 'node:assert/strict';
import test from 'node:test';

import {
  getProductSearchGateDecision,
  getSavedSupplementAddGateDecision,
  getScanEntryGateDecision,
  resolvePostPurchaseResumePath,
} from '../../lib/pro/featureGates.ts';

test('free users can enter only their first normal scan before the scan-limit paywall', () => {
  assert.equal(
    getScanEntryGateDecision({
      isPremium: false,
      firstCompletedScanId: null,
    }).allowed,
    true,
  );

  const secondScan = getScanEntryGateDecision({
    isPremium: false,
    firstCompletedScanId: 'scan_1',
  });

  assert.equal(secondScan.allowed, false);
  assert.equal(secondScan.paywallSource, 'scan_limit');
});

test('scan gate exempts premium, onboarding, and guest scan flows', () => {
  assert.equal(
    getScanEntryGateDecision({ isPremium: true, firstCompletedScanId: 'scan_1' }).allowed,
    true,
  );
  assert.equal(
    getScanEntryGateDecision({
      isPremium: false,
      firstCompletedScanId: 'scan_1',
      isOnboardingScan: true,
    }).allowed,
    true,
  );
  assert.equal(
    getScanEntryGateDecision({
      isPremium: false,
      firstCompletedScanId: 'scan_1',
      isGuestScan: true,
    }).allowed,
    true,
  );
});

test('product search is Pro-only', () => {
  assert.equal(getProductSearchGateDecision({ isPremium: true }).allowed, true);

  const freeSearch = getProductSearchGateDecision({ isPremium: false });
  assert.equal(freeSearch.allowed, false);
  assert.equal(freeSearch.paywallSource, 'product_search');
});

test('saved supplement limit allows one free non-duplicate and gates the second', () => {
  assert.equal(
    getSavedSupplementAddGateDecision({
      isPremium: false,
      savedCount: 0,
      isDuplicate: false,
    }).status,
    'allowed',
  );

  assert.equal(
    getSavedSupplementAddGateDecision({
      isPremium: false,
      savedCount: 1,
      isDuplicate: false,
    }).status,
    'limit_reached',
  );

  assert.equal(
    getSavedSupplementAddGateDecision({
      isPremium: true,
      savedCount: 8,
      isDuplicate: false,
    }).status,
    'allowed',
  );
});

test('saved supplement duplicate wins over free limit', () => {
  assert.equal(
    getSavedSupplementAddGateDecision({
      isPremium: false,
      savedCount: 1,
      isDuplicate: true,
    }).status,
    'duplicate',
  );
});

test('post-purchase resume paths return to the blocked Pro action', () => {
  assert.equal(resolvePostPurchaseResumePath({ source: 'scan_limit', returnTo: '/main/Home-Page' }), '/scan/barcode');
  assert.equal(resolvePostPurchaseResumePath({ source: 'product_search', returnTo: '/main/Home-Page' }), '/search');
  assert.equal(
    resolvePostPurchaseResumePath({
      source: 'saved_supplement_limit',
      returnTo: '/scan/result?sessionId=scan_1',
    }),
    '/scan/result?sessionId=scan_1',
  );
  assert.equal(
    resolvePostPurchaseResumePath({
      source: 'profile_upgrade',
      returnTo: '/main/Home-Page?tab=profile',
    }),
    '/search',
  );
});
