import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';

import { ADHERENCE_BLOCKER_OPTIONS } from '@/lib/onboarding-v2';

const source = readFileSync(
  '/Users/howard07/NuTriApp/nutri-app/app/onboarding/blocker.tsx',
  'utf8',
);

test('blocker QA hero screen preserves route flow', () => {
  assert.match(source, /router\.replace\('\/onboarding\/allergy'\)/);
  assert.match(source, /router\.replace\('\/onboarding\/setup'\)/);
});

test('blocker QA hero screen preserves saveDraft step and analytics contract', () => {
  assert.match(
    source,
    /saveDraft\(\{ adherenceBlocker: selected \|\| undefined \}, 9\)/,
  );
  assert.match(source, /trackOnboardingEvent\('question_answered'/);
  assert.match(source, /question:\s*'adherence_blocker'/);
  assert.match(source, /selected \|\| 'skipped'/);
});

test('blocker QA hero screen still uses canonical blocker options', () => {
  assert.match(source, /\[\.\.\.ADHERENCE_BLOCKER_OPTIONS\]/);
  assert.deepEqual([...ADHERENCE_BLOCKER_OPTIONS], [
    'I forget when my day gets busy',
    'My routine changes day to day',
    'I am not sure which supplements fit my goals',
    'Labels and dosage are confusing',
    'I do not have a good daily tracking habit',
    'I am already consistent',
  ]);
});
