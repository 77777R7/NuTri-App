import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';

import { ONBOARDING_TOTAL_STEPS } from '../../lib/onboarding-v2.js';

const registrySource = readFileSync(
  new URL('../../components/onboarding/flow/OnboardingSceneRegistry.tsx', import.meta.url),
  'utf8',
);
const shellSource = readFileSync(
  new URL('../../components/onboarding/flow/onboardingShell.ts', import.meta.url),
  'utf8',
);
const dataTrustSource = readFileSync(
  new URL('../../app/onboarding/data-trust.tsx', import.meta.url),
  'utf8',
);
const layoutSource = readFileSync(
  new URL('../../app/onboarding/_layout.tsx', import.meta.url),
  'utf8',
);

test('compact onboarding keeps value framing, trust, goals, and safety as the active flow', () => {
  assert.equal(ONBOARDING_TOTAL_STEPS, 6);
  assert.match(
    registrySource,
    /export const ONBOARDING_FLOW_STEPS = \[\s*'welcome',\s*'problem',\s*'solution',\s*'data-trust',\s*'goals',\s*'allergy',\s*\] as const;/,
  );
  assert.match(registrySource, /welcome:\s*1/);
  assert.match(registrySource, /problem:\s*2/);
  assert.match(registrySource, /solution:\s*3/);
  assert.match(registrySource, /'data-trust':\s*4/);
  assert.match(registrySource, /goals:\s*5/);
  assert.match(registrySource, /allergy:\s*6/);
  assert.doesNotMatch(registrySource, /'plan-preview':\s*7/);
  assert.doesNotMatch(registrySource, /'first-stack':\s*7/);
  assert.match(registrySource, /if \(progress === 2\) return 'problem'/);
  assert.match(registrySource, /if \(progress === 3\) return 'solution'/);
  assert.match(registrySource, /if \(progress === 4\) return 'data-trust'/);
  assert.match(registrySource, /if \(progress === 5\) return 'goals'/);
  assert.match(registrySource, /if \(progress === 6\) return 'allergy'/);
  assert.match(registrySource, /return 'allergy'/);
});

test('compact onboarding does not expose deferred setup steps in the active shared flow shell', () => {
  for (const deferredStep of ['age-range', 'sex', 'experience', 'types', 'blocker', 'setup']) {
    assert.doesNotMatch(layoutSource, new RegExp(`<Stack\\.Screen name="${deferredStep}" />`));
    assert.doesNotMatch(shellSource, new RegExp(`'${deferredStep}'`));
  }

  assert.match(layoutSource, /<Stack\.Screen name="problem" \/>/);
  assert.match(layoutSource, /<Stack\.Screen name="solution" \/>/);
  assert.match(dataTrustSource, /pathname:\s*'\/onboarding\/goals'/);
  assert.match(registrySource, /goToStep\('problem', 'forward'\)/);
  assert.match(registrySource, /goToStep\('solution', 'forward'\)/);
  assert.match(registrySource, /exitTo\('\/scan\/barcode\?source=onboarding', 'forward'\)/);
  assert.match(registrySource, /goToStep\('goals', 'forward'\)/);
  assert.match(registrySource, /goToStep\('allergy', 'forward'\)/);
  assert.doesNotMatch(registrySource, /goToStep\('plan-preview', 'forward'\)/);
  assert.doesNotMatch(shellSource, /'plan-preview'/);
  assert.doesNotMatch(shellSource, /'first-stack'/);
  assert.doesNotMatch(registrySource, /goToStep\('types', 'forward'\)/);
  assert.doesNotMatch(registrySource, /goToStep\('blocker', 'forward'\)/);
});
