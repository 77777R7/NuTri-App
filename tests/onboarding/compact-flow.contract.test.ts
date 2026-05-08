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
const problemSource = readFileSync(
  new URL('../../app/onboarding/problem.tsx', import.meta.url),
  'utf8',
);
const solutionSource = readFileSync(
  new URL('../../app/onboarding/solution.tsx', import.meta.url),
  'utf8',
);
const welcomeSource = readFileSync(
  new URL('../../app/onboarding/welcome.tsx', import.meta.url),
  'utf8',
);
const layoutSource = readFileSync(
  new URL('../../app/onboarding/_layout.tsx', import.meta.url),
  'utf8',
);

test('compact onboarding keeps value framing, trust, goals, safety, preview, and scan-first handoff before done', () => {
  assert.equal(ONBOARDING_TOTAL_STEPS, 6);
  assert.match(
    registrySource,
    /export const ONBOARDING_FLOW_STEPS = \[\s*'welcome',\s*'problem',\s*'solution',\s*'data-trust',\s*'goals',\s*'allergy',\s*'plan-preview',\s*'first-stack',\s*\] as const;/,
  );
  assert.match(registrySource, /welcome:\s*1/);
  assert.match(registrySource, /'data-trust':\s*2/);
  assert.match(registrySource, /goals:\s*3/);
  assert.match(registrySource, /allergy:\s*4/);
  assert.match(registrySource, /'plan-preview':\s*5/);
  assert.match(registrySource, /'first-stack':\s*5/);
  assert.match(registrySource, /if \(progress === 3\) return 'goals'/);
  assert.match(registrySource, /if \(progress === 4\) return 'allergy'/);
  assert.match(registrySource, /return 'plan-preview'/);
});

test('compact onboarding does not expose deferred setup steps in the active shared flow shell', () => {
  for (const deferredStep of ['age-range', 'sex', 'experience', 'types', 'blocker', 'setup']) {
    assert.doesNotMatch(layoutSource, new RegExp(`<Stack\\.Screen name="${deferredStep}" />`));
    assert.doesNotMatch(shellSource, new RegExp(`'${deferredStep}'`));
  }

  assert.match(layoutSource, /<Stack\.Screen name="problem" \/>/);
  assert.match(layoutSource, /<Stack\.Screen name="solution" \/>/);
  assert.match(welcomeSource, /router\.replace\('\/onboarding\/problem'\)/);
  assert.match(problemSource, /ProblemIntroScreen/);
  assert.match(problemSource, /router\.replace\('\/onboarding\/solution'\)/);
  assert.match(solutionSource, /SolutionIntroScreen/);
  assert.match(solutionSource, /pathname:\s*'\/scan\/barcode'/);
  assert.match(solutionSource, /source:\s*'onboarding'/);
  assert.match(registrySource, /goToStep\('problem', 'forward'\)/);
  assert.match(registrySource, /goToStep\('solution', 'forward'\)/);
  assert.match(registrySource, /exitTo\('\/scan\/barcode\?source=onboarding', 'forward'\)/);
  assert.match(dataTrustSource, /router\.replace\('\/onboarding\/goals'\)/);
  assert.match(registrySource, /goToStep\('goals', 'forward'\)/);
  assert.match(registrySource, /goToStep\('allergy', 'forward'\)/);
  assert.match(registrySource, /goToStep\('plan-preview', 'forward'\)/);
  assert.doesNotMatch(registrySource, /goToStep\('types', 'forward'\)/);
  assert.doesNotMatch(registrySource, /goToStep\('blocker', 'forward'\)/);
});
