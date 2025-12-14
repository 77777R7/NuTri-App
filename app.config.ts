import type { ConfigContext, ExpoConfig } from 'expo/config';
import dotenv from 'dotenv';

dotenv.config();

const NAME = 'NuTri';
const SLUG = 'nutri-app';
const SCHEME = 'nutri';
const OWNER = 'nutri000';
const BUNDLE_ID = 'com.nutri.app';
const API_BASE_URL =
  process.env.EXPO_PUBLIC_API_BASE_URL ??
  process.env.API_BASE_URL ??
  process.env.NEXT_PUBLIC_API_BASE_URL;
const SEARCH_API_BASE_URL =
  process.env.EXPO_PUBLIC_SEARCH_API_BASE_URL ??
  process.env.SEARCH_API_BASE_URL ??
  API_BASE_URL;
const SUPABASE_URL = process.env.EXPO_PUBLIC_SUPABASE_URL ?? process.env.SUPABASE_URL;
const SUPABASE_ANON_KEY =
  process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY ?? process.env.SUPABASE_ANON_KEY ?? process.env.EXPO_PUBLIC_SUPABASE_SERVICE_ANON_KEY;
const OPENAI_API_KEY = process.env.EXPO_PUBLIC_OPENAI_API_KEY ?? process.env.OPENAI_API_KEY;
const PADDLE_OCR_ENDPOINT = process.env.EXPO_PUBLIC_PADDLE_OCR_ENDPOINT ?? process.env.PADDLE_OCR_ENDPOINT;
const SENTRY_DSN = process.env.SENTRY_DSN ?? process.env.EXPO_PUBLIC_SENTRY_DSN;
const POSTHOG_API_KEY = process.env.POSTHOG_API_KEY ?? process.env.EXPO_PUBLIC_POSTHOG_API_KEY;

const createExpoConfig = ({ config }: ConfigContext): ExpoConfig => {
  return {
    ...config,
    name: NAME,
    slug: SLUG,
    scheme: SCHEME,
    owner: OWNER,
    version: config.version ?? '1.0.0',
    orientation: config.orientation ?? 'portrait',
    icon: './assets/images/icon.png',
    userInterfaceStyle: 'automatic',
    newArchEnabled: true,
    ios: {
      supportsTablet: true,
      bundleIdentifier: BUNDLE_ID,
      infoPlist: {
        NSLocationWhenInUseUsageDescription: 'NuTri uses your approximate location to personalise supplement insights and seasonal guidance.',
      },
      ...config.ios,
    },
    android: {
      package: BUNDLE_ID,
      adaptiveIcon: {
        backgroundColor: '#E6F4FE',
        foregroundImage: './assets/images/android-icon-foreground.png',
        backgroundImage: './assets/images/android-icon-background.png',
        monochromeImage: './assets/images/android-icon-monochrome.png',
      },
      edgeToEdgeEnabled: true,
      predictiveBackGestureEnabled: false,
      ...config.android,
    },
    web: {
      output: 'static',
      favicon: './assets/images/favicon.png',
      ...config.web,
    },
    plugins: [
      'expo-router',
      'expo-localization',
      [
        'expo-splash-screen',
        {
          image: './assets/images/splash-icon.png',
          imageWidth: 200,
          resizeMode: 'contain',
          backgroundColor: '#ffffff',
          dark: {
            backgroundColor: '#000000',
          },
        },
      ],
    ],
    experiments: {
      typedRoutes: true,
      reactCompiler: false,
    },
    extra: {
      apiBaseUrl: API_BASE_URL,
      supabaseUrl: SUPABASE_URL,
      supabaseAnonKey: SUPABASE_ANON_KEY,
      openAiApiKey: OPENAI_API_KEY,
      paddleOcrEndpoint: PADDLE_OCR_ENDPOINT,
      searchApiBaseUrl: SEARCH_API_BASE_URL,
      sentryDsn: SENTRY_DSN,
      posthogApiKey: POSTHOG_API_KEY,
      eas: {
        projectId: process.env.EAS_PROJECT_ID ?? config.extra?.eas?.projectId,
      },
    },
  };
};

export default createExpoConfig;
