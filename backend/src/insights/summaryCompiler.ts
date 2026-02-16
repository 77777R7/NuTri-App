import { z } from "zod";

import type { LlmVerifierReasonCode } from "./reasonCodes.js";

const sourceUsedSchema = z.enum(["Facts", "Dataset", "KB", "ODS"]);

const packetSchema = z
  .object({
    ingredient: z
      .object({
        name: z.string().trim().min(1),
        amount: z.number().finite().nullable().optional(),
        unit: z.string().trim().min(1).nullable().optional(),
        form: z.string().trim().min(1).nullable().optional(),
      })
      .strict(),
    productSpecificInsights: z
      .array(
        z
          .object({
            type: z.string().trim().min(1),
            text: z.string().trim().min(1),
            source: sourceUsedSchema,
          })
          .strict(),
      )
      .default([]),
    safety: z
      .array(
        z
          .object({
            text: z.string().trim().min(1),
            source: sourceUsedSchema,
            assumptionBased: z.boolean().optional(),
          })
          .strict(),
      )
      .default([]),
    generalBackground: z
      .array(
        z
          .object({
            text: z.string().trim().min(1),
            source: sourceUsedSchema,
          })
          .strict(),
      )
      .default([]),
  })
  .strict();

export type IngredientSummaryPacket = z.infer<typeof packetSchema>;

export type IngredientSummaryResponse = {
  tldr: string;
  highlights: string[];
  caveats: string[];
  confidenceNote: string;
  sourcesUsed: Array<"Facts" | "Dataset" | "KB" | "ODS">;
  reasonCode: LlmVerifierReasonCode;
};

const disallowedMedicalClaims = [
  "cure",
  "treat",
  "heal",
  "guarantee",
  "clinical proof",
  "proven to",
];

const containsDisallowed = (text: string): boolean => {
  const normalized = text.toLowerCase();
  return disallowedMedicalClaims.some((token) => normalized.includes(token));
};

const asSentence = (text: string): string => {
  const trimmed = text.trim();
  if (!trimmed) return "";
  return /[.!?]$/.test(trimmed) ? trimmed : `${trimmed}.`;
};

const dedupe = <T extends string>(items: T[]): T[] => {
  const set = new Set<string>();
  const out: T[] = [];
  items.forEach((item) => {
    const key = item.trim();
    if (!key || set.has(key)) return;
    set.add(key);
    out.push(item);
  });
  return out;
};

const fallbackSummary = (packet: IngredientSummaryPacket): IngredientSummaryResponse => {
  const highlights = dedupe(
    packet.productSpecificInsights
      .slice(0, 3)
      .map((item) => asSentence(item.text))
      .filter(Boolean),
  );
  const caveats = dedupe(
    packet.safety
      .slice(0, 2)
      .map((item) => asSentence(item.text))
      .filter(Boolean),
  );
  const background = packet.generalBackground[0]?.text ? asSentence(packet.generalBackground[0].text) : null;

  const amountText =
    typeof packet.ingredient.amount === "number" && packet.ingredient.unit
      ? `${packet.ingredient.amount} ${packet.ingredient.unit}`
      : "label amount not disclosed";
  const formText = packet.ingredient.form ? `Form: ${packet.ingredient.form}.` : "Form not disclosed; we do not assume.";

  const tldr = asSentence(
    `${packet.ingredient.name} in this product is analyzed using verified facts (${amountText}). ${formText}`,
  );

  return {
    tldr,
    highlights: highlights.length ? highlights : ["Product-specific insights are limited for this ingredient."],
    caveats: caveats.length ? caveats : background ? [background] : ["No additional caveats available from verified inputs."],
    confidenceNote: "Deterministic fallback used from verified packet inputs.",
    sourcesUsed: dedupe(
      [
        ...packet.productSpecificInsights.map((item) => item.source),
        ...packet.safety.map((item) => item.source),
        ...packet.generalBackground.map((item) => item.source),
      ] as Array<"Facts" | "Dataset" | "KB" | "ODS">,
    ),
    reasonCode: "LLM_FALLBACK_USED",
  };
};

export const compileIngredientSummary = (input: unknown): IngredientSummaryResponse => {
  const parsed = packetSchema.parse(input);
  const fallback = fallbackSummary(parsed);

  const allText = [fallback.tldr, ...fallback.highlights, ...fallback.caveats].join(" ");
  if (containsDisallowed(allText)) {
    return {
      ...fallback,
      reasonCode: "LLM_VERIFIER_FAIL_NON_JSON",
      confidenceNote: "Summary blocked by verifier policy; deterministic fallback applied.",
    };
  }

  return {
    ...fallback,
    reasonCode: "LLM_VERIFIER_PASS",
    confidenceNote: "Verifier passed on deterministic summary.",
  };
};

export const ingredientSummaryPacketSchema = packetSchema;
