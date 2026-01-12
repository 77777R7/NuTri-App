import React, {
  PropsWithChildren,
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { Platform } from 'react-native';
import type { Href } from 'expo-router';
import * as AuthSession from 'expo-auth-session';
import * as LocalAuthentication from 'expo-local-authentication';
import * as SecureStore from 'expo-secure-store';
import * as WebBrowser from 'expo-web-browser';
import Constants from 'expo-constants';
import { Session, User } from '@supabase/supabase-js';
import { appleAuth, appleAuthAndroid } from '@invertase/react-native-apple-authentication';

import { supabase } from '@/lib/supabase';
import { getAuthErrorMessage, RateLimitError } from '@/lib/errors';
import { parseAuthRedirectParams } from '@/lib/auth-session';
import { AUTH_DISABLED } from '@/lib/auth-mode';

WebBrowser.maybeCompleteAuthSession();

type AuthRateLimitKey = 'password' | 'signup' | 'recovery' | 'oauth';

const RATE_LIMITS: Record<AuthRateLimitKey, { windowMs: number; max: number }> = {
  password: { windowMs: 60_000, max: 5 },
  signup: { windowMs: 60_000, max: 3 },
  recovery: { windowMs: 60_000, max: 3 },
  oauth: { windowMs: 30_000, max: 6 },
};

const BIOMETRIC_STORE_KEY = 'nutri_biometrics_enabled';
const DEFAULT_REDIRECT: Href = '/main';
const EXPO_PROJECT_NAME_FOR_PROXY = '@nutri000/nutri-app';
const DEEP_LINK_SCHEME = 'nutri';
const APPLE_ANDROID_CLIENT_ID = 'com.Howard.NuTri.App.auth';
const APPLE_ANDROID_REDIRECT_URI = 'https://dlwlobgmjzcmpirwvetq.supabase.co/auth/v1/callback';

const shouldUseProxy = () => {
  const ownership = Constants.appOwnership;
  return ownership === 'expo' || ownership === 'guest';
};

const buildRedirectUri = (path?: string, { forceProxy }: { forceProxy?: boolean } = {}) => {
  const useProxy = forceProxy ?? shouldUseProxy();
  const normalizedPath = path?.replace(/^\/+/, '') ?? undefined;

  if (useProxy) {
    const suffix = normalizedPath ? `--/${normalizedPath}` : '--';
    return `https://auth.expo.dev/${EXPO_PROJECT_NAME_FOR_PROXY}/${suffix}`;
  }

  return AuthSession.makeRedirectUri({
    ...(normalizedPath ? { path: normalizedPath } : {}),
    scheme: DEEP_LINK_SCHEME,
    preferLocalhost: true,
  });
};

type AuthContextValue = {
  session: Session | null;
  user: User | null;
  token: string | null;
  loading: boolean;
  isBiometricEnabled: boolean;
  postAuthRedirect: string | null;
  error: string | null;
  signInWithPassword: (email: string, password: string) => Promise<void>;
  signUpWithPassword: (email: string, password: string) => Promise<void>;
  signOut: () => Promise<void>;
  signInWithGoogle: () => Promise<void>;
  signInWithApple: () => Promise<void>;
  requestPasswordReset: (email: string) => Promise<void>;
  enableBiometrics: () => Promise<void>;
  disableBiometrics: () => Promise<void>;
  authenticateWithBiometrics: () => Promise<boolean>;
  setPostAuthRedirect: (path: string | null) => void;
  clearError: () => void;
};

const AuthContext = createContext<AuthContextValue | undefined>(undefined);

const registerRateLimitAttempt = (store: Map<AuthRateLimitKey, number[]>, key: AuthRateLimitKey) => {
  const now = Date.now();
  const windowMs = RATE_LIMITS[key].windowMs;
  const existing = store.get(key) ?? [];
  const filtered = existing.filter(timestamp => now - timestamp < windowMs);
  filtered.push(now);
  store.set(key, filtered);
};

const assertWithinRateLimit = (store: Map<AuthRateLimitKey, number[]>, key: AuthRateLimitKey) => {
  const windowMs = RATE_LIMITS[key].windowMs;
  const max = RATE_LIMITS[key].max;
  const now = Date.now();
  const timestamps = store.get(key) ?? [];
  const filtered = timestamps.filter(timestamp => now - timestamp < windowMs);

  if (filtered.length >= max) {
    const retryAfter = windowMs - (now - filtered[0]);
    throw new RateLimitError('Too many attempts. Please wait before trying again.', retryAfter);
  }
};

export function AuthProvider({ children }: PropsWithChildren) {
  const authDisabled = AUTH_DISABLED;
  const [session, setSession] = useState<Session | null>(null);
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [isBiometricEnabled, setIsBiometricEnabled] = useState(false);
  const [postAuthRedirect, setPostAuthRedirect] = useState<string | null>(null);

  const rateLimitStore = useRef<Map<AuthRateLimitKey, number[]>>(new Map());

  const handleSessionChange = useCallback((nextSession: Session | null) => {
    setSession(nextSession);
    setUser(nextSession?.user ?? null);
  }, []);

  useEffect(() => {
    if (authDisabled) {
      handleSessionChange(null);
      setIsBiometricEnabled(false);
      setLoading(false);
      return;
    }

    let isMounted = true;

    const bootstrap = async () => {
      try {
        const [biometricFlag, sessionResponse] = await Promise.all([
          SecureStore.getItemAsync(BIOMETRIC_STORE_KEY),
          supabase.auth.getSession(),
        ]);

        const biometricEnabled = biometricFlag === 'true';
        if (isMounted) {
          setIsBiometricEnabled(biometricEnabled);
        }

        const activeSession = sessionResponse.data.session;
        if (activeSession) {
          if (biometricEnabled) {
            const biometricResult = await LocalAuthentication.authenticateAsync({
              promptMessage: 'Unlock NuTri',
              cancelLabel: 'Cancel',
              fallbackLabel: 'Use Passcode',
            });

            if (!biometricResult.success) {
              await supabase.auth.signOut();
              if (isMounted) {
                handleSessionChange(null);
              }
              return;
            }
          }

          if (isMounted) {
            handleSessionChange(activeSession);
          }
        }
      } catch (bootstrapError) {
        console.warn('[auth] bootstrap error', bootstrapError);
        if (isMounted) {
          setError(getAuthErrorMessage(bootstrapError));
        }
      } finally {
        if (isMounted) {
          setLoading(false);
        }
      }
    };

    const { data: subscription } = supabase.auth.onAuthStateChange((_event, newSession) => {
      handleSessionChange(newSession);
      setLoading(false);
    });

    bootstrap();

    return () => {
      isMounted = false;
      subscription.subscription.unsubscribe();
    };
  }, [authDisabled, handleSessionChange]);

  const withRateLimit = useCallback(
    async <T,>(key: AuthRateLimitKey, action: () => Promise<T>) => {
      try {
        assertWithinRateLimit(rateLimitStore.current, key);
        registerRateLimitAttempt(rateLimitStore.current, key);
        const result = await action();
        setError(null);
        return result;
      } catch (err) {
        const message = getAuthErrorMessage(err);
        setError(message);
        throw err;
      }
    },
    [],
  );

  const signInWithPassword = useCallback(
    async (email: string, password: string) => {
      if (authDisabled) {
        return;
      }
      await withRateLimit('password', async () => {
        const { data, error: authError } = await supabase.auth.signInWithPassword({
          email,
          password,
        });

        if (authError) {
          throw authError;
        }

        if (!data.session) {
          throw new Error('No session returned from Supabase.');
        }

        handleSessionChange(data.session);
      });
    },
    [authDisabled, handleSessionChange, withRateLimit],
  );

  const signUpWithPassword = useCallback(
    async (email: string, password: string) => {
      if (authDisabled) {
        return;
      }
      await withRateLimit('signup', async () => {
        const { data, error: authError } = await supabase.auth.signUp({
          email,
          password,
        });

        if (authError) {
          throw authError;
        }

        if (data.session) {
          handleSessionChange(data.session);
        }
      });
    },
    [authDisabled, handleSessionChange, withRateLimit],
  );

  const requestPasswordReset = useCallback(async (email: string) => {
    if (authDisabled) {
      return;
    }
    await withRateLimit('recovery', async () => {
      const redirectTo = buildRedirectUri('auth/login');

      const { error: resetError } = await supabase.auth.resetPasswordForEmail(email, {
        redirectTo,
      });

      if (resetError) {
        throw resetError;
      }
    });
  }, [authDisabled, withRateLimit]);

  const signInWithGoogle = useCallback(async () => {
    if (authDisabled) {
      return;
    }
    await withRateLimit('oauth', async () => {
      const redirectUri = buildRedirectUri('auth-callback', { forceProxy: true });
      console.log('[auth] redirectUri =>', redirectUri);

      const { data, error: authError } = await supabase.auth.signInWithOAuth({
        provider: 'google',
        options: {
          redirectTo: redirectUri,
          skipBrowserRedirect: true,
          queryParams: {
            prompt: 'select_account',
            access_type: 'offline',
          },
        },
      });

      if (authError) {
        throw authError;
      }

      if (!data?.url) {
        throw new Error('No authentication URL returned for Google sign-in.');
      }

      console.log('[auth] Google auth URL =>', data.url);

      const result = await WebBrowser.openAuthSessionAsync(data.url, redirectUri);

      await handleAuthSessionResult(result);
    });
  }, [authDisabled, withRateLimit]);

  const signInWithApple = useCallback(async () => {
    if (authDisabled) {
      return;
    }
    await withRateLimit('oauth', async () => {
      if (Platform.OS === 'ios') {
        const appleResponse = await appleAuth.performRequest({
          requestedOperation: appleAuth.Operation.LOGIN,
          requestedScopes: [appleAuth.Scope.FULL_NAME, appleAuth.Scope.EMAIL],
        });

        if (!appleResponse.identityToken) {
          throw new Error('Apple Sign-In failed: no identity token returned.');
        }

        const { error: authError } = await supabase.auth.signInWithIdToken({
          provider: 'apple',
          token: appleResponse.identityToken,
          nonce: appleResponse.nonce ?? undefined,
        });

        if (authError) {
          throw authError;
        }

        return;
      }

      if (Platform.OS === 'android') {
        appleAuthAndroid.configure({
          clientId: APPLE_ANDROID_CLIENT_ID,
          redirectUri: APPLE_ANDROID_REDIRECT_URI,
          scope: appleAuthAndroid.Scope.ALL,
          responseType: appleAuthAndroid.ResponseType.ALL,
        });

        const appleResponse = await appleAuthAndroid.signIn();

        if (!appleResponse?.id_token) {
          throw new Error('Apple Sign-In failed: no identity token returned.');
        }

        const { error: authError } = await supabase.auth.signInWithIdToken({
          provider: 'apple',
          token: appleResponse.id_token,
          nonce: appleResponse.nonce ?? undefined,
        });

        if (authError) {
          throw authError;
        }

        return;
      }

      throw new Error('Apple Sign-In is not supported on this platform.');
    });
  }, [authDisabled, withRateLimit]);

  const signOut = useCallback(async () => {
    if (authDisabled) {
      handleSessionChange(null);
      setPostAuthRedirect(null);
      return;
    }
    await supabase.auth.signOut();
    handleSessionChange(null);
    setPostAuthRedirect(null);
  }, [authDisabled, handleSessionChange]);

  const enableBiometrics = useCallback(async () => {
    if (authDisabled) {
      return;
    }
    const hasHardware = await LocalAuthentication.hasHardwareAsync();
    if (!hasHardware) {
      throw new Error('Biometric authentication is not available on this device.');
    }

    const isEnrolled = await LocalAuthentication.isEnrolledAsync();
    if (!isEnrolled) {
      throw new Error('No biometrics enrolled. Please configure Face ID or Fingerprint.');
    }

    const result = await LocalAuthentication.authenticateAsync({
      promptMessage: 'Enable biometric authentication',
    });

    if (!result.success) {
      throw new Error('Biometric authentication failed.');
    }

    await SecureStore.setItemAsync(BIOMETRIC_STORE_KEY, 'true');
    setIsBiometricEnabled(true);
  }, [authDisabled]);

  const disableBiometrics = useCallback(async () => {
    if (authDisabled) {
      setIsBiometricEnabled(false);
      return;
    }
    await SecureStore.deleteItemAsync(BIOMETRIC_STORE_KEY);
    setIsBiometricEnabled(false);
  }, [authDisabled]);

  const authenticateWithBiometrics = useCallback(async () => {
    if (authDisabled) {
      return false;
    }
    if (!isBiometricEnabled) {
      return false;
    }

    const result = await LocalAuthentication.authenticateAsync({
      promptMessage: 'Authenticate with biometrics',
    });

    if (!result.success) {
      if (result.error === 'user_fallback') {
        throw new Error('Biometric authentication cancelled.');
      }

      throw new Error('Biometric authentication failed.');
    }

    const { data } = await supabase.auth.getSession();
    if (!data.session) {
      throw new Error('Session is no longer valid. Please sign in again.');
    }

    handleSessionChange(data.session);
    return true;
  }, [authDisabled, handleSessionChange, isBiometricEnabled]);

  const contextValue = useMemo<AuthContextValue>(
    () => ({
      session,
      user,
      token: session?.access_token ?? null,
      loading,
      isBiometricEnabled,
      postAuthRedirect,
      error,
      signInWithPassword,
      signUpWithPassword,
      signOut,
      signInWithGoogle,
      signInWithApple,
      requestPasswordReset,
      enableBiometrics,
      disableBiometrics,
      authenticateWithBiometrics,
      setPostAuthRedirect,
      clearError: () => setError(null),
    }),
    [
      session,
      user,
      loading,
      isBiometricEnabled,
      postAuthRedirect,
      error,
      signInWithPassword,
      signUpWithPassword,
      signOut,
      signInWithGoogle,
      signInWithApple,
      requestPasswordReset,
      enableBiometrics,
      disableBiometrics,
      authenticateWithBiometrics,
    ],
  );

  return <AuthContext.Provider value={contextValue}>{children}</AuthContext.Provider>;
}

export const useAuth = (): AuthContextValue => {
  const value = useContext(AuthContext);
  if (!value) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return value;
};

export const getPostAuthDestination = (target: string | null | undefined): Href => {
  if (!target || target === '/' || target === '/auth/login') {
    return DEFAULT_REDIRECT;
  }
  return target as Href;
};
const handleAuthSessionResult = async (result: WebBrowser.WebBrowserAuthSessionResult) => {
  if (result.type !== 'success' || !result.url) {
    if (result.type === 'cancel' || result.type === 'dismiss') {
      throw new Error('Authentication was cancelled.');
    }

    if (result.type === 'locked') {
      throw new Error('Another authentication request is already in progress.');
    }

    throw new Error('Authentication failed to complete.');
  }

  const params = parseAuthRedirectParams(result.url);

  if (params.error) {
    throw new Error(params.error_description ?? 'Authentication failed.');
  }

  const authCode = params.code;
  if (!authCode) {
    throw new Error('Authentication failed to return an authorization code.');
  }

  const { data, error } = await supabase.auth.exchangeCodeForSession(authCode);
  if (error) {
    throw error;
  }

  if (!data.session) {
    throw new Error('No session returned from Supabase.');
  }
};
