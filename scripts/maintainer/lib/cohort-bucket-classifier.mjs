const isTruthy = (value) => value === true || value === 1 || value === "1";

const toUpper = (value) => String(value ?? "").trim().toUpperCase();

const AUTHORITATIVE_EXPECTED_ROLES = new Set([
  "ca_top_scan_30d",
  "ca_top_scan_90d",
  "ca_recent_fail_30d",
  "us_dsld_canonical_sample",
  "ca_mapped_lnhpd_sample",
  "negative_cache_hit",
]);

export const classifyTraceBucket = (row) => {
  const terminal = toUpper(row?.terminal);
  const terminalReason = toUpper(row?.terminalReason);
  const timeoutBucket = toUpper(row?.timeoutBucket);
  const role = String(row?.role ?? "").trim().toLowerCase();

  if (terminalReason.includes("UNCAUGHT_EXCEPTION") || terminalReason.includes("REFERENCEERROR")) {
    return "CRASH_UNCAUGHT_EXCEPTION";
  }
  if (terminal === "CLIENT_TIMEOUT" || terminal === "REQUEST_ERROR") {
    if (timeoutBucket === "SSE_NOT_CONNECTED") return "SSE_NOT_CONNECTED";
    if (timeoutBucket === "SSE_CONNECTED_NO_DONE") return "SSE_CONNECTED_NO_DONE";
    return "CLIENT_TIMEOUT";
  }
  if (AUTHORITATIVE_EXPECTED_ROLES.has(role) && row?.sourceTypeFinal !== true) {
    return "AUTHORITATIVE_EXPECTED_BUT_NOT_FINAL";
  }
  if (String(row?.rev1SourceType ?? "").trim().toLowerCase() === "web" && row?.sourceTypeFinal !== true) {
    return "WEB_FALLBACK_SOURCE_TYPE_FINAL_FALSE";
  }
  if (isTruthy(row?.scoreQueryInitiated) && String(row?.scoreResponseStatus ?? "").trim().length === 0) {
    return "SCORE_PENDING_TIMEOUT_AFTER_DONE";
  }
  if (row?.coverDetailConsistencyPass === false) {
    return "COVER_DETAIL_INCONSISTENT";
  }
  if (isTruthy(row?.negativeCacheResidual)) {
    return "NEGATIVE_CACHE_RESIDUAL";
  }
  if (Number(row?.nutritionLabelLikeLeakCount ?? 0) > 0) {
    return "SCORE_INPUT_PURITY_LEAK";
  }
  if (
    Number(row?.deterministicSignalCounts?.ingredientCount ?? 0) === 0
    && Number(row?.deterministicSignalCounts?.doseCount ?? 0) === 0
    && row?.sourceTypeFinal === true
  ) {
    return "DATA_CEILING";
  }
  return "HEALTHY";
};

export const classifyCohortBuckets = (traces) => {
  const rows = Array.isArray(traces) ? traces : [];
  const bucketRows = [];
  const bucketCounts = {};
  const byBarcode = new Map();

  for (const row of rows) {
    const bucket = classifyTraceBucket(row);
    bucketRows.push({ ...row, bucket });
    bucketCounts[bucket] = (bucketCounts[bucket] ?? 0) + 1;
    const barcode = String(row?.barcode ?? "").trim();
    if (!barcode) continue;
    if (!byBarcode.has(barcode)) {
      byBarcode.set(barcode, {
        stabilityHashes: new Set(),
        rev1SourceTypes: new Set(),
        sourceTypeFinalValues: new Set(),
        terminalReasons: new Set(),
      });
    }
    const slot = byBarcode.get(barcode);
    slot.stabilityHashes.add(String(row?.stabilityHash ?? ""));
    slot.rev1SourceTypes.add(String(row?.rev1SourceType ?? "").trim().toLowerCase() || "unknown");
    slot.sourceTypeFinalValues.add(row?.sourceTypeFinal === true);
    slot.terminalReasons.add(String(row?.terminalReason ?? "").trim() || "unknown");
  }

  const nondeterministicBarcodes = [];
  const nondeterministicDetails = [];
  for (const [barcode, state] of byBarcode.entries()) {
    const filtered = [...state.stabilityHashes].filter((value) => value.length > 0);
    if (new Set(filtered).size > 1) nondeterministicBarcodes.push(barcode);
    if (new Set(filtered).size <= 1) continue;
    const sourceTypes = [...state.rev1SourceTypes];
    const authoritativeSeen = sourceTypes.some((source) => source === "lnhpd" || source === "dsld");
    const webOnly = sourceTypes.every((source) => source === "web" || source === "unknown");
    const classification = authoritativeSeen
      ? "unacceptable_authoritative_path_nondeterministic"
      : (webOnly ? "acceptable_web_only_nondeterministic" : "needs_manual_review");
    nondeterministicDetails.push({
      barcode,
      stabilityHashCount: new Set(filtered).size,
      rev1SourceTypes: sourceTypes,
      sourceTypeFinalValues: [...state.sourceTypeFinalValues],
      terminalReasons: [...state.terminalReasons],
      classification,
    });
  }
  if (nondeterministicBarcodes.length > 0) {
    bucketCounts.NONDETERMINISTIC_SAME_BARCODE = nondeterministicBarcodes.length;
  }

  const bucketTop = Object.entries(bucketCounts)
    .map(([bucket, count]) => ({ bucket, count }))
    .sort((a, b) => b.count - a.count);

  return {
    bucketRows,
    bucketCounts,
    bucketTop,
    nondeterministicBarcodes,
    nondeterministicDetails,
    nondeterministicExamples: bucketRows.filter((row) => nondeterministicBarcodes.includes(String(row?.barcode ?? ""))),
  };
};
