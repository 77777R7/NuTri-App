import { Stack } from 'expo-router';
import React from 'react';

export default function ScanLayout() {
  return (
    <Stack
      screenOptions={{
        headerShown: false,
        animation: 'slide_from_right',
        presentation: 'card',
        contentStyle: { backgroundColor: '#F2F2F7' },
      }}
    >
      <Stack.Screen name="index" />
      <Stack.Screen name="barcode" />
      <Stack.Screen name="label" />
      <Stack.Screen name="result" />
    </Stack>
  );
}
