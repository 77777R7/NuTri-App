import { normalizeBarcodeInput } from "./barcode.js";

export type OffLane = "primary" | "shadow_usca";

export type OffProductRecord = {
  code?: string | null;
  product_name?: string | null;
  brands?: string | null;
  categories?: string | null;
  categories_tags?: string[] | null;
  countries?: string | null;
  countries_tags?: string[] | null;
  url?: string | null;
};

export type OffSeedCandidate = {
  barcode_gtin14: string;
  barcode_raw: string;
  brand: string | null;
  productName: string | null;
  sourceUrl: string | null;
  lane: OffLane;
  countriesTags: string[];
  categorySignals: string[];
};

export type OffSeedRejected = {
  barcode_raw: string | null;
  reason:
    | "invalid_barcode"
    | "duplicate_in_feed"
    | "existing_in_registry"
    | "non_supplement_signals"
    | "missing_supplement_signals";
  detail?: string;
};

const STRONG_SUPPLEMENT_SIGNALS = [
  "supplement",
  "vitamin",
  "mineral",
  "probiotic",
  "capsule",
  "capsules",
  "tablet",
  "tablets",
  "softgel",
  "softgels",
  "gummy",
  "collagen",
  "coq10",
  "melatonin",
  "creatine",
  "biotin",
  "folate",
  "magnesium",
  "zinc",
  "fish oil",
  "krill oil",
  "omega 3",
  "omega-3",
  "amino acid",
];

const SUPPLEMENT_FORM_SIGNALS = [
  "capsule",
  "capsules",
  "tablet",
  "tablets",
  "softgel",
  "softgels",
  "gummy",
  "gummies",
  "supplement",
];

const DOSING_UNIT_SIGNALS = [
  " mg",
  " mcg",
  " iu",
];

const WEAK_SUPPLEMENT_SIGNALS = [
  "tincture",
  "extract",
  "powder",
];

const NON_SUPPLEMENT_SIGNALS = [
  "shampoo",
  "conditioner",
  "soap",
  "cleanser",
  "lotion",
  "cream",
  "detergent",
  "beverage",
  "drink",
  "snack",
  "candy",
  "cereal",
  "soda",
  "chocolate",
  "dairies",
  "dairy",
  "milk",
  "milks",
  "yogurt",
  "yogurts",
  "cheese",
  "dessert",
  "desserts",
];

const normalizeText = (value: unknown): string =>
  typeof value === "string" ? value.toLowerCase().replace(/\s+/g, " ").trim() : "";

const normalizeTag = (value: string): string => value.toLowerCase().trim();

const hasAnySignal = (haystack: string, signals: string[]): boolean =>
  signals.some((signal) => haystack.includes(signal));

const collectCategorySignals = (record: OffProductRecord): string[] => {
  const textParts: string[] = [];
  if (record.product_name) textParts.push(record.product_name);
  if (record.brands) textParts.push(record.brands);
  if (record.categories) textParts.push(record.categories);
  if (Array.isArray(record.categories_tags)) textParts.push(record.categories_tags.join(" "));
  return textParts.map((value) => normalizeText(value)).filter(Boolean);
};

const classifySupplementSignals = (record: OffProductRecord): "supplement" | "non_supplement" | "uncertain" => {
  const haystack = collectCategorySignals(record).join(" ");
  if (!haystack) return "uncertain";
  const hasNonSupplement = hasAnySignal(haystack, NON_SUPPLEMENT_SIGNALS);
  if (hasNonSupplement) return "non_supplement";
  const hasStrongSupplement = hasAnySignal(haystack, STRONG_SUPPLEMENT_SIGNALS);
  const hasWeakSupplement = hasAnySignal(haystack, WEAK_SUPPLEMENT_SIGNALS);
  const hasUnitSignal = DOSING_UNIT_SIGNALS.some((signal) => haystack.includes(signal));
  const hasFormSignal = hasAnySignal(haystack, SUPPLEMENT_FORM_SIGNALS);
  const hasSupplement = hasStrongSupplement || (hasUnitSignal && hasFormSignal) || (hasWeakSupplement && hasFormSignal);
  return hasSupplement ? "supplement" : "uncertain";
};

const isUsCaCountryTag = (value: string): boolean =>
  /\b(united-states|canada)\b/.test(value) || /(^|:)us$/.test(value) || /(^|:)ca$/.test(value);

const resolveLane = (record: OffProductRecord): OffLane => {
  const tags = Array.isArray(record.countries_tags) ? record.countries_tags : [];
  const normalized = tags.map((tag) => normalizeTag(tag));
  const hasUsCa = normalized.some((tag) => isUsCaCountryTag(tag));
  return hasUsCa ? "shadow_usca" : "primary";
};

const normalizeBarcode = (value: string | null | undefined): { gtin14: string; raw: string } | null => {
  const raw = String(value ?? "").trim();
  if (!raw) return null;
  const normalized = normalizeBarcodeInput(raw);
  if (!normalized) return null;
  const gtin14 = normalized.variants.find((variant) => variant.length === 14) ?? normalized.code.padStart(14, "0");
  if (!/^\d{14}$/.test(gtin14)) return null;
  return { gtin14, raw: normalized.code };
};

export const buildOffSeedCandidates = (params: {
  records: OffProductRecord[];
  existingBarcodes?: Set<string>;
}): {
  primary: OffSeedCandidate[];
  shadowUsCa: OffSeedCandidate[];
  rejected: OffSeedRejected[];
} => {
  const existing = params.existingBarcodes ?? new Set<string>();
  const seenFeed = new Set<string>();
  const primary: OffSeedCandidate[] = [];
  const shadowUsCa: OffSeedCandidate[] = [];
  const rejected: OffSeedRejected[] = [];

  for (const record of params.records) {
    const normalizedBarcode = normalizeBarcode(record.code);
    if (!normalizedBarcode) {
      rejected.push({ barcode_raw: record.code ?? null, reason: "invalid_barcode" });
      continue;
    }
    const barcode = normalizedBarcode.gtin14;
    if (seenFeed.has(barcode)) {
      rejected.push({ barcode_raw: normalizedBarcode.raw, reason: "duplicate_in_feed" });
      continue;
    }
    seenFeed.add(barcode);

    if (existing.has(barcode)) {
      rejected.push({ barcode_raw: normalizedBarcode.raw, reason: "existing_in_registry" });
      continue;
    }

    const classification = classifySupplementSignals(record);
    if (classification === "non_supplement") {
      rejected.push({ barcode_raw: normalizedBarcode.raw, reason: "non_supplement_signals" });
      continue;
    }
    if (classification !== "supplement") {
      rejected.push({ barcode_raw: normalizedBarcode.raw, reason: "missing_supplement_signals" });
      continue;
    }

    const candidate: OffSeedCandidate = {
      barcode_gtin14: barcode,
      barcode_raw: normalizedBarcode.raw,
      brand: typeof record.brands === "string" && record.brands.trim() ? record.brands.trim() : null,
      productName:
        typeof record.product_name === "string" && record.product_name.trim() ? record.product_name.trim() : null,
      sourceUrl:
        typeof record.url === "string" && record.url.trim()
          ? record.url.trim()
          : `https://world.openfoodfacts.org/product/${normalizedBarcode.raw}`,
      lane: resolveLane(record),
      countriesTags: Array.isArray(record.countries_tags) ? record.countries_tags.map((tag) => String(tag)) : [],
      categorySignals: collectCategorySignals(record),
    };

    if (candidate.lane === "primary") primary.push(candidate);
    else shadowUsCa.push(candidate);
  }

  return { primary, shadowUsCa, rejected };
};
