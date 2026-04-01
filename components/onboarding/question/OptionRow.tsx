import React from 'react';
import { Pressable, StyleProp, StyleSheet, Text, View, ViewStyle } from 'react-native';
import * as Haptics from 'expo-haptics';

import { GlassSurface } from '../shared/GlassSurface';
import { SelectionControl } from './SelectionControl';
import { onboardingPalette, onboardingRadii } from '../shared/theme';

type OptionRowProps = {
  label: string;
  description?: string;
  selected?: boolean;
  onPress?: () => void;
  accessibilityLabel?: string;
  style?: StyleProp<ViewStyle>;
  selectionMode?: 'single' | 'multiple';
};

export function OptionRow({
  label,
  description,
  selected = false,
  onPress,
  accessibilityLabel,
  style,
  selectionMode = 'single',
}: OptionRowProps) {
  const handlePress = async () => {
    try {
      await Haptics.selectionAsync();
    } catch {
      // noop
    }
    onPress?.();
  };

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ selected }}
      accessibilityLabel={accessibilityLabel ?? label}
      onPress={handlePress}
      style={({ pressed }) => [pressed && styles.pressed, style]}
    >
      <GlassSurface
        variant="row"
        borderRadius={onboardingRadii.option}
        style={[styles.card, selected ? styles.cardSelected : null]}
      >
        <View style={styles.content}>
          <View style={styles.copyWrap}>
            <Text style={[styles.label, selected ? styles.labelSelected : null]}>{label}</Text>
            {description ? (
              <Text style={[styles.description, selected ? styles.descriptionSelected : null]}>
                {description}
              </Text>
            ) : null}
          </View>
          <SelectionControl selected={selected} mode={selectionMode} />
        </View>
      </GlassSurface>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  pressed: {
    transform: [{ scale: 0.985 }],
  },
  card: {
    minHeight: 72,
    paddingHorizontal: 24,
    paddingVertical: 16,
  },
  cardSelected: {
    backgroundColor: 'rgba(255,255,255,0.88)',
    borderColor: 'rgba(79,125,255,0.34)',
  },
  content: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 14,
  },
  copyWrap: {
    flex: 1,
    gap: 4,
  },
  label: {
    color: 'rgba(11,22,56,0.82)',
    fontSize: 17,
    fontWeight: '600',
    letterSpacing: -0.2,
  },
  labelSelected: {
    color: onboardingPalette.text,
  },
  description: {
    color: onboardingPalette.textMuted,
    fontSize: 13.5,
    lineHeight: 19,
    fontWeight: '500',
  },
  descriptionSelected: {
    color: 'rgba(11,22,56,0.68)',
  },
});

export default OptionRow;
