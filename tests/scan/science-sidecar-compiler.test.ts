import assert from 'node:assert/strict';
import test from 'node:test';

import type { FactsDigest } from '../../backend/src/factsDigest';
import { buildIngredientScienceContext } from '../../backend/src/ingredientScienceContext';
import { compileIngredientOverviewAsync } from '../../backend/src/insights/ingredientOverviewCompiler';
import {
  compileScientificBackgroundAsync,
  planScientificBackgroundSections,
  resolveScientificBackgroundExecutionProfile,
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

test('ingredient overview falls back when the model drifts into shopper-purpose copy', async () => {
  const digest = buildDigest({
    labelId: 'fixture-vitamin-c-zinc',
    productName: 'Vitamin C with Zinc and Calcium',
    dosageForm: 'Capsule',
    actives: [
      { name: 'Vitamin C', amount: 1000, unit: 'mg' },
      { name: 'Zinc', amount: 15, unit: 'mg' },
      { name: 'Calcium', amount: 100, unit: 'mg' },
    ],
  });

  const context = buildIngredientScienceContext({ digest, overlayClaims: null });
  const result = await compileIngredientOverviewAsync(context, {
    llmFn: async () =>
      JSON.stringify({
        mode: 'multi_anchor',
        titleLine: 'Vitamin C formula',
        paragraph1: 'People take this product for immune support.',
        paragraph2: 'Vitamin C and zinc work better together in this formula.',
        compareHint: 'When comparing products, look for better support claims.',
      }),
  });

  assert.equal(result.source, 'fallback');
  assert.equal(result.fallbackUsed, true);
  assert.equal(result.diagnostics.liveWriterConfigured, true);
  assert.equal(result.diagnostics.liveWriterAttempted, true);
  assert.equal(result.diagnostics.liveWriterHit, false);
  assert.equal(result.diagnostics.fallbackReason, 'quality_gate_rejected');
  assert.equal(result.ingredientOverview.mode, 'multi_anchor');
  assert.match(result.ingredientOverview.paragraph1, /vitamin c/i);
  assert.ok(result.ingredientOverview.compareHint);
});

test('ingredient overview reports llm_unconfigured when no live writer is available', async () => {
  const digest = buildDigest({
    labelId: 'fixture-magnesium',
    productName: 'Magnesium Glycinate 200 mg',
    dosageForm: 'Capsule',
    actives: [{ name: 'Magnesium (as Magnesium Glycinate)', amount: 200, unit: 'mg' }],
  });

  const context = buildIngredientScienceContext({ digest, overlayClaims: null });
  const result = await compileIngredientOverviewAsync(context);

  assert.equal(result.source, 'fallback');
  assert.equal(result.diagnostics.liveWriterConfigured, false);
  assert.equal(result.diagnostics.liveWriterAttempted, false);
  assert.equal(result.diagnostics.fallbackReason, 'llm_unconfigured');
});

test('scientific background falls back when the model writes ingredient identity instead of research context', async () => {
  const digest = buildDigest({
    labelId: 'fixture-astaxanthin',
    productName: 'Astaxanthin 12 mg',
    dosageForm: 'Softgel',
    actives: [{ name: 'Astaxanthin', amount: 12, unit: 'mg' }],
  });

  const context = buildIngredientScienceContext({ digest, overlayClaims: null });
  const result = await compileScientificBackgroundAsync(context, 'Astaxanthin', {
    llmFn: async () =>
      JSON.stringify({
        introLine: 'Astaxanthin • 12 mg',
        sections: [
          {
            headingId: 'antioxidant_activity',
            heading: 'Antioxidant activity',
            summary: 'Astaxanthin is a naturally occurring carotenoid pigment.',
            bullets: ['Antioxidant-related research', 'Cellular stress context'],
            evidenceRead: 'Evidence varies.',
            shopperMeaning: 'Use this as a broad wellness ingredient.',
          },
          {
            headingId: 'eye_and_skin_health',
            heading: 'Eye and skin health',
            summary: 'It has been studied for eye- and skin-related outcomes.',
            bullets: ['Eye-related research', 'Skin-related research'],
            evidenceRead: 'Study designs vary.',
            shopperMeaning: 'This works for broad support positioning.',
          },
          {
            headingId: 'exercise_and_recovery_research',
            heading: 'Exercise and recovery research',
            summary: 'It has also been explored in exercise-related research.',
            bullets: ['Exercise performance research', 'Recovery-related research'],
            evidenceRead: 'Results are mixed.',
            shopperMeaning: 'Treat this as a strong differentiator.',
          },
        ],
        closingNote: 'Use this as proof of broad performance benefits.',
      }),
  });

  assert.equal(result.source, 'fallback');
  assert.equal(result.fallbackUsed, true);
  assert.equal(result.diagnostics.liveWriterConfigured, true);
  assert.equal(result.diagnostics.liveWriterAttempted, true);
  assert.equal(result.diagnostics.liveWriterHit, false);
  assert.equal(result.diagnostics.fallbackReason, 'quality_gate_rejected');
  assert.equal(result.scientificBackground.selectedLabel, 'Astaxanthin');
  assert.deepEqual(
    result.scientificBackground.sections.map((section) => section.heading),
    ['Antioxidant activity', 'Eye and skin context', 'Exercise and recovery research'],
  );
});

test('scientific background planner changes headings for clear ingredients versus blend labels', () => {
  const zincContext = buildIngredientScienceContext({
    digest: buildDigest({
      labelId: 'fixture-zinc',
      productName: 'Zinc 15 mg',
      dosageForm: 'Tablet',
      actives: [{ name: 'Zinc', amount: 15, unit: 'mg' }],
    }),
    overlayClaims: null,
  });
  const blendContext = buildIngredientScienceContext({
    digest: buildDigest({
      labelId: 'fixture-probiotic-blend',
      productName: 'Probiotic Blend with TetraPhage Blend',
      dosageForm: 'Capsule',
      actives: [
        { name: 'Proprietary Probiotic Blend', amount: 500, unit: 'mg' },
        { name: 'TetraPhage Blend', amount: 50, unit: 'mg' },
      ],
    }),
    overlayClaims: null,
  });

  const zincPlan = planScientificBackgroundSections({
    context: zincContext,
    selectedIngredientName: 'Zinc',
  });
  const blendPlan = planScientificBackgroundSections({
    context: blendContext,
    selectedIngredientName: 'Proprietary Probiotic Blend',
  });

  assert.deepEqual(
    zincPlan.sections.map((section) => section.heading),
    ['Immune function context', 'Skin and barrier research'],
  );
  assert.deepEqual(
    blendPlan.sections.map((section) => section.heading),
    ['What this blend line does and does not show', 'Why deeper disclosure changes comparison'],
  );
});

test('scientific background still returns label-context fallback when descriptor rows are missing', async () => {
  const baseContext = buildIngredientScienceContext({
    digest: buildDigest({
      labelId: 'fixture-missing-descriptor',
      productName: 'Quality Sleep Spray',
      dosageForm: 'Spray',
      actives: [],
    }),
    overlayClaims: null,
  });

  const context = {
    ...baseContext,
    ingredientRows: [],
    ingredientSnapshotNames: [],
    ingredientDescriptors: [],
    anchorIngredient: null,
    coIngredients: [],
    relationshipCandidates: [],
    labelConstraints: {
      hasOpaqueBlend: false,
      ingredientDisclosureLimited: true,
    },
  };

  const result = await compileScientificBackgroundAsync(context, 'Quality Sleep Spray');

  assert.equal(result.source, 'fallback');
  assert.equal(result.scientificBackground.mode, 'label_context_mode');
  assert.equal(result.scientificBackground.selectedLabel, 'Quality Sleep Spray');
  assert.equal(result.scientificBackground.sections.length, 2);
  assert.match(result.scientificBackground.sections[0]?.summary ?? '', /quality sleep spray/i);
  assert.match(result.scientificBackground.sections[1]?.shopperMeaning ?? '', /quality sleep spray/i);
});

test('scientific background uses phage-specific label-context fallback for phage blend lines', async () => {
  const phageContext = buildIngredientScienceContext({
    digest: buildDigest({
      labelId: 'fixture-phage-blend',
      productName: 'Phage Blend Formula',
      dosageForm: 'Capsule',
      actives: [
        { name: 'TetraPhage Blend', amount: 15, unit: 'mg' },
      ],
    }),
    overlayClaims: null,
  });

  const result = await compileScientificBackgroundAsync(phageContext, 'TetraPhage Blend');

  assert.equal(result.source, 'fallback');
  assert.equal(result.scientificBackground.mode, 'label_context_mode');
  assert.match(result.scientificBackground.sections[0]?.summary ?? '', /phage/i);
  assert.match(result.scientificBackground.sections[1]?.summary ?? '', /phage/i);
  assert.doesNotMatch(result.scientificBackground.sections[0]?.summary ?? '', /strain/i);
});

test('scientific background repairs template-style research prose into family-specific copy', async () => {
  const digest = buildDigest({
    labelId: 'fixture-epa',
    productName: 'Omega-3 1040 mg Fish Oil 1250 mg',
    dosageForm: 'Softgel',
    actives: [
      { name: 'EPA (Eicosapentaenoic Acid)', amount: 690, unit: 'mg' },
      { name: 'DHA (Docosahexaenoic Acid)', amount: 260, unit: 'mg' },
    ],
  });

  const context = buildIngredientScienceContext({ digest, overlayClaims: null });
  const result = await compileScientificBackgroundAsync(context, 'EPA (Eicosapentaenoic Acid)', {
    llmFn: async () =>
      JSON.stringify({
        introLine: 'EPA • 690 mg',
        sections: [
          {
            headingId: 'lipid_and_triglyceride_research',
            heading: 'Lipid and triglyceride research',
            summary: 'EPA is frequently studied in heart-related and triglyceride-related research.',
            bullets: ['Heart-related research', 'Triglyceride-related research'],
            evidenceRead: 'Evidence varies.',
            shopperMeaning: 'Use this as a broad heart-health signal.',
          },
          {
            headingId: 'inflammation_and_recovery_context',
            heading: 'Inflammation and recovery context',
            summary: 'EPA is also studied in inflammation-related and recovery-related research.',
            bullets: ['Inflammation-related research', 'Recovery-related research'],
            evidenceRead: 'Evidence varies.',
            shopperMeaning: 'This works as a strong recovery differentiator.',
          },
          {
            headingId: 'broader_heart_claim_boundaries',
            heading: 'How this differs from broader heart claims',
            summary: 'EPA is often discussed in broader cardiovascular research.',
            bullets: ['Heart-related research', 'Cardiovascular-related research'],
            evidenceRead: 'Evidence varies.',
            shopperMeaning: 'This proves broad heart benefits.',
          },
        ],
        closingNote: 'Use this as proof of broad heart support.',
      }),
  });

  assert.equal(result.source, 'api');
  assert.equal(result.fallbackUsed, false);
  assert.equal(result.diagnostics.liveWriterHit, true);
  assert.equal(result.diagnostics.fallbackReason, null);
  assert.match(result.scientificBackground.sections[0]?.summary ?? '', /clearest evidence lane|triglyceride/i);
  assert.match(result.scientificBackground.sections[0]?.shopperMeaning ?? '', /EPA breakdown line|compare/i);
  assert.equal(
    result.scientificBackground.closingNote,
    'Read the research context as outcome-specific guidance, not as a blanket promise for every claim on the label.',
  );
});

test('scientific background reports llm_timeout when the live writer misses the budget', async () => {
  const digest = buildDigest({
    labelId: 'fixture-timeout-5htp',
    productName: '5-HTP 200 mg',
    dosageForm: 'Capsule',
    actives: [{ name: '5-HTP (5-hydroxytryptophan)', amount: 200, unit: 'mg' }],
  });

  const context = buildIngredientScienceContext({ digest, overlayClaims: null });
  const result = await compileScientificBackgroundAsync(context, '5-HTP (5-hydroxytryptophan)', {
    llmFn: async () => {
      await new Promise((resolve) => setTimeout(resolve, 15));
      return JSON.stringify({
        introLine: '5-HTP • 200 mg',
        sections: [],
      });
    },
    timeoutMs: 1,
  });

  assert.equal(result.source, 'fallback');
  assert.equal(result.diagnostics.liveWriterConfigured, true);
  assert.equal(result.diagnostics.liveWriterAttempted, true);
  assert.equal(result.diagnostics.liveWriterHit, false);
  assert.equal(result.diagnostics.fallbackReason, 'llm_timeout');
  assert.equal(result.diagnostics.timeoutCount, 1);
});

test('scientific background repairs near-miss writer output into an api result', async () => {
  const digest = buildDigest({
    labelId: 'fixture-epa-repair',
    productName: 'Omega-3 1040 mg Fish Oil 1250 mg',
    dosageForm: 'Softgel',
    actives: [
      { name: 'EPA (Eicosapentaenoic Acid)', amount: 690, unit: 'mg' },
      { name: 'DHA (Docosahexaenoic Acid)', amount: 260, unit: 'mg' },
    ],
  });

  const context = buildIngredientScienceContext({ digest, overlayClaims: null });
  const result = await compileScientificBackgroundAsync(context, 'EPA (Eicosapentaenoic Acid)', {
    llmFn: async () =>
      JSON.stringify({
        introLine: 'EPA • 690 mg',
        sections: [
          {
            headingId: 'lipid_and_triglyceride_research',
            heading: 'Lipid and triglyceride research',
            summary: 'EPA is frequently studied in heart-related and triglyceride-related research.',
            bullets: ['Heart-related research', 'Triglyceride-related research'],
            evidenceRead: 'Evidence varies.',
            shopperMeaning: 'Broad heart language is common here.',
          },
          {
            headingId: 'inflammation_and_recovery_context',
            heading: 'Inflammation and recovery context',
            summary: 'EPA has also been explored in inflammation-related and recovery-related research.',
            bullets: ['Inflammation-related research', 'Recovery-related research'],
            evidenceRead: 'Results are mixed.',
            shopperMeaning: 'Use this as supporting context.',
          },
          {
            headingId: 'broader_heart_claim_boundaries',
            heading: 'How this differs from broader heart claims',
            summary: 'EPA is often discussed in broader cardiovascular research.',
            bullets: ['Heart-related research', 'Cardiovascular-related research'],
            evidenceRead: 'Study designs vary.',
            shopperMeaning: 'Compare the EPA line, not just the broad packaging language.',
          },
        ],
        closingNote: 'Read this as outcome-specific context.',
      }),
  });

  assert.equal(result.source, 'api');
  assert.equal(result.fallbackUsed, false);
  assert.match(result.scientificBackground.sections[0]?.summary ?? '', /clearest evidence lane|triglyceride/i);
  assert.match(result.scientificBackground.sections[0]?.shopperMeaning ?? '', /EPA breakdown line|compare/i);
  assert.match(result.scientificBackground.sections[1]?.evidenceRead ?? '', /mixed|carry less weight/i);
});

test('scientific background can repair a partial writer response by filling missing planned sections from family fallback', async () => {
  const digest = buildDigest({
    labelId: 'fixture-vitamin-c-partial-repair',
    productName: 'Vitamin C 1000 mg',
    dosageForm: 'Capsule',
    actives: [{ name: 'Vitamin C', amount: 1000, unit: 'mg' }],
  });

  const context = buildIngredientScienceContext({ digest, overlayClaims: null });
  const result = await compileScientificBackgroundAsync(context, 'Vitamin C', {
    llmFn: async () =>
      JSON.stringify({
        introLine: 'Vitamin C research often centers on antioxidant and tissue-support questions.',
        sections: [
          {
            headingId: 'antioxidant_and_immune_research',
            heading: 'Antioxidant and immune research',
            summary: 'Vitamin C is often discussed in antioxidant and immune-related research.',
            bullets: ['Immune-related research', 'Antioxidant-related research'],
            evidenceRead: 'Evidence varies.',
            shopperMeaning: 'Look at the exact ingredient and broader label context.',
          },
          {
            headingId: 'collagen_and_tissue_support',
            heading: 'Collagen and tissue support',
            summary: 'Vitamin C also appears in collagen and tissue-support research.',
            bullets: ['Collagen-related research', 'Tissue-support research'],
            evidenceRead: 'Results are mixed.',
            shopperMeaning: 'This helps explain why it shows up in more than one product category.',
          },
        ],
        closingNote: 'Read this as context, not as a blanket promise.',
      }),
  });

  assert.equal(result.source, 'api');
  assert.equal(result.fallbackUsed, false);
  assert.deepEqual(
    result.scientificBackground.sections.map((section) => section.heading),
    ['Antioxidant and immune research', 'Collagen and tissue support', 'Iron absorption context'],
  );
  assert.match(result.scientificBackground.sections[2]?.summary ?? '', /iron co-administration|narrower but important vitamin c context/i);
});

test('astaxanthin fallback keeps evidence texture instead of generic research bullets', async () => {
  const digest = buildDigest({
    labelId: 'fixture-astaxanthin-fallback-quality',
    productName: 'Astaxanthin 12 mg',
    dosageForm: 'Softgel',
    actives: [{ name: 'Astaxanthin', amount: 12, unit: 'mg' }],
  });

  const context = buildIngredientScienceContext({ digest, overlayClaims: null });
  const result = await compileScientificBackgroundAsync(context, 'Astaxanthin');

  const antioxidantSection = result.scientificBackground.sections[0];
  const eyeSkinSection = result.scientificBackground.sections[1];
  const exerciseSection = result.scientificBackground.sections[2];

  assert.match(antioxidantSection?.summary ?? '', /oxidative-stress markers|antioxidant-response/i);
  assert.match(eyeSkinSection?.summary ?? '', /visual fatigue|hydration|elasticity|UV-exposure/i);
  assert.match(exerciseSection?.evidenceRead ?? '', /mixed|variable/i);
});

test('scientific background accepts astaxanthin live-style output when shopper meaning is specific enough', async () => {
  const digest = buildDigest({
    labelId: 'fixture-astaxanthin-live-style',
    productName: 'Astaxanthin 12 mg',
    dosageForm: 'Softgel',
    actives: [{ name: 'Astaxanthin', amount: 12, unit: 'mg' }],
  });

  const context = buildIngredientScienceContext({ digest, overlayClaims: null });
  const result = await compileScientificBackgroundAsync(context, 'Astaxanthin', {
    llmFn: async () =>
      JSON.stringify({
        introLine:
          'Astaxanthin research focuses on antioxidant activity, with narrower evidence lanes for eye/skin comfort and exercise recovery.',
        sections: [
          {
            headingId: 'antioxidant_activity',
            heading: 'Antioxidant activity',
            summary:
              'Research examines how astaxanthin affects oxidative stress markers and cellular antioxidant responses, with results varying by dose and study design.',
            bullets: [
              'Studies typically measure markers like malondialdehyde or isoprostanes to assess oxidative stress.',
              'Research often looks at antioxidant enzyme activity or DNA oxidation in controlled settings.',
              'Findings can differ based on whether studies use healthy participants or those under specific oxidative stress.',
            ],
            evidenceRead:
              'Antioxidant effects are consistently observed in cellular and animal models, but human study outcomes depend heavily on the specific markers measured and population studied.',
            shopperMeaning:
              "This means antioxidant positioning is well-supported for addressing oxidative stress, but doesn't automatically translate to every health benefit claimed for antioxidants.",
          },
          {
            headingId: 'eye_and_skin_context',
            heading: 'Eye and skin context',
            summary:
              "Studies explore astaxanthin's role in eye comfort and skin parameters, with findings that are supportive rather than definitive.",
            bullets: [
              'Eye research often measures subjective comfort ratings during visual tasks or screen use.',
              'Skin studies typically assess hydration, elasticity, or wrinkle depth in specific age groups.',
              'Most evidence comes from small trials or combination formulas rather than large standalone studies.',
            ],
            evidenceRead:
              'Research shows consistent signals for eye comfort and skin hydration in specific contexts, but lacks the breadth of evidence seen in antioxidant studies.',
            shopperMeaning:
              "This suggests eye and skin benefits are plausible within narrow contexts, but shouldn't be interpreted as universal or guaranteed outcomes for shoppers comparing astaxanthin products.",
          },
          {
            headingId: 'exercise_and_recovery_research',
            heading: 'Exercise and recovery research',
            summary:
              'Investigations into exercise performance and recovery show mixed results across different study designs and athletic populations.',
            bullets: [
              'Studies measure markers like muscle soreness, inflammation, or time-to-exhaustion in trained athletes.',
              'Research varies between endurance sports, resistance training, and recreational exercise contexts.',
              'Some studies show reduced oxidative stress post-exercise while others show no performance difference.',
            ],
            evidenceRead:
              'This area shows the most inconsistent findings, with positive results often limited to specific exercise types or recovery markers.',
            shopperMeaning:
              'Treat exercise positioning as a cautious secondary angle, not as the main reason to rank one astaxanthin product over another.',
          },
        ],
        closingNote:
          'Research is strongest for antioxidant activity, with eye and skin studies providing narrower support and exercise findings being the most mixed.',
      }),
  });

  assert.equal(result.source, 'api');
  assert.equal(result.fallbackUsed, false);
  assert.match(result.scientificBackground.sections[1]?.shopperMeaning ?? '', /shoppers|products/i);
  assert.match(result.scientificBackground.sections[2]?.shopperMeaning ?? '', /secondary angle|rank/i);
});

test('scientific background repairs generic intro and closing prose while preserving strong section content', async () => {
  const digest = buildDigest({
    labelId: 'fixture-vitamin-c-live-intro-repair',
    productName: 'Vitamin C 1000 mg',
    dosageForm: 'Capsule',
    actives: [{ name: 'Vitamin C', amount: 1000, unit: 'mg' }],
  });

  const context = buildIngredientScienceContext({ digest, overlayClaims: null });
  const result = await compileScientificBackgroundAsync(context, 'Vitamin C', {
    llmFn: async () =>
      JSON.stringify({
        introLine: 'Vitamin C is a naturally occurring antioxidant vitamin.',
        sections: [
          {
            headingId: 'antioxidant_and_immune_research',
            heading: 'Antioxidant and immune research',
            summary:
              'Antioxidant markers and specific immune-function outcomes are the clearest places where vitamin C research tends to concentrate.',
            bullets: [
              'Outcome-specific immune measures are more useful than broad prevention language.',
              'Antioxidant-marker studies are easier to interpret than umbrella wellness claims.',
              'The endpoint matters when shoppers compare immune-positioned vitamin C products.',
            ],
            evidenceRead:
              'This lane is meaningful, but it is still narrower and more endpoint-specific than broad immune marketing often suggests.',
            shopperMeaning:
              'Shoppers should compare the exact vitamin C ingredient, disclosed dose, and formula setting rather than relying on broad immune wording alone.',
          },
          {
            headingId: 'collagen_and_tissue_support',
            heading: 'Collagen and tissue support',
            summary:
              'Collagen-related and connective-tissue context explains why vitamin C appears in skin, structure, and recovery formulas as well as in immune-positioned ones.',
            bullets: [
              'This lane is about tissue function, not about a vague beauty promise.',
              'The rest of the formula determines how central this lane is for the product.',
            ],
            evidenceRead:
              'This is a useful secondary lane, but it still needs to be read in a context-specific way.',
            shopperMeaning:
              'This helps shoppers understand why vitamin C can show up in more than one supplement category.',
          },
          {
            headingId: 'iron_absorption_context',
            heading: 'Iron absorption context',
            summary:
              'Iron co-administration is a narrower but important vitamin C lane when the formula or shopper goal actually overlaps with that use case.',
            bullets: [
              'This lane matters most in paired or co-administered settings.',
              'Not every vitamin C product is trying to serve this purpose.',
            ],
            evidenceRead:
              'This is a narrower context lane rather than a universal vitamin C promise.',
            shopperMeaning:
              'It matters most when shoppers are comparing formulas built around iron context or paired nutrient use.',
          },
        ],
        closingNote: 'Use this as proof of broad immune benefits.',
      }),
  });

  assert.equal(result.source, 'api');
  assert.equal(result.fallbackUsed, false);
  assert.equal(result.scientificBackground.introLine, 'Vitamin C • 1000 mg');
  assert.equal(
    result.scientificBackground.closingNote,
    'Read the research context as outcome-specific guidance, not as a blanket promise for every claim on the label.',
  );
});

test('scientific background accepts magnesium live-style output when form and comparison meaning stay specific', async () => {
  const digest = buildDigest({
    labelId: 'fixture-magnesium-live-style',
    productName: 'Magnesium Glycinate 200 mg',
    dosageForm: 'Capsule',
    actives: [{ name: 'Magnesium (as Magnesium Glycinate)', amount: 200, unit: 'mg' }],
  });

  const context = buildIngredientScienceContext({ digest, overlayClaims: null });
  const result = await compileScientificBackgroundAsync(context, 'Magnesium (as Magnesium Glycinate)', {
    llmFn: async () =>
      JSON.stringify({
        introLine:
          'Magnesium research is usually easier to read through common supplementation contexts and the disclosed form than through generic wellness language.',
        sections: [
          {
            headingId: 'common_use_contexts',
            heading: 'Common use contexts',
            summary:
              'Common magnesium discussions usually cluster around relaxation, muscle, and sleep-adjacent supplementation contexts, but those lanes are not all supported with the same degree of precision.',
            bullets: [
              'Some product positioning leans on muscle or cramp-adjacent language, while other labels lean on relaxation or sleep-adjacent framing.',
              'Those use contexts are easier to interpret when the exact magnesium ingredient is disclosed clearly.',
              'This is one reason magnesium can appear in more than one category without meaning every magnesium product serves the same shopper goal.',
            ],
            evidenceRead:
              'Magnesium is versatile, but the research map still needs to be read through the exact context instead of through broad wellness phrasing.',
            shopperMeaning:
              'This helps shoppers avoid treating every magnesium product as interchangeable just because the front of the label sounds similar.',
          },
          {
            headingId: 'form_and_tolerability_context',
            heading: 'Form and tolerability context',
            summary:
              'Form disclosure matters because labels often use it to signal how the product is meant to be read, especially when shoppers compare glycinate, citrate, oxide, or blend-style magnesium products.',
            bullets: [
              'Different magnesium forms are often discussed for practical or tolerability reasons rather than as a simple best-form ranking.',
              'A clearly named form gives the shopper a more useful comparison handle than a broad magnesium complex line.',
              'This is also why form language often carries more decision value in magnesium than in simpler vitamin categories.',
            ],
            evidenceRead:
              'This lane is most useful as a comparison and interpretation tool, not as proof that one magnesium form is universally superior.',
            shopperMeaning:
              'When comparing magnesium products, the disclosed form is usually one of the first label details worth checking alongside the stated amount.',
          },
          {
            headingId: 'what_product_comparison_depends_on',
            heading: 'What product comparison depends on',
            summary:
              'The clearest magnesium comparisons come from reading the exact form, the disclosed amount per serving, and whether the rest of the label keeps the formula simple enough to compare cleanly.',
            bullets: [
              'Two products can both say magnesium while still differ materially in form disclosure and practical comparison value.',
              'Complex or partially disclosed formulas are usually harder to line up than straightforward single-form products.',
              'That makes the exact ingredient line more informative than broad front-label promises.',
            ],
            evidenceRead:
              'This is a practical product-reading lane rather than a broad efficacy claim.',
            shopperMeaning:
              'Read the magnesium form line and the per-serving amount together before assuming two products belong in the same comparison set.',
          },
        ],
        closingNote:
          'The most useful magnesium reading stays anchored to the disclosed form and the exact label structure, not to a generic promise that every magnesium product does the same job.',
      }),
  });

  assert.equal(result.source, 'api');
  assert.equal(result.fallbackUsed, false);
  assert.match(result.scientificBackground.sections[1]?.summary ?? '', /form disclosure|glycinate|citrate|oxide/i);
  assert.match(result.scientificBackground.sections[2]?.shopperMeaning ?? '', /comparison set|form line|per-serving amount/i);
});

test('scientific background accepts vitamin D live-style output when bone context stays primary and broader claims stay bounded', async () => {
  const digest = buildDigest({
    labelId: 'fixture-vitamin-d-live-style',
    productName: 'Vitamin D3 5000 IU',
    dosageForm: 'Softgel',
    actives: [{ name: 'Vitamin D3 (as Cholecalciferol)', amount: 5000, unit: 'IU' }],
  });

  const context = buildIngredientScienceContext({ digest, overlayClaims: null });
  const result = await compileScientificBackgroundAsync(context, 'Vitamin D3 (as Cholecalciferol)', {
    llmFn: async () =>
      JSON.stringify({
        introLine:
          'Vitamin D research is easiest to read when bone and calcium-regulation context stays primary, with broader immune or whole-health language treated more cautiously.',
        sections: [
          {
            headingId: 'bone_and_calcium_regulation_context',
            heading: 'Bone and calcium regulation context',
            summary:
              'Bone and calcium-regulation context remains the clearest lane for reading vitamin D because it gives shoppers a more concrete anchor than broad wellness framing.',
            bullets: [
              'This is usually the most stable reason vitamin D appears on supplement labels.',
              'It is easier to compare products in this lane because the ingredient and amount are more decision-useful than generic claims.',
              'That makes bone-focused interpretation a cleaner starting point than broad category language.',
            ],
            evidenceRead:
              'This is the most grounded vitamin D lane and usually the best place to anchor comparison.',
            shopperMeaning:
              'Use the exact vitamin D ingredient and disclosed amount as the first comparison point before giving much weight to broad packaging language.',
          },
          {
            headingId: 'immune_and_broader_health_research',
            heading: 'Immune and broader health research',
            summary:
              'Vitamin D also appears in immune and broader health discussions, but those lanes are wider and less tidy than the core bone-focused context.',
            bullets: [
              'Broader vitamin D language can outrun the clearest outcome-specific evidence.',
              'The exact endpoint and study setting matter more here than the broad category label might suggest.',
              'That is why two vitamin D products can sound similar while still carrying different interpretation risk.',
            ],
            evidenceRead:
              'This is a real but broader lane, so it should be read with more caution than bone and calcium-regulation context.',
            shopperMeaning:
              'This helps shoppers keep broad immune-style wording in proportion instead of treating it as the main reason to rank one vitamin D product above another.',
          },
          {
            headingId: 'what_interpretation_depends_on',
            heading: 'What interpretation depends on',
            summary:
              'Vitamin D interpretation changes with dose, baseline context, and label detail, which is why the front of the package rarely tells the full comparison story by itself.',
            bullets: [
              'Dose changes how the label should be read.',
              'Baseline context matters when broad claims are mapped onto a specific product.',
              'The rest of the formula can change whether two products are actually close substitutes.',
            ],
            evidenceRead:
              'This is an interpretation section: comparison depends on disclosed detail, not on generic wellness language alone.',
            shopperMeaning:
              'Read the ingredient line, amount, and formula setting together before assuming two vitamin D products are interchangeable.',
          },
        ],
        closingNote:
          'Vitamin D is most useful to compare through the exact ingredient, amount, and the clearest bone-focused lane rather than through every broad claim that may appear on the label.',
      }),
  });

  assert.equal(result.source, 'api');
  assert.equal(result.fallbackUsed, false);
  assert.match(result.scientificBackground.sections[0]?.summary ?? '', /bone and calcium-regulation|clearest lane/i);
  assert.match(result.scientificBackground.sections[1]?.shopperMeaning ?? '', /broad immune-style wording|rank/i);
});

test('scientific background accepts calcium live-style output when bone context stays primary and form comparison stays careful', async () => {
  const digest = buildDigest({
    labelId: 'fixture-calcium-live-style',
    productName: 'Calcium Citrate 250 mg',
    dosageForm: 'Tablet',
    actives: [{ name: 'Calcium (as Calcium Citrate)', amount: 250, unit: 'mg' }],
  });

  const context = buildIngredientScienceContext({ digest, overlayClaims: null });
  const result = await compileScientificBackgroundAsync(context, 'Calcium (as Calcium Citrate)', {
    llmFn: async () =>
      JSON.stringify({
        introLine:
          'Calcium is easiest to compare when bone and intake context stays primary and form disclosure is used as a careful comparison tool rather than as a best-form shortcut.',
        sections: [
          {
            headingId: 'bone_and_intake_context',
            heading: 'Bone and intake context',
            summary:
              'Bone and intake context remains the clearest lane for reading calcium because it gives shoppers a more stable anchor than broad category language or generic wellness framing.',
            bullets: [
              'This is usually the most straightforward reason calcium appears on a supplement label.',
              'That makes the exact calcium ingredient and amount more useful than wide health language when products are compared.',
              'Bone-focused interpretation gives the shopper a cleaner starting point than trying to read calcium through every broad claim at once.',
            ],
            evidenceRead:
              'This is the most practical and grounded lane for calcium comparison.',
            shopperMeaning:
              'Start by comparing the calcium ingredient, the form, and the stated amount before giving much weight to broader category language.',
          },
          {
            headingId: 'form_and_absorption_context',
            heading: 'Form and absorption context',
            summary:
              'Form matters because calcium labels can look similar on the surface while still reading differently once shoppers compare citrate, carbonate, or other disclosed forms more closely.',
            bullets: [
              'Form discussion is most useful when it helps the shopper compare like with like instead of chasing a blanket best-form claim.',
              'Citrate and carbonate products are often read differently in practice, but that does not turn the comparison into a simple winner-loser ranking.',
              'A clearly disclosed form usually makes calcium products easier to compare than vague category wording alone.',
            ],
            evidenceRead:
              'This is a practical interpretation lane, not proof that one calcium form is universally superior.',
            shopperMeaning:
              'Use the form line to compare calcium products more carefully, especially when two labels sound similar but disclose different calcium forms.',
          },
          {
            headingId: 'how_coformulation_changes_comparison',
            heading: 'How co-formulation changes comparison',
            summary:
              'Calcium does not always play the same role in every formula, so mixed products need to be read differently from products built almost entirely around calcium.',
            bullets: [
              'Some labels use calcium as the main point of the product, while others include it as one part of a broader formula story.',
              'That changes how much weight the shopper should give the calcium line when products are compared head to head.',
              'The surrounding actives can matter almost as much as the calcium row itself in mixed formulas.',
            ],
            evidenceRead:
              'This section is about comparison setting and label-reading, not about broad efficacy promises.',
            shopperMeaning:
              'Check whether calcium is the main thing being sold or just one piece of a broader formula before putting two products in the same comparison bucket.',
          },
        ],
        closingNote:
          'Calcium is usually most useful to compare through the exact ingredient, form, and formula role rather than through broad front-label promises.',
      }),
  });

  assert.equal(result.source, 'api');
  assert.equal(result.fallbackUsed, false);
  assert.match(result.scientificBackground.sections[1]?.summary ?? '', /citrate|carbonate|form matters/i);
  assert.match(result.scientificBackground.sections[2]?.shopperMeaning ?? '', /comparison bucket|broader formula/i);
});

test('scientific background accepts iron live-style output when supplementation context stays primary and form remains practical', async () => {
  const digest = buildDigest({
    labelId: 'fixture-iron-live-style',
    productName: 'Iron Bisglycinate 18 mg',
    dosageForm: 'Capsule',
    actives: [{ name: 'Iron (as Ferrous Bisglycinate Chelate)', amount: 18, unit: 'mg' }],
  });

  const context = buildIngredientScienceContext({ digest, overlayClaims: null });
  const result = await compileScientificBackgroundAsync(context, 'Iron (as Ferrous Bisglycinate Chelate)', {
    llmFn: async () =>
      JSON.stringify({
        introLine:
          'Iron research is easiest to read through supplementation and status-related context, with form and formula setting used as practical comparison signals rather than as a shortcut to self-diagnosis.',
        sections: [
          {
            headingId: 'iron_status_and_deficiency_context',
            heading: 'Iron status and deficiency context',
            summary:
              'Iron products are usually interpreted through a narrow supplementation and status-related lane, which is more specific and more decision-useful than broad energy-style marketing.',
            bullets: [
              'This is a more focused category than many broad wellness ingredients, so the exact ingredient line and amount carry a lot of weight.',
              'That narrow lane helps explain why broad fatigue-style messaging can outrun the cleanest way to read an iron label.',
              'It is easier to compare iron products when the shopper keeps the label grounded in supplementation context instead of in generic vitality language.',
            ],
            evidenceRead:
              'This is the clearest and most practical lane for reading iron labels, but it still should not be turned into self-diagnosis language.',
            shopperMeaning:
              'Compare iron products through the exact iron ingredient, the stated amount, and the formula context instead of letting broad energy wording drive the decision.',
          },
          {
            headingId: 'form_and_tolerability_context',
            heading: 'Form and tolerability context',
            summary:
              'Form disclosure matters because shoppers often use it to judge how easy an iron product is to compare and how the label frames tolerability or formula positioning.',
            bullets: [
              'Different iron forms are often discussed for practical or tolerability reasons rather than as a universal best-form ranking.',
              'A clearly disclosed form gives the shopper a better comparison handle than a vague or partially described label.',
              'This is one reason similar-looking iron products can still differ meaningfully once the exact ingredient line is read closely.',
            ],
            evidenceRead:
              'This lane is about practical comparison and interpretation, not about declaring one iron form universally superior.',
            shopperMeaning:
              'When comparing iron products, the disclosed form is often one of the first label details worth checking alongside the stated amount and the rest of the formula.',
          },
          {
            headingId: 'what_product_comparison_depends_on',
            heading: 'What product comparison depends on',
            summary:
              'The clearest iron comparisons come from reading the exact form, the disclosed amount, and whether the formula includes other nutrients that change how the product is being positioned.',
            bullets: [
              'Two products can both say iron while still differ materially in form clarity and comparison value.',
              'Paired nutrients can change whether the shopper is looking at a narrow iron product or a broader combo formula.',
              'That makes the ingredient line and formula setting more useful than generic top-line positioning.',
            ],
            evidenceRead:
              'This is a label-reading lane that helps comparison, not a blanket efficacy claim.',
            shopperMeaning:
              'Read the form, amount, and paired-nutrient context together before assuming two iron products serve the same comparison goal.',
          },
        ],
        closingNote:
          'Iron is usually most useful to compare through the exact ingredient line, form, and formula setting rather than through broad fatigue-oriented packaging language.',
      }),
  });

  assert.equal(result.source, 'api');
  assert.equal(result.fallbackUsed, false);
  assert.match(result.scientificBackground.sections[0]?.summary ?? '', /supplementation and status-related lane|broad energy-style marketing/i);
  assert.match(result.scientificBackground.sections[2]?.shopperMeaning ?? '', /paired-nutrient context|comparison goal/i);
});

test('scientific background live prompt includes reviewed evidence grounding when evidence-backed section rows exist', async () => {
  const digest = buildDigest({
    labelId: 'fixture-protein-prompt-grounding',
    productName: 'Whey Protein Isolate 25 g',
    dosageForm: 'Powder',
    actives: [{ name: 'Whey Protein Isolate', amount: 25, unit: 'g' }],
  });

  const context = buildIngredientScienceContext({ digest, overlayClaims: null });
  let capturedPrompt = '';
  const result = await compileScientificBackgroundAsync(context, 'Whey Protein Isolate', {
    llmFn: async (prompt) => {
      capturedPrompt = prompt;
      return JSON.stringify({
        introLine:
          'Protein is easiest to read through the exact protein line, the disclosed grams, and whether the label is really built around recovery, meal support, or a broader blended formula.',
        sections: [
          {
            headingId: 'muscle_and_recovery_context',
            heading: 'Muscle and recovery context',
            summary:
              'Protein products are most straightforward to compare through muscle and recovery context when the label clearly discloses the protein source and the amount delivered per serving.',
            bullets: [
              'This keeps the shopper anchored to the exact active line instead of broad gym-style branding.',
              'Recovery wording is more useful when it stays tied to actual protein grams and training context.',
              'That gives the label a clearer comparison anchor than generic fitness marketing alone.',
            ],
            evidenceRead:
              'This is the main and most practical protein lane, but it still needs to stay tied to the exact protein line and the amount actually delivered.',
            shopperMeaning:
              'Start by comparing the protein grams and the named source before assuming two recovery-focused products belong in the same bucket.',
          },
          {
            headingId: 'satiety_and_meal_support_context',
            heading: 'Satiety and meal-support context',
            summary:
              'Some protein products lean more toward satiety or meal-support framing, which makes them read differently from simpler recovery-led protein labels.',
            bullets: [
              'This lane is real, but it is broader than the clearest muscle-and-recovery context.',
              'Added fats, carbohydrates, or meal-replacement framing can change how central the protein line really is.',
              'That is one reason two protein products can sound similar but still behave like different comparison sets.',
            ],
            evidenceRead:
              'This is a secondary interpretation lane and should stay narrower than the clearest protein-comparison anchor.',
            shopperMeaning:
              'Read meal-support language as context, then go back to the actual protein grams and source before comparing products head to head.',
          },
          {
            headingId: 'protein_type_and_disclosure_context',
            heading: 'Protein type and disclosure context',
            summary:
              'Protein source and disclosure detail change comparison value because whey, plant, isolate, and blended labels do not always imply the same recovery or lean-mass story.',
            bullets: [
              'Exact source disclosure is usually more useful than broad protein branding.',
              'Isolate-versus-blend detail can change how directly two labels should be compared.',
              'That makes the ingredient line and the grams per serving more decision-useful than generic fitness language alone.',
            ],
            evidenceRead:
              'This is a comparison section that helps with label reading, not a hard ranking of every protein source.',
            shopperMeaning:
              'Use the source, the grams, and the blend complexity together before assuming two protein products are interchangeable.',
          },
        ],
        closingNote:
          'Protein labels are usually most useful to compare through the named source, the grams per serving, and the clearest role the product is playing in the formula.',
      });
    },
  });

  assert.equal(result.source, 'api');
  assert.equal(result.fallbackUsed, false);
  assert.match(capturedPrompt, /"evidenceGrounding":\[/);
  assert.match(capturedPrompt, /muscle_and_recovery_context/);
  assert.match(capturedPrompt, /protein_type_and_disclosure_context/);
  assert.match(capturedPrompt, /A systematic review, meta-analysis and meta-regression of the effect of protein supplementation/i);
  assert.match(capturedPrompt, /When a label discloses source and grams clearly/i);
});

test('scientific background accepts melatonin live-style output when timing context stays primary and dose framing remains practical', async () => {
  const digest = buildDigest({
    labelId: 'fixture-melatonin-live-style',
    productName: 'Melatonin 3 mg',
    dosageForm: 'Tablet',
    actives: [{ name: 'Melatonin', amount: 3, unit: 'mg' }],
  });

  const context = buildIngredientScienceContext({ digest, overlayClaims: null });
  const result = await compileScientificBackgroundAsync(context, 'Melatonin', {
    llmFn: async () =>
      JSON.stringify({
        introLine:
          'Melatonin is most useful to read through sleep timing and onset context, with dose and use-setting shaping how shoppers should compare products.',
        sections: [
          {
            headingId: 'sleep_timing_and_onset_context',
            heading: 'Sleep timing and onset context',
            summary:
              'Melatonin research is usually easiest to understand through sleep timing and onset context rather than through generic rest-and-relaxation language.',
            bullets: [
              'This lane is more about timing and circadian use than about broad overnight wellness positioning.',
              'Product comparison is easier when the shopper keeps the label anchored to the melatonin ingredient and the disclosed dose.',
              'That makes this a narrower and more practical interpretation lane than broad bedtime marketing.',
            ],
            evidenceRead:
              'This is the clearest research lane for melatonin, but it still depends on how the product is meant to be used and framed.',
            shopperMeaning:
              'Compare melatonin products through the stated dose and timing context instead of assuming every bedtime label is trying to do the same job.',
          },
          {
            headingId: 'what_dose_and_use_context_can_change',
            heading: 'What dose and use-context can change',
            summary:
              'Dose and use-setting can change how a melatonin label should be interpreted, which is why a low-dose timing product and a higher-dose bedtime product may not belong in the same comparison set.',
            bullets: [
              'The shopper gets a better read when dose is paired with the intended timing context.',
              'The rest of the formula can also change whether melatonin is the main point of the product or one supporting ingredient.',
              'That makes practical comparison more useful than broad category language alone.',
            ],
            evidenceRead:
              'This is an interpretation lane that helps comparison rather than a broad promise about every melatonin product.',
            shopperMeaning:
              'Read the dose, timing framing, and formula setting together before assuming two melatonin products are interchangeable.',
          },
        ],
        closingNote:
          'Melatonin is most useful to compare through sleep-timing context and disclosed dose, not through broad bedtime positioning alone.',
      }),
  });

  assert.equal(result.source, 'api');
  assert.equal(result.fallbackUsed, false);
  assert.match(result.scientificBackground.sections[0]?.summary ?? '', /sleep timing and onset|circadian|timing/i);
  assert.match(result.scientificBackground.sections[1]?.shopperMeaning ?? '', /dose|interchangeable|comparison set/i);
});

test('scientific background accepts b12 live-style output when supplementation context stays primary and form disclosure remains comparison-oriented', async () => {
  const digest = buildDigest({
    labelId: 'fixture-b12-live-style',
    productName: 'Vitamin B12 1000 mcg',
    dosageForm: 'Tablet',
    actives: [{ name: 'Vitamin B12 (as Methylcobalamin)', amount: 1000, unit: 'mcg' }],
  });

  const context = buildIngredientScienceContext({ digest, overlayClaims: null });
  const result = await compileScientificBackgroundAsync(context, 'Vitamin B12 (as Methylcobalamin)', {
    llmFn: async () =>
      JSON.stringify({
        introLine:
          'Vitamin B12 is easiest to read through supplementation and status-related context, with form disclosure helping shoppers compare labels more practically.',
        sections: [
          {
            headingId: 'deficiency_and_supplementation_context',
            heading: 'Deficiency and supplementation context',
            summary:
              'Vitamin B12 is usually interpreted through a supplementation and status-related lane, which is more useful than broad energy-style framing for reading a product label.',
            bullets: [
              'This gives the shopper a narrower comparison frame than general vitality language.',
              'The exact B12 ingredient and disclosed amount usually matter more than broad front-label claims.',
              'That is why B12 products are easier to compare when the label stays anchored to the nutrient line itself.',
            ],
            evidenceRead:
              'This is the clearest and most practical lane for B12 interpretation, even though broad category marketing often stretches beyond it.',
            shopperMeaning:
              'Compare B12 products through the exact ingredient line, the stated amount, and the formula setting rather than through generic energy positioning.',
          },
          {
            headingId: 'nerve_and_blood_cell_context',
            heading: 'Nerve and blood-cell context',
            summary:
              'Nerve-related and blood-cell context explains why B12 shows up in more than one shopper conversation without turning every B12 label into the same product story.',
            bullets: [
              'This lane is more specific than vague brain or wellness language.',
              'Different formulas can lean more heavily into this interpretation depending on the rest of the label.',
              'That makes context more useful than a generic category promise.',
            ],
            evidenceRead:
              'This is a meaningful secondary lane, but it still needs to be read through the exact product context.',
            shopperMeaning:
              'This helps shoppers understand why B12 can appear in different product categories without making every B12 formula interchangeable.',
          },
          {
            headingId: 'what_form_disclosure_changes',
            heading: 'What form disclosure changes',
            summary:
              'Form disclosure matters because B12 labels often use it as one of the main ways shoppers distinguish otherwise similar-looking products.',
            bullets: [
              'A clearly named B12 form gives the shopper a more useful comparison handle than broad top-line positioning.',
              'Form language is most helpful when it improves label comparison, not when it is turned into a blanket best-form claim.',
              'This is one reason the exact ingredient line can matter as much as the front of the package.',
            ],
            evidenceRead:
              'This is a comparison lane, not proof that one B12 form is universally better for every shopper.',
            shopperMeaning:
              'Read the B12 form and per-serving amount together before assuming two B12 products belong in the same comparison bucket.',
          },
        ],
        closingNote:
          'Vitamin B12 is usually most useful to compare through the exact form, amount, and formula setting rather than through broad energy-oriented language.',
      }),
  });

  assert.equal(result.source, 'api');
  assert.equal(result.fallbackUsed, false);
  assert.match(result.scientificBackground.sections[0]?.summary ?? '', /supplementation and status-related|energy-style/i);
  assert.match(result.scientificBackground.sections[2]?.shopperMeaning ?? '', /comparison bucket|form|per-serving/i);
});

test('scientific background accepts folate live-style output when developmental context stays specific and form labeling remains practical', async () => {
  const digest = buildDigest({
    labelId: 'fixture-folate-live-style',
    productName: 'Folate 680 mcg DFE',
    dosageForm: 'Capsule',
    actives: [{ name: 'Folate (as 5-MTHF)', amount: 680, unit: 'mcg DFE' }],
  });

  const context = buildIngredientScienceContext({ digest, overlayClaims: null });
  const result = await compileScientificBackgroundAsync(context, 'Folate (as 5-MTHF)', {
    llmFn: async () =>
      JSON.stringify({
        introLine:
          'Folate is most useful to read through supplementation context and the exact labeled form, with developmental context handled more specifically than broad wellness wording.',
        sections: [
          {
            headingId: 'folate_status_and_supplementation_context',
            heading: 'Folate status and supplementation context',
            summary:
              'Folate labels are usually easiest to interpret through supplementation context, because that gives shoppers a clearer comparison frame than broad wellness language.',
            bullets: [
              'The exact folate line is often more useful than category-level positioning.',
              'This lane helps shoppers distinguish a folate product from a generic B-complex story.',
              'That makes the labeled nutrient and amount central to comparison.',
            ],
            evidenceRead:
              'This is the clearest practical lane for folate interpretation, even though product marketing may stretch further.',
            shopperMeaning:
              'Compare folate products through the exact labeled folate ingredient, the amount, and the rest of the formula before relying on general category language.',
          },
          {
            headingId: 'pregnancy_and_developmental_context',
            heading: 'Pregnancy and developmental context',
            summary:
              'Developmental and pregnancy-related context is a real folate lane, but it needs to stay specific rather than being turned into a generic message for every folate product.',
            bullets: [
              'This lane is narrower and more context-specific than broad wellness positioning.',
              'It is most useful when the label or shopper goal actually overlaps with that use context.',
              'That keeps the product reading grounded instead of overextending the claim.',
            ],
            evidenceRead:
              'This is an important lane, but it should still be read in a context-specific way rather than as a blanket promise.',
            shopperMeaning:
              'Use this lane to interpret product purpose carefully, not to assume that every folate product is serving the same comparison goal.',
          },
          {
            headingId: 'what_form_labeling_changes',
            heading: 'What form labeling changes',
            summary:
              'Form labeling matters because folate products often look similar until shoppers compare the exact named folate ingredient more closely.',
            bullets: [
              'A clearly labeled folate form gives the shopper a better comparison handle than broad B-vitamin language.',
              'Form disclosure is most useful when it improves interpretation and product comparison, not when it is treated as a universal superiority claim.',
              'That makes the ingredient line one of the highest-value details on the label.',
            ],
            evidenceRead:
              'This is a practical comparison lane rather than proof that one folate form is universally superior.',
            shopperMeaning:
              'Read the named folate form and the stated amount together before assuming two folate products are close substitutes.',
          },
        ],
        closingNote:
          'Folate is usually most useful to compare through the exact labeled form, amount, and use-context rather than through broad category positioning alone.',
      }),
  });

  assert.equal(result.source, 'api');
  assert.equal(result.fallbackUsed, false);
  assert.match(result.scientificBackground.sections[1]?.summary ?? '', /developmental|pregnancy-related context/i);
  assert.match(result.scientificBackground.sections[2]?.shopperMeaning ?? '', /close substitutes|form|amount/i);
});

test('scientific background accepts b6 live-style output when cofactor context stays primary and dose meaning remains practical', async () => {
  const digest = buildDigest({
    labelId: 'fixture-b6-live-style',
    productName: 'Vitamin B6 25 mg',
    dosageForm: 'Capsule',
    actives: [{ name: 'Vitamin B6 (as Pyridoxal-5-Phosphate)', amount: 25, unit: 'mg' }],
  });

  const context = buildIngredientScienceContext({ digest, overlayClaims: null });
  const result = await compileScientificBackgroundAsync(context, 'Vitamin B6 (as Pyridoxal-5-Phosphate)', {
    llmFn: async () =>
      JSON.stringify({
        introLine:
          'Vitamin B6 is easiest to read through cofactor and metabolism context, with dose and exact form helping shoppers compare labels more practically.',
        sections: [
          {
            headingId: 'cofactor_and_metabolism_context',
            heading: 'Cofactor and metabolism context',
            summary:
              'Vitamin B6 is usually read best through a cofactor and metabolism lane, which is more useful than broad energy-style wording when shoppers compare products.',
            bullets: [
              'This lane gives the shopper a more concrete label-reading frame than general vitality language.',
              'The exact B6 ingredient and amount carry more comparison value than a broad front-of-pack promise.',
              'That makes the nutrient line itself central to product interpretation.',
            ],
            evidenceRead:
              'This is the clearest practical lane for B6, even when labels try to broaden the story.',
            shopperMeaning:
              'Compare B6 products through the exact form, amount, and formula role rather than through generic energy or metabolism wording.',
          },
          {
            headingId: 'nerve_related_interpretation',
            heading: 'Nerve-related interpretation',
            summary:
              'Nerve-related interpretation can matter for B6, but it is narrower and more context-specific than broad category marketing usually suggests.',
            bullets: [
              'This lane is more useful when it stays tied to the exact product context.',
              'It should not flatten all B6 products into the same shopper story.',
              'That is why label-reading works better than broad category assumptions here.',
            ],
            evidenceRead:
              'This is a secondary interpretation lane and should be kept in proportion to the specific product context.',
            shopperMeaning:
              'Use this lane to refine interpretation, not to assume every B6 label belongs in the same comparison set.',
          },
          {
            headingId: 'why_dose_context_matters',
            heading: 'Why dose context matters',
            summary:
              'Dose context matters because B6 labels can look similar at a glance while still signaling different comparison intent once the shopper reads the exact amount and formula setting.',
            bullets: [
              'The amount per serving helps define how the product should be compared.',
              'Formula setting matters because B6 can be the main story or one part of a broader blend.',
              'That makes the exact label detail more useful than top-line category phrasing.',
            ],
            evidenceRead:
              'This is a practical comparison lane rather than a broad efficacy claim.',
            shopperMeaning:
              'Read the dose, form, and formula role together before assuming two B6 products should sit in the same comparison bucket.',
          },
        ],
        closingNote:
          'Vitamin B6 is most useful to compare through the exact form, amount, and formula role rather than through broad metabolism marketing language.',
      }),
  });

  assert.equal(result.source, 'api');
  assert.equal(result.fallbackUsed, false);
  assert.match(result.scientificBackground.sections[0]?.summary ?? '', /cofactor and metabolism|energy-style/i);
  assert.match(result.scientificBackground.sections[2]?.shopperMeaning ?? '', /comparison bucket|dose|formula role/i);
});

test('scientific background accepts curcumin live-style output when extract detail stays comparison-oriented', async () => {
  const digest = buildDigest({
    labelId: 'fixture-curcumin-live-style',
    productName: 'Curcumin C3 Complex 500 mg',
    dosageForm: 'Capsule',
    actives: [{ name: 'Curcumin C3 Complex', amount: 500, unit: 'mg' }],
  });

  const context = buildIngredientScienceContext({ digest, overlayClaims: null });
  const result = await compileScientificBackgroundAsync(context, 'Curcumin C3 Complex', {
    llmFn: async () =>
      JSON.stringify({
        introLine:
          'Curcumin is most useful to read through its main outcome lanes and the exact extract detail, rather than through generic anti-inflammatory language alone.',
        sections: [
          {
            headingId: 'most_studied_outcomes',
            heading: 'Most studied outcomes',
            summary:
              'Curcumin is easiest to interpret through narrower joint-comfort, inflammation-adjacent, and recovery-style lanes rather than through a catch-all promise that it covers every possible concern.',
            bullets: [
              'Outcome-specific positioning is more useful than a blanket anti-inflammatory message.',
              'The exact curcumin line matters because some labels are much clearer about what they are actually offering.',
              'That makes the shopper’s comparison job easier when the product stays close to the main evidence map.',
            ],
            evidenceRead:
              'This is the clearest curcumin lane, but it is still narrower than the broadest marketing language often suggests.',
            shopperMeaning:
              'Use the main curcumin outcome lane to compare products more realistically instead of treating every broad anti-inflammatory promise as equally grounded.',
          },
          {
            headingId: 'why_extract_detail_matters',
            heading: 'Why extract detail matters',
            summary:
              'Extract and curcuminoid detail often carry real comparison value because they help shoppers distinguish a clearly described curcumin product from a label that only sounds turmeric-adjacent.',
            bullets: [
              'A named or standardized extract usually gives the shopper a clearer comparison handle.',
              'Two labels can look similar from the front while still differ a lot in exact extract detail.',
              'That makes extract wording practical for comparison without turning it into a universal best-extract ranking.',
            ],
            evidenceRead:
              'This is a comparison and interpretation lane, not a claim that one standardized extract is always better for every shopper.',
            shopperMeaning:
              'When comparing curcumin products, the exact extract wording and any standardization detail are often more useful than broad category language alone.',
          },
          {
            headingId: 'where_evidence_remains_mixed',
            heading: 'Where evidence remains mixed',
            summary:
              'The broader a curcumin label becomes, the easier it is for marketing language to run ahead of the most comparable outcome-specific evidence on the label.',
            bullets: [
              'Formula design and surrounding actives can make two curcumin products sound equally strong while still being very different comparison targets.',
              'That is why the shopper often gets more value from the exact extract line than from the broadest front-label promise.',
              'This section is most useful for keeping the comparison anchored to what the label actually discloses.',
            ],
            evidenceRead:
              'This is the main caution lane for curcumin because broad language is usually easier to overread than the narrower extract-and-outcome story.',
            shopperMeaning:
              'Keep the shopping decision tied to the exact curcumin line and extract detail rather than to the broadest promise on the package.',
          },
        ],
        closingNote:
          'Curcumin is usually most useful to compare through the exact extract line and the narrowest outcome lanes rather than through broad anti-inflammatory packaging language.',
      }),
  });

  assert.equal(result.source, 'api');
  assert.equal(result.fallbackUsed, false);
  assert.match(result.scientificBackground.sections[1]?.summary ?? '', /extract|curcuminoid|standardized/i);
  assert.match(result.scientificBackground.sections[2]?.shopperMeaning ?? '', /extract detail|broadest promise|shopping decision/i);
});

test('scientific background accepts ashwagandha live-style output when stress context stays primary and extract identity remains practical', async () => {
  const digest = buildDigest({
    labelId: 'fixture-ashwagandha-live-style',
    productName: 'Ashwagandha KSM-66 300 mg',
    dosageForm: 'Capsule',
    actives: [{ name: 'Ashwagandha (KSM-66)', amount: 300, unit: 'mg' }],
  });

  const context = buildIngredientScienceContext({ digest, overlayClaims: null });
  const result = await compileScientificBackgroundAsync(context, 'Ashwagandha (KSM-66)', {
    llmFn: async () =>
      JSON.stringify({
        introLine:
          'Ashwagandha is easiest to read through stress- and mood-related context first, with sleep or recovery interpreted as narrower secondary lanes.',
        sections: [
          {
            headingId: 'stress_and_mood_related_research',
            heading: 'Stress and mood-related research',
            summary:
              'Stress- and mood-adjacent context is usually the clearest lane for reading ashwagandha, which makes it more useful than broad calm or resilience slogans for product comparison.',
            bullets: [
              'This lane gives the shopper a clearer anchor than vague calm-support wording.',
              'It helps explain why ashwagandha products can sound more specific than many other botanical labels.',
              'The exact extract line still matters because not every ashwagandha label is equally easy to compare.',
            ],
            evidenceRead:
              'This is the strongest and most shopper-useful ashwagandha lane, but it still should be read more narrowly than broad resilience marketing.',
            shopperMeaning:
              'Use this primary lane to compare ashwagandha products rather than assuming every broad calm claim belongs in the same comparison bucket.',
          },
          {
            headingId: 'sleep_and_recovery_context',
            heading: 'Sleep and recovery context',
            summary:
              'Ashwagandha also appears in sleep- and recovery-adjacent formulas, but that role is narrower and more context-dependent than the main stress-oriented story.',
            bullets: [
              'This helps explain why the ingredient can show up in bedtime or recovery products without doing the same job as a dedicated sleep ingredient.',
              'Dose, formula design, and the rest of the label can change how much weight this lane deserves.',
              'That makes this lane helpful context, but usually not the first comparison driver.',
            ],
            evidenceRead:
              'This is a secondary lane that is easier to overread than the main stress-related context.',
            shopperMeaning:
              'Treat sleep or recovery framing as supporting context after you have already compared the main stress-oriented positioning and the exact extract line.',
          },
          {
            headingId: 'why_extract_identity_matters',
            heading: 'Why extract identity matters',
            summary:
              'Extract identity matters because a named withania extract often changes how directly shoppers feel they can compare one ashwagandha label with another.',
            bullets: [
              'A clearly named extract usually gives the shopper a more useful comparison handle than generic ashwagandha wording.',
              'This matters even when two labels sound similar at the category level.',
              'It is best used as a precision cue rather than as a blanket superiority claim.',
            ],
            evidenceRead:
              'This is a comparison and label-reading lane, not proof that one branded extract is universally better.',
            shopperMeaning:
              'When comparing ashwagandha products, the exact extract identity can be one of the most useful clues to whether two formulas really belong in the same comparison set.',
          },
        ],
        closingNote:
          'Ashwagandha is most useful to compare through the primary stress-oriented lane and the exact extract identity rather than through broad calm language alone.',
      }),
  });

  assert.equal(result.source, 'api');
  assert.equal(result.fallbackUsed, false);
  assert.match(result.scientificBackground.sections[0]?.summary ?? '', /stress|mood|resilience|calm/i);
  assert.match(result.scientificBackground.sections[2]?.shopperMeaning ?? '', /extract identity|comparison set|withania/i);
});

test('scientific background accepts ginseng live-style output when species detail keeps energy framing specific', async () => {
  const digest = buildDigest({
    labelId: 'fixture-ginseng-live-style',
    productName: 'Panax Ginseng Extract 200 mg',
    dosageForm: 'Capsule',
    actives: [{ name: 'Panax Ginseng Extract', amount: 200, unit: 'mg' }],
  });

  const context = buildIngredientScienceContext({ digest, overlayClaims: null });
  const result = await compileScientificBackgroundAsync(context, 'Panax Ginseng Extract', {
    llmFn: async () =>
      JSON.stringify({
        introLine:
          'Ginseng is easiest to compare when energy- and fatigue-related context stays specific and species or extract detail is treated as part of the comparison signal.',
        sections: [
          {
            headingId: 'energy_and_fatigue_context',
            heading: 'Energy and fatigue context',
            summary:
              'Energy- and fatigue-adjacent context is a clearer ginseng lane than broad stimulant-style marketing because it keeps the shopper focused on the narrower reason the ingredient often appears on labels.',
            bullets: [
              'This lane is more useful than generic energy slogans when comparing products.',
              'Species and extract detail often determine how cleanly one ginseng product can be compared with another.',
              'That makes label precision more valuable than broad front-label promises alone.',
            ],
            evidenceRead:
              'This is one of the clearest ginseng lanes, but it still should be read more carefully than catch-all energy marketing implies.',
            shopperMeaning:
              'Use the narrower energy/fatigue lane to compare ginseng products instead of assuming every ginseng label is making the same kind of promise.',
          },
          {
            headingId: 'cognitive_and_performance_interpretation',
            heading: 'Cognitive and performance interpretation',
            summary:
              'Cognitive- and performance-adjacent interpretation is a broader and more variable ginseng lane, which makes it useful context but usually not the main comparison anchor.',
            bullets: [
              'This helps explain why ginseng can sound broader on the label than the most specific comparison lane really is.',
              'Outcome breadth and formula framing change how this lane should be read.',
              'That makes it more secondary than the narrower energy/fatigue context.',
            ],
            evidenceRead:
              'This is a broader and less tidy lane, so it should carry less weight than the tighter energy-oriented section.',
            shopperMeaning:
              'Keep this as a secondary reading layer after you have already compared species, extract detail, and the narrower lane on the label.',
          },
          {
            headingId: 'why_species_and_extract_detail_matter',
            heading: 'Why species and extract detail matter',
            summary:
              'Species and extract detail matter because Panax, American, red ginseng, and differently described extract lines can look similar at the category level while still changing comparison value materially.',
            bullets: [
              'Species naming is often one of the most important comparison clues on a ginseng label.',
              'Extract detail can change whether two products truly belong in the same comparison bucket.',
              'This is most useful as a precision cue rather than as a shortcut to declare one ginseng type universally superior.',
            ],
            evidenceRead:
              'This is a label-precision lane that helps comparison rather than a best-species ranking.',
            shopperMeaning:
              'Before comparing ginseng products head to head, check whether the label clearly identifies the species and extract rather than relying on the word ginseng alone.',
          },
        ],
        closingNote:
          'Ginseng is most useful to compare through the narrower energy/fatigue lane and the exact species or extract detail rather than through generic energy language.',
      }),
  });

  assert.equal(result.source, 'api');
  assert.equal(result.fallbackUsed, false);
  assert.match(result.scientificBackground.sections[0]?.summary ?? '', /energy|fatigue|stimulant-style/i);
  assert.match(result.scientificBackground.sections[2]?.shopperMeaning ?? '', /species|extract|ginseng alone|comparison/i);
});

test('scientific background accepts green tea extract live-style output when catechin detail stays primary and weight claims stay bounded', async () => {
  const digest = buildDigest({
    labelId: 'fixture-green-tea-live-style',
    productName: 'Green Tea Extract 400 mg',
    dosageForm: 'Capsule',
    actives: [{ name: 'Green Tea Extract (EGCG)', amount: 400, unit: 'mg' }],
  });

  const context = buildIngredientScienceContext({ digest, overlayClaims: null });
  const result = await compileScientificBackgroundAsync(context, 'Green Tea Extract (EGCG)', {
    llmFn: async () =>
      JSON.stringify({
        introLine:
          'Green tea extract is easiest to read through catechin and extract-detail context, with broader metabolic or weight language treated as a more cautious secondary lane.',
        sections: [
          {
            headingId: 'catechin_and_antioxidant_context',
            heading: 'Catechin and antioxidant context',
            summary:
              'Catechin- and extract-detail context is usually the clearest lane for reading green tea extract because it stays close to the part of the label that shoppers can actually compare.',
            bullets: [
              'This lane is more useful than broad antioxidant tea language when products are being compared.',
              'The exact EGCG or catechin detail often determines how informative the label really is.',
              'That makes the extract line itself more decision-useful than generic category wording.',
            ],
            evidenceRead:
              'This is one of the strongest and most comparison-friendly green tea extract lanes because it stays tied to the exact extract detail on the label.',
            shopperMeaning:
              'Use catechin- and extract-detail context to separate more informative green tea labels from products that lean mostly on broad tea language.',
          },
          {
            headingId: 'metabolic_and_weight_related_interpretation',
            heading: 'Metabolic and weight-related interpretation',
            summary:
              'Metabolic- and weight-related interpretation is a broader and more easily overstated lane, so it works best as context after the exact extract and catechin detail have already been compared.',
            bullets: [
              'Weight-oriented packaging can travel further than the cleanest extract-specific reading of the label.',
              'The shopper usually gets more comparison value from the exact extract line than from broad metabolic language.',
              'That makes this useful context, but not the main ranking lane.',
            ],
            evidenceRead:
              'This is a real but more interpretation-sensitive lane, so it should be read more cautiously than the tighter catechin-focused context.',
            shopperMeaning:
              'Treat weight- or metabolism-oriented wording as a secondary layer after comparing the exact extract and catechin details on the label.',
          },
          {
            headingId: 'why_extract_concentration_matters',
            heading: 'Why extract concentration matters',
            summary:
              'Extract concentration matters because EGCG- or catechin-heavy labels often give shoppers a much clearer basis for comparison than products that only mention green tea extract in broad category terms.',
            bullets: [
              'Concentration detail often determines how easy one green tea extract product is to compare with another.',
              'A more explicit EGCG or catechin line usually carries more comparison value than broad extract naming alone.',
              'This is best read as a precision and label-reading advantage rather than as automatic proof that a more concentrated product is universally better.',
            ],
            evidenceRead:
              'This is a comparison lane first: concentration detail sharpens interpretation even when it does not settle every efficacy question.',
            shopperMeaning:
              'When comparing green tea extract products, exact concentration detail is often one of the best clues to whether two labels really belong in the same comparison set.',
          },
        ],
        closingNote:
          'Green tea extract is usually most useful to compare through catechin detail and exact extract concentration rather than through broad weight-oriented packaging language.',
      }),
  });

  assert.equal(result.source, 'api');
  assert.equal(result.fallbackUsed, false);
  assert.match(result.scientificBackground.sections[0]?.summary ?? '', /catechin|EGCG|extract-detail/i);
  assert.match(result.scientificBackground.sections[2]?.shopperMeaning ?? '', /concentration detail|comparison set|green tea extract/i);
});

test('dha fallback is clearly differentiated from epa framing', async () => {
  const digest = buildDigest({
    labelId: 'fixture-dha',
    productName: 'Omega-3 1040 mg Fish Oil 1250 mg',
    dosageForm: 'Softgel',
    actives: [
      { name: 'EPA (Eicosapentaenoic Acid)', amount: 690, unit: 'mg' },
      { name: 'DHA (Docosahexaenoic Acid)', amount: 260, unit: 'mg' },
    ],
  });

  const context = buildIngredientScienceContext({ digest, overlayClaims: null });
  const result = await compileScientificBackgroundAsync(context, 'DHA (Docosahexaenoic Acid)');

  assert.match(result.scientificBackground.sections[0]?.summary ?? '', /brain and eye context|brain and eye/i);
  assert.match(result.scientificBackground.sections[2]?.shopperMeaning ?? '', /EPA and DHA should not be treated as interchangeable|same total omega-3/i);
  assert.doesNotMatch(result.scientificBackground.sections[0]?.summary ?? '', /triglyceride and lipid-marker research, which makes this the clearest evidence lane/i);
});

test('epa fallback now uses lipid and triglyceride evidence grounding as the primary omega-3 lane', async () => {
  const digest = buildDigest({
    labelId: 'fixture-epa',
    productName: 'Omega-3 1040 mg Fish Oil 1250 mg',
    dosageForm: 'Softgel',
    actives: [
      { name: 'EPA (Eicosapentaenoic Acid)', amount: 690, unit: 'mg' },
      { name: 'DHA (Docosahexaenoic Acid)', amount: 260, unit: 'mg' },
    ],
  });

  const context = buildIngredientScienceContext({ digest, overlayClaims: null });
  const result = await compileScientificBackgroundAsync(context, 'EPA (Eicosapentaenoic Acid)');

  assert.match(result.scientificBackground.sections[0]?.summary ?? '', /triglyceride|lipid endpoints|comparison lane/i);
  assert.match(result.scientificBackground.sections[0]?.evidenceRead ?? '', /triglyceride|lipid|broader cardiovascular packaging/i);
  assert.match(result.scientificBackground.sections[0]?.shopperMeaning ?? '', /omega-3 comparison anchor|broad heart language/i);
});

test('vitamin c fallback keeps iron context as a specific lane instead of a generic claim', async () => {
  const digest = buildDigest({
    labelId: 'fixture-vitamin-c-quality',
    productName: 'Vitamin C 1000 mg',
    dosageForm: 'Capsule',
    actives: [{ name: 'Vitamin C', amount: 1000, unit: 'mg' }],
  });

  const context = buildIngredientScienceContext({ digest, overlayClaims: null });
  const result = await compileScientificBackgroundAsync(context, 'Vitamin C');

  const ironSection = result.scientificBackground.sections[2];
  assert.match(ironSection?.summary ?? '', /iron co-administration|use-case-specific context/i);
  assert.match(ironSection?.shopperMeaning ?? '', /paired nutrient use|iron context/i);
});

test('omega-3 research mode keeps both EPA and DHA on the targeted live-writer profile', () => {
  const digest = buildDigest({
    labelId: 'fixture-omega3-timeout',
    productName: 'Omega-3 1040 mg Fish Oil 1250 mg',
    dosageForm: 'Softgel',
    actives: [
      { name: 'Fish Oil Concentrate', amount: 1250, unit: 'mg' },
      { name: 'EPA (Eicosapentaenoic Acid)', amount: 690, unit: 'mg' },
      { name: 'DHA (Docosahexaenoic Acid)', amount: 260, unit: 'mg' },
    ],
  });

  const context = buildIngredientScienceContext({ digest, overlayClaims: null });
  const epaPlan = planScientificBackgroundSections({
    context,
    selectedIngredientName: 'EPA (Eicosapentaenoic Acid)',
  });
  const dhaPlan = planScientificBackgroundSections({
    context,
    selectedIngredientName: 'DHA (Docosahexaenoic Acid)',
  });

  const epaProfile = resolveScientificBackgroundExecutionProfile(epaPlan);
  const dhaProfile = resolveScientificBackgroundExecutionProfile(dhaPlan);

  assert.equal(epaPlan.mode, 'research_mode');
  assert.equal(dhaPlan.mode, 'research_mode');
  assert.ok(epaProfile.timeoutMs >= 3_000);
  assert.ok(dhaProfile.timeoutMs >= epaProfile.timeoutMs);
  assert.equal(epaProfile.maxRetries, 0);
  assert.equal(dhaProfile.maxRetries, 0);
  assert.equal(epaProfile.backgroundRefreshMaxRetries, 1);
  assert.equal(dhaProfile.backgroundRefreshMaxRetries, 1);
  assert.ok(epaProfile.backgroundRefreshTimeoutMs > epaProfile.timeoutMs);
  assert.ok(dhaProfile.backgroundRefreshTimeoutMs > dhaProfile.timeoutMs);
});

test('magnesium and vitamin d research mode get longer execution budgets than the generic research profile', () => {
  const digest = buildDigest({
    labelId: 'fixture-mag-vitd-timeout',
    productName: 'Magnesium Glycinate + Vitamin D3',
    dosageForm: 'Capsule',
    actives: [
      { name: 'Magnesium (as Magnesium Glycinate)', amount: 200, unit: 'mg' },
      { name: 'Vitamin D3 (as Cholecalciferol)', amount: 5000, unit: 'IU' },
      { name: 'Vitamin C', amount: 500, unit: 'mg' },
    ],
  });

  const context = buildIngredientScienceContext({ digest, overlayClaims: null });
  const magnesiumPlan = planScientificBackgroundSections({
    context,
    selectedIngredientName: 'Magnesium (as Magnesium Glycinate)',
  });
  const vitaminDPlan = planScientificBackgroundSections({
    context,
    selectedIngredientName: 'Vitamin D3 (as Cholecalciferol)',
  });
  const vitaminCPlan = planScientificBackgroundSections({
    context,
    selectedIngredientName: 'Vitamin C',
  });

  const magnesiumProfile = resolveScientificBackgroundExecutionProfile(magnesiumPlan);
  const vitaminDProfile = resolveScientificBackgroundExecutionProfile(vitaminDPlan);
  const vitaminCProfile = resolveScientificBackgroundExecutionProfile(vitaminCPlan);

  assert.equal(magnesiumPlan.mode, 'research_mode');
  assert.equal(vitaminDPlan.mode, 'research_mode');
  assert.equal(vitaminCPlan.mode, 'research_mode');
  assert.ok(magnesiumProfile.timeoutMs > vitaminCProfile.timeoutMs);
  assert.ok(magnesiumProfile.backgroundRefreshTimeoutMs < vitaminDProfile.backgroundRefreshTimeoutMs);
  assert.equal(magnesiumProfile.backgroundRefreshMaxRetries, 1);
  assert.ok(vitaminDProfile.timeoutMs > vitaminCProfile.timeoutMs);
});

test('calcium, zinc, and iron research mode get dedicated execution budgets', () => {
  const digest = buildDigest({
    labelId: 'fixture-calcium-iron-timeout',
    productName: 'Calcium Citrate with Zinc and Iron',
    dosageForm: 'Capsule',
    actives: [
      { name: 'Calcium (as Calcium Citrate)', amount: 250, unit: 'mg' },
      { name: 'Zinc (as Zinc Chelate)', amount: 30, unit: 'mg' },
      { name: 'Iron (as Ferrous Bisglycinate Chelate)', amount: 18, unit: 'mg' },
      { name: 'Vitamin C', amount: 500, unit: 'mg' },
    ],
  });

  const context = buildIngredientScienceContext({ digest, overlayClaims: null });
  const calciumPlan = planScientificBackgroundSections({
    context,
    selectedIngredientName: 'Calcium (as Calcium Citrate)',
  });
  const ironPlan = planScientificBackgroundSections({
    context,
    selectedIngredientName: 'Iron (as Ferrous Bisglycinate Chelate)',
  });
  const zincPlan = planScientificBackgroundSections({
    context,
    selectedIngredientName: 'Zinc (as Zinc Chelate)',
  });
  const vitaminCPlan = planScientificBackgroundSections({
    context,
    selectedIngredientName: 'Vitamin C',
  });

  const calciumProfile = resolveScientificBackgroundExecutionProfile(calciumPlan);
  const ironProfile = resolveScientificBackgroundExecutionProfile(ironPlan);
  const zincProfile = resolveScientificBackgroundExecutionProfile(zincPlan);
  const vitaminCProfile = resolveScientificBackgroundExecutionProfile(vitaminCPlan);

  assert.equal(calciumPlan.mode, 'research_mode');
  assert.equal(ironPlan.mode, 'research_mode');
  assert.equal(zincPlan.mode, 'research_mode');
  assert.equal(vitaminCPlan.mode, 'research_mode');
  assert.ok(calciumProfile.timeoutMs > vitaminCProfile.timeoutMs);
  assert.ok(zincProfile.timeoutMs > vitaminCProfile.timeoutMs);
  assert.ok(zincProfile.backgroundRefreshTimeoutMs < ironProfile.backgroundRefreshTimeoutMs);
  assert.equal(zincProfile.backgroundRefreshMaxRetries, 1);
  assert.ok(ironProfile.timeoutMs > vitaminCProfile.timeoutMs);
});

test('melatonin and b-vitamin research mode get longer execution budgets than the generic research profile', () => {
  const digest = buildDigest({
    labelId: 'fixture-melatonin-bvit-timeout',
    productName: 'Melatonin with B12, Folate, and B6',
    dosageForm: 'Capsule',
    actives: [
      { name: 'Melatonin', amount: 3, unit: 'mg' },
      { name: 'Vitamin B12 (as Methylcobalamin)', amount: 1000, unit: 'mcg' },
      { name: 'Folate (as 5-MTHF)', amount: 680, unit: 'mcg DFE' },
      { name: 'Vitamin B6 (as Pyridoxal-5-Phosphate)', amount: 25, unit: 'mg' },
      { name: 'Vitamin C', amount: 500, unit: 'mg' },
    ],
  });

  const context = buildIngredientScienceContext({ digest, overlayClaims: null });
  const melatoninPlan = planScientificBackgroundSections({ context, selectedIngredientName: 'Melatonin' });
  const b12Plan = planScientificBackgroundSections({ context, selectedIngredientName: 'Vitamin B12 (as Methylcobalamin)' });
  const folatePlan = planScientificBackgroundSections({ context, selectedIngredientName: 'Folate (as 5-MTHF)' });
  const b6Plan = planScientificBackgroundSections({ context, selectedIngredientName: 'Vitamin B6 (as Pyridoxal-5-Phosphate)' });
  const vitaminCPlan = planScientificBackgroundSections({ context, selectedIngredientName: 'Vitamin C' });

  const melatoninProfile = resolveScientificBackgroundExecutionProfile(melatoninPlan);
  const b12Profile = resolveScientificBackgroundExecutionProfile(b12Plan);
  const folateProfile = resolveScientificBackgroundExecutionProfile(folatePlan);
  const b6Profile = resolveScientificBackgroundExecutionProfile(b6Plan);
  const vitaminCProfile = resolveScientificBackgroundExecutionProfile(vitaminCPlan);

  assert.equal(melatoninPlan.mode, 'research_mode');
  assert.equal(b12Plan.mode, 'research_mode');
  assert.equal(folatePlan.mode, 'research_mode');
  assert.equal(b6Plan.mode, 'research_mode');
  assert.equal(vitaminCPlan.mode, 'research_mode');
  assert.ok(melatoninProfile.backgroundRefreshTimeoutMs > melatoninProfile.timeoutMs);
  assert.ok(b12Profile.backgroundRefreshTimeoutMs > b12Profile.timeoutMs);
  assert.ok(folateProfile.backgroundRefreshTimeoutMs > folateProfile.timeoutMs);
  assert.ok(b6Profile.backgroundRefreshTimeoutMs > b6Profile.timeoutMs);
  assert.equal(vitaminCProfile.maxRetries, 0);
  assert.equal(melatoninProfile.backgroundRefreshMaxRetries, 1);
  assert.equal(b12Profile.backgroundRefreshMaxRetries, 1);
  assert.equal(folateProfile.backgroundRefreshMaxRetries, 1);
  assert.equal(b6Profile.backgroundRefreshMaxRetries, 1);
});

test('botanical families get longer execution budgets than the generic research profile', () => {
  const context = buildIngredientScienceContext({
    digest: buildDigest({
      labelId: 'fixture-botanical-timeout',
      productName: 'Curcumin with Ashwagandha, Ginseng, and Green Tea Extract',
      dosageForm: 'Capsule',
      actives: [
        { name: 'Curcumin C3 Complex', amount: 500, unit: 'mg' },
        { name: 'Ashwagandha (KSM-66)', amount: 300, unit: 'mg' },
        { name: 'Panax Ginseng Extract', amount: 200, unit: 'mg' },
        { name: 'Green Tea Extract (EGCG)', amount: 150, unit: 'mg' },
        { name: 'Vitamin C', amount: 250, unit: 'mg' },
      ],
    }),
    overlayClaims: null,
  });

  const curcuminPlan = planScientificBackgroundSections({ context, selectedIngredientName: 'Curcumin C3 Complex' });
  const ashwagandhaPlan = planScientificBackgroundSections({ context, selectedIngredientName: 'Ashwagandha (KSM-66)' });
  const ginsengPlan = planScientificBackgroundSections({ context, selectedIngredientName: 'Panax Ginseng Extract' });
  const greenTeaPlan = planScientificBackgroundSections({ context, selectedIngredientName: 'Green Tea Extract (EGCG)' });
  const vitaminCPlan = planScientificBackgroundSections({ context, selectedIngredientName: 'Vitamin C' });

  const curcuminProfile = resolveScientificBackgroundExecutionProfile(curcuminPlan);
  const ashwagandhaProfile = resolveScientificBackgroundExecutionProfile(ashwagandhaPlan);
  const ginsengProfile = resolveScientificBackgroundExecutionProfile(ginsengPlan);
  const greenTeaProfile = resolveScientificBackgroundExecutionProfile(greenTeaPlan);
  const vitaminCProfile = resolveScientificBackgroundExecutionProfile(vitaminCPlan);

  assert.equal(curcuminPlan.mode, 'research_mode');
  assert.equal(ashwagandhaPlan.mode, 'research_mode');
  assert.equal(ginsengPlan.mode, 'research_mode');
  assert.equal(greenTeaPlan.mode, 'research_mode');
  assert.ok(curcuminProfile.timeoutMs > vitaminCProfile.timeoutMs);
  assert.ok(ashwagandhaProfile.timeoutMs > vitaminCProfile.timeoutMs);
  assert.ok(ginsengProfile.timeoutMs > vitaminCProfile.timeoutMs);
  assert.ok(greenTeaProfile.timeoutMs > vitaminCProfile.timeoutMs);
});

test('planner assigns dedicated section packs to magnesium, vitamin D, calcium, iron, melatonin, b-vitamin, and expanded ingredient families', () => {
  const magnesiumContext = buildIngredientScienceContext({
    digest: buildDigest({
      labelId: 'fixture-magnesium-glycinate',
      productName: 'Magnesium Glycinate 200 mg',
      dosageForm: 'Capsule',
      actives: [{ name: 'Magnesium (as Magnesium Glycinate)', amount: 200, unit: 'mg' }],
    }),
    overlayClaims: null,
  });
  const vitaminDContext = buildIngredientScienceContext({
    digest: buildDigest({
      labelId: 'fixture-vitamin-d3',
      productName: 'Vitamin D3 5000 IU',
      dosageForm: 'Softgel',
      actives: [{ name: 'Vitamin D3 (as Cholecalciferol)', amount: 5000, unit: 'IU' }],
    }),
    overlayClaims: null,
  });
  const calciumContext = buildIngredientScienceContext({
    digest: buildDigest({
      labelId: 'fixture-calcium-citrate',
      productName: 'Calcium Citrate 250 mg',
      dosageForm: 'Tablet',
      actives: [{ name: 'Calcium (as Calcium Citrate)', amount: 250, unit: 'mg' }],
    }),
    overlayClaims: null,
  });
  const ironContext = buildIngredientScienceContext({
    digest: buildDigest({
      labelId: 'fixture-iron-bisglycinate',
      productName: 'Iron Bisglycinate 18 mg',
      dosageForm: 'Capsule',
      actives: [{ name: 'Iron (as Ferrous Bisglycinate Chelate)', amount: 18, unit: 'mg' }],
    }),
    overlayClaims: null,
  });
  const melatoninContext = buildIngredientScienceContext({
    digest: buildDigest({
      labelId: 'fixture-melatonin',
      productName: 'Melatonin 3 mg',
      dosageForm: 'Tablet',
      actives: [{ name: 'Melatonin', amount: 3, unit: 'mg' }],
    }),
    overlayClaims: null,
  });
  const b12Context = buildIngredientScienceContext({
    digest: buildDigest({
      labelId: 'fixture-b12-pack',
      productName: 'Vitamin B12 1000 mcg',
      dosageForm: 'Tablet',
      actives: [{ name: 'Vitamin B12 (as Methylcobalamin)', amount: 1000, unit: 'mcg' }],
    }),
    overlayClaims: null,
  });
  const folateContext = buildIngredientScienceContext({
    digest: buildDigest({
      labelId: 'fixture-folate-pack',
      productName: 'Folate 680 mcg DFE',
      dosageForm: 'Capsule',
      actives: [{ name: 'Folate (as 5-MTHF)', amount: 680, unit: 'mcg DFE' }],
    }),
    overlayClaims: null,
  });
  const b6Context = buildIngredientScienceContext({
    digest: buildDigest({
      labelId: 'fixture-b6-pack',
      productName: 'Vitamin B6 25 mg',
      dosageForm: 'Capsule',
      actives: [{ name: 'Vitamin B6 (as Pyridoxal-5-Phosphate)', amount: 25, unit: 'mg' }],
    }),
    overlayClaims: null,
  });
  const curcuminContext = buildIngredientScienceContext({
    digest: buildDigest({
      labelId: 'fixture-curcumin-pack',
      productName: 'Curcumin C3 Complex 500 mg',
      dosageForm: 'Capsule',
      actives: [{ name: 'Curcumin C3 Complex', amount: 500, unit: 'mg' }],
    }),
    overlayClaims: null,
  });
  const turmericContext = buildIngredientScienceContext({
    digest: buildDigest({
      labelId: 'fixture-turmeric-pack',
      productName: 'Turmeric Curcuminoid Complex 500 mg',
      dosageForm: 'Capsule',
      actives: [{ name: 'Turmeric Extract (Curcuma longa)', amount: 500, unit: 'mg' }],
    }),
    overlayClaims: null,
  });
  const coq10Context = buildIngredientScienceContext({
    digest: buildDigest({
      labelId: 'fixture-coq10-pack',
      productName: 'CoQ10 Ubiquinol 100 mg',
      dosageForm: 'Softgel',
      actives: [{ name: 'Coenzyme Q10 (Ubiquinol)', amount: 100, unit: 'mg' }],
    }),
    overlayClaims: null,
  });
  const berberineContext = buildIngredientScienceContext({
    digest: buildDigest({
      labelId: 'fixture-berberine-pack',
      productName: 'Berberine HCl 500 mg',
      dosageForm: 'Capsule',
      actives: [{ name: 'Berberine HCl', amount: 500, unit: 'mg' }],
    }),
    overlayClaims: null,
  });
  const nacContext = buildIngredientScienceContext({
    digest: buildDigest({
      labelId: 'fixture-nac-pack',
      productName: 'N-Acetyl-Cysteine 600 mg',
      dosageForm: 'Capsule',
      actives: [{ name: 'N-Acetyl-Cysteine', amount: 600, unit: 'mg' }],
    }),
    overlayClaims: null,
  });
  const collagenContext = buildIngredientScienceContext({
    digest: buildDigest({
      labelId: 'fixture-collagen-pack',
      productName: 'Marine Collagen Peptides 5 g',
      dosageForm: 'Powder',
      actives: [{ name: 'Marine Collagen Peptides', amount: 5, unit: 'g' }],
    }),
    overlayClaims: null,
  });
  const proteinContext = buildIngredientScienceContext({
    digest: buildDigest({
      labelId: 'fixture-protein-pack',
      productName: '100% Whey Protein Powder',
      dosageForm: 'Powder',
      actives: [{ name: 'Whey Protein Isolate', amount: 25, unit: 'g' }],
    }),
    overlayClaims: null,
  });
  const fiberContext = buildIngredientScienceContext({
    digest: buildDigest({
      labelId: 'fixture-fiber-pack',
      productName: 'Apple Fiber Pure Powder',
      dosageForm: 'Powder',
      actives: [{ name: 'Apple Fiber', amount: 5, unit: 'g' }],
    }),
    overlayClaims: null,
  });
  const electrolyteContext = buildIngredientScienceContext({
    digest: buildDigest({
      labelId: 'fixture-electrolyte-pack',
      productName: 'Electrolyte Mineral Stack Capsules',
      dosageForm: 'Capsule',
      actives: [
        { name: 'Potassium', amount: 180, unit: 'mg' },
        { name: 'Magnesium', amount: 80, unit: 'mg' },
        { name: 'Sodium', amount: 120, unit: 'mg' },
      ],
    }),
    overlayClaims: null,
  });
  const ashwagandhaContext = buildIngredientScienceContext({
    digest: buildDigest({
      labelId: 'fixture-ashwagandha-pack',
      productName: 'Ashwagandha KSM-66 300 mg',
      dosageForm: 'Capsule',
      actives: [{ name: 'Ashwagandha (KSM-66)', amount: 300, unit: 'mg' }],
    }),
    overlayClaims: null,
  });
  const ginsengContext = buildIngredientScienceContext({
    digest: buildDigest({
      labelId: 'fixture-ginseng-pack',
      productName: 'Panax Ginseng Extract 200 mg',
      dosageForm: 'Capsule',
      actives: [{ name: 'Panax Ginseng Extract', amount: 200, unit: 'mg' }],
    }),
    overlayClaims: null,
  });
  const greenTeaContext = buildIngredientScienceContext({
    digest: buildDigest({
      labelId: 'fixture-green-tea-pack',
      productName: 'Green Tea Extract 400 mg',
      dosageForm: 'Capsule',
      actives: [{ name: 'Green Tea Extract (EGCG)', amount: 400, unit: 'mg' }],
    }),
    overlayClaims: null,
  });

  assert.deepEqual(
    planScientificBackgroundSections({ context: magnesiumContext, selectedIngredientName: 'Magnesium (as Magnesium Glycinate)' }).sections.map((section) => section.heading),
    ['Common use contexts', 'Form and tolerability context', 'What product comparison depends on'],
  );
  assert.deepEqual(
    planScientificBackgroundSections({ context: vitaminDContext, selectedIngredientName: 'Vitamin D3 (as Cholecalciferol)' }).sections.map((section) => section.heading),
    ['Bone and calcium regulation context', 'Immune and broader health research', 'What interpretation depends on'],
  );
  assert.deepEqual(
    planScientificBackgroundSections({ context: calciumContext, selectedIngredientName: 'Calcium (as Calcium Citrate)' }).sections.map((section) => section.heading),
    ['Bone and intake context', 'Form and absorption context', 'How co-formulation changes comparison'],
  );
  assert.deepEqual(
    planScientificBackgroundSections({ context: ironContext, selectedIngredientName: 'Iron (as Ferrous Bisglycinate Chelate)' }).sections.map((section) => section.heading),
    ['Iron status and deficiency context', 'Form and tolerability context', 'What product comparison depends on'],
  );
  assert.deepEqual(
    planScientificBackgroundSections({ context: melatoninContext, selectedIngredientName: 'Melatonin' }).sections.map((section) => section.heading),
    ['Sleep timing and onset context', 'What dose and use-context can change'],
  );
  assert.deepEqual(
    planScientificBackgroundSections({ context: b12Context, selectedIngredientName: 'Vitamin B12 (as Methylcobalamin)' }).sections.map((section) => section.heading),
    ['Deficiency and supplementation context', 'Nerve and blood-cell context', 'What form disclosure changes'],
  );
  assert.deepEqual(
    planScientificBackgroundSections({ context: folateContext, selectedIngredientName: 'Folate (as 5-MTHF)' }).sections.map((section) => section.heading),
    ['Folate status and supplementation context', 'Pregnancy and developmental context', 'What form labeling changes'],
  );
  assert.deepEqual(
    planScientificBackgroundSections({ context: b6Context, selectedIngredientName: 'Vitamin B6 (as Pyridoxal-5-Phosphate)' }).sections.map((section) => section.heading),
    ['Cofactor and metabolism context', 'Nerve-related interpretation', 'Why dose context matters'],
  );
  assert.deepEqual(
    planScientificBackgroundSections({ context: curcuminContext, selectedIngredientName: 'Curcumin C3 Complex' }).sections.map((section) => section.heading),
    ['Most studied outcomes', 'Why extract detail matters', 'Where evidence remains mixed'],
  );
  assert.deepEqual(
    planScientificBackgroundSections({ context: turmericContext, selectedIngredientName: 'Turmeric Extract (Curcuma longa)' }).sections.map((section) => section.heading),
    ['Turmeric traditional and modern context', 'Extract and curcuminoid detail', 'Where turmeric and curcumin diverge'],
  );
  assert.deepEqual(
    planScientificBackgroundSections({ context: coq10Context, selectedIngredientName: 'Coenzyme Q10 (Ubiquinol)' }).sections.map((section) => section.heading),
    ['Energy metabolism context', 'Heart-related context', 'What form disclosure changes'],
  );
  assert.deepEqual(
    planScientificBackgroundSections({ context: berberineContext, selectedIngredientName: 'Berberine HCl' }).sections.map((section) => section.heading),
    ['Glucose-metabolic context', 'Lipid-related context', 'Dose and extract context'],
  );
  assert.deepEqual(
    planScientificBackgroundSections({ context: nacContext, selectedIngredientName: 'N-Acetyl-Cysteine' }).sections.map((section) => section.heading),
    ['Glutathione precursor context', 'Respiratory and mucus context', 'What dose and use-context can change'],
  );
  assert.deepEqual(
    planScientificBackgroundSections({ context: collagenContext, selectedIngredientName: 'Marine Collagen Peptides' }).sections.map((section) => section.heading),
    ['Skin and connective-tissue context', 'Joint and structure context', 'Source and type context'],
  );
  assert.deepEqual(
    planScientificBackgroundSections({ context: proteinContext, selectedIngredientName: 'Whey Protein Isolate' }).sections.map((section) => section.heading),
    ['Muscle and recovery context', 'Satiety and meal-support context', 'Protein type and disclosure context'],
  );
  assert.deepEqual(
    planScientificBackgroundSections({ context: fiberContext, selectedIngredientName: 'Apple Fiber' }).sections.map((section) => section.heading),
    ['Digestive regularity context', 'Satiety and gut context', 'Source and solubility context'],
  );
  assert.deepEqual(
    planScientificBackgroundSections({ context: electrolyteContext, selectedIngredientName: 'Electrolyte Mineral Stack' }).sections.map((section) => section.heading),
    ['Hydration context', 'Exercise and sweat-loss context', 'Balance and disclosure context'],
  );
  assert.deepEqual(
    planScientificBackgroundSections({ context: ashwagandhaContext, selectedIngredientName: 'Ashwagandha (KSM-66)' }).sections.map((section) => section.heading),
    ['Stress and mood-related research', 'Sleep and recovery context', 'Why extract identity matters'],
  );
  assert.deepEqual(
    planScientificBackgroundSections({ context: ginsengContext, selectedIngredientName: 'Panax Ginseng Extract' }).sections.map((section) => section.heading),
    ['Energy and fatigue context', 'Cognitive and performance interpretation', 'Why species and extract detail matter'],
  );
  assert.deepEqual(
    planScientificBackgroundSections({ context: greenTeaContext, selectedIngredientName: 'Green Tea Extract (EGCG)' }).sections.map((section) => section.heading),
    ['Catechin and antioxidant context', 'Metabolic and weight-related interpretation', 'Why extract concentration matters'],
  );
});

test('new family fallbacks stay specific and do not collapse back to generic prose', async () => {
  const magnesiumContext = buildIngredientScienceContext({
    digest: buildDigest({
      labelId: 'fixture-magnesium-fallback',
      productName: 'Magnesium Glycinate 200 mg',
      dosageForm: 'Capsule',
      actives: [{ name: 'Magnesium (as Magnesium Glycinate)', amount: 200, unit: 'mg' }],
    }),
    overlayClaims: null,
  });
  const vitaminDContext = buildIngredientScienceContext({
    digest: buildDigest({
      labelId: 'fixture-vitamin-d-fallback',
      productName: 'Vitamin D3 5000 IU',
      dosageForm: 'Softgel',
      actives: [{ name: 'Vitamin D3 (as Cholecalciferol)', amount: 5000, unit: 'IU' }],
    }),
    overlayClaims: null,
  });
  const calciumContext = buildIngredientScienceContext({
    digest: buildDigest({
      labelId: 'fixture-calcium-fallback',
      productName: 'Calcium Citrate 250 mg',
      dosageForm: 'Tablet',
      actives: [{ name: 'Calcium (as Calcium Citrate)', amount: 250, unit: 'mg' }],
    }),
    overlayClaims: null,
  });
  const zincContext = buildIngredientScienceContext({
    digest: buildDigest({
      labelId: 'fixture-zinc-fallback',
      productName: 'Zinc Picolinate 15 mg',
      dosageForm: 'Capsule',
      actives: [{ name: 'Zinc (as Zinc Picolinate)', amount: 15, unit: 'mg' }],
    }),
    overlayClaims: null,
  });
  const ironContext = buildIngredientScienceContext({
    digest: buildDigest({
      labelId: 'fixture-iron-fallback',
      productName: 'Iron Bisglycinate 18 mg',
      dosageForm: 'Capsule',
      actives: [{ name: 'Iron (as Ferrous Bisglycinate Chelate)', amount: 18, unit: 'mg' }],
    }),
    overlayClaims: null,
  });
  const melatoninContext = buildIngredientScienceContext({
    digest: buildDigest({
      labelId: 'fixture-melatonin-fallback',
      productName: 'Melatonin 3 mg',
      dosageForm: 'Tablet',
      actives: [{ name: 'Melatonin', amount: 3, unit: 'mg' }],
    }),
    overlayClaims: null,
  });
  const b12Context = buildIngredientScienceContext({
    digest: buildDigest({
      labelId: 'fixture-b12-fallback',
      productName: 'Vitamin B12 1000 mcg',
      dosageForm: 'Tablet',
      actives: [{ name: 'Vitamin B12 (as Methylcobalamin)', amount: 1000, unit: 'mcg' }],
    }),
    overlayClaims: null,
  });
  const folateContext = buildIngredientScienceContext({
    digest: buildDigest({
      labelId: 'fixture-folate-fallback',
      productName: 'Folate 680 mcg DFE',
      dosageForm: 'Capsule',
      actives: [{ name: 'Folate (as 5-MTHF)', amount: 680, unit: 'mcg DFE' }],
    }),
    overlayClaims: null,
  });
  const b6Context = buildIngredientScienceContext({
    digest: buildDigest({
      labelId: 'fixture-b6-fallback',
      productName: 'Vitamin B6 25 mg',
      dosageForm: 'Capsule',
      actives: [{ name: 'Vitamin B6 (as Pyridoxal-5-Phosphate)', amount: 25, unit: 'mg' }],
    }),
    overlayClaims: null,
  });
  const curcuminContext = buildIngredientScienceContext({
    digest: buildDigest({
      labelId: 'fixture-curcumin-fallback',
      productName: 'Curcumin C3 Complex 500 mg',
      dosageForm: 'Capsule',
      actives: [{ name: 'Curcumin C3 Complex', amount: 500, unit: 'mg' }],
    }),
    overlayClaims: null,
  });
  const turmericContext = buildIngredientScienceContext({
    digest: buildDigest({
      labelId: 'fixture-turmeric-fallback',
      productName: 'Turmeric Curcuminoid Complex 500 mg',
      dosageForm: 'Capsule',
      actives: [{ name: 'Turmeric Extract (Curcuma longa)', amount: 500, unit: 'mg' }],
    }),
    overlayClaims: null,
  });
  const coq10Context = buildIngredientScienceContext({
    digest: buildDigest({
      labelId: 'fixture-coq10-fallback',
      productName: 'CoQ10 Ubiquinol 100 mg',
      dosageForm: 'Softgel',
      actives: [{ name: 'Coenzyme Q10 (Ubiquinol)', amount: 100, unit: 'mg' }],
    }),
    overlayClaims: null,
  });
  const berberineContext = buildIngredientScienceContext({
    digest: buildDigest({
      labelId: 'fixture-berberine-fallback',
      productName: 'Berberine HCl 500 mg',
      dosageForm: 'Capsule',
      actives: [{ name: 'Berberine HCl', amount: 500, unit: 'mg' }],
    }),
    overlayClaims: null,
  });
  const nacContext = buildIngredientScienceContext({
    digest: buildDigest({
      labelId: 'fixture-nac-fallback',
      productName: 'N-Acetyl-Cysteine 600 mg',
      dosageForm: 'Capsule',
      actives: [{ name: 'N-Acetyl-Cysteine', amount: 600, unit: 'mg' }],
    }),
    overlayClaims: null,
  });
  const collagenContext = buildIngredientScienceContext({
    digest: buildDigest({
      labelId: 'fixture-collagen-fallback',
      productName: 'Marine Collagen Peptides 5 g',
      dosageForm: 'Powder',
      actives: [{ name: 'Marine Collagen Peptides', amount: 5, unit: 'g' }],
    }),
    overlayClaims: null,
  });
  const proteinContext = buildIngredientScienceContext({
    digest: buildDigest({
      labelId: 'fixture-protein-fallback',
      productName: '100% Whey Protein Powder',
      dosageForm: 'Powder',
      actives: [{ name: 'Whey Protein Isolate', amount: 25, unit: 'g' }],
    }),
    overlayClaims: null,
  });
  const fiberContext = buildIngredientScienceContext({
    digest: buildDigest({
      labelId: 'fixture-fiber-fallback',
      productName: 'Apple Fiber Pure Powder',
      dosageForm: 'Powder',
      actives: [{ name: 'Apple Fiber', amount: 5, unit: 'g' }],
    }),
    overlayClaims: null,
  });
  const electrolyteContext = buildIngredientScienceContext({
    digest: buildDigest({
      labelId: 'fixture-electrolyte-fallback',
      productName: 'Electrolyte Mineral Stack Capsules',
      dosageForm: 'Capsule',
      actives: [
        { name: 'Potassium', amount: 180, unit: 'mg' },
        { name: 'Magnesium', amount: 80, unit: 'mg' },
        { name: 'Sodium', amount: 120, unit: 'mg' },
      ],
    }),
    overlayClaims: null,
  });
  const ashwagandhaContext = buildIngredientScienceContext({
    digest: buildDigest({
      labelId: 'fixture-ashwagandha-fallback',
      productName: 'Ashwagandha KSM-66 300 mg',
      dosageForm: 'Capsule',
      actives: [{ name: 'Ashwagandha (KSM-66)', amount: 300, unit: 'mg' }],
    }),
    overlayClaims: null,
  });
  const ginsengContext = buildIngredientScienceContext({
    digest: buildDigest({
      labelId: 'fixture-ginseng-fallback',
      productName: 'Panax Ginseng Extract 200 mg',
      dosageForm: 'Capsule',
      actives: [{ name: 'Panax Ginseng Extract', amount: 200, unit: 'mg' }],
    }),
    overlayClaims: null,
  });
  const greenTeaContext = buildIngredientScienceContext({
    digest: buildDigest({
      labelId: 'fixture-green-tea-fallback',
      productName: 'Green Tea Extract 400 mg',
      dosageForm: 'Capsule',
      actives: [{ name: 'Green Tea Extract (EGCG)', amount: 400, unit: 'mg' }],
    }),
    overlayClaims: null,
  });

  const magnesiumResult = await compileScientificBackgroundAsync(magnesiumContext, 'Magnesium (as Magnesium Glycinate)');
  const vitaminDResult = await compileScientificBackgroundAsync(vitaminDContext, 'Vitamin D3 (as Cholecalciferol)');
  const calciumResult = await compileScientificBackgroundAsync(calciumContext, 'Calcium (as Calcium Citrate)');
  const zincResult = await compileScientificBackgroundAsync(zincContext, 'Zinc (as Zinc Picolinate)');
  const ironResult = await compileScientificBackgroundAsync(ironContext, 'Iron (as Ferrous Bisglycinate Chelate)');
  const melatoninResult = await compileScientificBackgroundAsync(melatoninContext, 'Melatonin');
  const b12Result = await compileScientificBackgroundAsync(b12Context, 'Vitamin B12 (as Methylcobalamin)');
  const folateResult = await compileScientificBackgroundAsync(folateContext, 'Folate (as 5-MTHF)');
  const b6Result = await compileScientificBackgroundAsync(b6Context, 'Vitamin B6 (as Pyridoxal-5-Phosphate)');
  const curcuminResult = await compileScientificBackgroundAsync(curcuminContext, 'Curcumin C3 Complex');
  const turmericResult = await compileScientificBackgroundAsync(turmericContext, 'Turmeric Extract (Curcuma longa)');
  const coq10Result = await compileScientificBackgroundAsync(coq10Context, 'Coenzyme Q10 (Ubiquinol)');
  const berberineResult = await compileScientificBackgroundAsync(berberineContext, 'Berberine HCl');
  const nacResult = await compileScientificBackgroundAsync(nacContext, 'N-Acetyl-Cysteine');
  const collagenResult = await compileScientificBackgroundAsync(collagenContext, 'Marine Collagen Peptides');
  const proteinResult = await compileScientificBackgroundAsync(proteinContext, 'Whey Protein Isolate');
  const fiberResult = await compileScientificBackgroundAsync(fiberContext, 'Apple Fiber');
  const electrolyteResult = await compileScientificBackgroundAsync(electrolyteContext, 'Electrolyte Mineral Stack');
  const ashwagandhaResult = await compileScientificBackgroundAsync(ashwagandhaContext, 'Ashwagandha (KSM-66)');
  const ginsengResult = await compileScientificBackgroundAsync(ginsengContext, 'Panax Ginseng Extract');
  const greenTeaResult = await compileScientificBackgroundAsync(greenTeaContext, 'Green Tea Extract (EGCG)');

  assert.match(magnesiumResult.scientificBackground.sections[1]?.summary ?? '', /citrate|oxide|form-level comparison/i);
  assert.match(magnesiumResult.scientificBackground.sections[2]?.shopperMeaning ?? '', /form|magnesium amount|comparison set/i);
  assert.match(vitaminDResult.scientificBackground.sections[0]?.summary ?? '', /bone and calcium-regulation|vitamin d positioning/i);
  assert.match(vitaminDResult.scientificBackground.sections[1]?.summary ?? '', /immune|broader health|bone-and-calcium lane/i);
  assert.match(calciumResult.scientificBackground.sections[1]?.summary ?? '', /citrate-versus-carbonate|bioavailability literature|calcium form comparison/i);
  assert.match(calciumResult.scientificBackground.sections[2]?.shopperMeaning ?? '', /vitamin D|broader formula|direct substitutes|lead story/i);
  assert.match(zincResult.scientificBackground.sections[0]?.summary ?? '', /immune-function context|zinc lane|immune-everything/i);
  assert.match(zincResult.scientificBackground.sections[1]?.summary ?? '', /skin and barrier|second lane|dermatology|beauty/i);
  assert.match(ironResult.scientificBackground.sections[0]?.summary ?? '', /supplementation and status-related lens|iron products/i);
  assert.match(ironResult.scientificBackground.sections[1]?.summary ?? '', /bisglycinate|sulfate|form-aware/i);
  assert.match(ironResult.scientificBackground.sections[2]?.shopperMeaning ?? '', /elemental iron amount|single-form iron|broader blend/i);
  assert.equal(melatoninResult.scientificBackground.sections.length, 2);
  assert.match(melatoninResult.scientificBackground.sections[0]?.summary ?? '', /sleep timing and onset|circadian timing/i);
  assert.match(melatoninResult.scientificBackground.sections[1]?.summary ?? '', /dose, timing, and use context|shopper needs|similar-looking products/i);
  assert.match(b12Result.scientificBackground.sections[0]?.summary ?? '', /supplementation and status-related|b12 products/i);
  assert.match(b12Result.scientificBackground.sections[1]?.summary ?? '', /nerve|red-blood-cell|broader energy language/i);
  assert.match(b12Result.scientificBackground.sections[2]?.shopperMeaning ?? '', /form|comparison bucket|stated amount/i);
  assert.match(
    folateResult.scientificBackground.sections[1]?.summary ?? '',
    /pregnancy|neural-tube-defect|generic B-vitamin/i,
  );
  assert.match(folateResult.scientificBackground.sections[2]?.shopperMeaning ?? '', /folic acid|5-MTHF|folate disclosure|comparison/i);
  assert.match(b6Result.scientificBackground.sections[0]?.summary ?? '', /cofactor and metabolism|broader energy-style/i);
  assert.match(b6Result.scientificBackground.sections[2]?.shopperMeaning ?? '', /dose|formula role|comparison bucket/i);
  assert.match(curcuminResult.scientificBackground.sections[1]?.summary ?? '', /extract|curcuminoid|standardized/i);
  assert.match(curcuminResult.scientificBackground.sections[2]?.shopperMeaning ?? '', /extract detail|broadest promise|package/i);
  assert.match(turmericResult.scientificBackground.sections[0]?.summary ?? '', /turmeric|whole-root|broader/i);
  assert.match(turmericResult.scientificBackground.sections[1]?.summary ?? '', /extract|curcuminoid|standardization/i);
  assert.match(turmericResult.scientificBackground.sections[2]?.shopperMeaning ?? '', /formula map|lead active|companion|curcumin|interchangeable|extracts/i);
  assert.match(coq10Result.scientificBackground.sections[0]?.summary ?? '', /energy|coq10|coenzyme q10|mitochond/i);
  assert.match(coq10Result.scientificBackground.sections[2]?.shopperMeaning ?? '', /ubiquinol|ubiquinone|form|comparison/i);
  assert.match(berberineResult.scientificBackground.sections[0]?.summary ?? '', /glucose|metabolic|berberine/i);
  assert.match(berberineResult.scientificBackground.sections[2]?.shopperMeaning ?? '', /dose|berberine|combo|label/i);
  assert.match(nacResult.scientificBackground.sections[0]?.summary ?? '', /glutathione|precursor|nac/i);
  assert.match(nacResult.scientificBackground.sections[2]?.shopperMeaning ?? '', /dose|use context|comparison|label/i);
  assert.match(collagenResult.scientificBackground.sections[0]?.summary ?? '', /collagen|connective|skin/i);
  assert.match(collagenResult.scientificBackground.sections[2]?.shopperMeaning ?? '', /source|type|collagen|comparison/i);
  assert.match(proteinResult.scientificBackground.sections[0]?.summary ?? '', /protein|muscle|recovery/i);
  assert.match(proteinResult.scientificBackground.sections[1]?.summary ?? '', /satiety|meal-support|broader/i);
  assert.match(proteinResult.scientificBackground.sections[2]?.shopperMeaning ?? '', /source|blend|grams|protein|comparison/i);
  assert.match(fiberResult.scientificBackground.sections[0]?.summary ?? '', /fiber|digestive|regularity/i);
  assert.match(fiberResult.scientificBackground.sections[1]?.summary ?? '', /satiety|gut-environment|fiber type/i);
  assert.match(fiberResult.scientificBackground.sections[2]?.shopperMeaning ?? '', /fiber|source|solubility|comparison/i);
  assert.match(electrolyteResult.scientificBackground.sections[0]?.summary ?? '', /hydration|electrolyte/i);
  assert.match(electrolyteResult.scientificBackground.sections[2]?.shopperMeaning ?? '', /electrolyte|balance|carbohydrate|comparison/i);
  assert.match(ashwagandhaResult.scientificBackground.sections[0]?.summary ?? '', /stress|mood|resilience/i);
  assert.match(ashwagandhaResult.scientificBackground.sections[2]?.shopperMeaning ?? '', /extract identity|comparison set|ashwagandha/i);
  assert.match(ginsengResult.scientificBackground.sections[0]?.summary ?? '', /energy|fatigue|ginseng/i);
  assert.match(ginsengResult.scientificBackground.sections[2]?.shopperMeaning ?? '', /species|extract|ginseng alone|head to head/i);
  assert.match(greenTeaResult.scientificBackground.sections[0]?.summary ?? '', /catechin|EGCG|green tea extract/i);
  assert.match(greenTeaResult.scientificBackground.sections[2]?.shopperMeaning ?? '', /concentration detail|comparison set|green tea extract/i);
});

test('electrolyte drink mixes use family-specific label-context sections instead of the generic label-context fallback', async () => {
  const context = buildIngredientScienceContext({
    digest: buildDigest({
      labelId: 'fixture-electrolyte-drink-mix-sidecar',
      productName: 'HydrationUP Electrolyte Drink Mix',
      dosageForm: 'Powder',
      actives: [
        { name: 'Vitamin C', amount: 200, unit: 'mg' },
        { name: 'Magnesium', amount: 40, unit: 'mg' },
        { name: 'Potassium', amount: 180, unit: 'mg' },
      ],
    }),
    overlayClaims: null,
  });

  const plan = planScientificBackgroundSections({
    context,
    selectedIngredientName: 'HydrationUP',
  });
  const result = await compileScientificBackgroundAsync(context, 'HydrationUP');

  assert.equal(plan.mode, 'label_context_mode');
  assert.deepEqual(
    plan.sections.map((section) => section.heading),
    ['What this hydration line means on the label', 'Why balance and disclosure still matter'],
  );
  assert.match(result.scientificBackground.sections[0]?.summary ?? '', /hydration|formula identity|electrolyte/i);
  assert.match(result.scientificBackground.sections[1]?.shopperMeaning ?? '', /hydration line|balance|electrolyte|compare/i);
});

test('magnesium complex uses label-context mode instead of pretending to be a single clean research row', () => {
  const digest = buildDigest({
    labelId: 'fixture-magnesium-complex',
    productName: 'Magnesium Complex',
    dosageForm: 'Capsule',
    actives: [{ name: 'Magnesium Complex', amount: 300, unit: 'mg' }],
  });

  const context = buildIngredientScienceContext({ digest, overlayClaims: null });
  const plan = planScientificBackgroundSections({
    context,
    selectedIngredientName: 'Magnesium Complex',
  });

  assert.equal(plan.mode, 'label_context_mode');
  assert.deepEqual(
    plan.sections.map((section) => section.heading),
    ['What this line means on the label', 'Why it matters for comparison'],
  );
});

test('7-keto, cla, and carnitine get family-specific research plans and longer budgets than generic research mode', () => {
  const context = buildIngredientScienceContext({
    digest: buildDigest({
      labelId: 'fixture-7keto-cla-carnitine',
      productName: '7-Keto CLA Carnitine Formula',
      dosageForm: 'Capsule',
      actives: [
        { name: '7-Keto (DHEA Acetate-7-one)', amount: 100, unit: 'mg' },
        { name: 'Conjugated Linoleic Acid (CLA) (from Safflower Oil)', amount: 800, unit: 'mg' },
        { name: 'Acetyl-L-Carnitine HCl', amount: 500, unit: 'mg' },
        { name: 'Vitamin C', amount: 250, unit: 'mg' },
      ],
    }),
    overlayClaims: null,
  });

  const sevenKetoPlan = planScientificBackgroundSections({ context, selectedIngredientName: '7-Keto (DHEA Acetate-7-one)' });
  const claPlan = planScientificBackgroundSections({ context, selectedIngredientName: 'Conjugated Linoleic Acid (CLA) (from Safflower Oil)' });
  const carnitinePlan = planScientificBackgroundSections({ context, selectedIngredientName: 'Acetyl-L-Carnitine HCl' });
  const vitaminCPlan = planScientificBackgroundSections({ context, selectedIngredientName: 'Vitamin C' });

  const sevenKetoProfile = resolveScientificBackgroundExecutionProfile(sevenKetoPlan);
  const claProfile = resolveScientificBackgroundExecutionProfile(claPlan);
  const carnitineProfile = resolveScientificBackgroundExecutionProfile(carnitinePlan);
  const vitaminCProfile = resolveScientificBackgroundExecutionProfile(vitaminCPlan);

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
  assert.ok(sevenKetoProfile.timeoutMs > vitaminCProfile.timeoutMs);
  assert.ok(claProfile.timeoutMs > vitaminCProfile.timeoutMs);
  assert.ok(carnitineProfile.timeoutMs > vitaminCProfile.timeoutMs);
  assert.equal(sevenKetoProfile.maxRetries, 0);
  assert.equal(claProfile.maxRetries, 0);
  assert.equal(carnitineProfile.maxRetries, 0);
  assert.equal(sevenKetoProfile.backgroundRefreshMaxRetries, 1);
  assert.equal(claProfile.backgroundRefreshMaxRetries, 1);
  assert.equal(carnitineProfile.backgroundRefreshMaxRetries, 1);
  assert.ok(sevenKetoProfile.backgroundRefreshTimeoutMs >= sevenKetoProfile.timeoutMs);
  assert.ok(claProfile.backgroundRefreshTimeoutMs >= claProfile.timeoutMs);
  assert.ok(carnitineProfile.backgroundRefreshTimeoutMs >= carnitineProfile.timeoutMs);
});

test('5-htp, green tea extract, and omega-3 now use target-family live-writer profiles instead of the generic budget', () => {
  const context = buildIngredientScienceContext({
    digest: buildDigest({
      labelId: 'fixture-5htp-green-tea-omega3-profiles',
      productName: '5-HTP Green Tea and Omega-3 Formula',
      dosageForm: 'Softgel',
      actives: [
        { name: '5-HTP (5-hydroxytryptophan)', amount: 200, unit: 'mg' },
        { name: 'Green Tea Extract (Camellia sinensis) (Leaf)', amount: 250, unit: 'mg' },
        { name: 'EPA (Eicosapentaenoic Acid)', amount: 690, unit: 'mg' },
        { name: 'DHA (Docosahexaenoic Acid)', amount: 260, unit: 'mg' },
        { name: 'Vitamin C', amount: 250, unit: 'mg' },
      ],
    }),
    overlayClaims: null,
  });

  const htpPlan = planScientificBackgroundSections({ context, selectedIngredientName: '5-HTP (5-hydroxytryptophan)' });
  const greenTeaPlan = planScientificBackgroundSections({ context, selectedIngredientName: 'Green Tea Extract (Camellia sinensis) (Leaf)' });
  const epaPlan = planScientificBackgroundSections({ context, selectedIngredientName: 'EPA (Eicosapentaenoic Acid)' });
  const vitaminCPlan = planScientificBackgroundSections({ context, selectedIngredientName: 'Vitamin C' });

  const htpProfile = resolveScientificBackgroundExecutionProfile(htpPlan);
  const greenTeaProfile = resolveScientificBackgroundExecutionProfile(greenTeaPlan);
  const epaProfile = resolveScientificBackgroundExecutionProfile(epaPlan);
  const vitaminCProfile = resolveScientificBackgroundExecutionProfile(vitaminCPlan);

  assert.ok(htpProfile.timeoutMs > vitaminCProfile.timeoutMs);
  assert.ok(greenTeaProfile.timeoutMs > vitaminCProfile.timeoutMs);
  assert.ok(epaProfile.timeoutMs > vitaminCProfile.timeoutMs);
  assert.equal(htpProfile.maxRetries, 0);
  assert.equal(greenTeaProfile.maxRetries, 0);
  assert.equal(epaProfile.maxRetries, 0);
  assert.equal(htpProfile.backgroundRefreshMaxRetries, 1);
  assert.equal(greenTeaProfile.backgroundRefreshMaxRetries, 1);
  assert.equal(epaProfile.backgroundRefreshMaxRetries, 1);
  assert.ok(htpProfile.timeoutMs >= 3_500);
  assert.ok(greenTeaProfile.timeoutMs >= 3_600);
  assert.ok(epaProfile.timeoutMs >= 3_800);
  assert.ok(htpProfile.maxTokens < vitaminCProfile.maxTokens);
  assert.ok(greenTeaProfile.maxTokens < vitaminCProfile.maxTokens);
  assert.ok(epaProfile.maxTokens < vitaminCProfile.maxTokens);
});

test('functional food-like generic rows downgrade scientific background to label-context mode', () => {
  const context = buildIngredientScienceContext({
    digest: buildDigest({
      labelId: 'fixture-functional-food-like-gum',
      productName: 'Xylitol Gum, Green Tea, 100 Pieces',
      dosageForm: 'Gum',
      actives: [{ name: 'Xylitol', amount: 1000, unit: 'mg' }],
    }),
    overlayClaims: null,
  });

  const plan = planScientificBackgroundSections({
    context,
    selectedIngredientName: 'Xylitol',
  });
  const profile = resolveScientificBackgroundExecutionProfile(plan);

  assert.equal(context.productArchetype, 'functional_food_like');
  assert.equal(plan.mode, 'label_context_mode');
  assert.deepEqual(
    plan.sections.map((section) => section.heading),
    ['What this line means on the label', 'Why it matters for comparison'],
  );
  assert.equal(profile.preferLiveWriter, false);
});

test('science context reorders supporting vitamins behind 5-HTP lead actives', () => {
  const context = buildIngredientScienceContext({
    digest: buildDigest({
      labelId: 'fixture-5htp-with-supporting-vitamins',
      productName: '5-HTP with Vitamin B6 & Vitamin C',
      dosageForm: 'Capsule',
      actives: [
        { name: 'Vitamin C (as Ascorbic Acid)', amount: 100, unit: 'mg' },
        { name: 'Vitamin B-6 (from Pyridoxine HCl)', amount: 2, unit: 'mg' },
        { name: '5-HTP (5-hydroxytryptophan)', amount: 200, unit: 'mg' },
      ],
    }),
    overlayClaims: null,
  });

  assert.match(context.ingredientRows[0]?.name ?? '', /5-HTP/i);
  assert.match(context.anchorIngredient?.name ?? '', /5-HTP/i);
  assert.equal(context.anchorIngredient?.ingredientFamily, '5htp');
});

test('mineral-stack products prioritize magnesium and zinc over vitamin D or high-dose calcium noise', () => {
  const context = buildIngredientScienceContext({
    digest: buildDigest({
      labelId: 'fixture-mineral-stack-d3',
      productName: 'Calcium Magnesium Zinc + D3',
      dosageForm: 'Tablet',
      actives: [
        { name: 'Vitamin D3 (as Cholecalciferol)', amount: 25, unit: 'mcg' },
        { name: 'Calcium (as Calcium Carbonate)', amount: 1000, unit: 'mg' },
        { name: 'Magnesium (as Magnesium Oxide)', amount: 400, unit: 'mg' },
        { name: 'Zinc (as Zinc Oxide)', amount: 15, unit: 'mg' },
      ],
    }),
    overlayClaims: null,
  });

  assert.doesNotMatch(context.ingredientRows[0]?.name ?? '', /vitamin d/i);
  assert.match(context.ingredientRows[0]?.name ?? '', /magnesium/i);
  assert.equal(context.anchorIngredient?.ingredientFamily, 'magnesium');
});

test('food-like green tea products downgrade to label-context mode instead of research mode', () => {
  const context = buildIngredientScienceContext({
    digest: buildDigest({
      labelId: 'fixture-food-like-green-tea',
      productName: 'Herbal Slimming Tea, Green Tea, 24 Tea Bags',
      dosageForm: 'Tea',
      actives: [{ name: 'Green Tea Extract', amount: 500, unit: 'mg' }],
    }),
    overlayClaims: null,
  });

  const plan = planScientificBackgroundSections({
    context,
    selectedIngredientName: 'Green Tea Extract',
  });

  assert.equal(context.productArchetype, 'functional_food_like');
  assert.equal(plan.mode, 'label_context_mode');
  assert.deepEqual(
    plan.sections.map((section) => section.heading),
    ['What this line means on the label', 'Why it matters for comparison'],
  );
});

test('greens-style formulas avoid enzyme support lines as the default science ingredient', () => {
  const context = buildIngredientScienceContext({
    digest: buildDigest({
      labelId: 'fixture-greens-enzyme-ranking',
      productName: 'CytoGreens Premium Green Superfood with Green Tea',
      dosageForm: 'Powder',
      actives: [
        { name: 'Cytozymes Digestive Enzyme Assimilation', amount: 100, unit: 'mg' },
        { name: 'Green Tea Extract', amount: 75, unit: 'mg' },
        { name: 'Spirulina', amount: 500, unit: 'mg' },
      ],
    }),
    overlayClaims: null,
  });

  assert.doesNotMatch(context.ingredientRows[0]?.name ?? '', /cytozymes|digestive enzyme/i);
});

test('title rescue rows recover higher-value science anchors for CLA, tea bags, probiotics, and mineral stacks', () => {
  const claContext = buildIngredientScienceContext({
    digest: buildDigest({
      labelId: 'fixture-cla95-title-rescue',
      productName: 'ALLMAX, Essentials, CLA95™, 30 Softgels',
      dosageForm: 'Softgel',
      actives: [],
    }),
    overlayClaims: null,
  });
  const teaContext = buildIngredientScienceContext({
    digest: buildDigest({
      labelId: 'fixture-green-tea-title-rescue',
      productName: '21st Century, Herbal Slimming Tea, Green Tea, 24 Tea Bags',
      dosageForm: 'Tea',
      actives: [],
    }),
    overlayClaims: null,
  });
  const probioticContext = buildIngredientScienceContext({
    digest: buildDigest({
      labelId: 'fixture-probiotic-title-rescue',
      productName: 'Align Probiotics, Gut Health + Immune Support, 28 Capsules',
      dosageForm: 'Capsule',
      actives: [],
    }),
    overlayClaims: null,
  });
  const brandBorneProbioticDigest = buildDigest({
    labelId: 'fixture-brand-borne-probiotic-title-rescue',
    productName: 'Align Probiotics, Gut Health + Immune Support, 28 Capsules',
    dosageForm: 'Capsule',
    actives: [],
  });
  const brandBorneProbioticContext = buildIngredientScienceContext({
    digest: {
      ...brandBorneProbioticDigest,
      product: {
        ...brandBorneProbioticDigest.product,
        brandDisplay: 'Align Probiotics',
      },
    },
    overlayClaims: null,
  });
  const mineralStackContext = buildIngredientScienceContext({
    digest: buildDigest({
      labelId: 'fixture-mineral-stack-title-rescue',
      productName: '21st Century, Calcium Magnesium Zinc + D3, 250 Tablets',
      dosageForm: 'Tablet',
      actives: [],
    }),
    overlayClaims: null,
  });
  const singleMineralContext = buildIngredientScienceContext({
    digest: buildDigest({
      labelId: 'fixture-single-magnesium-title-rescue',
      productName: '21st Century, Magnesium, 250 mg, 250 Tablets',
      dosageForm: 'Tablet',
      actives: [],
    }),
    overlayClaims: null,
  });

  assert.match(claContext.ingredientRows[0]?.name ?? '', /\bcla\b/i);
  assert.match(teaContext.ingredientRows[0]?.name ?? '', /\bgreen tea\b/i);
  assert.match(probioticContext.ingredientRows[0]?.name ?? '', /\bprobiotic/i);
  assert.equal(probioticContext.anchorIngredient?.ingredientFamily, 'probiotic_or_blend');
  assert.match(brandBorneProbioticContext.ingredientRows[0]?.name ?? '', /\bprobiotic/i);
  assert.equal(brandBorneProbioticContext.anchorIngredient?.ingredientFamily, 'probiotic_or_blend');
  assert.match(mineralStackContext.ingredientRows[0]?.name ?? '', /\bmagnesium\b/i);
  assert.match(singleMineralContext.ingredientRows[0]?.name ?? '', /\bmagnesium\b/i);
  assert.equal(singleMineralContext.anchorIngredient?.ingredientFamily, 'magnesium');
  assert.ok(
    mineralStackContext.ingredientRows.some((row) => /\bcalcium\b/i.test(row.name)),
  );
  assert.ok(
    mineralStackContext.ingredientRows.some((row) => /\bzinc\b/i.test(row.name)),
  );
});

test('greens and tea-bag products stay in label-context mode even when the rescued anchor looks supplement-like', () => {
  const greensContext = buildIngredientScienceContext({
    digest: buildDigest({
      labelId: 'fixture-greens-magnesium-powder',
      productName: 'Daily Greens Powder with Magnesium & Superfoods',
      dosageForm: 'Powder',
      actives: [{ name: 'Magnesium (as Magnesium Citrate)', amount: 120, unit: 'mg' }],
    }),
    overlayClaims: null,
  });
  const teaContext = buildIngredientScienceContext({
    digest: buildDigest({
      labelId: 'fixture-tea-bag-green-tea-mode',
      productName: 'Herbal Slimming Tea, Green Tea, 24 Tea Bags',
      dosageForm: 'Tea',
      actives: [{ name: 'Green Tea Extract', amount: 500, unit: 'mg' }],
    }),
    overlayClaims: null,
  });

  const greensPlan = planScientificBackgroundSections({
    context: greensContext,
    selectedIngredientName: greensContext.anchorIngredient?.name ?? 'Magnesium (as Magnesium Citrate)',
  });
  const teaPlan = planScientificBackgroundSections({
    context: teaContext,
    selectedIngredientName: teaContext.anchorIngredient?.name ?? 'Green Tea Extract',
  });

  assert.equal(greensContext.productArchetype, 'functional_food_like');
  assert.equal(greensPlan.mode, 'label_context_mode');
  assert.equal(teaContext.productArchetype, 'functional_food_like');
  assert.equal(teaPlan.mode, 'label_context_mode');
});

test('opaque probiotic blends and children immune blends rescue user-visible anchors from title context', () => {
  const probioticContext = buildIngredientScienceContext({
    digest: buildDigest({
      labelId: 'fixture-opaque-probiotic-blend',
      productName: '21st Century, Acidophilus Probiotic Blend, 100 Capsules',
      dosageForm: 'Capsule',
      actives: [{ name: 'Proprietary Blend', amount: 175, unit: 'mg' }],
    }),
    overlayClaims: null,
  });
  const immuneContext = buildIngredientScienceContext({
    digest: buildDigest({
      labelId: 'fixture-children-immune-zinc-blend',
      productName: 'Chewable Immune Blend with Vitamin A, Vitamin C, Vitamin E, and Zinc for Children',
      dosageForm: 'Chewable Tablet',
      actives: [],
    }),
    overlayClaims: null,
  });

  assert.match(probioticContext.ingredientRows[0]?.name ?? '', /probiotic/i);
  assert.equal(probioticContext.anchorIngredient?.ingredientFamily, 'probiotic_or_blend');
  assert.ok(
    immuneContext.ingredientRows.some((row) => /\bzinc\b/i.test(row.name)),
  );
  assert.ok(
    immuneContext.ingredientRows.some((row) => /vitamin c/i.test(row.name)),
  );
});

test('greens, tea bags, and juice powders are treated as label-context products from title alone', () => {
  const juicePowderContext = buildIngredientScienceContext({
    digest: buildDigest({
      labelId: 'fixture-juice-powder-title-only',
      productName: 'Organic Dragon Fruit Juice Powder with Magnesium',
      dosageForm: 'Capsule',
      actives: [{ name: 'Magnesium (as Magnesium Citrate)', amount: 50, unit: 'mg' }],
    }),
    overlayClaims: null,
  });
  const teaBagContext = buildIngredientScienceContext({
    digest: buildDigest({
      labelId: 'fixture-tea-bag-title-only',
      productName: 'Green Tea, 24 Tea Bags',
      dosageForm: 'Capsule',
      actives: [{ name: 'Green Tea Extract', amount: 150, unit: 'mg' }],
    }),
    overlayClaims: null,
  });

  const juicePowderPlan = planScientificBackgroundSections({
    context: juicePowderContext,
    selectedIngredientName: juicePowderContext.anchorIngredient?.name ?? 'Magnesium',
  });
  const teaBagPlan = planScientificBackgroundSections({
    context: teaBagContext,
    selectedIngredientName: teaBagContext.anchorIngredient?.name ?? 'Green Tea Extract',
  });

  assert.equal(juicePowderContext.productArchetype, 'functional_food_like');
  assert.equal(juicePowderPlan.mode, 'label_context_mode');
  assert.equal(teaBagContext.productArchetype, 'functional_food_like');
  assert.equal(teaBagPlan.mode, 'label_context_mode');
});

test('new metabolic families fall back with product-specific copy instead of generic research-direction prose', async () => {
  const context = buildIngredientScienceContext({
    digest: buildDigest({
      labelId: 'fixture-metabolic-fallback-families',
      productName: '7-Keto CLA Carnitine Formula',
      dosageForm: 'Capsule',
      actives: [
        { name: '7-Keto (DHEA Acetate-7-one)', amount: 100, unit: 'mg' },
        { name: 'Conjugated Linoleic Acid (CLA) (from Safflower Oil)', amount: 800, unit: 'mg' },
        { name: 'Acetyl-L-Carnitine HCl', amount: 500, unit: 'mg' },
      ],
    }),
    overlayClaims: null,
  });

  const sevenKetoResult = await compileScientificBackgroundAsync(context, '7-Keto (DHEA Acetate-7-one)');
  const claResult = await compileScientificBackgroundAsync(context, 'Conjugated Linoleic Acid (CLA) (from Safflower Oil)');
  const carnitineResult = await compileScientificBackgroundAsync(context, 'Acetyl-L-Carnitine HCl');

  assert.match(sevenKetoResult.scientificBackground.sections[0]?.summary ?? '', /7-keto|metabolic-rate|body-composition/i);
  assert.doesNotMatch(sevenKetoResult.scientificBackground.sections[0]?.summary ?? '', /appears in several research directions/i);
  assert.match(claResult.scientificBackground.sections[0]?.summary ?? '', /body-composition|fatty-acid|cla/i);
  assert.doesNotMatch(claResult.scientificBackground.sections[0]?.summary ?? '', /appears in several research directions/i);
  assert.match(carnitineResult.scientificBackground.sections[0]?.summary ?? '', /energy-transport|exercise-context|carnitine/i);
  assert.doesNotMatch(carnitineResult.scientificBackground.sections[0]?.summary ?? '', /appears in several research directions/i);
});
