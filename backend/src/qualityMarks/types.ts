export type QualityMarkStatus = "detected" | "not_detected" | "unknown";

export type QualityMarkConfidenceBucket = "high" | "medium" | "low";

export type QualityMarkProviderSource = {
  url: string;
  sourceType: "brand_official" | "retailer_marketplace" | "retailer_other";
  title?: string | null;
};

export type QualityMarkAuditEntry = {
  key: string;
  status: QualityMarkStatus;
  checked: boolean;
  confidence: number | null;
  confidenceBucket: QualityMarkConfidenceBucket;
  evidenceRef: string | null;
  evidenceType: "page" | "search" | null;
  checkedMode: "search_only" | "page_fetch";
  pagesFetchedCount: number;
  searchPagesFetchedCount: number;
  sourcesTried: string[];
  sourcePriority: Array<QualityMarkProviderSource["sourceType"]>;
  checkedAt: string;
  expiresAt: string;
  error: string | null;
};

export type QualityMarkCacheFile = {
  schemaVersion: string;
  ttlDays: number;
  updatedAt: string;
  entries: Record<string, QualityMarkAuditEntry>;
};

export type QualityMarkLookupInput = {
  identityType?: string | null;
  identityValue?: string | null;
  sourceType?: string | null;
  brandName?: string | null;
  productName?: string | null;
};
