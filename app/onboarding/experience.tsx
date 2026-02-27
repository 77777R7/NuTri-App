import React, { useCallback, useEffect, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { useRouter } from 'expo-router';

import { OnboardingCard } from '@/components/onboarding/OnboardingCard';
import { OnboardingContainer } from '@/components/onboarding/OnboardingContainer';
import { useOnboarding } from '@/contexts/OnboardingContext';
import { trackOnboardingEvent } from '@/lib/analytics/onboarding';
import { ONBOARDING_TOTAL_STEPS, SUPPLEMENT_EXPERIENCE_OPTIONS } from '@/lib/onboarding-v2';
import { colors } from '@/lib/theme';

export default function ExperienceScreen() {
  const router = useRouter();
  const { draft, saveDraft } = useOnboarding();
  const [selected, setSelected] = useState<string>(draft?.supplementExperience ?? '');

  useEffect(() => {
    setSelected(draft?.supplementExperience ?? '');
  }, [draft?.supplementExperience]);

  const handleNext = useCallback(async () => {
    if (!selected) return;

    await saveDraft({ supplementExperience: selected }, 5);
    trackOnboardingEvent('question_answered', { question: 'supplement_experience', answer: selected });
    router.push('/onboarding/goals');
  }, [router, saveDraft, selected]);

  return (
    <OnboardingContainer
      step={5}
      totalSteps={ONBOARDING_TOTAL_STEPS}
      title="How familiar are you with supplements?"
      subtitle="We tailor onboarding depth based on your current experience."
      fallbackHref="/onboarding/sex"
      disableNext={!selected}
      onNext={handleNext}
    >
      <View style={styles.content}>
        <Text style={styles.why}>Why we ask: this decides how much guidance detail to show in key moments.</Text>
        <View style={styles.list}>
          {SUPPLEMENT_EXPERIENCE_OPTIONS.map((option) => (
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
