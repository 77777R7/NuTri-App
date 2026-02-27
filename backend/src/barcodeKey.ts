import { buildBarcodeVariants, normalizeBarcodeInput } from "./barcode.js";

export type BarcodeKeyNormalized = {
  rawInput: string;
  rawNormalized: string;
  gtin14: string | null;
  isValidChecksum: boolean | null;
  variants: string[];
  checksumFixed: boolean;
};

const normalizeDigits = (value: string | null | undefined): string =>
  String(value ?? "").replace(/\D/g, "").trim();

const dedupe = (values: Array<string | null | undefined>): string[] => {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const value of values) {
    if (!value) continue;
    const digits = normalizeDigits(value);
    if (!digits || seen.has(digits)) continue;
    seen.add(digits);
    out.push(digits);
  }
  return out;
};

export const normalizeBarcodeKey = (raw: string): BarcodeKeyNormalized => {
  const rawInput = String(raw ?? "");
  const normalized = normalizeBarcodeInput(rawInput);
  if (normalized) {
    const variants = dedupe([
      normalized.code,
      ...normalized.variants,
      normalized.code.length < 14 ? normalized.code.padStart(14, "0") : normalized.code,
    ]);
    const gtin14 =
      variants.find((variant) => variant.length === 14) ??
      (normalized.code.length <= 14 ? normalized.code.padStart(14, "0") : null);
    const checksumFixed =
      normalized.isValidChecksum === false &&
      variants.some(
        (variant) => variant.length === normalized.code.length && variant !== normalized.code,
      );

    return {
      rawInput,
      rawNormalized: normalized.code,
      gtin14: gtin14 && /^\d{14}$/.test(gtin14) ? gtin14 : null,
      isValidChecksum: normalized.isValidChecksum,
      variants,
      checksumFixed,
    };
  }

  const digits = normalizeDigits(rawInput);
  const variants = digits ? dedupe([digits, ...buildBarcodeVariants(digits)]) : [];
  const gtin14 =
    variants.find((variant) => variant.length === 14) ??
    (digits.length > 0 && digits.length <= 14 ? digits.padStart(14, "0") : null);

  return {
    rawInput,
    rawNormalized: digits,
    gtin14: gtin14 && /^\d{14}$/.test(gtin14) ? gtin14 : null,
    isValidChecksum: null,
    variants,
    checksumFixed: false,
  };
};

export const buildBarcodeVariantKeys = (params: {
  gtin14: string;
  raw?: string | null;
}): string[] => {
  const keys = new Set<string>();
  const add = (value: string | null | undefined) => {
    const normalized = normalizeBarcodeKey(String(value ?? ""));
    for (const variant of normalized.variants) {
      keys.add(variant);
    }
    if (normalized.gtin14) {
      keys.add(normalized.gtin14);
    }
    if (normalized.rawNormalized) {
      keys.add(normalized.rawNormalized);
    }
  };
  add(params.gtin14);
  add(params.raw);
  return Array.from(keys);
};
