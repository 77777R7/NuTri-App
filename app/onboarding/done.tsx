import React, { useCallback, useState } from 'react';
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { useRouter } from 'expo-router';

import { BrandGradient } from '@/components/BrandGradient';
import { useOnboarding } from '@/contexts/OnboardingContext';
import { trackOnboardingEvent } from '@/lib/analytics/onboarding';
import { buildSmartFilterConfig, ONBOARDING_TOTAL_STEPS } from '@/lib/onboarding-v2';
import { colors } from '@/lib/theme';

export default function OnboardingDoneScreen() {
  const router = useRouter();
  const { draft, markCompletedLocal, saveDraft, setProgress } = useOnboarding();
  const [busy, setBusy] = useState<null | 'scan' | 'manual' | 'home'>(null);

  const finalize = useCallback(
    async (destination: 'scan' | 'manual' | 'home') => {
      setBusy(destination);
      const completionAt = new Date().toISOString();
      const smartFilterConfig = buildSmartFilterConfig({
        goals: draft?.goals ?? [],
        preferredTypes: draft?.preferredTypes ?? [],
      });

      await saveDraft(
        {
          onboardingVersion: 'v2',
          onboardingCompletedAt: completionAt,
          smartFilterConfig,
          firstActionPreference:
            destination === 'home'
              ? draft?.firstActionPreference ?? 'later'
              : destination,
        },
        ONBOARDING_TOTAL_STEPS,
      );
      await markCompletedLocal();
      await setProgress(ONBOARDING_TOTAL_STEPS);

      trackOnboardingEvent('onboarding_completed', {
        version: 'v2',
        destination,
        goalsCount: draft?.goals?.length ?? 0,
      });

      if (destination === 'scan') {
        trackOnboardingEvent('first_scan_started', { source: 'onboarding_done' });
        router.replace({ pathname: '/scan/barcode', params: { source: 'onboarding' } });
        return;
      }

      if (destination === 'manual') {
        router.replace({ pathname: '/scan/label', params: { mode: 'upload', source: 'onboarding' } });
        return;
      }

      router.replace('/main');
    },
    [draft?.firstActionPreference, draft?.goals, draft?.preferredTypes, markCompletedLocal, router, saveDraft, setProgress],
  );

  return (
    <BrandGradient>
      <View style={styles.container}>
        <View style={styles.headerBlock}>
          <Text style={styles.title}>Your Smart Filter is ready</Text>
          <Text style={styles.subtitle}>
            NuTri is now personalized to your goals. Start with your first supplement when you are ready.
          </Text>
        </View>

        <View style={styles.card}>
          <Text style={styles.cardTitle}>Next best actions</Text>
          <Text style={styles.cardBody}>1. Scan your first supplement for instant setup.</Text>
          <Text style={styles.cardBody}>2. Add a second supplement and compare your stack.</Text>
        </View>

        <View style={styles.footer}>
          <TouchableOpacity
            style={[styles.primary, busy !== null && busy !== 'scan' ? styles.disabled : null]}
            activeOpacity={0.92}
            disabled={busy !== null}
            onPress={() => {
              void finalize('scan');
            }}
          >
            <Text style={styles.primaryText}>{busy === 'scan' ? 'Opening scanner...' : 'Scan first supplement'}</Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={[styles.secondary, busy !== null && busy !== 'manual' ? styles.disabled : null]}
            activeOpacity={0.9}
            disabled={busy !== null}
            onPress={() => {
              void finalize('manual');
            }}
          >
            <Text style={styles.secondaryText}>{busy === 'manual' ? 'Opening upload...' : 'Add manually'}</Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={styles.ghost}
            activeOpacity={0.9}
            disabled={busy !== null}
            onPress={() => {
              void finalize('home');
            }}
          >
            <Text style={styles.ghostText}>{busy === 'home' ? 'Finishing...' : 'Go to Home'}</Text>
          </TouchableOpacity>
        </View>
      </View>
    </BrandGradient>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    paddingHorizontal: 24,
    paddingVertical: 32,
    justifyContent: 'space-between',
  },
  headerBlock: {
    gap: 12,
  },
  title: {
    fontSize: 30,
    lineHeight: 36,
    fontWeight: '800',
    color: colors.text,
    textAlign: 'center',
  },
  subtitle: {
    fontSize: 16,
    lineHeight: 24,
    color: colors.textMuted,
    textAlign: 'center',
  },
  card: {
    borderRadius: 20,
    backgroundColor: '#FFFFFF',
    borderWidth: 1,
    borderColor: colors.border,
    padding: 20,
    gap: 10,
  },
  cardTitle: {
    fontSize: 17,
    fontWeight: '700',
    color: colors.text,
  },
  cardBody: {
    fontSize: 14,
    lineHeight: 22,
    color: colors.textMuted,
  },
  footer: {
    gap: 12,
  },
  primary: {
    height: 56,
    borderRadius: 16,
    backgroundColor: colors.brand,
    alignItems: 'center',
    justifyContent: 'center',
  },
  primaryText: {
    color: '#FFFFFF',
    fontSize: 16,
    fontWeight: '700',
  },
  secondary: {
    height: 56,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: '#FFFFFF',
    alignItems: 'center',
    justifyContent: 'center',
  },
  secondaryText: {
    fontSize: 16,
    fontWeight: '600',
    color: colors.text,
  },
  ghost: {
    height: 48,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
  ghostText: {
    fontSize: 14,
    fontWeight: '600',
    color: colors.textMuted,
  },
  disabled: {
    opacity: 0.6,
  },
});
