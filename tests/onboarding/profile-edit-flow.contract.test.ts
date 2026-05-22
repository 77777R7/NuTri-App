import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import {
  PROFILE_EDIT_MODE,
  sanitizeProfileEditReturnTo,
} from '../../lib/onboarding/profileEditReturn';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../..');

const readSource = (relativePath: string): string =>
  readFileSync(resolve(repoRoot, relativePath), 'utf8');

test('profile edit return links are limited to the profile tab', () => {
  assert.equal(PROFILE_EDIT_MODE, 'profile_edit');
  assert.equal(
    sanitizeProfileEditReturnTo('/main/Home-Page?tab=profile'),
    '/main/Home-Page?tab=profile',
  );
  assert.equal(sanitizeProfileEditReturnTo('/scan/result?sessionId=abc'), null);
  assert.equal(sanitizeProfileEditReturnTo('https://example.com'), null);
  assert.equal(sanitizeProfileEditReturnTo('//example.com'), null);
});

test('profile answer editing returns from goals and allergy back to Profile', () => {
  const profileSource = readSource('components/screens/ProfileScreen.tsx');
  const goalsSource = readSource('app/onboarding/goals.tsx');
  const allergySource = readSource('app/onboarding/allergy.tsx');

  assert.match(profileSource, /mode:\s*'profile_edit'/);
  assert.match(profileSource, /returnTo:\s*'\/main\/Home-Page\?tab=profile'/);

  assert.match(goalsSource, /sanitizeProfileEditReturnTo/);
  assert.match(goalsSource, /PROFILE_EDIT_MODE/);
  assert.match(goalsSource, /pathname:\s*'\/onboarding\/allergy'/);

  assert.match(allergySource, /sanitizeProfileEditReturnTo/);
  assert.match(allergySource, /router\.replace\(safeProfileReturnTo\)/);
  assert.match(allergySource, /Save answers/);
  assert.match(allergySource, /Keep current answers/);
});
