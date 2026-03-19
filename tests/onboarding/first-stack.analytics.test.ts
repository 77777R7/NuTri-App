import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';

const source = readFileSync(
  '/Users/howard07/NuTriApp/nutri-app/app/onboarding/first-stack.tsx',
  'utf8',
);

test('first stack analytics contract uses shared evaluated-loop analytics for exposure, click, save, and completion', () => {
  assert.match(source, /trackEvaluatedLoopExposure/);
  assert.match(source, /trackEvaluatedLoopClick/);
  assert.match(source, /trackEvaluatedLoopSave/);
  assert.match(source, /trackEvaluatedLoopConversion/);
  assert.match(source, /conversionType:\s*'first_stack_accepted'/);
});

test('first stack analytics contract carries replayable snapshot fields', () => {
  assert.match(source, /snapshot\.snapshotId/);
  assert.match(source, /snapshot\.rulesVersion/);
  assert.match(source, /scheduleTemplateKey/);
  assert.match(source, /evaluatedItemCount/);
  assert.match(source, /foundationCount/);
  assert.match(source, /goalSupportCount/);
  assert.match(source, /optionalCount/);
});

test('first stack analytics contract preserves onboarding answer tracking alongside page-specific events', () => {
  assert.match(source, /trackOnboardingEvent\('question_answered'/);
  assert.match(source, /question:\s*'first_stack_action_preference'/);
  assert.match(source, /source:\s*'first_stack'/);
});
