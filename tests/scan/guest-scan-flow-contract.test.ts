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
const scanSessionSource = readFileSync(path.join(root, 'lib/scan/session.ts'), 'utf8');
const authSessionSource = readFileSync(path.join(root, 'lib/auth-session.ts'), 'utf8');
const barcodeSource = readFileSync(path.join(root, 'app/scan/barcode.tsx'), 'utf8');
const streamSource = readFileSync(path.join(root, 'hooks/useStreamAnalysis.ts'), 'utf8');
const resultSource = readFileSync(path.join(root, 'app/scan/result.tsx'), 'utf8');
const dashboardSource = readFileSync(path.join(root, 'components/scan/AnalysisDashboard.tsx'), 'utf8');
const serverSource = readFileSync(path.join(root, 'backend/src/server.ts'), 'utf8');
const claimSource = readFileSync(path.join(root, 'app/guest-scan/claim.tsx'), 'utf8');
const signupSource = readFileSync(path.join(root, 'app/(auth)/auth/signup.tsx'), 'utf8');
const loginSource = readFileSync(path.join(root, 'app/(auth)/auth/login.tsx'), 'utf8');

test('guest scan API creates a server session and stores claim token locally', () => {
  assert.match(apiSource, /Config\.apiBaseUrl/);
  assert.match(apiSource, /\/api\/guest-scan\/session/);
  assert.match(apiSource, /createLocalGuestScanSession/);
  assert.match(apiSource, /guestScanSessionId/);
  assert.match(apiSource, /claimToken/);
  assert.doesNotMatch(apiSource, /URLSearchParams\([^)]*claimToken/s);
});

test('auth gate no longer exposes Start Free Scan as the first signed-out action', () => {
  assert.match(configSource, /guestScanEnabled: ENV\.guestScanEnabled/);
  assert.match(envSource, /EXPO_PUBLIC_GUEST_SCAN_ENABLED/);
  assert.doesNotMatch(gateSource, /Config\.guestScanEnabled/);
  assert.doesNotMatch(gateSource, /gate-start-free-scan/);
  assert.doesNotMatch(gateSource, /createGuestScanSessionFromServer/);
  assert.doesNotMatch(gateSource, /pathname: '\/scan\/barcode'/);
  assert.doesNotMatch(gateSource, /claimToken/);
});

test('signed-out app entry can reach the auth gate', () => {
  assert.match(indexSource, /Config\.guestScanEnabled/);
  assert.match(indexSource, /<Redirect href="\/gate" \/>/);
});

test('guest scan metadata stays attached to scan session and stream headers', () => {
  assert.match(scanSessionSource, /guestScanSessionId\?: string \| null/);
  assert.match(barcodeSource, /guestScanSessionId/);
  assert.match(barcodeSource, /setGuestScanSessionScan/);
  assert.match(resultSource, /session\.guestScanSessionId/);
  assert.match(streamSource, /scanSessionId\?: string \| null/);
  assert.match(streamSource, /guestScanSessionId\?: string \| null/);
  assert.match(streamSource, /getGuestScanSession/);
  assert.match(streamSource, /X-Guest-Scan-Session-Id/);
  assert.match(streamSource, /X-Guest-Scan-Claim-Token/);
  assert.match(streamSource, /X-Scan-Session-Id/);
  assert.match(streamSource, /scanSessionId/);
});

test('guest scan result sidecars reuse guest scan auth instead of requiring a signed-in user', () => {
  assert.match(serverSource, /\/api\/product-overview-ai\/v1"[\s\S]{0,120}verifySupabaseTokenOrGuestScanToken/);
  assert.match(serverSource, /\/api\/ingredient-overview\/v1"[\s\S]{0,120}verifySupabaseTokenOrGuestScanToken/);
  assert.match(serverSource, /\/api\/scientific-background\/v1"[\s\S]{0,120}verifySupabaseTokenOrGuestScanToken/);
  assert.match(resultSource, /guestScanSessionId=\{guestScanSessionId\}/);
  assert.match(dashboardSource, /guestScanSessionId\?: string \| null/);
  assert.match(dashboardSource, /getGuestScanSession/);
  assert.match(dashboardSource, /X-Guest-Scan-Session-Id/);
  assert.match(dashboardSource, /X-Guest-Scan-Claim-Token/);
  assert.match(dashboardSource, /\/api\/product-overview-ai\/v1/);
  assert.match(dashboardSource, /\/api\/ingredient-overview\/v1/);
  assert.match(dashboardSource, /\/api\/scientific-background\/v1/);
});

test('guest scan result receives one full reveal and keep action routes through claim', () => {
  assert.match(resultSource, /isGuestScan/);
  assert.match(resultSource, /guestScanSessionId/);
  assert.match(resultSource, /getGuestScanSession/);
  assert.match(resultSource, /shouldShowGuestClaimPrompt/);
  assert.match(resultSource, /\/guest-scan\/claim/);
  assert.match(resultSource, /Keep this result/);
  assert.match(resultSource, /isGuestScan\s*\?\s*'full'/);
});

test('post-auth guest claim route reads token from local storage, not URL', () => {
  assert.match(claimSource, /claimGuestScanSessionOnServer/);
  assert.match(claimSource, /guestScanSessionId/);
  assert.match(claimSource, /getLastGuestScanSession/);
  assert.doesNotMatch(claimSource, /params\.claimToken/);
  assert.match(claimSource, /router\.replace/);
});

test('auth screens preserve guest claim redirect context', () => {
  assert.match(signupSource, /postAuthRedirect/);
  assert.match(signupSource, /getPostAuthDestination/);
  assert.match(signupSource, /normalizeAuthRedirectParam/);
  assert.match(signupSource, /encodeAuthRedirectParam\(redirectTarget\)/);
  assert.match(signupSource, /guest-scan\/claim/);
  assert.match(loginSource, /normalizeAuthRedirectParam/);
  assert.match(loginSource, /encodeAuthRedirectParam\(redirectTarget\)/);
  assert.match(loginSource, /guest-scan\/claim/);
  assert.match(authSessionSource, /trimmed\.startsWith\('\/'\)/);
});
