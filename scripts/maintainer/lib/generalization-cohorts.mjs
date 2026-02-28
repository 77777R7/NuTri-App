const DEFAULT_MIN_SAMPLES = 20;

const SOURCE_TIER_LIVE = "live";
const SOURCE_TIER_HISTORY = "history";
const SOURCE_TIER_SEEDS = "seeds";
const SOURCE_TIER_ORDER = [SOURCE_TIER_LIVE, SOURCE_TIER_HISTORY, SOURCE_TIER_SEEDS];

const normalizeBarcode = (value) => {
  const digits = String(value ?? "").replace(/\D/g, "");
  if (!digits) return null;
  if (digits.length >= 14) return digits.slice(-14);
  if (digits.length >= 8) return digits.padStart(14, "0");
  return null;
};

const normalizeReasonSet = (value) => {
  if (!Array.isArray(value)) return [];
  return value.map((item) => String(item ?? "").trim()).filter(Boolean);
};

export const cohortTypeOrder = [
  "negative_cache_residual",
  "inferred_only_consistency",
  "historical_dsld_web_fallback",
  "score_pending_timeout",
];

const withSourceTier = (entries, sourceTier) =>
  (Array.isArray(entries) ? entries : []).map((entry) => ({
    ...entry,
    sourceTier,
  }));

export const extractCohortEntriesFromRoundsSummary = (summary, sourceLabel = "unknown_round") => {
  const attempts = Array.isArray(summary?.attempts) ? summary.attempts : [];
  const inferredEntries = [];
  const dsldFallbackEntries = [];
  const scorePendingTimeoutEntries = [];

  for (const attempt of attempts) {
    const barcode = normalizeBarcode(attempt?.barcode);
    if (!barcode) continue;
    const warningReasons = normalizeReasonSet(attempt?.consistencyWarningReasons);
    const inferredOnly = warningReasons.some((reason) => reason.startsWith("INFERRED_ONLY_"));
    if (inferredOnly) {
      inferredEntries.push({
        barcode,
        source: sourceLabel,
        warningReasons,
        sourceTypeFinal: attempt?.sourceTypeFinal === true,
        consistencyFailReason: attempt?.consistencyFailReason ?? null,
      });
    }

    const role = String(attempt?.role ?? "").trim().toLowerCase();
    const sourceAttribution = String(attempt?.sourceAttribution ?? "").trim().toLowerCase();
    const terminalReason = String(attempt?.terminalReason ?? "").trim().toUpperCase();
    const timeoutClass = String(attempt?.timeoutClass ?? "").trim().toUpperCase();
    const sourceTypeFinal = attempt?.sourceTypeFinal === true;
    const dsldFallbackLike =
      role === "dsld"
      && (
        !sourceTypeFinal
        || sourceAttribution.includes("web_hint")
        || terminalReason.includes("DEGRADED_WEB")
        || terminalReason.includes("BUNDLE_ONLY_NO_AUTHORITATIVE_MATCH")
      );
    if (dsldFallbackLike) {
      dsldFallbackEntries.push({
        barcode,
        source: sourceLabel,
        sourceTypeFinal,
        sourceAttribution: attempt?.sourceAttribution ?? null,
        terminalReason: attempt?.terminalReason ?? null,
      });
    }

    const scoreQueryInitiated = attempt?.scoreQueryInitiated === true;
    const scoreTerminalSeen = attempt?.scoreTerminalSeen === true;
    const scoreResponseStatus = String(attempt?.scoreResponseStatus ?? "").trim().toLowerCase();
    const scorePendingLike =
      scoreQueryInitiated
      && !scoreTerminalSeen
      && (
        terminalReason.includes("CLIENT_TIMEOUT")
        || timeoutClass === "SSE_CONNECTED_BUT_NO_DONE"
        || timeoutClass === "SSE_CONNECT_FAILED"
        || scoreResponseStatus === "loading"
        || scoreResponseStatus === "pending"
      );
    if (scorePendingLike) {
      scorePendingTimeoutEntries.push({
        barcode,
        source: sourceLabel,
        timeoutClass: attempt?.timeoutClass ?? null,
        terminalReason: attempt?.terminalReason ?? null,
        scoreResponseStatus: attempt?.scoreResponseStatus ?? null,
      });
    }
  }

  return {
    inferred_only_consistency: inferredEntries,
    historical_dsld_web_fallback: dsldFallbackEntries,
    score_pending_timeout: scorePendingTimeoutEntries,
  };
};

export const extractCohortEntriesFromResidualReport = (report, sourceLabel = "unknown_residual") => {
  const sampleRows = Array.isArray(report?.sampleCheckedRows) && report.sampleCheckedRows.length > 0
    ? report.sampleCheckedRows
    : (Array.isArray(report?.sampleResidualRows) ? report.sampleResidualRows : []);
  const entries = [];
  for (const row of sampleRows) {
    const barcode = normalizeBarcode(row?.barcodeGtin14 ?? row?.barcodeRaw);
    if (!barcode) continue;
    entries.push({
      barcode,
      source: sourceLabel,
      residual: row?.residual === true,
      servedFrom: row?.servedFrom ?? null,
      negativeReason: row?.negativeReason ?? null,
      negativeUntil: row?.negativeUntil ?? null,
      scanCreatedAt: row?.scanCreatedAt ?? null,
    });
  }
  return entries;
};

export const extractCohortEntriesFromSurfaceConsistencyReport = (
  report,
  sourceLabel = "unknown_surface_consistency",
) => {
  const rows = Array.isArray(report?.inferredOnlyContradictionRows)
    ? report.inferredOnlyContradictionRows
    : [];
  const entries = [];
  for (const row of rows) {
    const barcode = normalizeBarcode(row?.barcode ?? row?.barcodeGtin14);
    if (!barcode) continue;
    entries.push({
      barcode,
      source: sourceLabel,
      warningReasons: ["INFERRED_ONLY_FROM_SURFACE_CONSISTENCY"],
      sourceTypeFinal:
        typeof row?.scanSourceTypeFinal === "boolean"
          ? row.scanSourceTypeFinal
          : null,
      consistencyFailReason: null,
    });
  }
  return {
    inferred_only_consistency: entries,
    historical_dsld_web_fallback: [],
    score_pending_timeout: [],
  };
};

const dedupeByBarcode = (entries) => {
  const output = [];
  const seen = new Set();
  for (const entry of entries) {
    const barcode = normalizeBarcode(entry?.barcode);
    if (!barcode || seen.has(barcode)) continue;
    seen.add(barcode);
    output.push({ ...entry, barcode });
  }
  return output;
};

const fingerprintForEntry = (entry) => [
  String(entry?.barcode ?? ""),
  String(entry?.source ?? "").trim(),
  String(entry?.scanCreatedAt ?? entry?.negativeUntil ?? entry?.terminalReason ?? ""),
  String(entry?.servedFrom ?? ""),
  Array.isArray(entry?.warningReasons) ? entry.warningReasons.join("|") : "",
  String(entry?.sourceTier ?? ""),
].join("::");

const dedupeByFingerprint = (entries) => {
  const output = [];
  const seen = new Set();
  for (const entry of entries) {
    const barcode = normalizeBarcode(entry?.barcode);
    if (!barcode) continue;
    const fingerprint = fingerprintForEntry(entry);
    if (seen.has(fingerprint)) continue;
    seen.add(fingerprint);
    output.push({ ...entry, barcode });
  }
  return output;
};

const buildSourceTierBreakdown = (sample) => {
  const counts = {
    [SOURCE_TIER_LIVE]: 0,
    [SOURCE_TIER_HISTORY]: 0,
    [SOURCE_TIER_SEEDS]: 0,
  };
  for (const entry of sample) {
    const tier = SOURCE_TIER_ORDER.includes(entry?.sourceTier)
      ? entry.sourceTier
      : SOURCE_TIER_HISTORY;
    counts[tier] += 1;
  }
  return counts;
};

const sampleCohort = (latestEntries, historyEntries, seedEntries, minSamples) => {
  const allEntries = [
    ...withSourceTier(latestEntries, SOURCE_TIER_LIVE),
    ...withSourceTier(historyEntries, SOURCE_TIER_HISTORY),
    ...withSourceTier(seedEntries, SOURCE_TIER_SEEDS),
  ];
  const uniqueByBarcode = dedupeByBarcode(allEntries);
  const allDistinct = dedupeByFingerprint(allEntries);

  const sample = uniqueByBarcode.slice(0, minSamples);
  if (sample.length < minSamples) {
    const selectedFingerprints = new Set(sample.map((entry) => fingerprintForEntry(entry)));
    for (const entry of allDistinct) {
      if (sample.length >= minSamples) break;
      const fingerprint = fingerprintForEntry(entry);
      if (selectedFingerprints.has(fingerprint)) continue;
      selectedFingerprints.add(fingerprint);
      sample.push(entry);
    }
  }

  const sampleSourceBreakdown = buildSourceTierBreakdown(sample);
  return {
    sample,
    sampleCount: sample.length,
    availableCount: allDistinct.length,
    availableUniqueCount: uniqueByBarcode.length,
    insufficientPool: sample.length < minSamples,
    sampleSourceBreakdown,
    seedBackfillCount: sampleSourceBreakdown[SOURCE_TIER_SEEDS],
  };
};

export const buildGeneralizationCohortReport = ({
  latestRoundEntries,
  historyRoundEntries,
  latestResidualEntries,
  historyResidualEntries,
  seedEntriesByType = {},
  minSamples = DEFAULT_MIN_SAMPLES,
}) => {
  const normalizedMin = Number.isFinite(Number(minSamples))
    ? Math.max(1, Math.floor(Number(minSamples)))
    : DEFAULT_MIN_SAMPLES;

  const byType = {
    negative_cache_residual: sampleCohort(
      latestResidualEntries ?? [],
      historyResidualEntries ?? [],
      seedEntriesByType?.negative_cache_residual ?? [],
      normalizedMin,
    ),
    inferred_only_consistency: sampleCohort(
      latestRoundEntries?.inferred_only_consistency ?? [],
      historyRoundEntries?.inferred_only_consistency ?? [],
      seedEntriesByType?.inferred_only_consistency ?? [],
      normalizedMin,
    ),
    historical_dsld_web_fallback: sampleCohort(
      latestRoundEntries?.historical_dsld_web_fallback ?? [],
      historyRoundEntries?.historical_dsld_web_fallback ?? [],
      seedEntriesByType?.historical_dsld_web_fallback ?? [],
      normalizedMin,
    ),
    score_pending_timeout: sampleCohort(
      latestRoundEntries?.score_pending_timeout ?? [],
      historyRoundEntries?.score_pending_timeout ?? [],
      seedEntriesByType?.score_pending_timeout ?? [],
      normalizedMin,
    ),
  };

  const cohortSampleCountByType = {};
  const cohortInsufficientByType = {};
  const sampleSourceBreakdownByType = {};
  const seedBackfillCountByType = {};
  for (const type of cohortTypeOrder) {
    cohortSampleCountByType[type] = byType[type].sampleCount;
    cohortInsufficientByType[type] = byType[type].insufficientPool;
    sampleSourceBreakdownByType[type] = byType[type].sampleSourceBreakdown;
    seedBackfillCountByType[type] = byType[type].seedBackfillCount;
  }

  return {
    minSamples: normalizedMin,
    cohortSampleCountByType,
    cohortInsufficientByType,
    sampleSourceBreakdownByType,
    seedBackfillCountByType,
    pass: Object.values(cohortInsufficientByType).every((value) => value !== true),
    cohorts: Object.fromEntries(
      cohortTypeOrder.map((type) => [
        type,
        {
          requiredMin: normalizedMin,
          sampleCount: byType[type].sampleCount,
          availableCount: byType[type].availableCount,
          availableUniqueCount: byType[type].availableUniqueCount,
          insufficientPool: byType[type].insufficientPool,
          sampleSourceBreakdown: byType[type].sampleSourceBreakdown,
          seedBackfillCount: byType[type].seedBackfillCount,
          sample: byType[type].sample,
        },
      ]),
    ),
  };
};
