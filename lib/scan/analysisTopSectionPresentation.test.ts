import test from 'node:test';
import assert from 'node:assert/strict';

import {
  buildAnalysisTopSectionPresentation,
  buildAnalysisTopSectionSyncKey,
  resolveAnalysisTopSectionDefaultExpandedKey,
} from './analysisTopSectionPresentation';

test('hero stays goal-fit-only even when allergy conflict banner is present', () => {
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
    safety: {
      warningText: 'Consult a healthcare professional before use.',
    },
  });

  assert.equal(result.banner?.kind, 'allergy');
  assert.equal(result.hero.chip, 'Strong fit for you');
  assert.equal(result.hero.summary, 'Best aligned with your Immunity goal');
  assert.equal(result.insights.some((row) => row.topic === 'allergy'), false);
  assert.equal(result.insights.some((row) => row.topic === 'safety'), true);
});

test('generic safety stays in insights when present and is never promoted to top banner', () => {
  const result = buildAnalysisTopSectionPresentation({
    goal: {
      previewTopTier: 'related',
      previewGoalLabel: 'Energy',
    },
    personalInsight: {
      supportLabels: ['Energy'],
      conflictSummary: 'Overlaps with a supplement already in your stack.',
    },
    allergy: {
      status: 'ready',
      matchedLabels: [],
      evidenceTexts: [],
      summary: 'This product does not appear to match your saved allergy settings.',
    },
    dose: {
      status: 'ready',
      assessment: 'high',
      productDoseText: '2 capsules per serving',
    },
    safety: {
      warningText: 'Consult a healthcare professional before use.',
    },
  });

  assert.equal(result.banner, null);
  assert.equal(result.insights.some((row) => row.topic === 'safety'), true);
  assert.equal(result.insights.some((row) => row.topic === 'support'), true);
});

test('safety remains visible when more than four candidate rows exist', () => {
  const result = buildAnalysisTopSectionPresentation({
    goal: {
      fitDecision: 'fits',
      selectedGoalLabel: 'Immunity',
    },
    personalInsight: {
      supportLabels: ['Immunity'],
      conflictSummary: 'May overlap with your existing vitamin D supplement.',
    },
    allergy: {
      status: 'ready',
      matchedLabels: [],
      evidenceTexts: ['dairy'],
      summary: 'This product does not appear to match your saved allergy settings.',
    },
    dose: {
      status: 'ready',
      assessment: 'aligned',
      productDoseText: '1 capsule daily',
    },
    safety: {
      watchoutText: 'May need extra caution based on the label.',
    },
  });

  assert.equal(result.insights.length, 4);
  assert.equal(result.insights.some((row) => row.topic === 'safety'), true);
  assert.equal(result.insights.some((row) => row.topic === 'overlap'), false);
});

test('default expanded key resolves to the first available row when preferred key is missing', () => {
  const result = buildAnalysisTopSectionPresentation({
    goal: {
      previewTopTier: 'related',
      previewGoalLabel: 'Recovery',
    },
    personalInsight: {
      supportLabels: ['Recovery'],
    },
    allergy: {
      status: 'ready',
      matchedLabels: [],
      evidenceTexts: [],
      summary: 'This product does not appear to match your saved allergy settings.',
    },
    dose: {
      status: 'ready',
      assessment: 'aligned',
      productDoseText: '1 serving daily',
    },
    safety: {},
  });

  assert.equal(resolveAnalysisTopSectionDefaultExpandedKey(result, 'missing'), result.insights[0]?.key ?? null);
});

test('sync key changes when hero or insight structure changes', () => {
  const first = buildAnalysisTopSectionPresentation({
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
      summary: 'This product does not appear to match your saved allergy settings.',
    },
    dose: {
      status: 'ready',
      assessment: 'aligned',
      productDoseText: '1 capsule daily',
    },
    safety: {},
  });

  const second = buildAnalysisTopSectionPresentation({
    goal: {
      fitDecision: 'mixed',
      selectedGoalLabel: 'Recovery',
    },
    personalInsight: {
      supportLabels: ['Recovery'],
    },
    allergy: {
      status: 'ready',
      matchedLabels: [],
      evidenceTexts: [],
      summary: 'No allergy or restriction settings saved yet.',
    },
    dose: {
      status: 'ready',
      assessment: 'unclear',
      productDoseText: '1 capsule daily',
    },
    safety: {},
  });

  const firstKey = buildAnalysisTopSectionSyncKey({
    productIdentity: 'product-1',
    hero: first.hero,
    banner: first.banner,
    insights: first.insights,
  });
  const secondKey = buildAnalysisTopSectionSyncKey({
    productIdentity: 'product-1',
    hero: second.hero,
    banner: second.banner,
    insights: second.insights,
  });

  assert.notEqual(firstKey, secondKey);
});
