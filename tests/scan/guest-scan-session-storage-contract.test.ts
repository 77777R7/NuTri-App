import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';

const source = readFileSync(path.join(process.cwd(), 'lib/scan/guestSession.ts'), 'utf8');

test('guest scan storage keeps claim tokens local and out of route params', () => {
  assert.match(source, /claimToken: string/);
  assert.match(source, /@nutri:guest_scan_session:/);
  assert.match(source, /@nutri:guest_scan_session:last/);
  assert.doesNotMatch(source, /URLSearchParams\([^)]*claimToken/s);
  assert.doesNotMatch(source, /router\.(push|replace)\([^)]*claimToken/s);
});

test('guest scan storage exposes create, update, lookup, and clear helpers', () => {
  assert.match(source, /export const createLocalGuestScanSession/);
  assert.match(source, /export const setGuestScanSessionScan/);
  assert.match(source, /export const getGuestScanSession/);
  assert.match(source, /export const getLastGuestScanSession/);
  assert.match(source, /export const markGuestScanSessionClaimPending/);
  assert.match(source, /export const markGuestScanSessionClaimFailed/);
  assert.match(source, /export const clearGuestScanSession/);
});
