 import type { SearchItem, AiSupplementAnalysis, AiIngredient } from "./types.js";

const DEEPSEEK_API_URL = process.env.DEEPSEEK_API_URL ?? "https://api.deepseek.com/v1/chat/completions";
const DEEPSEEK_MODEL = process.env.DEEPSEEK_MODEL ?? "deepseek-chat";

const buildPrompt = (barcode: string, items: SearchItem[]): string => {
  const formatted = items
    .map((item, index) => {
      const snippet = item.snippet?.replace(/\s+/g, " ").trim();
      return `Result ${index + 1}:
Title: ${item.title}
Snippet: ${snippet || "(no snippet)"}
Link: ${item.link}`;
    })
    .join("\n\n");

  return `You are a nutrition supplement intelligence expert. A user scanned a barcode ${barcode}.
You are given top web search results about this product. You must infer the most likely supplement brand, product name, and list of ingredients.

Return ONLY valid JSON matching this TypeScript interface:
{
  "brand": string | null,
  "productName": string | null,
  "summary": string | null,
  "confidence": number, // between 0 and 1
  "ingredients": Array<{ "name": string; "amount"?: string | null; "unit"?: string | null; "notes"?: string | null; }>,
  "sources": Array<{ "title": string; "link": string }>
}
Do not include markdown code fences. Base your reasoning only on the provided results. If data is missing, set fields to null and keep confidence low.

Web results:
${formatted}`;
};

const extractJson = (content: string): unknown => {
  const trimmed = content.trim();
  const fenceMatch = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const jsonText = fenceMatch ? fenceMatch[1].trim() : trimmed;
  return JSON.parse(jsonText);
};

const normalizeIngredients = (raw: unknown): AiIngredient[] => {
  if (!Array.isArray(raw)) return [];
  const ingredients = raw
    .map<AiIngredient | null>((item) => {
      if (!item || typeof item !== "object") return null;
      const obj = item as Record<string, unknown>;
      const name = typeof obj.name === "string" ? obj.name.trim() : "";
      if (!name) return null;
      const amount = typeof obj.amount === "string" ? obj.amount.trim() : undefined;
      const unit = typeof obj.unit === "string" ? obj.unit.trim() : undefined;
      const notes = typeof obj.notes === "string" ? obj.notes.trim() : undefined;
      return {
        name,
        amount: amount && amount.length ? amount : null,
        unit: unit && unit.length ? unit : null,
        notes: notes && notes.length ? notes : null,
      } satisfies AiIngredient;
    })
    .filter((item): item is AiIngredient => Boolean(item));

  return ingredients;
};

const normalizeSources = (raw: unknown, fallbackItems: SearchItem[]): Array<{ title: string; link: string }> => {
  if (!Array.isArray(raw)) {
    return fallbackItems.slice(0, 3).map(({ title, link }) => ({ title, link }));
  }

  const normalized = raw
    .map((item) => {
      if (!item || typeof item !== "object") return null;
      const obj = item as Record<string, unknown>;
      const title = typeof obj.title === "string" ? obj.title.trim() : "";
      const link = typeof obj.link === "string" ? obj.link.trim() : "";
      if (!title || !link) return null;
      return { title, link };
    })
    .filter((item): item is { title: string; link: string } => Boolean(item));

  return normalized.length ? normalized : fallbackItems.slice(0, 3).map(({ title, link }) => ({ title, link }));
};

export async function enrichSupplementFromSearch(barcode: string, items: SearchItem[]): Promise<AiSupplementAnalysis> {
  const apiKey = process.env.DEEPSEEK_API_KEY;
  if (!apiKey) {
    throw new Error("DEEPSEEK_API_KEY is not set");
  }

  const body = {
    model: DEEPSEEK_MODEL,
    messages: [
      { role: "system", content: "You are an expert supplement analyst." },
      { role: "user", content: buildPrompt(barcode, items) },
    ],
    temperature: 0.2,
  };

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
    throw new Error(`DeepSeek API error: ${response.status} ${detail}`);
  }

  const data = (await response.json()) as {
    choices?: Array<{ message?: { content?: string } }>;
    usage?: { prompt_tokens?: number; completion_tokens?: number };
  };

  const content = data.choices?.[0]?.message?.content;
  if (!content) {
    throw new Error("DeepSeek API did not return content");
  }

  const parsed = extractJson(content) as Record<string, unknown>;
  const brand = typeof parsed.brand === "string" ? parsed.brand.trim() : null;
  const productName = typeof parsed.productName === "string" ? parsed.productName.trim() : null;
  const summary = typeof parsed.summary === "string" ? parsed.summary.trim() : null;
  const confidenceRaw = typeof parsed.confidence === "number" ? parsed.confidence : Number(parsed.confidence);
  const confidence = Number.isFinite(confidenceRaw)
    ? Math.max(0, Math.min(1, Number(confidenceRaw)))
    : 0.1;

  const ingredients = normalizeIngredients(parsed.ingredients);
  const sources = normalizeSources(parsed.sources, items);

  return {
    barcode,
    brand,
    productName,
    summary,
    confidence,
    ingredients,
    sources,
  } satisfies AiSupplementAnalysis;
}
