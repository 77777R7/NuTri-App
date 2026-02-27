const normalizeText = (value) => (typeof value === "string" ? value.trim() : "");
const unwrapScoreBundle = (value) => {
  if (!value || typeof value !== "object") return null;
  if (value.bundle && typeof value.bundle === "object") return value.bundle;
  return value;
};

const CONCRETE_SIGNAL_PATTERNS = [
  /\b\d+(\.\d+)?\s?(mg|mcg|µg|ug|g|iu|ml)\b/i,
  /\b\d+(\.\d+)?\s?%\s?dv\b/i,
  /\b(once|twice|\d+\s?times?)\s(daily|per day)\b/i,
  /\b(serving size|servings per container)\b/i,
  /\b(dose|dosage)\b.{0,12}\b\d+\b/i,
  /\b(adults?|children|population)\b.{0,24}\b\d+\b/i,
  /\b(capsule|tablet|softgel|drop)s?\b.{0,12}\b\d+\b/i,
  /\b(upper limit|ul|interaction|contraindication|watch-?out|risk|warning|pregnan)\b/i,
];

const TEMPLATE_ONLY_PATTERNS = [
  /^follow (the )?(package|product|bottle)?\s?label/i,
  /^use (the )?(package|product|bottle)?\s?label/i,
  /^scan (the )?(supplement facts|directions|label)/i,
  /^consult (a )?clinician/i,
  /\blimited mode\b/i,
  /\bgeneral watch-?outs?\b/i,
  /\bnext step\b/i,
  /\bsource fact\b/i,
];

const PLACEHOLDER_PATTERNS = [
  /\bnot provided\b/i,
  /\bnot available\b/i,
  /\bpending\b/i,
  /\bunknown\b/i,
  /\blimited\b/i,
  /\bno specific warning text\b/i,
  /\bwarning fields were empty\b/i,
  /\bdose not confirmed\b/i,
];

const FREQUENCY_REGEX = /\b(once|twice|\d+\s?times?)\s(daily|per day)\b/i;

export const REGULATORY_RICH_FAIL_REASONS = Object.freeze({
  MISSING_DOSE_SIGNALS: "MISSING_DOSE_SIGNALS",
  MISSING_USAGE_STRUCTURE: "MISSING_USAGE_STRUCTURE",
  MISSING_SAFETY_SIGNALS: "MISSING_SAFETY_SIGNALS",
  SCORE_NOT_VISIBLE: "SCORE_NOT_VISIBLE",
  ONLY_FALLBACK_TEMPLATES: "ONLY_FALLBACK_TEMPLATES",
});

export const REGULATORY_CONSISTENCY_FAIL_REASONS = Object.freeze({
  COVER_DETAIL_INCONSISTENT: "COVER_DETAIL_INCONSISTENT",
  PARSER_GAP_VISIBLE: "PARSER_GAP_VISIBLE",
});

export const UL_COVERAGE_MISS_REASONS = Object.freeze({
  NO_UL_CANDIDATE: "NO_UL_CANDIDATE",
  MISSING_CURRENT_DAILY_AMOUNT: "MISSING_CURRENT_DAILY_AMOUNT",
  UNIT_NOT_CONVERTIBLE: "UNIT_NOT_CONVERTIBLE",
  NUTRIENT_ALIAS_MISS: "NUTRIENT_ALIAS_MISS",
  MULTI_INGREDIENT_AMBIGUOUS: "MULTI_INGREDIENT_AMBIGUOUS",
});

export const UL_COVERAGE_MISS_SUBREASONS = Object.freeze({
  TRUE_ALIAS_MISS: "TRUE_ALIAS_MISS",
  NO_UL_CANDIDATE_CONFIRMED: "NO_UL_CANDIDATE_CONFIRMED",
  NO_UL_CANDIDATE_LIKELY: "NO_UL_CANDIDATE_LIKELY",
});

export const UL_CANDIDATE_SOURCES = Object.freeze({
  SCORE: "score",
  DETERMINISTIC: "deterministic",
  MIXED: "mixed",
  NONE: "none",
});

export const UL_NO_CANDIDATE_CLASSES = Object.freeze({
  NO_UL_ESTABLISHED: "no_ul_established",
  ALIAS_OR_MAPPING_GAP: "alias_or_mapping_gap",
  UNKNOWN: "unknown",
});

export const REGULATORY_RICH_REASON_PRIORITY = [
  REGULATORY_RICH_FAIL_REASONS.ONLY_FALLBACK_TEMPLATES,
  REGULATORY_RICH_FAIL_REASONS.MISSING_DOSE_SIGNALS,
  REGULATORY_RICH_FAIL_REASONS.MISSING_USAGE_STRUCTURE,
  REGULATORY_RICH_FAIL_REASONS.MISSING_SAFETY_SIGNALS,
  REGULATORY_RICH_FAIL_REASONS.SCORE_NOT_VISIBLE,
];

export const moduleKeyForRegulatoryReason = (reason) => {
  switch (String(reason || "").toUpperCase()) {
    case REGULATORY_RICH_FAIL_REASONS.MISSING_DOSE_SIGNALS:
      return "science";
    case REGULATORY_RICH_FAIL_REASONS.MISSING_USAGE_STRUCTURE:
      return "usage";
    case REGULATORY_RICH_FAIL_REASONS.MISSING_SAFETY_SIGNALS:
      return "safety";
    case REGULATORY_RICH_FAIL_REASONS.SCORE_NOT_VISIBLE:
      return "score";
    case REGULATORY_RICH_FAIL_REASONS.ONLY_FALLBACK_TEMPLATES:
      return "overview";
    default:
      return "overview";
  }
};

export const countScoreUlEntries = (scoreInfo) => {
  const scoreBundle = unwrapScoreBundle(scoreInfo);
  if (!scoreBundle || typeof scoreBundle !== "object") return 0;
  const explain = scoreBundle.explain;
  if (!explain || typeof explain !== "object") return 0;
  const rootWarnings = explain.ulWarnings;
  if (Array.isArray(rootWarnings)) return rootWarnings.length;
  if (rootWarnings && typeof rootWarnings === "object" && Array.isArray(rootWarnings.entries)) {
    return rootWarnings.entries.length;
  }
  const safetyWarnings = explain.safety?.ulWarnings;
  if (Array.isArray(safetyWarnings)) return safetyWarnings.length;
  if (safetyWarnings && typeof safetyWarnings === "object" && Array.isArray(safetyWarnings.entries)) {
    return safetyWarnings.entries.length;
  }
  return 0;
};

export const hasScoreAvailable = (scoreInfo) => {
  const scoreBundle = unwrapScoreBundle(scoreInfo);
  if (!scoreBundle || typeof scoreBundle !== "object") return false;
  if (Number.isFinite(Number(scoreBundle.overallScore))) return true;
  const pillars = scoreBundle.pillars;
  if (!pillars || typeof pillars !== "object") return false;
  return ["effectiveness", "safety", "integrity", "value"].some((key) =>
    Number.isFinite(Number(pillars[key])),
  );
};

const countSafetySignalArray = (value) => (Array.isArray(value) ? value.length : 0);

const parseNumericAmount = (value) => {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (value && typeof value === "object") {
    const parsed = Number(value.value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  const text = normalizeText(value);
  if (!text) return null;
  const match = text.match(/(-?\d+(?:\.\d+)?)/);
  if (!match) return null;
  const parsed = Number(match[1]);
  return Number.isFinite(parsed) ? parsed : null;
};

const normalizeNutrientKey = (row) => {
  const raw =
    normalizeText(row?.ingredientCanonicalKey)
    || normalizeText(row?.nutrientKey)
    || normalizeText(row?.canonicalKey)
    || normalizeText(row?.displayName)
    || normalizeText(row?.ingredient)
    || normalizeText(row?.ingredientName)
    || normalizeText(row?.name);
  if (!raw) return "unknown_nutrient";
  return raw
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 80) || "unknown_nutrient";
};

const extractScoreExplain = (scoreInfo) => {
  const scoreBundle = unwrapScoreBundle(scoreInfo);
  if (!scoreBundle || typeof scoreBundle !== "object") return null;
  const explain = scoreBundle.explain;
  return explain && typeof explain === "object" ? explain : null;
};

const extractScoreUlRows = (scoreInfo) => {
  const explain = extractScoreExplain(scoreInfo);
  if (!explain) return [];
  const rootWarnings = explain.ulWarnings;
  if (Array.isArray(rootWarnings)) return rootWarnings;
  if (rootWarnings && typeof rootWarnings === "object" && Array.isArray(rootWarnings.entries)) {
    return rootWarnings.entries;
  }
  const safetyWarnings = explain.safety?.ulWarnings;
  if (Array.isArray(safetyWarnings)) return safetyWarnings;
  if (safetyWarnings && typeof safetyWarnings === "object" && Array.isArray(safetyWarnings.entries)) {
    return safetyWarnings.entries;
  }
  return [];
};

const extractScoreDoseSignals = (scoreInfo) => {
  const explain = extractScoreExplain(scoreInfo);
  if (!explain || !explain.evidence || typeof explain.evidence !== "object") return [];
  const rows = explain.evidence.ingredientDoseSignals;
  return Array.isArray(rows) ? rows : [];
};

const extractUlMissingReasonCounts = (scoreInfo) => {
  const explain = extractScoreExplain(scoreInfo);
  if (!explain) {
    return {
      noUlEstablished: 0,
      canonicalAliasMiss: 0,
      unitConversionUncertain: 0,
      legacyFallbackUsed: 0,
    };
  }
  const ulWarnings = explain.ulWarnings;
  const missing = ulWarnings && typeof ulWarnings === "object" ? ulWarnings.missingReasonCounts : null;
  return {
    noUlEstablished: Number(missing?.noUlEstablished ?? 0) || 0,
    canonicalAliasMiss: Number(missing?.canonicalAliasMiss ?? 0) || 0,
    unitConversionUncertain: Number(missing?.unitConversionUncertain ?? 0) || 0,
    legacyFallbackUsed: Number(missing?.legacyFallbackUsed ?? 0) || 0,
  };
};

const deriveUlCoverageStats = ({ analysisBundle, scoreInfo }) => {
  const safetySignalsRaw =
    analysisBundle?.sections?.safety?.signals && typeof analysisBundle.sections.safety.signals === "object"
      ? analysisBundle.sections.safety.signals
      : null;
  const packUlEntriesCount = countSafetySignalArray(safetySignalsRaw?.ulEntries);
  const packUlSignalsCount = countSafetySignalArray(safetySignalsRaw?.ulSignals);
  const deterministicUlRows = [
    ...(Array.isArray(safetySignalsRaw?.ulEntries) ? safetySignalsRaw.ulEntries : []),
    ...(Array.isArray(safetySignalsRaw?.ulSignals) ? safetySignalsRaw.ulSignals : []),
  ];
  const scoreUlRows = extractScoreUlRows(scoreInfo);
  const doseSignals = extractScoreDoseSignals(scoreInfo);
  const missingReasonCounts = extractUlMissingReasonCounts(scoreInfo);

  const producedFromRows = scoreUlRows.filter((row) => {
    if (!row || typeof row !== "object") return false;
    const currentAmount = parseNumericAmount(row.currentDailyAmount ?? row.currentDose ?? row.dailyAmount ?? row.dose);
    const ulAmount = parseNumericAmount(row.ulDailyAmount ?? row.ulLimit ?? row.upperLimit ?? row.limit);
    return currentAmount != null && ulAmount != null;
  }).length;
  const ulProducedCount = packUlEntriesCount > 0 ? packUlEntriesCount : producedFromRows;

  const scoreCandidateKeys = new Set();
  const deterministicCandidateKeys = new Set();
  let scoreRowUnitNotConvertibleCount = 0;
  for (const row of scoreUlRows) {
    if (!row || typeof row !== "object") continue;
    const key = normalizeNutrientKey(row);
    if (key) scoreCandidateKeys.add(key);
    const reasonCode = normalizeText(row.reasonCode || row.reason).toUpperCase();
    if (reasonCode === "UNIT_CONVERSION_UNCERTAIN") scoreRowUnitNotConvertibleCount += 1;
  }
  for (const row of deterministicUlRows) {
    if (!row || typeof row !== "object") continue;
    const key = normalizeNutrientKey(row);
    if (key) deterministicCandidateKeys.add(key);
  }
  const scoreCandidateCount = scoreCandidateKeys.size;
  const deterministicCandidateCount = deterministicCandidateKeys.size;
  const ulCandidateCount = scoreCandidateCount > 0 ? scoreCandidateCount : deterministicCandidateCount;
  const ulCandidateSource =
    scoreCandidateCount > 0 && deterministicCandidateCount > 0
      ? UL_CANDIDATE_SOURCES.MIXED
      : scoreCandidateCount > 0
        ? UL_CANDIDATE_SOURCES.SCORE
        : deterministicCandidateCount > 0
          ? UL_CANDIDATE_SOURCES.DETERMINISTIC
          : UL_CANDIDATE_SOURCES.NONE;
  const ulReferenceFromDeterministic =
    scoreCandidateCount === 0
    && (deterministicCandidateCount > 0 || packUlSignalsCount > 0);

  const doseSignalMissingDaily = doseSignals.filter((row) => {
    if (!row || typeof row !== "object") return false;
    return parseNumericAmount(row.dailyAmount) == null;
  }).length;
  const doseSignalUniqueIngredients = new Set(
    doseSignals
      .map((row) => normalizeText(row?.ingredientName || row?.ingredient || row?.name).toLowerCase())
      .filter(Boolean),
  ).size;

  const ulMissReasonCounts = {
    [UL_COVERAGE_MISS_REASONS.NO_UL_CANDIDATE]:
      ulCandidateCount === 0 && ulProducedCount === 0 ? 1 : 0,
    [UL_COVERAGE_MISS_REASONS.MISSING_CURRENT_DAILY_AMOUNT]:
      ulProducedCount === 0 ? doseSignalMissingDaily : 0,
    [UL_COVERAGE_MISS_REASONS.UNIT_NOT_CONVERTIBLE]:
      ulProducedCount === 0 ? Math.max(scoreRowUnitNotConvertibleCount, missingReasonCounts.unitConversionUncertain) : 0,
    [UL_COVERAGE_MISS_REASONS.NUTRIENT_ALIAS_MISS]:
      ulProducedCount === 0 ? missingReasonCounts.canonicalAliasMiss : 0,
    [UL_COVERAGE_MISS_REASONS.MULTI_INGREDIENT_AMBIGUOUS]:
      ulProducedCount === 0 && doseSignalUniqueIngredients > 1 && doseSignalMissingDaily > 0 ? 1 : 0,
  };

  const ulMissReasonSubCounts = {
    [UL_COVERAGE_MISS_SUBREASONS.TRUE_ALIAS_MISS]: 0,
    [UL_COVERAGE_MISS_SUBREASONS.NO_UL_CANDIDATE_CONFIRMED]: 0,
    [UL_COVERAGE_MISS_SUBREASONS.NO_UL_CANDIDATE_LIKELY]: 0,
  };
  const aliasMissCount = Math.max(0, Number(missingReasonCounts.canonicalAliasMiss || 0));
  const noUlEstablishedCount = Math.max(0, Number(missingReasonCounts.noUlEstablished || 0));

  let ulMissReasonTop = null;
  let ulMissReasonSubTop = null;
  let ulNoCandidateClass = null;
  if (ulProducedCount <= 0) {
    const rank = [
      UL_COVERAGE_MISS_REASONS.UNIT_NOT_CONVERTIBLE,
      UL_COVERAGE_MISS_REASONS.NUTRIENT_ALIAS_MISS,
      UL_COVERAGE_MISS_REASONS.MISSING_CURRENT_DAILY_AMOUNT,
      UL_COVERAGE_MISS_REASONS.MULTI_INGREDIENT_AMBIGUOUS,
      UL_COVERAGE_MISS_REASONS.NO_UL_CANDIDATE,
    ];
    for (const key of rank) {
      if (Number(ulMissReasonCounts[key] || 0) > 0) {
        ulMissReasonTop = key;
        break;
      }
    }
    if (ulMissReasonTop === UL_COVERAGE_MISS_REASONS.NUTRIENT_ALIAS_MISS && ulCandidateCount === 0) {
      ulMissReasonTop = UL_COVERAGE_MISS_REASONS.NO_UL_CANDIDATE;
      ulMissReasonCounts[UL_COVERAGE_MISS_REASONS.NO_UL_CANDIDATE] = Math.max(
        Number(ulMissReasonCounts[UL_COVERAGE_MISS_REASONS.NO_UL_CANDIDATE] || 0),
        aliasMissCount || 1,
      );
      ulMissReasonCounts[UL_COVERAGE_MISS_REASONS.NUTRIENT_ALIAS_MISS] = 0;
    }

    if (aliasMissCount > 0 && ulCandidateCount > 0) {
      ulMissReasonSubCounts[UL_COVERAGE_MISS_SUBREASONS.TRUE_ALIAS_MISS] = aliasMissCount;
      ulMissReasonSubTop = UL_COVERAGE_MISS_SUBREASONS.TRUE_ALIAS_MISS;
    } else if (ulCandidateCount === 0) {
      const confirmed = noUlEstablishedCount > 0 || aliasMissCount === 0;
      ulMissReasonSubTop = confirmed
        ? UL_COVERAGE_MISS_SUBREASONS.NO_UL_CANDIDATE_CONFIRMED
        : UL_COVERAGE_MISS_SUBREASONS.NO_UL_CANDIDATE_LIKELY;
      ulMissReasonSubCounts[ulMissReasonSubTop] = 1;
    }
    if (!ulMissReasonTop) {
      ulMissReasonTop =
        ulCandidateCount > 0
          ? UL_COVERAGE_MISS_REASONS.MISSING_CURRENT_DAILY_AMOUNT
          : UL_COVERAGE_MISS_REASONS.NO_UL_CANDIDATE;
    }
    if (ulCandidateCount === 0) {
      ulNoCandidateClass = noUlEstablishedCount > 0
        ? UL_NO_CANDIDATE_CLASSES.NO_UL_ESTABLISHED
        : aliasMissCount > 0
          ? UL_NO_CANDIDATE_CLASSES.ALIAS_OR_MAPPING_GAP
          : UL_NO_CANDIDATE_CLASSES.UNKNOWN;
    }
  }

  return {
    ulCandidateCount,
    ulCandidateSource,
    ulNoCandidateClass,
    ulReferenceFromDeterministic,
    ulProducedCount,
    ulMissReasonTop,
    ulMissReasonCounts,
    ulMissReasonSubTop,
    ulMissReasonSubCounts,
  };
};

export const collectModuleLines = (moduleValue) => {
  if (!moduleValue || typeof moduleValue !== "object") return [];
  const modules = ["overview", "science", "usage", "safety"];
  const lines = [];
  for (const key of modules) {
    const moduleLines = Array.isArray(moduleValue?.[key]?.lines) ? moduleValue[key].lines : [];
    for (const line of moduleLines) {
      const normalized = normalizeText(line);
      if (normalized) lines.push(normalized);
    }
  }
  return lines;
};

export const hasConcreteSignalInLine = (line) => {
  const value = normalizeText(line);
  if (!value) return false;
  return CONCRETE_SIGNAL_PATTERNS.some((pattern) => pattern.test(value));
};

export const isTemplateOnlyLine = (line) => {
  const value = normalizeText(line);
  if (!value) return false;
  return TEMPLATE_ONLY_PATTERNS.some((pattern) => pattern.test(value))
    || PLACEHOLDER_PATTERNS.some((pattern) => pattern.test(value));
};

export const hasOnlyFallbackTemplates = (moduleValue) => {
  const lines = collectModuleLines(moduleValue);
  if (lines.length === 0) return false;

  const concreteCount = lines.filter((line) => hasConcreteSignalInLine(line)).length;
  const fallbackCount = lines.filter((line) => isTemplateOnlyLine(line)).length;

  if (concreteCount > 0) return false;
  return fallbackCount >= Math.max(2, Math.ceil(lines.length * 0.6));
};

export const deriveRegulatoryRichSignals = ({ analysisBundle, scoreInfo, moduleValue }) => {
  const ingredientCoverItems = Array.isArray(analysisBundle?.sections?.ingredients?.cover?.items)
    ? analysisBundle.sections.ingredients.cover.items
    : [];
  const ingredientDetailItems = Array.isArray(analysisBundle?.sections?.ingredients?.detail?.items)
    ? analysisBundle.sections.ingredients.detail.items
    : [];
  const ingredientNames = new Set();
  let doseCount = 0;
  let formEvidenceCount = 0;
  for (const item of ingredientCoverItems) {
    const name = normalizeText(item?.name);
    if (name) ingredientNames.add(name.toLowerCase());
    if (normalizeText(item?.dose)) doseCount += 1;
  }
  for (const item of ingredientDetailItems) {
    const name = normalizeText(item?.name);
    if (name) ingredientNames.add(name.toLowerCase());
    if (normalizeText(item?.doseContext?.text || item?.doseContext)) doseCount += 1;
    if (
      normalizeText(item?.formExplain)
      || normalizeText(item?.chemicalFormExplain?.text || item?.chemicalFormExplain)
      || normalizeText(item?.deliveryFormExplain?.text || item?.deliveryFormExplain)
    ) {
      formEvidenceCount += 1;
    }
  }

  const usageCover = analysisBundle?.sections?.usage?.cover ?? null;
  const usageDetail = analysisBundle?.sections?.usage?.detail ?? null;
  const hasDosage = Boolean(normalizeText(usageCover?.dosage?.text || usageCover?.dosage));
  const usageTextCorpus = [
    normalizeText(usageCover?.bestTimeToTake?.text || usageCover?.bestTimeToTake),
    normalizeText(usageCover?.dosage?.text || usageCover?.dosage),
    ...(Array.isArray(usageCover?.bullets) ? usageCover.bullets.map((entry) => normalizeText(entry?.text || entry)) : []),
  ]
    .filter(Boolean)
    .join(" ");
  const hasFrequency = FREQUENCY_REGEX.test(usageTextCorpus);
  const scheduleFromLabelPresent = Array.isArray(usageDetail?.scheduleFromLabel) && usageDetail.scheduleFromLabel.length > 0;

  const scoreAvailable = hasScoreAvailable(scoreInfo);
  const scoreReasonCode = normalizeText(scoreInfo?.reasonCode || moduleValue?.score?.reasonCode);
  const scoreExplanation = normalizeText(scoreInfo?.message || moduleValue?.score?.explanation);
  const scoreExplainabilityPresent = Boolean(
    scoreReasonCode || scoreExplanation,
  );

  const safetyDetail = analysisBundle?.sections?.safety?.detail ?? null;
  const safetySignalsRaw =
    analysisBundle?.sections?.safety?.signals && typeof analysisBundle.sections.safety.signals === "object"
      ? analysisBundle.sections.safety.signals
      : null;
  const safetySignalPackPresent = Boolean(safetySignalsRaw);
  const packLabelWarningsCount = countSafetySignalArray(safetySignalsRaw?.labelWarnings);
  const packUlEntriesCount = countSafetySignalArray(safetySignalsRaw?.ulEntries);
  const packUlSignalsCount = countSafetySignalArray(safetySignalsRaw?.ulSignals);
  const packOdsInteractionsCount = countSafetySignalArray(safetySignalsRaw?.odsInteractions);
  const packOdsWatchoutsCount = countSafetySignalArray(safetySignalsRaw?.odsWatchouts);

  const fallbackLabelWarningsCount = Array.isArray(safetyDetail?.warnings) ? safetyDetail.warnings.length : 0;
  const consultDoctorCount = Array.isArray(safetyDetail?.consultDoctorIf) ? safetyDetail.consultDoctorIf.length : 0;
  const redFlagsCount = Array.isArray(safetyDetail?.redFlags) ? safetyDetail.redFlags.length : 0;
  const fallbackOdsInteractionsCount = consultDoctorCount + redFlagsCount;

  const labelWarningsCount = safetySignalPackPresent ? packLabelWarningsCount : fallbackLabelWarningsCount;
  const ulEntriesCount = safetySignalPackPresent
    ? (packUlEntriesCount || packUlSignalsCount || countScoreUlEntries(scoreInfo))
    : countScoreUlEntries(scoreInfo);
  const odsInteractionsCount = safetySignalPackPresent ? packOdsInteractionsCount : fallbackOdsInteractionsCount;
  const odsWatchoutsCount = safetySignalPackPresent ? packOdsWatchoutsCount : fallbackOdsInteractionsCount;

  const sciencePass = ingredientNames.size >= 1 && doseCount >= 1;
  const usagePass = hasDosage || hasFrequency || scheduleFromLabelPresent;
  const scorePass = scoreAvailable || scoreExplainabilityPresent;
  const safetyPass = labelWarningsCount > 0 || ulEntriesCount > 0 || odsInteractionsCount > 0;
  const safetySignalOrigin =
    labelWarningsCount > 0
      ? "label"
      : ulEntriesCount > 0
        ? "ul"
        : odsInteractionsCount > 0
          ? "ods"
          : "none";
  const missingSafetyKinds = safetyPass
    ? []
    : [
      ...(labelWarningsCount > 0 ? [] : ["label"]),
      ...(odsInteractionsCount > 0 ? [] : ["ods"]),
      ...(ulEntriesCount > 0 ? [] : ["ul"]),
    ];
  const onlyFallbackTemplates = hasOnlyFallbackTemplates(moduleValue);
  const ulCoverageStats = deriveUlCoverageStats({ analysisBundle, scoreInfo });
  const deterministicSignalsMeta =
    analysisBundle?.meta?.deterministicSignals && typeof analysisBundle.meta.deterministicSignals === "object"
      ? analysisBundle.meta.deterministicSignals
      : null;
  const deterministicSignalCounts = {
    ingredientCount: Number(deterministicSignalsMeta?.ingredientCount ?? 0) || 0,
    doseCount: Number(deterministicSignalsMeta?.doseCount ?? 0) || 0,
    usageStructuredCount: Number(deterministicSignalsMeta?.usageStructuredCount ?? 0) || 0,
    safetySignalCount: Number(deterministicSignalsMeta?.safetySignalCount ?? 0) || 0,
  };

  const expectedIngredientCount = Math.max(ingredientNames.size, deterministicSignalCounts.ingredientCount);
  const ruleCoverHasIngredientsWhenExpected =
    expectedIngredientCount === 0 || ingredientCoverItems.length > 0;
  const usageExpectedStructured =
    deterministicSignalCounts.usageStructuredCount > 0
    || deterministicSignalCounts.doseCount > 0
    || hasDosage;
  const ruleUsageShowsStructuredWhenExpected =
    !usageExpectedStructured || hasDosage || hasFrequency || scheduleFromLabelPresent;
  const safetyVisibleLineCount =
    (Array.isArray(analysisBundle?.sections?.safety?.cover?.bullets)
      ? analysisBundle.sections.safety.cover.bullets.length
      : 0)
    + (Array.isArray(safetyDetail?.warnings) ? safetyDetail.warnings.length : 0)
    + (Array.isArray(safetyDetail?.consultDoctorIf) ? safetyDetail.consultDoctorIf.length : 0)
    + (Array.isArray(safetyDetail?.redFlags) ? safetyDetail.redFlags.length : 0);
  const safetySignalsTotal =
    labelWarningsCount + ulEntriesCount + odsInteractionsCount + odsWatchoutsCount;
  const ruleSafetyVisibleWhenSignalsPresent =
    safetySignalsTotal === 0 || safetyVisibleLineCount > 0;
  const coverDetailConsistencyPass =
    ruleCoverHasIngredientsWhenExpected
    && ruleUsageShowsStructuredWhenExpected
    && ruleSafetyVisibleWhenSignalsPresent;
  const consistencyFailReason = !ruleCoverHasIngredientsWhenExpected
    ? REGULATORY_CONSISTENCY_FAIL_REASONS.COVER_DETAIL_INCONSISTENT
    : !ruleUsageShowsStructuredWhenExpected
      ? REGULATORY_CONSISTENCY_FAIL_REASONS.PARSER_GAP_VISIBLE
      : !ruleSafetyVisibleWhenSignalsPresent
        ? REGULATORY_CONSISTENCY_FAIL_REASONS.COVER_DETAIL_INCONSISTENT
        : null;

  return {
    ingredientCount: ingredientNames.size,
    doseCount,
    formEvidenceCount,
    hasDosage,
    hasFrequency,
    scheduleFromLabelPresent,
    scoreAvailable,
    scoreReasonCode: scoreReasonCode || null,
    scoreExplanation: scoreExplanation || null,
    scoreExplainabilityPresent,
    labelWarningsCount,
    odsInteractionsCount,
    odsWatchoutsCount,
    ulEntriesCount,
    ulCandidateCount: ulCoverageStats.ulCandidateCount,
    ulCandidateSource: ulCoverageStats.ulCandidateSource,
    ulNoCandidateClass: ulCoverageStats.ulNoCandidateClass,
    ulReferenceFromDeterministic: ulCoverageStats.ulReferenceFromDeterministic,
    ulProducedCount: ulCoverageStats.ulProducedCount,
    ulMissReasonTop: ulCoverageStats.ulMissReasonTop,
    ulMissReasonCounts: ulCoverageStats.ulMissReasonCounts,
    ulMissReasonSubTop: ulCoverageStats.ulMissReasonSubTop,
    ulMissReasonSubCounts: ulCoverageStats.ulMissReasonSubCounts,
    safetySignalPackPresent,
    safetySignalOrigin,
    missingSafetyKinds,
    deterministicSignalCounts,
    coverDetailConsistencyPass,
    consistencyFailReason,
    consistencyChecks: {
      ruleCoverHasIngredientsWhenExpected,
      ruleUsageShowsStructuredWhenExpected,
      ruleSafetyVisibleWhenSignalsPresent,
    },
    sciencePass,
    usagePass,
    scorePass,
    safetyPass,
    onlyFallbackTemplates,
    pass: sciencePass && usagePass && scorePass && safetyPass,
  };
};

export const deriveRegulatoryRichFailure = ({ signals }) => {
  if (!signals || typeof signals !== "object" || signals.pass === true) {
    return { reasons: [], primaryReason: null, missingSafetyKinds: [] };
  }
  const reasons = [];
  if (signals.onlyFallbackTemplates) {
    reasons.push(REGULATORY_RICH_FAIL_REASONS.ONLY_FALLBACK_TEMPLATES);
  }
  if (!signals.sciencePass) {
    reasons.push(REGULATORY_RICH_FAIL_REASONS.MISSING_DOSE_SIGNALS);
  }
  if (!signals.usagePass) {
    reasons.push(REGULATORY_RICH_FAIL_REASONS.MISSING_USAGE_STRUCTURE);
  }
  if (!signals.safetyPass) {
    reasons.push(REGULATORY_RICH_FAIL_REASONS.MISSING_SAFETY_SIGNALS);
  }
  if (!signals.scorePass) {
    reasons.push(REGULATORY_RICH_FAIL_REASONS.SCORE_NOT_VISIBLE);
  }
  const sorted = [...new Set(reasons)].sort(
    (a, b) => REGULATORY_RICH_REASON_PRIORITY.indexOf(a) - REGULATORY_RICH_REASON_PRIORITY.indexOf(b),
  );
  const missingSafetyKinds = Array.isArray(signals.missingSafetyKinds)
    ? signals.missingSafetyKinds
      .map((value) => String(value || "").toLowerCase())
      .filter((value) => value === "label" || value === "ods" || value === "ul")
    : [];
  return {
    reasons: sorted,
    primaryReason: sorted[0] ?? null,
    missingSafetyKinds:
      sorted.includes(REGULATORY_RICH_FAIL_REASONS.MISSING_SAFETY_SIGNALS)
        ? [...new Set(missingSafetyKinds)]
        : [],
  };
};
