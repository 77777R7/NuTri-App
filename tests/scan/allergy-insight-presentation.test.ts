import assert from 'node:assert/strict';
import test from 'node:test';

import { buildAllergyInsightPresentation } from '../../lib/scan/allergyInsightPresentation';

test('buildAllergyInsightPresentation highlights matched allergy settings', () => {
  const result = buildAllergyInsightPresentation({
    status: 'ready',
    reasonCode: null,
    summary: 'May conflict with your allergy settings.',
    matchedAllergyFlags: ['fish'],
    matchedRestrictions: ['gelatin_animal_based'],
    details: [
      {
        flag: 'fish',
        source: 'active_ingredient',
        matchedText: 'Fish Oil',
        confidence: 'high',
      },
      {
        flag: 'gelatin_animal_based',
        source: 'inactive_ingredient',
        matchedText: 'Gelatin',
        confidence: 'high',
      },
    ],
  });

  assert.equal(result.title, 'Potential allergy conflict');
  assert.equal(result.tone, 'caution');
  assert.match(result.body, /Fish/);
  assert.match(result.body, /Animal-based gelatin/);
  assert.match(result.body, /Fish Oil/);
});

test('buildAllergyInsightPresentation prompts for saved preferences when user has none', () => {
  const result = buildAllergyInsightPresentation({
    status: 'ready',
    reasonCode: null,
    summary: 'No allergy or restriction settings saved yet.',
    matchedAllergyFlags: [],
    matchedRestrictions: [],
    details: [],
  });

  assert.equal(result.title, 'Add allergy preferences');
  assert.equal(result.tone, 'neutral');
});

test('buildAllergyInsightPresentation stays neutral when product flags are still pending', () => {
  const result = buildAllergyInsightPresentation({
    status: 'pending',
    reasonCode: 'NORMALIZED_PRODUCT_ALLERGY_FLAGS_NOT_ATTACHED',
    summary: 'Allergy-aware reasoning is reserved here, but normalized product allergen flags are not attached yet.',
    matchedAllergyFlags: [],
    matchedRestrictions: [],
    details: [],
  });

  assert.equal(result.title, 'Allergy check pending');
  assert.equal(result.tone, 'neutral');
});
