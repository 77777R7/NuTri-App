import {
  normalizeDescriptionSections,
  normalizeText,
  pickNutritionFacts,
  stableHash,
  toGtin14,
} from "./iherb-overlay-utils.mjs";

const normalizeStringList = (value) =>
  (Array.isArray(value) ? value : [value])
    .map((item) => normalizeText(item))
    .filter(Boolean);

const uniqueStrings = (values) => [...new Set(normalizeStringList(values))];

const isUsIherbUrl = (value) => /^https?:\/\/(?:www\.)?iherb\.com\//i.test(normalizeText(value));

export const normalizeScraplingResult = (raw = {}) => {
  const sections = normalizeDescriptionSections(raw.sections ?? {}, raw.bodyText ?? null);
  const nutritionalFacts = pickNutritionFacts(raw.nutritionalFacts ?? raw.supplementFactsRows ?? []);
  const productImages = normalizeStringList(raw.productImages ?? raw.images ?? []);
  const productCatalogImage =
    normalizeText(raw.productCatalogImage ?? raw.primaryImage ?? productImages[0] ?? null) || null;
  const structuredMetadata = raw?.structuredMetadata && typeof raw.structuredMetadata === "object" ? raw.structuredMetadata : null;
  const supplementFactsArtifacts =
    raw?.supplementFactsArtifacts && typeof raw.supplementFactsArtifacts === "object"
      ? raw.supplementFactsArtifacts
      : null;
  const historicalCarryForward =
    raw?.historicalCarryForward && typeof raw.historicalCarryForward === "object"
      ? raw.historicalCarryForward
      : null;
  return {
    pageUrl: normalizeText(raw.pageUrl ?? raw.url ?? null) || null,
    finalUrl: normalizeText(raw.finalUrl ?? raw.pageUrl ?? raw.url ?? null) || null,
    title: normalizeText(raw.title ?? null) || null,
    bodyText: normalizeText(raw.bodyText ?? raw.text ?? null) || null,
    descriptionSections: sections,
    supplementFacts: {
      servingSize: normalizeText(raw.servingSize ?? null) || null,
      servingsPerContainer: normalizeText(raw.servingsPerContainer ?? null) || null,
      nutritionalFacts,
    },
    productCatalogImage,
    productImages,
    categories: normalizeStringList(raw.categories ?? []),
    dosageForm: normalizeText(raw.dosageForm ?? null) || null,
    structuredMetadata,
    supplementFactsArtifacts,
    sourceDiagnostics: {
      fetcher: normalizeText(raw.fetcher ?? "scrapling"),
      mode: normalizeText(raw.mode ?? null) || null,
      headerStrategy: normalizeText(raw.headerStrategy ?? null) || null,
      supplementFactsSource: normalizeText(raw.supplementFactsSource ?? null) || null,
      blocked: Boolean(raw.blocked),
      dynamicResolved: Boolean(raw.dynamicResolved),
      structuredMetadataKinds: normalizeStringList(structuredMetadata?.detectedKinds ?? []),
      hasPrimaryStructuredProduct: Boolean(structuredMetadata?.primaryProduct),
      supplementFactsImageUrls: normalizeStringList(supplementFactsArtifacts?.imageUrls ?? []),
      supplementFactsPdfUrls: normalizeStringList(supplementFactsArtifacts?.pdfUrls ?? []),
      supplementFactsEvidenceUrl: normalizeText(supplementFactsArtifacts?.evidenceUrl ?? null) || null,
      supplementFactsPdfDownloadMode: normalizeText(supplementFactsArtifacts?.pdfDownloadMode ?? null) || null,
      supplementFactsPdfTempFileDeleted: Boolean(supplementFactsArtifacts?.pdfTempFileDeleted),
      historicalCarryForwardApplied: Boolean(historicalCarryForward?.applied),
      historicalCarryForwardMatchedBy: normalizeText(historicalCarryForward?.matchedBy ?? null) || null,
      historicalCarryForwardMatchedSourceUrl: normalizeText(historicalCarryForward?.matchedSourceUrl ?? null) || null,
      historicalCarryForwardMatchedProductId: normalizeText(historicalCarryForward?.matchedProductId ?? null) || null,
      historicalCarryForwardReportPath: normalizeText(historicalCarryForward?.reportPath ?? null) || null,
      extractionWarnings: normalizeStringList(raw.extractionWarnings ?? []),
    },
  };
};

export const buildOverlayCandidateFromScrapling = ({
  normalizedResult,
  queueEntry,
  brandName = null,
  sourceNote = "scrapling_worker",
}) => {
  const result = normalizedResult ?? {};
  const looksUnavailable = /temporarily unavailable|page not found|access denied|nestl[eé]/i.test(
    normalizeText(result.title ?? result.bodyText ?? null),
  );
  const barcode = toGtin14(queueEntry?.barcode_gtin14 ?? queueEntry?.upcCode ?? null);
  const title =
    normalizeText((looksUnavailable ? null : result.title) ?? queueEntry?.title ?? queueEntry?.productName ?? null) || null;
  const resolvedBrand = normalizeText(brandName ?? queueEntry?.brandName ?? null) || null;
  const sourceUrl = result.finalUrl ?? result.pageUrl ?? null;
  const sourceUrls = uniqueStrings([sourceUrl, result.pageUrl, queueEntry?.link]);
  const hasUsIherbPage = Boolean(queueEntry?.hasUsIherbPage) || sourceUrls.some(isUsIherbUrl);
  return {
    productId: normalizeText(queueEntry?.productId ?? null) || null,
    barcode_gtin14: barcode,
    brandName: resolvedBrand,
    title,
    categories: result.categories ?? [],
    dosageForm: result.dosageForm ?? null,
    productCatalogImage: result.productCatalogImage ?? null,
    productImages: result.productImages ?? [],
    descriptionSections: result.descriptionSections ?? {},
    supplementFacts: result.supplementFacts ?? {
      servingSize: null,
      servingsPerContainer: null,
      nutritionalFacts: [],
    },
    structuredMetadata: result.structuredMetadata ?? null,
    supplementFactsArtifacts: result.supplementFactsArtifacts ?? null,
    sourceSummary: {
      sourceKind: "scrapling_official_fallback",
      sourceTypes: ["scrapling_product_page"],
      marketSources: hasUsIherbPage ? ["us"] : [],
      sourceUrls,
      sourceNotes: [sourceNote],
      npnIgnored: false,
      hasUsIherbPage,
      sourceRank: 85,
    },
    fetchDiagnostics: result.sourceDiagnostics ?? {},
    scraplingHash: stableHash({
      barcode_gtin14: barcode,
      title,
      sourceUrl,
      sections: result.descriptionSections ?? {},
      facts: result.supplementFacts ?? {},
    }),
  };
};
