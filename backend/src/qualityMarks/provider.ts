import { execFile as execFileCallback } from "node:child_process";
import { promisify } from "node:util";

import { evaluateOfficialRegistryTextMatch } from "./matchers.js";
import type { QualityMarkFetchResult, QualityMarkLookupInput, QualityMarkProviderSource } from "./types.js";

const execFile = promisify(execFileCallback);

const normalizeText = (value: unknown): string => String(value ?? "").trim();
const normalizeLower = (value: unknown): string => normalizeText(value).toLowerCase();
const stripLeadingBrand = (productName: string, brandName: string): string => {
  const normalizedProduct = normalizeLower(productName);
  const normalizedBrand = normalizeLower(brandName);
  if (!normalizedProduct || !normalizedBrand || !normalizedProduct.startsWith(normalizedBrand)) {
    return normalizeText(productName);
  }
  return normalizeText(productName).slice(normalizeText(brandName).length).replace(/^[\s,.:/-]+/, "").trim();
};
const PRODUCT_QUERY_NOISE_RE =
  /\b(\d+(?:\.\d+)?\s*(?:mg|mcg|g|kg|ml|iu|oz)|\d+\s*(?:soft ?gels?|capsules?|caplets?|tablets?|gummies?|ct|count|servings?)|soft ?gels?|capsules?|caplets?|tablets?|gummies?|enteric(?: coated)?|coated|natural|orange|lemon|vanilla|chocolate|strawberry|raspberry|berry|unflavored|flavor|per|fl)\b/gi;
const AGENT_BROWSER_SHELL_CMD = process.env.QUALITY_MARK_AGENT_BROWSER_SHELL_CMD ?? "npx -y agent-browser";
const ENABLE_AGENT_BROWSER_FALLBACK = process.env.QUALITY_MARK_AGENT_BROWSER_FALLBACK !== "false";

const encodeQuery = (value: string) => encodeURIComponent(value.trim().replace(/\s+/g, " "));
const QUALITY_MARK_USER_AGENT =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 14_0) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36";
const CURL_WRITE_OUT_SENTINEL = "__QUALITY_MARK_META__";
const NUTRASOURCE_DETAIL_ORIGIN = "https://certifications.nutrasource.ca";

type NutrasourceProductCandidate = {
  productNum: string;
  productName: string;
};

type NutrasourceBrandCandidate = {
  brandId: string;
  brandName: string;
};

const buildSearchQuery = (input: QualityMarkLookupInput): string => {
  const brandName = normalizeText(input.brandName);
  const productName = normalizeText(input.productName);
  const normalizedProduct = stripLeadingBrand(productName, brandName);
  return [brandName, normalizedProduct].filter(Boolean).join(" ").trim();
};

const buildNutrasourceProductQuery = (input: QualityMarkLookupInput): string => {
  const productName = stripLeadingBrand(normalizeText(input.productName), normalizeText(input.brandName));
  const withoutNoise = productName
    .replace(PRODUCT_QUERY_NOISE_RE, " ")
    .replace(/[,+/()-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (withoutNoise.length >= 6) return withoutNoise;
  return productName;
};

const parseNutrasourceProductCandidates = (body: string | null): NutrasourceProductCandidate[] => {
  if (!body) return [];
  try {
    const payload = JSON.parse(body) as { list?: Array<Record<string, unknown>> };
    const list = Array.isArray(payload?.list) ? payload.list : [];
    return list
      .map((row) => ({
        productNum: normalizeText(row?.ProductNum),
        productName: normalizeText(row?.ProductName),
      }))
      .filter((row) => row.productNum && row.productName);
  } catch {
    return [];
  }
};

const parseNutrasourceBrandCandidates = (body: string | null): NutrasourceBrandCandidate[] => {
  if (!body) return [];
  try {
    const payload = JSON.parse(body) as { list?: Array<Record<string, unknown>> };
    const list = Array.isArray(payload?.list) ? payload.list : [];
    return list
      .map((row) => ({
        brandId: normalizeText(row?.BrandId),
        brandName: normalizeText(row?.Name),
      }))
      .filter((row) => row.brandId && row.brandName);
  } catch {
    return [];
  }
};

const parseNutrasourceBrandDetailCandidates = (
  body: string | null,
): Array<{ productNum: string; productName: string }> => {
  if (!body) return [];
  const matches = Array.from(
    body.matchAll(/href="\/certified-products\/product\?id=([^"]+)"[^>]*>\s*([^<]+?)\s*<\/a>/gi),
  );
  return matches
    .map((match) => ({
      productNum: normalizeText(match[1]),
      productName: normalizeText(match[2]),
    }))
    .filter((row) => row.productNum && row.productName);
};

export const buildNutrasourceBrandDetailSource = (params: {
  brandId: string;
  brandName?: string | null;
  productName?: string | null;
  queryText?: string | null;
  programId?: QualityMarkProviderSource["programId"] | null;
}): QualityMarkProviderSource => ({
  url: `${NUTRASOURCE_DETAIL_ORIGIN}/certified-products/brand?id=${encodeQuery(params.brandId)}`,
  sourceType: "official_registry",
  title: `Nutrasource ${normalizeText(params.programId ?? "ifos").toUpperCase()} brand detail`,
  programId: normalizeText(params.programId ?? "ifos") || "ifos",
  adapterKind: "nutrasource_brand_detail",
  responseFormat: "html",
  brandName: normalizeText(params.brandName),
  productName: normalizeText(params.productName),
  queryText: normalizeText(params.queryText),
  brandId: normalizeText(params.brandId),
});

export const buildNutrasourceProductDetailSource = (params: {
  productNum: string;
  brandName?: string | null;
  productName?: string | null;
  queryText?: string | null;
  programId?: QualityMarkProviderSource["programId"] | null;
}): QualityMarkProviderSource => ({
  url: `${NUTRASOURCE_DETAIL_ORIGIN}/certified-products/product?id=${encodeQuery(params.productNum)}`,
  sourceType: "official_registry",
  title: `Nutrasource ${normalizeText(params.programId ?? "ifos").toUpperCase()} product detail`,
  programId: normalizeText(params.programId ?? "ifos") || "ifos",
  adapterKind: "nutrasource_product_detail",
  responseFormat: "html",
  brandName: normalizeText(params.brandName),
  productName: normalizeText(params.productName),
  queryText: normalizeText(params.queryText),
  productNum: normalizeText(params.productNum),
});

export const resolveNutrasourceProductDetailSource = (params: {
  source: QualityMarkProviderSource;
  fetchResult: QualityMarkFetchResult;
}): QualityMarkProviderSource | null => {
  const candidates =
    params.source.adapterKind === "nutrasource_product_search"
      ? parseNutrasourceProductCandidates(params.fetchResult.body)
      : params.source.adapterKind === "nutrasource_brand_detail"
        ? parseNutrasourceBrandDetailCandidates(params.fetchResult.body)
        : [];
  if (candidates.length === 0) return null;

  const ranked = candidates
    .map((candidate) => {
      const match = evaluateOfficialRegistryTextMatch({
        registryText: candidate.productName,
        brandName: params.source.brandName,
        productName: params.source.productName,
        candidateTexts: [candidate.productName],
      });
      return { candidate, match };
    })
    .sort((left, right) => {
      const productMatchDelta = Number(right.match.productMatched) - Number(left.match.productMatched);
      if (productMatchDelta !== 0) return productMatchDelta;
      if (right.match.productCoverage !== left.match.productCoverage) {
        return right.match.productCoverage - left.match.productCoverage;
      }
      return left.candidate.productName.localeCompare(right.candidate.productName);
    });

  const best = ranked[0];
  if (!best?.match.productMatched) return null;

  return buildNutrasourceProductDetailSource({
    productNum: best.candidate.productNum,
    brandName: params.source.brandName,
    productName: params.source.productName,
    queryText: best.candidate.productName,
    programId: params.source.programId,
  });
};

export const resolveNutrasourceBrandDetailSource = (params: {
  source: QualityMarkProviderSource;
  fetchResult: QualityMarkFetchResult;
}): QualityMarkProviderSource | null => {
  if (params.source.adapterKind !== "nutrasource_brand_search") return null;
  const candidates = parseNutrasourceBrandCandidates(params.fetchResult.body);
  if (candidates.length === 0) return null;

  const ranked = candidates
    .map((candidate) => {
      const match = evaluateOfficialRegistryTextMatch({
        registryText: candidate.brandName,
        brandName: params.source.brandName,
        productName: params.source.productName,
        candidateTexts: [candidate.brandName],
      });
      return { candidate, match };
    })
    .sort((left, right) => {
      const brandMatchDelta = Number(right.match.brandMatched) - Number(left.match.brandMatched);
      if (brandMatchDelta !== 0) return brandMatchDelta;
      return left.candidate.brandName.localeCompare(right.candidate.brandName);
    });

  const best = ranked[0];
  if (!best?.match.brandMatched) return null;

  return buildNutrasourceBrandDetailSource({
    brandId: best.candidate.brandId,
    brandName: params.source.brandName,
    productName: params.source.productName,
    queryText: best.candidate.brandName,
    programId: params.source.programId,
  });
};

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

  const nutrasourceProductQuery = buildNutrasourceProductQuery(input);
  if (nutrasourceProductQuery) {
    sources.push({
      url:
        "https://certifications.nutrasource.ca/umbraco/surface/NutrasourceContent/GetFilteredProducts" +
        `?pageNumber=1&pageSize=12&forCertification=IFOS&forInterest=&forCategory=&byName=${encodeQuery(nutrasourceProductQuery)}`,
      sourceType: "official_registry",
      title: "Nutrasource IFOS product search",
      programId: "ifos",
      adapterKind: "nutrasource_product_search",
      responseFormat: "json",
      brandName,
      productName,
      queryText: nutrasourceProductQuery,
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

const fetchViaCurl = async (
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

const fetchViaAgentBrowser = async (targetUrl: string): Promise<QualityMarkFetchResult> => {
  try {
    const resetCmd = `${AGENT_BROWSER_SHELL_CMD} close >/dev/null 2>&1 || true`;
    const openCmd = `${AGENT_BROWSER_SHELL_CMD} open ${JSON.stringify(targetUrl)}`;
    const waitCmd = `${AGENT_BROWSER_SHELL_CMD} wait --load networkidle`;
    const htmlScript = Buffer.from("document.documentElement.outerHTML").toString("base64");
    const getCmd = `${AGENT_BROWSER_SHELL_CMD} --max-output 500000 eval -b ${JSON.stringify(htmlScript)}`;
    const { stdout } = await execFile(
      "zsh",
      ["-lc", `${resetCmd}; ${openCmd} && ${waitCmd} && ${getCmd}`],
      {
        maxBuffer: 8 * 1024 * 1024,
      },
    );
    const rawBody = stdout?.trim() ?? "";
    let decodedBody = rawBody;
    if (rawBody.startsWith("\"")) {
      try {
        const parsed = JSON.parse(rawBody);
        if (typeof parsed === "string" && parsed.trim()) decodedBody = parsed;
      } catch {
        decodedBody = rawBody;
      }
    }
    return {
      ok: Boolean(decodedBody),
      body: decodedBody || null,
      error: decodedBody ? null : "agent_browser_empty_body",
      statusCode: decodedBody ? 200 : null,
      contentType: "text/html",
    };
  } catch (error) {
    return {
      ok: false,
      body: null,
      error: error instanceof Error ? error.message : String(error),
      statusCode: null,
      contentType: null,
    };
  }
};

export const fetchQualityMarkSource = async (
  source: QualityMarkProviderSource,
  timeoutMs = 7000,
): Promise<QualityMarkFetchResult> => {
  const result = await fetchViaCurl(source, timeoutMs);
  if (
    result.ok ||
    !ENABLE_AGENT_BROWSER_FALLBACK ||
    !["usp_listing", "nutrasource_brand_detail", "nutrasource_product_detail"].includes(source.adapterKind ?? "") ||
    ![401, 403, 429].includes(result.statusCode ?? 0)
  ) {
    return result;
  }

  const fallbackResult = await fetchViaAgentBrowser(source.url);
  if (fallbackResult.ok) return fallbackResult;

  return {
    ...result,
    error: [result.error, `agent_browser_fallback_failed:${fallbackResult.error ?? "unknown"}`]
      .filter(Boolean)
      .join("; "),
  };
};
