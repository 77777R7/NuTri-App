import { execFile as execFileCallback } from "node:child_process";
import { promisify } from "node:util";

import type { QualityMarkFetchResult, QualityMarkLookupInput, QualityMarkProviderSource } from "./types.js";

const execFile = promisify(execFileCallback);

const normalizeText = (value: unknown): string => String(value ?? "").trim();

const encodeQuery = (value: string) => encodeURIComponent(value.trim().replace(/\s+/g, " "));
const QUALITY_MARK_USER_AGENT =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 14_0) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36";
const CURL_WRITE_OUT_SENTINEL = "__QUALITY_MARK_META__";

const buildSearchQuery = (input: QualityMarkLookupInput): string =>
  [normalizeText(input.brandName), normalizeText(input.productName)].filter(Boolean).join(" ").trim();

const buildOfficialRegistrySources = (input: QualityMarkLookupInput): QualityMarkProviderSource[] => {
  const query = buildSearchQuery(input);
  const brandName = normalizeText(input.brandName);
  const productName = normalizeText(input.productName);
  const sources: QualityMarkProviderSource[] = [];

  if (query) {
    sources.push(
      {
        url: `https://nsfsport-prod.nsf.org/certified-products/search-results.php?keyword=${encodeQuery(query)}`,
        sourceType: "official_registry",
        title: "NSF Certified for Sport registry search",
        programId: "nsf_certified_for_sport",
        adapterKind: "nsf_search",
        responseFormat: "html",
        brandName,
        productName,
        queryText: query,
      },
      {
        url: "https://www.quality-supplements.org/usp_verified_products",
        sourceType: "official_registry",
        title: "USP Verified products listing",
        programId: "usp_verified",
        adapterKind: "usp_listing",
        responseFormat: "html",
        brandName,
        productName,
        queryText: query,
      },
      {
        url: `https://choice.wetestyoutrust.com/supplement-search?search=${encodeQuery(query)}`,
        sourceType: "official_registry",
        title: "Informed Choice registry search",
        programId: "informed_choice",
        adapterKind: "informed_choice_search",
        responseFormat: "html",
        brandName,
        productName,
        queryText: query,
      },
      {
        url: `https://sport.wetestyoutrust.com/supplement-search?search=${encodeQuery(query)}`,
        sourceType: "official_registry",
        title: "Informed Sport registry search",
        programId: "informed_sport",
        adapterKind: "informed_sport_search",
        responseFormat: "html",
        brandName,
        productName,
        queryText: query,
      },
    );
  }

  if (brandName) {
    sources.push({
      url:
        "https://certifications.nutrasource.ca/umbraco/surface/NutrasourceContent/GetFilteredBrands" +
        `?pageNumber=1&pageSize=12&forCertification=IFOS&forInterest=&forCategory=&byName=${encodeQuery(brandName)}`,
      sourceType: "official_registry",
      title: "Nutrasource IFOS brand search",
      programId: "ifos",
      adapterKind: "nutrasource_brand_search",
      responseFormat: "json",
      brandName,
      productName,
      queryText: brandName,
    });
  }

  if (productName) {
    sources.push({
      url:
        "https://certifications.nutrasource.ca/umbraco/surface/NutrasourceContent/GetFilteredProducts" +
        `?pageNumber=1&pageSize=12&forCertification=IFOS&forInterest=&forCategory=&byName=${encodeQuery(productName)}`,
      sourceType: "official_registry",
      title: "Nutrasource IFOS product search",
      programId: "ifos",
      adapterKind: "nutrasource_product_search",
      responseFormat: "json",
      brandName,
      productName,
      queryText: productName,
    });
  }

  return sources;
};

export const buildQualityMarkSourceCandidates = (input: QualityMarkLookupInput): QualityMarkProviderSource[] => {
  const query = buildSearchQuery(input);
  if (!query) return [];
  const encodedQuery = encodeQuery(`${query} third-party tested`);
  const brandDomain = normalizeText(input.brandName).toLowerCase().replace(/\s+/g, "");
  return [
    ...buildOfficialRegistrySources(input),
    ...(
      brandDomain
        ? [{
            url: `https://duckduckgo.com/html/?q=${encodedQuery}+site%3A${encodeURIComponent(brandDomain)}.com`,
            sourceType: "brand_official" as const,
            title: "Brand official domain search",
            brandName: normalizeText(input.brandName),
            productName: normalizeText(input.productName),
            queryText: query,
          }]
        : []
    ),
    {
      url: `https://duckduckgo.com/html/?q=${encodedQuery}+site%3Aamazon.com`,
      sourceType: "retailer_marketplace",
      title: "Amazon search",
      brandName: normalizeText(input.brandName),
      productName: normalizeText(input.productName),
      queryText: query,
    },
    {
      url: `https://duckduckgo.com/html/?q=${encodedQuery}+site%3Aiherb.com`,
      sourceType: "retailer_marketplace",
      title: "iHerb search",
      brandName: normalizeText(input.brandName),
      productName: normalizeText(input.productName),
      queryText: query,
    },
    {
      url: `https://duckduckgo.com/html/?q=${encodedQuery}+site%3Awell.ca`,
      sourceType: "retailer_marketplace",
      title: "Well.ca search",
      brandName: normalizeText(input.brandName),
      productName: normalizeText(input.productName),
      queryText: query,
    },
  ];
};

export const fetchQualityMarkSource = async (
  source: QualityMarkProviderSource,
  timeoutMs = 7000,
): Promise<QualityMarkFetchResult> => {
  const acceptHeader =
    source.responseFormat === "json"
      ? "application/json,text/html,application/xhtml+xml;q=0.9,*/*;q=0.8"
      : "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8";
  try {
    const { stdout } = await execFile(
      "curl",
      [
        "--location",
        "--silent",
        "--show-error",
        "--compressed",
        "--max-time",
        String(Math.max(1, Math.ceil(timeoutMs / 1000))),
        "--user-agent",
        QUALITY_MARK_USER_AGENT,
        "--header",
        `accept: ${acceptHeader}`,
        "--write-out",
        `\n${CURL_WRITE_OUT_SENTINEL}%{http_code}|%{content_type}`,
        source.url,
      ],
      {
        maxBuffer: 2_000_000,
      },
    );

    const markerIndex = stdout.lastIndexOf(`\n${CURL_WRITE_OUT_SENTINEL}`);
    const body = markerIndex >= 0 ? stdout.slice(0, markerIndex) : stdout;
    const meta = markerIndex >= 0 ? stdout.slice(markerIndex + 1).trim() : "";
    const [, rawStatusCode = "0", rawContentType = ""] =
      meta.match(new RegExp(`^${CURL_WRITE_OUT_SENTINEL}(\\d+)\\|(.*)$`)) ?? [];
    const statusCode = Number.parseInt(rawStatusCode, 10);
    const contentType = rawContentType || null;

    if (!Number.isFinite(statusCode) || statusCode <= 0) {
      return {
        ok: false,
        body: body || null,
        error: "http_0",
        statusCode: null,
        contentType,
      };
    }

    if (statusCode < 200 || statusCode >= 300) {
      return {
        ok: false,
        body,
        error: `http_${statusCode}`,
        statusCode,
        contentType,
      };
    }
    return {
      ok: true,
      body,
      error: null,
      statusCode,
      contentType,
    };
  } catch (error) {
    const code =
      error && typeof error === "object" && "code" in error && typeof error.code === "number"
        ? error.code
        : null;
    const stdout =
      error && typeof error === "object" && "stdout" in error && typeof error.stdout === "string"
        ? error.stdout
        : "";
    const stderr =
      error && typeof error === "object" && "stderr" in error && typeof error.stderr === "string"
        ? error.stderr
        : "";
    const markerIndex = stdout.lastIndexOf(`\n${CURL_WRITE_OUT_SENTINEL}`);
    const body = markerIndex >= 0 ? stdout.slice(0, markerIndex) : stdout || null;
    return {
      ok: false,
      body,
      error: code === 28 ? "timeout" : stderr || (error instanceof Error ? error.message : String(error)),
      statusCode: null,
      contentType: null,
    };
  }
};
