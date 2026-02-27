import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';

const DASHBOARD_FILE = path.join(process.cwd(), 'components/scan/AnalysisDashboard.tsx');

test('modal keeps a single unified data-status surface and removes duplicate status cards', () => {
  const source = fs.readFileSync(DASHBOARD_FILE, 'utf8');

  assert.ok(source.includes('Data status (always visible, consistent)'));
  assert.ok(source.includes('buildUnifiedTileDataStatus('));
  assert.ok(!source.includes('title="Data quality"'));
  assert.ok(!source.includes('title="Data quality note"'));
});
