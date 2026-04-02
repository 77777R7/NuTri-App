import assert from 'node:assert/strict';
import test from 'node:test';

import type { OverrideEvent } from '@/types/personalization';
import { derivePersonalizationEventsFromOverrideEvents } from './feedback/personalizationEvents';

const event = (overrides: Partial<OverrideEvent>): OverrideEvent => ({
  id: overrides.id ?? `event_${Math.random().toString(36).slice(2, 8)}`,
  userId: overrides.userId ?? 'user_1',
  timestamp: overrides.timestamp ?? '2026-03-21T19:00:00.000Z',
  source: 'user',
  surface: overrides.surface ?? 'personalization_controls',
  action: overrides.action ?? 'set',
  field: overrides.field ?? 'decisionMode',
  value: overrides.value,
});

test('derivePersonalizationEventsFromOverrideEvents logs control selections and reminder attenuation', () => {
  const drafts = derivePersonalizationEventsFromOverrideEvents([
    event({
      field: 'notificationTolerance',
      value: 'low',
    }),
  ]);

  assert.equal(drafts.length, 2);
  assert.equal(drafts[0]?.eventName, 'control_selected');
  assert.equal(drafts[1]?.eventName, 'reminder_disabled');
});

test('derivePersonalizationEventsFromOverrideEvents groups schedule edits into one event', () => {
  const drafts = derivePersonalizationEventsFromOverrideEvents([
    event({
      surface: 'schedule_defaults',
      field: 'suggestedTimingAnchors',
      value: ['dinner'],
    }),
    event({
      surface: 'schedule_defaults',
      field: 'preferScheduleSetup',
      value: true,
    }),
  ]);

  assert.equal(drafts.length, 1);
  assert.equal(drafts[0]?.eventName, 'schedule_edited');
  assert.deepEqual(drafts[0]?.payload?.fields, ['suggestedTimingAnchors', 'preferScheduleSetup']);
});
