import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const SERVER_PATH = path.resolve(__dirname, "../src/server.ts");

test("fast watchdog degrades without forcing fallback finalize", async () => {
  const source = await readFile(SERVER_PATH, "utf8");
  const fastStart = source.indexOf("fastWatchdog = setTimeout");
  assert.ok(fastStart >= 0, "missing fast watchdog block");
  const fastSlice = source.slice(fastStart, fastStart + 900);

  assert.match(fastSlice, /sendSSE\(res,\s*"status",\s*\{/);
  assert.match(fastSlice, /stage:\s*"watchdog_fast_timeout"/);
  assert.equal(
    /finalizeStream\("watchdog_fast_timeout"\)/.test(fastSlice),
    false,
    "fast watchdog must not finalize stream",
  );
  assert.equal(
    /emitWatchdogFallbackRev1/.test(fastSlice),
    false,
    "fast watchdog must not emit fallback rev1",
  );
});

test("global watchdog emits STREAM_TIMEOUT for rev0-only and finalizes", async () => {
  const source = await readFile(SERVER_PATH, "utf8");
  const globalStart = source.indexOf("globalWatchdog = setTimeout");
  assert.ok(globalStart >= 0, "missing global watchdog block");
  const globalSlice = source.slice(globalStart, globalStart + 1600);

  assert.match(source, /const remainingMs = globalDeadlineAt - Date\.now\(\)/);
  assert.match(source, /if \(remainingMs <= 0\)/);
  assert.match(globalSlice, /emitTerminalErrorAndFinalize\(\{/);
  assert.match(globalSlice, /code:\s*"STREAM_TIMEOUT"/);
  assert.match(globalSlice, /stage:\s*"watchdog"/);
  assert.match(globalSlice, /reasonCode:\s*"GLOBAL_TIMEOUT_REV0_ONLY"/);
  assert.match(globalSlice, /retryable:\s*true/);
  assert.match(globalSlice, /finalizeStream\("global_timeout_after_rev1"\)/);
});

test("full-lane rev1 watchdog finalizes stream for all source types when post-rev1 tail drifts", async () => {
  const source = await readFile(SERVER_PATH, "utf8");
  assert.match(
    source,
    /const ENRICH_STREAM_WEB_REV1_DONE_DELAY_MS = ENRICH_STREAM_RUNTIME_CONFIG\.fullRev1DoneDelayMs;/,
  );

  const scheduleStart = source.indexOf("const scheduleBundleOnlyFinalize = () => {");
  assert.ok(scheduleStart >= 0, "missing post-rev1 finalize scheduler");
  const scheduleSlice = source.slice(scheduleStart, scheduleStart + 3200);

  assert.match(scheduleSlice, /if \(!streamState\.rev1Sent\) return;/);
  assert.doesNotMatch(scheduleSlice, /if \(streamState\.latestSourceType !== "web"\) return;/);
  assert.match(scheduleSlice, /resolveScanStreamRev1DonePolicy\(\{/);
  assert.match(scheduleSlice, /analysisBundleOnly:\s*streamAnalysisBundleOnly/);
  assert.match(scheduleSlice, /fullRev1DoneDelayMs:\s*ENRICH_STREAM_WEB_REV1_DONE_DELAY_MS/);
  assert.match(scheduleSlice, /rev1DonePolicy\.timerKind === "full_rev1_watchdog" && webRev1DoneTimer/);
  assert.match(scheduleSlice, /finalizeStream\(rev1DonePolicy\.finalizeReason\)/);
});

test("bundle-only terminal guard guarantees rev1/done closure", async () => {
  const source = await readFile(SERVER_PATH, "utf8");
  assert.match(
    source,
    /const ENRICH_STREAM_BUNDLE_ONLY_TERMINAL_GUARD_MS =\s*ENRICH_STREAM_RUNTIME_CONFIG\.bundleOnlyTerminalGuardMs;/,
  );

  const guardStart = source.indexOf("if (streamAnalysisBundleOnly && !bundleOnlyTerminalGuardTimer)");
  assert.ok(guardStart >= 0, "missing bundle-only terminal guard");
  const guardSlice = source.slice(guardStart, guardStart + 1600);

  assert.match(guardSlice, /if \(!streamState\.rev1Sent\)/);
  assert.match(guardSlice, /emitDegradedLimitedRev1AndFinalize\("BUNDLE_ONLY_NO_AUTHORITATIVE_MATCH"\)/);
  assert.match(guardSlice, /finalizeStream\(terminalReason \?\? "analysis_bundle_only_terminal_guard"\)/);
});

test("full-lane pre-rev1 terminal guard emits stable timeout reason and finalizes", async () => {
  const source = await readFile(SERVER_PATH, "utf8");
  assert.match(
    source,
    /const ENRICH_STREAM_FULL_PRE_REV1_TERMINAL_GUARD_MS =\s*ENRICH_STREAM_RUNTIME_CONFIG\.fullPreRev1TerminalGuardMs;/,
  );

  const guardStart = source.indexOf("if (!streamAnalysisBundleOnly && !fullPreRev1TerminalGuardTimer)");
  assert.ok(guardStart >= 0, "missing full-lane pre-rev1 terminal guard");
  const guardSlice = source.slice(guardStart, guardStart + 4600);

  assert.match(guardSlice, /if \(streamState\.rev1Sent\) return;/);
  assert.match(guardSlice, /isCrashCanaryRequest/);
  assert.match(guardSlice, /emitDegradedLimitedRev1AndFinalize\("DEGRADED_WEB_BUDGET"\)/);
  assert.match(guardSlice, /emitAdmissionCoreFallbackAndFinalize\("PRE_REV1_TERMINAL_GUARD"\)/);
  assert.match(guardSlice, /if \(fallbackEmitted\) \{\s*return;\s*\}/);
  assert.match(guardSlice, /emitTerminalErrorAndFinalize\(\{/);
  assert.match(guardSlice, /code:\s*"STREAM_TIMEOUT"/);
  assert.match(guardSlice, /stage:\s*"watchdog"/);
  assert.match(guardSlice, /reasonCode:\s*"FULL_REV1_MISSING_GUARD_TIMEOUT"/);
  assert.match(guardSlice, /finalizeReason:\s*"full_pre_rev1_guard_timeout"/);
  assert.ok(
    guardSlice.indexOf('emitAdmissionCoreFallbackAndFinalize("PRE_REV1_TERMINAL_GUARD")')
      < guardSlice.indexOf("emitTerminalErrorAndFinalize({"),
    "core fallback should be attempted before terminal timeout",
  );
});

test("terminal error payload includes terminalSnapshot fields", async () => {
  const source = await readFile(SERVER_PATH, "utf8");
  const fnStart = source.indexOf("const emitTerminalErrorAndFinalize = (params:");
  assert.ok(fnStart >= 0, "missing emitTerminalErrorAndFinalize helper");
  const fnSlice = source.slice(fnStart, fnStart + 2200);

  assert.match(fnSlice, /terminalSnapshot\s*=\s*\{/);
  assert.match(fnSlice, /sourceType:\s*streamState\.latestSourceType/);
  assert.match(fnSlice, /sourceTypeFinal:\s*streamState\.latestSourceTypeFinal/);
  assert.match(fnSlice, /identityType:\s*streamState\.latestIdentityType/);
  assert.match(fnSlice, /revision:\s*streamState\.latestRevision/);
  assert.match(fnSlice, /rev0Sent:\s*streamState\.rev0Sent/);
  assert.match(fnSlice, /rev1Sent:\s*streamState\.rev1Sent/);
  assert.match(fnSlice, /persistedSent:\s*streamState\.persistedSent/);
  assert.match(fnSlice, /doneSent:\s*streamState\.doneSent/);
  assert.match(fnSlice, /finalizeReason:\s*params\.finalizeReason/);
  assert.match(fnSlice, /terminalSnapshot/);
});

test("legacy watchdog fallback helper is removed", async () => {
  const source = await readFile(SERVER_PATH, "utf8");
  assert.equal(
    source.includes("const emitWatchdogFallbackRev1"),
    false,
    "watchdog fallback rev1 helper should not exist",
  );
});
