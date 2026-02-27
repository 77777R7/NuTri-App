import type { AnalysisBundle } from '@/types/analysisBundle';

export type DisplayIdentityMode =
  | 'pending'
  | 'unverified'
  | 'trusted';

export type DisplayIdentitySourceAttribution =
  | 'verified_regulatory'
  | 'label_record'
  | 'web_hint_unverified'
  | 'unknown';

type IdentitySource = {
  domain?: string | null;
  url?: string | null;
  link?: string | null;
};

type AuthoritativeIdentity = {
  type?: string | null;
  value?: string | null;
};

type ResolveTrustedDisplayIdentityParams = {
  bundleMeta?: AnalysisBundle['meta'] | null;
  productName?: string | null;
  productSubtitle?: string | null;
  barcode?: string | null;
  sourceAttributionHint?: DisplayIdentitySourceAttribution | null;
  sourceTypeHint?: string | null;
  authoritativeIdentity?: AuthoritativeIdentity | null;
  sources?: IdentitySource[] | null;
  showDebugWebHintSource?: boolean;
};

type BundleProductIdentity = {
  name?: string | null;
  brand?: string | null;
  sourceAttribution?: DisplayIdentitySourceAttribution | null;
  identityStable?: boolean | null;
  sourceId?: string | null;
};

export type TrustedDisplayIdentity = {
  title: string;
  subtitle: string;
  displayIdentityMode: DisplayIdentityMode;
  sourceAttributionUsed: DisplayIdentitySourceAttribution;
  titleSanitized: boolean;
  identityPending: boolean;
};

const normalizeText = (value: unknown): string =>
  typeof value === 'string' ? value.trim() : '';

const normalizeBarcode = (value: unknown): string => {
  const digits = String(value ?? '').replace(/\D/g, '');
  if (!digits) return '';
  if (digits.length >= 14) return digits.slice(-14);
  return digits.padStart(14, '0');
};

const resolveSourceAttribution = (
  bundleMeta: AnalysisBundle['meta'] | null | undefined,
  bundleProductIdentity: BundleProductIdentity | null | undefined,
  sourceAttributionHint: DisplayIdentitySourceAttribution | null | undefined,
  sourceTypeHint: string | null | undefined,
): DisplayIdentitySourceAttribution => {
  if (
    bundleProductIdentity?.sourceAttribution === 'verified_regulatory'
    || bundleProductIdentity?.sourceAttribution === 'label_record'
    || bundleProductIdentity?.sourceAttribution === 'web_hint_unverified'
  ) {
    return bundleProductIdentity.sourceAttribution;
  }
  if (
    sourceAttributionHint === 'verified_regulatory'
    || sourceAttributionHint === 'label_record'
    || sourceAttributionHint === 'web_hint_unverified'
  ) {
    return sourceAttributionHint;
  }
  const winnerAttribution = normalizeStage0WinnerAttribution(
    normalizeText((bundleMeta as any)?.stage0Winner),
  );
  const replaceCountRaw = Number((bundleMeta as any)?.stage0ReplaceCount);
  const replaceCount = Number.isFinite(replaceCountRaw) ? replaceCountRaw : null;
  if (
    (winnerAttribution === 'verified_regulatory' || winnerAttribution === 'label_record')
    && (replaceCount === null || replaceCount === 0)
  ) {
    return winnerAttribution;
  }
  const sourceType = normalizeText(bundleMeta?.sourceType || sourceTypeHint).toLowerCase();
  if (sourceType === 'lnhpd' || sourceType === 'dsld') return 'verified_regulatory';
  if (sourceType === 'label' || sourceType === 'label_scan') return 'label_record';
  if (sourceType === 'web') return 'web_hint_unverified';
  return 'unknown';
};

const resolveSourceTypeFinal = (bundleMeta: AnalysisBundle['meta'] | null | undefined): boolean => {
  if (bundleMeta?.sourceTypeFinal === true) return true;
  if (bundleMeta?.sourceTypeFinal === false) return false;
  const revision = Number(bundleMeta?.revision);
  return Number.isFinite(revision) && revision >= 1;
};

const resolveBundleProductIdentity = (
  bundleMeta: AnalysisBundle['meta'] | null | undefined,
): BundleProductIdentity | null => {
  const row = (bundleMeta as any)?.productIdentity;
  if (!row || typeof row !== 'object') return null;
  const sourceAttribution = normalizeText((row as any).sourceAttribution);
  const normalizedAttribution =
    sourceAttribution === 'verified_regulatory'
    || sourceAttribution === 'label_record'
    || sourceAttribution === 'web_hint_unverified'
      ? sourceAttribution
      : null;
  const name = normalizeText((row as any).name);
  const brand = normalizeText((row as any).brand);
  const sourceId = normalizeText((row as any).sourceId);
  const identityStable = (row as any).identityStable === true;
  if (!name && !brand && !sourceId && !normalizedAttribution) return null;
  return {
    name: name || null,
    brand: brand || null,
    sourceAttribution: normalizedAttribution as DisplayIdentitySourceAttribution | null,
    identityStable,
    sourceId: sourceId || null,
  };
};

const normalizeStage0WinnerAttribution = (
  winnerRaw: string,
): DisplayIdentitySourceAttribution => {
  const winner = normalizeText(winnerRaw).toLowerCase();
  if (!winner) return 'unknown';
  if (
    winner.includes('verified_regulatory')
    || winner.includes('lnhpd')
    || winner.includes('dsld')
    || winner.includes('regulatory')
  ) {
    return 'verified_regulatory';
  }
  if (winner.includes('label')) return 'label_record';
  if (winner.includes('web')) return 'web_hint_unverified';
  return 'unknown';
};

const isTrustedIdentityStable = (
  bundleMeta: AnalysisBundle['meta'] | null | undefined,
  sourceAttribution: DisplayIdentitySourceAttribution,
): boolean => {
  if (!(sourceAttribution === 'verified_regulatory' || sourceAttribution === 'label_record')) {
    return false;
  }
  if (resolveSourceTypeFinal(bundleMeta)) return true;
  const replaceCountRaw = Number((bundleMeta as any)?.stage0ReplaceCount);
  const replaceCount = Number.isFinite(replaceCountRaw) ? replaceCountRaw : null;
  if (replaceCount !== null && replaceCount !== 0) return false;
  const winnerAttribution = normalizeStage0WinnerAttribution(
    normalizeText((bundleMeta as any)?.stage0Winner),
  );
  return winnerAttribution === sourceAttribution;
};

const extractBestDomain = (sources: IdentitySource[] | null | undefined): string => {
  if (!Array.isArray(sources)) return '';
  for (const source of sources) {
    const explicit = normalizeText(source?.domain).replace(/^www\./i, '');
    if (explicit) return explicit;
    const fromUrl = normalizeText(source?.url || source?.link);
    if (!fromUrl) continue;
    try {
      return new URL(fromUrl).hostname.replace(/^www\./i, '');
    } catch {
      continue;
    }
  }
  return '';
};

const resolveAuthoritativeBarcode = (
  barcode: string | null | undefined,
  authoritativeIdentity: AuthoritativeIdentity | null | undefined,
  bundleMeta: AnalysisBundle['meta'] | null | undefined,
): string => {
  const normalizedDirect = normalizeBarcode(barcode);
  if (normalizedDirect) return normalizedDirect;

  const normalizedBundleBarcode = normalizeBarcode((bundleMeta as any)?.normalized_gtin14);
  if (normalizedBundleBarcode) return normalizedBundleBarcode;

  const normalizedBundleBarcodeAlt = normalizeBarcode((bundleMeta as any)?.normalizedGtin14);
  if (normalizedBundleBarcodeAlt) return normalizedBundleBarcodeAlt;

  const normalizedBundleMetaIdentityType = normalizeText((bundleMeta as any)?.authoritativeIdentity?.type).toLowerCase();
  if (
    normalizedBundleMetaIdentityType === 'gtin14'
    || normalizedBundleMetaIdentityType === 'upc'
    || normalizedBundleMetaIdentityType === 'ean'
  ) {
    const normalizedBundleMetaIdentityValue = normalizeBarcode((bundleMeta as any)?.authoritativeIdentity?.value);
    if (normalizedBundleMetaIdentityValue) return normalizedBundleMetaIdentityValue;
  }

  const normalizedIdentityType = normalizeText(authoritativeIdentity?.type).toLowerCase();
  if (normalizedIdentityType === 'gtin14' || normalizedIdentityType === 'upc' || normalizedIdentityType === 'ean') {
    const normalizedIdentityValue = normalizeBarcode(authoritativeIdentity?.value);
    if (normalizedIdentityValue) return normalizedIdentityValue;
  }
  return '';
};

export const resolveTrustedDisplayIdentity = (
  params: ResolveTrustedDisplayIdentityParams,
): TrustedDisplayIdentity => {
  const bundleProductIdentity = resolveBundleProductIdentity(params.bundleMeta);
  const sourceAttribution = resolveSourceAttribution(
    params.bundleMeta,
    bundleProductIdentity,
    params.sourceAttributionHint,
    params.sourceTypeHint,
  );
  const sourceTypeFinal = resolveSourceTypeFinal(params.bundleMeta);
  const revision = Number(params.bundleMeta?.revision);
  const trusted = sourceAttribution === 'verified_regulatory' || sourceAttribution === 'label_record';
  const trustedStable = isTrustedIdentityStable(params.bundleMeta, sourceAttribution);
  const safeName = normalizeText(bundleProductIdentity?.name || params.productName);
  const safeSubtitle = normalizeText(bundleProductIdentity?.brand || params.productSubtitle);
  const explicitIdentityStable = bundleProductIdentity?.identityStable === true;
  const trustedRegulatoryEarly =
    sourceAttribution === 'verified_regulatory'
    && safeName.length > 0
    && (
      explicitIdentityStable
      || trustedStable
      || !bundleProductIdentity
      || bundleProductIdentity.sourceAttribution === 'verified_regulatory'
    );
  const trustedLabelStable =
    sourceAttribution === 'label_record'
    && safeName.length > 0
    && (explicitIdentityStable || trustedStable);
  const trustedDisplayReady = trustedRegulatoryEarly || trustedLabelStable;
  const identityPending =
    sourceAttribution === 'unknown'
    || (sourceAttribution === 'web_hint_unverified' && !sourceTypeFinal)
    || (sourceAttribution === 'label_record' && safeName.length > 0 && !trustedStable)
    || (trusted && !safeName);
  if (trustedDisplayReady) {
    return {
      title: safeName,
      subtitle: safeSubtitle,
      displayIdentityMode: 'trusted',
      sourceAttributionUsed: sourceAttribution,
      titleSanitized: false,
      identityPending,
    };
  }

  const authoritativeBarcode = resolveAuthoritativeBarcode(
    params.barcode,
    params.authoritativeIdentity,
    params.bundleMeta,
  );

  if (identityPending) {
    const pendingTitle =
      Number.isFinite(revision) && revision >= 1 ? 'Fetching results...' : 'Analyzing barcode...';
    const pendingSubtitle = authoritativeBarcode
      ? `UPC: ${authoritativeBarcode}`
      : trusted
        ? 'Preparing verified product identity.'
        : 'Identifying product details.';
    return {
      title: pendingTitle,
      subtitle: pendingSubtitle,
      displayIdentityMode: 'pending',
      sourceAttributionUsed: sourceAttribution,
      titleSanitized: true,
      identityPending: true,
    };
  }

  const bestDomain = extractBestDomain(params.sources);
  const debugSuffix =
    params.showDebugWebHintSource && sourceAttribution === 'web_hint_unverified'
      ? bestDomain
        ? ` · Web hint from ${bestDomain} (unverified)`
        : ' · Web hint (unverified)'
      : '';

  if (authoritativeBarcode) {
    return {
      title: 'Unverified barcode',
      subtitle: `UPC: ${authoritativeBarcode} (unverified)${debugSuffix}`,
      displayIdentityMode: 'unverified',
      sourceAttributionUsed: sourceAttribution,
      titleSanitized: true,
      identityPending,
    };
  }

  return {
    title: 'Unknown product',
    subtitle: `Unknown product (unverified)${debugSuffix}`,
    displayIdentityMode: 'unverified',
    sourceAttributionUsed: sourceAttribution,
    titleSanitized: true,
    identityPending,
  };
};
