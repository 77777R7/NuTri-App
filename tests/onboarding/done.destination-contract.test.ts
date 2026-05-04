import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';

const source = readFileSync(
  new URL('../../app/onboarding/done.tsx', import.meta.url),
  'utf8',
);

test('manual onboarding completion hands off to the real search surface', () => {
  assert.match(source, /setMessage\('Opening search…'\)/);
  assert.match(source, /if \(destination === 'manual'\) \{\s*router\.replace\('\/search'\);/s);
  assert.doesNotMatch(
    source,
    /if \(destination === 'manual'\) \{\s*router\.replace\(\{ pathname: '\/scan\/label'/s,
  );
});
