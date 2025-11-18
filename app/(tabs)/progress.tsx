import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { router } from 'expo-router';

import { ResponsiveHeader } from '@/components/common/ResponsiveHeader';
import { ResponsiveScreen } from '@/components/common/ResponsiveScreen';
import type { DesignTokens } from '@/constants/designTokens';
import { useResponsiveTokens } from '@/hooks/useResponsiveTokens';

export default function ProgressPage() {
  const { tokens } = useResponsiveTokens();
  const styles = React.useMemo(() => createStyles(tokens), [tokens]);

  return (
    <ResponsiveScreen contentStyle={styles.screen}>
      <ResponsiveHeader title="Progress" onBack={() => router.replace('/main')} />

      <View style={styles.card}>
        <Text style={styles.emoji}>📊</Text>
        <Text style={styles.cardTitle}>Coming Soon</Text>
        <Text style={styles.cardSubtitle}>
          Track your supplement effectiveness and health progress over time
        </Text>
      </View>
    </ResponsiveScreen>
  );
}

const createStyles = (tokens: DesignTokens) =>
  StyleSheet.create({
    screen: {
      paddingVertical: tokens.spacing.xl,
      gap: tokens.layout.stack,
    },
    card: {
      alignItems: 'center',
      backgroundColor: tokens.colors.surface,
      borderRadius: tokens.components.card.radius,
      paddingVertical: tokens.components.card.paddingVertical,
      paddingHorizontal: tokens.components.card.paddingHorizontal,
      ...tokens.shadow.card,
    },
    emoji: {
      fontSize: Math.round(tokens.typography.display.fontSize * 1.1),
      marginBottom: tokens.components.card.gap,
    },
    cardTitle: {
      color: tokens.colors.textPrimary,
      marginBottom: tokens.spacing.xs,
      ...tokens.typography.subtitle,
    },
    cardSubtitle: {
      color: tokens.colors.textMuted,
      textAlign: 'center',
      paddingHorizontal: tokens.spacing.md,
      ...tokens.typography.body,
    },
  });
