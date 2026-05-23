import { StatusBar } from 'expo-status-bar';
import * as Haptics from 'expo-haptics';
import { Check, Sparkles } from 'lucide-react-native';
import React, { useEffect, useMemo, useRef } from 'react';
import {
  Animated as RNAnimated,
  Easing,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { trackPostPurchaseCtaTapped, trackPostPurchaseViewed } from '@/lib/analytics/pro';
import type { OfficialPaywallSource } from '@/lib/pro/featureGates';

type PostPurchaseSuccessPageProps = {
  source: OfficialPaywallSource;
  resumeTo: string;
  returnTo?: string | null;
  productId?: string | null;
  isTrial?: boolean;
  isRestore?: boolean;
  purchaseCompletedAt?: number | null;
  onContinue: () => void;
};

type PostPurchaseCopy = {
  eyebrow: string;
  title: string;
  body: string;
  cta: string;
  unlocked: string[];
};

const SERIF_FONT = Platform.select({
  ios: 'Georgia',
  android: 'serif',
  default: 'serif',
});

const CONFETTI_COLORS = ['#3B82F6', '#22C55E', '#F59E0B', '#EF4444', '#A855F7', '#06B6D4'];

const CONFETTI_PIECES = Array.from({ length: 28 }, (_, index) => ({
  id: `confetti-${index}`,
  color: CONFETTI_COLORS[index % CONFETTI_COLORS.length],
  left: 6 + ((index * 17) % 88),
  top: 22 + ((index * 13) % 54),
  fall: 110 + ((index * 19) % 180),
  drift: ((index % 2 === 0 ? 1 : -1) * (18 + ((index * 11) % 60))),
  rotate: `${index % 2 === 0 ? 240 : -240}deg`,
  delay: (index % 7) * 35,
  width: 6 + (index % 3) * 3,
  height: 12 + (index % 4) * 4,
}));

const RELEASE_READY_UNLOCKED_ITEMS = [
  'More supplement scans',
  'Product Search',
  'More saved supplements',
  'Stack Safety',
];

export const getPostPurchaseCopy = (source: OfficialPaywallSource): PostPurchaseCopy => {
  switch (source) {
    case 'scan_limit':
      return {
        eyebrow: 'NUTRI PRO IS ACTIVE',
        title: 'Your Pro scans are ready',
        body: 'You can keep checking supplements before you buy.',
        cta: 'Continue scanning',
        unlocked: RELEASE_READY_UNLOCKED_ITEMS,
      };
    case 'product_search':
      return {
        eyebrow: 'PRODUCT SEARCH UNLOCKED',
        title: 'Product Search is unlocked',
        body: 'Search by brand, ingredient, or goal and inspect richer product results.',
        cta: 'Continue searching',
        unlocked: RELEASE_READY_UNLOCKED_ITEMS,
      };
    case 'saved_supplement_limit':
      return {
        eyebrow: 'SAVED STACK UNLOCKED',
        title: 'Your supplement stack is unlocked',
        body: 'Return to the supplement you were saving and keep more than one item in My Saved.',
        cta: 'Save this supplement',
        unlocked: RELEASE_READY_UNLOCKED_ITEMS,
      };
    case 'stack_safety':
      return {
        eyebrow: 'STACK SAFETY READY',
        title: 'Stack Safety is ready',
        body: 'Review repeated ingredients and dose overlaps when labels include usable dose data.',
        cta: 'Review stack safety',
        unlocked: RELEASE_READY_UNLOCKED_ITEMS,
      };
    case 'profile_upgrade':
      return {
        eyebrow: 'WELCOME TO NUTRI PRO',
        title: 'Welcome to NuTri Pro',
        body: 'You now have the release-ready Pro features available in NuTri.',
        cta: 'Start with Product Search',
        unlocked: RELEASE_READY_UNLOCKED_ITEMS,
      };
    case 'score':
      return {
        eyebrow: 'NUTRI SCORE UNLOCKED',
        title: 'Your full score breakdown is ready.',
        body: 'Go back to the scan and see the evidence, gaps, and score details.',
        cta: 'View your score',
        unlocked: ['Full NuTri Score', 'Evidence gaps', 'Personalized fit checks'],
      };
    case 'science':
      return {
        eyebrow: 'INGREDIENT DEEP DIVE UNLOCKED',
        title: 'Your ingredient science is ready.',
        body: 'Return to the scan for ingredient context, form notes, and practical evidence.',
        cta: 'View ingredient science',
        unlocked: ['Ingredient deep dive', 'Form context', 'Practical evidence'],
      };
    case 'usage':
      return {
        eyebrow: 'USAGE CONTEXT UNLOCKED',
        title: 'Your practical usage context is ready.',
        body: 'Return to the scan for routine timing, label directions, and usage notes.',
        cta: 'View usage context',
        unlocked: ['Usage context', 'Label directions', 'Routine timing'],
      };
    case 'safety':
      return {
        eyebrow: 'SAFETY CONTEXT UNLOCKED',
        title: 'Your safety context is ready.',
        body: 'Return to the scan for label warnings, upper-limit context, and watch-outs.',
        cta: 'View safety context',
        unlocked: ['Safety context', 'Label warnings', 'Upper-limit context'],
      };
    case 'overview':
      return {
        eyebrow: 'PRODUCT BREAKDOWN UNLOCKED',
        title: 'Your product breakdown is ready.',
        body: 'Return to the scan for what the supplement provides and what needs a closer look.',
        cta: 'View product breakdown',
        unlocked: ['Product overview', 'Coverage notes', 'Decision details'],
      };
    case 'first_scan_result':
    default:
      return {
        eyebrow: 'WELCOME TO NUTRI PRO',
        title: 'Your full insights are ready.',
        body: 'Continue to your scan and keep using the Pro features you just unlocked.',
        cta: 'View your insights',
        unlocked: ['Full scan breakdowns', 'More supplement scans', 'Saved stack safety'],
      };
  }
};

const ConfettiBurst = () => {
  const progress = useRef(new RNAnimated.Value(0)).current;

  useEffect(() => {
    RNAnimated.timing(progress, {
      toValue: 1,
      duration: 1450,
      easing: Easing.out(Easing.cubic),
      useNativeDriver: true,
    }).start();
  }, [progress]);

  return (
    <View pointerEvents="none" style={styles.confettiLayer}>
      {CONFETTI_PIECES.map((piece) => {
        const delayed = progress.interpolate({
          inputRange: [0, Math.max(0.01, Math.min(0.96, piece.delay / 1450)), 1],
          outputRange: [0, 0, 1],
        });

        return (
          <RNAnimated.View
            key={piece.id}
            style={[
              styles.confettiPiece,
              {
                top: piece.top,
                left: `${piece.left}%`,
                width: piece.width,
                height: piece.height,
                backgroundColor: piece.color,
                opacity: delayed.interpolate({
                  inputRange: [0, 0.18, 0.78, 1],
                  outputRange: [0, 1, 1, 0],
                }),
                transform: [
                  {
                    translateX: delayed.interpolate({
                      inputRange: [0, 1],
                      outputRange: [0, piece.drift],
                    }),
                  },
                  {
                    translateY: delayed.interpolate({
                      inputRange: [0, 1],
                      outputRange: [-34, piece.fall],
                    }),
                  },
                  {
                    rotate: delayed.interpolate({
                      inputRange: [0, 1],
                      outputRange: ['0deg', piece.rotate],
                    }),
                  },
                ],
              },
            ]}
          />
        );
      })}
    </View>
  );
};

export function PostPurchaseSuccessPage({
  source,
  resumeTo,
  returnTo = null,
  productId = null,
  isTrial = false,
  isRestore = false,
  purchaseCompletedAt = null,
  onContinue,
}: PostPurchaseSuccessPageProps) {
  const insets = useSafeAreaInsets();
  const viewedRef = useRef(false);
  const copy = useMemo(() => getPostPurchaseCopy(source), [source]);

  useEffect(() => {
    if (viewedRef.current) return;
    viewedRef.current = true;

    trackPostPurchaseViewed({
      source,
      resumeTo,
      returnTo,
      ctaLabel: copy.cta,
      productId,
      isTrial,
      isRestore,
    });

    void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => undefined);
  }, [copy.cta, isRestore, isTrial, productId, resumeTo, returnTo, source]);

  const handleContinue = () => {
    trackPostPurchaseCtaTapped({
      source,
      resumeTo,
      returnTo,
      ctaLabel: copy.cta,
      productId,
      isTrial,
      isRestore,
      timeToFirstProAction: purchaseCompletedAt ? Date.now() - purchaseCompletedAt : null,
    });
    void Haptics.selectionAsync().catch(() => undefined);
    onContinue();
  };

  return (
    <View style={styles.screen}>
      <StatusBar style="light" />
      <ConfettiBurst />

      <View style={[styles.content, { paddingTop: Math.max(insets.top + 44, 78), paddingBottom: Math.max(insets.bottom + 24, 42) }]}>
        <View style={styles.badge}>
          <Sparkles size={22} color="#FFFFFF" strokeWidth={2.6} />
        </View>

        <View style={styles.copyBlock}>
          <Text style={styles.eyebrow}>{copy.eyebrow}</Text>
          <Text style={styles.title}>{copy.title}</Text>
          <Text style={styles.body}>{copy.body}</Text>
        </View>

        <View style={styles.unlockList}>
          {copy.unlocked.map((item) => (
            <View key={item} style={styles.unlockRow}>
              <View style={styles.checkDot}>
                <Check size={13} color="#FFFFFF" strokeWidth={3.2} />
              </View>
              <Text style={styles.unlockText}>{item}</Text>
            </View>
          ))}
        </View>

        <Pressable
          style={styles.cta}
          onPress={handleContinue}
          accessibilityRole="button"
          accessibilityLabel={copy.cta}
        >
          <Text style={styles.ctaText}>{copy.cta}</Text>
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    overflow: 'hidden',
    backgroundColor: '#111827',
  },
  confettiLayer: {
    ...StyleSheet.absoluteFillObject,
    zIndex: 2,
  },
  confettiPiece: {
    position: 'absolute',
    borderRadius: 3,
  },
  content: {
    flex: 1,
    zIndex: 3,
    paddingHorizontal: 26,
    justifyContent: 'center',
  },
  badge: {
    width: 72,
    height: 72,
    borderRadius: 36,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#3B82F6',
    shadowColor: '#1D4ED8',
    shadowOpacity: 0.28,
    shadowRadius: 18,
    shadowOffset: { width: 0, height: 10 },
    elevation: 8,
  },
  copyBlock: {
    marginTop: 30,
    gap: 12,
  },
  eyebrow: {
    fontSize: 11,
    lineHeight: 16,
    fontWeight: '900',
    color: '#93C5FD',
    letterSpacing: 1.1,
  },
  title: {
    maxWidth: 360,
    fontFamily: SERIF_FONT,
    fontSize: 34,
    lineHeight: 42,
    fontWeight: '700',
    color: '#FFFFFF',
    letterSpacing: 0,
  },
  body: {
    maxWidth: 354,
    fontSize: 16,
    lineHeight: 23,
    fontWeight: '700',
    color: '#CBD5E1',
    letterSpacing: 0,
  },
  unlockList: {
    gap: 14,
    marginTop: 34,
  },
  unlockRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  checkDot: {
    width: 22,
    height: 22,
    borderRadius: 11,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#22C55E',
  },
  unlockText: {
    flex: 1,
    fontSize: 15,
    lineHeight: 21,
    fontWeight: '800',
    color: '#F8FAFC',
    letterSpacing: 0,
  },
  cta: {
    width: '100%',
    minHeight: 58,
    marginTop: 44,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#FFFFFF',
    shadowColor: '#000000',
    shadowOpacity: 0.22,
    shadowRadius: 16,
    shadowOffset: { width: 0, height: 10 },
    elevation: 6,
  },
  ctaText: {
    fontSize: 17,
    lineHeight: 24,
    fontWeight: '900',
    color: '#111827',
    letterSpacing: 0,
  },
});
