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
  assert.ok(
    dashboardSource.includes('const scienceDecisionPayload = authoritativeDecisionTemplatePayload ?? decisionTemplatePayload;'),
  );
  assert.ok(dashboardSource.includes('const scienceSidecarDecisionPayload = useMemo<DecisionSupportTemplatePayload | null>('));
  assert.ok(dashboardSource.includes("const decisionScienceBlock = scienceDecisionPayload?.scienceBlock;"));
  assert.ok(
    dashboardSource.includes("const decisionPersonalizedResultLane = personalizedDecisionPayload?.personalizedResultLane ?? null;"),
  );
  assert.ok(dashboardSource.includes("scienceSidecarDecisionPayload != null"));
  assert.ok(dashboardSource.includes("const decisionDigestForScience = normalizeText(scienceSidecarDecisionPayload?.digest ?? '')"));
  assert.ok(dashboardSource.includes("const scienceDecisionInputsHash ="));
  assert.ok(dashboardSource.includes("const sciencePersonalizationScopeHash ="));
  assert.ok(dashboardSource.includes('const shouldPrimeScienceSidecars ='));
  assert.ok(dashboardSource.includes('const shouldRenderScienceSidecars = selectedTileType === \'science\' && shouldPrimeScienceSidecars;'));
  assert.ok(dashboardSource.includes('if (!shouldPrimeScienceSidecars) return;'));
  assert.ok(dashboardSource.includes('!ingredientOverviewRequestKey'));
  assert.ok(dashboardSource.includes('!decisionBarcodeForScience'));
  assert.ok(dashboardSource.includes('decisionInputsHash: decisionInputsHashParam'));
  assert.ok(dashboardSource.includes('personalizationScopeHash: personalizationScopeHashParam'));
  assert.equal(dashboardSource.includes('InteractionManager.runAfterInteractions(() => {'), false);
  assert.ok(dashboardSource.includes("isIngredientOverviewRenderableState(currentState)"));
  assert.ok(dashboardSource.includes("isScientificBackgroundRenderableState(currentState)"));
  assert.ok(dashboardSource.includes('backgroundRefreshPending'));
  assert.ok(dashboardSource.includes('recommendedRetryAfterMs'));
  assert.ok(dashboardSource.includes('ingredientOverviewRetryCountRef'));
  assert.ok(dashboardSource.includes('setIngredientOverviewRetryTick((value) => value + 1);'));
  assert.ok(dashboardSource.includes('scientificBackgroundRetryCountRef'));
  assert.ok(dashboardSource.includes('setScientificBackgroundRetryTick((value) => value + 1);'));
});

test('server exposes ingredient overview and scientific background sidecars with shared authority helper', () => {
  assert.match(serverSource, /app\.post\(\s*"\/api\/ingredient-overview\/v1",\s*verifySupabaseTokenOrGuestScanToken/s);
  assert.match(serverSource, /app\.post\(\s*"\/api\/scientific-background\/v1",\s*verifySupabaseTokenOrGuestScanToken/s);
  assert.match(serverSource, /const buildDecisionSupportAuthorityBundle = async \(/);
  assert.match(serverSource, /buildDecisionSupportDigestMismatchPayload/);
  assert.match(serverSource, /decisionInputsHash:\s*z\.string\(\)\.trim\(\)\.min\(1\)\.nullable\(\)\.optional\(\)/);
  assert.match(serverSource, /personalizationScopeHash:\s*z\.string\(\)\.trim\(\)\.min\(1\)\.nullable\(\)\.optional\(\)/);
  assert.match(serverSource, /revalidateFallback:\s*z\.boolean\(\)\.optional\(\)/);
  assert.match(serverSource, /authority\.decisionSupport\.decisionInputsHash/);
  assert.match(serverSource, /authority\.personalizationScopeHash/);
  assert.match(
    serverSource,
    /const cacheKey = buildScanSidecarCacheKey\(\{\s*route: "ingredient_overview",\s*barcode: normalizedBarcode\.code,\s*decisionDigest: authority\.decisionSupport\.digest,\s*decisionInputsHash: authority\.decisionSupport\.decisionInputsHash,\s*personalizationScopeHash: authority\.personalizationScopeHash,/s,
  );
  assert.match(serverSource, /normalizeIngredientScienceKey\(\s*parsedBody\.selectedIngredientName,\s*\)/);
  assert.ok(serverSource.includes('backgroundRefreshPending: boolean;'));
  assert.ok(serverSource.includes('recommendedRetryAfterMs: number | null;'));
  assert.ok(serverSource.includes('withIngredientOverviewRefreshHint'));
  assert.ok(serverSource.includes('withScientificBackgroundRefreshHint'));
  assert.ok(serverSource.includes('INGREDIENT_OVERVIEW_REFRESH_RETRY_AFTER_MS'));
  assert.ok(serverSource.includes('SCIENTIFIC_BACKGROUND_REFRESH_RETRY_AFTER_MS'));
  assert.equal(
    serverSource.includes('await existingBackgroundRefresh.catch(() => null);'),
    false,
    'ingredient overview revalidate must not block on long background refresh',
  );
});

test('shared ingredient science types are additive and explicit', () => {
  assert.ok(sharedTypesSource.includes('export type IngredientOverviewBlock = {'));
  assert.ok(sharedTypesSource.includes('export type ScientificBackgroundSection = {'));
  assert.ok(sharedTypesSource.includes('export type ScientificBackgroundBlock = {'));
  assert.ok(sharedTypesSource.includes('export type IngredientOverviewResponse = {'));
  assert.ok(sharedTypesSource.includes('export type ScientificBackgroundResponse = {'));
});
