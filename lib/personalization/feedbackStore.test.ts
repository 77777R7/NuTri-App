import assert from 'node:assert/strict';
import test from 'node:test';

import { createEmptyFeedbackState } from '@/lib/storage/personalization-feedback';
import type { OverrideEvent } from '@/types/personalization';
import {
  createFeedbackMemoryAdapter,
  loadFeedbackState,
  recordFeedbackEvents,
} from './feedback/feedbackStore';

const event = (overrides: Partial<OverrideEvent>): OverrideEvent => ({
  id: overrides.id ?? `event_${Math.random().toString(36).slice(2, 8)}`,
  userId: overrides.userId ?? 'user_1',
  timestamp: overrides.timestamp ?? '2026-03-18T18:00:00.000Z',
  source: 'user',
  surface: overrides.surface ?? 'schedule_defaults',
  action: overrides.action ?? 'set',
  field: overrides.field ?? 'reminderPriority',
  value: overrides.value,
});

test('feedbackStore persists overrides per user and restores them on second visit', async () => {
  const adapter = createFeedbackMemoryAdapter();

  await recordFeedbackEvents(
    'user_1',
    [
      event({
        field: 'reminderPriority',
        value: 'low',
      }),
      event({
        field: 'suggestedTimingAnchors',
        value: ['dinner'],
      }),
    ],
    adapter,
  );

  const restored = await loadFeedbackState('user_1', adapter);
  assert.equal(restored.overrides.scheduleDefaults?.reminderPriority, 'low');
  assert.deepEqual(restored.overrides.scheduleDefaults?.suggestedTimingAnchors, ['dinner']);
});

test('feedbackStore keeps different users isolated', async () => {
  const adapter = createFeedbackMemoryAdapter({
    user_a: createEmptyFeedbackState('2026-03-18T18:05:00.000Z'),
  });

  await recordFeedbackEvents(
    'user_b',
    [event({ userId: 'user_b', field: 'highlightedGoal', surface: 'smart_filter', value: 'immunity' })],
    adapter,
  );

  const userA = await loadFeedbackState('user_a', adapter);
  const userB = await loadFeedbackState('user_b', adapter);

  assert.equal(userA.events.length, 0);
  assert.equal(userB.overrides.smartFilter?.highlightedGoal, 'immunity');
});

test('feedbackStore tracks dismiss and accept signals for first stack', async () => {
  const adapter = createFeedbackMemoryAdapter();

  const next = await recordFeedbackEvents(
    'user_1',
    [
      event({
        surface: 'first_stack',
        action: 'dismiss',
        field: 'product',
        value: 'omega3_product',
      }),
      event({
        surface: 'first_stack',
        action: 'accept',
        field: 'product',
        value: 'magnesium_product',
      }),
    ],
    adapter,
  );

  assert.deepEqual(next.overrides.firstStack?.dismissedProductIds, ['omega3_product']);
  assert.deepEqual(next.overrides.firstStack?.acceptedProductIds, ['magnesium_product']);
  assert.deepEqual(next.dismissals.first_stack ?? [], []);
});
