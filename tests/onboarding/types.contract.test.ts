import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';

import { TYPE_OPTIONS } from '@/lib/onboarding-v2';

const source = readFileSync(
  '/Users/howard07/NuTriApp/nutri-app/app/onboarding/types.tsx',
  'utf8',
);

test('types QA hero screen preserves route flow', () => {
  assert.match(source, /router\.replace\('\/onboarding\/goals'\)/);
  assert.match(source, /router\.replace\('\/onboarding\/allergy'\)/);
});

test('types QA hero screen preserves saveDraft step and analytics contract', () => {
  assert.match(source, /saveDraft\(/);
  assert.match(source, /preferredTypes:\s*selectedTypes/);
  assert.match(source, /goals:\s*draft\?\.goals \?\? \[\]/);
  assert.match(source, /,\s*7,\s*\)/);
  assert.match(source, /trackOnboardingEvent\('question_answered'/);
  assert.match(source, /question:\s*'preferred_types'/);
  assert.match(source, /answerCount:\s*selectedTypes\.length/);
  assert.match(source, /answers:\s*selectedTypes/);
});

test('types QA hero screen still uses canonical type options and multi-select state', () => {
  assert.match(source, /\[\.\.\.TYPE_OPTIONS\]/);
  assert.match(source, /setSelectedTypes\(\(current\)/);
  assert.match(source, /current\.includes\(value\)/);
  assert.deepEqual([...TYPE_OPTIONS], [
    'Vitamin',
    'Mineral',
    'Herb',
    'Probiotic',
    'Protein',
  ]);
});
