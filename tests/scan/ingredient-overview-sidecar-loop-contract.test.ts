import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';

const DASHBOARD_PATH = path.join(process.cwd(), 'components/scan/AnalysisDashboard.tsx');
const dashboardSource = fs.readFileSync(DASHBOARD_PATH, 'utf8');

const sliceRequired = (source: string, startNeedle: string, endNeedle: string): string => {
  const start = source.indexOf(startNeedle);
  assert.ok(start >= 0, `missing start marker: ${startNeedle}`);
  const end = source.indexOf(endNeedle, start + startNeedle.length);
  assert.ok(end > start, `missing end marker after: ${startNeedle}`);
  return source.slice(start, end);
};

test('science sidecar request effects do not depend on their own mutable status', () => {
  const ingredientOverviewRequestEffect = sliceRequired(
    dashboardSource,
    'const current = ingredientOverviewStateRef.current[ingredientOverviewRequestKey];',
    "if (selectedTileType !== 'science') return;",
  );
  assert.match(
    ingredientOverviewRequestEffect,
    /ingredientOverviewStateRef\.current\[ingredientOverviewRequestKey\]/,
  );
  assert.doesNotMatch(
    ingredientOverviewRequestEffect,
    /ingredientOverviewState\?\.(status|source|backgroundRefreshPending|recommendedRetryAfterMs)/,
  );

  const scientificBackgroundRequestEffect = sliceRequired(
    dashboardSource,
    'const requestRunKey = currentRunKeyRef.current;',
    "if (selectedTileType !== 'science') return;",
  );
  assert.match(
    scientificBackgroundRequestEffect,
    /scientificBackgroundStateRef\.current\[requestKey\]/,
  );
  assert.doesNotMatch(
    scientificBackgroundRequestEffect,
    /scientificBackgroundState\?\.(status|source|backgroundRefreshPending|recommendedRetryAfterMs)/,
  );
});
