import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';

test('my supplement smart filter consumes evaluated membership without regressing local filters', () => {
  const filePath = path.resolve(process.cwd(), 'components/screens/MySupplement.tsx');
  const source = fs.readFileSync(filePath, 'utf8');

  assert.match(source, /smartFilterMembershipById/);
  assert.match(source, /smartFilterEvaluationLoading/);
  assert.match(source, /matchesEvaluatedSmartFilterTag/);
  assert.match(source, /filterSupplementsByActiveTags/);
  assert.match(source, /tag === "Recently Viewed"/);
  assert.match(source, /item\.tags\?\.some\(\(itemTag\) => itemTag === tag\)/);
  assert.match(source, /membershipById:\s*smartFilterMembershipById/);
  assert.match(source, /if \(smartFilterEvaluationLoading\) return;/);
  assert.match(source, /trackSmartFilterEvaluatedEvent/);
  assert.match(source, /trackEvaluatedLoopExposure/);
  assert.match(source, /trackEvaluatedLoopClick/);
  assert.match(source, /trackEvaluatedLoopSave/);
  assert.match(source, /trackEvaluatedLoopConversion/);
  assert.match(source, /smart_filter_evaluated_results_exposed/);
  assert.match(source, /smart_filter_evaluated_tag_toggled/);
  assert.match(source, /smart_filter_evaluated_result_opened/);
  assert.match(source, /smart_filter_evaluated_schedule_saved/);
  assert.match(source, /smart_filter_evaluated_batch_schedule_applied/);
  assert.match(source, /smartFilterAnalyticsContext=\{detailAnalyticsContext\}/);
  assert.equal(source.includes('const hasMatchingStaticTag = s.tags && s.tags.some((tag) => activeTags.has(tag));'), false);
});
