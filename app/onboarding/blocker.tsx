import React, { useCallback, useEffect, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { useRouter } from 'expo-router';

import { OnboardingCard } from '@/components/onboarding/OnboardingCard';
import { OnboardingContainer } from '@/components/onboarding/OnboardingContainer';
import { useOnboarding } from '@/contexts/OnboardingContext';
import { trackOnboardingEvent } from '@/lib/analytics/onboarding';
import { ADHERENCE_BLOCKER_OPTIONS, ONBOARDING_TOTAL_STEPS } from '@/lib/onboarding-v2';
import { colors } from '@/lib/theme';

export default function BlockerScreen() {
  const router = useRouter();
  const { draft, saveDraft } = useOnboarding();
  const [selected, setSelected] = useState<string>(draft?.adherenceBlocker ?? '');

  useEffect(() => {
    setSelected(draft?.adherenceBlocker ?? '');
  }, [draft?.adherenceBlocker]);

  const handleNext = useCallback(async () => {
    if (!selected) return;

    await saveDraft({ adherenceBlocker: selected }, 8);
    trackOnboardingEvent('question_answered', { question: 'adherence_blocker', answer: selected });
    router.push('/onboarding/setup');
  }, [router, saveDraft, selected]);

  return (
    <OnboardingContainer
      step={8}
      totalSteps={ONBOARDING_TOTAL_STEPS}
      title="What usually gets in the way of taking supplements consistently?"
      subtitle="Pick the one that fits best right now."
      fallbackHref="/onboarding/types"
      disableNext={!selected}
      onNext={handleNext}
      nextLabel="Continue"
    >
      <View style={styles.content}>
        <Text style={styles.why}>Why we ask: we personalize reminders and guidance around your biggest blocker.</Text>
        <View style={styles.list}>
          {ADHERENCE_BLOCKER_OPTIONS.map((option) => {
            const isSelected = selected === option;
            return (
              <OnboardingCard
                key={option}
                label={option}
                selected={isSelected}
                onPress={() => setSelected(option)}
                accessibilityLabel={`${option}${isSelected ? ' selected' : ''}`}
              />
            );
          })}
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
