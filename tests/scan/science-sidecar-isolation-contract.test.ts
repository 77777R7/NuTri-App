import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';

const DASHBOARD_FILE = path.join(process.cwd(), 'components/scan/AnalysisDashboard.tsx');
const SERVER_FILE = path.join(process.cwd(), 'backend/src/server.ts');
const SCIENCE_SIDECAR_ROUTES_FILE = path.join(process.cwd(), 'backend/src/routes/scienceSidecarRoutes.ts');
const SHARED_TYPES_FILE = path.join(process.cwd(), 'shared/types/ingredientScience.ts');

const dashboardSource = fs.readFileSync(DASHBOARD_FILE, 'utf8');
const serverSource = fs.readFileSync(SERVER_FILE, 'utf8');
const scienceSidecarRoutesSource = fs.readFileSync(SCIENCE_SIDECAR_ROUTES_FILE, 'utf8');
const sharedTypesSource = fs.readFileSync(SHARED_TYPES_FILE, 'utf8');

test('science UI uses new B/C sidecars and removes the legacy ingredient summary fetch', () => {
  assert.ok(dashboardSource.includes('/api/ingredient-overview/v1'));
  assert.ok(dashboardSource.includes('/api/scientific-background/v1'));
  assert.equal(dashboardSource.includes('/api/summary/ingredient'), false);
  assert.ok(
    dashboardSource.includes('const scienceDecisionPayload = authoritativeDecisionTemplatePayload ?? decisionTemplatePayload;'),
  );
  assert.ok(dashboardSource.includes("const decisionScienceBlock = scienceDecisionPayload?.scienceBlock;"));
  assert.ok(
    dashboardSource.includes("const decisionPersonalizedResultLane = personalizedDecisionPayload?.personalizedResultLane ?? null;"),
  );
  assert.ok(dashboardSource.includes('const scienceSidecarDecisionPayload = useMemo<DecisionSupportTemplatePayload | null>'));
  assert.ok(dashboardSource.includes('if (!shouldPrimeScienceSidecars) return;'));
  assert.ok(dashboardSource.includes('!ingredientOverviewRequestKey'));
  assert.ok(dashboardSource.includes('!decisionBarcodeForScience'));
  assert.ok(dashboardSource.includes('decisionInputsHash: decisionInputsHashParam'));
  assert.ok(dashboardSource.includes('personalizationScopeHash: personalizationScopeHashParam'));
  assert.equal(dashboardSource.includes('InteractionManager.runAfterInteractions(() => {'), false);
  assert.ok(dashboardSource.includes("state.source === 'api' || state.source === 'server-fallback'"));
  assert.ok(dashboardSource.includes("source?: 'api' | 'server-fallback'"));
});

test('server exposes ingredient overview and scientific background sidecars with shared authority helper', () => {
  assert.match(serverSource, /registerScienceSidecarRoutes\(app,/);
  assert.match(scienceSidecarRoutesSource, /app\.post\("\/api\/ingredient-overview\/v1", deps\.verifySupabaseToken/);
  assert.match(scienceSidecarRoutesSource, /app\.post\("\/api\/scientific-background\/v1", deps\.verifySupabaseToken/);
  assert.match(serverSource, /const buildDecisionSupportAuthorityBundle = async \(/);
  assert.match(serverSource, /buildDecisionSupportDigestMismatchPayload/);
  assert.match(scienceSidecarRoutesSource, /decisionInputsHash:\s*z\.string\(\)\.trim\(\)\.min\(1\)\.nullable\(\)\.optional\(\)/);
  assert.match(scienceSidecarRoutesSource, /personalizationScopeHash:\s*z\.string\(\)\.trim\(\)\.min\(1\)\.nullable\(\)\.optional\(\)/);
  assert.match(scienceSidecarRoutesSource, /revalidateFallback:\s*z\.boolean\(\)\.optional\(\)/);
  assert.match(scienceSidecarRoutesSource, /authority\.decisionSupport\.decisionInputsHash/);
  assert.match(scienceSidecarRoutesSource, /authority\.personalizationScopeHash/);
  assert.match(scienceSidecarRoutesSource, /const buildScientificBackgroundSidecarCacheKey = \(params: \{/);
  assert.match(scienceSidecarRoutesSource, /buildScanSidecarCacheKey\(\{\s*route: "scientific_background"/);
  assert.match(scienceSidecarRoutesSource, /const cacheKey = buildScientificBackgroundSidecarCacheKey\(\{/);
  assert.ok(scienceSidecarRoutesSource.includes('normalizeIngredientScienceKey(parsedBody.selectedIngredientName)'));
  assert.ok(scienceSidecarRoutesSource.includes('backgroundRefreshPending: boolean;'));
  assert.ok(scienceSidecarRoutesSource.includes('recommendedRetryAfterMs: number | null;'));
  assert.ok(scienceSidecarRoutesSource.includes('withScientificBackgroundRefreshHint'));
  assert.ok(scienceSidecarRoutesSource.includes('SCIENTIFIC_BACKGROUND_REFRESH_RETRY_AFTER_MS'));
});

test('shared ingredient science types are additive and explicit', () => {
  assert.ok(sharedTypesSource.includes('export type IngredientOverviewBlock = {'));
  assert.ok(sharedTypesSource.includes('export type ScientificBackgroundSection = {'));
  assert.ok(sharedTypesSource.includes('export type ScientificBackgroundBlock = {'));
  assert.ok(sharedTypesSource.includes('export type IngredientOverviewResponse = {'));
  assert.ok(sharedTypesSource.includes('export type ScientificBackgroundResponse = {'));
});

test('ingredient overview background refresh emits root-cause instrumentation', () => {
  assert.ok(scienceSidecarRoutesSource.includes('logScienceSidecarEvent'));
  assert.ok(scienceSidecarRoutesSource.includes('[SCIENCE_SIDECAR_${event}]'));

  for (const event of [
    'ROUTES_REGISTERED',
    'CACHE_KEY_MISMATCH',
    'INGREDIENT_REFRESH_SCHEDULED',
    'INGREDIENT_REFRESH_START',
    'INGREDIENT_REFRESH_SUCCESS',
    'INGREDIENT_REFRESH_FALLBACK',
    'INGREDIENT_REFRESH_ERROR',
    'INGREDIENT_REFRESH_CACHE_WRITE',
    'INGREDIENT_REFRESH_FINISH',
  ]) {
    assert.ok(scienceSidecarRoutesSource.includes(event));
  }

  for (const field of [
    'queueWaitMs',
    'queuedTooLong',
    'fallbackReason',
    'parseFailureCount',
    'gateRejectCount',
    'timeoutCount',
    'cacheKeyHash',
    'requestedHash',
    'actualHash',
  ]) {
    assert.ok(scienceSidecarRoutesSource.includes(field));
  }
});
