# Scan Barcode Freeze Baseline

Date: March 8, 2026

## Purpose

This document freezes the current barcode scanning experience as the working baseline. Future fixes should avoid this area unless scan behavior is the task itself or a change is strictly necessary to keep the app working.

## Frozen User-Facing Behavior

- Barcode scan completes without the release/TestFlight crash that previously happened after scan.
- The scan result page renders the current dashboard layout and deep-category cards.
- The header title transitions from `Analysis` to the circular mini score while scrolling.
- The mini score uses the Nutri Score V2 overall score and band.
- `Product Overview -> What is it?` loads on first scan and falls back safely instead of hanging forever.
- Preview iOS builds use the current public HTTPS API endpoint strategy for local QA.

## Protected Files

- `app/scan/barcode.tsx`
- `app/scan/result.tsx`
- `components/scan/AnalysisDashboard.tsx`
- `hooks/useStreamAnalysis.ts`
- `lib/auth-token.ts`
- `lib/auth-mode.ts`
- `app.config.ts`
- `backend/src/server.ts`
- `eas.json`

## Change Policy

- Treat the files above as frozen by default.
- Do not refactor, restyle, or rewire scan behavior during unrelated work.
- If a scan-area change is unavoidable, keep the diff as small as possible and document why the freeze had to be broken.
- Re-run release-like validation after any necessary scan change.

## Minimum Validation If Freeze Is Broken

1. Scan on a release-like iOS build, not only Expo Go.
2. Confirm there is no crash immediately after barcode detection.
3. Confirm the first scan of a product shows `What is it?` content or a safe fallback.
4. Confirm the top mini score matches the main Nutri Score.
5. Confirm the scan result page still loads category cards and detail sheets.

## Baseline Work Included In This Freeze

- Hermes/worklet crash fix on scan result rendering.
- Scan dashboard fallback hardening.
- Mini score migration to Nutri Score V2.
- Header title to mini score transition.
- Product Overview first-scan fallback hardening.
