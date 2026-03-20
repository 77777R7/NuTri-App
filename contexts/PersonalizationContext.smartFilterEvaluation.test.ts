import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';

test('personalization context wires saved-product evaluation into snapshot compilation', () => {
  const filePath = path.resolve(process.cwd(), 'contexts/PersonalizationContext.tsx');
  const source = fs.readFileSync(filePath, 'utf8');

  assert.match(source, /apiClient,\s*type EnsureOverviewFacts,\s*type EnsureOverviewResponse/);
  assert.match(source, /scoreProductGoalMatches/);
  assert.match(source, /evaluateEligibilityPolicy/);
  assert.match(source, /apiClient\s*\.\s*ensureOverview\(/);
  assert.match(source, /savedProducts:\s*productEvaluations\.savedProducts/);
  assert.match(source, /smartFilterMembershipById:\s*snapshot\.surfaces\.smartFilter\.productMembershipById \?\? \{\}/);
  assert.match(source, /buildSavedProductEvaluation/);
  assert.match(source, /deriveTypeKeysFromFacts/);
  assert.match(source, /typeKeys = ensuredFacts \? deriveTypeKeysFromFacts\(ensuredFacts\) : \[\]/);
});
