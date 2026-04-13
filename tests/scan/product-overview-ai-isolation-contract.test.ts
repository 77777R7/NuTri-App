import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';

const DASHBOARD_FILE = path.join(process.cwd(), 'components/scan/AnalysisDashboard.tsx');
const SERVER_FILE = path.join(process.cwd(), 'backend/src/server.ts');
const DEEPSEEK_FILE = path.join(process.cwd(), 'backend/src/deepseek.ts');

const dashboardSource = fs.readFileSync(DASHBOARD_FILE, 'utf8');
const serverSource = fs.readFileSync(SERVER_FILE, 'utf8');
const deepseekSource = fs.readFileSync(DEEPSEEK_FILE, 'utf8');

const readBetween = (input: string, startToken: string, endToken: string): string => {
  const start = input.indexOf(startToken);
  const end = input.indexOf(endToken, start + startToken.length);
  assert.ok(start >= 0, `missing token: ${startToken}`);
  assert.ok(end > start, `missing token after ${startToken}: ${endToken}`);
  return input.slice(start, end);
};

test('product overview detail uses What is it + Key Product Facts and shows AI generating state', () => {
  const overviewSection = readBetween(
    dashboardSource,
    'const overviewContent = (',
    'const decisionBarcodeForScience = ',
  );

  assert.ok(overviewSection.includes('title="What is it?"'));
  assert.ok(overviewSection.includes('title="Key Product Facts"'));
  assert.ok(overviewSection.includes('AI generating'));
  assert.ok(overviewSection.includes('styles.detailNarrativeText'));
  assert.equal(overviewSection.includes('title="What this supplement may help support"'), false);
  assert.equal(overviewSection.includes('title="How to take it"'), false);
  assert.equal(overviewSection.includes('Serving strength'), false);
});

test('product overview AI stays sidecar-only on the frontend', () => {
  assert.ok(
    dashboardSource.includes("const [productOverviewAiByDigest, setProductOverviewAiByDigest] = useState<Record<string, ProductOverviewAiState>>({});"),
  );
  assert.ok(
    dashboardSource.includes("const productOverviewAiStateRef = useRef<Record<string, ProductOverviewAiState>>({});"),
  );
  assert.ok(dashboardSource.includes('const setProductOverviewAiState = useCallback('));
  assert.ok(dashboardSource.includes('/api/product-overview-ai/v1'));
  assert.ok(dashboardSource.includes("right={<GlassPill label={resolveSimpleTaxonomyLabel('AI summary')} />}"));
  assert.ok(dashboardSource.includes('AI summary unavailable'));
  assert.ok(dashboardSource.includes("source !== 'api' && currentOverviewAiState.source !== 'server-fallback'"));
  assert.ok(dashboardSource.includes("status: 'loading'"));
  assert.ok(dashboardSource.includes("status: 'idle'"));
  assert.equal(dashboardSource.includes('client-fallback'), false);
});

test('decision-support fetch waits out transient web skeleton state before calling the authority route', () => {
  assert.ok(
    dashboardSource.includes('const sourceType = normalizeText(bundleState.meta.sourceType ?? null).toLowerCase();'),
  );
  assert.ok(dashboardSource.includes('const isWebSkeletonPhase ='));
  assert.ok(dashboardSource.includes("sourceType === 'web'"));
  assert.ok(dashboardSource.includes("bundleState.meta.phase === 'skeleton' || isStreaming"));
  assert.ok(dashboardSource.includes('if (isWebSkeletonPhase) {'));
});

test('product overview AI route is isolated from shared decision-support authority', () => {
  assert.ok(serverSource.includes('app.post("/api/product-overview-ai/v1", verifySupabaseToken, async (req: Request, res: Response) => {'));
  assert.ok(serverSource.includes('fetchProductOverviewWhatIsIt'));
  assert.ok(serverSource.includes('buildProductOverviewWhatIsItFallback'));
  assert.ok(serverSource.includes('source: "fallback"'));
  assert.ok(serverSource.includes('source: "api"'));
  assert.ok(serverSource.includes('fallbackUsed: true'));
  assert.ok(serverSource.includes('fallbackReason: reason'));
});

test('product overview AI prompt contract is richer than the legacy overview summary', () => {
  assert.ok(deepseekSource.includes('PROMPT_PRODUCT_OVERVIEW_WHAT_IS_IT'));
  assert.ok(deepseekSource.includes('STYLE REFERENCE (do not copy unless it matches the facts)'));
  assert.ok(deepseekSource.includes('"mode": "short or rich"'));
  assert.ok(deepseekSource.includes('"lead": "One sentence that identifies the product or ingredient clearly."'));
  assert.ok(deepseekSource.includes('"whyPeopleTakeIt": "One or two sentences explaining common shopper use'));
});
