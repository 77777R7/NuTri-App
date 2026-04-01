import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';

import { GOAL_OPTIONS } from '@/lib/onboarding-v2';

const source = readFileSync(
  '/Users/howard07/NuTriApp/nutri-app/app/onboarding/plan-preview.tsx',
  'utf8',
);

test('plan-preview preserves route flow', () => {
  assert.match(source, /router\.replace\('\/onboarding\/setup'\)/);
  assert.match(source, /router\.replace\('\/onboarding\/first-stack'\)/);
});

test('plan-preview preserves saveDraft step and smart filter payload', () => {
  assert.match(source, /smartFilterConfig:\s*buildSmartFilterConfig\(/);
  assert.match(source, /goals:\s*draft\?\.goals \?\? \[\]/);
  assert.match(source, /preferredTypes:\s*draft\?\.preferredTypes \?\? \[\]/);
  assert.match(source, /,\s*11,\s*\)/);
});

test('plan-preview keeps personalized goal recommendation source and interaction state', () => {
  assert.match(source, /ingredientRecommendations/);
  assert.match(source, /const guideGoals = useMemo/);
  assert.match(source, /selectedGoals\.length > 0 \? selectedGoals : \['Energy', 'Sleep'\]/);
  assert.match(source, /const \[expandedGoal, setExpandedGoal\]/);
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
