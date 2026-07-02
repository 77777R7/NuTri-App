# NuTri - AI Supplement Scanner

NuTri is a mobile AI product for scanning supplement labels and turning messy ingredient panels into structured, personalized, evidence-checked explanations.

The project combines a React Native/Expo app, Supabase/PostgreSQL backend, OCR ingestion, and LLM-backed supplement analysis so users can search products, scan labels, save stacks, and understand ingredient/allergen tradeoffs without reading dense supplement facts panels by hand.

## Highlights

- **Real traction:** secured **$30K in angel investment** and validated demand with **100K+ organic impressions** before public launch.
- **End-to-end build:** shipped the mobile app, backend bridge, Supabase schema, auth, saved items, search, onboarding, and paywall surfaces.
- **AI scan pipeline:** turns barcode/label scans into normalized product data, OCR cache records, ingredient mappings, and user-facing supplement explanations.
- **Release discipline:** includes CI/CD and automated checks aimed at catching scan crashes, broken streaming states, auth regressions, and search failures before release.

## Product Surface

| Area | What it does |
| --- | --- |
| Scan | Barcode/label scanning with OCR-backed product analysis |
| Search | Supplement lookup with structured product and ingredient data |
| Saved stacks | Personalized supplement stack storage and retrieval |
| Auth | Supabase email/password, Google, Apple, password reset, protected routes |
| Backend | REST bridge, Supabase migrations, RLS, storage buckets, generated TypeScript types |
| Observability | Sentry/PostHog-ready configuration and release-focused environment validation |

## Tech Stack

**Mobile:** React Native, Expo Router, TypeScript  
**Backend:** Node.js, Express, REST APIs  
**Data:** Supabase, PostgreSQL, RLS policies, generated TypeScript types  
**AI:** OCR pipeline, LLM-backed supplement explanations  
**Quality:** environment validation, linting, CI/CD-ready project structure, automated scan/search checks

---

# Developer Setup

NuTri is an Expo (React Native) application for scanning nutrition supplements, storing personalized health data, and syncing with a Supabase backend.

## Prerequisites

- Node.js 18+
- npm 9+
- Expo CLI (`npm install -g expo-cli`) for local development
- Supabase CLI (`npm install -g supabase`) if you plan to run migrations or seed the local database

## Quick Start

```bash
cp .env.example .env    # fill in the secrets below
npm install
npx expo start
```

Use the Expo QR code or the `a` / `i` shortcuts to launch on Android or iOS simulators.

## Environment Configuration

All runtime configuration is centralized in `lib/env.ts`, validated during app start, and exposed via `constants/Config.ts`.

| Variable | Required | Description |
| --- | --- | --- |
| `EXPO_PUBLIC_SUPABASE_URL` | ✅ | Supabase project URL (e.g., `https://xyzcompany.supabase.co`) |
| `EXPO_PUBLIC_SUPABASE_ANON_KEY` | ✅ | Supabase anon key for client access |
| `EXPO_PUBLIC_OPENAI_API_KEY` | ✅ | OpenAI key used for on-device AI prompts |
| `EXPO_PUBLIC_PADDLE_OCR_ENDPOINT` | optional | Paddle OCR inference endpoint |
| `EXPO_PUBLIC_API_BASE_URL` | ✅ | Backend REST bridge for NuTri (defaults to local dev host) |
| `EXPO_PUBLIC_API_PORT` | optional | Helps auto-detect the API URL on emulators |
| `SENTRY_DSN` | optional | Sentry DSN for crash/error reporting |
| `POSTHOG_API_KEY` | optional | PostHog API key for analytics |
| `EAS_PROJECT_ID` | optional | Override the Expo Application Services project id |

Missing required variables cause the app to crash on boot with a descriptive error. Optional variables log a warning when absent.

## Supabase Backend

Supabase assets live under `supabase/`:

- `config.toml` – project configuration template
- `migrations/` – schema, RLS, and storage migrations
- `seed/` – seed data for brands, ingredients, and 50+ supplements

Typical local workflow:

```bash
# start the Supabase local stack
supabase start

# apply migrations and seed data
supabase db reset --seed
```

> Migrations create RLS policies, indexes, and storage buckets (`supplement-images`, `user-profile-photos`, `scan-history`). The seed script inserts 5 featured brands and 50 supplements with ingredient mappings.

The generated TypeScript types (`types/supabase.ts`) keep Supabase client calls fully typed. The client is initialized in `lib/supabase.ts` with SecureStore session persistence.

## Project Structure

- `app/` – Expo Router screens (tabs, saved items, assistant, etc.)
- `app/auth/` – Authentication flow (email/password, social, password reset)
- `constants/Config.ts` – typed configuration derived from environment variables
- `lib/` – API client, runtime env helper, Supabase client, utilities
- `supabase/` – database migrations, seed scripts, config
- `types/` – shared TypeScript declarations including Supabase database types

## Authentication

- Supabase Auth powers email/password, Google, and Apple sign-in, with client-side rate limiting (`contexts/AuthContext.tsx`).
- Authentication screens are built with React Hook Form + Zod for validation (`app/auth/*.tsx`).
- Protected routes redirect unauthenticated users to `/auth/login` while preserving deep links (`components/auth/ProtectedRoute.tsx`).
- Biometric unlock is optional and can be toggled from the Profile tab once enabled on the device.

## Scripts

| Command | Description |
| --- | --- |
| `npm run start` | Launch the Expo development server |
| `npm run android` | Build & run the Android native project |
| `npm run ios` | Build & run the iOS native project |
| `npm run web` | Run the Expo app in a web browser |
| `npm run lint` | Run ESLint checks |

## Troubleshooting

- Run `ENV.validate()` manually (imported from `@/lib/env`) when debugging environment issues.
- For physical device testing, ensure `EXPO_PUBLIC_API_BASE_URL` points to a tunnel-accessible URL (e.g., via `ngrok`).
- After changing Supabase schema, regenerate types with `npm run supabase:types`. It prefers `PROJECT_ID` when set, otherwise falls back to the linked Supabase project and then `supabase/config.toml`.
