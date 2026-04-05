import type { TrustedDisplayIdentity } from '@/lib/scan/resolveTrustedDisplayIdentity';
import type { AnalysisBundle } from '@/types/analysisBundle';

export type VerificationStatus = 'pending' | 'final' | 'likely' | 'web_only';
export type SourceDataset = 'lnhpd' | 'dsld' | 'label_record' | 'web_only' | 'unknown';

export type VerificationPresentation = {
  sourceDataset: SourceDataset;
  verificationStatus: VerificationStatus;
  blocked: boolean;
  blockedReasons: string[];
  degraded: boolean;
  copyTokens: {
    badgeLabel: string;
    sourceCopy: string;
    sourceBullets: string[];
    overviewSubtitle: string;
    factsCardTitle: string;
    overviewLead: string;
    evidencePillLabel: string;
    datasetLabel: string;
  };
};

type BuildVerificationPresentationParams = {
  meta: AnalysisBundle['meta'] | null | undefined;
  trustedIdentity: TrustedDisplayIdentity;
  isStreaming: boolean;
};

const normalizeText = (value: unknown): string => (typeof value === 'string' ? value.trim() : '');

const BLOCKED_FALLBACK_MARKERS = [
  'needs_js',
  'ownership_unverified',
  'web_text_unusable',
];

const resolveSourceDataset = (
  meta: AnalysisBundle['meta'] | null | undefined,
  trustedIdentity: TrustedDisplayIdentity,
): SourceDataset => {
  const sourceType = typeof meta?.sourceType === 'string' ? meta.sourceType : '';
  if (trustedIdentity.sourceAttributionUsed === 'label_record') return 'label_record';
  if (sourceType === 'lnhpd') return 'lnhpd';
  if (sourceType === 'dsld') return 'dsld';
  if (
    trustedIdentity.sourceAttributionUsed === 'web_hint_unverified' ||
    trustedIdentity.sourceAttributionUsed === 'unknown' ||
    sourceType === 'web'
  ) {
    return 'web_only';
  }
  return 'unknown';
};

const resolveSourceTypeFinal = (meta: AnalysisBundle['meta'] | null | undefined): boolean => {
  return meta?.sourceTypeFinal === true;
};

const resolveDatasetLabel = (dataset: SourceDataset): string => {
  if (dataset === 'lnhpd') return 'LNHPD';
  if (dataset === 'dsld') return 'DSLD';
  if (dataset === 'label_record') return 'label record';
  if (dataset === 'web_only') return 'unverified web hints';
  return 'available source signals';
};

export const buildVerificationPresentation = (
  params: BuildVerificationPresentationParams,
): VerificationPresentation => {
  const { meta, trustedIdentity, isStreaming } = params;
  const terminalReason = normalizeText(meta?.terminalReason).toUpperCase();
  const fallbackReason = normalizeText(meta?.fallbackReason).toLowerCase();
  const sourceDataset = resolveSourceDataset(meta, trustedIdentity);

  const degraded =
    meta?.degradedMode === true ||
    terminalReason.startsWith('DEGRADED_') ||
    terminalReason === 'BUNDLE_ONLY_NO_AUTHORITATIVE_MATCH';

  const blockedReasons: string[] = [];
  if (degraded) blockedReasons.push('degraded_terminal');
  for (const marker of BLOCKED_FALLBACK_MARKERS) {
    if (fallbackReason.includes(marker)) {
      blockedReasons.push(`fallback_${marker}`);
    }
  }
  if (
    trustedIdentity.sourceAttributionUsed === 'web_hint_unverified' ||
    trustedIdentity.sourceAttributionUsed === 'unknown'
  ) {
    blockedReasons.push('web_hint_attribution');
  }
  const blocked = blockedReasons.length > 0;

  const pending = isStreaming || (trustedIdentity.identityPending === true && terminalReason.length === 0);
  const sourceTypeFinal = resolveSourceTypeFinal(meta);
  const trustedDisplay = trustedIdentity.displayIdentityMode === 'trusted';
  const authoritativeDataset =
    sourceDataset === 'lnhpd' || sourceDataset === 'dsld' || sourceDataset === 'label_record';

  const final =
    !pending &&
    !blocked &&
    trustedDisplay &&
    sourceTypeFinal &&
    authoritativeDataset;
  const likely = !pending && !final && authoritativeDataset;
  const verificationStatus: VerificationStatus = pending
    ? 'pending'
    : final
      ? 'final'
      : likely
        ? 'likely'
        : 'web_only';

  const datasetLabel = resolveDatasetLabel(sourceDataset);

  if (verificationStatus === 'final') {
    return {
      sourceDataset,
      verificationStatus,
      blocked,
      blockedReasons,
      degraded,
      copyTokens: {
        badgeLabel: 'Label verified',
        sourceCopy: 'This analysis is based on verified record data. Scan Supplement Facts for richer product-level detail.',
        sourceBullets: [
          'Based on verified record data.',
          'Scan the Supplement Facts panel for richer product-level insights.',
        ],
        overviewSubtitle: 'Product-level context from verified record',
        factsCardTitle: 'What we verified',
        overviewLead: `Analyzed from ${datasetLabel}.`,
        evidencePillLabel: 'Label facts',
        datasetLabel,
      },
    };
  }

  if (verificationStatus === 'likely') {
    return {
      sourceDataset,
      verificationStatus,
      blocked,
      blockedReasons,
      degraded,
      copyTokens: {
        badgeLabel: 'Likely match',
        sourceCopy: 'We found a likely match in a verified dataset, but confidence is limited. Verify details on the package label.',
        sourceBullets: [
          `Likely matched ${datasetLabel}.`,
          'Label coverage or ownership is not fully verified yet.',
        ],
        overviewSubtitle: 'Product-level context from likely matched record',
        factsCardTitle: 'What we found',
        overviewLead: `Likely matched ${datasetLabel} record.`,
        evidencePillLabel: 'Label facts',
        datasetLabel,
      },
    };
  }

  if (verificationStatus === 'pending') {
    return {
      sourceDataset,
      verificationStatus,
      blocked,
      blockedReasons,
      degraded,
      copyTokens: {
        badgeLabel: 'Verifying source',
        sourceCopy: 'We are still verifying source confidence for this product.',
        sourceBullets: [
          'Verification is still in progress.',
          'Facts shown now are provisional and can refine shortly.',
        ],
        overviewSubtitle: 'Product context is still being verified',
        factsCardTitle: 'What we observed',
        overviewLead: `Verification in progress using ${datasetLabel}.`,
        evidencePillLabel: sourceDataset === 'web_only' ? 'Web evidence' : 'Label facts',
        datasetLabel,
      },
    };
  }

  return {
    sourceDataset,
    verificationStatus,
    blocked,
    blockedReasons,
    degraded,
    copyTokens: {
      badgeLabel: 'Web hint (unverified)',
      sourceCopy: 'This analysis is based on unverified web hints. Confirm details on the package label.',
      sourceBullets: [
        'Based on unverified web hints.',
        'Scan the Supplement Facts panel to confirm product-level details.',
      ],
      overviewSubtitle: 'Product-level context from unverified web hints',
      factsCardTitle: 'What we observed',
      overviewLead: `Analyzed from ${datasetLabel}.`,
      evidencePillLabel: 'Web evidence',
      datasetLabel,
    },
  };
};
