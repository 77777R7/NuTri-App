import { createHash } from "node:crypto";

import { supabase } from "../supabase.js";
import type { DatasetCache } from "./v4DatasetCache.js";
import type { ScoreBundleV4, ScoreFlag, ScoreGoalFit, ScoreHighlight, ScoreSource } from "../types.js";

export const V4_SCORE_VERSION = "v4.0.0-alpha.3";

export type ProductIngredientRow = {
  source_id: string;
  canonical_source_id: string | null;
  ingredient_id: string | null;
  name_raw: string;
  name_key: string | null;
  amount: number | null;
  unit: string | null;
  amount_normalized: number | null;
  unit_normalized: string | null;
  unit_kind: string | null;
  amount_unknown: boolean;
  is_active: boolean;
  is_proprietary_blend: boolean;
  parse_confidence: number | null;
  basis: string;
  form_raw: string | null;
};

export type IngredientMeta = {
  id: string;
  unit: string | null;
  rda_adult: number | null;
  ul_adult: number | null;
  goals: string[] | null;
};

export type IngredientEvidenceRow = {
  id: string;
  ingredient_id: string;
  goal: string;
  min_effective_dose: number | null;
  optimal_dose_range: string | null;
  evidence_grade: string | null;
  audit_status: string | null;
};

export type IngredientFormRow = {
  id: string;
  ingredient_id: string;
  form_key: string;
  form_label: string;
  relative_factor: number | null;
  confidence: number | null;
  evidence_grade: string | null;
  audit_status: string | null;
};

export type IngredientFormAliasRow = {
  id: string;
  alias_text: string;
  alias_norm: string;
  form_key: string;
  ingredient_id: string | null;
  confidence: number | null;
  audit_status: string | null;
  source: string | null;
};

type FormSignal = {
  ingredientId: string;
  ingredientName: string;
  candidateText: string;
  formId: string;
  formKey: string;
  formLabel: string;
  matchScore: number;
  effectiveFactor: number;
  confidence: number | null;
  evidenceGrade: string | null;
  auditStatus: string | null;
  aliasText?: string | null;
  aliasSource?: string | null;
  aliasConfidence?: number | null;
};

export type DailyMultiplierResult = {
  multiplier: number;
  source: string;
  reliability: "reliable" | "default" | "unreliable";
  lnhpdIdUsedForDoseLookup?: string | null;
  doseRowsFound?: number | null;
  selectedDosePop?: string | null;
  frequencyUnit?: string | null;
  penaltyReason?: string | null;
};

type UlWarnings = {
  high: string[];
  moderate: string[];
  basis: "per_day_adult";
  dailyMultiplierUsed: number;
  dailyMultiplierSource: string;
};

type ScoreComputationResult = {
  bundle: ScoreBundleV4;
  inputsHash: string;
  sourceIdForWrite: string;
  canonicalSourceId: string | null;
};

type GoalDefinition = {
  id: string;
  label: string;
  keywords: string[];
};

const GOAL_DEFINITIONS: GoalDefinition[] = [
  {
    id: "sleep_stress",
    label: "Sleep / Stress",
    keywords: [
      "melatonin",
      "theanine",
      "l theanine",
      "magnesium",
      "glycine",
      "valerian",
      "gaba",
      "ashwagandha",
      "chamomile",
      "passionflower",
    ],
  },
  {
    id: "energy_performance",
    label: "Energy / Performance",
    keywords: [
      "caffeine",
      "green tea",
      "coq10",
      "coenzyme q10",
      "b12",
      "niacin",
      "riboflavin",
      "creatine",
      "beta alanine",
    ],
  },
  {
    id: "gut_probiotic",
    label: "Gut / Probiotic",
    keywords: [
      "probiotic",
      "lactobacillus",
      "bifidobacterium",
      "inulin",
      "prebiotic",
      "fiber",
      "digestive enzyme",
    ],
  },
  {
    id: "immune",
    label: "Immune",
    keywords: ["vitamin c", "vitamin d", "zinc", "elderberry", "echinacea", "quercetin"],
  },
  {
    id: "heart_lipids",
    label: "Heart / Lipids",
    keywords: ["omega 3", "fish oil", "epa", "dha", "coq10", "magnesium"],
  },
  {
    id: "brain_focus",
    label: "Brain / Focus",
    keywords: ["dha", "omega 3", "bacopa", "ginkgo", "phosphatidylserine", "theanine"],
  },
  {
    id: "joint",
    label: "Joint",
    keywords: ["glucosamine", "chondroitin", "msm", "turmeric", "curcumin", "collagen"],
  },
  {
    id: "beauty",
    label: "Beauty",
    keywords: ["collagen", "biotin", "hyaluronic", "vitamin e", "vitamin c"],
  },
  {
    id: "blood_sugar",
    label: "Blood Sugar",
    keywords: ["berberine", "chromium", "alpha lipoic", "cinnamon", "gymnema"],
  },
  {
    id: "weight",
    label: "Weight",
    keywords: ["green tea", "garcinia", "glucomannan", "cla", "caffeine"],
  },
  {
    id: "mens_health",
    label: "Men's Health",
    keywords: ["saw palmetto", "zinc", "tongkat", "maca"],
  },
  {
    id: "womens_health",
    label: "Women's Health",
    keywords: ["iron", "folate", "folic acid", "maca", "evening primrose"],
  },
];

const GOAL_LABELS = new Map(GOAL_DEFINITIONS.map((goal) => [goal.id, goal.label]));

const normalizeNameKey = (value: string): string =>
  value.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();

const normalizeGoalId = (value?: string | null): string =>
  (value ?? "").trim().toLowerCase();

const formatGoalLabel = (goalId: string): string => {
  const label = GOAL_LABELS.get(goalId);
  if (label) return label;
  return goalId
    .split(/[_\s]+/)
    .filter(Boolean)
    .map((token) => token.charAt(0).toUpperCase() + token.slice(1))
    .join(" ");
};

const clamp = (value: number, min: number, max: number): number =>
  Math.max(min, Math.min(max, value));

const roundScore = (value: number): number => Math.round(value * 100) / 100;

const RECOGNIZED_UNITS = new Set(["mcg", "ug", "mg", "g", "iu", "ml", "cfu"]);
const DOSE_UNIT_KINDS = new Set(["mass", "volume", "iu", "cfu"]);
const FORM_ALPHA = 0.85;
const DEFAULT_DAILY_MULTIPLIER = 1;
const DEFAULT_DAILY_CONFIDENCE_PENALTY = 0.95;
const NON_DAILY_CONFIDENCE_PENALTY = 0.92;
const WEEKLY_CONFIDENCE_PENALTY = 0.93;
const VERIFIED_AUDIT_STATUS = "verified";
const MAX_AUDIT_ITEMS = 25;
const MAX_FORM_SIGNALS = 20;

const isRecognizedUnit = (unit?: string | null, unitKind?: string | null): boolean => {
  if (unitKind) return DOSE_UNIT_KINDS.has(unitKind);
  if (!unit) return false;
  return RECOGNIZED_UNITS.has(unit.trim().toLowerCase());
};

const normalizeAuditStatus = (value?: string | null): string =>
  (value ?? "").trim().toLowerCase();

const isVerifiedAudit = (value?: string | null): boolean =>
  normalizeAuditStatus(value) === VERIFIED_AUDIT_STATUS;

const normalizeFormText = (value?: string | null): string => {
  if (!value) return "";
  return value.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
};

const createSeedAlias = (
  aliasText: string,
  formKey: string,
  confidence: number,
): IngredientFormAliasRow => ({
  id: `seed_${aliasText.toLowerCase().replace(/[^a-z0-9]+/g, "_")}_${formKey}`,
  alias_text: aliasText,
  alias_norm: normalizeFormText(aliasText),
  form_key: formKey,
  ingredient_id: null,
  confidence,
  audit_status: "derived",
  source: "seed",
});

const BUILTIN_FORM_ALIAS_SEEDS: [string, string, number][] = [
  ["glycinate", "glycinate", 0.7],
  ["bisglycinate", "bisglycinate", 0.8],
  ["bi-glycinate", "bisglycinate", 0.7],
  ["di-glycinate", "bisglycinate", 0.7],
  ["diglycinate", "bisglycinate", 0.7],
  ["chelate", "bisglycinate", 0.6],
  ["chelated", "bisglycinate", 0.6],
  ["amino acid chelate", "bisglycinate", 0.6],
  ["citrate", "citrate", 0.7],
  ["tri-citrate", "citrate", 0.7],
  ["citrate malate", "citrate_malate", 0.7],
  ["malate", "malate", 0.7],
  ["picolinate", "picolinate", 0.7],
  ["gluconate", "gluconate", 0.7],
  ["sulfate", "sulfate", 0.7],
  ["sulphate", "sulfate", 0.7],
  ["chloride", "chloride", 0.7],
  ["carbonate", "carbonate", 0.7],
  ["nitrate", "nitrate", 0.7],
  ["phosphate", "phosphate", 0.7],
  ["threonate", "l_threonate", 0.7],
  ["l-threonate", "l_threonate", 0.7],
  ["magtein", "l_threonate", 0.8],
  ["hcl", "hcl", 0.7],
  ["hydrochloride", "hcl", 0.7],
  ["ferrous fumarate", "ferrous_fumarate", 0.8],
  ["ferrous sulfate", "ferrous_sulfate", 0.8],
  ["ferrous gluconate", "ferrous_gluconate", 0.8],
  ["manganese bisglycinate", "manganese_bisglycinate", 0.8],
  ["manganese gluconate", "manganese_gluconate", 0.8],
  ["manganese sulfate", "manganese_sulfate", 0.8],
  ["copper bisglycinate", "copper_bisglycinate", 0.8],
  ["copper gluconate", "copper_gluconate", 0.8],
  ["copper sulfate", "copper_sulfate", 0.8],
  ["potassium chloride", "potassium_chloride", 0.8],
  ["potassium citrate", "potassium_citrate", 0.8],
  ["potassium gluconate", "potassium_gluconate", 0.8],
  ["potassium iodide", "potassium_iodide", 0.8],
  ["sodium iodide", "sodium_iodide", 0.8],
  ["sodium ascorbate", "sodium_ascorbate", 0.8],
  ["calcium ascorbate", "calcium_ascorbate", 0.8],
  ["calcium pantothenate", "calcium_pantothenate", 0.8],
  ["calcium fructoborate", "calcium_fructoborate", 0.8],
  ["boron citrate", "boron_citrate", 0.8],
  ["selenium yeast", "selenium_yeast", 0.8],
  ["selenomethionine", "selenomethionine", 0.8],
  ["selenite", "selenite", 0.8],
  ["molybdenum chelate", "molybdenum_chelate", 0.8],
  ["sodium molybdate", "sodium_molybdate", 0.8],
  ["methylfolate", "methylfolate", 0.8],
  ["5-mthf", "5_mthf", 0.8],
  ["5 mthf", "5_mthf", 0.8],
  ["folic acid", "folic_acid", 0.8],
  ["folinic acid", "folinic_acid", 0.8],
  ["cyanocobalamin", "cyanocobalamin", 0.8],
  ["methylcobalamin", "methylcobalamin", 0.8],
  ["adenosylcobalamin", "adenosylcobalamin", 0.8],
  ["hydroxocobalamin", "hydroxocobalamin", 0.8],
  ["p5p", "p5p", 0.8],
  ["pyridoxine hcl", "pyridoxine_hcl", 0.8],
  ["thiamine hcl", "thiamine_hcl", 0.8],
  ["thiamine mononitrate", "thiamine_mononitrate", 0.8],
  ["riboflavin 5 phosphate", "riboflavin_5_phosphate", 0.8],
  ["riboflavin-5-phosphate", "riboflavin_5_phosphate", 0.8],
  ["niacinamide", "niacinamide", 0.8],
  ["nicotinic acid", "nicotinic_acid", 0.8],
  ["nicotinamide riboside", "nicotinamide_riboside", 0.8],
  ["inositol hexanicotinate", "inositol_hexanicotinate", 0.8],
  ["d3", "d3_cholecalciferol", 0.7],
  ["cholecalciferol", "d3_cholecalciferol", 0.8],
  ["d2", "d2_ergocalciferol", 0.7],
  ["ergocalciferol", "d2_ergocalciferol", 0.8],
  ["retinyl palmitate", "retinyl_palmitate", 0.8],
  ["retinyl acetate", "retinyl_acetate", 0.8],
  ["beta carotene", "beta_carotene", 0.8],
  ["ethyl ester", "ethyl_ester", 0.8],
  ["triglyceride", "triglyceride", 0.8],
  ["rTG", "triglyceride", 0.7],
  ["rtg", "triglyceride", 0.7],
  ["re-esterified triglyceride", "triglyceride", 0.7],
  ["reesterified triglyceride", "triglyceride", 0.7],
  ["phospholipid", "phospholipid", 0.8],
  ["phospholipid complex", "phospholipid", 0.7],
  ["free fatty acid", "free_fatty_acid", 0.7],
  ["free acid", "free_acid", 0.7],
  ["liposomal", "liposomal", 0.8],
  ["liposome", "liposomal", 0.7],
  ["phytosome", "phytosome", 0.8],
  ["micellar", "micellar", 0.8],
  ["micellized", "micellized", 0.8],
  ["microencapsulated", "microencapsulated", 0.7],
  ["micronized", "micronized", 0.7],
  ["emulsified", "emulsified", 0.7],
  ["beadlet", "beadlet", 0.7],
  ["delayed release", "delayed_release", 0.7],
  ["sustained release", "sustained_release", 0.7],
  ["slow release", "slow_release", 0.7],
  ["enteric", "enteric", 0.7],
  ["buffered", "buffered", 0.7],
  ["with piperine", "with_piperine", 0.7],
  ["bioperine", "with_piperine", 0.7],
  ["meriva", "phytosome", 0.7],
  ["quercefit", "phytosome", 0.7],
  ["curqfen", "phytosome", 0.6],
  ["bcm-95", "essential_oils_complex", 0.6],
  ["cavacurmin", "micellar", 0.6],
  ["longvida", "solid_lipid_particles", 0.7],
  ["slcp", "solid_lipid_particles", 0.7],
  ["theracurmin", "micellar", 0.7],
  ["novasol", "micellar", 0.7],
  ["emiq", "emiq", 0.8],
  ["isoquercetin", "isoquercetin", 0.8],
  ["suntheanine", "suntheanine", 0.8],
  ["pharmagaba", "pharmaGABA", 0.8],
  ["sensoril", "sensoril", 0.8],
  ["ksm-66", "branded", 0.6],
  ["traacs", "branded", 0.6],
  ["albion", "branded", 0.6],
  ["optizinc", "branded", 0.6],
  ["carnoSyn", "carnoSyn", 0.8],
  ["carnosyn", "carnoSyn", 0.8],
  ["egb 761", "egb761", 0.8],
  ["bacognize", "bacognize", 0.8],
  ["shr-5", "shr5", 0.8],
  ["shr5", "shr5", 0.8],
  ["silexan", "silexan", 0.8],
  ["optiMSM", "optims_msm", 0.8],
  ["optimsm", "optims_msm", 0.8],
];

export const BUILTIN_FORM_ALIASES: IngredientFormAliasRow[] = BUILTIN_FORM_ALIAS_SEEDS.map(
  ([aliasText, formKey, confidence]) => createSeedAlias(aliasText, formKey, confidence),
);

const resolveGradeWeight = (grade?: string | null): number => {
  const normalized = (grade ?? "").trim().toLowerCase();
  if (!normalized) return 0.75;
  if (["a", "strong", "high"].includes(normalized)) return 1.0;
  if (["b", "moderate", "medium"].includes(normalized)) return 0.85;
  if (["c", "weak", "low"].includes(normalized)) return 0.7;
  if (["d", "none"].includes(normalized)) return 0.5;
  return 0.75;
};

const parseNumericRange = (
  rangeValue?: string | null,
): { min: number | null; max: number | null } => {
  if (!rangeValue) return { min: null, max: null };
  const match = rangeValue.match(/^[\[\(]([^,]*),([^)\]]*)[\)\]]$/);
  if (!match) return { min: null, max: null };
  const minRaw = match[1]?.trim() ?? "";
  const maxRaw = match[2]?.trim() ?? "";
  const min = minRaw ? Number(minRaw) : null;
  const max = maxRaw ? Number(maxRaw) : null;
  return {
    min: Number.isFinite(min) ? min : null,
    max: Number.isFinite(max) ? max : null,
  };
};

const resolveEvidenceWeight = (grade?: string | null, auditStatus?: string | null): number =>
  isVerifiedAudit(auditStatus) ? resolveGradeWeight(grade) : 0;

const computeDoseAdequacy = (params: {
  amount: number | null;
  unitMatches: boolean;
  minDose: number | null;
  optimalRange: { min: number | null; max: number | null };
  evidenceWeight: number;
}): number => {
  const weight = params.evidenceWeight;
  if (params.amount == null || !params.unitMatches) {
    return clamp(0.25 * weight, 0, 1);
  }
  const minDose = params.minDose ?? params.optimalRange.min;
  if (!minDose || minDose <= 0) {
    return clamp(0.5 * weight, 0, 1);
  }
  const amount = params.amount;
  let base = 0;
  if (amount < minDose * 0.5) {
    base = 0.2;
  } else if (amount < minDose) {
    base = 0.4;
  } else if (params.optimalRange.min != null && params.optimalRange.max != null) {
    if (amount >= params.optimalRange.min && amount <= params.optimalRange.max) {
      base = 1.0;
    } else if (amount > params.optimalRange.max && amount <= params.optimalRange.max * 1.5) {
      base = 0.7;
    } else {
      base = 0.4;
    }
  } else if (amount <= minDose * 2) {
    base = 0.9;
  } else if (amount <= minDose * 3) {
    base = 0.7;
  } else {
    base = 0.5;
  }
  return clamp(base * weight, 0, 1);
};

const DAILY_MULTIPLIER_SOURCE_DEFAULT = "default_no_dosing_info";
const DAILY_MULTIPLIER_SOURCE_DEFAULT_MISSING = "default_missing_canonical";
const DAILY_MULTIPLIER_SOURCE_DEFAULT_INVALID = "default_invalid_fields";
const DAILY_MULTIPLIER_SOURCE_DEFAULT_NON_ADULT = "default_non_adult";
const DAILY_MULTIPLIER_SOURCE_LNHPD = "lnhpd_dose";
const DAILY_MULTIPLIER_SOURCE_LNHPD_WEEKLY = "lnhpd_weekly_dose";
const DAILY_MULTIPLIER_SOURCE_NON_DAILY = "non_daily_frequency_unit";

export const createDefaultDailyMultiplier = (): DailyMultiplierResult => ({
  multiplier: DEFAULT_DAILY_MULTIPLIER,
  source: DAILY_MULTIPLIER_SOURCE_DEFAULT,
  reliability: "default",
  lnhpdIdUsedForDoseLookup: null,
  doseRowsFound: null,
  selectedDosePop: null,
  frequencyUnit: null,
  penaltyReason: null,
});

const toNumber = (value: unknown): number | null => {
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (typeof value === "string") {
    const trimmed = value.trim();
    if (!trimmed) return null;
    const parsed = Number.parseFloat(trimmed);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
};

const pickNumberField = (record: Record<string, unknown>, keys: string[]): number | null => {
  for (const key of keys) {
    if (!(key in record)) continue;
    const value = toNumber(record[key]);
    if (value != null) return value;
  }
  return null;
};

const pickStringField = (record: Record<string, unknown>, keys: string[]): string | null => {
  for (const key of keys) {
    if (!(key in record)) continue;
    const value = record[key];
    if (typeof value === "string") {
      const trimmed = value.trim();
      if (trimmed) return trimmed;
    }
  }
  return null;
};

const averageRange = (min: number | null, max: number | null): number | null => {
  if (min == null && max == null) return null;
  if (min != null && max != null) return (min + max) / 2;
  return min ?? max;
};

const coercePositive = (value: number | null): number | null =>
  value != null && Number.isFinite(value) && value > 0 ? value : null;

const isDailyFrequencyUnit = (value?: string | null): boolean => {
  if (!value) return false;
  const normalized = value.trim().toLowerCase();
  return normalized.includes("day") || normalized.includes("daily");
};

const isWeeklyFrequencyUnit = (value?: string | null): boolean => {
  if (!value) return false;
  const normalized = value.trim().toLowerCase();
  return normalized.includes("week");
};

const normalizeAgeUnit = (value?: string | null): string | null => {
  if (!value) return null;
  const normalized = value.trim().toLowerCase();
  if (!normalized) return null;
  if (normalized.includes("year")) return "years";
  if (normalized.includes("month")) return "months";
  if (normalized.includes("week")) return "weeks";
  if (normalized.includes("day")) return "days";
  return normalized;
};

const pickDosePopulation = (record: Record<string, unknown>): string | null =>
  pickStringField(record, ["population_type_desc", "population_type", "population_desc"]);

const isAdultDoseRecord = (record: Record<string, unknown>): boolean => {
  const population = pickDosePopulation(record);
  if (population && population.toLowerCase().includes("adult")) return true;
  const ageMin = pickNumberField(record, ["age_minimum", "age_min", "age"]);
  if (ageMin != null && ageMin >= 18) {
    const ageUnit = normalizeAgeUnit(
      pickStringField(record, ["uom_type_desc_age", "age_unit", "age_unit_of_measure"]),
    );
    if (!ageUnit || ageUnit === "years") {
      return true;
    }
  }
  return false;
};

export const computeDailyMultiplierFromLnhpdFacts = (
  factsJson: Record<string, unknown>,
): DailyMultiplierResult => {
  const dosesRaw = factsJson.doses;
  const doses = Array.isArray(dosesRaw) ? dosesRaw : dosesRaw ? [dosesRaw] : [];
  const doseRecords = doses.filter((entry): entry is Record<string, unknown> => Boolean(entry && typeof entry === "object"));
  const doseRowsFound = doseRecords.length;
  if (!doseRowsFound) {
    return {
      multiplier: DEFAULT_DAILY_MULTIPLIER,
      source: DAILY_MULTIPLIER_SOURCE_DEFAULT,
      reliability: "default",
      doseRowsFound,
      selectedDosePop: null,
      frequencyUnit: null,
      penaltyReason: "missing_dose_rows",
    };
  }

  const selectedByPopulation = doseRecords.find((record) => {
    const population = pickDosePopulation(record);
    return Boolean(population && population.toLowerCase().includes("adult"));
  });
  const selectedByAge = doseRecords.find((record) => isAdultDoseRecord(record));
  const selected = selectedByPopulation ?? selectedByAge ?? null;
  const selectedDosePop = selected ? pickDosePopulation(selected) : pickDosePopulation(doseRecords[0]);
  if (!selected) {
    return {
      multiplier: DEFAULT_DAILY_MULTIPLIER,
      source: DAILY_MULTIPLIER_SOURCE_DEFAULT_NON_ADULT,
      reliability: "default",
      doseRowsFound,
      selectedDosePop,
      frequencyUnit: null,
      penaltyReason: "non_adult_population",
    };
  }

  const frequency = pickNumberField(selected, ["frequency", "frequency_value"]);
  const frequencyMin = pickNumberField(selected, ["frequency_minimum", "frequency_min"]);
  const frequencyMax = pickNumberField(selected, ["frequency_maximum", "frequency_max"]);
  const quantity = pickNumberField(selected, ["quantity_dose", "quantity", "dose", "dosage", "quantity_value", "dose_value"]);
  const quantityMin = pickNumberField(selected, ["quantity_dose_minimum", "quantity_minimum", "dose_minimum", "quantity_min", "dose_min"]);
  const quantityMax = pickNumberField(selected, ["quantity_dose_maximum", "quantity_maximum", "dose_maximum", "quantity_max", "dose_max"]);

  const frequencyUnit = pickStringField(selected, [
    "uom_type_desc_frequency",
    "frequency_unit",
    "frequency_unit_of_measure",
  ]);
  const frequencyUnitRaw = frequencyUnit ?? null;

  if (isWeeklyFrequencyUnit(frequencyUnit)) {
    const frequencyResolved =
      coercePositive(frequency) ?? coercePositive(averageRange(frequencyMin, frequencyMax));
    const quantityResolved =
      coercePositive(quantity) ?? coercePositive(averageRange(quantityMin, quantityMax));
    if (frequencyResolved == null || quantityResolved == null) {
      return {
        multiplier: DEFAULT_DAILY_MULTIPLIER,
        source: DAILY_MULTIPLIER_SOURCE_DEFAULT_INVALID,
        reliability: "unreliable",
        doseRowsFound,
        selectedDosePop,
        frequencyUnit: frequencyUnitRaw,
        penaltyReason: "invalid_dose_fields",
      };
    }
    return {
      multiplier: (frequencyResolved * quantityResolved) / 7,
      source: DAILY_MULTIPLIER_SOURCE_LNHPD_WEEKLY,
      reliability: "unreliable",
      doseRowsFound,
      selectedDosePop,
      frequencyUnit: frequencyUnitRaw,
      penaltyReason: "weekly_converted",
    };
  }

  if (!isDailyFrequencyUnit(frequencyUnit)) {
    return {
      multiplier: DEFAULT_DAILY_MULTIPLIER,
      source: DAILY_MULTIPLIER_SOURCE_NON_DAILY,
      reliability: "unreliable",
      doseRowsFound,
      selectedDosePop,
      frequencyUnit: frequencyUnitRaw,
      penaltyReason: "non_daily_frequency_unit",
    };
  }

  const frequencyResolved =
    coercePositive(frequency) ?? coercePositive(averageRange(frequencyMin, frequencyMax));
  const quantityResolved =
    coercePositive(quantity) ?? coercePositive(averageRange(quantityMin, quantityMax));
  const hasFullDose = frequencyResolved != null && quantityResolved != null;
  if (!hasFullDose) {
    return {
      multiplier: DEFAULT_DAILY_MULTIPLIER,
      source: DAILY_MULTIPLIER_SOURCE_DEFAULT_INVALID,
      reliability: "unreliable",
      doseRowsFound,
      selectedDosePop,
      frequencyUnit: frequencyUnitRaw,
      penaltyReason: "invalid_dose_fields",
    };
  }
  return {
    multiplier: frequencyResolved * quantityResolved,
    source: DAILY_MULTIPLIER_SOURCE_LNHPD,
    reliability: "reliable",
    doseRowsFound,
    selectedDosePop,
    frequencyUnit: frequencyUnitRaw,
    penaltyReason: null,
  };
};

const computeEffectiveFormFactor = (form: IngredientFormRow): number => {
  if (!isVerifiedAudit(form.audit_status)) return 1;
  const relative = Number(form.relative_factor ?? 1);
  const confidence = Number(form.confidence ?? 0.5);
  const weight = clamp(confidence, 0, 1) * resolveGradeWeight(form.evidence_grade);
  const raw = 1 + (relative - 1) * weight * FORM_ALPHA;
  const gradeWeight = resolveGradeWeight(form.evidence_grade);
  const isEnhanced = gradeWeight >= 0.85;
  const min = isEnhanced ? 0.7 : 0.75;
  const max = isEnhanced ? 1.4 : 1.25;
  return clamp(raw, min, max);
};

type FormMatchResult = {
  form: IngredientFormRow;
  matchScore: number;
  effectiveFactor: number;
  aliasMatch: IngredientFormAliasRow | null;
};

const computeAliasMatchScore = (
  candidateNormalized: string,
  candidateTokens: Set<string>,
  alias: IngredientFormAliasRow,
): number => {
  const aliasNorm = normalizeFormText(alias.alias_norm || alias.alias_text);
  if (!aliasNorm) return 0;
  if (candidateNormalized === aliasNorm) return 1.0;
  if (candidateNormalized.includes(aliasNorm)) return 0.9;
  const aliasTokens = aliasNorm.split(/\s+/).filter(Boolean);
  if (aliasTokens.length && aliasTokens.every((token) => candidateTokens.has(token))) {
    return 0.8;
  }
  if (aliasTokens.some((token) => candidateTokens.has(token))) {
    return 0.6;
  }
  return 0;
};

const selectBestFormMatch = (
  candidate: string | null,
  forms: IngredientFormRow[],
  aliases: IngredientFormAliasRow[] | null,
): FormMatchResult | null => {
  if (!candidate || !forms.length) return null;
  const candidateNormalized = normalizeFormText(candidate);
  if (!candidateNormalized) return null;
  const candidateTokens = new Set(candidateNormalized.split(/\s+/).filter(Boolean));

  let best: FormMatchResult | null = null;

  forms.forEach((form) => {
    const keyNormalized = normalizeFormText(form.form_key);
    const labelNormalized = normalizeFormText(form.form_label);
    const keyTokens = keyNormalized.split(/\s+/).filter(Boolean);
    const labelTokens = labelNormalized.split(/\s+/).filter(Boolean);
    let baseScore = 0;
    let aliasMatch: IngredientFormAliasRow | null = null;

    if (keyNormalized && candidateNormalized.includes(keyNormalized)) {
      baseScore = 1.0;
    } else if (keyTokens.length && keyTokens.every((token) => candidateTokens.has(token))) {
      baseScore = 0.9;
    } else if (labelTokens.length && labelTokens.every((token) => candidateTokens.has(token))) {
      baseScore = 0.8;
    } else if (labelTokens.some((token) => candidateTokens.has(token))) {
      baseScore = 0.6;
    }

    const aliasCandidates = aliases?.filter((alias) => alias.form_key === form.form_key) ?? [];
    if (aliasCandidates.length) {
      aliasCandidates.forEach((alias) => {
        const aliasScoreBase = computeAliasMatchScore(candidateNormalized, candidateTokens, alias);
        if (!aliasScoreBase) return;
        const aliasConfidence = clamp(Number(alias.confidence ?? 0.6), 0, 1);
        const aliasAuditWeight = isVerifiedAudit(alias.audit_status) ? 1 : 0.8;
        const score = aliasScoreBase * aliasConfidence * aliasAuditWeight;
        if (score > baseScore) {
          baseScore = score;
          aliasMatch = alias;
        }
      });
    }

    if (!baseScore) return;

    const evidenceWeight = resolveEvidenceWeight(form.evidence_grade, form.audit_status);
    const confidence = Number(form.confidence ?? 0.5);
    const matchScore = baseScore * clamp(confidence, 0, 1) * evidenceWeight;
    if (!best || matchScore > best.matchScore) {
      best = {
        form,
        matchScore,
        effectiveFactor: computeEffectiveFormFactor(form),
        aliasMatch,
      };
    }
  });

  return best;
};

const buildInputsHash = (
  rows: ProductIngredientRow[],
  context?: { dailyMultiplier?: number; dailyMultiplierSource?: string; datasetVersion?: string | null },
): string => {
  const payload = {
    rows: rows
      .map((row) => ({
        nameRaw: row.name_raw,
        nameKey: row.name_key ?? normalizeNameKey(row.name_raw),
        ingredientId: row.ingredient_id,
        amount: row.amount,
        unit: row.unit,
        amountNormalized: row.amount_normalized,
        unitNormalized: row.unit_normalized,
        unitKind: row.unit_kind,
        amountUnknown: row.amount_unknown,
        parseConfidence: row.parse_confidence,
        active: row.is_active,
        proprietaryBlend: row.is_proprietary_blend,
        basis: row.basis,
        form: row.form_raw,
      }))
      .sort((a, b) => {
        const nameKeyCompare = a.nameKey.localeCompare(b.nameKey);
        if (nameKeyCompare !== 0) return nameKeyCompare;
        const nameRawCompare = a.nameRaw.localeCompare(b.nameRaw);
        if (nameRawCompare !== 0) return nameRawCompare;
        const ingredientCompare = String(a.ingredientId ?? "").localeCompare(
          String(b.ingredientId ?? ""),
        );
        if (ingredientCompare !== 0) return ingredientCompare;
        const basisCompare = String(a.basis ?? "").localeCompare(String(b.basis ?? ""));
        if (basisCompare !== 0) return basisCompare;
        return String(a.form ?? "").localeCompare(String(b.form ?? ""));
      }),
    context: {
      dailyMultiplier: context?.dailyMultiplier ?? null,
      dailyMultiplierSource: context?.dailyMultiplierSource ?? null,
      datasetVersion: context?.datasetVersion ?? null,
    },
  };
  const json = JSON.stringify(payload);
  return createHash("sha256").update(json).digest("hex");
};

const resolveGoalMatches = (rows: ProductIngredientRow[]): ScoreGoalFit[] => {
  const activeRows = rows.filter((row) => row.is_active);
  if (!activeRows.length) return [];

  const normalizedGoals = GOAL_DEFINITIONS.map((goal) => ({
    ...goal,
    keywords: goal.keywords.map(normalizeNameKey),
  }));

  const goalScores = normalizedGoals.map((goal) => {
    let score = 0;
    activeRows.forEach((row) => {
      const nameKey = normalizeNameKey(row.name_raw);
      if (!nameKey) return;
      const matches = goal.keywords.some((keyword) => nameKey.includes(keyword));
      if (!matches) return;
      const base = row.amount_unknown ? 18 : 26;
      score += base;
    });
    return {
      goal: goal.id,
      label: goal.label,
      score: Math.round(clamp(score, 0, 100)),
    };
  });

  return goalScores
    .filter((goal) => goal.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, 3);
};

const KEYWORD_FALLBACK_WEIGHT = 0.6;

const resolveBestFitGoals = (
  rows: ProductIngredientRow[],
  goalDoseAdequacy: Record<string, number>,
): ScoreGoalFit[] => {
  const mergedScores = new Map<string, number>();
  Object.entries(goalDoseAdequacy).forEach(([goal, score]) => {
    const normalized = normalizeGoalId(goal);
    if (!normalized) return;
    mergedScores.set(normalized, Math.round(clamp(score, 0, 1) * 100));
  });

  const fallbackRows = rows.filter((row) => row.is_active && !row.ingredient_id);
  if (fallbackRows.length) {
    const fallbackGoals = resolveGoalMatches(fallbackRows);
    fallbackGoals.forEach((goalFit) => {
      const normalized = normalizeGoalId(goalFit.goal);
      if (!normalized) return;
      const scaled = Math.round(goalFit.score * KEYWORD_FALLBACK_WEIGHT);
      const existing = mergedScores.get(normalized);
      mergedScores.set(normalized, existing == null ? scaled : Math.max(existing, scaled));
    });
  }

  return Array.from(mergedScores.entries())
    .map(([goal, score]) => ({
      goal,
      label: formatGoalLabel(goal),
      score: Math.round(clamp(score, 0, 100)),
    }))
    .filter((goal) => goal.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, 3);
};

const computeUlWarnings = (
  rows: ProductIngredientRow[],
  ingredientMeta: Map<string, IngredientMeta>,
  dailyMultiplier: DailyMultiplierResult,
): UlWarnings => {
  const high: string[] = [];
  const moderate: string[] = [];

  rows.forEach((row) => {
    if (!row.ingredient_id || !row.is_active) return;
    const meta = ingredientMeta.get(row.ingredient_id);
    if (!meta?.ul_adult || meta.ul_adult <= 0) return;
    const unit = row.unit_normalized ?? row.unit;
    const amount = row.amount_normalized ?? row.amount;
    if (!unit || amount == null || !meta.unit || unit !== meta.unit) return;
    const multiplier = row.basis === "label_serving" ? dailyMultiplier.multiplier : 1;
    const amountPerDay = amount * multiplier;
    const ratio = amountPerDay / meta.ul_adult;
    if (!Number.isFinite(ratio)) return;
    if (ratio >= 1.2) {
      high.push(row.name_raw);
    } else if (ratio >= 1.0) {
      moderate.push(row.name_raw);
    }
  });

  return {
    high,
    moderate,
    basis: "per_day_adult",
    dailyMultiplierUsed: dailyMultiplier.multiplier,
    dailyMultiplierSource: dailyMultiplier.source,
  };
};

const computeConfidence = (
  coverage: number,
  avgParseConfidence: number,
  matchRatio: number,
  unitOkRatio: number,
  canonicalSourceId: string | null,
  formCoverageRatio: number,
): number => {
  const identityConfidence = canonicalSourceId ? 0.75 : 0.55;
  const weighted =
    0.05 +
    0.25 * coverage +
    0.2 * avgParseConfidence +
    0.2 * matchRatio +
    0.15 * unitOkRatio +
    0.12 * identityConfidence +
    0.08 * formCoverageRatio;
  return clamp(weighted, 0.1, 0.95);
};

const computeScores = (
  rows: ProductIngredientRow[],
  canonicalSourceId: string | null,
  ingredientMeta: Map<string, IngredientMeta>,
  evidenceRows: IngredientEvidenceRow[],
  formRows: IngredientFormRow[],
  formAliases: IngredientFormAliasRow[],
  dailyMultiplier: DailyMultiplierResult,
) => {
  const activeRows = rows.filter((row) => row.is_active);
  const activeCount = activeRows.length;
  const isUnitOk = (row: ProductIngredientRow): boolean => {
    if (!isRecognizedUnit(row.unit_normalized ?? row.unit, row.unit_kind)) return false;
    if (!row.ingredient_id) return true;
    const metaUnit = ingredientMeta.get(row.ingredient_id)?.unit ?? null;
    if (!metaUnit) return true;
    const unitValue = row.unit_normalized ?? row.unit;
    return Boolean(unitValue && unitValue === metaUnit);
  };
  const knownDoseCount = activeRows.filter((row) => {
    if (row.amount == null || row.amount_unknown) return false;
    return isUnitOk(row);
  }).length;
  const proprietaryBlendCount = activeRows.filter((row) => row.is_proprietary_blend).length;
  const coverage = activeCount ? knownDoseCount / activeCount : 0;
  const matchCount = activeRows.filter((row) => Boolean(row.ingredient_id)).length;
  const matchRatio = activeCount ? matchCount / activeCount : 0;
  const unitOkCount = activeRows.filter((row) => isUnitOk(row)).length;
  const unitOkRatio = activeCount ? unitOkCount / activeCount : 0;
  const unknownUnitCount = activeRows.filter((row) => !isUnitOk(row)).length;
  const unknownUnitRatio = activeCount ? unknownUnitCount / activeCount : 0;

  const parseValues = rows
    .map((row) => row.parse_confidence)
    .filter((value): value is number => typeof value === "number");
  const avgParseConfidence = parseValues.length
    ? parseValues.reduce((sum, value) => sum + value, 0) / parseValues.length
    : 0.5;

  const formsByIngredient = new Map<string, IngredientFormRow[]>();
  formRows.forEach((form) => {
    if (!form.ingredient_id) return;
    const bucket = formsByIngredient.get(form.ingredient_id) ?? [];
    bucket.push(form);
    formsByIngredient.set(form.ingredient_id, bucket);
  });
  const globalAliases = formAliases.filter((alias) => !alias.ingredient_id);
  const aliasesByIngredient = new Map<string, IngredientFormAliasRow[]>();
  formAliases.forEach((alias) => {
    if (!alias.ingredient_id) return;
    const bucket = aliasesByIngredient.get(alias.ingredient_id) ?? [];
    bucket.push(alias);
    aliasesByIngredient.set(alias.ingredient_id, bucket);
  });

  const formSignals: FormSignal[] = [];
  const usedFormIds = new Set<string>();
  const formMatches: ({ match: FormMatchResult; candidateText: string } | null)[] = [];
  let formMatchCount = 0;

  activeRows.forEach((row) => {
    if (!row.ingredient_id) {
      formMatches.push(null);
      return;
    }
    const forms = formsByIngredient.get(row.ingredient_id) ?? [];
    if (!forms.length) {
      formMatches.push(null);
      return;
    }
    const aliases = [...globalAliases, ...(aliasesByIngredient.get(row.ingredient_id) ?? [])];
    let candidateText = row.form_raw ?? row.name_raw;
    let match = selectBestFormMatch(candidateText, forms, aliases);
    if (!match && row.form_raw && row.name_raw && row.name_raw !== row.form_raw) {
      candidateText = row.name_raw;
      match = selectBestFormMatch(candidateText, forms, aliases);
    }
    if (!match) {
      formMatches.push(null);
      return;
    }
    formMatchCount += 1;
    usedFormIds.add(match.form.id);
    formSignals.push({
      ingredientId: row.ingredient_id,
      ingredientName: row.name_raw,
      candidateText,
      formId: match.form.id,
      formKey: match.form.form_key,
      formLabel: match.form.form_label,
      matchScore: roundScore(match.matchScore),
      effectiveFactor: roundScore(match.effectiveFactor),
      confidence: match.form.confidence ?? null,
      evidenceGrade: match.form.evidence_grade ?? null,
      auditStatus: match.form.audit_status ?? null,
      aliasText: match.aliasMatch?.alias_text ?? null,
      aliasSource: match.aliasMatch?.source ?? null,
      aliasConfidence: match.aliasMatch?.confidence ?? null,
    });
    formMatches.push({ match, candidateText });
  });

  const formCoverageRatio = activeCount ? formMatchCount / activeCount : 0;

  const baseConfidence = computeConfidence(
    coverage,
    avgParseConfidence,
    matchRatio,
    unitOkRatio,
    canonicalSourceId,
    formCoverageRatio,
  );
  let confidencePenalty = DEFAULT_DAILY_CONFIDENCE_PENALTY;
  if (dailyMultiplier.source === DAILY_MULTIPLIER_SOURCE_LNHPD) {
    confidencePenalty = 1;
  } else if (dailyMultiplier.source === DAILY_MULTIPLIER_SOURCE_LNHPD_WEEKLY) {
    confidencePenalty = WEEKLY_CONFIDENCE_PENALTY;
  } else if (dailyMultiplier.source === DAILY_MULTIPLIER_SOURCE_NON_DAILY) {
    confidencePenalty = NON_DAILY_CONFIDENCE_PENALTY;
  }
  const confidence = clamp(baseConfidence * confidencePenalty, 0.1, 0.95);

  const evidenceByIngredient = new Map<string, IngredientEvidenceRow[]>();
  evidenceRows.forEach((row) => {
    if (!row.ingredient_id) return;
    const existing = evidenceByIngredient.get(row.ingredient_id) ?? [];
    existing.push(row);
    evidenceByIngredient.set(row.ingredient_id, existing);
  });

  const evidenceAvailableIds = new Set<string>();
  const evidenceEligibleIds = new Set<string>();
  const usedEvidenceIds = new Set<string>();
  const ingredientGoalScores = new Map<string, { goal: string; score: number }>();
  const ingredientGoalScoresRaw = new Map<string, { goal: string; score: number }>();

  activeRows.forEach((row, index) => {
    if (!row.ingredient_id) return;
    const entries = evidenceByIngredient.get(row.ingredient_id);
    if (!entries?.length) return;
    evidenceAvailableIds.add(row.ingredient_id);
    const meta = ingredientMeta.get(row.ingredient_id);
    const metaUnit = meta?.unit ?? null;
    const amountValue = row.amount_unknown ? null : row.amount_normalized ?? row.amount;
    const unitValue = row.unit_normalized ?? row.unit;
    const unitMatches = Boolean(metaUnit && unitValue && unitValue === metaUnit);
    const rowMultiplier = row.basis === "label_serving" ? dailyMultiplier.multiplier : 1;
    const dailyAmountValue = amountValue == null ? null : amountValue * rowMultiplier;
    const doseEligible = dailyAmountValue != null && unitMatches;
    const goalSet = new Set((meta?.goals ?? []).map(normalizeGoalId).filter(Boolean));
    const formMatch = formMatches[index]?.match ?? null;
    const formFactor = formMatch?.effectiveFactor ?? 1;
    const adjustedAmount =
      dailyAmountValue == null ? null : dailyAmountValue * formFactor;

    entries.forEach((entry) => {
      const goalId = normalizeGoalId(entry.goal);
      if (!goalId) return;
      if (goalSet.size && !goalSet.has(goalId)) return;
      const evidenceWeight = resolveEvidenceWeight(entry.evidence_grade, entry.audit_status);
      if (evidenceWeight <= 0 || !doseEligible) return;
      const optimalRange = parseNumericRange(entry.optimal_dose_range);
      const rawAdequacy = computeDoseAdequacy({
        amount: dailyAmountValue,
        unitMatches,
        minDose: entry.min_effective_dose,
        optimalRange,
        evidenceWeight,
      });
      const adequacy = computeDoseAdequacy({
        amount: adjustedAmount,
        unitMatches,
        minDose: entry.min_effective_dose,
        optimalRange,
        evidenceWeight,
      });
      const key = `${row.ingredient_id}:${goalId}`;
      const existing = ingredientGoalScores.get(key);
      if (!existing || adequacy > existing.score) {
        ingredientGoalScores.set(key, { goal: goalId, score: adequacy });
      }
      const existingRaw = ingredientGoalScoresRaw.get(key);
      if (!existingRaw || rawAdequacy > existingRaw.score) {
        ingredientGoalScoresRaw.set(key, { goal: goalId, score: rawAdequacy });
      }
      if (entry.id) {
        usedEvidenceIds.add(entry.id);
      }
      if (row.ingredient_id) {
        evidenceEligibleIds.add(row.ingredient_id);
      }
    });
  });

  const goalScoresMap = new Map<string, number[]>();
  const goalScoresRawMap = new Map<string, number[]>();
  ingredientGoalScores.forEach((entry) => {
    const bucket = goalScoresMap.get(entry.goal) ?? [];
    bucket.push(entry.score);
    goalScoresMap.set(entry.goal, bucket);
  });
  ingredientGoalScoresRaw.forEach((entry) => {
    const bucket = goalScoresRawMap.get(entry.goal) ?? [];
    bucket.push(entry.score);
    goalScoresRawMap.set(entry.goal, bucket);
  });
  const goalDoseAdequacy: Record<string, number> = {};
  const goalDoseAdequacyRaw: Record<string, number> = {};
  const goalScoreList: number[] = [];
  const goalScoreListRaw: number[] = [];
  goalScoresMap.forEach((scores, goal) => {
    const avg = scores.reduce((sum, value) => sum + value, 0) / scores.length;
    goalDoseAdequacy[goal] = avg;
    goalScoreList.push(avg);
  });
  goalScoresRawMap.forEach((scores, goal) => {
    const avg = scores.reduce((sum, value) => sum + value, 0) / scores.length;
    goalDoseAdequacyRaw[goal] = avg;
    goalScoreListRaw.push(avg);
  });
  const topGoalScores = goalScoreList.sort((a, b) => b - a).slice(0, 3);
  const doseAdequacyAvg = topGoalScores.length
    ? topGoalScores.reduce((sum, value) => sum + value, 0) / topGoalScores.length
    : 0;
  const topGoalScoresRaw = goalScoreListRaw.sort((a, b) => b - a).slice(0, 3);
  const doseAdequacyRawAvg = topGoalScoresRaw.length
    ? topGoalScoresRaw.reduce((sum, value) => sum + value, 0) / topGoalScoresRaw.length
    : 0;
  const evidenceCoverage = activeCount ? evidenceEligibleIds.size / activeCount : 0;
  const evidenceAvailableRatio = activeCount ? evidenceAvailableIds.size / activeCount : 0;

  if (activeCount === 0) {
    return {
      effectiveness: 20,
      safetyBase: 60,
      integrityBase: 25,
      confidence: clamp(confidence * 0.6, 0.1, 0.6),
      coverage,
      activeCount,
      knownDoseCount,
      unknownRatio: 1,
      proprietaryBlendCount,
      avgParseConfidence,
      matchRatio,
      unitOkRatio,
      formCoverageRatio,
      unknownUnitCount,
      unknownUnitRatio,
      evidenceCoverage,
      evidenceAvailableRatio,
      doseAdequacyAvg,
      doseAdequacyRawAvg,
      goalDoseAdequacy,
      goalDoseAdequacyRaw,
      formSignals,
      usedEvidenceIds: Array.from(usedEvidenceIds),
      usedFormIds: Array.from(usedFormIds),
      dailyMultiplier,
    };
  }

  const focusBonus = activeCount <= 3 && coverage > 0.6 ? 8 : 0;
  const kitchenSinkPenalty = activeCount >= 10 && coverage < 0.4 ? 15 : 0;
  const proprietaryPenalty = proprietaryBlendCount > 0 ? 12 : 0;

  const baseEffectiveness =
    40 + 30 * coverage + focusBonus - kitchenSinkPenalty - proprietaryPenalty;
  const evidenceBoost =
    evidenceCoverage > 0 ? 30 * doseAdequacyAvg + 10 * evidenceCoverage : 0;
  const effectiveness = clamp(baseEffectiveness + evidenceBoost, 0, 100);

  const unknownRatio = 1 - coverage;
  const safetyBase = 80 - unknownRatio * 25 - proprietaryBlendCount * 8;
  const integrityBase = clamp(
    25 +
      35 * coverage +
      22 * matchRatio +
      18 * unitOkRatio +
      10 * formCoverageRatio -
      proprietaryBlendCount * 12 -
      unknownUnitRatio * 25,
    0,
    100,
  );

  return {
    effectiveness: clamp(effectiveness, 0, 100),
    safetyBase,
    integrityBase,
    confidence,
    coverage,
    activeCount,
    knownDoseCount,
    unknownRatio,
    proprietaryBlendCount,
    avgParseConfidence,
    matchRatio,
    unitOkRatio,
    formCoverageRatio,
    unknownUnitCount,
    unknownUnitRatio,
    evidenceCoverage,
    evidenceAvailableRatio,
    doseAdequacyAvg,
    doseAdequacyRawAvg,
    goalDoseAdequacy,
    goalDoseAdequacyRaw,
    formSignals,
    usedEvidenceIds: Array.from(usedEvidenceIds),
    usedFormIds: Array.from(usedFormIds),
    dailyMultiplier,
  };
};

const buildFlags = (params: {
  coverage: number;
  activeCount: number;
  proprietaryBlendCount: number;
  ulWarnings: UlWarnings;
  avgParseConfidence: number;
}): ScoreFlag[] => {
  const flags: ScoreFlag[] = [];
  if (params.proprietaryBlendCount > 0) {
    flags.push({
      code: "PROPRIETARY_BLEND",
      message: "Includes proprietary blend(s) with undisclosed doses.",
      severity: "warning",
    });
  }
  if (params.coverage < 0.4 && params.activeCount > 0) {
    flags.push({
      code: "MISSING_DOSE_INFO",
      message: "Most active ingredients do not list a clear dose.",
      severity: "warning",
    });
  } else if (params.coverage < 0.6 && params.activeCount > 0) {
    flags.push({
      code: "LOW_LABEL_TRANSPARENCY",
      message: "Dose coverage is limited; label transparency is reduced.",
      severity: "warning",
    });
  }
  if (params.activeCount >= 10 && params.coverage < 0.4) {
    flags.push({
      code: "KITCHEN_SINK",
      message: "Many ingredients with limited dosing detail.",
      severity: "warning",
    });
  }
  if (params.avgParseConfidence < 0.5) {
    flags.push({
      code: "LOW_PARSE_CONFIDENCE",
      message: "Parsing confidence is low; verify label details.",
      severity: "info",
    });
  }
  if (params.ulWarnings.high.length > 0) {
    flags.push({
      code: "UL_EXCEEDED",
      message: `Dose exceeds upper limit for ${params.ulWarnings.high.join(", ")}.`,
      severity: "risk",
    });
  } else if (params.ulWarnings.moderate.length > 0) {
    flags.push({
      code: "UL_NEAR_LIMIT",
      message: `Dose near upper limit for ${params.ulWarnings.moderate.join(", ")}.`,
      severity: "warning",
    });
  }
  return flags;
};

const buildHighlights = (params: {
  coverage: number;
  activeCount: number;
  proprietaryBlendCount: number;
  avgParseConfidence: number;
}): ScoreHighlight[] => {
  const highlights: ScoreHighlight[] = [];
  if (params.coverage >= 0.8 && params.proprietaryBlendCount === 0) {
    highlights.push({
      code: "FULL_DISCLOSURE",
      message: "Clear label disclosure with most doses listed.",
    });
  }
  if (params.activeCount > 0 && params.activeCount <= 3 && params.coverage >= 0.6) {
    highlights.push({
      code: "FOCUSED_FORMULA",
      message: "Focused formula with a small set of actives.",
    });
  }
  if (params.avgParseConfidence >= 0.8) {
    highlights.push({
      code: "HIGH_PARSE_CONFIDENCE",
      message: "High parsing confidence from label data.",
    });
  }
  return highlights;
};

const fetchIngredientMeta = async (rows: ProductIngredientRow[]): Promise<Map<string, IngredientMeta>> => {
  const ingredientIds = Array.from(
    new Set(rows.map((row) => row.ingredient_id).filter((id): id is string => Boolean(id))),
  );
  const metaMap = new Map<string, IngredientMeta>();
  if (!ingredientIds.length) return metaMap;

  const { data, error } = await supabase
    .from("ingredients")
    .select("id,unit,rda_adult,ul_adult,goals")
    .in("id", ingredientIds);
  if (error || !data) return metaMap;

  data.forEach((row) => {
    if (!row?.id) return;
    metaMap.set(row.id, {
      id: row.id as string,
      unit: row.unit ?? null,
      rda_adult: row.rda_adult ?? null,
      ul_adult: row.ul_adult ?? null,
      goals: Array.isArray(row.goals) ? (row.goals as string[]) : null,
    });
  });
  return metaMap;
};

const fetchIngredientEvidence = async (
  ingredientIds: string[],
): Promise<IngredientEvidenceRow[]> => {
  if (!ingredientIds.length) return [];
  const { data, error } = await supabase
    .from("ingredient_evidence")
    .select("id,ingredient_id,goal,min_effective_dose,optimal_dose_range,evidence_grade,audit_status")
    .in("ingredient_id", ingredientIds);
  if (error || !data) return [];
  return data as IngredientEvidenceRow[];
};

const fetchIngredientForms = async (
  ingredientIds: string[],
): Promise<IngredientFormRow[]> => {
  if (!ingredientIds.length) return [];
  const { data, error } = await supabase
    .from("ingredient_forms")
    .select("id,ingredient_id,form_key,form_label,relative_factor,confidence,evidence_grade,audit_status")
    .in("ingredient_id", ingredientIds);
  if (error || !data) return [];
  return data as IngredientFormRow[];
};

const fetchEvidenceCitations = async (
  evidenceIds: string[],
): Promise<Map<string, string[]>> => {
  const map = new Map<string, Set<string>>();
  if (!evidenceIds.length) return new Map();
  const { data, error } = await supabase
    .from("ingredient_evidence_citations")
    .select("evidence_id,citation_id")
    .in("evidence_id", evidenceIds);
  if (error || !data) return new Map();
  data.forEach((row) => {
    const evidenceId = row?.evidence_id as string | undefined;
    const citationId = row?.citation_id as string | undefined;
    if (!evidenceId || !citationId) return;
    const bucket = map.get(evidenceId) ?? new Set<string>();
    bucket.add(citationId);
    map.set(evidenceId, bucket);
  });
  const result = new Map<string, string[]>();
  map.forEach((value, key) => result.set(key, Array.from(value)));
  return result;
};

const fetchFormCitations = async (
  formIds: string[],
): Promise<Map<string, string[]>> => {
  const map = new Map<string, Set<string>>();
  if (!formIds.length) return new Map();
  const { data, error } = await supabase
    .from("ingredient_form_citations")
    .select("form_id,citation_id")
    .in("form_id", formIds);
  if (error || !data) return new Map();
  data.forEach((row) => {
    const formId = row?.form_id as string | undefined;
    const citationId = row?.citation_id as string | undefined;
    if (!formId || !citationId) return;
    const bucket = map.get(formId) ?? new Set<string>();
    bucket.add(citationId);
    map.set(formId, bucket);
  });
  const result = new Map<string, string[]>();
  map.forEach((value, key) => result.set(key, Array.from(value)));
  return result;
};

const fetchIngredientFormAliases = async (
  ingredientIds: string[],
): Promise<IngredientFormAliasRow[]> => {
  const aliasRows: IngredientFormAliasRow[] = [];
  const { data: globalAliases } = await supabase
    .from("ingredient_form_aliases")
    .select("id,alias_text,alias_norm,form_key,ingredient_id,confidence,audit_status,source")
    .is("ingredient_id", null);
  if (Array.isArray(globalAliases)) {
    aliasRows.push(...(globalAliases as IngredientFormAliasRow[]));
  }
  if (ingredientIds.length) {
    const { data: scopedAliases } = await supabase
      .from("ingredient_form_aliases")
      .select("id,alias_text,alias_norm,form_key,ingredient_id,confidence,audit_status,source")
      .in("ingredient_id", ingredientIds);
    if (Array.isArray(scopedAliases)) {
      aliasRows.push(...(scopedAliases as IngredientFormAliasRow[]));
    }
  }
  return aliasRows;
};

const mergeFormAliases = (
  dbAliases: IngredientFormAliasRow[],
): IngredientFormAliasRow[] => {
  const map = new Map<string, IngredientFormAliasRow>();
  BUILTIN_FORM_ALIASES.forEach((alias) => {
    const key = `${alias.alias_norm}:${alias.ingredient_id ?? "global"}:${alias.form_key}`;
    map.set(key, alias);
  });
  dbAliases.forEach((alias) => {
    const norm = alias.alias_norm || normalizeFormText(alias.alias_text);
    const key = `${norm}:${alias.ingredient_id ?? "global"}:${alias.form_key}`;
    map.set(key, { ...alias, alias_norm: norm });
  });
  return Array.from(map.values());
};

const fetchLnhpdFactsJson = async (lnhpdId: string): Promise<Record<string, unknown> | null> => {
  if (!lnhpdId) return null;
  const runQuery = async (table: string) => {
    let query = supabase
      .from(table)
      .select("facts_json")
      .eq("lnhpd_id", lnhpdId)
      .limit(1);
    if (table === "lnhpd_facts") {
      query = query.eq("is_on_market", true);
    }
    const { data, error } = await query;
    if (error || !data || data.length === 0) return null;
    const facts = data[0]?.facts_json;
    if (!facts || typeof facts !== "object") return null;
    return facts as Record<string, unknown>;
  };

  const facts = (await runQuery("lnhpd_facts_complete")) ?? (await runQuery("lnhpd_facts"));
  return facts ?? null;
};

const fetchDatasetVersion = async (): Promise<string | null> => {
  const { data } = await supabase
    .from("scoring_dataset_state")
    .select("version")
    .eq("key", "ingredient_dataset")
    .maybeSingle();
  const value = data?.version;
  return typeof value === "string" && value.trim().length > 0 ? value : null;
};

const fetchLnhpdDailyMultiplier = async (lnhpdId: string | null): Promise<DailyMultiplierResult> => {
  if (!lnhpdId) {
    return {
      multiplier: DEFAULT_DAILY_MULTIPLIER,
      source: DAILY_MULTIPLIER_SOURCE_DEFAULT_MISSING,
      reliability: "default",
      lnhpdIdUsedForDoseLookup: null,
      doseRowsFound: 0,
      selectedDosePop: null,
      frequencyUnit: null,
      penaltyReason: "missing_canonical_id",
    };
  }
  const factsJson = await fetchLnhpdFactsJson(lnhpdId);
  if (!factsJson) {
    return {
      multiplier: DEFAULT_DAILY_MULTIPLIER,
      source: DAILY_MULTIPLIER_SOURCE_DEFAULT,
      reliability: "default",
      lnhpdIdUsedForDoseLookup: lnhpdId,
      doseRowsFound: 0,
      selectedDosePop: null,
      frequencyUnit: null,
      penaltyReason: "missing_facts",
    };
  }
  const computed = computeDailyMultiplierFromLnhpdFacts(factsJson);
  return {
    ...computed,
    lnhpdIdUsedForDoseLookup: lnhpdId,
  };
};

const fetchDailyMultiplier = async (params: {
  source: ScoreSource;
  sourceId: string;
  canonicalSourceId: string | null;
}): Promise<DailyMultiplierResult> => {
  if (params.source !== "lnhpd") {
    return {
      multiplier: DEFAULT_DAILY_MULTIPLIER,
      source: DAILY_MULTIPLIER_SOURCE_DEFAULT,
      reliability: "default",
      lnhpdIdUsedForDoseLookup: null,
      doseRowsFound: null,
      selectedDosePop: null,
      frequencyUnit: null,
      penaltyReason: null,
    };
  }
  return fetchLnhpdDailyMultiplier(params.canonicalSourceId);
};

const fetchProductIngredients = async (
  source: ScoreSource,
  sourceId: string,
): Promise<{ rows: ProductIngredientRow[]; sourceIdForWrite: string; canonicalSourceId: string | null } | null> => {
  const selectColumns =
    "source_id,canonical_source_id,ingredient_id,name_raw,name_key,amount,unit,amount_normalized,unit_normalized,unit_kind,amount_unknown,is_active,is_proprietary_blend,parse_confidence,basis,form_raw";

  const { data: directRows } = await supabase
    .from("product_ingredients")
    .select(selectColumns)
    .eq("source", source)
    .eq("source_id", sourceId);

  if (directRows && directRows.length > 0) {
    const sourceIdForWrite = directRows[0]?.source_id ?? sourceId;
    const canonicalSourceId = directRows[0]?.canonical_source_id ?? null;
    return { rows: directRows as ProductIngredientRow[], sourceIdForWrite, canonicalSourceId };
  }

  const { data: canonicalRows } = await supabase
    .from("product_ingredients")
    .select(selectColumns)
    .eq("source", source)
    .eq("canonical_source_id", sourceId);

  if (canonicalRows && canonicalRows.length > 0) {
    const sourceIdForWrite = canonicalRows[0]?.source_id ?? sourceId;
    const canonicalSourceId = canonicalRows[0]?.canonical_source_id ?? null;
    return { rows: canonicalRows as ProductIngredientRow[], sourceIdForWrite, canonicalSourceId };
  }

  return null;
};

const buildCitationMapFromCache = (
  ids: string[],
  cacheMap: Map<string, string[]>,
): Map<string, string[]> => {
  const map = new Map<string, string[]>();
  ids.forEach((id) => {
    map.set(id, cacheMap.get(id) ?? []);
  });
  return map;
};

const buildScoreBundleV4FromData = async (params: {
  rows: ProductIngredientRow[];
  source: ScoreSource;
  sourceId: string;
  sourceIdForWrite: string;
  canonicalSourceId: string | null;
  dailyMultiplier: DailyMultiplierResult;
  datasetVersion: string | null;
  ingredientMeta: Map<string, IngredientMeta>;
  evidenceRows: IngredientEvidenceRow[];
  formRows: IngredientFormRow[];
  formAliasRows: IngredientFormAliasRow[];
  evidenceCitationsById?: Map<string, string[]>;
  formCitationsById?: Map<string, string[]>;
}): Promise<ScoreComputationResult> => {
  const inputsHash = buildInputsHash(params.rows, {
    dailyMultiplier: params.dailyMultiplier.multiplier,
    dailyMultiplierSource: params.dailyMultiplier.source,
    datasetVersion: params.datasetVersion,
  });
  const mergedFormAliases = mergeFormAliases(params.formAliasRows);
  const verifiedEvidenceRows = params.evidenceRows.filter((row) => isVerifiedAudit(row.audit_status));
  const pendingEvidenceRows = params.evidenceRows.filter((row) => !isVerifiedAudit(row.audit_status));
  const verifiedFormRows = params.formRows.filter((row) => isVerifiedAudit(row.audit_status));
  const pendingFormRows = params.formRows.filter((row) => !isVerifiedAudit(row.audit_status));
  const verifiedEvidenceById = new Map(
    verifiedEvidenceRows.map((row) => [row.id, row]),
  );
  const activeIngredientIds = new Set(
    params.rows
      .filter((row) => row.is_active && row.ingredient_id)
      .map((row) => row.ingredient_id as string),
  );
  const verifiedEvidenceCount = verifiedEvidenceRows.filter((row) =>
    activeIngredientIds.has(row.ingredient_id),
  ).length;
  const pendingEvidenceCount = pendingEvidenceRows.filter((row) =>
    activeIngredientIds.has(row.ingredient_id),
  ).length;
  const verifiedFormCount = verifiedFormRows.filter((row) =>
    activeIngredientIds.has(row.ingredient_id),
  ).length;
  const pendingFormCount = pendingFormRows.filter((row) =>
    activeIngredientIds.has(row.ingredient_id),
  ).length;
  const totalEvidenceAvailableIds = new Set(
    params.evidenceRows
      .filter((row) => activeIngredientIds.has(row.ingredient_id))
      .map((row) => row.ingredient_id),
  );
  const totalEvidenceAvailableRatio = activeIngredientIds.size
    ? totalEvidenceAvailableIds.size / activeIngredientIds.size
    : 0;
  const ulWarnings = computeUlWarnings(params.rows, params.ingredientMeta, params.dailyMultiplier);
  const metrics = computeScores(
    params.rows,
    params.canonicalSourceId,
    params.ingredientMeta,
    verifiedEvidenceRows,
    verifiedFormRows,
    mergedFormAliases,
    params.dailyMultiplier,
  );
  const formSignalsSorted = [...metrics.formSignals].sort(
    (a, b) => b.matchScore - a.matchScore,
  );
  const formSignals = formSignalsSorted.slice(0, MAX_FORM_SIGNALS);
  const formSignalsTruncatedCount = Math.max(0, formSignalsSorted.length - formSignals.length);

  const ingredientNameById = new Map<string, string>();
  params.rows.forEach((row) => {
    if (!row.is_active || !row.ingredient_id) return;
    if (!ingredientNameById.has(row.ingredient_id)) {
      ingredientNameById.set(row.ingredient_id, row.name_raw);
    }
  });

  const pendingEvidenceIds = Array.from(
    new Set(
      pendingEvidenceRows
        .filter((row) => activeIngredientIds.has(row.ingredient_id))
        .map((row) => row.id),
    ),
  );
  const pendingFormIds = Array.from(
    new Set(
      pendingFormRows
        .filter((row) => activeIngredientIds.has(row.ingredient_id))
        .map((row) => row.id),
    ),
  );

  let evidenceCitations: Map<string, string[]>;
  let formCitations: Map<string, string[]>;
  let pendingEvidenceCitations: Map<string, string[]>;
  let pendingFormCitations: Map<string, string[]>;

  if (params.evidenceCitationsById && params.formCitationsById) {
    evidenceCitations = buildCitationMapFromCache(
      metrics.usedEvidenceIds,
      params.evidenceCitationsById,
    );
    formCitations = buildCitationMapFromCache(
      metrics.usedFormIds,
      params.formCitationsById,
    );
    pendingEvidenceCitations = buildCitationMapFromCache(
      pendingEvidenceIds,
      params.evidenceCitationsById,
    );
    pendingFormCitations = buildCitationMapFromCache(
      pendingFormIds,
      params.formCitationsById,
    );
  } else {
    [evidenceCitations, formCitations, pendingEvidenceCitations, pendingFormCitations] =
      await Promise.all([
        fetchEvidenceCitations(metrics.usedEvidenceIds),
        fetchFormCitations(metrics.usedFormIds),
        fetchEvidenceCitations(pendingEvidenceIds),
        fetchFormCitations(pendingFormIds),
      ]);
  }

  const evidenceReferenceIds = new Set<string>();
  evidenceCitations.forEach((refs) => refs.forEach((ref) => evidenceReferenceIds.add(ref)));
  const formReferenceIds = new Set<string>();
  formCitations.forEach((refs) => refs.forEach((ref) => formReferenceIds.add(ref)));
  const evidenceCitationMap = Object.fromEntries(Array.from(evidenceCitations.entries()));
  const formCitationMap = Object.fromEntries(Array.from(formCitations.entries()));
  const verifiedEvidence: Record<string, unknown>[] = [];
  const skippedEvidence: Record<string, unknown>[] = [];
  const verifiedForms: Record<string, unknown>[] = [];
  const skippedForms: Record<string, unknown>[] = [];
  let truncatedVerifiedEvidence = 0;
  let truncatedSkippedEvidence = 0;
  let truncatedVerifiedForms = 0;
  let truncatedSkippedForms = 0;

  metrics.usedEvidenceIds.forEach((evidenceId) => {
    const row = verifiedEvidenceById.get(evidenceId);
    if (!row) return;
    const ingredientName = ingredientNameById.get(row.ingredient_id) ?? row.ingredient_id;
    const refs = evidenceCitations.get(evidenceId) ?? [];
    const item = {
      ingredientId: row.ingredient_id,
      ingredientName,
      goal: row.goal,
      evidenceGrade: row.evidence_grade,
      auditStatus: row.audit_status,
      minEffectiveDose: row.min_effective_dose,
      optimalDoseRange: row.optimal_dose_range,
      refIds: refs,
    };
    if (verifiedEvidence.length < MAX_AUDIT_ITEMS) {
      verifiedEvidence.push(item);
    } else {
      truncatedVerifiedEvidence += 1;
    }
  });

  pendingEvidenceRows.forEach((row) => {
    if (!activeIngredientIds.has(row.ingredient_id)) return;
    const ingredientName = ingredientNameById.get(row.ingredient_id) ?? row.ingredient_id;
    const refs = pendingEvidenceCitations.get(row.id) ?? [];
    const item = {
      ingredientId: row.ingredient_id,
      ingredientName,
      goal: row.goal,
      evidenceGrade: row.evidence_grade,
      auditStatus: row.audit_status,
      reason: "audit_status_not_verified",
      refIds: refs,
    };
    if (skippedEvidence.length < MAX_AUDIT_ITEMS) {
      skippedEvidence.push(item);
    } else {
      truncatedSkippedEvidence += 1;
    }
  });

  metrics.formSignals.forEach((signal) => {
    const refs = formCitations.get(signal.formId) ?? [];
    const item = {
      ingredientId: signal.ingredientId,
      ingredientName: signal.ingredientName,
      formKey: signal.formKey,
      formLabel: signal.formLabel,
      effectiveFactor: signal.effectiveFactor,
      evidenceGrade: signal.evidenceGrade,
      auditStatus: signal.auditStatus,
      refIds: refs,
    };
    if (verifiedForms.length < MAX_AUDIT_ITEMS) {
      verifiedForms.push(item);
    } else {
      truncatedVerifiedForms += 1;
    }
  });

  pendingFormRows.forEach((row) => {
    if (!activeIngredientIds.has(row.ingredient_id)) return;
    const ingredientName = ingredientNameById.get(row.ingredient_id) ?? row.ingredient_id;
    const refs = pendingFormCitations.get(row.id) ?? [];
    const item = {
      ingredientId: row.ingredient_id,
      ingredientName,
      formKey: row.form_key,
      formLabel: row.form_label,
      evidenceGrade: row.evidence_grade,
      auditStatus: row.audit_status,
      reason: "audit_status_not_verified",
      refIds: refs,
    };
    if (skippedForms.length < MAX_AUDIT_ITEMS) {
      skippedForms.push(item);
    } else {
      truncatedSkippedForms += 1;
    }
  });

  const safetyPenalty =
    ulWarnings.high.length * 15 + ulWarnings.moderate.length * 8;
  const safety = clamp(metrics.safetyBase - safetyPenalty, 0, 100);
  const integrity = clamp(metrics.integrityBase, 0, 100);

  const rawOverall = 0.4 * metrics.effectiveness + 0.3 * safety + 0.3 * integrity;
  const displayOverall =
    metrics.confidence * rawOverall + (1 - metrics.confidence) * 50;
  const basis = params.rows[0]?.basis ?? "label_serving";
  const roundedGoalDoseAdequacy = Object.fromEntries(
    Object.entries(metrics.goalDoseAdequacy).map(([goal, value]) => [goal, roundScore(value)]),
  );

  const bundle: ScoreBundleV4 = {
    overallScore: roundScore(displayOverall),
    pillars: {
      effectiveness: roundScore(metrics.effectiveness),
      safety: roundScore(safety),
      integrity: roundScore(integrity),
    },
    confidence: roundScore(metrics.confidence),
    bestFitGoals: resolveBestFitGoals(params.rows, metrics.goalDoseAdequacy),
    flags: buildFlags({
      coverage: metrics.coverage,
      activeCount: metrics.activeCount,
      proprietaryBlendCount: metrics.proprietaryBlendCount,
      ulWarnings,
      avgParseConfidence: metrics.avgParseConfidence,
    }),
    highlights: buildHighlights({
      coverage: metrics.coverage,
      activeCount: metrics.activeCount,
      proprietaryBlendCount: metrics.proprietaryBlendCount,
      avgParseConfidence: metrics.avgParseConfidence,
    }),
    provenance: {
      source: params.source,
      sourceId: params.sourceId,
      canonicalSourceId: params.canonicalSourceId,
      scoreVersion: V4_SCORE_VERSION,
      computedAt: new Date().toISOString(),
      inputsHash,
      datasetVersion: params.datasetVersion,
      extractedAt: null,
    },
    explain: {
      coverage: {
        activeCount: metrics.activeCount,
        knownDoseCount: metrics.knownDoseCount,
        coverageRatio: roundScore(metrics.coverage),
        proprietaryBlendCount: metrics.proprietaryBlendCount,
      },
      parseConfidence: roundScore(metrics.avgParseConfidence),
      matchRatio: roundScore(metrics.matchRatio),
      unitOkRatio: roundScore(metrics.unitOkRatio),
      unknownUnitCount: metrics.unknownUnitCount,
      evidence: {
        coverageRatio: roundScore(metrics.evidenceCoverage),
        availableRatio: roundScore(metrics.evidenceAvailableRatio),
        verifiedAvailableRatio: roundScore(metrics.evidenceAvailableRatio),
        totalAvailableRatio: roundScore(totalEvidenceAvailableRatio),
        doseAdequacy: roundScore(metrics.doseAdequacyRawAvg),
        formAdjustedDoseAdequacy: roundScore(metrics.doseAdequacyAvg),
        formCoverageRatio: roundScore(metrics.formCoverageRatio),
        formSignals,
        formSignalsTruncatedCount,
        goals: roundedGoalDoseAdequacy,
        audit: {
          verifiedEvidenceCount,
          pendingEvidenceCount,
          verifiedFormCount,
          pendingFormCount,
          verifiedEvidence,
          skippedEvidence,
          verifiedForms,
          skippedForms,
          truncated: {
            verifiedEvidence: truncatedVerifiedEvidence,
            skippedEvidence: truncatedSkippedEvidence,
            verifiedForms: truncatedVerifiedForms,
            skippedForms: truncatedSkippedForms,
          },
        },
        citations: {
          evidence: evidenceCitationMap,
          forms: formCitationMap,
          evidenceReferenceIds: Array.from(evidenceReferenceIds),
          formReferenceIds: Array.from(formReferenceIds),
        },
      },
      ulWarnings,
      assumptions: {
        basis,
        doseBasis: "per_day_adult",
        dailyMultiplier: params.dailyMultiplier.multiplier,
        dailyMultiplierSource: params.dailyMultiplier.source,
        dailyMultiplierReliability: params.dailyMultiplier.reliability,
        ...(params.source === "lnhpd"
          ? {
              lnhpdIdUsedForDoseLookup: params.dailyMultiplier.lnhpdIdUsedForDoseLookup ?? null,
              doseRowsFound: params.dailyMultiplier.doseRowsFound ?? null,
              selectedDosePop: params.dailyMultiplier.selectedDosePop ?? null,
              doseFrequencyUnit: params.dailyMultiplier.frequencyUnit ?? null,
              dailyMultiplierPenaltyReason: params.dailyMultiplier.penaltyReason ?? null,
            }
          : {}),
        datasetVersion: params.datasetVersion,
        notes: "Scores use label-derived doses when available; unknown doses reduce confidence.",
      },
    },
  };

  return {
    bundle,
    inputsHash,
    sourceIdForWrite: params.sourceIdForWrite,
    canonicalSourceId: params.canonicalSourceId,
  };
};

export async function computeScoreBundleV4(params: {
  source: ScoreSource;
  sourceId: string;
}): Promise<ScoreComputationResult | null> {
  const ingredientLookup = await fetchProductIngredients(params.source, params.sourceId);
  if (!ingredientLookup) return null;

  const { rows, sourceIdForWrite, canonicalSourceId } = ingredientLookup;
  const [dailyMultiplier, datasetVersion] = await Promise.all([
    fetchDailyMultiplier({
      source: params.source,
      sourceId: params.sourceId,
      canonicalSourceId,
    }),
    fetchDatasetVersion(),
  ]);
  const ingredientMeta = await fetchIngredientMeta(rows);
  const ingredientIds = Array.from(
    new Set(rows.map((row) => row.ingredient_id).filter((id): id is string => Boolean(id))),
  );
  const [evidenceRows, formRows, formAliasRows] = await Promise.all([
    fetchIngredientEvidence(ingredientIds),
    fetchIngredientForms(ingredientIds),
    fetchIngredientFormAliases(ingredientIds),
  ]);

  return buildScoreBundleV4FromData({
    rows,
    source: params.source,
    sourceId: params.sourceId,
    sourceIdForWrite,
    canonicalSourceId,
    dailyMultiplier,
    datasetVersion,
    ingredientMeta,
    evidenceRows,
    formRows,
    formAliasRows,
  });
}

export const computeScoreBundleV4Cached = async (params: {
  rows: ProductIngredientRow[];
  source: ScoreSource;
  sourceId: string;
  sourceIdForWrite?: string;
  canonicalSourceId: string | null;
  dailyMultiplier: DailyMultiplierResult;
  cache: DatasetCache;
}): Promise<ScoreComputationResult> => {
  const ingredientIds = Array.from(
    new Set(params.rows.map((row) => row.ingredient_id).filter((id): id is string => Boolean(id))),
  );
  const ingredientMeta = new Map<string, IngredientMeta>();
  ingredientIds.forEach((id) => {
    const meta = params.cache.ingredientMetaById.get(id);
    if (meta) ingredientMeta.set(id, meta);
  });

  const evidenceRows: IngredientEvidenceRow[] = [];
  const formRows: IngredientFormRow[] = [];
  const formAliasRows: IngredientFormAliasRow[] = [...params.cache.globalFormAliases];

  ingredientIds.forEach((id) => {
    const evidence = params.cache.evidenceByIngredientId.get(id);
    if (evidence?.length) evidenceRows.push(...evidence);
    const forms = params.cache.formByIngredientId.get(id);
    if (forms?.length) formRows.push(...forms);
    const aliases = params.cache.aliasesByIngredientId.get(id);
    if (aliases?.length) formAliasRows.push(...aliases);
  });

  return buildScoreBundleV4FromData({
    rows: params.rows,
    source: params.source,
    sourceId: params.sourceId,
    sourceIdForWrite: params.sourceIdForWrite ?? params.sourceId,
    canonicalSourceId: params.canonicalSourceId,
    dailyMultiplier: params.dailyMultiplier,
    datasetVersion: params.cache.datasetVersion,
    ingredientMeta,
    evidenceRows,
    formRows,
    formAliasRows,
    evidenceCitationsById: params.cache.evidenceCitationsById,
    formCitationsById: params.cache.formCitationsById,
  });
};

export const computeV4InputsHashFromRows = (
  rows: ProductIngredientRow[],
  context?: { dailyMultiplier?: number; dailyMultiplierSource?: string; datasetVersion?: string | null },
): string => buildInputsHash(rows, context);

export async function computeV4InputsHash(params: {
  source: ScoreSource;
  sourceId: string;
}): Promise<string | null> {
  const ingredientLookup = await fetchProductIngredients(params.source, params.sourceId);
  if (!ingredientLookup) return null;
  const canonicalSourceId = ingredientLookup.canonicalSourceId;
  const [dailyMultiplier, datasetVersion] = await Promise.all([
    fetchDailyMultiplier({
      source: params.source,
      sourceId: params.sourceId,
      canonicalSourceId,
    }),
    fetchDatasetVersion(),
  ]);
  return buildInputsHash(ingredientLookup.rows, {
    dailyMultiplier: dailyMultiplier.multiplier,
    dailyMultiplierSource: dailyMultiplier.source,
    datasetVersion,
  });
}

export const __test__ = {
  computeUlWarnings,
};
