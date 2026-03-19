import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  evaluatedLoopAnalyticsInternals,
  trackEvaluatedLoopClick,
  trackEvaluatedLoopConversion,
  trackEvaluatedLoopExposure,
  trackEvaluatedLoopSave,
} from '@/lib/analytics/evaluated-loop';

test('trackEvaluatedLoopExposure emits a structured exposure payload', () => {
  const calls: Array<{ namespace: string; event: string; payload: Record<string, unknown> }> = [];

  trackEvaluatedLoopExposure(
    {
      surface: 'smart_filter',
      snapshotId: 'psn_123',
      rulesVersion: 'personalization-rules/v1',
      goalKey: 'sleep',
      coverageStatus: 'coverage_ready',
      selectedCount: 12,
      source: 'auto',
      reasonCodes: ['goal_supported_by_ingredient', 'goal_supported_by_ingredient'],
    },
    (namespace, event, payload) => {
      calls.push({ namespace, event, payload });
    },
  );

  assert.deepEqual(calls, [
    {
      namespace: 'evaluated-loop',
      event: 'evaluated_loop_exposure',
      payload: {
        surface: 'smart_filter',
        snapshotId: 'psn_123',
        rulesVersion: 'personalization-rules/v1',
        goalKey: 'sleep',
        coverageStatus: 'coverage_ready',
        selectedCount: 12,
        source: 'auto',
        reasonCodes: ['goal_supported_by_ingredient'],
      },
    },
  ]);
});

test('trackEvaluatedLoopClick preserves click-specific fields', () => {
  const calls: Array<{ event: string; payload: Record<string, unknown> }> = [];

  trackEvaluatedLoopClick(
    {
      surface: 'smart_filter',
      snapshotId: 'psn_456',
      rulesVersion: 'personalization-rules/v1',
      productId: 'prod_sleep_1',
      position: 2,
      matchTier: 'strong_match',
      coverageStatus: 'coverage_ready',
    },
    (_namespace, event, payload) => {
      calls.push({ event, payload });
    },
  );

  assert.equal(calls[0]?.event, 'evaluated_loop_click');
  assert.equal(calls[0]?.payload.productId, 'prod_sleep_1');
  assert.equal(calls[0]?.payload.position, 2);
  assert.equal(calls[0]?.payload.matchTier, 'strong_match');
});

test('trackEvaluatedLoopSave and conversion support downstream funnel instrumentation', () => {
  const events: string[] = [];

  trackEvaluatedLoopSave(
    {
      surface: 'first_stack',
      snapshotId: 'psn_save',
      rulesVersion: 'personalization-rules/v1',
      productId: 'prod_foundation_1',
      matchTier: 'related',
      coverageStatus: 'coverage_ready',
    },
    (_namespace, event) => {
      events.push(event);
    },
  );

  trackEvaluatedLoopConversion(
    {
      surface: 'first_stack',
      snapshotId: 'psn_save',
      rulesVersion: 'personalization-rules/v1',
      conversionType: 'first_stack_accepted',
      productId: 'prod_foundation_1',
      source: 'user',
    },
    (_namespace, event) => {
      events.push(event);
    },
  );

  assert.deepEqual(events, [
    'evaluated_loop_save',
    'evaluated_loop_conversion',
  ]);
});

test('buildPayload keeps payload local and dedupes reason codes only', () => {
  assert.deepEqual(
    evaluatedLoopAnalyticsInternals.buildPayload({
      surface: 'plan_preview',
      snapshotId: 'psn_plan',
      rulesVersion: 'personalization-rules/v1',
      source: 'auto',
      reasonCodes: ['a', 'b', 'a', '  '],
    }),
    {
      surface: 'plan_preview',
      snapshotId: 'psn_plan',
      rulesVersion: 'personalization-rules/v1',
      source: 'auto',
      reasonCodes: ['a', 'b'],
    },
  );
});
