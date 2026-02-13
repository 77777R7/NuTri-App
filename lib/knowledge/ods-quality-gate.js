const META_MARKERS = [
  "table of contents",
  "last updated",
  "for information on",
  "for more information",
  "dietary supplements in the time of covid-19",
  "covid-19",
  "learn more",
  "see also",
];

const LINKY_PATTERNS = [/\bsee\b/i, /\blearn more\b/i, /\bclick\b/i, /\bread more\b/i, /https?:\/\//i];
const LOW_SIGNAL_BULLET_PATTERNS = [
  /^\d+\s*(mg|mcg|g|iu|ml|oz)\b/i,
  /^scientists?\s+are\s+studying\b/i,
  /^people\s+who\s+eat\b/i,
  /^vitamin\s+[a-z0-9]+\s+is\s+a\s+nutrient\b/i,
  /^omega-?3\s+dietary\s+supplements?\s+include\b/i,
];

export const normalizeOdsText = (input) => {
  const value = typeof input === "string" ? input : "";
  if (!value) return "";
  return value
    .replace(/[\u2010-\u2015\u2212]/g, "-")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/\s+/g, " ")
    .replace(/\s+([.,;:!?])/g, "$1")
    .trim();
};

const normalizedLower = (input) => normalizeOdsText(input).toLowerCase();

const startsWithMetaPrefix = (textLower) =>
  textLower.startsWith("for information on") ||
  textLower.startsWith("for more information") ||
  textLower.startsWith("see ") ||
  textLower.startsWith("learn more");

export const isLowQualityOdsOverview = (input) => {
  const normalized = normalizeOdsText(input);
  if (!normalized) return true;

  const lower = normalized.toLowerCase();
  if (normalized.length < 40 || normalized.length > 250) return true;
  if (normalized.includes("?")) return true;
  if (startsWithMetaPrefix(lower)) return true;
  if (META_MARKERS.some((marker) => lower.includes(marker))) return true;
  if (/^[\W_]+$/.test(normalized)) return true;
  return false;
};

const headingLike = (normalized) => {
  if (!normalized) return true;
  if (normalized.includes("?")) return true;
  if (/^[A-Z0-9\s:()\-]{8,}$/.test(normalized)) return true;
  if (/:$/.test(normalized)) return true;
  return false;
};

export const isLowQualityOdsBullet = (input) => {
  const normalized = normalizeOdsText(input).replace(/^[-•*\u2022\u25CF\u25E6]\s*/, "");
  if (!normalized) return true;
  if (normalized.length < 18 || normalized.length > 220) return true;

  const lower = normalizedLower(normalized);
  if (headingLike(normalized)) return true;
  if (startsWithMetaPrefix(lower)) return true;
  if (META_MARKERS.some((marker) => lower.includes(marker))) return true;
  if (LINKY_PATTERNS.some((pattern) => pattern.test(normalized))) return true;
  if (LOW_SIGNAL_BULLET_PATTERNS.some((pattern) => pattern.test(normalized))) return true;
  return false;
};

const ensureSentencePunctuation = (text) => {
  const normalized = normalizeOdsText(text);
  if (!normalized) return "";
  if (/[.!?]$/.test(normalized)) return normalized;
  return `${normalized}.`;
};

export const sanitizeOdsOverview = (input, fallback) => {
  const candidate = ensureSentencePunctuation(input);
  if (!candidate || isLowQualityOdsOverview(candidate)) {
    const fb = ensureSentencePunctuation(fallback);
    return {
      text: fb,
      source: "curated",
      rejected: true,
    };
  }

  return {
    text: candidate,
    source: "ods",
    rejected: false,
  };
};

export const sanitizeOdsBullets = (inputList, maxCount = 3) => {
  const list = Array.isArray(inputList) ? inputList : [];
  const out = [];
  const seen = new Set();

  for (const raw of list) {
    const candidate = normalizeOdsText(raw).replace(/^[-•*\u2022\u25CF\u25E6]\s*/, "");
    if (!candidate) continue;
    if (isLowQualityOdsBullet(candidate)) continue;
    const normalizedKey = candidate.toLowerCase();
    if (seen.has(normalizedKey)) continue;
    seen.add(normalizedKey);
    out.push(ensureSentencePunctuation(candidate));
    if (out.length >= maxCount) break;
  }

  return out;
};
