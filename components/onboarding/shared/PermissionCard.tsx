import React from 'react';
import { ActivityIndicator, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import * as Haptics from 'expo-haptics';

import { colors, shadow } from '@/lib/theme';

type PermissionCardProps = {
  title: string;
  description?: string;
  value?: boolean;
  loading?: boolean;
  disabled?: boolean;
  required?: boolean;
  onPress?: () => void;
};

export const PermissionCard = ({ title, description, value, loading, disabled, required, onPress }: PermissionCardProps) => {
  const handlePress = async () => {
    if (disabled) return;
    try {
      await Haptics.selectionAsync();
    } catch {
      // noop
    }
    onPress?.();
  };

  return (
    <TouchableOpacity
      activeOpacity={disabled ? 1 : 0.9}
      onPress={handlePress}
      style={[styles.card, value && styles.cardActive, disabled && styles.cardDisabled]}
      accessibilityRole="button"
      accessibilityState={{ checked: value }}
      accessibilityLabel={title}
    >
      <View style={styles.textContainer}>
        <View style={styles.titleRow}>
          <Text style={styles.title}>{title}</Text>
          {required ? <Text style={styles.required}>Required</Text> : null}
        </View>
        {description ? <Text style={styles.description}>{description}</Text> : null}
      </View>
      <View style={styles.status}>
        {loading ? (
          <ActivityIndicator size="small" color={colors.brand} />
        ) : (
          <View style={[styles.checkbox, value && styles.checkboxChecked]}>
            {value ? <View style={styles.checkboxDot} /> : null}
          </View>
        )}
      </View>
    </TouchableOpacity>
  );
};

const styles = StyleSheet.create({
  card: {
    borderRadius: 16,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: '#FFFFFF',
    paddingHorizontal: 18,
    paddingVertical: 16,
    minHeight: 72,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  cardActive: {
    borderColor: colors.brand,
    backgroundColor: '#F0FBF7',
    ...shadow.card,
  },
  cardDisabled: {
    opacity: 0.6,
  },
  textContainer: {
    flex: 1,
    marginRight: 16,
    gap: 6,
  },
  titleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  title: {
    fontSize: 16,
    fontWeight: '700',
    color: colors.text,
  },
  required: {
    fontSize: 12,
    fontWeight: '600',
    color: colors.brandDark,
    backgroundColor: '#DDF5EE',
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 999,
  },
  description: {
    fontSize: 14,
    color: colors.textMuted,
  },
  status: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  checkbox: {
    width: 24,
    height: 24,
    borderRadius: 12,
    borderWidth: 2,
    borderColor: colors.border,
    alignItems: 'center',
    justifyContent: 'center',
  },
  checkboxChecked: {
    borderColor: colors.brand,
    backgroundColor: '#FFFFFF',
  },
  checkboxDot: {
    width: 12,
    height: 12,
    borderRadius: 6,
    backgroundColor: colors.brand,
  },
});

export default PermissionCard;
