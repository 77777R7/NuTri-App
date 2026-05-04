# Guest Scan / Start Free Scan Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a guarded guest scan path where a signed-out user can run one free supplement scan, view that result, then sign up or sign in to claim it.

**Architecture:** Add a first-class guest scan session boundary instead of bypassing auth globally. The mobile app stores a short-lived local claim token, `/api/enrich-stream` accepts either Supabase auth or a valid guest scan token, and a post-auth claim route attaches the guest result to the authenticated user. The logged-in onboarding flow stays unchanged.

**Tech Stack:** Expo Router, React Native, AsyncStorage, Supabase auth, Express backend, Node `node:test` contract tests, Render deployment

---

## File Structure

- Create: `lib/scan/guestSession.ts`
  - Local AsyncStorage model for guest scan sessions and claim-token lookup.
- Create: `lib/api/guestScan.ts`
  - Client API calls for creating and claiming guest scan sessions.
- Modify: `app/(auth)/gate.tsx`
  - Add the **Start Free Scan** CTA behind `EXPO_PUBLIC_GUEST_SCAN_ENABLED`.
- Modify: `app/index.tsx`
  - Send signed-out users to `/(auth)/gate` so Start Free Scan is reachable.
- Modify: `app/(auth)/auth/login.tsx`
  - Keep existing redirect support and add guest-claim copy when redirect target is `/guest-scan/claim`.
- Modify: `app/(auth)/auth/signup.tsx`
  - Mirror login redirect behavior for guest claim handoff.
- Modify: `lib/scan/session.ts`
  - Add guest scan metadata to `ScanSession`.
- Modify: `app/scan/barcode.tsx`
  - Carry `guestScanSessionId` into the scan session when `source=guest_scan`.
- Modify: `hooks/useStreamAnalysis.ts`
  - Add guest scan headers only for guest scan sessions.
- Modify: `app/scan/result.tsx`
  - Treat a validated guest scan as a one-result full reveal and route keep actions to claim.
- Create: `app/guest-scan/claim.tsx`
  - Post-auth claim screen that reads the local token and calls the backend claim endpoint.
- Create: `backend/src/guestScanSessions.ts`
  - Server helpers for create, validate, record progress, and claim.
- Modify: `backend/src/server.ts`
  - Add guest session routes and allow guest token auth for `/api/enrich-stream`.
- Create: `backend/tests/guest-scan-session-contract.test.mjs`
  - Backend route/auth contract checks.
- Create: `tests/scan/guest-scan-session-storage-contract.test.ts`
  - Local storage and token-safety contract checks.
- Create: `tests/scan/guest-scan-flow-contract.test.ts`
  - Frontend route/source/claim-flow contract checks.

## Constraints

- Barcode scan is release-sensitive. Implementation must keep `app/scan/barcode.tsx`, `app/scan/result.tsx`, `components/scan/**`, and `hooks/useStreamAnalysis.ts` edits narrow and covered by explicit guest-scan contracts.
- Do not alter normal logged-in scan result score wiring, mini score header behavior, or dashboard rendering.
- Do not pass `claimToken` in URLs.
- Do not create a persistent anonymous account.
- Do not use `X-Auth-Disabled` in production guest scan flow.

### Task 1: Add Guest Session Storage Contracts

**Files:**
- Create: `tests/scan/guest-scan-session-storage-contract.test.ts`
- Create: `lib/scan/guestSession.ts`

- [ ] **Step 1: Write the storage contract**

```ts
import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';

const source = readFileSync(
  '/Users/howard07/NuTriApp/nutri-app/lib/scan/guestSession.ts',
  'utf8',
);

test('guest scan storage keeps claim tokens local and out of route params', () => {
  assert.match(source, /claimToken: string/);
  assert.match(source, /@nutri:guest_scan_session:/);
  assert.match(source, /@nutri:guest_scan_session:last/);
  assert.doesNotMatch(source, /URLSearchParams\\([^)]*claimToken/s);
  assert.doesNotMatch(source, /router\\.(push|replace)\\([^)]*claimToken/s);
});

test('guest scan storage exposes create, update, lookup, and clear helpers', () => {
  assert.match(source, /export const createLocalGuestScanSession/);
  assert.match(source, /export const setGuestScanSessionScan/);
  assert.match(source, /export const getGuestScanSession/);
  assert.match(source, /export const getLastGuestScanSession/);
  assert.match(source, /export const clearGuestScanSession/);
});
```

- [ ] **Step 2: Run the test and verify it fails**

```bash
cd /Users/howard07/NuTriApp/nutri-app
node --import tsx --test tests/scan/guest-scan-session-storage-contract.test.ts
```

Expected: FAIL because `lib/scan/guestSession.ts` does not exist.

- [ ] **Step 3: Create the storage helper**

```ts
import AsyncStorage from '@react-native-async-storage/async-storage';

export type GuestScanStatus =
  | 'created'
  | 'scanning'
  | 'result_started'
  | 'result_ready'
  | 'claim_pending'
  | 'claimed'
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

const keyFor = (guestScanSessionId: string) => `${STORAGE_PREFIX}${guestScanSessionId.trim()}`;

const normalizeSession = (value: unknown): GuestScanSession | null => {
  if (!value || typeof value !== 'object') return null;
  const candidate = value as Partial<GuestScanSession>;
  if (candidate.schemaVersion !== SCHEMA_VERSION) return null;
  if (typeof candidate.guestScanSessionId !== 'string') return null;
  if (typeof candidate.claimToken !== 'string') return null;
  if (candidate.source !== 'guest_scan') return null;
  return {
    schemaVersion: SCHEMA_VERSION,
    guestScanSessionId: candidate.guestScanSessionId.trim(),
    claimToken: candidate.claimToken,
    scanSessionId: candidate.scanSessionId ?? null,
    barcode: candidate.barcode ?? null,
    status: candidate.status ?? 'created',
    source: 'guest_scan',
    createdAt: candidate.createdAt ?? new Date().toISOString(),
    expiresAt: candidate.expiresAt ?? new Date(Date.now() + 30 * 60_000).toISOString(),
    claimedUserId: candidate.claimedUserId ?? null,
    claimedAt: candidate.claimedAt ?? null,
    claimFailureReason: candidate.claimFailureReason ?? null,
  };
};

const persist = async (session: GuestScanSession) => {
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
  const session: GuestScanSession = {
    schemaVersion: SCHEMA_VERSION,
    guestScanSessionId: input.guestScanSessionId.trim(),
    claimToken: input.claimToken,
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

export const getGuestScanSession = async (guestScanSessionId: string): Promise<GuestScanSession | null> => {
  const raw = await AsyncStorage.getItem(keyFor(guestScanSessionId));
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
    scanSessionId: patch.scanSessionId ?? current.scanSessionId,
    barcode: patch.barcode ?? current.barcode,
    status: patch.status ?? current.status,
  };
  await persist(next);
  return next;
};

export const clearGuestScanSession = async (guestScanSessionId: string) => {
  await AsyncStorage.removeItem(keyFor(guestScanSessionId));
};
```

- [ ] **Step 4: Re-run the storage contract**

```bash
node --import tsx --test tests/scan/guest-scan-session-storage-contract.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add lib/scan/guestSession.ts tests/scan/guest-scan-session-storage-contract.test.ts
git commit -m "feat: add guest scan session storage"
```

### Task 2: Add Backend Guest Session Boundary

**Files:**
- Create: `backend/src/guestScanSessions.ts`
- Modify: `backend/src/server.ts`
- Create: `backend/tests/guest-scan-session-contract.test.mjs`

- [ ] **Step 1: Write the backend contract**

```js
import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';

const helper = readFileSync('/Users/howard07/NuTriApp/nutri-app/backend/src/guestScanSessions.ts', 'utf8');
const server = readFileSync('/Users/howard07/NuTriApp/nutri-app/backend/src/server.ts', 'utf8');

test('guest scan backend stores hashed claim tokens only', () => {
  assert.match(helper, /createHash\\(['"]sha256['"]\\)/);
  assert.match(helper, /claim_token_hash/);
  assert.doesNotMatch(helper, /claim_token:\\s*claimToken/);
});

test('guest scan backend exposes create and claim routes', () => {
  assert.match(server, /\\/api\\/guest-scan\\/sessions/);
  assert.match(server, /\\/api\\/guest-scan\\/claim/);
  assert.match(server, /GUEST_SCAN_ENABLED/);
});

test('enrich stream can authenticate with a guest scan token without x-auth-disabled', () => {
  assert.match(server, /verifySupabaseTokenOrGuestScanToken/);
  assert.match(server, /x-nutri-guest-scan-session/i);
  assert.match(server, /x-nutri-guest-claim-token/i);
  assert.doesNotMatch(server, /guest_scan[\\s\\S]{0,500}x-auth-disabled/i);
});
```

- [ ] **Step 2: Run the backend contract and verify it fails**

```bash
node --test backend/tests/guest-scan-session-contract.test.mjs
```

Expected: FAIL because helper and routes do not exist.

- [ ] **Step 3: Create `backend/src/guestScanSessions.ts`**

```ts
import { createHash, randomUUID } from 'node:crypto';
import { supabase } from './supabase.js';

const GUEST_SCAN_TTL_MS = 30 * 60_000;

const hashClaimToken = (claimToken: string): string =>
  createHash('sha256').update(claimToken, 'utf8').digest('hex');

export const isGuestScanEnabled = (): boolean =>
  process.env.GUEST_SCAN_ENABLED === '1' || process.env.GUEST_SCAN_ENABLED === 'true';

export const createGuestScanSession = async () => {
  const guestScanSessionId = randomUUID();
  const claimToken = randomUUID();
  const expiresAt = new Date(Date.now() + GUEST_SCAN_TTL_MS).toISOString();

  const { error } = await supabase.from('guest_scan_sessions').insert({
    id: guestScanSessionId,
    claim_token_hash: hashClaimToken(claimToken),
    status: 'created',
    expires_at: expiresAt,
  });
  if (error) throw error;

  return { guestScanSessionId, claimToken, expiresAt };
};

export const validateGuestScanToken = async (input: {
  guestScanSessionId: string | null;
  claimToken: string | null;
}) => {
  if (!isGuestScanEnabled()) return null;
  if (!input.guestScanSessionId || !input.claimToken) return null;
  const { data, error } = await supabase
    .from('guest_scan_sessions')
    .select('id,status,expires_at,claimed_user_id')
    .eq('id', input.guestScanSessionId)
    .eq('claim_token_hash', hashClaimToken(input.claimToken))
    .maybeSingle();
  if (error || !data) return null;
  if (data.claimed_user_id) return null;
  if (Date.now() > Date.parse(data.expires_at)) return null;
  return { guestScanSessionId: data.id as string };
};

export const recordGuestScanResultStarted = async (input: {
  guestScanSessionId: string;
  scanSessionId: string | null;
  barcodeGtin14: string;
}) => {
  await supabase
    .from('guest_scan_sessions')
    .update({
      status: 'result_started',
      scan_session_id: input.scanSessionId,
      barcode_gtin14: input.barcodeGtin14,
      updated_at: new Date().toISOString(),
    })
    .eq('id', input.guestScanSessionId);
};

export const claimGuestScanSession = async (input: {
  guestScanSessionId: string;
  claimToken: string;
  userId: string;
}) => {
  const now = new Date().toISOString();
  const { data, error } = await supabase
    .from('guest_scan_sessions')
    .update({
      status: 'claimed',
      claimed_user_id: input.userId,
      claimed_at: now,
      updated_at: now,
    })
    .eq('id', input.guestScanSessionId)
    .eq('claim_token_hash', hashClaimToken(input.claimToken))
    .is('claimed_user_id', null)
    .select('id,scan_session_id,barcode_gtin14,status,claimed_at')
    .maybeSingle();
  if (error) throw error;
  return data;
};
```

- [ ] **Step 4: Wire backend routes in `backend/src/server.ts`**

Add imports:

```ts
import {
  claimGuestScanSession,
  createGuestScanSession,
  isGuestScanEnabled,
  recordGuestScanResultStarted,
  validateGuestScanToken,
} from './guestScanSessions.js';
```

Add request metadata:

```ts
type AuthenticatedRequest = Request & {
  user?: { id: string; email?: string | null };
  regressionAuth?: boolean;
  guestScan?: { guestScanSessionId: string };
};
```

Add middleware:

```ts
const verifySupabaseTokenOrGuestScanToken = async (req: Request, res: Response, next: NextFunction) => {
  const guestScanSessionId = String(req.headers['x-nutri-guest-scan-session'] ?? '').trim();
  const claimToken = String(req.headers['x-nutri-guest-claim-token'] ?? '').trim();
  const guestScan = await validateGuestScanToken({ guestScanSessionId, claimToken });
  if (guestScan) {
    (req as AuthenticatedRequest).guestScan = guestScan;
    return next();
  }
  return verifySupabaseToken(req, res, next);
};
```

Add routes before `/api/enrich-stream`:

```ts
app.post('/api/guest-scan/sessions', async (_req: Request, res: Response) => {
  if (!isGuestScanEnabled()) {
    return res.status(404).json({ error: 'guest_scan_disabled' });
  }
  const session = await createGuestScanSession();
  return res.status(201).json(session);
});

app.post('/api/guest-scan/claim', verifySupabaseToken, async (req: Request, res: Response) => {
  if (!isGuestScanEnabled()) {
    return res.status(404).json({ error: 'guest_scan_disabled' });
  }
  const userId = (req as AuthenticatedRequest).user?.id;
  const guestScanSessionId = typeof req.body?.guestScanSessionId === 'string' ? req.body.guestScanSessionId.trim() : '';
  const claimToken = typeof req.body?.claimToken === 'string' ? req.body.claimToken.trim() : '';
  if (!userId || !guestScanSessionId || !claimToken) {
    return res.status(400).json({ error: 'invalid_guest_scan_claim' });
  }
  const claimed = await claimGuestScanSession({ guestScanSessionId, claimToken, userId });
  if (!claimed) {
    return res.status(409).json({ error: 'guest_scan_claim_unavailable' });
  }
  return res.json({ ok: true, claimed });
});
```

Change `/api/enrich-stream` to use `verifySupabaseTokenOrGuestScanToken`, and after barcode normalization add:

```ts
const guestScan = (req as AuthenticatedRequest).guestScan ?? null;
if (guestScan) {
  void recordGuestScanResultStarted({
    guestScanSessionId: guestScan.guestScanSessionId,
    scanSessionId: typeof req.headers['x-nutri-scan-session-id'] === 'string'
      ? req.headers['x-nutri-scan-session-id']
      : null,
    barcodeGtin14: normalized.normalizedBarcode,
  });
}
```

- [ ] **Step 5: Re-run backend contract**

```bash
node --test backend/tests/guest-scan-session-contract.test.mjs
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add backend/src/guestScanSessions.ts backend/src/server.ts backend/tests/guest-scan-session-contract.test.mjs
git commit -m "feat: add guest scan backend boundary"
```

### Task 3: Add Client Guest Scan API and Entry CTA

**Files:**
- Create: `lib/api/guestScan.ts`
- Modify: `app/(auth)/gate.tsx`
- Modify: `app/index.tsx`
- Create: `tests/scan/guest-scan-flow-contract.test.ts`

- [ ] **Step 1: Write the entry-flow contract**

```ts
import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';

const gate = readFileSync('/Users/howard07/NuTriApp/nutri-app/app/(auth)/gate.tsx', 'utf8');
const index = readFileSync('/Users/howard07/NuTriApp/nutri-app/app/index.tsx', 'utf8');
const api = readFileSync('/Users/howard07/NuTriApp/nutri-app/lib/api/guestScan.ts', 'utf8');

test('signed-out users can reach the gate with Start Free Scan', () => {
  assert.match(index, /Redirect href="\\/\\(auth\\)\\/gate"/);
  assert.match(gate, /Start Free Scan/);
  assert.match(gate, /EXPO_PUBLIC_GUEST_SCAN_ENABLED/);
  assert.match(gate, /source: 'guest_scan'/);
});

test('guest scan API creates a server session before camera navigation', () => {
  assert.match(api, /\\/api\\/guest-scan\\/sessions/);
  assert.match(api, /createLocalGuestScanSession/);
  assert.doesNotMatch(gate, /claimToken[^\\n]*router\\.(push|replace)/);
});
```

- [ ] **Step 2: Run the contract and verify it fails**

```bash
node --import tsx --test tests/scan/guest-scan-flow-contract.test.ts
```

Expected: FAIL because `lib/api/guestScan.ts` does not exist and gate has no CTA.

- [ ] **Step 3: Create `lib/api/guestScan.ts`**

```ts
import { Config } from '@/constants/Config';
import { withAuthHeaders } from '@/lib/auth-token';
import { createLocalGuestScanSession, getGuestScanSession } from '@/lib/scan/guestSession';

export const createGuestScanSessionFromServer = async () => {
  const response = await fetch(`${Config.API_BASE_URL}/api/guest-scan/sessions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
  });
  if (!response.ok) {
    throw new Error(`guest_scan_create_failed:${response.status}`);
  }
  const payload = await response.json() as {
    guestScanSessionId: string;
    claimToken: string;
    expiresAt: string;
  };
  return createLocalGuestScanSession(payload);
};

export const claimGuestScanSessionOnServer = async (guestScanSessionId: string) => {
  const local = await getGuestScanSession(guestScanSessionId);
  if (!local) {
    throw new Error('guest_scan_local_session_missing');
  }
  const headers = await withAuthHeaders({ 'Content-Type': 'application/json' });
  const response = await fetch(`${Config.API_BASE_URL}/api/guest-scan/claim`, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      guestScanSessionId: local.guestScanSessionId,
      claimToken: local.claimToken,
    }),
  });
  if (!response.ok) {
    throw new Error(`guest_scan_claim_failed:${response.status}`);
  }
  return response.json();
};
```

- [ ] **Step 4: Add the gate CTA**

In `app/(auth)/gate.tsx`, compute:

```ts
const guestScanEnabled =
  process.env.EXPO_PUBLIC_GUEST_SCAN_ENABLED === '1' ||
  process.env.EXPO_PUBLIC_GUEST_SCAN_ENABLED === 'true';
```

Add the CTA before account creation:

```tsx
{guestScanEnabled ? (
  <TouchableOpacity
    onPress={async () => {
      try {
        await Haptics.selectionAsync();
        const guestSession = await createGuestScanSessionFromServer();
        router.push({
          pathname: '/scan/barcode',
          params: {
            source: 'guest_scan',
            guestScanSessionId: guestSession.guestScanSessionId,
          },
        });
      } catch (error) {
        console.warn('[guest-scan] failed to start', error);
      }
    }}
    activeOpacity={0.9}
    accessibilityRole="button"
    accessibilityLabel="Start Free Scan"
    testID="gate-start-free-scan"
    style={styles.pillPrimary}
  >
    <Text style={styles.pillPrimaryText}>Start Free Scan</Text>
  </TouchableOpacity>
) : null}
```

- [ ] **Step 5: Send signed-out index users to the gate**

Change `app/index.tsx`:

```tsx
if (!session) {
  return <Redirect href="/(auth)/gate" />;
}
```

- [ ] **Step 6: Re-run the contract**

```bash
node --import tsx --test tests/scan/guest-scan-flow-contract.test.ts
```

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add app/index.tsx app/'(auth)'/gate.tsx lib/api/guestScan.ts tests/scan/guest-scan-flow-contract.test.ts
git commit -m "feat: add start free scan entry"
```

### Task 4: Carry Guest Metadata Through Scan and Stream

**Files:**
- Modify: `lib/scan/session.ts`
- Modify: `app/scan/barcode.tsx`
- Modify: `hooks/useStreamAnalysis.ts`
- Modify: `app/scan/result.tsx`
- Modify: `tests/scan/guest-scan-flow-contract.test.ts`

- [ ] **Step 1: Extend the frontend contract**

Append to `tests/scan/guest-scan-flow-contract.test.ts`:

```ts
const scanSession = readFileSync('/Users/howard07/NuTriApp/nutri-app/lib/scan/session.ts', 'utf8');
const barcode = readFileSync('/Users/howard07/NuTriApp/nutri-app/app/scan/barcode.tsx', 'utf8');
const stream = readFileSync('/Users/howard07/NuTriApp/nutri-app/hooks/useStreamAnalysis.ts', 'utf8');
const result = readFileSync('/Users/howard07/NuTriApp/nutri-app/app/scan/result.tsx', 'utf8');

test('guest scan metadata stays attached to the scan session and stream headers', () => {
  assert.match(scanSession, /guestScanSessionId\\?: string \\| null/);
  assert.match(barcode, /guestScanSessionId/);
  assert.match(stream, /X-NuTri-Guest-Scan-Session/);
  assert.match(stream, /X-NuTri-Guest-Claim-Token/);
  assert.match(stream, /X-NuTri-Scan-Session-Id/);
});

test('guest scan result receives one full reveal and keep action routes through claim', () => {
  assert.match(result, /isGuestScan/);
  assert.match(result, /guestScanSessionId/);
  assert.match(result, /\\/guest-scan\\/claim/);
  assert.match(result, /Keep this result/);
});
```

- [ ] **Step 2: Run and verify failure**

```bash
node --import tsx --test tests/scan/guest-scan-flow-contract.test.ts
```

Expected: FAIL on missing guest metadata.

- [ ] **Step 3: Extend `ScanSession`**

```ts
export type ScanSession = {
  id: string;
  mode: 'barcode';
  input: { barcode: string };
  result?: BarcodeScanResult;
  isLoading?: boolean;
  source?: string | null;
  guestScanSessionId?: string | null;
  searchResultSeed?: SearchResultSeed | null;
  onboardingDraftSnapshot?: ProfileDraft | null;
};
```

- [ ] **Step 4: Capture guest session in `app/scan/barcode.tsx`**

Update params:

```ts
const params = useLocalSearchParams<{ source?: string; guestScanSessionId?: string }>();
const isGuestScan = params.source === 'guest_scan';
const guestScanSessionId =
  typeof params.guestScanSessionId === 'string' && params.guestScanSessionId.trim().length > 0
    ? params.guestScanSessionId.trim()
    : null;
```

Update `setScanSession`:

```ts
setScanSession({
  id: sessionId,
  mode: 'barcode',
  input: { barcode: normalized },
  isLoading: true,
  source: isGuestScan ? 'guest_scan' : isOnboardingScan ? 'onboarding' : params.source ?? null,
  guestScanSessionId: isGuestScan ? guestScanSessionId : null,
  onboardingDraftSnapshot: isOnboardingScan ? draft ?? null : null,
});
```

After `setScanSession`, update local guest storage:

```ts
if (isGuestScan && guestScanSessionId) {
  void setGuestScanSessionScan(guestScanSessionId, {
    scanSessionId: sessionId,
    barcode: normalized,
    status: 'scanning',
  });
}
```

- [ ] **Step 5: Pass guest session into `useStreamAnalysis`**

In `app/scan/result.tsx`:

```ts
const guestScanSessionId =
  session?.source === 'guest_scan' && session.guestScanSessionId
    ? session.guestScanSessionId
    : null;
```

Call:

```ts
useStreamAnalysis(barcode, {
  launchSource: effectiveScanSource,
  searchSeed: searchResultSeed,
  scanSessionId: currentScanId,
  guestScanSessionId,
});
```

Update `StreamLaunchOptions` in `hooks/useStreamAnalysis.ts`:

```ts
type StreamLaunchOptions = {
  launchSource?: string | null;
  searchSeed?: SearchResultSeed | null;
  scanSessionId?: string | null;
  guestScanSessionId?: string | null;
};
```

Before creating RNEventSource:

```ts
if (options?.scanSessionId) {
  headers['X-NuTri-Scan-Session-Id'] = options.scanSessionId;
}
if (options?.guestScanSessionId) {
  const guestSession = await getGuestScanSession(options.guestScanSessionId);
  if (guestSession?.claimToken) {
    headers['X-NuTri-Guest-Scan-Session'] = guestSession.guestScanSessionId;
    headers['X-NuTri-Guest-Claim-Token'] = guestSession.claimToken;
  }
}
```

- [ ] **Step 6: Give guest result one full reveal and claim CTA**

In `app/scan/result.tsx`:

```ts
const isGuestScan = effectiveScanSource === 'guest_scan' && Boolean(guestScanSessionId);
const canAccessFullResult =
  premiumAccess.isPremium || isFirstRevealActive || isFirstRevealPendingGrant || isGuestScan;
```

Use `canAccessFullResult` for `accessLevel`.

For Save/keep:

```ts
const handleKeepGuestResult = useCallback(() => {
  if (!guestScanSessionId) return;
  const returnTo = `/scan/result?sessionId=${encodeURIComponent(currentScanId ?? '')}`;
  setPostAuthRedirect(`/guest-scan/claim?guestScanSessionId=${encodeURIComponent(guestScanSessionId)}&returnTo=${encodeURIComponent(returnTo)}`);
  router.push('/auth/signup');
}, [currentScanId, guestScanSessionId, router, setPostAuthRedirect]);
```

Render a small CTA near the result header or under the top section:

```tsx
{isGuestScan ? (
  <TouchableOpacity onPress={handleKeepGuestResult} style={styles.guestKeepButton}>
    <Text style={styles.guestKeepButtonText}>Keep this result</Text>
  </TouchableOpacity>
) : null}
```

- [ ] **Step 7: Re-run the contract**

```bash
node --import tsx --test tests/scan/guest-scan-flow-contract.test.ts
```

Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add lib/scan/session.ts app/scan/barcode.tsx hooks/useStreamAnalysis.ts app/scan/result.tsx tests/scan/guest-scan-flow-contract.test.ts
git commit -m "feat: carry guest scan through result stream"
```

### Task 5: Add Post-Auth Claim Route

**Files:**
- Create: `app/guest-scan/claim.tsx`
- Modify: `app/(auth)/auth/signup.tsx`
- Modify: `app/(auth)/auth/login.tsx`
- Modify: `tests/scan/guest-scan-flow-contract.test.ts`

- [ ] **Step 1: Extend claim route contract**

Append:

```ts
const claim = readFileSync('/Users/howard07/NuTriApp/nutri-app/app/guest-scan/claim.tsx', 'utf8');
const signup = readFileSync('/Users/howard07/NuTriApp/nutri-app/app/(auth)/auth/signup.tsx', 'utf8');
const login = readFileSync('/Users/howard07/NuTriApp/nutri-app/app/(auth)/auth/login.tsx', 'utf8');

test('post-auth guest claim route reads token from local storage, not URL', () => {
  assert.match(claim, /claimGuestScanSessionOnServer/);
  assert.match(claim, /guestScanSessionId/);
  assert.doesNotMatch(claim, /params\\.claimToken/);
  assert.match(claim, /router\\.replace/);
});

test('auth screens preserve guest claim redirect', () => {
  assert.match(signup, /postAuthRedirect/);
  assert.match(signup, /getPostAuthDestination/);
  assert.match(login, /guest-scan\\/claim/);
});
```

- [ ] **Step 2: Run and verify failure**

```bash
node --import tsx --test tests/scan/guest-scan-flow-contract.test.ts
```

Expected: FAIL because claim route and signup redirect support are missing.

- [ ] **Step 3: Create `app/guest-scan/claim.tsx`**

```tsx
import { router, useLocalSearchParams } from 'expo-router';
import React, { useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, StyleSheet, Text, View } from 'react-native';

import { useAuth } from '@/contexts/AuthContext';
import { claimGuestScanSessionOnServer } from '@/lib/api/guestScan';

export default function GuestScanClaimScreen() {
  const { session, loading } = useAuth();
  const params = useLocalSearchParams<{ guestScanSessionId?: string; returnTo?: string }>();
  const [error, setError] = useState<string | null>(null);

  const guestScanSessionId = useMemo(
    () => (typeof params.guestScanSessionId === 'string' ? params.guestScanSessionId.trim() : ''),
    [params.guestScanSessionId],
  );
  const returnTo = typeof params.returnTo === 'string' && params.returnTo.length > 0
    ? params.returnTo
    : '/main';

  useEffect(() => {
    if (loading) return;
    if (!session?.user) {
      router.replace({
        pathname: '/auth/login',
        params: {
          redirect: `/guest-scan/claim?guestScanSessionId=${encodeURIComponent(guestScanSessionId)}&returnTo=${encodeURIComponent(returnTo)}`,
        },
      });
      return;
    }
    if (!guestScanSessionId) {
      setError('Missing guest scan session.');
      return;
    }
    let cancelled = false;
    void claimGuestScanSessionOnServer(guestScanSessionId)
      .then(() => {
        if (!cancelled) router.replace(returnTo as never);
      })
      .catch((claimError) => {
        if (!cancelled) setError(claimError instanceof Error ? claimError.message : 'Guest scan claim failed.');
      });
    return () => {
      cancelled = true;
    };
  }, [guestScanSessionId, loading, returnTo, session?.user]);

  return (
    <View style={styles.screen}>
      <ActivityIndicator color="#2563EB" />
      <Text style={styles.title}>{error ?? 'Saving your scan...'}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24, backgroundColor: '#F8FAFC' },
  title: { marginTop: 16, fontSize: 18, fontWeight: '700', color: '#0F172A', textAlign: 'center' },
});
```

- [ ] **Step 4: Mirror login redirect behavior in signup**

In `app/(auth)/auth/signup.tsx`, import `useLocalSearchParams`, `getPostAuthDestination`, and include:

```ts
const params = useLocalSearchParams<{ redirect?: string }>();
const { session, postAuthRedirect, setPostAuthRedirect } = useAuth();
const redirectTarget = useMemo(() => {
  const encodedRedirect = typeof params.redirect === 'string' ? params.redirect : null;
  const candidate = encodedRedirect ?? postAuthRedirect;
  if (!candidate) return null;
  try {
    return decodeURIComponent(candidate);
  } catch {
    return candidate;
  }
}, [params.redirect, postAuthRedirect]);

useEffect(() => {
  if (!loading && session) {
    const destination = redirectTarget ? getPostAuthDestination(redirectTarget) : '/';
    setPostAuthRedirect(null);
    router.replace(destination);
  }
}, [loading, redirectTarget, router, session, setPostAuthRedirect]);
```

- [ ] **Step 5: Add guest claim context copy to login/signup**

```tsx
const isGuestClaimRedirect = redirectTarget?.includes('/guest-scan/claim') === true;
```

Use:

```tsx
{isGuestClaimRedirect ? (
  <View style={styles.feedback}>
    <Text style={styles.feedbackText}>
      Create a free account to save this scan and personalize it with your goals and allergies.
    </Text>
  </View>
) : null}
```

- [ ] **Step 6: Re-run flow contract**

```bash
node --import tsx --test tests/scan/guest-scan-flow-contract.test.ts
```

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add app/guest-scan/claim.tsx app/'(auth)'/auth/signup.tsx app/'(auth)'/auth/login.tsx tests/scan/guest-scan-flow-contract.test.ts
git commit -m "feat: claim guest scan after auth"
```

### Task 6: Full Verification and Release Gate

**Files:**
- Modify: none
- Test: all files above

- [ ] **Step 1: Run focused contracts**

```bash
node --import tsx --test \
  tests/scan/guest-scan-session-storage-contract.test.ts \
  tests/scan/guest-scan-flow-contract.test.ts
node --test backend/tests/guest-scan-session-contract.test.mjs
```

Expected: all tests PASS.

- [ ] **Step 2: Run existing scan safety contracts**

```bash
node --import tsx --test \
  tests/scan/personalized-insights-coach-overlay-contract.test.ts \
  tests/scan/ingredient-overview-sidecar-loop-contract.test.ts
```

Expected: all tests PASS.

- [ ] **Step 3: Start Expo with guest scan enabled**

```bash
EXPO_PUBLIC_GUEST_SCAN_ENABLED=1 npx expo start --go --localhost --clear
```

Expected: Metro shows `Metro waiting on exp://127.0.0.1:8081`.

- [ ] **Step 4: Simulator smoke**

Use iOS simulator:

```text
Gate -> Start Free Scan -> camera permission if needed -> scan Sports Research 00023249011835 -> result page
```

Expected:

- Result loads without login.
- Product image appears from Cloudinary/iHerb.
- Full result is visible for this scan.
- `Keep this result` opens signup/login.
- After auth, `/guest-scan/claim` saves and returns to the result.
- Future new scans are locked unless the user is premium or eligible.

- [ ] **Step 5: Render smoke with auth required**

```bash
curl -i https://nutri-app-qn0u.onrender.com/api/enrich-stream
```

Expected: unauthenticated normal request remains rejected.

```bash
curl -i -X POST https://nutri-app-qn0u.onrender.com/api/guest-scan/sessions
```

Expected when `GUEST_SCAN_ENABLED=1`: `201` with `guestScanSessionId`, `claimToken`, and `expiresAt`.

- [ ] **Step 6: Final commit or PR**

```bash
git status --short
git log --oneline -6
```

Expected: clean status and focused guest-scan commits only.

## Self-Review Checklist

- Spec coverage: entry CTA, guest auth boundary, scan session, stream token, full one-result access, auth redirect, and result claim are all represented.
- Token safety: claim token stays in AsyncStorage and request headers/body only; never in route params.
- Scope safety: protected scan files are touched only for `source=guest_scan` metadata and access gating.
- Rollout safety: feature flag exists on both client and backend.
