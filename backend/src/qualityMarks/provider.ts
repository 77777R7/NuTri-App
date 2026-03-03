import type { QualityMarkLookupInput, QualityMarkProviderSource } from "./types.js";

const normalizeText = (value: unknown): string => String(value ?? "").trim();

const encodeQuery = (value: string) => encodeURIComponent(value.trim().replace(/\s+/g, " "));

const buildSearchQuery = (input: QualityMarkLookupInput): string => {
  const brand = normalizeText(input.brandName);
  const product = normalizeText(input.productName);
  const base = [brand, product].filter(Boolean).join(" ");
  return `${base} third-party tested USP NSF Informed Choice BSCG ConsumerLab`.trim();
};

export const buildQualityMarkSourceCandidates = (input: QualityMarkLookupInput): QualityMarkProviderSource[] => {
  const query = buildSearchQuery(input);
  if (!query) return [];
  const encodedQuery = encodeQuery(query);
  return [
    {
      url: `https://duckduckgo.com/html/?q=${encodedQuery}+site%3A${encodeURIComponent(normalizeText(input.brandName).toLowerCase().replace(/\s+/g, ""))}.com`,
      sourceType: "brand_official",
      title: "Brand official domain search",
    },
    {
      url: `https://duckduckgo.com/html/?q=${encodedQuery}+site%3Aamazon.com`,
      sourceType: "retailer_marketplace",
      title: "Amazon search",
    },
    {
      url: `https://duckduckgo.com/html/?q=${encodedQuery}+site%3Aiherb.com`,
      sourceType: "retailer_marketplace",
      title: "iHerb search",
    },
    {
      url: `https://duckduckgo.com/html/?q=${encodedQuery}+site%3Awell.ca`,
      sourceType: "retailer_marketplace",
      title: "Well.ca search",
    },
  ];
};

export const fetchQualityMarkSource = async (
  source: QualityMarkProviderSource,
  timeoutMs = 7000,
): Promise<{ ok: boolean; html: string | null; error: string | null }> => {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(source.url, {
      method: "GET",
      signal: controller.signal,
      headers: {
        "user-agent":
          "Mozilla/5.0 (Macintosh; Intel Mac OS X 14_0) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36",
        accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
      },
    });
    if (!response.ok) {
      return { ok: false, html: null, error: `http_${response.status}` };
    }
    const html = await response.text();
    return { ok: true, html, error: null };
  } catch (error) {
    return {
      ok: false,
      html: null,
      error: error instanceof Error ? error.message : String(error),
    };
  } finally {
    clearTimeout(timer);
  }
};
