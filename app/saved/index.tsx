import React from 'react';
import { Image, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { Heart } from 'lucide-react-native';
import { router, type Href } from 'expo-router';

import { ResponsiveHeader } from '@/components/common/ResponsiveHeader';
import { ResponsiveScreen } from '@/components/common/ResponsiveScreen';
import type { DesignTokens } from '@/constants/designTokens';
import { useResponsiveTokens } from '@/hooks/useResponsiveTokens';

const categoryEmojis: Record<string, string> = {
  vitamins: '💊',
  minerals: '⚡',
  probiotics: '🦠',
  omega3: '🐟',
  herbs: '🌿',
  amino_acids: '🧬',
  other: '📦',
};

export default function FavouritePage() {
  const { tokens } = useResponsiveTokens();
  const styles = React.useMemo(() => createStyles(tokens), [tokens]);

  const supplements: any[] = [];
  const isLoading = false;

  return (
    <ResponsiveScreen contentStyle={styles.screen}>
      <ResponsiveHeader
        title="Favourite Supplements"
        subtitle={`${supplements.length} active supplements`}
        onBack={() => router.replace('/main')}
      />

      {isLoading ? (
        <View style={styles.loaderList}>
          {[0, 1, 2, 3].map(index => (
            <View key={index} style={styles.skeletonCard}>
              <View style={styles.skeletonRow}>
                <View style={styles.skeletonThumb} />
                <View style={styles.skeletonBody}>
                  <View style={[styles.skeletonLine, styles.skeletonLineWide]} />
                  <View style={[styles.skeletonLine, styles.skeletonLineMedium]} />
                </View>
              </View>
            </View>
          ))}
        </View>
      ) : supplements.length === 0 ? (
        <View style={styles.emptyCard}>
          <View style={styles.emptyIcon}>
            <Heart size={Math.round(tokens.components.iconButton.iconSize * 2)} color={tokens.colors.accent} />
          </View>
          <Text style={styles.emptyTitle}>No favourites yet</Text>
          <Text style={styles.emptySubtitle}>Start scanning supplements to add them to your favourites</Text>
          <TouchableOpacity
            activeOpacity={0.9}
            onPress={() => router.push('/(tabs)/scan')}
            style={styles.emptyButton}
          >
            <Text style={styles.emptyButtonText}>Scan Your First</Text>
          </TouchableOpacity>
        </View>
      ) : (
        <View style={styles.listContainer}>
          {supplements.map((supplement, index) => (
            <TouchableOpacity
              key={supplement.id ?? index}
              activeOpacity={0.9}
              onPress={() => {
                if (!supplement.id) {
                  return;
                }
                router.push(`/supplement?id=${supplement.id}` as Href);
              }}
            >
              <View style={styles.itemCard}>
                <View style={styles.itemThumbnail}>
                  {supplement.image_url ? (
                    <Image source={{ uri: supplement.image_url }} style={styles.itemThumbnailImage} />
                  ) : (
                    <Text style={styles.itemThumbnailEmoji}>
                      {categoryEmojis[supplement.category ?? ''] ?? '📦'}
                    </Text>
                  )}
                </View>
                <View style={styles.itemCopy}>
                  <Text style={styles.itemTitle} numberOfLines={1}>
                    {supplement.product_name}
                  </Text>
                  <Text style={styles.itemSubtitle} numberOfLines={1}>
                    {supplement.brand}
                  </Text>
                  {supplement.created_date ? (
                    <Text style={styles.itemMeta}>
                      Added{' '}
                      {new Date(supplement.created_date).toLocaleDateString(undefined, {
                        month: 'short',
                        day: 'numeric',
                        year: 'numeric',
                      })}
                    </Text>
                  ) : null}
                </View>
                <Heart size={tokens.components.iconButton.iconSize} color={tokens.colors.danger} fill={tokens.colors.danger} />
              </View>
            </TouchableOpacity>
          ))}
        </View>
      )}
    </ResponsiveScreen>
  );
}

const createStyles = (tokens: DesignTokens) =>
  StyleSheet.create({
    screen: {
      paddingVertical: tokens.spacing.xl,
      gap: tokens.spacing.lg,
    },
    loaderList: {
      gap: tokens.spacing.md,
    },
    skeletonCard: {
      backgroundColor: tokens.colors.surface,
      borderRadius: tokens.radius['2xl'],
      padding: tokens.spacing.lg,
      ...tokens.shadow.lifted,
    },
    skeletonRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: tokens.spacing.sm,
    },
    skeletonThumb: {
      width: Math.round(tokens.components.iconButton.size * 1.4),
      height: Math.round(tokens.components.iconButton.size * 1.4),
      borderRadius: tokens.radius.lg,
      backgroundColor: tokens.colors.surfaceMuted,
    },
    skeletonBody: {
      flex: 1,
      gap: tokens.spacing.xs,
    },
    skeletonLine: {
      height: 12,
      borderRadius: tokens.radius.sm,
      backgroundColor: tokens.colors.border,
    },
    skeletonLineWide: {
      width: '75%',
    },
    skeletonLineMedium: {
      width: '55%',
      marginTop: tokens.spacing.xs,
    },
    emptyCard: {
      alignItems: 'center',
      backgroundColor: tokens.colors.surface,
      borderRadius: tokens.radius['2xl'],
      paddingHorizontal: tokens.components.card.paddingHorizontal,
      paddingVertical: Math.round(tokens.components.card.paddingVertical * 1.3),
      gap: tokens.spacing.md,
      ...tokens.shadow.card,
    },
    emptyIcon: {
      width: Math.round(tokens.components.iconButton.size * 2.4),
      height: Math.round(tokens.components.iconButton.size * 2.4),
      borderRadius: tokens.radius['2xl'],
      backgroundColor: tokens.colors.surfaceMuted,
      alignItems: 'center',
      justifyContent: 'center',
    },
    emptyTitle: {
      color: tokens.colors.textPrimary,
      ...tokens.typography.subtitle,
    },
    emptySubtitle: {
      color: tokens.colors.textMuted,
      textAlign: 'center',
      ...tokens.typography.body,
    },
    emptyButton: {
      paddingHorizontal: tokens.spacing.xl,
      paddingVertical: tokens.spacing.sm,
      borderRadius: tokens.radius.lg,
      backgroundColor: tokens.colors.accent,
    },
    emptyButtonText: {
      color: '#FFFFFF',
      ...tokens.typography.label,
    },
    listContainer: {
      gap: tokens.spacing.md,
    },
    itemCard: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: tokens.spacing.sm,
      backgroundColor: tokens.colors.surface,
      borderRadius: tokens.radius['2xl'],
      paddingHorizontal: tokens.spacing.lg,
      paddingVertical: tokens.spacing.md,
      ...tokens.shadow.lifted,
    },
    itemThumbnail: {
      width: Math.round(tokens.components.iconButton.size * 1.4),
      height: Math.round(tokens.components.iconButton.size * 1.4),
      borderRadius: tokens.radius.lg,
      backgroundColor: tokens.colors.accentSoft,
      alignItems: 'center',
      justifyContent: 'center',
    },
    itemThumbnailImage: {
      width: '100%',
      height: '100%',
      borderRadius: tokens.radius.lg,
    },
    itemThumbnailEmoji: {
      fontSize: Math.round(tokens.typography.title.fontSize * 1.1),
    },
    itemCopy: {
      flex: 1,
      gap: tokens.spacing.xs,
    },
    itemTitle: {
      color: tokens.colors.textPrimary,
      ...tokens.typography.body,
      fontWeight: '700',
    },
    itemSubtitle: {
      color: tokens.colors.textMuted,
      ...tokens.typography.bodySmall,
    },
    itemMeta: {
      color: tokens.colors.textMuted,
      ...tokens.typography.bodySmall,
    },
  });
