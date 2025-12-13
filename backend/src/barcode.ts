export type BarcodeFormat = "gtin8" | "upca" | "ean13" | "gtin14" | "unknown";

export type NormalizedBarcode = {
  raw: string;
  code: string;
  format: BarcodeFormat;
  isValidChecksum: boolean | null;
  variants: string[];
};

const GTIN_LENGTHS = new Set([8, 12, 13, 14]);

const detectFormat = (code: string): BarcodeFormat => {
  switch (code.length) {
    case 8:
      return "gtin8";
    case 12:
      return "upca";
    case 13:
      return "ean13";
    case 14:
      return "gtin14";
    default:
      return "unknown";
  }
};

const computeGtinCheckDigit = (body: string): number | null => {
  if (!/^\d+$/.test(body)) {
    return null;
  }

  let sum = 0;
  let position = 1;
  for (let i = body.length - 1; i >= 0; i -= 1) {
    const digit = Number(body[i]);
    const weight = position % 2 === 1 ? 3 : 1;
    sum += digit * weight;
    position += 1;
  }

  return (10 - (sum % 10)) % 10;
};

export const isValidGtin = (code: string): boolean => {
  if (!/^\d+$/.test(code) || !GTIN_LENGTHS.has(code.length)) {
    return false;
  }
  const body = code.slice(0, -1);
  const check = Number(code.slice(-1));
  const computed = computeGtinCheckDigit(body);
  return computed !== null && computed === check;
};

const correctCheckDigitIfPossible = (code: string): string | null => {
  if (!/^\d+$/.test(code) || !GTIN_LENGTHS.has(code.length)) {
    return null;
  }
  const body = code.slice(0, -1);
  const computed = computeGtinCheckDigit(body);
  if (computed === null) {
    return null;
  }
  return `${body}${computed}`;
};

export const extractBarcodeCandidate = (raw: string): string | null => {
  const trimmed = raw.trim();
  if (!trimmed) {
    return null;
  }

  // Prefer clean GTIN-like digit sequences (handles QR payloads with URLs).
  const sequences = trimmed.match(/\d{8,14}/g);
  if (sequences && sequences.length > 0) {
    // Pick the longest sequence; if tie, take the first.
    const sorted = [...sequences].sort((a, b) => b.length - a.length);
    return sorted[0] ?? null;
  }

  // Fallback: strip all non-digits and validate length.
  const digitsOnly = trimmed.replace(/\D/g, "");
  if (digitsOnly.length >= 8 && digitsOnly.length <= 14) {
    return digitsOnly;
  }

  return null;
};

export const buildBarcodeVariants = (code: string): string[] => {
  const variants: string[] = [];
  const seen = new Set<string>();
  const add = (value: string | null | undefined) => {
    if (!value) return;
    if (seen.has(value)) return;
    seen.add(value);
    variants.push(value);
  };

  add(code);

  // If checksum looks wrong, also try the corrected check digit (common scan error).
  const corrected = correctCheckDigitIfPossible(code);
  if (corrected && corrected !== code) {
    add(corrected);
  }

  // UPC-A <-> EAN-13 (leading 0)
  if (code.length === 12) {
    add(`0${code}`);
  }
  if (code.length === 13 && code.startsWith("0")) {
    add(code.slice(1));
  }

  // Trim leading zeros (common GTIN-14 representation)
  const trimmed = code.replace(/^0+/, "");
  if (trimmed && trimmed !== code && trimmed.length >= 8 && trimmed.length <= 14) {
    add(trimmed);
  }

  // GTIN-14 (pad with leading zeros)
  if (code.length < 14) {
    add(code.padStart(14, "0"));
  }
  if (trimmed && trimmed.length >= 8 && trimmed.length < 14) {
    add(trimmed.padStart(14, "0"));
  }

  return variants;
};

export const normalizeBarcodeInput = (raw: string): NormalizedBarcode | null => {
  const candidate = extractBarcodeCandidate(raw);
  if (!candidate) {
    return null;
  }

  const format = detectFormat(candidate);
  const isValidChecksum = GTIN_LENGTHS.has(candidate.length) ? isValidGtin(candidate) : null;
  const variants = buildBarcodeVariants(candidate);

  return {
    raw,
    code: candidate,
    format,
    isValidChecksum,
    variants,
  };
};

export const buildBarcodeSearchQueries = (barcode: NormalizedBarcode): string[] => {
  const queries: string[] = [];
  const seen = new Set<string>();

  const add = (q: string) => {
    const query = q.trim().replace(/\s+/g, " ");
    if (!query || seen.has(query)) return;
    seen.add(query);
    queries.push(query);
  };

  const labelFor = (code: string) => {
    switch (code.length) {
      case 12:
        return "UPC";
      case 13:
        return "EAN";
      case 14:
        return "GTIN";
      case 8:
        return "EAN-8";
      default:
        return "UPC";
    }
  };

  const primary = barcode.variants[0] ?? barcode.code;
  add(`${labelFor(primary)} ${primary} supplement`);
  add(`"${primary}" supplement`);
  add(`"${primary}" "supplement facts"`);
  add(`"${primary}" ingredients OR "other ingredients" OR "nutrition facts"`);

  // Try 1–2 additional variants (leading zeros / checksum correction)
  for (const alt of barcode.variants.slice(1, 3)) {
    add(`${labelFor(alt)} ${alt} supplement`);
    add(`"${alt}" "supplement facts"`);
  }

  // Multilingual fallback (helps when results are mostly CN listings)
  add(`"${primary}" 成分 OR 配料 OR 营养成分 OR 用法 OR 建议用量`);

  return queries.slice(0, 8);
};

