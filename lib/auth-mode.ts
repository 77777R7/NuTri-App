import Constants from 'expo-constants';
import { resolveAuthDisabled } from './auth-mode-policy';

const appExtra = (Constants.expoConfig?.extra as Record<string, unknown> | undefined) ?? {};
const extraDisableAuthRaw = typeof appExtra.disableAuth === 'string' ? appExtra.disableAuth : null;
const extraForceAuthRaw = typeof appExtra.forceAuth === 'string' ? appExtra.forceAuth : null;

const disableFromEnv =
  process.env.EXPO_PUBLIC_DISABLE_AUTH === 'true' ||
  process.env.EXPO_PUBLIC_DISABLE_AUTH === '1';
const forceAuthFromEnv =
  process.env.EXPO_PUBLIC_FORCE_AUTH === 'true' ||
  process.env.EXPO_PUBLIC_FORCE_AUTH === '1';
const disableFromExtra =
  extraDisableAuthRaw === 'true' ||
  extraDisableAuthRaw === '1';
const forceAuthFromExtra =
  extraForceAuthRaw === 'true' ||
  extraForceAuthRaw === '1';

const appOwnership = Constants.appOwnership;
const isExpoGo = appOwnership === 'expo' || appOwnership === 'guest';
const apiBaseFromConfig = (Constants.expoConfig?.extra as Record<string, unknown> | undefined)
  ?.apiBaseUrl;

const parseHostname = (rawValue: string | null | undefined): string | null => {
  if (!rawValue || typeof rawValue !== 'string') return null;
  const normalized = rawValue.includes('://') ? rawValue : `http://${rawValue}`;
  try {
    return new URL(normalized).hostname || null;
  } catch {
    return null;
  }
};

const isPrivateOrLoopbackHost = (hostname: string | null): boolean => {
  if (!hostname) return false;
  if (
    hostname === 'localhost'
    || hostname === '127.0.0.1'
    || hostname === '0.0.0.0'
    || hostname === '::1'
    || hostname === '10.0.2.2'
  ) {
    return true;
  }
  if (hostname.startsWith('10.')) return true;
  if (hostname.startsWith('192.168.')) return true;
  const matched172 = hostname.match(/^172\.(\d{1,3})\./);
  if (!matched172) return false;
  const secondOctet = Number(matched172[1]);
  return Number.isFinite(secondOctet) && secondOctet >= 16 && secondOctet <= 31;
};

const apiHost = parseHostname(typeof apiBaseFromConfig === 'string' ? apiBaseFromConfig : null);
const disableForPrivateApiHost = isPrivateOrLoopbackHost(apiHost);
const isDevRuntime = typeof __DEV__ !== 'undefined' && __DEV__;

export const AUTH_DISABLED = resolveAuthDisabled({
  disableFromEnv,
  forceAuthFromEnv,
  disableFromExtra,
  forceAuthFromExtra,
  isExpoGo,
  disableForPrivateApiHost,
  isDevRuntime,
});
export const AUTH_FALLBACK_PATH = AUTH_DISABLED ? '/main' : '/gate';
