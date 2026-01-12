import Constants from 'expo-constants';

const disableFromEnv =
  process.env.EXPO_PUBLIC_DISABLE_AUTH === 'true' ||
  process.env.EXPO_PUBLIC_DISABLE_AUTH === '1';

const appOwnership = Constants.appOwnership;
const isExpoGo = appOwnership === 'expo' || appOwnership === 'guest';

export const AUTH_DISABLED = Boolean(__DEV__) && (disableFromEnv || isExpoGo);
export const AUTH_FALLBACK_PATH = AUTH_DISABLED ? '/main' : '/(auth)/gate';
