import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';

const DASHBOARD_FILE = path.join(process.cwd(), 'components/scan/AnalysisDashboard.tsx');
const RESULT_FILE = path.join(process.cwd(), 'app/scan/result.tsx');
const MOBILE_SOAK_RUN_FILE = path.join(process.cwd(), 'scripts/maintainer/mobile-soak-run.mjs');

test('score ring meta lines guard against scored-state contradiction copy', () => {
  const source = fs.readFileSync(DASHBOARD_FILE, 'utf8');

  assert.ok(source.includes('const scoreMetaBlockedReasons = new Set<string>(['));
  assert.ok(source.includes('buildSafetySignalPack({'));
  assert.ok(source.includes('safetySignalsToPriorityLines(safetySignalPack)'));
  assert.ok(source.includes('t.analysisScoreNotScoredReasonUnavailable'));
  assert.ok(source.includes('t.analysisScoreNotScoredReasonPendingTimeout'));
  assert.ok(source.includes('t.analysisScoreNotScoredReasonRequestFailed'));
  assert.ok(source.includes('t.analysisScoreRetryCta'));
  assert.ok(source.includes('t.analysisScoreScoringReason'));
  assert.ok(source.includes('const scorePendingAfterDone ='));
  assert.ok(source.includes('const scoreRequestFailed = scoreBundleV4State?.status === \'error\';'));
  assert.ok(source.includes('SCORE_PENDING_DONE_TIMEOUT_MS'));
  assert.ok(source.includes("scoreUiMode === 'scored'"));
  assert.ok(source.includes('ringMetaLinesRaw.filter((line) => !scoreMetaBlockedReasons.has(line))'));
  assert.ok(!source.includes('bundleState.meta.scoreAvailable === false ||'));
  assert.ok(source.includes('resolveReasonCodeMessage(scoreReasonCode)'));
  assert.ok(source.includes('scoreNotScoredCause === \'pending_timeout_after_done\''));
  assert.ok(source.includes('scoreNotScoredCause === \'score_request_failed\''));
  assert.ok(source.includes('scoreReasonMessage || t.analysisScoreNotScoredReasonUnavailable'));
  assert.ok(source.includes("scoreBundleV4State?.status === 'idle'"));
  const scoredPriorityIdx = source.indexOf("v4Response?.status === 'ok'");
  const eligibilityGateIdx = source.indexOf("(!bundleScoreEligible && !isStreaming)");
  assert.ok(scoredPriorityIdx >= 0, 'missing scored-priority gate');
  assert.ok(eligibilityGateIdx >= 0, 'missing bundle eligibility gate');
  assert.ok(
    scoredPriorityIdx < eligibilityGateIdx,
    'scored-priority gate must be evaluated before bundle eligibility gate',
  );

  const resultSource = fs.readFileSync(RESULT_FILE, 'utf8');
  assert.ok(!resultSource.includes('if (meta.scoreAvailable === false) return null;'));

  const soakSource = fs.readFileSync(MOBILE_SOAK_RUN_FILE, 'utf8');
  assert.ok(!soakSource.includes('if (meta.scoreAvailable === false) return null;'));
  assert.ok(soakSource.includes('const revisionReady = typeof meta.revision !== "number" || meta.revision >= 1;'));
  assert.ok(soakSource.includes('if (authoritativeType === "npn" && authoritativeValue) {'));
  assert.ok(soakSource.includes('if (authoritativeType === "dsldLabelId" && authoritativeValue) {'));
  assert.ok(soakSource.includes('sourceType === "lnhpd"'));
  assert.ok(soakSource.includes('sourceType === "dsld"'));
  assert.ok(soakSource.includes('fallbackReason.includes("needs_js")'));
  assert.ok(soakSource.includes('fallbackReason.includes("ownership_unverified")'));
  assert.ok(soakSource.includes('fallbackReason.includes("web_text_unusable")'));
  assert.ok(soakSource.includes('scoreResponseStatus: "not_initiated"'));
  assert.ok(soakSource.includes('scoreQueryInitiated: false'));
});
