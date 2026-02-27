import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';

const SOAK_RUN_FILE = path.join(process.cwd(), 'scripts/maintainer/mobile-soak-run.mjs');

test('mobile soak run emits score_not_found_targeted diagnostics only for targeted subset', () => {
  const source = fs.readFileSync(SOAK_RUN_FILE, 'utf8');

  assert.ok(source.includes('const scoreNotFoundTargeted ='));
  assert.ok(source.includes('scoreProbe?.scoreResponseStatus'));
  assert.ok(source.includes('ingredientCount >= 1'));
  assert.ok(source.includes('doseCount >= 1'));
  assert.ok(source.includes('const fetchFactsProbe = async ({ source, sourceId }) => {'));
  assert.ok(source.includes('facts_present_score_index_missing'));
  assert.ok(source.includes('source_id_mapping_issue_or_missing_facts'));
  assert.ok(source.includes('const buildScoreNotFoundTargetedDiagnostics = ({ attempts, summaryPath }) => {'));
  assert.ok(source.includes('.filter((row) => row?.scoreNotFoundTargeted === true)'));
  assert.ok(source.includes('score_not_found_targeted.json'));
  assert.ok(source.includes('scoreNotFoundTargetedCount'));
  assert.ok(source.includes('scoreNotFoundTargetedByReason'));
});
