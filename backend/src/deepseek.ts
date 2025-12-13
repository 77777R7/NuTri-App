/**
 * DeepSeek AI Integration Module
 * Enhanced prompts for deep ingredient analysis
 */

import { extractDomain, isHighQualityDomain } from "./searchQuality.js";
import type { SearchItem } from "./types.js";

// ============================================================================
// ENHANCED PROMPTS
// ============================================================================

const PROMPT_EFFICACY = `You are NuTri-AI, a supplement science expert. Analyze this supplement with SCIENTIFIC DEPTH.

CRITICAL INSTRUCTIONS:
1. For each key ingredient, identify the EXACT chemical form (e.g., "Cholecalciferol" not just "Vitamin D")
2. Evaluate bioavailability compared to other forms of the same nutrient
3. Assess if the dosage matches clinical research recommendations
4. Evaluate if claimed benefits have scientific evidence
5. DO NOT simply repeat marketing claims from the package
6. If information is not available, use null instead of guessing
7. Pick the SINGLE most important ingredient as "primaryActive" (usually the one on the label name)
8. Return a SINGLE valid JSON object. Include ALL keys exactly as specified. No trailing commas.

OUTPUT JSON ONLY. NO MARKDOWN.
{
  "score": 0-10,
  "verdict": "One-sentence scientific assessment (max 15 words)",
  "primaryActive": {
    "name": "Main ingredient name (e.g., Astaxanthin)",
    "form": "Specific chemical form or null if unknown (e.g., 'Astaxanthin from Haematococcus pluvialis')",
    "formQuality": "high|medium|low|unknown",
    "formNote": "Brief explanation why this form is good/bad or null",
    "dosageValue": 12,
    "dosageUnit": "mg",
    "evidenceLevel": "strong|moderate|weak|none",
    "evidenceSummary": "1-sentence summary of evidence"
  },
  "ingredients": [
    {
      "name": "Ingredient name",
      "form": "Chemical form or null if unknown",
      "formQuality": "high|medium|low|unknown",
      "formNote": "Brief explanation of form quality or null",
      "dosageValue": 5000,
      "dosageUnit": "IU",
      "recommendedMin": 600,
      "recommendedMax": 4000,
      "recommendedUnit": "IU",
      "dosageAssessment": "adequate|underdosed|overdosed|unknown",
      "evidenceLevel": "strong|moderate|weak|none",
      "evidenceSummary": "Brief summary of research or null"
    }
  ],
  "overviewSummary": "1-2 sentence product summary for a general user. Mention main ingredient, dose, evidence strength. If price unknown, say so briefly.",
  "coreBenefits": ["Benefit 1", "Benefit 2", "Benefit 3"],
  "overallAssessment": "Is this product effective? Why or why not?",
  "marketingVsReality": "What claims are supported vs unsupported?"
}

If dosage information is missing, set dosageValue/recommendedMin/recommendedMax to null.
If you cannot determine the chemical form, set form to null and formQuality to "unknown".
primaryActive should be the ingredient most prominently featured in the product name or marketing.
`;


const PROMPT_SAFETY = `You are NuTri-AI, a supplement safety expert. Analyze SAFETY with scientific rigor.

CRITICAL INSTRUCTIONS:
1. Evaluate if any ingredient exceeds Tolerable Upper Intake Level (UL)
2. Identify any hepatotoxic, nephrotoxic, or other toxic ingredients
3. Check for common allergens (soy, gluten, dairy, shellfish)
4. Identify drug interactions if known
5. List populations who should avoid this supplement
6. Be conservative - when uncertain, warn
7. Return a SINGLE valid JSON object. Include ALL keys exactly as specified. No trailing commas.

OUTPUT JSON ONLY. NO MARKDOWN.
{
  "score": 0-10,
  "verdict": "Brief safety verdict (max 10 words)",
  "risks": ["Risk 1", "Risk 2"],
  "redFlags": ["Severe warning if any, or empty array"],
  "ulWarnings": [
    {
      "ingredient": "Vitamin A",
      "currentDose": "10000 IU",
      "ulLimit": "3000 IU",
      "riskLevel": "moderate|high"
    }
  ],
  "allergens": ["soy", "gluten", "dairy", "shellfish", "tree nuts"],
  "interactions": ["May interact with blood thinners", "Avoid with X medication"],
  "consultDoctorIf": ["pregnant", "taking blood thinners", "liver disease"],
  "recommendation": "General safety advice (1-2 sentences)"
}

If no UL warnings, return empty array for ulWarnings.
If no allergens detected, return empty array.
Be strict about proprietary blends - flag as a risk if amounts are hidden.
`;

const PROMPT_USAGE = `You are NuTri-AI. Analyze USAGE, VALUE, and SOCIAL perception.

CRITICAL INSTRUCTIONS:
1. Provide specific dosing guidance (not vague "as directed")
2. Explain timing rationale (why morning/evening, with/without food)
3. Note interactions with other common supplements
4. If price data available, analyze cost per serving
5. If price missing, do NOT guess numbers
6. Return a SINGLE valid JSON object. Include ALL keys exactly as specified. No trailing commas.

OUTPUT JSON ONLY. NO MARKDOWN.
{
  "usage": {
    "summary": "Specific how-to-take instructions",
    "timing": "Best time and why (e.g., 'Morning with breakfast - fat-soluble, needs food for absorption')",
    "withFood": true,
    "frequency": "once daily|twice daily|as needed",
    "interactions": ["Take 2h apart from iron", "Pairs well with Vitamin K2"]
  },
  "value": {
    "score": 0-10,
    "verdict": "Value verdict (e.g., 'Good value for premium brand')",
    "analysis": "Price/quality analysis or 'Price data not available'",
    "costPerServing": null,
    "alternatives": ["Consider X brand for budget option", "Y form may be cheaper"]
  },
  "social": {
    "score": 0-5,
    "summary": "Brand reputation and user perception"
  }
}

For value.costPerServing, use a number (in USD) or null if unknown.
For usage.withFood: true=with food, false=empty stomach, null=anytime.
`;

// ============================================================================
// CONTEXT BUILDER
// ============================================================================

export type AnalysisSection = "efficacy" | "safety" | "usage";

export type ContextSource = {
  index: number;
  domain: string;
  title: string;
  link: string;
  snippet: string;
  isHighQuality: boolean;
  extractedText: string | null;
};

export interface EnhancedContext {
  brand: string;
  product: string;
  barcode: string;
  sources: ContextSource[];
}

const MAX_SOURCES = 5;
const MAX_FETCH_SOURCES = 2;
const FETCH_TIMEOUT_MS = 4500;
const MAX_EXTRACTED_CHARS_PER_SOURCE = 2500;

const BROWSER_UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36";

const decodeHtmlEntities = (input: string): string => {
  return input
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&#x([0-9a-f]+);/gi, (_, hex: string) => {
      const codePoint = Number.parseInt(hex, 16);
      return Number.isFinite(codePoint) ? String.fromCharCode(codePoint) : _;
    })
    .replace(/&#(\d+);/g, (_, dec: string) => {
      const codePoint = Number.parseInt(dec, 10);
      return Number.isFinite(codePoint) ? String.fromCharCode(codePoint) : _;
    });
};

const stripHtmlToText = (html: string): string => {
  const withoutScripts = html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<noscript[\s\S]*?<\/noscript>/gi, " ");
  const noTags = withoutScripts.replace(/<\/?[^>]+>/g, " ");
  const decoded = decodeHtmlEntities(noTags);
  return decoded.replace(/\s+/g, " ").trim();
};

const extractRelevantPassages = (text: string, maxChars: number): string => {
  const normalized = text.trim();
  if (normalized.length <= maxChars) {
    return normalized;
  }

  const patterns = [
    "supplement facts",
    "nutrition facts",
    "ingredients",
    "other ingredients",
    "amount per serving",
    "serving size",
    "servings",
    "serving",
    "suggested use",
    "directions",
    "warning",
    "allergen",
    "price",
    "msrp",
    "usd",
    "$",
    "成分",
    "配料",
    "营养成分",
    "用法",
    "建议用量",
    "注意事项",
    "价格",
    "￥",
    "¥",
  ];

  const lower = normalized.toLowerCase();
  const snippets: string[] = [];
  const seen = new Set<string>();

  for (const pattern of patterns) {
    const idx = lower.indexOf(pattern.toLowerCase());
    if (idx < 0) continue;
    const start = Math.max(0, idx - 400);
    const end = Math.min(normalized.length, idx + 2200);
    const chunk = normalized.slice(start, end).trim();
    if (!chunk) continue;
    const key = `${pattern}:${start}:${end}`;
    if (seen.has(key)) continue;
    seen.add(key);
    snippets.push(chunk);
    if (snippets.join("\n...\n").length >= maxChars) break;
  }

  const combined = snippets.length > 0 ? snippets.join("\n...\n") : normalized.slice(0, maxChars);
  return combined.slice(0, maxChars).trim();
};

const isPrivateHostname = (hostname: string): boolean => {
  const host = hostname.toLowerCase();
  if (host === "localhost" || host === "0.0.0.0" || host === "::1" || host.endsWith(".local")) {
    return true;
  }

  // IPv4 private ranges
  const ipv4Match = host.match(/^(\d+)\.(\d+)\.(\d+)\.(\d+)$/);
  if (ipv4Match) {
    const [a, b] = [Number(ipv4Match[1]), Number(ipv4Match[2])];
    if (a === 10) return true;
    if (a === 127) return true;
    if (a === 169 && b === 254) return true;
    if (a === 192 && b === 168) return true;
    if (a === 172 && b >= 16 && b <= 31) return true;
  }

  // Basic IPv6 local checks
  if (host.startsWith("fe80:") || host.startsWith("fc") || host.startsWith("fd")) {
    return true;
  }

  return false;
};

const canFetchUrl = (rawUrl: string): boolean => {
  try {
    const url = new URL(rawUrl);
    if (!["http:", "https:"].includes(url.protocol)) return false;
    if (isPrivateHostname(url.hostname)) return false;
    return true;
  } catch {
    return false;
  }
};

const fetchPageText = async (rawUrl: string): Promise<string | null> => {
  if (!canFetchUrl(rawUrl)) {
    return null;
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);

  try {
    const response = await fetch(rawUrl, {
      method: "GET",
      headers: {
        "User-Agent": BROWSER_UA,
        Accept: "text/html,application/xhtml+xml,text/plain;q=0.9,*/*;q=0.8",
      },
      cache: "no-store",
      signal: controller.signal,
    });

    if (!response.ok) {
      return null;
    }

    const contentType = response.headers.get("content-type") || "";
    if (!contentType.includes("text/html") && !contentType.includes("text/plain")) {
      return null;
    }

    const rawText = await response.text();
    const plain = contentType.includes("text/html") ? stripHtmlToText(rawText) : rawText.trim();
    return extractRelevantPassages(plain, MAX_EXTRACTED_CHARS_PER_SOURCE);
  } catch {
    return null;
  } finally {
    clearTimeout(timeout);
  }
};

export async function prepareContextSources(items: SearchItem[]): Promise<ContextSource[]> {
  const sources: ContextSource[] = items.slice(0, MAX_SOURCES).map((item, index) => {
    const domain = extractDomain(item.link);
    return {
      index,
      domain,
      title: item.title,
      link: item.link,
      snippet: item.snippet || "",
      isHighQuality: isHighQualityDomain(item.link),
      extractedText: null,
    };
  });

  const fetchTargets: number[] = [];
  const seenDomains = new Set<string>();

  for (const source of sources) {
    if (!source.isHighQuality) continue;
    const key = source.domain.toLowerCase();
    if (seenDomains.has(key)) continue;
    fetchTargets.push(source.index);
    seenDomains.add(key);
    if (fetchTargets.length >= MAX_FETCH_SOURCES) break;
  }

  for (const source of sources) {
    if (fetchTargets.length >= MAX_FETCH_SOURCES) break;
    if (fetchTargets.includes(source.index)) continue;
    fetchTargets.push(source.index);
  }

  const results = await Promise.allSettled(
    fetchTargets.map(async (idx) => {
      const target = sources[idx];
      if (!target) return;
      const extractedText = await fetchPageText(target.link);
      sources[idx] = { ...target, extractedText };
    }),
  );

  // Avoid unused lint var; keep for debugging if needed.
  void results;

  return sources;
}

/**
 * Build enhanced context string for AI analysis (uses snippets + extracted page text where available).
 */
export function buildEnhancedContext(ctx: EnhancedContext, section: AnalysisSection): string {
  const { brand, product, barcode, sources } = ctx;

  const sourcesText = sources
    .map((source) => {
      const extracted = source.extractedText ? `\nExtractedText: ${source.extractedText}` : "";
      return `[Source ${source.index + 1}]
Domain: ${source.domain}
HighQuality: ${source.isHighQuality ? "yes" : "no"}
Title: ${source.title}
Link: ${source.link}
Snippet: ${source.snippet || "No snippet available"}${extracted}`;
    })
    .join("\n\n");

  const ignoreLine =
    section === "usage"
      ? "Ignore: shipping info. Be skeptical of marketing claims."
      : "Ignore: prices and shipping info. Be skeptical of marketing claims.";

  const focusLine =
    section === "efficacy"
      ? "Focus on: ingredient list, chemical forms, dosage information, and evidence strength."
      : section === "safety"
        ? "Focus on: ingredient doses, UL/overdose risks, interactions, allergens, and contraindications."
        : "Focus on: how to take (timing/with food), practical interactions, value/price if present, and brand perception.";

  return `PRODUCT INFORMATION:
Brand: ${brand}
Product Name: ${product}
Barcode: ${barcode}

SEARCH RESULTS (prioritize official sites and major retailers like Amazon/iHerb):
${sourcesText}

TASK: Analyze this supplement based on the search results above.
${focusLine}
${ignoreLine}
If sources disagree, prioritize information from official brand sites and major retailers.`;
}

// ============================================================================
// API FUNCTIONS
// ============================================================================

const extractJsonCandidate = (content: string): string | null => {
  const raw = content?.trim();
  if (!raw) return null;

  const codeBlockMatch = raw.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const candidate = (codeBlockMatch ? codeBlockMatch[1] : raw).trim();
  if (!candidate) return null;

  const firstObject = candidate.indexOf("{");
  const lastObject = candidate.lastIndexOf("}");
  if (firstObject >= 0 && lastObject > firstObject) {
    return candidate.slice(firstObject, lastObject + 1).trim();
  }

  const firstArray = candidate.indexOf("[");
  const lastArray = candidate.lastIndexOf("]");
  if (firstArray >= 0 && lastArray > firstArray) {
    return candidate.slice(firstArray, lastArray + 1).trim();
  }

  return candidate;
};

const tryParseJsonLenient = (content: string): unknown | null => {
  const candidate = extractJsonCandidate(content);
  if (!candidate) return null;

  const attempts = [
    candidate,
    candidate
      .replace(/[“”]/g, '"')
      .replace(/[‘’]/g, "'")
      .replace(/\bTrue\b/g, "true")
      .replace(/\bFalse\b/g, "false")
      .replace(/\bNone\b/g, "null")
      .replace(/,\s*([}\]])/g, "$1"),
  ];

  for (const attempt of attempts) {
    try {
      return JSON.parse(attempt);
    } catch {
      // keep trying
    }
  }

  return null;
};

export async function fetchAnalysisSection(
  section: "efficacy" | "safety" | "usage",
  context: string,
  model: string,
  apiKey: string
) {
  let systemPrompt = "";
  let maxTokens = 800; // Increased for more detailed analysis

  if (section === "efficacy") {
    systemPrompt = PROMPT_EFFICACY;
    maxTokens = 1000; // Efficacy needs more tokens for ingredient details
  }
  if (section === "safety") systemPrompt = PROMPT_SAFETY;
  if (section === "usage") systemPrompt = PROMPT_USAGE;

  try {
    const response = await fetch("https://api.deepseek.com/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: model, // Use deepseek-chat (V3)
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: context },
        ],
        temperature: 0.2, // Lowered for more consistent structured output
        stream: false,
        max_tokens: maxTokens,
      }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error(`DeepSeek API error: ${response.status}`, errorText);
      throw new Error(`DeepSeek API error: ${response.status}`);
    }

    const data = (await response.json()) as {
      choices?: { message?: { content?: string } }[];
    };
    const content = data.choices?.[0]?.message?.content || "{}";
    const parsed = tryParseJsonLenient(content);
    if (parsed !== null) {
      return parsed;
    }

    // One retry: ask the model to repair its own output into strict JSON.
    const candidate = extractJsonCandidate(content) ?? content;
    console.warn(`[DeepSeek] Invalid JSON for ${section}, retrying repair`);

    const repairResponse = await fetch("https://api.deepseek.com/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: model,
        messages: [
          {
            role: "system",
            content:
              "You are a strict JSON repair tool. Output ONLY valid JSON (no markdown, no comments).",
          },
          {
            role: "user",
            content: `Fix this into valid JSON only. Keep keys/structure the same:\n\n${candidate}`,
          },
        ],
        temperature: 0,
        stream: false,
        max_tokens: Math.min(800, maxTokens),
      }),
    });

    if (!repairResponse.ok) {
      const errorText = await repairResponse.text();
      console.error(`DeepSeek repair error: ${repairResponse.status}`, errorText);
      return null;
    }

    const repairData = (await repairResponse.json()) as {
      choices?: { message?: { content?: string } }[];
    };
    const repairContent = repairData.choices?.[0]?.message?.content || "{}";
    const repaired = tryParseJsonLenient(repairContent);
    if (repaired !== null) {
      return repaired;
    }

    console.error(`[DeepSeek] JSON repair failed for ${section}`);
    return null;
  } catch (error) {
    console.error(`Error fetching ${section}:`, error);
    return null; // Return null to let frontend show skeleton/fallback
  }
}
