import assert from "node:assert/strict";
import test from "node:test";

import type { FactsDigest } from "../../backend/src/factsDigest";
import { buildIngredientScienceContext } from "../../backend/src/ingredientScienceContext";
import { compileIngredientOverviewAsync } from "../../backend/src/insights/ingredientOverviewCompiler";
import {
  buildScientificBackgroundDeterministicFallback,
  planScientificBackgroundSections,
} from "../../backend/src/insights/scientificBackgroundCompiler";
import { NUTRI_MINIMAL_FULL_FAMILY_DEFINITIONS } from "../../backend/src/nutriMinimalFullFamilyProductization";

const buildDigest = (params: {
  labelId: string;
  productName: string;
  dosageForm: string;
  actives: Array<{ name: string; amount: number | null; unit: string | null }>;
}): FactsDigest => ({
  sourceType: "dsld",
  identity: {
    type: "dsldLabelId",
    value: params.labelId,
    regionTags: ["US"],
  },
  product: {
    brandDisplay: "Fixture Brand",
    name: params.productName,
    dosageForm: params.dosageForm,
    route: null,
  },
  actives: params.actives.map((active) => ({
    name: active.name,
    amount: active.amount,
    unit: active.unit,
    source: "dsld",
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

const withBrand = (digest: FactsDigest, brandDisplay: string): FactsDigest => ({
  ...digest,
  product: {
    ...digest.product,
    brandDisplay,
  },
});

test("row-level family inference does not let zinc or calcium inherit vitamin C family", () => {
  const digest = buildDigest({
    labelId: "fixture-vitamin-c-zinc-calcium",
    productName: "Vitamin C with Zinc and Calcium",
    dosageForm: "Capsule",
    actives: [
      { name: "Vitamin C", amount: 1000, unit: "mg" },
      { name: "Zinc", amount: 15, unit: "mg" },
      { name: "Calcium", amount: 100, unit: "mg" },
    ],
  });

  const context = buildIngredientScienceContext({
    digest,
    overlayClaims: null,
  });
  const familyByName = new Map(
    context.ingredientDescriptors.map((descriptor) => [
      descriptor.name,
      descriptor.ingredientFamily,
    ]),
  );

  assert.equal(familyByName.get("Vitamin C"), "vitamin_c");
  assert.equal(familyByName.get("Zinc"), "zinc");
  assert.equal(familyByName.get("Calcium"), "calcium");

  const zincPlan = planScientificBackgroundSections({
    context,
    selectedIngredientName: "Zinc",
  });
  const calciumPlan = planScientificBackgroundSections({
    context,
    selectedIngredientName: "Calcium",
  });

  assert.deepEqual(
    zincPlan.sections.map((section) => section.heading),
    ["Immune function context", "Skin and barrier research"],
  );
  assert.deepEqual(
    calciumPlan.sections.map((section) => section.heading),
    [
      "Bone and intake context",
      "Form and absorption context",
      "How co-formulation changes comparison",
    ],
  );
});

test("row-level family inference keeps iron separate from vitamin C in combo formulas", () => {
  const digest = buildDigest({
    labelId: "fixture-iron-vitamin-c",
    productName: "Iron with Vitamin C",
    dosageForm: "Capsule",
    actives: [
      {
        name: "Iron (as Ferrous Bisglycinate Chelate)",
        amount: 18,
        unit: "mg",
      },
      { name: "Vitamin C", amount: 90, unit: "mg" },
    ],
  });

  const context = buildIngredientScienceContext({
    digest,
    overlayClaims: null,
  });
  const familyByName = new Map(
    context.ingredientDescriptors.map((descriptor) => [
      descriptor.name,
      descriptor.ingredientFamily,
    ]),
  );

  assert.equal(
    familyByName.get("Iron (as Ferrous Bisglycinate Chelate)"),
    "iron",
  );
  assert.equal(familyByName.get("Vitamin C"), "vitamin_c");

  const ironPlan = planScientificBackgroundSections({
    context,
    selectedIngredientName: "Iron (as Ferrous Bisglycinate Chelate)",
  });

  assert.deepEqual(
    ironPlan.sections.map((section) => section.heading),
    [
      "Iron status and deficiency context",
      "Form and tolerability context",
      "What product comparison depends on",
    ],
  );
});

test("row-level family inference keeps b12, folate, and b6 distinct inside a b-complex formula", () => {
  const digest = buildDigest({
    labelId: "fixture-b-complex",
    productName: "B-Complex with B12, Folate, and B6",
    dosageForm: "Capsule",
    actives: [
      { name: "Vitamin B12 (as Methylcobalamin)", amount: 1000, unit: "mcg" },
      { name: "Folate (as 5-MTHF)", amount: 680, unit: "mcg DFE" },
      { name: "Vitamin B6 (as Pyridoxal-5-Phosphate)", amount: 20, unit: "mg" },
    ],
  });

  const context = buildIngredientScienceContext({
    digest,
    overlayClaims: null,
  });
  const familyByName = new Map(
    context.ingredientDescriptors.map((descriptor) => [
      descriptor.name,
      descriptor.ingredientFamily,
    ]),
  );

  assert.equal(familyByName.get("Vitamin B12 (as Methylcobalamin)"), "b12");
  assert.equal(familyByName.get("Folate (as 5-MTHF)"), "folate");
  assert.equal(familyByName.get("Vitamin B6 (as Pyridoxal-5-Phosphate)"), "b6");

  const b12Plan = planScientificBackgroundSections({
    context,
    selectedIngredientName: "Vitamin B12 (as Methylcobalamin)",
  });
  const folatePlan = planScientificBackgroundSections({
    context,
    selectedIngredientName: "Folate (as 5-MTHF)",
  });
  const b6Plan = planScientificBackgroundSections({
    context,
    selectedIngredientName: "Vitamin B6 (as Pyridoxal-5-Phosphate)",
  });

  assert.deepEqual(
    b12Plan.sections.map((section) => section.heading),
    [
      "Deficiency and supplementation context",
      "Nerve and blood-cell context",
      "What form disclosure changes",
    ],
  );
  assert.deepEqual(
    folatePlan.sections.map((section) => section.heading),
    [
      "Folate status and supplementation context",
      "Pregnancy and developmental context",
      "What form labeling changes",
    ],
  );
  assert.deepEqual(
    b6Plan.sections.map((section) => section.heading),
    [
      "Cofactor and metabolism context",
      "Nerve-related interpretation",
      "Why dose context matters",
    ],
  );
});

test("row-level family inference keeps botanical extracts distinct inside a mixed herbal formula", () => {
  const digest = buildDigest({
    labelId: "fixture-botanical-combo",
    productName: "Curcumin with Ashwagandha, Ginseng, and Green Tea Extract",
    dosageForm: "Capsule",
    actives: [
      { name: "Curcumin C3 Complex", amount: 500, unit: "mg" },
      { name: "Ashwagandha (KSM-66)", amount: 300, unit: "mg" },
      { name: "Panax Ginseng Extract", amount: 200, unit: "mg" },
      { name: "Green Tea Extract (EGCG)", amount: 150, unit: "mg" },
    ],
  });

  const context = buildIngredientScienceContext({
    digest,
    overlayClaims: null,
  });
  const familyByName = new Map(
    context.ingredientDescriptors.map((descriptor) => [
      descriptor.name,
      descriptor.ingredientFamily,
    ]),
  );

  assert.equal(familyByName.get("Curcumin C3 Complex"), "curcumin");
  assert.equal(familyByName.get("Ashwagandha (KSM-66)"), "ashwagandha");
  assert.equal(familyByName.get("Panax Ginseng Extract"), "ginseng");
  assert.equal(
    familyByName.get("Green Tea Extract (EGCG)"),
    "green_tea_extract",
  );

  const curcuminPlan = planScientificBackgroundSections({
    context,
    selectedIngredientName: "Curcumin C3 Complex",
  });
  const ashwagandhaPlan = planScientificBackgroundSections({
    context,
    selectedIngredientName: "Ashwagandha (KSM-66)",
  });
  const ginsengPlan = planScientificBackgroundSections({
    context,
    selectedIngredientName: "Panax Ginseng Extract",
  });
  const greenTeaPlan = planScientificBackgroundSections({
    context,
    selectedIngredientName: "Green Tea Extract (EGCG)",
  });

  assert.deepEqual(
    curcuminPlan.sections.map((section) => section.heading),
    [
      "Most studied outcomes",
      "Why extract detail matters",
      "Where evidence remains mixed",
    ],
  );
  assert.deepEqual(
    ashwagandhaPlan.sections.map((section) => section.heading),
    [
      "Stress and mood-related research",
      "Sleep and recovery context",
      "Why extract identity matters",
    ],
  );
  assert.deepEqual(
    ginsengPlan.sections.map((section) => section.heading),
    [
      "Energy and fatigue context",
      "Cognitive and performance interpretation",
      "Why species and extract detail matter",
    ],
  );
  assert.deepEqual(
    greenTeaPlan.sections.map((section) => section.heading),
    [
      "Catechin and antioxidant context",
      "Metabolic and weight-related interpretation",
      "Why extract concentration matters",
    ],
  );
});

test("row-level family inference keeps 7-keto, cla, and carnitine distinct inside a metabolic formula", () => {
  const digest = buildDigest({
    labelId: "fixture-metabolic-formula",
    productName: "7-Keto CLA Carnitine Metabolic Formula",
    dosageForm: "Capsule",
    actives: [
      { name: "7-Keto (DHEA Acetate-7-one)", amount: 100, unit: "mg" },
      {
        name: "Conjugated Linoleic Acid (CLA) (from Safflower Oil)",
        amount: 800,
        unit: "mg",
      },
      { name: "Acetyl-L-Carnitine HCl", amount: 500, unit: "mg" },
      {
        name: "Green Tea Extract (Camellia sinensis) (Leaf)",
        amount: 250,
        unit: "mg",
      },
    ],
  });

  const context = buildIngredientScienceContext({
    digest,
    overlayClaims: null,
  });
  const familyByName = new Map(
    context.ingredientDescriptors.map((descriptor) => [
      descriptor.name,
      descriptor.ingredientFamily,
    ]),
  );

  assert.equal(
    familyByName.get("7-Keto (DHEA Acetate-7-one)"),
    "7keto_dhea_metabolite",
  );
  assert.equal(
    familyByName.get("Conjugated Linoleic Acid (CLA) (from Safflower Oil)"),
    "cla",
  );
  assert.equal(familyByName.get("Acetyl-L-Carnitine HCl"), "carnitine");
  assert.equal(
    familyByName.get("Green Tea Extract (Camellia sinensis) (Leaf)"),
    "green_tea_extract",
  );

  const sevenKetoPlan = planScientificBackgroundSections({
    context,
    selectedIngredientName: "7-Keto (DHEA Acetate-7-one)",
  });
  const claPlan = planScientificBackgroundSections({
    context,
    selectedIngredientName:
      "Conjugated Linoleic Acid (CLA) (from Safflower Oil)",
  });
  const carnitinePlan = planScientificBackgroundSections({
    context,
    selectedIngredientName: "Acetyl-L-Carnitine HCl",
  });

  assert.deepEqual(
    sevenKetoPlan.sections.map((section) => section.heading),
    [
      "Metabolic and body-composition context",
      "Why it reads differently from DHEA",
    ],
  );
  assert.deepEqual(
    claPlan.sections.map((section) => section.heading),
    ["Body-composition context", "Source oil and isomer detail"],
  );
  assert.deepEqual(
    carnitinePlan.sections.map((section) => section.heading),
    ["Energy transport and exercise context", "What form disclosure changes"],
  );
});

test("row-level family inference keeps creatine and NAC distinct inside a performance formula", () => {
  const digest = buildDigest({
    labelId: "fixture-creatine-nac-formula",
    productName: "Creatine Recovery + NAC",
    dosageForm: "Powder",
    actives: [
      { name: "Creatine Monohydrate", amount: 5000, unit: "mg" },
      { name: "N-Acetyl-Cysteine", amount: 600, unit: "mg" },
      { name: "Magnesium", amount: 50, unit: "mg" },
    ],
  });

  const context = buildIngredientScienceContext({
    digest,
    overlayClaims: null,
  });
  const familyByName = new Map(
    context.ingredientDescriptors.map((descriptor) => [
      descriptor.name,
      descriptor.ingredientFamily,
    ]),
  );

  assert.equal(familyByName.get("Creatine Monohydrate"), "creatine");
  assert.equal(familyByName.get("N-Acetyl-Cysteine"), "nac");
  assert.equal(context.anchorIngredient?.ingredientFamily, "creatine");
});

test("food-like gummy snack titles rescue a food-like anchor instead of drifting to vitamin rows", async () => {
  const digest = withBrand(
    buildDigest({
      labelId: "fixture-yumearth-gummy-bears",
      productName:
        "YumEarth, Gummy Bears, Assorted, 35 Snack Packs, 0.7 oz (19.8 g) Each",
      dosageForm: "Gummy",
      actives: [],
    }),
    "YumEarth",
  );

  const context = buildIngredientScienceContext({
    digest,
    overlayClaims: {
      title:
        "YumEarth, Gummy Bears, Assorted, 35 Snack Packs, 0.7 oz (19.8 g) Each",
      brandName: "YumEarth",
      nutritionalFacts: [
        {
          substancy: "Vitamin C",
          amountPerServing: "111 mg",
          dailyValuePercent: null,
        },
        {
          substancy: "Total Carb",
          amountPerServing: "15 g",
          dailyValuePercent: null,
        },
        {
          substancy: "Fiber",
          amountPerServing: "0 g",
          dailyValuePercent: null,
        },
      ],
      description: null,
      suggestedUse: null,
    },
  });

  assert.equal(context.productArchetype, "functional_food_like");
  assert.equal(context.anchorIngredient?.name, "Gummy Bears");

  const overview = await compileIngredientOverviewAsync(context, {
    maxTokens: 400,
    timeoutMs: 1500,
  });

  assert.equal(overview.ingredientOverview.titleLine, "Gummy Bears");
});

test("ingredient overview repairs factual A-card restatement into formula-reading copy", async () => {
  const digest = buildDigest({
    labelId: "fixture-omega3",
    productName: "Omega-3 1040 mg Fish Oil 1250 mg",
    dosageForm: "Softgel",
    actives: [
      {
        name: "Wild Alaska Pollock Fish Oil Concentrate",
        amount: 1250,
        unit: "mg",
      },
      { name: "Total Omega-3 Fatty Acids as TG", amount: 1040, unit: "mg" },
      { name: "EPA (Eicosapentaenoic Acid)", amount: 690, unit: "mg" },
      { name: "DHA (Docosahexaenoic Acid)", amount: 260, unit: "mg" },
    ],
  });

  const context = buildIngredientScienceContext({
    digest,
    overlayClaims: null,
  });
  const result = await compileIngredientOverviewAsync(context, {
    llmFn: async () =>
      JSON.stringify({
        mode: "multi_anchor",
        titleLine: "Omega-3 1040 mg Fish Oil 1250 mg",
        paragraph1:
          "This supplement provides omega-3 fatty acids from wild Alaska pollock fish oil concentrate.",
        paragraph2:
          "The formula delivers 1,040 mg of total omega-3s, including 690 mg of EPA and 260 mg of DHA.",
        compareHint: "Compare products by ingredient amount and quality.",
      }),
  });

  assert.equal(result.source, "api");
  assert.equal(result.fallbackUsed, false);
  assert.match(
    result.ingredientOverview.paragraph1,
    /source ingredient|fish oil/i,
  );
  assert.match(
    result.ingredientOverview.paragraph2 ?? "",
    /break out total omega-3|epa and dha/i,
  );
  assert.match(
    result.ingredientOverview.compareHint ?? "",
    /EPA and DHA|total omega-3/i,
  );
});

test("ingredient overview repairs a near-miss writer response into an api result when the anchor and compare hint can be normalized", async () => {
  const digest = buildDigest({
    labelId: "fixture-5htp-companions",
    productName: "5-HTP with Glycine Taurine and Inositol",
    dosageForm: "Capsule",
    actives: [
      { name: "5-HTP (5-hydroxytryptophan)", amount: 200, unit: "mg" },
      { name: "Glycine", amount: 100, unit: "mg" },
      { name: "Taurine", amount: 100, unit: "mg" },
      { name: "Inositol", amount: 100, unit: "mg" },
    ],
  });

  const context = buildIngredientScienceContext({
    digest,
    overlayClaims: null,
  });
  const result = await compileIngredientOverviewAsync(context, {
    llmFn: async () =>
      JSON.stringify({
        titleLine: "Formula structure",
        paragraph1:
          "The label keeps one main active and then arranges the surrounding lines as supporting formula components.",
        paragraph2:
          "Glycine, taurine, and inositol read more like companion rows than equal co-headliners.",
        compareHint:
          "Compare how clearly the label discloses the main active line and the supporting formula lines.",
      }),
    timeoutMs: 200,
    maxRetries: 0,
  });

  assert.equal(result.source, "api");
  assert.equal(result.fallbackUsed, false);
  assert.match(result.ingredientOverview.paragraph1, /5-HTP/i);
  assert.match(
    result.ingredientOverview.compareHint ?? "",
    /label|supporting formula lines/i,
  );
});

test("ingredient overview fallback stays aligned to the selected formula row in prenatal DHA multivitamin products", async () => {
  const digest = buildDigest({
    labelId: "fixture-prenatal-multi-dha-overview-alignment",
    productName: "Prenatal Multivitamin Plus DHA",
    dosageForm: "Tablet / Softgel",
    actives: [
      { name: "Multivitamin & Mineral Formula", amount: null, unit: null },
      { name: "DHA", amount: null, unit: null },
      { name: "Docosahexaenoic Acid", amount: 200, unit: "mg" },
    ],
  });

  const context = buildIngredientScienceContext({
    digest,
    overlayClaims: {
      title:
        "21st Century, Prenatal Multivitamin Plus DHA, 2 Bottles, 60 Tablets / 60 Softgels",
      brandName: "21st Century",
      nutritionalFacts: null,
    },
  });
  const result = await compileIngredientOverviewAsync(context, {
    timeoutMs: 50,
    maxRetries: 0,
  });

  assert.equal(
    context.anchorIngredient?.name,
    "Multivitamin & Mineral Formula",
  );
  assert.equal(result.source, "fallback");
  assert.match(result.ingredientOverview.titleLine ?? "", /multivitamin/i);
  assert.doesNotMatch(result.ingredientOverview.titleLine ?? "", /omega-3/i);
  assert.match(result.ingredientOverview.paragraph1, /multivitamin|formula/i);
});

test("ingredient overview fallback stays aligned to krill oil instead of drifting to astaxanthin", async () => {
  const digest = buildDigest({
    labelId: "fixture-krill-oil-overview-alignment",
    productName:
      "Antarctic Krill Oil, Omega-3 Phospholipids Complex with EPA, DHA, and Astaxanthin",
    dosageForm: "Softgel",
    actives: [{ name: "Krill Oil", amount: 500, unit: "mg" }],
  });

  const context = buildIngredientScienceContext({
    digest,
    overlayClaims: {
      title:
        "California Gold Nutrition, Antarctic Krill Oil, Omega-3 Phospholipids Complex with EPA, DHA, and Astaxanthin, Natural Strawberry and Lemon, 500 mg, 30 Fish Gelatin Softgels",
      brandName: "California Gold Nutrition",
      nutritionalFacts: null,
    },
  });
  const result = await compileIngredientOverviewAsync(context, {
    timeoutMs: 50,
    maxRetries: 0,
  });

  assert.equal(context.anchorIngredient?.name, "Krill Oil");
  assert.equal(result.source, "fallback");
  assert.match(result.ingredientOverview.titleLine ?? "", /krill oil/i);
  assert.doesNotMatch(
    result.ingredientOverview.titleLine ?? "",
    /astaxanthin/i,
  );
  assert.match(result.ingredientOverview.paragraph1, /krill|omega-3/i);
});

test("science context orders lead active rows ahead of companion nutrients for 5-HTP formulas", () => {
  const digest = buildDigest({
    labelId: "fixture-5htp-with-b6-companions",
    productName: "Double Strength 5-HTP 200 mg",
    dosageForm: "Capsule",
    actives: [
      { name: "Niacin (as Niacinamide) (Vitamin B-3)", amount: 20, unit: "mg" },
      { name: "Vitamin B-6 (from Pyridoxine HCl)", amount: 2, unit: "mg" },
      {
        name: "5-HTP (5-hydroxytryptophan) (From Griffonia simplicifolia Extract) (Seed)",
        amount: 200,
        unit: "mg",
      },
      { name: "Glycine", amount: 100, unit: "mg" },
      { name: "Taurine (Free-Form)", amount: 100, unit: "mg" },
      { name: "Inositol", amount: 100, unit: "mg" },
    ],
  });

  const context = buildIngredientScienceContext({
    digest,
    overlayClaims: null,
  });

  assert.equal(
    context.anchorIngredient?.name,
    "5-HTP (5-hydroxytryptophan) (From Griffonia simplicifolia Extract) (Seed)",
  );
  assert.equal(
    context.ingredientRows[0]?.name,
    "5-HTP (5-hydroxytryptophan) (From Griffonia simplicifolia Extract) (Seed)",
  );
  assert.equal(context.ingredientDescriptors[0]?.lineRole, "primary_active");
  assert.equal(context.ingredientDescriptors[0]?.ingredientFamily, "5htp");
  assert.equal(context.ingredientDescriptors[1]?.ingredientFamily, "glycine");
  assert.notEqual(
    context.ingredientRows[1]?.name,
    "Vitamin B-6 (from Pyridoxine HCl)",
  );
});

test("science context keeps 5-HTP ahead of melatonin in mixed sleep formulas", () => {
  const digest = buildDigest({
    labelId: "fixture-melatonin-5htp",
    productName: "Melatonin + 5-HTP, Time Release",
    dosageForm: "Tablet",
    actives: [
      { name: "Melatonin", amount: 6, unit: "mg" },
      { name: "5-HTP (5-hydroxytryptophan)", amount: 100, unit: "mg" },
    ],
  });

  const context = buildIngredientScienceContext({
    digest,
    overlayClaims: null,
  });

  assert.match(context.ingredientRows[0]?.name ?? "", /\b5-?HTP\b/i);
  assert.equal(context.anchorIngredient?.ingredientFamily, "5htp");
  assert.notEqual(context.ingredientRows[0]?.name, "Melatonin");
});

test("science context keeps 5-HTP ahead of melatonin for fresh validation title-order edge cases", () => {
  const natrolContext = buildIngredientScienceContext({
    digest: buildDigest({
      labelId: "fixture-natrol-melatonin-5htp-time-release",
      productName: "Melatonin + 5-HTP, Time Release",
      dosageForm: "Tablet",
      actives: [
        { name: "Melatonin", amount: 6, unit: "mg" },
        {
          name: "5-HTP (5-Hydroxytryptophan) (from Griffonia simplicifolia) (seed)",
          amount: 50,
          unit: "mg",
        },
        {
          name: "Calcium (as Dibasic Calcium Phosphate)",
          amount: 97,
          unit: "mg",
        },
        {
          name: "Vitamin B-6 (as Pyridoxine Hydrochloride)",
          amount: 10,
          unit: "mg",
        },
      ],
    }),
    overlayClaims: {
      title: "Natrol, Melatonin + 5-HTP, Time Release, 60 Bi-Layer Tablets",
      brandName: "Natrol",
      nutritionalFacts: null,
    },
  });
  const swansonContext = buildIngredientScienceContext({
    digest: buildDigest({
      labelId: "fixture-swanson-5htp-melatonin",
      productName: "5-HTP & Melatonin",
      dosageForm: "Capsule",
      actives: [
        { name: "Melatonin", amount: 3, unit: "mg" },
        { name: "L-5-Hydroxytryptophan", amount: 50, unit: "mg" },
      ],
    }),
    overlayClaims: {
      title: "Swanson, 5-HTP & Melatonin, 30 Capsules",
      brandName: "Swanson",
      nutritionalFacts: null,
    },
  });

  assert.match(
    natrolContext.ingredientRows[0]?.name ?? "",
    /\b5-?HTP\b|\bHydroxytryptophan\b/i,
  );
  assert.equal(natrolContext.anchorIngredient?.ingredientFamily, "5htp");
  assert.notEqual(natrolContext.ingredientRows[0]?.name, "Melatonin");
  assert.match(
    swansonContext.ingredientRows[0]?.name ?? "",
    /\b5-?HTP\b|\bHydroxytryptophan\b/i,
  );
  assert.equal(swansonContext.anchorIngredient?.ingredientFamily, "5htp");
  assert.notEqual(swansonContext.ingredientRows[0]?.name, "Melatonin");
});

test("science context keeps probiotic rows ahead of macro nutrition facts in probiotic products", () => {
  const digest = buildDigest({
    labelId: "fixture-probiotic-drops-with-macros",
    productName:
      "Culturelle, Baby Probiotics, Digestive Calm + Comfort Probiotic Drops",
    dosageForm: "Drops",
    actives: [
      { name: "Calories", amount: 5, unit: null },
      { name: "Total Carbohydrate", amount: 1, unit: "g" },
      {
        name: "Bifidobacterium animalis subsp. lactis, BB-12",
        amount: 10,
        unit: "mg",
      },
    ],
  });

  const context = buildIngredientScienceContext({
    digest,
    overlayClaims: null,
  });

  assert.match(
    context.ingredientRows[0]?.name ?? "",
    /bifidobacterium|probiotic/i,
  );
  assert.equal(
    context.anchorIngredient?.ingredientFamily,
    "probiotic_or_blend",
  );
  assert.doesNotMatch(
    context.ingredientRows[0]?.name ?? "",
    /calories|carbohydrate/i,
  );
});

test("science context normalizes branded probiotic rows so they remain searchable and user-readable", () => {
  const protectisContext = buildIngredientScienceContext({
    digest: buildDigest({
      labelId: "fixture-protectis-vitamin-d",
      productName: "Protectis Baby Probiotic Drops with Vitamin D",
      dosageForm: "Drops",
      actives: [
        { name: "Vitamin D", amount: 10, unit: "mcg" },
        { name: "Protectis", amount: null, unit: null },
      ],
    }),
    overlayClaims: null,
  });
  const floraphageContext = buildIngredientScienceContext({
    digest: buildDigest({
      labelId: "fixture-floraphage",
      productName: "Floraphage Probiotic Multiplier",
      dosageForm: "Capsule",
      actives: [
        {
          name: "FloraphagePrebiotic Bacteriophage",
          amount: 1000000,
          unit: "PFU's",
        },
      ],
    }),
    overlayClaims: null,
  });

  assert.match(protectisContext.ingredientRows[0]?.name ?? "", /probiotic/i);
  assert.equal(
    protectisContext.anchorIngredient?.ingredientFamily,
    "probiotic_or_blend",
  );
  assert.notEqual(protectisContext.ingredientRows[0]?.name, "Vitamin D");
  assert.match(
    floraphageContext.ingredientRows[0]?.name ?? "",
    /floraphage probiotic/i,
  );
  assert.equal(
    floraphageContext.anchorIngredient?.ingredientFamily,
    "probiotic_or_blend",
  );
});

test("science context keeps title-led probiotic formula anchors ahead of yeast companion rows", () => {
  const context = buildIngredientScienceContext({
    digest: buildDigest({
      labelId: "fixture-polyflora-o-probiotic-formula",
      productName:
        "D'adamo, Polyflora® + O, Multi-Function Probiotic Formula, 120 VeggieCaps",
      dosageForm: "Capsule",
      actives: [
        {
          name: "Probiotic Blend(Contains Streptococcus thermophilus and Lactobacillus rhamnosus)",
          amount: 3,
          unit: "Billion CFU",
        },
        { name: "Larch Arabinogalactan", amount: 100, unit: "mg" },
        {
          name: "Banana Fruit Powder(Musa paradisiaca)",
          amount: 100,
          unit: "mg",
        },
        {
          name: "Chicory 4:1 Root Extract(Cichorium intybus)",
          amount: 100,
          unit: "mg",
        },
        {
          name: "Brewer's Yeast (Saccharomyces boulardii)",
          amount: 100,
          unit: "mg",
        },
        {
          name: "Akkermansia muciniphila Postbiotic",
          amount: 5,
          unit: "Billion TFU",
        },
      ],
    }),
    overlayClaims: null,
  });

  assert.match(context.ingredientRows[0]?.name ?? "", /probiotic/i);
  assert.doesNotMatch(
    context.ingredientRows[0]?.name ?? "",
    /brewer'?s yeast/i,
  );
  assert.equal(
    context.anchorIngredient?.ingredientFamily,
    "probiotic_or_blend",
  );
});

test("science context does not treat Flora brand omega oils as probiotic products", () => {
  const context = buildIngredientScienceContext({
    digest: buildDigest({
      labelId: "fixture-flora-udos-oil-omega-369",
      productName: "Organic Udo's Oil 3-6-9 Blend",
      dosageForm: "Liquid",
      actives: [
        { name: "Saturated Fat", amount: 2, unit: "g" },
        { name: "Polyunsaturated Fat", amount: 9, unit: "g" },
        { name: "Omega-3 ALA", amount: 6, unit: "g" },
        { name: "Omega-6 LA", amount: 3, unit: "g" },
        { name: "Omega-9 OA", amount: 3, unit: "g" },
      ],
    }),
    overlayClaims: {
      title: "Flora, Organic Udo's Oil™ 3-6-9 Blend, 17 fl oz (500 ml)",
      brandName: "Flora",
      nutritionalFacts: null,
    },
  });

  assert.doesNotMatch(context.ingredientRows[0]?.name ?? "", /^probiotics?$/i);
  assert.notEqual(
    context.anchorIngredient?.ingredientFamily,
    "probiotic_or_blend",
  );
  assert.match(context.anchorIngredient?.name ?? "", /omega-3|ALA|DHA/i);
  assert.equal(context.anchorIngredient?.ingredientFamily, "omega_3");
});

test("science context treats salmon oil rows as omega source oil anchors", () => {
  const context = buildIngredientScienceContext({
    digest: buildDigest({
      labelId: "fixture-amazing-salmon-oil",
      productName:
        "Amazing Nutrition, Wild Alaskan Salmon Oil, 180 Softgels (1,000 Per Softgel)",
      dosageForm: "Softgel",
      actives: [
        { name: "Calories From Fat", amount: 20, unit: null },
        { name: "Polyunsaturated Fat", amount: 1, unit: "g" },
        { name: "Salmon Oil", amount: 2000, unit: "mg" },
        { name: "DHA (Docosahexaenoic Acid)", amount: 220, unit: "mg" },
      ],
    }),
    overlayClaims: null,
  });

  assert.equal(context.anchorIngredient?.name, "Salmon Oil");
  assert.equal(context.anchorIngredient?.ingredientFamily, "omega_3");
});

test("science context rescues zinc as the lead row in children immune blend products", () => {
  const digest = buildDigest({
    labelId: "fixture-children-immune-vitamin-c-zinc",
    productName:
      "Chewable Immune Blend with Vitamin A, Vitamin C, Vitamin E, and Zinc for Children",
    dosageForm: "Chewable Tablet",
    actives: [
      { name: "Vitamin C", amount: 90, unit: "mg" },
      { name: "Vitamin E", amount: 13.5, unit: "mg" },
      { name: "Zinc", amount: 5, unit: "mg" },
    ],
  });

  const context = buildIngredientScienceContext({
    digest,
    overlayClaims: null,
  });

  assert.match(context.ingredientRows[0]?.name ?? "", /\bzinc\b/i);
  assert.equal(context.anchorIngredient?.ingredientFamily, "zinc");
});

test("science context lets zinc-led mineral stack titles outrank higher-dose magnesium rows", () => {
  const digest = buildDigest({
    labelId: "fixture-zinc-magnesium-title-order",
    productName: "Zinc Magnesium Aspartate",
    dosageForm: "Tablet",
    actives: [
      { name: "Magnesium", amount: 450, unit: "mg" },
      { name: "Zinc", amount: 30, unit: "mg" },
    ],
  });

  const context = buildIngredientScienceContext({
    digest,
    overlayClaims: null,
  });

  assert.match(context.ingredientRows[0]?.name ?? "", /\bzinc\b/i);
  assert.equal(context.anchorIngredient?.ingredientFamily, "zinc");
});

test("science context keeps zinc as the anchor in vitamin C/D/elderberry zinc formulas", () => {
  const digest = buildDigest({
    labelId: "fixture-vitamin-c-d-zinc",
    productName: "Vitamin C, D3 & Zinc",
    dosageForm: "Vegetable Capsule",
    actives: [
      { name: "Vitamin C (as L-ascorbic acid)", amount: 250, unit: "mg" },
      { name: "Vitamin D3", amount: 25, unit: "mcg" },
      { name: "Zinc", amount: 15, unit: "mg" },
    ],
  });

  const context = buildIngredientScienceContext({
    digest,
    overlayClaims: null,
  });

  assert.match(context.ingredientRows[0]?.name ?? "", /\bzinc\b/i);
  assert.equal(context.anchorIngredient?.ingredientFamily, "zinc");
});

test("science context rescues elderberry rows from syrup and tea product titles", () => {
  const syrupDigest = buildDigest({
    labelId: "fixture-elderberry-syrup-title-only",
    productName: "Children's Sambucus Elderberry Syrup",
    dosageForm: "Syrup",
    actives: [],
  });
  const teaDigest = buildDigest({
    labelId: "fixture-elderberry-tea-title-only",
    productName: "Organic Herbal Tea, Elderberry, Caffeine Free, 18 Tea Bags",
    dosageForm: "Tea Bag",
    actives: [{ name: "Tea blend", amount: null, unit: null }],
  });

  const syrupContext = buildIngredientScienceContext({
    digest: syrupDigest,
    overlayClaims: null,
  });
  const teaContext = buildIngredientScienceContext({
    digest: teaDigest,
    overlayClaims: null,
  });

  assert.match(
    syrupContext.ingredientRows[0]?.name ?? "",
    /elderberry|sambucus/i,
  );
  assert.doesNotMatch(
    syrupContext.ingredientRows[0]?.name ?? "",
    /syrup|children/i,
  );
  assert.match(
    teaContext.ingredientRows[0]?.name ?? "",
    /elderberry|sambucus/i,
  );
  assert.notEqual(teaContext.ingredientRows[0]?.name, "Tea blend");
});

test("science context keeps zinc ahead of vitamin C in elderberry immune formulas", () => {
  const digest = buildDigest({
    labelId: "fixture-sambucus-vitamin-c-zinc",
    productName: "Sambucus Elderberry With Vitamin C & Zinc Gummies",
    dosageForm: "Gummy",
    actives: [
      { name: "Vitamin C", amount: 90, unit: "mg" },
      { name: "Zinc", amount: 5, unit: "mg" },
    ],
  });

  const context = buildIngredientScienceContext({
    digest,
    overlayClaims: null,
  });

  assert.match(context.ingredientRows[0]?.name ?? "", /\bzinc\b/i);
  assert.notEqual(context.ingredientRows[0]?.name, "Vitamin C");
  assert.ok(
    context.ingredientRows.some((row) => /elderberry|sambucus/i.test(row.name)),
  );
});

test("science context does not let magnesium steal immune liquid formulas from zinc and vitamin C", () => {
  const digest = buildDigest({
    labelId: "fixture-trace-liquid-immunity",
    productName: "Trace, Liquid Immunity+, Mixed Berry, 30 fl oz (887 ml)",
    dosageForm: "Liquid",
    actives: [
      { name: "Total CarbohydrateR", amount: 10, unit: "g" },
      { name: "Vitamin C (as Ascorbic Acid)", amount: 1000, unit: "mg" },
      { name: "Vitamin D3 (as Cholecalciferol)", amount: 30, unit: "mcg" },
      {
        name: "Vitamin E (as D-Alpha Tocopherol Acetate)",
        amount: 30,
        unit: "mg",
      },
      { name: "Magnesium (from CTM)", amount: 10, unit: "mg" },
      { name: "Zinc (as Zinc Gluconate)", amount: 15, unit: "mg" },
      { name: "Black Elderberry", amount: 200, unit: "mg" },
    ],
  });

  const context = buildIngredientScienceContext({
    digest,
    overlayClaims: null,
  });

  assert.doesNotMatch(
    context.ingredientRows[0]?.name ?? "",
    /magnesium|carbohydrate/i,
  );
  assert.match(
    context.ingredientRows[0]?.name ?? "",
    /zinc|vitamin c|elderberry/i,
  );
});

test("science context does not let audience or sugar rows beat title-rescued actives", () => {
  const zincDigest = buildDigest({
    labelId: "fixture-zinc-audience-row",
    productName: "Zinc For Immune Support",
    dosageForm: "Liquid",
    actives: [{ name: "Men", amount: null, unit: null }],
  });
  const elderberryDigest = buildDigest({
    labelId: "fixture-elderberry-sugar-row",
    productName: "Kids Elderberry Super-Immune SoftChew Gummies",
    dosageForm: "Gummy",
    actives: [{ name: "Sugar Alcohol", amount: 2, unit: "g" }],
  });

  const zincContext = buildIngredientScienceContext({
    digest: zincDigest,
    overlayClaims: null,
  });
  const elderberryContext = buildIngredientScienceContext({
    digest: elderberryDigest,
    overlayClaims: null,
  });

  assert.match(zincContext.ingredientRows[0]?.name ?? "", /\bzinc\b/i);
  assert.notEqual(zincContext.ingredientRows[0]?.name, "Men");
  assert.match(
    elderberryContext.ingredientRows[0]?.name ?? "",
    /elderberry|sambucus/i,
  );
  assert.notEqual(elderberryContext.ingredientRows[0]?.name, "Sugar Alcohol");
});

test("science context keeps CLA ahead of carnitine rows in CLA-led combo products", () => {
  const digest = buildDigest({
    labelId: "fixture-cla-carnitine-matrix",
    productName: "CLA + Carnitine, Fruit Punch",
    dosageForm: "Powder",
    actives: [
      { name: "Omega 6 Fatty Acids & CLA Matrix", amount: 3000, unit: "mg" },
      { name: "L-Carnitine Tartrate", amount: 1500, unit: "mg" },
    ],
  });

  const context = buildIngredientScienceContext({
    digest,
    overlayClaims: null,
  });

  assert.match(context.ingredientRows[0]?.name ?? "", /\bcla\b/i);
  assert.doesNotMatch(context.ingredientRows[0]?.name ?? "", /matrix/i);
  assert.equal(context.anchorIngredient?.ingredientFamily, "cla");
});

test("science context keeps reds-pack blend rows ahead of generic vitamin anchors in superfood packet formulas", () => {
  const digest = buildDigest({
    labelId: "fixture-trace-reds-pak",
    productName: "Reds Pak, Mixed Berry",
    dosageForm: "Packet",
    actives: [
      { name: "Vitamin C", amount: 45, unit: "mg" },
      { name: "Vitamin A", amount: 250, unit: "iu" },
      { name: "Potassium", amount: 30, unit: "mg" },
      { name: "Calcium", amount: 10, unit: "mg" },
      { name: "Enzymes & Probiotics Blend", amount: 1642.5, unit: "mg" },
      { name: "Proprietary Liver Support Blend", amount: 1300, unit: "mg" },
      {
        name: "Proprietary Antioxidant Berry Blend",
        amount: 1085.5,
        unit: "mg",
      },
      {
        name: "Proprietary Fruit & Vegetable Blend",
        amount: 1072.5,
        unit: "mg",
      },
    ],
  });

  const context = buildIngredientScienceContext({
    digest,
    overlayClaims: {
      title: "Trace, Reds Pak, Mixed Berry, 30 Packets, 0.23 oz (6.5 g) Each",
      brandName: "Trace",
      nutritionalFacts: null,
    },
  });

  assert.match(context.ingredientRows[0]?.name ?? "", /\bblend\b/i);
  assert.doesNotMatch(
    context.ingredientRows[0]?.name ?? "",
    /\bvitamin c\b|\bpotassium\b|\bcalcium\b/i,
  );
});

test("science context prioritizes magnesium in calcium-magnesium buffered vitamin C stacks", () => {
  const digest = buildDigest({
    labelId: "fixture-buffered-vitamin-c-calcium-magnesium",
    productName: "Buffered Vitamin C with Calcium and Magnesium",
    dosageForm: "Vegetarian Capsule",
    actives: [
      { name: "Vitamin C (as Ascorbic Acid)", amount: 1000, unit: "mg" },
      { name: "Calcium (as Calcium Ascorbate)", amount: 120, unit: "mg" },
      { name: "Magnesium (as Magnesium Ascorbate)", amount: 60, unit: "mg" },
    ],
  });

  const context = buildIngredientScienceContext({
    digest,
    overlayClaims: null,
  });

  assert.match(
    context.ingredientRows[0]?.name ?? "",
    /\bcalcium\b.*\bmagnesium\b|\bmagnesium\b.*\bcalcium\b/i,
  );
  assert.equal(context.anchorIngredient?.ingredientFamily, "magnesium");
  assert.notEqual(
    context.ingredientRows[0]?.name,
    "Vitamin C (as Ascorbic Acid)",
  );
});

test("science context strips package-form adjectives from single mineral chewables", () => {
  const calciumContext = buildIngredientScienceContext({
    digest: buildDigest({
      labelId: "fixture-chewable-calcium",
      productName: "Chewable Calcium Citrate",
      dosageForm: "Chewable Tablet",
      actives: [{ name: "Chewable Calcium Citrate", amount: 250, unit: "mg" }],
    }),
    overlayClaims: null,
  });
  const ironContext = buildIngredientScienceContext({
    digest: buildDigest({
      labelId: "fixture-chewable-iron",
      productName: "Chewable Iron",
      dosageForm: "Chewable Tablet",
      actives: [{ name: "Chewable Iron", amount: 30, unit: "mg" }],
    }),
    overlayClaims: null,
  });

  assert.equal(calciumContext.ingredientRows[0]?.name, "Calcium Citrate");
  assert.equal(ironContext.ingredientRows[0]?.name, "Iron");
});

test("science context normalizes omega-3 and matcha rows to retain aligned ingredient names", () => {
  const omegaContext = buildIngredientScienceContext({
    digest: buildDigest({
      labelId: "fixture-vegan-omega3",
      productName: "Vegan Omega-3 Power",
      dosageForm: "Softgel",
      actives: [
        {
          name: "PureAlgaeOmega3 Triglyceride Algal Oil (with maximum naturally occurring SPMs, including Resolvins & Protectins)",
          amount: 2000,
          unit: "mg",
        },
      ],
    }),
    overlayClaims: null,
  });
  const greenTeaContext = buildIngredientScienceContext({
    digest: buildDigest({
      labelId: "fixture-matcha-green-tea",
      productName: "Organic Matcha Green Tea Powder",
      dosageForm: "Powder",
      actives: [
        {
          name: "Organic Matcha Tea (Camellia sinensis) Powder (leaf)",
          amount: 2,
          unit: "g",
        },
      ],
    }),
    overlayClaims: null,
  });

  assert.match(omegaContext.ingredientRows[0]?.name ?? "", /omega-3/i);
  assert.equal(omegaContext.anchorIngredient?.ingredientFamily, "omega_3");
  assert.match(greenTeaContext.ingredientRows[0]?.name ?? "", /green tea/i);
  assert.equal(
    greenTeaContext.anchorIngredient?.ingredientFamily,
    "green_tea_extract",
  );
});

test("science context rescues common title-led actives from macro residue rows", () => {
  const aloeContext = buildIngredientScienceContext({
    digest: buildDigest({
      labelId: "fixture-aloe-vera",
      productName: "Aloe Vera Concentrate",
      dosageForm: "Liquid",
      actives: [{ name: "Sugars", amount: 1, unit: "g" }],
    }),
    overlayClaims: null,
  });
  const aloeTitleWithSizeContext = buildIngredientScienceContext({
    digest: buildDigest({
      labelId: "fixture-now-aloe-vera-with-size",
      productName: "NOW Foods, Aloe Vera Concentrate, 4 fl oz (118 ml)",
      brandName: "NOW Foods",
      dosageForm: "Liquid",
      actives: [{ name: "Sugars", amount: 1, unit: "g" }],
    }),
    overlayClaims: {
      title: "NOW Foods, Aloe Vera Concentrate, 4 fl oz (118 ml)",
      brandName: "NOW Foods",
      nutritionalFacts: null,
    },
  });
  const fiberContext = buildIngredientScienceContext({
    digest: buildDigest({
      labelId: "fixture-apple-fiber",
      productName: "Apple Fiber Pure Powder",
      dosageForm: "Powder",
      actives: [{ name: "Potassium", amount: 54, unit: "mg" }],
    }),
    overlayClaims: null,
  });
  const potassiumContext = buildIngredientScienceContext({
    digest: buildDigest({
      labelId: "fixture-potassium-gluconate",
      productName: "Potassium Gluconate 90 mg",
      dosageForm: "Tablet",
      actives: [{ name: "Potassium", amount: 90, unit: "mg" }],
    }),
    overlayClaims: null,
  });
  const proteinContext = buildIngredientScienceContext({
    digest: buildDigest({
      labelId: "fixture-whey-protein",
      productName: "100% Whey Protein Powder",
      dosageForm: "Powder",
      actives: [{ name: "Potassium", amount: 120, unit: "mg" }],
    }),
    overlayClaims: null,
  });

  assert.match(aloeContext.ingredientRows[0]?.name ?? "", /aloe vera/i);
  assert.notEqual(aloeContext.ingredientRows[0]?.name, "Sugars");
  assert.match(
    aloeTitleWithSizeContext.ingredientRows[0]?.name ?? "",
    /aloe vera/i,
  );
  assert.notEqual(aloeTitleWithSizeContext.ingredientRows[0]?.name, "Sugars");
  assert.match(fiberContext.ingredientRows[0]?.name ?? "", /apple fiber/i);
  assert.notEqual(fiberContext.ingredientRows[0]?.name, "Potassium");
  assert.equal(fiberContext.anchorIngredient?.ingredientFamily, "fiber");
  assert.match(
    potassiumContext.ingredientRows[0]?.name ?? "",
    /potassium gluconate/i,
  );
  assert.match(proteinContext.ingredientRows[0]?.name ?? "", /whey protein/i);
  assert.equal(proteinContext.anchorIngredient?.ingredientFamily, "protein");
});

test("science context gives protein and fiber anchors family-specific research plans", () => {
  const fiberContext = buildIngredientScienceContext({
    digest: buildDigest({
      labelId: "fixture-apple-fiber-research",
      productName: "Apple Fiber Pure Powder",
      dosageForm: "Powder",
      actives: [{ name: "Apple Fiber", amount: 5, unit: "g" }],
    }),
    overlayClaims: null,
  });
  const proteinContext = buildIngredientScienceContext({
    digest: buildDigest({
      labelId: "fixture-whey-protein-research",
      productName: "100% Whey Protein Powder",
      dosageForm: "Powder",
      actives: [{ name: "Whey Protein Isolate", amount: 25, unit: "g" }],
    }),
    overlayClaims: null,
  });

  const fiberPlan = planScientificBackgroundSections({
    context: fiberContext,
    selectedIngredientName: "Apple Fiber",
  });
  const proteinPlan = planScientificBackgroundSections({
    context: proteinContext,
    selectedIngredientName: "Whey Protein Isolate",
  });

  assert.equal(fiberPlan.mode, "research_mode");
  assert.deepEqual(
    fiberPlan.sections.map((section) => section.heading),
    [
      "Digestive regularity context",
      "Satiety and gut context",
      "Source and solubility context",
    ],
  );
  assert.equal(proteinPlan.mode, "research_mode");
  assert.deepEqual(
    proteinPlan.sections.map((section) => section.heading),
    [
      "Muscle and recovery context",
      "Satiety and meal-support context",
      "Protein type and disclosure context",
    ],
  );
});

test("science context rescues trace minerals titles ahead of aloe and macro residue rows", async () => {
  const context = buildIngredientScienceContext({
    digest: buildDigest({
      labelId: "fixture-trace-minerals-title-rescue",
      productName:
        "Tropical Oasis, Premium Ionized Trace Minerals, 16 fl oz (480 ml)",
      dosageForm: "Liquid",
      actives: [
        { name: "Calories", amount: 10, unit: null },
        { name: "Aloe vera gel 200:1 extract", amount: 250, unit: "mg" },
        { name: "Colloidal Minerals", amount: 198, unit: "mg" },
      ],
    }),
    overlayClaims: {
      title:
        "Tropical Oasis, Premium Ionized Trace Minerals, 16 fl oz (480 ml)",
      brandName: "Tropical Oasis",
      nutritionalFacts: null,
    },
  });

  assert.match(context.anchorIngredient?.name ?? "", /trace minerals/i);
  assert.match(context.ingredientRows[0]?.name ?? "", /trace minerals/i);

  const overview = await compileIngredientOverviewAsync(
    context,
    context.anchorIngredient?.name ?? "Trace Minerals",
  );
  const scientific = buildScientificBackgroundDeterministicFallback({
    context,
    selectedIngredientName: context.anchorIngredient?.name ?? "Trace Minerals",
  });

  assert.match(overview.ingredientOverview.paragraph1, /trace minerals/i);
  assert.match(scientific.selectedLabel, /trace minerals/i);
});

test("science context uses iHerb overlay title as ranking context when official product name is sparse", () => {
  const digest = buildDigest({
    labelId: "fixture-osfortis-short-official-name",
    productName: "Osfortis",
    dosageForm: "Capsule",
    actives: [
      { name: "Vitamin D", amount: 10, unit: "mcg" },
      { name: "Osfortis", amount: null, unit: null },
    ],
  });

  const context = buildIngredientScienceContext({
    digest,
    overlayClaims: {
      title: "BioGaia, Osfortis with Vitamin D, 60 Probiotic Capsules",
      brandName: "BioGaia",
      nutritionalFacts: null,
    },
  });

  assert.match(context.ingredientRows[0]?.name ?? "", /probiotic/i);
  assert.equal(
    context.anchorIngredient?.ingredientFamily,
    "probiotic_or_blend",
  );
  assert.notEqual(context.ingredientRows[0]?.name, "Vitamin D");
});

test("science context prefers aggregate multivitamin formula rows over trace inositol rows", () => {
  const bluebonnetContext = buildIngredientScienceContext({
    digest: buildDigest({
      labelId: "fixture-multione-iron-free",
      productName: "MultiONE®, Single Daily Multiple, Iron-Free",
      dosageForm: "Vegetable Capsule",
      actives: [
        { name: "Inositol", amount: 25, unit: "mg" },
        { name: "Magnesium (as magnesium aspartate)", amount: 10, unit: "mg" },
        { name: "Thiamin (as thiamin mononitrate)", amount: 25, unit: "mg" },
        { name: "Biotin", amount: 300, unit: "mcg" },
      ],
    }),
    overlayClaims: {
      title:
        "Bluebonnet Nutrition, MultiONE®, Single Daily Multiple, Iron-Free, 120 Vegetable Capsules",
      brandName: "Bluebonnet Nutrition",
      nutritionalFacts: null,
    },
  });
  const countryLifeContext = buildIngredientScienceContext({
    digest: buildDigest({
      labelId: "fixture-daily-total-one-iron-free",
      productName: "Daily Total One®, Iron Free",
      dosageForm: "Vegan Capsule",
      actives: [
        {
          name: "Inositol (as inositol, inositol hexanicotinate)",
          amount: 20,
          unit: "mg",
        },
        { name: "Magnesium (as magnesium citrate)†", amount: 8, unit: "mg" },
        { name: "Biotin (as d-Biotin)", amount: 100, unit: "mcg" },
        { name: "Choline (from choline bitartrate)", amount: 12, unit: "mg" },
      ],
    }),
    overlayClaims: {
      title: "Country Life, Daily Total One®, Iron Free, 60 Vegan Capsules",
      brandName: "Country Life",
      nutritionalFacts: null,
    },
  });

  assert.equal(
    bluebonnetContext.ingredientRows[0]?.name,
    "Multivitamin & Mineral Formula",
  );
  assert.notEqual(bluebonnetContext.ingredientRows[0]?.name, "Inositol");
  assert.equal(
    countryLifeContext.ingredientRows[0]?.name,
    "Multivitamin & Mineral Formula",
  );
  assert.notEqual(
    countryLifeContext.ingredientRows[0]?.name,
    "Inositol (as inositol, inositol hexanicotinate)",
  );
});

test("science context treats daily multi formula titles as multivitamin family anchors", () => {
  const context = buildIngredientScienceContext({
    digest: buildDigest({
      labelId: "fixture-womens-daily-multi-formula",
      productName: "Women's Daily Multi Formula",
      dosageForm: "Caplet",
      actives: [
        { name: "Vitamin A (as acetate)", amount: 750, unit: "mcg RAE" },
        { name: "Vitamin C (ascorbic acid)", amount: 60, unit: "mg" },
        { name: "Calcium (calcium carbonate)", amount: 500, unit: "mg" },
        { name: "Magnesium (magnesium oxide)", amount: 50, unit: "mg" },
        { name: "Zinc (zinc oxide)", amount: 15, unit: "mg" },
      ],
    }),
    overlayClaims: {
      title: "Mason Natural, Women's Daily Multi Formula, 90 Caplets",
      brandName: "Mason Natural",
      nutritionalFacts: null,
    },
  });

  assert.equal(
    context.ingredientRows[0]?.name,
    "Multivitamin & Mineral Formula",
  );
  assert.notEqual(
    context.ingredientRows[0]?.name,
    "Magnesium (magnesium oxide)",
  );
});

test("science context treats Vitamin B+ titles as B-complex family anchors", () => {
  const context = buildIngredientScienceContext({
    digest: buildDigest({
      labelId: "fixture-bodybio-vitamin-b-plus",
      productName: "BodyBio, Vitamin B+, 90 Capsules",
      dosageForm: "Capsule",
      actives: [
        { name: "Vitamin B1 (as thiamine HCL)", amount: 84, unit: "mg" },
        { name: "Vitamin B2 (as riboflavin)", amount: 67, unit: "mg" },
        { name: "Inositol", amount: 84, unit: "mg" },
      ],
    }),
    overlayClaims: null,
  });

  assert.match(context.ingredientRows[0]?.name ?? "", /b-complex|vitamin b/i);
  assert.notEqual(context.ingredientRows[0]?.name, "Inositol");
});

test("science context treats male multiple titles as multivitamin family anchors", () => {
  const context = buildIngredientScienceContext({
    digest: buildDigest({
      labelId: "fixture-solgar-male-multiple",
      productName: "Solgar, Male Multiple, 120 Tablets",
      dosageForm: "Tablet",
      actives: [
        {
          name: "Vitamin C (as L-ascorbic acid, niacinamide ascorbate)",
          amount: 400,
          unit: "mg",
        },
        { name: "Vitamin D (as ergocalciferol)", amount: 10, unit: "mcg" },
        { name: "Inositol", amount: 25, unit: "mg" },
      ],
    }),
    overlayClaims: null,
  });

  assert.equal(
    context.ingredientRows[0]?.name,
    "Multivitamin & Mineral Formula",
  );
  assert.notEqual(context.ingredientRows[0]?.name, "Inositol");
});

test("science context treats just-one multi with iron titles as multivitamin family anchors", () => {
  const context = buildIngredientScienceContext({
    digest: buildDigest({
      labelId: "fixture-just-one-multi-with-iron",
      productName: "Just One Multi with Iron",
      dosageForm: "Tablet",
      actives: [
        { name: "Vitamin C (as ascorbic acid)", amount: 1500, unit: "mcg" },
        { name: "Thiamin (as thiamin mononitrate)", amount: 25, unit: "mcg" },
        { name: "Iron", amount: 18, unit: "mg" },
      ],
    }),
    overlayClaims: {
      title: "Swanson, Just One Multi with Iron, 130 Tablets",
      brandName: "Swanson",
      nutritionalFacts: null,
    },
  });

  assert.equal(
    context.ingredientRows[0]?.name,
    "Multivitamin & Mineral Formula",
  );
  assert.notEqual(context.ingredientRows[0]?.name, "Iron");
});

test("science context treats minimal and essential broad nutrient formulas as multivitamin family anchors", () => {
  const context = buildIngredientScienceContext({
    digest: buildDigest({
      labelId: "fixture-vital-nutrients-minimal-essential",
      productName: "Minimal and Essential",
      dosageForm: "Vegan Capsule",
      actives: [
        {
          name: "Vitamin A (as 67% beta carotene and 33% acetate)",
          amount: 1500,
          unit: "mcg",
        },
        { name: "Vitamin C (as ascorbic acid)", amount: 500, unit: "mg" },
        { name: "Vitamin D3 (as cholecalciferol)", amount: 50, unit: "mcg" },
        {
          name: "Vitamin E (as d-alpha tocopheryl succinate)",
          amount: 67,
          unit: "mg",
        },
        { name: "Zinc (as zinc citrate)", amount: 10, unit: "mg" },
        { name: "Selenium (as selenomethionine)", amount: 100, unit: "mcg" },
      ],
    }),
    overlayClaims: {
      title: "Vital Nutrients, Minimal and Essential, 90 Vegan Capsules",
      brandName: "Vital Nutrients",
      nutritionalFacts: null,
    },
  });

  assert.equal(
    context.ingredientRows[0]?.name,
    "Multivitamin & Mineral Formula",
  );
  assert.notEqual(context.ingredientRows[0]?.name, "Zinc (as zinc citrate)");
});

test("science context treats ladies choice whole-food multiple titles as multivitamin family anchors", () => {
  const context = buildIngredientScienceContext({
    digest: buildDigest({
      labelId: "fixture-ladies-choice-multiple",
      productName:
        "Bluebonnet Nutrition, Ladies' Choice, Whole Food Based Multiple, Ladies 18-49, 90 Caplets",
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

  assert.equal(
    context.ingredientRows[0]?.name,
    "Multivitamin & Mineral Formula",
  );
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
        {
          name: "Magnesium (as magnesium oxide and lysyl glycinate chelate)",
          amount: 50,
          unit: "mg",
        },
      ],
    }),
    overlayClaims: null,
  });

  assert.equal(
    context.ingredientRows[0]?.name,
    "Multivitamin & Mineral Formula",
  );
  assert.notEqual(
    context.ingredientRows[0]?.name,
    "Magnesium (as magnesium oxide and lysyl glycinate chelate)",
  );
});

test("science context treats men's multi titles as multivitamin family anchors", () => {
  const context = buildIngredientScienceContext({
    digest: buildDigest({
      labelId: "fixture-now-adam-superior-mens-multi",
      productName: "NOW Foods, ADAM, Superior Men's Multi, 60 Tablets",
      dosageForm: "Tablet",
      actives: [
        {
          name: "Vitamin A (100% as Beta-Carotene)",
          amount: 2250,
          unit: "mcg",
        },
        { name: "Vitamin C (from Calcium Ascorbate)", amount: 250, unit: "mg" },
        { name: "Magnesium (from Magnesium Citrate)", amount: 25, unit: "mg" },
        { name: "Inositol", amount: 12.5, unit: "mg" },
      ],
    }),
    overlayClaims: null,
  });

  assert.equal(
    context.ingredientRows[0]?.name,
    "Multivitamin & Mineral Formula",
  );
  assert.notEqual(context.ingredientRows[0]?.name, "Inositol");
});

test("science context treats No. 7 joint support titles as joint complex anchors", () => {
  const context = buildIngredientScienceContext({
    digest: buildDigest({
      labelId: "fixture-solgar-no7-joint-support",
      productName:
        "Solgar, No. 7, Advanced Joint Support Complex, 30 Vegetable Capsules",
      dosageForm: "Vegetable Capsule",
      actives: [
        { name: "Vitamin C", amount: 100, unit: "mg" },
        { name: "Turmeric Root", amount: 50, unit: "mg" },
        { name: "Total Collagen", amount: 40, unit: "mg" },
        {
          name: "5-Loxin Advanced Boswellia serrata Extract",
          amount: 100,
          unit: "mg",
        },
      ],
    }),
    overlayClaims: null,
  });

  assert.match(
    context.ingredientRows[0]?.name ?? "",
    /joint support|collagen/i,
  );
  assert.notEqual(context.ingredientRows[0]?.name, "Vitamin C");
});

test("science context keeps turmeric gummies anchored to turmeric instead of food-like form", () => {
  const context = buildIngredientScienceContext({
    digest: buildDigest({
      labelId: "fixture-jamieson-turmeric-gummies",
      productName: "Jamieson, Turmeric Gummies, Joint Pain Relief",
      dosageForm: "Gummy",
      actives: [
        {
          name: "Turmeric (25:1) extract (Curcuma longa, rhizome)",
          amount: 6250,
          unit: "mg",
        },
      ],
    }),
    overlayClaims: null,
  });

  assert.match(
    context.ingredientRows[0]?.name ?? "",
    /\bturmeric\b|\bcurcumin\b/i,
  );
  assert.notEqual(context.ingredientRows[0]?.name, "Food-based product");
  assert.equal(context.anchorIngredient?.ingredientFamily, "turmeric");
});

test("science context gives standard turmeric extracts a turmeric-specific research plan", () => {
  const context = buildIngredientScienceContext({
    digest: buildDigest({
      labelId: "fixture-turmeric-curcuminoid-capsule",
      productName: "Turmeric Curcuminoid Complex",
      dosageForm: "Capsule",
      actives: [
        { name: "Turmeric Extract (Curcuma longa)", amount: 500, unit: "mg" },
      ],
    }),
    overlayClaims: null,
  });
  const turmericPlan = planScientificBackgroundSections({
    context,
    selectedIngredientName:
      context.anchorIngredient?.name ?? "Turmeric Extract (Curcuma longa)",
  });

  assert.equal(context.anchorIngredient?.ingredientFamily, "turmeric");
  assert.equal(turmericPlan.mode, "research_mode");
  assert.deepEqual(
    turmericPlan.sections.map((section) => section.heading),
    [
      "Turmeric traditional and modern context",
      "Extract and curcuminoid detail",
      "Where turmeric and curcumin diverge",
    ],
  );
});

test("science context rescues ParaFight titles ahead of opaque blend rows", () => {
  const context = buildIngredientScienceContext({
    digest: buildDigest({
      labelId: "fixture-parafight-opaque-blend",
      productName:
        "Eclectic Herb, Parafight, Intestinal Support, 2 fl oz (60 ml)",
      dosageForm: "Liquid",
      actives: [
        { name: "Proprietary Blend", amount: null, unit: null },
        { name: "Contains tree nuts (black walnut)", amount: null, unit: null },
      ],
    }),
    overlayClaims: null,
  });

  assert.equal(context.ingredientRows[0]?.name, "ParaFight Herbal Blend");
  assert.notEqual(context.ingredientRows[0]?.name, "Proprietary Blend");
  assert.notEqual(
    context.ingredientRows[0]?.name,
    "Contains tree nuts (black walnut)",
  );
});

test("science context rescues EGCG as the default anchor from branded cytokine blend rows", () => {
  const digest = buildDigest({
    labelId: "fixture-cytokine-suppress-egcg",
    productName: "Cytokine Suppress with EGCG",
    dosageForm: "Vegetarian Capsule",
    actives: [{ name: "Cytokine Suppress", amount: 240, unit: "mg" }],
  });

  const context = buildIngredientScienceContext({
    digest,
    overlayClaims: null,
  });

  assert.match(context.ingredientRows[0]?.name ?? "", /\begcg|green tea/i);
  assert.equal(context.anchorIngredient?.ingredientFamily, "green_tea_extract");
  assert.notEqual(context.ingredientRows[0]?.name, "Cytokine Suppress");
});

test("science context rescues probiotic anchors ahead of opaque proprietary blends", () => {
  const digest = buildDigest({
    labelId: "fixture-essential-biotic-proprietary-blend",
    productName: "Essential-Biotic Complete, 50 Billion CFU",
    dosageForm: "Delayed-Release Vegetarian Capsule",
    actives: [{ name: "Proprietary Blend", amount: 150.88, unit: "mg" }],
  });

  const context = buildIngredientScienceContext({
    digest,
    overlayClaims: null,
  });

  assert.match(context.ingredientRows[0]?.name ?? "", /probiotic/i);
  assert.equal(
    context.anchorIngredient?.ingredientFamily,
    "probiotic_or_blend",
  );
  assert.notEqual(context.ingredientRows[0]?.name, "Proprietary Blend");
});

test("science context does not synthesize probiotic anchors for broad microbiome wording alone", () => {
  const context = buildIngredientScienceContext({
    digest: buildDigest({
      labelId: "fixture-dentalcidin-oral-microbiome-rinse",
      productName:
        "Biocidin Botanicals, Dentalcidin LS Oral Microbiome Liposomal Rinse Natural Mint",
      dosageForm: "Liquid",
      actives: [
        { name: "Biocidin", amount: null, unit: "np" },
        { name: "Myrrh", amount: null, unit: "np" },
        { name: "Clove bud Oil", amount: null, unit: "np" },
        { name: "Quercetin", amount: null, unit: "np" },
      ],
    }),
    overlayClaims: null,
  });

  assert.match(context.ingredientRows[0]?.name ?? "", /biocidin/i);
  assert.doesNotMatch(context.ingredientRows[0]?.name ?? "", /^probiotics?$/i);
  assert.notEqual(
    context.anchorIngredient?.ingredientFamily,
    "probiotic_or_blend",
  );
});

test("science context rescues title-led botanicals ahead of proprietary blend and alcohol rows", () => {
  const echinaceaContext = buildIngredientScienceContext({
    digest: buildDigest({
      labelId: "fixture-echinacea-goldenseal-proprietary-blend",
      productName: "Eclectic Herb, Herb, Echinacea Goldenseal, 1 fl oz (30 ml)",
      dosageForm: "Liquid",
      actives: [{ name: "Proprietary Blend", amount: 1, unit: "ml" }],
    }),
    overlayClaims: null,
  });
  const lemonBalmContext = buildIngredientScienceContext({
    digest: buildDigest({
      labelId: "fixture-lemon-balm-alcohol",
      productName: "Eclectic Herb, Lemon Balm Extract, 2 fl oz (60 ml)",
      dosageForm: "Liquid",
      actives: [{ name: "Alcohol", amount: 45, unit: "%" }],
    }),
    overlayClaims: null,
  });
  const moodSaffronContext = buildIngredientScienceContext({
    digest: buildDigest({
      labelId: "fixture-genuine-health-mood-saffron-turmeric",
      productName: "Genuine Health, mood with saffron and turmeric",
      dosageForm: "Capsule",
      actives: [
        {
          name: "affron Saffron Standardized Extract (Crocus sativus)",
          amount: 14,
          unit: "mg",
        },
        {
          name: "Turmeric Standardized Extract (Curcuma longa)",
          amount: 75,
          unit: "mg",
        },
      ],
    }),
    overlayClaims: null,
  });
  const stressAshwagandhaContext = buildIngredientScienceContext({
    digest: buildDigest({
      labelId: "fixture-genuine-health-stress-ashwagandha-saffron",
      productName:
        "Genuine Health, stress with ashwagandha saffron and passionflower",
      dosageForm: "Capsule",
      actives: [
        {
          name: "affron Saffron Standardized Extract (Crocus sativus)",
          amount: 14,
          unit: "mg",
        },
        {
          name: "KSM-66 Ashwagandha Standardized Extract (Withania somnifera)",
          amount: 300,
          unit: "mg",
        },
        {
          name: "Passionflower Extract (Passiflora incarnata)",
          amount: 250,
          unit: "mg",
        },
      ],
    }),
    overlayClaims: null,
  });

  assert.match(
    echinaceaContext.ingredientRows[0]?.name ?? "",
    /echinacea|goldenseal/i,
  );
  assert.doesNotMatch(
    echinaceaContext.ingredientRows[0]?.name ?? "",
    /proprietary blend/i,
  );
  assert.match(lemonBalmContext.ingredientRows[0]?.name ?? "", /lemon balm/i);
  assert.notEqual(lemonBalmContext.ingredientRows[0]?.name, "Alcohol");
  assert.match(
    moodSaffronContext.ingredientRows[0]?.name ?? "",
    /saffron|crocus/i,
  );
  assert.match(moodSaffronContext.ingredientRows[0]?.name ?? "", /^saffron\b/i);
  assert.doesNotMatch(
    moodSaffronContext.ingredientRows[0]?.name ?? "",
    /^affron\b/i,
  );
  assert.doesNotMatch(
    moodSaffronContext.ingredientRows[0]?.name ?? "",
    /turmeric/i,
  );
  assert.match(
    stressAshwagandhaContext.ingredientRows[0]?.name ?? "",
    /ashwagandha/i,
  );
});

test("science context rescues tart cherry titles ahead of sugars", () => {
  const context = buildIngredientScienceContext({
    digest: buildDigest({
      labelId: "fixture-tart-cherry-powder",
      productName: "Eclectic Herb, Berry Tart Cherry Powder, 5.1 oz (144 g)",
      dosageForm: "Powder",
      actives: [
        { name: "Calories", amount: 35, unit: null },
        { name: "Total carbohydrate", amount: 7, unit: "g" },
        { name: "Sugars", amount: 5, unit: "g" },
      ],
    }),
    overlayClaims: null,
  });

  assert.match(context.ingredientRows[0]?.name ?? "", /tart cherry/i);
  assert.notEqual(context.ingredientRows[0]?.name, "Sugars");
});

test("science context rescues quercetin recovery titles ahead of probiotic companions", () => {
  const context = buildIngredientScienceContext({
    digest: buildDigest({
      labelId: "fixture-quercetin-recovery",
      productName:
        "Garden of Life, Dr. Formulated, Quercetin Recovery, 30 Vegan Tablets",
      dosageForm: "Tablet",
      actives: [{ name: "Bacillus subtilis DE111®", amount: 5, unit: "mg" }],
    }),
    overlayClaims: null,
  });

  assert.match(context.ingredientRows[0]?.name ?? "", /quercetin/i);
  assert.doesNotMatch(context.ingredientRows[0]?.name ?? "", /probiotic/i);
  assert.equal(context.anchorIngredient?.ingredientFamily, "quercetin");
});

test("science context classifies promoted P0 expansion families as concrete runtime families", () => {
  const vitaminEContext = buildIngredientScienceContext({
    digest: buildDigest({
      labelId: "fixture-vitamin-e-family",
      productName: "Natural Vitamin E 400 IU",
      dosageForm: "Softgel",
      actives: [
        {
          name: "Vitamin E (as d-Alpha Tocopheryl Acetate)",
          amount: 400,
          unit: "IU",
        },
      ],
    }),
    overlayClaims: null,
  });
  const vitaminK2Context = buildIngredientScienceContext({
    digest: buildDigest({
      labelId: "fixture-vitamin-k2-family",
      productName: "Vitamin K2 MK-7, 100 mcg",
      dosageForm: "Capsule",
      actives: [
        { name: "Vitamin K2 (as Menaquinone-7)", amount: 100, unit: "mcg" },
      ],
    }),
    overlayClaims: null,
  });
  const chromiumContext = buildIngredientScienceContext({
    digest: buildDigest({
      labelId: "fixture-chromium-family",
      productName: "Chromium Picolinate 200 mcg",
      dosageForm: "Capsule",
      actives: [
        { name: "Chromium (as Chromium Picolinate)", amount: 200, unit: "mcg" },
      ],
    }),
    overlayClaims: null,
  });
  const seleniumContext = buildIngredientScienceContext({
    digest: buildDigest({
      labelId: "fixture-selenium-family",
      productName: "Selenium 200 mcg",
      dosageForm: "Capsule",
      actives: [
        { name: "Selenium (as L-Selenomethionine)", amount: 200, unit: "mcg" },
      ],
    }),
    overlayClaims: null,
  });
  const vitaminAContext = buildIngredientScienceContext({
    digest: buildDigest({
      labelId: "fixture-vitamin-a-family",
      productName: "Vitamin A 10,000 IU",
      dosageForm: "Softgel",
      actives: [
        { name: "Vitamin A (as Retinyl Palmitate)", amount: 3000, unit: "mcg" },
      ],
    }),
    overlayClaims: null,
  });
  const dglContext = buildIngredientScienceContext({
    digest: buildDigest({
      labelId: "fixture-dgl-family",
      productName: "DGL Licorice Chewables",
      dosageForm: "Chewable",
      actives: [
        {
          name: "Deglycyrrhizinated Licorice Root Extract",
          amount: 400,
          unit: "mg",
        },
      ],
    }),
    overlayClaims: null,
  });
  const kavaContext = buildIngredientScienceContext({
    digest: buildDigest({
      labelId: "fixture-kava-family",
      productName: "Kava Kava Root Extract",
      dosageForm: "Capsule",
      actives: [
        { name: "Kava Extract (Piper methysticum)", amount: 250, unit: "mg" },
      ],
    }),
    overlayClaims: null,
  });
  const slipperyElmContext = buildIngredientScienceContext({
    digest: buildDigest({
      labelId: "fixture-slippery-elm-family",
      productName: "Slippery Elm Inner Bark",
      dosageForm: "Lozenge",
      actives: [{ name: "Slippery Elm Bark", amount: 400, unit: "mg" }],
    }),
    overlayClaims: null,
  });
  const glutathioneContext = buildIngredientScienceContext({
    digest: buildDigest({
      labelId: "fixture-glutathione-family",
      productName: "Liposomal Glutathione",
      dosageForm: "Liquid",
      actives: [{ name: "Reduced Glutathione", amount: 500, unit: "mg" }],
    }),
    overlayClaims: null,
  });
  const alphaLipoicAcidContext = buildIngredientScienceContext({
    digest: buildDigest({
      labelId: "fixture-alpha-lipoic-acid-family",
      productName: "Alpha-Lipoic Acid 600 mg",
      dosageForm: "Capsule",
      actives: [{ name: "Alpha-Lipoic Acid", amount: 600, unit: "mg" }],
    }),
    overlayClaims: null,
  });
  const biotinContext = buildIngredientScienceContext({
    digest: buildDigest({
      labelId: "fixture-biotin-family",
      productName: "Biotin 10,000 mcg",
      dosageForm: "Tablet",
      actives: [{ name: "Biotin", amount: 10000, unit: "mcg" }],
    }),
    overlayClaims: null,
  });
  const copperContext = buildIngredientScienceContext({
    digest: buildDigest({
      labelId: "fixture-copper-family",
      productName: "Copper Bisglycinate 2 mg",
      dosageForm: "Capsule",
      actives: [
        { name: "Copper (as Copper Bisglycinate)", amount: 2, unit: "mg" },
      ],
    }),
    overlayClaims: null,
  });
  const riboflavinContext = buildIngredientScienceContext({
    digest: buildDigest({
      labelId: "fixture-riboflavin-family",
      productName: "Riboflavin Vitamin B2 100 mg",
      dosageForm: "Capsule",
      actives: [{ name: "Riboflavin (Vitamin B2)", amount: 100, unit: "mg" }],
    }),
    overlayClaims: null,
  });
  const aloeVeraContext = buildIngredientScienceContext({
    digest: buildDigest({
      labelId: "fixture-aloe-vera-family",
      productName: "Aloe Vera Inner Leaf Extract",
      dosageForm: "Softgel",
      actives: [{ name: "Aloe Vera Inner Leaf", amount: 5000, unit: "mg" }],
    }),
    overlayClaims: null,
  });
  const newestWaveContexts = [
    {
      expected: "arginine_alpha_ketoglutarate",
      context: buildIngredientScienceContext({
        digest: buildDigest({
          labelId: "fixture-l-arginine-family",
          productName: "L-Arginine AAKG 1000 mg",
          dosageForm: "Capsule",
          actives: [
            {
              name: "L-Arginine Alpha-Ketoglutarate",
              amount: 1000,
              unit: "mg",
            },
          ],
        }),
        overlayClaims: null,
      }),
    },
    {
      expected: "potassium",
      context: buildIngredientScienceContext({
        digest: buildDigest({
          labelId: "fixture-potassium-family",
          productName: "Potassium Gluconate 90 mg",
          dosageForm: "Capsule",
          actives: [{ name: "Potassium", amount: 90, unit: "mg" }],
        }),
        overlayClaims: null,
      }),
    },
    {
      expected: "bromelain",
      context: buildIngredientScienceContext({
        digest: buildDigest({
          labelId: "fixture-bromelain-family",
          productName: "Bromelain 2400 GDU",
          dosageForm: "Capsule",
          actives: [{ name: "Bromelain 2400 GDU", amount: 500, unit: "mg" }],
        }),
        overlayClaims: null,
      }),
    },
    {
      expected: "choline",
      context: buildIngredientScienceContext({
        digest: buildDigest({
          labelId: "fixture-choline-family",
          productName: "Choline Bitartrate",
          dosageForm: "Capsule",
          actives: [{ name: "Choline Bitartrate", amount: 500, unit: "mg" }],
        }),
        overlayClaims: null,
      }),
    },
    {
      expected: "citrulline_malate",
      context: buildIngredientScienceContext({
        digest: buildDigest({
          labelId: "fixture-citrulline-malate-family",
          productName: "Citrulline Malate 2:1",
          dosageForm: "Powder",
          actives: [{ name: "Citrulline Malate", amount: 6000, unit: "mg" }],
        }),
        overlayClaims: null,
      }),
    },
    {
      expected: "d_ribose",
      context: buildIngredientScienceContext({
        digest: buildDigest({
          labelId: "fixture-d-ribose-family",
          productName: "D-Ribose Powder",
          dosageForm: "Powder",
          actives: [{ name: "D-Ribose", amount: 5, unit: "g" }],
        }),
        overlayClaims: null,
      }),
    },
    {
      expected: "l_methionine",
      context: buildIngredientScienceContext({
        digest: buildDigest({
          labelId: "fixture-l-methionine-family",
          productName: "L-Methionine",
          dosageForm: "Capsule",
          actives: [{ name: "L-Methionine", amount: 500, unit: "mg" }],
        }),
        overlayClaims: null,
      }),
    },
    {
      expected: "nicotinamide_mononucleotide",
      context: buildIngredientScienceContext({
        digest: buildDigest({
          labelId: "fixture-nmn-family",
          productName: "Nicotinamide Mononucleotide NMN",
          dosageForm: "Capsule",
          actives: [
            {
              name: "Nicotinamide Mononucleotide",
              amount: 250,
              unit: "mg",
            },
          ],
        }),
        overlayClaims: null,
      }),
    },
    {
      expected: "thiamin",
      context: buildIngredientScienceContext({
        digest: buildDigest({
          labelId: "fixture-thiamin-family",
          productName: "Thiamin Vitamin B1",
          dosageForm: "Capsule",
          actives: [{ name: "Thiamin (Vitamin B1)", amount: 100, unit: "mg" }],
        }),
        overlayClaims: null,
      }),
    },
    {
      expected: "valerian",
      context: buildIngredientScienceContext({
        digest: buildDigest({
          labelId: "fixture-valerian-family",
          productName: "Valerian Root Extract",
          dosageForm: "Capsule",
          actives: [{ name: "Valerian Root Extract", amount: 500, unit: "mg" }],
        }),
        overlayClaims: null,
      }),
    },
    {
      expected: "l_valine",
      context: buildIngredientScienceContext({
        digest: buildDigest({
          labelId: "fixture-l-valine-family",
          productName: "L-Valine Free Form",
          dosageForm: "Capsule",
          actives: [{ name: "L-Valine", amount: 500, unit: "mg" }],
        }),
        overlayClaims: null,
      }),
    },
    {
      expected: "beta_alanine",
      context: buildIngredientScienceContext({
        digest: buildDigest({
          labelId: "fixture-beta-alanine-family",
          productName: "Beta-Alanine CarnoSyn",
          dosageForm: "Powder",
          actives: [{ name: "Beta-Alanine", amount: 3200, unit: "mg" }],
        }),
        overlayClaims: null,
      }),
    },
    {
      expected: "carnosine",
      context: buildIngredientScienceContext({
        digest: buildDigest({
          labelId: "fixture-carnosine-family",
          productName: "L-Carnosine",
          dosageForm: "Capsule",
          actives: [{ name: "L-Carnosine", amount: 500, unit: "mg" }],
        }),
        overlayClaims: null,
      }),
    },
    {
      expected: "citicoline",
      context: buildIngredientScienceContext({
        digest: buildDigest({
          labelId: "fixture-citicoline-family",
          productName: "Citicoline CDP-Choline",
          dosageForm: "Capsule",
          actives: [
            { name: "Citicoline (CDP-Choline)", amount: 250, unit: "mg" },
          ],
        }),
        overlayClaims: null,
      }),
    },
    {
      expected: "nicotinamide_riboside",
      context: buildIngredientScienceContext({
        digest: buildDigest({
          labelId: "fixture-nr-family",
          productName: "Nicotinamide Riboside",
          dosageForm: "Capsule",
          actives: [{ name: "Nicotinamide Riboside", amount: 300, unit: "mg" }],
        }),
        overlayClaims: null,
      }),
    },
    {
      expected: "colostrum",
      context: buildIngredientScienceContext({
        digest: buildDigest({
          labelId: "fixture-colostrum-family",
          productName: "Bovine Colostrum",
          dosageForm: "Powder",
          actives: [{ name: "Bovine Colostrum", amount: 1000, unit: "mg" }],
        }),
        overlayClaims: null,
      }),
    },
    {
      expected: "spirulina",
      context: buildIngredientScienceContext({
        digest: buildDigest({
          labelId: "fixture-spirulina-family",
          productName: "Spirulina Tablets",
          dosageForm: "Tablet",
          actives: [{ name: "Spirulina", amount: 1000, unit: "mg" }],
        }),
        overlayClaims: null,
      }),
    },
    {
      expected: "vitamin_k1",
      context: buildIngredientScienceContext({
        digest: buildDigest({
          labelId: "fixture-vitamin-k1-family",
          productName: "Vitamin K1 Phylloquinone",
          dosageForm: "Capsule",
          actives: [
            { name: "Vitamin K1 (Phylloquinone)", amount: 100, unit: "mcg" },
          ],
        }),
        overlayClaims: null,
      }),
    },
    {
      expected: "manganese",
      context: buildIngredientScienceContext({
        digest: buildDigest({
          labelId: "fixture-manganese-family",
          productName: "Manganese Bisglycinate",
          dosageForm: "Capsule",
          actives: [
            {
              name: "Manganese (as Manganese Bisglycinate)",
              amount: 2,
              unit: "mg",
            },
          ],
        }),
        overlayClaims: null,
      }),
    },
    {
      expected: "chamomile",
      context: buildIngredientScienceContext({
        digest: buildDigest({
          labelId: "fixture-chamomile-family",
          productName: "Chamomile Extract",
          dosageForm: "Capsule",
          actives: [{ name: "Chamomile Extract", amount: 500, unit: "mg" }],
        }),
        overlayClaims: null,
      }),
    },
    {
      expected: "astragalus",
      context: buildIngredientScienceContext({
        digest: buildDigest({
          labelId: "fixture-astragalus-family",
          productName: "Astragalus Extract",
          dosageForm: "Capsule",
          actives: [{ name: "Astragalus Extract", amount: 500, unit: "mg" }],
        }),
        overlayClaims: null,
      }),
    },
    {
      expected: "cinnamon_extract",
      context: buildIngredientScienceContext({
        digest: buildDigest({
          labelId: "fixture-cinnamon-family",
          productName: "Cinnamon Bark Extract",
          dosageForm: "Capsule",
          actives: [{ name: "Cinnamon Bark Extract", amount: 500, unit: "mg" }],
        }),
        overlayClaims: null,
      }),
    },
    {
      expected: "grape_seed_extract",
      context: buildIngredientScienceContext({
        digest: buildDigest({
          labelId: "fixture-grape-seed-family",
          productName: "Grape Seed Extract",
          dosageForm: "Capsule",
          actives: [{ name: "Grape Seed Extract", amount: 100, unit: "mg" }],
        }),
        overlayClaims: null,
      }),
    },
    {
      expected: "serrapeptase",
      context: buildIngredientScienceContext({
        digest: buildDigest({
          labelId: "fixture-serrapeptase-family",
          productName: "Serrapeptase Enteric",
          dosageForm: "Capsule",
          actives: [
            { name: "Serrapeptase 120,000 SPU", amount: 120000, unit: "SPU" },
          ],
        }),
        overlayClaims: null,
      }),
    },
    {
      expected: "garlic_extract",
      context: buildIngredientScienceContext({
        digest: buildDigest({
          labelId: "fixture-garlic-family",
          productName: "Garlic Extract",
          dosageForm: "Capsule",
          actives: [{ name: "Garlic Extract", amount: 500, unit: "mg" }],
        }),
        overlayClaims: null,
      }),
    },
    {
      expected: "ginger_root",
      context: buildIngredientScienceContext({
        digest: buildDigest({
          labelId: "fixture-ginger-family",
          productName: "Ginger Root Extract",
          dosageForm: "Capsule",
          actives: [{ name: "Ginger Root Extract", amount: 550, unit: "mg" }],
        }),
        overlayClaims: null,
      }),
    },
    {
      expected: "olive_leaf_extract",
      context: buildIngredientScienceContext({
        digest: buildDigest({
          labelId: "fixture-olive-leaf-family",
          productName: "Olive Leaf Extract",
          dosageForm: "Capsule",
          actives: [{ name: "Olive Leaf Extract", amount: 500, unit: "mg" }],
        }),
        overlayClaims: null,
      }),
    },
    {
      expected: "pygeum",
      context: buildIngredientScienceContext({
        digest: buildDigest({
          labelId: "fixture-pygeum-family",
          productName: "Pygeum Bark Extract",
          dosageForm: "Capsule",
          actives: [
            { name: "Pygeum africanum Bark Extract", amount: 100, unit: "mg" },
          ],
        }),
        overlayClaims: null,
      }),
    },
    {
      expected: "resveratrol",
      context: buildIngredientScienceContext({
        digest: buildDigest({
          labelId: "fixture-resveratrol-family",
          productName: "Trans-Resveratrol",
          dosageForm: "Capsule",
          actives: [{ name: "Trans-Resveratrol", amount: 250, unit: "mg" }],
        }),
        overlayClaims: null,
      }),
    },
    {
      expected: "gaba",
      context: buildIngredientScienceContext({
        digest: buildDigest({
          labelId: "fixture-gaba-family",
          productName: "PharmaGABA",
          dosageForm: "Capsule",
          actives: [
            { name: "Gamma-Aminobutyric Acid (GABA)", amount: 100, unit: "mg" },
          ],
        }),
        overlayClaims: null,
      }),
    },
    {
      expected: "msm",
      context: buildIngredientScienceContext({
        digest: buildDigest({
          labelId: "fixture-msm-family",
          productName: "MSM 1000 mg",
          dosageForm: "Capsule",
          actives: [
            { name: "Methylsulfonylmethane (MSM)", amount: 1000, unit: "mg" },
          ],
        }),
        overlayClaims: null,
      }),
    },
    {
      expected: "zeaxanthin",
      context: buildIngredientScienceContext({
        digest: buildDigest({
          labelId: "fixture-zeaxanthin-family",
          productName: "Zeaxanthin",
          dosageForm: "Softgel",
          actives: [{ name: "Zeaxanthin", amount: 10, unit: "mg" }],
        }),
        overlayClaims: null,
      }),
    },
    {
      expected: "red_yeast_rice",
      context: buildIngredientScienceContext({
        digest: buildDigest({
          labelId: "fixture-red-yeast-rice-family",
          productName: "Red Yeast Rice",
          dosageForm: "Capsule",
          actives: [{ name: "Red Yeast Rice", amount: 1200, unit: "mg" }],
        }),
        overlayClaims: null,
      }),
    },
    {
      expected: "royal_jelly",
      context: buildIngredientScienceContext({
        digest: buildDigest({
          labelId: "fixture-royal-jelly-family",
          productName: "Royal Jelly",
          dosageForm: "Softgel",
          actives: [{ name: "Royal Jelly", amount: 500, unit: "mg" }],
        }),
        overlayClaims: null,
      }),
    },
    {
      expected: "saffron_extract",
      context: buildIngredientScienceContext({
        digest: buildDigest({
          labelId: "fixture-saffron-family",
          productName: "Saffron Extract",
          dosageForm: "Capsule",
          actives: [{ name: "Saffron Extract", amount: 30, unit: "mg" }],
        }),
        overlayClaims: null,
      }),
    },
    {
      expected: "tribulus_terrestris",
      context: buildIngredientScienceContext({
        digest: buildDigest({
          labelId: "fixture-tribulus-family",
          productName: "Tribulus Terrestris",
          dosageForm: "Capsule",
          actives: [
            { name: "Tribulus Terrestris Extract", amount: 500, unit: "mg" },
          ],
        }),
        overlayClaims: null,
      }),
    },
    {
      expected: "turkey_tail_mushroom",
      context: buildIngredientScienceContext({
        digest: buildDigest({
          labelId: "fixture-turkey-tail-family",
          productName: "Turkey Tail Mushroom",
          dosageForm: "Capsule",
          actives: [
            { name: "Turkey Tail Mushroom Extract", amount: 1000, unit: "mg" },
          ],
        }),
        overlayClaims: null,
      }),
    },
    {
      expected: "milk_thistle",
      context: buildIngredientScienceContext({
        digest: buildDigest({
          labelId: "fixture-milk-thistle-family",
          productName: "Milk Thistle Silymarin",
          dosageForm: "Capsule",
          actives: [{ name: "Milk Thistle Extract", amount: 300, unit: "mg" }],
        }),
        overlayClaims: null,
      }),
    },
    {
      expected: "l_ornithine",
      context: buildIngredientScienceContext({
        digest: buildDigest({
          labelId: "fixture-l-ornithine-family",
          productName: "L-Ornithine HCl 500 mg",
          dosageForm: "Capsule",
          actives: [{ name: "L-Ornithine HCl", amount: 500, unit: "mg" }],
        }),
        overlayClaims: null,
      }),
    },
    {
      expected: "molybdenum",
      context: buildIngredientScienceContext({
        digest: buildDigest({
          labelId: "fixture-molybdenum-family",
          productName: "Molybdenum Glycinate 100 mcg",
          dosageForm: "Capsule",
          actives: [
            {
              name: "Molybdenum (as Molybdenum Glycinate)",
              amount: 100,
              unit: "mcg",
            },
          ],
        }),
        overlayClaims: null,
      }),
    },
    {
      expected: "iodine",
      context: buildIngredientScienceContext({
        digest: buildDigest({
          labelId: "fixture-iodine-family",
          productName: "Iodine from Kelp 150 mcg",
          dosageForm: "Capsule",
          actives: [{ name: "Iodine (from Kelp)", amount: 150, unit: "mcg" }],
        }),
        overlayClaims: null,
      }),
    },
    {
      expected: "papain",
      context: buildIngredientScienceContext({
        digest: buildDigest({
          labelId: "fixture-papain-family",
          productName: "Papain Papaya Enzyme",
          dosageForm: "Capsule",
          actives: [{ name: "Papain", amount: 45, unit: "mg" }],
        }),
        overlayClaims: null,
      }),
    },
    {
      expected: "passionflower",
      context: buildIngredientScienceContext({
        digest: buildDigest({
          labelId: "fixture-passionflower-family",
          productName: "Passionflower Extract",
          dosageForm: "Capsule",
          actives: [{ name: "Passionflower Extract", amount: 350, unit: "mg" }],
        }),
        overlayClaims: null,
      }),
    },
    {
      expected: "st_john_s_wort",
      context: buildIngredientScienceContext({
        digest: buildDigest({
          labelId: "fixture-st-johns-wort-family",
          productName: "St. John's Wort Extract",
          dosageForm: "Capsule",
          actives: [
            { name: "St. John's Wort Extract", amount: 300, unit: "mg" },
          ],
        }),
        overlayClaims: null,
      }),
    },
    {
      expected: "lavender",
      context: buildIngredientScienceContext({
        digest: buildDigest({
          labelId: "fixture-lavender-family",
          productName: "Lavender Oil Silexan",
          dosageForm: "Softgel",
          actives: [
            { name: "Lavender Oil Preparation", amount: 80, unit: "mg" },
          ],
        }),
        overlayClaims: null,
      }),
    },
    {
      expected: "lemon_balm",
      context: buildIngredientScienceContext({
        digest: buildDigest({
          labelId: "fixture-lemon-balm-family",
          productName: "Lemon Balm Extract",
          dosageForm: "Capsule",
          actives: [{ name: "Lemon Balm Extract", amount: 500, unit: "mg" }],
        }),
        overlayClaims: null,
      }),
    },
    {
      expected: "pantothenic_acid",
      context: buildIngredientScienceContext({
        digest: buildDigest({
          labelId: "fixture-pantothenic-acid-family",
          productName: "Pantothenic Acid Vitamin B5",
          dosageForm: "Capsule",
          actives: [
            { name: "Pantothenic Acid (Vitamin B5)", amount: 500, unit: "mg" },
          ],
        }),
        overlayClaims: null,
      }),
    },
  ] as const;

  assert.equal(vitaminEContext.anchorIngredient?.ingredientFamily, "vitamin_e");
  assert.equal(
    vitaminK2Context.anchorIngredient?.ingredientFamily,
    "vitamin_k2",
  );
  assert.equal(chromiumContext.anchorIngredient?.ingredientFamily, "chromium");
  assert.equal(seleniumContext.anchorIngredient?.ingredientFamily, "selenium");
  assert.equal(vitaminAContext.anchorIngredient?.ingredientFamily, "vitamin_a");
  assert.equal(dglContext.anchorIngredient?.ingredientFamily, "dgl_licorice");
  assert.equal(kavaContext.anchorIngredient?.ingredientFamily, "kava");
  assert.equal(
    slipperyElmContext.anchorIngredient?.ingredientFamily,
    "slippery_elm",
  );
  assert.equal(
    glutathioneContext.anchorIngredient?.ingredientFamily,
    "glutathione",
  );
  assert.equal(
    alphaLipoicAcidContext.anchorIngredient?.ingredientFamily,
    "alpha_lipoic_acid",
  );
  assert.equal(biotinContext.anchorIngredient?.ingredientFamily, "biotin");
  assert.equal(copperContext.anchorIngredient?.ingredientFamily, "copper");
  assert.equal(
    riboflavinContext.anchorIngredient?.ingredientFamily,
    "riboflavin",
  );
  assert.equal(aloeVeraContext.anchorIngredient?.ingredientFamily, "aloe_vera");
  for (const { context, expected } of newestWaveContexts) {
    assert.equal(context.anchorIngredient?.ingredientFamily, expected);
  }
});

test("science context classifies every full-family productization manifest row", () => {
  for (const definition of NUTRI_MINIMAL_FULL_FAMILY_DEFINITIONS) {
    const context = buildIngredientScienceContext({
      digest: buildDigest({
        labelId: `fixture-full-family-${definition.sourceIngredientId}`,
        productName: `${definition.displayName} 500 mg`,
        dosageForm: "Capsule",
        actives: [
          {
            name: definition.displayName,
            amount: 500,
            unit: "mg",
          },
        ],
      }),
      overlayClaims: null,
    });

    assert.equal(
      context.anchorIngredient?.ingredientFamily,
      definition.canonicalFamily,
      `${definition.sourceIngredientId} should map to ${definition.canonicalFamily}`,
    );
  }
});

test("science context rescues green guard and broth food-like titles ahead of noisy rows", () => {
  const greenGuardContext = buildIngredientScienceContext({
    digest: buildDigest({
      labelId: "fixture-green-guard-powder",
      productName: "Eclectic Herb, Green Guard Powder, 3.7 oz (105 g)",
      dosageForm: "Powder",
      actives: [
        { name: "Calories", amount: 10, unit: null },
        { name: "Sugars", amount: 1, unit: "g" },
      ],
    }),
    overlayClaims: null,
  });
  const brothContext = buildIngredientScienceContext({
    digest: buildDigest({
      labelId: "fixture-earth-broth",
      productName: "HealthForce Superfoods, Earth Broth®, 16 oz (454 g)",
      dosageForm: "Powder",
      actives: [
        { name: "Ashwagandha Root", amount: 200, unit: "mg" },
        { name: "Protein", amount: 1, unit: "g" },
      ],
    }),
    overlayClaims: null,
  });

  assert.match(greenGuardContext.ingredientRows[0]?.name ?? "", /greens/i);
  assert.notEqual(greenGuardContext.ingredientRows[0]?.name, "Sugars");
  assert.match(brothContext.ingredientRows[0]?.name ?? "", /broth/i);
  assert.notEqual(brothContext.ingredientRows[0]?.name, "Ashwagandha Root");
});

test("science context treats joint and skin titles as joint support or collagen-led formulas", () => {
  const context = buildIngredientScienceContext({
    digest: buildDigest({
      labelId: "fixture-ha-joint-skin",
      productName:
        "Purity Products, H.A. Joint & Skin™, Super Formula, 90 Capsules",
      dosageForm: "Capsule",
      actives: [
        { name: "BioCell Collagen", amount: 1000, unit: "mg" },
        {
          name: "Calcium-Magnesium Inositol Hexaphosphate (IP6)",
          amount: 75,
          unit: "mg",
        },
      ],
    }),
    overlayClaims: null,
  });
  const genuineHealthNemContext = buildIngredientScienceContext({
    digest: buildDigest({
      labelId: "fixture-genuine-health-fast-joint-care-nem-turmeric",
      productName: "Genuine Health, fast joint care with NEM and turmeric",
      dosageForm: "Capsule",
      actives: [
        {
          name: "NEM Partially Hydrolysed Chicken Eggshell Membrane (egg shell) (Gallus gallus)",
          amount: 250,
          unit: "mg",
        },
        {
          name: "Fermented Organic Turmeric (rhizome) (Curcuma longa)",
          amount: 250,
          unit: "mg",
        },
        {
          name: "Turmeric Standardized Extract (Curcuma longa)",
          amount: 62.5,
          unit: "mg",
        },
      ],
    }),
    overlayClaims: null,
  });

  assert.match(
    context.ingredientRows[0]?.name ?? "",
    /joint support|collagen/i,
  );
  assert.notEqual(
    context.ingredientRows[0]?.name,
    "Calcium-Magnesium Inositol Hexaphosphate (IP6)",
  );
  assert.match(
    genuineHealthNemContext.ingredientRows[0]?.name ?? "",
    /nem|eggshell membrane/i,
  );
  assert.doesNotMatch(
    genuineHealthNemContext.ingredientRows[0]?.name ?? "",
    /turmeric/i,
  );
});

test("science context does not let alcohol solvent rows outrank title-led lemon balm extract rows", () => {
  const context = buildIngredientScienceContext({
    digest: buildDigest({
      labelId: "fixture-lemon-balm-solvent-rows",
      productName: "Eclectic Herb, Lemon Balm Extract, 2 fl oz (60 ml)",
      dosageForm: "Liquid",
      actives: [
        { name: "Alcohol", amount: null, unit: null },
        { name: "Lemon Balm, Dried", amount: null, unit: null },
        { name: "filtered Water", amount: null, unit: null },
      ],
    }),
    overlayClaims: null,
  });

  assert.match(context.ingredientRows[0]?.name ?? "", /lemon balm/i);
  assert.notEqual(context.ingredientRows[0]?.name, "Alcohol");
  assert.notEqual(context.ingredientRows[0]?.name, "filtered Water");
});

test("science context keeps title-led bilberry extract ahead of companion vitamin and mineral rows", () => {
  const context = buildIngredientScienceContext({
    digest: buildDigest({
      labelId: "fixture-source-naturals-bilberry-extract",
      productName: "Source Naturals, Bilberry Extract, 120 Tablets",
      dosageForm: "Tablet",
      actives: [
        { name: "Vitamin C", amount: 3, unit: "mg" },
        {
          name: "Bilberry Fruit Standardized Extract (Vaccinium myrtillus)",
          amount: 100,
          unit: "mg",
        },
        { name: "Calcium", amount: 64, unit: "mg" },
      ],
    }),
    overlayClaims: null,
  });

  assert.match(context.ingredientRows[0]?.name ?? "", /bilberry/i);
  assert.notEqual(context.ingredientRows[0]?.name, "Vitamin C");
  assert.notEqual(context.ingredientRows[0]?.name, "Calcium");
});

test("science context rescues title-led probiotic strains ahead of proprietary synergistic blend rows", () => {
  const context = buildIngredientScienceContext({
    digest: buildDigest({
      labelId: "fixture-acidophilus-bifidus-proprietary-synergistic-blend",
      productName: "Natural Factors, Acidophilus & Bifidus, 90 Capsules",
      dosageForm: "Capsule",
      actives: [
        {
          name: "Proprietary Synergistic Blend",
          amount: 3,
          unit: "Billion CFU",
        },
        { name: "Vitamin D3", amount: 5, unit: "mcg" },
      ],
    }),
    overlayClaims: null,
  });

  assert.match(
    context.ingredientRows[0]?.name ?? "",
    /acidophilus|bifidus|probiotic/i,
  );
  assert.doesNotMatch(
    context.ingredientRows[0]?.name ?? "",
    /proprietary synergistic blend/i,
  );
  assert.equal(
    context.anchorIngredient?.ingredientFamily,
    "probiotic_or_blend",
  );
});

test("science context uses food-like label anchors instead of macro rows for greens powders and snacks", () => {
  const greensDigest = buildDigest({
    labelId: "fixture-organic-supergreens-with-macros",
    productName: "Organic Supergreens Powder",
    dosageForm: "Powder",
    actives: [
      { name: "Protein", amount: 1, unit: "g" },
      { name: "Dietary Fiber", amount: 2, unit: "g" },
      { name: "Potassium", amount: 94, unit: "mg" },
    ],
  });
  const snackDigest = buildDigest({
    labelId: "fixture-snackable-crackers-with-potassium",
    productName: "Snackable Crackers, Maple Cinnamon Currant",
    dosageForm: "Cracker",
    actives: [
      { name: "Potassium", amount: 80, unit: "mg" },
      { name: "Protein", amount: 2, unit: "g" },
    ],
  });

  const greensContext = buildIngredientScienceContext({
    digest: greensDigest,
    overlayClaims: null,
  });
  const snackContext = buildIngredientScienceContext({
    digest: snackDigest,
    overlayClaims: null,
  });

  assert.equal(greensContext.productArchetype, "functional_food_like");
  assert.match(greensContext.ingredientRows[0]?.name ?? "", /greens/i);
  assert.doesNotMatch(
    greensContext.ingredientRows[0]?.name ?? "",
    /protein|fiber|potassium/i,
  );
  assert.equal(snackContext.productArchetype, "functional_food_like");
  assert.match(
    snackContext.ingredientRows[0]?.name ?? "",
    /food-based product/i,
  );
  assert.doesNotMatch(
    snackContext.ingredientRows[0]?.name ?? "",
    /protein|potassium/i,
  );
});

test("science context keeps title-led beverage foods ahead of brand and mineral noise", () => {
  const lairdContext = buildIngredientScienceContext({
    digest: withBrand(
      buildDigest({
        labelId: "fixture-laird-superfood-hydrate-electrolyte-drink-mix",
        productName:
          "Laird Superfood, Hydrate Coconut Water, Electrolyte Drink Mix, Lemon",
        dosageForm: "Powder",
        actives: [
          { name: "Magnesium", amount: 22, unit: "mg" },
          { name: "Calcium", amount: 12, unit: "mg" },
          { name: "Iron", amount: 1, unit: "mg" },
          { name: "Potassium", amount: 220, unit: "mg" },
        ],
      }),
      "Laird Superfood",
    ),
    overlayClaims: null,
  });
  const genuineElectrolytesContext = buildIngredientScienceContext({
    digest: withBrand(
      buildDigest({
        labelId: "fixture-genuine-health-enhanced-electrolytes-plus",
        productName:
          "Genuine Health, enhanced electrolytes+ raspberry lemonade",
        dosageForm: "Powder",
        actives: [
          { name: "Fermented Beet Root", amount: 500, unit: "mg" },
          { name: "Guava Leaf Standardized Extract", amount: 150, unit: "mg" },
          { name: "Magnesium", amount: 35, unit: "mg" },
          { name: "Potassium", amount: 30, unit: "mg" },
          { name: "Calcium", amount: 30, unit: "mg" },
          { name: "Vitamin D3", amount: 10, unit: "mcg" },
        ],
      }),
      "Genuine Health",
    ),
    overlayClaims: null,
  });
  const soyMilkContext = buildIngredientScienceContext({
    digest: withBrand(
      buildDigest({
        labelId: "fixture-now-real-food-organic-soy-milk-powder",
        productName: "NOW Foods, Real Food, Organic Soy Milk Powder",
        dosageForm: "Powder",
        actives: [
          { name: "Potassium", amount: 330, unit: "mg" },
          { name: "Calcium", amount: 30, unit: "mg" },
          { name: "Iron", amount: 1.4, unit: "mg" },
          { name: "Fiber", amount: 2, unit: "g" },
        ],
      }),
      "NOW Foods",
    ),
    overlayClaims: null,
  });
  const bananaMilkContext = buildIngredientScienceContext({
    digest: withBrand(
      buildDigest({
        labelId: "fixture-binggrae-flavored-milk-drink-banana",
        productName: "Binggrae, Flavored Milk Drink, Banana",
        dosageForm: "Drink",
        actives: [
          { name: "Potassium", amount: 320, unit: "mg" },
          { name: "Calcium", amount: 90, unit: "mg" },
          { name: "Fiber", amount: 1, unit: "g" },
        ],
      }),
      "Binggrae",
    ),
    overlayClaims: null,
  });
  const coffeeMilkContext = buildIngredientScienceContext({
    digest: withBrand(
      buildDigest({
        labelId: "fixture-binggrae-flavored-milk-drink-coffee",
        productName: "Binggrae, Flavored Milk Drink, Coffee",
        dosageForm: "Drink",
        actives: [
          { name: "Potas", amount: 300, unit: "mg" },
          { name: "Calcium", amount: 100, unit: "mg" },
          { name: "Vit. D", amount: 2, unit: "mcg" },
          { name: "Fiber", amount: 1, unit: "g" },
        ],
      }),
      "Binggrae",
    ),
    overlayClaims: null,
  });

  assert.equal(lairdContext.productArchetype, "functional_food_like");
  assert.match(
    lairdContext.ingredientRows[0]?.name ?? "",
    /electrolyte\s+drink\s+mix|hydrate\s+coconut\s+water|electrolyte/i,
  );
  assert.doesNotMatch(
    lairdContext.ingredientRows[0]?.name ?? "",
    /greens|magnesium|calcium|iron|potassium/i,
  );
  assert.equal(
    lairdContext.anchorIngredient?.ingredientFamily,
    "electrolyte_hydration",
  );
  assert.match(
    genuineElectrolytesContext.ingredientRows[0]?.name ?? "",
    /electrolytes?\+?/i,
  );
  assert.doesNotMatch(
    genuineElectrolytesContext.ingredientRows[0]?.name ?? "",
    /beet|magnesium|potassium|calcium|vitamin d/i,
  );
  assert.equal(
    genuineElectrolytesContext.anchorIngredient?.ingredientFamily,
    "electrolyte_hydration",
  );
  assert.equal(soyMilkContext.productArchetype, "functional_food_like");
  assert.match(
    soyMilkContext.ingredientRows[0]?.name ?? "",
    /soy\s+milk\s+powder/i,
  );
  assert.doesNotMatch(
    soyMilkContext.ingredientRows[0]?.name ?? "",
    /potassium|calcium|iron|fiber/i,
  );
  assert.equal(bananaMilkContext.productArchetype, "functional_food_like");
  assert.match(
    bananaMilkContext.ingredientRows[0]?.name ?? "",
    /flavored\s+milk\s+drink|milk\s+drink/i,
  );
  assert.doesNotMatch(
    bananaMilkContext.ingredientRows[0]?.name ?? "",
    /potassium|calcium|fiber/i,
  );
  assert.equal(coffeeMilkContext.productArchetype, "functional_food_like");
  assert.match(
    coffeeMilkContext.ingredientRows[0]?.name ?? "",
    /flavored\s+milk\s+drink|milk\s+drink/i,
  );
  assert.doesNotMatch(
    coffeeMilkContext.ingredientRows[0]?.name ?? "",
    /potas|calcium|vit\.\s*d|fiber/i,
  );
});

test("science context keeps title-led snack and seasoning foods ahead of macro noise", () => {
  const proteinBitesContext = buildIngredientScienceContext({
    digest: withBrand(
      buildDigest({
        labelId: "fixture-bhu-protein-bites",
        productName: "BHU Foods, Protein Bites, Chocolate Chip Cookie Dough",
        dosageForm: "Bites",
        actives: [
          { name: "Protein", amount: 10, unit: "g" },
          { name: "Calcium", amount: 40, unit: "mg" },
          { name: "Potassium", amount: 120, unit: "mg" },
          { name: "Fiber", amount: 3, unit: "g" },
        ],
      }),
      "BHU Foods",
    ),
    overlayClaims: null,
  });
  const snackMixContext = buildIngredientScienceContext({
    digest: withBrand(
      buildDigest({
        labelId: "fixture-catalina-protein-snack-mix",
        productName: "Catalina Crunch, Protein Snack Mix, Cheddar",
        dosageForm: "Snack Mix",
        actives: [
          { name: "Protein", amount: 12, unit: "g" },
          { name: "Calcium", amount: 60, unit: "mg" },
          { name: "Iron", amount: 1, unit: "mg" },
          { name: "Potassium", amount: 180, unit: "mg" },
          { name: "Fiber", amount: 5, unit: "g" },
        ],
      }),
      "Catalina Crunch",
    ),
    overlayClaims: null,
  });
  const milkChocolateContext = buildIngredientScienceContext({
    digest: withBrand(
      buildDigest({
        labelId: "fixture-chocolove-milk-chocolate",
        productName: "Chocolove, Almonds & Sea Salt in Milk Chocolate",
        dosageForm: "Bar",
        actives: [
          { name: "Sat Fat", amount: 5, unit: "g" },
          { name: "Calcium", amount: 40, unit: "mg" },
          { name: "Potassium", amount: 170, unit: "mg" },
          { name: "Iron", amount: 1, unit: "mg" },
        ],
      }),
      "Chocolove",
    ),
    overlayClaims: null,
  });
  const chocoLatteContext = buildIngredientScienceContext({
    digest: withBrand(
      buildDigest({
        labelId: "fixture-tcho-choco-latte",
        productName: "TCHO, Choco Latte, Milk Chocolate with Coffee",
        dosageForm: "Bar",
        actives: [
          { name: "Sat. Fat", amount: 4.5, unit: "g" },
          { name: "Calcium", amount: 40, unit: "mg" },
          { name: "Potas", amount: 160, unit: "mg" },
          { name: "Vit. D", amount: 1, unit: "mcg" },
          { name: "Iron", amount: 1, unit: "mg" },
        ],
      }),
      "TCHO",
    ),
    overlayClaims: null,
  });
  const liquidAminosContext = buildIngredientScienceContext({
    digest: withBrand(
      buildDigest({
        labelId: "fixture-bragg-liquid-aminos-soy-protein-seasoning",
        productName: "Bragg, Liquid Aminos, Soy Protein Seasoning",
        dosageForm: "Liquid",
        actives: [{ name: "Soy Protein", amount: 310, unit: "mg" }],
      }),
      "Bragg",
    ),
    overlayClaims: null,
  });

  assert.equal(proteinBitesContext.productArchetype, "functional_food_like");
  assert.match(
    proteinBitesContext.ingredientRows[0]?.name ?? "",
    /protein\s+bites/i,
  );
  assert.doesNotMatch(
    proteinBitesContext.ingredientRows[0]?.name ?? "",
    /^protein$|calcium|potassium|fiber/i,
  );
  assert.equal(snackMixContext.productArchetype, "functional_food_like");
  assert.match(
    snackMixContext.ingredientRows[0]?.name ?? "",
    /protein\s+snack\s+mix/i,
  );
  assert.doesNotMatch(
    snackMixContext.ingredientRows[0]?.name ?? "",
    /^protein$|calcium|iron|potassium|fiber/i,
  );
  assert.equal(milkChocolateContext.productArchetype, "functional_food_like");
  assert.match(
    milkChocolateContext.ingredientRows[0]?.name ?? "",
    /milk\s+chocolate|chocolate\s+bar/i,
  );
  assert.doesNotMatch(
    milkChocolateContext.ingredientRows[0]?.name ?? "",
    /sat\.?\s*fat|calcium|potassium|iron/i,
  );
  assert.equal(chocoLatteContext.productArchetype, "functional_food_like");
  assert.match(
    chocoLatteContext.ingredientRows[0]?.name ?? "",
    /choco\s+latte|milk\s+chocolate/i,
  );
  assert.doesNotMatch(
    chocoLatteContext.ingredientRows[0]?.name ?? "",
    /sat\.?\s*fat|calcium|potas|vit\.\s*d|iron/i,
  );
  assert.equal(liquidAminosContext.productArchetype, "functional_food_like");
  assert.match(
    liquidAminosContext.ingredientRows[0]?.name ?? "",
    /liquid\s+aminos|soy\s+protein\s+seasoning/i,
  );
});

test("science context keeps title-led multi-vitamin drink mixes ahead of formula anchors", () => {
  const context = buildIngredientScienceContext({
    digest: withBrand(
      buildDigest({
        labelId: "fixture-ener-c-multivitamin-drink-mix",
        productName:
          "Ener-C, Bubbly Multi-Vitamin Drink Mix, Variety Pack, 1,000 mg",
        dosageForm: "Packet",
        actives: [
          { name: "Vitamin C", amount: 1000, unit: "mg" },
          { name: "Total Carbohydrates", amount: 5, unit: "g" },
          { name: "Magnesium", amount: 60, unit: "mg" },
          { name: "Zinc", amount: 5, unit: "mg" },
        ],
      }),
      "Ener-C",
    ),
    overlayClaims: null,
  });

  assert.equal(context.productArchetype, "functional_food_like");
  assert.match(
    context.ingredientRows[0]?.name ?? "",
    /multi[-\s]*vitamin\s+drink\s+mix|drink\s+mix/i,
  );
  assert.doesNotMatch(
    context.ingredientRows[0]?.name ?? "",
    /multivitamin\s+&\s+mineral\s+formula|vitamin\s+c|magnesium|zinc|total\s+carb/i,
  );
});

test("science context keeps antioxidant drink mixes on a title-led drink mix anchor", () => {
  const context = buildIngredientScienceContext({
    digest: withBrand(
      buildDigest({
        labelId: "fixture-phytoberry-antioxidant-drink-mix",
        productName: "Progressive, Daily Antioxidant Drink Mix",
        dosageForm: "Powder",
        actives: [
          {
            name: "Berry & Fruit Concentrates Goji (Lycium barbarum, Fruit)",
            amount: 1200,
            unit: "mg",
          },
          {
            name: "Organic Acai (Euterpe oleracea, Fruit)",
            amount: 600,
            unit: "mg",
          },
          {
            name: "Pomegranate (Punica granatum, Fruit)",
            amount: 300,
            unit: "mg",
          },
        ],
      }),
      "Progressive",
    ),
    overlayClaims: null,
  });

  assert.equal(context.productArchetype, "functional_food_like");
  assert.match(
    context.ingredientRows[0]?.name ?? "",
    /antioxidant\s+drink\s+mix|phytoberry/i,
  );
  assert.doesNotMatch(
    context.ingredientRows[0]?.name ?? "",
    /food-based\s+powder|goji|acai|pomegranate/i,
  );
});

test("science context keeps apple cider vinegar gummies anchored to apple cider vinegar", () => {
  const context = buildIngredientScienceContext({
    digest: withBrand(
      buildDigest({
        labelId: "fixture-apple-cider-vinegar-gummies",
        productName: "Jamieson, Apple Cider Vinegar Gummies, with Chromium",
        dosageForm: "Gummy",
        actives: [
          {
            name: "Apple Cider Vinegar (Malus pumila Mill, Fruit)",
            amount: 500,
            unit: "mg",
          },
          { name: "Chromium", amount: 150, unit: "mcg" },
        ],
      }),
      "Jamieson",
    ),
    overlayClaims: null,
  });

  assert.equal(context.productArchetype, "functional_food_like");
  assert.match(
    context.ingredientRows[0]?.name ?? "",
    /apple\s+cider\s+vinegar/i,
  );
  assert.doesNotMatch(
    context.ingredientRows[0]?.name ?? "",
    /food-based\s+product|gumm(?:y|ies)|chromium/i,
  );
});

test("science context keeps berberine formulas ahead of green coffee food-like wording", () => {
  const context = buildIngredientScienceContext({
    digest: withBrand(
      buildDigest({
        labelId: "fixture-berberine-green-coffee",
        productName: "Webber Naturals, Berberine Plus with Green Coffee Bean",
        dosageForm: "Capsule",
        actives: [
          {
            name: "Berberine (hydrochloride) (Berberis vulgaris) (root bark)",
            amount: 250,
            unit: "mg",
          },
          { name: "Green Coffee Bean Extract", amount: 200, unit: "mg" },
        ],
      }),
      "Webber Naturals",
    ),
    overlayClaims: null,
  });

  assert.notEqual(context.productArchetype, "functional_food_like");
  assert.match(context.ingredientRows[0]?.name ?? "", /berberine/i);
  assert.doesNotMatch(
    context.ingredientRows[0]?.name ?? "",
    /food-based\s+product|green\s+coffee/i,
  );
  assert.equal(context.anchorIngredient?.ingredientFamily, "berberine");
});

test("science context keeps CoQ10 gummies anchored to coenzyme Q10", () => {
  const context = buildIngredientScienceContext({
    digest: withBrand(
      buildDigest({
        labelId: "fixture-coq10-gummy",
        productName: "Jamieson, CoQ10, Gummy",
        dosageForm: "Gummy",
        actives: [{ name: "Coenzyme Q10", amount: 100, unit: "mg" }],
      }),
      "Jamieson",
    ),
    overlayClaims: null,
  });

  assert.equal(context.productArchetype, "functional_food_like");
  assert.match(context.ingredientRows[0]?.name ?? "", /coq10|coenzyme\s+q10/i);
  assert.doesNotMatch(
    context.ingredientRows[0]?.name ?? "",
    /food-based\s+product|gumm(?:y|ies)/i,
  );
  assert.equal(context.anchorIngredient?.ingredientFamily, "coq10");
});

test("science context keeps biotin gummies anchored to biotin", () => {
  const context = buildIngredientScienceContext({
    digest: withBrand(
      buildDigest({
        labelId: "fixture-biotin-gummies",
        productName: "Webber Naturals, Biotin Gummies 10,000 mcg",
        dosageForm: "Gummy",
        actives: [{ name: "Biotin", amount: 10000, unit: "mcg" }],
      }),
      "Webber Naturals",
    ),
    overlayClaims: null,
  });

  assert.equal(context.productArchetype, "functional_food_like");
  assert.match(context.ingredientRows[0]?.name ?? "", /biotin/i);
  assert.doesNotMatch(
    context.ingredientRows[0]?.name ?? "",
    /food-based\s+product|gumm(?:y|ies)/i,
  );
});

test("science context keeps collagen peptide gummies anchored to collagen", () => {
  const context = buildIngredientScienceContext({
    digest: withBrand(
      buildDigest({
        labelId: "fixture-collagen-peptides-gummies",
        productName: "Webber Naturals, Collagen30 Collagen Peptides Gummies",
        dosageForm: "Gummy",
        actives: [
          {
            name: "VERISOL BIOACTIVE COLLAGEN PEPTIDES Type I and III Hydrolyzed Collagen (bovine)",
            amount: 833.34,
            unit: "mg",
          },
        ],
      }),
      "Webber Naturals",
    ),
    overlayClaims: null,
  });

  assert.equal(context.productArchetype, "functional_food_like");
  assert.match(context.ingredientRows[0]?.name ?? "", /collagen/i);
  assert.doesNotMatch(
    context.ingredientRows[0]?.name ?? "",
    /food-based\s+product|gumm(?:y|ies)/i,
  );
  assert.equal(context.anchorIngredient?.ingredientFamily, "collagen");
});

test("science context keeps cranberry gummies anchored to cranberry", () => {
  const context = buildIngredientScienceContext({
    digest: withBrand(
      buildDigest({
        labelId: "fixture-cranberry-gummies",
        productName: "Webber Naturals, UltraCran Cranberry 10,000 mg Gummies",
        dosageForm: "Gummy",
        actives: [
          {
            name: "Cranberry Extract 50:1 (Vaccinium macrocarpon) (fruit)",
            amount: 200,
            unit: "mg",
          },
        ],
      }),
      "Webber Naturals",
    ),
    overlayClaims: null,
  });

  assert.equal(context.productArchetype, "functional_food_like");
  assert.match(context.ingredientRows[0]?.name ?? "", /cranberry|ultracran/i);
  assert.doesNotMatch(
    context.ingredientRows[0]?.name ?? "",
    /food-based\s+product|gumm(?:y|ies)/i,
  );
});

test("science context creates label-context rows for title-only Greens First and Project 1 powders", () => {
  const greensFirstContext = buildIngredientScienceContext({
    digest: buildDigest({
      labelId: "fixture-greens-first-title-only",
      productName: "Greens First, Greens Powder, Berry",
      dosageForm: "Powder",
      actives: [],
    }),
    overlayClaims: null,
  });
  const projectOneContext = buildIngredientScienceContext({
    digest: buildDigest({
      labelId: "fixture-project-one-greens-title-only",
      productName:
        "Project 1 Nutrition, Greens, Superfood Greens Powder, Chocolate",
      dosageForm: "Powder",
      actives: [],
    }),
    overlayClaims: null,
  });

  assert.equal(greensFirstContext.productArchetype, "functional_food_like");
  assert.match(greensFirstContext.ingredientRows[0]?.name ?? "", /greens/i);
  assert.equal(projectOneContext.productArchetype, "functional_food_like");
  assert.match(projectOneContext.ingredientRows[0]?.name ?? "", /greens/i);
});

test("brand-led food-like greens powders still create science rows for decision-support", () => {
  const digest = buildDigest({
    labelId: "fixture-athletic-greens-brand-only",
    productName: "Foundational Nutrition, 30 Servings",
    dosageForm: "Powder",
    actives: [],
  });
  const context = buildIngredientScienceContext({
    digest: {
      ...digest,
      product: {
        ...digest.product,
        brandDisplay: "Athletic Greens",
      },
    },
    overlayClaims: null,
  });
  const plan = planScientificBackgroundSections({
    context,
    selectedIngredientName: context.anchorIngredient?.name ?? "Greens",
  });

  assert.equal(context.productArchetype, "functional_food_like");
  assert.match(context.ingredientRows[0]?.name ?? "", /greens/i);
  assert.equal(plan.mode, "label_context_mode");
});

test("default science ingredient ordering follows title-led actives over companions and package anchors", () => {
  const htpContext = buildIngredientScienceContext({
    digest: buildDigest({
      labelId: "fixture-5htp-melatonin-title-order",
      productName: "5-HTP 200 mg with Melatonin",
      dosageForm: "Capsule",
      actives: [
        { name: "Melatonin", amount: 3, unit: "mg" },
        { name: "Vitamin B-6 (from Pyridoxine HCl)", amount: 2, unit: "mg" },
        { name: "5-HTP (5-hydroxytryptophan)", amount: 200, unit: "mg" },
      ],
    }),
    overlayClaims: null,
  });
  const probioticZincContext = buildIngredientScienceContext({
    digest: buildDigest({
      labelId: "fixture-zinc-probiotic-title-order",
      productName: "Zinc + Probiotic Immune Gummies",
      dosageForm: "Gummy",
      actives: [
        { name: "Total Carbohydrate", amount: 3, unit: "g" },
        { name: "Probiotic Blend", amount: 1, unit: "Billion CFU" },
        { name: "Zinc", amount: 5, unit: "mg" },
      ],
    }),
    overlayClaims: null,
  });
  const probioticLedZincContext = buildIngredientScienceContext({
    digest: buildDigest({
      labelId: "fixture-probiotic-immune-d-zinc-title-order",
      productName:
        "Genuine Health, advanced gut health probiotic immune + vitamin D and Zinc 50 billion",
      dosageForm: "Capsule",
      actives: [
        { name: "Probiotic Blend", amount: 50, unit: "Billion CFU" },
        { name: "Vitamin D3", amount: 10, unit: "mcg" },
        { name: "Zinc (zinc gluconate)", amount: 5, unit: "mg" },
      ],
    }),
    overlayClaims: null,
  });
  const packageAnchorContext = buildIngredientScienceContext({
    digest: buildDigest({
      labelId: "fixture-package-anchor-noise",
      productName: "Magnesium Complex, 120 Capsules",
      dosageForm: "Capsule",
      actives: [
        { name: "120 Capsules", amount: null, unit: null },
        { name: "Calories", amount: 10, unit: null },
        { name: "Magnesium (as Magnesium Glycinate)", amount: 200, unit: "mg" },
      ],
    }),
    overlayClaims: null,
  });

  assert.match(htpContext.ingredientRows[0]?.name ?? "", /5-HTP/i);
  assert.notEqual(htpContext.ingredientRows[0]?.name, "Melatonin");
  assert.match(probioticZincContext.ingredientRows[0]?.name ?? "", /\bzinc\b/i);
  assert.doesNotMatch(
    probioticZincContext.ingredientRows[0]?.name ?? "",
    /carbohydrate/i,
  );
  assert.match(
    probioticLedZincContext.ingredientRows[0]?.name ?? "",
    /probiotic/i,
  );
  assert.doesNotMatch(
    probioticLedZincContext.ingredientRows[0]?.name ?? "",
    /\bzinc\b/i,
  );
  assert.match(
    packageAnchorContext.ingredientRows[0]?.name ?? "",
    /\bmagnesium\b/i,
  );
  assert.doesNotMatch(
    packageAnchorContext.ingredientRows[0]?.name ?? "",
    /capsules|calories/i,
  );
});

test("science context keeps title-led algae and enzyme products ahead of micronutrient rows", () => {
  const enzymeContext = buildIngredientScienceContext({
    digest: buildDigest({
      labelId: "fixture-healthforce-digestive-enzymes",
      productName:
        "HealthForce Superfoods, Digestion Enhancement Enzymes™, 120 VeganCaps",
      dosageForm: "VeganCaps",
      actives: [
        { name: "Proteases∞", amount: 15100, unit: "HUT" },
        { name: "Amylase", amount: 4000, unit: "DU" },
      ],
    }),
    overlayClaims: null,
  });
  const spirulinaContext = buildIngredientScienceContext({
    digest: buildDigest({
      labelId: "fixture-healthforce-spirulina-manna",
      productName: "HealthForce Superfoods, Spirulina Manna, 16 oz (454 g)",
      dosageForm: "Powder",
      actives: [
        { name: "Vitamin A (Beta-carotene)", amount: 2500, unit: "IU" },
        { name: "Iron", amount: 2, unit: "mg" },
      ],
    }),
    overlayClaims: null,
  });
  const chlorellaContext = buildIngredientScienceContext({
    digest: buildDigest({
      labelId: "fixture-healthforce-chlorella-manna",
      productName: "HealthForce Superfoods, Chlorella Manna™, 12.34 oz (350 g)",
      dosageForm: "Powder",
      actives: [
        { name: "Vitamin D (as D2)", amount: 10, unit: "mcg" },
        { name: "Iron", amount: 1, unit: "mg" },
      ],
    }),
    overlayClaims: null,
  });

  assert.match(
    enzymeContext.ingredientRows[0]?.name ?? "",
    /digestive enzyme|enzyme blend/i,
  );
  assert.doesNotMatch(
    enzymeContext.ingredientRows[0]?.name ?? "",
    /^proteases/i,
  );
  assert.match(spirulinaContext.ingredientRows[0]?.name ?? "", /spirulina/i);
  assert.doesNotMatch(
    spirulinaContext.ingredientRows[0]?.name ?? "",
    /vitamin a|iron/i,
  );
  assert.match(chlorellaContext.ingredientRows[0]?.name ?? "", /chlorella/i);
  assert.doesNotMatch(
    chlorellaContext.ingredientRows[0]?.name ?? "",
    /vitamin d|iron/i,
  );
});

test("single-anchor ingredient overview still allows identity copy when it adds label meaning", async () => {
  const digest = buildDigest({
    labelId: "fixture-astaxanthin",
    productName: "Astaxanthin 12 mg",
    dosageForm: "Softgel",
    actives: [{ name: "Astaxanthin", amount: 12, unit: "mg" }],
  });

  const context = buildIngredientScienceContext({
    digest,
    overlayClaims: null,
  });
  const result = await compileIngredientOverviewAsync(context, {
    llmFn: async () =>
      JSON.stringify({
        mode: "single_anchor",
        titleLine: "Astaxanthin",
        paragraph1:
          "Astaxanthin is a carotenoid ingredient commonly used in antioxidant-focused supplement formulas.",
        paragraph2:
          "On this label, it appears as the main disclosed active rather than as part of a broad blend or total line.",
        compareHint:
          "When comparing products, focus on the stated amount per serving and whether the label clearly identifies the form or source.",
      }),
  });

  assert.equal(result.source, "api");
  assert.equal(result.fallbackUsed, false);
  assert.equal(result.ingredientOverview.titleLine, "Astaxanthin");
});

test("single-anchor ingredient overview strips exact-dose factual echo before returning copy", async () => {
  const digest = buildDigest({
    labelId: "fixture-vitamin-c-single",
    productName: "Vitamin C 1000 mg",
    dosageForm: "Capsule",
    actives: [
      { name: "Vitamin C (as Ascorbic Acid)", amount: 1000, unit: "mg" },
    ],
  });

  const context = buildIngredientScienceContext({
    digest,
    overlayClaims: null,
  });
  const result = await compileIngredientOverviewAsync(context, {
    llmFn: async () =>
      JSON.stringify({
        mode: "single_anchor",
        titleLine: "Vitamin C Supplement",
        paragraph1:
          "This product centers on vitamin C, specifically as ascorbic acid. The label shows a single active ingredient with its full amount disclosed.",
        paragraph2:
          "The formula is structured as one primary ingredient line listing 1000 mg of vitamin C as ascorbic acid. No blends or additional active ingredients are present.",
        compareHint:
          "When comparing vitamin C products, check whether the form (like ascorbic acid) and the exact milligram amount match your needs.",
      }),
  });

  assert.equal(result.source, "api");
  assert.equal(result.fallbackUsed, false);
  assert.equal(result.ingredientOverview.titleLine, "Vitamin C Supplement");
  assert.doesNotMatch(result.ingredientOverview.paragraph1, /1000 mg/i);
  assert.doesNotMatch(result.ingredientOverview.paragraph2 ?? "", /1000 mg/i);
  assert.match(result.ingredientOverview.compareHint ?? "", /form/i);
});

test("single-anchor ingredient overview keeps liposomal vitamin C form context in fallback copy", async () => {
  const digest = buildDigest({
    labelId: "fixture-liposomal-vitamin-c-single",
    productName:
      "BodyBio, Liposomal Vitamin C, 60 Capsules (500 mg per Capsule)",
    dosageForm: "Capsule",
    actives: [
      {
        name: "Vitamin C (as Quali-C Ascorbic Acid)",
        amount: 1000,
        unit: "mg",
      },
    ],
  });

  const context = buildIngredientScienceContext({
    digest,
    overlayClaims: null,
  });
  const result = await compileIngredientOverviewAsync(context);
  const overviewCopy = [
    result.ingredientOverview.titleLine,
    result.ingredientOverview.paragraph1,
    result.ingredientOverview.paragraph2,
    result.ingredientOverview.compareHint,
  ].join(" ");

  assert.equal(result.source, "fallback");
  assert.match(
    result.ingredientOverview.titleLine ?? "",
    /liposomal vitamin c/i,
  );
  assert.match(overviewCopy, /liposomal vitamin c/i);
});

test("blend-anchor ingredient overview fallback names probiotic and tea blend anchors", async () => {
  const probioticContext = buildIngredientScienceContext({
    digest: buildDigest({
      labelId: "fixture-probiotic-blend-overview-fallback",
      productName: "21st Century, Acidophilus Probiotic Blend, 100 Capsules",
      dosageForm: "Capsule",
      actives: [{ name: "Proprietary Blend", amount: 175, unit: "mg" }],
    }),
    overlayClaims: null,
  });
  const teaContext = buildIngredientScienceContext({
    digest: buildDigest({
      labelId: "fixture-tea-blend-overview-fallback",
      productName:
        "Swanson, 100% Organic Chamomile Tea, Caffeine Free, 20 Tea Bags",
      dosageForm: "Tea Bag",
      actives: [{ name: "Tea blend", amount: null, unit: null }],
    }),
    overlayClaims: null,
  });
  const genericBlendContext = buildIngredientScienceContext({
    digest: buildDigest({
      labelId: "fixture-generic-blend-overview-fallback",
      productName: "Eclectic Herb, Beet Juice Powder, 3.2 oz (90 g)",
      dosageForm: "Powder",
      actives: [{ name: "Blend", amount: 3, unit: "g" }],
    }),
    overlayClaims: null,
  });
  const proprietaryBlendContext = buildIngredientScienceContext({
    digest: buildDigest({
      labelId: "fixture-proprietary-blend-overview-fallback",
      productName: "21st Century, Colon Cleanse, 120 Vegetarian Capsules",
      dosageForm: "Capsule",
      actives: [{ name: "Proprietary Blend", amount: 2000, unit: "mg" }],
    }),
    overlayClaims: null,
  });

  const probioticResult =
    await compileIngredientOverviewAsync(probioticContext);
  const teaResult = await compileIngredientOverviewAsync(teaContext);
  const genericBlendResult =
    await compileIngredientOverviewAsync(genericBlendContext);
  const proprietaryBlendResult = await compileIngredientOverviewAsync(
    proprietaryBlendContext,
  );

  assert.equal(probioticResult.source, "fallback");
  assert.match(
    probioticResult.ingredientOverview.titleLine ?? "",
    /probiotic/i,
  );
  assert.doesNotMatch(
    probioticResult.ingredientOverview.titleLine ?? "",
    /^Blend-style formula$/i,
  );
  assert.doesNotMatch(
    probioticResult.ingredientOverview.paragraph1,
    /blend-style formula/i,
  );
  assert.match(probioticResult.ingredientOverview.paragraph1, /probiotic/i);

  assert.equal(teaResult.source, "fallback");
  assert.equal(teaResult.ingredientOverview.titleLine, "Tea blend");
  assert.doesNotMatch(
    teaResult.ingredientOverview.paragraph1,
    /blend-style formula/i,
  );
  assert.match(teaResult.ingredientOverview.paragraph1, /tea blend/i);

  assert.equal(genericBlendResult.source, "fallback");
  assert.notEqual(
    genericBlendResult.ingredientOverview.titleLine,
    "Blend-style formula",
  );
  assert.doesNotMatch(
    genericBlendResult.ingredientOverview.paragraph1,
    /blend-style formula/i,
  );

  assert.equal(proprietaryBlendResult.source, "fallback");
  assert.equal(
    proprietaryBlendResult.ingredientOverview.titleLine,
    "Proprietary Blend",
  );
  assert.doesNotMatch(
    proprietaryBlendResult.ingredientOverview.paragraph1,
    /blend-style formula/i,
  );
});

test("aloe title rescue does not steal the default anchor from sea moss vitamin C formulas", () => {
  const context = buildIngredientScienceContext({
    digest: buildDigest({
      labelId: "fixture-sea-moss-vitamin-c-aloe-companion",
      productName:
        "Codeage, Amen, Sea Moss + Vitamin C, Aloe Vera & Black Pepper, 90 Vegetable Capsules",
      dosageForm: "Capsule",
      actives: [
        { name: "Organic Sea Moss", amount: null, unit: null },
        { name: "Vitamin C (as Ascorbic Acid)", amount: 90, unit: "mg" },
        { name: "Aloe Vera Extract (Whole Plant)", amount: null, unit: null },
        { name: "Black Pepper Extract", amount: null, unit: null },
      ],
    }),
    overlayClaims: null,
  });

  assert.match(context.ingredientRows[0]?.name ?? "", /vitamin c/i);
  assert.doesNotMatch(context.ingredientRows[0]?.name ?? "", /^aloe vera$/i);
});

test("omega-3 fallback copy distinguishes algal oil sources from fish oil sources", async () => {
  const context = buildIngredientScienceContext({
    digest: buildDigest({
      labelId: "fixture-algal-oil-source-copy",
      productName: "Nature's Way, Algal Oil, Omega-3, Cranberry Orange",
      dosageForm: "Liquid",
      actives: [
        { name: "Algal oil (Schizochytrium spp.)", amount: 2, unit: "g" },
        { name: "Total Omega-3", amount: 715, unit: "mg" },
        { name: "DHA", amount: 500, unit: "mg" },
      ],
    }),
    overlayClaims: null,
  });

  const overview = await compileIngredientOverviewAsync(context);
  const background = buildScientificBackgroundDeterministicFallback({
    context,
    selectedIngredientName: context.anchorIngredient?.name ?? "Algal oil",
  });
  const overviewCopy = [
    overview.ingredientOverview.titleLine,
    overview.ingredientOverview.paragraph1,
    overview.ingredientOverview.paragraph2,
    overview.ingredientOverview.compareHint,
  ].join(" ");
  const backgroundCopy = [
    background.introLine,
    ...background.sections.map((section) => section.summary),
  ].join(" ");

  assert.match(overview.ingredientOverview.titleLine ?? "", /algal oil/i);
  assert.doesNotMatch(overviewCopy, /fish[-\s]?oil/i);
  assert.match(background.introLine, /algal oil/i);
  assert.doesNotMatch(backgroundCopy, /fish[-\s]?oil/i);
});

test("omega-3 fallback copy distinguishes flax seed oil sources from fish oil sources", async () => {
  const context = buildIngredientScienceContext({
    digest: buildDigest({
      labelId: "fixture-flax-seed-oil-source-copy",
      productName:
        "NOW Foods, Certified Organic Flax Seed Oil, 12 fl oz (355 ml)",
      dosageForm: "Liquid",
      actives: [
        { name: "Linolenic Acid (Omega-3)", amount: 7.7, unit: "g" },
        { name: "Linolenic Acid (Omega-6)", amount: 2, unit: "g" },
        { name: "Oleic Acid (Omega-9)", amount: 2.7, unit: "g" },
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
  ].join(" ");

  assert.match(overviewCopy, /flax seed oil|plant oil/i);
  assert.doesNotMatch(overviewCopy, /fish[-\s]?oil/i);
});

test("omega-3 fallback copy follows the selected fish oil anchor in mixed fish flax borage formulas", async () => {
  const context = buildIngredientScienceContext({
    digest: buildDigest({
      labelId: "fixture-mixed-fish-flax-borage-source-copy",
      productName: "Webber Naturals, Omega 3-6-9 1200 mg Fish, Flax & Borage",
      dosageForm: "Softgel",
      actives: [
        {
          name: "Fish Oil Concentrate* (anchovy, sardine, and/or mackerel)",
          amount: 400,
          unit: "mg",
        },
        { name: "Flaxseed Oil", amount: 400, unit: "mg" },
        { name: "Borage Oil", amount: 400, unit: "mg" },
        { name: "Omega-3 EPA", amount: 70, unit: "mg" },
        { name: "Omega-3 DHA", amount: 45, unit: "mg" },
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
  ].join(" ");

  assert.match(
    context.anchorIngredient?.name ?? "",
    /fish\s+oil|oil\s+concentrate/i,
  );
  assert.match(
    overviewCopy,
    /fish\s+oil|oil\s+concentrate|anchovy|sardine|mackerel/i,
  );
  assert.doesNotMatch(
    overview.ingredientOverview.titleLine ?? "",
    /flax seed oil/i,
  );
});

test("omega-3 fallback copy keeps salmon oil visible when it is the selected source anchor", async () => {
  const context = buildIngredientScienceContext({
    digest: buildDigest({
      labelId: "fixture-salmon-oil-source-copy",
      productName: "Webber Naturals, Wild Alaskan Salmon Oil 1000 mg",
      dosageForm: "Softgel",
      actives: [
        { name: "Wild Alaskan Salmon Oil", amount: 1000, unit: "mg" },
        { name: "Omega-3 EPA", amount: 80, unit: "mg" },
        { name: "Omega-3 DHA", amount: 70, unit: "mg" },
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
  ].join(" ");

  assert.match(context.anchorIngredient?.name ?? "", /salmon\s+oil/i);
  assert.match(overviewCopy, /salmon\s+oil/i);
  assert.doesNotMatch(
    overview.ingredientOverview.titleLine ?? "",
    /omega-3 formula/i,
  );
});

test("science context rescues sparse title-led food-like anchors from residue rows", () => {
  const coconutAminosContext = buildIngredientScienceContext({
    digest: buildDigest({
      labelId: "fixture-coconut-aminos-title-rescue",
      productName:
        "BetterBody Foods, Organic Coconut Aminos, Soy Sauce Replacement",
      dosageForm: "Liquid",
      actives: [{ name: "Niacin", amount: 1.5, unit: "mg" }],
    }),
    overlayClaims: null,
  });
  const goGelContext = buildIngredientScienceContext({
    digest: buildDigest({
      labelId: "fixture-go-gel-title-rescue",
      productName: "BPN, Go Gel, Endurance Gel, Apple Cinnamon",
      dosageForm: "Gel",
      actives: [
        { name: "Potassium", amount: 144, unit: "mg" },
        { name: "Calcium", amount: 13, unit: "mg" },
        { name: "Fiber", amount: 0, unit: "g" },
      ],
    }),
    overlayClaims: null,
  });
  const hydrationContext = buildIngredientScienceContext({
    digest: buildDigest({
      labelId: "fixture-hydrationup-title-rescue",
      productName:
        "California Gold Nutrition, HydrationUP, Electrolyte Drink Mix with Calcium, Potassium, Vitamin C, and Vitamin E",
      dosageForm: "Powder",
      actives: [
        { name: "Vitamin C", amount: 220, unit: "mg" },
        { name: "Calcium", amount: 100, unit: "mg" },
        { name: "Vitamin E", amount: 19, unit: "mg" },
        { name: "Magnesium", amount: 40, unit: "mg" },
        { name: "Potassium", amount: 180, unit: "mg" },
      ],
    }),
    overlayClaims: null,
  });
  const proteinBarContext = buildIngredientScienceContext({
    digest: buildDigest({
      labelId: "fixture-protein-bar-title-rescue",
      productName: "Simply Protein, Crispy Snack Bars, Dark Chocolate Almond",
      dosageForm: "Bar",
      actives: [
        { name: "Potas", amount: 35, unit: "mg" },
        { name: "Glycerin", amount: 4, unit: "g" },
        { name: "Protein", amount: 12, unit: "g" },
        { name: "Total Sugars", amount: 1, unit: "g" },
      ],
    }),
    overlayClaims: null,
  });
  const energyDrinkMixContext = buildIngredientScienceContext({
    digest: buildDigest({
      labelId: "fixture-energy-drink-mix-title-rescue",
      productName: "Alani Nu, Energy Drink Mix, Cherry Slush, 10 Sticks",
      dosageForm: "Powder",
      actives: [
        { name: "Biotin", amount: 300, unit: "mcg" },
        { name: "Niacin", amount: 18, unit: "mg" },
        { name: "Vitamin B12", amount: 2.4, unit: "mcg" },
      ],
    }),
    overlayClaims: null,
  });
  const seaMossGelContext = buildIngredientScienceContext({
    digest: buildDigest({
      labelId: "fixture-sea-moss-gel-title-rescue",
      productName: "Akasha Superfoods, Liposomal Sea Moss Gel, Sweet Citrus",
      dosageForm: "Gel",
      actives: [
        { name: "Monounsaturated Fat", amount: 0.5, unit: "g" },
        { name: "Vitamin C", amount: 30, unit: "mg" },
        { name: "Sodium", amount: 15, unit: "mg" },
      ],
    }),
    overlayClaims: null,
  });
  const megaOmegaTrailMixContext = buildIngredientScienceContext({
    digest: buildDigest({
      labelId: "fixture-mega-omega-trail-mix-title-rescue",
      productName: "Power Up, Premium Trail Mix, Mega Omega",
      dosageForm: "Snack",
      actives: [
        { name: "Total Carbs", amount: 16, unit: "g" },
        { name: "Sugars", amount: 8, unit: "g" },
        { name: "Protein", amount: 5, unit: "g" },
      ],
    }),
    overlayClaims: null,
  });
  const wheyIsolateContext = buildIngredientScienceContext({
    digest: buildDigest({
      labelId: "fixture-whey-isolate-title-rescue",
      productName: "APS, Isomorph 28, Pure Whey Isolate, Chocolate Milkshake",
      dosageForm: "Powder",
      actives: [
        { name: "Sugars", amount: 1.5, unit: "g" },
        { name: "Potassium", amount: 200, unit: "mg" },
        { name: "Calcium", amount: 100, unit: "mg" },
      ],
    }),
    overlayClaims: null,
  });
  const advancedWheyContext = buildIngredientScienceContext({
    digest: buildDigest({
      labelId: "fixture-advanced-whey-title-rescue",
      productName: "AOR Advanced Whey Vanilla",
      dosageForm: "Powder",
      actives: [
        { name: "Alpha-lactalbumin", amount: 4.3, unit: "g" },
        { name: "Glycomacropeptides", amount: 3.3, unit: "g" },
        { name: "Protein", amount: 22, unit: "g" },
        { name: "Sugars", amount: 0.7, unit: "g" },
      ],
    }),
    overlayClaims: null,
  });
  const bcaaContext = buildIngredientScienceContext({
    digest: buildDigest({
      labelId: "fixture-bcaa-title-rescue",
      productName: "AOR BCAA",
      dosageForm: "Powder",
      actives: [
        { name: "L-Leucine", amount: 2500, unit: "mg" },
        { name: "L-Isoleucine", amount: 1250, unit: "mg" },
        { name: "L-Valine", amount: 1250, unit: "mg" },
      ],
    }),
    overlayClaims: null,
  });
  const actaResveratrolContext = buildIngredientScienceContext({
    digest: buildDigest({
      labelId: "fixture-acta-resveratrol-title-rescue",
      productName: "AOR Acta-Resveratrol",
      dosageForm: "Capsule",
      actives: [
        { name: "Trans-resveratrol", amount: 40, unit: "mg" },
        { name: "Vitamin C (ascorbic acid)", amount: 40, unit: "mg" },
        { name: "Quercetin", amount: 50, unit: "mg" },
        { name: "Rosemary extract", amount: 10, unit: "mg" },
      ],
    }),
    overlayClaims: null,
  });
  const energyChewsContext = buildIngredientScienceContext({
    digest: buildDigest({
      labelId: "fixture-energy-chews-title-rescue",
      productName: "Bonk Breaker, Energy Chews, Green Apples",
      dosageForm: "Chew",
      actives: [
        { name: "Vitamin C", amount: 60, unit: "mg" },
        { name: "Iron", amount: 0.3, unit: "mg" },
        { name: "Potassium", amount: 20, unit: "mg" },
        { name: "Fiber", amount: 0, unit: "g" },
      ],
    }),
    overlayClaims: null,
  });
  const liposomalGlutathioneContext = buildIngredientScienceContext({
    digest: buildDigest({
      labelId: "fixture-liposomal-glutathione-drink-mix-clean-name",
      productName:
        "Aurora Nutrascience, Nano-Liposomal, Glutathione, Liposomal Drink Mix",
      dosageForm: "Powder",
      actives: [
        {
          name: "L-Glutathione(as Nano-Liposomal Proprietary Blend)",
          amount: 750,
          unit: "mg",
        },
        { name: "Supplement Formula", amount: 750, unit: "mg" },
      ],
    }),
    overlayClaims: null,
  });
  const tamariContext = buildIngredientScienceContext({
    digest: buildDigest({
      labelId: "fixture-tamari-soy-sauce-title-rescue",
      productName: "Eden Foods, Organic Tamari Soy Sauce",
      dosageForm: "Liquid",
      actives: [
        { name: "Potas", amount: 120, unit: "mg" },
        { name: "Iron", amount: 0.7, unit: "mg" },
      ],
    }),
    overlayClaims: null,
  });
  const lozengeContext = buildIngredientScienceContext({
    digest: buildDigest({
      labelId: "fixture-xylitol-lozenge-title-rescue",
      productName: "ACT, Dry Mouth Lozenges with Xylitol, Honey-Lemon",
      dosageForm: "Lozenge",
      actives: [{ name: "Sugar Alcohol", amount: 2, unit: "g" }],
    }),
    overlayClaims: null,
  });
  const matchaLatteContext = buildIngredientScienceContext({
    digest: buildDigest({
      labelId: "fixture-matcha-latte-title-rescue",
      productName: "Chamberlain Coffee, Blue Matcha Latte with Oat Milk",
      dosageForm: "Powder",
      actives: [
        { name: "Potassium", amount: 40, unit: "mg" },
        { name: "Calcium", amount: 50, unit: "mg" },
        { name: "Fiber", amount: 1, unit: "g" },
      ],
    }),
    overlayClaims: null,
  });
  const crispyFruitContext = buildIngredientScienceContext({
    digest: buildDigest({
      labelId: "fixture-crispy-fruit-title-rescue",
      productName: "Crispy Green, Crispy Fruit, All Apple",
      dosageForm: "Snack",
      actives: [
        { name: "Vit. D", amount: 0, unit: "mcg" },
        { name: "Calcium", amount: 0, unit: "mg" },
        { name: "Potassium", amount: 40, unit: "mg" },
      ],
    }),
    overlayClaims: null,
  });
  const gummySquaresContext = buildIngredientScienceContext({
    digest: buildDigest({
      labelId: "fixture-gummy-squares-title-rescue",
      productName: "Dr. John’s Healthy Sweets, Gummy Squares, Sugar Free",
      dosageForm: "Gummy",
      actives: [
        { name: "Vitamin D", amount: 1, unit: "mcg" },
        { name: "Potassium", amount: 10, unit: "mg" },
        { name: "Fiber", amount: 0, unit: "g" },
      ],
    }),
    overlayClaims: null,
  });
  const truffleContext = buildIngredientScienceContext({
    digest: buildDigest({
      labelId: "fixture-chocolate-truffle-title-rescue",
      productName:
        "Alter Eco, Organic Dark Milk Chocolate, Silk Velvet Truffles",
      dosageForm: "Snack",
      actives: [
        { name: "Potassium", amount: 110, unit: "mg" },
        { name: "Iron", amount: 1, unit: "mg" },
        { name: "Fiber", amount: 1, unit: "g" },
      ],
    }),
    overlayClaims: null,
  });
  const curryPasteContext = buildIngredientScienceContext({
    digest: buildDigest({
      labelId: "fixture-green-curry-paste-title-rescue",
      productName: "A Taste Of Thai, Green Curry Paste",
      dosageForm: "Paste",
      actives: [
        { name: "Calcium", amount: 2, unit: "mg" },
        { name: "Potassium", amount: 20, unit: "mg" },
        { name: "Fiber", amount: 0, unit: "g" },
      ],
    }),
    overlayClaims: null,
  });
  const himalayanSaltContext = buildIngredientScienceContext({
    digest: buildDigest({
      labelId: "fixture-himalayan-crystal-salt-title-rescue",
      productName: "Aloha Bay, Himalayan Crystal Salt, Coarse",
      dosageForm: "Salt",
      actives: [{ name: "Crystal Salt", amount: 1.5, unit: "g" }],
    }),
    overlayClaims: null,
  });

  assert.match(
    coconutAminosContext.ingredientRows[0]?.name ?? "",
    /\bcoconut aminos\b|\bsoy sauce replacement\b/i,
  );
  assert.equal(coconutAminosContext.productArchetype, "functional_food_like");

  assert.match(
    goGelContext.ingredientRows[0]?.name ?? "",
    /\bendurance gel\b|\bgo gel\b|\benergy gel\b/i,
  );
  assert.equal(goGelContext.productArchetype, "functional_food_like");

  assert.match(
    hydrationContext.ingredientRows[0]?.name ?? "",
    /\belectrolyte drink mix\b|\bhydrationup\b|\belectrolyte\b/i,
  );
  assert.equal(
    hydrationContext.anchorIngredient?.ingredientFamily,
    "electrolyte_hydration",
  );

  assert.match(
    proteinBarContext.ingredientRows[0]?.name ?? "",
    /\bprotein bars?\b|\bsnack bars?\b/i,
  );
  assert.doesNotMatch(
    proteinBarContext.ingredientRows[0]?.name ?? "",
    /\bglycerin\b|\bpotas\b/i,
  );
  assert.equal(proteinBarContext.productArchetype, "functional_food_like");

  assert.match(
    energyDrinkMixContext.ingredientRows[0]?.name ?? "",
    /\benergy drink mix\b|\benergy mix\b/i,
  );
  assert.doesNotMatch(
    energyDrinkMixContext.ingredientRows[0]?.name ?? "",
    /\bbiotin\b/i,
  );
  assert.equal(energyDrinkMixContext.productArchetype, "functional_food_like");

  assert.match(
    seaMossGelContext.ingredientRows[0]?.name ?? "",
    /\bsea moss gel\b|\bsea moss\b/i,
  );
  assert.doesNotMatch(
    seaMossGelContext.ingredientRows[0]?.name ?? "",
    /\bmonounsaturated fat\b/i,
  );
  assert.equal(seaMossGelContext.productArchetype, "functional_food_like");

  assert.match(
    megaOmegaTrailMixContext.ingredientRows[0]?.name ?? "",
    /\btrail mix\b|\bmega omega\b/i,
  );
  assert.doesNotMatch(
    megaOmegaTrailMixContext.ingredientRows[0]?.name ?? "",
    /\btotal carbs?\b|\bsugars?\b|\bprotein\b/i,
  );
  assert.equal(
    megaOmegaTrailMixContext.productArchetype,
    "functional_food_like",
  );

  assert.match(
    wheyIsolateContext.ingredientRows[0]?.name ?? "",
    /\bwhey(?:\s+protein|\s+isolate)?\b|\bprotein\b/i,
  );
  assert.doesNotMatch(
    wheyIsolateContext.ingredientRows[0]?.name ?? "",
    /\bsugars?\b|\bpotassium\b|\bcalcium\b/i,
  );
  assert.equal(wheyIsolateContext.productArchetype, "functional_food_like");

  assert.match(
    advancedWheyContext.ingredientRows[0]?.name ?? "",
    /\badvanced whey\b|\bwhey\b|\bprotein\b/i,
  );
  assert.doesNotMatch(
    advancedWheyContext.ingredientRows[0]?.name ?? "",
    /\balpha-lactalbumin\b|\bglycomacropeptides\b|\bsugars?\b/i,
  );
  assert.equal(advancedWheyContext.productArchetype, "functional_food_like");

  assert.match(
    bcaaContext.ingredientRows[0]?.name ?? "",
    /\bbcaas?\b|\bbranched[\s-]*chain\s+amino\s+acids?\b/i,
  );
  assert.doesNotMatch(
    bcaaContext.ingredientRows[0]?.name ?? "",
    /\bleucine\b|\bisoleucine\b|\bvaline\b/i,
  );

  assert.match(
    actaResveratrolContext.ingredientRows[0]?.name ?? "",
    /\bresveratrol\b/i,
  );
  assert.doesNotMatch(
    actaResveratrolContext.ingredientRows[0]?.name ?? "",
    /\bvitamin c\b|\bquercetin\b/i,
  );

  assert.match(
    energyChewsContext.ingredientRows[0]?.name ?? "",
    /\benergy chews?\b/i,
  );
  assert.doesNotMatch(
    energyChewsContext.ingredientRows[0]?.name ?? "",
    /\bvitamin c\b|\biron\b|\bpotassium\b|\bfiber\b/i,
  );
  assert.equal(energyChewsContext.productArchetype, "functional_food_like");

  assert.match(
    liposomalGlutathioneContext.ingredientRows[0]?.name ?? "",
    /\bglutathione\b/i,
  );
  assert.doesNotMatch(
    liposomalGlutathioneContext.ingredientRows[0]?.name ?? "",
    /\bproprietary blend\b|\bsupplement formula\b/i,
  );
  assert.equal(
    liposomalGlutathioneContext.productArchetype,
    "functional_food_like",
  );

  assert.match(
    tamariContext.ingredientRows[0]?.name ?? "",
    /\btamari\b|\bsoy sauce\b/i,
  );
  assert.doesNotMatch(
    tamariContext.ingredientRows[0]?.name ?? "",
    /\bpotas\b|\biron\b/i,
  );
  assert.equal(tamariContext.productArchetype, "functional_food_like");

  assert.match(
    lozengeContext.ingredientRows[0]?.name ?? "",
    /\blozenges?\b|\bxylitol\b/i,
  );
  assert.doesNotMatch(
    lozengeContext.ingredientRows[0]?.name ?? "",
    /\bsugar alcohol\b/i,
  );
  assert.equal(lozengeContext.productArchetype, "functional_food_like");

  assert.match(
    matchaLatteContext.ingredientRows[0]?.name ?? "",
    /\bmatcha latte\b|\bmatcha\b/i,
  );
  assert.doesNotMatch(
    matchaLatteContext.ingredientRows[0]?.name ?? "",
    /\bpotassium\b|\bcalcium\b|\bfiber\b/i,
  );
  assert.equal(matchaLatteContext.productArchetype, "functional_food_like");

  assert.match(
    crispyFruitContext.ingredientRows[0]?.name ?? "",
    /\bcrispy fruit\b|\ball apple\b/i,
  );
  assert.doesNotMatch(
    crispyFruitContext.ingredientRows[0]?.name ?? "",
    /\bvit\.?\s*d\b|\bcalcium\b|\bpotassium\b/i,
  );
  assert.equal(crispyFruitContext.productArchetype, "functional_food_like");

  assert.match(
    gummySquaresContext.ingredientRows[0]?.name ?? "",
    /\bgummy squares\b|\bgumm(?:y|ies)\b/i,
  );
  assert.doesNotMatch(
    gummySquaresContext.ingredientRows[0]?.name ?? "",
    /\bvitamin d\b|\bpotassium\b|\bfiber\b/i,
  );
  assert.equal(gummySquaresContext.productArchetype, "functional_food_like");

  assert.match(
    truffleContext.ingredientRows[0]?.name ?? "",
    /\btruffles?\b|\bchocolate\b/i,
  );
  assert.doesNotMatch(
    truffleContext.ingredientRows[0]?.name ?? "",
    /\bpotassium\b|\biron\b|\bfiber\b/i,
  );
  assert.equal(truffleContext.productArchetype, "functional_food_like");

  assert.match(
    curryPasteContext.ingredientRows[0]?.name ?? "",
    /\bcurry paste\b/i,
  );
  assert.doesNotMatch(
    curryPasteContext.ingredientRows[0]?.name ?? "",
    /\bcalcium\b|\bpotassium\b|\bfiber\b/i,
  );
  assert.equal(curryPasteContext.productArchetype, "functional_food_like");

  assert.match(
    himalayanSaltContext.ingredientRows[0]?.name ?? "",
    /\bhimalayan crystal salt\b|\bcrystal salt\b|\bsalt\b/i,
  );
  assert.equal(himalayanSaltContext.productArchetype, "functional_food_like");
});

test("science context gives electrolyte supplements a research plan but keeps drink mixes on family-specific label context", () => {
  const supplementContext = buildIngredientScienceContext({
    digest: buildDigest({
      labelId: "fixture-electrolyte-mineral-stack-capsules",
      productName: "Electrolyte Mineral Stack Capsules",
      dosageForm: "Capsule",
      actives: [
        { name: "Potassium", amount: 180, unit: "mg" },
        { name: "Magnesium", amount: 80, unit: "mg" },
        { name: "Sodium", amount: 120, unit: "mg" },
      ],
    }),
    overlayClaims: null,
  });
  const drinkMixContext = buildIngredientScienceContext({
    digest: buildDigest({
      labelId: "fixture-electrolyte-drink-mix-label-context",
      productName: "HydrationUP Electrolyte Drink Mix",
      dosageForm: "Powder",
      actives: [
        { name: "Vitamin C", amount: 200, unit: "mg" },
        { name: "Magnesium", amount: 40, unit: "mg" },
        { name: "Potassium", amount: 180, unit: "mg" },
      ],
    }),
    overlayClaims: null,
  });

  const supplementPlan = planScientificBackgroundSections({
    context: supplementContext,
    selectedIngredientName:
      supplementContext.anchorIngredient?.name ?? "Electrolyte Mineral Stack",
  });
  const drinkMixPlan = planScientificBackgroundSections({
    context: drinkMixContext,
    selectedIngredientName:
      drinkMixContext.anchorIngredient?.name ?? "HydrationUP",
  });

  assert.equal(
    supplementContext.anchorIngredient?.ingredientFamily,
    "electrolyte_hydration",
  );
  assert.equal(supplementPlan.mode, "research_mode");
  assert.deepEqual(
    supplementPlan.sections.map((section) => section.heading),
    [
      "Hydration context",
      "Exercise and sweat-loss context",
      "Balance and disclosure context",
    ],
  );

  assert.equal(
    drinkMixContext.anchorIngredient?.ingredientFamily,
    "electrolyte_hydration",
  );
  assert.equal(drinkMixPlan.mode, "label_context_mode");
  assert.deepEqual(
    drinkMixPlan.sections.map((section) => section.heading),
    [
      "What this hydration line means on the label",
      "Why balance and disclosure still matter",
    ],
  );
});

test("flower essence titles are not treated as food-like green products", () => {
  const context = buildIngredientScienceContext({
    digest: buildDigest({
      labelId: "fixture-flower-essence-grounding-green",
      productName:
        "Flower Essence Services, Flower Essence & Essential Oil, Grounding Green, 1 fl oz (30 ml)",
      dosageForm: "Liquid",
      actives: [
        { name: "Flower Essence & Essential Oil", amount: null, unit: null },
        { name: "infusions of flowers of", amount: null, unit: null },
        { name: "Essential Oils", amount: null, unit: null },
      ],
    }),
    overlayClaims: null,
  });

  assert.notEqual(context.productArchetype, "functional_food_like");
  assert.doesNotMatch(
    context.ingredientRows[0]?.name ?? "",
    /food-based product/i,
  );
  assert.match(context.ingredientRows[0]?.name ?? "", /flower essence/i);
});

test("oral probiotic lozenges keep probiotic anchors instead of food-like anchors", () => {
  const context = buildIngredientScienceContext({
    digest: buildDigest({
      labelId: "fixture-now-oralbiotic-lozenge",
      productName: "NOW Foods, OralBiotic®, 60 Lozenges",
      dosageForm: "Lozenge",
      actives: [
        {
          name: "BLIS K12 Streptococcus salivarius K12",
          amount: 1,
          unit: "billion CFU",
        },
      ],
    }),
    overlayClaims: null,
  });

  assert.notEqual(context.productArchetype, "functional_food_like");
  assert.doesNotMatch(
    context.ingredientRows[0]?.name ?? "",
    /food-based product/i,
  );
  assert.match(
    context.ingredientRows[0]?.name ?? "",
    /oralbiotic|probiotic|streptococcus/i,
  );
});

test("omega-3 source rescue keeps algal titles out of fish-oil fallback copy even when the facts row is generic", async () => {
  const context = buildIngredientScienceContext({
    digest: buildDigest({
      labelId: "fixture-algal-oil-generic-row",
      productName:
        "Barlean's, Plant Based Omega-3 From Algae Oil, Ginger Peach",
      dosageForm: "Liquid",
      actives: [
        { name: "Omega-3 Polyunsaturated Fat", amount: null, unit: null },
        { name: "Sugar Alcohol", amount: 5, unit: "g" },
      ],
    }),
    overlayClaims: null,
  });

  const overview = await compileIngredientOverviewAsync(context);
  const background = buildScientificBackgroundDeterministicFallback({
    context,
    selectedIngredientName: context.anchorIngredient?.name ?? "Omega-3",
  });
  const overviewCopy = [
    overview.ingredientOverview.titleLine,
    overview.ingredientOverview.paragraph1,
    overview.ingredientOverview.paragraph2,
    overview.ingredientOverview.compareHint,
  ].join(" ");
  const backgroundCopy = [
    background.introLine,
    ...background.sections.map((section) => section.summary),
  ].join(" ");

  assert.match(
    context.ingredientRows[0]?.name ?? "",
    /\balgal oil\b|\bplant based omega-3\b|\bomega-3\b/i,
  );
  assert.match(
    context.anchorIngredient?.name ?? "",
    /\balgal oil\b|\bplant based omega-3\b|\bomega-3\b/i,
  );
  assert.doesNotMatch(
    context.anchorIngredient?.name ?? "",
    /polyunsaturated\s+fat/i,
  );
  assert.match(overviewCopy, /\balgal oil\b|\balgae\b/i);
  assert.doesNotMatch(overviewCopy, /fish[-\s]?oil/i);
  assert.doesNotMatch(backgroundCopy, /fish[-\s]?oil/i);
});

test("omega-3 fallback copy respects title-led algal dha products without an explicit algal oil row", async () => {
  const context = buildIngredientScienceContext({
    digest: buildDigest({
      labelId: "fixture-algal-900-dha-title-copy",
      productName: "Spring Valley, Algal-900 DHA",
      dosageForm: "Softgel",
      actives: [
        { name: "Docosahexaenoic Acid", amount: 450, unit: "mg" },
        { name: "Total Omega-3 Fatty Acids", amount: 900, unit: "mg" },
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
  ].join(" ");

  assert.match(overviewCopy, /\balgal\b|\balgae\b/i);
  assert.doesNotMatch(overviewCopy, /fish[-\s]?oil/i);
});
