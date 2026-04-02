import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';

import { SEX_OPTIONS } from '@/lib/onboarding-v2';

const source = readFileSync(
  '/Users/howard07/NuTriApp/nutri-app/app/onboarding/sex.tsx',
  'utf8',
);

test('sex QA hero screen preserves route flow', () => {
  assert.match(source, /router\.replace\('\/onboarding\/age-range'\)/);
  assert.match(source, /router\.replace\('\/onboarding\/experience'\)/);
});

test('sex QA hero screen preserves saveDraft step and analytics contract', () => {
  assert.match(
    source,
    /saveDraft\(\s*\{ sex: selected \|\| undefined, gender: selected \|\| undefined \},\s*4,\s*\)/,
  );
  assert.match(source, /trackOnboardingEvent\('question_answered'/);
  assert.match(source, /question:\s*'sex'/);
  assert.match(source, /selected \|\| 'skipped'/);
});

test('sex QA hero screen still uses canonical sex options', () => {
  assert.match(source, /\[\.\.\.SEX_OPTIONS\]/);
  assert.deepEqual([...SEX_OPTIONS], ['Male', 'Female', 'Other', 'Prefer not to say']);
});
