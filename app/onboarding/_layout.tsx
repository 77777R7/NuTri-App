import 'react-native-reanimated';
import { useEffect } from 'react';
import { Stack } from 'expo-router';

import { OnboardingSkeleton } from '@/components/skeletons/OnboardingSkeleton';
import { useOnboarding } from '@/contexts/OnboardingContext';

const OnboardingGate = () => {
  const { loading } = useOnboarding();

  useEffect(() => {
    if (!loading) {
      console.log('🧭 Onboarding stack ready');
    }
  }, [loading]);

  if (loading) {
    return <OnboardingSkeleton />;
  }

  return (
    <Stack screenOptions={{ headerShown: false }}>
      <Stack.Screen name="welcome" options={{ gestureEnabled: false }} />
    </Stack>
  );
};

export default function OnboardingLayout() {
  return <OnboardingGate />;
}
