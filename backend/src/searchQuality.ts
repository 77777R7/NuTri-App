import type { SearchItem } from "./types.js";

// ============================================================================
// HIGH QUALITY DOMAINS
// ============================================================================

const HIGH_QUALITY_DOMAINS = [
    // Major Retailers
    "amazon.com", "amazon.ca", "amazon.co.uk", "amazon.de",
    "iherb.com",
    "costco.com", "costco.ca",
    "walmart.com", "walmart.ca",
    "target.com",
    "cvs.com",
    "walgreens.com",
    "gnc.com",
    "vitaminshoppe.com",
    "vitacost.com",
    "luckyvitamin.com",
    "pipingrock.com",
    "puritan.com",
    "swansonvitamins.com",

    // Sports/Fitness Retailers
    "bodybuilding.com",
    "myprotein.com",
    "bulksupplements.com",

    // Brand Official Sites
    "nowfoods.com",
    "thorne.com",
    "pureencapsulations.com",
    "lifeextension.com",
    "gardenoflife.com",
    "nordicnaturals.com",
    "jarrow.com",
    "doctorsbest.com",
    "solgar.com",
    "naturemade.com",
    "naturesway.com",
    "solaray.com",
    "countrylifevitamins.com",

    // Canadian Retailers/Brands
    "well.ca",
    "nationalnutrition.ca",
    "supplementscanada.com",
    "jamieson.com",
    "webbernaturals.com",

    // Science/Reference Sites
    "examine.com",
    "consumerlab.com",
    "labdoor.com",
    "nih.gov",
    "pubmed.gov",
];

// ============================================================================
// EXTRACTABILITY / MARKETPLACE DOMAINS
// ============================================================================

const MARKETPLACE_DOMAINS = [
    "ebay.com",
    "ebay.ca",
    "ebay.co.uk",
    "ebay.de",
    "etsy.com",
    "mercari.com",
    "poshmark.com",
    "bonanza.com",
    "depop.com",
];

const EXTRACTABILITY_TIER_A_DOMAINS = [
    "iherb.com",
    "gnc.com",
    "vitaminshoppe.com",
    "vitacost.com",
    "luckyvitamin.com",
    "swansonvitamins.com",
    "pipingrock.com",
    "puritan.com",
    "nowfoods.com",
    "thorne.com",
    "pureencapsulations.com",
    "lifeextension.com",
    "gardenoflife.com",
    "nordicnaturals.com",
    "jarrow.com",
    "doctorsbest.com",
    "solgar.com",
    "naturemade.com",
    "naturesway.com",
    "solaray.com",
    "countrylifevitamins.com",
    "well.ca",
    "nationalnutrition.ca",
    "supplementscanada.com",
    "jamiesonvitamins.com",
    "webbernaturals.com",
];

const EXTRACTABILITY_TIER_B_DOMAINS = [
    "amazon.com",
    "amazon.ca",
    "amazon.co.uk",
    "amazon.de",
    "walmart.com",
    "walmart.ca",
    "target.com",
    "costco.com",
    "costco.ca",
    "cvs.com",
    "walgreens.com",
    "bodybuilding.com",
    "myprotein.com",
    "bulksupplements.com",
];

const EXTRACTABILITY_TIER_C_DOMAINS = [
    "facebook.com",
    "instagram.com",
    "pinterest.com",
    "tiktok.com",
    "youtube.com",
];

// ============================================================================
// SCORING PATTERNS
// ============================================================================

const JUNK_WORDS_REGEX =
    /\b(pack of \d+|lot of \d+|exp \d+|expiration|expires|best by|capsules|tablets|softgels|pills|count|ct|oz|lb|kg|g|mg|mcg|iu)\b/gi;

const DOSAGE_REGEX = /\b\d+\s?(mg|g|mcg|iu|i\.u\.)\b/i;

const KEYWORDS = [
    // English (labels / product pages)
    "ingredients",
    "other ingredients",
    "active ingredients",
    "supplement facts",
    "nutrition facts",
    "amount per serving",
    "serving size",
    "suggested use",
    "directions",
    "dosage",
    "warning",
    "allergen",
    // Chinese (common e-commerce / label terms)
    "成分",
    "配料",
    "营养成分",
    "用法",
    "建议用量",
    "食用方法",
    "注意事项",
];

const THIRD_PARTY_KEYWORDS = ["third party tested", "usp verified", "nsf certified", "informed sport", "gmp certified"];

const STRONG_URL_SIGNAL_REGEX = /(upc|gtin|ean|barcode|sku)[^0-9]{0,6}\d{8,14}/i;
const PRODUCT_PATH_REGEX = /\/(product|products|p|dp|gp\/product|itm|item)\b/i;

// ============================================================================
// UTILITY FUNCTIONS
// ============================================================================

/**
 * Extract domain from URL for display and analysis
 */
export function extractDomain(url: string): string {
    try {
        const hostname = new URL(url).hostname;
        return hostname.replace(/^www\./, "");
    } catch {
        return url;
    }
}

const normalizeDomain = (value: string): string => value.toLowerCase().replace(/^www\./, "");

const domainMatches = (domain: string, candidate: string): boolean =>
    domain === candidate || domain.endsWith(`.${candidate}`);

const matchDomainList = (domain: string, list: string[]): boolean =>
    list.some((entry) => domainMatches(domain, entry));

const resolveDomain = (value: string): string => {
    if (value.includes("://")) {
        return normalizeDomain(extractDomain(value));
    }
    return normalizeDomain(value);
};

export type ExtractabilityTier = "A" | "B" | "C" | "U";

export const isMarketplaceDomain = (value: string): boolean => {
    const domain = resolveDomain(value);
    return matchDomainList(domain, MARKETPLACE_DOMAINS);
};

export const getExtractabilityTier = (value: string): ExtractabilityTier => {
    const domain = resolveDomain(value);
    if (isMarketplaceDomain(domain) || matchDomainList(domain, EXTRACTABILITY_TIER_C_DOMAINS)) return "C";
    if (matchDomainList(domain, EXTRACTABILITY_TIER_A_DOMAINS)) return "A";
    if (matchDomainList(domain, EXTRACTABILITY_TIER_B_DOMAINS)) return "B";
    return "U";
};

export const getExtractabilityScore = (value: string): number => {
    const tier = getExtractabilityTier(value);
    if (tier === "A") return 1;
    if (tier === "B") return 0.6;
    if (tier === "C") return 0.15;
    return 0.35;
};

export const getUrlSignalScore = (url: string): number => {
    let score = 0;
    if (STRONG_URL_SIGNAL_REGEX.test(url)) score += 18;
    if (PRODUCT_PATH_REGEX.test(url)) score += 8;
    return score;
};

export const hasStrongUrlSignal = (url: string): boolean => STRONG_URL_SIGNAL_REGEX.test(url);

/**
 * Check if domain is a high-quality source
 */
export function isHighQualityDomain(url: string): boolean {
    const domain = resolveDomain(url);
    return matchDomainList(domain, HIGH_QUALITY_DOMAINS);
}

// ============================================================================
// MAIN SCORING FUNCTION
// ============================================================================

export type SearchScoreOptions = {
    barcode?: string;
};

export const scoreSearchItem = (item: SearchItem, options: SearchScoreOptions = {}): number => {
    let score = 0;
    const barcode = options.barcode?.trim() || "";

    const text = `${item.title} ${item.snippet}`.toLowerCase();
    const link = item.link.toLowerCase();
    const domain = resolveDomain(item.link);

    // 1. Keywords (+30)
    if (KEYWORDS.some((kw) => text.includes(kw.toLowerCase()))) {
        score += 30;
    }

    // 2. Dosage Patterns (+35)
    if (DOSAGE_REGEX.test(text)) {
        score += 35;
    }

    // 3. High Quality Domain (+25)
    if (isHighQualityDomain(domain)) {
        score += 25;
    } else {
        // Dynamic Brand Trust: Check if domain contains the brand name
        const cleanedTitle = item.title.replace(JUNK_WORDS_REGEX, "").trim();
        const potentialBrand = cleanedTitle.split(" ")[0]?.toLowerCase();
        if (potentialBrand && potentialBrand.length > 3 && link.includes(potentialBrand)) {
            score += 20; // Brand official site
        }
    }

    // 3b. Extractability Tier (+20 / +10 / -15)
    const extractTier = getExtractabilityTier(domain);
    if (extractTier === "A") score += 20;
    if (extractTier === "B") score += 10;
    if (extractTier === "C") score -= 15;

    // 3c. Marketplace penalty (-25)
    if (isMarketplaceDomain(domain)) {
        score -= 25;
    }

    // 4. Image Presence (+10) - Products with images are usually real listings
    if (item.image) {
        score += 10;
    }

    // 5. Snippet Quality (+10) - Longer snippets usually have more info
    if (item.snippet && item.snippet.length > 100) {
        score += 10;
    }

    // 6. Third Party Testing Mention (+15)
    if (THIRD_PARTY_KEYWORDS.some((kw) => text.includes(kw))) {
        score += 15;
    }

    // 7. Strong URL signals (+0~26)
    score += getUrlSignalScore(link);

    // 8. Barcode mentioned (+20)
    if (barcode && (item.title.includes(barcode) || item.snippet.includes(barcode))) {
        score += 20;
    }

    return Math.min(100, Math.max(0, score));
};

export const scoreSearchQuality = (items: SearchItem[], options: SearchScoreOptions = {}): number => {
    if (!items.length) return 0;

    const scores = items
        .map((item) => scoreSearchItem(item, options))
        .sort((a, b) => b - a);

    // Use a top-k average to avoid "one lucky item" passing the threshold
    const topK = Math.min(2, scores.length);
    const baseScore = scores.slice(0, topK).reduce((acc, cur) => acc + cur, 0) / topK;

    const highQualityCount = items.filter((item) => isHighQualityDomain(item.link)).length;
    const uniqueDomains = new Set(items.map((item) => resolveDomain(item.link)));
    const extractableCount = items.filter((item) => getExtractabilityTier(item.link) === "A").length;
    const marketplaceCount = items.filter((item) => isMarketplaceDomain(item.link)).length;

    const highQualityBonus = Math.min(15, highQualityCount * 5);
    const diversityBonus = Math.min(10, Math.max(0, uniqueDomains.size - 1) * 3);
    const extractabilityBonus = Math.min(15, extractableCount * 5);
    const marketplacePenalty = Math.min(20, marketplaceCount * 5);

    return Math.min(100, Math.max(0, Math.round(baseScore + highQualityBonus + diversityBonus + extractabilityBonus - marketplacePenalty)));
};

export const getSearchQualitySummary = (items: SearchItem[], options: SearchScoreOptions = {}) => {
    const scores = items.map((item) => scoreSearchItem(item, options)).sort((a, b) => b - a);
    return {
        score: scoreSearchQuality(items, options),
        topScores: scores.slice(0, 3),
        highQualityCount: items.filter((item) => isHighQualityDomain(item.link)).length,
        uniqueDomains: new Set(items.map((item) => resolveDomain(item.link))).size,
        extractableCount: items.filter((item) => getExtractabilityTier(item.link) === "A").length,
        marketplaceCount: items.filter((item) => isMarketplaceDomain(item.link)).length,
    };
};

const DOMAIN_CLEANUP_REGEX =
    /\b(amazon|walmart|iherb|costco|ebay|target|gnc|vitaminshoppe|walgreens|cvs)(\s?\.?\s?(com|ca|co|uk|net|org))?\b/gi;

export const constructFallbackQuery = (items: SearchItem[]): string | null => {
    if (!items.length) return null;

    // Find the best candidate item (e.g., from a good domain or just the first one)
    // For simplicity, we'll check the first few items for a "clean" looking title
    const candidate = items[0];
    if (!candidate) return null;

    let title = candidate.title;

    // 1. Remove domain noise (e.g. "Amazon.com", " - iHerb")
    title = title.replace(DOMAIN_CLEANUP_REGEX, "");

    // 2. Remove junk words
    title = title.replace(JUNK_WORDS_REGEX, "");

    // 3. Remove special characters and extra spaces
    title = title.replace(/[^a-zA-Z0-9\s]/g, " ").replace(/\s+/g, " ").trim();

    // 4. Extract potential brand (first word if capitalized? or just use the whole cleaned title)
    // Heuristic: The whole cleaned title is usually "Brand Product Name"
    // We'll just use the cleaned title + "supplement facts ingredients"

    if (title.length < 3) return null;

    return `${title} supplement facts ingredients`;
};
