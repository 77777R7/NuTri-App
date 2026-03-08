import React, { useCallback, useEffect, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { useRouter } from 'expo-router';

import { OnboardingCard } from '@/components/onboarding/OnboardingCard';
import { OnboardingContainer } from '@/components/onboarding/OnboardingContainer';
import { useOnboarding } from '@/contexts/OnboardingContext';
import { trackOnboardingEvent } from '@/lib/analytics/onboarding';
import { ONBOARDING_TOTAL_STEPS, SEX_OPTIONS } from '@/lib/onboarding-v2';
import { colors } from '@/lib/theme';

export default function SexScreen() {
  const router = useRouter();
  const { draft, saveDraft } = useOnboarding();
  const [selected, setSelected] = useState<string>(draft?.sex ?? draft?.gender ?? '');

  useEffect(() => {
    setSelected(draft?.sex ?? draft?.gender ?? '');
  }, [draft?.gender, draft?.sex]);

  const handleNext = useCallback(async () => {
    if (!selected) return;

    await saveDraft({ sex: selected, gender: selected }, 4);
    trackOnboardingEvent('question_answered', { question: 'sex', answer: selected });
    router.replace('/onboarding/experience');
  }, [router, saveDraft, selected]);

  return (
    <OnboardingContainer
      step={4}
      totalSteps={ONBOARDING_TOTAL_STEPS}
      title="How do you identify?"
      subtitle="Choose what feels right for your profile preferences."
      fallbackHref="/onboarding/age-range"
      scrollable
      disableNext={!selected}
      onNext={handleNext}
    >
      <View style={styles.content}>
        <Text style={styles.why}>Why we ask: some guidance and messaging adapt to your profile context.</Text>
        <View style={styles.list}>
          {SEX_OPTIONS.map((option) => (
            <OnboardingCard
              key={option}
              label={option}
              selected={selected === option}
              onPress={() => setSelected(option)}
              accessibilityLabel={`${option}${selected === option ? ' selected' : ''}`}
            />
          ))}
        </View>
      </View>
    </OnboardingContainer>
  );
}

const styles = StyleSheet.create({
  content: {
    flex: 1,
    gap: 14,
  },
  why: {
    fontSize: 13,
    lineHeight: 20,
    color: colors.textMuted,
  },
  list: {
    gap: 12,
  },
});
