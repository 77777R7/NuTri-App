import assert from 'node:assert/strict';
import test from 'node:test';

import { getBarcodeQuality } from '../../lib/scan/quality';

test('known barcode with no errors routes to dashboard', () => {
  const quality = getBarcodeQuality({
    status: 'complete',
    error: null,
    errorKind: 'none',
    sessionState: 'ok',
  });
  assert.equal(quality.page, 'dashboard');
  assert.equal(quality.errorState, false);
});

test('not found status routes to not_found page', () => {
  const quality = getBarcodeQuality({
    status: 'not_found',
    error: null,
    errorKind: 'not_found',
    sessionState: 'ok',
  });
  assert.equal(quality.page, 'not_found');
  assert.equal(quality.failureKind, 'not_found');
});

test('unauthorized error routes to recoverable_error page', () => {
  const quality = getBarcodeQuality({
    status: 'error',
    error: 'Unauthorized',
    errorKind: 'unauthorized',
    sessionState: 'ok',
  });
  assert.equal(quality.page, 'recoverable_error');
  assert.equal(quality.failureKind, 'unauthorized');
});

test('network error routes to recoverable_error page', () => {
  const quality = getBarcodeQuality({
    status: 'error',
    error: 'Could not connect to the server',
    errorKind: 'network',
    sessionState: 'ok',
  });
  assert.equal(quality.page, 'recoverable_error');
  assert.equal(quality.failureKind, 'network');
});

test('server error routes to recoverable_error page', () => {
  const quality = getBarcodeQuality({
    status: 'error',
    error: 'Internal server error',
    errorKind: 'server',
    sessionState: 'ok',
  });
  assert.equal(quality.page, 'recoverable_error');
  assert.equal(quality.failureKind, 'server');
});

test('session invalid routes to session_expired page', () => {
  const quality = getBarcodeQuality({
    status: 'idle',
    error: null,
    errorKind: 'none',
    sessionState: 'session_expired',
  });
  assert.equal(quality.page, 'session_expired');
  assert.equal(quality.failureKind, 'session_expired');
});
