#!/usr/bin/env node
/* eslint-disable no-console */
import fs from "node:fs/promises";
import path from "node:path";

const ENABLE_GROUNDEDNESS_LEXICAL = (process.env.RENDER_GROUNDEDNESS_LEXICAL || "0") === "1";
const REQUIRE_FORM_TOKEN_IN_EXCERPT =
  (process.env.RENDER_GROUNDEDNESS_LEXICAL_REQUIRE_FORM || "0") === "1";
const ENFORCE_DEBUG_GATE_NEGATIVE_ASSERTION =
  (process.env.RENDER_ENFORCE_DEBUG_GATE_NEGATIVE || (process.env.GITHUB_EVENT_NAME === "push" ? "1" : "0")) ===
  "1";

// Evidence excerpt index for lexical groundedness checks.
// Note: a single reference can have multiple captured excerpts; key by ref+excerpt.
let evidenceExcerptByRef = null;

const normalizeLex = (value) =>
  String(value || "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();

const buildLexTokens = (value) =>
  normalizeLex(value)
    .split(/\s+/)
    .map((t) => t.trim())
    .filter(Boolean)
    .filter((t) => t.length >= 3);

const dsldNoFormBarcode =
  process.env.RENDER_DSLD_NOFORM_BARCODE || process.env.RENDER_DSLD_BARCODE || "026664275110";
// Keep multiple zinc-citrate samples: catalog/DSLD mappings can drift, and some barcodes may fall back to "not found"
// depending on upstream catalog coverage.
const dsldWithFormBarcode = process.env.RENDER_DSLD_FORM_BARCODE || "05060208412307";
const dsldWithFormBarcodeB = process.env.RENDER_DSLD_FORM_BARCODE2 || "05060370562466";
const dsldWithFormBarcodeC = process.env.RENDER_DSLD_FORM_BARCODE3 || "00690290532093";
// Prefer a picolinate sample where DSLD facts include explicit actives (avoid proprietary-blend-only rows).
const dsldWithFormBarcode2 = process.env.RENDER_DSLD_FORM2_BARCODE || "00854936003044";
const dsldWithFormBarcode2b = process.env.RENDER_DSLD_FORM2_BARCODE2 || "09315771009765";
const dsldWithFormGlycinateBarcode = process.env.RENDER_DSLD_GLYCINATE_BARCODE || "00700461233336";
const dsldWithFormGlycinateBarcode2 = process.env.RENDER_DSLD_GLYCINATE_BARCODE2 || "00700461233350";
// Keep a fallback barcode in case the DSLD mapping drifts.
const dsldWithFormBisglycinateBarcode = process.env.RENDER_DSLD_BISGLYCINATE_BARCODE || "00850025187091";
const dsldWithFormBisglycinateBarcode2 = process.env.RENDER_DSLD_BISGLYCINATE_BARCODE2 || "00323359110306";
const dsldWithFormAscorbateBarcode = process.env.RENDER_DSLD_ASCORBATE_BARCODE || "00708118021602";
const dsldWithFormAscorbateBarcode2 = process.env.RENDER_DSLD_ASCORBATE_BARCODE2 || "00708118010262";
const dsldWithFormCreatineCitrateBarcode =
  process.env.RENDER_DSLD_CREATINE_CITRATE_BARCODE || "00850748005269";
const dsldWithFormCreatineGluconateBarcode =
  process.env.RENDER_DSLD_CREATINE_GLUCONATE_BARCODE || "00851005007415";
const dsldWithFormCreatineMalateBarcode = process.env.RENDER_DSLD_CREATINE_MALATE_BARCODE || "00702669934770";
const dsldWithFormCreatineMalateBarcode2 = process.env.RENDER_DSLD_CREATINE_MALATE_BARCODE2 || "00851005007415";
const dsldWithFormCreatineMalateBarcode3 = process.env.RENDER_DSLD_CREATINE_MALATE_BARCODE3 || "05949106122542";
const dsldWithFormFerrousFumarateBarcode =
  process.env.RENDER_DSLD_FERROUS_FUMARATE_BARCODE || "00696305151204";
const dsldWithFormFerrousFumarateBarcode2 =
  process.env.RENDER_DSLD_FERROUS_FUMARATE_BARCODE2 || "00651074168532";
const dsldWithFormVitaminEAcetateBarcode =
  process.env.RENDER_DSLD_VITE_ACETATE_BARCODE || "00896743002001";
const dsldWithFormCalciumThreonateBarcode =
  process.env.RENDER_DSLD_CALCIUM_THREONATE_BARCODE || "00810487032704";
const dsldWithFormCalciumThreonateBarcode2 =
  process.env.RENDER_DSLD_CALCIUM_THREONATE_BARCODE2 || "00368025052306";
const dsldWithFormCalciumThreonateBarcode3 =
  process.env.RENDER_DSLD_CALCIUM_THREONATE_BARCODE3 || "00368025060301";
const dsldWithFormCarnitineTartrateBarcode =
  process.env.RENDER_DSLD_CARNITINE_TARTRATE_BARCODE || "00646511021792";
const dsldWithFormCarnitineTartrateBarcode2 =
  process.env.RENDER_DSLD_CARNITINE_TARTRATE_BARCODE2 || "00646511022270";
const dsldWithFormCarnitineHclBarcode = process.env.RENDER_DSLD_CARNITINE_HCL_BARCODE || "00853237000929";
const dsldWithFormCarnitineHclBarcode2 = process.env.RENDER_DSLD_CARNITINE_HCL_BARCODE2 || "00367703108205";
const dsldWithFormTocotrienolsBarcode =
  process.env.RENDER_DSLD_TOCOTRIENOLS_BARCODE || "00351821007984";
const dsldWithFormTocotrienolsBarcode2 =
  process.env.RENDER_DSLD_TOCOTRIENOLS_BARCODE2 || "00310539028285";
const lnhpdWithFormBarcode = process.env.RENDER_LNHPD_WITH_FORM_BARCODE || "00029537001069";
const lnhpdWithFormBarcode2 = process.env.RENDER_LNHPD_WITH_FORM_BARCODE2 || "00029537001069";
const lnhpdWithFormBarcode3 = process.env.RENDER_LNHPD_WITH_FORM_BARCODE3 || "00029537001069";

const DEFAULT_CASES = [
  { id: "lnhpd", barcodes: [process.env.RENDER_LNHPD_BARCODE || "00029537001069"], expectedSourceType: "lnhpd" },
  { id: "dsld_no_form", barcodes: [dsldNoFormBarcode], expectedSourceType: "dsld" },
  {
    id: "dsld_with_form",
    barcodes: [dsldWithFormBarcode, dsldWithFormBarcodeB, dsldWithFormBarcodeC],
    expectedSourceType: "dsld",
    requiredFormKeyword: "citrate",
    // Bind assertions to the intended active (avoid passing due to a different citrate ingredient).
    targetActiveKeyword: "zinc citrate",
  },
  {
    id: "dsld_with_form_2",
    barcodes: [dsldWithFormBarcode2, dsldWithFormBarcode2b],
    expectedSourceType: "dsld",
    requiredFormKeyword: "picolinate",
    targetActiveKeyword: "chromium picolinate",
  },
  {
    id: "dsld_with_form_ascorbate",
    barcodes: [dsldWithFormAscorbateBarcode, dsldWithFormAscorbateBarcode2],
    expectedSourceType: "dsld",
    requiredFormKeyword: "ascorbate",
    targetActiveKeyword: "calcium ascorbate",
  },
  {
    id: "dsld_with_form_bisglycinate",
    barcodes: [dsldWithFormBisglycinateBarcode, dsldWithFormBisglycinateBarcode2],
    expectedSourceType: "dsld",
    requiredFormKeyword: "bisglycinate",
    targetActiveKeyword: "zinc bisglycinate",
  },
  {
    id: "dsld_with_form_glycinate",
    barcodes: [dsldWithFormGlycinateBarcode, dsldWithFormGlycinateBarcode2],
    expectedSourceType: "dsld",
    requiredFormKeyword: "glycinate",
    targetActiveKeyword: "magnesium glycinate",
  },
  {
    id: "web",
    barcodes: [process.env.RENDER_WEB_BARCODE || "000000000000", process.env.RENDER_WEB_BARCODE2 || null].filter(
      Boolean,
    ),
    expectedSourceType: "web",
  },
];

const CASES = [...DEFAULT_CASES];
if (process.env.RENDER_INCLUDE_NIGHTLY_CASES === "1") {
  // Non-blocking observation cases: keep out of required checks until stable across multiple runs.
  CASES.splice(CASES.length - 1, 0, {
    id: "lnhpd_with_form_observe",
    barcodes: [lnhpdWithFormBarcode, lnhpdWithFormBarcode2, lnhpdWithFormBarcode3],
    expectedSourceType: "lnhpd",
  });
  CASES.splice(CASES.length - 1, 0, {
    id: "dsld_with_form_calcium_threonate",
    // Prefer barcodes that recently passed in CI first; keep additional fallbacks to reduce drift flakiness.
    barcodes: [
      dsldWithFormCalciumThreonateBarcode2,
      dsldWithFormCalciumThreonateBarcode3,
      dsldWithFormCalciumThreonateBarcode,
    ],
    expectedSourceType: "dsld",
    requiredFormKeyword: "threonate",
    targetActiveKeyword: "calcium threonate",
  });
  CASES.splice(CASES.length - 1, 0, {
    id: "dsld_with_form_carnitine_tartrate",
    barcodes: [dsldWithFormCarnitineTartrateBarcode, dsldWithFormCarnitineTartrateBarcode2],
    expectedSourceType: "dsld",
    requiredFormKeyword: "tartrate",
    targetActiveKeyword: "carnitine tartrate",
  });
  CASES.splice(CASES.length - 1, 0, {
    id: "dsld_with_form_carnitine_hcl",
    barcodes: [dsldWithFormCarnitineHclBarcode, dsldWithFormCarnitineHclBarcode2],
    expectedSourceType: "dsld",
    requiredFormKeyword: "hcl",
    targetActiveKeyword: "carnitine hcl",
  });
  CASES.splice(CASES.length - 1, 0, {
    id: "dsld_with_form_creatine_citrate",
    barcodes: [dsldWithFormCreatineCitrateBarcode],
    expectedSourceType: "dsld",
    requiredFormKeyword: "creatine citrate",
    targetActiveKeyword: "creatine citrate",
  });
  CASES.splice(CASES.length - 1, 0, {
    id: "dsld_with_form_creatine_malate",
    barcodes: [dsldWithFormCreatineMalateBarcode, dsldWithFormCreatineMalateBarcode2, dsldWithFormCreatineMalateBarcode3],
    expectedSourceType: "dsld",
    requiredFormKeyword: "malate",
    targetActiveKeyword: "creatine malate",
  });
  CASES.splice(CASES.length - 1, 0, {
    id: "dsld_with_form_creatine_gluconate",
    barcodes: [dsldWithFormCreatineGluconateBarcode],
    expectedSourceType: "dsld",
    requiredFormKeyword: "gluconate",
    targetActiveKeyword: "creatine gluconate",
  });
  CASES.splice(CASES.length - 1, 0, {
    id: "dsld_with_form_ferrous_fumarate",
    barcodes: [dsldWithFormFerrousFumarateBarcode, dsldWithFormFerrousFumarateBarcode2],
    expectedSourceType: "dsld",
    requiredFormKeyword: "fumarate",
    targetActiveKeyword: "ferrous fumarate",
  });
  CASES.splice(CASES.length - 1, 0, {
    id: "dsld_with_form_vitamin_e_acetate",
    barcodes: [dsldWithFormVitaminEAcetateBarcode],
    expectedSourceType: "dsld",
    requiredFormKeyword: "acetate",
    targetActiveKeyword: "vitamin e acetate",
  });
  CASES.splice(CASES.length - 1, 0, {
    id: "dsld_with_form_tocotrienols",
    barcodes: [dsldWithFormTocotrienolsBarcode, dsldWithFormTocotrienolsBarcode2],
    expectedSourceType: "dsld",
    // Use the singular token for lexical checks; NIH ODS excerpt uses "tocotrienol".
    requiredFormKeyword: "tocotrienol",
    targetActiveKeyword: "tocotrienol",
  });
}

const BASE_URL = process.env.RENDER_BASE_URL;
const SSE_TIMEOUT_MS = Number(process.env.RENDER_SSE_TIMEOUT_MS || 90_000);
const DETAIL_TIMEOUT_MS = Number(process.env.RENDER_DETAIL_TIMEOUT_MS || 45_000);
const ARTIFACT_DIR = process.env.RENDER_ARTIFACT_DIR || "artifacts/render-regression";
const DETAIL_LIMIT = Number(process.env.RENDER_DETAIL_LIMIT || 6);
const DETAIL_MAX_PAGES = Number(process.env.RENDER_DETAIL_MAX_PAGES || 4);

if (!BASE_URL) {
  console.error("RENDER_BASE_URL is required");
  process.exit(1);
}

const buildHeaders = (acceptSse = false, includeRegressionDebug = true) => {
  const headers = {
    "Content-Type": "application/json",
  };
  if (acceptSse) headers.Accept = "text/event-stream";
  if (process.env.RENDER_REGRESSION_TOKEN) {
    headers["x-regression-token"] = process.env.RENDER_REGRESSION_TOKEN;
    if (includeRegressionDebug) headers["x-regression-debug"] = "1";
  } else if (process.env.RENDER_AUTH_DISABLED_HEADER) {
    headers["x-auth-disabled"] = process.env.RENDER_AUTH_DISABLED_HEADER;
  }
  return headers;
};

const ensureDir = async (dir) => {
  await fs.mkdir(dir, { recursive: true });
};

async function readSseEvents(barcode, options = {}) {
  const ctrl = new AbortController();
  const timeoutMs = Number(options.timeoutMs || SSE_TIMEOUT_MS);
  // Grace window after we observe done/pipeline_metrics to allow the other event to arrive.
  // Some server paths emit done and pipeline_metrics very close together (order can vary),
  // and canceling immediately on the first one can drop observability signals.
  const fastTailMs = Number(options.fastTailMs ?? 2500);
  const timeout = setTimeout(() => ctrl.abort(), timeoutMs);

  let res;
  try {
    res = await fetch(`${BASE_URL}/api/enrich-stream`, {
      method: "POST",
      headers: buildHeaders(true, false),
      body: JSON.stringify({ barcode }),
      signal: ctrl.signal,
    });
  } catch (err) {
    // Treat an SSE timeout/abort as a case-level failure (no events), not a fatal crash.
    if (err?.name === "AbortError") return [];
    throw err;
  }

  if (!res.ok) {
    clearTimeout(timeout);
    throw new Error(`enrich-stream HTTP ${res.status}`);
  }

  const reader = res.body?.getReader();
  if (!reader) {
    clearTimeout(timeout);
    throw new Error("enrich-stream missing readable body");
  }

  const decoder = new TextDecoder();
  const events = [];
  let buffer = "";
  let currentEvent = null;
  let currentDataLines = [];
  let sawDone = false;
  let sawPipelineMetrics = false;
  let shouldStopEarly = false;
  let stopAfterAtMs = null;

  const flushEvent = () => {
    if (!currentEvent) return;
    const dataRaw = currentDataLines.join("\n").trim();
    if (!dataRaw) {
      currentEvent = null;
      currentDataLines = [];
      return;
    }

    let parsed = dataRaw;
    try {
      parsed = JSON.parse(dataRaw);
    } catch {
      // keep raw string for diagnostics
    }

    events.push({ event: currentEvent, data: parsed, rawData: dataRaw });
    if (currentEvent === "done") {
      sawDone = true;
      if (!sawPipelineMetrics && stopAfterAtMs == null) {
        stopAfterAtMs = Date.now() + fastTailMs;
      }
    }
    if (currentEvent === "pipeline_metrics") {
      sawPipelineMetrics = true;
      if (!sawDone && stopAfterAtMs == null) {
        stopAfterAtMs = Date.now() + fastTailMs;
      }
    }

    // Stop as soon as we observe both signals; otherwise wait for the grace window (fastTailMs).
    if (sawDone && sawPipelineMetrics) {
      shouldStopEarly = true;
    }

    currentEvent = null;
    currentDataLines = [];
  };

  try {
    outer: while (true) {
      let chunk;
      try {
        chunk = await reader.read();
      } catch (err) {
        if (err?.name === "AbortError") break;
        throw err;
      }

      const { value, done } = chunk;
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split(/\r?\n/);
      buffer = lines.pop() ?? "";

      for (const line of lines) {
        if (line.length === 0) {
          flushEvent();
          if (shouldStopEarly) break outer;
          continue;
        }
        if (line.startsWith("event:")) {
          currentEvent = line.slice(6).trim();
          continue;
        }
        if (line.startsWith("data:")) {
          currentDataLines.push(line.slice(5).trimStart());
        }
      }

      if (!shouldStopEarly && stopAfterAtMs != null && Date.now() >= stopAfterAtMs) {
        shouldStopEarly = true;
      }
    }

    flushEvent();
    return events;
  } finally {
    clearTimeout(timeout);
    try {
      await reader.cancel();
    } catch {}
  }
}

function getBundleEvents(events) {
  return events
    .filter((entry) => entry.event === "analysis_bundle" && entry.data && typeof entry.data === "object")
    .map((entry) => entry.data);
}

function pickFastBundle(bundleEvents) {
  const withMeta = bundleEvents.filter((bundle) => bundle?.meta && typeof bundle.meta === "object");
  const byRevision = [...withMeta].sort((a, b) => (a.meta.revision ?? -1) - (b.meta.revision ?? -1));
  const fast = byRevision.find((bundle) => bundle?.meta?.revision === 1 && bundle?.meta?.phase === "fast_ai");
  if (fast) return fast;
  return byRevision.at(-1) ?? null;
}

function assertBundleContract(bundleEvents, expectedSourceType) {
  const errors = [];

  const hasSkeleton = bundleEvents.some(
    (bundle) => bundle?.meta?.revision === 0 && bundle?.meta?.phase === "skeleton"
  );
  if (!hasSkeleton) {
    errors.push("missing analysis_bundle revision=0 phase=skeleton");
  }

  const hasFast = bundleEvents.some(
    (bundle) => bundle?.meta?.revision === 1 && bundle?.meta?.phase === "fast_ai"
  );
  if (!hasFast) {
    errors.push("missing analysis_bundle revision=1 phase=fast_ai");
  }

  const fastBundle = pickFastBundle(bundleEvents);
  if (!fastBundle) {
    errors.push("missing analysis_bundle payload");
  } else if (fastBundle?.meta?.sourceType !== expectedSourceType) {
    errors.push(
      `unexpected sourceType ${String(fastBundle?.meta?.sourceType)} (expected ${expectedSourceType})`
    );
  }

  return { errors, fastBundle };
}

function assertLnhpdLabelDosingCopied(fastBundle) {
  const errors = [];
  const usage = fastBundle?.sections?.usage;
  const schedule = Array.isArray(usage?.detail?.scheduleFromLabel) ? usage.detail.scheduleFromLabel : [];
  const raw = String(schedule?.[0]?.rawText ?? "").trim();
  const dosage = usage?.cover?.dosage?.text ? String(usage.cover.dosage.text).trim() : "";
  const bestTime = usage?.cover?.bestTimeToTake?.text ? String(usage.cover.bestTimeToTake.text).trim() : "";
  const withFoodText = usage?.cover?.withFood?.text != null ? String(usage.cover.withFood.text).trim() : "";
  const bestTimeTags = Array.isArray(usage?.cover?.bestTimeToTake?.basisTags)
    ? usage.cover.bestTimeToTake.basisTags
    : [];
  const withFoodTags = Array.isArray(usage?.cover?.withFood?.basisTags) ? usage.cover.withFood.basisTags : [];

  if (!raw) {
    errors.push("lnhpd: expected usage.detail.scheduleFromLabel[0].rawText to be non-empty");
    return errors;
  }
  if (!dosage) {
    errors.push("lnhpd: expected usage.cover.dosage.text to be non-empty");
    return errors;
  }
  if (!bestTime) {
    errors.push("lnhpd: expected usage.cover.bestTimeToTake.text to be non-empty");
    return errors;
  }
  if (!withFoodText) {
    errors.push("lnhpd: expected usage.cover.withFood.text to be non-empty");
    return errors;
  }

  const norm = (v) =>
    String(v)
      .toLowerCase()
      .replace(/\s+/g, " ")
      .trim();
  if (!norm(dosage).includes(norm(raw))) {
    errors.push(`lnhpd: expected dosage to include label dosing rawText (dosage="${dosage}" raw="${raw}")`);
  }
  if (/\bunknown\b|\bnot provided\b|\bunspecified\b/i.test(dosage)) {
    errors.push(`lnhpd: dosage must not say unknown/not provided (dosage="${dosage}")`);
  }

  // Best time / with food must be deterministic (0-LLM). Enforce "non-empty + non-negative" semantics.
  // basisTags must never imply unsupported inference.
  const negative = /\bunknown\b|\bnot provided\b|\bunspecified\b/i;
  if (negative.test(bestTime)) {
    errors.push(`lnhpd: bestTimeToTake must not say unknown/not provided (text="${bestTime}")`);
  }
  if (negative.test(withFoodText)) {
    errors.push(`lnhpd: withFood must not say unknown/not provided (text="${withFoodText}")`);
  }

  const allowedTimingTags = new Set(["label_fact", "general_advice"]);
  if (bestTimeTags.some((t) => t === "ingredient_inference")) {
    errors.push(`lnhpd: bestTimeToTake must not be tagged ingredient_inference (tags=${bestTimeTags.join(",")})`);
  }
  if (!bestTimeTags.some((t) => allowedTimingTags.has(t))) {
    errors.push(`lnhpd: bestTimeToTake must include label_fact or general_advice (tags=${bestTimeTags.join(",")})`);
  }

  if (withFoodTags.some((t) => t === "ingredient_inference")) {
    errors.push(`lnhpd: withFood must not be tagged ingredient_inference (tags=${withFoodTags.join(",")})`);
  }
  if (!withFoodTags.some((t) => allowedTimingTags.has(t))) {
    errors.push(`lnhpd: withFood must include label_fact or general_advice (tags=${withFoodTags.join(",")})`);
  }
  return errors;
}

function assertLnhpdDetailNoStorm(detailRequestMetrics) {
  const errors = [];
  if (!detailRequestMetrics) return errors;

  const total = Number(detailRequestMetrics.totalRequests || 0);
  const count429 = Number(detailRequestMetrics.status429Count || 0);
  const perKey = detailRequestMetrics.byKey && typeof detailRequestMetrics.byKey === "object" ? detailRequestMetrics.byKey : {};

  if (count429 > 0) {
    errors.push(`lnhpd: analysis-section returned HTTP 429 ${count429} time(s)`);
  }

  const keys = Object.keys(perKey);
  if (keys.length > 1) {
    errors.push(`lnhpd: expected single detail request key, got ${keys.length}`);
  }

  for (const [key, count] of Object.entries(perKey)) {
    if (Number(count) > 2) {
      errors.push(`lnhpd: detail request storm for key=${key} count=${count} (>2)`);
    }
  }

  if (total > 2) {
    errors.push(`lnhpd: detail request count=${total} (>2)`);
  }

  return errors;
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

let debugGateNegativeAssertionDone = false;

const PIPELINE_STEP_NAMES = ["retrieve", "sanitize", "select_evidence", "draft", "verify", "revise", "emit"];
const percentile = (arr, p) => {
  if (!Array.isArray(arr) || arr.length === 0) return null;
  const sorted = [...arr].sort((a, b) => a - b);
  const idx = Math.max(0, Math.min(sorted.length - 1, Math.floor((p / 100) * (sorted.length - 1))));
  return sorted[idx];
};

function pickLatestPipelineMetrics(events) {
  const metricsEvents = (events || []).filter(
    (entry) => entry?.event === "pipeline_metrics" && entry?.data && typeof entry.data === "object",
  );
  if (!metricsEvents.length) return null;
  const latest = metricsEvents[metricsEvents.length - 1];
  const raw = latest.data;
  const steps = Array.isArray(raw?.steps)
    ? raw.steps
        .map((step) => ({
          step: typeof step?.step === "string" ? step.step : null,
          status: typeof step?.status === "string" ? step.status : null,
          code: typeof step?.code === "string" ? step.code : null,
          ms: Number.isFinite(step?.ms) ? Number(step.ms) : null,
        }))
        .filter((step) => step.step && step.status)
    : [];
  return {
    requestId: typeof raw?.requestId === "string" ? raw.requestId : null,
    barcode: typeof raw?.barcode === "string" ? raw.barcode : null,
    sourceType: typeof raw?.sourceType === "string" ? raw.sourceType : null,
    cacheHit: raw?.cacheHit === true,
    cancelCounts:
      raw?.cancelCounts && typeof raw.cancelCounts === "object"
        ? {
            fast_bundle_replaced_count: Number.isFinite(raw.cancelCounts.fast_bundle_replaced_count)
              ? Number(raw.cancelCounts.fast_bundle_replaced_count)
              : 0,
            fallback_rev1_locked_count: Number.isFinite(raw.cancelCounts.fallback_rev1_locked_count)
              ? Number(raw.cancelCounts.fallback_rev1_locked_count)
              : 0,
          }
        : null,
    totalMs: Number.isFinite(raw?.totalMs) ? Number(raw.totalMs) : null,
    emittedAt: typeof raw?.emittedAt === "string" ? raw.emittedAt : null,
    steps,
  };
}

function pickDoneReason(events) {
  const doneEvents = (events || []).filter((entry) => entry?.event === "done");
  if (!doneEvents.length) return null;
  const latest = doneEvents[doneEvents.length - 1];
  const data = latest?.data;
  if (data && typeof data === "object" && typeof data.reason === "string") return data.reason;
  if (typeof data === "string") return data;
  return null;
}

function summarizePipelineMetrics(runResults) {
  const rows = (runResults || [])
    .map((item) => item?.summary?.pipelineMetrics)
    .filter((metrics) => metrics && typeof metrics === "object");
  const totalRuns = runResults.length;
  const totalMsValues = rows
    .map((metrics) => metrics.totalMs)
    .filter((value) => Number.isFinite(value) && value >= 0);
  const sortedMs = [...totalMsValues].sort((a, b) => a - b);
  const previewHead = sortedMs.slice(0, 3);
  const previewTail = sortedMs.slice(-3);
  const failureCodeCounts = {};
  for (const metrics of rows) {
    const steps = Array.isArray(metrics.steps) ? metrics.steps : [];
    for (const step of steps) {
      if (step?.status !== "degraded" && step?.status !== "failed") continue;
      const key = step?.code || `${step?.step}_${step?.status}`;
      failureCodeCounts[key] = (failureCodeCounts[key] || 0) + 1;
    }
  }
  const stepCoverage = Object.fromEntries(
    PIPELINE_STEP_NAMES.map((stepName) => {
      const seen = rows.filter((metrics) => {
        const steps = Array.isArray(metrics.steps) ? metrics.steps : [];
        return steps.some((step) => step?.step === stepName);
      }).length;
      return [stepName, {
        count: seen,
        ratio: rows.length > 0 ? seen / rows.length : 0,
      }];
    }),
  );

  const totalMsP10 = percentile(totalMsValues, 10);
  const totalMsP50 = percentile(totalMsValues, 50);
  const totalMsP90 = percentile(totalMsValues, 90);
  const totalMsAvg =
    totalMsValues.length > 0
      ? Math.round(totalMsValues.reduce((sum, value) => sum + value, 0) / totalMsValues.length)
      : null;
  // Basic sanity: percentiles should be monotonic; if violated, treat metrics as invalid noise.
  const metricsInvalid =
    totalMsValues.length >= 2 &&
    totalMsP10 != null &&
    totalMsP50 != null &&
    totalMsP90 != null &&
    (totalMsP10 > totalMsP50 || totalMsP50 > totalMsP90);
  const suspiciousMeanGtP90 = totalMsAvg != null && totalMsP90 != null && totalMsAvg > totalMsP90;

  return {
    totalRuns,
    pipelineMetricsCount: rows.length,
    coverageRatio: totalRuns > 0 ? rows.length / totalRuns : 0,
    samplesCount: totalMsValues.length,
    sortedPreviewMs: { head: previewHead, tail: previewTail },
    metrics_invalid: metricsInvalid,
    suspiciousMeanGtP90,
    totalMsAvg: metricsInvalid ? null : totalMsAvg,
    totalMsP10: metricsInvalid ? null : totalMsP10,
    totalMsP50: metricsInvalid ? null : totalMsP50,
    totalMsP90: metricsInvalid ? null : totalMsP90,
    failureCodeCounts,
    stepCoverage,
  };
}

const average = (values) => {
  const valid = values.filter((value) => Number.isFinite(value));
  if (!valid.length) return null;
  return Number((valid.reduce((sum, value) => sum + value, 0) / valid.length).toFixed(4));
};

function summarizeRagQuadrantMetrics(runResults) {
  const webRows = (runResults || []).filter((item) => item?.summary?.sourceType === "web");
  const webTotal = webRows.length;
  const extractStep = (steps, stepName) =>
    Array.isArray(steps) ? steps.find((step) => step?.step === stepName) || null : null;

  const retrievalFailureCodeCounts = {};
  const retrievalHits = webRows.filter((row) => {
    const steps = row?.summary?.pipelineMetrics?.steps || row?.summary?.webPipeline || [];
    const selectEvidence = extractStep(steps, "select_evidence");
    if (!selectEvidence) {
      retrievalFailureCodeCounts["select_evidence_missing"] = (retrievalFailureCodeCounts["select_evidence_missing"] || 0) + 1;
      return false;
    }
    if (selectEvidence.status === "ok") return true;
    const key = selectEvidence.code || `${selectEvidence.step}_${selectEvidence.status}`;
    retrievalFailureCodeCounts[key] = (retrievalFailureCodeCounts[key] || 0) + 1;
    return false;
  }).length;

  const ABSTAIN_CODES = new Set(["web_text_unusable", "no_text_facts", "web_sanitize_failed"]);
  const abstainUnknownReasonCounts = {};
  const recordUnknown = (reason) => {
    abstainUnknownReasonCounts[reason] = (abstainUnknownReasonCounts[reason] || 0) + 1;
  };
  const limitedOrNotProvided = (value) => value === "limited" || value === "not_provided";
  const chemicalFormNotProvided = (items) =>
    items.every((item) => {
      const field = item?.chemicalFormExplain;
      if (!field || typeof field !== "object") return false;
      const text = typeof field.text === "string" ? field.text : "";
      const tags = Array.isArray(field.basisTags) ? field.basisTags : [];
      if (tags.includes("not_provided")) return true;
      return /chemical form not provided/i.test(text);
    });

  let abstainTriggeredCount = 0;
  let abstainEvaluatedCount = 0;
  let abstainCorrectCount = 0;
  let abstainUnknownCount = 0;
  let abstainFallbackHeuristicCount = 0;

  for (const row of webRows) {
    const steps = row?.summary?.pipelineMetrics?.steps || row?.summary?.webPipeline || [];
    const selectEvidence = extractStep(steps, "select_evidence");
    const fallbackCode =
      row?.summary?.fallback?.code ?? row?.summary?.fallbackReason ?? row?.summary?.webVerifyMeta?.fallbackCode ?? null;
    const abstainTriggered =
      (typeof fallbackCode === "string" && ABSTAIN_CODES.has(fallbackCode)) ||
      (selectEvidence && selectEvidence.status === "failed");
    if (!abstainTriggered) continue;

    abstainTriggeredCount += 1;

    const fastBundle = row?.fastBundle;
    if (!fastBundle || typeof fastBundle !== "object") {
      abstainUnknownCount += 1;
      recordUnknown("fast_bundle_missing");
      continue;
    }

    const overviewStatus = fastBundle?.sections?.overview?.dataStatus ?? null;
    const ingredientsStatus = fastBundle?.sections?.ingredients?.dataStatus ?? null;

    if (!limitedOrNotProvided(overviewStatus)) {
      abstainEvaluatedCount += 1;
      continue;
    }

    const items = fastBundle?.sections?.ingredients?.detail?.items;
    if (Array.isArray(items)) {
      abstainEvaluatedCount += 1;
      if (items.length === 0 || chemicalFormNotProvided(items)) {
        abstainCorrectCount += 1;
      }
      continue;
    }

    // Fallback heuristic: if both overview + ingredients are already degraded, count as correct
    // even if ingredient detail items were omitted from the fast bundle.
    if (limitedOrNotProvided(overviewStatus) && limitedOrNotProvided(ingredientsStatus)) {
      abstainEvaluatedCount += 1;
      abstainCorrectCount += 1;
      abstainFallbackHeuristicCount += 1;
      continue;
    }

    abstainUnknownCount += 1;
    recordUnknown(ingredientsStatus == null ? "ingredients_section_missing" : "ingredients_detail_missing");
  }

  // Soft signal (observe-only): if a known "abstain sentinel" barcode is present in the run,
  // but we didn't record any abstain trigger, we likely lost our guardrail signal.
  //
  // This must not fail runs by itself; it is printed in nightly summaries and recorded in artifacts.
  const abstainSentinelBarcode =
    process.env.RENDER_WEB_ABSTAIN_SENTINEL_BARCODE ||
    // Default: keep the signal tied to the primary web barcode for schedule/nightly.
    process.env.RENDER_WEB_BARCODE ||
    "";
  const abstainSentinelSeen =
    Boolean(abstainSentinelBarcode) &&
    webRows.some((row) => {
      const s = row?.summary || {};
      return (
        s.usedBarcode === abstainSentinelBarcode ||
        s.primaryBarcode === abstainSentinelBarcode ||
        s.barcode === abstainSentinelBarcode
      );
    });
  const abstainSignalLost = abstainSentinelSeen && abstainTriggeredCount === 0;

  let noClaimsVerifiedCount = 0;

  const supportProxyValues = webRows.map((row) => {
    const meta = row?.summary?.webVerifyMeta;
    const checked = Number(meta?.checkedClaimsCount ?? 0);
    if (!Number.isFinite(checked) || checked <= 0) {
      noClaimsVerifiedCount += 1;
      return null;
    }

    const supportedRaw = meta?.supportedClaimsCount;
    const unsupportedRaw = meta?.unsupportedClaimsCount;
    const supported =
      Number.isFinite(supportedRaw)
        ? Number(supportedRaw)
        : Number.isFinite(unsupportedRaw)
          ? Math.max(0, checked - Number(unsupportedRaw))
          : null;
    if (supported == null) return null;
    return supported / Math.max(1, checked);
  });

  const faithfulnessProxyValues = webRows.map((row) => {
    const meta = row?.summary?.webVerifyMeta;
    const checked = Number(meta?.checkedClaimsCount ?? 0);
    if (!Number.isFinite(checked) || checked <= 0) return null;

    const status = meta?.verifyStatus;
    if (status === "ok") return 1;
    if (status === "degraded") return 0.5;
    if (status === "failed") return 0;
    return null;
  });
  const faithfulnessProxyScoreValue = average(faithfulnessProxyValues);
  const postRationalizationProxyRateValue =
    faithfulnessProxyScoreValue == null ? null : Number((1 - faithfulnessProxyScoreValue).toFixed(4));

  // Web watchdog: quantify how often the fast path times out (without being diluted by cache hits).
  const WATCHDOG_CODE = "watchdog_fast_timeout";
  const isWatchdogRow = (row) =>
    row?.summary?.doneReason === WATCHDOG_CODE || row?.summary?.bundleFallbackCode === WATCHDOG_CODE;
  const watchdogFastTimeoutSeenInDoneReasonCount = webRows.filter((row) => row?.summary?.doneReason === WATCHDOG_CODE).length;
  const watchdogFastTimeoutSeenInBundleCount = webRows.filter((row) => row?.summary?.bundleFallbackCode === WATCHDOG_CODE).length;
  const watchdogFastTimeoutMismatchCount = webRows.filter((row) => {
    const a = row?.summary?.doneReason === WATCHDOG_CODE;
    const b = row?.summary?.bundleFallbackCode === WATCHDOG_CODE;
    return a !== b;
  }).length;
  const watchdogMetricsInvalid = watchdogFastTimeoutMismatchCount > 0;
  const watchdogFastTimeoutCount = webRows.filter((row) => isWatchdogRow(row)).length;

  const cacheHitCount = webRows.filter((row) => row?.summary?.pipelineMetrics?.cacheHit === true).length;
  const cacheHitRate = webTotal > 0 ? Number((cacheHitCount / webTotal).toFixed(4)) : null;
  const watchdogFastTimeoutRateAll =
    webTotal > 0 ? Number((watchdogFastTimeoutCount / webTotal).toFixed(4)) : null;
  const denomNoCache = Math.max(1, webTotal - cacheHitCount);
  const watchdogFastTimeoutRateNoCache =
    webTotal > 0 ? Number((watchdogFastTimeoutCount / denomNoCache).toFixed(4)) : null;

  const watchdogFastTimeoutBucketCounts = {};
  for (const row of webRows.filter((row) => isWatchdogRow(row))) {
    const steps = row?.summary?.pipelineMetrics?.steps || row?.summary?.webPipeline || [];
    let bucket = null;
    // 1) Failed step code
    for (const stepName of PIPELINE_STEP_NAMES) {
      const step = extractStep(steps, stepName);
      if (!step) continue;
      if (step.status === "failed") {
        bucket = step.code || `${step.step}_failed`;
        break;
      }
    }
    // 2) Blocked-by root cause
    if (!bucket) {
      for (const stepName of PIPELINE_STEP_NAMES) {
        const step = extractStep(steps, stepName);
        const code = step?.code;
        if (typeof code === "string" && code.startsWith("blocked_by:")) {
          bucket = code.slice("blocked_by:".length) || "blocked_by_unknown";
          break;
        }
      }
    }
    // 3) Time budget exhausted with no explicit root cause
    if (!bucket) bucket = "time_budget_exhausted";
    watchdogFastTimeoutBucketCounts[bucket] = (watchdogFastTimeoutBucketCounts[bucket] || 0) + 1;
  }

  return {
    sampleSize: webTotal,
    retrievalEvidenceHitRate: webTotal > 0 ? Number((retrievalHits / webTotal).toFixed(4)) : null,
    retrievalFailureCodeCounts,
    abstainCorrectnessRate:
      abstainEvaluatedCount > 0 ? Number((abstainCorrectCount / abstainEvaluatedCount).toFixed(4)) : null,
    abstainTriggeredCount,
    abstainEvaluatedCount,
    abstainCorrectCount,
    abstainUnknownCount,
    abstainUnknownReasonCounts,
    abstainFallbackHeuristicCount,
    abstainSignalLost,
    supportProxyScore: {
      value: average(supportProxyValues),
      isProxy: true,
      sampleSize: webTotal,
      noClaimsVerifiedCount,
    },
    faithfulnessProxyScore: {
      value: faithfulnessProxyScoreValue,
      isProxy: true,
      sampleSize: webTotal,
      noClaimsVerifiedCount,
    },
    postRationalizationProxyRate: {
      value: postRationalizationProxyRateValue,
      isProxy: true,
      sampleSize: webTotal,
      noClaimsVerifiedCount,
    },
    watchdogFastTimeoutSeenInDoneReasonCount,
    watchdogFastTimeoutSeenInBundleCount,
    watchdogFastTimeoutMismatchCount,
    watchdogMetricsInvalid,
    cacheHitCount,
    cacheHitRate,
    watchdogFastTimeoutCount,
    watchdogFastTimeoutRateAll,
    watchdogFastTimeoutRateNoCache,
    watchdogFastTimeoutBucketCounts,
    webUsefulOutputRate: (() => {
      if (webTotal <= 0) return null;
      const usefulCount = webRows.filter((row) => {
        const b = row?.fastBundle;
        if (!b || typeof b !== "object") return false;
        const statuses = [
          b?.sections?.overview?.dataStatus,
          b?.sections?.ingredients?.dataStatus,
          b?.sections?.usage?.dataStatus,
          b?.sections?.safety?.dataStatus,
        ];
        const okCount = statuses.filter((s) => s === "complete" || s === "limited").length;
        return okCount >= 2;
      }).length;
      return Number((usefulCount / webTotal).toFixed(4));
    })(),
  };
}

const buildDetailRequestKey = (payload) =>
  [
    `${payload?.identity?.type || "unknown"}:${payload?.identity?.value || "unknown"}`,
    payload?.section || "unknown",
    payload?.locale || "unknown",
    payload?.promptVersion || "unknown",
    payload?.factsDigestHash || "unknown",
  ].join("|");

const createDetailRequestMetrics = () => ({
  totalRequests: 0,
  status429Count: 0,
  byKey: {},
});

async function assertInternalDebugGated(fastBundle) {
  const errors = [];
  const res = await fetchIngredientsDetailPage(fastBundle, 0, { includeRegressionDebug: false, retryOn5xx: true });
  if (res.status !== 200) {
    errors.push(`debug gate check: expected HTTP 200 from analysis-section (got ${res.status})`);
    return errors;
  }

  const dbg = res?.response?.debug;
  if (!dbg) return errors;

  const forbiddenKeys = [
    "formResolveSources",
    "formEvidenceTexts",
    "formSentenceIds",
    "formExcerptIds",
    "formReferenceIds",
    "formEvidenceGrades",
    "formSupportStrengths",
  ];

  const leaked = forbiddenKeys.filter((k) => Object.prototype.hasOwnProperty.call(dbg, k));
  if (leaked.length) {
    errors.push(`debug gate check: unexpected debug fields without x-regression-debug: ${leaked.join(", ")}`);
  }
  return errors;
}

async function fetchIngredientsDetailPage(fastBundle, cursor, opts = {}) {
  const identity = fastBundle?.meta?.authoritativeIdentity;
  if (!identity?.type || !identity?.value) {
    throw new Error("analysis_bundle missing authoritativeIdentity");
  }

  const includeRegressionDebug = opts?.includeRegressionDebug !== false;
  const retryOn5xx = opts?.retryOn5xx === true;
  const max5xxRetries = Math.max(0, Number(opts?.max5xxRetries ?? (retryOn5xx ? 2 : 0)));
  const payload = {
    identity,
    section: "ingredients_detail",
    locale: fastBundle?.meta?.locale || "en",
    promptVersion: fastBundle?.meta?.promptVersion,
    factsDigestHash: fastBundle?.meta?.factsDigestHash,
    limit: DETAIL_LIMIT,
    cursor,
  };
  const requestKey = buildDetailRequestKey(payload);
  const requestMetrics = opts?.requestMetrics ?? null;

  const startedAt = Date.now();
  let pollAttempts = 0;
  let serverErrorRetries = 0;
  while (true) {
    pollAttempts += 1;
    const ctrl = new AbortController();
    const timeout = setTimeout(() => ctrl.abort(), DETAIL_TIMEOUT_MS);

    if (requestMetrics) {
      requestMetrics.totalRequests += 1;
      requestMetrics.byKey[requestKey] = (requestMetrics.byKey[requestKey] || 0) + 1;
    }

    const res = await fetch(`${BASE_URL}/api/analysis-section`, {
      method: "POST",
      headers: buildHeaders(false, includeRegressionDebug),
      body: JSON.stringify(payload),
      signal: ctrl.signal,
    });
    if (requestMetrics && res.status === 429) {
      requestMetrics.status429Count += 1;
    }

    clearTimeout(timeout);

    let json;
    try {
      json = await res.json();
    } catch {
      json = { parseError: "invalid_json" };
    }

    // Keep LNHPD "no-storm" assertions strict by default; only retry 5xx when explicitly enabled.
    if (retryOn5xx && res.status >= 500 && res.status < 600 && serverErrorRetries < max5xxRetries) {
      serverErrorRetries += 1;
      const elapsed = Date.now() - startedAt;
      if (elapsed >= DETAIL_TIMEOUT_MS) {
        return { status: res.status, payload, response: json, pollAttempts };
      }
      // Deterministic backoff to reduce flaky 502/503/504 without masking persistent outages.
      const delayMs = Math.min(2000, 300 * Math.pow(3, serverErrorRetries - 1)); // 300ms, 900ms, 2000ms
      await sleep(delayMs);
      continue;
    }

    if (res.status !== 202) {
      return { status: res.status, payload, response: json, pollAttempts };
    }

    const retryAfterMs = Number(json?.retryAfterMs ?? 2000);
    const elapsed = Date.now() - startedAt;
    if (elapsed >= DETAIL_TIMEOUT_MS) {
      return { status: res.status, payload, response: json, pollAttempts };
    }

    await sleep(Math.min(Math.max(retryAfterMs, 250), 5000));
  }
}

function assertDetailContract(detailResponse) {
  const errors = [];
  if (detailResponse.status !== 200) {
    errors.push(`analysis-section HTTP ${detailResponse.status}`);
    return errors;
  }

  const body = detailResponse.response;
  if (body?.section !== "ingredients") {
    errors.push(`analysis-section section=${String(body?.section)} (expected ingredients)`);
  }

  const dataStatus = body?.dataStatus;
  const allowedStatus = ["complete", "limited", "not_provided", "error", "pending"];
  if (!allowedStatus.includes(dataStatus)) {
    errors.push(`analysis-section invalid dataStatus=${String(dataStatus)}`);
  }

  if (dataStatus === "pending") {
    errors.push("analysis-section returned pending; expected terminal response");
  }

  return errors;
}

function assertDsldWithFormKbHit(detailResponse, testCase) {
  const errors = [];
  const caseId = testCase.id;
  if (detailResponse.status !== 200) return errors;
  const body = detailResponse.response;

  const items = body?.detail?.items;
  if (!Array.isArray(items)) {
    errors.push(`${caseId}: analysis-section missing detail.items`);
    return errors;
  }

  const requiredKeyword = String(testCase.requiredFormKeyword ?? "").trim().toLowerCase();
  const targetKeyword = String(testCase.targetActiveKeyword ?? requiredKeyword).trim().toLowerCase();
  const matchesTarget = (name) => {
    const s = String(name ?? "").toLowerCase();
    if (targetKeyword && !s.includes(targetKeyword)) return false;
    if (requiredKeyword && !s.includes(requiredKeyword)) return false;
    return true;
  };

  // P0-A: Confirm a true KB sentence was used, not just a non-empty string.
  // Bind the assertion to the intended active item (avoid passing due to a different ingredient).
  const hasKbSentence = items.some((item) => {
    if (!matchesTarget(item?.name)) return false;
    const tags = item?.chemicalFormExplain?.basisTags;
    return Array.isArray(tags) && tags.includes("ingredient_inference");
  });
  if (!hasKbSentence) {
    errors.push(
      `${caseId}: expected at least one chemicalFormExplain tagged ingredient_inference` +
        (targetKeyword ? ` (target=${targetKeyword})` : "") +
        (requiredKeyword && requiredKeyword !== targetKeyword ? ` (required=${requiredKeyword})` : "") +
        ` (true KB sentence)`
    );
  }

  // P0-2 (stronger): confirm sentenceId/excerptId is present (true KB hit, not rule text).
  const sentenceIds = body?.debug?.formSentenceIds;
  const hasSentenceId =
    sentenceIds && typeof sentenceIds === "object"
      ? Object.entries(sentenceIds).some(
          ([k, value]) => matchesTarget(k) && typeof value === "string" && value.startsWith("s_")
        )
      : false;
  if (!hasSentenceId) {
    errors.push(
      `${caseId}: expected at least one debug.formSentenceIds entry` +
        (targetKeyword ? ` (target=${targetKeyword})` : "") +
        ` (true KB hit)`
    );
  }

  const excerptIds = body?.debug?.formExcerptIds;
  const hasExcerptId =
    excerptIds && typeof excerptIds === "object"
      ? Object.entries(excerptIds).some(
          ([k, value]) => matchesTarget(k) && typeof value === "string" && value.startsWith("x_")
        )
      : false;
  if (!hasExcerptId) {
    errors.push(
      `${caseId}: expected at least one debug.formExcerptIds entry` +
        (targetKeyword ? ` (target=${targetKeyword})` : "") +
        ` (grounded excerpt id)`
    );
  }

  const referenceIds = body?.debug?.formReferenceIds;
  const hasReferenceId =
    referenceIds && typeof referenceIds === "object"
      ? Object.entries(referenceIds).some(
          ([k, value]) => matchesTarget(k) && typeof value === "string" && value.startsWith("ref_")
        )
      : false;
  if (!hasReferenceId) {
    errors.push(
      `${caseId}: expected at least one debug.formReferenceIds entry` +
        (targetKeyword ? ` (target=${targetKeyword})` : "") +
        ` (grounded reference id)`
    );
  }

  if (ENABLE_GROUNDEDNESS_LEXICAL) {
    const refMap = referenceIds && typeof referenceIds === "object" ? referenceIds : null;
    const xMap = excerptIds && typeof excerptIds === "object" ? excerptIds : null;
    if (refMap && xMap && evidenceExcerptByRef) {
      const targetRef = Object.entries(refMap).find(
        ([k, v]) => matchesTarget(k) && typeof v === "string" && v.startsWith("ref_")
      );
      const targetX = Object.entries(xMap).find(
        ([k, v]) => matchesTarget(k) && typeof v === "string" && v.startsWith("x_")
      );
      const refId = targetRef?.[1] ?? null;
      const excerptId = targetX?.[1] ?? null;
      const row = refId && excerptId ? evidenceExcerptByRef.get(`${refId}|${excerptId}`) : null;
      const excerptText = row?.excerpt_text ? String(row.excerpt_text) : "";

      if (!refId || !excerptId) {
        errors.push(`${caseId}: lexical check missing refId/excerptId (target=${targetKeyword || requiredKeyword})`);
      } else if (!row) {
        errors.push(`${caseId}: lexical check missing evidence excerpt row for ${refId} excerpt=${excerptId}`);
      } else if (!excerptText.trim()) {
        errors.push(`${caseId}: lexical check excerpt_text empty for ${refId}`);
      } else {
        const claimTokens = buildLexTokens(targetKeyword || requiredKeyword);
        const formTokens = requiredKeyword ? buildLexTokens(requiredKeyword) : [];
        const hay = normalizeLex(excerptText);

        const hasAnyClaimToken = claimTokens.length ? claimTokens.some((t) => hay.includes(t)) : true;
        if (!hasAnyClaimToken) {
          errors.push(
            `${caseId}: lexical check failed (no claim tokens found in excerpt)` +
              ` claimTokens=${claimTokens.join("|")} ref=${refId}`
          );
        }

        if (REQUIRE_FORM_TOKEN_IN_EXCERPT && formTokens.length) {
          const hasForm = formTokens.some((t) => hay.includes(t));
          if (!hasForm) {
            errors.push(
              `${caseId}: lexical check failed (no form tokens found in excerpt)` +
                ` formTokens=${formTokens.join("|")} ref=${refId}`
            );
          }
        }
      }
    }
  }

  const sources = body?.debug?.formResolveSources;
  if (!sources || typeof sources !== "object") {
    errors.push(`${caseId}: missing debug.formResolveSources`);
    return errors;
  }
  const hasNonNone = Object.entries(sources).some(
    ([k, value]) => matchesTarget(k) && typeof value === "string" && value !== "none"
  );
  if (!hasNonNone) {
    errors.push(
      `${caseId}: expected at least one formResolveSource != none` +
        (targetKeyword ? ` (target=${targetKeyword})` : "")
    );
  }

  return errors;
}

function assertLnhpdWithFormEvidence(detailResponse, testCase) {
  const errors = [];
  const caseId = testCase.id;
  if (detailResponse.status !== 200) return errors;
  const body = detailResponse.response;

  const items = body?.detail?.items;
  if (!Array.isArray(items) || items.length === 0) {
    errors.push(`${caseId}: analysis-section missing detail.items`);
    return errors;
  }

  const sentenceIds = body?.debug?.formSentenceIds;
  const excerptIds = body?.debug?.formExcerptIds;
  const referenceIds = body?.debug?.formReferenceIds;

  const isEvidenceItem = (it) => {
    const tags = it?.chemicalFormExplain?.basisTags;
    const text = String(it?.chemicalFormExplain?.text ?? "");
    if (!Array.isArray(tags) || !tags.length) return false;
    if (tags.includes("not_provided")) return false;
    // evidence-only fallback is acceptable: label_fact without KB IDs
    if (tags.includes("label_fact") && /listed on the label as:/i.test(text)) return true;
    if (tags.includes("label_fact") && /^chemical form:/i.test(text)) return true;
    // grounded KB sentence is ideal: ingredient_inference + IDs
    if (tags.includes("ingredient_inference")) {
      const name = String(it?.name ?? "");
      const sid = sentenceIds && typeof sentenceIds === "object" ? sentenceIds[name] : null;
      const xid = excerptIds && typeof excerptIds === "object" ? excerptIds[name] : null;
      const ref = referenceIds && typeof referenceIds === "object" ? referenceIds[name] : null;
      return (
        typeof sid === "string" &&
        sid.startsWith("s_") &&
        typeof xid === "string" &&
        xid.startsWith("x_") &&
        typeof ref === "string" &&
        ref.startsWith("ref_")
      );
    }
    return false;
  };

  const isExplicitAbstain = (it) => {
    const tags = it?.chemicalFormExplain?.basisTags;
    const text = String(it?.chemicalFormExplain?.text ?? "");
    if (!Array.isArray(tags) || !tags.length) return false;
    if (!tags.includes("not_provided")) return false;
    // Guard against empty placeholders: we want the abstain to be user-facing and explicit.
    return /not disclosed|not specified|don't assume|do not assume|does not specify/i.test(text);
  };

  const isUnsafeClaimWithoutEvidence = (it) => {
    const tags = it?.chemicalFormExplain?.basisTags;
    if (!Array.isArray(tags) || !tags.length) return false;
    if (tags.includes("not_provided")) return false;
    return !isEvidenceItem(it);
  };

  const hasAnyEvidenceItem = items.some(isEvidenceItem);
  const hasAnyExplicitAbstain = items.some(isExplicitAbstain);
  const hasUnsafeClaim = items.some(isUnsafeClaimWithoutEvidence);

  if (hasUnsafeClaim) {
    errors.push(`${caseId}: found chemicalFormExplain claim without evidence (expected evidence or not_provided abstain)`);
    return errors;
  }

  // This observe case is allowed to PASS in two safe modes:
  // 1) At least one active has evidence-backed chemical form text; OR
  // 2) The label does not disclose forms and we explicitly abstain (not_provided).
  if (!hasAnyEvidenceItem && !hasAnyExplicitAbstain) {
    errors.push(
      `${caseId}: expected at least one LNHPD active with chemical-form evidence OR explicit abstain (not_provided)`,
    );
  }

  return errors;
}

function pickKeyFields(result) {
  const fastBundle = result.fastBundle;
  const detail = result.detailResponse?.response;
  const debug = detail?.debug;

  const formResolveSources =
    debug?.formResolveSources && typeof debug.formResolveSources === "object" ? debug.formResolveSources : null;
  const formSentenceIds =
    debug?.formSentenceIds && typeof debug.formSentenceIds === "object" ? debug.formSentenceIds : null;
  const formExcerptIds =
    debug?.formExcerptIds && typeof debug.formExcerptIds === "object" ? debug.formExcerptIds : null;
  const formReferenceIds =
    debug?.formReferenceIds && typeof debug.formReferenceIds === "object" ? debug.formReferenceIds : null;

  const nonNoneSources = formResolveSources
    ? Object.fromEntries(Object.entries(formResolveSources).filter(([, v]) => typeof v === "string" && v !== "none"))
    : null;
  const sentenceIdHits = formSentenceIds
    ? Object.fromEntries(Object.entries(formSentenceIds).filter(([, v]) => typeof v === "string" && v.startsWith("s_")))
    : null;
  const excerptIdHits = formExcerptIds
    ? Object.fromEntries(Object.entries(formExcerptIds).filter(([, v]) => typeof v === "string" && v.startsWith("x_")))
    : null;
  const referenceIdHits = formReferenceIds
    ? Object.fromEntries(Object.entries(formReferenceIds).filter(([, v]) => typeof v === "string" && v.startsWith("ref_")))
    : null;

  const supportStrengths =
    debug?.formSupportStrengths && typeof debug.formSupportStrengths === "object" ? debug.formSupportStrengths : null;

  // A2 minimal evidence structure (debug/CI-only): claimId + supportingExcerptIds + supportStrength
  // Bind to the intended active keyword when provided, to avoid passing due to a different ingredient.
  let groundednessClaims = null;
  if (
    fastBundle?.meta?.sourceType === "dsld" &&
    Array.isArray(detail?.detail?.items) &&
    debug &&
    formExcerptIds &&
    supportStrengths &&
    fastBundle?.meta?.authoritativeIdentity?.type &&
    fastBundle?.meta?.authoritativeIdentity?.value
  ) {
    const requiredKeyword = String(result.case.requiredFormKeyword ?? "").trim().toLowerCase();
    const targetKeyword = String(result.case.targetActiveKeyword ?? requiredKeyword).trim().toLowerCase();
    const matchesTarget = (name) => {
      const s = String(name ?? "").toLowerCase();
      if (targetKeyword && !s.includes(targetKeyword)) return false;
      if (requiredKeyword && !s.includes(requiredKeyword)) return false;
      return true;
    };

    const cursorBase = Number(result.detailResponse?.payload?.cursor ?? 0) || 0;
    const idType = fastBundle.meta.authoritativeIdentity.type;
    const idValue = fastBundle.meta.authoritativeIdentity.value;
    groundednessClaims = detail.detail.items
      .map((item, idx) => {
        if (!matchesTarget(item?.name)) return null;
        const name = String(item?.name ?? "");
        const excerptId = formExcerptIds?.[name] ?? null;
        const supportStrength = supportStrengths?.[name] ?? null;
        const claimIndex = cursorBase + idx;
        const claimId = `v4:dsld:${idType}:${idValue}:ingredients:chemicalFormExplain:${claimIndex}`;
        return {
          name,
          claimId,
          supportingExcerptIds: typeof excerptId === "string" && excerptId.startsWith("x_") ? [excerptId] : [],
          supportStrength:
            supportStrength === "strong" || supportStrength === "moderate" || supportStrength === "weak"
              ? supportStrength
              : null,
        };
      })
      .filter(Boolean);
    if (!groundednessClaims.length) groundednessClaims = null;
  }

  const fallbackCode = detail?.meta?.fallback?.code ?? detail?.meta?.fallbackReason ?? null;

  return {
    barcode: result.case.barcode,
    caseId: result.case.id,
    expectedSourceType: result.case.expectedSourceType,
    requiredFormKeyword: result.case.requiredFormKeyword ?? null,
    targetActiveKeyword: result.case.targetActiveKeyword ?? null,
    sourceType: fastBundle?.meta?.sourceType,
    promptVersion: fastBundle?.meta?.promptVersion ?? null,
    serverCommitSha: fastBundle?.meta?.serverCommitSha ?? null,
    bundleId: fastBundle?.meta?.bundleId ?? null,
    revision: fastBundle?.meta?.revision ?? null,
    phase: fastBundle?.meta?.phase ?? null,
    factsDigestHash: fastBundle?.meta?.factsDigestHash ?? null,
    factsSourceVersion: fastBundle?.meta?.factsSourceVersion ?? null,
    dataStatus: detail?.dataStatus ?? null,
    fallbackUsed: detail?.meta?.fallbackUsed ?? null,
    fallback: detail?.meta?.fallback ?? (fallbackCode ? { code: fallbackCode } : null),
    fallbackReason: fallbackCode,
    jobStatus: detail?.meta?.jobStatus ?? null,
    attempts: detail?.meta?.attempts ?? null,
    timingMs: detail?.timingMs ?? null,
    detailCursorUsed: result.detailResponse?.payload?.cursor ?? null,
    formResolveSourcesNonNoneCount: nonNoneSources ? Object.keys(nonNoneSources).length : null,
    formResolveSourcesNonNone: nonNoneSources,
    formSentenceIdHitsCount: sentenceIdHits ? Object.keys(sentenceIdHits).length : null,
    formSentenceIdHits: sentenceIdHits,
    formExcerptIdHitsCount: excerptIdHits ? Object.keys(excerptIdHits).length : null,
    formExcerptIdHits: excerptIdHits,
    formReferenceIdHitsCount: referenceIdHits ? Object.keys(referenceIdHits).length : null,
    formReferenceIdHits: referenceIdHits,
    groundednessClaims,
    webVerifyMeta: fastBundle?.meta?.webVerifyMeta ?? null,
    webPipelineSchemaVersion:
      typeof fastBundle?.meta?.webPipelineSchemaVersion === "number" ? fastBundle.meta.webPipelineSchemaVersion : null,
    webPipeline: Array.isArray(fastBundle?.meta?.webPipeline) ? fastBundle.meta.webPipeline : null,
  };
}

async function writeCaseArtifacts(result) {
  // Preserve multiple attempts (e.g. primary + fallback barcode) under a stable case directory.
  const caseDir = path.join(ARTIFACT_DIR, result.case.id, result.case.barcode);
  await ensureDir(caseDir);

  await fs.writeFile(path.join(caseDir, "events.json"), JSON.stringify(result.events, null, 2));
  await fs.writeFile(path.join(caseDir, "bundle.json"), JSON.stringify(result.fastBundle, null, 2));
  await fs.writeFile(path.join(caseDir, "analysis-section.json"), JSON.stringify(result.detailResponse, null, 2));
  await fs.writeFile(path.join(caseDir, "summary.json"), JSON.stringify(result.summary, null, 2));
}

async function runCase(testCase) {
  const webTailMsDefault = 15000;
  const fastTailMs =
    testCase.id === "web"
      ? Math.max(2500, Number(process.env.RENDER_WEB_SSE_TAIL_MS || webTailMsDefault))
      : 2500;

  let events = await readSseEvents(testCase.barcode, { fastTailMs });
  // Render services can cold-start; the first request occasionally yields an empty stream.
  // Retry once to reduce flakiness without masking systematic failures.
  if (!events.length) {
    await sleep(1500);
    events = await readSseEvents(testCase.barcode, { fastTailMs });
  }
  const bundleEvents = getBundleEvents(events);
  const bundleCheck = assertBundleContract(bundleEvents, testCase.expectedSourceType);

  const detailRequestMetrics = createDetailRequestMetrics();
  let detailResponse = { status: 0, payload: null, response: null };
  if (bundleCheck.fastBundle) {
    if (
      ENFORCE_DEBUG_GATE_NEGATIVE_ASSERTION &&
      !debugGateNegativeAssertionDone &&
      bundleCheck.fastBundle?.meta?.sourceType === "dsld"
    ) {
      debugGateNegativeAssertionDone = true;
      const gateErrors = await assertInternalDebugGated(bundleCheck.fastBundle);
      if (gateErrors.length) {
        // Attach to this case so the run fails loudly.
        bundleCheck.errors.push(...gateErrors);
      }
    }
    const requiredKeyword = String(testCase.requiredFormKeyword ?? "").trim().toLowerCase();
    const targetKeyword = String(testCase.targetActiveKeyword ?? requiredKeyword).trim().toLowerCase();
    const shouldPage = testCase.id.startsWith("dsld_with_form") && Boolean(targetKeyword || requiredKeyword);
    const retryOn5xx = bundleCheck.fastBundle?.meta?.sourceType === "dsld";
    if (!shouldPage) {
      detailResponse = await fetchIngredientsDetailPage(bundleCheck.fastBundle, 0, {
        requestMetrics: detailRequestMetrics,
        retryOn5xx,
      });
    } else {
      let cursor = 0;
      let pages = 0;
      let last = null;
      while (pages < DETAIL_MAX_PAGES) {
        // eslint-disable-next-line no-await-in-loop
        const pageRes = await fetchIngredientsDetailPage(bundleCheck.fastBundle, cursor, {
          requestMetrics: detailRequestMetrics,
          retryOn5xx,
        });
        last = pageRes;
        pages += 1;

        if (pageRes.status !== 200) {
          detailResponse = pageRes;
          break;
        }

        const sentenceIds = pageRes.response?.debug?.formSentenceIds;
        const hasKeywordSentence =
          sentenceIds && typeof sentenceIds === "object"
            ? Object.entries(sentenceIds).some(
                ([k, v]) =>
                  String(k).toLowerCase().includes(targetKeyword || requiredKeyword) &&
                  typeof v === "string" &&
                  v.startsWith("s_"),
              )
            : false;
        if (hasKeywordSentence) {
          detailResponse = pageRes;
          break;
        }

        const nextCursor = pageRes.response?.page?.nextCursor;
        if (typeof nextCursor !== "number") {
          detailResponse = pageRes;
          break;
        }
        cursor = nextCursor;
      }
      if (!detailResponse?.status && last) detailResponse = last;
    }
  }

  const lnhpdUsageErrors =
    bundleCheck.fastBundle && testCase.id === "lnhpd" ? assertLnhpdLabelDosingCopied(bundleCheck.fastBundle) : [];
  const lnhpdNoStormErrors = testCase.id === "lnhpd" ? assertLnhpdDetailNoStorm(detailRequestMetrics) : [];

  const detailErrors = bundleCheck.fastBundle ? assertDetailContract(detailResponse) : [];

  const dsldKbErrors =
    bundleCheck.fastBundle && testCase.id.startsWith("dsld_with_form")
      ? assertDsldWithFormKbHit(detailResponse, testCase)
      : [];

  const lnhpdKbErrors =
    bundleCheck.fastBundle && testCase.id.startsWith("lnhpd_with_form")
      ? assertLnhpdWithFormEvidence(detailResponse, testCase)
      : [];

  const errors = [
    ...bundleCheck.errors,
    ...lnhpdUsageErrors,
    ...lnhpdNoStormErrors,
    ...detailErrors,
    ...dsldKbErrors,
    ...lnhpdKbErrors,
  ];
  const doneReason = pickDoneReason(events);
  const bundleFallbackCode =
    bundleCheck.fastBundle?.meta?.fallback?.code ??
    bundleCheck.fastBundle?.meta?.fallbackReason ??
    null;
  const summary = {
    ...pickKeyFields({ case: testCase, fastBundle: bundleCheck.fastBundle, detailResponse }),
    observeOnly: testCase.observeOnly === true,
    doneReason,
    bundleFallbackCode,
    pipelineMetrics: pickLatestPipelineMetrics(events),
    detailRequestCount: detailRequestMetrics.totalRequests,
    detail429Count: detailRequestMetrics.status429Count,
    detailRequestByKey: detailRequestMetrics.byKey,
    errors,
    pass: errors.length === 0,
  };

  const result = {
    case: testCase,
    events,
    fastBundle: bundleCheck.fastBundle,
    detailResponse,
    errors,
    summary,
  };

  await writeCaseArtifacts(result);
  return result;
}

async function runCaseSafely(testCase) {
  const abortRetries = Math.max(0, Number(process.env.RENDER_CASE_ABORT_RETRIES || 1));

  for (let attempt = 0; attempt <= abortRetries; attempt += 1) {
    try {
      // eslint-disable-next-line no-await-in-loop
      return await runCase(testCase);
    } catch (err) {
      const isAbortError = err?.name === "AbortError";
      if (isAbortError && attempt < abortRetries) {
        const delayMs = 300 * Math.pow(3, attempt); // 300ms, 900ms, ...
        console.warn(
          `[render-regression] AbortError retry attempt=${attempt + 1}/${abortRetries} barcode=${testCase.barcode} case=${testCase.id} delayMs=${delayMs}`,
        );
        // eslint-disable-next-line no-await-in-loop
        await new Promise((r) => setTimeout(r, delayMs));
        continue;
      }

      const errors = [`exception: ${String(isAbortError ? "AbortError" : err)}`];
      const summary = {
        barcode: testCase.barcode,
        caseId: testCase.id,
        expectedSourceType: testCase.expectedSourceType,
        requiredFormKeyword: testCase.requiredFormKeyword ?? null,
        targetActiveKeyword: testCase.targetActiveKeyword ?? null,
        observeOnly: testCase.observeOnly === true,
        doneReason: null,
        bundleFallbackCode: null,
        sourceType: null,
        promptVersion: null,
        serverCommitSha: null,
        bundleId: null,
        revision: null,
        phase: null,
        factsDigestHash: null,
        factsSourceVersion: null,
        dataStatus: null,
        fallbackUsed: null,
        fallbackReason: null,
        pipelineMetrics: null,
        jobStatus: null,
        attempts: null,
        timingMs: null,
        detailCursorUsed: null,
        formResolveSourcesNonNoneCount: null,
        formResolveSourcesNonNone: null,
        formSentenceIdHitsCount: null,
        formSentenceIdHits: null,
        errors,
        pass: false,
      };

      const result = {
        case: testCase,
        events: [],
        fastBundle: null,
        detailResponse: { status: 0, payload: null, response: null },
        errors,
        summary,
      };
      await writeCaseArtifacts(result);
      return result;
    }
  }

  throw new Error("unreachable: runCaseSafely retry loop fell through");
}

async function runCaseWithFallback(testCase) {
  const barcodes = Array.isArray(testCase.barcodes)
    ? Array.from(new Set(testCase.barcodes.filter(Boolean)))
    : [];
  const primaryBarcode = barcodes[0] ?? null;
  if (!primaryBarcode) throw new Error(`case ${testCase.id} missing barcode`);

  const attempts = [];
  let primaryResult = null;
  for (const barcode of barcodes) {
    // eslint-disable-next-line no-await-in-loop
    const result = await runCaseSafely({ ...testCase, barcode });
    result.summary.usedBarcode = barcode;
    attempts.push({ barcode, pass: result.summary.pass, errors: result.errors });
    if (barcode === primaryBarcode) primaryResult = result;
    if (barcode === primaryBarcode) {
      result.summary.primaryBarcode = primaryBarcode;
      result.summary.primaryFailedReason = null;
    } else {
      result.summary.primaryBarcode = primaryBarcode;
      result.summary.primaryFailedReason = attempts[0]?.errors?.join("; ") || "primary_failed";
    }
    if (result.summary.pass) {
      if (barcode !== primaryBarcode) {
        result.summary.fallbackAttempts = attempts;
      }
      return result;
    }
  }

  // All failed: return the primary result as the canonical failure but attach fallback context.
  const primary = primaryResult ?? (await runCaseSafely({ ...testCase, barcode: primaryBarcode }));
  primary.summary.usedBarcode = primaryBarcode;
  primary.summary.primaryBarcode = primaryBarcode;
  primary.summary.primaryFailedReason = null;
  primary.summary.fallbackAttempts = attempts.slice(1);
  primary.summary.errors = [
    ...primary.summary.errors,
    ...attempts.slice(1).map((a) => `fallback_failed(${a.barcode}): ${(a.errors || []).join("; ") || "failed"}`),
  ];
  primary.summary.pass = false;
  primary.errors = primary.summary.errors;
  return primary;
}

async function main() {
  await ensureDir(ARTIFACT_DIR);

  if (ENABLE_GROUNDEDNESS_LEXICAL) {
    try {
      const raw = await fs.readFile(path.join("backend", "data", "kb", "kb_evidence_excerpts.json"), "utf-8");
      const json = JSON.parse(String(raw).replace(/\bNaN\b/g, "null"));
      const rows = Array.isArray(json?.evidence_excerpts) ? json.evidence_excerpts : [];
      evidenceExcerptByRef = new Map(
        rows
          .map((r) => [String(r.citation_id || ""), String(r.excerpt_id || ""), r])
          .filter(([ref, x]) => ref && x)
          .map(([ref, x, r]) => [`${ref}|${x}`, r]),
      );
      console.log(`[render-regression] lexical groundedness enabled (excerpts=${evidenceExcerptByRef.size})`);
    } catch (err) {
      console.warn(`[render-regression] lexical groundedness enabled but failed to load kb_evidence_excerpts.json: ${String(err)}`);
      evidenceExcerptByRef = null;
    }
  }

  // Render services on free tiers can cold-start. If the first few SSE calls happen during a cold start,
  // regression can fail with "missing analysis_bundle" even though the backend is healthy once warmed.
  // Warm up the service once before running the full suite.
  const WARMUP_BARCODE =
    process.env.RENDER_WARMUP_BARCODE ||
    CASES?.[0]?.barcodes?.[0] ||
    process.env.RENDER_LNHPD_BARCODE ||
    "00029537001069";
  const WARMUP_TIMEOUT_MS = Number(process.env.RENDER_WARMUP_TIMEOUT_MS || 240_000);
  const warmupAttempts = Number(process.env.RENDER_WARMUP_ATTEMPTS || 2);
  for (let i = 1; i <= warmupAttempts; i += 1) {
    console.log(`[render-regression] warmup attempt=${i}/${warmupAttempts} barcode=${WARMUP_BARCODE}`);
    // eslint-disable-next-line no-await-in-loop
    const events = await readSseEvents(WARMUP_BARCODE, { timeoutMs: WARMUP_TIMEOUT_MS });
    const sawBundle = events.some((e) => e.event === "analysis_bundle");
    if (sawBundle) {
      console.log("[render-regression] warmup ok (analysis_bundle received)");
      break;
    }
    if (i === warmupAttempts) {
      console.warn("[render-regression] warmup did not receive analysis_bundle; continuing anyway");
      break;
    }
    // eslint-disable-next-line no-await-in-loop
    await new Promise((r) => setTimeout(r, 5000));
  }

  const runResults = [];
  for (const testCase of CASES) {
    const primaryBarcode = testCase.barcodes?.[0] ?? "";
    const fallbackBarcode = testCase.barcodes?.[1] ?? null;
    const label = fallbackBarcode
      ? `${primaryBarcode} (fallback ${fallbackBarcode})`
      : primaryBarcode;
    console.log(`[render-regression] running case=${testCase.id} barcode=${label}`);
    // serial execution keeps logs deterministic and easier to debug
    // eslint-disable-next-line no-await-in-loop
    const result = await runCaseWithFallback(testCase);
    runResults.push(result);
    console.log(
      `[render-regression] case=${testCase.id} pass=${result.summary.pass} sourceType=${result.summary.sourceType} dataStatus=${result.summary.dataStatus} fallback=${result.summary.fallbackUsed ?? "none"}`
    );
  }

  const blockingResults = runResults.filter((item) => item.case?.observeOnly !== true);
  const observeResults = runResults.filter((item) => item.case?.observeOnly === true);

  const ssePipelineMetrics = summarizePipelineMetrics(runResults);
  const ragQuadrantMetrics = summarizeRagQuadrantMetrics(runResults);

  // Nightly-only: enforce abstain correctness when we have enough signal to evaluate it.
  // Keep this out of PR-required gates by keying it off RENDER_INCLUDE_NIGHTLY_CASES.
  if (process.env.RENDER_INCLUDE_NIGHTLY_CASES === "1") {
    const evaluated = Number(ragQuadrantMetrics?.abstainEvaluatedCount ?? 0);
    const correct = Number(ragQuadrantMetrics?.abstainCorrectCount ?? 0);
    const unknown = Number(ragQuadrantMetrics?.abstainUnknownCount ?? 0);
    if (Number.isFinite(evaluated) && Number.isFinite(correct) && evaluated > 0 && correct < evaluated) {
      const msg = `[nightly_gate] abstain_correctness_failed evaluated=${evaluated} correct=${correct} unknown=${Number.isFinite(unknown) ? unknown : "na"}`;
      const target =
        runResults.find((item) => item?.case?.id === "web") ||
        runResults.find((item) => item?.summary?.caseId === "web") ||
        runResults.find((item) => item?.summary?.sourceType === "web") ||
        null;

      if (target) {
        if (!Array.isArray(target.errors)) target.errors = [];
        if (!target.errors.includes(msg)) target.errors.push(msg);
        if (!Array.isArray(target.summary?.errors)) target.summary.errors = [];
        if (!target.summary.errors.includes(msg)) target.summary.errors.push(msg);
        target.summary.pass = false;
      } else {
        console.error(msg);
      }
    }
  }

  let chaosSummary = null;
  const chaosSummaryPath = process.env.RENDER_SSE_CHAOS_SUMMARY_PATH || "";
  if (chaosSummaryPath) {
    try {
      const chaosRaw = await fs.readFile(chaosSummaryPath, "utf8");
      chaosSummary = JSON.parse(String(chaosRaw));
    } catch (error) {
      console.warn(`[render-regression] failed to load chaos summary from ${chaosSummaryPath}: ${String(error)}`);
    }
  }

  let harnessSummary = null;
  const harnessSummaryPath = process.env.RENDER_SSE_HARNESS_SUMMARY_PATH || "";
  if (harnessSummaryPath) {
    try {
      const harnessRaw = await fs.readFile(harnessSummaryPath, "utf8");
      harnessSummary = JSON.parse(String(harnessRaw));
    } catch (error) {
      console.warn(`[render-regression] failed to load harness summary from ${harnessSummaryPath}: ${String(error)}`);
    }
  }

  const summary = {
    baseUrl: BASE_URL,
    generatedAt: new Date().toISOString(),
    caseCount: runResults.length,
    blockingCaseCount: blockingResults.length,
    observeCaseCount: observeResults.length,
    passCount: blockingResults.filter((item) => item.summary.pass).length,
    failCount: blockingResults.filter((item) => !item.summary.pass).length,
    observePassCount: observeResults.filter((item) => item.summary.pass).length,
    observeFailCount: observeResults.filter((item) => !item.summary.pass).length,
    cases: runResults.map((item) => item.summary),
    ssePipelineMetrics,
    ragQuadrantMetrics,
    sseChaos: chaosSummary,
    sseHarness: harnessSummary,
  };

  await fs.writeFile(path.join(ARTIFACT_DIR, "summary.json"), JSON.stringify(summary, null, 2));

  // Release evidence table (stable, one row per case).
  const evidenceRows = runResults.map((item) => ({
    caseId: item.summary.caseId,
    barcode: item.summary.barcode,
    usedBarcode: item.summary.usedBarcode ?? item.summary.barcode,
    primaryBarcode: item.summary.primaryBarcode ?? null,
    primaryFailedReason: item.summary.primaryFailedReason ?? null,
    sourceType: item.summary.sourceType,
    requiredFormKeyword: item.summary.requiredFormKeyword ?? null,
    targetActiveKeyword: item.summary.targetActiveKeyword ?? null,
    promptVersion: item.summary.promptVersion,
    serverCommitSha: item.summary.serverCommitSha,
    factsSourceVersion: item.summary.factsSourceVersion,
    detailDataStatus: item.detailResponse?.response?.dataStatus ?? null,
    detailCursorUsed: item.summary.detailCursorUsed ?? null,
    fallbackUsed: item.summary.fallbackUsed,
    fallback: item.summary.fallback ?? null,
    fallbackReason: item.summary.fallbackReason,
    formResolveSourcesNonNone: item.summary.formResolveSourcesNonNone ?? null,
    formSentenceIdHits: item.summary.formSentenceIdHits ?? null,
    formExcerptIdHits: item.summary.formExcerptIdHits ?? null,
    formReferenceIdHits: item.summary.formReferenceIdHits ?? null,
    groundednessClaims: item.summary.groundednessClaims ?? null,
    webVerifyMeta: item.summary.webVerifyMeta ?? null,
  }));
  await fs.writeFile(path.join(ARTIFACT_DIR, "release-evidence.json"), JSON.stringify(evidenceRows, null, 2));

  const mdLines = [
    "| caseId | barcode | usedBarcode | primaryFailedReason | sourceType | requiredKeyword | targetActive | cursor | promptVersion | serverCommitSha | factsSourceVersion | detail.dataStatus | fallbackUsed | formResolveSources(non-none) | formSentenceIds(hits) | formExcerptIds(hits) |",
    "|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|",
  ];
  for (const row of evidenceRows) {
    const sources = row.formResolveSourcesNonNone
      ? Object.entries(row.formResolveSourcesNonNone)
          .map(([k, v]) => `${k}:${v}`)
          .join("<br>")
      : "";
    const sids = row.formSentenceIdHits
      ? Object.entries(row.formSentenceIdHits)
          .map(([k, v]) => `${k}:${v}`)
          .join("<br>")
      : "";
    const xids = row.formExcerptIdHits
      ? Object.entries(row.formExcerptIdHits)
          .map(([k, v]) => `${k}:${v}`)
          .join("<br>")
      : "";
    mdLines.push(
      `| ${row.caseId} | ${row.barcode} | ${row.usedBarcode ?? ""} | ${row.primaryFailedReason ?? ""} | ${row.sourceType ?? ""} | ${row.requiredFormKeyword ?? ""} | ${row.targetActiveKeyword ?? ""} | ${row.detailCursorUsed ?? ""} | ${row.promptVersion ?? ""} | ${row.serverCommitSha ?? ""} | ${row.factsSourceVersion ?? ""} | ${row.detailDataStatus ?? ""} | ${row.fallbackUsed ?? ""} | ${sources} | ${sids} | ${xids} |`,
    );
  }
  await fs.writeFile(path.join(ARTIFACT_DIR, "release-evidence.md"), mdLines.join("\n") + "\n");

  if (summary.observeFailCount > 0) {
    console.warn("[render-regression] observe-only failures detected (non-blocking):");
    for (const item of observeResults) {
      if (item.summary.pass) continue;
      console.warn(`- ${item.case.id}: ${item.errors.join("; ")}`);
    }
  }

  if (summary.failCount > 0) {
    console.error("[render-regression] blocking failures detected:");
    for (const item of runResults) {
      if (item.summary.pass) continue;
      if (item.case?.observeOnly === true) continue;
      console.error(`- ${item.case.id}: ${item.errors.join("; ")}`);
    }
    process.exit(1);
  }

  console.log("[render-regression] all cases passed");
}

main().catch((error) => {
  console.error(`[render-regression] fatal error: ${String(error)}`);
  process.exit(1);
});
