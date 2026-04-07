import assert from 'node:assert/strict';
import test from 'node:test';

import { evaluateProductCoverageGate } from './core/productEvaluationGate';

test('evaluateProductCoverageGate only marks full factsStatus as coverage_ready', () => {
  assert.deepEqual(evaluateProductCoverageGate({ factsStatus: 'full' }), {
    factsStatus: 'full',
    status: 'coverage_ready',
    reasons: [
      {
        code: 'personalization.product_evaluation.coverage_ready',
        ruleId: 'personalization.evaluation.coverage_gate',
        source: 'derived',
        params: { factsStatus: 'full' },
      },
    ],
  });

  assert.equal(
    evaluateProductCoverageGate({ factsStatus: 'partial' }).status,
    'not_enough_structured_data',
  );
  assert.equal(
    evaluateProductCoverageGate({ factsStatus: 'none' }).status,
    'not_enough_structured_data',
  );
});

test('evaluateProductCoverageGate blocks goal scoring for out-of-scope non-supplement products', () => {
  const result = evaluateProductCoverageGate({
    factsStatus: 'full',
    goalScoringBlockedReason: 'out_of_scope_non_supplement',
  });

  assert.equal(result.status, 'not_enough_structured_data');
  assert.equal(result.reasons[0]?.code, 'personalization.product_evaluation.out_of_scope_non_supplement');
});
