import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const SERVER_PATH = path.resolve(__dirname, "../src/server.ts");

test("bundle_only label_record Stage0 toggle defaults to enabled", async () => {
  const source = await readFile(SERVER_PATH, "utf8");
  assert.match(
    source,
    /const BUNDLE_ONLY_ALLOW_LABEL_RECORD_STAGE0 = parseBooleanEnv\(\s*process\.env\.BUNDLE_ONLY_ALLOW_LABEL_RECORD_STAGE0,\s*true,\s*\);/,
  );
});

test("stage0 coordinator allows label_record winner in bundle_only when toggle is enabled", async () => {
  const source = await readFile(SERVER_PATH, "utf8");
  const startIdx = source.indexOf("const startStage0Bundle = (");
  assert.ok(startIdx >= 0, "missing startStage0Bundle helper");
  const slice = source.slice(startIdx, startIdx + 2200);

  assert.match(
    slice,
    /nextWinner === "verified_regulatory"\s*\|\|\s*\(BUNDLE_ONLY_ALLOW_LABEL_RECORD_STAGE0 && nextWinner === "label_record"\)/,
  );
  assert.match(
    slice,
    /if \(streamAnalysisBundleOnly && BUNDLE_ONLY_SKIP_WEB_SEARCH && !bundleOnlyStage0WinnerAllowed\)/,
  );
});

test("cached snapshot bundle_only short-circuits use authoritative fast path including label_record", async () => {
  const source = await readFile(SERVER_PATH, "utf8");
  const fastPathIdx = source.indexOf("if (cachedFast && !bypassCachedFastPathForAuthority)");
  assert.ok(fastPathIdx >= 0, "missing cachedFast branch");
  const slice = source.slice(fastPathIdx, fastPathIdx + 5200);

  assert.match(source, /const snapshotIsAuthoritativeFastPath = hasBundleOnlyAuthoritativeFastPath\(cachedFast\.snapshot\);/);
  assert.match(source, /if \(streamAnalysisBundleOnly && !forceStage1 && !snapshotIsAuthoritativeFastPath\)/);

  const stage0SkipIdx = source.indexOf("snapshot_bundle_only_skip_stage0");
  assert.ok(stage0SkipIdx >= 0, "missing snapshot_bundle_only_skip_stage0 gate");
  assert.match(
    source,
    /const snapshotIsAuthoritativeForBundleOnly =\s*snapshotIsVerified \|\| hasBundleOnlyLabelRecordIdentityFromSnapshot\(cachedFast\.snapshot\);/,
  );
  assert.match(source, /if \(streamAnalysisBundleOnly && !snapshotIsAuthoritativeForBundleOnly\)/);
});
