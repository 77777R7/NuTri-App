# Guest Scan / Start Free Scan Design Spec

## Goal

Let a new user tap **Start Free Scan**, scan one supplement before account creation, see one full scan result, then sign up or sign in to keep that result. This is a separate larger initiative from the compact onboarding and scan-result coach overlay package.

## Product Thesis

NuTri's earliest activation moment is not completing onboarding. It is seeing a real supplement result for a real product. The guest scan path should reduce first-session friction while still making account creation meaningful: an account is how the user keeps the scan, applies goals/allergies, and continues after the one-time reveal.

## Non-Goals

- Do not change the normal logged-in onboarding sequence.
- Do not redesign barcode camera UX in the planning package.
- Do not mix this with backend image hotfix work from `release/rc-1`.
- Do not make guest scan an unlimited anonymous analysis mode.
- Do not put claim tokens in URLs, analytics payloads, or visible route params.

## Current Code Context

- `app/index.tsx` currently sends signed-out users to `/auth/login`.
- `app/(auth)/gate.tsx` is the natural unauthenticated entry screen and already says "Let's scan your supplement".
- `app/scan/barcode.tsx` already creates a local `ScanSession` with `source`, `onboardingDraftSnapshot`, and a persisted session envelope.
- `app/scan/result.tsx` already supports first-scan reveal state, full/locked access, scan history save, and a `source`-driven origin path.
- `hooks/useStreamAnalysis.ts` always calls `/api/enrich-stream` and relies on `withAuthHeaders`.
- `backend/src/server.ts` protects `/api/enrich-stream` with `verifySupabaseToken`; production anonymous requests will 401.
- `hooks/useFirstScanReveal.ts` already scopes local reveal state to `guest` when no user exists and remote state to `user_profiles` when authenticated.
- `app/(auth)/auth/login.tsx` honors `postAuthRedirect` and `redirect`; `app/(auth)/auth/signup.tsx` does not yet mirror that redirect behavior.

## Proposed Flow

1. Signed-out user lands on `/(auth)/gate`.
2. User taps **Start Free Scan**.
3. Client calls `POST /api/guest-scan/sessions`.
4. Backend creates a short-lived guest scan session and returns:
   - `guestScanSessionId`
   - `claimToken`
   - `expiresAt`
5. Client stores the claim token in AsyncStorage only.
6. Client opens `/scan/barcode?source=guest_scan&guestScanSessionId=<id>`.
7. Barcode scan creates a regular `ScanSession` with:
   - `source: "guest_scan"`
   - `guestScanSessionId`
8. Result page streams through `/api/enrich-stream` with guest headers:
   - `X-NuTri-Guest-Scan-Session`
   - `X-NuTri-Guest-Claim-Token`
9. Backend validates the guest scan token and allows this one stream.
10. Result page shows full access for that scan only.
11. User taps a keep/save/account CTA.
12. Client sends user to auth with `postAuthRedirect=/guest-scan/claim?guestScanSessionId=<id>&returnTo=<encoded-result-route>`.
13. After auth, `app/guest-scan/claim.tsx` reads the token from local storage and calls `POST /api/guest-scan/claim` with bearer auth.
14. Backend atomically marks the guest scan claimed by `user.id`.
15. Client refreshes first-scan reveal state and returns to the result or paywall continuation route.

## State Model

```ts
export type GuestScanStatus =
  | "created"
  | "scanning"
  | "result_started"
  | "result_ready"
  | "claim_pending"
  | "claimed"
  | "expired";

export type GuestScanSession = {
  schemaVersion: 1;
  guestScanSessionId: string;
  claimToken: string;
  scanSessionId: string | null;
  barcode: string | null;
  status: GuestScanStatus;
  source: "guest_scan";
  createdAt: string;
  expiresAt: string;
  claimedUserId: string | null;
  claimedAt: string | null;
  claimFailureReason: string | null;
};
```

## Backend Persistence

Use a dedicated table instead of overloading `barcode_scans`.

```sql
create table if not exists public.guest_scan_sessions (
  id uuid primary key default gen_random_uuid(),
  claim_token_hash text not null,
  scan_session_id text,
  barcode_gtin14 text,
  status text not null default 'created',
  product_name text,
  brand_name text,
  product_image_url text,
  result_identity_type text,
  result_identity_value text,
  claimed_user_id uuid references auth.users(id),
  claimed_at timestamptz,
  expires_at timestamptz not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists guest_scan_sessions_claim_token_hash_idx
  on public.guest_scan_sessions (claim_token_hash);

create index if not exists guest_scan_sessions_claimed_user_idx
  on public.guest_scan_sessions (claimed_user_id, claimed_at desc);
```

The raw claim token is returned once to the device. The server stores only a hash.

## Security Rules

- One guest session supports one barcode stream.
- Claim token expires after 30 minutes.
- Anonymous session creation is rate-limited by IP and device-ish headers.
- Claim requires bearer auth and a matching local claim token.
- Claim token never appears in route params, analytics events, screenshots, or logs.
- Backend logs can include `guestScanSessionId`, but not `claimToken`.

## Access Rules

- `source=guest_scan` grants full result access only when:
  - the scan session has a valid `guestScanSessionId`, and
  - local storage has the matching claim token, and
  - backend accepted the token for this stream.
- Future scans are locked unless the user is premium or otherwise eligible.
- Existing first-scan reveal stays intact for logged-in onboarding scans.

## Copy Direction

Primary unauthenticated CTA:

```text
Start Free Scan
```

Support line:

```text
Scan one supplement first. Create an account only if you want to keep the result.
```

Result keep CTA:

```text
Keep this result
```

Auth handoff line:

```text
Create a free account to save this scan and personalize it with your goals and allergies.
```

## Measurement

Track these events with no sensitive token fields:

- `guest_scan_started`
- `guest_scan_barcode_captured`
- `guest_scan_result_started`
- `guest_scan_result_ready`
- `guest_scan_keep_tapped`
- `guest_scan_auth_started`
- `guest_scan_claim_succeeded`
- `guest_scan_claim_failed`

Core funnel:

```text
Gate view -> Start Free Scan -> barcode captured -> result ready -> keep tapped -> auth complete -> claim succeeded
```

## Release Shape

Ship behind a feature flag:

```ts
EXPO_PUBLIC_GUEST_SCAN_ENABLED=1
GUEST_SCAN_ENABLED=1
```

Recommended rollout:

1. Static contracts and backend route tests.
2. Expo simulator smoke with auth disabled in dev.
3. Production-like Render smoke with `GUEST_SCAN_ENABLED=1` and auth required.
4. Enable CTA for a small cohort.

## Open Product Decision

Use **Start Free Scan** as the first public CTA. Keep account creation secondary until the user has seen a real scan result.
