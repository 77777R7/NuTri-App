import assert from "node:assert/strict";
import test from "node:test";

import {
  getMetricsSnapshot,
  recordScanStreamTerminal,
  recordScanUxMetric,
} from "../../backend/src/metrics.js";

test("scan UX metrics summarize client-visible timing and duplicate decision fetches", () => {
  const before = getMetricsSnapshot() as any;
  const beforeScoreCount = Number(before.scanUx.totals.time_to_score_visible.count ?? 0);
  const beforeDuplicateFetches = Number(
    before.scanUx.decisionSupportFetch.totals.duplicateFetchEvents ?? 0,
  );

  recordScanUxMetric({
    event: "time_to_score_visible",
    elapsedMs: 1234.4,
  });
  recordScanUxMetric({
    event: "decision_support_fetch",
    count: 1,
  });
  recordScanUxMetric({
    event: "decision_support_fetch",
    count: 2,
  });

  const after = getMetricsSnapshot() as any;
  const score = after.scanUx.totals.time_to_score_visible;

  assert.equal(score.count, beforeScoreCount + 1);
  assert.equal(score.lastMs, 1234.4);
  assert.equal(score.recentP95Ms, 1234.4);
  assert.equal(
    after.scanUx.decisionSupportFetch.totals.duplicateFetchEvents,
    beforeDuplicateFetches + 1,
  );
});

test("stream terminal metrics classify DONE and backend terminal errors", () => {
  const before = getMetricsSnapshot() as any;
  const beforeDone = Number(before.streamTerminals.totals.terminalCounts.DONE ?? 0);
  const beforeBusy = Number(before.streamTerminals.totals.terminalCounts.STREAM_BUSY ?? 0);

  recordScanStreamTerminal({
    terminal: "DONE",
    reason: "full_rev1_watchdog_complete",
    degradedMode: false,
    sourceType: "dsld",
  });
  recordScanStreamTerminal({
    terminal: "STREAM_BUSY",
    reason: "QUEUE_WAIT_TIMEOUT",
    degradedMode: false,
    sourceType: null,
  });

  const after = getMetricsSnapshot() as any;

  assert.equal(after.streamTerminals.totals.terminalCounts.DONE, beforeDone + 1);
  assert.equal(after.streamTerminals.totals.terminalCounts.STREAM_BUSY, beforeBusy + 1);
  assert.equal(after.streamTerminals.totals.reasonCounts.full_rev1_watchdog_complete >= 1, true);
  assert.equal(after.streamTerminals.totals.reasonCounts.QUEUE_WAIT_TIMEOUT >= 1, true);
});
