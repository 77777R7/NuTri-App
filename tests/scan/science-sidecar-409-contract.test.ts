import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';

const DASHBOARD_PATH = path.resolve(process.cwd(), 'components/scan/AnalysisDashboard.tsx');

test('ingredient overview sidecar retries once on digest mismatch before fallback', async () => {
  const source = await readFile(DASHBOARD_PATH, 'utf8');
  const idx = source.indexOf('api/ingredient-overview/v1');
  assert.ok(idx >= 0, 'missing ingredient overview endpoint fetch');
  const slice = source.slice(idx - 1000, idx + 4200);

  assert.match(slice, /if \(response\.status === 409\)/);
  assert.match(slice, /const latestDigest =/);
  assert.match(slice, /const latestDecisionInputsHash =/);
  assert.match(slice, /const latestPersonalizationScopeHash =/);
  assert.match(slice, /decisionInputsHash: decisionInputsHashParam,/);
  assert.match(slice, /personalizationScopeHash: personalizationScopeHashParam,/);
  assert.match(slice, /revalidateFallback,/);
  assert.match(slice, /return run\(\s*latestDigest,\s*latestDecisionInputsHash,\s*latestPersonalizationScopeHash,\s*false,\s*revalidateFallback,\s*\)/);
  assert.match(source, /promptVersion: 'ingredient_overview_client_fallback_v1'/);
});

test('scientific background sidecar retries once on digest mismatch before fallback', async () => {
  const source = await readFile(DASHBOARD_PATH, 'utf8');
  const idx = source.indexOf('api/scientific-background/v1');
  assert.ok(idx >= 0, 'missing scientific background endpoint fetch');
  const slice = source.slice(idx - 1000, idx + 3000);

  assert.match(slice, /if \(response\.status === 409\)/);
  assert.match(slice, /const latestDigest =/);
  assert.match(slice, /const latestDecisionInputsHash =/);
  assert.match(slice, /const latestPersonalizationScopeHash =/);
  assert.match(slice, /decisionInputsHash: decisionInputsHashParam,/);
  assert.match(slice, /personalizationScopeHash: personalizationScopeHashParam,/);
  assert.match(slice, /revalidateFallback,/);
  assert.match(slice, /return run\(\s*latestDigest,\s*latestDecisionInputsHash,\s*latestPersonalizationScopeHash,\s*false,\s*revalidateFallback,\s*\)/);
  assert.match(slice, /promptVersion: 'scientific_background_client_fallback_v1'/);
});
