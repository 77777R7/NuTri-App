export const SCAN_SIDECAR_POLICY_SCHEMA_VERSION = 1;

export type ScanSidecarRoute =
  | "decision_support"
  | "scan_facts"
  | "ingredient_overview"
  | "scientific_background"
  | "product_overview_ai"
  | "summary_safety";

export type ScanSidecarPriority = "core" | "deferred" | "monitor_only";

export type ScanSidecarPolicy = {
  route: ScanSidecarRoute;
  priority: ScanSidecarPriority;
  cacheable: boolean;
  defaultTtlMs: number;
};

const MINUTE_MS = 60_000;

export const SCAN_SIDECAR_POLICIES: Record<ScanSidecarRoute, ScanSidecarPolicy> = {
  decision_support: {
    route: "decision_support",
    priority: "core",
    cacheable: false,
    defaultTtlMs: 0,
  },
  scan_facts: {
    route: "scan_facts",
    priority: "core",
    cacheable: false,
    defaultTtlMs: 0,
  },
  ingredient_overview: {
    route: "ingredient_overview",
    priority: "deferred",
    cacheable: true,
    defaultTtlMs: 15 * MINUTE_MS,
  },
  scientific_background: {
    route: "scientific_background",
    priority: "deferred",
    cacheable: true,
    defaultTtlMs: 30 * MINUTE_MS,
  },
  product_overview_ai: {
    route: "product_overview_ai",
    priority: "deferred",
    cacheable: true,
    defaultTtlMs: 15 * MINUTE_MS,
  },
  summary_safety: {
    route: "summary_safety",
    priority: "monitor_only",
    cacheable: false,
    defaultTtlMs: 0,
  },
};

const normalizePart = (value: unknown): string => String(value ?? "").trim();

const normalizeBarcodeForKey = (value: unknown): string => {
  const digits = normalizePart(value).replace(/\D/g, "");
  if (!digits) return "unknown";
  if (digits.length >= 14) return digits.slice(-14);
  return digits.padStart(14, "0");
};

export const getScanSidecarPolicy = (route: ScanSidecarRoute): ScanSidecarPolicy =>
  SCAN_SIDECAR_POLICIES[route];

export const buildScanSidecarCacheKey = (params: {
  route: ScanSidecarRoute;
  barcode?: unknown;
  decisionDigest?: unknown;
  decisionInputsHash?: unknown;
  personalizationScopeHash?: unknown;
  selectedIngredientKey?: unknown;
  promptVersion?: unknown;
}): string => {
  const parts = [
    `scan-sidecar:v${SCAN_SIDECAR_POLICY_SCHEMA_VERSION}`,
    params.route,
    `barcode=${normalizeBarcodeForKey(params.barcode)}`,
    `decision=${normalizePart(params.decisionDigest) || "none"}`,
    `inputs=${normalizePart(params.decisionInputsHash) || "none"}`,
    `scope=${normalizePart(params.personalizationScopeHash) || "none"}`,
  ];

  const selectedIngredientKey = normalizePart(params.selectedIngredientKey).toLowerCase();
  if (selectedIngredientKey) parts.push(`ingredient=${selectedIngredientKey}`);

  const promptVersion = normalizePart(params.promptVersion);
  if (promptVersion) parts.push(`prompt=${promptVersion}`);

  return parts.join("|");
};
