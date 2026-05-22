import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';

const firstStackSource = readFileSync(
  new URL('../../app/onboarding/first-stack.tsx', import.meta.url),
  'utf8',
);
const sharedFlowSource = readFileSync(
  new URL('../../components/onboarding/flow/SummaryFlowScenes.tsx', import.meta.url),
  'utf8',
);

test('first-stack analytics are removed from the active onboarding handoff', () => {
  assert.match(firstStackSource, /LegacyFirstStackRedirect/);
  assert.match(firstStackSource, /getLegacyOnboardingRedirect\(params\.returnTo\)/);
  assert.doesNotMatch(firstStackSource, /trackEvaluatedLoopExposure|trackEvaluatedLoopClick|trackEvaluatedLoopSave|trackEvaluatedLoopConversion/);
  assert.equal(sharedFlowSource.trim(), 'export {};');
});
