import fs from "node:fs/promises";
import path from "node:path";

import {
  containsUnsafeLanguage,
  evaluatePersonaExpectations,
} from "./cross-surface-quality-reporting.mjs";
import { ROOT_DIR, writeJson, writeText } from "./science-validation-reporting.mjs";

const DEFAULT_TIMEOUT_MS = 20_000;
const DEFAULT_STREAM_RETRIES = 2;
const DEFAULT_PERSONALIZATION_PREFERRED_TYPES = [
  "Vitamin",
  "Mineral",
  "Herb",
  "Probiotic",
  "Protein",
  "Omega-3",
];
const DUPLICATE_STACK_SAVED_SUPPLEMENTS = [
  {
    supplementId: "runtime-zinc-stack",
    productName: "Zinc Daily",
    dosageText: "1 serving",
  },
  {
    supplementId: "runtime-magnesium-stack",
    productName: "Magnesium Glycinate",
    dosageText: "1 serving",
  },
  {
    supplementId: "runtime-vitamin-d-stack",
    productName: "Vitamin D3",
    dosageText: "1 serving",
  },
];
const PERSONA_LOCAL_PROFILE_OVERRIDES = {
  fish_allergy: { allergyFlags: ["fish"] },
  shellfish_allergy: { allergyFlags: ["shellfish"] },
  dairy_allergy: { allergyFlags: ["dairy"] },
  soy_allergy: { allergyFlags: ["soy"] },
  gluten_restriction: { ingredientRestrictions: ["gluten"] },
  gelatin_restriction: { ingredientRestrictions: ["gelatin"] },
  vegan_preference: { diets: ["vegan"] },
  pregnancy_prenatal: { goals: ["Prenatal"], sex: "female" },
  melatonin_sensitivity: { ingredientRestrictions: ["melatonin"] },
  stimulant_sensitivity: { ingredientRestrictions: ["caffeine"] },
  duplicate_zinc_magnesium_d: { savedSupplements: DUPLICATE_STACK_SAVED_SUPPLEMENTS },
  digestion_goal: { goals: ["Digestion"] },
  sleep_goal: { goals: ["Sleep"] },
  immunity_goal: { goals: ["Immunity"] },
  fitness_recovery_goal: { goals: ["Recovery", "Fitness"] },
  stress_goal: { goals: ["Stress Support"] },
 };

const isPlainObject = (value) =>
  Boolean(value) && typeof value === "object" && !Array.isArray(value);

const normalizeText = (value) =>
  String(value ?? "")
    .replace(/\s+/g, " ")
    .trim();

const normalizeLooseText = (value) =>
  normalizeText(value)
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();

const normalizeBarcode = (value) => {
  const digits = String(value ?? "").replace(/\D/g, "");
  if (!digits) return null;
  if (digits.length >= 14) return digits.slice(-14);
  if (digits.length >= 8) return digits.padStart(14, "0");
  return null;
};

const tokenizeComparable = (value) =>
  normalizeLooseText(value)
    .split(/\s+/)
    .filter((token) => token.length >= 3 && !/^\d+$/.test(token));

const buildGateResult = ({
  gate,
  status,
  reason,
  severity = null,
  details = {},
}) => ({
  gate,
  status,
  reason,
  severity,
  details,
});

const countBy = (items, selector) =>
  items.reduce((acc, item) => {
    const key = selector(item) ?? "unknown";
    acc[key] = (acc[key] ?? 0) + 1;
    return acc;
  }, {});

const sleep = async (ms) => {
  if (!Number.isFinite(Number(ms)) || Number(ms) <= 0) return;
  await new Promise((resolve) => setTimeout(resolve, Number(ms)));
};

const stableUniqueStrings = (values) =>
  Array.from(
    new Set(
      (Array.isArray(values) ? values : [])
        .map((value) => normalizeText(value))
        .filter(Boolean),
    ),
  );

const FOOD_LIKE_RUNTIME_PATTERN = /\b(drink mix|gel|bar|snack|latte|aminos|soy sauce replacement|chewable|gummy)\b/i;
const OPERATIONAL_SIDECAR_FALLBACK_REASONS = new Set([
  "llm_unconfigured",
  "llm_timeout",
]);
const OPERATIONAL_SIDECAR_FALLBACK_REASON_PATTERN = /^[a-z0-9]+_http_\d+$/i;

const isFoodLikeRuntimeScenario = (scenario) =>
  scenario?.category === "food_like"
  || FOOD_LIKE_RUNTIME_PATTERN.test(
    [
      scenario?.product?.name,
      scenario?.input?.query,
      scenario?.input?.searchResultSeed?.name,
    ].filter(Boolean).join(" "),
  );

const hasHeader = (headers, headerName) =>
  Object.keys(headers ?? {}).some((key) => key.toLowerCase() === headerName.toLowerCase());

const rawScenarioBarcodeValue = (scenario) =>
  scenario?.input?.barcode
  ?? scenario?.input?.searchResultSeed?.barcode
  ?? scenario?.input?.searchResultSeed?.upcCode
  ?? scenario?.product?.barcode
  ?? null;

const scenarioProductId = (scenario) =>
  normalizeText(
    scenario?.product?.productId
    ?? scenario?.input?.searchResultSeed?.productId
    ?? null,
  ) || null;

const buildLocalPersonalizationContext = (scenario) => {
  const personas = Array.isArray(scenario?.personas) ? scenario.personas : [];
  const profile = {
    goals: [],
    diets: [],
    allergyFlags: [],
    ingredientRestrictions: [],
    preferredTypes: [],
  };
  const savedSupplements = [];

  for (const persona of personas) {
    const overrides = PERSONA_LOCAL_PROFILE_OVERRIDES[persona];
    if (!overrides) continue;
    if (Array.isArray(overrides.goals)) profile.goals.push(...overrides.goals);
    if (Array.isArray(overrides.diets)) profile.diets.push(...overrides.diets);
    if (Array.isArray(overrides.allergyFlags)) profile.allergyFlags.push(...overrides.allergyFlags);
    if (Array.isArray(overrides.ingredientRestrictions)) {
      profile.ingredientRestrictions.push(...overrides.ingredientRestrictions);
    }
    if (Array.isArray(overrides.savedSupplements)) savedSupplements.push(...overrides.savedSupplements);
    if (typeof overrides.sex === "string" && !profile.sex) profile.sex = overrides.sex;
  }

  profile.goals = stableUniqueStrings(profile.goals);
  profile.diets = stableUniqueStrings(profile.diets);
  profile.allergyFlags = stableUniqueStrings(profile.allergyFlags);
  profile.ingredientRestrictions = stableUniqueStrings(profile.ingredientRestrictions);
  profile.preferredTypes = DEFAULT_PERSONALIZATION_PREFERRED_TYPES;

  const hasProfileValue =
    profile.goals.length > 0
    || profile.diets.length > 0
    || profile.allergyFlags.length > 0
    || profile.ingredientRestrictions.length > 0
    || Boolean(profile.sex);

  if (!hasProfileValue && savedSupplements.length === 0) return null;
  return {
    profile: hasProfileValue ? profile : null,
    savedSupplements,
  };
};

export const buildScenarioHeaders = ({ scenario, commonHeaders = {} }) => {
  const headers = {
    "x-auth-disabled": "1",
    ...commonHeaders,
  };
  const localContext = buildLocalPersonalizationContext(scenario);
  if (localContext && !hasHeader(headers, "x-local-personalization")) {
    headers["x-local-personalization"] = `local_v1:${encodeURIComponent(JSON.stringify(localContext))}`;
  }
  return headers;
};

export const flattenStrings = (value, acc = [], seen = new Set()) => {
  if (value == null) return acc;
  if (typeof value === "string") {
    const normalized = normalizeText(value);
    if (normalized) acc.push(normalized);
    return acc;
  }
  if (typeof value === "number" || typeof value === "boolean") {
    acc.push(String(value));
    return acc;
  }
  if (Array.isArray(value)) {
    for (const item of value) flattenStrings(item, acc, seen);
    return acc;
  }
  if (!isPlainObject(value) || seen.has(value)) return acc;
  seen.add(value);
  for (const nested of Object.values(value)) flattenStrings(nested, acc, seen);
  return acc;
};

const parseEventStreamText = (rawText) => {
  let currentEvent = "message";
  let dataLines = [];
  let latestBundle = null;
  let donePayload = null;
  let errorPayload = null;

  const flush = () => {
    if (!dataLines.length) return;
    const dataRaw = dataLines.join("\n");
    dataLines = [];
    let payload = null;
    try {
      payload = JSON.parse(dataRaw);
    } catch {
      payload = null;
    }
    if (currentEvent === "analysis_bundle" && payload && typeof payload === "object") {
      latestBundle = payload;
    } else if (currentEvent === "done") {
      donePayload = payload;
    } else if (currentEvent === "error") {
      errorPayload = payload;
    }
    currentEvent = "message";
  };

  for (const line of String(rawText ?? "").split(/\r?\n/)) {
    if (!line) {
      flush();
      continue;
    }
    if (line.startsWith("event:")) {
      currentEvent = line.slice(6).trim() || "message";
      continue;
    }
    if (line.startsWith("data:")) {
      dataLines.push(line.slice(5).trim());
    }
  }
  flush();

  return { latestBundle, donePayload, errorPayload };
};

const withTimeout = async (promiseFactory, timeoutMs = DEFAULT_TIMEOUT_MS) => {
  const controller = new AbortController();
  let timeoutId = null;
  try {
    const timeoutPromise = new Promise((_, reject) => {
      timeoutId = setTimeout(() => {
        controller.abort();
        reject(new Error("request_timeout"));
      }, timeoutMs);
    });
    return await Promise.race([promiseFactory(controller.signal), timeoutPromise]);
  } finally {
    if (timeoutId) clearTimeout(timeoutId);
  }
};

const safeJson = async (response) => {
  const text = await response.text();
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
};

const fetchJson = async ({
  fetchImpl = fetch,
  url,
  method = "GET",
  headers = {},
  body,
  timeoutMs = DEFAULT_TIMEOUT_MS,
  maxRetries = 1,
  retryDelayMs = 250,
}) => {
  let attempt = 0;
  while (attempt <= maxRetries) {
    try {
      const payload = await withTimeout(
        async (signal) => {
          const response = await fetchImpl(url, {
            method,
            headers,
            body,
            signal,
          });
          const parsed = await safeJson(response);
          return {
            ok: response.ok,
            status: response.status,
            payload: parsed,
          };
        },
        timeoutMs,
      );
      return payload;
    } catch (error) {
      if (attempt >= maxRetries) {
        return {
          ok: false,
          status: null,
          payload: null,
          error: error instanceof Error ? error.message : String(error),
        };
      }
      attempt += 1;
      await sleep(retryDelayMs);
    }
  }
  return {
    ok: false,
    status: null,
    payload: null,
    error: "fetch_retries_exhausted",
  };
};

export const fetchAnalysisBundle = async ({
  fetchImpl = fetch,
  apiBaseUrl,
  barcode,
  headers = {},
  timeoutMs = DEFAULT_TIMEOUT_MS,
  maxRetries = DEFAULT_STREAM_RETRIES,
}) => {
  let attempt = 0;
  while (attempt <= maxRetries) {
    try {
      const result = await withTimeout(
        async (signal) => {
          const response = await fetchImpl(`${apiBaseUrl}/api/enrich-stream`, {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              Accept: "text/event-stream",
              ...headers,
            },
            body: JSON.stringify({
              barcode,
              streamMode: "analysis_bundle_only",
            }),
            signal,
          });
          const rawText = await response.text();
          return {
            ok: response.ok,
            status: response.status,
            ...parseEventStreamText(rawText),
            rawText,
          };
        },
        timeoutMs,
      );

      if (result.latestBundle) {
        return {
          ...result,
          attempts: attempt + 1,
        };
      }

      const retryable = result?.errorPayload?.retryable === true || result?.errorPayload?.code === "STREAM_BUSY";
      const retryAfterMs = Number(result?.errorPayload?.retryAfterMs ?? 0);
      if (retryable && attempt < maxRetries) {
        await sleep(retryAfterMs > 0 ? retryAfterMs : 1500);
        attempt += 1;
        continue;
      }

      if (!result.latestBundle && attempt < maxRetries) {
        await sleep(retryAfterMs > 0 ? retryAfterMs : 1500);
        attempt += 1;
        continue;
      }

      return {
        ...result,
        attempts: attempt + 1,
      };
    } catch (error) {
      if (attempt >= maxRetries) {
        return {
          ok: false,
          status: null,
          latestBundle: null,
          donePayload: null,
          errorPayload: null,
          attempts: attempt + 1,
          error: error instanceof Error ? error.message : String(error),
        };
      }
      attempt += 1;
      await sleep(1500);
    }
  }
  return {
    ok: false,
    status: null,
    latestBundle: null,
    donePayload: null,
    errorPayload: null,
    attempts: maxRetries + 1,
    error: "analysis_bundle_unavailable",
  };
};

const scenarioBarcode = (scenario) =>
  normalizeBarcode(rawScenarioBarcodeValue(scenario));

const isSyntheticRuntimeScenario = (scenario) => {
  const rawBarcode = normalizeText(rawScenarioBarcodeValue(scenario));
  const productId = scenarioProductId(scenario);
  return /^fixture[-:_]/i.test(rawBarcode) || /^fixture[-:_]/i.test(productId ?? "");
};

const extractSidecarFallbackReason = (payload) =>
  normalizeText(
    payload?.fallbackReason
    ?? payload?.meta?.fallbackReason
    ?? payload?.meta?.fallback?.code
    ?? null,
  ) || null;

const isOperationalSidecarFallbackReason = (reason) => {
  const normalized = normalizeText(reason).toLowerCase();
  if (!normalized) return false;
  return (
    OPERATIONAL_SIDECAR_FALLBACK_REASONS.has(normalized)
    || OPERATIONAL_SIDECAR_FALLBACK_REASON_PATTERN.test(normalized)
  );
};

const extractSelectedAnchor = (payload) => {
  const rows = Array.isArray(payload?.scienceBlock?.ingredientRows)
    ? payload.scienceBlock.ingredientRows
    : [];
  for (const row of rows) {
    const name = normalizeText(row?.name ?? row?.ingredientName ?? row?.title);
    if (name) return name;
  }
  return null;
};

const extractScoreSnapshot = (payload) => {
  const card = payload?.nutriScoreCardV2 ?? null;
  return {
    overallScore: Number.isFinite(Number(card?.overallScore)) ? Number(card.overallScore) : null,
    overallBand: normalizeText(card?.overallBand) || null,
  };
};

const extractInlineScoreSnapshot = (bundle) => {
  const card = bundle?.meta?.decisionSupportInline?.nutriScoreCardV2 ?? null;
  return {
    overallScore: Number.isFinite(Number(card?.overallScore)) ? Number(card.overallScore) : null,
    overallBand: normalizeText(card?.overallBand) || null,
  };
};

const extractInlineAnchor = (bundle) =>
  extractSelectedAnchor(bundle?.meta?.decisionSupportInline ?? null);

const anchorMatchesAllowed = ({ selectedAnchor, allowedAnchors, disallowedAnchors }) => {
  const actual = normalizeLooseText(selectedAnchor);
  if (!actual) return false;

  const hitsDisallowed = (disallowedAnchors ?? []).some((anchor) => {
    const normalized = normalizeLooseText(anchor);
    return normalized && actual.includes(normalized);
  });
  if (hitsDisallowed) return false;

  return (allowedAnchors ?? []).some((anchor) => {
    const normalized = normalizeLooseText(anchor);
    if (!normalized) return false;
    if (actual === normalized) return true;
    if (actual.includes(normalized) || normalized.includes(actual)) return true;
    const expectedTokens = tokenizeComparable(anchor);
    if (expectedTokens.length === 0) return false;
    return expectedTokens.every((token) => actual.includes(token));
  });
};

const namesLookCompatible = (expectedName, actualName) => {
  const expected = normalizeLooseText(expectedName);
  const actual = normalizeLooseText(actualName);
  if (!expected || !actual) return false;
  if (expected === actual) return true;
  if (expected.includes(actual) || actual.includes(expected)) return true;
  const actualTokens = tokenizeComparable(actualName);
  if (actualTokens.length === 0) return false;
  return actualTokens.every((token) => expected.includes(token));
};

const brandsLookCompatible = (expectedBrand, actualBrand) => {
  const expected = normalizeLooseText(expectedBrand);
  const actual = normalizeLooseText(actualBrand);
  if (!expected || !actual) return false;
  if (expected === actual) return true;
  return expected.includes(actual) || actual.includes(expected);
};

const namesLookBarcodeAligned = (expectedName, actualName) => {
  if (namesLookCompatible(expectedName, actualName)) return true;
  const expectedTokens = tokenizeComparable(expectedName);
  const actualTokens = tokenizeComparable(actualName);
  if (expectedTokens.length === 0 || actualTokens.length === 0) return false;
  const overlap = actualTokens.filter((token) => expectedTokens.includes(token)).length;
  return overlap >= 3 && overlap / actualTokens.length >= 0.6;
};

const sectionHasVisibleContent = (sectionKey, payload) => {
  if (!isPlainObject(payload)) return false;
  if (sectionKey === "overview") {
    return flattenStrings([payload.cover, payload.detail]).length > 0;
  }
  if (sectionKey === "usage") {
    return flattenStrings([payload.cover, payload.detail]).length > 0;
  }
  if (sectionKey === "ingredients_detail") {
    return flattenStrings([payload.detail, payload.cover]).length > 0;
  }
  return flattenStrings(payload).length > 0;
};

const buildSidecarCopy = ({ decisionSupport, ingredientOverview, scientificBackground, sections }) =>
  [
    ...flattenStrings(decisionSupport?.overviewBlock),
    ...flattenStrings(decisionSupport?.scienceBlock),
    ...flattenStrings(decisionSupport?.usageBlock),
    ...flattenStrings(decisionSupport?.safetyBlock),
    ...flattenStrings(decisionSupport?.personalizedResultLane),
    ...flattenStrings(decisionSupport?.topBlockers),
    ...flattenStrings(decisionSupport?.blockers),
    ...flattenStrings(ingredientOverview?.ingredientOverview),
    ...flattenStrings(scientificBackground?.scientificBackground),
    ...flattenStrings(sections),
  ];

const evaluateSearchOriginIdentity = (scenario, bundle) => {
  if (scenario?.surface !== "search_origin_result") return null;
  const seed = scenario?.input?.searchResultSeed ?? {};
  const identity = bundle?.meta?.productIdentity ?? {};
  const expectedBarcode = normalizeBarcode(seed.barcode ?? seed.upcCode ?? scenario?.product?.barcode);
  const actualBarcode = scenarioBarcode(scenario);
  const mismatches = [];
  const barcodeMatches = Boolean(expectedBarcode && actualBarcode && expectedBarcode === actualBarcode);

  if (expectedBarcode && actualBarcode && expectedBarcode !== actualBarcode) {
    mismatches.push("barcode");
  }
  const expectedBrand = normalizeLooseText(seed.brand ?? scenario?.product?.brand);
  const actualBrand = normalizeLooseText(identity.brand);
  if (
    expectedBrand &&
    actualBrand &&
    !brandsLookCompatible(seed.brand ?? scenario?.product?.brand, identity.brand)
  ) {
    mismatches.push("brand");
  }
  const expectedName = normalizeLooseText(seed.name ?? scenario?.product?.name);
  const actualName = normalizeLooseText(identity.name);
  if (
    expectedName &&
    actualName &&
    !(
      barcodeMatches
      ? namesLookBarcodeAligned(seed.name ?? scenario?.product?.name, identity.name)
      : namesLookCompatible(seed.name ?? scenario?.product?.name, identity.name)
    )
  ) {
    mismatches.push("name");
  }

  if ((expectedBrand && !actualBrand) || (expectedName && !actualName)) {
    mismatches.push("identity_missing");
  }

  if (mismatches.length > 0 && mismatches.every((item) => item === "identity_missing") && expectedBarcode === actualBarcode) {
    return buildGateResult({
      gate: "canonical_product_consistency",
      status: "warn",
      reason: "search_origin_identity_partial",
      severity: null,
      details: {
        mismatches,
        expectedBrand: seed.brand ?? scenario?.product?.brand ?? null,
        actualBrand: identity.brand ?? null,
        expectedName: seed.name ?? scenario?.product?.name ?? null,
        actualName: identity.name ?? null,
        expectedBarcode,
        actualBarcode,
      },
    });
  }

  return buildGateResult({
    gate: "canonical_product_consistency",
    status: mismatches.length === 0 ? "pass" : "fail",
    reason: mismatches.length === 0 ? "search_origin_identity_consistent" : "search_origin_identity_mismatch",
    severity: mismatches.length === 0 ? null : scenario?.severityOnFail ?? "P1",
    details: {
      mismatches,
      expectedBrand: seed.brand ?? scenario?.product?.brand ?? null,
      actualBrand: identity.brand ?? null,
      expectedName: seed.name ?? scenario?.product?.name ?? null,
      actualName: identity.name ?? null,
      expectedBarcode,
      actualBarcode,
    },
  });
};

const evaluateRouteHealth = ({ scenario, decisionSupport, analysisBundle, endpointErrors }) => {
  const missing = [];
  const isFoodLike = isFoodLikeRuntimeScenario(scenario);
  if (!decisionSupport?.ok || decisionSupport.payload?.status !== "ok") {
    missing.push("decision_support");
  }
  if (!isFoodLike && (!analysisBundle?.ok || !analysisBundle.latestBundle)) {
    missing.push("analysis_bundle");
  }
  if (endpointErrors.length > 0) {
    missing.push(...endpointErrors);
  }
  return buildGateResult({
    gate: "route_health",
    status: missing.length === 0 ? "pass" : "fail",
    reason: missing.length === 0 ? "runtime_routes_healthy" : "runtime_route_failure",
    severity: missing.length === 0 ? null : scenario?.severityOnFail ?? "P1",
    details: { missing },
  });
};

const evaluateMainMiniScore = ({ scenario, decisionSupportPayload, bundle }) => {
  const score = extractScoreSnapshot(decisionSupportPayload);
  const inlineScore = extractInlineScoreSnapshot(bundle);
  const isFoodLike = isFoodLikeRuntimeScenario(scenario);
  const bundleInlineMissing = !bundle?.meta?.decisionSupportInline;

  if (score.overallScore == null || inlineScore.overallScore == null) {
    return buildGateResult({
      gate: "score_consistency",
      status: isFoodLike ? "pass" : bundleInlineMissing ? "warn" : "fail",
      reason:
        isFoodLike
          ? "score_not_required_for_food_like"
          : bundleInlineMissing
            ? "score_not_checkable_without_analysis_bundle"
            : "score_missing",
      severity: isFoodLike || bundleInlineMissing ? null : scenario?.severityOnFail ?? "P1",
      details: { score, inlineScore },
    });
  }

  const sameScore = score.overallScore === inlineScore.overallScore;
  const sameBand =
    !score.overallBand
    || !inlineScore.overallBand
    || score.overallBand === inlineScore.overallBand;

  return buildGateResult({
    gate: "score_consistency",
    status: sameScore && sameBand ? "pass" : "fail",
    reason: sameScore && sameBand ? "main_and_inline_scores_match" : "main_mini_score_mismatch",
    severity: sameScore && sameBand ? null : scenario?.severityOnFail ?? "P1",
    details: { score, inlineScore },
  });
};

const evaluateSelectedAnchor = ({ scenario, decisionSupportPayload, bundle }) => {
  const selectedAnchor = extractSelectedAnchor(decisionSupportPayload);
  const inlineAnchor = extractInlineAnchor(bundle);
  const allowedAnchors = Array.isArray(scenario?.expected?.defaultAnchor?.pass)
    ? scenario.expected.defaultAnchor.pass
    : [];
  const disallowedAnchors = Array.isArray(scenario?.expected?.defaultAnchor?.fail)
    ? scenario.expected.defaultAnchor.fail
    : [];
  const isFoodLike = isFoodLikeRuntimeScenario(scenario);

  if (!selectedAnchor) {
    return buildGateResult({
      gate: "selected_anchor_consistency",
      status: isFoodLike ? "warn" : "fail",
      reason: isFoodLike ? "selected_anchor_not_required_for_food_like" : "selected_anchor_missing",
      severity: isFoodLike ? null : scenario?.severityOnFail ?? "P1",
      details: { allowedAnchors, inlineAnchor },
    });
  }

  const expectedPass =
    allowedAnchors.length === 0
    || anchorMatchesAllowed({
      selectedAnchor,
      allowedAnchors,
      disallowedAnchors,
    });
  const inlinePass =
    !inlineAnchor || normalizeLooseText(inlineAnchor) === normalizeLooseText(selectedAnchor);

  return buildGateResult({
    gate: "selected_anchor_consistency",
    status:
      expectedPass && inlinePass
        ? "pass"
        : isFoodLike
          ? "warn"
          : "fail",
    reason:
      expectedPass && inlinePass
        ? "selected_anchor_consistent"
        : isFoodLike
          ? "selected_anchor_runtime_warn_food_like"
          : "selected_anchor_runtime_mismatch",
    severity:
      expectedPass && inlinePass || isFoodLike
        ? null
        : scenario?.severityOnFail ?? "P1",
    details: {
      selectedAnchor,
      inlineAnchor,
      allowedAnchors,
    },
  });
};

const evaluateSections = ({ scenario, sections }) => {
  if (isFoodLikeRuntimeScenario(scenario)) {
    return buildGateResult({
      gate: "result_page_section_contract",
      status: "pass",
      reason: "food_like_result_sections_not_required",
      severity: null,
      details: {},
    });
  }
  const failures = [];
  const checkedSections = Object.entries(sections);
  for (const [sectionKey, response] of checkedSections) {
    if (!response?.ok) {
      failures.push({ section: sectionKey, reason: response?.error ?? `http_${response?.status ?? "unknown"}` });
      continue;
    }
    const payload = response.payload;
    const dataStatus = normalizeText(payload?.dataStatus) || "unknown";
    if (dataStatus === "pending") {
      const safePending = Number(payload?.meta?.retryAfterMs) > 0 || Boolean(payload?.meta?.fallbackReason || payload?.meta?.fallback?.code);
      if (!safePending) {
        failures.push({ section: sectionKey, reason: "pending_without_retry_or_fallback" });
      }
      continue;
    }
    if ((dataStatus === "complete" || dataStatus === "limited") && !sectionHasVisibleContent(sectionKey, payload)) {
      failures.push({ section: sectionKey, reason: "blank_visible_section" });
      continue;
    }
    if (dataStatus === "not_provided" && !sectionHasVisibleContent(sectionKey, payload) && !payload?.meta?.fallbackReason) {
      failures.push({ section: sectionKey, reason: "not_provided_without_fallback" });
    }
  }

  if (
    failures.length > 0 &&
    failures.every((failure) => failure.reason === "authoritative_identity_missing")
  ) {
    return buildGateResult({
      gate: "result_page_section_contract",
      status: "warn",
      reason: "result_sections_not_checkable_without_analysis_bundle",
      severity: null,
      details: { failures },
    });
  }

  return buildGateResult({
    gate: "result_page_section_contract",
    status: failures.length === 0 ? "pass" : "fail",
    reason: failures.length === 0 ? "result_sections_safe" : "result_section_contract_failed",
    severity: failures.length === 0 ? null : scenario?.severityOnFail ?? "P1",
    details: { failures },
  });
};

const evaluateSidecars = ({ scenario, ingredientOverview, scientificBackground }) => {
  if (isFoodLikeRuntimeScenario(scenario)) {
    return buildGateResult({
      gate: "sidecar_contract",
      status: "pass",
      reason: "food_like_sidecars_not_required",
      severity: null,
      details: {},
    });
  }

  const failures = [];
  const warnings = [];
  const acceptedOperationalFallbacks = [];
  const overviewPayload = ingredientOverview?.payload;
  const scientificPayload = scientificBackground?.payload;

  if (!ingredientOverview?.ok) {
    failures.push("ingredient_overview_request_failed");
  } else if (flattenStrings(overviewPayload?.ingredientOverview).length === 0) {
    failures.push("ingredient_overview_blank");
  } else if (overviewPayload?.fallbackUsed === true || overviewPayload?.backgroundRefreshPending === true) {
    const fallbackReason = extractSidecarFallbackReason(overviewPayload);
    if (isOperationalSidecarFallbackReason(fallbackReason)) {
      acceptedOperationalFallbacks.push({
        section: "ingredient_overview",
        reason: fallbackReason,
      });
    } else {
      warnings.push("ingredient_overview_fallback");
    }
  }

  if (!scientificBackground?.ok) {
    failures.push("scientific_background_request_failed");
  } else if (flattenStrings(scientificPayload?.scientificBackground).length === 0) {
    failures.push("scientific_background_blank");
  } else if (scientificPayload?.fallbackUsed === true || scientificPayload?.backgroundRefreshPending === true) {
    const fallbackReason = extractSidecarFallbackReason(scientificPayload);
    if (isOperationalSidecarFallbackReason(fallbackReason)) {
      acceptedOperationalFallbacks.push({
        section: "scientific_background",
        reason: fallbackReason,
      });
    } else {
      warnings.push("scientific_background_fallback");
    }
  }

  if (failures.length > 0) {
    return buildGateResult({
      gate: "sidecar_contract",
      status: "fail",
      reason: "sidecar_contract_failed",
      severity: scenario?.severityOnFail ?? "P1",
      details: { failures, warnings, acceptedOperationalFallbacks },
    });
  }

  return buildGateResult({
    gate: "sidecar_contract",
    status: warnings.length > 0 ? "warn" : "pass",
    reason:
      warnings.length > 0
        ? "sidecar_fallback_safe"
        : acceptedOperationalFallbacks.length > 0
          ? "sidecars_ready_via_operational_fallback"
          : "sidecars_ready",
    severity: null,
    details: { warnings, acceptedOperationalFallbacks },
  });
};

const evaluateSourceFamilyConsistency = ({ scenario, runtimeCopy }) => {
  if (scenario?.category !== "omega3_source_oil") return null;
  const allowed = Array.isArray(scenario?.expected?.defaultAnchor?.pass)
    ? scenario.expected.defaultAnchor.pass.map(normalizeLooseText)
    : [];
  const joined = runtimeCopy.map(normalizeLooseText).join(" ");
  const expectsAlgal = allowed.some((term) => term.includes("algal"));

  if (!expectsAlgal) {
    return buildGateResult({
      gate: "warning_consistency",
      status: "pass",
      reason: "source_family_consistent",
      severity: null,
      details: {},
    });
  }

  const flippedToFish = joined.includes("fish oil");
  return buildGateResult({
    gate: "warning_consistency",
    status: flippedToFish ? "fail" : "pass",
    reason: flippedToFish ? "source_family_flip" : "source_family_consistent",
    severity: flippedToFish ? scenario?.severityOnFail ?? "P1" : null,
    details: { expectsAlgal, flippedToFish },
  });
};

const evaluateUnsafeLanguageGate = ({ scenario, runtimeCopy }) =>
  buildGateResult({
    gate: "unsafe_language",
    status: containsUnsafeLanguage(runtimeCopy) ? "fail" : "pass",
    reason: containsUnsafeLanguage(runtimeCopy) ? "unsafe_language_detected" : "unsafe_language_clear",
    severity: containsUnsafeLanguage(runtimeCopy) ? scenario?.severityOnFail ?? "P0" : null,
    details: {},
  });

export const evaluateRuntimeContractRow = ({
  scenario,
  decisionSupport,
  analysisBundle,
  ingredientOverview,
  scientificBackground,
  analysisSections,
}) => {
  const decisionSupportPayload = decisionSupport?.payload ?? null;
  const bundle = analysisBundle?.latestBundle ?? null;
  const runtimeCopy = buildSidecarCopy({
    decisionSupport: decisionSupportPayload,
    ingredientOverview: ingredientOverview?.payload,
    scientificBackground: scientificBackground?.payload,
    sections: Object.fromEntries(
      Object.entries(analysisSections).map(([sectionKey, response]) => [sectionKey, response?.payload ?? null]),
    ),
  });
  const endpointErrors = [];
  if (decisionSupport?.ok === false) endpointErrors.push("decision_support");
  if (analysisBundle?.ok === false) endpointErrors.push("analysis_bundle");

  const gates = [
    evaluateRouteHealth({ scenario, decisionSupport, analysisBundle, endpointErrors }),
    evaluateMainMiniScore({ scenario, decisionSupportPayload, bundle }),
    evaluateSelectedAnchor({ scenario, decisionSupportPayload, bundle }),
    evaluateSections({ scenario, sections: analysisSections }),
    evaluateSidecars({ scenario, ingredientOverview, scientificBackground }),
    ...evaluatePersonaExpectations(scenario, {
      warnings: flattenStrings(decisionSupportPayload?.topBlockers),
      chips: flattenStrings(decisionSupportPayload?.personalizedResultLane),
      copy: runtimeCopy,
    }),
    evaluateUnsafeLanguageGate({ scenario, runtimeCopy }),
  ];

  const searchOriginGate = evaluateSearchOriginIdentity(scenario, bundle);
  if (searchOriginGate) gates.push(searchOriginGate);

  const sourceFamilyGate = evaluateSourceFamilyConsistency({ scenario, runtimeCopy });
  if (sourceFamilyGate) gates.push(sourceFamilyGate);

  const failures = gates.filter((gate) => gate.status === "fail");
  const warnings = gates.filter((gate) => gate.status === "warn");

  return {
    scenarioId: scenario.id,
    status: failures.length > 0 ? "fail" : warnings.length > 0 ? "warn" : "pass",
    product: scenario.product,
    barcode: scenarioBarcode(scenario),
    surface: scenario.surface,
    category: scenario.category,
    personas: scenario.personas ?? [],
    selectedAnchor: extractSelectedAnchor(decisionSupportPayload),
    inlineSelectedAnchor: extractInlineAnchor(bundle),
    score: extractScoreSnapshot(decisionSupportPayload),
    inlineScore: extractInlineScoreSnapshot(bundle),
    gates,
    failures,
    warnings,
    endpointStatus: {
      decisionSupport: decisionSupport?.status ?? null,
      analysisBundle: analysisBundle?.status ?? null,
      ingredientOverview: ingredientOverview?.status ?? null,
      scientificBackground: scientificBackground?.status ?? null,
    },
  };
};

const buildAnalysisSectionBody = ({ identity, factsDigestHash, promptVersion, section }) => ({
  identity,
  section,
  locale: "en",
  promptVersion,
  factsDigestHash,
});

export const createRuntimeContractReport = async ({
  pack,
  apiBaseUrl,
  fetchImpl = fetch,
  scenarioLimit = null,
  timestamp = Date.now(),
  commonHeaders = {},
}) => {
  const scenarios = Array.isArray(pack?.scenarios) ? pack.scenarios : [];
  const selectedScenarios = Number.isFinite(Number(scenarioLimit)) && Number(scenarioLimit) > 0
    ? scenarios.slice(0, Number(scenarioLimit))
    : scenarios;
  const rows = [];

  for (const scenario of selectedScenarios) {
    const scenarioHeaders = buildScenarioHeaders({ scenario, commonHeaders });
    const barcode = scenarioBarcode(scenario);
    if (!barcode) {
      const runtimeApplicable = !isSyntheticRuntimeScenario(scenario);
      const routeHealthGate = buildGateResult({
        gate: "route_health",
        status: runtimeApplicable ? "warn" : "pass",
        reason: runtimeApplicable ? "runtime_barcode_missing" : "runtime_fixture_not_live_applicable",
        severity: null,
        details: {
          rawBarcode: normalizeText(rawScenarioBarcodeValue(scenario)) || null,
          productId: scenarioProductId(scenario),
        },
      });
      rows.push({
        scenarioId: scenario.id,
        status: runtimeApplicable ? "warn" : "pass",
        product: scenario.product,
        barcode: null,
        surface: scenario.surface,
        category: scenario.category,
        personas: scenario.personas ?? [],
        gates: [routeHealthGate],
        failures: [],
        warnings: runtimeApplicable ? [routeHealthGate] : [],
      });
      continue;
    }

    const decisionSupport = await fetchJson({
      fetchImpl,
      url: `${apiBaseUrl}/api/decision-support/v1?barcode=${encodeURIComponent(barcode)}&viewMode=summary`,
      headers: scenarioHeaders,
    });
    const analysisBundle = await fetchAnalysisBundle({
      fetchImpl,
      apiBaseUrl,
      barcode,
      headers: scenarioHeaders,
    });

    const decisionSupportPayload = decisionSupport?.payload ?? {};
    const bundle = analysisBundle?.latestBundle ?? {};
    const selectedAnchor = extractSelectedAnchor(decisionSupportPayload);
    const authoritativeIdentity = bundle?.meta?.authoritativeIdentity ?? null;
    const factsDigestHash = normalizeText(bundle?.meta?.factsDigestHash ?? decisionSupportPayload?.factsDigestHash);
    const promptVersion = normalizeText(bundle?.meta?.promptVersion ?? "reg_v4.0");
    const decisionDigest = normalizeText(decisionSupportPayload?.digest);
    const decisionInputsHash = normalizeText(decisionSupportPayload?.decisionInputsHash);
    const personalizationScopeHash = normalizeText(decisionSupportPayload?.personalizationScopeHash);

    const sidecarBody = {
      barcode,
      decisionDigest: decisionDigest || null,
      decisionInputsHash: decisionInputsHash || null,
      personalizationScopeHash: personalizationScopeHash || null,
      authoritativeIdentityType: normalizeText(authoritativeIdentity?.type) || null,
      authoritativeIdentityValue: normalizeText(authoritativeIdentity?.value) || null,
    };

    const ingredientOverview = await fetchJson({
      fetchImpl,
      url: `${apiBaseUrl}/api/ingredient-overview/v1`,
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...scenarioHeaders,
      },
      body: JSON.stringify(sidecarBody),
    });

    const scientificBackground = selectedAnchor
      ? await fetchJson({
        fetchImpl,
        url: `${apiBaseUrl}/api/scientific-background/v1`,
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...scenarioHeaders,
        },
        body: JSON.stringify({
          ...sidecarBody,
          selectedIngredientName: selectedAnchor,
        }),
      })
      : {
        ok: false,
        status: null,
        payload: null,
        error: "selected_anchor_missing",
      };

    const analysisSections = {};
    if (authoritativeIdentity?.type && authoritativeIdentity?.value && factsDigestHash) {
      for (const section of ["overview", "ingredients_detail", "usage"]) {
        analysisSections[section] = await fetchJson({
          fetchImpl,
          url: `${apiBaseUrl}/api/analysis-section`,
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            ...scenarioHeaders,
          },
          body: JSON.stringify(buildAnalysisSectionBody({
            identity: authoritativeIdentity,
            factsDigestHash,
            promptVersion,
            section,
          })),
        });
      }
    } else {
      for (const section of ["overview", "ingredients_detail", "usage"]) {
        analysisSections[section] = {
          ok: false,
          status: null,
          payload: null,
          error: "authoritative_identity_missing",
        };
      }
    }

    rows.push(
      evaluateRuntimeContractRow({
        scenario,
        decisionSupport,
        analysisBundle,
        ingredientOverview,
        scientificBackground,
        analysisSections,
      }),
    );
  }

  const summary = {
    total: rows.length,
    pass: rows.filter((row) => row.status === "pass").length,
    warn: rows.filter((row) => row.status === "warn").length,
    fail: rows.filter((row) => row.status === "fail").length,
    surfaces: countBy(rows, (row) => row.surface),
    categories: countBy(rows, (row) => row.category),
    failedGates: countBy(
      rows.flatMap((row) => row.failures.map((failure) => failure.gate)),
      (gate) => gate,
    ),
    warningGates: countBy(
      rows.flatMap((row) => row.warnings.map((warning) => warning.gate)),
      (gate) => gate,
    ),
  };

  return {
    version: "runtime-contract-report.v0",
    generatedAt: timestamp,
    apiBaseUrl,
    packVersion: pack?.version ?? null,
    sourcePackVersion: pack?.sourcePackVersion ?? null,
    packRole: pack?.metadata?.packRole ?? null,
    summary,
    scenarios: rows,
  };
};

export const renderRuntimeContractMarkdown = (report) => {
  const lines = [
    "# Runtime Contract Report",
    "",
    `- packVersion: ${report.packVersion ?? "unknown"}`,
    `- packRole: ${report.packRole ?? "unknown"}`,
    `- apiBaseUrl: ${report.apiBaseUrl}`,
    `- total: ${report.summary.total}`,
    `- pass: ${report.summary.pass}`,
    `- warn: ${report.summary.warn}`,
    `- fail: ${report.summary.fail}`,
    "",
    "## Failed Gates",
    "",
  ];

  for (const [gate, count] of Object.entries(report.summary.failedGates ?? {})) {
    lines.push(`- ${gate}: ${count}`);
  }
  if (Object.keys(report.summary.failedGates ?? {}).length === 0) {
    lines.push("- none");
  }

  lines.push("", "## Scenario Status", "");
  for (const row of report.scenarios ?? []) {
    lines.push(`- ${row.scenarioId}: ${row.status}`);
  }

  return `${lines.join("\n")}\n`;
};

export const writeRuntimeContractReport = async ({
  report,
  outDir = "output/validation-runtime",
  outputBase = "runtime-contract-report",
}) => {
  const resolvedOutDir = path.resolve(ROOT_DIR, outDir);
  await fs.mkdir(resolvedOutDir, { recursive: true });
  const timestamp = String(report.generatedAt ?? Date.now());
  const jsonPath = path.join(outDir, `${outputBase}-${timestamp}.json`);
  const mdPath = path.join(outDir, `${outputBase}-${timestamp}.md`);
  await writeJson(jsonPath, report);
  await writeText(mdPath, renderRuntimeContractMarkdown(report));
  return { jsonPath, mdPath };
};
