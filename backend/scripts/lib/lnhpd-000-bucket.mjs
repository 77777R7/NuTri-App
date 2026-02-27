const normalizeText = (value) => (typeof value === "string" ? value.trim() : "");

const asArray = (value) => {
  if (Array.isArray(value)) return value;
  if (value == null) return [];
  return [value];
};

const hasAnyText = (values) => asArray(values).some((entry) => normalizeText(entry).length > 0);

const extractMedicinalRows = (factsJson) => {
  if (!factsJson || typeof factsJson !== "object") return [];
  const root = factsJson;
  const candidates = [
    root.medicinalIngredients,
    root.medicinal_ingredients,
    root.activeIngredients,
    root.active_ingredients,
    root.active_ingredients_summary,
  ];
  const rows = [];
  for (const candidate of candidates) {
    for (const row of asArray(candidate)) {
      rows.push(row);
    }
  }
  return rows;
};

const extractIngredientName = (row) => {
  if (typeof row === "string") return normalizeText(row);
  if (!row || typeof row !== "object") return "";
  return normalizeText(
    row.name
    || row.ingredient
    || row.ingredient_name
    || row.proper_name
    || row.properName
    || row.medicinal_ingredient_name,
  );
};

const extractAmountUnit = (row) => {
  if (!row || typeof row !== "object") return { hasAmount: false, hasUnit: false };
  const amountValues = [
    row.amount,
    row.amount_value,
    row.amountValue,
    row.quantity,
    row.quantity_dose,
    row.quantity_dose_minimum,
    row.quantity_dose_maximum,
    row.dose,
    row.strength,
  ];
  const unitValues = [
    row.unit,
    row.amount_unit,
    row.amountUnit,
    row.unit_desc,
    row.uom,
    row.uom_type_desc_quantity_dose,
  ];

  const hasAmount = amountValues.some((value) => {
    if (typeof value === "number") return Number.isFinite(value) && value > 0;
    const text = normalizeText(value);
    if (!text) return false;
    const parsed = Number(text);
    return Number.isFinite(parsed) && parsed > 0;
  });
  const hasUnit = unitValues.some((value) => normalizeText(value).length > 0);
  return { hasAmount, hasUnit };
};

const extractRiskRows = (factsJson) => {
  if (!factsJson || typeof factsJson !== "object") return [];
  const root = factsJson;
  const candidates = [
    root.warnings,
    root.warning,
    root.cautions,
    root.caution,
    root.contraindications,
    root.contraindication,
    root.interactions,
    root.interaction,
    root.risks,
    root.redFlags,
    root.consultDoctorIf,
  ];
  return candidates.flatMap((candidate) => asArray(candidate));
};

const extractRecommendedUseRows = (factsJson) => {
  if (!factsJson || typeof factsJson !== "object") return [];
  const root = factsJson;
  const candidates = [
    root.doses,
    root.directions,
    root.recommendedUse,
    root.recommended_use,
    root.routes,
    root.route,
    root.purposes,
    root.purpose,
  ];
  return candidates.flatMap((candidate) => asArray(candidate));
};

export const LNHPD_000_BUCKETS = Object.freeze({
  MISSING_MEDICINAL_INGREDIENTS: "MISSING_MEDICINAL_INGREDIENTS",
  MISSING_AMOUNT_FIELDS: "MISSING_AMOUNT_FIELDS",
  PARSER_GAP_FIXABLE: "PARSER_GAP_FIXABLE",
  MAPPING_GAP_NO_BARCODE: "MAPPING_GAP_NO_BARCODE",
  DATA_CEILING: "DATA_CEILING",
});

export const deriveLnhpdRawEvidence = (factsJson) => {
  const medicinalRows = extractMedicinalRows(factsJson);
  const medicinalNames = medicinalRows.map((row) => extractIngredientName(row)).filter(Boolean);
  const amountSignals = medicinalRows.map((row) => extractAmountUnit(row));
  const riskRows = extractRiskRows(factsJson);
  const useRows = extractRecommendedUseRows(factsJson);

  const hasMedicinalRaw = medicinalNames.length > 0;
  const hasAmountRaw = amountSignals.some((entry) => entry.hasAmount && entry.hasUnit);
  const hasRiskInfoRaw = hasAnyText(riskRows.map((row) => (typeof row === "object" ? row?.text : row)));
  const hasRecommendedUseRaw = hasAnyText(
    useRows.map((row) => {
      if (typeof row === "string") return row;
      if (!row || typeof row !== "object") return "";
      return (
        row.rawText
        || row.text
        || row.purpose
        || row.route_type_desc
        || row.direction
        || row.dose
        || row.frequency
      );
    }),
  );

  return {
    medicinalRows,
    medicinalNames,
    amountSignals,
    riskRows,
    useRows,
    hasMedicinalRaw,
    hasAmountRaw,
    hasRiskInfoRaw,
    hasRecommendedUseRaw,
  };
};

export const deriveExtractorCountsFromLnhpdFacts = (factsJson) => {
  const raw = deriveLnhpdRawEvidence(factsJson);
  const extractorIngredientCount = raw.medicinalNames.length;
  const extractorDoseCount = raw.amountSignals.filter((entry) => entry.hasAmount && entry.hasUnit).length;
  const extractorSafetyCount =
    raw.riskRows.filter((row) => normalizeText(typeof row === "object" ? row?.text : row).length > 0).length;
  return {
    extractorIngredientCount,
    extractorDoseCount,
    extractorSafetyCount,
    raw,
  };
};

/**
 * @param {{
 *   factsJson: unknown,
 *   hasBarcodeMapping: boolean,
 *   extractorCounts?: { extractorIngredientCount?: number, extractorDoseCount?: number, extractorSafetyCount?: number } | null
 * }} params
 */
export const classifyLnhpd000Bucket = ({
  factsJson,
  hasBarcodeMapping,
  extractorCounts = null,
}) => {
  const derived = extractorCounts && typeof extractorCounts === "object"
    ? {
      extractorIngredientCount: Number(extractorCounts.extractorIngredientCount ?? 0) || 0,
      extractorDoseCount: Number(extractorCounts.extractorDoseCount ?? 0) || 0,
      extractorSafetyCount: Number(extractorCounts.extractorSafetyCount ?? 0) || 0,
      raw: deriveLnhpdRawEvidence(factsJson),
    }
    : deriveExtractorCountsFromLnhpdFacts(factsJson);

  const {
    extractorIngredientCount,
    extractorDoseCount,
    extractorSafetyCount,
    raw,
  } = derived;

  const evidence = {
    hasMedicinalRaw: raw.hasMedicinalRaw,
    hasAmountRaw: raw.hasAmountRaw,
    hasRiskInfoRaw: raw.hasRiskInfoRaw,
    hasRecommendedUseRaw: raw.hasRecommendedUseRaw,
    extractorIngredientCount,
    extractorDoseCount,
    extractorSafetyCount,
  };

  if (!raw.hasMedicinalRaw) {
    return {
      ...evidence,
      bucket: LNHPD_000_BUCKETS.MISSING_MEDICINAL_INGREDIENTS,
      subcause: "raw_medicinal_missing",
      fixLane: "source_data",
    };
  }

  if (raw.hasMedicinalRaw && !raw.hasAmountRaw) {
    return {
      ...evidence,
      bucket: LNHPD_000_BUCKETS.MISSING_AMOUNT_FIELDS,
      subcause: "ingredient_present_amount_missing",
      fixLane: "source_data",
    };
  }

  const parserGapVisible =
    (raw.hasMedicinalRaw && extractorIngredientCount === 0)
    || (raw.hasAmountRaw && extractorDoseCount === 0)
    || (raw.hasRiskInfoRaw && extractorSafetyCount === 0);
  if (parserGapVisible) {
    return {
      ...evidence,
      bucket: LNHPD_000_BUCKETS.PARSER_GAP_FIXABLE,
      subcause: "raw_present_extractor_zero",
      fixLane: "parser",
    };
  }

  if (!hasBarcodeMapping) {
    return {
      ...evidence,
      bucket: LNHPD_000_BUCKETS.MAPPING_GAP_NO_BARCODE,
      subcause: "npn_unmapped",
      fixLane: "mapping",
    };
  }

  return {
    ...evidence,
    bucket: LNHPD_000_BUCKETS.DATA_CEILING,
    subcause: "source_thin_nonfixable",
    fixLane: "data_ceiling",
  };
};
