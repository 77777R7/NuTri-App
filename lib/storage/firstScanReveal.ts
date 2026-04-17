import AsyncStorage from '@react-native-async-storage/async-storage';

export type FirstScanRevealState =
  | 'eligible'
  | 'granted'
  | 'paywall_seen'
  | 'converted';

export type FirstScanRevealRecord = {
  firstCompletedScanId: string | null;
  reveal: {
    state: FirstScanRevealState;
    scanId: string | null;
    grantedAt?: string;
    paywallSeenAt?: string;
  };
};

const STORAGE_KEY_PREFIX = 'nu.firstScanReveal:v1';

const DEFAULT_RECORD: FirstScanRevealRecord = {
  firstCompletedScanId: null,
  reveal: {
    state: 'eligible',
    scanId: null,
  },
};

const normalizeIsoString = (value: unknown): string | undefined => {
  if (typeof value !== 'string') return undefined;
  const normalized = value.trim();
  return normalized.length > 0 ? normalized : undefined;
};

const normalizeState = (value: unknown): FirstScanRevealState => {
  switch (value) {
    case 'granted':
    case 'paywall_seen':
    case 'converted':
      return value;
    default:
      return 'eligible';
  }
};

const normalizeRecord = (value: unknown): FirstScanRevealRecord => {
  if (typeof value !== 'object' || value === null) {
    return DEFAULT_RECORD;
  }

  const candidate = value as Record<string, unknown>;
  const revealCandidate =
    typeof candidate.reveal === 'object' && candidate.reveal !== null
      ? (candidate.reveal as Record<string, unknown>)
      : null;

  return {
    firstCompletedScanId:
      typeof candidate.firstCompletedScanId === 'string' && candidate.firstCompletedScanId.trim().length > 0
        ? candidate.firstCompletedScanId.trim()
        : null,
    reveal: {
      state: normalizeState(revealCandidate?.state),
      scanId:
        typeof revealCandidate?.scanId === 'string' && revealCandidate.scanId.trim().length > 0
          ? revealCandidate.scanId.trim()
          : null,
      grantedAt: normalizeIsoString(revealCandidate?.grantedAt),
      paywallSeenAt: normalizeIsoString(revealCandidate?.paywallSeenAt),
    },
  };
};

const getStorageKey = (scopeKey?: string | null) => `${STORAGE_KEY_PREFIX}:${scopeKey?.trim() || 'guest'}`;

export const getFirstScanRevealRecord = async (scopeKey?: string | null): Promise<FirstScanRevealRecord> => {
  const raw = await AsyncStorage.getItem(getStorageKey(scopeKey));
  if (!raw) return DEFAULT_RECORD;

  try {
    return normalizeRecord(JSON.parse(raw));
  } catch (error) {
    console.warn('[first-scan-reveal] failed to parse storage payload', error);
    return DEFAULT_RECORD;
  }
};

export const setFirstScanRevealRecord = async (value: FirstScanRevealRecord, scopeKey?: string | null) => {
  await AsyncStorage.setItem(getStorageKey(scopeKey), JSON.stringify(value));
};

export const clearFirstScanRevealRecord = async (scopeKey?: string | null) => {
  await AsyncStorage.removeItem(getStorageKey(scopeKey));
};
