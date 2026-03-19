import { formatDoseText } from "../ods/ulDataset.js";
import type { DailyDoseBasis, DailyDoseBasisReason, NormalizedDose } from "./types.js";

const normalizeUnit = (value: string | null | undefined): string | null => {
  const normalized = String(value ?? "").trim().toLowerCase();
  if (!normalized) return null;
  if (normalized === "μg" || normalized === "µg" || normalized === "ug") return "mcg";
  if (normalized === "iu" || normalized === "i.u." || normalized === "i.u") return "iu";
  if (normalized === "milligram" || normalized === "milligrams") return "mg";
  if (normalized === "microgram" || normalized === "micrograms") return "mcg";
  if (normalized === "gram" || normalized === "grams") return "g";
  return normalized;
};

const MASS_TO_MG_FACTOR: Record<string, number> = {
  mcg: 0.001,
  mg: 1,
  g: 1000,
};

const parseNumeric = (value: number | string | null | undefined): number | null => {
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (typeof value === "string") {
    const parsed = Number(value.replace(/,/g, "").trim());
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
};

const formatMaybeDoseText = (value: number | null, unit: string | null): string | null => {
  if (value == null || !unit) return null;
  return formatDoseText(value, unit);
};

export const normalizeDoseForSafety = (params: {
  amount: number | string | null | undefined;
  unit: string | null | undefined;
  amountText?: string | null | undefined;
  dailyMultiplier?: number | null | undefined;
  dailyDoseBasis?: DailyDoseBasis | null | undefined;
  dailyDoseBasisReason?: DailyDoseBasisReason | null | undefined;
}): NormalizedDose => {
  const amount = parseNumeric(params.amount);
  const unit = normalizeUnit(params.unit);
  const rawDoseText = String(params.amountText ?? "").trim() || formatMaybeDoseText(amount, unit);
  const dailyMultiplier = Number.isFinite(Number(params.dailyMultiplier)) && Number(params.dailyMultiplier) > 0
    ? Number(params.dailyMultiplier)
    : 1;
  const dailyDoseBasis = params.dailyDoseBasis ?? "one_serving_fallback";
  const dailyDoseBasisReason = params.dailyDoseBasisReason ?? "missing_directions";

  if (amount == null || amount <= 0 || !unit) {
    return {
      rawDoseText,
      normalizedDoseValue: null,
      normalizedDoseUnit: unit,
      conversionConfidence: 0.1,
      conversionReason: "INVALID_INPUT",
      comparableToUl: false,
      dailyEstimatedDoseValue: null,
      dailyEstimatedDoseUnit: unit,
      dailyEstimatedDoseText: null,
      dailyDoseBasis,
      dailyDoseBasisReason,
    };
  }

  if (unit === "cfu" || unit === "ml") {
    return {
      rawDoseText,
      normalizedDoseValue: amount,
      normalizedDoseUnit: unit,
      conversionConfidence: 0.4,
      conversionReason: "NON_COMPARABLE_UNIT",
      comparableToUl: false,
      dailyEstimatedDoseValue: amount * dailyMultiplier,
      dailyEstimatedDoseUnit: unit,
      dailyEstimatedDoseText: formatMaybeDoseText(amount * dailyMultiplier, unit),
      dailyDoseBasis,
      dailyDoseBasisReason,
    };
  }

  if (unit === "iu") {
    return {
      rawDoseText,
      normalizedDoseValue: amount,
      normalizedDoseUnit: unit,
      conversionConfidence: 0.9,
      conversionReason: "DIRECT_UNIT_MATCH",
      comparableToUl: true,
      dailyEstimatedDoseValue: amount * dailyMultiplier,
      dailyEstimatedDoseUnit: unit,
      dailyEstimatedDoseText: formatMaybeDoseText(amount * dailyMultiplier, unit),
      dailyDoseBasis,
      dailyDoseBasisReason,
    };
  }

  const factor = MASS_TO_MG_FACTOR[unit];
  if (!factor) {
    return {
      rawDoseText,
      normalizedDoseValue: amount,
      normalizedDoseUnit: unit,
      conversionConfidence: 0.2,
      conversionReason: "UNSUPPORTED_UNIT",
      comparableToUl: false,
      dailyEstimatedDoseValue: amount * dailyMultiplier,
      dailyEstimatedDoseUnit: unit,
      dailyEstimatedDoseText: formatMaybeDoseText(amount * dailyMultiplier, unit),
      dailyDoseBasis,
      dailyDoseBasisReason,
    };
  }

  const normalizedDoseValue = amount * factor;
  const normalizedDoseUnit = "mg";
  return {
    rawDoseText,
    normalizedDoseValue,
    normalizedDoseUnit,
    conversionConfidence: unit === "mg" ? 0.95 : 0.9,
    conversionReason: unit === "mg" ? "DIRECT_UNIT_MATCH" : "MASS_UNIT_NORMALIZED",
    comparableToUl: true,
    dailyEstimatedDoseValue: normalizedDoseValue * dailyMultiplier,
    dailyEstimatedDoseUnit: normalizedDoseUnit,
    dailyEstimatedDoseText: formatMaybeDoseText(normalizedDoseValue * dailyMultiplier, normalizedDoseUnit),
    dailyDoseBasis,
    dailyDoseBasisReason,
  };
};
