import React from 'react';
import { Pressable, Text, View } from 'react-native';
import { useRouter, useNavigation, type Href } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { colors, spacing } from '@/lib/theme';

type AppHeaderProps = {
  title?: string;
  showBack?: boolean;
  fallbackHref?: Href;
  onBackPress?: () => void;
};

const DEFAULT_FALLBACK: Href = '/(auth)/gate';

export default function AppHeader({
  title,
  showBack = true,
  fallbackHref = DEFAULT_FALLBACK,
  onBackPress,
}: AppHeaderProps) {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const navigation = useNavigation<any>();

  const handleBack = () => {
    if (typeof onBackPress === 'function') {
      onBackPress();
      return;
    }

    if (navigation?.canGoBack?.()) {
      navigation.goBack();
      return;
    }

    router.replace(fallbackHref);
  };

  return (
    <View
      style={{
        paddingTop: insets.top + spacing.sm,
        paddingHorizontal: spacing.lg,
        paddingBottom: spacing.sm,
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
      }}
    >
      {showBack ? (
        <Pressable
          onPress={handleBack}
          hitSlop={8}
          style={{
            padding: 8,
            borderRadius: 999,
            backgroundColor: 'rgba(0,0,0,0.04)',
          }}
          accessibilityRole="button"
          accessibilityLabel="Back"
        >
          <Text style={{ fontSize: 20, fontWeight: '700', color: colors.text }}>{'‹'}</Text>
        </Pressable>
      ) : (
        <View style={{ width: 36 }} />
      )}
      {title ? <Text style={{ fontSize: 14, fontWeight: '700', color: colors.subtext }}>{title}</Text> : <View />}
      <View style={{ width: 36 }} />
    </View>
  );
}
