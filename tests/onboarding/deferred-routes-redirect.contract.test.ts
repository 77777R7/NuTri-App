import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';

const deferredRouteFiles = [
  'age-range',
  'sex',
  'experience',
  'types',
  'blocker',
  'setup',
] as const;

test('deferred onboarding routes redirect back to the active compact flow', () => {
  for (const route of deferredRouteFiles) {
    const source = readFileSync(
      new URL(`../../app/onboarding/${route}.tsx`, import.meta.url),
      'utf8',
    );

    assert.match(source, /import \{ Redirect \} from 'expo-router';/);
    assert.match(source, /<Redirect href="\/onboarding" \/>/);
    assert.doesNotMatch(source, /saveDraft|trackOnboardingEvent|QAScreen|QAMultiSelectScreen|QASingleSelectScreen/);
    assert.doesNotMatch(source, /router\.replace\('\/onboarding\/(?:age-range|sex|experience|types|blocker|setup)'/);
  }
});
