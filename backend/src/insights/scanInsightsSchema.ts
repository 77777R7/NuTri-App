import { z } from 'zod';

const nonEmptyString = z.string().trim().min(1);
const isoDateTimeSchema = z.string().datetime({ offset: true });

export const missingReasonSchema = z.enum([
  'missing_directions',
  'missing_warnings',
  'missing_amounts',
  'missing_units',
  'missing_form',
  'multiple_label_entries',
  'source_low_quality',
  'partial_record',
]);

export const factSourceSchema = z.enum(['lnhpd', 'dsld', 'web']);

const identitySchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('npn'), value: nonEmptyString }),
  z.object({ kind: z.literal('dsld_label_id'), value: nonEmptyString }),
  z.object({ kind: z.literal('gtin14'), value: nonEmptyString }),
  z.object({ kind: z.literal('web_canonical_id'), value: nonEmptyString }),
]);

const factSourceRefSchema = z
  .object({
    kind: z.enum(['reg', 'label', 'web']),
    title: z.string().trim().min(1).nullable().optional(),
    url: z.string().trim().url().nullable().optional(),
    domain: z.string().trim().min(1).nullable().optional(),
    quality: z.enum(['high', 'medium', 'low']).nullable().optional(),
  })
  .strict();

const activeIngredientFactSchema = z
  .object({
    name: nonEmptyString,
    nameRaw: z.string().trim().min(1).nullable().optional(),
    amount: z.number().finite().nullable().optional(),
    unit: z.string().trim().min(1).nullable().optional(),
    per: z.enum(['serving', 'dose', 'unknown']).optional(),
    formText: z.string().trim().min(1).nullable().optional(),
    formTextSource: z.enum(['ingredient_name', 'source_material', 'none']).optional(),
    notes: z.array(nonEmptyString).optional(),
  })
  .strict();

const usageFactSchema = z
  .object({
    route: z.enum(['oral', 'topical', 'other', 'unknown']),
    dosageForm: z.string().trim().min(1).nullable().optional(),
    servingSizeText: z.string().trim().min(1).nullable().optional(),
    servingsPerContainer: z.number().finite().nullable().optional(),
    directionsText: z.string().trim().min(1).nullable().optional(),
    timesPerDay: z.number().finite().nullable().optional(),
    population: z.enum(['adults', 'adolescents', 'children', 'general', 'unknown']).nullable().optional(),
    dose: z
      .object({
        population: z.enum(['adults', 'adolescents', 'children', 'unknown']).optional(),
        quantity: z.number().finite().nullable().optional(),
        quantityUnit: z.string().trim().min(1).nullable().optional(),
        frequencyMin: z.number().finite().nullable().optional(),
        frequencyMax: z.number().finite().nullable().optional(),
        frequencyUnit: z.string().trim().min(1).nullable().optional(),
      })
      .strict()
      .nullable()
      .optional(),
  })
  .strict();

export const factsDtoSchemaV2 = z
  .object({
    meta: z
      .object({
        source: factSourceSchema,
        sourceId: nonEmptyString,
        fetchedAt: isoDateTimeSchema,
      })
      .strict(),
    identity: identitySchema,
    product: z
      .object({
        name: z.string().trim().min(1).nullable(),
        brand: z.string().trim().min(1).nullable().optional(),
        category: z.string().trim().min(1).nullable().optional(),
        imageUrl: z.string().trim().url().nullable().optional(),
      })
      .strict(),
    serving: z
      .object({
        servingSizeText: z.string().trim().min(1).nullable().optional(),
        servingsPerContainer: z.number().finite().nullable().optional(),
      })
      .strict(),
    ingredients: z
      .object({
        actives: z.array(activeIngredientFactSchema),
        inactives: z.array(nonEmptyString).optional(),
        proprietaryBlends: z
          .array(
            z
              .object({
                name: nonEmptyString,
                items: z.array(nonEmptyString).optional(),
              })
              .strict(),
          )
          .optional(),
      })
      .strict(),
    usage: usageFactSchema,
    safety: z
      .object({
        labelWarnings: z.array(nonEmptyString).optional(),
      })
      .strict(),
    provenance: z
      .object({
        source: factSourceSchema,
        extractedAt: isoDateTimeSchema.nullable().optional(),
        datasetVersion: z.string().trim().min(1).nullable().optional(),
        sourceFiles: z
          .object({
            pdf: z.string().trim().url().nullable().optional(),
            thumbnail: z.string().trim().url().nullable().optional(),
          })
          .strict()
          .nullable()
          .optional(),
      })
      .strict(),
    sources: z.array(factSourceRefSchema),
    dataQuality: z
      .object({
        overallStatus: z.enum(['complete', 'limited', 'not_provided']),
        isComplete: z.boolean().nullable().optional(),
        missingFields: z.array(nonEmptyString).optional(),
        missingReasons: z.array(missingReasonSchema).optional(),
        notes: z.array(nonEmptyString).optional(),
      })
      .strict(),
  })
  .strict();

const layerTagSchema = z.enum(['Facts', 'Dataset', 'ReviewedKB', 'ODS']);

export const insightsDtoSchemaV2 = z
  .object({
    meta: z.object({ datasetVersion: z.string().trim().min(1).nullable() }).strict(),
    keyIngredients: z
      .object({
        selected: z.array(
          z
            .object({ ingredientName: nonEmptyString, ingredientId: z.string().trim().min(1).nullable().optional() })
            .strict(),
        ),
        selectionReason: nonEmptyString,
      })
      .strict(),
    keyIngredientsInsights: z.array(
      z
        .object({
          name: nonEmptyString,
          ingredientId: z.string().trim().min(1).nullable().optional(),
          form: z
            .object({
              text: z.string().trim().min(1).nullable(),
              source: z.enum(['facts', 'inferred', 'none']),
              matchScore: z.number().finite().nullable().optional(),
              evidenceGrade: z.string().trim().min(1).nullable().optional(),
            })
            .strict(),
          rbf: z
            .object({
              factor: z.number().finite().nullable(),
              band: z.enum(['high', 'normal', 'low', 'unknown']),
            })
            .strict(),
          dose: z
            .object({
              dailyAmount: z.number().finite().nullable().optional(),
              unit: z.string().trim().min(1).nullable().optional(),
              rangeMin: z.number().finite().nullable().optional(),
              rangeMax: z.number().finite().nullable().optional(),
              status: z.enum(['below_typical', 'within_typical', 'above_typical', 'unknown']),
            })
            .strict(),
          whyBullets: z.array(nonEmptyString).min(1),
          layerTags: z.array(layerTagSchema),
          confidenceNote: nonEmptyString,
        })
        .strict(),
    ),
    assumptions: z
      .object({
        dailyMultiplierSource: z.enum(['label', 'heuristic', 'unknown']),
        dailyMultiplierReliability: z.enum(['reliable', 'partial', 'unknown']),
        notes: z.array(nonEmptyString),
      })
      .strict(),
    summary: z
      .object({
        tldr: nonEmptyString,
        highlights: z.array(nonEmptyString),
        caveats: z.array(nonEmptyString),
        confidence_note: nonEmptyString,
        sources_used: z
          .object({
            facts: z.boolean(),
            dataset: z.boolean(),
            reviewedKB: z.boolean(),
            ods: z.boolean(),
          })
          .strict(),
        fallbackUsed: z.boolean(),
      })
      .strict()
      .nullable(),
  })
  .strict();

export type FactsDTOv2 = z.infer<typeof factsDtoSchemaV2>;
export type InsightsDTOv2 = z.infer<typeof insightsDtoSchemaV2>;

export const sanitizeFactsDTOv2 = (input: unknown): FactsDTOv2 => factsDtoSchemaV2.parse(input);
export const sanitizeInsightsDTOv2 = (input: unknown): InsightsDTOv2 => insightsDtoSchemaV2.parse(input);
