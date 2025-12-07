import cors from "cors";
import dotenv from "dotenv";
import express, { Request, Response } from "express";

import { fetchAnalysisSection } from "./deepseek.js";
import { constructFallbackQuery, scoreSearchQuality } from "./searchQuality.js";
import type { ErrorResponse, SearchItem, SearchResponse } from "./types.js";

dotenv.config();

const GOOGLE_CSE_ENDPOINT = "https://customsearch.googleapis.com/customsearch/v1";
const MAX_RESULTS = 5;
const PORT = Number(process.env.PORT ?? 3001);

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

// 辅助函数：发送 SSE 事件
const sendSSE = (res: any, type: string, data: any) => {
  res.write(`event: ${type}\n`); // 關鍵：告訴前端這是什麼事件
  res.write(`data: ${JSON.stringify(data)}\n\n`); // 數據不用再包一層 {type, data}
};

app.post("/api/enrich-stream", async (req: Request, res: Response) => {
  const { barcode } = req.body;
  const apiKey = process.env.DEEPSEEK_API_KEY;
  const model = process.env.DEEPSEEK_MODEL || "deepseek-chat";

  // 1. 设置 SSE Headers
  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");

  try {
    if (!barcode) {
      sendSSE(res, 'error', { message: 'No barcode provided' });
      res.end();
      return;
    }

    // 2. 阶段一：快速搜索 (Search Phase)
    const apiKey = process.env.GOOGLE_CSE_API_KEY;
    const cx = process.env.GOOGLE_CSE_CX;

    if (!apiKey || !cx) {
      sendSSE(res, 'error', { message: 'Google CSE not configured' });
      res.end();
      return;
    }

    const query = `"${barcode}"`;
    const initialItems = await performGoogleSearch(query, apiKey, cx);

    // 构造 Fallback 逻辑 (简单示意)
    const finalItems = initialItems;

    if (!finalItems.length) {
      sendSSE(res, 'error', { message: 'Product not found' });
      res.end();
      return;
    }

    // 🚀 关键点：搜索一结束，立刻把产品图和标题推给前端
    sendSSE(res, 'product_info', {
      productInfo: {
        brand: finalItems[0].title.split(' ')[0],
        name: finalItems[0].title,
        image: finalItems[0].image
      },
      sources: finalItems.map(i => ({ title: i.title, link: i.link }))
    });

    // 3. 阶段二：并行 AI 分析 (Parallel Phase)
    const searchContext = finalItems.map((item, idx) =>
      `[Source ${idx}] Title: ${item.title}\nSnippet: ${item.snippet}`
    ).join("\n\n");

    const deepseekKey = process.env.DEEPSEEK_API_KEY;
    if (!deepseekKey) {
      sendSSE(res, 'error', { message: 'DeepSeek API key missing' });
      res.end();
      return;
    }

    // 同时发射三枚火箭！
    const taskEfficacy = fetchAnalysisSection('efficacy', searchContext, model, deepseekKey);
    const taskSafety = fetchAnalysisSection('safety', searchContext, model, deepseekKey);
    const taskUsage = fetchAnalysisSection('usage', searchContext, model, deepseekKey);

    // 谁先回来就推谁
    taskEfficacy.then(data => sendSSE(res, 'result_efficacy', data));
    taskSafety.then(data => sendSSE(res, 'result_safety', data));
    taskUsage.then(data => sendSSE(res, 'result_usage', data));

    // 等待所有任务结束，关闭连接
    await Promise.all([taskEfficacy, taskSafety, taskUsage]);

    sendSSE(res, 'done', {});
    res.end();

  } catch (error: any) {
    console.error("Stream Error:", error);
    sendSSE(res, 'error', { message: error.message });
    res.end();
  }
});

app.post("/api/enrich-supplement", async (req: Request, res: Response) => {
  return res.status(410).json({ error: "endpoint_deprecated", message: "Use /api/enrich-stream instead" });
});


app.get("/health", (_req, res) => {
  res.json({ status: "ok" });
});

app.listen(PORT, () => {
  console.log(`Search backend listening on http://localhost:${PORT}`);
});
