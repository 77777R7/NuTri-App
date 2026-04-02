import {
  normalizeAllergenTextInputs,
  type AllergenTextInput,
  type NormalizedAllergenResult,
} from "./allergenNormalization.js";
import {
  extractTextSections,
  pickFirstValue,
  toObjectRecord,
} from "./sourceHelpers.js";

export type IherbOverlayAllergenExtractorInput = {
  productId: string;
  canonicalSourceId?: string | null;
  supplementFacts?: unknown;
  descriptionSections?: unknown;
};

const buildTextInputs = (
  input: IherbOverlayAllergenExtractorInput,
): AllergenTextInput[] => {
  const textInputs: AllergenTextInput[] = [];

  const supplementFacts = toObjectRecord(input.supplementFacts);
  const nutritionRows = Array.isArray(
    supplementFacts
      ? pickFirstValue(supplementFacts, ["nutritionalFacts", "nutritional_facts"])
      : null,
  )
    ? (pickFirstValue(supplementFacts!, ["nutritionalFacts", "nutritional_facts"]) as unknown[])
    : [];

  nutritionRows.forEach((row) => {
    const record = toObjectRecord(row);
    const substancy =
      typeof record?.substancy === "string" ? record.substancy.trim() : "";
    if (!substancy) return;
    textInputs.push({ source: "active_ingredient", text: substancy });
  });

  extractTextSections(input.descriptionSections).forEach((section) => {
    const heading = section.heading.toLowerCase();
    if (heading.includes("other ingredients")) {
      textInputs.push({ source: "inactive_ingredient", text: section.text });
      return;
    }
    if (heading.includes("warning") || heading.includes("caution")) {
      textInputs.push({ source: "warning", text: section.text });
      return;
    }
    if (heading.includes("ingredient")) {
      textInputs.push({ source: "label_disclosure", text: section.text });
    }
  });

  return textInputs;
};

export const extractFromIherbOverlay = (
  input: IherbOverlayAllergenExtractorInput,
): NormalizedAllergenResult => normalizeAllergenTextInputs(buildTextInputs(input));

export const iherbOverlayAllergenExtractorInternals = {
  buildTextInputs,
};
