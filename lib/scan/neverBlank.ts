const STRICT_PLACEHOLDER_VALUES = new Set([
  'not provided',
  'not provided by source',
  'details not provided by source',
  'not provided by lnhpd for this npn',
  'not provided by dsld for this label',
  'n/a',
  'na',
  'none',
  'unknown',
  'unavailable',
  'not available',
  'null',
  'undefined',
  'no safety details available',
  'no ingredient details available',
  'no usage details available',
  'no overview details available',
  'no safety data available',
  'no ingredient data available',
  'no usage data available',
  'no overview data available',
]);

const PLACEHOLDER_PUNCTUATION_PATTERN = /^[.\-–—•\s]+$/;

const normalizePlaceholderValue = (value: string): string =>
  value
    .toLowerCase()
    .trim()
    .replace(/[.!?]+$/g, '')
    .replace(/\s+/g, ' ');

const toSentence = (value: string): string => {
  const trimmed = value.trim();
  if (!trimmed) return '';
  return /[.!?]$/.test(trimmed) ? trimmed : `${trimmed}.`;
};

const isPlaceholderOnly = (value: string): boolean => {
  const trimmed = value.trim();
  if (!trimmed) return true;
  if (PLACEHOLDER_PUNCTUATION_PATTERN.test(trimmed)) return true;
  const normalized = normalizePlaceholderValue(trimmed);
  return STRICT_PLACEHOLDER_VALUES.has(normalized);
};

/** Public check for use in cover/preview sanitization. */
export const isPlaceholderText = isPlaceholderOnly;

/**
 * P0-3: Sanitize a single cover-line string.
 * Returns the original text if it passes the placeholder check,
 * or the provided replacement otherwise.
 */
export const sanitizeCoverLine = (
  text: string | null | undefined,
  replacement: string,
): string => {
  if (!text || typeof text !== 'string') return replacement;
  const trimmed = text.trim();
  if (!trimmed || isPlaceholderOnly(trimmed)) return replacement;
  return trimmed;
};

/**
 * P0-3: Sanitize an array of cover bullet texts.
 * Strips placeholder entries and replaces with fallback text.
 * Returns at most `maxLines` results.
 */
export const sanitizeCoverBullets = (
  bullets: Array<{ text: string; basisTags?: string[] } | null | undefined>,
  fallbackBullets: string[],
  maxLines = 2,
): Array<{ text: string; isPlaceholder?: boolean }> => {
  const output: Array<{ text: string; isPlaceholder?: boolean }> = [];
  const seen = new Set<string>();

  for (const bullet of bullets) {
    if (output.length >= maxLines) break;
    if (!bullet?.text) continue;
    const trimmed = bullet.text.trim();
    if (!trimmed || seen.has(trimmed.toLowerCase())) continue;
    seen.add(trimmed.toLowerCase());
    if (isPlaceholderOnly(trimmed)) continue;
    output.push({ text: trimmed });
  }

  for (const fb of fallbackBullets) {
    if (output.length >= maxLines) break;
    const trimmed = fb.trim();
    if (!trimmed || seen.has(trimmed.toLowerCase())) continue;
    seen.add(trimmed.toLowerCase());
    output.push({ text: trimmed, isPlaceholder: true });
  }

  return output;
};

export const enforceNeverBlank = (params: {
  lines: Array<string | null | undefined>;
  fallback: string[];
  minSentences?: number;
  maxSentences?: number;
}): string[] => {
  const minSentences = params.minSentences ?? 2;
  const maxSentences = params.maxSentences ?? 5;

  const normalized = params.lines
    .map((line) => (typeof line === 'string' ? toSentence(line) : ''))
    .filter((line) => line && !isPlaceholderOnly(line));

  const output: string[] = [];
  for (const line of normalized) {
    if (output.length >= maxSentences) break;
    if (output.length > 0 && output[output.length - 1] === line) continue;
    output.push(line);
  }

  const fallback = params.fallback.map((line) => toSentence(line)).filter(Boolean);

  while (output.length < minSentences && fallback.length > 0) {
    const next = fallback.shift()!;
    if (output[output.length - 1] === next) continue;
    output.push(next);
  }

  if (output.length === 0) {
    output.push('This section uses only the currently verified record.');
    output.push('Add label-grade evidence to improve product-specific detail.');
  }

  const last = output[output.length - 1] ?? '';
  if (isPlaceholderOnly(last)) {
    const replacement = fallback.find((line) => !isPlaceholderOnly(line));
    output[output.length - 1] = replacement ?? 'Use the product label and consult a clinician for personalized decisions.';
  }

  return output.slice(0, maxSentences);
};
