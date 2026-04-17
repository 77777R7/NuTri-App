import assert from 'node:assert/strict';
import test from 'node:test';

import { compileDecisionSupport, type DecisionSupportOverlayClaims } from '../../backend/src/decisionSupport';
import type { FactsDigest } from '../../backend/src/factsDigest';

const buildDigest = (): FactsDigest => ({
  sourceType: 'dsld',
  identity: {
    type: 'dsldLabelId',
    value: 'fixture-algal-dha',
    regionTags: ['US'],
  },
  product: {
    brandDisplay: "Doctor's Best",
    name: "Doctor's Best Vegan DHA from Algae",
    dosageForm: 'Veggie Softgel',
    route: null,
  },
  actives: [
    {
      name: 'DHA (Docosahexaenoic Acid, Omega-3) from algae of Schizochytrium sp',
      amount: 200,
      unit: 'mg',
      source: 'dsld',
      confidence: 1,
    },
  ],
  inactives: [],
  serving: {
    servingSize: '1 softgel',
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

const buildOverlayClaims = (): DecisionSupportOverlayClaims => ({
  provider: 'iherb',
  productId: 'fixture-algal-dha',
  brandName: "Doctor's Best",
  title: "Doctor's Best Vegan DHA from Algae",
  link: null,
  imageUrl: null,
  categories: ['Omega-3', 'Algal Oil'],
  description: null,
  suggestedUse: null,
  otherIngredients: null,
  warnings: null,
  disclaimer: null,
  nutritionalFacts: [
    {
      substancy: 'DHA (Docosahexaenoic Acid, Omega-3) from algae of Schizochytrium sp',
      amountPerServing: '200 mg',
      dailyValuePercent: null,
    },
  ],
});

test('compileDecisionSupport keeps algal omega-3 science bullets out of fish-oil language', () => {
  const compiled = compileDecisionSupport({
    digest: buildDigest(),
    factsDigestHash: 'fixture-algal-dha-source-lock',
    viewMode: 'details',
    overlayClaims: buildOverlayClaims(),
  });

  const scienceText = (compiled.scienceBlock.odsGeneralScienceBullets ?? []).join(' ');
  assert.match(scienceText, /omega-3|epa\+dha|label transparency/i);
  assert.doesNotMatch(scienceText, /fish oil/i);
});
