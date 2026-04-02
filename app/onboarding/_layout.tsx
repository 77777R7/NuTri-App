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
    <Stack
      screenOptions={{
        headerShown: false,
        animation: 'none',
        gestureEnabled: false,
      }}
    >
      <Stack.Screen name="welcome" />
      <Stack.Screen name="data-trust" />
      <Stack.Screen name="age-range" />
      <Stack.Screen name="sex" />
      <Stack.Screen name="experience" />
      <Stack.Screen name="goals" />
      <Stack.Screen name="types" />
      <Stack.Screen name="allergy" />
      <Stack.Screen name="blocker" />
      <Stack.Screen name="setup" />
      <Stack.Screen name="plan-preview" />
      <Stack.Screen name="first-stack" />
      <Stack.Screen name="done" />
    </Stack>
  );
};

export default function OnboardingLayout() {
  return <OnboardingGate />;
}
