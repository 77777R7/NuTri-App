import cors from "cors";
import dotenv from "dotenv";
import express, { NextFunction, Request, Response } from "express";
import { randomUUID } from "node:crypto";
import { performance } from "node:perf_hooks";

import { buildBarcodeSearchQueries, normalizeBarcodeInput } from "./barcode.js";
import { extractBrandProduct, extractBrandWithAI, type BrandExtractionResult } from "./brandExtractor.js";
import { buildEnhancedContext, fetchAnalysisSection, prepareContextSources } from "./deepseek.js";
import { analyzeLabelDraft, analyzeLabelDraftWithDiagnostics, formatForDeepSeek, needsConfirmation, validateIngredient, type LabelAnalysisDiagnostics, type LabelDraft } from "./labelAnalysis.js";
import { getCachedResult, hasCompletedAnalysis, setCachedResult, updateCachedAnalysis } from "./ocrCache.js";
import { constructFallbackQuery, extractDomain, isHighQualityDomain, scoreSearchItem, scoreSearchQuality } from "./searchQuality.js";
import { buildBarcodeSnapshot, buildLabelSnapshot, validateSnapshotOrFallback, type SnapshotAnalysisPayload } from "./snapshot.js";
import { getSnapshotCache, storeSnapshotCache } from "./snapshotCache.js";
import type { SupplementSnapshot } from "./schemas/supplementSnapshot.js";
import type {
  AiSupplementAnalysis,
  ErrorResponse,
  IngredientAnalysis,
  PrimaryActive,
  RatingScore,
  SearchItem,
  SearchResponse,
} from "./types.js";
import { callVisionOcr } from "./visionOcr.js";

dotenv.config();

const GOOGLE_CSE_ENDPOINT = "https://customsearch.googleapis.com/customsearch/v1";
const MAX_RESULTS = 5;
const QUALITY_THRESHOLD = 60; // Score below this triggers fallback search
const PORT = Number(process.env.PORT ?? 3001);
const LABEL_SCAN_OUTPUT_RULES = `LABEL-SCAN OUTPUT RULES:
1) overviewSummary must include serving unit (e.g., per softgel/caplet/serving) and 2-3 key ingredients with doses if present.
2) coreBenefits must list 3 items in "Ingredient - dose per unit" format; if dose missing, say "dose not specified".
3) overallAssessment must include a transparency note (e.g., proprietary blend or missing doses).
4) marketingVsReality must mention "Label-only analysis; no price/brand verification".
5) Do NOT mention price/cost; value should reflect formula transparency.
6) If data is missing, say "Not specified on label" instead of guessing.`;

// ============================================================================
// GOOGLE CSE UTILITIES
// ============================================================================

interface GoogleCseItem {
  title?: string;
  snippet?: string;
  link?: string;
  pagemap?: {
    cse_image?: { src?: string }[];
    cse_thumbnail?: { src?: string }[];
    imageobject?: { url?: string }[];
    metatags?: Record<string, unknown>[];
  };
}

interface GoogleCseResponse {
  items?: GoogleCseItem[];
}

const pickImageFromPagemap = (pagemap: GoogleCseItem["pagemap"]): string | undefined => {
  if (!pagemap) {
    return undefined;
  }
  const candidates: unknown[] = [
    pagemap.cse_image?.[0]?.src,
    pagemap.imageobject?.[0]?.url,
    pagemap.cse_thumbnail?.[0]?.src,
    pagemap.metatags?.find(
      (tag) => typeof tag?.["og:image"] === "string" && (tag?.["og:image"] as string).trim().length,
    )?.["og:image"],
  ];
  const match = candidates.find(
    (value): value is string => typeof value === "string" && value.trim().length > 0,
  );
  return match;
};

const performGoogleSearch = async (
  query: string,
  apiKey: string,
  cx: string,
): Promise<SearchItem[]> => {
  const searchParams = new URLSearchParams({
    key: apiKey,
    cx,
    q: query,
  });
  const url = `${GOOGLE_CSE_ENDPOINT}?${searchParams.toString()}`;

  console.log(`[Search] Query: "${query}"`);

  const response = await fetch(url, { cache: "no-store" });
  if (!response.ok) {
    const detail = await response.text();
    console.error("Google CSE returned non-OK status", {
      status: response.status,
      detail,
    });
    throw new Error(`Google CSE error: ${response.status}`);
  }

  const data = (await response.json()) as GoogleCseResponse;
  return (data.items ?? [])
    .slice(0, MAX_RESULTS)
    .map((item) => ({
      title: item.title ?? "",
      snippet: item.snippet ?? "",
      link: item.link ?? "",
      image: pickImageFromPagemap(item.pagemap),
    }))
    .filter((item) => item.title && item.link);
};

const runSearchPlan = async (
  queries: string[],
  apiKey: string,
  cx: string,
  options: { barcode?: string } = {},
): Promise<{ primary: SearchItem[]; secondary: SearchItem[]; merged: SearchItem[]; queriesTried: string[] }> => {
  let primary: SearchItem[] = [];
  const secondary: SearchItem[] = [];
  const queriesTried: string[] = [];

  for (const query of queries) {
    try {
      const items = await performGoogleSearch(query, apiKey, cx);
      queriesTried.push(query);

      if (!items.length) {
        continue;
      }

      if (primary.length === 0) {
        primary = items;
      } else {
        secondary.push(...items);
      }

      const merged = mergeAndDedupe(primary, secondary, { barcode: options.barcode });
      const qualityScore = scoreSearchQuality(merged, { barcode: options.barcode });

      if (merged.length >= MAX_RESULTS && qualityScore >= QUALITY_THRESHOLD) {
        return { primary, secondary, merged, queriesTried };
      }
    } catch (error) {
      queriesTried.push(query);
      console.warn(`[Search] Query failed: "${query}"`, error);
    }
  }

  return {
    primary,
    secondary,
    merged: mergeAndDedupe(primary, secondary, { barcode: options.barcode }),
    queriesTried,
  };
};

// ============================================================================
// SEARCH RESULT MERGING
// ============================================================================

/**
 * Merge and deduplicate search results, prioritizing high-quality domains
 */
const TRACKING_QUERY_PARAM_PREFIXES = ["utm_"];
const TRACKING_QUERY_PARAMS = new Set([
  "gclid",
  "fbclid",
  "msclkid",
  "yclid",
  "mc_cid",
  "mc_eid",
  "spm",
  "ref",
]);

const canonicalizeUrl = (rawUrl: string): string => {
  try {
    const url = new URL(rawUrl);
    url.hash = "";
    for (const key of [...url.searchParams.keys()]) {
      if (TRACKING_QUERY_PARAM_PREFIXES.some((prefix) => key.startsWith(prefix)) || TRACKING_QUERY_PARAMS.has(key)) {
        url.searchParams.delete(key);
      }
    }
    return url.toString();
  } catch {
    return rawUrl;
  }
};

function mergeAndDedupe(
  primary: SearchItem[],
  secondary: SearchItem[],
  options: { barcode?: string } = {},
): SearchItem[] {
  const candidates = new Map<
    string,
    {
      item: SearchItem;
      score: number;
      hasImage: boolean;
      sourceRank: number;
      insertionOrder: number;
    }
  >();

  const addItem = (item: SearchItem, sourceRank: number, insertionOrder: number) => {
    const key = canonicalizeUrl(item.link);
    const score = scoreSearchItem(item, { barcode: options.barcode });
    const hasImage = Boolean(item.image);
    const existing = candidates.get(key);

    if (!existing) {
      candidates.set(key, { item, score, hasImage, sourceRank, insertionOrder });
      return;
    }

    const shouldReplace =
      score > existing.score ||
      (score === existing.score && hasImage && !existing.hasImage) ||
      (score === existing.score && hasImage === existing.hasImage && sourceRank < existing.sourceRank);

    if (shouldReplace) {
      candidates.set(key, {
        item,
        score,
        hasImage,
        sourceRank,
        insertionOrder: Math.min(existing.insertionOrder, insertionOrder),
      });
    }
  };

  let insertionOrder = 0;
  for (const item of primary) {
    addItem(item, 0, insertionOrder++);
  }
  for (const item of secondary) {
    addItem(item, 1, insertionOrder++);
  }

  return [...candidates.values()]
    .sort((a, b) => {
      if (b.score !== a.score) return b.score - a.score;
      if (Number(b.hasImage) !== Number(a.hasImage)) return Number(b.hasImage) - Number(a.hasImage);
      if (a.sourceRank !== b.sourceRank) return a.sourceRank - b.sourceRank;
      return a.insertionOrder - b.insertionOrder;
    })
    .map((entry) => entry.item)
    .slice(0, MAX_RESULTS);
}

// ============================================================================
// EXPRESS APP
// ============================================================================

const app = express();
app.set("trust proxy", 1); // P1-2: Trust first proxy for correct client IP
app.use(cors());
app.use(express.json({ limit: "10mb" })); // P0-2: Increased from 1mb for image base64

// Minimal request logging (no body / no secrets)
app.use((req: Request, res: Response, next: NextFunction) => {
  const requestId = randomUUID();
  res.setHeader("x-request-id", requestId);
  const startedAt = process.hrtime.bigint();

  res.on("finish", () => {
    // Avoid noisy health check logs (Render pings this frequently).
    if (req.path === "/health") return;

    const durationMs = Number(process.hrtime.bigint() - startedAt) / 1e6;
    const durationLabel = `${durationMs.toFixed(1)}ms`;
    console.log(`[HTTP] ${res.statusCode} ${req.method} ${req.path} (${durationLabel}) id=${requestId}`);
  });

  next();
});

// ============================================================================
// SSE HELPER
// ============================================================================

const sendSSE = (res: Response, type: string, data: unknown) => {
  res.write(`event: ${type}\n`);
  res.write(`data: ${JSON.stringify(data)}\n\n`);
};

const buildValidatedLabelSnapshot = (input: {
  status: "ok" | "needs_confirmation" | "failed";
  draft?: LabelDraft;
  analysis?: AiSupplementAnalysis | null;
  message?: string;
}): SupplementSnapshot => {
  const candidate = buildLabelSnapshot({
    status: input.status,
    analysis: input.analysis ?? null,
    draft: input.draft ?? null,
    message: input.message,
  });

  return validateSnapshotOrFallback({
    candidate,
    fallback: {
      source: "label",
      barcodeRaw: null,
      productInfo: {
        brand: input.analysis?.status === "success" ? input.analysis.productInfo?.brand ?? null : null,
        name: input.analysis?.status === "success" ? input.analysis.productInfo?.name ?? null : null,
        category: input.analysis?.status === "success" ? input.analysis.productInfo?.category ?? null : null,
        imageUrl: input.analysis?.status === "success" ? input.analysis.productInfo?.image ?? null : null,
      },
      createdAt: candidate.createdAt,
    },
  });
};

const buildBarcodeCacheKey = (barcode: string): string => {
  const normalized = normalizeBarcodeInput(barcode);
  return normalized ? normalized.code.padStart(14, "0") : barcode;
};

const buildAndCacheLabelSnapshot = async (input: {
  status: "ok" | "needs_confirmation" | "failed";
  draft?: LabelDraft;
  analysis?: AiSupplementAnalysis | null;
  message?: string;
  imageHash: string;
}): Promise<SupplementSnapshot> => {
  const snapshot = buildValidatedLabelSnapshot({
    status: input.status,
    draft: input.draft,
    analysis: input.analysis,
    message: input.message,
  });

  await storeSnapshotCache({
    key: input.imageHash,
    source: "label",
    snapshot,
  });

  return snapshot;
};

// ============================================================================
// ENDPOINTS
// ============================================================================

/**
 * Legacy endpoint for barcode search only (no AI analysis)
 */
app.get("/api/search-by-barcode", async (req: Request, res: Response) => {
  try {
    const barcodeRaw = req.query.code;
    const barcodeInput = typeof barcodeRaw === "string" ? barcodeRaw : "";
    const normalized = normalizeBarcodeInput(barcodeInput);

    if (!normalized) {
      return res
        .status(400)
        .json({ error: "invalid_barcode", detail: "Missing or invalid barcode 'code' query param" } satisfies ErrorResponse);
    }

    const apiKey = process.env.GOOGLE_CSE_API_KEY;
    const cx = process.env.GOOGLE_CSE_CX;
    if (!apiKey || !cx) {
      return res
        .status(500)
        .json({ error: "google_cse_env_not_set" } satisfies ErrorResponse);
    }

    const barcode = normalized.code;
    const queries = buildBarcodeSearchQueries(normalized);
    const initial = await runSearchPlan(queries, apiKey, cx, { barcode });
    const qualityScore = scoreSearchQuality(initial.merged, { barcode });
    console.log(`[Search] Barcode: ${barcode}, Initial Score: ${qualityScore}, Queries: ${initial.queriesTried.length}`);

    let finalPrimary = initial.primary;
    let finalSecondary = [...initial.secondary];
    let finalItems = initial.merged;

    // Step 2: Fallback if quality is low
    if (qualityScore < QUALITY_THRESHOLD && finalItems.length > 0) {
      const extraction = extractBrandProduct(finalItems);
      const fallbackQueries: string[] = [];

      if (extraction.brand && extraction.product) {
        fallbackQueries.push(
          `"${extraction.brand}" "${extraction.product}" "supplement facts"`,
          `"${extraction.brand}" "${extraction.product}" ingredients "supplement facts"`,
          `"${extraction.brand}" "${extraction.product}" "other ingredients"`,
          `"${extraction.brand}" "${extraction.product}" "nutrition facts"`,
          `"${extraction.brand}" "${extraction.product}" site:amazon.com "supplement facts"`,
          `"${extraction.brand}" "${extraction.product}" site:iherb.com "supplement facts"`,
        );
      }

      const titleFallback = constructFallbackQuery(finalItems);
      if (titleFallback) {
        fallbackQueries.push(titleFallback);
      }

      if (fallbackQueries.length > 0) {
        console.log(`[Search] Fallback queries: ${fallbackQueries.length}`);
        try {
          const fallbackPlan = await runSearchPlan(fallbackQueries, apiKey, cx, { barcode });
          finalSecondary = [...finalSecondary, ...fallbackPlan.primary, ...fallbackPlan.secondary];
          finalItems = mergeAndDedupe(finalPrimary, finalSecondary, { barcode });
        } catch (error) {
          console.warn("[Search] Fallback search failed", error);
        }
      }
    }

    if (!finalItems.length) {
      return res.json({ status: "not_found", barcode } satisfies SearchResponse);
    }

    return res.json({ status: "ok", barcode, items: finalItems } satisfies SearchResponse);
  } catch (error) {
    console.error("/api/search-by-barcode unexpected error", error);
    const detail =
      error instanceof Error ? `${error.name}: ${error.message}` : String(error);
    return res.status(500).json({ error: "unexpected_error", detail } satisfies ErrorResponse);
  }
});

/**
 * Main streaming endpoint: Two-step search + AI analysis
 */
app.post("/api/enrich-stream", async (req: Request, res: Response) => {
  const rawBarcode = typeof req.body?.barcode === "string" ? req.body.barcode : "";
  const normalized = normalizeBarcodeInput(rawBarcode);
  const model = process.env.DEEPSEEK_MODEL || "deepseek-chat";

  // Set SSE Headers
  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");

  try {
    if (!normalized) {
      sendSSE(res, "error", { message: "Invalid barcode provided" });
      res.end();
      return;
    }
    const barcode = normalized.code;
    const cacheKey = buildBarcodeCacheKey(barcode);

    const cached = await getSnapshotCache({ key: cacheKey, source: "barcode" });
    if (cached) {
      console.log(`[Stream] Cache hit for barcode: ${barcode}`);
      const { snapshot, analysisPayload } = cached;
      if (analysisPayload?.brandExtraction) {
        sendSSE(res, "brand_extracted", analysisPayload.brandExtraction);
      }

      const productInfo = analysisPayload?.productInfo ?? {
        brand: snapshot.product.brand,
        name: snapshot.product.name,
        category: snapshot.product.category,
        image: snapshot.product.imageUrl,
      };

      const sources = analysisPayload?.sources ?? snapshot.references.items.map((ref) => ({
        title: ref.title,
        link: ref.url,
        domain: extractDomain(ref.url),
        isHighQuality: false,
      }));

      sendSSE(res, "product_info", { productInfo, sources });

      const fallbackScore = (value: number | undefined) =>
        typeof value === "number" ? Math.round(value / 10) : 5;

      const fallbackEfficacy = snapshot.scores
        ? {
          score: fallbackScore(snapshot.scores.effectiveness),
          verdict: "Cached snapshot analysis.",
          primaryActive: null,
          ingredients: [],
          overviewSummary: null,
          coreBenefits: [],
          overallAssessment: "",
          marketingVsReality: "",
        }
        : null;

      const fallbackSafety = snapshot.scores
        ? {
          score: fallbackScore(snapshot.scores.safety),
          verdict: "Cached snapshot analysis.",
          risks: [],
          redFlags: [],
          recommendation: "Cached snapshot analysis.",
        }
        : null;

      const fallbackUsagePayload = snapshot.scores
        ? {
          usage: {
            summary: "Cached snapshot analysis.",
            timing: "",
            withFood: null,
            frequency: "",
            interactions: [],
          },
          value: {
            score: fallbackScore(snapshot.scores.value),
            verdict: "Cached snapshot analysis.",
            analysis: "Cached snapshot analysis.",
            costPerServing: null,
            alternatives: [],
          },
          social: {
            score: 3,
            summary: "Cached snapshot analysis.",
          },
        }
        : null;

      if (analysisPayload?.efficacy || fallbackEfficacy) {
        sendSSE(res, "result_efficacy", analysisPayload?.efficacy ?? fallbackEfficacy);
      }
      if (analysisPayload?.safety || fallbackSafety) {
        sendSSE(res, "result_safety", analysisPayload?.safety ?? fallbackSafety);
      }
      if (analysisPayload?.usagePayload || fallbackUsagePayload) {
        sendSSE(res, "result_usage", analysisPayload?.usagePayload ?? fallbackUsagePayload);
      }

      sendSSE(res, "snapshot", snapshot);
      sendSSE(res, "done", { barcode });
      res.end();
      return;
    }

    const googleApiKey = process.env.GOOGLE_CSE_API_KEY;
    const cx = process.env.GOOGLE_CSE_CX;
    const deepseekKey = process.env.DEEPSEEK_API_KEY;

    if (!googleApiKey || !cx) {
      sendSSE(res, "error", { message: "Google CSE not configured" });
      res.end();
      return;
    }

    if (!deepseekKey) {
      sendSSE(res, "error", { message: "DeepSeek API key missing" });
      res.end();
      return;
    }

    // =========================================================================
    // STEP 1: Initial Barcode Search
    // =========================================================================
    console.log(`[Stream] Starting analysis for barcode: ${barcode}`);

    const queries = buildBarcodeSearchQueries(normalized);
    const initial = await runSearchPlan(queries, googleApiKey, cx, { barcode });
    const initialItems = initial.merged;

    if (!initialItems.length) {
      sendSSE(res, "error", { message: "Product not found" });
      res.end();
      return;
    }

    // =========================================================================
    // STEP 1.5: Brand/Product Extraction
    // =========================================================================
    let extraction: BrandExtractionResult = extractBrandProduct(initialItems);
    console.log(`[Stream] Initial extraction:`, extraction);

    // If confidence is low, use AI to extract brand/product
    if (extraction.confidence === "low") {
      console.log(`[Stream] Low confidence (${extraction.score}), using AI extraction`);
      extraction = await extractBrandWithAI(initialItems, deepseekKey, model);
      console.log(`[Stream] AI extraction result:`, extraction);
    }

    // Send brand extraction result to frontend
    sendSSE(res, "brand_extracted", {
      brand: extraction.brand,
      product: extraction.product,
      category: extraction.category,
      confidence: extraction.confidence,
      source: extraction.source,
    });

    const brand = extraction.brand || "Unknown Brand";
    const product = extraction.product || initialItems[0].title;

    // Send product info immediately (user sees something fast)
    sendSSE(res, "product_info", {
      productInfo: {
        brand: brand,
        name: product,
        category: extraction.category,
        image: initialItems[0].image,
      },
      sources: initialItems.map((i) => ({
        title: i.title,
        link: i.link,
        domain: extractDomain(i.link),
        isHighQuality: isHighQualityDomain(i.link),
      })),
    });

    // =========================================================================
    // STEP 2: Detailed Search (for ingredient information)
    // =========================================================================
    let detailItems = initialItems;
    const initialQuality = scoreSearchQuality(initialItems, { barcode });
    console.log(`[Stream] Initial search quality: ${initialQuality}`);

    // If quality is not good enough, do a second search focused on ingredients
    if (initialQuality < QUALITY_THRESHOLD) {
      const detailQueries: string[] = [];

      if (extraction.brand && extraction.product) {
        detailQueries.push(
          `"${extraction.brand}" "${extraction.product}" "supplement facts"`,
          `"${extraction.brand}" "${extraction.product}" ingredients "supplement facts"`,
          `"${extraction.brand}" "${extraction.product}" "other ingredients"`,
          `"${extraction.brand}" "${extraction.product}" "nutrition facts"`,
          `"${extraction.brand}" "${extraction.product}" site:amazon.com "supplement facts"`,
          `"${extraction.brand}" "${extraction.product}" site:iherb.com "supplement facts"`,
        );
      }

      const titleFallback = constructFallbackQuery(initialItems);
      if (titleFallback) {
        detailQueries.push(titleFallback);
      }

      if (detailQueries.length > 0) {
        console.log(`[Stream] Running detail search plan (${detailQueries.length} queries)`);
        try {
          const detailPlan = await runSearchPlan(detailQueries, googleApiKey, cx, { barcode });
          const extraItems = [...detailPlan.primary, ...detailPlan.secondary];
          detailItems = mergeAndDedupe(initialItems, extraItems, { barcode });
          console.log(
            `[Stream] Detail search quality: ${scoreSearchQuality(detailItems, { barcode })}`,
          );
        } catch (detailError) {
          console.warn("[Stream] Detail search failed", detailError);
        }
      }
    }

    console.log(`[Stream] Final items count: ${detailItems.length}`);

    // =========================================================================
    // STEP 3: Parallel AI Analysis
    // =========================================================================
    const sources = await prepareContextSources(detailItems);
    const efficacyContext = buildEnhancedContext({ brand, product, barcode, sources }, "efficacy");
    const safetyContext = buildEnhancedContext({ brand, product, barcode, sources }, "safety");
    const usageContext = buildEnhancedContext({ brand, product, barcode, sources }, "usage");

    console.log(`[Stream] Starting parallel AI analysis...`);

    // Fire all three analysis tasks in parallel
    const taskEfficacy = fetchAnalysisSection("efficacy", efficacyContext, model, deepseekKey);
    const taskSafety = fetchAnalysisSection("safety", safetyContext, model, deepseekKey);
    const taskUsage = fetchAnalysisSection("usage", usageContext, model, deepseekKey);

    // Send results as they complete (whoever finishes first gets sent first)
    taskEfficacy.then((data) => {
      console.log(`[Stream] Efficacy analysis complete`);
      sendSSE(res, "result_efficacy", data);
    });

    taskSafety.then((data) => {
      console.log(`[Stream] Safety analysis complete`);
      sendSSE(res, "result_safety", data);
    });

    taskUsage.then((data) => {
      console.log(`[Stream] Usage analysis complete`);
      sendSSE(res, "result_usage", data);
    });

    // Wait for all tasks to complete
    const [efficacyResult, safetyResult, usageResult] = await Promise.all([
      taskEfficacy,
      taskSafety,
      taskUsage,
    ]);

    const analysisPayload: SnapshotAnalysisPayload = {
      brandExtraction: {
        brand: extraction.brand,
        product: extraction.product,
        category: extraction.category,
        confidence: extraction.confidence,
        source: extraction.source,
      },
      productInfo: {
        brand,
        name: product,
        category: extraction.category ?? null,
        image: detailItems[0]?.image ?? initialItems[0]?.image ?? null,
      },
      sources: detailItems.map((item) => ({
        title: item.title,
        link: item.link,
        domain: extractDomain(item.link),
        isHighQuality: isHighQualityDomain(item.link),
      })),
      efficacy: efficacyResult,
      safety: safetyResult,
      usagePayload: usageResult,
    };

    const snapshotCandidate = buildBarcodeSnapshot({
      barcode,
      productInfo: analysisPayload.productInfo ?? null,
      sources: detailItems,
      efficacy: efficacyResult ?? null,
      safety: safetyResult ?? null,
      usagePayload: usageResult ?? null,
    });

    const snapshot = validateSnapshotOrFallback({
      candidate: snapshotCandidate,
      fallback: {
        source: "barcode",
        barcodeRaw: barcode,
        productInfo: {
          brand,
          name: product,
          category: extraction.category ?? null,
          imageUrl: detailItems[0]?.image ?? initialItems[0]?.image ?? null,
        },
        createdAt: snapshotCandidate.createdAt,
      },
    });

    const expiresAt = snapshot.listings.items.length
      ? new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString()
      : null;

    await storeSnapshotCache({
      key: cacheKey,
      source: "barcode",
      snapshot,
      analysisPayload,
      expiresAt,
    });

    sendSSE(res, "snapshot", snapshot);
    console.log(`[Stream] All analysis complete for barcode: ${barcode}`);
    sendSSE(res, "done", { barcode });
    res.end();

  } catch (error: unknown) {
    console.error("Stream Error:", error);
    const message = error instanceof Error ? error.message : "Unknown error";
    sendSSE(res, "error", { message });
    res.end();
  }
});

// ============================================================================
// RATE LIMITING FOR LABEL SCAN
// ============================================================================

interface RateLimitEntry {
  count: number;
  resetAt: number;
}

const rateLimitMinute = new Map<string, RateLimitEntry>();
const rateLimitDay = new Map<string, RateLimitEntry>();

const OCR_RATE_LIMIT_PER_MINUTE = Number(process.env.OCR_RATE_LIMIT_PER_MINUTE ?? 10);
const OCR_RATE_LIMIT_PER_DAY = Number(process.env.OCR_RATE_LIMIT_PER_DAY ?? 50);

function checkRateLimit(userId: string): { allowed: boolean; retryAfter?: number } {
  const now = Date.now();
  const minuteKey = `${userId}:minute`;
  const dayKey = `${userId}:day`;

  // Check minute limit
  let minuteEntry = rateLimitMinute.get(minuteKey);
  if (!minuteEntry || now > minuteEntry.resetAt) {
    minuteEntry = { count: 0, resetAt: now + 60000 };
    rateLimitMinute.set(minuteKey, minuteEntry);
  }
  if (minuteEntry.count >= OCR_RATE_LIMIT_PER_MINUTE) {
    return { allowed: false, retryAfter: Math.ceil((minuteEntry.resetAt - now) / 1000) };
  }

  // Check day limit
  let dayEntry = rateLimitDay.get(dayKey);
  if (!dayEntry || now > dayEntry.resetAt) {
    dayEntry = { count: 0, resetAt: now + 86400000 };
    rateLimitDay.set(dayKey, dayEntry);
  }
  if (dayEntry.count >= OCR_RATE_LIMIT_PER_DAY) {
    return { allowed: false, retryAfter: Math.ceil((dayEntry.resetAt - now) / 1000) };
  }

  // Increment counters
  minuteEntry.count++;
  dayEntry.count++;

  return { allowed: true };
}

// P1-2: Cleanup expired rate limit entries every 10 minutes
setInterval(() => {
  const now = Date.now();
  for (const [key, entry] of rateLimitMinute) {
    if (now > entry.resetAt) rateLimitMinute.delete(key);
  }
  for (const [key, entry] of rateLimitDay) {
    if (now > entry.resetAt) rateLimitDay.delete(key);
  }
}, 10 * 60 * 1000);

// ============================================================================
// LABEL SCAN ENDPOINTS
// ============================================================================

interface AnalyzeLabelRequest {
  imageBase64?: string;
  imageHash: string;
  saveImage?: boolean;
  deviceId?: string;
  debug?: boolean;
  includeAnalysis?: boolean;
  async?: boolean;
}

interface LabelAnalysisResponse {
  status: "ok" | "needs_confirmation" | "failed";
  draft?: LabelDraft;
  analysis?: AiSupplementAnalysis | null;
  analysisStatus?: "complete" | "partial" | "pending" | "skipped" | "unavailable";
  analysisIssues?: string[];
  message?: string;
  suggestion?: string;
  issues?: { type: string; message: string }[]; // P0-2: Return validation issues to frontend
  snapshot?: SupplementSnapshot;
  debug?: LabelAnalysisDebug;
}

interface LabelAnalysisDebug {
  timing: {
    decodeMs: number | null;
    preprocessMs: number | null;
    requestBodyMs: number | null;
    visionClientInitMs: number | null;
    visionMs: number | null;
    postprocessMs: number | null;
    llmMs: number | null;
    totalMs: number | null;
  };
  image: {
    inputBytes: number | null;
    inputMime: string | null;
    inputWidth: number | null;
    inputHeight: number | null;
    preprocessedBytes: number | null;
    preprocessedWidth: number | null;
    preprocessedHeight: number | null;
  };
  vision: {
    languageHints: string[];
    fullTextLength: number;
    fullTextPreview: string;
    tokenCount: number;
    avgTokenConfidence: number | null;
    p10TokenConfidence: number | null;
    p50TokenConfidence: number | null;
    p90TokenConfidence: number | null;
    medianTokenHeight: number | null;
  };
  heuristics: LabelAnalysisDiagnostics["heuristics"] | null;
  drafts: LabelAnalysisDiagnostics["drafts"] | null;
}

const FULL_TEXT_PREVIEW_LIMIT = 500;

interface TokenStats {
  tokenCount: number;
  avgTokenConfidence: number | null;
  p10TokenConfidence: number | null;
  p50TokenConfidence: number | null;
  p90TokenConfidence: number | null;
  medianTokenHeight: number | null;
}

function percentile(values: number[], percentileValue: number): number | null {
  if (values.length === 0) return null;
  const index = Math.floor((percentileValue / 100) * (values.length - 1));
  return values[Math.max(0, Math.min(index, values.length - 1))] ?? null;
}

function computeTokenStats(tokens: { confidence: number; height: number }[]): TokenStats {
  const tokenCount = tokens.length;
  if (tokenCount === 0) {
    return {
      tokenCount,
      avgTokenConfidence: null,
      p10TokenConfidence: null,
      p50TokenConfidence: null,
      p90TokenConfidence: null,
      medianTokenHeight: null,
    };
  }

  const confidences = tokens.map((token) => token.confidence).sort((a, b) => a - b);
  const heights = tokens.map((token) => token.height).sort((a, b) => a - b);
  const avgTokenConfidence = confidences.reduce((sum, value) => sum + value, 0) / tokenCount;

  return {
    tokenCount,
    avgTokenConfidence,
    p10TokenConfidence: percentile(confidences, 10),
    p50TokenConfidence: percentile(confidences, 50),
    p90TokenConfidence: percentile(confidences, 90),
    medianTokenHeight: heights[Math.floor(heights.length / 2)] ?? null,
  };
}

const labelAnalysisInFlight = new Map<string, Promise<void>>();

async function buildLabelScanAnalysis(options: {
  draft: LabelDraft;
  imageHash: string;
  model: string;
  apiKey: string;
  contextLabel?: string;
  disclaimer?: string;
}): Promise<{ analysis: AiSupplementAnalysis; analysisIssues: string[]; analysisStatus: "complete" | "partial"; llmMs: number }> {
  const { draft, imageHash, model, apiKey } = options;
  const contextLabel = options.contextLabel ?? "from OCR";
  const disclaimer =
    options.disclaimer ?? "This analysis is based on label information only. Not a substitute for medical advice.";
  const llmStart = performance.now();
  const ingredientContext = formatForDeepSeek(draft);
  const labelContext = `PRODUCT INFORMATION (${contextLabel}):
${ingredientContext}

TASK: Analyze this supplement based on the ingredient list above.
Focus on: ingredient forms, dosage adequacy, evidence strength.
If information is not available, use null instead of guessing.

${LABEL_SCAN_OUTPUT_RULES}`;

  const [efficacyRaw, safetyRaw, usageRaw] = await Promise.all([
    fetchAnalysisSection("efficacy", labelContext, model, apiKey),
    fetchAnalysisSection("safety", labelContext, model, apiKey),
    fetchAnalysisSection("usage", labelContext, model, apiKey),
  ]);

  const efficacy = efficacyRaw as {
    score?: number;
    verdict?: string;
    coreBenefits?: string[];
    overallAssessment?: string;
    overviewSummary?: string;
    marketingVsReality?: string;
    primaryActive?: {
      name?: string;
      form?: string | null;
      formQuality?: string;
      formNote?: string | null;
      dosageValue?: number | null;
      dosageUnit?: string | null;
      evidenceLevel?: string;
      evidenceSummary?: string | null;
    };
    ingredients?: {
      name?: string;
      dosageValue?: number | null;
      dosageUnit?: string | null;
      dosageAssessment?: string;
      evidenceLevel?: string;
      formQuality?: string;
    }[];
  } | null;
  const safety = safetyRaw as { score?: number; verdict?: string; risks?: string[]; redFlags?: string[] } | null;
  const usage = usageRaw as { usage?: { summary?: string; timing?: string; withFood?: boolean; interactions?: string[] }; value?: { score?: number; verdict?: string; analysis?: string }; social?: { score?: number; summary?: string } } | null;
  const analysisIssues: string[] = [];
  if (!efficacy) analysisIssues.push("efficacy_parse_failed");
  if (!safety) analysisIssues.push("safety_parse_failed");
  if (!usage) analysisIssues.push("usage_parse_failed");

  const normalizeNameKey = (value?: string | null) =>
    value?.toLowerCase().replace(/[^a-z0-9]+/g, "").trim() ?? "";
  const clampTextField = (value?: string | null) => (value && value.trim().length ? value.trim() : null);
  const mergeList = (primary: string[] | undefined, fallback: string[], limit: number) => {
    const results: string[] = [];
    const seen = new Set<string>();
    const add = (value?: string | null) => {
      if (!value) return;
      const trimmed = value.trim();
      if (!trimmed) return;
      const key = trimmed.toLowerCase();
      if (seen.has(key)) return;
      seen.add(key);
      results.push(trimmed);
    };
    (primary ?? []).forEach(add);
    fallback.forEach(add);
    return results.slice(0, limit);
  };

  const labelActives = (() => {
    const results: { name: string; doseText: string; dosageValue: number | null; dosageUnit: string | null }[] = [];
    const seen = new Set<string>();
    for (const ing of draft.ingredients) {
      const name = ing.name?.trim();
      if (!name) continue;
      const key = normalizeNameKey(name);
      if (!key || seen.has(key)) continue;
      seen.add(key);
      const doseText =
        ing.amount != null && ing.unit
          ? `${ing.amount} ${ing.unit}`
          : ing.dvPercent != null
            ? `${ing.dvPercent}% DV`
            : "dose not specified";
      results.push({
        name,
        doseText,
        dosageValue: ing.amount ?? null,
        dosageUnit: ing.unit ?? null,
      });
    }
    return results;
  })();

  const labelActivesSummary = labelActives.slice(0, 3);
  const labelActivesForList = labelActives.slice(0, 8);
  const labelActivesByKey = new Map(labelActives.map((active) => [normalizeNameKey(active.name), active]));

  const labelPrimary = labelActivesSummary[0];
  const labelCoreBenefits = labelActivesSummary.map((active) => `${active.name} - ${active.doseText}`);
  const labelSummary = labelActivesSummary.length
    ? `Label-only summary${draft.servingSize ? ` (${draft.servingSize})` : ''}: ${labelActivesSummary
        .map((active) => `${active.name} ${active.doseText}`)
        .join(', ')}.`
    : "Label-only summary based on listed ingredients.";
  const transparencyNote = draft.issues.some((issue) =>
    ["incomplete_ingredients", "header_not_found", "non_ingredient_line_detected", "unit_boundary_suspect", "dose_inconsistency_or_claim"].includes(issue.type)
  )
    ? "Ingredient disclosure may be incomplete or require review."
    : "Ingredient disclosure appears clear on the label.";

  const transparencyScore = (() => {
    const base = Math.round(4 + draft.confidenceScore * 6);
    let penalty = 0;
    if (draft.parseCoverage < 0.7) penalty += 2;
    if (draft.issues.some((issue) => issue.type === "incomplete_ingredients")) penalty += 2;
    if (draft.issues.some((issue) => issue.type === "non_ingredient_line_detected")) penalty += 2;
    if (draft.issues.some((issue) => issue.type === "unit_boundary_suspect")) penalty += 2;
    if (draft.issues.some((issue) => issue.type === "dose_inconsistency_or_claim")) penalty += 2;
    const score = Math.max(1, Math.min(10, base - penalty));
    return score;
  })();
  const transparencyVerdict =
    transparencyScore >= 8
      ? "Clear ingredient disclosure"
      : transparencyScore >= 6
        ? "Moderate ingredient transparency"
        : "Limited ingredient transparency";
  const transparencyAnalysis = transparencyNote;

  const toFormQuality = (value?: string | null): IngredientAnalysis["formQuality"] => {
    if (value === "high" || value === "medium" || value === "low" || value === "unknown") return value;
    return "unknown";
  };

  const toEvidenceLevel = (value?: string | null): IngredientAnalysis["evidenceLevel"] => {
    if (value === "strong" || value === "moderate" || value === "weak" || value === "none") return value;
    return "none";
  };

  const toDosageAssessment = (value?: string | null): IngredientAnalysis["dosageAssessment"] => {
    if (value === "adequate" || value === "underdosed" || value === "overdosed" || value === "unknown") return value;
    return "unknown";
  };

  const normalizePrimaryActive = (active?: any): PrimaryActive | null => {
    if (!active?.name) return null;
    return {
      name: String(active.name),
      form: active.form ?? null,
      formQuality: toFormQuality(active.formQuality),
      formNote: active.formNote ?? null,
      dosageValue: typeof active.dosageValue === "number" ? active.dosageValue : null,
      dosageUnit: active.dosageUnit ?? null,
      evidenceLevel: toEvidenceLevel(active.evidenceLevel),
      evidenceSummary: active.evidenceSummary ?? null,
    };
  };

  const normalizeIngredient = (ingredient?: any): IngredientAnalysis | null => {
    if (!ingredient?.name) return null;
    return {
      name: String(ingredient.name),
      form: ingredient.form ?? null,
      formQuality: toFormQuality(ingredient.formQuality),
      formNote: ingredient.formNote ?? null,
      dosageValue: typeof ingredient.dosageValue === "number" ? ingredient.dosageValue : null,
      dosageUnit: ingredient.dosageUnit ?? null,
      recommendedMin: typeof ingredient.recommendedMin === "number" ? ingredient.recommendedMin : null,
      recommendedMax: typeof ingredient.recommendedMax === "number" ? ingredient.recommendedMax : null,
      recommendedUnit: ingredient.recommendedUnit ?? null,
      dosageAssessment: toDosageAssessment(ingredient.dosageAssessment),
      evidenceLevel: toEvidenceLevel(ingredient.evidenceLevel),
      evidenceSummary: ingredient.evidenceSummary ?? null,
      rdaSource: ingredient.rdaSource ?? null,
      ulValue: typeof ingredient.ulValue === "number" ? ingredient.ulValue : null,
      ulUnit: ingredient.ulUnit ?? null,
    };
  };

  const llmPrimaryActive = normalizePrimaryActive(efficacy?.primaryActive);
  const labelPrimaryActive = labelPrimary
    ? normalizePrimaryActive({
        name: labelPrimary.name,
        form: null,
        formQuality: "unknown",
        formNote: null,
        dosageValue: labelPrimary.dosageValue,
        dosageUnit: labelPrimary.dosageUnit,
        evidenceLevel: "none",
        evidenceSummary: "Not specified on label",
      })
    : null;
  const fillPrimaryFromLabel = (active: PrimaryActive | null) => {
    if (!active?.name) return active;
    const match = labelActivesByKey.get(normalizeNameKey(active.name));
    if (!match) return active;
    return {
      ...active,
      dosageValue: active.dosageValue ?? match.dosageValue ?? null,
      dosageUnit: active.dosageUnit ?? match.dosageUnit ?? null,
    };
  };
  const primaryActive = fillPrimaryFromLabel(llmPrimaryActive ?? labelPrimaryActive);

  const llmIngredients = (Array.isArray(efficacy?.ingredients) ? efficacy.ingredients : [])
    .map((ingredient: any) => normalizeIngredient(ingredient))
    .filter((item): item is IngredientAnalysis => Boolean(item));
  const labelIngredientFallbacks = labelActivesForList
    .map((active) =>
      normalizeIngredient({
        name: active.name,
        form: null,
        formQuality: "unknown",
        formNote: null,
        dosageValue: active.dosageValue,
        dosageUnit: active.dosageUnit,
        recommendedMin: null,
        recommendedMax: null,
        recommendedUnit: null,
        dosageAssessment: "unknown",
        evidenceLevel: "none",
        evidenceSummary: "Not specified on label",
        rdaSource: null,
        ulValue: null,
        ulUnit: null,
      })
    )
    .filter((item): item is IngredientAnalysis => Boolean(item));
  const applyLabelDose = (ingredient: IngredientAnalysis) => {
    const match = labelActivesByKey.get(normalizeNameKey(ingredient.name));
    if (!match) return ingredient;
    return {
      ...ingredient,
      dosageValue: ingredient.dosageValue ?? match.dosageValue ?? null,
      dosageUnit: ingredient.dosageUnit ?? match.dosageUnit ?? null,
    };
  };
  const mergedIngredients = (() => {
    const results: IngredientAnalysis[] = [];
    const seen = new Set<string>();
    const add = (ingredient: IngredientAnalysis) => {
      const key = normalizeNameKey(ingredient.name);
      if (!key || seen.has(key)) return;
      seen.add(key);
      results.push(ingredient);
    };
    llmIngredients.map(applyLabelDose).forEach(add);
    labelIngredientFallbacks.forEach(add);
    return results;
  })();

  const rawBenefits = Array.isArray(efficacy?.coreBenefits) && efficacy.coreBenefits.length
    ? efficacy.coreBenefits
    : Array.isArray(efficacy?.benefits)
      ? efficacy.benefits
      : [];
  const preferLabelBenefits =
    rawBenefits.length === 0 || rawBenefits.every((benefit) => !/\d/.test(benefit));
  const llmCoreBenefits = mergeList(
    preferLabelBenefits ? [...labelCoreBenefits, ...rawBenefits] : rawBenefits,
    labelCoreBenefits,
    3
  );
  const overviewSummary = (() => {
    const llmSummary = clampTextField(efficacy?.overviewSummary);
    if (!llmSummary) return labelSummary;
    if (llmSummary.length >= 60) return llmSummary;
    return labelSummary ? `${llmSummary} ${labelSummary}` : llmSummary;
  })();
  const overallAssessment = clampTextField(efficacy?.overallAssessment) ?? transparencyNote;
  const marketingRequirement = "Label-only analysis; no price/brand verification.";
  const marketingBase = clampTextField(efficacy?.marketingVsReality);
  const marketingVsReality = marketingBase
    ? (marketingBase.toLowerCase().includes("label-only analysis")
        ? marketingBase
        : `${marketingBase} ${marketingRequirement}`)
    : marketingRequirement;
  const valueVerdict = clampTextField(usage?.value?.verdict) ?? transparencyVerdict;
  const valueAnalysis = clampTextField(usage?.value?.analysis) ?? transparencyAnalysis;

  const analysis: AiSupplementAnalysis = {
    schemaVersion: 1,
    barcode: `label:${imageHash.slice(0, 16)}`,
    generatedAt: new Date().toISOString(),
    model,
    status: "success",
    overallScore: efficacy?.score ?? 5,
    confidence: draft.confidenceScore > 0.8 ? "high" : draft.confidenceScore > 0.5 ? "medium" : "low",
    productInfo: {
      brand: null,
      name: "Label Scan Result",
      category: "supplement",
      image: null,
    },
    efficacy: {
      score: (efficacy?.score ?? 5) as RatingScore,
      benefits: llmCoreBenefits,
      dosageAssessment: {
        text: overallAssessment,
        isUnderDosed: false,
      },
      verdict: clampTextField(efficacy?.verdict) ?? undefined,
      highlights: llmCoreBenefits.length ? llmCoreBenefits : undefined,
      warnings: [],
      coreBenefits: llmCoreBenefits.length ? llmCoreBenefits : undefined,
      overviewSummary,
      overallAssessment,
      marketingVsReality,
      primaryActive,
      ingredients: mergedIngredients,
    },
    value: {
      score: transparencyScore as RatingScore,
      verdict: valueVerdict,
      analysis: valueAnalysis,
    },
    safety: {
      score: (safety?.score ?? 5) as RatingScore,
      risks: safety?.risks ?? [],
      redFlags: safety?.redFlags ?? [],
      additivesInfo: null,
      verdict: safety?.verdict ?? undefined,
    },
    social: {
      score: (usage?.social?.score ?? 3) as RatingScore,
      tier: "unknown",
      summary: usage?.social?.summary ?? "Brand reputation unknown from label scan.",
      tags: [],
    },
    usage: {
      summary: usage?.usage?.summary ?? "Follow label directions",
      timing: usage?.usage?.timing ?? null,
      withFood: usage?.usage?.withFood ?? null,
      conflicts: usage?.usage?.interactions ?? [],
      sourceType: "product_label",
    },
    sources: [],
    disclaimer,
    analysisIssues: analysisIssues.length ? analysisIssues : undefined,
  };

  const analysisStatus = analysisIssues.length ? "partial" : "complete";
  const llmMs = performance.now() - llmStart;

  return { analysis, analysisIssues, analysisStatus, llmMs };
}

/**
 * POST /api/analyze-label
 * Analyze a supplement label image using Vision OCR + DeepSeek
 */
app.post("/api/analyze-label", async (req: Request, res: Response) => {
  try {
    const totalStart = performance.now();
    const body = req.body as AnalyzeLabelRequest;
    const { imageBase64, imageHash, deviceId } = body;
    const debugEnabled =
      body.debug === true
      || (Array.isArray(req.query.debug)
        ? req.query.debug.includes("true")
        : req.query.debug === "true");
    const includeAnalysisQuery = Array.isArray(req.query.includeAnalysis)
      ? req.query.includeAnalysis
      : req.query.includeAnalysis
        ? [String(req.query.includeAnalysis)]
        : [];
    const includeAnalysisBody =
      typeof body.includeAnalysis === "string"
        ? body.includeAnalysis === "true" || body.includeAnalysis === "1"
        : body.includeAnalysis === true;
    const includeAnalysis =
      includeAnalysisBody
      || includeAnalysisQuery.some((value) => value === "true" || value === "1")
      || (typeof body.includeAnalysis === "undefined" && includeAnalysisQuery.length === 0 && Boolean(imageBase64));
    const asyncQuery = Array.isArray(req.query.async)
      ? req.query.async
      : req.query.async
        ? [String(req.query.async)]
        : [];
    const asyncBody =
      typeof body.async === "string"
        ? body.async === "true" || body.async === "1"
        : body.async === true;
    const asyncAnalysis =
      asyncBody || asyncQuery.some((value) => value === "true" || value === "1");

    // Validate input
    if (!imageHash) {
      return res.status(400).json({
        status: "failed",
        message: "Missing required field: imageHash",
      } satisfies LabelAnalysisResponse);
    }

    // Rate limiting
    const userId = deviceId ?? req.ip ?? "anonymous";
    const rateCheck = checkRateLimit(userId);
    if (!rateCheck.allowed) {
      res.setHeader("Retry-After", String(rateCheck.retryAfter ?? 60));
      return res.status(429).json({
        status: "failed",
        message: "Rate limit exceeded. Please try again later.",
        suggestion: `Wait ${rateCheck.retryAfter ?? 60} seconds before trying again.`,
      } satisfies LabelAnalysisResponse);
    }

    const cached = !debugEnabled ? await getCachedResult(imageHash) : null;

    if (!imageBase64 && !cached) {
      return res.status(400).json({
        status: "failed",
        message: "Missing required field: imageBase64",
      } satisfies LabelAnalysisResponse);
    }

    if (cached && !debugEnabled) {
      if (hasCompletedAnalysis(cached)) {
        console.log(`[LabelScan] Cache hit with analysis for ${imageHash.slice(0, 8)}...`);
        const cachedAnalysisIssues =
          (cached.analysis as { analysisIssues?: string[] } | null)?.analysisIssues ?? [];
        const cachedAnalysisStatus = cachedAnalysisIssues.length ? "partial" : "complete";
        const snapshot = await buildAndCacheLabelSnapshot({
          status: "ok",
          draft: cached.parsedIngredients ?? null,
          analysis: cached.analysis ?? null,
          imageHash,
        });
        return res.json({
          status: "ok",
          draft: cached.parsedIngredients ?? undefined,
          analysis: cached.analysis,
          analysisStatus: cachedAnalysisStatus,
          analysisIssues: cachedAnalysisIssues.length ? cachedAnalysisIssues : undefined,
          snapshot,
        } satisfies LabelAnalysisResponse);
      }

      if (cached.parsedIngredients) {
        const cachedDraft = cached.parsedIngredients;
        const cachedNeedsConfirmation = needsConfirmation(cachedDraft);
        const cachedStatus = cachedNeedsConfirmation ? "needs_confirmation" : "ok";

        if (!includeAnalysis) {
          console.log(`[LabelScan] Cache hit with draft only for ${imageHash.slice(0, 8)}...`);
          const snapshot = await buildAndCacheLabelSnapshot({
            status: cachedStatus,
            draft: cachedDraft,
            analysis: null,
            message: cachedNeedsConfirmation ? "Please review the extracted ingredients." : undefined,
            imageHash,
          });
          return res.json({
            status: cachedStatus,
            draft: cachedDraft,
            message: cachedNeedsConfirmation ? "Please review the extracted ingredients." : undefined,
            analysisStatus: "skipped",
            snapshot,
          } satisfies LabelAnalysisResponse);
        }

        const deepseekKey = process.env.DEEPSEEK_API_KEY;
        const model = process.env.DEEPSEEK_MODEL || "deepseek-chat";

        if (!deepseekKey) {
          const snapshot = await buildAndCacheLabelSnapshot({
            status: cachedStatus,
            draft: cachedDraft,
            analysis: null,
            message: "Analysis service unavailable. Please try again later.",
            imageHash,
          });
          return res.json({
            status: cachedStatus,
            draft: cachedDraft,
            message: "Analysis service unavailable. Please try again later.",
            analysisStatus: "unavailable",
            snapshot,
          } satisfies LabelAnalysisResponse);
        }

        if (asyncAnalysis) {
          console.log(`[LabelScan] Deferring DeepSeek analysis for ${imageHash.slice(0, 8)}...`);
          if (!labelAnalysisInFlight.has(imageHash)) {
            const task = (async () => {
              try {
                const { analysis, llmMs } = await buildLabelScanAnalysis({
                  draft: cachedDraft,
                  imageHash,
                  model,
                  apiKey: deepseekKey,
                });
                await updateCachedAnalysis(imageHash, analysis);
                console.log(`[LabelScan] Async analysis complete for ${imageHash.slice(0, 8)} in ${Math.round(llmMs)}ms...`);
              } catch (error) {
                console.error(`[LabelScan] Async analysis failed for ${imageHash.slice(0, 8)}:`, error);
              }
            })();
            labelAnalysisInFlight.set(imageHash, task);
            task.finally(() => labelAnalysisInFlight.delete(imageHash));
          }
          const snapshot = await buildAndCacheLabelSnapshot({
            status: cachedStatus,
            draft: cachedDraft,
            analysis: null,
            message: cachedNeedsConfirmation ? "Please review the extracted ingredients." : undefined,
            imageHash,
          });
          return res.json({
            status: cachedStatus,
            draft: cachedDraft,
            analysisStatus: "pending",
            snapshot,
          } satisfies LabelAnalysisResponse);
        }

        console.log(`[LabelScan] Running DeepSeek analysis from cache...`);
        const { analysis, analysisIssues, analysisStatus, llmMs } = await buildLabelScanAnalysis({
          draft: cachedDraft,
          imageHash,
          model,
          apiKey: deepseekKey,
        });
        await updateCachedAnalysis(imageHash, analysis);

        console.log(`[LabelScan] Analysis complete for ${imageHash.slice(0, 8)} in ${Math.round(llmMs)}ms...`);
        const snapshot = await buildAndCacheLabelSnapshot({
          status: cachedStatus,
          draft: cachedDraft,
          analysis,
          imageHash,
        });
        return res.json({
          status: cachedStatus,
          draft: cachedDraft,
          analysis,
          analysisStatus,
          analysisIssues: analysisIssues.length ? analysisIssues : undefined,
          snapshot,
        } satisfies LabelAnalysisResponse);
      }
    }

    // Call Vision OCR
    console.log(`[LabelScan] Calling Vision OCR for ${imageHash.slice(0, 8)}...`);
    const requestBodyMs = performance.now() - totalStart;
    let visionResult;
    try {
      visionResult = await callVisionOcr({ imageBase64 }, { debug: debugEnabled });
    } catch (visionError) {
      console.error("[LabelScan] Vision OCR failed:", visionError);
      const snapshot = await buildAndCacheLabelSnapshot({
        status: "failed",
        draft: null,
        analysis: null,
        message: "OCR processing failed. Please try again.",
        imageHash,
      });
      return res.status(500).json({
        status: "failed",
        message: "OCR processing failed. Please try again.",
        suggestion: "Try taking a clearer photo with better lighting and less glare.",
        snapshot,
      } satisfies LabelAnalysisResponse);
    }

    const fullText = visionResult.fullText ?? "";
    const tokenStats = computeTokenStats(visionResult.tokens);

    const buildDebugPayload = (
      postprocessMs: number | null,
      diagnostics: LabelAnalysisDiagnostics | null,
      llmMs: number | null,
      requestBodyMs: number | null
    ): LabelAnalysisDebug | undefined => {
      if (!debugEnabled) return undefined;
      const timing = visionResult.diagnostics?.timing;
      const image = visionResult.diagnostics?.image;
      return {
        timing: {
          decodeMs: timing?.decodeMs ?? null,
          preprocessMs: timing?.preprocessMs ?? null,
          requestBodyMs,
          visionClientInitMs: timing?.visionClientInitMs ?? null,
          visionMs: timing?.visionMs ?? null,
          postprocessMs,
          llmMs,
          totalMs: performance.now() - totalStart,
        },
        image: {
          inputBytes: image?.inputBytes ?? null,
          inputMime: image?.inputMime ?? null,
          inputWidth: image?.inputWidth ?? null,
          inputHeight: image?.inputHeight ?? null,
          preprocessedBytes: image?.preprocessedBytes ?? null,
          preprocessedWidth: image?.preprocessedWidth ?? null,
          preprocessedHeight: image?.preprocessedHeight ?? null,
        },
        vision: {
          languageHints: visionResult.diagnostics?.languageHints ?? [],
          fullTextLength: fullText.length,
          fullTextPreview: fullText.slice(0, FULL_TEXT_PREVIEW_LIMIT),
          tokenCount: tokenStats.tokenCount,
          avgTokenConfidence: tokenStats.avgTokenConfidence,
          p10TokenConfidence: tokenStats.p10TokenConfidence,
          p50TokenConfidence: tokenStats.p50TokenConfidence,
          p90TokenConfidence: tokenStats.p90TokenConfidence,
          medianTokenHeight: tokenStats.medianTokenHeight,
        },
        heuristics: diagnostics?.heuristics ?? null,
        drafts: diagnostics?.drafts ?? null,
      };
    };

    if (tokenStats.tokenCount === 0 && fullText.trim().length === 0) {
      const snapshot = await buildAndCacheLabelSnapshot({
        status: "failed",
        draft: null,
        analysis: null,
        message: "Could not detect any text in the image.",
        imageHash,
      });
      return res.json({
        status: "failed",
        message: "Could not detect any text in the image.",
        suggestion: "Make sure the Supplement Facts label is clearly visible and in focus.",
        debug: buildDebugPayload(null, null, null, requestBodyMs),
        snapshot,
      } satisfies LabelAnalysisResponse);
    }

    // Post-processing: infer rows and extract ingredients
    console.log(`[LabelScan] Processing ${visionResult.tokens.length} tokens...`);
    const postprocessStart = performance.now();
    let draft: LabelDraft;
    let analysisDiagnostics: LabelAnalysisDiagnostics | null = null;
    if (debugEnabled) {
      const analyzed = analyzeLabelDraftWithDiagnostics(visionResult.tokens, fullText);
      draft = analyzed.draft;
      analysisDiagnostics = analyzed.diagnostics;
    } else {
      draft = analyzeLabelDraft(visionResult.tokens, fullText);
    }
    const postprocessMs = performance.now() - postprocessStart;
    let llmMs: number | null = null;
    let debugPayload = buildDebugPayload(postprocessMs, analysisDiagnostics, llmMs, requestBodyMs);
    console.log(`[LabelScan] Extracted ${draft.ingredients.length} ingredients, confidence: ${draft.confidenceScore.toFixed(2)}`);

    // Cache the draft
    // P0-5: Only store visionRaw in debug mode to save space and protect privacy
    const shouldStoreVisionRaw = process.env.OCR_STORE_VISION_RAW === "true";
    await setCachedResult(imageHash, {
      visionRaw: shouldStoreVisionRaw ? visionResult.rawResponse : null,
      parsedIngredients: draft,
      confidence: draft.confidenceScore,
    });

    const needsReview = needsConfirmation(draft);
    // Check if confirmation needed
    if (needsReview && !includeAnalysis) {
      console.log(`[LabelScan] Low confidence, requesting confirmation`);
      const snapshot = await buildAndCacheLabelSnapshot({
        status: "needs_confirmation",
        draft,
        analysis: null,
        message: "Please review the extracted ingredients.",
        imageHash,
      });
      return res.json({
        status: "needs_confirmation",
        draft,
        message: "Please review the extracted ingredients.",
        debug: debugPayload,
        analysisStatus: "skipped",
        snapshot,
      } satisfies LabelAnalysisResponse);
    }

    if (!includeAnalysis) {
      const snapshot = await buildAndCacheLabelSnapshot({
        status: "ok",
        draft,
        analysis: null,
        imageHash,
      });
      return res.json({
        status: "ok",
        draft,
        debug: debugPayload,
        analysisStatus: "skipped",
        snapshot,
      } satisfies LabelAnalysisResponse);
    }

    // High confidence: proceed with DeepSeek analysis
    const deepseekKey = process.env.DEEPSEEK_API_KEY;
    const model = process.env.DEEPSEEK_MODEL || "deepseek-chat";

    if (!deepseekKey) {
      const snapshot = await buildAndCacheLabelSnapshot({
        status: needsReview ? "needs_confirmation" : "ok",
        draft,
        analysis: null,
        message: "Analysis service unavailable. Please try again later.",
        imageHash,
      });
      return res.json({
        status: needsReview ? "needs_confirmation" : "ok",
        draft,
        message: "Analysis service unavailable. Please try again later.",
        debug: debugPayload,
        analysisStatus: "unavailable",
        snapshot,
      } satisfies LabelAnalysisResponse);
    }

    if (asyncAnalysis) {
      console.log(`[LabelScan] Deferring DeepSeek analysis for ${imageHash.slice(0, 8)}...`);
      if (!labelAnalysisInFlight.has(imageHash)) {
        const task = (async () => {
          try {
            const { analysis, llmMs: asyncLlmMs } = await buildLabelScanAnalysis({
              draft,
              imageHash,
              model,
              apiKey: deepseekKey,
            });
            await updateCachedAnalysis(imageHash, analysis);
            console.log(`[LabelScan] Async analysis complete for ${imageHash.slice(0, 8)} in ${Math.round(asyncLlmMs)}ms...`);
          } catch (error) {
            console.error(`[LabelScan] Async analysis failed for ${imageHash.slice(0, 8)}:`, error);
          }
        })();
        labelAnalysisInFlight.set(imageHash, task);
        task.finally(() => labelAnalysisInFlight.delete(imageHash));
      }
      const snapshot = await buildAndCacheLabelSnapshot({
        status: needsReview ? "needs_confirmation" : "ok",
        draft,
        analysis: null,
        message: needsReview ? "Please review the extracted ingredients." : undefined,
        imageHash,
      });
      return res.json({
        status: needsReview ? "needs_confirmation" : "ok",
        draft,
        message: needsReview ? "Please review the extracted ingredients." : undefined,
        debug: debugPayload,
        analysisStatus: "pending",
        snapshot,
      } satisfies LabelAnalysisResponse);
    }

    console.log(`[LabelScan] Running DeepSeek analysis...`);
    const { analysis, analysisIssues, analysisStatus, llmMs: resolvedLlmMs } = await buildLabelScanAnalysis({
      draft,
      imageHash,
      model,
      apiKey: deepseekKey,
    });

    llmMs = resolvedLlmMs;

    // Update cache with analysis
    await updateCachedAnalysis(imageHash, analysis);
    debugPayload = buildDebugPayload(postprocessMs, analysisDiagnostics, llmMs, requestBodyMs);

    console.log(`[LabelScan] Analysis complete for ${imageHash.slice(0, 8)}...`);
    const snapshot = await buildAndCacheLabelSnapshot({
      status: needsReview ? "needs_confirmation" : "ok",
      draft,
      analysis,
      message: needsReview ? "Please review the extracted ingredients." : undefined,
      imageHash,
    });
    return res.json({
      status: needsReview ? "needs_confirmation" : "ok",
      draft,
      analysis,
      message: needsReview ? "Please review the extracted ingredients." : undefined,
      debug: debugPayload,
      analysisStatus,
      analysisIssues: analysisIssues.length ? analysisIssues : undefined,
      snapshot,
    } satisfies LabelAnalysisResponse);

  } catch (error) {
    console.error("[LabelScan] Unexpected error:", error);
    return res.status(500).json({
      status: "failed",
      message: "An unexpected error occurred.",
      suggestion: "Please try again. If the problem persists, try a different photo.",
    } satisfies LabelAnalysisResponse);
  }
});

/**
 * POST /api/analyze-label/confirm
 * Confirm edited ingredients and run DeepSeek analysis
 */
app.post("/api/analyze-label/confirm", async (req: Request, res: Response) => {
  try {
    const { imageHash, confirmedDraft } = req.body as {
      imageHash: string;
      confirmedDraft: LabelDraft;
    };

    if (!imageHash || !confirmedDraft) {
      return res.status(400).json({
        status: "failed",
        message: "Missing required fields: imageHash and confirmedDraft",
      } satisfies LabelAnalysisResponse);
    }

    // P0-4: Validate confirmed ingredients before analysis
    const validationIssues: { type: string; message: string }[] = [];
    for (const ing of confirmedDraft.ingredients) {
      const ingIssues = validateIngredient(ing);
      validationIssues.push(...ingIssues);
    }

    const hasBlockingIssues = validationIssues.some(
      (i) => i.type === 'unit_invalid' || i.type === 'value_anomaly'
    );

    if (hasBlockingIssues) {
      // P0-2: Return 200 with needs_confirmation, not 400 (frontend treats 400 as system error)
      const snapshot = await buildAndCacheLabelSnapshot({
        status: "needs_confirmation",
        draft: confirmedDraft,
        analysis: null,
        message: "Some ingredients have validation issues. Please review and correct.",
        imageHash,
      });
      return res.json({
        status: "needs_confirmation",
        draft: confirmedDraft,
        message: "Some ingredients have validation issues. Please review and correct.",
        issues: validationIssues, // Return specific issues so user knows what to fix
        snapshot,
      } satisfies LabelAnalysisResponse);
    }

    const deepseekKey = process.env.DEEPSEEK_API_KEY;
    const model = process.env.DEEPSEEK_MODEL || "deepseek-chat";

    if (!deepseekKey) {
      const snapshot = await buildAndCacheLabelSnapshot({
        status: "failed",
        draft: confirmedDraft,
        analysis: null,
        message: "Analysis service unavailable.",
        imageHash,
      });
      return res.status(503).json({
        status: "failed",
        message: "Analysis service unavailable.",
        snapshot,
      } satisfies LabelAnalysisResponse);
    }

    console.log(`[LabelScan/Confirm] Running analysis for ${imageHash.slice(0, 8)}...`);
    const { analysis, analysisIssues, analysisStatus } = await buildLabelScanAnalysis({
      draft: confirmedDraft,
      imageHash,
      model,
      apiKey: deepseekKey,
      contextLabel: "user-confirmed from OCR",
      disclaimer: "This analysis is based on user-confirmed label information. Not a substitute for medical advice.",
    });

    // P1-1: Use updateCachedAnalysis instead of setCachedResult to preserve created_at (TTL)
    await updateCachedAnalysis(imageHash, analysis);

    console.log(`[LabelScan/Confirm] Complete for ${imageHash.slice(0, 8)}...`);
    const snapshot = await buildAndCacheLabelSnapshot({
      status: "ok",
      draft: confirmedDraft,
      analysis,
      imageHash,
    });
    return res.json({
      status: "ok",
      draft: confirmedDraft,
      analysis,
      analysisStatus,
      analysisIssues: analysisIssues.length ? analysisIssues : undefined,
      snapshot,
    } satisfies LabelAnalysisResponse);

  } catch (error) {
    console.error("[LabelScan/Confirm] Unexpected error:", error);
    return res.status(500).json({
      status: "failed",
      message: "An unexpected error occurred.",
    } satisfies LabelAnalysisResponse);
  }
});

/**
 * Deprecated endpoint
 */
app.post("/api/enrich-supplement", async (_req: Request, res: Response) => {
  return res.status(410).json({
    error: "endpoint_deprecated",
    message: "Use /api/enrich-stream instead"
  });
});

/**
 * Health check
 */
app.get("/health", (_req: Request, res: Response) => {
  const googleCseConfigured = Boolean(process.env.GOOGLE_CSE_API_KEY && process.env.GOOGLE_CSE_CX);
  const deepseekConfigured = Boolean(process.env.DEEPSEEK_API_KEY);

  res.json({
    status: "ok",
    uptimeSec: Math.round(process.uptime()),
    configured: {
      googleCse: googleCseConfigured,
      deepseek: deepseekConfigured,
    },
  });
});

// Minimal error logging (no secrets)
app.use((error: unknown, req: Request, res: Response, _next: NextFunction) => {
  const message = error instanceof Error ? error.message : String(error);
  if (error instanceof Error) {
    console.error(`[ERR] ${req.method} ${req.path}: ${message}\n${error.stack ?? ""}`);
  } else {
    console.error(`[ERR] ${req.method} ${req.path}: ${message}`);
  }

  if (res.headersSent) {
    return;
  }

  res.status(500).json({ error: "internal_error" });
});

process.on("unhandledRejection", (reason) => {
  console.error("[UNHANDLED_REJECTION]", reason);
});

process.on("uncaughtException", (err) => {
  console.error("[UNCAUGHT_EXCEPTION]", err);
  process.exit(1);
});

app.listen(PORT, () => {
  console.log(`Search backend listening on http://localhost:${PORT}`);
});
