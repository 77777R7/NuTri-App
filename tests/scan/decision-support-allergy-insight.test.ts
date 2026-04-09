import assert from 'node:assert/strict';
import test from 'node:test';

import { compileDecisionSupport } from '../../backend/src/decisionSupport';
import type { FactsDigest } from '../../backend/src/factsDigest';

const buildDigest = (): FactsDigest => ({
  sourceType: 'dsld',
  identity: {
    type: 'dsldLabelId',
    value: 'fixture-allergy-label',
    regionTags: ['US'],
  },
  product: {
    brandDisplay: 'Fixture Brand',
    name: 'Fish Oil Softgels',
    dosageForm: 'Softgel',
    route: null,
  },
  actives: [
    {
      name: 'Fish Oil',
      amount: 1200,
      unit: 'mg',
      source: 'dsld',
      confidence: 1,
    },
  ],
  inactives: ['Gelatin', 'Soy lecithin'],
  serving: {
    servingSize: '2 softgels',
    servingsPerContainer: 30,
  },
  labelDosing: [],
  warnings: {
    warnings: ['Contains fish (anchovy, sardine) and soy.'],
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

test('compileDecisionSupport surfaces attached allergy insight when profile and product flags are provided', () => {
  const compiled = compileDecisionSupport({
    digest: buildDigest(),
    factsDigestHash: 'fixture-allergy-hash',
    viewMode: 'details',
    allergyContext: {
      userAllergyFlags: ['fish'],
      userIngredientRestrictions: ['gelatin_animal_based'],
      productAllergyFlags: ['fish', 'soy'],
      productIngredientRestrictions: ['gelatin_animal_based'],
      productCoverageStatus: 'resolved',
      productMatchEvidence: {
        flags: {
          fish: [
            {
              source: 'active_ingredient',
              matchedText: 'Fish Oil',
              confidence: 'high',
            },
          ],
          gelatin_animal_based: [
            {
              source: 'inactive_ingredient',
              matchedText: 'Gelatin',
              confidence: 'high',
            },
          ],
        },
      },
    },
  });

  assert.equal(compiled.personalizedResultLane.allergyInsight.status, 'ready');
  assert.equal(
    compiled.personalizedResultLane.allergyInsight.summary,
    'May conflict with your allergy settings.',
  );
  assert.deepEqual(compiled.personalizedResultLane.allergyInsight.matchedAllergyFlags, ['fish']);
  assert.deepEqual(
    compiled.personalizedResultLane.allergyInsight.matchedRestrictions,
    ['gelatin_animal_based'],
  );
  assert.equal(compiled.personalizedResultLane.allergyInsight.details.length, 2);
});

test('compileDecisionSupport keeps allergy insight unavailable when only user settings are attached', () => {
  const compiled = compileDecisionSupport({
    digest: buildDigest(),
    factsDigestHash: 'fixture-allergy-hash-pending',
    viewMode: 'details',
    allergyContext: {
      userAllergyFlags: ['soy'],
      userIngredientRestrictions: [],
    },
  });

  assert.equal(compiled.personalizedResultLane.allergyInsight.status, 'unavailable');
  assert.equal(
    compiled.personalizedResultLane.allergyInsight.reasonCode,
    'NORMALIZED_PRODUCT_ALLERGY_FLAGS_NOT_ATTACHED',
  );
});
