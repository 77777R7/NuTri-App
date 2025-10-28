import React, { useCallback, useEffect, useMemo, useRef } from 'react';
import { Animated, Pressable, StyleSheet, Text, View } from 'react-native';
import type { LucideIcon } from 'lucide-react-native';
import * as Haptics from 'expo-haptics';

import { colors, radii } from '@/lib/theme';

type SelectOptionProps = {
  label: string;
  value: string;
  isSelected?: boolean;
  onSelect: (value: string) => void;
  icon?: LucideIcon;
};

export const SelectOption = ({ label, value, isSelected, onSelect, icon: Icon }: SelectOptionProps) => {
  const scale = useRef(new Animated.Value(isSelected ? 1 : 0)).current;
  const bg = useRef(new Animated.Value(isSelected ? 1 : 0)).current;

  const handlePress = useCallback(async () => {
    try {
      await Haptics.selectionAsync();
    } catch {
      // noop
    }
    onSelect(value);
  }, [onSelect, value]);

  useEffect(() => {
    Animated.spring(scale, {
      toValue: isSelected ? 1 : 0,
      speed: 16,
      bounciness: 6,
      useNativeDriver: true,
    }).start();

    Animated.timing(bg, {
      toValue: isSelected ? 1 : 0,
      duration: 220,
      useNativeDriver: false,
    }).start();
  }, [bg, isSelected, scale]);

  const animatedBackground = useMemo(
    () =>
      bg.interpolate({
        inputRange: [0, 1],
        outputRange: ['#F5F8FA', '#EBFFF5'],
      }),
    [bg],
  );

  return (
    <Pressable
      onPress={handlePress}
      style={({ pressed }) => [
        styles.base,
        pressed && styles.pressed,
      ]}
    >
      <Animated.View
        style={[
          styles.contentContainer,
          {
            backgroundColor: animatedBackground,
            borderColor: isSelected ? colors.brand : 'transparent',
          },
        ]}
      >
        {Icon ? (
          <View style={[styles.iconWrap, isSelected ? styles.iconSelected : styles.iconDefault]}>
            <Icon size={18} color={isSelected ? colors.surface : colors.subtext} />
          </View>
        ) : null}
        <Text style={[styles.label, isSelected && styles.labelSelected]}>{label}</Text>
        <Animated.View style={[styles.check, isSelected ? styles.checkSelected : styles.checkUnselected, { transform: [{ scale }] }]}>
          <Text style={[styles.checkSymbol, isSelected && styles.checkSymbolSelected]}>✓</Text>
        </Animated.View>
      </Animated.View>
    </Pressable>
  );
};

const styles = StyleSheet.create({
  base: {
    borderRadius: radii.md,
    overflow: 'hidden',
  },
  contentContainer: {
    borderRadius: radii.md,
    borderWidth: 1,
    borderColor: 'transparent',
    backgroundColor: colors.surfaceSoft,
    paddingHorizontal: 16,
    paddingVertical: 14,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 16,
  },
  pressed: {
    opacity: 0.94,
  },
  iconWrap: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
  },
  iconDefault: {
    backgroundColor: colors.surface,
  },
  iconSelected: {
    backgroundColor: colors.brand,
  },
  label: {
    fontSize: 16,
    color: colors.text,
    fontWeight: '600',
    flexShrink: 1,
  },
  labelSelected: {
    color: colors.brandDark,
  },
  check: {
    width: 26,
    height: 26,
    borderRadius: 13,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  checkSelected: {
    borderColor: colors.brand,
    backgroundColor: colors.brand,
  },
  checkUnselected: {
    borderColor: colors.border,
    backgroundColor: colors.surface,
  },
  checkSymbol: {
    fontSize: 14,
    fontWeight: '700',
    color: colors.subtext,
  },
  checkSymbolSelected: {
    color: colors.surface,
  },
});
