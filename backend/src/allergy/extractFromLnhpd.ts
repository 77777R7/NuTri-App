import {
  normalizeAllergenTextInputs,
  type AllergenTextInput,
  type NormalizedAllergenResult,
} from "./allergenNormalization.js";
import {
  extractTextList,
  pickFirstValue,
  toObjectRecord,
} from "./sourceHelpers.js";

export type LnhpdAllergenExtractorInput = {
  lnhpdId: number | string;
  canonicalSourceId?: string | null;
  factsJson?: unknown;
};

const MEDICINAL_KEYS = [
  "medicinalIngredients",
  "medicinal_ingredients",
  "medicinalIngredient",
  "medicinal_ingredient",
];

const NON_MEDICINAL_KEYS = [
  "nonMedicinalIngredients",
  "non_medicinal_ingredients",
  "nonMedicinalIngredient",
  "non_medicinal_ingredient",
  "nonmedicinalIngredients",
];

const WARNING_KEYS = [
  "warnings",
  "warning",
  "cautions",
  "caution",
  "contraindications",
];

const findPayloadByKeyHeuristic = (
  record: Record<string, unknown>,
  kind: "medicinal" | "non_medicinal",
): unknown => {
  const knownKeys = kind === "medicinal" ? MEDICINAL_KEYS : NON_MEDICINAL_KEYS;
  const direct = pickFirstValue(record, knownKeys);
  if (direct !== undefined) return direct;

  for (const [key, value] of Object.entries(record)) {
    const lower = key.toLowerCase();
    if (!lower.includes("ingredient")) continue;
    if (kind === "medicinal") {
      if (lower.includes("nonmedicinal") || lower.includes("non_medicinal")) continue;
      if (lower.includes("medicinal")) return value;
      continue;
    }
    if (lower.includes("nonmedicinal") || lower.includes("non_medicinal")) return value;
  }

  return undefined;
};

const buildTextInputs = (input: LnhpdAllergenExtractorInput): AllergenTextInput[] => {
  const textInputs: AllergenTextInput[] = [];
  const factsRecord = toObjectRecord(input.factsJson);
  if (!factsRecord) return textInputs;

  const medicinalPayload = findPayloadByKeyHeuristic(factsRecord, "medicinal");
  extractTextList(medicinalPayload, [
    "medicinal_ingredient_name",
    "ingredient_name",
    "medicinal_ingredient_name_en",
    "ingredient_name_en",
    "proper_name",
    "substance_name",
    "name",
  ]).forEach((text) => {
    textInputs.push({ source: "active_ingredient", text });
  });

  const nonMedicinalPayload = findPayloadByKeyHeuristic(factsRecord, "non_medicinal");
  extractTextList(nonMedicinalPayload, [
    "nonmedicinal_ingredient_name",
    "non_medicinal_ingredient_name",
    "ingredient_name",
    "name",
  ]).forEach((text) => {
    textInputs.push({ source: "inactive_ingredient", text });
  });

  WARNING_KEYS.forEach((key) => {
    const payload = pickFirstValue(factsRecord, [key]);
    extractTextList(payload, ["text", "description", "name"]).forEach((text) => {
      textInputs.push({ source: "warning", text });
    });
    if (typeof payload === "string" && payload.trim()) {
      textInputs.push({ source: "warning", text: payload.trim() });
    }
  });

  return textInputs;
};

export const extractFromLnhpd = (
  input: LnhpdAllergenExtractorInput,
): NormalizedAllergenResult => normalizeAllergenTextInputs(buildTextInputs(input));

export const lnhpdAllergenExtractorInternals = {
  buildTextInputs,
  findPayloadByKeyHeuristic,
};
