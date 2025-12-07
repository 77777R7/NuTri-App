import React, { useMemo } from 'react';
import { ActivityIndicator, StyleSheet, View } from 'react-native';

import { BrandGradient } from '@/components/BrandGradient';
import { SkeletonLoader } from '@/components/ui/SkeletonLoader';
import type { DesignTokens } from '@/constants/designTokens';
import { useResponsiveTokens } from '@/hooks/useResponsiveTokens';

export const OnboardingSkeleton = () => {
  const { tokens } = useResponsiveTokens();
  const styles = useMemo(() => createStyles(tokens), [tokens]);

  return (
    <BrandGradient>
      <View style={styles.container}>
        <View style={styles.card}>
          <SkeletonLoader width="35%" height={16} />
          <View style={styles.copy}>
            <SkeletonLoader width="70%" height={28} />
            <SkeletonLoader width="90%" height={16} />
            <SkeletonLoader width="55%" height={16} />
          </View>
          <View style={styles.actions}>
            <SkeletonLoader width="48%" height={52} borderRadius={tokens.radius.lg} />
            <SkeletonLoader width="48%" height={52} borderRadius={tokens.radius.lg} />
          </View>
        </View>

        <View style={styles.metaRow}>
          <ActivityIndicator color="#FFFFFF" />
          <SkeletonLoader width={160} height={12} borderRadius={tokens.radius.md} style={styles.metaLine} />
        </View>
      </View>
    </BrandGradient>
  );
};

const createStyles = (tokens: DesignTokens) =>
  StyleSheet.create({
    container: {
      flex: 1,
      justifyContent: 'center',
      paddingHorizontal: tokens.spacing.xl,
      paddingVertical: tokens.spacing['2xl'],
      gap: tokens.spacing.md,
    },
    card: {
      borderRadius: tokens.radius['2xl'],
      padding: tokens.spacing.xl,
      gap: tokens.spacing.md,
      backgroundColor: 'rgba(255, 255, 255, 0.94)',
    },
    copy: {
      gap: tokens.spacing.sm,
    },
    actions: {
      flexDirection: 'row',
      gap: tokens.spacing.md,
      marginTop: tokens.spacing.sm,
    },
    metaRow: {
      alignItems: 'center',
      gap: tokens.spacing.sm,
    },
    metaLine: {
      alignSelf: 'center',
    },
  });
