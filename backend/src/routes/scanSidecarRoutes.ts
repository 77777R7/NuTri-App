import { createHash } from "node:crypto";
import type { Express, Request, RequestHandler, Response } from "express";
import { z } from "zod";

import {
  fetchProductOverviewWhatIsIt,
  type ProductOverviewWhatIsIt,
} from "../deepseek.js";
import { lookupSafeScienceSignals } from "../kbRuntime.js";
import {
  passesProductOverviewWhatIsItGate,
  repairProductOverviewWhatIsItForGate,
} from "../insights/productOverviewAiGate.js";
import { buildProductOverviewWhatIsItFallback } from "../insights/productOverviewWhatIsItFallback.js";
import {
  DEEPSEEK_NON_THINKING_MODE,
  resolveDeepSeekModel,
} from "../deepseekConfig.js";
import {
  compileSafetySummaryAsync,
  compileUsageSummaryAsync,
  safetySummaryPacketSchema,
  usageSummaryPacketSchema,
} from "../insights/sectionSummaryCompiler.js";
import { compileIngredientSummaryAsync, ingredientSummaryPacketSchema } from "../insights/summaryCompiler.js";
import { buildScanSidecarCacheKey, getScanSidecarPolicy } from "../scanSidecarPolicy.js";
import { recordScanSidecarCacheStatus } from "../scanSidecarRouteMetrics.js";
import type { CircuitBreaker, Semaphore } from "../resilience.js";

type ParseRequestBody = <T>(schema: z.ZodType<T>, req: Request, res: Response) => T | null;

export type ScanSidecarRoutesDependencies = {
  verifySupabaseToken: RequestHandler;
  parseRequestBody: ParseRequestBody;
  applyLegacyShadowHeaders: (req: Request, res: Response, route: string) => unknown;
  isRegressionRequest: (req: Request) => boolean;
  captureException: (error: unknown, context?: Record<string, unknown>) => void;
  deepseekBreaker: CircuitBreaker;
  deepseekSemaphore: Semaphore;
  mySupplementOverviewTimeoutMs: number;
  detailQueueTimeoutMs: number;
  env?: NodeJS.ProcessEnv;
  now?: () => number;
};

const PRODUCT_OVERVIEW_WHAT_IS_IT_PROMPT_VERSION = "product_overview_what_is_it:v2";
const PRODUCT_OVERVIEW_AI_RESULT_CACHE_LIMIT = 120;

const productOverviewAiBodySchema = z.object({
  digest: z.string().min(1),
  productName: z.string().min(1),
  brandName: z.string().nullable().optional(),
  productTypeHint: z.string().nullable().optional(),
  primaryIngredient: z.string().nullable().optional(),
  keyIngredients: z.array(
    z.object({
      name: z.string().min(1),
      dose: z.string().nullable().optional(),
    }),
  ).max(6),
  sourceContextHint: z.string().nullable().optional(),
  chemicalFormHint: z.string().nullable().optional(),
  allIngredientRows: z.array(
    z.object({
      name: z.string().min(1),
      dose: z.string().nullable().optional(),
    }),
  ).max(12).optional(),
  descriptionHighlights: z.array(z.string().min(1)).max(4).optional(),
  warningHighlights: z.array(z.string().min(1)).max(4).optional(),
  strengthClaim: z.string().nullable().optional(),
  servingStrength: z.string().nullable().optional(),
  form: z.string().nullable().optional(),
  count: z.string().nullable().optional(),
  isLikelySingleIngredient: z.boolean().optional(),
  cacheOnly: z.boolean().optional(),
});

type ProductOverviewAiBody = z.infer<typeof productOverviewAiBodySchema>;

type ProductOverviewAiSidecarResponse = {
  status: "ok";
  digest: string;
  source: "api" | "fallback";
  promptVersion: string;
  fallbackUsed: boolean;
  fallbackReason?: string;
  overviewAi: ReturnType<typeof buildProductOverviewWhatIsItFallback> | ProductOverviewWhatIsIt;
};

const productOverviewAiSidecarCache = new Map<string, {
  expiresAt: number;
  payload: ProductOverviewAiSidecarResponse;
}>();

const stableStringifyScopeValue = (value: unknown): string => {
  if (value == null) return "null";
  if (typeof value === "number" || typeof value === "boolean") return JSON.stringify(value);
  if (typeof value === "string") return JSON.stringify(value);
  if (Array.isArray(value)) {
    return `[${value.map((item) => stableStringifyScopeValue(item)).join(",")}]`;
  }
  if (typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, itemValue]) => itemValue !== undefined)
      .sort(([left], [right]) => left.localeCompare(right));
    return `{${entries
      .map(([key, itemValue]) => `${JSON.stringify(key)}:${stableStringifyScopeValue(itemValue)}`)
      .join(",")}}`;
  }
  return JSON.stringify(String(value));
};

const buildProductOverviewAiSidecarCacheKey = (params: {
  decisionDigest: string;
  promptPayload: unknown;
}): string =>
  buildScanSidecarCacheKey({
    route: "product_overview_ai",
    decisionDigest: params.decisionDigest,
    decisionInputsHash: createHash("sha256")
      .update(stableStringifyScopeValue(params.promptPayload))
      .digest("hex"),
    personalizationScopeHash: "none",
    promptVersion: PRODUCT_OVERVIEW_WHAT_IS_IT_PROMPT_VERSION,
  });

const readProductOverviewAiSidecarCache = (
  cacheKey: string,
  now: number,
): ProductOverviewAiSidecarResponse | null => {
  const entry = productOverviewAiSidecarCache.get(cacheKey);
  if (!entry) {
    recordScanSidecarCacheStatus("product_overview_ai", "miss");
    return null;
  }
  if (entry.expiresAt <= now) {
    productOverviewAiSidecarCache.delete(cacheKey);
    recordScanSidecarCacheStatus("product_overview_ai", "stale");
    return null;
  }
  recordScanSidecarCacheStatus("product_overview_ai", "hit");
  return entry.payload;
};

const writeProductOverviewAiSidecarCache = (
  cacheKey: string,
  payload: ProductOverviewAiSidecarResponse,
  now: number,
): void => {
  productOverviewAiSidecarCache.set(cacheKey, {
    expiresAt: now + getScanSidecarPolicy("product_overview_ai").defaultTtlMs,
    payload,
  });
  recordScanSidecarCacheStatus("product_overview_ai", "write");
  if (productOverviewAiSidecarCache.size <= PRODUCT_OVERVIEW_AI_RESULT_CACHE_LIMIT) return;
  const oldestKey = productOverviewAiSidecarCache.keys().next().value;
  if (typeof oldestKey === "string") {
    productOverviewAiSidecarCache.delete(oldestKey);
  }
};

const buildDeepseekJsonLlmFn = (params: {
  deepseekKey: string | undefined;
  deepseekModel: string;
  timeoutMs: number;
  maxTokens: number;
}): ((prompt: string) => Promise<string>) | undefined => {
  if (!params.deepseekKey) return undefined;

  return async (prompt: string): Promise<string> => {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), params.timeoutMs);
    try {
      const response = await fetch("https://api.deepseek.com/v1/chat/completions", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${params.deepseekKey}`,
        },
        body: JSON.stringify({
          model: params.deepseekModel,
          messages: [
            {
              role: "system",
              content:
                "Return ONLY a valid JSON object. No markdown. No commentary. No code fences.",
            },
            { role: "user", content: prompt },
          ],
          temperature: 0.1,
          thinking: DEEPSEEK_NON_THINKING_MODE,
          stream: false,
          max_tokens: params.maxTokens,
          response_format: { type: "json_object" },
        }),
        signal: controller.signal,
      });

      if (!response.ok) {
        throw new Error(`deepseek_http_${response.status}`);
      }

      const payload = (await response.json()) as {
        choices?: Array<{ message?: { content?: string } }>;
      };
      const content = payload.choices?.[0]?.message?.content;
      if (typeof content !== "string" || content.trim().length === 0) {
        throw new Error("deepseek_empty_content");
      }
      return content;
    } finally {
      clearTimeout(timer);
    }
  };
};

const buildProductOverviewPromptPayload = (parsedBody: ProductOverviewAiBody) => ({
  productName: parsedBody.productName,
  brandName: parsedBody.brandName ?? null,
  productTypeHint: parsedBody.productTypeHint ?? null,
  primaryIngredient: parsedBody.primaryIngredient ?? null,
  keyIngredients: parsedBody.keyIngredients.map((item) => ({
    name: item.name,
    dose: item.dose ?? null,
  })),
  sourceContextHint: parsedBody.sourceContextHint ?? null,
  chemicalFormHint: parsedBody.chemicalFormHint ?? null,
  allIngredientRows: (parsedBody.allIngredientRows ?? []).map((item) => ({
    name: item.name,
    dose: item.dose ?? null,
  })),
  descriptionHighlights: parsedBody.descriptionHighlights ?? [],
  warningHighlights: parsedBody.warningHighlights ?? [],
  strengthClaim: parsedBody.strengthClaim ?? null,
  servingStrength: parsedBody.servingStrength ?? null,
  form: parsedBody.form ?? null,
  count: parsedBody.count ?? null,
  isLikelySingleIngredient: parsedBody.isLikelySingleIngredient ?? false,
  writingRules: {
    language: "English only",
    shopperFacing: true,
    doNotRepeatFacts: ["serving strength", "form", "count"],
    noMedicalClaims: true,
    noDoctorAdvice: true,
    noTimingGuidance: true,
    richModeOnlyWhenSimple: true,
  },
});

const dedupeSummaryBullets = (rows: string[], max = 6): string[] => {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const row of rows) {
    const text = String(row ?? "").trim();
    if (!text) continue;
    const key = text.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(text);
    if (out.length >= max) break;
  }
  return out;
};

export const registerScanSidecarRoutes = (
  app: Express,
  deps: ScanSidecarRoutesDependencies,
): void => {
  const env = deps.env ?? process.env;
  const now = deps.now ?? Date.now;

  app.post("/api/product-overview-ai/v1", deps.verifySupabaseToken, async (req: Request, res: Response) => {
    const parsedBody = deps.parseRequestBody(productOverviewAiBodySchema, req, res);
    if (!parsedBody) return;

    const deepseekKey = env.DEEPSEEK_API_KEY?.trim();
    const deepseekModel = resolveDeepSeekModel(env.DEEPSEEK_MODEL);

    const fallbackOverviewAi = buildProductOverviewWhatIsItFallback({
      productName: parsedBody.productName,
      brandName: parsedBody.brandName ?? null,
      productTypeHint: parsedBody.productTypeHint ?? null,
      primaryIngredient: parsedBody.primaryIngredient ?? null,
      keyIngredients: parsedBody.keyIngredients,
      sourceContextHint: parsedBody.sourceContextHint ?? null,
      chemicalFormHint: parsedBody.chemicalFormHint ?? null,
      allIngredientRows: parsedBody.allIngredientRows ?? [],
      descriptionHighlights: parsedBody.descriptionHighlights ?? [],
      warningHighlights: parsedBody.warningHighlights ?? [],
      isLikelySingleIngredient: parsedBody.isLikelySingleIngredient ?? false,
    });

    const promptPayload = buildProductOverviewPromptPayload(parsedBody);
    const cacheKey = buildProductOverviewAiSidecarCacheKey({
      decisionDigest: parsedBody.digest,
      promptPayload,
    });
    const cached = readProductOverviewAiSidecarCache(cacheKey, now());
    if (cached) {
      return res.json(cached);
    }

    if (parsedBody.cacheOnly === true) {
      return res.json({
        status: "ok",
        digest: parsedBody.digest,
        source: "fallback",
        promptVersion: `${PRODUCT_OVERVIEW_WHAT_IS_IT_PROMPT_VERSION}:cache-only-fallback`,
        fallbackUsed: true,
        fallbackReason: "cache_only_miss",
        overviewAi: fallbackOverviewAi,
      } satisfies ProductOverviewAiSidecarResponse);
    }

    const respondWithOverviewFallback = (reason: string) => {
      const payload: ProductOverviewAiSidecarResponse = {
        status: "ok",
        digest: parsedBody.digest,
        source: "fallback",
        promptVersion: `${PRODUCT_OVERVIEW_WHAT_IS_IT_PROMPT_VERSION}:fallback`,
        fallbackUsed: true,
        fallbackReason: reason,
        overviewAi: fallbackOverviewAi,
      };
      writeProductOverviewAiSidecarCache(cacheKey, payload, now());
      return res.json(payload);
    };

    if (!deepseekKey) {
      return respondWithOverviewFallback("ai_not_configured");
    }

    try {
      const ai = await fetchProductOverviewWhatIsIt(
        `PRODUCT_OVERVIEW_INPUT_JSON: ${JSON.stringify(promptPayload)}`,
        deepseekModel,
        deepseekKey,
        {
          timeoutMs: Math.max(deps.mySupplementOverviewTimeoutMs, 5_500),
          queueTimeoutMs: deps.detailQueueTimeoutMs,
          breaker: deps.deepseekBreaker,
          semaphore: deps.deepseekSemaphore,
          maxTokens: 900,
        },
      );

      if (!ai) {
        return respondWithOverviewFallback("empty_or_failed");
      }

      const gateInputs = {
        primaryIngredient: parsedBody.primaryIngredient ?? null,
        productTypeHint: parsedBody.productTypeHint ?? null,
        keyIngredients: parsedBody.keyIngredients,
        allIngredientRows: parsedBody.allIngredientRows ?? [],
        servingStrength: parsedBody.servingStrength ?? null,
        form: parsedBody.form ?? null,
        count: parsedBody.count ?? null,
      };
      const repairedAi = repairProductOverviewWhatIsItForGate(ai, gateInputs);
      if (!repairedAi) {
        return respondWithOverviewFallback("gate_rejected");
      }

      const payload: ProductOverviewAiSidecarResponse = {
        status: "ok",
        digest: parsedBody.digest,
        source: "api",
        promptVersion: passesProductOverviewWhatIsItGate({ ...gateInputs, ...ai })
          ? PRODUCT_OVERVIEW_WHAT_IS_IT_PROMPT_VERSION
          : `${PRODUCT_OVERVIEW_WHAT_IS_IT_PROMPT_VERSION}:safe-repair`,
        fallbackUsed: false,
        overviewAi: repairedAi,
      };
      writeProductOverviewAiSidecarCache(cacheKey, payload, now());
      return res.json(payload);
    } catch (error) {
      deps.captureException(error, { route: "/api/product-overview-ai/v1" });
      return respondWithOverviewFallback("unexpected_error");
    }
  });

  app.post("/api/summary/ingredient", deps.verifySupabaseToken, async (req: Request, res: Response) => {
    deps.applyLegacyShadowHeaders(req, res, "/api/summary/ingredient");
    const packet = deps.parseRequestBody(ingredientSummaryPacketSchema, req, res);
    if (!packet) return;

    const llmFn = buildDeepseekJsonLlmFn({
      deepseekKey: env.DEEPSEEK_API_KEY?.trim(),
      deepseekModel: resolveDeepSeekModel(env.DEEPSEEK_MODEL),
      timeoutMs: 9_000,
      maxTokens: 450,
    });

    const ingredientNameForSafe = typeof (packet as { ingredientName?: unknown })?.ingredientName === "string"
      ? String((packet as { ingredientName?: string }).ingredientName)
      : typeof (packet as { ingredient?: { name?: unknown } })?.ingredient?.name === "string"
        ? String((packet as { ingredient?: { name?: string } }).ingredient?.name)
        : null;
    const formTextForSafe = typeof (packet as { facts?: { formText?: unknown } })?.facts?.formText === "string"
      ? String((packet as { facts?: { formText?: string } }).facts?.formText)
      : typeof (packet as { ingredient?: { form?: unknown } })?.ingredient?.form === "string"
        ? String((packet as { ingredient?: { form?: string } }).ingredient?.form)
        : null;
    const safeScience = lookupSafeScienceSignals({
      ingredientName: ingredientNameForSafe,
      formText: formTextForSafe,
    });

    let packetForCompile: unknown = packet;
    if (safeScience && (Object.prototype.hasOwnProperty.call(packet as object, "ingredientName"))) {
      const packetObj = { ...(packet as Record<string, unknown>) };
      const existingSupport = Array.isArray(packetObj.supportBullets)
        ? (packetObj.supportBullets as unknown[]).map((row) => String(row ?? ""))
        : [];
      packetObj.supportBullets = dedupeSummaryBullets([
        ...safeScience.bestForBullets,
        ...existingSupport,
      ], 6);
      packetObj.safeScienceBullets = safeScience.bestForBullets.slice(0, 6);
      packetObj.safeScienceFormImpact = safeScience.formImpactLine;
      packetObj.safeScienceBeforeYouBuy = safeScience.beforeYouBuyLine;
      packetObj.safeScienceSignalSource = safeScience.signalSource;
      packetObj.safeScienceFallbackType = safeScience.fallbackType;
      packetForCompile = packetObj;
    }

    const summary = await compileIngredientSummaryAsync(packetForCompile, {
      llmFn,
      regression: deps.isRegressionRequest(req),
    });

    return res.json({
      status: "ok",
      ...summary,
      summary,
    });
  });

  app.post("/api/summary/usage", deps.verifySupabaseToken, async (req: Request, res: Response) => {
    deps.applyLegacyShadowHeaders(req, res, "/api/summary/usage");
    const packet = deps.parseRequestBody(usageSummaryPacketSchema, req, res);
    if (!packet) return;

    const llmFn = buildDeepseekJsonLlmFn({
      deepseekKey: env.DEEPSEEK_API_KEY?.trim(),
      deepseekModel: resolveDeepSeekModel(env.DEEPSEEK_MODEL),
      timeoutMs: 9_000,
      maxTokens: 260,
    });

    const summary = await compileUsageSummaryAsync(packet, { llmFn });
    return res.json({
      status: "ok",
      ...summary,
      summary,
    });
  });

  app.post("/api/summary/safety", deps.verifySupabaseToken, async (req: Request, res: Response) => {
    deps.applyLegacyShadowHeaders(req, res, "/api/summary/safety");
    const packet = deps.parseRequestBody(safetySummaryPacketSchema, req, res);
    if (!packet) return;

    const startedAt = now();
    const llmFn = buildDeepseekJsonLlmFn({
      deepseekKey: env.DEEPSEEK_API_KEY?.trim(),
      deepseekModel: resolveDeepSeekModel(env.DEEPSEEK_MODEL),
      timeoutMs: 3_900,
      maxTokens: 260,
    });

    const summary = await compileSafetySummaryAsync(packet, { llmFn, timeoutMs: 3500, maxRetries: 0 });
    const latencyMs = now() - startedAt;
    console.info(
      "[summary/safety]",
      JSON.stringify({
        latencyMs,
        fallbackUsed: summary.fallbackUsed,
        reasonCode: summary.reasonCode,
        sourceType: packet.sourceType ?? null,
      }),
    );
    return res.json({
      status: "ok",
      latencyMs,
      ...summary,
      summary,
    });
  });
};
