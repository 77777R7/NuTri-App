import assert from 'node:assert/strict';
import test from 'node:test';

import { compileDecisionSupport } from '../../backend/src/decisionSupport';
import type { FactsDigest } from '../../backend/src/factsDigest';

const buildDigest = (params: {
  labelId: string;
  productName: string;
  dosageForm: string;
  actives: Array<{ name: string; amount: number | null; unit: string | null }>;
}): FactsDigest => ({
  sourceType: 'dsld',
  identity: {
    type: 'dsldLabelId',
    value: params.labelId,
    regionTags: ['US'],
  },
  product: {
    brandDisplay: 'Fixture Brand',
    name: params.productName,
    dosageForm: params.dosageForm,
    route: null,
  },
  actives: params.actives.map((active) => ({
    name: active.name,
    amount: active.amount,
    unit: active.unit,
    source: 'dsld',
    confidence: 1,
  })),
  inactives: [],
  serving: {
    servingSize: `1 ${params.dosageForm}`,
    servingsPerContainer: 60,
  },
  labelDosing: [],
  warnings: {
    warnings: [],
    consultDoctorIf: [],
    redFlags: [],
    missingFlag: true,
  },
  claims: {
    labelPurposes: [],
    webClaims: [],
  },
  quality: {
    isComplete: true,
    missingFields: [],
    completenessScore: 90,
  },
});

test('decision support keeps functional food-like summaries out of supplement research language', () => {
  const digest = buildDigest({
    labelId: 'fixture-food-like-summary',
    productName: 'BetterBody Foods, Organic Coconut Aminos, Soy Sauce Replacement',
    dosageForm: 'Liquid',
    actives: [
      { name: 'Niacin', amount: 1.5, unit: 'mg' },
    ],
  });

  const compiled = compileDecisionSupport({
    digest,
    factsDigestHash: 'fixture-food-like-summary',
    viewMode: 'details',
    overlayClaims: null,
  });

  assert.match(compiled.scienceBlock.ingredientRows[0]?.name ?? '', /coconut aminos|soy sauce replacement/i);

  const aiSummaryText = (compiled.scienceBlock.aiSummaryContract3 ?? []).join(' ');
  assert.match(aiSummaryText, /food-like label context|food, drink, snack, or seasoning/i);
  assert.match(aiSummaryText, /Nutrition Facts|ingredient list/i);
  assert.doesNotMatch(aiSummaryText, /goal-oriented supplement support|stand-alone supplement claim|supplement-style|per-serving actives|Directions \+ Warnings panel/i);
});
