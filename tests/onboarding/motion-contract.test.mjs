import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';

const root = '/Users/howard07/NuTriApp/nutri-app';

const read = (path) => readFileSync(`${root}/${path}`, 'utf8');

test('onboarding motion has one shared timing source for page handoff pieces', () => {
  const motion = read('components/onboarding/flow/onboardingMotion.ts');

  assert.match(motion, /ONBOARDING_STEP_SLIDE_TIMING/);
  assert.match(motion, /ONBOARDING_CHROME_PROGRESS_DURATION_MS/);
  assert.match(motion, /ONBOARDING_FOOTER_TRANSITION_DURATION_MS/);
});

test('standalone onboarding pages consume shared step slide timing', () => {
  const qaShell = read('components/onboarding/qa/QAScreenShell.tsx');
  const planPreview = read('app/onboarding/plan-preview.tsx');

  for (const source of [qaShell, planPreview]) {
    assert.match(source, /ONBOARDING_STEP_SLIDE_TIMING\.durationMs/);
    assert.match(source, /ONBOARDING_STEP_SLIDE_TIMING\.fadeDurationMs/);
    assert.match(source, /ONBOARDING_STEP_SLIDE_TIMING\.distancePct/);
    assert.match(source, /ONBOARDING_STEP_SLIDE_TIMING\.scaleFrom/);
    assert.doesNotMatch(source, /durationMs=\{420\}/);
    assert.doesNotMatch(source, /fadeDurationMs=\{420\}/);
    assert.doesNotMatch(source, /distancePctOverride=\{0\.018\}/);
  }
});

test('shared chrome and footer transitions avoid local handoff duration literals', () => {
  const chrome = read('components/onboarding/flow/OnboardingChrome.tsx');
  const footer = read('components/onboarding/flow/OnboardingFooter.tsx');

  assert.match(chrome, /ONBOARDING_CHROME_PROGRESS_DURATION_MS/);
  assert.match(footer, /ONBOARDING_FOOTER_TRANSITION_DURATION_MS/);
  assert.doesNotMatch(chrome, /duration:\s*420/);
  assert.doesNotMatch(footer, /duration:\s*380/);
});

test('shared shell config is scoped to the active flow step', () => {
  const host = read('components/onboarding/flow/OnboardingFlowHost.tsx');

  assert.match(host, /type SharedShellConfigEntry/);
  assert.match(host, /step:\s*OnboardingFlowStep/);
  assert.match(host, /sharedShellConfigEntry\?\.step === activeStep/);
  assert.match(host, /registerSharedShellConfig\(step, config\)/);
  assert.doesNotMatch(host, /const effectiveShellConfig = sharedShellConfig \?\?/);
});
