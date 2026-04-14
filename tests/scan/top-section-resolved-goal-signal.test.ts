import assert from 'node:assert/strict';
import test from 'node:test';

import { buildAnalysisTopSectionPresentation, type TopSectionResolvedGoalSignalInput } from '../../lib/scan/analysisTopSectionPresentation';

const baseInput = {
  allergy: {
    status: 'ready' as const,
    matchedLabels: [],
    evidenceTexts: [],
  },
  dose: {
    status: 'ready' as const,
    assessment: 'unclear' as const,
    productDoseText: '200 mg per serving',
    productDirectionsText: 'Take 1 capsule daily.',
  },
  safety: {
    warningText: 'Check medication interactions.',
    watchoutText: 'If you take medication, check first.',
  },
};

test('resolved support override keeps hero, first row, and expanded state aligned', () => {
  const resolvedGoalSignal: TopSectionResolvedGoalSignalInput = {
    mode: 'support_override',
    goalLabel: 'Sleep',
    heroTone: 'neutral',
    heroChip: 'Most aligned with your Sleep goal',
    heroSummary: 'Visible ingredients lean more toward sleep support than other goals we checked.',
    primaryInsightKey: 'personal_support',
    preferredExpandedKey: 'personal_support',
  };

  const presentation = buildAnalysisTopSectionPresentation({
    ...baseInput,
    goal: {
      heroMode: 'insufficient_signal',
      goalLensMode: 'single_goal',
      labelCompleteness: 'low',
      goalNarrativeConfidence: 'low',
      goalCoverage: [
        { goalLabel: 'Sleep', tier: 'related', state: 'some', source: 'goal_match_scoring_preview' },
        { goalLabel: 'Stress Support', tier: 'weak_match', state: 'limited', source: 'goal_match_scoring_preview' },
      ],
      allGoalCoverage: [
        { goalLabel: 'Sleep', tier: 'related', state: 'some', source: 'goal_match_scoring_preview' },
        { goalLabel: 'Stress Support', tier: 'weak_match', state: 'limited', source: 'goal_match_scoring_preview' },
      ],
      analyzedGoalCount: 2,
    },
    personalInsight: {
      supportLabels: ['Sleep'],
      preferSupportSignal: true,
      resolvedSupportGoalLabel: 'Sleep',
      goalCoverage: [
        { goalLabel: 'Sleep', tier: 'related', state: 'some', source: 'goal_match_scoring_preview' },
        { goalLabel: 'Stress Support', tier: 'weak_match', state: 'limited', source: 'goal_match_scoring_preview' },
      ],
      allGoalCoverage: [
        { goalLabel: 'Sleep', tier: 'related', state: 'some', source: 'goal_match_scoring_preview' },
        { goalLabel: 'Stress Support', tier: 'weak_match', state: 'limited', source: 'goal_match_scoring_preview' },
      ],
      analyzedGoalCount: 2,
      allGoalsAnalyzed: true,
    },
    resolvedGoalSignal,
  });

  assert.equal(presentation.hero.chip, 'Most aligned with your Sleep goal');
  assert.equal(presentation.insights[0]?.key, 'personal_support');
  assert.equal(presentation.insights[0]?.defaultExpanded, true);
});

test('coverage-only signal keeps goal check first when support override is not resolved', () => {
  const resolvedGoalSignal: TopSectionResolvedGoalSignalInput = {
    mode: 'coverage_only',
    primaryInsightKey: 'goal_coverage',
    preferredExpandedKey: 'goal_coverage',
  };

  const presentation = buildAnalysisTopSectionPresentation({
    ...baseInput,
    goal: {
      heroMode: 'mixed_goals',
      goalLensMode: 'multi_goal_summary',
      goalCoverage: [
        { goalLabel: 'Energy', tier: 'related', state: 'limited', source: 'goal_match_scoring_preview' },
        { goalLabel: 'Sleep', tier: 'weak_match', state: 'none', source: 'goal_match_scoring_preview' },
      ],
      allGoalCoverage: [
        { goalLabel: 'Energy', tier: 'related', state: 'limited', source: 'goal_match_scoring_preview' },
        { goalLabel: 'Sleep', tier: 'weak_match', state: 'none', source: 'goal_match_scoring_preview' },
      ],
      analyzedGoalCount: 2,
      surfacedGoalCount: 2,
      allGoalsAnalyzed: true,
    },
    personalInsight: {
      supportLabels: ['Energy', 'Sleep'],
      preferSupportSignal: false,
      goalCoverage: [
        { goalLabel: 'Energy', tier: 'related', state: 'limited', source: 'goal_match_scoring_preview' },
        { goalLabel: 'Sleep', tier: 'weak_match', state: 'none', source: 'goal_match_scoring_preview' },
      ],
      allGoalCoverage: [
        { goalLabel: 'Energy', tier: 'related', state: 'limited', source: 'goal_match_scoring_preview' },
        { goalLabel: 'Sleep', tier: 'weak_match', state: 'none', source: 'goal_match_scoring_preview' },
      ],
      analyzedGoalCount: 2,
      surfacedGoalCount: 2,
      allGoalsAnalyzed: true,
    },
    resolvedGoalSignal,
  });

  assert.equal(presentation.insights[0]?.key, 'goal_coverage');
  assert.equal(presentation.insights[0]?.defaultExpanded, true);
});
