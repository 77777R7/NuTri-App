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
  assert.ok(dashboardSource.includes("if (decisionSupportState.status !== 'ready') return;"));
  assert.ok(dashboardSource.includes('const interactionTask = InteractionManager.runAfterInteractions(() => {'));
});

test('server exposes ingredient overview and scientific background sidecars with shared authority helper', () => {
  assert.ok(serverSource.includes('app.post("/api/ingredient-overview/v1", verifySupabaseToken'));
  assert.ok(serverSource.includes('app.post("/api/scientific-background/v1", verifySupabaseToken'));
  assert.ok(serverSource.includes('const buildDecisionSupportAuthorityBundle = async ('));
  assert.ok(serverSource.includes('buildDecisionSupportDigestMismatchPayload'));
  assert.ok(serverSource.includes('normalizeIngredientScienceKey(parsedBody.selectedIngredientName)'));
});

test('shared ingredient science types are additive and explicit', () => {
  assert.ok(sharedTypesSource.includes('export type IngredientOverviewBlock = {'));
  assert.ok(sharedTypesSource.includes('export type ScientificBackgroundSection = {'));
  assert.ok(sharedTypesSource.includes('export type ScientificBackgroundBlock = {'));
  assert.ok(sharedTypesSource.includes('export type IngredientOverviewResponse = {'));
  assert.ok(sharedTypesSource.includes('export type ScientificBackgroundResponse = {'));
});
