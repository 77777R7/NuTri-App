import Constants from 'expo-constants';

const DIRECT_PUBLIC_ENV: Record<string, string | undefined> = {
  EXPO_PUBLIC_SUPABASE_URL: process.env.EXPO_PUBLIC_SUPABASE_URL,
  EXPO_PUBLIC_SUPABASE_ANON_KEY: process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY,
  EXPO_PUBLIC_OPENAI_API_KEY: process.env.EXPO_PUBLIC_OPENAI_API_KEY,
  EXPO_PUBLIC_PADDLE_OCR_ENDPOINT: process.env.EXPO_PUBLIC_PADDLE_OCR_ENDPOINT,
  EXPO_PUBLIC_API_BASE_URL: process.env.EXPO_PUBLIC_API_BASE_URL,
  EXPO_PUBLIC_SEARCH_API_BASE_URL: process.env.EXPO_PUBLIC_SEARCH_API_BASE_URL,
  EXPO_PUBLIC_REVENUECAT_IOS_API_KEY: process.env.EXPO_PUBLIC_REVENUECAT_IOS_API_KEY,
  EXPO_PUBLIC_REVENUECAT_ANDROID_API_KEY: process.env.EXPO_PUBLIC_REVENUECAT_ANDROID_API_KEY,
  EXPO_PUBLIC_REVENUECAT_ENTITLEMENT_ID: process.env.EXPO_PUBLIC_REVENUECAT_ENTITLEMENT_ID,
  EXPO_PUBLIC_SCAN_TERMINAL_LOCK_ENABLED: process.env.EXPO_PUBLIC_SCAN_TERMINAL_LOCK_ENABLED,
  EXPO_PUBLIC_API_PORT: process.env.EXPO_PUBLIC_API_PORT,
};

const toExpoPublicEnvKey = (key: string) => {
  return `EXPO_PUBLIC_${key.replace(/([A-Z])/g, '_$1').toUpperCase()}`;
};

const guessDevApiBaseUrl = (): string | undefined => {
  const expoConfig = Constants.expoConfig as (typeof Constants['expoConfig'] & { debuggerHost?: string }) | null;
  const legacyManifest = Constants.manifest as (typeof Constants['manifest'] & {
    hostUri?: string;
    debuggerHost?: string;
  }) | null;

  const hostUri =
    expoConfig?.hostUri ??
    expoConfig?.debuggerHost ??
    legacyManifest?.hostUri ??
    legacyManifest?.debuggerHost;

  if (!hostUri) {
    return undefined;
  }

  const normalized = hostUri.includes('://') ? hostUri : `http://${hostUri}`;

  try {
    const url = new URL(normalized);
    const host = url.hostname;
    if (!host) {
      return undefined;
    }
    // Local backend defaults to 3001 (see backend/src/server.ts). When EXPO_PUBLIC_API_BASE_URL
    // is not set, we guess a dev URL from the Expo host. Defaulting to 3001 avoids
    // "works in browser but device can't connect" confusion in the common setup.
    const port = process.env.EXPO_PUBLIC_API_PORT ?? process.env.API_PORT ?? '3001';
    const protocol =
      host === 'localhost' ||
        host.startsWith('127.') ||
        host.startsWith('10.') ||
        host.startsWith('172.') ||
        host.startsWith('192.168.')
        ? 'http'
        : url.protocol.replace(':', '') || 'https';

    return `${protocol}://${host}:${port}`;
  } catch {
    return undefined;
  }
};

const shouldPreferFallback = (rawValue: string): boolean => {
  if (!rawValue) return false;

  const ensureProtocol = (value: string) => (value.includes('://') ? value : `http://${value}`);

  try {
    const { hostname } = new URL(ensureProtocol(rawValue));
    if (!hostname) return false;

    const loopbackHosts = ['localhost', '127.0.0.1', '0.0.0.0', '::1'];
    if (loopbackHosts.includes(hostname)) {
      return true;
    }

    // Android emulator loopback
    if (hostname === '10.0.2.2') {
      return true;
    }

    return false;
  } catch {
    return false;
  }
};

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
  return hostname === 'localhost'
    || hostname === '127.0.0.1'
    || hostname === '0.0.0.0'
    || hostname === '::1'
    || hostname === '10.0.2.2';
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

const resolveDevApiUrlMismatch = (params: {
  label: string;
  configured: string | undefined;
  fallback: string | undefined;
}): string | undefined => {
  const { configured, fallback, label } = params;
  if (!configured) return fallback;
  if (!fallback) return configured;
  if (process.env.NODE_ENV === 'production') return configured;
  if (process.env.EXPO_PUBLIC_DEV_API_HOST_MODE?.toLowerCase() === 'env_only') {
    return configured;
  }

  const configuredHost = parseHostname(configured);
  const fallbackHost = parseHostname(fallback);
  if (!configuredHost || !fallbackHost) return configured;
  if (configuredHost === fallbackHost) return configured;
  if (isLoopbackHost(configuredHost)) return fallback;

  // When LAN IP changed after reconnecting Wi-Fi/hotspot, Expo host reflects the
  // current device-reachable IP. Prefer it to avoid stale env values breaking SSE.
  if (isPrivateLanHost(configuredHost) && isPrivateLanHost(fallbackHost)) {
    console.warn(
      `[env] ${label} host (${configuredHost}) differs from Expo host (${fallbackHost}); using ${fallback}. Set EXPO_PUBLIC_DEV_API_HOST_MODE=env_only to force env value.`,
    );
    return fallback;
  }

  return configured;
};

type GetEnvValueOptions = {
  fallback?: string;
  optional?: boolean;
};

const parseOptionalBoolean = (value: string | undefined | null, fallback: boolean): boolean => {
  if (typeof value !== 'string') return fallback;
  const normalized = value.trim().toLowerCase();
  if (normalized === '1' || normalized === 'true' || normalized === 'yes') return true;
  if (normalized === '0' || normalized === 'false' || normalized === 'no') return false;
  return fallback;
};

const getEnvValue = (key: string, options?: GetEnvValueOptions): string | undefined => {
  const extra = (Constants.expoConfig?.extra ?? {}) as Record<string, unknown>;
  const extraValue = extra[key];
  const envKey = toExpoPublicEnvKey(key);
  const envValue = DIRECT_PUBLIC_ENV[envKey] ?? process.env[envKey] ?? process.env[key];
  const value = (extraValue ?? envValue) as string | undefined;

  if (value && value.length > 0) {
    if (options?.fallback && shouldPreferFallback(value)) {
      return options.fallback;
    }
    return value;
  }

  if (options?.fallback !== undefined) {
    return options.fallback;
  }

  if (options?.optional) {
    return undefined;
  }

  throw new Error(`Environment variable "${key}" is not set`);
};

const fallbackApiBaseUrl =
  process.env.NODE_ENV !== 'production' ? guessDevApiBaseUrl() : undefined;
const apiBaseUrlRaw = getEnvValue('apiBaseUrl', { fallback: fallbackApiBaseUrl });
const apiBaseUrl = resolveDevApiUrlMismatch({
  label: 'EXPO_PUBLIC_API_BASE_URL',
  configured: apiBaseUrlRaw,
  fallback: fallbackApiBaseUrl,
});

const envValues = {
  supabaseUrl: getEnvValue('supabaseUrl'),
  supabaseAnonKey: getEnvValue('supabaseAnonKey'),
  openAiApiKey: getEnvValue('openAiApiKey', { optional: true }),
  paddleOcrEndpoint: getEnvValue('paddleOcrEndpoint', { optional: true }),
  apiBaseUrl,
  sentryDsn: getEnvValue('sentryDsn', { optional: true }),
  posthogApiKey: getEnvValue('posthogApiKey', { optional: true }),
  revenueCatIosApiKey: getEnvValue('revenueCatIosApiKey', { optional: true }),
  revenueCatAndroidApiKey: getEnvValue('revenueCatAndroidApiKey', { optional: true }),
  revenueCatEntitlementId: getEnvValue('revenueCatEntitlementId', { optional: true }),
  scanTerminalLockEnabled: getEnvValue('scanTerminalLockEnabled', { optional: true }),
};

// Keep search endpoint aligned with the same localhost->LAN fallback logic as apiBaseUrl.
// This prevents real-device SSE failures when .env still points to localhost.
const searchApiFallback = envValues.apiBaseUrl;
const searchApiBaseUrlRaw = getEnvValue('searchApiBaseUrl', {
  optional: true,
  fallback: searchApiFallback,
});
const searchApiBaseUrl = resolveDevApiUrlMismatch({
  label: 'EXPO_PUBLIC_SEARCH_API_BASE_URL',
  configured: searchApiBaseUrlRaw ?? searchApiFallback,
  fallback: searchApiFallback,
}) ?? envValues.apiBaseUrl;

const ensureValidUrl = (value: string | undefined | null, label: string, required: boolean, errors: string[], warnings: string[]) => {
  if (!value) {
    if (required) {
      errors.push(`Missing required environment variable "${label}" or it is empty.`);
    }
    return;
  }

  try {
    new URL(value);
  } catch {
    const target = required ? errors : warnings;
    target.push(`Environment variable "${label}" must be a valid URL. Received "${value}".`);
  }
};

const ensureMatches = (
  value: string | undefined | null,
  label: string,
  pattern: RegExp,
  required: boolean,
  errors: string[],
  warnings: string[],
) => {
  if (!value) {
    if (required) {
      errors.push(`Missing required environment variable "${label}" or it is empty.`);
    }
    return;
  }

  if (!pattern.test(value)) {
    const target = required ? errors : warnings;
    target.push(`Environment variable "${label}" is not in the expected format.`);
  }
};

const validateEnv = () => {
  const errors: string[] = [];
  const warnings: string[] = [];

  ensureValidUrl(envValues.supabaseUrl, 'EXPO_PUBLIC_SUPABASE_URL', true, errors, warnings);
  ensureMatches(envValues.supabaseAnonKey, 'EXPO_PUBLIC_SUPABASE_ANON_KEY', /^[-_A-Za-z0-9]{10,}\.?[-_A-Za-z0-9=]*\.?[-_A-Za-z0-9=]*$/, true, errors, warnings);
  ensureMatches(envValues.openAiApiKey, 'EXPO_PUBLIC_OPENAI_API_KEY', /^sk-[A-Za-z0-9]{20,}$/, false, errors, warnings);
  ensureValidUrl(envValues.apiBaseUrl, 'EXPO_PUBLIC_API_BASE_URL', true, errors, warnings);
  ensureValidUrl(searchApiBaseUrl, 'EXPO_PUBLIC_SEARCH_API_BASE_URL', false, errors, warnings);

  ensureValidUrl(envValues.paddleOcrEndpoint, 'EXPO_PUBLIC_PADDLE_OCR_ENDPOINT', false, errors, warnings);
  ensureValidUrl(envValues.sentryDsn, 'SENTRY_DSN', false, errors, warnings);
  if (envValues.posthogApiKey) {
    ensureMatches(envValues.posthogApiKey, 'POSTHOG_API_KEY', /^[A-Za-z0-9_]{10,}$/, false, errors, warnings);
  } else {
    warnings.push('POSTHOG_API_KEY is not set. Analytics events will be disabled.');
  }

  if (warnings.length > 0) {
    warnings.forEach((warning) => console.warn(`[env] ${warning}`));
  }

  if (errors.length > 0) {
    const errorMessage = errors.join('\n');
    throw new Error(`Environment configuration is invalid:\n${errorMessage}`);
  }
};

export const ENV = {
  supabaseUrl: envValues.supabaseUrl as string,
  supabaseAnonKey: envValues.supabaseAnonKey as string,
  openAiApiKey: envValues.openAiApiKey ?? null,
  paddleOcrEndpoint: envValues.paddleOcrEndpoint ?? null,
  apiBaseUrl: envValues.apiBaseUrl as string,
  sentryDsn: envValues.sentryDsn ?? null,
  posthogApiKey: envValues.posthogApiKey ?? null,
  revenueCatIosApiKey: envValues.revenueCatIosApiKey ?? null,
  revenueCatAndroidApiKey: envValues.revenueCatAndroidApiKey ?? null,
  revenueCatEntitlementId: envValues.revenueCatEntitlementId ?? null,
  searchApiBaseUrl: searchApiBaseUrl as string,
  scanTerminalLockEnabled: parseOptionalBoolean(envValues.scanTerminalLockEnabled, false),
  validate: validateEnv,
};
