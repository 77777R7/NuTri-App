import assert from 'node:assert/strict';
import test from 'node:test';

import { evaluateSavedProducts } from './core/savedProductEvaluation';

test('evaluateSavedProducts keeps partial and none facts products out of coverage-ready match maps', () => {
  const result = evaluateSavedProducts({
    prioritizedGoals: ['immunity', 'sleep'],
    savedProducts: {
      ready: {
        productId: 'ready',
        factsStatus: 'full',
        productGoalMatches: [
          { goalKey: 'immunity', score: 91, tier: 'strong_match', reasons: [], caps: [] },
        ],
        eligibility: {
          eligible: true,
          rankEligible: true,
          caps: [],
          reasons: [],
        },
      },
      partial: {
        productId: 'partial',
        factsStatus: 'partial',
        productGoalMatches: [
          { goalKey: 'immunity', score: 93, tier: 'strong_match', reasons: [], caps: [] },
        ],
      },
      none: {
        productId: 'none',
        factsStatus: 'none',
      },
    },
  });

  assert.deepEqual(Object.keys(result.productGoalMatches), ['ready']);
  assert.deepEqual(Object.keys(result.eligibility), ['ready']);
  assert.equal(result.savedProductEvaluations.ready.smartFilterMembership.bucket, 'strong_match');
  assert.equal(
    result.savedProductEvaluations.partial.smartFilterMembership.bucket,
    'not_enough_structured_data',
  );
  assert.equal(
    result.savedProductEvaluations.none.smartFilterMembership.bucket,
    'not_enough_structured_data',
  );
  assert.equal(result.savedProductEvaluations.partial.firstStackEligible, false);
  assert.equal(result.savedProductEvaluations.none.firstStackEligible, false);
});

test('evaluateSavedProducts preserves relevance/eligibility separation for coverage-ready saved products', () => {
  const result = evaluateSavedProducts({
    prioritizedGoals: ['energy'],
    savedProducts: {
      guarded: {
        productId: 'guarded',
        factsStatus: 'full',
        productGoalMatches: [
          { goalKey: 'energy', score: 76, tier: 'related', reasons: [], caps: [] },
        ],
        eligibility: {
          eligible: true,
          rankEligible: false,
          caps: ['duplicate_overlap_high'],
          reasons: [],
        },
      },
    },
  });

  assert.equal(result.savedProductEvaluations.guarded.smartFilterMembership.bucket, 'related');
  assert.equal(result.savedProductEvaluations.guarded.smartFilterMembership.eligibility?.rankEligible, false);
  assert.equal(result.savedProductEvaluations.guarded.firstStackEligible, false);
});
