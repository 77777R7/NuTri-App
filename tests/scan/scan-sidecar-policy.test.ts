import assert from "node:assert/strict";
import test from "node:test";

import {
  SCAN_SIDECAR_POLICY_SCHEMA_VERSION,
  buildScanSidecarCacheKey,
  getScanSidecarPolicy,
} from "../../backend/src/scanSidecarPolicy.js";

test("scan sidecar policies classify core, deferred, and monitor-only routes", () => {
  assert.equal(SCAN_SIDECAR_POLICY_SCHEMA_VERSION, 1);
  assert.equal(getScanSidecarPolicy("decision_support").priority, "core");
  assert.equal(getScanSidecarPolicy("scan_facts").priority, "core");
  assert.equal(getScanSidecarPolicy("ingredient_overview").priority, "deferred");
  assert.equal(getScanSidecarPolicy("scientific_background").priority, "deferred");
  assert.equal(getScanSidecarPolicy("product_overview_ai").priority, "deferred");
  assert.equal(getScanSidecarPolicy("summary_safety").priority, "monitor_only");
});

test("cacheable scan sidecars expose stable cache key metadata without response shape changes", () => {
  for (const route of ["ingredient_overview", "scientific_background", "product_overview_ai"] as const) {
    const policy = getScanSidecarPolicy(route);
    assert.equal(policy.cacheable, true);
    assert.ok(policy.defaultTtlMs > 0);
  }
});

test("sidecar cache keys normalize route, barcode, digest, personalization, and selected ingredient", () => {
  const key = buildScanSidecarCacheKey({
    route: "scientific_background",
    barcode: "23249011835",
    decisionDigest: " digest-a ",
    decisionInputsHash: " inputs-a ",
    personalizationScopeHash: " scope-a ",
    selectedIngredientKey: " Omega 3 ",
    promptVersion: "science-v1",
  });

  assert.equal(
    key,
    "scan-sidecar:v1|scientific_background|barcode=00023249011835|decision=digest-a|inputs=inputs-a|scope=scope-a|ingredient=omega 3|prompt=science-v1",
  );
});
