import { getQualityMarkProgramDefinition, QUALITY_MARK_PROGRAMS } from "./programs.js";
import type {
  QualityMarkEvidenceType,
  QualityMarkMatchLevel,
  QualityMarkProgramId,
  QualityMarkProgramMatch,
  QualityMarkProgramStatus,
  QualityMarkProviderSource,
  QualityMarkVerificationSummary,
} from "./types.js";

export const normalizeQualityMarkText = (value: string): string => value.replace(/\s+/g, " ").trim().toLowerCase();

export const compactQualityMarkText = (value: string): string => value.replace(/[^a-z0-9]+/g, "");

const uniqueStrings = (values: string[]): string[] => Array.from(new Set(values.filter(Boolean)));
const uniqueProgramIds = (values: Array<QualityMarkProgramId | null | undefined>): QualityMarkProgramId[] =>
  Array.from(new Set(values.filter(Boolean))) as QualityMarkProgramId[];
const MATCH_STOPWORDS = new Set(["and", "the", "with", "plus", "for", "from", "of", "to", "a", "an"]);
const PRODUCT_FORM_TOKEN_RE =
  /\b(soft ?gels?|capsules?|caplets?|tablets?|gummies?|servings?|packets?|sachets?|enteric(?: coated)?|coated|liquid|powder|powders|drops|chews?)\b/gi;
const PRODUCT_NUMERIC_TOKEN_RE = /\b\d+(?:\.\d+)?\s*(?:mg|mcg|g|kg|ml|iu)\b/gi;
const PRODUCT_COUNT_TOKEN_RE = /\b\d+\s*(?:soft ?gels?|capsules?|caplets?|tablets?|gummies?|ct|count|servings?)\b/gi;
const PRODUCT_FLAVOR_TOKEN_RE =
  /\b(natural|orange|lemon|vanilla|chocolate|strawberry|raspberry|berry|unflavored|flavor|fish oil)\b/gi;

const tokenizeMatchText = (value: string): string[] =>
  normalizeQualityMarkText(value)
    .split(/[^a-z0-9]+/g)
    .map((token) => token.trim())
    .filter((token) => token.length >= 3 && !MATCH_STOPWORDS.has(token));

const uniqueTokens = (value: string): string[] => Array.from(new Set(tokenizeMatchText(value)));

export const dedupeQualityMarkProgramMatches = (
  matches: QualityMarkProgramMatch[],
): QualityMarkProgramMatch[] => {
  const seen = new Set<string>();
  return matches.filter((match) => {
    const key = [
      match.programId,
      match.status,
      match.matchLevel,
      match.evidenceType,
      match.evidenceUrl ?? "",
      match.brandMatched ? "brand" : "no_brand",
      match.productMatched ? "product" : "no_product",
    ].join("|");
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
};

const includesNormalizedPhrase = (haystack: string, needle: string): boolean => {
  const normalizedHaystack = ` ${normalizeQualityMarkText(haystack)} `;
  const normalizedNeedle = normalizeQualityMarkText(needle);
  if (!normalizedNeedle || normalizedNeedle.length < 3) return false;
  return normalizedHaystack.includes(` ${normalizedNeedle} `);
};

const computeTokenCoverage = (needle: string, haystack: string): number => {
  const needleTokens = uniqueTokens(needle);
  if (needleTokens.length === 0) return 0;
  const haystackTokens = new Set(uniqueTokens(haystack));
  let matched = 0;
  for (const token of needleTokens) {
    if (haystackTokens.has(token)) matched += 1;
  }
  return matched / needleTokens.length;
};

export const stripBrandPrefix = (productName: string, brandName: string): string => {
  const normalizedProduct = normalizeQualityMarkText(productName);
  const normalizedBrand = normalizeQualityMarkText(brandName);
  if (!normalizedProduct || !normalizedBrand) return normalizedProduct;
  if (!normalizedProduct.startsWith(normalizedBrand)) return normalizedProduct;
  return normalizedProduct.slice(normalizedBrand.length).trim();
};

const normalizeStructuredProductCore = (productName: string, brandName: string): string =>
  stripBrandPrefix(productName, brandName)
    .replace(/[®™]/g, " ")
    .replace(PRODUCT_NUMERIC_TOKEN_RE, " ")
    .replace(PRODUCT_COUNT_TOKEN_RE, " ")
    .replace(PRODUCT_FORM_TOKEN_RE, " ")
    .replace(PRODUCT_FLAVOR_TOKEN_RE, " ")
    .replace(/[^a-z0-9]+/gi, " ")
    .replace(/\s+/g, " ")
    .trim();

const extractComparableTexts = (params: { productName: string; brandName: string; candidateTexts: string[] }): string[] => {
  const texts = [
    ...params.candidateTexts.flatMap((candidate) => [
      candidate,
      stripBrandPrefix(candidate, params.brandName),
      normalizeStructuredProductCore(candidate, params.brandName),
    ]),
  ];
  return uniqueStrings(texts.filter((value) => normalizeQualityMarkText(value).length >= 3));
};

export const isBrandLevelOfficialProgramMatch = (match: QualityMarkProgramMatch): boolean =>
  match.mapsToGenericThirdPartyClaim &&
  match.evidenceType === "official_registry" &&
  match.status === "ambiguous_match" &&
  match.matchLevel === "brand" &&
  match.brandMatched &&
  !match.productMatched;

export const isGenericThirdPartyClaimEvidenceMatch = (match: QualityMarkProgramMatch): boolean => {
  if (!match.mapsToGenericThirdPartyClaim) return false;
  if (match.status === "verified_registry_match") return true;
  if (match.status === "claimed_on_product_page" || match.status === "claimed_in_catalog") return true;
  return false;
};

const programPriorityScore = (programId: QualityMarkProgramId): number => {
  switch (programId) {
    case "usp_verified":
      return 50;
    case "nsf_certified_for_sport":
      return 45;
    case "informed_sport":
      return 40;
    case "informed_choice":
      return 38;
    case "ifos":
      return 34;
    case "bscg":
      return 30;
    default:
      return 10;
  }
};

const matchLevelScore = (matchLevel: QualityMarkMatchLevel): number => {
  if (matchLevel === "lot") return 60;
  if (matchLevel === "product") return 35;
  return -15;
};

const programMatchScore = (match: QualityMarkProgramMatch): number => {
  let score = programPriorityScore(match.programId) + matchLevelScore(match.matchLevel);
  if (match.status === "verified_registry_match") score += 400;
  else if (match.status === "claimed_on_product_page") score += 280;
  else if (match.status === "claimed_in_catalog") score += 240;
  else if (match.status === "ambiguous_match") score += match.matchLevel === "brand" ? 70 : 140;
  else if (match.status === "not_found_in_registry") score += 90;
  else score += 25;

  if (match.brandMatched) score += 8;
  if (match.productMatched) score += 20;
  if (match.matchLevel === "brand" && !match.productMatched) score -= 45;
  return score;
};

const pickStrongestProgramMatch = (matches: QualityMarkProgramMatch[]): QualityMarkProgramMatch | null =>
  matches.reduce((best, current) => {
    if (!best) return current;
    const currentScore = programMatchScore(current);
    const bestScore = programMatchScore(best);
    if (currentScore !== bestScore) return currentScore > bestScore ? current : best;
    return current.programLabel.localeCompare(best.programLabel) < 0 ? current : best;
  }, null as QualityMarkProgramMatch | null);

export const evaluateOfficialRegistryTextMatch = (params: {
  registryText: string;
  brandName?: string | null;
  productName?: string | null;
  candidateTexts?: string[];
}): {
  brandMatched: boolean;
  productMatched: boolean;
  productCoverage: number;
} => {
  const registryText = normalizeQualityMarkText(params.registryText);
  const brandName = String(params.brandName ?? "").trim();
  const productName = String(params.productName ?? "").trim();
  const strippedProduct = stripBrandPrefix(productName, brandName);
  const productCore = normalizeStructuredProductCore(productName, brandName);
  const candidateTexts = extractComparableTexts({
    productName,
    brandName,
    candidateTexts: Array.isArray(params.candidateTexts) ? params.candidateTexts : [],
  });
  const comparisonHaystacks = uniqueStrings([registryText, ...candidateTexts.map((value) => normalizeQualityMarkText(value))]);

  const brandMatched =
    comparisonHaystacks.some((haystack) => includesNormalizedPhrase(haystack, brandName)) ||
    Math.max(...comparisonHaystacks.map((haystack) => computeTokenCoverage(brandName, haystack)), 0) >= 0.7;
  const productCoverage = Math.max(
    ...comparisonHaystacks.map((haystack) =>
      Math.max(
        computeTokenCoverage(productName, haystack),
        computeTokenCoverage(strippedProduct, haystack),
        computeTokenCoverage(productCore, haystack),
      ),
    ),
    0,
  );
  const productMatched =
    comparisonHaystacks.some(
      (haystack) =>
        includesNormalizedPhrase(haystack, productName) ||
        includesNormalizedPhrase(haystack, strippedProduct) ||
        (productCore.length >= 6 && includesNormalizedPhrase(haystack, productCore)),
    ) ||
    productCoverage >= (productCore.length >= 6 ? 0.66 : 0.72);

  return {
    brandMatched,
    productMatched,
    productCoverage,
  };
};

export const detectQualityMarkProgramIds = (params: {
  text: string;
  compactText?: string;
  includeNonEquivalent?: boolean;
}): QualityMarkProgramId[] => {
  const compactText = params.compactText ?? compactQualityMarkText(params.text);
  return QUALITY_MARK_PROGRAMS
    .filter((definition) => params.includeNonEquivalent !== false || definition.mapsToGenericThirdPartyClaim)
    .filter(
      (definition) => definition.spacedPattern.test(params.text) || definition.compactPattern.test(compactText),
    )
    .map((definition) => definition.id);
};

export const buildQualityMarkProgramMatches = (params: {
  programIds: QualityMarkProgramId[];
  status: QualityMarkProgramStatus;
  evidenceUrl: string | null;
  evidenceType: Exclude<QualityMarkEvidenceType, null>;
  sourceType: QualityMarkProviderSource["sourceType"];
  confidence: number | null;
  matchLevel?: QualityMarkMatchLevel;
  brandMatched?: boolean;
  productMatched?: boolean;
  note?: string | null;
}): QualityMarkProgramMatch[] => {
  const matchLevel: QualityMarkMatchLevel = params.matchLevel ?? "product";
  return uniqueStrings(params.programIds).flatMap((programId) => {
    const definition = getQualityMarkProgramDefinition(programId as QualityMarkProgramId);
    if (!definition) return [];
    return [
      {
        programId: definition.id,
        programLabel: definition.label,
        registryFamily: definition.registryFamily,
        status: params.status,
        matchLevel,
        evidenceUrl: params.evidenceUrl,
        evidenceType: params.evidenceType,
        lotNumber: null,
        brandMatched: Boolean(params.brandMatched),
        productMatched: Boolean(params.productMatched),
        confidence: params.confidence,
        mapsToGenericThirdPartyClaim: definition.mapsToGenericThirdPartyClaim,
        note: params.note ?? null,
      },
    ];
  });
};

const summaryMergeScore = (summary: QualityMarkVerificationSummary): number => {
  let score = 0;
  if (summary.overallStatus === "verified") score += 400;
  else if (summary.overallStatus === "claimed") score += 300;
  else if (summary.overallStatus === "ambiguous") score += 150;
  else score += 120;

  if (summary.officialRegistryVerified) score += 40;
  if (summary.productPageClaimDetected) score += 20;
  if (summary.officialRegistryChecked) score += 5;
  if (summary.strongestMatchLevel === "lot") score += 40;
  else if (summary.strongestMatchLevel === "product") score += 25;
  else if (summary.strongestMatchLevel === "brand") score -= 20;
  if (summary.warnings.includes("brand_level_only_match")) score -= 40;
  if (summary.warnings.includes("product_match_unresolved_after_brand_hit")) score += 55;
  if (summary.warnings.includes("registry_result_ambiguous")) score += 10;
  if (summary.warnings.includes("registry_access_blocked")) score -= 25;
  if (summary.blockedProgramIds.length > 0) score += 35;
  if (summary.warnings.includes("search_only_evidence")) score -= 25;

  return score;
};

const canPromoteBrandAndProductOfficialPair = (
  left: QualityMarkVerificationSummary,
  right: QualityMarkVerificationSummary,
): boolean => {
  const leftProgramId = left.strongestProgramId;
  const rightProgramId = right.strongestProgramId;
  if (!leftProgramId || !rightProgramId || leftProgramId !== rightProgramId) return false;

  const leftBrand = left.brandLevelOfficialProgramDetected;
  const rightBrand = right.brandLevelOfficialProgramDetected;
  const leftProductUnresolved =
    left.officialRegistryChecked &&
    left.strongestMatchLevel === "product" &&
    left.warnings.includes("product_match_without_brand_confirmation");
  const rightProductUnresolved =
    right.officialRegistryChecked &&
    right.strongestMatchLevel === "product" &&
    right.warnings.includes("product_match_without_brand_confirmation");

  return (leftBrand && rightProductUnresolved) || (rightBrand && leftProductUnresolved);
};

export const summarizeQualityMarkProgramMatches = (params: {
  programMatches: QualityMarkProgramMatch[];
  checked: boolean;
  searchOnlyEvidence?: boolean;
  extraWarnings?: string[];
}): QualityMarkVerificationSummary => {
  const programMatches = dedupeQualityMarkProgramMatches(params.programMatches);
  const genericMatches = programMatches.filter((match) => match.mapsToGenericThirdPartyClaim);
  const officialRegistryMatches = genericMatches.filter((match) => match.evidenceType === "official_registry");
  const brandLevelOfficialMatches = genericMatches.filter(isBrandLevelOfficialProgramMatch);
  const verifiedRegistry = genericMatches.find((match) => match.status === "verified_registry_match") ?? null;
  const pageClaim = genericMatches.find((match) => match.status === "claimed_on_product_page") ?? null;
  const catalogClaim = genericMatches.find((match) => match.status === "claimed_in_catalog") ?? null;
  const notFoundRegistry = genericMatches.find((match) => match.status === "not_found_in_registry") ?? null;
  const ambiguousRegistry = genericMatches.find((match) => match.status === "ambiguous_match") ?? null;
  const evidentiaryGenericMatches = genericMatches.filter(isGenericThirdPartyClaimEvidenceMatch);
  const nonEquivalentMatches = programMatches.filter((match) => !match.mapsToGenericThirdPartyClaim);
  const warnings = [...(params.extraWarnings ?? [])];
  const officialRegistryChecked = officialRegistryMatches.length > 0;
  const blockedPrograms = warnings.includes("registry_access_blocked")
    ? officialRegistryMatches.filter((match) => match.status === "ambiguous_match")
    : [];

  if (nonEquivalentMatches.length > 0) warnings.push("program_not_equivalent_to_generic_third_party");
  if (params.searchOnlyEvidence) warnings.push("search_only_evidence");
  if ((pageClaim || catalogClaim) && !officialRegistryChecked) warnings.push("registry_not_checked");
  if (notFoundRegistry) warnings.push("registry_checked_not_found");
  if (ambiguousRegistry) warnings.push("registry_result_ambiguous");
  if (ambiguousRegistry?.matchLevel === "brand") warnings.push("brand_level_only_match");
  if (brandLevelOfficialMatches.length > 0 && notFoundRegistry) warnings.push("product_match_unresolved_after_brand_hit");

  let overallStatus: QualityMarkVerificationSummary["overallStatus"] = "ambiguous";
  if (verifiedRegistry) overallStatus = "verified";
  else if (pageClaim || catalogClaim) overallStatus = "claimed";
  else if (ambiguousRegistry || nonEquivalentMatches.length > 0 || params.searchOnlyEvidence) overallStatus = "ambiguous";
  else if (
    (programMatches.length === 0 && params.checked && !params.searchOnlyEvidence) ||
    officialRegistryChecked
  ) {
    overallStatus = "not_proven";
  } else if (nonEquivalentMatches.length > 0 || params.searchOnlyEvidence) {
    overallStatus = "ambiguous";
  }
  else if (params.checked) overallStatus = "not_proven";

  const strongest = pickStrongestProgramMatch([
    ...genericMatches,
    ...nonEquivalentMatches,
  ]);

  return {
    overallStatus,
    strongestProgramId: strongest?.programId ?? null,
    strongestProgramLabel: strongest?.programLabel ?? null,
    strongestMatchLevel: strongest?.matchLevel ?? null,
    officialRegistryChecked,
    officialRegistryVerified: Boolean(verifiedRegistry),
    productPageClaimDetected: Boolean(pageClaim),
    catalogClaimDetected: Boolean(catalogClaim),
    genericThirdPartyClaimDetected: evidentiaryGenericMatches.length > 0,
    brandLevelOfficialProgramDetected: brandLevelOfficialMatches.length > 0,
    brandLevelOfficialProgramLabels: uniqueStrings(brandLevelOfficialMatches.map((match) => match.programLabel)),
    blockedProgramIds: uniqueProgramIds(blockedPrograms.map((match) => match.programId)),
    blockedProgramLabels: uniqueStrings(blockedPrograms.map((match) => match.programLabel)),
    warnings: uniqueStrings(warnings),
  };
};

export const mergeQualityMarkSummaries = (
  ...summaries: Array<QualityMarkVerificationSummary | null | undefined>
): QualityMarkVerificationSummary | null => {
  const filtered = summaries.filter(Boolean) as QualityMarkVerificationSummary[];
  if (filtered.length === 0) return null;
  return filtered.reduce((best, current) => {
    const useCurrent = summaryMergeScore(current) > summaryMergeScore(best);
    const strongest = useCurrent ? current : best;
    const promoteToVerified = canPromoteBrandAndProductOfficialPair(best, current);
    const warnings = uniqueStrings([...best.warnings, ...current.warnings]).filter((warning) => {
      if ((best.officialRegistryChecked || current.officialRegistryChecked) && warning === "search_only_evidence") {
        return false;
      }
      if ((best.officialRegistryChecked || current.officialRegistryChecked) && warning === "registry_not_checked") {
        return false;
      }
      if (promoteToVerified && ["brand_level_only_match", "product_match_without_brand_confirmation"].includes(warning)) {
        return false;
      }
      return true;
    });
    const overallStatus = promoteToVerified ? "verified" : strongest.overallStatus;
    return {
      overallStatus,
      strongestProgramId: strongest.strongestProgramId ?? (useCurrent ? best.strongestProgramId : current.strongestProgramId),
      strongestProgramLabel:
        strongest.strongestProgramLabel ?? (useCurrent ? best.strongestProgramLabel : current.strongestProgramLabel),
      strongestMatchLevel:
        promoteToVerified ? "product" : strongest.strongestMatchLevel ?? (useCurrent ? best.strongestMatchLevel : current.strongestMatchLevel),
      officialRegistryChecked: best.officialRegistryChecked || current.officialRegistryChecked,
      officialRegistryVerified: promoteToVerified || best.officialRegistryVerified || current.officialRegistryVerified,
      productPageClaimDetected: best.productPageClaimDetected || current.productPageClaimDetected,
      catalogClaimDetected: best.catalogClaimDetected || current.catalogClaimDetected,
      genericThirdPartyClaimDetected:
        promoteToVerified || best.genericThirdPartyClaimDetected || current.genericThirdPartyClaimDetected,
      brandLevelOfficialProgramDetected:
        best.brandLevelOfficialProgramDetected || current.brandLevelOfficialProgramDetected,
      brandLevelOfficialProgramLabels: uniqueStrings([
        ...best.brandLevelOfficialProgramLabels,
        ...current.brandLevelOfficialProgramLabels,
      ]),
      blockedProgramIds: uniqueProgramIds([
        ...best.blockedProgramIds,
        ...current.blockedProgramIds,
      ]),
      blockedProgramLabels: uniqueStrings([
        ...best.blockedProgramLabels,
        ...current.blockedProgramLabels,
      ]),
      warnings,
    };
  });
};
