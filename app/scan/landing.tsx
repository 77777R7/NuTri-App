import React, { useMemo } from 'react';
import type { ReactNode } from 'react';
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { ArrowRight, Camera, Info, Scan, Upload } from 'lucide-react-native';
import { router } from 'expo-router';

import { ResponsiveHeader } from '@/components/common/ResponsiveHeader';
import { ResponsiveScreen } from '@/components/common/ResponsiveScreen';
import type { DesignTokens } from '@/constants/designTokens';
import { useResponsiveTokens } from '@/hooks/useResponsiveTokens';

type ScanAction = {
  key: 'barcode' | 'label' | 'upload';
  title: string;
  description: string;
  icon: ReactNode;
  onPress: () => void;
};

export default function ScanPage() {
  const { tokens } = useResponsiveTokens();
  const styles = useMemo(() => createStyles(tokens), [tokens]);

  const actions: ScanAction[] = useMemo(
    () => [
      {
        key: 'barcode',
        title: 'Scan Barcode',
        description: 'Fastest option. Point the camera at the UPC/EAN code.',
        icon: <Scan size={20} color={tokens.colors.textPrimary} />,
        onPress: () => router.push('/scan/barcode'),
      },
      {
        key: 'label',
        title: 'Scan Label',
        description: 'Capture the supplement facts panel for OCR.',
        icon: <Camera size={20} color={tokens.colors.textPrimary} />,
        onPress: () => router.push('/scan/label'),
      },
      {
        key: 'upload',
        title: 'Upload Photo',
        description: 'Use an existing image from your gallery.',
        icon: <Upload size={20} color={tokens.colors.textPrimary} />,
        onPress: () => router.push({ pathname: '/scan/label', params: { mode: 'upload' } }),
      },
    ],
    [tokens.colors.textPrimary],
  );

  return (
    <ResponsiveScreen contentStyle={styles.screen}>
      <ResponsiveHeader
        title="Scan Supplement"
        subtitle="Start with the barcode for the quickest match. Switch to label scan if the code isn’t available."
        onBack={() => router.replace('/main')}
      />

      <View style={styles.actions}>
        {actions.map(action => (
          <TouchableOpacity key={action.key} activeOpacity={0.85} style={styles.actionCard} onPress={action.onPress}>
            <View style={styles.actionIcon}>{action.icon}</View>
            <View style={styles.actionCopy}>
              <Text style={styles.actionTitle}>{action.title}</Text>
              <Text style={styles.actionDescription}>{action.description}</Text>
            </View>
            <ArrowRight size={18} color={tokens.colors.textMuted} />
          </TouchableOpacity>
        ))}
      </View>

      <View style={styles.tipsCard}>
        <View style={styles.tipsHeader}>
          <View style={styles.tipsIconWrapper}>
            <Info size={18} color={tokens.colors.accent} />
          </View>
          <Text style={styles.tipsTitle}>Pro tips for a clean scan</Text>
        </View>
        <View style={styles.tipList}>
          <Text style={styles.tipItem}>• Keep the barcode fully in frame and avoid glare.</Text>
          <Text style={styles.tipItem}>• Switch to label scan if the barcode is missing or damaged.</Text>
          <Text style={styles.tipItem}>• For OCR, capture the entire nutrition panel in sharp focus.</Text>
        </View>
      </View>
    </ResponsiveScreen>
  );
}

const createStyles = (tokens: DesignTokens) =>
  StyleSheet.create({
    screen: {
      paddingVertical: tokens.spacing.xl,
      gap: tokens.spacing.lg,
    },
    actions: {
      gap: tokens.spacing.md,
    },
    actionCard: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: tokens.spacing.md,
      borderRadius: tokens.components.card.radius,
      paddingHorizontal: tokens.components.card.paddingHorizontal,
      paddingVertical: tokens.spacing.md,
      backgroundColor: tokens.colors.surface,
      ...tokens.shadow.lifted,
    },
    actionIcon: {
      width: tokens.components.iconButton.size,
      height: tokens.components.iconButton.size,
      borderRadius: tokens.components.iconButton.radius,
      alignItems: 'center',
      justifyContent: 'center',
      backgroundColor: tokens.colors.surfaceMuted,
    },
    actionCopy: {
      flex: 1,
      gap: tokens.spacing.xs,
    },
    actionTitle: {
      color: tokens.colors.textPrimary,
      ...tokens.typography.subtitle,
    },
    actionDescription: {
      color: tokens.colors.textMuted,
      ...tokens.typography.bodySmall,
    },
    tipsCard: {
      borderRadius: tokens.components.card.radius,
      borderWidth: 1,
      borderColor: tokens.colors.border,
      backgroundColor: tokens.colors.surface,
      paddingVertical: tokens.components.card.paddingVertical,
      paddingHorizontal: tokens.components.card.paddingHorizontal,
      gap: tokens.spacing.sm,
    },
    tipsHeader: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: tokens.spacing.sm,
    },
    tipsIconWrapper: {
      width: tokens.components.iconButton.size,
      height: tokens.components.iconButton.size,
      borderRadius: tokens.components.iconButton.radius,
      alignItems: 'center',
      justifyContent: 'center',
      backgroundColor: tokens.colors.accentSoft,
    },
    tipsTitle: {
      color: tokens.colors.textPrimary,
      ...tokens.typography.subtitle,
    },
    tipList: {
      gap: tokens.spacing.xs,
    },
    tipItem: {
      color: tokens.colors.textMuted,
      ...tokens.typography.body,
    },
  });
