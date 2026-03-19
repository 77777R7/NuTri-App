import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';

const DASHBOARD_FILE = path.join(process.cwd(), 'components/scan/AnalysisDashboard.tsx');
const RESULT_FILE = path.join(process.cwd(), 'app/scan/result.tsx');
const I18N_FILE = path.join(process.cwd(), 'lib/i18n.ts');
const RECENT_SCAN_SAVE_CHAIN_TEST_FILE = path.join(
  process.cwd(),
  'backend/tests/recent-scan-save-chain-contract.test.mjs',
);

const dashboardSource = fs.readFileSync(DASHBOARD_FILE, 'utf8');
const resultSource = fs.readFileSync(RESULT_FILE, 'utf8');
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

test('scan trust contract removes the old AI Analysis label from visible scan result cards and preserves deep categories copy', () => {
  assert.equal(resultSource.includes('AI Analysis'), false);
  assert.ok(resultSource.includes('<Text style={styles.labelCardTitle}>Analysis</Text>'));
  assert.ok(i18nSource.includes("analysisDeepCategoriesTitle: 'Deep Categories'"));
  assert.ok(i18nSource.includes("analysisDeepCategoriesSubtitle: 'Tap to view detailed analysis'"));
});

test('recent scan save chain contract still preserves dosageText and imageUrl assertions', () => {
  assert.ok(recentScanSaveChainTestSource.includes("assert.match(source, /dosageText: item\\.dosageText \\?\\? '',/);"));
  assert.ok(recentScanSaveChainTestSource.includes("assert.match(source, /imageUrl: item\\.imageUrl \\?\\? null,/);"));
});
