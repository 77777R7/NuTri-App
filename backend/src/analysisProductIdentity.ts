export type AnalysisProductIdentitySourceAttribution =
  | "verified_regulatory"
  | "label_record"
  | "web_hint_unverified"
  | "unknown";

export type AnalysisProductIdentity = {
  name: string | null;
  brand: string | null;
  sourceAttribution: AnalysisProductIdentitySourceAttribution;
  identityStable: boolean;
  sourceId: string | null;
};

export type AnalysisProductIdentityOverlayClaims = {
  provider?: string | null;
  productId?: string | null;
  barcodeGtin14?: string | null;
  upcCode?: string | null;
  brandName?: string | null;
  title?: string | null;
  link?: string | null;
};

const normalizeText = (value: unknown): string =>
  typeof value === "string" ? value.trim().replace(/\s+/g, " ") : "";

const normalizeBarcode = (value: unknown): string => {
  const digits = String(value ?? "").replace(/\D/g, "");
  if (!digits) return "";
  return digits.padStart(14, "0").slice(-14);
};

const PRODUCT_FAMILY_RE =
  /\b(vitamin|multi[\s-]?vitamin|mineral|magnesium|calcium|zinc|iron|omega|probiotic|prebiotic|protein|collagen|fiber|glucosamine|melatonin|sleep|hydration|electrolyte|drink\s+mix|capsule|tablet|caplet|softgel|gumm(?:y|ies)|powder|formula|blend|complex|support)\b/i;

const WEAK_VARIANT_RE =
  /\b(berry|raspberry|strawberry|blueberry|orange|lemon|lime|tangerine|grapefruit|grape|cherry|peach|mango|vanilla|chocolate|mixed\s+berry|variety\s+pack|unflavored)\b/i;

const hasProductFamilyCue = (value: string): boolean => PRODUCT_FAMILY_RE.test(value);

const looksLikeWeakVariantOnlyName = (name: string): boolean => {
  const normalized = normalizeText(name);
  if (!normalized) return true;
  if (hasProductFamilyCue(normalized)) return false;
  const tokens = normalized.split(/\s+/).filter(Boolean);
  if (tokens.length <= 2 && WEAK_VARIANT_RE.test(normalized)) return true;
  return tokens.length <= 1;
};

const buildOverlayProductIdentity = (
  overlayClaims: AnalysisProductIdentityOverlayClaims | null | undefined,
  barcodeGtin14: string | null | undefined,
): AnalysisProductIdentity | null => {
  const name = normalizeText(overlayClaims?.title);
  const brand = normalizeText(overlayClaims?.brandName);
  if (!name && !brand) return null;

  const productId = normalizeText(overlayClaims?.productId);
  const overlayBarcode = normalizeBarcode(overlayClaims?.barcodeGtin14 || overlayClaims?.upcCode);
  const requestBarcode = normalizeBarcode(barcodeGtin14);
  const sourceId = productId
    ? `iherb:${productId}`
    : requestBarcode || overlayBarcode
      ? `gtin14:${requestBarcode || overlayBarcode}`
      : null;

  return {
    name: name || null,
    brand: brand || null,
    sourceAttribution: "label_record",
    identityStable: Boolean(name) && Boolean(requestBarcode ? overlayBarcode === requestBarcode : overlayBarcode || productId),
    sourceId,
  };
};

export const resolvePreferredAnalysisProductIdentity = (params: {
  digestIdentity: AnalysisProductIdentity | null | undefined;
  overlayClaims?: AnalysisProductIdentityOverlayClaims | null;
  barcodeGtin14?: string | null;
}): AnalysisProductIdentity | null => {
  const digestIdentity = params.digestIdentity ?? null;
  const overlayIdentity = buildOverlayProductIdentity(params.overlayClaims, params.barcodeGtin14);
  if (!digestIdentity) return overlayIdentity;
  if (!overlayIdentity) return digestIdentity;

  const digestName = normalizeText(digestIdentity.name);
  const overlayName = normalizeText(overlayIdentity.name);
  const overlayHasProductFamily = hasProductFamilyCue(overlayName);
  const digestIsWeakDisplayName = looksLikeWeakVariantOnlyName(digestName);

  if (
    digestIdentity.sourceAttribution === "verified_regulatory"
    && digestIdentity.identityStable
    && digestIsWeakDisplayName
    && overlayIdentity.identityStable
    && overlayHasProductFamily
  ) {
    return overlayIdentity;
  }

  return digestIdentity;
};
