import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  Image,
  LayoutAnimation,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  UIManager,
  View,
  type ImageSourcePropType,
} from 'react-native';
import { BlurView } from 'expo-blur';
import { LinearGradient } from 'expo-linear-gradient';
import { AlertTriangle, Bookmark, CheckCircle2, ChevronDown, Info, Shield, Target } from 'lucide-react-native';
import Animated, { FadeInUp, FadeOutDown } from 'react-native-reanimated';

import type {
  TopSectionBannerPresentation,
  TopSectionHeroPresentation,
  TopSectionInsightPresentation,
  TopSectionInsightTopic,
  TopSectionTone,
} from '@/lib/scan/analysisTopSectionPresentation';

if (Platform.OS === 'android' && UIManager.setLayoutAnimationEnabledExperimental) {
  UIManager.setLayoutAnimationEnabledExperimental(true);
}

const BLUR_PROPS = Platform.OS === 'android'
  ? ({ experimentalBlurMethod: 'dimezisBlurView' } as const)
  : ({} as const);

const getTonePalette = (tone: TopSectionTone) => {
  if (tone === 'positive') {
    return {
      chipFill: '#EAF5F0',
      chipBorder: 'rgba(30,123,85,0.10)',
      chipText: '#1E7B55',
      rowIconFill: '#EAF5F0',
      rowIconBorder: 'rgba(30,123,85,0.10)',
      rowIconText: '#1E7B55',
      bullet: '#CBD5E1',
    };
  }
  if (tone === 'caution') {
    return {
      chipFill: '#FFF6E7',
      chipBorder: 'rgba(217,119,6,0.16)',
      chipText: '#B45309',
      rowIconFill: '#FEF3C7',
      rowIconBorder: 'rgba(217,119,6,0.14)',
      rowIconText: '#D97706',
      bullet: '#D6C7A0',
    };
  }
  return {
    chipFill: '#EDF4FF',
    chipBorder: 'rgba(37,99,235,0.12)',
    chipText: '#2563EB',
    rowIconFill: '#EBF3FF',
    rowIconBorder: 'rgba(37,99,235,0.12)',
    rowIconText: '#2563EB',
    bullet: '#CBD5E1',
  };
};

const getRowIcon = (topic: TopSectionInsightTopic) => {
  switch (topic) {
    case 'support':
      return Target;
    case 'allergy':
      return CheckCircle2;
    case 'dose':
      return Info;
    case 'overlap':
      return Bookmark;
    case 'safety':
      return AlertTriangle;
    default:
      return Shield;
  }
};

type AnalysisTopSectionRedesignProps = {
  hero: TopSectionHeroPresentation;
  banner: TopSectionBannerPresentation | null;
  insights: TopSectionInsightPresentation[];
  title: string;
  brand?: string | null;
  imageSource?: ImageSourcePropType | null;
  verifiedLabelText?: string;
  defaultExpandedKey?: string | null;
  syncKey?: string;
};

export function AnalysisTopSectionRedesign({
  hero,
  banner,
  insights,
  title,
  brand,
  imageSource,
  verifiedLabelText = 'Verified Label Data',
  defaultExpandedKey = null,
  syncKey,
}: AnalysisTopSectionRedesignProps) {
  const heroPalette = useMemo(() => getTonePalette(hero.tone), [hero.tone]);
  const resolvedDefaultExpandedKey = useMemo(() => {
    if (defaultExpandedKey && insights.some((row) => row.key === defaultExpandedKey)) {
      return defaultExpandedKey;
    }
    return insights[0]?.key ?? null;
  }, [defaultExpandedKey, insights]);
  const derivedSyncKey = useMemo(
    () => syncKey ?? `${hero.chip}::${hero.summary}::${banner?.title ?? 'no-banner'}::${insights.map((row) => `${row.key}:${row.collapsedTitle}`).join('|')}`,
    [banner?.title, hero.chip, hero.summary, insights, syncKey],
  );

  const lastSyncKeyRef = useRef<string>(derivedSyncKey);
  const [expandedKey, setExpandedKey] = useState<string | null>(() => resolvedDefaultExpandedKey);

  useEffect(() => {
    if (lastSyncKeyRef.current === derivedSyncKey) return;
    lastSyncKeyRef.current = derivedSyncKey;
    setExpandedKey(resolvedDefaultExpandedKey);
  }, [derivedSyncKey, resolvedDefaultExpandedKey]);

  useEffect(() => {
    if (!expandedKey) return;
    if (insights.some((row) => row.key === expandedKey)) return;
    setExpandedKey(resolvedDefaultExpandedKey);
  }, [expandedKey, insights, resolvedDefaultExpandedKey]);

  return (
    <View style={styles.wrap}>
      <Animated.View entering={FadeInUp.duration(260)} style={styles.heroWrap}>
        <LinearGradient
          colors={['rgba(255,255,255,0.84)', 'rgba(255,255,255,0.70)']}
          start={{ x: 0.12, y: 0.02 }}
          end={{ x: 0.88, y: 1 }}
          style={styles.heroCard}
        >
          <BlurView intensity={18} tint="light" style={StyleSheet.absoluteFillObject} {...BLUR_PROPS} />
          <View style={styles.heroHairline} />

          <View style={styles.heroChipRow}>
            <View
              style={[
                styles.heroChip,
                {
                  backgroundColor: heroPalette.chipFill,
                  borderColor: heroPalette.chipBorder,
                },
              ]}
            >
              <Text style={[styles.heroChipText, { color: heroPalette.chipText }]}>{hero.chip}</Text>
            </View>
          </View>

          <View style={styles.heroProductRow}>
            <View style={styles.imageShell}>
              {imageSource ? (
                <Image source={imageSource} style={styles.heroImage} resizeMode="cover" />
              ) : (
                <LinearGradient
                  colors={['#FFFFFF', '#F1F5F9']}
                  start={{ x: 0.2, y: 0.1 }}
                  end={{ x: 0.9, y: 1 }}
                  style={styles.placeholderCard}
                >
                  <View style={styles.placeholderBottle} />
                </LinearGradient>
              )}
            </View>

            <View style={styles.heroTextBlock}>
              <Text style={styles.heroTitle} numberOfLines={2}>{title}</Text>
              {!!brand ? <Text style={styles.heroBrand}>{brand}</Text> : null}
            </View>
          </View>

          <View style={styles.heroDivider} />
          <Text style={styles.heroSummary}>{hero.summary}</Text>

          <View style={styles.verifiedRow}>
            <Shield size={14} color="#64748B" />
            <Text style={styles.verifiedText}>{verifiedLabelText}</Text>
          </View>
        </LinearGradient>
      </Animated.View>

      {banner ? (
        <Animated.View entering={FadeInUp.delay(60).duration(240)} style={styles.bannerWrap}>
          <View style={styles.bannerCard}>
            <View style={styles.bannerIconShell}>
              <AlertTriangle size={18} color="#D97706" strokeWidth={2.4} />
            </View>
            <Text style={styles.bannerText}>{banner.title}</Text>
          </View>
        </Animated.View>
      ) : null}

      {insights.length > 0 ? (
        <Animated.View entering={FadeInUp.delay(120).duration(280)} style={styles.insightsWrap}>
          <Text style={styles.sectionTitle}>Personalized insights</Text>
          <View style={styles.listCard}>
            {insights.map((row, index) => (
              <InsightAccordionRow
                key={`${derivedSyncKey}:${row.key}`}
                row={row}
                isExpanded={expandedKey === row.key}
                isLast={index === insights.length - 1}
                onToggle={() => {
                  LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);
                  setExpandedKey((current) => (current === row.key ? null : row.key));
                }}
              />
            ))}
          </View>
        </Animated.View>
      ) : null}
    </View>
  );
}

type InsightAccordionRowProps = {
  row: TopSectionInsightPresentation;
  isExpanded: boolean;
  isLast: boolean;
  onToggle: () => void;
};

function InsightAccordionRow({ row, isExpanded, isLast, onToggle }: InsightAccordionRowProps) {
  const palette = getTonePalette(row.tone);
  const Icon = getRowIcon(row.topic);

  return (
    <View>
      <Pressable onPress={onToggle} style={({ pressed }) => [styles.rowPressable, pressed && styles.rowPressablePressed]}>
        <View
          style={[
            styles.rowIconShell,
            {
              backgroundColor: palette.rowIconFill,
              borderColor: palette.rowIconBorder,
            },
          ]}
        >
          <Icon size={18} color={palette.rowIconText} strokeWidth={2.2} />
        </View>

        <View style={styles.rowCopyWrap}>
          <Text style={styles.rowTitle} numberOfLines={isExpanded ? 3 : 2}>
            {row.collapsedTitle}
          </Text>
        </View>

        <View style={[styles.chevronWrap, isExpanded && styles.chevronWrapExpanded]}>
          <ChevronDown size={20} color="#64748B" strokeWidth={2.4} />
        </View>
      </Pressable>

      {isExpanded && row.expandedBullets.length > 0 ? (
        <Animated.View entering={FadeInUp.duration(180)} exiting={FadeOutDown.duration(140)} style={styles.expandedWrap}>
          {row.expandedBullets.map((bullet, index) => (
            <View key={`${row.key}-${index}`} style={styles.bulletRow}>
              <View style={[styles.bulletDot, { backgroundColor: palette.bullet }]} />
              <Text style={styles.bulletText}>{bullet}</Text>
            </View>
          ))}
        </Animated.View>
      ) : null}

      {!isLast ? <View style={styles.rowDivider} /> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    marginTop: 8,
    marginBottom: 18,
    paddingHorizontal: 8,
  },
  heroWrap: {
    marginBottom: 16,
  },
  heroCard: {
    overflow: 'hidden',
    borderRadius: 32,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.82)',
    paddingHorizontal: 22,
    paddingVertical: 20,
    backgroundColor: 'rgba(255,255,255,0.72)',
    shadowColor: '#0B1E36',
    shadowOpacity: 0.035,
    shadowRadius: 20,
    shadowOffset: { width: 0, height: 8 },
  },
  heroHairline: {
    ...StyleSheet.absoluteFillObject,
    borderRadius: 32,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.58)',
  },
  heroChipRow: {
    marginBottom: 18,
  },
  heroChip: {
    alignSelf: 'flex-start',
    borderRadius: 999,
    borderWidth: 1,
    paddingHorizontal: 18,
    paddingVertical: 11,
  },
  heroChipText: {
    fontSize: 14,
    fontWeight: '700',
    letterSpacing: -0.2,
  },
  heroProductRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 16,
  },
  imageShell: {
    width: 76,
    height: 76,
    borderRadius: 22,
    overflow: 'hidden',
    backgroundColor: '#FFFFFF',
    borderWidth: 1,
    borderColor: 'rgba(226,232,240,0.95)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  heroImage: {
    width: '100%',
    height: '100%',
  },
  placeholderCard: {
    width: '100%',
    height: '100%',
    alignItems: 'center',
    justifyContent: 'center',
  },
  placeholderBottle: {
    width: 28,
    height: 44,
    borderRadius: 10,
    backgroundColor: '#CBD5E1',
    opacity: 0.9,
  },
  heroTextBlock: {
    flex: 1,
    justifyContent: 'center',
  },
  heroTitle: {
    fontSize: 20,
    lineHeight: 25,
    fontWeight: '800',
    letterSpacing: -0.45,
    color: '#0B1E36',
  },
  heroBrand: {
    marginTop: 5,
    fontSize: 15,
    lineHeight: 20,
    fontWeight: '500',
    color: '#64748B',
    letterSpacing: -0.16,
  },
  heroDivider: {
    marginTop: 18,
    marginBottom: 18,
    height: StyleSheet.hairlineWidth,
    backgroundColor: 'rgba(11,30,54,0.08)',
  },
  heroSummary: {
    fontSize: 15,
    lineHeight: 22,
    fontWeight: '650',
    color: '#0B1E36',
    letterSpacing: -0.18,
  },
  verifiedRow: {
    marginTop: 14,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  verifiedText: {
    fontSize: 13,
    lineHeight: 18,
    fontWeight: '500',
    color: '#64748B',
    letterSpacing: -0.08,
  },
  bannerWrap: {
    marginBottom: 18,
  },
  bannerCard: {
    minHeight: 74,
    borderRadius: 26,
    borderWidth: 1,
    borderColor: 'rgba(245,158,11,0.22)',
    backgroundColor: 'rgba(255,248,234,0.92)',
    paddingHorizontal: 16,
    paddingVertical: 14,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
    shadowColor: '#D97706',
    shadowOpacity: 0.05,
    shadowRadius: 14,
    shadowOffset: { width: 0, height: 6 },
  },
  bannerIconShell: {
    width: 44,
    height: 44,
    borderRadius: 22,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#FFF5D7',
    borderWidth: 1,
    borderColor: 'rgba(253,224,71,0.38)',
  },
  bannerText: {
    flex: 1,
    fontSize: 15,
    lineHeight: 22,
    fontWeight: '700',
    letterSpacing: -0.2,
    color: '#B45309',
  },
  insightsWrap: {
    marginBottom: 18,
  },
  sectionTitle: {
    marginBottom: 14,
    paddingHorizontal: 8,
    fontSize: 18,
    lineHeight: 24,
    fontWeight: '800',
    color: '#0B1E36',
    letterSpacing: -0.45,
  },
  listCard: {
    overflow: 'hidden',
    borderRadius: 32,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.74)',
    backgroundColor: 'rgba(255,255,255,0.76)',
    shadowColor: '#0B1E36',
    shadowOpacity: 0.03,
    shadowRadius: 18,
    shadowOffset: { width: 0, height: 6 },
  },
  rowPressable: {
    minHeight: 78,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
    paddingHorizontal: 16,
    paddingVertical: 16,
  },
  rowPressablePressed: {
    opacity: 0.86,
  },
  rowIconShell: {
    width: 46,
    height: 46,
    borderRadius: 23,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
  },
  rowCopyWrap: {
    flex: 1,
  },
  rowTitle: {
    fontSize: 15,
    lineHeight: 22,
    fontWeight: '650',
    letterSpacing: -0.18,
    color: '#0B1E36',
  },
  chevronWrap: {
    alignItems: 'center',
    justifyContent: 'center',
    transform: [{ rotate: '0deg' }],
  },
  chevronWrapExpanded: {
    transform: [{ rotate: '180deg' }],
  },
  expandedWrap: {
    paddingLeft: 76,
    paddingRight: 18,
    paddingBottom: 18,
    gap: 12,
  },
  bulletRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 10,
  },
  bulletDot: {
    width: 7,
    height: 7,
    borderRadius: 3.5,
    marginTop: 7,
  },
  bulletText: {
    flex: 1,
    fontSize: 14,
    lineHeight: 20,
    fontWeight: '500',
    letterSpacing: -0.14,
    color: '#475569',
  },
  rowDivider: {
    marginLeft: 76,
    marginRight: 18,
    height: StyleSheet.hairlineWidth,
    backgroundColor: 'rgba(11,30,54,0.08)',
  },
});
