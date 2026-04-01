import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { CheckCircle2, Compass } from 'lucide-react-native';

import type { UserSupportMode } from '@/lib/personalization/uiLabels';

export function SupportModeCard({
  mode,
  title,
  body,
  compact = false,
}: {
  mode: UserSupportMode;
  title: string;
  body: string;
  compact?: boolean;
}) {
  const Icon = mode === 'help_me_choose' ? Compass : CheckCircle2;
  const tone = mode === 'help_me_choose'
    ? {
        borderColor: 'rgba(96, 165, 250, 0.36)',
        backgroundColor: 'rgba(239, 246, 255, 0.96)',
        iconBackground: 'rgba(191, 219, 254, 0.55)',
        iconColor: '#2563eb',
        eyebrowColor: '#2563eb',
      }
    : {
        borderColor: 'rgba(134, 239, 172, 0.4)',
        backgroundColor: 'rgba(240, 253, 244, 0.96)',
        iconBackground: 'rgba(187, 247, 208, 0.52)',
        iconColor: '#15803d',
        eyebrowColor: '#15803d',
      };

  return (
    <View
      style={[
        styles.card,
        compact ? styles.cardCompact : null,
        {
          borderColor: tone.borderColor,
          backgroundColor: tone.backgroundColor,
        },
      ]}
    >
      <View style={styles.headerRow}>
        <View style={[styles.iconWrap, { backgroundColor: tone.iconBackground }]}>
          <Icon size={17} color={tone.iconColor} strokeWidth={2.3} />
        </View>
        <View style={styles.copy}>
          <Text style={[styles.eyebrow, { color: tone.eyebrowColor }]}>Right now</Text>
          <Text style={styles.title}>{title}</Text>
          <Text style={styles.body}>{body}</Text>
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    borderRadius: 22,
    borderCurve: 'continuous',
    borderWidth: 1,
    paddingHorizontal: 16,
    paddingVertical: 14,
  },
  cardCompact: {
    borderRadius: 16,
    paddingHorizontal: 14,
    paddingVertical: 12,
  },
  headerRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 12,
  },
  iconWrap: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
  },
  copy: {
    flex: 1,
    gap: 2,
  },
  eyebrow: {
    fontSize: 11,
    lineHeight: 14,
    fontWeight: '900',
    letterSpacing: 0.8,
    textTransform: 'uppercase',
    includeFontPadding: false,
  },
  title: {
    fontSize: 18,
    lineHeight: 22,
    fontWeight: '800',
    color: '#0f172a',
    includeFontPadding: false,
  },
  body: {
    fontSize: 13,
    lineHeight: 18,
    fontWeight: '600',
    color: '#475569',
    includeFontPadding: false,
  },
});
