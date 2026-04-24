import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';

const DASHBOARD_FILE = path.join(process.cwd(), 'components/scan/AnalysisDashboard.tsx');

test('decision-support fetch is deferred for provisional web skeletons', () => {
  const source = fs.readFileSync(DASHBOARD_FILE, 'utf8');
  const skeletonBlockIndex = source.indexOf('if (isWebSkeletonPhase) {');
  const fetchMetricIndex = source.indexOf("emitScanUxMetric('decision_support_fetch'");

  assert.ok(skeletonBlockIndex >= 0, 'expected provisional web skeleton guard');
  assert.ok(fetchMetricIndex > skeletonBlockIndex, 'network fetch metric should happen after skeleton guard');
  assert.match(
    source.slice(skeletonBlockIndex, fetchMetricIndex),
    /return;\s*}\s*if \(/s,
    'web skeleton guard should return before decision-support fetch starts',
  );
});

test('decision-support fetch is skipped when final inline payload is renderable', () => {
  const source = fs.readFileSync(DASHBOARD_FILE, 'utf8');

  assert.match(source, /seededPayload\s*&&\s*!shouldUseLocalDecisionSupport\s*&&\s*sourceTypeFinal/s);
  assert.match(source, /hasRenderableDecisionTemplate\(seededPayload\)/);
  assert.match(source, /decisionSupportFetchKeyRef\.current = `\$\{normalizedSessionId\}\|inline\|\$\{decisionCacheKey\}`/);
});

test('decision-support network fetch is capped once per scan session and barcode scope', () => {
  const source = fs.readFileSync(DASHBOARD_FILE, 'utf8');

  assert.match(source, /const decisionSupportNetworkScopeRef = useRef<string \| null>\(null\)/);
  assert.match(source, /decisionSupportNetworkScopeRef\.current = null/);
  assert.match(source, /const networkScopeKey = \[/);
  assert.match(source, /if \(decisionSupportNetworkScopeRef\.current === networkScopeKey\) return/);
  assert.match(source, /decisionSupportNetworkScopeRef\.current = networkScopeKey/);
});
