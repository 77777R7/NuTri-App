import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

import { normalizeBarcodeInput } from "../src/barcode.js";
import { normalizeBarcodeKey } from "../src/barcodeKey.js";
import { upsertRegulatoryMapWithPolicy } from "../src/barcodeResolutionDbCache.js";
import { supabase } from "../src/supabase.js";

type LnhpdRow = {
  lnhpd_id: number;
  npn: string | null;
  brand_name: string | null;
  product_name: string | null;
  facts_json: Record<string, unknown> | null;
};

type BrandRule = {
  key: string;
  brandIlike: string;
  siteBase: string;
  includeBrand: RegExp;
  excludeBrand?: RegExp;
};

type CandidateRow = {
  npn: string;
  lnhpdId: number;
  brandName: string;
  productName: string;
  productLicenceAliases: string[];
  factsJson: Record<string, unknown> | null;
  brandRule: BrandRule;
  dosageFormClass: DosageFormClass | null;
  familyBucket: FamilyBucket | null;
  knownHandles?: string[];
};

type ShopifySuggestProduct = {
  title?: string;
  url?: string;
  handle?: string;
  product_type?: string;
};

type ShopifyVariant = {
  id?: number;
  title?: string;
  public_title?: string;
  option1?: string;
  option2?: string;
  option3?: string;
  sku?: string;
  barcode?: string;
};

type ShopifyProductJs = {
  title?: string;
  handle?: string;
  product_type?: string;
  tags?: string | string[];
  body_html?: string;
  body?: string;
  variants?: ShopifyVariant[];
};

type BarcodeCandidate = {
  barcodeRaw: string;
  barcodeGtin14: string;
  barcodeNormalizedInput: string;
  normalization: "as_is" | "upc11_leading0";
  variantTitle: string;
  variantSignalText: string;
};

type SpecGapAllowlistRule = {
  status: "HOLD_UNTIL_UNIQUE_SPEC_ANCHOR";
};

type DosageFormClass =
  | "gummy"
  | "capsule"
  | "caplet"
  | "tablet"
  | "softgel"
  | "powder"
  | "liquid"
  | "lozenge"
  | "spray"
  | "drop"
  | "chewable";

type FamilyBucket = "bee_propolis" | "ginseng" | "primadophilus";

type ResultStatus =
  | "inserted_medium_confidence"
  | "inserted_high_confidence"
  | "hold_ambiguous"
  | "skip_conflict"
  | "skip_duplicate"
  | "no_qualifying_evidence"
  | "no_shopify_domain"
  | "no_shopify_match"
  | "dosage_form_mismatch";

type BatchResult = {
  npn: string;
  brand: string;
  product: string;
  status: ResultStatus;
  reason: string;
  confidence?: number;
  barcodeRaw?: string;
  barcodeGtin14?: string;
  candidateBarcodes?: string[];
  evidence?: string[];
  matchMode?: string;
  allowlistApplied?: boolean;
  dosageForm?: {
    lnhpd: DosageFormClass | null;
    shopify: DosageFormClass | null;
  };
};

type BarcodeCandidateMetaEntry = {
  barcode: string;
  source?: string | null;
  evidence?: string | null;
  matchMode?: string | null;
  confidence?: number | null;
  lastSeenAt?: string | null;
};

const args = process.argv.slice(2);
const hasFlag = (flag: string) => args.includes(`--${flag}`);
const getArg = (flag: string) => {
  const idx = args.indexOf(`--${flag}`);
  if (idx === -1) return null;
  return args[idx + 1] ?? null;
};
const asInt = (value: string | null, fallback: number) => {
  if (!value) return fallback;
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) ? parsed : fallback;
};
const asFloat = (value: string | null, fallback: number) => {
  if (!value) return fallback;
  const parsed = Number.parseFloat(value);
  return Number.isFinite(parsed) ? parsed : fallback;
};

const batchSize = Math.max(1, asInt(getArg("batch-size"), 20));
const familyBucketSize = Math.max(1, asInt(getArg("family-bucket-size"), 30));
const minSimilarity = Math.min(0.95, Math.max(0.3, asFloat(getArg("min-similarity"), 0.56)));
const tieDelta = Math.min(0.2, Math.max(0.0, asFloat(getArg("tie-delta"), 0.03)));
const maxCandidatesPerNpn = Math.max(1, asInt(getArg("max-candidates-per-npn"), 3));
const dryRun = hasFlag("dry-run");
const familyInputJsonArg = getArg("family-input-json");
const specGapWhitelistJsonArg = getArg("spec-gap-whitelist-json");
const skipNpnsArg = getArg("skip-npns");
const familyBuckets = (getArg("family-buckets") ?? "")
  .toLowerCase()
  .split(",")
  .map((value) => value.trim())
  .filter(Boolean)
  .filter((value): value is FamilyBucket =>
    value === "bee_propolis" || value === "ginseng" || value === "primadophilus",
  );

const repoRoot = path.resolve(process.cwd(), "..");
const outputDir = path.resolve(repoRoot, "output");
const now = new Date();
const ts = now.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}Z$/, "Z");

const outJson =
  getArg("out-json") ??
  path.resolve(
    outputDir,
    `npn_barcode_manual_review_${familyInputJsonArg ? "family_batch" : "batch20"}_${ts}.json`,
  );

const familyBucketJson =
  getArg("family-bucket-json") ??
  path.resolve(outputDir, `npn_barcode_family_bucket_${ts}.json`);

const SOURCE_TAG = "web_manual_search_v1";

const BRAND_RULES: BrandRule[] = [
  {
    key: "Jamieson",
    brandIlike: "%jamieson%",
    siteBase: "https://www.jamiesonvitamins.com",
    includeBrand: /jamieson/i,
  },
  {
    key: "NaturesWay",
    brandIlike: "%nature%way%",
    siteBase: "https://www.natureswaycanada.ca",
    includeBrand: /nature'?s\s*way/i,
  },
  {
    key: "BirdAndBe",
    brandIlike: "%bird%be%",
    siteBase: "https://birdandbe.com",
    includeBrand: /the\s+bird\s+and\s+be|bird\s*&\s*be/i,
    excludeBrand: /winery|distillery/i,
  },
  {
    key: "Organika",
    brandIlike: "%organika%",
    siteBase: "https://organika.com",
    includeBrand: /organika/i,
  },
  {
    key: "NaturalFactors",
    brandIlike: "%natural factors%",
    siteBase: "https://naturalfactors.com",
    includeBrand: /natural\s*factors/i,
  },
  {
    key: "WebberNaturals",
    brandIlike: "%WN Pharmaceuticals%",
    siteBase: "https://webbernaturals.com",
    includeBrand: /webber|wn\s*pharmaceuticals/i,
  },
  {
    key: "GenuineHealth",
    brandIlike: "%genuine health%",
    siteBase: "https://genuinehealth.ca",
    includeBrand: /genuine\s*health/i,
  },
  {
    key: "Herbaland",
    brandIlike: "%herbaland%",
    siteBase: "https://herbaland.ca",
    includeBrand: /herbaland/i,
  },
  {
    key: "Progressive",
    brandIlike: "%progressive industrial fluids%",
    siteBase: "https://progressivenutritional.com",
    includeBrand: /progressive/i,
  },
  {
    key: "NaturesBounty",
    brandIlike: "%nature's bounty%",
    siteBase: "https://naturesbounty.com",
    includeBrand: /nature'?s\s*bounty/i,
  },
];

// Minimal recall expansion: include Organika in main batch pool while keeping all safety gates unchanged.
const MAIN_BATCH_BRAND_WHITELIST = new Set([
  "Jamieson",
  "NaturesWay",
  "BirdAndBe",
  "Organika",
  "NaturalFactors",
  "WebberNaturals",
  "GenuineHealth",
  "Herbaland",
  "Progressive",
  "NaturesBounty",
]);

const SUPPLEMENT_BLOCKLIST = /hand sanitizer|ethyl alcohol|isopropyl alcohol|distillery|winery|antiseptique/i;

const familyMatchers: Array<{ bucket: FamilyBucket; re: RegExp }> = [
  { bucket: "bee_propolis", re: /bee\s*propolis/i },
  { bucket: "ginseng", re: /ginseng/i },
  { bucket: "primadophilus", re: /primadophilus/i },
];

const FAMILY_HANDLE_HINTS: Record<string, Partial<Record<FamilyBucket, string[]>>> = {
  Organika: {
    bee_propolis: ["himalayan-bee-propolis", "bee-propolis-liquid"],
    ginseng: ["siberian-tiger-ginseng", "korean-red-ginseng"],
  },
  NaturesWay: {
    primadophilus: ["primadophilus-kids-chewable-tablets", "primadophilus-kids"],
  },
};

const sanitize = (value: unknown): string => String(value ?? "").replace(/\s+/g, " ").trim();

const normalizeNpn = (value: unknown): string | null => {
  const digits = String(value ?? "").replace(/\D/g, "").trim();
  if (!digits) return null;
  if (digits.length < 6 || digits.length > 10) return null;
  return digits;
};

const skipNpns = new Set(
  (skipNpnsArg ?? "")
    .split(",")
    .map((value) => normalizeNpn(value))
    .filter((value): value is string => Boolean(value)),
);

const normalizeBarcodeToGtin14 = (value: unknown): string | null => {
  const raw = sanitize(value);
  if (!raw) return null;
  const digits = raw.replace(/\D/g, "");
  if (!digits) return null;
  const inputs = digits.length === 11 ? [`0${digits}`, digits] : [digits];
  for (const input of inputs) {
    const normalized = normalizeBarcodeKey(input);
    if (normalized.isValidChecksum !== true) continue;
    if (normalized.gtin14) return normalized.gtin14;
  }
  return null;
};

const normalizeMetaText = (value: unknown): string | null => {
  const text = sanitize(value);
  return text ? text : null;
};

const normalizeMetaConfidence = (value: unknown): number | null => {
  const n = Number(value);
  if (!Number.isFinite(n)) return null;
  if (n < 0) return 0;
  if (n > 1) return 1;
  return Number(n.toFixed(4));
};

const hasMeaningfulMeta = (entry: BarcodeCandidateMetaEntry): boolean =>
  Boolean(entry.source || entry.evidence || entry.matchMode || entry.confidence != null || entry.lastSeenAt);

const mergeFactsBarcodeCandidates = (params: {
  facts: Record<string, unknown>;
  incomingBarcodes: string[];
  incomingMeta?: BarcodeCandidateMetaEntry[];
  maxCount: number;
  preferIncoming: boolean;
}) => {
  const { facts, incomingBarcodes, incomingMeta = [], maxCount, preferIncoming } = params;
  const metaByBarcode = new Map<string, BarcodeCandidateMetaEntry>();
  const existingOrder: string[] = [];
  const seenExisting = new Set<string>();

  const upsertMeta = (barcode: string, patch: Partial<BarcodeCandidateMetaEntry>) => {
    const current = metaByBarcode.get(barcode) ?? { barcode };
    const merged: BarcodeCandidateMetaEntry = {
      barcode,
      source: patch.source ?? current.source ?? null,
      evidence: patch.evidence ?? current.evidence ?? null,
      matchMode: patch.matchMode ?? current.matchMode ?? null,
      confidence: patch.confidence ?? current.confidence ?? null,
      lastSeenAt: patch.lastSeenAt ?? current.lastSeenAt ?? null,
    };
    metaByBarcode.set(barcode, merged);
  };

  const existingCandidates = Array.isArray((facts as Record<string, unknown>).barcodeCandidates)
    ? ((facts as Record<string, unknown>).barcodeCandidates as unknown[])
    : [];
  for (const entry of existingCandidates) {
    let barcode: string | null = null;
    if (entry && typeof entry === "object" && !Array.isArray(entry)) {
      const obj = entry as Record<string, unknown>;
      barcode = normalizeBarcodeToGtin14(obj.barcode ?? obj.barcode_gtin14 ?? obj.gtin14 ?? obj.value);
      if (barcode) {
        upsertMeta(barcode, {
          source: normalizeMetaText(obj.source),
          evidence: normalizeMetaText(obj.evidence),
          matchMode: normalizeMetaText(obj.matchMode),
          confidence: normalizeMetaConfidence(obj.confidence),
          lastSeenAt: normalizeMetaText(obj.lastSeenAt ?? obj.last_seen_at),
        });
      }
    } else {
      barcode = normalizeBarcodeToGtin14(entry);
    }
    if (!barcode || seenExisting.has(barcode)) continue;
    seenExisting.add(barcode);
    existingOrder.push(barcode);
  }

  const existingMetaRaw = Array.isArray((facts as Record<string, unknown>).barcodeCandidatesMeta)
    ? ((facts as Record<string, unknown>).barcodeCandidatesMeta as unknown[])
    : [];
  for (const entry of existingMetaRaw) {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) continue;
    const obj = entry as Record<string, unknown>;
    const barcode = normalizeBarcodeToGtin14(obj.barcode ?? obj.barcode_gtin14 ?? obj.gtin14 ?? obj.value);
    if (!barcode) continue;
    upsertMeta(barcode, {
      source: normalizeMetaText(obj.source),
      evidence: normalizeMetaText(obj.evidence),
      matchMode: normalizeMetaText(obj.matchMode),
      confidence: normalizeMetaConfidence(obj.confidence),
      lastSeenAt: normalizeMetaText(obj.lastSeenAt ?? obj.last_seen_at),
    });
  }

  for (const entry of incomingMeta) {
    const barcode = normalizeBarcodeToGtin14(entry.barcode);
    if (!barcode) continue;
    upsertMeta(barcode, {
      source: normalizeMetaText(entry.source),
      evidence: normalizeMetaText(entry.evidence),
      matchMode: normalizeMetaText(entry.matchMode),
      confidence: normalizeMetaConfidence(entry.confidence),
      lastSeenAt: normalizeMetaText(entry.lastSeenAt),
    });
  }

  const incomingOrder = Array.from(
    new Set(incomingBarcodes.map((value) => normalizeBarcodeToGtin14(value)).filter((value): value is string => Boolean(value))),
  );
  const mergedOrder = preferIncoming ? [...incomingOrder, ...existingOrder] : [...existingOrder, ...incomingOrder];
  const finalOrder: string[] = [];
  const seenFinal = new Set<string>();
  for (const barcode of mergedOrder) {
    if (seenFinal.has(barcode)) continue;
    seenFinal.add(barcode);
    finalOrder.push(barcode);
    if (finalOrder.length >= maxCount) break;
  }

  const finalMeta = finalOrder
    .map((barcode) => metaByBarcode.get(barcode))
    .filter((entry): entry is BarcodeCandidateMetaEntry => Boolean(entry))
    .filter((entry) => hasMeaningfulMeta(entry))
    .map((entry) => ({
      barcode: entry.barcode,
      ...(entry.source ? { source: entry.source } : {}),
      ...(entry.evidence ? { evidence: entry.evidence } : {}),
      ...(entry.matchMode ? { matchMode: entry.matchMode } : {}),
      ...(entry.confidence != null ? { confidence: entry.confidence } : {}),
      ...(entry.lastSeenAt ? { lastSeenAt: entry.lastSeenAt } : {}),
    }));

  return { barcodes: finalOrder, meta: finalMeta };
};

const normalizeLooseText = (value: string): string =>
  sanitize(value)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();

const tokenize = (value: string): string[] =>
  normalizeLooseText(value)
    .split(" ")
    .filter(Boolean);

const singularizeToken = (token: string): string => {
  if (token.length <= 3) return token;
  if (token.endsWith("ies") && token.length > 4) return `${token.slice(0, -3)}y`;
  if (token.endsWith("s") && !token.endsWith("ss")) return token.slice(0, -1);
  return token;
};

const SEARCH_STOP_WORDS = new Set([
  "with",
  "and",
  "plus",
  "extra",
  "strength",
  "maximum",
  "max",
  "timed",
  "release",
  "formula",
  "regular",
  "the",
  "for",
  "of",
]);

const SIMILARITY_STOP_WORDS = new Set([
  "with",
  "and",
  "for",
  "plus",
  "extra",
  "strength",
  "natural",
  "adult",
  "adults",
  "kid",
  "kids",
  "gummy",
  "gummies",
  "capsule",
  "capsules",
  "caplet",
  "caplets",
  "tablet",
  "tablets",
  "drop",
  "drops",
  "powder",
  "liquid",
  "lozenge",
  "lozenges",
  "softgel",
  "softgels",
  "chewable",
  "chewables",
  "iu",
  "mg",
  "mcg",
  "ml",
  "g",
]);

const WEAK_SEMANTIC_TOKENS = new Set([
  "vitamin",
  "multi",
  "multivitamin",
  "immune",
  "cold",
  "flu",
  "care",
  "support",
  "health",
  "daily",
]);

const ALIAS_TRIM_STOP_WORDS = new Set([
  "with",
  "for",
  "the",
  "and",
  "plus",
  "extra",
  "strength",
  "natural",
]);

const normalizeAliasText = (value: string): string => {
  const normalized = normalizeLooseText(value)
    .replace(/\bmens?\b/g, "adult")
    .replace(/\bwomens?\b/g, "adult")
    .replace(/\bwoman\b/g, "adult")
    .replace(/\bman\b/g, "adult")
    .replace(/\badults?\b/g, "adult")
    .replace(/\bmultivitamins?\b/g, "multi")
    .replace(/\bgummies?\b/g, "gummy")
    .replace(/\bchildrens?\b/g, "kids")
    .replace(/\bchildren\b/g, "kids")
    .replace(/\bkiddo(s)?\b/g, "kids")
    .replace(/\bchewables?\b/g, "chewable")
    .replace(/\s+/g, " ")
    .trim();
  const tokens = normalized
    .split(" ")
    .filter(Boolean)
    .filter((token) => !ALIAS_TRIM_STOP_WORDS.has(token));
  return tokens.join(" ").trim();
};

const semanticTokens = (value: string): string[] =>
  tokenize(value)
    .map((token) => singularizeToken(token))
    .filter((token) => token.length >= 2)
    .filter((token) => !SIMILARITY_STOP_WORDS.has(token))
    .filter((token) => !/^\d+$/.test(token));

const strongSemanticTokens = (value: string): string[] =>
  semanticTokens(value).filter((token) => token.length >= 5 && !WEAK_SEMANTIC_TOKENS.has(token));

const extractProductLicenceAliases = (factsJson: Record<string, unknown> | null | undefined): string[] => {
  const entries = Array.isArray((factsJson as any)?.productLicences) ? (factsJson as any).productLicences : [];
  const ranked = entries
    .map((entry) => ({
      name: sanitize((entry as any)?.product_name),
      primary: Number((entry as any)?.flag_primary_name ?? 0) === 1,
    }))
    .filter((entry) => Boolean(entry.name))
    .sort((a, b) => {
      if (a.primary !== b.primary) return a.primary ? -1 : 1;
      return a.name.length - b.name.length;
    });

  const out: string[] = [];
  const seen = new Set<string>();
  for (const entry of ranked) {
    const variants = [entry.name, normalizeAliasText(entry.name)].filter(Boolean);
    for (const variant of variants) {
      const key = normalizeAliasText(variant);
      if (!key || seen.has(key)) continue;
      seen.add(key);
      out.push(variant);
      if (out.length >= 8) return out;
    }
  }
  return out.slice(0, 8);
};

const bestNameSimilarity = (names: string[], shopifyTitle: string): number => {
  const normalizedTitle = normalizeAliasText(shopifyTitle);
  let best = 0;
  for (const name of names) {
    const normalizedName = normalizeAliasText(name);
    const score = Math.max(
      similarityScore(name, shopifyTitle),
      normalizedName && normalizedTitle ? similarityScore(normalizedName, normalizedTitle) : 0,
    );
    if (score > best) best = score;
  }
  return best;
};

const buildSearchQueries = (row: CandidateRow): string[] => {
  const out = new Set<string>();
  const cleanProduct = sanitize(row.productName);
  const aliases = row.productLicenceAliases.map((alias) => sanitize(alias)).filter(Boolean);

  // Minimal refine mode: query primary productLicences aliases first, then fallback to LNHPD product name.
  for (const alias of aliases.slice(0, 2)) {
    if (alias) out.add(alias);
  }
  if (cleanProduct) out.add(cleanProduct);
  for (const alias of aliases.slice(2, 4)) {
    if (alias) out.add(alias);
  }

  const primaryAlias = aliases[0] ?? "";
  const primaryAliasTrimmed = normalizeAliasText(primaryAlias);
  if (primaryAliasTrimmed) out.add(primaryAliasTrimmed);

  const coreTokens = tokenize(cleanProduct)
    .filter((token) => token.length >= 3)
    .filter((token) => !SEARCH_STOP_WORDS.has(token))
    .filter((token) => !/^\d+$/.test(token))
    .slice(0, 6);

  if (coreTokens.length > 0) {
    out.add(coreTokens.join(" "));
  }
  if (coreTokens.length >= 2 && row.dosageFormClass) {
    out.add(`${coreTokens.slice(0, 4).join(" ")} ${row.dosageFormClass}`);
  }
  if (coreTokens.length >= 3) {
    out.add(coreTokens.slice(0, 3).join(" "));
  }
  return Array.from(out).slice(0, 4);
};

const dosageFormFromText = (value: string): DosageFormClass | null => {
  const text = normalizeLooseText(value);
  if (!text) return null;
  if (/\bgumm(y|ies)\b/.test(text)) return "gummy";
  if (/\bsoftgels?\b/.test(text)) return "softgel";
  if (/\bcaplets?\b/.test(text)) return "caplet";
  if (/\b(?:capsules?|caps?|vcaps?|veg(?:etarian)?\s*caps?)\b/.test(text)) return "capsule";
  if (/\btablets?\b|\btabs?\b/.test(text)) return "tablet";
  if (/\blozenges?\b/.test(text)) return "lozenge";
  if (/\bchewable\b|\bchews?\b/.test(text)) return "chewable";
  if (/\bdrops?\b/.test(text)) return "drop";
  if (/\bsprays?\b/.test(text)) return "spray";
  if (/\bpowder\b/.test(text)) return "powder";
  if (/\bliquid\b|\bsyrup\b/.test(text)) return "liquid";
  return null;
};

const normalizeShopifyTagsText = (value: unknown): string => {
  if (Array.isArray(value)) {
    return value.map((entry) => sanitize(entry)).filter(Boolean).join(" ");
  }
  return sanitize(value).replace(/,/g, " ");
};

const stripHtmlToText = (value: string): string => {
  if (!value) return "";
  return sanitize(
    value
      .replace(/<script[\s\S]*?<\/script>/gi, " ")
      .replace(/<style[\s\S]*?<\/style>/gi, " ")
      .replace(/<[^>]+>/g, " ")
      .replace(/&nbsp;/gi, " ")
      .replace(/&amp;/gi, "&")
      .replace(/&quot;/gi, "\"")
      .replace(/&#39;|&apos;/gi, "'"),
  );
};

const inferShopifyDosageForm = (params: {
  title?: string;
  productType?: string;
  tags?: unknown;
  bodyHtml?: string;
  body?: string;
  handle?: string;
  variants?: ShopifyVariant[] | null;
}): DosageFormClass | null => {
  const variantText = Array.isArray(params.variants)
    ? params.variants.map((variant) => sanitize(variant.title)).filter(Boolean).join(" ")
    : "";
  const handleText = sanitize(params.handle).replace(/[-_]+/g, " ");
  const tagsText = normalizeShopifyTagsText(params.tags);
  const bodyText = stripHtmlToText(params.bodyHtml || params.body || "");

  const orderedTextWindows = [
    `${sanitize(params.title)} ${sanitize(params.productType)} ${variantText}`,
    tagsText,
    handleText,
    bodyText,
  ];

  for (const windowText of orderedTextWindows) {
    const form = dosageFormFromText(windowText);
    if (form) return form;
  }
  return null;
};

const detectFamilyBucket = (productName: string): FamilyBucket | null => {
  for (const matcher of familyMatchers) {
    if (matcher.re.test(productName)) return matcher.bucket;
  }
  return null;
};

const isBrandRuleMatch = (brandRule: BrandRule, brandName: string): boolean => {
  if (!brandRule.includeBrand.test(brandName)) return false;
  if (brandRule.excludeBrand && brandRule.excludeBrand.test(brandName)) return false;
  return true;
};

const jaccardSimilarity = (a: string[], b: string[]): number => {
  if (!a.length || !b.length) return 0;
  const sa = new Set(a);
  const sb = new Set(b);
  let intersection = 0;
  for (const token of sa) {
    if (sb.has(token)) intersection += 1;
  }
  const union = new Set([...sa, ...sb]).size;
  return union > 0 ? intersection / union : 0;
};

const similarityScore = (lnhpdProduct: string, shopifyTitle: string): number => {
  const left = tokenize(lnhpdProduct);
  const right = tokenize(shopifyTitle);
  const jaccard = jaccardSimilarity(left, right);
  const leftText = left.join(" ");
  const rightText = right.join(" ");
  const containsBoost = leftText && rightText && (leftText.includes(rightText) || rightText.includes(leftText)) ? 0.12 : 0;
  const numericLeft = left.filter((t) => /^\d+$/.test(t));
  const numericRight = new Set(right.filter((t) => /^\d+$/.test(t)));
  let numericHits = 0;
  for (const n of numericLeft) {
    if (numericRight.has(n)) numericHits += 1;
  }
  const numericBoost = numericHits > 0 ? Math.min(0.12, numericHits * 0.04) : 0;
  const semLeft = semanticTokens(lnhpdProduct);
  const semRight = semanticTokens(shopifyTitle);
  const semRightSet = new Set(semRight);
  const semOverlap = semLeft.filter((token) => semRightSet.has(token));
  const semPhraseLeft = semLeft.join(" ");
  const semPhraseRight = semRight.join(" ");
  const phraseContains =
    semLeft.length >= 2 &&
    semRight.length >= 2 &&
    (semPhraseLeft.includes(semPhraseRight) || semPhraseRight.includes(semPhraseLeft));
  let semanticBoost = 0;
  if (semOverlap.length >= 2) {
    semanticBoost = 0.18;
  } else if (semOverlap.length === 1) {
    const anchor = semOverlap[0];
    if (anchor.length >= 6 && !WEAK_SEMANTIC_TOKENS.has(anchor)) semanticBoost = 0.12;
  }
  if (phraseContains) {
    semanticBoost = Math.max(semanticBoost, 0.12);
  }

  return Math.min(1, jaccard + containsBoost + numericBoost + semanticBoost);
};

const normalizeHandleFromUrl = (siteBase: string, urlOrPath: string | null | undefined): string | null => {
  const raw = sanitize(urlOrPath);
  if (!raw) return null;
  try {
    const absolute = raw.startsWith("http") ? raw : `${siteBase}${raw.startsWith("/") ? "" : "/"}${raw}`;
    const parsed = new URL(absolute);
    const pathName = parsed.pathname.replace(/\/+$/, "");
    const match = pathName.match(/\/products\/([^/]+)/i);
    return match?.[1] ? match[1].trim() : null;
  } catch {
    return null;
  }
};

const extractHandleFromEvidenceUrl = (urlValue: string): string | null => {
  try {
    const parsed = new URL(urlValue);
    const match = parsed.pathname.match(/\/products\/([^/.]+)(?:\.js)?$/i);
    return match?.[1] ? match[1].trim() : null;
  } catch {
    return null;
  }
};

const loadKnownHandlesFromHistory = async (): Promise<Map<string, Set<string>>> => {
  const out = new Map<string, Set<string>>();
  const files = await fs.promises.readdir(outputDir);
  for (const file of files) {
    if (!/^npn_barcode_manual_review_(batch20|family_batch)_\d{8}T\d{6}Z(_postcheck_fixed)?\.json$/.test(file)) {
      continue;
    }
    const full = path.resolve(outputDir, file);
    let payload: any;
    try {
      payload = JSON.parse(await fs.promises.readFile(full, "utf8"));
    } catch {
      continue;
    }
    for (const row of payload?.results ?? []) {
      const npn = normalizeNpn(row?.npn);
      if (!npn) continue;
      const evidence = Array.isArray(row?.evidence) ? row.evidence : [];
      for (const entry of evidence) {
        const handle = extractHandleFromEvidenceUrl(sanitize(entry));
        if (!handle) continue;
        const set = out.get(npn) ?? new Set<string>();
        set.add(handle);
        out.set(npn, set);
      }
    }
  }
  return out;
};

const fetchJsonWithTimeout = async <T>(url: string, timeoutMs = 10000): Promise<T | null> => {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, {
      signal: controller.signal,
      headers: {
        "user-agent":
          "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36",
        accept: "application/json,text/javascript,*/*",
      },
      redirect: "follow",
    });
    if (!response.ok) return null;
    const text = await response.text();
    try {
      return JSON.parse(text) as T;
    } catch {
      return null;
    }
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
};

const fetchShopifySuggest = async (siteBase: string, query: string): Promise<ShopifySuggestProduct[]> => {
  const url =
    `${siteBase}/search/suggest.json?q=${encodeURIComponent(query)}` +
    "&resources[type]=product&resources[limit]=12&resources[options][unavailable_products]=hide";
  const payload = await fetchJsonWithTimeout<{ resources?: { results?: { products?: ShopifySuggestProduct[] } } }>(url, 12000);
  const products = payload?.resources?.results?.products;
  return Array.isArray(products) ? products : [];
};

const fetchShopifySuggestMerged = async (
  siteBase: string,
  queries: string[],
): Promise<ShopifySuggestProduct[]> => {
  const byHandle = new Map<string, ShopifySuggestProduct>();
  for (const query of queries) {
    const products = await fetchShopifySuggest(siteBase, query);
    for (const product of products) {
      const handle = sanitize(product.handle) || normalizeHandleFromUrl(siteBase, product.url);
      if (!handle) continue;
      if (!byHandle.has(handle)) {
        byHandle.set(handle, {
          ...product,
          handle,
        });
      }
    }
  }
  return Array.from(byHandle.values());
};

const fetchShopifyProductJs = async (siteBase: string, handle: string): Promise<ShopifyProductJs | null> => {
  const clean = sanitize(handle).replace(/^\/+|\/+$/g, "");
  if (!clean) return null;
  const url = `${siteBase}/products/${clean}.js`;
  return await fetchJsonWithTimeout<ShopifyProductJs>(url, 12000);
};

type SpecSignals = {
  strength: Set<string>;
  count: Set<string>;
  size: Set<string>;
  qualifiers: Set<string>;
};

const ALLOWLIST_RELEASE_REASON_PREFIX = "allowlist_unique_spec_anchor";
const ALLOWLIST_HOLD_REASONS = new Set([
  "allowlist_hold_until_unique_spec_anchor",
  "allowlist_anchor_conflict",
]);

const isAllowlistReleaseReason = (matchMode: string) =>
  matchMode === ALLOWLIST_RELEASE_REASON_PREFIX || matchMode.startsWith(`${ALLOWLIST_RELEASE_REASON_PREFIX}_`);

const isAllowlistHeldReason = (matchMode: string) => ALLOWLIST_HOLD_REASONS.has(matchMode);

export const deriveAllowlistCounterDeltas = (
  result: Pick<BatchResult, "allowlistApplied" | "matchMode">,
): {
  allowlistAppliedCount: number;
  allowlistReleasedCount: number;
  allowlistHeldCount: number;
} => {
  if (!result.allowlistApplied) {
    return {
      allowlistAppliedCount: 0,
      allowlistReleasedCount: 0,
      allowlistHeldCount: 0,
    };
  }

  const mode = sanitize(result.matchMode).toLowerCase();
  return {
    allowlistAppliedCount: 1,
    allowlistReleasedCount: mode && isAllowlistReleaseReason(mode) ? 1 : 0,
    allowlistHeldCount: mode && isAllowlistHeldReason(mode) ? 1 : 0,
  };
};

export const extractSpecSignals = (value: string): SpecSignals => {
  const normalized = normalizeLooseText(value);
  const strength = new Set<string>();
  const count = new Set<string>();
  const size = new Set<string>();
  const qualifiers = new Set<string>();

  for (const match of normalized.matchAll(/\b(\d+(?:\.\d+)?)\s*(mg|mcg|g|iu|ml)\b/g)) {
    const amount = match[1];
    const unit = match[2];
    strength.add(`${amount}${unit}`);
  }

  for (const match of normalized.matchAll(/\b(\d+)\s*(count|ct|caps?|capsules?|caplets?|tabs?|tablets?|softgels?|gummies?|lozenges?|chewables?|scoops?|pk|packs?)\b/g)) {
    count.add(match[1]);
  }
  for (const match of normalized.matchAll(/\b(\d+)\s*x\s*(\d+)\b/g)) {
    count.add(match[1]);
    count.add(match[2]);
  }
  for (const match of normalized.matchAll(/\b(\d+)s\b/g)) {
    count.add(match[1]);
  }

  for (const match of normalized.matchAll(/\b(\d+(?:\.\d+)?)\s*(ml|g)\b/g)) {
    const amount = match[1];
    const unit = match[2];
    size.add(`${amount}${unit}`);
  }

  if (/alcohol\s*free/.test(normalized)) qualifiers.add("alcohol_free");
  if (/alcohol\s*base/.test(normalized)) qualifiers.add("alcohol_base");

  return { strength, count, size, qualifiers };
};

const scoreSpecAttribution = (
  productSignals: SpecSignals,
  variantSignals: SpecSignals,
): { score: number; strengthHits: number; countHits: number; sizeHits: number } => {
  const SPEC_WEIGHT_STRENGTH = 8;
  const SPEC_WEIGHT_COUNT = 6;
  const SPEC_WEIGHT_SIZE = 2;
  let strengthHits = 0;
  let countHits = 0;
  let sizeHits = 0;
  for (const token of productSignals.strength) {
    if (variantSignals.strength.has(token)) strengthHits += 1;
  }
  for (const token of productSignals.count) {
    if (variantSignals.count.has(token)) countHits += 1;
  }
  for (const token of productSignals.size) {
    if (variantSignals.size.has(token)) sizeHits += 1;
  }
  const score = strengthHits * SPEC_WEIGHT_STRENGTH + countHits * SPEC_WEIGHT_COUNT + sizeHits * SPEC_WEIGHT_SIZE;
  return { score, strengthHits, countHits, sizeHits };
};

const pickUniqueSpecAnchorVariant = (
  variants: BarcodeCandidate[],
  lnhpdSignals: SpecSignals,
): { selected: BarcodeCandidate | null; reason: "allowlist_unique_spec_anchor" | "allowlist_hold_until_unique_spec_anchor" | "allowlist_anchor_conflict" } => {
  const variantSignals = variants.map((candidate) => ({
    candidate,
    signals: extractSpecSignals(candidate.variantSignalText),
  }));

  const anchorHits: Array<{ anchor: string; barcode: string }> = [];
  const collectUnique = (anchor: string, matcher: (signals: SpecSignals) => boolean) => {
    const matches = variantSignals.filter((entry) => matcher(entry.signals));
    if (matches.length === 1) {
      anchorHits.push({ anchor, barcode: matches[0].candidate.barcodeGtin14 });
    }
  };

  for (const token of lnhpdSignals.count) {
    collectUnique(`count:${token}`, (signals) => signals.count.has(token));
  }
  for (const token of lnhpdSignals.size) {
    collectUnique(`size:${token}`, (signals) => signals.size.has(token));
  }
  for (const token of lnhpdSignals.strength) {
    collectUnique(`strength:${token}`, (signals) => signals.strength.has(token));
  }

  if (lnhpdSignals.qualifiers.has("alcohol_free")) {
    collectUnique("qualifier:alcohol_free", (signals) => signals.qualifiers.has("alcohol_free"));
  }
  if (lnhpdSignals.qualifiers.has("alcohol_base")) {
    collectUnique("qualifier:alcohol_base", (signals) => signals.qualifiers.has("alcohol_base"));
  }

  if (anchorHits.length === 0) {
    return { selected: null, reason: "allowlist_hold_until_unique_spec_anchor" };
  }

  const uniqueBarcodes = Array.from(new Set(anchorHits.map((entry) => entry.barcode)));
  if (uniqueBarcodes.length !== 1) {
    return { selected: null, reason: "allowlist_anchor_conflict" };
  }

  const selected = variants.find((entry) => entry.barcodeGtin14 === uniqueBarcodes[0]) ?? null;
  if (!selected) return { selected: null, reason: "allowlist_anchor_conflict" };
  return { selected, reason: "allowlist_unique_spec_anchor" };
};

const normalizeVariantBarcode = (rawValue: unknown): BarcodeCandidate | null => {
  const raw = sanitize(rawValue);
  if (!raw) return null;
  const digits = raw.replace(/\D/g, "");
  if (!digits) return null;

  const candidates: Array<{ input: string; normalization: "as_is" | "upc11_leading0" }> = [];
  if (digits.length === 11) {
    candidates.push({ input: `0${digits}`, normalization: "upc11_leading0" });
  }
  candidates.push({ input: digits, normalization: "as_is" });

  for (const candidate of candidates) {
    const normalized = normalizeBarcodeInput(candidate.input);
    if (!normalized || normalized.isValidChecksum !== true) continue;
    const gtin14 = normalized.variants.find((value) => /^\d{14}$/.test(value)) ?? null;
    if (!gtin14) continue;
    return {
      barcodeRaw: raw,
      barcodeGtin14: gtin14,
      barcodeNormalizedInput: candidate.input,
      normalization: candidate.normalization,
      variantTitle: "",
      variantSignalText: "",
    };
  }

  return null;
};

const chooseVariantBarcode = (
  variants: ShopifyVariant[],
  lnhpdProduct: string,
  lnhpdForm: DosageFormClass,
  allowlistRule?: SpecGapAllowlistRule | null,
): { selected: BarcodeCandidate | null; allCandidates: string[]; reason: string } => {
  const seen = new Set<string>();
  const withVariant: BarcodeCandidate[] = [];

  for (const variant of variants) {
    const base = normalizeVariantBarcode(variant.barcode);
    if (!base) continue;
    if (seen.has(base.barcodeGtin14)) continue;
    seen.add(base.barcodeGtin14);
    const variantTitle = sanitize(variant.title) || sanitize(variant.public_title);
    const variantPublicTitle = sanitize(variant.public_title);
    const variantOptions = [variant.option1, variant.option2, variant.option3]
      .map((value) => sanitize(value))
      .filter(Boolean)
      .join(" ");
    const variantSkuRaw = sanitize(variant.sku);
    const variantSkuText = variantSkuRaw
      .replace(/[-_/]+/g, " ")
      .replace(/([a-zA-Z])(\d)/g, "$1 $2")
      .replace(/(\d)([a-zA-Z])/g, "$1 $2");
    const variantSignalText = sanitize(`${variantTitle} ${variantPublicTitle} ${variantOptions} ${variantSkuText}`);
    withVariant.push({
      ...base,
      variantTitle,
      variantSignalText,
    });
  }

  if (withVariant.length === 0) {
    return { selected: null, allCandidates: [], reason: "no_variant_barcode" };
  }

  if (withVariant.length === 1) {
    return { selected: withVariant[0], allCandidates: [withVariant[0].barcodeGtin14], reason: "single_variant" };
  }

  const lnhpdTokens = tokenize(lnhpdProduct);
  const lnhpdNumbers = new Set(lnhpdTokens.filter((token) => /^\d+$/.test(token)));
  const productSpecSignals = extractSpecSignals(lnhpdProduct);

  if (allowlistRule?.status === "HOLD_UNTIL_UNIQUE_SPEC_ANCHOR") {
    const allowlistDecision = pickUniqueSpecAnchorVariant(withVariant, productSpecSignals);
    return {
      selected: allowlistDecision.selected,
      allCandidates: withVariant.map((entry) => entry.barcodeGtin14),
      reason: allowlistDecision.reason,
    };
  }

  const scored = withVariant.map((candidate) => {
    const variantTokens = tokenize(candidate.variantSignalText);
    let score = 0;

    const variantForm = dosageFormFromText(candidate.variantSignalText);
    if (variantForm && variantForm === lnhpdForm) score += 2;

    for (const numberToken of lnhpdNumbers) {
      if (variantTokens.includes(numberToken)) score += 2;
    }

    const lnhpdStrengthTokens = lnhpdTokens.filter((t) => /^\d+(mg|mcg|g|iu|ml)$/i.test(t));
    for (const strengthToken of lnhpdStrengthTokens) {
      if (variantTokens.includes(strengthToken.toLowerCase())) score += 2;
    }

    const titleText = normalizeLooseText(candidate.variantSignalText);
    const rowText = normalizeLooseText(lnhpdProduct);
    if (titleText && rowText && (rowText.includes(titleText) || titleText.includes(rowText))) {
      score += 1;
    }

    return { candidate, score };
  });

  scored.sort((a, b) => b.score - a.score);
  const top = scored[0];
  const second = scored[1];

  const needSpecSecondPass = !top || top.score <= 0 || (second && second.score === top.score);
  if (needSpecSecondPass) {
    const specScored = withVariant
      .map((candidate) => ({
        candidate,
        ...scoreSpecAttribution(productSpecSignals, extractSpecSignals(candidate.variantSignalText)),
      }))
      .sort((a, b) => b.score - a.score);
    const specTop = specScored[0];
    const specSecond = specScored[1];
    const hasPrimaryEvidence = Boolean(specTop && (specTop.strengthHits > 0 || specTop.countHits > 0));
    if (specTop && hasPrimaryEvidence && specTop.score > 0 && (!specSecond || specTop.score > specSecond.score)) {
      return {
        selected: specTop.candidate,
        allCandidates: withVariant.map((entry) => entry.barcodeGtin14),
        reason: "shopify_variant_spec_attribution_secondary_specs",
      };
    }
    return {
      selected: null,
      allCandidates: withVariant.map((entry) => entry.barcodeGtin14),
      reason: "same_page_multi_upc_ambiguous",
    };
  }

  return {
    selected: top.candidate,
    allCandidates: withVariant.map((entry) => entry.barcodeGtin14),
    reason: "shopify_variant_spec_attribution",
  };
};

const ensureDir = async (filePath: string) => {
  await fs.promises.mkdir(path.dirname(filePath), { recursive: true });
};

const writeJson = async (filePath: string, payload: unknown) => {
  await ensureDir(filePath);
  await fs.promises.writeFile(filePath, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
};

const loadReviewedNpns = async (): Promise<Set<string>> => {
  const reviewed = new Set<string>();
  const files = await fs.promises.readdir(outputDir);
  for (const file of files) {
    if (!/^npn_barcode_manual_review_batch20_\d{8}T\d{6}Z(_postcheck_fixed)?\.json$/.test(file)) continue;
    const full = path.resolve(outputDir, file);
    try {
      const payload = JSON.parse(await fs.promises.readFile(full, "utf8")) as {
        dryRun?: boolean;
        results?: Array<{ npn?: string }>;
      };
      if (payload.dryRun) continue;
      for (const row of payload.results ?? []) {
        const status = sanitize((row as { status?: unknown }).status).toLowerCase();
        if (status === "no_qualifying_evidence" || status === "no_shopify_match") {
          continue;
        }
        const npn = normalizeNpn(row.npn);
        if (npn) reviewed.add(npn);
      }
    } catch {
      // ignore corrupt legacy file
    }
  }
  return reviewed;
};

const loadSpecGapAllowlist = async (): Promise<Map<string, SpecGapAllowlistRule>> => {
  const out = new Map<string, SpecGapAllowlistRule>();
  if (!specGapWhitelistJsonArg) return out;

  const resolvedPath = path.isAbsolute(specGapWhitelistJsonArg)
    ? specGapWhitelistJsonArg
    : path.resolve(repoRoot, specGapWhitelistJsonArg);

  let payload: any;
  try {
    payload = JSON.parse(await fs.promises.readFile(resolvedPath, "utf8"));
  } catch (error) {
    throw new Error(
      `load_spec_gap_allowlist_failed(${resolvedPath}): ${error instanceof Error ? error.message : String(error)}`,
    );
  }

  const items = Array.isArray(payload?.items) ? payload.items : [];
  for (const item of items) {
    const npn = normalizeNpn(item?.npn);
    if (!npn) continue;
    const status = sanitize(item?.autoReleaseAllowlistRule?.status).toUpperCase();
    if (status === "HOLD_UNTIL_UNIQUE_SPEC_ANCHOR") {
      out.set(npn, { status: "HOLD_UNTIL_UNIQUE_SPEC_ANCHOR" });
    }
  }

  return out;
};

const loadPersistedHoldFamilyNpns = async (): Promise<Map<FamilyBucket, Set<string>>> => {
  const buckets = new Map<FamilyBucket, Set<string>>([
    ["bee_propolis", new Set<string>()],
    ["ginseng", new Set<string>()],
    ["primadophilus", new Set<string>()],
  ]);
  const files = await fs.promises.readdir(outputDir);
  for (const file of files) {
    if (!/^npn_barcode_manual_review_batch20_\d{8}T\d{6}Z(_postcheck_fixed)?\.json$/.test(file)) continue;
    const full = path.resolve(outputDir, file);
    let payload: any;
    try {
      payload = JSON.parse(await fs.promises.readFile(full, "utf8"));
    } catch {
      continue;
    }
    for (const row of payload?.results ?? []) {
      const status = sanitize(row?.status).toLowerCase();
      if (!status.includes("hold")) continue;
      const npn = normalizeNpn(row?.npn);
      const productName = sanitize(row?.product);
      if (!npn || !productName) continue;
      const bucket = detectFamilyBucket(productName);
      if (!bucket) continue;
      buckets.get(bucket)?.add(npn);
    }
  }
  return buckets;
};

const loadMappedNpnSet = async (): Promise<Set<string>> => {
  const mapped = new Set<string>();
  const pageSize = 5000;
  let from = 0;
  while (true) {
    const { data, error } = await supabase
      .from("barcode_regulatory_map")
      .select("npn")
      .order("npn", { ascending: true })
      .range(from, from + pageSize - 1);
    if (error) {
      throw new Error(`load_mapped_npns_failed: ${error.message}`);
    }
    const rows = Array.isArray(data) ? data : [];
    if (rows.length === 0) break;
    for (const row of rows) {
      const npn = normalizeNpn((row as { npn?: string | null }).npn);
      if (npn) mapped.add(npn);
    }
    if (rows.length < pageSize) break;
    from += pageSize;
  }
  return mapped;
};

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));
const isStatementTimeoutError = (message: string) => /statement timeout/i.test(message);

const fetchBrandRows = async (brandRule: BrandRule): Promise<LnhpdRow[]> => {
  const out: LnhpdRow[] = [];
  // Smaller page size reduces Supabase statement-timeout risk on large brand partitions.
  const pageSize = 200;
  let from = 0;
  while (true) {
    let data: Array<Pick<LnhpdRow, "lnhpd_id" | "npn" | "brand_name" | "product_name">> | null = null;
    let rowsError: string | null = null;
    for (let attempt = 0; attempt < 3; attempt += 1) {
      const { data: fetched, error } = await supabase
        .from("lnhpd_facts")
        .select("lnhpd_id,npn,brand_name,product_name")
        .ilike("brand_name", brandRule.brandIlike)
        .not("npn", "is", null)
        .order("lnhpd_id", { ascending: true })
        .range(from, from + pageSize - 1);
      if (!error) {
        data = (fetched ?? []) as Array<Pick<LnhpdRow, "lnhpd_id" | "npn" | "brand_name" | "product_name">>;
        rowsError = null;
        break;
      }
      rowsError = error.message;
      if (!isStatementTimeoutError(error.message) || attempt === 2) break;
      await sleep((attempt + 1) * 700);
    }
    if (rowsError) {
      if (isStatementTimeoutError(rowsError)) {
        console.warn(
          `[manual-shopify-batch] skip brand ${brandRule.key}: repeated statement timeout at range ${from}-${from + pageSize - 1}`,
        );
        return out;
      }
      throw new Error(`load_lnhpd_rows_failed(${brandRule.key}): ${rowsError}`);
    }

    const baseRows = data ?? [];
    if (baseRows.length === 0) break;

    const idChunkSize = 200;
    const factsById = new Map<number, Record<string, unknown> | null>();
    const ids = baseRows.map((row) => row.lnhpd_id);
    for (let i = 0; i < ids.length; i += idChunkSize) {
      const chunk = ids.slice(i, i + idChunkSize);
      let factRows: Array<Pick<LnhpdRow, "lnhpd_id" | "facts_json">> | null = null;
      let factErrorMessage: string | null = null;
      for (let attempt = 0; attempt < 3; attempt += 1) {
        const { data: fetchedFactRows, error: factError } = await supabase
          .from("lnhpd_facts")
          .select("lnhpd_id,facts_json")
          .in("lnhpd_id", chunk);
        if (!factError) {
          factRows = (fetchedFactRows ?? []) as Array<Pick<LnhpdRow, "lnhpd_id" | "facts_json">>;
          factErrorMessage = null;
          break;
        }
        factErrorMessage = factError.message;
        if (!isStatementTimeoutError(factError.message) || attempt === 2) break;
        await sleep((attempt + 1) * 700);
      }
      if (factErrorMessage) {
        if (isStatementTimeoutError(factErrorMessage)) {
          console.warn(
            `[manual-shopify-batch] skip brand ${brandRule.key}: facts payload timeout for ${chunk.length} ids`,
          );
          return out;
        }
        throw new Error(`load_lnhpd_facts_payload_failed(${brandRule.key}): ${factErrorMessage}`);
      }
      for (const row of factRows ?? []) {
        factsById.set(row.lnhpd_id, row.facts_json ?? null);
      }
    }

    out.push(
      ...baseRows.map((row) => ({
        ...row,
        facts_json: factsById.get(row.lnhpd_id) ?? null,
      })),
    );

    if (baseRows.length < pageSize) break;
    from += pageSize;
  }
  return out;
};

const loadRowsByNpns = async (npns: string[]): Promise<Map<string, LnhpdRow>> => {
  const out = new Map<string, LnhpdRow>();
  const chunkSize = 200;
  for (let i = 0; i < npns.length; i += chunkSize) {
    const chunk = npns.slice(i, i + chunkSize);
    const { data, error } = await supabase
      .from("lnhpd_facts")
      .select("lnhpd_id,npn,brand_name,product_name,facts_json")
      .in("npn", chunk);
    if (error) {
      throw new Error(`load_rows_by_npns_failed: ${error.message}`);
    }
    for (const row of (data ?? []) as LnhpdRow[]) {
      const npn = normalizeNpn(row.npn);
      if (!npn || out.has(npn)) continue;
      out.set(npn, row);
    }
  }
  return out;
};

const resolveBrandRuleForRow = (brandName: string): BrandRule | null => {
  for (const rule of BRAND_RULES) {
    if (isBrandRuleMatch(rule, brandName)) return rule;
  }
  return null;
};

const loadFamilyInputTargets = async (
  inputPath: string,
  buckets: FamilyBucket[],
): Promise<Array<{ npn: string; bucket: FamilyBucket }>> => {
  const resolved = path.isAbsolute(inputPath) ? inputPath : path.resolve(repoRoot, inputPath);
  const payload = JSON.parse(await fs.promises.readFile(resolved, "utf8")) as {
    nextFamilyTargets?: Record<string, Array<{ npn?: string }>>;
  };
  const source = payload.nextFamilyTargets ?? {};
  const pickedBuckets = buckets.length > 0 ? buckets : (["bee_propolis", "ginseng", "primadophilus"] as FamilyBucket[]);
  const out: Array<{ npn: string; bucket: FamilyBucket }> = [];
  const seen = new Set<string>();
  for (const bucket of pickedBuckets) {
    const rows = Array.isArray(source[bucket]) ? source[bucket] : [];
    for (const row of rows) {
      const npn = normalizeNpn((row as { npn?: unknown }).npn);
      if (!npn || seen.has(npn)) continue;
      seen.add(npn);
      out.push({ npn, bucket });
    }
  }
  return out;
};

const insertMapping = async (params: {
  npn: string;
  barcodeGtin14: string;
  barcodeRaw: string;
  confidence: number;
  source: string;
}): Promise<"inserted" | "conflict" | "duplicate"> => {
  if (dryRun) return "inserted";

  const outcome = await upsertRegulatoryMapWithPolicy(
    {
      barcodeGtin14: params.barcodeGtin14,
      barcodeRaw: params.barcodeRaw,
      npn: params.npn,
      confidence: params.confidence,
      source: params.source,
      expiresAt: null,
    },
    { timeoutMs: 1500, keyContractMode: "enforce", writeGuardMode: "enforce" },
  );
  if (outcome.status === "blocked") {
    const existing = outcome.existing;
    if (existing) {
      const existingNpn = normalizeNpn(existing.npn);
      if (existingNpn && existingNpn !== params.npn) return "conflict";
    }
    return "duplicate";
  }

  return "inserted";
};

const updateFactsBarcodeCandidates = async (
  row: CandidateRow,
  params: {
    insertedBarcode: string;
    sourceTag: string;
    maxCount: number;
    confidence?: number;
    evidence?: string | null;
    matchMode?: string | null;
  },
) => {
  if (dryRun) return;

  const nowIso = new Date().toISOString();
  const facts = row.factsJson && typeof row.factsJson === "object" ? { ...row.factsJson } : {};
  const merged = mergeFactsBarcodeCandidates({
    facts: facts as Record<string, unknown>,
    incomingBarcodes: [params.insertedBarcode],
    incomingMeta: [
      {
        barcode: params.insertedBarcode,
        source: params.sourceTag,
        confidence: params.confidence ?? null,
        evidence: params.evidence ?? null,
        matchMode: params.matchMode ?? null,
        lastSeenAt: nowIso,
      },
    ],
    maxCount: params.maxCount,
    preferIncoming: true,
  });

  (facts as Record<string, unknown>).barcodeCandidates = merged.barcodes;
  if (merged.meta.length > 0) {
    (facts as Record<string, unknown>).barcodeCandidatesMeta = merged.meta;
  } else {
    delete (facts as Record<string, unknown>).barcodeCandidatesMeta;
  }
  (facts as Record<string, unknown>).barcodeSource = params.sourceTag;
  (facts as Record<string, unknown>).barcodeUpdatedAt = nowIso;

  const { error } = await supabase
    .from("lnhpd_facts")
    .update({ facts_json: facts })
    .eq("lnhpd_id", row.lnhpdId);

  if (error) {
    throw new Error(`update_lnhpd_facts_failed(${row.npn}): ${error.message}`);
  }
};

const buildCandidatePools = async (): Promise<{
  mainCandidates: CandidateRow[];
  familyCandidates: CandidateRow[];
  persistedFamilyHolds: Map<FamilyBucket, Set<string>>;
}> => {
  const reviewedNpns = await loadReviewedNpns();
  const mappedNpns = await loadMappedNpnSet();
  const persistedFamilyHolds = await loadPersistedHoldFamilyNpns();

  const mainCandidates: CandidateRow[] = [];
  const familyCandidates: CandidateRow[] = [];

  for (const brandRule of BRAND_RULES) {
    const rows = await fetchBrandRows(brandRule);
    for (const row of rows) {
      const npn = normalizeNpn(row.npn);
      if (!npn) continue;
      if (skipNpns.has(npn)) continue;
      if (reviewedNpns.has(npn)) continue;
      if (mappedNpns.has(npn)) continue;

      const brandName = sanitize(row.brand_name);
      const productName = sanitize(row.product_name);
      if (!brandName || !productName) continue;
      if (!isBrandRuleMatch(brandRule, brandName)) continue;
      if (SUPPLEMENT_BLOCKLIST.test(`${brandName} ${productName}`)) continue;

      const dosageFormClass = dosageFormFromText(productName);
      if (!dosageFormClass) continue;

      const familyBucket = detectFamilyBucket(productName);

      if (!familyBucket && !MAIN_BATCH_BRAND_WHITELIST.has(brandRule.key)) {
        continue;
      }

      const candidate: CandidateRow = {
        npn,
        lnhpdId: row.lnhpd_id,
        brandName,
        productName,
        productLicenceAliases: extractProductLicenceAliases(row.facts_json),
        factsJson: row.facts_json,
        brandRule,
        dosageFormClass,
        familyBucket,
      };

      if (familyBucket) {
        familyCandidates.push(candidate);
      } else {
        mainCandidates.push(candidate);
      }
    }
  }

  mainCandidates.sort((a, b) => a.lnhpdId - b.lnhpdId);
  familyCandidates.sort((a, b) => a.lnhpdId - b.lnhpdId);

  return { mainCandidates, familyCandidates, persistedFamilyHolds };
};

const evaluateCandidate = async (
  row: CandidateRow,
  preloadedSuggestProducts?: ShopifySuggestProduct[],
  allowlistRule?: SpecGapAllowlistRule | null,
): Promise<BatchResult> => {
  const allowlistApplied = Boolean(allowlistRule);
  const withAllowlistFlag = (result: Omit<BatchResult, "allowlistApplied">): BatchResult => ({
    ...result,
    allowlistApplied,
  });

  const preferDirectHandles =
    Array.isArray(row.knownHandles) &&
    row.knownHandles.length > 0 &&
    (row.familyBucket === "bee_propolis" || row.familyBucket === "ginseng");

  let suggestProducts = preferDirectHandles
    ? []
    : preloadedSuggestProducts && preloadedSuggestProducts.length > 0
      ? preloadedSuggestProducts
      : await fetchShopifySuggestMerged(row.brandRule.siteBase, buildSearchQueries(row));
  const directJsByHandle = new Map<string, ShopifyProductJs>();
  let usedDirectHandleFallback = false;

  if ((preferDirectHandles || !suggestProducts.length) && Array.isArray(row.knownHandles) && row.knownHandles.length > 0) {
    usedDirectHandleFallback = true;
    const merged = new Map<string, ShopifySuggestProduct>();
    for (const handleValue of row.knownHandles) {
      const handle = sanitize(handleValue).replace(/^\/+|\/+$/g, "");
      if (!handle || merged.has(handle)) continue;
      const payload = await fetchShopifyProductJs(row.brandRule.siteBase, handle);
      if (!payload || !Array.isArray(payload.variants) || payload.variants.length === 0) continue;
      directJsByHandle.set(handle, payload);
      merged.set(handle, {
        handle,
        title: sanitize(payload.title) || handle,
        product_type: sanitize(payload.product_type),
        url: `/products/${handle}`,
      });
    }
    const directProducts = Array.from(merged.values());
    if (directProducts.length > 0) {
      suggestProducts = directProducts;
    } else {
      suggestProducts = preloadedSuggestProducts && preloadedSuggestProducts.length > 0
        ? preloadedSuggestProducts
        : await fetchShopifySuggestMerged(row.brandRule.siteBase, buildSearchQueries(row));
    }
  }

  if (!suggestProducts.length) {
    return withAllowlistFlag({
      npn: row.npn,
      brand: row.brandName,
      product: row.productName,
      status: "no_shopify_match",
      reason: usedDirectHandleFallback
        ? "Shopify suggest empty and known handles .js did not return usable product payload."
        : "Shopify suggest returned no products.",
      evidence:
        usedDirectHandleFallback && row.knownHandles && row.knownHandles.length > 0
          ? row.knownHandles.map((handle) => `${row.brandRule.siteBase}/products/${sanitize(handle)}.js`)
          : [],
      matchMode: usedDirectHandleFallback ? "no_suggest_and_no_direct_handle_js" : "no_suggest_products",
      dosageForm: { lnhpd: row.dosageFormClass, shopify: null },
    });
  }

  const scored = suggestProducts
    .map((product) => {
      const title = sanitize(product.title);
      const handle = sanitize(product.handle) || normalizeHandleFromUrl(row.brandRule.siteBase, product.url);
      const suggestProductType = sanitize(product.product_type);
      const directPayload = directJsByHandle.get(handle);
      const shopifyForm = inferShopifyDosageForm({
        title,
        productType: suggestProductType,
        tags: directPayload?.tags,
        bodyHtml: directPayload?.body_html,
        body: directPayload?.body,
        handle,
        variants: directPayload?.variants,
      });
      const candidateNamesForSimilarity = [...row.productLicenceAliases, row.productName].slice(0, 9);
      const similarity = bestNameSimilarity(candidateNamesForSimilarity, title);
      const rowStrongSet = new Set(candidateNamesForSimilarity.flatMap((name) => strongSemanticTokens(name)));
      const titleStrong = strongSemanticTokens(title);
      const strongOverlapCount = titleStrong.filter((token) => rowStrongSet.has(token)).length;
      const unmatchedStrongRightCount = titleStrong.filter((token) => !rowStrongSet.has(token)).length;
      const dosageMatch = Boolean(shopifyForm && row.dosageFormClass && shopifyForm === row.dosageFormClass);
      const effectiveSimilarity = Math.min(1, similarity + (dosageMatch ? 0.08 : 0));
      return {
        title,
        handle,
        url: sanitize(product.url),
        suggestProductType,
        similarity: effectiveSimilarity,
        shopifyForm,
        dosageMatch,
        strongOverlapCount,
        unmatchedStrongRightCount,
      };
    })
    .filter((entry) => entry.title && entry.handle)
    .sort((a, b) => b.similarity - a.similarity);

  if (!scored.length) {
    return withAllowlistFlag({
      npn: row.npn,
      brand: row.brandName,
      product: row.productName,
      status: "no_qualifying_evidence",
      reason: "Suggest products missing usable handle/title.",
      evidence: [],
      matchMode: "suggest_missing_handle",
      dosageForm: { lnhpd: row.dosageFormClass, shopify: null },
    });
  }

  const top = scored[0];
  const ties = scored.filter((entry) => Math.abs(entry.similarity - top.similarity) <= tieDelta);
  const tieHandles = new Set(ties.map((entry) => entry.handle));

  const effectiveMinSimilarity = usedDirectHandleFallback ? Math.min(minSimilarity, 0.28) : minSimilarity;
  const canUseEdgeSimilarityPass =
    top.similarity >= 0.52 &&
    Boolean(top.dosageMatch) &&
    top.strongOverlapCount >= 1 &&
    top.unmatchedStrongRightCount === 0;

  if (top.similarity < effectiveMinSimilarity && !canUseEdgeSimilarityPass) {
    return withAllowlistFlag({
      npn: row.npn,
      brand: row.brandName,
      product: row.productName,
      status: "no_qualifying_evidence",
      reason: `Top Shopify title similarity too low (${top.similarity.toFixed(2)}).`,
      evidence: [`${row.brandRule.siteBase}/products/${top.handle}`],
      matchMode: "low_similarity",
      dosageForm: { lnhpd: row.dosageFormClass, shopify: top.shopifyForm ?? null },
    });
  }

  if (tieHandles.size > 1) {
    return withAllowlistFlag({
      npn: row.npn,
      brand: row.brandName,
      product: row.productName,
      status: "hold_ambiguous",
      reason: `Multiple Shopify handles tied within delta ${tieDelta.toFixed(2)}.`,
      evidence: ties.slice(0, 4).map((entry) => `${row.brandRule.siteBase}/products/${entry.handle}`),
      matchMode: "top_handle_tie_ambiguous",
      dosageForm: { lnhpd: row.dosageFormClass, shopify: top.shopifyForm ?? null },
    });
  }

  const productJs =
    directJsByHandle.get(top.handle ?? "") ??
    (await fetchShopifyProductJs(row.brandRule.siteBase, top.handle));
  if (!productJs || !Array.isArray(productJs.variants)) {
    return withAllowlistFlag({
      npn: row.npn,
      brand: row.brandName,
      product: row.productName,
      status: "no_qualifying_evidence",
      reason: "No valid Shopify product .js payload.",
      evidence: [
        `${row.brandRule.siteBase}/products/${top.handle}`,
        `${row.brandRule.siteBase}/products/${top.handle}.js`,
      ],
      matchMode: "invalid_product_js",
      dosageForm: { lnhpd: row.dosageFormClass, shopify: top.shopifyForm ?? null },
    });
  }

  const resolvedShopifyForm = inferShopifyDosageForm({
    title: sanitize(productJs.title) || top.title,
    productType: sanitize(productJs.product_type) || top.suggestProductType,
    tags: productJs.tags,
    bodyHtml: productJs.body_html,
    body: productJs.body,
    handle: sanitize(productJs.handle) || top.handle,
    variants: productJs.variants,
  });

  if (!resolvedShopifyForm || resolvedShopifyForm !== row.dosageFormClass) {
    return withAllowlistFlag({
      npn: row.npn,
      brand: row.brandName,
      product: row.productName,
      status: "dosage_form_mismatch",
      reason: `Dosage form gate blocked: lnhpd=${row.dosageFormClass ?? "unknown"}, shopify=${resolvedShopifyForm ?? "unknown"}.`,
      evidence: [
        `${row.brandRule.siteBase}/products/${top.handle}`,
        `${row.brandRule.siteBase}/products/${top.handle}.js`,
      ],
      matchMode: "dosage_form_gate_block",
      dosageForm: { lnhpd: row.dosageFormClass, shopify: resolvedShopifyForm ?? null },
    });
  }

  const variantDecision = chooseVariantBarcode(productJs.variants, row.productName, row.dosageFormClass!, allowlistRule);

  if (!variantDecision.selected) {
    return withAllowlistFlag({
      npn: row.npn,
      brand: row.brandName,
      product: row.productName,
      status: "hold_ambiguous",
      reason:
        variantDecision.reason === "same_page_multi_upc_ambiguous" ||
        variantDecision.reason === "allowlist_hold_until_unique_spec_anchor" ||
        variantDecision.reason === "allowlist_anchor_conflict"
          ? "Top Shopify product has multiple UPC variants and spec attribution is not unique."
          : "No valid barcode in top Shopify .js payload.",
      candidateBarcodes: variantDecision.allCandidates.slice(0, 8),
      evidence: [
        `${row.brandRule.siteBase}/products/${top.handle}`,
        `${row.brandRule.siteBase}/products/${top.handle}.js`,
      ],
      matchMode: variantDecision.reason,
      dosageForm: { lnhpd: row.dosageFormClass, shopify: resolvedShopifyForm ?? null },
    });
  }

  const insertAction = await insertMapping({
    npn: row.npn,
    barcodeGtin14: variantDecision.selected.barcodeGtin14,
    barcodeRaw: variantDecision.selected.barcodeRaw,
    confidence: 0.88,
    source: SOURCE_TAG,
  });

  if (insertAction === "conflict") {
    return withAllowlistFlag({
      npn: row.npn,
      brand: row.brandName,
      product: row.productName,
      status: "skip_conflict",
      reason: "Barcode already mapped to a different NPN.",
      barcodeRaw: variantDecision.selected.barcodeRaw,
      barcodeGtin14: variantDecision.selected.barcodeGtin14,
      evidence: [
        `${row.brandRule.siteBase}/products/${top.handle}`,
        `${row.brandRule.siteBase}/products/${top.handle}.js`,
      ],
      matchMode: `${variantDecision.reason}_${variantDecision.selected.normalization}${
        usedDirectHandleFallback ? "_direct_handle" : ""
      }`,
      dosageForm: { lnhpd: row.dosageFormClass, shopify: resolvedShopifyForm ?? null },
    });
  }

  if (insertAction === "duplicate") {
    return withAllowlistFlag({
      npn: row.npn,
      brand: row.brandName,
      product: row.productName,
      status: "skip_duplicate",
      reason: "Barcode already exists for the same NPN.",
      barcodeRaw: variantDecision.selected.barcodeRaw,
      barcodeGtin14: variantDecision.selected.barcodeGtin14,
      evidence: [
        `${row.brandRule.siteBase}/products/${top.handle}`,
        `${row.brandRule.siteBase}/products/${top.handle}.js`,
      ],
      matchMode: `${variantDecision.reason}_${variantDecision.selected.normalization}${
        usedDirectHandleFallback ? "_direct_handle" : ""
      }`,
      dosageForm: { lnhpd: row.dosageFormClass, shopify: resolvedShopifyForm ?? null },
    });
  }

  await updateFactsBarcodeCandidates(row, {
    insertedBarcode: variantDecision.selected.barcodeGtin14,
    sourceTag: SOURCE_TAG,
    maxCount: maxCandidatesPerNpn,
    confidence: 0.88,
    evidence: `${row.brandRule.siteBase}/products/${top.handle}`,
    matchMode: `${variantDecision.reason}_${variantDecision.selected.normalization}${
      usedDirectHandleFallback ? "_direct_handle" : ""
    }`,
  });

  return withAllowlistFlag({
    npn: row.npn,
    brand: row.brandName,
    product: row.productName,
    status: "inserted_medium_confidence",
    reason: "Inserted from Shopify .js variant with dosage-form parity gate and conflict check.",
    confidence: 0.88,
    barcodeRaw: variantDecision.selected.barcodeRaw,
    barcodeGtin14: variantDecision.selected.barcodeGtin14,
    evidence: [
      `${row.brandRule.siteBase}/products/${top.handle}`,
      `${row.brandRule.siteBase}/products/${top.handle}.js`,
    ],
    matchMode: `${variantDecision.reason}_${variantDecision.selected.normalization}${
      usedDirectHandleFallback ? "_direct_handle" : ""
    }`,
    dosageForm: { lnhpd: row.dosageFormClass, shopify: resolvedShopifyForm ?? null },
  });
};

const preselectBatchTargets = async (
  candidates: CandidateRow[],
  targetSize: number,
): Promise<{
  selected: CandidateRow[];
  suggestCache: Map<string, ShopifySuggestProduct[]>;
}> => {
  const suggestCache = new Map<string, ShopifySuggestProduct[]>();
  const ranked: Array<{ row: CandidateRow; score: number }> = [];
  const rankedAll: Array<{ row: CandidateRow; score: number }> = [];

  // Recall expansion: scan deeper candidate window before keeping strict gates unchanged.
  const scanLimit = Math.min(Math.max(targetSize * 20, 600), candidates.length);
  for (const row of candidates.slice(0, scanLimit)) {
    const suggestProducts = await fetchShopifySuggestMerged(
      row.brandRule.siteBase,
      buildSearchQueries(row).slice(0, 2),
    );
    if (!suggestProducts.length) continue;
    suggestCache.set(row.npn, suggestProducts);

    const scored = suggestProducts
      .map((product) => {
        const title = sanitize(product.title);
        const handle = sanitize(product.handle) || normalizeHandleFromUrl(row.brandRule.siteBase, product.url);
        const shopifyForm = inferShopifyDosageForm({
          title,
          productType: sanitize(product.product_type),
          handle,
        });
        if (!title || !shopifyForm || !row.dosageFormClass || shopifyForm !== row.dosageFormClass) return 0;
        return bestNameSimilarity([...row.productLicenceAliases, row.productName].slice(0, 9), title);
      })
      .filter((value) => value > 0)
      .sort((a, b) => b - a);

    const topScore = scored[0] ?? 0;
    if (topScore > 0) {
      rankedAll.push({ row, score: topScore });
    }
    if (topScore < 0.35) continue;
    ranked.push({ row, score: topScore });
  }

  ranked.sort((a, b) => b.score - a.score);
  const selected = ranked.slice(0, targetSize).map((entry) => entry.row);
  if (selected.length < targetSize) {
    rankedAll.sort((a, b) => b.score - a.score);
    const chosen = new Set(selected.map((entry) => entry.npn));
    for (const entry of rankedAll) {
      const row = entry.row;
      if (chosen.has(row.npn)) continue;
      selected.push(row);
      chosen.add(row.npn);
      if (selected.length >= targetSize) break;
    }
  }
  return { selected, suggestCache };
};

const main = async () => {
  const mappedNpns = await loadMappedNpnSet();
  const specGapAllowlistByNpn = await loadSpecGapAllowlist();
  let selected: CandidateRow[] = [];
  let suggestCache = new Map<string, ShopifySuggestProduct[]>();
  let persistedFamilyHolds: Map<FamilyBucket, Set<string>>;
  let familyCandidates: CandidateRow[] = [];

  if (familyInputJsonArg) {
    const familyTargets = await loadFamilyInputTargets(familyInputJsonArg, familyBuckets);
    const rowMap = await loadRowsByNpns(familyTargets.map((entry) => entry.npn));
    const historyHandles = await loadKnownHandlesFromHistory();
    selected = familyTargets
      .map((entry) => {
        const row = rowMap.get(entry.npn);
        if (!row) return null;
        const brandName = sanitize(row.brand_name);
        const productName = sanitize(row.product_name);
        const brandRule = resolveBrandRuleForRow(brandName);
        const dosageFormClass = dosageFormFromText(productName);
        if (!brandRule || !dosageFormClass) return null;
        if (skipNpns.has(entry.npn)) return null;
        if (mappedNpns.has(entry.npn)) return null;
        const fromHistory = Array.from(historyHandles.get(entry.npn) ?? []);
        const hinted = entry.bucket ? FAMILY_HANDLE_HINTS[brandRule.key]?.[entry.bucket] ?? [] : [];
        const knownHandles = Array.from(new Set([...fromHistory, ...hinted])).slice(0, 6);
        return {
          npn: entry.npn,
          lnhpdId: row.lnhpd_id,
          brandName,
          productName,
          productLicenceAliases: extractProductLicenceAliases(row.facts_json),
          factsJson: row.facts_json,
          brandRule,
          dosageFormClass,
          familyBucket: entry.bucket,
          knownHandles,
        } satisfies CandidateRow;
      })
      .filter((value): value is CandidateRow => Boolean(value))
      .slice(0, batchSize);
    persistedFamilyHolds = await loadPersistedHoldFamilyNpns();
  } else {
    const pools = await buildCandidatePools();
    const { selected: preselected, suggestCache: preSuggest } = await preselectBatchTargets(
      pools.mainCandidates,
      batchSize,
    );
    selected = preselected;
    suggestCache = preSuggest;
    persistedFamilyHolds = pools.persistedFamilyHolds;
    familyCandidates = pools.familyCandidates;
  }

  const counters = {
    inserted: 0,
    held: 0,
    rejected: 0,
    conflict: 0,
    duplicate: 0,
    dosageGateBlocked: 0,
    allowlistAppliedCount: 0,
    allowlistReleasedCount: 0,
    allowlistHeldCount: 0,
  };

  const results: BatchResult[] = [];
  for (const row of selected) {
    try {
      const result = await evaluateCandidate(
        row,
        suggestCache.get(row.npn),
        specGapAllowlistByNpn.get(row.npn) ?? null,
      );
      results.push(result);

      if (result.status.startsWith("inserted")) counters.inserted += 1;
      else if (result.status === "hold_ambiguous") counters.held += 1;
      else if (result.status === "skip_conflict") counters.conflict += 1;
      else if (result.status === "skip_duplicate") counters.duplicate += 1;
      else if (result.status === "dosage_form_mismatch") counters.dosageGateBlocked += 1;
      else counters.rejected += 1;

      const allowlistDeltas = deriveAllowlistCounterDeltas(result);
      counters.allowlistAppliedCount += allowlistDeltas.allowlistAppliedCount;
      counters.allowlistReleasedCount += allowlistDeltas.allowlistReleasedCount;
      counters.allowlistHeldCount += allowlistDeltas.allowlistHeldCount;
    } catch (error) {
      const allowlistApplied = Boolean(specGapAllowlistByNpn.get(row.npn));
      results.push({
        npn: row.npn,
        brand: row.brandName,
        product: row.productName,
        status: "no_qualifying_evidence",
        reason: `exception: ${error instanceof Error ? error.message : String(error)}`,
        evidence: [],
        matchMode: "exception",
        allowlistApplied,
        dosageForm: { lnhpd: row.dosageFormClass, shopify: null },
      });
      counters.rejected += 1;
      if (allowlistApplied) counters.allowlistAppliedCount += 1;
    }
  }

  const familyByBucket: Record<FamilyBucket, Array<{ npn: string; brand: string; product: string }>> = {
    bee_propolis: [],
    ginseng: [],
    primadophilus: [],
  };

  for (const row of familyCandidates) {
    if (!row.familyBucket) continue;
    familyByBucket[row.familyBucket].push({
      npn: row.npn,
      brand: row.brandName,
      product: row.productName,
    });
  }

  const persistedTargets: Record<FamilyBucket, Array<{ npn: string; brand: string; product: string }>> = {
    bee_propolis: [],
    ginseng: [],
    primadophilus: [],
  };

  for (const bucket of ["bee_propolis", "ginseng", "primadophilus"] as const) {
    const npns = Array.from(persistedFamilyHolds.get(bucket) ?? []).slice(0, familyBucketSize);
    if (npns.length === 0) continue;
    const rowMap = await loadRowsByNpns(npns);
    for (const npn of npns) {
      const row = rowMap.get(npn);
      persistedTargets[bucket].push({
        npn,
        brand: sanitize(row?.brand_name) || "unknown",
        product: sanitize(row?.product_name) || "unknown",
      });
    }
  }

  const mergeBucketTargets = (
    persisted: Array<{ npn: string; brand: string; product: string }>,
    fresh: Array<{ npn: string; brand: string; product: string }>,
  ) => {
    const seen = new Set<string>();
    const merged: Array<{ npn: string; brand: string; product: string }> = [];
    for (const row of [...persisted, ...fresh]) {
      if (seen.has(row.npn)) continue;
      seen.add(row.npn);
      merged.push(row);
      if (merged.length >= familyBucketSize) break;
    }
    return merged;
  };

  const familyBucketPayload = {
    batch: "manual_review_family_bucket",
    generatedAt: new Date().toISOString(),
    policy: {
      strategy: "separate_family_bucket_for_persistent_holds",
      families: ["Bee Propolis", "Ginseng", "Primadophilus"],
      note: "Excluded from main next20 to avoid diluting insertion rate.",
    },
    persistedHoldCounts: {
      bee_propolis: persistedFamilyHolds.get("bee_propolis")?.size ?? 0,
      ginseng: persistedFamilyHolds.get("ginseng")?.size ?? 0,
      primadophilus: persistedFamilyHolds.get("primadophilus")?.size ?? 0,
    },
    nextFamilyTargets: {
      bee_propolis: mergeBucketTargets(persistedTargets.bee_propolis, familyByBucket.bee_propolis),
      ginseng: mergeBucketTargets(persistedTargets.ginseng, familyByBucket.ginseng),
      primadophilus: mergeBucketTargets(persistedTargets.primadophilus, familyByBucket.primadophilus),
    },
  };

  const payload = {
    batch: familyInputJsonArg
      ? "manual_review_family_bucket_shopify_js_priority_dosage_gate_v1"
      : "manual_review_next20_shopify_js_priority_dosage_gate_v1",
    policyVersion: "v1.2",
    startedAt: now.toISOString(),
    completedAt: new Date().toISOString(),
    dryRun,
    targets: selected.map((row) => row.npn),
    policy: {
      highConfidence: "same-page explicit NPN + UPC + product match",
      mediumConfidence: "brand + strong Shopify product match + unique variant attribution + dosage form parity",
      sourceTag: SOURCE_TAG,
      maxBarcodeCandidatesPerNpn: maxCandidatesPerNpn,
      conflictRule: "skip when barcode_gtin14 exists for different npn",
      strategy: "shopify_suggest_json_and_product_js_priority",
      newGates: {
        dosageFormParityRequired: true,
        upc11LeadingZeroNormalization: true,
        familyBucketIsolation: true,
      },
      familyInput: familyInputJsonArg
        ? {
            path: path.isAbsolute(familyInputJsonArg)
              ? familyInputJsonArg
              : path.resolve(repoRoot, familyInputJsonArg),
            buckets: familyBuckets.length > 0 ? familyBuckets : ["bee_propolis", "ginseng", "primadophilus"],
          }
        : null,
      specGapAllowlist: specGapWhitelistJsonArg
        ? {
            path: path.isAbsolute(specGapWhitelistJsonArg)
              ? specGapWhitelistJsonArg
              : path.resolve(repoRoot, specGapWhitelistJsonArg),
            entries: specGapAllowlistByNpn.size,
            releaseRule: "HOLD_UNTIL_UNIQUE_SPEC_ANCHOR",
          }
        : null,
      skipNpns: Array.from(skipNpns),
      thresholds: {
        minSimilarity,
        tieDelta,
      },
    },
    counters,
    results,
    artifacts: {
      familyBucketJson,
    },
  };

  await writeJson(outJson, payload);
  await writeJson(familyBucketJson, familyBucketPayload);

  console.log(
    JSON.stringify(
      {
        outJson,
        familyBucketJson,
        targets: selected.length,
        counters,
      },
      null,
      2,
    ),
  );
};

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  main().catch((error) => {
    console.error("[manual-shopify-batch] fatal", error instanceof Error ? error.message : String(error));
    process.exit(1);
  });
}
