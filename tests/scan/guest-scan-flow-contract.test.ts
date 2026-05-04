import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';

const root = process.cwd();
const apiSource = readFileSync(path.join(root, 'lib/api/guestScan.ts'), 'utf8');
const gateSource = readFileSync(path.join(root, 'app/(auth)/gate.tsx'), 'utf8');
const indexSource = readFileSync(path.join(root, 'app/index.tsx'), 'utf8');
const configSource = readFileSync(path.join(root, 'constants/Config.ts'), 'utf8');
const envSource = readFileSync(path.join(root, 'lib/env.ts'), 'utf8');

test('guest scan API creates a server session and stores claim token locally', () => {
  assert.match(apiSource, /Config\.apiBaseUrl/);
  assert.match(apiSource, /\/api\/guest-scan\/session/);
  assert.match(apiSource, /createLocalGuestScanSession/);
  assert.match(apiSource, /guestScanSessionId/);
  assert.match(apiSource, /claimToken/);
  assert.doesNotMatch(apiSource, /URLSearchParams\([^)]*claimToken/s);
});

test('auth gate exposes Start Free Scan behind feature flag without routing claim token', () => {
  assert.match(configSource, /guestScanEnabled: ENV\.guestScanEnabled/);
  assert.match(envSource, /EXPO_PUBLIC_GUEST_SCAN_ENABLED/);
  assert.match(gateSource, /Config\.guestScanEnabled/);
  assert.match(gateSource, /gate-start-free-scan/);
  assert.match(gateSource, /createGuestScanSessionFromServer/);
  assert.match(gateSource, /pathname: '\/scan\/barcode'/);
  assert.match(gateSource, /guestScanSessionId: session\.guestScanSessionId/);
  assert.doesNotMatch(gateSource, /claimToken/);
});

test('signed-out app entry can reach the auth gate', () => {
  assert.match(indexSource, /Config\.guestScanEnabled/);
  assert.match(indexSource, /<Redirect href="\/\(auth\)\/gate" \/>/);
});
