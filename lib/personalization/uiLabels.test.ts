import assert from 'node:assert/strict';
import test from 'node:test';

import type { PersonalizationEventSummary, PlanPreviewPersonalizationVM } from '@/types/personalization';
import {
  buildBlockerStrategySummary,
  buildHomeSupportSurface,
  buildPlanPreviewSummary,
  buildScheduleDefaultsSummary,
  buildUserSupportSurface,
  getReminderPriorityLabel,
} from './uiLabels';

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

test('buildUserSupportSurface collapses choose-like states into help me choose', () => {
  const eventSummary: PersonalizationEventSummary = {
    totalCount: 3,
    lastEventAt: null,
    countsByEventName: {
      goal_navigator_opened: 1,
      compare_opened: 1,
      goal_fit_detail_opened: 1,
    },
    countsBySurface: {},
    recentEvents: [],
  };

  const result = buildUserSupportSurface({
    supportState: 'choose',
    goalLabel: 'Sleep',
    scheduleDefaults: {
      reminderPriority: 'medium',
      suggestedTimingAnchors: ['bedtime'],
      preferScheduleSetup: false,
      reasons: [],
    },
    eventSummary,
  });

  assert.equal(result.mode, 'help_me_choose');
  assert.equal(result.title, 'Help me choose');
  assert.match(result.body, /See differences/);
});

test('buildHomeSupportSurface turns stay-on-track empty states into a single specific next step', () => {
  const result = buildHomeSupportSurface({
    supportState: 'install',
    goalLabel: 'Sleep',
    scheduleDefaults: {
      reminderPriority: 'high',
      suggestedTimingAnchors: ['bedtime'],
      preferScheduleSetup: true,
      reasons: [],
    },
    hasSavedSupplements: false,
  });

  assert.equal(result.mode, 'stay_on_track');
  assert.equal(result.title, 'Stay on track');
  assert.equal(
    result.body,
    'Add your first supplement to set one simple bedtime reminder for Sleep.',
  );
});

test('buildScheduleDefaultsSummary keeps reminder guidance short and specific', () => {
  assert.equal(
    buildScheduleDefaultsSummary({
      reminderPriority: 'high',
      suggestedTimingAnchors: ['breakfast'],
      preferScheduleSetup: true,
      reasons: [],
    }),
    'Set this now and use breakfast as the anchor.',
  );
  assert.equal(getReminderPriorityLabel('low'), 'Fewer nudges');
});
