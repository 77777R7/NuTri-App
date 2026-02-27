import assert from "node:assert/strict";
import test from "node:test";

import type { FactsDigest } from "../../backend/src/factsDigest";
import { extractDeterministicSignalPack } from "../../backend/src/insights/deterministicSignalExtractor";

const makeDigest = (overrides: Partial<FactsDigest> = {}): FactsDigest => ({
  sourceType: "lnhpd",
  identity: {
    type: "npn",
    value: "80029183",
    regionTags: ["ca"],
  },
  product: {
    brandDisplay: "Test Brand",
    name: "Test Product",
    dosageForm: "Capsule",
    route: "oral",
  },
  actives: [
    {
      name: "Vitamin C",
      amount: 1000,
      unit: "mg",
      source: "lnhpd",
      confidence: 0.9,
    },
  ],
  inactives: [],
  serving: {
    servingSize: "1 capsule",
    servingsPerContainer: 60,
  },
  labelDosing: [
    {
      population: "Adults",
      age: null,
      dose: "1 capsule",
      frequency: "once daily",
      rawText: "Adults: 1 capsule once daily.",
    },
  ],
  warnings: {
    warnings: ["Do not exceed suggested use."],
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
    completenessScore: 1,
  },
  ...overrides,
});

test("extractDeterministicSignalPack returns deterministic ingredient/dose/usage/safety signals", () => {
  const digest = makeDigest({
    actives: [
      {
        name: "Vitamin C",
        amount: 1000,
        unit: "mg",
        source: "lnhpd",
        confidence: 0.95,
      },
      {
        name: "Zinc",
        amount: 4,
        unit: "mg",
        source: "lnhpd",
        confidence: 0.9,
      },
    ],
  });

  const pack = extractDeterministicSignalPack({
    sourceRole: "lnhpd",
    digest,
  });

  assert.equal(pack.ingredientRows.length >= 2, true);
  assert.equal(pack.doseSignals.some((row) => row.dailyDose != null), true);
  assert.equal(pack.usageStructured.length >= 1, true);
  assert.equal(pack.safetySignals.some((row) => row.domain === "label_warning"), true);
  assert.equal(
    pack.parserDiagnostics.some((row) => row.code === "MISSING_INGREDIENT_SIGNALS"),
    false,
  );
});

test("extractDeterministicSignalPack emits RANGE_LOWER_BOUND_USED when usage frequency is a range", () => {
  const digest = makeDigest({
    actives: [
      {
        name: "Zinc",
        amount: 25,
        unit: "mg",
        source: "lnhpd",
        confidence: 0.9,
      },
    ],
    labelDosing: [
      {
        population: "Adults",
        age: null,
        dose: "1-2 capsules",
        frequency: "1-2 times daily",
        rawText: "Adults: 1-2 capsules per day.",
      },
    ],
  });

  const pack = extractDeterministicSignalPack({
    sourceRole: "lnhpd",
    digest,
  });

  assert.equal(pack.doseSignals.length, 1);
  assert.equal(pack.doseSignals[0]?.reasonCode, "RANGE_LOWER_BOUND_USED");
  assert.equal(pack.doseSignals[0]?.dailyDose?.value, 25);
  assert.equal(
    pack.parserDiagnostics.some((row) => row.code === "RANGE_LOWER_BOUND_USED"),
    true,
  );
});

test("extractDeterministicSignalPack emits UNIT_CONVERSION_UNCERTAIN for unsupported UL unit conversion", () => {
  const digest = makeDigest({
    actives: [
      {
        name: "Vitamin C",
        amount: 1,
        unit: "scoop",
        source: "lnhpd",
        confidence: 0.7,
      },
    ],
  });

  const pack = extractDeterministicSignalPack({
    sourceRole: "lnhpd",
    digest,
  });

  assert.equal(
    pack.parserDiagnostics.some((row) => row.code === "UNIT_CONVERSION_UNCERTAIN"),
    true,
  );
});

test("extractDeterministicSignalPack allows deterministic IU conversion when UL mapping supports it", () => {
  const digest = makeDigest({
    actives: [
      {
        name: "Vitamin D",
        amount: 1000,
        unit: "IU",
        source: "lnhpd",
        confidence: 0.85,
      },
    ],
  });

  const pack = extractDeterministicSignalPack({
    sourceRole: "lnhpd",
    digest,
  });

  assert.equal(
    pack.parserDiagnostics.some((row) => row.code === "UNIT_CONVERSION_UNCERTAIN"),
    false,
  );
  const ulLine = pack.safetySignals.find((row) => row.domain === "ul_reference")?.text ?? "";
  assert.match(ulLine, /Upper limit \(UL\):/i);
});

test("extractDeterministicSignalPack falls back to LNHPD product-name parsing when medicinal rows are missing", () => {
  const pack = extractDeterministicSignalPack({
    sourceRole: "lnhpd",
    factsJson: {
      productName: "Vitamin B12 1200 mcg Timed Release",
      productLicences: [
        { product_name: "Vitamin B12 1200 mcg Timed Release" },
      ],
      doses: [
        {
          population_type_desc: "Adults",
          quantity_dose: 1,
          uom_type_desc_quantity_dose: "tablet",
          frequency: 1,
          uom_type_desc_frequency: "daily",
        },
      ],
    },
  });

  assert.equal(pack.ingredientRows.length >= 1, true);
  assert.equal(pack.ingredientRows.some((row) => /vitamin b12/i.test(row.name)), true);
  assert.equal(pack.ingredientRows.some((row) => row.amount === 1200 && row.unit === "mcg"), true);
  assert.equal(pack.usageStructured.length >= 1, true);
  assert.equal(pack.usageStructured.some((row) => /daily/i.test(row.frequency ?? row.rawText ?? "")), true);
  assert.equal(pack.doseSignals.some((row) => row.dosePerUnit != null), true);
  assert.equal(
    pack.safetySignals.some(
      (row) => row.domain === "label_warning" && /use as directed for adults/i.test(row.text),
    ),
    true,
  );
  assert.equal(
    pack.parserDiagnostics.some((row) => row.code === "INGREDIENT_FALLBACK_PRODUCT_NAME_USED"),
    true,
  );
  assert.equal(
    pack.parserDiagnostics.some((row) => row.code === "SAFETY_POPULATION_SIGNAL_FROM_DOSING"),
    true,
  );
});

test("extractDeterministicSignalPack falls back to digest product-name parsing when digest actives are empty", () => {
  const digest = makeDigest({
    product: {
      brandDisplay: "Test Brand",
      name: "Vitamin B12 250 mcg",
      dosageForm: "Tablet",
      route: "oral",
    },
    actives: [],
  });

  const pack = extractDeterministicSignalPack({
    sourceRole: "lnhpd",
    digest,
  });

  assert.equal(pack.ingredientRows.length >= 1, true);
  assert.equal(pack.ingredientRows.some((row) => /vitamin b12/i.test(row.name)), true);
  assert.equal(pack.ingredientRows.some((row) => row.amount === 250 && row.unit === "mcg"), true);
  assert.equal(
    pack.parserDiagnostics.some((row) => row.code === "INGREDIENT_FALLBACK_DIGEST_PRODUCT_NAME_USED"),
    true,
  );
});

test("extractDeterministicSignalPack adds dosing guardrail safety when warnings and UL are unavailable", () => {
  const digest = makeDigest({
    actives: [
      {
        name: "L-Tyrosine",
        amount: 500,
        unit: "mg",
        source: "lnhpd",
        confidence: 0.9,
      },
    ],
    labelDosing: [
      {
        population: null,
        age: null,
        dose: "1 tablet",
        frequency: "once daily",
        rawText: "Adults: 1 tablet once daily.",
      },
    ],
    warnings: {
      warnings: [],
      consultDoctorIf: [],
      redFlags: [],
      missingFlag: true,
    },
  });

  const pack = extractDeterministicSignalPack({
    sourceRole: "lnhpd",
    digest,
  });

  assert.equal(
    pack.safetySignals.some(
      (row) =>
        row.domain === "label_warning"
        && (/label dosing guardrail:/i.test(row.text) || /use as directed for adults/i.test(row.text)),
    ),
    true,
  );
  assert.equal(
    pack.parserDiagnostics.some(
      (row) =>
        row.code === "SAFETY_DOSING_GUARDRAIL_FROM_USAGE"
        || row.code === "SAFETY_POPULATION_SIGNAL_FROM_DOSING",
    ),
    true,
  );
});

test("extractDeterministicSignalPack emits data ceiling diagnostics for missing medicinal/amount raw fields", () => {
  const pack = extractDeterministicSignalPack({
    sourceRole: "lnhpd",
    factsJson: {
      doses: [{ population_type_desc: "Adults", quantity_dose: 1, uom_type_desc_quantity_dose: "tablet" }],
      warnings: [],
    },
  });

  assert.equal(
    pack.parserDiagnostics.some((row) => row.code === "MISSING_MEDICINAL_INGREDIENTS"),
    true,
  );
  assert.equal(
    pack.parserDiagnostics.some((row) => row.code === "MISSING_AMOUNT_FIELDS"),
    false,
  );
});
