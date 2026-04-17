import { Stack } from 'expo-router';
import React from 'react';

export default function PaywallLayout() {
  return (
    <Stack
      screenOptions={{
        headerShown: false,
        presentation: 'modal',
        animation: 'slide_from_bottom',
        gestureEnabled: false,
        contentStyle: { backgroundColor: '#F3F4F8' },
      }}
    >
      <Stack.Screen name="official" />
    </Stack>
  );
}
