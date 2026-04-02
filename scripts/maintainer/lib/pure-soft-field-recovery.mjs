import fs from "node:fs/promises";
import path from "node:path";

const ROOT = process.cwd();
const DEFAULT_HISTORY_JSON = path.join(
  ROOT,
  "output",
  "p0_p3_v1_strict_only_merge_cohort_20260318",
  "v1_strict_only_full_staging.json",
);
const DEFAULT_READER_PREFIX = "https://r.jina.ai/http://";
const SOFT_FIELD_NAMES = new Set(["suggested_use", "warnings", "product_image"]);

export const PURE_SOFT_FIELD_RECOVERY_CONFIG = {
  "39630038401058": {
    strategy: "history",
    historyProductId: "19047",
  },
  "32040792981538": {
    strategy: "history",
    historyProductId: "51826",
  },
  "33055638159394": {
    strategy: "exact_official",
    pageUrl: "https://www.pureencapsulationspro.com/glucosamine-sulfate-1000-mg.html",
    pdfUrl: "https://www.pureencapsulationspro.com/media/pdf_upload/Pure_PIS_GlucosamineSulfate1000.pdf",
  },
  "33055577636898": {
    strategy: "exact_official",
    pageUrl: "https://www.pureencapsulationspro.com/q-gel-100-mg-60-s.html",
    pdfUrl: "https://www.pureencapsulationspro.com/media/pdf_upload/PURE_PIS_QGel.pdf",
  },
};

const historyIndexCache = new Map();
const readerCache = new Map();

const normalizeText = (value) => String(value ?? "").trim();
const normalizeLower = (value) => normalizeText(value).toLowerCase();
const hasText = (value) => normalizeText(value).length > 0;
const toArray = (value) => (Array.isArray(value) ? value : []);
const toUnique = (values) => [...new Set(toArray(values).map((item) => normalizeText(item)).filter(Boolean))];
const firstText = (...values) => values.map((value) => normalizeText(value)).find(Boolean) ?? null;

const escapeRegExp = (value) => String(value ?? "").replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

const cleanReaderSectionText = (value) =>
  normalizeText(
    String(value ?? "")
      .replace(/!\[[^\]]*\]\([^)]+\)/g, " ")
      .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1")
      .replace(/^\s*[*-]\s*/gm, "")
      .replace(/\r/g, "\n")
      .replace(/\u00a0/g, " ")
      .replace(/\s+/g, " "),
  );

const getBaseRow = (row, currentRow = null) => currentRow ?? row ?? {};

const getKnownLink = (row) => firstText(row?.link, row?.productPageUrl, toArray(row?.knownProductUrls)[0] ?? null);

const getSourceSummaryFromRow = (row) => {
  if (row?.sourceSummary && typeof row.sourceSummary === "object") {
    return row.sourceSummary;
  }
  return {
    sourceKind: "seed_catalog",
    sourceTypes: toUnique(row?.sourceTypes ?? []),
    marketSources: toUnique(row?.marketSources ?? []),
    sourceUrls: toUnique([getKnownLink(row)]),
    sourceNotes: [],
    npnIgnored: false,
    hasUsIherbPage: false,
    sourceRank: 60,
  };
};

const loadHistoryIndex = async (historyJsonPath = DEFAULT_HISTORY_JSON) => {
  const resolvedPath = path.resolve(ROOT, historyJsonPath);
  if (historyIndexCache.has(resolvedPath)) return historyIndexCache.get(resolvedPath);
  const promise = (async () => {
    const raw = JSON.parse(await fs.readFile(resolvedPath, "utf8"));
    const rows = Array.isArray(raw) ? raw : (raw.products ?? []);
    return new Map(rows.map((row) => [normalizeText(row?.productId), row]));
  })();
  historyIndexCache.set(resolvedPath, promise);
  return promise;
};

const fetchReaderMarkdown = async (sourceUrl, readerPrefix = DEFAULT_READER_PREFIX) => {
  const cacheKey = `${normalizeText(readerPrefix)}|${normalizeText(sourceUrl)}`;
  if (!normalizeText(sourceUrl)) return null;
  if (readerCache.has(cacheKey)) return readerCache.get(cacheKey);
  const promise = (async () => {
    const response = await fetch(`${readerPrefix}${sourceUrl}`, {
      headers: {
        "User-Agent": "Mozilla/5.0",
        Accept: "text/plain,text/markdown;q=0.9,*/*;q=0.8",
      },
    });
    if (!response.ok) {
      throw new Error(`reader_fetch_failed:${response.status}:${sourceUrl}`);
    }
    return response.text();
  })();
  readerCache.set(cacheKey, promise);
  return promise;
};

const parseMarkdownSection = (markdown, sectionName) => {
  const escaped = escapeRegExp(sectionName);
  const match = String(markdown ?? "").match(
    new RegExp(String.raw`(?:^|\n)##+\s+${escaped}\s*\n([\s\S]*?)(?=\n##+\s+|$)`, "i"),
  );
  if (!match) return null;
  return cleanReaderSectionText(match[1]) || null;
};

const extractCatalogImages = (markdown) =>
  toUnique(
    [...String(markdown ?? "").matchAll(/!\[[^\]]*\]\((https?:\/\/[^)\s]+media\/catalog\/product\/[^)\s]+)\)/gi)]
      .map((match) => match[1])
      .slice(0, 6),
  );

const buildCandidateShape = ({
  row,
  currentRow = null,
  descriptionSections = {},
  productCatalogImage = null,
  productImages = [],
  sourceKind,
  sourceUrls = [],
  sourceNotes = [],
  extractionWarnings = [],
  includeExtendedSections = false,
}) => {
  const baseRow = getBaseRow(row, currentRow);
  const baseSummary = getSourceSummaryFromRow(baseRow);
  const baseSections = includeExtendedSections ? (currentRow?.descriptionSections ?? {}) : {};
  return {
    brandName: firstText(baseRow?.brandName, baseRow?.brand, row?.brandName, "Pure Encapsulations"),
    title: firstText(row?.title, baseRow?.title),
    normalizedTitle: normalizeLower(firstText(row?.title, baseRow?.title)),
    productId: firstText(row?.productId, baseRow?.productId),
    upcCode: firstText(baseRow?.upcCode, row?.upcCode),
    barcode_gtin14: firstText(baseRow?.barcode_gtin14, row?.barcode_gtin14),
    link: firstText(getKnownLink(baseRow), getKnownLink(row)),
    productCatalogImage: firstText(productCatalogImage, currentRow?.productCatalogImage),
    productImages: toUnique([
      ...(includeExtendedSections ? toArray(currentRow?.productImages) : []),
      ...productImages,
    ]),
    categories: toUnique(baseRow?.categories ?? row?.categories ?? []),
    count: firstText(baseRow?.count, row?.count),
    dosageForm: firstText(baseRow?.dosageForm, row?.dosageForm),
    serving: includeExtendedSections ? currentRow?.serving ?? null : null,
    supplementFacts: includeExtendedSections ? currentRow?.supplementFacts ?? null : null,
    descriptionSections: {
      ...baseSections,
      ...descriptionSections,
    },
    sourceSummary: {
      sourceKind,
      sourceTypes: toUnique([
        ...(baseSummary?.sourceTypes ?? []),
        ...(row?.sourceTypes ?? []),
        sourceKind === "official_exact_soft_field_recovery" ? "official_product_page" : null,
      ]),
      marketSources: toUnique([
        ...(baseSummary?.marketSources ?? []),
        ...(row?.marketSources ?? []),
      ]),
      sourceUrls: toUnique([
        ...(baseSummary?.sourceUrls ?? []),
        ...(row?.sourceUrls ?? []),
        getKnownLink(row),
        ...sourceUrls,
      ]),
      sourceNotes: toUnique([
        ...(baseSummary?.sourceNotes ?? []),
        ...sourceNotes,
      ]),
      npnIgnored: Boolean(baseSummary?.npnIgnored),
      hasUsIherbPage: Boolean(baseSummary?.hasUsIherbPage),
      sourceRank: 95,
    },
    fetchDiagnostics: {
      extractionWarnings: toUnique(extractionWarnings),
    },
  };
};

const buildHistorySections = (historyRow, { includeExtendedSections = false } = {}) => {
  const historySections = historyRow?.descriptionSections ?? {};
  const keys = includeExtendedSections
    ? ["Suggested use", "Warnings", "Disclaimer", "Other ingredients", "Description"]
    : ["Suggested use", "Warnings", "Disclaimer"];
  const nextSections = {};
  for (const key of keys) {
    if (hasText(historySections[key])) {
      nextSections[key] = normalizeText(historySections[key]);
    }
  }
  if (!hasText(nextSections.Warnings) && hasText(nextSections.Disclaimer)) {
    nextSections.Warnings = normalizeText(nextSections.Disclaimer);
  }
  delete nextSections.Disclaimer;
  return nextSections;
};

const buildHistoryRecoveryBundle = async ({
  row,
  currentRow = null,
  config,
  historyJsonPath = DEFAULT_HISTORY_JSON,
  includeExtendedSections = false,
}) => {
  const historyIndex = await loadHistoryIndex(historyJsonPath);
  const historyRow = historyIndex.get(normalizeText(config.historyProductId));
  if (!historyRow) {
    throw new Error(`history_row_not_found:${config.historyProductId}`);
  }

  const historyImages = toUnique(historyRow?.productImages ?? []).slice(0, 6);
  const candidate = buildCandidateShape({
    row,
    currentRow,
    descriptionSections: buildHistorySections(historyRow, { includeExtendedSections }),
    productCatalogImage: historyRow?.productCatalogImage ?? null,
    productImages: historyImages,
    sourceKind: "historical_soft_field_carry_forward",
    sourceUrls: [
      ...(historyRow?.sourceSummary?.sourceUrls ?? []),
      historyRow?.link ?? null,
    ],
    sourceNotes: [
      ...(historyRow?.sourceSummary?.sourceNotes ?? []),
      "pure_encapsulations_soft_field_carry_forward",
    ],
    extractionWarnings: ["historical_soft_field_carry_forward"],
    includeExtendedSections,
  });

  return {
    unresolvedProductId: row?.productId ?? null,
    unresolvedTitle: row?.title ?? null,
    recoveryStrategy: config.strategy,
    matchedHistoryProductId: historyRow?.productId ?? null,
    matchedHistoryTitle: historyRow?.title ?? null,
    exactPageUrl: config.pageUrl ?? null,
    exactPdfUrl: config.pdfUrl ?? null,
    candidate,
  };
};

const buildExactOfficialRecoveryBundle = async ({
  row,
  currentRow = null,
  config,
  readerPrefix = DEFAULT_READER_PREFIX,
  includeExtendedSections = false,
}) => {
  const pageMarkdown = await fetchReaderMarkdown(config.pageUrl, readerPrefix);
  const pageImages = extractCatalogImages(pageMarkdown);
  const suggestedUse = parseMarkdownSection(pageMarkdown, "Suggested Use");
  const warnings =
    parseMarkdownSection(pageMarkdown, "Warning")
    || parseMarkdownSection(pageMarkdown, "Warnings");

  if (!hasText(suggestedUse) || !hasText(warnings) || pageImages.length === 0) {
    throw new Error(
      `exact_official_soft_field_incomplete:suggested=${Boolean(hasText(suggestedUse))}:warnings=${Boolean(hasText(warnings))}:images=${pageImages.length}`,
    );
  }

  const candidate = buildCandidateShape({
    row,
    currentRow,
    descriptionSections: {
      "Suggested use": suggestedUse,
      Warnings: warnings,
    },
    productCatalogImage: pageImages[0] ?? null,
    productImages: pageImages,
    sourceKind: "official_exact_soft_field_recovery",
    sourceUrls: [config.pageUrl ?? null, config.pdfUrl ?? null],
    sourceNotes: ["pure_encapsulations_exact_soft_field_recovery"],
    extractionWarnings: ["official_exact_soft_field_recovery"],
    includeExtendedSections,
  });

  return {
    unresolvedProductId: row?.productId ?? null,
    unresolvedTitle: row?.title ?? null,
    recoveryStrategy: config.strategy,
    matchedHistoryProductId: null,
    matchedHistoryTitle: null,
    exactPageUrl: config.pageUrl ?? null,
    exactPdfUrl: config.pdfUrl ?? null,
    candidate,
  };
};

export const canRecoverPureSoftFieldRow = (row = {}) => {
  const config = PURE_SOFT_FIELD_RECOVERY_CONFIG[normalizeText(row?.productId)] ?? null;
  if (!config) return false;
  const missingFields = toArray(row?.missingCoreFields ?? row?.coreMissingFields).map(normalizeLower).filter(Boolean);
  if (missingFields.length === 0) return true;
  return missingFields.every((field) => SOFT_FIELD_NAMES.has(field));
};

export const buildPureSoftFieldRecoveryBundle = async ({
  row,
  currentRow = null,
  historyJsonPath = DEFAULT_HISTORY_JSON,
  readerPrefix = DEFAULT_READER_PREFIX,
  includeExtendedSections = false,
} = {}) => {
  const config = PURE_SOFT_FIELD_RECOVERY_CONFIG[normalizeText(row?.productId)] ?? null;
  if (!config) return null;

  let bundle;
  if (config.strategy === "history") {
    bundle = await buildHistoryRecoveryBundle({
      row,
      currentRow,
      config,
      historyJsonPath,
      includeExtendedSections,
    });
  } else if (config.strategy === "exact_official") {
    bundle = await buildExactOfficialRecoveryBundle({
      row,
      currentRow,
      config,
      readerPrefix,
      includeExtendedSections,
    });
  } else {
    throw new Error(`unsupported_recovery_strategy:${config.strategy}`);
  }

  const candidate = bundle.candidate;
  return {
    ...bundle,
    result: {
      productId: row?.productId ?? null,
      title: row?.title ?? null,
      productPageUrl: row?.productPageUrl ?? null,
      pdfUrl: bundle.exactPdfUrl ?? row?.pdfUrl ?? null,
      pageUrl: bundle.exactPageUrl ?? row?.productPageUrl ?? getKnownLink(currentRow ?? row),
      outcome: "scrapling_candidate_built",
      sectionKeys: Object.keys(candidate.descriptionSections ?? {}),
      factRows: candidate?.supplementFacts?.nutritionalFacts?.length ?? 0,
      hasPrimaryImage: Boolean(candidate.productCatalogImage),
      extractionWarnings: candidate?.fetchDiagnostics?.extractionWarnings ?? [],
      softFieldRecovery: true,
      recoveryStrategy: bundle.recoveryStrategy,
      candidate,
    },
  };
};
