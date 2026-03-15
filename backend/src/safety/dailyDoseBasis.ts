import type { FactsDigest } from "../factsDigest.js";
import { parseLabelDirectionsV1 } from "../mySupplementFacts.js";
import type { DailyDoseBasis, DailyDoseBasisReason } from "./types.js";

const normalizeDirectionsText = (value: string | null | undefined): string | null => {
  const trimmed = String(value ?? "").replace(/\s+/g, " ").trim();
  return trimmed.length > 0 ? trimmed : null;
};

export const buildLabelDirectionsTextFromDigest = (
  digest: Pick<FactsDigest, "labelDosing"> | null | undefined,
): string | null => {
  const rows = Array.isArray(digest?.labelDosing) ? digest.labelDosing : [];
  const rawTexts = rows
    .map((row) => normalizeDirectionsText(row?.rawText))
    .filter((row): row is string => Boolean(row));
  if (rawTexts.length > 0) {
    const adults = rawTexts.find((text) => /\badult(s)?\b/i.test(text));
    return adults ?? rawTexts[0] ?? null;
  }

  const first = rows[0];
  if (!first) return null;
  const parts = [first.population, first.age]
    .map((part) => normalizeDirectionsText(part))
    .filter((part): part is string => Boolean(part));
  const doseBits = [first.dose, first.frequency]
    .map((part) => normalizeDirectionsText(part))
    .filter((part): part is string => Boolean(part));
  const joined = [
    parts.length > 0 ? parts.join(" ") : null,
    doseBits.length > 0 ? doseBits.join(", ") : null,
  ]
    .filter((part): part is string => Boolean(part))
    .join(": ");
  return joined.length > 0 ? joined : null;
};

export const deriveDailyDoseBasis = (params: {
  labelDirectionsRawText?: string | null;
  hasUsableActiveDose?: boolean;
  sourceContext?: "facts" | "snapshot_only" | "unknown";
}): {
  dailyMultiplier: number;
  dailyDoseBasis: DailyDoseBasis;
  dailyDoseBasisReason: DailyDoseBasisReason;
  parsedTimesPerDay: number | null;
  labelDirectionsRawText: string | null;
} => {
  if (params.hasUsableActiveDose === false) {
    return {
      dailyMultiplier: 1,
      dailyDoseBasis: "one_serving_fallback",
      dailyDoseBasisReason: "insufficient_active_dose",
      parsedTimesPerDay: null,
      labelDirectionsRawText: normalizeDirectionsText(params.labelDirectionsRawText),
    };
  }

  const labelDirectionsRawText = normalizeDirectionsText(params.labelDirectionsRawText);
  if (!labelDirectionsRawText) {
    return {
      dailyMultiplier: 1,
      dailyDoseBasis: "one_serving_fallback",
      dailyDoseBasisReason:
        params.sourceContext === "snapshot_only" ? "snapshot_only_no_directions" : "missing_directions",
      parsedTimesPerDay: null,
      labelDirectionsRawText: null,
    };
  }

  const parsed = parseLabelDirectionsV1(labelDirectionsRawText);
  const timesPerDay = parsed.parsed.timesPerDay;
  if (timesPerDay != null && Number.isFinite(timesPerDay) && timesPerDay > 0) {
    return {
      dailyMultiplier: timesPerDay,
      dailyDoseBasis: "label_daily_estimate",
      dailyDoseBasisReason: "parsed_label_directions",
      parsedTimesPerDay: timesPerDay,
      labelDirectionsRawText,
    };
  }

  return {
    dailyMultiplier: 1,
    dailyDoseBasis: "one_serving_fallback",
    dailyDoseBasisReason: "ambiguous_frequency",
    parsedTimesPerDay: null,
    labelDirectionsRawText,
  };
};
