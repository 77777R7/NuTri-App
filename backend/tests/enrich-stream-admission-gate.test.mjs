import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const SERVER_PATH = path.resolve(__dirname, "../src/server.ts");
const RUNTIME_CONFIG_PATH = path.resolve(__dirname, "../src/scanStreamRuntimeConfig.ts");
const ADMISSION_POLICY_PATH = path.resolve(__dirname, "../src/scanStreamAdmissionPolicy.ts");

test("admission gate runtime config exists with expected names", async () => {
  const source = await readFile(SERVER_PATH, "utf8");
  const configSource = await readFile(RUNTIME_CONFIG_PATH, "utf8");
  const admissionPolicySource = await readFile(ADMISSION_POLICY_PATH, "utf8");

  assert.match(source, /const ENRICH_STREAM_RUNTIME_CONFIG = resolveScanStreamRuntimeConfig\(process\.env\);/);
  assert.match(source, /const ENRICH_STREAM_MAX_ACTIVE_FULL = ENRICH_STREAM_RUNTIME_CONFIG\.fullMaxActive;/);
  assert.match(source, /const ENRICH_STREAM_MAX_QUEUE_FULL = ENRICH_STREAM_RUNTIME_CONFIG\.fullMaxQueue;/);
  assert.match(source, /const ENRICH_STREAM_MAX_ACTIVE_BUNDLE_ONLY = ENRICH_STREAM_RUNTIME_CONFIG\.bundleOnlyMaxActive;/);
  assert.match(source, /const ENRICH_STREAM_MAX_QUEUE_BUNDLE_ONLY = ENRICH_STREAM_RUNTIME_CONFIG\.bundleOnlyMaxQueue;/);
  assert.match(source, /const ENRICH_STREAM_QUEUE_WAIT_MS = ENRICH_STREAM_RUNTIME_CONFIG\.fullQueueWaitMs;/);
  assert.match(source, /const ENRICH_STREAM_QUEUE_WAIT_MS_BUNDLE_ONLY = ENRICH_STREAM_RUNTIME_CONFIG\.bundleOnlyQueueWaitMs;/);
  assert.match(configSource, /export const resolveScanStreamRuntimeConfig = \(/);
  assert.match(configSource, /admissionCoreFallbackBudgetMs/);
  assert.match(configSource, /fullPressureCoreFallbackGuardMs/);
  assert.match(admissionPolicySource, /DEFAULT_FULL_STREAM_MAX_ACTIVE = 2/);
  assert.match(admissionPolicySource, /DEFAULT_FULL_STREAM_QUEUE_WAIT_MS = 450/);
  assert.match(source, /const enrichStreamAdmissionGateFull = new EnrichStreamAdmissionGate\(/);
  assert.match(source, /const enrichStreamAdmissionGateBundleOnly = new EnrichStreamAdmissionGate\(/);
  assert.match(source, /type EnrichStreamAdmissionLane = "full" \| "bundle_only"/);
  assert.match(source, /const selectEnrichStreamAdmissionGate = \(/);
});

test("admission gate runs after SSE init and before main pipeline work", async () => {
  const source = await readFile(SERVER_PATH, "utf8");
  const routeStart = source.indexOf('app.post("/api/enrich-stream"');
  assert.ok(routeStart >= 0, "missing enrich-stream route");

  const sseStart = source.indexOf("sseStarted = true;", routeStart);
  const admissionStart = source.indexOf("const admissionWaitMs =", routeStart);
  const invalidCheck = source.indexOf('code: "INVALID_BARCODE"', routeStart);
  const stageWork = source.indexOf("const existing = barcodeEnrichInFlight.get(cacheKey);", routeStart);

  assert.ok(sseStart >= 0, "missing SSE init");
  assert.ok(admissionStart >= 0, "missing admission block");
  assert.ok(invalidCheck >= 0, "missing invalid barcode terminal guard");
  assert.ok(stageWork >= 0, "missing main pipeline marker");
  assert.ok(admissionStart > sseStart, "admission must happen after SSE headers");
  assert.ok(admissionStart < invalidCheck, "admission should happen before main branch checks");
  assert.ok(admissionStart < stageWork, "admission should happen before heavy pipeline work");
  assert.match(source, /const streamAdmissionLane: EnrichStreamAdmissionLane = streamAnalysisBundleOnly \? "bundle_only" : "full";/);
  assert.match(source, /const streamAdmissionGate = selectEnrichStreamAdmissionGate\(streamAdmissionLane\);/);
  assert.match(source, /streamAdmissionGate\.acquire/);
});

test("global watchdog uses request-level deadline", async () => {
  const source = await readFile(SERVER_PATH, "utf8");
  const watchdogStart = source.indexOf("if (!globalWatchdog)");
  assert.ok(watchdogStart >= 0, "missing global watchdog block");
  const watchdogSlice = source.slice(watchdogStart, watchdogStart + 1400);

  assert.match(watchdogSlice, /const remainingMs = globalDeadlineAt - Date\.now\(\)/);
  assert.match(watchdogSlice, /if \(remainingMs <= 0\)/);
  assert.match(watchdogSlice, /code:\s*"STREAM_TIMEOUT"/);
  assert.match(watchdogSlice, /reasonCode:\s*"GLOBAL_TIMEOUT_REV0_ONLY"/);
  assert.match(watchdogSlice, /setTimeout\(/);
});
