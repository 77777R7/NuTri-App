/**
 * DeepSeek AI Integration Module
 * Enhanced prompts for deep ingredient analysis
 */

import { extractDomain, isHighQualityDomain } from "./searchQuality.js";
import {
  HttpError,
  TimeoutError,
  combineSignals,
  createTimeoutSignal,
  isAbortError,
  isRetryableStatus,
  withRetry,
} from "./resilience.js";
import type { CircuitBreaker, DeadlineBudget, RetryOptions, Semaphore } from "./resilience.js";
import type { SearchItem } from "./types.js";

// ============================================================================
// ENHANCED PROMPTS
// ============================================================================

const deepseekDebug =
  process.env.DEEPSEEK_DEBUG === "1" || process.env.DEEPSEEK_DEBUG === "true";

const truncateForLog = (value: string, max = 2000): string =>
  value.length > max ? `${value.slice(0, max)}…` : value;

const logDeepseekParseIssue = (
  label: string,
  payload: string,
  extra?: Record<string, unknown>,
): void => {
  const snippet = truncateForLog(payload);
  console.warn(`[DeepSeek] ${label}`, {
    ...(extra ?? {}),
    snippet,
  });
};

const buildDebugPayload = (
  label: string,
  payload: string,
  extra?: Record<string, unknown> | null,
) => ({
  __deepseek_error: label,
  __deepseek_snippet: truncateForLog(payload, 1200),
  __deepseek_meta: extra ?? null,
});

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
  "overviewSummary": "1-2 sentence product summary for a general user. Mention main ingredient, dose, evidence strength.",
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

const PROMPT_MY_SUPPLEMENT_OVERVIEW_CARD = `You are NuTri-AI. Create a short, product-style overview card for a dietary supplement.

CRITICAL INSTRUCTIONS:
1. OUTPUT JSON ONLY. NO MARKDOWN. NO TRAILING COMMAS.
2. "overviewSummary" MUST be EXACTLY TWO sentences in English. Keep it general and product-oriented.
3. Do not make medical claims (no diagnosis, treatment, or disease claims). Use general wellness language.
4. "withFood" MUST be true or false (never null). If uncertain, choose the safer/more tolerable option.
5. "timing" MUST be a short phrase (no long rationales). Prefer one of:
   - "Morning (with breakfast)"
   - "Morning (before breakfast)"
   - "Breakfast or dinner (with a meal)"
   - "Evening (after dinner)"
   - "Bedtime (30–60 min before sleep)"
   - "Anytime (with meals)"
   - "Anytime"
   If uncertain, choose "Anytime (with meals)" instead of defaulting to "Morning".
6. If dosage is not provided, do not guess. If dosage is provided, you may mention it once.

Return a SINGLE JSON object with exactly these keys:
{
  "overviewSummary": "Sentence one. Sentence two.",
  "coreBenefits": ["Benefit 1", "Benefit 2"],
  "timing": "Morning (with breakfast)",
  "withFood": true
}
`;

const PROMPT_ANALYSIS_BUNDLE = `You are NuTri-AI, a supplement science expert. Return a SINGLE valid JSON object with exactly three top-level keys: "efficacy", "safety", "usagePayload".

GLOBAL RULES:
- OUTPUT JSON ONLY. NO MARKDOWN. NO TRAILING COMMAS.
- If information is not available, use null instead of guessing.
- Be conservative on safety risks and interactions.
- Do NOT guess prices; use null if missing.

EFFICACY OBJECT (value for "efficacy"):
{
  "score": 0-10,
  "verdict": "One-sentence scientific assessment (max 15 words)",
  "primaryActive": {
    "name": "Main ingredient name (e.g., Astaxanthin)",
    "form": "Specific chemical form or null if unknown",
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
  "overviewSummary": "1-2 sentence product summary for a general user. Mention main ingredient, dose, evidence strength.",
  "coreBenefits": ["Benefit 1", "Benefit 2", "Benefit 3"],
  "overallAssessment": "Is this product effective? Why or why not?",
  "marketingVsReality": "What claims are supported vs unsupported?"
}
If dosage information is missing, set dosageValue/recommendedMin/recommendedMax to null.
If you cannot determine the chemical form, set form to null and formQuality to "unknown".
primaryActive should be the ingredient most prominently featured in the product name or marketing.

SAFETY OBJECT (value for "safety"):
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

USAGE OBJECT (value for "usagePayload"):
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
export type AnalysisBundle = {
  efficacy: unknown | null;
  safety: unknown | null;
  usagePayload: unknown | null;
};

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
    "upc",
    "gtin",
    "ean",
    "jan",
    "npn",
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

type ResilienceOptions = {
  signal?: AbortSignal;
  timeoutMs?: number;
  queueTimeoutMs?: number;
  maxTokens?: number;
  promptOverride?: "primary" | "rescue" | "dsld_short" | "dsld_rescue";
  debugOnError?: boolean;
  budget?: DeadlineBudget;
  semaphore?: Semaphore;
  breaker?: CircuitBreaker;
  retry?: Partial<RetryOptions>;
};

const fetchPageText = async (rawUrl: string, options: ResilienceOptions = {}): Promise<string | null> => {
  if (!canFetchUrl(rawUrl)) {
    return null;
  }

  if (options.breaker && !options.breaker.canRequest()) {
    return null;
  }

  const timeoutMs = options.timeoutMs ?? FETCH_TIMEOUT_MS;
  const budgetedTimeout = options.budget ? options.budget.msFor(timeoutMs) : timeoutMs;
  if (budgetedTimeout <= 0) {
    return null;
  }

  let release: (() => void) | null = null;
  if (options.semaphore) {
    try {
      release = await options.semaphore.acquire({
        timeoutMs: options.queueTimeoutMs ?? 0,
        signal: options.signal,
      });
    } catch {
      return null;
    }
  }

  const timeoutSignal = createTimeoutSignal(budgetedTimeout);
  const { signal, cleanup } = combineSignals([options.signal, timeoutSignal]);

  try {
    const response = await fetch(rawUrl, {
      method: "GET",
      headers: {
        "User-Agent": BROWSER_UA,
        Accept: "text/html,application/xhtml+xml,text/plain;q=0.9,*/*;q=0.8",
      },
      cache: "no-store",
      signal,
    });

    if (!response.ok) {
      options.breaker?.recordFailure();
      return null;
    }

    const contentType = response.headers.get("content-type") || "";
    if (!contentType.includes("text/html") && !contentType.includes("text/plain")) {
      options.breaker?.recordFailure();
      return null;
    }

    const rawText = await response.text();
    const plain = contentType.includes("text/html") ? stripHtmlToText(rawText) : rawText.trim();
    options.breaker?.recordSuccess();
    return extractRelevantPassages(plain, MAX_EXTRACTED_CHARS_PER_SOURCE);
  } catch (error) {
    if (!isAbortError(error)) {
      options.breaker?.recordFailure();
    }
    return null;
  } finally {
    cleanup();
    release?.();
  }
};

export async function prepareContextSources(
  items: SearchItem[],
  options: ResilienceOptions = {},
): Promise<ContextSource[]> {
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
      const extractedText = await fetchPageText(target.link, options);
      sources[idx] = { ...target, extractedText };
    }),
  );

  // Avoid unused lint var; keep for debugging if needed.
  void results;

  return sources;
}

const buildSourcesText = (sources: ContextSource[]): string =>
  sources
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

/**
 * Build enhanced context string for AI analysis (uses snippets + extracted page text where available).
 */
export function buildEnhancedContext(ctx: EnhancedContext, section: AnalysisSection): string {
  const { brand, product, barcode, sources } = ctx;

  const sourcesText = buildSourcesText(sources);

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

export function buildCombinedContext(ctx: EnhancedContext): string {
  const { brand, product, barcode, sources } = ctx;
  const sourcesText = buildSourcesText(sources);

  return `PRODUCT INFORMATION:
Brand: ${brand}
Product Name: ${product}
Barcode: ${barcode}

SEARCH RESULTS (prioritize official sites and major retailers like Amazon/iHerb):
${sourcesText}

TASK: Analyze this supplement based on the search results above.
Focus on: ingredients, chemical forms, dosage, evidence strength, safety risks/ULs, interactions, allergens, usage timing/with food, value/price if present, and brand perception.
Ignore: shipping info. Be skeptical of marketing claims.
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
  apiKey: string,
  options: ResilienceOptions = {}
) {
  let systemPrompt = "";
  let maxTokens = 800; // Increased for more detailed analysis

  if (section === "efficacy") {
    systemPrompt = PROMPT_EFFICACY;
    maxTokens = 1000; // Efficacy needs more tokens for ingredient details
  }
  if (section === "safety") systemPrompt = PROMPT_SAFETY;
  if (section === "usage") systemPrompt = PROMPT_USAGE;

  let release: (() => void) | null = null;
  try {
    if (options.breaker && !options.breaker.canRequest()) {
      return null;
    }

    const timeoutMs = options.timeoutMs ?? 10_000;
    const budgetedTimeout = options.budget ? options.budget.msFor(timeoutMs) : timeoutMs;
    if (budgetedTimeout <= 0) {
      return null;
    }

    if (options.semaphore) {
      try {
        release = await options.semaphore.acquire({
          timeoutMs: options.queueTimeoutMs ?? 0,
          signal: options.signal,
        });
      } catch {
        return null;
      }
    }

    const retryConfig: RetryOptions = {
      maxAttempts: options.retry?.maxAttempts ?? 1,
      baseDelayMs: options.retry?.baseDelayMs ?? 400,
      maxDelayMs: options.retry?.maxDelayMs ?? 1500,
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
            model: model, // Use deepseek-chat (V3)
            messages: [
              { role: "system", content: systemPrompt },
              { role: "user", content: context },
            ],
            temperature: 0.2, // Lowered for more consistent structured output
            stream: false,
            max_tokens: maxTokens,
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

    const data = (await response.json()) as {
      choices?: { message?: { content?: string } }[];
    };
    const content = data.choices?.[0]?.message?.content || "{}";
    const parsed = tryParseJsonLenient(content);
    if (parsed !== null) {
      return parsed;
    }

    console.warn(`[DeepSeek] Invalid JSON for ${section}, skipping repair`);
    return null;
  } catch (error) {
    if (!isAbortError(error)) {
      options.breaker?.recordFailure();
    }
    console.error(`Error fetching ${section}:`, error);
    return null; // Return null to let frontend show skeleton/fallback
  } finally {
    release?.();
  }
}

export type MySupplementOverviewCard = {
  overviewSummary: string;
  coreBenefits: string[];
  timing: string;
  withFood: boolean;
};

export type MySupplementOverviewV2 = {
  oneLiner: string;
  whatItIs: string;
  tips: string[];
  whatYouMayNotice: string[];
  watchOuts: string[];
};

const PROMPT_MY_SUPPLEMENT_OVERVIEW_V2 = `You are NuTri-AI. Convert structured supplement facts into a helpful, user-facing overview.

CRITICAL INSTRUCTIONS:
1. OUTPUT JSON ONLY. NO MARKDOWN. NO TRAILING COMMAS.
2. DO NOT invent label directions, timing, or "take with food" rules. Only use facts provided.
3. Do not make medical claims (no diagnosis, treatment, cure, or disease claims). Use cautious language.
4. Avoid generic filler like "overall wellness", "healthy lifestyle", "designed to support" unless you also mention at least ONE specific active ingredient by name.
5. Keep sentences short and specific. Prefer concrete facts ("Vitamin C 1000 mg") over vague claims.

Return a SINGLE JSON object with exactly these keys:
{
  "oneLiner": "A single sentence (<=120 chars) that includes at least one active name or dose when available.",
  "whatItIs": "1-2 sentences explaining what this product is and typical, non-medical uses.",
  "tips": ["1-3 short tips grounded in facts. Empty array if none."],
  "whatYouMayNotice": ["0-3 cautious observations. Empty array if none."],
  "watchOuts": ["0-4 cautious safety reminders (consult clinician wording). Empty array if none."]
}
`;

export async function fetchMySupplementOverviewCard(
  context: string,
  model: string,
  apiKey: string,
  options: ResilienceOptions = {},
): Promise<MySupplementOverviewCard | null> {
  let release: (() => void) | null = null;
  try {
    if (options.breaker && !options.breaker.canRequest()) {
      return null;
    }

    const timeoutMs = options.timeoutMs ?? 4_000;
    const budgetedTimeout = options.budget ? options.budget.msFor(timeoutMs) : timeoutMs;
    if (budgetedTimeout <= 0) {
      return null;
    }

    if (options.semaphore) {
      try {
        release = await options.semaphore.acquire({
          timeoutMs: options.queueTimeoutMs ?? 0,
          signal: options.signal,
        });
      } catch {
        return null;
      }
    }

    const retryConfig: RetryOptions = {
      maxAttempts: options.retry?.maxAttempts ?? 1,
      baseDelayMs: options.retry?.baseDelayMs ?? 350,
      maxDelayMs: options.retry?.maxDelayMs ?? 1200,
      jitterRatio: options.retry?.jitterRatio ?? 0.35,
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
              { role: "system", content: PROMPT_MY_SUPPLEMENT_OVERVIEW_CARD },
              { role: "user", content: context },
            ],
            temperature: 0.1,
            stream: false,
            max_tokens: options.maxTokens ?? 600,
            response_format: { type: "json_object" },
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
    const parsed = tryParseJsonLenient(content);
    if (!parsed || typeof parsed !== "object") {
      return null;
    }

    const record = parsed as Record<string, unknown>;
    const overviewSummary =
      typeof record.overviewSummary === "string" ? record.overviewSummary.trim() : "";
    const timing = typeof record.timing === "string" ? record.timing.trim() : "";
    const withFood = typeof record.withFood === "boolean" ? record.withFood : null;
    const coreBenefitsRaw = Array.isArray(record.coreBenefits) ? record.coreBenefits : [];
    const coreBenefits = coreBenefitsRaw
      .filter((benefit) => typeof benefit === "string")
      .map((benefit) => benefit.trim())
      .filter(Boolean)
      .slice(0, 3);

    if (!overviewSummary || !timing || withFood === null) {
      return null;
    }

    return {
      overviewSummary,
      coreBenefits,
      timing,
      withFood,
    };
  } catch (error) {
    if (!isAbortError(error)) {
      options.breaker?.recordFailure();
    }
    console.warn("[DeepSeek] MySupplement overview card generation failed", error);
    return null;
  } finally {
    release?.();
  }
}

export async function fetchMySupplementOverviewV2(
  context: string,
  model: string,
  apiKey: string,
  options: ResilienceOptions = {},
): Promise<MySupplementOverviewV2 | null> {
  let release: (() => void) | null = null;
  try {
    if (options.breaker && !options.breaker.canRequest()) {
      return null;
    }

    const timeoutMs = options.timeoutMs ?? 5_500;
    const budgetedTimeout = options.budget ? options.budget.msFor(timeoutMs) : timeoutMs;
    if (budgetedTimeout <= 0) {
      return null;
    }

    if (options.semaphore) {
      try {
        release = await options.semaphore.acquire({
          timeoutMs: options.queueTimeoutMs ?? 0,
          signal: options.signal,
        });
      } catch {
        return null;
      }
    }

    const retryConfig: RetryOptions = {
      maxAttempts: options.retry?.maxAttempts ?? 1,
      baseDelayMs: options.retry?.baseDelayMs ?? 350,
      maxDelayMs: options.retry?.maxDelayMs ?? 1200,
      jitterRatio: options.retry?.jitterRatio ?? 0.35,
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
              { role: "system", content: PROMPT_MY_SUPPLEMENT_OVERVIEW_V2 },
              { role: "user", content: context },
            ],
            temperature: 0.1,
            stream: false,
            max_tokens: options.maxTokens ?? 900,
            response_format: { type: "json_object" },
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
    const parsed = tryParseJsonLenient(content);
    if (!parsed || typeof parsed !== "object") {
      return null;
    }

    const record = parsed as Record<string, unknown>;
    const oneLiner = typeof record.oneLiner === "string" ? record.oneLiner.trim() : "";
    const whatItIs = typeof record.whatItIs === "string" ? record.whatItIs.trim() : "";
    const tips = Array.isArray(record.tips)
      ? record.tips.filter((v) => typeof v === "string").map((v) => v.trim()).filter(Boolean).slice(0, 3)
      : [];
    const whatYouMayNotice = Array.isArray(record.whatYouMayNotice)
      ? record.whatYouMayNotice.filter((v) => typeof v === "string").map((v) => v.trim()).filter(Boolean).slice(0, 3)
      : [];
    const watchOuts = Array.isArray(record.watchOuts)
      ? record.watchOuts.filter((v) => typeof v === "string").map((v) => v.trim()).filter(Boolean).slice(0, 4)
      : [];

    if (!oneLiner || !whatItIs) {
      return null;
    }

    return {
      oneLiner,
      whatItIs,
      tips,
      whatYouMayNotice,
      watchOuts,
    };
  } catch (error) {
    if (!isAbortError(error)) {
      options.breaker?.recordFailure();
    }
    console.warn("[DeepSeek] MySupplement overview V2 generation failed", error);
    return null;
  } finally {
    release?.();
  }
}

export async function fetchAnalysisBundle(
  context: string,
  model: string,
  apiKey: string,
  options: ResilienceOptions = {},
): Promise<AnalysisBundle | null> {
  let release: (() => void) | null = null;
  try {
    if (options.breaker && !options.breaker.canRequest()) {
      return null;
    }

    const timeoutMs = options.timeoutMs ?? 12_000;
    const budgetedTimeout = options.budget ? options.budget.msFor(timeoutMs) : timeoutMs;
    if (budgetedTimeout <= 0) {
      return null;
    }

    if (options.semaphore) {
      try {
        release = await options.semaphore.acquire({
          timeoutMs: options.queueTimeoutMs ?? 0,
          signal: options.signal,
        });
      } catch {
        return null;
      }
    }

    const retryConfig: RetryOptions = {
      maxAttempts: options.retry?.maxAttempts ?? 1,
      baseDelayMs: options.retry?.baseDelayMs ?? 400,
      maxDelayMs: options.retry?.maxDelayMs ?? 1500,
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
            model: model,
            messages: [
              { role: "system", content: PROMPT_ANALYSIS_BUNDLE },
              { role: "user", content: context },
            ],
            temperature: 0.0,
            stream: false,
            max_tokens: options.maxTokens ?? 2000,
            response_format: { type: "json_object" },
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

    const data = (await response.json()) as {
      choices?: { message?: { content?: string } }[];
    };
    const content = data.choices?.[0]?.message?.content || "{}";
    const parsed = tryParseJsonLenient(content);
    if (parsed && typeof parsed === "object") {
      const record = parsed as Record<string, unknown>;
      return {
        efficacy: record.efficacy ?? null,
        safety: record.safety ?? null,
        usagePayload: record.usagePayload ?? null,
        _meta: { repairUsed: false },
      } as AnalysisBundle;
    }

    // One-shot JSON repair call (hard cap: bundle<=1 + repair<=1).
    const repairPrompt = `You are a JSON repair assistant.
Return a SINGLE valid JSON object.
- OUTPUT JSON ONLY. NO MARKDOWN.
- Preserve the original meaning as much as possible.
- Ensure top-level keys exist: efficacy, safety, usagePayload (use null if missing).
`;

    const repairTimeoutMs = Math.min(3500, timeoutMs);
    const repairBudgetedTimeout = options.budget ? options.budget.msFor(repairTimeoutMs) : repairTimeoutMs;
    if (repairBudgetedTimeout <= 0) {
      console.warn("[DeepSeek] Invalid JSON for bundle; repair skipped due to budget");
      return null;
    }

    const repairResponse = await withRetry(async () => {
      const timeoutSignal = createTimeoutSignal(repairBudgetedTimeout);
      const { signal, cleanup } = combineSignals([options.signal, timeoutSignal]);
      try {
        const result = await fetch("https://api.deepseek.com/v1/chat/completions", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${apiKey}`,
          },
          body: JSON.stringify({
            model: model,
            messages: [
              { role: "system", content: repairPrompt },
              { role: "user", content: `Fix this to valid json:\n${content}` },
            ],
            temperature: 0.0,
            stream: false,
            max_tokens: 1200,
            response_format: { type: "json_object" },
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
    }, {
      ...retryConfig,
      maxAttempts: 1,
    });

    const repairData = (await repairResponse.json()) as {
      choices?: { message?: { content?: string } }[];
    };
    const repairedContent = repairData.choices?.[0]?.message?.content || "{}";
    const repairedParsed = tryParseJsonLenient(repairedContent);
    if (repairedParsed && typeof repairedParsed === "object") {
      const record = repairedParsed as Record<string, unknown>;
      return {
        efficacy: record.efficacy ?? null,
        safety: record.safety ?? null,
        usagePayload: record.usagePayload ?? null,
        _meta: { repairUsed: true },
      } as AnalysisBundle;
    }

    console.warn("[DeepSeek] Invalid JSON for bundle after repair");
    return null;
  } catch (error) {
    if (!isAbortError(error)) {
      options.breaker?.recordFailure();
    }
    console.error("Error fetching bundle:", error);
    return null;
  } finally {
    release?.();
  }
}

// ============================================================================
// Analysis Bundle v3 (fast + ingredients detail)
// ============================================================================

const PROMPT_ANALYSIS_BUNDLE_FAST_V3 = `You are NuTri-AI. Use the provided FACTS_DIGEST_JSON.
Return JSON only with this exact shape:
{
  "overview": { "summary": "...", "bullets": [ { "text": "...", "basisTags": ["..."] } ] },
  "usage": {
    "bullets": [ { "text": "...", "basisTags": ["..."] } ],
    "bestTimeToTake": { "text": "...", "basisTags": ["..."] } | null,
    "withFood": { "value": true|false|null, "text": "...", "basisTags": ["..."] } | null
  },
  "safety": { "verdict": "...", "bullets": [ { "text": "...", "basisTags": ["..."] } ] }
}

Rules:
- basisTags must be from: label_fact, regulatory_claim, ingredient_inference, web_evidence, general_advice, not_provided, conflict.
- overview.summary <= 180 chars; overview.bullets exactly 2 items.
- If FACTS_DIGEST_JSON.claims.labelPurposes exists, use regulatory_claim tags.
- If sourceType is dsld or web and you infer benefits, use ingredient_inference or web_evidence tags.
- If safety info is missing in facts, set safety.bullets empty and verdict "Not provided by source" with basisTags ["not_provided"].
- Do not include dosage instructions beyond what is in FACTS_DIGEST_JSON.labelDosing.
- Output JSON only, no markdown, no trailing commas.
`;

const PROMPT_INGREDIENTS_DETAIL_V3 = `You are NuTri-AI. Use the provided FACTS_DIGEST_JSON.
Return JSON only with this exact shape:
{
  "items": [
    {
      "name": "...",
      "whatItDoes": { "text": "...", "basisTags": ["..."] },
      "doseContext": { "text": "...", "basisTags": ["..."] },
      "chemicalFormExplain": { "text": "...", "basisTags": ["..."] },
      "deliveryFormExplain": { "text": "...", "basisTags": ["..."] } | null
    }
  ],
  "overallSummary": { "text": "...", "basisTags": ["..."] } | null,
  "overlapNotes": { "text": "...", "basisTags": ["..."] } | null
}

Rules:
- basisTags must be from: label_fact, regulatory_claim, ingredient_inference, web_evidence, general_advice, not_provided, conflict.
- Do not make disease treatment claims.
- If FACTS_DIGEST_JSON.labelDosing has entries, reference label dosing briefly and do NOT say dosing is unknown.
- whatItDoes: 1 sentence, max ~18 words.
- doseContext: 1 sentence, max ~18 words.
- chemicalFormExplain: 1 sentence, max ~25 words.
- deliveryFormExplain: 1 short sentence, max ~16 words.
- overallSummary: max ~60 words.
- Use ingredient_inference or regulatory_claim tags based on FACTS_DIGEST_JSON.sourceType and evidence.
- If sourceType is lnhpd and labelPurposes exist, whatItDoes should use regulatory_claim (add label_fact only if referencing dosage/form).
- chemicalFormExplain rules:
  - If actives[i].chemicalFormConfidence is null OR < 0.6, output exactly "Chemical form not provided by source." with basisTags ["not_provided"].
  - If chemicalFormConfidence >= 0.6 and chemicalForm exists, explain salt/shape meaning using cautious language (must include \"may\" or \"limited evidence\"). Use basisTags ["label_fact","ingredient_inference"].
- deliveryFormExplain:
  - Only output if actives[i].deliveryForm exists, otherwise null.
  - When present, be factual (e.g., \"Delivery form: tablet.\") with basisTags ["label_fact"].
- Avoid starting any field with "Contains".
- Only output items for the actives provided in FACTS_DIGEST_JSON (do not invent missing items).
- Output JSON only, no markdown, no trailing commas.
`;

const PROMPT_INGREDIENTS_DETAIL_V3_DSLD_SHORT = `You are NuTri-AI. Use the provided FACTS_DIGEST_JSON.
Return JSON only with this exact shape:
{
  "items": [
    {
      "name": "...",
      "whatItDoes": { "text": "...", "basisTags": ["..."] }
    }
  ],
  "overallSummary": { "text": "...", "basisTags": ["..."] } | null,
  "overlapNotes": null
}

Rules:
- basisTags must be from: label_fact, regulatory_claim, ingredient_inference, web_evidence, general_advice, not_provided, conflict.
- Only output items for the actives provided in FACTS_DIGEST_JSON.
- whatItDoes: 1 short sentence (<= 14 words).
- overallSummary: max 40 words; can be null if uncertain.
- Avoid starting sentences with "Contains".
- Output JSON only, no markdown, no trailing commas.
`;

const PROMPT_INGREDIENTS_DETAIL_V3_RESCUE = `You are NuTri-AI. Use the provided FACTS_DIGEST_JSON.
Return JSON only with this exact shape:
{
  "items": [
    {
      "name": "...",
      "whatItDoes": { "text": "...", "basisTags": ["..."] },
      "doseContext": { "text": "...", "basisTags": ["..."] },
      "chemicalFormExplain": { "text": "...", "basisTags": ["..."] },
      "deliveryFormExplain": { "text": "...", "basisTags": ["..."] } | null
    }
  ],
  "overallSummary": { "text": "...", "basisTags": ["..."] },
  "overlapNotes": null
}

Rules:
- basisTags must be from: label_fact, regulatory_claim, ingredient_inference, web_evidence, general_advice, not_provided, conflict.
- Only output items for the actives provided in FACTS_DIGEST_JSON.
- If FACTS_DIGEST_JSON.labelDosing has entries, reference label dosing briefly and do NOT say dosing is unknown.
- chemicalFormExplain rules:
  - If actives[i].chemicalFormConfidence is null OR < 0.6, output exactly "Chemical form not provided by source." with basisTags ["not_provided"].
  - If chemicalFormConfidence >= 0.6 and chemicalForm exists, explain cautiously (must include \"may\" or \"limited evidence\") with basisTags ["label_fact","ingredient_inference"].
- deliveryFormExplain only if deliveryForm exists, otherwise null.
- Avoid starting sentences with "Contains".
- whatItDoes: 1 short sentence (<= 14 words).
- doseContext: 1 short sentence (<= 14 words).
- chemicalFormExplain: 1 short sentence (<= 20 words).
- deliveryFormExplain: 1 short sentence (<= 12 words).
- overallSummary: 2 short sentences, total <= 40 words.
- Output JSON only, no markdown, no trailing commas.
`;

const PROMPT_INGREDIENTS_DETAIL_V3_DSLD_RESCUE = `You are NuTri-AI. Use the provided FACTS_DIGEST_JSON.
Return JSON only with this exact shape:
{
  "items": [
    {
      "name": "...",
      "whatItDoes": { "text": "...", "basisTags": ["..."] }
    }
  ],
  "overallSummary": null,
  "overlapNotes": null
}

Rules:
- basisTags must be from: label_fact, regulatory_claim, ingredient_inference, web_evidence, general_advice, not_provided, conflict.
- Only output items for the actives provided in FACTS_DIGEST_JSON.
- whatItDoes: 1 short sentence (<= 12 words).
- Avoid starting sentences with "Contains".
- Output JSON only, no markdown, no trailing commas.
`;
export async function fetchAnalysisBundleFastV3(
  context: string,
  model: string,
  apiKey: string,
  options: ResilienceOptions = {},
): Promise<Record<string, unknown> | null> {
  let release: (() => void) | null = null;
  try {
    if (options.breaker && !options.breaker.canRequest()) {
      return deepseekDebug
        ? (buildDebugPayload("fast_v3_breaker_open", "", null) as Record<string, unknown>)
        : null;
    }

    const timeoutMs = options.timeoutMs ?? 3500;
    const budgetedTimeout = options.budget ? options.budget.msFor(timeoutMs) : timeoutMs;
    if (budgetedTimeout <= 0) {
      return null;
    }

    if (options.semaphore) {
      try {
        release = await options.semaphore.acquire({
          timeoutMs: options.queueTimeoutMs ?? 0,
          signal: options.signal,
        });
      } catch {
        return deepseekDebug
          ? (buildDebugPayload("fast_v3_semaphore_timeout", "", null) as Record<string, unknown>)
          : null;
      }
    }

    const retryConfig: RetryOptions = {
      maxAttempts: options.retry?.maxAttempts ?? 1,
      baseDelayMs: options.retry?.baseDelayMs ?? 250,
      maxDelayMs: options.retry?.maxDelayMs ?? 900,
      jitterRatio: options.retry?.jitterRatio ?? 0.3,
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
              { role: "system", content: PROMPT_ANALYSIS_BUNDLE_FAST_V3 },
              { role: "user", content: context },
            ],
            temperature: 0.2,
            stream: false,
            max_tokens: options.maxTokens ?? 900,
            response_format: { type: "json_object" },
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

    const raw = await response.text();
    let data: { choices?: { message?: { content?: string } }[]; error?: unknown } | null = null;
    try {
      data = JSON.parse(raw);
    } catch (error) {
      logDeepseekParseIssue("fast_v3_response_parse_failed", raw, { error: String(error) });
      return null;
    }
    const content = data?.choices?.[0]?.message?.content;
    if (!content || typeof content !== "string") {
      const meta = { hasChoices: Array.isArray(data?.choices), error: data?.error ?? null };
      logDeepseekParseIssue("fast_v3_missing_content", raw, meta);
      return deepseekDebug ? (buildDebugPayload("fast_v3_missing_content", raw, meta) as Record<string, unknown>) : null;
    }
    const parsed = tryParseJsonLenient(content);
    if (parsed && typeof parsed === "object") {
      return parsed as Record<string, unknown>;
    }
    logDeepseekParseIssue("fast_v3_content_parse_failed", content, { error: "invalid_json_object" });
    return deepseekDebug
      ? (buildDebugPayload("fast_v3_content_parse_failed", content, { error: "invalid_json_object" }) as Record<
          string,
          unknown
        >)
      : null;
  } catch (error) {
    if (!isAbortError(error)) {
      options.breaker?.recordFailure();
      console.error("Error fetching analysis bundle fast v3:", error);
    } else {
      // Expected when the SSE client disconnects; avoid noisy logs.
      console.debug?.("[DeepSeek] fast_v3 aborted", error instanceof Error ? error.message : error);
    }
    return deepseekDebug
      ? (buildDebugPayload("fast_v3_request_failed", String(error), {
          name: error instanceof Error ? error.name : null,
        }) as Record<string, unknown>)
      : null;
  } finally {
    release?.();
  }
}

export async function fetchIngredientsDetailV3(
  context: string,
  model: string,
  apiKey: string,
  options: ResilienceOptions = {},
): Promise<Record<string, unknown> | null> {
  let release: (() => void) | null = null;
  const useDebugPayload = deepseekDebug || options.debugOnError === true;
  try {
    const prompt =
      options.promptOverride === "rescue"
        ? PROMPT_INGREDIENTS_DETAIL_V3_RESCUE
        : options.promptOverride === "dsld_short"
          ? PROMPT_INGREDIENTS_DETAIL_V3_DSLD_SHORT
          : options.promptOverride === "dsld_rescue"
            ? PROMPT_INGREDIENTS_DETAIL_V3_DSLD_RESCUE
            : PROMPT_INGREDIENTS_DETAIL_V3;
    if (options.breaker && !options.breaker.canRequest()) {
      return useDebugPayload
        ? (buildDebugPayload("detail_v3_breaker_open", "", null) as Record<string, unknown>)
        : null;
    }

    const timeoutMs = options.timeoutMs ?? 7000;
    const budgetedTimeout = options.budget ? options.budget.msFor(timeoutMs) : timeoutMs;
    if (budgetedTimeout <= 0) {
      return null;
    }

    if (options.semaphore) {
      try {
        release = await options.semaphore.acquire({
          timeoutMs: options.queueTimeoutMs ?? 0,
          signal: options.signal,
        });
      } catch {
        return useDebugPayload
          ? (buildDebugPayload("detail_v3_semaphore_timeout", "", null) as Record<string, unknown>)
          : null;
      }
    }

    const retryConfig: RetryOptions = {
      maxAttempts: options.retry?.maxAttempts ?? 1,
      baseDelayMs: options.retry?.baseDelayMs ?? 350,
      maxDelayMs: options.retry?.maxDelayMs ?? 1200,
      jitterRatio: options.retry?.jitterRatio ?? 0.35,
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
              { role: "system", content: prompt },
              { role: "user", content: context },
            ],
            temperature: 0.2,
            stream: false,
            max_tokens: options.maxTokens ?? 1200,
            response_format: { type: "json_object" },
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

    const raw = await response.text();
    let data: { choices?: { message?: { content?: string } }[]; error?: unknown } | null = null;
    try {
      data = JSON.parse(raw);
    } catch (error) {
      logDeepseekParseIssue("detail_v3_response_parse_failed", raw, { error: String(error) });
      return useDebugPayload
        ? (buildDebugPayload("detail_v3_response_parse_failed", raw, { error: String(error) }) as Record<
            string,
            unknown
          >)
        : null;
    }
    const content = data?.choices?.[0]?.message?.content;
    if (!content || typeof content !== "string") {
      const meta = { hasChoices: Array.isArray(data?.choices), error: data?.error ?? null };
      logDeepseekParseIssue("detail_v3_missing_content", raw, meta);
      return useDebugPayload
        ? (buildDebugPayload("detail_v3_missing_content", raw, meta) as Record<string, unknown>)
        : null;
    }
    const parsed = tryParseJsonLenient(content);
    if (parsed && typeof parsed === "object") {
      return parsed as Record<string, unknown>;
    }
    logDeepseekParseIssue("detail_v3_content_parse_failed", content, { error: "invalid_json_object" });
    return useDebugPayload
      ? (buildDebugPayload("detail_v3_content_parse_failed", content, { error: "invalid_json_object" }) as Record<
          string,
          unknown
        >)
      : null;
  } catch (error) {
    if (!isAbortError(error)) {
      options.breaker?.recordFailure();
    }
    console.error("Error fetching ingredients detail v3:", error);
    return useDebugPayload
      ? (buildDebugPayload("detail_v3_request_failed", String(error), {
          name: error instanceof Error ? error.name : null,
        }) as Record<string, unknown>)
      : null;
  } finally {
    release?.();
  }
}
