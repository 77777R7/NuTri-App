import assert from 'node:assert/strict';
import test from 'node:test';

import { compileDecisionSupport, type DecisionSupportOverlayClaims } from '../../backend/src/decisionSupport';
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

const buildOverlayClaims = (
  nutritionalFacts: Array<{ substancy: string; amountPerServing: string; dailyValuePercent?: string | null }>,
  categories: string[] = [],
): DecisionSupportOverlayClaims => ({
  provider: 'iherb',
  productId: 'fixture-product',
  brandName: null,
  title: null,
  link: null,
  categories,
  description: null,
  suggestedUse: null,
  otherIngredients: null,
  warnings: null,
  disclaimer: null,
  nutritionalFacts: nutritionalFacts.map((row) => ({
    substancy: row.substancy,
    amountPerServing: row.amountPerServing,
    dailyValuePercent: row.dailyValuePercent ?? null,
  })),
});

test('decision support source-locks omega-3 science rows to clean iHerb ingredients', () => {
  const digest = buildDigest({
    labelId: 'fixture-omega3',
    productName: 'Alaskan Omega-3 Fish Oil',
    dosageForm: 'Softgel',
    actives: [
      { name: 'Calories', amount: 15, unit: 'cal' },
      { name: 'Total Fat', amount: 1.5, unit: 'g' },
      { name: 'Wild Alaska Pollock Fish Oil Concentrate', amount: 1250, unit: 'mg' },
      { name: 'Total Omega-3 Fatty Acids as TG', amount: 1040, unit: 'mg' },
      { name: 'EPA', amount: 690, unit: 'mg' },
      { name: 'DHA', amount: 260, unit: 'mg' },
    ],
  });

  const compiled = compileDecisionSupport({
    digest,
    factsDigestHash: 'fixture-omega3-source-lock',
    viewMode: 'details',
    overlayClaims: buildOverlayClaims(
      [
        { substancy: '', amountPerServing: 'Amount Per Serving', dailyValuePercent: '%DV' },
        { substancy: 'Calories', amountPerServing: '15' },
        { substancy: 'Total Fat', amountPerServing: '1.5 g' },
        { substancy: 'Wild Alaska Pollock Fish Oil Concentrate', amountPerServing: '1,250 mg' },
        { substancy: 'Total Omega-3 Fatty Acids as TG', amountPerServing: '1,040 mg' },
        { substancy: 'EPA (Eicosapentaenoic Acid)', amountPerServing: '690 mg' },
        { substancy: 'DHA (Docosahexaenoic Acid)', amountPerServing: '260 mg' },
      ],
      ['Fish Oil', 'Omega-3'],
    ),
  });

  assert.equal(compiled.scienceBlock.ingredientSourceTier, 'overlay_iherb');
  assert.equal(compiled.scienceBlock.formMatters.dosageForm, 'Softgel');
  assert.equal(compiled.scienceBlock.formMatters.ingredientChemicalForm, 'Triglyceride (TG)');
  assert.deepEqual(compiled.scienceBlock.ingredientRows, [
    { name: 'Wild Alaska Pollock Fish Oil Concentrate', dose: '1,250 mg' },
    { name: 'Total Omega-3 Fatty Acids as TG', dose: '1,040 mg' },
    { name: 'EPA (Eicosapentaenoic Acid)', dose: '690 mg' },
    { name: 'DHA (Docosahexaenoic Acid)', dose: '260 mg' },
  ]);
  assert.equal(compiled.scienceBlock.ingredientRows.some((row) => row.name === 'Calories'), false);
  assert.equal(compiled.scienceBlock.ingredientRows.some((row) => row.name === 'Total Fat'), false);

  const aiSummaryText = (compiled.scienceBlock.aiSummaryContract3 ?? []).join(' ');
  assert.match(aiSummaryText, /Wild Alaska Pollock Fish Oil Concentrate/i);
  assert.match(aiSummaryText, /1,250 mg/i);
  assert.doesNotMatch(aiSummaryText, /Calories|Total Fat/i);
  assert.doesNotMatch(aiSummaryText, /in\s+Softgel\s+form/i);
  assert.doesNotMatch(aiSummaryText, /supplemental label data/i);
});

test('decision support source-locks astaxanthin science rows through alias coverage while keeping iHerb naming', () => {
  const digest = buildDigest({
    labelId: 'fixture-astaxanthin',
    productName: 'Astaxanthin 12 mg',
    dosageForm: 'Softgel',
    actives: [
      { name: 'Icelandic Astalif', amount: 12, unit: 'mg' },
    ],
  });

  const compiled = compileDecisionSupport({
    digest,
    factsDigestHash: 'fixture-astaxanthin-source-lock',
    viewMode: 'details',
    overlayClaims: buildOverlayClaims([
      {
        substancy: 'Astaxanthin (from Haematococcus pluvialis microalgae extract) (Icelandic Astalif™ )',
        amountPerServing: '12 mg',
      },
    ], ['Astaxanthin']),
  });

  assert.equal(compiled.scienceBlock.ingredientSourceTier, 'overlay_iherb');
  assert.equal(compiled.scienceBlock.formMatters.ingredientChemicalForm, 'Haematococcus pluvialis microalgae extract');
  assert.equal(compiled.scienceBlock.formMatters.dosageForm, 'Softgel');
  assert.equal(compiled.scienceBlock.ingredientRows[0]?.name, 'Astaxanthin (from Haematococcus pluvialis microalgae extract) (Icelandic Astalif)');
  assert.notEqual(compiled.scienceBlock.ingredientRows[0]?.name, 'Icelandic Astalif');

  const aiSummaryText = (compiled.scienceBlock.aiSummaryContract3 ?? []).join(' ');
  assert.match(aiSummaryText, /Astaxanthin/i);
  assert.match(aiSummaryText, /12 mg/i);
  assert.doesNotMatch(aiSummaryText, /in\s+Softgel\s+form/i);
  assert.doesNotMatch(aiSummaryText, /supplemental label data/i);
});

test('decision support does not let one overlay row satisfy two official rows through primary and alias keys', () => {
  const digest = buildDigest({
    labelId: 'fixture-duplicate-consumption',
    productName: 'Astaxanthin 12 mg',
    dosageForm: 'Softgel',
    actives: [
      { name: 'Astaxanthin', amount: 12, unit: 'mg' },
      { name: 'Icelandic Astalif', amount: 12, unit: 'mg' },
    ],
  });

  const compiled = compileDecisionSupport({
    digest,
    factsDigestHash: 'fixture-duplicate-consumption',
    viewMode: 'details',
    overlayClaims: buildOverlayClaims([
      {
        substancy: 'Astaxanthin (from Haematococcus pluvialis microalgae extract) (Icelandic Astalif™ )',
        amountPerServing: '12 mg',
      },
    ], ['Astaxanthin']),
  });

  assert.equal(compiled.scienceBlock.ingredientSourceTier, 'official_record');
  assert.deepEqual(compiled.scienceBlock.ingredientRows, [
    { name: 'Astaxanthin', dose: '12 mg' },
    { name: 'Icelandic Astalif', dose: '12 mg' },
  ]);
});

test('decision support keeps florassist science rows on iHerb even when cleaned names resemble the official record', () => {
  const digest = buildDigest({
    labelId: 'fixture-florassist',
    productName: 'Florassist GI with Phage Technology',
    dosageForm: 'Vegetarian Capsule',
    actives: [
      { name: 'Proprietary Probiotic Blend', amount: 50, unit: 'mg' },
      { name: 'TetraPhage Blend', amount: 15, unit: 'mg' },
    ],
  });

  const compiled = compileDecisionSupport({
    digest,
    factsDigestHash: 'fixture-florassist-source-lock',
    viewMode: 'details',
    overlayClaims: buildOverlayClaims([
      {
        substancy:
          'Proprietary Probiotic BlendB. breve Bbr8; L. plantarum 14D; B. animalis ssp. lactis BLC1; L. paracasei IMC 502; L. rhamnosus IMC 501; L. acidophilus LA1; B. longum ssp. longum SP54 (15 Billion CFU†)',
        amountPerServing: '50 mg',
      },
      {
        substancy: 'TetraPhage BlendLH01 - Myoviridae; LL5 - Siphoviridae;T4D - Myoviridae; LL12 - Myoviridae',
        amountPerServing: '15 mg',
      },
    ], ['Probiotics']),
  });

  assert.equal(compiled.scienceBlock.ingredientSourceTier, 'overlay_iherb');
  assert.equal(compiled.scienceBlock.formMatters.ingredientChemicalForm, null);
  assert.match(compiled.scienceBlock.formMatters.dosageForm ?? '', /Capsule/i);
  assert.deepEqual(compiled.scienceBlock.ingredientRows, [
    { name: 'Proprietary Probiotic Blend', dose: '50 mg' },
    { name: 'TetraPhage Blend', dose: '15 mg' },
  ]);

  const aiSummaryText = (compiled.scienceBlock.aiSummaryContract3 ?? []).join(' ');
  assert.match(aiSummaryText, /Proprietary Probiotic Blend 50 mg/i);
  assert.doesNotMatch(aiSummaryText, /supplemental label data/i);
});
