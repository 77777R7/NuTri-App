import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';

import { SETUP_OPTIONS } from '@/lib/onboarding-v2';

const source = readFileSync(
  '/Users/howard07/NuTriApp/nutri-app/app/onboarding/setup.tsx',
  'utf8',
);

test('setup QA hero screen preserves route flow', () => {
  assert.match(source, /router\.replace\('\/onboarding\/blocker'\)/);
  assert.match(source, /router\.replace\('\/onboarding\/plan-preview'\)/);
});

test('setup QA hero screen preserves saveDraft step and analytics contract', () => {
  assert.match(source, /const permissionPreferences = \{/);
  assert.match(source, /setupPreferences:\s*selectedSetupLabels/);
  assert.match(source, /,\s*10,\s*\)/);
  assert.match(source, /trackOnboardingEvent\('question_answered'/);
  assert.match(source, /question:\s*'setup_preferences'/);
  assert.match(source, /answers:\s*selectedSetupLabels/);
  assert.match(source, /permissionPreferences/);
});

test('setup QA hero screen uses canonical setup options and default selected state', () => {
  assert.match(source, /SETUP_OPTIONS\.map/);
  assert.match(source, /DEFAULT_SETUP_VALUES/);
  assert.deepEqual([...SETUP_OPTIONS], [
    {
      title: 'Camera shortcut',
      description: 'Open the camera faster when you want to scan.',
    },
    {
      title: 'Daily reminder nudges',
      description: 'Keep check-ins easier with a gentle reminder.',
    },
    {
      title: 'Photo library upload',
      description: 'Use saved photos when scan is not the easiest path.',
    },
  ]);
});
