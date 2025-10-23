import { QAProvider } from '@/contexts/QAContext';
import { Stack } from 'expo-router';

export default function QALayout() {
  return (
    <QAProvider>
      <Stack
        screenOptions={{
          headerShown: false,
          animation: 'slide_from_right',
          gestureEnabled: false,
        }}
      >
        <Stack.Screen name="index" />
        <Stack.Screen name="welcome" />
        <Stack.Screen name="demographics" />
        <Stack.Screen name="physical-stats" />
        <Stack.Screen name="health-goals" />
        <Stack.Screen name="dietary" />
        <Stack.Screen name="experience" />
        <Stack.Screen name="privacy" />
      </Stack>
    </QAProvider>
  );
}

