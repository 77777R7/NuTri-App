import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';

const DASHBOARD_FILE = path.join(process.cwd(), 'components/scan/AnalysisDashboard.tsx');
const SERVER_FILE = path.join(process.cwd(), 'backend/src/server.ts');

test('usage summary card is removed from usage modal and no frontend usage-summary endpoint calls remain', () => {
  const dashboardSource = fs.readFileSync(DASHBOARD_FILE, 'utf8');

  const accuracyTitle = 'title="What would improve accuracy"';
  const summaryTitle = 'title="Usage summary"';
  const accuracyIdx = dashboardSource.indexOf(accuracyTitle);
  const summaryIdx = dashboardSource.indexOf(summaryTitle);

  assert.ok(accuracyIdx >= 0, 'missing "What would improve accuracy" card');
  assert.equal(summaryIdx, -1, '"Usage summary" card should not render');
  assert.equal(
    dashboardSource.includes('/api/summary/usage'),
    false,
    'frontend should not call /api/summary/usage',
  );

  const serverSource = fs.readFileSync(SERVER_FILE, 'utf8');
  assert.ok(
    serverSource.includes('app.post("/api/summary/usage"'),
    'backend /api/summary/usage route should remain for compatibility',
  );
});
