import React, { useCallback, useEffect } from 'react';
import { Linking, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { useRouter } from 'expo-router';
import * as Haptics from 'expo-haptics';

import { OnboardingContainer } from '@/components/onboarding/OnboardingContainer';
import { useOnboarding } from '@/contexts/OnboardingContext';
import { trackOnboardingEvent } from '@/lib/analytics/onboarding';
import { ONBOARDING_TOTAL_STEPS } from '@/lib/onboarding-v2';
import { colors } from '@/lib/theme';

const PRIVACY_POLICY_URL = 'https://www.nutri.app/privacy';

const TRUST_CARDS = [
  {
    title: 'What we collect',
    body: 'Basic profile answers, your selected goals, and feature preferences to personalize the app.',
  },
  {
    title: 'Why we need it',
    body: 'Your answers shape Smart Filter, recommendations, and the onboarding setup you see next.',
  },
  {
    title: 'Your control',
    body: 'You can update preferences anytime, and permissions are requested only when you use that feature.',
  },
] as const;

export default function DataTrustScreen() {
  const router = useRouter();
  const { saveDraft } = useOnboarding();

  useEffect(() => {
    trackOnboardingEvent('trust_page_viewed', { screen: 'data_trust' });
  }, []);

  const handleOpenPolicy = useCallback(async () => {
    try {
      await Linking.openURL(PRIVACY_POLICY_URL);
    } catch (error) {
      console.warn('[onboarding] failed to open privacy policy', error);
    }
  }, []);

  const handleNext = useCallback(async () => {
    try {
      await Haptics.selectionAsync();
    } catch {
      // noop
    }

    await saveDraft({ onboardingVersion: 'v2' }, 2);
    router.push('/onboarding/age-range');
  }, [router, saveDraft]);

  return (
    <OnboardingContainer
      step={2}
      totalSteps={ONBOARDING_TOTAL_STEPS}
      title="Your data, protected"
      subtitle="We ask for a few details so NuTri can work better for you."
      fallbackHref="/onboarding/welcome"
      onNext={handleNext}
      nextLabel="Continue"
    >
      <View style={styles.content}>
        {TRUST_CARDS.map((card) => (
          <View key={card.title} style={styles.card}>
            <Text style={styles.cardTitle}>{card.title}</Text>
            <Text style={styles.cardBody}>{card.body}</Text>
          </View>
        ))}

        <TouchableOpacity style={styles.policyButton} onPress={handleOpenPolicy}>
          <Text style={styles.policyButtonText}>Read full Privacy Policy</Text>
        </TouchableOpacity>
      </View>
    </OnboardingContainer>
  );
}

const styles = StyleSheet.create({
  content: {
    flex: 1,
    gap: 14,
  },
  card: {
    borderRadius: 16,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: '#FFFFFF',
    paddingHorizontal: 16,
    paddingVertical: 14,
    gap: 6,
  },
  cardTitle: {
    fontSize: 16,
    fontWeight: '700',
    color: colors.text,
  },
  cardBody: {
    fontSize: 14,
    lineHeight: 21,
    color: colors.textMuted,
  },
  policyButton: {
    marginTop: 8,
    alignSelf: 'flex-start',
    paddingVertical: 8,
  },
  policyButtonText: {
    fontSize: 14,
    fontWeight: '600',
    color: colors.brandDark,
  },
});
