import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';

const ROUTE_FILE = path.join(process.cwd(), 'backend/src/routes/enrichStreamRoute.ts');

test('full-stream DSLD deterministic Stage0 bypasses cached fast before cover contract', () => {
  const source = fs.readFileSync(ROUTE_FILE, 'utf8');
  const blockMatch = source.match(
    /const skipCachedFastForBundleOnlyDeterministic =[\s\S]*?let cachedFast = skipCachedFastForDeterministicStage0/,
  );

  assert.ok(blockMatch, 'cached-fast lookup must use deterministic Stage0 skip flag');
  const block = blockMatch[0];
  assert.ok(block.includes('const skipCachedFastForFullDsldDeterministic ='));
  assert.ok(block.includes('!streamAnalysisBundleOnly'));
  assert.ok(block.includes('params.digest.sourceType === "dsld"'));
  assert.ok(block.includes('params.allowAi === false'));
  assert.ok(block.includes('dsld deterministic stage0 skipping cached fast'));
});

test('full-stream DSLD deterministic Stage0 has a bounded no-AI rev1 path', () => {
  const source = fs.readFileSync(ROUTE_FILE, 'utf8');
  const blockMatch = source.match(
    /const deterministicNoAiFastPath =[\s\S]*?const emittedRev1 = emitRev1Once\([\s\S]*?deterministicFallbackReason,[\s\S]*?\);/,
  );

  assert.ok(blockMatch, 'full-stream DSLD must not fall through to the generic fast merge path');
  const block = blockMatch[0];
  assert.ok(block.includes('streamAnalysisBundleOnly || skipCachedFastForFullDsldDeterministic'));
  assert.ok(block.includes('dsld_full_stream_no_ai_fast_path'));
  assert.ok(block.includes('[analysis_bundle] cover_contract'));
  assert.ok(block.includes('emitRev1Once'));
});
