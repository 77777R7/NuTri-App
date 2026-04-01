import { normalizeText } from "./iherb-overlay-utils.mjs";

const FETCH_MODES = new Set([
  "reader_only",
  "reader_then_scrapling",
  "reader_scrapling_then_agent_browser",
  "manual_only",
]);

const normalizeLower = (value) => normalizeText(value).toLowerCase();

const normalizeMissingFields = (value) =>
  (Array.isArray(value) ? value : [])
    .map((item) => normalizeLower(item))
    .filter(Boolean);

const normalizeSourceTypes = (value) =>
  (Array.isArray(value) ? value : [])
    .map((item) => normalizeLower(item))
    .filter(Boolean);

const hasKnownUrl = (value) => {
  if (!value) return false;
  if (Array.isArray(value)) return value.some((item) => /^https?:\/\//i.test(String(item ?? "")));
  return /^https?:\/\//i.test(String(value ?? ""));
};

export const decideOfficialFetchPolicy = ({
  knownProductUrls = [],
  coreMissingFields = [],
  sourceTypes = [],
  hasUsIherbPage = false,
  highConfidenceUsProductPageReady = false,
  priorFailureReason = null,
  dynamicLikely = false,
  forceAgentBrowser = false,
} = {}) => {
  const reasons = [];
  const missing = normalizeMissingFields(coreMissingFields);
  const sources = new Set(normalizeSourceTypes(sourceTypes));
  const knownUrlReady = hasKnownUrl(knownProductUrls);
  const failure = normalizeLower(priorFailureReason);

  if (!knownUrlReady && !hasUsIherbPage) {
    return {
      mode: "manual_only",
      reasons: ["no_known_product_url"],
      confidence: "high",
    };
  }

  if (forceAgentBrowser) {
    return {
      mode: "reader_scrapling_then_agent_browser",
      reasons: ["forced_browser_verification"],
      confidence: "high",
    };
  }

  if (missing.length === 0) {
    return {
      mode: "reader_only",
      reasons: ["core_fields_already_present"],
      confidence: "high",
    };
  }

  if (failure.includes("429") || failure.includes("403") || failure.includes("blocked")) {
    reasons.push("prior_request_block");
  }

  if (dynamicLikely) {
    reasons.push("dynamic_content_likely");
  }

  if (missing.some((field) => field === "ingredient" || field === "dosage")) {
    reasons.push("missing_structured_facts");
  }

  if (missing.some((field) => field === "suggested_use" || field === "warnings")) {
    reasons.push("missing_description_sections");
  }

  if (missing.includes("product_image")) {
    reasons.push("missing_image_assets");
  }

  if (sources.has("iherb_us_product_page") || (hasUsIherbPage && highConfidenceUsProductPageReady)) {
    if (reasons.includes("prior_request_block") || reasons.includes("dynamic_content_likely")) {
      return {
        mode: "reader_scrapling_then_agent_browser",
        reasons: [...new Set(reasons)],
        confidence: "high",
      };
    }
    return {
      mode: "reader_then_scrapling",
      reasons: [...new Set(reasons.length > 0 ? reasons : ["high_confidence_known_page"])],
      confidence: "medium",
    };
  }

  if (knownUrlReady) {
    return {
      mode: reasons.includes("dynamic_content_likely")
        ? "reader_scrapling_then_agent_browser"
        : "reader_then_scrapling",
      reasons: [...new Set(reasons.length > 0 ? reasons : ["known_product_url"])],
      confidence: "medium",
    };
  }

  return {
    mode: "manual_only",
    reasons: [...new Set(reasons.length > 0 ? reasons : ["insufficient_fetch_context"])],
    confidence: "low",
  };
};

export const assertOfficialFetchMode = (value) => {
  if (!FETCH_MODES.has(value)) {
    throw new Error(`Unsupported official fetch mode: ${value}`);
  }
  return value;
};
