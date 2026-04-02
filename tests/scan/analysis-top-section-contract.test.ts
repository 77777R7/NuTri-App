import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const DASHBOARD_PATH = path.join(process.cwd(), 'components/scan/AnalysisDashboard.tsx');
const RESULT_PATH = path.join(process.cwd(), 'app/scan/result.tsx');
const HOME_PATH = path.join(process.cwd(), 'app/main/Home-Page.tsx');

const dashboardSource = fs.readFileSync(DASHBOARD_PATH, 'utf8');
const resultSource = fs.readFileSync(RESULT_PATH, 'utf8');
const homeSource = fs.readFileSync(HOME_PATH, 'utf8');

test('analysis top section uses inline expandable personalized insights', () => {
  assert.match(dashboardSource, /expandedInsightKey/);
  assert.match(dashboardSource, /topSectionPresentation\.insights\.map/);
  assert.match(dashboardSource, /setExpandedInsightKey/);
  assert.match(dashboardSource, /personalizedInsightExpanded/);
});

test('analysis top section wires save pill states and actions', () => {
  assert.match(dashboardSource, /savePillLabel = savePillState === 'saved' \? 'Saved' : 'Save'/);
  assert.match(dashboardSource, /if \(savePillState === 'saved'\)/);
  assert.match(dashboardSource, /onOpenSaved\?\.\(\);/);
  assert.match(dashboardSource, /if \(savePillState === 'save'\)/);
  assert.match(dashboardSource, /onSavePress\?\.\(\);/);
});

test('scan result passes saved-state wiring into the dashboard', () => {
  assert.match(resultSource, /savePillState=\{dashboardSaveItem \? \(isDashboardItemSaved \? 'saved' : 'save'\) : 'disabled'\}/);
  assert.match(resultSource, /onSavePress=\{handleSaveFromDashboard\}/);
  assert.match(resultSource, /onOpenSaved=\{handleOpenSaved\}/);
  assert.match(resultSource, /router\.push\(\{ pathname: '\/main\/Home-Page', params: \{ tab: 'saved' \} \}\)/);
});

test('home page accepts a saved tab route param for post-save navigation', () => {
  assert.match(homeSource, /useLocalSearchParams/);
  assert.match(homeSource, /normalizeRequestedTab/);
  assert.match(homeSource, /setCurrentTab\(requestedTab\)/);
});
