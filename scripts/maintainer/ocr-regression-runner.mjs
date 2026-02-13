#!/usr/bin/env node
import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import process from "node:process";

const PANEL_TYPE_TARGET = new Set(["supplement_facts", "ingredients_list"]);
const ABSTAIN_ISSUES = new Set(["possible_missing_column", "non_target_panel", "low_confidence", "insufficient_label_evidence"]);

const CANONICAL_ALIASES = {
  "vitamin a": ["vitamin a", "retinol", "retinyl"],
  "vitamin b1": ["vitamin b1", "thiamine", "thiamin"],
  "vitamin b2": ["vitamin b2", "riboflavin"],
  "vitamin b3": ["vitamin b3", "niacin", "niacinamide", "nicotinamide"],
  "vitamin b5": ["vitamin b5", "pantothenic acid"],
  "vitamin b6": ["vitamin b6", "pyridoxine"],
  "vitamin b7": ["vitamin b7", "biotin"],
  "vitamin b9": ["vitamin b9", "folate", "folic acid"],
  "vitamin b12": ["vitamin b12", "b12", "b 12", "cyanocobalamin", "methylcobalamin", "cobalamin"],
  "vitamin c": [
    "vitamin c",
    "ascorbic acid",
    "ascorbate",
    "acide ascorbique",
    "vitamine c",
    "ester c",
    "ester-c",
  ],
  "vitamin d": [
    "vitamin d",
    "vitamin d3",
    "vitamine d",
    "d3",
    "cholecalciferol",
    "ergocalciferol",
  ],
  "vitamin e": ["vitamin e", "tocopherol", "alpha tocopherol"],
  "vitamin k": ["vitamin k", "vitamin k2", "menaquinone", "mk7", "mk-7"],
  calcium: ["calcium", "calcium citrate", "calcium carbonate"],
  magnesium: [
    "magnesium",
    "magnesium citrate",
    "magnesium glycinate",
    "magnesium bisglycinate",
    "magnesium oxide",
    "magnesiumcitrat",
    "magnesio",
    "magnesium",
    "magnesium (as citrate)",
    "magnesium (as glycinate)",
    "magnesium (als citrat)",
    "magnesium (als glycinate)",
    "magnesium (comme citrate)",
    "magnesium (comme glycinate)",
    "magnesium (comme bisglycinate)",
    "magnesium",
    "magnésium",
  ],
  zinc: [
    "zinc",
    "zink",
    "zinc citrate",
    "zinc picolinate",
    "zinc gluconate",
    "zinc oxide",
    "zinc (gluconate)",
    "zinc (as gluconate)",
    "zinc (comme gluconate)",
  ],
  iron: ["iron", "ferrous", "ferric"],
  selenium: ["selenium", "selenomethionine"],
  iodine: ["iodine", "iodide"],
  potassium: ["potassium"],
  sodium: ["sodium"],
  copper: ["copper"],
  manganese: ["manganese"],
  chromium: ["chromium"],
  molybdenum: ["molybdenum"],
  probiotic: ["probiotic", "probiotics", "lactobacillus", "bifidobacterium", "saccharomyces boulardii"],
  collagen: ["collagen", "collagen peptides", "marine collagen"],
  creatine: ["creatine", "creatine monohydrate", "creatine (as monohydrate)"],
  "omega-3": ["omega 3", "omega-3", "fish oil", "epa", "dha"],
  "hyaluronic acid": ["hyaluronic acid", "hyaluronate"],
  multivitamin: ["multivitamin", "multi vitamin", "multi-vitamin"],
  supplement: ["supplement", "dietary supplement"],
};

const aliasIndex = buildAliasIndex(CANONICAL_ALIASES);

function buildAliasIndex(dictionary) {
  const entries = [];
  for (const [canonical, aliases] of Object.entries(dictionary)) {
    const normalizedCanonical = normalizeForMatch(canonical);
    entries.push({ canonical, normalized: normalizedCanonical });
    for (const alias of aliases) {
      const normalizedAlias = normalizeForMatch(alias);
      if (normalizedAlias) entries.push({ canonical, normalized: normalizedAlias });
    }
  }
  return entries;
}

function parseArgs(argv) {
  const args = {
    manifest: "scripts/maintainer/fixtures/ocr_regression_set_v1.json",
    imagesDir: null,
    apiBase: process.env.LABEL_SCAN_REGRESSION_API_BASE ?? process.env.API_BASE_URL ?? "http://127.0.0.1:3001",
    bearer: process.env.LABEL_SCAN_REGRESSION_BEARER ?? "",
    authBypass:
      process.env.LABEL_SCAN_REGRESSION_AUTH_BYPASS === "1"
      || process.env.LABEL_SCAN_REGRESSION_AUTH_BYPASS === "true",
    preprocessProfile: process.env.LABEL_SCAN_REGRESSION_PREPROCESS_PROFILE ?? "jpeg_1800_q82",
    mode: process.env.LABEL_SCAN_REGRESSION_MODE ?? "e2e",
    gateMode: process.env.LABEL_SCAN_REGRESSION_GATE_MODE ?? "auto",
    ocrFixturesDir:
      process.env.LABEL_SCAN_REGRESSION_OCR_FIXTURES
      ?? "scripts/maintainer/fixtures/ocr_outputs_v1",
    baseline: process.env.LABEL_SCAN_REGRESSION_BASELINE ?? "",
    maxSamples: Number.parseInt(process.env.LABEL_SCAN_REGRESSION_MAX_SAMPLES ?? "30", 10),
    concurrency: Number.parseInt(process.env.LABEL_SCAN_REGRESSION_CONCURRENCY ?? "4", 10),
    timeoutMs: Number.parseInt(process.env.LABEL_SCAN_REGRESSION_TIMEOUT_MS ?? "25000", 10),
    authFailFast: Number.parseInt(process.env.LABEL_SCAN_REGRESSION_AUTH_FAIL_FAST ?? "3", 10),
    regressionToken:
      process.env.LABEL_SCAN_REGRESSION_TOKEN
      ?? process.env.RENDER_REGRESSION_TOKEN
      ?? process.env.REGRESSION_AUTH_TOKEN
      ?? "",
    allowEmpty: false,
    fuzzyThreshold: Number.parseFloat(process.env.OCR_REGRESSION_SOFT_FUZZY_THRESHOLD ?? "0.8"),
  };

  for (let i = 0; i < argv.length; i++) {
    const value = argv[i];
    if (value === "--manifest") args.manifest = argv[++i];
    else if (value === "--images-dir") args.imagesDir = argv[++i];
    else if (value === "--api-base") args.apiBase = argv[++i];
    else if (value === "--bearer") args.bearer = argv[++i];
    else if (value === "--auth-bypass") args.authBypass = true;
    else if (value === "--preprocess-profile") args.preprocessProfile = argv[++i];
    else if (value === "--mode") args.mode = argv[++i];
    else if (value === "--gate-mode") args.gateMode = argv[++i];
    else if (value === "--ocr-fixtures") args.ocrFixturesDir = argv[++i];
    else if (value === "--skip-api") args.mode = "parser";
    else if (value === "--baseline") args.baseline = argv[++i];
    else if (value === "--max-samples") args.maxSamples = Number.parseInt(argv[++i], 10);
    else if (value === "--concurrency") args.concurrency = Number.parseInt(argv[++i], 10);
    else if (value === "--timeout-ms") args.timeoutMs = Number.parseInt(argv[++i], 10);
    else if (value === "--auth-fail-fast") args.authFailFast = Number.parseInt(argv[++i], 10);
    else if (value === "--regression-token") args.regressionToken = argv[++i];
    else if (value === "--allow-empty") args.allowEmpty = true;
    else if (value === "--fuzzy-threshold") args.fuzzyThreshold = Number.parseFloat(argv[++i]);
  }

  if (!["parser", "e2e"].includes(args.mode)) {
    throw new Error(`unsupported mode: ${args.mode}`);
  }
  if (!["auto", "required", "observe"].includes(args.gateMode)) {
    throw new Error(`unsupported gate mode: ${args.gateMode}`);
  }
  if (!Number.isFinite(args.maxSamples) || args.maxSamples < 1) {
    throw new Error(`invalid max-samples: ${args.maxSamples}`);
  }
  if (!Number.isFinite(args.concurrency) || args.concurrency < 1) {
    throw new Error(`invalid concurrency: ${args.concurrency}`);
  }
  if (!Number.isFinite(args.timeoutMs) || args.timeoutMs < 1000) {
    throw new Error(`invalid timeout-ms: ${args.timeoutMs}`);
  }
  if (!Number.isFinite(args.authFailFast) || args.authFailFast < 1) {
    throw new Error(`invalid auth-fail-fast: ${args.authFailFast}`);
  }
  if (!Number.isFinite(args.fuzzyThreshold) || args.fuzzyThreshold <= 0 || args.fuzzyThreshold > 1) {
    throw new Error(`invalid fuzzy threshold: ${args.fuzzyThreshold}`);
  }

  return args;
}

class RegressionRequestError extends Error {
  constructor(message, { httpStatus = null, failureClass = "http", durationMs = null } = {}) {
    super(message);
    this.name = "RegressionRequestError";
    this.httpStatus = httpStatus;
    this.failureClass = failureClass;
    this.durationMs = durationMs;
  }
}

function sha256Hex(buffer) {
  return crypto.createHash("sha256").update(buffer).digest("hex");
}

function computeImageHash(base64) {
  let hash = 0x811c9dc5;
  for (let i = 0; i < base64.length; i++) {
    hash ^= base64.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  const normalized = (hash >>> 0).toString(16).padStart(8, "0");
  return `${normalized}-${base64.length}`;
}

function ratio(numerator, denominator) {
  if (!denominator) return null;
  return numerator / denominator;
}

function average(values) {
  if (!values.length) return null;
  return values.reduce((sum, item) => sum + item, 0) / values.length;
}

function percentile(values, percentileValue) {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const idx = Math.max(0, Math.min(sorted.length - 1, Math.floor((percentileValue / 100) * (sorted.length - 1))));
  return sorted[idx] ?? null;
}

function normalizeForMatch(value) {
  let text = String(value ?? "").toLowerCase();
  text = text.normalize("NFKD").replace(/[\u0300-\u036f]/g, "");
  text = text.replace(/[()]/g, " ");
  text = text.replace(/\b\d+(?:[.,]\d+)?\s*(mg|mcg|ug|g|iu|kj|kcal|%)\b/g, " ");
  text = text.replace(/\b\d+(?:[.,]\d+)?\b/g, " ");
  text = text.replace(/[^a-z0-9]+/g, " ");
  text = text.replace(/\s+/g, " ").trim();
  return text;
}

function canonicalizeTerm(value) {
  const normalized = normalizeForMatch(value);
  if (!normalized) {
    return { raw: String(value ?? ""), normalized: "", canonical: null };
  }

  for (const entry of aliasIndex) {
    if (normalized === entry.normalized) {
      return { raw: String(value ?? ""), normalized, canonical: entry.canonical };
    }
  }

  for (const entry of aliasIndex) {
    if (entry.normalized.length >= 4 && normalized.includes(entry.normalized)) {
      return { raw: String(value ?? ""), normalized, canonical: entry.canonical };
    }
  }

  return { raw: String(value ?? ""), normalized, canonical: null };
}

function tokenSetSimilarity(a, b) {
  const setA = new Set(a.split(" ").filter(Boolean));
  const setB = new Set(b.split(" ").filter(Boolean));
  if (!setA.size || !setB.size) return 0;
  let intersection = 0;
  for (const token of setA) {
    if (setB.has(token)) intersection += 1;
  }
  const denom = setA.size + setB.size;
  if (!denom) return 0;
  return (2 * intersection) / denom;
}

function trigramDice(a, b) {
  const grams = (input) => {
    const value = `  ${input}  `;
    const out = [];
    for (let i = 0; i < value.length - 2; i++) {
      out.push(value.slice(i, i + 3));
    }
    return out;
  };

  const gramsA = grams(a);
  const gramsB = grams(b);
  if (!gramsA.length || !gramsB.length) return 0;

  const counts = new Map();
  for (const gram of gramsA) counts.set(gram, (counts.get(gram) ?? 0) + 1);
  let overlap = 0;
  for (const gram of gramsB) {
    const count = counts.get(gram) ?? 0;
    if (count > 0) {
      overlap += 1;
      counts.set(gram, count - 1);
    }
  }
  return (2 * overlap) / (gramsA.length + gramsB.length);
}

function matchScore(gtTerm, predictedTerm) {
  if (!gtTerm.normalized || !predictedTerm.normalized) {
    return { score: 0, matchType: "none" };
  }
  if (gtTerm.canonical && predictedTerm.canonical && gtTerm.canonical === predictedTerm.canonical) {
    return { score: 1, matchType: "canonical" };
  }
  if (gtTerm.normalized === predictedTerm.normalized) {
    return { score: 1, matchType: "exact" };
  }

  const tokenScore = tokenSetSimilarity(gtTerm.normalized, predictedTerm.normalized);
  const trigramScore = trigramDice(gtTerm.normalized, predictedTerm.normalized);
  const score = Math.max(tokenScore, trigramScore);
  return { score, matchType: "fuzzy" };
}

function evaluateKeyIngredients(gtRawTerms, predictedRawTerms, fuzzyThreshold) {
  const gtTerms = gtRawTerms
    .map((term) => canonicalizeTerm(term))
    .filter((term) => Boolean(term.normalized));
  const predictedTerms = predictedRawTerms
    .map((term) => canonicalizeTerm(term))
    .filter((term) => Boolean(term.normalized));

  const recallHardHits = [];
  const recallSoftHits = [];
  const unmatchedDebug = [];

  for (const gtTerm of gtTerms) {
    const scored = predictedTerms.map((predicted) => ({
      predicted,
      ...matchScore(gtTerm, predicted),
    })).sort((a, b) => b.score - a.score);

    const best = scored[0] ?? null;
    const hardHit = Boolean(best && best.score === 1 && (best.matchType === "canonical" || best.matchType === "exact"));
    const softHit = Boolean(best && best.score >= fuzzyThreshold);
    recallHardHits.push(hardHit ? 1 : 0);
    recallSoftHits.push(softHit ? 1 : 0);

    if (!softHit) {
      const missReason = (() => {
        if (!best) return "parser_missing";
        if (gtTerm.canonical && best.predicted.canonical !== gtTerm.canonical) {
          return "alias_miss";
        }
        return "below_threshold";
      })();
      unmatchedDebug.push({
        gt_term: gtTerm.raw,
        gt_normalized: gtTerm.normalized,
        gt_canonical: gtTerm.canonical,
        best_score: best?.score ?? 0,
        miss_reason: missReason,
        top_candidates: scored.slice(0, 3).map((item) => ({
          predicted: item.predicted.raw,
          predicted_normalized: item.predicted.normalized,
          predicted_canonical: item.predicted.canonical,
          score: item.score,
          match_type: item.matchType,
        })),
      });
    }
  }

  const precisionHardHits = [];
  const precisionSoftHits = [];
  for (const predictedTerm of predictedTerms) {
    const scored = gtTerms.map((gtTerm) => ({
      gtTerm,
      ...matchScore(gtTerm, predictedTerm),
    })).sort((a, b) => b.score - a.score);
    const best = scored[0] ?? null;
    const hardHit = Boolean(best && best.score === 1 && (best.matchType === "canonical" || best.matchType === "exact"));
    const softHit = Boolean(best && best.score >= fuzzyThreshold);
    precisionHardHits.push(hardHit ? 1 : 0);
    precisionSoftHits.push(softHit ? 1 : 0);
  }

  const recallSoft = gtTerms.length ? recallSoftHits.reduce((sum, v) => sum + v, 0) / gtTerms.length : null;
  const recallHard = gtTerms.length ? recallHardHits.reduce((sum, v) => sum + v, 0) / gtTerms.length : null;
  const precisionSoft = predictedTerms.length ? precisionSoftHits.reduce((sum, v) => sum + v, 0) / predictedTerms.length : null;
  const precisionHard = predictedTerms.length ? precisionHardHits.reduce((sum, v) => sum + v, 0) / predictedTerms.length : null;

  const f1 = (precision, recall) => {
    if (typeof precision !== "number" || typeof recall !== "number") return null;
    if (precision <= 0 || recall <= 0) return 0;
    return (2 * precision * recall) / (precision + recall);
  };

  return {
    recallSoft,
    recallHard,
    precisionSoft,
    precisionHard,
    f1Soft: f1(precisionSoft, recallSoft),
    f1Hard: f1(precisionHard, recallHard),
    unmatchedDebug,
  };
}

function extractDraftFromPayload(payload) {
  const draft = payload?.draft ?? payload?.analysis?.draft ?? payload?.result?.draft ?? payload;
  const ingredients = Array.isArray(draft?.ingredients) ? draft.ingredients : [];
  const parsedNames = ingredients
    .map((item) => String(item?.name ?? "").trim())
    .filter(Boolean);
  const issues = Array.isArray(draft?.issues)
    ? draft.issues.map((issue) => (typeof issue === "string" ? issue : issue?.type)).filter(Boolean)
    : (Array.isArray(payload?.issues) ? payload.issues.filter(Boolean) : []);

  return {
    parsedNames,
    parsedIngredients: parsedNames.length,
    completenessRatio:
      payload?.debug?.completeness?.completenessRatio
      ?? payload?.completeness?.completenessRatio
      ?? draft?.parseCoverage
      ?? payload?.parseCoverage
      ?? null,
    laneSplitChosen: payload?.laneSplitChosen ?? payload?.debug?.laneSplit?.chosen ?? payload?.laneSplit?.chosen ?? null,
    needsConfirmation: Boolean(
      draft?.needsConfirmation
      || payload?.needsConfirmation
      || payload?.status === "needs_confirmation",
    ),
    issues,
  };
}

async function runE2ESample({ args, sample, imagesDir }) {
  const startedAt = Date.now();
  const ext = path.extname(String(sample.storage_uri)) || ".jpg";
  const imagePath = path.join(imagesDir, `${sample.image_id}${ext}`);
  const bytes = await fs.readFile(imagePath);
  const actualSha = sha256Hex(bytes);
  const expectedSha = String(sample.sha256 ?? "").toLowerCase();
  if (actualSha !== expectedSha) {
    throw new Error(`sha_mismatch expected=${expectedSha} actual=${actualSha}`);
  }

  const base64 = bytes.toString("base64");
  const imageHash = computeImageHash(base64);
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort("timeout"), args.timeoutMs);
  let response;
  let payload = null;
  try {
    response = await fetch(`${args.apiBase.replace(/\/$/, "")}/api/analyze-label?includeAnalysis=0`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(args.regressionToken ? { "x-regression-token": args.regressionToken } : {}),
        ...(args.bearer ? { Authorization: `Bearer ${args.bearer}` } : {}),
        ...(args.authBypass ? { "x-auth-disabled": "1" } : {}),
      },
      body: JSON.stringify({
        imageHash,
        imageBase64: base64,
        includeAnalysis: false,
        preprocessProfile: args.preprocessProfile,
        deviceId: `ocr-regression-${sample.image_id}`,
        debug: true,
      }),
      signal: controller.signal,
    });
    payload = await response.json().catch(() => null);
  } catch (error) {
    const durationMs = Date.now() - startedAt;
    if (controller.signal.aborted) {
      throw new RegressionRequestError("api_timeout", {
        httpStatus: null,
        failureClass: "timeout",
        durationMs,
      });
    }
    throw new RegressionRequestError(error instanceof Error ? error.message : String(error), {
      httpStatus: null,
      failureClass: "http",
      durationMs,
    });
  } finally {
    clearTimeout(timeoutId);
  }

  const durationMs = Date.now() - startedAt;
  if (!response.ok || !payload) {
    const failureClass = response.status === 401 || response.status === 403 ? "auth" : "http";
    throw new RegressionRequestError(`api_failed_${response.status}`, {
      httpStatus: response.status,
      failureClass,
      durationMs,
    });
  }
  if (payload.status === "failed") {
    throw new RegressionRequestError(payload.message ?? "label_analysis_failed", {
      httpStatus: response.status,
      failureClass: "parser",
      durationMs,
    });
  }

  return {
    ...extractDraftFromPayload(payload),
    httpStatus: response.status,
    durationMs,
    failureClass: null,
  };
}

async function runParserSample({ args, sample }) {
  const fixturePath = path.join(args.ocrFixturesDir, `${sample.image_id}.json`);
  const payloadRaw = await fs.readFile(fixturePath, "utf8").catch(() => null);
  if (!payloadRaw) {
    throw new Error(`ocr_fixture_missing:${fixturePath}`);
  }
  const payload = JSON.parse(payloadRaw);
  return {
    ...extractDraftFromPayload(payload),
    parserFixturePath: fixturePath,
  };
}

function summarizeByBucket(rows) {
  const buckets = new Map();
  for (const row of rows) {
    const entry = buckets.get(row.bucket) ?? [];
    entry.push(row);
    buckets.set(row.bucket, entry);
  }

  const out = {};
  for (const [bucket, items] of buckets.entries()) {
    const target = items.filter((item) => item.evalTarget);
    const nonTarget = items.filter((item) => !item.evalTarget);
    const completeness = items.map((item) => item.completenessRatio).filter((v) => typeof v === "number");
    const parsedCounts = items.map((item) => item.parsedIngredients).filter((v) => typeof v === "number");
    const gtCounts = items.map((item) => item.gtIngredientCount).filter((v) => typeof v === "number");
    const mae =
      parsedCounts.length && gtCounts.length
        ? average(parsedCounts.map((count, idx) => Math.abs(count - (gtCounts[idx] ?? 0))) )
        : null;

    out[bucket] = {
      count: items.length,
      success: items.filter((item) => item.ok).length,
      targetCount: target.length,
      nonTargetCount: nonTarget.length,
      completenessAvg: average(completeness),
      keyIngredientRecallSoftAvg: average(target.map((item) => item.keyIngredientRecallSoft).filter((v) => typeof v === "number")),
      keyIngredientRecallHardAvg: average(target.map((item) => item.keyIngredientRecallHard).filter((v) => typeof v === "number")),
      keyIngredientPrecisionSoftAvg: average(target.map((item) => item.keyIngredientPrecisionSoft).filter((v) => typeof v === "number")),
      keyIngredientPrecisionHardAvg: average(target.map((item) => item.keyIngredientPrecisionHard).filter((v) => typeof v === "number")),
      keyIngredientF1SoftAvg: average(target.map((item) => item.keyIngredientF1Soft).filter((v) => typeof v === "number")),
      keyIngredientF1HardAvg: average(target.map((item) => item.keyIngredientF1Hard).filter((v) => typeof v === "number")),
      ingredientCountMae: mae,
      overconfidentParseRate: ratio(
        nonTarget.filter((item) => item.overconfidentCase).length,
        nonTarget.length,
      ),
      needsConfirmationRateNonTarget: ratio(
        nonTarget.filter((item) => item.needsConfirmation).length,
        nonTarget.length,
      ),
      abstainIssueHitRate: ratio(
        nonTarget.filter((item) => item.abstainIssueHit).length,
        nonTarget.length,
      ),
      laneSplitChosenCounts: items.reduce((acc, item) => {
        const key = item.laneSplitChosen ?? "unknown";
        acc[key] = (acc[key] ?? 0) + 1;
        return acc;
      }, {}),
    };
  }
  return out;
}

function summarizeAttribution(samples) {
  const licenses = new Map();
  const attributions = new Map();
  const providers = new Map();
  for (const sample of samples) {
    const source = sample?.source ?? {};
    const license = String(source.license ?? "unknown");
    const attribution = String(source.attribution ?? "unknown");
    const provider = String(source.provider ?? "unknown");
    licenses.set(license, (licenses.get(license) ?? 0) + 1);
    attributions.set(attribution, (attributions.get(attribution) ?? 0) + 1);
    providers.set(provider, (providers.get(provider) ?? 0) + 1);
  }
  const toList = (map) => [...map.entries()]
    .sort((a, b) => Number(b[1]) - Number(a[1]))
    .map(([name, count]) => ({ name, count }));
  return {
    providerCounts: toList(providers),
    licenseCounts: toList(licenses),
    attributionCounts: toList(attributions),
  };
}

function buildGateResult({ rows, bucketSummary, baselineSummary, requirements, sampleCount, gateMode }) {
  const requiredTargetPanel = process.env.OCR_REGRESSION_REQUIRED_TARGET_PANEL ?? "supplement_facts";
  const requiredTargetMinSamples = Number(
    process.env.OCR_REGRESSION_REQUIRED_TARGET_MIN_SAMPLES ?? "10",
  );
  const targetRows = rows.filter((row) => row.evalTarget && row.ok);
  const requiredTargetRows = targetRows.filter((row) => row.panelType === requiredTargetPanel);
  const observeTargetRows = targetRows.filter((row) => row.panelType !== requiredTargetPanel);
  const nonTargetRows = rows.filter((row) => !row.evalTarget && row.ok);
  const failures = [];
  const warnings = [];

  const thresholds = {
    dualMin: Number(process.env.OCR_REGRESSION_DUAL_MIN_COMPLETENESS ?? 0.58),
    singleMin: Number(process.env.OCR_REGRESSION_SINGLE_MIN_COMPLETENESS ?? 0.62),
    recallSoftMin: Number(process.env.OCR_REGRESSION_TARGET_RECALL_SOFT_MIN ?? 0.45),
    precisionSoftMin: Number(process.env.OCR_REGRESSION_TARGET_PRECISION_SOFT_MIN ?? 0.55),
    f1SoftMin: Number(process.env.OCR_REGRESSION_TARGET_F1_SOFT_MIN ?? 0.45),
    nonTargetOverconfidentMax: Number(process.env.OCR_REGRESSION_NONTARGET_OVERCONFIDENT_MAX ?? 0.10),
    nonTargetAbstainIssueMin: Number(process.env.OCR_REGRESSION_NONTARGET_ABSTAIN_ISSUE_MIN ?? 0),
  };

  const targetRecallSoft = average(requiredTargetRows.map((row) => row.keyIngredientRecallSoft).filter((v) => typeof v === "number"));
  const targetRecallHard = average(requiredTargetRows.map((row) => row.keyIngredientRecallHard).filter((v) => typeof v === "number"));
  const targetPrecisionSoft = average(requiredTargetRows.map((row) => row.keyIngredientPrecisionSoft).filter((v) => typeof v === "number"));
  const targetPrecisionHard = average(requiredTargetRows.map((row) => row.keyIngredientPrecisionHard).filter((v) => typeof v === "number"));
  const targetF1Soft = average(requiredTargetRows.map((row) => row.keyIngredientF1Soft).filter((v) => typeof v === "number"));
  const targetF1Hard = average(requiredTargetRows.map((row) => row.keyIngredientF1Hard).filter((v) => typeof v === "number"));
  const observeTargetRecallSoft = average(observeTargetRows.map((row) => row.keyIngredientRecallSoft).filter((v) => typeof v === "number"));
  const observeTargetPrecisionSoft = average(observeTargetRows.map((row) => row.keyIngredientPrecisionSoft).filter((v) => typeof v === "number"));
  const observeTargetF1Soft = average(observeTargetRows.map((row) => row.keyIngredientF1Soft).filter((v) => typeof v === "number"));

  const nonTargetOverconfidentRate = ratio(
    nonTargetRows.filter((row) => row.overconfidentCase).length,
    nonTargetRows.length,
  );
  const nonTargetAbstainIssueRate = ratio(
    nonTargetRows.filter((row) => row.abstainIssueHit).length,
    nonTargetRows.length,
  );

  if (requirements?.totalSamples && sampleCount < requirements.totalSamples) {
    failures.push(`sample_count_below_required(${sampleCount}/${requirements.totalSamples})`);
  }

  const dual = bucketSummary.dual_column?.completenessAvg ?? null;
  const single = bucketSummary.single_column?.completenessAvg ?? null;

  if (baselineSummary) {
    const baselineDual = baselineSummary.bucketSummary?.dual_column?.completenessAvg ?? null;
    const baselineSingle = baselineSummary.bucketSummary?.single_column?.completenessAvg ?? null;
    if (typeof dual === "number" && typeof baselineDual === "number" && dual < baselineDual) {
      failures.push(`dual_column_regressed(${dual.toFixed(3)}<${baselineDual.toFixed(3)})`);
    }
    if (typeof single === "number" && typeof baselineSingle === "number" && single < baselineSingle - 0.03) {
      failures.push(`single_column_regressed(${single.toFixed(3)}<${(baselineSingle - 0.03).toFixed(3)})`);
    }
  } else {
    if (typeof dual === "number" && dual < thresholds.dualMin) {
      failures.push(`dual_column_completeness_below_min(${dual.toFixed(3)}<${thresholds.dualMin})`);
    }
    if (typeof single === "number" && single < thresholds.singleMin) {
      failures.push(`single_column_completeness_below_min(${single.toFixed(3)}<${thresholds.singleMin})`);
    }
  }

  const requiredTargetInsufficient = requiredTargetRows.length < requiredTargetMinSamples;
  if (requiredTargetInsufficient) {
    warnings.push(
      `required_target_insufficient(panel=${requiredTargetPanel},count=${requiredTargetRows.length},min=${requiredTargetMinSamples})`,
    );
  } else {
    if (typeof targetRecallSoft === "number" && targetRecallSoft < thresholds.recallSoftMin) {
      failures.push(`target_recall_soft_below_min(${targetRecallSoft.toFixed(3)}<${thresholds.recallSoftMin})`);
    }
    if (typeof targetPrecisionSoft === "number" && targetPrecisionSoft < thresholds.precisionSoftMin) {
      failures.push(`target_precision_soft_below_min(${targetPrecisionSoft.toFixed(3)}<${thresholds.precisionSoftMin})`);
    }
    if (typeof targetF1Soft === "number" && targetF1Soft < thresholds.f1SoftMin) {
      failures.push(`target_f1_soft_below_min(${targetF1Soft.toFixed(3)}<${thresholds.f1SoftMin})`);
    }
  }

  if (typeof nonTargetOverconfidentRate === "number" && nonTargetOverconfidentRate > thresholds.nonTargetOverconfidentMax) {
    failures.push(`non_target_overconfident_rate_above_max(${nonTargetOverconfidentRate.toFixed(3)}>${thresholds.nonTargetOverconfidentMax})`);
  }

  if (
    typeof nonTargetAbstainIssueRate === "number"
    && thresholds.nonTargetAbstainIssueMin > 0
    && nonTargetAbstainIssueRate < thresholds.nonTargetAbstainIssueMin
  ) {
    failures.push(`non_target_abstain_issue_hit_rate_below_min(${nonTargetAbstainIssueRate.toFixed(3)}<${thresholds.nonTargetAbstainIssueMin})`);
  }

  const normalizedGateMode = gateMode === "required" ? "required" : "observe";
  const gateWarnings = normalizedGateMode === "observe"
    ? [...warnings, ...failures]
    : warnings;
  return {
    mode: normalizedGateMode,
    pass: normalizedGateMode === "required" ? failures.length === 0 : null,
    failures: normalizedGateMode === "required" ? failures : [],
    warnings: gateWarnings,
    thresholds,
    requiredTargetPanel,
    requiredTargetCount: requiredTargetRows.length,
    requiredTargetInsufficient,
    aggregates: {
      targetSamples: targetRows.length,
      requiredTargetSamples: requiredTargetRows.length,
      observeTargetSamples: observeTargetRows.length,
      nonTargetSamples: nonTargetRows.length,
      targetRecallSoft,
      targetRecallHard,
      targetPrecisionSoft,
      targetPrecisionHard,
      targetF1Soft,
      targetF1Hard,
      observeTargetRecallSoft,
      observeTargetPrecisionSoft,
      observeTargetF1Soft,
      nonTargetOverconfidentRate,
      nonTargetAbstainIssueRate,
    },
  };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const manifestPath = path.resolve(process.cwd(), args.manifest);
  const manifest = JSON.parse(await fs.readFile(manifestPath, "utf8"));
  const samples = Array.isArray(manifest.samples) ? manifest.samples : [];
  const selectedSamples = Number.isFinite(args.maxSamples)
    ? samples.slice(0, Math.max(0, args.maxSamples))
    : samples;

  if (!selectedSamples.length) {
    if (args.allowEmpty) {
      const outputDir = path.resolve(process.cwd(), "output", `ocr-regression-run-${Date.now()}`);
      await fs.mkdir(outputDir, { recursive: true });
      const summary = {
        generatedAt: new Date().toISOString(),
        manifestPath,
        mode: args.mode,
        sampleCount: 0,
        datasetVersion: manifest.datasetVersion ?? "unknown",
        gate: {
          pass: true,
          failures: [],
          note: "manifest has no samples (allow-empty mode)",
        },
      };
      await fs.writeFile(path.join(outputDir, "ocr_regression_summary.json"), JSON.stringify(summary, null, 2));
      await fs.writeFile(path.join(outputDir, "ocr_regression_report.md"), "# OCR Regression Report\n\nNo samples found (allow-empty mode).\n");
      console.warn(`[ocr-regression] manifest has no samples; allow-empty mode output=${outputDir}`);
      return;
    }
    throw new Error("manifest has no samples to run");
  }

  const outputDir = path.resolve(process.cwd(), "output", `ocr-regression-run-${Date.now()}`);
  await fs.mkdir(outputDir, { recursive: true });

  const imagesDir = args.imagesDir
    ? path.resolve(process.cwd(), args.imagesDir)
    : path.resolve(process.cwd(), "output", `ocr-regression-set-${manifest.datasetVersion}`, "images");
  const ocrFixturesDir = path.resolve(process.cwd(), args.ocrFixturesDir);

  const baselineSummary = args.baseline
    ? JSON.parse(await fs.readFile(path.resolve(process.cwd(), args.baseline), "utf8"))
    : null;
  const effectiveGateMode = args.gateMode === "auto"
    ? (args.mode === "parser" ? "required" : "observe")
    : args.gateMode;

  const createSampleResult = (sample) => {
    const evalTarget = typeof sample?.eval_target === "boolean"
      ? sample.eval_target
      : PANEL_TYPE_TARGET.has(sample?.panel_type);
    const expectedBehavior = sample?.expected_behavior ?? (evalTarget ? "parse_ingredients_list" : "should_warn_or_abstain");
    return {
      imageId: sample.image_id,
      bucket: sample.bucket,
      panelType: sample.panel_type ?? "unknown",
      evalTarget,
      expectedBehavior,
      ok: false,
      gtIngredientCount: sample.ingredient_count_gt ?? null,
      parsedIngredients: null,
      parsedNames: [],
      keyIngredientRecallSoft: null,
      keyIngredientRecallHard: null,
      keyIngredientPrecisionSoft: null,
      keyIngredientPrecisionHard: null,
      keyIngredientF1Soft: null,
      keyIngredientF1Hard: null,
      completenessRatio: null,
      laneSplitChosen: null,
      needsConfirmation: false,
      abstainIssueHit: false,
      overconfidentCase: false,
      issues: [],
      unmatchedDebug: [],
      parserFixturePath: null,
      httpStatus: null,
      durationMs: null,
      failureClass: null,
      error: null,
    };
  };

  const results = new Array(selectedSamples.length);
  let cursor = 0;
  let stopRequested = false;
  let authFailFastTriggered = false;
  let consecutiveAuthFailures = 0;
  let consecutiveAuthFailuresMax = 0;
  const workerCount = Math.max(1, Math.min(args.concurrency, selectedSamples.length));

  const worker = async () => {
    while (true) {
      const index = cursor;
      cursor += 1;
      if (index >= selectedSamples.length || stopRequested) return;

      const sample = selectedSamples[index];
      const sampleResult = createSampleResult(sample);

      try {
        const draftResult = args.mode === "parser"
          ? await runParserSample({ args, sample })
          : await runE2ESample({ args, sample, imagesDir });

        sampleResult.parsedNames = draftResult.parsedNames;
        sampleResult.parsedIngredients = draftResult.parsedIngredients;
        sampleResult.completenessRatio = draftResult.completenessRatio;
        sampleResult.laneSplitChosen = draftResult.laneSplitChosen;
        sampleResult.needsConfirmation = Boolean(draftResult.needsConfirmation);
        sampleResult.issues = draftResult.issues;
        sampleResult.parserFixturePath = draftResult.parserFixturePath ?? null;
        sampleResult.httpStatus = draftResult.httpStatus ?? 200;
        sampleResult.durationMs = draftResult.durationMs ?? null;

        sampleResult.abstainIssueHit = sampleResult.issues.some((issue) => ABSTAIN_ISSUES.has(issue));
        sampleResult.overconfidentCase = !sampleResult.evalTarget && (sampleResult.parsedIngredients ?? 0) >= 3 && !sampleResult.needsConfirmation;

        if (sampleResult.evalTarget) {
          const expectedKeys = Array.isArray(sample.key_ingredients_gt)
            ? sample.key_ingredients_gt.filter(Boolean)
            : [];
          const match = evaluateKeyIngredients(expectedKeys, sampleResult.parsedNames, args.fuzzyThreshold);
          sampleResult.keyIngredientRecallSoft = match.recallSoft;
          sampleResult.keyIngredientRecallHard = match.recallHard;
          sampleResult.keyIngredientPrecisionSoft = match.precisionSoft;
          sampleResult.keyIngredientPrecisionHard = match.precisionHard;
          sampleResult.keyIngredientF1Soft = match.f1Soft;
          sampleResult.keyIngredientF1Hard = match.f1Hard;
          sampleResult.unmatchedDebug = match.unmatchedDebug;
        }

        sampleResult.ok = true;
        consecutiveAuthFailures = 0;
      } catch (error) {
        sampleResult.error = error instanceof Error ? error.message : String(error);
        if (error instanceof RegressionRequestError) {
          sampleResult.httpStatus = error.httpStatus;
          sampleResult.durationMs = error.durationMs;
          sampleResult.failureClass = error.failureClass;
        } else if (sampleResult.error === "api_timeout") {
          sampleResult.failureClass = "timeout";
        } else if (sampleResult.error?.startsWith("api_failed_401") || sampleResult.error?.startsWith("api_failed_403")) {
          sampleResult.failureClass = "auth";
        } else if (sampleResult.error?.startsWith("api_failed_")) {
          sampleResult.failureClass = "http";
        } else {
          sampleResult.failureClass = "parser";
        }

        if (args.mode === "e2e" && sampleResult.failureClass === "auth") {
          consecutiveAuthFailures += 1;
          consecutiveAuthFailuresMax = Math.max(consecutiveAuthFailuresMax, consecutiveAuthFailures);
          if (consecutiveAuthFailures >= args.authFailFast) {
            authFailFastTriggered = true;
            stopRequested = true;
          }
        } else {
          consecutiveAuthFailures = 0;
        }
      }

      results[index] = sampleResult;
    }
  };

  await Promise.all(Array.from({ length: workerCount }, () => worker()));
  const compactResults = results.filter(Boolean);

  const bucketSummary = summarizeByBucket(compactResults);
  const failuresFromSamples = compactResults.filter((item) => !item.ok).map((item) => `${item.imageId}:${item.error}`);
  const failureClassCounts = compactResults
    .filter((item) => !item.ok)
    .reduce((acc, item) => {
      const key = item.failureClass ?? "unknown";
      acc[key] = (acc[key] ?? 0) + 1;
      return acc;
    }, {});
  const gate = buildGateResult({
    rows: compactResults,
    bucketSummary,
    baselineSummary,
    requirements: manifest.requirements ?? null,
    sampleCount: compactResults.length,
    gateMode: effectiveGateMode,
  });

  if (authFailFastTriggered) {
    const warning = `auth_fail_fast_triggered(consecutive=${args.authFailFast})`;
    if (effectiveGateMode === "required") {
      gate.warnings.push(warning);
    } else {
      gate.warnings.push(warning);
    }
  }

  if (failuresFromSamples.length) {
    if (effectiveGateMode === "required") {
      gate.pass = false;
      gate.failures.push(...failuresFromSamples.slice(0, 30));
    } else {
      gate.warnings.push(...failuresFromSamples.slice(0, 30));
    }
  }

  const unmatchedDebugTop = compactResults
    .flatMap((row) => (row.unmatchedDebug ?? []).map((entry) => ({ imageId: row.imageId, ...entry })))
    .slice(0, 200);
  const attributionSummary = summarizeAttribution(selectedSamples);

  const summary = {
    generatedAt: new Date().toISOString(),
    manifestPath,
    imagesDir: args.mode === "e2e" ? imagesDir : null,
    ocrFixturesDir: args.mode === "parser" ? ocrFixturesDir : null,
    apiBase: args.mode === "e2e" ? args.apiBase : null,
    mode: args.mode,
    gateMode: effectiveGateMode,
    fuzzyThreshold: args.fuzzyThreshold,
    selectedSampleCount: selectedSamples.length,
    sampleCount: compactResults.length,
    datasetVersion: manifest.datasetVersion ?? "unknown",
    e2eOptions: args.mode === "e2e"
      ? {
        timeoutMs: args.timeoutMs,
        concurrency: args.concurrency,
        maxSamples: args.maxSamples,
        authFailFast: args.authFailFast,
      }
      : null,
    counts: {
      targetSamples: compactResults.filter((row) => row.evalTarget).length,
      nonTargetSamples: compactResults.filter((row) => !row.evalTarget).length,
      failedSamples: failuresFromSamples.length,
      failureClassCounts,
      authFailFastTriggered,
      consecutiveAuthFailuresMax,
    },
    bucketSummary,
    gate,
    attributionSummary,
    debug: {
      unmatchedTop: unmatchedDebugTop,
    },
    aggregates: {
      completenessP50: percentile(compactResults.map((row) => row.completenessRatio).filter((v) => typeof v === "number"), 50),
      completenessP95: percentile(compactResults.map((row) => row.completenessRatio).filter((v) => typeof v === "number"), 95),
    },
  };

  await fs.writeFile(path.join(outputDir, "ocr_regression_results.json"), JSON.stringify(compactResults, null, 2));
  await fs.writeFile(path.join(outputDir, "ocr_regression_summary.json"), JSON.stringify(summary, null, 2));

  const reportLines = [
    "# OCR Regression Report",
    "",
    `- generatedAt: ${summary.generatedAt}`,
    `- datasetVersion: ${summary.datasetVersion}`,
    `- mode: ${summary.mode}`,
    `- gateMode: ${summary.gateMode}`,
    `- sampleCount: ${summary.sampleCount}`,
    `- target/nonTarget: ${summary.counts.targetSamples}/${summary.counts.nonTargetSamples}`,
    `- fuzzyThreshold: ${summary.fuzzyThreshold}`,
    `- required target panel: ${summary.gate.requiredTargetPanel} (count=${summary.gate.requiredTargetCount})`,
    `- required target insufficient: ${summary.gate.requiredTargetInsufficient}`,
    `- pass: ${summary.gate.pass === null ? "observe_mode" : summary.gate.pass}`,
    `- failures: ${summary.gate.failures.length ? summary.gate.failures.join(", ") : "none"}`,
    `- warnings: ${summary.gate.warnings.length ? summary.gate.warnings.join(", ") : "none"}`,
    `- auth fail-fast triggered: ${summary.counts.authFailFastTriggered}`,
    `- failure classes: ${JSON.stringify(summary.counts.failureClassCounts)}`,
    "",
    "## Gate Aggregates",
    `- target recall soft: ${summary.gate.aggregates.targetRecallSoft ?? "n/a"}`,
    `- target recall hard: ${summary.gate.aggregates.targetRecallHard ?? "n/a"}`,
    `- target precision soft: ${summary.gate.aggregates.targetPrecisionSoft ?? "n/a"}`,
    `- target precision hard: ${summary.gate.aggregates.targetPrecisionHard ?? "n/a"}`,
    `- target f1 soft: ${summary.gate.aggregates.targetF1Soft ?? "n/a"}`,
    `- target f1 hard: ${summary.gate.aggregates.targetF1Hard ?? "n/a"}`,
    `- observe-target recall soft: ${summary.gate.aggregates.observeTargetRecallSoft ?? "n/a"}`,
    `- observe-target precision soft: ${summary.gate.aggregates.observeTargetPrecisionSoft ?? "n/a"}`,
    `- observe-target f1 soft: ${summary.gate.aggregates.observeTargetF1Soft ?? "n/a"}`,
    `- non-target overconfident rate: ${summary.gate.aggregates.nonTargetOverconfidentRate ?? "n/a"}`,
    `- non-target abstain issue hit rate: ${summary.gate.aggregates.nonTargetAbstainIssueRate ?? "n/a"}`,
    "",
    "## Bucket Summary",
    ...Object.entries(bucketSummary).map(([bucket, item]) =>
      `- ${bucket}: count=${item.count}, success=${item.success}, target=${item.targetCount}, nonTarget=${item.nonTargetCount}, completenessAvg=${item.completenessAvg ?? "n/a"}, recallSoft=${item.keyIngredientRecallSoftAvg ?? "n/a"}, recallHard=${item.keyIngredientRecallHardAvg ?? "n/a"}, precisionSoft=${item.keyIngredientPrecisionSoftAvg ?? "n/a"}, precisionHard=${item.keyIngredientPrecisionHardAvg ?? "n/a"}, f1Soft=${item.keyIngredientF1SoftAvg ?? "n/a"}, f1Hard=${item.keyIngredientF1HardAvg ?? "n/a"}, overconfident=${item.overconfidentParseRate ?? "n/a"}`,
    ),
    "",
    "## Attribution Summary",
    ...summary.attributionSummary.providerCounts.slice(0, 10).map((item) => `- provider ${item.name}: ${item.count}`),
    ...summary.attributionSummary.licenseCounts.slice(0, 10).map((item) => `- license ${item.name}: ${item.count}`),
    ...summary.attributionSummary.attributionCounts.slice(0, 10).map((item) => `- attribution ${item.name}: ${item.count}`),
    "",
    "## Unmatched Debug (Top 20)",
    ...unmatchedDebugTop.slice(0, 20).map((item) => `- ${item.imageId} gt=${item.gt_term} reason=${item.miss_reason} best=${item.best_score}`),
  ];
  await fs.writeFile(path.join(outputDir, "ocr_regression_report.md"), reportLines.join("\n"));

  console.log(`[ocr-regression] wrote ${outputDir}`);
  const shouldFailProcess = effectiveGateMode === "required" && summary.gate.pass !== true;
  if (shouldFailProcess) {
    process.exit(1);
  }
}

main().catch((error) => {
  console.error("[ocr-regression] failed", error);
  process.exit(1);
});
