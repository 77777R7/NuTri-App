import assert from 'node:assert/strict';
import test from 'node:test';

import type { ProductGoalMatch } from '../../types/personalization';
import { evaluateEligibilityPolicy } from './core/eligibilityPolicy';

const relatedEnergyMatch: ProductGoalMatch = {
  goalKey: 'energy',
  score: 71,
  tier: 'related',
  reasons: [],
};

test('evaluateEligibilityPolicy keeps relevance separate from eligibility when only weak matches are present', () => {
  const decision = evaluateEligibilityPolicy({
    productGoalMatches: [
      {
        goalKey: 'focus',
        score: 32,
        tier: 'weak_match',
        reasons: [],
      },
    ],
  });

  assert.equal(decision.eligible, true);
  assert.equal(decision.rankEligible, true);
  assert.deepEqual(decision.caps, []);
  assert.deepEqual(decision.reasons, []);
});

test('evaluateEligibilityPolicy downgrades ranking when duplicate overlap is high', () => {
  const decision = evaluateEligibilityPolicy({
    productGoalMatches: [relatedEnergyMatch],
    duplicateRisk: {
      level: 'high',
      ingredientKeys: ['vitamin_b12'],
    },
  });

  assert.equal(decision.eligible, true);
  assert.equal(decision.rankEligible, false);
  assert.ok(decision.caps.includes('duplicate_overlap_high'));
  assert.ok(decision.reasons.some((reason) => reason.code === 'duplicate_overlap_downgrade'));
});

test('evaluateEligibilityPolicy marks diet conflicts as ineligible and preserves safety-path caps', () => {
  const decision = evaluateEligibilityPolicy({
    productGoalMatches: [
      {
        ...relatedEnergyMatch,
        caps: ['generic_safety_path'],
      },
    ],
    hasDietConstraintConflict: true,
  });

  assert.equal(decision.eligible, false);
  assert.equal(decision.rankEligible, false);
  assert.deepEqual(decision.caps, ['generic_safety_path', 'diet_constraint_conflict']);
  assert.ok(decision.reasons.some((reason) => reason.code === 'diet_constraint_exclusion'));
  assert.ok(decision.reasons.some((reason) => reason.code === 'ingredient_requires_generic_safety_path'));
});

test('evaluateEligibilityPolicy preserves disclosure caps without converting them into eligibility failures', () => {
  const decision = evaluateEligibilityPolicy({
    productGoalMatches: [
      {
        ...relatedEnergyMatch,
        caps: ['low_disclosure', 'proprietary_blend'],
      },
    ],
  });

  assert.equal(decision.eligible, true);
  assert.equal(decision.rankEligible, true);
  assert.deepEqual(decision.caps, ['low_disclosure', 'proprietary_blend']);
  assert.ok(decision.reasons.some((reason) => reason.code === 'low_disclosure_caps_strong_match'));
  assert.ok(decision.reasons.some((reason) => reason.code === 'proprietary_blend_caps_goal_match'));
});

test('evaluateEligibilityPolicy can add generic safety caps directly when scoring output is unavailable', () => {
  const decision = evaluateEligibilityPolicy({
    requiresGenericSafetyPath: true,
  });

  assert.equal(decision.eligible, true);
  assert.equal(decision.rankEligible, true);
  assert.deepEqual(decision.caps, ['generic_safety_path']);
  assert.ok(decision.reasons.some((reason) => reason.code === 'ingredient_requires_generic_safety_path'));
});
