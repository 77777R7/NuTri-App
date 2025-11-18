import React, { useMemo, useState } from 'react';
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { ArrowLeft, LogOut, User as UserIcon } from 'lucide-react-native';
import { router } from 'expo-router';

import { ResponsiveHeader } from '@/components/common/ResponsiveHeader';
import { ResponsiveScreen } from '@/components/common/ResponsiveScreen';
import type { DesignTokens } from '@/constants/designTokens';
import { useResponsiveTokens } from '@/hooks/useResponsiveTokens';

export default function ProfilePage() {
  const { tokens } = useResponsiveTokens();
  const styles = useMemo(() => createStyles(tokens), [tokens]);
  const [user] = useState<{ full_name: string; email: string }>(
    () => ({
      full_name: 'User',
      email: 'user@example.com',
    }),
  );

  return (
    <ResponsiveScreen contentStyle={styles.screen}>
      <ResponsiveHeader title="Profile" onBack={() => router.replace('/main')} />

      <View style={styles.card}>
        <View style={styles.avatarRow}>
          <View style={styles.avatarCircle}>
            <UserIcon size={Math.round(tokens.typography.title.fontSize * 1.3)} color="#FFFFFF" />
          </View>
          <View style={styles.userTextGroup}>
            <Text style={styles.userName}>{user.full_name}</Text>
            <Text style={styles.userEmail}>{user.email}</Text>
          </View>
        </View>
      </View>

      <TouchableOpacity style={styles.signOutButton} activeOpacity={0.85}>
        <LogOut size={tokens.components.iconButton.iconSize} color={tokens.colors.textPrimary} />
        <Text style={styles.signOutText}>Sign Out</Text>
      </TouchableOpacity>
    </ResponsiveScreen>
  );
}

const createStyles = (tokens: DesignTokens) =>
  StyleSheet.create({
    screen: {
      paddingVertical: tokens.spacing.xl,
      gap: tokens.spacing.lg,
    },
    card: {
      backgroundColor: tokens.colors.surface,
      borderRadius: tokens.components.card.radius,
      paddingHorizontal: tokens.components.card.paddingHorizontal,
      paddingVertical: tokens.components.card.paddingVertical,
      ...tokens.shadow.card,
    },
    avatarRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: tokens.spacing.md,
    },
    avatarCircle: {
      width: Math.round(tokens.components.iconButton.size * 1.6),
      height: Math.round(tokens.components.iconButton.size * 1.6),
      borderRadius: Math.round(tokens.components.iconButton.size * 0.8),
      backgroundColor: tokens.colors.accent,
      alignItems: 'center',
      justifyContent: 'center',
    },
    userTextGroup: {
      gap: tokens.spacing.xs,
    },
    userName: {
      color: tokens.colors.textPrimary,
      ...tokens.typography.subtitle,
    },
    userEmail: {
      color: tokens.colors.textMuted,
      ...tokens.typography.bodySmall,
    },
    signOutButton: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'center',
      gap: tokens.spacing.xs,
      height: Math.round(tokens.components.iconButton.size * 1.2),
      borderRadius: tokens.components.card.radius,
      borderWidth: 1,
      borderColor: tokens.colors.border,
      backgroundColor: tokens.colors.surface,
    },
    signOutText: {
      color: tokens.colors.textPrimary,
      ...tokens.typography.body,
    },
  });
