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

  assert.equal(result.hero.chip, 'Strong fit for you');
  assert.equal(result.hero.summary, 'Best aligned with your Immunity goal');
  assert.equal(result.banner?.kind, 'allergy');
  assert.equal(result.banner?.title, 'Ingredients may conflict with your allergies');
});

test('allergy conflict banner removes duplicate allergy row from insights', () => {
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

  assert.equal(result.insights.some((row) => row.topic === 'allergy'), false);
  assert.deepEqual(
    result.insights.map((row) => row.topic),
    ['support', 'dose', 'overlap'],
  );
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
    ['support', 'allergy', 'dose', 'overlap'],
  );
  assert.equal(result.insights.every((row) => row.isExpandable), true);
});
