import { z } from 'zod';

export const SNAPSHOT_SCHEMA_VERSION = 1 as const;
export const EXCERPT_MAX_CHARS = 600 as const;

const SnapshotStatusSchema = z.enum(['resolved', 'partial', 'unknown_product', 'error']);
const SnapshotSourceSchema = z.enum(['barcode', 'label', 'mixed']);
const SnapshotRegionSchema = z.enum(['US', 'CA', 'global']);

const BarcodeNormalizedFormatSchema = z.enum(['gtin14', 'ean13', 'upca', 'unknown']);
const NormalizedAmountUnitSchema = z.enum(['mg', 'mcg', 'g', 'iu', 'cfu', 'ml']);

const ConfidenceValueSchema = z.number().min(0).max(1).nullable();

const ReferenceItemSchema = z.object({
  id: z.string(),
  sourceType: z.enum(['ODS', 'DSLD', 'LNHPD', 'NSF', 'CLP', 'NUTRASOURCE', 'OTHER']),
  title: z.string(),
  url: z.string(),
  excerpt: z.string().max(EXCERPT_MAX_CHARS),
  retrievedAt: z.string(),
  hash: z.string(),
  evidenceFor: z.enum(['efficacy', 'safety', 'trust', 'regulatory', 'general']),
});

export const SupplementSnapshotSchema = z.object({
  schemaVersion: z.number(),
  snapshotId: z.string(),
  status: SnapshotStatusSchema,
  source: SnapshotSourceSchema,
  region: SnapshotRegionSchema,
  createdAt: z.string(),
  updatedAt: z.string(),
  error: z
    .object({
      code: z.string(),
      message: z.string(),
    })
    .nullable()
    .optional(),
  product: z.object({
    brand: z.string().nullable(),
    name: z.string().nullable(),
    category: z.string().nullable(),
    imageUrl: z.string().nullable(),
    barcode: z.object({
      raw: z.string().nullable(),
      normalized: z.string().nullable(),
      normalizedFormat: BarcodeNormalizedFormatSchema.nullable(),
      isChecksumValid: z.boolean().nullable(),
      variants: z.array(z.string()).nullable(),
    }),
    externalIds: z.object({
      upc: z.string().nullable(),
      ean: z.string().nullable(),
      gtin: z.string().nullable(),
      asin: z.string().nullable(),
    }),
    entityRefs: z.object({
      supplementId: z.string().nullable(),
      brandId: z.string().nullable(),
    }),
  }),
  label: z.object({
    servingSize: z.string().nullable(),
    servingsPerContainer: z.number().nullable(),
    servingsPerContainerText: z.string().nullable(),
    actives: z.array(
      z.object({
        name: z.string(),
        ingredientId: z.string().nullable(),
        amount: z.number().nullable(),
        amountUnit: z.string().nullable(),
        amountUnitRaw: z.string().nullable(),
        amountUnitNormalized: NormalizedAmountUnitSchema.nullable(),
        dvPercent: z.number().nullable(),
        form: z.string().nullable(),
        isProprietaryBlend: z.boolean(),
        amountUnknown: z.boolean(),
        source: z.enum(['label', 'dsld', 'lnhpd', 'manual']),
        confidence: z.number().min(0).max(1).nullable(),
      }),
    ),
    inactive: z.array(
      z.object({
        name: z.string(),
        ingredientId: z.string().nullable(),
        source: z.enum(['label', 'manual']),
      }),
    ),
    proprietaryBlends: z.array(
      z.object({
        name: z.string(),
        totalAmount: z.number().nullable(),
        unit: z.string().nullable(),
        ingredients: z.array(z.string()).nullable(),
      }),
    ),
    extraction: z
      .object({
        parseCoverage: z.number().min(0).max(1).nullable(),
        confidenceScore: z.number().min(0).max(1).nullable(),
        issues: z.array(z.string()).nullable(),
      })
      .nullable(),
  }),
  regulatory: z.object({
    npn: z.string().nullable(),
    npnStatus: z.enum(['verified', 'not_found', 'unknown']).nullable(),
    dsldLabelId: z.string().nullable(),
    regionTags: z.array(z.string()),
    lastCheckedAt: z.string().nullable(),
    sourceUrls: z.array(z.string()).nullable(),
  }),
  trust: z.object({
    overallStatus: z.enum(['verified', 'claimed', 'unknown']),
    signals: z.array(
      z.object({
        programCode: z.string(),
        status: z.enum(['verified', 'claimed', 'unknown']),
        evidenceUrl: z.string().nullable(),
        evidencePayloadSummary: z.record(z.string(), z.unknown()).nullable(),
        evidenceRef: z
          .object({
            hash: z.string(),
            url: z.string(),
            capturedAt: z.string(),
          })
          .nullable(),
        source: z.enum(['public_directory', 'label', 'brand_site', 'manual']),
        lastCheckedAt: z.string().nullable(),
        expiresAt: z.string().nullable(),
      }),
    ),
    claims: z.array(z.string()).nullable(),
  }),
  listings: z.object({
    items: z.array(
      z.object({
        retailer: z.string(),
        title: z.string().nullable(),
        priceAmountMinor: z.number().nullable(),
        currency: z.string().nullable(),
        imageUrl: z.string().nullable(),
        url: z.string().nullable(),
        availability: z.enum(['in_stock', 'out_of_stock', 'unknown']),
        externalIds: z.object({
          upc: z.string().optional(),
          ean: z.string().optional(),
          asin: z.string().optional(),
        }),
        matchConfidence: z.number().min(0).max(1).nullable(),
        lastCheckedAt: z.string().nullable(),
      }),
    ),
    bestOffer: z.number().nullable(),
  }),
  references: z.object({
    items: z.array(ReferenceItemSchema),
  }),
  scores: z
    .object({
      overall: z.number(),
      effectiveness: z.number(),
      safety: z.number(),
      value: z.number(),
      version: z.string(),
      computedAt: z.string(),
      confidence: z.object({
        overall: ConfidenceValueSchema,
        labelCoverage: ConfidenceValueSchema,
        ingredientCoverage: ConfidenceValueSchema,
        priceCoverage: ConfidenceValueSchema,
        trustCoverage: ConfidenceValueSchema,
        regulatoryCoverage: ConfidenceValueSchema,
      }),
    })
    .optional(),
});

export type SupplementSnapshot = z.infer<typeof SupplementSnapshotSchema>;
