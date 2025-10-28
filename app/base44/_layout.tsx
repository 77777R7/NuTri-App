import 'react-native-reanimated';
import React from 'react';
import { Stack } from 'expo-router';

import { TransitionProvider } from '@/contexts/TransitionContext';

export default function Base44Layout() {
  return (
    <TransitionProvider>
      <Stack
        screenOptions={{
          headerShown: false,
          animation: 'none',
          gestureEnabled: false,
        }}
      />
    </TransitionProvider>
  );
}
