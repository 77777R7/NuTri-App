import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';

const root = process.cwd();
const specPath = path.join(
  root,
  'docs/superpowers/specs/2026-05-05-guest-scan-claim-contract.md',
);
const spec = readFileSync(specPath, 'utf8');

const assertIncludes = (needle: string) => {
  assert.ok(
    spec.includes(needle),
    `Expected guest scan contract to include: ${needle}`,
  );
};

test('guest scan claim contract defines the guarded scan-to-claim flow', () => {
  for (const required of [
    'Start Free Scan -> barcode captured -> result_ready -> save/track tapped -> auth complete -> claim succeeded',
    'EXPO_PUBLIC_GUEST_SCAN_ENABLED=1',
    'GUEST_SCAN_ENABLED=1',
    'POST /api/guest-scan/session',
    'POST /api/guest-scan/claim',
    '/api/enrich-stream',
    '/guest-scan/claim',
  ]) {
    assertIncludes(required);
  }
});

test('guest scan claim contract keeps claim tokens local and out of unsafe surfaces', () => {
  for (const required of [
    'Stores raw `claimToken` locally only.',
    'Never routes with `claimToken`.',
    'Never reads a token from URL params.',
    'Tokens must not be logged.',
    'Tokens must not be emitted in analytics.',
    'Analytics payloads must not include:',
    '- `claimToken`',
  ]) {
    assertIncludes(required);
  }
});

test('guest scan claim contract names the required implementation surfaces', () => {
  for (const required of [
    'lib/env.ts',
    'constants/Config.ts',
    'app/(auth)/gate.tsx',
    'app/index.tsx',
    'lib/api/guestScan.ts',
    'lib/scan/guestSession.ts',
    'lib/scan/session.ts',
    'app/scan/barcode.tsx',
    'hooks/useStreamAnalysis.ts',
    'app/scan/result.tsx',
    'app/guest-scan/claim.tsx',
    'app/(auth)/auth/login.tsx',
    'app/(auth)/auth/signup.tsx',
    'backend/src/guestScanSessions.ts',
    'backend/src/server.ts',
    'supabase/migrations/*_guest_scan_sessions.sql',
  ]) {
    assertIncludes(required);
  }
});

test('guest scan claim contract defines auth headers, backend status, and Render smoke', () => {
  for (const required of [
    'X-Guest-Scan-Session-Id',
    'X-Guest-Scan-Claim-Token',
    'X-Scan-Session-Id',
    'created -> scanning -> result_started -> result_ready -> claim_pending -> claimed',
    'claim_token_hash text not null',
    'Confirm Supabase `guest_scan_sessions` row reaches `result_ready`.',
    'Confirm row reaches `claimed` with `claimed_user_id`.',
  ]) {
    assertIncludes(required);
  }
});

test('guest scan claim contract preserves clean PR boundaries', () => {
  for (const forbiddenMix of [
    'Do not change the compact logged-in onboarding flow.',
    'Do not redesign barcode camera UX.',
    'Do not change score wiring, mini score header behavior, or dashboard rendering.',
    'Do not use `X-Auth-Disabled` for production guest scan access.',
    'unrelated onboarding',
    'science sidecar',
    'image hotfix',
    'barcode UX redesign work',
  ]) {
    assertIncludes(forbiddenMix);
  }
});
