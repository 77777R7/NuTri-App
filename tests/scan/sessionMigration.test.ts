import assert from 'node:assert/strict';
import test from 'node:test';

import {
  __sessionTestUtils,
  SCAN_SESSION_DEFAULT_TTL_MS,
  SCAN_SESSION_SCHEMA_VERSION,
  consumeScanSessionWithStatus,
} from '../../lib/scan/session';

test('legacy session shape migrates successfully', () => {
  __sessionTestUtils.reset();
  const sessionId = 'legacy-session-1';
  __sessionTestUtils.seedRawSession(sessionId, {
    id: sessionId,
    mode: 'barcode',
    input: { barcode: '0123456789012' },
    isLoading: true,
  });

  const result = consumeScanSessionWithStatus(sessionId);
  assert.equal(result.status, 'ok');
  if (result.status !== 'ok') return;
  assert.equal(result.session.id, sessionId);
  assert.equal(result.envelope.schemaVersion, SCAN_SESSION_SCHEMA_VERSION);
  assert.equal(result.envelope.ttlMs, SCAN_SESSION_DEFAULT_TTL_MS);
});

test('expired session returns session_expired without throwing', () => {
  __sessionTestUtils.reset();
  const sessionId = 'expired-session';
  __sessionTestUtils.seedRawSession(sessionId, {
    schemaVersion: SCAN_SESSION_SCHEMA_VERSION,
    createdAt: Date.now() - (SCAN_SESSION_DEFAULT_TTL_MS + 1_000),
    ttlMs: SCAN_SESSION_DEFAULT_TTL_MS,
    session: {
      id: sessionId,
      mode: 'barcode',
      input: { barcode: '0123456789012' },
      isLoading: false,
    },
  });

  const result = consumeScanSessionWithStatus(sessionId);
  assert.equal(result.status, 'session_expired');
  if (result.status !== 'session_expired') return;
  assert.equal(result.reasonCode, 'expired');
});

test('dirty session payload is cleaned and reported as session_expired', () => {
  __sessionTestUtils.reset();
  const sessionId = 'dirty-session';
  __sessionTestUtils.seedRawSession(sessionId, {
    schemaVersion: 999,
    createdAt: 'bad',
    ttlMs: null,
    session: { foo: 'bar' },
  });

  const result = consumeScanSessionWithStatus(sessionId);
  assert.equal(result.status, 'session_expired');
  if (result.status !== 'session_expired') return;
  assert.equal(result.reasonCode, 'invalid');
});
