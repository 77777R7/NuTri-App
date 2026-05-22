import { Redirect } from 'expo-router';

import { Config } from '@/constants/Config';
import { useAuth } from '@/contexts/AuthContext';
import { useOnboarding } from '@/contexts/OnboardingContext';
import { AUTH_DISABLED } from '@/lib/auth-mode';

const DEV_FORCE_HOME =
  typeof __DEV__ !== 'undefined' &&
  __DEV__ &&
  (process.env.EXPO_PUBLIC_DEV_FORCE_HOME === '1' ||
    process.env.EXPO_PUBLIC_DEV_FORCE_HOME === 'true');

export default function AppIndex() {
  const { session, loading } = useAuth();
  const { loading: onboardingLoading, onbCompleted, draft } = useOnboarding();

  if (DEV_FORCE_HOME) {
    return <Redirect href="/main" />;
  }

  if (AUTH_DISABLED) {
    if (onboardingLoading) {
      return null;
    }
    if (!onbCompleted || !draft) {
      return <Redirect href="/onboarding" />;
    }
    return <Redirect href="/main" />;
  }

  if (loading) {
    return null;
  }

  if (!session) {
    if (Config.guestScanEnabled) {
      return <Redirect href="/gate" />;
    }
    return <Redirect href="/auth/login" />;
  }

  if (onboardingLoading) {
    return null;
  }

  if (!onbCompleted) {
    return <Redirect href="/onboarding" />;
  }

  return <Redirect href="/main" />;
}
