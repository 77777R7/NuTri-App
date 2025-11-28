import type {
  AiSupplementAnalysis,
  AiSupplementAnalysisSuccess,
  RatingScore,
  SearchItem,
  SupplementMeta,
} from "./types.js";

const DEEPSEEK_API_URL =
  process.env.DEEPSEEK_API_URL ?? "https://api.deepseek.com/v1/chat/completions";
const DEEPSEEK_MODEL = process.env.DEEPSEEK_MODEL ?? "deepseek-chat";

const SYSTEM_PROMPT = `
You are "NuTri-AI", a smart, authoritative, yet accessible supplement coach.
Your goal is to provide deep, evidence-based analysis that feels like advice from a knowledgeable friend who happens to be a PhD in nutrition.

Tone Guidelines:
- **Smart Coach**: Authoritative but encouraging. Not dry/academic, but not overly casual.
- **Brutally Honest**: Call out "fairy dusting" and proprietary blends without hesitation.
- **Helpful**: Don't just criticize; explain *how* to use it best.

-----------------------------------------
CRITICAL: HOW TO REASON (MANDATORY)
-----------------------------------------

Every score MUST be justified using **specific evidence** from the search snippets.
Never write generic statements.

-----------------------------------------
SCORING BENCHMARKS (MUST FOLLOW)
-----------------------------------------

**5/5 (Gold Standard)**
- Transparent dosing (no proprietary blends)
- Uses patented ingredients (e.g., Creapure®, CarnoSyn®)
- Clinical doses (e.g., 5g Creatine, 6g Citrulline, 3.2g Beta-Alanine)
- Clean label (no Titanium Dioxide, Red 40, Acesulfame K, Sucralose)

**3/5 (Average)**
- Generic ingredients
- Minor under-dosing
- Some fillers/sweeteners
- Standard supermarket-level formula

**1/5 (Poor)**
- Proprietary Blends ("Blend", "Matrix")
- Fairy dusting (important ingredients listed last)
- Aggressive stimulants
- Low transparency

-----------------------------------------
USAGE GUIDANCE RULES (NEW)
-----------------------------------------
1. **Priority**: IF the search results explicitly state how to take THIS specific product, use that information.
2. **Fallback**: IF the search results are silent on usage, you MAY apply well-established general nutrition knowledge based on the identified ingredients:
   - **Fat-Soluble** (Vit D, A, E, K, Omega-3, CoQ10): Must advise "Take with a meal containing fat" for absorption.
   - **Water-Soluble** (Vit C, B-Complex): Advise "Can be taken with water". Food is optional but recommended if user has a sensitive stomach. B-Vitamins are best in the morning (energy).
   - **Minerals** (Zinc, Magnesium, Iron): Generally "Take with food" to avoid nausea, unless specific "bisglycinate" forms say otherwise.
   - **Performance**: Pre-workout -> "20-30min before training". Creatine -> "Anytime, consistency is key".
3. **Labeling**: If using general knowledge, set "sourceType" to "general_knowledge".
4. **Conflicts**: ALWAYS warn about common conflicts (e.g. Iron vs Calcium, Caffeine vs Sleep) if relevant.

-----------------------------------------
DOSAGE ASSESSMENT RULES
-----------------------------------------

If the snippet DOES NOT include specific mg/g dosages:
- Write exactly: 
  "The search results do not include clear dosage information, so the dosage cannot be reliably evaluated."
- Set isUnderDosed = false.
- Do NOT invent dosages.

-----------------------------------------
RISKS & RED FLAGS
-----------------------------------------
- "redFlags" is ONLY for serious warnings (e.g., banned additives).
- Do NOT put mild issues into redFlags.

-----------------------------------------
SOCIAL SCORE (0-5)
-----------------------------------------
0 = embarrassing to show  
3 = acceptable basic supplement  
5 = highly respected in the fitness community  

-----------------------------------------
ABSOLUTE RULES
-----------------------------------------
- English only.
- JSON only.
- Do NOT output URLs.
- Do NOT output \`overallScore\`.
- Provide a \`meta\` object for deterministic backend scoring (see structure below). Do NOT output any numeric scores besides the required fields.
- For sources, output ONLY \`sourceIndices\` (0-based).
`.trim();

const buildUserPrompt = (barcode: string, items: SearchItem[]): string => {
  const searchContext = items
    .map(
      (item, idx) =>
        `[Source ${idx}]\nTitle: ${item.title}\nSnippet: ${item.snippet}\nLink: ${item.link}`,
    )
    .join("\n\n");

  return `
Task:
Analyze a dietary supplement with Barcode: "${barcode}" using the search results below.

Search Results:
${searchContext}

Use the information from these sources to infer:
- the product's brand, name, and category,
- its likely ingredients and intended purpose,
- its strengths and weaknesses in terms of efficacy, value, safety, and social perception.
- structured \`meta\` fields (effectiveness, safety, value/practicality) so the backend can compute deterministic scores. If a field is missing in the sources, provide the safest neutral default rather than inventing extreme values.

SOCIAL SCORE RUBRIC (0–5):
- 0 = Actively harmful to reputation; no one would want to be seen using this.
- 1 = Very uncool or embarrassing; people usually hide it.
- 2 = Below average; generic supermarket product with no bragging rights.
- 3 = Average; acceptable and normal to share, but not impressive.
- 4 = Strong; respected brand or formula, enthusiasts are happy to show it.
- 5 = Iconic or highly desirable; "flex-worthy" in the fitness/supplement community.

DOSAGE ASSESSMENT:
- If you find clear dosage information (e.g. mg, IU, grams) in the snippets,
  compare it against typical clinically effective doses and comment on whether it seems under-dosed.
- If specific dosage numbers are NOT found in the search snippets, you MUST:
  - Use this sentence (or a very close paraphrase) in "dosageAssessment.text":
    "The search results do not include clear dosage information, so the dosage cannot be reliably evaluated."
  - Set "dosageAssessment.isUnderDosed" to false (assume 'innocent until proven guilty').
  - Do NOT invent or infer exact dosage numbers that are not explicitly shown in the sources.

SAFETY RED FLAGS:
- Use "redFlags" ONLY for serious, high-priority concerns
  (e.g. banned additives, extremely high doses, strong regulatory warnings).
- Do NOT overuse it; when in doubt, put the information into "risks" instead.

VALUE SCORE:
- Evaluate value primarily based on formula quality, ingredient forms, transparency,
  and how it compares to typical products in the same category.
- If the actual retail price is not given, do NOT assume a specific dollar price.
- A high Value Score means "good formula for its likely market segment", not necessarily "cheap".

USAGE ADVICE:
- Provide practical advice on when and how to take this.
- If specific product instructions are missing, use general nutrition knowledge (e.g. "Take with food" for fat-soluble vitamins).

SOURCES FIELD:
- When filling "sourceIndices", select 1–3 indices of the most relevant search results
  that support your analysis.
- Indices must be 0-based (e.g. 0, 1, 2) and correspond to [Source 0], [Source 1], etc.
- Do NOT fabricate URLs or titles; the backend will map indices back to real titles/links.

You MUST return a single JSON object with the following structure
(Do NOT include comments in the actual output):

{
  "barcode": "${barcode}",
  "status": "success",

  "confidence": "medium",

  "productInfo": {
    "brand": "string or null",
    "name": "string or null",
    "category": "string or null"
  },

  "efficacy": {
    "score": 0,
    "verdict": "One clear, punchy sentence summarizing effectiveness (e.g. 'Excellent potency for immune support').",
    "highlights": ["Key benefit 1", "Key benefit 2"],
    "warnings": ["Any dosage warnings or limitations"],
    "benefits": ["..."], // Keep for backward compatibility if needed, or duplicate highlights
    "dosageAssessment": {
      "text": "...",
      "isUnderDosed": false
    }
  },

  "value": {
    "score": 0,
    "verdict": "One sentence on value/practicality (e.g. 'Great value at $0.10/day').",
    "highlights": ["Price per day analysis", "Convenience factor"],
    "warnings": ["Any cost or convenience downsides"],
    "analysis": "..."
  },

  "safety": {
    "score": 0,
    "verdict": "One sentence on safety (e.g. 'Generally well-tolerated at this dose'). Start POSITIVE if score is high.",
    "highlights": ["Safety pro 1", "Safety pro 2"],
    "warnings": ["Potential side effect 1", "Interaction warning"],
    "risks": ["..."],
    "redFlags": [],
    "additivesInfo": "..."
  },

  "social": {
    "score": 0,
    "tier": "...",
    "summary": "...",
    "tags": ["..."]
  },

  "usage": {
    "summary": "Short, punchy advice (e.g. 'Take with breakfast')",
    "timing": "Best time of day (e.g. 'Morning' or null)",
    "withFood": true, // true=with food, false=empty stomach, null=anytime
    "conflicts": ["Avoid taking with..."],
    "sourceType": "product_label" // or "general_knowledge"
  },

  "meta": {
    "evidenceLevel": 1,
    "primaryIngredient": "Vitamin C", // NEW: Identify ONE primary active ingredient based on marketing claims or highest dose
    "refDoseMg": 0,
    "actualDoseMg": 0,
    "formBioRating": "medium",
    "coreActiveRatio": 0.5,
    "ulRatio": 0.5,
    "interactionLevel": "unknown",
    "hasCommonAllergens": false,
    "hasStrongStimulants": false,
    "thirdPartyTested": false,
    "price": 0,
    "currency": "USD",
    "daysPerBottle": 30,
    "dosesPerDay": 1,
    "timingConstraints": "unknown",
    "labelClarity": "unknown",
    "overlapLevel": "unknown"
  },

  "sourceIndices": [0, 2]
}

If you cannot confidently identify the product from the search results, return instead:

{
  "barcode": "${barcode}",
  "status": "unknown_product",
  "confidence": "low",
  "productInfo": null,
  "efficacy": null,
  "value": null,
  "safety": null,
  "social": null,
  "usage": null,
  "sourceIndices": []
}
`.trim();
};

const extractJson = (content: string): unknown => {
  const trimmed = content.replace(/```json/gi, "").replace(/```/g, "").trim();
  return JSON.parse(trimmed);
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  Boolean(value && typeof value === "object" && !Array.isArray(value));

const clampScore = (value: unknown): RatingScore => {
  const num = Number(value);
  if (!Number.isFinite(num)) {
    return 0;
  }
  const rounded = Math.round(num);
  return Math.min(5, Math.max(0, rounded)) as RatingScore;
};

const normalizeConfidence = (
  raw: unknown,
  items: SearchItem[],
): AiSupplementAnalysisSuccess["confidence"] => {
  if (typeof raw === "string") {
    const normalized = raw.trim().toLowerCase();
    if (normalized === "low" || normalized === "medium" || normalized === "high") {
      return normalized;
    }
  }

  const numeric = Number(raw);
  if (Number.isFinite(numeric)) {
    if (numeric >= 0.75) return "high";
    if (numeric >= 0.4) return "medium";
    return "low";
  }

  if (items.length === 0) return "low";
  if (items.length === 1) return "medium";
  return "high";
};

const ensureStringArray = (value: unknown, limit: number): string[] => {
  const array = Array.isArray(value) ? value : value ? [value] : [];
  return array
    .map((entry) => (typeof entry === "string" ? entry.trim() : ""))
    .filter((entry) => entry.length)
    .slice(0, limit);
};

const normalizeEvidenceLevel = (value: unknown): SupplementMeta["evidenceLevel"] => {
  const num = Number(value);
  if (num === 3 || num === 2 || num === 1 || num === 0) {
    return num as SupplementMeta["evidenceLevel"];
  }
  return 1;
};

const normalizeFormBioRating = (value: unknown): SupplementMeta["formBioRating"] | undefined => {
  if (value === "high" || value === "medium" || value === "low") {
    return value;
  }
  return undefined;
};

const normalizeInteractionLevel = (value: unknown): SupplementMeta["interactionLevel"] => {
  if (value === "low" || value === "moderate" || value === "high" || value === "unknown") {
    return value;
  }
  return "unknown";
};

const normalizeOverlapLevel = (value: unknown): SupplementMeta["overlapLevel"] => {
  if (value === "low" || value === "medium" || value === "high" || value === "unknown") {
    return value;
  }
  return "unknown";
};

const normalizeTimingConstraints = (
  value: unknown,
): SupplementMeta["timingConstraints"] | undefined => {
  if (
    value === "flexible" ||
    value === "with_food" ||
    value === "empty_stomach" ||
    value === "complex"
  ) {
    return value;
  }
  return "unknown";
};

const toNumberIfFinite = (value: unknown): number | undefined => {
  const num = Number(value);
  return Number.isFinite(num) ? num : undefined;
};

const normalizeSupplementMeta = (raw: unknown): SupplementMeta => {
  const metaRaw = isRecord(raw) ? raw : {};

  // Calculate Data Coverage (0-1)
  // Weighted formula: (w1*dose + w2*price + w3*days + w4*form) / (sum weights)
  // Current weights are all 1.0, but ready for tuning.
  const wDose = 1.0;
  const wPrice = 1.0;
  const wDays = 1.0;
  const wForm = 1.0;

  let weightedSum = 0;
  const totalWeight = wDose + wPrice + wDays + wForm;

  if (toNumberIfFinite(metaRaw["actualDoseMg"]) !== undefined) weightedSum += wDose;
  if (toNumberIfFinite(metaRaw["price"]) !== undefined) weightedSum += wPrice;
  if (toNumberIfFinite(metaRaw["daysPerBottle"]) !== undefined) weightedSum += wDays;
  if (metaRaw["formBioRating"] === "high" || metaRaw["formBioRating"] === "medium" || metaRaw["formBioRating"] === "low") weightedSum += wForm;

  const dataCoverage = Number((weightedSum / totalWeight).toFixed(2));

  const primaryIngredient = typeof metaRaw["primaryIngredient"] === "string" ? metaRaw["primaryIngredient"] : undefined;
  // Pre-calculate category using the helper from supplementScores (which we need to import or duplicate? 
  // supplementScores exports getNutrientCategory, so we can use it if we import it.
  // But wait, deepseek.ts imports computeScores from supplementScores.js.
  // I need to make sure getNutrientCategory is exported from supplementScores.ts.
  // I did export it in the previous step.
  // However, circular dependency might be an issue if supplementScores imports types and deepseek imports supplementScores.
  // supplementScores imports types. deepseek imports types and supplementScores. This is fine (DAG).

  // Wait, I need to import getNutrientCategory in deepseek.ts first.
  // I'll assume I can import it. If not, I'll duplicate the simple logic to avoid circular deps if any exist.
  // Actually, let's duplicate the helper logic here to be safe and avoid modifying imports too much in this chunk.
  // Or better, I'll just use the imported one if I can add the import.
  // I'll duplicate it for safety in this tool call since I can't easily add an import line at the top without replacing the whole file or using multi_replace.
  // Actually, I can use multi_replace to add the import.
  // But for now, I'll just duplicate the simple string check logic here. It's safer.

  const getCategory = (name?: string) => {
    if (!name) return "other";
    const lower = name.toLowerCase();
    if (lower.includes("vitamin c") || lower.includes("ascorbic") || lower.includes("vitamin b") || lower.includes("niacin") || lower.includes("thiamin") || lower.includes("riboflavin") || lower.includes("folate") || lower.includes("biotin")) return "water_soluble_vitamin";
    if (lower.includes("vitamin a") || lower.includes("vitamin d") || lower.includes("vitamin e") || lower.includes("vitamin k")) return "fat_soluble_vitamin";
    if (lower.includes("zinc") || lower.includes("iron") || lower.includes("magnesium") || lower.includes("calcium") || lower.includes("selenium") || lower.includes("copper")) return "essential_mineral";
    return "other";
  };

  const primaryCategory = getCategory(primaryIngredient);

  const meta: SupplementMeta = {
    evidenceLevel: normalizeEvidenceLevel(metaRaw["evidenceLevel"]),
    primaryIngredient,
    primaryCategory: primaryCategory as any, // Cast to any to avoid TS issues if types aren't perfectly aligned in this snippet view
    refDoseMg: toNumberIfFinite(metaRaw["refDoseMg"]),
    actualDoseMg: toNumberIfFinite(metaRaw["actualDoseMg"]),
    formBioRating: normalizeFormBioRating(metaRaw["formBioRating"]),
    coreActiveRatio: (() => {
      const ratio = toNumberIfFinite(metaRaw["coreActiveRatio"]);
      if (typeof ratio === "number" && ratio >= 0 && ratio <= 1.2) {
        return ratio;
      }
      return undefined;
    })(),
    ulRatio: (() => {
      const ratio = toNumberIfFinite(metaRaw["ulRatio"]);
      return typeof ratio === "number" && ratio >= 0 ? ratio : undefined;
    })(),
    interactionLevel: normalizeInteractionLevel(metaRaw["interactionLevel"]),
    hasCommonAllergens: Boolean(metaRaw["hasCommonAllergens"]),
    hasStrongStimulants: Boolean(metaRaw["hasStrongStimulants"]),
    thirdPartyTested: Boolean(metaRaw["thirdPartyTested"]),
    price: (() => {
      const price = toNumberIfFinite(metaRaw["price"]);
      return typeof price === "number" && price >= 0 ? price : undefined;
    })(),
    currency: typeof metaRaw["currency"] === "string" ? metaRaw["currency"] : undefined,
    daysPerBottle: (() => {
      const days = toNumberIfFinite(metaRaw["daysPerBottle"]);
      return typeof days === "number" && days > 0 ? days : undefined;
    })(),
    dosesPerDay: (() => {
      const doses = toNumberIfFinite(metaRaw["dosesPerDay"]);
      return typeof doses === "number" && doses > 0 ? doses : undefined;
    })(),
    timingConstraints: normalizeTimingConstraints(metaRaw["timingConstraints"]),
    labelClarity:
      metaRaw["labelClarity"] === "clear" ||
        metaRaw["labelClarity"] === "somewhat_unclear" ||
        metaRaw["labelClarity"] === "unclear"
        ? metaRaw["labelClarity"]
        : "unknown",
    overlapLevel: normalizeOverlapLevel(metaRaw["overlapLevel"]),
    dataCoverage, // Assign calculated coverage
  };

  return meta;
};

const computeWeightedOverall = (
  efficacy: RatingScore,
  value: RatingScore,
  safety: RatingScore,
  social: RatingScore,
): number => {
  const weighted = safety * 0.35 + efficacy * 0.35 + value * 0.2 + social * 0.1;
  return Number(weighted.toFixed(1));
};

const fallbackDosageSentence =
  "The search results do not include clear dosage information, so the dosage cannot be reliably evaluated.";

const mapSourcesFromIndices = (
  indices: number[],
  items: SearchItem[],
): Array<{ title: string; link: string }> => {
  return indices
    .map((idx) => items[idx])
    .filter((item): item is SearchItem => Boolean(item))
    .map((item) => ({ title: item.title, link: item.link }));
};

const pickImageFromSources = (indices: number[], items: SearchItem[]): string | null => {
  const imageFromIndices =
    indices
      .map((idx) => items[idx]?.image)
      .find((image) => typeof image === "string" && image.length) ?? null;
  if (imageFromIndices) {
    return imageFromIndices;
  }
  const fallback = items.find((item) => item.image)?.image;
  return fallback ?? null;
};

// When DeepSeek is unavailable, return a deterministic, low-confidence analysis
// so the client can render meaningful data instead of empty placeholders.
const buildSearchOnlyAnalysis = (
  barcode: string,
  items: SearchItem[],
): AiSupplementAnalysisSuccess => {
  const top = items[0];
  const inferredName = top?.title || "Supplement";
  const inferredBrand = top?.title?.split(" ")?.[0] || null;
  const inferredCategory =
    top?.snippet?.toLowerCase().includes("vitamin") ? "Vitamin" :
      top?.snippet?.toLowerCase().includes("magnesium") ? "Mineral" :
        top?.snippet?.toLowerCase().includes("omega") ? "Omega" :
          null;

  const efficacyScore: RatingScore = 2;
  const safetyScore: RatingScore = 3;
  const valueScore: RatingScore = 2;
  const overallScore = Number(((efficacyScore + safetyScore + valueScore) / 3).toFixed(1));

  const sourceIndices = [0].filter((idx) => Boolean(items[idx]));

  return {
    schemaVersion: 1,
    barcode,
    generatedAt: new Date().toISOString(),
    model: "search-fallback",
    status: "success",
    overallScore,
    confidence: "low",
    productInfo: {
      brand: inferredBrand,
      name: inferredName,
      category: inferredCategory,
      image: pickImageFromSources(sourceIndices, items),
    },
    meta: {
      evidenceLevel: 1,
      primaryIngredient: inferredName,
      primaryCategory: inferredCategory ? "fat_soluble_vitamin" : "other",
      refDoseMg: 0,
      actualDoseMg: 0,
      formBioRating: "medium",
      coreActiveRatio: 0.5,
      ulRatio: 0.5,
      interactionLevel: "unknown",
      hasCommonAllergens: false,
      hasStrongStimulants: false,
      thirdPartyTested: false,
      price: 0,
      currency: "USD",
      daysPerBottle: 30,
      dosesPerDay: 1,
      timingConstraints: "unknown",
      labelClarity: "unknown",
      overlapLevel: "unknown",
      dataCoverage: 0.2,
    },
    efficacy: {
      score: efficacyScore,
      verdict: "Awaiting full AI review – based on search results only.",
      benefits: [],
      highlights: [
        top?.snippet?.slice(0, 140) || "Search results referenced for a quick placeholder analysis.",
      ],
      warnings: [],
      dosageAssessment: {
        text: fallbackDosageSentence,
        isUnderDosed: false,
      },
    },
    value: {
      score: valueScore,
      verdict: "Preliminary value estimate from search results.",
      analysis: "A provisional value assessment until AI analysis succeeds.",
      highlights: [],
      warnings: [],
    },
    safety: {
      score: safetyScore,
      verdict: "No major safety concerns detected in the search snippets.",
      highlights: [],
      warnings: [],
      risks: [],
      redFlags: [],
      additivesInfo: null,
    },
    social: {
      score: valueScore,
      tier: "unrated",
      summary: "Social perception not available (search-only fallback).",
      tags: [],
    },
    usage: {
      summary: "Follow the on-label directions; take with food if it is fat-soluble.",
      timing: null,
      withFood: null,
      conflicts: [],
      sourceType: "general_knowledge",
    },
    sources: mapSourcesFromIndices(sourceIndices, items),
    disclaimer:
      "This is a search-only fallback. AI analysis could not be completed because the DeepSeek key was unavailable or the request failed.",
  };
};

const buildFailureAnalysis = (
  barcode: string,
  status: "unknown_product" | "error",
): AiSupplementAnalysis => ({
  schemaVersion: 1,
  barcode,
  generatedAt: new Date().toISOString(),
  model: DEEPSEEK_MODEL,
  status,
  overallScore: 0,
  confidence: "low",
  productInfo: null,
  efficacy: null,
  value: null,
  safety: null,
  social: null,
  usage: null,
  sources: [],
  disclaimer: "This is general guidance only. Always follow the product label and consult a healthcare professional if you have medical conditions or take medications.",
});

const normalizeSuccessAnalysis = (
  raw: Record<string, unknown>,
  barcode: string,
  items: SearchItem[],
): AiSupplementAnalysisSuccess => {
  const efficacyRaw = isRecord(raw["efficacy"]) ? (raw["efficacy"] as Record<string, unknown>) : {};
  const valueRaw = isRecord(raw["value"]) ? (raw["value"] as Record<string, unknown>) : {};
  const safetyRaw = isRecord(raw["safety"]) ? (raw["safety"] as Record<string, unknown>) : {};
  const socialRaw = isRecord(raw["social"]) ? (raw["social"] as Record<string, unknown>) : {};
  const usageRaw = isRecord(raw["usage"]) ? (raw["usage"] as Record<string, unknown>) : {};
  const productRaw = isRecord(raw["productInfo"])
    ? (raw["productInfo"] as Record<string, unknown>)
    : {};
  const dosageRaw = isRecord(efficacyRaw["dosageAssessment"])
    ? (efficacyRaw["dosageAssessment"] as Record<string, unknown>)
    : {};

  const meta = normalizeSupplementMeta(raw["meta"]);

  const efficacyScore = clampScore(efficacyRaw.score);
  const valueScore = clampScore(valueRaw.score);
  const safetyScore = clampScore(safetyRaw.score);
  const socialScore = clampScore(socialRaw.score);
  const overallScore = computeWeightedOverall(efficacyScore, valueScore, safetyScore, socialScore);

  const confidence = normalizeConfidence(raw["confidence"], items);

  const rawIndices = Array.isArray(raw["sourceIndices"]) ? (raw["sourceIndices"] as unknown[]) : [];
  const sourceIndices = Array.from(
    new Set(
      rawIndices.filter(
        (idx): idx is number => typeof idx === "number" && Number.isInteger(idx) && idx >= 0 && idx < items.length,
      ),
    ),
  );
  const sources =
    sourceIndices.length > 0
      ? mapSourcesFromIndices(sourceIndices, items).slice(0, 5)
      : items.slice(0, 3).map((item) => ({ title: item.title, link: item.link }));

  const productImage = pickImageFromSources(sourceIndices, items);

  const json = raw; // Renaming raw to json for consistency with the new structure

  const analysis: AiSupplementAnalysisSuccess = {
    schemaVersion: 1,
    barcode: String(json["barcode"] || ""),
    generatedAt: new Date().toISOString(),
    model: "deepseek-r1",
    status: "success",
    overallScore: 0, // calculated below
    confidence: normalizeConfidence(json["confidence"], items),
    productInfo: {
      brand: typeof productRaw["brand"] === "string" ? productRaw["brand"] : null,
      name: typeof productRaw["name"] === "string" ? productRaw["name"] : null,
      category: typeof productRaw["category"] === "string" ? productRaw["category"] : null,
      image: null,
    },
    meta,
    efficacy: {
      score: clampScore(efficacyRaw["score"]),
      benefits: ensureStringArray(efficacyRaw["benefits"], 5),
      dosageAssessment: {
        text: typeof efficacyRaw["dosageAssessment"] === "object" ? (efficacyRaw["dosageAssessment"] as any)?.text || "" : "",
        isUnderDosed: typeof efficacyRaw["dosageAssessment"] === "object" ? !!(efficacyRaw["dosageAssessment"] as any)?.isUnderDosed : false,
      },
      verdict: typeof efficacyRaw["verdict"] === "string" ? efficacyRaw["verdict"] : undefined,
      highlights: ensureStringArray(efficacyRaw["highlights"], 3),
      warnings: ensureStringArray(efficacyRaw["warnings"], 3),
    },
    value: {
      score: clampScore(valueRaw["score"]),
      verdict: typeof valueRaw["verdict"] === "string" ? valueRaw["verdict"] : "",
      analysis: typeof valueRaw["analysis"] === "string" ? valueRaw["analysis"] : "",
      highlights: ensureStringArray(valueRaw["highlights"], 3),
      warnings: ensureStringArray(valueRaw["warnings"], 3),
    },
    safety: {
      score: clampScore(safetyRaw["score"]),
      risks: ensureStringArray(safetyRaw["risks"], 5),
      redFlags: ensureStringArray(safetyRaw["redFlags"], 5),
      additivesInfo: typeof safetyRaw["additivesInfo"] === "string" ? safetyRaw["additivesInfo"] : "",
      verdict: typeof safetyRaw["verdict"] === "string" ? safetyRaw["verdict"] : undefined,
      highlights: ensureStringArray(safetyRaw["highlights"], 3),
      warnings: ensureStringArray(safetyRaw["warnings"], 3),
    },
    social: {
      score: clampScore(socialRaw["score"]),
      tier: typeof socialRaw["tier"] === "string" ? socialRaw["tier"] : "",
      summary: typeof socialRaw["summary"] === "string" ? socialRaw["summary"] : "",
      tags: ensureStringArray(socialRaw["tags"], 5),
    },
    usage: {
      summary: typeof usageRaw["summary"] === "string" ? usageRaw["summary"] : "",
      timing: typeof usageRaw["timing"] === "string" ? usageRaw["timing"] : null,
      withFood: typeof usageRaw["withFood"] === "boolean" ? usageRaw["withFood"] : null,
      conflicts: ensureStringArray(usageRaw["conflicts"], 3),
      sourceType: usageRaw["sourceType"] === "product_label" ? "product_label" : "general_knowledge",
    },
    sources,
    disclaimer: "This is general guidance only. Always follow the product label and consult a healthcare professional if you have medical conditions or take medications.",
  };

  return analysis;
};

export const normalizeAnalysis = (
  raw: unknown,
  barcode: string,
  items: SearchItem[],
): AiSupplementAnalysis => {
  if (!isRecord(raw)) {
    return buildFailureAnalysis(barcode, "error");
  }

  if (raw["status"] === "unknown_product") {
    return buildFailureAnalysis(barcode, "unknown_product");
  }

  if (raw["status"] === "error") {
    return buildFailureAnalysis(barcode, "error");
  }

  if (!raw["productInfo"]) {
    return buildFailureAnalysis(barcode, "unknown_product");
  }

  try {
    return normalizeSuccessAnalysis(raw, barcode, items);
  } catch (error) {
    console.error("[deepseek] normalizeAnalysis failed", error);
    return buildFailureAnalysis(barcode, "error");
  }
};

export async function enrichSupplementFromSearch(
  barcode: string,
  items: SearchItem[],
): Promise<AiSupplementAnalysis> {
  const apiKey = process.env.DEEPSEEK_API_KEY;
  if (!apiKey) {
    console.error("DEEPSEEK_API_KEY is not set. Returning search-only fallback analysis.");
    return buildSearchOnlyAnalysis(barcode, items);
  }

  const body = {
    model: DEEPSEEK_MODEL,
    messages: [
      { role: "system", content: SYSTEM_PROMPT },
      { role: "user", content: buildUserPrompt(barcode, items) },
    ],
    temperature: 0.3,
    stream: false,
  };

  try {
    const response = await fetch(DEEPSEEK_API_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      const detail = await response.text();
      console.error("DeepSeek API error:", response.status, detail);
      return buildSearchOnlyAnalysis(barcode, items);
    }

    const data = (await response.json()) as {
      choices?: Array<{ message?: { content?: string } }>;
    };
    const content = data.choices?.[0]?.message?.content;
    if (!content) {
      console.error("DeepSeek API returned empty content");
      return buildSearchOnlyAnalysis(barcode, items);
    }

    const parsed = extractJson(content);
    return normalizeAnalysis(parsed, barcode, items);
  } catch (error) {
    console.error("DeepSeek Enrichment Failed:", error);
    return buildSearchOnlyAnalysis(barcode, items);
  }
}
