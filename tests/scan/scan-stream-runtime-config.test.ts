import assert from "node:assert/strict";
import test from "node:test";

import { resolveScanStreamRuntimeConfig } from "../../backend/src/scanStreamRuntimeConfig.js";

test("scan stream runtime config centralizes production-safe defaults", () => {
  const config = resolveScanStreamRuntimeConfig({});

  assert.equal(config.fullMaxActive, 2);
  assert.equal(config.fullMaxQueue, 20);
  assert.equal(config.fullQueueWaitMs, 450);
  assert.equal(config.bundleOnlyMaxActive, 12);
  assert.equal(config.bundleOnlyQueueWaitMs, 1500);
  assert.equal(config.admissionCoreFallbackBudgetMs, 650);
  assert.equal(config.fullPressureCoreFallbackGuardMs, 650);
  assert.equal(config.fullRev1DoneDelayMs, 250);
  assert.equal(config.stageBundleAwaitTimeoutMs, 3500);
  assert.equal(config.hardTerminalFallbackMs, 17500);
});

test("scan stream runtime config clamps unsafe low operator overrides", () => {
  const config = resolveScanStreamRuntimeConfig({
    ENRICH_STREAM_MAX_ACTIVE_FULL: "0",
    ENRICH_STREAM_MAX_QUEUE_FULL: "-1",
    ENRICH_STREAM_QUEUE_WAIT_MS: "-10",
    ENRICH_STREAM_ADMISSION_CORE_FALLBACK_BUDGET_MS: "1",
    ENRICH_STREAM_FULL_PRESSURE_CORE_FALLBACK_GUARD_MS: "1",
    ENRICH_STREAM_STAGE_BUNDLE_AWAIT_TIMEOUT_MS: "1",
    ENRICH_STREAM_FULL_PRE_REV1_TERMINAL_GUARD_MS: "1",
  });

  assert.equal(config.fullMaxActive, 1);
  assert.equal(config.fullMaxQueue, 0);
  assert.equal(config.fullQueueWaitMs, 0);
  assert.equal(config.admissionCoreFallbackBudgetMs, 250);
  assert.equal(config.fullPressureCoreFallbackGuardMs, 250);
  assert.equal(config.stageBundleAwaitTimeoutMs, 500);
  assert.equal(config.fullPreRev1TerminalGuardMs, 1000);
});

