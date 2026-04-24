import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const SERVER_PATH = path.resolve(__dirname, "../src/server.ts");

test("enrich-stream STREAM_BUSY helper emits stable payload fields", async () => {
  const source = await readFile(SERVER_PATH, "utf8");
  const helperStart = source.indexOf("const emitStreamBusyAndFinalize =");
  assert.ok(helperStart >= 0, "missing emitStreamBusyAndFinalize helper");
  const helperSlice = source.slice(helperStart, helperStart + 1200);

  assert.match(helperSlice, /schemaVersion:\s*1/);
  assert.match(helperSlice, /code:\s*"STREAM_BUSY"/);
  assert.match(helperSlice, /stage:\s*"admission"/);
  assert.match(helperSlice, /reasonCode/);
  assert.match(helperSlice, /retryable:\s*true/);
  assert.match(helperSlice, /admissionLane:\s*streamAdmissionLane/);
  assert.match(helperSlice, /admissionGateState/);
  assert.match(helperSlice, /message:\s*"Server is busy, please retry shortly"/);
  assert.match(helperSlice, /emitTerminalErrorAndFinalize\(\{/);
});

test("admission rejects map to STREAM_BUSY terminal path", async () => {
  const source = await readFile(SERVER_PATH, "utf8");
  const tryStart = source.indexOf("const admissionWaitMs =");
  assert.ok(tryStart >= 0, "missing admission gate block");
  const trySlice = source.slice(tryStart, tryStart + 2200);

  assert.match(trySlice, /streamAdmissionGate\.acquire/);
  assert.match(trySlice, /emitAdmissionCoreFallbackAndFinalize\("PRE_REV1_PRESSURE_GUARD"\)/);
  assert.match(trySlice, /emitStreamBusyAndFinalize\(reasonCode\)/);
  assert.match(trySlice, /QUEUE_FULL/);
  assert.match(trySlice, /QUEUE_WAIT_TIMEOUT/);
});
