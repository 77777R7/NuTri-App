import { createHash } from "node:crypto";

import type { FactsDigest } from "./factsDigest.js";
import { lookupSafeScienceSignals } from "./kbRuntime.js";
import { lookupQualityMarkAudit } from "./qualityMarks/cache.js";

export type DecisionSupportViewMode = "simple" | "details";

export type DecisionSupportSourceTier =
  | "official_record"
  | "scanned_label"
  | "general_science"
  | "inferred";

export type DecisionSupportSeverity = "high" | "medium" | "low";
export type DecisionSupportFixability = "fixable" | "ceiling" | "unknown";

export type DecisionSupportSubscoreId =
  | "GoalEvidenceFit"
  | "FormulaQuality"
  | "SafetyTransparency"
  | "TrustQualityAssurance";

export type DecisionSupportVerdict =
  | "strong_candidate"
  | "reasonable_but_incomplete"
  | "hard_to_recommend_until_label_verified";

export type DecisionSupportChecklistItem = {
  id: string;
  label: string;
  why?: string | null;
  passed: boolean;
  weight: number;
  sourceTier: DecisionSupportSourceTier;
  affectsCoreVerdict: boolean;
  hiddenInSimple: boolean;
};

export type DecisionSupportSubscore = {
  id: DecisionSupportSubscoreId;
  score: number;
  passedWeight: number;
  totalWeight: number;
  checklistCount: number;
};

export type DecisionSupportBlocker = {
  code:
    | "missing_active_breakdown"
    | "missing_directions_dsld"
    | "warnings_missing_fixable"
    | "warnings_missing_ceiling"
    | "missing_form_high_impact";
  title: string;
  why: string;
  severity: DecisionSupportSeverity;
  fixability: DecisionSupportFixability;
  affectsCoreVerdict: boolean;
  beforeYouBuy: boolean;
};

export type DecisionSupportQualityMarkStatus = "detected" | "not_detected" | "unknown";

export type DecisionSupportExtraTrustSignal = {
  code: "quality_mark_status";
  status: DecisionSupportQualityMarkStatus;
  checked: boolean;
  confidence: number | null;
  confidenceBucket: "high" | "medium" | "low";
  evidenceRef: string | null;
  sourcesTried: string[];
  lastCheckedAt: string | null;
  checkedMode: "search_only" | "page_fetch" | null;
  pagesFetchedCount: number;
  searchPagesFetchedCount: number;
  evidenceType: "page" | "search" | null;
  note: string;
};

export type DecisionSupportChecklistStatus = "verified" | "missing" | "unknown";

export type DecisionSupportChecklistRow = {
  key: string;
  label: string;
  status: DecisionSupportChecklistStatus;
  sourceTier: DecisionSupportSourceTier;
  why: string | null;
};

export type DecisionSupportNutriScoreCard = {
  score: number;
  confidenceCoverage: number;
  rows: Array<{
    id: "effectiveness" | "safety" | "integrity";
    label: "Effectiveness" | "Safety" | "Integrity";
    score: number;
  }>;
  checklistsByRow: Record<"effectiveness" | "safety" | "integrity", DecisionSupportChecklistRow[]>;
};

export type DecisionSupportOverviewBlock = {
  sourceStrip: string[];
  bestForBullets: string[];
  providesVerified: {
    servingSize: string | null;
    servingsPerContainer: number | null;
    keyIngredients: Array<{ name: string; dose: string | null }>;
    dosageForm: string | null;
    count: string | null;
  };
  missingInfo: string[];
  singleCta: { label: string; id: string } | null;
};

export type DecisionSupportScienceBlock = {
  ingredientSnapshotNames: string[];
  formMatters: {
    ingredientChemicalForm: string | null;
    dosageForm: string | null;
  };
  odsGeneralScienceBullets: string[];
  aiSummaryContract3: [string, string, string];
};

export type DecisionSupportUsageBlock = {
  directions: {
    text: string;
    lines: string[];
    sourceTier: "official_record" | "scanned_label" | "missing";
    hasDirectionsTextVisible: boolean;
  };
  timingTip: string;
  conservativeGuidance: string;
};

export type DecisionSupportSafetyBlock = {
  labelWarnings: string[];
  ulGuidance: string[];
  generalWatchouts: string[];
  dataStatusRef: string;
};

export type DecisionSupportQualityMark = {
  status: DecisionSupportQualityMarkStatus;
  checked: boolean;
  confidenceBucket: "high" | "medium" | "low";
  evidenceRef: string | null;
  sourcesTried: string[];
  lastCheckedAt: string | null;
  checkedMode: "search_only" | "page_fetch" | null;
  pagesFetchedCount: number;
  searchPagesFetchedCount: number;
  evidenceType: "page" | "search" | null;
  note: string;
};

export type DecisionSupportCategoryId =
  | "fish_oil_omega3"
  | "vitamin_d"
  | "magnesium"
  | "probiotics"
  | "unknown";

export type DecisionSupportPayload = {
  digest: string;
  rubricVersion: string;
  categoryId: DecisionSupportCategoryId;
  categoryProfileVersion: string;
  viewMode: DecisionSupportViewMode;
  verdict: DecisionSupportVerdict;
  verdictReason: string;
  subscores: DecisionSupportSubscore[];
  checklist: DecisionSupportChecklistItem[];
  blockers: DecisionSupportBlocker[];
  topBlockers: DecisionSupportBlocker[];
  extraTrustSignals: DecisionSupportExtraTrustSignal[];
  sourceTiers: DecisionSupportSourceTier[];
  nutriScoreCard: DecisionSupportNutriScoreCard;
  overviewBlock: DecisionSupportOverviewBlock;
  scienceBlock: DecisionSupportScienceBlock;
  usageBlock: DecisionSupportUsageBlock;
  safetyBlock: DecisionSupportSafetyBlock;
  qualityMark: DecisionSupportQualityMark;
  safeScienceSignalSource?: "subset" | "fallback" | "none";
  safeScienceFallbackType?: "best_for" | "comparison" | null;
};

export type DecisionSupportInline = {
  verdict: DecisionSupportVerdict;
  subscores: Array<{ id: DecisionSupportSubscoreId; score: number }>;
  topBlockers: Array<{
    code: DecisionSupportBlocker["code"];
    title: string;
    why: string;
    severity: DecisionSupportSeverity;
  }>;
  nutriScoreCard: DecisionSupportNutriScoreCard;
  overviewBlock: DecisionSupportOverviewBlock;
  scienceBlock: DecisionSupportScienceBlock;
  usageBlock: DecisionSupportUsageBlock;
  safetyBlock: DecisionSupportSafetyBlock;
  qualityMark: DecisionSupportQualityMark;
};

type DecisionSupportCompileParams = {
  digest: FactsDigest;
  factsDigestHash: string;
  viewMode: DecisionSupportViewMode;
  flagsSnapshot?: Record<string, unknown>;
  patchActivation?: {
    appliedLaneIds?: string[];
  } | null;
};

const DECISION_SUPPORT_RUBRIC_VERSION = "v1.6.12-r2d-1";
const DECISION_SUPPORT_DIGEST_DELIMITER = "\n|\n";
const CATEGORY_PROFILE_VERSION: Record<DecisionSupportCategoryId, string> = {
  fish_oil_omega3: "fish-oil-omega3-v1",
  vitamin_d: "vitamin-d-v1",
  magnesium: "magnesium-v1",
  probiotics: "probiotics-v1",
  unknown: "unknown-v1",
};

const scoreClamp = (value: number): number => Math.max(0, Math.min(100, Math.round(value)));

const stableStringify = (value: unknown): string => {
  if (value === null) return "null";
  if (typeof value === "boolean") return value ? "true" : "false";
  if (typeof value === "number") return Number.isFinite(value) ? String(value) : "null";
  if (typeof value === "string") return JSON.stringify(value);
  if (Array.isArray(value)) {
    return `[${value.map((item) => stableStringify(item)).join(",")}]`;
  }
  if (typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([key]) => typeof key === "string")
      .sort(([a], [b]) => a.localeCompare(b));
    const parts = entries.map(([key, itemValue]) => `${JSON.stringify(key)}:${stableStringify(itemValue)}`);
    return `{${parts.join(",")}}`;
  }
  return "null";
};

export const canonicalizeFlagsSnapshot = (value: Record<string, unknown> | null | undefined): string =>
  stableStringify(value ?? {});

const canonicalizeSourceIdentity = (digest: FactsDigest): string => {
  const identityType = String(digest?.identity?.type ?? "unknown").trim().toLowerCase();
  const identityValue = String(digest?.identity?.value ?? "").trim();
  return `${identityType}:${identityValue}`;
};

const normalizeText = (value: string | null | undefined): string =>
  String(value ?? "")
    .trim()
    .toLowerCase();

const normalizeDisplayText = (value: string | null | undefined): string =>
  String(value ?? "")
    .replace(/\s+/g, " ")
    .trim();

const normalizeActiveNames = (digest: FactsDigest): string[] =>
  (Array.isArray(digest?.actives) ? digest.actives : [])
    .map((active) => normalizeText(active?.name))
    .filter(Boolean);

const sanitizeDecisionLine = (value: string | null | undefined): string | null => {
  const raw = String(value ?? "").replace(/\s+/g, " ").trim();
  if (!raw) return null;
  if (/\bsafe|effective|works?|cures?|treats?\b/i.test(raw)) return null;
  if (/\bnormal function\b|\bday-to-day wellness\b|\bgeneral wellness\b/i.test(raw)) return null;
  return /[.!?]$/.test(raw) ? raw : `${raw}.`;
};

const dedupeLines = (lines: Array<string | null | undefined>, max = 3): string[] => {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of lines) {
    const line = sanitizeDecisionLine(raw);
    if (!line) continue;
    const key = line.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(line);
    if (out.length >= max) break;
  }
  return out;
};

const dropBestForPrefix = (value: string | null | undefined): string => {
  const raw = String(value ?? "").trim();
  if (!raw) return "";
  return raw.replace(/^(best for|good if you want|not ideal if)\s*:\s*/i, "").trim();
};

const cleanupSentenceFragment = (value: string | null | undefined): string => {
  const raw = dropBestForPrefix(value);
  return raw.replace(/[.!?]+$/, "").trim();
};

const buildCategoryBestForBullets = (params: {
  categoryId: DecisionSupportCategoryId;
  safeScienceSignals: ReturnType<typeof lookupSafeScienceSignals> | null;
  missingActiveBreakdown: boolean;
}): string[] => {
  const { categoryId, safeScienceSignals, missingActiveBreakdown } = params;
  if (categoryId === "fish_oil_omega3") {
    return [
      "Best for: increasing omega-3 intake as part of a heart/vascular-support routine.",
      "Good if you want: products with clear EPA+DHA per serving (easier to compare strength).",
      missingActiveBreakdown
        ? "Not ideal if: the label does not disclose EPA+DHA, because fish-oil mg alone is a weak strength signal."
        : "Not ideal if: you compare only fish-oil mg and ignore EPA+DHA transparency.",
    ];
  }

  const base = dedupeLines(
    [
      safeScienceSignals?.bestForBullets?.[0] ?? null,
      safeScienceSignals?.bestForBullets?.[1] ?? null,
      safeScienceSignals?.formImpactLine ?? null,
    ],
    3,
  );
  const bestFor = cleanupSentenceFragment(base[0] ?? "comparing ingredient support based on clear label disclosure");
  const goodIf = cleanupSentenceFragment(
    base[1] ?? "products with clear per-serving disclosure so comparisons are easier",
  );
  const notIdeal = cleanupSentenceFragment(
    base[2] ?? "core disclosure is missing, because confidence drops when key details are not stated",
  );
  return [
    `Best for: ${bestFor}.`,
    `Good if you want: ${goodIf}.`,
    `Not ideal if: ${notIdeal}.`,
  ];
};

const hasDirections = (digest: FactsDigest): boolean =>
  (Array.isArray(digest?.labelDosing) ? digest.labelDosing : []).some((row) =>
    [row?.rawText, row?.dose, row?.frequency].some((value) => normalizeText(value).length > 0),
  );

const hasExplicitForm = (digest: FactsDigest): boolean =>
  (Array.isArray(digest?.actives) ? digest.actives : []).some((active) => {
    const chemicalForm = normalizeText(active?.chemicalForm);
    const activeName = normalizeText(active?.name);
    return chemicalForm.length > 0 || /\bvitamin\s*d[23]\b/.test(activeName);
  });

const hasWarningsData = (digest: FactsDigest): boolean => {
  const warnings = digest?.warnings;
  if (!warnings || typeof warnings !== "object") return false;
  const explicitSignals = [warnings.warnings, warnings.consultDoctorIf, warnings.redFlags]
    .flat()
    .filter((item) => normalizeText(item).length > 0);
  if (explicitSignals.length > 0) return true;
  return warnings.missingFlag === false;
};

const detectCategoryId = (digest: FactsDigest): DecisionSupportCategoryId => {
  const productText = `${normalizeText(digest?.product?.name)} ${normalizeText(digest?.product?.brandDisplay)}`;
  const activeNames = normalizeActiveNames(digest);
  const combined = `${productText} ${activeNames.join(" ")}`;

  if (/(fish\s*oil|omega\s*-?\s*3|epa|dha)/.test(combined)) return "fish_oil_omega3";
  if (/(vitamin\s*d\b|\bd3\b|\bd2\b|cholecalciferol|ergocalciferol)/.test(combined)) return "vitamin_d";
  if (/(\bmagnesium\b|glycinate|citrate|oxide|malate)/.test(combined)) return "magnesium";
  if (/(probiotic|cfu|lactobacillus|bifidobacterium|saccharomyces)/.test(combined)) return "probiotics";
  return "unknown";
};

const hasFishOilBreakdown = (digest: FactsDigest): boolean => {
  const activeNames = normalizeActiveNames(digest);
  return activeNames.some((name) => /(\bepa\b|\bdha\b|total\s*omega\s*-?\s*3|omega\s*-?\s*3)/.test(name));
};

const toSubscore = (id: DecisionSupportSubscoreId, checklist: DecisionSupportChecklistItem[]): DecisionSupportSubscore => {
  const relevant = checklist.filter((item) => item.id.startsWith(`${id.toLowerCase()}:`));
  const visible = relevant;
  const totalWeight = visible.reduce((sum, item) => sum + Math.max(0, item.weight), 0);
  const passedWeight = visible
    .filter((item) => item.passed)
    .reduce((sum, item) => sum + Math.max(0, item.weight), 0);
  const ratio = totalWeight > 0 ? passedWeight / totalWeight : 0;
  return {
    id,
    score: scoreClamp(ratio * 100),
    passedWeight,
    totalWeight,
    checklistCount: visible.length,
  };
};

const blockerPriority = (blocker: DecisionSupportBlocker): [number, number, string] => {
  const severityRank = blocker.severity === "high" ? 3 : blocker.severity === "medium" ? 2 : 1;
  const fixabilityRank = blocker.fixability === "fixable" ? 3 : blocker.fixability === "unknown" ? 2 : 1;
  return [severityRank, fixabilityRank, blocker.code];
};

const compareBlockers = (a: DecisionSupportBlocker, b: DecisionSupportBlocker): number => {
  const pa = blockerPriority(a);
  const pb = blockerPriority(b);
  if (pa[0] !== pb[0]) return pb[0] - pa[0];
  if (pa[1] !== pb[1]) return pb[1] - pa[1];
  return pa[2].localeCompare(pb[2]);
};

const dedupeSourceTiers = (checklist: DecisionSupportChecklistItem[]): DecisionSupportSourceTier[] =>
  Array.from(new Set(checklist.map((item) => item.sourceTier)));

const buildChecklist = (params: {
  digest: FactsDigest;
  categoryId: DecisionSupportCategoryId;
  viewMode: DecisionSupportViewMode;
  missingWarningsAsFixable: boolean;
  missingWarningsAsCeiling: boolean;
  missingDirectionsDsld: boolean;
  missingActiveBreakdown: boolean;
  missingFormHighImpact: boolean;
  safeScienceSignals: ReturnType<typeof lookupSafeScienceSignals> | null;
  qualitySignal: DecisionSupportExtraTrustSignal;
}): DecisionSupportChecklistItem[] => {
  const {
    digest,
    categoryId,
    viewMode,
    missingWarningsAsFixable,
    missingWarningsAsCeiling,
    missingDirectionsDsld,
    missingActiveBreakdown,
    missingFormHighImpact,
    safeScienceSignals,
    qualitySignal,
  } = params;

  const officialRecord = digest.sourceType === "lnhpd" || digest.sourceType === "dsld";
  const scannedLabel = false;
  const supportSignals = Array.isArray(digest.actives) && digest.actives.length > 0;
  const amountDisclosed = (digest.actives ?? []).some((item) => Number.isFinite(Number(item?.amount)) && normalizeText(item?.unit).length > 0);
  const hasDirectionsData = hasDirections(digest);
  const warningsAvailable = hasWarningsData(digest);
  const explicitForm = hasExplicitForm(digest);
  const hasInferredSignals = (digest.actives ?? []).some((item) => normalizeText(item?.chemicalForm).length > 0);
  const hasMissingItemsSurfaced = missingWarningsAsFixable || missingWarningsAsCeiling || missingDirectionsDsld || missingActiveBreakdown;

  const all: DecisionSupportChecklistItem[] = [
    {
      id: "goalevidencefit:official_record_used",
      label: "Official record linked",
      passed: officialRecord,
      weight: 3,
      sourceTier: "official_record",
      affectsCoreVerdict: true,
      hiddenInSimple: false,
    },
    {
      id: "goalevidencefit:ingredient_signal_present",
      label: "Category intent recognized",
      why: safeScienceSignals?.bestForBullets?.[0] ?? null,
      passed: supportSignals,
      weight: 3,
      sourceTier: safeScienceSignals ? "general_science" : (officialRecord ? "official_record" : "general_science"),
      affectsCoreVerdict: true,
      hiddenInSimple: false,
    },
    {
      id: "goalevidencefit:category_profile_resolved",
      label: "Category profile resolved",
      passed: categoryId !== "unknown",
      weight: 2,
      sourceTier: "general_science",
      affectsCoreVerdict: false,
      hiddenInSimple: false,
    },

    {
      id: "formulaquality:amount_disclosed",
      label: categoryId === "fish_oil_omega3" ? "Oil amount disclosed" : "Active amount disclosed",
      passed: amountDisclosed,
      weight: 4,
      sourceTier: officialRecord ? "official_record" : "general_science",
      affectsCoreVerdict: true,
      hiddenInSimple: false,
    },
    {
      id: "formulaquality:form_disclosed",
      label: "Chemical form disclosed",
      why: safeScienceSignals?.formImpactLine ?? null,
      passed: !missingFormHighImpact && explicitForm,
      weight: 2,
      sourceTier: safeScienceSignals ? "general_science" : (officialRecord ? "official_record" : "general_science"),
      affectsCoreVerdict: true,
      hiddenInSimple: false,
    },
    {
      id: "formulaquality:active_breakdown",
      label: categoryId === "fish_oil_omega3" ? "EPA+DHA breakdown disclosed" : "Active breakdown disclosed",
      passed: !missingActiveBreakdown,
      weight: 4,
      sourceTier: "official_record",
      affectsCoreVerdict: true,
      hiddenInSimple: false,
    },

    {
      id: "safetytransparency:directions_present",
      label: "Directions present in record",
      passed: hasDirectionsData,
      weight: 4,
      sourceTier: officialRecord ? "official_record" : "general_science",
      affectsCoreVerdict: true,
      hiddenInSimple: false,
    },
    {
      id: "safetytransparency:warnings_present",
      label: "Label warnings present in record",
      why: safeScienceSignals?.beforeYouBuyLine ?? null,
      passed: warningsAvailable,
      weight: 4,
      sourceTier: safeScienceSignals ? "general_science" : (officialRecord ? "official_record" : "general_science"),
      affectsCoreVerdict: missingWarningsAsFixable,
      hiddenInSimple: false,
    },
    {
      id: "safetytransparency:warnings_ceiling_notice",
      label: "Missing items surfaced in Missing info (Overview)",
      passed: hasMissingItemsSurfaced || (warningsAvailable && hasDirectionsData),
      weight: 1,
      sourceTier: "official_record",
      affectsCoreVerdict: false,
      hiddenInSimple: false,
    },

    {
      id: "trustqualityassurance:source_finality",
      label: "Authoritative source finalized",
      passed: officialRecord,
      weight: 4,
      sourceTier: "official_record",
      affectsCoreVerdict: true,
      hiddenInSimple: false,
    },
    {
      id: "trustqualityassurance:quality_mark_checked",
      label: "Third-party quality mark checked",
      passed: qualitySignal.checked && qualitySignal.status !== "unknown",
      weight: 1,
      sourceTier: "general_science",
      affectsCoreVerdict: false,
      hiddenInSimple: false,
    },
    {
      id: "trustqualityassurance:inferred_hint_available",
      label: "Inferred hint available",
      passed: hasInferredSignals,
      weight: 1,
      sourceTier: "inferred",
      affectsCoreVerdict: false,
      hiddenInSimple: true,
    },
  ];

  const filtered = viewMode === "simple" ? all.filter((item) => !item.hiddenInSimple) : all;

  if (missingDirectionsDsld) {
    return filtered.map((item) =>
      item.id === "safetytransparency:directions_present" ? { ...item, passed: false } : item,
    );
  }
  return filtered;
};

const buildBlockers = (params: {
  digest: FactsDigest;
  categoryId: DecisionSupportCategoryId;
  missingWarningsAsFixable: boolean;
  missingWarningsAsCeiling: boolean;
  missingDirectionsDsld: boolean;
  missingActiveBreakdown: boolean;
  missingFormHighImpact: boolean;
}): DecisionSupportBlocker[] => {
  const blockers: DecisionSupportBlocker[] = [];

  if (params.missingActiveBreakdown) {
    blockers.push({
      code: "missing_active_breakdown",
      title: "Active breakdown missing",
      why: "EPA/DHA or total omega-3 breakdown is not disclosed in this record.",
      severity: "high",
      fixability: "fixable",
      affectsCoreVerdict: true,
      beforeYouBuy: true,
    });
  }

  if (params.missingDirectionsDsld) {
    blockers.push({
      code: "missing_directions_dsld",
      title: "Directions missing in DSLD record",
      why: "Directions are not provided in this record and should be verified from the label.",
      severity: "high",
      fixability: "fixable",
      affectsCoreVerdict: true,
      beforeYouBuy: true,
    });
  }

  if (params.missingWarningsAsFixable) {
    blockers.push({
      code: "warnings_missing_fixable",
      title: "Label warnings missing",
      why: "Label-specific warnings are expected but missing from the captured record.",
      severity: "high",
      fixability: "fixable",
      affectsCoreVerdict: true,
      beforeYouBuy: true,
    });
  }

  if (params.missingWarningsAsCeiling) {
    blockers.push({
      code: "warnings_missing_ceiling",
      title: "Label warnings unavailable in official record",
      why: "This dataset usually does not include full label warnings, so package verification is still needed.",
      severity: "medium",
      fixability: "ceiling",
      affectsCoreVerdict: false,
      beforeYouBuy: true,
    });
  }

  if (params.missingFormHighImpact) {
    blockers.push({
      code: "missing_form_high_impact",
      title: "Form disclosure is incomplete",
      why: "A high-impact form detail is not explicitly stated in this record.",
      severity: "medium",
      fixability: "fixable",
      affectsCoreVerdict: true,
      beforeYouBuy: false,
    });
  }

  return blockers.sort(compareBlockers);
};

const deriveVerdict = (params: {
  subscores: DecisionSupportSubscore[];
  topBlockers: DecisionSupportBlocker[];
}): { verdict: DecisionSupportVerdict; verdictReason: string } => {
  const { subscores, topBlockers } = params;
  const coreBlockers = topBlockers.filter((item) => item.affectsCoreVerdict);
  const highCoreBlockerCount = coreBlockers.filter((item) => item.severity === "high").length;
  const average = subscores.length > 0
    ? subscores.reduce((sum, item) => sum + item.score, 0) / subscores.length
    : 0;

  if (highCoreBlockerCount > 0 || average < 55) {
    return {
      verdict: "hard_to_recommend_until_label_verified",
      verdictReason: highCoreBlockerCount > 0
        ? "High-impact blockers remain unresolved."
        : "Decision-support confidence is low from current record coverage.",
    };
  }

  if (coreBlockers.length === 0 && average >= 75) {
    return {
      verdict: "strong_candidate",
      verdictReason: "Coverage is strong enough for shopping readiness.",
    };
  }

  return {
    verdict: "reasonable_but_incomplete",
    verdictReason: "Core fields are partly available, but some gaps still need label verification.",
  };
};

const findSubscore = (subscores: DecisionSupportSubscore[], id: DecisionSupportSubscoreId): number =>
  subscores.find((item) => item.id === id)?.score ?? 0;

const toChecklistStatus = (item: DecisionSupportChecklistItem): DecisionSupportChecklistStatus => {
  if (item.passed) return "verified";
  if (item.sourceTier === "inferred") return "unknown";
  return "missing";
};

const toChecklistRows = (items: DecisionSupportChecklistItem[]): DecisionSupportChecklistRow[] =>
  items.map((item) => ({
    key: item.id,
    label: item.label,
    status: toChecklistStatus(item),
    sourceTier: item.sourceTier,
    why: item.why ?? null,
  }));

const buildNutriScoreCard = (params: {
  checklist: DecisionSupportChecklistItem[];
  subscores: DecisionSupportSubscore[];
}): DecisionSupportNutriScoreCard => {
  const { checklist, subscores } = params;
  const effectivenessItems = checklist.filter(
    (item) =>
      item.id.startsWith("goalevidencefit:") ||
      item.id.startsWith("formulaquality:"),
  );
  const safetyItems = checklist.filter((item) => item.id.startsWith("safetytransparency:"));
  const integrityItems = checklist.filter((item) => item.id.startsWith("trustqualityassurance:"));
  const visibleItems = checklist.filter((item) => item.sourceTier !== "inferred");
  const covered = visibleItems.filter((item) => item.passed).length;
  const confidenceCoverage =
    visibleItems.length > 0 ? Math.max(0, Math.min(100, Math.round((covered / visibleItems.length) * 100))) : 0;
  const effectivenessScore = scoreClamp(
    (findSubscore(subscores, "GoalEvidenceFit") + findSubscore(subscores, "FormulaQuality")) / 2,
  );
  const safetyScore = findSubscore(subscores, "SafetyTransparency");
  const integrityScore = findSubscore(subscores, "TrustQualityAssurance");
  const score = scoreClamp((effectivenessScore + safetyScore + integrityScore) / 3);
  return {
    score,
    confidenceCoverage,
    rows: [
      { id: "effectiveness", label: "Effectiveness", score: effectivenessScore },
      { id: "safety", label: "Safety", score: safetyScore },
      { id: "integrity", label: "Integrity", score: integrityScore },
    ],
    checklistsByRow: {
      effectiveness: toChecklistRows(effectivenessItems),
      safety: toChecklistRows(safetyItems),
      integrity: toChecklistRows(integrityItems),
    },
  };
};

const buildOverviewBlock = (params: {
  digest: FactsDigest;
  categoryId: DecisionSupportCategoryId;
  safeScienceSignals: ReturnType<typeof lookupSafeScienceSignals> | null;
  blockers: DecisionSupportBlocker[];
  missingActiveBreakdown: boolean;
}): DecisionSupportOverviewBlock => {
  const { digest, categoryId, safeScienceSignals, blockers, missingActiveBreakdown } = params;
  const sourceStrip = dedupeLines([
    digest.sourceType === "lnhpd" || digest.sourceType === "dsld" ? "Official record (DSLD/LNHPD)." : null,
    "Scanned label.",
    "General science (NIH ODS).",
    "AI summary (grounded).",
  ], 4);
  const bestForBullets = buildCategoryBestForBullets({
    categoryId,
    safeScienceSignals,
    missingActiveBreakdown,
  });
  const keyIngredients = (digest.actives ?? [])
    .slice(0, 4)
    .map((item) => ({
      name: normalizeDisplayText(item?.name) || "Ingredient",
      dose:
        item?.amount != null
          ? normalizeDisplayText(`${item.amount} ${item?.unit ?? ""}`) || null
          : null,
    }))
    .filter((item) => item.name.length > 0);
  const missingInfo = dedupeLines(
    blockers
      .filter((item) => item.beforeYouBuy)
      .map((item) => item.why),
    2,
  );
  return {
    sourceStrip,
    bestForBullets,
    providesVerified: {
      servingSize: normalizeDisplayText(digest?.serving?.servingSize) || null,
      servingsPerContainer:
        typeof digest?.serving?.servingsPerContainer === "number"
          ? digest.serving.servingsPerContainer
          : null,
      keyIngredients,
      dosageForm: normalizeDisplayText(digest?.product?.dosageForm) || null,
      count:
        typeof digest?.serving?.servingsPerContainer === "number"
          ? `${digest.serving.servingsPerContainer} servings`
          : null,
    },
    missingInfo,
    singleCta:
      missingInfo.length > 0
        ? { label: "Scan Directions + Warnings panel", id: "scan_directions_warnings" }
        : null,
  };
};

const sentenceNeedsSupportVerb = (sentence: string): boolean => !/\bsupport\b/i.test(sentence);

const buildGeneralUseSentence = (params: {
  categoryId: DecisionSupportCategoryId;
  safeScienceSignals: ReturnType<typeof lookupSafeScienceSignals> | null;
  overviewBestForBullets: string[];
}): string => {
  const { categoryId, safeScienceSignals, overviewBestForBullets } = params;
  const overviewKeys = overviewBestForBullets.map((line) => cleanupSentenceFragment(line).toLowerCase());
  const candidates = (safeScienceSignals?.bestForBullets ?? [])
    .map((line) => cleanupSentenceFragment(line))
    .filter(Boolean);
  const candidate =
    candidates.find((line) => !overviewKeys.some((key) => key && line.toLowerCase().includes(key))) ??
    candidates[1] ??
    candidates[0] ??
    (categoryId === "fish_oil_omega3"
      ? "heart and vascular-support goals through omega-3 intake"
      : "goal-oriented supplement support");
  const normalized = cleanupSentenceFragment(candidate);
  if (!normalized) return "Often used to support goal-oriented supplement support (general science).";
  return sentenceNeedsSupportVerb(normalized)
    ? `Often used to support ${normalized} (general science).`
    : `Often used for ${normalized} (general science).`;
};

const buildComparabilityDisclosure = (params: {
  categoryId: DecisionSupportCategoryId;
  hasActiveBreakdown: boolean;
  hasChemicalForm: boolean;
  digest: FactsDigest;
}): string => {
  const { categoryId, hasActiveBreakdown, hasChemicalForm, digest } = params;
  if (categoryId === "fish_oil_omega3") {
    return hasActiveBreakdown
      ? "EPA+DHA disclosure is available"
      : "EPA+DHA disclosure is missing";
  }
  if (categoryId === "vitamin_d") {
    return hasChemicalForm ? "D3 or D2 form disclosure is available" : "D3 or D2 form is not stated";
  }
  if (categoryId === "magnesium") {
    return hasChemicalForm ? "the chemical form is disclosed" : "the chemical form is not stated";
  }
  if (categoryId === "probiotics") {
    const names = normalizeActiveNames(digest);
    const hasStrain = names.some((name) => /(lactobacillus|bifidobacterium|saccharomyces|strain)/.test(name));
    const hasCfu = names.some((name) => /\bcfu\b/.test(name));
    if (hasStrain && hasCfu) return "strain and CFU disclosure are both available";
    if (hasStrain || hasCfu) return "strain or CFU disclosure is only partial";
    return "strain and CFU disclosure are missing";
  }
  return hasChemicalForm ? "core disclosure is available" : "core disclosure is partly missing";
};

const getMissingCodePriority = (categoryId: DecisionSupportCategoryId): DecisionSupportBlocker["code"][] => {
  if (categoryId === "fish_oil_omega3") {
    return [
      "missing_active_breakdown",
      "missing_directions_dsld",
      "warnings_missing_fixable",
      "warnings_missing_ceiling",
      "missing_form_high_impact",
    ];
  }
  if (categoryId === "vitamin_d") {
    return [
      "missing_form_high_impact",
      "missing_directions_dsld",
      "warnings_missing_fixable",
      "warnings_missing_ceiling",
      "missing_active_breakdown",
    ];
  }
  return [
    "missing_directions_dsld",
    "warnings_missing_fixable",
    "warnings_missing_ceiling",
    "missing_form_high_impact",
    "missing_active_breakdown",
  ];
};

const buildLimitationText = (code: DecisionSupportBlocker["code"]): string => {
  if (code === "missing_active_breakdown") return "EPA/DHA breakdown is missing from the official record";
  if (code === "missing_directions_dsld") return "exact directions are not included in the official record";
  if (code === "warnings_missing_fixable") return "product-specific label warnings are missing";
  if (code === "warnings_missing_ceiling") return "product-specific label warnings are not included in the official record";
  if (code === "missing_form_high_impact") return "chemical form disclosure is not stated";
  return "critical label transparency details are missing";
};

const buildActionStep = (params: {
  code: DecisionSupportBlocker["code"] | null;
  categoryId: DecisionSupportCategoryId;
  fallbackAction: string;
}): string => {
  const { code, categoryId, fallbackAction } = params;
  if (categoryId === "fish_oil_omega3" && code === "missing_active_breakdown") {
    return "Check the label for EPA+DHA per serving.";
  }
  if (categoryId === "vitamin_d" || code === "missing_form_high_impact") {
    return "Confirm D2 or D3 / chemical form on the label.";
  }
  if (
    code === "missing_directions_dsld" ||
    code === "warnings_missing_fixable" ||
    code === "warnings_missing_ceiling"
  ) {
    return "Scan the Directions + Warnings panel on the bottle.";
  }
  return sanitizeDecisionLine(fallbackAction) ?? "Scan the Directions + Warnings panel on the bottle.";
};

const buildAiSummaryContract = (params: {
  digest: FactsDigest;
  categoryId: DecisionSupportCategoryId;
  overviewBlock: DecisionSupportOverviewBlock;
  safeScienceSignals: ReturnType<typeof lookupSafeScienceSignals> | null;
  usageBlock: DecisionSupportUsageBlock;
  blockers: DecisionSupportBlocker[];
  hasActiveBreakdown: boolean;
  hasChemicalForm: boolean;
}): [string, string, string] => {
  const {
    digest,
    categoryId,
    overviewBlock,
    safeScienceSignals,
    usageBlock,
    blockers,
    hasActiveBreakdown,
    hasChemicalForm,
  } = params;
  const sentence1 = sanitizeDecisionLine(
    buildGeneralUseSentence({
      categoryId,
      safeScienceSignals,
      overviewBestForBullets: overviewBlock.bestForBullets,
    }),
  ) ?? "Often used to support goal-oriented supplement support (general science).";

  const keyIngredient = overviewBlock.providesVerified.keyIngredients[0];
  const dosageForm = overviewBlock.providesVerified.dosageForm;
  const provideFragment = keyIngredient
    ? `${keyIngredient.name}${keyIngredient.dose ? ` ${keyIngredient.dose} per serving` : ""}${dosageForm ? ` in ${dosageForm} form` : ""}`
    : `${overviewBlock.providesVerified.servingSize ?? "label-disclosed serving information"}`;
  const disclosureStatus = buildComparabilityDisclosure({
    categoryId,
    hasActiveBreakdown,
    hasChemicalForm,
    digest,
  });
  const sentence2 = sanitizeDecisionLine(
    `This product provides ${provideFragment}, but ${disclosureStatus} affects how easy it is to compare`,
  ) ?? "This product provides label-disclosed details, but core disclosure gaps affect how easy it is to compare.";

  const priority = getMissingCodePriority(categoryId);
  const blockerMap = new Map(blockers.map((item) => [item.code, item]));
  const eligibleCodes = priority.filter((code) => blockerMap.has(code)).filter((code) => {
    if (code !== "missing_directions_dsld") return true;
    return !(usageBlock.directions.hasDirectionsTextVisible && usageBlock.directions.sourceTier === "scanned_label");
  });
  const chosenCode = eligibleCodes[0] ?? null;
  const limitation = chosenCode ? buildLimitationText(chosenCode) : "label transparency remains partly incomplete";
  const action = buildActionStep({
    code: chosenCode,
    categoryId,
    fallbackAction: overviewBlock.singleCta?.label ?? "Scan the Directions + Warnings panel on the bottle.",
  }).replace(/[.]+$/, "");
  const sentence3 = sanitizeDecisionLine(`Main limitation: ${limitation}. Next step: ${action}`) ??
    "Main limitation: label transparency remains partly incomplete. Next step: Scan the Directions + Warnings panel on the bottle.";

  return [sentence1, sentence2, sentence3];
};

const buildScienceBlock = (params: {
  digest: FactsDigest;
  categoryId: DecisionSupportCategoryId;
  safeScienceSignals: ReturnType<typeof lookupSafeScienceSignals> | null;
  overviewBlock: DecisionSupportOverviewBlock;
  usageBlock: DecisionSupportUsageBlock;
  blockers: DecisionSupportBlocker[];
  missingActiveBreakdown: boolean;
  missingFormHighImpact: boolean;
}): DecisionSupportScienceBlock => {
  const {
    digest,
    categoryId,
    safeScienceSignals,
    overviewBlock,
    usageBlock,
    blockers,
    missingActiveBreakdown,
    missingFormHighImpact,
  } = params;
  const ingredientSnapshotNames = dedupeLines((digest.actives ?? []).map((item) => item.name), 8);
  const ingredientChemicalForm =
    normalizeDisplayText((digest.actives ?? []).find((item) => normalizeText(item?.chemicalForm))?.chemicalForm) || null;
  const dosageForm = normalizeDisplayText(digest?.product?.dosageForm) || null;
  const odsGeneralScienceBullets = dedupeLines(
    [safeScienceSignals?.formImpactLine ?? null, ...(safeScienceSignals?.evidenceLines ?? [])],
    3,
  );
  const fallbackOdsBullets =
    categoryId === "fish_oil_omega3"
      ? [
        "For omega-3 products, EPA+DHA per serving is usually the most useful number for comparing strength.",
        "If EPA+DHA is not disclosed, treat strength as harder to judge and compare products by label transparency first.",
      ]
      : ["Use ingredient-level guidance to compare disclosure quality across products."];
  const aiSummaryContract3 = buildAiSummaryContract({
    digest,
    categoryId,
    overviewBlock,
    safeScienceSignals,
    usageBlock,
    blockers,
    hasActiveBreakdown: !missingActiveBreakdown,
    hasChemicalForm: !missingFormHighImpact && hasExplicitForm(digest),
  });
  return {
    ingredientSnapshotNames,
    formMatters: {
      ingredientChemicalForm,
      dosageForm,
    },
    odsGeneralScienceBullets:
      odsGeneralScienceBullets.length > 0
        ? odsGeneralScienceBullets
        : fallbackOdsBullets,
    aiSummaryContract3,
  };
};

const buildUsageBlock = (params: {
  digest: FactsDigest;
  patchActivation?: { appliedLaneIds?: string[] } | null;
}): DecisionSupportUsageBlock => {
  const { digest, patchActivation } = params;
  const directionsRows = (Array.isArray(digest?.labelDosing) ? digest.labelDosing : [])
    .map((row) =>
      normalizeDisplayText([row?.population, row?.dose, row?.frequency, row?.rawText].filter(Boolean).join(" ")),
    )
    .filter(Boolean);
  const directionsTextVisible = directionsRows.length > 0;
  const directionsFromPatch = (patchActivation?.appliedLaneIds ?? []).includes("patch_directions_text_v1");
  const servingCue = normalizeDisplayText(digest?.serving?.servingSize) || "serving size not stated";
  const directionsLines = directionsTextVisible
    ? [
      sanitizeDecisionLine(directionsRows[0] ?? null),
      directionsFromPatch ? "Source: scanned_label (patched)." : "Source: official_record.",
      directionsFromPatch ? "Note: official record may not include directions; label is authoritative." : null,
    ]
    : [
      "Directions are not included in the official record.",
      "Please use the bottle's Directions panel to confirm daily serving and schedule.",
      `Serving cue (verified): ${servingCue} per serving (serving != daily dose).`,
    ];
  const normalizedLines = dedupeLines(directionsLines, 3);
  return {
    directions: {
      text: normalizedLines[0] ?? "Directions are not included in the official record.",
      lines: normalizedLines.length > 0 ? normalizedLines : ["Directions are not included in the official record."],
      sourceTier: directionsTextVisible ? (directionsFromPatch ? "scanned_label" : "official_record") : "missing",
      hasDirectionsTextVisible: directionsTextVisible,
    },
    timingTip: "Build a consistent routine after confirming label directions.",
    conservativeGuidance: "If you're unsure, start with the lowest label-suggested daily amount and reassess tolerance.",
  };
};

const buildSafetyBlock = (params: {
  categoryId: DecisionSupportCategoryId;
  digest: FactsDigest;
  safeScienceSignals: ReturnType<typeof lookupSafeScienceSignals> | null;
}): DecisionSupportSafetyBlock => {
  const { categoryId, digest, safeScienceSignals } = params;
  const labelWarnings = dedupeLines(
    Array.isArray(digest?.warnings?.warnings) ? digest.warnings.warnings : [],
    3,
  );
  const omega3UlGuidance = [
    "NIH ODS does not set a single UL for omega-3 in the same way as some vitamins/minerals.",
    "General tip: consider total intake from all sources and follow label guidance.",
  ];
  const defaultUlGuidance = dedupeLines(
    [
      ...(safeScienceSignals?.evidenceLines ?? []).filter((line) => /\bul\b|upper limit/i.test(line)),
      "UL guidance is general and should be compared with total daily intake across all sources.",
    ],
    2,
  );
  const omega3Watchouts = [
    "If pregnant/nursing or taking blood thinners / preparing for surgery, confirm with a clinician and read label cautions.",
    "Stop/adjust if you notice unexpected effects and consult a professional.",
  ];
  const defaultWatchouts = dedupeLines(
    [
      "If you are pregnant, breastfeeding, or using medications, review watch-outs before use.",
      "General watch-outs are ingredient-level guidance and not product-label warnings.",
    ],
    3,
  );
  return {
    labelWarnings:
      labelWarnings.length > 0
        ? labelWarnings
        : [
          "Product-specific label warnings were not included in the official record.",
          "Check the bottle's Warnings/Cautions panel.",
        ],
    ulGuidance:
      categoryId === "fish_oil_omega3"
        ? omega3UlGuidance
        : (defaultUlGuidance.length > 0 ? defaultUlGuidance : ["UL guidance remains general and should be reviewed with total daily intake."]),
    generalWatchouts: categoryId === "fish_oil_omega3" ? omega3Watchouts : defaultWatchouts,
    dataStatusRef: "See Missing info in Overview.",
  };
};

const deriveQualityMarkSignal = (digest: FactsDigest): DecisionSupportExtraTrustSignal => {
  const cached = lookupQualityMarkAudit({
    sourceType: digest?.sourceType ?? null,
    identityType: digest?.identity?.type ?? null,
    identityValue: digest?.identity?.value ?? null,
    brandName: digest?.product?.brandDisplay ?? null,
    productName: digest?.product?.name ?? null,
  });
  if (cached.entry) {
    const searchOnlyEvidence = cached.entry.checkedMode === "search_only" ||
      cached.entry.evidenceType === "search" ||
      /^https:\/\/duckduckgo\.com\/html\//i.test(String(cached.entry.evidenceRef ?? ""));
    const normalizedStatus: DecisionSupportQualityMarkStatus = searchOnlyEvidence
      ? "unknown"
      : cached.entry.status;
    const normalizedCheckedMode = cached.entry.checkedMode ?? (searchOnlyEvidence ? "search_only" : "page_fetch");
    const normalizedEvidenceType = cached.entry.evidenceType ?? (searchOnlyEvidence ? "search" : "page");
    const normalizedPagesFetchedCount = Number.isFinite(cached.entry.pagesFetchedCount) ? cached.entry.pagesFetchedCount : 0;
    const normalizedSearchPagesFetchedCount = Number.isFinite(cached.entry.searchPagesFetchedCount)
      ? cached.entry.searchPagesFetchedCount
      : (searchOnlyEvidence ? 1 : 0);
    return {
      code: "quality_mark_status",
      status: normalizedStatus,
      checked: cached.entry.checked,
      confidence: cached.entry.confidence,
      confidenceBucket: cached.entry.confidenceBucket,
      evidenceRef: cached.entry.evidenceRef,
      sourcesTried: cached.entry.sourcesTried,
      lastCheckedAt: cached.entry.checkedAt,
      checkedMode: normalizedCheckedMode,
      pagesFetchedCount: normalizedPagesFetchedCount,
      searchPagesFetchedCount: normalizedSearchPagesFetchedCount,
      evidenceType: normalizedEvidenceType,
      note:
        searchOnlyEvidence
          ? "Third-party quality mark status is unknown (search-only evidence; no verified mark page/image found yet)."
          : normalizedStatus === "detected"
          ? "Third-party quality mark detected from web evidence."
          : normalizedStatus === "not_detected"
            ? "Third-party quality mark was checked with no confident detection."
            : "Third-party quality mark check is inconclusive.",
    };
  }
  return {
    code: "quality_mark_status",
    status: "unknown",
    checked: false,
    confidence: null,
    confidenceBucket: "low",
    evidenceRef: null,
    sourcesTried: [],
    lastCheckedAt: null,
    checkedMode: null,
    pagesFetchedCount: 0,
    searchPagesFetchedCount: 0,
    evidenceType: null,
    note: "Third-party quality mark status is unknown until verified web evidence is available.",
  };
};

export const compileDecisionSupport = (
  params: DecisionSupportCompileParams,
): DecisionSupportPayload => {
  const digestSourceType = normalizeText(params.digest?.sourceType);
  const categoryId = detectCategoryId(params.digest);
  const categoryProfileVersion = CATEGORY_PROFILE_VERSION[categoryId];

  const missingWarnings = !hasWarningsData(params.digest);
  const missingWarningsAsFixable = missingWarnings && digestSourceType === "web";
  const missingWarningsAsCeiling = missingWarnings && (digestSourceType === "lnhpd" || digestSourceType === "dsld");

  const missingDirectionsDsld = digestSourceType === "dsld" && !hasDirections(params.digest);
  const missingActiveBreakdown = categoryId === "fish_oil_omega3" && !hasFishOilBreakdown(params.digest);
  const missingFormHighImpact = categoryId === "vitamin_d" && !hasExplicitForm(params.digest);
  const safeScienceSignals = lookupSafeScienceSignals({
    ingredientName: params.digest?.actives?.[0]?.name ?? params.digest?.product?.name ?? null,
    formText: params.digest?.actives?.[0]?.chemicalForm ?? null,
  });
  const qualitySignal = deriveQualityMarkSignal(params.digest);

  const checklist = buildChecklist({
    digest: params.digest,
    categoryId,
    viewMode: params.viewMode,
    missingWarningsAsFixable,
    missingWarningsAsCeiling,
    missingDirectionsDsld,
    missingActiveBreakdown,
    missingFormHighImpact,
    safeScienceSignals,
    qualitySignal,
  });

  const blockers = buildBlockers({
    digest: params.digest,
    categoryId,
    missingWarningsAsFixable,
    missingWarningsAsCeiling,
    missingDirectionsDsld,
    missingActiveBreakdown,
    missingFormHighImpact,
  });

  const topBlockers = blockers
    .filter((item) => item.affectsCoreVerdict)
    .sort(compareBlockers)
    .slice(0, 3);

  const subscores = [
    toSubscore("GoalEvidenceFit", checklist),
    toSubscore("FormulaQuality", checklist),
    toSubscore("SafetyTransparency", checklist),
    toSubscore("TrustQualityAssurance", checklist),
  ];

  const { verdict, verdictReason } = deriveVerdict({ subscores, topBlockers });

  const sourceIdentityCanonical = canonicalizeSourceIdentity(params.digest);
  const flagsSnapshotCanonical = canonicalizeFlagsSnapshot(params.flagsSnapshot);
  const digestInput = [
    params.factsDigestHash,
    DECISION_SUPPORT_RUBRIC_VERSION,
    categoryId,
    categoryProfileVersion,
    params.viewMode,
    flagsSnapshotCanonical,
    sourceIdentityCanonical,
  ].join(DECISION_SUPPORT_DIGEST_DELIMITER);
  const digest = createHash("sha256").update(digestInput).digest("hex");

  const nutriScoreCard = buildNutriScoreCard({
    checklist,
    subscores,
  });
  const overviewBlock = buildOverviewBlock({
    digest: params.digest,
    categoryId,
    safeScienceSignals,
    blockers,
    missingActiveBreakdown,
  });
  const usageBlock = buildUsageBlock({
    digest: params.digest,
    patchActivation: params.patchActivation ?? null,
  });
  const scienceBlock = buildScienceBlock({
    digest: params.digest,
    categoryId,
    safeScienceSignals,
    overviewBlock,
    usageBlock,
    blockers,
    missingActiveBreakdown,
    missingFormHighImpact,
  });
  const safetyBlock = buildSafetyBlock({
    categoryId,
    digest: params.digest,
    safeScienceSignals,
  });
  const qualityMark: DecisionSupportQualityMark = {
    status: qualitySignal.status,
    checked: qualitySignal.checked,
    confidenceBucket: qualitySignal.confidenceBucket,
    evidenceRef: qualitySignal.evidenceRef,
    sourcesTried: qualitySignal.sourcesTried,
    lastCheckedAt: qualitySignal.lastCheckedAt,
    checkedMode: qualitySignal.checkedMode,
    pagesFetchedCount: qualitySignal.pagesFetchedCount,
    searchPagesFetchedCount: qualitySignal.searchPagesFetchedCount,
    evidenceType: qualitySignal.evidenceType,
    note: qualitySignal.note,
  };

  return {
    digest,
    rubricVersion: DECISION_SUPPORT_RUBRIC_VERSION,
    categoryId,
    categoryProfileVersion,
    viewMode: params.viewMode,
    verdict,
    verdictReason,
    subscores,
    checklist,
    blockers,
    topBlockers,
    extraTrustSignals: [qualitySignal],
    sourceTiers: dedupeSourceTiers(checklist),
    nutriScoreCard,
    overviewBlock,
    scienceBlock,
    usageBlock,
    safetyBlock,
    qualityMark,
    safeScienceSignalSource: safeScienceSignals?.signalSource ?? "none",
    safeScienceFallbackType: safeScienceSignals?.fallbackType ?? null,
  };
};

export const toDecisionSupportInline = (payload: DecisionSupportPayload): DecisionSupportInline => ({
  verdict: payload.verdict,
  subscores: payload.subscores.map((item) => ({ id: item.id, score: item.score })),
  topBlockers: payload.topBlockers.map((item) => ({
    code: item.code,
    title: item.title,
    why: item.why,
    severity: item.severity,
  })),
  nutriScoreCard: payload.nutriScoreCard,
  overviewBlock: payload.overviewBlock,
  scienceBlock: payload.scienceBlock,
  usageBlock: payload.usageBlock,
  safetyBlock: payload.safetyBlock,
  qualityMark: payload.qualityMark,
});
