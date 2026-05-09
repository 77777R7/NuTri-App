import '@/lib/runtime/polyfills';
import '@/lib/runtime/errorDiagnostics';
import 'react-native-reanimated';
import '../global.css';
import { useEffect } from 'react';
import { DarkTheme, DefaultTheme, ThemeProvider } from '@react-navigation/native';
import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import Toast from 'react-native-toast-message';
import * as SplashScreen from 'expo-splash-screen';

import { useColorScheme } from '@/hooks/use-color-scheme';
import { AuthProvider } from '@/contexts/AuthContext';
import { DailyCheckInProvider } from '@/contexts/DailyCheckInContext';
import { OnboardingProvider } from '@/contexts/OnboardingContext';
import { PersonalizationProvider } from '@/contexts/PersonalizationContext';
import { ProgressRangeProvider } from '@/contexts/ProgressRangeContext';
import { ScanHistoryProvider } from '@/contexts/ScanHistoryContext';
import { SavedSupplementsProvider } from '@/contexts/SavedSupplementsContext';
import { SubscriptionProvider } from '@/contexts/SubscriptionContext';
import { TransitionProvider } from '@/contexts/TransitionContext';
import { ENV } from '@/lib/env';

SplashScreen.preventAutoHideAsync().catch(() => undefined);

export default function RootLayout() {
  const colorScheme = useColorScheme();

  useEffect(() => {
    try {
      ENV.validate();
    } catch (error) {
      console.error(error);
      throw error;
    }
  }, []);

  useEffect(() => {
    SplashScreen.hideAsync().catch(() => undefined);
  }, []);

  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <SafeAreaProvider>
        <AuthProvider>
          <SubscriptionProvider>
            <SavedSupplementsProvider>
              <DailyCheckInProvider>
                <ProgressRangeProvider>
                  <ScanHistoryProvider>
                    <OnboardingProvider>
                      <PersonalizationProvider>
                        <TransitionProvider>
                          <ThemeProvider value={colorScheme === 'dark' ? DarkTheme : DefaultTheme}>
                            <Stack screenOptions={{ headerShown: false }}>
                              <Stack.Screen name="index" options={{ gestureEnabled: false }} />
                              <Stack.Screen name="(auth)" />
                              <Stack.Screen name="main" options={{ gestureEnabled: false }} />
                              <Stack.Screen name="onboarding" options={{ gestureEnabled: false }} />
                              <Stack.Screen name="scan" options={{ gestureEnabled: false }} />
                              <Stack.Screen name="paywall" options={{ gestureEnabled: false }} />
                            </Stack>
                            <StatusBar style="auto" />
                            <Toast position="bottom" />
                          </ThemeProvider>
                        </TransitionProvider>
                      </PersonalizationProvider>
                    </OnboardingProvider>
                  </ScanHistoryProvider>
                </ProgressRangeProvider>
              </DailyCheckInProvider>
            </SavedSupplementsProvider>
          </SubscriptionProvider>
        </AuthProvider>
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}
