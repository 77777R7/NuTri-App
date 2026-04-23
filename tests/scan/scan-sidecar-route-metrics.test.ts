import assert from "node:assert/strict";
import test from "node:test";

import { resolveScanSidecarRouteForPath } from "../../backend/src/scanSidecarRouteMetrics.js";

test("scan sidecar route resolver preserves the public backend route surface", () => {
  assert.equal(resolveScanSidecarRouteForPath("/api/decision-support/v1"), "decision_support");
  assert.equal(resolveScanSidecarRouteForPath("/api/scan-facts/v1/dsld/123"), "scan_facts");
  assert.equal(resolveScanSidecarRouteForPath("/api/ingredient-overview/v1"), "ingredient_overview");
  assert.equal(resolveScanSidecarRouteForPath("/api/scientific-background/v1"), "scientific_background");
  assert.equal(resolveScanSidecarRouteForPath("/api/product-overview-ai/v1"), "product_overview_ai");
  assert.equal(resolveScanSidecarRouteForPath("/api/summary/safety"), "summary_safety");
  assert.equal(resolveScanSidecarRouteForPath("/api/enrich-stream"), null);
});

