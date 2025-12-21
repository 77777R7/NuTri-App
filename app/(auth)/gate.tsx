// app/(auth)/gate.tsx
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Animated, Easing, StyleSheet, TouchableOpacity } from 'react-native';
import * as Haptics from 'expo-haptics';
import { StatusBar } from 'expo-status-bar';
import { useRouter, type Href } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Text, View } from '@/components/ui/nativewind-primitives';
import { BrandGradient } from '@/components/BrandGradient';
import { useAuth } from '@/contexts/AuthContext';
import { colors, spacing, type } from '@/lib/theme';

const AnimText = Animated.createAnimatedComponent(Text as any);

const PHRASES = [
  'NuTri ',
  'Let’s scan your supplement',
  'Let’s study your supplement',
  'Let’s optimize your health',
];

export default function AuthGateScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { session, loading: authLoading } = useAuth();

  const fade = useRef(new Animated.Value(0)).current;
  const translateY = useRef(new Animated.Value(12)).current;
  const [index, setIndex] = useState(0);

  useEffect(() => {
    if (!authLoading && session) {
      router.replace('/(tabs)');
    }
  }, [authLoading, session, router]);

  useEffect(() => {
    if (authLoading || session) return;

    const animateOnce = () => {
      fade.setValue(0);
      translateY.setValue(14);

      Animated.parallel([
        Animated.timing(fade, { toValue: 1, duration: 600, easing: Easing.out(Easing.cubic), useNativeDriver: true }),
        Animated.timing(translateY, { toValue: 0, duration: 600, easing: Easing.out(Easing.cubic), useNativeDriver: true }),
      ]).start();
    };

    animateOnce();
    const id = setInterval(() => {
      setIndex(prev => {
        const next = (prev + 1) % PHRASES.length;
        animateOnce();
        return next;
      });
    }, 2400);

    return () => clearInterval(id);
  }, [authLoading, fade, session, translateY]);

  const go = useCallback((path: Href) => router.push(path), [router]);

  if (authLoading || session) return null;

  return (
    <BrandGradient>
      <StatusBar style="dark" />
      <View style={{ flex: 1, paddingHorizontal: spacing.lg, paddingTop: insets.top + spacing.lg }}>
        <TouchableOpacity
          onPress={async () => {
            try {
              await Haptics.selectionAsync();
            } catch {}
            router.replace('/base44/welcome' as Href);
          }}
          activeOpacity={0.8}
          style={styles.backLink}
        >
          <Text style={styles.backLinkText}>← Back to welcome</Text>
        </TouchableOpacity>

        <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
          <AnimText
            style={[
              type.h1 as any,
              { textAlign: 'center', color: colors.text, opacity: fade, transform: [{ translateY }] },
            ]}
          >
            {PHRASES[index]}
          </AnimText>
        </View>

        <View style={{ paddingBottom: insets.bottom + spacing.lg + spacing.md, gap: spacing.md }}>
          {/* Create account */}
          <TouchableOpacity
            onPress={async () => {
              try {
                await Haptics.selectionAsync();
              } catch {}
              go('/auth/signup' as Href);
            }}
            activeOpacity={0.9}
            accessibilityRole="button"
            accessibilityLabel="Create account"
            testID="gate-create-account"
            style={styles.pillPrimary}
          >
            <Text style={styles.pillPrimaryText}>Create account</Text>
          </TouchableOpacity>

          {/* Log in */}
          <TouchableOpacity
            onPress={async () => {
              try {
                await Haptics.selectionAsync();
              } catch {}
              go('/auth/login' as Href);
            }}
            activeOpacity={0.9}
            accessibilityRole="button"
            accessibilityLabel="Log in"
            testID="gate-login"
            style={styles.pillSecondary}
          >
            <Text style={styles.pillSecondaryText}>Log in</Text>
          </TouchableOpacity>
        </View>
      </View>
    </BrandGradient>
  );
}
const styles = StyleSheet.create({
  pillPrimary: {
    width: '100%',                // ✅ 关键：铺满父容器
    borderRadius: 999,
    backgroundColor: colors.brand,
    paddingVertical: 16,
    alignItems: 'center',
    shadowColor: '#000',
    shadowOpacity: 0.12,
    shadowRadius: 10,
    shadowOffset: { width: 0, height: 6 },
    elevation: 6,
  },
  pillPrimaryText: {
    color: colors.surface,
    fontSize: 17,
    fontWeight: '800',
  },
  pillSecondary: {
    width: '100%',                // ✅ 关键：铺满父容器
    borderRadius: 999,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
    paddingVertical: 16,
    alignItems: 'center',
    shadowColor: '#000',
    shadowOpacity: 0.06,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 4 },
    elevation: 4,
  },
  pillSecondaryText: {
    color: colors.text,
    fontSize: 17,
    fontWeight: '700',
  },
  backLink: {
    alignSelf: 'flex-start',
    paddingVertical: 8,
  },
  backLinkText: {
    color: colors.subtext,
    fontSize: 15,
    fontWeight: '600',
  },
});
