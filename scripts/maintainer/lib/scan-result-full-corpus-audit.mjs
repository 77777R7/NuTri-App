/* eslint-disable no-console */

import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import dotenv from "dotenv";

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
export const ROOT_DIR = path.resolve(SCRIPT_DIR, "../../..");
export const DEFAULT_AUDIT_BASE_URL = "https://nutri-app-qn0u.onrender.com";
export const DEFAULT_OUTPUT_ROOT = path.join(ROOT_DIR, "output", "scan-result-full-corpus-audit");

const PLACEHOLDER_PATTERN = /\b(?:unavailable|not available|not provided|undefined|null|\[object object\]|pending|skeleton|n\/a)\b/i;
const UNSAFE_OVERCLAIM_PATTERN = /\b(?:cures?|treats?|treating|prevents?|prevention|guarantees?|detoxifies|boosts everything|safe for everyone|no side effects|replaces medication|clinically proven)\b/i;
const GENERIC_WELLNESS_PATTERN = /\b(?:overall wellness|general wellness|daily wellness|wellness routine|broad support|supports health|supports your body)\b/i;
const EVIDENCE_BOUNDARY_PATTERN = /\b(?:evidence|research|stud(?:y|ies)|trial|review|meta-analysis|mixed|limited|stronger|boundary|depends|context|label-context|comparison|compare|uncertain)\b/i;
const SHOPPER_MEANING_PATTERN = /\b(?:compare|shopping|shopper|label|look for|check|what this means|when comparing|source|form|dose|serving|ingredient line)\b/i;
const DOSAGE_PATTERN = /\b\d+(?:\.\d+)?\s*(?:mg|mcg|µg|g|iu|ml|cfu|billion|million)\b|\b(?:once|twice|daily|per day|serving|capsule|tablet|softgel|scoop|drop)\b/i;

const MACRO_NUTRIENT_PATTERN = /^(?:calories?|energy|total\s+fat|saturated\s+fat|trans\s+fat|cholesterol|sodium|potassium|total\s+carbohydrates?|carbohydrates?|dietary\s+fib(?:er|re)|fib(?:er|re)|total\s+sugars?|added\s+sugars?|protein)$/i;

export const isMacroNutrientName = (value) => MACRO_NUTRIENT_PATTERN.test(safeText(value));

const FAMILY_PATTERNS = [
  ["omega_3", /\b(?:omega[\s-]*3|fish oil|epa|dha|docosahexaenoic|eicosapentaenoic)\b/i],
  ["magnesium", /\bmagnesium\b/i],
  ["iron", /\biron\b|ferrous|ferric/i],
  ["vitamin_c", /\bvitamin\s*c\b|ascorbic/i],
  ["vitamin_d", /\bvitamin\s*d\b|cholecalciferol|ergocalciferol/i],
  ["calcium", /\bcalcium\b/i],
  ["zinc", /\bzinc\b/i],
  ["melatonin", /\bmelatonin\b/i],
  ["b12", /\b(?:vitamin\s*b\s*12|b\s*12|cyanocobalamin|methylcobalamin|cobalamin)\b/i],
  ["folate", /\b(?:folate|folic acid|methylfolate|5-mthf)\b/i],
  ["b6", /\b(?:vitamin\s*b\s*6|b\s*6|pyridoxine|pyridoxal)\b/i],
  ["protein", /\b(?:protein|whey|casein|pea protein|rice protein|hemp protein)\b/i],
  ["fiber", /\b(?:fiber|fibre|psyllium|inulin|glucomannan)\b/i],
  ["curcumin", /\bcurcumin\b/i],
  ["turmeric", /\bturmeric\b/i],
  ["coq10", /\b(?:coq10|co-q10|coenzyme q10|ubiquinol|ubiquinone)\b/i],
  ["creatine", /\bcreatine\b/i],
  ["berberine", /\bberberine\b/i],
  ["nac", /\b(?:nac|n-acetyl\s*cysteine|n acetyl cysteine)\b/i],
  ["collagen", /\bcollagen\b/i],
  ["electrolyte_hydration", /\b(?:electrolyte|hydration|sodium|potassium|chloride)\b/i],
  ["ashwagandha", /\b(?:ashwagandha|withania|ksm-?66|sensoril)\b/i],
  ["ginseng", /\b(?:ginseng|panax|american ginseng)\b/i],
  ["green_tea_extract", /\b(?:green tea|egcg|camellia sinensis|matcha)\b/i],
  ["astaxanthin_carotenoid", /\bastaxanthin\b/i],
  ["cla", /\b(?:cla|conjugated linoleic acid|tonalin)\b/i],
  ["carnitine", /\bcarnitine\b/i],
  ["5htp", /\b(?:5[\s-]*htp|5[\s-]*hydroxytryptophan)\b/i],
  ["b3_niacinamide", /\b(?:niacinamide|niacin|vitamin\s*b\s*3|b\s*3)\b/i],
  ["glycine", /\bglycine\b/i],
  ["taurine", /\btaurine\b/i],
  ["inositol", /\binositol\b/i],
  ["probiotic_or_blend", /\b(?:probiotic|lactobacillus|bifidobacterium|saccharomyces|cfu)\b/i],
  ["quercetin", /\bquercetin\b/i],
  ["vitamin_e", /\b(?:vitamin\s*e|tocopherol|tocotrienol)\b/i],
  ["vitamin_k2", /\b(?:vitamin\s*k\s*2|mk-7|menaquinone)\b/i],
  ["vitamin_k1", /\b(?:vitamin\s*k\s*1|phylloquinone)\b/i],
  ["chromium", /\bchromium\b/i],
  ["selenium", /\bselenium\b/i],
  ["alpha_lipoic_acid", /\b(?:alpha lipoic|alpha-lipoic|ala)\b/i],
  ["biotin", /\bbiotin\b/i],
  ["copper", /\bcopper\b/i],
  ["riboflavin", /\b(?:riboflavin|vitamin\s*b\s*2|b\s*2)\b/i],
  ["aloe_vera", /\baloe\b/i],
  ["same", /\b(?:sam-?e|s-adenosyl(?:\s|-)?methionine)\b/i],
  ["tocotrienols", /\btocotrienol/i],
  ["devil_s_claw", /\bdevil'?s claw\b|harpagophytum/i],
  ["schisandra_chinensis", /\bschisandra\b/i],
  ["red_yeast_rice", /\bred yeast rice\b|monacolin/i],
  ["pygeum", /\bpygeum\b/i],
  ["milk_thistle", /\bmilk thistle\b|silymarin/i],
  ["tribulus", /\btribulus\b/i],
  ["chaga_mushroom", /\bchaga\b/i],
  ["nadh", /\bnadh\b/i],
  ["garlic", /\bgarlic\b/i],
  ["ginger", /\bginger\b/i],
  ["resveratrol", /\bresveratrol\b/i],
  ["gaba", /\bgaba\b|gamma aminobutyric/i],
  ["msm", /\bmsm\b|methylsulfonylmethane/i],
  ["lutein_zeaxanthin", /\b(?:lutein|zeaxanthin)\b/i],
  ["glucosamine", /\bglucosamine\b/i],
];

export const parseArgs = (argv = process.argv.slice(2), defaults = {}) => {
  const out = {
    runId: defaults.runId ?? null,
    resume: false,
    limit: defaults.limit ?? null,
    family: null,
    barcode: null,
    productId: null,
    concurrency: defaults.concurrency ?? 2,
    stagingUrl: defaults.stagingUrl ?? process.env.SCAN_RESULT_AUDIT_STAGING_URL ?? DEFAULT_AUDIT_BASE_URL,
    mode: defaults.mode ?? "full",
    dryRun: false,
    confirmLiveAi: false,
    manifestPath: defaults.manifestPath ?? null,
    outputRoot: defaults.outputRoot ?? DEFAULT_OUTPUT_ROOT,
    timeoutMs: defaults.timeoutMs ?? 45_000,
    maxRetries: defaults.maxRetries ?? 0,
    backoffBaseMs: defaults.backoffBaseMs ?? 2_000,
    maxConsecutive5xx: defaults.maxConsecutive5xx ?? 3,
    circuitBreakerSleepMs: defaults.circuitBreakerSleepMs ?? 60_000,
    healthcheckUrl: defaults.healthcheckUrl ?? null,
    batchSize: defaults.batchSize ?? 100,
    largeWindowMin: defaults.largeWindowMin ?? 5,
  };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    const next = argv[index + 1];
    if (arg === "--run-id" && next) { out.runId = next; index += 1; }
    else if (arg === "--resume") out.resume = true;
    else if (arg === "--limit" && next) { out.limit = Number(next); index += 1; }
    else if (arg === "--family" && next) { out.family = next; index += 1; }
    else if (arg === "--barcode" && next) { out.barcode = normalizeBarcode(next); index += 1; }
    else if (arg === "--product-id" && next) { out.productId = String(next); index += 1; }
    else if (arg === "--concurrency" && next) { out.concurrency = Number(next); index += 1; }
    else if (arg === "--staging-url" && next) { out.stagingUrl = next.replace(/\/+$/, ""); index += 1; }
    else if (arg === "--mode" && next) { out.mode = next; index += 1; }
    else if (arg === "--dry-run") out.dryRun = true;
    else if (arg === "--confirm-live-ai") out.confirmLiveAi = true;
    else if (arg === "--manifest" && next) { out.manifestPath = next; index += 1; }
    else if (arg === "--output-root" && next) { out.outputRoot = next; index += 1; }
    else if (arg === "--timeout-ms" && next) { out.timeoutMs = Number(next); index += 1; }
    else if (arg === "--max-retries" && next) { out.maxRetries = Number(next); index += 1; }
    else if (arg === "--backoff-base-ms" && next) { out.backoffBaseMs = Number(next); index += 1; }
    else if (arg === "--max-consecutive-5xx" && next) { out.maxConsecutive5xx = Number(next); index += 1; }
    else if (arg === "--circuit-breaker-sleep-ms" && next) { out.circuitBreakerSleepMs = Number(next); index += 1; }
    else if (arg === "--healthcheck-url" && next) { out.healthcheckUrl = next; index += 1; }
    else if (arg === "--batch-size" && next) { out.batchSize = Number(next); index += 1; }
    else if (arg === "--large-window-min" && next) { out.largeWindowMin = Number(next); index += 1; }
  }
  out.runId = safeFileSegment(out.runId || new Date().toISOString().replace(/[:.]/g, "-"));
  out.concurrency = Math.max(1, Number.isFinite(out.concurrency) ? Math.floor(out.concurrency) : 1);
  if (!Number.isFinite(out.limit) || out.limit <= 0) out.limit = null;
  out.maxRetries = Math.max(0, Number.isFinite(out.maxRetries) ? Math.floor(out.maxRetries) : 0);
  out.backoffBaseMs = Math.max(0, Number.isFinite(out.backoffBaseMs) ? Math.floor(out.backoffBaseMs) : 2_000);
  out.maxConsecutive5xx = Math.max(1, Number.isFinite(out.maxConsecutive5xx) ? Math.floor(out.maxConsecutive5xx) : 3);
  out.circuitBreakerSleepMs = Math.max(0, Number.isFinite(out.circuitBreakerSleepMs) ? Math.floor(out.circuitBreakerSleepMs) : 60_000);
  out.batchSize = Math.max(1, Number.isFinite(out.batchSize) ? Math.floor(out.batchSize) : 100);
  out.largeWindowMin = Math.max(1, Number.isFinite(out.largeWindowMin) ? Math.floor(out.largeWindowMin) : 5);
  out.runDir = path.resolve(ROOT_DIR, out.outputRoot, out.runId);
  out.manifestPath = out.manifestPath
    ? path.resolve(ROOT_DIR, out.manifestPath)
    : path.join(out.runDir, "manifest.json");
  return out;
};

export const safeFileSegment = (value) => String(value ?? "run").replace(/[^a-zA-Z0-9._-]+/g, "-").replace(/^-+|-+$/g, "") || "run";

export const loadDotenv = () => {
  dotenv.config({ path: path.join(ROOT_DIR, "backend", ".env") });
  dotenv.config({ path: path.join(ROOT_DIR, ".env") });
};

export const readBackendEnv = async () => {
  const values = {};
  for (const rel of ["backend/.env", ".env"]) {
    try {
      const text = await fs.readFile(path.join(ROOT_DIR, rel), "utf8");
      for (const rawLine of text.split(/\r?\n/)) {
        const line = rawLine.trim();
        if (!line || line.startsWith("#") || !line.includes("=")) continue;
        const eq = line.indexOf("=");
        const key = line.slice(0, eq).trim();
        const value = line.slice(eq + 1).trim().replace(/^["']|["']$/g, "");
        if (key && values[key] == null) values[key] = value;
      }
    } catch (error) {
      if (error?.code !== "ENOENT") throw error;
    }
  }
  return values;
};

export const ensureDir = async (dirPath) => fs.mkdir(dirPath, { recursive: true });
export const writeJson = async (filePath, value) => {
  await ensureDir(path.dirname(filePath));
  await fs.writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`);
};
export const writeText = async (filePath, value) => {
  await ensureDir(path.dirname(filePath));
  await fs.writeFile(filePath, String(value));
};
export const readJson = async (filePath) => JSON.parse(await fs.readFile(filePath, "utf8"));
export const appendJsonl = async (filePath, row) => {
  await ensureDir(path.dirname(filePath));
  await fs.appendFile(filePath, `${JSON.stringify(row)}\n`);
};
export const readJsonl = async (filePath) => {
  try {
    const text = await fs.readFile(filePath, "utf8");
    return text.split(/\r?\n/).filter(Boolean).map((line) => JSON.parse(line));
  } catch (error) {
    if (error?.code === "ENOENT") return [];
    throw error;
  }
};

export const writeCsv = async (filePath, rows, columns = null) => {
  const cols = columns ?? Array.from(rows.reduce((set, row) => {
    Object.keys(row ?? {}).forEach((key) => set.add(key));
    return set;
  }, new Set()));
  const lines = [cols.join(",")];
  for (const row of rows) {
    lines.push(cols.map((col) => csvValue(row?.[col])).join(","));
  }
  await writeText(filePath, `${lines.join("\n")}\n`);
};

export const csvValue = (value) => {
  if (value == null) return "";
  const text = typeof value === "object" ? JSON.stringify(value) : String(value);
  if (/[",\n\r]/.test(text)) return `"${text.replace(/"/g, '""')}"`;
  return text;
};

export const normalizeBarcode = (value) => {
  const digits = String(value ?? "").replace(/\D/g, "");
  if (!digits) return null;
  if (digits.length >= 14) return digits.slice(-14);
  return digits.padStart(14, "0");
};

export const safeText = (value) => String(value ?? "").replace(/\s+/g, " ").trim();
export const lowercaseKey = (value) => safeText(value).toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "");
export const truncate = (value, length = 240) => {
  const text = safeText(value);
  return text.length > length ? `${text.slice(0, length - 1)}…` : text;
};

export const flattenText = (value) => {
  if (typeof value === "string") return safeText(value) ? [safeText(value)] : [];
  if (Array.isArray(value)) return value.flatMap(flattenText);
  if (!value || typeof value !== "object") return [];
  return Object.values(value).flatMap(flattenText);
};

export const countBy = (rows, keyFn) => {
  const counts = new Map();
  for (const row of rows) {
    const key = safeText(typeof keyFn === "function" ? keyFn(row) : row?.[keyFn]) || "unknown";
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  return Object.fromEntries([...counts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])));
};

export const latencyStats = (values) => {
  const sorted = values.map(Number).filter(Number.isFinite).sort((a, b) => a - b);
  const pick = (q) => sorted.length ? sorted[Math.floor((sorted.length - 1) * q)] : null;
  const avg = sorted.length ? sorted.reduce((sum, value) => sum + value, 0) / sorted.length : null;
  return {
    count: sorted.length,
    p50: pick(0.5),
    p75: pick(0.75),
    p95: pick(0.95),
    p99: pick(0.99),
    max: sorted.at(-1) ?? null,
    avg: avg == null ? null : Number(avg.toFixed(1)),
  };
};

export const mapWithConcurrency = async (items, concurrency, worker) => {
  const results = new Array(items.length);
  let nextIndex = 0;
  const runners = Array.from({ length: Math.max(1, Math.min(concurrency, items.length)) }, async () => {
    while (true) {
      const index = nextIndex;
      nextIndex += 1;
      if (index >= items.length) return;
      results[index] = await worker(items[index], index);
    }
  });
  await Promise.all(runners);
  return results;
};

export const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, Math.max(0, Number(ms) || 0)));

export const isServer5xxStatus = (status) => Number(status) >= 500 && Number(status) <= 599;

export const isServer5xxRow = (row) => (
  isServer5xxStatus(row?.finalHttpStatus ?? row?.httpStatus)
  || row?.failureClass === "server_5xx"
);

export const buildManifestOrderIndex = (products = []) => {
  const order = new Map();
  products.forEach((product, index) => {
    const key = productKey(product);
    const compositeKey = `${key}::${safeText(product?.productId)}`;
    if (compositeKey && !order.has(compositeKey)) order.set(compositeKey, index + 1);
    if (key && !order.has(key)) order.set(key, index + 1);
  });
  return order;
};

export const attachRunOrder = (rows = [], products = []) => {
  const order = buildManifestOrderIndex(products);
  return rows.map((row, index) => {
    const key = row?.productKey || productKey(row ?? {});
    const compositeKey = `${key}::${safeText(row?.productId)}`;
    const runOrder = Number.isFinite(Number(row?.runOrder))
      ? Number(row.runOrder)
      : order.get(compositeKey) ?? order.get(key) ?? index + 1;
    return {
      ...row,
      productKey: key,
      runOrder,
      observedLine: Number.isFinite(Number(row?.observedLine)) ? Number(row.observedLine) : index + 1,
    };
  });
};

const compactProductContext = (row) => ({
  productKey: row?.productKey ?? null,
  productId: row?.productId ?? null,
  barcode: row?.barcode ?? null,
  productName: row?.productName ?? null,
  brand: row?.brand ?? null,
  family: row?.family ?? null,
  category: row?.category ?? null,
  sourceTier: row?.sourceTier ?? null,
  factsStatus: row?.factsStatus ?? null,
  failureClass: row?.failureClass ?? null,
  terminal: row?.terminal ?? null,
  httpStatus: row?.finalHttpStatus ?? row?.httpStatus ?? null,
  clientTimeout: Boolean(row?.clientTimeout),
  runOrder: row?.runOrder ?? null,
  observedLine: row?.observedLine ?? null,
});

export const findServer5xxWindows = (rows = [], { largeWindowMin = 5 } = {}) => {
  const sorted = [...rows].sort((a, b) => Number(a.runOrder ?? 0) - Number(b.runOrder ?? 0) || Number(a.observedLine ?? 0) - Number(b.observedLine ?? 0));
  const byRunOrder = new Map(sorted.map((row) => [Number(row.runOrder), row]));
  const windows = [];
  let current = null;

  for (const row of sorted) {
    if (!isServer5xxRow(row)) {
      if (current) {
        windows.push(current);
        current = null;
      }
      continue;
    }
    const runOrder = Number(row.runOrder);
    if (!current || runOrder > current.endRunOrder + 1) {
      if (current) windows.push(current);
      current = {
        windowId: `w${windows.length + 1}`,
        startRunOrder: runOrder,
        endRunOrder: runOrder,
        count: 0,
        rows: [],
      };
    }
    current.rows.push(row);
    current.count += 1;
    current.endRunOrder = Math.max(current.endRunOrder, runOrder);
  }
  if (current) windows.push(current);

  return windows.map((window) => {
    const first = window.rows[0] ?? null;
    const last = window.rows.at(-1) ?? null;
    const previousRow = byRunOrder.get(window.startRunOrder - 1) ?? null;
    const nextRow = byRunOrder.get(window.endRunOrder + 1) ?? null;
    const familyCount = Object.keys(countBy(window.rows, "family")).length;
    const brandCount = Object.keys(countBy(window.rows, "brand")).length;
    const sourceTierCount = Object.keys(countBy(window.rows, "sourceTier")).length;
    const factsStatusCount = Object.keys(countBy(window.rows, "factsStatus")).length;
    const previousWasClientTimeout = Boolean(previousRow?.clientTimeout || previousRow?.failureClass === "client_timeout");
    const recoveredAfterWindow = Boolean(nextRow && !isServer5xxRow(nextRow));
    const likelyServiceWindow =
      window.count >= largeWindowMin
      && (familyCount > 1 || brandCount > 1 || sourceTierCount > 1 || factsStatusCount > 1 || previousWasClientTimeout);
    return {
      ...window,
      firstRow: first,
      lastRow: last,
      previousRow,
      nextRow,
      previousWasClientTimeout,
      recoveredAfterWindow,
      familyCount,
      brandCount,
      sourceTierCount,
      factsStatusCount,
      preliminaryClassification: likelyServiceWindow ? "service_window_5xx" : "single_or_product_specific_5xx",
      firstContext: compactProductContext(first),
      previousContext: compactProductContext(previousRow),
      nextContext: compactProductContext(nextRow),
    };
  });
};

export const linkClientTimeoutTriggers = (rows = [], windows = []) => {
  const sorted = [...rows].sort((a, b) => Number(a.runOrder ?? 0) - Number(b.runOrder ?? 0));
  const timeoutRows = sorted.filter((row) => row.clientTimeout || row.failureClass === "client_timeout");
  return timeoutRows.map((row) => {
    const nextWindow = windows.find((window) => Number(window.startRunOrder) > Number(row.runOrder));
    const immediatelyPrecedesWindow = Boolean(nextWindow && Number(nextWindow.startRunOrder) === Number(row.runOrder) + 1);
    return {
      ...compactProductContext(row),
      next5xxWindowId: nextWindow?.windowId ?? null,
      next5xxWindowStartRunOrder: nextWindow?.startRunOrder ?? null,
      next5xxWindowCount: nextWindow?.count ?? null,
      immediatelyPrecedesWindow,
      distanceToNext5xxWindow: nextWindow ? Number(nextWindow.startRunOrder) - Number(row.runOrder) : null,
    };
  });
};

export const barcodePrefix = (barcode, length = 6) => {
  const digits = String(barcode ?? "").replace(/\D/g, "");
  return digits ? digits.slice(0, Math.min(length, digits.length)) : "missing";
};

export const buildServer5xxBucketRows = (rows = [], { segmentSize = 1000 } = {}) => {
  const serverRows = rows.filter(isServer5xxRow);
  const build = (dimension, keyFn) => Object.entries(countBy(serverRows, keyFn)).map(([bucket, count]) => ({
    dimension,
    bucket,
    count,
    percent_of_5xx: percent(count, serverRows.length),
  }));
  return [
    ...build("family", (row) => row.family),
    ...build("brand", (row) => row.brand),
    ...build("sourceTier", (row) => row.sourceTier),
    ...build("factsStatus", (row) => row.factsStatus),
    ...build("barcodePrefix6", (row) => barcodePrefix(row.barcode, 6)),
    ...build("runOrderSegment", (row) => {
      const start = Math.floor((Number(row.runOrder ?? 1) - 1) / segmentSize) * segmentSize + 1;
      return `${start}-${start + segmentSize - 1}`;
    }),
  ];
};

export const createServiceWindowTracker = ({ maxConsecutive5xx = 3 } = {}) => ({
  maxConsecutive5xx: Math.max(1, Number(maxConsecutive5xx) || 3),
  consecutive5xx: 0,
  serviceWindowSeq: 0,
  activeServiceWindowId: null,
});

export const updateServiceWindowTracker = (tracker, row) => {
  if (!tracker) return { serviceWindowId: null, consecutive5xx: 0, circuitBreakerOpen: false };
  if (isServer5xxRow(row)) {
    tracker.consecutive5xx += 1;
    if (!tracker.activeServiceWindowId && tracker.consecutive5xx >= tracker.maxConsecutive5xx) {
      tracker.serviceWindowSeq += 1;
      tracker.activeServiceWindowId = `sw-${tracker.serviceWindowSeq}`;
    }
    return {
      serviceWindowId: tracker.activeServiceWindowId,
      consecutive5xx: tracker.consecutive5xx,
      circuitBreakerOpen: tracker.consecutive5xx >= tracker.maxConsecutive5xx,
    };
  }
  tracker.consecutive5xx = 0;
  tracker.activeServiceWindowId = null;
  return { serviceWindowId: null, consecutive5xx: 0, circuitBreakerOpen: false };
};

export const classifyRetryOutcome = (attempts = []) => {
  const first = attempts[0] ?? {};
  const final = attempts.at(-1) ?? {};
  const retryCount = Math.max(0, attempts.length - 1);
  if (retryCount > 0 && isServer5xxStatus(first.httpStatus) && !isServer5xxStatus(final.httpStatus)) {
    return "transient_5xx_retry_recovered";
  }
  if (retryCount > 0 && attempts.every((attempt) => isServer5xxStatus(attempt.httpStatus))) {
    return "persistent_5xx_after_retry";
  }
  if (retryCount > 0 && first.clientTimeout && !final.clientTimeout) return "timeout_retry_recovered";
  if (retryCount > 0 && isRetryableStreamTerminationAttempt(first) && !final.failureClass) {
    return "transient_stream_retry_recovered";
  }
  if (retryCount > 0 && attempts.every((attempt) => isRetryableStreamTerminationAttempt(attempt))) {
    return "persistent_stream_terminated_after_retry";
  }
  return retryCount > 0 ? "retried_unclassified" : "not_retried";
};

export const isRetryableStreamTerminationAttempt = (attempt = {}) => {
  const status = Number(attempt.httpStatus ?? attempt.finalHttpStatus ?? 0);
  const terminal = safeText(attempt.terminal);
  const error = safeText(attempt.serverError);
  const eventCount = Array.isArray(attempt.streamEventsSeen) ? attempt.streamEventsSeen.length : Number(attempt.eventCount ?? 0);
  return status === 200
    && eventCount === 0
    && (terminal === "REQUEST_ERROR" || terminal === "NO_TERMINAL" || attempt.failureClass === "terminal_state")
    && /terminated|socket|stream|premature|closed|aborted/i.test(error);
};

export const extractCoreScoreSnapshot = (bundle, detailPayload = null) => {
  const candidates = [
    { path: "bundle.meta.decisionSupportInline.nutriScoreCardV2", value: bundle?.meta?.decisionSupportInline?.nutriScoreCardV2 },
    { path: "bundle.decisionSupportInline.nutriScoreCardV2", value: bundle?.decisionSupportInline?.nutriScoreCardV2 },
    { path: "bundle.decisionSupport.nutriScoreCardV2", value: bundle?.decisionSupport?.nutriScoreCardV2 },
    { path: "bundle.nutriScoreCardV2", value: bundle?.nutriScoreCardV2 },
    { path: "bundle.sections.score.nutriScoreCardV2", value: bundle?.sections?.score?.nutriScoreCardV2 },
    { path: "bundle.sections.score", value: bundle?.sections?.score },
    { path: "bundle.score", value: bundle?.score },
    { path: "detailPayload.data.nutriScoreCardV2", value: detailPayload?.data?.nutriScoreCardV2 },
    { path: "detailPayload.nutriScoreCardV2", value: detailPayload?.nutriScoreCardV2 },
  ];
  for (const candidate of candidates) {
    const value = candidate.value;
    if (!value || typeof value !== "object") continue;
    const overallScore = Number(value.overallScore ?? value.score);
    const hasScore = Number.isFinite(overallScore) || safeText(value.overallBand ?? value.band);
    const moduleCount = Array.isArray(value.modules) ? value.modules.length : null;
    if (hasScore || moduleCount) {
      return {
        available: true,
        path: candidate.path,
        overallScore: Number.isFinite(overallScore) ? overallScore : null,
        overallBand: safeText(value.overallBand ?? value.band) || null,
        confidencePct: Number.isFinite(Number(value.confidencePct)) ? Number(value.confidencePct) : null,
        moduleCount,
      };
    }
  }
  return {
    available: false,
    path: null,
    overallScore: null,
    overallBand: null,
    confidencePct: null,
    moduleCount: null,
  };
};

export const getMcpListEvidence = () => {
  const result = spawnSync("codex", ["mcp", "list"], { encoding: "utf8", cwd: ROOT_DIR, timeout: 8_000 });
  const output = `${result.stdout ?? ""}${result.stderr ?? ""}`.trim();
  return {
    attempted: true,
    exitCode: typeof result.status === "number" ? result.status : null,
    supabaseListed: /\bsupabase\b/i.test(output),
    renderListed: /\brender\b/i.test(output),
    supabaseAuthStatus: extractMcpAuthStatus(output, "supabase"),
    renderAuthStatus: extractMcpAuthStatus(output, "render"),
    note: output ? truncate(output.replace(/Bearer token[^\n]*/gi, "Bearer token [redacted]"), 1200) : null,
  };
};

const extractMcpAuthStatus = (output, name) => {
  const line = output.split(/\r?\n/).find((entry) => new RegExp(`^${name}\\s`, "i").test(entry.trim()));
  if (!line) return null;
  const parts = line.trim().split(/\s{2,}/).filter(Boolean);
  return parts.at(-1) ?? null;
};

export const loadRuntimeFamilyCatalog = async () => {
  const sources = [];
  const addSource = async (rel, kind) => {
    try {
      const text = await fs.readFile(path.join(ROOT_DIR, rel), "utf8");
      sources.push({ rel, kind, text });
    } catch (error) {
      if (error?.code !== "ENOENT") throw error;
    }
  };
  await addSource("backend/src/ingredientScienceContext.ts", "runtime_inference");
  await addSource("backend/src/insights/scientificBackgroundCompiler.ts", "section_plan");
  await addSource("backend/data/reviewed/scientific-background-evidence.v1.json", "reviewed_evidence");
  const familyMap = new Map();
  for (const [family] of FAMILY_PATTERNS) familyMap.set(family, { family, sources: ["pattern_dictionary"] });
  for (const source of sources) {
    const matches = source.text.match(/["'`]([a-z][a-z0-9]+(?:_[a-z0-9]+)+)["'`]/g) ?? [];
    for (const raw of matches) {
      const family = raw.slice(1, -1);
      if (family.length < 3 || family.length > 64) continue;
      if (!/[a-z]/.test(family) || /^(reason_code|section_key|prompt_version)$/.test(family)) continue;
      const entry = familyMap.get(family) ?? { family, sources: [] };
      if (!entry.sources.includes(source.kind)) entry.sources.push(source.kind);
      familyMap.set(family, entry);
    }
  }
  return {
    generatedAt: new Date().toISOString(),
    families: [...familyMap.values()].sort((a, b) => a.family.localeCompare(b.family)),
    sourceFiles: sources.map((source) => ({ path: source.rel, kind: source.kind })),
  };
};

export const extractFactRows = (supplementFacts) => {
  const candidates = [];
  const push = (value) => {
    if (Array.isArray(value)) candidates.push(...value);
  };
  push(supplementFacts);
  if (supplementFacts && typeof supplementFacts === "object") {
    push(supplementFacts.nutritionalFacts);
    push(supplementFacts.nutritional_facts);
    push(supplementFacts.supplementFacts);
    push(supplementFacts.supplement_facts);
    push(supplementFacts.rows);
    push(supplementFacts.facts);
  }
  return candidates.filter((item) => item && typeof item === "object");
};

export const extractIngredientRows = (row) => {
  const factRows = extractFactRows(row?.supplement_facts ?? row?.supplementFacts);
  return factRows.map((fact) => {
    const name = safeText(fact.substancy ?? fact.substance ?? fact.substance_name ?? fact.name ?? fact.ingredient ?? fact.ingredientName);
    const amount = safeText(fact.amountPerServing ?? fact.amount_per_serving ?? fact.amount ?? fact.value);
    const unit = safeText(fact.unit ?? fact.units);
    const form = safeText(fact.form ?? fact.formRaw ?? fact.form_raw ?? fact.source);
    const rawText = [name, amount, unit, form].filter(Boolean).join(" ");
    return { name, amount: amount || null, unit: unit || null, form: form || null, rawText };
  }).filter((item) => item.name);
};

export const readDescriptionText = (sections, aliases) => {
  if (!sections || typeof sections !== "object") return null;
  const aliasKeys = new Set(aliases.map((item) => lowercaseKey(item)));
  for (const [key, value] of Object.entries(sections)) {
    if (!aliasKeys.has(lowercaseKey(key))) continue;
    const text = typeof value === "string" ? safeText(value) : flattenText(value).join(" ");
    if (text) return text;
  }
  return null;
};

export const normalizeOverlayProduct = (row, familyCatalog = null) => {
  const productId = safeText(row?.product_id ?? row?.productId) || null;
  const barcode = normalizeBarcode(row?.barcode_gtin14 ?? row?.barcodeGtin14 ?? row?.upc_code ?? row?.upcCode);
  const upcCode = safeText(row?.upc_code ?? row?.upcCode) || null;
  const productName = safeText(row?.title ?? row?.name ?? row?.product_name) || null;
  const brand = safeText(row?.brand_name ?? row?.brandName ?? row?.brand) || null;
  const categories = Array.isArray(row?.categories) ? row.categories.map(safeText).filter(Boolean) : [];
  const category = categories[0] ?? safeText(row?.category) ?? null;
  const ingredientRows = extractIngredientRows(row);
  const descriptionSections = row?.description_sections ?? row?.descriptionSections ?? {};
  const labelDirections = readDescriptionText(descriptionSections, ["Suggested Use", "Suggested use", "Directions", "Suggested usage"]);
  const warnings = readDescriptionText(descriptionSections, ["Warnings", "Warning", "Caution"]);
  const otherIngredients = readDescriptionText(descriptionSections, ["Other Ingredients", "Other ingredients"]);
  const activeNames = ingredientRows.map((item) => item.name);
  const hasDose = ingredientRows.some((item) => safeText(item.amount) || DOSAGE_PATTERN.test(item.rawText));
  const hasForm = ingredientRows.some((item) => safeText(item.form) || /\b(?:citrate|glycinate|oxide|chelate|extract|standardized|softgel|capsule|tablet|powder|oil|isolate|hydrolysate)\b/i.test(item.rawText));
  const sourceTier = inferSourceTier(row);
  const factsStatus = activeNames.length > 0 && hasDose ? "full" : activeNames.length > 0 ? "partial" : "none";
  const missingCriticalFields = [
    !barcode ? "barcode" : null,
    !activeNames.length ? "active_ingredients" : null,
    !hasDose ? "dose" : null,
    !hasForm ? "form" : null,
    !warnings ? "warnings" : null,
    !labelDirections ? "usage_directions" : null,
  ].filter(Boolean);
  const familyInfo = inferFamily({ productName, brand, category, categories, ingredientRows, otherIngredients }, familyCatalog);
  return {
    productId,
    barcode,
    upcCode,
    productName,
    brand,
    category: category || null,
    categories,
    link: safeText(row?.link) || null,
    imageUrl: pickImageUrl(row),
    activeIngredients: ingredientRows,
    activeIngredientNames: activeNames,
    labelDirections,
    warnings,
    otherIngredients,
    sourceTier,
    factsStatus,
    coverageStatus: factsStatus === "full" ? "coverage_ready" : factsStatus === "partial" ? "partial_facts" : "missing_facts",
    missingCriticalFields,
    likelySupplement: inferLikelySupplement({ productName, category, categories, ingredientRows }),
    family: familyInfo.family,
    familyMatchSource: familyInfo.source,
    familyMatchText: familyInfo.matchedText,
    sourceTable: "iherb_overlay_products",
    rawUpdatedAt: row?.updated_at ?? row?.updatedAt ?? null,
  };
};

export const inferSourceTier = (row) => {
  const zip = safeText(row?.source_zip_path ?? row?.sourceZipPath).toLowerCase();
  const link = safeText(row?.link).toLowerCase();
  if (/official|manufacturer|brand/.test(zip) || /official|manufacturer|brand/.test(link)) return "official_or_brand";
  if (/iherb/.test(zip) || /iherb/.test(link)) return "iherb";
  if (/dsld/.test(zip)) return "dsld";
  if (/lnhpd|npn/.test(zip)) return "lnhpd";
  if (link) return "web";
  return "unknown";
};

export const pickImageUrl = (row) => {
  const direct = safeText(row?.product_catalog_image ?? row?.productCatalogImage ?? row?.image_url ?? row?.imageUrl);
  if (direct) return direct;
  const images = row?.product_images ?? row?.productImages;
  if (Array.isArray(images)) {
    for (const item of images) {
      if (typeof item === "string" && safeText(item)) return safeText(item);
      if (item && typeof item === "object") {
        const candidate = safeText(item.url ?? item.src ?? item.imageUrl ?? item.image_url);
        if (candidate) return candidate;
      }
    }
  }
  return null;
};

export const inferLikelySupplement = ({ productName, category, categories, ingredientRows }) => {
  const text = [productName, category, ...(categories ?? []), ...ingredientRows.map((item) => item.name)].filter(Boolean).join(" ");
  if (/\b(?:supplement|vitamin|mineral|capsule|tablet|softgel|extract|probiotic|protein|amino acid|herb|omega|enzyme)\b/i.test(text)) return true;
  if (/\b(?:snack|cookie|candy|tea bags?|beverage|food|grocery)\b/i.test(text) && ingredientRows.length < 2) return false;
  return ingredientRows.length > 0;
};

export const inferFamily = ({ productName, brand, category, categories, ingredientRows, otherIngredients }, familyCatalog = null) => {
  // Inactive/excipient text often contains high-collision tokens like magnesium stearate.
  // Keep it out of the primary family pass so the audit does not overstate coverage.
  const familyIngredientRows = ingredientRows.filter((item) => !isMacroNutrientName(item.name));
  const textParts = [productName, brand, category, ...(categories ?? []), ...familyIngredientRows.map((item) => `${item.name} ${item.form ?? ""}`)].filter(Boolean);
  const combined = textParts.join(" | ");
  const matches = FAMILY_PATTERNS
    .map(([family, pattern], patternIndex) => {
      const match = combined.match(pattern);
      return match ? { family, patternIndex, index: match.index ?? 999999, matchedText: match[0] } : null;
    })
    .filter(Boolean)
    .sort((left, right) => left.index - right.index || left.patternIndex - right.patternIndex);
  if (matches[0]) {
    return { family: matches[0].family, source: "pattern_dictionary", matchedText: matches[0].matchedText };
  }
  const firstIngredient = familyIngredientRows.find((item) => safeText(item.name))?.name ?? null;
  const derived = lowercaseKey(firstIngredient);
  if (derived && familyCatalog?.families?.some((entry) => entry.family === derived)) {
    return { family: derived, source: "runtime_catalog_exact", matchedText: firstIngredient };
  }
  if (!derived && otherIngredients) {
    const inactiveMatch = FAMILY_PATTERNS.find(([, pattern]) => pattern.test(otherIngredients));
    if (inactiveMatch) return { family: "unclassified", source: "inactive_ingredient_only", matchedText: otherIngredients.match(inactiveMatch[1])?.[0] ?? null };
  }
  return { family: "unclassified", source: derived ? "first_active_candidate_unmapped" : "unclassified", matchedText: firstIngredient };
};

export const buildCensus = (products) => {
  const barcodeCapable = products.filter((row) => row.barcode);
  const productIdOnly = products.filter((row) => !row.barcode && row.productId);
  const missingFieldCounts = countBy(products.flatMap((row) => row.missingCriticalFields.map((field) => ({ field }))), "field");
  return {
    totalSupplements: products.length,
    barcodeCapableCount: barcodeCapable.length,
    productIdOnlyCount: productIdOnly.length,
    missingBarcodeCount: products.filter((row) => !row.barcode).length,
    missingActiveIngredientsCount: products.filter((row) => row.missingCriticalFields.includes("active_ingredients")).length,
    missingDoseCount: products.filter((row) => row.missingCriticalFields.includes("dose")).length,
    missingFormCount: products.filter((row) => row.missingCriticalFields.includes("form")).length,
    missingWarningsCount: products.filter((row) => row.missingCriticalFields.includes("warnings")).length,
    missingUsageDirectionsCount: products.filter((row) => row.missingCriticalFields.includes("usage_directions")).length,
    likelySupplementCount: products.filter((row) => row.likelySupplement).length,
    foodLikeOrAmbiguousCount: products.filter((row) => !row.likelySupplement).length,
    byFamily: countBy(products, "family"),
    byCategory: countBy(products, (row) => row.category ?? "unknown"),
    bySourceTier: countBy(products, "sourceTier"),
    byFactsStatus: countBy(products, "factsStatus"),
    byMissingCriticalDataField: missingFieldCounts,
    proposedFullRunSize: barcodeCapable.length + productIdOnly.length,
    proposedStratifiedDeepQualitySampleSize: Math.min(250, Math.max(25, Object.keys(countBy(products, "family")).length * 3)),
  };
};

export const renderDiscoveryMarkdown = ({ generatedAt, args, mcpEvidence, catalog, tableEvidence, routeEvidence }) => [
  "# Scan Result Full-Corpus Audit Discovery",
  "",
  `- generatedAt: ${generatedAt}`,
  `- configuredTarget: ${args?.stagingUrl ?? DEFAULT_AUDIT_BASE_URL}`,
  "- targetLabel: configured Render target; not independently asserted as staging unless deployment evidence is available",
  "",
  "## Reused Existing Scripts",
  "- `scripts/maintainer/enrich-stream-concurrency-gate.mjs` for SSE timing concepts and terminal-state fields.",
  "- `scripts/maintainer/run-science-targeted-validation.mjs` for decision-support plus ingredient/scientific sidecar request shape.",
  "- `scripts/maintainer/lib/science-validation-reporting.mjs` for barcode normalization and existing science quality heuristics.",
  "- `scripts/maintainer/lib/runtime-contract-runner.mjs` for runtime route contracts and sidecar body shape.",
  "",
  "## Discovered Routes",
  "- `POST /api/enrich-stream` core scan stream route.",
  "- `GET /api/decision-support/v1?barcode=...&viewMode=details` core decision-support route.",
  "- `GET /api/scan-facts/v1/:source/:id` scan facts route, best-effort only when source/id can be inferred.",
  "- `POST /api/ingredient-overview/v1` deferred AI sidecar route.",
  "- `POST /api/scientific-background/v1` deferred AI sidecar route.",
  "- `POST /api/product-overview-ai/v1` deferred AI sidecar route.",
  "- `POST /api/summary/safety` monitor-only safety summary route.",
  "- `GET /api/search/product-detail?productId=...` productId-only detail route.",
  "",
  "## Discovered Contracts",
  "- Core stream emits `analysis_bundle` revisions and `done` terminal event; rev0/rev1/done timings are audit fields.",
  "- Decision support returns `digest`, `decisionInputsHash`, `personalizationScopeHash`, `nutriScoreCardV2`, `personalizedResultLane`, `overviewBlock`, `scienceBlock`, `usageBlock`, and `safetyBlock`.",
  "- Ingredient overview returns `ingredientOverview`, `source`, `fallbackUsed`, `fallbackReason`, `backgroundRefreshPending`, and `recommendedRetryAfterMs`.",
  "- Scientific background returns `scientificBackground`, `source`, `fallbackUsed`, `fallbackReason`, `backgroundRefreshPending`, and `recommendedRetryAfterMs`.",
  "- Product overview AI returns `overviewAi`, `source`, `fallbackUsed`, and `fallbackReason`.",
  "",
  "## Supabase / Render Evidence",
  `- supabaseMcpListed: ${mcpEvidence?.supabaseListed ?? false}`,
  `- supabaseMcpAuthStatus: ${mcpEvidence?.supabaseAuthStatus ?? "unknown"}`,
  `- renderMcpListed: ${mcpEvidence?.renderListed ?? false}`,
  `- renderMcpAuthStatus: ${mcpEvidence?.renderAuthStatus ?? "unknown"}`,
  `- renderMcpRuntimeEvidence: ${routeEvidence?.renderMcpRuntimeEvidence ?? "not_available"}`,
  "",
  "## Supabase Tables / Queries",
  `- authorityProductTable: ${tableEvidence?.authorityProductTable ?? "iherb_overlay_products"}`,
  `- manifestSelectColumns: ${(tableEvidence?.manifestSelectColumns ?? []).join(", ")}`,
  `- readOnlyMode: true`,
  "",
  "## Family Derivation Sources",
  ...(catalog?.sourceFiles ?? []).map((source) => `- ${source.kind}: \`${source.path}\``),
  "",
  "## Unresolved Assumptions",
  "- Supabase MCP tools are not exposed inside this running Codex session even after login, so repeatable corpus export uses existing Supabase read-only env/client and records MCP status.",
  "- Render MCP returned authorization evidence only if the configured connector is authorized; otherwise reports rely on HTTP route evidence from the configured URL.",
  "- Full-corpus sidecar live generation is intentionally skipped unless `--confirm-live-ai` is provided.",
  "",
].join("\n");

export const renderCensusMarkdown = ({ generatedAt, census }) => [
  "# Supabase Full Corpus Census",
  "",
  `- generatedAt: ${generatedAt}`,
  `- total supplements: ${census.totalSupplements}`,
  `- barcode-capable: ${census.barcodeCapableCount}`,
  `- productId-only: ${census.productIdOnlyCount}`,
  `- missing barcode: ${census.missingBarcodeCount}`,
  `- missing active ingredients: ${census.missingActiveIngredientsCount}`,
  `- missing dose: ${census.missingDoseCount}`,
  `- missing form: ${census.missingFormCount}`,
  `- missing warnings: ${census.missingWarningsCount}`,
  `- missing usage/directions: ${census.missingUsageDirectionsCount}`,
  `- proposed full-run size: ${census.proposedFullRunSize}`,
  `- proposed stratified deep-quality sample size: ${census.proposedStratifiedDeepQualitySampleSize}`,
  "",
  "## Top Families",
  ...Object.entries(census.byFamily).slice(0, 40).map(([key, count]) => `- ${key}: ${count}`),
  "",
  "## Source Tiers",
  ...Object.entries(census.bySourceTier).map(([key, count]) => `- ${key}: ${count}`),
  "",
  "## Facts Status",
  ...Object.entries(census.byFactsStatus).map(([key, count]) => `- ${key}: ${count}`),
  "",
].join("\n");

export const selectProducts = (products, args) => {
  let selected = products;
  if (args.family) selected = selected.filter((row) => row.family === args.family);
  if (args.barcode) selected = selected.filter((row) => row.barcode === args.barcode);
  if (args.productId) selected = selected.filter((row) => String(row.productId) === String(args.productId));
  if (args.limit) selected = selected.slice(0, args.limit);
  return selected;
};

export const summarizeCoreRows = (rows) => {
  const failures = rows.filter((row) => row.pass !== true);
  return {
    total: rows.length,
    pass: rows.length - failures.length,
    fail: failures.length,
    failureClasses: countBy(failures, (row) => row.failureClass ?? "unknown"),
    rev0Ms: latencyStats(rows.map((row) => row.rev0Ms)),
    rev1Ms: latencyStats(rows.map((row) => row.rev1Ms)),
    doneMs: latencyStats(rows.map((row) => row.doneMs)),
    scoreAvailableRate: percent(rows.filter((row) => row.scoreAvailable).length, rows.length),
    coreCardsAvailableRate: percent(rows.filter((row) => row.coreCardsAvailable).length, rows.length),
    perFamilyPassRate: buildPassRate(rows, "family"),
  };
};

export const summarizeSidecarRows = (rows) => ({
  total: rows.length,
  byRoute: buildPassRate(rows, "route"),
  byStatus: countBy(rows, "status"),
  bySource: countBy(rows, "source"),
  byFallbackReason: countBy(rows.filter((row) => row.fallbackReason), "fallbackReason"),
  latencyMs: latencyStats(rows.map((row) => row.latencyMs)),
});

export const buildPassRate = (rows, field) => {
  const groups = new Map();
  for (const row of rows) {
    const key = safeText(row?.[field]) || "unknown";
    const current = groups.get(key) ?? { total: 0, pass: 0, fail: 0 };
    current.total += 1;
    if (row.pass === true) current.pass += 1;
    else current.fail += 1;
    groups.set(key, current);
  }
  return Object.fromEntries([...groups.entries()].map(([key, value]) => [key, { ...value, passRate: percent(value.pass, value.total) }]));
};

export const percent = (count, total, digits = 1) => total > 0 ? Number(((count / total) * 100).toFixed(digits)) : 0;

export const evaluateAiSummary = ({ type, product, payload, source, fallbackUsed, fallbackReason, backgroundRefreshPending, recommendedRetryAfterMs }) => {
  const text = flattenText(payload).join(" ");
  const blankFields = collectBlankFields(payload);
  const unavailable = PLACEHOLDER_PATTERN.test(text) || !safeText(text);
  const genericCopyScore = scoreGenericText(text, product);
  const overclaimScore = UNSAFE_OVERCLAIM_PATTERN.test(text) ? 3 : 0;
  const duplicateCopyScore = scoreDuplicateText(payload);
  const evidenceBoundaryPresence = EVIDENCE_BOUNDARY_PATTERN.test(text);
  const shopperMeaningPresence = SHOPPER_MEANING_PATTERN.test(text);
  const compareHintPresence = type === "ingredient_overview" ? Boolean(safeText(payload?.compareHint)) : SHOPPER_MEANING_PATTERN.test(text);
  const productSpecificAnchorPresence = hasProductAnchor(text, product);
  const severity = classifyAiSeverity({ unavailable, blankFields, source, fallbackUsed, genericCopyScore, overclaimScore, evidenceBoundaryPresence, shopperMeaningPresence, type });
  return {
    type,
    source: source ?? null,
    fallbackUsed: Boolean(fallbackUsed),
    fallbackReason: fallbackReason ?? null,
    llm_unconfigured: fallbackReason === "ai_not_configured" || fallbackReason === "llm_unconfigured",
    llm_timeout: /timeout/i.test(String(fallbackReason ?? "")),
    parse_failed: /parse/i.test(String(fallbackReason ?? "")),
    quality_gate_rejected: /gate/i.test(String(fallbackReason ?? "")),
    exhausted_without_valid_output: /exhaust/i.test(String(fallbackReason ?? "")),
    backgroundRefreshPending: Boolean(backgroundRefreshPending),
    recommendedRetryAfterMs: recommendedRetryAfterMs ?? null,
    visibleUnavailableText: unavailable,
    blankFields,
    genericCopyScore,
    overclaimScore,
    duplicateCopyScore,
    evidenceBoundaryPresence,
    shopperMeaningPresence,
    compareHintPresence,
    productSpecificAnchorPresence,
    severity,
    preview: truncate(text, 320),
  };
};

const collectBlankFields = (payload, prefix = "") => {
  if (!payload || typeof payload !== "object") return [];
  const out = [];
  for (const [key, value] of Object.entries(payload)) {
    const field = prefix ? `${prefix}.${key}` : key;
    if (typeof value === "string" && !safeText(value)) out.push(field);
    else if (value == null) out.push(field);
    else if (Array.isArray(value) && value.length === 0) out.push(field);
    else if (value && typeof value === "object" && !Array.isArray(value)) out.push(...collectBlankFields(value, field));
  }
  return out.slice(0, 20);
};

const scoreGenericText = (text, product) => {
  const normalized = safeText(text);
  if (!normalized) return 3;
  let score = 0;
  if (GENERIC_WELLNESS_PATTERN.test(normalized)) score += 1;
  if (!hasProductAnchor(normalized, product)) score += 1;
  if (!DOSAGE_PATTERN.test(normalized) && !SHOPPER_MEANING_PATTERN.test(normalized)) score += 1;
  return Math.min(3, score);
};

const scoreDuplicateText = (payload) => {
  const lines = flattenText(payload).map((line) => line.toLowerCase()).filter((line) => line.length > 30);
  const seen = new Set();
  let duplicate = 0;
  for (const line of lines) {
    if (seen.has(line)) duplicate += 1;
    seen.add(line);
  }
  return Math.min(3, duplicate);
};

const hasProductAnchor = (text, product) => {
  const normalized = safeText(text).toLowerCase();
  const anchors = [
    product?.family,
    product?.productName,
    product?.brand,
    ...(product?.activeIngredientNames ?? []),
  ].map((item) => safeText(item).toLowerCase()).filter((item) => item.length >= 4);
  return anchors.some((anchor) => normalized.includes(anchor));
};

const classifyAiSeverity = ({ unavailable, blankFields, source, fallbackUsed, genericCopyScore, overclaimScore, evidenceBoundaryPresence, shopperMeaningPresence, type }) => {
  if (unavailable || blankFields.length > 6 || overclaimScore >= 3) return "P0";
  if (fallbackUsed && genericCopyScore >= 2) return "P1";
  if (source === "fallback" && genericCopyScore >= 2) return "P1";
  if (type === "scientific_background" && !evidenceBoundaryPresence) return "P1";
  if (type === "ingredient_overview" && !shopperMeaningPresence) return "P1";
  if (genericCopyScore === 1) return "P2";
  return "P3";
};

export const evaluateContentValue = ({ product, decisionSupport = null, sidecars = {}, productDetail = null }) => {
  const personalized = scorePersonalized(decisionSupport?.personalizedResultLane);
  const nutriScore = scoreNutriScore(decisionSupport?.nutriScoreCardV2 ?? productDetail?.nutriScoreCardV2);
  const productOverview = scoreProductOverview(productDetail ?? decisionSupport);
  const formulaOverview = scoreFormulaOverview(sidecars.ingredient_overview?.payload ?? productDetail?.ingredientOverview, product);
  const scientificBackground = scoreScientific(sidecars.scientific_background?.payload ?? productDetail?.scientificBackground, product);
  const usage = scoreUsage(decisionSupport?.usageBlock ?? productDetail?.usageBlock ?? product?.labelDirections);
  const safety = scoreSafety(decisionSupport?.safetyBlock ?? productDetail?.safetyBlock ?? product?.warnings, product);
  const overall = Math.round((personalized * 15 + nutriScore * 20 + productOverview * 10 + formulaOverview * 15 + scientificBackground * 15 + usage * 10 + safety * 15) / 3);
  return {
    personalized_insights_value_score: personalized,
    nutri_score_value_score: nutriScore,
    product_overview_value_score: productOverview,
    formula_overview_value_score: formulaOverview,
    scientific_background_value_score: scientificBackground,
    usage_value_score: usage,
    safety_value_score: safety,
    overall_scan_result_value_score: overall,
  };
};

const scoreFromText = (text, { product, needsBoundary = false, needsDose = false, needsCompare = false } = {}) => {
  const value = flattenText(text).join(" ");
  if (!safeText(value) || PLACEHOLDER_PATTERN.test(value)) return 0;
  let score = 1;
  if (hasProductAnchor(value, product) || DOSAGE_PATTERN.test(value)) score = 2;
  const rich = (!needsBoundary || EVIDENCE_BOUNDARY_PATTERN.test(value)) && (!needsDose || DOSAGE_PATTERN.test(value)) && (!needsCompare || SHOPPER_MEANING_PATTERN.test(value));
  if (rich && (hasProductAnchor(value, product) || product == null)) score = 3;
  if (UNSAFE_OVERCLAIM_PATTERN.test(value)) return Math.min(score, 1);
  return score;
};
const scorePersonalized = (value) => scoreFromText(value, { needsCompare: false });
const scoreNutriScore = (value) => value?.overallScore != null || value?.score != null || value?.band ? 3 : scoreFromText(value);
const scoreProductOverview = (value) => scoreFromText(value, { needsCompare: false });
const scoreFormulaOverview = (value, product) => scoreFromText(value, { product, needsCompare: true });
const scoreScientific = (value, product) => scoreFromText(value, { product, needsBoundary: true, needsCompare: true });
const scoreUsage = (value) => scoreFromText(value, { needsDose: true });
const scoreSafety = (value, product) => scoreFromText(value, { product });

export const buildFamilyCoverageRows = ({ products, coreRows = [], sidecarRows = [], contentRows = [], catalog = null }) => {
  const coreByProduct = new Map(coreRows.map((row) => [row.productKey, row]));
  const contentByProduct = new Map(contentRows.map((row) => [row.productKey, row]));
  const families = new Set([...products.map((row) => row.family), ...(catalog?.families ?? []).map((row) => row.family)]);
  return [...families].filter(Boolean).sort().map((family) => {
    const familyProducts = products.filter((row) => row.family === family);
    const productKeys = new Set(familyProducts.map(productKey));
    const familyCore = coreRows.filter((row) => productKeys.has(row.productKey));
    const familySidecars = sidecarRows.filter((row) => productKeys.has(row.productKey));
    const scientific = familySidecars.filter((row) => row.route === "scientific_background");
    const content = familyProducts.map((row) => contentByProduct.get(productKey(row))).filter(Boolean);
    const catalogEntry = catalog?.families?.find((row) => row.family === family);
    return {
      family,
      product_count: familyProducts.length,
      scanned_count: familyCore.length,
      research_mode_count: scientific.filter((row) => row.mode === "research_mode").length,
      label_context_mode_count: scientific.filter((row) => row.mode === "label_context_mode").length,
      generic_fallback_count: familySidecars.filter((row) => row.source === "fallback" && row.genericCopyScore >= 2).length,
      api_success_count: familySidecars.filter((row) => row.source === "api").length,
      unavailable_count: familySidecars.filter((row) => row.status === "unavailable" || row.visibleUnavailableText).length,
      average_score_visible_rate: percent(familyCore.filter((row) => row.scoreAvailable).length, familyCore.length),
      average_content_value_score: content.length ? Number((content.reduce((sum, row) => sum + Number(row.overall_scan_result_value_score ?? 0), 0) / content.length).toFixed(1)) : null,
      p95_rev1: latencyStats(familyCore.map((row) => row.rev1Ms)).p95,
      p95_done: latencyStats(familyCore.map((row) => row.doneMs)).p95,
      top_missing_data_reason: Object.entries(countBy(familyProducts.flatMap((row) => row.missingCriticalFields.map((field) => ({ field }))), "field"))[0]?.[0] ?? null,
      dedicated_plan_exists: Boolean(catalogEntry?.sources?.includes("section_plan")),
      reviewed_evidence_exists: Boolean(catalogEntry?.sources?.includes("reviewed_evidence")),
      tests_exist: Boolean(catalogEntry?.sources?.includes("tests")),
      runtime_sources: catalogEntry?.sources?.join("|") ?? null,
    };
  });
};

export const productKey = (product) => product?.barcode ? `barcode:${product.barcode}` : product?.productId ? `product:${product.productId}` : `unknown:${safeText(product?.productName)}`;
