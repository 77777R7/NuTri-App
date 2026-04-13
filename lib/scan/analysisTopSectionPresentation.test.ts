import test from 'node:test';
import assert from 'node:assert/strict';

import { buildAnalysisTopSectionPresentation } from '@/lib/scan/analysisTopSectionPresentation';

test('hero chip stays goal-fit driven even when allergy banner is present', () => {
  const result = buildAnalysisTopSectionPresentation({
    goal: {
      fitDecision: 'fits',
      selectedGoalLabel: 'Immunity',
    },
    personalInsight: {
      supportLabels: ['Immunity'],
    },
    allergy: {
      status: 'ready',
      matchedLabels: ['Fish'],
      evidenceTexts: ['anchovy'],
      summary: 'Matched your saved settings: Fish.',
    },
    dose: {
      status: 'ready',
      assessment: 'aligned',
      productDoseText: '1 softgel daily',
    },
    safety: {
      warningText: 'Consult a healthcare professional before use.',
    },
  });

  assert.equal(result.hero.chip, 'Supports your Immunity goal');
  assert.equal(result.hero.summary, 'Best aligned with your Immunity goal');
  assert.equal(result.banner?.kind, 'allergy');
  assert.equal(result.banner?.title, 'Ingredients may conflict with your allergies');
});

test('allergy conflict banner keeps an allergy row inside insights', () => {
  const result = buildAnalysisTopSectionPresentation({
    goal: {
      previewTopTier: 'related',
      previewGoalLabel: 'Recovery',
    },
    personalInsight: {
      supportLabels: ['Recovery'],
      conflictSummary: 'Omega-3 appears in more than one supplement in your stack.',
    },
    allergy: {
      status: 'ready',
      matchedLabels: ['Fish'],
      evidenceTexts: ['fish oil'],
      summary: 'Matched your saved settings: Fish.',
    },
    dose: {
      status: 'ready',
      assessment: 'aligned',
      productDoseText: '2 softgels daily',
    },
    safety: {},
  });

  assert.equal(result.banner?.title, 'Ingredients may conflict with your allergies');
  assert.deepEqual(
    result.insights.map((row) => row.topic),
    ['support', 'allergy', 'dose', 'overlap'],
  );
  assert.equal(
    result.insights.find((row) => row.topic === 'allergy')?.collapsedTitle,
    'Fish found on the label',
  );
  assert.equal(result.insights.find((row) => row.topic === 'allergy')?.defaultExpanded, true);
});

test('no goal row is emitted and allergy can appear as a normal status row', () => {
  const result = buildAnalysisTopSectionPresentation({
    goal: {
      fitDecision: 'mixed',
      selectedGoalLabel: 'Energy',
    },
    personalInsight: {
      supportLabels: ['Energy'],
    },
    allergy: {
      status: 'ready',
      matchedLabels: [],
      evidenceTexts: ['soy lecithin'],
      summary: 'This product does not appear to match your saved allergy settings.',
    },
    dose: {
      status: 'ready',
      assessment: 'unclear',
      productDoseText: '2 gummies daily',
    },
    safety: {},
  });

  assert.equal(result.banner, null);
  assert.equal(result.insights.some((row) => row.key === 'goal_fit'), false);
  assert.deepEqual(
    result.insights.map((row) => row.topic),
    ['support', 'allergy', 'dose'],
  );
  assert.equal(
    result.insights.find((row) => row.topic === 'allergy')?.collapsedTitle,
    'No ingredients flagged by your allergies',
  );
});

test('insights are capped at four rows with safety allowed as the fourth item', () => {
  const result = buildAnalysisTopSectionPresentation({
    goal: {
      fitDecision: 'mixed',
      selectedGoalLabel: 'Sleep',
    },
    personalInsight: {
      supportLabels: ['Sleep'],
      conflictSummary: 'This overlaps with another magnesium product in your stack.',
    },
    allergy: {
      status: 'unavailable',
      matchedLabels: [],
      evidenceTexts: [],
      summary: 'We could not attach allergy coverage yet.',
    },
    dose: {
      status: 'ready',
      assessment: 'high',
      productDoseText: '3 capsules per serving',
      productDirectionsText: 'Take with food.',
    },
    safety: {
      warningText: 'Consult a clinician if you are taking other medications.',
    },
  });

  assert.equal(result.insights.length, 4);
  assert.deepEqual(
    result.insights.map((row) => row.topic),
    ['support', 'allergy', 'dose', 'safety'],
  );
  assert.equal(result.insights.every((row) => row.isExpandable), true);
  assert.equal(result.secondaryNote ?? null, null);
  assert.equal(
    result.insights.find((row) => row.topic === 'safety')?.collapsedTitle,
    'If you take medication, check first',
  );
});

test('multi-goal mixed coverage renders a mixed-fit hero and goal coverage row', () => {
  const result = buildAnalysisTopSectionPresentation({
    goal: {
      fitDecision: 'mixed',
      selectedGoalLabel: 'Recovery',
      selectedGoalLabels: ['Energy', 'Immunity', 'Recovery'],
      goalLensMode: 'multi_goal_summary',
      selectedGoalCount: 3,
      analyzedGoalCount: 3,
      surfacedGoalCount: 3,
      allGoalsAnalyzed: true,
      goalCoverage: [
        { goalLabel: 'Energy', tier: 'weak_match', state: 'limited', source: 'goal_match_scoring_preview' },
        { goalLabel: 'Immunity', tier: 'related', state: 'some', source: 'goal_match_scoring_preview' },
        { goalLabel: 'Recovery', tier: 'strong_match', state: 'strong', source: 'selected_goal_evaluation' },
      ],
    },
    personalInsight: {
      supportLabels: [],
      fitDecision: 'mixed',
      selectedGoalLabel: 'Recovery',
      goalLensMode: 'multi_goal_summary',
      selectedGoalCount: 3,
      analyzedGoalCount: 3,
      surfacedGoalCount: 3,
      allGoalsAnalyzed: true,
      goalCoverage: [
        { goalLabel: 'Energy', tier: 'weak_match', state: 'limited', source: 'goal_match_scoring_preview' },
        { goalLabel: 'Immunity', tier: 'related', state: 'some', source: 'goal_match_scoring_preview' },
        { goalLabel: 'Recovery', tier: 'strong_match', state: 'strong', source: 'selected_goal_evaluation' },
      ],
    },
    allergy: {
      status: 'ready',
      matchedLabels: [],
      evidenceTexts: [],
      summary: 'No allergy-related flags detected.',
    },
    dose: {
      status: 'ready',
      assessment: 'aligned',
      productDoseText: '1 softgel daily',
    },
    safety: {},
  });

  assert.equal(result.hero.chip, 'Mixed support across your selected goals');
  assert.equal(result.hero.summary, 'Looks stronger for Recovery than Energy');
  assert.equal(result.insights[0]?.key, 'goal_coverage');
  assert.equal(result.insights[0]?.collapsedTitle, 'Goal check');
  assert.equal(result.insights[0]?.subtitle, '3 goals checked');
  assert.deepEqual(result.insights[0]?.expandedBullets, [
    'Energy — Limited support',
    'Immunity — Some support',
    'Recovery — Strong support',
  ]);
  assert.equal(result.insights[0]?.defaultExpanded, true);
});

test('goal coverage keeps unknown states separate from no-support copy', () => {
  const result = buildAnalysisTopSectionPresentation({
    goal: {
      fitDecision: 'does_not_fit',
      selectedGoalLabel: 'Sleep',
      selectedGoalLabels: ['Immunity', 'Recovery', 'Sleep'],
      goalLensMode: 'multi_goal_summary',
      selectedGoalCount: 3,
      analyzedGoalCount: 3,
      surfacedGoalCount: 3,
      allGoalsAnalyzed: true,
      goalCoverage: [
        { goalLabel: 'Immunity', tier: 'strong_match', state: 'strong', source: 'goal_match_scoring_preview' },
        { goalLabel: 'Recovery', tier: 'weak_match', state: 'limited', source: 'goal_match_scoring_preview' },
        { goalLabel: 'Sleep', tier: 'unknown', state: 'unknown', source: 'goal_match_scoring_preview' },
      ],
    },
    personalInsight: {
      supportLabels: [],
      fitDecision: 'does_not_fit',
      selectedGoalLabel: 'Sleep',
      goalLensMode: 'multi_goal_summary',
      selectedGoalCount: 3,
      analyzedGoalCount: 3,
      surfacedGoalCount: 3,
      allGoalsAnalyzed: true,
      goalCoverage: [
        { goalLabel: 'Immunity', tier: 'strong_match', state: 'strong', source: 'goal_match_scoring_preview' },
        { goalLabel: 'Recovery', tier: 'weak_match', state: 'limited', source: 'goal_match_scoring_preview' },
        { goalLabel: 'Sleep', tier: 'unknown', state: 'unknown', source: 'goal_match_scoring_preview' },
      ],
    },
    allergy: {
      status: 'ready',
      matchedLabels: [],
      evidenceTexts: [],
      summary: 'No allergy-related flags detected.',
    },
    dose: {
      status: 'ready',
      assessment: 'unclear',
      productDoseText: '2 capsules daily',
    },
    safety: {},
  });

  assert.equal(result.insights[0]?.key, 'goal_coverage');
  assert.deepEqual(result.insights[0]?.expandedBullets, [
    'Immunity — Strong support',
    'Recovery — Limited support',
    'Sleep — Not enough label detail',
  ]);
});

test('top section presentation does not depend on Array.flatMap at runtime', () => {
  const originalFlatMap = Array.prototype.flatMap;
  // Simulate older Hermes/JSC environments that do not expose Array.flatMap.
  // @ts-expect-error runtime compatibility test
  Array.prototype.flatMap = undefined;

  try {
    const result = buildAnalysisTopSectionPresentation({
      goal: {
        fitDecision: 'mixed',
        selectedGoalLabel: 'Recovery',
        selectedGoalLabels: ['Energy', 'Immunity', 'Recovery'],
        goalLensMode: 'multi_goal_summary',
        selectedGoalCount: 3,
        analyzedGoalCount: 3,
        surfacedGoalCount: 3,
        allGoalsAnalyzed: true,
        goalCoverage: [
          { goalLabel: 'Energy', tier: 'weak_match', state: 'limited', source: 'goal_match_scoring_preview' },
          { goalLabel: 'Immunity', tier: 'related', state: 'some', source: 'goal_match_scoring_preview' },
          { goalLabel: 'Recovery', tier: 'strong_match', state: 'strong', source: 'selected_goal_evaluation' },
        ],
      },
      personalInsight: {
        supportLabels: [],
        fitDecision: 'mixed',
        selectedGoalLabel: 'Recovery',
        goalLensMode: 'multi_goal_summary',
        selectedGoalCount: 3,
        analyzedGoalCount: 3,
        surfacedGoalCount: 3,
        allGoalsAnalyzed: true,
        goalCoverage: [
          { goalLabel: 'Energy', tier: 'weak_match', state: 'limited', source: 'goal_match_scoring_preview' },
          { goalLabel: 'Immunity', tier: 'related', state: 'some', source: 'goal_match_scoring_preview' },
          { goalLabel: 'Recovery', tier: 'strong_match', state: 'strong', source: 'selected_goal_evaluation' },
        ],
      },
      allergy: {
        status: 'ready',
        matchedLabels: ['Fish'],
        evidenceTexts: ['anchovy; fish oil and gelatin'],
        summary: 'Matched your saved settings: Fish.',
      },
      dose: {
        status: 'ready',
        assessment: 'aligned',
        productDoseText: '1 softgel daily',
      },
      safety: {},
    });

    assert.equal(result.banner?.title, 'Ingredients may conflict with your allergies');
    assert.equal(result.insights[0]?.collapsedTitle, 'Goal check');
  } finally {
    Array.prototype.flatMap = originalFlatMap;
  }
});

test('dominant-goal strong mode uses the strongest goal hero and keeps coverage inline on the support row', () => {
  const result = buildAnalysisTopSectionPresentation({
    goal: {
      heroMode: 'dominant_goal',
      fitDecision: 'fits',
      selectedGoalLabel: 'Recovery',
      selectedGoalLabels: ['Energy', 'Immunity', 'Recovery'],
      allSelectedGoalLabels: ['Energy', 'Immunity', 'Recovery', 'Sleep', 'Focus'],
      goalLensMode: 'multi_goal_summary',
      goalCoverage: [
        {
          goalLabel: 'Recovery',
          tier: 'strong_match',
          state: 'strong',
          source: 'selected_goal_evaluation',
          explanation: {
            summary: 'The visible ingredients look strongly aligned with recovery.',
            provenance: ['Evidence note: Recovery Review Source is one source behind this recovery lane.'],
          },
        },
        { goalLabel: 'Sleep', tier: 'related', state: 'some', source: 'goal_match_scoring_preview' },
        { goalLabel: 'Energy', tier: 'weak_match', state: 'limited', source: 'goal_match_scoring_preview' },
      ],
      allGoalCoverage: [
        { goalLabel: 'Energy', tier: 'weak_match', state: 'limited', source: 'goal_match_scoring_preview' },
        { goalLabel: 'Immunity', tier: 'no_match', state: 'none', source: 'goal_match_scoring_preview' },
        {
          goalLabel: 'Recovery',
          tier: 'strong_match',
          state: 'strong',
          source: 'selected_goal_evaluation',
          explanation: {
            summary: 'The visible ingredients look strongly aligned with recovery.',
            provenance: ['Evidence note: Recovery Review Source is one source behind this recovery lane.'],
          },
        },
        { goalLabel: 'Sleep', tier: 'related', state: 'some', source: 'goal_match_scoring_preview' },
        { goalLabel: 'Focus', tier: 'no_match', state: 'none', source: 'goal_match_scoring_preview' },
      ],
      selectedGoalCount: 5,
      analyzedGoalCount: 5,
      surfacedGoalCount: 3,
      allGoalsAnalyzed: true,
      defaultVisibleGoalLabels: ['Recovery', 'Sleep', 'Energy'],
    },
    personalInsight: {
      heroMode: 'dominant_goal',
      supportLabels: [],
      fitDecision: 'fits',
      selectedGoalLabel: 'Recovery',
      goalLensMode: 'multi_goal_summary',
      goalCoverage: [
        {
          goalLabel: 'Recovery',
          tier: 'strong_match',
          state: 'strong',
          source: 'selected_goal_evaluation',
          explanation: {
            summary: 'The visible ingredients look strongly aligned with recovery.',
            provenance: ['Evidence note: Recovery Review Source is one source behind this recovery lane.'],
          },
        },
        { goalLabel: 'Sleep', tier: 'related', state: 'some', source: 'goal_match_scoring_preview' },
        { goalLabel: 'Energy', tier: 'weak_match', state: 'limited', source: 'goal_match_scoring_preview' },
      ],
      allGoalCoverage: [
        { goalLabel: 'Energy', tier: 'weak_match', state: 'limited', source: 'goal_match_scoring_preview' },
        { goalLabel: 'Immunity', tier: 'no_match', state: 'none', source: 'goal_match_scoring_preview' },
        {
          goalLabel: 'Recovery',
          tier: 'strong_match',
          state: 'strong',
          source: 'selected_goal_evaluation',
          explanation: {
            summary: 'The visible ingredients look strongly aligned with recovery.',
            provenance: ['Evidence note: Recovery Review Source is one source behind this recovery lane.'],
          },
        },
        { goalLabel: 'Sleep', tier: 'related', state: 'some', source: 'goal_match_scoring_preview' },
        { goalLabel: 'Focus', tier: 'no_match', state: 'none', source: 'goal_match_scoring_preview' },
      ],
      selectedGoalCount: 5,
      analyzedGoalCount: 5,
      surfacedGoalCount: 3,
      allGoalsAnalyzed: true,
      defaultVisibleGoalLabels: ['Recovery', 'Sleep', 'Energy'],
    },
    allergy: {
      status: 'ready',
      matchedLabels: [],
      evidenceTexts: [],
      summary: 'No allergy-related flags detected.',
    },
    dose: {
      status: 'ready',
      assessment: 'aligned',
      productDoseText: '1 softgel daily',
    },
    safety: {},
  });

  assert.equal(result.hero.chip, 'Supports your Recovery goal');
  assert.equal(result.hero.summary, 'Strongest match among 5 goals checked');
  assert.equal(result.insights[0]?.key, 'personal_support');
  assert.equal(result.insights[0]?.collapsedTitle, 'Supports your Recovery goal');
  assert.equal(result.insights[0]?.subtitle, undefined);
  assert.equal(result.insights[0]?.goalCoveragePresentation, 'secondary_inline');
  assert.equal(result.insights[0]?.inlineGoalCoverageTitle, 'Goal check');
  assert.equal(result.insights[0]?.inlineGoalCoveragePreview, 'Recovery: Strong · Sleep: Some · 3 more');
  assert.equal(result.insights[0]?.expandActionLabel, 'See all goals');
  assert.equal(result.insights.some((row) => row.collapsedTitle === 'Goal check'), false);
  assert.equal(
    (result.insights[0]?.expandedBullets ?? []).some((line) => /Recovery Review Source/.test(line)),
    false,
  );
  assert.deepEqual(
    result.insights[0]?.goalCoverageItems?.map((item) => item.goalLabel),
    ['Energy', 'Immunity', 'Recovery', 'Sleep', 'Focus'],
  );
});

test('contract-driven dominant hero ignores conflicting legacy fitDecision and preview tier fields', () => {
  const result = buildAnalysisTopSectionPresentation({
    goal: {
      heroMode: 'dominant_goal',
      fitDecision: 'does_not_fit',
      previewTopTier: 'weak_match',
      selectedGoalLabel: 'Sleep',
      dominantGoalLabel: 'Recovery',
      goalLensMode: 'multi_goal_summary',
      allGoalsAnalyzed: true,
      analyzedGoalCount: 3,
      surfacedGoalCount: 3,
      allGoalCoverage: [
        { goalLabel: 'Recovery', tier: 'strong_match', state: 'strong', source: 'selected_goal_evaluation' },
        { goalLabel: 'Sleep', tier: 'no_match', state: 'none', source: 'goal_match_scoring_preview' },
        { goalLabel: 'Energy', tier: 'weak_match', state: 'limited', source: 'goal_match_scoring_preview' },
      ],
    },
    personalInsight: {
      supportLabels: [],
      heroMode: 'dominant_goal',
      fitDecision: 'does_not_fit',
      selectedGoalLabel: 'Sleep',
      dominantGoalLabel: 'Recovery',
      goalLensMode: 'multi_goal_summary',
      allGoalsAnalyzed: true,
      analyzedGoalCount: 3,
      surfacedGoalCount: 3,
      allGoalCoverage: [
        { goalLabel: 'Recovery', tier: 'strong_match', state: 'strong', source: 'selected_goal_evaluation' },
        { goalLabel: 'Sleep', tier: 'no_match', state: 'none', source: 'goal_match_scoring_preview' },
        { goalLabel: 'Energy', tier: 'weak_match', state: 'limited', source: 'goal_match_scoring_preview' },
      ],
    },
    allergy: {
      status: 'ready',
      matchedLabels: [],
      evidenceTexts: [],
      summary: 'No allergy-related flags detected.',
    },
    dose: {
      status: 'ready',
      assessment: 'aligned',
      productDoseText: '1 softgel daily',
    },
    safety: {},
  });

  assert.equal(result.hero.chip, 'Supports your Recovery goal');
  assert.equal(result.hero.summary, 'Strongest match among 3 goals checked');
  assert.equal(result.insights[0]?.collapsedTitle, 'Supports your Recovery goal');
  assert.equal(result.insights.some((row) => row.collapsedTitle === 'Goal check'), false);
});

test('dominant-goal moderate mode uses strongest-goal wording without a top-level coverage row', () => {
  const result = buildAnalysisTopSectionPresentation({
    goal: {
      heroMode: 'dominant_goal',
      fitDecision: 'mixed',
      selectedGoalLabel: 'Recovery',
      goalLensMode: 'multi_goal_summary',
      goalCoverage: [
        { goalLabel: 'Recovery', tier: 'related', state: 'some', source: 'selected_goal_evaluation' },
        { goalLabel: 'Energy', tier: 'weak_match', state: 'limited', source: 'goal_match_scoring_preview' },
        { goalLabel: 'Sleep', tier: 'no_match', state: 'none', source: 'goal_match_scoring_preview' },
      ],
      analyzedGoalCount: 3,
      surfacedGoalCount: 3,
      allGoalsAnalyzed: true,
      defaultVisibleGoalLabels: ['Recovery', 'Energy', 'Sleep'],
    },
    personalInsight: {
      heroMode: 'dominant_goal',
      supportLabels: [],
      fitDecision: 'mixed',
      selectedGoalLabel: 'Recovery',
      goalLensMode: 'multi_goal_summary',
      goalCoverage: [
        { goalLabel: 'Recovery', tier: 'related', state: 'some', source: 'selected_goal_evaluation' },
        { goalLabel: 'Energy', tier: 'weak_match', state: 'limited', source: 'goal_match_scoring_preview' },
        { goalLabel: 'Sleep', tier: 'no_match', state: 'none', source: 'goal_match_scoring_preview' },
      ],
      analyzedGoalCount: 3,
      surfacedGoalCount: 3,
      allGoalsAnalyzed: true,
      defaultVisibleGoalLabels: ['Recovery', 'Energy', 'Sleep'],
    },
    allergy: {
      status: 'ready',
      matchedLabels: [],
      evidenceTexts: [],
      summary: 'No allergy-related flags detected.',
    },
    dose: {
      status: 'ready',
      assessment: 'aligned',
      productDoseText: '1 softgel daily',
    },
    safety: {},
  });

  assert.equal(result.hero.chip, 'Most aligned with your Recovery goal');
  assert.equal(result.hero.summary, 'Best match among 3 goals checked');
  assert.equal(result.insights[0]?.key, 'personal_support');
  assert.equal(result.insights[0]?.collapsedTitle, 'Most aligned with your Recovery goal');
  assert.equal(result.insights[0]?.goalCoveragePresentation, 'secondary_inline');
  assert.equal(result.insights.some((row) => row.collapsedTitle === 'Goal check'), false);
});

test('dominant-goal mode falls back to top-level coverage when the strongest goal is only limited', () => {
  const result = buildAnalysisTopSectionPresentation({
    goal: {
      heroMode: 'dominant_goal',
      fitDecision: 'does_not_fit',
      selectedGoalLabel: 'Energy',
      goalLensMode: 'multi_goal_summary',
      goalCoverage: [
        { goalLabel: 'Energy', tier: 'weak_match', state: 'limited', source: 'selected_goal_evaluation' },
        { goalLabel: 'Immunity', tier: 'no_match', state: 'none', source: 'goal_match_scoring_preview' },
        { goalLabel: 'Recovery', tier: 'no_match', state: 'none', source: 'goal_match_scoring_preview' },
      ],
      analyzedGoalCount: 3,
      surfacedGoalCount: 3,
      allGoalsAnalyzed: true,
    },
    personalInsight: {
      heroMode: 'dominant_goal',
      supportLabels: [],
      fitDecision: 'does_not_fit',
      selectedGoalLabel: 'Energy',
      goalLensMode: 'multi_goal_summary',
      goalCoverage: [
        { goalLabel: 'Energy', tier: 'weak_match', state: 'limited', source: 'selected_goal_evaluation' },
        { goalLabel: 'Immunity', tier: 'no_match', state: 'none', source: 'goal_match_scoring_preview' },
        { goalLabel: 'Recovery', tier: 'no_match', state: 'none', source: 'goal_match_scoring_preview' },
      ],
      analyzedGoalCount: 3,
      surfacedGoalCount: 3,
      allGoalsAnalyzed: true,
    },
    allergy: {
      status: 'ready',
      matchedLabels: [],
      evidenceTexts: [],
      summary: 'No allergy-related flags detected.',
    },
    dose: {
      status: 'ready',
      assessment: 'unclear',
      productDoseText: '1 softgel daily',
    },
    safety: {},
  });

  assert.equal(result.hero.chip, 'Limited support across your selected goals');
  assert.equal(result.insights[0]?.key, 'goal_coverage');
  assert.equal(result.insights[0]?.collapsedTitle, 'Goal check');
});

test('multi-goal all-some coverage avoids comparing a goal against itself', () => {
  const result = buildAnalysisTopSectionPresentation({
    goal: {
      fitDecision: 'mixed',
      selectedGoalLabel: 'Recovery',
      selectedGoalLabels: ['Energy', 'Immunity', 'Recovery'],
      goalLensMode: 'multi_goal_summary',
      selectedGoalCount: 3,
      analyzedGoalCount: 3,
      surfacedGoalCount: 3,
      allGoalsAnalyzed: true,
      goalCoverage: [
        { goalLabel: 'Energy', tier: 'related', state: 'some', source: 'goal_match_scoring_preview' },
        { goalLabel: 'Immunity', tier: 'related', state: 'some', source: 'goal_match_scoring_preview' },
        { goalLabel: 'Recovery', tier: 'related', state: 'some', source: 'selected_goal_evaluation' },
      ],
    },
    personalInsight: {
      supportLabels: [],
      fitDecision: 'mixed',
      selectedGoalLabel: 'Recovery',
      goalLensMode: 'multi_goal_summary',
      selectedGoalCount: 3,
      analyzedGoalCount: 3,
      surfacedGoalCount: 3,
      allGoalsAnalyzed: true,
      goalCoverage: [
        { goalLabel: 'Energy', tier: 'related', state: 'some', source: 'goal_match_scoring_preview' },
        { goalLabel: 'Immunity', tier: 'related', state: 'some', source: 'goal_match_scoring_preview' },
        { goalLabel: 'Recovery', tier: 'related', state: 'some', source: 'selected_goal_evaluation' },
      ],
    },
    allergy: {
      status: 'ready',
      matchedLabels: [],
      evidenceTexts: [],
      summary: 'No allergy-related flags detected.',
    },
    dose: {
      status: 'ready',
      assessment: 'aligned',
      productDoseText: '1 softgel daily',
    },
    safety: {},
  });

  assert.equal(result.hero.chip, 'Mixed support across your selected goals');
  assert.equal(result.hero.summary, 'Supports some goals more than others.');
});

test('multi-goal full analysis shows top 3 by relevance with expand metadata', () => {
  const result = buildAnalysisTopSectionPresentation({
    goal: {
      fitDecision: 'mixed',
      selectedGoalLabel: 'Recovery',
      selectedGoalLabels: ['Energy', 'Immunity', 'Recovery'],
      allSelectedGoalLabels: ['Energy', 'Immunity', 'Recovery', 'Sleep', 'Focus'],
      goalLensMode: 'multi_goal_summary',
      goalCoverage: [
        { goalLabel: 'Energy', tier: 'weak_match', state: 'limited', source: 'goal_match_scoring_preview' },
        { goalLabel: 'Immunity', tier: 'weak_match', state: 'limited', source: 'goal_match_scoring_preview' },
        { goalLabel: 'Recovery', tier: 'strong_match', state: 'strong', source: 'selected_goal_evaluation' },
      ],
      allGoalCoverage: [
        { goalLabel: 'Energy', tier: 'weak_match', state: 'limited', source: 'goal_match_scoring_preview' },
        { goalLabel: 'Immunity', tier: 'weak_match', state: 'limited', source: 'goal_match_scoring_preview' },
        { goalLabel: 'Recovery', tier: 'strong_match', state: 'strong', source: 'selected_goal_evaluation' },
        { goalLabel: 'Sleep', tier: 'related', state: 'some', source: 'goal_match_scoring_preview' },
        { goalLabel: 'Focus', tier: 'no_match', state: 'none', source: 'goal_match_scoring_preview' },
      ],
      selectedGoalCount: 5,
      analyzedGoalCount: 5,
      surfacedGoalCount: 3,
      allGoalsAnalyzed: true,
      defaultVisibleGoalLabels: ['Recovery', 'Sleep', 'Energy'],
    },
    personalInsight: {
      supportLabels: [],
      fitDecision: 'mixed',
      selectedGoalLabel: 'Recovery',
      goalLensMode: 'multi_goal_summary',
      goalCoverage: [
        { goalLabel: 'Energy', tier: 'weak_match', state: 'limited', source: 'goal_match_scoring_preview' },
        { goalLabel: 'Immunity', tier: 'weak_match', state: 'limited', source: 'goal_match_scoring_preview' },
        { goalLabel: 'Recovery', tier: 'strong_match', state: 'strong', source: 'selected_goal_evaluation' },
      ],
      allGoalCoverage: [
        { goalLabel: 'Energy', tier: 'weak_match', state: 'limited', source: 'goal_match_scoring_preview' },
        { goalLabel: 'Immunity', tier: 'weak_match', state: 'limited', source: 'goal_match_scoring_preview' },
        { goalLabel: 'Recovery', tier: 'strong_match', state: 'strong', source: 'selected_goal_evaluation' },
        { goalLabel: 'Sleep', tier: 'related', state: 'some', source: 'goal_match_scoring_preview' },
        { goalLabel: 'Focus', tier: 'no_match', state: 'none', source: 'goal_match_scoring_preview' },
      ],
      selectedGoalCount: 5,
      analyzedGoalCount: 5,
      surfacedGoalCount: 3,
      allGoalsAnalyzed: true,
      defaultVisibleGoalLabels: ['Recovery', 'Sleep', 'Energy'],
    },
    allergy: {
      status: 'ready',
      matchedLabels: [],
      evidenceTexts: [],
      summary: 'No allergy-related flags detected.',
    },
    dose: {
      status: 'ready',
      assessment: 'aligned',
      productDoseText: '1 softgel daily',
    },
    safety: {},
  });

  assert.equal(result.hero.chip, 'Mixed support across your selected goals');
  assert.equal(result.insights[0]?.subtitle, '3 of 5 goals shown');
  assert.deepEqual(
    result.insights[0]?.visibleGoalCoverageItems?.map((item) => item.goalLabel),
    ['Recovery', 'Sleep', 'Energy'],
  );
  assert.deepEqual(
    result.insights[0]?.goalCoverageItems?.map((item) => item.goalLabel),
    ['Energy', 'Immunity', 'Recovery', 'Sleep', 'Focus'],
  );
  assert.equal(result.insights[0]?.expandActionLabel, 'See all goals');
  assert.equal(result.insights[0]?.collapseActionLabel, 'Hide goals');
  assert.equal(result.insights[0]?.canExpandAll, true);
});

test('partial multi-goal analysis uses conservative hero copy and does not expose view-all', () => {
  const result = buildAnalysisTopSectionPresentation({
    goal: {
      fitDecision: 'mixed',
      selectedGoalLabel: 'Recovery',
      goalLensMode: 'multi_goal_summary',
      goalCoverage: [
        { goalLabel: 'Energy', tier: 'weak_match', state: 'limited', source: 'goal_match_scoring_preview' },
        { goalLabel: 'Recovery', tier: 'strong_match', state: 'strong', source: 'selected_goal_evaluation' },
      ],
      analyzedGoalCount: 2,
      surfacedGoalCount: 2,
      allGoalsAnalyzed: false,
    },
    personalInsight: {
      supportLabels: [],
      fitDecision: 'mixed',
      selectedGoalLabel: 'Recovery',
      goalLensMode: 'multi_goal_summary',
      goalCoverage: [
        { goalLabel: 'Energy', tier: 'weak_match', state: 'limited', source: 'goal_match_scoring_preview' },
        { goalLabel: 'Recovery', tier: 'strong_match', state: 'strong', source: 'selected_goal_evaluation' },
      ],
      analyzedGoalCount: 2,
      surfacedGoalCount: 2,
      allGoalsAnalyzed: false,
    },
    allergy: {
      status: 'ready',
      matchedLabels: [],
      evidenceTexts: [],
      summary: 'No allergy-related flags detected.',
    },
    dose: {
      status: 'ready',
      assessment: 'aligned',
      productDoseText: '1 softgel daily',
    },
    safety: {},
  });

  assert.equal(result.hero.chip, 'Mixed support for the goals shown');
  assert.equal(result.hero.summary, 'Looks stronger for Recovery than Energy');
  assert.equal(result.insights[0]?.subtitle, '2 goals checked');
  assert.equal(result.insights[0]?.expandActionLabel, undefined);
  assert.equal(result.insights[0]?.canExpandAll, false);
});

test('single-goal does-not-fit copy stays conservative and avoids strong negative phrasing', () => {
  const result = buildAnalysisTopSectionPresentation({
    goal: {
      fitDecision: 'does_not_fit',
      selectedGoalLabel: 'Sleep',
    },
    personalInsight: {
      supportLabels: [],
      fitDecision: 'does_not_fit',
      selectedGoalLabel: 'Sleep',
    },
    allergy: {
      status: 'ready',
      matchedLabels: [],
      evidenceTexts: [],
      summary: 'No allergy-related flags detected.',
    },
    dose: {
      status: 'ready',
      assessment: 'unclear',
      productDoseText: '1 softgel daily',
    },
    safety: {},
  });

  assert.equal(result.hero.chip, 'No clear support for your Sleep goal');
  assert.equal(result.hero.summary, 'This label does not show a clear match.');
  assert.equal(result.insights[0]?.collapsedTitle, 'No clear support for your Sleep goal');
  const flattened = `${result.hero.chip} ${result.hero.summary} ${result.insights.flatMap((row) => [row.collapsedTitle, ...row.expandedBullets]).join(' ')}`;
  assert.equal(/Not fit your goal|Not suitable for your|Not a strong fit for your/i.test(flattened), false);
});

test('legacy single-goal payload still renders conservatively when contract metadata is absent', () => {
  const result = buildAnalysisTopSectionPresentation({
    goal: {
      fitDecision: 'does_not_fit',
      selectedGoalLabel: 'Sleep',
      previewTopTier: 'weak_match',
    },
    personalInsight: {
      supportLabels: [],
      fitDecision: 'does_not_fit',
      selectedGoalLabel: 'Sleep',
    },
    allergy: {
      status: 'ready',
      matchedLabels: [],
      evidenceTexts: [],
      summary: 'No allergy-related flags detected.',
    },
    dose: {
      status: 'ready',
      assessment: 'unclear',
      productDoseText: '1 softgel daily',
    },
    safety: {},
  });

  assert.equal(result.hero.chip, 'No clear support for your Sleep goal');
  assert.equal(result.insights[0]?.collapsedTitle, 'No clear support for your Sleep goal');
});

test('insufficient-signal multi-goal copy prefers evidence limits over limited-support copy', () => {
  const result = buildAnalysisTopSectionPresentation({
    goal: {
      heroMode: 'insufficient_signal',
      goalLensMode: 'multi_goal_summary',
      allGoalsAnalyzed: true,
      labelCompleteness: 'low',
      goalNarrativeConfidence: 'low',
      analyzedGoalCount: 3,
      surfacedGoalCount: 3,
      goalCoverage: [
        { goalLabel: 'Sleep', tier: 'unknown', state: 'unknown', source: 'goal_match_scoring_preview' },
        { goalLabel: 'Stress Support', tier: 'unknown', state: 'unknown', source: 'goal_match_scoring_preview' },
        { goalLabel: 'Recovery', tier: 'no_match', state: 'none', source: 'goal_match_scoring_preview' },
      ],
    },
    personalInsight: {
      supportLabels: [],
      heroMode: 'insufficient_signal',
      goalLensMode: 'multi_goal_summary',
      allGoalsAnalyzed: true,
      labelCompleteness: 'low',
      goalNarrativeConfidence: 'low',
      analyzedGoalCount: 3,
      surfacedGoalCount: 3,
      goalCoverage: [
        { goalLabel: 'Sleep', tier: 'unknown', state: 'unknown', source: 'goal_match_scoring_preview' },
        { goalLabel: 'Stress Support', tier: 'unknown', state: 'unknown', source: 'goal_match_scoring_preview' },
        { goalLabel: 'Recovery', tier: 'no_match', state: 'none', source: 'goal_match_scoring_preview' },
      ],
    },
    allergy: {
      status: 'ready',
      matchedLabels: [],
      evidenceTexts: [],
      summary: 'No allergy-related flags detected.',
    },
    dose: {
      status: 'ready',
      assessment: 'unknown',
      productDoseText: null,
    },
    safety: {},
  });

  assert.equal(result.hero.chip, 'Not enough evidence to judge all your goals');
  assert.equal(result.hero.summary, 'We need more label detail to judge this product well.');
  assert.equal(result.insights[0]?.key, 'goal_coverage');
  assert.deepEqual(result.insights[0]?.expandedBullets, [
    'Sleep — Not enough label detail',
    'Stress Support — Not enough label detail',
    'Recovery — No clear support',
  ]);
});

test('evidence-limited hero aligns with personalized support instead of contradicting it', () => {
  const result = buildAnalysisTopSectionPresentation({
    goal: {
      heroMode: 'insufficient_signal',
      selectedGoalLabel: 'Sleep',
      analyzedGoalCount: 3,
      labelCompleteness: 'low',
      goalNarrativeConfidence: 'low',
      goalCoverage: [
        { goalLabel: 'Sleep', tier: 'related', state: 'some', source: 'goal_match_scoring_preview' },
        { goalLabel: 'Stress Support', tier: 'weak_match', state: 'limited', source: 'goal_match_scoring_preview' },
        { goalLabel: 'Recovery', tier: 'no_match', state: 'none', source: 'goal_match_scoring_preview' },
      ],
    },
    personalInsight: {
      supportLabels: ['Sleep'],
      heroMode: 'insufficient_signal',
      labelCompleteness: 'low',
      goalNarrativeConfidence: 'low',
    },
    allergy: {
      status: 'ready',
      matchedLabels: [],
      evidenceTexts: [],
      summary: 'No allergy-related flags detected.',
    },
    dose: {
      status: 'ready',
      assessment: 'aligned',
      productDoseText: '1 capsule daily',
    },
    safety: {},
  });

  assert.equal(result.hero.chip, 'Most aligned with your Sleep goal');
  assert.equal(
    result.hero.summary,
    'Visible ingredients lean more toward sleep support on this label.',
  );
  assert.equal(result.insights[0]?.key, 'personal_support');
  assert.equal(result.insights[0]?.defaultExpanded, true);
  assert.equal(result.insights[0]?.collapsedTitle, 'Supports your Sleep goal');
});

test('limited-goals multi-goal copy does not collapse into evidence-limited hero when completeness is medium', () => {
  const result = buildAnalysisTopSectionPresentation({
    goal: {
      heroMode: 'limited_goals',
      goalLensMode: 'multi_goal_summary',
      allGoalsAnalyzed: true,
      labelCompleteness: 'medium',
      goalNarrativeConfidence: 'low',
      analyzedGoalCount: 2,
      surfacedGoalCount: 2,
      goalCoverage: [
        { goalLabel: 'Sleep', tier: 'no_match', state: 'none', source: 'selected_goal_evaluation' },
        { goalLabel: 'Stress Support', tier: 'no_match', state: 'none', source: 'goal_match_scoring_preview' },
      ],
    },
    personalInsight: {
      supportLabels: [],
      heroMode: 'limited_goals',
      goalLensMode: 'multi_goal_summary',
      allGoalsAnalyzed: true,
      labelCompleteness: 'medium',
      goalNarrativeConfidence: 'low',
      analyzedGoalCount: 2,
      surfacedGoalCount: 2,
      goalCoverage: [
        { goalLabel: 'Sleep', tier: 'no_match', state: 'none', source: 'selected_goal_evaluation' },
        { goalLabel: 'Stress Support', tier: 'no_match', state: 'none', source: 'goal_match_scoring_preview' },
      ],
    },
    allergy: {
      status: 'ready',
      matchedLabels: [],
      evidenceTexts: [],
      summary: 'No allergy-related flags detected.',
    },
    dose: {
      status: 'ready',
      assessment: 'aligned',
      productDoseText: '1 softgel daily',
    },
    safety: {},
  });

  assert.equal(result.hero.chip, 'Limited support across your selected goals');
  assert.equal(result.hero.summary, "We don't see clear goal-specific support across the goals we checked.");
  assert.notEqual(result.hero.chip, 'Not enough evidence to judge all your goals');
  assert.equal(result.insights[0]?.key, 'goal_coverage');
  assert.equal(result.insights[0]?.collapsedTitle, 'Goal check');
  assert.equal(result.insights[0]?.subtitle, '2 goals checked');
});

test('goal insight still renders when the selected goal does not match strongly', () => {
  const result = buildAnalysisTopSectionPresentation({
    goal: {
      fitDecision: 'does_not_fit',
      selectedGoalLabel: 'Immunity',
    },
    personalInsight: {
      supportLabels: [],
      fitDecision: 'does_not_fit',
      selectedGoalLabel: 'Immunity',
    },
    allergy: {
      status: 'ready',
      matchedLabels: [],
      evidenceTexts: [],
      summary: 'No allergy-related flags detected.',
    },
    dose: {
      status: 'ready',
      assessment: 'unclear',
      productDoseText: '1 softgel daily',
    },
    safety: {},
  });

  assert.equal(result.hero.summary, 'This label does not show a clear match.');
  assert.equal(result.insights[0]?.topic, 'support');
  assert.equal(result.insights[0]?.collapsedTitle, 'No clear support for your Immunity goal');
  assert.equal(result.insights[0]?.defaultExpanded, true);
});

test('allergy row does not tell the user to add preferences when local settings already exist', () => {
  const result = buildAnalysisTopSectionPresentation({
    goal: {
      fitDecision: 'mixed',
      selectedGoalLabel: 'Recovery',
    },
    personalInsight: {
      supportLabels: ['Recovery'],
    },
    allergy: {
      status: 'ready',
      hasSavedPreferences: true,
      matchedLabels: [],
      evidenceTexts: [],
      summary: 'No allergy or restriction settings saved yet.',
    },
    dose: {
      status: 'ready',
      assessment: 'aligned',
      productDoseText: '2 capsules daily',
    },
    safety: {},
  });

  assert.equal(
    result.insights.find((row) => row.topic === 'allergy')?.collapsedTitle,
    'Saved allergy preferences did not attach to this scan',
  );
});

test('allergy conflict details are more specific than the banner warning', () => {
  const result = buildAnalysisTopSectionPresentation({
    goal: {
      fitDecision: 'does_not_fit',
      selectedGoalLabel: 'Energy',
    },
    personalInsight: {
      supportLabels: [],
      fitDecision: 'does_not_fit',
      selectedGoalLabel: 'Energy',
    },
    allergy: {
      status: 'ready',
      matchedLabels: ['fish'],
      evidenceTexts: [
        'Calories 15; Wild Alaska Pollock Fish Oil Concentrate 1250 mg and Fish Gelatin; Glycerin; Water.',
      ],
      summary: 'Matched your saved settings: Fish.',
    },
    dose: {
      status: 'ready',
      assessment: 'unclear',
      productDoseText: '1 softgel daily',
    },
    safety: {
      warningText: 'Consult a healthcare professional before use.',
    },
  });

  const allergyRow = result.insights.find((row) => row.topic === 'allergy');
  assert.equal(allergyRow?.collapsedTitle, 'Fish found on the label');
  assert.deepEqual(allergyRow?.expandedBullets, [
    'This product may conflict with your saved allergy settings.',
    'Matched against: Fish.',
    'Found on label: Wild Alaska Pollock Fish Oil Concentrate 1250 mg and Fish Gelatin.',
    'Avoid it if you need to avoid fish ingredients.',
  ]);
});

test('medication caution title reads like a conditional reminder', () => {
  const result = buildAnalysisTopSectionPresentation({
    goal: {
      fitDecision: 'fits',
      selectedGoalLabel: 'Immunity',
    },
    personalInsight: {
      supportLabels: ['Immunity'],
    },
    allergy: {
      status: 'ready',
      matchedLabels: [],
      evidenceTexts: [],
      summary: 'No allergy-related flags detected.',
    },
    dose: {
      status: 'ready',
      assessment: 'aligned',
      productDoseText: '1 capsule daily',
    },
    safety: {
      warningText: 'Consult a clinician if you take prescription medication.',
    },
  });

  assert.equal(
    result.insights.find((row) => row.topic === 'safety')?.collapsedTitle,
    'If you take medication, check first',
  );
  assert.equal(result.secondaryNote ?? null, null);
});

test('strong safety triggers stay as a primary insight row', () => {
  const result = buildAnalysisTopSectionPresentation({
    goal: {
      fitDecision: 'fits',
      selectedGoalLabel: 'Immunity',
    },
    personalInsight: {
      supportLabels: ['Immunity'],
    },
    allergy: {
      status: 'ready',
      matchedLabels: [],
      evidenceTexts: [],
      summary: 'No allergy-related flags detected.',
    },
    dose: {
      status: 'ready',
      assessment: 'aligned',
      productDoseText: '1 capsule daily',
    },
    safety: {
      warningText: 'Avoid use with blood thinners unless a clinician tells you otherwise.',
    },
  });

  assert.equal(result.secondaryNote ?? null, null);
  assert.equal(
    result.insights.find((row) => row.topic === 'safety')?.collapsedTitle,
    'Check before use',
  );
});
