import Constants from 'expo-constants';

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
    const port = process.env.EXPO_PUBLIC_API_PORT ?? process.env.API_PORT ?? '3000';
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

type GetEnvValueOptions = {
  fallback?: string;
  optional?: boolean;
};

const getEnvValue = (key: string, options?: GetEnvValueOptions): string | undefined => {
  const extra = (Constants.expoConfig?.extra ?? {}) as Record<string, unknown>;
  const extraValue = extra[key];
  const envKey = toExpoPublicEnvKey(key);
  const envValue = process.env[envKey] ?? process.env[key];
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
  process.env.NODE_ENV !== 'production' ? guessDevApiBaseUrl() ?? 'http://localhost:3000' : undefined;

const envValues = {
  supabaseUrl: getEnvValue('supabaseUrl'),
  supabaseAnonKey: getEnvValue('supabaseAnonKey'),
  openAiApiKey: getEnvValue('openAiApiKey', { optional: true }),
  paddleOcrEndpoint: getEnvValue('paddleOcrEndpoint', { optional: true }),
  apiBaseUrl: getEnvValue('apiBaseUrl', { fallback: fallbackApiBaseUrl }),
  sentryDsn: getEnvValue('sentryDsn', { optional: true }),
  posthogApiKey: getEnvValue('posthogApiKey', { optional: true }),
};

const ensureValidUrl = (value: string | undefined | null, label: string, required: boolean, errors: string[], warnings: string[]) => {
  if (!value) {
    if (required) {
      errors.push(`Missing required environment variable "${label}" or it is empty.`);
    }
    return;
  }

  try {
    // eslint-disable-next-line no-new
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
  validate: validateEnv,
};
