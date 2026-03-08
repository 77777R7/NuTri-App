# Repository Instructions

## Scan Barcode Freeze

The barcode scanning flow is currently frozen as a release-sensitive area.

Protected scope:
- `app/scan/barcode.tsx`
- `app/scan/result.tsx`
- `components/scan/**`
- `hooks/useStreamAnalysis.ts`
- `lib/auth-token.ts`
- `lib/auth-mode.ts`
- `app.config.ts` when changing scan API wiring
- `backend/src/server.ts` routes that feed scan analysis cards
- `eas.json` only when a scan QA build requires it

Rules:
- Do not modify barcode scan UX, post-scan navigation, scan result rendering, score wiring, mini score header behavior, or scan-related network flow unless the user explicitly asks for scan/barcode work.
- If a non-scan task cannot be completed safely without touching the protected scope, keep the scan change minimal and call it out explicitly before or with the change.
- Preserve these behaviors unless a user-approved fix requires otherwise:
  - release/TestFlight barcode scan does not crash after scan
  - `Product Overview -> What is it?` never hangs on first scan and must fall back safely
  - top mini score and main Nutri Score stay on the same V2 score source
  - scan result dashboard keeps the current header replacement interaction

## Local Build Artifacts

Do not commit local preview `.ipa` artifacts.
