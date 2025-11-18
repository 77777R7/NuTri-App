import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Linking, ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { ArrowLeft, ArrowRight, FileText, Pill } from 'lucide-react-native';
import { router } from 'expo-router';

import { ResponsiveScreen } from '@/components/common/ResponsiveScreen';
import type { DesignTokens } from '@/constants/designTokens';
import { useResponsiveTokens } from '@/hooks/useResponsiveTokens';
import { consumeScanSession } from '@/lib/scan/session';
import type { SupplementMatch } from '@/lib/scan/service';

const formatBrandName = (supplement: SupplementMatch | null) => {
  if (!supplement) {
    return null;
  }
  if (supplement.brand?.name) {
    return supplement.brand.name;
  }
  return null;
};

export default function ScanResultScreen() {
  const { tokens } = useResponsiveTokens();
  const styles = useMemo(() => createStyles(tokens), [tokens]);
  const [ready, setReady] = useState(false);
  const [session] = useState(() => consumeScanSession());

  useEffect(() => {
    if (!session) {
      router.replace('/(tabs)/scan');
    } else {
      setReady(true);
    }
  }, [session]);

  const isBarcodeMode = session?.mode === 'barcode';
  const supplements: SupplementMatch[] =
    session && session.mode === 'label' ? session.result.supplements ?? [] : [];
  const primarySupplement = supplements[0] ?? null;
  const barcodeResult = session && session.mode === 'barcode' ? session.result : null;
  const analysis = barcodeResult?.analysis ?? null;
  const hasBarcodeMatches = barcodeResult?.status === 'ok' && barcodeResult.items.length > 0;
  const primarySearchItem = hasBarcodeMatches ? barcodeResult.items[0] : null;
  const otherSearchItems = hasBarcodeMatches ? barcodeResult.items.slice(1) : [];

  const primaryLink = analysis?.sources?.[0]?.link ?? primarySearchItem?.link ?? null;

  const primaryButtonDisabled = isBarcodeMode ? false : !primarySupplement;

  const primaryButtonLabel = isBarcodeMode
    ? primaryLink
      ? 'Open source'
      : 'Switch to label scan'
    : primarySupplement
    ? 'Continue in AI Helper'
    : 'No supplement selected';

  const secondaryButtonLabel = isBarcodeMode ? 'Scan another barcode' : 'Scan another label';

  const handlePrimaryAction = useCallback(() => {
    if (isBarcodeMode) {
      if (primaryLink) {
        Linking.openURL(primaryLink).catch(error =>
          console.warn('[scan] unable to open result link', error),
        );
        return;
      }
      router.replace('/scan/label');
      return;
    }

    if (primarySupplement) {
      router.navigate('/assistant');
    }
  }, [isBarcodeMode, primaryLink, primarySupplement]);

  const handleSecondaryAction = useCallback(() => {
    router.replace(isBarcodeMode ? '/scan/barcode' : '/scan/label');
  }, [isBarcodeMode]);
  const brandName = formatBrandName(primarySupplement);

  if (!ready || !session) {
    return null;
  }

  return (
    <ResponsiveScreen contentStyle={styles.screen}>
      <View style={styles.header}>
        <TouchableOpacity style={styles.backButton} onPress={() => router.replace('/(tabs)/scan')} activeOpacity={0.85}>
          <ArrowLeft size={18} color={tokens.colors.textPrimary} />
        </TouchableOpacity>
        <Text style={styles.title}>
          {session.mode === 'barcode' ? 'Barcode scan result' : 'Label scan results'}
        </Text>
      </View>

      <View style={styles.summaryCard}>
        {isBarcodeMode
          ? hasBarcodeMatches
            ? <Pill size={28} color={tokens.colors.textPrimary} />
            : <FileText size={28} color={tokens.colors.textPrimary} />
          : primarySupplement
          ? <Pill size={28} color={tokens.colors.textPrimary} />
          : <FileText size={28} color={tokens.colors.textPrimary} />}
        <View style={styles.summaryCopy}>
          {isBarcodeMode ? (
            analysis ? (
              <>
                <Text style={styles.productTitle}>
                  {analysis.productName ?? 'Supplement insight'}
                </Text>
                <Text style={styles.productMeta}>
                  {[analysis.brand, barcodeResult?.barcode].filter(Boolean).join(' • ')}
                </Text>
                {analysis.summary ? (
                  <Text style={styles.productDescription}>{analysis.summary}</Text>
                ) : null}
              </>
            ) : hasBarcodeMatches && primarySearchItem ? (
              <>
                <Text style={styles.productTitle}>{primarySearchItem.title}</Text>
                <Text style={styles.productMeta}>
                  {[barcodeResult?.barcode, 'online search'].filter(Boolean).join(' • ')}
                </Text>
                {primarySearchItem.snippet ? (
                  <Text style={styles.productDescription}>{primarySearchItem.snippet}</Text>
                ) : null}
              </>
            ) : (
              <>
                <Text style={styles.productTitle}>No supplement matched</Text>
                <Text style={styles.productMeta}>
                  {barcodeResult?.barcode
                    ? `We couldn’t find results for ${barcodeResult.barcode}.`
                    : 'We could not find online results for this barcode.'}
                </Text>
                <Text style={styles.productDescription}>
                  Try scanning the supplement facts label so we can run OCR.
                </Text>
              </>
            )
          ) : primarySupplement ? (
            <>
              <Text style={styles.productTitle}>{primarySupplement.name}</Text>
              <Text style={styles.productMeta}>
                {[brandName, primarySupplement.category, primarySupplement.barcode]
                  .filter(Boolean)
                  .join(' • ')}
              </Text>
              {primarySupplement.description ? (
                <Text style={styles.productDescription}>{primarySupplement.description}</Text>
              ) : null}
            </>
          ) : (
            <>
              <Text style={styles.productTitle}>No supplement matched</Text>
              <Text style={styles.productMeta}>
                We could not find a supplement that matches this label.
              </Text>
            </>
          )}
        </View>
      </View>

      <ScrollView style={styles.details} contentContainerStyle={styles.detailsContent}>
        {isBarcodeMode ? (
          analysis ? (
            <>
              <View style={styles.section}>
                <Text style={styles.sectionTitle}>AI summary</Text>
                <Text style={styles.bodyText}>
                  {analysis.summary ?? 'The model did not include a summary for this supplement.'}
                </Text>
                {primaryLink ? <Text style={styles.linkText}>{primaryLink}</Text> : null}
                <Text style={styles.metaText}>Confidence: {(analysis.confidence * 100).toFixed(0)}%</Text>
              </View>
              {analysis.ingredients.length > 0 ? (
                <View style={styles.section}>
                  <Text style={styles.sectionTitle}>Key ingredients</Text>
                  {analysis.ingredients.map(ingredient => (
                    <View key={`${ingredient.name}-${ingredient.amount ?? 'na'}`} style={styles.listItemRow}>
                      <View style={styles.listBullet} />
                      <View style={styles.listCopy}>
                        <Text style={styles.listTitle}>{ingredient.name}</Text>
                        <Text style={styles.listMeta}>
                          {[ingredient.amount, ingredient.unit].filter(Boolean).join(' ')}
                        </Text>
                        {ingredient.notes ? (
                          <Text style={styles.ingredientNotes}>{ingredient.notes}</Text>
                        ) : null}
                      </View>
                    </View>
                  ))}
                </View>
              ) : null}
              {analysis.sources.length > 0 ? (
                <View style={styles.section}>
                  <Text style={styles.sectionTitle}>Sources</Text>
                  {analysis.sources.map(source => (
                    <View key={source.link} style={styles.listItemRow}>
                      <View style={styles.listBullet} />
                      <View style={styles.listCopy}>
                        <Text style={styles.listTitle}>{source.title}</Text>
                        <Text style={styles.linkText}>{source.link}</Text>
                      </View>
                    </View>
                  ))}
                </View>
              ) : null}
            </>
          ) : hasBarcodeMatches && primarySearchItem ? (
            <>
              <View style={styles.section}>
                <Text style={styles.sectionTitle}>Top result snippet</Text>
                {primarySearchItem.snippet ? (
                  <Text style={styles.bodyText}>{primarySearchItem.snippet}</Text>
                ) : (
                  <Text style={styles.bodyText}>No snippet available.</Text>
                )}
                {primarySearchItem.link ? (
                  <Text style={styles.linkText}>{primarySearchItem.link}</Text>
                ) : null}
              </View>
              {otherSearchItems.length > 0 ? (
                <View style={styles.section}>
                  <Text style={styles.sectionTitle}>Other possible matches</Text>
                  {otherSearchItems.map(item => (
                    <View key={`${item.link}-${item.title}`} style={styles.listItemRow}>
                      <View style={styles.listBullet} />
                      <View style={styles.listCopy}>
                        <Text style={styles.listTitle}>{item.title}</Text>
                        {item.snippet ? <Text style={styles.listMeta}>{item.snippet}</Text> : null}
                        <Text style={styles.linkText}>{item.link}</Text>
                      </View>
                    </View>
                  ))}
                </View>
              ) : null}
            </>
          ) : (
            <View style={styles.section}>
              <Text style={styles.sectionTitle}>What next?</Text>
              <Text style={styles.bodyText}>
                We couldn’t find online data yet. Switch to label scan or upload a clear photo of the
                supplement facts panel to continue.
              </Text>
            </View>
          )
        ) : (
          <>
            <View style={styles.section}>
              <Text style={styles.sectionTitle}>Extracted text</Text>
              <Text style={styles.bodyText}>{session.result.extractedText}</Text>
            </View>
            {supplements.length > 1 ? (
              <View style={styles.section}>
                <Text style={styles.sectionTitle}>Other possible matches</Text>
                {supplements.slice(1).map(item => (
                  <View key={item.id} style={styles.listItemRow}>
                    <View style={styles.listBullet} />
                    <View style={styles.listCopy}>
                      <Text style={styles.listTitle}>{item.name}</Text>
                      <Text style={styles.listMeta}>
                        {[formatBrandName(item), item.category].filter(Boolean).join(' • ')}
                      </Text>
                    </View>
                  </View>
                ))}
              </View>
            ) : null}
          </>
        )}
      </ScrollView>

      <View style={styles.actions}>
        <TouchableOpacity
          style={[styles.primaryButton, primaryButtonDisabled && styles.primaryButtonDisabled]}
          activeOpacity={0.85}
          onPress={handlePrimaryAction}
          disabled={primaryButtonDisabled}
        >
          <Text style={styles.primaryText}>{primaryButtonLabel}</Text>
          <ArrowRight size={16} color={tokens.colors.surface} />
        </TouchableOpacity>
        <TouchableOpacity style={styles.secondaryButton} activeOpacity={0.85} onPress={handleSecondaryAction}>
          <Text style={styles.secondaryText}>{secondaryButtonLabel}</Text>
        </TouchableOpacity>
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
    header: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: tokens.spacing.md,
    },
    backButton: {
      width: tokens.components.iconButton.size,
      height: tokens.components.iconButton.size,
      borderRadius: tokens.components.iconButton.radius,
      borderWidth: 1,
      borderColor: tokens.colors.border,
      alignItems: 'center',
      justifyContent: 'center',
      backgroundColor: tokens.colors.surface,
    },
    title: {
      flex: 1,
      color: tokens.colors.textPrimary,
      ...tokens.typography.title,
    },
    summaryCard: {
      flexDirection: 'row',
      gap: tokens.spacing.md,
      padding: tokens.spacing.lg,
      borderRadius: tokens.components.card.radius,
      backgroundColor: tokens.colors.surface,
      ...tokens.shadow.card,
    },
    summaryCopy: {
      flex: 1,
      gap: tokens.spacing.xs,
    },
    productTitle: {
      color: tokens.colors.textPrimary,
      ...tokens.typography.subtitle,
    },
    productMeta: {
      color: tokens.colors.textMuted,
      ...tokens.typography.bodySmall,
    },
    productDescription: {
      color: tokens.colors.textMuted,
      ...tokens.typography.body,
    },
    details: {
      flex: 1,
    },
    detailsContent: {
      gap: tokens.spacing.lg,
    },
    section: {
      gap: tokens.spacing.sm,
    },
    sectionTitle: {
      color: tokens.colors.textPrimary,
      ...tokens.typography.subtitle,
    },
    bodyText: {
      color: tokens.colors.textMuted,
      ...tokens.typography.body,
    },
    listItemRow: {
      flexDirection: 'row',
      gap: tokens.spacing.sm,
      alignItems: 'flex-start',
    },
    listBullet: {
      marginTop: tokens.spacing.xs,
      width: 6,
      height: 6,
      borderRadius: 3,
      backgroundColor: tokens.colors.textMuted,
    },
    listCopy: {
      flex: 1,
      gap: tokens.spacing.xs / 2,
    },
    listTitle: {
      color: tokens.colors.textPrimary,
      ...tokens.typography.body,
    },
    listMeta: {
      color: tokens.colors.textMuted,
      ...tokens.typography.bodySmall,
    },
    actions: {
      gap: tokens.spacing.sm,
    },
    primaryButton: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'center',
      gap: tokens.spacing.sm,
      borderRadius: tokens.components.card.radius,
      backgroundColor: tokens.colors.accent,
      paddingVertical: tokens.spacing.md,
      paddingHorizontal: tokens.spacing.lg,
    },
    primaryButtonDisabled: {
      opacity: 0.5,
    },
    primaryText: {
      color: tokens.colors.surface,
      ...tokens.typography.subtitle,
    },
    secondaryButton: {
      alignItems: 'center',
      paddingVertical: tokens.spacing.md,
      borderRadius: tokens.components.card.radius,
      borderWidth: 1,
      borderColor: tokens.colors.border,
      backgroundColor: tokens.colors.surface,
    },
    secondaryText: {
      color: tokens.colors.textPrimary,
      ...tokens.typography.body,
    },
    linkText: {
      color: tokens.colors.accent,
      ...tokens.typography.bodySmall,
    },
    metaText: {
      color: tokens.colors.textMuted,
      ...tokens.typography.bodySmall,
    },
    ingredientNotes: {
      color: tokens.colors.textMuted,
      ...tokens.typography.bodySmall,
    },
  });
