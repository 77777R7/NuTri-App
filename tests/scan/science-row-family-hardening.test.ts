import assert from 'node:assert/strict';
import test from 'node:test';

import type { FactsDigest } from '../../backend/src/factsDigest';
import { buildIngredientScienceContext } from '../../backend/src/ingredientScienceContext';
import { compileIngredientOverviewAsync } from '../../backend/src/insights/ingredientOverviewCompiler';
import { planScientificBackgroundSections } from '../../backend/src/insights/scientificBackgroundCompiler';

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

test('row-level family inference does not let zinc or calcium inherit vitamin C family', () => {
  const digest = buildDigest({
    labelId: 'fixture-vitamin-c-zinc-calcium',
    productName: 'Vitamin C with Zinc and Calcium',
    dosageForm: 'Capsule',
    actives: [
      { name: 'Vitamin C', amount: 1000, unit: 'mg' },
      { name: 'Zinc', amount: 15, unit: 'mg' },
      { name: 'Calcium', amount: 100, unit: 'mg' },
    ],
  });

  const context = buildIngredientScienceContext({ digest, overlayClaims: null });
  const familyByName = new Map(context.ingredientDescriptors.map((descriptor) => [descriptor.name, descriptor.ingredientFamily]));

  assert.equal(familyByName.get('Vitamin C'), 'vitamin_c');
  assert.equal(familyByName.get('Zinc'), 'zinc');
  assert.equal(familyByName.get('Calcium'), 'calcium');

  const zincPlan = planScientificBackgroundSections({
    context,
    selectedIngredientName: 'Zinc',
  });
  const calciumPlan = planScientificBackgroundSections({
    context,
    selectedIngredientName: 'Calcium',
  });

  assert.deepEqual(
    zincPlan.sections.map((section) => section.heading),
    ['Immune function context', 'Skin and barrier research'],
  );
  assert.deepEqual(
    calciumPlan.sections.map((section) => section.heading),
    ['Bone and intake context', 'Form and absorption context', 'How co-formulation changes comparison'],
  );
});

test('row-level family inference keeps iron separate from vitamin C in combo formulas', () => {
  const digest = buildDigest({
    labelId: 'fixture-iron-vitamin-c',
    productName: 'Iron with Vitamin C',
    dosageForm: 'Capsule',
    actives: [
      { name: 'Iron (as Ferrous Bisglycinate Chelate)', amount: 18, unit: 'mg' },
      { name: 'Vitamin C', amount: 90, unit: 'mg' },
    ],
  });

  const context = buildIngredientScienceContext({ digest, overlayClaims: null });
  const familyByName = new Map(context.ingredientDescriptors.map((descriptor) => [descriptor.name, descriptor.ingredientFamily]));

  assert.equal(familyByName.get('Iron (as Ferrous Bisglycinate Chelate)'), 'iron');
  assert.equal(familyByName.get('Vitamin C'), 'vitamin_c');

  const ironPlan = planScientificBackgroundSections({
    context,
    selectedIngredientName: 'Iron (as Ferrous Bisglycinate Chelate)',
  });

  assert.deepEqual(
    ironPlan.sections.map((section) => section.heading),
    ['Iron status and deficiency context', 'Form and tolerability context', 'What product comparison depends on'],
  );
});

test('row-level family inference keeps b12, folate, and b6 distinct inside a b-complex formula', () => {
  const digest = buildDigest({
    labelId: 'fixture-b-complex',
    productName: 'B-Complex with B12, Folate, and B6',
    dosageForm: 'Capsule',
    actives: [
      { name: 'Vitamin B12 (as Methylcobalamin)', amount: 1000, unit: 'mcg' },
      { name: 'Folate (as 5-MTHF)', amount: 680, unit: 'mcg DFE' },
      { name: 'Vitamin B6 (as Pyridoxal-5-Phosphate)', amount: 20, unit: 'mg' },
    ],
  });

  const context = buildIngredientScienceContext({ digest, overlayClaims: null });
  const familyByName = new Map(context.ingredientDescriptors.map((descriptor) => [descriptor.name, descriptor.ingredientFamily]));

  assert.equal(familyByName.get('Vitamin B12 (as Methylcobalamin)'), 'b12');
  assert.equal(familyByName.get('Folate (as 5-MTHF)'), 'folate');
  assert.equal(familyByName.get('Vitamin B6 (as Pyridoxal-5-Phosphate)'), 'b6');

  const b12Plan = planScientificBackgroundSections({
    context,
    selectedIngredientName: 'Vitamin B12 (as Methylcobalamin)',
  });
  const folatePlan = planScientificBackgroundSections({
    context,
    selectedIngredientName: 'Folate (as 5-MTHF)',
  });
  const b6Plan = planScientificBackgroundSections({
    context,
    selectedIngredientName: 'Vitamin B6 (as Pyridoxal-5-Phosphate)',
  });

  assert.deepEqual(
    b12Plan.sections.map((section) => section.heading),
    ['Deficiency and supplementation context', 'Nerve and blood-cell context', 'What form disclosure changes'],
  );
  assert.deepEqual(
    folatePlan.sections.map((section) => section.heading),
    ['Folate status and supplementation context', 'Pregnancy and developmental context', 'What form labeling changes'],
  );
  assert.deepEqual(
    b6Plan.sections.map((section) => section.heading),
    ['Cofactor and metabolism context', 'Nerve-related interpretation', 'Why dose context matters'],
  );
});

test('row-level family inference keeps botanical extracts distinct inside a mixed herbal formula', () => {
  const digest = buildDigest({
    labelId: 'fixture-botanical-combo',
    productName: 'Curcumin with Ashwagandha, Ginseng, and Green Tea Extract',
    dosageForm: 'Capsule',
    actives: [
      { name: 'Curcumin C3 Complex', amount: 500, unit: 'mg' },
      { name: 'Ashwagandha (KSM-66)', amount: 300, unit: 'mg' },
      { name: 'Panax Ginseng Extract', amount: 200, unit: 'mg' },
      { name: 'Green Tea Extract (EGCG)', amount: 150, unit: 'mg' },
    ],
  });

  const context = buildIngredientScienceContext({ digest, overlayClaims: null });
  const familyByName = new Map(context.ingredientDescriptors.map((descriptor) => [descriptor.name, descriptor.ingredientFamily]));

  assert.equal(familyByName.get('Curcumin C3 Complex'), 'curcumin');
  assert.equal(familyByName.get('Ashwagandha (KSM-66)'), 'ashwagandha');
  assert.equal(familyByName.get('Panax Ginseng Extract'), 'ginseng');
  assert.equal(familyByName.get('Green Tea Extract (EGCG)'), 'green_tea_extract');

  const curcuminPlan = planScientificBackgroundSections({
    context,
    selectedIngredientName: 'Curcumin C3 Complex',
  });
  const ashwagandhaPlan = planScientificBackgroundSections({
    context,
    selectedIngredientName: 'Ashwagandha (KSM-66)',
  });
  const ginsengPlan = planScientificBackgroundSections({
    context,
    selectedIngredientName: 'Panax Ginseng Extract',
  });
  const greenTeaPlan = planScientificBackgroundSections({
    context,
    selectedIngredientName: 'Green Tea Extract (EGCG)',
  });

  assert.deepEqual(
    curcuminPlan.sections.map((section) => section.heading),
    ['Most studied outcomes', 'Why extract detail matters', 'Where evidence remains mixed'],
  );
  assert.deepEqual(
    ashwagandhaPlan.sections.map((section) => section.heading),
    ['Stress and mood-related research', 'Sleep and recovery context', 'Why extract identity matters'],
  );
  assert.deepEqual(
    ginsengPlan.sections.map((section) => section.heading),
    ['Energy and fatigue context', 'Cognitive and performance interpretation', 'Why species and extract detail matter'],
  );
  assert.deepEqual(
    greenTeaPlan.sections.map((section) => section.heading),
    ['Catechin and antioxidant context', 'Metabolic and weight-related interpretation', 'Why extract concentration matters'],
  );
});

test('row-level family inference keeps 7-keto, cla, and carnitine distinct inside a metabolic formula', () => {
  const digest = buildDigest({
    labelId: 'fixture-metabolic-formula',
    productName: '7-Keto CLA Carnitine Metabolic Formula',
    dosageForm: 'Capsule',
    actives: [
      { name: '7-Keto (DHEA Acetate-7-one)', amount: 100, unit: 'mg' },
      { name: 'Conjugated Linoleic Acid (CLA) (from Safflower Oil)', amount: 800, unit: 'mg' },
      { name: 'Acetyl-L-Carnitine HCl', amount: 500, unit: 'mg' },
      { name: 'Green Tea Extract (Camellia sinensis) (Leaf)', amount: 250, unit: 'mg' },
    ],
  });

  const context = buildIngredientScienceContext({ digest, overlayClaims: null });
  const familyByName = new Map(context.ingredientDescriptors.map((descriptor) => [descriptor.name, descriptor.ingredientFamily]));

  assert.equal(familyByName.get('7-Keto (DHEA Acetate-7-one)'), '7keto_dhea_metabolite');
  assert.equal(familyByName.get('Conjugated Linoleic Acid (CLA) (from Safflower Oil)'), 'cla');
  assert.equal(familyByName.get('Acetyl-L-Carnitine HCl'), 'carnitine');
  assert.equal(familyByName.get('Green Tea Extract (Camellia sinensis) (Leaf)'), 'green_tea_extract');

  const sevenKetoPlan = planScientificBackgroundSections({
    context,
    selectedIngredientName: '7-Keto (DHEA Acetate-7-one)',
  });
  const claPlan = planScientificBackgroundSections({
    context,
    selectedIngredientName: 'Conjugated Linoleic Acid (CLA) (from Safflower Oil)',
  });
  const carnitinePlan = planScientificBackgroundSections({
    context,
    selectedIngredientName: 'Acetyl-L-Carnitine HCl',
  });

  assert.deepEqual(
    sevenKetoPlan.sections.map((section) => section.heading),
    ['Metabolic and body-composition context', 'Why it reads differently from DHEA'],
  );
  assert.deepEqual(
    claPlan.sections.map((section) => section.heading),
    ['Body-composition context', 'Source oil and isomer detail'],
  );
  assert.deepEqual(
    carnitinePlan.sections.map((section) => section.heading),
    ['Energy transport and exercise context', 'What form disclosure changes'],
  );
});

test('ingredient overview rejects factual A-card restatement and falls back to formula-reading copy', async () => {
  const digest = buildDigest({
    labelId: 'fixture-omega3',
    productName: 'Omega-3 1040 mg Fish Oil 1250 mg',
    dosageForm: 'Softgel',
    actives: [
      { name: 'Wild Alaska Pollock Fish Oil Concentrate', amount: 1250, unit: 'mg' },
      { name: 'Total Omega-3 Fatty Acids as TG', amount: 1040, unit: 'mg' },
      { name: 'EPA (Eicosapentaenoic Acid)', amount: 690, unit: 'mg' },
      { name: 'DHA (Docosahexaenoic Acid)', amount: 260, unit: 'mg' },
    ],
  });

  const context = buildIngredientScienceContext({ digest, overlayClaims: null });
  const result = await compileIngredientOverviewAsync(context, {
    llmFn: async () =>
      JSON.stringify({
        mode: 'multi_anchor',
        titleLine: 'Omega-3 1040 mg Fish Oil 1250 mg',
        paragraph1: 'This supplement provides omega-3 fatty acids from wild Alaska pollock fish oil concentrate.',
        paragraph2: 'The formula delivers 1,040 mg of total omega-3s, including 690 mg of EPA and 260 mg of DHA.',
        compareHint: 'Compare products by ingredient amount and quality.',
      }),
  });

  assert.equal(result.source, 'fallback');
  assert.equal(result.fallbackUsed, true);
  assert.match(result.ingredientOverview.paragraph1, /source ingredient|fish oil/i);
  assert.match(result.ingredientOverview.paragraph2 ?? '', /break out total omega-3|epa and dha/i);
  assert.match(result.ingredientOverview.compareHint ?? '', /EPA and DHA|total omega-3/i);
});

test('ingredient overview repairs a near-miss writer response into an api result when the anchor and compare hint can be normalized', async () => {
  const digest = buildDigest({
    labelId: 'fixture-5htp-companions',
    productName: '5-HTP with Glycine Taurine and Inositol',
    dosageForm: 'Capsule',
    actives: [
      { name: '5-HTP (5-hydroxytryptophan)', amount: 200, unit: 'mg' },
      { name: 'Glycine', amount: 100, unit: 'mg' },
      { name: 'Taurine', amount: 100, unit: 'mg' },
      { name: 'Inositol', amount: 100, unit: 'mg' },
    ],
  });

  const context = buildIngredientScienceContext({ digest, overlayClaims: null });
  const result = await compileIngredientOverviewAsync(context, {
    llmFn: async () => JSON.stringify({
      titleLine: 'Formula structure',
      paragraph1: 'The label keeps one main active and then arranges the surrounding lines as supporting formula components.',
      paragraph2: 'Glycine, taurine, and inositol read more like companion rows than equal co-headliners.',
      compareHint: 'Compare how clearly the label discloses the main active line and the supporting formula lines.',
    }),
    timeoutMs: 200,
    maxRetries: 0,
  });

  assert.equal(result.source, 'api');
  assert.equal(result.fallbackUsed, false);
  assert.match(result.ingredientOverview.paragraph1, /5-HTP/i);
  assert.match(result.ingredientOverview.compareHint ?? '', /label|supporting formula lines/i);
});

test('single-anchor ingredient overview still allows identity copy when it adds label meaning', async () => {
  const digest = buildDigest({
    labelId: 'fixture-astaxanthin',
    productName: 'Astaxanthin 12 mg',
    dosageForm: 'Softgel',
    actives: [{ name: 'Astaxanthin', amount: 12, unit: 'mg' }],
  });

  const context = buildIngredientScienceContext({ digest, overlayClaims: null });
  const result = await compileIngredientOverviewAsync(context, {
    llmFn: async () =>
      JSON.stringify({
        mode: 'single_anchor',
        titleLine: 'Astaxanthin',
        paragraph1: 'Astaxanthin is a carotenoid ingredient commonly used in antioxidant-focused supplement formulas.',
        paragraph2: 'On this label, it appears as the main disclosed active rather than as part of a broad blend or total line.',
        compareHint: 'When comparing products, focus on the stated amount per serving and whether the label clearly identifies the form or source.',
      }),
  });

  assert.equal(result.source, 'api');
  assert.equal(result.fallbackUsed, false);
  assert.equal(result.ingredientOverview.titleLine, 'Astaxanthin');
});

test('single-anchor ingredient overview rejects exact-dose factual echo and falls back to identity-first copy', async () => {
  const digest = buildDigest({
    labelId: 'fixture-vitamin-c-single',
    productName: 'Vitamin C 1000 mg',
    dosageForm: 'Capsule',
    actives: [{ name: 'Vitamin C (as Ascorbic Acid)', amount: 1000, unit: 'mg' }],
  });

  const context = buildIngredientScienceContext({ digest, overlayClaims: null });
  const result = await compileIngredientOverviewAsync(context, {
    llmFn: async () =>
      JSON.stringify({
        mode: 'single_anchor',
        titleLine: 'Vitamin C Supplement',
        paragraph1: 'This product centers on vitamin C, specifically as ascorbic acid. The label shows a single active ingredient with its full amount disclosed.',
        paragraph2: 'The formula is structured as one primary ingredient line listing 1000 mg of vitamin C as ascorbic acid. No blends or additional active ingredients are present.',
        compareHint: 'When comparing vitamin C products, check whether the form (like ascorbic acid) and the exact milligram amount match your needs.',
      }),
  });

  assert.equal(result.source, 'fallback');
  assert.equal(result.fallbackUsed, true);
  assert.equal(result.ingredientOverview.titleLine, 'Vitamin C');
  assert.doesNotMatch(result.ingredientOverview.paragraph1, /1000 mg/i);
  assert.doesNotMatch(result.ingredientOverview.paragraph2 ?? '', /1000 mg/i);
});
