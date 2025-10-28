import * as Haptics from 'expo-haptics';
import { useRouter, type Href } from 'expo-router';
import React, { useCallback, useMemo } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View, type TextStyle } from 'react-native';
import Animated, { Easing, useAnimatedStyle, useSharedValue, withDelay, withTiming } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { StepSlide } from '@/components/animation/StepSlide';
import { NeumorphicCard } from '@/components/base44/qa/NeumorphicCard';
import { PulseHalo } from '@/components/base44/qa/PulseHalo';
import { useTransitionDir } from '@/contexts/TransitionContext';
import { colors, radii, spacing, type } from '@/lib/theme';

const HIGHLIGHTS = [
  {
    id: 'quick',
    title: 'Quick & Easy',
    description: 'Just 7 simple steps, takes about 3 minutes.',
  },
  {
    id: 'personalized',
    title: 'Personalized Plan',
    description: 'Get recommendations tailored to your goals.',
  },
  {
    id: 'science',
    title: 'Science-Backed',
    description: 'Based on the latest nutrition research.',
  },
];

export default function WelcomeScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { consumeDirection, setDirection } = useTransitionDir();

  const enterDirection = useMemo(() => {
    const direction = consumeDirection();
    return direction === 'none' ? 'forward' : direction;
  }, [consumeDirection]);

  const headingStyle = type.h1 as TextStyle;
  const paragraphStyle = type.p as TextStyle;
  const captionStyle = type.caption as TextStyle;

  const heroAnim = useFadeSlideIn(0, { initialScale: 0.9, initialY: -20, duration: 900 });
  const headingAnim = useFadeSlideIn(360, { initialY: 24, duration: 760 });
  const subtitleAnim = useFadeSlideIn(460, { initialY: 24, duration: 760 });
  const leadAnim = useFadeSlideIn(560, { initialY: 24, duration: 760 });
  const cardAnim = useFadeSlideIn(700, { initialY: 30, duration: 780 });
  const ctaAnim = useFadeSlideIn(860, { initialY: 36, duration: 780 });
  const footnoteAnim = useFadeSlideIn(1020, { initialY: 22, duration: 780 });

  const onStart = useCallback(async () => {
    try {
      await Haptics.selectionAsync();
    } catch {
      // noop
    }
    setDirection('forward');
    router.push('/base44/demographics' as Href);
  }, [router, setDirection]);

  return (
    <View
      style={[
        styles.root,
        {
          paddingTop: insets.top + spacing.lg,
          paddingBottom: Math.max(insets.bottom, spacing.lg),
        },
      ]}
    >
      <StepSlide direction={enterDirection} slideOnFirst mountKey={`base44-welcome-${enterDirection}`}>
        <ScrollView
          contentContainerStyle={styles.content}
          showsVerticalScrollIndicator={false}
          bounces={false}
        >
          <Animated.View style={[styles.hero, heroAnim]}>
            <PulseHalo size={112} color={colors.brand} />
          </Animated.View>

          <View style={styles.copyBlock}>
            <Animated.Text style={[headingStyle, styles.headline, headingAnim]}>Welcome to NuTri</Animated.Text>
            <Animated.Text style={[paragraphStyle, styles.subtitle, subtitleAnim]}>Your personal nutrition companion</Animated.Text>
            <Animated.Text style={[paragraphStyle, styles.lead, leadAnim]}>
              Let’s get to know you better in just 7 quick steps.
            </Animated.Text>
          </View>

          <Animated.View style={[styles.animatedBlock, cardAnim]}>
            <NeumorphicCard style={styles.card}>
              {HIGHLIGHTS.map((item, index) => (
                <View key={item.id} style={styles.highlightRow}>
                  <View style={styles.highlightBadge}>
                    <Text style={styles.highlightBadgeText}>{index + 1}</Text>
                  </View>
                  <View style={styles.highlightCopy}>
                    <Text style={styles.highlightTitle}>{item.title}</Text>
                    <Text style={styles.highlightDescription}>{item.description}</Text>
                  </View>
                </View>
              ))}
            </NeumorphicCard>
          </Animated.View>

          <Animated.View style={[styles.animatedBlock, ctaAnim]}>
            <Pressable onPress={onStart} style={styles.cta}>
              <Text style={styles.ctaText}>Get Started →</Text>
            </Pressable>
          </Animated.View>

          <Animated.Text style={[captionStyle, styles.footnote, footnoteAnim]}>
            Your data is secure and private. We never share without permission.
          </Animated.Text>
        </ScrollView>
      </StepSlide>
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: '#F9FBF9',
  },
  content: {
    flexGrow: 1,
    alignItems: 'center',
    paddingHorizontal: spacing.xl,
    paddingBottom: spacing.xl,
    gap: spacing.xl,
  },
  hero: {
    marginTop: spacing.xl,
  },
  copyBlock: {
    alignItems: 'center',
    gap: spacing.sm,
  },
  headline: {
    textAlign: 'center',
    color: colors.text,
  },
  subtitle: {
    textAlign: 'center',
    color: colors.subtext,
  },
  lead: {
    textAlign: 'center',
    color: colors.subtext,
  },
  card: {
    width: '100%',
    borderRadius: radii.xl,
    padding: spacing.lg,
    gap: spacing.lg,
  } as const,
  animatedBlock: {
    width: '100%',
  },
  highlightRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: spacing.md,
  },
  highlightBadge: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: colors.brand,
    alignItems: 'center',
    justifyContent: 'center',
  },
  highlightBadgeText: {
    color: colors.surface,
    fontWeight: '800',
    fontSize: 16,
  },
  highlightCopy: {
    flex: 1,
    gap: spacing.xs,
  },
  highlightTitle: {
    fontSize: 16,
    fontWeight: '700',
    color: colors.text,
  },
  highlightDescription: {
    fontSize: 14,
    color: colors.subtext,
    lineHeight: 20,
  },
  cta: {
    marginTop: spacing.sm,
    backgroundColor: colors.brand,
    paddingVertical: 16,
    paddingHorizontal: 28,
    borderRadius: 18,
    minWidth: 260,
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: colors.brand,
    shadowOpacity: 0.25,
    shadowRadius: 18,
    shadowOffset: { width: 0, height: 10 },
    elevation: 6,
  },
  ctaText: {
    color: colors.surface,
    fontSize: 18,
    fontWeight: '800',
  },
  footnote: {
    textAlign: 'center',
    color: colors.subtext,
    paddingHorizontal: spacing.sm,
  },
  testButton: {
    marginTop: spacing.md,
    paddingVertical: 14,
    paddingHorizontal: 24,
    borderRadius: 16,
    backgroundColor: colors.card,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: '#D1D5DB',
  },
  testButtonText: {
    fontSize: 16,
    fontWeight: '700',
    color: colors.brand,
    textTransform: 'uppercase',
  },
});

function useFadeSlideIn(
  delayMs: number,
  options?: {
    initialY?: number;
    initialScale?: number;
    duration?: number;
  },
) {
  const { initialY = 18, initialScale = 1, duration = 420 } = options ?? {};
  const opacity = useSharedValue(initialScale < 1 || initialY !== 0 ? 0 : 1);
  const translateY = useSharedValue(initialY);
  const scale = useSharedValue(initialScale);

  React.useEffect(() => {
    const config = { duration, easing: Easing.out(Easing.cubic) };
    opacity.value = withDelay(delayMs, withTiming(1, { duration: duration * 0.85, easing: Easing.out(Easing.cubic) }));
    translateY.value = withDelay(delayMs, withTiming(0, config));
    scale.value = withDelay(delayMs, withTiming(1, config));
  }, [delayMs, duration, opacity, scale, translateY]);

  return useAnimatedStyle(() => ({
    opacity: opacity.value,
    transform: [{ translateY: translateY.value }, { scale: scale.value }],
  }));
}
