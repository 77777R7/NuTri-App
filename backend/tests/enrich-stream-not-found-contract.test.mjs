import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const SERVER_PATH = path.resolve(__dirname, "../src/server.ts");
const ROUTE_PATH = path.resolve(__dirname, "../src/routes/enrichStreamRoute.ts");

const readEnrichStreamSource = async () =>
  `${await readFile(SERVER_PATH, "utf8")}\n${await readFile(ROUTE_PATH, "utf8")}`;

test("enrich-stream NOT_FOUND helper emits stable payload fields", async () => {
  const source = await readEnrichStreamSource();
  const helperStart = source.indexOf("const emitProductNotFoundAndFinalize");
  assert.ok(helperStart >= 0, "missing emitProductNotFoundAndFinalize helper");
  const helperSlice = source.slice(helperStart, helperStart + 5200);

  assert.match(helperSlice, /schemaVersion:\s*NOT_FOUND_ERROR_SCHEMA_VERSION/);
  assert.match(helperSlice, /code:\s*"NOT_FOUND"/);
  assert.match(helperSlice, /stage:\s*params\.stage/);
  assert.match(helperSlice, /reasonCode/);
  assert.match(helperSlice, /retryable:\s*isRetryableNotFoundReason/);
  assert.match(helperSlice, /message:\s*"Product not found"/);
  assert.match(helperSlice, /emitTerminalErrorAndFinalize\(\{/);
});

test("enrich-stream STREAM_TIMEOUT terminal payload remains stable", async () => {
  const source = await readEnrichStreamSource();
  const helperStart = source.indexOf("const emitTerminalErrorAndFinalize");
  assert.ok(helperStart >= 0, "missing emitTerminalErrorAndFinalize helper");
  const helperSlice = source.slice(helperStart, helperStart + 2600);

  assert.match(helperSlice, /sendSSE\(res,\s*"error",\s*payload\)/);
  assert.match(helperSlice, /requestId:\s*requestId\s*\|\|\s*null/);
  assert.match(helperSlice, /finalizeStream\(params\.finalizeReason\)/);

  const watchdogStart = source.indexOf("globalWatchdog = setTimeout");
  assert.ok(watchdogStart >= 0, "missing global watchdog block");
  const watchdogSlice = source.slice(watchdogStart, watchdogStart + 1200);

  assert.match(watchdogSlice, /emitTerminalErrorAndFinalize\(\{/);
  assert.match(watchdogSlice, /code:\s*"STREAM_TIMEOUT"/);
  assert.match(watchdogSlice, /stage:\s*"watchdog"/);
  assert.match(watchdogSlice, /reasonCode:\s*"GLOBAL_TIMEOUT_REV0_ONLY"/);
  assert.match(watchdogSlice, /retryable:\s*true/);
});
