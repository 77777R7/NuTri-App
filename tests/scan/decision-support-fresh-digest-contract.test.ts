import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';

const DASHBOARD_PATH = path.resolve(process.cwd(), 'components/scan/AnalysisDashboard.tsx');

test('decision support prefers the fetched digest over a stale bundle digest before science sidecars derive request keys', async () => {
  const source = await readFile(DASHBOARD_PATH, 'utf8');

  assert.match(source, /const fetchedDecisionDigest =/);
  assert.match(source, /fetchedPayload && !isDecisionPayloadExplicitlyStale\(fetchedPayload\)/);
  assert.match(source, /const currentDecisionDigest =\s*fetchedDecisionDigest/);
  assert.match(source, /const resolvedDecisionDigest =/);
  assert.match(source, /getDecisionPayloadDigest\(objectPayload\)/);
  assert.match(source, /pickFreshDecisionPayloadForFacts\(\s*currentFactsDigestHash,\s*resolvedDecisionDigest,/s);
});

test('decision support keeps local personalization enabled in no-auth builds even if a stale auth token exists', async () => {
  const source = await readFile(DASHBOARD_PATH, 'utf8');

  assert.match(source, /AUTH_DISABLED/);
  assert.match(source, /Boolean\(localDecisionSupportHeader\) && \(AUTH_DISABLED \|\| !authToken\)/);
});
