import { randomUUID } from "node:crypto";
import cors from "cors";
import dotenv from "dotenv";
import express, { NextFunction, Request, Response } from "express";

import { extractBrandProduct, extractBrandWithAI, type BrandExtractionResult } from "./brandExtractor.js";
import { buildEnhancedContext, fetchAnalysisSection, prepareContextSources } from "./deepseek.js";
import { buildBarcodeSearchQueries, normalizeBarcodeInput } from "./barcode.js";
import { constructFallbackQuery, extractDomain, isHighQualityDomain, scoreSearchItem, scoreSearchQuality } from "./searchQuality.js";
import type { ErrorResponse, SearchItem, SearchResponse } from "./types.js";

dotenv.config();

const GOOGLE_CSE_ENDPOINT = "https://customsearch.googleapis.com/customsearch/v1";
const MAX_RESULTS = 5;
const QUALITY_THRESHOLD = 60; // Score below this triggers fallback search
const PORT = Number(process.env.PORT ?? 3001);

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
app.use(cors());
app.use(express.json({ limit: "1mb" }));

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
    await Promise.all([taskEfficacy, taskSafety, taskUsage]);

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
