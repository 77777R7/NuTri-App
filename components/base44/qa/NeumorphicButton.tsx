import React, { ReactNode, useCallback, useMemo, useRef } from 'react';
import { Animated, Pressable, StyleSheet, Text, TextStyle, View, ViewStyle } from 'react-native';
import * as Haptics from 'expo-haptics';

import { colors, shadow } from '@/lib/theme';

type Variant = 'primary' | 'secondary' | 'ghost';

type NeumorphicButtonProps = {
  children: ReactNode;
  onPress?: () => void;
  disabled?: boolean;
  variant?: Variant;
  style?: ViewStyle | ViewStyle[];
};

export const NeumorphicButton = ({
  children,
  onPress,
  disabled,
  variant = 'primary',
  style,
}: NeumorphicButtonProps) => {
  const scale = useRef(new Animated.Value(1)).current;

  const handlePress = useCallback(async () => {
    if (disabled) return;
    try {
      await Haptics.selectionAsync();
    } catch {
      // noop
    }
    onPress?.();
  }, [disabled, onPress]);

  const animateTo = useCallback(
    (value: number) => {
      Animated.spring(scale, {
        toValue: value,
        speed: 16,
        bounciness: 6,
        useNativeDriver: true,
      }).start();
    },
    [scale],
  );

  const pressableStyle = useCallback(
    ({ pressed }: { pressed: boolean }) => [
      styles.base,
      styles[variant],
      disabled && styles.disabled,
      pressed && !disabled && styles.pressed,
      style,
    ],
    [disabled, style, variant],
  );

  const content = useMemo(() => {
    if (typeof children === 'string') {
      return (
        <Text style={[styles.text, textVariantStyleMap[variant], disabled && styles.disabledText]}>
          {children}
        </Text>
      );
    }

    return <View style={styles.customChild}>{children}</View>;
  }, [children, disabled, variant]);

  return (
    <Pressable
      accessibilityRole="button"
      style={pressableStyle}
      onPress={handlePress}
      onPressIn={() => !disabled && animateTo(0.97)}
      onPressOut={() => animateTo(1)}
      disabled={disabled}
    >
      <Animated.View style={{ transform: [{ scale }] }}>{content}</Animated.View>
    </Pressable>
  );
};

const styles = StyleSheet.create({
  base: {
    minHeight: 52,
    borderRadius: 28,
    paddingHorizontal: 20,
    alignItems: 'center',
    justifyContent: 'center',
    flexDirection: 'row',
    gap: 8,
  },
  primary: {
    backgroundColor: colors.brand,
    ...shadow.card,
  },
  secondary: {
    backgroundColor: colors.surfaceSoft,
    borderWidth: 1,
    borderColor: colors.border,
  },
  ghost: {
    backgroundColor: 'transparent',
  },
  pressed: {
    opacity: 0.92,
  },
  disabled: {
    backgroundColor: '#D1D5DB',
    shadowOpacity: 0,
  },
  text: {
    fontSize: 17,
    fontWeight: '600',
  },
  disabledText: {
    color: '#9CA3AF',
  },
  customChild: {
    alignItems: 'center',
    justifyContent: 'center',
  },
});

const textVariantStyleMap: Record<Variant, TextStyle> = {
  primary: { color: colors.surface },
  secondary: { color: colors.text },
  ghost: { color: colors.text },
};
