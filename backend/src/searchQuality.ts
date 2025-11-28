import type { SearchItem } from "./types.js";

const HIGH_QUALITY_DOMAINS = [
    "amazon.com",
    "iherb.com",
    "costco.com",
    "costco.ca",
    "walmart.com",
    "target.com",
    "gnc.com",
    "vitaminshoppe.com",
    "bodybuilding.com",
    "myprotein.com",
    "bulksupplements.com",
    "nowfoods.com",
    "thorne.com",
    "pureencapsulations.com",
    "lifeextension.com",
    "gardenoflife.com",
    "nordicnaturals.com",
    "jarrow.com",
    "doctorsbest.com",
    "swansonvitamins.com",
    "pipingrock.com",
    "luckyvitamin.com",
    "vitacost.com",
];

const JUNK_WORDS_REGEX =
    /\b(pack of \d+|lot of \d+|exp \d+|expiration|expires|best by|capsules|tablets|softgels|pills|count|ct|oz|lb|kg|g|mg|mcg|iu)\b/gi;

const DOSAGE_REGEX = /\b\d+\s?(mg|g|mcg|iu|i\.u\.)\b/i;

const KEYWORDS = ["ingredients", "supplement facts", "nutrition facts"];

export const scoreSearchQuality = (items: SearchItem[]): number => {
    if (!items.length) return 0;

    let maxScore = 0;

    for (const item of items) {
        let score = 0;
        const text = `${item.title} ${item.snippet}`.toLowerCase();
        const link = item.link.toLowerCase();

        // 1. Keywords (+30)
        if (KEYWORDS.some((kw) => text.includes(kw))) {
            score += 30;
        }

        // 2. Dosage Patterns (+40)
        if (DOSAGE_REGEX.test(text)) {
            score += 40;
        }

        // 3. High Quality Domain (+30)
        let domainScore = 0;
        if (HIGH_QUALITY_DOMAINS.some((domain) => link.includes(domain))) {
            domainScore = 30;
        } else {
            // Dynamic Brand Trust: Check if domain contains the brand name
            // Heuristic: First word of the cleaned title is often the brand
            const cleanedTitle = item.title.replace(JUNK_WORDS_REGEX, "").trim();
            const potentialBrand = cleanedTitle.split(" ")[0]?.toLowerCase();
            if (potentialBrand && potentialBrand.length > 3 && link.includes(potentialBrand)) {
                domainScore = 30;
            }
        }
        score += domainScore;

        if (score > maxScore) {
            maxScore = score;
        }
    }

    return Math.min(100, maxScore);
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
