import cors from "cors";
import dotenv from "dotenv";
import express, { Request, Response } from "express";

import { enrichSupplementFromSearch } from "./deepseek.js";
import { constructFallbackQuery, scoreSearchQuality } from "./searchQuality.js";
import type {
  ErrorResponse,
  SearchItem,
  SearchResponse,
} from "./types.js";

dotenv.config();

const GOOGLE_CSE_ENDPOINT = "https://customsearch.googleapis.com/customsearch/v1";
const MAX_RESULTS = 5;
const PORT = Number(process.env.PORT ?? 3001);

interface GoogleCseItem {
  title?: string;
  snippet?: string;
  link?: string;
  pagemap?: {
    cse_image?: Array<{ src?: string }>;
    cse_thumbnail?: Array<{ src?: string }>;
    imageobject?: Array<{ url?: string }>;
    metatags?: Array<Record<string, unknown>>;
  };
}

interface GoogleCseResponse {
  items?: GoogleCseItem[];
}

const pickImageFromPagemap = (pagemap: GoogleCseItem["pagemap"]): string | undefined => {
  if (!pagemap) {
    return undefined;
  }
  const candidates: Array<unknown> = [
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

const app = express();
app.use(cors());
app.use(express.json({ limit: "1mb" }));

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

app.get("/api/search-by-barcode", async (req: Request, res: Response) => {
  try {
    const barcodeRaw = req.query.code;
    const barcode = typeof barcodeRaw === "string" ? barcodeRaw.trim() : "";

    if (!barcode) {
      return res
        .status(400)
        .json({ error: "missing barcode 'code' query param" } satisfies ErrorResponse);
    }

    const apiKey = process.env.GOOGLE_CSE_API_KEY;
    const cx = process.env.GOOGLE_CSE_CX;
    if (!apiKey || !cx) {
      return res
        .status(500)
        .json({ error: "google_cse_env_not_set" } satisfies ErrorResponse);
    }

    // 1. Initial Search (Barcode)
    const initialItems = await performGoogleSearch(`UPC ${barcode} supplement`, apiKey, cx);

    // 2. Quality Check
    const qualityScore = scoreSearchQuality(initialItems);
    console.log(`[Search] Barcode: ${barcode}, Score: ${qualityScore}`);

    let finalItems = initialItems;
    let fallbackTriggered = false;

    // 3. Smart Fallback
    if (qualityScore < 60) {
      const fallbackQuery = constructFallbackQuery(initialItems);
      if (fallbackQuery) {
        console.log(`[Search] Triggering fallback with query: "${fallbackQuery}"`);
        try {
          const fallbackItems = await performGoogleSearch(fallbackQuery, apiKey, cx);

          // Merge Strategy:
          // 1. Keep top 1 from initial search (best for cover image usually)
          // 2. Prioritize fallback items (better text content)
          // 3. Fill with remaining initial items

          const topInitial = initialItems[0];
          const remainingInitial = initialItems.slice(1);

          // Combine: [Top Initial] + [Fallback Items] + [Remaining Initial]
          // Note: If fallbackItems contains topInitial, dedupe will handle it.
          const combined = [topInitial, ...fallbackItems, ...remainingInitial];

          // Deduplicate by link
          const seenLinks = new Set<string>();
          finalItems = [];

          for (const item of combined) {
            if (!item) continue;
            if (!seenLinks.has(item.link)) {
              seenLinks.add(item.link);
              finalItems.push(item);
            }
          }

          // Slice to limit
          finalItems = finalItems.slice(0, MAX_RESULTS);
          fallbackTriggered = true;
        } catch (error) {
          console.warn("[Search] Fallback search failed", error);
        }
      } else {
        console.log("[Search] Fallback query could not be constructed");
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

import { supabase } from "./supabase.js";

app.post("/api/enrich-supplement", async (req: Request, res: Response) => {
  try {
    const { barcode: barcodeRaw, items: itemsRaw } = req.body ?? {};
    const barcode = typeof barcodeRaw === "string" ? barcodeRaw.trim() : "";
    if (!barcode) {
      return res
        .status(400)
        .json({ error: "missing barcode in body" } satisfies ErrorResponse);
    }

    // --- 1. Cache Read Strategy ---
    // Check if we already have a valid analysis for this barcode
    const { data: existingSupplement, error: fetchError } = await supabase
      .from("supplements")
      .select(`
        id,
        ai_analyses (
          analysis_data,
          created_at
        )
      `)
      .eq("barcode", barcode)
      .maybeSingle();

    if (!fetchError && existingSupplement && existingSupplement.ai_analyses?.length) {
      // Sort by created_at desc to get latest
      const analyses = existingSupplement.ai_analyses as Array<{ analysis_data: any; created_at: string }>;
      analyses.sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());

      const latest = analyses[0];
      if (latest && latest.analysis_data) {
        console.log(`[Cache] Hit for barcode: ${barcode}`);
        return res.json({
          status: "ok",
          barcode,
          analysis: latest.analysis_data,
        });
      }
    }

    console.log(`[Cache] Miss for barcode: ${barcode}, proceeding to live analysis`);

    if (!Array.isArray(itemsRaw) || !itemsRaw.length) {
      return res
        .status(400)
        .json({ error: "items array is required" } satisfies ErrorResponse);
    }

    const items: SearchItem[] = itemsRaw
      .map((item): SearchItem | null => {
        if (!item || typeof item !== "object") {
          return null;
        }
        const record = item as Record<string, unknown>;
        const title = typeof record.title === "string" ? record.title.trim() : "";
        const link = typeof record.link === "string" ? record.link.trim() : "";
        const snippet = typeof record.snippet === "string" ? record.snippet.trim() : "";
        const image = typeof record.image === "string" ? record.image.trim() : undefined;
        if (!title || !link) {
          return null;
        }
        return {
          title,
          link,
          snippet,
          image,
        };
      })
      .filter((item): item is SearchItem => item !== null)
      .slice(0, MAX_RESULTS);

    if (!items.length) {
      return res
        .status(400)
        .json({ error: "no valid items provided" } satisfies ErrorResponse);
    }

    // --- 2. Live Analysis ---
    const analysis = await enrichSupplementFromSearch(barcode, items);

    // --- 3. Cache Write Strategy ---
    if (analysis.status === "success" && analysis.productInfo) {
      // Run in background to not block response
      (async () => {
        try {
          const brandName = analysis.productInfo?.brand || "Unknown Brand";
          const productName = analysis.productInfo?.name || "Unknown Product";
          const category = analysis.productInfo?.category || "Uncategorized";
          const imageUrl = analysis.productInfo?.image || null;

          // A. Ensure Brand exists
          let brandId: string | null = null;

          // Try to find brand
          const { data: existingBrand } = await supabase
            .from("brands")
            .select("id")
            .ilike("name", brandName)
            .maybeSingle();

          if (existingBrand) {
            brandId = existingBrand.id;
          } else {
            // Create brand
            const { data: newBrand, error: brandError } = await supabase
              .from("brands")
              .insert({ name: brandName, verified: false })
              .select("id")
              .single();

            if (!brandError && newBrand) {
              brandId = newBrand.id;
            } else {
              console.error("[Cache] Failed to create brand", brandError);
            }
          }

          if (brandId) {
            // B. Upsert Supplement
            // We use upsert to handle race conditions or if it was created by another user
            const { data: supplement, error: suppError } = await supabase
              .from("supplements")
              .upsert(
                {
                  barcode,
                  name: productName,
                  brand_id: brandId,
                  category,
                  image_url: imageUrl,
                  verified: false,
                },
                { onConflict: "barcode" }
              )
              .select("id")
              .single();

            if (!suppError && supplement) {
              // C. Insert Analysis
              const { error: analysisError } = await supabase
                .from("ai_analyses")
                .insert({
                  supplement_id: supplement.id,
                  analysis_data: analysis,
                });

              if (analysisError) {
                console.error("[Cache] Failed to save analysis", analysisError);
              } else {
                console.log(`[Cache] Saved analysis for ${barcode}`);
              }
            } else {
              console.error("[Cache] Failed to upsert supplement", suppError);
            }
          }
        } catch (err) {
          console.error("[Cache] Background save failed", err);
        }
      })();
    }

    return res.json({ status: "ok", barcode, analysis });
  } catch (error) {
    console.error("/api/enrich-supplement error", error);
    const detail =
      error instanceof Error ? `${error.name}: ${error.message}` : String(error);
    return res.status(502).json({ error: "llm_error", detail } satisfies ErrorResponse);
  }
});

app.get("/health", (_req, res) => {
  res.json({ status: "ok" });
});

app.listen(PORT, () => {
  console.log(`Search backend listening on http://localhost:${PORT}`);
});
