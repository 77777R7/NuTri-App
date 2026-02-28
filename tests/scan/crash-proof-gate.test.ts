import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';

const STABLE_GATE_FILE = path.join(process.cwd(), 'scripts/maintainer/run-backend-gates-stable.mjs');
const CRASH_FIXTURE_FILE = path.join(
  process.cwd(),
  'scripts/maintainer/fixtures/crash_canary_barcodes.v1.json',
);
const COHORT_REPLAY_FILE = path.join(
  process.cwd(),
  'scripts/maintainer/run-cohort-replay.mjs',
);

test('stable gate includes crash canary sequence and post-canary done enforcement', () => {
  const source = fs.readFileSync(STABLE_GATE_FILE, 'utf8');

  assert.ok(source.includes('const crashCanaryFixtureArg ='));
  assert.ok(source.includes('const buildCrashCanaryFixture = async'));
  assert.ok(source.includes('const runCrashCanarySequence = async'));
  assert.ok(source.includes('crash_canary_terminal_rate_'));
  assert.ok(source.includes('crash_canary_post_done_rate_'));
  assert.ok(source.includes('backend_uncaught_exception_count_'));
  assert.ok(source.includes('const readBackendCrashStats = async'));
  assert.ok(source.includes('const CRASH_CANARY_REPORT_PATH ='));
});

test('crash canary fixture includes canaries and known-good barcodes', () => {
  const payload = JSON.parse(fs.readFileSync(CRASH_FIXTURE_FILE, 'utf8'));

  assert.equal(Array.isArray(payload.canaries), true);
  assert.equal(Array.isArray(payload.knownGood), true);
  assert.ok(payload.canaries.length > 0);
  assert.ok(payload.knownGood.length > 0);
  assert.ok(payload.canaries.every((row: any) => typeof row.barcode === 'string' && row.barcode.trim().length > 0));
  assert.ok(payload.knownGood.every((row: any) => typeof row.barcode === 'string' && row.barcode.trim().length > 0));
});

test('cohort replay emits repeat stability fields for nondeterminism detection', () => {
  const source = fs.readFileSync(COHORT_REPLAY_FILE, 'utf8');

  assert.ok(source.includes('repeatIndex'));
  assert.ok(source.includes('stabilityHash'));
  assert.ok(source.includes('nondeterministicSameBarcodeCount'));
});
