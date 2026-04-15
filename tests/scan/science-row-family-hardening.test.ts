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

test('science context keeps probiotic rows ahead of macro nutrition facts in probiotic products', () => {
  const digest = buildDigest({
    labelId: 'fixture-probiotic-drops-with-macros',
    productName: 'Culturelle, Baby Probiotics, Digestive Calm + Comfort Probiotic Drops',
    dosageForm: 'Drops',
    actives: [
      { name: 'Calories', amount: 5, unit: null },
      { name: 'Total Carbohydrate', amount: 1, unit: 'g' },
      { name: 'Bifidobacterium animalis subsp. lactis, BB-12', amount: 10, unit: 'mg' },
    ],
  });

  const context = buildIngredientScienceContext({ digest, overlayClaims: null });

  assert.match(context.ingredientRows[0]?.name ?? '', /bifidobacterium|probiotic/i);
  assert.equal(context.anchorIngredient?.ingredientFamily, 'probiotic_or_blend');
  assert.doesNotMatch(context.ingredientRows[0]?.name ?? '', /calories|carbohydrate/i);
});

test('science context rescues zinc as the lead row in children immune blend products', () => {
  const digest = buildDigest({
    labelId: 'fixture-children-immune-vitamin-c-zinc',
    productName: 'Chewable Immune Blend with Vitamin A, Vitamin C, Vitamin E, and Zinc for Children',
    dosageForm: 'Chewable Tablet',
    actives: [
      { name: 'Vitamin C', amount: 90, unit: 'mg' },
      { name: 'Vitamin E', amount: 13.5, unit: 'mg' },
      { name: 'Zinc', amount: 5, unit: 'mg' },
    ],
  });

  const context = buildIngredientScienceContext({ digest, overlayClaims: null });

  assert.match(context.ingredientRows[0]?.name ?? '', /\bzinc\b/i);
  assert.equal(context.anchorIngredient?.ingredientFamily, 'zinc');
});

test('science context keeps zinc ahead of low-dose magnesium in immune defense formulas', () => {
  const digest = buildDigest({
    labelId: 'fixture-immune-defense-magnesium-zinc',
    productName: 'Immune Defense with Vitamin C, Elderberry & Zinc',
    dosageForm: 'Powder',
    actives: [
      { name: 'Magnesium (as magnesium citrate)', amount: 21, unit: 'mg' },
      { name: 'Zinc (as zinc citrate)', amount: 20, unit: 'mg' },
      { name: 'Vitamin C (as ascorbic acid)', amount: 1000, unit: 'mg' },
      { name: 'Immunity Superfoods:Prebiotics and Probiotic Blend', amount: 2600, unit: 'mg' },
    ],
  });

  const context = buildIngredientScienceContext({ digest, overlayClaims: null });

  assert.match(context.ingredientRows[0]?.name ?? '', /\bzinc\b/i);
  assert.equal(context.anchorIngredient?.ingredientFamily, 'zinc');
});

test('science context lets zinc-led mineral stack titles outrank higher-dose magnesium rows', () => {
  const digest = buildDigest({
    labelId: 'fixture-zinc-magnesium-title-order',
    productName: 'Zinc Magnesium Aspartate',
    dosageForm: 'Tablet',
    actives: [
      { name: 'Magnesium', amount: 450, unit: 'mg' },
      { name: 'Zinc', amount: 30, unit: 'mg' },
    ],
  });

  const context = buildIngredientScienceContext({ digest, overlayClaims: null });

  assert.match(context.ingredientRows[0]?.name ?? '', /\bzinc\b/i);
  assert.equal(context.anchorIngredient?.ingredientFamily, 'zinc');
});

test('science context keeps calcium-magnesium-zinc stacks on zinc while preserving magnesium-led products', () => {
  const mineralStackDigest = buildDigest({
    labelId: 'fixture-calcium-magnesium-zinc-d3',
    productName: 'Calcium Magnesium Zinc + D3',
    dosageForm: 'Tablet',
    actives: [
      { name: 'Calcium (as Calcium Carbonate)', amount: 1000, unit: 'mg' },
      { name: 'Magnesium (as Magnesium Oxide)', amount: 400, unit: 'mg' },
      { name: 'Zinc (as Zinc Oxide)', amount: 15, unit: 'mg' },
      { name: 'Vitamin D3 (as Cholecalciferol)', amount: 10, unit: 'mcg' },
    ],
  });
  const vitaminStackDigest = buildDigest({
    labelId: 'fixture-vitamin-c-d3-zinc',
    productName: 'Vitamin C, D3 & Zinc',
    dosageForm: 'Capsule',
    actives: [
      { name: 'Vitamin C (as L-ascorbic acid)', amount: 250, unit: 'mg' },
      { name: 'Zinc (as bisglycinate chelate)', amount: 50, unit: 'mg' },
      { name: 'Vitamin D3 (as cholecalciferol from lanolin)', amount: 50, unit: 'mcg' },
    ],
  });
  const magnesiumLeadDigest = buildDigest({
    labelId: 'fixture-magnesium-glycinate-with-zinc',
    productName: 'Magnesium Glycinate with Zinc Picolinate',
    dosageForm: 'Capsule',
    actives: [
      { name: 'Magnesium (as Magnesium Glycinate)', amount: 200, unit: 'mg' },
      { name: 'Zinc (as Zinc Picolinate)', amount: 15, unit: 'mg' },
    ],
  });

  const mineralStackContext = buildIngredientScienceContext({ digest: mineralStackDigest, overlayClaims: null });
  const vitaminStackContext = buildIngredientScienceContext({ digest: vitaminStackDigest, overlayClaims: null });
  const magnesiumLeadContext = buildIngredientScienceContext({ digest: magnesiumLeadDigest, overlayClaims: null });

  assert.match(mineralStackContext.ingredientRows[0]?.name ?? '', /\bzinc\b/i);
  assert.equal(mineralStackContext.anchorIngredient?.ingredientFamily, 'zinc');
  assert.match(vitaminStackContext.ingredientRows[0]?.name ?? '', /\bzinc\b/i);
  assert.equal(vitaminStackContext.anchorIngredient?.ingredientFamily, 'zinc');
  assert.match(magnesiumLeadContext.ingredientRows[0]?.name ?? '', /\bmagnesium\b/i);
  assert.equal(magnesiumLeadContext.anchorIngredient?.ingredientFamily, 'magnesium');
});

test('science context keeps explicit magnesium ahead of branded Magtein source rows', () => {
  const digest = buildDigest({
    labelId: 'fixture-magtein-magnesium',
    productName: 'Magtein Magnesium L-Threonate',
    dosageForm: 'Capsule',
    actives: [
      { name: 'Magtein', amount: 1.3, unit: 'g' },
      { name: 'Magnesium', amount: 98, unit: 'mg' },
    ],
  });

  const context = buildIngredientScienceContext({ digest, overlayClaims: null });

  assert.equal(context.ingredientRows[0]?.name, 'Magnesium');
  assert.equal(context.anchorIngredient?.ingredientFamily, 'magnesium');
});

test('science context keeps omega-3 breakdown rows ahead of krill oil source rows', () => {
  const digest = buildDigest({
    labelId: 'fixture-krill-oil-omega3',
    productName: 'Antarctic Krill Oil Omega-3 Phospholipids Complex with EPA, DHA, and Astaxanthin',
    dosageForm: 'Softgel',
    actives: [
      { name: 'Krill Oil', amount: 500, unit: 'mg' },
      { name: 'EPA (eicosapentaenoic acid)', amount: 60, unit: 'mg' },
      { name: 'DHA (docosahexaenoic acid)', amount: 30, unit: 'mg' },
      { name: 'Omega-3 Fatty Acids', amount: 120, unit: 'mg' },
      { name: 'Astaxanthin (from krill oil)', amount: 150, unit: 'mcg' },
    ],
  });

  const context = buildIngredientScienceContext({ digest, overlayClaims: null });

  assert.match(context.ingredientRows[0]?.name ?? '', /\bomega[\s-]*3\b|\bepa\b|\bdha\b/i);
  assert.doesNotMatch(context.ingredientRows[0]?.name ?? '', /krill oil/i);
  assert.equal(context.anchorIngredient?.ingredientFamily, 'omega_3');
});

test('science context rescues elderberry rows from syrup and tea product titles', () => {
  const syrupDigest = buildDigest({
    labelId: 'fixture-elderberry-syrup-title-only',
    productName: "Children's Sambucus Elderberry Syrup",
    dosageForm: 'Syrup',
    actives: [],
  });
  const teaDigest = buildDigest({
    labelId: 'fixture-elderberry-tea-title-only',
    productName: 'Organic Herbal Tea, Elderberry, Caffeine Free, 18 Tea Bags',
    dosageForm: 'Tea Bag',
    actives: [{ name: 'Tea blend', amount: null, unit: null }],
  });

  const syrupContext = buildIngredientScienceContext({ digest: syrupDigest, overlayClaims: null });
  const teaContext = buildIngredientScienceContext({ digest: teaDigest, overlayClaims: null });

  assert.match(syrupContext.ingredientRows[0]?.name ?? '', /elderberry|sambucus/i);
  assert.doesNotMatch(syrupContext.ingredientRows[0]?.name ?? '', /syrup|children/i);
  assert.match(teaContext.ingredientRows[0]?.name ?? '', /elderberry|sambucus/i);
  assert.notEqual(teaContext.ingredientRows[0]?.name, 'Tea blend');
});

test('science context keeps zinc ahead of vitamin C in elderberry immune formulas', () => {
  const digest = buildDigest({
    labelId: 'fixture-sambucus-vitamin-c-zinc',
    productName: 'Sambucus Elderberry With Vitamin C & Zinc Gummies',
    dosageForm: 'Gummy',
    actives: [
      { name: 'Vitamin C', amount: 90, unit: 'mg' },
      { name: 'Zinc', amount: 5, unit: 'mg' },
    ],
  });

  const context = buildIngredientScienceContext({ digest, overlayClaims: null });

  assert.match(context.ingredientRows[0]?.name ?? '', /\bzinc\b/i);
  assert.notEqual(context.ingredientRows[0]?.name, 'Vitamin C');
  assert.ok(context.ingredientRows.some((row) => /elderberry|sambucus/i.test(row.name)));
});

test('science context does not let audience or sugar rows beat title-rescued actives', () => {
  const zincDigest = buildDigest({
    labelId: 'fixture-zinc-audience-row',
    productName: 'Zinc For Immune Support',
    dosageForm: 'Liquid',
    actives: [{ name: 'Men', amount: null, unit: null }],
  });
  const elderberryDigest = buildDigest({
    labelId: 'fixture-elderberry-sugar-row',
    productName: 'Kids Elderberry Super-Immune SoftChew Gummies',
    dosageForm: 'Gummy',
    actives: [{ name: 'Sugar Alcohol', amount: 2, unit: 'g' }],
  });

  const zincContext = buildIngredientScienceContext({ digest: zincDigest, overlayClaims: null });
  const elderberryContext = buildIngredientScienceContext({ digest: elderberryDigest, overlayClaims: null });

  assert.match(zincContext.ingredientRows[0]?.name ?? '', /\bzinc\b/i);
  assert.notEqual(zincContext.ingredientRows[0]?.name, 'Men');
  assert.match(elderberryContext.ingredientRows[0]?.name ?? '', /elderberry|sambucus/i);
  assert.notEqual(elderberryContext.ingredientRows[0]?.name, 'Sugar Alcohol');
});

test('science context follows title-leading CLA ahead of broad carnitine matrix rows', () => {
  const digest = buildDigest({
    labelId: 'fixture-cla-carnitine-matrix',
    productName: 'CLA + Carnitine, Fruit Punch',
    dosageForm: 'Powder',
    actives: [
      { name: 'Omega 6 Fatty Acids & CLA Matrix', amount: 3000, unit: 'mg' },
      { name: 'L-Carnitine Tartrate', amount: 1500, unit: 'mg' },
    ],
  });

  const context = buildIngredientScienceContext({ digest, overlayClaims: null });

  assert.match(context.ingredientRows[0]?.name ?? '', /\bcla\b|conjugated linoleic/i);
  assert.equal(context.anchorIngredient?.ingredientFamily, 'cla');
});

test('science context keeps carnitine ahead when carnitine is the title lead', () => {
  const digest = buildDigest({
    labelId: 'fixture-carnitine-cla-matrix',
    productName: 'L-Carnitine + CLA, Fruit Punch',
    dosageForm: 'Powder',
    actives: [
      { name: 'Omega 6 Fatty Acids & CLA Matrix', amount: 3000, unit: 'mg' },
      { name: 'L-Carnitine Tartrate', amount: 1500, unit: 'mg' },
    ],
  });

  const context = buildIngredientScienceContext({ digest, overlayClaims: null });

  assert.match(context.ingredientRows[0]?.name ?? '', /\bcarnitine\b/i);
  assert.equal(context.anchorIngredient?.ingredientFamily, 'carnitine');
});

test('science context prefers generic probiotics over Protectis brand-only rows', () => {
  const digest = buildDigest({
    labelId: 'fixture-protectis-probiotic',
    productName: 'BioGaia, Protectis Baby, Immune Active Probiotic Drops',
    dosageForm: 'Drops',
    actives: [
      { name: 'Protectis', amount: 5, unit: 'mg' },
    ],
  });

  const context = buildIngredientScienceContext({ digest, overlayClaims: null });

  assert.match(context.ingredientRows[0]?.name ?? '', /\bprobiotic/i);
  assert.doesNotMatch(context.ingredientRows[0]?.name ?? '', /^protectis$/i);
  assert.equal(context.anchorIngredient?.ingredientFamily, 'probiotic_or_blend');
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
