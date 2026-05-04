import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';

import { GOAL_OPTIONS } from '@/lib/onboarding-v2';

const source = readFileSync(
  '/Users/howard07/NuTriApp/nutri-app/app/onboarding/goals.tsx',
  'utf8',
);

test('goals QA hero screen preserves route flow', () => {
  assert.match(source, /router\.replace\('\/onboarding\/data-trust'\)/);
  assert.match(source, /router\.replace\('\/onboarding\/allergy'\)/);
});

test('goals QA hero screen preserves saveDraft step and analytics contract', () => {
  assert.match(source, /saveDraft\(/);
  assert.match(source, /goals:\s*selectedGoals/);
  assert.match(source, /preferredTypes:\s*draft\?\.preferredTypes \?\? \[\]/);
  assert.match(source, /,\s*3,\s*\)/);
  assert.match(source, /trackOnboardingEvent\('question_answered'/);
  assert.match(source, /question:\s*'goals'/);
  assert.match(source, /answerCount:\s*selectedGoals\.length/);
  assert.match(source, /answers:\s*selectedGoals/);
});

test('goals QA hero screen still uses canonical goal options and multi-select state', () => {
  assert.match(source, /\[\.\.\.GOAL_OPTIONS\]/);
  assert.match(source, /setSelectedGoals\(\(current\)/);
  assert.match(source, /current\.includes\(goal\)/);
  assert.deepEqual([...GOAL_OPTIONS], [
    'Sleep',
    'Energy',
    'Immunity',
    'Recovery',
    'Focus',
    'Libido Enhancement',
    'Stress Support',
    'Weight Management',
  ]);
});
