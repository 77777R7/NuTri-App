import { Redirect } from 'expo-router';

import { useAuth } from '@/contexts/AuthContext';

export default function AppIndex() {
  const { session, loading } = useAuth();

  if (loading) {
    return null;
  }

  if (!session) {
    return <Redirect href="/(auth)/gate" />;
  }

  return <Redirect href="/main" />;
}
