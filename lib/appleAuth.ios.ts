import * as AppleAuthentication from 'expo-apple-authentication';

// Adapter layer so the rest of the app can keep using the invertase-style API.
// This is important for Expo Go where third-party native modules are unavailable.

type PerformRequestInput = {
  requestedOperation?: number;
  requestedScopes?: number[];
};

export const appleAuth = {
  // Invertase uses `performRequest`; expo-apple-authentication uses `signInAsync`.
  // `requestedOperation` isn't supported by expo-apple-authentication, so we ignore it.
  performRequest: async ({ requestedScopes }: PerformRequestInput) => {
    const available = await AppleAuthentication.isAvailableAsync();
    if (!available) {
      throw new Error('Apple Sign-In is not available on this device.');
    }

    return AppleAuthentication.signInAsync({
      requestedScopes: (requestedScopes ?? []) as AppleAuthentication.AppleAuthenticationScope[],
    });
  },
  Operation: {
    LOGIN: AppleAuthentication.AppleAuthenticationOperation.LOGIN,
  },
  Scope: {
    FULL_NAME: AppleAuthentication.AppleAuthenticationScope.FULL_NAME,
    EMAIL: AppleAuthentication.AppleAuthenticationScope.EMAIL,
  },
};

// Not used on iOS, but exported for compatibility with existing imports.
export const appleAuthAndroid = null;

