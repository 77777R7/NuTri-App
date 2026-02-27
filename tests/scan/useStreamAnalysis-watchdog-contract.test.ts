import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';

const HOOK_FILE = path.join(process.cwd(), 'hooks/useStreamAnalysis.ts');

test('rev1 watchdog and terminal lock are wired in stream hook', () => {
  const source = fs.readFileSync(HOOK_FILE, 'utf8');

  assert.ok(source.includes('STREAM_REV1_DONE_WATCHDOG_MS = 10_000'));
  assert.ok(source.includes('const rev1SeenRef = useRef(false)'));
  assert.ok(source.includes('const terminalLockedRef = useRef(false)'));
  assert.ok(source.includes('const armRev1DoneWatchdog = () => {'));
  assert.ok(source.includes("reasonCode: prev.reasonCode ?? 'REV1_WATCHDOG_TIMEOUT'"));
  assert.ok(source.includes("watchdogReason: 'REV1_WATCHDOG_TIMEOUT'"));
  assert.ok(source.includes("'DONE_MISSING_FALLBACK'"));
  assert.ok(source.includes('if (terminalLockedRef.current) return prev;'));
});
