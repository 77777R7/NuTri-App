export const SNAPSHOT_SCHEMA_VERSION = 1 as const;
export const EXCERPT_MAX_CHARS = 600 as const;

export type SnapshotStatus = 'resolved' | 'partial' | 'unknown_product' | 'error';
export type SnapshotSource = 'barcode' | 'label' | 'mixed';
export type SnapshotRegion = 'US' | 'CA' | 'global';

export type BarcodeNormalizedFormat = 'gtin14' | 'ean13' | 'upca' | 'unknown';

export type NormalizedAmountUnit = 'mg' | 'mcg' | 'g' | 'iu' | 'cfu' | 'ml';

export type SupplementSnapshot = {
  schemaVersion: number;
  snapshotId: string;
  status: SnapshotStatus;
  source: SnapshotSource;
  region: SnapshotRegion;
  createdAt: string;
  updatedAt: string;
  error?: {
    code: string;
    message: string;
  } | null;
  product: {
    brand: string | null;
    name: string | null;
    category: string | null;
    imageUrl: string | null;
    barcode: {
      raw: string | null;
      normalized: string | null;
      normalizedFormat: BarcodeNormalizedFormat | null;
      isChecksumValid: boolean | null;
      variants: string[] | null;
    };
    externalIds: {
      upc: string | null;
      ean: string | null;
      gtin: string | null;
      asin: string | null;
    };
    entityRefs: {
      supplementId: string | null;
      brandId: string | null;
    };
  };
  label: {
    servingSize: string | null;
    servingsPerContainer: number | null;
    servingsPerContainerText: string | null;
    actives: Array<{
      name: string;
      ingredientId: string | null;
      amount: number | null;
      amountUnit: string | null;
      amountUnitRaw: string | null;
      amountUnitNormalized: NormalizedAmountUnit | null;
      dvPercent: number | null;
      form: string | null;
      isProprietaryBlend: boolean;
      amountUnknown: boolean;
      source: 'label' | 'dsld' | 'lnhpd' | 'manual';
      confidence: number | null;
    }>;
    inactive: Array<{
      name: string;
      ingredientId: string | null;
      source: 'label' | 'manual';
    }>;
    proprietaryBlends: Array<{
      name: string;
      totalAmount: number | null;
      unit: string | null;
      ingredients: string[] | null;
    }>;
    extraction: {
      parseCoverage: number | null;
      confidenceScore: number | null;
      issues: string[] | null;
    } | null;
  };
  regulatory: {
    npn: string | null;
    npnStatus: 'verified' | 'not_found' | 'unknown' | null;
    dsldLabelId: string | null;
    regionTags: string[];
    lastCheckedAt: string | null;
    sourceUrls: string[] | null;
  };
  trust: {
    overallStatus: 'verified' | 'claimed' | 'unknown';
    signals: Array<{
      programCode: string;
      status: 'verified' | 'claimed' | 'unknown';
      evidenceUrl: string | null;
      evidencePayloadSummary: Record<string, unknown> | null;
      evidenceRef: {
        hash: string;
        url: string;
        capturedAt: string;
      } | null;
      source: 'public_directory' | 'label' | 'brand_site' | 'manual';
      lastCheckedAt: string | null;
      expiresAt: string | null;
    }>;
    claims: string[] | null;
  };
  listings: {
    items: Array<{
      retailer: string;
      title: string | null;
      priceAmountMinor: number | null;
      currency: string | null;
      imageUrl: string | null;
      url: string | null;
      availability: 'in_stock' | 'out_of_stock' | 'unknown';
      externalIds: {
        upc?: string;
        ean?: string;
        asin?: string;
      };
      matchConfidence: number | null;
      lastCheckedAt: string | null;
    }>;
    bestOffer: number | null;
  };
  references: {
    items: Array<{
      id: string;
      sourceType: 'ODS' | 'DSLD' | 'LNHPD' | 'NSF' | 'CLP' | 'NUTRASOURCE' | 'OTHER';
      title: string;
      url: string;
      excerpt: string;
      retrievedAt: string;
      hash: string;
      evidenceFor: 'efficacy' | 'safety' | 'trust' | 'regulatory' | 'general';
    }>;
  };
  scores?: {
    overall: number;
    effectiveness: number;
    safety: number;
    value: number;
    version: string;
    computedAt: string;
    confidence: {
      overall: number | null;
      labelCoverage: number | null;
      ingredientCoverage: number | null;
      priceCoverage: number | null;
      trustCoverage: number | null;
      regulatoryCoverage: number | null;
    };
  };
};
