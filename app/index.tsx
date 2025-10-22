import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Animated, Easing, StyleSheet, Text as RNText } from 'react-native';
import { StatusBar } from 'expo-status-bar';
import { useRouter, type Href } from 'expo-router';

import { BrandGradient } from '@/components/BrandGradient';
import { useAuth } from '@/contexts/AuthContext';
import { useOnboarding } from '@/contexts/OnboardingContext';
import { fetchUserProfile } from '@/lib/supabase/profile';
import { supabase } from '@/lib/supabase';
import { colors } from '@/lib/theme';
import { Text, TouchableOpacity, View } from '@/components/ui/nativewind-primitives';

const AnimatedHeadline = Animated.createAnimatedComponent(RNText) as React.ComponentType<{
  children?: React.ReactNode;
  style?: any;
}>;

const PHRASES = ['Welcome to NuTri', 'Let’s scan your supplement', 'Let’s study your supplement', 'Let’s optimize your health'];

const routeForProgress = (progress: number): Href => {
  if (progress <= 1) {
    return '/onboarding/welcome';
  }
  if (progress === 2) {
    return '/onboarding/profile';
  }
  if (progress === 3) {
    return '/onboarding/diet';
  }
  if (progress === 4) {
    return '/onboarding/activity';
  }
  if (progress === 5) {
    return '/onboarding/location';
  }
  if (progress === 6) {
    return '/onboarding/goals';
  }
  if (progress === 7) {
    return '/onboarding/privacy';
  }

  return '/onboarding/profile';
};

export default function IntroScreen() {
  const router = useRouter();
  const { session, loading: authLoading } = useAuth();
  const { loading: onboardingLoading, onbCompleted, progress, trial, draftUpdatedAt } = useOnboarding();
  const fade = useRef(new Animated.Value(0)).current;
  const translate = useRef(new Animated.Value(12)).current;
  const [index, setIndex] = useState(0);

  const marketingActive = useMemo(() => !onboardingLoading && !onbCompleted && !authLoading && !session, [authLoading, onboardingLoading, onbCompleted, session]);

  useEffect(() => {
    if (!onboardingLoading && !onbCompleted) {
      if (progress >= 7 && trial.status !== 'not_started') {
        router.replace('/(auth)/gate');
        return;
      }
      const target = routeForProgress(progress);
      router.replace(target);
    }
  }, [onboardingLoading, onbCompleted, progress, router, trial.status]);

  useEffect(() => {
    if (onboardingLoading || authLoading) return;
    if (onbCompleted && !session) {
      router.replace('/(auth)/gate');
    }
  }, [authLoading, onboardingLoading, onbCompleted, router, session]);

  useEffect(() => {
    if (onboardingLoading || authLoading) return;
    if (!session?.user?.id) return;
    if (!onbCompleted) return;

    let cancelled = false;

    const verifyProfile = async () => {
      try {
        const { data, error } = await fetchUserProfile(supabase, session.user.id);
        if (cancelled) return;

        if (error) {
          console.warn('☁️ Fetch profile error', error);
        }

        if (!data || data.onboarding_completed !== true) {
          router.replace('/(auth)/post-onboarding-upsert');
          return;
        }

        const serverUpdatedAt = data.updated_at ? new Date(data.updated_at).getTime() : 0;
        const localUpdatedAt = draftUpdatedAt ? new Date(draftUpdatedAt).getTime() : 0;

        if (localUpdatedAt > serverUpdatedAt) {
          router.replace('/(auth)/post-onboarding-upsert');
          return;
        }

        router.replace('/(tabs)/home');
      } catch (error) {
        console.warn('☁️ Profile verify error', error);
        router.replace('/(tabs)/home');
      }
    };

    verifyProfile();

    return () => {
      cancelled = true;
    };
  }, [authLoading, draftUpdatedAt, onboardingLoading, onbCompleted, router, session?.user?.id]);

  useEffect(() => {
    if (!marketingActive) return;

    const animate = () => {
      fade.setValue(0);
      translate.setValue(12);
      Animated.parallel([
        Animated.timing(fade, {
          toValue: 1,
          duration: 550,
          easing: Easing.out(Easing.cubic),
          useNativeDriver: true,
        }),
        Animated.timing(translate, {
          toValue: 0,
          duration: 550,
          easing: Easing.out(Easing.cubic),
          useNativeDriver: true,
        }),
      ]).start();
    };

    animate();
    const id = setInterval(() => {
      setIndex(prev => {
        const next = (prev + 1) % PHRASES.length;
        animate();
        return next;
      });
    }, 2200);

    return () => {
      clearInterval(id);
    };
  }, [fade, marketingActive, translate]);

  const navigateToAuth = useCallback(
    (path: Href) => {
      router.push(path);
    },
    [router],
  );

  if (onboardingLoading || authLoading) {
    return null;
  }

  if (onbCompleted) {
    return null;
  }

  return (
    <BrandGradient>
      <StatusBar style="dark" />
      <View style={styles.container}>
        <View style={styles.center}>
          <AnimatedHeadline
            style={[
              styles.headline,
              {
                opacity: fade,
                transform: [{ translateY: translate }],
              },
            ]}
          >
            {PHRASES[index]}
          </AnimatedHeadline>
        </View>

        <View style={styles.sheet}>
          <TouchableOpacity activeOpacity={0.9} onPress={() => navigateToAuth('/auth/signup')} style={styles.primary}>
            <Text style={styles.primaryText}>Create account</Text>
          </TouchableOpacity>
          <TouchableOpacity activeOpacity={0.9} onPress={() => navigateToAuth('/auth/login')} style={styles.secondary}>
            <Text style={styles.secondaryText}>Log in</Text>
          </TouchableOpacity>
        </View>
      </View>
    </BrandGradient>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    paddingVertical: 24,
  },
  center: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 32,
  },
  headline: {
    fontSize: 32,
    fontWeight: '800',
    color: colors.text,
    textAlign: 'center',
    letterSpacing: 0.3,
  },
  sheet: {
    backgroundColor: colors.card,
    borderTopLeftRadius: 28,
    borderTopRightRadius: 28,
    padding: 24,
    gap: 12,
    shadowColor: '#000000',
    shadowOpacity: 0.08,
    shadowRadius: 16,
    shadowOffset: { width: 0, height: -4 },
    elevation: 6,
  },
  primary: {
    height: 56,
    borderRadius: 999,
    backgroundColor: colors.brand,
    alignItems: 'center',
    justifyContent: 'center',
  },
  primaryText: {
    color: '#FFFFFF',
    fontSize: 18,
    fontWeight: '800',
  },
  secondary: {
    height: 56,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: colors.border,
    alignItems: 'center',
    justifyContent: 'center',
  },
  secondaryText: {
    color: colors.text,
    fontSize: 16,
    fontWeight: '700',
  },
});
