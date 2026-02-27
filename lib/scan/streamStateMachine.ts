import type { AnalysisBundle } from '../../types/analysisBundle';

export type AnalysisStatus = 'idle' | 'loading' | 'streaming' | 'complete' | 'not_found' | 'error';
export type ErrorKind = 'none' | 'not_found' | 'unauthorized' | 'network' | 'server';

type ParsedStreamError =
  | {
    kind: 'not_found';
    message: string;
    reasonCode: string | null;
    stage: string | null;
  }
  | {
    kind: 'unauthorized' | 'network' | 'server';
    message: string;
    reasonCode: string | null;
    stage: string | null;
  };

type DoneResultState = {
  analysisBundle: AnalysisBundle | null;
};

type PartialCompletionState = {
  analysisBundle: AnalysisBundle | null;
  productInfo?: { name?: string | null; brand?: string | null } | null;
  brandExtraction?: { product?: string | null; brand?: string | null } | null;
  sources?: unknown[] | null;
  efficacy?: unknown;
  safety?: unknown;
  usage?: unknown;
  value?: unknown;
  social?: unknown;
};

const CORE_SECTION_KEYS = ['overview', 'ingredients', 'usage', 'safety'] as const;
const TERMINAL_STATUSES: ReadonlySet<AnalysisStatus> = new Set(['not_found', 'error', 'complete']);
const PARTIAL_COMPLETE_REASON_CODES = new Set([
  'GLOBAL_TIMEOUT_REV0_ONLY',
  'REV1_WATCHDOG_TIMEOUT',
  'DONE_MISSING_FALLBACK',
  'DEGRADED_WEB_BUDGET',
  'DEGRADED_EVENTLOOP',
  'BUNDLE_ONLY_NO_AUTHORITATIVE_MATCH',
]);
const REASON_CODE_USER_COPY: Record<string, string> = {
  SERVER_OVERLOAD: 'Server is busy right now. Please retry in a moment.',
  STREAM_BUSY: 'Server is busy right now. Please retry in a moment.',
  QUEUE_FULL: 'Server is busy right now. Please retry in a moment.',
  QUEUE_WAIT_TIMEOUT: 'Server is busy right now. Please retry in a moment.',
  DEGRADED_WEB_BUDGET: 'Showing partial results while we keep response times stable.',
  DEGRADED_EVENTLOOP: 'Showing partial results while system load is high.',
  BUNDLE_ONLY_NO_AUTHORITATIVE_MATCH: 'Showing partial results because no authoritative match was confirmed yet.',
  REV1_WATCHDOG_TIMEOUT: 'Showing partial results because the stream timed out before done.',
  DONE_MISSING_FALLBACK: 'Showing partial results because completion signal was missing.',
  INSUFFICIENT_RECORD_DATA: 'This verified record does not include enough ingredient amount fields to score yet.',
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null;

const toOptionalString = (value: unknown): string | null =>
  typeof value === 'string' && value.trim().length > 0 ? value.trim() : null;

const readSectionDataStatus = (
  bundle: AnalysisBundle,
  section: (typeof CORE_SECTION_KEYS)[number],
): string | null => {
  const status = (bundle as Record<string, any>)?.sections?.[section]?.dataStatus;
  return typeof status === 'string' ? status : null;
};

const isLikelyNetworkError = (message: string): boolean => {
  const normalized = message.toLowerCase();
  return (
    normalized.includes('network')
    || normalized.includes('connect')
    || normalized.includes('connection')
    || normalized.includes('timed out')
    || normalized.includes('timeout')
    || normalized.includes('dns')
    || normalized.includes('offline')
    || normalized.includes('socket')
    || normalized.includes('failed to fetch')
  );
};

const parseNotFoundPayload = (payload: unknown): {
  code: string | null;
  stage: string | null;
  reasonCode: string | null;
  message: string | null;
} | null => {
  if (!isRecord(payload)) return null;
  return {
    code: toOptionalString(payload.code),
    stage: toOptionalString(payload.stage),
    reasonCode: toOptionalString(payload.reasonCode),
    message: toOptionalString(payload.message),
  };
};

export const isUsableResultBundle = (bundle: AnalysisBundle | null | undefined): boolean => {
  if (!bundle?.meta) return false;
  if (!Number.isFinite(bundle.meta.revision) || bundle.meta.revision < 1) return false;
  const coreStatuses = CORE_SECTION_KEYS
    .map((section) => readSectionDataStatus(bundle, section))
    .filter((status): status is string => Boolean(status));
  if (coreStatuses.length !== CORE_SECTION_KEYS.length) return false;
  return !coreStatuses.every((status) => status === 'pending');
};

export const resolveTerminalStatus = (params: {
  previousStatus: AnalysisStatus;
  nextStatus: AnalysisStatus;
}): AnalysisStatus => {
  if (
    TERMINAL_STATUSES.has(params.previousStatus)
    && params.previousStatus !== params.nextStatus
  ) {
    return params.previousStatus;
  }
  return params.nextStatus;
};

export const resolveDoneTerminalStatus = (state: DoneResultState): 'complete' | 'error' =>
  isUsableResultBundle(state.analysisBundle)
    ? 'complete'
    : 'error';

const hasBundleCoverData = (bundle: AnalysisBundle | null | undefined): boolean => {
  if (!bundle || typeof bundle !== 'object') return false;
  const sections = (bundle as Record<string, any>)?.sections;
  if (!sections || typeof sections !== 'object') return false;
  const overviewSummary = sections?.overview?.cover?.summary;
  if (typeof overviewSummary === 'string' && overviewSummary.trim().length > 0) return true;
  const overviewBullets = sections?.overview?.cover?.bullets;
  if (Array.isArray(overviewBullets) && overviewBullets.length > 0) return true;
  return false;
};

export const hasMeaningfulPartialData = (state: PartialCompletionState): boolean => {
  const hasProductIdentity =
    Boolean(state.productInfo?.name?.trim()) || Boolean(state.productInfo?.brand?.trim());
  const hasBrandExtraction =
    Boolean(state.brandExtraction?.product?.trim()) || Boolean(state.brandExtraction?.brand?.trim());
  const hasSources = Array.isArray(state.sources) && state.sources.length > 0;
  const hasLegacyPanels =
    Boolean(state.efficacy) || Boolean(state.safety) || Boolean(state.usage) || Boolean(state.value) || Boolean(state.social);
  const hasUsableBundle = isUsableResultBundle(state.analysisBundle);
  const hasCoverData = hasBundleCoverData(state.analysisBundle);

  return hasProductIdentity || hasBrandExtraction || hasSources || hasLegacyPanels || hasUsableBundle || hasCoverData;
};

export const shouldTreatStreamErrorAsPartialComplete = (params: {
  reasonCode?: string | null;
  state: PartialCompletionState;
}): boolean => {
  const reason = String(params.reasonCode ?? '').trim().toUpperCase();
  if (!PARTIAL_COMPLETE_REASON_CODES.has(reason)) return false;
  return hasMeaningfulPartialData(params.state);
};

export const parseStreamErrorEvent = (params: {
  payload?: unknown;
  xhrStatus?: number | null;
  fallbackMessage?: string | null;
}): ParsedStreamError => {
  const payload = parseNotFoundPayload(params.payload);
  const payloadMessage = payload?.message ?? null;
  const payloadCode = payload?.code?.toUpperCase() ?? null;
  const message = payloadMessage ?? toOptionalString(params.fallbackMessage) ?? 'Scan failed';
  if (payloadCode === 'NOT_FOUND' || payloadMessage === 'Product not found') {
    return {
      kind: 'not_found',
      message: payloadMessage ?? 'Product not found',
      reasonCode: payload?.reasonCode ?? null,
      stage: payload?.stage ?? null,
    };
  }

  const statusCode = Number.isFinite(params.xhrStatus) ? Number(params.xhrStatus) : null;
  if (statusCode === 401) {
    return {
      kind: 'unauthorized',
      message: message || 'Unauthorized (please sign in or enable dev auth bypass)',
      reasonCode: payload?.reasonCode ?? null,
      stage: payload?.stage ?? null,
    };
  }

  if (isLikelyNetworkError(message)) {
    return {
      kind: 'network',
      message,
      reasonCode: payload?.reasonCode ?? null,
      stage: payload?.stage ?? null,
    };
  }

  return {
    kind: 'server',
    message,
    reasonCode: payload?.reasonCode ?? null,
    stage: payload?.stage ?? null,
  };
};

export const resolveReasonCodeMessage = (reasonCode?: string | null): string | null => {
  const normalized = String(reasonCode ?? '').trim().toUpperCase();
  if (!normalized) return null;
  return REASON_CODE_USER_COPY[normalized] ?? null;
};
