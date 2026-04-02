import test from 'node:test';
import assert from 'node:assert/strict';

import { buildAnalysisTopSectionPresentation } from '@/lib/scan/analysisTopSectionPresentation';

test('allergy banner wins priority and removes allergy row from insights', () => {
  const result = buildAnalysisTopSectionPresentation({
    goal: {
      fitDecision: 'fits',
      selectedGoalLabel: 'Immunity',
    },
    personalInsight: {
      supportLabels: ['Immunity'],
      conflictSummary: 'Vitamin C appears in more than one saved supplement.',
    },
    allergy: {
      status: 'ready',
      matchedLabels: ['Dairy'],
      evidenceTexts: ['whey protein'],
      summary: 'Matched your saved settings: Dairy.',
    },
    dose: {
      status: 'ready',
      assessment: 'aligned',
      productDoseText: '1 capsule daily',
    },
    safety: {},
  });

  assert.equal(result.banner?.kind, 'allergy');
  assert.equal(result.banner?.title, 'Ingredients may conflict with your allergies');
  assert.equal(result.hero.chip, 'Review before using');
  assert.equal(result.insights.some((row) => row.topic === 'allergy'), false);
});

test('when no banner is needed allergy remains a normal insight row', () => {
  const result = buildAnalysisTopSectionPresentation({
    goal: {
      previewTopTier: 'related',
      previewGoalLabel: 'Energy',
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
      assessment: 'aligned',
      productDoseText: '2 gummies daily',
    },
    safety: {},
  });

  assert.equal(result.banner, null);
  const allergyRow = result.insights.find((row) => row.topic === 'allergy');
  assert.ok(allergyRow);
  assert.equal(allergyRow?.collapsedTitle, 'No ingredients flagged by your allergies');
});

test('banner priority prefers allergy over safety and overlap', () => {
  const result = buildAnalysisTopSectionPresentation({
    goal: {},
    personalInsight: {
      supportLabels: [],
      conflictSummary: 'Overlaps with a supplement already in your stack.',
    },
    allergy: {
      status: 'ready',
      matchedLabels: ['Soy'],
      evidenceTexts: [],
      summary: 'Matched your saved settings: Soy.',
    },
    dose: {
      status: 'ready',
      assessment: 'unclear',
    },
    safety: {
      warningText: 'Consult a healthcare professional before use.',
    },
  });

  assert.equal(result.banner?.kind, 'allergy');
});

test('insights are capped at four rows and remain expandable', () => {
  const result = buildAnalysisTopSectionPresentation({
    goal: {
      fitDecision: 'mixed',
      selectedGoalLabel: 'Sleep',
    },
    personalInsight: {
      supportLabels: ['Sleep', 'Stress'],
    },
    allergy: {
      status: 'pending',
      matchedLabels: [],
      evidenceTexts: [],
      summary: 'We are still attaching allergen coverage for this product.',
      reasonCode: 'NORMALIZED_PRODUCT_ALLERGY_FLAGS_NOT_ATTACHED',
    },
    dose: {
      status: 'ready',
      assessment: 'high',
      productDoseText: '3 capsules per serving',
    },
    safety: {
      watchoutText: 'Consult a clinician if you are taking other medications.',
    },
  });

  assert.equal(result.insights.length, 4);
  assert.equal(result.insights.every((row) => row.isExpandable), true);
  assert.equal(result.insights.every((row) => row.expandedBullets.length > 0), true);
});
