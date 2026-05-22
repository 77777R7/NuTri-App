import type { ConfigContext, ExpoConfig } from 'expo/config';
import dotenv from 'dotenv';

dotenv.config();
dotenv.config({ path: '.env.local' });

const NAME = 'NuTri';
const SLUG = 'nutri-app';
const SCHEME = 'nutri';
const OWNER = 'nutri000';
const IOS_BUNDLE_ID = 'com.nutri-Nige.app';
const ANDROID_PACKAGE = 'com.nutri.app';
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
const PADDLE_OCR_ENDPOINT = process.env.EXPO_PUBLIC_PADDLE_OCR_ENDPOINT ?? process.env.PADDLE_OCR_ENDPOINT;
const SENTRY_DSN = process.env.SENTRY_DSN ?? process.env.EXPO_PUBLIC_SENTRY_DSN;
const POSTHOG_API_KEY = process.env.POSTHOG_API_KEY ?? process.env.EXPO_PUBLIC_POSTHOG_API_KEY;
const DISABLE_AUTH = process.env.EXPO_PUBLIC_DISABLE_AUTH ?? process.env.DISABLE_AUTH ?? '0';
const FORCE_AUTH = process.env.EXPO_PUBLIC_FORCE_AUTH ?? process.env.FORCE_AUTH ?? '0';
const GUEST_SCAN_ENABLED = process.env.EXPO_PUBLIC_GUEST_SCAN_ENABLED ?? process.env.GUEST_SCAN_ENABLED ?? '0';
const REVENUECAT_IOS_API_KEY =
  process.env.EXPO_PUBLIC_REVENUECAT_IOS_API_KEY ?? process.env.REVENUECAT_IOS_API_KEY;
const REVENUECAT_ANDROID_API_KEY =
  process.env.EXPO_PUBLIC_REVENUECAT_ANDROID_API_KEY ?? process.env.REVENUECAT_ANDROID_API_KEY;
const REVENUECAT_ENTITLEMENT_ID =
  process.env.EXPO_PUBLIC_REVENUECAT_ENTITLEMENT_ID ?? process.env.REVENUECAT_ENTITLEMENT_ID;

const parseHostname = (rawValue: string | undefined | null): string | null => {
  if (!rawValue) return null;
  const normalized = rawValue.includes('://') ? rawValue : `http://${rawValue}`;
  try {
    const url = new URL(normalized);
    return url.hostname || null;
  } catch {
    return null;
  }
};

const isLoopbackHost = (hostname: string | null): boolean => {
  if (!hostname) return false;
  return (
    hostname === 'localhost'
    || hostname === '127.0.0.1'
    || hostname === '0.0.0.0'
    || hostname === '::1'
    || hostname === '10.0.2.2'
  );
};

const isPrivateLanHost = (hostname: string | null): boolean => {
  if (!hostname) return false;
  if (hostname.startsWith('10.')) return true;
  if (hostname.startsWith('192.168.')) return true;
  const matched172 = hostname.match(/^172\.(\d{1,3})\./);
  if (matched172) {
    const secondOctet = Number(matched172[1]);
    return Number.isFinite(secondOctet) && secondOctet >= 16 && secondOctet <= 31;
  }
  return false;
};

const isReleaseBuildProfile = (): boolean => {
  const profile = String(process.env.EAS_BUILD_PROFILE ?? '').trim().toLowerCase();
  return profile === 'production' || profile === 'preview';
};

const assertReleaseApiBaseSafety = () => {
  const allowPrivateReleaseApi =
    process.env.ALLOW_PRIVATE_API_IN_RELEASE === '1'
    || process.env.EXPO_PUBLIC_ALLOW_PRIVATE_API_IN_RELEASE === '1';
  if (!isReleaseBuildProfile() || allowPrivateReleaseApi) return;

  const apiHost = parseHostname(API_BASE_URL);
  const searchHost = parseHostname(SEARCH_API_BASE_URL);

  const unsafeApi = isLoopbackHost(apiHost) || isPrivateLanHost(apiHost);
  const unsafeSearch = isLoopbackHost(searchHost) || isPrivateLanHost(searchHost);
  if (!unsafeApi && !unsafeSearch) return;

  const profile = String(process.env.EAS_BUILD_PROFILE ?? 'unknown');
  const unsafeParts: string[] = [];
  if (unsafeApi) unsafeParts.push(`apiBaseUrl=${API_BASE_URL}`);
  if (unsafeSearch) unsafeParts.push(`searchApiBaseUrl=${SEARCH_API_BASE_URL}`);
  throw new Error(
    `[app.config] Refusing ${profile} build with private/local API host(s): ${unsafeParts.join(', ')}. `
    + 'Set EXPO_PUBLIC_API_BASE_URL / EXPO_PUBLIC_SEARCH_API_BASE_URL to a public HTTPS endpoint (Render). '
    + 'For emergency local testing only, set ALLOW_PRIVATE_API_IN_RELEASE=1.',
  );
};

const createExpoConfig = ({ config }: ConfigContext): ExpoConfig => {
  assertReleaseApiBaseSafety();

  const easProjectId =
    process.env.EAS_PROJECT_ID || config.extra?.eas?.projectId || 'bf32fe60-8187-4534-bb7d-50d68b668ac8';

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
      bundleIdentifier: IOS_BUNDLE_ID,
      usesAppleSignIn: true,
      ...config.ios,
      infoPlist: {
        ...config.ios?.infoPlist,
        ITSAppUsesNonExemptEncryption: false,
        NSCameraUsageDescription: 'NuTri uses the camera to scan supplement barcodes and show product analysis.',
      },
    },
    android: {
      package: ANDROID_PACKAGE,
      adaptiveIcon: {
        backgroundColor: '#F2F2F2',
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
      'expo-notifications',
      'expo-secure-store',
      'expo-web-browser',
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
      paddleOcrEndpoint: PADDLE_OCR_ENDPOINT,
      searchApiBaseUrl: SEARCH_API_BASE_URL,
      disableAuth: DISABLE_AUTH,
      forceAuth: FORCE_AUTH,
      guestScanEnabled: GUEST_SCAN_ENABLED,
      sentryDsn: SENTRY_DSN,
      posthogApiKey: POSTHOG_API_KEY,
      revenueCatIosApiKey: REVENUECAT_IOS_API_KEY,
      revenueCatAndroidApiKey: REVENUECAT_ANDROID_API_KEY,
      revenueCatEntitlementId: REVENUECAT_ENTITLEMENT_ID,
      eas: {
        projectId: easProjectId,
      },
    },
  };
};

export default createExpoConfig;
