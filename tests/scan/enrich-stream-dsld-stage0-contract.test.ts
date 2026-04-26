import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';

const SERVER_FILE = path.join(process.cwd(), 'backend/src/server.ts');

test('full-stream DSLD deterministic Stage0 bypasses cached fast before cover contract', () => {
  const serverSource = fs.readFileSync(SERVER_FILE, 'utf8');
  const start = serverSource.indexOf(
    'const skipCachedFastForBundleOnlyDeterministic =',
  );
  const end = serverSource.indexOf(
    'if (\n          cachedFast?.payload',
    start,
  );
  assert.ok(start >= 0, 'missing cached-fast skip block');
  assert.ok(end > start, 'missing cached-fast payload block after skip block');
  const block = serverSource.slice(start, end);

  assert.ok(
    block.includes('const skipCachedFastForFullDsldDeterministic ='),
    'full-stream DSLD deterministic skip flag must exist',
  );
  assert.ok(
    block.includes('STAGE0_DSLD_FULL_STREAM_DETERMINISTIC_REV1_ENABLED') &&
      block.includes('!streamAnalysisBundleOnly') &&
      block.includes('params.digest.sourceType === "dsld"') &&
      block.includes('params.allowAi === false'),
    'full-stream DSLD Stage0 cached-fast bypass must stay behind the canary gate',
  );
  assert.ok(
    block.includes('skipCachedFastForDeterministicStage0') &&
      block.includes('skipCachedFastForFullDsldDeterministic'),
    'cached-fast lookup must use the combined deterministic Stage0 skip flag',
  );
  assert.ok(
    block.includes('dsld deterministic stage0 skipping cached fast'),
    'skip path should leave an explicit production log breadcrumb',
  );
});
