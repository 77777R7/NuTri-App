# NuTri Mobile App – Setup Progress

## Task 0.2 – Supabase Backend Setup ✅
- Supabase project template added (`supabase/config.toml`).
- PostgreSQL schema created for users, profiles, brands, supplements, ingredients, scans, AI analyses, and streak tracking (`supabase/migrations/20240608120000_initial_schema.sql`).
- Row Level Security policies authored for every table with user-scoped access controls (`supabase/migrations/20240608121000_row_level_security.sql`).
- Performance indexes and storage buckets configured (`supabase/migrations/20240608120500_indexes.sql`, `supabase/migrations/20240608121500_storage.sql`).
- Seed data added with 50+ supplements across Pure Encapsulations, Thorne, Sports Research, Life Extension, and Jamieson (`supabase/seed/20240608122000_seed_supplements.sql`).
- Generated TypeScript database types (`types/supabase.ts`) and Supabase client (`lib/supabase.ts`).

## Task 0.3 – Environment & Configuration ✅
- `.env.example` expanded with Supabase, AI, OCR, analytics, and API variables.
- Expo config updated to surface runtime env values (`app.config.ts`).
- Added `env.d.ts`, runtime validation (`lib/env.ts`), and centralized configuration export (`constants/Config.ts`).
- Enforced environment validation during app start (`app/_layout.tsx`).
- README refreshed with environment, Supabase, and development workflow documentation.

## Task 0.4 – Supabase Auth Integration ✅
- Supabase-driven `AuthContext` with session persistence, biometric opt-in, rate limiting, and social OAuth flows (`contexts/AuthContext.tsx`).
- Authentication screens implemented with Expo Router, Zod validation, and NativeWind styling (`app/(auth)/auth/login.tsx`, `app/(auth)/auth/signup.tsx`, `app/(auth)/auth/forgot-password.tsx`).
- Protected navigation wrapper ensures splash gating and deep link preservation for signed-out users (`components/auth/ProtectedRoute.tsx`).
- Shared UI added for forms and social sign-in (`components/auth/FormInput.tsx`, `components/auth/SocialAuthPills.tsx`).
- User profile screen updated with biometric toggle and Supabase sign-out handling (`app/(tabs)/user.tsx`).
