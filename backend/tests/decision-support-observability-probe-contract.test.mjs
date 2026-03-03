import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const PROBE_SCRIPT_PATH = path.resolve(__dirname, "../../scripts/maintainer/probe-decision-support-observability.mjs");

const readScriptSource = async () => readFile(PROBE_SCRIPT_PATH, "utf8");

test("observability probe exposes threshold inputs and breach metrics", async () => {
  const source = await readScriptSource();
  assert.match(source, /maxUnexpected409Rate/);
  assert.match(source, /minRetrySuccessRate/);
  assert.match(source, /maxInlineFallbackRate/);
  assert.match(source, /breachMetrics/);
  assert.match(source, /thresholds/);
});

test("observability probe emits breach barcode lists for repair queue ingestion", async () => {
  const source = await readScriptSource();
  assert.match(source, /breachBarcodeLists/);
  assert.match(source, /unexpected409/);
  assert.match(source, /retryFailure/);
  assert.match(source, /inlineFallbackProxy/);
});

