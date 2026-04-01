import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';

import { SUPPLEMENT_EXPERIENCE_OPTIONS } from '@/lib/onboarding-v2';

const source = readFileSync(
  '/Users/howard07/NuTriApp/nutri-app/app/onboarding/experience.tsx',
  'utf8',
);

test('experience QA hero screen preserves route flow', () => {
  assert.match(source, /router\.replace\('\/onboarding\/sex'\)/);
  assert.match(source, /router\.replace\('\/onboarding\/goals'\)/);
});

test('experience QA hero screen preserves saveDraft step and analytics contract', () => {
  assert.match(
    source,
    /saveDraft\(\s*\{ supplementExperience: selected \|\| undefined \},\s*5\s*\)/,
  );
  assert.match(source, /trackOnboardingEvent\('question_answered'/);
  assert.match(source, /question:\s*'supplement_experience'/);
  assert.match(source, /selected \|\| 'skipped'/);
});

test('experience QA hero screen still uses canonical experience options', () => {
  assert.match(source, /\[\.\.\.SUPPLEMENT_EXPERIENCE_OPTIONS\]/);
  assert.deepEqual([...SUPPLEMENT_EXPERIENCE_OPTIONS], [
    'Brand new',
    'Tried a few',
    'Regular user',
    'Structured stack',
  ]);
});
