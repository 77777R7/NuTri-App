import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const resultSource = readFileSync(new URL('../../app/scan/result.tsx', import.meta.url), 'utf8');
const dashboardSource = readFileSync(new URL('../../components/scan/AnalysisDashboard.tsx', import.meta.url), 'utf8');
const officialRouteSource = readFileSync(new URL('../../app/paywall/official.tsx', import.meta.url), 'utf8');
const officialPaywallSource = readFileSync(
  new URL('../../components/paywall/OfficialPaywallPage.tsx', import.meta.url),
  'utf8',
);

test('locked scan result breakdown sections route to the official paywall', () => {
  assert.match(dashboardSource, /onRequestProUnlock\?: \(source: PaywallSource\) => void/);
  assert.match(dashboardSource, /const requestProUnlock = useCallback/);
  assert.match(dashboardSource, /onPress=\{\(\) => requestProUnlock\('score'\)\}/);
  assert.match(dashboardSource, /requestProUnlock\(tile\.type\)/);
  assert.match(resultSource, /const handleResultBreakdownUnlock = useCallback/);
  assert.match(resultSource, /pathname:\s*'\/paywall\/official'/);
  assert.match(resultSource, /source,/);
  assert.match(resultSource, /buildScanResultReturnTo/);
  assert.match(resultSource, /onRequestProUnlock=\{handleResultBreakdownUnlock\}/);
});

test('official paywall keeps result breakdown copy release-accurate', () => {
  assert.match(officialRouteSource, /case 'score':/);
  assert.match(officialRouteSource, /case 'overview':/);
  assert.match(officialRouteSource, /case 'science':/);
  assert.match(officialRouteSource, /case 'usage':/);
  assert.match(officialRouteSource, /case 'safety':/);
  assert.doesNotMatch(officialRouteSource, /case 'comparison':/);

  assert.match(officialPaywallSource, /RESULT_BREAKDOWN_FEATURES/);
  assert.match(officialPaywallSource, /Full NuTri Score/);
  assert.match(officialPaywallSource, /Ingredient Deep Dive/);
  assert.match(officialPaywallSource, /Personalized Fit Checks/);
  assert.match(officialPaywallSource, /More Scan Results/);
  assert.doesNotMatch(officialPaywallSource, /Progress[\s\S]{0,80}Smart Guidance/);
});
