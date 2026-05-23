import { Redirect } from 'expo-router';

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
  const { loading: onboardingLoading, onbCompleted } = useOnboarding();

  if (DEV_FORCE_HOME || AUTH_DISABLED) {
    return <Redirect href="/main" />;
  }

  if (loading) {
    return null;
  }

  if (!session) {
    return <Redirect href="/(auth)/gate" />;
  }

  if (onboardingLoading) {
    return null;
  }

  if (!onbCompleted) {
    return <Redirect href="/onboarding" />;
  }

  return <Redirect href="/main" />;
}
