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

test("in-flight release helper is one-shot and clears handle before calling release", async () => {
  const source = await readEnrichStreamSource();
  const helperStart = source.indexOf("const releaseInFlightOnce =");
  assert.ok(helperStart >= 0, "missing releaseInFlightOnce helper");
  const helperSlice = source.slice(helperStart, helperStart + 400);

  assert.match(helperSlice, /const release = finishInFlight;/);
  assert.match(helperSlice, /finishInFlight = null;/);
  assert.match(helperSlice, /if \(!release\) return;/);
  assert.match(helperSlice, /release\(error\);/);
});

test("admission release helper is one-shot and clears handle before calling release", async () => {
  const source = await readEnrichStreamSource();
  const helperStart = source.indexOf("const releaseAdmissionOnce =");
  assert.ok(helperStart >= 0, "missing releaseAdmissionOnce helper");
  const helperSlice = source.slice(helperStart, helperStart + 320);

  assert.match(helperSlice, /const release = releaseAdmission;/);
  assert.match(helperSlice, /releaseAdmission = null;/);
  assert.match(helperSlice, /if \(!release\) return;/);
  assert.match(helperSlice, /release\(\);/);
});

test("stream finalize path no longer uses scattered done emits or direct finishInFlight invocations", async () => {
  const source = await readEnrichStreamSource();

  const doneMatches = source.match(/sendSSE\(res,\s*"done"/g) ?? [];
  assert.equal(doneMatches.length, 0, "sendSSE(done) should not be used in enrich-stream path");

  const legacyInFlightOptional = source.match(/finishInFlight\?\./g) ?? [];
  assert.equal(legacyInFlightOptional.length, 0, "legacy optional finishInFlight calls should be removed");

  const legacyInFlightIf = source.match(/if\s*\(finishInFlight\)/g) ?? [];
  assert.equal(legacyInFlightIf.length, 0, "legacy finishInFlight guard calls should be removed");
});

test("release helper is used in both success and error terminal paths", async () => {
  const source = await readEnrichStreamSource();
  assert.match(source, /releaseInFlightOnce\(\);/);
  assert.match(source, /releaseInFlightOnce\(error\);/);
  assert.match(source, /releaseAdmissionOnce\(\);/);
  assert.match(source, /abortPipelineOnce\(new Error\("stream_finalized"\)\);/);
  assert.match(source, /emitTerminalErrorAndFinalize\(\{/);
});
