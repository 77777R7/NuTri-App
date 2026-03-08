import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import { compileDecisionSupport, type DecisionSupportOverlayClaims } from '../../backend/src/decisionSupport';
import type { FactsDigest } from '../../backend/src/factsDigest';

const ROOT_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const DECISION_FIXTURE_PATH = path.join(
  ROOT_DIR,
  'output',
  'demo5',
  'sports_research_vitamin_c',
  'demo_decision_support_sports_research_00023249090021.json',
);
const OVERLAY_FIXTURE_PATH = path.join(ROOT_DIR, 'output', 'demo5_iherb', 'extracted_demo5_overlay.json');
const TARGET_BARCODE = '00023249090021';

const parseDose = (value: string | null | undefined): { amount: number | null; unit: string | null } => {
  const text = String(value ?? '').trim();
  const match = text.match(/(\d+(?:,\d{3})*(?:\.\d+)?)\s*(mcg|µg|μg|mg|g|iu)\b/i);
  if (!match?.[1] || !match[2]) return { amount: null, unit: null };
  const amount = Number(match[1].replace(/,/g, ''));
  if (!Number.isFinite(amount)) return { amount: null, unit: null };
  return { amount, unit: match[2] };
};

const toOverlayClaims = (productRow: Record<string, unknown>): DecisionSupportOverlayClaims => {
  const categoriesRaw = Array.isArray(productRow.categories)
    ? productRow.categories
    : Array.isArray(productRow.category)
      ? productRow.category
      : [];
  const sections =
    (productRow.allDescriptionSections && typeof productRow.allDescriptionSections === 'object'
      ? productRow.allDescriptionSections
      : productRow.description_sections) ?? {};
  const factsNode =
    (productRow.supplementFacts && typeof productRow.supplementFacts === 'object'
      ? productRow.supplementFacts
      : productRow.supplement_facts) ?? {};
  const factsRaw = Array.isArray((factsNode as any).nutritionalFacts)
    ? (factsNode as any).nutritionalFacts
    : [];

  return {
    provider: 'iherb',
    productId:
      typeof productRow.productId === 'number'
        ? String(productRow.productId)
        : typeof productRow.product_id === 'string'
          ? productRow.product_id
          : null,
    link: typeof productRow.link === 'string' ? productRow.link : null,
    categories: categoriesRaw.map((item) => String(item ?? '').trim()).filter(Boolean),
    description: typeof (sections as any).Description === 'string' ? (sections as any).Description : null,
    suggestedUse:
      typeof (sections as any)['Suggested use'] === 'string'
        ? (sections as any)['Suggested use']
        : null,
    otherIngredients:
      typeof (sections as any)['Other ingredients'] === 'string'
        ? (sections as any)['Other ingredients']
        : null,
    warnings: typeof (sections as any).Warnings === 'string' ? (sections as any).Warnings : null,
    disclaimer: typeof (sections as any).Disclaimer === 'string' ? (sections as any).Disclaimer : null,
    nutritionalFacts: factsRaw
      .map((row: any) => ({
        substancy: String(row?.substancy ?? '').trim(),
        amountPerServing: String(row?.amountPerServing ?? '').trim(),
        dailyValuePercent: String(row?.dailyValuePercent ?? '').trim() || null,
      }))
      .filter((row: any) => row.substancy || row.amountPerServing || row.dailyValuePercent),
  };
};

test('vitamin c decision support confirms chemical form and UL comparison from supplemental label data', () => {
  const decisionFixture = JSON.parse(fs.readFileSync(DECISION_FIXTURE_PATH, 'utf8')) as any;
  const overlayFixture = JSON.parse(fs.readFileSync(OVERLAY_FIXTURE_PATH, 'utf8')) as any;
  const overlayProduct = (overlayFixture?.products ?? []).find(
    (item: any) => String(item?.barcode_gtin14 ?? '').trim() === TARGET_BARCODE,
  );
  assert.ok(overlayProduct, 'missing iHerb overlay fixture for Vitamin C barcode');

  const verifiedKeyIngredients = decisionFixture?.body?.overviewBlock?.providesVerified?.keyIngredients ?? [];
  const firstKeyIngredient = verifiedKeyIngredients[0] ?? {};
  const parsedDose = parseDose(firstKeyIngredient?.dose);

  const digest: FactsDigest = {
    sourceType: 'dsld',
    identity: {
      type: 'dsldLabelId',
      value: '326292',
      regionTags: ['US'],
    },
    product: {
      brandDisplay: String(decisionFixture?.body?.brand ?? 'Sports Research'),
      name: String(decisionFixture?.body?.product ?? 'Vitamin C 1000 mg'),
      dosageForm: String(decisionFixture?.body?.overviewBlock?.providesVerified?.servingSize ?? 'Veggie Capsule(s)'),
      route: null,
    },
    actives: [
      {
        name: String(firstKeyIngredient?.name ?? 'Vitamin C'),
        amount: parsedDose.amount,
        unit: parsedDose.unit,
        source: 'dsld',
        confidence: 1,
      },
    ],
    inactives: [],
    serving: {
      servingSize: String(decisionFixture?.body?.overviewBlock?.providesVerified?.servingSize ?? '1 Veggie Capsule(s)'),
      servingsPerContainer: Number(decisionFixture?.body?.overviewBlock?.providesVerified?.servingsPerContainer ?? 240),
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
  };

  const compiled = compileDecisionSupport({
    digest,
    factsDigestHash: 'fixture-vitamin-c',
    viewMode: 'details',
    overlayClaims: toOverlayClaims(overlayProduct),
  });

  const formulaModule = compiled.nutriScoreCardV2.modules.find((item) => item.id === 'formula_transparency');
  assert.ok(formulaModule, 'missing formula transparency module');
  assert.equal(formulaModule?.score, 100);

  const chemicalFormItem = formulaModule?.checklist.find(
    (item) => item.key === 'formula_transparency:chemical_form_disclosed',
  );
  assert.equal(chemicalFormItem?.state, 'verified');
  assert.equal(chemicalFormItem?.evidenceStrength, 'overlay_label_transcription');

  const breakdownItem = formulaModule?.checklist.find(
    (item) => item.key === 'formula_transparency:breakdown_disclosed',
  );
  assert.equal(breakdownItem?.label, 'Active ingredient list disclosed');
  assert.equal(breakdownItem?.evidenceStrength, 'official');

  assert.ok(compiled.nutriScoreCardV2.confidencePct >= 65);

  const ulText = (compiled.safetyBlock.ulGuidance ?? []).join(' ');
  assert.match(ulText, /2000\s*mg\/day/i);
  assert.match(ulText, /up to\s*3000\s*mg\/day/i);

  const testingModule = compiled.nutriScoreCardV2.modules.find((item) => item.id === 'testing_verification');
  assert.ok(testingModule, 'missing testing & verification module');
  assert.equal(testingModule?.checklist.length, 1);
  const testingItem = testingModule?.checklist[0];
  assert.equal(testingItem?.key, 'testing_verification:third_party_tested_claim');
  assert.equal(testingItem?.note, null);

  assert.equal(compiled.scienceBlock.ingredientSourceTier, 'overlay_iherb');
  assert.deepEqual(compiled.scienceBlock.ingredientRows, [
    {
      name: 'Vitamin C (as Ascorbic Acid)',
      dose: '1000 mg',
    },
  ]);

  const snapshotNames = compiled.scienceBlock.ingredientSnapshotNames ?? [];
  assert.deepEqual(snapshotNames, (compiled.scienceBlock.ingredientRows ?? []).map((row) => row.name));
  assert.equal(new Set(snapshotNames.map((name) => name.toLowerCase())).size, snapshotNames.length);
  assert.equal(snapshotNames.some((name) => /[.!?]$/.test(name)), false);

  const aiSummaryText = (compiled.scienceBlock.aiSummaryContract3 ?? []).join(' ');
  assert.match(aiSummaryText, /Vitamin C \(as Ascorbic Acid\)/i);
  assert.match(aiSummaryText, /1000 mg/i);
});

test('decision support falls back to official science rows when iHerb coverage fails', () => {
  const digest: FactsDigest = {
    sourceType: 'dsld',
    identity: {
      type: 'dsldLabelId',
      value: 'fallback-fixture',
      regionTags: ['US'],
    },
    product: {
      brandDisplay: 'Fallback Brand',
      name: 'Vitamin C plus Rose Hips',
      dosageForm: 'Capsule',
      route: null,
    },
    actives: [
      {
        name: 'Vitamin C',
        amount: 1000,
        unit: 'mg',
        source: 'dsld',
        confidence: 1,
      },
      {
        name: 'Rose Hips',
        amount: 100,
        unit: 'mg',
        source: 'dsld',
        confidence: 1,
      },
    ],
    inactives: [],
    serving: {
      servingSize: '1 Capsule',
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
  };

  const compiled = compileDecisionSupport({
    digest,
    factsDigestHash: 'fallback-coverage-fixture',
    viewMode: 'details',
    overlayClaims: {
      provider: 'iherb',
      productId: 'fallback-coverage-fixture',
      link: null,
      categories: [],
      description: null,
      suggestedUse: null,
      otherIngredients: null,
      warnings: null,
      disclaimer: null,
      nutritionalFacts: [
        {
          substancy: 'Vitamin C (as Ascorbic Acid)',
          amountPerServing: '1000 mg',
          dailyValuePercent: '1111%',
        },
      ],
    },
  });

  assert.equal(compiled.scienceBlock.ingredientSourceTier, 'official_record');
  assert.deepEqual(compiled.scienceBlock.ingredientRows, [
    {
      name: 'Vitamin C',
      dose: '1000 mg',
    },
    {
      name: 'Rose Hips',
      dose: '100 mg',
    },
  ]);
});
