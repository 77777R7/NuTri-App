/**
 * Brand Extractor Module
 * Extracts brand and product name from search results with confidence scoring
 * Uses rule-based extraction with AI fallback
 */

import { HttpError, TimeoutError, combineSignals, createTimeoutSignal, isAbortError, isRetryableStatus, withRetry } from "./resilience.js";
import type { CircuitBreaker, DeadlineBudget, RetryOptions, Semaphore } from "./resilience.js";
import type { SearchItem } from "./types.js";

// ============================================================================
// KNOWN BRANDS LIST (200+ brands from iHerb, Amazon, and major retailers)
// ============================================================================

// North American Popular Brands
const NA_BRANDS = [
    // Major US Brands
    "now foods", "now", "nature made", "nature's bounty", "nature's way",
    "garden of life", "nordic naturals", "life extension", "solgar", "jarrow",
    "jarrow formulas", "thorne", "thorne research", "pure encapsulations",
    "doctor's best", "nutricost", "sports research", "zhou nutrition", "zhou",
    "natural factors", "source naturals", "solaray", "kal", "country life",
    "bluebonnet", "natrol", "nature's plus", "mega food", "megafood",
    "rainbow light", "new chapter", "garden of life", "ancient nutrition",
    "vital proteins", "orgain", "optimum nutrition", "on", "muscletech",
    "cellucor", "bsn", "ghost", "jym", "kaged muscle", "redcon1",
    "transparent labs", "legion", "momentous", "ritual", "care/of", "careof",
    "hum nutrition", "hum", "olly", "smartypants", "viva naturals",
    "nutrigold", "nested naturals", "ora organic", "mary ruth", "maryruth",
    "mary ruth's", "llama naturals", "nordic naturals", "carlson", "carlson labs",
    "seeking health", "designs for health", "integrative therapeutics",
    "klaire labs", "douglas laboratories", "metagenics", "standard process",
    "allergy research group", "ortho molecular", "xymogen", "pure", "pure encapsulations",
    "numedica", "vital nutrients", "biotics research", "apex energetics",
    "quicksilver scientific", "bulletproof", "athletic greens", "ag1",
    "amazing grass", "organifi", "bloom nutrition", "alani nu", "1st phorm",
    "ascent", "dymatize", "evoq", "isopure", "rule one", "r1", "raw barrel",

    // Canadian Brands
    "jamieson", "webber naturals", "swiss natural", "natural factors",
    "progressive", "genuine health", "new roots herbal", "new roots",
    "canprev", "aor", "advanced orthomolecular research", "prairie naturals",
    "organika", "flora", "st francis herb farm", "clef des champs",
    "lorna vanderhaeghe", "botanica", "purica", "preferred nutrition",
    "naka", "platinum naturals", "greens+", "iron vegan", "vega",
    "sisu", "gandalf", "assured natural", "bell lifestyle", "healthology",
    "joy spring", "prairie naturals", "innovite", "cyto matrix",

    // UK/Europe Brands
    "solgar", "holland & barrett", "vitabiotics", "healthspan", "natures aid",
    "together health", "viridian", "pukka", "cytoplan", "biocare",
    "nutri advanced", "lamberts", "higher nature", "terranova", "quest",
    "nature's plus", "a vogel", "vogel", "bioforce", "seroyal", "igennus",
    "myprotein", "bulk powders", "bulk", "phd nutrition", "phd",
    "grenade", "maximuscle", "sci-mx", "usn", "reflex nutrition",

    // Australian/NZ Brands
    "blackmores", "swisse", "bioglan", "nature's own", "healthy care",
    "cenovis", "natures way australia", "ethical nutrients", "inner health",
    "nutra life", "thompson's", "go healthy", "radiance", "clinicians",
    "good health", "lifestream", "comvita", "red seal",

    // Asian Market Brands
    "dhc", "fancl", "nature made japan", "asahi", "suntory", "kobayashi",
    "wakamoto", "takeda", "shiseido", "haba", "orbis", "pola",
    "善存", "centrum", "湯臣倍健", "汤臣倍健", "安利", "amway", "nutrilite",
    "康寶萊", "康宝莱", "herbalife", "完美", "infinity", "無限極", "无限极",
    "安麗", "gnc china", "by-health",

    // International/Global Brands
    "now foods", "solgar", "nature's bounty", "centrum", "one a day",
    "alive", "nature's way", "schiff", "move free", "airborne", "emergen-c",
    "ester-c", "citracal", "caltrate", "os-cal", "viactiv", "align",
    "culturelle", "florastor", "phillips", "metamucil", "benefiber",
    "konsyl", "miralax", "dulcolax", "senokot", "colace", "fibercon",
];

// Premium/Clinical Brands (often sold through practitioners)
const PREMIUM_BRANDS = [
    "thorne", "pure encapsulations", "designs for health", "metagenics",
    "integrative therapeutics", "klaire labs", "douglas laboratories",
    "ortho molecular", "xymogen", "vital nutrients", "numedica",
    "allergy research group", "biotics research", "apex energetics",
    "quicksilver scientific", "seeking health", "standard process",
    "premier research labs", "progena", "davinci laboratories",
    "montiff", "metabolic maintenance", "ecological formulas",
    "bio-tech pharmacal", "researched nutritionals", "neurobiologix",
];

// Sports Nutrition Brands
const SPORTS_BRANDS = [
    "optimum nutrition", "on", "bsn", "muscletech", "cellucor", "c4",
    "ghost", "jym", "kaged", "kaged muscle", "redcon1", "transparent labs",
    "legion athletics", "legion", "momentous", "ascent", "dymatize",
    "isopure", "rule one", "r1", "allmax", "mutant", "rivalus",
    "prosupps", "nutrex", "gat", "evlution nutrition", "evl",
    "ronnie coleman", "rich piana", "5% nutrition", "raw nutrition",
    "1st phorm", "axe & sledge", "black market labs", "ryse",
    "gorilla mind", "raw barrel", "bare performance nutrition", "bpn",
];

// Herbal/Natural Brands
const HERBAL_BRANDS = [
    "gaia herbs", "herb pharm", "oregon's wild harvest",
    "nature's answer", "nature's sunshine", "planetary herbals",
    "traditional medicinals", "yogi tea", "celestial seasonings",
    "organic india", "himalaya", "banyan botanicals", "ayush herbs",
    "planetary herbals", "herbalist & alchemist", "wise woman herbals",
    "urban moonshine", "wishgarden herbs", "mountain rose herbs",
    "starwest botanicals", "frontier co-op", "simply organic",
];

// Build the complete set with normalization
const ALL_BRAND_ARRAYS = [NA_BRANDS, PREMIUM_BRANDS, SPORTS_BRANDS, HERBAL_BRANDS];

export const KNOWN_BRANDS: Set<string> = new Set(
    ALL_BRAND_ARRAYS.flat().map((b) => normalizeBrandName(b))
);

// ============================================================================
// NOISE WORDS LIST (to be removed from titles)
// ============================================================================

export const NOISE_WORDS = new Set([
    // Retail Platforms
    "amazon", "amazon.com", "amazon.ca", "amazon.co.uk", "amazon.de",
    "iherb", "iherb.com", "walmart", "walmart.com", "target", "target.com",
    "costco", "costco.com", "costco.ca", "cvs", "cvs.com", "walgreens",
    "gnc", "gnc.com", "vitamin shoppe", "vitaminshoppe",
    "whole foods", "sprouts", "trader joe's",

    // Chinese/Asian Retail
    "旗舰店", "官方旗舰店", "官方店", "官方", "官网", "直营店",
    "天貓", "天猫", "淘寶", "淘宝", "京東", "京东", "拼多多",
    "海外旗艦店", "海外旗舰店", "代購", "代购", "直郵", "直邮",

    // Marketing Words
    "sale", "deal", "discount", "clearance", "save", "off",
    "buy one get one", "bogo", "free shipping", "prime",
    "best seller", "bestseller", "#1", "award", "winning",
    "limited time", "special offer", "hot deal", "flash sale",
    "买一送一", "特惠", "促销", "优惠", "特价", "秒杀", "限时",
    "活动", "包邮", "满减", "赠品", "划算",

    // Rating/Review Noise
    "★", "☆", "✩", "✪", "⭐", "stars", "review", "reviews", "rated",
    "verified", "authentic", "genuine", "original",

    // Count/Quantity Words (keep these minimal, handled by regex)
    "pack of", "lot of", "bundle", "set of", "multipack",

    // Other Noise
    "by", "from", "at", "official", "authorized", "seller",
    "new", "improved", "formula", "version", "edition",
]);

// ============================================================================
// UTILITY FUNCTIONS
// ============================================================================

/**
 * Normalize brand name for matching (lowercase, trim, remove extra spaces)
 */
export function normalizeBrandName(name: string): string {
    return name.toLowerCase().trim().replace(/\s+/g, " ");
}

/**
 * Remove noise words and clean up title
 */
export function cleanTitle(title: string): string {
    let cleaned = title;

    // Remove common suffixes like "- Amazon.com", "| iHerb"
    cleaned = cleaned.replace(/[\-\|–—]\s*(Amazon|iHerb|Walmart|Target|CVS|GNC).*$/gi, "");

    // Remove URL-like patterns
    cleaned = cleaned.replace(/\b(www\.)?\w+\.(com|ca|co\.uk|org|net)\b/gi, "");

    // Remove noise words
    for (const noise of NOISE_WORDS) {
        const regex = new RegExp(`\\b${escapeRegex(noise)}\\b`, "gi");
        cleaned = cleaned.replace(regex, " ");
    }

    // Remove common quantity patterns
    cleaned = cleaned.replace(/\b\d+\s*(count|ct|capsules?|tablets?|softgels?|veggie caps?|vcaps?|pills?)\b/gi, "");
    cleaned = cleaned.replace(/\b\d+\s*(oz|fl\.?\s*oz|ml|g|mg|kg|lb|lbs)\b/gi, "");

    // Remove stars and special characters
    cleaned = cleaned.replace(/[★☆✩✪⭐]/g, "");

    // Clean up extra spaces and punctuation
    cleaned = cleaned.replace(/[^\w\s\-']/g, " ");
    cleaned = cleaned.replace(/\s+/g, " ").trim();

    return cleaned;
}

function escapeRegex(str: string): string {
    return str.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Extract domain from URL
 */
export function extractDomain(url: string): string {
    try {
        const hostname = new URL(url).hostname;
        return hostname.replace(/^www\./, "");
    } catch {
        return url;
    }
}

// ============================================================================
// BRAND EXTRACTION LOGIC
// ============================================================================

export interface BrandExtractionResult {
    brand: string | null;
    product: string | null;
    category: string | null;
    confidence: "high" | "medium" | "low";
    score: number;
    reason: string;
    source: "rule" | "ai";
}

interface ConfidenceFactors {
    knownBrandMatch: boolean;
    firstWordCapitalized: boolean;
    brandAppearsMultipleTimes: boolean;
    hasNoiseWords: boolean;
    titleTooLong: boolean;
    multipleResultsInconsistent: boolean;
}

/**
 * Compute confidence score based on multiple factors
 */
function computeConfidence(factors: ConfidenceFactors): { score: number; reason: string } {
    let score = 0;
    const reasons: string[] = [];

    if (factors.knownBrandMatch) {
        score += 25;
        reasons.push("known brand");
    }

    if (factors.firstWordCapitalized) {
        score += 15;
        reasons.push("capitalized first word");
    }

    if (factors.brandAppearsMultipleTimes) {
        score += 10;
        reasons.push("brand appears multiple times");
    }

    if (factors.hasNoiseWords) {
        score -= 25;
        reasons.push("contains noise words");
    }

    if (factors.titleTooLong) {
        score -= 15;
        reasons.push("title too long");
    }

    if (factors.multipleResultsInconsistent) {
        score -= 20;
        reasons.push("inconsistent results");
    }

    return { score, reason: reasons.join(", ") || "no factors detected" };
}

/**
 * Rule-based brand extraction from a single title
 */
function extractFromTitle(title: string): { brand: string | null; product: string | null } {
    const cleaned = cleanTitle(title);
    const words = cleaned.split(" ").filter((w) => w.length > 0);

    if (words.length === 0) {
        return { brand: null, product: null };
    }

    // Strategy 1: Check if any known brand is in the title
    for (let i = 1; i <= Math.min(4, words.length); i++) {
        const candidate = words.slice(0, i).join(" ");
        if (KNOWN_BRANDS.has(normalizeBrandName(candidate))) {
            return {
                brand: candidate,
                product: words.slice(i).join(" ") || null,
            };
        }
    }

    // Strategy 2: Use first word(s) as brand (up to 2 words)
    // Heuristic: If first word is capitalized and > 3 chars, it's likely a brand
    const firstWord = words[0];
    if (firstWord && firstWord.length > 3 && firstWord[0] === firstWord[0].toUpperCase()) {
        // Check if second word is also part of brand (e.g., "Nature's Bounty")
        if (words[1] && /^[A-Z]/.test(words[1]) && ["'s", "s"].includes(words[0].slice(-2))) {
            return {
                brand: `${words[0]} ${words[1]}`,
                product: words.slice(2).join(" ") || null,
            };
        }
        return {
            brand: firstWord,
            product: words.slice(1).join(" ") || null,
        };
    }

    // Fallback: just return first word as brand
    return {
        brand: words[0] || null,
        product: words.slice(1).join(" ") || null,
    };
}

/**
 * Extract brand and product from search results (rule-based)
 */
export function extractBrandProduct(items: SearchItem[]): BrandExtractionResult {
    if (!items.length) {
        return {
            brand: null,
            product: null,
            category: null,
            confidence: "low",
            score: 0,
            reason: "no search results",
            source: "rule",
        };
    }

    // Extract from the first (best) result
    const primaryTitle = items[0].title;
    const extraction = extractFromTitle(primaryTitle);

    // Analyze confidence factors
    const cleanedTitle = cleanTitle(primaryTitle);
    const normalizedBrand = extraction.brand ? normalizeBrandName(extraction.brand) : "";

    const factors: ConfidenceFactors = {
        knownBrandMatch: normalizedBrand ? KNOWN_BRANDS.has(normalizedBrand) : false,
        firstWordCapitalized: /^[A-Z]/.test(extraction.brand || ""),
        brandAppearsMultipleTimes:
            normalizedBrand.length > 0 && primaryTitle.toLowerCase().split(normalizedBrand).length > 2,
        hasNoiseWords: [...NOISE_WORDS].some((noise) =>
            primaryTitle.toLowerCase().includes(noise.toLowerCase())
        ),
        titleTooLong: primaryTitle.length > 80,
        multipleResultsInconsistent: false, // Will be checked below
    };

    // Check consistency across results
    if (items.length > 1) {
        const otherExtractions = items.slice(1, 3).map((item) => extractFromTitle(item.title));
        const allBrands = [extraction.brand, ...otherExtractions.map((e) => e.brand)]
            .filter(Boolean)
            .map((b) => normalizeBrandName(b!));

        const uniqueBrands = new Set(allBrands);
        factors.multipleResultsInconsistent = uniqueBrands.size > 2;
    }

    const { score, reason } = computeConfidence(factors);

    let confidence: "high" | "medium" | "low" = "low";
    if (score >= 30) confidence = "high";
    else if (score >= 10) confidence = "medium";

    // Try to extract product category from the product name
    const category = extractCategory(extraction.product);

    return {
        brand: extraction.brand,
        product: extraction.product,
        category,
        confidence,
        score,
        reason,
        source: "rule",
    };
}

/**
 * Extract supplement category from product name
 */
function extractCategory(productName: string | null): string | null {
    if (!productName) return null;

    const lower = productName.toLowerCase();

    // Common supplement categories
    const categories: [RegExp, string][] = [
        [/vitamin\s*d3?/i, "Vitamin D"],
        [/vitamin\s*c/i, "Vitamin C"],
        [/vitamin\s*b[\-\s]?complex/i, "B-Complex"],
        [/vitamin\s*b12|methylcobalamin|cyanocobalamin/i, "Vitamin B12"],
        [/omega[\-\s]?3|fish\s*oil|epa.*dha/i, "Omega-3"],
        [/magnesium/i, "Magnesium"],
        [/zinc/i, "Zinc"],
        [/iron/i, "Iron"],
        [/calcium/i, "Calcium"],
        [/probiotics?/i, "Probiotic"],
        [/multivitamin|multi[\-\s]?vitamin/i, "Multivitamin"],
        [/collagen/i, "Collagen"],
        [/turmeric|curcumin/i, "Turmeric"],
        [/ashwagandha/i, "Ashwagandha"],
        [/melatonin/i, "Melatonin"],
        [/coq10|coenzyme\s*q10/i, "CoQ10"],
        [/protein/i, "Protein"],
        [/creatine/i, "Creatine"],
        [/bcaa/i, "BCAA"],
        [/pre[\-\s]?workout/i, "Pre-Workout"],
    ];

    for (const [pattern, category] of categories) {
        if (pattern.test(lower)) {
            return category;
        }
    }

    return null;
}

/**
 * AI fallback for brand extraction (to be called when confidence is low)
 */
export async function extractBrandWithAI(
    items: SearchItem[],
    apiKey: string,
    model: string,
    options: {
        signal?: AbortSignal;
        timeoutMs?: number;
        queueTimeoutMs?: number;
        budget?: DeadlineBudget;
        breaker?: CircuitBreaker;
        semaphore?: Semaphore;
        retry?: Partial<RetryOptions>;
    } = {}
): Promise<BrandExtractionResult> {
    const titles = items.slice(0, 3).map((item) => item.title).join("\n");

    const prompt = `从以下商品标题中提取品牌名和产品名。
不要包含店铺名、活动信息、规格数量。
如果能识别产品类型（如 "Vitamin D3", "Omega-3"），也一并输出。

商品标题：
${titles}

OUTPUT JSON ONLY. NO MARKDOWN:
{
  "brand": "string or null",
  "product": "string or null", 
  "category": "string or null"
}`;

    let release: (() => void) | null = null;
    try {
        if (options.breaker && !options.breaker.canRequest()) {
            return extractBrandProduct(items);
        }

        const timeoutMs = options.timeoutMs ?? 3000;
        const budgetedTimeout = options.budget ? options.budget.msFor(timeoutMs) : timeoutMs;
        if (budgetedTimeout <= 0) {
            return extractBrandProduct(items);
        }

        if (options.semaphore) {
            try {
                release = await options.semaphore.acquire({
                    timeoutMs: options.queueTimeoutMs ?? 0,
                    signal: options.signal,
                });
            } catch {
                return extractBrandProduct(items);
            }
        }

        const retryConfig: RetryOptions = {
            maxAttempts: options.retry?.maxAttempts ?? 2,
            baseDelayMs: options.retry?.baseDelayMs ?? 300,
            maxDelayMs: options.retry?.maxDelayMs ?? 1200,
            jitterRatio: options.retry?.jitterRatio ?? 0.4,
            shouldRetry: (error) => {
                if (error instanceof TimeoutError) return true;
                if (error instanceof HttpError) return isRetryableStatus(error.status);
                if (isAbortError(error)) return false;
                return error instanceof TypeError;
            },
            signal: options.signal,
            budget: options.budget,
        };

        const response = await withRetry(async () => {
            const timeoutSignal = createTimeoutSignal(budgetedTimeout);
            const { signal, cleanup } = combineSignals([options.signal, timeoutSignal]);
            try {
                const result = await fetch("https://api.deepseek.com/v1/chat/completions", {
                    method: "POST",
                    headers: {
                        "Content-Type": "application/json",
                        Authorization: `Bearer ${apiKey}`,
                    },
                    body: JSON.stringify({
                        model,
                        messages: [
                            { role: "system", content: "You are a product name parser. Output JSON only." },
                            { role: "user", content: prompt },
                        ],
                        temperature: 0.1,
                        max_tokens: 200,
                    }),
                    signal,
                });

                if (!result.ok) {
                    throw new HttpError(result.status, `DeepSeek API error: ${result.status}`);
                }

                return result;
            } catch (error) {
                if (timeoutSignal.aborted && !options.signal?.aborted && isAbortError(error)) {
                    throw new TimeoutError();
                }
                throw error;
            } finally {
                cleanup();
            }
        }, retryConfig);

        options.breaker?.recordSuccess();

        const data = (await response.json()) as { choices?: { message?: { content?: string } }[] };
        const content = data.choices?.[0]?.message?.content || "{}";
        const jsonStr = content.replace(/```json/g, "").replace(/```/g, "").trim();
        const parsed = JSON.parse(jsonStr) as { brand?: string; product?: string; category?: string };

        return {
            brand: parsed.brand || null,
            product: parsed.product || null,
            category: parsed.category || null,
            confidence: "medium", // AI extraction gives medium confidence
            score: 20,
            reason: "extracted by AI",
            source: "ai",
        };
    } catch (error) {
        if (!isAbortError(error)) {
            options.breaker?.recordFailure();
        }
        console.error("AI brand extraction failed:", error);

        // Fallback to rule-based extraction
        const ruleResult = extractBrandProduct(items);
        return {
            ...ruleResult,
            reason: `AI failed, fallback: ${ruleResult.reason}`,
        };
    } finally {
        release?.();
    }
}
