import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';

const DASHBOARD_PATH = path.resolve(process.cwd(), 'components/scan/AnalysisDashboard.tsx');

test('decision support prefers the fetched digest over a stale bundle digest before science sidecars derive request keys', async () => {
  const source = await readFile(DASHBOARD_PATH, 'utf8');

  assert.match(source, /const fetchedDecisionDigest =/);
  assert.match(source, /fetchedPayload && !isDecisionPayloadExplicitlyStale\(fetchedPayload\)/);
  assert.match(source, /const bundleDecisionDigest =/);
  assert.match(source, /const currentDecisionDigest =\s*bundleDecisionDigest \|\| fetchedDecisionDigest/);
  assert.match(source, /const resolvedDecisionDigest =/);
  assert.match(source, /getDecisionPayloadDigest\(objectPayload\)/);
  assert.match(source, /const pickCompatibleDecisionPayload =/);
  assert.match(source, /isProvisionalWebBundleSource\(params\.bundleSourceType,\s*params\.bundleSourceTypeFinal\)/);
  assert.match(source, /pickAuthoritativeDecisionPayloadUpgrade\(\.\.\.params\.payloads\)/);
  assert.match(source, /pickCompatibleDecisionPayload\(\{\s*factsDigestHash:\s*currentFactsDigestHash,\s*decisionDigest:\s*resolvedDecisionDigest,/s);
});

test('decision support keeps local personalization enabled for scan requests whenever local profile signals exist', async () => {
  const source = await readFile(DASHBOARD_PATH, 'utf8');

  assert.match(source, /Boolean\(localDecisionSupportHeader\)/);
  assert.match(source, /const usingLocalDecisionSupport = Boolean\(localDecisionSupportHeader\)/);
  assert.match(source, /headers\['x-local-personalization'\] = localDecisionSupportHeader/);
});
