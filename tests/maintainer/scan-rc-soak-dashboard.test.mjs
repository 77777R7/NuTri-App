import assert from "node:assert/strict";
import test from "node:test";

import {
  buildScanRcSoakDashboard,
  renderMarkdownDashboard,
} from "../../scripts/maintainer/scan-rc-soak-dashboard.mjs";

const buildMetrics = (overrides = {}) => ({
  startedAt: "2026-04-25T00:00:00.000Z",
  lastFlushAt: "2026-04-25T00:30:00.000Z",
  streamTerminals: {
    totals: {
      total: 120,
      terminalCounts: {
        DONE: 118,
        NOT_FOUND: 2,
      },
      degradedCount: 0,
    },
    window: {
      total: 4,
      terminalCounts: {
        DONE: 4,
      },
      degradedCount: 0,
    },
  },
  scanUx: {
    totals: {
      time_to_score_visible: {
        count: 32,
        recentP95Ms: 1472,
      },
      time_to_core_cards_visible: {
        count: 32,
        recentP95Ms: 15,
      },
    },
    window: {},
    decisionSupportFetch: {
      totals: {
        duplicateFetchEvents: 0,
      },
      window: {
        duplicateFetchEvents: 0,
      },
    },
  },
  sidecars: {
    totals: {
      decision_support: {
        priority: "core",
        fetchCount: 20,
        cacheHitCount: 100,
        cacheMissCount: 5,
        latency: {
          avgMs: 12.3,
          lastMs: 1.2,
        },
      },
    },
    window: {
      decision_support: {
        fetchCount: 1,
        cacheHitCount: 3,
        cacheMissCount: 0,
      },
    },
  },
  ...overrides,
});

test("scan RC soak dashboard stays green for enough natural traffic with no current failures", () => {
  const dashboard = buildScanRcSoakDashboard(buildMetrics(), {
    previousMetrics: buildMetrics({
      streamTerminals: {
        totals: {
          total: 116,
          terminalCounts: {
            DONE: 114,
            NOT_FOUND: 2,
          },
          degradedCount: 0,
        },
        window: {
          total: 0,
          terminalCounts: {},
          degradedCount: 0,
        },
      },
      scanUx: buildMetrics().scanUx,
      sidecars: buildMetrics().sidecars,
    }),
    generatedAt: "2026-04-25T00:31:00.000Z",
  });

  assert.equal(dashboard.status, "green");
  assert.equal(dashboard.traffic.enoughNaturalTraffic, true);
  assert.equal(dashboard.streamTerminals.totals.STREAM_BUSY, 0);
  assert.equal(dashboard.scanUx.timeToScoreVisibleRecentP95Ms, 1472);
  assert.equal(dashboard.sidecars.decisionSupport.cacheHitCount, 100);
});

test("scan RC soak dashboard flags current-window terminal and duplicate fetch failures", () => {
  const current = buildMetrics({
    streamTerminals: {
      totals: {
        total: 121,
        terminalCounts: {
          DONE: 118,
          STREAM_BUSY: 1,
          NOT_FOUND: 2,
        },
        degradedCount: 1,
      },
      window: {
        total: 2,
        terminalCounts: {
          DONE: 1,
          STREAM_BUSY: 1,
        },
        degradedCount: 1,
      },
    },
    scanUx: {
      ...buildMetrics().scanUx,
      decisionSupportFetch: {
        totals: {
          duplicateFetchEvents: 1,
        },
        window: {
          duplicateFetchEvents: 1,
        },
      },
    },
  });

  const dashboard = buildScanRcSoakDashboard(current, {
    previousMetrics: buildMetrics(),
  });

  assert.equal(dashboard.status, "red");
  assert.deepEqual(
    dashboard.redReasons.filter((reason) => reason.includes("STREAM_BUSY") || reason.includes("duplicate_fetch")),
    ["STREAM_BUSY_window_1", "STREAM_BUSY_delta_1", "duplicate_fetch_window_1", "duplicate_fetch_delta_1"],
  );
});

test("scan RC soak dashboard markdown includes operator-facing fields", () => {
  const dashboard = buildScanRcSoakDashboard(buildMetrics(), {
    previousMetrics: buildMetrics(),
    generatedAt: "2026-04-25T00:31:00.000Z",
  });
  const markdown = renderMarkdownDashboard(dashboard);

  assert.match(markdown, /Scan RC Natural Traffic Soak Dashboard/);
  assert.match(markdown, /time_to_score_visible recentP95Ms: 1472/);
  assert.match(markdown, /fetch\/cacheHit\/cacheMiss: 20\/100\/5/);
});
