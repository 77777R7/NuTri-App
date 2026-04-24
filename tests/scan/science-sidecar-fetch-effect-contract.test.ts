import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';

const DASHBOARD_FILE = path.join(process.cwd(), 'components/scan/AnalysisDashboard.tsx');

const extractDependencyBlockAfter = (source: string, marker: string): string => {
  const markerIndex = source.indexOf(marker);
  assert.ok(markerIndex >= 0, `missing marker: ${marker}`);
  const depsStart = source.indexOf('}, [', markerIndex);
  assert.ok(depsStart >= 0, `missing dependency block after: ${marker}`);
  const depsEnd = source.indexOf(']);', depsStart);
  assert.ok(depsEnd >= 0, `unterminated dependency block after: ${marker}`);
  return source.slice(depsStart, depsEnd);
};

test('ingredient-overview fetch effect does not depend on state it writes', () => {
  const source = fs.readFileSync(DASHBOARD_FILE, 'utf8');
  const deps = extractDependencyBlockAfter(source, "fetch(`${baseUrl}/api/ingredient-overview/v1`");

  assert.doesNotMatch(deps, /ingredientOverviewState\?\.status/);
  assert.doesNotMatch(deps, /ingredientOverviewState\?\.source/);
});

test('scientific-background fetch effect does not depend on state it writes', () => {
  const source = fs.readFileSync(DASHBOARD_FILE, 'utf8');
  const deps = extractDependencyBlockAfter(source, "fetch(`${baseUrl}/api/scientific-background/v1`");

  assert.doesNotMatch(deps, /scientificBackgroundState\?\.status/);
  assert.doesNotMatch(deps, /scientificBackgroundState\?\.source/);
  assert.doesNotMatch(deps, /scientificBackgroundState\?\.backgroundRefreshPending/);
  assert.doesNotMatch(deps, /scientificBackgroundState\?\.recommendedRetryAfterMs/);
  assert.match(deps, /scientificBackgroundRetryTick/);
});
