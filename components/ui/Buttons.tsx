import React from 'react';
import { Pressable, StyleProp, Text, ViewStyle } from 'react-native';
import * as Haptics from 'expo-haptics';

import { colors, radii } from '@/lib/theme';

type ButtonProps = {
  title: string;
  onPress: () => void;
  disabled?: boolean;
  style?: StyleProp<ViewStyle>;
  testID?: string;
};

export function PrimaryButton({ title, onPress, disabled, style, testID }: ButtonProps) {
  return (
    <Pressable
      testID={testID}
      disabled={disabled}
      onPress={async () => {
        if (disabled) return;
        await Haptics.selectionAsync();
        onPress();
      }}
      style={({ pressed }) => [
        {
          height: 56,
          borderRadius: radii.full,
          backgroundColor: disabled ? '#A7F3D0' : colors.brand,
          alignItems: 'center',
          justifyContent: 'center',
          shadowColor: '#000',
          shadowOpacity: 0.12,
          shadowRadius: 8,
          shadowOffset: { width: 0, height: 4 },
          transform: [{ scale: pressed ? 0.98 : 1 }],
        },
        style,
      ]}
      accessibilityRole="button"
      accessibilityLabel={title}
    >
      <Text style={{ color: '#FFFFFF', fontSize: 17, fontWeight: '800' }}>{title}</Text>
    </Pressable>
  );
}

export function SecondaryButton({ title, onPress, disabled, style, testID }: ButtonProps) {
  return (
    <Pressable
      testID={testID}
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => [
        {
          height: 56,
          borderRadius: radii.full,
          borderWidth: 1,
          borderColor: colors.border,
          backgroundColor: colors.surface,
          alignItems: 'center',
          justifyContent: 'center',
          transform: [{ scale: pressed ? 0.98 : 1 }],
          opacity: disabled ? 0.6 : 1,
        },
        style,
      ]}
      accessibilityRole="button"
      accessibilityLabel={title}
    >
      <Text style={{ color: colors.text, fontSize: 16, fontWeight: '700' }}>{title}</Text>
    </Pressable>
  );
}
