import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';

const BARCODE_SCREEN_FILE = path.join(process.cwd(), 'app/scan/barcode.tsx');
const source = fs.readFileSync(BARCODE_SCREEN_FILE, 'utf8');

test('barcode success path avoids Reanimated worklet scheduling on release builds', () => {
  assert.equal(source.includes("from 'react-native-reanimated'"), false);
  assert.equal(source.includes('runOnJS('), false);
  assert.equal(source.includes('withSpring('), false);
  assert.equal(source.includes('withTiming('), false);
});

test('barcode success path still shows success state and navigates to scan result', () => {
  assert.ok(source.includes("setStatus('success');"));
  assert.ok(source.includes('navigationTimerRef.current = setTimeout(() => {'));
  assert.ok(source.includes('navigateToResult(sessionId);'));
  assert.ok(source.includes("status === 'success' && ("));
  assert.ok(source.includes('<View style={styles.successContainer}>'));
});
