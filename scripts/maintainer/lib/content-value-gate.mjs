/* eslint-disable no-control-regex */

const PLACEHOLDER_PATTERNS = [
  /\bnot provided\b/i,
  /\bnot available\b/i,
  /\bproduct not found\b/i,
  /\bpending\b/i,
  /\bskeleton\b/i,
  /\binsights pending\b/i,
  /\bscoring\.\.\.\b/i,
  /^\s*(n\/a|na|null|undefined|none|unknown)\s*$/i,
];

const GENERIC_ONLY_PATTERNS = [
  /^follow the product label/i,
  /^use the product label/i,
  /^consult (a )?clinician/i,
  /^scan (the )?(supplement facts|directions|label)/i,
  /^this section summarizes/i,
  /^built from/i,
  /^general watch-?outs?/i,
];

const CONCRETE_SIGNAL_PATTERNS = [
  /\b\d+(\.\d+)?\s?(mg|mcg|µg|g|iu|ml)\b/i,
  /\b(once|twice|\d+\s?times?)\s(daily|per day)\b/i,
  /\b(capsule|tablet|softgel|drop|serving|dose|dosage)\b/i,
  /\b(upper limit|ul|interaction|contraindication|watch-?out|risk|warning)\b/i,
  /\b(vitamin|zinc|magnesium|omega|probiotic|biotin|calcium|iron)\b/i,
  /\b(npn|dsld|upc|gtin)\b/i,
  /\b(active ingredients?|ingredient listing status|label warning fields)\b/i,
];

const NEXT_STEP_PATTERNS = [
  /\bretry\b/i,
  /\bscan\b/i,
  /\bfollow\b/i,
  /\bconsult\b/i,
  /\bcheck\b/i,
  /\bconfirm\b/i,
];

const UL_HINT_PATTERNS = [
  /\bupper limit\b/i,
  /\bul\b/i,
  /\bods\b/i,
  /\blimit\b/i,
  /\brisk\b/i,
];
const VERIFIED_CLAIM_PATTERNS = [
  /\bbased on verified\b/i,
  /\bverified (source|record|records|data|facts|regulatory|label)\b/i,
  /\bsource:\s*verified\b/i,
];
const VERIFIED_NEGATION_PATTERNS = [
  /\bunverified\b/i,
  /\bnot verified\b/i,
  /\bwithout verified\b/i,
  /\blimited confidence\b/i,
];

export const CONTENT_VALUE_FAIL_REASONS = Object.freeze({
  OVERVIEW_TOO_GENERIC: "OVERVIEW_TOO_GENERIC",
  SCIENCE_NO_INGREDIENTS: "SCIENCE_NO_INGREDIENTS",
  SCIENCE_NO_CONCRETE_SIGNAL: "SCIENCE_NO_CONCRETE_SIGNAL",
  USAGE_NO_DOSE_OR_FREQUENCY: "USAGE_NO_DOSE_OR_FREQUENCY",
  SAFETY_ONLY_GENERIC_ADVICE: "SAFETY_ONLY_GENERIC_ADVICE",
  SCORE_NO_SCORE_AND_NO_EXPLANATION: "SCORE_NO_SCORE_AND_NO_EXPLANATION",
  DEGRADED_NO_REASON: "DEGRADED_NO_REASON",
  DEGRADED_NO_NEXT_STEP: "DEGRADED_NO_NEXT_STEP",
  UL_PRESENT_BUT_NOT_SHOWN: "UL_PRESENT_BUT_NOT_SHOWN",
  UNVERIFIED_HAS_VERIFIED_LANGUAGE: "UNVERIFIED_HAS_VERIFIED_LANGUAGE",
});

const normalizeText = (value) => (typeof value === "string" ? value.trim() : "");

const pushLine = (target, value) => {
  const text = normalizeText(value);
  if (!text) return;
  target.push(text);
};

const pushUsageField = (target, value) => {
  if (!value) return;
  if (typeof value === "string") {
    pushLine(target, value);
    return;
  }
  if (typeof value === "object" && typeof value.text === "string") {
    pushLine(target, value.text);
  }
};

const pushBulletLines = (target, bullets) => {
  if (!Array.isArray(bullets)) return;
  for (const row of bullets) {
    if (typeof row === "string") {
      pushLine(target, row);
      continue;
    }
    if (row && typeof row === "object") {
      pushLine(target, row.text);
    }
  }
};

const dedupeLines = (lines) => {
  const seen = new Set();
  const out = [];
  for (const raw of lines) {
    const text = normalizeText(raw);
    if (!text) continue;
    const key = text.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(text);
  }
  return out;
};

const isPlaceholderLike = (line) =>
  PLACEHOLDER_PATTERNS.some((pattern) => pattern.test(line));

const hasConcreteSignalByText = (line) =>
  CONCRETE_SIGNAL_PATTERNS.some((pattern) => pattern.test(line));

const isGenericOnlyLine = (line) =>
  GENERIC_ONLY_PATTERNS.some((pattern) => pattern.test(line));

const isMeaningfulLine = (line) => {
  if (isPlaceholderLike(line)) return false;
  if (isGenericOnlyLine(line) && !hasConcreteSignalByText(line)) return false;
  return true;
};

const moduleResult = ({ lines, structuredConcrete, failReasonOnLow, failReasonOnSignal }) => {
  const deduped = dedupeLines(lines);
  const meaningfulLines = deduped.filter(isMeaningfulLine);
  const hasConcreteSignal = Boolean(structuredConcrete) || deduped.some(hasConcreteSignalByText);
  const failReasons = [];

  if (meaningfulLines.length < 2) {
    failReasons.push(failReasonOnLow);
  }
  if (!hasConcreteSignal) {
    failReasons.push(failReasonOnSignal);
  }

  return {
    pass: failReasons.length === 0,
    lineCount: deduped.length,
    meaningfulLineCount: meaningfulLines.length,
    hasConcreteSignal,
    failReasons,
    lines: deduped,
  };
};

const collectOverview = (bundle, context) => {
  const lines = [];
  const overview = bundle?.sections?.overview ?? null;
  pushLine(lines, overview?.cover?.summary);
  pushBulletLines(lines, overview?.cover?.bullets);
  pushLine(lines, overview?.detail?.summary);
  pushBulletLines(lines, overview?.detail?.bullets);
  if (context.degradedMode) {
    pushLine(lines, toDegradedReasonLine(context.terminalReason));
  }
  const sourceFallbackLines = [
    toSourceFactLine(context.sourceAttribution),
    toActionLine(context.sourceAttribution),
  ];
  const linesWithFallback = ensureMinimumLines(lines, sourceFallbackLines, 2);
  const structuredConcrete =
    normalizeText(overview?.cover?.summary).length > 0 ||
    (Array.isArray(overview?.cover?.bullets) && overview.cover.bullets.length > 0);
  return moduleResult({
    lines: linesWithFallback,
    structuredConcrete,
    failReasonOnLow: CONTENT_VALUE_FAIL_REASONS.OVERVIEW_TOO_GENERIC,
    failReasonOnSignal: CONTENT_VALUE_FAIL_REASONS.OVERVIEW_TOO_GENERIC,
  });
};

const collectScience = (bundle, context) => {
  const lines = [];
  const ingredients = bundle?.sections?.ingredients ?? null;
  const coverItems = Array.isArray(ingredients?.cover?.items) ? ingredients.cover.items : [];
  for (const item of coverItems) {
    if (!item || typeof item !== "object") continue;
    const name = normalizeText(item.name);
    const dose = normalizeText(item.dose);
    if (!name) continue;
    pushLine(lines, dose ? `${name}: ${dose}` : name);
  }

  const detailItems = Array.isArray(ingredients?.detail?.items) ? ingredients.detail.items : [];
  for (const item of detailItems) {
    if (!item || typeof item !== "object") continue;
    pushLine(lines, item.name);
    pushUsageField(lines, item.whatItDoes);
    pushUsageField(lines, item.doseContext);
    pushUsageField(lines, item.chemicalFormExplain);
    pushUsageField(lines, item.deliveryFormExplain);
    pushLine(lines, item.formExplain);
  }
  pushUsageField(lines, ingredients?.detail?.overallSummary);
  pushUsageField(lines, ingredients?.detail?.overlapNotes);
  if (coverItems.length === 0 && detailItems.length === 0) {
    pushLine(lines, "Ingredient listing status: active ingredients and doses were not listed in this source.");
    pushLine(lines, "Scan Supplement Facts to capture ingredient names, forms, and dose values.");
  }
  if (context.degradedMode) {
    pushLine(lines, toDegradedReasonLine(context.terminalReason));
    pushLine(lines, toActionLine(context.sourceAttribution));
  }

  const linesWithFallback = ensureMinimumLines(lines, [
    "Science fact: ingredient names or dose values were limited in this record.",
    toActionLine(context.sourceAttribution),
  ], 2);

  const structuredConcrete = coverItems.length > 0 || detailItems.length > 0;
  const result = moduleResult({
    lines: linesWithFallback,
    structuredConcrete: structuredConcrete || linesWithFallback.some(hasConcreteSignalByText),
    failReasonOnLow: CONTENT_VALUE_FAIL_REASONS.SCIENCE_NO_INGREDIENTS,
    failReasonOnSignal: CONTENT_VALUE_FAIL_REASONS.SCIENCE_NO_CONCRETE_SIGNAL,
  });

  // Normalize fail reason order for science.
  const uniqueReasons = new Set(result.failReasons);
  return {
    ...result,
    failReasons: Array.from(uniqueReasons),
  };
};

const collectUsage = (bundle, context) => {
  const lines = [];
  const usage = bundle?.sections?.usage ?? null;
  pushUsageField(lines, usage?.cover?.bestTimeToTake);
  pushUsageField(lines, usage?.cover?.dosage);
  pushBulletLines(lines, usage?.cover?.bullets);
  pushUsageField(lines, usage?.detail?.timingRationale);
  pushUsageField(lines, usage?.detail?.withFoodRationale);
  const schedule = Array.isArray(usage?.detail?.scheduleFromLabel) ? usage.detail.scheduleFromLabel : [];
  for (const row of schedule) {
    if (!row || typeof row !== "object") continue;
    const parts = [normalizeText(row.population), normalizeText(row.age), normalizeText(row.dose), normalizeText(row.frequency)]
      .filter(Boolean);
    if (parts.length) pushLine(lines, parts.join(" "));
    pushLine(lines, row.rawText);
  }
  const dosageText = normalizeText(usage?.cover?.dosage?.text ?? usage?.cover?.dosage);
  const bestTimeText = normalizeText(usage?.cover?.bestTimeToTake?.text ?? usage?.cover?.bestTimeToTake);
  if (!dosageText && !bestTimeText && schedule.length === 0) {
    pushLine(lines, "Dosage directions were not listed in this source record.");
    pushLine(lines, "Follow bottle label dose and frequency guidance, then rescan Directions for a precise plan.");
  }
  if (context.ulEntriesCount > 0) {
    pushLine(
      lines,
      `UL guidance: ${context.ulEntriesCount} upper-limit warning signal(s) detected; review total daily intake.`,
    );
  }
  if (context.degradedMode) {
    pushLine(lines, toDegradedReasonLine(context.terminalReason));
    pushLine(lines, toActionLine(context.sourceAttribution));
  }
  const linesWithFallback = ensureMinimumLines(lines, [
    "Usage fact: dosage and frequency should come from the package Directions panel.",
    toActionLine(context.sourceAttribution),
  ], 2);
  const structuredConcrete =
    dosageText.length > 0 ||
    bestTimeText.length > 0 ||
    schedule.length > 0;
  return moduleResult({
    lines: linesWithFallback,
    structuredConcrete: structuredConcrete || linesWithFallback.some(hasConcreteSignalByText),
    failReasonOnLow: CONTENT_VALUE_FAIL_REASONS.USAGE_NO_DOSE_OR_FREQUENCY,
    failReasonOnSignal: CONTENT_VALUE_FAIL_REASONS.USAGE_NO_DOSE_OR_FREQUENCY,
  });
};

const collectSafety = (bundle, context) => {
  const lines = [];
  const safety = bundle?.sections?.safety ?? null;
  pushLine(lines, safety?.cover?.verdict);
  pushBulletLines(lines, safety?.cover?.bullets);
  pushBulletLines(lines, safety?.detail?.warnings);
  pushBulletLines(lines, safety?.detail?.consultDoctorIf);
  pushBulletLines(lines, safety?.detail?.redFlags);
  if (context.ulEntriesCount > 0) {
    pushLine(lines, `UL warning entries detected: ${context.ulEntriesCount}.`);
  }
  if (
    !Array.isArray(safety?.detail?.warnings)
    || safety.detail.warnings.length === 0
  ) {
    pushLine(lines, "Safety warning fields were empty in this source record.");
  }
  if (context.degradedMode) {
    pushLine(lines, toDegradedReasonLine(context.terminalReason));
    pushLine(lines, toActionLine(context.sourceAttribution));
  }
  const linesWithFallback = ensureMinimumLines(lines, [
    "Safety fact: review package warnings before use and stop if adverse symptoms occur.",
    toActionLine(context.sourceAttribution),
  ], 2);

  const structuredConcrete =
    (Array.isArray(safety?.detail?.warnings) && safety.detail.warnings.length > 0) ||
    (Array.isArray(safety?.detail?.redFlags) && safety.detail.redFlags.length > 0) ||
    (Array.isArray(safety?.detail?.consultDoctorIf) && safety.detail.consultDoctorIf.length > 0) ||
    context.ulEntriesCount > 0;

  return moduleResult({
    lines: linesWithFallback,
    structuredConcrete: structuredConcrete || linesWithFallback.some(hasConcreteSignalByText),
    failReasonOnLow: CONTENT_VALUE_FAIL_REASONS.SAFETY_ONLY_GENERIC_ADVICE,
    failReasonOnSignal: CONTENT_VALUE_FAIL_REASONS.SAFETY_ONLY_GENERIC_ADVICE,
  });
};

const scoreHasNumericValue = (scoreInfo) => {
  if (!scoreInfo || typeof scoreInfo !== "object") return false;
  if (Number.isFinite(Number(scoreInfo.overallScore))) return true;
  const pillars = scoreInfo.pillars;
  if (!pillars || typeof pillars !== "object") return false;
  return ["effectiveness", "safety", "integrity", "value"].some((key) =>
    Number.isFinite(Number(pillars[key])),
  );
};

const reasonCodeToExplanation = (reasonCode) => {
  const normalized = normalizeText(reasonCode).toUpperCase();
  if (!normalized) return "";
  if (normalized.includes("DEGRADED_WEB_BUDGET")) return "Showing partial results while web evidence budget is constrained.";
  if (normalized.includes("DEGRADED_EVENTLOOP")) return "Showing partial results while the system is under heavy load.";
  if (normalized.includes("BUNDLE_ONLY_NO_AUTHORITATIVE_MATCH")) return "Showing partial results while authoritative identity matching is still incomplete.";
  if (normalized.includes("SERVER_OVERLOAD")) return "Server is currently busy; retry shortly.";
  if (normalized.includes("WEB_OWNERSHIP_FAILED")) return "Web ownership could not be verified for trusted scoring.";
  if (normalized.includes("NOT_FOUND")) return "Record was not found for this identity path.";
  return "Score is limited right now while required product facts are still being gathered.";
};

const countUlEntries = (scoreInfo) => {
  if (!scoreInfo || typeof scoreInfo !== "object") return 0;
  const explain = scoreInfo.explain;
  if (!explain || typeof explain !== "object") return 0;
  const rootWarnings = explain.ulWarnings;
  if (Array.isArray(rootWarnings)) return rootWarnings.length;
  if (rootWarnings && typeof rootWarnings === "object" && Array.isArray(rootWarnings.entries)) {
    return rootWarnings.entries.length;
  }
  const safetyWarnings = explain.safety?.ulWarnings;
  if (Array.isArray(safetyWarnings)) return safetyWarnings.length;
  return 0;
};

const hasUlShownInUsage = (usageLines) =>
  usageLines.some((line) => UL_HINT_PATTERNS.some((pattern) => pattern.test(line)));

const hasNextStepAction = (lines) =>
  lines.some((line) => NEXT_STEP_PATTERNS.some((pattern) => pattern.test(line)));

const isUnverifiedSource = (sourceAttribution) =>
  sourceAttribution === "web_hint_unverified" || sourceAttribution === "unknown";

const lineClaimsVerified = (line) => {
  const normalized = normalizeText(line);
  if (!normalized) return false;
  if (VERIFIED_NEGATION_PATTERNS.some((pattern) => pattern.test(normalized))) return false;
  return VERIFIED_CLAIM_PATTERNS.some((pattern) => pattern.test(normalized));
};

const containsVerifiedLanguage = (lines) =>
  lines.some((line) => lineClaimsVerified(line));

const dedupeAppend = (target, values) => {
  if (!Array.isArray(values)) return target;
  const seen = new Set(target.map((line) => normalizeText(line).toLowerCase()).filter(Boolean));
  for (const value of values) {
    const text = normalizeText(value);
    if (!text) continue;
    const key = text.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    target.push(text);
  }
  return target;
};

const ensureMinimumLines = (lines, fallbackLines, minCount = 2) => {
  const out = dedupeLines(lines);
  if (out.length >= minCount) return out;
  const merged = [...out];
  dedupeAppend(merged, fallbackLines);
  return merged;
};

const toSourceFactLine = (sourceAttribution) => {
  if (sourceAttribution === "web_hint_unverified") {
    return "Source fact: this barcode currently maps to unverified web hints.";
  }
  if (sourceAttribution === "verified_regulatory") {
    return "Source fact: this identity is backed by verified regulatory records (NPN/DSLD).";
  }
  if (sourceAttribution === "label_record") {
    return "Source fact: this identity is backed by structured label record data.";
  }
  return "Source fact: identity confidence is still limited for this barcode.";
};

const toActionLine = (sourceAttribution) => {
  if (sourceAttribution === "web_hint_unverified") {
    return "Next step: scan Supplement Facts and Directions to verify ingredients and dosage.";
  }
  return "Next step: scan Supplement Facts and Directions for stronger product-specific analysis.";
};

const toDegradedReasonLine = (terminalReason) => {
  const reason = normalizeText(terminalReason).toUpperCase();
  if (reason.includes("DEGRADED_WEB_BUDGET")) {
    return "Limited analysis (time budget): web evidence was shortened to keep this scan responsive.";
  }
  if (reason.includes("DEGRADED_EVENTLOOP")) {
    return "Limited analysis (system load): this scan returned conservative partial results.";
  }
  return "Limited analysis: this scan returned conservative partial results due to runtime constraints.";
};

export const evaluateContentValueGate = (params) => {
  const route = normalizeText(params?.route) || "unknown";
  const bundle = params?.analysisBundle ?? null;
  const sourceAttribution = normalizeText(params?.sourceAttribution) || "unknown";
  const scoreInfo = params?.scoreInfo ?? null;
  const terminalReason = normalizeText(params?.terminalReason);
  const reasonCode = normalizeText(params?.reasonCode);
  const degradedMode = Boolean(params?.degradedMode) || /^DEGRADED_/i.test(terminalReason);
  const fallbackErrorMessage = normalizeText(params?.errorMessage);
  const degradedReason = terminalReason || reasonCode;
  const ulEntriesCount = countUlEntries(scoreInfo);
  const context = {
    sourceAttribution,
    degradedMode,
    terminalReason: degradedReason,
    ulEntriesCount,
  };

  if (route !== "dashboard" || !bundle) {
    const fallbackLines = [fallbackErrorMessage, terminalReason, reasonCode].filter(Boolean);
    const fallbackPass = fallbackLines.length > 0 && hasNextStepAction(fallbackLines);
    return {
      applied: false,
      route,
      pass: null,
      failReasons: [],
      moduleValue: null,
      fallbackRoutePass: fallbackPass,
      fallbackRouteFailReasons: fallbackPass ? [] : ["FALLBACK_ROUTE_NEEDS_REASON_AND_NEXT_STEP"],
    };
  }

  const overview = collectOverview(bundle, context);
  const science = collectScience(bundle, context);
  const usage = collectUsage(bundle, context);
  const safety = collectSafety(bundle, context);

  const allLines = [
    ...overview.lines,
    ...science.lines,
    ...usage.lines,
    ...safety.lines,
  ];

  const scoreHasScore = scoreHasNumericValue(scoreInfo);
  const terminalReasonForScore = normalizeText(terminalReason).toUpperCase();
  const terminalScoreFallback =
    terminalReasonForScore && terminalReasonForScore !== "DONE" && terminalReasonForScore !== "NO_TERMINAL"
      ? terminalReason
      : "";
  const scoreReasonCode = normalizeText(
    scoreInfo?.reasonCode
    || reasonCode
    || bundle?.meta?.reasonCode
    || bundle?.meta?.fallbackReason
    || terminalScoreFallback,
  );
  const scoreExplanation =
    normalizeText(scoreInfo?.message)
    || normalizeText(bundle?.meta?.scoreExplanation)
    || reasonCodeToExplanation(scoreReasonCode);
  const scorePass = scoreHasScore || (Boolean(scoreReasonCode) && Boolean(scoreExplanation));

  const degradedHasReason = !degradedMode || Boolean(degradedReason);
  const degradedHasNextStep = !degradedMode || hasNextStepAction(allLines);
  const degradedPass = degradedHasReason && degradedHasNextStep;

  const ulRequired = ulEntriesCount > 0;
  const ulShown = !ulRequired || hasUlShownInUsage(usage.lines);
  const ulPass = !ulRequired || ulShown;

  const failReasons = [];
  for (const reason of [
    ...overview.failReasons,
    ...science.failReasons,
    ...usage.failReasons,
    ...safety.failReasons,
  ]) {
    if (!failReasons.includes(reason)) failReasons.push(reason);
  }

  if (!scorePass) {
    failReasons.push(CONTENT_VALUE_FAIL_REASONS.SCORE_NO_SCORE_AND_NO_EXPLANATION);
  }
  if (degradedMode && !degradedHasReason) {
    failReasons.push(CONTENT_VALUE_FAIL_REASONS.DEGRADED_NO_REASON);
  }
  if (degradedMode && !degradedHasNextStep) {
    failReasons.push(CONTENT_VALUE_FAIL_REASONS.DEGRADED_NO_NEXT_STEP);
  }
  if (!ulPass) {
    failReasons.push(CONTENT_VALUE_FAIL_REASONS.UL_PRESENT_BUT_NOT_SHOWN);
  }

  if (isUnverifiedSource(sourceAttribution) && containsVerifiedLanguage(allLines)) {
    failReasons.push(CONTENT_VALUE_FAIL_REASONS.UNVERIFIED_HAS_VERIFIED_LANGUAGE);
  }

  return {
    applied: true,
    route,
    pass: failReasons.length === 0,
    failReasons,
    moduleValue: {
      overview,
      science,
      usage: {
        ...usage,
        ulRequired,
        ulEntriesCount,
        ulShown,
        ulPass,
      },
      safety,
      score: {
        pass: scorePass,
        hasScore: scoreHasScore,
        reasonCode: scoreReasonCode || null,
        explanation: scoreExplanation || null,
      },
      degraded: {
        required: degradedMode,
        pass: degradedPass,
        hasReason: degradedHasReason,
        hasNextStep: degradedHasNextStep,
      },
    },
    fallbackRoutePass: null,
    fallbackRouteFailReasons: [],
  };
};
