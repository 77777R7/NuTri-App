import assert from 'node:assert/strict';
import test from 'node:test';

import {
  buildWaitlistTrialSummary,
  computeWaitlistBonusDays,
  computeWaitlistTotalTrialDays,
  isWaitlistTrialActive,
} from '../../lib/pro/waitlistTrialBonus.ts';

test('waitlist referral bonus follows the launch ladder', () => {
  assert.equal(computeWaitlistBonusDays(0), 0);
  assert.equal(computeWaitlistBonusDays(1), 1);
  assert.equal(computeWaitlistBonusDays(2), 2);
  assert.equal(computeWaitlistBonusDays(3), 4);
  assert.equal(computeWaitlistBonusDays(12), 4);

  assert.equal(computeWaitlistTotalTrialDays(0), 3);
  assert.equal(computeWaitlistTotalTrialDays(1), 4);
  assert.equal(computeWaitlistTotalTrialDays(2), 5);
  assert.equal(computeWaitlistTotalTrialDays(3), 7);
});

test('waitlist trial active check uses expiration time', () => {
  const now = new Date('2026-05-13T00:00:00Z');
  assert.equal(isWaitlistTrialActive('2026-05-13T00:00:01Z', now), true);
  assert.equal(isWaitlistTrialActive('2026-05-12T23:59:59Z', now), false);
  assert.equal(isWaitlistTrialActive(null, now), false);
});

test('waitlist trial summary distinguishes base and invite bonus days', () => {
  assert.equal(
    buildWaitlistTrialSummary({ bonusDays: 0, totalTrialDays: 3 }),
    '3-day starting trial',
  );
  assert.equal(
    buildWaitlistTrialSummary({ bonusDays: 4, totalTrialDays: 7 }),
    '3-day trial + 4 waitlist bonus days',
  );
});
