export type QualityMarkStatus = "detected" | "not_detected" | "unknown";

export type QualityMarkConfidenceBucket = "high" | "medium" | "low";

export type QualityMarkProgramId =
  | "nsf_certified_for_sport"
  | "usp_verified"
  | "informed_choice"
  | "informed_sport"
  | "ifos"
  | "bscg"
  | "consumerlab_review"
  | "igen"
  | "itested"
  | "labdoor";

export type QualityMarkRegistryFamily =
  | "nsf"
  | "usp"
  | "lgc_informed"
  | "nutrasource"
  | "bscg"
  | "secondary_reference";

export type QualityMarkTermClass = "third_party_testing" | "secondary_reference";

export type QualityMarkProgramStatus =
  | "verified_registry_match"
  | "claimed_on_product_page"
  | "claimed_in_catalog"
  | "not_found_in_registry"
  | "not_checked"
  | "ambiguous_match";

export type QualityMarkMatchLevel = "lot" | "product" | "brand";

export type QualityMarkVerificationSummaryStatus = "verified" | "claimed" | "not_proven" | "ambiguous";

export type QualityMarkEvidenceType = "page" | "search" | "official_registry" | null;

export type QualityMarkCheckedMode = "search_only" | "page_fetch";

export type QualityMarkProgramMatch = {
  programId: QualityMarkProgramId;
  programLabel: string;
  registryFamily: QualityMarkRegistryFamily;
  status: QualityMarkProgramStatus;
  matchLevel: QualityMarkMatchLevel;
  evidenceUrl: string | null;
  evidenceType: Exclude<QualityMarkEvidenceType, null>;
  lotNumber: string | null;
  brandMatched: boolean;
  productMatched: boolean;
  confidence: number | null;
  mapsToGenericThirdPartyClaim: boolean;
  note: string | null;
};

export type QualityMarkVerificationSummary = {
  overallStatus: QualityMarkVerificationSummaryStatus;
  strongestProgramId: QualityMarkProgramId | null;
  strongestProgramLabel: string | null;
  strongestMatchLevel: QualityMarkMatchLevel | null;
  officialRegistryChecked: boolean;
  officialRegistryVerified: boolean;
  productPageClaimDetected: boolean;
  catalogClaimDetected: boolean;
  genericThirdPartyClaimDetected: boolean;
  brandLevelOfficialProgramDetected: boolean;
  brandLevelOfficialProgramLabels: string[];
  blockedProgramIds: QualityMarkProgramId[];
  blockedProgramLabels: string[];
  warnings: string[];
};

export type QualityMarkFetchResult = {
  ok: boolean;
  body: string | null;
  error: string | null;
  statusCode: number | null;
  contentType: string | null;
};

export type QualityMarkProviderSource = {
  url: string;
  sourceType: "brand_official" | "retailer_marketplace" | "retailer_other" | "official_registry";
  title?: string | null;
  programId?: QualityMarkProgramId | null;
  adapterKind?:
    | "nsf_search"
    | "usp_listing"
    | "informed_choice_search"
    | "informed_sport_search"
    | "nutrasource_brand_search"
    | "nutrasource_brand_detail"
    | "nutrasource_product_search"
    | "nutrasource_product_detail"
    | null;
  responseFormat?: "html" | "json";
  brandName?: string | null;
  productName?: string | null;
  queryText?: string | null;
  brandId?: string | null;
  productNum?: string | null;
};

export type QualityMarkAuditEntry = {
  key: string;
  status: QualityMarkStatus;
  checked: boolean;
  confidence: number | null;
  confidenceBucket: QualityMarkConfidenceBucket;
  evidenceRef: string | null;
  evidenceType: QualityMarkEvidenceType;
  checkedMode: QualityMarkCheckedMode;
  pagesFetchedCount: number;
  searchPagesFetchedCount: number;
  sourcesTried: string[];
  sourcePriority: Array<QualityMarkProviderSource["sourceType"]>;
  programMatches?: QualityMarkProgramMatch[];
  verificationSummary?: QualityMarkVerificationSummary | null;
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
