import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';

import { AGE_RANGE_OPTIONS } from '@/lib/onboarding-v2';

const source = readFileSync(
  '/Users/howard07/NuTriApp/nutri-app/app/onboarding/age-range.tsx',
  'utf8',
);

test('age-range hero screen preserves the intended route flow', () => {
  assert.match(source, /router\.replace\('\/onboarding\/data-trust'\)/);
  assert.match(source, /router\.replace\('\/onboarding\/sex'\)/);
});

test('age-range hero screen preserves draft save step and analytics contract', () => {
  assert.match(source, /saveDraft\(\{ ageRange: skip \? undefined : selected \}, 3\)/);
  assert.match(source, /trackOnboardingEvent\('question_answered'/);
  assert.match(source, /question:\s*'age_range'/);
  assert.match(source, /skip \? 'skipped' : selected/);
});

test('age-range hero screen still uses canonical age options', () => {
  assert.match(source, /\[\.\.\.AGE_RANGE_OPTIONS\]/);
  assert.deepEqual([...AGE_RANGE_OPTIONS], ['13-17', '18-24', '25-34', '35-44', '45-54', '55+']);
});
