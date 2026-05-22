// app/(auth)/gate.tsx
import React, { useCallback, useEffect } from 'react';
import { Platform, StyleSheet, TouchableOpacity } from 'react-native';
import { Image } from 'expo-image';
import * as Haptics from 'expo-haptics';
import { StatusBar } from 'expo-status-bar';
import { useRootNavigationState, useRouter, type Href } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { AuthLogoPill } from '@/components/auth/AuthLogoPill';
import { SplitPhraseHeadline } from '@/components/auth/SplitPhraseHeadline';
import { Text, View } from '@/components/ui/nativewind-primitives';
import { useAuth } from '@/contexts/AuthContext';
import { spacing } from '@/lib/theme';

const PHRASES = [
  ['Scan first'],
  ['See fit fast'],
  ['Save what', 'works'],
];
const SERIF_FONT = Platform.select({
  ios: 'Georgia',
  android: 'serif',
  default: 'serif',
});
const AUTH_BACKGROUND = require('@/assets/images/auth-sky-background-portrait.png');
const DEV_FORCE_HOME =
  typeof __DEV__ !== 'undefined' &&
  __DEV__ &&
  (process.env.EXPO_PUBLIC_DEV_FORCE_HOME === '1' ||
    process.env.EXPO_PUBLIC_DEV_FORCE_HOME === 'true');

export default function AuthGateScreen() {
  const router = useRouter();
  const rootNavigationState = useRootNavigationState();
  const insets = useSafeAreaInsets();
  const { session, loading: authLoading } = useAuth();
  const rootNavigationReady = Boolean(rootNavigationState?.key);

  useEffect(() => {
    if (!rootNavigationReady) return;
    if (DEV_FORCE_HOME) {
      router.replace('/main/Home-Page');
      return;
    }
    if (!authLoading && session) {
      router.replace('/');
    }
  }, [authLoading, rootNavigationReady, session, router]);

  const go = useCallback((path: Href) => router.push(path), [router]);

  if (authLoading || session) return null;

  return (
    <View style={styles.root}>
      <Image
        source={AUTH_BACKGROUND}
        contentFit="cover"
        transition={180}
        style={StyleSheet.absoluteFill}
      />
      <View style={styles.backgroundWash} />
      <StatusBar style="dark" />
      <View style={{ flex: 1, paddingHorizontal: spacing.lg, paddingTop: insets.top + spacing.lg }}>
        <View style={styles.topBar}>
          <View style={styles.logoSlot} pointerEvents="none">
            <AuthLogoPill />
          </View>
        </View>

        <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
          <SplitPhraseHeadline
            phrases={PHRASES}
            textStyle={styles.heroPhrase}
            containerStyle={styles.heroPhraseFrame}
            lineStyle={styles.heroPhraseLine}
          />
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
    </View>
  );
}
const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: '#F7FAFF',
  },
  backgroundWash: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(255,255,255,0.20)',
  },
  topBar: {
    height: 48,
    justifyContent: 'center',
  },
  logoSlot: {
    position: 'absolute',
    left: 0,
    right: 0,
    alignItems: 'center',
  },
  heroPhrase: {
    color: '#0B1020',
    fontFamily: SERIF_FONT,
    fontSize: 52,
    lineHeight: 66,
    fontWeight: '500',
    letterSpacing: -0.8,
    textAlign: 'center',
  },
  heroPhraseFrame: {
    minHeight: 176,
    width: '100%',
  },
  heroPhraseLine: {
    minHeight: 76,
  },
  pillPrimary: {
    width: '100%',
    borderRadius: 999,
    backgroundColor: '#1e40af',
    paddingVertical: 18,
    alignItems: 'center',
    shadowColor: '#1e40af',
    shadowOpacity: 0.24,
    shadowRadius: 18,
    shadowOffset: { width: 0, height: 10 },
    elevation: 5,
  },
  pillPrimaryText: {
    color: '#FFFFFF',
    fontSize: 17,
    fontWeight: '800',
  },
  pillSecondary: {
    width: '100%',
    borderRadius: 999,
    borderWidth: 1,
    borderColor: 'rgba(15,23,42,0.08)',
    backgroundColor: 'rgba(255,255,255,0.70)',
    paddingVertical: 16,
    alignItems: 'center',
    shadowColor: '#9AB7DA',
    shadowOpacity: 0.12,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 7 },
    elevation: 3,
  },
  pillSecondaryText: {
    color: '#0B1020',
    fontSize: 17,
    fontWeight: '700',
  },
});
