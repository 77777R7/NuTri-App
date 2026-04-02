import assert from 'node:assert/strict';
import test from 'node:test';

import {
  appendPersonalizationEventsToSummary,
  createEmptyPersonalizationEventSummary,
  summarizePersonalizationEvents,
} from '@/lib/personalization/feedback/personalizationEventSummary';

test('summarizePersonalizationEvents groups counts and preserves newest event', () => {
  const summary = summarizePersonalizationEvents(
    [
      {
        event_name: 'compare_opened',
        surface: 'goal_navigator',
        created_at: '2026-03-21T22:00:00.000Z',
        snapshot_id: 'psn_new',
        rules_version: 'rules-v1',
        support_state: 'choose',
      },
      {
        event_name: 'goal_fit_detail_opened',
        surface: 'my_saved',
        created_at: '2026-03-21T21:30:00.000Z',
        snapshot_id: 'psn_old',
        rules_version: 'rules-v1',
        support_state: 'choose',
      },
    ],
    7,
  );

  assert.equal(summary.totalCount, 7);
  assert.equal(summary.lastEventAt, '2026-03-21T22:00:00.000Z');
  assert.equal(summary.countsByEventName.compare_opened, 1);
  assert.equal(summary.countsBySurface.goal_navigator, 1);
  assert.equal(summary.recentEvents[0]?.snapshotId, 'psn_new');
});

test('appendPersonalizationEventsToSummary increments counts and prepends recent events', () => {
  const initial = createEmptyPersonalizationEventSummary();
  const summary = appendPersonalizationEventsToSummary(
    initial,
    [
      {
        eventName: 'goal_navigator_opened',
        surface: 'goal_navigator',
        snapshotId: 'psn_1',
        rulesVersion: 'rules-v1',
        supportState: 'explore',
      },
      {
        eventName: 'compare_opened',
        surface: 'goal_navigator',
        snapshotId: 'psn_1',
        rulesVersion: 'rules-v1',
        supportState: 'choose',
      },
    ],
    '2026-03-21T22:15:00.000Z',
  );

  assert.equal(summary.totalCount, 2);
  assert.equal(summary.countsByEventName.goal_navigator_opened, 1);
  assert.equal(summary.countsByEventName.compare_opened, 1);
  assert.equal(summary.countsBySurface.goal_navigator, 2);
  assert.equal(summary.recentEvents[0]?.eventName, 'goal_navigator_opened');
  assert.equal(summary.recentEvents[1]?.eventName, 'compare_opened');
});
