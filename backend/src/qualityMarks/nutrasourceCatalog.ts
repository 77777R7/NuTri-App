import { stripBrandPrefix } from "./matchers.js";

const sanitizeHtml = (html: string): string =>
  html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&trade;|&#8482;/gi, " ")
    .replace(/&#174;|&reg;/gi, " ")
    .replace(/\s+/g, " ")
    .trim();

const normalizeText = (value: unknown): string => String(value ?? "").trim();
const normalizeLower = (value: unknown): string => normalizeText(value).toLowerCase();
const compactText = (value: unknown): string => normalizeLower(value).replace(/[^a-z0-9]+/g, "");

const PRODUCT_FORM_TOKEN_RE =
  /\b(soft ?gels?|capsules?|caplets?|tablets?|gummies?|servings?|packets?|sachets?|enteric(?: coated)?|coated|liquid|powder|powders|drops|chews?|vegetarian|vegan)\b/gi;
const PRODUCT_NUMERIC_TOKEN_RE = /\b\d+(?:\.\d+)?\s*(?:mg|mcg|g|kg|ml|iu|oz|lb)\b/gi;
const PRODUCT_COUNT_TOKEN_RE = /\b\d+\s*(?:soft ?gels?|capsules?|caplets?|tablets?|gummies?|ct|count|servings?)\b/gi;
const PRODUCT_FLAVOR_TOKEN_RE =
  /\b(natural|orange|lemon|vanilla|chocolate|strawberry|raspberry|berry|unflavored|flavor|smoothie|sorbet|creme|cream|mango|peach|pineapple|lime|pomegranate|blueberry|ginger|pink|mixed|vanilla chai)\b/gi;
const BRAND_GENERIC_SUFFIX_RE =
  /\b(inc|inc\.|llc|ltd|ltd\.|corp|corp\.|corporation|company|co\.|nutritional supplements|supplements|nutrition|labs|laboratories|health)\b/gi;

const MATCH_STOPWORDS = new Set(["and", "the", "with", "plus", "for", "from", "of", "to", "a", "an"]);

export const NUTRASOURCE_RAW_PROGRAM_KEYS = [
  "ifos",
  "ikos",
  "igen",
  "iaos",
  "ipro",
  "nutrastrong",
  "rtcp",
  "icap",
  "nscollagen",
  "nsprebiotic",
] as const;

export type NutrasourceRawProgramKey = (typeof NUTRASOURCE_RAW_PROGRAM_KEYS)[number];

export type NutrasourceBrandResult = {
  sourceBrandName: string;
  resolvedBrandName: string;
  brandId: string;
  brandDetailUrl: string;
  brandProgramsRaw: NutrasourceRawProgramKey[];
  found: boolean;
  matchType: "exact" | "high_confidence" | "ambiguous";
  matchScore: number;
  selectedForCrawl: boolean;
};

export type NutrasourceBrandCatalogProduct = {
  brandId: string;
  brandName: string;
  productNum: string;
  productName: string;
  detailUrl: string;
  programsBrandRaw: NutrasourceRawProgramKey[];
};

export type NutrasourceLotOption = {
  programRaw: NutrasourceRawProgramKey;
  label: string;
  value: string;
};

export type NutrasourceProductDetail = {
  productNum: string;
  brandId: string | null;
  brandName: string | null;
  productName: string;
  detailUrl: string;
  programsProductRaw: NutrasourceRawProgramKey[];
  programsEffective: NutrasourceRawProgramKey[];
  lotOptions: NutrasourceLotOption[];
  pageTitle: string | null;
  pageFetched: boolean;
};

const tokenize = (value: string): string[] =>
  normalizeLower(value)
    .split(/[^a-z0-9]+/g)
    .map((token) => token.trim())
    .filter((token) => token.length >= 3 && !MATCH_STOPWORDS.has(token));

const uniqueTokens = (value: string): string[] => Array.from(new Set(tokenize(value)));

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

const extractDosageTokens = (value: string): string[] =>
  Array.from(
    new Set(
      normalizeLower(value).match(/\b\d+(?:\.\d+)?\s*(?:mg|mcg|g|kg|ml|iu|oz|lb)\b/gi) ?? [],
    ),
  ).sort();

const dosageTokensCompatible = (left: string[], right: string[]): boolean => {
  if (left.length === 0 || right.length === 0) return true;
  return left.some((token) => right.includes(token));
};

export const normalizeBrandKey = (brandName: string): string =>
  normalizeLower(brandName)
    .replace(BRAND_GENERIC_SUFFIX_RE, " ")
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();

export const normalizeProductCore = (productName: string, brandName: string): string =>
  stripBrandPrefix(productName, brandName)
    .replace(/[®™]/g, " ")
    .replace(PRODUCT_NUMERIC_TOKEN_RE, " ")
    .replace(PRODUCT_COUNT_TOKEN_RE, " ")
    .replace(PRODUCT_FORM_TOKEN_RE, " ")
    .replace(PRODUCT_FLAVOR_TOKEN_RE, " ")
    .replace(/[^a-z0-9]+/gi, " ")
    .replace(/\s+/g, " ")
    .trim();

export const scoreBrandNameMatch = (sourceBrandName: string, candidateBrandName: string) => {
  const source = normalizeBrandKey(sourceBrandName);
  const candidate = normalizeBrandKey(candidateBrandName);
  const exact = compactText(source) === compactText(candidate);
  const sourcePhrase = ` ${source} `;
  const candidatePhrase = ` ${candidate} `;
  const phraseMatch = sourcePhrase.includes(candidatePhrase) || candidatePhrase.includes(sourcePhrase);
  const sourceCoverage = computeTokenCoverage(source, candidate);
  const candidateCoverage = computeTokenCoverage(candidate, source);
  const coverage = Math.max(sourceCoverage, candidateCoverage);
  const asymmetricCoverage = Math.min(sourceCoverage, candidateCoverage);
  const score = exact ? 1 : phraseMatch ? Math.max(asymmetricCoverage, 0.89) : coverage;
  return {
    exact,
    highConfidence: exact || phraseMatch || coverage >= 0.72,
    score,
  };
};

export const scoreProductNameMatch = (sourceBrandName: string, sourceProductName: string, candidateProductName: string) => {
  const sourceCore = normalizeProductCore(sourceProductName, sourceBrandName);
  const candidateCore = normalizeProductCore(candidateProductName, sourceBrandName);
  const sourceDosageTokens = extractDosageTokens(sourceProductName);
  const candidateDosageTokens = extractDosageTokens(candidateProductName);
  const compatibleDosages = dosageTokensCompatible(sourceDosageTokens, candidateDosageTokens);
  const exact = compactText(sourceCore) === compactText(candidateCore) && Boolean(sourceCore) && compatibleDosages;
  const coverage = Math.max(
    computeTokenCoverage(sourceProductName, candidateProductName),
    computeTokenCoverage(sourceCore, candidateCore),
  );
  return {
    exact,
    highConfidence: exact || (coverage >= 0.72 && compatibleDosages),
    score: exact ? 1 : coverage,
    sourceCore,
    candidateCore,
  };
};

const mapProgramBooleanKey = (key: string): NutrasourceRawProgramKey | null => {
  const lower = normalizeLower(key);
  if (lower === "hasifos" || lower === "isifos") return "ifos";
  if (lower === "hasikos" || lower === "isikos") return "ikos";
  if (lower === "hasigen" || lower === "isigen") return "igen";
  if (lower === "hasiaos" || lower === "isiaos") return "iaos";
  if (lower === "hasipro" || lower === "isipro") return "ipro";
  if (lower === "hasnutrastrong" || lower === "isnutrastrong") return "nutrastrong";
  if (lower === "hasrtcp" || lower === "isrtcp") return "rtcp";
  if (lower === "hasicap" || lower === "isicap") return "icap";
  if (lower === "hasnscollagen" || lower === "isnscollagen") return "nscollagen";
  if (lower === "hasnsprebiotic" || lower === "isnsprebiotic") return "nsprebiotic";
  return null;
};

export const extractProgramsFromNutrasourceFlags = (row: Record<string, unknown>): NutrasourceRawProgramKey[] =>
  Array.from(
    new Set(
      Object.entries(row)
        .filter(([, value]) => Boolean(value))
        .map(([key]) => mapProgramBooleanKey(key))
        .filter((value): value is NutrasourceRawProgramKey => Boolean(value)),
    ),
  ).sort();

export const parseNutrasourceBrandSearchResults = (
  body: string,
  sourceBrandName: string,
): NutrasourceBrandResult[] => {
  const payload = JSON.parse(body) as { list?: Array<Record<string, unknown>> };
  const list = Array.isArray(payload?.list) ? payload.list : [];
  const ranked = list
    .map((row) => {
      const resolvedBrandName = normalizeText(row.Name);
      const brandId = normalizeText(row.BrandId);
      const match = scoreBrandNameMatch(sourceBrandName, resolvedBrandName);
      const matchType: NutrasourceBrandResult["matchType"] = match.exact
        ? "exact"
        : match.highConfidence
          ? "high_confidence"
          : "ambiguous";
      return {
        sourceBrandName,
        resolvedBrandName,
        brandId,
        brandDetailUrl: brandId
          ? `https://certifications.nutrasource.ca/certified-products/brand?id=${encodeURIComponent(brandId)}`
          : "",
        brandProgramsRaw: extractProgramsFromNutrasourceFlags(row),
        found: Boolean(brandId && resolvedBrandName),
        matchType,
        matchScore: match.score,
      };
    })
    .filter((row) => row.found)
    .sort((left, right) => right.matchScore - left.matchScore || left.resolvedBrandName.localeCompare(right.resolvedBrandName));

  const exactRows = ranked.filter((row) => row.matchType === "exact");
  const highConfidenceRows = ranked.filter((row) => row.matchType !== "ambiguous");
  const selectedRows =
    exactRows.length > 0
      ? exactRows
      : highConfidenceRows.length > 0
        ? [highConfidenceRows[0]]
        : [];
  const selectedIds = new Set(selectedRows.map((row) => row.brandId));

  return ranked.map((row) => ({
    ...row,
    selectedForCrawl: selectedIds.has(row.brandId),
  }));
};

export const parseNutrasourceBrandPageProducts = (
  body: string,
  brandId: string,
  brandName: string,
  programsBrandRaw: NutrasourceRawProgramKey[],
): NutrasourceBrandCatalogProduct[] =>
  Array.from(
    body.matchAll(/href="\/certified-products\/product\?id=([^"]+)"[^>]*>[\s\S]*?<\/a>[\s\S]{0,400}?<h3 class="results__brand[\s\S]{0,250}?<a [^>]*>([\s\S]*?)<\/a>/gi),
  )
    .map((match) => ({
      brandId,
      brandName,
      productNum: normalizeText(match[1]),
      productName: sanitizeHtml(match[2] ?? ""),
      detailUrl: `https://certifications.nutrasource.ca/certified-products/product?id=${encodeURIComponent(normalizeText(match[1]))}`,
      programsBrandRaw,
    }))
    .filter((row) => row.productNum && row.productName);

const parseLotOptions = (body: string): NutrasourceLotOption[] =>
  Array.from(body.matchAll(/<select[^>]+id="(Report[A-Za-z0-9]+)"[\s\S]*?<\/select>/gi))
    .flatMap((selectMatch) => {
      const reportId = normalizeText(selectMatch[1]);
      const programRaw = mapProgramBooleanKey(reportId.replace(/^Report/i, "Has"));
      if (!programRaw) return [];
      return Array.from(selectMatch[0].matchAll(/<option value="([^"]*)">([\s\S]*?)<\/option>/gi))
        .map((optionMatch) => ({
          programRaw,
          value: normalizeText(optionMatch[1]),
          label: sanitizeHtml(optionMatch[2] ?? ""),
        }))
        .filter((row) => row.value && row.label && row.label !== "--Select--");
    });

const extractProgramSection = (body: string): string => {
  const summaryIdx = body.indexOf("Product Summary");
  const footerIdx = body.indexOf("</footer>");
  if (summaryIdx >= 0 && footerIdx > summaryIdx) {
    return body.slice(summaryIdx, footerIdx);
  }
  return body;
};

export const parseNutrasourceProductDetail = (
  body: string,
  productNum: string,
  detailUrl: string,
  brandId: string | null,
  programsBrandRaw: NutrasourceRawProgramKey[],
): NutrasourceProductDetail => {
  const pageTitleRaw = sanitizeHtml(body.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1] ?? "");
  const titleParts = pageTitleRaw
    .replace(/\|\s*Certifications by Nutrasource/gi, "")
    .split("|")
    .map((value) => normalizeText(value))
    .filter(Boolean);
  const productName = titleParts[0] ?? normalizeText(productNum);
  const brandName = titleParts[1] ?? null;
  const section = extractProgramSection(body);
  const lotOptions = parseLotOptions(section);
  const explicitPrograms = new Set<NutrasourceRawProgramKey>(lotOptions.map((row) => row.programRaw));
  const text = sanitizeHtml(section);

  const textProgramMap: Array<[RegExp, NutrasourceRawProgramKey]> = [
    [/\bifos\b/i, "ifos"],
    [/\bikos\b/i, "ikos"],
    [/\bigen\b/i, "igen"],
    [/\biaos\b/i, "iaos"],
    [/\bipro\b/i, "ipro"],
    [/\bnutrastrong\b/i, "nutrastrong"],
    [/\brtcp\b/i, "rtcp"],
    [/\bicap\b/i, "icap"],
    [/\bnscollagen\b/i, "nscollagen"],
    [/\bnsprebiotic\b/i, "nsprebiotic"],
  ];

  for (const [pattern, program] of textProgramMap) {
    if (pattern.test(text)) explicitPrograms.add(program);
  }

  const programsProductRaw = Array.from(explicitPrograms).sort();
  return {
    productNum,
    brandId,
    brandName,
    productName,
    detailUrl,
    programsProductRaw,
    programsEffective: (programsProductRaw.length > 0 ? programsProductRaw : programsBrandRaw).slice().sort(),
    lotOptions,
    pageTitle: pageTitleRaw || null,
    pageFetched: true,
  };
};
