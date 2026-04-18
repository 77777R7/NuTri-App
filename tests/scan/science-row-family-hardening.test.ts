import assert from 'node:assert/strict';
import test from 'node:test';

import type { FactsDigest } from '../../backend/src/factsDigest';
import { buildIngredientScienceContext } from '../../backend/src/ingredientScienceContext';
import { compileIngredientOverviewAsync } from '../../backend/src/insights/ingredientOverviewCompiler';
import {
  buildScientificBackgroundDeterministicFallback,
  planScientificBackgroundSections,
} from '../../backend/src/insights/scientificBackgroundCompiler';

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

test('ingredient overview fallback stays aligned to the selected formula row in prenatal DHA multivitamin products', async () => {
  const digest = buildDigest({
    labelId: 'fixture-prenatal-multi-dha-overview-alignment',
    productName: 'Prenatal Multivitamin Plus DHA',
    dosageForm: 'Tablet / Softgel',
    actives: [
      { name: 'Multivitamin & Mineral Formula', amount: null, unit: null },
      { name: 'DHA', amount: null, unit: null },
      { name: 'Docosahexaenoic Acid', amount: 200, unit: 'mg' },
    ],
  });

  const context = buildIngredientScienceContext({
    digest,
    overlayClaims: {
      title: '21st Century, Prenatal Multivitamin Plus DHA, 2 Bottles, 60 Tablets / 60 Softgels',
      brandName: '21st Century',
      nutritionalFacts: null,
    },
  });
  const result = await compileIngredientOverviewAsync(context, {
    timeoutMs: 50,
    maxRetries: 0,
  });

  assert.equal(context.anchorIngredient?.name, 'Multivitamin & Mineral Formula');
  assert.equal(result.source, 'fallback');
  assert.match(result.ingredientOverview.titleLine ?? '', /multivitamin/i);
  assert.doesNotMatch(result.ingredientOverview.titleLine ?? '', /omega-3/i);
  assert.match(result.ingredientOverview.paragraph1, /multivitamin|formula/i);
});

test('ingredient overview fallback stays aligned to krill oil instead of drifting to astaxanthin', async () => {
  const digest = buildDigest({
    labelId: 'fixture-krill-oil-overview-alignment',
    productName: 'Antarctic Krill Oil, Omega-3 Phospholipids Complex with EPA, DHA, and Astaxanthin',
    dosageForm: 'Softgel',
    actives: [
      { name: 'Krill Oil', amount: 500, unit: 'mg' },
    ],
  });

  const context = buildIngredientScienceContext({
    digest,
    overlayClaims: {
      title: 'California Gold Nutrition, Antarctic Krill Oil, Omega-3 Phospholipids Complex with EPA, DHA, and Astaxanthin, Natural Strawberry and Lemon, 500 mg, 30 Fish Gelatin Softgels',
      brandName: 'California Gold Nutrition',
      nutritionalFacts: null,
    },
  });
  const result = await compileIngredientOverviewAsync(context, {
    timeoutMs: 50,
    maxRetries: 0,
  });

  assert.equal(context.anchorIngredient?.name, 'Krill Oil');
  assert.equal(result.source, 'fallback');
  assert.match(result.ingredientOverview.titleLine ?? '', /krill oil/i);
  assert.doesNotMatch(result.ingredientOverview.titleLine ?? '', /astaxanthin/i);
  assert.match(result.ingredientOverview.paragraph1, /krill|omega-3/i);
});

test('science context orders lead active rows ahead of companion nutrients for 5-HTP formulas', () => {
  const digest = buildDigest({
    labelId: 'fixture-5htp-with-b6-companions',
    productName: 'Double Strength 5-HTP 200 mg',
    dosageForm: 'Capsule',
    actives: [
      { name: 'Niacin (as Niacinamide) (Vitamin B-3)', amount: 20, unit: 'mg' },
      { name: 'Vitamin B-6 (from Pyridoxine HCl)', amount: 2, unit: 'mg' },
      { name: '5-HTP (5-hydroxytryptophan) (From Griffonia simplicifolia Extract) (Seed)', amount: 200, unit: 'mg' },
      { name: 'Glycine', amount: 100, unit: 'mg' },
      { name: 'Taurine (Free-Form)', amount: 100, unit: 'mg' },
      { name: 'Inositol', amount: 100, unit: 'mg' },
    ],
  });

  const context = buildIngredientScienceContext({ digest, overlayClaims: null });

  assert.equal(context.anchorIngredient?.name, '5-HTP (5-hydroxytryptophan) (From Griffonia simplicifolia Extract) (Seed)');
  assert.equal(context.ingredientRows[0]?.name, '5-HTP (5-hydroxytryptophan) (From Griffonia simplicifolia Extract) (Seed)');
  assert.equal(context.ingredientDescriptors[0]?.lineRole, 'primary_active');
  assert.equal(context.ingredientDescriptors[0]?.ingredientFamily, '5htp');
  assert.equal(context.ingredientDescriptors[1]?.ingredientFamily, 'glycine');
  assert.notEqual(context.ingredientRows[1]?.name, 'Vitamin B-6 (from Pyridoxine HCl)');
});

test('science context keeps 5-HTP ahead of melatonin in mixed sleep formulas', () => {
  const digest = buildDigest({
    labelId: 'fixture-melatonin-5htp',
    productName: 'Melatonin + 5-HTP, Time Release',
    dosageForm: 'Tablet',
    actives: [
      { name: 'Melatonin', amount: 6, unit: 'mg' },
      { name: '5-HTP (5-hydroxytryptophan)', amount: 100, unit: 'mg' },
    ],
  });

  const context = buildIngredientScienceContext({ digest, overlayClaims: null });

  assert.match(context.ingredientRows[0]?.name ?? '', /\b5-?HTP\b/i);
  assert.equal(context.anchorIngredient?.ingredientFamily, '5htp');
  assert.notEqual(context.ingredientRows[0]?.name, 'Melatonin');
});

test('science context keeps 5-HTP ahead of melatonin for fresh validation title-order edge cases', () => {
  const natrolContext = buildIngredientScienceContext({
    digest: buildDigest({
      labelId: 'fixture-natrol-melatonin-5htp-time-release',
      productName: 'Melatonin + 5-HTP, Time Release',
      dosageForm: 'Tablet',
      actives: [
        { name: 'Melatonin', amount: 6, unit: 'mg' },
        { name: '5-HTP (5-Hydroxytryptophan) (from Griffonia simplicifolia) (seed)', amount: 50, unit: 'mg' },
        { name: 'Calcium (as Dibasic Calcium Phosphate)', amount: 97, unit: 'mg' },
        { name: 'Vitamin B-6 (as Pyridoxine Hydrochloride)', amount: 10, unit: 'mg' },
      ],
    }),
    overlayClaims: {
      title: 'Natrol, Melatonin + 5-HTP, Time Release, 60 Bi-Layer Tablets',
      brandName: 'Natrol',
      nutritionalFacts: null,
    },
  });
  const swansonContext = buildIngredientScienceContext({
    digest: buildDigest({
      labelId: 'fixture-swanson-5htp-melatonin',
      productName: '5-HTP & Melatonin',
      dosageForm: 'Capsule',
      actives: [
        { name: 'Melatonin', amount: 3, unit: 'mg' },
        { name: 'L-5-Hydroxytryptophan', amount: 50, unit: 'mg' },
      ],
    }),
    overlayClaims: {
      title: 'Swanson, 5-HTP & Melatonin, 30 Capsules',
      brandName: 'Swanson',
      nutritionalFacts: null,
    },
  });

  assert.match(natrolContext.ingredientRows[0]?.name ?? '', /\b5-?HTP\b|\bHydroxytryptophan\b/i);
  assert.equal(natrolContext.anchorIngredient?.ingredientFamily, '5htp');
  assert.notEqual(natrolContext.ingredientRows[0]?.name, 'Melatonin');
  assert.match(swansonContext.ingredientRows[0]?.name ?? '', /\b5-?HTP\b|\bHydroxytryptophan\b/i);
  assert.equal(swansonContext.anchorIngredient?.ingredientFamily, '5htp');
  assert.notEqual(swansonContext.ingredientRows[0]?.name, 'Melatonin');
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

test('science context normalizes branded probiotic rows so they remain searchable and user-readable', () => {
  const protectisContext = buildIngredientScienceContext({
    digest: buildDigest({
      labelId: 'fixture-protectis-vitamin-d',
      productName: 'Protectis Baby Probiotic Drops with Vitamin D',
      dosageForm: 'Drops',
      actives: [
        { name: 'Vitamin D', amount: 10, unit: 'mcg' },
        { name: 'Protectis', amount: null, unit: null },
      ],
    }),
    overlayClaims: null,
  });
  const floraphageContext = buildIngredientScienceContext({
    digest: buildDigest({
      labelId: 'fixture-floraphage',
      productName: 'Floraphage Probiotic Multiplier',
      dosageForm: 'Capsule',
      actives: [
        { name: 'FloraphagePrebiotic Bacteriophage', amount: 1000000, unit: "PFU's" },
      ],
    }),
    overlayClaims: null,
  });

  assert.match(protectisContext.ingredientRows[0]?.name ?? '', /probiotic/i);
  assert.equal(protectisContext.anchorIngredient?.ingredientFamily, 'probiotic_or_blend');
  assert.notEqual(protectisContext.ingredientRows[0]?.name, 'Vitamin D');
  assert.match(floraphageContext.ingredientRows[0]?.name ?? '', /floraphage probiotic/i);
  assert.equal(floraphageContext.anchorIngredient?.ingredientFamily, 'probiotic_or_blend');
});

test('science context keeps title-led probiotic formula anchors ahead of yeast companion rows', () => {
  const context = buildIngredientScienceContext({
    digest: buildDigest({
      labelId: 'fixture-polyflora-o-probiotic-formula',
      productName: "D'adamo, Polyflora® + O, Multi-Function Probiotic Formula, 120 VeggieCaps",
      dosageForm: 'Capsule',
      actives: [
        { name: 'Probiotic Blend(Contains Streptococcus thermophilus and Lactobacillus rhamnosus)', amount: 3, unit: 'Billion CFU' },
        { name: 'Larch Arabinogalactan', amount: 100, unit: 'mg' },
        { name: 'Banana Fruit Powder(Musa paradisiaca)', amount: 100, unit: 'mg' },
        { name: 'Chicory 4:1 Root Extract(Cichorium intybus)', amount: 100, unit: 'mg' },
        { name: "Brewer's Yeast (Saccharomyces boulardii)", amount: 100, unit: 'mg' },
        { name: 'Akkermansia muciniphila Postbiotic', amount: 5, unit: 'Billion TFU' },
      ],
    }),
    overlayClaims: null,
  });

  assert.match(context.ingredientRows[0]?.name ?? '', /probiotic/i);
  assert.doesNotMatch(context.ingredientRows[0]?.name ?? '', /brewer'?s yeast/i);
  assert.equal(context.anchorIngredient?.ingredientFamily, 'probiotic_or_blend');
});

test('science context does not treat Flora brand omega oils as probiotic products', () => {
  const context = buildIngredientScienceContext({
    digest: buildDigest({
      labelId: 'fixture-flora-udos-oil-omega-369',
      productName: "Organic Udo's Oil 3-6-9 Blend",
      dosageForm: 'Liquid',
      actives: [
        { name: 'Saturated Fat', amount: 2, unit: 'g' },
        { name: 'Polyunsaturated Fat', amount: 9, unit: 'g' },
        { name: 'Omega-3 ALA', amount: 6, unit: 'g' },
        { name: 'Omega-6 LA', amount: 3, unit: 'g' },
        { name: 'Omega-9 OA', amount: 3, unit: 'g' },
      ],
    }),
    overlayClaims: {
      title: "Flora, Organic Udo's Oil™ 3-6-9 Blend, 17 fl oz (500 ml)",
      brandName: 'Flora',
      nutritionalFacts: null,
    },
  });

  assert.doesNotMatch(context.ingredientRows[0]?.name ?? '', /^probiotics?$/i);
  assert.notEqual(context.anchorIngredient?.ingredientFamily, 'probiotic_or_blend');
  assert.match(context.anchorIngredient?.name ?? '', /omega-3|ALA|DHA/i);
  assert.equal(context.anchorIngredient?.ingredientFamily, 'omega_3');
});

test('science context treats salmon oil rows as omega source oil anchors', () => {
  const context = buildIngredientScienceContext({
    digest: buildDigest({
      labelId: 'fixture-amazing-salmon-oil',
      productName: 'Amazing Nutrition, Wild Alaskan Salmon Oil, 180 Softgels (1,000 Per Softgel)',
      dosageForm: 'Softgel',
      actives: [
        { name: 'Calories From Fat', amount: 20, unit: null },
        { name: 'Polyunsaturated Fat', amount: 1, unit: 'g' },
        { name: 'Salmon Oil', amount: 2000, unit: 'mg' },
        { name: 'DHA (Docosahexaenoic Acid)', amount: 220, unit: 'mg' },
      ],
    }),
    overlayClaims: null,
  });

  assert.equal(context.anchorIngredient?.name, 'Salmon Oil');
  assert.equal(context.anchorIngredient?.ingredientFamily, 'omega_3');
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

test('science context keeps zinc as the anchor in vitamin C/D/elderberry zinc formulas', () => {
  const digest = buildDigest({
    labelId: 'fixture-vitamin-c-d-zinc',
    productName: 'Vitamin C, D3 & Zinc',
    dosageForm: 'Vegetable Capsule',
    actives: [
      { name: 'Vitamin C (as L-ascorbic acid)', amount: 250, unit: 'mg' },
      { name: 'Vitamin D3', amount: 25, unit: 'mcg' },
      { name: 'Zinc', amount: 15, unit: 'mg' },
    ],
  });

  const context = buildIngredientScienceContext({ digest, overlayClaims: null });

  assert.match(context.ingredientRows[0]?.name ?? '', /\bzinc\b/i);
  assert.equal(context.anchorIngredient?.ingredientFamily, 'zinc');
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

test('science context does not let magnesium steal immune liquid formulas from zinc and vitamin C', () => {
  const digest = buildDigest({
    labelId: 'fixture-trace-liquid-immunity',
    productName: 'Trace, Liquid Immunity+, Mixed Berry, 30 fl oz (887 ml)',
    dosageForm: 'Liquid',
    actives: [
      { name: 'Total CarbohydrateR', amount: 10, unit: 'g' },
      { name: 'Vitamin C (as Ascorbic Acid)', amount: 1000, unit: 'mg' },
      { name: 'Vitamin D3 (as Cholecalciferol)', amount: 30, unit: 'mcg' },
      { name: 'Vitamin E (as D-Alpha Tocopherol Acetate)', amount: 30, unit: 'mg' },
      { name: 'Magnesium (from CTM)', amount: 10, unit: 'mg' },
      { name: 'Zinc (as Zinc Gluconate)', amount: 15, unit: 'mg' },
      { name: 'Black Elderberry', amount: 200, unit: 'mg' },
    ],
  });

  const context = buildIngredientScienceContext({ digest, overlayClaims: null });

  assert.doesNotMatch(context.ingredientRows[0]?.name ?? '', /magnesium|carbohydrate/i);
  assert.match(context.ingredientRows[0]?.name ?? '', /zinc|vitamin c|elderberry/i);
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

test('science context keeps CLA ahead of carnitine rows in CLA-led combo products', () => {
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

  assert.match(context.ingredientRows[0]?.name ?? '', /\bcla\b/i);
  assert.doesNotMatch(context.ingredientRows[0]?.name ?? '', /matrix/i);
  assert.equal(context.anchorIngredient?.ingredientFamily, 'cla');
});

test('science context keeps reds-pack blend rows ahead of generic vitamin anchors in superfood packet formulas', () => {
  const digest = buildDigest({
    labelId: 'fixture-trace-reds-pak',
    productName: 'Reds Pak, Mixed Berry',
    dosageForm: 'Packet',
    actives: [
      { name: 'Vitamin C', amount: 45, unit: 'mg' },
      { name: 'Vitamin A', amount: 250, unit: 'iu' },
      { name: 'Potassium', amount: 30, unit: 'mg' },
      { name: 'Calcium', amount: 10, unit: 'mg' },
      { name: 'Enzymes & Probiotics Blend', amount: 1642.5, unit: 'mg' },
      { name: 'Proprietary Liver Support Blend', amount: 1300, unit: 'mg' },
      { name: 'Proprietary Antioxidant Berry Blend', amount: 1085.5, unit: 'mg' },
      { name: 'Proprietary Fruit & Vegetable Blend', amount: 1072.5, unit: 'mg' },
    ],
  });

  const context = buildIngredientScienceContext({
    digest,
    overlayClaims: {
      title: 'Trace, Reds Pak, Mixed Berry, 30 Packets, 0.23 oz (6.5 g) Each',
      brandName: 'Trace',
      nutritionalFacts: null,
    },
  });

  assert.match(context.ingredientRows[0]?.name ?? '', /\bblend\b/i);
  assert.doesNotMatch(context.ingredientRows[0]?.name ?? '', /\bvitamin c\b|\bpotassium\b|\bcalcium\b/i);
});

test('science context prioritizes magnesium in calcium-magnesium buffered vitamin C stacks', () => {
  const digest = buildDigest({
    labelId: 'fixture-buffered-vitamin-c-calcium-magnesium',
    productName: 'Buffered Vitamin C with Calcium and Magnesium',
    dosageForm: 'Vegetarian Capsule',
    actives: [
      { name: 'Vitamin C (as Ascorbic Acid)', amount: 1000, unit: 'mg' },
      { name: 'Calcium (as Calcium Ascorbate)', amount: 120, unit: 'mg' },
      { name: 'Magnesium (as Magnesium Ascorbate)', amount: 60, unit: 'mg' },
    ],
  });

  const context = buildIngredientScienceContext({ digest, overlayClaims: null });

  assert.match(context.ingredientRows[0]?.name ?? '', /\bcalcium\b.*\bmagnesium\b|\bmagnesium\b.*\bcalcium\b/i);
  assert.equal(context.anchorIngredient?.ingredientFamily, 'magnesium');
  assert.notEqual(context.ingredientRows[0]?.name, 'Vitamin C (as Ascorbic Acid)');
});

test('science context strips package-form adjectives from single mineral chewables', () => {
  const calciumContext = buildIngredientScienceContext({
    digest: buildDigest({
      labelId: 'fixture-chewable-calcium',
      productName: 'Chewable Calcium Citrate',
      dosageForm: 'Chewable Tablet',
      actives: [
        { name: 'Chewable Calcium Citrate', amount: 250, unit: 'mg' },
      ],
    }),
    overlayClaims: null,
  });
  const ironContext = buildIngredientScienceContext({
    digest: buildDigest({
      labelId: 'fixture-chewable-iron',
      productName: 'Chewable Iron',
      dosageForm: 'Chewable Tablet',
      actives: [
        { name: 'Chewable Iron', amount: 30, unit: 'mg' },
      ],
    }),
    overlayClaims: null,
  });

  assert.equal(calciumContext.ingredientRows[0]?.name, 'Calcium Citrate');
  assert.equal(ironContext.ingredientRows[0]?.name, 'Iron');
});

test('science context normalizes omega-3 and matcha rows to retain aligned ingredient names', () => {
  const omegaContext = buildIngredientScienceContext({
    digest: buildDigest({
      labelId: 'fixture-vegan-omega3',
      productName: 'Vegan Omega-3 Power',
      dosageForm: 'Softgel',
      actives: [
        {
          name: 'PureAlgaeOmega3 Triglyceride Algal Oil (with maximum naturally occurring SPMs, including Resolvins & Protectins)',
          amount: 2000,
          unit: 'mg',
        },
      ],
    }),
    overlayClaims: null,
  });
  const greenTeaContext = buildIngredientScienceContext({
    digest: buildDigest({
      labelId: 'fixture-matcha-green-tea',
      productName: 'Organic Matcha Green Tea Powder',
      dosageForm: 'Powder',
      actives: [
        { name: 'Organic Matcha Tea (Camellia sinensis) Powder (leaf)', amount: 2, unit: 'g' },
      ],
    }),
    overlayClaims: null,
  });

  assert.match(omegaContext.ingredientRows[0]?.name ?? '', /omega-3/i);
  assert.equal(omegaContext.anchorIngredient?.ingredientFamily, 'omega_3');
  assert.match(greenTeaContext.ingredientRows[0]?.name ?? '', /green tea/i);
  assert.equal(greenTeaContext.anchorIngredient?.ingredientFamily, 'green_tea_extract');
});

test('science context rescues common title-led actives from macro residue rows', () => {
  const aloeContext = buildIngredientScienceContext({
    digest: buildDigest({
      labelId: 'fixture-aloe-vera',
      productName: 'Aloe Vera Concentrate',
      dosageForm: 'Liquid',
      actives: [
        { name: 'Sugars', amount: 1, unit: 'g' },
      ],
    }),
    overlayClaims: null,
  });
  const aloeTitleWithSizeContext = buildIngredientScienceContext({
    digest: buildDigest({
      labelId: 'fixture-now-aloe-vera-with-size',
      productName: 'NOW Foods, Aloe Vera Concentrate, 4 fl oz (118 ml)',
      brandName: 'NOW Foods',
      dosageForm: 'Liquid',
      actives: [
        { name: 'Sugars', amount: 1, unit: 'g' },
      ],
    }),
    overlayClaims: {
      title: 'NOW Foods, Aloe Vera Concentrate, 4 fl oz (118 ml)',
      brandName: 'NOW Foods',
      nutritionalFacts: null,
    },
  });
  const fiberContext = buildIngredientScienceContext({
    digest: buildDigest({
      labelId: 'fixture-apple-fiber',
      productName: 'Apple Fiber Pure Powder',
      dosageForm: 'Powder',
      actives: [
        { name: 'Potassium', amount: 54, unit: 'mg' },
      ],
    }),
    overlayClaims: null,
  });
  const potassiumContext = buildIngredientScienceContext({
    digest: buildDigest({
      labelId: 'fixture-potassium-gluconate',
      productName: 'Potassium Gluconate 90 mg',
      dosageForm: 'Tablet',
      actives: [
        { name: 'Potassium', amount: 90, unit: 'mg' },
      ],
    }),
    overlayClaims: null,
  });
  const proteinContext = buildIngredientScienceContext({
    digest: buildDigest({
      labelId: 'fixture-whey-protein',
      productName: '100% Whey Protein Powder',
      dosageForm: 'Powder',
      actives: [
        { name: 'Potassium', amount: 120, unit: 'mg' },
      ],
    }),
    overlayClaims: null,
  });

  assert.match(aloeContext.ingredientRows[0]?.name ?? '', /aloe vera/i);
  assert.notEqual(aloeContext.ingredientRows[0]?.name, 'Sugars');
  assert.match(aloeTitleWithSizeContext.ingredientRows[0]?.name ?? '', /aloe vera/i);
  assert.notEqual(aloeTitleWithSizeContext.ingredientRows[0]?.name, 'Sugars');
  assert.match(fiberContext.ingredientRows[0]?.name ?? '', /apple fiber/i);
  assert.notEqual(fiberContext.ingredientRows[0]?.name, 'Potassium');
  assert.match(potassiumContext.ingredientRows[0]?.name ?? '', /potassium gluconate/i);
  assert.match(proteinContext.ingredientRows[0]?.name ?? '', /whey protein/i);
});

test('science context uses iHerb overlay title as ranking context when official product name is sparse', () => {
  const digest = buildDigest({
    labelId: 'fixture-osfortis-short-official-name',
    productName: 'Osfortis',
    dosageForm: 'Capsule',
    actives: [
      { name: 'Vitamin D', amount: 10, unit: 'mcg' },
      { name: 'Osfortis', amount: null, unit: null },
    ],
  });

  const context = buildIngredientScienceContext({
    digest,
    overlayClaims: {
      title: 'BioGaia, Osfortis with Vitamin D, 60 Probiotic Capsules',
      brandName: 'BioGaia',
      nutritionalFacts: null,
    },
  });

  assert.match(context.ingredientRows[0]?.name ?? '', /probiotic/i);
  assert.equal(context.anchorIngredient?.ingredientFamily, 'probiotic_or_blend');
  assert.notEqual(context.ingredientRows[0]?.name, 'Vitamin D');
});

test('science context prefers aggregate multivitamin formula rows over trace inositol rows', () => {
  const bluebonnetContext = buildIngredientScienceContext({
    digest: buildDigest({
      labelId: 'fixture-multione-iron-free',
      productName: 'MultiONE®, Single Daily Multiple, Iron-Free',
      dosageForm: 'Vegetable Capsule',
      actives: [
        { name: 'Inositol', amount: 25, unit: 'mg' },
        { name: 'Magnesium (as magnesium aspartate)', amount: 10, unit: 'mg' },
        { name: 'Thiamin (as thiamin mononitrate)', amount: 25, unit: 'mg' },
        { name: 'Biotin', amount: 300, unit: 'mcg' },
      ],
    }),
    overlayClaims: {
      title: 'Bluebonnet Nutrition, MultiONE®, Single Daily Multiple, Iron-Free, 120 Vegetable Capsules',
      brandName: 'Bluebonnet Nutrition',
      nutritionalFacts: null,
    },
  });
  const countryLifeContext = buildIngredientScienceContext({
    digest: buildDigest({
      labelId: 'fixture-daily-total-one-iron-free',
      productName: 'Daily Total One®, Iron Free',
      dosageForm: 'Vegan Capsule',
      actives: [
        { name: 'Inositol (as inositol, inositol hexanicotinate)', amount: 20, unit: 'mg' },
        { name: 'Magnesium (as magnesium citrate)†', amount: 8, unit: 'mg' },
        { name: 'Biotin (as d-Biotin)', amount: 100, unit: 'mcg' },
        { name: 'Choline (from choline bitartrate)', amount: 12, unit: 'mg' },
      ],
    }),
    overlayClaims: {
      title: 'Country Life, Daily Total One®, Iron Free, 60 Vegan Capsules',
      brandName: 'Country Life',
      nutritionalFacts: null,
    },
  });

  assert.equal(bluebonnetContext.ingredientRows[0]?.name, 'Multivitamin & Mineral Formula');
  assert.notEqual(bluebonnetContext.ingredientRows[0]?.name, 'Inositol');
  assert.equal(countryLifeContext.ingredientRows[0]?.name, 'Multivitamin & Mineral Formula');
  assert.notEqual(countryLifeContext.ingredientRows[0]?.name, 'Inositol (as inositol, inositol hexanicotinate)');
});

test('science context treats daily multi formula titles as multivitamin family anchors', () => {
  const context = buildIngredientScienceContext({
    digest: buildDigest({
      labelId: 'fixture-womens-daily-multi-formula',
      productName: "Women's Daily Multi Formula",
      dosageForm: 'Caplet',
      actives: [
        { name: 'Vitamin A (as acetate)', amount: 750, unit: 'mcg RAE' },
        { name: 'Vitamin C (ascorbic acid)', amount: 60, unit: 'mg' },
        { name: 'Calcium (calcium carbonate)', amount: 500, unit: 'mg' },
        { name: 'Magnesium (magnesium oxide)', amount: 50, unit: 'mg' },
        { name: 'Zinc (zinc oxide)', amount: 15, unit: 'mg' },
      ],
    }),
    overlayClaims: {
      title: "Mason Natural, Women's Daily Multi Formula, 90 Caplets",
      brandName: 'Mason Natural',
      nutritionalFacts: null,
    },
  });

  assert.equal(context.ingredientRows[0]?.name, 'Multivitamin & Mineral Formula');
  assert.notEqual(context.ingredientRows[0]?.name, 'Magnesium (magnesium oxide)');
});

test('science context treats male multiple titles as multivitamin family anchors', () => {
  const context = buildIngredientScienceContext({
    digest: buildDigest({
      labelId: 'fixture-solgar-male-multiple',
      productName: 'Solgar, Male Multiple, 120 Tablets',
      dosageForm: 'Tablet',
      actives: [
        { name: 'Vitamin C (as L-ascorbic acid, niacinamide ascorbate)', amount: 400, unit: 'mg' },
        { name: 'Vitamin D (as ergocalciferol)', amount: 10, unit: 'mcg' },
        { name: 'Inositol', amount: 25, unit: 'mg' },
      ],
    }),
    overlayClaims: null,
  });

  assert.equal(context.ingredientRows[0]?.name, 'Multivitamin & Mineral Formula');
  assert.notEqual(context.ingredientRows[0]?.name, 'Inositol');
});

test('science context treats just-one multi with iron titles as multivitamin family anchors', () => {
  const context = buildIngredientScienceContext({
    digest: buildDigest({
      labelId: 'fixture-just-one-multi-with-iron',
      productName: 'Just One Multi with Iron',
      dosageForm: 'Tablet',
      actives: [
        { name: 'Vitamin C (as ascorbic acid)', amount: 1500, unit: 'mcg' },
        { name: 'Thiamin (as thiamin mononitrate)', amount: 25, unit: 'mcg' },
        { name: 'Iron', amount: 18, unit: 'mg' },
      ],
    }),
    overlayClaims: {
      title: 'Swanson, Just One Multi with Iron, 130 Tablets',
      brandName: 'Swanson',
      nutritionalFacts: null,
    },
  });

  assert.equal(context.ingredientRows[0]?.name, 'Multivitamin & Mineral Formula');
  assert.notEqual(context.ingredientRows[0]?.name, 'Iron');
});

test('science context treats minimal and essential broad nutrient formulas as multivitamin family anchors', () => {
  const context = buildIngredientScienceContext({
    digest: buildDigest({
      labelId: 'fixture-vital-nutrients-minimal-essential',
      productName: 'Minimal and Essential',
      dosageForm: 'Vegan Capsule',
      actives: [
        { name: 'Vitamin A (as 67% beta carotene and 33% acetate)', amount: 1500, unit: 'mcg' },
        { name: 'Vitamin C (as ascorbic acid)', amount: 500, unit: 'mg' },
        { name: 'Vitamin D3 (as cholecalciferol)', amount: 50, unit: 'mcg' },
        { name: 'Vitamin E (as d-alpha tocopheryl succinate)', amount: 67, unit: 'mg' },
        { name: 'Zinc (as zinc citrate)', amount: 10, unit: 'mg' },
        { name: 'Selenium (as selenomethionine)', amount: 100, unit: 'mcg' },
      ],
    }),
    overlayClaims: {
      title: 'Vital Nutrients, Minimal and Essential, 90 Vegan Capsules',
      brandName: 'Vital Nutrients',
      nutritionalFacts: null,
    },
  });

  assert.equal(context.ingredientRows[0]?.name, 'Multivitamin & Mineral Formula');
  assert.notEqual(context.ingredientRows[0]?.name, 'Zinc (as zinc citrate)');
});

test("science context treats ladies choice whole-food multiple titles as multivitamin family anchors", () => {
  const context = buildIngredientScienceContext({
    digest: buildDigest({
      labelId: "fixture-ladies-choice-multiple",
      productName: "Bluebonnet Nutrition, Ladies' Choice, Whole Food Based Multiple, Ladies 18-49, 90 Caplets",
      dosageForm: "Caplet",
      actives: [
        { name: "Vitamin A", amount: 750, unit: "mcg RAE" },
        { name: "Vitamin C", amount: 120, unit: "mg" },
        { name: "Zinc", amount: 15, unit: "mg" },
        { name: "Inositol", amount: 50, unit: "mg" },
      ],
    }),
    overlayClaims: null,
  });

  assert.equal(context.ingredientRows[0]?.name, "Multivitamin & Mineral Formula");
  assert.notEqual(context.ingredientRows[0]?.name, "Inositol");
});

test("science context treats multi for men energy titles as multivitamin family anchors", () => {
  const context = buildIngredientScienceContext({
    digest: buildDigest({
      labelId: "fixture-hi-energy-multi-for-men",
      productName: "Futurebiotics, Hi Energy Multi For Men, 60 Tablets",
      dosageForm: "Tablet",
      actives: [
        { name: "Vitamin A (as beta-carotene)", amount: 750, unit: "mcg" },
        { name: "Vitamin C", amount: 120, unit: "mg" },
        { name: "Magnesium (as magnesium oxide and lysyl glycinate chelate)", amount: 50, unit: "mg" },
      ],
    }),
    overlayClaims: null,
  });

  assert.equal(context.ingredientRows[0]?.name, "Multivitamin & Mineral Formula");
  assert.notEqual(context.ingredientRows[0]?.name, "Magnesium (as magnesium oxide and lysyl glycinate chelate)");
});

test("science context treats men's multi titles as multivitamin family anchors", () => {
  const context = buildIngredientScienceContext({
    digest: buildDigest({
      labelId: "fixture-now-adam-superior-mens-multi",
      productName: "NOW Foods, ADAM, Superior Men's Multi, 60 Tablets",
      dosageForm: "Tablet",
      actives: [
        { name: "Vitamin A (100% as Beta-Carotene)", amount: 2250, unit: "mcg" },
        { name: "Vitamin C (from Calcium Ascorbate)", amount: 250, unit: "mg" },
        { name: "Magnesium (from Magnesium Citrate)", amount: 25, unit: "mg" },
        { name: "Inositol", amount: 12.5, unit: "mg" },
      ],
    }),
    overlayClaims: null,
  });

  assert.equal(context.ingredientRows[0]?.name, "Multivitamin & Mineral Formula");
  assert.notEqual(context.ingredientRows[0]?.name, "Inositol");
});

test('science context treats No. 7 joint support titles as joint complex anchors', () => {
  const context = buildIngredientScienceContext({
    digest: buildDigest({
      labelId: 'fixture-solgar-no7-joint-support',
      productName: 'Solgar, No. 7, Advanced Joint Support Complex, 30 Vegetable Capsules',
      dosageForm: 'Vegetable Capsule',
      actives: [
        { name: 'Vitamin C', amount: 100, unit: 'mg' },
        { name: 'Turmeric Root', amount: 50, unit: 'mg' },
        { name: 'Total Collagen', amount: 40, unit: 'mg' },
        { name: '5-Loxin Advanced Boswellia serrata Extract', amount: 100, unit: 'mg' },
      ],
    }),
    overlayClaims: null,
  });

  assert.match(context.ingredientRows[0]?.name ?? '', /joint support|collagen/i);
  assert.notEqual(context.ingredientRows[0]?.name, 'Vitamin C');
});

test('science context rescues ParaFight titles ahead of opaque blend rows', () => {
  const context = buildIngredientScienceContext({
    digest: buildDigest({
      labelId: 'fixture-parafight-opaque-blend',
      productName: 'Eclectic Herb, Parafight, Intestinal Support, 2 fl oz (60 ml)',
      dosageForm: 'Liquid',
      actives: [
        { name: 'Proprietary Blend', amount: null, unit: null },
        { name: 'Contains tree nuts (black walnut)', amount: null, unit: null },
      ],
    }),
    overlayClaims: null,
  });

  assert.equal(context.ingredientRows[0]?.name, 'ParaFight Herbal Blend');
  assert.notEqual(context.ingredientRows[0]?.name, 'Proprietary Blend');
  assert.notEqual(context.ingredientRows[0]?.name, 'Contains tree nuts (black walnut)');
});

test('science context rescues EGCG as the default anchor from branded cytokine blend rows', () => {
  const digest = buildDigest({
    labelId: 'fixture-cytokine-suppress-egcg',
    productName: 'Cytokine Suppress with EGCG',
    dosageForm: 'Vegetarian Capsule',
    actives: [
      { name: 'Cytokine Suppress', amount: 240, unit: 'mg' },
    ],
  });

  const context = buildIngredientScienceContext({ digest, overlayClaims: null });

  assert.match(context.ingredientRows[0]?.name ?? '', /\begcg|green tea/i);
  assert.equal(context.anchorIngredient?.ingredientFamily, 'green_tea_extract');
  assert.notEqual(context.ingredientRows[0]?.name, 'Cytokine Suppress');
});

test('science context rescues probiotic anchors ahead of opaque proprietary blends', () => {
  const digest = buildDigest({
    labelId: 'fixture-essential-biotic-proprietary-blend',
    productName: 'Essential-Biotic Complete, 50 Billion CFU',
    dosageForm: 'Delayed-Release Vegetarian Capsule',
    actives: [
      { name: 'Proprietary Blend', amount: 150.88, unit: 'mg' },
    ],
  });

  const context = buildIngredientScienceContext({ digest, overlayClaims: null });

  assert.match(context.ingredientRows[0]?.name ?? '', /probiotic/i);
  assert.equal(context.anchorIngredient?.ingredientFamily, 'probiotic_or_blend');
  assert.notEqual(context.ingredientRows[0]?.name, 'Proprietary Blend');
});

test('science context does not synthesize probiotic anchors for broad microbiome wording alone', () => {
  const context = buildIngredientScienceContext({
    digest: buildDigest({
      labelId: 'fixture-dentalcidin-oral-microbiome-rinse',
      productName: 'Biocidin Botanicals, Dentalcidin LS Oral Microbiome Liposomal Rinse Natural Mint',
      dosageForm: 'Liquid',
      actives: [
        { name: 'Biocidin', amount: null, unit: 'np' },
        { name: 'Myrrh', amount: null, unit: 'np' },
        { name: 'Clove bud Oil', amount: null, unit: 'np' },
        { name: 'Quercetin', amount: null, unit: 'np' },
      ],
    }),
    overlayClaims: null,
  });

  assert.match(context.ingredientRows[0]?.name ?? '', /biocidin/i);
  assert.doesNotMatch(context.ingredientRows[0]?.name ?? '', /^probiotics?$/i);
  assert.notEqual(context.anchorIngredient?.ingredientFamily, 'probiotic_or_blend');
});

test('science context rescues title-led botanicals ahead of proprietary blend and alcohol rows', () => {
  const echinaceaContext = buildIngredientScienceContext({
    digest: buildDigest({
      labelId: 'fixture-echinacea-goldenseal-proprietary-blend',
      productName: 'Eclectic Herb, Herb, Echinacea Goldenseal, 1 fl oz (30 ml)',
      dosageForm: 'Liquid',
      actives: [
        { name: 'Proprietary Blend', amount: 1, unit: 'ml' },
      ],
    }),
    overlayClaims: null,
  });
  const lemonBalmContext = buildIngredientScienceContext({
    digest: buildDigest({
      labelId: 'fixture-lemon-balm-alcohol',
      productName: 'Eclectic Herb, Lemon Balm Extract, 2 fl oz (60 ml)',
      dosageForm: 'Liquid',
      actives: [
        { name: 'Alcohol', amount: 45, unit: '%' },
      ],
    }),
    overlayClaims: null,
  });

  assert.match(echinaceaContext.ingredientRows[0]?.name ?? '', /echinacea|goldenseal/i);
  assert.doesNotMatch(echinaceaContext.ingredientRows[0]?.name ?? '', /proprietary blend/i);
  assert.match(lemonBalmContext.ingredientRows[0]?.name ?? '', /lemon balm/i);
  assert.notEqual(lemonBalmContext.ingredientRows[0]?.name, 'Alcohol');
});

test('science context does not let alcohol solvent rows outrank title-led lemon balm extract rows', () => {
  const context = buildIngredientScienceContext({
    digest: buildDigest({
      labelId: 'fixture-lemon-balm-solvent-rows',
      productName: 'Eclectic Herb, Lemon Balm Extract, 2 fl oz (60 ml)',
      dosageForm: 'Liquid',
      actives: [
        { name: 'Alcohol', amount: null, unit: null },
        { name: 'Lemon Balm, Dried', amount: null, unit: null },
        { name: 'filtered Water', amount: null, unit: null },
      ],
    }),
    overlayClaims: null,
  });

  assert.match(context.ingredientRows[0]?.name ?? '', /lemon balm/i);
  assert.notEqual(context.ingredientRows[0]?.name, 'Alcohol');
  assert.notEqual(context.ingredientRows[0]?.name, 'filtered Water');
});

test('science context rescues title-led probiotic strains ahead of proprietary synergistic blend rows', () => {
  const context = buildIngredientScienceContext({
    digest: buildDigest({
      labelId: 'fixture-acidophilus-bifidus-proprietary-synergistic-blend',
      productName: 'Natural Factors, Acidophilus & Bifidus, 90 Capsules',
      dosageForm: 'Capsule',
      actives: [
        { name: 'Proprietary Synergistic Blend', amount: 3, unit: 'Billion CFU' },
        { name: 'Vitamin D3', amount: 5, unit: 'mcg' },
      ],
    }),
    overlayClaims: null,
  });

  assert.match(context.ingredientRows[0]?.name ?? '', /acidophilus|bifidus|probiotic/i);
  assert.doesNotMatch(context.ingredientRows[0]?.name ?? '', /proprietary synergistic blend/i);
  assert.equal(context.anchorIngredient?.ingredientFamily, 'probiotic_or_blend');
});

test('science context uses food-like label anchors instead of macro rows for greens powders and snacks', () => {
  const greensDigest = buildDigest({
    labelId: 'fixture-organic-supergreens-with-macros',
    productName: 'Organic Supergreens Powder',
    dosageForm: 'Powder',
    actives: [
      { name: 'Protein', amount: 1, unit: 'g' },
      { name: 'Dietary Fiber', amount: 2, unit: 'g' },
      { name: 'Potassium', amount: 94, unit: 'mg' },
    ],
  });
  const snackDigest = buildDigest({
    labelId: 'fixture-snackable-crackers-with-potassium',
    productName: 'Snackable Crackers, Maple Cinnamon Currant',
    dosageForm: 'Cracker',
    actives: [
      { name: 'Potassium', amount: 80, unit: 'mg' },
      { name: 'Protein', amount: 2, unit: 'g' },
    ],
  });

  const greensContext = buildIngredientScienceContext({ digest: greensDigest, overlayClaims: null });
  const snackContext = buildIngredientScienceContext({ digest: snackDigest, overlayClaims: null });

  assert.equal(greensContext.productArchetype, 'functional_food_like');
  assert.match(greensContext.ingredientRows[0]?.name ?? '', /greens/i);
  assert.doesNotMatch(greensContext.ingredientRows[0]?.name ?? '', /protein|fiber|potassium/i);
  assert.equal(snackContext.productArchetype, 'functional_food_like');
  assert.match(snackContext.ingredientRows[0]?.name ?? '', /food-based product/i);
  assert.doesNotMatch(snackContext.ingredientRows[0]?.name ?? '', /protein|potassium/i);
});

test('science context creates label-context rows for title-only Greens First and Project 1 powders', () => {
  const greensFirstContext = buildIngredientScienceContext({
    digest: buildDigest({
      labelId: 'fixture-greens-first-title-only',
      productName: 'Greens First, Greens Powder, Berry',
      dosageForm: 'Powder',
      actives: [],
    }),
    overlayClaims: null,
  });
  const projectOneContext = buildIngredientScienceContext({
    digest: buildDigest({
      labelId: 'fixture-project-one-greens-title-only',
      productName: 'Project 1 Nutrition, Greens, Superfood Greens Powder, Chocolate',
      dosageForm: 'Powder',
      actives: [],
    }),
    overlayClaims: null,
  });

  assert.equal(greensFirstContext.productArchetype, 'functional_food_like');
  assert.match(greensFirstContext.ingredientRows[0]?.name ?? '', /greens/i);
  assert.equal(projectOneContext.productArchetype, 'functional_food_like');
  assert.match(projectOneContext.ingredientRows[0]?.name ?? '', /greens/i);
});

test('brand-led food-like greens powders still create science rows for decision-support', () => {
  const digest = buildDigest({
    labelId: 'fixture-athletic-greens-brand-only',
    productName: 'Foundational Nutrition, 30 Servings',
    dosageForm: 'Powder',
    actives: [],
  });
  const context = buildIngredientScienceContext({
    digest: {
      ...digest,
      product: {
        ...digest.product,
        brandDisplay: 'Athletic Greens',
      },
    },
    overlayClaims: null,
  });
  const plan = planScientificBackgroundSections({
    context,
    selectedIngredientName: context.anchorIngredient?.name ?? 'Greens',
  });

  assert.equal(context.productArchetype, 'functional_food_like');
  assert.match(context.ingredientRows[0]?.name ?? '', /greens/i);
  assert.equal(plan.mode, 'label_context_mode');
});

test('default science ingredient ordering follows title-led actives over companions and package anchors', () => {
  const htpContext = buildIngredientScienceContext({
    digest: buildDigest({
      labelId: 'fixture-5htp-melatonin-title-order',
      productName: '5-HTP 200 mg with Melatonin',
      dosageForm: 'Capsule',
      actives: [
        { name: 'Melatonin', amount: 3, unit: 'mg' },
        { name: 'Vitamin B-6 (from Pyridoxine HCl)', amount: 2, unit: 'mg' },
        { name: '5-HTP (5-hydroxytryptophan)', amount: 200, unit: 'mg' },
      ],
    }),
    overlayClaims: null,
  });
  const probioticZincContext = buildIngredientScienceContext({
    digest: buildDigest({
      labelId: 'fixture-zinc-probiotic-title-order',
      productName: 'Zinc + Probiotic Immune Gummies',
      dosageForm: 'Gummy',
      actives: [
        { name: 'Total Carbohydrate', amount: 3, unit: 'g' },
        { name: 'Probiotic Blend', amount: 1, unit: 'Billion CFU' },
        { name: 'Zinc', amount: 5, unit: 'mg' },
      ],
    }),
    overlayClaims: null,
  });
  const packageAnchorContext = buildIngredientScienceContext({
    digest: buildDigest({
      labelId: 'fixture-package-anchor-noise',
      productName: 'Magnesium Complex, 120 Capsules',
      dosageForm: 'Capsule',
      actives: [
        { name: '120 Capsules', amount: null, unit: null },
        { name: 'Calories', amount: 10, unit: null },
        { name: 'Magnesium (as Magnesium Glycinate)', amount: 200, unit: 'mg' },
      ],
    }),
    overlayClaims: null,
  });

  assert.match(htpContext.ingredientRows[0]?.name ?? '', /5-HTP/i);
  assert.notEqual(htpContext.ingredientRows[0]?.name, 'Melatonin');
  assert.match(probioticZincContext.ingredientRows[0]?.name ?? '', /\bzinc\b/i);
  assert.doesNotMatch(probioticZincContext.ingredientRows[0]?.name ?? '', /carbohydrate/i);
  assert.match(packageAnchorContext.ingredientRows[0]?.name ?? '', /\bmagnesium\b/i);
  assert.doesNotMatch(packageAnchorContext.ingredientRows[0]?.name ?? '', /capsules|calories/i);
});

test('science context keeps title-led algae and enzyme products ahead of micronutrient rows', () => {
  const enzymeContext = buildIngredientScienceContext({
    digest: buildDigest({
      labelId: 'fixture-healthforce-digestive-enzymes',
      productName: 'HealthForce Superfoods, Digestion Enhancement Enzymes™, 120 VeganCaps',
      dosageForm: 'VeganCaps',
      actives: [
        { name: 'Proteases∞', amount: 15100, unit: 'HUT' },
        { name: 'Amylase', amount: 4000, unit: 'DU' },
      ],
    }),
    overlayClaims: null,
  });
  const spirulinaContext = buildIngredientScienceContext({
    digest: buildDigest({
      labelId: 'fixture-healthforce-spirulina-manna',
      productName: 'HealthForce Superfoods, Spirulina Manna, 16 oz (454 g)',
      dosageForm: 'Powder',
      actives: [
        { name: 'Vitamin A (Beta-carotene)', amount: 2500, unit: 'IU' },
        { name: 'Iron', amount: 2, unit: 'mg' },
      ],
    }),
    overlayClaims: null,
  });
  const chlorellaContext = buildIngredientScienceContext({
    digest: buildDigest({
      labelId: 'fixture-healthforce-chlorella-manna',
      productName: 'HealthForce Superfoods, Chlorella Manna™, 12.34 oz (350 g)',
      dosageForm: 'Powder',
      actives: [
        { name: 'Vitamin D (as D2)', amount: 10, unit: 'mcg' },
        { name: 'Iron', amount: 1, unit: 'mg' },
      ],
    }),
    overlayClaims: null,
  });

  assert.match(enzymeContext.ingredientRows[0]?.name ?? '', /digestive enzyme|enzyme blend/i);
  assert.doesNotMatch(enzymeContext.ingredientRows[0]?.name ?? '', /^proteases/i);
  assert.match(spirulinaContext.ingredientRows[0]?.name ?? '', /spirulina/i);
  assert.doesNotMatch(spirulinaContext.ingredientRows[0]?.name ?? '', /vitamin a|iron/i);
  assert.match(chlorellaContext.ingredientRows[0]?.name ?? '', /chlorella/i);
  assert.doesNotMatch(chlorellaContext.ingredientRows[0]?.name ?? '', /vitamin d|iron/i);
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

test('single-anchor ingredient overview strips exact-dose factual echo before returning copy', async () => {
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

  assert.equal(result.source, 'api');
  assert.equal(result.fallbackUsed, false);
  assert.equal(result.ingredientOverview.titleLine, 'Vitamin C Supplement');
  assert.doesNotMatch(result.ingredientOverview.paragraph1, /1000 mg/i);
  assert.doesNotMatch(result.ingredientOverview.paragraph2 ?? '', /1000 mg/i);
  assert.match(result.ingredientOverview.compareHint ?? '', /form/i);
});

test('single-anchor ingredient overview keeps liposomal vitamin C form context in fallback copy', async () => {
  const digest = buildDigest({
    labelId: 'fixture-liposomal-vitamin-c-single',
    productName: 'BodyBio, Liposomal Vitamin C, 60 Capsules (500 mg per Capsule)',
    dosageForm: 'Capsule',
    actives: [{ name: 'Vitamin C (as Quali-C Ascorbic Acid)', amount: 1000, unit: 'mg' }],
  });

  const context = buildIngredientScienceContext({ digest, overlayClaims: null });
  const result = await compileIngredientOverviewAsync(context);
  const overviewCopy = [
    result.ingredientOverview.titleLine,
    result.ingredientOverview.paragraph1,
    result.ingredientOverview.paragraph2,
    result.ingredientOverview.compareHint,
  ].join(' ');

  assert.equal(result.source, 'fallback');
  assert.match(result.ingredientOverview.titleLine ?? '', /liposomal vitamin c/i);
  assert.match(overviewCopy, /liposomal vitamin c/i);
});

test('blend-anchor ingredient overview fallback names probiotic and tea blend anchors', async () => {
  const probioticContext = buildIngredientScienceContext({
    digest: buildDigest({
      labelId: 'fixture-probiotic-blend-overview-fallback',
      productName: '21st Century, Acidophilus Probiotic Blend, 100 Capsules',
      dosageForm: 'Capsule',
      actives: [
        { name: 'Proprietary Blend', amount: 175, unit: 'mg' },
      ],
    }),
    overlayClaims: null,
  });
  const teaContext = buildIngredientScienceContext({
    digest: buildDigest({
      labelId: 'fixture-tea-blend-overview-fallback',
      productName: 'Swanson, 100% Organic Chamomile Tea, Caffeine Free, 20 Tea Bags',
      dosageForm: 'Tea Bag',
      actives: [
        { name: 'Tea blend', amount: null, unit: null },
      ],
    }),
    overlayClaims: null,
  });
  const genericBlendContext = buildIngredientScienceContext({
    digest: buildDigest({
      labelId: 'fixture-generic-blend-overview-fallback',
      productName: 'Eclectic Herb, Beet Juice Powder, 3.2 oz (90 g)',
      dosageForm: 'Powder',
      actives: [
        { name: 'Blend', amount: 3, unit: 'g' },
      ],
    }),
    overlayClaims: null,
  });
  const proprietaryBlendContext = buildIngredientScienceContext({
    digest: buildDigest({
      labelId: 'fixture-proprietary-blend-overview-fallback',
      productName: '21st Century, Colon Cleanse, 120 Vegetarian Capsules',
      dosageForm: 'Capsule',
      actives: [
        { name: 'Proprietary Blend', amount: 2000, unit: 'mg' },
      ],
    }),
    overlayClaims: null,
  });

  const probioticResult = await compileIngredientOverviewAsync(probioticContext);
  const teaResult = await compileIngredientOverviewAsync(teaContext);
  const genericBlendResult = await compileIngredientOverviewAsync(genericBlendContext);
  const proprietaryBlendResult = await compileIngredientOverviewAsync(proprietaryBlendContext);

  assert.equal(probioticResult.source, 'fallback');
  assert.match(probioticResult.ingredientOverview.titleLine ?? '', /probiotic/i);
  assert.doesNotMatch(probioticResult.ingredientOverview.titleLine ?? '', /^Blend-style formula$/i);
  assert.doesNotMatch(probioticResult.ingredientOverview.paragraph1, /blend-style formula/i);
  assert.match(probioticResult.ingredientOverview.paragraph1, /probiotic/i);

  assert.equal(teaResult.source, 'fallback');
  assert.equal(teaResult.ingredientOverview.titleLine, 'Tea blend');
  assert.doesNotMatch(teaResult.ingredientOverview.paragraph1, /blend-style formula/i);
  assert.match(teaResult.ingredientOverview.paragraph1, /tea blend/i);

  assert.equal(genericBlendResult.source, 'fallback');
  assert.notEqual(genericBlendResult.ingredientOverview.titleLine, 'Blend-style formula');
  assert.doesNotMatch(genericBlendResult.ingredientOverview.paragraph1, /blend-style formula/i);

  assert.equal(proprietaryBlendResult.source, 'fallback');
  assert.equal(proprietaryBlendResult.ingredientOverview.titleLine, 'Proprietary Blend');
  assert.doesNotMatch(proprietaryBlendResult.ingredientOverview.paragraph1, /blend-style formula/i);
});

test('aloe title rescue does not steal the default anchor from sea moss vitamin C formulas', () => {
  const context = buildIngredientScienceContext({
    digest: buildDigest({
      labelId: 'fixture-sea-moss-vitamin-c-aloe-companion',
      productName: 'Codeage, Amen, Sea Moss + Vitamin C, Aloe Vera & Black Pepper, 90 Vegetable Capsules',
      dosageForm: 'Capsule',
      actives: [
        { name: 'Organic Sea Moss', amount: null, unit: null },
        { name: 'Vitamin C (as Ascorbic Acid)', amount: 90, unit: 'mg' },
        { name: 'Aloe Vera Extract (Whole Plant)', amount: null, unit: null },
        { name: 'Black Pepper Extract', amount: null, unit: null },
      ],
    }),
    overlayClaims: null,
  });

  assert.match(context.ingredientRows[0]?.name ?? '', /vitamin c/i);
  assert.doesNotMatch(context.ingredientRows[0]?.name ?? '', /^aloe vera$/i);
});

test('omega-3 fallback copy distinguishes algal oil sources from fish oil sources', async () => {
  const context = buildIngredientScienceContext({
    digest: buildDigest({
      labelId: 'fixture-algal-oil-source-copy',
      productName: "Nature's Way, Algal Oil, Omega-3, Cranberry Orange",
      dosageForm: 'Liquid',
      actives: [
        { name: 'Algal oil (Schizochytrium spp.)', amount: 2, unit: 'g' },
        { name: 'Total Omega-3', amount: 715, unit: 'mg' },
        { name: 'DHA', amount: 500, unit: 'mg' },
      ],
    }),
    overlayClaims: null,
  });

  const overview = await compileIngredientOverviewAsync(context);
  const background = buildScientificBackgroundDeterministicFallback({
    context,
    selectedIngredientName: context.anchorIngredient?.name ?? 'Algal oil',
  });
  const overviewCopy = [
    overview.ingredientOverview.titleLine,
    overview.ingredientOverview.paragraph1,
    overview.ingredientOverview.paragraph2,
    overview.ingredientOverview.compareHint,
  ].join(' ');
  const backgroundCopy = [
    background.introLine,
    ...background.sections.map((section) => section.summary),
  ].join(' ');

  assert.match(overview.ingredientOverview.titleLine ?? '', /algal oil/i);
  assert.doesNotMatch(overviewCopy, /fish[-\s]?oil/i);
  assert.match(background.introLine, /algal oil/i);
  assert.doesNotMatch(backgroundCopy, /fish[-\s]?oil/i);
});

test('omega-3 fallback copy distinguishes flax seed oil sources from fish oil sources', async () => {
  const context = buildIngredientScienceContext({
    digest: buildDigest({
      labelId: 'fixture-flax-seed-oil-source-copy',
      productName: 'NOW Foods, Certified Organic Flax Seed Oil, 12 fl oz (355 ml)',
      dosageForm: 'Liquid',
      actives: [
        { name: 'Linolenic Acid (Omega-3)', amount: 7.7, unit: 'g' },
        { name: 'Linolenic Acid (Omega-6)', amount: 2, unit: 'g' },
        { name: 'Oleic Acid (Omega-9)', amount: 2.7, unit: 'g' },
      ],
    }),
    overlayClaims: null,
  });

  const overview = await compileIngredientOverviewAsync(context);
  const overviewCopy = [
    overview.ingredientOverview.titleLine,
    overview.ingredientOverview.paragraph1,
    overview.ingredientOverview.paragraph2,
    overview.ingredientOverview.compareHint,
  ].join(' ');

  assert.match(overviewCopy, /flax seed oil|plant oil/i);
  assert.doesNotMatch(overviewCopy, /fish[-\s]?oil/i);
});

test('science context rescues sparse title-led food-like anchors from residue rows', () => {
  const coconutAminosContext = buildIngredientScienceContext({
    digest: buildDigest({
      labelId: 'fixture-coconut-aminos-title-rescue',
      productName: 'BetterBody Foods, Organic Coconut Aminos, Soy Sauce Replacement',
      dosageForm: 'Liquid',
      actives: [
        { name: 'Niacin', amount: 1.5, unit: 'mg' },
      ],
    }),
    overlayClaims: null,
  });
  const goGelContext = buildIngredientScienceContext({
    digest: buildDigest({
      labelId: 'fixture-go-gel-title-rescue',
      productName: 'BPN, Go Gel, Endurance Gel, Apple Cinnamon',
      dosageForm: 'Gel',
      actives: [
        { name: 'Potassium', amount: 144, unit: 'mg' },
        { name: 'Calcium', amount: 13, unit: 'mg' },
        { name: 'Fiber', amount: 0, unit: 'g' },
      ],
    }),
    overlayClaims: null,
  });
  const hydrationContext = buildIngredientScienceContext({
    digest: buildDigest({
      labelId: 'fixture-hydrationup-title-rescue',
      productName: 'California Gold Nutrition, HydrationUP, Electrolyte Drink Mix with Calcium, Potassium, Vitamin C, and Vitamin E',
      dosageForm: 'Powder',
      actives: [
        { name: 'Vitamin C', amount: 220, unit: 'mg' },
        { name: 'Calcium', amount: 100, unit: 'mg' },
        { name: 'Vitamin E', amount: 19, unit: 'mg' },
        { name: 'Magnesium', amount: 40, unit: 'mg' },
        { name: 'Potassium', amount: 180, unit: 'mg' },
      ],
    }),
    overlayClaims: null,
  });
  const proteinBarContext = buildIngredientScienceContext({
    digest: buildDigest({
      labelId: 'fixture-protein-bar-title-rescue',
      productName: 'Simply Protein, Crispy Snack Bars, Dark Chocolate Almond',
      dosageForm: 'Bar',
      actives: [
        { name: 'Potas', amount: 35, unit: 'mg' },
        { name: 'Glycerin', amount: 4, unit: 'g' },
        { name: 'Protein', amount: 12, unit: 'g' },
        { name: 'Total Sugars', amount: 1, unit: 'g' },
      ],
    }),
    overlayClaims: null,
  });
  const energyDrinkMixContext = buildIngredientScienceContext({
    digest: buildDigest({
      labelId: 'fixture-energy-drink-mix-title-rescue',
      productName: 'Alani Nu, Energy Drink Mix, Cherry Slush, 10 Sticks',
      dosageForm: 'Powder',
      actives: [
        { name: 'Biotin', amount: 300, unit: 'mcg' },
        { name: 'Niacin', amount: 18, unit: 'mg' },
        { name: 'Vitamin B12', amount: 2.4, unit: 'mcg' },
      ],
    }),
    overlayClaims: null,
  });
  const seaMossGelContext = buildIngredientScienceContext({
    digest: buildDigest({
      labelId: 'fixture-sea-moss-gel-title-rescue',
      productName: 'Akasha Superfoods, Liposomal Sea Moss Gel, Sweet Citrus',
      dosageForm: 'Gel',
      actives: [
        { name: 'Monounsaturated Fat', amount: 0.5, unit: 'g' },
        { name: 'Vitamin C', amount: 30, unit: 'mg' },
        { name: 'Sodium', amount: 15, unit: 'mg' },
      ],
    }),
    overlayClaims: null,
  });

  assert.match(coconutAminosContext.ingredientRows[0]?.name ?? '', /\bcoconut aminos\b|\bsoy sauce replacement\b/i);
  assert.equal(coconutAminosContext.productArchetype, 'functional_food_like');

  assert.match(goGelContext.ingredientRows[0]?.name ?? '', /\bendurance gel\b|\bgo gel\b|\benergy gel\b/i);
  assert.equal(goGelContext.productArchetype, 'functional_food_like');

  assert.match(hydrationContext.ingredientRows[0]?.name ?? '', /\belectrolyte drink mix\b|\bhydrationup\b|\belectrolyte\b/i);

  assert.match(proteinBarContext.ingredientRows[0]?.name ?? '', /\bprotein bars?\b|\bsnack bars?\b/i);
  assert.doesNotMatch(proteinBarContext.ingredientRows[0]?.name ?? '', /\bglycerin\b|\bpotas\b/i);
  assert.equal(proteinBarContext.productArchetype, 'functional_food_like');

  assert.match(energyDrinkMixContext.ingredientRows[0]?.name ?? '', /\benergy drink mix\b|\benergy mix\b/i);
  assert.doesNotMatch(energyDrinkMixContext.ingredientRows[0]?.name ?? '', /\bbiotin\b/i);
  assert.equal(energyDrinkMixContext.productArchetype, 'functional_food_like');

  assert.match(seaMossGelContext.ingredientRows[0]?.name ?? '', /\bsea moss gel\b|\bsea moss\b/i);
  assert.doesNotMatch(seaMossGelContext.ingredientRows[0]?.name ?? '', /\bmonounsaturated fat\b/i);
  assert.equal(seaMossGelContext.productArchetype, 'functional_food_like');
});

test('flower essence titles are not treated as food-like green products', () => {
  const context = buildIngredientScienceContext({
    digest: buildDigest({
      labelId: 'fixture-flower-essence-grounding-green',
      productName: 'Flower Essence Services, Flower Essence & Essential Oil, Grounding Green, 1 fl oz (30 ml)',
      dosageForm: 'Liquid',
      actives: [
        { name: 'Flower Essence & Essential Oil', amount: null, unit: null },
        { name: 'infusions of flowers of', amount: null, unit: null },
        { name: 'Essential Oils', amount: null, unit: null },
      ],
    }),
    overlayClaims: null,
  });

  assert.notEqual(context.productArchetype, 'functional_food_like');
  assert.doesNotMatch(context.ingredientRows[0]?.name ?? '', /food-based product/i);
  assert.match(context.ingredientRows[0]?.name ?? '', /flower essence/i);
});

test('oral probiotic lozenges keep probiotic anchors instead of food-like anchors', () => {
  const context = buildIngredientScienceContext({
    digest: buildDigest({
      labelId: 'fixture-now-oralbiotic-lozenge',
      productName: 'NOW Foods, OralBiotic®, 60 Lozenges',
      dosageForm: 'Lozenge',
      actives: [
        { name: 'BLIS K12 Streptococcus salivarius K12', amount: 1, unit: 'billion CFU' },
      ],
    }),
    overlayClaims: null,
  });

  assert.notEqual(context.productArchetype, 'functional_food_like');
  assert.doesNotMatch(context.ingredientRows[0]?.name ?? '', /food-based product/i);
  assert.match(context.ingredientRows[0]?.name ?? '', /oralbiotic|probiotic|streptococcus/i);
});

test('omega-3 source rescue keeps algal titles out of fish-oil fallback copy even when the facts row is generic', async () => {
  const context = buildIngredientScienceContext({
    digest: buildDigest({
      labelId: 'fixture-algal-oil-generic-row',
      productName: "Barlean's, Plant Based Omega-3 From Algae Oil, Ginger Peach",
      dosageForm: 'Liquid',
      actives: [
        { name: 'Omega-3 Polyunsaturated Fat', amount: null, unit: null },
        { name: 'Sugar Alcohol', amount: 5, unit: 'g' },
      ],
    }),
    overlayClaims: null,
  });

  const overview = await compileIngredientOverviewAsync(context);
  const background = buildScientificBackgroundDeterministicFallback({
    context,
    selectedIngredientName: context.anchorIngredient?.name ?? 'Omega-3',
  });
  const overviewCopy = [
    overview.ingredientOverview.titleLine,
    overview.ingredientOverview.paragraph1,
    overview.ingredientOverview.paragraph2,
    overview.ingredientOverview.compareHint,
  ].join(' ');
  const backgroundCopy = [
    background.introLine,
    ...background.sections.map((section) => section.summary),
  ].join(' ');

  assert.match(context.ingredientRows[0]?.name ?? '', /\balgal oil\b|\bplant based omega-3\b|\bomega-3\b/i);
  assert.match(context.anchorIngredient?.name ?? '', /\balgal oil\b|\bplant based omega-3\b|\bomega-3\b/i);
  assert.doesNotMatch(context.anchorIngredient?.name ?? '', /polyunsaturated\s+fat/i);
  assert.match(overviewCopy, /\balgal oil\b|\balgae\b/i);
  assert.doesNotMatch(overviewCopy, /fish[-\s]?oil/i);
  assert.doesNotMatch(backgroundCopy, /fish[-\s]?oil/i);
});

test('omega-3 fallback copy respects title-led algal dha products without an explicit algal oil row', async () => {
  const context = buildIngredientScienceContext({
    digest: buildDigest({
      labelId: 'fixture-algal-900-dha-title-copy',
      productName: 'Spring Valley, Algal-900 DHA',
      dosageForm: 'Softgel',
      actives: [
        { name: 'Docosahexaenoic Acid', amount: 450, unit: 'mg' },
        { name: 'Total Omega-3 Fatty Acids', amount: 900, unit: 'mg' },
      ],
    }),
    overlayClaims: null,
  });

  const overview = await compileIngredientOverviewAsync(context);
  const overviewCopy = [
    overview.ingredientOverview.titleLine,
    overview.ingredientOverview.paragraph1,
    overview.ingredientOverview.paragraph2,
    overview.ingredientOverview.compareHint,
  ].join(' ');

  assert.match(overviewCopy, /\balgal\b|\balgae\b/i);
  assert.doesNotMatch(overviewCopy, /fish[-\s]?oil/i);
});
