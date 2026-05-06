import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';

const source = readFileSync(
  new URL('../../app/onboarding/first-stack.tsx', import.meta.url),
  'utf8',
);
const sharedFlowSource = readFileSync(
  new URL('../../components/onboarding/flow/SummaryFlowScenes.tsx', import.meta.url),
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

test('first stack analytics contract tracks scan-first selection and acceptance', () => {
  assert.match(source, /trackEvaluatedLoopExposure/);
  assert.match(source, /trackEvaluatedLoopClick/);
  assert.match(source, /trackEvaluatedLoopSave/);
  assert.match(source, /trackEvaluatedLoopConversion/);
  assert.match(source, /answer:\s*action/);
  assert.match(source, /actionKey:\s*action/);
  assert.match(source, /conversionType:\s*'first_stack_accepted'/);
});

test('shared flow keeps analytics and override recording coherent for scan manual later exits', () => {
  assert.match(sharedFlowSource, /trackEvaluatedLoopExposure/);
  assert.match(sharedFlowSource, /trackEvaluatedLoopClick/);
  assert.match(sharedFlowSource, /trackEvaluatedLoopSave/);
  assert.match(sharedFlowSource, /trackEvaluatedLoopConversion/);
  assert.match(sharedFlowSource, /question:\s*'first_stack_action_preference'/);
  assert.match(sharedFlowSource, /answer:\s*action/);
  assert.match(sharedFlowSource, /selectedAction:\s*action/);
  assert.match(sharedFlowSource, /actionKey:\s*action/);
  assert.match(sharedFlowSource, /field:\s*'firstActionPreference'/);
  assert.match(sharedFlowSource, /value:\s*action/);
});

test('shared flow awaits persistence before accepted telemetry and navigation', () => {
  assert.match(sharedFlowSource, /async \(action: FirstStackActionPreference\) =>/);
  assert.match(sharedFlowSource, /commitDraft\(\{ firstActionPreference: action \}, 5\)/);
  assert.match(sharedFlowSource, /await flushDraft\(\)/);
  assert.match(sharedFlowSource, /await recordOverrideEvents\(\[/);
  assert.match(sharedFlowSource, /trackEvaluatedLoopSave/);
  assert.match(sharedFlowSource, /trackEvaluatedLoopConversion/);
  assert.match(sharedFlowSource, /exitTo\('\/onboarding\/done', 'forward'\)/);
});
