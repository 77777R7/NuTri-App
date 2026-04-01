import {
  normalizeAllergenTextInputs,
  type AllergenTextInput,
  type NormalizedAllergenResult,
} from "./allergenNormalization.js";
import {
  extractTextList,
  pickFirstValue,
  splitLooseTextList,
  toObjectRecord,
} from "./sourceHelpers.js";

export type DsldAllergenExtractorInput = {
  dsldLabelId: number | string;
  canonicalSourceId?: string | null;
  activeIngredientsSummary?: string | null;
  inactiveIngredients?: string | null;
  factsJson?: unknown;
};

const buildTextInputs = (input: DsldAllergenExtractorInput): AllergenTextInput[] => {
  const textInputs: AllergenTextInput[] = [];

  splitLooseTextList(input.activeIngredientsSummary).forEach((text) => {
    textInputs.push({ source: "active_ingredient", text });
  });

  splitLooseTextList(input.inactiveIngredients).forEach((text) => {
    textInputs.push({ source: "inactive_ingredient", text });
  });

  const factsRecord = toObjectRecord(input.factsJson);
  if (!factsRecord) return textInputs;

  const activesPayload =
    pickFirstValue(factsRecord, ["actives", "activeIngredients", "active_ingredients"]) ?? null;
  extractTextList(activesPayload, ["name", "ingredient_name", "ingredient"]).forEach((text) => {
    textInputs.push({ source: "active_ingredient", text });
  });

  const inactivePayload =
    pickFirstValue(factsRecord, ["inactive", "inactiveIngredients", "inactive_ingredients"]) ??
    null;
  extractTextList(inactivePayload, ["name", "ingredient_name", "ingredient"]).forEach((text) => {
    textInputs.push({ source: "inactive_ingredient", text });
  });

  return textInputs;
};

export const extractFromDsld = (
  input: DsldAllergenExtractorInput,
): NormalizedAllergenResult => normalizeAllergenTextInputs(buildTextInputs(input));

export const dsldAllergenExtractorInternals = {
  buildTextInputs,
};
