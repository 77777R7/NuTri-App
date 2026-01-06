import { createHash } from "node:crypto";

import { supabase } from "../supabase.js";
import type { ScoreBundleV4, ScoreFlag, ScoreGoalFit, ScoreHighlight, ScoreSource } from "../types.js";

export const V4_SCORE_VERSION = "v4.0.0-alpha";

type ProductIngredientRow = {
  source_id: string;
  canonical_source_id: string | null;
  ingredient_id: string | null;
  name_raw: string;
  amount: number | null;
  unit: string | null;
  amount_normalized: number | null;
  unit_normalized: string | null;
  amount_unknown: boolean;
  is_active: boolean;
  is_proprietary_blend: boolean;
  parse_confidence: number | null;
  basis: string;
  form_raw: string | null;
};

type IngredientMeta = {
  id: string;
  unit: string | null;
  rda_adult: number | null;
  ul_adult: number | null;
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

const normalizeNameKey = (value: string): string =>
  value.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();

const clamp = (value: number, min: number, max: number): number =>
  Math.max(min, Math.min(max, value));

const roundScore = (value: number): number => Math.round(value * 100) / 100;

const buildInputsHash = (rows: ProductIngredientRow[]): string => {
  const payload = rows
    .map((row) => ({
      name: row.name_raw,
      amount: row.amount,
      unit: row.unit,
      amountUnknown: row.amount_unknown,
      active: row.is_active,
      proprietaryBlend: row.is_proprietary_blend,
      basis: row.basis,
      form: row.form_raw,
    }))
    .sort((a, b) => a.name.localeCompare(b.name));
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

const computeUlWarnings = (
  rows: ProductIngredientRow[],
  ingredientMeta: Map<string, IngredientMeta>,
): { high: string[]; moderate: string[] } => {
  const high: string[] = [];
  const moderate: string[] = [];

  rows.forEach((row) => {
    if (!row.ingredient_id || !row.is_active) return;
    const meta = ingredientMeta.get(row.ingredient_id);
    if (!meta?.ul_adult || meta.ul_adult <= 0) return;
    const unit = row.unit_normalized ?? row.unit;
    const amount = row.amount_normalized ?? row.amount;
    if (!unit || amount == null || !meta.unit || unit !== meta.unit) return;
    const ratio = amount / meta.ul_adult;
    if (!Number.isFinite(ratio)) return;
    if (ratio >= 1.2) {
      high.push(row.name_raw);
    } else if (ratio >= 1.0) {
      moderate.push(row.name_raw);
    }
  });

  return { high, moderate };
};

const computeConfidence = (
  coverage: number,
  avgParseConfidence: number,
  canonicalSourceId: string | null,
): number => {
  const identityConfidence = canonicalSourceId ? 0.9 : 0.7;
  const combined = 1 - (1 - coverage) * (1 - avgParseConfidence) * (1 - identityConfidence);
  return clamp(combined, 0.1, 0.95);
};

const computeScores = (rows: ProductIngredientRow[], canonicalSourceId: string | null) => {
  const activeRows = rows.filter((row) => row.is_active);
  const activeCount = activeRows.length;
  const knownDoseCount = activeRows.filter(
    (row) => !row.amount_unknown && row.amount != null,
  ).length;
  const proprietaryBlendCount = activeRows.filter((row) => row.is_proprietary_blend).length;
  const coverage = activeCount ? knownDoseCount / activeCount : 0;

  const parseValues = rows
    .map((row) => row.parse_confidence)
    .filter((value): value is number => typeof value === "number");
  const avgParseConfidence = parseValues.length
    ? parseValues.reduce((sum, value) => sum + value, 0) / parseValues.length
    : 0.5;

  const confidence = computeConfidence(coverage, avgParseConfidence, canonicalSourceId);

  if (activeCount === 0) {
    return {
      effectiveness: 20,
      safetyBase: 60,
      integrityBase: 35,
      confidence: clamp(confidence * 0.6, 0.1, 0.6),
      coverage,
      activeCount,
      knownDoseCount,
      unknownRatio: 1,
      proprietaryBlendCount,
      avgParseConfidence,
    };
  }

  const focusBonus = activeCount <= 3 && coverage > 0.6 ? 8 : 0;
  const kitchenSinkPenalty = activeCount >= 10 && coverage < 0.4 ? 15 : 0;
  const proprietaryPenalty = proprietaryBlendCount > 0 ? 12 : 0;

  const effectiveness = clamp(
    45 + 35 * coverage + focusBonus - kitchenSinkPenalty - proprietaryPenalty,
    0,
    100,
  );

  const unknownRatio = 1 - coverage;
  const safetyBase = 80 - unknownRatio * 25 - proprietaryBlendCount * 8;
  const integrityBase =
    60 + 25 * coverage + 10 * avgParseConfidence + (proprietaryBlendCount > 0 ? -12 : 8);

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
  };
};

const buildFlags = (params: {
  coverage: number;
  activeCount: number;
  proprietaryBlendCount: number;
  ulWarnings: { high: string[]; moderate: string[] };
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
    .select("id,unit,rda_adult,ul_adult")
    .in("id", ingredientIds);
  if (error || !data) return metaMap;

  data.forEach((row) => {
    if (!row?.id) return;
    metaMap.set(row.id, {
      id: row.id as string,
      unit: row.unit ?? null,
      rda_adult: row.rda_adult ?? null,
      ul_adult: row.ul_adult ?? null,
    });
  });
  return metaMap;
};

const fetchProductIngredients = async (
  source: ScoreSource,
  sourceId: string,
): Promise<{ rows: ProductIngredientRow[]; sourceIdForWrite: string; canonicalSourceId: string | null } | null> => {
  const selectColumns =
    "source_id,canonical_source_id,ingredient_id,name_raw,amount,unit,amount_normalized,unit_normalized,amount_unknown,is_active,is_proprietary_blend,parse_confidence,basis,form_raw";

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

export async function computeScoreBundleV4(params: {
  source: ScoreSource;
  sourceId: string;
}): Promise<ScoreComputationResult | null> {
  const ingredientLookup = await fetchProductIngredients(params.source, params.sourceId);
  if (!ingredientLookup) return null;

  const { rows, sourceIdForWrite, canonicalSourceId } = ingredientLookup;
  const inputsHash = buildInputsHash(rows);
  const ingredientMeta = await fetchIngredientMeta(rows);
  const ulWarnings = computeUlWarnings(rows, ingredientMeta);
  const metrics = computeScores(rows, canonicalSourceId);

  const safetyPenalty =
    ulWarnings.high.length * 15 + ulWarnings.moderate.length * 8;
  const safety = clamp(metrics.safetyBase - safetyPenalty, 0, 100);
  const integrity = clamp(metrics.integrityBase, 0, 100);

  const rawOverall = 0.4 * metrics.effectiveness + 0.3 * safety + 0.3 * integrity;
  const displayOverall =
    metrics.confidence * rawOverall + (1 - metrics.confidence) * 50;
  const basis = rows[0]?.basis ?? "label_serving";

  const bundle: ScoreBundleV4 = {
    overallScore: roundScore(displayOverall),
    pillars: {
      effectiveness: roundScore(metrics.effectiveness),
      safety: roundScore(safety),
      integrity: roundScore(integrity),
    },
    confidence: roundScore(metrics.confidence),
    bestFitGoals: resolveGoalMatches(rows),
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
      canonicalSourceId,
      scoreVersion: V4_SCORE_VERSION,
      computedAt: new Date().toISOString(),
      inputsHash,
      datasetVersion: null,
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
      ulWarnings,
      assumptions: {
        basis,
        notes: "Scores use label-derived doses when available; unknown doses reduce confidence.",
      },
    },
  };

  return {
    bundle,
    inputsHash,
    sourceIdForWrite,
    canonicalSourceId,
  };
}
