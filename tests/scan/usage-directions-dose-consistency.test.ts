import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';

const DASHBOARD_FILE = path.join(process.cwd(), 'components/scan/AnalysisDashboard.tsx');

test('usage copy separates directions from per-serving dose', () => {
  const source = fs.readFileSync(DASHBOARD_FILE, 'utf8');

  assert.ok(source.includes('Directions from record:'), 'missing directions label');
  assert.ok(source.includes('Per-serving dose from record:'), 'missing per-serving dose label');
  assert.ok(
    !source.includes('Label dosage: '),
    'legacy ambiguous dosage copy should be removed from usage structured lines',
  );
});
