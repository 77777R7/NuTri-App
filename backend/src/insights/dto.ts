import { z } from "zod";

const nonEmptyString = z.string().trim().min(1);

export const factsSourceSchema = z.enum(["label_scan", "lnhpd", "dsld", "web_verified"]);

export const factsIngredientSchema = z
  .object({
    name: nonEmptyString,
    amount: z.number().finite().nullable(),
    unit: z.string().trim().min(1).nullable(),
    formText: z.string().trim().min(1).nullable().optional(),
    isBlendPlaceholder: z.boolean().optional(),
  })
  .strict();

export const factsUsageSchema = z
  .object({
    servingsPerDay: z.number().finite().positive().nullable().optional(),
    directionsRaw: z.string().trim().min(1).nullable().optional(),
  })
  .strict();

export const factsDtoSchema = z
  .object({
    source: factsSourceSchema,
    sourceId: nonEmptyString,
    canonicalSourceId: z.string().trim().min(1).nullable().optional(),
    barcode: z.string().trim().min(8).max(20),
    product: z
      .object({
        brandName: z.string().trim().min(1).nullable().optional(),
        productName: z.string().trim().min(1).nullable().optional(),
      })
      .strict()
      .optional(),
    usage: factsUsageSchema.optional(),
    ingredients: z.array(factsIngredientSchema).min(1),
    provenance: z
      .object({
        sourceUrl: z.string().url().nullable().optional(),
        extractedAt: z.string().datetime().nullable().optional(),
      })
      .strict()
      .optional(),
  })
  .strict();

export type FactsDTO = z.infer<typeof factsDtoSchema>;

export const insightsDtoSchema = z
  .object({
    ingredientName: nonEmptyString,
    formExplain: z.string().trim().min(1).nullable().optional(),
    rbfBand: z.enum(["high", "normal", "low", "unknown"]).optional(),
    confidenceTier: z.enum(["high", "medium", "low", "none"]).optional(),
    reasonCode: z.string().trim().min(1).optional(),
  })
  .strict();

export type InsightsDTO = z.infer<typeof insightsDtoSchema>;

export const backgroundDtoSchema = z
  .object({
    ingredientName: nonEmptyString,
    kind: z.enum(["ods", "curated"]),
    summary: z.string().trim().min(1),
    watchOuts: z.array(nonEmptyString).max(6).optional(),
    sourceUrl: z.string().url().nullable().optional(),
  })
  .strict();

export type BackgroundDTO = z.infer<typeof backgroundDtoSchema>;

const FORBIDDEN_ROOT_KEYS = new Set([
  "formExplain",
  "rbfBand",
  "doseAdequacy",
  "reasonCode",
  "insights",
]);

const FORBIDDEN_INGREDIENT_KEYS = new Set([
  "formExplain",
  "rbfBand",
  "doseAdequacy",
  "confidenceTier",
  "reasonCode",
  "ulRisk",
]);

export const sanitizeFactsDTO = (input: unknown): FactsDTO => {
  const parsed = factsDtoSchema.parse(input);

  Object.keys(parsed as Record<string, unknown>).forEach((key) => {
    if (FORBIDDEN_ROOT_KEYS.has(key)) {
      throw new Error(`derived_field_not_allowed:${key}`);
    }
  });

  parsed.ingredients.forEach((ingredient, index) => {
    Object.keys(ingredient as Record<string, unknown>).forEach((key) => {
      if (FORBIDDEN_INGREDIENT_KEYS.has(key)) {
        throw new Error(`derived_field_not_allowed:ingredients[${index}].${key}`);
      }
    });
  });

  return parsed;
};
