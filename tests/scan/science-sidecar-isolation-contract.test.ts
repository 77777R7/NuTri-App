import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';

const DASHBOARD_FILE = path.join(process.cwd(), 'components/scan/AnalysisDashboard.tsx');
const SERVER_FILE = path.join(process.cwd(), 'backend/src/server.ts');
const SHARED_TYPES_FILE = path.join(process.cwd(), 'shared/types/ingredientScience.ts');

const dashboardSource = fs.readFileSync(DASHBOARD_FILE, 'utf8');
const serverSource = fs.readFileSync(SERVER_FILE, 'utf8');
const sharedTypesSource = fs.readFileSync(SHARED_TYPES_FILE, 'utf8');

test('science UI uses new B/C sidecars and removes the legacy ingredient summary fetch', () => {
  assert.ok(dashboardSource.includes('/api/ingredient-overview/v1'));
  assert.ok(dashboardSource.includes('/api/scientific-background/v1'));
  assert.equal(dashboardSource.includes('/api/summary/ingredient'), false);
  assert.ok(dashboardSource.includes('if (!shouldLoadScienceSidecars) return;'));
  assert.ok(dashboardSource.includes('!ingredientOverviewRequestKey'));
  assert.ok(dashboardSource.includes('!decisionBarcodeForScience'));
  assert.ok(dashboardSource.includes('decisionInputsHash: decisionInputsHashParam'));
  assert.ok(dashboardSource.includes('personalizationScopeHash: personalizationScopeHashParam'));
  assert.equal(dashboardSource.includes('InteractionManager.runAfterInteractions(() => {'), false);
  assert.ok(dashboardSource.includes("ingredientOverviewState.source === 'api' || ingredientOverviewState.source === 'server-fallback'"));
  assert.ok(dashboardSource.includes("scientificBackgroundState.source === 'api' || scientificBackgroundState.source === 'server-fallback'"));
});

test('server exposes ingredient overview and scientific background sidecars with shared authority helper', () => {
  assert.match(serverSource, /app\.post\("\/api\/ingredient-overview\/v1", verifySupabaseToken/);
  assert.match(serverSource, /app\.post\("\/api\/scientific-background\/v1", verifySupabaseToken/);
  assert.match(serverSource, /const buildDecisionSupportAuthorityBundle = async \(/);
  assert.match(serverSource, /buildDecisionSupportDigestMismatchPayload/);
  assert.match(serverSource, /decisionInputsHash:\s*z\.string\(\)\.trim\(\)\.min\(1\)\.nullable\(\)\.optional\(\)/);
  assert.match(serverSource, /personalizationScopeHash:\s*z\.string\(\)\.trim\(\)\.min\(1\)\.nullable\(\)\.optional\(\)/);
  assert.match(serverSource, /authority\.decisionSupport\.decisionInputsHash/);
  assert.match(serverSource, /authority\.personalizationScopeHash/);
  assert.match(
    serverSource,
    /const cacheKey = \[\s*authority\.decisionSupport\.digest,\s*authority\.decisionSupport\.decisionInputsHash,\s*authority\.personalizationScopeHash,/,
  );
  assert.ok(serverSource.includes('normalizeIngredientScienceKey(parsedBody.selectedIngredientName)'));
});

test('shared ingredient science types are additive and explicit', () => {
  assert.ok(sharedTypesSource.includes('export type IngredientOverviewBlock = {'));
  assert.ok(sharedTypesSource.includes('export type ScientificBackgroundSection = {'));
  assert.ok(sharedTypesSource.includes('export type ScientificBackgroundBlock = {'));
  assert.ok(sharedTypesSource.includes('export type IngredientOverviewResponse = {'));
  assert.ok(sharedTypesSource.includes('export type ScientificBackgroundResponse = {'));
});
