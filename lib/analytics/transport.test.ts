import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  analyticsTransportInternals,
  emitAnalyticsEvent,
} from '@/lib/analytics/transport';

test('emitAnalyticsEvent sanitizes undefined payload fields before transport', () => {
  const calls: Array<{ namespace: string; event: string; payload: Record<string, unknown> }> = [];

  emitAnalyticsEvent(
    'onboarding',
    'question_answered',
    {
      question: 'goals',
      answer: 'sleep',
      ignored: undefined,
    },
    (namespace, event, payload) => {
      calls.push({ namespace, event, payload });
    },
  );

  assert.deepEqual(calls, [
    {
      namespace: 'onboarding',
      event: 'question_answered',
      payload: {
        question: 'goals',
        answer: 'sleep',
      },
    },
  ]);
});

test('sanitizePayload keeps falsey but defined values', () => {
  assert.deepEqual(
    analyticsTransportInternals.sanitizePayload({
      count: 0,
      accepted: false,
      empty: '',
      skipped: undefined,
    }),
    {
      count: 0,
      accepted: false,
      empty: '',
    },
  );
});
