import { Config } from '@/constants/Config';
import { withAuthHeaders } from '@/lib/auth-token';
import {
  createLocalGuestScanSession,
  getGuestScanSession,
  getLastGuestScanSession,
  markGuestScanSessionClaimFailed,
  markGuestScanSessionClaimPending,
  markGuestScanSessionClaimed,
  type GuestScanSession,
} from '@/lib/scan/guestSession';

export type CreateGuestScanSessionResponse = {
  guestScanSessionId: string;
  claimToken: string;
  status: string;
  expiresAt: string;
};

export type ClaimGuestScanSessionResponse = {
  ok: true;
  guestScanSessionId: string;
  status: string;
  claimedAt: string | null;
};

const buildApiUrl = (path: string): string => {
  const base = Config.apiBaseUrl.endsWith('/')
    ? Config.apiBaseUrl.slice(0, -1)
    : Config.apiBaseUrl;
  return `${base}${path}`;
};

const parseJson = async (response: Response): Promise<unknown> => {
  try {
    return await response.json();
  } catch {
    return null;
  }
};

const readString = (value: unknown): string | null =>
  typeof value === 'string' && value.trim().length > 0 ? value : null;

const assertCreateResponse = (value: unknown): CreateGuestScanSessionResponse => {
  if (!value || typeof value !== 'object') {
    throw new Error('Invalid guest scan session response.');
  }

  const record = value as Record<string, unknown>;
  const guestScanSessionId = readString(record.guestScanSessionId);
  const claimToken = readString(record.claimToken);
  const expiresAt = readString(record.expiresAt);
  if (!guestScanSessionId || !claimToken || !expiresAt) {
    throw new Error('Guest scan session response is missing required fields.');
  }

  return {
    guestScanSessionId,
    claimToken,
    status: readString(record.status) ?? 'created',
    expiresAt,
  };
};

export const createGuestScanSessionFromServer = async (): Promise<GuestScanSession> => {
  const response = await fetch(buildApiUrl('/api/guest-scan/session'), {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Accept: 'application/json',
    },
  });
  const json = await parseJson(response);

  if (!response.ok) {
    const error = (json as { error?: unknown } | null)?.error;
    throw new Error(readString(error) ?? 'guest_scan_unavailable');
  }

  const session = assertCreateResponse(json);
  return createLocalGuestScanSession({
    guestScanSessionId: session.guestScanSessionId,
    claimToken: session.claimToken,
    expiresAt: session.expiresAt,
  });
};

export const claimGuestScanSessionOnServer =
  async (guestScanSessionId?: string | null): Promise<ClaimGuestScanSessionResponse | null> => {
    const normalizedGuestScanSessionId =
      typeof guestScanSessionId === 'string' && guestScanSessionId.trim().length > 0
        ? guestScanSessionId.trim()
        : null;
    const localSession = normalizedGuestScanSessionId
      ? await getGuestScanSession(normalizedGuestScanSessionId)
      : await getLastGuestScanSession();
    if (!localSession) return null;
    await markGuestScanSessionClaimPending(localSession.guestScanSessionId);

    const headers = await withAuthHeaders({
      'Content-Type': 'application/json',
      Accept: 'application/json',
    });

    const response = await fetch(buildApiUrl('/api/guest-scan/claim'), {
      method: 'POST',
      headers,
      body: JSON.stringify({
        guestScanSessionId: localSession.guestScanSessionId,
        claimToken: localSession.claimToken,
      }),
    });
    const json = await parseJson(response);

    if (!response.ok) {
      const error = readString((json as { error?: unknown } | null)?.error) ?? 'guest_scan_claim_failed';
      await markGuestScanSessionClaimFailed(localSession.guestScanSessionId, error);
      throw new Error(error);
    }

    const result = json as Partial<ClaimGuestScanSessionResponse> | null;
    await markGuestScanSessionClaimed(localSession.guestScanSessionId);

    return {
      ok: true,
      guestScanSessionId:
        readString(result?.guestScanSessionId) ?? localSession.guestScanSessionId,
      status: readString(result?.status) ?? 'claimed',
      claimedAt: readString(result?.claimedAt),
    };
  };

export const claimLastGuestScanSessionOnServer = claimGuestScanSessionOnServer;
