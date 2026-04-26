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

const readServerSource = readEnrichStreamSource;

test("stability meta includes stage0 counters and degraded diagnostics", async () => {
  const source = await readServerSource();
  const metaStart = source.indexOf("const buildStabilityMeta = () => ({");
  assert.ok(metaStart >= 0, "missing buildStabilityMeta helper");
  const metaSlice = source.slice(metaStart, metaStart + 3200);

  assert.match(metaSlice, /stage0Winner:\s*activeStage0Winner/);
  assert.match(metaSlice, /stage0StartCount/);
  assert.match(metaSlice, /stage0ReplaceCount/);
  assert.match(metaSlice, /terminalReason/);
  assert.match(metaSlice, /degradedMode/);
  assert.match(metaSlice, /rev1ToDoneMs/);
  assert.match(metaSlice, /doneTimerKind/);
  assert.match(metaSlice, /doneTimerPlannedDelayMs/);
  assert.match(metaSlice, /doneTimerDriftMs/);
  assert.match(metaSlice, /persistedCommitMode/);
  assert.match(metaSlice, /persistedCommitCompletedBeforeDone/);
  assert.match(metaSlice, /eventLoopLagP95DuringRequest/);
  assert.match(metaSlice, /webBytesReadTotal/);
  assert.match(metaSlice, /webParseMsTotal/);
});

test("bundle_only authoritative persisted commit runs in background async mode", async () => {
  const source = await readServerSource();
  const helperStart = source.indexOf("const commitPersistedAfterRev1 = async");
  assert.ok(helperStart >= 0, "missing commitPersistedAfterRev1 helper");
  const helperSlice = source.slice(helperStart, helperStart + 1900);

  assert.match(helperSlice, /const bundleOnlyAuthoritative =/);
  assert.match(helperSlice, /streamAnalysisBundleOnly/);
  assert.match(helperSlice, /params\.identityType === "npn"/);
  assert.match(helperSlice, /params\.identityType === "dsldLabelId"/);
  assert.match(helperSlice, /params\.digest\.sourceType === "lnhpd"/);
  assert.match(helperSlice, /params\.digest\.sourceType === "dsld"/);
  assert.match(helperSlice, /persistedCommitMode = "background_async"/);
  assert.match(helperSlice, /void emitPersistedWhenReady\(bundle\)/);
  assert.match(helperSlice, /persistedCommitMode = "awaited"/);
  assert.match(helperSlice, /await emitPersistedWhenReady\(bundle\)/);
});

test("stream busy overload reason includes SERVER_OVERLOAD and retryAfterMs", async () => {
  const source = await readServerSource();
  const helperStart = source.indexOf("const emitStreamBusyAndFinalize =");
  assert.ok(helperStart >= 0, "missing emitStreamBusyAndFinalize helper");
  const helperSlice = source.slice(helperStart, helperStart + 900);

  assert.match(helperSlice, /"SERVER_OVERLOAD"/);
  assert.match(helperSlice, /retryAfterMs\s*=\s*reasonCode === "SERVER_OVERLOAD"/);
  assert.match(helperSlice, /retryAfterMs/);
});

test("degraded helper emits STREAM_DEGRADED and finalizes", async () => {
  const source = await readServerSource();
  const helperStart = source.indexOf("const emitDegradedLimitedRev1AndFinalize =");
  assert.ok(helperStart >= 0, "missing emitDegradedLimitedRev1AndFinalize helper");
  const helperEnd = source.indexOf("const maybeDegradeForEventLoopLag", helperStart);
  const helperSlice = source.slice(helperStart, helperEnd > helperStart ? helperEnd : helperStart + 20000);

  assert.match(
    helperSlice,
    /"DEGRADED_WEB_BUDGET"\s*\|\s*"DEGRADED_EVENTLOOP"\s*\|\s*"BUNDLE_ONLY_NO_AUTHORITATIVE_MATCH"/,
  );
  assert.match(helperSlice, /code:\s*"STREAM_DEGRADED"/);
  assert.match(helperSlice, /reasonCode/);
  assert.match(helperSlice, /finalizeStream\(`degraded_\$\{reasonCode\.toLowerCase\(\)\}`\)/);
  assert.match(helperSlice, /emitTerminalErrorAndFinalize\(\{/);
  assert.match(helperSlice, /code:\s*"STREAM_TIMEOUT"/);
  assert.match(helperSlice, /reasonCode:\s*"DEGRADED_FALLBACK_FAILED"/);
});

test("degraded helper keeps terminal reason consistent between meta and SSE error payload", async () => {
  const source = await readServerSource();
  const helperStart = source.indexOf("const emitDegradedLimitedRev1AndFinalize =");
  assert.ok(helperStart >= 0, "missing emitDegradedLimitedRev1AndFinalize helper");
  const helperEnd = source.indexOf("const maybeDegradeForEventLoopLag", helperStart);
  const helperSlice = source.slice(helperStart, helperEnd > helperStart ? helperEnd : helperStart + 20000);

  assert.match(helperSlice, /terminalReason\s*=\s*reasonCode/);
  assert.match(helperSlice, /code:\s*"STREAM_DEGRADED"/);
  assert.match(helperSlice, /reasonCode,\s*retryable:\s*true/);
});

test("degraded helper preserves authoritative source context when already confirmed", async () => {
  const source = await readServerSource();
  const helperStart = source.indexOf("const emitDegradedLimitedRev1AndFinalize =");
  assert.ok(helperStart >= 0, "missing emitDegradedLimitedRev1AndFinalize helper");
  const helperEnd = source.indexOf("const maybeDegradeForEventLoopLag", helperStart);
  const helperSlice = source.slice(helperStart, helperEnd > helperStart ? helperEnd : helperStart + 20000);

  assert.match(helperSlice, /const shouldPreserveAuthoritativeSource\s*=/);
  assert.match(helperSlice, /latestSourceType === "lnhpd" \|\| latestSourceType === "dsld"/);
  assert.match(helperSlice, /latestIdentityType === "npn" \|\| latestIdentityType === "dsldLabelId"/);
  assert.match(helperSlice, /activeStage0Winner === "verified_regulatory" \|\| activeStage0Winner === "label_record"/);
  assert.match(helperSlice, /stage0SourceTypeHint/);
  assert.match(helperSlice, /stage0IdentityTypeHint/);
  assert.match(helperSlice, /authoritativeIdentity:\s*degradedAuthoritativeIdentity/);
  assert.match(helperSlice, /sourceType:\s*degradedSourceType/);
  assert.match(helperSlice, /sourceTypeFinal:\s*degradedSourceTypeFinal/);
  assert.match(helperSlice, /const degradedSourceTypeFinal = latestSourceTypeFinal && shouldPreserveAuthoritativeSource/);
  assert.doesNotMatch(helperSlice, /sourceType:\s*"web",\s*sourceTypeFinal:\s*false/);
});

test("stage0 coordinator enforces rank-based single upgrade with full-chain abort", async () => {
  const source = await readServerSource();
  const startIdx = source.indexOf("const startStage0Bundle = (");
  assert.ok(startIdx >= 0, "missing startStage0Bundle helper");
  const slice = source.slice(startIdx, startIdx + 4200);

  assert.match(slice, /if \(stage0Rev1Locked \|\| streamState\.rev1Sent\)/);
  assert.match(slice, /const stage0CompletedWithoutRev1 = stage0StartCount > 0 && activeStage0RunId === null/);
  assert.match(slice, /const allowPostCompletionAuthoritativeUpgrade =/);
  assert.match(slice, /\(nextWinner === "verified_regulatory" \|\| nextWinner === "label_record"\)/);
  assert.match(slice, /if \(stage0CompletedWithoutRev1 && !allowPostCompletionAuthoritativeUpgrade\)/);
  assert.match(slice, /const stage0AuthoritativeWinner = nextWinner === "verified_regulatory" \|\| nextWinner === "label_record"/);
  assert.match(slice, /const effectiveAllowAi =/);
  assert.match(slice, /STAGE0_AUTHORITATIVE_DETERMINISTIC_REV1 && stage0AuthoritativeWinner/);
  assert.match(slice, /allowAi:\s*effectiveAllowAi/);
  assert.match(slice, /if \(allowPostCompletionAuthoritativeUpgrade\)/);
  assert.match(slice, /if \(stage0UpgradeCount >= 1\)/);
  assert.match(slice, /if \(nextRank <= activeStage0Rank\)/);
  assert.match(slice, /stage0BundleAbort\?\.abort\(new Error\("fast_bundle_replaced"\)\)/);
  assert.match(slice, /stage0UpgradeCount \+= 1/);
  assert.match(slice, /combineSignals\(\[\s*requestSignal,\s*stage0BundleAbort\.signal,\s*\]\)/);
  assert.match(slice, /isRunActive:\s*\(\) => activeStage0RunId === runId/);
});

test("negative cache clearing retries with breaker-bypass fallback on terminal paths", async () => {
  const source = await readServerSource();
  const helperStart = source.indexOf("const clearNegativeCacheAllVariants =");
  assert.ok(helperStart >= 0, "missing clearNegativeCacheAllVariants helper");
  const helperSlice = source.slice(helperStart, helperStart + 2600);

  assert.match(helperSlice, /clearNegativeCache\(/);
  assert.match(helperSlice, /primary negative-cache clear failed/);
  assert.match(helperSlice, /fallback negative-cache clear failed/);
  assert.match(helperSlice, /queueTimeoutMs:\s*0/);
  assert.match(helperSlice, /breaker:\s*undefined/);
  assert.match(helperSlice, /semaphore:\s*undefined/);
});

test("authoritative stage0 deterministic rev1 toggle defaults to enabled", async () => {
  const source = await readServerSource();
  assert.match(
    source,
    /const STAGE0_AUTHORITATIVE_DETERMINISTIC_REV1 = parseBooleanEnv\(\s*process\.env\.STAGE0_AUTHORITATIVE_DETERMINISTIC_REV1,\s*true,\s*\)/,
  );
});

test("full-stream DSLD deterministic rev1 canary defaults to disabled", async () => {
  const source = await readServerSource();
  assert.match(
    source,
    /const STAGE0_DSLD_FULL_STREAM_DETERMINISTIC_REV1_ENABLED = parseBooleanEnv\(\s*process\.env\.STAGE0_DSLD_FULL_STREAM_DETERMINISTIC_REV1_ENABLED,\s*false,\s*\)/,
  );
  assert.match(
    source,
    /const STAGE0_DSLD_FULL_STREAM_DETERMINISTIC_REV1_ALLOW_ALL = parseBooleanEnv\(\s*process\.env\.STAGE0_DSLD_FULL_STREAM_DETERMINISTIC_REV1_ALLOW_ALL,\s*false,\s*\)/,
  );
  assert.match(
    source,
    /const STAGE0_DSLD_FULL_STREAM_DETERMINISTIC_REV1_CANARY_BARCODES\s*=\s*parseCsvTokenSet\(/,
  );
});

test("process runtime diagnostics log fatal and lifecycle breadcrumbs", async () => {
  const source = await readServerSource();
  assert.match(source, /const buildProcessRuntimeDiagnostics = \(\) =>/);
  assert.match(source, /memoryUsage\(\)/);
  assert.match(source, /\[PROCESS_\$\{event\}\]/);
  assert.match(source, /logProcessRuntimeEvent\("UNHANDLED_REJECTION"/);
  assert.match(source, /logProcessRuntimeEvent\("UNCAUGHT_EXCEPTION"/);
  assert.match(source, /logProcessRuntimeEvent\("BEFORE_EXIT"/);
  assert.match(source, /logProcessRuntimeEvent\("EXIT"/);
  assert.match(source, /\[PROCESS_BOOT\]/);
});

test("overload guard rejects early when inFlight threshold is exceeded", async () => {
  const source = await readServerSource();
  const guardStart = source.indexOf("const inFlightCount = barcodeEnrichInFlight.size;");
  assert.ok(guardStart >= 0, "missing overload guard");
  const guardSlice = source.slice(guardStart, guardStart + 420);

  assert.match(guardSlice, /shouldRejectEnrichStreamForServerOverload\(\{/);
  assert.match(guardSlice, /inFlightCount,/);
  assert.match(guardSlice, /overloadInflightThreshold:\s*ENRICH_STREAM_OVERLOAD_INFLIGHT_THRESHOLD/);
  assert.doesNotMatch(guardSlice, /isEventLoopLagOverThreshold\(\)/);
  assert.match(guardSlice, /emitStreamBusyAndFinalize\("SERVER_OVERLOAD"\)/);
});

test("finalizeStream done payload always includes terminalReason and stability counters", async () => {
  const source = await readServerSource();
  const finalizeStart = source.indexOf("const finalizeStream = (reason: string) => {");
  assert.ok(finalizeStart >= 0, "missing finalizeStream helper");
  const finalizeSlice = source.slice(finalizeStart, finalizeStart + 1800);

  assert.match(finalizeSlice, /const resolvedReason = terminalReason \?\? reason;/);
  assert.match(finalizeSlice, /safeSendSse\(res,\s*"done",\s*\{/);
  assert.match(finalizeSlice, /terminalReason:\s*resolvedReason/);
  assert.match(finalizeSlice, /degradedMode/);
  assert.match(finalizeSlice, /stage0Winner:\s*activeStage0Winner/);
  assert.match(finalizeSlice, /stage0StartCount/);
  assert.match(finalizeSlice, /stage0ReplaceCount/);
});

test("watchdog timers are crash-guarded with terminal fallback errors", async () => {
  const source = await readServerSource();
  const watchdogStart = source.indexOf("const armContractWatchdogs = () => {");
  assert.ok(watchdogStart >= 0, "missing armContractWatchdogs helper");
  const watchdogSlice = source.slice(watchdogStart, watchdogStart + 12000);

  assert.match(watchdogSlice, /full pre-rev1 guard failed/);
  assert.match(watchdogSlice, /reasonCode:\s*"FULL_PRE_REV1_GUARD_INTERNAL_ERROR"/);
  assert.match(watchdogSlice, /hard terminal watchdog failed/);
  assert.match(watchdogSlice, /reasonCode:\s*"HARD_TERMINAL_WATCHDOG_INTERNAL_ERROR"/);
});

test("safety signal pack is attached in skeleton, provisional, and rev1 safety sections", async () => {
  const source = await readServerSource();

  const safetyPackStart = source.indexOf("const buildBaseSafetySignalPack =");
  assert.ok(safetyPackStart >= 0, "missing buildBaseSafetySignalPack helper");
  const safetyPackSlice = source.slice(safetyPackStart, safetyPackStart + 12000);
  assert.match(safetyPackSlice, /ulEntries:\s*\[\]/);

  const skeletonStart = source.indexOf("const buildAnalysisBundleSkeleton =");
  assert.ok(skeletonStart >= 0, "missing buildAnalysisBundleSkeleton helper");
  const skeletonSlice = source.slice(skeletonStart, skeletonStart + 9000);
  assert.match(
    skeletonSlice,
    /const baseSafetySignals = buildBaseSafetySignalPack\(\{\s*digest,\s*deterministicSignals:\s*params\.deterministicSignals,\s*\}\)/,
  );
  assert.match(skeletonSlice, /signals:\s*baseSafetySignals/);

  const provisionalStart = source.indexOf("const buildProvisionalAnalysisBundle =");
  assert.ok(provisionalStart >= 0, "missing buildProvisionalAnalysisBundle helper");
  const provisionalSlice = source.slice(provisionalStart, provisionalStart + 6000);
  assert.match(provisionalSlice, /buildBaseSafetySignalPack\(\{ digest: null, safetyDetail: null \}\)/);
  assert.match(provisionalSlice, /signals:\s*baseSafetySignals/);

  const mergeFastStart = source.indexOf("const mergeFastAnalysisBundle =");
  assert.ok(mergeFastStart >= 0, "missing mergeFastAnalysisBundle helper");
  const mergeFastSlice = source.slice(mergeFastStart, mergeFastStart + 26000);
  assert.match(mergeFastSlice, /const safetySignalsFinal = buildBaseSafetySignalPack\(/);
  assert.match(mergeFastSlice, /signals:\s*safetySignalsFinal/);
});
