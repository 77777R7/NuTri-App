import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';

const DASHBOARD_PATH = path.resolve(process.cwd(), 'components/scan/AnalysisDashboard.tsx');

test('decision support 409 contract retries once and falls back without loop', async () => {
  const source = await readFile(DASHBOARD_PATH, 'utf8');
  const idx = source.indexOf('api/decision-support/v1');
  assert.ok(idx >= 0, 'missing decision support endpoint fetch');
  const slice = source.slice(idx - 900, idx + 2600);

  assert.match(slice, /if \(res\.status === 409\)/);
  assert.match(slice, /const latestDigest =/);
  assert.match(slice, /if \(canDigestRetry && latestDigest && latestDigest !== digestParam\)/);
  assert.match(slice, /return run\(latestDigest, false, retryAttempt\)/);
  assert.match(slice, /Decision support content updated\. Refresh required\./);
  assert.match(slice, /staleDigest: true/);
});
