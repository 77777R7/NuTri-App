import type { Express, Request, RequestHandler, Response } from "express";
import { createHash } from "node:crypto";
import { z } from "zod";

import { normalizeBarcodeInput, type NormalizedBarcode } from "../barcode.js";
import {
  compileIngredientOverviewAsync,
  INGREDIENT_OVERVIEW_PROMPT_VERSION,
  resolveIngredientOverviewExecutionProfile,
  type IngredientOverviewExecutionProfile,
} from "../insights/ingredientOverviewCompiler.js";
import {
  compileScientificBackgroundAsync,
  planScientificBackgroundSections,
  resolveScientificBackgroundExecutionProfile,
  SCIENTIFIC_BACKGROUND_PROMPT_VERSION,
  type ScientificBackgroundExecutionProfile,
} from "../insights/scientificBackgroundCompiler.js";
import {
  normalizeIngredientScienceKey,
  type IngredientScienceContext,
} from "../ingredientScienceContext.js";
import {
  buildScanSidecarCacheKey,
  getScanSidecarPolicy,
} from "../scanSidecarPolicy.js";
import {
  DEEPSEEK_NON_THINKING_MODE,
  resolveDeepSeekModel,
} from "../deepseekConfig.js";
import { recordScanSidecarCacheStatus } from "../scanSidecarRouteMetrics.js";
import type { ErrorResponse } from "../types.js";

type ParseRequestBody = <T>(schema: z.ZodType<T>, req: Request, res: Response) => T | null;

type ScienceSidecarAuthorityBundle = {
  decisionSupport: {
    digest: string;
    decisionInputsHash: string;
  };
  personalizationScopeHash: string;
  ingredientScienceContext: IngredientScienceContext;
};

export type ScienceSidecarRoutesDependencies = {
  verifySupabaseToken: RequestHandler;
  parseRequestBody: ParseRequestBody;
  buildDecisionSupportAuthorityBundle: (
    normalizedBarcode: NormalizedBarcode,
    options: { req: Request },
  ) => Promise<ScienceSidecarAuthorityBundle>;
  buildDecisionSupportDigestMismatchPayload: (
    latestDigest: string,
    latestDecisionInputsHash: string,
    latestPersonalizationScopeHash: string,
  ) => unknown;
  captureException: (error: unknown, context?: Record<string, unknown>) => void;
  env?: NodeJS.ProcessEnv;
  now?: () => number;
};

const ingredientOverviewBodySchema = z.object({
  barcode: z.string().trim().min(1),
  decisionDigest: z.string().trim().min(1).nullable().optional(),
  decisionInputsHash: z.string().trim().min(1).nullable().optional(),
  personalizationScopeHash: z.string().trim().min(1).nullable().optional(),
  authoritativeIdentityType: z.string().trim().min(1).nullable().optional(),
  authoritativeIdentityValue: z.string().trim().min(1).nullable().optional(),
  revalidateFallback: z.boolean().optional(),
  cacheOnly: z.boolean().optional(),
}).strict();

const scientificBackgroundBodySchema = z.object({
  barcode: z.string().trim().min(1),
  decisionDigest: z.string().trim().min(1).nullable().optional(),
  decisionInputsHash: z.string().trim().min(1).nullable().optional(),
  personalizationScopeHash: z.string().trim().min(1).nullable().optional(),
  authoritativeIdentityType: z.string().trim().min(1).nullable().optional(),
  authoritativeIdentityValue: z.string().trim().min(1).nullable().optional(),
  selectedIngredientName: z.string().trim().min(1),
  revalidateFallback: z.boolean().optional(),
  cacheOnly: z.boolean().optional(),
}).strict();

const SCIENCE_SIDECAR_MAX_RETRIES = 0;
const INGREDIENT_OVERVIEW_RESULT_CACHE_LIMIT = 120;
const INGREDIENT_OVERVIEW_FALLBACK_CACHE_TTL_MS = 90_000;
const INGREDIENT_OVERVIEW_REFRESH_RETRY_AFTER_MS = 2_500;
const INGREDIENT_OVERVIEW_REFRESH_FAILURE_COOLDOWN_MS = 45_000;
const INGREDIENT_OVERVIEW_REFRESH_FAILURE_RETRY_LIMIT = 3;
const INGREDIENT_OVERVIEW_REFRESH_MAX_CONCURRENCY = 2;
const SCIENTIFIC_BACKGROUND_RESULT_CACHE_LIMIT = 120;
const SCIENTIFIC_BACKGROUND_RESEARCH_FALLBACK_CACHE_TTL_MS = 90_000;
const SCIENTIFIC_BACKGROUND_REFRESH_RETRY_AFTER_MS = 2_500;
const SCIENTIFIC_BACKGROUND_REFRESH_FAILURE_COOLDOWN_MS = 45_000;
const SCIENTIFIC_BACKGROUND_REFRESH_FAILURE_RETRY_LIMIT = 3;
const SCIENTIFIC_BACKGROUND_REFRESH_MAX_CONCURRENCY = 2;

type ScientificBackgroundSidecarResponse = {
  status: "ok";
  digest: string;
  scientificBackground: Awaited<ReturnType<typeof compileScientificBackgroundAsync>>["scientificBackground"];
  source: Awaited<ReturnType<typeof compileScientificBackgroundAsync>>["source"];
  fallbackUsed: boolean;
  fallbackReason?: string;
  promptVersion: string;
  backgroundRefreshPending: boolean;
  recommendedRetryAfterMs: number | null;
};

type ScientificBackgroundSidecarCacheEntry = {
  expiresAt: number;
  payload: ScientificBackgroundSidecarResponse;
};

type IngredientOverviewSidecarResponse = {
  status: "ok";
  digest: string;
  ingredientOverview: Awaited<ReturnType<typeof compileIngredientOverviewAsync>>["ingredientOverview"];
  source: Awaited<ReturnType<typeof compileIngredientOverviewAsync>>["source"];
  fallbackUsed: boolean;
  fallbackReason?: string;
  promptVersion: string;
  backgroundRefreshPending: boolean;
  recommendedRetryAfterMs: number | null;
};

type IngredientOverviewSidecarCacheEntry = {
  expiresAt: number;
  payload: IngredientOverviewSidecarResponse;
};

const ingredientOverviewSidecarCache = new Map<string, IngredientOverviewSidecarCacheEntry>();
const scientificBackgroundSidecarCache = new Map<string, ScientificBackgroundSidecarCacheEntry>();
const ingredientOverviewSidecarBackgroundRefresh = new Map<string, Promise<void>>();
const ingredientOverviewSidecarBackgroundRefreshCooldownUntil = new Map<string, number>();
const ingredientOverviewSidecarBackgroundRefreshFailureCount = new Map<string, number>();
const scientificBackgroundSidecarInflight = new Map<string, Promise<ScientificBackgroundSidecarResponse>>();
const scientificBackgroundSidecarBackgroundRefresh = new Map<string, Promise<void>>();
const scientificBackgroundSidecarBackgroundRefreshCooldownUntil = new Map<string, number>();
const scientificBackgroundSidecarBackgroundRefreshFailureCount = new Map<string, number>();
let activeIngredientOverviewRefreshCount = 0;
const queuedIngredientOverviewRefreshTasks: Array<() => void> = [];
let activeScientificBackgroundRefreshCount = 0;
const queuedScientificBackgroundRefreshTasks: Array<() => void> = [];

const hashForLog = (value: string | null | undefined): string | null => {
  const normalized = String(value ?? "").trim();
  if (!normalized) return null;
  return createHash("sha256").update(normalized).digest("hex").slice(0, 12);
};

const logScienceSidecarEvent = (
  event: string,
  details: Record<string, unknown>,
): void => {
  console.info(`[SCIENCE_SIDECAR_${event}]`, {
    at: new Date().toISOString(),
    ...details,
  });
};

const buildIngredientOverviewRefreshLogContext = (params: {
  barcode: string;
  cacheKey: string;
  authority: ScienceSidecarAuthorityBundle;
  executionProfile: IngredientOverviewExecutionProfile;
}): Record<string, unknown> => ({
  route: "/api/ingredient-overview/v1",
  barcode: params.barcode,
  cacheKeyHash: hashForLog(params.cacheKey),
  digestHash: hashForLog(params.authority.decisionSupport.digest),
  decisionInputsHash: hashForLog(params.authority.decisionSupport.decisionInputsHash),
  personalizationScopeHash: hashForLog(params.authority.personalizationScopeHash),
  family: params.authority.ingredientScienceContext.ingredientFamily,
  archetype: params.authority.ingredientScienceContext.productArchetype,
  formulaMode: params.authority.ingredientScienceContext.formulaMode,
  sourceType: params.authority.ingredientScienceContext.sourceType,
  ingredientSourceTier: params.authority.ingredientScienceContext.ingredientSourceTier,
  timeoutMs: params.executionProfile.backgroundRefreshTimeoutMs,
  maxRetries: params.executionProfile.backgroundRefreshMaxRetries,
  maxTokens: params.executionProfile.maxTokens,
});

const buildIngredientOverviewSidecarCacheKey = (params: {
  barcode?: string;
  decisionDigest: string;
  decisionInputsHash: string;
  personalizationScopeHash: string;
}): string =>
  buildScanSidecarCacheKey({
    route: "ingredient_overview",
    barcode: params.barcode,
    decisionDigest: params.decisionDigest,
    decisionInputsHash: params.decisionInputsHash,
    personalizationScopeHash: params.personalizationScopeHash,
    promptVersion: INGREDIENT_OVERVIEW_PROMPT_VERSION,
  });

const readIngredientOverviewSidecarCache = (
  cacheKey: string,
  now: number,
): IngredientOverviewSidecarResponse | null => {
  const entry = ingredientOverviewSidecarCache.get(cacheKey);
  if (!entry) {
    recordScanSidecarCacheStatus("ingredient_overview", "miss");
    return null;
  }
  if (entry.expiresAt <= now) {
    ingredientOverviewSidecarCache.delete(cacheKey);
    recordScanSidecarCacheStatus("ingredient_overview", "stale");
    return null;
  }
  recordScanSidecarCacheStatus("ingredient_overview", "hit");
  return entry.payload;
};

const writeIngredientOverviewSidecarCache = (
  cacheKey: string,
  payload: IngredientOverviewSidecarResponse,
  ttlMs: number,
  now: number,
): void => {
  ingredientOverviewSidecarCache.set(cacheKey, {
    expiresAt: now + ttlMs,
    payload,
  });
  recordScanSidecarCacheStatus("ingredient_overview", "write");
  if (ingredientOverviewSidecarCache.size <= INGREDIENT_OVERVIEW_RESULT_CACHE_LIMIT) return;
  const oldestKey = ingredientOverviewSidecarCache.keys().next().value;
  if (typeof oldestKey === "string") {
    ingredientOverviewSidecarCache.delete(oldestKey);
  }
};

const resolveIngredientOverviewCacheTtlMs = (
  payload: IngredientOverviewSidecarResponse,
  executionProfile: IngredientOverviewExecutionProfile,
): number => {
  const policyTtlMs = getScanSidecarPolicy("ingredient_overview").defaultTtlMs;
  if (payload.source === "api") return executionProfile.cacheTtlMs || policyTtlMs;
  return INGREDIENT_OVERVIEW_FALLBACK_CACHE_TTL_MS;
};

const withIngredientOverviewRefreshHint = (
  payload: IngredientOverviewSidecarResponse,
  backgroundRefreshPending: boolean,
): IngredientOverviewSidecarResponse =>
  ({
    ...payload,
    backgroundRefreshPending: backgroundRefreshPending && payload.source === "fallback",
    recommendedRetryAfterMs:
      backgroundRefreshPending && payload.source === "fallback"
        ? INGREDIENT_OVERVIEW_REFRESH_RETRY_AFTER_MS
        : null,
  });

const runNextIngredientOverviewRefreshTask = (): void => {
  const next = queuedIngredientOverviewRefreshTasks.shift();
  if (!next) return;
  next();
};

const runWithIngredientOverviewRefreshSlot = async <T>(
  task: () => Promise<T>,
): Promise<T> =>
  new Promise<T>((resolve, reject) => {
    const run = () => {
      activeIngredientOverviewRefreshCount += 1;
      task()
        .then(resolve, reject)
        .finally(() => {
          activeIngredientOverviewRefreshCount = Math.max(0, activeIngredientOverviewRefreshCount - 1);
          runNextIngredientOverviewRefreshTask();
        });
    };

    if (activeIngredientOverviewRefreshCount < INGREDIENT_OVERVIEW_REFRESH_MAX_CONCURRENCY) {
      run();
      return;
    }

    queuedIngredientOverviewRefreshTasks.push(run);
  });

const isIngredientOverviewBackgroundRefreshCoolingDown = (cacheKey: string, now: number): boolean => {
  const cooldownUntil = ingredientOverviewSidecarBackgroundRefreshCooldownUntil.get(cacheKey);
  if (!cooldownUntil) return false;
  if (cooldownUntil <= now) {
    ingredientOverviewSidecarBackgroundRefreshCooldownUntil.delete(cacheKey);
    return false;
  }
  return true;
};

const markIngredientOverviewBackgroundRefreshCooldown = (cacheKey: string, now: number): void => {
  ingredientOverviewSidecarBackgroundRefreshCooldownUntil.set(
    cacheKey,
    now + INGREDIENT_OVERVIEW_REFRESH_FAILURE_COOLDOWN_MS,
  );
  if (ingredientOverviewSidecarBackgroundRefreshCooldownUntil.size <= INGREDIENT_OVERVIEW_RESULT_CACHE_LIMIT) return;
  const oldestKey = ingredientOverviewSidecarBackgroundRefreshCooldownUntil.keys().next().value;
  if (typeof oldestKey === "string") {
    ingredientOverviewSidecarBackgroundRefreshCooldownUntil.delete(oldestKey);
  }
};

const shouldCoolDownIngredientOverviewBackgroundRefresh = (cacheKey: string): boolean => {
  const nextFailureCount = (ingredientOverviewSidecarBackgroundRefreshFailureCount.get(cacheKey) ?? 0) + 1;
  ingredientOverviewSidecarBackgroundRefreshFailureCount.set(cacheKey, nextFailureCount);
  if (ingredientOverviewSidecarBackgroundRefreshFailureCount.size > INGREDIENT_OVERVIEW_RESULT_CACHE_LIMIT) {
    const oldestKey = ingredientOverviewSidecarBackgroundRefreshFailureCount.keys().next().value;
    if (typeof oldestKey === "string") {
      ingredientOverviewSidecarBackgroundRefreshFailureCount.delete(oldestKey);
    }
  }
  return nextFailureCount >= INGREDIENT_OVERVIEW_REFRESH_FAILURE_RETRY_LIMIT;
};

const runNextScientificBackgroundRefreshTask = (): void => {
  const next = queuedScientificBackgroundRefreshTasks.shift();
  if (!next) return;
  next();
};

const runWithScientificBackgroundRefreshSlot = async <T>(
  task: () => Promise<T>,
): Promise<T> =>
  new Promise<T>((resolve, reject) => {
    const run = () => {
      activeScientificBackgroundRefreshCount += 1;
      task()
        .then(resolve, reject)
        .finally(() => {
          activeScientificBackgroundRefreshCount = Math.max(0, activeScientificBackgroundRefreshCount - 1);
          runNextScientificBackgroundRefreshTask();
        });
    };

    if (activeScientificBackgroundRefreshCount < SCIENTIFIC_BACKGROUND_REFRESH_MAX_CONCURRENCY) {
      run();
      return;
    }

    queuedScientificBackgroundRefreshTasks.push(run);
  });

const isScientificBackgroundBackgroundRefreshCoolingDown = (cacheKey: string, now: number): boolean => {
  const cooldownUntil = scientificBackgroundSidecarBackgroundRefreshCooldownUntil.get(cacheKey);
  if (!cooldownUntil) return false;
  if (cooldownUntil <= now) {
    scientificBackgroundSidecarBackgroundRefreshCooldownUntil.delete(cacheKey);
    return false;
  }
  return true;
};

const markScientificBackgroundBackgroundRefreshCooldown = (cacheKey: string, now: number): void => {
  scientificBackgroundSidecarBackgroundRefreshCooldownUntil.set(
    cacheKey,
    now + SCIENTIFIC_BACKGROUND_REFRESH_FAILURE_COOLDOWN_MS,
  );
  if (scientificBackgroundSidecarBackgroundRefreshCooldownUntil.size <= SCIENTIFIC_BACKGROUND_RESULT_CACHE_LIMIT) return;
  const oldestKey = scientificBackgroundSidecarBackgroundRefreshCooldownUntil.keys().next().value;
  if (typeof oldestKey === "string") {
    scientificBackgroundSidecarBackgroundRefreshCooldownUntil.delete(oldestKey);
  }
};

const shouldCoolDownScientificBackgroundBackgroundRefresh = (
  cacheKey: string,
  retryLimit: number = SCIENTIFIC_BACKGROUND_REFRESH_FAILURE_RETRY_LIMIT,
): boolean => {
  const nextFailureCount = (scientificBackgroundSidecarBackgroundRefreshFailureCount.get(cacheKey) ?? 0) + 1;
  scientificBackgroundSidecarBackgroundRefreshFailureCount.set(cacheKey, nextFailureCount);
  if (scientificBackgroundSidecarBackgroundRefreshFailureCount.size > SCIENTIFIC_BACKGROUND_RESULT_CACHE_LIMIT) {
    const oldestKey = scientificBackgroundSidecarBackgroundRefreshFailureCount.keys().next().value;
    if (typeof oldestKey === "string") {
      scientificBackgroundSidecarBackgroundRefreshFailureCount.delete(oldestKey);
    }
  }
  return nextFailureCount >= retryLimit;
};

const readScientificBackgroundSidecarCache = (
  cacheKey: string,
  now: number,
): ScientificBackgroundSidecarResponse | null => {
  const entry = scientificBackgroundSidecarCache.get(cacheKey);
  if (!entry) {
    recordScanSidecarCacheStatus("scientific_background", "miss");
    return null;
  }
  if (entry.expiresAt <= now) {
    scientificBackgroundSidecarCache.delete(cacheKey);
    recordScanSidecarCacheStatus("scientific_background", "stale");
    return null;
  }
  recordScanSidecarCacheStatus("scientific_background", "hit");
  return entry.payload;
};

const buildScientificBackgroundSidecarCacheKey = (params: {
  barcode?: string;
  decisionDigest: string;
  decisionInputsHash: string;
  personalizationScopeHash: string;
  selectedIngredientKey: string;
  promptVersion: string;
}): string =>
  buildScanSidecarCacheKey({
    route: "scientific_background",
    barcode: params.barcode,
    decisionDigest: params.decisionDigest,
    decisionInputsHash: params.decisionInputsHash,
    personalizationScopeHash: params.personalizationScopeHash,
    selectedIngredientKey: params.selectedIngredientKey,
    promptVersion: params.promptVersion,
  });

const findScientificBackgroundSidecarCacheByRequest = (
  params: {
    barcode?: string;
    decisionDigest: string;
    decisionInputsHash: string;
    personalizationScopeHash: string;
    selectedIngredientKey: string;
  },
  now: number,
): { cacheKey: string; payload: ScientificBackgroundSidecarResponse } | null => {
  const prefix = buildScanSidecarCacheKey({
    route: "scientific_background",
    barcode: params.barcode,
    decisionDigest: params.decisionDigest,
    decisionInputsHash: params.decisionInputsHash,
    personalizationScopeHash: params.personalizationScopeHash,
    selectedIngredientKey: params.selectedIngredientKey,
  }) + "|";
  for (const [cacheKey, entry] of scientificBackgroundSidecarCache.entries()) {
    if (!cacheKey.startsWith(prefix)) continue;
    if (entry.expiresAt <= now) {
      scientificBackgroundSidecarCache.delete(cacheKey);
      recordScanSidecarCacheStatus("scientific_background", "stale");
      continue;
    }
    recordScanSidecarCacheStatus("scientific_background", "hit");
    return { cacheKey, payload: entry.payload };
  }
  recordScanSidecarCacheStatus("scientific_background", "miss");
  return null;
};

const writeScientificBackgroundSidecarCache = (
  cacheKey: string,
  payload: ScientificBackgroundSidecarResponse,
  ttlMs: number,
  now: number,
): void => {
  scientificBackgroundSidecarCache.set(cacheKey, {
    expiresAt: now + ttlMs,
    payload,
  });
  recordScanSidecarCacheStatus("scientific_background", "write");
  if (scientificBackgroundSidecarCache.size <= SCIENTIFIC_BACKGROUND_RESULT_CACHE_LIMIT) return;
  const oldestKey = scientificBackgroundSidecarCache.keys().next().value;
  if (typeof oldestKey === "string") {
    scientificBackgroundSidecarCache.delete(oldestKey);
  }
};

const resolveScientificBackgroundCacheTtlMs = (
  payload: ScientificBackgroundSidecarResponse,
  executionProfile: ScientificBackgroundExecutionProfile,
): number => {
  const policyTtlMs = getScanSidecarPolicy("scientific_background").defaultTtlMs;
  if (payload.source === "api") return executionProfile.cacheTtlMs || policyTtlMs;
  if (payload.scientificBackground.mode === "research_mode") {
    return SCIENTIFIC_BACKGROUND_RESEARCH_FALLBACK_CACHE_TTL_MS;
  }
  return executionProfile.cacheTtlMs || policyTtlMs;
};

const withScientificBackgroundRefreshHint = (
  payload: ScientificBackgroundSidecarResponse,
  backgroundRefreshPending: boolean,
): ScientificBackgroundSidecarResponse =>
  ({
    ...payload,
    backgroundRefreshPending: backgroundRefreshPending && payload.source === "fallback",
    recommendedRetryAfterMs:
      backgroundRefreshPending && payload.source === "fallback"
        ? SCIENTIFIC_BACKGROUND_REFRESH_RETRY_AFTER_MS
        : null,
  });

const buildDeepseekJsonLlmFn = (params: {
  deepseekKey: string | null;
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

const validateDecisionSupportDigestContract = (
  params: {
    parsedBody: {
      decisionDigest?: string | null;
      decisionInputsHash?: string | null;
      personalizationScopeHash?: string | null;
    };
    authority: ScienceSidecarAuthorityBundle;
    res: Response;
    buildMismatchPayload: ScienceSidecarRoutesDependencies["buildDecisionSupportDigestMismatchPayload"];
    route: string;
    barcode: string;
  },
): boolean => {
  const logDigestMismatch = (field: string, requested: string, actual: string): void => {
    logScienceSidecarEvent("CACHE_KEY_MISMATCH", {
      route: params.route,
      barcode: params.barcode,
      field,
      requestedHash: hashForLog(requested),
      actualHash: hashForLog(actual),
    });
  };
  if (
    params.parsedBody.decisionDigest
    && params.parsedBody.decisionDigest !== params.authority.decisionSupport.digest
  ) {
    logDigestMismatch(
      "decisionDigest",
      params.parsedBody.decisionDigest,
      params.authority.decisionSupport.digest,
    );
    params.res.status(409).json(
      params.buildMismatchPayload(
        params.authority.decisionSupport.digest,
        params.authority.decisionSupport.decisionInputsHash,
        params.authority.personalizationScopeHash,
      ),
    );
    return false;
  }
  if (
    params.parsedBody.decisionInputsHash
    && params.parsedBody.decisionInputsHash !== params.authority.decisionSupport.decisionInputsHash
  ) {
    logDigestMismatch(
      "decisionInputsHash",
      params.parsedBody.decisionInputsHash,
      params.authority.decisionSupport.decisionInputsHash,
    );
    params.res.status(409).json(
      params.buildMismatchPayload(
        params.authority.decisionSupport.digest,
        params.authority.decisionSupport.decisionInputsHash,
        params.authority.personalizationScopeHash,
      ),
    );
    return false;
  }
  if (
    params.parsedBody.personalizationScopeHash
    && params.parsedBody.personalizationScopeHash !== params.authority.personalizationScopeHash
  ) {
    logDigestMismatch(
      "personalizationScopeHash",
      params.parsedBody.personalizationScopeHash,
      params.authority.personalizationScopeHash,
    );
    params.res.status(409).json(
      params.buildMismatchPayload(
        params.authority.decisionSupport.digest,
        params.authority.decisionSupport.decisionInputsHash,
        params.authority.personalizationScopeHash,
      ),
    );
    return false;
  }
  return true;
};

export const registerScienceSidecarRoutes = (
  app: Express,
  deps: ScienceSidecarRoutesDependencies,
): void => {
  const env = deps.env ?? process.env;
  const now = deps.now ?? Date.now;
  logScienceSidecarEvent("ROUTES_REGISTERED", {
    ingredientOverviewFallbackTtlMs: INGREDIENT_OVERVIEW_FALLBACK_CACHE_TTL_MS,
    ingredientOverviewRefreshMaxConcurrency: INGREDIENT_OVERVIEW_REFRESH_MAX_CONCURRENCY,
    scientificBackgroundResearchFallbackTtlMs: SCIENTIFIC_BACKGROUND_RESEARCH_FALLBACK_CACHE_TTL_MS,
    scientificBackgroundRefreshMaxConcurrency: SCIENTIFIC_BACKGROUND_REFRESH_MAX_CONCURRENCY,
  });

  app.post("/api/ingredient-overview/v1", deps.verifySupabaseToken, async (req: Request, res: Response) => {
    const parsedBody = deps.parseRequestBody(ingredientOverviewBodySchema, req, res);
    if (!parsedBody) return;

    const normalizedBarcode = normalizeBarcodeInput(parsedBody.barcode);
    if (!normalizedBarcode) {
      return res
        .status(400)
        .json({ error: "invalid_request", detail: "barcode is required" } satisfies ErrorResponse);
    }

    try {
      if (
        parsedBody.revalidateFallback === true
        && parsedBody.decisionDigest
        && parsedBody.decisionInputsHash
        && parsedBody.personalizationScopeHash
      ) {
        const fastCacheKey = buildIngredientOverviewSidecarCacheKey({
          barcode: normalizedBarcode.code,
          decisionDigest: parsedBody.decisionDigest,
          decisionInputsHash: parsedBody.decisionInputsHash,
          personalizationScopeHash: parsedBody.personalizationScopeHash,
        });
        const fastCached = readIngredientOverviewSidecarCache(fastCacheKey, now());
        if (fastCached) {
          return res.json(
            withIngredientOverviewRefreshHint(
              fastCached,
              ingredientOverviewSidecarBackgroundRefresh.has(fastCacheKey),
            ),
          );
        }
      }

      const authority = await deps.buildDecisionSupportAuthorityBundle(normalizedBarcode, { req });
      const digestContractOk = validateDecisionSupportDigestContract({
        parsedBody,
        authority,
        res,
        buildMismatchPayload: deps.buildDecisionSupportDigestMismatchPayload,
        route: "/api/ingredient-overview/v1",
        barcode: normalizedBarcode.code,
      });
      if (!digestContractOk) return;

      const cacheKey = buildIngredientOverviewSidecarCacheKey({
        barcode: normalizedBarcode.code,
        decisionDigest: authority.decisionSupport.digest,
        decisionInputsHash: authority.decisionSupport.decisionInputsHash,
        personalizationScopeHash: authority.personalizationScopeHash,
      });
      const executionProfile = resolveIngredientOverviewExecutionProfile(authority.ingredientScienceContext);
      const deepseekKey = env.DEEPSEEK_API_KEY?.trim() || null;
      const deepseekModel = resolveDeepSeekModel(env.DEEPSEEK_MODEL);
      const shouldUseLiveWriter =
        authority.ingredientScienceContext.productArchetype !== "functional_food_like"
        && authority.ingredientScienceContext.ingredientFamily !== "green_tea_extract";
      const ingredientOverviewRefreshLogContext = buildIngredientOverviewRefreshLogContext({
        barcode: normalizedBarcode.code,
        cacheKey,
        authority,
        executionProfile,
      });
      const ensureIngredientOverviewBackgroundRefresh = (trigger: string): boolean => {
        if (!shouldUseLiveWriter || !deepseekKey) {
          logScienceSidecarEvent("INGREDIENT_REFRESH_SKIPPED", {
            ...ingredientOverviewRefreshLogContext,
            trigger,
            reason: !shouldUseLiveWriter ? "live_writer_disabled_for_context" : "llm_unconfigured",
          });
          return false;
        }
        if (ingredientOverviewSidecarBackgroundRefresh.has(cacheKey)) {
          logScienceSidecarEvent("INGREDIENT_REFRESH_DEDUPED", {
            ...ingredientOverviewRefreshLogContext,
            trigger,
            activeRefreshCount: activeIngredientOverviewRefreshCount,
            queuedRefreshCount: queuedIngredientOverviewRefreshTasks.length,
          });
          return true;
        }
        if (isIngredientOverviewBackgroundRefreshCoolingDown(cacheKey, now())) {
          logScienceSidecarEvent("INGREDIENT_REFRESH_SKIPPED", {
            ...ingredientOverviewRefreshLogContext,
            trigger,
            reason: "cooldown",
            failureCount: ingredientOverviewSidecarBackgroundRefreshFailureCount.get(cacheKey) ?? 0,
            cooldownUntilMs: ingredientOverviewSidecarBackgroundRefreshCooldownUntil.get(cacheKey) ?? null,
          });
          return false;
        }

        const scheduledAtMs = now();
        const queueDepthAtSchedule = queuedIngredientOverviewRefreshTasks.length;
        logScienceSidecarEvent("INGREDIENT_REFRESH_SCHEDULED", {
          ...ingredientOverviewRefreshLogContext,
          trigger,
          activeRefreshCount: activeIngredientOverviewRefreshCount,
          queuedRefreshCount: queueDepthAtSchedule,
        });
        const backgroundRefresh = runWithIngredientOverviewRefreshSlot(async (): Promise<void> => {
          const startedAtMs = now();
          const queueWaitMs = Math.max(0, startedAtMs - scheduledAtMs);
          const queuedTooLong =
            queueWaitMs > Math.max(
              executionProfile.backgroundRefreshTimeoutMs,
              INGREDIENT_OVERVIEW_FALLBACK_CACHE_TTL_MS,
            );
          logScienceSidecarEvent("INGREDIENT_REFRESH_START", {
            ...ingredientOverviewRefreshLogContext,
            trigger,
            queueWaitMs,
            queuedTooLong,
            queueDepthAtSchedule,
            activeRefreshCount: activeIngredientOverviewRefreshCount,
            queuedRefreshCount: queuedIngredientOverviewRefreshTasks.length,
          });
          const backgroundLlmFn = buildDeepseekJsonLlmFn({
            deepseekKey,
            deepseekModel,
            timeoutMs: executionProfile.backgroundRefreshTimeoutMs,
            maxTokens: executionProfile.maxTokens,
          });
          if (!backgroundLlmFn) return;

          const refreshed = await compileIngredientOverviewAsync(
            authority.ingredientScienceContext,
            {
              llmFn: backgroundLlmFn,
              timeoutMs: executionProfile.backgroundRefreshTimeoutMs,
              maxRetries: executionProfile.backgroundRefreshMaxRetries ?? SCIENCE_SIDECAR_MAX_RETRIES,
            },
          );

          const durationMs = Math.max(0, now() - startedAtMs);
          const refreshedPayload: IngredientOverviewSidecarResponse = {
            status: "ok",
            digest: authority.decisionSupport.digest,
            ingredientOverview: refreshed.ingredientOverview,
            source: refreshed.source,
            fallbackUsed: refreshed.fallbackUsed,
            fallbackReason: refreshed.diagnostics.fallbackReason ?? undefined,
            promptVersion: refreshed.promptVersion,
            backgroundRefreshPending: false,
            recommendedRetryAfterMs: null,
          };

          if (refreshed.source !== "api") {
            const shouldEnterCooldown = shouldCoolDownIngredientOverviewBackgroundRefresh(cacheKey);
            if (shouldEnterCooldown) {
              markIngredientOverviewBackgroundRefreshCooldown(cacheKey, now());
            }
            logScienceSidecarEvent("INGREDIENT_REFRESH_FALLBACK", {
              ...ingredientOverviewRefreshLogContext,
              trigger,
              durationMs,
              source: refreshed.source,
              fallbackReason: refreshed.diagnostics.fallbackReason,
              lastError: refreshed.diagnostics.lastError,
              attemptCount: refreshed.diagnostics.attemptCount,
              parseFailureCount: refreshed.diagnostics.parseFailureCount,
              gateRejectCount: refreshed.diagnostics.gateRejectCount,
              timeoutCount: refreshed.diagnostics.timeoutCount,
              errorCount: refreshed.diagnostics.errorCount,
              cooldownApplied: shouldEnterCooldown,
              failureCount: ingredientOverviewSidecarBackgroundRefreshFailureCount.get(cacheKey) ?? 0,
            });
          } else {
            ingredientOverviewSidecarBackgroundRefreshCooldownUntil.delete(cacheKey);
            ingredientOverviewSidecarBackgroundRefreshFailureCount.delete(cacheKey);
            logScienceSidecarEvent("INGREDIENT_REFRESH_SUCCESS", {
              ...ingredientOverviewRefreshLogContext,
              trigger,
              durationMs,
              source: refreshed.source,
              attemptCount: refreshed.diagnostics.attemptCount,
              parseFailureCount: refreshed.diagnostics.parseFailureCount,
              gateRejectCount: refreshed.diagnostics.gateRejectCount,
              timeoutCount: refreshed.diagnostics.timeoutCount,
              errorCount: refreshed.diagnostics.errorCount,
            });
          }

          const ttlMs = resolveIngredientOverviewCacheTtlMs(refreshedPayload, executionProfile);
          writeIngredientOverviewSidecarCache(
            cacheKey,
            refreshedPayload,
            ttlMs,
            now(),
          );
          logScienceSidecarEvent("INGREDIENT_REFRESH_CACHE_WRITE", {
            ...ingredientOverviewRefreshLogContext,
            trigger,
            source: refreshedPayload.source,
            fallbackReason: refreshedPayload.fallbackReason ?? null,
            ttlMs,
          });
        })
          .catch((error) => {
            logScienceSidecarEvent("INGREDIENT_REFRESH_ERROR", {
              ...ingredientOverviewRefreshLogContext,
              trigger,
              errorName: error instanceof Error ? error.name : "unknown",
              errorMessage: error instanceof Error ? error.message : String(error),
              activeRefreshCount: activeIngredientOverviewRefreshCount,
              queuedRefreshCount: queuedIngredientOverviewRefreshTasks.length,
            });
            deps.captureException(error, {
              route: "/api/ingredient-overview/v1",
              phase: "background_refresh",
              cacheKeyHash: hashForLog(cacheKey),
            });
          })
          .finally(() => {
            ingredientOverviewSidecarBackgroundRefresh.delete(cacheKey);
            logScienceSidecarEvent("INGREDIENT_REFRESH_FINISH", {
              ...ingredientOverviewRefreshLogContext,
              trigger,
              activeRefreshCount: activeIngredientOverviewRefreshCount,
              queuedRefreshCount: queuedIngredientOverviewRefreshTasks.length,
            });
          });

        ingredientOverviewSidecarBackgroundRefresh.set(cacheKey, backgroundRefresh);
        return true;
      };
      const buildIngredientOverviewFastFallbackResponse = async (
        fallbackReason: string,
        allowBackgroundRefresh: boolean,
      ): Promise<IngredientOverviewSidecarResponse> => {
        const compiled = await compileIngredientOverviewAsync(authority.ingredientScienceContext, {
          llmFn: undefined,
          timeoutMs: executionProfile.timeoutMs,
          maxRetries: 0,
        });
        const payload: IngredientOverviewSidecarResponse = {
          status: "ok",
          digest: authority.decisionSupport.digest,
          ingredientOverview: compiled.ingredientOverview,
          source: "fallback",
          fallbackUsed: true,
          fallbackReason,
          promptVersion: compiled.promptVersion,
          backgroundRefreshPending: false,
          recommendedRetryAfterMs: null,
        };
        writeIngredientOverviewSidecarCache(
          cacheKey,
          payload,
          resolveIngredientOverviewCacheTtlMs(payload, executionProfile),
          now(),
        );
        return withIngredientOverviewRefreshHint(
          payload,
          allowBackgroundRefresh
            ? ensureIngredientOverviewBackgroundRefresh(fallbackReason)
            : false,
        );
      };

      const cached = readIngredientOverviewSidecarCache(cacheKey, now());
      const shouldBypassFallbackCache =
        parsedBody.revalidateFallback === true && cached?.source === "fallback";
      if (cached && !shouldBypassFallbackCache) {
        return res.json(
          withIngredientOverviewRefreshHint(
            cached,
            ingredientOverviewSidecarBackgroundRefresh.has(cacheKey),
          ),
        );
      }
      if (shouldBypassFallbackCache) {
        const backgroundRefreshPending = ensureIngredientOverviewBackgroundRefresh("revalidate_fallback");
        if (cached) {
          return res.json(withIngredientOverviewRefreshHint(cached, backgroundRefreshPending));
        }
      }

      if (parsedBody.cacheOnly === true) {
        return res.json(await buildIngredientOverviewFastFallbackResponse("cache_only_miss", false));
      }

      return res.json(await buildIngredientOverviewFastFallbackResponse("background_refresh_scheduled", true));
    } catch (error) {
      deps.captureException(error, { route: "/api/ingredient-overview/v1" });
      const detail = error instanceof Error ? `${error.name}: ${error.message}` : String(error);
      return res.status(500).json({ error: "unexpected_error", detail } satisfies ErrorResponse);
    }
  });

  app.post("/api/scientific-background/v1", deps.verifySupabaseToken, async (req: Request, res: Response) => {
    const parsedBody = deps.parseRequestBody(scientificBackgroundBodySchema, req, res);
    if (!parsedBody) return;

    const normalizedBarcode = normalizeBarcodeInput(parsedBody.barcode);
    if (!normalizedBarcode) {
      return res
        .status(400)
        .json({ error: "invalid_request", detail: "barcode is required" } satisfies ErrorResponse);
    }

    try {
      const fastSelectedIngredientKey = normalizeIngredientScienceKey(parsedBody.selectedIngredientName);
      const fastCached =
        parsedBody.revalidateFallback === true
        && parsedBody.decisionDigest
        && parsedBody.decisionInputsHash
        && parsedBody.personalizationScopeHash
        && fastSelectedIngredientKey
          ? findScientificBackgroundSidecarCacheByRequest({
            barcode: normalizedBarcode.code,
            decisionDigest: parsedBody.decisionDigest,
            decisionInputsHash: parsedBody.decisionInputsHash,
            personalizationScopeHash: parsedBody.personalizationScopeHash,
            selectedIngredientKey: fastSelectedIngredientKey,
          }, now())
          : null;
      if (fastCached) {
        return res.json(
          withScientificBackgroundRefreshHint(
            fastCached.payload,
            scientificBackgroundSidecarBackgroundRefresh.has(fastCached.cacheKey),
          ),
        );
      }

      const authority = await deps.buildDecisionSupportAuthorityBundle(normalizedBarcode, { req });
      const digestContractOk = validateDecisionSupportDigestContract({
        parsedBody,
        authority,
        res,
        buildMismatchPayload: deps.buildDecisionSupportDigestMismatchPayload,
        route: "/api/scientific-background/v1",
        barcode: normalizedBarcode.code,
      });
      if (!digestContractOk) return;

      const selectedIngredientKey = normalizeIngredientScienceKey(parsedBody.selectedIngredientName);
      const selectedDescriptor = authority.ingredientScienceContext.ingredientDescriptors.find(
        (descriptor) => descriptor.key === selectedIngredientKey,
      );

      if (!selectedDescriptor) {
        return res.status(400).json({
          error: "invalid_request",
          detail: "selectedIngredientName must match a source-locked ingredient",
        } satisfies ErrorResponse);
      }

      const plan = planScientificBackgroundSections({
        context: authority.ingredientScienceContext,
        selectedIngredientName: selectedDescriptor.name,
      });
      const executionProfile = resolveScientificBackgroundExecutionProfile(plan);
      const cacheKey = buildScientificBackgroundSidecarCacheKey({
        barcode: normalizedBarcode.code,
        decisionDigest: authority.decisionSupport.digest,
        decisionInputsHash: authority.decisionSupport.decisionInputsHash,
        personalizationScopeHash: authority.personalizationScopeHash,
        selectedIngredientKey: selectedDescriptor.key,
        promptVersion: `${plan.mode}:${SCIENTIFIC_BACKGROUND_PROMPT_VERSION}`,
      });
      const deepseekKey = env.DEEPSEEK_API_KEY?.trim() || null;
      const deepseekModel = resolveDeepSeekModel(env.DEEPSEEK_MODEL);
      const ensureScientificBackgroundBackgroundRefresh = (): boolean => {
        if (!executionProfile.preferLiveWriter || !deepseekKey) return false;
        if (scientificBackgroundSidecarBackgroundRefresh.has(cacheKey)) return true;
        if (isScientificBackgroundBackgroundRefreshCoolingDown(cacheKey, now())) return false;

        const backgroundRefresh = runWithScientificBackgroundRefreshSlot(async (): Promise<void> => {
          const backgroundLlmFn = buildDeepseekJsonLlmFn({
            deepseekKey,
            deepseekModel,
            timeoutMs: executionProfile.backgroundRefreshTimeoutMs,
            maxTokens: executionProfile.maxTokens,
          });
          if (!backgroundLlmFn) return;

          const refreshed = await compileScientificBackgroundAsync(
            authority.ingredientScienceContext,
            selectedDescriptor.name,
            {
              llmFn: backgroundLlmFn,
              timeoutMs: executionProfile.backgroundRefreshTimeoutMs,
              maxRetries: executionProfile.backgroundRefreshMaxRetries ?? SCIENCE_SIDECAR_MAX_RETRIES,
            },
          );

          const refreshedPayload: ScientificBackgroundSidecarResponse = {
            status: "ok",
            digest: authority.decisionSupport.digest,
            scientificBackground: refreshed.scientificBackground,
            source: refreshed.source,
            fallbackUsed: refreshed.fallbackUsed,
            promptVersion: refreshed.promptVersion,
            backgroundRefreshPending: false,
            recommendedRetryAfterMs: null,
          };

          if (refreshed.source !== "api") {
            const refreshFailureRetryLimit =
              plan.family === "magnesium"
                || plan.family === "zinc"
                || plan.family === "carnitine"
                || plan.family === "green_tea_extract"
                ? 3
                : SCIENTIFIC_BACKGROUND_REFRESH_FAILURE_RETRY_LIMIT;
            if (shouldCoolDownScientificBackgroundBackgroundRefresh(
              cacheKey,
              refreshFailureRetryLimit,
            )) {
              markScientificBackgroundBackgroundRefreshCooldown(cacheKey, now());
            }
            writeScientificBackgroundSidecarCache(
              cacheKey,
              refreshedPayload,
              resolveScientificBackgroundCacheTtlMs(refreshedPayload, executionProfile),
              now(),
            );
            return;
          }

          scientificBackgroundSidecarBackgroundRefreshCooldownUntil.delete(cacheKey);
          scientificBackgroundSidecarBackgroundRefreshFailureCount.delete(cacheKey);
          writeScientificBackgroundSidecarCache(
            cacheKey,
            refreshedPayload,
            resolveScientificBackgroundCacheTtlMs(refreshedPayload, executionProfile),
            now(),
          );
        })
          .catch((error) => {
            deps.captureException(error, {
              route: "/api/scientific-background/v1",
              phase: "background_refresh",
              cacheKey,
            });
          })
          .finally(() => {
            scientificBackgroundSidecarBackgroundRefresh.delete(cacheKey);
          });

        scientificBackgroundSidecarBackgroundRefresh.set(cacheKey, backgroundRefresh);
        return true;
      };
      const buildScientificBackgroundFastFallbackResponse = async (): Promise<ScientificBackgroundSidecarResponse> => {
        const compiled = await compileScientificBackgroundAsync(
          authority.ingredientScienceContext,
          selectedDescriptor.name,
          {
            llmFn: undefined,
            timeoutMs: executionProfile.timeoutMs,
            maxRetries: 0,
          },
        );

        const payload: ScientificBackgroundSidecarResponse = {
          status: "ok",
          digest: authority.decisionSupport.digest,
          scientificBackground: compiled.scientificBackground,
          source: "fallback",
          fallbackUsed: true,
          promptVersion: compiled.promptVersion,
          backgroundRefreshPending: false,
          recommendedRetryAfterMs: null,
        };

        writeScientificBackgroundSidecarCache(
          cacheKey,
          payload,
          resolveScientificBackgroundCacheTtlMs(payload, executionProfile),
          now(),
        );

        return withScientificBackgroundRefreshHint(payload, ensureScientificBackgroundBackgroundRefresh());
      };
      const cached = readScientificBackgroundSidecarCache(cacheKey, now());
      const shouldBypassFallbackCache =
        parsedBody.revalidateFallback === true && cached?.source === "fallback";
      if (cached && !shouldBypassFallbackCache) {
        return res.json(cached);
      }
      if (shouldBypassFallbackCache) {
        const refreshedCached = readScientificBackgroundSidecarCache(cacheKey, now());
        if (refreshedCached && refreshedCached.source === "api") {
          return res.json(refreshedCached);
        }
        if (cached) {
          const backgroundRefreshPending = ensureScientificBackgroundBackgroundRefresh();
          return res.json(withScientificBackgroundRefreshHint(cached, backgroundRefreshPending));
        }
      }

      if (parsedBody.cacheOnly === true) {
        const compiled = await compileScientificBackgroundAsync(
          authority.ingredientScienceContext,
          selectedDescriptor.name,
          {
            llmFn: undefined,
            timeoutMs: executionProfile.timeoutMs,
            maxRetries: 0,
          },
        );
        return res.json({
          status: "ok",
          digest: authority.decisionSupport.digest,
          scientificBackground: compiled.scientificBackground,
          source: "fallback",
          fallbackUsed: true,
          fallbackReason: "cache_only_miss",
          promptVersion: compiled.promptVersion,
          backgroundRefreshPending: false,
          recommendedRetryAfterMs: null,
        } satisfies ScientificBackgroundSidecarResponse);
      }

      const existingInflight = scientificBackgroundSidecarInflight.get(cacheKey);
      if (existingInflight) {
        if (parsedBody.revalidateFallback === true) {
          return res.json(await buildScientificBackgroundFastFallbackResponse());
        }
        return res.json(await existingInflight);
      }
      if (parsedBody.revalidateFallback === true) {
        return res.json(await buildScientificBackgroundFastFallbackResponse());
      }
      const llmFn = executionProfile.preferLiveWriter
        ? buildDeepseekJsonLlmFn({
          deepseekKey,
          deepseekModel,
          timeoutMs: executionProfile.timeoutMs,
          maxTokens: executionProfile.maxTokens,
        })
        : undefined;

      const compilePromise = (async (): Promise<ScientificBackgroundSidecarResponse> => {
        const compiled = await compileScientificBackgroundAsync(
          authority.ingredientScienceContext,
          selectedDescriptor.name,
          {
            llmFn,
            timeoutMs: executionProfile.timeoutMs,
            maxRetries: executionProfile.maxRetries ?? SCIENCE_SIDECAR_MAX_RETRIES,
          },
        );

        const payload: ScientificBackgroundSidecarResponse = {
          status: "ok",
          digest: authority.decisionSupport.digest,
          scientificBackground: compiled.scientificBackground,
          source: compiled.source,
          fallbackUsed: compiled.fallbackUsed,
          promptVersion: compiled.promptVersion,
          backgroundRefreshPending: false,
          recommendedRetryAfterMs: null,
        };

        writeScientificBackgroundSidecarCache(
          cacheKey,
          payload,
          resolveScientificBackgroundCacheTtlMs(payload, executionProfile),
          now(),
        );

        if (payload.source === "fallback") {
          ensureScientificBackgroundBackgroundRefresh();
        }

        return withScientificBackgroundRefreshHint(
          payload,
          Boolean(payload.source === "fallback" && scientificBackgroundSidecarBackgroundRefresh.has(cacheKey)),
        );
      })();

      scientificBackgroundSidecarInflight.set(cacheKey, compilePromise);
      try {
        return res.json(await compilePromise);
      } finally {
        scientificBackgroundSidecarInflight.delete(cacheKey);
      }
    } catch (error) {
      deps.captureException(error, { route: "/api/scientific-background/v1" });
      const detail = error instanceof Error ? `${error.name}: ${error.message}` : String(error);
      return res.status(500).json({ error: "unexpected_error", detail } satisfies ErrorResponse);
    }
  });
};
