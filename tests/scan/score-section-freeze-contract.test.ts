import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';

const DASHBOARD_FILE = path.join(process.cwd(), 'components/scan/AnalysisDashboard.tsx');
const source = fs.readFileSync(DASHBOARD_FILE, 'utf8');

const readBetween = (input: string, startToken: string, endToken: string): string => {
  const start = input.indexOf(startToken);
  const end = input.indexOf(endToken);
  assert.ok(start >= 0, `missing token: ${startToken}`);
  assert.ok(end > start, `missing token after ${startToken}: ${endToken}`);
  return input.slice(start, end);
};

test('score section payload stays isolated from detail AI and summary copy', () => {
  const frozenPayload = readBetween(
    source,
    'SCORE_SECTION_FROZEN_PAYLOAD_START',
    'SCORE_SECTION_FROZEN_PAYLOAD_END',
  );

  assert.ok(frozenPayload.includes("const scoreCardV2Payload = decisionTemplatePayload?.nutriScoreCardV2 ?? null;"));
  assert.ok(frozenPayload.includes('const scoreCardV2DisplayModules = useMemo<DecisionScoreCardV2Module[]>(() => {'));

  const forbiddenTokens = [
    'decisionOverviewBlock?.aiProductPurpose',
    'decisionScienceBlock?.aiFormulaAnalysis',
    'overviewSummaryText',
    'scienceAiSummary',
    'containsLine',
    "What it's for",
    'Formula analysis',
  ];

  for (const token of forbiddenTokens) {
    assert.equal(
      frozenPayload.includes(token),
      false,
      `score payload must stay independent from detail/AI token: ${token}`,
    );
  }
});

test('score section state stays isolated from detail AI and summary copy', () => {
  const frozenState = readBetween(
    source,
    'SCORE_SECTION_FROZEN_STATE_START',
    'SCORE_SECTION_FROZEN_STATE_END',
  );

  assert.ok(frozenState.includes('const effectiveScoreUiMode: ScoreUiMode ='));
  assert.ok(frozenState.includes('const ringScores ='));
  assert.ok(frozenState.includes("const scoreNotScoredCause: ScoreNotScoredCause | null ="));

  const forbiddenTokens = [
    'decisionOverviewBlock?.aiProductPurpose',
    'decisionScienceBlock?.aiFormulaAnalysis',
    'scienceAiSummary',
    'containsLine',
    "What it's for",
    'Formula analysis',
  ];

  for (const token of forbiddenTokens) {
    assert.equal(
      frozenState.includes(token),
      false,
      `score state must stay independent from detail/AI token: ${token}`,
    );
  }
});

test('score section render stays limited to the score card shell', () => {
  const frozenRender = readBetween(
    source,
    'SCORE_SECTION_FROZEN_RENDER_START',
    'SCORE_SECTION_FROZEN_RENDER_END',
  );

  assert.ok(frozenRender.includes('<View style={styles.scoreSection}>'));
  assert.ok(frozenRender.includes('<NutriScoreCardV2'));

  const forbiddenTokens = [
    'overviewBlock',
    'scienceBlock',
    'usageBlock',
    'safetyBlock',
    'What it contains',
    "What it's for",
    'Formula analysis',
  ];

  for (const token of forbiddenTokens) {
    assert.equal(
      frozenRender.includes(token),
      false,
      `score render must not absorb non-score token: ${token}`,
    );
  }
});
