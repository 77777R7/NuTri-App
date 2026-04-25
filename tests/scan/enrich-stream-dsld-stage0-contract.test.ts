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
