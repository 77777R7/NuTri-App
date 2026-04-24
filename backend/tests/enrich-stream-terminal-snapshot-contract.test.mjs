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

test("emitTerminalErrorAndFinalize builds a terminalSnapshot object", async () => {
  const source = await readEnrichStreamSource();
  const helperStart = source.indexOf("const emitTerminalErrorAndFinalize = (params:");
  assert.ok(helperStart >= 0, "missing emitTerminalErrorAndFinalize helper");
  const helperSlice = source.slice(helperStart, helperStart + 2600);

  assert.match(helperSlice, /const terminalSnapshot = \{/);
  assert.match(helperSlice, /sourceType:\s*streamState\.latestSourceType/);
  assert.match(helperSlice, /sourceTypeFinal:\s*streamState\.latestSourceTypeFinal/);
  assert.match(helperSlice, /identityType:\s*streamState\.latestIdentityType/);
  assert.match(helperSlice, /revision:\s*streamState\.latestRevision/);
  assert.match(helperSlice, /rev0Sent:\s*streamState\.rev0Sent/);
  assert.match(helperSlice, /rev1Sent:\s*streamState\.rev1Sent/);
  assert.match(helperSlice, /persistedSent:\s*streamState\.persistedSent/);
  assert.match(helperSlice, /doneSent:\s*streamState\.doneSent/);
  assert.match(helperSlice, /finalizeReason:\s*params\.finalizeReason/);
});

test("emitTerminalErrorAndFinalize attaches terminalSnapshot to error payload", async () => {
  const source = await readEnrichStreamSource();
  const helperStart = source.indexOf("const emitTerminalErrorAndFinalize = (params:");
  assert.ok(helperStart >= 0, "missing emitTerminalErrorAndFinalize helper");
  const helperSlice = source.slice(helperStart, helperStart + 3000);

  assert.match(helperSlice, /const payload:\s*Record<string,\s*unknown>\s*=\s*\{/);
  assert.match(helperSlice, /terminalSnapshot,/);
  assert.match(helperSlice, /sendSSE\(res,\s*"error",\s*payload\)/);
  assert.equal(
    (helperSlice.match(/const terminalSnapshot = \{/g) || []).length,
    1,
    "terminalSnapshot should be constructed once in the helper",
  );
});
