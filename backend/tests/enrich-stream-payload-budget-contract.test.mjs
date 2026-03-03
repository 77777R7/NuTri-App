import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const SCRIPT_PATH = path.resolve(__dirname, "../../scripts/maintainer/enrich-stream-concurrency-gate.mjs");

test("enrich-stream concurrency gate reports payload path/bytes/percent with budget thresholds", async () => {
  const source = await readFile(SCRIPT_PATH, "utf8");
  assert.match(source, /ENRICH_STREAM_GATE_PAYLOAD_WARN_BYTES/);
  assert.match(source, /ENRICH_STREAM_GATE_PAYLOAD_FAIL_BYTES/);
  assert.match(source, /collectPayloadFieldSizes/);
  assert.match(source, /path:\s*row\.path/);
  assert.match(source, /bytes:\s*row\.bytes/);
  assert.match(source, /percent:/);
  assert.match(source, /payloadBudget/);
  assert.match(source, /if \(summary\?\.payloadBudget\?\.failExceeded\)/);
});
