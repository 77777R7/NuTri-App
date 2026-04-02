import React, { useCallback, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, StyleSheet, Text, View } from 'react-native';
import { useRouter } from 'expo-router';

import { GlassSurface } from '@/components/onboarding/shared/GlassSurface';
import { onboardingPalette } from '@/components/onboarding/shared/theme';
import { useOnboarding } from '@/contexts/OnboardingContext';
import { trackOnboardingEvent } from '@/lib/analytics/onboarding';
import { buildSmartFilterConfig, ONBOARDING_TOTAL_STEPS } from '@/lib/onboarding-v2';

export default function OnboardingDoneScreen() {
  const router = useRouter();
  const { draft, markCompletedLocal, saveDraft, setProgress } = useOnboarding();
  const [message, setMessage] = useState('Finishing your setup…');
  const hasStartedRef = useRef(false);

  const finalize = useCallback(
    async (destination: 'scan' | 'manual' | 'home') => {
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

  useEffect(() => {
    if (hasStartedRef.current) return;
    hasStartedRef.current = true;

    const preference = draft?.firstActionPreference ?? 'later';
    const destination = preference === 'later' ? 'home' : preference;

    if (destination === 'scan') {
      setMessage('Opening scanner…');
    } else if (destination === 'manual') {
      setMessage('Opening search…');
    } else {
      setMessage('Taking you home…');
    }

    void finalize(destination);
  }, [draft?.firstActionPreference, finalize]);

  return (
    <View style={styles.root}>
      <View pointerEvents="none" style={StyleSheet.absoluteFillObject}>
        <View style={styles.bg} />
        <View style={styles.mistOne} />
        <View style={styles.mistTwo} />
      </View>
      <View style={styles.center}>
        <GlassSurface variant="panel" borderRadius={32} style={styles.card}>
          <ActivityIndicator size="small" color={onboardingPalette.primary} />
          <Text style={styles.title}>NuTri is ready</Text>
          <Text style={styles.body}>{message}</Text>
        </GlassSurface>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: onboardingPalette.background,
  },
  bg: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: onboardingPalette.background,
  },
  mistOne: {
    position: 'absolute',
    top: 120,
    left: 24,
    right: 24,
    height: 240,
    borderRadius: 240,
    backgroundColor: 'rgba(79,125,255,0.06)',
    opacity: 0.35,
  },
  mistTwo: {
    position: 'absolute',
    bottom: 180,
    left: 70,
    right: 70,
    height: 220,
    borderRadius: 220,
    backgroundColor: 'rgba(255,255,255,0.55)',
    opacity: 0.65,
  },
  center: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 24,
  },
  card: {
    width: '100%',
    paddingHorizontal: 24,
    paddingVertical: 24,
    alignItems: 'center',
    gap: 10,
  },
  title: {
    color: onboardingPalette.text,
    fontSize: 22,
    lineHeight: 28,
    fontWeight: '700',
    letterSpacing: -0.4,
  },
  body: {
    color: onboardingPalette.textMuted,
    fontSize: 14.5,
    lineHeight: 21,
    fontWeight: '500',
    textAlign: 'center',
  },
});
