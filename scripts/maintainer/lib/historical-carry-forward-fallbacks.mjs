import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";
import { normalizeText } from "./iherb-overlay-utils.mjs";

const ROOT = process.cwd();
const PURE_HISTORY_REPORT_PATHS = [
  path.join(ROOT, "output", "pure_encapsulations_historical_carry_forward_v4", "scrapling_official_fallback_report.json"),
  path.join(ROOT, "output", "pure_encapsulations_historical_carry_forward_v3", "scrapling_official_fallback_report.json"),
  path.join(ROOT, "output", "pure_encapsulations_historical_carry_forward_v2", "scrapling_official_fallback_report.json"),
  path.join(ROOT, "output", "pure_encapsulations_historical_carry_forward_v1", "scrapling_official_fallback_report.json"),
];

const toArray = (value) => (Array.isArray(value) ? value : []);
const normalizeLower = (value) => normalizeText(value).toLowerCase();

const normalizeTitleKey = (value) =>
  normalizeText(value)
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/gi, " ")
    .trim()
    .replace(/\s+/g, " ")
    .toLowerCase();

const normalizeUrlKey = (value) => {
  const text = normalizeText(value);
  if (!text) return null;
  return text
    .replace(/[?#].*$/, "")
    .replace(/\/+$/, "")
    .toLowerCase();
};

const uniqueStrings = (values) => {
  const seen = new Set();
  const output = [];
  for (const value of toArray(values)) {
    const normalized = normalizeText(value);
    if (!normalized) continue;
    const key = normalized.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    output.push(normalized);
  }
  return output;
};

const uniqueUrls = (values) => {
  const seen = new Set();
  const output = [];
  for (const value of toArray(values)) {
    const normalized = normalizeText(value);
    const key = normalizeUrlKey(normalized);
    if (!normalized || !key || seen.has(key)) continue;
    seen.add(key);
    output.push(normalized);
  }
  return output;
};

const buildBodyTextFromSections = (sections) =>
  Object.entries(sections ?? {})
    .map(([heading, body]) => `${heading}: ${normalizeText(body)}`)
    .filter((line) => !/: $/.test(line))
    .join(" ");

const isUnavailableText = (value) => {
  const text = normalizeLower(value);
  return (
    text.includes("temporarily unavailable") ||
    text.includes("access denied") ||
    text.includes("forbidden") ||
    text.includes("nestlé") ||
    text.includes("nestle") ||
    text.includes("captcha")
  );
};

const isUnavailableRaw = (raw = {}) =>
  isUnavailableText(raw?.title) ||
  isUnavailableText(raw?.bodyText) ||
  isUnavailableText(raw?.text);

const hasSupplementFacts = (raw = {}) => toArray(raw?.supplementFactsRows).length > 0;
const hasSections = (raw = {}) => Object.keys(raw?.sections ?? {}).length > 0;
const hasImages = (raw = {}) => toArray(raw?.images).length > 0 || Boolean(normalizeText(raw?.primaryImage));
const hasCategories = (raw = {}) => toArray(raw?.categories).length > 0;
const hasDosageForm = (raw = {}) => {
  const dosageForm = normalizeLower(raw?.dosageForm);
  return Boolean(dosageForm && dosageForm !== "n/a");
};

const removeMissingFactsWarning = (warnings) =>
  toArray(warnings).filter((warning) => normalizeLower(warning) !== "missing_supplement_facts_rows");

let pureHistoricalIndexPromise = null;

const loadPureHistoricalIndex = async () => {
  const reportPath = PURE_HISTORY_REPORT_PATHS.find((candidatePath) => fs.existsSync(candidatePath));
  if (!reportPath) {
    return {
      reportPath: null,
      byUrl: new Map(),
      byProductId: new Map(),
      byTitle: new Map(),
    };
  }

  const report = JSON.parse(await fsp.readFile(reportPath, "utf8"));
  const byUrl = new Map();
  const byProductId = new Map();
  const byTitle = new Map();

  for (const row of toArray(report?.results)) {
    const candidate = row?.candidate;
    if (!candidate || normalizeLower(candidate?.brandName) !== "pure encapsulations") continue;

    const productId = normalizeText(candidate?.productId ?? row?.productId ?? null) || null;
    const title = normalizeText(candidate?.title ?? row?.title ?? null) || null;
    const sourceUrls = uniqueUrls([
      ...(candidate?.sourceSummary?.sourceUrls ?? []),
      row?.pageUrl,
      candidate?.link,
    ]);
    const entry = {
      reportPath,
      productId,
      title,
      sourceUrls,
      candidate,
    };

    for (const sourceUrl of sourceUrls) {
      const key = normalizeUrlKey(sourceUrl);
      if (key && !byUrl.has(key)) {
        byUrl.set(key, entry);
      }
    }

    if (productId && !byProductId.has(productId)) {
      byProductId.set(productId, entry);
    }

    const titleKey = normalizeTitleKey(title);
    if (titleKey && !byTitle.has(titleKey)) {
      byTitle.set(titleKey, entry);
    }
  }

  return {
    reportPath,
    byUrl,
    byProductId,
    byTitle,
  };
};

const getPureHistoricalIndex = async () => {
  if (!pureHistoricalIndexPromise) {
    pureHistoricalIndexPromise = loadPureHistoricalIndex();
  }
  return pureHistoricalIndexPromise;
};

const collectLookupUrls = (raw = {}, context = {}) =>
  uniqueUrls([
    context?.url,
    raw?.url,
    raw?.pageUrl,
    raw?.finalUrl,
    raw?.supplementFactsArtifacts?.evidenceUrl,
    ...(raw?.supplementFactsArtifacts?.pdfUrls ?? []),
  ]);

const isPureRelevantContext = (raw = {}, context = {}) => {
  if (normalizeLower(context?.brandName) === "pure encapsulations") return true;
  const urls = collectLookupUrls(raw, context);
  return urls.some((value) => /pureencapsulations|pureforyou/.test(normalizeLower(value)));
};

const findPureHistoricalMatch = (index, raw = {}, context = {}) => {
  for (const url of collectLookupUrls(raw, context)) {
    const key = normalizeUrlKey(url);
    if (!key) continue;
    const matched = index.byUrl.get(key);
    if (matched) {
      return {
        entry: matched,
        matchedBy: "source_url",
        matchedSourceUrl: url,
      };
    }
  }

  const productId = normalizeText(context?.productId ?? raw?.productId ?? null);
  if (productId && index.byProductId.has(productId)) {
    return {
      entry: index.byProductId.get(productId),
      matchedBy: "product_id",
      matchedSourceUrl: null,
    };
  }

  const titleCandidates = uniqueStrings([context?.title, raw?.title]);
  for (const title of titleCandidates) {
    if (isUnavailableText(title)) continue;
    const key = normalizeTitleKey(title);
    if (!key) continue;
    const matched = index.byTitle.get(key);
    if (matched) {
      return {
        entry: matched,
        matchedBy: "title",
        matchedSourceUrl: null,
      };
    }
  }

  return null;
};

export const applyHistoricalCarryForwardFallbacks = async (raw = {}, context = {}) => {
  if (!raw?.ok || !isPureRelevantContext(raw, context)) {
    return raw;
  }

  const index = await getPureHistoricalIndex();
  if (!index.reportPath) {
    return raw;
  }

  const match = findPureHistoricalMatch(index, raw, context);
  if (!match?.entry?.candidate) {
    return raw;
  }

  const candidate = match.entry.candidate;
  const candidateSections = candidate?.descriptionSections ?? {};
  const candidateFacts = candidate?.supplementFacts ?? {};
  const candidateFactRows = toArray(candidateFacts?.nutritionalFacts);
  const candidateImages = uniqueUrls(candidate?.productImages ?? []);
  const candidateSourceUrls = uniqueUrls(match.entry.sourceUrls ?? []);
  const candidatePdfUrls = candidateSourceUrls.filter((url) => /\.pdf(?:$|[?#])/i.test(url));
  const unavailable = isUnavailableRaw(raw);

  const filledSections = (unavailable || !hasSections(raw)) && Object.keys(candidateSections).length > 0;
  const filledFacts = !hasSupplementFacts(raw) && candidateFactRows.length > 0;
  const filledImages = !hasImages(raw) && (candidateImages.length > 0 || normalizeText(candidate?.productCatalogImage));
  const filledCategories = !hasCategories(raw) && toArray(candidate?.categories).length > 0;
  const filledDosageForm = !hasDosageForm(raw) && hasDosageForm(candidate);

  const next = {
    ...raw,
    title:
      unavailable || !normalizeText(raw?.title)
        ? normalizeText(candidate?.title) || raw?.title
        : raw?.title,
    bodyText:
      unavailable || !normalizeText(raw?.bodyText)
        ? buildBodyTextFromSections(candidateSections) || raw?.bodyText
        : raw?.bodyText,
    sections: filledSections ? candidateSections : raw?.sections,
    servingSize: filledFacts ? candidateFacts?.servingSize ?? raw?.servingSize ?? null : raw?.servingSize,
    servingsPerContainer: filledFacts
      ? candidateFacts?.servingsPerContainer ?? raw?.servingsPerContainer ?? null
      : raw?.servingsPerContainer,
    supplementFactsRows: filledFacts ? candidateFactRows : raw?.supplementFactsRows,
    supplementFactsSource: filledFacts ? "historical_carry_forward" : raw?.supplementFactsSource,
    categories: filledCategories ? uniqueStrings(candidate?.categories ?? []) : raw?.categories,
    dosageForm: filledDosageForm ? normalizeText(candidate?.dosageForm) : raw?.dosageForm,
    images: filledImages ? candidateImages : raw?.images,
    primaryImage:
      !normalizeText(raw?.primaryImage) && normalizeText(candidate?.productCatalogImage)
        ? normalizeText(candidate?.productCatalogImage)
        : raw?.primaryImage,
    extractionWarnings: uniqueStrings([
      ...(filledFacts ? removeMissingFactsWarning(raw?.extractionWarnings) : toArray(raw?.extractionWarnings)),
      "historical_carry_forward_fallback",
    ]),
    blocked: Boolean(raw?.blocked || unavailable),
    historicalCarryForward: {
      applied: true,
      matchedBy: match.matchedBy,
      matchedSourceUrl: match.matchedSourceUrl ?? null,
      matchedProductId: match.entry.productId ?? null,
      reportPath: index.reportPath,
      fieldsFilled: {
        sections: filledSections,
        supplementFacts: filledFacts,
        images: filledImages,
        categories: filledCategories,
        dosageForm: filledDosageForm,
      },
    },
  };

  if (filledFacts || candidatePdfUrls.length > 0) {
    next.supplementFactsArtifacts = {
      ...(raw?.supplementFactsArtifacts ?? {}),
      evidenceUrl:
        normalizeText(raw?.supplementFactsArtifacts?.evidenceUrl) ||
        candidatePdfUrls[0] ||
        match.matchedSourceUrl ||
        candidateSourceUrls[0] ||
        null,
      pdfUrls: uniqueUrls([...(raw?.supplementFactsArtifacts?.pdfUrls ?? []), ...candidatePdfUrls]),
      sourceKind: "historical_carry_forward",
    };
  }

  return next;
};
