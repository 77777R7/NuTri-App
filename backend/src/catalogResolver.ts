import { supabase } from "./supabase.js";
import type { NormalizedBarcode } from "./barcode.js";
import {
  combineSignals,
  createTimeoutSignal,
  isAbortError,
  isRetryableStatus,
  withRetry,
  HttpError,
} from "./resilience.js";
import type { CircuitBreaker, DeadlineBudget, RetryOptions, Semaphore } from "./resilience.js";

export type CatalogResolved = {
  resolvedFrom: "override" | "dsld";
  barcodeGtin14: string;
  dsldLabelId: number | null;

  brand: string | null;
  productName: string | null;
  category: string | null;
  categoryRaw: string | null;
  form: string | null;

  servingSizeRaw: string | null;
  servingSizeCount: number | null;

  packageQuantity: number | null;
  packageUnit: string | null;
  servingsPerContainer: number | null;

  activeIngredientsSummary: string | null;
  inactiveIngredients: string | null;

  thirdPartyTesting: string | null;
  nsfCertifiedForSport: boolean | null;
  informedSport: boolean | null;
  ifosFishOil: boolean | null;
  cgmpCompliance: string | null;

  dsldPdf: string | null;
  dsldThumbnail: string | null;

  imageUrl: string | null;
};

const digitsOnly = (s: string) => s.replace(/\D/g, "");

type ResilienceOptions = {
  signal?: AbortSignal;
  timeoutMs?: number;
  budget?: DeadlineBudget;
  semaphore?: Semaphore;
  queueTimeoutMs?: number;
  breaker?: CircuitBreaker;
  retry?: Partial<RetryOptions>;
};

const shouldRetrySupabaseError = (error: { status?: number; message?: string } | null): boolean => {
  if (!error) return false;
  if (typeof error.status === "number") return isRetryableStatus(error.status);
  const message = error.message?.toLowerCase() ?? "";
  return message.includes("timeout") || message.includes("fetch") || message.includes("network");
};

export function toGtin14Variants(normalized: NormalizedBarcode): string[] {
  const set = new Set<string>();
  for (const v of normalized.variants) {
    const d = digitsOnly(String(v));
    if (!d) continue;
    if (d.length > 14) continue;
    const gtin14 = d.padStart(14, "0");
    if (/^\d{14}$/.test(gtin14)) set.add(gtin14);
  }
  // 保底：把 normalized.code 也加入
  const base = digitsOnly(normalized.code);
  if (base && base.length <= 14) set.add(base.padStart(14, "0"));

  return [...set];
}

export async function resolveCatalogByBarcode(
  normalized: NormalizedBarcode,
  options: ResilienceOptions = {},
): Promise<CatalogResolved | null> {
  const variants = toGtin14Variants(normalized);

  if (options.signal?.aborted) {
    return null;
  }
  if (options.breaker && !options.breaker.canRequest()) {
    return null;
  }

  const timeoutMs = options.timeoutMs ?? (options.budget ? options.budget.msLeft() : undefined);
  const budgetedTimeout =
    typeof timeoutMs === "number" && options.budget ? options.budget.msFor(timeoutMs) : timeoutMs;
  if (typeof budgetedTimeout === "number" && budgetedTimeout <= 0) {
    return null;
  }

  const attemptResolve = async (): Promise<{
    data: any;
    error: { message?: string; status?: number } | null;
    aborted: boolean;
  }> => {
    let release: (() => void) | null = null;
    if (options.semaphore) {
      try {
        release = await options.semaphore.acquire({
          timeoutMs: options.queueTimeoutMs ?? 0,
          signal: options.signal,
        });
      } catch {
        return { data: null, error: null, aborted: false };
      }
    }

    const timeoutSignal =
      typeof budgetedTimeout === "number" ? createTimeoutSignal(budgetedTimeout) : undefined;
    const { signal, cleanup } = combineSignals([options.signal, timeoutSignal]);

    try {
      const { data, error } = await supabase
        .rpc("resolve_catalog_by_variants", {
          p_variants: variants,
        })
        .abortSignal(signal);

      const aborted = Boolean(timeoutSignal?.aborted || signal.aborted);
      if (error && options.retry && shouldRetrySupabaseError(error)) {
        const rawStatus = (error as { status?: number }).status;
        const status = typeof rawStatus === "number" ? rawStatus : 503;
        throw new HttpError(status, error.message ?? "catalog_resolver_error");
      }

      if (!error) {
        options.breaker?.recordSuccess();
      } else if (!aborted && !isAbortError(error)) {
        options.breaker?.recordFailure();
      }

      return { data, error, aborted };
    } catch (err) {
      if (timeoutSignal?.aborted || signal.aborted || isAbortError(err)) {
        return { data: null, error: null, aborted: true };
      }
      options.breaker?.recordFailure();
      throw err;
    } finally {
      cleanup();
      release?.();
    }
  };

  let result: {
    data: any;
    error: { message?: string; status?: number } | null;
    aborted: boolean;
  };

  if (options.retry) {
    const retryConfig: RetryOptions = {
      maxAttempts: options.retry.maxAttempts ?? 2,
      baseDelayMs: options.retry.baseDelayMs ?? 100,
      maxDelayMs: options.retry.maxDelayMs ?? 300,
      jitterRatio: options.retry.jitterRatio ?? 0.3,
      shouldRetry: (error) => {
        if (isAbortError(error)) return false;
        if (error instanceof HttpError) return isRetryableStatus(error.status);
        return false;
      },
      signal: options.signal,
      budget: options.budget,
    };

    result = await withRetry(() => attemptResolve(), retryConfig).catch((error) => {
      if (!isAbortError(error)) {
        console.warn("[catalogResolver] rpc retry failed:", error);
      }
      return { data: null, error: null, aborted: false };
    });
  } else {
    result = await attemptResolve();
  }

  const { data, error, aborted } = result;
  if (error) {
    if (!aborted && !options.signal?.aborted) {
      console.warn("[catalogResolver] rpc error:", error.message);
    }
    return null;
  }
  if (!data || (Array.isArray(data) && data.length === 0)) return null;

  const row = Array.isArray(data) ? data[0] : data;

  return {
    resolvedFrom: row.resolved_from,
    barcodeGtin14: row.barcode_gtin14,
    dsldLabelId: row.dsld_label_id ?? null,

    brand: row.brand ?? null,
    productName: row.product_name ?? null,
    category: row.category ?? null,
    categoryRaw: row.category_raw ?? null,
    form: row.form ?? null,

    servingSizeRaw: row.serving_size_raw ?? null,
    servingSizeCount: row.serving_size_count ?? null,

    packageQuantity: row.package_quantity ?? null,
    packageUnit: row.package_unit ?? null,
    servingsPerContainer: row.servings_per_container ?? null,

    activeIngredientsSummary: row.active_ingredients_summary ?? null,
    inactiveIngredients: row.inactive_ingredients ?? null,

    thirdPartyTesting: row.third_party_testing ?? null,
    nsfCertifiedForSport: row.nsf_certified_for_sport ?? null,
    informedSport: row.informed_sport ?? null,
    ifosFishOil: row.ifos_fish_oil ?? null,
    cgmpCompliance: row.cgmp_compliance ?? null,

    dsldPdf: row.dsld_pdf ?? null,
    dsldThumbnail: row.dsld_thumbnail ?? null,

    imageUrl: row.image_url ?? null,
  };
}
