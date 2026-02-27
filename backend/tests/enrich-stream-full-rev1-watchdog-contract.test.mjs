import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const SERVER_PATH = path.resolve(__dirname, "../src/server.ts");

test("scheduleBundleOnlyFinalize applies rev1 watchdog to full lane with stable reason code", async () => {
  const source = await readFile(SERVER_PATH, "utf8");
  const start = source.indexOf("const scheduleBundleOnlyFinalize = () => {");
  assert.ok(start >= 0, "missing scheduleBundleOnlyFinalize helper");
  const slice = source.slice(start, start + 2200);

  assert.match(slice, /if \(streamAnalysisBundleOnly\)/);
  assert.match(slice, /finalizeStream\("analysis_bundle_only_rev1_complete"\)/);

  assert.match(slice, /if \(ENRICH_STREAM_WEB_REV1_DONE_DELAY_MS <= 0\) return;/);
  assert.doesNotMatch(slice, /latestSourceType !== "web"/);
  assert.match(slice, /finalizeStream\("full_rev1_watchdog_complete"\)/);
});

test("full pre-rev1 watchdog uses fixed timeout reason for killer gating", async () => {
  const source = await readFile(SERVER_PATH, "utf8");
  const start = source.indexOf("if (!streamAnalysisBundleOnly && !fullPreRev1TerminalGuardTimer)");
  assert.ok(start >= 0, "missing full pre-rev1 guard block");
  const slice = source.slice(start, start + 1900);

  assert.match(slice, /reasonCode:\s*"FULL_REV1_MISSING_GUARD_TIMEOUT"/);
  assert.match(slice, /finalizeReason:\s*"full_pre_rev1_guard_timeout"/);
});
