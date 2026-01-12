import { Redirect } from 'expo-router';

import { useAuth } from '@/contexts/AuthContext';
import { AUTH_DISABLED } from '@/lib/auth-mode';

export default function AppIndex() {
  const { session, loading } = useAuth();

  if (AUTH_DISABLED) {
    return <Redirect href="/main" />;
  }

  if (loading) {
    return null;
  }

  if (!session) {
    return <Redirect href="/(auth)/gate" />;
  }

  return <Redirect href="/main" />;
}
