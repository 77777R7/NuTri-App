import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';

const DASHBOARD_FILE = path.join(process.cwd(), 'components/scan/AnalysisDashboard.tsx');

test('AnalysisDashboard defines lowerFirst before resolved hero copy uses it', () => {
  const source = fs.readFileSync(DASHBOARD_FILE, 'utf8');
  const definitionIndex = source.indexOf('function lowerFirst(');
  const usageIndex = source.indexOf('lowerFirst(goalLabel)');

  assert.ok(definitionIndex >= 0, 'lowerFirst helper should be defined in AnalysisDashboard');
  assert.ok(usageIndex > definitionIndex, 'lowerFirst helper should be defined before hero copy usage');
});
