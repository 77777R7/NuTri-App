import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';

const SOAK_RUN_FILE = path.join(process.cwd(), 'scripts/maintainer/mobile-soak-run.mjs');

test('mobile soak run classifies timeout class and supports health preflight lane', () => {
  const source = fs.readFileSync(SOAK_RUN_FILE, 'utf8');

  assert.ok(source.includes('const HEALTH_PREFLIGHT_ENABLED = !["0", "false", "off"].includes('));
  assert.ok(source.includes('const HEALTHCHECK_TIMEOUT_MS = Math.max('));
  assert.ok(source.includes('const HEALTHCHECK_URL = arg("--health-url"'));

  assert.ok(source.includes('const runHealthPreflight = async () => {'));
  assert.ok(source.includes('terminalReason: healthReason'));
  assert.ok(source.includes('errorCode: "INFRA_UNAVAILABLE_HEALTHCHECK"'));
  assert.ok(source.includes('infraUnavailable: true'));

  assert.ok(source.includes('const classifyTimeoutClass = ({ terminalReason, requestError, sseConnected, sseEventCount, doneSeen }) => {'));
  assert.ok(source.includes('return connectError ? "SSE_CONNECT_FAILED" : "SSE_CONNECTED_BUT_NO_DONE";'));
  assert.ok(source.includes('const timeoutClass = classifyTimeoutClass({'));

  assert.ok(source.includes('const timeoutClassCounts = attempts.reduce((acc, row) => {'));
  assert.ok(source.includes('const killerTimeoutClassCounts = killerRows.reduce((acc, row) => {'));
  assert.ok(source.includes('const killerInfraUnavailableCount = killerInfraRows.length;'));
  assert.ok(source.includes('const killerProductAttempts = killerProductRows.length;'));
  assert.ok(source.includes('const killerInconclusive = killerConfiguredAttempts > 0 && killerProductAttempts === 0;'));
  assert.ok(source.includes('killerProductTimeoutClassCounts'));
  assert.ok(source.includes('killerProductTerminalReasonCounts'));
  assert.ok(source.includes('killerProductClientTimeoutRate'));
  assert.ok(source.includes('killerProductSseConnectedButNoDoneCount'));
  assert.ok(source.includes('ulCoverageMissReasonCounts'));
  assert.ok(source.includes('ulCoverageMissReasonSubCounts'));
  assert.ok(source.includes('ulCoverageDiagnosticsEligibleCount'));
  assert.ok(source.includes('ulCoverageDiagnosticsSkippedCount'));
  assert.ok(source.includes('const buildUlCoverageDiagnostics = ({ attempts, stats, summaryPath }) => {'));
  assert.ok(source.includes('const renderUlCoverageDiagnosticsMarkdown = (payload) => {'));
  assert.ok(source.includes('ul_coverage_diagnostics.json'));
  assert.ok(source.includes('ul_coverage_diagnostics.md'));
  assert.ok(source.includes('regulatoryRichRate_attemptWeighted'));
  assert.ok(source.includes('regulatoryRichRate_uniqueBarcode'));
  assert.ok(source.includes('esterCoreRate_all'));
  assert.ok(source.includes('esterUlReadyRate_eligible'));
  assert.ok(source.includes('dataCeilingRateByRole'));
  assert.ok(source.includes('scoreNotFoundTargetedCount'));
  assert.ok(source.includes('score_not_found_targeted.json'));
  assert.ok(source.includes('const consistencyFailRows = regulatoryRichRows.filter('));
  assert.ok(source.includes('const coverDetailConsistencyFailCount = consistencyFailRows.length;'));
  assert.ok(source.includes('const consistencyFailTop = buildConsistencyFailTop(consistencyFailRows, 10);'));
  assert.ok(source.includes('coverDetailConsistency: coverDetailConsistencyFailCount === 0'));
  assert.ok(source.includes('coverDetailConsistencyFailCount'));
  assert.ok(source.includes('consistencyFailReasonCounts'));
  assert.ok(source.includes('consistencyFailTop'));
  assert.ok(source.includes('const unwrapScoreBundle = (value) => {'));
  assert.ok(source.includes('const payloadBundle = payloadObject?.bundle && typeof payloadObject.bundle === "object" ? payloadObject.bundle : null;'));
  assert.ok(source.includes('const scoreInfo = payloadScore || payloadBundle || payloadObject;'));
});
