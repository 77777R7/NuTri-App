import AsyncStorage from '@react-native-async-storage/async-storage';

export type GuestScanStatus =
  | 'created'
  | 'scanning'
  | 'result_started'
  | 'result_ready'
  | 'claim_pending'
  | 'claimed'
  | 'claim_failed'
  | 'expired';

export type GuestScanSession = {
  schemaVersion: 1;
  guestScanSessionId: string;
  claimToken: string;
  scanSessionId: string | null;
  barcode: string | null;
  status: GuestScanStatus;
  source: 'guest_scan';
  createdAt: string;
  expiresAt: string;
  claimedUserId: string | null;
  claimedAt: string | null;
  claimFailureReason: string | null;
};

const SCHEMA_VERSION = 1 as const;
const STORAGE_PREFIX = '@nutri:guest_scan_session:';
const LAST_KEY = '@nutri:guest_scan_session:last';

const GUEST_SCAN_STATUSES: readonly GuestScanStatus[] = [
  'created',
  'scanning',
  'result_started',
  'result_ready',
  'claim_pending',
  'claimed',
  'claim_failed',
  'expired',
];

const isGuestScanStatus = (value: unknown): value is GuestScanStatus =>
  typeof value === 'string' && GUEST_SCAN_STATUSES.includes(value as GuestScanStatus);

const keyFor = (guestScanSessionId: string) => `${STORAGE_PREFIX}${guestScanSessionId.trim()}`;

const normalizeOptionalString = (value: unknown): string | null =>
  typeof value === 'string' && value.trim().length > 0 ? value : null;

const normalizeSession = (value: unknown): GuestScanSession | null => {
  if (!value || typeof value !== 'object') return null;

  const candidate = value as Partial<GuestScanSession>;
  const guestScanSessionId = normalizeOptionalString(candidate.guestScanSessionId);
  const claimToken = normalizeOptionalString(candidate.claimToken);
  const createdAt = normalizeOptionalString(candidate.createdAt);
  const expiresAt = normalizeOptionalString(candidate.expiresAt);

  if (candidate.schemaVersion !== SCHEMA_VERSION) return null;
  if (!guestScanSessionId || !claimToken || !createdAt || !expiresAt) return null;
  if (candidate.source !== 'guest_scan') return null;

  return {
    schemaVersion: SCHEMA_VERSION,
    guestScanSessionId,
    claimToken,
    scanSessionId: normalizeOptionalString(candidate.scanSessionId),
    barcode: normalizeOptionalString(candidate.barcode),
    status: isGuestScanStatus(candidate.status) ? candidate.status : 'created',
    source: 'guest_scan',
    createdAt,
    expiresAt,
    claimedUserId: normalizeOptionalString(candidate.claimedUserId),
    claimedAt: normalizeOptionalString(candidate.claimedAt),
    claimFailureReason: normalizeOptionalString(candidate.claimFailureReason),
  };
};

const persist = async (session: GuestScanSession): Promise<void> => {
  const serialized = JSON.stringify(session);
  await AsyncStorage.multiSet([
    [keyFor(session.guestScanSessionId), serialized],
    [LAST_KEY, serialized],
  ]);
};

export const createLocalGuestScanSession = async (input: {
  guestScanSessionId: string;
  claimToken: string;
  expiresAt: string;
}): Promise<GuestScanSession> => {
  const guestScanSessionId = input.guestScanSessionId.trim();
  const claimToken = input.claimToken.trim();

  if (!guestScanSessionId || !claimToken) {
    throw new Error('Guest scan session id and claim token are required.');
  }

  const session: GuestScanSession = {
    schemaVersion: SCHEMA_VERSION,
    guestScanSessionId,
    claimToken,
    scanSessionId: null,
    barcode: null,
    status: 'created',
    source: 'guest_scan',
    createdAt: new Date().toISOString(),
    expiresAt: input.expiresAt,
    claimedUserId: null,
    claimedAt: null,
    claimFailureReason: null,
  };

  await persist(session);
  return session;
};

export const getGuestScanSession = async (
  guestScanSessionId: string,
): Promise<GuestScanSession | null> => {
  const key = keyFor(guestScanSessionId);
  const raw = await AsyncStorage.getItem(key);
  if (!raw) return null;

  try {
    return normalizeSession(JSON.parse(raw));
  } catch {
    return null;
  }
};

export const getLastGuestScanSession = async (): Promise<GuestScanSession | null> => {
  const raw = await AsyncStorage.getItem(LAST_KEY);
  if (!raw) return null;

  try {
    return normalizeSession(JSON.parse(raw));
  } catch {
    return null;
  }
};

export const setGuestScanSessionScan = async (
  guestScanSessionId: string,
  patch: Pick<Partial<GuestScanSession>, 'scanSessionId' | 'barcode' | 'status'>,
): Promise<GuestScanSession | null> => {
  const current = await getGuestScanSession(guestScanSessionId);
  if (!current) return null;

  const next: GuestScanSession = {
    ...current,
    scanSessionId:
      typeof patch.scanSessionId === 'string' ? patch.scanSessionId : current.scanSessionId,
    barcode: typeof patch.barcode === 'string' ? patch.barcode : current.barcode,
    status: isGuestScanStatus(patch.status) ? patch.status : current.status,
  };

  await persist(next);
  return next;
};

export const markGuestScanSessionClaimed = async (
  guestScanSessionId: string,
  claimedUserId?: string | null,
): Promise<GuestScanSession | null> => {
  const current = await getGuestScanSession(guestScanSessionId);
  if (!current) return null;

  const next: GuestScanSession = {
    ...current,
    status: 'claimed',
    claimedUserId: claimedUserId ?? current.claimedUserId,
    claimedAt: new Date().toISOString(),
    claimFailureReason: null,
  };

  await persist(next);
  return next;
};

export const markGuestScanSessionClaimPending = async (
  guestScanSessionId: string,
): Promise<GuestScanSession | null> => {
  const current = await getGuestScanSession(guestScanSessionId);
  if (!current) return null;

  const next: GuestScanSession = {
    ...current,
    status: 'claim_pending',
    claimFailureReason: null,
  };

  await persist(next);
  return next;
};

export const markGuestScanSessionClaimFailed = async (
  guestScanSessionId: string,
  claimFailureReason: string,
): Promise<GuestScanSession | null> => {
  const current = await getGuestScanSession(guestScanSessionId);
  if (!current) return null;

  const next: GuestScanSession = {
    ...current,
    status: 'claim_failed',
    claimFailureReason,
  };

  await persist(next);
  return next;
};

export const clearGuestScanSession = async (guestScanSessionId: string): Promise<void> => {
  await AsyncStorage.removeItem(keyFor(guestScanSessionId));

  const last = await getLastGuestScanSession();
  if (last?.guestScanSessionId === guestScanSessionId.trim()) {
    await AsyncStorage.removeItem(LAST_KEY);
  }
};
