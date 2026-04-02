import assert from 'node:assert/strict';
import test from 'node:test';

import {
  compileDecisionSupport,
  type DecisionSupportAttachedPersonalizationContext,
} from '../../backend/src/decisionSupport';
import type { FactsDigest } from '../../backend/src/factsDigest';

const buildOmegaDigest = (): FactsDigest => ({
  sourceType: 'dsld',
  identity: {
    type: 'dsldLabelId',
    value: 'fixture-sr-omega-3',
    regionTags: ['US'],
  },
  product: {
    brandDisplay: 'Sports Research',
    name: 'Omega-3 1040 mg Fish Oil 1250 mg',
    dosageForm: 'Softgel',
    route: null,
  },
  actives: [
    {
      name: 'Fish Oil',
      amount: 1250,
      unit: 'mg',
      amountText: '1250 mg',
      chemicalForm: 'Triglyceride form',
      source: 'dsld',
      confidence: 1,
    },
    {
      name: 'EPA',
      amount: 690,
      unit: 'mg',
      amountText: '690 mg',
      source: 'dsld',
      confidence: 1,
    },
    {
      name: 'DHA',
      amount: 260,
      unit: 'mg',
      amountText: '260 mg',
      source: 'dsld',
      confidence: 1,
    },
  ],
  inactives: ['Gelatin', 'Glycerin'],
  serving: {
    servingSize: '1 softgel',
    servingsPerContainer: 60,
  },
  labelDosing: [],
  warnings: {
    warnings: ['Contains fish.'],
    consultDoctorIf: [],
    redFlags: [],
    missingFlag: false,
  },
  claims: {
    labelPurposes: [],
    webClaims: [],
  },
  quality: {
    isComplete: true,
    missingFields: [],
    completenessScore: 100,
  },
});

const buildPersonalizationContext = (
  overrides?: Partial<DecisionSupportAttachedPersonalizationContext>,
): DecisionSupportAttachedPersonalizationContext => ({
  prioritizedGoals: ['recovery'],
  selectedGoalKey: 'recovery',
  preferredTypes: ['vitamin'],
  supplementExperience: 'regular_user',
  ageRange: '25-34',
  adherenceBlocker: 'label_and_dosage_confusion',
  stackOverlap: {
    status: 'ok',
    savedStackCount: 0,
    overlapCount: 0,
    overlaps: [],
  },
  allergyContext: {
    userAllergyFlags: [],
    userIngredientRestrictions: [],
    productAllergyFlags: ['fish'],
    productIngredientRestrictions: ['gelatin_animal_based'],
    productCoverageStatus: 'resolved',
    productMatchEvidence: {},
  },
  ...overrides,
});

test('compileDecisionSupport uses attached Recovery goal to return a non-pending omega-3 fit', () => {
  const compiled = compileDecisionSupport({
    digest: buildOmegaDigest(),
    factsDigestHash: 'fixture-sr-omega-fit',
    viewMode: 'details',
    personalizationContext: buildPersonalizationContext(),
  });

  assert.equal(compiled.personalizedResultLane.goalFit.status, 'ready');
  assert.equal(compiled.personalizedResultLane.goalFit.selectedGoalKey, 'recovery');
  assert.notEqual(compiled.personalizedResultLane.goalFit.fitTier, 'unknown');
  assert.notEqual(compiled.personalizedResultLane.personalInsight.status, 'pending');
  assert.ok(compiled.personalizedResultLane.personalInsight.supports.length > 0);
  assert.match(compiled.personalizedResultLane.goalFit.summary, /Recovery/i);
});

test('compileDecisionSupport returns a neutral ready insight when saved supplements are attached but empty', () => {
  const compiled = compileDecisionSupport({
    digest: buildOmegaDigest(),
    factsDigestHash: 'fixture-sr-omega-empty-stack',
    viewMode: 'details',
    personalizationContext: buildPersonalizationContext({
      stackOverlap: {
        status: 'ok',
        savedStackCount: 0,
        overlapCount: 0,
        overlaps: [],
      },
    }),
  });

  assert.equal(compiled.personalizedResultLane.personalInsight.status, 'ready');
  assert.equal(compiled.personalizedResultLane.personalInsight.reasonCode, null);
  assert.deepEqual(compiled.personalizedResultLane.personalInsight.conflicts, []);
  assert.equal(
    compiled.personalizedResultLane.personalInsight.conflictSummary,
    'No saved supplements to compare yet.',
  );
});

test('compileDecisionSupport turns remote omega-3 overlap into concrete personal insight conflicts', () => {
  const compiled = compileDecisionSupport({
    digest: buildOmegaDigest(),
    factsDigestHash: 'fixture-sr-omega-overlap',
    viewMode: 'details',
    personalizationContext: buildPersonalizationContext({
      stackOverlap: {
        status: 'ok',
        savedStackCount: 2,
        overlapCount: 1,
        overlaps: [
          {
            ingredientKey: 'omega-3',
            ingredientDisplay: 'Omega-3',
            count: 2,
            supplements: [
              { supplementId: 'current-omega', productName: 'Sports Research Omega-3 1040 mg' },
              { supplementId: 'saved-omega', productName: 'Nordic Naturals Ultimate Omega' },
            ],
          },
        ],
      },
    }),
  });

  assert.equal(compiled.personalizedResultLane.personalInsight.status, 'ready');
  assert.equal(compiled.personalizedResultLane.personalInsight.conflicts.length, 1);
  assert.equal(compiled.personalizedResultLane.personalInsight.conflicts[0]?.ingredient, 'Omega-3');
  assert.match(
    compiled.personalizedResultLane.personalInsight.conflictSummary,
    /saved supplement/i,
  );
  assert.equal(compiled.personalizedResultLane.personalInsight.expandableDetailsReady, true);
});
