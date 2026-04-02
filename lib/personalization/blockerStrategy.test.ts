import assert from 'node:assert/strict';
import test from 'node:test';

import { compileBlockerStrategy } from './core/blockerStrategy';
import { resolvePersonalizationProfile } from './core/profileResolver';

test('compileBlockerStrategy overlays high reminder priority for low consistency users', () => {
  const profile = resolvePersonalizationProfile({
    declared: {
      goals: [{ key: 'energy', priority: 80 }],
      adherenceBlocker: 'goal_fit_uncertainty',
    },
    observed: {
      consistencyLevel: 'low',
      savedStackCount: 0,
    },
  });

  const result = compileBlockerStrategy(profile);

  assert.deepEqual(result.strategy, {
    primarySupportFocus: 'explanation',
    reminderPriority: 'high',
    scheduleComplexity: 'simple',
    notificationBudget: 'standard',
    emphasizeHomeCheckIn: true,
    emphasizeScheduleSetup: false,
    emphasizeExplanation: true,
  });
  assert.ok(result.reasons.some((reason) => reason.code === 'personalization.blocker_strategy.consistency_overlay'));
});

test('compileBlockerStrategy upgrades schedule setup emphasis for larger observed stacks', () => {
  const profile = resolvePersonalizationProfile({
    declared: {
      goals: [{ key: 'recovery', priority: 100 }],
      adherenceBlocker: 'already_consistent',
    },
    observed: {
      consistencyLevel: 'high',
      savedStackCount: 6,
    },
  });

  const result = compileBlockerStrategy(profile);

  assert.equal(result.strategy.scheduleComplexity, 'advanced');
  assert.equal(result.strategy.primarySupportFocus, 'optimization');
  assert.equal(result.strategy.emphasizeScheduleSetup, true);
  assert.ok(result.reasons.some((reason) => reason.code === 'personalization.blocker_strategy.stack_overlay'));
});
