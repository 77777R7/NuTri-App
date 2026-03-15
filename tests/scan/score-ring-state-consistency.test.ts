import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';

const DASHBOARD_FILE = path.join(process.cwd(), 'components/scan/AnalysisDashboard.tsx');
const RESULT_FILE = path.join(process.cwd(), 'app/scan/result.tsx');

test('score ring contract reads only the current V2 score card path', () => {
  const source = fs.readFileSync(DASHBOARD_FILE, 'utf8');

  assert.ok(source.includes('const scoreCardV2Payload = decisionTemplatePayload?.nutriScoreCardV2 ?? null;'));
  assert.ok(source.includes('hasNumber(scoreCardV2Payload?.overallScore)'));
  assert.ok(source.includes('buildSafetySignalPack({'));
  assert.ok(!source.includes('bundleState.meta.scoreAvailable === false ||'));

  const resultSource = fs.readFileSync(RESULT_FILE, 'utf8');
  assert.ok(!resultSource.includes('if (meta.scoreAvailable === false) return null;'));
});
