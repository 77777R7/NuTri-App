import React from 'react';
import { StyleProp, StyleSheet, Text, TextStyle, View, ViewStyle } from 'react-native';

import { onboardingPalette } from '../shared/theme';

type SummarySectionHeaderProps = {
  eyebrow: string;
  title: string;
  body?: string;
  tone?: 'default' | 'primary';
  style?: StyleProp<ViewStyle>;
  bodyStyle?: StyleProp<TextStyle>;
};

export function SummarySectionHeader({
  eyebrow,
  title,
  body,
  tone = 'default',
  style,
  bodyStyle,
}: SummarySectionHeaderProps) {
  return (
    <View style={[styles.root, style]}>
      <Text style={[styles.eyebrow, tone === 'primary' ? styles.eyebrowPrimary : null]}>{eyebrow}</Text>
      <Text style={styles.title}>{title}</Text>
      {body ? <Text style={[styles.body, bodyStyle]}>{body}</Text> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    gap: 6,
  },
  eyebrow: {
    color: onboardingPalette.textMuted,
    fontSize: 11,
    fontWeight: '700',
    letterSpacing: 1.8,
    textTransform: 'uppercase',
  },
  eyebrowPrimary: {
    color: onboardingPalette.primary,
  },
  title: {
    color: onboardingPalette.text,
    fontSize: 22,
    lineHeight: 28,
    fontWeight: '700',
    letterSpacing: -0.5,
  },
  body: {
    color: onboardingPalette.textMuted,
    fontSize: 14,
    lineHeight: 21,
    fontWeight: '500',
  },
});

export default SummarySectionHeader;
