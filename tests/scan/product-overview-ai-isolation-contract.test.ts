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

  const aiEffectSlice = readBetween(
    dashboardSource,
    "useEffect(() => {\n        if (!overviewAiDigest || !overviewAiRequestFingerprint || decisionSupportState.status !== 'ready') return;",
    'const overviewContent = (',
  );

  assert.ok(dashboardSource.includes('const buildProductOverviewFallbackClient = ('));
  assert.ok(dashboardSource.includes('const overviewAiFallback = useMemo('));
  assert.ok(aiEffectSlice.includes('productOverviewAiStateRef.current[overviewAiDigest]'));
  assert.ok(aiEffectSlice.includes('const currentOverviewAi = productOverviewAiStateRef.current[overviewAiDigest];'));
  assert.ok(aiEffectSlice.includes("decisionSupportState.status !== 'ready'"));
  assert.ok(aiEffectSlice.includes('InteractionManager.runAfterInteractions'));
  assert.ok(aiEffectSlice.includes('if (overviewAiFallback) {'));
  assert.ok(aiEffectSlice.includes("promptVersion: 'client-fallback'"));
  assert.ok(aiEffectSlice.includes('setProductOverviewAiState(overviewAiDigest, {'));
  assert.ok(aiEffectSlice.includes('setProductOverviewAiState(overviewAiDigest, (current) => {'));
  assert.equal(aiEffectSlice.includes('setDecisionSupportState'), false);
  assert.ok(aiEffectSlice.includes('fingerprint: overviewAiRequestFingerprint'));
  assert.ok(aiEffectSlice.includes('const controller = new AbortController();'));
  assert.ok(aiEffectSlice.includes('interactionTask.cancel();'));
  assert.ok(aiEffectSlice.includes("status: 'idle'"));
  assert.ok(aiEffectSlice.includes("current.fingerprint !== overviewAiRequestFingerprint"));
  assert.ok(aiEffectSlice.includes('const shouldShowOverviewAiLoading ='));
  assert.ok(aiEffectSlice.includes("currentOverviewAiStatus === 'loading' && currentOverviewAiMatchesFingerprint"));
  assert.equal(aiEffectSlice.includes("selectedTileType !== 'overview'"), false);
});

test('decision-support fetch waits out transient web skeleton state before calling the authority route', () => {
  const fetchEffectSlice = readBetween(
    dashboardSource,
    'const sourceType = normalizeText(bundleState.meta.sourceType ?? null).toLowerCase();',
    'const run = async (digestParam: string | null, canRetry: boolean): Promise<void> => {',
  );

  assert.ok(fetchEffectSlice.includes('const isWebSkeletonPhase ='));
  assert.ok(fetchEffectSlice.includes("sourceType === 'web'"));
  assert.ok(fetchEffectSlice.includes("bundleState.meta.phase === 'skeleton' || isStreaming"));
  assert.ok(fetchEffectSlice.includes('if (isWebSkeletonPhase) {'));
});

test('product overview AI route is isolated from shared decision-support authority', () => {
  const routeSlice = readBetween(
    serverSource,
    'app.post("/api/product-overview-ai/v1", verifySupabaseToken, async (req: Request, res: Response) => {',
    '/**\n * Product-specific ingredient narrative compiler',
  );

  assert.ok(routeSlice.includes('fetchProductOverviewWhatIsIt'));
  assert.ok(routeSlice.includes('buildProductOverviewWhatIsItFallback'));
  assert.ok(routeSlice.includes('fallbackUsed: true'));
  assert.ok(routeSlice.includes('fallbackReason: reason'));
  assert.equal(routeSlice.includes('compileDecisionSupport'), false);
  assert.equal(routeSlice.includes('toDecisionSupportInline'), false);
  assert.equal(routeSlice.includes('ANALYSIS_BUNDLE_PROMPT_VERSION'), false);
});

test('product overview AI prompt contract is richer than the legacy overview summary', () => {
  assert.ok(deepseekSource.includes('PROMPT_PRODUCT_OVERVIEW_WHAT_IS_IT'));
  assert.ok(deepseekSource.includes('STYLE REFERENCE (do not copy unless it matches the facts)'));
  assert.ok(deepseekSource.includes('"mode": "short or rich"'));
  assert.ok(deepseekSource.includes('"lead": "One sentence that identifies the product or ingredient clearly."'));
  assert.ok(deepseekSource.includes('"whyPeopleTakeIt": "One or two sentences explaining common shopper use'));
});
