import React from 'react';
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import * as Haptics from 'expo-haptics';

import { colors, shadow } from '@/lib/theme';

type OnboardingCardProps = {
  label: string;
  description?: string;
  selected?: boolean;
  onPress?: () => void;
  accessibilityLabel?: string;
};

export const OnboardingCard = ({ label, description, selected, onPress, accessibilityLabel }: OnboardingCardProps) => {
  const handlePress = async () => {
    try {
      await Haptics.selectionAsync();
    } catch {
      // noop
    }
    onPress?.();
  };

  return (
    <TouchableOpacity
      accessibilityRole="button"
      accessibilityState={{ selected }}
      accessibilityLabel={accessibilityLabel ?? label}
      activeOpacity={0.92}
      style={[styles.card, selected && styles.cardSelected]}
      onPress={handlePress}
    >
      <View style={styles.content}>
        <Text style={[styles.label, selected && styles.labelSelected]}>{label}</Text>
        {description ? <Text style={styles.description}>{description}</Text> : null}
      </View>
    </TouchableOpacity>
  );
};

const styles = StyleSheet.create({
  card: {
    minHeight: 72,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: '#FFFFFF',
    paddingHorizontal: 18,
    paddingVertical: 16,
    justifyContent: 'center',
  },
  cardSelected: {
    borderColor: colors.brand,
    backgroundColor: '#E7F8F3',
    ...shadow.card,
  },
  content: {
    gap: 6,
  },
  label: {
    fontSize: 16,
    fontWeight: '700',
    color: colors.text,
  },
  labelSelected: {
    color: colors.brandDark,
  },
  description: {
    fontSize: 14,
    color: colors.textMuted,
  },
});

export default OnboardingCard;
