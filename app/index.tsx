import { Redirect } from 'expo-router';

import { Config } from '@/constants/Config';
import { useAuth } from '@/contexts/AuthContext';
import { useOnboarding } from '@/contexts/OnboardingContext';
import { AUTH_DISABLED } from '@/lib/auth-mode';

export default function AppIndex() {
  const { session, loading } = useAuth();
  const { loading: onboardingLoading, onbCompleted } = useOnboarding();

  if (AUTH_DISABLED) {
    return <Redirect href="/main" />;
  }

  if (loading) {
    return null;
  }

  if (!session) {
    if (Config.guestScanEnabled) {
      return <Redirect href="/(auth)/gate" />;
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
