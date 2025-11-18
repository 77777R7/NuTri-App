import cors from "cors";
import dotenv from "dotenv";
import express, { Request, Response } from "express";

import { enrichSupplementFromSearch } from "./deepseek.js";
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
}

interface GoogleCseResponse {
  items?: GoogleCseItem[];
}

const app = express();
app.use(cors());
app.use(express.json({ limit: "1mb" }));

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

    const searchParams = new URLSearchParams({
      key: apiKey,
      cx,
      q: `UPC ${barcode} supplement`,
    });
    const url = `${GOOGLE_CSE_ENDPOINT}?${searchParams.toString()}`;

    const response = await fetch(url, { cache: "no-store" });
    if (!response.ok) {
      const detail = await response.text();
      console.error("Google CSE returned non-OK status", {
        status: response.status,
        detail,
      });
      return res.status(502).json({
        error: "google_cse_error",
        statusCode: response.status,
        detail,
      } satisfies ErrorResponse);
    }

    const data = (await response.json()) as GoogleCseResponse;
    const items: SearchItem[] = (data.items ?? [])
      .slice(0, MAX_RESULTS)
      .map((item) => ({
        title: item.title ?? "",
        snippet: item.snippet ?? "",
        link: item.link ?? "",
      }))
      .filter((item) => item.title && item.link);

    if (!items.length) {
      return res.json({ status: "not_found", barcode } satisfies SearchResponse);
    }

    return res.json({ status: "ok", barcode, items } satisfies SearchResponse);
  } catch (error) {
    console.error("/api/search-by-barcode unexpected error", error);
    const detail =
      error instanceof Error ? `${error.name}: ${error.message}` : String(error);
    return res.status(500).json({ error: "unexpected_error", detail } satisfies ErrorResponse);
  }
});

app.post("/api/enrich-supplement", async (req: Request, res: Response) => {
  try {
    const { barcode: barcodeRaw, items: itemsRaw } = req.body ?? {};
    const barcode = typeof barcodeRaw === "string" ? barcodeRaw.trim() : "";
    if (!barcode) {
      return res
        .status(400)
        .json({ error: "missing barcode in body" } satisfies ErrorResponse);
    }

    if (!Array.isArray(itemsRaw) || !itemsRaw.length) {
      return res
        .status(400)
        .json({ error: "items array is required" } satisfies ErrorResponse);
    }

    const items: SearchItem[] = itemsRaw
      .map((item) => {
        if (!item || typeof item !== "object") {
          return null;
        }
        const record = item as Record<string, unknown>;
        const title = typeof record.title === "string" ? record.title.trim() : "";
        const link = typeof record.link === "string" ? record.link.trim() : "";
        const snippet = typeof record.snippet === "string" ? record.snippet.trim() : "";
        if (!title || !link) {
          return null;
        }
        return { title, link, snippet } satisfies SearchItem;
      })
      .filter((item): item is SearchItem => Boolean(item))
      .slice(0, MAX_RESULTS);

    if (!items.length) {
      return res
        .status(400)
        .json({ error: "no valid items provided" } satisfies ErrorResponse);
    }

    const analysis = await enrichSupplementFromSearch(barcode, items);
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
