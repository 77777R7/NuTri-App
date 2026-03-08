import React, { useCallback, useEffect, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { useRouter } from 'expo-router';

import { OnboardingCard } from '@/components/onboarding/OnboardingCard';
import { OnboardingContainer } from '@/components/onboarding/OnboardingContainer';
import { useOnboarding } from '@/contexts/OnboardingContext';
import { trackOnboardingEvent } from '@/lib/analytics/onboarding';
import { AGE_RANGE_OPTIONS, ONBOARDING_TOTAL_STEPS } from '@/lib/onboarding-v2';
import { colors } from '@/lib/theme';

export default function AgeRangeScreen() {
  const router = useRouter();
  const { draft, saveDraft } = useOnboarding();
  const [selected, setSelected] = useState<string>(draft?.ageRange ?? '');

  useEffect(() => {
    setSelected(draft?.ageRange ?? '');
  }, [draft?.ageRange]);

  const handleNext = useCallback(async () => {
    if (!selected) return;

    await saveDraft({ ageRange: selected }, 3);
    trackOnboardingEvent('question_answered', { question: 'age_range', answer: selected });
    router.replace('/onboarding/sex');
  }, [router, saveDraft, selected]);

  return (
    <OnboardingContainer
      step={3}
      totalSteps={ONBOARDING_TOTAL_STEPS}
      title="Which age range are you in?"
      subtitle="This helps us tune guidance tone and personalization for you."
      fallbackHref="/onboarding/data-trust"
      scrollable
      disableNext={!selected}
      onNext={handleNext}
    >
      <View style={styles.content}>
        <Text style={styles.why}>Why we ask: age range helps tailor relevance and safety context.</Text>
        <View style={styles.list}>
          {AGE_RANGE_OPTIONS.map((option) => (
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
