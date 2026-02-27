import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';

const RESULT_FILE = path.join(process.cwd(), 'app/scan/result.tsx');

test('result screen wires debug panel guard and key diagnostics fields', () => {
  const source = fs.readFileSync(RESULT_FILE, 'utf8');

  assert.ok(source.includes('EXPO_PUBLIC_SHOW_SCAN_DEBUG'));
  assert.ok(source.includes('testID="scan-debug-panel"'));
  assert.ok(source.includes('requestId'));
  assert.ok(source.includes('lastSseEventType'));
  assert.ok(source.includes('reasonCode'));
  assert.ok(source.includes('watchdogReason'));
  assert.ok(source.includes('routeDecision'));
});
