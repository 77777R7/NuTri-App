import assert from 'node:assert/strict';
import test from 'node:test';

import { compileExperienceMode } from './core/experienceStrategy';
import { resolvePersonalizationProfile } from './core/profileResolver';

test('compileExperienceMode keeps brand-new users in simple explanation mode', () => {
  const profile = resolvePersonalizationProfile({
    declared: {
      goals: [{ key: 'sleep', priority: 80 }],
      supplementExperience: 'brand_new',
    },
  });

  const result = compileExperienceMode(profile);

  assert.deepEqual(result.mode, {
    explanationDepth: 'simple',
    uiDensity: 'minimal',
    showAdvancedSafety: false,
    showDetailedForms: false,
  });
});

test('compileExperienceMode promotes large observed stacks into advanced mode even without declared experience', () => {
  const profile = resolvePersonalizationProfile({
    declared: {
      goals: [{ key: 'focus', priority: 70 }],
    },
    observed: {
      savedStackCount: 5,
    },
  });

  const result = compileExperienceMode(profile);

  assert.deepEqual(result.mode, {
    explanationDepth: 'advanced',
    uiDensity: 'advanced',
    showAdvancedSafety: true,
    showDetailedForms: true,
  });
  assert.ok(result.reasons.some((reason) => reason.code === 'personalization.experience_mode.observed_stack'));
});
