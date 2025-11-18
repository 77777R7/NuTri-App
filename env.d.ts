declare namespace NodeJS {
  interface ProcessEnv {
    EXPO_PUBLIC_SUPABASE_URL?: string;
    EXPO_PUBLIC_SUPABASE_ANON_KEY?: string;
    EXPO_PUBLIC_OPENAI_API_KEY?: string;
    EXPO_PUBLIC_PADDLE_OCR_ENDPOINT?: string;
    EXPO_PUBLIC_API_BASE_URL?: string;
    EXPO_PUBLIC_API_PORT?: string;
    EXPO_PUBLIC_SEARCH_API_BASE_URL?: string;
    API_BASE_URL?: string;
    NEXT_PUBLIC_API_BASE_URL?: string;
    SEARCH_API_BASE_URL?: string;
    SENTRY_DSN?: string;
    POSTHOG_API_KEY?: string;
    EAS_PROJECT_ID?: string;
  }
}
