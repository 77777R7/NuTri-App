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

  assert.match(slice, /resolveScanStreamRev1DonePolicy\(\{/);
  assert.match(slice, /analysisBundleOnly:\s*streamAnalysisBundleOnly/);
  assert.match(slice, /bundleOnlyDoneDelayMs:\s*ENRICH_STREAM_BUNDLE_ONLY_DONE_DELAY_MS/);
  assert.match(slice, /fullRev1DoneDelayMs:\s*ENRICH_STREAM_WEB_REV1_DONE_DELAY_MS/);
  assert.match(slice, /rev1DonePolicy\.timerKind === "bundle_only_done"/);
  assert.match(slice, /rev1DonePolicy\.timerKind === "full_rev1_watchdog"/);

  assert.doesNotMatch(slice, /latestSourceType !== "web"/);
  assert.match(slice, /finalizeStream\(rev1DonePolicy\.finalizeReason\)/);
});

test("full pre-rev1 watchdog uses fixed timeout reason for killer gating", async () => {
  const source = await readFile(SERVER_PATH, "utf8");
  const start = source.indexOf("if (!streamAnalysisBundleOnly && !fullPreRev1TerminalGuardTimer)");
  assert.ok(start >= 0, "missing full pre-rev1 guard block");
  const slice = source.slice(start, start + 4200);

  assert.match(slice, /reasonCode:\s*"FULL_REV1_MISSING_GUARD_TIMEOUT"/);
  assert.match(slice, /finalizeReason:\s*"full_pre_rev1_guard_timeout"/);
});
