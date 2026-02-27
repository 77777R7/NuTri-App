import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';

const DASHBOARD_FILE = path.join(process.cwd(), 'components/scan/AnalysisDashboard.tsx');
const SERVER_FILE = path.join(process.cwd(), 'backend/src/server.ts');

test('p0 score UX contract: no why-this-score deck, usage summary removed, safety summary endpoint + ingredient switch', () => {
  const dashboardSource = fs.readFileSync(DASHBOARD_FILE, 'utf8');
  const serverSource = fs.readFileSync(SERVER_FILE, 'utf8');

  assert.equal(
    dashboardSource.includes('Why this score'),
    false,
    'Analysis dashboard should not render the legacy "Why this score" block',
  );

  assert.equal(
    dashboardSource.includes('title="Usage summary"'),
    false,
    'Usage summary card should be removed from usage modal',
  );
  assert.equal(
    dashboardSource.includes('/api/summary/usage'),
    false,
    'frontend usage summary endpoint call should be removed',
  );
  assert.ok(
    dashboardSource.includes('setTimeout(() => controller.abort(), 3_800)'),
    'safety summary request should use the faster timeout',
  );
  assert.ok(
    dashboardSource.includes('reasonCode: \'FALLBACK_DETERMINISTIC\''),
    'safety summary should fall back deterministically when the request fails',
  );
  assert.ok(
    dashboardSource.includes('Refining summary...'),
    'safety summary loading hint should use non-blocking copy',
  );

  assert.ok(
    dashboardSource.includes('activeSafetyIngredientName'),
    'safety modal should track active ingredient selection',
  );
  assert.ok(
    dashboardSource.includes('mode="safety"'),
    'ODS panel should render in safety mode for safety card',
  );

  assert.ok(
    dashboardSource.includes('/api/summary/safety'),
    'safety summary should call /api/summary/safety',
  );
  assert.ok(
    serverSource.includes('app.post("/api/summary/safety"'),
    'backend should expose /api/summary/safety route',
  );
});
