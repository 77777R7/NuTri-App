import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';

const DASHBOARD_PATH = path.resolve(process.cwd(), 'components/scan/AnalysisDashboard.tsx');
const SERVER_PATH = path.resolve(process.cwd(), 'backend/src/server.ts');

test('authority lifecycle is an explicit state machine and seeded payloads cannot open the gate', async () => {
  const source = await readFile(DASHBOARD_PATH, 'utf8');

  assert.match(source, /type DecisionAuthorityState = \{/);
  assert.match(source, /type DecisionAuthorityStatus = 'pending' \| 'ready' \| 'terminal_no_authority';/);
  assert.match(source, /status: DecisionAuthorityStatus;/);
  assert.match(source, /const buildPendingDecisionAuthorityState = \(scopeKey: string\): DecisionAuthorityState => \(\{/);
  assert.match(source, /setDecisionAuthorityState\(buildPendingDecisionAuthorityState\(decisionSupportAuthorityScopeSeedKey\)\);/);
  assert.match(source, /const allowSeededDecision = shouldUseDecisionPayloadForBundle\(\{/);
  assert.doesNotMatch(source, /seededDecision[\s\S]{0,400}setDecisionAuthorityState\(/);
  assert.match(source, /setDecisionAuthorityState\(\{\s*status: 'ready'/);
  assert.match(source, /setDecisionAuthorityState\(\{\s*status: 'terminal_no_authority'/);
  assert.match(source, /requestSeq === decisionSupportRequestSeqRef\.current/);
  assert.match(source, /decisionSupportAuthorityScopeKeyRef\.current === authorityScopeKeyForRequest/);
});

test('decision payload caches are stripped and no longer merge personalization back into the base template', async () => {
  const source = await readFile(DASHBOARD_PATH, 'utf8');

  assert.match(source, /const stripDecisionPayloadPersonalization = \(/);
  assert.match(source, /const getCachedBaseDecisionPayload = \(/);
  assert.match(source, /const decisionSupportWarmCache = new Map<string, Record<string, unknown>>\(\);/);
  assert.match(source, /const decisionSupportFullCacheRef = useRef<Map<string, Record<string, unknown>>>\(new Map\(\)\);/);
  assert.match(source, /decisionSupportCacheRef\.current\.set\(decisionBaseCacheKey, basePayload\);/);
  assert.match(source, /decisionSupportFullCacheRef\.current\.set\(decisionFullCacheKey, objectPayload\);/);
  assert.match(source, /upsertDecisionPayloadByBarcode\(\s*decisionSupportByBarcodeRef\.current,\s*resolvedBarcode,\s*basePayload,/);
  assert.ok(!source.includes('mergeDecisionPayloadPersonalization('));
});

test('decision-support route exposes explicit personalization authority metadata', async () => {
  const source = await readFile(SERVER_PATH, 'utf8');

  assert.match(source, /authoritativePersonalizationReady: true,/);
  assert.match(source, /personalizationAttachmentStatus: attachedContexts\.personalizationAttachmentStatus,/);
  assert.match(source, /personalizationScopeHash: attachedContexts\.personalizationScopeHash,/);
  assert.match(source, /type DecisionSupportPersonalizationAttachmentStatus = "attached" \| "partial" \| "none";/);
});
