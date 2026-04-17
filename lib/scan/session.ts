import type { ProfileDraft } from '@/types/onboarding';

import type { BarcodeScanResult } from './service';

export type SearchResultSeed = {
  productId: string;
  barcode?: string | null;
  upcCode?: string | null;
  name: string;
  brand: string;
  category: string;
  benefit: string;
  dose: string;
  imageUrl?: string | null;
  factsStatus?: 'full' | 'partial' | 'none';
  coverageStatus?: 'coverage_ready' | 'not_enough_structured_data';
};

const generateId = () => {
  try {
    return globalThis.crypto?.randomUUID?.() ?? Math.random().toString(36).slice(2);
  } catch {
    return Math.random().toString(36).slice(2);
  }
};

export type ScanSession =
  {
    id: string;
    mode: 'barcode';
    input: { barcode: string };
    result?: BarcodeScanResult;
    isLoading?: boolean;
    source?: string | null;
    searchResultSeed?: SearchResultSeed | null;
    onboardingDraftSnapshot?: ProfileDraft | null;
  };

export const SCAN_SESSION_SCHEMA_VERSION = 1 as const;
export const SCAN_SESSION_DEFAULT_TTL_MS = 10 * 60 * 1000;
const SCAN_SESSION_STORAGE_PREFIX = '@nutri:scan_session:';
const SCAN_SESSION_STORAGE_LAST_KEY = '@nutri:scan_session:last';

type ScanSessionEnvelope = {
  schemaVersion: number;
  createdAt: number;
  ttlMs: number;
  session: ScanSession;
};

type AsyncStorageLike = {
  getItem: (key: string) => Promise<string | null>;
  setItem: (key: string, value: string) => Promise<void>;
  removeItem: (key: string) => Promise<void>;
};

export type SessionConsumeResult =
  | {
    status: 'ok';
    session: ScanSession;
    envelope: ScanSessionEnvelope;
  }
  | {
    status: 'session_expired';
    reasonCode: 'missing' | 'expired' | 'invalid';
  };

// Keep an in-memory session map keyed by sessionId for barcode result routes.
// `legacySessionCandidate` preserves backward compatibility with historical singleton usage.
const sessionStore = new Map<string, unknown>();
let legacySessionCandidate: unknown = null;
let asyncStoragePromise: Promise<AsyncStorageLike | null> | null = null;

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null;

const isBarcodeSession = (value: unknown): value is Extract<ScanSession, { mode: 'barcode' }> => {
  if (!isRecord(value)) return false;
  const input = value.input;
  return (
    value.mode === 'barcode'
    && typeof value.id === 'string'
    && isRecord(input)
    && typeof input.barcode === 'string'
  );
};

const isScanSession = (value: unknown): value is ScanSession => isBarcodeSession(value);

const normalizeEnvelope = (candidate: unknown): ScanSessionEnvelope | null => {
  if (!candidate) return null;
  if (isRecord(candidate)) {
    const schemaVersion = Number(candidate.schemaVersion);
    const createdAt = Number(candidate.createdAt);
    const ttlMs = Number(candidate.ttlMs);
    const nestedSession = candidate.session;
    if (
      Number.isFinite(schemaVersion)
      && Number.isFinite(createdAt)
      && Number.isFinite(ttlMs)
      && ttlMs > 0
      && isScanSession(nestedSession)
    ) {
      return {
        schemaVersion,
        createdAt,
        ttlMs,
        session: nestedSession,
      };
    }
  }

  if (isScanSession(candidate)) {
    // Migration path for legacy singleton session shape.
    return {
      schemaVersion: SCAN_SESSION_SCHEMA_VERSION,
      createdAt: Date.now(),
      ttlMs: SCAN_SESSION_DEFAULT_TTL_MS,
      session: candidate,
    };
  }

  return null;
};

const isExpiredEnvelope = (envelope: ScanSessionEnvelope): boolean => {
  const expiresAt = envelope.createdAt + envelope.ttlMs;
  return !Number.isFinite(expiresAt) || Date.now() > expiresAt;
};

const storageKeyForSession = (sessionId: string) => `${SCAN_SESSION_STORAGE_PREFIX}${sessionId}`;
const isReactNativeRuntime = (): boolean => {
  const candidate = (globalThis as { navigator?: { product?: string } }).navigator;
  return candidate?.product === 'ReactNative';
};

const loadAsyncStorage = async (): Promise<AsyncStorageLike | null> => {
  if (!isReactNativeRuntime()) return null;
  if (asyncStoragePromise) return asyncStoragePromise;
  asyncStoragePromise = (async () => {
    try {
      const mod = await import('@react-native-async-storage/async-storage');
      const candidate = (mod as { default?: unknown }).default ?? mod;
      if (
        candidate &&
        typeof (candidate as AsyncStorageLike).getItem === 'function' &&
        typeof (candidate as AsyncStorageLike).setItem === 'function' &&
        typeof (candidate as AsyncStorageLike).removeItem === 'function'
      ) {
        return candidate as AsyncStorageLike;
      }
      return null;
    } catch {
      return null;
    }
  })();
  return asyncStoragePromise;
};

const persistEnvelope = async (envelope: ScanSessionEnvelope) => {
  const storage = await loadAsyncStorage();
  if (!storage) return;
  const serialized = JSON.stringify(envelope);
  await storage.setItem(storageKeyForSession(envelope.session.id), serialized);
  await storage.setItem(SCAN_SESSION_STORAGE_LAST_KEY, serialized);
};

const clearPersistedEnvelope = async (sessionId: string) => {
  const storage = await loadAsyncStorage();
  if (!storage) return;
  await storage.removeItem(storageKeyForSession(sessionId));
};

const hydrateEnvelopeFromStorage = async (sessionId?: string | null): Promise<ScanSessionEnvelope | null> => {
  const storage = await loadAsyncStorage();
  if (!storage) return null;
  const normalizedId = typeof sessionId === 'string' ? sessionId.trim() : '';
  const raw = normalizedId
    ? await storage.getItem(storageKeyForSession(normalizedId))
    : await storage.getItem(SCAN_SESSION_STORAGE_LAST_KEY);
  if (!raw) return null;
  let parsed: unknown = null;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  const envelope = normalizeEnvelope(parsed);
  if (!envelope) {
    if (normalizedId) {
      await clearPersistedEnvelope(normalizedId);
    }
    return null;
  }
  if (normalizedId && envelope.session.id !== normalizedId) {
    return null;
  }
  if (isExpiredEnvelope(envelope)) {
    await clearPersistedEnvelope(envelope.session.id);
    return null;
  }
  sessionStore.set(envelope.session.id, envelope);
  legacySessionCandidate = envelope;
  return envelope;
};

export const setScanSession = (
  session: ScanSession,
  options?: { ttlMs?: number },
) => {
  const ttlMsRaw = Number(options?.ttlMs ?? SCAN_SESSION_DEFAULT_TTL_MS);
  const ttlMs = Number.isFinite(ttlMsRaw) && ttlMsRaw > 0
    ? ttlMsRaw
    : SCAN_SESSION_DEFAULT_TTL_MS;
  const envelope: ScanSessionEnvelope = {
    schemaVersion: SCAN_SESSION_SCHEMA_VERSION,
    createdAt: Date.now(),
    ttlMs,
    session,
  };
  sessionStore.set(session.id, envelope);
  legacySessionCandidate = envelope;
  void persistEnvelope(envelope);
};

export const consumeScanSessionWithStatus = (sessionId?: string | null): SessionConsumeResult => {
  let candidate: unknown = null;
  const normalizedId = typeof sessionId === 'string' && sessionId.trim().length > 0 ? sessionId.trim() : null;

  if (normalizedId && sessionStore.has(normalizedId)) {
    candidate = sessionStore.get(normalizedId) ?? null;
  }

  if (!candidate && legacySessionCandidate) {
    const legacyEnvelope = normalizeEnvelope(legacySessionCandidate);
    if (legacyEnvelope && (!normalizedId || legacyEnvelope.session.id === normalizedId)) {
      candidate = legacyEnvelope;
    }
  }

  const envelope = normalizeEnvelope(candidate);
  if (!envelope) {
    return { status: 'session_expired', reasonCode: candidate ? 'invalid' : 'missing' };
  }

  if (isExpiredEnvelope(envelope)) {
    sessionStore.delete(envelope.session.id);
    if (legacySessionCandidate) {
      const legacyEnvelope = normalizeEnvelope(legacySessionCandidate);
      if (legacyEnvelope?.session.id === envelope.session.id) {
        legacySessionCandidate = null;
      }
    }
    void clearPersistedEnvelope(envelope.session.id);
    return { status: 'session_expired', reasonCode: 'expired' };
  }

  sessionStore.set(envelope.session.id, envelope);
  legacySessionCandidate = envelope;
  return { status: 'ok', session: envelope.session, envelope };
};

export const consumeScanSessionWithStatusAsync = async (sessionId?: string | null): Promise<SessionConsumeResult> => {
  const immediate = consumeScanSessionWithStatus(sessionId);
  if (immediate.status === 'ok') return immediate;
  const hydrated = await hydrateEnvelopeFromStorage(sessionId);
  if (!hydrated) return immediate;
  return {
    status: 'ok',
    session: hydrated.session,
    envelope: hydrated,
  };
};

export const consumeScanSession = (sessionId?: string | null): ScanSession | null => {
  const result = consumeScanSessionWithStatus(sessionId);
  return result.status === 'ok' ? result.session : null;
};

export const ensureSessionId = generateId;

export const __sessionTestUtils = {
  reset: () => {
    sessionStore.clear();
    legacySessionCandidate = null;
  },
  seedRawSession: (sessionId: string, candidate: unknown) => {
    sessionStore.set(sessionId, candidate);
    legacySessionCandidate = candidate;
  },
};
