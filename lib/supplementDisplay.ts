const DEFAULT_UNKNOWN_BRAND = 'Unknown brand';

const BRAND_MAX_CHARS = 22;

// Words that commonly appear in corporate/legal brand strings and are not helpful for UI display.
// We strip these only from the *end* first to preserve meaningful prefixes like "The Vitamin Shoppe".
const BRAND_TRAILING_NOISE = new Set([
  'brand',
  'brands',
  'innovation',
  'innovations',
  'holdings',
  'group',
  'international',
  'company',
  'corporation',
  'corp',
  'co',
]);

// Additional tokens we treat as noise when we need to pick a shorter consumer-facing brand.
const BRAND_TOKEN_NOISE = new Set([
  ...BRAND_TRAILING_NOISE,
  'inc',
  'ltd',
  'llc',
  'gmbh',
  'plc',
  'sa',
  'srl',
  // Common country/region tokens that often make corporate names too long.
  'usa',
  'us',
  'canada',
  'uk',
]);

const LEGAL_SUFFIXES = [
  'inc',
  'inc.',
  'ltd',
  'ltd.',
  'llc',
  'corp',
  'corp.',
  'co',
  'co.',
  'company',
  'limited',
  'international',
  'holdings',
  'group',
  'gmbh',
  's.a.',
  'srl',
  'plc',
];

const INSTRUCTION_WORDS = [
  'take',
  'with food',
  'empty stomach',
  'morning',
  'bedtime',
  'daily',
  'times',
  'adults',
  'children',
  'before',
  'after',
];

function collapseSpaces(value: string) {
  return value.replace(/\s+/g, ' ').trim();
}

function normalizeBrandToken(value: string) {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '')
    .trim();
}

function stripTrailingLegalSuffixes(value: string) {
  let out = value.trim();
  // Repeatedly strip trailing legal entities, ignoring punctuation.
  for (let i = 0; i < 10; i++) {
    const next = out
      .replace(
        new RegExp(
          String.raw`(?:\s*[,\-]?\s*)(?:${LEGAL_SUFFIXES.map((s) => s.replace(/\./g, '\\.')).join('|')})\s*\.?$`,
          'i',
        ),
        '',
      )
      .trim();
    if (next === out) break;
    out = next;
  }
  return out;
}

export function formatBrandForPill(raw: string): string {
  const original = collapseSpaces(raw ?? '');
  if (!original) return DEFAULT_UNKNOWN_BRAND;
  if (original.toLowerCase() === DEFAULT_UNKNOWN_BRAND.toLowerCase()) return DEFAULT_UNKNOWN_BRAND;

  let candidate = original;

  // If we have "dba"/"doing business as", we *usually* want the tail segment (consumer-facing brand).
  // Exception: some datasets encode a huge corporate/group list after dba. In that case, prefer the
  // parent company (head) to avoid mislabeling the brand (e.g. "... Vital Proteins ...").
  const dbaRegex = /\b(?:dba|doing\s+business\s+as)\b/i;
  const dbaMatch = candidate.match(dbaRegex);
  if (dbaMatch) {
    // Take the substring after the last occurrence, but also capture the head (before first) for fallback.
    const parts = candidate.split(dbaRegex);
    const headRaw = collapseSpaces(parts[0] ?? '');
    const tailRaw = collapseSpaces(parts[parts.length - 1] ?? '');

    const tailForChecks = tailRaw.replace(/｜/g, '|');
    const tailTokenCount = tailForChecks.split(' ').filter(Boolean).length;
    const tailHasListSeparators = /[\/|;]/.test(tailForChecks);
    const tailCanadaCount = (tailForChecks.match(/\bcanada\b/gi) ?? []).length;
    const tailLooksLikeGroupList =
      tailTokenCount >= 8 || tailHasListSeparators || tailCanadaCount >= 2;

    if (tailLooksLikeGroupList && headRaw) {
      // Clean the head and return it directly (we intentionally preserve country tokens like "Canada").
      let head = collapseSpaces(headRaw.replace(/\([^)]*\)/g, ' '));
      head = stripTrailingLegalSuffixes(head);
      head = collapseSpaces(head);
      if (head) return head;
    }

    if (tailRaw) candidate = tailRaw;
  }

  // Remove bracketed legal noise like "(Canada)".
  candidate = collapseSpaces(candidate.replace(/\([^)]*\)/g, ' '));

  candidate = stripTrailingLegalSuffixes(candidate);
  candidate = collapseSpaces(candidate);

  if (!candidate) return original || DEFAULT_UNKNOWN_BRAND;

  // Tokenize and strip trailing corporate noise (e.g. "... Brands").
  const words = candidate.split(' ').filter(Boolean);
  if (words.length <= 1) return candidate || original || DEFAULT_UNKNOWN_BRAND;

  let strippedBrandToken = false;
  while (words.length > 1) {
    const last = words[words.length - 1] ?? '';
    const norm = normalizeBrandToken(last);
    if (!BRAND_TRAILING_NOISE.has(norm)) break;
    if (norm === 'brand' || norm === 'brands') strippedBrandToken = true;
    words.pop();
  }

  const display = collapseSpaces(words.join(' '));
  if (display && display.length <= BRAND_MAX_CHARS) return display;

  // If the display is still long, pick a short consumer-facing slice.
  let coreWords = words.filter((word) => !BRAND_TOKEN_NOISE.has(normalizeBrandToken(word)));
  if (coreWords.length === 0) coreWords = words;

  const candidates: string[] = [];
  if (strippedBrandToken && coreWords.length > 0) {
    // When we stripped a "... Brands" tail, the last remaining core token is usually the consumer brand.
    candidates.push(coreWords[coreWords.length - 1]!);
  }
  if (coreWords.length >= 2) candidates.push(coreWords.slice(-2).join(' '));
  if (coreWords.length > 0) candidates.push(coreWords[coreWords.length - 1]!);

  for (const next of candidates) {
    const cleaned = collapseSpaces(next);
    if (cleaned && cleaned.length <= BRAND_MAX_CHARS) return cleaned;
  }

  return display || candidate || original || DEFAULT_UNKNOWN_BRAND;
}

function normalizeSimpleUnit(unitRaw: string) {
  const unit = unitRaw.trim();
  const lower = unit.toLowerCase();

  if (lower === 'iu' || lower === 'ui') return 'IU';
  if (lower === 'ml') return 'mL';
  if (lower === 'oz') return 'oz';
  if (lower === 'mg') return 'mg';
  if (lower === 'g') return 'g';

  // Microgram variants.
  // \u00b5 = micro sign (µ), \u03bc = Greek mu (μ)
  if (lower === 'mcg' || lower === 'ug' || lower === '\u00b5g' || lower === '\u03bcg') {
    return 'mcg';
  }

  if (lower === 'cfu' || lower === 'ufc') return 'CFU';
  return unit;
}

function formatNumberForPill(value: number, maxDecimals: number) {
  if (!Number.isFinite(value)) return '';
  if (Number.isInteger(value)) return String(value);
  return value
    .toFixed(maxDecimals)
    .replace(/\.0+$/, '')
    .replace(/(\.\d*[1-9])0+$/, '$1');
}

function formatCompact(value: number) {
  const abs = Math.abs(value);

  let scaled = value;
  let suffix = '';
  if (abs >= 1e12) {
    scaled = value / 1e12;
    suffix = 'T';
  } else if (abs >= 1e9) {
    scaled = value / 1e9;
    suffix = 'B';
  } else if (abs >= 1e6) {
    scaled = value / 1e6;
    suffix = 'M';
  } else if (abs >= 1e3) {
    scaled = value / 1e3;
    suffix = 'K';
  }

  const numText = formatNumberForPill(scaled, 1);
  return `${numText}${suffix}`;
}

function parseCfuAmount(raw: string): number | null {
  const text = raw.replace(/,/g, '');

  // 1) "10B CFU" / "10 b cfu" / "10B ufc"
  {
    const m = text.match(/(\d+(?:\.\d+)?)\s*([kmbt])\s*(cfu|ufc)\b/i);
    if (m) {
      const value = Number.parseFloat(m[1]);
      const suffix = m[2].toLowerCase();
      const scale =
        suffix === 't'
          ? 1e12
          : suffix === 'b'
            ? 1e9
            : suffix === 'm'
              ? 1e6
              : 1e3; // k
      const amount = value * scale;
      if (Number.isFinite(amount)) return amount;
    }
  }

  // 2) "10 billion CFU" / "500 million CFU" / "1 trillion CFU"
  {
    const m = text.match(/(\d+(?:\.\d+)?)\s*(trillion|billion|million|thousand)\s*(cfu|ufc)\b/i);
    if (m) {
      const value = Number.parseFloat(m[1]);
      const word = m[2].toLowerCase();
      const scale =
        word === 'trillion'
          ? 1e12
          : word === 'billion'
            ? 1e9
            : word === 'million'
              ? 1e6
              : 1e3;
      const amount = value * scale;
      if (Number.isFinite(amount)) return amount;
    }
  }

  // 3) "3 x 10^9 CFU" / "3×10^9 cfu" / "3x10^9 ufc"
  {
    const m = text.match(/(\d+(?:\.\d+)?)\s*(?:x|\u00d7)\s*10\s*\^\s*(\d+)\s*(cfu|ufc)\b/i);
    if (m) {
      const coeff = Number.parseFloat(m[1]);
      const exp = Number.parseInt(m[2], 10);
      if (Number.isFinite(coeff) && Number.isFinite(exp)) {
        const amount = coeff * Math.pow(10, exp);
        if (Number.isFinite(amount)) return amount;
      }
    }
  }

  // 4) "10^10 CFU"
  {
    const m = text.match(/\b10\s*\^\s*(\d+)\s*(cfu|ufc)\b/i);
    if (m) {
      const exp = Number.parseInt(m[1], 10);
      if (Number.isFinite(exp)) {
        const amount = Math.pow(10, exp);
        if (Number.isFinite(amount)) return amount;
      }
    }
  }

  // 5) "10000000000 CFU" / "10000000000 ufc"
  {
    const m = text.match(/(\d+(?:\.\d+)?)\s*(cfu|ufc)\b/i);
    if (m) {
      const value = Number.parseFloat(m[1]);
      if (Number.isFinite(value)) return value;
    }
  }

  return null;
}

export function formatDoseForPill(raw?: string | null): string | null {
  const trimmed = collapseSpaces(raw ?? '');
  if (!trimmed) return null;

  // CFU first, because otherwise we may show long numbers like "10000000000 CFU".
  const cfuAmount = parseCfuAmount(trimmed);
  if (cfuAmount != null) {
    return `${formatCompact(cfuAmount)} CFU`;
  }

  // Strength units (mass/IU/volume).
  {
    // \u00b5 = micro sign (µ), \u03bc = Greek mu (μ)
    const m = trimmed.match(/(\d[\d,]*(?:\.\d+)?)\s*(mcg|ug|\u00b5g|\u03bcg|mg|g|iu|ui|ml|mL|oz)\b/i);
    if (m) {
      const value = Number.parseFloat(m[1].replace(/,/g, ''));
      const unit = normalizeSimpleUnit(m[2]);
      const valueText = formatNumberForPill(value, 2);
      if (valueText) return `${valueText} ${unit}`;
    }
  }

  // Count units.
  {
    const m = trimmed.match(/(\d+)\s*(tablet|capsule|softgel|gummy|scoop|drop|packet|serving)s?\b/i);
    if (m) {
      const count = Number.parseInt(m[1], 10);
      if (!Number.isFinite(count)) return null;
      return `${count} ${m[2].toLowerCase()}`;
    }
  }

  // If it looks like usage directions, don't show it as a dose.
  const lower = trimmed.toLowerCase();
  if (INSTRUCTION_WORDS.some((w) => lower.includes(w))) return null;

  // Allow ultra-short raw strings (e.g. "2 caps") but avoid long sentences.
  if (trimmed.length <= 12 && /\d/.test(trimmed)) return trimmed;

  return null;
}
