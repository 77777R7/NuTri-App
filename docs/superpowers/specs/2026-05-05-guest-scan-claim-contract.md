# Guest Scan Claim Contract

## Source

Extracted and re-scoped from `codex/guest-scan-start-free-scan-plan`.
This document keeps only the guest scan / Start Free Scan claim design and
implementation contracts. It intentionally excludes onboarding copy changes,
science sidecar fixes, Home layout changes, barcode UX redesign, and any
backend image hotfix work.

## Goal

Let a signed-out user tap **Start Free Scan**, scan one supplement, view that
one result, and then sign up or sign in to keep it.

Activation remains product-first:

```text
Start Free Scan -> barcode captured -> result_ready -> keep tapped -> auth complete -> claim succeeded
```

## Non-Goals

- Do not change the compact logged-in onboarding flow.
- Do not redesign barcode camera UX.
- Do not change score wiring, mini score header behavior, or dashboard rendering.
- Do not make guest scan an unlimited anonymous analysis mode.
- Do not use `X-Auth-Disabled` for production guest scan access.
- Do not put `claimToken` in URLs, route params, analytics payloads, screenshots, or logs.

## Feature Flags

Client flag:

```text
EXPO_PUBLIC_GUEST_SCAN_ENABLED=1
```

Backend flag:

```text
GUEST_SCAN_ENABLED=1
```

When the client flag is off, signed-out users should keep the current auth
entry behavior. When the backend flag is off, guest session creation and claim
routes must return a controlled unavailable response.

## Required Client Surfaces

- `lib/env.ts`
  - Reads `EXPO_PUBLIC_GUEST_SCAN_ENABLED`.
- `constants/Config.ts`
  - Exposes `guestScanEnabled`.
- `app/(auth)/gate.tsx`
  - Shows **Start Free Scan** behind `Config.guestScanEnabled`.
  - Calls the guest session create API.
  - Routes to `/scan/barcode` with `source=guest_scan` and `guestScanSessionId`.
  - Never routes with `claimToken`.
- `app/index.tsx`
  - Lets signed-out users reach the auth gate when guest scan is enabled.
- `lib/api/guestScan.ts`
  - Calls `/api/guest-scan/session`.
  - Calls `/api/guest-scan/claim`.
  - Delegates token persistence to local guest session storage.
- `lib/scan/guestSession.ts`
  - Stores guest scan sessions in AsyncStorage.
  - Stores raw `claimToken` locally only.
  - Supports create, lookup, update scan metadata, mark claim pending, mark claimed, mark failed, and clear.
- `lib/scan/session.ts`
  - Adds optional `guestScanSessionId` to `ScanSession`.
- `app/scan/barcode.tsx`
  - Carries `guestScanSessionId` from route params into `ScanSession` only when `source=guest_scan`.
  - Records barcode and scan session metadata into local guest session storage.
- `hooks/useStreamAnalysis.ts`
  - Accepts `guestScanSessionId` and `scanSessionId`.
  - Reads local guest session storage.
  - Adds guest headers only for guest scans.
- `app/scan/result.tsx`
  - Treats the validated guest scan as a one-result full reveal.
  - Sends keep/save action through the claim handoff instead of normal saved-stack behavior while signed out.
  - Routes post-auth to `/guest-scan/claim`.
- `app/guest-scan/claim.tsx`
  - Reads `guestScanSessionId` from route params.
  - Reads `claimToken` from AsyncStorage.
  - Calls backend claim with bearer auth.
  - Never reads a token from URL params.
- `app/(auth)/auth/login.tsx`
  - Preserves guest claim `postAuthRedirect`.
- `app/(auth)/auth/signup.tsx`
  - Mirrors login redirect behavior for guest claim handoff.

## Required Backend Surfaces

- `backend/src/guestScanSessions.ts`
  - Creates short-lived guest scan sessions.
  - Generates a random claim token.
  - Stores only `claim_token_hash`, never raw `claimToken`.
  - Validates guest session id, claim token, expiry, and one-scan status.
  - Records stream/result progress.
  - Atomically claims the guest scan for the authenticated user.
- `backend/src/server.ts`
  - Adds `POST /api/guest-scan/session`.
  - Adds `POST /api/guest-scan/claim`.
  - Lets `/api/enrich-stream` accept either Supabase auth or valid guest scan auth.
  - Does not use auth-disabled bypass for guest scan.
- `supabase/migrations/*_guest_scan_sessions.sql`
  - Adds `public.guest_scan_sessions`.
  - Enables RLS.
  - Revokes anon/authenticated direct table access.
  - Grants service-role access.

## Headers

Guest enrich-stream requests must send:

```text
X-Guest-Scan-Session-Id: <guestScanSessionId>
X-Guest-Scan-Claim-Token: <local claimToken>
X-Scan-Session-Id: <scanSessionId>
```

Header rules:

- Header names are not route params.
- Tokens must not be logged.
- Tokens must not be emitted in analytics.
- Guest headers should only be attached when `source=guest_scan`.

## Backend Table Contract

Minimum fields:

```sql
guest_scan_sessions (
  id uuid primary key,
  claim_token_hash text not null,
  scan_session_id text,
  barcode_gtin14 text,
  status text not null,
  product_name text,
  brand_name text,
  product_image_url text,
  result_identity_type text,
  result_identity_value text,
  claimed_user_id uuid,
  claimed_at timestamptz,
  expires_at timestamptz not null,
  created_at timestamptz not null,
  updated_at timestamptz not null
)
```

Status contract:

```text
created -> scanning -> result_started -> result_ready -> claim_pending -> claimed
```

Failure states:

```text
expired
claim_failed
```

## API Contract

Create guest session:

```http
POST /api/guest-scan/session
```

Response:

```json
{
  "guestScanSessionId": "uuid",
  "claimToken": "raw-token-returned-once",
  "expiresAt": "ISO-8601"
}
```

Claim guest scan:

```http
POST /api/guest-scan/claim
Authorization: Bearer <supabase access token>
Content-Type: application/json
```

Request:

```json
{
  "guestScanSessionId": "uuid",
  "claimToken": "local-token"
}
```

Success response:

```json
{
  "ok": true,
  "guestScanSessionId": "uuid",
  "claimedAt": "ISO-8601"
}
```

## Analytics Contract

Allowed guest events:

```text
guest_scan_started
guest_scan_barcode_captured
guest_scan_result_started
guest_scan_result_ready
guest_scan_keep_tapped
guest_scan_auth_started
guest_scan_claim_succeeded
guest_scan_claim_failed
```

Analytics payloads may include:

- `guestScanSessionId`
- `scanSessionId`
- `source`
- `status`
- non-sensitive failure reason

Analytics payloads must not include:

- `claimToken`
- Authorization header
- raw bearer token

## Release Smoke Contract

After implementation, run this Render smoke before enabling broadly:

1. `POST /api/guest-scan/session`
2. `POST /api/enrich-stream` with the guest headers above.
3. Confirm Supabase `guest_scan_sessions` row reaches `result_ready`.
4. Complete auth and call `POST /api/guest-scan/claim`.
5. Confirm row reaches `claimed` with `claimed_user_id`.
6. Confirm the result can be reopened after claim.

## Clean PR Boundary

This planning/contracts PR may add only:

- this spec
- contract tests that validate this spec

The implementation PR may touch the required client/backend surfaces listed
above, but it must stay separate from unrelated onboarding, science sidecar,
image hotfix, and barcode UX redesign work.
