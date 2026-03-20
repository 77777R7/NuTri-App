import assert from 'node:assert/strict';
import test from 'node:test';

import type { PlanPreviewPersonalizationVM } from '@/types/personalization';
import { buildBlockerStrategySummary, buildPlanPreviewSummary } from './uiLabels';

test('buildBlockerStrategySummary makes explanation-first blockers explicit', () => {
  assert.equal(
    buildBlockerStrategySummary({
      primarySupportFocus: 'explanation',
      reminderPriority: 'medium',
      scheduleComplexity: 'simple',
      notificationBudget: 'standard',
      emphasizeHomeCheckIn: false,
      emphasizeScheduleSetup: false,
      emphasizeExplanation: true,
    }),
    'We will first clarify which supplements fit your goals before asking you to set up reminders or a routine.',
  );
});

test('buildPlanPreviewSummary foregrounds fit clarity before timing when explanation-first', () => {
  const surface: PlanPreviewPersonalizationVM = {
    goals: ['immunity'],
    types: ['vitamin'],
    blockerStrategy: {
      primarySupportFocus: 'explanation',
      reminderPriority: 'medium',
      scheduleComplexity: 'simple',
      notificationBudget: 'standard',
      emphasizeHomeCheckIn: false,
      emphasizeScheduleSetup: false,
      emphasizeExplanation: true,
    },
    dietLanes: [],
    activityAnchors: ['breakfast'],
    reasons: [],
  };

  assert.equal(
    buildPlanPreviewSummary(surface),
    'We will start by showing which supplements best fit Immunity before we ask you to set up a routine.',
  );
});
