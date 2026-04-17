declare namespace NodeJS {
  interface ProcessEnv {
    EXPO_PUBLIC_SUPABASE_URL?: string;
    EXPO_PUBLIC_SUPABASE_ANON_KEY?: string;
    EXPO_PUBLIC_PADDLE_OCR_ENDPOINT?: string;
    EXPO_PUBLIC_API_BASE_URL?: string;
    EXPO_PUBLIC_API_PORT?: string;
    EXPO_PUBLIC_SEARCH_API_BASE_URL?: string;
    EXPO_PUBLIC_SCAN_TERMINAL_LOCK_ENABLED?: string;
    API_BASE_URL?: string;
    NEXT_PUBLIC_API_BASE_URL?: string;
    SEARCH_API_BASE_URL?: string;
    SENTRY_DSN?: string;
    POSTHOG_API_KEY?: string;
    EAS_PROJECT_ID?: string;
  }
}

// expo-router's runtime entry file doesn't ship TypeScript typings.
// Declaring it here keeps `App.tsx` type-safe without weakening project strictness.
declare module "expo-router/entry";
