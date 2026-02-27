import assert from 'node:assert/strict';
import test from 'node:test';

import { buildVerificationPresentation } from '@/lib/scan/verificationPresentation';

const trustedIdentity = {
  title: 'Vitamin C',
  subtitle: 'Brand',
  displayIdentityMode: 'trusted' as const,
  sourceAttributionUsed: 'verified_regulatory' as const,
  titleSanitized: false,
  identityPending: false,
};

test('verification presentation resolves final for trusted authoritative record', () => {
  const presentation = buildVerificationPresentation({
    meta: {
      sourceType: 'dsld',
      sourceTypeFinal: true,
      revision: 1,
    } as any,
    trustedIdentity,
    isStreaming: false,
  });

  assert.equal(presentation.sourceDataset, 'dsld');
  assert.equal(presentation.verificationStatus, 'final');
  assert.equal(presentation.copyTokens.badgeLabel, 'Verified source');
  assert.equal(presentation.blocked, false);
});

test('verification presentation prefers pending while stream is active', () => {
  const presentation = buildVerificationPresentation({
    meta: {
      sourceType: 'lnhpd',
      sourceTypeFinal: true,
      revision: 0,
    } as any,
    trustedIdentity: {
      ...trustedIdentity,
      identityPending: true,
    },
    isStreaming: true,
  });

  assert.equal(presentation.verificationStatus, 'pending');
  assert.equal(presentation.copyTokens.badgeLabel, 'Verifying source');
});

test('verification presentation marks likely when authoritative record is blocked by degraded terminal', () => {
  const presentation = buildVerificationPresentation({
    meta: {
      sourceType: 'lnhpd',
      sourceTypeFinal: true,
      terminalReason: 'DEGRADED_WEB_BUDGET',
      degradedMode: true,
    } as any,
    trustedIdentity,
    isStreaming: false,
  });

  assert.equal(presentation.verificationStatus, 'likely');
  assert.equal(presentation.blocked, true);
  assert.equal(presentation.blockedReasons.includes('degraded_terminal'), true);
});

test('verification presentation requires sourceTypeFinal=true before marking final', () => {
  const presentation = buildVerificationPresentation({
    meta: {
      sourceType: 'dsld',
      sourceTypeFinal: undefined,
      revision: 1,
    } as any,
    trustedIdentity,
    isStreaming: false,
  });

  assert.equal(presentation.verificationStatus, 'likely');
  assert.equal(presentation.copyTokens.badgeLabel, 'Likely match');
});

test('verification presentation marks web-only attribution as blocked', () => {
  const presentation = buildVerificationPresentation({
    meta: {
      sourceType: 'web',
      sourceTypeFinal: false,
      fallbackReason: 'web_text_unusable',
    } as any,
    trustedIdentity: {
      ...trustedIdentity,
      displayIdentityMode: 'unverified',
      sourceAttributionUsed: 'web_hint_unverified',
    },
    isStreaming: false,
  });

  assert.equal(presentation.verificationStatus, 'web_only');
  assert.equal(presentation.sourceDataset, 'web_only');
  assert.equal(presentation.blocked, true);
  assert.equal(presentation.copyTokens.badgeLabel, 'Web hint (unverified)');
});
