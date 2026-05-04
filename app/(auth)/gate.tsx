// app/(auth)/gate.tsx
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Animated, Easing, StyleSheet, TouchableOpacity } from 'react-native';
import * as Haptics from 'expo-haptics';
import { StatusBar } from 'expo-status-bar';
import { useRouter, type Href } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Text, View } from '@/components/ui/nativewind-primitives';
import { BrandGradient } from '@/components/BrandGradient';
import { Config } from '@/constants/Config';
import { useAuth } from '@/contexts/AuthContext';
import { createGuestScanSessionFromServer } from '@/lib/api/guestScan';
import { trackOnboardingEvent } from '@/lib/analytics/onboarding';
import { AUTH_DISABLED } from '@/lib/auth-mode';
import { colors, spacing, type } from '@/lib/theme';

const AnimText = Animated.createAnimatedComponent(Text as any);

const PHRASES = [
  'NuTri ',
  'Scan a supplement',
  'See fit and safety fast',
  'Save what works for you',
];

export default function AuthGateScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { session, loading: authLoading } = useAuth();

  const fade = useRef(new Animated.Value(0)).current;
  const translateY = useRef(new Animated.Value(12)).current;
  const [index, setIndex] = useState(0);
  const [guestScanStarting, setGuestScanStarting] = useState(false);
  const [guestScanError, setGuestScanError] = useState<string | null>(null);
  const guestScanEnabled = Config.guestScanEnabled;

  useEffect(() => {
    if (AUTH_DISABLED) {
      router.replace('/');
      return;
    }
    if (!authLoading && session) {
      router.replace('/');
    }
  }, [authLoading, session, router]);

  useEffect(() => {
    if (AUTH_DISABLED || authLoading || session) return;

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
  const startFreeScan = useCallback(async () => {
    if (guestScanStarting) return;

    setGuestScanError(null);
    setGuestScanStarting(true);
    try {
      try {
        await Haptics.selectionAsync();
      } catch {}
      trackOnboardingEvent('first_scan_started', { source: 'auth_gate_start_free_scan' });
      const session = await createGuestScanSessionFromServer();
      router.push({
        pathname: '/scan/barcode',
        params: {
          source: 'guest_scan',
          guestScanSessionId: session.guestScanSessionId,
        },
      } as Href);
    } catch {
      setGuestScanError('Unable to start scan. Please try again.');
    } finally {
      setGuestScanStarting(false);
    }
  }, [guestScanStarting, router]);

  if (AUTH_DISABLED || authLoading || session) return null;

  return (
    <BrandGradient>
      <StatusBar style="dark" />
      <View style={{ flex: 1, paddingHorizontal: spacing.lg, paddingTop: insets.top + spacing.lg }}>
        <TouchableOpacity
          onPress={async () => {
            try {
              await Haptics.selectionAsync();
            } catch {}
            router.replace('/onboarding' as Href);
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
          <Text style={styles.scanFirstSubtext}>
            Get a fast read on fit, safety, and what to avoid.
          </Text>
        </View>

        <View style={{ paddingBottom: insets.bottom + spacing.lg + spacing.md, gap: spacing.md }}>
          {guestScanEnabled ? (
            <>
              <TouchableOpacity
                onPress={startFreeScan}
                disabled={guestScanStarting}
                activeOpacity={0.9}
                accessibilityRole="button"
                accessibilityLabel="Start Free Scan"
                testID="gate-start-free-scan"
                style={[styles.pillPrimary, guestScanStarting ? styles.pillDisabled : null]}
              >
                <Text style={styles.pillPrimaryText}>
                  {guestScanStarting ? 'Starting…' : 'Start Free Scan'}
                </Text>
              </TouchableOpacity>
              {guestScanError ? (
                <Text style={styles.errorText}>{guestScanError}</Text>
              ) : null}
            </>
          ) : null}

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
            style={guestScanEnabled ? styles.pillSecondary : styles.pillPrimary}
          >
            <Text style={guestScanEnabled ? styles.pillSecondaryText : styles.pillPrimaryText}>Create account</Text>
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
  pillDisabled: {
    opacity: 0.68,
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
  scanFirstSubtext: {
    marginTop: 14,
    maxWidth: 280,
    color: colors.subtext,
    fontSize: 16,
    lineHeight: 22,
    fontWeight: '600',
    textAlign: 'center',
  },
  errorText: {
    color: '#EF4444',
    fontSize: 13,
    fontWeight: '600',
    textAlign: 'center',
  },
});
