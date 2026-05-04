import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';

import { GOAL_OPTIONS } from '../../lib/onboarding-v2.js';

const source = readFileSync(new URL('../../app/onboarding/plan-preview.tsx', import.meta.url), 'utf8');
const sharedFlowSource = readFileSync(
  new URL('../../components/onboarding/flow/SummaryFlowScenes.tsx', import.meta.url),
  'utf8',
);

test('plan-preview primes the user for one clear first step', () => {
  assert.match(source, /We found your easiest first step/);
  assert.match(
    source,
    /We used your goals, preferences, and routine to choose the easiest place to begin\./,
  );
  assert.match(source, /QAContinueCTA title="See my first step"/);
  assert.match(sharedFlowSource, /continueLabel: 'See my first step'/);
  assert.doesNotMatch(source, /Here is your plan/);
  assert.doesNotMatch(source, /Unlock My Plan/);
  assert.doesNotMatch(sharedFlowSource, /continueLabel: 'Unlock My Plan'/);
});

test('plan-preview preserves route flow', () => {
  assert.match(source, /router\.replace\('\/onboarding\/allergy'\)/);
  assert.match(source, /router\.replace\('\/onboarding\/first-stack'\)/);
});

test('plan-preview preserves saveDraft step and smart filter payload', () => {
  assert.match(source, /smartFilterConfig:\s*buildSmartFilterConfig\(/);
  assert.match(source, /goals:\s*draft\?\.goals \?\? \[\]/);
  assert.match(source, /preferredTypes:\s*draft\?\.preferredTypes \?\? \[\]/);
  assert.match(source, /,\s*5,\s*\)/);
});

test('plan-preview keeps personalized goal recommendation source and interaction state', () => {
  assert.match(source, /ingredientRecommendations/);
  assert.match(source, /const guideGoals = useMemo/);
  assert.match(source, /selectedGoals\.length > 0 \? selectedGoals : \['Energy', 'Sleep'\]/);
  assert.match(source, /const \[expandedGoal, setExpandedGoal\]/);
  assert.deepEqual(GOAL_OPTIONS, [
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
