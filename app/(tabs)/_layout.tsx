import { Tabs } from 'expo-router';
import React from 'react';

import { ProtectedRoute } from '@/components/auth/ProtectedRoute';
import { HapticTab } from '@/components/haptic-tab';
import { IconSymbol } from '@/components/ui/icon-symbol';
import { Colors } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';

export default function TabLayout() {
  const colorScheme = useColorScheme();

  return (
    <ProtectedRoute>
      <Tabs
        screenOptions={{
          tabBarActiveTintColor: Colors[colorScheme ?? 'light'].tint,
          headerShown: false,
          tabBarButton: HapticTab,
        }}
      >
        <Tabs.Screen
          name="home"
          options={{
            title: 'Home',
            tabBarIcon: ({ color }: { color: string }) => (
              <IconSymbol size={26} name="house.fill" color={color} />
            ),
          }}
        />
        <Tabs.Screen
          name="scan"
          options={{
            title: 'Scan',
            tabBarIcon: ({ color }: { color: string }) => (
              <IconSymbol size={26} name="barcode.viewfinder" color={color} />
            ),
          }}
        />
      </Tabs>
    </ProtectedRoute>
  );
}
