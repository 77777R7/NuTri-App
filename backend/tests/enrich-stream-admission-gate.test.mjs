import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const SERVER_PATH = path.resolve(__dirname, "../src/server.ts");

test("admission gate constants exist with expected names", async () => {
  const source = await readFile(SERVER_PATH, "utf8");
  assert.match(source, /const ENRICH_STREAM_MAX_ACTIVE\s*=\s*Math\.max\(1,\s*Number\(process\.env\.ENRICH_STREAM_MAX_ACTIVE\s*\?\?\s*4\)\)/);
  assert.match(source, /const ENRICH_STREAM_MAX_QUEUE\s*=\s*Math\.max\(0,\s*Number\(process\.env\.ENRICH_STREAM_MAX_QUEUE\s*\?\?\s*20\)\)/);
  assert.match(source, /const ENRICH_STREAM_QUEUE_WAIT_MS\s*=\s*Math\.max\(0,\s*Number\(process\.env\.ENRICH_STREAM_QUEUE_WAIT_MS\s*\?\?\s*1500\)\)/);
  assert.match(source, /const enrichStreamAdmissionGate = new EnrichStreamAdmissionGate\(/);
});

test("admission gate runs after SSE init and before main pipeline work", async () => {
  const source = await readFile(SERVER_PATH, "utf8");
  const routeStart = source.indexOf('app.post("/api/enrich-stream"');
  assert.ok(routeStart >= 0, "missing enrich-stream route");

  const sseStart = source.indexOf("sseStarted = true;", routeStart);
  const admissionStart = source.indexOf("const admissionWaitMs =", routeStart);
  const invalidCheck = source.indexOf("if (!normalized)", routeStart);
  const stageWork = source.indexOf("const existing = barcodeEnrichInFlight.get(cacheKey);", routeStart);

  assert.ok(sseStart >= 0, "missing SSE init");
  assert.ok(admissionStart >= 0, "missing admission block");
  assert.ok(invalidCheck >= 0, "missing normalized guard");
  assert.ok(stageWork >= 0, "missing main pipeline marker");
  assert.ok(admissionStart > sseStart, "admission must happen after SSE headers");
  assert.ok(admissionStart < invalidCheck, "admission should happen before main branch checks");
  assert.ok(admissionStart < stageWork, "admission should happen before heavy pipeline work");
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
