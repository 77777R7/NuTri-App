// app/(auth)/gate.tsx
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Animated, Easing } from 'react-native';
import { StatusBar } from 'expo-status-bar';
import { useRouter, type Href } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

// primitives 作为宿主，避免 Animated 类型报错
import { Text, View } from '@/components/ui/nativewind-primitives';
import AppHeader from '@/components/common/AppHeader';
import { BrandGradient } from '@/components/BrandGradient';
import { PrimaryButton, SecondaryButton } from '@/components/ui/Buttons';

import { useAuth } from '@/contexts/AuthContext';
import { useOnboarding } from '@/contexts/OnboardingContext';
import { colors, spacing, type } from '@/lib/theme';

// 用 primitives 包装 Animated 组件（只需要 Text 的动画）
const AnimText = Animated.createAnimatedComponent(Text as any);

const PHRASES = [
  'Welcome to NuTri',
  'Let’s scan your supplement',
  'Let’s study your supplement',
  'Let’s optimize your health',
  'Create an account to save your plan',
];

export default function AuthGateScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { session, loading: authLoading } = useAuth();
  const { loading: onbLoading, onbCompleted, trial } = useOnboarding();

  // 文字动效
  const fade = useRef(new Animated.Value(0)).current;
  const translateY = useRef(new Animated.Value(12)).current;
  const subFade = useRef(new Animated.Value(0)).current;
  const subTranslate = useRef(new Animated.Value(8)).current;
  const [index, setIndex] = useState(0);

  const canShowGate = useMemo(
    () => !onbLoading && onbCompleted && !authLoading && !session && trial?.status !== 'not_started',
    [onbLoading, onbCompleted, authLoading, session, trial?.status]
  );

  // 若未选择试用，回 Trial Offer（双保险）
  useEffect(() => {
    if (!onbLoading && onbCompleted && trial?.status === 'not_started') {
      router.replace('/onboarding/trial-offer');
    }
  }, [onbLoading, onbCompleted, trial?.status, router]);

  // 已登录 → tabs（index 守卫也会处理，这里再兜底）
  useEffect(() => {
    if (!authLoading && session) {
      router.replace('/(tabs)');
    }
  }, [authLoading, session, router]);

  // 文案轮播动画
  useEffect(() => {
    if (!canShowGate) return;

    const animateOnce = () => {
      fade.setValue(0);
      translateY.setValue(12);
      subFade.setValue(0);
      subTranslate.setValue(8);

      Animated.parallel([
        Animated.timing(fade, { toValue: 1, duration: 520, easing: Easing.out(Easing.cubic), useNativeDriver: true }),
        Animated.timing(translateY, { toValue: 0, duration: 520, easing: Easing.out(Easing.cubic), useNativeDriver: true }),
        Animated.timing(subFade, { toValue: 1, delay: 100, duration: 420, easing: Easing.out(Easing.cubic), useNativeDriver: true }),
        Animated.timing(subTranslate, { toValue: 0, delay: 100, duration: 420, easing: Easing.out(Easing.cubic), useNativeDriver: true }),
      ]).start();
    };

    animateOnce();
    const id = setInterval(() => {
      setIndex((prev) => {
        const next = (prev + 1) % PHRASES.length;
        animateOnce();
        return next;
      });
    }, 2200);

    return () => clearInterval(id);
  }, [canShowGate, fade, translateY, subFade, subTranslate]);

  const go = useCallback((path: Href) => router.push(path), [router]);

  if (onbLoading || authLoading || !canShowGate) return null;

  return (
    <BrandGradient>
      <StatusBar style="dark" />
      <AppHeader showBack title="Sign in to save" />

      <View style={{ flex: 1, paddingHorizontal: spacing.lg }}>
        {/* 居中动效文案 */}
        <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
          <AnimText
            style={[
              type.h2 as any,
              { color: colors.subtext, letterSpacing: 1, opacity: fade, transform: [{ translateY }] },
            ]}
          >
            YOU’RE ALMOST THERE
          </AnimText>

          <AnimText
            style={[
              type.h1 as any,
              { textAlign: 'center', color: colors.text, marginTop: spacing.sm, opacity: fade, transform: [{ translateY }] },
            ]}
          >
            {PHRASES[index]}
          </AnimText>

          <AnimText
            style={[
              type.p as any,
              {
                textAlign: 'center',
                marginTop: spacing.md,
                opacity: subFade,
                transform: [{ translateY: subTranslate }],
              },
            ]}
          >
            We use your profile to sync across devices and keep your supplement plan safe.
          </AnimText>
        </View>

        {/* 按钮区 */}
        <View style={{ paddingBottom: insets.bottom + spacing.lg, gap: spacing.md }}>
          <PrimaryButton title="Create account" onPress={() => go('/auth/signup')} testID="gate-signup" />
          <SecondaryButton title="Log in" onPress={() => go('/auth/login')} testID="gate-login" />
        </View>
      </View>
    </BrandGradient>
  );
}