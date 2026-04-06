import assert from 'node:assert/strict';
import test from 'node:test';

import { buildGoalStackAdjustments } from '@/lib/personalization/core/goalStackAdjustments';

test('goal stack adjustments lower marginal value when an overlapping ingredient already covers the same lane', () => {
  const [recoveryAdjustment] = buildGoalStackAdjustments({
    goalCoverage: [
      {
        goalKey: 'recovery',
        state: 'some',
        score: 78,
      },
    ],
    overlapContext: {
      savedStackCount: 2,
      overlapCount: 1,
      overlaps: [
        {
          ingredientKey: 'omega-3',
          ingredientDisplay: 'Omega-3',
          count: 2,
        },
      ],
    },
  });

  assert.ok(recoveryAdjustment);
  assert.equal(recoveryAdjustment.stackContextImpact, 'negative');
  assert.equal(recoveryAdjustment.marginalValue, 'medium');
  assert.ok(recoveryAdjustment.adjustedScore < 78);
  assert.ok(recoveryAdjustment.reasonCodes.some((code) => code.includes('overlap_reduces_marginal_value')));
  assert.match(recoveryAdjustment.summary ?? '', /Omega-3/i);
  assert.match(recoveryAdjustment.action?.[0] ?? '', /overlap/i);
});

test('goal stack adjustments can mark a positive lane as additive when the saved stack has no relevant overlap', () => {
  const [immunityAdjustment] = buildGoalStackAdjustments({
    goalCoverage: [
      {
        goalKey: 'immunity',
        state: 'strong',
        score: 92,
      },
    ],
    overlapContext: {
      savedStackCount: 2,
      overlapCount: 1,
      overlaps: [
        {
          ingredientKey: 'magnesium',
          ingredientDisplay: 'Magnesium',
          count: 2,
        },
      ],
    },
  });

  assert.ok(immunityAdjustment);
  assert.equal(immunityAdjustment.stackContextImpact, 'positive');
  assert.equal(immunityAdjustment.marginalValue, 'high');
  assert.ok(immunityAdjustment.adjustedScore >= 92);
  assert.ok(immunityAdjustment.reasonCodes.some((code) => code.includes('low_overlap_additive_lane')));
  assert.match(immunityAdjustment.summary ?? '', /additive/i);
});
