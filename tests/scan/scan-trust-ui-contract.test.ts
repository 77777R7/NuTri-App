import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';

const DASHBOARD_FILE = path.join(process.cwd(), 'components/scan/AnalysisDashboard.tsx');
const RESULT_FILE = path.join(process.cwd(), 'app/scan/result.tsx');
const HEADER_CHROME_FILE = path.join(process.cwd(), 'components/scan/ScanResultHeaderChrome.tsx');
const I18N_FILE = path.join(process.cwd(), 'lib/i18n.ts');
const RECENT_SCAN_SAVE_CHAIN_TEST_FILE = path.join(
  process.cwd(),
  'backend/tests/recent-scan-save-chain-contract.test.mjs',
);

const dashboardSource = fs.readFileSync(DASHBOARD_FILE, 'utf8');
const resultSource = fs.readFileSync(RESULT_FILE, 'utf8');
const headerChromeSource = fs.readFileSync(HEADER_CHROME_FILE, 'utf8');
const i18nSource = fs.readFileSync(I18N_FILE, 'utf8');
const recentScanSaveChainTestSource = fs.readFileSync(RECENT_SCAN_SAVE_CHAIN_TEST_FILE, 'utf8');

test('scan trust contract exposes a dedicated Learn More CTA and modal copy without reusing the old AI eyebrow', () => {
  assert.ok(i18nSource.includes("analysisLearnMoreCta: 'Learn More'"));
  assert.ok(i18nSource.includes("analysisLearnMoreWhatIsTitle: 'What is NuTri Score?'"));
  assert.ok(i18nSource.includes("analysisLearnMoreConfidenceGuideTitle: 'Final rating guide'"));
  assert.ok(dashboardSource.includes('const ScoreLearnMoreModal: React.FC<{'));
  assert.ok(dashboardSource.includes('accessibilityLabel={t.analysisLearnMoreCta}'));
  assert.ok(dashboardSource.includes('<ScoreLearnMoreModal visible={learnMoreVisible} onClose={() => setLearnMoreVisible(false)} />'));
  assert.equal(dashboardSource.includes('t.analysisHeaderEyebrow'), false);
});

test('scan trust contract preserves the sectioned analysis shell and deep dive copy', () => {
  assert.equal(resultSource.includes('AI Analysis'), false);
  assert.ok(i18nSource.includes("analysisSectionNutriScoreTitle: 'NuTri Score'"));
  assert.ok(i18nSource.includes("analysisSectionNutriScoreSubtitle: 'Tap to view detailed analysis'"));
  assert.ok(i18nSource.includes("analysisSectionDeepDiveTitle: 'Deep Dive'"));
  assert.ok(i18nSource.includes("analysisSectionDeepDiveSubtitle: 'Tap to view detailed analysis'"));
  assert.ok(i18nSource.includes("analysisSectionComparisonTitle: 'Comparison with similar products'"));
  assert.ok(i18nSource.includes("analysisSectionComparisonSubtitle: 'See how this product stands and explore higher-scoring options'"));
  assert.ok(i18nSource.includes("analysisComparisonAlternativesTitle: 'Higher-scoring alternatives'"));
  assert.equal(dashboardSource.includes('t.analysisSectionPersonalInsightTitle'), false);
  assert.ok(dashboardSource.includes('t.analysisSectionNutriScoreTitle'));
  assert.ok(dashboardSource.includes('t.analysisSectionNutriScoreSubtitle'));
  assert.ok(dashboardSource.includes('t.analysisSectionDeepDiveTitle'));
  assert.ok(dashboardSource.includes('t.analysisSectionDeepDiveSubtitle'));
  assert.ok(dashboardSource.includes('t.analysisSectionComparisonTitle'));
  assert.ok(dashboardSource.includes('t.analysisSectionComparisonSubtitle'));
  assert.ok(dashboardSource.includes('t.analysisComparisonAlternativesTitle'));
  assert.ok(dashboardSource.includes('comparisonStandingCard'));
  assert.ok(dashboardSource.includes('ComparisonAlternativeCard'));
  assert.ok(dashboardSource.includes("standing.status !== 'ready'"));
  assert.ok(dashboardSource.includes('canonicalIdentityConfidenceHigh'));
  assert.ok(dashboardSource.includes('resolveCanonicalBarcodeFromBundleMeta'));
  assert.ok(dashboardSource.includes('const authoritativeIdentityType ='));
  assert.ok(dashboardSource.includes("typeof bundleState.meta.authoritativeIdentity?.type === 'string'"));
  assert.ok(dashboardSource.includes('const authoritativeIdentityValue ='));
  assert.ok(dashboardSource.includes("typeof bundleState.meta.authoritativeIdentity?.value === 'string'"));
  assert.ok(dashboardSource.includes('canonicalBarcodeGtin14'));
  assert.equal(dashboardSource.includes('styles.scoreV2Eyebrow'), false);
  assert.ok(dashboardSource.includes("params.set('productName', decisionSupportProductName)"));
  assert.ok(dashboardSource.includes("params.set('brandName', decisionSupportBrandName)"));
  assert.ok(dashboardSource.includes('const bundleDecisionDigest ='));
  assert.ok(dashboardSource.includes('pickFreshDecisionPayloadForFacts('));
  assert.ok(dashboardSource.includes('pickStrongestDecisionPayloadForFacts('));
  assert.ok(dashboardSource.includes('const pickCompatibleDecisionPayload ='));
  assert.ok(dashboardSource.includes('pickAuthoritativeDecisionPayloadUpgrade('));
  assert.match(dashboardSource, /stripDecisionPayloadPersonalization/);
  assert.match(dashboardSource, /const buildPendingDecisionAuthorityState = \(scopeKey: string\): DecisionAuthorityState => \(\{/);
  assert.match(dashboardSource, /authoritativePersonalizationReady === true/);
  assert.match(dashboardSource, /status: 'terminal_no_authority'/);
});

test('recent scan save chain contract still preserves dosageText and imageUrl assertions', () => {
  assert.ok(
    recentScanSaveChainTestSource.includes(
      String.raw`assert.match(source, /dosageText: item\.dosageText \?\? '',/);`,
    ),
  );
  assert.ok(
    recentScanSaveChainTestSource.includes(
      String.raw`assert.match(source, /imageUrl: item\.imageUrl \?\? null,/);`,
    ),
  );
});

test('mini score bubble trigger follows measured NuTri Score anchors instead of fixed scan shell thresholds', () => {
  assert.equal(resultSource.includes('const HEADER_MINI_SCORE_START = 210;'), false);
  assert.ok(resultSource.includes('const DEFAULT_HEADER_MINI_SCORE_TRIGGER'));
  assert.ok(resultSource.includes('onMiniScoreTriggerChange={handleHeaderMiniScoreTriggerChange}'));
  assert.ok(resultSource.includes('miniScoreThresholdStart={headerMiniScoreTrigger.start}'));
  assert.ok(resultSource.includes('miniScoreThresholdRange={headerMiniScoreTrigger.range}'));
  assert.ok(dashboardSource.includes('onMiniScoreTriggerChange?: (trigger: { start: number; range: number }) => void;'));
  assert.ok(dashboardSource.includes("module.id === 'ingredient_safety'"));
  assert.ok(dashboardSource.includes('HEADER_MINI_SCORE_REVEAL_OFFSET'));
  assert.ok(dashboardSource.includes('thresholdStart={miniScoreTrigger.start}'));
  assert.ok(dashboardSource.includes('thresholdRange={miniScoreTrigger.range}'));
  assert.ok(headerChromeSource.includes('top: 4'));
  assert.ok(headerChromeSource.includes('bottom: 4'));
  assert.ok(headerChromeSource.includes('top: 0'));
  assert.ok(headerChromeSource.includes('left: 0'));
  assert.ok(headerChromeSource.includes('right: 0'));
  assert.ok(headerChromeSource.includes('width: 56'));
  assert.ok(headerChromeSource.includes('height: 56'));
  assert.ok(headerChromeSource.includes('fontSize: 17'));
});
